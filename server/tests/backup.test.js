// A backup is only worth anything if it restores. These take one from a live
// (WAL-mode, still-open) database, check it, restore it over an installation
// whose data has since gone wrong, and confirm the old data came back and the
// replaced data was kept aside rather than deleted.
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { createBackup, verifyBackup, restoreBackup } = require('../lib/backup');

function installation(root) {
  const dataDir = path.join(root, 'data');
  const p = {
    dataDir,
    database:        path.join(dataDir, 'bible_questions.db'),
    photos:          path.join(dataDir, 'photos'),
    scrapeCache:     path.join(dataDir, 'members.json'),
    uploads:         path.join(root, 'uploads'),
    screenshots:     path.join(dataDir, 'bug-screenshots'),
    mailAttachments: path.join(dataDir, 'mail-attachments'),
  };
  for (const dir of [p.dataDir, p.photos, p.uploads, p.screenshots]) fs.mkdirSync(dir, { recursive: true });
  return p;
}

let root, paths, live;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'capshaw-backup-test-'));
  paths = installation(root);
  live = new Database(paths.database);
  live.pragma('journal_mode = WAL');
  live.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
  const insert = live.prepare('INSERT INTO users (email) VALUES (?)');
  for (let i = 0; i < 50; i++) insert.run(`member${i}@example.org`);
  fs.writeFileSync(path.join(paths.photos, 'smith.jpg'), 'jpeg bytes');
  fs.writeFileSync(path.join(paths.uploads, 'order.docx'), 'docx bytes');
  fs.writeFileSync(paths.scrapeCache, '{"members":[]}');
});

afterEach(() => {
  if (live && live.open) live.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('a backup of a running database holds every row and every file', async () => {
  const archive = path.join(root, 'nightly.tar.gz');
  // The write is still in the WAL, not the .db file: a file copy would miss it.
  live.prepare('INSERT INTO users (email) VALUES (?)').run('latest@example.org');

  const manifest = await createBackup({ out: archive, paths });

  expect(manifest.database.integrity).toBe('ok');
  expect(manifest.database.tables.users).toBe(51);
  expect(manifest.included.photos.files).toBe(1);
  expect(manifest.included.uploads.files).toBe(1);
  expect(manifest.included['members.json'].files).toBe(1);
  // Directories that do not exist yet are simply not in the archive.
  expect(manifest.included['mail-attachments']).toBeUndefined();

  const { tables } = await verifyBackup(archive);
  expect(tables.users).toBe(51);
});

test('restoring brings the data back and keeps what it replaced', async () => {
  const archive = path.join(root, 'nightly.tar.gz');
  await createBackup({ out: archive, paths });

  // Something goes wrong after the backup.
  live.exec('DELETE FROM users');
  live.close();
  // A crash can leave a WAL behind; it belongs to the old database.
  fs.writeFileSync(paths.database + '-wal', 'stale');
  fs.rmSync(path.join(paths.photos, 'smith.jpg'));
  fs.writeFileSync(path.join(paths.uploads, 'stray.docx'), 'new');

  const { aside } = await restoreBackup(archive, { paths, now: new Date('2026-11-18T03:00:00Z') });
  // The old WAL went aside with its database, not left beside the new one.
  expect(fs.existsSync(paths.database + '-wal')).toBe(false);
  expect(fs.existsSync(path.join(aside, 'bible_questions.db-wal'))).toBe(true);

  const restored = new Database(paths.database, { readonly: true });
  expect(restored.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(50);
  restored.close();
  expect(fs.readFileSync(path.join(paths.photos, 'smith.jpg'), 'utf8')).toBe('jpeg bytes');
  expect(fs.existsSync(path.join(paths.uploads, 'stray.docx'))).toBe(false);

  // Nothing was deleted: the broken state is all in the aside folder.
  expect(aside).toBe(path.join(paths.dataDir, 'pre-restore-2026-11-18T03-00-00-000Z'));
  const kept = new Database(path.join(aside, 'bible_questions.db'), { readonly: true });
  expect(kept.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(0);
  kept.close();
  expect(fs.existsSync(path.join(aside, 'uploads', 'stray.docx'))).toBe(true);
});

test('a damaged archive is refused and nothing is touched', async () => {
  const archive = path.join(root, 'nightly.tar.gz');
  await createBackup({ out: archive, paths });
  const bytes = fs.readFileSync(archive);
  fs.writeFileSync(archive, bytes.subarray(0, Math.floor(bytes.length / 2)));

  await expect(verifyBackup(archive)).rejects.toThrow();
  await expect(restoreBackup(archive, { paths })).rejects.toThrow();

  expect(live.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(50);
  expect(fs.readdirSync(paths.dataDir).filter((f) => f.startsWith('pre-restore-'))).toEqual([]);
  expect(fs.readdirSync(paths.dataDir).filter((f) => f.startsWith('.restore-'))).toEqual([]);
});

test('an archive whose database was altered fails its checksum', async () => {
  const archive = path.join(root, 'nightly.tar.gz');
  await createBackup({ out: archive, paths });

  // Unpack, change the database, repack with the original manifest.
  const work = fs.mkdtempSync(path.join(root, 'tamper-'));
  require('child_process').execFileSync('tar', ['-xzf', archive, '-C', work]);
  const db = new Database(path.join(work, 'capshaw-backup', 'database.db'));
  db.exec("INSERT INTO users (email) VALUES ('extra@example.org')");
  db.close();
  require('child_process').execFileSync('tar', ['-czf', archive, '-C', work, 'capshaw-backup']);

  await expect(verifyBackup(archive)).rejects.toThrow(/checksum/);
});
