import { useState } from 'react';

// While an admin is viewing the portal as a member, this sits above everything
// else and never goes away. It has to say three things at once: whose view this
// is, that it is not read-only, and how to get out — because the whole point of
// the feature is that the rest of the screen looks exactly like somebody else's
// portal, and it would otherwise be genuinely easy to forget.
export default function ImpersonationBanner({ user, impersonatedBy, onStopped }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  async function stop() {
    setBusy(true); setError('');
    try {
      const res  = await fetch('/api/auth/impersonate', { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Could not stop');
      onStopped(json.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="bg-church-navy text-white px-4 py-2.5 text-sm flex items-center gap-3 flex-wrap">
      <svg className="w-4 h-4 shrink-0 text-church-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>

      <span className="flex-1 min-w-0">
        You are seeing the portal as <strong>{user?.name}</strong>, signed in as {impersonatedBy?.name}.
        {' '}<span className="text-gray-300">Anything you change here is theirs, and is recorded against you.</span>
      </span>

      {error && <span className="text-red-200 text-xs">{error}</span>}

      <button
        onClick={stop}
        disabled={busy}
        className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-church-gold text-church-navy hover:bg-church-gold/90 transition-colors disabled:opacity-50"
      >
        {busy ? 'Stopping…' : 'Back to my own account'}
      </button>
    </div>
  );
}
