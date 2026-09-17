// The deployment is three files that have to agree with each other: the
// Dockerfile says where the app writes, the compose file mounts a volume
// there, and the workflow deploys the image the compose file expects. Nothing
// at runtime notices when they stop agreeing — the app simply starts writing
// the congregation's records somewhere that is thrown away with the container.
const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root       = path.join(__dirname, '..', '..');
const read       = file => fs.readFileSync(path.join(root, file), 'utf8');
const dockerfile = read('Dockerfile');
const compose    = yaml.load(read('docker-compose.yml'));
const workflow   = yaml.load(read('.github/workflows/ci-cd.yml'));

const app = compose.services.app;

describe('what the image writes, and where it survives', () => {
  // The whole point of the volume. If these two drift, the database is inside
  // the container and a deploy takes the congregation's records with it.
  test('the volume is mounted where the app is told to write', () => {
    const dataDir = /CAPSHAW_DATA_DIR=(\S+)/.exec(dockerfile)?.[1];
    expect(dataDir).toBe('/data');

    const mounted = app.volumes.map(v => String(v).split(':')[1]);
    expect(mounted).toContain(dataDir);
  });

  test('uploads land under the volume too, not beside the code', () => {
    const uploadDir = /CAPSHAW_UPLOAD_DIR=(\S+)/.exec(dockerfile)?.[1];
    expect(uploadDir).toBe('/data/uploads');
    expect(uploadDir.startsWith('/data')).toBe(true);
  });

  test('the volume is a named one, so nothing depends on a path on the host', () => {
    const named = app.volumes.map(v => String(v).split(':')[0]);
    expect(named).toContain('capshaw-data');
    expect(compose.volumes).toHaveProperty('capshaw-data');
  });

  test('it is published on the loopback only, with nginx in front', () => {
    for (const mapping of app.ports) {
      expect(String(mapping)).toMatch(/^127\.0\.0\.1:/);
    }
  });
});

describe('the deploy runs what CI exercised', () => {
  const imageJob  = workflow.jobs.image;
  const deployJob = workflow.jobs.deploy;

  test('nothing deploys until the image job has proved the image serves', () => {
    expect(deployJob.needs).toContain('image');
    expect(deployJob.needs).toContain('test');
  });

  test('the image is published only after it has been started and checked', () => {
    const names = imageJob.steps.map(s => s.name || s.uses);
    const checked   = names.findIndex(n => /Check what it serves/i.test(n));
    const published = names.findIndex(n => /^Publish it$/i.test(n));

    expect(checked).toBeGreaterThan(-1);
    expect(published).toBeGreaterThan(checked);
  });

  test('publishing happens on main only, never from a pull request', () => {
    for (const step of imageJob.steps) {
      if (!/Publish it|Sign in to the registry/i.test(step.name || '')) continue;
      expect(step.if).toContain("github.ref == 'refs/heads/main'");
      expect(step.if).toContain("github.event_name == 'push'");
    }
    expect(imageJob.permissions).toHaveProperty('packages', 'write');
  });

  test('the deploy pins the commit it is deploying, not a moving tag', () => {
    const script = JSON.stringify(deployJob.steps[0]);
    // A tag like `:main` moves; the point of deploying by commit is that a
    // rollback and a redeploy both name something that cannot change.
    expect(script).toContain('${{ github.sha }}');
    expect(script).not.toMatch(/ghcr\.io\/\$\{\{ github\.repository \}\}:main/);
  });

  test('the compose file takes the image the deploy hands it', () => {
    // The deploy exports CAPSHAW_IMAGE; if the compose file stopped reading it,
    // the droplet would quietly keep running whatever it had.
    expect(app.image).toContain('CAPSHAW_IMAGE');
    const script = deployJob.steps[0].with.script;
    expect(script).toMatch(/export CAPSHAW_IMAGE=/);
    expect(script).toMatch(/--no-build/);
  });

  test('a deploy that does not come up healthy rolls back and fails', () => {
    const script = deployJob.steps[0].with.script;
    expect(script).toMatch(/Rolling back/);
    expect(script).toMatch(/State\.Health\.Status/);
    // It must fail the job. A deploy that rolls back and reports success is
    // how a broken release gets forgotten about.
    expect(script.trimEnd().endsWith('exit 1')).toBe(true);
  });
});
