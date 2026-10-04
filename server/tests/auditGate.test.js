// The CI security audit (scripts/audit.js): what it lets through, and that the
// allowlist can never wave through an advisory that reaches production, one
// that has expired, or a moderate one being mistaken for blocking.
const { advisoriesIn, judge, loadAllowlist } = require('../../scripts/audit');

// An `npm audit --json` report, cut down to what the gate reads.
const report = (...advisories) => ({
  vulnerabilities: Object.fromEntries(advisories.map(([name, id, severity]) => [name, {
    name,
    via: [{ source: 1, title: `${name} is vulnerable`, severity, url: `https://github.com/advisories/${id}` }],
  }])),
});
// A package affected only because it depends on one above.
const dependent = (name, on) => ({ [name]: { name, via: [on] } });

const BRACES = ['braces', 'GHSA-vfj7-8cjw-p6xm', 'high'];
const ALLOW = [{ id: 'GHSA-vfj7-8cjw-p6xm', until: '2027-01-04', reason: 'dev only' }];
const TODAY = '2026-10-04';

describe('reading a report', () => {
  test('each advisory once, with the packages it was found in, not the ones depending on them', () => {
    const r = report(BRACES);
    Object.assign(r.vulnerabilities, dependent('micromatch', 'braces'));
    expect(advisoriesIn(r)).toEqual([{
      id: 'GHSA-vfj7-8cjw-p6xm', title: 'braces is vulnerable', severity: 'high',
      url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm', packages: ['braces'],
    }]);
  });

  test('a clean tree has none', () => {
    expect(advisoriesIn({ vulnerabilities: {} })).toEqual([]);
    expect(advisoriesIn({})).toEqual([]);
  });
});

describe('what fails the build', () => {
  test('an allowlisted advisory in a development dependency passes, until its date', () => {
    expect(judge({ all: report(BRACES), production: {}, allowlist: ALLOW, today: TODAY }))
      .toMatchObject({ failures: [], allowed: [{ id: 'GHSA-vfj7-8cjw-p6xm', until: '2027-01-04' }] });
  });

  test('an expired entry fails again', () => {
    const { failures } = judge({ all: report(BRACES), production: {}, allowlist: ALLOW, today: '2027-01-05' });
    expect(failures.map(f => f.why)).toEqual(['allowlist entry expired 2027-01-04']);
  });

  test('an entry with no date counts as expired', () => {
    const { failures } = judge({ all: report(BRACES), production: {}, allowlist: [{ id: 'GHSA-vfj7-8cjw-p6xm' }], today: TODAY });
    expect(failures).toHaveLength(1);
  });

  test('the allowlist never covers an advisory that reaches production', () => {
    const { failures } = judge({ all: report(BRACES), production: report(BRACES), allowlist: ALLOW, today: TODAY });
    expect(failures.map(f => f.why)).toEqual(['reaches the production tree']);
  });

  test('any other high or critical advisory fails, as npm audit --audit-level=high would', () => {
    const { failures } = judge({
      all: report(BRACES, ['left-pad', 'GHSA-aaaa-bbbb-cccc', 'critical']),
      production: {}, allowlist: ALLOW, today: TODAY,
    });
    expect(failures.map(f => [f.id, f.why])).toEqual([['GHSA-aaaa-bbbb-cccc', 'not on the allowlist']]);
  });

  test('moderate and low advisories do not fail it', () => {
    const { failures, allowed } = judge({
      all: report(['qs', 'GHSA-1111-2222-3333', 'moderate'], ['ms', 'GHSA-4444-5555-6666', 'low']),
      production: report(['qs', 'GHSA-1111-2222-3333', 'moderate']), allowlist: [], today: TODAY,
    });
    expect([failures, allowed]).toEqual([[], []]);
  });
});

describe('the allowlist on file', () => {
  test('every entry says why, and when it runs out', () => {
    const entries = loadAllowlist();
    for (const e of entries) {
      expect(e.id).toMatch(/^GHSA-/);
      expect(e.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(e.reason || '').length).toBeGreaterThan(40);
    }
  });
});
