// ─── A small rate limiter for the endpoints strangers can reach ───────────────
//
// Registering and signing in are the only places an unauthenticated caller can
// make this server do real work: both hash a password, which costs about 32 MB
// and a fraction of a second on purpose. That is exactly what makes guessing
// passwords expensive, and exactly what makes a flood of requests worth
// blocking before it gets that far.
//
// Counting is per process and in memory. That is enough for one small site
// behind one nginx, and it deliberately has no dependency and no store to keep
// running. It is a cap on nuisance, not a defence against a distributed
// attack — the per-account lockout in routes/auth.js is what actually protects
// a password.

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
// Above this many tracked callers, expired entries are swept before adding
// another, so a long-running process cannot grow a bucket per address forever.
const SWEEP_AT = 5000;

function rateLimit({ max, windowMs = DEFAULT_WINDOW_MS, message }) {
  const hits = new Map();   // key → { count, resetAt }

  function sweep(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  const middleware = function (req, res, next) {
    const now = Date.now();
    // Behind nginx this is the real caller, because index.js trusts the proxy.
    const key = req.ip || req.connection?.remoteAddress || 'unknown';

    if (hits.size > SWEEP_AT) sweep(now);

    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const seconds = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(seconds));
      return res.status(429).json({
        success: false,
        code:    'rate_limited',
        error:   message || 'Too many attempts just now. Please wait a few minutes and try again.',
      });
    }

    return next();
  };

  // For tests, and for anything that wants a clean slate.
  middleware.reset = () => hits.clear();
  return middleware;
}

module.exports = { rateLimit, DEFAULT_WINDOW_MS };
