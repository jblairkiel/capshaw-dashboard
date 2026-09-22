import { useState, useRef } from 'react';
import Dialog from './Dialog';
import { SEVERITIES } from '../lib/bugReports';

// ─── Report a problem ─────────────────────────────────────────────────────────
//
// Opened from the link at the bottom of every page. Which page somebody was
// on, the full URL and their browser are captured from the click itself — the
// form only ever asks what a person actually knows: what happened, and how
// much it is in their way.
const API = '/api/bug-reports';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export default function BugReportDialog({ pageId, pageLabel, onClose }) {
  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps]             = useState('');
  const [severity, setSeverity]       = useState('annoying');
  const [screenshot, setScreenshot]   = useState(null);   // the chosen File, or null
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');
  const [filed, setFiled]   = useState(null);   // the report that came back, once sent
  const fileInput = useRef(null);

  function chooseScreenshot(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Please attach an image.');
    if (file.size > MAX_SCREENSHOT_BYTES) return setError('That screenshot is larger than 5 MB.');
    setError('');
    setScreenshot(file);
  }

  function clearScreenshot() {
    setScreenshot(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submit(e) {
    e.preventDefault();
    if (!title.trim())       return setError('A short title helps whoever looks into it.');
    if (!description.trim()) return setError('Say what happened.');

    setBusy(true); setError('');
    try {
      const body = new FormData();
      body.set('title', title.trim());
      body.set('description', description.trim());
      body.set('steps', steps.trim());
      body.set('severity', severity);
      body.set('page', pageId || '');
      body.set('pageLabel', pageLabel || '');
      body.set('url', window.location.href);
      body.set('userAgent', navigator.userAgent);
      if (screenshot) body.set('screenshot', screenshot);

      const res  = await fetch(API, { method: 'POST', credentials: 'include', body });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Could not file that report');

      setFiled(json.report);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold';
  const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';

  if (filed) {
    return (
      <Dialog title="Report a problem" onClose={onClose} width="max-w-md">
        <div className="space-y-3 text-center py-4">
          <svg className="w-10 h-10 mx-auto text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-church-navy font-medium">Thanks &mdash; that&rsquo;s been filed.</p>
          <p className="text-xs text-gray-500">
            Report #{filed.id}. Somebody will look into it, and you&rsquo;ll hear back here if anything changes.
          </p>
          <button onClick={onClose} className="btn-primary text-sm mt-2">Done</button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Report a problem"
      subtitle={pageLabel ? `You are on ${pageLabel}` : undefined}
      onClose={onClose}
      width="max-w-md"
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={label}>What&rsquo;s wrong, in a few words</span>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="The week dropdown doesn't change anything"
            className={field}
          />
        </label>

        <label className="block">
          <span className={label}>What happened</span>
          <textarea
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What you saw, and what you expected instead"
            className={field}
          />
        </label>

        <label className="block">
          <span className={label}>Steps to get there (optional)</span>
          <textarea
            rows={2}
            value={steps}
            onChange={e => setSteps(e.target.value)}
            placeholder="1. Open Serving Schedule  2. Change Week of  3. …"
            className={field}
          />
        </label>

        <fieldset className="border-0 p-0 m-0">
          <legend className={label}>How much is it in your way</legend>
          <div className="mt-1 flex flex-col gap-1.5" role="radiogroup" aria-label="How much is it in your way">
            {SEVERITIES.map(s => (
              <label
                key={s.id}
                className={`flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                  severity === s.id ? s.tone : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="severity"
                  value={s.id}
                  checked={severity === s.id}
                  onChange={() => setSeverity(s.id)}
                  className="accent-church-gold"
                />
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <span className={label}>Screenshot (optional)</span>
          {screenshot ? (
            // Not a <label> here: a control nested inside one borrows the
            // label's text as its own accessible name, which would leave the
            // Remove button impossible to ask for by name.
            //
            // No thumbnail: an <img> given a URL built from the chosen file
            // would be the same file a CodeQL DOM-XSS query flagged before —
            // the name is worth showing without going anywhere near that.
            <div className="mt-1 flex items-center gap-3 text-sm text-gray-600">
              <svg className="w-5 h-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="truncate">{screenshot.name}</span>
              <button type="button" onClick={clearScreenshot} className="text-xs text-gray-500 hover:text-red-600 underline shrink-0">
                Remove
              </button>
            </div>
          ) : (
            <label className="block">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                onChange={e => chooseScreenshot(e.target.files?.[0])}
                className="mt-1 block w-full text-sm text-gray-600"
              />
            </label>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
