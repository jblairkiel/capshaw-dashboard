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

  test('the host prerequisites are checked before anything is pulled', () => {
    const script = deployJob.steps[0].with.script;
    // Each of these is a one-time setup step on the droplet, not a bug in the
    // release. The deploy has to say which one is missing: "permission denied
    // on /var/run/docker.sock" halfway through a pull reads like a broken
    // build, and the fix never gets made.
    const preflight = script.slice(0, script.indexOf('docker compose pull'));
    expect(preflight).toMatch(/command -v docker/);
    expect(preflight).toMatch(/docker compose version/);
    expect(preflight).toMatch(/docker info/);
    expect(preflight).toMatch(/usermod -aG docker/);
  });

  test('a checkout owned by another user is trusted, not a dead end', () => {
    const script = deployJob.steps[0].with.script;
    // Installing Docker is done as root, and root-owned files in the checkout
    // make git refuse to read it. The deploy only reads this repository.
    const trusted = script.indexOf('safe.directory');
    const pull    = script.indexOf('git pull origin main');
    expect(trusted).toBeGreaterThan(-1);
    expect(trusted).toBeLessThan(pull);
    // And when it still cannot read it, it says whose files they are.
    expect(script).toMatch(/chown -R/);
  });

  test('a container that will not start still gets diagnosed and rolled back', () => {
    const script = deployJob.steps[0].with.script;
    // `set -e` would end the job on the failed `up` itself, skipping the logs
    // and the rollback — which is exactly the run where both are wanted.
    expect(script).toMatch(/docker compose up -d --no-build app \|\| started=0/);
    // And the rollback must not end the job before it has said what happened.
    expect(script).toMatch(/Rolling back[\s\S]*up -d --no-build app \|\| true/);
  });

  test('PM2 is stopped for the port before the container is started', () => {
    const script = deployJob.steps[0].with.script;
    const stop = script.indexOf('pm2 stop capshaw-dashboard');
    const up   = script.indexOf('docker compose up -d --no-build app');
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(up);
    // Stopped, not deleted: the site has to have something to go back to.
    expect(script).not.toMatch(/^\s*pm2 delete/m);
  });

  test('PM2 gets the site back when nothing else came up', () => {
    const script = deployJob.steps[0].with.script;
    // Stopping PM2 is only safe if a deploy that then fails hands it back —
    // otherwise a bad image leaves the congregation with no site at all.
    expect(script).toMatch(/rolled_back=0[\s\S]*pm2 start capshaw-dashboard/);
    // And not while the rolled-back container is serving on that same port.
    expect(script).toMatch(/\[ "\$pm2_was_running" = "1" \] && \[ "\$rolled_back" = "0" \]/);
  });

  test('the one host-side cause of a failed start is named, not left to guess', () => {
    const script = deployJob.steps[0].with.script;
    // "address already in use" is the failure the container's own logs cannot
    // explain: on this droplet PM2 restarts itself and takes 3001 back.
    const diagnosis = script.slice(script.indexOf('DEPLOY FAILED'));
    expect(diagnosis).toMatch(/3001/);
    expect(diagnosis).toMatch(/pm2 delete capshaw-dashboard/);
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
