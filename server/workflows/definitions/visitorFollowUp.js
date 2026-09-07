// Visitor follow-up — assign a member to reach out to someone who visited,
// log what happened, and loop round if they need another try. Reads the
// visitors the scraper already collects; writes nothing back to them.

module.exports = {
  id: 'visitor-follow-up',
  page: 'visitors',
  title: 'Visitor Follow-Up',
  description:
    'Ask a member to reach out to a recent visitor, record how it went, and try ' +
    'again later if nobody was reached.',
  startRole: 'approved',
  fallbackRole: 'admin',

  fields: [
    { key: 'visitorId', label: 'Visitor', type: 'select', optionsFrom: 'visitors', required: true },
    {
      key: 'assigneePersonId',
      label: 'Who should reach out',
      type: 'select',
      optionsFrom: 'linkedPeople',
      required: true,
    },
    { key: 'notes', label: 'Anything they should know', type: 'textarea' },
  ],

  onStart(data, { db }) {
    const visitor = db.prepare('SELECT name FROM visitors WHERE id = ?').get(Number(data.visitorId));
    if (!visitor) return { error: 'That visitor is no longer on file' };

    const person = db.prepare('SELECT name FROM directory WHERE id = ?').get(Number(data.assigneePersonId));
    return { data: { visitorName: visitor.name, assigneeName: person?.name || '' } };
  },

  titleFor: data => `Follow up with ${data.visitorName}`,

  start: 'reach-out',

  steps: {
    'reach-out': {
      title: 'Reach out',
      instruction:
        'Get in touch and let us know how it went. If you could not reach them, ' +
        'choose "No answer" and it will come back round for another try.',
      // Aimed at the directory person chosen on the form, via their login.
      assign: { personField: 'assigneePersonId' },
      assignLabel: 'The member asked to reach out',
      actions: [
        { id: 'spoke',    label: 'Spoke with them', tone: 'good',    to: 'record-outcome' },
        { id: 'no-answer', label: 'No answer',      tone: 'neutral', to: 'try-again' },
        { id: 'decline',  label: 'I cannot do this', tone: 'bad',    to: 'reassign', requiresNote: true },
      ],
    },

    'try-again': {
      title: 'Try again later',
      instruction: 'Nobody was reached. Try again, or give up and close it out.',
      assign: { personField: 'assigneePersonId' },
      assignLabel: 'The member asked to reach out',
      actions: [
        { id: 'retry',    label: 'Try again now', tone: 'neutral', to: 'reach-out' },
        { id: 'give-up',  label: 'Give up',       tone: 'bad',     to: 'no-contact', requiresNote: true },
      ],
    },

    reassign: {
      title: 'Assign someone else',
      instruction: 'The first person could not do it. Pick this up or pass it on.',
      assign: { role: 'admin' },
      actions: [
        { id: 'take',   label: 'I will reach out', tone: 'neutral', to: 'record-outcome' },
        { id: 'close',  label: 'Close it out',     tone: 'bad',     to: 'no-contact', requiresNote: true },
      ],
    },

    'record-outcome': {
      title: 'Record the outcome',
      instruction: 'What came of it? This closes the follow-up.',
      assign: { role: 'admin' },
      actions: [
        { id: 'interested',     label: 'Interested — keep in touch', tone: 'good',    to: 'interested' },
        { id: 'not-interested', label: 'Not interested',             tone: 'neutral', to: 'not-interested' },
      ],
    },
  },

  outcomes: {
    interested:     { label: 'Interested',      tone: 'good' },
    'not-interested': { label: 'Not interested', tone: 'neutral' },
    'no-contact':   { label: 'Never reached',   tone: 'bad' },
  },
};
