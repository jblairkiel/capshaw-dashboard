// Small cookie helpers for remembering view preferences (column layouts and
// the like) between visits. Preferences only — never anything sensitive, since
// cookies written here are readable by any script on the page.

import { useState, useEffect } from 'react';

const ONE_YEAR_DAYS = 365;

export function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of (document.cookie || '').split(';')) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) {
      try {
        return decodeURIComponent(entry.slice(prefix.length));
      } catch {
        return entry.slice(prefix.length);
      }
    }
  }
  return null;
}

export function writeCookie(name, value, days = ONE_YEAR_DAYS) {
  if (typeof document === 'undefined') return;
  const maxAge = Math.round(days * 24 * 60 * 60);
  document.cookie =
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function deleteCookie(name) {
  if (typeof document === 'undefined') return;
  document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; samesite=lax`;
}

/** Reads a JSON-encoded cookie, falling back when it is missing or corrupt. */
export function readJsonCookie(name, fallback = null) {
  const raw = readCookie(name);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJsonCookie(name, value, days = ONE_YEAR_DAYS) {
  writeCookie(name, JSON.stringify(value), days);
}

/**
 * useState that mirrors itself into a cookie, so the choice survives a reload.
 * `revive` gets the stored value a chance to be validated against what the app
 * currently supports — a column that no longer exists, say, should be dropped.
 */
export function useCookieState(name, initial, { days = ONE_YEAR_DAYS, revive } = {}) {
  const [value, setValue] = useState(() => {
    const stored = readJsonCookie(name, undefined);
    const start  = stored === undefined
      ? (typeof initial === 'function' ? initial() : initial)
      : stored;
    return revive ? revive(start) : start;
  });

  useEffect(() => { writeJsonCookie(name, value, days); }, [name, value, days]);

  return [value, setValue];
}
