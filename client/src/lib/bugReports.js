// Client-side mirror of server/lib/bugReports.js.

export const SEVERITIES = [
  { id: 'minor',    label: 'Just a little something', hint: "Doesn't stop anything", tone: 'bg-gray-100 text-gray-600 border-gray-200' },
  { id: 'annoying', label: "It's getting in my way",  hint: 'Slows me down, but I can work around it', tone: 'bg-amber-100 text-amber-800 border-amber-200' },
  { id: 'blocking', label: "I can't get this done",   hint: 'Stops me completely', tone: 'bg-red-100 text-red-800 border-red-200' },
];

export const STATUSES = [
  { id: 'open',        label: 'Open',        tone: 'bg-amber-100 text-amber-800' },
  { id: 'in_progress', label: 'In progress', tone: 'bg-sky-100 text-sky-800' },
  { id: 'resolved',    label: 'Resolved',    tone: 'bg-emerald-100 text-emerald-800' },
  { id: 'wont_fix',    label: "Won't fix",   tone: 'bg-gray-100 text-gray-600' },
];

export function severityInfo(id) {
  return SEVERITIES.find(s => s.id === id) ?? SEVERITIES[1];
}

export function statusInfo(id) {
  return STATUSES.find(s => s.id === id) ?? STATUSES[0];
}
