import { useState, useEffect, useCallback } from 'react';
import { API, call } from './workflow/api';
import { ActionBar, Detail } from './workflow/parts';

// Workflows live on the pages they are about, so this is the one place that
// gathers them: everything waiting on you, wherever it came from.

// ─── Inbox ────────────────────────────────────────────────────────────────────

function Inbox({ tasks, onAct, onOpen, busyTask, pageLabel, onGoToPage }) {
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
                {pageLabel(task.page) && (
                  <button
                    onClick={() => onGoToPage?.(task.page)}
                    className="text-xs text-church-gold hover:underline"
                  >
                    on {pageLabel(task.page)}
                  </button>
                )}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InboxView({ user, onGoToPage }) {
  const [tasks,    setTasks]    = useState([]);
  const [pages,    setPages]    = useState([]);
  const [openId,   setOpenId]   = useState(null);
  const [detail,   setDetail]   = useState(null);
  const [busyTask, setBusyTask] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [inbox, pageList] = await Promise.all([call(`${API}/inbox`), call(`${API}/pages`)]);
      setTasks(inbox.tasks);
      setPages(pageList.pages);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (openId === null) { setDetail(null); return; }
    let cancelled = false;
    call(`${API}/${openId}`)
      .then(json => { if (!cancelled) setDetail(json); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [openId]);

  const pageLabel = id => pages.find(p => p.id === id)?.label || '';

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

  if (loading) {
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
      <div>
        <h2 className="section-heading mb-0">My Inbox</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Everything waiting on you. Each request also lives on the page it is about.
        </p>
      </div>

      {error && <div className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      <Inbox
        tasks={tasks}
        onAct={act}
        onOpen={setOpenId}
        busyTask={busyTask}
        pageLabel={pageLabel}
        onGoToPage={onGoToPage}
      />
    </div>
  );
}
