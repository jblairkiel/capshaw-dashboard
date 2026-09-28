// Fills a guide run's throwaway database and writes down what is in it.
//
// Run by run.js in its own process, with CAPSHAW_DATA_DIR pointing at the
// run's work directory (server/db opens whatever that says the moment it is
// required, so this must never be loaded into a process aimed at real data).
//
// The sample data is the app's own (server/seed) and comes out different on
// every run — names are drawn from a seed, and dates are relative to today. So
// rather than scenes naming people, this picks who to feature and writes it to
// facts.json: the member to sign in as, a family to search for, a guest with a
// follow-up history, and so on. Scenes read those.
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const work = process.argv[2];
if (!work || !process.env.CAPSHAW_DATA_DIR || !process.env.CAPSHAW_DATA_DIR.startsWith(work)) {
  console.error('setup/index.js is run by run.js, against a work directory only.');
  process.exit(1);
}

const db = require(`${REPO}/server/db`);
const seed = require(`${REPO}/server/seed`);
const groupEvents = require(`${REPO}/server/lib/groupEvents`);
const { hashPassword } = require(`${REPO}/server/lib/passwords`);

// Local only: this account exists in the run's throwaway database and nowhere
// else, and the servers it signs in to listen on localhost.
const LOGIN = { email: 'guide@example.com', password: 'Guide-Sample-Password-2026' };

const surname = name => name.trim().split(/\s+/).pop();

(async () => {
  seed.generate({ generators: seed.catalogue().map(g => g.id), scale: 3, note: 'guide recording', by: 'tools/guides' });

  // ── Who to feature ─────────────────────────────────────────────────────────

  // Whoever leads a group with an upcoming meeting that takes RSVPs and
  // sign-ups is the guide's "me": that makes the Church Groups scenes, the
  // Serving Schedule's time away and the email link all theirs.
  const event = db.prepare(`
    SELECT * FROM group_events
     WHERE status = 'published' AND rsvp_enabled = 1 AND signup_enabled = 1 AND event_date >= date('now')
     ORDER BY event_date LIMIT 1
  `).get();
  if (!event) throw new Error('The sample data has no upcoming group meeting with RSVPs and sign-ups to feature.');
  const me = db.prepare(`
    SELECT d.* FROM church_group_members m JOIN directory d ON d.id = m.directory_id
     WHERE m.group_id = ? AND m.role IN ('leader', 'co-leader')
     ORDER BY d.id LIMIT 1
  `).get(event.group_id);
  const group = db.prepare('SELECT * FROM church_groups WHERE id = ?').get(event.group_id);

  const everyone = db.prepare('SELECT * FROM directory ORDER BY id').all();
  const others = everyone.filter(p => p.id !== me.id && surname(p.name) !== surname(me.name));
  const families = new Map();
  for (const p of others) {
    const key = `${surname(p.name)}|${p.address}`;
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(p);
  }
  const bySize = [...families.values()].sort((a, b) => b.length - a.length || a[0].id - b[0].id);
  const family = surname(bySize[0][0].name);
  const otherFamily = surname(bySize.find(f => surname(f[0].name) !== family)[0].name);

  // The guest whose follow-ups went round the most times has the most to show.
  const guest = db.prepare(`
    SELECT v.name, COUNT(t.id) AS rounds FROM workflow_instances i
      JOIN workflow_tasks t ON t.instance_id = i.id AND t.completed_at IS NOT NULL
      JOIN visitors v ON v.id = json_extract(i.data, '$.visitorId')
     WHERE i.definition_id = 'visitor-follow-up'
     GROUP BY v.id ORDER BY rounds DESC, v.id LIMIT 1
  `).get() || db.prepare('SELECT name FROM visitors ORDER BY id LIMIT 1').get();

  const volunteer = others.find(p => p.gender === 'male') || others[0];

  // ── Accounts ──────────────────────────────────────────────────────────────

  db.prepare(`
    INSERT INTO users (provider, provider_id, email, name, role, password_hash, email_verified_at, directory_id)
    VALUES ('local', ?, ?, ?, 'admin', ?, datetime('now'), ?)
  `).run(LOGIN.email, LOGIN.email, me.name, await hashPassword(LOGIN.password), me.id);

  // A few more people signed in, so Members & Access has something to show,
  // and one still waiting to be approved.
  const members = others.filter(p => p.email).slice(0, 6);
  const addUser = db.prepare(`
    INSERT INTO users (provider, provider_id, email, name, role, directory_id, email_verified_at, last_login)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', ?))
  `);
  members.forEach((p, i) => {
    const pending = i === members.length - 1;
    addUser.run(i % 2 ? 'google' : 'facebook', `guide-${p.id}`, p.email, p.name,
      pending ? 'pending' : 'approved', pending ? null : p.id, `-${i + 1} days`);
  });
  const pendingName = members[members.length - 1].name;

  // ── The newsletter ────────────────────────────────────────────────────────
  //
  // The bulletin sample data carries real-looking names (issue #95). Until the
  // generator draws from server/seed/people.js like the others, its lists are
  // rewritten here from the made-up directory.
  const pick = n => others[n % others.length].name;
  db.prepare(`
    UPDATE bulletin_issues SET updates = ?, ongoing = ?, shut_ins = ?, pregnancies = ?, evangelists = ?, group_notes = ?
  `).run(
    `The ${surname(pick(3))}s are back from their trip and send their thanks\n${pick(5)} is recovering well after surgery`,
    `${pick(7)}\n${pick(9)} and ${pick(10)}\n${pick(12)}, recovering at home`,
    `${pick(14)}, ${pick(16)}\n${pick(18)}`,
    `${pick(20)} – December (girl)\n${pick(22)} – February (boy)`,
    `${pick(24)} – Chiapas, Mexico\n${pick(26)} – Nyeri, Kenya\n${pick(28)} – High Springs, Florida`,
    JSON.stringify({ 'group-1': { leader: pick(1), note: '' }, 'group-2': { leader: pick(2), note: '' }, 'group-3': { leader: pick(4), note: `Meeting at the ${surname(pick(4))} home` } }),
  );

  // ── The email a member gets when their group posts a meeting ─────────────
  //
  // Written by the app's own notify.js, with the production address in its
  // link, and caught before it is queued: nothing is sent or stored.
  process.env.NODE_ENV = 'production';
  const mailGroups = require(`${REPO}/server/mail/groups`);
  mailGroups.recipientsFor = () => ({ recipients: [{ email: me.email || LOGIN.email, name: me.name }], missing: [] });
  const mailer = require(`${REPO}/server/mail/mailer`);
  let email = null;
  mailer.enqueue = message => { email = message; return []; };
  require(`${REPO}/server/mail/notify`).groupEventPublished({ group, event: groupEvents.getEvent(event.id) });
  const link = email.body.match(/https?:\/\/\S+/)[0];

  const facts = {
    login: LOGIN,
    me: { name: me.name, directoryId: me.id },
    group: { id: group.id, name: group.name },
    event: { id: event.id, title: event.title },
    email: { subject: email.subject, body: email.body, link, path: new URL(link).search ? `/${new URL(link).search}` : '/' },
    family, otherFamily,
    guest: guest.name,
    volunteer: volunteer.name,
    pending: pendingName,
  };
  fs.writeFileSync(path.join(work, 'facts.json'), JSON.stringify(facts, null, 2));
  console.log(`  signed in as ${me.name}; featuring the ${family} family, guest ${guest.name}, meeting "${event.title}"`);
})().catch(e => { console.error(e); process.exit(1); });
