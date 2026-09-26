import { useState, useEffect, useCallback } from 'react';
import { MeetingCard, MeetingEditor } from './GroupMeeting';
import { call, GROUP_ROLES, groupRoleInfo } from '../lib/groups';

// ─── Church Groups ────────────────────────────────────────────────────────────
//
// The page three different people open, and it shows each of them something
// different without them having to choose:
//
//   · a member sees what is coming up in their own groups, and can answer an
//     invitation, sign up for something and reply, from the landing page
//   · a leader sees their own group with a "post a meeting" button on it, and
//     the roll to keep
//   · whoever looks after every group sees all of that plus the generator and
//     the new-group form
//
// The server decides all of it — `canManage` and each group's `perms` come
// back with the data rather than being worked out from the account here.

// ─── Generating the set ───────────────────────────────────────────────────────

function GenerateGroups({ onDone }) {
  const [count,   setCount]   = useState(6);
  const [prefix,  setPrefix]  = useState('Group');
  const [domain,  setDomain]  = useState('');
  const [meets,   setMeets]   = useState('');
  const [assign,  setAssign]  = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const [result,  setResult]  = useState(null);

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';

  async function generate(e) {
    e.preventDefault();
    const summary = assign
      ? `Make ${count} groups and spread everybody in the directory across them?`
      : `Make ${count} empty groups?`;
    if (!confirm(summary)) return;

    setBusy(true); setError(''); setResult(null);
    try {
      const json = await call('/api/groups/generate', {
        method: 'POST',
        body: JSON.stringify({ count, prefix, emailDomain: domain, meets, assignMembers: assign }),
      });
      setResult(json);
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={generate} className="card space-y-4">
      <div>
        <h3 className="font-semibold text-church-navy">Generate the groups</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Makes the whole set at once, each with its own distribution list. Running it again tops
          the set up: groups that already exist are left alone, and nobody already on a roll is moved.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">How many</span>
          <input
            type="number" min="1" max="50" value={count}
            onChange={e => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            className={field}
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Called</span>
          <input value={prefix} onChange={e => setPrefix(e.target.value)} className={field} placeholder="Group" />
        </label>
        <label className="block col-span-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email domain</span>
          <input
            value={domain}
            onChange={e => setDomain(e.target.value)}
            aria-label="Email domain"
            className={field}
            placeholder="capshawchurch.org"
          />
          <span className="text-xs text-gray-400">
            Gives each group an address like group-1@… — it still has to exist at the mail provider.
          </span>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">When they meet</span>
        <input value={meets} onChange={e => setMeets(e.target.value)} className={field} placeholder="Second Sunday evening" />
      </label>

      <label className="flex items-start gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={assign} onChange={e => setAssign(e.target.checked)} className="mt-1" />
        <span>
          Spread the directory across them.
          <span className="block text-xs text-gray-400">
            Households stay together, and anybody already in a group stays where they are.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="text-sm bg-church-cream rounded-lg p-3 space-y-1">
          <p className="text-church-navy">
            Made {result.created.length} group{result.created.length === 1 ? '' : 's'}
            {result.assigned?.placed ? `, placing ${result.assigned.placed} people` : ''}.
          </p>
          {result.skipped?.length > 0 && (
            <p className="text-xs text-gray-500">Left alone, already there: {result.skipped.join(', ')}</p>
          )}
        </div>
      )}

      <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
        {busy ? 'Making them…' : 'Generate'}
      </button>
    </form>
  );
}

// ─── One group by hand ────────────────────────────────────────────────────────

function NewGroup({ onDone }) {
  const [open,  setOpen]  = useState(false);
  const [form,  setForm]  = useState({ name: '', meets: '', location: '', email: '', description: '' });
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';
  const set = (key, value) => setForm(p => ({ ...p, [key]: value }));

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-church-gold hover:text-church-navy">
        + Add one group by hand
      </button>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await call('/api/groups', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', meets: '', location: '', email: '', description: '' });
      setOpen(false);
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-2 border-church-gold">
      <h3 className="font-semibold text-church-navy">A new group</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</span>
          <input value={form.name} onChange={e => set('name', e.target.value)} className={field} placeholder="North Harvest" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">When it meets</span>
          <input value={form.meets} onChange={e => set('meets', e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Where</span>
          <input value={form.location} onChange={e => set('location', e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Group address</span>
          <input value={form.email} onChange={e => set('email', e.target.value)} className={field} placeholder="north@capshawchurch.org" />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">Create</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-church-navy">Cancel</button>
      </div>
    </form>
  );
}

// ─── The roll ─────────────────────────────────────────────────────────────────

function Roll({ group, members, candidates, perms, onChanged }) {
  const [adding, setAdding] = useState('');
  const [role,   setRole]   = useState('member');
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState('');

  async function change(path, options) {
    setBusy(true); setError('');
    try {
      await call(`/api/groups/${group.id}${path}`, options);
      onChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-church-navy">Who is in it</h3>
        <span className="text-xs text-gray-400">{members.length} on the roll</span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {members.length === 0 ? (
        <p className="text-sm text-gray-400">Nobody yet.</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {members.map(member => (
            <li key={member.id} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-church-navy truncate">{member.name}</p>
                <p className="text-xs text-gray-500 truncate">
                  {member.email || 'No address on file — they will not get the group\'s email'}
                </p>
              </div>

              {perms.leads ? (
                <select
                  value={member.role}
                  disabled={busy}
                  aria-label={`${member.name}'s part in the group`}
                  onChange={e => change(`/members/${member.id}`, {
                    method: 'PATCH', body: JSON.stringify({ role: e.target.value }),
                  })}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-church-gold"
                >
                  {GROUP_ROLES.map(r => (
                    // Only the group manager appoints a leader, so a leader is
                    // not offered a choice the server would refuse.
                    <option key={r.id} value={r.id} disabled={r.leads && !perms.manages}>{r.label}</option>
                  ))}
                </select>
              ) : (
                <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${groupRoleInfo(member.role).tone}`}>
                  {member.roleLabel}
                </span>
              )}

              {perms.leads && (
                <button
                  onClick={() => change(`/members/${member.id}`, { method: 'DELETE' })}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 shrink-0 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {perms.leads && (
        <div className="pt-3 border-t border-gray-100 flex flex-wrap gap-2 items-end">
          <label className="block flex-1 min-w-[12rem]">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add from the directory</span>
            <select
              value={adding}
              onChange={e => setAdding(e.target.value)}
              className="mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
            >
              <option value="">Choose someone…</option>
              {candidates.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ''}</option>)}
            </select>
          </label>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            aria-label="What they will be in the group"
            className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-church-gold"
          >
            {GROUP_ROLES.map(r => <option key={r.id} value={r.id} disabled={r.leads && !perms.manages}>{r.label}</option>)}
          </select>
          <button
            disabled={!adding || busy}
            onClick={() => change('/members', {
              method: 'POST', body: JSON.stringify({ directoryId: Number(adding), role }),
            }).then(() => setAdding(''))}
            className="btn-primary text-sm disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Keeping the group's own details ──────────────────────────────────────────

function GroupDetails({ group, perms, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [synced,  setSynced]  = useState('');
  const [form, setForm] = useState({
    name: group.name, description: group.description, meets: group.meets,
    location: group.location, email: group.email, active: group.active,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';
  const set = (key, value) => setForm(p => ({ ...p, [key]: value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await call(`/api/groups/${group.id}`, { method: 'PUT', body: JSON.stringify(form) });
      setEditing(false);
      onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="card space-y-3 border-2 border-church-gold">
        {perms.manages && (
          <label className="block">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</span>
            <input value={form.name} onChange={e => set('name', e.target.value)} className={field} />
          </label>
        )}
        <label className="block">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">About the group</span>
          <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} className={field} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">When it meets</span>
            <input value={form.meets} onChange={e => set('meets', e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Where</span>
            <input value={form.location} onChange={e => set('location', e.target.value)} className={field} />
          </label>
        </div>
        {perms.manages && (
          <>
            <label className="block">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Group address</span>
              <input value={form.email} onChange={e => set('email', e.target.value)} className={field} />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} />
              Still meeting
            </label>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-gray-500 hover:text-church-navy">Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-serif font-semibold text-church-navy">{group.name}</h2>
            {!group.active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">No longer meeting</span>}
            {perms.myRole && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${groupRoleInfo(perms.myRole).tone}`}>
                You are {groupRoleInfo(perms.myRole).label.toLowerCase()}
              </span>
            )}
          </div>
          {group.description && <p className="text-sm text-gray-600 mt-1">{group.description}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
            {group.meets    && <span>🗓 {group.meets}</span>}
            {group.location && <span>📍 {group.location}</span>}
            {group.email    && <span>✉️ {group.email}</span>}
            <span>{group.memberCount} on the roll</span>
          </div>
          {group.leaders?.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              Led by {group.leaders.map(l => l.name).join(' and ')}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          {perms.leads && (
            <button onClick={() => setEditing(true)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-church-gold">
              Edit the group
            </button>
          )}
          {/* Membership already syncs on every change; this is for a list
              somebody has edited by hand from Email Groups. */}
          {perms.manages && (
            <button
              onClick={async () => {
                setError('');
                try {
                  const json = await call(`/api/groups/${group.id}/sync-mail`, { method: 'POST' });
                  setSynced(`Mailing list set to the ${json.synced} on the roll.`);
                  onChanged();
                } catch (err) { setError(err.message); }
              }}
              className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500 hover:border-church-gold"
            >
              Sync the mailing list
            </button>
          )}
        </div>
      </div>

      {synced && <p className="text-xs text-emerald-700 mt-2">{synced}</p>}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}

// ─── One group ────────────────────────────────────────────────────────────────

function GroupDetail({ groupId, onBack, initialEventId }) {
  const [data,    setData]    = useState(null);
  const [writing, setWriting] = useState(null);   // null | 'new' | the meeting being edited
  const [error,   setError]   = useState('');

  const load = useCallback(() => {
    call(`/api/groups/${groupId}`)
      .then(setData)
      .catch(e => setError(e.message));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <p className="card text-sm text-red-600">{error}</p>;
  if (!data) return <p className="card text-sm text-gray-500">Loading…</p>;

  const { group, perms, members, events, candidates } = data;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-church-gold hover:text-church-navy">← All groups</button>

      <GroupDetails group={group} perms={perms} onChanged={load} />

      {!perms.canSeeRoll ? (
        <p className="card text-sm text-gray-500">
          You are not in this group, so its meetings and roll are not shown. Whoever looks after the
          church groups can add you.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="section-heading mb-0 border-b-0 pb-0">Meetings</h3>
            {perms.leads && !writing && (
              <button onClick={() => setWriting('new')} className="btn-primary text-sm">Post a meeting</button>
            )}
          </div>

          {writing && (
            <MeetingEditor
              groupId={group.id}
              event={writing === 'new' ? null : writing}
              onCancel={() => setWriting(null)}
              onSaved={() => { setWriting(null); load(); }}
            />
          )}

          {events.length === 0 ? (
            <p className="card text-sm text-gray-400">Nothing on the calendar for this group yet.</p>
          ) : (
            <div className="space-y-3">
              {events.map(event => (
                <MeetingCard
                  key={event.id}
                  groupId={group.id}
                  event={event}
                  canManage={perms.leads}
                  // The roll, so a leader can write down an answer for
                  // somebody who will never open the portal to give one.
                  members={members}
                  onChanged={load}
                  onEdit={setWriting}
                  defaultOpen={event.id === initialEventId}
                />
              ))}
            </div>
          )}

          <Roll group={group} members={members} candidates={candidates ?? []} perms={perms} onChanged={load} />
        </>
      )}
    </div>
  );
}

// ─── The landing page ─────────────────────────────────────────────────────────

function GroupCard({ group, onOpen, mine = false }) {
  const role = mine ? groupRoleInfo(group.myRole) : null;
  return (
    <button
      onClick={() => onOpen(group.id)}
      className="card text-left hover:border-church-gold transition-colors w-full"
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="font-semibold text-church-navy">{group.name}</p>
          {group.meets && <p className="text-xs text-gray-500 mt-0.5">🗓 {group.meets}</p>}
          {group.leaders?.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">Led by {group.leaders.map(l => l.name).join(' and ')}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {role && <span className={`text-xs px-2 py-0.5 rounded-full ${role.tone}`}>{role.label}</span>}
          <span className="text-xs text-gray-400">{group.memberCount} people</span>
          {!group.active && <span className="text-xs text-gray-400">retired</span>}
        </div>
      </div>
    </button>
  );
}

export default function GroupsView({ user, initialGroupId, initialEventId }) {
  const [data,   setData]   = useState(null);
  const [openId, setOpenId] = useState(initialGroupId ?? null);
  const [error,  setError]  = useState('');

  const load = useCallback(() => {
    call('/api/groups')
      .then(setData)
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (openId) {
    return (
      <GroupDetail
        groupId={openId}
        onBack={() => { setOpenId(null); load(); }}
        initialEventId={openId === initialGroupId ? initialEventId : null}
      />
    );
  }

  if (error) return <p className="card text-sm text-red-600">{error}</p>;
  if (!data) return <p className="card text-sm text-gray-500">Loading…</p>;

  const { groups, mine, upcoming, canManage, linkedToDirectory } = data;
  const others = groups.filter(g => !mine.some(m => m.id === g.id));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="section-heading">Church Groups</h2>
        <p className="text-sm text-gray-500 -mt-2">
          The smaller circles the congregation meets in through the week. Your group&apos;s meetings,
          who is coming, and what still needs bringing are all here.
        </p>
      </div>

      {/* ── What is coming up in my groups ──────────────────────────────── */}
      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Coming up</h3>
          {upcoming.map(event => (
            <MeetingCard
              key={event.id}
              groupId={event.groupId}
              event={event}
              canManage={false}
              onChanged={load}
              onEdit={() => setOpenId(event.groupId)}
            />
          ))}
        </section>
      )}

      {/* ── My groups ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">My groups</h3>
        {mine.length === 0 ? (
          <p className="card text-sm text-gray-500">
            {linkedToDirectory
              ? 'You are not in a group yet. Whoever looks after the church groups can add you to one.'
              : 'Your sign-in has not been matched to a directory entry yet, so you cannot be put on a group\'s roll. The church office can link it on Members & Access.'}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {mine.map(group => <GroupCard key={group.id} group={group} mine onOpen={setOpenId} />)}
          </div>
        )}
      </section>

      {/* ── Everything else ─────────────────────────────────────────────── */}
      {others.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">The other groups</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {others.map(group => <GroupCard key={group.id} group={group} onOpen={setOpenId} />)}
          </div>
        </section>
      )}

      {/* ── Looking after every group ───────────────────────────────────── */}
      {canManage && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Looking after the groups</h3>
          <GenerateGroups onDone={load} />
          <NewGroup onDone={load} />
        </section>
      )}

      {user?.role === 'pending' && (
        <p className="text-xs text-gray-400">
          Your account is waiting to be confirmed, so you can look but not answer or reply yet.
        </p>
      )}
    </div>
  );
}
