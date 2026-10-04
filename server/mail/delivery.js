// ─── Who gets real mail while the site is in test mode ────────────────────────
//
// While MAIL_REDIRECT_TO is set (the default), every email goes to that one
// address instead of the person it is for (see ./mailer.js). An admin can let
// some of it through, on Admin → Email Delivery:
//
//   · a role — admins, or the holders of an area such as Song Tracker. Anybody
//     whose account holds a role that is let through gets their own mail.
//   · a person — by email address, either let through or kept redirected. A
//     person's own setting beats any role: "everyone on the song tracker,
//     except him" and "just her" are both one setting each.
//
// Everybody else stays redirected, so the default — nothing set — is exactly
// what it always was: all mail to the redirect address. Clearing
// MAIL_REDIRECT_TO is still the single step that sends everything for real.

const db = require('../db');
const { AREAS, areaLabel } = require('../lib/areas');

// The roles that can be let through: admins, then every area.
function roles() {
  return [
    { key: 'admin', label: 'Admins', description: 'Everyone whose account is an admin.' },
    ...AREAS.map(a => ({ key: a.id, label: a.label, description: `Everyone given ${a.label}.` })),
  ];
}
const ROLE_KEYS = () => new Set(roles().map(r => r.key));

const normal = email => String(email || '').trim().toLowerCase();

// ─── The rules ────────────────────────────────────────────────────────────────

function rules() {
  const rows = db.prepare('SELECT kind, key, label, deliver, updated_by, updated_at FROM mail_redirect_rules').all();
  return {
    roles: new Map(rows.filter(r => r.kind === 'role').map(r => [r.key, r])),
    people: new Map(rows.filter(r => r.kind === 'person').map(r => [r.key, r])),
  };
}

// The roles an address holds through accounts with that address: 'admin' for
// an admin account, and every area granted to one. An admin's implicit hold on
// every area does not count — letting the song tracker through should not
// send every admin their mail.
function rolesOf(email) {
  const accounts = db.prepare("SELECT id, role FROM users WHERE lower(trim(email)) = ? AND role <> 'pending'").all(normal(email));
  const held = new Set();
  for (const a of accounts) {
    if (a.role === 'admin') held.add('admin');
    for (const { area } of db.prepare('SELECT area FROM user_areas WHERE user_id = ?').all(a.id)) held.add(area);
  }
  return held;
}

// Whether mail for this address goes to it for real, and why.
//   { deliver: true,  why: 'person' }              — let through by name
//   { deliver: false, why: 'person' }              — kept redirected by name
//   { deliver: true,  why: 'role', role: 'songs' } — a role they hold is let through
//   { deliver: false, why: 'default' }             — redirected, like everybody else
function decide(email, set = rules()) {
  const key = normal(email);
  const own = set.people.get(key);
  if (own) return { deliver: !!own.deliver, why: 'person' };
  for (const role of rolesOf(key)) {
    if (set.roles.get(role)?.deliver) return { deliver: true, why: 'role', role, roleLabel: role === 'admin' ? 'Admins' : areaLabel(role) };
  }
  return { deliver: false, why: 'default' };
}

// ─── Changing them ────────────────────────────────────────────────────────────

function setRole(key, deliver, user) {
  if (!ROLE_KEYS().has(key)) return { error: 'No such role' };
  if (deliver) {
    db.prepare(`
      INSERT INTO mail_redirect_rules (kind, key, deliver, updated_by, updated_at) VALUES ('role', ?, 1, ?, datetime('now'))
      ON CONFLICT (kind, key) DO UPDATE SET deliver = 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `).run(key, user?.name || '');
  } else {
    db.prepare("DELETE FROM mail_redirect_rules WHERE kind = 'role' AND key = ?").run(key);
  }
  return { key, deliver: !!deliver };
}

const VALID = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setPerson({ email, name = '', deliver }, user) {
  const key = normal(email);
  if (!VALID.test(key)) return { error: 'That is not an email address' };
  if (typeof deliver !== 'boolean') return { error: 'Say whether to send for real or keep redirecting' };
  db.prepare(`
    INSERT INTO mail_redirect_rules (kind, key, label, deliver, updated_by, updated_at) VALUES ('person', ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (kind, key) DO UPDATE SET label = excluded.label, deliver = excluded.deliver,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(key, String(name || '').trim().slice(0, 120), deliver ? 1 : 0, user?.name || '');
  return { email: key, name, deliver };
}

function removePerson(email) {
  const key = normal(email);
  const row = db.prepare("SELECT * FROM mail_redirect_rules WHERE kind = 'person' AND key = ?").get(key);
  if (!row) return { error: 'That person has no setting of their own' };
  db.prepare("DELETE FROM mail_redirect_rules WHERE kind = 'person' AND key = ?").run(key);
  return { removed: row };
}

// ─── What the page shows ──────────────────────────────────────────────────────

// Everybody the site might write to: accounts and directory entries with an
// address, once per address.
function addressBook() {
  const byEmail = new Map();
  const add = (email, name, source) => {
    const key = normal(email);
    if (!VALID.test(key)) return;
    if (!byEmail.has(key)) byEmail.set(key, { email: key, name: String(name || '').trim(), sources: [] });
    const entry = byEmail.get(key);
    if (!entry.name && name) entry.name = String(name).trim();
    if (!entry.sources.includes(source)) entry.sources.push(source);
  };
  for (const u of db.prepare("SELECT name, email FROM users WHERE role <> 'pending' AND trim(coalesce(email, '')) <> ''").all()) add(u.email, u.name, 'account');
  for (const d of db.prepare("SELECT name, email FROM directory WHERE trim(email) <> ''").all()) add(d.email, d.name, 'directory');
  return [...byEmail.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

// Who holds each role, by address, so the page can say who a switch affects.
function holders() {
  const map = new Map(roles().map(r => [r.key, []]));
  for (const u of db.prepare("SELECT id, name, email, role FROM users WHERE role <> 'pending' AND trim(coalesce(email, '')) <> ''").all()) {
    const person = { name: u.name, email: normal(u.email) };
    if (u.role === 'admin') map.get('admin').push(person);
    for (const { area } of db.prepare('SELECT area FROM user_areas WHERE user_id = ?').all(u.id)) map.get(area)?.push(person);
  }
  return map;
}

function overview({ redirectTo }) {
  const set = rules();
  const who = holders();
  const book = addressBook();
  const real = book
    .map(p => ({ ...p, ...decide(p.email, set) }))
    .filter(p => p.deliver)
    .map(({ email, name, why, roleLabel }) => ({ email, name, why, roleLabel }));
  return {
    redirecting: !!redirectTo,
    redirectTo: redirectTo || null,
    roles: roles().map(r => ({ ...r, deliver: !!set.roles.get(r.key)?.deliver, holders: who.get(r.key) || [] })),
    people: [...set.people.values()]
      .map(r => ({ email: r.key, name: r.label, deliver: !!r.deliver, updatedBy: r.updated_by, updatedAt: r.updated_at }))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
    addressBook: book,
    real,
  };
}

module.exports = { roles, rules, rolesOf, decide, setRole, setPerson, removePerson, addressBook, overview };
