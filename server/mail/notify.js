// Turns workflow and worship events into notifications. Kept apart from the
// engine so the engine stays about state and this stays about wording, and so
// a workflow can be driven in a test without any mail being involved.
//
// Nothing here sends directly any more: it hands the event to the notification
// layer, which decides — per person, per type — whether it belongs in their
// inbox, in their email now, or in their next digest. The one exception is a
// distribution group, whose addresses have no account behind them and so are
// written to as the group intends.

const db = require('../db');
const notifications = require('../notifications');
const { recipientsFor } = require('./groups');
const { assignmentsFor } = require('../workflows/scheduling');

const SITE_URL = process.env.NODE_ENV === 'production'
  ? 'https://capshaw.jblairkiel.com'
  : 'http://localhost:5173';

function link() {
  return `${SITE_URL} → My Info → Workflows & Inbox`;
}

// Accounts that can act on a task: the named person, or everyone holding the
// role. Returned as user rows, because a person with no email address still
// gets the task in their inbox.
function usersForTask(task) {
  if (task.assignee_user_id) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(task.assignee_user_id);
    return user ? [user] : [];
  }

  if (!task.assignee_role) return [];

  // Anyone at or above the role could pick it up; admins outrank everyone, so
  // a task for 'approved' would otherwise reach the entire congregation. Only
  // people holding exactly that role are told.
  const holders = db.prepare('SELECT * FROM users WHERE role = ?').all(task.assignee_role);
  if (holders.length) return holders;

  // Nobody holds that role yet — a worship coordinator has not been appointed,
  // say. The task still sits in the admins' inbox by rank, so tell them, or
  // the workflow would wait on a queue nobody is watching.
  return db.prepare("SELECT * FROM users WHERE role = 'admin'").all();
}

// The same people, narrowed to those who can actually be emailed.
function recipientsForTask(task) {
  return usersForTask(task)
    .filter(u => u.email)
    .map(u => ({ email: u.email, name: u.name }));
}

function taskAssigned({ instance, definition, task }) {
  const users = usersForTask(task);
  if (!users.length) return [];

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

  return notifications.emit({
    type:        'workflow.task',
    title:       `Action needed: ${instance.title}`,
    body,
    subjectType: 'workflow',
    subjectId:   instance.id,
    users,
    context:     `workflow:${instance.id}:task:${task.id}`,
  }).queued;
}

function workflowCompleted({ instance, definition, outcomeId, actorName }) {
  const outcome = definition.outcomes?.[outcomeId];

  const creator = instance.created_by
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(instance.created_by)
    : null;

  // A definition may copy a distribution group when it reaches an outcome —
  // an approved booking going to the announcements list, say. Those addresses
  // belong to a list rather than to an account, so they are mailed directly.
  const groupKeys = outcome?.notifyGroups || [];
  const extraEmails = [];
  const missingAddresses = [];
  for (const key of groupKeys) {
    const { recipients, missing } = recipientsFor(key);
    extraEmails.push(...recipients);
    missingAddresses.push(...missing);
  }

  if (missingAddresses.length) {
    console.log(`[mail] ${instance.definition_id} #${instance.id}: no address on file for ${missingAddresses.join(', ')}`);
  }
  if (!creator && !extraEmails.length) return [];

  const body = [
    `${definition.title}: ${outcome?.label || outcomeId}`,
    '',
    `  ${instance.title}`,
    actorName ? `  Closed by: ${actorName}` : '',
    '',
    `See the full history here: ${link()}`,
  ].filter(Boolean).join('\n');

  return notifications.emit({
    type:        'workflow.completed',
    title:       `${outcome?.label || 'Finished'}: ${instance.title}`,
    body,
    subjectType: 'workflow',
    subjectId:   instance.id,
    users:       creator ? [creator] : [],
    extraEmails,
    // The outcome is a record of what was decided, so it reaches the person
    // who started it even when they are the one who closed it.
    includeActor: true,
    context:     `workflow:${instance.id}:completed`,
  }).queued;
}

// ─── Worship schedule ─────────────────────────────────────────────────────────

// Everyone given a turn in the published month hears what they are down for.
// The roster stores a name, so the person comes from matching that name back
// to the directory: with an account they are told through their inbox and
// their own email settings, without one their directory address is written to
// directly, and anybody who cannot be reached at all is reported rather than
// dropped in silence.
function schedulePublished({ draft, instanceId }) {
  const names = [...new Set((draft?.rows || []).map(r => (r.name || '').trim()).filter(Boolean))];
  const queued = [];
  const unreachable = [];

  for (const name of names) {
    const person = db.prepare('SELECT * FROM directory WHERE lower(trim(name)) = ?').get(name.toLowerCase());
    if (!person) { unreachable.push(name); continue; }

    const account = db.prepare('SELECT * FROM users WHERE directory_id = ?').get(person.id);
    if (!account && !person.email) { unreachable.push(name); continue; }

    const mine = assignmentsFor(draft, name);
    const body = [
      `You are down to help with worship in ${draft.month}.`,
      '',
      ...mine.map(r => `  ${r.date} · ${r.service} · ${r.job}`),
      '',
      'If you cannot make one of these, start a Job Assignment Swap from',
      `the dashboard and the scheduler will find cover: ${link()}`,
    ].join('\n');

    queued.push(...notifications.emit({
      type:        'worship.assignments',
      title:       `Your worship assignments for ${draft.month}`,
      body,
      subjectType: 'schedule',
      subjectId:   instanceId,
      users:       account ? [account] : [],
      extraEmails: account ? [] : [{ email: person.email, name: person.name }],
      context:     `workflow:${instanceId}:schedule`,
    }).queued);
  }

  return { queued, unreachable };
}

// The whole month, to everyone who has not turned the summary off. New
// accounts are opted in, so this reaches the congregation by default.
function monthlyReport({ draft, instanceId }) {
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
    'under My Info → Notifications on the dashboard.',
  ].filter(Boolean).join('\n');

  return notifications.emit({
    type:        'worship.monthly_report',
    title:       `Worship schedule for ${draft.month}`,
    body,
    subjectType: 'schedule',
    subjectId:   instanceId,
    context:     `workflow:${instanceId}:monthly-report`,
  }).queued;
}

module.exports = {
  taskAssigned, workflowCompleted, recipientsForTask, usersForTask,
  schedulePublished, monthlyReport,
};
