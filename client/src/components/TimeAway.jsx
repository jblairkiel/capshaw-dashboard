import { useState } from 'react';
import { describeRange } from '../lib/timeAway';

// ─── Time away from the serving jobs ──────────────────────────────────────────
//
// The days somebody has blocked out — a holiday, a hospital stay, a fortnight
// with the grandchildren — shown as a list with a little form under it.
//
// Used from both sides of the schedule: a member keeps their own on the Serving
// Schedule, and the schedule keeper keeps anybody's from the Service Roster. It
// takes the ranges and reports what to save rather than owning the request, so
// the two pages can post them to the same endpoint under different rules.

export default function TimeAway({
  blackouts = [],
  onAdd,
  onRemove,
  disabled = false,
  heading = 'Time away',
  hint = 'Days you will not be here. Nobody can be put down for a job while you are away, and you cannot sign yourself up for one.',
  emptyText = 'No time away — you are available for every service on the roster.',
}) {
  const [startsOn, setStartsOn] = useState('');
  const [endsOn,   setEndsOn]   = useState('');
  const [reason,   setReason]   = useState('');
  const [busy,     setBusy]     = useState(false);
  const [busyId,   setBusyId]   = useState(null);
  const [error,    setError]    = useState('');

  async function add(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      // One day away is entered as a first day and nothing else, so the last
      // day is left to the server to take as the same date.
      await onAdd({ startsOn, endsOn: endsOn || startsOn, reason });
      setStartsOn(''); setEndsOn(''); setReason('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(range) {
    setBusyId(range.id); setError('');
    try {
      await onRemove(range.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold disabled:bg-gray-50';
  const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-church-navy">{heading}</h4>
        <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
      </div>

      {blackouts.length === 0 ? (
        <p className="text-xs text-gray-400">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {blackouts.map(range => (
            <li
              key={range.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
            >
              <span className="text-sm text-amber-900">
                {describeRange(range)}
                {range.reason && <span className="text-xs text-amber-700"> · {range.reason}</span>}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(range)}
                  disabled={busyId === range.id}
                  aria-label={`Clear time away ${describeRange(range)}`}
                  className="text-xs px-2.5 py-1 rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && (
        <form onSubmit={add} className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>First day away</span>
              <input
                required
                type="date"
                aria-label="First day away"
                value={startsOn}
                onChange={e => setStartsOn(e.target.value)}
                className={field}
              />
            </label>
            <label className="block">
              <span className={label}>Last day away</span>
              <input
                type="date"
                aria-label="Last day away"
                value={endsOn}
                min={startsOn || undefined}
                onChange={e => setEndsOn(e.target.value)}
                className={field}
              />
            </label>
          </div>

          <label className="block">
            <span className={label}>Why, if it helps</span>
            <input
              value={reason}
              placeholder="Away with family, surgery, work travel…"
              onChange={e => setReason(e.target.value)}
              className={field}
            />
          </label>

          <p className="text-xs text-gray-500">
            Leave the last day blank for a single day away. Both days count as away.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={busy || !startsOn} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Saving…' : 'Block out these days'}
          </button>
        </form>
      )}

      {disabled && error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
