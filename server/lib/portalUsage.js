// ─── How the portal is used ───────────────────────────────────────────────────
//
// Two small records, for the weekly reports' "On the portal" figures:
//
//   portal_visits      one row per member per day they used the portal, and
//                      whether that day was on a phone, a computer, or both
//   portal_page_views  how many times each member opened each page each day
//
// Nothing about what anybody read or typed is kept — only that they were here
// and which pages they opened. An admin viewing the portal as a member is not
// counted as that member.

const db = require('../db');

// The menu's names for its pages (client/src/App.jsx), so the report says
// "Upcoming Service" rather than "upcoming".
const PAGE_LABELS = {
  'action-history': 'Action History', anniversaries: 'Birthdays & Anniversaries', announcements: 'Announcements',
  attendance: 'Attendance', 'bible-class': 'Bible Class', 'bug-reports': 'Bug Reports', bulletin: 'Weekly Newsletter',
  calendar: 'Church Calendar', 'communion-prep': 'Communion Preparation', contributions: 'Contributions',
  database: 'Church Records', directory: 'Member Directory', emails: 'Emails', groups: 'Church Groups',
  'how-it-works': 'How It Works', inbox: 'My Inbox', leadership: 'Elders & Deacons', livestreams: 'Livestreams',
  'mail-delivery': 'Email Delivery', 'mail-groups': 'Email Groups', 'member-attendance': 'Member Attendance',
  'member-match': 'Member Match', profile: 'My Household & Preferences', 'record-keeping': 'Record Keeping',
  rotations: 'Rotations', 'service-roster': 'Service Roster', signups: 'Sign-Ups', upcoming: 'Upcoming Service',
  users: 'Members & Access', visitors: 'Guests',
};
const labelOf = page => PAGE_LABELS[page] || page.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase());
const PAGE_ID = /^[a-z][a-z-]{0,39}$/;

// Church time, so a visit at 11 PM on a Saturday counts on Saturday.
const churchDay = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const isPhone = userAgent => /Mobi|Android|iPhone|iPad|iPod/i.test(String(userAgent || ''));

// Who has already been noted today, so a busy afternoon is one write, not one
// per request. Forgotten at midnight by keying on the day.
const noted = new Map();

function recordVisit(user, userAgent, now = new Date()) {
  if (!user?.id || user.role === 'pending' || user.impersonatedBy) return;
  const day = churchDay(now);
  const phone = isPhone(userAgent) ? 1 : 0;
  const key = `${user.id}|${phone}`;
  if (noted.get(key) === day) return;
  noted.set(key, day);
  db.prepare(`
    INSERT INTO portal_visits (user_id, day, phone, computer) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, day) DO UPDATE SET phone = max(phone, excluded.phone), computer = max(computer, excluded.computer)
  `).run(user.id, day, phone, phone ? 0 : 1);
}

function recordPage(user, page, now = new Date()) {
  if (!user?.id || user.role === 'pending' || user.impersonatedBy) return false;
  if (!PAGE_ID.test(String(page || ''))) return false;
  db.prepare(`
    INSERT INTO portal_page_views (day, page, user_id, views) VALUES (?, ?, ?, 1)
    ON CONFLICT(day, page, user_id) DO UPDATE SET views = views + 1
  `).run(churchDay(now), page, user.id);
  return true;
}

// Express middleware: notes the signed-in member's visit. Never in the way of
// the request itself — a failure to note it is only logged.
function noteVisits(req, _res, next) {
  try { recordVisit(req.user, req.get('user-agent')); } catch (err) { console.error('[usage] could not note a visit:', err.message); }
  next();
}

// For tests.
function forget() { noted.clear(); }

module.exports = { recordVisit, recordPage, noteVisits, labelOf, churchDay, forget, PAGE_LABELS };
