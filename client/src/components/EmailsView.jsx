import { useState, useEffect, useCallback } from 'react';

// Every kind of email the site sends, sorted into four tabs, with what each one
// says and everything that has actually gone out. The list of kinds lives on
// the server (server/mail/catalog.js), so a new email appears here by itself.

const API = '/api/emails';

async function call(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

const STATUS_TONE = {
  sent:    'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  failed:  'bg-red-100 text-red-700',
};
const STATUS_LABEL = { sent: 'Sent', pending: 'Waiting', failed: 'Failed' };

// SQLite writes UTC as 'YYYY-MM-DD HH:MM:SS'; say so, or the browser reads it
// as local time.
function when(value) {
  if (!value) return '';
  const d = new Date(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ─── Reading one email ────────────────────────────────────────────────────────

function EmailDialog({ title, subtitle, loadEmail, onClose }) {
  const [email, setEmail] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    loadEmail().then(e => { if (live) setEmail(e); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [loadEmail]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-semibold text-church-navy">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-church-navy text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!email && !error && <p className="text-sm text-gray-400">Loading…</p>}
          {email && (
            <>
              <p className="text-xs uppercase tracking-wide text-gray-400">Subject</p>
              <p className="font-medium text-church-navy mb-3">{email.subject}</p>
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono bg-gray-50 rounded-lg p-3">{email.body}</pre>
              {email.error && <p className="text-sm text-red-600 mt-3">Last error: {email.error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── The kinds of email on one tab ────────────────────────────────────────────

function EmailCard({ email, onPreview, onShowSent }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-semibold text-church-navy">{email.name}</h4>
          <p className="text-sm text-gray-600 mt-1">{email.trigger}</p>
          <p className="text-xs text-gray-500 mt-1"><span className="font-medium">Goes to:</span> {email.audience}</p>
        </div>
        <button
          onClick={() => onPreview(email)}
          className="text-xs px-3 py-1.5 rounded-lg border border-church-navy text-church-navy hover:bg-church-navy hover:text-white shrink-0"
        >
          Preview
        </button>
      </div>
      <div className="flex items-center gap-3 flex-wrap mt-3 text-xs">
        <button onClick={() => onShowSent(email)} className="text-church-gold hover:underline">
          {email.sent30} sent in the last 30 days
        </button>
        {email.pending > 0 && <span className={`px-1.5 py-0.5 rounded ${STATUS_TONE.pending}`}>{email.pending} waiting</span>}
        {email.failed > 0 && <span className={`px-1.5 py-0.5 rounded ${STATUS_TONE.failed}`}>{email.failed} failed</span>}
        {email.last && <span className="text-gray-400">last {when(email.last)}</span>}
      </div>
    </div>
  );
}

// ─── What has gone out ────────────────────────────────────────────────────────

function History({ category, email, onClearEmail, onOpen, refreshKey }) {
  const [status, setStatus] = useState('');
  const [query, setQuery]   = useState('');
  const [page, setPage]     = useState(1);
  const [data, setData]     = useState(null);
  const [error, setError]   = useState('');

  useEffect(() => { setPage(1); }, [category, email, status, query]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (email) params.set('email', email.id); else params.set('category', category);
    if (status) params.set('status', status);
    if (query.trim()) params.set('q', query.trim());
    let live = true;
    call(`${API}/history?${params}`)
      .then(d => { if (live) { setData(d); setError(''); } })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [category, email, status, query, page, refreshKey]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-church-navy text-sm">
          {email ? <>Sent: {email.name}</> : 'Sent from this tab'}
          {email && (
            <button onClick={onClearEmail} className="ml-2 text-xs text-church-gold hover:underline font-normal">show all</button>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search subject or recipient…"
            aria-label="Search sent email"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56"
          />
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            aria-label="Status"
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value="">Any status</option>
            <option value="sent">Sent</option>
            <option value="pending">Waiting</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      {data && data.messages.length === 0 && <p className="text-sm text-gray-400 mt-4">Nothing has gone out yet.</p>}
      {data && data.messages.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100">
          {data.messages.map(m => (
            <li key={m.id}>
              <button onClick={() => onOpen(m)} className="w-full text-left py-2 flex items-start gap-3 hover:bg-gray-50 rounded-lg px-2 -mx-2">
                <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${STATUS_TONE[m.status] || ''}`}>{STATUS_LABEL[m.status] || m.status}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-church-navy truncate">{m.subject}</span>
                  <span className="block text-xs text-gray-400 truncate">
                    {m.emailName} · to {m.to_name ? `${m.to_name} <${m.to_email}>` : m.to_email}
                    {m.intended_for && m.intended_for !== m.to_email && <> · meant for {m.intended_for}</>}
                  </span>
                </span>
                <span className="text-xs text-gray-400 shrink-0">{when(m.sent_at || m.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && pages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">Newer</button>
          <span className="text-gray-500 text-xs">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">Older</button>
        </div>
      )}
    </div>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function EmailsView() {
  const [catalog, setCatalog]   = useState(null);
  const [error, setError]       = useState('');
  const [tab, setTab]           = useState('notifications');
  const [focus, setFocus]       = useState(null);    // one email's history
  const [reading, setReading]   = useState(null);    // { title, subtitle, load }
  const [busy, setBusy]         = useState(false);
  const [notice, setNotice]     = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    call(`${API}/catalog`).then(setCatalog).catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const preview = useCallback(email => setReading({
    title: email.name,
    subtitle: 'A preview, filled with made-up details. Nothing is sent.',
    load: () => call(`${API}/catalog/${email.id}/preview`),
  }), []);

  const open = useCallback(message => setReading({
    title: message.subject,
    subtitle: `${message.emailName} · to ${message.to_email} · ${STATUS_LABEL[message.status] || message.status}`,
    load: () => call(`${API}/history/${message.id}`).then(r => r.message),
  }), []);

  async function sendNow() {
    setBusy(true); setNotice('');
    try {
      const r = await call(`${API}/send-now`, { method: 'POST' });
      setNotice(r.skipped ? 'No mail server is set up, so waiting mail stays waiting.' : `${r.sent ?? 0} sent, ${r.failed ?? 0} failed.`);
      load();
      setRefreshKey(k => k + 1);
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="card text-sm text-red-600">{error}</div>;
  if (!catalog) return <div className="card text-sm text-gray-500">Loading…</div>;

  const category = catalog.categories.find(c => c.id === tab);
  const waiting = catalog.categories.flatMap(c => c.emails).reduce((n, e) => n + e.pending, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-heading mb-1">Emails</h2>
          <p className="text-sm text-gray-500">Every email the site sends, what it says, and what has gone out.</p>
        </div>
        <button
          onClick={sendNow}
          disabled={busy}
          className="text-sm px-3 py-2 rounded-lg border border-church-gold text-church-gold hover:bg-church-gold hover:text-church-navy disabled:opacity-50"
        >
          {busy ? 'Sending…' : `Send waiting mail now${waiting ? ` (${waiting})` : ''}`}
        </button>
      </div>

      {catalog.redirect && (
        <div className="card border border-amber-200 bg-amber-50 text-sm text-amber-800">
          Test mode: every email is going to <strong>{catalog.redirect}</strong> instead of the person it is for, except to the roles and people an admin has turned on under Admin → Email Delivery.
        </div>
      )}
      {notice && <div className="card text-sm text-gray-700">{notice}</div>}

      <div role="tablist" className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {catalog.categories.map(c => (
          <button
            key={c.id}
            role="tab"
            aria-selected={tab === c.id}
            onClick={() => { setTab(c.id); setFocus(null); }}
            className={`px-2.5 sm:px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${
              tab === c.id ? 'border-church-gold text-church-navy font-semibold' : 'border-transparent text-gray-500 hover:text-church-navy'
            }`}
          >
            {c.label} <span className="hidden sm:inline text-xs text-gray-400">{c.emails.length}</span>
          </button>
        ))}
      </div>

      <p className="text-sm text-gray-600">{category.description}</p>

      {category.emails.length === 0 ? (
        <div className="card text-sm text-gray-500">Nothing in this tab is sent yet.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {category.emails.map(e => (
            <EmailCard key={e.id} email={e} onPreview={preview} onShowSent={setFocus} />
          ))}
        </div>
      )}

      <History
        category={tab}
        email={focus}
        onClearEmail={() => setFocus(null)}
        onOpen={open}
        refreshKey={refreshKey}
      />

      {catalog.uncategorised > 0 && (
        <p className="text-xs text-gray-400">
          {catalog.uncategorised} message(s) in the outbox fit none of these tabs.
        </p>
      )}

      {reading && (
        <EmailDialog
          title={reading.title}
          subtitle={reading.subtitle}
          loadEmail={reading.load}
          onClose={() => setReading(null)}
        />
      )}
    </div>
  );
}
