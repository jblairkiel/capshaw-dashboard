import { useState, useEffect, useCallback } from 'react';
import PersonPhoto from './PersonPhoto';
import { call, jsonBody, timeAgo, fullTimestamp } from '../lib/notifications';

const API = '/api/comments';

// ─── One comment ──────────────────────────────────────────────────────────────

function Comment({ comment, onReply, onEdit, onDelete, isReply }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(comment.body);
  const [busy,    setBusy]    = useState(false);

  async function save() {
    setBusy(true);
    try { await onEdit(comment.id, draft); setEditing(false); }
    finally { setBusy(false); }
  }

  return (
    <div className={`flex gap-2.5 ${isReply ? 'ml-8 sm:ml-11' : ''}`}>
      <PersonPhoto person={{ name: comment.author.name }} size={isReply ? 26 : 32} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-church-navy">{comment.author.name}</span>
          <span className="text-xs text-gray-400" title={fullTimestamp(comment.createdAt)}>
            {timeAgo(comment.createdAt)}
          </span>
          {comment.editedAt && <span className="text-xs text-gray-300">edited</span>}
        </div>

        {comment.deleted ? (
          <p className="text-sm text-gray-400 italic mt-0.5">This comment was removed.</p>
        ) : editing ? (
          <div className="mt-1.5 space-y-2">
            <textarea
              rows={3}
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
            />
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={busy || !draft.trim()}
                className="text-xs px-3 py-1.5 rounded-lg bg-church-navy text-church-gold font-medium disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setDraft(comment.body); }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-700 whitespace-pre-wrap mt-0.5 break-words">{comment.body}</p>
        )}

        {!editing && !comment.deleted && (
          <div className="flex gap-3 mt-1">
            {onReply && (
              <button onClick={() => onReply(comment)} className="text-xs text-gray-400 hover:text-church-navy">
                Reply
              </button>
            )}
            {comment.canEdit && (
              <button onClick={() => setEditing(true)} className="text-xs text-gray-400 hover:text-church-navy">
                Edit
              </button>
            )}
            {comment.canDelete && (
              <button onClick={() => onDelete(comment.id)} className="text-xs text-gray-400 hover:text-red-500">
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── The thread ───────────────────────────────────────────────────────────────

// Conversation on one announcement or one calendar event. Commenting is what
// makes somebody follow a thread; the Following switch is how they leave it
// without leaving the rest.
export default function CommentThread({ subjectType, subjectId, onCountChange }) {
  const [comments,     setComments]     = useState([]);
  const [subscription, setSubscription] = useState('none');
  const [canComment,   setCanComment]   = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [draft,        setDraft]        = useState('');
  const [replyTo,      setReplyTo]      = useState(null);
  const [busy,         setBusy]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const json = await call(`${API}/${subjectType}/${subjectId}`);
      setComments(json.comments);
      setSubscription(json.subscription);
      setCanComment(json.canComment);
      onCountChange?.(json.comments.filter(c => !c.deleted).length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [subjectType, subjectId, onCountChange]);

  useEffect(() => { load(); }, [load]);

  async function post() {
    if (!draft.trim()) return;
    setBusy(true); setError('');
    try {
      await call(`${API}/${subjectType}/${subjectId}`, {
        method: 'POST',
        ...jsonBody({ body: draft, parentId: replyTo?.id ?? null }),
      });
      setDraft(''); setReplyTo(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function edit(id, body) {
    await call(`${API}/${id}`, { method: 'PATCH', ...jsonBody({ body }) });
    await load();
  }

  async function remove(id) {
    if (!window.confirm('Remove this comment?')) return;
    try {
      await call(`${API}/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleFollow() {
    const next = subscription === 'on' ? 'off' : 'on';
    try {
      const json = await call(`${API}/${subjectType}/${subjectId}/subscription`, {
        method: 'PUT',
        ...jsonBody({ state: next }),
      });
      setSubscription(json.subscription);
    } catch (err) {
      setError(err.message);
    }
  }

  const topLevel = comments.filter(c => !c.parentId);
  const repliesTo = id => comments.filter(c => c.parentId === id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-church-navy">
          {comments.filter(c => !c.deleted).length || 'No'} comment{comments.filter(c => !c.deleted).length === 1 ? '' : 's'}
        </h4>
        <button
          onClick={toggleFollow}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            subscription === 'on'
              ? 'border-church-gold bg-church-gold/10 text-church-navy'
              : 'border-gray-200 text-gray-500 hover:border-church-gold'
          }`}
        >
          {subscription === 'on' ? '🔔 Following' : subscription === 'off' ? '🔕 Muted' : '🔔 Follow'}
        </button>
      </div>

      {loading && <p className="text-xs text-gray-400">Loading the conversation…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && (
        <div className="space-y-4">
          {topLevel.map(comment => (
            <div key={comment.id} className="space-y-3">
              <Comment
                comment={comment}
                onReply={canComment ? setReplyTo : null}
                onEdit={edit}
                onDelete={remove}
              />
              {repliesTo(comment.id).map(reply => (
                <Comment
                  key={reply.id}
                  comment={reply}
                  isReply
                  onReply={canComment ? () => setReplyTo(comment) : null}
                  onEdit={edit}
                  onDelete={remove}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {canComment ? (
        <div className="space-y-2 pt-1">
          {replyTo && (
            <p className="text-xs text-gray-500">
              Replying to <strong className="text-church-navy">{replyTo.author.name}</strong>
              <button onClick={() => setReplyTo(null)} className="ml-2 underline text-gray-400">cancel</button>
            </p>
          )}
          <textarea
            rows={2}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Add a comment… type @ and someone’s name to tell them about it"
            className="block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-church-gold"
          />
          <button
            onClick={post}
            disabled={busy || !draft.trim()}
            className="text-sm px-4 py-1.5 rounded-lg bg-church-gold text-church-navy font-semibold disabled:opacity-50"
          >
            {busy ? 'Posting…' : replyTo ? 'Post reply' : 'Post comment'}
          </button>
        </div>
      ) : (
        !loading && (
          <p className="text-xs text-gray-400">
            Your account has to be approved by an admin before you can join the conversation.
          </p>
        )
      )}
    </div>
  );
}
