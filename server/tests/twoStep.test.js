// Two-step sign-in: the codes themselves, signing in with them, who has to use
// them, and every way back in for somebody who has lost their phone.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { execFileSync } = require('child_process');
const request = require('supertest');
const totp    = require('../lib/totp');

const ORIGINAL_ENV = { ...process.env };
const ORIGIN   = 'http://localhost:5173';
const PASSWORD = 'correct horse battery staple';

// Codes are tied to the clock, and a code may not be used twice. Each test
// moves the clock on a 30-second step whenever it needs a fresh code.
let offsetMs = 0;
const realNow = Date.now.bind(Date);
beforeAll(() => { jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offsetMs); });
afterAll(() => { jest.restoreAllMocks(); });
function nextStep() { offsetMs += totp.STEP_SECONDS * 1000; }
const codeNow = secret => totp.codeAt(secret);

describe('authenticator codes (RFC 6238)', () => {
  // The RFC's own test secret, "12345678901234567890", and its SHA-1 vectors
  // cut to six digits.
  const RFC_SECRET = totp.base32Encode(Buffer.from('12345678901234567890'));

  test('match the published test vectors', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totp.codeAt(RFC_SECRET, 59 * 1000)).toBe('287082');
    expect(totp.codeAt(RFC_SECRET, 1111111109 * 1000)).toBe('081804');
    expect(totp.codeAt(RFC_SECRET, 1234567890 * 1000)).toBe('005924');
    expect(totp.codeAt(RFC_SECRET, 2000000000 * 1000)).toBe('279037');
  });

  test('base32 survives a round trip, spaces and lower case included', () => {
    const secret = totp.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const spaced = secret.toLowerCase().match(/.{1,4}/g).join(' ');
    expect(totp.base32Encode(totp.base32Decode(spaced))).toBe(secret);
  });

  test('a code from one step either side is accepted, two steps is not', () => {
    const t = 1_700_000_000_000;
    const secret = totp.generateSecret();
    const step = totp.stepAt(t);
    expect(totp.verify(secret, totp.codeForStep(secret, step - 1), { timeMs: t })).toBe(step - 1);
    expect(totp.verify(secret, totp.codeForStep(secret, step + 1), { timeMs: t })).toBe(step + 1);
    expect(totp.verify(secret, totp.codeForStep(secret, step + 2), { timeMs: t })).toBeNull();
    expect(totp.verify(secret, totp.codeForStep(secret, step - 2), { timeMs: t })).toBeNull();
  });

  test('a used code is refused while it is still in its window', () => {
    const t = 1_700_000_000_000;
    const secret = totp.generateSecret();
    const code = totp.codeAt(secret, t);
    const step = totp.verify(secret, code, { timeMs: t });
    expect(step).not.toBeNull();
    expect(totp.verify(secret, code, { timeMs: t, lastStep: step })).toBeNull();
  });

  test('typed with a space in the middle still works; anything else is refused', () => {
    const t = 1_700_000_000_000;
    const secret = totp.generateSecret();
    const code = totp.codeAt(secret, t);
    expect(totp.verify(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { timeMs: t })).not.toBeNull();
    for (const junk of ['', '12345', '1234567', 'abcdef', null, undefined]) {
      expect(totp.verify(secret, junk, { timeMs: t })).toBeNull();
    }
  });

  test('the QR code names the church and the account', () => {
    const uri = totp.otpauthUri('ABCD', 'ada@example.com');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Capshaw%20Church%3Aada%40example\.com\?/);
    expect(uri).toContain('secret=ABCD');
    expect(uri).toContain('issuer=Capshaw+Church');
  });
});

describe('signing in with two steps', () => {
  let app;
  let db;
  let hashPassword;

  function buildApp(env = {}) {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', SESSION_SECRET: 'test-secret', ...env };
    jest.resetModules();
    const { createApp } = require('../app');
    const built = createApp();
    db = require('../db');
    ({ hashPassword } = require('../lib/passwords'));
    require('../routes/auth').resetRateLimits();
    return built;
  }

  async function addLocal(name, role = 'approved', areas = []) {
    const email = `${name.toLowerCase()}@example.com`;
    const { lastInsertRowid: id } = db.prepare(`
      INSERT INTO users (provider, provider_id, email, name, role, password_hash, email_verified_at)
      VALUES ('local', ?, ?, ?, ?, ?, datetime('now'))
    `).run(email, email, name, role, await hashPassword(PASSWORD));
    for (const area of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, area);
    return { id, email, name };
  }

  async function signIn(email) {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD });
    return { agent, res };
  }

  // Sets two-step sign-in up from a signed-in session, as the setup page does.
  async function turnOn(agent) {
    const setup = await agent.post('/api/auth/two-step/setup').set('Origin', ORIGIN).send({});
    expect(setup.status).toBe(200);
    expect(setup.body.qr).toMatch(/^<svg/);
    const secret = setup.body.secret.replace(/\s/g, '');
    const enabled = await agent.post('/api/auth/two-step/enable').set('Origin', ORIGIN).send({ code: codeNow(secret) });
    expect(enabled.status).toBe(200);
    return { secret, recoveryCodes: enabled.body.recoveryCodes, user: enabled.body.user };
  }

  async function signInWithCode(email, code) {
    const { agent, res } = await signIn(email);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('two_step_required');
    const verified = await agent.post('/api/auth/two-step/verify').set('Origin', ORIGIN).send({ code });
    return { agent, verified };
  }

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('an admin without it reaches only the setup until it is on, then everything', async () => {
    const ada = await addLocal('Ada', 'admin');
    const { agent, res } = await signIn(ada.email);
    expect(res.status).toBe(200);
    expect(res.body.user.two_step).toMatchObject({ enabled: false, required: true });

    const blocked = await agent.get('/api/announcements');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('two_step_setup_required');
    // Including the admin routes that live under /auth.
    expect((await agent.get('/api/auth/users')).body.code).toBe('two_step_setup_required');
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    const { recoveryCodes, user } = await turnOn(agent);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    recoveryCodes.forEach(code => expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/));
    expect(user.two_step).toMatchObject({ enabled: true, required: true, recovery_codes_left: 10 });

    expect((await agent.get('/api/announcements')).status).toBe(200);
    // The secret and the codes never leave in a user record.
    const me = await agent.get('/api/auth/me');
    expect(JSON.stringify(me.body)).not.toMatch(/two_step_secret/);
  });

  test('once it is on, the password alone signs nobody in', async () => {
    const ada = await addLocal('Ada', 'admin');
    const { secret } = await turnOn((await signIn(ada.email)).agent);
    nextStep();

    const { agent, res } = await signIn(ada.email);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: 'two_step_required' });
    expect(res.body.user).toBeUndefined();

    // Halfway: /me says to ask for the code, and nothing else is open.
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('two_step_required');
    expect((await agent.get('/api/announcements')).status).toBe(401);

    const wrong = await agent.post('/api/auth/two-step/verify').set('Origin', ORIGIN).send({ code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('two_step_wrong');

    const right = await agent.post('/api/auth/two-step/verify').set('Origin', ORIGIN).send({ code: codeNow(secret) });
    expect(right.status).toBe(200);
    expect(right.body.user).toMatchObject({ id: ada.id, name: 'Ada' });
    expect((await agent.get('/api/announcements')).status).toBe(200);
  });

  test('the same code cannot be used twice', async () => {
    const ada = await addLocal('Ada', 'admin');
    const { secret } = await turnOn((await signIn(ada.email)).agent);
    nextStep();
    const code = codeNow(secret);
    expect((await signInWithCode(ada.email, code)).verified.status).toBe(200);
    const again = await signInWithCode(ada.email, code);
    expect(again.verified.status).toBe(401);
    expect(again.verified.body.code).toBe('two_step_wrong');
  });

  test('five wrong codes and the sign-in has to start again from the password', async () => {
    const ada = await addLocal('Ada', 'admin');
    const { secret } = await turnOn((await signIn(ada.email)).agent);
    nextStep();
    const { agent } = await signIn(ada.email);
    for (let i = 0; i < 4; i += 1) {
      const r = await agent.post('/api/auth/two-step/verify').set('Origin', ORIGIN).send({ code: '000000' });
      expect(r.body.code).toBe('two_step_wrong');
    }
    const fifth = await agent.post('/api/auth/two-step/verify').set('Origin', ORIGIN).send({ code: '000000' });
    expect(fifth.body.code).toBe('two_step_expired');
    const late = await agent.post('/api/auth/two-step/verify').set('Origin', ORIGIN).send({ code: codeNow(secret) });
    expect(late.status).toBe(401);
    expect(late.body.code).toBe('two_step_expired');
  });

  test('the code step times out after ten minutes', async () => {
    const ada = await addLocal('Ada', 'admin');
    const { secret } = await turnOn((await signIn(ada.email)).agent);
    nextStep();
    const { agent } = await signIn(ada.email);
    offsetMs += 11 * 60 * 1000;
    const r = await agent.post('/api/auth/two-step/verify').set('Origin', ORIGIN).send({ code: codeNow(secret) });
    expect(r.body.code).toBe('two_step_expired');
  });

  test('a recovery code gets in once, and is written to the action history', async () => {
    const ada = await addLocal('Ada', 'admin');
    const { recoveryCodes } = await turnOn((await signIn(ada.email)).agent);
    // Typed in lower case without the dash, as somebody reading it off paper might.
    const typed = recoveryCodes[3].toLowerCase().replace('-', '');
    const first = await signInWithCode(ada.email, typed);
    expect(first.verified.status).toBe(200);
    expect(first.verified.body.used).toBe('recovery');
    expect(first.verified.body.user.two_step.recovery_codes_left).toBe(9);
    expect((await signInWithCode(ada.email, recoveryCodes[3])).verified.status).toBe(401);
    const logged = db.prepare("SELECT summary FROM action_log WHERE summary LIKE '%recovery code%'").all();
    expect(logged).toEqual([{ summary: 'Ada signed in with a recovery code' }]);
  });

  test('new recovery codes replace the old ones, and need a code to make', async () => {
    const ada = await addLocal('Ada', 'admin');
    const { agent } = await signIn(ada.email);
    const { secret, recoveryCodes } = await turnOn(agent);
    nextStep();
    const refused = await agent.post('/api/auth/two-step/recovery-codes').set('Origin', ORIGIN).send({ code: '000000' });
    expect(refused.status).toBe(400);
    const fresh = await agent.post('/api/auth/two-step/recovery-codes').set('Origin', ORIGIN).send({ code: codeNow(secret) });
    expect(fresh.status).toBe(200);
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    expect((await signInWithCode(ada.email, recoveryCodes[0])).verified.status).toBe(401);
    expect((await signInWithCode(ada.email, fresh.body.recoveryCodes[0])).verified.status).toBe(200);
  });

  test('a session from before it was turned on has to sign in again', async () => {
    const ada = await addLocal('Ada', 'admin');
    const laptop = (await signIn(ada.email)).agent;
    const phone  = (await signIn(ada.email)).agent;
    await turnOn(laptop);
    expect((await laptop.get('/api/announcements')).status).toBe(200);
    expect((await phone.get('/api/announcements')).status).toBe(401);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
  });

  test('a directory manager has to use it; other members may choose', async () => {
    const dot = await addLocal('Dot', 'approved', ['directory']);
    const sam = await addLocal('Sam', 'approved', ['songs']);
    const dotIn = await signIn(dot.email);
    expect(dotIn.res.body.user.two_step.required).toBe(true);
    expect((await dotIn.agent.get('/api/announcements')).body.code).toBe('two_step_setup_required');

    const samIn = await signIn(sam.email);
    expect(samIn.res.body.user.two_step).toMatchObject({ required: false, enabled: false });
    expect((await samIn.agent.get('/api/announcements')).status).toBe(200);
  });

  test('a member who chose it can turn it off again with a code; an admin cannot', async () => {
    const sam = await addLocal('Sam');
    const ada = await addLocal('Ada', 'admin');
    const samAgent = (await signIn(sam.email)).agent;
    const adaAgent = (await signIn(ada.email)).agent;
    const samOn = await turnOn(samAgent);
    const adaOn = await turnOn(adaAgent);
    nextStep();

    expect((await samAgent.post('/api/auth/two-step/disable').set('Origin', ORIGIN).send({ code: '000000' })).status).toBe(400);
    const off = await samAgent.post('/api/auth/two-step/disable').set('Origin', ORIGIN).send({ code: codeNow(samOn.secret) });
    expect(off.status).toBe(200);
    expect(off.body.user.two_step.enabled).toBe(false);
    expect((await signIn(sam.email)).res.status).toBe(200);

    const adaOff = await adaAgent.post('/api/auth/two-step/disable').set('Origin', ORIGIN).send({ code: codeNow(adaOn.secret) });
    expect(adaOff.status).toBe(403);
  });

  test('the setup QR code has to be confirmed with a code from it, and expires', async () => {
    const ada = await addLocal('Ada', 'admin');
    const { agent } = await signIn(ada.email);
    await agent.post('/api/auth/two-step/setup').set('Origin', ORIGIN).send({});
    const wrong = await agent.post('/api/auth/two-step/enable').set('Origin', ORIGIN).send({ code: '123456' });
    expect(wrong.status).toBe(400);
    const setup = await agent.post('/api/auth/two-step/setup').set('Origin', ORIGIN).send({});
    offsetMs += 16 * 60 * 1000;
    const late = await agent.post('/api/auth/two-step/enable').set('Origin', ORIGIN)
      .send({ code: codeNow(setup.body.secret.replace(/\s/g, '')) });
    expect(late.body.code).toBe('setup_expired');
  });

  test('another admin can reset it for somebody who lost their phone, and it is recorded', async () => {
    const ada = await addLocal('Ada', 'admin');
    const bea = await addLocal('Bea', 'admin');
    const adaAgent = (await signIn(ada.email)).agent;
    const beaOn = await turnOn((await signIn(bea.email)).agent);
    await turnOn(adaAgent);

    // Not your own: that is what recovery codes are for.
    const self = await adaAgent.delete(`/api/auth/users/${ada.id}/two-step`).set('Origin', ORIGIN);
    expect(self.status).toBe(400);

    const list = await adaAgent.get('/api/auth/users');
    const beaRow = list.body.users.find(u => u.id === bea.id);
    expect(beaRow.two_step_enabled_at).toBeTruthy();
    expect(beaRow.two_step_required).toBe(true);
    expect(JSON.stringify(list.body)).not.toMatch(/two_step_secret|code_hash/);

    const reset = await adaAgent.delete(`/api/auth/users/${bea.id}/two-step`).set('Origin', ORIGIN);
    expect(reset.status).toBe(200);
    expect(reset.body.user.two_step_enabled_at).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM two_step_recovery_codes WHERE user_id = ?').get(bea.id).n).toBe(0);
    expect(db.prepare("SELECT summary FROM action_log WHERE summary LIKE 'Reset two-step%'").all())
      .toEqual([{ summary: 'Reset two-step sign-in for Bea' }]);

    // Bea signs in with her password, and is asked to set it up again.
    nextStep();
    const again = await signIn(bea.email);
    expect(again.res.status).toBe(200);
    expect((await again.agent.get('/api/announcements')).body.code).toBe('two_step_setup_required');
    // Her old recovery codes are gone with it.
    expect(beaOn.recoveryCodes).toHaveLength(10);
  });

  test('a member cannot reset anybody\'s', async () => {
    const sam = await addLocal('Sam');
    const ada = await addLocal('Ada', 'admin');
    await turnOn((await signIn(ada.email)).agent);
    const samAgent = (await signIn(sam.email)).agent;
    expect((await samAgent.delete(`/api/auth/users/${ada.id}/two-step`).set('Origin', ORIGIN)).status).toBe(403);
  });

  test('it cannot be set up while viewing the portal as a member', async () => {
    const ada = await addLocal('Ada', 'admin');
    const sam = await addLocal('Sam');
    const { agent } = await signIn(ada.email);
    await turnOn(agent);
    await agent.post('/api/auth/impersonate').set('Origin', ORIGIN).send({ userId: sam.id });
    const r = await agent.post('/api/auth/two-step/setup').set('Origin', ORIGIN).send({});
    expect(r.status).toBe(403);
  });

  test('TWO_STEP_REQUIRED=off lifts the requirement but leaves anybody\'s own setting alone', async () => {
    app = buildApp({ TWO_STEP_REQUIRED: 'off' });
    const ada = await addLocal('Ada', 'admin');
    const { agent, res } = await signIn(ada.email);
    expect(res.body.user.two_step.required).toBe(false);
    expect((await agent.get('/api/announcements')).status).toBe(200);
    await turnOn(agent);
    nextStep();
    expect((await signIn(ada.email)).res.body.code).toBe('two_step_required');
  });
});

describe('the server command for the last admin', () => {
  test('turns it off for the address given and records it', () => {
    const Database = require('better-sqlite3');
    const { initSchema } = require('../schema');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capshaw-two-step-'));
    const file = path.join(dir, 'reset.db');
    const db = new Database(file);
    initSchema(db);
    const { lastInsertRowid: id } = db.prepare(`
      INSERT INTO users (provider, provider_id, email, name, role, two_step_secret, two_step_enabled_at)
      VALUES ('local', 'ada@example.com', 'Ada@Example.com', 'Ada', 'admin', 'ABCDEFGH', datetime('now'))
    `).run();
    db.prepare("INSERT INTO two_step_recovery_codes (user_id, code_hash) VALUES (?, 'x')").run(id);
    db.close();

    const script = path.join(__dirname, '..', 'tools', 'reset-two-step.js');
    const env = { ...ORIGINAL_ENV, CAPSHAW_DB_FILE: file };
    const out = execFileSync(process.execPath, [script, 'ada@example.com'], { env, encoding: 'utf8' });
    expect(out).toMatch(/Ada .*two-step sign-in reset/);

    const after = new Database(file, { readonly: true });
    expect(after.prepare('SELECT two_step_secret, two_step_enabled_at FROM users WHERE id = ?').get(id))
      .toEqual({ two_step_secret: '', two_step_enabled_at: null });
    expect(after.prepare('SELECT COUNT(*) AS n FROM two_step_recovery_codes').get().n).toBe(0);
    expect(after.prepare('SELECT summary FROM action_log').all())
      .toEqual([{ summary: 'Reset two-step sign-in for Ada from the server' }]);
    after.close();

    // An address nobody has is an error, not a silent success.
    expect(() => execFileSync(process.execPath, [script, 'nobody@example.com'], { env, stdio: 'pipe' })).toThrow();
  });
});
