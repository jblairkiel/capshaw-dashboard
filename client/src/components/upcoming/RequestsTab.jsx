import { useState, useEffect, useCallback } from 'react';
import { SongPicker } from './shared';
import { call, dayLabel } from './api';

// ─── Song Requests ────────────────────────────────────────────────────────────
//
// Anybody can ask for a song — for a particular Sunday or any time. The song
// leader sees open requests beside the service he is submitting; a request
// becomes "planned" when a submitted service has the song, and "sung" when
// that service is confirmed. The asker can withdraw it; whoever keeps the
// songs can decline it or mark it sung.

const LABEL = {
  open:      { text: 'Waiting',   tone: 'bg-sky-100 text-sky-800' },
  planned:   { text: 'Planned',   tone: 'bg-amber-100 text-amber-800' },
  done:      { text: 'Sung',      tone: 'bg-emerald-100 text-emerald-800' },
  withdrawn: { text: 'Withdrawn', tone: 'bg-gray-100 text-gray-500' },
  declined:  { text: 'Declined',  tone: 'bg-gray-100 text-gray-500' },
};

function RequestRow({ r, user, manages, busy, onStatus }) {
  const mine = r.requestedBy && r.requestedBy === user?.id;
  const l = LABEL[r.status];
  return (
    <li className="py-3 border-t border-gray-100 first:border-t-0 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-sm">
          <span className="font-medium text-church-navy">{r.song.title}</span>
          {r.song.number && <span className="ml-1.5 text-xs text-gray-400">{[r.song.hymnal, r.song.number].filter(Boolean).join(' ')}</span>}
        </p>
        <p className="text-xs text-gray-500">
          Asked by {mine ? 'you' : r.requesterName || 'a member'}
          {r.forDate && <> · for {dayLabel(r.forDate, { weekday: 'short', month: 'short', day: 'numeric' })}</>}
          {r.plan && <> · in the {r.plan.service} on {dayLabel(r.plan.date, { month: 'short', day: 'numeric' })}</>}
        </p>
        {r.note && <p className="text-xs text-gray-400 italic mt-0.5">{r.note}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-xs px-2 py-0.5 rounded-full ${l.tone}`}>{l.text}</span>
        {mine && r.status === 'open' && (
          <button onClick={() => onStatus(r, 'withdrawn')} disabled={busy} className="text-xs text-gray-500 underline hover:text-red-600">Withdraw</button>
        )}
        {manages && r.status === 'open' && (
          <>
            <button onClick={() => onStatus(r, 'done')} disabled={busy} className="text-xs text-church-navy underline">Mark sung</button>
            <button onClick={() => onStatus(r, 'declined')} disabled={busy} className="text-xs text-gray-500 underline hover:text-red-600">Decline</button>
          </>
        )}
        {manages && ['declined', 'done', 'withdrawn'].includes(r.status) && (
          <button onClick={() => onStatus(r, 'open')} disabled={busy} className="text-xs text-gray-500 underline">Reopen</button>
        )}
      </div>
    </li>
  );
}

export default function RequestsTab({ overview, user, onChanged }) {
  const [song, setSong]       = useState(null);
  const [forDate, setForDate] = useState('');
  const [note, setNote]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [message, setMessage] = useState('');
  const [past, setPast]       = useState(null);
  const [showPast, setShowPast] = useState(false);

  const manages = overview.keepsSongs || overview.canOrganize;
  const dates = [...new Set(overview.upcoming.map(u => u.date))];

  const loadPast = useCallback(async () => {
    try { setPast((await call('/api/worship/requests?status=done,declined,withdrawn')).requests); }
    catch { setPast([]); }
  }, []);
  // Kept current while it is open, since a change above can move a request here.
  useEffect(() => { if (showPast) loadPast(); }, [overview, showPast, loadPast]);

  async function ask(e) {
    e.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      await call('/api/worship/requests', { method: 'POST', body: JSON.stringify({ songId: song.id, forDate, note }) });
      setMessage(`Thank you — “${song.title}” is on the list for the song leaders.`);
      setSong(null); setForDate(''); setNote('');
      onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function setStatus(request, status) {
    setBusy(true); setError('');
    try {
      await call(`/api/worship/requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr] items-start">
      <form onSubmit={ask} className="card space-y-3" aria-label="Ask for a song">
        <div>
          <h3 className="font-semibold text-church-navy">Ask for a song</h3>
          <p className="text-xs text-gray-500 mt-0.5">The song leaders see it when they plan a service.</p>
        </div>
        <div className="text-sm">
          <span className="block text-gray-700 mb-1">Song</span>
          <SongPicker value={song} onChange={setSong} label="Song to request" />
          <p className="text-xs text-gray-400 mt-1">Not on the list? Type its name and choose “Add … as a new song”.</p>
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">When <span className="text-gray-400">(optional)</span></span>
          <select value={forDate} onChange={e => setForDate(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Any time</option>
            {dates.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Why, or anything the song leader should know <span className="text-gray-400">(optional)</span></span>
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={300}
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        {message && <p className="text-sm text-emerald-700" role="status">{message}</p>}
        <button type="submit" disabled={busy || !song} className="btn-primary text-sm disabled:opacity-50">Ask for this song</button>
      </form>

      <div className="space-y-4">
        <section className="card" aria-label="Requested songs">
          <h3 className="font-semibold text-church-navy mb-1">Requested songs</h3>
          {overview.requests.length === 0
            ? <p className="text-sm text-gray-500">No requests waiting.</p>
            : <ul>{overview.requests.map(r => <RequestRow key={r.id} r={r} user={user} manages={manages} busy={busy} onStatus={setStatus} />)}</ul>}
        </section>

        <section className="card" aria-label="Earlier requests">
          {!showPast ? (
            <button onClick={() => setShowPast(true)} className="text-sm text-church-navy underline">Show earlier requests</button>
          ) : (
            <>
              <h3 className="font-semibold text-church-navy mb-1">Earlier requests</h3>
              {past === null ? <p className="text-sm text-gray-400">Loading…</p>
                : past.length === 0 ? <p className="text-sm text-gray-500">None yet.</p>
                : <ul>{past.map(r => <RequestRow key={r.id} r={r} user={user} manages={manages} busy={busy} onStatus={setStatus} />)}</ul>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
