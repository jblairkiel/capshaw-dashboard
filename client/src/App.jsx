import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import OrderOfService from './components/OrderOfService';
import CalendarView from './components/CalendarView';
import JobAssignments from './components/JobAssignments';
import AttendanceView from './components/AttendanceView';
import SermonsView from './components/SermonsView';
import VisitorTracker from './components/VisitorTracker';
import AnniversariesView from './components/AnniversariesView';
import LeadershipView from './components/LeadershipView';
import BibleClassView from './components/BibleClassView';
import AnnouncementsView from './components/AnnouncementsView';
import AnnouncementsDisplay from './components/AnnouncementsDisplay';
import LoginPage from './components/LoginPage';
import UsersView from './components/UsersView';
import SongTrackerView from './components/SongTrackerView';
import DatabaseAdminView from './components/DatabaseAdminView';
import DirectoryView from './components/DirectoryView';

const API = '/api/members';

const BASE_GROUPS = [
  {
    id: 'worship',
    label: 'Worship',
    items: [
      { id: 'order',         label: 'Order of Service' },
      { id: 'songs',         label: 'Song Tracker' },
      { id: 'announcements', label: 'Announcements' },
    ],
  },
  {
    id: 'congregation',
    label: 'Congregation',
    items: [
      { id: 'assignments',   label: 'Job Assignments' },
      { id: 'attendance',    label: 'Attendance' },
      { id: 'visitors',      label: 'Visitors' },
      { id: 'anniversaries', label: 'Anniversaries' },
      { id: 'leadership',    label: 'Leadership' },
      { id: 'sermons',       label: 'Sermons' },
    ],
  },
  {
    id: 'resources',
    label: 'Resources',
    items: [
      { id: 'bible-class', label: 'Bible Class' },
      { id: 'calendar',    label: 'Calendar' },
    ],
  },
];

const STANDALONE_TABS = new Set(['bible-class', 'announcements', 'order', 'calendar', 'users', 'songs', 'database', 'directory']);

// ─── Nav dropdown ──────────────────────────────────────────────────────────────

function NavDropdown({ group, activeTab, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const isActive   = group.items.some(i => i.id === activeTab);
  const activeItem = group.items.find(i => i.id === activeTab);

  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
          isActive
            ? 'border-church-gold text-church-gold'
            : 'border-transparent text-gray-300 hover:text-white'
        }`}
      >
        <span>{group.label}</span>
        {isActive && activeItem && (
          <span className="text-xs opacity-60">· {activeItem.label}</span>
        )}
        <svg
          className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 bg-white rounded-b-lg shadow-xl border border-gray-200 min-w-44 z-50 py-1">
          {group.items.map(item => (
            <button
              key={item.id}
              onClick={() => { onSelect(item.id); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                activeTab === item.id
                  ? 'bg-church-cream text-church-navy font-semibold'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-church-navy'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MainApp() {
  const [activeTab,   setActiveTab]   = useState('assignments');
  const [siteData,    setSiteData]    = useState(null);
  const [updating,    setUpdating]    = useState(false);
  const [updateError,    setUpdateError]    = useState('');
  const [updateWarnings, setUpdateWarnings] = useState([]);
  const [user,        setUser]        = useState(undefined); // undefined=loading, null=not authed
  const [showLogin,   setShowLogin]   = useState(() =>
    !!new URLSearchParams(window.location.search).get('auth_error')
  );

  const authError = new URLSearchParams(window.location.search).get('auth_error');

  // Load current auth session
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(j => setUser(j?.user ?? null))
      .catch(() => setUser(null));
  }, []);

  // Load scraped data — re-runs when auth resolves so a login mid-session still loads data
  useEffect(() => {
    if (user === undefined) return; // still checking auth, wait
    fetch(`${API}/data`, { credentials: 'include' })
      .then(r => r.json())
      .then(j => { if (j.success && j.data) setSiteData(j.data); })
      .catch(() => {});
  }, [user]);

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    setUpdateError('');
    setUpdateWarnings([]);
    try {
      const res  = await fetch(`${API}/update`, { method: 'POST', credentials: 'include' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Update failed');
      if (json.warnings?.length) setUpdateWarnings(json.warnings);
      const dataRes  = await fetch(`${API}/data`, { credentials: 'include' });
      const dataJson = await dataRes.json();
      if (dataJson.success && dataJson.data) setSiteData(dataJson.data);
    } catch (e) {
      setUpdateError(e.message);
    } finally {
      setUpdating(false);
    }
  }, []);

  // Auth loading
  if (user === undefined) {
    return (
      <div className="min-h-screen bg-church-cream flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-church-gold" />
      </div>
    );
  }

  // Show login page when explicitly requested or after an OAuth redirect error
  if (user === null && showLogin) {
    return <LoginPage authError={authError} onBack={() => setShowLogin(false)} />;
  }

  const canWrite = user?.role === 'admin';
  const GROUPS = user?.role === 'admin'
    ? [...BASE_GROUPS, { id: 'admin', label: 'Admin', items: [{ id: 'users', label: 'Users' }, { id: 'database', label: 'Database' }, { id: 'directory', label: 'Directory' }] }]
    : BASE_GROUPS;

  const lastUpdated = siteData?.lastUpdated
    ? new Date(siteData.lastUpdated).toLocaleString()
    : null;

  return (
    <div className="min-h-screen bg-church-cream flex flex-col">
      <Header user={user} onLogout={() => setUser(null)} onSignIn={() => setShowLogin(true)} />

      {/* Pending approval banner */}
      {user?.role === 'pending' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm text-amber-800 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <span>
            <strong>Your account is pending approval.</strong> You can view everything, but creating and editing content requires approval from an admin.
          </span>
        </div>
      )}

      {/* Nav */}
      <div className="bg-church-navy shadow-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center">
          <div className="flex flex-1 min-w-0">
            {GROUPS.map(group => (
              <NavDropdown
                key={group.id}
                group={group}
                activeTab={activeTab}
                onSelect={setActiveTab}
              />
            ))}
          </div>

          {/* Update button */}
          <div className="flex items-center gap-2 px-3 border-l border-white/10 shrink-0">
            {lastUpdated && (
              <span className="text-xs text-gray-400 hidden lg:block">
                Updated {lastUpdated}
              </span>
            )}
            {canWrite && (
              <button
                onClick={handleUpdate}
                disabled={updating}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  updating
                    ? 'border-gray-600 text-gray-500 cursor-not-allowed'
                    : 'border-church-gold text-church-gold hover:bg-church-gold hover:text-church-navy'
                }`}
              >
                {updating ? (
                  <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" />
                ) : (
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                <span className="hidden sm:inline">{updating ? 'Updating…' : 'Update'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {updateError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700 text-center">
          Update failed: {updateError}
          <button onClick={() => setUpdateError('')} className="ml-3 underline">dismiss</button>
        </div>
      )}

      {/* Warnings banner */}
      {updateWarnings.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
          <div className="max-w-6xl mx-auto flex items-start gap-2">
            <span className="font-medium shrink-0">Update warnings:</span>
            <ul className="list-disc list-inside space-y-0.5 flex-1">
              {updateWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            <button onClick={() => setUpdateWarnings([])} className="ml-3 underline shrink-0">dismiss</button>
          </div>
        </div>
      )}

      {/* No data yet (only for data-dependent tabs) */}
      {!siteData && !updating && !STANDALONE_TABS.has(activeTab) && (
        <div className="max-w-6xl mx-auto px-4 py-16 text-center">
          <div className="inline-block bg-white rounded-xl shadow p-8 border border-gray-100">
            <svg className="w-12 h-12 text-church-gold mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <h2 className="text-lg font-semibold text-church-navy mb-2">No data yet</h2>
            <p className="text-gray-500 text-sm mb-4">
              Click <strong>Update</strong> to pull the latest data from capshawchurch.org.
            </p>
            {canWrite && (
              <button onClick={handleUpdate} className="btn-primary">Update Site</button>
            )}
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {updating && (
        <div className="max-w-6xl mx-auto px-4 py-16 text-center">
          <div className="inline-block bg-white rounded-xl shadow p-8 border border-gray-100">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-church-gold mx-auto mb-4" />
            <p className="text-church-navy font-medium">Scraping capshawchurch.org…</p>
            <p className="text-gray-400 text-sm mt-1">Logging in and fetching all sections</p>
          </div>
        </div>
      )}

      {/* Standalone tabs (no scraped data needed) */}
      {!updating && activeTab === 'songs' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <SongTrackerView user={user} />
        </main>
      )}
      {!updating && activeTab === 'bible-class' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <BibleClassView user={user} />
        </main>
      )}
      {!updating && activeTab === 'announcements' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <AnnouncementsView user={user} />
        </main>
      )}
      {!updating && activeTab === 'order' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <OrderOfService user={user} />
        </main>
      )}
      {!updating && activeTab === 'calendar' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <CalendarView />
        </main>
      )}
      {!updating && activeTab === 'users' && user?.role === 'admin' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <UsersView currentUser={user} />
        </main>
      )}
      {!updating && activeTab === 'database' && user?.role === 'admin' && (
        <main className="w-full px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <DatabaseAdminView />
        </main>
      )}
      {!updating && activeTab === 'directory' && user?.role === 'admin' && (
        <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <DirectoryView />
        </main>
      )}

      {/* Data-dependent tabs */}
      {siteData && !updating && !STANDALONE_TABS.has(activeTab) && (
        <main className={`${activeTab === 'assignments' ? 'w-full' : 'max-w-6xl mx-auto'} px-3 sm:px-4 py-4 sm:py-6 flex-1`}>
          {activeTab === 'assignments'   && <JobAssignments data={siteData.jobAssignments} />}
          {activeTab === 'attendance'    && <AttendanceView data={siteData.attendance} />}
          {activeTab === 'sermons'       && <SermonsView data={siteData.sermons} />}
          {activeTab === 'visitors'      && <VisitorTracker data={siteData.visitors} />}
          {activeTab === 'anniversaries' && <AnniversariesView data={siteData.anniversaries} />}
          {activeTab === 'leadership'    && <LeadershipView deacons={siteData.deacons} bulletins={siteData.bulletins} />}
        </main>
      )}

      <footer className="py-6 text-center text-sm text-gray-500 border-t border-gray-200 mt-auto">
        Capshaw Church of Christ &mdash; Internal Worship Dashboard
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/display" element={<AnnouncementsDisplay />} />
        <Route path="/*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  );
}
