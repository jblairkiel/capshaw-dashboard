// ─── /api/auth/two-step ───────────────────────────────────────────────────────
//
// The second step of signing in, and setting it up. See server/lib/twoStep.js
// for who has to use it and how somebody without their phone gets back in.
//
// The session carries two things here, never the account itself:
//   twoStepPending — the first step (password, Google or Facebook) passed, the
//                    code has not been typed yet. Nobody is signed in.
//   twoStepSetup   — a new secret, shown as a QR code, waiting for the first
//                    code from the app to prove it was scanned correctly.
// and twoStepOk once a code has been accepted in this session, which is what
// server/middleware/twoStep.js looks for.
const express = require('express');
const QRCode  = require('qrcode');
const db = require('../db');
const totp = require('../lib/totp');
const twoStep = require('../lib/twoStep');
const actionLog = require('../lib/actionLog');
const { rateLimit } = require('../middleware/rateLimit');

// How long somebody has to type the code after their password, and how many
// wrong codes they get before they must start again from the password.
const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_MAX_TRIES = 5;
// How long a QR code waits to be scanned.
const SETUP_TTL_MS = 15 * 60 * 1000;

const WRONG_CODE = 'That code did not work. Check the time on your phone is right and try the newest code, or use one of your recovery codes.';

const limitVerify = rateLimit({ max: 20, message: 'Too many attempts just now. Please wait a few minutes and try again.' });
const limitManage = rateLimit({ max: 20, message: 'Too many attempts just now. Please wait a few minutes and try again.' });

// The first step passed for an account with two-step sign-in on: remember who,
// sign nobody in. A fresh session id first, as for any sign-in.
function startSecondStep(req, user, regenerateSession, done) {
  regenerateSession(req, err => {
    if (err) return done(err);
    req.session.twoStepPending = { userId: user.id, at: Date.now(), tries: 0 };
    done(null);
  });
}

function pendingOf(req) {
  const pending = req.session?.twoStepPending;
  if (!pending) return null;
  if (Date.now() - pending.at > PENDING_TTL_MS) {
    delete req.session.twoStepPending;
    return null;
  }
  return pending;
}

function createTwoStepRouter({ publicUser, regenerateSession }) {
  const router = express.Router();

  // Setting up and turning off are about the real account, so they are refused
  // while an admin is viewing the portal as a member.
  function ownAccount(req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
    if (req.impersonator) {
      return res.status(403).json({ success: false, error: 'Stop viewing as a member first. Two-step sign-in is changed from your own account.' });
    }
    next();
  }

  function freshUser(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  // ── The second step of signing in ─────────────────────────────────────────

  router.post('/verify', limitVerify, (req, res, next) => {
    const pending = pendingOf(req);
    if (!pending) {
      return res.status(401).json({ success: false, code: 'two_step_expired', error: 'That sign-in has timed out. Please sign in again.' });
    }
    const user = freshUser(pending.userId);
    if (!user || !twoStep.isEnabled(user)) {
      delete req.session.twoStepPending;
      return res.status(401).json({ success: false, code: 'two_step_expired', error: 'Please sign in again.' });
    }

    const how = twoStep.check(user, req.body?.code);
    if (!how) {
      pending.tries += 1;
      if (pending.tries >= PENDING_MAX_TRIES) {
        delete req.session.twoStepPending;
        return res.status(401).json({ success: false, code: 'two_step_expired', error: 'Too many wrong codes. Please sign in again.' });
      }
      return res.status(401).json({ success: false, code: 'two_step_wrong', error: WRONG_CODE });
    }

    regenerateSession(req, regenErr => {
      if (regenErr) return next(regenErr);
      req.logIn(user, err => {
        if (err) return next(err);
        req.session.twoStepOk = true;
        db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
        if (how === 'recovery') {
          actionLog.record(user, {
            area: 'accounts', action: 'other', entity: 'account', entityId: user.id,
            summary: `${user.name} signed in with a recovery code`,
            details: { recovery_codes_left: twoStep.recoveryLeft(user.id) },
          });
        }
        res.json({ success: true, user: publicUser(freshUser(user.id)), used: how });
      });
    });
  });

  router.post('/cancel', (req, res) => {
    if (req.session) delete req.session.twoStepPending;
    res.json({ success: true });
  });

  // ── Setting it up ─────────────────────────────────────────────────────────

  router.post('/setup', ownAccount, limitManage, async (req, res, next) => {
    try {
      const user = freshUser(req.user.id);
      if (twoStep.isEnabled(user)) {
        return res.status(409).json({ success: false, error: 'Two-step sign-in is already on for your account.' });
      }
      const secret = totp.generateSecret();
      const uri = totp.otpauthUri(secret, user.email || user.name);
      req.session.twoStepSetup = { secret, at: Date.now() };
      const qr = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      // The secret is shown as well as the QR code, in groups of four, for
      // anybody setting it up on the same phone they are reading this on.
      res.json({ success: true, secret: secret.match(/.{1,4}/g).join(' '), uri, qr });
    } catch (err) {
      next(err);
    }
  });

  router.post('/enable', ownAccount, limitManage, (req, res) => {
    const setup = req.session?.twoStepSetup;
    if (!setup || Date.now() - setup.at > SETUP_TTL_MS) {
      return res.status(400).json({ success: false, code: 'setup_expired', error: 'That QR code has expired. Please start again.' });
    }
    const user = freshUser(req.user.id);
    if (twoStep.isEnabled(user)) {
      return res.status(409).json({ success: false, error: 'Two-step sign-in is already on for your account.' });
    }
    const codes = twoStep.enable(user, setup.secret, req.body?.code);
    if (!codes) {
      return res.status(400).json({ success: false, code: 'two_step_wrong', error: 'That code did not match. Type the six digits your app shows now.' });
    }
    delete req.session.twoStepSetup;
    // This session has just proved it holds the phone.
    req.session.twoStepOk = true;
    actionLog.record(req.user, {
      area: 'accounts', action: 'update', entity: 'account', entityId: user.id,
      summary: `${user.name} turned on two-step sign-in`,
    });
    res.json({ success: true, recoveryCodes: codes, user: publicUser(freshUser(user.id)) });
  });

  // ── Once it is on ─────────────────────────────────────────────────────────

  function requireCode(req, res, next) {
    const user = freshUser(req.user.id);
    if (!twoStep.isEnabled(user)) {
      return res.status(400).json({ success: false, error: 'Two-step sign-in is not on for your account.' });
    }
    if (!twoStep.check(user, req.body?.code)) {
      return res.status(400).json({ success: false, code: 'two_step_wrong', error: WRONG_CODE });
    }
    req.account = freshUser(user.id);
    next();
  }

  router.post('/recovery-codes', ownAccount, limitManage, requireCode, (req, res) => {
    const codes = twoStep.issueRecoveryCodes(req.account.id);
    actionLog.record(req.user, {
      area: 'accounts', action: 'update', entity: 'account', entityId: req.account.id,
      summary: `${req.account.name} made new two-step recovery codes`,
    });
    res.json({ success: true, recoveryCodes: codes, user: publicUser(freshUser(req.account.id)) });
  });

  router.post('/disable', ownAccount, limitManage, (req, res, next) => {
    if (twoStep.isRequired(freshUser(req.user.id))) {
      return res.status(403).json({
        success: false,
        error: 'Two-step sign-in has to stay on for admins and directory managers. If you have lost your phone, another admin can reset it for you.',
      });
    }
    next();
  }, requireCode, (req, res) => {
    twoStep.disable(req.account.id);
    delete req.session.twoStepOk;
    actionLog.record(req.user, {
      area: 'accounts', action: 'update', entity: 'account', entityId: req.account.id,
      summary: `${req.account.name} turned off two-step sign-in`,
    });
    res.json({ success: true, user: publicUser(freshUser(req.account.id)) });
  });

  router.resetRateLimits = () => { limitVerify.reset(); limitManage.reset(); };
  return router;
}

module.exports = { createTwoStepRouter, startSecondStep, pendingOf, PENDING_TTL_MS, PENDING_MAX_TRIES };
