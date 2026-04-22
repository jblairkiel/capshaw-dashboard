const { requireAuth, requireApproved, requireAdmin } = require('../middleware/auth');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

// ─── requireAuth ──────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  test('calls next() when req.user is set', () => {
    const req  = { user: { id: 1, role: 'approved' } };
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('responds 401 when req.user is falsy', () => {
    const req  = { user: null };
    const res  = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});

// ─── requireApproved ─────────────────────────────────────────────────────────

describe('requireApproved', () => {
  test('calls next() for role=approved', () => {
    const req  = { user: { id: 1, role: 'approved' } };
    const res  = mockRes();
    const next = jest.fn();
    requireApproved(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('calls next() for role=admin', () => {
    const req  = { user: { id: 2, role: 'admin' } };
    const res  = mockRes();
    const next = jest.fn();
    requireApproved(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('responds 403 for role=pending', () => {
    const req  = { user: { id: 3, role: 'pending' } };
    const res  = mockRes();
    const next = jest.fn();
    requireApproved(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('responds 401 when req.user is absent', () => {
    const req  = { user: undefined };
    const res  = mockRes();
    const next = jest.fn();
    requireApproved(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── requireAdmin ─────────────────────────────────────────────────────────────

describe('requireAdmin', () => {
  test('calls next() for role=admin', () => {
    const req  = { user: { id: 1, role: 'admin' } };
    const res  = mockRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('responds 403 for role=approved', () => {
    const req  = { user: { id: 2, role: 'approved' } };
    const res  = mockRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('responds 401 when req.user is absent', () => {
    const req  = { user: null };
    const res  = mockRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
