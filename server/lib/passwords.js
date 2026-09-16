// ─── Passwords and one-time tokens ────────────────────────────────────────────
//
// Passwords are never stored, and never recoverable. What goes in the database
// is a scrypt digest with a per-account random salt, so two people who pick the
// same password still get different rows, and a stolen copy of the database
// does not hand anybody a password.
//
// scrypt is deliberately slow and deliberately memory-hungry: the parameters
// below cost roughly 32 MB and a fraction of a second per guess, which is
// nothing when somebody signs in once and ruinous for anyone working through a
// word list. It ships with Node, so there is no native module to build and no
// dependency to keep patched — the safest option we can reach from here.
//
// Email confirmation tokens get the same treatment for the same reason: the
// token is mailed to the person and only its SHA-256 digest is kept, so the
// database never holds anything that could be replayed to confirm an address.

const crypto    = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

// cost = 2^15, block size 8, one lane. Memory used is 128 × N × r ≈ 32 MB.
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };
// scrypt's default maxmem is 32 MB, which the parameters above sit right on
// top of. Ask for room explicitly rather than discovering the limit in
// production.
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2;

const SALT_BYTES  = 16;
const TOKEN_BYTES = 32;

// ─── Policy ───────────────────────────────────────────────────────────────────

const MIN_LENGTH = 10;
// A password field is the one place an unauthenticated stranger chooses how
// much work we do, so cap the input rather than hashing whatever arrives.
const MAX_LENGTH = 200;

// Not a serious dictionary — just the handful that get typed on a church site
// when somebody is in a hurry. Everything else is left to the length rule.
const OBVIOUS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '1234567890',
  '12345678901', '123456789012', 'qwertyuiop', 'letmein123', 'iloveyou1',
  'capshaw123', 'churchofchrist', 'welcome123',
]);

// Returns an explanation of why a password is unacceptable, or '' if it is fine.
function passwordProblem(password, { email = '', name = '' } = {}) {
  if (typeof password !== 'string' || !password) return 'Please choose a password.';
  if (password.length < MIN_LENGTH) return `Please use at least ${MIN_LENGTH} characters.`;
  if (password.length > MAX_LENGTH) return `Please use no more than ${MAX_LENGTH} characters.`;

  const folded = password.toLowerCase();
  if (OBVIOUS.has(folded)) return 'That password is too easy to guess. Please choose another.';

  // A password that is just the address or the name it protects is no secret
  // to anyone holding the directory.
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && folded === local) return 'Please choose a password that is not your email address.';
  if (name && folded === String(name).toLowerCase().replace(/\s+/g, '')) {
    return 'Please choose a password that is not your name.';
  }

  return '';
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

// Stored as scrypt$N$r$p$salt$hash, so the cost parameters travel with the
// digest and can be raised later without stranding the rows already written.
async function hashPassword(password) {
  const salt   = crypto.randomBytes(SALT_BYTES);
  const digest = await scrypt(password, salt, PARAMS.keylen, { ...PARAMS, maxmem: MAXMEM });
  return [
    'scrypt', PARAMS.N, PARAMS.r, PARAMS.p,
    salt.toString('base64'), digest.toString('base64'),
  ].join('$');
}

async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  if (password.length > MAX_LENGTH) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const N = Number(n), R = Number(r), P = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P)) return false;

  let expected;
  try {
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (!expected.length) return false;

  let actual;
  try {
    actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N, r: R, p: P, maxmem: 128 * N * R * 2,
    });
  } catch {
    return false;
  }

  // Both buffers are the same length by construction, so this compares in
  // constant time and leaks nothing about how close a guess was.
  return crypto.timingSafeEqual(actual, expected);
}

// Spends the same work as a real check without any account behind it. Used on
// the sign-in path when the address is unknown, so a stranger cannot learn who
// has an account here by timing the response.
async function burnTime() {
  await scrypt('no-such-account', crypto.randomBytes(SALT_BYTES), PARAMS.keylen, {
    ...PARAMS, maxmem: MAXMEM,
  });
  return false;
}

// ─── One-time tokens ──────────────────────────────────────────────────────────

// The caller mails `token` and stores `hash`. Losing the database therefore
// does not hand anybody a working confirmation link.
function createToken() {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashToken(token) };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = {
  MIN_LENGTH, MAX_LENGTH,
  passwordProblem,
  hashPassword, verifyPassword, burnTime,
  createToken, hashToken,
};
