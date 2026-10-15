const express   = require('express');
const passport  = require('passport');
const { Strategy: GoogleStrategy }   = require('passport-google-oauth20');
const { Strategy: FacebookStrategy } = require('passport-facebook');
const db = require('../db');
const {
  requireAuth, requireAdmin, ROLES, isRole,
  AREAS, isArea, areasFor, setAreas, effectiveAreas, areaLabel,
} = require('../middleware/auth');
const actionLog = require('../lib/actionLog');
const { impersonationProblem } = require('../middleware/impersonation');
const {
  passwordProblem, hashPassword, verifyPassword, burnTime,
  createToken, hashToken, MIN_LENGTH,
} = require('../lib/passwords');
const { EDITABLE_FIELDS } = require('../lib/people');
const { rateLimit } = require('../middleware/rateLimit');
const accountMail = require('../mail/accounts');
const notices = require('../mail/notices');

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

// Brings a returning account up to date on a sign-in made through one of its
// linked identities: the owner promotion and the one-time directory link, as on
// the account's own provider. The address and name are left alone — they
// belong to the way the account was made, and for a password account the
// address is what it signs in with.
function refreshLinkedUser(user, identity, { email, photo, isAdmin }) {
  db.prepare("UPDATE user_identities SET email = ?, last_login = datetime('now') WHERE id = ?")
    .run(email || identity.email, identity.id);
  db.prepare("UPDATE users SET photo = COALESCE(NULLIF(photo, ''), ?), last_login = datetime('now') WHERE id = ?")
    .run(photo || null, user.id);
  if (isAdmin && user.role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
  }
  if (!user.directory_id) {
    const personId = findPersonByEmail(user.email || email);
    if (personId) db.prepare('UPDATE users SET directory_id = ? WHERE id = ?').run(personId, user.id);
  }
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

// What a sign-in gets instead of an account when it has to wait for an admin.
// The strategies hand `refusal` to passport as the reason there is nobody to
// sign in, and the callback sends it to the sign-in page as auth_error.
const LINK_REFUSALS = {
  link_pending:  'This sign-in shares its address with an existing account, and an admin has to confirm it is the same person first.',
  link_declined: 'An admin declined joining this sign-in to the existing account with its address.',
};
const refuse = code => ({ refusal: code, message: LINK_REFUSALS[code] });

// Carries out a join an admin has approved (or the owner's own, below). The
// provider sign-in has shown the address is theirs, which is why an
// email-and-password account still waiting on its confirmation email counts
// as confirmed now. That account's password is cleared, though: anybody could
// have typed this address into the sign-up form, and only the provider sign-in
// has proved who owns it. "Forgot your password?" sets a new one.
function completeLink(identityId, deciderId) {
  db.prepare(`
    UPDATE user_identities
       SET status = 'approved', decided_at = datetime('now'), decided_by = ?
     WHERE id = ?
  `).run(deciderId ?? null, identityId);

  const identity = db.prepare('SELECT * FROM user_identities WHERE id = ?').get(identityId);
  const user     = db.prepare('SELECT * FROM users WHERE id = ?').get(identity.user_id);

  const unconfirmed = user.provider === 'local' && !user.email_verified_at;
  if (unconfirmed) {
    db.prepare(`
      UPDATE users
         SET email_verified_at = datetime('now'),
             email_verify_hash = '',
             email_verify_expires_at = NULL,
             password_hash = ''
       WHERE id = ?
    `).run(user.id);
  }
  const linked = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

  // A confirmed address is what puts a password account in front of an admin,
  // so one confirmed by this join goes to them now, as it would have from the
  // confirmation link.
  if (unconfirmed && linked.role === 'pending') accountMail.awaitingApproval({ user: linked });
  return { identity, user: linked };
}

// A first-time Google or Facebook sign-in whose address an account here
// already has. Matching addresses are only a suggestion that it is the same
// person, so the sign-in is recorded as a request and goes nowhere until an
// admin approves it. The admins are asked, and the account holder is told —
// so a sign-in that is not theirs never waits quietly for a yes.
//
// The one exception is the owner address (ADMIN_EMAIL), which is let in on any
// sign-in anyway and may have nobody else to approve it.
function requestLink(account, provider, profileId, { email, photo, isAdmin }) {
  try {
    db.prepare(`
      INSERT INTO user_identities (user_id, provider, provider_id, email, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(account.id, provider, profileId, email);
  } catch (err) {
    // The same first sign-in, twice at once. The other one has asked already.
    if (String(err.message).includes('UNIQUE')) return refuse('link_pending');
    throw err;
  }
  const identity = db.prepare('SELECT * FROM user_identities WHERE provider = ? AND provider_id = ?').get(provider, profileId);

  if (isAdmin) {
    completeLink(identity.id, null);
    return refreshLinkedUser(account, identity, { email, photo, isAdmin });
  }

  accountMail.linkAwaitingApproval({ account, provider, email });
  accountMail.linkRequested({ account, provider });
  return refuse('link_pending');
}

// Where a Google or Facebook sign-in lands. Together with the address check in
// POST /register (anyAccountFor), this keeps the same person on the same
// account however they arrive:
//
//   1. the provider identity the account was made with, or
//   2. one joined to an account — once an admin has approved it, or
//   3. an address the provider vouches for that an account here already has —
//      recorded as a request to join, for an admin to approve, or
//   4. a new account, waiting for approval.
//
// Returns the account to sign in to, or `{ refusal, message }` while a join is
// waiting on an admin or was declined.
//
// `emailVerified` is false only when the provider says outright that the
// address is unconfirmed (Google reports it; Facebook only hands out confirmed
// addresses). Such an address is never used to find an existing account, since
// anybody could have typed it.
function upsertUser(provider, profileId, email, name, photo, { emailVerified = true } = {}) {
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const isAdmin = email && adminEmail && email.toLowerCase() === adminEmail;

  const existing = db.prepare(
    'SELECT * FROM users WHERE provider = ? AND provider_id = ?'
  ).get(provider, profileId);

  if (!existing) {
    const identity = db.prepare(
      'SELECT * FROM user_identities WHERE provider = ? AND provider_id = ?'
    ).get(provider, profileId);
    const owner = identity && db.prepare('SELECT * FROM users WHERE id = ?').get(identity.user_id);
    if (owner) {
      if (identity.status === 'approved') return refreshLinkedUser(owner, identity, { email, photo, isAdmin });
      return refuse(identity.status === 'declined' ? 'link_declined' : 'link_pending');
    }

    const sameAddress = email && emailVerified && anyAccountFor(normalizeEmail(email));
    if (sameAddress) return requestLink(sameAddress, provider, profileId, { email, photo, isAdmin });
  }

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
  const created = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  // Google or Facebook has already vouched for the address, so there is
  // something for an admin to decide straight away.
  if (role === 'pending') accountMail.awaitingApproval({ user: created });
  return created;
}

// ─── Which providers are set up ───────────────────────────────────────────────

// A provider is only offered when both of its credentials are configured. The
// sign-in page asks for this list (GET /providers) and shows just those buttons.
const PROVIDERS = [
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && 'google',
  process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET && 'facebook',
].filter(Boolean);

// Google says whether the address on a profile has been confirmed; Facebook
// only ever hands out confirmed ones, and says nothing.
function addressConfirmed(profile) {
  const verified = profile.emails?.[0]?.verified;
  return verified !== false && verified !== 'false';
}

// ─── Google strategy ──────────────────────────────────────────────────────────

if (PROVIDERS.includes('google')) {
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
        const user  = upsertUser('google', profile.id, email, profile.displayName, photo, {
          emailVerified: addressConfirmed(profile),
        });
        if (user.refusal) return done(null, false, { code: user.refusal, message: user.message });
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  ));
}

// ─── Facebook strategy ────────────────────────────────────────────────────────

if (PROVIDERS.includes('facebook')) {
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
        const user  = upsertUser('facebook', profile.id, email, profile.displayName, photo, {
          emailVerified: addressConfirmed(profile),
        });
        if (user.refusal) return done(null, false, { code: user.refusal, message: user.message });
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
const limitForgot   = rateLimit({ max: 10, message: 'Too many attempts just now. Please wait a few minutes and try again.' });
const limitReset    = rateLimit({ max: 20, message: 'Too many attempts just now. Please wait a few minutes and try again.' });

// "Forgot your password?" answers the same whether or not the address has an
// account, for the same reason registration does.
const RESET_SENT =
  'If that address has an account here, an email with a link to choose a new password is on its way.';

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
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
}

function cleanName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

// Any account at all on this address, whichever way it signs in — including an
// address that only a joined Google or Facebook sign-in carries (or one waiting
// on an admin to join it). Used to keep
// one person from ending up with a Google account and a password account that
// the directory then cannot tell apart. The oldest wins, should an address
// already be on two accounts from before they were joined.
function anyAccountFor(email) {
  if (!email) return undefined;
  return db.prepare(`
    SELECT * FROM users
     WHERE lower(trim(email)) = ?
        OR id IN (SELECT user_id FROM user_identities WHERE lower(trim(email)) = ? AND status <> 'declined')
     ORDER BY id ASC
  `).get(email, email);
}

function localAccountFor(email) {
  return db.prepare("SELECT * FROM users WHERE provider = 'local' AND provider_id = ?").get(email);
}

// Everything the client is ever told about an account. Deliberately not
// spread from the row: password_hash and the token digests live on it.
function publicUser(user) {
  const { id, name, email, photo, role, provider, created_at, last_login, directory_id } = user;
  // `areas` is what the client shows Add/Edit buttons from. The server checks
  // it again on every write — this is only what the screen is allowed to offer.
  return {
    id, name, email, photo, role, provider, created_at, last_login, directory_id, areas: effectiveAreas(user),
    // An address they asked to add, still waiting on its confirmation link.
    pending_email: user.pending_email || '',
  };
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

function sentTooRecently(user, column = 'email_verify_sent_at') {
  if (!user[column]) return false;
  const sent = Date.parse(`${user[column].replace(' ', 'T')}Z`);
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
     WHERE email_verify_hash <> '' AND email_verify_hash = ?
  `).get(hashToken(token));

  if (!user) {
    // Either the link is wrong, or it has already been used. An account that
    // is confirmed already should not be told its link is broken.
    return back('verify_error=invalid');
  }

  const expired = db.prepare("SELECT datetime('now') > ? AS expired").get(user.email_verify_expires_at).expired;
  if (expired) return back('verify_error=expired');

  if (user.provider !== 'local') return addConfirmedAddress(user, back);

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

// ─── Adding an address to a Google or Facebook account ────────────────────────
//
// Facebook gives no email address for somebody who joined it with a phone
// number, or who declined to share it. Such an account cannot be matched to the
// directory or told when it is approved, so the waiting page asks for one. It
// only becomes the account's address once its owner opens the link we mail to
// it — the same confirmation an email-and-password account goes through.

const ADDRESS_LINK_SENT = email =>
  `We have sent a link to ${email}. Open it to add the address to your account.`;

router.post('/add-email', requireAuth, limitResend, (req, res) => {
  const user  = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const email = normalizeEmail(req.body?.email);

  // The address has to be the member's own, so an admin viewing the portal as
  // them cannot add one on their behalf.
  if (req.impersonator) {
    return res.status(403).json({ success: false, error: 'Only they can add an email address to their account.' });
  }
  if (user.provider === 'local' || user.email) {
    return res.status(400).json({ success: false, error: 'Your account already has an email address.' });
  }
  if (!isEmailAddress(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }
  // Asking again for the same address within a couple of minutes changes
  // nothing, so the button cannot be used to fill somebody's mailbox.
  if (email === user.pending_email && sentTooRecently(user)) {
    return res.json({ success: true, pending_email: email, message: ADDRESS_LINK_SENT(email) });
  }

  // An address another account already has is never added to this one. Its
  // owner alone is told, so the answer here is the same either way and the form
  // cannot be used to find out who has an account.
  const other = anyAccountFor(email);
  if (other && other.id !== user.id) {
    accountMail.addressAlreadyInUse({ email, name: other.name, provider: other.provider, via: user.provider });
  } else {
    const { token, hash } = createToken();
    db.prepare(`
      UPDATE users
         SET pending_email = ?,
             email_verify_hash = ?,
             email_verify_expires_at = datetime('now', ?),
             email_verify_sent_at = datetime('now')
       WHERE id = ?
    `).run(email, hash, `+${VERIFY_TTL_HOURS} hours`, user.id);
    accountMail.confirmAddedAddress({ name: user.name, email, token, via: user.provider });
  }
  res.json({ success: true, pending_email: email, message: ADDRESS_LINK_SENT(email) });
});

// The link in that email, opened: the address becomes the account's own, and
// the account is matched to the directory by it if it is not linked already.
// Somebody else may have taken the address since the link was sent, in which
// case nothing is added.
function addConfirmedAddress(user, back) {
  const email = user.pending_email;
  const other = email && anyAccountFor(email);
  if (!email || (other && other.id !== user.id)) {
    db.prepare(`
      UPDATE users SET pending_email = '', email_verify_hash = '', email_verify_expires_at = NULL WHERE id = ?
    `).run(user.id);
    return back(email ? 'verify_error=taken' : 'verify_error=invalid');
  }

  db.prepare(`
    UPDATE users
       SET email = ?,
           pending_email = '',
           email_verified_at = datetime('now'),
           email_verify_hash = '',
           email_verify_expires_at = NULL,
           directory_id = coalesce(directory_id, ?)
     WHERE id = ?
  `).run(email, findPersonByEmail(email), user.id);
  return back('verified=added');
}

// ─── POST /forgot-password ────────────────────────────────────────────────────
//
// Mails a one-time link to choose a new password. Only the digest is kept, a
// newer link replaces an older one, and the link lasts an hour. An address that
// signs in with Google or Facebook is told so instead, since it has no password
// here; an unknown address gets nothing. The answer is the same in every case.

router.post('/forgot-password', limitForgot, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isEmailAddress(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }

  const local = localAccountFor(email);
  if (local) {
    if (!sentTooRecently(local, 'password_reset_sent_at')) {
      const { token, hash } = createToken();
      db.prepare(`
        UPDATE users
           SET password_reset_hash = ?,
               password_reset_expires_at = datetime('now', ?),
               password_reset_sent_at = datetime('now')
         WHERE id = ?
      `).run(hash, `+${accountMail.RESET_TTL_MINUTES} minutes`, local.id);
      accountMail.resetPassword({ name: local.name, email: local.email, token });
    }
  } else {
    const other = anyAccountFor(email);
    if (other && !sentTooRecently(other, 'password_reset_sent_at')) {
      db.prepare("UPDATE users SET password_reset_sent_at = datetime('now') WHERE id = ?").run(other.id);
      accountMail.noPasswordToReset({ name: other.name, email, provider: other.provider });
    }
  }

  res.json({ success: true, message: RESET_SENT });
});

// ─── POST /reset-password  { token, password } ────────────────────────────────
//
// Sets the new password from the link, and clears any lockout from guessing at
// the old one. It does not sign them in, and it changes nothing else: an
// address still to be confirmed, or an account still waiting for approval, is
// exactly where it was.

router.post('/reset-password', limitReset, asyncRoute(async (req, res) => {
  const token    = String(req.body?.token ?? '');
  const password = req.body?.password;

  const user = token && db.prepare(`
    SELECT * FROM users
     WHERE provider = 'local' AND password_reset_hash <> '' AND password_reset_hash = ?
  `).get(hashToken(token));

  const dead = () => res.status(400).json({
    success: false, code: 'reset_invalid',
    error: 'That link to choose a new password is no longer valid. It may have expired or already been used — ask for a new one below.',
  });
  if (!user) return dead();
  if (db.prepare("SELECT datetime('now') > ? AS expired").get(user.password_reset_expires_at).expired) return dead();

  const problem = passwordProblem(password, { email: user.email, name: user.name });
  if (problem) return res.status(400).json({ success: false, error: problem });

  const digest = await hashPassword(password);
  db.prepare(`
    UPDATE users
       SET password_hash = ?,
           password_reset_hash = '',
           password_reset_expires_at = NULL,
           failed_logins = 0,
           locked_until = NULL
     WHERE id = ?
  `).run(digest, user.id);

  res.json({ success: true, message: 'Your password has been changed. Please sign in with it.' });
}));

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
  // An account still waiting for approval signs in like any other, but sees
  // only the page saying so, with the admins it can contact (limitPending).

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

router.get('/providers', (req, res) => {
  res.json({ success: true, providers: PROVIDERS });
});

// What the sign-in page is told when a provider sign-in finds nobody: why, if
// it is a join waiting on (or refused by) an admin, otherwise just which
// provider failed.
function authErrorFor(provider, info) {
  return Object.prototype.hasOwnProperty.call(LINK_REFUSALS, info?.code) ? info.code : provider;
}

// An old link or bookmark to a provider that is not set up goes back to the
// sign-in page with that provider's error, rather than ending in passport's
// "Unknown authentication strategy".
const ifConfigured = provider => (req, res, next) =>
  PROVIDERS.includes(provider) ? next() : res.redirect(`${CLIENT_URL}/?auth_error=${provider}`);

router.get('/google', ifConfigured('google'),
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback', ifConfigured('google'), (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    if (err) {
      console.error('[auth] Google error:', err.message);
      return res.redirect(`${CLIENT_URL}/?auth_error=google`);
    }
    if (!user) {
      console.log('[auth] Google: no user —', info?.message ?? 'unknown reason');
      return res.redirect(`${CLIENT_URL}/?auth_error=${authErrorFor('google', info)}`);
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

// `rerequest` asks again for the email permission if somebody declined it last
// time; without an address their account cannot be matched to the directory.
router.get('/facebook', ifConfigured('facebook'),
  passport.authenticate('facebook', { scope: ['email'], authType: 'rerequest' })
);

router.get('/facebook/callback', ifConfigured('facebook'), (req, res, next) => {
  passport.authenticate('facebook', (err, user, info) => {
    if (err) {
      console.error('[auth] Facebook error:', err.message);
      return res.redirect(`${CLIENT_URL}/?auth_error=facebook`);
    }
    if (!user) {
      console.log('[auth] Facebook: no user —', info?.message ?? 'unknown reason');
      return res.redirect(`${CLIENT_URL}/?auth_error=${authErrorFor('facebook', info)}`);
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
  res.json({
    success: true,
    user: publicUser(req.user),
    // Present only while an admin is viewing the portal as this member. The
    // client draws its banner from this, and it is the admin's own account —
    // never the one being viewed as.
    impersonatedBy: req.impersonator
      ? { id: req.impersonator.id, name: req.impersonator.name, since: req.user.impersonationStartedAt || null }
      : null,
  });
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

// The other ways an account signs in, beyond the one it was made with — so an
// admin can see that the Google sign-in and the password account are one person.
const LINKED_PROVIDERS_SQL =
  "(SELECT group_concat(provider) FROM (SELECT DISTINCT provider FROM user_identities i WHERE i.user_id = u.id AND i.status = 'approved' AND i.provider <> u.provider ORDER BY provider)) AS linked_providers";

function withLinkedProviders(row) {
  return { ...row, linked_providers: row.linked_providers ? row.linked_providers.split(',') : [] };
}

function userRow(id) {
  const user = db.prepare(`
    SELECT u.id, u.provider, u.email, u.name, u.photo, u.role, u.created_at, u.last_login,
           u.directory_id, u.email_verified_at, d.name AS directory_name, ${LINKED_PROVIDERS_SQL}
      FROM users u LEFT JOIN directory d ON d.id = u.directory_id
     WHERE u.id = ?
  `).get(id);
  return { ...withLinkedProviders(user), is_owner: isOwner(user), areas: effectiveAreas(user) };
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

  // An approval may hand out areas of responsibility at the same time, so a
  // new song leader does not have to be approved and then edited again.
  if (Array.isArray(body.areas)) setAreas(target.id, body.areas.filter(isArea));

  const user = userRow(target.id);
  actionLog.record(actor, {
    area:     'accounts',
    action:   'update',
    entity:   'account',
    entityId: target.id,
    summary:  `Approved ${target.name} as ${role}${user.areas.length ? ` looking after ${user.areas.map(areaLabel).join(', ')}` : ''}`,
    details:  { role, directory_id: person.id, areas: user.areas },
  });
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

  if (target.role !== role) {
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, target.id);
    // Admins hold every area through the role itself, so grants made while they
    // were a member would quietly come back on a demotion. Clear them instead.
    if (role === 'admin' || role === 'pending') setAreas(target.id, []);
    actionLog.record(actor, {
      area:     'accounts',
      action:   'update',
      entity:   'account',
      entityId: target.id,
      summary:  `Changed ${target.name} from ${target.role} to ${role}`,
      details:  { from: target.role, to: role },
    });
  }

  return { status: 200, body: { success: true, user: userRow(target.id) } };
}

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.provider, u.email, u.name, u.photo, u.role, u.created_at, u.last_login,
           u.directory_id, u.email_verified_at, u.approved_at, d.name AS directory_name,
           ${LINKED_PROVIDERS_SQL}
    FROM users u LEFT JOIN directory d ON d.id = u.directory_id
    ORDER BY u.role ASC, u.created_at ASC
  `).all().map(u => ({ ...withLinkedProviders(u), is_owner: isOwner(u), areas: effectiveAreas(u) }));
  res.json({ success: true, users, roles: ROLES, areas: AREAS });
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

// ─── Viewing the portal as a member ───────────────────────────────────────────
//
// "The Add button is missing for me" is the hardest kind of report to answer
// from an admin account, because an admin holds every area and every page is
// full. This lets an admin see exactly what one member sees.
//
// Starting it is admin-only and refuses another admin; stopping it answers to
// the real account rather than the borrowed one, so it can always be undone.
// Every change made while it is on is recorded against the admin.

router.post('/impersonate', requireAuth, (req, res) => {
  // While viewing as somebody else, req.user is the member — the admin is on
  // req.impersonator. Starting a second one from inside the first would lose
  // track of who is really here, so it is refused rather than nested.
  if (req.impersonator) {
    return res.status(409).json({
      success: false,
      error: `You are already viewing the portal as ${req.user.name}. Stop that first.`,
    });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const targetId = Number(req.body?.userId);
  if (!Number.isInteger(targetId)) {
    return res.status(400).json({ success: false, error: 'userId must be a number' });
  }

  const target  = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  const problem = impersonationProblem(req.user, target);
  if (problem) return res.status(target ? 400 : 404).json({ success: false, error: problem });

  req.session.impersonate = { userId: target.id, startedAt: new Date().toISOString() };

  actionLog.record(req.user, {
    area:     'impersonation',
    action:   'other',
    entity:   'account',
    entityId: target.id,
    summary:  `${req.user.name} started viewing the portal as ${target.name}`,
    details:  { viewing: { id: target.id, name: target.name, role: target.role } },
  });

  res.json({ success: true, user: publicUser(userRow(target.id)) });
});

router.delete('/impersonate', requireAuth, (req, res) => {
  // Answered as the real admin: the borrowed account has no say in giving
  // itself back.
  const admin = req.impersonator;
  if (!admin) {
    return res.status(400).json({ success: false, error: 'You are not viewing the portal as anybody.' });
  }

  const viewedAs = req.user;
  const since    = viewedAs.impersonationStartedAt;
  delete req.session.impersonate;

  actionLog.record(admin, {
    area:     'impersonation',
    action:   'other',
    entity:   'account',
    entityId: viewedAs.id,
    summary:  `${admin.name} stopped viewing the portal as ${viewedAs.name}`,
    details:  { viewing: { id: viewedAs.id, name: viewedAs.name }, since },
  });

  res.json({ success: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(admin.id)) });
});

// ─── What this account looks after ────────────────────────────────────────────
//
// Areas are not a ladder: each one is the Add/Edit/Delete buttons on one part
// of the site, and holding one says nothing about the others. The body carries
// the whole set the account should hold, not a change to it.

router.patch('/users/:id/areas', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });

  const wanted = req.body?.areas;
  if (!Array.isArray(wanted)) {
    return res.status(400).json({ success: false, error: 'areas must be an array of area ids' });
  }
  const unknown = wanted.filter(a => !isArea(a));
  if (unknown.length) {
    return res.status(400).json({ success: false, error: `Unknown area: ${unknown.join(', ')}` });
  }

  if (target.role === 'admin') {
    return res.status(400).json({
      success: false,
      error: 'Admins already look after every area. Make them a member first to hand out areas one at a time.',
    });
  }
  if (target.role === 'pending') {
    return res.status(400).json({
      success: false,
      error: 'Approve this account first — an area means nothing until they can sign in.',
    });
  }

  const before = areasFor(target.id);
  setAreas(target.id, wanted);
  const after = areasFor(target.id);

  const added   = after.filter(a => !before.includes(a));
  const removed = before.filter(a => !after.includes(a));
  if (added.length || removed.length) {
    actionLog.record(req.user, {
      area:     'accounts',
      action:   'update',
      entity:   'account',
      entityId: target.id,
      summary:  [
        added.length   ? `gave ${target.name} ${added.map(areaLabel).join(', ')}`     : '',
        removed.length ? `took ${removed.map(areaLabel).join(', ')} from ${target.name}` : '',
      ].filter(Boolean).join('; '),
      details:  { added, removed, areas: after },
    });
    // What they now look after is what the church will be counting on them
    // for; what was taken away, they should not go on doing.
    const describe = id => {
      const area = AREAS.find(a => a.id === id);
      return area ? `${area.label} (${area.page}) — ${area.description}` : areaLabel(id);
    };
    notices.areas([{ userId: target.id }], {
      kind: 'areas-changed', page: 'how-it-works', params: {}, actor: req.user,
      subject: added.length
        ? `You now look after ${added.map(areaLabel).join(', ')} on the member portal`
        : `You no longer look after ${removed.map(areaLabel).join(', ')} on the member portal`,
      lines: [
        ...(added.length ? [`${req.user.name} has asked you to look after:`, '', ...added.map(a => `  • ${describe(a)}`), '',
          'You will see the buttons for it on those pages (and under Church Office, where it has a page there). How It Works explains each one.'] : []),
        ...(removed.length ? [`${added.length ? '\n' : ''}${req.user.name} has taken ${removed.map(areaLabel).join(', ')} off your account, so you no longer need to look after ${removed.length === 1 ? 'it' : 'them'}.`] : []),
      ],
      why: 'an admin changed what you look after on the member portal',
    }, `${target.id}:changed`);
  }

  res.json({ success: true, user: userRow(target.id) });
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

// ─── Joining a second sign-in to an existing account ──────────────────────────
//
// A Google or Facebook sign-in that turns up on an address an account already
// has waits here until an admin says it is the same person (see requestLink).
// Approving gives that sign-in everything the account can see and do, so it is
// a decision for somebody other than the account holder: an admin can decline
// a request on their own account, but never approve one.

const PROVIDER_LABEL = { google: 'Google', facebook: 'Facebook', local: 'email and password' };

function linkRequestRow(id) {
  return db.prepare(`
    SELECT i.id, i.provider, i.email, i.status, i.created_at, i.decided_at,
           i.user_id, u.name AS account_name, u.email AS account_email,
           u.provider AS account_provider, u.role AS account_role,
           d.name AS decided_by_name
      FROM user_identities i
      JOIN users u ON u.id = i.user_id
      LEFT JOIN users d ON d.id = i.decided_by
     WHERE i.id = ?
  `).get(id);
}

router.get('/link-requests', requireAuth, requireAdmin, (req, res) => {
  const status = ['pending', 'approved', 'declined'].includes(req.query.status) ? req.query.status : 'pending';
  const ids = db.prepare('SELECT id FROM user_identities WHERE status = ? ORDER BY created_at ASC, id ASC').all(status);
  res.json({ success: true, requests: ids.map(r => linkRequestRow(r.id)) });
});

// Looks up a request an admin is about to decide on. Returns { request } or
// { status, error }.
function pendingLinkRequest(id) {
  const request = linkRequestRow(id);
  if (!request) return { status: 404, error: 'That sign-in request was not found.' };
  if (request.status !== 'pending') {
    return { status: 409, error: `That sign-in request has already been ${request.status}.` };
  }
  return { request };
}

router.patch('/link-requests/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const { request, status, error } = pendingLinkRequest(req.params.id);
  if (error) return res.status(status).json({ success: false, error });

  if (String(request.user_id) === String(req.user.id)) {
    return res.status(403).json({
      success: false,
      error: 'You cannot approve a sign-in joining your own account. Another admin has to confirm it is you.',
    });
  }

  const { user } = completeLink(request.id, req.user.id);
  actionLog.record(req.user, {
    area:     'accounts',
    action:   'update',
    entity:   'account',
    entityId: user.id,
    summary:  `Joined a ${PROVIDER_LABEL[request.provider] || request.provider} sign-in (${request.email}) to ${user.name}'s account`,
    details:  { identity: request.id, provider: request.provider, email: request.email },
  });
  accountMail.linkApproved({ account: user, provider: request.provider });

  res.json({ success: true, request: linkRequestRow(request.id), user: userRow(user.id) });
});

router.patch('/link-requests/:id/decline', requireAuth, requireAdmin, (req, res) => {
  const { request, status, error } = pendingLinkRequest(req.params.id);
  if (error) return res.status(status).json({ success: false, error });

  db.prepare(`
    UPDATE user_identities
       SET status = 'declined', decided_at = datetime('now'), decided_by = ?
     WHERE id = ?
  `).run(req.user.id, request.id);
  actionLog.record(req.user, {
    area:     'accounts',
    action:   'update',
    entity:   'account',
    entityId: request.user_id,
    summary:  `Declined joining a ${PROVIDER_LABEL[request.provider] || request.provider} sign-in (${request.email}) to ${request.account_name}'s account`,
    details:  { identity: request.id, provider: request.provider, email: request.email },
  });

  res.json({ success: true, request: linkRequestRow(request.id) });
});

// Forgets a request, whatever was decided, so that sign-in starts over next
// time — asking again if its address still matches. Also how a joined sign-in
// is taken off an account.
router.delete('/link-requests/:id', requireAuth, requireAdmin, (req, res) => {
  const request = linkRequestRow(req.params.id);
  if (!request) return res.status(404).json({ success: false, error: 'That sign-in request was not found.' });

  db.prepare('DELETE FROM user_identities WHERE id = ?').run(request.id);
  actionLog.record(req.user, {
    area:     'accounts',
    action:   'delete',
    entity:   'account',
    entityId: request.user_id,
    summary:  `Removed the ${PROVIDER_LABEL[request.provider] || request.provider} sign-in (${request.email}) from ${request.account_name}'s account`,
    details:  { identity: request.id, provider: request.provider, email: request.email, was: request.status },
  });
  res.json({ success: true });
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
  actionLog.record(req.user, {
    area:     'accounts',
    action:   'delete',
    entity:   'account',
    entityId: target.id,
    summary:  `Removed ${target.name} from the portal`,
    details:  { email: target.email, role: target.role },
  });
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
  limitForgot.reset();
  limitReset.reset();
};
