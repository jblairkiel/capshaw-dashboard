// Comments on events, and the notifications a reply raises.
//
// Two kinds of event share one thread table and one router, so the tests below
// are deliberately run against both: a group's meeting, which only the group
// can read, and a dated row on the announcement board, which anybody signed in
// can read.
jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');

const commentRoutes      = require('../routes/comments');
const notificationRoutes = require('../routes/notifications');
const groupRoutes        = require('../routes/groups');
const groups             = require('../lib/churchGroups');
const notifications      = require('../lib/notifications');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/comments', commentRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/groups', groupRoutes);
  return app;
}

function addPerson(name) {
  return db.prepare('INSERT INTO directory (name, email) VALUES (?, ?)')
    .run(name, `${name.toLowerCase().replace(/\W/g, '')}@example.com`).lastInsertRowid;
}

let accounts = 0;
function addAccount(name, { role = 'approved', directoryId = null, areas = [] } = {}) {
  accounts += 1;
  const id = db.prepare(`
    INSERT INTO users (provider, provider_id, email, name, role, directory_id)
    VALUES ('local', ?, ?, ?, ?, ?)
  `).run(`acct-${accounts}`, `${name}@example.com`, name, role, directoryId).lastInsertRowid;
  for (const area of areas) db.prepare('INSERT INTO user_areas (user_id, area) VALUES (?, ?)').run(id, area);
  return { id, name, role, directory_id: directoryId, areas };
}

function addAnnouncement(title = 'Fellowship meal', date = '2099-04-01') {
  return db.prepare('INSERT INTO announcements (type, title, body, event_date) VALUES (?, ?, ?, ?)')
    .run('event', title, '', date).lastInsertRowid;
}

beforeEach(() => {
  for (const table of [
    'event_comments', 'notifications', 'group_event_rsvps', 'group_events',
    'church_group_members', 'church_groups', 'mail_group_members', 'mail_outbox',
    'announcements', 'user_areas', 'users', 'directory', 'action_log',
  ]) db.prepare(`DELETE FROM "${table}"`).run();
});

// ─── The announcement board ───────────────────────────────────────────────────

describe('comments on a church event', () => {
  test('anybody signed in can read the thread, and a member can reply', async () => {
    const jo = addAccount('Jo Member');
    const id = addAnnouncement();

    const posted = await request(buildApp(jo))
      .post(`/api/comments/announcement/${id}`)
      .send({ body: 'What time does it start?' });

    expect(posted.status).toBe(200);
    expect(posted.body.comments).toHaveLength(1);
    expect(posted.body.comments[0]).toMatchObject({ author: 'Jo Member', body: 'What time does it start?' });

    const read = await request(buildApp(addAccount('Al Other'))).get(`/api/comments/announcement/${id}`);
    expect(read.body.comments).toHaveLength(1);
    expect(read.body.canReply).toBe(true);
  });

  test('an account still waiting to be confirmed can read but not reply', async () => {
    const waiting = addAccount('Pat Waiting', { role: 'pending' });
    const id = addAnnouncement();

    const read = await request(buildApp(waiting)).get(`/api/comments/announcement/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.canReply).toBe(false);

    const tried = await request(buildApp(waiting)).post(`/api/comments/announcement/${id}`).send({ body: 'Hello' });
    expect(tried.status).toBe(403);
  });

  test('whoever looks after the board is told about a reply, and the replier is not', async () => {
    const keeper = addAccount('Ed Keeper', { areas: ['announcements'] });
    const jo = addAccount('Jo Member');
    const id = addAnnouncement();

    await request(buildApp(jo)).post(`/api/comments/announcement/${id}`).send({ body: 'What time?' });

    expect(notifications.listFor(keeper.id)).toHaveLength(1);
    expect(notifications.listFor(keeper.id)[0]).toMatchObject({
      kind: 'announcement-comment', page: 'announcements', subjectType: 'announcement',
    });
    expect(notifications.listFor(jo.id)).toHaveLength(0);
  });

  test('everybody already in the thread hears the next reply', async () => {
    const jo = addAccount('Jo Member');
    const al = addAccount('Al Other');
    const id = addAnnouncement();

    await request(buildApp(jo)).post(`/api/comments/announcement/${id}`).send({ body: 'What time?' });
    await request(buildApp(al)).post(`/api/comments/announcement/${id}`).send({ body: 'Five, I think.' });

    expect(notifications.listFor(jo.id).map(n => n.title)).toEqual(['Al Other replied on "Fellowship meal"']);
  });

  test('an empty or enormous comment is refused', async () => {
    const jo = addAccount('Jo Member');
    const id = addAnnouncement();

    for (const body of ['', '   ', 'x'.repeat(2001)]) {
      const res = await request(buildApp(jo)).post(`/api/comments/announcement/${id}`).send({ body });
      expect(res.status).toBe(400);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_comments').get().n).toBe(0);
  });

  test('an event that is not there answers 404 rather than an empty thread', async () => {
    const res = await request(buildApp(addAccount('Jo Member'))).get('/api/comments/announcement/9999');
    expect(res.status).toBe(404);
  });

  test('a kind of subject the portal does not keep comments on is refused', async () => {
    const res = await request(buildApp(addAccount('Jo Member'))).get('/api/comments/users/1');
    expect(res.status).toBe(404);
  });
});

// ─── A group's meeting ────────────────────────────────────────────────────────

describe('comments on a group meeting', () => {
  let group;
  let leader;
  let member;
  let eventId;

  beforeEach(async () => {
    group = groups.createGroup({ name: 'North Harvest' }).group;

    const leaderPerson = addPerson('Lee Leader');
    const memberPerson = addPerson('Jo Member');
    groups.addMember(group.id, { directoryId: leaderPerson, role: 'leader' });
    groups.addMember(group.id, { directoryId: memberPerson, role: 'member' });
    leader = addAccount('Lee Leader', { directoryId: leaderPerson });
    member = addAccount('Jo Member',  { directoryId: memberPerson });

    const drafted = await request(buildApp(leader))
      .post(`/api/groups/${group.id}/events`)
      .send({ title: 'Fellowship meal', date: '2099-05-01' });
    eventId = drafted.body.event.id;
    await request(buildApp(leader)).post(`/api/groups/${group.id}/events/${eventId}/publish`);
  });

  test('somebody outside the group cannot read the thread or write in it', async () => {
    const outsider = addAccount('Al Outsider', { directoryId: addPerson('Al Outsider') });

    const read = await request(buildApp(outsider)).get(`/api/comments/group-event/${eventId}`);
    expect(read.status).toBe(403);

    const wrote = await request(buildApp(outsider))
      .post(`/api/comments/group-event/${eventId}`).send({ body: 'Can I come?' });
    expect(wrote.status).toBe(403);
  });

  test('the group\'s leaders hear a reply', async () => {
    await request(buildApp(member))
      .post(`/api/comments/group-event/${eventId}`).send({ body: 'We will be there.' });

    const told = notifications.listFor(leader.id).filter(n => n.kind === 'group-event-comment');
    expect(told).toHaveLength(1);
    expect(told[0].body).toBe('We will be there.');
  });

  test('everybody who answered the invitation hears it too', async () => {
    await request(buildApp(member))
      .post(`/api/groups/${group.id}/events/${eventId}/rsvp`).send({ response: 'yes' });

    const other = addAccount('Sam New', { directoryId: (() => {
      const id = addPerson('Sam New');
      groups.addMember(group.id, { directoryId: id, role: 'member' });
      return id;
    })() });

    await request(buildApp(other))
      .post(`/api/comments/group-event/${eventId}`).send({ body: 'Shall I bring chairs?' });

    expect(notifications.listFor(member.id).some(n => n.kind === 'group-event-comment')).toBe(true);
  });

  test('a draft is the leaders\' to talk about, as the meeting itself is', async () => {
    // The meeting route answers 404 for a member asking about a draft. The
    // thread under it has to agree, or the draft leaks through its comments.
    const drafted = await request(buildApp(leader))
      .post(`/api/groups/${group.id}/events`)
      .send({ title: 'Not settled yet', date: '2099-06-01' });
    const draftId = drafted.body.event.id;

    const read = await request(buildApp(member)).get(`/api/comments/group-event/${draftId}`);
    expect(read.status).toBe(403);

    const wrote = await request(buildApp(member))
      .post(`/api/comments/group-event/${draftId}`).send({ body: 'What is this?' });
    expect(wrote.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_comments').get().n).toBe(0);

    // Its leaders can still talk it over before they post it.
    const theirs = await request(buildApp(leader))
      .post(`/api/comments/group-event/${draftId}`).send({ body: 'Shall we say six?' });
    expect(theirs.status).toBe(200);
  });

  test('a cancelled meeting stops taking replies', async () => {
    await request(buildApp(leader)).post(`/api/groups/${group.id}/events/${eventId}/cancel`);
    const res = await request(buildApp(member))
      .post(`/api/comments/group-event/${eventId}`).send({ body: 'Shame!' });
    expect(res.status).toBe(403);
  });

  test('the count of replies comes back with the meeting', async () => {
    await request(buildApp(member)).post(`/api/comments/group-event/${eventId}`).send({ body: 'One' });
    await request(buildApp(leader)).post(`/api/comments/group-event/${eventId}`).send({ body: 'Two' });

    const res = await request(buildApp(member)).get(`/api/groups/${group.id}`);
    expect(res.body.events[0].comments).toBe(2);
  });
});

// ─── Editing and removing ─────────────────────────────────────────────────────

describe('editing and removing a comment', () => {
  test('you may edit your own words and nobody else\'s', async () => {
    const jo = addAccount('Jo Member');
    const al = addAccount('Al Other');
    const id = addAnnouncement();

    const posted = await request(buildApp(jo))
      .post(`/api/comments/announcement/${id}`).send({ body: 'What time?' });
    const commentId = posted.body.comments[0].id;

    const theirs = await request(buildApp(al))
      .put(`/api/comments/${commentId}`).send({ body: 'Something else entirely' });
    expect(theirs.status).toBe(403);

    const mine = await request(buildApp(jo))
      .put(`/api/comments/${commentId}`).send({ body: 'What time does it start?' });
    expect(mine.status).toBe(200);
    expect(mine.body.comments[0]).toMatchObject({ body: 'What time does it start?', edited: true });
  });

  test('a removed comment leaves a gap that says so, rather than vanishing', async () => {
    const jo = addAccount('Jo Member');
    const id = addAnnouncement();
    const posted = await request(buildApp(jo))
      .post(`/api/comments/announcement/${id}`).send({ body: 'Never mind' });

    const res = await request(buildApp(jo)).delete(`/api/comments/${posted.body.comments[0].id}`);
    expect(res.status).toBe(200);
    expect(res.body.comments).toHaveLength(1);
    expect(res.body.comments[0]).toMatchObject({ deleted: true, body: '' });
  });

  test('whoever looks after the board may take somebody else\'s down', async () => {
    const keeper = addAccount('Ed Keeper', { areas: ['announcements'] });
    const jo = addAccount('Jo Member');
    const id = addAnnouncement();
    const posted = await request(buildApp(jo))
      .post(`/api/comments/announcement/${id}`).send({ body: 'Something unkind' });

    const res = await request(buildApp(keeper)).delete(`/api/comments/${posted.body.comments[0].id}`);
    expect(res.status).toBe(200);
    expect(res.body.comments[0].deleted).toBe(true);
    // The removal is recorded because it was somebody else's comment; taking
    // your own down is not worth an entry.
    expect(db.prepare("SELECT COUNT(*) AS n FROM action_log WHERE entity = 'comment' AND action = 'delete'").get().n).toBe(1);
  });

  test('a group\'s leader may take one down in their own group only', async () => {
    const group = groups.createGroup({ name: 'North Harvest' }).group;
    const other = groups.createGroup({ name: 'Wall Triana' }).group;

    const leaderPerson = addPerson('Lee Leader');
    const memberPerson = addPerson('Jo Member');
    groups.addMember(group.id, { directoryId: leaderPerson, role: 'leader' });
    groups.addMember(group.id, { directoryId: memberPerson, role: 'member' });
    // Jo leads the other group, so there is a meeting there that Lee has no
    // part in — which is the whole point of the test.
    groups.addMember(other.id, { directoryId: memberPerson, role: 'leader' });
    const leader = addAccount('Lee Leader', { directoryId: leaderPerson });
    const member = addAccount('Jo Member',  { directoryId: memberPerson });

    async function meetingIn(g, by) {
      const drafted = await request(buildApp(by))
        .post(`/api/groups/${g.id}/events`).send({ title: 'Meal', date: '2099-05-01' });
      await request(buildApp(by)).post(`/api/groups/${g.id}/events/${drafted.body.event.id}/publish`);
      return drafted.body.event.id;
    }

    const mineId  = await meetingIn(group, leader);
    const theirId = await meetingIn(other, member);

    const inMine = await request(buildApp(member))
      .post(`/api/comments/group-event/${mineId}`).send({ body: 'Hello' });
    const inTheirs = await request(buildApp(member))
      .post(`/api/comments/group-event/${theirId}`).send({ body: 'Hello' });

    expect((await request(buildApp(leader)).delete(`/api/comments/${inMine.body.comments[0].id}`)).status).toBe(200);
    expect((await request(buildApp(leader)).delete(`/api/comments/${inTheirs.body.comments[0].id}`)).status).toBe(403);
  });
});

// ─── The bell ─────────────────────────────────────────────────────────────────

describe('notifications', () => {
  test('are only ever your own, and clearing them is too', async () => {
    const jo = addAccount('Jo Member');
    const al = addAccount('Al Other');
    const id = addAnnouncement();

    await request(buildApp(jo)).post(`/api/comments/announcement/${id}`).send({ body: 'One' });
    await request(buildApp(al)).post(`/api/comments/announcement/${id}`).send({ body: 'Two' });

    const mine = await request(buildApp(jo)).get('/api/notifications');
    expect(mine.body.notifications).toHaveLength(1);
    expect(mine.body.unread).toBe(1);

    // Al tries to mark Jo's as read by its id: it is not his, so nothing moves.
    const theirId = mine.body.notifications[0].id;
    const tried = await request(buildApp(al)).post('/api/notifications/read').send({ ids: [theirId] });
    expect(tried.body.marked).toBe(0);
    expect((await request(buildApp(jo)).get('/api/notifications/count')).body.unread).toBe(1);

    const cleared = await request(buildApp(jo)).post('/api/notifications/read').send({});
    expect(cleared.body.unread).toBe(0);
  });

  test('marking one read leaves the others alone', async () => {
    const jo = addAccount('Jo Member');
    notifications.notify({ users: [jo.id], kind: 'group-event-comment', title: 'First' });
    notifications.notify({ users: [jo.id], kind: 'group-event-comment', title: 'Second' });

    const listed = (await request(buildApp(jo)).get('/api/notifications')).body.notifications;
    const res = await request(buildApp(jo)).post('/api/notifications/read').send({ ids: [listed[0].id] });

    expect(res.body.marked).toBe(1);
    expect(res.body.unread).toBe(1);
  });

  test('only the unread ones, when that is what was asked for', async () => {
    const jo = addAccount('Jo Member');
    notifications.notify({ users: [jo.id], kind: 'group-event-comment', title: 'First' });
    notifications.markAllRead(jo.id);
    notifications.notify({ users: [jo.id], kind: 'group-event-comment', title: 'Second' });

    const res = await request(buildApp(jo)).get('/api/notifications?unread=1');
    expect(res.body.notifications.map(n => n.title)).toEqual(['Second']);
  });

  test('signing out means no bell at all', async () => {
    const res = await request(buildApp(null)).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});
