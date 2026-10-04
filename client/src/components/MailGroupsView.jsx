import { useState, useEffect, useCallback } from 'react';

const API = '/api/mail';

async function call(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

// ─── One group's membership ───────────────────────────────────────────────────

function GroupDetail({ groupKey, onBack, onChanged }) {
  const [data, setData]     = useState(null);
  const [error, setError]   = useState('');
  const [adding, setAdding] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy]     = useState(false);

  const load = useCallback(() => {
    call(`${API}/groups/${groupKey}`).then(setData).catch(e => setError(e.message));
  }, [groupKey]);

  useEffect(() => { load(); }, [load]);

  async function add(payload) {
    setBusy(true); setError('');
    try {
      const json = await call(`${API}/groups/${groupKey}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      setData(p => ({ ...p, members: json.members }));
      setAdding(''); setAddress('');
      onChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function remove(memberId) {
    setError('');
    try {
      const json = await call(`${API}/groups/${groupKey}/members/${memberId}`, { method: 'DELETE' });
      setData(p => ({ ...p, members: json.members }));
      onChanged();
    } catch (e) { setError(e.message); }
  }

  if (!data) return <div className="card text-sm text-gray-500">Loading…</div>;

  const members    = data.members ?? [];
  const alreadyIn  = new Set(members.map(m => m.directoryId).filter(Boolean));
  const candidates = (data.candidates ?? []).filter(c => !alreadyIn.has(c.id));

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-church-gold hover:text-church-navy">← All groups</button>

      <div className="card">
        <h3 className="font-semibold text-church-navy">{data.group.name}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{data.group.description}</p>

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        <div className="mt-4 space-y-1">
          {members.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">Nobody in this group yet.</p>
          ) : members.map(member => (
            <div key={member.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-church-navy">{member.name || member.email}</p>
                {member.name && <p className="text-xs text-gray-500">{member.email || 'No address on file'}</p>}
                {!member.email && (
                  <p className="text-xs text-amber-700">
                    No address on file — they will not receive group mail.
                  </p>
                )}
              </div>
              <button
                onClick={() => remove(member.id)}
                className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Add from the directory</span>
            <div className="flex gap-2 mt-1">
              <select
                value={adding}
                onChange={e => setAdding(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
              >
                <option value="">Choose someone…</option>
                {candidates.map(c => <option key={c.id} value={c.id}>{c.name} — {c.email}</option>)}
              </select>
              <button
                disabled={!adding || busy}
                onClick={() => add({ directoryId: Number(adding) })}
                className="btn-primary text-sm disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {candidates.length === 0 && (
              <span className="text-xs text-gray-400 mt-1 block">
                Everyone in the directory with an address is already in this group.
              </span>
            )}
          </label>

          <label className="block">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Or add an address directly
            </span>
            <div className="flex gap-2 mt-1">
              <input
                type="email"
                value={address}
                placeholder="name@example.com"
                onChange={e => setAddress(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
              />
              <button
                disabled={!address.trim() || busy}
                onClick={() => add({ email: address })}
                className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function MailGroupsView() {
  const [data, setData]   = useState(null);
  const [open, setOpen]   = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    call(`${API}/groups`).then(setData).catch(e => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="card text-center py-10 text-red-600 text-sm">{error}</div>;
  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-heading mb-0">Email Groups</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Lists this site sends to — used by workflow notifications.
        </p>
      </div>

      {data.mail.redirecting && (
        <div className="card border border-amber-200 bg-amber-50 text-sm text-amber-900">
          <strong>Test mode.</strong> Every message is being delivered to{' '}
          <span className="font-mono">{data.mail.redirectTo}</span> instead of its real recipient,
          whatever these groups say, except to the roles and people an admin has turned on under
          Admin → Email Delivery.
        </div>
      )}

      {!data.mail.configured && (
        <div className="card border border-gray-200 bg-gray-50 text-sm text-gray-700">
          No mail server is configured (<span className="font-mono">SMTP_HOST</span> is unset), so
          messages are queued but not sent. Nothing is lost — they will go out once it is set.
        </div>
      )}

      {open ? (
        <GroupDetail groupKey={open} onBack={() => setOpen(null)} onChanged={load} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.groups.map(group => (
              <button
                key={group.key}
                onClick={() => setOpen(group.key)}
                className="card text-left hover:border-church-gold/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-church-navy text-sm">{group.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{group.description}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {group.reachable}/{group.memberCount}
                  </span>
                </div>
                {group.missing.length > 0 && (
                  <p className="text-xs text-amber-700 mt-2">
                    {group.missing.length} with no address on file
                  </p>
                )}
              </button>
            ))}
          </div>

          <p className="text-xs text-gray-400">
            The count is how many can actually be reached out of how many are on the list.
            A group is a list this site sends to — an address people can write <em>to</em>{' '}
            (elders@…) has to be set up with your mail provider.
          </p>

          <p className="text-xs text-gray-400">
            What has been sent to these lists, and every other email the site sends, is on
            Church Office → Emails.
          </p>
        </>
      )}
    </div>
  );
}
