const express   = require('express');
const passport  = require('passport');
const { Strategy: GoogleStrategy }   = require('passport-google-oauth20');
const { Strategy: FacebookStrategy } = require('passport-facebook');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

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
      callbackURL:  '/api/auth/google/callback',
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
      callbackURL:  '/api/auth/facebook/callback',
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

const CLIENT_URL = process.env.NODE_ENV === 'production'
  ? 'https://capshaw.jblairkiel.com'
  : 'http://localhost:5173';

router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: `${CLIENT_URL}/?auth_error=google` }),
  (req, res) => res.redirect(CLIENT_URL)
);

router.get('/facebook',
  passport.authenticate('facebook', { scope: ['email'] })
);

router.get('/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: `${CLIENT_URL}/?auth_error=facebook` }),
  (req, res) => res.redirect(CLIENT_URL)
);

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

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT id, provider, email, name, photo, role, created_at, last_login FROM users ORDER BY role ASC, created_at ASC'
  ).all();
  res.json({ success: true, users });
});

router.patch('/users/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  if (target.role === 'admin') return res.status(400).json({ success: false, error: 'Cannot change admin role' });
  db.prepare('UPDATE users SET role=\'approved\' WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.patch('/users/:id/revoke', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  if (target.role === 'admin') return res.status(400).json({ success: false, error: 'Cannot revoke admin' });
  db.prepare('UPDATE users SET role=\'pending\' WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (String(req.params.id) === String(req.user.id)) {
    return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
  }
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
