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

// A proxy is trusted but sent no X-Forwarded-For: req.ip is then the proxy's
// own address, so every visitor is counted as one and a single busy minute
// locks everybody out of signing in. Said once per process, in the log, so a
// misconfigured nginx is noticed rather than felt.
let warnedNoForwardedFor = false;
function warnIfProxyForwardsNoAddress(req) {
  if (warnedNoForwardedFor) return;
  if (!req.app || !req.app.get('trust proxy')) return;
  if (req.headers['x-forwarded-for']) return;
  warnedNoForwardedFor = true;
  console.warn(
    `[rateLimit] A request reached ${req.originalUrl || req.url} through a trusted proxy ` +
    'with no X-Forwarded-For header, so every visitor shares one rate limit. ' +
    'Add "proxy_set_header X-Forwarded-For $remote_addr;" to the nginx site ' +
    '(see deploy/nginx/capshaw.conf).'
  );
}

function rateLimit({ max, windowMs = DEFAULT_WINDOW_MS, message }) {
  const hits = new Map();   // key → { count, resetAt }

  function sweep(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  const middleware = function (req, res, next) {
    const now = Date.now();
    // Behind nginx this is the real caller, because app.js trusts the proxy
    // and nginx sets X-Forwarded-For to the address it saw.
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    warnIfProxyForwardsNoAddress(req);

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
  middleware.reset = () => { hits.clear(); warnedNoForwardedFor = false; };
  return middleware;
}

module.exports = { rateLimit, DEFAULT_WINDOW_MS };
