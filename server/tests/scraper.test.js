require('dotenv').config();

const {
  parseCookies,
  cookieStr,
  mergeCookieStr,
  readData,
  fetchPage,
  getSession,
  runUpdate,
} = require('../routes/scraper');

const {
  parseJobAssignments,
  parseAttendance,
  parseSermons,
  parseVisitors,
  parseAnniversaries,
  parseDeacons,
  parseBulletins,
} = require('../lib/parsers');

// ─── Unit: cookie helpers ────────────────────────────────────────────────────

describe('parseCookies', () => {
  test('parses a single Set-Cookie string', () => {
    expect(parseCookies('session=abc123; Path=/; HttpOnly')).toEqual({ session: 'abc123' });
  });

  test('parses an array of Set-Cookie strings', () => {
    const result = parseCookies(['a=1; Path=/', 'b=2; Secure']);
    expect(result).toEqual({ a: '1', b: '2' });
  });

  test('returns empty object for undefined headers', () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  test('returns empty object for empty array', () => {
    expect(parseCookies([])).toEqual({});
  });

  test('handles cookies without attributes', () => {
    expect(parseCookies('token=xyz')).toEqual({ token: 'xyz' });
  });
});

describe('cookieStr', () => {
  test('converts object to cookie header string', () => {
    expect(cookieStr({ a: '1', b: '2' })).toBe('a=1; b=2');
  });

  test('returns empty string for empty object', () => {
    expect(cookieStr({})).toBe('');
  });
});

describe('mergeCookieStr', () => {
  test('merges new keys into existing string', () => {
    const result = mergeCookieStr('a=1; b=2', { c: '3' });
    expect(result).toContain('a=1');
    expect(result).toContain('b=2');
    expect(result).toContain('c=3');
  });

  test('overwrites existing key with new value', () => {
    const result = mergeCookieStr('a=1; b=old', { b: 'new' });
    expect(result).toContain('b=new');
    expect(result).not.toContain('b=old');
  });

  test('handles empty existing string', () => {
    expect(mergeCookieStr('', { a: '1' })).toBe('a=1');
  });

  test('handles null existing string', () => {
    expect(mergeCookieStr(null, { a: '1' })).toBe('a=1');
  });
});

// ─── Unit: readData ──────────────────────────────────────────────────────────

describe('readData', () => {
  const EXPECTED_KEYS = ['lastUpdated', 'jobAssignments', 'attendance', 'sermons', 'visitors', 'anniversaries', 'deacons', 'bulletins'];

  test('returns null or a valid data object', () => {
    const result = readData();
    if (result === null) {
      expect(result).toBeNull();
    } else {
      expect(typeof result).toBe('object');
    }
  });

  test('cached data has all expected top-level keys', () => {
    const result = readData();
    if (!result) return; // no cache yet — skip shape checks
    for (const key of EXPECTED_KEYS) {
      expect(result).toHaveProperty(key);
    }
  });

  test('jobAssignments has month string and assignments array', () => {
    const result = readData();
    if (!result) return;
    expect(typeof result.jobAssignments.month).toBe('string');
    expect(Array.isArray(result.jobAssignments.assignments)).toBe(true);
  });

  test('attendance is an array', () => {
    const result = readData();
    if (!result) return;
    expect(Array.isArray(result.attendance)).toBe(true);
  });

  test('sermons is an array', () => {
    const result = readData();
    if (!result) return;
    expect(Array.isArray(result.sermons)).toBe(true);
  });

  test('each attendance record has date, service, and numeric count', () => {
    const result = readData();
    if (!result || result.attendance.length === 0) return;
    const rec = result.attendance[0];
    expect(rec).toHaveProperty('date');
    expect(rec).toHaveProperty('service');
    expect(typeof rec.count).toBe('number');
  });

  test('each sermon record has required fields', () => {
    const result = readData();
    if (!result || result.sermons.length === 0) return;
    const s = result.sermons[0];
    expect(s).toHaveProperty('date');
    expect(s).toHaveProperty('title');
    expect(s).toHaveProperty('speaker');
  });

  test('each job assignment has date, service, job, and name', () => {
    const result = readData();
    if (!result || result.jobAssignments.assignments.length === 0) return;
    const a = result.jobAssignments.assignments[0];
    expect(a).toHaveProperty('date');
    expect(a).toHaveProperty('service');
    expect(a).toHaveProperty('job');
    expect(a).toHaveProperty('name');
  });
});

// ─── Live integration (requires credentials in .env) ────────────────────────

const HAS_CREDS = !!(process.env.CAPSHAW_MEMBER_USERNAME && process.env.CAPSHAW_MEMBER_PASSWORD);
const describeLive = HAS_CREDS ? describe : describe.skip;

const SCRAPER_PAGES = [
  {
    name:   'job-assignments',
    path:   '/members/job-assignments',
    parser: parseJobAssignments,
    check:  r => expect(r).toHaveProperty('assignments') && expect(Array.isArray(r.assignments)).toBe(true),
  },
  {
    name:   'attendance',
    path:   '/members/attendance',
    parser: parseAttendance,
    check:  r => expect(Array.isArray(r)).toBe(true),
  },
  {
    name:   'sermons',
    path:   '/members/sermons',
    parser: parseSermons,
    check:  r => expect(Array.isArray(r)).toBe(true),
  },
  {
    name:   'visitor-tracker',
    path:   '/members/visitor-tracker',
    parser: parseVisitors,
    check:  r => expect(Array.isArray(r)).toBe(true),
  },
  {
    name:   'anniversaries',
    path:   '/members/anniversaries-members-non-members',
    parser: parseAnniversaries,
    check:  r => expect(Array.isArray(r)).toBe(true),
  },
  {
    name:   'deacons',
    path:   '/members/deacons',
    parser: parseDeacons,
    check:  r => expect(Array.isArray(r)).toBe(true),
  },
  {
    name:   'dashboard (bulletins)',
    path:   '/members',
    parser: parseBulletins,
    check:  r => expect(Array.isArray(r)).toBe(true),
  },
];

describeLive('live scraper — requires .env credentials', () => {
  jest.setTimeout(45000);

  test('getSession returns a non-empty cookie string', async () => {
    const session = await getSession();
    expect(typeof session).toBe('string');
    expect(session.length).toBeGreaterThan(10);
    expect(session).toContain('=');
  });

  test.each(SCRAPER_PAGES)(
    '$name page is accessible at $path',
    async ({ path }) => {
      const result = await fetchPage(path);
      expect(result.status).toBe(200);
      expect(result.body.toLowerCase()).toContain('<html');
      expect(result.url).not.toMatch(/login/i);
      expect(result.body).not.toMatch(/Page Not Found/i);
    }
  );

  test.each(SCRAPER_PAGES)(
    '$name page parses to a non-empty result',
    async ({ path, parser, check }) => {
      const result = await fetchPage(path);
      const parsed = parser(result.body);
      check(parsed);
      // Each page should yield at least some data
      const count = Array.isArray(parsed) ? parsed.length : parsed.assignments?.length ?? 0;
      expect(count).toBeGreaterThan(0);
    }
  );

  test('runUpdate fetches all pages and returns complete data structure', async () => {
    const { lastUpdated, warnings } = await runUpdate();
    expect(typeof lastUpdated).toBe('string');
    expect(new Date(lastUpdated).getTime()).not.toBeNaN();
    expect(Array.isArray(warnings)).toBe(true);
    if (warnings.length) console.warn('[scraper warnings]', warnings);

    const saved = readData();
    expect(saved).not.toBeNull();
    for (const key of ['jobAssignments', 'attendance', 'sermons', 'visitors', 'anniversaries', 'deacons', 'bulletins']) {
      expect(saved).toHaveProperty(key);
    }

    // Spot-check each section type
    expect(saved.jobAssignments).toHaveProperty('assignments');
    expect(Array.isArray(saved.attendance)).toBe(true);
    expect(Array.isArray(saved.sermons)).toBe(true);
    expect(Array.isArray(saved.visitors)).toBe(true);
    expect(Array.isArray(saved.anniversaries)).toBe(true);
    expect(Array.isArray(saved.deacons)).toBe(true);
    expect(Array.isArray(saved.bulletins)).toBe(true);
  });
});
