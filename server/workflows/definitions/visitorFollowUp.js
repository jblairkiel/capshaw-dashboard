// Guest follow-up — ask a member to reach out to somebody who visited, and
// close it the moment they actually reach them.
//
// The shape follows what really happens: somebody is asked to make contact,
// they either get hold of the guest or they do not, and getting hold of them is
// the end of it. So "Emailed them" and "Phoned them" are terminal — there is no
// separate step afterwards asking whether the contact happened, because
// pressing the button is saying that it did.
//
// Reaching the guest also writes back to their record (who, how, when), so the
// guest list shows who has been contacted without anybody opening a workflow to
// find out. The workflow's own history stays the record of what happened.

// Marks the guest as reached, and says so on the workflow.
function recordContact(method) {
  return (data, { db, user, note }) => {
    const visitorId = Number(data.visitorId);
    const guest = db.prepare('SELECT id, name, status FROM visitors WHERE id = ?').get(visitorId);
    if (!guest) return { error: 'That guest is no longer on file' };

    const by = user?.name || '';
    db.prepare(`
      UPDATE visitors
         SET last_contacted_at = datetime('now'),
             last_contact_method = ?,
             last_contacted_by = ?,
             status = CASE WHEN trim(coalesce(status, '')) = '' THEN 'Contacted' ELSE status END
       WHERE id = ?
    `).run(method, by, guest.id);

    return {
      data: {
        contactMethod: method,
        contactedBy:   by,
        contactedAt:   new Date().toISOString(),
        contactNote:   note || '',
      },
    };
  };
}

module.exports = {
  id: 'visitor-follow-up',
  page: 'visitors',
  title: 'Guest Follow-Up',
  description:
    'Ask a member to reach out to a guest. Emailing or phoning them closes it, ' +
    'and is recorded against the guest.',
  startRole: 'approved',
  // Nobody to aim it at falls to whoever looks after the guests, rather than to
  // admins generally — it is their page.
  fallbackRole: 'visitors',

  fields: [
    { key: 'visitorId', label: 'Guest', type: 'select', optionsFrom: 'visitors', required: true },
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
    const visitor = db.prepare('SELECT id, name, phone, email FROM visitors WHERE id = ?')
      .get(Number(data.visitorId));
    if (!visitor) return { error: 'That guest is no longer on file' };

    const person = db.prepare('SELECT name FROM directory WHERE id = ?').get(Number(data.assigneePersonId));

    // Carried on the instance so whoever picks the task up has what they need
    // to make contact in front of them, rather than having to go and find it.
    return {
      data: {
        visitorName:  visitor.name,
        visitorPhone: visitor.phone || '',
        visitorEmail: visitor.email || '',
        assigneeName: person?.name || '',
      },
    };
  },

  titleFor: data => `Follow up with ${data.visitorName}`,

  // What the task shows: how to reach them, so the two buttons mean something.
  preview: data => ({
    columns: ['Guest', 'Phone', 'Email'],
    rows: [[
      data.visitorName || '',
      data.visitorPhone || '— none on file —',
      data.visitorEmail || '— none on file —',
    ]],
  }),

  start: 'reach-out',

  steps: {
    'reach-out': {
      title: 'Reach out',
      instruction:
        'Get in touch, then say how you reached them — that closes the follow-up. ' +
        'If nobody answered, "No answer" brings it back round for another try.',
      assign: { personField: 'assigneePersonId' },
      assignLabel: 'The member asked to reach out',
      actions: [
        { id: 'emailed', label: 'Emailed them',  tone: 'good',    to: 'contacted', effect: recordContact('email') },
        { id: 'phoned',  label: 'Phoned them',   tone: 'good',    to: 'contacted', effect: recordContact('phone') },
        { id: 'no-answer', label: 'No answer',   tone: 'neutral', to: 'try-again' },
        { id: 'decline', label: 'I cannot do this', tone: 'bad',  to: 'reassign', requiresNote: true },
      ],
    },

    'try-again': {
      title: 'Try again later',
      instruction: 'Nobody was reached. Try again, or give up and close it out.',
      assign: { personField: 'assigneePersonId' },
      assignLabel: 'The member asked to reach out',
      actions: [
        { id: 'retry',   label: 'Try again now', tone: 'neutral', to: 'reach-out' },
        { id: 'give-up', label: 'Give up',       tone: 'bad',     to: 'no-contact', requiresNote: true },
      ],
    },

    reassign: {
      title: 'Assign someone else',
      instruction: 'The first person could not do it. Pick this up yourself, or close it out.',
      assign: { role: 'visitors' },
      assignLabel: 'Whoever looks after the guests',
      actions: [
        { id: 'emailed', label: 'I emailed them', tone: 'good',    to: 'contacted', effect: recordContact('email') },
        { id: 'phoned',  label: 'I phoned them',  tone: 'good',    to: 'contacted', effect: recordContact('phone') },
        { id: 'close',   label: 'Close it out',   tone: 'bad',     to: 'no-contact', requiresNote: true },
      ],
    },
  },

  outcomes: {
    contacted:    { label: 'Contacted',     tone: 'good' },
    'no-contact': { label: 'Never reached', tone: 'bad' },
  },
};
