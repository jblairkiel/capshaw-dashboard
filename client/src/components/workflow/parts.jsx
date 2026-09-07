import { useState, useEffect } from 'react';
import WorkflowChart from '../WorkflowChart';
import { API, call, TONE_BUTTON, OUTCOME_BADGE } from './api';

// ─── Taking an action ─────────────────────────────────────────────────────────

// Actions that need a note reveal a box rather than firing straight away, so
// a decline always carries its reason.
export function ActionBar({ actions, onAct, busy }) {
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
// ─── Start a workflow ─────────────────────────────────────────────────────────

export function StartForm({ definitions, onStarted, onCancel }) {
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
      {/* A page usually hosts a single workflow; the picker only earns its
          place when there is really something to pick between. */}
      {definitions.length > 1 ? (
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
      ) : (
        <h3 className="font-semibold text-church-navy text-sm">{definition?.title}</h3>
      )}

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

export function Detail({ detail, onAct, onBack, busy }) {
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
