import { useState, useEffect, useCallback } from 'react';
import { isAdmin } from '../lib/roles';
import WorkflowChart from './WorkflowChart';

const API = '/api/workflows';

async function call(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

const TONE_BUTTON = {
  good:    'bg-emerald-600 text-white hover:bg-emerald-700',
  bad:     'border border-red-200 text-red-600 hover:bg-red-50',
  neutral: 'border border-gray-200 text-gray-700 hover:bg-gray-50',
};

const OUTCOME_BADGE = {
  good:    'bg-emerald-100 text-emerald-800',
  bad:     'bg-red-100 text-red-700',
  neutral: 'bg-gray-100 text-gray-600',
};

// ─── Taking an action ─────────────────────────────────────────────────────────

// Actions that need a note reveal a box rather than firing straight away, so
// a decline always carries its reason.
function ActionBar({ actions, onAct, busy }) {
  const [pending, setPending] = useState(null);
  const [note, setNote] = useState('');

  if (pending) {
    return (
      <div className="space-y-2">
        <label className="block">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {pending.label} — add a note
          </span>
          <textarea
            rows={2}
            autoFocus
            value={note}
            onChange={e => setNote(e.target.value)}
            className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
          />
        </label>
        <div className="flex gap-2">
          <button
            disabled={busy || !note.trim()}
            onClick={() => onAct(pending.id, note).then(() => { setPending(null); setNote(''); })}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 ${TONE_BUTTON[pending.tone]}`}
          >
            {busy ? 'Saving…' : pending.label}
          </button>
          <button
            onClick={() => { setPending(null); setNote(''); }}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(action => (
        <button
          key={action.id}
          disabled={busy}
          onClick={() => (action.requiresNote ? setPending(action) : onAct(action.id, ''))}
          className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${TONE_BUTTON[action.tone]}`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

// ─── Inbox ────────────────────────────────────────────────────────────────────

function Inbox({ tasks, onAct, onOpen, busyTask }) {
  if (!tasks.length) {
    return (
      <div className="card text-center py-10">
        <p className="text-sm text-gray-500">Nothing is waiting on you.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map(task => (
        <div key={task.taskId} className="card">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs px-2 py-0.5 rounded-full bg-church-navy/5 text-church-navy">{task.workflow}</span>
                {task.assignedRole && (
                  <span className="text-xs text-gray-400">anyone who is {task.assignedRole}</span>
                )}
              </div>
              <button
                onClick={() => onOpen(task.instanceId)}
                className="block text-left font-semibold text-church-navy mt-1 hover:underline"
              >
                {task.title}
              </button>
              <p className="text-sm text-gray-600 mt-0.5">{task.stepTitle}</p>
              {task.instruction && <p className="text-xs text-gray-500 mt-1">{task.instruction}</p>}
            </div>
          </div>
          <div className="mt-3">
            <ActionBar
              actions={task.actions}
              busy={busyTask === task.taskId}
              onAct={(actionId, note) => onAct(task.taskId, actionId, note)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Start a workflow ─────────────────────────────────────────────────────────

function StartForm({ definitions, onStarted, onCancel }) {
  const [definitionId, setDefinitionId] = useState(definitions[0]?.id ?? '');
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const definition = definitions.find(d => d.id === definitionId);

  useEffect(() => { setForm({}); setError(''); }, [definitionId]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const json = await call(API, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ definitionId, data: form }),
      });
      onStarted(json.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Workflow</span>
        <select
          value={definitionId}
          onChange={e => setDefinitionId(e.target.value)}
          className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
        >
          {definitions.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
      </label>

      {definition?.description && <p className="text-xs text-gray-500">{definition.description}</p>}

      {definition?.fields.map(field => {
        const value = form[field.key] ?? '';
        const set = v => setForm(p => ({ ...p, [field.key]: v }));
        const common = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';

        return (
          <label key={field.key} className="block">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {field.label}{field.required && <span className="text-red-400"> *</span>}
            </span>

            {field.type === 'select' ? (
              <>
                <select value={value} onChange={e => set(e.target.value)} className={common}>
                  <option value="">Choose…</option>
                  {(field.options || []).map(o => (
                    <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
                  ))}
                </select>
                {(field.options || []).length === 0 && (
                  <span className="text-xs text-amber-700 mt-1 block">
                    Nothing to choose from yet.
                  </span>
                )}
              </>
            ) : field.type === 'textarea' ? (
              <textarea rows={3} value={value} placeholder={field.placeholder} onChange={e => set(e.target.value)} className={common} />
            ) : (
              <input
                type={field.type === 'date' ? 'date' : 'text'}
                value={value}
                placeholder={field.placeholder}
                onChange={e => set(e.target.value)}
                className={common}
              />
            )}
          </label>
        );
      })}

      {definition?.chart && (
        <details className="border-t border-gray-100 pt-3">
          <summary className="text-sm text-church-gold cursor-pointer">What happens after I submit?</summary>
          <div className="mt-3">
            <WorkflowChart chart={definition.chart} currentStepId={definition.chart.start} />
          </div>
        </details>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary text-sm">
          {busy ? 'Starting…' : 'Start workflow'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Instance detail ──────────────────────────────────────────────────────────

function Detail({ detail, onAct, onBack, busy }) {
  const { instance, definition, visited, events, myTask, tasks } = detail;
  const pending = tasks.filter(t => t.status === 'pending');

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-church-gold hover:text-church-navy">← Back</button>

      <div className="card">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-church-navy/5 text-church-navy">{instance.workflow}</span>
            <h2 className="text-lg font-semibold text-church-navy mt-1">{instance.title}</h2>
          </div>
          {instance.status === 'completed' ? (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OUTCOME_BADGE[instance.outcomeTone]}`}>
              {instance.outcomeLabel}
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
              {instance.stepTitle}
            </span>
          )}
        </div>

        {instance.fields.length > 0 && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-4">
            {instance.fields.map(f => (
              <div key={f.key} className="flex gap-2 text-sm">
                <dt className="text-gray-500 shrink-0">{f.label}:</dt>
                <dd className="text-church-navy min-w-0">{f.value || '—'}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {myTask && (
        <div className="card border border-church-gold/40 bg-amber-50/40">
          <h3 className="font-semibold text-church-navy text-sm">Waiting on you</h3>
          {instance.instruction && <p className="text-xs text-gray-600 mt-0.5 mb-3">{instance.instruction}</p>}
          <ActionBar actions={myTask.actions} busy={busy} onAct={(actionId, note) => onAct(myTask.id, actionId, note)} />
        </div>
      )}

      {!myTask && instance.status === 'active' && pending.length > 0 && (
        <div className="card text-sm text-gray-600">
          Waiting on {pending.map(t => t.assigneeName || `anyone who is ${t.assigneeRole}`).join(', ')}.
        </div>
      )}

      {/* A workflow that generates something shows it here for review. */}
      {instance.preview?.rows?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-church-navy text-sm mb-3">
            Draft <span className="text-gray-400 font-normal">({instance.preview.rows.length} rows)</span>
          </h3>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  {instance.preview.columns.map(col => (
                    <th key={col} className="px-2 py-1.5 font-medium">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {instance.preview.rows.map((row, i) => (
                  <tr key={i} className={i % 2 ? 'bg-gray-50/60' : ''}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`px-2 py-1.5 ${String(cell).startsWith('—') ? 'text-amber-700' : 'text-church-navy'}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {definition && (
        <div className="card">
          <h3 className="font-semibold text-church-navy text-sm mb-3">How this workflow runs</h3>
          <WorkflowChart
            chart={definition}
            currentStepId={instance.stepId}
            visited={visited}
            outcome={instance.outcome}
            status={instance.status}
          />
        </div>
      )}

      <div className="card">
        <h3 className="font-semibold text-church-navy text-sm mb-3">History</h3>
        <ol className="space-y-2.5">
          {events.map(event => (
            <li key={event.id} className="flex gap-3 text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-church-gold mt-1.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-church-navy">{event.summary}</p>
                {event.note && <p className="text-xs text-gray-600 mt-0.5 italic">“{event.note}”</p>}
                <p className="text-xs text-gray-400 mt-0.5">
                  {event.actor} · {new Date(event.createdAt.replace(' ', 'T') + 'Z').toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function WorkflowsView({ user }) {
  const [tab, setTab]                 = useState('inbox');
  const [inboxTasks, setInboxTasks]   = useState([]);
  const [instances, setInstances]     = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [openId, setOpenId]           = useState(null);
  const [detail, setDetail]           = useState(null);
  const [starting, setStarting]       = useState(false);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [busyTask, setBusyTask]       = useState(null);
  const [scope, setScope]             = useState('mine');
  const [status, setStatus]           = useState('active');

  const admin = isAdmin(user);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [inbox, list, defs] = await Promise.all([
        call(`${API}/inbox`),
        call(`${API}?scope=${scope}&status=${status}`),
        call(`${API}/definitions`),
      ]);
      setInboxTasks(inbox.tasks);
      setInstances(list.instances);
      setDefinitions(defs.definitions);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [scope, status]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (openId === null) { setDetail(null); return; }
    let cancelled = false;
    call(`${API}/${openId}`)
      .then(json => { if (!cancelled) setDetail(json); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [openId]);

  async function act(taskId, actionId, note) {
    setBusyTask(taskId); setError('');
    try {
      const json = await call(`${API}/tasks/${taskId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: actionId, note }),
      });
      if (openId !== null) setDetail(json);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyTask(null);
    }
  }

  if (loading && !detail) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  if (detail) {
    return (
      <div className="space-y-4">
        {error && <div className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}
        <Detail detail={detail} busy={busyTask !== null} onAct={act} onBack={() => setOpenId(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-0">Workflows</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Requests and approvals that need more than one person.
          </p>
        </div>
        {!starting && definitions.length > 0 && (
          <button onClick={() => setStarting(true)} className="btn-primary text-sm">Start a workflow</button>
        )}
      </div>

      {error && <div className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {starting && (
        <StartForm
          definitions={definitions}
          onCancel={() => setStarting(false)}
          onStarted={id => { setStarting(false); load(); setOpenId(id); }}
        />
      )}

      <div className="flex gap-1 border-b border-gray-200">
        {[
          { id: 'inbox', label: `My Inbox${inboxTasks.length ? ` (${inboxTasks.length})` : ''}` },
          { id: 'list',  label: 'Workflows' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-church-gold text-church-navy'
                : 'border-transparent text-gray-500 hover:text-church-navy'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inbox' ? (
        <Inbox tasks={inboxTasks} onAct={act} onOpen={setOpenId} busyTask={busyTask} />
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {admin && (
              <select
                value={scope}
                onChange={e => setScope(e.target.value)}
                aria-label="Whose workflows"
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5"
              >
                <option value="mine">Ones I am involved in</option>
                <option value="all">Everyone&apos;s</option>
              </select>
            )}
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              aria-label="Workflow status"
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5"
            >
              <option value="active">In progress</option>
              <option value="completed">Finished</option>
              <option value="any">All</option>
            </select>
          </div>

          {instances.length === 0 ? (
            <div className="card text-center py-10 text-sm text-gray-500">
              Nothing here yet.
            </div>
          ) : (
            instances.map(i => (
              <button
                key={i.id}
                onClick={() => setOpenId(i.id)}
                className="card w-full text-left hover:border-church-gold/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-church-navy/5 text-church-navy">{i.workflow}</span>
                    <p className="font-semibold text-church-navy mt-1">{i.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {i.status === 'completed' ? i.outcomeLabel : i.stepTitle}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                    i.status === 'completed' ? OUTCOME_BADGE[i.outcomeTone] : 'bg-amber-100 text-amber-800'
                  }`}>
                    {i.status === 'completed' ? 'Finished' : 'In progress'}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
