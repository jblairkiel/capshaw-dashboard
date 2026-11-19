#!/usr/bin/env node
// ─── The backup command ───────────────────────────────────────────────────────
//
//   node server/tools/backup.js create  <file|->     write an archive
//   node server/tools/backup.js verify  <file|-> [--quiet] [--counts]   check one, change nothing
//   node server/tools/backup.js restore <file|-> --yes
//
// The nightly job and the Server setup workflow both run this, and that
// workflow's logs are public (the repository is). So by default it reports
// pass/fail, sizes and how many tables, never how many members, groups or
// emails there are. --counts adds the per-table row counts, for someone at
// the droplet's own terminal.
//
// '-' means stdout for create and stdin for the others, which is how the host
// script talks to the container without a shared directory:
//
//   docker compose exec -T app node server/tools/backup.js create - > nightly.tar.gz
//
// Everything human-readable goes to stderr, so stdout can carry the archive.
// The host-side scheduling, retention and off-server copy are in
// scripts/backup/ — see scripts/backup/README.md.
require('dotenv').config({ quiet: true });
const { createBackup, verifyBackup, restoreBackup } = require('../lib/backup');
const paths = require('../lib/paths');

const log = (...args) => console.error(...args);

function summarize(manifest, tables, { counts = false } = {}) {
  const t = tables || manifest.database.tables;
  log(`  taken     ${manifest.createdAt}`);
  log(`  database  ${(manifest.database.bytes / 1024).toFixed(0)} KiB, ${Object.keys(t).length} tables, integrity ${manifest.database.integrity}`);
  if (counts) {
    for (const [key, n] of Object.entries(t)) log(`            ${key}: ${n}`);
  }
  for (const [name, { files, bytes }] of Object.entries(manifest.included)) {
    log(`  ${name.padEnd(17)} ${files} file(s), ${(bytes / 1024).toFixed(0)} KiB`);
  }
}

async function main(argv) {
  const [command, target, ...rest] = argv;
  if (!command || !target || !['create', 'verify', 'restore'].includes(command)) {
    log('usage: backup.js create <archive|->\n       backup.js verify <archive|-> [--quiet] [--counts]\n       backup.js restore <archive|-> --yes');
    return 2;
  }

  const counts = rest.includes('--counts');

  if (command === 'create') {
    log(`Backing up ${paths.dataDir}`);
    const manifest = await createBackup({ out: target });
    summarize(manifest, null, { counts });
    log(`Backup written to ${target === '-' ? 'stdout' : target}`);
    return 0;
  }

  if (command === 'verify') {
    const { manifest, tables } = await verifyBackup(target);
    if (rest.includes('--quiet')) {
      log(`Verified: checksum matches, integrity ok, ${Object.keys(tables).length} tables`);
      return 0;
    }
    log('Backup is sound:');
    summarize(manifest, tables, { counts });
    return 0;
  }

  if (!rest.includes('--yes')) {
    log('restore replaces the live database. Stop the app first, then pass --yes.');
    log('(scripts/backup/capshaw-restore.sh does both and starts it again.)');
    return 2;
  }
  log(`Restoring into ${paths.dataDir}`);
  const { manifest, aside, movedAside } = await restoreBackup(target);
  log(`  restored the backup taken ${manifest.createdAt}: ${Object.keys(manifest.included).join(', ')}`);
  if (aside) log(`What it replaced (${movedAside.join(', ')}) is in ${aside}`);
  log('Restore complete.');
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => { log(`backup ${process.argv[2] || ''} failed: ${err.message}`); process.exit(1); },
);
