import { useState, useEffect, useCallback, useMemo } from 'react';

const API = '/api/bulletin';

async function call(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

// ─── Weeks ────────────────────────────────────────────────────────────────────
//
// The whole screen is addressed by a Sunday. These match the server's own
// reckoning — UTC, so that a Sunday does not become a Saturday for anybody west
// of it — because the two have to agree on which week is being edited.

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sundayOf(iso) {
  return addDays(iso, -new Date(`${iso}T00:00:00Z`).getUTCDay());
}

function thisSunday() {
  return sundayOf(new Date().toISOString().slice(0, 10));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : '';
}

// The leadership arrives as bold/plain runs for the exports; the preview only
// needs the words.
const joinSegments = segs => (segs || []).map(s => s.text).join('');

// ─── The typed half ───────────────────────────────────────────────────────────

// Each of these is a list the congregation reads, typed one entry to a line.
// They are in the order the newsletter prints them so that working down the
// screen is working down the page.
const PRAYER_FIELDS = [
  { key: 'updates',     label: 'Updates',                hint: 'News since last week' },
  { key: 'ongoing',     label: 'Ongoing',                hint: 'One name or family per line' },
  { key: 'shut_ins',    label: 'Shut-Ins',               hint: '' },
  { key: 'pregnancies', label: 'Pregnancies',            hint: 'Name – month (boy/girl)' },
  { key: 'evangelists', label: 'Evangelists We Support', hint: 'Name – where they serve' },
];

function Field({ label, hint, value, onChange, rows = 4, disabled }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-church-navy">{label}</span>
      {hint && <span className="ml-2 text-xs text-gray-400">{hint}</span>}
      <textarea
        value={value}
        rows={rows}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-normal
                   focus:border-church-gold focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
      />
    </label>
  );
}

function Line({ label, hint, value, onChange, disabled, placeholder }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-church-navy">{label}</span>
      {hint && <span className="ml-2 text-xs text-gray-400">{hint}</span>}
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm
                   focus:border-church-gold focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
      />
    </label>
  );
}

// ─── What the portal already knows ────────────────────────────────────────────
//
// Shown rather than edited: these sections come from the pages that own them,
// so a wrong reminder is fixed on the announcement board and not here. Saying
// where each one comes from is what stops somebody retyping it.

function AutoSection({ title, source, items, empty }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-church-navy">{title}</h4>
        <span className="text-xs text-gray-400 shrink-0">from {source}</span>
      </div>
      {items.length ? (
        <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
          {items.map((t, i) => <li key={i} className="pl-3 -indent-3">• {t}</li>)}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-gray-400 italic">{empty}</p>
      )}
    </div>
  );
}

// ─── The screen ───────────────────────────────────────────────────────────────

export default function WeeklyBulletinView({ canWrite = false }) {
  const [sunday,   setSunday]   = useState(thisSunday);
  const [bulletin, setBulletin] = useState(null);
  const [draft,    setDraft]    = useState(null);
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const [saved,    setSaved]    = useState(false);

  // The composed week, and the typed half pulled back out of it so the form has
  // something to bind to. Reading a week never writes one, so moving around the
  // calendar is free.
  const load = useCallback(async () => {
    setError(''); setSaved(false);
    try {
      const { bulletin: b } = await call(`${API}/${sunday}`);
      setBulletin(b);
      setDraft({
        quote:       b.quote,
        quote_ref:   b.quoteRef,
        updates:     b.prayer.updates.join('\n'),
        ongoing:     b.prayer.ongoing.join('\n'),
        shut_ins:    b.prayer.shutIns.join('\n'),
        pregnancies: b.prayer.pregnancies.join('\n'),
        evangelists: b.prayer.evangelists.join('\n'),
        offering:    b.lastWeek.offering,
        building:    b.lastWeek.building,
        group_notes: Object.fromEntries(
          b.groups.map((g, i) => [g.key ?? `group-${i + 1}`, { leader: g.leader, note: g.note }])
        ),
      });
    } catch (e) {
      setError(e.message);
      setBulletin(null);
    }
  }, [sunday]);

  useEffect(() => { load(); }, [load]);

  const set = (key, value) => { setDraft(d => ({ ...d, [key]: value })); setSaved(false); };

  const setGroup = (key, field, value) => {
    setDraft(d => ({
      ...d,
      group_notes: { ...d.group_notes, [key]: { ...(d.group_notes[key] || {}), [field]: value } },
    }));
    setSaved(false);
  };

  async function save() {
    setBusy(true); setError('');
    try {
      const { bulletin: b } = await call(`${API}/${sunday}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      setBulletin(b);
      setSaved(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  // An export renders whatever is saved, so anything typed but not yet saved
  // would silently not be in the file. Saving first is the only honest order.
  async function exportAs(format) {
    setBusy(true); setError('');
    try {
      if (canWrite && !saved) await save();
      window.location.href = `${API}/${sunday}/export.${format}`;
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const weekLabel = useMemo(() => {
    if (!bulletin) return '';
    return bulletin.sundayLabel;
  }, [bulletin]);

  if (!bulletin || !draft) {
    return (
      <div className="card text-sm text-gray-500">
        {error ? <span className="text-red-600">{error}</span> : 'Loading…'}
      </div>
    );
  }

  const lastWeek = [
    bulletin.lastWeek.sunday    != null ? `Sunday attendance: ${bulletin.lastWeek.sunday}`       : null,
    bulletin.lastWeek.wednesday != null ? `Wednesday attendance: ${bulletin.lastWeek.wednesday}` : null,
  ].filter(Boolean);

  // Only the filled slots are worth previewing here — the newsletter itself
  // prints a row for every job, blanks included, so the gaps are visible there.
  const rosterLines = ['sunday', 'wednesday'].flatMap(part =>
    bulletin.dutyRoster[part].jobs.flatMap(job =>
      job.names
        .map((name, i) => (name ? `${job.job}, ${shortDate(bulletin.dutyRoster[part].dates[i])}: ${name}` : null))
        .filter(Boolean)
    )
  );

  return (
    <div className="space-y-4">

      {/* ── Which week ── */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-lg font-semibold text-church-navy">Weekly Newsletter</h2>
            <p className="text-sm text-gray-500">{weekLabel}</p>
          </div>

          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setSunday(s => addDays(s, -7))}
              className="px-2 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50"
              aria-label="Previous week"
            >←</button>
            <input
              type="date"
              value={sunday}
              onChange={e => e.target.value && setSunday(sundayOf(e.target.value))}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-church-gold focus:outline-none"
            />
            <button
              onClick={() => setSunday(s => addDays(s, 7))}
              className="px-2 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50"
              aria-label="Next week"
            >→</button>
            <button
              onClick={() => setSunday(thisSunday())}
              className="ml-1 px-2 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50"
            >This week</button>
          </div>
        </div>

        {/* Whether this week has been written yet, and where its words came
            from — so nobody edits a carried-forward list thinking it is saved. */}
        <p className="mt-3 text-sm">
          {bulletin.saved ? (
            <span className="text-green-700">Saved for this week.</span>
          ) : bulletin.carriedFrom ? (
            <span className="text-amber-700">
              Not written yet — showing the prayer lists from {bulletin.carriedFrom}. Edit and save to keep them for this week.
            </span>
          ) : (
            <span className="text-gray-500">Not written yet, and there is no earlier week to carry forward from.</span>
          )}
        </p>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-3 flex flex-wrap gap-2">
          {canWrite && (
            <button
              onClick={save}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded bg-church-navy text-white hover:opacity-90 disabled:opacity-50"
            >{busy ? 'Working…' : saved ? 'Saved' : 'Save'}</button>
          )}
          <button
            onClick={() => exportAs('docx')}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded border border-church-navy text-church-navy hover:bg-church-cream disabled:opacity-50"
          >Export Word</button>
          <button
            onClick={() => exportAs('pdf')}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded border border-church-navy text-church-navy hover:bg-church-cream disabled:opacity-50"
          >Export PDF</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">

        {/* ── Typed each week ── */}
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="font-semibold text-church-navy">Prayer Requests</h3>
            <p className="text-xs text-gray-500 -mt-2">
              One entry per line. A section left empty is left out of the newsletter.
            </p>
            {PRAYER_FIELDS.map(f => (
              <Field
                key={f.key}
                label={f.label}
                hint={f.hint}
                value={draft[f.key]}
                disabled={!canWrite}
                rows={f.key === 'ongoing' || f.key === 'evangelists' ? 6 : 3}
                onChange={v => set(f.key, v)}
              />
            ))}
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold text-church-navy">This Week’s Verse</h3>
            <Field label="Quote" value={draft.quote} rows={3} disabled={!canWrite} onChange={v => set('quote', v)} />
            <Line label="Reference" placeholder="Gal. 6:9" value={draft.quote_ref} disabled={!canWrite} onChange={v => set('quote_ref', v)} />
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold text-church-navy">Giving</h3>
            <p className="text-xs text-gray-500 -mt-2">
              The attendance figures come from the Attendance page. These two do not, so they are typed —
              and the collection is the one thing a new week does not carry forward.
            </p>
            <Line label="Offering"          placeholder="$7,125"         value={draft.offering} disabled={!canWrite} onChange={v => set('offering', v)} />
            <Line label="Building progress" placeholder="$87,450 (35%)"  value={draft.building} disabled={!canWrite} onChange={v => set('building', v)} />
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold text-church-navy">Groups</h3>
            <p className="text-xs text-gray-500 -mt-2">
              The groups and their addresses come from Email Groups. Who leads each one, and anything it has
              coming up, is typed here.
            </p>
            {bulletin.groups.map((g, i) => {
              const key = g.key ?? `group-${i + 1}`;
              return (
                <div key={key} className="border-t border-gray-100 pt-2 first:border-0 first:pt-0">
                  <div className="text-sm font-semibold text-church-navy">{g.name}</div>
                  <div className="text-xs text-gray-400">{g.email}</div>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    <Line label="Leader" value={draft.group_notes[key]?.leader ?? ''} disabled={!canWrite}
                          onChange={v => setGroup(key, 'leader', v)} />
                    <Line label="Coming up" value={draft.group_notes[key]?.note ?? ''} disabled={!canWrite}
                          onChange={v => setGroup(key, 'note', v)} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Already known ── */}
        <div className="space-y-4">
          <div className="card space-y-4">
            <div>
              <h3 className="font-semibold text-church-navy">Filled in from the site</h3>
              <p className="text-xs text-gray-500">
                These are read fresh every time the newsletter is built. To change one, change it on the page it
                comes from — it will be right here and in the export.
              </p>
            </div>

            <AutoSection title="Reminders"     source="Announcements"           items={bulletin.reminders}
                         empty="Nothing on the announcement board for the next five weeks." />
            <AutoSection title="Last Week’s Data" source="Attendance"           items={lastWeek}
                         empty="No attendance recorded for last week yet." />
            <AutoSection title="Anniversaries" source="Birthdays & Anniversaries" items={bulletin.anniversaries}
                         empty="None this week." />
            <AutoSection title="Birthdays"     source="Birthdays & Anniversaries" items={bulletin.birthdays}
                         empty="None this week." />
            <AutoSection title="Duty Roster"   source="Serving Schedule" items={rosterLines}
                         empty="Nothing on the serving schedule for these two weeks." />
            <AutoSection title="Elders"        source="Elders & Deacons" items={[joinSegments(bulletin.leadership.elders)].filter(Boolean)}
                         empty="No elders recorded." />
            <AutoSection title="Deacons"       source="Elders & Deacons" items={[joinSegments(bulletin.leadership.deacons)].filter(Boolean)}
                         empty="No deacons recorded." />
            <AutoSection title="Key Email Contacts" source="Email Groups"
                         items={bulletin.contacts.groups.map(c => `${c.label}: ${c.email}`)}
                         empty="No distribution groups." />
          </div>

          {!canWrite && (
            <p className="text-sm text-gray-500">
              You can read the newsletter but not write it. Ask an admin if you should look after it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
