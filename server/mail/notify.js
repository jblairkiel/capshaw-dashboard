// Turns workflow events into queued email. Kept apart from the engine so the
// engine stays about state and this stays about wording, and so a workflow
// can be driven in a test without any mail being involved.

const db = require('../db');
const mailer = require('./mailer');
const { recipientsFor } = require('./groups');

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
  // people holding exactly that role are told, plus admins for admin tasks.
  return db.prepare('SELECT name, email FROM users WHERE role = ? AND email IS NOT NULL')
    .all(task.assignee_role)
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

module.exports = { taskAssigned, workflowCompleted, recipientsForTask };
