// ─── What each person wants to hear about, and how ────────────────────────────
//
// Two levels, on purpose:
//
//   account-wide  — a master email switch and when the digest goes out, kept
//                   on the users row because they are properties of the login
//   per type      — one row per type a person has an opinion about; absent
//                   means "the default this type ships with", so a new account
//                   behaves sensibly without a row per type being written
//
// Nothing here sends anything. It answers one question — for this person and
// this type, does it go in the inbox, and does it go out by email now, later,
// or never — and lets the settings screen read and write those answers.

const db = require('../db');
const { TYPES, CATEGORIES, EMAIL_MODES, getType, isEmailMode } = require('./types');
const { hasRole } = require('../middleware/auth');

const DIGEST_FREQUENCIES = ['daily', 'weekly'];

// ─── Account-wide settings ────────────────────────────────────────────────────

function accountSettings(user) {
  const row = db.prepare(`
    SELECT email_enabled, digest_frequency, digest_hour, digest_weekday
    FROM users WHERE id = ?
  `).get(user.id) || {};

  return {
    emailEnabled: row.email_enabled !== 0,
    digest: {
      frequency: DIGEST_FREQUENCIES.includes(row.digest_frequency) ? row.digest_frequency : 'daily',
      hour:      clampHour(row.digest_hour),
      weekday:   clampWeekday(row.digest_weekday),
    },
  };
}

function clampHour(value) {
  const hour = Number(value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 7;
}

function clampWeekday(value) {
  const day = Number(value);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : 1;
}

// ─── Per-type settings ────────────────────────────────────────────────────────

// A type is only offered to people it could ever reach: nobody is asked
// whether they want the admin housekeeping notices unless they are an admin.
function appliesTo(user, type) {
  return !type.minRole || hasRole(user, type.minRole);
}

function storedRows(userId) {
  const rows = db.prepare('SELECT type, in_app, email FROM notification_preferences WHERE user_id = ?').all(userId);
  return new Map(rows.map(r => [r.type, r]));
}

// The monthly worship summary predates this system and has its own column on
// the users row, which the worship workflow and its tests still read. Rather
// than keep two sources of truth, that column stays the authority for whether
// that one type is on at all: the stored row only says how it arrives.
const LEGACY_COLUMN_TYPE = 'worship.monthly_report';

function wantsMonthlyReport(userId) {
  const row = db.prepare('SELECT wants_monthly_report FROM users WHERE id = ?').get(userId);
  return row?.wants_monthly_report !== 0;
}

// The one place a stored row (or the lack of one) is turned into an answer.
function resolve(user, type, stored) {
  const inApp = stored ? stored.in_app !== 0 : true;
  const email = stored && isEmailMode(stored.email) ? stored.email : type.defaultEmail;

  if (type.id !== LEGACY_COLUMN_TYPE) return { inApp, email };
  if (!wantsMonthlyReport(user.id))   return { inApp, email: 'off' };
  return { inApp, email: email === 'off' ? type.defaultEmail : email };
}

// What this person's settings are for one type, defaults filled in.
function effective(user, typeId) {
  const type = getType(typeId);
  if (!type || !user || !appliesTo(user, type)) return null;
  return resolve(user, type, storedRows(user.id).get(typeId));
}

// Everything the settings screen needs: the catalogue, this person's answers,
// and the vocabulary to render them — so the UI never hard-codes a type.
function settingsFor(user) {
  const stored = storedRows(user.id);

  return {
    account: accountSettings(user),
    categories: CATEGORIES
      .map(category => ({
        ...category,
        types: TYPES
          .filter(type => type.category === category.id && appliesTo(user, type))
          .map(type => {
            const row = stored.get(type.id);
            const { inApp, email } = resolve(user, type, row);
            return {
              id:           type.id,
              label:        type.label,
              description:  type.description || '',
              audience:     type.audience,
              defaultEmail: type.defaultEmail,
              inApp,
              email,
              // Whether they have ever said anything about this one, so the
              // screen can show what is still on its default.
              customised:   !!row || (type.id === LEGACY_COLUMN_TYPE && !wantsMonthlyReport(user.id)),
            };
          }),
      }))
      .filter(category => category.types.length),
    emailModes: EMAIL_MODES,
    digestFrequencies: DIGEST_FREQUENCIES,
  };
}

// ─── Saving ───────────────────────────────────────────────────────────────────

const UPSERT_SQL = `
  INSERT INTO notification_preferences (user_id, type, in_app, email, updated_at)
  VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, type) DO UPDATE
  SET in_app = excluded.in_app, email = excluded.email, updated_at = excluded.updated_at
`;

// Accepts a partial payload: only the types and switches named are touched,
// so the screen can save one row without resending everything.
function save(user, payload = {}) {
  const changes = [];

  if (payload.types !== undefined) {
    if (typeof payload.types !== 'object' || Array.isArray(payload.types) || payload.types === null) {
      return { error: 'types must be an object of type id → setting' };
    }
    // Validate the lot before writing any of it, so a single bad type id
    // cannot leave half a person's settings changed.
    for (const [typeId, setting] of Object.entries(payload.types)) {
      const type = getType(typeId);
      if (!type)                  return { error: `Unknown notification type: ${typeId}` };
      if (!appliesTo(user, type)) return { error: `That notification is not one you can receive: ${typeId}` };
      if (setting?.email !== undefined && !isEmailMode(setting.email)) {
        return { error: `Email must be one of: ${EMAIL_MODES.map(m => m.id).join(', ')}` };
      }
      if (setting?.inApp !== undefined && typeof setting.inApp !== 'boolean') {
        return { error: 'inApp must be true or false' };
      }
      changes.push([typeId, setting]);
    }
  }

  const account = {};
  if (payload.emailEnabled !== undefined) {
    if (typeof payload.emailEnabled !== 'boolean') return { error: 'emailEnabled must be true or false' };
    account.email_enabled = payload.emailEnabled ? 1 : 0;
  }
  if (payload.digest !== undefined) {
    const { frequency, hour, weekday } = payload.digest || {};
    if (frequency !== undefined) {
      if (!DIGEST_FREQUENCIES.includes(frequency)) {
        return { error: `Digest frequency must be one of: ${DIGEST_FREQUENCIES.join(', ')}` };
      }
      account.digest_frequency = frequency;
    }
    if (hour !== undefined) {
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { error: 'Digest hour must be between 0 and 23' };
      account.digest_hour = hour;
    }
    if (weekday !== undefined) {
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: 'Digest day must be between 0 and 6' };
      account.digest_weekday = weekday;
    }
  }

  applyChanges(user, changes, account);
  return { settings: settingsFor(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) };
}

const applyChanges = db.transaction((user, changes, account) => {
  const upsert = db.prepare(UPSERT_SQL);
  for (const [typeId, setting] of changes) {
    const current = effective(user, typeId) || { inApp: true, email: getType(typeId).defaultEmail };
    const inApp = setting?.inApp === undefined ? current.inApp : setting.inApp;
    const email = setting?.email === undefined ? current.email : setting.email;
    upsert.run(user.id, typeId, inApp ? 1 : 0, email);

    // Keep the old column in step, so the worship workflow keeps honouring it.
    if (typeId === LEGACY_COLUMN_TYPE) {
      db.prepare('UPDATE users SET wants_monthly_report = ? WHERE id = ?')
        .run(email === 'off' ? 0 : 1, user.id);
    }
  }

  const columns = Object.keys(account);
  if (columns.length) {
    db.prepare(`UPDATE users SET ${columns.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...columns.map(c => account[c]), user.id);
  }
});

module.exports = {
  accountSettings, effective, settingsFor, save, appliesTo,
  DIGEST_FREQUENCIES, LEGACY_COLUMN_TYPE,
};
