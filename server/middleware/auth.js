function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

function requireApproved(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  if (req.user.role === 'pending') return res.status(403).json({ success: false, error: 'Account pending approval' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
  next();
}

module.exports = { requireAuth, requireApproved, requireAdmin };
