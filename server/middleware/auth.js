// ─── Role model ───────────────────────────────────────────────────────────────
// pending  — signed in, read-only
// approved — member: may use every member function (announcements, songs,
//            order of service, Bible class, lesson planner, documents)
// admin    — everything a member can do, plus user/role management and direct
//            editing of every database table via /api/admin

const ROLE_RANK = {
  pending:  0,
  approved: 1,
  admin:    2,
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
