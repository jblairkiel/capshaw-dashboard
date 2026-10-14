import { useState, useEffect } from 'react';

// ─── Waiting for approval ─────────────────────────────────────────────────────
//
// All that somebody signed in but not yet approved sees. The server refuses
// them everything else (limitPending), so this is not hiding the portal, only
// saying why there is none: the admins have already been told, and here is
// who they are, for anyone who would rather not wait.

// Where the link in the "confirm the address you added" email lands, when it
// is opened in a browser that is still signed in here.
const LINK_OUTCOMES = {
  added:   { tone: 'success', text: 'Thank you — your email address is confirmed and added to your account.' },
  taken:   { tone: 'error',   text: 'That email address now belongs to another account here, so it was not added. You can add a different one below, or ask an admin.' },
  expired: { tone: 'error',   text: 'That link has expired. Add your address again below and we will send a new one.' },
  invalid: { tone: 'error',   text: 'That link is no longer valid. If your address is not on your account yet, add it again below.' },
  missing: { tone: 'error',   text: 'That link was incomplete. Please open the link in the email again.' },
};

const TONES = {
  success: 'bg-green-50 border-green-200 text-green-800',
  error:   'bg-red-50 border-red-200 text-red-700',
};

const PROVIDER_NAMES = { google: 'Google', facebook: 'Facebook' };

// Facebook gives no email address for somebody who joined it with a phone
// number, or who chose not to share it. Without one the account cannot be
// told when it is approved or matched to the member directory, so ask. The
// address is only added once they open the link we mail to it.
function AddEmail({ provider, pendingEmail }) {
  const [email, setEmail] = useState(pendingEmail || '');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent]   = useState(pendingEmail ? `We have sent a link to ${pendingEmail}. Open it to add the address to your account.` : '');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(''); setSent('');
    try {
      const res  = await fetch('/api/auth/add-email', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.success) setSent(json.message);
      else setError(json.error || 'We could not send the link. Please try again.');
    } catch {
      setError('We could not reach the portal just now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-3" aria-labelledby="add-email-heading">
      <div>
        <h3 id="add-email-heading" className="text-sm font-semibold text-amber-900">Add your email address</h3>
        <p className="text-xs text-amber-900 mt-1">
          {PROVIDER_NAMES[provider] || 'Your sign-in'} did not give us an email address. Add one so we can tell you
          when you are approved and connect you to the member directory. We will send a link to confirm it is yours.
        </p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <label htmlFor="add-email" className="sr-only">Email address</label>
        <input
          id="add-email" type="email" autoComplete="email" required value={email}
          onChange={e => setEmail(e.target.value)}
          className="flex-1 min-w-[12rem] px-3 py-2 rounded-lg border border-amber-200 bg-white text-sm focus:outline-none focus:ring-1 focus:ring-church-gold"
        />
        <button type="submit" disabled={busy || !email.trim()} className="btn-primary text-sm disabled:opacity-50">
          {busy ? 'Sending…' : sent ? 'Send it again' : 'Send me a link'}
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {sent && <p role="status" className="text-xs text-green-800">{sent}</p>}
    </form>
  );
}

export default function WaitingForApproval({ user, verified, verifyError, onApproved, onLogout }) {
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
  const outcome = LINK_OUTCOMES[verified === 'added' ? 'added' : verifyError];

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

        {outcome && (
          <div role="status" className={`mb-4 rounded-xl border px-4 py-3 text-sm text-center ${TONES[outcome.tone]}`}>
            {outcome.text}
          </div>
        )}

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
              You don&apos;t need to do anything else, but if you would like to speed things up, you could call or text one of them:
            </p>
          </div>

          {!email && user.provider !== 'local' && (
            <AddEmail provider={user.provider} pendingEmail={user.pending_email} />
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {!data && !error && <p className="text-sm text-gray-400">Loading…</p>}
          {data && (
            data.admins.length === 0
              ? <p className="text-sm text-gray-500">No admins are listed yet. Please speak to someone at church.</p>
              : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg" aria-label="Admins you can contact">
                  {data.admins.map(a => (
                    <li key={`${a.name}-${a.cell}`} className="px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                      <span className="font-medium text-church-navy">{a.name}</span>
                      {a.cell
                        ? <a href={`tel:${a.cell.replace(/[^\d+]/g, '')}`} aria-label={`Call or text ${a.name} at ${a.cell}`} className="text-sm text-church-gold hover:text-church-navy underline whitespace-nowrap">{a.cell}</a>
                        : <span className="text-xs text-gray-400">No cellphone on file</span>}
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
