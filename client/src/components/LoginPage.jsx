import { useState } from 'react';

const AUTH_ERROR_MESSAGES = {
  google:   'Google sign-in failed. Please try again.',
  facebook: 'Facebook sign-in failed. Please try again.',
};

// Where the confirmation link in the email lands. The API redirects back here
// carrying the outcome, so this is the one place that explains it.
const VERIFY_MESSAGES = {
  '1':       'Your email address is confirmed and your account is ready. Please sign in.',
  'pending': 'Thank you — your email address is confirmed. The church office still has to approve your account, and you will get an email from us the moment they do.',
};

const VERIFY_ERROR_MESSAGES = {
  missing: 'That confirmation link was incomplete. Please open the link in the email again, or ask for a new one below.',
  invalid: 'That confirmation link is no longer valid. It may already have been used — try signing in, or ask for a new link below.',
  expired: 'That confirmation link has expired. Ask for a new one below and we will send another.',
};

const MIN_PASSWORD_LENGTH = 10;

// ─── Small shared pieces ──────────────────────────────────────────────────────

function Banner({ tone, children }) {
  const tones = {
    error:   'bg-red-50 border-red-200 text-red-700',
    warn:    'bg-amber-50 border-amber-200 text-amber-800',
    success: 'bg-green-50 border-green-200 text-green-800',
  };
  return (
    <div role="status" className={`mb-4 rounded-xl border px-4 py-3 text-sm text-center ${tones[tone]}`}>
      {children}
    </div>
  );
}

function Field({ id, label, hint, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        id={id}
        name={id}
        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-church-gold focus:border-church-gold"
        {...props}
      />
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function ProviderButtons() {
  return (
    <div className="space-y-3">
      <a
        href="/api/auth/google"
        className="flex items-center justify-center gap-3 w-full px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-gray-700 font-medium text-sm shadow-sm"
      >
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Sign in with Google
      </a>

      <a
        href="/api/auth/facebook"
        className="flex items-center justify-center gap-3 w-full px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors text-gray-700 font-medium text-sm shadow-sm"
      >
        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="#1877F2">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
        Sign in with Facebook
      </a>
    </div>
  );
}

function Divider({ children }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <span className="h-px bg-gray-200 flex-1" />
      <span className="text-xs text-gray-400 uppercase tracking-wide">{children}</span>
      <span className="h-px bg-gray-200 flex-1" />
    </div>
  );
}

// ─── Sign in with an email address and password ───────────────────────────────

function SignInForm({ onSignedIn }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  // 'email_unverified' means the confirmation link has not been answered, so
  // offer to send it again rather than leaving them stuck.
  const [code, setCode]         = useState('');
  const [resent, setResent]     = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setCode('');
    setResent('');

    try {
      const res  = await fetch('/api/auth/login', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ email, password }),
      });
      const json = await res.json().catch(() => ({}));

      if (json.success && json.user) return onSignedIn(json.user);
      setCode(json.code || '');
      setError(json.error || 'Sign-in failed. Please try again.');
    } catch {
      setError('We could not reach the portal just now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResent('');
    const res  = await fetch('/api/auth/resend-verification', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    }).catch(() => null);
    const json = await res?.json().catch(() => ({})) ?? {};
    setResent(json.message || 'If we can use that address, another confirmation email is on its way.');
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
          {code === 'email_unverified' && (
            <button
              type="button"
              onClick={resend}
              className="block mt-2 underline text-red-800 hover:text-red-900"
            >
              Send the confirmation email again
            </button>
          )}
        </div>
      )}
      {resent && <Banner tone="success">{resent}</Banner>}

      <Field
        id="signin-email"
        label="Email address"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={e => setEmail(e.target.value)}
      />
      <Field
        id="signin-password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={e => setPassword(e.target.value)}
      />

      <button type="submit" disabled={busy} className="btn-primary w-full text-sm py-2.5 disabled:opacity-60">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

// ─── Create an account ────────────────────────────────────────────────────────

function RegisterForm({ onRegistered }) {
  const [form, setForm]   = useState({ name: '', email: '', password: '', confirm: '' });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const set = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');

    // Checked here purely so the mistake is caught before a round trip; the
    // API decides what a password has to be.
    if (form.password !== form.confirm) {
      return setError('Those two passwords are not the same.');
    }
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Please use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    setBusy(true);
    try {
      const res  = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: form.name, email: form.email, password: form.password }),
      });
      const json = await res.json().catch(() => ({}));

      if (json.success) return onRegistered(json.message);
      setError(json.error || 'We could not create that account. Please try again.');
    } catch {
      setError('We could not reach the portal just now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Field
        id="register-name"
        label="Your name"
        type="text"
        autoComplete="name"
        required
        value={form.name}
        onChange={set('name')}
        hint="The name our church family would know you by."
      />
      <Field
        id="register-email"
        label="Email address"
        type="email"
        autoComplete="username"
        required
        value={form.email}
        onChange={set('email')}
      />
      <Field
        id="register-password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        value={form.password}
        onChange={set('password')}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few ordinary words together make a good one.`}
      />
      <Field
        id="register-confirm"
        label="Password again"
        type="password"
        autoComplete="new-password"
        required
        value={form.confirm}
        onChange={set('confirm')}
      />

      <p className="text-xs text-gray-500 leading-relaxed">
        Two things happen after this. You confirm your email address by opening the link we
        send you, and then someone in the church office approves your account and connects it
        to your entry in the member directory. You will not be able to sign in until both are
        done — we will email you when they are.
      </p>

      <button type="submit" disabled={busy} className="btn-primary w-full text-sm py-2.5 disabled:opacity-60">
        {busy ? 'Creating your account…' : 'Create my account'}
      </button>
    </form>
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

export default function LoginPage({ authError, verified, verifyError, onSignedIn = () => {} }) {
  const [mode, setMode]         = useState('signin');   // 'signin' | 'register'
  const [registered, setRegistered] = useState('');

  return (
    <div className="min-h-screen bg-church-cream flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">

        {/* Logo / header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-church-navy rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-9 h-9 text-church-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-church-navy" style={{ fontFamily: 'Georgia, serif' }}>
            Capshaw Church of Christ
          </h1>
          <p className="text-gray-500 text-sm mt-1">Member Portal</p>
        </div>

        {authError && (
          <Banner tone="error">{AUTH_ERROR_MESSAGES[authError] ?? 'Sign-in failed. Please try again.'}</Banner>
        )}
        {verified && VERIFY_MESSAGES[verified] && (
          <Banner tone="success">{VERIFY_MESSAGES[verified]}</Banner>
        )}
        {verifyError && (
          <Banner tone="warn">
            {VERIFY_ERROR_MESSAGES[verifyError] ?? 'That confirmation link did not work. Please ask for a new one below.'}
          </Banner>
        )}

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          {registered ? (
            <div className="text-center space-y-4">
              <h2 className="font-semibold text-church-navy">Check your email</h2>
              <p className="text-sm text-gray-600">{registered}</p>
              <p className="text-xs text-gray-500">
                Once you have opened that link, the church office is told you are waiting. They
                will approve your account and connect it to the member directory, and we will
                email you when you can sign in.
              </p>
              <button
                type="button"
                onClick={() => { setRegistered(''); setMode('signin'); }}
                className="text-sm text-church-gold hover:text-church-navy"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <p className="text-center text-sm text-gray-600 mb-6">
                {mode === 'signin'
                  ? <>Welcome home. Sign in to see this Sunday&rsquo;s service, our calendar, and everything else our church family shares here.</>
                  : <>New here? Create an account and the church office will get you connected.</>
                }
              </p>

              {mode === 'signin'
                ? <SignInForm onSignedIn={onSignedIn} />
                : <RegisterForm onRegistered={setRegistered} />
              }

              <p className="text-center text-sm text-gray-500 mt-5">
                {mode === 'signin' ? (
                  <>
                    Don&rsquo;t have an account?{' '}
                    <button type="button" onClick={() => setMode('register')} className="text-church-gold hover:text-church-navy font-medium">
                      Create one
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button type="button" onClick={() => setMode('signin')} className="text-church-gold hover:text-church-navy font-medium">
                      Sign in
                    </button>
                  </>
                )}
              </p>

              <Divider>or</Divider>
              <ProviderButtons />
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          This portal is for members and friends of Capshaw Church of Christ.<br />
          New to us? Create an account and the church office will confirm you shortly.
        </p>

        <p className="text-center text-xs text-gray-400 mt-4">
          8941 Wall Triana Hwy &bull; Harvest, AL
        </p>
      </div>
    </div>
  );
}
