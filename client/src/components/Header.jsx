import { useState } from 'react';

function UserMenu({ user, onLogout }) {
  const [open,     setOpen]     = useState(false);
  const [imgError, setImgError] = useState(false);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    onLogout();
  };

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/10 transition-colors"
      >
        {user.photo && !imgError ? (
          <img
            src={user.photo}
            alt={user.name}
            className="w-7 h-7 rounded-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-church-gold/20 flex items-center justify-center text-church-gold font-bold text-sm">
            {user.name?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <span className="text-sm text-gray-200 hidden sm:block max-w-[120px] truncate">{user.name}</span>
        <svg className="w-3.5 h-3.5 text-gray-400 hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-lg border border-gray-100 z-30 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-church-navy truncate">{user.name}</p>
              <p className="text-xs text-gray-500 truncate">{user.email || 'No email'}</p>
              <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                user.role === 'admin'    ? 'bg-church-gold/20 text-church-navy' :
                user.role === 'approved' ? 'bg-green-100 text-green-700' :
                                           'bg-orange-100 text-orange-700'
              }`}>
                {user.role === 'admin' ? 'Admin' : user.role === 'approved' ? 'Approved' : 'Pending approval'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
              </svg>
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Header({ user, onLogout }) {
  return (
    <header className="bg-church-navy text-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-7 h-7 text-church-gold shrink-0"
        >
          <path d="M11 2h2v7h7v2h-7v11h-2V11H4V9h7V2z" />
        </svg>

        <div className="min-w-0">
          <h1 className="text-base sm:text-xl font-serif font-bold tracking-wide leading-tight truncate">
            Capshaw Church of Christ
          </h1>
          <p className="text-church-gold text-xs tracking-widest uppercase font-medium hidden sm:block mt-0.5">
            Worship Dashboard
          </p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="text-right text-xs text-gray-300 hidden md:block shrink-0">
            <p>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
            <p className="text-gray-400 mt-0.5">8941 Wall Triana Hwy &bull; Harvest, AL</p>
          </div>
          {user && <UserMenu user={user} onLogout={onLogout} />}
        </div>
      </div>
    </header>
  );
}
