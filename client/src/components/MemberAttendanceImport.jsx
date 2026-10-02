import { useState, useEffect } from 'react';
import Dialog from './Dialog';
import { API, call, dayLabel, toneHex } from '../lib/memberAttendance';

// Importing an attendance spreadsheet kept by colouring in cells: a row per
// member, a column per date, each cell coloured for how they were marked. The
// server reads the file (server/lib/memberAttendanceImport.js); this says
// which status each colour means and who any name it could not match is.
//
// Every change re-reads the file as a dry run, so the counts at the bottom are
// always what Import would actually do. Nothing is saved until Import.

const field = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white';
const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

function Swatch({ entry }) {
  if (entry.colour) {
    return <span aria-hidden="true" className="inline-block w-8 h-6 rounded border border-gray-300 shrink-0" style={{ background: entry.colour }} />;
  }
  return <span className="inline-flex items-center justify-center min-w-8 h-6 px-1.5 rounded border border-gray-300 text-xs font-mono text-gray-700 shrink-0">{entry.text}</span>;
}

export default function MemberAttendanceImport({ services, statuses, onClose, onImported }) {
  const active = statuses.filter(s => s.active);
  const [file, setFile] = useState(null);
  const [sheet, setSheet] = useState('');
  const [service, setService] = useState(services[0]?.name || '');
  const [keyMap, setKeyMap] = useState({});
  const [personMap, setPersonMap] = useState({});
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => { call(`${API}/roll`).then(d => setPeople(d.people)).catch(() => {}); }, []);

  const form = dryRun => {
    const body = new FormData();
    body.append('file', file);
    if (sheet) body.append('sheet', sheet);
    body.append('service', service);
    body.append('keyMap', JSON.stringify(keyMap));
    body.append('personMap', JSON.stringify(personMap));
    body.append('overwrite', String(overwrite));
    body.append('dryRun', String(dryRun));
    return body;
  };

  useEffect(() => {
    if (!file) return undefined;
    let live = true;
    call(`${API}/import`, { method: 'POST', body: form(true) })
      .then(d => { if (live) { setPreview(d); setSheets(d.sheets); setError(''); } })
      .catch(e => { if (live) { setPreview(null); setSheets(e.data?.sheets || []); setError(e.message); } });
    return () => { live = false; };
  // form() reads exactly these.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, sheet, service, keyMap, personMap, overwrite]);

  function choose(e) {
    const f = e.target.files?.[0] || null;
    setFile(f); setSheet(''); setSheets([]); setKeyMap({}); setPersonMap({}); setPreview(null); setDone(null); setError('');
  }

  async function run() {
    setBusy(true); setError('');
    try {
      const d = await call(`${API}/import`, { method: 'POST', body: form(false) });
      setDone(d.imported);
      onImported?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const c = preview?.counts;
  const toWrite = c ? c.add + c.replace : 0;
  const unmatched = preview?.people.filter(p => p.personId === null) ?? [];
  const matched = preview?.people.filter(p => p.personId !== null) ?? [];
  const first = preview?.dates[0]?.date;
  const last = preview?.dates[preview.dates.length - 1]?.date;

  return (
    <Dialog title="Import from Excel" subtitle="A row per member, a column per date, each cell coloured for how they were marked." onClose={onClose} width="max-w-2xl">
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>Spreadsheet (.xlsx)</span>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={choose}
              className="mt-1 block w-full text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-gray-300 file:bg-white file:text-sm" />
          </label>
          <label className="block">
            <span className={label}>These dates are for</span>
            <select value={service} onChange={e => setService(e.target.value)} className={`${field} mt-1 w-full`}>
              {services.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </label>
        </div>

        {sheets.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Sheet</span>
            <select value={sheet || preview?.sheet || ''} onChange={e => { setSheet(e.target.value); setKeyMap({}); setPersonMap({}); }} className={field}>
              {!sheet && !preview && <option value="">Choose…</option>}
              {sheets.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}

        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">{error}</p>}

        {preview && (
          <>
            <div className="text-sm text-gray-600 space-y-1">
              <p>
                <strong>{preview.people.length}</strong> {preview.people.length === 1 ? 'name' : 'names'} in column {preview.nameColumn},
                and <strong>{preview.dates.length}</strong> {preview.dates.length === 1 ? 'date' : 'dates'} across row {preview.headerRow}
                {first && <> ({dayLabel(first, { month: 'short', day: 'numeric', year: 'numeric' })}{last !== first && <> – {dayLabel(last, { month: 'short', day: 'numeric', year: 'numeric' })}</>})</>}.
              </p>
            </div>

            <section className="space-y-2">
              <h4 className="font-semibold text-church-navy text-sm">What each colour means</h4>
              {preview.keys.length === 0 ? (
                <p className="text-sm text-gray-400">No coloured or filled-in cells were found under the dates.</p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                  {preview.keys.map(k => (
                    <li key={k.key} className="flex items-center gap-3 px-3 py-2">
                      <Swatch entry={k} />
                      <span className="flex-1 text-sm text-gray-600">
                        {k.colour ? <span className="font-mono text-xs">{k.colour}</span> : 'typed, no colour'}
                        {k.colour && k.sample && <span className="text-gray-400"> · “{k.sample}”</span>}
                        <span className="text-gray-400"> · {k.count} {k.count === 1 ? 'cell' : 'cells'}</span>
                      </span>
                      <select aria-label={`Status for ${k.colour || k.text}`} value={keyMap[k.key] ?? ''}
                        onChange={e => setKeyMap(m => ({ ...m, [k.key]: e.target.value ? Number(e.target.value) : undefined }))}
                        className={`${field} w-36`}>
                        <option value="">Leave out</option>
                        {active.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      {keyMap[k.key] && (
                        <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: toneHex(active.find(s => s.id === keyMap[k.key])?.tone) }} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {unmatched.length > 0 && (
              <section className="space-y-2">
                <h4 className="font-semibold text-church-navy text-sm">Names not found in the directory ({unmatched.length})</h4>
                <p className="text-xs text-gray-500">Say who each one is, or leave them out.</p>
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                  {unmatched.map(p => (
                    <li key={p.row} className="flex items-center gap-3 px-3 py-2">
                      <span className="flex-1 text-sm text-church-navy">{p.name} <span className="text-xs text-gray-400">row {p.row}</span></span>
                      <select aria-label={`Who is ${p.name}`} value={personMap[p.row] ?? ''}
                        onChange={e => setPersonMap(m => ({ ...m, [p.row]: e.target.value ? Number(e.target.value) : '' }))}
                        className={`${field} max-w-[14rem]`}>
                        <option value="">Leave out</option>
                        {people.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {matched.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-gray-600">{matched.length} {matched.length === 1 ? 'name' : 'names'} matched to the directory</summary>
                <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600">
                  {matched.map(p => (
                    <li key={p.row}>{p.name}{p.matchedName !== p.name && <span className="text-gray-400"> → {p.matchedName}</span>}</li>
                  ))}
                </ul>
              </details>
            )}

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
              Where somebody is already marked for that date, use the spreadsheet instead
            </label>

            {c && (
              <div className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 space-y-0.5" aria-live="polite">
                <p className="font-semibold text-church-navy">
                  {toWrite ? `Import will save ${toWrite} ${toWrite === 1 ? 'mark' : 'marks'} for ${preview.service || 'the service'}` : 'Nothing to import yet'}
                  {c.replace > 0 && ` (${c.replace} replacing what is on the roll)`}.
                </p>
                {c.same > 0 && <p className="text-gray-600">{c.same} already on the roll the same way.</p>}
                {c.keep > 0 && <p className="text-gray-600">{c.keep} already marked differently, kept as they are.</p>}
                {c.unmapped > 0 && <p className="text-gray-600">{c.unmapped} {c.unmapped === 1 ? 'cell is' : 'cells are'} a colour left out.</p>}
                {c.unmatchedPeople + c.skippedPeople > 0 && (
                  <p className="text-gray-600">{c.unmatchedPeople + c.skippedPeople} {c.unmatchedPeople + c.skippedPeople === 1 ? 'person' : 'people'} left out.</p>
                )}
              </div>
            )}
          </>
        )}

        {done !== null && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Imported {done} {done === 1 ? 'mark' : 'marks'}.</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">{done !== null ? 'Close' : 'Cancel'}</button>
          <button type="button" onClick={run} disabled={busy || !toWrite || done !== null} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
