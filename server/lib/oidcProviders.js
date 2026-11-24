// Yahoo, Microsoft and Apple sign-in.
//
// All three speak OpenID Connect, so they are built here on passport-oauth2
// (already installed underneath the Google strategy) rather than on three
// separate third-party packages. Each one:
//
//   - is only built when every one of its credentials is configured,
//   - keeps the `state` it sends in a short-lived cookie of its own and checks
//     it on the way back, so a callback somebody else started is refused, and
//   - reads who signed in from the id_token the provider's token endpoint
//     returns. That token comes straight from the provider over TLS in answer
//     to our own request, which is why its signature need not be checked again
//     (OpenID Connect Core §3.1.3.7); its issuer, audience and expiry still are.
//
// What comes out is the same shape for every provider — an id, an address,
// whether the provider vouches for that address, a name and a photo — and
// routes/auth.js hands it to the same upsertUser as Google and Facebook.

const crypto = require('crypto');
const { Strategy: OAuth2Strategy } = require('passport-oauth2');

// ─── State, kept in a cookie ──────────────────────────────────────────────────
//
// passport-oauth2 can keep `state` in the session, but Apple sends its answer
// back as a cross-site POST, and the session cookie (SameSite=Lax) does not
// travel on one. So each provider gets its own small cookie, scoped to the
// sign-in routes and gone after ten minutes. Apple's is SameSite=None so the
// POST carries it; the others stay Lax.

const STATE_TTL_MS = 10 * 60 * 1000;

function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function sameString(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

class CookieStateStore {
  constructor(provider, { crossSite = false, secure = false } = {}) {
    this.name = `oauth_state_${provider}`;
    // A SameSite=None cookie has to be Secure, or browsers drop it. Off a
    // secure origin (local development) Apple cannot be used anyway.
    this.options = {
      httpOnly: true,
      secure,
      sameSite: crossSite && secure ? 'none' : 'lax',
      path: '/api/auth',
      maxAge: STATE_TTL_MS,
    };
  }

  // passport-oauth2 tells the stores apart by how many arguments they take.
  store(req, _state, _meta, callback) {
    const value = crypto.randomBytes(24).toString('base64url');
    req.res.cookie(this.name, value, this.options);
    callback(null, value);
  }

  verify(req, state, _meta, callback) {
    const kept = readCookie(req, this.name);
    // Once used, or once it fails, the cookie is no good to anybody.
    const { maxAge, ...clearOptions } = this.options;
    req.res.clearCookie(this.name, clearOptions);
    if (!kept || !state || !sameString(kept, state)) {
      return callback(null, false, { message: 'This sign-in was not started here, or took too long. Please try again.' });
    }
    callback(null, true);
  }
}

// ─── The id_token ─────────────────────────────────────────────────────────────

function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('The provider returned no usable id_token');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('The provider returned an id_token that could not be read');
  }
}

// Issuer, audience and expiry. `issuer` is a string or a test the claims must
// pass, since Microsoft's issuer carries the tenant the person signed in from.
function checkedClaims(idToken, { issuer, clientId, now = Date.now() }) {
  const claims = decodeJwt(idToken);
  const issuerOk = typeof issuer === 'function' ? issuer(claims) : claims.iss === issuer;
  if (!issuerOk) throw new Error(`Unexpected id_token issuer: ${claims.iss}`);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(clientId)) throw new Error('The id_token was issued for another app');
  if (!claims.sub) throw new Error('The id_token names nobody');
  // A minute of slack for clocks that disagree.
  if (typeof claims.exp === 'number' && claims.exp * 1000 < now - 60 * 1000) {
    throw new Error('The id_token has expired');
  }
  return claims;
}

const isTrue = v => v === true || v === 'true';
const cleanEmail = v => (typeof v === 'string' && v.includes('@') ? v.trim() : null);
const domainOf = email => email.split('@').pop().toLowerCase();

// ─── Yahoo ────────────────────────────────────────────────────────────────────
//
// Yahoo also signs in AOL accounts. Its id_token may not carry the address, so
// the userinfo endpoint is asked too, and whatever it says wins.

const YAHOO = {
  authorizationURL: 'https://api.login.yahoo.com/oauth2/request_auth',
  tokenURL:         'https://api.login.yahoo.com/oauth2/get_token',
  userInfoURL:      'https://api.login.yahoo.com/openid/v1/userinfo',
  // Exactly Yahoo's issuer, with or without a trailing slash.
  issuer:           claims => claims.iss === 'https://api.login.yahoo.com' || claims.iss === 'https://api.login.yahoo.com/',
};

// Mailboxes Yahoo runs itself. A Yahoo account whose address is one of these
// owns that mailbox, so the address counts as confirmed even when Yahoo does
// not say so outright. Any other address needs email_verified.
const YAHOO_MAIL_DOMAINS = /^(yahoo\.[a-z.]+|ymail\.com|rocketmail\.com|aol\.[a-z.]+|aim\.com)$/;

function yahooIdentity({ params, profile, clientId }) {
  const claims = { ...checkedClaims(params.id_token, { issuer: YAHOO.issuer, clientId }), ...(profile?._json || {}) };
  const email = cleanEmail(claims.email);
  const emailVerified = Boolean(email) && (
    isTrue(claims.email_verified) ||
    (claims.email_verified === undefined && YAHOO_MAIL_DOMAINS.test(domainOf(email)))
  );
  const name = claims.name
    || [claims.given_name, claims.family_name].filter(Boolean).join(' ')
    || claims.nickname
    || null;
  return { id: String(claims.sub), email, emailVerified, name, photo: claims.picture || null };
}

class YahooStrategy extends OAuth2Strategy {
  constructor({ clientID, clientSecret, callbackURL, secure }, verify) {
    super({
      authorizationURL: YAHOO.authorizationURL,
      tokenURL: YAHOO.tokenURL,
      clientID, clientSecret, callbackURL,
      scope: ['openid', 'email', 'profile'],
      store: new CookieStateStore('yahoo', { secure }),
      passReqToCallback: true,
    }, verify);
    this.name = 'yahoo';
    this._oauth2.useAuthorizationHeaderforGET(true);
  }

  // Not being able to reach userinfo is no reason to fail the sign-in: the
  // id_token may well say enough on its own.
  userProfile(accessToken, done) {
    this._oauth2.get(YAHOO.userInfoURL, accessToken, (err, body) => {
      if (err) return done(null, {});
      try { done(null, { _json: JSON.parse(body) }); } catch { done(null, {}); }
    });
  }
}

// ─── Microsoft ────────────────────────────────────────────────────────────────
//
// The "common" endpoint takes personal accounts (Outlook, Hotmail, MSN, Live)
// and work or school ones alike. The two differ in one way that matters here:
// a personal account's address is one Microsoft confirmed, but a work or
// school account's `email` is whatever that organization's administrator typed
// in, for any domain at all. Trusting it would let somebody with their own
// Microsoft tenant claim anybody's address — the owner's included ("nOAuth").
// So a work or school address only counts as confirmed when Microsoft says the
// organization owns its domain (the optional `xms_edov` claim); otherwise the
// account arrives with no address and is asked to add and confirm one, like a
// Facebook account without one.

const MICROSOFT = {
  authorizationURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenURL:         'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  // Every personal Microsoft account signs in from this one tenant.
  personalTenant:   '9188040d-6c67-4c5b-b112-36a304b66dad',
  issuer:           claims => Boolean(claims.tid) && claims.iss === `https://login.microsoftonline.com/${claims.tid}/v2.0`,
};

function microsoftIdentity({ params, clientId }) {
  const claims = checkedClaims(params.id_token, { issuer: MICROSOFT.issuer, clientId });
  const personal = claims.tid === MICROSOFT.personalTenant;
  // A personal account signed in with a phone number has no address, and its
  // preferred_username is then the number, which cleanEmail turns away.
  const email = cleanEmail(claims.email) || (personal ? cleanEmail(claims.preferred_username) : null);
  const emailVerified = Boolean(email) && (personal || isTrue(claims.xms_edov) || claims.xms_edov === 1);
  return {
    // `sub` is Microsoft's own id for this person in this app, and never changes.
    id: String(claims.sub),
    email,
    emailVerified,
    name: claims.name || null,
    photo: null,
  };
}

class MicrosoftStrategy extends OAuth2Strategy {
  constructor({ clientID, clientSecret, callbackURL, secure }, verify) {
    super({
      authorizationURL: MICROSOFT.authorizationURL,
      tokenURL: MICROSOFT.tokenURL,
      clientID, clientSecret, callbackURL,
      scope: ['openid', 'profile', 'email'],
      store: new CookieStateStore('microsoft', { secure }),
      passReqToCallback: true,
    }, verify);
    this.name = 'microsoft';
  }

  // Always offer the account picker, so a shared family computer does not
  // quietly sign in as whoever used Microsoft last.
  authorizationParams() {
    return { prompt: 'select_account' };
  }
}

// ─── Apple ────────────────────────────────────────────────────────────────────
//
// Apple's quirks, each handled here or in its route:
//   - It has no fixed client secret. The secret is a JWT, signed with the
//     private key from the Apple Developer account, made fresh for each sign-in.
//   - Asking for the name and address makes Apple POST its answer back
//     (response_mode=form_post), so the callback is a POST — see
//     routes/auth.js and the origin exception in app.js.
//   - It sends the person's name only the very first time they sign in to this
//     app, in a `user` field beside the code, never in the id_token. After that
//     the name on the account is kept as it is.
//   - People may hide their address behind an @privaterelay.appleid.com one,
//     which reaches them only if the portal's sending address is registered
//     with Apple. It will not match anybody in the directory, so an admin picks
//     their entry by hand when approving.

const APPLE = {
  authorizationURL: 'https://appleid.apple.com/auth/authorize',
  tokenURL:         'https://appleid.apple.com/auth/token',
  issuer:           'https://appleid.apple.com',
};

// The private key arrives in an environment variable, where a .env file cannot
// hold a value over several lines, so "\n" stands for each line break.
function readApplePrivateKey(value) {
  const pem = String(value || '').replace(/\\n/g, '\n').trim();
  return crypto.createPrivateKey(pem);
}

function appleClientSecret({ teamId, keyId, clientId, privateKey, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const header  = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  // Five minutes is plenty for the one token exchange it is made for.
  const payload = { iss: teamId, iat, exp: iat + 300, aud: APPLE.issuer, sub: clientId };
  const encode  = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}

// The `user` field Apple posts on a first sign-in: a JSON string with the name
// the person chose to share.
function appleNameFrom(body) {
  let user = body?.user;
  if (typeof user === 'string') {
    try { user = JSON.parse(user); } catch { return null; }
  }
  const name = user?.name;
  if (!name || typeof name !== 'object') return null;
  const full = [name.firstName, name.lastName]
    .filter(part => typeof part === 'string' && part.trim())
    .map(part => part.trim())
    .join(' ');
  return full ? full.slice(0, 200) : null;
}

function appleIdentity({ params, req, clientId }) {
  const claims = checkedClaims(params.id_token, { issuer: APPLE.issuer, clientId });
  const email = cleanEmail(claims.email);
  return {
    id: String(claims.sub),
    email,
    emailVerified: Boolean(email) && isTrue(claims.email_verified),
    privateRelay: isTrue(claims.is_private_email),
    name: appleNameFrom(req?.body),
    photo: null,
  };
}

class AppleStrategy extends OAuth2Strategy {
  constructor({ clientID, teamID, keyID, privateKey, callbackURL, secure }, verify) {
    super({
      authorizationURL: APPLE.authorizationURL,
      tokenURL: APPLE.tokenURL,
      clientID,
      clientSecret: 'made-fresh-for-each-sign-in',
      callbackURL,
      scope: ['name', 'email'],
      store: new CookieStateStore('apple', { crossSite: true, secure }),
      passReqToCallback: true,
    }, verify);
    this.name = 'apple';
    this._appleKey = { teamId: teamID, keyId: keyID, clientId: clientID, privateKey };
  }

  authenticate(req, options) {
    this._oauth2._clientSecret = appleClientSecret(this._appleKey);
    return super.authenticate(req, options);
  }

  authorizationParams() {
    return { response_mode: 'form_post' };
  }
}

// ─── Which of the three are configured ────────────────────────────────────────

const has = (env, ...names) => names.every(name => Boolean(env[name]));

function configured(env = process.env) {
  return [
    has(env, 'YAHOO_CLIENT_ID', 'YAHOO_CLIENT_SECRET') && 'yahoo',
    has(env, 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET') && 'microsoft',
    has(env, 'APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY') && 'apple',
  ].filter(Boolean);
}

// Builds the strategy for one provider, and the function that turns what it
// returns into an identity. Returns null when the credentials are unusable (an
// Apple key that will not parse), so a bad key costs the Apple button, not the
// whole portal.
function build(provider, { env = process.env, serverUrl, secure, verify }) {
  const callbackURL = `${serverUrl}/api/auth/${provider}/callback`;
  if (provider === 'yahoo') {
    return {
      strategy: new YahooStrategy({ clientID: env.YAHOO_CLIENT_ID, clientSecret: env.YAHOO_CLIENT_SECRET, callbackURL, secure }, verify),
      identify: args => yahooIdentity({ ...args, clientId: env.YAHOO_CLIENT_ID }),
    };
  }
  if (provider === 'microsoft') {
    return {
      strategy: new MicrosoftStrategy({ clientID: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, callbackURL, secure }, verify),
      identify: args => microsoftIdentity({ ...args, clientId: env.MICROSOFT_CLIENT_ID }),
    };
  }
  if (provider === 'apple') {
    let privateKey;
    try {
      privateKey = readApplePrivateKey(env.APPLE_PRIVATE_KEY);
    } catch (err) {
      console.error('[auth] APPLE_PRIVATE_KEY could not be read, so Apple sign-in is off:', err.message);
      return null;
    }
    return {
      strategy: new AppleStrategy({
        clientID: env.APPLE_CLIENT_ID, teamID: env.APPLE_TEAM_ID, keyID: env.APPLE_KEY_ID,
        privateKey, callbackURL, secure,
      }, verify),
      identify: args => appleIdentity({ ...args, clientId: env.APPLE_CLIENT_ID }),
    };
  }
  return null;
}

module.exports = {
  configured,
  build,
  // For the tests.
  CookieStateStore,
  checkedClaims,
  yahooIdentity,
  microsoftIdentity,
  appleIdentity,
  appleClientSecret,
  appleNameFrom,
  readApplePrivateKey,
  MICROSOFT,
};
