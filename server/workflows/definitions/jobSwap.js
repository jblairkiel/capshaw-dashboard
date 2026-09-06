// Job assignment swap — the flow that actually reaches into the rest of the
// site. It starts from a duty the requester is really rostered for, loops
// while a replacement is being found, and on approval writes the new name
// back to job_assignments so the roster and the workflow never disagree.

module.exports = {
  id: 'job-swap',
  title: 'Job Assignment Swap',
  description:
    'Ask to be replaced on a worship duty you are rostered for. Find your own ' +
    'replacement or hand it to the scheduler; once approved, the roster is updated.',
  startRole: 'approved',
  fallbackRole: 'admin',

  fields: [
    {
      key: 'assignmentId',
      label: 'Which duty',
      type: 'select',
      // Resolved per user when the form is opened — only duties this person is
      // actually rostered for can be swapped.
      optionsFrom: 'myAssignments',
      required: true,
    },
    { key: 'reason', label: 'Why you cannot serve', type: 'textarea', required: true },
  ],

  // Snapshot the duty at start. The roster is re-scraped every few hours, so
  // holding a copy keeps the request readable even if the row later changes.
  onStart(data, { db, user }) {
    const row = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(Number(data.assignmentId));
    if (!row) return { error: 'That duty is no longer on the roster' };

    const person = user.directory_id
      ? db.prepare('SELECT name FROM directory WHERE id = ?').get(user.directory_id)
      : null;

    return {
      data: {
        dutyDate:     row.date,
        dutyService:  row.service,
        dutyJob:      row.job,
        dutyName:     row.name,
        requestedBy:  person?.name || user.name,
      },
    };
  },

  titleFor: data => `${data.dutyJob} — ${data.dutyDate} (${data.dutyName})`,

  start: 'find-replacement',

  steps: {
    'find-replacement': {
      title: 'Find a replacement',
      instruction:
        'Ask someone to cover for you and enter their name. If you cannot find ' +
        'anyone, hand it to the scheduler.',
      assign: { creator: true },
      assignLabel: 'Whoever asked',
      actions: [
        {
          id: 'found',
          label: 'I found someone',
          tone: 'good',
          requiresNote: true,
          to: 'approve',
          effect: (data, { note }) => ({ data: { replacementName: note } }),
        },
        { id: 'need-help', label: 'Ask the scheduler', tone: 'neutral', to: 'scheduler-find' },
        { id: 'withdraw',  label: 'Never mind',        tone: 'neutral', to: 'withdrawn' },
      ],
    },

    'scheduler-find': {
      title: 'Scheduler finds a replacement',
      instruction:
        'Find someone to cover this duty and enter their name. Worship role ' +
        'preferences on the My Info tab show who is glad to take this job.',
      assign: { role: 'admin' },
      actions: [
        {
          id: 'found',
          label: 'Found someone',
          tone: 'good',
          requiresNote: true,
          to: 'approve',
          effect: (data, { note }) => ({ data: { replacementName: note } }),
        },
        { id: 'none', label: 'Nobody available', tone: 'bad', to: 'unfilled', requiresNote: true },
      ],
    },

    approve: {
      title: 'Approve and update the roster',
      instruction:
        'Confirm the replacement. Approving writes the new name onto the roster ' +
        'for this duty.',
      assign: { role: 'admin' },
      actions: [
        {
          id: 'apply',
          label: 'Approve and update roster',
          tone: 'good',
          to: 'covered',
          // The one place a workflow writes to congregation data.
          effect: (data, { db }) => {
            const row = db.prepare('SELECT * FROM job_assignments WHERE id = ?').get(Number(data.assignmentId));
            if (!row) return { error: 'That duty is no longer on the roster — nothing was changed' };
            if (!data.replacementName) return { error: 'No replacement has been named yet' };

            db.prepare('UPDATE job_assignments SET name = ? WHERE id = ?')
              .run(data.replacementName, row.id);

            return { data: { rosterUpdatedFrom: row.name, rosterUpdatedTo: data.replacementName } };
          },
        },
        { id: 'reject', label: 'Not suitable — find another', tone: 'bad', to: 'find-replacement', requiresNote: true },
      ],
    },
  },

  outcomes: {
    covered:   { label: 'Covered — roster updated', tone: 'good' },
    unfilled:  { label: 'Nobody found',             tone: 'bad' },
    withdrawn: { label: 'Withdrawn',                tone: 'neutral' },
  },
};
