// The newsletter is two halves — one queried from the tables that own it, one
// typed each week — so these cover the seam: that carry-forward offers last
// week's words without saving them, that composing merges both, that the two
// exports really are openable files, and that neither is handed to somebody
// who does not look after the newsletter.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const JSZip   = require('jszip');
const mammoth = require('mammoth');

const db            = require('../db');
const issues        = require('../lib/bulletinIssue');
const bulletinRoute = require('../routes/bulletin');

const ADMIN    = { id: 1, role: 'admin' };
const MEMBER   = { id: 2, role: 'approved', areas: [] };
const EDITOR   = { id: 3, role: 'approved', areas: ['bulletin'] };
const PENDING  = { id: 4, role: 'pending',  areas: ['bulletin'] };

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/bulletin', bulletinRoute);
  return app;
}

const SUNDAY = '2026-05-03';

beforeEach(() => {
  for (const t of ['bulletin_issues', 'announcements', 'anniversaries', 'attendance', 'elders', 'deacons', 'action_log', 'users']) {
    db.prepare(`DELETE FROM "${t}"`).run();
  }
  // action_log.user_id is a foreign key into users, so an entry is only written
  // for an account that exists. The fixtures have to be real rows to assert on
  // the history at all.
  const user = db.prepare('INSERT INTO users (id, provider, provider_id, name, role) VALUES (?,?,?,?,?)');
  for (const u of [ADMIN, MEMBER, EDITOR, PENDING]) user.run(u.id, 'local', `p${u.id}`, `User ${u.id}`, u.role);
});

describe('the typed half, week to week', () => {
  test('a week nobody has written is blank, and looking at it writes nothing', () => {
    const draft = issues.draftFor(SUNDAY);
    expect(draft.saved).toBe(false);
    expect(draft.carriedFrom).toBeNull();
    expect(draft.issue.ongoing).toBe('');
    expect(db.prepare('SELECT COUNT(*) AS n FROM bulletin_issues').get().n).toBe(0);
  });

  test('a fresh week inherits the previous one, except the collection', () => {
    issues.save('2026-04-26', {
      ongoing:  'Dean Coffield\nRuby Rundt',
      shut_ins: 'Sharrin Baird',
      offering: '$7,125',
      building: '$87,450 (35%)',
      group_notes: { 'group-1': { leader: 'Hunter Reece', note: '' } },
    });

    const draft = issues.draftFor(SUNDAY);
    expect(draft.saved).toBe(false);
    expect(draft.carriedFrom).toBe('2026-04-26');
    expect(draft.issue.ongoing).toBe('Dean Coffield\nRuby Rundt');
    expect(draft.issue.group_notes['group-1'].leader).toBe('Hunter Reece');
    // The building total is cumulative and carries; last week's collection is
    // last week's fact and does not.
    expect(draft.issue.building).toBe('$87,450 (35%)');
    expect(draft.issue.offering).toBe('');
  });

  test('saving twice edits the one week rather than making a second', () => {
    issues.save(SUNDAY, { ongoing: 'first' });
    issues.save(SUNDAY, { ongoing: 'second' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM bulletin_issues').get().n).toBe(1);
    expect(issues.find(SUNDAY).ongoing).toBe('second');
  });

  test('a line per entry, and blank lines are not entries', () => {
    expect(issues.lines('  Dean Coffield \n\n Ruby Rundt \n')).toEqual(['Dean Coffield', 'Ruby Rundt']);
    expect(issues.lines('')).toEqual([]);
  });

  test('group notes that are not readable JSON lose the leaders, not the newsletter', () => {
    issues.save(SUNDAY, { ongoing: 'kept' });
    db.prepare('UPDATE bulletin_issues SET group_notes = ? WHERE sunday = ?').run('{not json', SUNDAY);
    expect(issues.find(SUNDAY).group_notes).toEqual({});
    expect(issues.find(SUNDAY).ongoing).toBe('kept');
  });
});

describe('composing the two halves', () => {
  test('the queried sections and the typed ones arrive together', () => {
    db.prepare('INSERT INTO announcements (title,event_date,active) VALUES (?,?,1)').run('Potluck', '2026-05-10');
    db.prepare('INSERT INTO attendance (date,service,count) VALUES (?,?,?)').run('04/26/26', 'Sunday AM Worship', 250);
    db.prepare('INSERT INTO elders (id,name) VALUES (1,?)').run('Barry Britnell');
    issues.save(SUNDAY, {
      quote: 'Let us not become weary in doing good', quote_ref: 'Gal. 6:9',
      ongoing: 'Dean Coffield', offering: '$7,125',
      group_notes: { 'group-1': { leader: 'Hunter Reece', note: 'Meeting May 17' } },
    });

    const b = issues.compose(SUNDAY);
    expect(b.sundayLabel).toBe('May 3, 2026');
    expect(b.masthead).toBe('Capshaw Church of Christ Newsletter');
    expect(b.quoteRef).toBe('Gal. 6:9');
    expect(b.reminders).toContain('Potluck May 10');
    expect(b.prayer.ongoing).toEqual(['Dean Coffield']);
    expect(b.lastWeek).toMatchObject({ sunday: 250, offering: '$7,125' });
    expect(b.elders).toEqual([{ name: 'Barry Britnell', duties: [] }]);
    expect(b.groups[0]).toMatchObject({ name: 'Group 1', leader: 'Hunter Reece', note: 'Meeting May 17' });
    expect(b.serviceTimes).toMatch(/Sunday AM Worship/);
  });

  test('any day of the week composes that week', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/bulletin/2026-05-06');
    expect(res.status).toBe(200);
    expect(res.body.bulletin.sunday).toBe(SUNDAY);
  });

  test('a date that is not one is refused', async () => {
    const res = await request(buildApp(MEMBER)).get('/api/bulletin/not-a-date');
    expect(res.status).toBe(400);
  });
});

describe('who may do what', () => {
  test('anybody signed in may read a week', async () => {
    const res = await request(buildApp(MEMBER)).get(`/api/bulletin/${SUNDAY}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('a member without the area may not write one', async () => {
    const res = await request(buildApp(MEMBER)).put(`/api/bulletin/${SUNDAY}`).send({ ongoing: 'nope' });
    expect(res.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bulletin_issues').get().n).toBe(0);
  });

  test('a pending account holds nothing, whatever areas it was granted', async () => {
    const res = await request(buildApp(PENDING)).put(`/api/bulletin/${SUNDAY}`).send({ ongoing: 'nope' });
    expect(res.status).toBe(403);
  });

  test('signed out is refused rather than served', async () => {
    const res = await request(buildApp(null)).put(`/api/bulletin/${SUNDAY}`).send({ ongoing: 'nope' });
    expect(res.status).toBe(401);
  });

  test('whoever looks after the newsletter may write it', async () => {
    const res = await request(buildApp(EDITOR)).put(`/api/bulletin/${SUNDAY}`).send({ ongoing: 'Dean Coffield' });
    expect(res.status).toBe(200);
    expect(res.body.bulletin.prayer.ongoing).toEqual(['Dean Coffield']);
    expect(issues.find(SUNDAY).ongoing).toBe('Dean Coffield');
  });

  test('writing a week is recorded in the history', async () => {
    await request(buildApp(EDITOR)).put(`/api/bulletin/${SUNDAY}`).send({ ongoing: 'Dean Coffield' });
    const log = db.prepare("SELECT * FROM action_log WHERE area = 'bulletin' ORDER BY id DESC").all();
    expect(log[0].summary).toBe('Wrote the newsletter for May 3, 2026');
  });

  test('a member without the area may not export', async () => {
    const res = await request(buildApp(MEMBER)).get(`/api/bulletin/${SUNDAY}/export.pdf`);
    expect(res.status).toBe(403);
  });
});

describe('the exports', () => {
  beforeEach(() => {
    db.prepare('INSERT INTO attendance (date,service,count) VALUES (?,?,?)').run('04/26/26', 'Sunday AM Worship', 250);
    db.prepare('INSERT INTO elders (id,name) VALUES (1,?)').run('Barry Britnell');
    issues.save(SUNDAY, {
      quote: 'Let us not become weary in doing good', quote_ref: 'Gal. 6:9',
      ongoing: 'Dean Coffield & Ruby Rundt',
      shut_ins: 'Sharrin Baird',
      offering: '$7,125',
    });
  });

  test('the .docx is a Word file Word can open, carrying the week\'s content', async () => {
    const res = await request(buildApp(ADMIN))
      .get(`/api/bulletin/${SUNDAY}/export.docx`)
      .buffer().parse((r, cb) => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('capshaw-newsletter-2026-05-03.docx');

    // Opened the way routes/documents.js opens an uploaded one — if mammoth
    // reads it, Word will too.
    const zip = await JSZip.loadAsync(res.body);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([
      '[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml',
    ]));

    const { value: html, messages } = await mammoth.convertToHtml({ buffer: res.body });
    expect(messages).toEqual([]);
    expect(html).toContain('Capshaw Church of Christ Newsletter');
    expect(html).toContain('May 3, 2026');
    expect(html).toContain('Gal. 6:9');
    expect(html).toContain('Sunday attendance: 250');
    expect(html).toContain('Barry Britnell');
    // An ampersand in a name is the thing that makes invalid XML if unescaped.
    expect(html).toContain('Dean Coffield &amp; Ruby Rundt');
  });

  test('the .pdf is a PDF', async () => {
    const res = await request(buildApp(ADMIN))
      .get(`/api/bulletin/${SUNDAY}/export.pdf`)
      .buffer().parse((r, cb) => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('capshaw-newsletter-2026-05-03.pdf');
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(1000);
  });

  test('an empty week still exports rather than failing', async () => {
    db.prepare('DELETE FROM bulletin_issues').run();
    db.prepare('DELETE FROM attendance').run();
    db.prepare('DELETE FROM elders').run();

    const res = await request(buildApp(ADMIN))
      .get('/api/bulletin/2030-01-06/export.docx')
      .buffer().parse((r, cb) => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const { messages } = await mammoth.convertToHtml({ buffer: res.body });
    expect(messages).toEqual([]);
  });

  test('exporting is recorded in the history', async () => {
    await request(buildApp(ADMIN)).get(`/api/bulletin/${SUNDAY}/export.pdf`);
    const log = db.prepare("SELECT * FROM action_log WHERE area = 'bulletin' AND action = 'other' ORDER BY id DESC").all();
    expect(log[0].summary).toBe('Exported the newsletter for May 3, 2026 as PDF');
    expect(JSON.parse(log[0].details).format).toBe('PDF');
  });
});

describe('the weeks already written', () => {
  test('are listed newest first', async () => {
    issues.save('2026-04-26', { ongoing: 'a' });
    issues.save('2026-05-03', { ongoing: 'b' });

    const res = await request(buildApp(MEMBER)).get('/api/bulletin/issues');
    expect(res.status).toBe(200);
    expect(res.body.issues.map(i => i.sunday)).toEqual(['2026-05-03', '2026-04-26']);
  });
});
