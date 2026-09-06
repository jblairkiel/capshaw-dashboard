const { createMemoryDb } = require('./helpers/memoryDb');
const { syncDirectory }  = require('../lib/directorySync');

let db;

function person(name, extra = {}) {
  return { name, address: '12 Oak St', zip: '35749', phone: '', cell: '', email: '', city: '', state: '', notes: '', ...extra };
}

function rowFor(name) {
  return db.prepare('SELECT * FROM directory WHERE name = ?').get(name);
}

beforeEach(() => { db = createMemoryDb(); });

describe('syncDirectory', () => {
  test('inserts people the directory has never seen', () => {
    syncDirectory(db, [person('Ray Harris'), person('Jo Harris')]);
    expect(db.prepare('SELECT COUNT(*) n FROM directory').get().n).toBe(2);
  });

  test('keeps row ids stable across a re-sync', () => {
    syncDirectory(db, [person('Ray Harris')]);
    const before = rowFor('Ray Harris').id;
    syncDirectory(db, [person('Ray Harris', { phone: '(256) 555-0100' })]);
    expect(rowFor('Ray Harris').id).toBe(before);
  });

  test('updates fields that were never edited by hand', () => {
    syncDirectory(db, [person('Ray Harris', { phone: '(256) 555-0100' })]);
    syncDirectory(db, [person('Ray Harris', { phone: '(256) 555-0999' })]);
    expect(rowFor('Ray Harris').phone).toBe('(256) 555-0999');
  });

  test('never overwrites a field someone edited by hand', () => {
    syncDirectory(db, [person('Ray Harris', { phone: '(256) 555-0100', cell: '(256) 555-0101' })]);
    // Someone corrects the cell number through the profile screen.
    db.prepare("UPDATE directory SET cell = ?, edited_fields = '[\"cell\"]' WHERE name = ?")
      .run('(256) 555-0142', 'Ray Harris');

    syncDirectory(db, [person('Ray Harris', { phone: '(256) 555-0200', cell: '(256) 555-0101' })]);

    const row = db.prepare('SELECT * FROM directory WHERE name = ?').get('Ray Harris');
    expect(row.cell).toBe('(256) 555-0142');   // hand-edited, protected
    expect(row.phone).toBe('(256) 555-0200');  // untouched by hand, refreshed
  });

  test('removes people the website has dropped', () => {
    syncDirectory(db, [person('Ray Harris'), person('Jo Harris')]);
    syncDirectory(db, [person('Ray Harris')]);
    expect(rowFor('Jo Harris')).toBeUndefined();
  });

  test('keeps a dropped person who is linked to an account', () => {
    syncDirectory(db, [person('Ray Harris'), person('Jo Harris')]);
    const jo = rowFor('Jo Harris');
    db.prepare('INSERT INTO users (provider, provider_id, name, role, directory_id) VALUES (?,?,?,?,?)')
      .run('google', 'g1', 'Jo', 'approved', jo.id);

    syncDirectory(db, [person('Ray Harris')]);
    expect(rowFor('Jo Harris')).toBeTruthy();
  });

  test('keeps a dropped person who has worship preferences', () => {
    syncDirectory(db, [person('Ray Harris'), person('Jo Harris')]);
    const jo = rowFor('Jo Harris');
    db.prepare('INSERT INTO worship_preferences (directory_id, role, level) VALUES (?,?,?)')
      .run(jo.id, 'Song Leader', 'preferred');

    syncDirectory(db, [person('Ray Harris')]);
    expect(rowFor('Jo Harris')).toBeTruthy();
  });

  test('keeps a dropped person whose details were edited by hand', () => {
    syncDirectory(db, [person('Ray Harris'), person('Jo Harris')]);
    db.prepare("UPDATE directory SET edited_fields = '[\"phone\"]' WHERE name = ?").run('Jo Harris');

    syncDirectory(db, [person('Ray Harris')]);
    expect(rowFor('Jo Harris')).toBeTruthy();
  });

  test('preserves preferences across a re-sync', () => {
    syncDirectory(db, [person('Ray Harris')]);
    const id = rowFor('Ray Harris').id;
    db.prepare('INSERT INTO worship_preferences (directory_id, role, level) VALUES (?,?,?)')
      .run(id, 'Song Leader', 'preferred');

    syncDirectory(db, [person('Ray Harris', { phone: '(256) 555-0100' })]);

    const pref = db.prepare('SELECT * FROM worship_preferences WHERE directory_id = ?').get(id);
    expect(pref.level).toBe('preferred');
  });

  test('tells two people with the same name apart by address', () => {
    syncDirectory(db, [
      person('John Smith', { address: '12 Oak St' }),
      person('John Smith', { address: '99 Elm St' }),
    ]);
    expect(db.prepare('SELECT COUNT(*) n FROM directory').get().n).toBe(2);

    syncDirectory(db, [
      person('John Smith', { address: '12 Oak St', phone: '(256) 555-0111' }),
      person('John Smith', { address: '99 Elm St', phone: '(256) 555-0222' }),
    ]);
    const rows = db.prepare('SELECT address, phone FROM directory ORDER BY address').all();
    expect(rows).toEqual([
      { address: '12 Oak St', phone: '(256) 555-0111' },
      { address: '99 Elm St', phone: '(256) 555-0222' },
    ]);
  });

  test('skips entries with no name', () => {
    syncDirectory(db, [person(''), person('   '), person('Ray Harris')]);
    expect(db.prepare('SELECT COUNT(*) n FROM directory').get().n).toBe(1);
  });

  test('survives corrupt edited_fields by treating the row as unedited', () => {
    syncDirectory(db, [person('Ray Harris', { phone: '(256) 555-0100' })]);
    db.prepare("UPDATE directory SET edited_fields = 'not json' WHERE name = ?").run('Ray Harris');
    expect(() => syncDirectory(db, [person('Ray Harris', { phone: '(256) 555-0200' })])).not.toThrow();
    expect(rowFor('Ray Harris').phone).toBe('(256) 555-0200');
  });
});
