// ─── Workflow engine ──────────────────────────────────────────────────────────
// Definitions are code (server/workflows/definitions); instances are rows.
//
// A definition is a small state machine:
//
//   steps: { <stepId>: { title, assign, actions: [{ id, label, to, ... }] } }
//
// `to` names the next step, or an outcome id, or is a function of the
// instance data for conditional routing (an approval threshold, say). A step's
// `assign` decides who is asked to act: a named person, whoever started it, or
// anyone holding a role. Effects let a step write back to the rest of the site
// — the job-swap flow updates job_assignments — but a workflow is free to
// touch nothing but its own data.

const db = require('../db');
const { getDefinition } = require('./definitions');
const { ROLE_RANK, hasRole } = require('../middleware/auth');
const mailer = require('../mail/mailer');
const notify = require('../mail/notify');

// ─── Small helpers ────────────────────────────────────────────────────────────

function parseData(json) {
  try {
    const parsed = JSON.parse(json || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function loadInstance(id) {
  const row = db.prepare('SELECT * FROM workflow_instances WHERE id = ?').get(id);
  return row ? { ...row, data: parseData(row.data) } : null;
}

function addParticipant(instanceId, userId) {
  if (!userId) return;
  db.prepare(
    'INSERT OR IGNORE INTO workflow_participants (instance_id, user_id) VALUES (?, ?)'
  ).run(instanceId, userId);
}

function recordEvent(instanceId, { stepId = '', action = '', summary = '', note = '', actorUserId = null }) {
  db.prepare(`
    INSERT INTO workflow_events (instance_id, step_id, action, summary, note, actor_user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(instanceId, stepId, action, summary, note, actorUserId);
}

// ─── Assignment ───────────────────────────────────────────────────────────────

// A step's `assign` is resolved to either a specific user or a role. Roles are
// used when anybody with the right standing may pick the task up; naming a
// person is used when only they can answer (the member asked to swap, say).
//
//   { role: 'admin' }             — anyone who is at least an admin
//   { creator: true }             — whoever started the instance
//   { userField: 'targetUserId' } — the user id held in instance data
//   { personField: 'personId' }   — a directory id, mapped to their login
function resolveAssignee(assign, instance) {
  if (!assign) return { assigneeUserId: null, assigneeRole: '' };

  if (assign.role) return { assigneeUserId: null, assigneeRole: assign.role };

  if (assign.creator) return { assigneeUserId: instance.created_by ?? null, assigneeRole: '' };

  if (assign.userField) {
    const raw = instance.data[assign.userField];
    const id = Number(raw);
    return { assigneeUserId: Number.isInteger(id) && id > 0 ? id : null, assigneeRole: '' };
  }

  if (assign.personField) {
    const personId = Number(instance.data[assign.personField]);
    if (!Number.isInteger(personId) || personId <= 0) return { assigneeUserId: null, assigneeRole: '' };
    // A directory person only becomes assignable once their login is linked.
    const user = db.prepare('SELECT id FROM users WHERE directory_id = ?').get(personId);
    return { assigneeUserId: user?.id ?? null, assigneeRole: '' };
  }

  return { assigneeUserId: null, assigneeRole: '' };
}

// A task nobody can be found for still has to be actionable, or the instance
// would stall silently. It falls back to the role named as the definition's
// fallback (admins by default), so somebody always owns it.
function assignmentFor(step, definition, instance) {
  const resolved = resolveAssignee(step.assign, instance);
  if (resolved.assigneeUserId || resolved.assigneeRole) return resolved;
  return { assigneeUserId: null, assigneeRole: definition.fallbackRole || 'admin' };
}

// ─── Authorization ────────────────────────────────────────────────────────────

function canActOnTask(user, task) {
  if (!user || task.status !== 'pending') return false;
  if (task.assignee_user_id) return task.assignee_user_id === user.id;
  if (task.assignee_role)    return hasRole(user, task.assignee_role);
  return false;
}

// Members see an instance they took part in; admins see everything. A
// definition marked `visibility: 'restricted'` (benevolence, say) is limited
// to its participants even for other roles — only admins see beyond that.
function canViewInstance(user, instance, definition) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const participant = db.prepare(
    'SELECT 1 FROM workflow_participants WHERE instance_id = ? AND user_id = ?'
  ).get(instance.id, user.id);
  if (participant) return true;

  // A pending role task makes the instance visible to everyone who could pick
  // it up, so shared queues are discoverable before anyone has claimed them.
  if (definition?.visibility === 'restricted') return false;
  const roleTask = db.prepare(
    "SELECT assignee_role FROM workflow_tasks WHERE instance_id = ? AND status = 'pending' AND assignee_role <> ''"
  ).all(instance.id);
  return roleTask.some(t => hasRole(user, t.assignee_role));
}

// ─── Starting an instance ─────────────────────────────────────────────────────

function validateFields(definition, data) {
  const clean = {};
  for (const field of definition.fields || []) {
    const raw = data?.[field.key];
    const value = raw === undefined || raw === null ? '' : String(raw).trim();

    if (field.required && !value) return { error: `${field.label} is required` };
    if (value && field.options && !field.options.some(o => (o.value ?? o) === value)) {
      return { error: `${field.label} is not one of the allowed values` };
    }
    clean[field.key] = value;
  }
  return { data: clean };
}

const startInstance = db.transaction((definition, data, user) => {
  const title = definition.titleFor ? definition.titleFor(data) : definition.title;

  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO workflow_instances (definition_id, title, status, step_id, data, created_by)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run(definition.id, String(title).slice(0, 200), definition.start, JSON.stringify(data), user.id);

  addParticipant(id, user.id);
  recordEvent(id, { action: 'started', summary: 'Started', actorUserId: user.id });

  enterStep(loadInstance(id), definition, definition.start, user);
  return id;
});

function start({ definitionId, data, user }) {
  const definition = getDefinition(definitionId);
  if (!definition) return { error: 'Unknown workflow', status: 404 };
  if (!hasRole(user, definition.startRole || 'approved')) {
    return { error: 'You do not have permission to start this workflow', status: 403 };
  }

  const validated = validateFields(definition, data);
  if (validated.error) return { error: validated.error, status: 400 };

  // Anything the definition wants to derive up front (looking up the person
  // currently assigned to a job, for instance) happens before the first step.
  let prepared = validated.data;
  if (definition.onStart) {
    const result = definition.onStart(prepared, { db, user });
    if (result?.error) return { error: result.error, status: 400 };
    prepared = { ...prepared, ...(result?.data || {}) };
  }

  const id = startInstance(definition, prepared, user);
  flushMail();
  return { id };
}

// Sending is deliberately outside every transaction above: mail only goes
// out for work that actually committed, and a slow mail server never holds
// a request open.
function flushMail() {
  mailer.drainOutbox().catch(err => console.error('[mail] drain failed:', err.message));
}

// ─── Advancing ────────────────────────────────────────────────────────────────

// Opens a step: records it, creates its task, and makes the assignee a
// participant so the instance stays visible to them afterwards.
function enterStep(instance, definition, stepId, actor) {
  const step = definition.steps[stepId];
  if (!step) throw new Error(`Workflow "${definition.id}" has no step "${stepId}"`);

  db.prepare("UPDATE workflow_instances SET step_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(stepId, instance.id);

  const { assigneeUserId, assigneeRole } = assignmentFor(step, definition, instance);
  const { lastInsertRowid: taskId } = db.prepare(`
    INSERT INTO workflow_tasks (instance_id, step_id, assignee_user_id, assignee_role)
    VALUES (?, ?, ?, ?)
  `).run(instance.id, stepId, assigneeUserId, assigneeRole);

  addParticipant(instance.id, assigneeUserId);
  if (actor) addParticipant(instance.id, actor.id);

  // Queued in the same transaction, so an action that rolls back sends
  // nothing; the sending itself happens once the transaction has committed.
  try {
    notify.taskAssigned({
      instance: { ...instance, title: instance.title },
      definition,
      task: { id: taskId, step_id: stepId, assignee_user_id: assigneeUserId, assignee_role: assigneeRole },
    });
  } catch (err) {
    console.error('[workflows] could not queue assignment email:', err.message);
  }
}

function finish(instance, definition, outcomeId, actor) {
  const outcome = definition.outcomes?.[outcomeId];
  db.prepare(`
    UPDATE workflow_instances
    SET status = 'completed', step_id = '', outcome = ?, updated_at = datetime('now'), completed_at = datetime('now')
    WHERE id = ?
  `).run(outcomeId, instance.id);

  recordEvent(instance.id, {
    action: 'completed',
    summary: outcome?.label || outcomeId,
    actorUserId: actor?.id ?? null,
  });

  try {
    notify.workflowCompleted({ instance, definition, outcomeId, actorName: actor?.name });
  } catch (err) {
    console.error('[workflows] could not queue completion email:', err.message);
  }
}

// `to` may name a step, name an outcome, or compute either from the data.
function resolveTarget(action, data) {
  return typeof action.to === 'function' ? action.to(data) : action.to;
}

const applyAction = db.transaction((instance, definition, task, action, note, user) => {
  db.prepare(`
    UPDATE workflow_tasks
    SET status = 'done', action = ?, note = ?, completed_at = datetime('now'), completed_by = ?
    WHERE id = ?
  `).run(action.id, note, user.id, task.id);

  addParticipant(instance.id, user.id);

  // An action may record data (a chosen replacement, a decision note) and may
  // reach outside the workflow — that is how the job swap updates the roster.
  let data = instance.data;
  if (action.effect) {
    const result = action.effect(data, { db, user, note, instance });
    if (result?.error) throw Object.assign(new Error(result.error), { userFacing: true });
    if (result?.data) {
      data = { ...data, ...result.data };
      db.prepare("UPDATE workflow_instances SET data = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(data), instance.id);
    }
  }

  const step = definition.steps[task.step_id];
  recordEvent(instance.id, {
    stepId: task.step_id,
    action: action.id,
    summary: `${step?.title || task.step_id}: ${action.label}`,
    note,
    actorUserId: user.id,
  });

  const target = resolveTarget(action, data);
  const refreshed = { ...instance, data };

  if (definition.steps[target]) enterStep(refreshed, definition, target, user);
  else finish(refreshed, definition, target, user);
});

function act({ taskId, actionId, note = '', user }) {
  const task = db.prepare('SELECT * FROM workflow_tasks WHERE id = ?').get(taskId);
  if (!task) return { error: 'Task not found', status: 404 };
  if (task.status !== 'pending') return { error: 'That task has already been handled', status: 409 };
  if (!canActOnTask(user, task)) return { error: 'That task is not assigned to you', status: 403 };

  const instance = loadInstance(task.instance_id);
  const definition = getDefinition(instance.definition_id);
  if (!definition) return { error: 'Unknown workflow', status: 404 };

  const step = definition.steps[task.step_id];
  const action = step?.actions.find(a => a.id === actionId);
  if (!action) return { error: 'Unknown action', status: 400 };
  if (action.requiresNote && !String(note).trim()) {
    return { error: `${action.label} needs a note explaining why`, status: 400 };
  }

  try {
    applyAction(instance, definition, task, action, String(note).trim(), user);
  } catch (err) {
    if (err.userFacing) return { error: err.message, status: 400 };
    throw err;
  }
  flushMail();
  return { id: instance.id };
}

// ─── Reading ──────────────────────────────────────────────────────────────────

// Everything waiting on this user: tasks aimed at them by name, plus tasks
// aimed at a role they hold.
function inbox(user) {
  if (!user) return [];
  const roles = Object.keys(ROLE_RANK).filter(r => hasRole(user, r));

  const rows = db.prepare(`
    SELECT t.*, i.title AS instance_title, i.definition_id, i.data AS instance_data
    FROM workflow_tasks t
    JOIN workflow_instances i ON i.id = t.instance_id
    WHERE t.status = 'pending'
      AND i.status = 'active'
      AND (t.assignee_user_id = ? OR (t.assignee_role <> '' AND t.assignee_role IN (${roles.map(() => '?').join(',') || "''"})))
    ORDER BY t.created_at ASC
  `).all(user.id, ...roles);

  return rows.map(row => {
    const definition = getDefinition(row.definition_id);
    const step = definition?.steps?.[row.step_id];
    return {
      taskId:       row.id,
      instanceId:   row.instance_id,
      definitionId: row.definition_id,
      workflow:     definition?.title || row.definition_id,
      title:        row.instance_title,
      stepId:       row.step_id,
      stepTitle:    step?.title || row.step_id,
      instruction:  step?.instruction || '',
      actions:      (step?.actions || []).map(a => ({ id: a.id, label: a.label, tone: a.tone || 'neutral', requiresNote: !!a.requiresNote })),
      assignedRole: row.assignee_role,
      createdAt:    row.created_at,
    };
  });
}

function summarise(row, user) {
  const definition = getDefinition(row.definition_id);
  const step = definition?.steps?.[row.step_id];
  return {
    id:           row.id,
    definitionId: row.definition_id,
    workflow:     definition?.title || row.definition_id,
    title:        row.title,
    status:       row.status,
    stepId:       row.step_id,
    stepTitle:    step?.title || '',
    outcome:      row.outcome,
    outcomeLabel: definition?.outcomes?.[row.outcome]?.label || '',
    outcomeTone:  definition?.outcomes?.[row.outcome]?.tone || 'neutral',
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
    mine:         !!user && row.created_by === user.id,
  };
}

// scope 'mine'  — instances this user can see
// scope 'all'   — every instance (admins only)
function list(user, { scope = 'mine', status = 'active' } = {}) {
  const wantAll = scope === 'all' && user?.role === 'admin';
  const statusClause = status === 'any' ? '' : 'AND i.status = ?';
  const params = status === 'any' ? [] : [status];

  const rows = wantAll
    ? db.prepare(`SELECT i.* FROM workflow_instances i WHERE 1=1 ${statusClause} ORDER BY i.updated_at DESC LIMIT 200`).all(...params)
    : db.prepare(`
        SELECT DISTINCT i.* FROM workflow_instances i
        LEFT JOIN workflow_participants p ON p.instance_id = i.id AND p.user_id = ?
        LEFT JOIN workflow_tasks t        ON t.instance_id = i.id AND t.status = 'pending' AND t.assignee_role <> ''
        WHERE (p.user_id IS NOT NULL OR t.assignee_role IS NOT NULL)
        ${statusClause}
        ORDER BY i.updated_at DESC LIMIT 200
      `).all(user.id, ...params);

  // The role-task join above is deliberately broad; filter it down to roles
  // this user actually holds, and drop restricted workflows they are not in.
  return rows
    .filter(row => canViewInstance(user, row, getDefinition(row.definition_id)))
    .map(row => summarise(row, user));
}

function detail(id, user) {
  const instance = loadInstance(id);
  if (!instance) return { error: 'Workflow not found', status: 404 };

  const definition = getDefinition(instance.definition_id);
  if (!canViewInstance(user, instance, definition)) {
    return { error: 'You do not have access to this workflow', status: 403 };
  }

  const tasks = db.prepare(`
    SELECT t.*, u.name AS assignee_name, c.name AS completed_by_name
    FROM workflow_tasks t
    LEFT JOIN users u ON u.id = t.assignee_user_id
    LEFT JOIN users c ON c.id = t.completed_by
    WHERE t.instance_id = ? ORDER BY t.created_at ASC, t.id ASC
  `).all(id);

  const events = db.prepare(`
    SELECT e.*, u.name AS actor_name
    FROM workflow_events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE e.instance_id = ? ORDER BY e.created_at ASC, e.id ASC
  `).all(id);

  const myTask = tasks.find(t => canActOnTask(user, t));
  const step = definition?.steps?.[instance.step_id];

  // A definition may render its own data as a table — a generated schedule,
  // say — so the screen can show it without knowing what workflow it is.
  let preview = null;
  if (definition?.preview) {
    try {
      preview = definition.preview(instance.data);
    } catch (err) {
      console.error(`[workflows] ${definition.id} preview failed:`, err.message);
    }
  }

  return {
    instance: {
      ...summarise(instance, user),
      data: instance.data,
      fields: (definition?.fields || []).map(f => ({ key: f.key, label: f.label, value: instance.data[f.key] ?? '' })),
      instruction: step?.instruction || '',
      preview,
    },
    definition: definition ? describe(definition) : null,
    // Steps already taken, so the chart can shade the path that was walked.
    visited: [...new Set(events.filter(e => e.step_id).map(e => e.step_id))],
    tasks: tasks.map(t => ({
      id: t.id, stepId: t.step_id, status: t.status, action: t.action, note: t.note,
      assigneeName: t.assignee_name || '', assigneeRole: t.assignee_role,
      completedBy: t.completed_by_name || '', completedAt: t.completed_at, createdAt: t.created_at,
    })),
    events: events.map(e => ({
      id: e.id, stepId: e.step_id, action: e.action, summary: e.summary,
      note: e.note, actor: e.actor_name || 'System', createdAt: e.created_at,
    })),
    myTask: myTask ? {
      id: myTask.id,
      stepId: myTask.step_id,
      actions: (definition?.steps?.[myTask.step_id]?.actions || [])
        .map(a => ({ id: a.id, label: a.label, tone: a.tone || 'neutral', requiresNote: !!a.requiresNote })),
    } : null,
  };
}

// The shape the flowchart draws from: nodes for steps and outcomes, edges for
// actions. Functions are not serialisable, so conditional targets are listed
// by their declared `possibleTo`.
function describe(definition) {
  const nodes = Object.entries(definition.steps).map(([id, step]) => ({
    id, kind: 'step', label: step.title,
    assignee: step.assign?.role ? `Any ${step.assign.role}` : step.assignLabel || '',
  }));

  for (const [id, outcome] of Object.entries(definition.outcomes || {})) {
    nodes.push({ id, kind: 'outcome', label: outcome.label, tone: outcome.tone || 'neutral' });
  }

  const edges = [];
  for (const [fromId, step] of Object.entries(definition.steps)) {
    for (const action of step.actions) {
      const targets = typeof action.to === 'function' ? (action.possibleTo || []) : [action.to];
      for (const to of targets) edges.push({ from: fromId, to, label: action.label });
    }
  }

  return {
    id: definition.id,
    title: definition.title,
    description: definition.description || '',
    start: definition.start,
    nodes,
    edges,
  };
}

module.exports = {
  start, act, inbox, list, detail, describe,
  canViewInstance, canActOnTask, resolveAssignee, validateFields, parseData,
};
