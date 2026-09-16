const express   = require('express');
const passport  = require('passport');
const { Strategy: GoogleStrategy }   = require('passport-google-oauth20');
const { Strategy: FacebookStrategy } = require('passport-facebook');
const db = require('../db');
const { requireAuth, requireAdmin, ROLES, isRole } = require('../middleware/auth');
const {
  passwordProblem, hashPassword, verifyPassword, burnTime,
  createToken, hashToken, MIN_LENGTH,
} = require('../lib/passwords');
const { EDITABLE_FIELDS } = require('../lib/people');
const { rateLimit } = require('../middleware/rateLimit');
const accountMail = require('../mail/accounts');

const isProd     = process.env.NODE_ENV === 'production';
const CLIENT_URL = isProd ? 'https://capshaw.jblairkiel.com' : 'http://localhost:5173';
const SERVER_URL = isProd ? 'https://capshaw.jblairkiel.com' : 'http://localhost:3001';

const router = express.Router();

// ─── Passport serialization ───────────────────────────────────────────────────

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser((id, done) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

// ─── Shared upsert helper ─────────────────────────────────────────────────────

// Find the directory entry this sign-in belongs to by email. Only an
// unambiguous single match counts — a shared family email must be assigned by
// an admin rather than guessed at.
function findPersonByEmail(email) {
  if (!email) return null;
  const matches = db.prepare(
    'SELECT id FROM directory WHERE lower(trim(email)) = ? LIMIT 2'
  ).all(email.trim().toLowerCase());
  return matches.length === 1 ? matches[0].id : null;
}

function upsertUser(provider, profileId, email, name, photo) {
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const isAdmin = email && adminEmail && email.toLowerCase() === adminEmail;

  const existing = db.prepare(
    'SELECT * FROM users WHERE provider = ? AND provider_id = ?'
  ).get(provider, profileId);

  if (existing) {
    db.prepare(
      'UPDATE users SET email=?, name=?, photo=?, last_login=datetime(\'now\') WHERE id=?'
    ).run(email || existing.email, name, photo || existing.photo, existing.id);
    // Promote to admin if matched and not already
    if (isAdmin && existing.role !== 'admin') {
      db.prepare('UPDATE users SET role=\'admin\' WHERE id=?').run(existing.id);
    }
    // Link to a directory entry once, and never re-point an existing link —
    // an admin may have assigned it deliberately.
    if (!existing.directory_id) {
      const personId = findPersonByEmail(email || existing.email);
      if (personId) db.prepare('UPDATE users SET directory_id=? WHERE id=?').run(personId, existing.id);
    }
    return db.prepare('SELECT * FROM users WHERE id=?').get(existing.id);
  }

  const role = isAdmin ? 'admin' : 'pending';
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, photo, role, directory_id, last_login) VALUES (?,?,?,?,?,?,?,datetime(\'now\'))'
  ).run(provider, profileId, email || null, name, photo || null, role, findPersonByEmail(email));
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}

// ─── Google strategy ──────────────────────────────────────────────────────────

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  `${SERVER_URL}/api/auth/google/callback`,
    },
    (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;
        const photo = profile.photos?.[0]?.value || null;
        const user  = upsertUser('google', profile.id, email, profile.displayName, photo);
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  ));
}

// ─── Facebook strategy ────────────────────────────────────────────────────────

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(new FacebookStrategy(
    {
      clientID:     process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL:  `${SERVER_URL}/api/auth/facebook/callback`,
      profileFields: ['id', 'displayName', 'emails', 'photos'],
    },
    (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;
        const photo = profile.photos?.[0]?.value || null;
        const user  = upsertUser('facebook', profile.id, email, profile.displayName, photo);
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  ));
}

// ─── Email + password accounts ────────────────────────────────────────────────
//
// An account made here is worth nothing on its own. Two separate things have to
// happen before it can sign in at all:
//
//   1. the person answers the confirmation email, proving the address is
//      really theirs, and
//   2. an admin approves them, and in the same act says which member of the
//      congregation they are.
//
// Until both are done /login refuses, so there is no session, and therefore
// nothing in the portal is readable — the site-wide gate in
// middleware/auth.js needs a session before it will show anything at all.

const VERIFY_TTL_HOURS   = 48;
// How long before "send it again" will mail the same address a second time, so
// the button cannot be used to pester somebody.
const RESEND_INTERVAL_MS = 2 * 60 * 1000;
// Sign-in attempts are counted per account, not per address typed, so a wrong
// guess against a real account is what costs — a stranger cannot lock somebody
// out of an account that does not exist.
const MAX_FAILED_LOGINS  = 8;
const LOCKOUT_MINUTES    = 15;

// Caps on how often one caller may reach the three endpoints that are open to
// strangers. Generous enough that a household sharing an address never notices,
// tight enough that nobody can make this server hash passwords in a loop.
const limitSignIn   = rateLimit({ max: 20, message: 'Too many sign-in attempts just now. Please wait a few minutes and try again.' });
const limitRegister = rateLimit({ max: 10, message: 'Too many attempts just now. Please wait a few minutes and try again.' });
const limitResend   = rateLimit({ max: 10, message: 'Too many attempts just now. Please wait a few minutes and try again.' });

// Registration says the same thing whether or not the address already has an
// account. The difference is only in which email goes out, which only the
// owner of the mailbox can see — so the form cannot be used to find out who
// is a member here.
const CHECK_YOUR_EMAIL =
  'Thank you. If we can use that address, a confirmation email is on its way — please open the link in it.';

const WRONG_CREDENTIALS =
  'That email address and password do not match an account here.';

// Express 4 does not notice a rejected promise from an `async` handler, which
// would leave the request hanging rather than answering. Both routes below
// await a hash, so they go through here and a real failure becomes a 500.
const asyncRoute = handler => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

// Any account at all on this address, whichever way it signs in. Used to keep
// one person from ending up with a Google account and a password account that
// the directory then cannot tell apart.
function anyAccountFor(email) {
  return db.prepare('SELECT * FROM users WHERE lower(trim(email)) = ? ORDER BY id ASC').get(email);
}

function localAccountFor(email) {
  return db.prepare("SELECT * FROM users WHERE provider = 'local' AND provider_id = ?").get(email);
}

// Everything the client is ever told about an account. Deliberately not
// spread from the row: password_hash and the token digests live on it.
function publicUser(user) {
  const { id, name, email, photo, role, provider, created_at, last_login, directory_id } = user;
  return { id, name, email, photo, role, provider, created_at, last_login, directory_id };
}

// Issues a fresh confirmation token, stores only its digest, and mails the
// token itself. Any token issued earlier stops working, so a forwarded old
// email cannot be used once a new one has been asked for.
function issueVerification(user) {
  const { token, hash } = createToken();
  db.prepare(`
    UPDATE users
       SET email_verify_hash = ?,
           email_verify_expires_at = datetime('now', ?),
           email_verify_sent_at = datetime('now')
     WHERE id = ?
  `).run(hash, `+${VERIFY_TTL_HOURS} hours`, user.id);
  accountMail.confirmAddress({ name: user.name, email: user.email, token });
  return token;
}

// Rolls the session id over before signing somebody in. Sessions are optional
// here only so the route can be exercised without a session store; in the app
// express-session always provides one.
function regenerateSession(req, done) {
  if (typeof req.session?.regenerate !== 'function') return done(null);
  return req.session.regenerate(done);
}

function sentTooRecently(user) {
  if (!user.email_verify_sent_at) return false;
  const sent = Date.parse(`${user.email_verify_sent_at.replace(' ', 'T')}Z`);
  return Number.isFinite(sent) && Date.now() - sent < RESEND_INTERVAL_MS;
}

// ─── POST /register ───────────────────────────────────────────────────────────

router.post('/register', limitRegister, asyncRoute(async (req, res) => {
  const email    = normalizeEmail(req.body?.email);
  const name     = cleanName(req.body?.name);
  const password = req.body?.password;

  if (!isEmailAddress(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }
  if (!name) {
    return res.status(400).json({ success: false, error: 'Please tell us your name.' });
  }
  if (name.length > 120) {
    return res.status(400).json({ success: false, error: 'That name is too long.' });
  }

  const problem = passwordProblem(password, { email, name });
  if (problem) return res.status(400).json({ success: false, error: problem });

  const existing = anyAccountFor(email);
  if (existing) {
    // Same answer as a real registration; the mailbox owner alone is told the
    // address is already in use, and how they actually sign in.
    accountMail.addressAlreadyRegistered({
      email, name: existing.name, provider: existing.provider,
    });
    return res.json({ success: true, message: CHECK_YOUR_EMAIL });
  }

  // Hashing happens before the insert so a failure here leaves no half-made
  // account behind.
  const digest = await hashPassword(password);

  let user;
  try {
    const { lastInsertRowid: id } = db.prepare(`
      INSERT INTO users (provider, provider_id, email, name, role, password_hash)
      VALUES ('local', ?, ?, ?, 'pending', ?)
    `).run(email, email, name, digest);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  } catch (err) {
    // Two registrations for one address, racing. The loser says exactly what
    // the winner said.
    if (String(err.message).includes('UNIQUE')) {
      return res.json({ success: true, message: CHECK_YOUR_EMAIL });
    }
    throw err;
  }

  // No directory link is guessed here, however well the address matches.
  // Saying who a new account belongs to is the admin's job, and it happens at
  // approval so that the two decisions are never made apart.
  issueVerification(user);
  res.json({ success: true, message: CHECK_YOUR_EMAIL });
}));

// ─── GET /verify-email ────────────────────────────────────────────────────────
//
// Opened from the email, by a browser, so it answers with a redirect back to
// the sign-in page carrying the outcome rather than with JSON.

router.get('/verify-email', (req, res) => {
  const back = outcome => res.redirect(`${CLIENT_URL}/?${outcome}`);

  const token = String(req.query?.token ?? '');
  if (!token) return back('verify_error=missing');

  const user = db.prepare(`
    SELECT * FROM users
     WHERE provider = 'local' AND email_verify_hash <> '' AND email_verify_hash = ?
  `).get(hashToken(token));

  if (!user) {
    // Either the link is wrong, or it has already been used. An account that
    // is confirmed already should not be told its link is broken.
    return back('verify_error=invalid');
  }

  const expired = db.prepare("SELECT datetime('now') > ? AS expired").get(user.email_verify_expires_at).expired;
  if (expired) return back('verify_error=expired');

  // On a brand-new install the owner has no one to approve them, so the
  // address named by ADMIN_EMAIL is let straight in — exactly as it is on the
  // Google and Facebook paths.
  const owner = isOwner(user);

  db.prepare(`
    UPDATE users
       SET email_verified_at = datetime('now'),
           email_verify_hash = '',
           email_verify_expires_at = NULL,
           role = ?
     WHERE id = ?
  `).run(owner ? 'admin' : user.role, user.id);

  const confirmed = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

  if (confirmed.role === 'pending') {
    // Only now is there anything for an admin to decide, so only now does it
    // land in their inbox.
    accountMail.awaitingApproval({ user: confirmed });
    return back('verified=pending');
  }
  return back('verified=1');
});

// ─── POST /resend-verification ────────────────────────────────────────────────

router.post('/resend-verification', limitResend, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isEmailAddress(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }

  const user = localAccountFor(email);
  // Nothing below changes the answer: an unknown address, an address that is
  // already confirmed, and one that was mailed a minute ago all look alike
  // from outside.
  if (user && !user.email_verified_at && !sentTooRecently(user)) issueVerification(user);

  res.json({ success: true, message: CHECK_YOUR_EMAIL });
});

// ─── POST /login ──────────────────────────────────────────────────────────────

router.post('/login', limitSignIn, asyncRoute(async (req, res, next) => {
  const email    = normalizeEmail(req.body?.email);
  const password = req.body?.password;

  const wrong = () => res.status(401).json({ success: false, error: WRONG_CREDENTIALS });

  if (!isEmailAddress(email) || typeof password !== 'string' || !password) {
    // Spend the same time as a real check, so a malformed or unknown address
    // is not visibly faster than a wrong password.
    await burnTime();
    return wrong();
  }

  const user = localAccountFor(email);
  if (!user) {
    await burnTime();
    return wrong();
  }

  const locked = user.locked_until &&
    db.prepare("SELECT datetime('now') < ? AS locked").get(user.locked_until).locked;
  if (locked) {
    return res.status(429).json({
      success: false,
      code:    'locked',
      error:   `Too many sign-in attempts. Please wait ${LOCKOUT_MINUTES} minutes and try again.`,
    });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const failures = user.failed_logins + 1;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(
      failures,
      failures >= MAX_FAILED_LOGINS
        ? db.prepare("SELECT datetime('now', ?) AS t").get(`+${LOCKOUT_MINUTES} minutes`).t
        : null,
      user.id,
    );
    return wrong();
  }

  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);

  // The password was right — from here on the answers are specific, because
  // whoever is asking has already proved they hold this account.
  if (!user.email_verified_at) {
    return res.status(403).json({
      success: false,
      code:    'email_unverified',
      error:   'Please confirm your email address first — open the link in the email we sent you.',
    });
  }
  if (user.role === 'pending') {
    return res.status(403).json({
      success: false,
      code:    'pending_approval',
      error:   'Thank you for confirming your address. The church office still has to approve your account — you will get an email as soon as they do.',
    });
  }

  // A brand-new session id for the signed-in session, so a cookie somebody was
  // handed before they signed in cannot be reused afterwards.
  regenerateSession(req, regenErr => {
    if (regenErr) return next(regenErr);
    req.logIn(user, err => {
      if (err) return next(err);
      db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
      const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      res.json({ success: true, user: publicUser(fresh) });
    });
  });
}));

// What the sign-up form should tell people before they type a password.
router.get('/password-policy', (req, res) => {
  res.json({ success: true, minLength: MIN_LENGTH });
});

// ─── Auth routes ──────────────────────────────────────────────────────────────

router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    if (err) {
      console.error('[auth] Google error:', err.message);
      return res.redirect(`${CLIENT_URL}/?auth_error=google`);
    }
    if (!user) {
      console.log('[auth] Google: no user —', info?.message ?? 'unknown reason');
      return res.redirect(`${CLIENT_URL}/?auth_error=google`);
    }
    req.logIn(user, loginErr => {
      if (loginErr) {
        console.error('[auth] Google session error:', loginErr.message);
        return res.redirect(`${CLIENT_URL}/?auth_error=google`);
      }
      console.log('[auth] Google login OK — user', user.id, user.role);
      res.redirect(CLIENT_URL);
    });
  })(req, res, next);
});

router.get('/facebook',
  passport.authenticate('facebook', { scope: ['email'] })
);

router.get('/facebook/callback', (req, res, next) => {
  passport.authenticate('facebook', (err, user, info) => {
    if (err) {
      console.error('[auth] Facebook error:', err.message);
      return res.redirect(`${CLIENT_URL}/?auth_error=facebook`);
    }
    if (!user) {
      console.log('[auth] Facebook: no user —', info?.message ?? 'unknown reason');
      return res.redirect(`${CLIENT_URL}/?auth_error=facebook`);
    }
    req.logIn(user, loginErr => {
      if (loginErr) {
        console.error('[auth] Facebook session error:', loginErr.message);
        return res.redirect(`${CLIENT_URL}/?auth_error=facebook`);
      }
      console.log('[auth] Facebook login OK — user', user.id, user.role);
      res.redirect(CLIENT_URL);
    });
  })(req, res, next);
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ success: false });
  res.json({ success: true, user: publicUser(req.user) });
});

router.post('/logout', (req, res) => {
  req.logout(err => {
    if (err) return res.status(500).json({ success: false });
    req.session.destroy(() => res.json({ success: true }));
  });
});

// ─── Admin: user management ───────────────────────────────────────────────────

// The account named by ADMIN_EMAIL is re-promoted to admin on every login, so
// its role is not editable here — changing it would silently revert.
function isOwner(user) {
  const ownerEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  return !!(ownerEmail && user?.email && user.email.toLowerCase() === ownerEmail);
}

function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}

// ─── Approving an account ─────────────────────────────────────────────────────
//
// Letting somebody in and saying who they are is one decision, not two. An
// approved account that is not linked to the directory can see the whole
// congregation's information while nobody can tell whose account it is, and
// the person cannot keep their own household up to date. So approval always
// carries a member profile with it: either an existing directory entry, or a
// new one created on the spot.

const APPROVAL_NEEDS_PERSON =
  'Approving an account also has to say who it belongs to. Pick their entry in the member directory, or create one for them.';

// Creates the directory entry for somebody who is not in it yet. Every field
// typed here is a deliberate entry, so all of them are recorded as hand-edited
// and the directory sync will leave them alone on its next run.
function createPerson(fields) {
  const clean = {};
  for (const field of EDITABLE_FIELDS) {
    const value = fields?.[field];
    if (value === undefined || value === null) continue;
    clean[field] = String(value).trim();
  }

  if (!clean.name) return { error: 'A new member profile needs a name.' };

  const columns = [...Object.keys(clean), 'edited_fields'];
  const values  = [...Object.keys(clean).map(f => clean[f]), JSON.stringify(Object.keys(clean))];
  const { lastInsertRowid: id } = db.prepare(
    `INSERT INTO directory (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).run(...values);

  return { id };
}

// Works out which directory entry an approval is for. Returns { id } or
// { error, status }.
function resolveDirectory(target, body) {
  const person = body?.person;
  if (person && typeof person === 'object' && !Array.isArray(person)) {
    return createPerson(person);
  }

  const raw = body?.directory_id;
  if (raw !== undefined && raw !== null && raw !== '') {
    const personId = Number(raw);
    if (!Number.isInteger(personId)) {
      return { error: 'directory_id must be a number', status: 400 };
    }
    const found = db.prepare('SELECT id FROM directory WHERE id=?').get(personId);
    if (!found) return { error: 'Directory entry not found', status: 404 };

    const taken = db.prepare('SELECT name FROM users WHERE directory_id=? AND id<>?').get(personId, target.id);
    if (taken) return { error: `Already linked to ${taken.name}`, status: 409 };

    return { id: personId };
  }

  // Nothing was chosen — but the account may already be linked, which happens
  // when an OAuth sign-in matched a directory address on its own. That link is
  // the admin's answer unless they replace it here.
  if (target.directory_id) return { id: target.directory_id };

  return { error: APPROVAL_NEEDS_PERSON, status: 400, code: 'directory_required' };
}

function userRow(id) {
  const user = db.prepare(`
    SELECT u.id, u.provider, u.email, u.name, u.photo, u.role, u.created_at, u.last_login,
           u.directory_id, u.email_verified_at, d.name AS directory_name
      FROM users u LEFT JOIN directory d ON d.id = u.directory_id
     WHERE u.id = ?
  `).get(id);
  return { ...user, is_owner: isOwner(user) };
}

function approveUser(actor, targetId, body = {}) {
  const role = body.role ?? 'approved';
  if (!isRole(role) || role === 'pending') {
    return { status: 400, body: { success: false, error: `Role must be one of: ${ROLES.filter(r => r !== 'pending').join(', ')}` } };
  }

  const target = db.prepare('SELECT * FROM users WHERE id=?').get(targetId);
  if (!target) return { status: 404, body: { success: false, error: 'User not found' } };

  if (String(target.id) === String(actor.id)) {
    return { status: 400, body: { success: false, error: 'You cannot approve your own account' } };
  }
  if (isOwner(target)) {
    return { status: 400, body: { success: false, error: 'The owner account is always an admin' } };
  }

  const person = resolveDirectory(target, body);
  if (person.error) {
    return { status: person.status ?? 400, body: { success: false, error: person.error, code: person.code } };
  }

  const wasPending = target.role === 'pending';
  db.prepare(`
    UPDATE users
       SET role = ?, directory_id = ?, approved_at = datetime('now'), approved_by = ?
     WHERE id = ?
  `).run(role, person.id, actor.id, target.id);

  const user = userRow(target.id);
  // Only the change from "waiting" to "in" is worth an email. Moving somebody
  // between member roles later is not news to them.
  if (wasPending) accountMail.approved({ user, personName: user.directory_name });

  return { status: 200, body: { success: true, user } };
}

// Shared by the role selector and the revoke shortcut. Returns an
// { status, body } pair so each route can just forward it.
function changeRole(actor, targetId, role) {
  if (!isRole(role)) {
    return { status: 400, body: { success: false, error: `Role must be one of: ${ROLES.join(', ')}` } };
  }

  const target = db.prepare('SELECT * FROM users WHERE id=?').get(targetId);
  if (!target) return { status: 404, body: { success: false, error: 'User not found' } };

  if (String(target.id) === String(actor.id)) {
    return { status: 400, body: { success: false, error: 'You cannot change your own role' } };
  }
  if (isOwner(target)) {
    return { status: 400, body: { success: false, error: 'The owner account is always an admin' } };
  }
  if (target.role === 'admin' && role !== 'admin' && countAdmins() <= 1) {
    return { status: 400, body: { success: false, error: 'Cannot remove the last admin' } };
  }

  // Letting a waiting account in is an approval however it is spelled, so it
  // goes the same way and carries the same member profile with it.
  if (target.role === 'pending' && role !== 'pending') {
    return approveUser(actor, targetId, { role });
  }

  if (target.role !== role) db.prepare('UPDATE users SET role=? WHERE id=?').run(role, target.id);

  return { status: 200, body: { success: true, user: userRow(target.id) } };
}

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.provider, u.email, u.name, u.photo, u.role, u.created_at, u.last_login,
           u.directory_id, u.email_verified_at, u.approved_at, d.name AS directory_name
    FROM users u LEFT JOIN directory d ON d.id = u.directory_id
    ORDER BY u.role ASC, u.created_at ASC
  `).all().map(u => ({ ...u, is_owner: isOwner(u) }));
  res.json({ success: true, users, roles: ROLES });
});

router.patch('/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const { status, body } = changeRole(req.user, req.params.id, req.body?.role);
  res.status(status).json(body);
});

// Approve, and say who they are at the same time. The body carries either
// `directory_id` for somebody already in the directory or `person` to create
// a new entry for them; `role` may be raised above plain member.
router.patch('/users/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const { status, body } = approveUser(req.user, req.params.id, req.body ?? {});
  res.status(status).json(body);
});

router.patch('/users/:id/revoke', requireAuth, requireAdmin, (req, res) => {
  const { status, body } = changeRole(req.user, req.params.id, 'pending');
  res.status(status).json(body);
});

// Link a login to the directory entry it belongs to. Needed whenever someone
// signs in with an email that differs from the one in the directory, since
// only then can they edit their own household.
router.patch('/users/:id/directory', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });

  const raw = req.body?.directory_id;
  if (raw === null || raw === '' || raw === undefined) {
    db.prepare('UPDATE users SET directory_id=NULL WHERE id=?').run(target.id);
    return res.json({ success: true, directory_id: null });
  }

  const personId = Number(raw);
  if (!Number.isInteger(personId)) {
    return res.status(400).json({ success: false, error: 'directory_id must be a number or null' });
  }
  const person = db.prepare('SELECT id, name FROM directory WHERE id=?').get(personId);
  if (!person) return res.status(404).json({ success: false, error: 'Directory entry not found' });

  const taken = db.prepare('SELECT id, name FROM users WHERE directory_id=? AND id<>?').get(personId, target.id);
  if (taken) {
    return res.status(409).json({ success: false, error: `Already linked to ${taken.name}` });
  }

  db.prepare('UPDATE users SET directory_id=? WHERE id=?').run(personId, target.id);
  res.json({ success: true, directory_id: personId, directory_name: person.name });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (String(req.params.id) === String(req.user.id)) {
    return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
  }
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  if (isOwner(target)) {
    return res.status(400).json({ success: false, error: 'Cannot remove the owner account' });
  }
  if (target.role === 'admin' && countAdmins() <= 1) {
    return res.status(400).json({ success: false, error: 'Cannot remove the last admin' });
  }
  db.prepare('DELETE FROM users WHERE id=?').run(target.id);
  res.json({ success: true });
});

module.exports = router;
// Exported for tests: the sign-in path that links an account to a directory entry.
module.exports.upsertUser = upsertUser;
// Exported for tests: the rate limiters count per process, so a test file that
// makes many requests from one address needs a way back to a clean slate.
module.exports.resetRateLimits = () => {
  limitSignIn.reset();
  limitRegister.reset();
  limitResend.reset();
};
