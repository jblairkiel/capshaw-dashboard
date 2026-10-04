import { useState, useEffect } from 'react';
import Dialog from './Dialog';
import { API, call, dayLabel, toneHex } from '../lib/memberAttendance';
import DateInput from './DateInput';

// Importing attendance kept in Excel by colouring in cells. The server reads
// the files (server/lib/memberAttendanceImport.js) — the church's weekly sheet,
// one per date with a colour legend at the top, or a grid of members by dates
// — and this confirms which status each colour means, who any unmatched name
// is, and the date of any sheet that does not say.
//
// The legend's suggestions are filled in to start with; every change re-reads
// the files as a dry run, so the counts at the bottom are always what Import
// would actually do. Nothing is saved until Import.

const field = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white';
const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';
const fmt = iso => dayLabel(iso, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

function Swatch({ entry }) {
  if (entry.colour) {
    return <span aria-hidden="true" className="inline-block w-8 h-6 rounded border border-gray-300 shrink-0" style={{ background: entry.colour }} />;
  }
  if (entry.none) {
    return <span aria-hidden="true" className="inline-block w-8 h-6 rounded border border-dashed border-gray-400 bg-white shrink-0" />;
  }
  return <span className="inline-flex items-center justify-center min-w-8 h-6 px-1.5 rounded border border-gray-300 text-xs font-mono text-gray-700 shrink-0">{entry.text}</span>;
}

function describeKey(k) {
  if (k.none) return 'No colour';
  if (k.legend) return k.approximate ? `Close to ${k.legend}` : k.legend;
  if (k.colour) return <span className="font-mono text-xs">{k.colour}</span>;
  return 'Typed, no colour';
}

// The service most likely meant: the first one held on the weekday every date falls on.
function guessService(services, dates) {
  const days = new Set(dates.map(d => new Date(`${d}T12:00:00`).getDay()));
  if (days.size !== 1) return null;
  const [day] = days;
  return services.find(s => s.weekday === day)?.name || null;
}

export default function MemberAttendanceImport({ services, statuses, onClose, onImported, onStatusesChanged }) {
  const active = statuses.filter(s => s.active);
  const [files, setFiles] = useState([]);
  const [sheet, setSheet] = useState('');
  const [service, setService] = useState(services[0]?.name || '');
  const [serviceChosen, setServiceChosen] = useState(false);
  const [keyMap, setKeyMap] = useState({});
  const [personMap, setPersonMap] = useState({});
  const [dateMap, setDateMap] = useState({});
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
    for (const f of files) body.append('file', f);
    if (sheet) body.append('sheet', sheet);
    body.append('service', service);
    body.append('keyMap', JSON.stringify(keyMap));
    body.append('personMap', JSON.stringify(personMap));
    body.append('dateMap', JSON.stringify(dateMap));
    body.append('overwrite', String(overwrite));
    body.append('dryRun', String(dryRun));
    return body;
  };

  useEffect(() => {
    if (!files.length) return undefined;
    let live = true;
    call(`${API}/import`, { method: 'POST', body: form(true) })
      .then(d => { if (live) { setPreview(d); setSheets(d.sheets); setError(''); } })
      .catch(e => { if (live) { setPreview(null); setSheets(e.data?.sheets || []); setError(e.message); } });
    return () => { live = false; };
  // form() reads exactly these.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, sheet, service, keyMap, personMap, dateMap, overwrite]);

  // What the legend suggests fills any colour not yet chosen, and the dates
  // pick the service until somebody picks one.
  useEffect(() => {
    if (!preview) return;
    const fill = {};
    for (const k of preview.keys) if (!(k.key in keyMap) && k.suggest) fill[k.key] = k.suggest;
    if (Object.keys(fill).length) setKeyMap(m => ({ ...fill, ...m }));
    if (!serviceChosen) {
      const guess = guessService(services, preview.dates);
      if (guess && guess !== service) setService(guess);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  function choose(e) {
    setFiles([...(e.target.files || [])]);
    setSheet(''); setSheets([]); setKeyMap({}); setPersonMap({}); setDateMap({});
    setPreview(null); setDone(null); setError(''); setServiceChosen(false);
  }

  async function addStatus(k) {
    setError('');
    try {
      const { status } = await call(`${API}/statuses`, { method: 'POST', body: JSON.stringify({ label: k.legendLabel }) });
      await onStatusesChanged?.();
      setKeyMap(m => ({ ...m, [k.key]: status.id }));
    } catch (e) {
      setError(e.message);
    }
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
  const pages = preview?.pages ?? [];
  const statusLabels = new Set(active.map(s => s.label.toLowerCase()));

  return (
    <Dialog title="Import from Excel" subtitle="The weekly attendance sheets, one per date — choose as many as you have at once." onClose={onClose} width="max-w-3xl">
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>Spreadsheets (.xlsx)</span>
            <input type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={choose}
              className="mt-1 block w-full text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-gray-300 file:bg-white file:text-sm" />
          </label>
          <label className="block">
            <span className={label}>These dates are for</span>
            <select value={service} onChange={e => { setService(e.target.value); setServiceChosen(true); }} className={`${field} mt-1 w-full`}>
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
            <section className="space-y-2">
              <h4 className="font-semibold text-church-navy text-sm">
                {pages.length === 1 ? 'The sheet' : `${pages.length} sheets`} · {preview.dates.length} {preview.dates.length === 1 ? 'date' : 'dates'} · {preview.people.length} {preview.people.length === 1 ? 'person' : 'people'}
              </h4>
              <div className="border border-gray-100 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {pages.map(p => (
                      <tr key={p.id} className="border-t border-gray-100 first:border-t-0 align-top">
                        <td className="px-3 py-2 text-gray-700">
                          {p.file}{p.sheet && pages.filter(x => x.file === p.file).length > 1 && <span className="text-gray-400"> · {p.sheet}</span>}
                          {p.problem && <span className="block text-xs text-red-700">{p.problem}</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {p.layout === 'roster' ? (
                            <span className="inline-flex items-center gap-2">
                              <DateInput aria-label={`Date of ${p.file}${p.sheet ? ` ${p.sheet}` : ''}`}
                                value={dateMap[p.id] ?? p.dates[0] ?? ''}
                                onChange={v => setDateMap(m => ({ ...m, [p.id]: v }))}
                                className={`${field} ${p.dates.length ? '' : 'border-red-300'}`} />
                              {p.dates[0] && !dateMap[p.id] && <span className="text-xs text-gray-400">{p.dateFound ? 'from the sheet' : 'from the file name'}</span>}
                            </span>
                          ) : p.dates.length ? (
                            <span className="text-gray-600">{fmt(p.dates[0])}{p.dates.length > 1 && ` – ${fmt(p.dates[p.dates.length - 1])}`}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">{p.people} {p.people === 1 ? 'name' : 'names'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="font-semibold text-church-navy text-sm">What each colour means</h4>
              {preview.keys.length === 0 ? (
                <p className="text-sm text-gray-400">No names with a date to go with them yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                  {preview.keys.map(k => (
                    <li key={k.key} className="flex items-center gap-3 px-3 py-2 flex-wrap">
                      <Swatch entry={k} />
                      <span className="flex-1 min-w-[10rem] text-sm text-gray-700">
                        {describeKey(k)}
                        <span className="text-gray-400"> · {k.count} {k.count === 1 ? 'name' : 'names'}</span>
                        {k.none && <span className="block text-xs text-gray-400">Not in the legend, so most likely absent.</span>}
                      </span>
                      {k.legendLabel && !k.suggest && !keyMap[k.key] && !statusLabels.has(k.legendLabel.toLowerCase()) && (
                        <button type="button" onClick={() => addStatus(k)} className="text-xs px-2.5 py-1 rounded-lg border border-church-navy text-church-navy hover:bg-church-cream">
                          Add “{k.legendLabel}” as a status
                        </button>
                      )}
                      <select aria-label={`Status for ${k.none ? 'no colour' : k.colour || k.text}`} value={keyMap[k.key] ?? ''}
                        onChange={e => setKeyMap(m => ({ ...m, [k.key]: e.target.value ? Number(e.target.value) : '' }))}
                        className={`${field} w-40`}>
                        <option value="">Leave out</option>
                        {active.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ background: keyMap[k.key] ? toneHex(active.find(s => s.id === keyMap[k.key])?.tone) : 'transparent' }} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {unmatched.length > 0 && (
              <section className="space-y-2">
                <h4 className="font-semibold text-church-navy text-sm">Names not found in the directory ({unmatched.length})</h4>
                <p className="text-xs text-gray-500">Say who each one is, or leave them out. A name is asked about once, however many sheets it is on.</p>
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg max-h-72 overflow-y-auto">
                  {unmatched.map(p => (
                    <li key={p.key} className="flex items-center gap-3 px-3 py-2">
                      <span className="flex-1 text-sm text-church-navy">{p.name} <span className="text-xs text-gray-400">{p.where}</span></span>
                      <select aria-label={`Who is ${p.name}`} value={personMap[p.key] ?? ''}
                        onChange={e => setPersonMap(m => ({ ...m, [p.key]: e.target.value ? Number(e.target.value) : '' }))}
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
                    <li key={p.key}>{p.name}{p.matchedName !== p.name && <span className="text-gray-400"> → {p.matchedName}</span>}</li>
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
                {c.unmapped > 0 && <p className="text-gray-600">{c.unmapped} {c.unmapped === 1 ? 'name is' : 'names are'} a colour left out.</p>}
                {c.unmatchedPeople + c.skippedPeople > 0 && (
                  <p className="text-gray-600">{c.unmatchedPeople + c.skippedPeople} {c.unmatchedPeople + c.skippedPeople === 1 ? 'person' : 'people'} left out.</p>
                )}
                {pages.some(p => p.problem) && <p className="text-red-700">{pages.filter(p => p.problem).length} {pages.filter(p => p.problem).length === 1 ? 'sheet is' : 'sheets are'} not included until fixed above.</p>}
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
