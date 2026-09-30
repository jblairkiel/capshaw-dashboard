import { useState, useEffect, useCallback } from 'react';
import { hasArea } from '../lib/roles';
import LibraryView from './upcoming/LibraryView';

// ─── Analytics view ────────────────────────────────────────────────────────────

function Bar({ value, max, className = 'bg-church-gold' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-2 rounded-full transition-all ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function AnalyticsView() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    fetch('/api/songs/analytics')
      .then(r => r.json())
      .then(j => {
        if (j.success) setData(j);
        else setError(j.error || 'Failed to load analytics');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <span className="animate-spin inline-block w-8 h-8 border-2 border-church-gold border-t-transparent rounded-full" />
    </div>
  );
  if (error) return <p className="text-sm text-red-600 card py-4 px-4">{error}</p>;
  if (!data) return null;

  const { topSongs, byService, byLeader, monthly, totals } = data;
  const maxSong    = topSongs[0]?.count    || 1;
  const maxService = byService[0]?.count   || 1;
  const maxLeader  = byLeader[0]?.count    || 1;
  const maxMonth   = Math.max(...monthly.map(m => m.count), 1);

  const fmtDate = iso => iso
    ? new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const fmtMonth = ym => {
    const [y, m] = ym.split('-');
    return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  };

  return (
    <div className="space-y-5">

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Services',     value: totals.services    },
          { label: 'Unique Songs', value: totals.uniqueSongs },
          { label: 'Song Plays',   value: totals.plays       },
        ].map(s => (
          <div key={s.label} className="card text-center py-4">
            <p className="text-2xl font-bold text-church-navy">{s.value.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top songs */}
        <div className="card space-y-3">
          <h3 className="section-heading mb-0">Most Sung Songs</h3>
          {topSongs.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No data yet — sync first.</p>
          ) : (
            <ul className="space-y-2">
              {topSongs.map((s, i) => (
                <li key={s.id}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-church-gold text-xs font-bold w-4 shrink-0 text-right">{i + 1}.</span>
                    <span className="text-sm font-medium text-church-navy truncate flex-1">{s.title}</span>
                    <span className="text-xs font-semibold text-church-navy shrink-0">{s.count}×</span>
                  </div>
                  <div className="flex items-center gap-2 pl-6">
                    <Bar value={s.count} max={maxSong} />
                    {s.last_sung && (
                      <span className="text-xs text-gray-400 shrink-0">last {fmtDate(s.last_sung)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right column: service breakdown + leaders */}
        <div className="space-y-5">

          {/* By service type */}
          <div className="card space-y-3">
            <h3 className="section-heading mb-0">By Service Type</h3>
            {byService.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No data yet.</p>
            ) : (
              <ul className="space-y-2">
                {byService.map(s => (
                  <li key={s.service} className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 w-32 shrink-0 truncate">{s.service}</span>
                    <Bar value={s.count} max={maxService} className="bg-church-navy" />
                    <span className="text-xs text-gray-500 shrink-0 w-8 text-right">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Top leaders */}
          <div className="card space-y-3">
            <h3 className="section-heading mb-0">Top Leaders</h3>
            {byLeader.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No data yet.</p>
            ) : (
              <ul className="space-y-2">
                {byLeader.map(l => (
                  <li key={l.leader} className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 w-36 shrink-0 truncate">{l.leader}</span>
                    <Bar value={l.count} max={maxLeader} className="bg-church-gold/70" />
                    <span className="text-xs text-gray-500 shrink-0 w-8 text-right">{l.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Monthly activity */}
      {monthly.length > 0 && (
        <div className="card space-y-3">
          <h3 className="section-heading mb-0">Monthly Activity (last 12 months)</h3>
          <div className="flex items-end gap-1 h-20">
            {monthly.map(m => {
              const pct = Math.round((m.count / maxMonth) * 100);
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    {m.count}
                  </span>
                  <div className="w-full bg-church-navy rounded-sm" style={{ height: `${Math.max(pct, 4)}%` }} />
                  <span className="text-xs text-gray-400 rotate-0 truncate w-full text-center leading-tight">
                    {fmtMonth(m.month)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Service card ──────────────────────────────────────────────────────────────

function ServiceCard({ record, canWrite }) {
  const [open,       setOpen]       = useState(false);
  const [songs,      setSongs]      = useState(record.songs || null);
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const toggle = async () => {
    if (!open && !songs) {
      setLoading(true);
      try {
        const r = await fetch(`/api/songs/${record.id}`);
        const j = await r.json();
        if (j.success) setSongs(j.songs);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    setOpen(o => !o);
  };

  const refresh = async e => {
    e.stopPropagation();
    setRefreshing(true);
    try {
      const r = await fetch(`/api/songs/${record.id}/refresh`, { method: 'POST' });
      const j = await r.json();
      if (j.success) setSongs(j.songs);
    } catch { /* ignore */ }
    finally { setRefreshing(false); }
  };

  const dateStr = record.date
    ? new Date(record.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className="card py-3 px-4">
      <button onClick={toggle} className="w-full flex items-center gap-3 text-left">
        <svg
          className={`w-4 h-4 text-church-gold shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-church-navy text-sm">{record.service}</span>
            <span className="text-gray-400 text-xs">&middot;</span>
            <span className="text-gray-600 text-sm">{dateStr}</span>
            {record.leader && (
              <>
                <span className="text-gray-400 text-xs">&middot;</span>
                <span className="text-gray-500 text-sm">{record.leader}</span>
              </>
            )}
          </div>
        </div>
        <span className="shrink-0 text-xs text-gray-400">
          {loading ? '…' : songs ? `${songs.length} songs` : record.song_count != null ? `${record.song_count} songs` : ''}
        </span>
      </button>

      {open && songs && (
        <div className="mt-3 ml-7 border-t border-gray-100 pt-3">
          <ul className="space-y-1.5">
            {songs.length === 0 && (
              <li className="text-sm text-gray-400 italic">No songs recorded</li>
            )}
            {songs.map((s, i) => (
              <li key={s.id ?? i} className="flex items-baseline gap-2">
                <span className="text-church-gold text-xs font-bold w-4 shrink-0">{i + 1}.</span>
                <span className="text-sm text-church-navy font-medium">{s.title}</span>
                {(s.number || s.hymnal) && (
                  <span className="text-xs text-gray-400">
                    {[s.number && `#${s.number}`, s.hymnal].filter(Boolean).join(' — ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {/* Only an imported record has anywhere to refresh from. */}
          {canWrite && record.source !== 'portal' && (
            <button
              onClick={refresh}
              disabled={refreshing}
              className="mt-2.5 flex items-center gap-1 text-xs text-gray-400 hover:text-church-navy transition-colors disabled:opacity-50"
            >
              {refreshing ? (
                <span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {refreshing ? 'Refreshing…' : 'Refresh from server'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Service filter chips ──────────────────────────────────────────────────────

const SERVICE_FILTERS = ['All', 'Sun AM', 'Sun PM', 'Wed', 'Singing', 'Other'];

// ─── Main view ─────────────────────────────────────────────────────────────────

// The Upcoming Service page's history of what was sung. Services are added by
// submitting them (the Submit a Service tab); "Add" goes there. Older history
// can still be imported from capshawchurch.org's song database.
export default function SongTrackerView({ user, onSubmitService, version = 0 }) {
  const canWrite = hasArea(user, 'songs');

  const [view,     setView]     = useState('history');  // 'history' | 'analytics' | 'library'
  const [records,  setRecords]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState('All');
  const [searchQ,  setSearchQ]  = useState('');
  const [syncing,  setSyncing]  = useState(false);
  const [syncInfo, setSyncInfo] = useState('');
  const [offset,   setOffset]   = useState(0);
  const [hasMore,  setHasMore]  = useState(false);
  const LIMIT = 25;

  const loadRecords = useCallback(async (off = 0, replace = true) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: off });
      if (filter !== 'All') params.set('service', filter);
      if (searchQ.trim())   params.set('q', searchQ.trim());
      const r = await fetch(`/api/songs?${params}`);
      const j = await r.json();
      if (j.success) {
        setRecords(prev => replace ? j.records : [...prev, ...j.records]);
        setHasMore(j.records.length === LIMIT);
        setOffset(off);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filter, searchQ]);

  useEffect(() => { loadRecords(0); }, [loadRecords, version]);

  const sync = async () => {
    setSyncing(true);
    setSyncInfo('');
    try {
      const r = await fetch('/api/songs/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error);
      setSyncInfo(`Imported ${j.synced} records`);
      loadRecords(0);
    } catch (e) {
      setSyncInfo(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">

      {/* View toggle + action buttons */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1">
          {['history', 'analytics', 'library'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                view === v
                  ? 'bg-church-navy border-church-navy text-white'
                  : 'border-gray-200 text-gray-600 hover:border-gray-400'
              }`}
            >
              {{ history: 'History', analytics: 'Analytics', library: 'Library' }[v]}
            </button>
          ))}
        </div>

        {canWrite && view === 'history' && (
          <div className="flex items-center gap-2">
            <button
              onClick={sync}
              disabled={syncing}
              className="flex items-center gap-1.5 text-xs border border-gray-300 px-2.5 py-1.5 rounded-lg text-church-navy hover:border-church-gold hover:text-church-gold transition-colors disabled:opacity-50"
            >
              {syncing ? (
                <span className="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Import from capshawchurch.org
            </button>
            <button
              onClick={() => onSubmitService?.()}
              className="flex items-center gap-1.5 text-xs btn-primary py-1.5 px-2.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add
            </button>
          </div>
        )}
      </div>

      {/* Analytics panel */}
      {view === 'analytics' && <AnalyticsView />}

      {view === 'library' && <LibraryView version={version} />}

      {/* History panel */}
      {view === 'history' && (
        <>
          {/* Filter chips + search */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex gap-1.5 flex-wrap flex-1">
              {SERVICE_FILTERS.map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    filter === f
                      ? 'border-church-navy bg-church-navy text-white'
                      : 'border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Search songs…"
                className="pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-church-navy w-36 sm:w-44"
              />
            </div>
          </div>

          {syncInfo && (
            <p className={`text-xs px-3 py-1.5 rounded-lg ${syncInfo.startsWith('Sync failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {syncInfo}
            </p>
          )}

          {loading && records.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <span className="animate-spin inline-block w-8 h-8 border-2 border-church-gold border-t-transparent rounded-full" />
            </div>
          ) : records.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-gray-400 text-sm">No service records found.</p>
              {canWrite && (
                <p className="text-gray-400 text-xs mt-1">
                  Submit a service to start the history, or import it from capshawchurch.org.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {records.map(r => <ServiceCard key={r.id} record={r} canWrite={canWrite} />)}
              {hasMore && (
                <div className="text-center pt-2">
                  <button
                    onClick={() => loadRecords(offset + LIMIT, false)}
                    disabled={loading}
                    className="text-sm border border-gray-300 px-4 py-1.5 rounded-lg text-church-navy hover:border-church-gold hover:text-church-gold transition-colors disabled:opacity-50"
                  >
                    {loading ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
