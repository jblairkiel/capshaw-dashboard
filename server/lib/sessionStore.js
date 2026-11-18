// Where signed-in sessions live: a table in the portal's own SQLite database,
// rather than express-session's default MemoryStore. The MemoryStore lost
// every session whenever the server restarted, so each deploy signed every
// member out; a row in the database survives the restart, and the member's
// cookie still finds it.
//
// A session row holds what express-session hands us (the passport user id, an
// admin's impersonation, and so on) as JSON, plus the moment it stops being
// good. A read past that moment finds nothing, and expired rows are swept out
// on a timer so the table does not keep every session ever started.
const session = require('express-session');

const DEFAULT_TTL_MS   = 7 * 24 * 60 * 60 * 1000;
const PRUNE_EVERY_MS   = 60 * 60 * 1000;

class SqliteSessionStore extends session.Store {
  constructor(db, { pruneEveryMs = PRUNE_EVERY_MS } = {}) {
    super();
    this.db = db;
    this.stmts = {
      get:     db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires_at > ?'),
      set:     db.prepare(`
        INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at
      `),
      touch:   db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      clear:   db.prepare('DELETE FROM sessions'),
      length:  db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?'),
      all:     db.prepare('SELECT sid, sess FROM sessions WHERE expires_at > ?'),
      prune:   db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    };

    if (pruneEveryMs > 0) {
      this.pruneTimer = setInterval(() => this.prune(), pruneEveryMs);
      // A sweep is housekeeping — it must never be what keeps the process alive.
      this.pruneTimer.unref();
    }
  }

  // The moment a session stops being good: its cookie's own expiry when it has
  // one, otherwise a week from now (the same as the cookie's maxAge in app.js).
  static expiresAt(sess) {
    const expires = sess?.cookie?.expires;
    if (expires) return new Date(expires).getTime();
    return Date.now() + DEFAULT_TTL_MS;
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb = () => {}) {
    try {
      this.stmts.set.run(sid, JSON.stringify(sess), SqliteSessionStore.expiresAt(sess));
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  // express-session calls this on a request that changed nothing (resave is
  // off), so a member who keeps using the portal keeps their session alive.
  touch(sid, sess, cb = () => {}) {
    try {
      this.stmts.touch.run(SqliteSessionStore.expiresAt(sess), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb = () => {}) {
    try {
      this.stmts.destroy.run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  clear(cb = () => {}) {
    try {
      this.stmts.clear.run();
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  length(cb) {
    try {
      cb(null, this.stmts.length.get(Date.now()).n);
    } catch (err) {
      cb(err);
    }
  }

  all(cb) {
    try {
      const rows = this.stmts.all.all(Date.now());
      cb(null, Object.fromEntries(rows.map(r => [r.sid, JSON.parse(r.sess)])));
    } catch (err) {
      cb(err);
    }
  }

  // Deletes every expired session; returns how many went.
  prune() {
    try {
      return this.stmts.prune.run(Date.now()).changes;
    } catch (err) {
      console.error('[sessions] Pruning expired sessions failed:', err.message);
      return 0;
    }
  }

  close() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }
}

module.exports = { SqliteSessionStore };
