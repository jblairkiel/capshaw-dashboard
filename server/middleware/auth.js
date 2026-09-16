// ─── Who somebody is, and what they look after ────────────────────────────────
//
// Two separate questions, deliberately kept apart:
//
//   1. What is this account? — `role`, and it is a ladder:
//        pending   — signed in, read-only, waiting to be confirmed
//        approved  — a member: the member tools, and their own household
//        admin     — everything, including roles and every database table
//
//   2. What does this account look after? — areas, and they are not a ladder.
//      Holding the Song Tracker area gets you the Add buttons on Songs We Sing
//      and nothing else; it says nothing about announcements or attendance.
//      Admins hold every area implicitly. See server/lib/areas.js.
//
// The old 'worship-coordinator' rung is gone: it existed only to own the
// worship roster, which is now the Serving Schedule area. server/schema.js
// converts anybody who held it.
const {
  AREAS, AREA_IDS, isArea, areaLabel, areasFor, setAreas, effectiveAreas, holdsArea,
} = require('../lib/areas');

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

// The one check a workflow step or a route can make without caring which of the
// two vocabularies it was handed: an area id if it is one, otherwise a rung on
// the role ladder.
function holds(user, key) {
  return isArea(key) ? holdsArea(user, key) : hasRole(user, key);
}

function requireRole(minRole, message) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
    if (!hasRole(req.user, minRole)) return res.status(403).json({ success: false, error: message });
    next();
  };
}

// Gate for one area. The message names the area rather than saying "forbidden",
// because the usual cause is an admin not having granted it yet.
function requireArea(area, message) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
    if (!holdsArea(req.user, area)) {
      return res.status(403).json({
        success: false,
        error: message || `You do not look after ${areaLabel(area)}. Ask an admin if you should.`,
        area,
      });
    }
    next();
  };
}

// Same gate, for a route that serves several areas (the calendar and the
// announcement board both write announcements, for instance).
function requireAnyArea(areas, message) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
    if (!areas.some(a => holdsArea(req.user, a))) {
      return res.status(403).json({
        success: false,
        error: message || `You do not look after ${areas.map(areaLabel).join(' or ')}. Ask an admin if you should.`,
        areas,
      });
    }
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
  ROLES, ROLE_RANK, isRole, rankOf, hasRole, requireRole, holds,
  AREAS, AREA_IDS, isArea, areaLabel, areasFor, setAreas, effectiveAreas, holdsArea,
  requireArea, requireAnyArea,
  requireAuth, requireApproved, requireAdmin,
  PUBLIC_API_PATHS, isPublicApiPath, requireSiteAuth,
};
