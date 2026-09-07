// ─── Role model ───────────────────────────────────────────────────────────────
// pending             — signed in, read-only
// approved            — member: may use every member function (Bible class,
//                       lesson planner, site updates, their own household)
// worship-coordinator — a member who also builds the worship roster: owns the
//                       worship schedule workflow
// admin               — everything above, plus user/role management and direct
//                       editing of every database table via /api/admin
//
// Ranked, so an admin can always do a coordinator's job and a coordinator is
// always also a member.
const ROLE_RANK = {
  pending:               0,
  approved:              1,
  'worship-coordinator': 2,
  admin:                 3,
};

const ROLES = Object.keys(ROLE_RANK);

function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, role);
}

function rankOf(role) {
  return isRole(role) ? ROLE_RANK[role] : -1;
}

function hasRole(user, minRole) {
  return !!user && rankOf(user.role) >= ROLE_RANK[minRole];
}

function requireRole(minRole, message) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
    if (!hasRole(req.user, minRole)) return res.status(403).json({ success: false, error: message });
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

const requireApproved = requireRole('approved', 'Account pending approval');
const requireAdmin    = requireRole('admin',    'Admin access required');

module.exports = { ROLES, ROLE_RANK, isRole, rankOf, hasRole, requireRole, requireAuth, requireApproved, requireAdmin };
