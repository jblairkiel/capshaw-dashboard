// ─── Viewing the portal as somebody else ──────────────────────────────────────
//
// An admin cannot see what a member sees. "The Add button is missing" and "the
// page is empty for me" are the two hardest things to answer from an admin
// account, because an admin holds every area and every page is full. So an
// admin may borrow a member's view of the site: the session stays theirs, but
// every request is answered as if the member had made it.
//
// Three things make that safe to have at all:
//
//   · Only an admin can start it, and only on an account that is not an admin —
//     so it can never be used to borrow another admin's standing, and never to
//     gain anything the admin did not already have.
//   · The real account is never lost. It stays in the session, it is what stops
//     it, and it is who the action history names.
//   · Everything done while it is on is recorded against the admin, saying who
//     they were acting as.
const db = require('../db');
const { effectiveAreas } = require('../lib/areas');

// Who may be borrowed. An admin's view is not somebody else's to wear, and
// there is nothing to learn from wearing your own.
function impersonationProblem(admin, target) {
  if (!admin || admin.role !== 'admin') return 'Only an admin can view the portal as somebody else.';
  if (!target)                          return 'That account no longer exists.';
  if (String(target.id) === String(admin.id)) return 'You are already signed in as yourself.';
  if (target.role === 'admin')          return 'An admin\'s view is not somebody else\'s to borrow. Only member accounts can be viewed as.';
  return null;
}

// Swaps req.user for the account being viewed as, keeping the real admin on
// req.impersonator. Runs after passport, so req.user is the signed-in account
// when it starts.
//
// The check is made again on every request rather than trusted from when it
// started: an account promoted to admin, or removed outright, stops being
// borrowable the moment that happens, without waiting for the session to end.
function applyImpersonation(req, res, next) {
  const active = req.session?.impersonate;
  if (!active || !req.user) return next();

  const admin  = req.user;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(active.userId);

  if (impersonationProblem(admin, target)) {
    delete req.session.impersonate;
    return next();
  }

  req.impersonator = admin;
  req.user = {
    ...target,
    areas: effectiveAreas(target),
    // Carried on the user itself so the action history names the admin behind
    // the change without every route having to know impersonation exists.
    impersonatedBy: { id: admin.id, name: admin.name, email: admin.email },
    impersonationStartedAt: active.startedAt,
  };
  return next();
}

module.exports = { applyImpersonation, impersonationProblem };
