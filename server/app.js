// Builds the Express app: every piece of request handling lives here, with
// nothing that calls .listen() or touches the process lifecycle. That split
// is what lets a test spin the whole thing up with supertest instead of only
// being able to exercise one router in isolation.
const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const path     = require('path');
const session  = require('express-session');
const passport = require('passport');

const { router: scraperRoutes }  = require('./routes/scraper');
const documentRoutes             = require('./routes/documents');
const bibleClassRoutes           = require('./routes/bibleClass');
const gameQuestionRoutes         = require('./routes/gameQuestions');
const lessonPlannerRoutes        = require('./routes/lessonPlanner');
const announcementRoutes         = require('./routes/announcements');
const authRoutes                 = require('./routes/auth');
const songRoutes                 = require('./routes/songTracker');
const profileRoutes              = require('./routes/profile');
const workflowRoutes             = require('./routes/workflows');
const mailRoutes                 = require('./routes/mailGroups');
const livestreamRoutes           = require('./routes/livestreams');
const adminRoutes                = require('./routes/admin');
const recordRoutes               = require('./routes/records');
const servingRoutes              = require('./routes/serving');
const visitorRoutes              = require('./routes/visitors');
const leadershipRoutes           = require('./routes/leadership');
const bulletinRoutes             = require('./routes/bulletin');
const groupRoutes                = require('./routes/groups');
const commentRoutes              = require('./routes/comments');
const notificationRoutes         = require('./routes/notifications');
const bugReportRoutes            = require('./routes/bugReports');
const memberMatchRoutes          = require('./routes/memberMatch');
const paths                      = require('./lib/paths');
const { requireSiteAuth }        = require('./middleware/auth');
const { applyImpersonation }     = require('./middleware/impersonation');
const { requireTrustedOrigin }   = require('./middleware/csrf');
const rateLimit                  = require('express-rate-limit');

function createApp() {
  const isProd = process.env.NODE_ENV === 'production';

  // A session cookie signed with a secret anyone can read in the source
  // history is no better than no signature at all — refuse to boot into
  // production with the fallback rather than serve real sessions under it.
  const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
  if (isProd && !process.env.SESSION_SECRET) {
    throw new Error(
      'SESSION_SECRET is not set. Refusing to start in production with the ' +
      'well-known development fallback secret — set SESSION_SECRET in the ' +
      'environment before deploying.'
    );
  }

  const app = express();

  // Every directory this installation writes to, made if it is not there yet:
  // a fresh volume should not need anybody to mkdir before the app will start.
  paths.ensure();

  // Trust nginx reverse proxy so req.protocol, req.ip, and secure cookies work correctly
  if (isProd) app.set('trust proxy', 1);

  // Standard hardening headers (CSP, X-Content-Type-Options, no X-Powered-By,
  // etc). The app has no cross-origin scripts, fonts, or images to allow, so
  // helmet's own defaults — same-origin everything — already fit; only the
  // cross-origin embedder policy is switched off, since this app never needs
  // it and it has caused unrelated grief loading third-party OAuth redirects
  // in other apps.
  app.use(helmet({ crossOriginEmbedderPolicy: false }));

  const allowedOrigins = isProd
    ? ['https://capshaw.jblairkiel.com']
    : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];

  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json());

  app.use(session({
    secret: sessionSecret,
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

  // A ceiling on the whole authenticated surface, well above real usage —
  // the per-endpoint limits in routes/auth.js exist to slow down password
  // guessing specifically; this one just caps a flood before it does any
  // real work.
  const apiRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please wait a few minutes and try again.' },
  });

  // Nothing under /api is readable until you have signed in — only the sign-in
  // flow itself and the health check stay open. requireTrustedOrigin runs
  // first so a cross-site page riding the visitor's session cookie is
  // rejected before it ever reaches a route that trusts that session.
  //
  // applyImpersonation comes last in the chain, and only here: an admin viewing
  // the portal as a member has their own account in the session, and every API
  // request below this line is answered as the member instead. It reads the
  // borrowed account from the database, so it sits behind the rate limit rather
  // than above it — and under /api rather than on every request, since a static
  // asset has no use for it.
  app.use('/api', apiRateLimit, requireTrustedOrigin(allowedOrigins), requireSiteAuth, applyImpersonation);

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
  app.use('/api/livestreams',     livestreamRoutes);
  app.use('/api/records',         recordRoutes);
  app.use('/api/serving',         servingRoutes);
  app.use('/api/visitors',        visitorRoutes);
  app.use('/api/leadership',      leadershipRoutes);
  app.use('/api/bulletin',        bulletinRoutes);
  app.use('/api/groups',          groupRoutes);
  app.use('/api/comments',        commentRoutes);
  app.use('/api/notifications',   notificationRoutes);
  app.use('/api/bug-reports',     bugReportRoutes);
  app.use('/api/member-match',    memberMatchRoutes);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve React build in production
  if (isProd) {
    const clientDist = path.join(__dirname, '../client/dist');
    // A single page load pulls in a dozen-plus asset requests, so this
    // ceiling sits far above the API's — it's still a cap on a flood of
    // disk reads, not a limit a real visitor could ever hit.
    const staticRateLimit = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 3000,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: 'Too many requests. Please wait a few minutes and try again.' },
    });
    app.use(staticRateLimit, express.static(clientDist));
    app.get('*', staticRateLimit, (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}

module.exports = { createApp };
