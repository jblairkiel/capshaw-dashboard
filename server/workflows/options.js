// Some start-form fields can only be filled from live data — the duties this
// particular member is rostered for, the visitors on file, the people whose
// logins are linked so a task can actually reach them. A field declares
// `optionsFrom: '<name>'` and the resolver below fills it in when the form is
// opened, scoped to whoever is opening it.

const db = require('../db');

const resolvers = {
  // Only the requester's own upcoming duties: you cannot swap somebody
  // else's turn out from under them.
  myAssignments(user) {
    if (!user?.directory_id) return [];
    const person = db.prepare('SELECT name FROM directory WHERE id = ?').get(user.directory_id);
    if (!person?.name) return [];

    return db.prepare(`
      SELECT id, month, date, service, job
      FROM job_assignments
      WHERE lower(trim(name)) = lower(trim(?))
      ORDER BY id ASC
      LIMIT 100
    `).all(person.name).map(r => ({
      value: String(r.id),
      label: `${r.date || r.month} · ${r.service} · ${r.job}`,
    }));
  },

  visitors() {
    return db.prepare('SELECT id, name FROM visitors ORDER BY name ASC LIMIT 300')
      .all()
      .map(v => ({ value: String(v.id), label: v.name }));
  },

  // Directory people who have a login linked, since a task aimed at somebody
  // without one would have nowhere to land.
  linkedPeople() {
    return db.prepare(`
      SELECT d.id, d.name
      FROM directory d
      JOIN users u ON u.directory_id = d.id
      WHERE u.role IN ('approved', 'admin')
      ORDER BY d.name ASC
      LIMIT 300
    `).all().map(p => ({ value: String(p.id), label: p.name }));
  },
};

// Returns the definition's fields with any dynamic options filled in.
function fieldsFor(definition, user) {
  return (definition.fields || []).map(field => {
    if (!field.optionsFrom) return { ...field };
    const resolver = resolvers[field.optionsFrom];
    return { ...field, options: resolver ? resolver(user) : [] };
  });
}

module.exports = { resolvers, fieldsFor };
