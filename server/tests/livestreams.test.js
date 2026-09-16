jest.mock('https', () => require('./helpers/httpsMock').createHttpsMock());

const request   = require('supertest');
const express   = require('express');
const httpsMock = require('https');
const youtube   = require('../lib/youtube');
const router    = require('../routes/livestreams');

// The channel page is asked for the channel id once; from then on it is the
// public RSS feed, which is what these tests stand in for.
const CHANNEL_ID   = 'UCabcdefghijklmnopqrstuv';
const CHANNEL_PAGE = `<html><head><link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}"></head></html>`;

function entry({ id, title, published = '2025-04-13T15:00:00+00:00', views = '42' }) {
  return `
  <entry>
    <id>yt:video:${id}</id>
    <yt:videoId>${id}</yt:videoId>
    <title>${title}</title>
    <published>${published}</published>
    <media:group>
      <media:title>${title}</media:title>
      <media:thumbnail url="https://i.ytimg.com/vi/${id}/hqdefault.jpg" width="480" height="360"/>
      <media:description>A service at Capshaw.</media:description>
      <media:community>
        <media:statistics views="${views}"/>
      </media:community>
    </media:group>
  </entry>`;
}

function feed(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?><feed><title>Capshaw Church</title>${entries.join('')}</feed>`;
}

const FEED = feed([
  entry({ id: 'aaa', title: 'Sunday Morning Worship' }),
  entry({ id: 'bbb', title: 'Wednesday Bible Study', published: '2025-04-09T23:30:00+00:00', views: '7' }),
]);

function buildApp(user = { id: 1, role: 'approved' }) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/livestreams', router);
  return app;
}

function serve({ page = CHANNEL_PAGE, xml = FEED, feedStatus = 200 } = {}) {
  httpsMock.__route('GET', /^\/@/, () => ({ body: page }));
  httpsMock.__route('GET', /^\/feeds\/videos\.xml/, () => ({ status: feedStatus, body: xml }));
}

beforeEach(() => {
  httpsMock.__reset();
  youtube.resetCache();
});

// ─── Reading the channel ──────────────────────────────────────────────────────

describe('reading the channel', () => {
  test('finds the channel id from its handle, then reads that channel\'s feed', async () => {
    serve();
    const res = await request(buildApp()).get('/api/livestreams');

    expect(res.status).toBe(200);
    expect(res.body.videos).toHaveLength(2);
    expect(res.body.channel).toMatchObject({ handle: '@CapshawChurch', id: CHANNEL_ID });

    expect(httpsMock.__calls.map(c => c.path)).toEqual([
      '/@CapshawChurch',
      `/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
    ]);
  });

  test('gives each video what the page needs to show it', async () => {
    serve();
    const res = await request(buildApp()).get('/api/livestreams');

    expect(res.body.videos[0]).toEqual({
      id:          'aaa',
      title:       'Sunday Morning Worship',
      published:   '2025-04-13T15:00:00+00:00',
      url:         'https://www.youtube.com/watch?v=aaa',
      thumbnail:   'https://i.ytimg.com/vi/aaa/hqdefault.jpg',
      description: 'A service at Capshaw.',
      views:       42,
    });
  });

  test('keeps the channel\'s own order, newest first', async () => {
    serve();
    const res = await request(buildApp()).get('/api/livestreams');
    expect(res.body.videos.map(v => v.id)).toEqual(['aaa', 'bbb']);
  });

  test('reads a title back the way it was written', async () => {
    serve({ xml: feed([entry({ id: 'ccc', title: 'Ladies &amp; Gentlemen &#39;25' })]) });
    const res = await request(buildApp()).get('/api/livestreams');
    expect(res.body.videos[0].title).toBe("Ladies & Gentlemen '25");
  });

  test('a video with no view count is not reported as having none', async () => {
    serve({ xml: '<feed><entry><yt:videoId>ddd</yt:videoId><title>Untallied</title></entry></feed>' });
    const res = await request(buildApp()).get('/api/livestreams');
    expect(res.body.videos[0]).toMatchObject({ id: 'ddd', views: null, thumbnail: '' });
  });

  test('an entry with no video id is dropped rather than linking nowhere', async () => {
    serve({ xml: '<feed><entry><title>Nothing to play</title></entry></feed>' });
    const res = await request(buildApp()).get('/api/livestreams');
    expect(res.body.videos).toEqual([]);
  });

  test('honours a limit, and refuses a silly one', async () => {
    serve();
    expect((await request(buildApp()).get('/api/livestreams?limit=1')).body.videos).toHaveLength(1);
    expect((await request(buildApp()).get('/api/livestreams?limit=0')).body.videos).toHaveLength(2);
    expect((await request(buildApp()).get('/api/livestreams?limit=nope')).body.videos).toHaveLength(2);
  });
});

// ─── Caching ──────────────────────────────────────────────────────────────────

describe('caching', () => {
  test('a second visit costs YouTube nothing', async () => {
    serve();
    await request(buildApp()).get('/api/livestreams');
    await request(buildApp()).get('/api/livestreams');

    expect(httpsMock.__calls).toHaveLength(2);   // the channel page and one feed
  });

  test('a refresh reads the feed again, but not the channel page', async () => {
    serve();
    await request(buildApp()).get('/api/livestreams');
    await request(buildApp()).get('/api/livestreams?refresh=1');

    expect(httpsMock.__calls.map(c => c.path)).toEqual([
      '/@CapshawChurch',
      `/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
      `/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
    ]);
  });
});

// ─── When YouTube is not there ────────────────────────────────────────────────

describe('when YouTube cannot be reached', () => {
  test('a channel page with no id leaves the link, not an error', async () => {
    serve({ page: '<html>nothing useful here</html>' });
    const res = await request(buildApp()).get('/api/livestreams');

    expect(res.status).toBe(200);
    expect(res.body.videos).toEqual([]);
    expect(res.body.warning).toMatch(/channel id/i);
    expect(res.body.channel.url).toBe('https://www.youtube.com/@CapshawChurch');
  });

  test('a feed that errors is reported rather than cached as empty', async () => {
    serve({ feedStatus: 503, xml: '' });
    const first = await request(buildApp()).get('/api/livestreams');
    expect(first.body.warning).toMatch(/503/);

    // Nothing was cached, so the next visit tries again.
    serve();
    const second = await request(buildApp()).get('/api/livestreams');
    expect(second.body.videos).toHaveLength(2);
  });

  test('a connection that never lands is a warning, not a crash', async () => {
    httpsMock.__route('GET', /^\/@/, () => ({ error: new Error('socket hang up') }));
    const res = await request(buildApp()).get('/api/livestreams');

    expect(res.status).toBe(200);
    expect(res.body.warning).toBe('socket hang up');
  });
});

// ─── Access ───────────────────────────────────────────────────────────────────

describe('access', () => {
  test('the channel is for signed-in members, like the rest of the portal', async () => {
    serve();
    const res = await request(buildApp(null)).get('/api/livestreams');
    expect(res.status).toBe(401);
    expect(httpsMock.__calls).toHaveLength(0);
  });
});
