// Turns workflow events into queued email. Kept apart from the engine so the
// engine stays about state and this stays about wording, and so a workflow
// can be driven in a test without any mail being involved.

const db = require('../db');
const mailer = require('./mailer');
const { recipientsFor } = require('./groups');
const { assignmentsFor } = require('../workflows/scheduling');

const SITE_URL = process.env.NODE_ENV === 'production'
  ? 'https://capshaw.jblairkiel.com'
  : 'http://localhost:5173';

// An assignment names either an area or a role; telling them apart is what
// decides where its holders are looked up.
const { isArea } = require('../middleware/auth');

// A real, clickable link into a specific page — and, for anything that is
// really about one particular thing rather than a whole page, the id of that
// thing too, so a reader lands on the group meeting or the task itself
// rather than a page they still have to go looking on. Read back by
// client/src/App.jsx on load: ?page= picks the tab, and group/event/workflow
// are whichever of those that page knows how to open on its own.
function link(page, params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null));
  return `${SITE_URL}/?${new URLSearchParams({ page, ...clean })}`;
}

// Users who can act on a task: the named person, or everyone holding the role.
function recipientsForTask(task) {
  if (task.assignee_user_id) {
    const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(task.assignee_user_id);
    return user?.email ? [{ email: user.email, name: user.name }] : [];
  }

  if (!task.assignee_role) return [];

  // A step addresses either an area of responsibility or a rung on the role
  // ladder, and each is looked up where it actually lives: areas in the grants
  // table, roles on the account.
  //
  // Admins hold every area implicitly, but are deliberately not mailed for
  // every area task — whoever actually looks after the guests should hear
  // about a guest task, not all six admins as well.
  const holders = isArea(task.assignee_role)
    ? db.prepare(`
        SELECT u.name, u.email FROM users u
          JOIN user_areas a ON a.user_id = u.id
         WHERE a.area = ? AND u.role = 'approved' AND u.email IS NOT NULL
      `).all(task.assignee_role)
    // Anyone at or above the role could pick it up; admins outrank everyone, so
    // a task for 'approved' would otherwise mail the entire congregation. Only
    // people holding exactly that role are told.
    : db.prepare('SELECT name, email FROM users WHERE role = ? AND email IS NOT NULL')
        .all(task.assignee_role);

  const withAddress = holders.filter(u => u.email).map(u => ({ email: u.email, name: u.name }));
  if (withAddress.length) return withAddress;

  // Nobody looks after it yet — no guest tracker has been appointed, say. The
  // task still sits in the admins' inbox, since they hold every area, so tell
  // them or the workflow would wait on a queue nobody is watching.
  return db.prepare("SELECT name, email FROM users WHERE role = 'admin' AND email IS NOT NULL")
    .all()
    .filter(u => u.email)
    .map(u => ({ email: u.email, name: u.name }));
}

function taskAssigned({ instance, definition, task }) {
  const recipients = recipientsForTask(task);
  if (!recipients.length) return [];

  const step = definition.steps?.[task.step_id];
  const body = [
    `A ${definition.title.toLowerCase()} needs you.`,
    '',
    `  ${instance.title}`,
    `  Step: ${step?.title || task.step_id}`,
    step?.instruction ? `\n${step.instruction}` : '',
    '',
    `Open it here: ${link('inbox', { workflow: instance.id })}`,
  ].filter(Boolean).join('\n');

  return mailer.enqueue({
    to: recipients,
    subject: `Action needed: ${instance.title}`,
    body,
    context: `workflow:${instance.id}:task:${task.id}`,
  });
}

function workflowCompleted({ instance, definition, outcomeId, actorName }) {
  const outcome = definition.outcomes?.[outcomeId];

  const people = [];
  const creator = instance.created_by
    ? db.prepare('SELECT name, email FROM users WHERE id = ?').get(instance.created_by)
    : null;
  if (creator?.email) people.push({ email: creator.email, name: creator.name });

  // A definition may copy a distribution group when it reaches an outcome —
  // an approved booking going to the announcements list, say.
  const groupKeys = outcome?.notifyGroups || [];
  const missingAddresses = [];
  for (const key of groupKeys) {
    const { recipients, missing } = recipientsFor(key);
    people.push(...recipients);
    missingAddresses.push(...missing);
  }

  if (missingAddresses.length) {
    console.log(`[mail] ${instance.definition_id} #${instance.id}: no address on file for ${missingAddresses.join(', ')}`);
  }
  if (!people.length) return [];

  const body = [
    `${definition.title}: ${outcome?.label || outcomeId}`,
    '',
    `  ${instance.title}`,
    actorName ? `  Closed by: ${actorName}` : '',
    '',
    `See the full history here: ${link('inbox', { workflow: instance.id })}`,
  ].filter(Boolean).join('\n');

  return mailer.enqueue({
    to: people,
    subject: `${outcome?.label || 'Finished'}: ${instance.title}`,
    body,
    context: `workflow:${instance.id}:completed`,
  });
}

// ─── Worship schedule ─────────────────────────────────────────────────────────

// Everyone given a turn in the published month hears what they are down for.
// The roster stores a name, so the address comes from matching that name back
// to the directory; anybody it cannot match is reported rather than dropped
// in silence.
function schedulePublished({ draft, instanceId }) {
  const names = [...new Set((draft?.rows || []).map(r => (r.name || '').trim()).filter(Boolean))];
  const queued = [];
  const unreachable = [];

  for (const name of names) {
    const person = db.prepare('SELECT name, email FROM directory WHERE lower(trim(name)) = ?')
      .get(name.toLowerCase());

    if (!person?.email) { unreachable.push(name); continue; }

    const mine = assignmentsFor(draft, name);
    const body = [
      `You are down to help with worship in ${draft.month}.`,
      '',
      ...mine.map(r => `  ${r.date} · ${r.service} · ${r.job}`),
      '',
      'If you cannot make one of these, take yourself off it on the Serving',
      `Schedule and let the coordinator know it needs covering: ${link('assignments')}`,
    ].join('\n');

    queued.push(...mailer.enqueue({
      to: [{ email: person.email, name: person.name }],
      subject: `Your worship assignments for ${draft.month}`,
      body,
      context: `workflow:${instanceId}:schedule`,
    }));
  }

  return { queued, unreachable };
}

// The whole month, to everyone who has not opted out on My Info. New accounts
// are opted in, so this reaches the congregation by default.
function monthlyReport({ draft, instanceId }) {
  const readers = db.prepare(`
    SELECT name, email FROM users
    WHERE wants_monthly_report = 1 AND email IS NOT NULL AND trim(email) <> ''
  `).all().map(u => ({ email: u.email, name: u.name }));

  if (!readers.length) return [];

  const byDate = new Map();
  for (const row of draft?.rows || []) {
    const key = `${row.date} · ${row.service}`;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(`    ${row.job}: ${row.name || '(nobody yet)'}`);
  }

  const body = [
    `Worship assignments for ${draft.month}.`,
    '',
    ...[...byDate.entries()].flatMap(([heading, lines]) => [`  ${heading}`, ...lines, '']),
    draft.unfilled?.length ? `${draft.unfilled.length} slot(s) still need somebody.` : '',
    '',
    `The full schedule is on the dashboard: ${link('assignments')}`,
    '',
    'To stop receiving this summary, turn off "Monthly schedule summary"',
    'under My Info on the dashboard.',
  ].filter(Boolean).join('\n');

  return mailer.enqueue({
    to: readers,
    subject: `Worship schedule for ${draft.month}`,
    body,
    context: `workflow:${instanceId}:monthly-report`,
  });
}

// ─── Church groups ────────────────────────────────────────────────────────────
//
// A group's meeting goes to the group's distribution list, which is the group's
// roll mirrored (see server/lib/churchGroups.js) — so "everybody in my group"
// means the same thing here as it does on the page. The portal's own
// notification is written separately and does not depend on any of this: a mail
// server that is down must not cost somebody the entry in their bell.

function eventLines(event) {
  return [
    `  ${event.title}`,
    event.date ? `  When: ${event.date}${event.time ? ` at ${event.time}` : ''}` : '',
    event.location ? `  Where: ${event.location}` : '',
    event.hostName ? `  Hosted by: ${event.hostName}` : '',
  ].filter(Boolean);
}

function groupLink(group, event) {
  return link('groups', { group: group.id, event: event?.id });
}

function groupEventPublished({ group, event }) {
  const { recipients, missing } = recipientsFor(group.key);
  if (missing.length) {
    console.log(`[mail] ${group.key}: no address on file for ${missing.join(', ')}`);
  }
  if (!recipients.length) return [];

  const body = [
    `${group.name} is meeting.`,
    '',
    ...eventLines(event),
    event.description ? `\n${event.description}` : '',
    '',
    event.rsvpEnabled ? 'Let the group know whether you can come' : 'See the details',
    event.signupEnabled ? `and take something off the ${event.signupTitle.toLowerCase()} list` : '',
    `here: ${groupLink(group, event)}`,
  ].filter(Boolean).join('\n');

  return mailer.enqueue({
    to: recipients,
    subject: `${group.name}: ${event.title}`,
    body,
    context: `group-event:${event.id}:published`,
  });
}

function groupEventCancelled({ group, event }) {
  const { recipients } = recipientsFor(group.key);
  if (!recipients.length) return [];

  const body = [
    `${group.name}'s meeting is off.`,
    '',
    ...eventLines(event),
    '',
    `Details, and anything the leaders have said about it: ${groupLink(group, event)}`,
  ].join('\n');

  return mailer.enqueue({
    to: recipients,
    subject: `Cancelled — ${group.name}: ${event.title}`,
    body,
    context: `group-event:${event.id}:cancelled`,
  });
}

// Only the people who said they were coming: telling the whole group that a
// meeting they never answered has moved half an hour is how a list gets muted.
function groupEventChanged({ group, event, attendees = [], what = '' }) {
  const recipients = attendees.filter(a => a.email).map(a => ({ email: a.email, name: a.name }));
  if (!recipients.length) return [];

  const body = [
    `${group.name}'s meeting has changed.`,
    what ? `  ${what}` : '',
    '',
    ...eventLines(event),
    '',
    `The current details are here: ${groupLink(group, event)}`,
  ].filter(Boolean).join('\n');

  return mailer.enqueue({
    to: recipients,
    subject: `Changed — ${group.name}: ${event.title}`,
    body,
    context: `group-event:${event.id}:changed`,
  });
}

module.exports = {
  taskAssigned, workflowCompleted, recipientsForTask, schedulePublished, monthlyReport,
  groupEventPublished, groupEventCancelled, groupEventChanged,
};
