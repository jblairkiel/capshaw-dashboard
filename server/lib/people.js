// Shared vocabulary and rules for congregation people: which directory entries
// count as one household, which worship roles can be expressed a preference
// about, and which fields a person is allowed to edit.

// ─── Households ───────────────────────────────────────────────────────────────

// Mirrors the family grouping the directory UI shows: people at the same street
// address share a household. Someone with no address is a household of one, so
// a blank address never sweeps in strangers.
function householdKey(person) {
  const addr = (person.address || '').trim().toLowerCase();
  const zip  = (person.zip     || '').trim();
  const key  = [addr, zip].filter(Boolean).join('|');
  return key || `_${person.id}`;
}

function sameHousehold(a, b) {
  return !!a && !!b && householdKey(a) === householdKey(b);
}

// ─── Worship roles ────────────────────────────────────────────────────────────

// The roles the congregation actually assigns, in the order they appear in a
// service. Kept in step with the job names the scraper reads off the website.
const WORSHIP_ROLES = [
  'Song Leader',
  'Opening Prayer',
  'Scripture Reading',
  'Communion',
  'Speaker',
  'Closing Prayer',
  'Usher',
  'Visuals',
  'Visual Preparation',
  'Announcements',
];

// How willing someone is to serve in a role. Absent means "no preference".
const PREFERENCE_LEVELS = ['preferred', 'willing', 'unavailable'];

function isWorshipRole(role) {
  return WORSHIP_ROLES.includes(role);
}

function isPreferenceLevel(level) {
  return PREFERENCE_LEVELS.includes(level);
}

// ─── Editable directory fields ────────────────────────────────────────────────

// Everything a person may change about themselves or their household. `id` and
// `edited_fields` are deliberately absent — they are bookkeeping, not content.
const EDITABLE_FIELDS = ['name', 'address', 'city', 'state', 'zip', 'phone', 'cell', 'email', 'notes'];

module.exports = {
  householdKey,
  sameHousehold,
  WORSHIP_ROLES,
  PREFERENCE_LEVELS,
  isWorshipRole,
  isPreferenceLevel,
  EDITABLE_FIELDS,
};
