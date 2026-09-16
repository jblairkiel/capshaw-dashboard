// Recent videos from the church's YouTube channel.
//
// There is no API key involved: the channel page is asked for its channel id
// once, and from then on the public RSS feed YouTube publishes for every
// channel is all that is read. Both are cached, so a page view costs nothing
// and YouTube is only talked to a couple of times an hour.

require('dotenv').config();
const https = require('https');

const HANDLE   = (process.env.YOUTUBE_CHANNEL || '@CapshawChurch').replace(/^@?/, '@');
const FIXED_ID = process.env.YOUTUBE_CHANNEL_ID || '';

const CHANNEL_URL = `https://www.youtube.com/${HANDLE}`;
const FEED_TTL_MS = 30 * 60 * 1000;

// ─── Fetching ─────────────────────────────────────────────────────────────────

function get(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    https.get({
      hostname: u.hostname,
      path:     u.pathname + u.search,
      headers:  { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9', Connection: 'close' },
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({
        status:   res.statusCode,
        location: res.headers?.location,
        body:     Buffer.concat(chunks).toString('utf8'),
      }));
    }).on('error', reject);
  });
}

async function getFollowingRedirects(urlStr, max = 3) {
  let current = urlStr;
  for (let i = 0; i < max; i++) {
    const res = await get(current);
    if (!res.location || res.status < 300 || res.status >= 400) return res;
    current = res.location.startsWith('http') ? res.location : new URL(current).origin + res.location;
  }
  return get(current);
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function tag(entry, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(entry);
  return m ? decodeEntities(m[1].trim()) : '';
}

// The channel page carries its own id in a handful of places; any of them will
// do, and looking for several means a layout change has to break all of them
// before livestreams disappear.
function findChannelId(html) {
  const patterns = [
    /"(?:channelId|externalId|externalChannelId)":"(UC[\w-]{20,})"/,
    /<link[^>]+rel="canonical"[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{20,})"/,
    /channel\/(UC[\w-]{20,})/,
  ];
  for (const p of patterns) {
    const m = p.exec(html || '');
    if (m) return m[1];
  }
  return '';
}

function parseFeed(xml) {
  const entries = String(xml || '').split('<entry>').slice(1);

  return entries.map(entry => {
    const id        = tag(entry, 'yt:videoId');
    const thumbnail = /<media:thumbnail[^>]+url="([^"]+)"/.exec(entry)?.[1] || '';
    const views     = /<media:statistics[^>]+views="(\d+)"/.exec(entry)?.[1];

    return {
      id,
      title:       tag(entry, 'title'),
      published:   tag(entry, 'published'),
      url:         id ? `https://www.youtube.com/watch?v=${id}` : '',
      thumbnail:   thumbnail ? decodeEntities(thumbnail) : '',
      description: tag(entry, 'media:description').slice(0, 400),
      views:       views === undefined ? null : Number(views),
    };
  }).filter(v => v.id);
}

// ─── Cached reads ─────────────────────────────────────────────────────────────

let channelIdCache = FIXED_ID;
let feedCache      = null;   // { at, videos }

async function channelId() {
  if (channelIdCache) return channelIdCache;

  const res = await getFollowingRedirects(CHANNEL_URL);
  const id  = findChannelId(res.body);
  if (!id) throw new Error(`Could not find the channel id for ${HANDLE}`);

  channelIdCache = id;
  return id;
}

// Returns the recent uploads, newest first. `limit` is applied after the feed
// is cached, so changing it costs nothing.
async function recentVideos({ limit = 12, force = false } = {}) {
  if (!force && feedCache && Date.now() - feedCache.at < FEED_TTL_MS) {
    return { videos: feedCache.videos.slice(0, limit), cachedAt: new Date(feedCache.at).toISOString() };
  }

  const id  = await channelId();
  const res = await getFollowingRedirects(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
  if (res.status !== 200) throw new Error(`YouTube returned HTTP ${res.status} for the channel feed`);

  const videos = parseFeed(res.body);
  feedCache = { at: Date.now(), videos };
  return { videos: videos.slice(0, limit), cachedAt: new Date(feedCache.at).toISOString() };
}

function channel() {
  return { handle: HANDLE, url: CHANNEL_URL, id: channelIdCache || null };
}

// Tests and the admin refresh both need a way back to a cold start.
function resetCache() {
  channelIdCache = FIXED_ID;
  feedCache      = null;
}

module.exports = { recentVideos, channel, channelId, resetCache, findChannelId, parseFeed, HANDLE, CHANNEL_URL };
