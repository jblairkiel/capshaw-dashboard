// The weekly reports: when they are sent, to whom, with what attached, and
// who may see them on the portal. Sunday at 3 PM unless an admin says otherwise.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const mail = require('../mail/weeklyReports');
const router = require('../routes/reports');

// Church time is Central: 3:05 PM on Sunday 15 November 2026 is 21:05 UTC.
const at = (iso, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), h + 6, m));
};

function addUser(name, { role = 'approved', areas = [] } = {}) {
  const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)')
    .run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, role).lastInsertRowid;
  for (const a of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, a);
  return { ...db.prepare('SELECT * FROM users WHERE id = ?').get(id), areas };
}

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/reports', router);
  return app;
}

const outbox = () => db.prepare('SELECT * FROM mail_outbox ORDER BY id').all();

let ADMIN, ELDER, DEACON, MEMBER;
beforeEach(() => {
  for (const t of ['mail_outbox', 'scheduled_jobs', 'action_log', 'visitor_visits', 'visitors', 'attendance', 'user_areas', 'users']) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("UPDATE report_settings SET weekday = 0, send_time = '15:00', enabled = 1").run();
  ADMIN = addUser('Ada', { role: 'admin' });
  ELDER = addUser('Eli', { areas: ['summary-report', 'analytical-report'] });
  DEACON = addUser('Dee', { areas: ['summary-report'] });
  MEMBER = addUser('Mel');
  db.prepare('INSERT INTO attendance (date, service, count) VALUES (?, ?, ?)').run('2026-11-08', 'Sunday AM Worship', 212);
  const v = db.prepare("INSERT INTO visitors (name, created_at) VALUES ('Jo Reed', datetime('now'))").run().lastInsertRowid;
  db.prepare("INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?, '11/08/26', 'Sunday AM Worship')").run(v);
});

describe('when they are sent', () => {
  test('both start as Sunday at 3 PM, switched on', () => {
    expect(mail.settings().map(s => [s.kind, s.weekday, s.time, s.enabled])).toEqual([
      ['summary', 0, '15:00', true], ['analytical', 0, '15:00', true],
    ]);
  });

  test('a report covers the week ending the Saturday before, or that day\'s week on a Saturday', () => {
    expect(mail.weekEndingFor(0, '2026-11-15')).toBe('2026-11-14');
    expect(mail.weekEndingFor(1, '2026-11-16')).toBe('2026-11-14');
    expect(mail.weekEndingFor(6, '2026-11-14')).toBe('2026-11-14');
  });

  test('due on the day at the time, and not before', () => {
    const sunday = { weekday: 0, time: '15:00' };
    expect(mail.lastDue(sunday, at('2026-11-15', '14:59'))).toBe('2026-11-08');
    expect(mail.lastDue(sunday, at('2026-11-15', '15:00'))).toBe('2026-11-15');
    expect(mail.lastDue(sunday, at('2026-11-18', '09:00'))).toBe('2026-11-15');
  });

  test('sent once when due, to whoever holds each report, with the PDF attached', () => {
    mail.tick(at('2026-11-14', '12:00'));                  // first start-up: notes where it is, sends nothing
    expect(outbox()).toEqual([]);

    const sent = mail.tick(at('2026-11-15', '15:05'));
    expect(sent.map(s => [s.kind, s.week, s.sent])).toEqual([['summary', '2026-11-08', 2], ['analytical', '2026-11-08', 1]]);
    const rows = outbox();
    expect(rows.map(r => r.intended_for || r.to_email).sort()).toEqual(['dee@example.com', 'eli@example.com', 'eli@example.com']);
    const summary = rows.find(r => r.context === 'weekly-report:summary:2026-11-08');
    expect(summary.subject).toBe('Weekly Summary: November 8–14, 2026');
    expect(summary.body).toContain('Sunday AM Worship: 212');
    expect(JSON.parse(summary.attachments)[0]).toMatchObject({ filename: 'Weekly Summary - November 8-14, 2026.pdf', contentType: 'application/pdf' });

    expect(mail.tick(at('2026-11-15', '15:20'))).toEqual([]);
    expect(mail.tick(at('2026-11-17', '08:00'))).toEqual([]);
  });

  test('a report nobody holds goes to the admins', () => {
    db.prepare("DELETE FROM user_areas WHERE area = 'analytical-report'").run();
    mail.tick(at('2026-11-14', '12:00'));
    mail.tick(at('2026-11-15', '15:05'));
    const analytical = outbox().filter(r => r.context.startsWith('weekly-report:analytical'));
    expect(analytical.map(r => r.intended_for || r.to_email)).toEqual(['ada@example.com']);
  });

  test('moving the day does not set it off at once, and a report switched off is not sent', () => {
    mail.tick(at('2026-11-14', '12:00'));
    // updateSetting reads the clock itself, so the change is made on the same
    // simulated Saturday — on the real date the "moment just passed" would be
    // a later Monday, and this test started failing once that Monday came.
    jest.useFakeTimers({ now: at('2026-11-14', '12:01'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      mail.updateSetting('summary', { weekday: 1, time: '09:00' }, ADMIN);
      mail.updateSetting('analytical', { enabled: false }, ADMIN);
    } finally {
      jest.useRealTimers();
    }
    expect(mail.tick(at('2026-11-15', '15:05'))).toEqual([]);
    expect(mail.tick(at('2026-11-16', '09:01')).map(s => s.kind)).toEqual(['summary']);
  });
});

describe('on the portal', () => {
  test('each report is for whoever receives it, and the admins', async () => {
    expect((await request(buildApp(DEACON)).get('/api/reports')).body.reports.map(r => r.kind)).toEqual(['summary']);
    expect((await request(buildApp(ELDER)).get('/api/reports')).body.reports.map(r => r.kind)).toEqual(['summary', 'analytical']);
    expect((await request(buildApp(MEMBER)).get('/api/reports')).body.reports).toEqual([]);
    expect((await request(buildApp(DEACON)).get('/api/reports/analytical')).status).toBe(403);
    expect((await request(buildApp(ADMIN)).get('/api/reports/analytical')).status).toBe(200);
  });

  test('a week can be chosen, and the summary names nobody', async () => {
    const summary = (await request(buildApp(DEACON)).get('/api/reports/summary').query({ week: '2026-11-10' })).body.report;
    expect(summary.week).toMatchObject({ start: '2026-11-08', end: '2026-11-14' });
    expect(summary.week.guests).toMatchObject({ visits: 1, list: [] });
    const analytical = (await request(buildApp(ELDER)).get('/api/reports/analytical').query({ week: '2026-11-10' })).body.report;
    expect(analytical.week.guests.list.map(g => g.name)).toEqual(['Jo Reed']);
  });

  test('the PDF downloads', async () => {
    const res = await request(buildApp(ELDER)).get('/api/reports/summary/pdf').query({ week: '2026-11-10' });
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('Weekly Summary - November 8-14, 2026.pdf');
  });

  test('only an admin changes when they are sent, and a bad time is refused', async () => {
    expect((await request(buildApp(ELDER)).put('/api/reports/settings/summary').send({ weekday: 1 })).status).toBe(403);
    expect((await request(buildApp(ADMIN)).put('/api/reports/settings/summary').send({ time: '25:00' })).body.error).toMatch(/hours and minutes/);
    const ok = await request(buildApp(ADMIN)).put('/api/reports/settings/summary').send({ weekday: 6, time: '16:30' });
    expect(ok.body.setting).toMatchObject({ weekday: 6, time: '16:30', enabled: true });
    expect(db.prepare('SELECT summary FROM action_log').get().summary).toBe('Set the Weekly Summary to send on Saturdays at 16:30');
  });

  test('an admin can send one now', async () => {
    const res = await request(buildApp(ADMIN)).post('/api/reports/analytical/send').send({ week: '2026-11-10' });
    expect(res.body).toMatchObject({ kind: 'analytical', week: '2026-11-08', sent: 1 });
    expect((await request(buildApp(ELDER)).post('/api/reports/analytical/send')).status).toBe(403);
  });
});
