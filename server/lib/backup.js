// ─── Backing up and restoring everything this installation writes ─────────────
//
// One archive holds the lot: a consistent snapshot of the SQLite database plus
// the directories beside it (photos, uploads, bug screenshots, mail
// attachments) and the cached scrape. See server/lib/paths.js for where each of
// those lives; this module reads the same paths, so a backup taken in the
// container and one taken on the PM2 droplet have the same layout inside.
//
// The database is copied with SQLite's online backup API rather than by
// copying the file. The app keeps it in WAL mode, so the .db file on its own is
// not the whole database while the server is running — a plain `cp` can catch
// it halfway through a checkpoint. The backup API takes a consistent copy while
// the app keeps serving.
//
// Archive layout (a .tar.gz):
//
//   capshaw-backup/
//     manifest.json      what is in it, when it was taken, the database's sha256
//     database.db        the snapshot, already checked with integrity_check
//     photos/  uploads/  bug-screenshots/  mail-attachments/  members.json
//
// Restoring never deletes anything: whatever it replaces is moved into
// <data dir>/pre-restore-<timestamp>/ first, so a restore of the wrong archive
// is itself undoable.
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const crypto  = require('crypto');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = 'capshaw-backup';
const FORMAT = 1;

// Everything besides the database, by the name it has inside the archive.
function entries(paths) {
  return [
    { name: 'photos',           source: paths.photos,          kind: 'dir'  },
    { name: 'uploads',          source: paths.uploads,         kind: 'dir'  },
    { name: 'bug-screenshots',  source: paths.screenshots,     kind: 'dir'  },
    { name: 'mail-attachments', source: paths.mailAttachments, kind: 'dir'  },
    { name: 'members.json',     source: paths.scrapeCache,     kind: 'file' },
  ];
}

function loadPaths() {
  return require('./paths');
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function countFiles(dir) {
  let files = 0, bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countFiles(full);
      files += sub.files; bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1; bytes += fs.statSync(full).size;
    }
  }
  return { files, bytes };
}

// Opens the snapshot read-only and says whether SQLite thinks it is sound, and
// how many rows each table holds (which is what tells a person at a glance
// whether this is the archive they meant).
function inspectDatabase(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    const tables = {};
    for (const { name } of db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all()) {
      tables[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get().n;
    }
    return { integrity, tables };
  } finally {
    db.close();
  }
}

// Runs tar with the archive on a file or on this process's stdin/stdout ('-').
function tar(args, archive, direction) {
  return new Promise((resolve, reject) => {
    const stdio = ['ignore', 'ignore', 'pipe'];
    if (archive === '-') stdio[direction === 'out' ? 1 : 0] = 'inherit';
    const child = spawn('tar', args, { stdio });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with ${code}: ${stderr.trim()}`));
    });
  });
}

// Writes a backup archive to `out` (a path, or '-' for stdout) and returns its
// manifest.
async function createBackup({ out, paths = loadPaths() } = {}) {
  if (!out) throw new Error('createBackup needs somewhere to write: a file path or "-"');
  if (!fs.existsSync(paths.database)) {
    throw new Error(`No database at ${paths.database} — is CAPSHAW_DATA_DIR pointing at the right place?`);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'capshaw-backup-'));
  const root = path.join(staging, ROOT);
  fs.mkdirSync(root);

  try {
    const snapshot = path.join(root, 'database.db');
    const source = new Database(paths.database, { readonly: true, fileMustExist: true });
    try {
      await source.backup(snapshot);
    } finally {
      source.close();
    }

    const { integrity, tables } = inspectDatabase(snapshot);
    if (integrity !== 'ok') {
      throw new Error(`The database snapshot failed integrity_check: ${integrity}`);
    }

    const included = {};
    for (const entry of entries(paths)) {
      if (!fs.existsSync(entry.source)) continue;
      // Linked rather than copied: tar -h follows the link, so the archive gets
      // the real files without a second copy of every photo on disk.
      fs.symlinkSync(entry.source, path.join(root, entry.name));
      included[entry.name] = entry.kind === 'dir'
        ? countFiles(entry.source)
        : { files: 1, bytes: fs.statSync(entry.source).size };
    }

    const manifest = {
      format: FORMAT,
      createdAt: new Date().toISOString(),
      host: os.hostname(),
      database: {
        bytes: fs.statSync(snapshot).size,
        sha256: sha256(snapshot),
        integrity,
        tables,
      },
      included,
    };
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    await tar(['-czhf', out === '-' ? '-' : path.resolve(out), '-C', staging, ROOT], out, 'out');
    return manifest;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// Unpacks an archive into `into` and checks it: the manifest is there, the
// database matches its recorded checksum and passes integrity_check. Returns
// the manifest and where the unpacked tree is.
async function unpackAndVerify(archive, into) {
  await tar(['-xzf', archive === '-' ? '-' : path.resolve(archive), '-C', into, '--no-same-owner'], archive, 'in');

  const root = path.join(into, ROOT);
  const manifestFile = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error('Not a Capshaw backup: there is no manifest.json inside it');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.format !== FORMAT) throw new Error(`Unknown backup format ${manifest.format}`);

  const snapshot = path.join(root, 'database.db');
  if (!fs.existsSync(snapshot)) throw new Error('The archive has no database.db');
  const actual = sha256(snapshot);
  if (actual !== manifest.database.sha256) {
    throw new Error(`database.db does not match its checksum (expected ${manifest.database.sha256}, got ${actual})`);
  }
  const { integrity, tables } = inspectDatabase(snapshot);
  if (integrity !== 'ok') throw new Error(`database.db failed integrity_check: ${integrity}`);

  return { manifest, root, tables };
}

// Checks an archive without touching the installation.
async function verifyBackup(archive) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'capshaw-verify-'));
  try {
    const { manifest, tables } = await unpackAndVerify(archive, staging);
    return { manifest, tables };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// Moves a file or directory, falling back to copy-and-delete across devices
// (in a PM2 install the uploads directory can sit on another mount).
function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// Replaces the installation's data with the archive's. The app must not be
// running: it holds the database open, and would keep writing to the file
// that has just been moved aside.
async function restoreBackup(archive, { paths = loadPaths(), now = new Date() } = {}) {
  fs.mkdirSync(paths.dataDir, { recursive: true });
  // Unpacked inside the data directory so moving it into place is a rename.
  const staging = fs.mkdtempSync(path.join(paths.dataDir, '.restore-'));
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const aside = path.join(paths.dataDir, `pre-restore-${stamp}`);

  try {
    const { manifest, root } = await unpackAndVerify(archive, staging);
    const movedAside = [];

    // The database, with its WAL and shared-memory files. Leaving a stale -wal
    // beside a restored .db is how a restore corrupts the thing it restored.
    for (const suffix of ['', '-wal', '-shm']) {
      const current = paths.database + suffix;
      if (fs.existsSync(current)) {
        move(current, path.join(aside, path.basename(current)));
        movedAside.push(path.basename(current));
      }
    }
    move(path.join(root, 'database.db'), paths.database);

    for (const entry of entries(paths)) {
      const restored = path.join(root, entry.name);
      // An archive taken before a directory existed leaves today's alone.
      if (!fs.existsSync(restored)) continue;
      if (fs.existsSync(entry.source)) {
        move(entry.source, path.join(aside, entry.name));
        movedAside.push(entry.name);
      }
      move(restored, entry.source);
    }

    return { manifest, aside: movedAside.length ? aside : null, movedAside };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { createBackup, verifyBackup, restoreBackup };
