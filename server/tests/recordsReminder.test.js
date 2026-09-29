// The Monday records reminder: that it lists what the Record Keeping report
// shows as missing, that each person hears only about the records they look
// after, that nothing is sent when nothing is missing, and that the timer
// sends it once a week and no more.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request  = require('supertest');
const express  = require('express');
const db       = require('../db');
const reminder = require('../mail/records');
const router   = require('../routes/recordKeeping');

// A Monday. "Up to yesterday" is Sunday 27 September, so the reminder covers
// the week of Sunday 20 September and that Sunday.
const MONDAY = '2026-09-28';

const PEOPLE = [
  { id: 1, name: 'Office Admin',  role: 'admin',    areas: [] },
  { id: 2, name: 'Song Keeper',   role: 'approved', areas: ['songs'] },
  { id: 3, name: 'Guest Keeper',  role: 'approved', areas: ['visitors'] },
  { id: 4, name: 'Counter',       role: 'approved', areas: ['contributions'] },
  { id: 5, name: 'Record Keeper', role: 'approved', areas: ['records'] },
];
const emailOf = id => `u${id}@example.invalid`;

function songs(date, service) {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO song_services (date, service, leader) VALUES (?, ?, ?)').run(date, service, 'Sample Leader');
  const { lastInsertRowid: song } = db.prepare('INSERT INTO songs (title) VALUES (?)').run(`Song ${id}`);
  db.prepare('INSERT INTO service_songs (service_id, song_id, position) VALUES (?, ?, 0)').run(id, song);
}
function guest(date, service) {
  const { lastInsertRowid: v } = db.prepare('INSERT INTO visitors (name) VALUES (?)').run('Sample Guest');
  db.prepare('INSERT INTO visitor_visits (visitor_id, date, service) VALUES (?, ?, ?)').run(v, date, service);
}
const give = date => db.prepare('INSERT INTO contributions (date, amount) VALUES (?, 5000)').run(date);

// Everything on file from 2 August (the report's first week) to 27 September,
// so a test only has to take away what it wants reported.
function fillEverything() {
  for (let sunday = '2026-08-02'; sunday <= '2026-09-27'; sunday = addDays(sunday, 7)) {
    const wednesday = addDays(sunday, 3);
    for (const [date, service, song] of [[sunday, 'Sunday AM Worship', 'AM'], [wednesday, 'Wednesday Bible Study', 'Wednesday']]) {
      if (date > '2026-09-27') continue;
      songs(date, song);
      const [y, m, d] = date.split('-');
      guest(`${m}/${d}/${y.slice(2)}`, service);
    }
    give(sunday);
  }
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function removeSongs(date) {
  db.prepare('DELETE FROM service_songs WHERE service_id IN (SELECT id FROM song_services WHERE date = ?)').run(date);
  db.prepare('DELETE FROM song_services WHERE date = ?').run(date);
}
function removeGuests(date) {
  const [y, m, d] = date.split('-');
  db.prepare('DELETE FROM visitor_visits WHERE date = ?').run(`${m}/${d}/${y.slice(2)}`);
}

// Who each queued message was for, and its body, keyed by address. A test
// redirect, if one is set, moves to_email; intended_for keeps the original.
function outbox() {
  return Object.fromEntries(db.prepare('SELECT * FROM mail_outbox ORDER BY id').all()
    .map(r => [r.intended_for || r.to_email, r]));
}

function setAreas(byId) {
  db.prepare('DELETE FROM user_areas').run();
  const grant = db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)');
  for (const [id, areas] of Object.entries(byId)) for (const a of areas) grant.run(Number(id), a);
}

beforeAll(() => {
  const add = db.prepare("INSERT INTO users (id, provider, provider_id, email, name, role) VALUES (?, 'local', ?, ?, ?, ?)");
  for (const u of PEOPLE) add.run(u.id, `u${u.id}`, emailOf(u.id), u.name, u.role);
});

beforeEach(() => {
  for (const t of ['service_songs', 'song_services', 'songs', 'visitor_visits', 'visitors', 'attendance', 'contributions', 'record_checkoffs', 'mail_outbox', 'scheduled_jobs', 'action_log',
                   'group_events', 'church_group_members', 'church_groups', 'directory']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  setAreas(Object.fromEntries(PEOPLE.map(p => [p.id, p.areas])));
  fillEverything();
});

describe('what the reminder lists', () => {
  test('the last eight days up to yesterday, with older gaps only counted', () => {
    removeSongs('2026-09-23');
    removeGuests('2026-09-27');
    db.prepare("DELETE FROM contributions WHERE date = '2026-09-27'").run();
    removeSongs('2026-08-09');

    const found = reminder.gaps('2026-09-27');
    expect(found.items).toEqual([
      { check: 'songs',        date: '2026-09-23', service: 'Wednesday Bible Study' },
      { check: 'contribution', date: '2026-09-27', service: '' },
      { check: 'guests',       date: '2026-09-27', service: 'Sunday AM Worship' },
    ]);
    expect(found.earlier).toBe(1);
    expect(found.from).toBe('2026-09-20');
  });

  test('a sign-off for "nothing to record" is not a gap', () => {
    removeGuests('2026-09-27');
    db.prepare("INSERT INTO record_checkoffs (date, service, check_id) VALUES ('2026-09-27', 'Sunday AM Worship', 'guests')").run();
    expect(reminder.gaps('2026-09-27').items).toEqual([]);
  });

  test('the email groups the gaps by record and links to the page', () => {
    const { subject, body } = reminder.compose.recordsReminder({
      from: '2026-09-20', through: '2026-09-27', earlier: 0,
      items: [
        { check: 'songs', date: '2026-09-23', service: 'Wednesday Bible Study' },
        { check: 'contribution', date: '2026-09-27', service: '' },
      ],
    });
    expect(subject).toBe('Records to fill in: 2 from Sun, Sep 20 to Sun, Sep 27');
    expect(body).toContain('Songs:\n  • Wed, Sep 23 — Wednesday Bible Study');
    expect(body).toContain('Contribution:\n  • Sun, Sep 27\n');
    expect(body).not.toContain('Guests:');
    expect(body).not.toContain('earlier weeks');
    expect(body).toContain('?page=record-keeping');
  });
});

describe('who hears about what', () => {
  test('each keeper gets only their own records; the record keeper gets everything', () => {
    removeSongs('2026-09-23');
    removeGuests('2026-09-27');

    const result = reminder.sendReminder({ today: MONDAY });
    expect(result.missing).toBe(2);

    const mail = outbox();
    expect(Object.keys(mail).sort()).toEqual([emailOf(2), emailOf(3), emailOf(5)].sort());
    expect(mail[emailOf(2)].body).toContain('Songs:');
    expect(mail[emailOf(2)].body).not.toContain('Guests:');
    expect(mail[emailOf(3)].body).toContain('Guests:');
    expect(mail[emailOf(3)].body).not.toContain('Songs:');
    expect(mail[emailOf(5)].body).toContain('Songs:');
    expect(mail[emailOf(5)].body).toContain('Guests:');
    expect(mail[emailOf(5)].context).toBe(`records-reminder:${MONDAY}`);
    // Admins are not copied on records somebody else looks after.
    expect(mail[emailOf(1)]).toBeUndefined();
  });

  test('a record nobody looks after goes to the admins', () => {
    setAreas({ 2: ['songs'] });
    removeGuests('2026-09-27');
    reminder.sendReminder({ today: MONDAY });
    expect(Object.keys(outbox())).toEqual([emailOf(1)]);
  });

  test("a meeting's head count goes to that group's leaders, or to whoever looks after every group", () => {
    const person = (name, email) => db.prepare('INSERT INTO directory (name, email) VALUES (?, ?)').run(name, email).lastInsertRowid;
    const group = name => db.prepare('INSERT INTO church_groups (key, name) VALUES (?, ?)').run(name.toLowerCase().replace(/\W/g, '-'), name).lastInsertRowid;
    const north = group('North Harvest');
    const south = group('South Harvest');
    db.prepare("INSERT INTO church_group_members (group_id, directory_id, role) VALUES (?, ?, 'leader')").run(north, person('Lee Leader', 'lee@example.invalid'));
    db.prepare("INSERT INTO church_group_members (group_id, directory_id, role) VALUES (?, ?, 'member')").run(north, person('Jo Member', 'jo@example.invalid'));
    db.prepare("INSERT INTO user_areas (user_id, area) VALUES (4, 'church-groups')").run();
    const meeting = (groupId, title) => db.prepare("INSERT INTO group_events (group_id, title, event_date, status) VALUES (?, ?, '2026-09-24', 'published')").run(groupId, title);
    meeting(north, 'Fellowship meal');
    meeting(south, 'Singing');

    reminder.sendReminder({ today: MONDAY });
    const mail = outbox();
    expect(mail['lee@example.invalid'].body).toContain('Head count:\n  • Thu, Sep 24 — North Harvest: Fellowship meal\n');
    expect(mail['lee@example.invalid'].body).not.toContain('South Harvest');
    // A group leader may have no way into Record Keeping, so is pointed at the meeting.
    expect(mail['lee@example.invalid'].body).toContain('?page=groups');
    expect(mail['lee@example.invalid'].body).not.toContain('?page=record-keeping');
    expect(mail['jo@example.invalid']).toBeUndefined();
    // South Harvest has no leader: whoever looks after every group hears.
    expect(mail[emailOf(4)].body).toContain('South Harvest: Singing');
    expect(mail[emailOf(4)].body).not.toContain('North Harvest');
    expect(mail[emailOf(5)].body).toContain('North Harvest: Fellowship meal');
    expect(mail[emailOf(5)].body).toContain('South Harvest: Singing');
  });

  test('nothing is sent when nothing is missing', () => {
    expect(reminder.sendReminder({ today: MONDAY })).toEqual({ missing: 0, earlier: 0, sent: [] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_outbox').get().n).toBe(0);
  });
});

describe('the Monday timer', () => {
  // 2026-09-28 is a Monday; Chicago is five hours behind UTC in September.
  const at = (date, chicagoHour) => new Date(Date.parse(`${date}T00:00:00Z`) + (chicagoHour + 5) * 3600e3);

  beforeEach(() => removeSongs('2026-09-23'));

  test('waits for Monday morning', () => {
    expect(reminder.tick(at('2026-09-27', 20))).toBeNull();  // Sunday evening
    expect(reminder.tick(at('2026-09-28', 8))).toBeNull();   // Monday, too early
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_outbox').get().n).toBe(0);
  });

  test('sends once a week, however often it ticks', () => {
    expect(reminder.tick(at('2026-09-28', 9))).toMatchObject({ missing: 1 });
    expect(reminder.tick(at('2026-09-28', 10))).toBeNull();
    expect(reminder.tick(at('2026-10-01', 9))).toBeNull();
    expect(reminder.lastRun().last_key).toBe('2026-09-27');

    const sent = db.prepare('SELECT COUNT(*) AS n FROM mail_outbox').get().n;
    expect(sent).toBe(2);  // the song keeper and the record keeper
  });

  test('a server that was down on Monday sends when it comes back', () => {
    expect(reminder.tick(at('2026-09-30', 14))).toMatchObject({ missing: 1 });
  });

  test('a quiet week still counts as done, so a gap filled later is not re-checked', () => {
    songs('2026-09-23', 'Wednesday');
    expect(reminder.tick(at('2026-09-28', 9))).toMatchObject({ missing: 0 });
    removeSongs('2026-09-23');
    expect(reminder.tick(at('2026-09-28', 12))).toBeNull();
  });
});

describe('sending it from the Record Keeping page', () => {
  function buildApp(user) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/record-keeping', router);
    return app;
  }
  const KEEPER = { ...PEOPLE[4] };

  test('the report says when the reminder goes out and when it last did', async () => {
    const res = await request(buildApp(KEEPER)).get('/api/record-keeping?weeks=1');
    expect(res.body.reminder).toEqual({ lastRun: null, day: 'Monday', hour: 9 });
  });

  test('sends now, and is recorded', async () => {
    // Whatever today is, removing every song since August leaves something
    // for the last eight days.
    db.prepare('DELETE FROM service_songs').run();
    const res = await request(buildApp(KEEPER)).post('/api/record-keeping/remind');
    expect(res.status).toBe(200);
    expect(res.body.sent.length).toBeGreaterThan(0);
    const [log] = db.prepare("SELECT * FROM action_log WHERE area = 'records' ORDER BY id DESC").all();
    expect(log.summary).toMatch(/^Sent the records reminder/);
  });

  test('is for whoever holds Record Keeping', async () => {
    const res = await request(buildApp({ ...PEOPLE[1] })).post('/api/record-keeping/remind');
    expect(res.status).toBe(403);
  });
});
