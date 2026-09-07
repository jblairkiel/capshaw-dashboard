// Distribution groups: named lists this site sends to.
//
// A group is not a mailbox. "elders@capshawchurch.org" as an address people
// can write *to* has to exist at the mail provider — this application can only
// send to the people in a list.

const db = require('../db');

function listGroups() {
  return db.prepare(`
    SELECT g.*, COUNT(m.id) AS member_count
    FROM mail_groups g
    LEFT JOIN mail_group_members m ON m.group_id = g.id
    GROUP BY g.id
    ORDER BY g.sort_order ASC, g.name ASC
  `).all();
}

function getGroup(key) {
  return db.prepare('SELECT * FROM mail_groups WHERE key = ?').get(key) || null;
}

// The members as stored, with the directory name and current address attached
// so the admin screen can show who is on the list and spot a missing address.
function membersOf(groupId) {
  return db.prepare(`
    SELECT m.id, m.directory_id, m.email AS raw_email,
           d.name AS directory_name, d.email AS directory_email
    FROM mail_group_members m
    LEFT JOIN directory d ON d.id = m.directory_id
    WHERE m.group_id = ?
    ORDER BY COALESCE(d.name, m.email) ASC
  `).all(groupId).map(row => ({
    id:          row.id,
    directoryId: row.directory_id,
    name:        row.directory_name || '',
    // A directory member's address follows the directory, so correcting it
    // there fixes every group they are in at once.
    email:       (row.directory_id ? row.directory_email : row.raw_email) || '',
  }));
}

// The addresses a message to this group would actually go to. Anyone whose
// address is missing is dropped here and reported separately, so a silent
// gap in the directory does not look like a delivery that worked.
function recipientsFor(key) {
  const group = getGroup(key);
  if (!group) return { recipients: [], missing: [], group: null };

  const members = membersOf(group.id);
  const recipients = [];
  const missing = [];
  const seen = new Set();

  for (const member of members) {
    const email = (member.email || '').trim().toLowerCase();
    if (!email) { missing.push(member.name || `directory #${member.directoryId}`); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    recipients.push({ email, name: member.name });
  }

  return { recipients, missing, group };
}

function addMember(groupId, { directoryId = null, email = '' }) {
  if (directoryId) {
    const person = db.prepare('SELECT id FROM directory WHERE id = ?').get(directoryId);
    if (!person) return { error: 'That person is not in the directory' };

    const already = db.prepare('SELECT 1 FROM mail_group_members WHERE group_id = ? AND directory_id = ?')
      .get(groupId, directoryId);
    if (already) return { error: 'They are already in this group' };

    db.prepare('INSERT INTO mail_group_members (group_id, directory_id) VALUES (?, ?)').run(groupId, directoryId);
    return { ok: true };
  }

  const address = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return { error: 'That is not a valid email address' };

  const already = db.prepare('SELECT 1 FROM mail_group_members WHERE group_id = ? AND lower(email) = ?')
    .get(groupId, address);
  if (already) return { error: 'That address is already in this group' };

  db.prepare('INSERT INTO mail_group_members (group_id, email) VALUES (?, ?)').run(groupId, address);
  return { ok: true };
}

function removeMember(groupId, memberId) {
  const row = db.prepare('SELECT * FROM mail_group_members WHERE id = ? AND group_id = ?').get(memberId, groupId);
  if (!row) return { error: 'Not in this group' };
  db.prepare('DELETE FROM mail_group_members WHERE id = ?').run(memberId);
  return { ok: true };
}

module.exports = { listGroups, getGroup, membersOf, recipientsFor, addMember, removeMember };
