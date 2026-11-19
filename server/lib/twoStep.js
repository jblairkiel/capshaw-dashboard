// ─── Two-step sign-in ─────────────────────────────────────────────────────────
//
// After the password (or Google, or Facebook) a second step: a six-digit code
// from an authenticator app on the person's phone, or one of ten single-use
// recovery codes if the phone is lost. Email codes are deliberately not an
// option — mail is still in test mode, and a code that never arrives would
// lock an admin out.
//
// Who has to use it: admins, and anybody holding the Member Directory area,
// because those accounts can read and change the whole congregation's
// details. Everybody else may turn it on from My Info if they want to.
//
// Getting back in without the phone, in order of preference:
//   1. A recovery code (each works once).
//   2. Another admin turns it off for them on the Users page; they set it up
//      again the next time they sign in.
//   3. The last resort, for the last admin: on the server,
//        node server/tools/reset-two-step.js someone@example.com
//      which does the same as 2 and is written to the action history.
const crypto = require('crypto');
const db = require('../db');
const totp = require('./totp');
const { holdsArea } = require('./areas');

const RECOVERY_CODE_COUNT = 10;
// No 0/O, 1/I/L: these are read off paper and typed by hand.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// The areas that make two-step sign-in compulsory, alongside being an admin.
const REQUIRED_AREAS = ['directory'];

// TWO_STEP_REQUIRED=off turns the requirement off without touching anybody's
// own setting — for the sample-data portal the guide recordings use, and as
// an escape hatch if the requirement itself ever needs lifting in a hurry.
function requirementOn() {
  return String(process.env.TWO_STEP_REQUIRED || '').toLowerCase() !== 'off';
}

function isEnabled(user) {
  return !!(user && user.two_step_enabled_at && user.two_step_secret);
}

function isRequired(user) {
  if (!user || !requirementOn()) return false;
  if (user.role === 'admin') return true;
  return REQUIRED_AREAS.some(area => holdsArea(user, area));
}

function recoveryLeft(userId) {
  return db.prepare(
    'SELECT COUNT(*) AS n FROM two_step_recovery_codes WHERE user_id = ? AND used_at IS NULL'
  ).get(userId).n;
}

// What the client is told about an account's second step.
function statusOf(user) {
  const enabled = isEnabled(user);
  return {
    enabled,
    required: isRequired(user),
    enabled_at: enabled ? user.two_step_enabled_at : null,
    recovery_codes_left: enabled ? recoveryLeft(user.id) : 0,
  };
}

function hashRecovery(code) {
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(`two-step-recovery:${clean}`).digest('hex');
}

function looksLikeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').length === 8;
}

function newRecoveryCode() {
  // randomInt draws without the bias `byte % 31` would have.
  let out = '';
  for (let i = 0; i < 8; i += 1) out += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

// Replaces every recovery code the account had with a fresh set, and returns
// the codes themselves — the only time they are ever seen.
function issueRecoveryCodes(userId) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const insert = db.prepare('INSERT INTO two_step_recovery_codes (user_id, code_hash) VALUES (?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM two_step_recovery_codes WHERE user_id = ?').run(userId);
    for (const code of codes) insert.run(userId, hashRecovery(code));
  })();
  return codes;
}

// Turns it on, once the person has proved their app makes the right codes.
// Returns the recovery codes, or null if the code was wrong.
function enable(user, secret, code) {
  const step = totp.verify(secret, code);
  if (step === null) return null;
  db.prepare(`
    UPDATE users SET two_step_secret = ?, two_step_enabled_at = datetime('now'), two_step_last_step = ?
     WHERE id = ?
  `).run(secret, step, user.id);
  return issueRecoveryCodes(user.id);
}

function disable(userId) {
  db.transaction(() => {
    db.prepare(`
      UPDATE users SET two_step_secret = '', two_step_enabled_at = NULL, two_step_last_step = -1
       WHERE id = ?
    `).run(userId);
    db.prepare('DELETE FROM two_step_recovery_codes WHERE user_id = ?').run(userId);
  })();
}

// Checks a code typed at the second step: an authenticator code first, then a
// recovery code. Returns 'app', 'recovery' or null. A recovery code is spent
// the moment it works; an app code moves last_step on so it cannot be replayed.
function check(user, code) {
  if (!isEnabled(user)) return null;
  if (totp.looksLikeCode(code)) {
    const step = totp.verify(user.two_step_secret, code, { lastStep: user.two_step_last_step ?? -1 });
    if (step === null) return null;
    // Guarded on the old value, so two requests racing with the same code
    // cannot both get through.
    const { changes } = db.prepare(
      'UPDATE users SET two_step_last_step = ? WHERE id = ? AND two_step_last_step < ?'
    ).run(step, user.id, step);
    return changes ? 'app' : null;
  }
  if (looksLikeRecoveryCode(code)) {
    const { changes } = db.prepare(`
      UPDATE two_step_recovery_codes SET used_at = datetime('now')
       WHERE id = (SELECT id FROM two_step_recovery_codes
                    WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1)
    `).run(user.id, hashRecovery(code));
    return changes ? 'recovery' : null;
  }
  return null;
}

module.exports = {
  RECOVERY_CODE_COUNT, REQUIRED_AREAS,
  requirementOn, isEnabled, isRequired, statusOf, recoveryLeft,
  issueRecoveryCodes, enable, disable, check, hashRecovery,
};
