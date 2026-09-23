import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import OrderOfService from './components/OrderOfService';
import CalendarView from './components/CalendarView';
import AttendanceView from './components/AttendanceView';
import LivestreamsView from './components/LivestreamsView';
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
import MyProfileView from './components/MyProfileView';
import MobileNav from './components/MobileNav';
import InboxView from './components/InboxView';
import WorkflowDialogButton from './components/WorkflowDialogButton';
import MailGroupsView from './components/MailGroupsView';
import ServingSchedule from './components/ServingSchedule';
import ServiceRosterView from './components/ServiceRosterView';
import ActionHistoryView from './components/ActionHistoryView';
import WeeklyBulletinView from './components/WeeklyBulletinView';
import ImpersonationBanner from './components/ImpersonationBanner';
import GroupsView from './components/GroupsView';
import BugReportDialog from './components/BugReportDialog';
import BugReportsView from './components/BugReportsView';
import { hasWriteAccess, isAdmin, hasArea } from './lib/roles';

const API = '/api/members';

// Every tab id is unchanged — only the wording is, so the portal reads as a
// place for the whole church family rather than an internal staff tool.
const BASE_GROUPS = [
  {
    id: 'worship',
    label: 'Worship',
    items: [
      { id: 'order',         label: 'This Sunday' },
      { id: 'songs',         label: 'Songs We Sing' },
      { id: 'announcements', label: 'Announcements' },
    ],
  },
  {
    id: 'congregation',
    label: 'Our Church Family',
    items: [
      { id: 'assignments',   label: 'Serving Schedule' },
      { id: 'attendance',    label: 'Attendance' },
      { id: 'visitors',      label: 'Guests' },
      { id: 'groups',        label: 'Church Groups' },
      { id: 'anniversaries', label: 'Birthdays & Anniversaries' },
      { id: 'leadership',    label: 'Elders & Deacons' },
      { id: 'livestreams',   label: 'Livestreams' },
    ],
  },
  {
    id: 'resources',
    label: 'Grow',
    items: [
      { id: 'bible-class', label: 'Bible Class' },
      { id: 'calendar',    label: 'Church Calendar' },
    ],
  },
];

// Shown to anyone signed in: their own details and worship preferences.
const PROFILE_GROUP = {
  id: 'me',
  label: 'My Church',
  items: [
    { id: 'profile',   label: 'My Household & Preferences' },
    { id: 'inbox',     label: 'My Inbox' },
  ],
};

// Everything somebody looks after on the congregation's behalf. Each item is
// shown only to the people who can actually use it: an admin sees all of it,
// and a member sees the pages for the areas they hold and nothing else. The
// server checks the same thing on every request — this only decides what is
// worth showing.
const OFFICE_ITEMS = [
  { id: 'users',          label: 'Members & Access',  when: user => isAdmin(user) },
  { id: 'bug-reports',    label: 'Bug Reports',       when: user => isAdmin(user) },
  { id: 'action-history', label: 'Action History',    when: user => isAdmin(user) },
  { id: 'database',       label: 'Church Records',    when: user => isAdmin(user) },
  { id: 'service-roster', label: 'Service Roster',    when: user => hasArea(user, 'serving-schedule') },
  { id: 'directory',      label: 'Member Directory',  when: user => hasArea(user, 'directory') },
  { id: 'mail-groups',    label: 'Email Groups',      when: user => hasArea(user, 'mail-groups') },
  { id: 'bulletin',       label: 'Weekly Newsletter', when: user => hasArea(user, 'bulletin') },
];

function officeGroupFor(user) {
  const items = OFFICE_ITEMS.filter(item => item.when(user)).map(({ id, label }) => ({ id, label }));
  return items.length ? [{ id: 'admin', label: 'Church Office', items }] : [];
}

// Pages that fetch what they need themselves, rather than waiting on the
// scraped payload the app holds.
const STANDALONE_TABS = new Set([
  'bible-class', 'announcements', 'order', 'calendar', 'users', 'songs', 'database',
  'directory', 'profile', 'inbox', 'mail-groups', 'livestreams',
  'assignments', 'visitors', 'leadership', 'action-history','service-roster', 'bulletin',
  'groups', 'bug-reports',
]);

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
          <span className="text-xs opacity-60 hidden lg:inline">· {activeItem.label}</span>
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


function MainApp({ user, impersonatedBy, onStoppedImpersonating, onLogout }) {
  const [activeTab,   setActiveTab]   = useState('order');
  const [siteData,    setSiteData]    = useState(null);
  const [updating,    setUpdating]    = useState(false);
  const [updateError,    setUpdateError]    = useState('');
  const [updateWarnings, setUpdateWarnings] = useState([]);
  const [reportingBug,   setReportingBug]   = useState(false);

  // Load scraped data. Everyone here is signed in — the app root sees to that.
  useEffect(() => {
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

  const canWrite = hasWriteAccess(user);
  const admin    = isAdmin(user);
  const GROUPS = [
    ...BASE_GROUPS,
    PROFILE_GROUP,
    ...officeGroupFor(user),
  ];

  const lastUpdated = siteData?.lastUpdated
    ? new Date(siteData.lastUpdated).toLocaleString()
    : null;

  // What a bug report should say it was filed from — read off the same list
  // the nav is built from, so it always matches what the person actually sees.
  const activeLabel = GROUPS.flatMap(g => g.items).find(i => i.id === activeTab)?.label || '';

  return (
    <div className="min-h-screen bg-church-cream flex flex-col">
      {impersonatedBy && (
        <ImpersonationBanner user={user} impersonatedBy={impersonatedBy} onStopped={onStoppedImpersonating} />
      )}
      {/* The bell opens whatever it mentions, which is why the header needs
          to be able to change the tab. */}
      <Header user={user} onLogout={onLogout} onGoToPage={setActiveTab} />

      {/* Pending approval banner */}
      {user?.role === 'pending' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm text-amber-800 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <span>
            <strong>Welcome! Your account is waiting to be confirmed.</strong> You can look around the whole portal — once the church office confirms you as a member, you will be able to add and edit as well.
          </span>
        </div>
      )}

      {/* Nav */}
      <div className="bg-church-navy shadow-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center">
          {/* Phones: one folder menu. Tablets up: the full dropdown row. */}
          <div className="flex md:hidden flex-1 min-w-0">
            <MobileNav groups={GROUPS} activeTab={activeTab} onSelect={setActiveTab} />
          </div>
          <div className="hidden md:flex flex-1 min-w-0">
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
                <span className="hidden sm:inline">{updating ? 'Refreshing…' : 'Refresh'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {updateError && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700 text-center">
          Refresh failed: {updateError}
          <button onClick={() => setUpdateError('')} className="ml-3 underline">dismiss</button>
        </div>
      )}

      {/* Warnings banner */}
      {updateWarnings.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
          <div className="max-w-6xl mx-auto flex items-start gap-2">
            <span className="font-medium shrink-0">Refresh warnings:</span>
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
            <h2 className="text-lg font-semibold text-church-navy mb-2">Nothing here yet</h2>
            <p className="text-gray-500 text-sm mb-4">
              {canWrite
                ? <>Choose <strong>Refresh</strong> to pull the latest from capshawchurch.org.</>
                : <>This page fills in once the church office refreshes it from capshawchurch.org.</>}
            </p>
            {canWrite && (
              <button onClick={handleUpdate} className="btn-primary">Refresh from capshawchurch.org</button>
            )}
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {updating && (
        <div className="max-w-6xl mx-auto px-4 py-16 text-center">
          <div className="inline-block bg-white rounded-xl shadow p-8 border border-gray-100">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-church-gold mx-auto mb-4" />
            <p className="text-church-navy font-medium">Refreshing from capshawchurch.org…</p>
            <p className="text-gray-400 text-sm mt-1">Gathering the latest from every section</p>
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
          <CalendarView user={user} />
        </main>
      )}
      {!updating && activeTab === 'groups' && (
        <main className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1 w-full">
          <GroupsView user={user} />
        </main>
      )}
      {!updating && activeTab === 'livestreams' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <LivestreamsView />
        </main>
      )}
      {!updating && activeTab === 'assignments' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <ServingSchedule />
        </main>
      )}
      {!updating && activeTab === 'visitors' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <div className="space-y-4">
            <div className="flex justify-end">
              <WorkflowDialogButton page="visitors" user={user} label="Follow-ups" title="Guest follow-ups" />
            </div>
            <VisitorTracker user={user} />
          </div>
        </main>
      )}
      {!updating && activeTab === 'leadership' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <LeadershipView bulletins={siteData?.bulletins} />
        </main>
      )}
      {!updating && activeTab === 'service-roster' && hasArea(user, 'serving-schedule') && (
        <main className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1 w-full">
          <ServiceRosterView />
        </main>
      )}
      {!updating && activeTab === 'action-history' && admin && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <ActionHistoryView />
        </main>
      )}
      {!updating && activeTab === 'bug-reports' && admin && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <BugReportsView />
        </main>
      )}
      {!updating && activeTab === 'inbox' && user && (
        <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1 w-full">
          <InboxView onGoToPage={setActiveTab} />
        </main>
      )}
      {!updating && activeTab === 'profile' && user && (
        <main className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1 w-full">
          <MyProfileView user={user} />
        </main>
      )}
      {!updating && activeTab === 'users' && admin && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <UsersView currentUser={user} />
        </main>
      )}
      {!updating && activeTab === 'database' && admin && (
        <main className="w-full px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <DatabaseAdminView />
        </main>
      )}
      {!updating && activeTab === 'mail-groups' && hasArea(user, 'mail-groups') && (
        <main className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1 w-full">
          <MailGroupsView />
        </main>
      )}
      {!updating && activeTab === 'directory' && hasArea(user, 'directory') && (
        <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <DirectoryView />
        </main>
      )}
      {!updating && activeTab === 'bulletin' && hasArea(user, 'bulletin') && (
        <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <WeeklyBulletinView canWrite={hasArea(user, 'bulletin')} />
        </main>
      )}

      {/* Data-dependent tabs */}
      {siteData && !updating && !STANDALONE_TABS.has(activeTab) && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          {activeTab === 'attendance'    && <AttendanceView data={siteData.attendance} user={user} />}
          {activeTab === 'anniversaries' && <AnniversariesView data={siteData.anniversaries} />}
        </main>
      )}

      <footer className="py-6 text-center text-sm text-gray-500 border-t border-gray-200 mt-auto">
        <p>Capshaw Church of Christ &mdash; Member Portal</p>
        <p className="text-xs text-gray-400 mt-1">
          8941 Wall Triana Hwy &bull; Harvest, AL &mdash; for our church family
        </p>
        <button
          onClick={() => setReportingBug(true)}
          className="text-xs text-gray-400 underline hover:text-church-navy mt-2"
        >
          Report a problem
        </button>
      </footer>

      {reportingBug && (
        <BugReportDialog
          pageId={activeTab}
          pageLabel={activeLabel}
          onClose={() => setReportingBug(false)}
        />
      )}
    </div>
  );
}

// The whole portal — every page, including the announcement board — is for
// signed-in members only. Nothing renders until we know who is here.
export default function App() {
  const [user, setUser] = useState(undefined); // undefined=checking, null=signed out
  // Set only while an admin is viewing the portal as a member: `user` is then
  // the member, and this is the admin behind them.
  const [impersonatedBy, setImpersonatedBy] = useState(null);

  // Set by the OAuth callbacks and by the confirmation link in the registration
  // email, which the API answers with a redirect back to here.
  const params      = new URLSearchParams(window.location.search);
  const authError   = params.get('auth_error');
  const verified    = params.get('verified');
  const verifyError = params.get('verify_error');

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { setUser(j?.user ?? null); setImpersonatedBy(j?.impersonatedBy ?? null); })
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return (
      <div className="min-h-screen bg-church-cream flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-church-gold" />
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        authError={authError}
        verified={verified}
        verifyError={verifyError}
        onSignedIn={setUser}
      />
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/display" element={<AnnouncementsDisplay />} />
        <Route
          path="/*"
          element={
            <MainApp
              // Remounts the whole portal when the view changes hands, so no
              // page is left holding what it loaded as somebody else.
              key={`${user.id}:${impersonatedBy?.id ?? ''}`}
              user={user}
              impersonatedBy={impersonatedBy}
              onStoppedImpersonating={admin => { setUser(admin); setImpersonatedBy(null); }}
              onLogout={() => { setUser(null); setImpersonatedBy(null); }}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
