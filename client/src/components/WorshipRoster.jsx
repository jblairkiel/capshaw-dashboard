import { useState } from 'react';
import axios from 'axios';

const API = '/api';

export default function WorshipRoster() {
  const [rosterData, setRosterData] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [showLogin, setShowLogin]   = useState(false);
  const [creds, setCreds]           = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  async function fetchPublicRoster() {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${API}/scraper/roster`);
      if (data.success) {
        if (data.data?.isLoginRequired) {
          setShowLogin(true);
        } else {
          setRosterData(data.data);
        }
      } else {
        setError(data.error || 'Could not load roster');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setLoginError('');
    try {
      const { data } = await axios.post(`${API}/scraper/roster/login`, creds);
      if (data.success) {
        setRosterData(data);
        setShowLogin(false);
      } else {
        setLoginError(data.message || 'Login failed');
      }
    } catch (err) {
      setLoginError(err.response?.data?.error || 'Login error');
    } finally {
      setLoading(false);
    }
  }

  async function clearCache() {
    await axios.delete(`${API}/scraper/cache`);
    setRosterData(null);
    setShowLogin(false);
    setError('Cache cleared — click Load again.');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="section-heading mb-0">Upcoming Worship Roster</h2>
        <div className="flex gap-2">
          <button onClick={clearCache} className="text-xs text-gray-500 hover:underline">
            Clear Cache
          </button>
          <button onClick={fetchPublicRoster} className="btn-primary text-sm">
            {loading ? 'Loading…' : 'Load Roster from capshawchurch.org'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Member Login Form */}
      {showLogin && !rosterData && (
        <div className="card max-w-md mx-auto">
          <h3 className="section-heading">Member Login Required</h3>
          <p className="text-sm text-gray-500 mb-4">
            The roster is in the member area of capshawchurch.org. Enter your member credentials to load it.
          </p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username / Email
              </label>
              <input
                type="text"
                value={creds.username}
                onChange={(e) => setCreds({ ...creds, username: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={creds.password}
                onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-church-navy"
                required
              />
            </div>
            {loginError && <p className="text-red-600 text-sm">{loginError}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Signing in…' : 'Sign In & Load Roster'}
            </button>
          </form>
        </div>
      )}

      {/* Spinner */}
      {loading && !showLogin && (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-church-gold"></div>
        </div>
      )}

      {/* Roster Display — structured sections */}
      {rosterData?.sections?.length > 0 && (
        <div className="space-y-6">
          {rosterData.sections.map((section, i) => (
            <div key={i} className="card">
              {section.heading && (
                <h3 className="section-heading">{section.heading}</h3>
              )}
              {section.content?.length > 0 && (
                <table className="w-full text-sm border-collapse">
                  <tbody>
                    {section.content.map((row, r) => (
                      <tr key={r} className={r % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                        {row.map((cell, c) => (
                          <td key={c} className="border border-gray-200 px-3 py-2">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Roster Display — raw table entries */}
      {rosterData?.entries?.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {rosterData.entries.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  {row.map((cell, j) => (
                    <td key={j} className="border border-gray-200 px-3 py-2">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Raw text fallback */}
      {rosterData?.rawText && (
        <div className="card">
          <h3 className="section-heading">Page Content</h3>
          <pre className="text-xs whitespace-pre-wrap text-gray-700 font-mono leading-relaxed">
            {rosterData.rawText}
          </pre>
        </div>
      )}

      {/* Empty state */}
      {!rosterData && !loading && !showLogin && !error && (
        <div className="card flex flex-col items-center justify-center h-64 text-gray-400">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
          </svg>
          <p className="text-center">
            Click &quot;Load Roster&quot; to fetch the upcoming<br />
            worship schedule from capshawchurch.org
          </p>
        </div>
      )}
    </div>
  );
}
