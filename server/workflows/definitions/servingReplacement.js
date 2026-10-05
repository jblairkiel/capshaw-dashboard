// Asking to be replaced on the Serving Schedule.
//
// Somebody who cannot do a job they are down for no longer takes their own
// name off: a Sunday with a gap nobody knows about is worse than a name that
// is wrong. They ask, and whoever looks after the schedule is emailed, told on
// their bell, and finds it in My Inbox, where they say how it ends:
//
//   · Someone else is taking it — the name they give goes on the slot
//   · Leave the slot open      — the name comes off, for the slot to be filled later
//   · Keep them on              — they have talked, and nothing changes
//
// Changing the name on the slot from the Service Roster's Scheduled tab closes
// the request as "replaced" too (server/routes/serving.js), so it is never left
// open behind a slot that has already been sorted out. Whoever asked is told
// the outcome by email and on their bell.
//
// Started from the slot itself (POST /api/serving/assignments/:id/replacement),
// never from the generic start form, so it always names a real slot.

const notifications = require('../../lib/notifications');
const actionLog = require('../../lib/actionLog');
const { holdsArea } = require('../../lib/areas');

const AREA = 'serving-schedule';
const nameKey = s => String(s || '').trim().toLowerCase();

function slotOf(data, db) {
  return db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(Number(data.slotId));
}

function when(data) {
  return [data.slotDate || data.slotMonth, data.slotService].filter(Boolean).join(', ');
}

// Tells whoever asked how it ended, on their bell.
function tellRequester(instance, db, title) {
  if (!instance?.created_by) return;
  notifications.notify({
    users: [instance.created_by], kind: 'serving-replacement-done', title,
    subjectType: 'serving-slot', subjectId: Number(instance.data?.slotId) || null,
  });
}

// Writes `name` onto the slot, unless the slot has gone or someone else has
// already been put there.
function setSlot(data, db, name, user) {
  const slot = slotOf(data, db);
  if (!slot) return null;
  if (slot.name === name) return slot;
  db.prepare('UPDATE job_assignments SET name = ? WHERE id = ?').run(name, slot.id);
  actionLog.record(user, {
    area: AREA, action: 'update', entity: 'serving assignment', entityId: slot.id,
    summary: name
      ? `Put ${name} on ${slot.job}, ${slot.date || slot.month}, in place of ${slot.name || 'nobody'}`
      : `Took ${slot.name} off ${slot.job}, ${slot.date || slot.month}, at their request`,
    before: slot, after: { ...slot, name },
  });
  return slot;
}

module.exports = {
  id: 'serving-replacement',
  page: 'assignments',
  title: 'Replacement on the Serving Schedule',
  description: 'Somebody cannot do a job they are down for. Whoever keeps the schedule finds someone else, leaves it open, or keeps them on.',
  startRole: 'approved',
  // Asked for from a slot, not from the page's start form.
  startedFrom: 'slot',
  fallbackRole: AREA,

  fields: [
    { key: 'slotId', label: 'Slot', type: 'text', required: true },
    { key: 'reason', label: 'Why', type: 'textarea' },
  ],

  onStart(data, { db, user }) {
    const slot = slotOf(data, db);
    if (!slot) return { error: 'That slot is no longer on the schedule' };
    if (!slot.name.trim()) return { error: 'Nobody is down for that slot' };

    const person = user?.directory_id ? db.prepare('SELECT name FROM directory WHERE id = ?').get(user.directory_id) : null;
    const isMine = person && nameKey(person.name) === nameKey(slot.name);
    const keeper = holdsArea(user, AREA);
    if (!isMine && !keeper) return { error: 'You can only ask to be replaced on a job you are down for' };

    const open = db.prepare(`
      SELECT 1 FROM workflow_instances
       WHERE definition_id = 'serving-replacement' AND status = 'active'
         AND CAST(json_extract(data, '$.slotId') AS INTEGER) = ?
    `).get(slot.id);
    if (open) return { error: 'A replacement has already been asked for on that slot' };

    return {
      data: {
        slotId: String(slot.id),
        slotJob: slot.job, slotDate: slot.date, slotMonth: slot.month, slotService: slot.service,
        currentName: slot.name,
        reason: String(data.reason || '').slice(0, 500),
      },
    };
  },

  titleFor: data => `Replace ${data.currentName}: ${data.slotJob}, ${when(data)}`,

  preview: data => ({
    title: 'The slot',
    columns: ['Job', 'When', 'Down for it now', 'Why'],
    rows: [[data.slotJob, when(data), data.currentName, data.reason || '—']],
  }),

  start: 'find-replacement',

  steps: {
    'find-replacement': {
      title: 'Find a replacement',
      instruction:
        'They cannot do this one. Find someone else and put their name in, leave the slot open to fill later, ' +
        'or — if you have talked and they can do it after all — keep them on. Changing the name on the ' +
        'Service Roster\'s Scheduled tab closes this too.',
      assign: { role: AREA },
      assignLabel: 'Whoever keeps the serving schedule',
      actions: [
        {
          id: 'replaced', label: 'Someone else is taking it', tone: 'good', to: 'replaced',
          requiresNote: true, notePrompt: 'Who is taking it?',
          effect: (data, { db, user, note, instance }) => {
            const name = String(note || '').trim().slice(0, 100);
            if (!name) return { error: 'Say who is taking it' };
            if (!setSlot(data, db, name, user)) return { error: 'That slot is no longer on the schedule — leave it open instead' };
            tellRequester(instance, db, `${name} is taking ${data.slotJob} for you, ${when(data)}`);
            return { data: { replacedBy: name } };
          },
        },
        {
          id: 'leave-open', label: 'Leave the slot open', tone: 'neutral', to: 'opened',
          effect: (data, { db, user, instance }) => {
            setSlot(data, db, '', user);
            tellRequester(instance, db, `You are off ${data.slotJob}, ${when(data)}`);
            return {};
          },
        },
        {
          id: 'keep', label: 'Keep them on', tone: 'bad', to: 'kept', requiresNote: true,
          effect: (data, { db, instance }) => {
            tellRequester(instance, db, `You are still down for ${data.slotJob}, ${when(data)} — see the note`);
            return {};
          },
        },
      ],
    },
  },

  outcomes: {
    replaced: { label: 'Replaced',      tone: 'good' },
    opened:   { label: 'Left open',     tone: 'neutral' },
    kept:     { label: 'Kept on',       tone: 'neutral' },
  },
};
