// ─── HTML helpers ─────────────────────────────────────────────────────────────

function stripTags(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&bull;/g, '•').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»').replace(/&lsaquo;/g, '‹').replace(/&rsaquo;/g, '›')
    .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, '')
    .replace(/\s+/g, ' ').trim();
}

function extractTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(t => {
    const rows = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
    return rows.map(row =>
      [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(c => stripTags(c[1])).filter(Boolean)
    ).filter(r => r.length > 0);
  });
}

// ─── Page parsers ─────────────────────────────────────────────────────────────

function parseJobAssignments(html) {
  const tables = extractTables(html);
  const main   = tables.sort((a, b) => b.length - a.length)[0] || [];
  const mMatch = html.match(/>\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\s*</);

  const assignments = [];
  let currentDate   = '';
  for (const row of main) {
    if (row.length === 4 && row[1] === 'Service') {
      currentDate = row[0];
    } else if (row.length === 3 && currentDate) {
      assignments.push({ date: currentDate, service: row[0], job: row[1], name: row[2] });
    }
  }
  return { month: mMatch ? mMatch[1] : '', assignments };
}

function parseAttendance(html) {
  const records = [];
  for (const table of extractTables(html)) {
    for (const row of table) {
      if (row[0] === 'Date') continue;
      if (row.length >= 3 && row[0].match(/\d{2}\/\d{2}\/\d{2}/)) {
        records.push({ date: row[0], service: row[1], count: parseInt(row[2], 10) || 0 });
      }
    }
  }
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

function parseSermons(html) {
  const sermons = [];
  for (const table of extractTables(html)) {
    for (const row of table) {
      if (row[0] === 'Date') continue;
      if (row.length >= 4 && row[0].match(/\d{2}\/\d{2}\/\d{2}/)) {
        sermons.push({ date: row[0], title: row[1], speaker: row[2], type: row[3] || '', series: row[4] || '', service: row[5] || '' });
      }
    }
  }
  return sermons;
}

function parseVisitors(html) {
  const visitors = [];
  for (const sec of [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>[\s\S]*?(<table[\s\S]*?<\/table>)/gi)]) {
    const name = stripTags(sec[1]);
    if (name === 'Visitor Tracker') continue;
    const visits = (extractTables(sec[2])[0] || [])
      .filter(r => r[0] !== 'Date' && r[0]?.match(/\d{2}\/\d{2}\/\d{2}/))
      .map(r => ({ date: r[0], service: r[1] || '' }));
    if (visits.length > 0) visitors.push({ name, visits });
  }
  return visitors;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function parseAnniversaries(html) {
  const tables = extractTables(html);
  const main   = tables.sort((a, b) => b.length - a.length)[0] || [];
  const entries = [];
  let currentMonth = '';
  for (const row of main) {
    if (row.length === 1 && MONTHS.includes(row[0])) {
      currentMonth = row[0];
    } else if (row.length === 2 && currentMonth && row[0].match(/^\d+\/\d+/)) {
      const [m, d] = row[0].split('/').map(Number);
      entries.push({ month: currentMonth, date: row[0], names: row[1], monthNum: m, day: d });
    }
  }
  return entries;
}

function parseDeacons(html) {
  const SKIP = new Set(['Our Deacons', 'Their Duties', 'Deacons', 'Capshaw', 'Sunday', 'Wednesday', 'YouTube', 'Menu']);
  const deacons = [];
  const bodyStart = html.indexOf('Our Deacons');
  const bodyContent = bodyStart > -1 ? html.slice(bodyStart) : html;
  const parts = bodyContent.split(/<strong[^>]*>/i);
  for (const part of parts) {
    const nameMatch = part.match(/^([^<]{4,50})<\/strong>/i);
    if (!nameMatch) continue;
    const name = stripTags(nameMatch[1]);
    if (!name || SKIP.has(name) || name.includes('Duties') || name.includes('shepherds') || name.length > 50) continue;
    const duties = [...part.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map(m => stripTags(m[1]))
      .filter(d => d.length > 5 && d.length < 120 && !d.includes('Bible Study') && !d.includes('YouTube'));
    if (duties.length > 0) deacons.push({ name, duties });
  }
  return deacons;
}

function parseBulletins(html) {
  const section = html.match(/Capshaw Bulletin([\s\S]*?)(?:Member News|<h[1-4])/i)?.[1] || '';
  return [...section.matchAll(/href="([^"]+\.pdf[^"]*)"[^>]*>\s*([^<]+)/gi)]
    .map(m => ({ url: m[1], label: stripTags(m[2]).trim() }))
    .filter(b => b.label && b.label.length > 3);
}

module.exports = {
  stripTags,
  extractTables,
  parseJobAssignments,
  parseAttendance,
  parseSermons,
  parseVisitors,
  parseAnniversaries,
  parseDeacons,
  parseBulletins,
};
