// Client-side mirror of server/lib/people.js. The server validates every write;
// these are here so the UI can render the same vocabulary.

export const WORSHIP_ROLES = [
  'Song Leader',
  'Opening Prayer',
  'Scripture Reading',
  'Communion',
  'Speaker',
  'Closing Prayer',
  'Usher',
  'Visuals',
  'Visual Preparation',
  'Announcements',
];

export const PREFERENCE_LEVELS = [
  { id: 'preferred',   label: 'Glad to',    hint: 'Happy to be scheduled for this',      tone: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { id: 'willing',     label: 'Willing',    hint: 'Available if needed',                 tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'unavailable', label: 'Rather not', hint: 'Please do not schedule this',         tone: 'bg-gray-100 text-gray-500 border-gray-200' },
];

export const DIRECTORY_FIELDS = [
  { key: 'name',    label: 'Name',       placeholder: 'First Last' },
  { key: 'address', label: 'Address',    placeholder: '123 Main St' },
  { key: 'city',    label: 'City',       placeholder: 'Harvest' },
  { key: 'state',   label: 'State',      placeholder: 'AL' },
  { key: 'zip',     label: 'Zip',        placeholder: '35749' },
  { key: 'phone',   label: 'Home Phone', placeholder: '(256) 555-0100' },
  { key: 'cell',    label: 'Cell Phone', placeholder: '(256) 555-0101' },
  { key: 'email',   label: 'Email',      placeholder: 'name@example.com' },
  { key: 'notes',   label: 'Notes',      placeholder: '' },
];

export function levelInfo(level) {
  return PREFERENCE_LEVELS.find(l => l.id === level) ?? null;
}
