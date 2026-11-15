// How the portal is used: one visit per member per day, phone or computer,
// and how often each page is opened. An admin viewing as somebody else is not
// counted as them, and nothing is noted for an account waiting for approval.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const usage = require('../lib/portalUsage');
const router = require('../routes/usage');

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';
let ANN;

beforeEach(() => {
  for (const t of ['portal_page_views', 'portal_visits', 'users']) db.prepare(`DELETE FROM ${t}`).run();
  usage.forget();
  const id = db.prepare("INSERT INTO users (provider, provider_id, email, name, role) VALUES ('google', 'ann', 'ann@example.com', 'Ann', 'approved')").run().lastInsertRowid;
  ANN = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
});

const visits = () => db.prepare('SELECT day, phone, computer FROM portal_visits').all();

test('a member is noted once a day, with whether it was a phone or a computer', () => {
  const noon = new Date('2026-11-08T18:00:00Z');
  usage.recordVisit(ANN, PHONE, noon);
  usage.recordVisit(ANN, PHONE, noon);
  usage.recordVisit(ANN, DESKTOP, noon);
  expect(visits()).toEqual([{ day: '2026-11-08', phone: 1, computer: 1 }]);
});

test('the day is church time, so a late Saturday evening counts on Saturday', () => {
  usage.recordVisit(ANN, DESKTOP, new Date('2026-11-15T04:30:00Z'));   // 10:30 PM Saturday in Alabama
  expect(visits()[0].day).toBe('2026-11-14');
});

test('an admin viewing as a member, and an account waiting for approval, are not counted', () => {
  usage.recordVisit({ ...ANN, impersonatedBy: { id: 99 } }, DESKTOP);
  usage.recordVisit({ ...ANN, role: 'pending' }, DESKTOP);
  expect(visits()).toEqual([]);
});

test('each page opened is counted, and anything that is not a page name is ignored', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = ANN; next(); });
  app.use('/api/usage', router);

  expect((await request(app).post('/api/usage/page').send({ page: 'upcoming' })).status).toBe(204);
  await request(app).post('/api/usage/page').send({ page: 'upcoming' });
  await request(app).post('/api/usage/page').send({ page: '../../etc' });
  await request(app).post('/api/usage/page').send({});
  expect(db.prepare('SELECT page, views FROM portal_page_views').all()).toEqual([{ page: 'upcoming', views: 2 }]);
});

test('pages are reported by their menu names', () => {
  expect(usage.labelOf('upcoming')).toBe('Upcoming Service');
  expect(usage.labelOf('some-new-page')).toBe('Some new page');
});
