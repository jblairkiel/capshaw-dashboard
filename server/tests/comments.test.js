jest.mock('../db', () => require('./helpers/memoryDb').createMemoryDb());

const request = require('supertest');
const express = require('express');
const db      = require('../db');
const router  = require('../routes/comments');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/comments', router);
  return app;
}

function addUser(name, role, email = null) {
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (provider, provider_id, email, name, role) VALUES (?,?,?,?,?)'
  ).run('google', `${name}-id`, email, name, role);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function addItem(type, title) {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO announcements (type, title) VALUES (?, ?)')
    .run(type, title);
  return id;
}

function notificationsFor(userId) {
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id').all(userId);
}

let RAY, JO, ADA, PAT, ANNOUNCEMENT, EVENT;

beforeEach(() => {
  for (const t of ['comments', 'comment_subscriptions', 'notifications', 'notification_preferences',
                   'mail_outbox', 'announcements', 'users']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }

  RAY = addUser('Ray Harris', 'approved', 'ray@example.com');
  JO  = addUser('Jo Harris',  'approved', 'jo@example.com');
  ADA = addUser('Ada Admin',  'admin',    'ada@example.com');
  PAT = addUser('Pat Nolan',  'pending',  'pat@example.com');

  ANNOUNCEMENT = addItem('announcement', 'Vacation Bible School');
  EVENT        = addItem('event',        'Men’s Breakfast');
});

// ─── Access ───────────────────────────────────────────────────────────────────

describe('access', () => {
  test('reading takes a sign-in', async () => {
    const res = await request(buildApp(null)).get(`/api/comments/announcement/${ANNOUNCEMENT}`);
    expect(res.status).toBe(401);
  });

  test('a pending account may read the conversation but not join it', async () => {
    const read = await request(buildApp(PAT)).get(`/api/comments/announcement/${ANNOUNCEMENT}`);
    expect(read.status).toBe(200);
    expect(read.body.canComment).toBe(false);

    const write = await request(buildApp(PAT))
      .post(`/api/comments/announcement/${ANNOUNCEMENT}`)
      .send({ body: 'Hello' });
    expect(write.status).toBe(403);
  });
});

// ─── Posting ──────────────────────────────────────────────────────────────────

describe('posting a comment', () => {
  test('a member can comment on an announcement and on an event', async () => {
    for (const [type, id] of [['announcement', ANNOUNCEMENT], ['event', EVENT]]) {
      const res = await request(buildApp(RAY)).post(`/api/comments/${type}/${id}`).send({ body: 'Count me in' });
      expect(res.status).toBe(200);
      expect(res.body.comment).toMatchObject({ body: 'Count me in', author: { name: 'Ray Harris' } });
    }

    const listed = await request(buildApp(JO)).get(`/api/comments/event/${EVENT}`);
    expect(listed.body.comments).toHaveLength(1);
    expect(listed.body.subject).toMatchObject({ id: EVENT, type: 'event' });
  });

  test('the subject type has to match the item, so an event id is not an announcement id', async () => {
    const res = await request(buildApp(RAY)).post(`/api/comments/announcement/${EVENT}`).send({ body: 'Hi' });
    expect(res.status).toBe(404);
  });

  test('an empty comment is refused', async () => {
    const res = await request(buildApp(RAY)).post(`/api/comments/announcement/${ANNOUNCEMENT}`).send({ body: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be empty/);
  });

  test('a very long comment is refused rather than truncated', async () => {
    const res = await request(buildApp(RAY))
      .post(`/api/comments/announcement/${ANNOUNCEMENT}`)
      .send({ body: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
  });

  test('commenting is what makes you follow the thread', async () => {
    await request(buildApp(RAY)).post(`/api/comments/announcement/${ANNOUNCEMENT}`).send({ body: 'First' });

    const res = await request(buildApp(RAY)).get(`/api/comments/announcement/${ANNOUNCEMENT}`);
    expect(res.body.subscription).toBe('on');
  });
});

// ─── Threading ────────────────────────────────────────────────────────────────

describe('replies', () => {
  test('a reply is attached to the comment it answers', async () => {
    const first = await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'What time?' });
    const reply = await request(buildApp(JO))
      .post(`/api/comments/event/${EVENT}`)
      .send({ body: 'Eight', parentId: first.body.comment.id });

    expect(reply.body.comment.parentId).toBe(first.body.comment.id);
  });

  test('a reply to a reply joins the same branch rather than nesting deeper', async () => {
    const first = await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'What time?' });
    const reply = await request(buildApp(JO))
      .post(`/api/comments/event/${EVENT}`)
      .send({ body: 'Eight', parentId: first.body.comment.id });
    const third = await request(buildApp(ADA))
      .post(`/api/comments/event/${EVENT}`)
      .send({ body: 'Thanks', parentId: reply.body.comment.id });

    expect(third.body.comment.parentId).toBe(first.body.comment.id);
  });

  test('a parent on a different item is refused', async () => {
    const elsewhere = await request(buildApp(RAY))
      .post(`/api/comments/announcement/${ANNOUNCEMENT}`).send({ body: 'Over here' });

    const res = await request(buildApp(JO))
      .post(`/api/comments/event/${EVENT}`)
      .send({ body: 'Wrong thread', parentId: elsewhere.body.comment.id });

    expect(res.status).toBe(400);
  });
});

// ─── Editing and removing ─────────────────────────────────────────────────────

describe('editing and removing', () => {
  test('an author may fix their own wording, and it is marked as edited', async () => {
    const posted = await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'Ate' });
    const edited = await request(buildApp(RAY)).patch(`/api/comments/${posted.body.comment.id}`).send({ body: 'Eight' });

    expect(edited.body.comment.body).toBe('Eight');
    expect(edited.body.comment.editedAt).toBeTruthy();
  });

  test('nobody may edit somebody else’s comment, admins included', async () => {
    const posted = await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'Mine' });

    for (const user of [JO, ADA]) {
      const res = await request(buildApp(user)).patch(`/api/comments/${posted.body.comment.id}`).send({ body: 'Yours' });
      expect(res.status).toBe(403);
    }
  });

  test('an admin may take any comment down, and a reply under it still reads', async () => {
    const first = await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'Unkind' });
    await request(buildApp(JO))
      .post(`/api/comments/event/${EVENT}`)
      .send({ body: 'Steady on', parentId: first.body.comment.id });

    const removed = await request(buildApp(ADA)).delete(`/api/comments/${first.body.comment.id}`);
    expect(removed.status).toBe(200);

    const listed = await request(buildApp(JO)).get(`/api/comments/event/${EVENT}`);
    expect(listed.body.comments).toHaveLength(2);
    expect(listed.body.comments[0]).toMatchObject({ deleted: true, body: '' });
    expect(listed.body.comments[1].body).toBe('Steady on');
  });

  test('a member may not delete somebody else’s comment', async () => {
    const posted = await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'Mine' });
    const res = await request(buildApp(JO)).delete(`/api/comments/${posted.body.comment.id}`);
    expect(res.status).toBe(403);
  });
});

// ─── Counts ───────────────────────────────────────────────────────────────────

describe('counts', () => {
  test('one request answers for a whole list of items, and skips deleted comments', async () => {
    const second = addItem('announcement', 'Work day');
    await request(buildApp(RAY)).post(`/api/comments/announcement/${ANNOUNCEMENT}`).send({ body: 'One' });
    const doomed = await request(buildApp(JO)).post(`/api/comments/announcement/${ANNOUNCEMENT}`).send({ body: 'Two' });
    await request(buildApp(RAY)).post(`/api/comments/announcement/${second}`).send({ body: 'Elsewhere' });
    await request(buildApp(ADA)).delete(`/api/comments/${doomed.body.comment.id}`);

    const res = await request(buildApp(RAY))
      .get('/api/comments/announcement/counts')
      .query({ ids: `${ANNOUNCEMENT},${second}` });

    expect(res.body.counts).toEqual({ [ANNOUNCEMENT]: 1, [second]: 1 });
  });
});

// ─── Following a thread ───────────────────────────────────────────────────────

describe('following and muting', () => {
  test('a thread can be muted and followed again', async () => {
    const muted = await request(buildApp(JO))
      .put(`/api/comments/event/${EVENT}/subscription`).send({ state: 'off' });
    expect(muted.body.subscription).toBe('off');

    const back = await request(buildApp(JO))
      .put(`/api/comments/event/${EVENT}/subscription`).send({ state: 'on' });
    expect(back.body.subscription).toBe('on');
  });

  test('commenting does not un-mute a thread somebody deliberately silenced', async () => {
    await request(buildApp(JO)).put(`/api/comments/event/${EVENT}/subscription`).send({ state: 'off' });
    await request(buildApp(JO)).post(`/api/comments/event/${EVENT}`).send({ body: 'One last thing' });

    const res = await request(buildApp(JO)).get(`/api/comments/event/${EVENT}`);
    expect(res.body.subscription).toBe('off');
  });

  test('a state that is neither on nor off is refused', async () => {
    const res = await request(buildApp(JO))
      .put(`/api/comments/event/${EVENT}/subscription`).send({ state: 'maybe' });
    expect(res.status).toBe(400);
  });
});

// ─── What a comment tells people ──────────────────────────────────────────────

describe('the notifications a comment raises', () => {
  test('a reply tells the person replied to, by the reply type', async () => {
    const first = await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'What time?' });
    await request(buildApp(JO))
      .post(`/api/comments/event/${EVENT}`)
      .send({ body: 'Eight', parentId: first.body.comment.id });

    const [notification] = notificationsFor(RAY.id);
    expect(notification).toMatchObject({
      type: 'comment.reply',
      category: 'comments',
      subject_type: 'event',
      subject_id: EVENT,
      actor_name: 'Jo Harris',
    });
    expect(notification.title).toContain('Jo Harris replied');
  });

  test('naming somebody tells them, even though they were not following', async () => {
    await request(buildApp(RAY))
      .post(`/api/comments/event/${EVENT}`)
      .send({ body: '@Jo Harris could you bring the eggs?' });

    expect(notificationsFor(JO.id).map(n => n.type)).toEqual(['comment.mention']);
  });

  test('everyone else following the thread hears about it once', async () => {
    await request(buildApp(JO)).post(`/api/comments/event/${EVENT}`).send({ body: 'I will be there' });
    db.prepare('DELETE FROM notifications').run();

    await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'Me too' });

    expect(notificationsFor(JO.id).map(n => n.type)).toEqual(['comment.posted']);
  });

  test('admins hear about a comment without having to follow the thread', async () => {
    await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'First' });
    expect(notificationsFor(ADA.id).map(n => n.type)).toEqual(['comment.posted']);
  });

  test('nobody is told about their own comment', async () => {
    await request(buildApp(ADA)).post(`/api/comments/event/${EVENT}`).send({ body: 'Posting this myself' });
    expect(notificationsFor(ADA.id)).toEqual([]);
  });

  test('somebody who muted the thread is not told, however directly it concerns them', async () => {
    const first = await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'What time?' });
    await request(buildApp(RAY)).put(`/api/comments/event/${EVENT}/subscription`).send({ state: 'off' });

    await request(buildApp(JO))
      .post(`/api/comments/event/${EVENT}`)
      .send({ body: '@Ray Harris it is eight', parentId: first.body.comment.id });

    expect(notificationsFor(RAY.id)).toEqual([]);
  });

  test('the person replied to is told once, not again as a follower', async () => {
    const first = await request(buildApp(RAY)).post(`/api/comments/event/${EVENT}`).send({ body: 'What time?' });
    db.prepare('DELETE FROM notifications').run();

    await request(buildApp(JO))
      .post(`/api/comments/event/${EVENT}`)
      .send({ body: '@Ray Harris eight', parentId: first.body.comment.id });

    expect(notificationsFor(RAY.id)).toHaveLength(1);
  });
});
