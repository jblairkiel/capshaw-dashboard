// The ways to sign in besides a password: the names people know them by, the
// order the sign-in page offers them in, and each one's mark. The server says
// which of them are set up (GET /api/auth/providers).

export const PROVIDER_ORDER = ['google', 'facebook', 'yahoo', 'microsoft', 'apple'];

export const PROVIDER_NAMES = {
  google:    'Google',
  facebook:  'Facebook',
  yahoo:     'Yahoo',
  microsoft: 'Microsoft',
  apple:     'Apple',
};

// "Google", "Google or Facebook", "Google, Facebook or Apple".
export function namesOf(providers, conjunction = 'or') {
  const names = providers.map(p => PROVIDER_NAMES[p]).filter(Boolean);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${conjunction} ${names[names.length - 1]}`;
}
