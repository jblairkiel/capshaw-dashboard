// The month's serving schedule as a PDF: "Download PDF" for everybody, and
// attached to both emails "Email everyone (PDF)" sends.
const os = require('os');
const fs = require('fs');
const path = require('path');

// Attachments written here are this file's alone.
process.env.CAPSHAW_MAIL_ATTACHMENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-pdf-'));
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db = require('../db');
const mailer = require('../mail/mailer');
const PDFDocument = require('pdfkit');
const { rosterPdf, occasionsOf, tablesOf, fitLine, initialed, pdfFilename, SIZE, THEME, MAX_DATES } = require('../lib/rosterPdf');
const { SERVICE_ROLES } = require('../workflows/scheduling');
const router = require('../routes/serving');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/serving', router);
  return app;
}

// supertest buffers a PDF as bytes only when asked to.
const binary = req => req.buffer(true).parse((res, done) => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
});

function addUser(name, { role = 'approved', areas = [], directoryId = null } = {}) {
  const id = db.prepare('INSERT INTO users (provider, provider_id, email, name, role, directory_id) VALUES (?,?,?,?,?,?)')
    .run('google', `${name}-id`, `${name.toLowerCase()}@example.com`, name, role, directoryId).lastInsertRowid;
  for (const a of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, a);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

const slot = (date, service, job, name = '') =>
  db.prepare('INSERT INTO job_assignments (month, date, service, job, name) VALUES (?,?,?,?,?)').run('November 2026', date, service, job, name);

const pages = pdf => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

let KEEPER, MEL;

beforeEach(() => {
  for (const t of ['mail_outbox', 'action_log', 'job_assignments', 'user_areas', 'users', 'directory']) db.prepare(`DELETE FROM ${t}`).run();
  KEEPER = addUser('Kay', { areas: ['serving-schedule'] });
  MEL = addUser('Mel');
  db.prepare("INSERT INTO directory (name, email) VALUES ('Tom Nelson', 'tom@example.com')").run();
});

afterAll(() => fs.rmSync(process.env.CAPSHAW_MAIL_ATTACHMENT_DIR, { recursive: true, force: true }));

describe('the PDF', () => {
  test('services come in the order they happen, with a job for the month last', () => {
    const occasions = occasionsOf({ month: 'November 2026', rows: [
      { date: '', service: '', job: 'Visual preparation', name: 'Al' },
      { date: 'November 4', service: 'Wednesday', job: 'Lead Singing', name: 'Bo' },
      { date: 'November 1', service: 'Sunday Evening', job: 'Lead Singing', name: 'Cy' },
      { date: 'November 1', service: 'Sunday Worship', job: 'Lead Singing', name: 'Di' },
      { date: 'November 1', service: 'Sunday Worship', job: 'Opening Prayer', name: '' },
    ] });
    expect(occasions.map(o => [o.date, o.service, o.rows.map(r => r.job)])).toEqual([
      ['November 1', 'Sunday Worship', ['Lead Singing', 'Opening Prayer']],
      ['November 1', 'Sunday Evening', ['Lead Singing']],
      ['November 4', 'Wednesday', ['Lead Singing']],
      ['', '', ['Visual preparation']],
    ]);
  });

  test('lays each service out as a roster: its jobs down, its dates across', () => {
    const tables = tablesOf({ month: 'November 2026', rows: [
      { date: 'November 4', service: 'Wednesday', job: 'Song Leader', name: 'Bo' },
      { date: 'November 1', service: 'Sunday Worship', job: 'Song Leader', name: 'Al' },
      { date: 'November 1', service: 'Sunday Worship', job: 'Communion Assist', name: 'Cy' },
      { date: 'November 1', service: 'Sunday Worship', job: 'Communion Assist', name: '' },
      { date: 'November 8', service: 'Sunday Worship', job: 'Song Leader', name: 'Di' },
      { date: '', service: '', job: 'Visual preparation', name: 'Ed' },
    ] });
    // Sunday Worship first, whatever happens first in the month.
    expect(tables.map(t => t.service)).toEqual(['Sunday Worship', 'Wednesday', 'For the month']);
    const sunday = tables[0];
    expect(sunday.dates.map(d => d.label)).toEqual(['Sun, Nov 1', 'Sun, Nov 8']);
    // A job needed twice is two rows.
    expect(sunday.rows.map(r => r.job)).toEqual(['Song Leader', 'Communion Assist', 'Communion Assist']);
    expect(sunday.cells.get('Song Leader#1|2026-11-08')).toBe('Di');
    expect(sunday.cells.get('Communion Assist#2|2026-11-01')).toBe('');
    // Nov 8 has no communion assists at all: left blank, not "needs someone".
    expect(sunday.cells.has('Communion Assist#1|2026-11-08')).toBe(false);
    expect(tables[2].monthly).toEqual([{ job: 'Visual preparation', name: 'Ed' }]);
  });

  test('a long run of nights is split so no column gets too narrow to read', () => {
    const rows = [];
    for (let d = 1; d <= 12; d++) rows.push({ date: `November ${d}`, service: 'Gospel Meeting', job: 'Speaker', name: 'Tom Nelson' });
    const tables = tablesOf({ month: 'November 2026', rows });
    expect(tables.map(t => [t.dates.length, !!t.continued])).toEqual([[MAX_DATES, false], [MAX_DATES, true], [2, true]]);
  });

  test('is a landscape PDF, titled for the month, that runs onto more pages rather than squeezing', () => {
    const one = rosterPdf({ month: 'November 2026', rows: [{ date: 'November 1', service: 'Sunday Worship', job: 'Song Leader', name: 'Tom Nelson' }] });
    expect(one.subarray(0, 5).toString()).toBe('%PDF-');
    expect(one.toString('latin1')).toContain('(Worship Schedule: November 2026)');
    expect(one.toString('latin1')).toContain('/MediaBox [0 0 792 612]');
    expect(pages(one)).toBe(1);

    const rows = [];
    for (let d = 1; d <= 30; d++) for (let j = 0; j < 12; j++) rows.push({ date: `November ${d}`, service: 'Sunday Worship', job: `Job ${j}`, name: 'Fennimore Quarrington' });
    expect(pages(rosterPdf({ month: 'November 2026', rows }))).toBeGreaterThan(3);
  });

  test('a usual month — five Sundays morning and evening, six communion assists each, four Wednesdays — fits on two pages', () => {
    const rows = [];
    expect(SERVICE_ROLES['Sunday Worship'].filter(j => j === 'Communion Assist')).toHaveLength(6);
    for (const d of [1, 8, 15, 22, 29]) {
      for (const job of SERVICE_ROLES['Sunday Worship']) rows.push({ date: `November ${d}`, service: 'Sunday Worship', job, name: 'Fennimore Quarrington' });
      for (const job of SERVICE_ROLES['Sunday Evening']) rows.push({ date: `November ${d}`, service: 'Sunday Evening', job, name: 'Fennimore Quarrington' });
    }
    for (const d of [4, 11, 18, 25]) for (const job of SERVICE_ROLES.Wednesday) rows.push({ date: `November ${d}`, service: 'Wednesday', job, name: 'Fennimore Quarrington' });
    rows.push({ date: '', service: '', job: 'Visual preparation', name: 'Fennimore Quarrington' });
    expect(pages(rosterPdf({ month: 'November 2026', rows }))).toBe(2);
  });

  test('every job is one line: a long name is set smaller, then shortened to an initial', () => {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape' });
    const fits = (fit, font, width) => doc.font(font).fontSize(fit.size).widthOfString(fit.text) <= width;
    // Short names stay as they are, at full size.
    expect(fitLine(doc, 'Tom Nelson', 100, { font: 'Helvetica-Bold', size: SIZE.name, initial: true })).toEqual({ text: 'Tom Nelson', size: SIZE.name });
    // A long one comes down a little before it is shortened.
    const smaller = fitLine(doc, 'Peregrine Westmarch', 125, { font: 'Helvetica-Bold', size: SIZE.name, initial: true });
    expect(smaller.text).toBe('Peregrine Westmarch');
    expect(smaller.size).toBeLessThan(SIZE.name);
    expect(smaller.size).toBeGreaterThanOrEqual(SIZE.minName);
    // Longer still, it keeps the surname whole.
    const short = fitLine(doc, 'Fennimore Quarrington', 100, { font: 'Helvetica-Bold', size: SIZE.name, initial: true });
    expect(short.text).toBe('F. Quarrington');
    expect(fits(short, 'Helvetica-Bold', 100)).toBe(true);
    // And nothing ever overruns its column.
    const cut = fitLine(doc, 'Bartholomew Featherstonehaugh-Wolstenholme', 60, { font: 'Helvetica-Bold', size: SIZE.name, initial: true });
    expect(cut.text.endsWith('…')).toBe(true);
    expect(fits(cut, 'Helvetica-Bold', 60)).toBe(true);
    expect(initialed('Cher')).toBe('Cher');
  });

  test('is set large, in the portal\'s colours', () => {
    expect(SIZE.name).toBeGreaterThanOrEqual(13);
    expect(SIZE.minName).toBeGreaterThanOrEqual(10);
    expect(SIZE.job).toBeGreaterThanOrEqual(12);
    expect(SIZE.date).toBeGreaterThanOrEqual(12);
    expect(SIZE.service).toBeGreaterThanOrEqual(18);
    expect(THEME).toMatchObject({ navy: '#1a2744', gold: '#c9a84c', cream: '#f9f6f0' });
  });

  test('an empty month still makes a PDF that says so', () => {
    expect(rosterPdf({ month: 'November 2026', rows: [] }).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('is named for the month', () => {
    expect(pdfFilename('November 2026')).toBe('Worship Schedule - November 2026.pdf');
    // Nothing from the month label can reach the file name but letters, digits and plain punctuation.
    expect(pdfFilename('../"x"')).toBe('Worship Schedule - ..x.pdf');
  });
});

describe('GET /api/serving/months/pdf — Download PDF', () => {
  test('any approved member gets the month as a PDF to save', async () => {
    slot('November 1', 'Sunday AM', 'Lead Singing', 'Tom Nelson');
    slot('November 1', 'Sunday AM', 'Opening Prayer');
    const res = await binary(request(buildApp(MEL)).get('/api/serving/months/pdf?month=November%202026'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Worship Schedule - November 2026.pdf"');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('a month with nothing on it, or a waiting account, gets none', async () => {
    expect((await request(buildApp(MEL)).get('/api/serving/months/pdf?month=December%202026')).status).toBe(404);
    expect((await request(buildApp(addUser('Pat', { role: 'pending' }))).get('/api/serving/months/pdf?month=November%202026')).status).toBe(403);
  });
});

describe('POST /api/serving/months/notify — Email everyone (PDF)', () => {
  test('each man\'s own jobs and the whole month both go out with the schedule attached', async () => {
    slot('November 1', 'Sunday AM', 'Lead Singing', 'Tom Nelson');
    slot('November 1', 'Sunday AM', 'Opening Prayer');
    const res = await request(buildApp(KEEPER)).post('/api/serving/months/notify').send({ month: 'November 2026' });
    expect(res.body).toMatchObject({ success: true, emailed: 1, unreachable: [] });

    const sent = db.prepare("SELECT context, body, attachments FROM mail_outbox WHERE context LIKE 'workflow:roster:%' ORDER BY id").all();
    expect(sent.map(m => m.context)).toEqual(expect.arrayContaining(['workflow:roster:schedule', 'workflow:roster:monthly-report']));
    for (const message of sent) {
      const [attached] = JSON.parse(message.attachments);
      expect(attached).toMatchObject({ filename: 'Worship Schedule - November 2026.pdf', contentType: 'application/pdf' });
      expect(fs.readFileSync(mailer.attachmentPath(attached.file)).subarray(0, 5).toString()).toBe('%PDF-');
      expect(message.body).toMatch(/attached as a PDF/);
    }
    // Every message points at one stored copy.
    expect(new Set(sent.map(m => JSON.parse(m.attachments)[0].file)).size).toBe(1);
  });

  test('a man\'s own email tells him to ask to be replaced, not to take himself off', async () => {
    slot('November 1', 'Sunday AM', 'Lead Singing', 'Tom Nelson');
    await request(buildApp(KEEPER)).post('/api/serving/months/notify').send({ month: 'November 2026' });
    const mine = db.prepare("SELECT body FROM mail_outbox WHERE context = 'workflow:roster:schedule'").get().body;
    expect(mine).toMatch(/Ask to be replaced/);
    expect(mine).not.toMatch(/take yourself off/);
  });
});
