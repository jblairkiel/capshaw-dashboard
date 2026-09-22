// Shared vocabulary for bug reports — kept in one place so the submission
// form, the triage page, and the server that checks both agree on what a
// severity or a status is.

// How much it is in somebody's way. Three tiers, in the site's own voice
// rather than a support-desk one — the person filing this is a church member,
// not a customer.
const SEVERITIES = ['minor', 'annoying', 'blocking'];

// Where a report stands. 'open' is where every one starts; moving it through
// the rest is an admin's to do, from the triage page.
const STATUSES = ['open', 'in_progress', 'resolved', 'wont_fix'];

function isSeverity(value) {
  return SEVERITIES.includes(value);
}

function isStatus(value) {
  return STATUSES.includes(value);
}

module.exports = { SEVERITIES, STATUSES, isSeverity, isStatus };
