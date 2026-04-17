require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { router: scraperRoutes, runUpdate, readData } = require('./routes/scraper');
const documentRoutes = require('./routes/documents');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const isProd = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: isProd
    ? ['https://capshaw.jblairkiel.com']
    : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
}));
app.use(express.json());

app.use('/api/scraper', scraperRoutes);
app.use('/api/members', scraperRoutes);
app.use('/api/documents', documentRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve React build in production
if (isProd) {
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const SCRAPE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

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
});
