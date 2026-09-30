import { useState, useEffect, useCallback } from 'react';
import SongTrackerView from './SongTrackerView';
import OrderTab from './upcoming/OrderTab';
import SubmitTab from './upcoming/SubmitTab';
import RequestsTab from './upcoming/RequestsTab';
import PartsTab from './upcoming/PartsTab';
import { AddSongDialog, Tabs } from './upcoming/shared';
import { call } from './upcoming/api';

// ─── Upcoming Service ─────────────────────────────────────────────────────────
//
// Everything about Sunday's worship on one page, a tab each:
//   Order of Worship   the services coming up, as submitted, and the printed
//                      order of service
//   Submit a Service   the song leader lays out a service; the organizer confirms
//   Song Tracker       what has been sung, when, and by whom
//   Song Requests      members asking for a song
//   Service Parts      what a service is made of (the worship organizer's)
//
// One overview — the services coming up, open requests, the parts — is read
// here and handed to every tab, so a change on one shows on the others. A song
// can be added from the header or from any song picker.

export default function UpcomingServiceView({ user, tab = 'order', onTabChange, initialPlanId = null }) {
  const [overview, setOverview] = useState(null);
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [notice, setNotice]     = useState(null);  // { text, error }
  const [selection, setSelection] = useState(null);
  const [adding, setAdding]     = useState(false);
  const [version, setVersion]   = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await call('/api/worship/overview');
      setOverview({ upcoming: [], requests: [], parts: [], services: [], ...data });
      setError('');
    }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const changed = useCallback(() => { load(); setVersion(v => v + 1); }, [load]);

  // A link to one service (the organizer's email) opens it on the Submit tab.
  useEffect(() => {
    if (!initialPlanId) return;
    call(`/api/worship/plans/${initialPlanId}`)
      .then(({ plan }) => { setSelection({ date: plan.date, service: plan.service }); onTabChange?.('service'); })
      .catch(() => {});
  }, [initialPlanId]); // eslint-disable-line react-hooks/exhaustive-deps -- once, for the link that opened the page

  // The first service coming up is the one most people are here about.
  useEffect(() => {
    if (!selection && overview?.upcoming.length) {
      const first = overview.upcoming.find(u => u.canSubmit && !u.plan) || overview.upcoming[0];
      setSelection({ date: first.date, service: first.service });
    }
  }, [overview, selection]);

  function openService(date, service) {
    setSelection({ date, service });
    onTabChange?.('service');
  }

  async function confirm(plan) {
    setBusy(true); setNotice(null);
    try {
      await call(`/api/worship/plans/${plan.id}/confirm`, { method: 'POST' });
      setNotice({ text: `Confirmed the ${plan.service}. Its songs are now in the song tracker.` });
      changed();
    } catch (e) { setNotice({ text: e.message, error: true }); }
    finally { setBusy(false); }
  }

  if (!overview) {
    return <div className="card text-sm text-gray-500">{error ? <span className="text-red-600">{error}</span> : 'Loading…'}</div>;
  }

  const tabs = [
    { id: 'order',    label: 'Order of Worship' },
    { id: 'service',  label: 'Submit a Service', count: overview.canOrganize ? overview.upcoming.filter(u => u.plan?.status === 'submitted').length : 0 },
    { id: 'tracker',  label: 'Song Tracker' },
    { id: 'requests', label: 'Song Requests', count: overview.requests.filter(r => r.status === 'open').length },
    ...(overview.canOrganize ? [{ id: 'parts', label: 'Service Parts' }] : []),
  ];
  const active = tabs.some(t => t.id === tab) ? tab : 'order';

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-heading mb-1">Upcoming Service</h2>
          <p className="text-sm text-gray-500">The order of worship, the songs, and who is doing what.</p>
        </div>
        {user?.role !== 'pending' && (
          <button onClick={() => setAdding(true)} className="px-3 py-1.5 text-sm rounded-lg border border-church-navy text-church-navy hover:bg-church-cream">
            + Add a song
          </button>
        )}
      </div>

      <Tabs tabs={tabs} active={active} onChange={id => { setNotice(null); onTabChange?.(id); }} />

      {notice && (
        <div className={`card text-sm py-3 ${notice.error ? 'text-red-600' : 'text-emerald-700'}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>
      )}

      {active === 'order' && <OrderTab overview={overview} user={user} busy={busy} onOpen={openService} onConfirm={confirm} />}
      {active === 'service' && <SubmitTab overview={overview} selection={selection} onSelect={setSelection} onChanged={changed} />}
      {active === 'tracker' && <SongTrackerView user={user} version={version} onSubmitService={() => onTabChange?.('service')} />}
      {active === 'requests' && <RequestsTab overview={overview} user={user} onChanged={changed} />}
      {active === 'parts' && <PartsTab onChanged={changed} />}

      {adding && (
        <AddSongDialog
          onClose={() => setAdding(false)}
          onAdded={(song, { existing }) => {
            setAdding(false);
            setNotice({ text: existing ? `“${song.title}” is already in the song list.` : `Added “${song.title}” to the song list. It can be chosen on every tab now.` });
            setVersion(v => v + 1);
          }}
        />
      )}
    </div>
  );
}
