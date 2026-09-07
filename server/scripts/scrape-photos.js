#!/usr/bin/env node
// Test harness for directory photo scraping.
//   node server/scripts/scrape-photos.js [--thumb] [--force] [--limit N]
const { syncDirectoryPhotos, PHOTO_DIR } = require('../lib/directoryPhotos');

const argv  = process.argv.slice(2);
const flag  = f => argv.includes(f);
const value = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

(async () => {
  const opts = {
    size:  flag('--thumb') ? 'thumb' : 'full',
    force: flag('--force'),
    limit: Number(value('--limit') || 0),
  };
  console.log(`[photos] scraping ${opts.size} photos${opts.limit ? ` (limit ${opts.limit})` : ''}...`);

  const t0 = Date.now();
  const { results, summary } = await syncDirectoryPhotos(opts);

  for (const r of results.filter(r => r.status === 'error')) {
    console.log(`  ✗ ${r.familyName} (${r.familyId}): ${r.error}`);
  }
  console.log(`\n[photos] dir: ${PHOTO_DIR}`);
  console.log(`[photos] families=${summary.families} withPhoto=${summary.withPhoto} noPhoto=${summary.noPhoto}`);
  console.log(`[photos] downloaded=${summary.downloaded} skipped=${summary.skipped} errors=${summary.errors} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(summary.errors > 0 ? 1 : 0);
})().catch(e => { console.error('[photos] failed:', e.message); process.exit(1); });
