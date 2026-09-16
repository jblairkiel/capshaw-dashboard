#!/usr/bin/env node
// Turns the coverage-summary.json each test runner writes into one Markdown
// table, and appends it to the GitHub Actions job summary when running there
// (GITHUB_STEP_SUMMARY), so coverage shows up on the workflow run itself
// without a third-party action or extra permissions. Run locally, it just
// prints the table.

const fs = require('fs');
const path = require('path');

const SUITES = [
  { label: 'Server (Jest)', file: path.join(__dirname, '../coverage/coverage-summary.json') },
  { label: 'Client (Vitest)', file: path.join(__dirname, '../client/coverage/coverage-summary.json') },
];

const METRICS = ['statements', 'branches', 'functions', 'lines'];

function pct(n) {
  return `${n.toFixed(2)}%`;
}

// A quick visual cue in a table that otherwise has to be read number by
// number — green once everything's solidly covered, amber while a metric
// is still thin, red only when something is barely tested at all.
function badge(n) {
  if (n >= 80) return '🟢';
  if (n >= 50) return '🟡';
  return '🔴';
}

function readSummary(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).total;
  } catch {
    return null;
  }
}

function buildTable() {
  const rows = [];
  let anyMissing = false;

  rows.push('| Suite | Statements | Branches | Functions | Lines |');
  rows.push('|---|---|---|---|---|');

  const totals = { statements: [0, 0], branches: [0, 0], functions: [0, 0], lines: [0, 0] };

  for (const suite of SUITES) {
    const summary = readSummary(suite.file);
    if (!summary) {
      anyMissing = true;
      rows.push(`| ${suite.label} | _no coverage data_ | | | |`);
      continue;
    }
    const cells = METRICS.map(m => `${badge(summary[m].pct)} ${pct(summary[m].pct)} (${summary[m].covered}/${summary[m].total})`);
    rows.push(`| ${suite.label} | ${cells.join(' | ')} |`);
    for (const m of METRICS) {
      totals[m][0] += summary[m].covered;
      totals[m][1] += summary[m].total;
    }
  }

  const combinedPossible = METRICS.every(m => totals[m][1] > 0);
  if (combinedPossible) {
    const cells = METRICS.map(m => {
      const p = (totals[m][0] / totals[m][1]) * 100;
      return `${badge(p)} ${pct(p)} (${totals[m][0]}/${totals[m][1]})`;
    });
    rows.push(`| **Combined** | ${cells.join(' | ')} |`);
  }

  return { table: rows.join('\n'), anyMissing };
}

function main() {
  const { table, anyMissing } = buildTable();

  const heading = '## Test Coverage';
  const note = anyMissing
    ? '\n> Some suites did not produce coverage data — run `npm run test:coverage` and `npm run test:client:coverage` locally to fill this in.'
    : '';
  const body = `${heading}\n\n${table}\n${note}\n`;

  console.log(body);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, `${body}\n`);
  }

  // Also written to a fixed path so a later CI step can turn it into a PR
  // comment without re-deriving the table.
  fs.writeFileSync(path.join(__dirname, '../coverage-summary.md'), `${body}\n`);
}

main();
