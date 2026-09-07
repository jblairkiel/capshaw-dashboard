require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const session  = require('express-session');
const passport = require('passport');

const { router: scraperRoutes, runUpdate, readData } = require('./routes/scraper');
const documentRoutes      = require('./routes/documents');
const bibleClassRoutes    = require('./routes/bibleClass');
const gameQuestionRoutes  = require('./routes/gameQuestions');
const lessonPlannerRoutes  = require('./routes/lessonPlanner');
const announcementRoutes   = require('./routes/announcements');
const authRoutes           = require('./routes/auth');
const songRoutes           = require('./routes/songTracker');
const profileRoutes = require('./routes/profile');
const workflowRoutes = require('./routes/workflows');
const mailRoutes = require('./routes/mailGroups');
const commentRoutes      = require('./routes/comments');
const notificationRoutes = require('./routes/notifications');
const adminRoutes          = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const isProd = process.env.NODE_ENV === 'production';

// Trust nginx reverse proxy so req.protocol, req.ip, and secure cookies work correctly
if (isProd) app.set('trust proxy', 1);

app.use(cors({
  origin: isProd
    ? ['https://capshaw.jblairkiel.com']
    : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
  credentials: true,
}));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', authRoutes);
app.use('/api/scraper', scraperRoutes);
app.use('/api/members', scraperRoutes);
app.use('/api/documents',    documentRoutes);
app.use('/api/bible-class',  bibleClassRoutes);
app.use('/api/game-questions',  gameQuestionRoutes);
app.use('/api/lesson-planner',  lessonPlannerRoutes);
app.use('/api/announcements',   announcementRoutes);
app.use('/api/songs',           songRoutes);
app.use('/api/admin',           adminRoutes);
app.use('/api/profile',         profileRoutes);
app.use('/api/workflows',       workflowRoutes);
app.use('/api/mail',            mailRoutes);
app.use('/api/comments',        commentRoutes);
app.use('/api/notifications',   notificationRoutes);

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
const MAIL_SWEEP_MS     = 5 * 60 * 1000;      // 5 minutes
// Digests are due on the hour a person picked, so checking every quarter of
// an hour is often enough to be punctual and rare enough to be cheap.
const DIGEST_SWEEP_MS   = 15 * 60 * 1000;     // 15 minutes

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

  // Anything people asked to have saved for a digest goes out here.
  const digest = require('./notifications/digest');
  setInterval(() => {
    digest.run().catch(err => console.error('[notifications] digest sweep failed:', err.message));
  }, DIGEST_SWEEP_MS);
});
