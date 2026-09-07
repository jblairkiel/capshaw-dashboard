import { useState, useEffect, useCallback } from 'react';
import { isAdmin } from '../../lib/roles';
import { API, call, OUTCOME_BADGE } from './api';
import { ActionBar, StartForm, Detail } from './parts';

// The workflows belonging to one page, shown on that page. Renders nothing at
// all when a page has no workflows to start and none in flight, so it can be
// dropped onto a page without cluttering it.
export default function WorkflowPanel({ page, user, title = 'Requests & approvals' }) {
  const [definitions, setDefinitions] = useState([]);
  const [instances,   setInstances]   = useState([]);
  const [openId,      setOpenId]      = useState(null);
  const [detail,      setDetail]      = useState(null);
  const [starting,    setStarting]    = useState(false);
  const [status,      setStatus]      = useState('active');
  const [scope,       setScope]       = useState('mine');
  const [busyTask,    setBusyTask]    = useState(null);
  const [error,       setError]       = useState('');
  const [loading,     setLoading]     = useState(true);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setError('');
    try {
      const [defs, list] = await Promise.all([
        call(`${API}/definitions?page=${page}`),
        call(`${API}?page=${page}&status=${status}&scope=${scope}`),
      ]);
      setDefinitions(defs.definitions);
      setInstances(list.instances);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, status, scope, user]);

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

  // Signed-out visitors, and pages with nothing going on, get no panel.
  if (!user || loading) return null;
  if (!definitions.length && !instances.length && !error) return null;

  if (detail) {
    return (
      <section className="space-y-4 border-t border-gray-200 pt-6">
        {error && <div className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}
        <Detail detail={detail} busy={busyTask !== null} onAct={act} onBack={() => setOpenId(null)} />
      </section>
    );
  }

  return (
    <section className="space-y-3 border-t border-gray-200 pt-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-0">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Steps that need more than one person, kept with the page they are about.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin(user) && (
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
          {!starting && definitions.length > 0 && (
            <button onClick={() => setStarting(true)} className="btn-primary text-sm">
              {definitions.length === 1 ? definitions[0].title : 'Start a request'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {starting && (
        <StartForm
          definitions={definitions}
          onCancel={() => setStarting(false)}
          onStarted={id => { setStarting(false); load(); setOpenId(id); }}
        />
      )}

      {instances.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing in progress here.</p>
      ) : (
        instances.map(i => {
          const task = i.myTaskId ? { id: i.myTaskId } : null;
          return (
            <div key={i.id} className="card">
              <button onClick={() => setOpenId(i.id)} className="w-full text-left">
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
              {task && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-medium text-church-navy mb-2">Waiting on you</p>
                  <ActionBar
                    actions={i.myActions || []}
                    busy={busyTask === task.id}
                    onAct={(actionId, note) => act(task.id, actionId, note)}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
