import { useState, useEffect, useCallback } from 'react';

// Filling the site up so it can be looked at, and taking that filling back out.
//
// Everything a batch creates is written down as it is made, so removing it is
// reading that list back rather than recognising made-up rows — which is why
// this panel can promise that the congregation's own records are untouched.

const API = '/api/admin/sample-data';

async function send(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

const jsonBody = body => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const SCALES = [
  { value: 1, label: 'A little',  hint: 'enough to see each page working' },
  { value: 3, label: 'A fair bit', hint: 'enough to scroll and search' },
  { value: 6, label: 'A lot',     hint: 'enough to find out what gets slow' },
];

function when(raw) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(raw || ''));
  if (!match) return String(raw || '');
  const [, , month, day, hour, minute] = match;
  return `${Number(month)}/${Number(day)} at ${hour}:${minute}`;
}

export default function SampleDataPanel() {
  const [catalogue, setCatalogue] = useState([]);
  const [notFilled, setNotFilled] = useState({});
  const [batches, setBatches]     = useState([]);
  const [chosen, setChosen]       = useState([]);      // empty means all of them
  const [scale, setScale]         = useState(1);
  const [note, setNote]           = useState('');
  const [busy, setBusy]           = useState('');
  const [error, setError]         = useState('');
  const [message, setMessage]     = useState('');
  const [loading, setLoading]     = useState(true);
  const [confirming, setConfirming] = useState('');

  const load = useCallback(async () => {
    try {
      const json = await send(API);
      setCatalogue(json.generators);
      setNotFilled(json.notFilled || {});
      setBatches(json.batches);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = id => setChosen(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  async function make() {
    setBusy('make'); setError(''); setMessage('');
    try {
      const json = await send(API, jsonBody({ generators: chosen, scale, note }));
      setBatches(json.batches);
      setNote('');
      setMessage(`Made ${json.total} rows across the site. Have a look around — then remove the batch when you are done.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function removeBatch(id) {
    setBusy(id); setError(''); setMessage('');
    try {
      const json = await send(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setBatches(json.batches);
      setConfirming('');
      setMessage(`Removed ${json.deleted} rows. Nothing else was touched.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  const filling = chosen.length ? chosen.length : catalogue.length;

  return (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-church-navy">Sample Data</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Fills the site with made-up records so you can see how a page looks with
          something in it. Every row is written down as it is made, so removing a
          batch takes out exactly what it put in — the congregation&rsquo;s own
          records are never touched.
        </p>
      </div>

      {error && (
        <p className="px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</p>
      )}
      {message && (
        <p className="px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{message}</p>
      )}

      {/* ── What to fill ───────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
          <h4 className="text-sm font-semibold text-church-navy">What to fill</h4>
          <button
            onClick={() => setChosen([])}
            className="text-xs text-gray-400 hover:text-church-navy transition-colors"
          >
            {chosen.length ? 'All of it' : 'All of it — every part below'}
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {catalogue.map(generator => {
            const on = chosen.length === 0 || chosen.includes(generator.id);
            return (
              <label
                key={generator.id}
                className={`flex gap-3 items-start px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                  on ? 'border-church-gold bg-church-cream/40' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(generator.id)}
                  onChange={() => toggle(generator.id)}
                  className="mt-1 accent-church-navy"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-church-navy">{generator.label}</span>
                  <span className="block text-xs text-gray-500">{generator.describe}</span>
                  <span className="block text-xs text-gray-400 mt-0.5">{generator.page}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Tick nothing to fill all of it. Some parts build on others — the serving
          schedule draws its names from the directory — so filling everything at
          once reads best.
        </p>
      </section>

      {/* ── How much ───────────────────────────────────────────────────────── */}
      <section>
        <h4 className="text-sm font-semibold text-church-navy mb-2">How much</h4>
        <div className="flex gap-2 flex-wrap">
          {SCALES.map(option => (
            <button
              key={option.value}
              onClick={() => setScale(option.value)}
              className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                scale === option.value
                  ? 'border-church-gold bg-church-cream/40'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="block text-sm font-medium text-church-navy">{option.label}</span>
              <span className="block text-xs text-gray-400">{option.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex items-end gap-3 flex-wrap">
        <label className="block flex-1 min-w-[16rem]">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">What is it for?</span>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Checking the Guests page on a phone"
            className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
          />
        </label>
        <button onClick={make} disabled={busy === 'make'} className="btn-primary text-sm disabled:opacity-50">
          {busy === 'make' ? 'Filling…' : `Fill ${filling} part${filling === 1 ? '' : 's'} of the site`}
        </button>
      </section>

      {/* ── What is in there now ───────────────────────────────────────────── */}
      <section>
        <h4 className="text-sm font-semibold text-church-navy mb-2">Sample data in the site now</h4>

        {batches.length === 0 ? (
          <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl px-4 py-6 text-center">
            None. Everything on the site is the congregation&rsquo;s own.
          </p>
        ) : (
          <ul className="space-y-3">
            {batches.map(batch => (
              <li key={batch.id} className="card">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-church-navy">
                      {batch.rows} row{batch.rows === 1 ? '' : 's'}
                      <span className="text-gray-400 font-normal"> · {when(batch.created_at)}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {batch.note || 'No note'}
                      {batch.created_by && ` · asked for by ${batch.created_by}`}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 font-mono">{batch.id}</p>
                  </div>

                  {confirming === batch.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Remove all {batch.rows}?</span>
                      <button
                        onClick={() => removeBatch(batch.id)}
                        disabled={busy === batch.id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {busy === batch.id ? 'Removing…' : 'Yes, remove it'}
                      </button>
                      <button
                        onClick={() => setConfirming('')}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300"
                      >
                        Keep it
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirming(batch.id)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="flex gap-1.5 flex-wrap mt-2 pt-2 border-t border-gray-100">
                  {batch.tables.map(table => (
                    <span key={table.name} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {table.name} <span className="text-gray-400 tabular-nums">{table.rows}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── What is never filled ───────────────────────────────────────────── */}
      {Object.keys(notFilled).length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500 hover:text-church-navy">
            What is never filled, and why
          </summary>
          <dl className="mt-2 space-y-2 border-l border-gray-100 pl-3">
            {Object.entries(notFilled).map(([table, reason]) => (
              <div key={table}>
                <dt className="text-xs font-mono text-church-navy">{table}</dt>
                <dd className="text-xs text-gray-500">{reason}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
