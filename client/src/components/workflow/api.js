// Shared client-side plumbing for workflows. Workflows are surfaced on the
// page they belong to (the roster, the visitors, the calendar) rather than on
// a page of their own, so these pieces are used from several places.

export const API = '/api/workflows';

export async function call(url, options = {}) {
  const res  = await fetch(url, { credentials: 'include', ...options });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

export const TONE_BUTTON = {
  good:    'bg-emerald-600 text-white hover:bg-emerald-700',
  bad:     'border border-red-200 text-red-600 hover:bg-red-50',
  neutral: 'border border-gray-200 text-gray-700 hover:bg-gray-50',
};

export const OUTCOME_BADGE = {
  good:    'bg-emerald-100 text-emerald-800',
  bad:     'bg-red-100 text-red-700',
  neutral: 'bg-gray-100 text-gray-600',
};
