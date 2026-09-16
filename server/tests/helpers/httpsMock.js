// A stand-in for node's https module for the code that talks to
// capshawchurch.org. Tests register handlers by method and path and get back a
// log of what was requested, so a route's conversation with the church's admin
// panel can be asserted on without a network.
//
// Used as:
//   jest.mock('https', () => require('./helpers/httpsMock').createHttpsMock());
//   const httpsMock = require('https');
//   httpsMock.__route('GET', '/admin/login', () => ({ body: LOGIN_HTML }));
const { EventEmitter } = require('events');

function createHttpsMock() {
  const routes = [];
  const calls  = [];

  // Handlers are consulted newest first, so a test can override one another
  // test (or a beforeEach) already registered.
  function resolveRoute(method, pathname) {
    return [...routes].reverse().find(r =>
      r.method === method &&
      (typeof r.path === 'string' ? r.path === pathname : r.path.test(pathname))
    );
  }

  // Hands the caller's callback an object shaped like an http.IncomingMessage.
  // The body is emitted on the next tick, after the callback has had its chance
  // to attach 'data' and 'end' listeners.
  function deliver(method, pathname, requestBody, callback) {
    const call  = { method, path: pathname, body: requestBody };
    calls.push(call);

    const route = resolveRoute(method, pathname);
    const out   = route
      ? (route.respond(call) || {})
      : { status: 404, body: `no handler for ${method} ${pathname}` };

    if (out.error) return { error: out.error };

    const res = new EventEmitter();
    res.statusCode = out.status ?? 200;
    res.headers    = {
      ...(out.setCookie ? { 'set-cookie': [].concat(out.setCookie) } : {}),
      ...(out.location  ? { location: out.location }                 : {}),
      ...(out.headers   || {}),
    };
    res.setEncoding = () => {};

    // Node hands 'data' a Buffer, and callers rely on that: some concatenate
    // the chunks as buffers, others as strings.
    process.nextTick(() => {
      if (out.body != null && out.body !== '') {
        res.emit('data', Buffer.isBuffer(out.body) ? out.body : Buffer.from(String(out.body)));
      }
      res.emit('end');
    });

    callback(res);
    return {};
  }

  function pathOf(options) {
    if (typeof options === 'string') return new URL(options).pathname + new URL(options).search;
    return options.path;
  }

  const get = (options, callback) => {
    const req = new EventEmitter();
    const { error } = deliver('GET', pathOf(options), null, callback);
    if (error) process.nextTick(() => req.emit('error', error));
    return req;
  };

  const request = (options, callback) => {
    const req  = new EventEmitter();
    let   body = '';
    req.write = chunk => { body += chunk; };
    req.end   = () => {
      const { error } = deliver(options.method || 'GET', pathOf(options), body, callback);
      if (error) process.nextTick(() => req.emit('error', error));
    };
    return req;
  };

  const https = {
    get,
    request,
    Agent: class Agent {},
    // ── Test controls ──
    // respond returns { status, body, setCookie, location, headers, error }
    __route(method, path, respond) { routes.push({ method, path, respond }); },
    __calls: calls,
    __reset() { routes.length = 0; calls.length = 0; },
  };

  return https;
}

module.exports = { createHttpsMock };
