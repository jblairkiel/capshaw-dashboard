// ─── Holding accounts to their second step ────────────────────────────────────
//
// Runs on every /api request, before the site-wide sign-in gate and before
// impersonation, so it always judges the real account.
//
//   · An account with two-step sign-in on, in a session that never passed the
//     code step (one signed in before it was turned on, say), is treated as
//     signed out. It has to sign in again, code and all.
//   · An account that has to use it (admins, directory managers) but has not
//     set it up reaches only what it takes to set it up: who am I, sign out,
//     and the two-step routes. Everything else answers 403 with
//     code 'two_step_setup_required', and the client shows the setup page.
const twoStep = require('../lib/twoStep');

const SETUP_API_PATHS = ['/health', '/auth/me', '/auth/logout', '/auth/two-step'];

function allowedDuringSetup(pathname) {
  return SETUP_API_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

function enforceTwoStep(req, res, next) {
  const user = req.user;
  if (!user) return next();

  if (twoStep.isEnabled(user) && !req.session?.twoStepOk) {
    if (req.session?.passport) delete req.session.passport.user;
    req.user = null;
    return next();
  }

  if (twoStep.isRequired(user) && !twoStep.isEnabled(user) && !allowedDuringSetup(req.path)) {
    return res.status(403).json({
      success: false,
      code:    'two_step_setup_required',
      error:   'Please set up two-step sign-in before going on.',
    });
  }
  return next();
}

module.exports = { enforceTwoStep, allowedDuringSetup, SETUP_API_PATHS };
