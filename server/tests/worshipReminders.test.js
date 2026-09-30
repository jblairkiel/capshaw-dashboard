// The song leader's reminders: four days and one day before the service they
// are down to lead, each once, saying where the service stands and linking
// straight to it.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const reminders = require('../mail/worshipReminders');
const plans = require('../lib/worshipPlans');
const router = require('../routes/worship');

const SUNDAY = '2026-10-04';
// Sunday AM Worship starts at 9:50 church time: 14:50 UTC in October.
const START = Date.parse('2026-10-04T14:50:00Z');
const hoursBefore = h => new Date(START - h * 3_600_000);

const ORGANIZER = { id: 2, name: 'Olive Organizer', role: 'approved', areas: ['worship-order'] };
const MEMBER = { id: 5, name: 'Mo Member', role: 'approved', areas: [] };

beforeAll(() => {
  const add = db.prepare("INSERT INTO users (id, provider, provider_id, name, email, role) VALUES (?, 'local', ?, ?, ?, ?)");
  for (const u of [ORGANIZER, MEMBER]) add.run(u.id, `u${u.id}`, u.name, `u${u.id}@example.invalid`, u.role);
  db.prepare("INSERT INTO user_areas (user_id, area) VALUES (2, 'worship-order')").run();
});

let lee;
beforeEach(() => {
  for (const t of ['worship_reminders', 'worship_plan_items', 'worship_plans', 'song_requests', 'job_assignments', 'mail_outbox', 'action_log']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare("DELETE FROM directory WHERE name = 'Lee Leader'").run();
  lee = db.prepare("INSERT INTO directory (name, email) VALUES ('Lee Leader', 'lee@example.invalid')").run().lastInsertRowid;
  db.prepare("INSERT INTO job_assignments (month, date, service, job, name) VALUES ('October 2026', 'October 4', 'Sunday Worship', 'Song Leader', 'Leader, Lee')").run();
  db.prepare("UPDATE service_types SET start_time = '09:50' WHERE name = 'Sunday AM Worship'").run();
});

const outbox = () => db.prepare('SELECT * FROM mail_outbox ORDER BY id').all();

describe('when they go', () => {
  test('four days before, then the day before, each once', () => {
    expect(reminders.tick(hoursBefore(97))).toEqual([]);

    expect(reminders.tick(hoursBefore(95))).toEqual([{ date: SUNDAY, service: 'Sunday AM Worship', kind: 'first', leader: 'Leader, Lee' }]);
    expect(reminders.tick(hoursBefore(80))).toEqual([]);

    expect(reminders.tick(hoursBefore(23)).map(r => r.kind)).toEqual(['final']);
    expect(reminders.tick(hoursBefore(2))).toEqual([]);
    expect(reminders.tick(hoursBefore(-1))).toEqual([]);

    const mail = outbox();
    expect(mail.map(m => m.context)).toEqual([`worship-reminder:${SUNDAY}:first`, `worship-reminder:${SUNDAY}:final`]);
    expect(mail.every(m => (m.intended_for || m.to_email) === 'lee@example.invalid')).toBe(true);
  });

  test('a server that was down past the four-day mark sends only the final one', () => {
    expect(reminders.tick(hoursBefore(20)).map(r => r.kind)).toEqual(['final']);
    expect(reminders.tick(hoursBefore(10))).toEqual([]);
    expect(outbox()).toHaveLength(1);
  });

  test('a leader with no address is tried again once one is added', () => {
    db.prepare("UPDATE directory SET email = '' WHERE id = ?").run(lee);
    expect(reminders.tick(hoursBefore(95))).toEqual([]);
    db.prepare("UPDATE directory SET email = 'lee@example.invalid' WHERE id = ?").run(lee);
    expect(reminders.tick(hoursBefore(94))).toHaveLength(1);
  });

  test('nobody on the schedule, nobody reminded', () => {
    db.prepare('DELETE FROM job_assignments').run();
    expect(reminders.tick(hoursBefore(95))).toEqual([]);
  });

  test('counts back from each service\'s own start time, in church time', () => {
    // 7:00 PM on a Wednesday in December is 01:00 UTC the next day.
    expect(reminders.churchInstant('2026-12-09', '19:00').toISOString()).toBe('2026-12-10T01:00:00.000Z');
    expect(reminders.startsAt(SUNDAY, 'Sunday AM Worship').getTime()).toBe(START);
    // A service with no time set is taken to start at 9:00.
    db.prepare("UPDATE service_types SET start_time = '' WHERE name = 'Sunday AM Worship'").run();
    expect(reminders.startsAt(SUNDAY, 'Sunday AM Worship').toISOString()).toBe('2026-10-04T14:00:00.000Z');
  });
});

describe('what they say', () => {
  test('not yet submitted: asks for it, links straight to that service, and lists requests', () => {
    const songId = db.prepare("INSERT INTO songs (title) VALUES ('Just As I Am')").run().lastInsertRowid;
    db.prepare('INSERT INTO song_requests (song_id, requester_name) VALUES (?, ?)').run(songId, 'Mo Member');
    reminders.tick(hoursBefore(95));
    const [mail] = outbox();
    expect(mail.subject).toBe('You are leading singing — Sunday AM Worship, Sunday, October 4, 2026');
    expect(mail.body).toContain('Lee,');
    expect(mail.body).toContain('Sunday, October 4, 2026 at 9:50 AM');
    expect(mail.body).toContain('has not been submitted yet');
    expect(mail.body).toContain('?page=upcoming&tab=service&date=2026-10-04&service=Sunday+AM+Worship');
    expect(mail.body).toContain('  • Just As I Am');
  });

  test('the final one says so, and shows a confirmed service as it stands', () => {
    const songId = db.prepare("INSERT INTO songs (title, hymnal, number) VALUES ('Amazing Grace', 'Praise for the Lord', '123')").run().lastInsertRowid;
    const part = db.prepare("SELECT id FROM worship_parts WHERE name = 'Song'").get().id;
    const planId = db.prepare(`INSERT INTO worship_plans (date, service, leader, status, submitted_by_name) VALUES (?, 'Sunday AM Worship', 'Leader, Lee', 'confirmed', 'Lee Leader')`).run(SUNDAY).lastInsertRowid;
    db.prepare("INSERT INTO worship_plan_items (plan_id, position, part_id, part_name, song_id) VALUES (?, 0, ?, 'Song', ?)").run(planId, part, songId);

    reminders.tick(hoursBefore(23));
    const [mail] = outbox();
    expect(mail.subject).toMatch(/^Final reminder: You are leading singing/);
    expect(mail.body).toContain('This is the last reminder before the service.');
    expect(mail.body).toContain('It has been confirmed.');
    expect(mail.body).toContain('1. Song: Amazing Grace (Praise for the Lord 123)');
  });
});

describe('the start times', () => {
  const app = user => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.user = user; next(); });
    a.use('/api/worship', router);
    return a;
  };
  const am = () => plans.serviceType('Sunday AM Worship');

  test('start from the newsletter\'s printed times', () => {
    expect(plans.serviceType('Wednesday Bible Study').start_time).toBe('19:00');
  });

  test('are the worship organizer\'s to change', async () => {
    expect((await request(app(MEMBER)).put(`/api/worship/services/${am().id}/start-time`).send({ time: '10:00' })).status).toBe(403);
    expect((await request(app(ORGANIZER)).put(`/api/worship/services/${am().id}/start-time`).send({ time: '25:00' })).status).toBe(400);
    const res = await request(app(ORGANIZER)).put(`/api/worship/services/${am().id}/start-time`).send({ time: '9:30' });
    expect(res.body.service).toMatchObject({ name: 'Sunday AM Worship', startTime: '09:30' });
    expect(am().start_time).toBe('09:30');
  });
});
