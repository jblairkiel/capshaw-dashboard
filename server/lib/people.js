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

// ─── Photos ───────────────────────────────────────────────────────────────────

// A person's face, wherever one is shown: their own photo when they have one,
// otherwise their family's. Everything written before individual photos
// existed has only the family photo, and keeps showing it.
function photoOf(person) {
  return (person?.own_photo || '').trim() || (person?.photo || '').trim();
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
  // Serving the trays beside whoever leads the Lord's Supper. A service
  // usually needs more than one, so it can be listed more than once among a
  // service's jobs (lib/serviceJobs.js).
  'Communion Assist',
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
const EDITABLE_FIELDS = ['name', 'address', 'city', 'state', 'zip', 'phone', 'cell', 'email', 'notes', 'gender'];

// ─── Gender ───────────────────────────────────────────────────────────────────
// Recorded because this congregation rosters the worship jobs among its men, so
// the serving schedule needs to know who may sign up. Chosen on My Info, never
// guessed from a name, and '' means nobody has said.
const GENDERS = ['male', 'female', ''];

function isGender(value) {
  return GENDERS.includes(String(value ?? '').toLowerCase());
}

// ─── Worship participants ─────────────────────────────────────────────────────
// Who the worship jobs are rostered among. By default that is a man who is a
// member of the congregation, which here means he has been baptized. Anybody
// else is left off unless whoever keeps the serving schedule says otherwise
// for that one person.
//
// Nothing is guessed: a man whose membership nobody has recorded is not a
// participant yet, the same as one whose gender nobody has recorded. Leaving a
// slot open is easy to notice and fix; rostering somebody who should not be is
// not.
//
// membership:          'member' (baptized member) | 'not-member' | '' (not recorded)
// worship_participant: 'yes' | 'no' | '' (follow the default)

const MEMBERSHIPS = ['member', 'not-member', ''];
const PARTICIPATION_OVERRIDES = ['yes', 'no', ''];

function isMembership(value) {
  return MEMBERSHIPS.includes(String(value ?? '').toLowerCase());
}

function isParticipationOverride(value) {
  return PARTICIPATION_OVERRIDES.includes(String(value ?? '').toLowerCase());
}

const lower = v => String(v ?? '').trim().toLowerCase();

// What the default alone says about a directory entry.
function participatesByDefault(person) {
  return lower(person?.gender) === 'male' && lower(person?.membership) === 'member';
}

// The answer: the keeper's word for this person when there is one, the
// default otherwise.
function isWorshipParticipant(person) {
  const override = lower(person?.worship_participant);
  if (override === 'yes') return true;
  if (override === 'no') return false;
  return participatesByDefault(person);
}

// Why, in a line the Service Roster can show beside the person.
function participationReason(person) {
  const override = lower(person?.worship_participant);
  if (override === 'yes') return 'Rostered by the schedule keeper';
  if (override === 'no')  return 'Left off by the schedule keeper';
  const gender = lower(person?.gender);
  const membership = lower(person?.membership);
  if (gender === 'female') return 'Not rostered: the worship jobs go to men';
  if (gender !== 'male') return 'Not rostered yet: gender not recorded';
  if (membership === 'not-member') return 'Not rostered: not a baptized member';
  if (membership !== 'member') return 'Not rostered yet: membership not recorded';
  return 'Baptized member';
}

module.exports = {
  householdKey,
  GENDERS,
  isGender,
  MEMBERSHIPS,
  PARTICIPATION_OVERRIDES,
  isMembership,
  isParticipationOverride,
  participatesByDefault,
  isWorshipParticipant,
  participationReason,
  sameHousehold,
  photoOf,
  WORSHIP_ROLES,
  PREFERENCE_LEVELS,
  isWorshipRole,
  isPreferenceLevel,
  EDITABLE_FIELDS,
};
