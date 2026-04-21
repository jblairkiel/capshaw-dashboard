import { useState, useEffect, useCallback } from 'react';

function ProviderBadge({ provider }) {
  if (provider === 'google') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
        <svg className="w-3 h-3" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Google
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#1877F2">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
      Facebook
    </span>
  );
}

function Avatar({ user, size = 10 }) {
  const [imgError, setImgError] = useState(false);
  const cls = `w-${size} h-${size} rounded-full object-cover bg-church-navy flex items-center justify-center text-church-gold font-semibold`;

  if (user.photo && !imgError) {
    return (
      <img
        src={user.photo}
        alt={user.name}
        className={`w-${size} h-${size} rounded-full object-cover`}
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className={cls} style={{ width: size * 4, height: size * 4, fontSize: size * 1.6 }}>
      {user.name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

function UserRow({ user, currentUserId, onApprove, onRevoke, onRemove }) {
  const isSelf = user.id === currentUserId;
  const isAdmin = user.role === 'admin';
  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString()
    : '—';

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
      <Avatar user={user} size={9} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-church-navy text-sm truncate">{user.name}</span>
          {isAdmin && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-church-gold/20 text-church-navy border border-church-gold/30">
              Admin
            </span>
          )}
          {isSelf && (
            <span className="text-xs text-gray-400">(you)</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-gray-500 truncate">{user.email || 'No email'}</span>
          <ProviderBadge provider={user.provider} />
          <span className="text-xs text-gray-400">Joined {joined}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!isAdmin && !isSelf && user.role === 'pending' && (
          <button
            onClick={() => onApprove(user.id)}
            className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-medium"
          >
            Approve
          </button>
        )}
        {!isAdmin && !isSelf && user.role === 'approved' && (
          <button
            onClick={() => onRevoke(user.id)}
            className="text-xs px-3 py-1.5 rounded-lg border border-orange-300 text-orange-600 hover:bg-orange-50 transition-colors font-medium"
          >
            Revoke
          </button>
        )}
        {!isAdmin && !isSelf && (
          <button
            onClick={() => onRemove(user.id, user.name)}
            className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export default function UsersView({ currentUser }) {
  const [users, setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/auth/users')
      .then(r => r.json())
      .then(j => { if (j.success) setUsers(j.users); else throw new Error(j.error); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approve(id) {
    await fetch(`/api/auth/users/${id}/approve`, { method: 'PATCH' });
    load();
  }

  async function revoke(id) {
    await fetch(`/api/auth/users/${id}/revoke`, { method: 'PATCH' });
    load();
  }

  async function remove(id, name) {
    if (!window.confirm(`Remove ${name} from the dashboard? They will need to sign in and be re-approved.`)) return;
    await fetch(`/api/auth/users/${id}`, { method: 'DELETE' });
    load();
  }

  const pending  = users.filter(u => u.role === 'pending');
  const approved = users.filter(u => u.role !== 'pending');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card text-center py-10 text-red-600 text-sm">{error}</div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="section-heading mb-0">User Management</h2>
        <button onClick={load} className="text-sm text-church-gold hover:text-church-navy transition-colors">
          Refresh
        </button>
      </div>

      {/* Pending */}
      <div className="card">
        <h3 className="font-semibold text-church-navy mb-1 flex items-center gap-2">
          Pending Approval
          {pending.length > 0 && (
            <span className="text-xs bg-orange-100 text-orange-700 rounded-full px-2 py-0.5">{pending.length}</span>
          )}
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          These users have signed in but cannot make changes until approved.
        </p>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No pending users</p>
        ) : (
          pending.map(u => (
            <UserRow
              key={u.id}
              user={u}
              currentUserId={currentUser.id}
              onApprove={approve}
              onRevoke={revoke}
              onRemove={remove}
            />
          ))
        )}
      </div>

      {/* Approved / Admin */}
      <div className="card">
        <h3 className="font-semibold text-church-navy mb-3">
          Approved Users
        </h3>
        {approved.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No approved users</p>
        ) : (
          approved.map(u => (
            <UserRow
              key={u.id}
              user={u}
              currentUserId={currentUser.id}
              onApprove={approve}
              onRevoke={revoke}
              onRemove={remove}
            />
          ))
        )}
      </div>
    </div>
  );
}
