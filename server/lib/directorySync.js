const { savePhoto: defaultSavePhoto } = require('./photoStore');

// ─── Directory sync ───────────────────────────────────────────────────────────
// Unlike the other sections this one is NOT wiped and re-inserted. Directory
// rows carry identity: accounts link to them and worship preferences hang off
// them, so their ids must survive a re-scrape. Rows are matched by name and
// updated in place, and any field a person or admin edited by hand is left
// alone rather than being overwritten by the website's copy.

function syncDirectory(db, people, options = {}) {
  // Photo writing is injected so the sync stays a pure database operation in
  // tests. Pass savePhoto: null to skip photos entirely.
  const savePhoto = options.savePhoto === undefined ? defaultSavePhoto : options.savePhoto;
  const summary   = { inserted: 0, updated: 0, removed: 0, photos: 0, photoUrlsSkipped: 0 };

  const existing = db.prepare('SELECT * FROM directory').all();
  const byName   = new Map();
  for (const row of existing) {
    const key = row.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }

  const insert = db.prepare(
    'INSERT INTO directory (name, address, city, state, zip, phone, cell, email, notes, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const seen = new Set();

  for (const person of people) {
    if (!person.name?.trim()) continue;
    const candidates = byName.get(person.name.trim().toLowerCase()) || [];
    // Same name more than once: prefer the one at the same address.
    const match = candidates.find(c => !seen.has(c.id) && c.address === (person.address || ''))
               ?? candidates.find(c => !seen.has(c.id));

    // A photo arrives either already in the store (the directory scrape
    // downloads family portraits and hands back the filename), inline as
    // base64, or as a URL we do not download.
    let photoFile = null;
    if (person.photo?.file) {
      photoFile = person.photo.file;
      summary.photos++;
    } else if (person.photo?.base64 && savePhoto) {
      photoFile = savePhoto(person.photo);
      if (photoFile) summary.photos++;
    } else if (person.photo?.url) {
      summary.photoUrlsSkipped++;
    }

    if (!match) {
      const id = insert.run(
        person.name, person.address || '', person.city || '', person.state || '',
        person.zip || '', person.phone || '', person.cell || '', person.email || '', person.notes || '',
        photoFile || ''
      ).lastInsertRowid;
      seen.add(id);
      summary.inserted++;
      continue;
    }

    seen.add(match.id);

    let protectedFields = [];
    try { protectedFields = JSON.parse(match.edited_fields || '[]'); } catch { /* treat as unedited */ }

    const updates = [];
    const values  = [];
    for (const field of ['address', 'city', 'state', 'zip', 'phone', 'cell', 'email', 'notes']) {
      if (protectedFields.includes(field)) continue;
      const next = person[field] || '';
      if (next !== match[field]) { updates.push(`${field} = ?`); values.push(next); }
    }
    // The photo is never hand-edited, so it always follows the site.
    if (photoFile && photoFile !== match.photo) { updates.push('photo = ?'); values.push(photoFile); }

    if (updates.length) {
      db.prepare(`UPDATE directory SET ${updates.join(', ')} WHERE id = ?`).run(...values, match.id);
      summary.updated++;
    }
  }

  // Drop people the website no longer lists — but only pure scrape artifacts.
  // Anything edited locally, linked to an account, or carrying worship
  // preferences is congregation data we did not create and must not delete.
  const removable = db.prepare(`
    SELECT d.id FROM directory d
    WHERE d.edited_fields = '[]'
      AND NOT EXISTS (SELECT 1 FROM users u              WHERE u.directory_id = d.id)
      AND NOT EXISTS (SELECT 1 FROM worship_preferences w WHERE w.directory_id = d.id)
      AND NOT EXISTS (SELECT 1 FROM worship_profile p     WHERE p.directory_id = d.id)
  `).all().map(r => r.id).filter(id => !seen.has(id));

  const del = db.prepare('DELETE FROM directory WHERE id = ?');
  for (const id of removable) { del.run(id); summary.removed++; }

  // Drop photo files nothing points at any more — but never on the strength of
  // an empty reference set. A directory with no photos in it is what a fresh
  // database, a failed scrape, or a test fixture all look like, and none of
  // them is a reason to empty the store.
  if (savePhoto === defaultSavePhoto) {
    const referenced = db.prepare("SELECT photo FROM directory WHERE photo <> ''").all().map(r => r.photo);
    if (referenced.length > 0) {
      try { require('./photoStore').pruneUnreferenced(referenced); } catch { /* non-fatal */ }
    }
  }

  return summary;
}

module.exports = { syncDirectory };
