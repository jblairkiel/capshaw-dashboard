const {
  requireAuth, requireApproved, requireAdmin, requireRole, requireSiteAuth, isPublicApiPath,
  hasRole, isRole, ROLES,
  AREAS, AREA_IDS, isArea, holdsArea, holds, requireArea, requireAnyArea, effectiveAreas,
} = require('../middleware/auth');

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

// ─── Role model ───────────────────────────────────────────────────────────────

describe('role model', () => {
  test('ROLES is ordered from least to most privileged', () => {
    expect(ROLES).toEqual(['pending', 'approved', 'admin']);
  });

  test('isRole accepts known roles and rejects anything else', () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole('toString')).toBe(false);
  });

  test('the old worship-coordinator rung is gone', () => {
    expect(isRole('worship-coordinator')).toBe(false);
    expect(hasRole({ role: 'worship-coordinator' }, 'approved')).toBe(false);
  });

  test('hasRole compares ranks rather than exact roles', () => {
    expect(hasRole({ role: 'admin' },    'approved')).toBe(true);
    expect(hasRole({ role: 'approved' }, 'approved')).toBe(true);
    expect(hasRole({ role: 'pending' },  'approved')).toBe(false);
    expect(hasRole({ role: 'approved' }, 'admin')).toBe(false);
    expect(hasRole({ role: 'bogus' },    'pending')).toBe(false);
    expect(hasRole(null,                 'pending')).toBe(false);
  });

  test('requireRole builds a middleware for any minimum role', () => {
    const mw   = requireRole('admin', 'Nope');
    const res  = mockRes();
    const next = jest.fn();
    mw({ user: { id: 1, role: 'approved' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Nope' });
  });
});

// ─── requireSiteAuth ─────────────────────────────────────────────────────────

describe('requireSiteAuth', () => {
  const gate = (path, user = null) => {
    const res  = mockRes();
    const next = jest.fn();
    requireSiteAuth({ path, user }, res, next);
    return { res, next };
  };

  test('lets the sign-in flow through while signed out', () => {
    for (const path of ['/auth', '/auth/me', '/auth/google', '/auth/google/callback', '/health']) {
      const { res, next } = gate(path);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  test('refuses every other API path while signed out', () => {
    for (const path of ['/members/data', '/announcements', '/songs', '/profile/me', '/workflows']) {
      const { res, next } = gate(path);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });

  test('lets a signed-in member through anywhere', () => {
    const { res, next } = gate('/members/data', { id: 1, role: 'pending' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('a path that merely starts with a public name is not public', () => {
    for (const path of ['/authors', '/health-records']) {
      expect(isPublicApiPath(path)).toBe(false);
      expect(gate(path).next).not.toHaveBeenCalled();
    }
  });
});

// ─── Areas of responsibility ──────────────────────────────────────────────────
//
// Areas are deliberately not a ladder: holding one says nothing whatever about
// the others, which is the whole point of splitting them out of the role.

describe('areas', () => {
  const songLeader = { id: 5, role: 'approved', areas: ['songs'] };
  const admin      = { id: 1, role: 'admin' };
  const member     = { id: 6, role: 'approved', areas: [] };

  test('every area in the catalogue is a known area', () => {
    expect(AREAS.length).toBeGreaterThan(0);
    for (const area of AREAS) {
      expect(isArea(area.id)).toBe(true);
      expect(area.label).toBeTruthy();
      expect(area.description).toBeTruthy();
    }
    expect(AREA_IDS).toEqual(AREAS.map(a => a.id));
    expect(isArea('everything')).toBe(false);
  });

  test('holding one area grants nothing else', () => {
    expect(holdsArea(songLeader, 'songs')).toBe(true);
    expect(holdsArea(songLeader, 'announcements')).toBe(false);
    expect(holdsArea(songLeader, 'attendance')).toBe(false);
    expect(holdsArea(member, 'songs')).toBe(false);
  });

  test('an admin holds every area without any being granted', () => {
    for (const area of AREA_IDS) expect(holdsArea(admin, area)).toBe(true);
    expect(effectiveAreas(admin)).toEqual(AREA_IDS);
  });

  test('a pending account holds nothing, whatever it was granted', () => {
    const waiting = { id: 7, role: 'pending', areas: ['songs', 'attendance'] };
    expect(holdsArea(waiting, 'songs')).toBe(false);
    expect(effectiveAreas(waiting)).toEqual([]);
  });

  test('holds() answers for an area or a role rung', () => {
    expect(holds(songLeader, 'songs')).toBe(true);
    expect(holds(songLeader, 'approved')).toBe(true);
    expect(holds(songLeader, 'admin')).toBe(false);
    expect(holds(member, 'songs')).toBe(false);
  });

  test('requireArea lets the holder through and names the area to everyone else', () => {
    const mw = requireArea('songs');

    const ok = jest.fn();
    mw({ user: songLeader }, mockRes(), ok);
    expect(ok).toHaveBeenCalledTimes(1);

    const res  = mockRes();
    const next = jest.fn();
    mw({ user: member }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].error).toMatch(/Song Tracker/);

    const anon = mockRes();
    mw({ user: null }, anon, jest.fn());
    expect(anon.status).toHaveBeenCalledWith(401);
  });

  test('requireAnyArea accepts a holder of either area', () => {
    const mw = requireAnyArea(['announcements', 'calendar']);

    const next = jest.fn();
    mw({ user: { id: 8, role: 'approved', areas: ['calendar'] } }, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);

    const res = mockRes();
    mw({ user: member }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
