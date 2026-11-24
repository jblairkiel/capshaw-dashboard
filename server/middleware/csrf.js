// ─── CSRF defense via Origin verification ──────────────────────────────────
//
// Every request that changes state rides the visitor's session cookie
// automatically — that is exactly what a cross-site request forgery abuses.
// The browser attaches Origin (falling back to Referer) to every fetch, XHR,
// or form submission that isn't a plain GET/HEAD, and neither header can be
// set or suppressed by the page making the request. Checking it against the
// same origin list CORS already trusts costs nothing and needs no change on
// the client: unlike a token-based scheme, there is no header for every one
// of the app's fetch calls to remember to send.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// `exceptions` lets one more origin reach one exact path, for a provider that
// answers a sign-in with a form POST from its own site (Apple). Such a route
// has to protect itself some other way — the sign-in's `state`, checked
// against a cookie only this site could have set.
function requireTrustedOrigin(allowedOrigins, { exceptions = {} } = {}) {
  const allowed = new Set(allowedOrigins);

  return function (req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const source = req.get('origin') || originOf(req.get('referer'));

    if (source && allowed.has(source)) return next();
    if (source && Object.prototype.hasOwnProperty.call(exceptions, req.path) && exceptions[req.path].includes(source)) {
      return next();
    }

    return res.status(403).json({ success: false, error: 'Request origin not allowed' });
  };
}

module.exports = { requireTrustedOrigin };
