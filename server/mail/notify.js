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

function link() {
  return `${SITE_URL} → My Info → Workflows & Inbox`;
}

// Users who can act on a task: the named person, or everyone holding the role.
function recipientsForTask(task) {
  if (task.assignee_user_id) {
    const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(task.assignee_user_id);
    return user?.email ? [{ email: user.email, name: user.name }] : [];
  }

  if (!task.assignee_role) return [];

  // Anyone at or above the role could pick it up; admins outrank everyone, so
  // a task for 'approved' would otherwise mail the entire congregation. Only
  // people holding exactly that role are told.
  const holders = db.prepare('SELECT name, email FROM users WHERE role = ? AND email IS NOT NULL')
    .all(task.assignee_role)
    .filter(u => u.email)
    .map(u => ({ email: u.email, name: u.name }));
  if (holders.length) return holders;

  // Nobody holds that role yet — a worship coordinator has not been appointed,
  // say. The task still sits in the admins' inbox by rank, so tell them, or
  // the workflow would wait on a queue nobody is watching.
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
    `Open it here: ${link()}`,
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
    `See the full history here: ${link()}`,
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
      'If you cannot make one of these, start a Job Assignment Swap from',
      `the dashboard and the scheduler will find cover: ${link()}`,
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
    `The full schedule is on the dashboard: ${link()}`,
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

module.exports = { taskAssigned, workflowCompleted, recipientsForTask, schedulePublished, monthlyReport };
