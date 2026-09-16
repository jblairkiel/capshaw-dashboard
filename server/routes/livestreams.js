const express = require('express');
const router  = express.Router();
const youtube = require('../lib/youtube');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// ─── GET /api/livestreams ─────────────────────────────────────────────────────
// Recent uploads from the church's YouTube channel. A failure here is never an
// error page: the channel link is always worth showing, so the reason comes
// back alongside an empty list and the page degrades to "watch on YouTube".

router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
  const force = req.query.refresh === '1';

  try {
    const { videos, cachedAt } = await youtube.recentVideos({ limit, force });
    res.json({ success: true, channel: youtube.channel(), videos, cachedAt });
  } catch (err) {
    console.error('[livestreams] could not read the channel feed:', err.message);
    res.json({ success: true, channel: youtube.channel(), videos: [], warning: err.message });
  }
});

module.exports = router;
