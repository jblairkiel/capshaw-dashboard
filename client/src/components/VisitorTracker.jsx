import { useState, useEffect, useCallback, useMemo } from 'react';
import Dialog from './Dialog';
import WorkflowDialogButton from './WorkflowDialogButton';
import { useIsNarrow } from '../lib/useMediaQuery';

// Our guests: who they are, how to reach them, and when they have been with us.
//
// This used to render only what the church website knew — a name from a heading
// and a list of dates — so the page read as comments and visit history with
// nobody's details on it. Everything now comes from our own records, and
// whoever looks after the Guest Tracker can add a guest and keep their details
// up to date here.
const API = '/api/visitors';

// Visit dates come off the church site as MM/DD/YY. Sorting them as text would
// put December before February, so they are turned into a comparable number
// and anything unrecognised is left at the end.
function dateKey(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(raw || '').trim());
  if (!m) return -1;
  const [, mm, dd, yy] = m;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  return year * 10000 + Number(mm) * 100 + Number(dd);
}

function summarise(visitor) {
  const visits = [...(visitor.visits || [])].sort((a, b) => dateKey(b.date) - dateKey(a.date));
  return {
    ...visitor,
    visits,
    count:   visits.length,
    last:    visits[0]?.date || '',
    first:   visits[visits.length - 1]?.date || '',
    lastKey: visits.length ? dateKey(visits[0].date) : -1,
  };
}

async function send(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

function jsonBody(body) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// A workflow's timestamps come back as SQLite writes them, "2026-09-13
// 14:02:11" in UTC. Shown as the same MM/DD/YY the visit dates use, so a date
// on this page always reads the same way.
function shortDate(raw) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw || '').trim());
  if (!match) return '';
  const [, year, month, day] = match;
  return `${Number(month)}/${Number(day)}/${year.slice(2)}`;
}

// Where a guest's follow-up has got to. Four states worth telling apart, and
// they are the order the board reads in: the ones needing somebody come first.
const STAGES = {
  waiting: {
    heading:  'Nobody has reached out',
    blurb:    'No follow-up has been started for these guests.',
    dot:      'bg-white ring-1 ring-inset ring-gray-300',
    tone:     '',
  },
  active: {
    heading:  'Someone is on it',
    blurb:    'A member has been asked to make contact. It closes when they do.',
    dot:      'bg-amber-500',
    tone:     'bg-amber-100 text-amber-800',
    label:    'Follow-up in progress',
  },
  unreached: {
    heading:  'Never reached',
    blurb:    'Somebody tried and could not get hold of them.',
    dot:      'bg-gray-400',
    tone:     'bg-gray-100 text-gray-600',
    label:    'Never reached',
  },
  reached: {
    heading:  'Reached',
    blurb:    'Somebody got hold of them, which closed the follow-up.',
    dot:      'bg-emerald-500',
    tone:     'bg-emerald-100 text-emerald-800',
    label:    'Reached',
  },
};

// The order the board shows them in: what needs doing, then what is under way,
// then what is settled.
const STAGE_ORDER = ['waiting', 'active', 'unreached', 'reached'];

function stageOf(guest) {
  if (guest.followUp?.active) return 'active';
  if (guest.last_contacted_at) return 'reached';
  if (guest.followUp?.lastDone?.outcome === 'no-contact') return 'unreached';
  return 'waiting';
}

// Who made contact, and how. The guest's own record is written when a
// follow-up closes, and the workflow that closed it says the same thing — this
// prefers the record, and falls back to the workflow for a guest reached
// before the record kept who did it.
function reachedBy(guest) {
  const method = guest.last_contact_method || guest.followUp?.lastDone?.method || '';
  return {
    who:  guest.last_contacted_by || guest.followUp?.lastDone?.by || '',
    how:  method === 'phone' ? 'Phoned' : method === 'email' ? 'Emailed' : 'Reached',
    when: shortDate(guest.last_contacted_at || guest.followUp?.lastDone?.at),
  };
}

// The badge's own words, which say more than the stage name where there is
// more to say: who reached them, and who is on it.
function badgeLabel(guest, stage) {
  if (stage === 'reached') {
    const { who, how } = reachedBy(guest);
    return who ? `${how} by ${who}` : how;
  }
  if (stage === 'active') {
    const asked = guest.followUp?.active?.assignedTo;
    return asked ? `${asked} is on it` : STAGES.active.label;
  }
  return STAGES[stage]?.label || '';
}

// Status colour never carries the meaning alone — the badge always says what
// it is in words, so it reads the same to somebody who cannot tell the two
// pale fills apart.
function FollowUpBadge({ guest }) {
  const stage = stageOf(guest);
  const label = badgeLabel(guest, stage);
  if (stage === 'waiting' || !label) return null;
  return <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STAGES[stage].tone}`}>{label}</span>;
}

// What somebody pressed, in words. The workflow records the action; this is
// the same thing said the way a person would.
const ACTION_WORDS = {
  emailed:     'Emailed them',
  phoned:      'Phoned them',
  'no-answer': 'No answer',
  decline:     'Could not do it',
  retry:       'Tried again',
  'give-up':   'Gave up',
  close:       'Closed it out',
};

// Every follow-up a guest has had, newest first: who was asked, what they did,
// and when. This is the answer to "who has been followed up, and by whom".
function FollowUpHistory({ history, limit }) {
  if (!history?.length) return null;
  const shown = limit ? history.slice(0, limit) : history;

  return (
    <ol className="space-y-2">
      {shown.map(round => {
        const asked = round.assignedTo ? `${round.assignedTo} asked to reach out` : 'Reached out';
        return (
          <li key={round.id} className="text-xs text-gray-600">
            <span className="text-gray-400">{shortDate(round.startedAt)}</span>
            {' · '}
            <span>{asked}</span>
            {round.startedBy && <span className="text-gray-400"> by {round.startedBy}</span>}
            {round.rounds.length > 0 && (
              <ul className="mt-0.5 ml-3 space-y-0.5 border-l border-gray-100 pl-2">
                {round.rounds.map((step, i) => (
                  <li key={i}>
                    {ACTION_WORDS[step.action] || step.action || 'Acted'}
                    {step.by && <span className="text-gray-400"> — {step.by}</span>}
                    {step.at && <span className="text-gray-400"> · {shortDate(step.at)}</span>}
                    {step.note && <span className="block text-gray-400 italic">“{step.note}”</span>}
                  </li>
                ))}
              </ul>
            )}
            {round.status === 'active' && <span className="text-amber-700"> — still open</span>}
          </li>
        );
      })}
      {limit && history.length > limit && (
        <li className="text-xs text-gray-400">and {history.length - limit} earlier</li>
      )}
    </ol>
  );
}

// The button that starts one for this guest, with them already chosen. It is
// the same workflow the page's own panel starts — only the guest is settled.
function FollowUpButton({ guest, user, onDone, className }) {
  if (!user || guest.followUp?.active) return null;
  return (
    <WorkflowDialogButton
      page="visitors"
      user={user}
      icon={false}
      label={guest.last_contacted_at ? 'Follow up again' : 'Follow up'}
      title={`Follow up with ${guest.name}`}
      prefill={{ visitorId: String(guest.id) }}
      startImmediately
      onClosed={onDone}
      className={className || 'text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors whitespace-nowrap'}
    />
  );
}

function Stat({ value, label, tone = 'text-church-navy' }) {
  return (
    <div className="card text-center py-4">
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

// What we know about a guest, beyond their name. Only what has been filled in
// is shown, so a guest we know little about does not render a wall of dashes.
const DETAIL_FIELDS = [
  { key: 'phone',      label: 'Phone' },
  { key: 'email',      label: 'Email' },
  { key: 'address',    label: 'Address' },
  { key: 'city',       label: 'City' },
  { key: 'state',      label: 'State' },
  { key: 'zip',        label: 'ZIP' },
  { key: 'invited_by', label: 'Invited by' },
  { key: 'status',     label: 'Follow-up' },
];

const BLANK = {
  name: '', phone: '', email: '', address: '', city: '', state: '', zip: '',
  invited_by: '', status: '', notes: '',
};

// ─── Adding or editing a guest ────────────────────────────────────────────────

function GuestForm({ guest, onClose, onSaved, onDeleted }) {
  const isNew = !guest?.id;
  const [form, setForm]   = useState(() => ({ ...BLANK, ...(guest || {}) }));
  const [visit, setVisit] = useState({ date: '', service: '' });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm(p => ({ ...p, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('A guest needs a name');
    setBusy(true); setError('');
    try {
      const body = { ...BLANK, ...form };
      delete body.id; delete body.visits; delete body.created_at; delete body.comments;
      if (isNew && visit.date.trim()) body.visit = visit;

      const json = await send(isNew ? API : `${API}/${guest.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        ...jsonBody(body),
      });
      onSaved(json.visitor);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${guest.name} and everything recorded about them?`)) return;
    setBusy(true);
    try {
      await send(`${API}/${guest.id}`, { method: 'DELETE' });
      onDeleted(guest.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';
  const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <Dialog title={isNew ? 'Add a guest' : `Edit ${guest.name}`} onClose={onClose} width="max-w-lg">
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={label}>Name <span className="text-red-400" aria-hidden="true">*</span></span>
          <input autoFocus required value={form.name} onChange={e => set('name', e.target.value)} className={field} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          {DETAIL_FIELDS.map(f => (
            <label key={f.key} className={f.key === 'address' ? 'block col-span-2' : 'block'}>
              <span className={label}>{f.label}</span>
              <input value={form[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} className={field} />
            </label>
          ))}
        </div>

        <label className="block">
          <span className={label}>Our notes</span>
          <textarea
            rows={3}
            value={form.notes ?? ''}
            onChange={e => set('notes', e.target.value)}
            placeholder="What was said, who spoke with them, anything worth remembering"
            className={field}
          />
          {guest?.comments?.trim() && (
            <span className="block text-xs text-gray-400 mt-1">
              The tracker&apos;s own comments are shown separately and are replaced by the next refresh,
              so anything worth keeping belongs here.
            </span>
          )}
        </label>

        {isNew && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>First visit</span>
              <input
                value={visit.date}
                placeholder="06/07/26"
                onChange={e => setVisit(v => ({ ...v, date: e.target.value }))}
                className={field}
              />
            </label>
            <label className="block">
              <span className={label}>Service</span>
              <input
                value={visit.service}
                placeholder="Sun AM"
                onChange={e => setVisit(v => ({ ...v, service: e.target.value }))}
                className={field}
              />
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          {!isNew ? (
            <button type="button" onClick={remove} disabled={busy}
              className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
              Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Saving…' : isNew ? 'Add guest' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

// ─── One guest, in full ───────────────────────────────────────────────────────

function GuestDetail({ guest, canManage, user, onClose, onChanged, onEdit, onFollowUpDone }) {
  const [visit, setVisit] = useState({ date: '', service: '' });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const known = DETAIL_FIELDS.filter(f => String(guest[f.key] || '').trim());

  async function addVisit(e) {
    e.preventDefault();
    if (!visit.date.trim()) return setError('A visit needs a date');
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/${guest.id}/visits`, { method: 'POST', ...jsonBody(visit) });
      setVisit({ date: '', service: '' });
      onChanged(json.visitor);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeVisit(visitId) {
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/${guest.id}/visits/${visitId}`, { method: 'DELETE' });
      onChanged(json.visitor);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={guest.name}
      subtitle={`${guest.count} visit${guest.count === 1 ? '' : 's'} on record`}
      onClose={onClose}
      width="max-w-lg"
    >
      <div className="space-y-5">
        {/* Follow-up: where it has got to, and how to reach them */}
        <section className="rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-church-navy">Follow-up</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                {guest.followUp?.active
                  ? 'Somebody has been asked to reach out. It closes when they do.'
                  : guest.last_contacted_at
                    ? `Last reached ${guest.last_contact_method === 'phone' ? 'by phone' : 'by email'}` +
                      `${guest.last_contacted_by ? ` by ${guest.last_contacted_by}` : ''}.`
                    : 'Nobody has been asked to reach out yet.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <FollowUpBadge guest={guest} />
              <FollowUpButton
                guest={guest}
                user={user}
                onDone={onFollowUpDone}
                className="text-xs px-3 py-1.5 rounded-lg border border-church-navy text-church-navy hover:bg-church-navy hover:text-white transition-colors font-medium"
              />
            </div>
          </div>

          {/* Who has reached out before, and who actually got hold of them.
              The same reading the follow-ups board shows on the card. */}
          {guest.followUp?.history?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Follow-ups on record
              </h5>
              <FollowUpHistory history={guest.followUp.history} />
            </div>
          )}

          {/* Reaching them is the point of the follow-up, so the two ways of
              doing it are here rather than buried in the details below. */}
          {(guest.phone || guest.email) && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {guest.phone && (
                <a href={`tel:${guest.phone.replace(/[^0-9+]/g, '')}`}
                   className="text-xs px-2.5 py-1 rounded-lg bg-church-cream text-church-navy hover:bg-church-gold/20 transition-colors">
                  Call {guest.phone}
                </a>
              )}
              {guest.email && (
                <a href={`mailto:${guest.email}`}
                   className="text-xs px-2.5 py-1 rounded-lg bg-church-cream text-church-navy hover:bg-church-gold/20 transition-colors">
                  Email {guest.email}
                </a>
              )}
            </div>
          )}
        </section>

        {/* Details */}
        <section>
          <h4 className="text-sm font-semibold text-church-navy mb-2">Details</h4>
          {known.length > 0 ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {known.map(f => (
                <div key={f.key} className={f.key === 'address' ? 'col-span-2' : ''}>
                  <dt className="text-xs text-gray-400 uppercase tracking-wide">{f.label}</dt>
                  <dd className="text-gray-700">{guest[f.key]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-gray-400">
              Nothing beyond their name yet.{canManage && ' Choose Edit to fill in how to reach them.'}
            </p>
          )}
        </section>

        {/* What the church site's tracker recorded, which a re-scrape replaces */}
        {guest.comments?.trim() && (
          <section>
            <h4 className="text-sm font-semibold text-church-navy mb-1">Comments from the tracker</h4>
            <p className="text-sm text-gray-700 whitespace-pre-line">{guest.comments}</p>
            <p className="text-xs text-gray-400 mt-1">
              From capshawchurch.org. Refreshing the site replaces this; notes added here are kept.
            </p>
          </section>
        )}

        {/* What we have added ourselves, which nothing overwrites */}
        {guest.notes?.trim() && (
          <section>
            <h4 className="text-sm font-semibold text-church-navy mb-1">Our notes</h4>
            <p className="text-sm text-gray-700 whitespace-pre-line">{guest.notes}</p>
          </section>
        )}

        {/* Visits */}
        <section>
          <h4 className="text-sm font-semibold text-church-navy mb-2">Visit history</h4>
          {guest.visits.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2">Service</th>
                  {canManage && <th className="py-2 w-10" />}
                </tr>
              </thead>
              <tbody>
                {guest.visits.map(v => (
                  <tr key={v.id ?? `${v.date}-${v.service}`} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{v.date}</td>
                    <td className="py-2">{v.service}</td>
                    {canManage && (
                      <td className="py-2 text-right">
                        <button
                          onClick={() => removeVisit(v.id)}
                          disabled={busy}
                          aria-label={`Remove the visit on ${v.date}`}
                          className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400">No visits recorded yet.</p>
          )}

          {canManage && (
            <form onSubmit={addVisit} className="flex items-end gap-2 mt-3 flex-wrap">
              <label className="block">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date</span>
                <input
                  value={visit.date}
                  placeholder="06/07/26"
                  onChange={e => setVisit(v => ({ ...v, date: e.target.value }))}
                  className="mt-1 block w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Service</span>
                <input
                  value={visit.service}
                  placeholder="Sun AM"
                  onChange={e => setVisit(v => ({ ...v, service: e.target.value }))}
                  className="mt-1 block w-36 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
                />
              </label>
              <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">Record a visit</button>
            </form>
          )}
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {canManage && (
          <div className="flex justify-end">
            <button onClick={onEdit} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold hover:text-church-navy transition-colors">
              Edit details
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ─── Follow-ups, as a board ───────────────────────────────────────────────────
//
// The same guests as the list, arranged by where their follow-up has got to
// rather than alphabetically, because the question this answers is "who still
// needs somebody" and not "is Pat on here". Each card carries what the list
// row carries, and opens the same guest, so nothing is only available in one
// of the two views.

function FollowUpCard({ guest, user, onOpen, onFollowUpDone }) {
  const stage   = stageOf(guest);
  const reached = reachedBy(guest);
  const contact = [guest.phone, guest.email, guest.city].filter(Boolean).join(' · ');

  return (
    <div className="card hover:border-church-gold transition-colors flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => onOpen(guest.id)}
          className="font-medium text-church-navy hover:text-church-gold transition-colors text-left"
        >
          {guest.name}
        </button>
        <FollowUpBadge guest={guest} />
      </div>

      <p className="text-xs text-gray-500">
        {guest.count} visit{guest.count === 1 ? '' : 's'}
        {guest.last && ` · last with us ${guest.last}`}
      </p>

      {/* Who, which is the point of this view */}
      <p className="text-xs text-gray-600">
        {stage === 'reached' && (reached.who
          ? <>Reached by <span className="font-medium text-church-navy">{reached.who}</span>{reached.when && ` on ${reached.when}`}</>
          : <>Reached{reached.when && ` on ${reached.when}`}</>)}
        {stage === 'active' && (guest.followUp.active.assignedTo
          ? <>Waiting on <span className="font-medium text-church-navy">{guest.followUp.active.assignedTo}</span>
            {guest.followUp.active.since && ` since ${shortDate(guest.followUp.active.since)}`}</>
          : 'Somebody has been asked to reach out')}
        {stage === 'unreached' && 'Tried, nobody got hold of them'}
        {stage === 'waiting' && 'Nobody has been asked to reach out yet'}
      </p>

      {contact && <p className="text-xs text-gray-400">{contact}</p>}

      {guest.followUp?.history?.length > 0 && (
        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-church-navy list-none">
            {guest.followUp.history.length} follow-up{guest.followUp.history.length === 1 ? '' : 's'} on record
            <span className="ml-1 group-open:hidden">▸</span>
            <span className="ml-1 hidden group-open:inline">▾</span>
          </summary>
          <div className="mt-2 pt-2 border-t border-gray-100">
            <FollowUpHistory history={guest.followUp.history} limit={3} />
          </div>
        </details>
      )}

      <div className="flex items-center gap-2 flex-wrap mt-auto pt-1">
        <FollowUpButton guest={guest} user={user} onDone={onFollowUpDone} />
        {guest.phone && (
          <a href={`tel:${guest.phone.replace(/[^0-9+]/g, '')}`}
             className="text-xs px-2.5 py-1 rounded-lg bg-church-cream text-church-navy hover:bg-church-gold/20 transition-colors">
            Call
          </a>
        )}
        {guest.email && (
          <a href={`mailto:${guest.email}`}
             className="text-xs px-2.5 py-1 rounded-lg bg-church-cream text-church-navy hover:bg-church-gold/20 transition-colors">
            Email
          </a>
        )}
        <button
          onClick={() => onOpen(guest.id)}
          className="text-xs text-gray-400 hover:text-church-navy transition-colors ml-auto"
        >
          Details
        </button>
      </div>
    </div>
  );
}

function FollowUpBoard({ guests, user, onOpen, onFollowUpDone }) {
  const byStage = useMemo(() => {
    const groups = Object.fromEntries(STAGE_ORDER.map(id => [id, []]));
    for (const guest of guests) groups[stageOf(guest)].push(guest);
    return groups;
  }, [guests]);

  if (!guests.length) {
    return <p className="card text-center text-gray-400 text-sm py-8">No guests match your search.</p>;
  }

  return (
    <div className="space-y-6">
      {/* A count per state, so the shape of the work is legible before any
          card is read. Each says what it is in words beside its colour. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STAGE_ORDER.map(id => (
          <div key={id} className="card py-3">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STAGES[id].dot}`} aria-hidden="true" />
              <p className="text-2xl font-bold text-church-navy tabular-nums">{byStage[id].length}</p>
            </div>
            <p className="text-xs text-gray-500 mt-1">{STAGES[id].heading}</p>
          </div>
        ))}
      </div>

      {STAGE_ORDER.map(id => (
        byStage[id].length > 0 && (
          <section key={id}>
            <div className="flex items-baseline gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STAGES[id].dot}`} aria-hidden="true" />
              <h3 className="text-sm font-semibold text-church-navy">{STAGES[id].heading}</h3>
              <span className="text-xs text-gray-400">{byStage[id].length}</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">{STAGES[id].blurb}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {byStage[id].map(guest => (
                <FollowUpCard
                  key={guest.id}
                  guest={guest}
                  user={user}
                  onOpen={onOpen}
                  onFollowUpDone={onFollowUpDone}
                />
              ))}
            </div>
          </section>
        )
      ))}
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function VisitorTracker({ user }) {
  const [guests, setGuests]   = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [openId, setOpenId]   = useState(null);
  const [view, setView]       = useState('guests');   // guests | follow-ups
  // Seven columns of guest details do not fit a phone, so it gets a card each.
  const onPhone = useIsNarrow();
  const [editing, setEditing] = useState(null);   // a guest, or {} for a new one

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await send(API);
      setGuests(json.visitors.map(summarise));
      setCanManage(json.canManage);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Most recently with us first — who was here on Sunday is the question this
  // page gets asked, and a guest with no visits on record sits at the end
  // rather than the top. Names break a tie, so the order is stable.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return guests
      .filter(g =>
        !q ||
        g.name.toLowerCase().includes(q) ||
        DETAIL_FIELDS.some(f => String(g[f.key] || '').toLowerCase().includes(q)) ||
        String(g.comments || '').toLowerCase().includes(q) ||
        String(g.notes || '').toLowerCase().includes(q)
      )
      .sort((a, b) => (b.lastKey - a.lastKey) || a.name.localeCompare(b.name));
  }, [guests, search]);

  // How many guests nobody has reached out to yet, which is the number worth
  // carrying on the tab: it is work waiting rather than work done.
  const awaiting    = guests.filter(g => stageOf(g) === 'waiting').length;
  const totalVisits = filtered.reduce((s, g) => s + g.count, 0);
  const returning   = filtered.filter(g => g.count > 1).length;
  const mostRecent  = filtered.reduce((best, g) => (g.lastKey > (best?.lastKey ?? -1) ? g : best), null);

  const open = guests.find(g => g.id === openId) || null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  if (error) {
    return <div className="card text-center py-10 text-red-600 text-sm">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <h2 className="section-heading mb-0">Our Guests</h2>
        {canManage && (
          <button onClick={() => setEditing({})} className="btn-primary text-sm">Add a guest</button>
        )}
      </div>

      {/* The same guests, two ways of reading them */}
      <div role="tablist" aria-label="How to read the guests" className="flex items-center gap-1 border-b border-gray-200">
        {[['guests', 'Guests'], ['follow-ups', 'Follow-ups']].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            id={`guests-tab-${id}`}
            aria-selected={view === id}
            aria-controls={`guests-panel-${id}`}
            onClick={() => setView(id)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
              view === id
                ? 'border-church-gold text-church-navy font-medium'
                : 'border-transparent text-gray-500 hover:text-church-navy'
            }`}
          >
            {label}
            {id === 'follow-ups' && awaiting > 0 && (
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 tabular-nums">
                {awaiting}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Stats */}
      {view === 'guests' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat value={filtered.length} label={filtered.length === 1 ? 'Guest' : 'Guests'} />
          <Stat value={totalVisits} label="Visits recorded" tone="text-green-600" />
          <Stat value={returning} label="Came back" tone="text-church-gold" />
          <Stat value={mostRecent?.last || '—'} label="Most recent visit" tone="text-gray-400" />
        </div>
      )}

      {/* Search */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search guests…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy w-64"
        />
        <span className="text-xs text-gray-400">{filtered.length} guest{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {view === 'follow-ups' ? (
      <div role="tabpanel" id="guests-panel-follow-ups" aria-labelledby="guests-tab-follow-ups">
        <FollowUpBoard
          guests={filtered}
          user={user}
          onOpen={setOpenId}
          onFollowUpDone={load}
        />
      </div>
      ) : (
      <div role="tabpanel" id="guests-panel-guests" aria-labelledby="guests-tab-guests">
      {/* Phones: a card each, since a seven-column table is unreadable there. */}
      {onPhone ? (
      <div className="space-y-2">
        {filtered.map(g => (
          <button
            key={g.id}
            onClick={() => setOpenId(g.id)}
            className="card w-full text-left hover:border-church-gold transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-church-navy">{g.name}</span>
              <span className="text-xs text-gray-400 whitespace-nowrap">{g.count} visit{g.count === 1 ? '' : 's'}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {[g.phone, g.email, g.city].filter(Boolean).join(' · ') || 'No contact details yet'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {g.last ? `Last with us ${g.last}` : 'No visits recorded'}
              {g.invited_by ? ` · invited by ${g.invited_by}` : ''}
            </p>
            <span className="inline-block mt-1.5"><FollowUpBadge guest={g} /></span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="card text-center text-gray-400 text-sm py-8">No guests match your search.</p>
        )}
      </div>
      ) : (
      /* Tablets up: the full table, names and details together. */
      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="bg-church-navy text-left text-xs text-gray-300 uppercase tracking-wide">
              <th className="px-4 py-3">Guest</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Invited by</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Visits</th>
              <th className="px-4 py-3 whitespace-nowrap">First visit</th>
              <th className="px-4 py-3 whitespace-nowrap">Last visit</th>
              <th className="px-4 py-3 w-28">Follow-up</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g, i) => (
              <tr
                key={g.id}
                onClick={() => setOpenId(g.id)}
                className={`cursor-pointer hover:bg-blue-50/60 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
              >
                <td className="px-4 py-2">
                  <button
                    onClick={e => { e.stopPropagation(); setOpenId(g.id); }}
                    className="font-medium text-church-navy hover:text-church-gold transition-colors text-left"
                  >
                    {g.name}
                  </button>
                  {g.status && <span className="block text-xs text-gray-400">{g.status}</span>}
                  <span className="block mt-1"><FollowUpBadge guest={g} /></span>
                </td>
                <td className="px-4 py-2 text-gray-500">
                  {[g.phone, g.email].filter(Boolean).join(' · ') || <span className="text-gray-300">—</span>}
                  {(g.city || g.state) && (
                    <span className="block text-xs text-gray-400">{[g.city, g.state].filter(Boolean).join(', ')}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-500">{g.invited_by || <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2 text-right font-semibold text-church-navy">{g.count}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{g.first || '—'}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{g.last || '—'}</td>
                <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                  {g.followUp?.active
                    ? <span className="text-xs text-amber-700">In progress</span>
                    : <FollowUpButton guest={g} user={user} onDone={load} />}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  {guests.length ? 'No guests match your search.' : 'No guests recorded yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      </div>
      )}

      {open && !editing && (
        <GuestDetail
          guest={open}
          canManage={canManage}
          user={user}
          onFollowUpDone={load}
          onClose={() => setOpenId(null)}
          onChanged={updated => setGuests(prev => prev.map(g => (g.id === updated.id ? summarise(updated) : g)))}
          onEdit={() => setEditing(open)}
        />
      )}

      {editing && (
        <GuestForm
          guest={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onDeleted={() => { setEditing(null); setOpenId(null); load(); }}
        />
      )}
    </div>
  );
}
