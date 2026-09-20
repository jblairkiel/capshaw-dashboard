import { useState, useEffect, useCallback } from 'react';
import EventComments from './EventComments';
import { call, formatEventDate, RESPONSES, responseInfo } from '../lib/groups';

// ─── A group's meeting ────────────────────────────────────────────────────────
//
// One card per meeting, which opens into everything the meeting collects: who
// is coming, what still needs bringing, and what the group has said about it.
//
// The card is shut by default and fetches nothing until it is opened — a group
// with a year of meetings behind it should not load a year of replies to show
// the next one.

const STATUS_TONE = {
  draft:     'bg-gray-100 text-gray-600',
  published: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABEL = {
  draft:     'Draft — only leaders can see it',
  published: 'Posted',
  cancelled: 'Cancelled',
};

function When({ event }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
      {event.date && <span>📆 {formatEventDate(event.date)}</span>}
      {event.time && <span>🕐 {event.time}{event.endTime ? `–${event.endTime}` : ''}</span>}
      {event.location && <span>📍 {event.location}</span>}
      {event.hostName && <span>🏠 {event.hostName}</span>}
    </div>
  );
}

// ─── Answering the invitation ─────────────────────────────────────────────────

function Rsvp({ groupId, event, detail, onChanged }) {
  const [guests, setGuests] = useState(detail?.rsvp?.guests ?? 0);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState('');

  const mine = detail?.rsvp?.response ?? null;

  async function answer(response) {
    setBusy(true); setError('');
    try {
      await call(`/api/groups/${groupId}/events/${event.id}/rsvp`, {
        method: 'POST',
        body: JSON.stringify({ response, guests }),
      });
      onChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (event.status !== 'published' || !event.rsvpEnabled) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Can you come?</p>
      <div className="flex flex-wrap items-center gap-2">
        {RESPONSES.map(option => (
          <button
            key={option.id}
            disabled={busy}
            onClick={() => answer(option.id)}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
              mine === option.id
                ? `${option.tone} border-transparent`
                : 'border-gray-200 text-gray-600 hover:border-church-gold'
            }`}
          >
            {option.label}
          </button>
        ))}

        <label className="flex items-center gap-1.5 text-xs text-gray-500 ml-1">
          bringing
          <input
            type="number"
            min="0"
            max="20"
            value={guests}
            aria-label="People you are bringing"
            onChange={e => setGuests(Math.max(0, Number(e.target.value) || 0))}
            className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-church-gold"
          />
          others
        </label>
      </div>
      {mine && <p className="text-xs text-gray-400">You said {responseInfo(mine).label.toLowerCase()}. Change it any time.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ─── The sign-up list ─────────────────────────────────────────────────────────

function SignupList({ groupId, event, detail, onChanged }) {
  const [busy,   setBusy]   = useState(null);
  const [detailText, setDetailText] = useState({});
  const [error,  setError]  = useState('');

  const items = detail?.signups ?? [];
  if (!items.length) return null;

  async function claim(item) {
    setBusy(item.id); setError('');
    try {
      await call(`/api/groups/${groupId}/events/${event.id}/signups`, {
        method: 'POST',
        body: JSON.stringify({ itemId: item.id, detail: detailText[item.id] || '' }),
      });
      onChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function release(claimId) {
    setBusy(claimId); setError('');
    try {
      await call(`/api/groups/${groupId}/events/${event.id}/signups/${claimId}`, { method: 'DELETE' });
      onChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{event.signupTitle}</p>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="space-y-2">
        {items.map(item => {
          const mine = item.claims.find(c => c.mine);
          return (
            <li key={item.id} className="border border-gray-100 rounded-lg p-2.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm text-church-navy font-medium">{item.label}</p>
                  {item.notes && <p className="text-xs text-gray-500">{item.notes}</p>}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {item.remaining > 0
                      ? `${item.remaining} of ${item.needed} still needed`
                      : 'Covered, thank you'}
                  </p>
                </div>

                {mine ? (
                  <button
                    onClick={() => release(mine.id)}
                    disabled={busy === mine.id}
                    className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 shrink-0"
                  >
                    I can&apos;t after all
                  </button>
                ) : item.remaining > 0 ? (
                  <div className="flex gap-1.5 shrink-0">
                    <input
                      value={detailText[item.id] || ''}
                      onChange={e => setDetailText(p => ({ ...p, [item.id]: e.target.value }))}
                      placeholder="what you'll bring"
                      aria-label={`What you will bring for ${item.label}`}
                      className="w-32 border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-church-gold"
                    />
                    <button
                      onClick={() => claim(item)}
                      disabled={busy === item.id}
                      className="text-xs px-2.5 py-1 rounded-lg bg-church-navy text-white hover:bg-opacity-90 disabled:opacity-50"
                    >
                      I&apos;ll bring it
                    </button>
                  </div>
                ) : null}
              </div>

              {item.claims.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {item.claims.map(c => (
                    <li key={c.id} className="text-xs text-gray-500">
                      · {c.name}{c.detail ? ` — ${c.detail}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Who is coming ────────────────────────────────────────────────────────────

function Attendance({ detail }) {
  const summary = detail?.summary;
  if (!summary) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Who is coming</p>
      <p className="text-sm text-church-navy">
        <strong>{summary.attending}</strong> expected
        {summary.guests > 0 && <span className="text-gray-500"> ({summary.yes} answered, {summary.guests} brought along)</span>}
        {summary.maybe > 0 && <span className="text-gray-500"> · {summary.maybe} maybe</span>}
        {summary.no > 0 && <span className="text-gray-500"> · {summary.no} can&apos;t</span>}
      </p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {(detail.rsvps ?? []).map(r => (
          <li key={r.id} className={`text-xs ${responseInfo(r.response).quiet}`}>
            {r.name}{r.guests ? ` +${r.guests}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── The card ─────────────────────────────────────────────────────────────────

export function MeetingCard({ groupId, event, canManage, onChanged, onEdit, defaultOpen = false }) {
  const [open,   setOpen]   = useState(defaultOpen);
  const [detail, setDetail] = useState(null);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState('');

  const load = useCallback(() => {
    call(`/api/groups/${groupId}/events/${event.id}`)
      .then(json => setDetail(json.event))
      .catch(e => setError(e.message));
  }, [groupId, event.id]);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function act(path, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true); setError('');
    try {
      await call(`/api/groups/${groupId}/events/${event.id}${path}`, { method: 'POST' });
      load();
      onChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Delete this meeting? Everything said about it goes too.')) return;
    setBusy(true); setError('');
    try {
      await call(`/api/groups/${groupId}/events/${event.id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  const shown = detail ?? event;

  return (
    <div className={`card border-l-4 ${
      event.status === 'cancelled' ? 'border-l-red-400 opacity-70'
        : event.status === 'draft' ? 'border-l-gray-300'
        : 'border-l-church-gold'
    }`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_TONE[event.status]}`}>
              {STATUS_LABEL[event.status]}
            </span>
            {event.comments > 0 && (
              <span className="text-xs text-gray-400">💬 {event.comments}</span>
            )}
          </div>
          <button onClick={() => setOpen(o => !o)} className="block text-left font-semibold text-church-navy mt-1 hover:underline">
            {event.title}
          </button>
          <div className="mt-1"><When event={shown} /></div>
          {event.summary && event.rsvpEnabled && event.status === 'published' && (
            <p className="text-xs text-gray-500 mt-1">{event.summary.attending} expected</p>
          )}
        </div>

        <button
          onClick={() => setOpen(o => !o)}
          className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:border-church-gold shrink-0"
        >
          {open ? 'Close' : 'Open'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {open && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-5">
          {shown.description && <p className="text-sm text-gray-600 whitespace-pre-wrap">{shown.description}</p>}

          {canManage && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => onEdit(shown)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold">
                Edit
              </button>
              {event.status === 'draft' && (
                <button
                  onClick={() => act('/publish', 'Post this to the group? Everyone on the roll is told, and the group is emailed.')}
                  disabled={busy}
                  className="text-xs px-2.5 py-1 rounded-lg bg-church-navy text-white hover:bg-opacity-90 disabled:opacity-50"
                >
                  Post it to the group
                </button>
              )}
              {event.status === 'published' && (
                <button
                  onClick={() => act('/cancel', 'Cancel this meeting? The group is told.')}
                  disabled={busy}
                  className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel it
                </button>
              )}
              <button onClick={remove} disabled={busy} className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50">
                Delete
              </button>
            </div>
          )}

          {detail ? (
            <>
              <Rsvp groupId={groupId} event={shown} detail={detail} onChanged={() => { load(); onChanged(); }} />
              <SignupList groupId={groupId} event={shown} detail={detail} onChanged={() => { load(); onChanged(); }} />
              <Attendance detail={detail} />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Comments</p>
                <EventComments subjectType="group-event" subjectId={event.id} onCountChange={() => onChanged()} />
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">Loading…</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Writing one ──────────────────────────────────────────────────────────────

const BLANK = {
  title: '', description: '', date: '', time: '', endTime: '', location: '', hostName: '',
  rsvpEnabled: true, capacity: 0, signupTitle: 'What to bring',
};

export function MeetingEditor({ groupId, event, onSaved, onCancel }) {
  const isNew = !event?.id;
  const [form,  setForm]  = useState({ ...BLANK, ...(event ?? {}) });
  const [items, setItems] = useState(event?.signups?.map(i => ({ id: i.id, label: i.label, notes: i.notes, needed: i.needed })) ?? []);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(p => ({ ...p, [key]: value }));
  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return setError('A title is required');
    setBusy(true); setError('');
    try {
      const json = await call(
        isNew ? `/api/groups/${groupId}/events` : `/api/groups/${groupId}/events/${event.id}`,
        {
          method: isNew ? 'POST' : 'PUT',
          body: JSON.stringify({
            ...form,
            signupEnabled: items.length > 0,
            signupItems: items,
          }),
        },
      );
      onSaved(json.event);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card border-2 border-church-gold space-y-4">
      <h3 className="font-semibold text-church-navy">{isNew ? 'A new meeting' : `Editing "${event.title}"`}</h3>

      <label className="block">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">What is it</span>
        <input value={form.title} onChange={e => set('title', e.target.value)} className={field} placeholder="Fellowship meal" />
      </label>

      <label className="block">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Details</span>
        <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} className={field} />
      </label>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</span>
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Starts</span>
          <input type="time" value={form.time} onChange={e => set('time', e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ends</span>
          <input type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Room for</span>
          <input
            type="number" min="0" value={form.capacity}
            onChange={e => set('capacity', Math.max(0, Number(e.target.value) || 0))}
            className={field}
          />
          <span className="text-xs text-gray-400">0 = no limit</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Where</span>
          <input value={form.location} onChange={e => set('location', e.target.value)} className={field} placeholder="The Harris home" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Hosted by</span>
          <input value={form.hostName} onChange={e => set('hostName', e.target.value)} className={field} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={form.rsvpEnabled} onChange={e => set('rsvpEnabled', e.target.checked)} />
        Ask the group to say whether they are coming
      </label>

      {/* ── The sign-up list ──────────────────────────────────────────────── */}
      <div className="space-y-2 pt-2 border-t border-gray-100">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="block flex-1 min-w-[12rem]">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sign-up list (optional)</span>
            <input
              value={form.signupTitle}
              onChange={e => set('signupTitle', e.target.value)}
              className={field}
              placeholder="What to bring"
              aria-label="What the sign-up list is called"
            />
          </label>
          <button
            type="button"
            onClick={() => setItems(list => [...list, { label: '', notes: '', needed: 1 }])}
            className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold self-end mb-1"
          >
            Add something needed
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-gray-400">Nothing on the list — leave it that way if there is nothing to bring.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, index) => (
              <li key={item.id ?? `new-${index}`} className="flex gap-2 items-start">
                <input
                  value={item.label}
                  onChange={e => setItems(list => list.map((it, i) => i === index ? { ...it, label: e.target.value } : it))}
                  placeholder="Dessert"
                  aria-label={`Item ${index + 1}`}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
                />
                <input
                  type="number" min="1" value={item.needed}
                  onChange={e => setItems(list => list.map((it, i) => i === index ? { ...it, needed: Math.max(1, Number(e.target.value) || 1) } : it))}
                  aria-label={`How many of item ${index + 1}`}
                  className="w-16 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-church-gold"
                />
                <button
                  type="button"
                  onClick={() => setItems(list => list.filter((_, i) => i !== index))}
                  className="text-xs px-2 py-2 text-gray-400 hover:text-red-600"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
          {busy ? 'Saving…' : isNew ? 'Save as a draft' : 'Save changes'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-church-navy">Cancel</button>
        {isNew && <span className="text-xs text-gray-400">Nobody is told until you post it.</span>}
      </div>
    </form>
  );
}
