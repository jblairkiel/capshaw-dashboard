// ─── Authenticator-app codes (RFC 6238) ───────────────────────────────────────
//
// The six-digit codes Google Authenticator, Microsoft Authenticator, 1Password
// and the rest show, worked out here with nothing but Node's crypto. Each code
// is an HMAC-SHA1 of the number of 30-second steps since 1970, keyed with a
// secret the phone and this server both hold. Nothing is sent anywhere, which
// is the point: the code proves the person has the phone, and email (still in
// test mode) plays no part.
const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS       = 6;
// How many steps either side of now a code is still accepted for: one, so a
// code typed as it rolls over still works, and a phone clock a little out is
// forgiven. Wider than that and a stolen code lives too long.
const DRIFT_STEPS  = 1;
const ISSUER       = 'Capshaw Church';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index === -1) throw new Error('Not a base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 20 random bytes (160 bits), the size RFC 4226 recommends for SHA-1.
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function stepAt(timeMs = Date.now()) {
  return Math.floor(timeMs / 1000 / STEP_SECONDS);
}

function codeForStep(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

function codeAt(secret, timeMs = Date.now()) {
  return codeForStep(secret, stepAt(timeMs));
}

// Spaces and dashes are what people type when they copy "123 456" off the
// screen, so they are forgiven.
function cleanCode(code) {
  return String(code ?? '').replace(/[\s-]/g, '');
}

function looksLikeCode(code) {
  return /^\d{6}$/.test(cleanCode(code));
}

// The step the code belongs to, or null. A code at or before `lastStep` — one
// that has already been used — is refused even while it is still in its
// window, so a code read over somebody's shoulder cannot be used a second time.
function verify(secret, code, { lastStep = -1, timeMs = Date.now() } = {}) {
  const typed = cleanCode(code);
  if (!secret || !/^\d{6}$/.test(typed)) return null;
  const now = stepAt(timeMs);
  for (let delta = -DRIFT_STEPS; delta <= DRIFT_STEPS; delta += 1) {
    const step = now + delta;
    if (step <= lastStep) continue;
    const expected = codeForStep(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(typed))) return step;
  }
  return null;
}

// What the QR code holds. The label is what the person sees in their app, so
// it names the church and the account rather than a hostname.
function otpauthUri(secret, accountName) {
  const label = `${ISSUER}:${accountName || 'account'}`;
  const params = new URLSearchParams({
    secret, issuer: ISSUER, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports = {
  STEP_SECONDS, DIGITS, DRIFT_STEPS, ISSUER,
  base32Encode, base32Decode, generateSecret, stepAt, codeForStep, codeAt,
  cleanCode, looksLikeCode, verify, otpauthUri,
};
