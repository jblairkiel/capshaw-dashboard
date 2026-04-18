import { useState, useEffect, useCallback } from 'react';
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

const API = '/api/members';

const TABS = [
  { id: 'assignments',   label: 'Job Assignments' },
  { id: 'attendance',    label: 'Attendance' },
  { id: 'sermons',       label: 'Sermons' },
  { id: 'visitors',      label: 'Visitors' },
  { id: 'anniversaries', label: 'Anniversaries' },
  { id: 'leadership',    label: 'Leadership' },
  { id: 'bible-class',   label: 'Bible Class' },
  { id: 'order',         label: 'Order of Service' },
  { id: 'calendar',      label: 'Calendar' },
];

export default function App() {
  const [activeTab,  setActiveTab]  = useState('assignments');
  const [siteData,   setSiteData]   = useState(null);   // persisted scraped data
  const [updating,   setUpdating]   = useState(false);
  const [updateError, setUpdateError] = useState('');

  // Load stored data on mount
  useEffect(() => {
    fetch(`${API}/data`)
      .then(r => r.json())
      .then(j => { if (j.success && j.data) setSiteData(j.data); })
      .catch(() => {});
  }, []);

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    setUpdateError('');
    try {
      const res  = await fetch(`${API}/update`, { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Update failed');
      // Re-fetch stored data
      const dataRes  = await fetch(`${API}/data`);
      const dataJson = await dataRes.json();
      if (dataJson.success && dataJson.data) setSiteData(dataJson.data);
    } catch (e) {
      setUpdateError(e.message);
    } finally {
      setUpdating(false);
    }
  }, []);

  const lastUpdated = siteData?.lastUpdated
    ? new Date(siteData.lastUpdated).toLocaleString()
    : null;

  return (
    <div className="min-h-screen bg-church-cream flex flex-col">
      <Header />

      {/* Tab nav + Update button — sticky so it stays visible while scrolling */}
      <div className="bg-church-navy shadow-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center">

          {/* Tabs — horizontally scrollable on mobile, no wrap */}
          <div className="flex overflow-x-auto scrollbar-hide flex-1 min-w-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 px-4 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-church-gold text-church-gold'
                    : 'border-transparent text-gray-300 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Update control — icon-only on small screens */}
          <div className="flex items-center gap-2 px-3 border-l border-white/10 shrink-0">
            {lastUpdated && (
              <span className="text-xs text-gray-400 hidden lg:block">
                Updated {lastUpdated}
              </span>
            )}
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

      {/* No data yet */}
      {!siteData && !updating && (
        <div className="max-w-6xl mx-auto px-4 py-16 text-center">
          <div className="inline-block bg-white rounded-xl shadow p-8 border border-gray-100">
            <svg className="w-12 h-12 text-church-gold mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <h2 className="text-lg font-semibold text-church-navy mb-2">No data yet</h2>
            <p className="text-gray-500 text-sm mb-4">
              Click <strong>Update Site</strong> to pull the latest data from capshawchurch.org.
            </p>
            <button onClick={handleUpdate} className="btn-primary">
              Update Site
            </button>
          </div>
        </div>
      )}

      {/* Loading overlay during update */}
      {updating && (
        <div className="max-w-6xl mx-auto px-4 py-16 text-center">
          <div className="inline-block bg-white rounded-xl shadow p-8 border border-gray-100">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-church-gold mx-auto mb-4" />
            <p className="text-church-navy font-medium">Scraping capshawchurch.org…</p>
            <p className="text-gray-400 text-sm mt-1">Logging in and fetching all sections</p>
          </div>
        </div>
      )}

      {/* Tabs that don't need scraped data — always accessible */}
      {!updating && activeTab === 'bible-class' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <BibleClassView />
        </main>
      )}
      {!updating && activeTab === 'order' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <OrderOfService />
        </main>
      )}
      {!updating && activeTab === 'calendar' && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
          <CalendarView />
        </main>
      )}

      {/* Tabs that require scraped data */}
      {siteData && !updating && !['bible-class','order','calendar'].includes(activeTab) && (
        <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1">
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
