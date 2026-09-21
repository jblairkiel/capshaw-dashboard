import { useState, useEffect, useCallback, useRef } from 'react';
import { call, timeAgo } from '../lib/groups';

// ─── The thread under an event ────────────────────────────────────────────────
//
// One component for every kind of event the portal has, because the thread is
// the same thing wherever it hangs: a group's meeting, or a dated row on the
// announcement board. It is told what it is under — a kind and an id — and the
// server decides from that pair whether this person may read it, reply to it,
// or take something down.
//
// Nothing is assumed here about who is who: `canReply` and `canModerate` come
// back with the thread rather than being worked out from the account.

export default function EventComments({ subjectType, subjectId, autoLoad = true, onCountChange }) {
  const [comments,    setComments]    = useState([]);
  const [canReply,    setCanReply]    = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [maxLength,   setMaxLength]   = useState(2000);
  const [draft,       setDraft]       = useState('');
  const [editing,     setEditing]     = useState(null);
  const [editDraft,   setEditDraft]   = useState('');
  const [loading,     setLoading]     = useState(autoLoad);
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState('');

  // ─── Reporting the count back, without chasing our own tail ────────────────
  //
  // A parent hands this a callback so its card can show "💬 3", and the
  // obvious way to write that — calling it from `apply`, with `apply` listing
  // it as a dependency — is a loop with no floor:
  //
  //     parent renders → a fresh arrow for onCountChange → a fresh `apply` →
  //     a fresh `load` → the effect fires → fetch → apply → onCountChange →
  //     the parent reloads and renders → a fresh arrow → …
  //
  // which is one comment thread issuing hundreds of requests a second until
  // the rate limiter cuts it off. So the callback is held in a ref and never
  // named as a dependency: its identity cannot restart anything.
  const report    = useRef(onCountChange);
  const reported  = useRef(null);
  useEffect(() => { report.current = onCountChange; });

  const apply = useCallback(json => {
    const list = json.comments ?? [];
    setComments(list);
    if (json.canReply    !== undefined) setCanReply(json.canReply);
    if (json.canModerate !== undefined) setCanModerate(json.canModerate);
    if (json.maxLength) setMaxLength(json.maxLength);

    // Only a count that has actually moved is worth telling anybody about.
    // The first load is not news: whatever listed this event already counted
    // its comments, so telling the parent then would only make it reload the
    // page to learn what it just said.
    const count = list.filter(c => !c.deleted).length;
    if (reported.current !== null && reported.current !== count) report.current?.(count);
    reported.current = count;
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    call(`/api/comments/${subjectType}/${subjectId}`)
      .then(apply)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [subjectType, subjectId, apply]);

  useEffect(() => { if (autoLoad) load(); }, [autoLoad, load]);

  async function post(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true); setError('');
    try {
      apply(await call(`/api/comments/${subjectType}/${subjectId}`, {
        method: 'POST', body: JSON.stringify({ body: draft.trim() }),
      }));
      setDraft('');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function saveEdit(id) {
    setBusy(true); setError('');
    try {
      apply(await call(`/api/comments/${id}`, { method: 'PUT', body: JSON.stringify({ body: editDraft.trim() }) }));
      setEditing(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm('Remove this comment?')) return;
    setBusy(true); setError('');
    try {
      apply(await call(`/api/comments/${id}`, { method: 'DELETE' }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading the conversation…</p>;

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {comments.length === 0 ? (
        <p className="text-sm text-gray-400">
          {canReply ? 'No one has said anything yet. Start it off.' : 'No comments yet.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map(comment => (
            <li key={comment.id} className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-church-navy/10 text-church-navy flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                {comment.deleted ? '·' : (comment.author?.[0]?.toUpperCase() || '?')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-medium text-church-navy">{comment.deleted ? 'Removed' : comment.author}</span>
                  <span className="text-xs text-gray-400">{timeAgo(comment.createdAt)}</span>
                  {comment.edited && !comment.deleted && <span className="text-xs text-gray-300">edited</span>}
                </div>

                {comment.deleted ? (
                  <p className="text-sm text-gray-400 italic">This comment was removed.</p>
                ) : editing === comment.id ? (
                  <div className="mt-1 space-y-2">
                    <textarea
                      value={editDraft}
                      onChange={e => setEditDraft(e.target.value)}
                      rows={3}
                      className="block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(comment.id)} disabled={busy} className="btn-primary text-xs disabled:opacity-50">Save</button>
                      <button onClick={() => setEditing(null)} className="text-xs text-gray-500 hover:text-church-navy">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{comment.body}</p>
                    <div className="flex gap-3 mt-0.5">
                      {comment.mine && (
                        <button
                          onClick={() => { setEditing(comment.id); setEditDraft(comment.body); }}
                          className="text-xs text-gray-400 hover:text-church-navy"
                        >
                          Edit
                        </button>
                      )}
                      {(comment.mine || canModerate) && (
                        <button onClick={() => remove(comment.id)} className="text-xs text-gray-400 hover:text-red-600">
                          Remove
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canReply && (
        <form onSubmit={post} className="pt-2 border-t border-gray-100 space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, maxLength))}
            rows={2}
            placeholder="Say something…"
            aria-label="Write a comment"
            className="block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
          />
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || !draft.trim()} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Posting…' : 'Post'}
            </button>
            {draft.length > maxLength - 200 && (
              <span className="text-xs text-gray-400">{maxLength - draft.length} characters left</span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
