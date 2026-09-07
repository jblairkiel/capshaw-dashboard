const express = require('express');
const router  = express.Router();
const engine  = require('../workflows/engine');
const { listDefinitions, getDefinition } = require('../workflows/definitions');
const { fieldsFor } = require('../workflows/options');
const { PAGES, isPage } = require('../workflows/pages');
const { requireAuth, requireApproved, hasRole } = require('../middleware/auth');

// Everything here needs a signed-in user: a workflow is always somebody's.
router.use(requireAuth);

function send(res, result) {
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });
  return res.json({ success: true, ...result });
}

// ─── GET /api/workflows/pages ─────────────────────────────────────────────────
// Which pages host workflows, so the inbox can label a task with where it came
// from without hard-coding the list on the client.

router.get('/pages', (req, res) => {
  res.json({ success: true, pages: PAGES });
});

// ─── GET /api/workflows/definitions ───────────────────────────────────────────
// The catalogue, limited to what this user may actually start, with dynamic
// select options already resolved for them. `?page=` narrows it to the
// workflows that belong on one page.

router.get('/definitions', (req, res) => {
  const page = req.query.page;
  if (page && !isPage(page)) return res.status(400).json({ success: false, error: 'Unknown page' });

  const definitions = listDefinitions()
    .filter(d => !page || d.page === page)
    .filter(d => hasRole(req.user, d.startRole || 'approved'))
    .map(d => ({
      id: d.id,
      page: d.page,
      title: d.title,
      description: d.description || '',
      fields: fieldsFor(d, req.user),
      chart: engine.describe(d),
    }));

  res.json({ success: true, definitions });
});

// ─── GET /api/workflows/inbox ─────────────────────────────────────────────────
// What is waiting on me: tasks aimed at me by name, plus tasks aimed at a role
// I hold that nobody has taken yet.

router.get('/inbox', (req, res) => {
  res.json({ success: true, tasks: engine.inbox(req.user) });
});

// ─── GET /api/workflows ───────────────────────────────────────────────────────
// scope=mine  — workflows I am involved in (the default)
// scope=all   — everything, admins only
// status=active | completed | any
// page=       — only the workflows belonging to one page

router.get('/', (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  if (scope === 'all' && req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Only admins can see every workflow' });
  }

  const page = req.query.page || '';
  if (page && !isPage(page)) return res.status(400).json({ success: false, error: 'Unknown page' });

  const status = ['active', 'completed', 'any'].includes(req.query.status) ? req.query.status : 'active';
  res.json({ success: true, scope, status, page, instances: engine.list(req.user, { scope, status, page }) });
});

// ─── POST /api/workflows ──────────────────────────────────────────────────────

router.post('/', requireApproved, (req, res) => {
  send(res, engine.start({
    definitionId: req.body?.definitionId,
    data:         req.body?.data || {},
    user:         req.user,
  }));
});

// ─── GET /api/workflows/:id ───────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Bad workflow id' });
  send(res, engine.detail(id, req.user));
});

// ─── POST /api/workflows/tasks/:taskId ────────────────────────────────────────
// Take one of the actions the current step offers. The engine decides whether
// this user may, and where the workflow goes next.

router.post('/tasks/:taskId', requireApproved, (req, res) => {
  const taskId = Number(req.params.taskId);
  if (!Number.isInteger(taskId)) return res.status(400).json({ success: false, error: 'Bad task id' });

  const result = engine.act({
    taskId,
    actionId: req.body?.action,
    note:     req.body?.note || '',
    user:     req.user,
  });
  if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error });

  // Hand back the refreshed instance so the caller does not need a second trip.
  send(res, engine.detail(result.id, req.user));
});

module.exports = router;
