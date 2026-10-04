import { useState, useEffect, useMemo } from 'react';

// Email Delivery (admins only): while the site is in test mode every email goes
// to the redirect address instead of the person it is for. This page lets
// particular roles and people through to their own address; everyone else
// stays redirected. A person's own setting beats any role they hold, and the
// "Everyone" switch lets all mail through bar anybody kept redirected by name.
// The server decides (server/mail/delivery.js) and checks this is an admin.

const API = '/api/mail-delivery';

async function call(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

function Switch({ on, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${on ? 'bg-emerald-600' : 'bg-gray-300'}`}>
      <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

const who = p => (p.name ? `${p.name} <${p.email}>` : p.email);

function names(list, max = 4) {
  if (!list.length) return 'Nobody holds this yet';
  const shown = list.slice(0, max).map(p => p.name || p.email).join(', ');
  return list.length > max ? `${shown} and ${list.length - max} more` : shown;
}

export default function MailDeliveryView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');
  const [addDeliver, setAddDeliver] = useState('true');

  useEffect(() => { call(API).then(setData).catch(e => setError(e.message)); }, []);

  async function act(request) {
    setBusy(true); setError('');
    try { setData(await request()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const setAll = on => {
    if (on && !window.confirm('Send everyone their own email? Every message the site sends will go to the real person it is for, except anybody kept redirected below.')) return;
    act(() => call(`${API}/all`, { method: 'PUT', body: JSON.stringify({ on }) }));
  };
  const setRole = (key, deliver) => act(() => call(`${API}/roles/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ deliver }) }));
  const setPerson = (email, name, deliver) => act(() => call(`${API}/people`, { method: 'PUT', body: JSON.stringify({ email, name, deliver }) }));
  const removePerson = email => act(() => call(`${API}/people?email=${encodeURIComponent(email)}`, { method: 'DELETE' }));

  // "Name <email>" picked from the list, or a bare address typed in.
  const options = useMemo(() => (data?.addressBook || []).map(p => ({ ...p, text: who(p) })), [data]);
  function add(e) {
    e.preventDefault();
    const text = adding.trim();
    const picked = options.find(o => o.text === text || o.email === text.toLowerCase());
    const email = picked ? picked.email : (text.match(/<([^>]+)>/)?.[1] || text);
    setPerson(email, picked?.name || '', addDeliver === 'true').then(() => setAdding(''));
  }

  if (!data) return <div className="card text-sm text-gray-500">{error || 'Loading…'}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-heading mb-1">Email Delivery</h2>
        <p className="text-sm text-gray-500">Who receives their own email while the site is in test mode.</p>
      </div>

      {data.redirecting && data.all.on ? (
        <div className="card border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          <strong>Everyone is getting their own email.</strong> Every email goes to the person it is for
          {data.kept ? `, except the ${data.kept} ${data.kept === 1 ? 'person' : 'people'} kept redirected below` : ''}.
          Turn &ldquo;Everyone&rdquo; off to go back to sending everything to <span className="font-mono">{data.redirectTo}</span>.
        </div>
      ) : data.redirecting ? (
        <div className="card border border-amber-200 bg-amber-50 text-sm text-amber-900">
          <strong>Test mode is on.</strong> Every email goes to <span className="font-mono">{data.redirectTo}</span> instead
          of the person it is for — except to the roles and people turned on below. Nothing turned on means everything
          comes to you.
        </div>
      ) : (
        <div className="card border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          <strong>Test mode is off.</strong> Every email goes to the person it is for, so these settings do nothing at the moment.
          They take effect again if <span className="font-mono">MAIL_REDIRECT_TO</span> is set on the server.
        </div>
      )}

      {error && <div className="card text-sm text-red-600" role="alert">{error}</div>}

      {data.redirecting && (
        <section className={`card flex items-center gap-4 ${data.all.on ? 'border border-emerald-300' : ''}`} aria-label="Everyone">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-church-navy">Everyone</h3>
            <p className="text-xs text-gray-500">
              {data.all.on
                ? `On${data.all.by ? ` · turned on by ${data.all.by}` : ''}. Every email goes to the person it is for, bar anybody kept redirected by name.`
                : 'Turn on to send every email to the person it is for. Anybody set to "Keep redirected" below still comes to you.'}
            </p>
          </div>
          <span className={`text-xs ${data.all.on ? 'text-emerald-800' : 'text-gray-400'}`}>{data.all.on ? 'All on' : 'Off'}</span>
          <Switch on={data.all.on} disabled={busy} onChange={setAll} label="Everyone: send their own email" />
        </section>
      )}

      <section className="card space-y-2" aria-label="Who gets their own email now">
        <h3 className="font-semibold text-church-navy">Getting their own email now ({data.real.length})</h3>
        {data.real.length === 0 ? (
          <p className="text-sm text-gray-500">Nobody. Every email goes to {data.redirectTo || 'the redirect address'}.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.real.map(p => (
              <li key={p.email} className="py-1.5 flex items-center gap-3 flex-wrap">
                <span className="text-church-navy">{p.name || p.email}</span>
                {p.name && <span className="text-gray-400 font-mono text-xs">{p.email}</span>}
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {p.why === 'person' ? 'Turned on by name' : p.why === 'all' ? 'Everyone is on' : `As ${p.roleLabel}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-2" aria-label="Roles">
        <h3 className="font-semibold text-church-navy">Roles</h3>
        <p className="text-xs text-gray-500">Turn a role on and everyone given it gets their own email. Being an admin does not count as holding every area here.</p>
        {data.all.on && (
          <p className="text-xs text-emerald-800 bg-emerald-50 rounded px-2 py-1">Everyone is on, so these make no difference until it is turned off. They are kept as they are for when it is.</p>
        )}
        <ul className="divide-y divide-gray-100">
          {data.roles.map(r => (
            <li key={r.key} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-church-navy font-medium">{r.label}</p>
                <p className="text-xs text-gray-500 truncate">{names(r.holders)}</p>
              </div>
              <span className={`text-xs ${r.deliver ? 'text-emerald-800' : 'text-gray-400'}`}>{r.deliver ? 'Their own email' : 'Redirected'}</span>
              <Switch on={r.deliver} disabled={busy} onChange={on => setRole(r.key, on)} label={`${r.label}: send their own email`} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3" aria-label="People">
        <h3 className="font-semibold text-church-navy">People</h3>
        <p className="text-xs text-gray-500">
          A person&apos;s own setting beats any role: turn on just one person, or keep one person redirected while their role is turned on.
        </p>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <label className="block flex-1 min-w-[14rem]">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Person or email address</span>
            <input list="mail-delivery-people" value={adding} onChange={e => setAdding(e.target.value)} placeholder="Start typing a name"
              className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold" />
            <datalist id="mail-delivery-people">{options.map(o => <option key={o.email} value={o.text} />)}</datalist>
          </label>
          <select value={addDeliver} onChange={e => setAddDeliver(e.target.value)} aria-label="Their setting" className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="true">Their own email</option>
            <option value="false">Keep redirected</option>
          </select>
          <button type="submit" disabled={busy || !adding.trim()} className="btn-primary text-sm disabled:opacity-50">Add</button>
        </form>
        {data.people.length === 0 ? (
          <p className="text-sm text-gray-400">Nobody has a setting of their own.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.people.map(p => (
              <li key={p.email} className="py-2 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[12rem]">
                  <p className="text-sm text-church-navy">{p.name || p.email}</p>
                  {p.name && <p className="text-xs text-gray-400 font-mono">{p.email}</p>}
                </div>
                <select value={String(p.deliver)} disabled={busy} aria-label={`Setting for ${p.name || p.email}`}
                  onChange={e => setPerson(p.email, p.name, e.target.value === 'true')}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
                  <option value="true">Their own email</option>
                  <option value="false">Keep redirected</option>
                </select>
                <button type="button" onClick={() => removePerson(p.email)} disabled={busy} aria-label={`Remove ${p.name || p.email}`}
                  className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-700 disabled:opacity-50">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
