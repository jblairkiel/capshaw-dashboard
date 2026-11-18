const { parseTrustProxy } = require('../app');

describe('parseTrustProxy', () => {
  test('defaults to one hop in production and none elsewhere', () => {
    expect(parseTrustProxy(undefined, true)).toBe(1);
    expect(parseTrustProxy('', true)).toBe(1);
    expect(parseTrustProxy(undefined, false)).toBe(false);
  });

  test('takes a hop count, off, or anything Express understands', () => {
    expect(parseTrustProxy('2', true)).toBe(2);
    expect(parseTrustProxy('0', true)).toBe(false);
    expect(parseTrustProxy('false', true)).toBe(false);
    expect(parseTrustProxy('true', false)).toBe(true);
    expect(parseTrustProxy('loopback', true)).toBe('loopback');
    expect(parseTrustProxy(' 172.16.0.0/12 ', true)).toBe('172.16.0.0/12');
  });
});
