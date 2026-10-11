import { useState, useEffect } from 'react';

// ─── Waiting for approval ─────────────────────────────────────────────────────
//
// All that somebody signed in but not yet approved sees. The server refuses
// them everything else (limitPending), so this is not hiding the portal, only
// saying why there is none: the admins have already been told, and here is
// who they are, for anyone who would rather not wait.

export default function WaitingForApproval({ user, onApproved, onLogout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [stillWaiting, setStillWaiting] = useState(false);

  useEffect(() => {
    fetch('/api/welcome/contacts', { credentials: 'include' })
      .then(r => r.json())
      .then(j => { if (j.success) setData(j); else setError(j.error || 'Could not load the admins'); })
      .catch(() => setError('Could not load the admins'));
  }, []);

  async function checkAgain() {
    setChecking(true); setStillWaiting(false);
    try {
      const j = await (await fetch('/api/auth/me', { credentials: 'include' })).json();
      if (j.user && j.user.role !== 'pending') return onApproved(j.user);
      setStillWaiting(true);
    } catch {
      setStillWaiting(true);
    } finally {
      setChecking(false);
    }
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    onLogout();
  }

  const email = data?.you?.email ?? user.email;
  const first = String(user.name || '').split(/\s+/)[0];

  return (
    <div className="min-h-screen bg-church-cream flex flex-col items-center justify-center px-4 py-10">
      <main className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-church-navy rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-9 h-9 text-church-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-church-navy" style={{ fontFamily: 'Georgia, serif' }}>
            Capshaw Church of Christ
          </h1>
          <p className="text-gray-500 text-sm mt-1">Member Portal</p>
        </div>

        <section className="card space-y-4" aria-labelledby="waiting-heading">
          <div>
            <h2 id="waiting-heading" className="text-lg font-semibold text-church-navy">
              Welcome{first ? `, ${first}` : ''}! Your account is waiting to be approved.
            </h2>
            <p className="text-sm text-gray-700 mt-2">
              The church&apos;s admins have been notified automatically, and one of them will approve you as soon as they can.
              {email
                ? <> You will get an email at <strong>{email}</strong> the moment they do.</>
                : ' Sign in again after that to see the portal.'}
            </p>
            <p className="text-sm text-gray-700 mt-2">
              You don&apos;t need to do anything else, but if you would like to speed things up, you could reach out to one of them:
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {!data && !error && <p className="text-sm text-gray-400">Loading…</p>}
          {data && (
            data.admins.length === 0
              ? <p className="text-sm text-gray-500">No admins are listed yet. Please speak to someone at church.</p>
              : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg" aria-label="Admins you can contact">
                  {data.admins.map(a => (
                    <li key={`${a.name}-${a.email}`} className="px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                      <span className="font-medium text-church-navy">{a.name}</span>
                      {a.email
                        ? <a href={`mailto:${a.email}?subject=${encodeURIComponent('Member portal account')}`} className="text-sm text-church-gold hover:text-church-navy underline break-all">{a.email}</a>
                        : <span className="text-xs text-gray-400">No email on file</span>}
                    </li>
                  ))}
                </ul>
              )
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div className="flex items-center gap-3">
              <button type="button" onClick={checkAgain} disabled={checking} className="btn-primary text-sm disabled:opacity-50">
                {checking ? 'Checking…' : 'Check again'}
              </button>
              {stillWaiting && <span className="text-xs text-gray-500" role="status">Not yet — still waiting.</span>}
            </div>
            <button type="button" onClick={signOut} className="text-sm text-gray-500 hover:text-church-navy underline">Sign out</button>
          </div>
        </section>
      </main>
    </div>
  );
}
