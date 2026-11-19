// The Sunday "Your week" email: each member's own My Week page, once a week,
// never empty, with an opt-out — and, while mail is in test mode, only to the
// people let through on Email Delivery.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const myWeek = require('../mail/myWeek');
const delivery = require('../mail/delivery');
const profileRouter = require('../routes/profile');

// Sunday 2026-11-22. Church time is UTC-6 in November.
const SUNDAY_6AM = new Date('2026-11-22T12:00:00Z');
const SUNDAY_7AM = new Date('2026-11-22T13:00:00Z');
const SUNDAY_9PM = new Date('2026-11-23T03:00:00Z');
const SATURDAY_9AM = new Date('2026-11-21T15:00:00Z');

const run = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);
function addMember(name, { role = 'approved', email = `${name.toLowerCase()}@example.invalid` } = {}) {
  const person = run('INSERT INTO directory (name) VALUES (?)', `${name} Reed`);
  const id = run('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)',
    'local', `${name}-id`, email, name, role, person);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
const serve = (name, date, job = 'Opening Prayer') =>
  run("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('November 2026', ?, 'Sunday Worship', ?, ?)", date, job, name);
const outbox = () => db.prepare('SELECT * FROM mail_outbox ORDER BY id').all();

const savedRedirect = process.env.MAIL_REDIRECT_TO;
let tom, ann;

beforeEach(() => {
  for (const t of ['my_week_emails', 'mail_outbox', 'mail_redirect_rules', 'job_assignments', 'users', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  process.env.MAIL_REDIRECT_TO = ''; // sending for real, unless a test says otherwise
  tom = addMember('Tom');
  ann = addMember('Ann');
  serve('Tom Reed', 'November 22');
  serve('Tom Reed', 'November 25', 'Song Leader');
  serve('Tom Reed', 'December 2', 'Usher'); // the week after
});

afterAll(() => {
  if (savedRedirect === undefined) delete process.env.MAIL_REDIRECT_TO;
  else process.env.MAIL_REDIRECT_TO = savedRedirect;
});

describe('when it goes', () => {
  test('Sunday from 7 AM church time, not before and not on other days', () => {
    expect(myWeek.tick(SATURDAY_9AM)).toEqual([]);
    expect(myWeek.tick(SUNDAY_6AM)).toEqual([]);
    expect(outbox()).toEqual([]);
    expect(myWeek.tick(SUNDAY_7AM)).toEqual([expect.objectContaining({ userId: tom.id, items: 3 })]);
  });

  test('once per member per Sunday, however often it ticks', () => {
    myWeek.tick(SUNDAY_7AM);
    myWeek.tick(SUNDAY_7AM);
    myWeek.tick(SUNDAY_9PM);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ to_email: 'tom@example.invalid', context: `my-week:${tom.id}:2026-11-22` });
  });

  test('nobody with nothing on their list is sent an empty email', () => {
    myWeek.tick(SUNDAY_7AM);
    expect(outbox().map(r => r.to_email)).toEqual(['tom@example.invalid']);
    // Ann was looked at and skipped, so she is not built again every tick.
    expect(db.prepare('SELECT items FROM my_week_emails WHERE user_id = ?').get(ann.id)).toEqual({ items: 0 });
  });

  test('pending accounts and accounts with no address are left out', () => {
    const pat = addMember('Pat', { role: 'pending' });
    const nia = addMember('Nia', { email: '' });
    serve('Pat Reed', 'November 23');
    serve('Nia Reed', 'November 23');
    myWeek.tick(SUNDAY_7AM);
    expect(outbox().map(r => r.to_email)).toEqual(['tom@example.invalid']);
    expect(myWeek.readers().map(u => u.id)).not.toEqual(expect.arrayContaining([pat.id, nia.id]));
  });
});

describe('opting out', () => {
  function app(user) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.user = user; next(); });
    a.use('/api/profile', profileRouter);
    return a;
  }

  test('a member turns it off on their own account, and it is not sent', async () => {
    const res = await request(app(tom)).patch('/api/profile/notifications').send({ weeklyEmail: false });
    expect(res.body).toEqual({ success: true, notifications: { monthlyReport: true, weeklyEmail: false } });
    myWeek.tick(SUNDAY_7AM);
    expect(outbox()).toEqual([]);
  });

  test('turning one off leaves the other as it was', async () => {
    await request(app(tom)).patch('/api/profile/notifications').send({ monthlyReport: false });
    const row = db.prepare('SELECT wants_monthly_report, wants_weekly_email FROM users WHERE id = ?').get(tom.id);
    expect(row).toEqual({ wants_monthly_report: 0, wants_weekly_email: 1 });
  });

  test('anything but true or false is refused', async () => {
    expect((await request(app(tom)).patch('/api/profile/notifications').send({ weeklyEmail: 'no' })).status).toBe(400);
    expect((await request(app(tom)).patch('/api/profile/notifications').send({})).status).toBe(400);
  });
});

describe('in test mode', () => {
  beforeEach(() => { process.env.MAIL_REDIRECT_TO = 'tester@example.invalid'; });

  test('nobody is redirected: members not let through are skipped, not mailed to the test inbox', () => {
    expect(myWeek.tick(SUNDAY_7AM)).toEqual([]);
    expect(outbox()).toEqual([]);
    // And not claimed, so they get it if let through later that Sunday.
    expect(db.prepare('SELECT COUNT(*) AS n FROM my_week_emails').get().n).toBe(0);
  });

  test('somebody let through on Email Delivery gets their own', () => {
    delivery.setPerson({ email: 'tom@example.invalid', deliver: true }, { name: 'Admin' });
    myWeek.tick(SUNDAY_7AM);
    expect(outbox()).toEqual([expect.objectContaining({ to_email: 'tom@example.invalid', intended_for: '' })]);
  });
});

describe('what it says', () => {
  const week = {
    from: '2026-11-22', to: '2026-12-05', linked: true, name: 'Tom Reed',
    items: [
      { kind: 'job', id: 1, date: '2026-11-22', service: 'Sunday Worship', job: 'Opening Prayer', replacementAsked: false },
      { kind: 'meeting', id: 2, date: '2026-11-25', time: '18:00', title: 'Singing night', group: 'Young Families', location: '', rsvp: 'unanswered', guests: 0, bringing: [] },
      { kind: 'job', id: 3, date: '2026-12-02', service: 'Wednesday', job: 'Usher', replacementAsked: true },
    ],
    nextUp: [{ rotationId: 4, title: 'Baby shower hosts' }],
  };

  test('this week by day, the week after in brief, and what is waiting on them', () => {
    const { subject, body, html } = myWeek.compose.myWeek({ week });
    expect(subject).toBe('Your week: 2 things, November 22–28');
    expect(body).toMatch(/^Tom,/);
    expect(body).toContain('Sunday, November 22\n  • Serving: Opening Prayer — Sunday Worship');
    expect(body).toContain('  • Group: Singing night — Young Families · 6:00 PM\n    They are waiting on your answer');
    expect(body).toContain('One group is waiting on your answer.');
    expect(body).toContain('The week after\n  • Wed Dec 2 · Usher');
    const later = myWeek.compose.myWeek({ week: { ...week, items: [{ ...week.items[1], date: '2026-12-01' }] } });
    expect(later.body).toContain('  • Tue Dec 1 · Singing night (waiting on your answer)');
    expect(body).toContain('You are next up for Baby shower hosts.');
    expect(body).toMatch(/My Week: http\S+\?page=my-week/);
    expect(body).toMatch(/turn off "Your week, every Sunday" under My Household & Preferences: http\S+\?page=profile/);
    expect(html).toContain('Tom&#39;s week');
    expect(html).toContain('Open My Week');
  });

  test('a fortnight with only the week after still says this week is clear', () => {
    const { subject, body } = myWeek.compose.myWeek({ week: { ...week, items: [week.items[2]], nextUp: [] } });
    expect(subject).toBe('Your week: November 22–28');
    expect(body).toContain('Nothing is on your list for this week, November 22–28.');
  });

  test('member text is escaped in the HTML', () => {
    const { html } = myWeek.compose.myWeek({ week: { ...week, items: [{ ...week.items[0], job: '<b>Usher</b>' }] } });
    expect(html).toContain('&lt;b&gt;Usher&lt;/b&gt;');
    expect(html).not.toContain('<b>Usher</b>');
  });
});
