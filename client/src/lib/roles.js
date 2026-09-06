// Client-side mirror of server/middleware/auth.js. The server is always the
// authority — these helpers only decide what to show.

export const ROLE_RANK = {
  pending:  0,
  approved: 1,
  admin:    2,
};

export const ROLES = [
  {
    id:          'pending',
    label:       'Pending',
    badge:       'Pending approval',
    description: 'Can view the dashboard, but cannot create or edit anything.',
    tone:        'bg-orange-100 text-orange-700',
  },
  {
    id:          'approved',
    label:       'Member',
    badge:       'Member',
    description: 'Bible class and lesson tools, site updates, and their own household\'s details and worship preferences. Announcements, songs and the order of service are read-only.',
    tone:        'bg-green-100 text-green-700',
  },
  {
    id:          'admin',
    label:       'Admin',
    badge:       'Admin',
    description: 'Everything a member can do, plus writing announcements, songs and the order of service, managing user roles, and editing every database table directly.',
    tone:        'bg-church-gold/20 text-church-navy',
  },
];

export function roleInfo(role) {
  return ROLES.find(r => r.id === role) ?? ROLES[0];
}

export function hasRole(user, minRole) {
  return (ROLE_RANK[user?.role] ?? -1) >= ROLE_RANK[minRole];
}

/** Member functions: creating and editing dashboard content. */
export function hasWriteAccess(user) {
  return hasRole(user, 'approved');
}

/** Admin privileges: user roles and direct database editing. */
export function isAdmin(user) {
  return hasRole(user, 'admin');
}
