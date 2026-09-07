#!/usr/bin/env node
// Test harness for directory scraping (families, members, and photos).
//   node server/scripts/sync-directory.js [--no-photos] [--thumb] [--force] [--limit N]
const { scrapeDirectory, syncDirectoryPhotos, PHOTO_DIR } = require('../lib/directory');

const argv  = process.argv.slice(2);
const flag  = f => argv.includes(f);
const value = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

(async () => {
  const t0 = Date.now();

  // --limit only makes sense for a photos-only run; the family scrape is all-or-nothing.
  if (flag('--photos-only')) {
    const { summary } = await syncDirectoryPhotos({
      size:  flag('--thumb') ? 'thumb' : 'full',
      force: flag('--force'),
      limit: Number(value('--limit') || 0),
    });
    console.log(`[directory] photos: downloaded=${summary.downloaded} skipped=${summary.skipped} errors=${summary.errors}`);
    return process.exit(summary.errors > 0 ? 1 : 0);
  }

  console.log('[directory] scraping families, members' + (flag('--no-photos') ? '' : ', and photos') + '...');
  const { families, members, warnings, summary } = await scrapeDirectory({ photos: !flag('--no-photos') });

  for (const w of warnings) console.log(`  ! ${w}`);

  console.log(`\n[directory] photo dir: ${PHOTO_DIR}`);
  console.log(`[directory] families=${summary.families}/${summary.listed} members=${summary.members} withPhoto=${summary.withPhoto}`);
  if (summary.photos) {
    const p = summary.photos;
    console.log(`[directory] photos: downloaded=${p.downloaded} skipped=${p.skipped} errors=${p.errors} noPhoto=${p.noPhoto}`);
  }
  console.log(`[directory] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const sizes = {};
  for (const f of families) {
    const n = members.filter(m => m.familyId === f.id).length;
    sizes[n] = (sizes[n] || 0) + 1;
  }
  console.log('[directory] family sizes:', Object.entries(sizes).sort((a,b)=>a[0]-b[0]).map(([k,v]) => `${k}:${v}`).join(' '));
  process.exit(warnings.length > 0 ? 1 : 0);
})().catch(e => { console.error('[directory] failed:', e.message); process.exit(1); });
