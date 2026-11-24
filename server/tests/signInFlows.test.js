// Every sign-in provider, run all the way through the real app: the button,
// the trip to the provider, the provider coming back with a code, the token
// exchange, the account, the session, and what that session can then reach.
//
// Nothing is mocked inside the portal. The provider itself is a small HTTP
// server on this machine that plays the part of Google, Facebook, Yahoo,
// Microsoft and Apple: each strategy's authorization, token and profile
// addresses are pointed at it, and it checks what a real provider would
// check — the client id and secret, the code it handed out, the redirect URL,
// and for Apple that the client secret is a JWT signed with the app's key.
//
// What this cannot show is that the real providers accept the real
// developer apps. That is the first real sign-in after the keys are set.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const crypto  = require('crypto');
const http    = require('http');
const request = require('supertest');

const ORIGINAL_ENV = { ...process.env };
const CLIENT_URL   = 'http://localhost:5173';
const ORIGIN       = 'http://localhost:5173';

const appleKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

const ENV = {
  NODE_ENV: 'test',
  SESSION_SECRET: 'test-secret',
  ADMIN_EMAIL: 'owner@example.com',
  GOOGLE_CLIENT_ID: 'google-id',      GOOGLE_CLIENT_SECRET: 'google-secret',
  FACEBOOK_APP_ID: 'facebook-id',     FACEBOOK_APP_SECRET: 'facebook-secret',
  YAHOO_CLIENT_ID: 'yahoo-id',        YAHOO_CLIENT_SECRET: 'yahoo-secret',
  MICROSOFT_CLIENT_ID: 'microsoft-id', MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
  APPLE_CLIENT_ID: 'org.capshaw.members', APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567',
  APPLE_PRIVATE_KEY: appleKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'),
};

const SECRETS = {
  google: ['google-id', 'google-secret'],
  facebook: ['facebook-id', 'facebook-secret'],
  yahoo: ['yahoo-id', 'yahoo-secret'],
  microsoft: ['microsoft-id', 'microsoft-secret'],
};

// ─── The stand-in provider ────────────────────────────────────────────────────

const PERSONAL = '9188040d-6c67-4c5b-b112-36a304b66dad';
const WORK     = '11111111-2222-3333-4444-555555555555';

function jwt(claims) {
  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'RS256', kid: 'k' })}.${encode({ iat: now, exp: now + 600, ...claims })}.signature`;
}

// Who the next sign-in at each provider is, as that provider would describe
// them. A test sets this before it signs somebody in.
const person = {};

const ISSUED = new Map(); // code → provider
let fake, fakeUrl, tokenRequests;

function tokenResponse(provider) {
  const p = person[provider];
  if (provider === 'yahoo') {
    return { id_token: jwt({ iss: 'https://api.login.yahoo.com', aud: 'yahoo-id', sub: p.sub }) };
  }
  if (provider === 'microsoft') {
    return { id_token: jwt({
      iss: `https://login.microsoftonline.com/${p.tid}/v2.0`, aud: 'microsoft-id', sub: p.sub,
      tid: p.tid, email: p.email, name: p.name,
    }) };
  }
  if (provider === 'apple') {
    return { id_token: jwt({
      iss: 'https://appleid.apple.com', aud: 'org.capshaw.members', sub: p.sub,
      email: p.email, email_verified: 'true', ...(p.relay ? { is_private_email: 'true' } : {}),
    }) };
  }
  return {};
}

// Apple's check of the client secret: an ES256 JWT from our team, for our
// Services ID, signed with the key whose public half Apple holds.
function appleSecretIsGood(secret) {
  const [header, payload, signature] = String(secret).split('.');
  if (!signature) return false;
  const read = part => JSON.parse(Buffer.from(part, 'base64url').toString());
  const h = read(header), c = read(payload);
  const signed = crypto.verify('sha256', Buffer.from(`${header}.${payload}`),
    { key: appleKeys.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
  return signed && h.alg === 'ES256' && h.kid === 'KEY1234567' && c.iss === 'TEAM123456'
    && c.sub === 'org.capshaw.members' && c.aud === 'https://appleid.apple.com'
    && c.exp > Date.now() / 1000;
}

function startFakeProvider() {
  return new Promise(resolve => {
    fake = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://fake');
      const [, provider, what] = url.pathname.split('/');
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (what === 'token' && req.method === 'POST') {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
          const form = Object.fromEntries(new URLSearchParams(raw));
          tokenRequests.push({ provider, ...form });
          const secretOk = provider === 'apple'
            ? form.client_id === 'org.capshaw.members' && appleSecretIsGood(form.client_secret)
            : form.client_id === SECRETS[provider][0] && form.client_secret === SECRETS[provider][1];
          const codeOk = ISSUED.get(form.code) === provider;
          const redirectOk = form.redirect_uri === `http://localhost:3001/api/auth/${provider}/callback`;
          if (!secretOk || !codeOk || !redirectOk || form.grant_type !== 'authorization_code') {
            return send(400, { error: 'invalid_grant' });
          }
          ISSUED.delete(form.code); // a code works once
          send(200, { access_token: `token-${provider}`, token_type: 'Bearer', ...tokenResponse(provider) });
        });
        return;
      }

      // Profile lookups, which only Google, Facebook and Yahoo make.
      const auth = req.headers.authorization || '';
      const token = auth.replace(/^Bearer /, '') || url.searchParams.get('access_token');
      if (token !== `token-${provider}`) return send(401, { error: 'invalid_token' });
      const p = person[provider];
      if (provider === 'google') {
        return send(200, { sub: p.sub, name: p.name, email: p.email, email_verified: true, picture: p.photo });
      }
      if (provider === 'facebook') {
        return send(200, { id: p.sub, name: p.name, email: p.email });
      }
      if (provider === 'yahoo') {
        return send(200, { sub: p.sub, name: p.name, email: p.email, email_verified: true });
      }
      send(404, {});
    });
    fake.listen(0, '127.0.0.1', () => {
      fakeUrl = `http://127.0.0.1:${fake.address().port}`;
      resolve();
    });
  });
}

// ─── The portal, pointed at the stand-in ──────────────────────────────────────

let app, db, passport;

function buildApp() {
  process.env = { ...ORIGINAL_ENV, ...ENV };
  jest.resetModules();
  db       = require('../db');
  passport = require('passport');
  app      = require('../app').createApp();

  for (const provider of ['google', 'facebook', 'yahoo', 'microsoft', 'apple']) {
    const strategy = passport._strategy(provider);
    strategy._oauth2._authorizeUrl   = `${fakeUrl}/${provider}/authorize`;
    strategy._oauth2._accessTokenUrl = `${fakeUrl}/${provider}/token`;
  }
  passport._strategy('google')._userProfileURL = `${fakeUrl}/google/userinfo`;
  passport._strategy('facebook')._profileURL   = `${fakeUrl}/facebook/me`;
  passport._strategy('yahoo')._userInfoURL     = `${fakeUrl}/yahoo/userinfo`;
}

// What the provider does once the person says yes on its page: send them back
// to the callback with a fresh code and the state it was given.
function consent(provider, authorizeLocation) {
  const asked = new URL(authorizeLocation);
  expect(asked.origin + asked.pathname).toBe(`${fakeUrl}/${provider}/authorize`);
  expect(asked.searchParams.get('redirect_uri')).toBe(`http://localhost:3001/api/auth/${provider}/callback`);
  const code = `code-${crypto.randomBytes(6).toString('hex')}`;
  ISSUED.set(code, provider);
  return { code, state: asked.searchParams.get('state'), asked };
}

// One whole sign-in. `tamper` changes what comes back to the callback.
async function signIn(provider, { agent = request.agent(app), tamper = x => x, appleUser } = {}) {
  const start = await agent.get(`/api/auth/${provider}`);
  expect(start.status).toBe(302);
  const back = tamper(consent(provider, start.headers.location));

  const done = provider === 'apple'
    ? await agent.post('/api/auth/apple/callback')
        .set('Origin', back.origin || 'https://appleid.apple.com')
        .type('form')
        .send({ code: back.code, state: back.state, ...(appleUser ? { user: JSON.stringify(appleUser) } : {}) })
    : await agent.get(`/api/auth/${provider}/callback`).query({ code: back.code, ...(back.state ? { state: back.state } : {}) });

  return { agent, start, done, back };
}

const me = async agent => {
  const res = await agent.get('/api/auth/me');
  return res.status === 200 ? res.body.user : null;
};

beforeAll(startFakeProvider);
afterAll(() => new Promise(resolve => fake.close(resolve)));

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  buildApp();
  tokenRequests = [];
  ISSUED.clear();
  Object.assign(person, {
    google:    { sub: 'g-100', name: 'Grace Google', email: 'grace@gmail.com', photo: 'https://cdn.example/grace.jpg' },
    facebook:  { sub: 'f-100', name: 'Frank Facebook', email: 'frank@example.com' },
    yahoo:     { sub: 'Y100', name: 'Yolanda Yahoo', email: 'yolanda@aol.com' },
    microsoft: { sub: 'm-100', tid: PERSONAL, name: 'Mike Microsoft', email: 'mike@hotmail.com' },
    apple:     { sub: '000100.apple', email: 'ann@icloud.com' },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

// ─── The sign-in page ─────────────────────────────────────────────────────────

test('the sign-in page is offered all five providers', async () => {
  const res = await request(app).get('/api/auth/providers');
  expect(res.body.providers).toEqual(['google', 'facebook', 'yahoo', 'microsoft', 'apple']);
});

// ─── Each provider, end to end ────────────────────────────────────────────────

const EXPECTED = {
  google:    { email: 'grace@gmail.com',   name: 'Grace Google' },
  facebook:  { email: 'frank@example.com', name: 'Frank Facebook' },
  yahoo:     { email: 'yolanda@aol.com',   name: 'Yolanda Yahoo' },
  microsoft: { email: 'mike@hotmail.com',  name: 'Mike Microsoft' },
  apple:     { email: 'ann@icloud.com',    name: 'Ann Apple' },
};
const APPLE_FIRST_TIME = { name: { firstName: 'Ann', lastName: 'Apple' }, email: 'ann@icloud.com' };

describe.each(Object.keys(EXPECTED))('signing in with %s', provider => {
  const appleUser = provider === 'apple' ? APPLE_FIRST_TIME : undefined;

  test('a first sign-in makes a pending account and a session', async () => {
    const { agent, done } = await signIn(provider, { appleUser });

    expect(done.status).toBe(302);
    expect(done.headers.location).toBe(CLIENT_URL);
    expect(await me(agent)).toMatchObject({ provider, role: 'pending', ...EXPECTED[provider] });
    expect(tokenRequests).toHaveLength(1);
  });

  test('while pending, the session reaches nothing in the portal', async () => {
    const { agent } = await signIn(provider, { appleUser });
    const res = await agent.get('/api/announcements');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('pending_approval');
  });

  test('once approved, signing in again reaches the portal, on the same account', async () => {
    const first = await signIn(provider, { appleUser });
    const account = await me(first.agent);
    db.prepare("UPDATE users SET role = 'approved' WHERE id = ?").run(account.id);

    const again = await signIn(provider); // Apple sends no name this time
    expect(await me(again.agent)).toMatchObject({ id: account.id, role: 'approved', name: EXPECTED[provider].name });
    expect((await again.agent.get('/api/announcements')).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(1);
  });

  test('signing out ends the session', async () => {
    const { agent } = await signIn(provider, { appleUser });
    await agent.post('/api/auth/logout').set('Origin', ORIGIN).expect(200);
    expect(await me(agent)).toBeNull();
  });

  test('a code the provider refuses signs nobody in', async () => {
    const { agent, done } = await signIn(provider, { appleUser, tamper: back => ({ ...back, code: 'forged-code' }) });
    expect(done.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
    expect(await me(agent)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(0);
  });

  test('the owner address is let in as an admin', async () => {
    person[provider].email = 'owner@example.com';
    if (provider === 'microsoft') person.microsoft.tid = PERSONAL;
    const { agent } = await signIn(provider, { appleUser });
    expect(await me(agent)).toMatchObject({ role: 'admin' });
  });
});

// ─── The checks only the new three make ───────────────────────────────────────

describe.each(['yahoo', 'microsoft', 'apple'])('%s refuses a callback it did not start', provider => {
  test('a state that does not match the cookie', async () => {
    const { agent, done } = await signIn(provider, { tamper: back => ({ ...back, state: 'somebody-elses' }) });
    expect(done.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
    expect(await me(agent)).toBeNull();
    expect(tokenRequests).toHaveLength(0); // turned away before any code is spent
  });

  test('a callback in a browser that never started a sign-in', async () => {
    const { back } = await signIn(provider);
    const stranger = request.agent(app);
    ISSUED.set('fresh-code', provider);
    const res = provider === 'apple'
      ? await stranger.post('/api/auth/apple/callback').set('Origin', 'https://appleid.apple.com').type('form').send({ code: 'fresh-code', state: back.state })
      : await stranger.get(`/api/auth/${provider}/callback`).query({ code: 'fresh-code', state: back.state });
    expect(res.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
    expect(await me(stranger)).toBeNull();
  });

  test('the state cookie works once', async () => {
    const { agent, back } = await signIn(provider);
    await agent.post('/api/auth/logout').set('Origin', ORIGIN);
    ISSUED.set('second-code', provider);
    const replay = provider === 'apple'
      ? await agent.post('/api/auth/apple/callback').set('Origin', 'https://appleid.apple.com').type('form').send({ code: 'second-code', state: back.state })
      : await agent.get(`/api/auth/${provider}/callback`).query({ code: 'second-code', state: back.state });
    expect(replay.headers.location).toBe(`${CLIENT_URL}/?auth_error=${provider}`);
    expect(await me(agent)).toBeNull();
  });
});

describe('what each provider asks for', () => {
  const askedOf = async provider => (await request.agent(app).get(`/api/auth/${provider}`)).headers.location;

  test('Yahoo asks for the address and profile', async () => {
    expect(new URL(await askedOf('yahoo')).searchParams.get('scope')).toBe('openid email profile');
  });
  test('Microsoft asks for the address and lets the person pick an account', async () => {
    const asked = new URL(await askedOf('microsoft')).searchParams;
    expect(asked.get('scope')).toBe('openid profile email');
    expect(asked.get('prompt')).toBe('select_account');
  });
  test('Apple asks for the name and address, posted back', async () => {
    const asked = new URL(await askedOf('apple')).searchParams;
    expect(asked.get('scope')).toBe('name email');
    expect(asked.get('response_mode')).toBe('form_post');
  });
});

describe('Microsoft work and school accounts', () => {
  test('arrive without an address and are asked for one, never matched by the one they carry', async () => {
    const { lastInsertRowid: patId } = db.prepare(
      "INSERT INTO users (provider, provider_id, email, name, role) VALUES ('google', 'g-pat', 'pat@uab.edu', 'Pat', 'approved')"
    ).run();
    Object.assign(person.microsoft, { tid: WORK, email: 'pat@uab.edu', name: 'Somebody Else' });

    const { agent } = await signIn('microsoft');
    const user = await me(agent);
    expect(user).toMatchObject({ provider: 'microsoft', role: 'pending', email: null });
    expect(user.id).not.toBe(patId);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_identities').get().n).toBe(0);
  });

  test('cannot become the owner by carrying the owner address', async () => {
    Object.assign(person.microsoft, { tid: WORK, email: 'owner@example.com' });
    const { agent } = await signIn('microsoft');
    expect(await me(agent)).toMatchObject({ role: 'pending', email: null });
  });
});

describe('Apple', () => {
  test('a POST from any site but Apple\'s is turned away before it reaches the sign-in', async () => {
    const { done, agent } = await signIn('apple', { appleUser: APPLE_FIRST_TIME, tamper: back => ({ ...back, origin: 'https://evil.example' }) });
    expect(done.status).toBe(403);
    expect(await me(agent)).toBeNull();
    expect(tokenRequests).toHaveLength(0);
  });

  test('a hidden (relay) address signs in and is kept as the account\'s address', async () => {
    Object.assign(person.apple, { email: 'k7x9q2@privaterelay.appleid.com', relay: true });
    const { agent } = await signIn('apple', { appleUser: APPLE_FIRST_TIME });
    expect(await me(agent)).toMatchObject({ email: 'k7x9q2@privaterelay.appleid.com', name: 'Ann Apple' });
  });

  test('somebody who cancels on Apple\'s page is simply back at the sign-in page', async () => {
    const agent = request.agent(app);
    await agent.get('/api/auth/apple');
    const res = await agent.post('/api/auth/apple/callback').set('Origin', 'https://appleid.apple.com')
      .type('form').send({ error: 'user_cancelled_authorize' });
    expect(res.headers.location).toBe(CLIENT_URL);
    expect(await me(agent)).toBeNull();
  });
});

describe('the same person arriving another way', () => {
  test('a Yahoo sign-in on a Google account\'s address waits for an admin, then reaches that account', async () => {
    person.google.email = person.yahoo.email = 'sam@yahoo.com';
    const google = await signIn('google');
    const account = await me(google.agent);
    db.prepare("UPDATE users SET role = 'approved' WHERE id = ?").run(account.id);

    const held = await signIn('yahoo');
    expect(held.done.headers.location).toBe(`${CLIENT_URL}/?auth_error=link_pending`);
    expect(await me(held.agent)).toBeNull();

    db.prepare("UPDATE user_identities SET status = 'approved' WHERE provider = 'yahoo'").run();
    const joined = await signIn('yahoo');
    expect(await me(joined.agent)).toMatchObject({ id: account.id, provider: 'google' });
  });
});
