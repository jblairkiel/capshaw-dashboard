// The Build a month wizard: its plan of the month, leaving dates out, a
// month's own jobs, special services, the preview that saves nothing, and
// the choices remembered for next month.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const servingRouter = require('../routes/serving');
const { seeded } = require('../lib/rosterBuild');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/serving', servingRouter);
  return app;
}

function addUser(name, areas = []) {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)')
    .run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, 'approved');
  for (const a of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, a);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Men glad to do every job, so a fill has plenty of ties to break.
function addMen(n) {
  const jobs = ['Song Leader', 'Opening Prayer', 'Closing Prayer', 'Scripture Reading', 'Communion', 'Communion Assist', 'Speaker', 'Announcements', 'Usher'];
  for (let i = 1; i <= n; i++) {
    const id = db.prepare("INSERT INTO directory (name, gender) VALUES (?, 'male')").run(`Man ${String(i).padStart(2, '0')}`).lastInsertRowid;
    for (const job of jobs) db.prepare("INSERT INTO worship_preferences (directory_id, role, level) VALUES (?, ?, 'preferred')").run(id, job);
  }
}

const slotsIn = month => db.prepare('SELECT * FROM job_assignments WHERE month = ? ORDER BY id').all(month);
const names = rows => rows.map(r => `${r.date}|${r.service}|${r.job}|${r.name}`).sort();

let KEEPER, MEMBER;
const keeper = () => request(buildApp(KEEPER));

beforeEach(() => {
  for (const t of ['action_log', 'job_assignments', 'service_jobs', 'serving_settings', 'worship_preferences', 'job_blackouts', 'user_areas', 'users', 'directory']) db.prepare(`DELETE FROM ${t}`).run();
  KEEPER = addUser('Cora', ['serving-schedule']);
  MEMBER = addUser('Mel');
  addMen(20);
});

describe('GET /api/serving/months/plan — step one', () => {
  test('lists each service\'s dates, what is already built, and the specials planned', async () => {
    db.prepare("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('June 2026', 'June 7', 'Sunday Worship', 'Song Leader', 'Man 01')").run();
    db.prepare("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('June 2026', 'June 19', 'Gospel Meeting', 'Speaker', '')").run();
    db.prepare("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('June 2026', 'June 18', 'Gospel Meeting', 'Speaker', 'Man 02')").run();

    const res = await keeper().get('/api/serving/months/plan?month=June%202026');
    expect(res.status).toBe(200);
    const sunday = res.body.services.find(s => s.service === 'Sunday Worship');
    expect(sunday.dates.map(d => d.date)).toEqual(['June 7', 'June 14', 'June 21', 'June 28']);
    expect(sunday.dates[0]).toEqual({ date: 'June 7', iso: '2026-06-07', slots: 1, filled: 1 });
    expect(sunday.jobs.filter(j => j === 'Communion Assist')).toHaveLength(6);
    expect(res.body.services.find(s => s.service === 'Wednesday').dates.map(d => d.date)).toEqual(['June 3', 'June 10', 'June 17', 'June 24']);
    expect(res.body.specials).toEqual([{ service: 'Gospel Meeting', dates: ['June 18', 'June 19'], slots: 2, open: 1 }]);
    expect(res.body.settings).toEqual({ services: ['Sunday Worship', 'Sunday Evening', 'Wednesday'], fill: true, fillSpecials: true });
  });

  test('is the schedule keeper\'s alone, and wants a real month', async () => {
    expect((await request(buildApp(MEMBER)).get('/api/serving/months/plan?month=June%202026')).status).toBe(403);
    expect((await keeper().get('/api/serving/months/plan?month=Junember')).status).toBe(400);
  });
});

describe('POST /api/serving/months — the wizard\'s build', () => {
  test('a date left out gets no slots, and its slots already there are not filled', async () => {
    db.prepare("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('June 2026', 'June 14', 'Sunday Evening', 'Song Leader', '')").run();
    const res = await keeper().post('/api/serving/months').send({
      month: 'June 2026', services: ['Sunday Evening'], skip: ['June 7|Sunday Evening', 'June 14|Sunday Evening'], fillSpecials: false,
    });
    expect(res.status).toBe(200);
    const evening = slotsIn('June 2026');
    expect(evening.some(s => s.date === 'June 7')).toBe(false);
    expect(evening.find(s => s.date === 'June 14').name).toBe('');
    expect(new Set(evening.filter(s => s.date !== 'June 14').map(s => s.date))).toEqual(new Set(['June 21', 'June 28']));
    expect(evening.filter(s => s.date !== 'June 14').every(s => s.name)).toBe(true);
  });

  test('every date left out is refused', async () => {
    const skip = ['June 3', 'June 10', 'June 17', 'June 24'].map(d => `${d}|Wednesday`);
    const res = await keeper().post('/api/serving/months').send({ month: 'June 2026', services: ['Wednesday'], skip });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nothing to build/);
  });

  test('a month\'s own jobs are used for that month, and become the usual ones only when asked', async () => {
    const jobs = { 'Sunday Worship': ['Song Leader', ...Array(4).fill('Communion Assist')] };
    await keeper().post('/api/serving/months').send({ month: 'June 2026', services: ['Sunday Worship'], jobs, fill: false });
    const june7 = slotsIn('June 2026').filter(s => s.date === 'June 7').map(s => s.job);
    expect(june7).toEqual(['Song Leader', 'Communion Assist', 'Communion Assist', 'Communion Assist', 'Communion Assist']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM service_jobs').get().n).toBe(0);

    await keeper().post('/api/serving/months').send({ month: 'July 2026', services: ['Sunday Worship'], jobs, saveJobs: ['Sunday Worship'], fill: false });
    expect(JSON.parse(db.prepare("SELECT jobs FROM service_jobs WHERE service = 'Sunday Worship'").get().jobs)).toEqual(jobs['Sunday Worship']);
    expect(db.prepare("SELECT summary FROM action_log ORDER BY id DESC").get().summary).toMatch(/made this month's jobs the usual ones for Sunday Worship/);
  });

  test('jobs that are not worship jobs, or too many of one, are refused', async () => {
    const bad = await keeper().post('/api/serving/months').send({ month: 'June 2026', jobs: { Wednesday: ['Juggler'] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/^Wednesday: "Juggler" is not one of the worship jobs/);
    const many = await keeper().post('/api/serving/months').send({ month: 'June 2026', jobs: { Wednesday: Array(9).fill('Song Leader') } });
    expect(many.body.error).toMatch(/No more than 8/);
  });

  test('special services already planned are filled only when the keeper says so', async () => {
    db.prepare("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('June 2026', 'June 18', 'Gospel Meeting', 'Song Leader', '')").run();
    await keeper().post('/api/serving/months').send({ month: 'June 2026', services: ['Wednesday'], fillSpecials: false });
    expect(slotsIn('June 2026').find(s => s.service === 'Gospel Meeting').name).toBe('');
    await keeper().post('/api/serving/months').send({ month: 'June 2026', services: ['Wednesday'], fillSpecials: true });
    expect(slotsIn('June 2026').find(s => s.service === 'Gospel Meeting').name).not.toBe('');
  });
});

describe('the preview', () => {
  test('shows the whole month as it would be, and saves nothing', async () => {
    const res = await keeper().post('/api/serving/months').send({ month: 'June 2026', preview: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preview: true, month: 'June 2026' });
    expect(Number.isInteger(res.body.seed)).toBe(true);
    expect(res.body.created).toBeGreaterThan(0);
    expect(res.body.assignments).toHaveLength(res.body.created);
    expect(res.body.assignments.every(a => a.isNew && a.justFilled && a.name)).toBe(true);
    expect(slotsIn('June 2026')).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM action_log').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM serving_settings').get().n).toBe(0);
  });

  test('saving with the preview\'s seed keeps exactly the names that were shown', async () => {
    const body = { month: 'June 2026', services: ['Sunday Worship', 'Wednesday'], skip: ['June 21|Sunday Worship'], fillSpecials: false };
    const shown = (await keeper().post('/api/serving/months').send({ ...body, preview: true })).body;
    const again = (await keeper().post('/api/serving/months').send({ ...body, preview: true, seed: shown.seed + 1 })).body;
    // A different draw really is different, so keeping the shown one matters.
    expect(names(again.assignments)).not.toEqual(names(shown.assignments));

    const saved = await keeper().post('/api/serving/months').send({ ...body, seed: shown.seed });
    expect(saved.body.preview).toBe(false);
    expect(names(slotsIn('June 2026'))).toEqual(names(shown.assignments));
  });

  test('a month partly built shows which slots are new and which names are just put in', async () => {
    db.prepare("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('June 2026', 'June 3', 'Wednesday', 'Song Leader', 'Man 05')").run();
    db.prepare("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('June 2026', 'June 3', 'Wednesday', 'Opening Prayer', '')").run();
    const { assignments } = (await keeper().post('/api/serving/months').send({ month: 'June 2026', services: ['Wednesday'], preview: true })).body;
    const june3 = assignments.filter(a => a.date === 'June 3');
    expect(june3.find(a => a.job === 'Song Leader')).toMatchObject({ name: 'Man 05', isNew: false, justFilled: false });
    expect(june3.find(a => a.job === 'Opening Prayer')).toMatchObject({ isNew: false, justFilled: true });
    expect(june3.find(a => a.job === 'Closing Prayer')).toMatchObject({ isNew: true, justFilled: true });
  });

  test('the seeded draw repeats itself', () => {
    const a = seeded(42), b = seeded(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seeded(43)()).not.toBe(seeded(42)());
  });
});

describe('remembered choices', () => {
  test('a saved build is where next month\'s wizard starts; a preview is not', async () => {
    await keeper().post('/api/serving/months').send({ month: 'June 2026', services: ['Wednesday'], fill: false, fillSpecials: false, preview: true });
    expect((await keeper().get('/api/serving/months/plan?month=July%202026')).body.settings.services).toHaveLength(3);

    // A month with no special services says nothing about filling them.
    await keeper().post('/api/serving/months').send({ month: 'June 2026', services: ['Wednesday', 'Sunday Worship'], fill: false, fillSpecials: false });
    expect((await keeper().get('/api/serving/months/plan?month=July%202026')).body.settings)
      .toEqual({ services: ['Sunday Worship', 'Wednesday'], fill: false, fillSpecials: true });

    db.prepare("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('July 2026', 'July 16', 'Gospel Meeting', 'Speaker', '')").run();
    await keeper().post('/api/serving/months').send({ month: 'July 2026', services: ['Wednesday'], fillSpecials: false });
    expect((await keeper().get('/api/serving/months/plan?month=August%202026')).body.settings)
      .toEqual({ services: ['Wednesday'], fill: true, fillSpecials: false });
  });
});
