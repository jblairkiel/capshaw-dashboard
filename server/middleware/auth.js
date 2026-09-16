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

// ─── Site-wide gate ───────────────────────────────────────────────────────────
// The portal is for our church family only: nothing is readable until you have
// signed in. These are the only paths that stay open, because without them
// nobody could ever sign in or be health-checked.
//
// Paths are matched relative to the mount point (`app.use('/api', …)`), so
// '/auth' covers '/api/auth/google' and its OAuth callbacks.
const PUBLIC_API_PATHS = ['/auth', '/health'];

function isPublicApiPath(pathname) {
  return PUBLIC_API_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

function requireSiteAuth(req, res, next) {
  if (isPublicApiPath(req.path)) return next();
  return requireAuth(req, res, next);
}

const requireApproved = requireRole('approved', 'Account pending approval');
const requireAdmin    = requireRole('admin',    'Admin access required');

module.exports = {
  ROLES, ROLE_RANK, isRole, rankOf, hasRole, requireRole,
  requireAuth, requireApproved, requireAdmin,
  PUBLIC_API_PATHS, isPublicApiPath, requireSiteAuth,
};
