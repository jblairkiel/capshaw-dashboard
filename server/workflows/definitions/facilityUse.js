// Facility use request — role-based approval with a conflict check against
// data the site already holds, and no write back to congregation records.

const ROOMS = [
  { value: 'Auditorium',      label: 'Auditorium' },
  { value: 'Fellowship Hall', label: 'Fellowship Hall' },
  { value: 'Classroom A',     label: 'Classroom A' },
  { value: 'Classroom B',     label: 'Classroom B' },
  { value: 'Kitchen',         label: 'Kitchen' },
];

module.exports = {
  id: 'facility-use',
  title: 'Facility Use Request',
  description:
    'Ask to use a room for an event. A deacon checks the calendar for a clash, ' +
    'then approves or declines. Nothing is written to the congregation records.',
  startRole: 'approved',
  fallbackRole: 'admin',

  fields: [
    { key: 'room',    label: 'Room',           type: 'select', options: ROOMS, required: true },
    { key: 'date',    label: 'Date',           type: 'date',   required: true },
    { key: 'time',    label: 'Time',           type: 'text',   required: true, placeholder: '6:00 PM – 8:00 PM' },
    { key: 'purpose', label: 'Purpose',        type: 'text',   required: true, placeholder: 'Youth devotional' },
    { key: 'setup',   label: 'Setup needed',   type: 'textarea', placeholder: 'Tables for 40, projector…' },
  ],

  titleFor: data => `${data.room} — ${data.date}`,

  start: 'review',

  steps: {
    review: {
      title: 'Deacon review',
      instruction:
        'Check the calendar for anything already booked in this room at this time, ' +
        'then approve or decline the request.',
      assign: { role: 'admin' },
      actions: [
        { id: 'approve', label: 'Approve',        tone: 'good', to: 'confirm' },
        { id: 'clash',   label: 'Room not free',  tone: 'bad',  to: 'declined', requiresNote: true },
        { id: 'decline', label: 'Decline',        tone: 'bad',  to: 'declined', requiresNote: true },
      ],
    },

    confirm: {
      title: 'Confirm with requester',
      instruction: 'The room is yours. Confirm once you have the details you need.',
      assign: { creator: true },
      assignLabel: 'Whoever asked',
      actions: [
        { id: 'confirm', label: 'Confirmed',   tone: 'good', to: 'approved' },
        { id: 'cancel',  label: 'No longer needed', tone: 'bad', to: 'withdrawn' },
      ],
    },
  },

  outcomes: {
    approved:  { label: 'Approved',  tone: 'good' },
    declined:  { label: 'Declined',  tone: 'bad' },
    withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  },
};
