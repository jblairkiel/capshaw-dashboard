#!/usr/bin/env node
// The security audit CI runs on both package trees (the server at the root,
// and client/). It fails on any high or critical advisory, the same as
// `npm audit --audit-level=high`, with one difference: an advisory somebody
// has looked at and written down in scripts/audit-allowlist.json is let
// through until the date given there.
//
// That list is for the case `npm audit` cannot tell apart: an advisory in a
// tool used only to build or test the site, which no visitor's request can
// reach, and which has no fix short of a major upgrade. Two things keep it
// from becoming a place advisories go to be forgotten:
//
//   - every entry expires. Past its date it fails the build again, and has
//     to be looked at afresh.
//   - it only ever covers development dependencies. An advisory that reaches
//     the production tree (what the server runs, what the browser loads)
//     fails whatever the list says.
//
//   node scripts/audit.js            the root (server) tree
//   node scripts/audit.js client     the client tree

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BLOCKING = new Set(['high', 'critical']);
const ALLOWLIST_FILE = path.join(__dirname, 'audit-allowlist.json');

function runAudit(dir, { productionOnly = false } = {}) {
  const args = ['audit', '--json', ...(productionOnly ? ['--omit=dev'] : [])];
  const out = spawnSync('npm', args, { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
  try {
    return JSON.parse(out.stdout || '{}');
  } catch {
    throw new Error(`npm audit gave no report for ${dir}:\n${out.stderr || out.stdout}`);
  }
}

// Every advisory in an `npm audit --json` report, once each, with the
// packages it was found in.
function advisoriesIn(report) {
  const found = new Map();
  for (const vuln of Object.values(report.vulnerabilities || {})) {
    for (const via of vuln.via || []) {
      if (typeof via !== 'object') continue;
      const id = String(via.url || '').split('/').pop() || String(via.source);
      if (!found.has(id)) found.set(id, { id, title: via.title, severity: via.severity, url: via.url, packages: new Set() });
      found.get(id).packages.add(vuln.name);
    }
  }
  return [...found.values()].map(a => ({ ...a, packages: [...a.packages].sort() }));
}

function loadAllowlist(file = ALLOWLIST_FILE) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).advisories || [];
}

// Which blocking advisories fail the build. `all` is the full tree's report,
// `production` the same with dev dependencies left out.
function judge({ all, production, allowlist, today = new Date().toISOString().slice(0, 10) }) {
  const inProduction = new Set(advisoriesIn(production).map(a => a.id));
  const failures = [];
  const allowed = [];
  for (const a of advisoriesIn(all).filter(x => BLOCKING.has(x.severity))) {
    const entry = allowlist.find(e => e.id === a.id);
    if (inProduction.has(a.id)) failures.push({ ...a, why: 'reaches the production tree' });
    else if (!entry) failures.push({ ...a, why: 'not on the allowlist' });
    else if (!entry.until || entry.until < today) failures.push({ ...a, why: `allowlist entry expired ${entry.until || '(no date)'}` });
    else allowed.push({ ...a, until: entry.until, reason: entry.reason });
  }
  return { failures, allowed };
}

function main() {
  const dir = path.resolve(__dirname, '..', process.argv[2] || '.');
  const name = path.relative(path.resolve(__dirname, '..'), dir) || 'root';
  const { failures, allowed } = judge({
    all: runAudit(dir),
    production: runAudit(dir, { productionOnly: true }),
    allowlist: loadAllowlist(),
  });

  for (const a of allowed) {
    console.log(`allowed until ${a.until}: ${a.severity} ${a.id} in ${a.packages.join(', ')} — ${a.title}\n  ${a.reason}`);
  }
  if (!failures.length) {
    console.log(`Security audit (${name}): no high or critical advisories${allowed.length ? ' beyond the allowlist' : ''}.`);
    return 0;
  }
  console.error(`Security audit (${name}): ${failures.length} high or critical ${failures.length === 1 ? 'advisory' : 'advisories'}:`);
  for (const a of failures) {
    console.error(`  ${a.severity} ${a.id} in ${a.packages.join(', ')} — ${a.title} (${a.why})\n    ${a.url}`);
  }
  console.error('Run `npm audit` for the details and the fix.');
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = { advisoriesIn, judge, loadAllowlist };
