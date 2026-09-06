const express   = require('express');
const passport  = require('passport');
const { Strategy: GoogleStrategy }   = require('passport-google-oauth20');
const { Strategy: FacebookStrategy } = require('passport-facebook');
const db = require('../db');
const { requireAuth, requireAdmin, ROLES, isRole } = require('../middleware/auth');

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
    return db.prepare('SELECT * FROM users WHERE id=?').get(existing.id);
  }

  const role = isAdmin ? 'admin' : 'pending';
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, photo, role, last_login) VALUES (?,?,?,?,?,?,datetime(\'now\'))'
  ).run(provider, profileId, email || null, name, photo || null, role);
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
  const { id, name, email, photo, role, provider, created_at, last_login } = req.user;
  res.json({ success: true, user: { id, name, email, photo, role, provider, created_at, last_login } });
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

// Shared by the role selector and the approve/revoke shortcuts. Returns an
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

  if (target.role !== role) db.prepare('UPDATE users SET role=? WHERE id=?').run(role, target.id);

  const user = db.prepare(
    'SELECT id, provider, email, name, photo, role, created_at, last_login FROM users WHERE id=?'
  ).get(target.id);
  return { status: 200, body: { success: true, user: { ...user, is_owner: isOwner(user) } } };
}

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT id, provider, email, name, photo, role, created_at, last_login FROM users ORDER BY role ASC, created_at ASC'
  ).all().map(u => ({ ...u, is_owner: isOwner(u) }));
  res.json({ success: true, users, roles: ROLES });
});

router.patch('/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const { status, body } = changeRole(req.user, req.params.id, req.body?.role);
  res.status(status).json(body);
});

router.patch('/users/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const { status, body } = changeRole(req.user, req.params.id, 'approved');
  res.status(status).json(body);
});

router.patch('/users/:id/revoke', requireAuth, requireAdmin, (req, res) => {
  const { status, body } = changeRole(req.user, req.params.id, 'pending');
  res.status(status).json(body);
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
