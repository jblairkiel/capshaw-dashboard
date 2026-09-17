// The newsletter reads five tables that disagree about what a date is, so most
// of what is worth testing here is the normalising: a week window that picks up
// the right rows out of 'MM/DD/YY', 'June 7' and a bare month/day pair.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const db = require('../db');
const bulletin = require('../lib/bulletinData');

// A Sunday, and the Saturday that closes its week.
const SUNDAY = '2025-06-08';

beforeEach(() => {
  for (const t of [
    'announcements', 'anniversaries', 'attendance', 'job_assignments',
    'elder_duties', 'elders', 'deacon_duties', 'deacons',
  ]) db.prepare(`DELETE FROM "${t}"`).run();
});

describe('reading the dates the tables actually store', () => {
  test('MM/DD/YY becomes ISO', () => {
    expect(bulletin.isoFromSlashed('06/08/25')).toBe('2025-06-08');
    expect(bulletin.isoFromSlashed('6/8/25')).toBe('2025-06-08');
    expect(bulletin.isoFromSlashed('12/25/2025')).toBe('2025-12-25');
  });

  test('a job sheet heading supplies the year its rows leave out', () => {
    expect(bulletin.isoFromMonthDay('June 2025', 'June 7')).toBe('2025-06-07');
    expect(bulletin.isoFromMonthDay('June 2025', 'July 5')).toBe('2025-07-05');
  });

  test('a December sheet listing January belongs to the next year', () => {
    expect(bulletin.isoFromMonthDay('December 2025', 'January 4')).toBe('2026-01-04');
  });

  test('an unreadable date is null rather than a guess', () => {
    expect(bulletin.toIsoDate('')).toBeNull();
    expect(bulletin.toIsoDate('sometime next week')).toBeNull();
    expect(bulletin.isoFromMonthDay('June 2025', 'Junius 7')).toBeNull();
    expect(bulletin.isoFromMonthDay('', 'June 7')).toBeNull();
  });

  test('every day of a week resolves to that week\'s Sunday', () => {
    for (let i = 0; i < 7; i++) {
      expect(bulletin.sundayOf(bulletin.addDays(SUNDAY, i))).toBe(SUNDAY);
    }
    expect(bulletin.sundayOf(bulletin.addDays(SUNDAY, 7))).toBe('2025-06-15');
  });

  test('dates are written the way the masthead prints them', () => {
    expect(bulletin.longDate('2026-05-03')).toBe('May 3, 2026');
    expect(bulletin.shortDate('2026-05-03')).toBe('May 3');
  });
});

describe('telling a birthday from an anniversary', () => {
  // The source keeps both in one table with no column saying which.
  test('a couple, or a count of years, reads as an anniversary', () => {
    expect(bulletin.looksLikeAnniversary('John & Sarah Miller – 15 yrs')).toBe(true);
    expect(bulletin.looksLikeAnniversary('John and Sarah Miller')).toBe(true);
    expect(bulletin.looksLikeAnniversary('Pat Smith – 40 years')).toBe(true);
  });

  test('one name on its own reads as a birthday', () => {
    expect(bulletin.looksLikeAnniversary('John Smith')).toBe(false);
    expect(bulletin.looksLikeAnniversary('Alexander Sandoval')).toBe(false);
  });
});

describe('gathering a week', () => {
  test('the window runs Sunday to Saturday whatever day is asked for', () => {
    const wed = bulletin.gather({ sunday: '2025-06-11' });
    expect(wed.sunday).toBe(SUNDAY);
    expect(wed.week).toEqual({ start: SUNDAY, end: '2025-06-14' });
    expect(wed.previousSunday).toBe('2025-06-01');
  });

  test('reminders are the dated events first, then the standing notices', () => {
    const ins = db.prepare('INSERT INTO announcements (title,body,event_date,event_time,location,priority,active) VALUES (?,?,?,?,?,?,?)');
    ins.run('Potluck',        '', '2025-06-22', '6:00 PM', 'the building', 'normal', 1);
    ins.run('Ladies study',   '', '2025-06-12', '',        'Panera',       'normal', 1);
    ins.run('Tuesday study',  '', null,          '10 AM',   '',            'high',   1);
    ins.run('Hidden',         '', null,          '',        '',            'normal', 0);
    ins.run('Long past',      '', '2024-01-01',  '',        '',            'normal', 1);

    const { reminders } = bulletin.gather({ sunday: SUNDAY });
    expect(reminders.map(r => r.text)).toEqual([
      'Ladies study June 12 at Panera',
      'Potluck June 22 at 6:00 PM at the building',
      'Tuesday study at 10 AM',
    ]);
  });

  test('birthdays and anniversaries are split, and match across a month boundary', () => {
    const ins = db.prepare('INSERT INTO anniversaries (month,date,names,month_num,day) VALUES (?,?,?,?,?)');
    ins.run('June', 'June 30', 'John & Sarah Miller – 15 yrs', 6, 30);
    ins.run('July', 'July 2',  'John Smith',                   7, 2);
    ins.run('July', 'July 20', 'Too late',                     7, 20);

    // The week of Sunday June 29 runs into July.
    const week = bulletin.gather({ sunday: '2025-06-29' });
    expect(week.anniversaries.map(a => a.names)).toEqual(['John & Sarah Miller – 15 yrs']);
    expect(week.birthdays.map(b => b.names)).toEqual(['John Smith']);
  });

  test('the record reported is last week\'s, and names the morning worship count', () => {
    const ins = db.prepare('INSERT INTO attendance (date,service,count) VALUES (?,?,?)');
    ins.run('06/01/25', 'Sunday Bible Study',    180);
    ins.run('06/01/25', 'Sunday AM Worship',     250);
    ins.run('06/04/25', 'Wednesday Bible Study', 190);
    ins.run('06/08/25', 'Sunday AM Worship',     999);   // this week — not reported yet

    const { lastWeek } = bulletin.gather({ sunday: SUNDAY });
    expect(lastWeek.sunday).toBe('2025-06-01');
    expect(lastWeek.attendance.sunday.count).toBe(250);
    expect(lastWeek.attendance.wednesday.count).toBe(190);
  });

  test('without a morning worship row the best attended Sunday service stands in', () => {
    const ins = db.prepare('INSERT INTO attendance (date,service,count) VALUES (?,?,?)');
    ins.run('06/01/25', 'Sunday Bible Study', 180);
    ins.run('06/01/25', 'Sunday PM Worship',  120);

    const { lastWeek } = bulletin.gather({ sunday: SUNDAY });
    expect(lastWeek.attendance.sunday.count).toBe(180);
    expect(lastWeek.attendance.wednesday).toBeNull();
  });

  test('elders and deacons carry what each looks after, in order', () => {
    db.prepare('INSERT INTO elders (id,name) VALUES (1,?)').run('An Elder');
    db.prepare('INSERT INTO elder_duties (elder_id,duty,position) VALUES (1,?,1)').run('Benevolence');
    db.prepare('INSERT INTO elder_duties (elder_id,duty,position) VALUES (1,?,0)').run('Education');
    db.prepare('INSERT INTO deacons (id,name) VALUES (1,?)').run('A Deacon');
    db.prepare('INSERT INTO deacon_duties (deacon_id,duty,position) VALUES (1,?,0)').run('Grounds');

    const week = bulletin.gather({ sunday: SUNDAY });
    // The newsletter prints an elder's telephone number and a deacon's
    // responsibilities, which is the difference between the two tables.
    expect(week.elders).toEqual([{ name: 'An Elder', phone: '', duties: ['Education', 'Benevolence'] }]);
    expect(week.deacons).toEqual([{ name: 'A Deacon', phone: '', duties: ['Grounds'] }]);
  });

  test('an elder\'s telephone number comes through for the newsletter to print', () => {
    db.prepare('INSERT INTO elders (id,name,phone) VALUES (1,?,?)').run('Barry Britnell', '(256) 541-3405');
    expect(bulletin.gather({ sunday: SUNDAY }).elders[0])
      .toEqual({ name: 'Barry Britnell', phone: '(256) 541-3405', duties: [] });
  });

  test('the fellowship groups and their addresses come from the distribution lists', () => {
    // The six groups are seeded by the schema, so nothing is inserted here.
    const { groups, emailContacts } = bulletin.gather({ sunday: SUNDAY });
    expect(groups).toHaveLength(6);
    expect(groups[0]).toEqual({ key: 'group-1', name: 'Group 1', email: 'group1@capshawchurch.org' });

    // The contacts panel advertises the two addresses a member actually writes
    // to. The fellowship groups are reachable by mail but are not listed there.
    expect(emailContacts).toEqual([
      { key: 'announcements', label: 'Announcements',        email: 'announcements@capshawchurch.org' },
      { key: 'elders',        label: 'Elder correspondence', email: 'elders@capshawchurch.org' },
    ]);
  });

  test('the duty roster prints this week and next, a row per job', () => {
    const ins = db.prepare('INSERT INTO job_assignments (month,date,service,job,name) VALUES (?,?,?,?,?)');
    ins.run('June 2025', 'June 8',  'Sunday Worship', 'Song Leader', 'Blair Kiel');
    ins.run('June 2025', 'June 15', 'Sunday Worship', 'Song Leader', 'Next Week');
    ins.run('June 2025', 'June 11', 'Wednesday',      'Speaker',     'Mid Week');

    const { dutyRoster } = bulletin.gather({ sunday: SUNDAY });
    expect(dutyRoster.sunday.dates).toEqual(['2025-06-08', '2025-06-15']);
    expect(dutyRoster.wednesday.dates).toEqual(['2025-06-11', '2025-06-18']);

    const songLeader = dutyRoster.sunday.jobs.find(j => j.job === 'Song Leader');
    expect(songLeader.names).toEqual(['Blair Kiel', 'Next Week']);

    // Every configured job gets a row whether or not anybody is against it —
    // a blank is how a gap gets noticed.
    const sermon = dutyRoster.sunday.jobs.find(j => j.job === 'Sermon');
    expect(sermon.names).toEqual(['', '']);

    expect(dutyRoster.wednesday.jobs.find(j => j.job === 'Speaker').names).toEqual(['Mid Week', '']);
  });

  test('the schedule\'s own AM and PM names are sorted by date, not by wording', () => {
    const ins = db.prepare('INSERT INTO job_assignments (month,date,service,job,name) VALUES (?,?,?,?,?)');
    // June 8 2025 is a Sunday and June 11 a Wednesday. The serving schedule
    // calls its services 'AM' and 'PM', never naming the weekday.
    ins.run('June 2025', 'June 8',  'AM', 'Song Leader', 'Morning');
    ins.run('June 2025', 'June 11', 'PM', 'Song Leader', 'Midweek');

    const { dutyRoster } = bulletin.gather({ sunday: SUNDAY });
    expect(dutyRoster.sunday.jobs.find(j => j.job === 'Song Leader').names[0]).toBe('Morning');
    expect(dutyRoster.wednesday.jobs.find(j => j.job === 'Song Leader').names[0]).toBe('Midweek');
  });

  test('a Sunday evening slot is left out rather than joined onto the morning', () => {
    const ins = db.prepare('INSERT INTO job_assignments (month,date,service,job,name) VALUES (?,?,?,?,?)');
    ins.run('June 2025', 'June 8', 'AM', 'Song Leader', 'Morning');
    ins.run('June 2025', 'June 8', 'PM', 'Song Leader', 'Evening');

    const { dutyRoster } = bulletin.gather({ sunday: SUNDAY });
    // Two different people would otherwise read as one pair.
    expect(dutyRoster.sunday.jobs.find(j => j.job === 'Song Leader').names[0]).toBe('Morning');
  });

  test('several people against one job in a week are listed together', () => {
    const ins = db.prepare('INSERT INTO job_assignments (month,date,service,job,name) VALUES (?,?,?,?,?)');
    ins.run('June 2025', 'June 8', 'Sunday Worship', 'Ushers', 'Chris Black');
    ins.run('June 2025', 'June 8', 'Sunday Worship', 'Ushers', 'David Chumbley');

    const { dutyRoster } = bulletin.gather({ sunday: SUNDAY });
    expect(dutyRoster.sunday.jobs.find(j => j.job === 'Ushers').names[0])
      .toBe('Chris Black, David Chumbley');
  });

  test('a job the schedule carries but the roster does not name is still printed', () => {
    db.prepare('INSERT INTO job_assignments (month,date,service,job,name) VALUES (?,?,?,?,?)')
      .run('June 2025', 'June 8', 'Sunday Worship', 'Greeter', 'Jo Harris');

    const { dutyRoster } = bulletin.gather({ sunday: SUNDAY });
    const jobs = dutyRoster.sunday.jobs.map(j => j.job);
    // After the configured ones, rather than dropped.
    expect(jobs[jobs.length - 1]).toBe('Greeter');
  });

  test('an empty week still returns every section', () => {
    const week = bulletin.gather({ sunday: SUNDAY });
    for (const key of ['reminders', 'anniversaries', 'birthdays', 'elders', 'deacons']) {
      expect(week[key]).toEqual([]);
    }
    expect(week.lastWeek.attendance.sunday).toBeNull();
    expect(week.sundayLabel).toBe('June 8, 2025');
  });
});
