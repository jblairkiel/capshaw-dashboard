require('dotenv').config();

const { createApp } = require('./app');
const { runUpdate, readData } = require('./routes/scraper');

const PORT = process.env.PORT || 3001;

const app = createApp();

const SCRAPE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAIL_SWEEP_MS     = 5 * 60 * 1000;      // 5 minutes

const { validateDefinitions } = require('./workflows/definitions');
for (const problem of validateDefinitions()) console.error('[workflows] definition problem:', problem);

app.listen(PORT, () => {
  console.log(`Capshaw Dashboard API running on http://localhost:${PORT}`);

  // Run immediately on start if no data exists, then every 4 hours
  if (!readData()) {
    console.log('[scraper] No cached data — running initial scrape…');
    runUpdate().catch(err => console.error('[scraper] Initial scrape failed:', err.message));
  }

  setInterval(() => {
    console.log('[scraper] Scheduled 4-hour scrape starting…');
    runUpdate().catch(err => console.error('[scraper] Scheduled scrape failed:', err.message));
  }, SCRAPE_INTERVAL_MS);

  // Anything queued while the mail server was unreachable goes out here.
  const mailer = require('./mail/mailer');
  if (mailer.isRedirecting()) {
    console.log(`[mail] TEST MODE — all mail is redirected to ${mailer.config().redirectTo}`);
  }
  setInterval(() => {
    mailer.drainOutbox().catch(err => console.error('[mail] sweep failed:', err.message));
  }, MAIL_SWEEP_MS);
});
