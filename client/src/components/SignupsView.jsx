import { useState, useEffect, useCallback } from 'react';
import Dialog from './Dialog';
import DateInput, { FIELD_CLASS } from './DateInput';

// ─── Sign-ups ─────────────────────────────────────────────────────────────────
//
// Anything the church needs people for — a fellowship meal, a meal train, a
// work day. Any member makes a sign-up: one date with several things needed,
// or the same sign-up over several dates; set items with how many are needed,
// free sign-ups where people write what they will bring, or both. Whoever
// made it keeps it and can email about it; the Sign-Up Manager keeps every
// one and sees the analytics. Each sign-up has its own permanent link,
// /?page=signups&list=<id>. The server decides who may do what; the flags it
// sends back only say which buttons to draw.

const API = '/api/signups';

async function send(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

const day = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) =>
  (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts) : '');
const longDay = iso => day(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const clock = t => {
  if (!/^\d{1,2}:\d{2}$/.test(t || '')) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const listLink = id => `${window.location.origin}/?page=signups&list=${id}`;

function CopyLink({ id }) {
  const [state, setState] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(listLink(id)); setState('copied'); setTimeout(() => setState(''), 2500); }
    catch { setState('shown'); }
  }
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <button type="button" onClick={copy} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:border-church-navy">
        {state === 'copied' ? 'Link copied' : 'Copy link'}
      </button>
      {state === 'shown' && <input readOnly value={listLink(id)} onFocus={e => e.target.select()} aria-label="Link to this sign-up" className="text-xs border border-gray-200 rounded px-2 py-1 w-64" />}
    </span>
  );
}

// ─── Making or changing a sign-up ─────────────────────────────────────────────

const blankDate = () => ({ date: '', time: '', note: '' });
const blankItem = () => ({ label: '', needed: '' });

function SignupForm({ list = null, onCancel, onSaved }) {
  const [title, setTitle] = useState(list?.title || '');
  const [description, setDescription] = useState(list?.description || '');
  const [kind, setKind] = useState(list?.kind || 'one-date');
  const [dates, setDates] = useState(list ? list.dates.map(d => ({ id: d.id, date: d.date, time: d.time, note: d.note })) : [blankDate()]);
  const [items, setItems] = useState(list ? list.items.map(i => ({ id: i.id, label: i.label, needed: i.needed ?? '' })) : [blankItem()]);
  const [allowFree, setAllowFree] = useState(list?.allowFree || false);
  const [freeLabel, setFreeLabel] = useState(list?.freeLabel || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setAt = (setter, i, patch) => setter(rows => rows.map((r, at) => (at === i ? { ...r, ...patch } : r)));
  const shownDates = kind === 'one-date' ? dates.slice(0, 1) : dates;

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = JSON.stringify({ title, description, kind, dates: shownDates, items, allowFree, freeLabel });
      const json = list
        ? await send(`${API}/${list.id}`, { method: 'PUT', body })
        : await send(API, { method: 'POST', body });
      onSaved(json.list);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const label = 'block text-xs font-medium text-gray-500 uppercase tracking-wide';
  const small = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-church-gold';

  return (
    <form onSubmit={save} className="card space-y-5" aria-label={list ? 'Change this sign-up' : 'New sign-up'}>
      <h3 className="section-heading mb-0">{list ? 'Change this sign-up' : 'New sign-up'}</h3>

      <label className="block">
        <span className={label}>Title</span>
        <input required value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Fellowship meal" className={FIELD_CLASS} />
      </label>
      <label className="block">
        <span className={label}>Description</span>
        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000}
          placeholder="What it is for, where, and anything people should know" className={FIELD_CLASS} />
      </label>

      <fieldset className="border-0 p-0 m-0 space-y-2">
        <legend className={`${label} mb-1`}>When</legend>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" checked={kind === 'one-date'} onChange={() => setKind('one-date')} className="accent-church-gold" />
            One date — everything happens that day
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" checked={kind === 'multi-date'} onChange={() => setKind('multi-date')} className="accent-church-gold" />
            Several dates — the same sign-up each day
          </label>
        </div>
        <ul className="space-y-2" aria-label="Dates">
          {shownDates.map((d, i) => (
            <li key={d.id ?? `new-${i}`} className="flex items-center gap-2 flex-wrap">
              <span className="w-40"><DateInput required value={d.date} onChange={v => setAt(setDates, i, { date: v })} aria-label={`Date ${i + 1}`} className={small} /></span>
              <input type="time" value={d.time} onChange={e => setAt(setDates, i, { time: e.target.value })} aria-label={`Time ${i + 1}`} className={small} />
              <input value={d.note} onChange={e => setAt(setDates, i, { note: e.target.value })} aria-label={`Note for date ${i + 1}`} placeholder="Note (optional)" className={`${small} flex-1 min-w-[10rem]`} />
              {kind === 'multi-date' && dates.length > 1 && (
                <button type="button" onClick={() => setDates(rows => rows.filter((_, at) => at !== i))} aria-label={`Remove date ${i + 1}`} className="text-gray-400 hover:text-red-600 px-1">×</button>
              )}
            </li>
          ))}
        </ul>
        {kind === 'multi-date' && (
          <button type="button" onClick={() => setDates(rows => [...rows, blankDate()])} className="text-xs text-church-gold hover:text-church-navy">+ Add a date</button>
        )}
      </fieldset>

      <fieldset className="border-0 p-0 m-0 space-y-2">
        <legend className={`${label} mb-1`}>What is needed</legend>
        <ul className="space-y-2" aria-label="What is needed">
          {items.map((it, i) => (
            <li key={it.id ?? `new-${i}`} className="flex items-center gap-2">
              <input value={it.label} onChange={e => setAt(setItems, i, { label: e.target.value })} aria-label={`Item ${i + 1}`} placeholder="Main dish" maxLength={80} className={`${small} flex-1`} />
              <input type="number" min="1" max="500" value={it.needed} onChange={e => setAt(setItems, i, { needed: e.target.value })}
                aria-label={`How many for item ${i + 1}`} placeholder="Any" title="How many are needed — blank for as many as like" className={`${small} w-20`} />
              <button type="button" onClick={() => setItems(rows => rows.filter((_, at) => at !== i))} aria-label={`Remove item ${i + 1}`} className="text-gray-400 hover:text-red-600 px-1">×</button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setItems(rows => [...rows, blankItem()])} className="text-xs text-church-gold hover:text-church-navy">+ Add something that is needed</button>
        <p className="text-xs text-gray-500">How many of each{kind === 'multi-date' ? ', on each date' : ''}. Leave the number blank for as many as like.</p>
        <label className="flex items-start gap-2 text-sm text-gray-700 pt-1">
          <input type="checkbox" checked={allowFree} onChange={e => setAllowFree(e.target.checked)} className="accent-church-gold mt-0.5" />
          <span>Allow free sign-ups — people write what they will bring or do</span>
        </label>
        {allowFree && (
          <input value={freeLabel} onChange={e => setFreeLabel(e.target.value)} aria-label="What to call free sign-ups" maxLength={80}
            placeholder="Anything else you would like to bring or do" className={`${small} w-full`} />
        )}
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
        <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">{busy ? 'Saving…' : list ? 'Save changes' : 'Make the sign-up'}</button>
      </div>
    </form>
  );
}

// ─── Emailing about a sign-up ─────────────────────────────────────────────────

function EmailDialog({ list, groups, onClose, onSent }) {
  const [to, setTo] = useState('signed-up');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const body = () => JSON.stringify({ to, subject, message });

  async function look() {
    setBusy(true); setError('');
    try { setPreview(await send(`${API}/${list.id}/email/preview`, { method: 'POST', body: body() })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function sendIt() {
    setBusy(true); setError('');
    try { onSent(await send(`${API}/${list.id}/email`, { method: 'POST', body: body() })); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  const label = 'block text-xs font-medium text-gray-500 uppercase tracking-wide';

  return (
    <Dialog title="Email about this sign-up" subtitle={list.title} onClose={onClose} width="max-w-2xl">
      <div className="space-y-3">
        <label className="block">
          <span className={label}>To</span>
          <select value={to} onChange={e => { setTo(e.target.value); setPreview(null); }} className={FIELD_CLASS}>
            <option value="signed-up">Everyone signed up</option>
            {groups.map(g => <option key={g.key} value={g.key}>{g.name} (email group)</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Subject</span>
          <input value={subject} onChange={e => { setSubject(e.target.value); setPreview(null); }} placeholder={`Sign up: ${list.title}`} maxLength={150} className={FIELD_CLASS} />
        </label>
        <label className="block">
          <span className={label}>Your message</span>
          <textarea rows={4} value={message} onChange={e => { setMessage(e.target.value); setPreview(null); }} maxLength={5000}
            placeholder="A few words of your own — the sign-up's details and link are added underneath." className={FIELD_CLASS} />
        </label>
        {preview && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3" aria-label="Preview">
            <p className="text-xs text-gray-500 mb-1">
              To {preview.audience} — {preview.count} {preview.count === 1 ? 'person' : 'people'}
              {preview.missing.length ? ` · no email address for ${preview.missing.join(', ')}` : ''}
            </p>
            <p className="text-sm font-semibold text-church-navy">{preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-700 font-sans">{preview.body}</pre>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
          {!preview
            ? <button type="button" onClick={look} disabled={busy} className="btn-primary text-sm disabled:opacity-50">Preview</button>
            : <button type="button" onClick={sendIt} disabled={busy || !message.trim()} className="btn-primary text-sm disabled:opacity-50">{busy ? 'Sending…' : 'Send'}</button>}
        </div>
      </div>
    </Dialog>
  );
}

// ─── One sign-up ──────────────────────────────────────────────────────────────

function Slot({ list, date, label, slot, free = false, onChanged }) {
  const [note, setNote] = useState('');
  const [onBehalf, setOnBehalf] = useState(null);   // null, or the name being typed
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const entries = free ? date.free : slot.entries;
  const mine = entries.some(e => e.mine);
  const open = !list.closed && !date.past && (free || !slot.full);

  async function add(name) {
    setBusy(true); setError('');
    try {
      const json = await send(`${API}/${list.id}/entries`, { method: 'POST', body: JSON.stringify({ dateId: date.id, itemId: free ? null : slot.itemId, note, name }) });
      setNote(''); setOnBehalf(null);
      onChanged(json.list);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function takeOff(entry) {
    if (!window.confirm(entry.mine ? 'Take your name off?' : `Take ${entry.name} off?`)) return;
    try { onChanged((await send(`${API}/entries/${entry.id}`, { method: 'DELETE' })).list); }
    catch (err) { setError(err.message); }
  }

  return (
    <li className="py-2 border-t border-gray-100 first:border-t-0" aria-label={`${label}, ${day(date.date)}`}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="font-medium text-church-navy">{label}</span>
        {!free && (
          <span className={`text-xs ${slot.full ? 'text-emerald-700' : 'text-gray-500'}`}>
            {slot.needed === null ? `${slot.taken} signed up` : slot.full ? `Filled · ${slot.taken} of ${slot.needed}` : `${slot.taken} of ${slot.needed} · ${slot.needed - slot.taken} still needed`}
          </span>
        )}
      </div>
      {entries.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {entries.map(e => (
            <li key={e.id} className={`text-xs px-2 py-1 rounded-full border ${e.mine ? 'border-church-gold bg-church-cream' : 'border-gray-200 bg-white'}`}>
              {e.name}{e.note ? ` — ${e.note}` : ''}{e.mine ? ' (you)' : ''}
              {e.canRemove && !date.past && (
                <button type="button" onClick={() => takeOff(e)} aria-label={e.mine ? 'Take my name off' : `Take ${e.name} off`} className="ml-1 text-gray-400 hover:text-red-600">×</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {free && (
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="What will you bring or do?" maxLength={200}
              aria-label={`What you will bring, ${day(date.date)}`} className="border border-gray-200 rounded-lg px-2 py-1 text-sm flex-1 min-w-[12rem]" />
          )}
          {(free || !mine) && (
            <button type="button" disabled={busy || (free && !note.trim())} onClick={() => add('')} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50"
              aria-label={`Sign up for ${label}, ${day(date.date)}`}>Sign up</button>
          )}
          {list.canEdit && onBehalf === null && (
            <button type="button" onClick={() => setOnBehalf('')} className="text-xs text-church-gold hover:text-church-navy underline">Put someone down</button>
          )}
          {list.canEdit && onBehalf !== null && (
            <span className="flex items-center gap-1.5">
              <input value={onBehalf} onChange={e => setOnBehalf(e.target.value)} autoFocus placeholder="Their name" aria-label={`Name to put down for ${label}`}
                className="border border-gray-200 rounded-lg px-2 py-1 text-sm w-40" />
              <button type="button" disabled={busy || !onBehalf.trim() || (free && !note.trim())} onClick={() => add(onBehalf)} className="text-xs px-2 py-1 rounded-lg border border-church-navy text-church-navy disabled:opacity-40">Add</button>
              <button type="button" onClick={() => setOnBehalf(null)} className="text-xs text-gray-500 underline">Cancel</button>
            </span>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </li>
  );
}

function SignupDetail({ id, onBack, onEdit, onDeleted }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [emailing, setEmailing] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => send(`${API}/${id}`).then(setData).catch(e => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error && !data) {
    return (
      <div className="card text-sm space-y-2">
        <p className="text-red-600">{error}</p>
        <button type="button" onClick={onBack} className="text-church-gold underline">Back to all sign-ups</button>
      </div>
    );
  }
  if (!data) return <div className="card text-sm text-gray-400">Loading…</div>;

  const { list, emailGroups } = data;
  const setList = next => setData(d => ({ ...d, list: next }));

  async function toggleClosed() {
    try { setList((await send(`${API}/${list.id}/close`, { method: 'POST', body: JSON.stringify({ closed: !list.closed }) })).list); }
    catch (err) { setError(err.message); }
  }
  async function remove() {
    if (!window.confirm(`Delete “${list.title}”${list.totals.entries ? ` and its ${list.totals.entries} name${list.totals.entries === 1 ? '' : 's'}` : ''}? This cannot be undone.`)) return;
    try { await send(`${API}/${list.id}`, { method: 'DELETE' }); onDeleted(); }
    catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm text-church-gold hover:text-church-navy">← All sign-ups</button>
      <section className="card space-y-3" aria-label={list.title}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-church-navy">{list.title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {list.createdBy ? `Made by ${list.createdBy}` : ''}
              {list.closed && <span className="ml-2 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Closed</span>}
              {list.past && !list.closed && <span className="ml-2 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Past</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CopyLink id={list.id} />
            {list.canEdit && (
              <>
                <button type="button" onClick={() => setEmailing(true)} className="text-sm px-3 py-1.5 rounded-lg border border-church-navy text-church-navy hover:bg-church-navy hover:text-white">Email</button>
                <button type="button" onClick={() => onEdit(list)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700">Edit</button>
                <button type="button" onClick={toggleClosed} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700">{list.closed ? 'Reopen' : 'Close'}</button>
                <button type="button" onClick={remove} className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Delete</button>
              </>
            )}
          </div>
        </div>
        {list.description && <p className="text-sm text-gray-700 whitespace-pre-line">{list.description}</p>}
        {list.totals.needed > 0 && (
          <p className="text-sm text-gray-600">{list.totals.filled} of {list.totals.needed} filled{list.totals.needed > list.totals.filled ? ` · ${list.totals.needed - list.totals.filled} still needed` : ''}</p>
        )}
        {notice && <p className="text-xs px-3 py-1.5 rounded-lg bg-green-50 text-green-700">{notice}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      <div className={`grid gap-3 ${list.dates.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {list.dates.map(d => (
          <section key={d.id} className={`card ${d.past ? 'opacity-70' : ''}`} aria-label={longDay(d.date)}>
            <h4 className="font-semibold text-church-navy">{longDay(d.date)}{clock(d.time) ? ` · ${clock(d.time)}` : ''}</h4>
            {d.note && <p className="text-xs text-gray-500">{d.note}</p>}
            <ul className="mt-1">
              {d.items.map(slot => (
                <Slot key={slot.itemId} list={list} date={d} slot={slot} label={list.items.find(i => i.id === slot.itemId)?.label || ''} onChanged={setList} />
              ))}
              {list.allowFree && <Slot list={list} date={d} free label={list.freeLabel || 'Anything else you would like to bring or do'} onChanged={setList} />}
            </ul>
          </section>
        ))}
      </div>

      {emailing && (
        <EmailDialog list={list} groups={emailGroups} onClose={() => setEmailing(false)}
          onSent={json => { setEmailing(false); setNotice(`Emailed ${json.sent} ${json.sent === 1 ? 'person' : 'people'}.${json.missing.length ? ` No email address for ${json.missing.join(', ')}.` : ''}`); }} />
      )}
    </div>
  );
}

// ─── Analytics, for the Sign-Up Manager ───────────────────────────────────────

function Tile({ value, label }) {
  return (
    <div className="card text-center py-4">
      <p className="text-2xl font-bold text-church-navy">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function Analytics({ onOpen, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { send(`${API}/analytics`).then(setData).catch(e => setError(e.message)); }, []);
  if (error) return <div className="card text-sm text-red-600">{error}</div>;
  if (!data) return <div className="card text-sm text-gray-400">Loading…</div>;
  const { totals, topPeople, byMonth, short, byCreator } = data;
  const maxMonth = Math.max(1, ...byMonth.map(m => m.count));
  const month = ym => new Date(`${ym}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

  return (
    <div className="space-y-4" aria-label="Sign-up analytics">
      <button type="button" onClick={onBack} className="text-sm text-church-gold hover:text-church-navy">← All sign-ups</button>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Tile value={totals.lists} label="Sign-ups" />
        <Tile value={totals.open} label="Coming up" />
        <Tile value={totals.entries} label="Names" />
        <Tile value={totals.people} label="People" />
        <Tile value={totals.fillRate === null ? '—' : `${totals.fillRate}%`} label="Filled" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card" aria-label="Still short">
          <h3 className="section-heading mb-2">Coming up and still short</h3>
          {short.length === 0 ? <p className="text-sm text-gray-500">Every sign-up coming up has what it asked for.</p> : (
            <ul className="divide-y divide-gray-50">
              {short.map(s => (
                <li key={s.id} className="py-1.5 flex items-center justify-between gap-2 text-sm">
                  <button type="button" onClick={() => onOpen(s.id)} className="text-church-navy hover:underline text-left">{s.title}</button>
                  <span className="text-xs text-amber-700 shrink-0">{day(s.first)} · {s.missing} of {s.needed} still needed</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-label="Who signs up most">
          <h3 className="section-heading mb-2">Who signs up most</h3>
          {topPeople.length === 0 ? <p className="text-sm text-gray-500">Nobody has signed up yet.</p> : (
            <ul className="divide-y divide-gray-50">
              {topPeople.map(p => (
                <li key={p.name} className="py-1.5 flex items-center justify-between text-sm">
                  <span className="text-church-navy">{p.name}</span>
                  <span className="text-xs text-gray-500">{p.count} time{p.count === 1 ? '' : 's'} · {p.lists} sign-up{p.lists === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-label="By month">
          <h3 className="section-heading mb-2">Names by month</h3>
          {byMonth.length === 0 ? <p className="text-sm text-gray-500">Nothing yet.</p> : (
            <ul className="space-y-1.5">
              {byMonth.map(m => (
                <li key={m.month} className="flex items-center gap-2 text-sm">
                  <span className="w-14 text-xs text-gray-500">{month(m.month)}</span>
                  <span className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><span className="block h-2 bg-church-gold rounded-full" style={{ width: `${Math.round((m.count / maxMonth) * 100)}%` }} /></span>
                  <span className="w-8 text-right text-xs text-gray-600">{m.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-label="Who makes sign-ups">
          <h3 className="section-heading mb-2">Who makes sign-ups</h3>
          {byCreator.length === 0 ? <p className="text-sm text-gray-500">Nothing yet.</p> : (
            <ul className="divide-y divide-gray-50">
              {byCreator.map(c => (
                <li key={c.name} className="py-1.5 flex items-center justify-between text-sm">
                  <span className="text-church-navy">{c.name}</span>
                  <span className="text-xs text-gray-500">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

function ListRow({ s, onOpen }) {
  const when = s.first === s.last || !s.last ? day(s.first) : `${day(s.first)} – ${day(s.last)}`;
  return (
    <li>
      <button type="button" onClick={() => onOpen(s.id)} className="w-full text-left card p-4 hover:ring-1 hover:ring-church-gold">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="font-semibold text-church-navy">{s.title}</span>
          <span className="text-xs text-gray-500">{when}{s.dateCount > 1 ? ` · ${s.dateCount} dates` : ''}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3">
          {s.totals.needed > 0 && <span>{s.totals.filled} of {s.totals.needed} filled</span>}
          <span>{s.totals.entries} name{s.totals.entries === 1 ? '' : 's'}</span>
          {s.createdBy && <span>by {s.createdBy}</span>}
          {s.mine && <span className="text-church-gold font-medium">You are signed up</span>}
          {s.closed && <span>Closed</span>}
        </p>
      </button>
    </li>
  );
}

export default function SignupsView({ initialListId = null }) {
  const [view, setView] = useState(initialListId ? { list: initialListId } : { index: true });
  const [index, setIndex] = useState(null);
  const [error, setError] = useState('');

  const loadIndex = useCallback(() => send(API).then(setIndex).catch(e => setError(e.message)), []);
  useEffect(() => { if (view.index) loadIndex(); }, [view, loadIndex]);

  // The address bar always holds the link to what is showing, so it can be
  // copied, bookmarked, or opened again.
  useEffect(() => {
    const url = view.list ? `/?page=signups&list=${view.list}` : '/?page=signups';
    try { window.history.replaceState(null, '', url); } catch { /* not in a browser */ }
  }, [view]);
  // Leaving the page takes its link back out, so a reload does not return here.
  useEffect(() => () => {
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* not in a browser */ }
  }, []);

  const open = id => setView({ list: id });
  const toIndex = () => setView({ index: true });

  const header = (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h2 className="section-heading mb-1">Sign-Ups</h2>
        <p className="text-sm text-gray-500">Anything the church needs people for. Anybody can make a sign-up and send its link around.</p>
      </div>
      {view.index && (
        <div className="flex items-center gap-2">
          {index?.canManage && <button type="button" onClick={() => setView({ analytics: true })} className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700">Analytics</button>}
          <button type="button" onClick={() => setView({ form: true })} className="btn-primary text-sm">New sign-up</button>
        </div>
      )}
    </div>
  );

  let body;
  if (view.form) {
    body = <SignupForm list={view.editing || null} onCancel={() => (view.editing ? open(view.editing.id) : toIndex())} onSaved={list => open(list.id)} />;
  } else if (view.list) {
    body = <SignupDetail key={view.list} id={view.list} onBack={toIndex} onEdit={list => setView({ form: true, editing: list })} onDeleted={toIndex} />;
  } else if (view.analytics) {
    body = <Analytics onOpen={open} onBack={toIndex} />;
  } else if (error) {
    body = <div className="card text-sm text-red-600">{error}</div>;
  } else if (!index) {
    body = <div className="card text-sm text-gray-400">Loading…</div>;
  } else {
    const coming = index.lists.filter(l => !l.past && !l.closed);
    const done = index.lists.filter(l => l.past || l.closed);
    body = (
      <div className="space-y-5">
        <section aria-label="Coming up">
          <h3 className="text-sm font-semibold text-church-navy mb-2">Coming up</h3>
          {coming.length === 0
            ? <p className="card text-sm text-gray-500 text-center py-8">No sign-ups coming up. Choose New sign-up to make one.</p>
            : <ul className="grid gap-3 md:grid-cols-2">{coming.map(s => <ListRow key={s.id} s={s} onOpen={open} />)}</ul>}
        </section>
        {done.length > 0 && (
          <section aria-label="Past and closed">
            <h3 className="text-sm font-semibold text-gray-500 mb-2">Past and closed</h3>
            <ul className="grid gap-3 md:grid-cols-2 opacity-80">{done.map(s => <ListRow key={s.id} s={s} onOpen={open} />)}</ul>
          </section>
        )}
      </div>
    );
  }

  return <div className="space-y-4">{header}{body}</div>;
}
