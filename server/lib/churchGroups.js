// ─── Church groups ────────────────────────────────────────────────────────────
//
// The small groups the congregation is divided into, and who is in each.
//
// There are two separate questions here, and keeping them apart is the whole
// point of this module:
//
//   1. Who looks after *every* group? — the 'church-groups' area, granted by
//      an admin. That person makes groups (one at a time, or a whole set with
//      `generate`), retires them, and appoints leaders. They do not thereby
//      become the leader of anything.
//
//   2. What is somebody's part in *one* group? — the `role` column on
//      church_group_members: leader, co-leader, host, or member. A leader of
//      Group 3 can post Group 3's meetings and keep Group 3's roll, and has no
//      say whatever about Group 4.
//
// Membership is mirrored into the group's distribution list (mail_groups), so
// the list a leader emails is always the roll they can see. The roll is the
// record; the mailing list follows it.

const db = require('../db');
const { holdsArea } = require('./areas');

// ─── The parts somebody can have in one group ─────────────────────────────────
// Ordered: the first is the most responsible, which is the order a roll is
// rendered in.
const GROUP_ROLES = [
  {
    id:    'leader',
    label: 'Leader',
    description: 'Posts the group\'s meetings, keeps the roll, and hears every reply.',
    leads: true,
  },
  {
    id:    'co-leader',
    label: 'Co-leader',
    description: 'Everything the leader can do — for when two families share the group.',
    leads: true,
  },
  {
    id:    'host',
    label: 'Host',
    description: 'Named on the group\'s meetings as where it gathers. Cannot post or edit them.',
    leads: false,
  },
  {
    id:    'member',
    label: 'Member',
    description: 'Sees the group\'s meetings, answers the invitation, signs up and replies.',
    leads: false,
  },
];

const GROUP_ROLE_IDS = GROUP_ROLES.map(r => r.id);
const LEAD_ROLES     = new Set(GROUP_ROLES.filter(r => r.leads).map(r => r.id));

function isGroupRole(role) {
  return GROUP_ROLE_IDS.includes(role);
}

function groupRoleLabel(role) {
  return GROUP_ROLES.find(r => r.id === role)?.label ?? role;
}

// ─── Keys ─────────────────────────────────────────────────────────────────────
// A group's key is its distribution list's key as well, so it has to survive
// being typed into an email address: lower case, no spaces, nothing exotic.

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// ─── Reading ──────────────────────────────────────────────────────────────────

const GROUP_COLUMNS = `
  g.id, g.key, g.name, g.description, g.meets, g.location, g.email,
  g.mail_group_id, g.active, g.sort_order, g.created_at
`;

function rowToGroup(row) {
  if (!row) return null;
  return {
    id:          row.id,
    key:         row.key,
    name:        row.name,
    description: row.description,
    meets:       row.meets,
    location:    row.location,
    email:       row.email,
    mailGroupId: row.mail_group_id,
    active:      !!row.active,
    sortOrder:   row.sort_order,
    createdAt:   row.created_at,
    memberCount: row.member_count ?? 0,
    leaders:     leadersOf(row.id),
  };
}

function listGroups({ includeRetired = true } = {}) {
  const rows = db.prepare(`
    SELECT ${GROUP_COLUMNS}, COUNT(m.id) AS member_count
      FROM church_groups g
      LEFT JOIN church_group_members m ON m.group_id = g.id
     ${includeRetired ? '' : 'WHERE g.active = 1'}
     GROUP BY g.id
     ORDER BY g.active DESC, g.sort_order ASC, g.name ASC
  `).all();
  return rows.map(rowToGroup);
}

function getGroup(idOrKey) {
  const row = db.prepare(`
    SELECT ${GROUP_COLUMNS}, COUNT(m.id) AS member_count
      FROM church_groups g
      LEFT JOIN church_group_members m ON m.group_id = g.id
     WHERE g.id = ? OR g.key = ?
     GROUP BY g.id
  `).get(Number(idOrKey) || 0, String(idOrKey));
  return rowToGroup(row);
}

// The roll, with each person's current address from the directory rather than
// a copy of it, and the account behind them where there is one — that account
// is who a notification can actually reach.
function membersOf(groupId) {
  return db.prepare(`
    SELECT m.id, m.directory_id, m.role, m.added_at,
           d.name AS name, d.email AS email, d.phone AS phone, d.cell AS cell,
           u.id AS user_id
      FROM church_group_members m
      JOIN directory d ON d.id = m.directory_id
      LEFT JOIN users u ON u.directory_id = d.id
     WHERE m.group_id = ?
     ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'co-leader' THEN 1 WHEN 'host' THEN 2 ELSE 3 END,
              d.name ASC
  `).all(groupId).map(row => ({
    id:          row.id,
    directoryId: row.directory_id,
    userId:      row.user_id,
    name:        row.name,
    email:       row.email,
    phone:       row.phone || row.cell || '',
    role:        row.role,
    roleLabel:   groupRoleLabel(row.role),
    addedAt:     row.added_at,
  }));
}

function leadersOf(groupId) {
  return db.prepare(`
    SELECT d.name AS name, d.email AS email, m.role AS role
      FROM church_group_members m
      JOIN directory d ON d.id = m.directory_id
     WHERE m.group_id = ? AND m.role IN ('leader', 'co-leader')
     ORDER BY m.role ASC, d.name ASC
  `).all(groupId).map(r => ({ name: r.name, email: r.email, role: r.role, roleLabel: groupRoleLabel(r.role) }));
}

// Every group one account is in, with the part they have in it. An account
// with no directory entry is in nothing — the roll is of directory people, and
// a sign-in that has not been matched to one yet is not somebody we can place.
function groupsForUser(user) {
  if (!user?.directory_id) return [];
  return db.prepare(`
    SELECT ${GROUP_COLUMNS}, m.role AS my_role
      FROM church_group_members m
      JOIN church_groups g ON g.id = m.group_id
     WHERE m.directory_id = ?
     ORDER BY g.active DESC, g.sort_order ASC, g.name ASC
  `).all(user.directory_id).map(row => ({ ...rowToGroup(row), myRole: row.my_role }));
}

function roleInGroup(user, groupId) {
  if (!user?.directory_id) return null;
  const row = db.prepare('SELECT role FROM church_group_members WHERE group_id = ? AND directory_id = ?')
    .get(groupId, user.directory_id);
  return row?.role ?? null;
}

// ─── Who may do what ──────────────────────────────────────────────────────────

// The area covers every group; a pending account holds nothing at all.
function managesGroups(user) {
  return holdsArea(user, 'church-groups');
}

// Posting a meeting, editing the roll, appointing nobody: a leader runs their
// own group. Whoever looks after every group can do it for any of them, which
// is what makes a group with no leader yet workable.
function leadsGroup(user, groupId) {
  if (managesGroups(user)) return true;
  if (!user || user.role === 'pending') return false;
  return LEAD_ROLES.has(roleInGroup(user, groupId));
}

// Answering an invitation, signing up, replying: anybody on the roll, and the
// people who look after groups (a leader visiting another group's page can see
// it but has no part in it, so they are not included here).
function belongsToGroup(user, groupId) {
  if (!user || user.role === 'pending') return false;
  if (managesGroups(user)) return true;
  return !!roleInGroup(user, groupId);
}

// ─── The distribution list behind a group ─────────────────────────────────────
//
// A group's mailing list is not maintained by hand: it is this roll, mirrored.
// Anyone added to the list by hand from Email Groups survives a sync only if
// they are a plain address — a directory person who is not on the roll is
// removed, because the roll is what the group *is*.

function ensureMailGroup(group) {
  const existing = db.prepare('SELECT id FROM mail_groups WHERE key = ?').get(group.key);
  if (existing) return existing.id;

  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM mail_groups').get().n;
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO mail_groups (key, name, description, sort_order) VALUES (?, ?, ?, ?)'
  ).run(group.key, group.name, group.description || `The ${group.name} church group`, nextOrder);
  return lastInsertRowid;
}

const syncMailGroup = db.transaction(groupId => {
  const group = db.prepare('SELECT * FROM church_groups WHERE id = ?').get(groupId);
  if (!group) return { synced: 0 };

  const mailGroupId = group.mail_group_id || ensureMailGroup(group);
  if (!group.mail_group_id) {
    db.prepare('UPDATE church_groups SET mail_group_id = ? WHERE id = ?').run(mailGroupId, groupId);
  }

  const onRoll = db.prepare('SELECT directory_id FROM church_group_members WHERE group_id = ?')
    .all(groupId).map(r => r.directory_id);
  const onList = db.prepare('SELECT id, directory_id FROM mail_group_members WHERE group_id = ? AND directory_id IS NOT NULL')
    .all(mailGroupId);

  const wanted = new Set(onRoll);
  const have   = new Set(onList.map(r => r.directory_id));

  const add    = db.prepare('INSERT INTO mail_group_members (group_id, directory_id) VALUES (?, ?)');
  const remove = db.prepare('DELETE FROM mail_group_members WHERE id = ?');

  for (const directoryId of wanted) if (!have.has(directoryId)) add.run(mailGroupId, directoryId);
  for (const row of onList) if (!wanted.has(row.directory_id)) remove.run(row.id);

  // The list's name follows the group's, so renaming a group does not leave a
  // list called something else behind.
  db.prepare('UPDATE mail_groups SET name = ? WHERE id = ?').run(group.name, mailGroupId);

  return { mailGroupId, synced: wanted.size };
});

// ─── Writing ──────────────────────────────────────────────────────────────────

function keyIsFree(key, exceptId = null) {
  const row = db.prepare('SELECT id FROM church_groups WHERE key = ?').get(key);
  return !row || row.id === exceptId;
}

const createGroup = db.transaction(({ name, key, description = '', meets = '', location = '', email = '', sortOrder = null }) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { error: 'A name is required' };

  const finalKey = slugify(key || trimmed);
  if (!finalKey) return { error: 'That name cannot be turned into a group key — use some letters or numbers' };
  if (!keyIsFree(finalKey)) return { error: `A group with the key "${finalKey}" already exists` };

  const order = sortOrder ?? db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM church_groups').get().n;
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO church_groups (key, name, description, meets, location, email, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(finalKey, trimmed, description.trim(), meets.trim(), location.trim(), email.trim().toLowerCase(), order);

  syncMailGroup(id);
  return { group: getGroup(id) };
});

const updateGroup = db.transaction((groupId, fields) => {
  const before = db.prepare('SELECT * FROM church_groups WHERE id = ?').get(groupId);
  if (!before) return { error: 'No such group' };

  const name = fields.name === undefined ? before.name : String(fields.name).trim();
  if (!name) return { error: 'A name is required' };

  const next = {
    name,
    description: fields.description === undefined ? before.description : String(fields.description).trim(),
    meets:       fields.meets       === undefined ? before.meets       : String(fields.meets).trim(),
    location:    fields.location    === undefined ? before.location    : String(fields.location).trim(),
    email:       fields.email       === undefined ? before.email       : String(fields.email).trim().toLowerCase(),
    active:      fields.active      === undefined ? before.active      : (fields.active ? 1 : 0),
    sort_order:  fields.sortOrder   === undefined ? before.sort_order  : Number(fields.sortOrder) || 0,
  };

  db.prepare(`
    UPDATE church_groups
       SET name = ?, description = ?, meets = ?, location = ?, email = ?, active = ?, sort_order = ?
     WHERE id = ?
  `).run(next.name, next.description, next.meets, next.location, next.email, next.active, next.sort_order, groupId);

  syncMailGroup(groupId);
  return { group: getGroup(groupId), before };
});

function deleteGroup(groupId) {
  const group = db.prepare('SELECT * FROM church_groups WHERE id = ?').get(groupId);
  if (!group) return { error: 'No such group' };
  // The distribution list is left in place deliberately: it may have plain
  // addresses on it that were never part of the roll, and Email Groups is
  // where a list is removed.
  db.prepare('DELETE FROM church_groups WHERE id = ?').run(groupId);
  return { ok: true, group };
}

const addMember = db.transaction((groupId, { directoryId, role = 'member', addedBy = null }) => {
  if (!isGroupRole(role)) return { error: 'That is not a part somebody can have in a group' };

  const person = db.prepare('SELECT id, name FROM directory WHERE id = ?').get(directoryId);
  if (!person) return { error: 'That person is not in the directory' };

  const already = db.prepare('SELECT id FROM church_group_members WHERE group_id = ? AND directory_id = ?')
    .get(groupId, directoryId);
  if (already) return { error: `${person.name} is already in this group` };

  db.prepare('INSERT INTO church_group_members (group_id, directory_id, role, added_by) VALUES (?, ?, ?, ?)')
    .run(groupId, directoryId, role, addedBy);

  syncMailGroup(groupId);
  return { ok: true, person };
});

const setMemberRole = db.transaction((groupId, memberId, role) => {
  if (!isGroupRole(role)) return { error: 'That is not a part somebody can have in a group' };

  const row = db.prepare(`
    SELECT m.*, d.name AS name FROM church_group_members m
      JOIN directory d ON d.id = m.directory_id
     WHERE m.id = ? AND m.group_id = ?
  `).get(memberId, groupId);
  if (!row) return { error: 'They are not in this group' };

  db.prepare('UPDATE church_group_members SET role = ? WHERE id = ?').run(role, memberId);
  return { ok: true, member: { ...row, role }, was: row.role };
});

const removeMember = db.transaction((groupId, memberId) => {
  const row = db.prepare(`
    SELECT m.*, d.name AS name FROM church_group_members m
      JOIN directory d ON d.id = m.directory_id
     WHERE m.id = ? AND m.group_id = ?
  `).get(memberId, groupId);
  if (!row) return { error: 'They are not in this group' };

  db.prepare('DELETE FROM church_group_members WHERE id = ?').run(memberId);
  syncMailGroup(groupId);
  return { ok: true, member: row };
});

// ─── Generating a whole set ───────────────────────────────────────────────────
//
// Dividing the congregation into groups by hand means typing a dozen groups
// and then dragging two hundred people into them, which is the kind of job
// nobody finishes. So the person who looks after groups asks for N of them and
// gets them, each with its distribution list, and — if they want — everybody
// in the directory spread across them.
//
// Two rules the spread follows, because getting either wrong makes the result
// useless:
//
//   · a household stays together. People at one address are dealt as a unit,
//     so a group meeting in a living room does not get half a family.
//   · nobody already in a group is moved. Running this again to add two more
//     groups must not reshuffle the groups people already belong to.

const HOUSEHOLD_KEY = row => `${(row.address || '').trim().toLowerCase()}|${(row.zip || '').trim()}`;

// Households, largest first, so the big families are placed while the groups
// are still even and the small ones fill the gaps afterwards.
function unplacedHouseholds() {
  const people = db.prepare(`
    SELECT d.id, d.name, d.address, d.zip
      FROM directory d
     WHERE NOT EXISTS (SELECT 1 FROM church_group_members m WHERE m.directory_id = d.id)
     ORDER BY d.name ASC
  `).all();

  const households = new Map();
  for (const person of people) {
    // Somebody with no address on file is their own household: guessing that
    // every blank address is one big family would put them all in one group.
    const key = HOUSEHOLD_KEY(person).trim() === '|' ? `person:${person.id}` : HOUSEHOLD_KEY(person);
    if (!households.has(key)) households.set(key, []);
    households.get(key).push(person);
  }

  return [...households.values()].sort((a, b) => b.length - a.length);
}

const generateGroups = db.transaction(({
  count,
  prefix = 'Group',
  startAt = 1,
  meets = '',
  emailDomain = '',
  assignMembers = false,
  createdBy = null,
} = {}) => {
  const howMany = Number(count);
  if (!Number.isInteger(howMany) || howMany < 1 || howMany > 50) {
    return { error: 'Ask for between 1 and 50 groups' };
  }

  const namePrefix = String(prefix || 'Group').trim() || 'Group';
  const keyPrefix  = slugify(namePrefix) || 'group';
  const first      = Number.isInteger(Number(startAt)) ? Number(startAt) : 1;
  const domain     = String(emailDomain || '').trim().toLowerCase().replace(/^@/, '');

  const created = [];
  const skipped = [];
  let order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM church_groups').get().n;

  for (let i = 0; i < howMany; i += 1) {
    const number = first + i;
    const key    = `${keyPrefix}-${number}`;
    const name   = `${namePrefix} ${number}`;

    // Running the generator twice should top the set up rather than fail on
    // the first name it has already used.
    if (!keyIsFree(key)) { skipped.push(key); continue; }

    order += 1;
    const result = createGroup({
      name,
      key,
      description: `Fellowship group ${number}`,
      meets,
      email: domain ? `${key}@${domain}` : '',
      sortOrder: order,
    });
    if (result.error) { skipped.push(key); continue; }
    created.push(result.group);
  }

  const assigned = assignMembers ? spreadDirectoryAcross(created.length ? created : listGroups({ includeRetired: false }), createdBy) : null;

  return { created, skipped, assigned };
});

// Deals the households nobody has placed yet across the groups given, smallest
// group first each time so the result is even however uneven the start was.
function spreadDirectoryAcross(groups, addedBy = null) {
  const targets = groups.filter(g => g.active !== false);
  if (!targets.length) return { placed: 0, groups: 0 };

  const counts = new Map(targets.map(g => [
    g.id,
    db.prepare('SELECT COUNT(*) AS n FROM church_group_members WHERE group_id = ?').get(g.id).n,
  ]));

  const insert = db.prepare(
    'INSERT OR IGNORE INTO church_group_members (group_id, directory_id, role, added_by) VALUES (?, ?, ?, ?)'
  );

  let placed = 0;
  for (const household of unplacedHouseholds()) {
    const smallest = [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
    for (const person of household) {
      insert.run(smallest, person.id, 'member', addedBy);
      placed += 1;
    }
    counts.set(smallest, counts.get(smallest) + household.length);
  }

  for (const group of targets) syncMailGroup(group.id);
  return { placed, groups: targets.length };
}

module.exports = {
  GROUP_ROLES, GROUP_ROLE_IDS, isGroupRole, groupRoleLabel, slugify,
  listGroups, getGroup, membersOf, leadersOf, groupsForUser, roleInGroup,
  managesGroups, leadsGroup, belongsToGroup,
  createGroup, updateGroup, deleteGroup,
  addMember, setMemberRole, removeMember,
  syncMailGroup, ensureMailGroup,
  generateGroups, spreadDirectoryAcross, unplacedHouseholds,
};
