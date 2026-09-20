// Church groups: who may make them, who leads one, and what a leader's
// meeting collects — answers, sign-ups, and the notifications both raise.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const router  = require('../routes/groups');
const groups  = require('../lib/churchGroups');
const notifications = require('../lib/notifications');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/groups', router);
  return app;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function addPerson(name, { email = '', address = '', zip = '' } = {}) {
  return db.prepare('INSERT INTO directory (name, email, address, zip) VALUES (?, ?, ?, ?)')
    .run(name, email, address, zip).lastInsertRowid;
}

let accounts = 0;
function addAccount(name, { role = 'approved', directoryId = null, areas = [] } = {}) {
  accounts += 1;
  const id = db.prepare(`
    INSERT INTO users (provider, provider_id, email, name, role, directory_id)
    VALUES ('local', ?, ?, ?, ?, ?)
  `).run(`acct-${accounts}`, `${name.toLowerCase().replace(/\W/g, '')}@example.com`, name, role, directoryId).lastInsertRowid;

  for (const area of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, area);
  return { id, name, role, directory_id: directoryId, areas };
}

beforeEach(() => {
  for (const table of [
    'event_comments', 'notifications', 'group_event_signups', 'group_event_signup_items',
    'group_event_rsvps', 'group_events', 'church_group_members', 'church_groups',
    'mail_group_members', 'mail_outbox', 'user_areas', 'users', 'directory', 'action_log',
  ]) db.prepare(`DELETE FROM "${table}"`).run();
  db.prepare("DELETE FROM mail_groups WHERE key LIKE 'group-%' OR key LIKE 'team-%'").run();
});

// ─── Who may look after every group ───────────────────────────────────────────

describe('the church groups area', () => {
  test('a member cannot make a group or generate a set of them', async () => {
    const member = addAccount('Jo Member');

    const made = await request(buildApp(member)).post('/api/groups').send({ name: 'Group 1' });
    expect(made.status).toBe(403);
    expect(made.body.area).toBe('church-groups');

    const generated = await request(buildApp(member)).post('/api/groups/generate').send({ count: 3 });
    expect(generated.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS n FROM church_groups').get().n).toBe(0);
  });

  test('a pending account holds nothing, whatever it was granted', async () => {
    const waiting = addAccount('Pat Waiting', { role: 'pending', areas: ['church-groups'] });
    const res = await request(buildApp(waiting)).post('/api/groups').send({ name: 'Group 1' });
    expect(res.status).toBe(403);
  });

  test('the group manager creates one, and its mailing list comes with it', async () => {
    const manager = addAccount('Mo Manager', { areas: ['church-groups'] });
    const res = await request(buildApp(manager))
      .post('/api/groups')
      .send({ name: 'North Harvest', meets: 'Second Sunday', email: 'north@example.org' });

    expect(res.status).toBe(200);
    expect(res.body.group).toMatchObject({ key: 'north-harvest', name: 'North Harvest' });

    const list = db.prepare('SELECT * FROM mail_groups WHERE key = ?').get('north-harvest');
    expect(list).toBeTruthy();
    expect(res.body.group.mailGroupId).toBe(list.id);
  });
});

// ─── Generating a set ─────────────────────────────────────────────────────────

describe('generating the groups', () => {
  test('makes the set, each with its own distribution list', async () => {
    const manager = addAccount('Mo Manager', { areas: ['church-groups'] });
    const res = await request(buildApp(manager))
      .post('/api/groups/generate')
      .send({ count: 4, prefix: 'Team', emailDomain: 'capshawchurch.org' });

    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(4);
    expect(res.body.created.map(g => g.key)).toEqual(['team-1', 'team-2', 'team-3', 'team-4']);
    expect(res.body.created[0].email).toBe('team-1@capshawchurch.org');

    for (const key of ['team-1', 'team-4']) {
      expect(db.prepare('SELECT 1 FROM mail_groups WHERE key = ?').get(key)).toBeTruthy();
    }
  });

  test('refuses an unreasonable number rather than making it', async () => {
    const manager = addAccount('Mo Manager', { areas: ['church-groups'] });
    for (const count of [0, 51, 'lots']) {
      const res = await request(buildApp(manager)).post('/api/groups/generate').send({ count });
      expect(res.status).toBe(400);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM church_groups').get().n).toBe(0);
  });

  test('spreads the directory across them, keeping a household together', async () => {
    const manager = addAccount('Mo Manager', { areas: ['church-groups'] });
    // Three at one address, three at another, and two on their own.
    for (const name of ['Ray Harris', 'Jo Harris', 'Tim Harris']) addPerson(name, { address: '1 Oak St', zip: '35749' });
    for (const name of ['Ann Doss', 'Ed Doss', 'Lu Doss'])       addPerson(name, { address: '2 Elm St', zip: '35749' });
    addPerson('Solo One');
    addPerson('Solo Two');

    const res = await request(buildApp(manager))
      .post('/api/groups/generate')
      .send({ count: 2, assignMembers: true });

    expect(res.status).toBe(200);
    expect(res.body.assigned.placed).toBe(8);

    const groupOf = name => db.prepare(`
      SELECT m.group_id FROM church_group_members m
        JOIN directory d ON d.id = m.directory_id WHERE d.name = ?
    `).get(name).group_id;

    expect(groupOf('Ray Harris')).toBe(groupOf('Tim Harris'));
    expect(groupOf('Ann Doss')).toBe(groupOf('Lu Doss'));
    // Two households of three and two singles across two groups: four each.
    const counts = db.prepare('SELECT group_id, COUNT(*) AS n FROM church_group_members GROUP BY group_id').all();
    expect(counts.map(c => c.n).sort()).toEqual([4, 4]);
  });

  test('running it again tops the set up without moving anybody', async () => {
    const manager = addAccount('Mo Manager', { areas: ['church-groups'] });
    addPerson('Ray Harris', { address: '1 Oak St' });

    await request(buildApp(manager)).post('/api/groups/generate').send({ count: 2, assignMembers: true });
    const firstPlacement = db.prepare('SELECT group_id FROM church_group_members').get().group_id;

    const again = await request(buildApp(manager))
      .post('/api/groups/generate')
      .send({ count: 3, assignMembers: true });

    expect(again.body.created.map(g => g.key)).toEqual(['group-3']);
    expect(again.body.skipped).toEqual(['group-1', 'group-2']);
    expect(db.prepare('SELECT group_id FROM church_group_members').get().group_id).toBe(firstPlacement);
  });

  test('the roll is mirrored onto the distribution list', async () => {
    const manager = addAccount('Mo Manager', { areas: ['church-groups'] });
    addPerson('Ray Harris', { email: 'ray@example.com' });
    addPerson('Jo Harris',  { email: 'jo@example.com' });

    await request(buildApp(manager)).post('/api/groups/generate').send({ count: 1, assignMembers: true });

    const mailGroup = db.prepare("SELECT id FROM mail_groups WHERE key = 'group-1'").get();
    const onList = db.prepare('SELECT COUNT(*) AS n FROM mail_group_members WHERE group_id = ?').get(mailGroup.id).n;
    expect(onList).toBe(2);
  });

  test('everybody placed is told which group they are in', async () => {
    const manager = addAccount('Mo Manager', { areas: ['church-groups'] });
    const rayId = addPerson('Ray Harris', { email: 'ray@example.com' });
    const ray   = addAccount('Ray Harris', { directoryId: rayId });

    await request(buildApp(manager)).post('/api/groups/generate').send({ count: 1, assignMembers: true });

    const told = notifications.listFor(ray.id);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: 'group-membership', page: 'groups', read: false });
  });
});

// ─── A part in one group ──────────────────────────────────────────────────────

describe('roles inside a group', () => {
  let manager;
  let group;
  let leaderPerson;
  let memberPerson;

  beforeEach(() => {
    manager = addAccount('Mo Manager', { areas: ['church-groups'] });
    group = groups.createGroup({ name: 'North Harvest' }).group;
    leaderPerson = addPerson('Lee Leader', { email: 'lee@example.com' });
    memberPerson = addPerson('Jo Member',  { email: 'jo@example.com' });
    groups.addMember(group.id, { directoryId: leaderPerson, role: 'leader' });
    groups.addMember(group.id, { directoryId: memberPerson, role: 'member' });
  });

  test('leading one group says nothing about another', () => {
    const leader = addAccount('Lee Leader', { directoryId: leaderPerson });
    const other  = groups.createGroup({ name: 'Wall Triana' }).group;

    expect(groups.leadsGroup(leader, group.id)).toBe(true);
    expect(groups.leadsGroup(leader, other.id)).toBe(false);
  });

  test('a leader may add people and name a host, but not appoint a leader', async () => {
    const leader = addAccount('Lee Leader', { directoryId: leaderPerson });
    const newcomer = addPerson('Sam New');

    const asHost = await request(buildApp(leader))
      .post(`/api/groups/${group.id}/members`)
      .send({ directoryId: newcomer, role: 'host' });
    expect(asHost.status).toBe(200);
    expect(asHost.body.members.find(m => m.name === 'Sam New').role).toBe('host');

    const asLeader = await request(buildApp(leader))
      .post(`/api/groups/${group.id}/members`)
      .send({ directoryId: addPerson('Kim Other'), role: 'co-leader' });
    expect(asLeader.status).toBe(403);
  });

  test('the group manager appoints the leader, and they are told', async () => {
    const jo = addAccount('Jo Member', { directoryId: memberPerson });
    const memberRow = groups.membersOf(group.id).find(m => m.directoryId === memberPerson);

    const res = await request(buildApp(manager))
      .patch(`/api/groups/${group.id}/members/${memberRow.id}`)
      .send({ role: 'co-leader' });

    expect(res.status).toBe(200);
    expect(res.body.members.find(m => m.directoryId === memberPerson).role).toBe('co-leader');
    expect(notifications.listFor(jo.id)[0].title).toContain('Co-leader of North Harvest');
  });

  test('a plain member cannot edit the roll', async () => {
    const jo = addAccount('Jo Member', { directoryId: memberPerson });
    const res = await request(buildApp(jo))
      .post(`/api/groups/${group.id}/members`)
      .send({ directoryId: addPerson('Sam New') });
    expect(res.status).toBe(403);
  });

  test('somebody outside the group sees that it exists and no more', async () => {
    const outsider = addAccount('Al Outsider', { directoryId: addPerson('Al Outsider') });
    const res = await request(buildApp(outsider)).get(`/api/groups/${group.id}`);

    expect(res.status).toBe(200);
    expect(res.body.group.name).toBe('North Harvest');
    expect(res.body.members).toEqual([]);
    expect(res.body.perms.canSeeRoll).toBe(false);
  });

  test('removing somebody takes them off the mailing list too', async () => {
    const leader = addAccount('Lee Leader', { directoryId: leaderPerson });
    const memberRow = groups.membersOf(group.id).find(m => m.directoryId === memberPerson);

    const res = await request(buildApp(leader)).delete(`/api/groups/${group.id}/members/${memberRow.id}`);
    expect(res.status).toBe(200);

    const mailGroup = db.prepare('SELECT mail_group_id AS id FROM church_groups WHERE id = ?').get(group.id);
    const stillOn = db.prepare('SELECT COUNT(*) AS n FROM mail_group_members WHERE group_id = ? AND directory_id = ?')
      .get(mailGroup.id, memberPerson).n;
    expect(stillOn).toBe(0);
  });
});

// ─── A group's meeting ────────────────────────────────────────────────────────

describe('a group meeting', () => {
  let group;
  let leader;
  let member;

  beforeEach(() => {
    group = groups.createGroup({ name: 'North Harvest' }).group;

    const leaderPerson = addPerson('Lee Leader', { email: 'lee@example.com' });
    const memberPerson = addPerson('Jo Member',  { email: 'jo@example.com' });
    groups.addMember(group.id, { directoryId: leaderPerson, role: 'leader' });
    groups.addMember(group.id, { directoryId: memberPerson, role: 'member' });

    leader = addAccount('Lee Leader', { directoryId: leaderPerson });
    member = addAccount('Jo Member',  { directoryId: memberPerson });
  });

  async function draftMeeting(body = {}) {
    const res = await request(buildApp(leader))
      .post(`/api/groups/${group.id}/events`)
      .send({ title: 'Fellowship meal', date: '2026-10-11', time: '17:00', location: 'The Lee home', ...body });
    return res.body.event;
  }

  test('only a leader may post one', async () => {
    const res = await request(buildApp(member))
      .post(`/api/groups/${group.id}/events`)
      .send({ title: 'Fellowship meal' });
    expect(res.status).toBe(403);
  });

  test('starts as a draft that the group cannot see', async () => {
    const event = await draftMeeting();
    expect(event.status).toBe('draft');

    const asMember = await request(buildApp(member)).get(`/api/groups/${group.id}`);
    expect(asMember.body.events).toEqual([]);

    const asLeader = await request(buildApp(leader)).get(`/api/groups/${group.id}`);
    expect(asLeader.body.events).toHaveLength(1);
  });

  test('publishing tells the roll and queues the group its email', async () => {
    const event = await draftMeeting();
    const res = await request(buildApp(leader))
      .post(`/api/groups/${group.id}/events/${event.id}/publish`);

    expect(res.status).toBe(200);
    expect(res.body.event.status).toBe('published');

    // The leader who posted it is not told about their own doing.
    expect(notifications.listFor(leader.id)).toHaveLength(0);
    const told = notifications.listFor(member.id);
    expect(told[0]).toMatchObject({ kind: 'group-event-published', subjectType: 'group-event', page: 'groups' });

    const queued = db.prepare("SELECT * FROM mail_outbox WHERE context LIKE 'group-event:%'").all();
    expect(queued.length).toBeGreaterThan(0);
    expect(queued[0].subject).toBe('North Harvest: Fellowship meal');
  });

  test('publishing twice is refused rather than telling everybody again', async () => {
    const event = await draftMeeting();
    await request(buildApp(leader)).post(`/api/groups/${group.id}/events/${event.id}/publish`);
    const again = await request(buildApp(leader)).post(`/api/groups/${group.id}/events/${event.id}/publish`);
    expect(again.status).toBe(400);
  });

  test('cancelling a draft tells nobody; cancelling a posted meeting tells the group', async () => {
    const draft = await draftMeeting();
    const quiet = await request(buildApp(leader)).post(`/api/groups/${group.id}/events/${draft.id}/cancel`);
    expect(quiet.body.notified).toBe(0);

    const posted = await draftMeeting({ title: 'Singing night' });
    await request(buildApp(leader)).post(`/api/groups/${group.id}/events/${posted.id}/publish`);
    const loud = await request(buildApp(leader)).post(`/api/groups/${group.id}/events/${posted.id}/cancel`);
    expect(loud.body.notified).toBe(1);
    expect(notifications.listFor(member.id).some(n => n.kind === 'group-event-cancelled')).toBe(true);
  });

  // ─── The invitation ─────────────────────────────────────────────────────────

  describe('answering the invitation', () => {
    let event;
    beforeEach(async () => {
      event = await draftMeeting();
      await request(buildApp(leader)).post(`/api/groups/${group.id}/events/${event.id}/publish`);
    });

    test('a head count is the yeses plus the people they bring', async () => {
      await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/rsvp`)
        .send({ response: 'yes', guests: 3 });

      const res = await request(buildApp(leader)).get(`/api/groups/${group.id}/events/${event.id}`);
      expect(res.body.event.summary).toMatchObject({ yes: 1, guests: 3, attending: 4 });
    });

    test('changing your mind corrects your answer instead of counting twice', async () => {
      await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/rsvp`).send({ response: 'yes' });
      const res = await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/rsvp`).send({ response: 'no' });

      expect(res.body.summary).toMatchObject({ yes: 0, no: 1 });
      expect(res.body.rsvps).toHaveLength(1);
    });

    test('the leaders hear about a new answer, and not about a correction', async () => {
      await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/rsvp`).send({ response: 'yes', guests: 2 });
      expect(notifications.listFor(leader.id).filter(n => n.kind === 'group-event-rsvp')).toHaveLength(1);

      await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/rsvp`).send({ response: 'maybe' });
      expect(notifications.listFor(leader.id).filter(n => n.kind === 'group-event-rsvp')).toHaveLength(1);
    });

    test('somebody outside the group cannot answer', async () => {
      const outsider = addAccount('Al Outsider', { directoryId: addPerson('Al Outsider') });
      const res = await request(buildApp(outsider))
        .post(`/api/groups/${group.id}/events/${event.id}/rsvp`).send({ response: 'yes' });
      expect(res.status).toBe(403);
    });

    test('nonsense for an answer is refused', async () => {
      const res = await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/rsvp`).send({ response: 'perhaps' });
      expect(res.status).toBe(400);
    });

    test('everybody coming hears when the details change', async () => {
      await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/rsvp`).send({ response: 'yes' });

      await request(buildApp(leader))
        .put(`/api/groups/${group.id}/events/${event.id}`)
        .send({ title: 'Fellowship meal', time: '18:30' });

      expect(notifications.listFor(member.id).some(n => n.kind === 'group-event-updated')).toBe(true);
      expect(db.prepare("SELECT COUNT(*) AS n FROM mail_outbox WHERE context LIKE '%:changed'").get().n).toBe(1);
    });
  });

  // ─── The sign-up list ───────────────────────────────────────────────────────

  describe('the sign-up list', () => {
    let event;
    beforeEach(async () => {
      event = await draftMeeting({ signupEnabled: true });
      await request(buildApp(leader))
        .put(`/api/groups/${group.id}/events/${event.id}/signup-items`)
        .send({ items: [{ label: 'Main dish', needed: 2 }, { label: 'Dessert', needed: 1 }] });
      await request(buildApp(leader)).post(`/api/groups/${group.id}/events/${event.id}/publish`);
    });

    test('a member takes something, and what is left goes down', async () => {
      const items = (await request(buildApp(member)).get(`/api/groups/${group.id}/events/${event.id}`)).body.event.signups;
      const dessert = items.find(i => i.label === 'Dessert');

      const res = await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/signups`)
        .send({ itemId: dessert.id, detail: 'a pecan pie' });

      expect(res.status).toBe(200);
      const after = res.body.signups.find(i => i.label === 'Dessert');
      expect(after.remaining).toBe(0);
      expect(after.claims[0]).toMatchObject({ name: 'Jo Member', detail: 'a pecan pie' });
      expect(notifications.listFor(leader.id).some(n => n.kind === 'group-event-signup')).toBe(true);
    });

    test('something already covered cannot be taken twice', async () => {
      const items = (await request(buildApp(member)).get(`/api/groups/${group.id}/events/${event.id}`)).body.event.signups;
      const dessert = items.find(i => i.label === 'Dessert');

      await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/signups`).send({ itemId: dessert.id });
      const again = await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/signups`).send({ itemId: dessert.id });

      expect(again.status).toBe(400);
    });

    test('you may drop your own sign-up, and not somebody else\'s', async () => {
      const items = (await request(buildApp(member)).get(`/api/groups/${group.id}/events/${event.id}`)).body.event.signups;
      const claimed = (await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/signups`)
        .send({ itemId: items[0].id })).body.signups[0].claims[0];

      const otherPerson = addPerson('Sam New');
      groups.addMember(group.id, { directoryId: otherPerson, role: 'member' });
      const other = addAccount('Sam New', { directoryId: otherPerson });

      const refused = await request(buildApp(other))
        .delete(`/api/groups/${group.id}/events/${event.id}/signups/${claimed.id}`);
      expect(refused.status).toBe(403);

      const mine = await request(buildApp(member))
        .delete(`/api/groups/${group.id}/events/${event.id}/signups/${claimed.id}`);
      expect(mine.status).toBe(200);
      expect(mine.body.signups[0].claims).toEqual([]);
    });

    test('editing the wording of an item keeps the claim under it', async () => {
      const items = (await request(buildApp(member)).get(`/api/groups/${group.id}/events/${event.id}`)).body.event.signups;
      await request(buildApp(member))
        .post(`/api/groups/${group.id}/events/${event.id}/signups`).send({ itemId: items[0].id });

      const res = await request(buildApp(leader))
        .put(`/api/groups/${group.id}/events/${event.id}/signup-items`)
        .send({ items: [{ id: items[0].id, label: 'Main dish (hot)', needed: 2 }] });

      expect(res.body.signups).toHaveLength(1);
      expect(res.body.signups[0].label).toBe('Main dish (hot)');
      expect(res.body.signups[0].claims).toHaveLength(1);
    });
  });
});

// ─── What the landing page shows ──────────────────────────────────────────────

describe('GET /api/groups', () => {
  test('says which groups are mine and what is coming up in them', async () => {
    const manager = addAccount('Mo Manager', { areas: ['church-groups'] });
    const mine  = groups.createGroup({ name: 'North Harvest' }).group;
    const other = groups.createGroup({ name: 'Wall Triana' }).group;

    const person = addPerson('Jo Member', { email: 'jo@example.com' });
    groups.addMember(mine.id, { directoryId: person, role: 'leader' });
    const jo = addAccount('Jo Member', { directoryId: person });

    const drafted = await request(buildApp(jo))
      .post(`/api/groups/${mine.id}/events`)
      .send({ title: 'Fellowship meal', date: '2099-01-01' });
    await request(buildApp(jo)).post(`/api/groups/${mine.id}/events/${drafted.body.event.id}/publish`);

    const res = await request(buildApp(jo)).get('/api/groups');
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(2);
    expect(res.body.mine.map(g => g.id)).toEqual([mine.id]);
    expect(res.body.mine[0].myRole).toBe('leader');
    expect(res.body.upcoming).toHaveLength(1);
    expect(res.body.canManage).toBe(false);

    const asManager = await request(buildApp(manager)).get('/api/groups');
    expect(asManager.body.canManage).toBe(true);
    expect(asManager.body.mine).toEqual([]);
    expect(other.id).toBeTruthy();
  });

  test('an account nobody has matched to the directory is told so', async () => {
    const stray = addAccount('No Directory');
    const res = await request(buildApp(stray)).get('/api/groups');
    expect(res.body.linkedToDirectory).toBe(false);
    expect(res.body.mine).toEqual([]);
  });
});
