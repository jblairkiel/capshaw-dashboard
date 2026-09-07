// Build a month of worship assignments from the preferences people set on My
// Info, review the draft, and publish it to the roster.
//
// Owned by the worship coordinator. Nothing is written to job_assignments
// until the coordinator publishes, so a draft can be regenerated as often as
// they like without touching the live roster.

const { generateSchedule, asPreview, SERVICES } = require('../scheduling');
const notify = require('../../mail/notify');

// Reads the directory and everyone's stated preferences, then builds a draft.
function buildDraft(db, { month, services, attempt }) {
  const people = db.prepare('SELECT id, name FROM directory ORDER BY name ASC').all();
  const preferences = db.prepare('SELECT directory_id, role, level FROM worship_preferences').all();

  return generateSchedule({
    month,
    people,
    preferences,
    services: services ? services.split(',').map(s => s.trim()).filter(Boolean) : SERVICES,
    attempt: Number(attempt) || 0,
  });
}

module.exports = {
  id: 'worship-schedule',
  title: 'Monthly Worship Schedule',
  description:
    'Build a month of worship assignments from the preferences people have set, ' +
    'review the draft, then publish it to the roster and tell everyone who is serving.',

  // Only a coordinator (or an admin, who outranks them) starts one of these.
  startRole: 'worship-coordinator',
  fallbackRole: 'worship-coordinator',

  fields: [
    { key: 'month',    label: 'Month to schedule', type: 'text', required: true, placeholder: 'June 2026' },
    {
      key: 'services',
      label: 'Services to fill',
      type: 'select',
      options: [
        { value: SERVICES.join(','),                      label: 'All services' },
        { value: 'Sunday Worship',                        label: 'Sunday morning only' },
        { value: 'Sunday Worship,Sunday Evening',         label: 'Sundays only' },
      ],
      required: true,
    },
  ],

  onStart(data, { db }) {
    const draft = buildDraft(db, { ...data, attempt: 0 });
    if (draft.error) return { error: draft.error };
    if (!draft.rows.length) {
      return { error: `No services found in ${data.month} — check the month is right` };
    }
    return { data: { draft, attempt: 0 } };
  },

  titleFor: data => `Worship schedule — ${data.draft?.month || data.month}`,

  // Shown as a table on the workflow screen so the draft can be read before
  // it is published.
  preview: data => (data.draft ? asPreview(data.draft) : null),

  start: 'review',

  steps: {
    review: {
      title: 'Review the draft',
      instruction:
        'Check the draft below. Publishing writes it to the roster and emails ' +
        'everyone who is serving. Regenerating produces a different but equally ' +
        'fair draft — nothing is written to the roster until you publish.',
      assign: { role: 'worship-coordinator' },
      actions: [
        {
          id: 'publish',
          label: 'Publish to the roster',
          tone: 'good',
          to: 'published',
          // The only place this workflow touches congregation data.
          effect: (data, { db, instance }) => {
            const draft = data.draft;
            if (!draft?.rows?.length) return { error: 'There is no draft to publish' };

            const filled = draft.rows.filter(r => r.name);
            if (!filled.length) {
              return { error: 'Nobody could be scheduled — set some worship preferences first' };
            }

            // Replace just this month, so publishing June never disturbs May.
            db.prepare('DELETE FROM job_assignments WHERE month = ?').run(draft.month);
            const insert = db.prepare(
              'INSERT INTO job_assignments (month, date, service, job, name) VALUES (?, ?, ?, ?, ?)'
            );
            for (const row of filled) insert.run(draft.month, row.date, row.service, row.job, row.name);

            // Everyone serving hears what they are down for; everyone who has
            // not opted out gets the whole month.
            const { unreachable } = notify.schedulePublished({ draft, instanceId: instance.id });
            notify.monthlyReport({ draft, instanceId: instance.id });

            return {
              data: {
                publishedCount: filled.length,
                unreachable,
                publishedAt: new Date().toISOString(),
              },
            };
          },
        },
        {
          id: 'regenerate',
          label: 'Try a different draft',
          tone: 'neutral',
          to: 'review',
          effect: (data, { db }) => {
            const attempt = (Number(data.attempt) || 0) + 1;
            const draft = buildDraft(db, { month: data.month, services: data.services, attempt });
            if (draft.error) return { error: draft.error };
            return { data: { draft, attempt } };
          },
        },
        { id: 'cancel', label: 'Abandon this schedule', tone: 'bad', to: 'cancelled', requiresNote: true },
      ],
    },
  },

  outcomes: {
    published: { label: 'Published to the roster', tone: 'good' },
    cancelled: { label: 'Abandoned',               tone: 'neutral' },
  },
};
