// The documentation: that the admin sections only ever reach an admin, that
// the parts that fill themselves in (areas, emails, workflow charts) do, that
// every hand-drawn chart label fits, and that the PDF has a table of contents
// whose lines really are links to their sections.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const docs = require('../lib/howItWorks');
const { AREAS } = require('../lib/areas');
const { EMAILS } = require('../mail/catalog');
const router = require('../routes/howItWorks');

const ADMIN  = { id: 1, role: 'admin' };
const MEMBER = { id: 2, role: 'approved', areas: [] };
const KEEPER = { id: 3, role: 'approved', areas: ['records', 'worship-order'] };

function app(user) {
  const a = express();
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use('/api/how-it-works', router);
  return a;
}

const text = sections => JSON.stringify(sections);
const binary = res => res.buffer(true).parse((r, cb) => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });

describe('who reads what', () => {
  test('a member gets the sections for everyone, and none for admins', async () => {
    const res = await request(app(MEMBER)).get('/api/how-it-works');
    expect(res.body.admin).toBe(false);
    expect(res.body.sections.every(s => s.audience === 'everyone')).toBe(true);
    expect(text(res.body.sections)).not.toMatch(/View as|MAIL_REDIRECT_TO|Church Records/);
  });

  test('holding areas does not make somebody an admin here', async () => {
    const res = await request(app(KEEPER)).get('/api/how-it-works');
    expect(res.body.sections.some(s => s.audience === 'admins')).toBe(false);
  });

  test('an admin gets everything, the admin sections last', async () => {
    const res = await request(app(ADMIN)).get('/api/how-it-works');
    const audiences = res.body.sections.map(s => s.audience);
    expect(audiences).toContain('admins');
    expect(audiences.indexOf('admins')).toBe(audiences.lastIndexOf('everyone') + 1);
    expect(res.body.sections.map(s => s.id)).toEqual(expect.arrayContaining(['admin-record-keeping', 'admin-accounts']));
  });

  test('every section has a unique id and something in it', () => {
    const ids = docs.SECTIONS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of docs.SECTIONS) expect([s.id, s.blocks.length > 0]).toEqual([s.id, true]);
  });
});

describe('what fills itself in', () => {
  const all = () => docs.sectionsFor(ADMIN);
  const blocksOf = id => all().find(s => s.id === id).blocks;

  test('every area, as the Members & Access page names it', () => {
    const table = blocksOf('who-can-do-what').find(b => b.table).table;
    expect(table.rows.map(r => r[0])).toEqual(AREAS.map(a => a.label));
  });

  test('every email the site sends', () => {
    const table = blocksOf('emails').find(b => b.table).table;
    expect(table.rows.map(r => r[0])).toEqual(EMAILS.map(e => e.name));
    expect(table.rows.map(r => r[0])).toContain('You are leading singing');
  });

  test('the live workflow flowcharts', () => {
    const followUp = blocksOf('guests').find(b => b.workflow);
    expect(followUp.chart.nodes.length).toBeGreaterThan(2);
    expect(blocksOf('serving-schedule').find(b => b.workflow).chart.title).toBe('Monthly Worship Schedule');
  });
});

// The page's charts wrap a label onto two lines of about 22 characters and
// silently drop the rest, so a hand-drawn label has to fit.
describe('the hand-drawn chart labels fit', () => {
  const wrap = (label, max = 22) => {
    const lines = [];
    let line = '';
    for (const word of label.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > max && line) { lines.push(line); line = word; }
      else line = (line + ' ' + word).trim();
    }
    if (line) lines.push(line);
    return lines;
  };
  for (const section of docs.SECTIONS) {
    for (const block of section.blocks.filter(b => b.chart)) {
      for (const node of block.chart.nodes) {
        test(`${section.id} → "${node.label}"`, () => expect(wrap(node.label).length).toBeLessThanOrEqual(2));
      }
    }
  }
});

describe('the PDF', () => {
  test('downloads, named for who it is for', async () => {
    const res = await binary(request(app(MEMBER)).get('/api/how-it-works/pdf'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('capshaw-how-it-works.pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');

    const admin = await binary(request(app(ADMIN)).get('/api/how-it-works/pdf'));
    expect(admin.headers['content-disposition']).toContain('capshaw-how-it-works-admin.pdf');
    expect(admin.body.length).toBeGreaterThan(res.body.length);
  });

  test('has a named destination, a contents link and a bookmark for every section', async () => {
    const { renderHowItWorks, destination } = require('../lib/howItWorksPdf');
    const sections = docs.sectionsFor(MEMBER);
    const pdf = (await renderHowItWorks({ sections })).toString('latin1');
    for (const s of sections) {
      const name = destination(s.id);
      // Declared once as a destination, and pointed at from the contents.
      expect(pdf.split(`(${name})`).length - 1).toBeGreaterThanOrEqual(2);
    }
    expect((pdf.match(/\/Subtype \/Link/g) || []).length).toBeGreaterThanOrEqual(sections.length);
    expect((pdf.match(/\/Title \(/g) || []).length).toBeGreaterThanOrEqual(sections.length);
    expect(pdf).not.toContain('(section-admin-');
  });
});
