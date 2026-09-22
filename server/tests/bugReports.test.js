// Filing a bug report, and triaging one. Anybody signed in — pending accounts
// included — can do the first; only an admin can do the second.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const bugReportRoutes = require('../routes/bugReports');
const screenshots      = require('../lib/bugScreenshots');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/bug-reports', bugReportRoutes);
  return app;
}

function addUser(name, role, id = `${name}-id`) {
  const { lastInsertRowid: userId } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)'
  ).run('google', id, `${name.toLowerCase()}@example.com`, name, role);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// Real magic bytes, since the store reads the type from the bytes — the same
// fixture server/tests/directoryPhotos.test.js uses for photoStore.
const PNG_BYTES = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16, 7)]);

let ADMIN, OTHER_ADMIN, MEMBER, PENDING;

beforeEach(() => {
  for (const t of ['action_log', 'notifications', 'bug_reports', 'users']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  ADMIN       = addUser('Cora', 'admin', 'cora-id');
  OTHER_ADMIN = addUser('Dale', 'admin', 'dale-id');
  MEMBER      = addUser('Joe',  'approved', 'joe-id');
  PENDING     = addUser('Sam',  'pending', 'sam-id');
});

function reportsOf() {
  return db.prepare('SELECT * FROM bug_reports ORDER BY id').all();
}

// ─── Filing one ─────────────────────────────────────────────────────────────

describe('filing a bug report', () => {
  test('a member can file one, and it comes back with what was captured', async () => {
    const res = await request(buildApp(MEMBER))
      .post('/api/bug-reports')
      .send({
        title: 'The week doesn\'t change',
        description: 'Picking a different week from the dropdown does nothing.',
        steps: 'Open Serving Schedule, change Week of, watch it not move.',
        severity: 'annoying',
        page: 'assignments',
        pageLabel: 'Serving Schedule',
        url: 'https://example.org/?tab=assignments',
        userAgent: 'TestBrowser/1.0',
      });

    expect(res.status).toBe(200);
    expect(res.body.report).toMatchObject({
      title: 'The week doesn\'t change',
      severity: 'annoying',
      status: 'open',
      page: 'assignments',
      pageLabel: 'Serving Schedule',
      reporterName: 'Joe',
    });
    expect(reportsOf()).toHaveLength(1);
  });

  test('a pending account can file one too — they can already look around', async () => {
    const res = await request(buildApp(PENDING)).post('/api/bug-reports').send({
      title: 'Something', description: 'Broke',
    });
    expect(res.status).toBe(200);
  });

  test('an unknown severity falls back rather than being refused', async () => {
    const res = await request(buildApp(MEMBER)).post('/api/bug-reports').send({
      title: 'x', description: 'y', severity: 'catastrophic',
    });
    expect(res.status).toBe(200);
    expect(res.body.report.severity).toBe('annoying');
  });

  test('a title or description is required, and nothing is written without them', async () => {
    const noTitle = await request(buildApp(MEMBER)).post('/api/bug-reports').send({ description: 'y' });
    expect(noTitle.status).toBe(400);

    const noDescription = await request(buildApp(MEMBER)).post('/api/bug-reports').send({ title: 'x' });
    expect(noDescription.status).toBe(400);

    expect(reportsOf()).toHaveLength(0);
  });

  test('a screenshot is stored and can be told apart from the report itself', async () => {
    const res = await request(buildApp(MEMBER))
      .post('/api/bug-reports')
      .field('title', 'Broken layout')
      .field('description', 'The table runs off the screen')
      .attach('screenshot', PNG_BYTES, 'broken.png');

    expect(res.status).toBe(200);
    expect(res.body.report.screenshot).toMatch(/\.png$/);
    expect(screenshots.exists(res.body.report.screenshot)).toBe(true);
  });

  test('something that is not a readable image is refused', async () => {
    const res = await request(buildApp(MEMBER))
      .post('/api/bug-reports')
      .field('title', 'x')
      .field('description', 'y')
      .attach('screenshot', Buffer.from('not an image'), 'notes.png');

    expect(res.status).toBe(400);
    expect(reportsOf()).toHaveLength(0);
  });

  test('every admin is told about a new report, and nobody else is', async () => {
    await request(buildApp(MEMBER)).post('/api/bug-reports').send({ title: 'x', description: 'y', severity: 'blocking', pageLabel: 'Serving Schedule' });

    const notified = db.prepare('SELECT user_id, kind, page, body FROM notifications').all();
    expect(notified.map(n => n.user_id).sort()).toEqual([ADMIN.id, OTHER_ADMIN.id].sort());
    expect(notified.every(n => n.kind === 'bug-report-new' && n.page === 'bug-reports')).toBe(true);
    expect(notified[0].body).toMatch(/on Serving Schedule/);
  });

  test('filing one is recorded in the action history', async () => {
    await request(buildApp(MEMBER)).post('/api/bug-reports').send({ title: 'x', description: 'y' });
    const entry = db.prepare('SELECT * FROM action_log ORDER BY id DESC').get();
    expect(entry).toMatchObject({ area: 'bug-reports', action: 'create', user_id: MEMBER.id });
    expect(entry.summary).toMatch(/Filed a bug report: "x"/);
  });
});

// ─── Triage ─────────────────────────────────────────────────────────────────

describe('who can see and change reports', () => {
  test('a member cannot list, read a screenshot, or change one', async () => {
    const filed = await request(buildApp(MEMBER)).post('/api/bug-reports').send({ title: 'x', description: 'y' });
    const id = filed.body.report.id;

    expect((await request(buildApp(MEMBER)).get('/api/bug-reports')).status).toBe(403);
    expect((await request(buildApp(MEMBER)).get(`/api/bug-reports/${id}/screenshot`)).status).toBe(403);
    expect((await request(buildApp(MEMBER)).patch(`/api/bug-reports/${id}`).send({ status: 'resolved' })).status).toBe(403);
  });

  test('an admin can list every report, newest first, with counts by status', async () => {
    await request(buildApp(MEMBER)).post('/api/bug-reports').send({ title: 'first', description: 'a' });
    await request(buildApp(MEMBER)).post('/api/bug-reports').send({ title: 'second', description: 'b' });

    const res = await request(buildApp(ADMIN)).get('/api/bug-reports');
    expect(res.status).toBe(200);
    expect(res.body.reports.map(r => r.title)).toEqual(['second', 'first']);
    expect(res.body.counts).toEqual({ open: 2 });
  });

  test('the list can be filtered to one status', async () => {
    const a = await request(buildApp(MEMBER)).post('/api/bug-reports').send({ title: 'a', description: 'x' });
    await request(buildApp(MEMBER)).post('/api/bug-reports').send({ title: 'b', description: 'y' });
    await request(buildApp(ADMIN)).patch(`/api/bug-reports/${a.body.report.id}`).send({ status: 'resolved' });

    const res = await request(buildApp(ADMIN)).get('/api/bug-reports?status=resolved');
    expect(res.body.reports.map(r => r.title)).toEqual(['a']);
  });
});

describe('moving a report through triage', () => {
  let reportId;

  beforeEach(async () => {
    const filed = await request(buildApp(MEMBER))
      .post('/api/bug-reports')
      .send({ title: 'Broken thing', description: 'It is broken' });
    reportId = filed.body.report.id;
  });

  test('an admin can change the status and leave a note', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(`/api/bug-reports/${reportId}`)
      .send({ status: 'resolved', adminNote: 'Fixed in the next release' });

    expect(res.status).toBe(200);
    expect(res.body.report).toMatchObject({ status: 'resolved', adminNote: 'Fixed in the next release' });
  });

  test('an unknown status is refused, and nothing changes', async () => {
    const res = await request(buildApp(ADMIN)).patch(`/api/bug-reports/${reportId}`).send({ status: 'exploded' });
    expect(res.status).toBe(400);
    expect(db.prepare('SELECT status FROM bug_reports WHERE id = ?').get(reportId).status).toBe('open');
  });

  test('a report that does not exist says so', async () => {
    const res = await request(buildApp(ADMIN)).patch('/api/bug-reports/9999').send({ status: 'resolved' });
    expect(res.status).toBe(404);
  });

  test('the reporter is told when the status changes, and the note travels with it', async () => {
    await request(buildApp(ADMIN))
      .patch(`/api/bug-reports/${reportId}`)
      .send({ status: 'resolved', adminNote: 'Fixed it' });

    const note = db.prepare('SELECT * FROM notifications WHERE user_id = ?').get(MEMBER.id);
    expect(note).toMatchObject({ kind: 'bug-report-status', page: '', body: 'Fixed it' });
    expect(note.title).toMatch(/marked resolved/);
  });

  test('saving a note without changing the status tells nobody', async () => {
    await request(buildApp(ADMIN)).patch(`/api/bug-reports/${reportId}`).send({ adminNote: 'Looking into it' });
    // Filing the report already told the admins about it — this checks that
    // saving a note alone adds no further notification, not that there are none.
    expect(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'bug-report-status'").get().n).toBe(0);

    const entry = db.prepare('SELECT * FROM action_log ORDER BY id DESC').get();
    expect(entry.summary).toMatch(/Updated the note/);
  });

  test('every change is recorded in the action history under the admin who made it', async () => {
    await request(buildApp(ADMIN)).patch(`/api/bug-reports/${reportId}`).send({ status: 'in_progress' });
    const entry = db.prepare('SELECT * FROM action_log ORDER BY id DESC').get();
    expect(entry).toMatchObject({ area: 'bug-reports', action: 'update', user_id: ADMIN.id });
    expect(entry.summary).toMatch(/Marked "Broken thing" in progress/);
  });
});

describe('serving a screenshot', () => {
  test('an admin can read the screenshot on a report that has one', async () => {
    const filed = await request(buildApp(MEMBER))
      .post('/api/bug-reports')
      .field('title', 'x').field('description', 'y')
      .attach('screenshot', PNG_BYTES, 'shot.png');

    const res = await request(buildApp(ADMIN)).get(`/api/bug-reports/${filed.body.report.id}/screenshot`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  test('a report with no screenshot says so rather than serving nothing', async () => {
    const filed = await request(buildApp(MEMBER)).post('/api/bug-reports').send({ title: 'x', description: 'y' });
    const res = await request(buildApp(ADMIN)).get(`/api/bug-reports/${filed.body.report.id}/screenshot`);
    expect(res.status).toBe(404);
  });
});
