import { useState } from 'react';

// ─── Two-step sign-in ─────────────────────────────────────────────────────────
//
// Three screens share this file:
//   SecondStepForm  — the code after the password (or Google, or Facebook).
//   TwoStepSetup    — scan a QR code, type the first code, keep the recovery
//                     codes. Full page for an admin who has to set it up, and
//                     inside My Info for anybody else who wants it.
//   TwoStepSettings — the My Info card: on or off, new recovery codes.
// The server decides who has to use it (server/lib/twoStep.js); this only
// shows what it is told in user.two_step.

async function post(url, body = {}) {
  const res = await fetch(url, {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(body),
  });
  return res.json().catch(() => ({ success: false, error: 'We could not reach the portal just now. Please try again.' }));
}

const inputClass =
  'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-lg tracking-widest text-center text-gray-800 focus:outline-none focus:ring-1 focus:ring-church-gold focus:border-church-gold';

function ErrorBox({ children }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
      {children}
    </div>
  );
}

// ─── The code after the password ─────────────────────────────────────────────

export function SecondStepForm({ onSignedIn, onCancel }) {
  const [code, setCode]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [expired, setExpired]   = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const json = await post('/api/auth/two-step/verify', { code });
    setBusy(false);
    if (json.success && json.user) return onSignedIn(json.user);
    if (json.code === 'two_step_expired') setExpired(true);
    setError(json.error || 'That code did not work. Please try again.');
    setCode('');
  }

  async function cancel() {
    await post('/api/auth/two-step/cancel');
    onCancel();
  }

  if (expired) {
    return (
      <div className="space-y-4 text-center">
        <ErrorBox>{error}</ErrorBox>
        <button type="button" onClick={onCancel} className="btn-primary w-full">Back to sign in</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="text-center">
        <h2 className="font-semibold text-church-navy">Two-step sign-in</h2>
        <p className="text-sm text-gray-600 mt-1">
          {recovery
            ? 'Type one of the recovery codes you saved when you set this up. Each one works once.'
            : 'Open the authenticator app on your phone and type the six-digit code it shows for Capshaw Church.'}
        </p>
      </div>
      <ErrorBox>{error}</ErrorBox>
      <div>
        <label htmlFor="two-step-code" className="block text-xs font-medium text-gray-600 mb-1">
          {recovery ? 'Recovery code' : 'Six-digit code'}
        </label>
        <input
          id="two-step-code"
          name="two-step-code"
          className={inputClass}
          autoFocus
          autoComplete="one-time-code"
          inputMode={recovery ? 'text' : 'numeric'}
          placeholder={recovery ? 'ABCD-EFGH' : '123456'}
          maxLength={recovery ? 12 : 8}
          value={code}
          onChange={e => setCode(e.target.value)}
        />
      </div>
      <button type="submit" disabled={busy || !code.trim()} className="btn-primary w-full disabled:opacity-50">
        {busy ? 'Checking…' : 'Sign in'}
      </button>
      <div className="flex items-center justify-between text-xs">
        <button type="button" onClick={() => { setRecovery(r => !r); setCode(''); setError(''); }} className="text-church-gold hover:text-church-navy">
          {recovery ? 'Use the code from my app' : 'Lost your phone? Use a recovery code'}
        </button>
        <button type="button" onClick={cancel} className="text-gray-500 hover:text-church-navy">Cancel</button>
      </div>
      {recovery && (
        <p className="text-xs text-gray-500 text-center">
          No recovery codes either? Ask another admin to reset your two-step sign-in from the Users page.
        </p>
      )}
    </form>
  );
}

// ─── Recovery codes, shown once ──────────────────────────────────────────────

export function RecoveryCodes({ codes, onDone, doneLabel = 'I have saved them' }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved]   = useState(false);
  const text = `Capshaw Church member portal: two-step sign-in recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'capshaw-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">Save these recovery codes now.</p>
        <p className="mt-1">
          If you lose your phone, each of these gets you in once. This is the only time they are
          shown. Print them or keep them somewhere safe, away from your phone.
        </p>
      </div>
      <ol className="grid grid-cols-2 gap-2 font-mono text-sm text-church-navy" aria-label="Recovery codes">
        {codes.map(code => (
          <li key={code} className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center">{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={download} className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
          Download
        </button>
        <button type="button" onClick={() => window.print()} className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
          Print
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
        I have saved these codes somewhere safe
      </label>
      <button type="button" disabled={!saved} onClick={onDone} className="btn-primary w-full disabled:opacity-50">
        {doneLabel}
      </button>
    </div>
  );
}

// ─── Setting it up ───────────────────────────────────────────────────────────

export function TwoStepSetup({ onDone, onCancel }) {
  // 'intro' | 'scan' | 'codes'
  const [stage, setStage]   = useState('intro');
  const [setup, setSetup]   = useState(null);
  const [code, setCode]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');
  const [result, setResult] = useState(null);

  async function begin() {
    setBusy(true);
    setError('');
    const json = await post('/api/auth/two-step/setup');
    setBusy(false);
    if (!json.success) return setError(json.error || 'Could not start. Please try again.');
    setSetup(json);
    setCode('');
    setStage('scan');
  }

  async function confirm(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const json = await post('/api/auth/two-step/enable', { code });
    setBusy(false);
    if (!json.success) {
      if (json.code === 'setup_expired') setStage('intro');
      setCode('');
      return setError(json.error || 'That code did not match. Please try again.');
    }
    setResult(json);
    setStage('codes');
  }

  if (stage === 'codes') {
    return <RecoveryCodes codes={result.recoveryCodes} onDone={() => onDone(result.user)} doneLabel="Done" />;
  }

  if (stage === 'scan') {
    return (
      <form onSubmit={confirm} className="space-y-4" noValidate>
        <ol className="list-decimal pl-5 text-sm text-gray-700 space-y-1">
          <li>Open your authenticator app and add an account.</li>
          <li>Scan this QR code with it.</li>
          <li>Type the six-digit code the app shows.</li>
        </ol>
        <div className="flex justify-center">
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qr)}`}
            alt="QR code for your authenticator app"
            className="w-48 h-48 rounded-lg border border-gray-200 bg-white p-2"
          />
        </div>
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer text-church-gold">Setting it up on this phone? Type the key instead</summary>
          <p className="mt-2">Choose “enter a setup key” in your app, name it Capshaw Church, and type:</p>
          <p className="mt-1 font-mono text-sm text-church-navy break-all select-all">{setup.secret}</p>
        </details>
        <ErrorBox>{error}</ErrorBox>
        <div>
          <label htmlFor="two-step-first-code" className="block text-xs font-medium text-gray-600 mb-1">Code from your app</label>
          <input
            id="two-step-first-code"
            className={inputClass}
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="123456"
            maxLength={8}
            value={code}
            onChange={e => setCode(e.target.value)}
          />
        </div>
        <button type="submit" disabled={busy || !code.trim()} className="btn-primary w-full disabled:opacity-50">
          {busy ? 'Checking…' : 'Turn on two-step sign-in'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="w-full text-sm text-gray-500 hover:text-church-navy">Cancel</button>
        )}
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        Two-step sign-in asks for a code from your phone after your password, so somebody who
        learns your password still cannot get in.
      </p>
      <p className="text-sm text-gray-700">
        You need a free authenticator app on your phone, such as Google Authenticator, Microsoft
        Authenticator or the one built into your password manager.
      </p>
      <ErrorBox>{error}</ErrorBox>
      <button type="button" onClick={begin} disabled={busy} className="btn-primary w-full disabled:opacity-50">
        {busy ? 'Starting…' : 'Set it up'}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="w-full text-sm text-gray-500 hover:text-church-navy">Not now</button>
      )}
    </div>
  );
}

// ─── Full page, for an account that has to have it ───────────────────────────

export function TwoStepRequiredPage({ user, onDone, onLogout }) {
  async function logout() {
    await post('/api/auth/logout');
    onLogout();
  }
  return (
    <div className="min-h-screen bg-church-cream flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-100 p-6 sm:p-8 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-church-navy" style={{ fontFamily: 'Georgia, serif' }}>
            Set up two-step sign-in
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {user.role === 'admin'
              ? 'Admins can see and change everybody’s details, so their accounts need a second step when they sign in.'
              : 'You look after the member directory, so your account needs a second step when you sign in.'}
            {' '}It takes about a minute.
          </p>
        </div>
        <TwoStepSetup onDone={onDone} />
        <p className="text-center text-xs text-gray-500">
          Signed in as {user.email || user.name}.{' '}
          <button type="button" onClick={logout} className="underline hover:text-church-navy">Sign out</button>
        </p>
      </div>
    </div>
  );
}

// ─── My Info card ────────────────────────────────────────────────────────────

export function TwoStepSettings({ user, onChanged }) {
  // Kept here as well as passed up, so the card is right even where the page
  // above it does not hold the signed-in user.
  const [account, setAccount] = useState(user);
  const status = account?.two_step || { enabled: false, required: false, recovery_codes_left: 0 };
  function changed(u) { setAccount(u); onChanged?.(u); }
  // null | 'setup' | 'codes' | 'disable'
  const [mode, setMode]   = useState(null);
  const [code, setCode]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [codes, setCodes] = useState(null);

  function close() { setMode(null); setCode(''); setError(''); setCodes(null); }

  async function act(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const url = mode === 'disable' ? '/api/auth/two-step/disable' : '/api/auth/two-step/recovery-codes';
    const json = await post(url, { code });
    setBusy(false);
    setCode('');
    if (!json.success) return setError(json.error || 'That code did not work.');
    if (json.user) changed(json.user);
    if (json.recoveryCodes) return setCodes(json.recoveryCodes);
    close();
  }

  return (
    <div className="card space-y-3" aria-labelledby="two-step-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="two-step-heading" className="font-semibold text-church-navy text-sm">Two-step sign-in</h3>
          <p className="text-xs text-gray-500 mt-1">
            {status.enabled
              ? `On. ${status.recovery_codes_left} of 10 recovery codes left.`
              : 'Off. Turn it on to ask for a code from your phone after your password.'}
            {status.required && ' Required for admins and directory managers.'}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${status.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
          {status.enabled ? 'On' : 'Off'}
        </span>
      </div>

      {mode === 'setup' && (
        <TwoStepSetup onDone={u => { changed(u); close(); }} onCancel={close} />
      )}

      {codes && <RecoveryCodes codes={codes} onDone={close} doneLabel="Done" />}

      {(mode === 'codes' || mode === 'disable') && !codes && (
        <form onSubmit={act} className="space-y-3" noValidate>
          <p className="text-sm text-gray-700">
            {mode === 'disable'
              ? 'Type a code from your app to turn two-step sign-in off.'
              : 'Type a code from your app. Your old recovery codes stop working.'}
          </p>
          <ErrorBox>{error}</ErrorBox>
          <input
            aria-label="Code from your app"
            className={inputClass}
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="123456"
            maxLength={12}
            value={code}
            onChange={e => setCode(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !code.trim()} className="btn-primary text-sm disabled:opacity-50">
              {mode === 'disable' ? 'Turn off' : 'Make new codes'}
            </button>
            <button type="button" onClick={close} className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      )}

      {!mode && !codes && (
        <div className="flex flex-wrap gap-2">
          {!status.enabled && (
            <button type="button" onClick={() => setMode('setup')} className="btn-primary text-sm">Turn on</button>
          )}
          {status.enabled && (
            <button type="button" onClick={() => setMode('codes')} className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
              New recovery codes
            </button>
          )}
          {status.enabled && !status.required && (
            <button type="button" onClick={() => setMode('disable')} className="text-sm px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
              Turn off
            </button>
          )}
        </div>
      )}
    </div>
  );
}
