// Where the app writes is now a deployment's choice: the droplet keeps
// everything under server/, a container points it at one volume. These check
// both — that a fresh install still writes exactly where it always did, and
// that one variable moves the lot.
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const SERVER_DIR = path.join(__dirname, '..');

// The module reads the environment once, when it is first required.
function pathsWith(env) {
  jest.resetModules();
  const before = { ...process.env };
  for (const key of ['CAPSHAW_DATA_DIR', 'CAPSHAW_DB_FILE', 'CAPSHAW_PHOTO_DIR', 'CAPSHAW_DATA_FILE', 'CAPSHAW_UPLOAD_DIR', 'CAPSHAW_BUG_SCREENSHOT_DIR']) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    return require('../lib/paths');
  } finally {
    process.env = before;
  }
}

describe('where this installation writes', () => {
  test('an installation that sets nothing writes where it always has', () => {
    const paths = pathsWith({});

    expect(paths.database).toBe(path.join(SERVER_DIR, 'data', 'bible_questions.db'));
    expect(paths.photos).toBe(path.join(SERVER_DIR, 'data', 'photos'));
    expect(paths.scrapeCache).toBe(path.join(SERVER_DIR, 'data', 'members.json'));
    expect(paths.uploads).toBe(path.join(SERVER_DIR, 'uploads'));
    expect(paths.screenshots).toBe(path.join(SERVER_DIR, 'data', 'bug-screenshots'));
  });

  test('one variable moves the database, the photos and the scrape cache together', () => {
    const paths = pathsWith({ CAPSHAW_DATA_DIR: '/srv/capshaw/data' });

    expect(paths.database).toBe(path.join('/srv/capshaw/data', 'bible_questions.db'));
    expect(paths.photos).toBe(path.join('/srv/capshaw/data', 'photos'));
    expect(paths.scrapeCache).toBe(path.join('/srv/capshaw/data', 'members.json'));
    expect(paths.screenshots).toBe(path.join('/srv/capshaw/data', 'bug-screenshots'));
  });

  test('bug screenshots are their own directory, kept apart from the family photos', () => {
    const paths = pathsWith({ CAPSHAW_DATA_DIR: '/srv/capshaw/data' });
    expect(paths.screenshots).not.toBe(paths.photos);

    const moved = pathsWith({ CAPSHAW_DATA_DIR: '/srv/capshaw/data', CAPSHAW_BUG_SCREENSHOT_DIR: '/srv/capshaw/screenshots' });
    expect(moved.screenshots).toBe('/srv/capshaw/screenshots');
  });

  test('uploads are separate, because they are working files rather than records', () => {
    const paths = pathsWith({ CAPSHAW_DATA_DIR: '/srv/capshaw/data' });
    expect(paths.uploads).toBe(path.join(SERVER_DIR, 'uploads'));

    const moved = pathsWith({ CAPSHAW_DATA_DIR: '/srv/capshaw/data', CAPSHAW_UPLOAD_DIR: '/srv/capshaw/uploads' });
    expect(moved.uploads).toBe('/srv/capshaw/uploads');
  });

  test('a single location can still be moved on its own, which is what the tests do', () => {
    const paths = pathsWith({ CAPSHAW_PHOTO_DIR: '/tmp/just-the-photos' });

    expect(paths.photos).toBe('/tmp/just-the-photos');
    // Everything else stays where it was.
    expect(paths.database).toBe(path.join(SERVER_DIR, 'data', 'bible_questions.db'));
  });

  test('a named location wins over the directory it would otherwise sit in', () => {
    const paths = pathsWith({ CAPSHAW_DATA_DIR: '/srv/data', CAPSHAW_DB_FILE: '/srv/elsewhere/church.db' });

    expect(paths.database).toBe('/srv/elsewhere/church.db');
    expect(paths.photos).toBe(path.join('/srv/data', 'photos'));
  });

  test('ensure() makes every directory, including the parents of the files', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'capshaw-paths-'));
    const paths = pathsWith({
      CAPSHAW_DATA_DIR:   path.join(scratch, 'data'),
      CAPSHAW_DB_FILE:    path.join(scratch, 'db', 'church.db'),
      CAPSHAW_UPLOAD_DIR: path.join(scratch, 'uploads'),
    });

    paths.ensure();

    expect(fs.existsSync(path.join(scratch, 'data'))).toBe(true);
    expect(fs.existsSync(path.join(scratch, 'data', 'photos'))).toBe(true);
    expect(fs.existsSync(path.join(scratch, 'data', 'bug-screenshots'))).toBe(true);
    expect(fs.existsSync(path.join(scratch, 'uploads'))).toBe(true);
    // The database's own directory, which nothing else would have created.
    expect(fs.existsSync(path.join(scratch, 'db'))).toBe(true);

    // Running it again on a directory that already exists is not an error.
    expect(() => paths.ensure()).not.toThrow();

    fs.rmSync(scratch, { recursive: true, force: true });
  });
});
