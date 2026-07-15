import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { pinoHttp } from 'pino-http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { logger, requestLogger } from './utils/logger.js';
import { authRouter } from './auth/routes.js';
import { apiRouter } from './routes/api.js';
import { subscriptionRouter } from './routes/subscriptions.js';
import { PrismaSessionStore } from './storage/sessionStore.js';

const app = express();
const isProduction = config.nodeEnv === 'production';
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const webDistPath = path.resolve(currentDir, '../web');
const webIndexPath = path.join(webDistPath, 'index.html');

function devOnly(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (config.nodeEnv === 'production') {
    res.status(404).json({ message: 'Not found.' });
    return;
  }
  next();
}

function applySecurityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  if (config.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
        "connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com https://www.google-analytics.com https://region1.google-analytics.com https://cdn.jsdelivr.net; " +
        "img-src 'self' data: https:; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.googletagmanager.com blob: https://cdn.jsdelivr.net; " +
        "worker-src 'self' blob: https://cdn.jsdelivr.net; " +
        "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; " +
        "frame-ancestors 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self' https://login.microsoftonline.com;"
    );
  }

  next();
}

const apiRequestBuckets = new Map<string, { count: number; resetAt: number }>();
function apiRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!req.path.startsWith('/api/')) return next();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = apiRequestBuckets.get(key);
  if (!current || current.resetAt <= now) {
    apiRequestBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  if (current.count >= 240) {
    res.status(429).json({ message: 'Too many requests. Please slow down and try again.' });
    return;
  }
  current.count += 1;
  next();
}

app.use(pinoHttp({ logger: requestLogger }));
app.use(applySecurityHeaders);
app.use(apiRateLimit);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (config.corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));

if (isProduction) {
  app.set('trust proxy', 1);
}

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new PrismaSessionStore(),
  cookie: {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000   // 24 hours
  }
}));

if (isProduction) {
  app.use(express.static(webDistPath));
}

app.get('/', (_req, res) => {
  if (isProduction && fs.existsSync(webIndexPath)) {
    res.sendFile(webIndexPath);
    return;
  }

  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Enrollment Flow Monitor</title>
</head>
<body style="font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;">
  <main style="max-width:760px;margin:64px auto;padding:24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;">
    <h1 style="margin:0 0 12px;">Enrollment Flow Monitor</h1>
    <p style="margin:0 0 16px;">Public preview is available. Sign in to access tenant data and remediation actions.</p>
    <p style="margin:0 0 20px;">
      <a href="/api/auth/login" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;">Sign in</a>
    </p>
    <p style="margin:0;font-size:13px;color:#475569;">Service health: <a href="/health">/health</a></p>
  </main>
</body>
</html>`);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, mockMode: config.mockMode, now: new Date().toISOString() });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'enrollment-api', version: process.env.npm_package_version || process.env.APP_VERSION || '1.0.0', mockMode: config.mockMode, now: new Date().toISOString() });
});

// ── Internal health — M2M auth via KERNEL_API_SECRET ──────────────────────────
app.get('/api/internal/health', (req, res) => {
  const expected = process.env.KERNEL_API_SECRET;
  if (!expected) return void res.status(503).json({ ok: false, error: 'Internal API not configured.' });
  const header = String(req.headers['authorization'] || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token !== expected) return void res.status(401).json({ ok: false, error: 'Unauthorized.' });
  res.json({ ok: true, service: 'enrollment-api', uptime: Math.floor(process.uptime()), mockMode: config.mockMode, timestamp: new Date().toISOString() });
});

app.get('/api/supervisor/status', async (req, res) => {
  const relayUrl   = process.env.CLOUD_RELAY_URL;
  const relayToken = process.env.KERNEL_API_SECRET;
  if (!relayUrl || !relayToken) return void res.json({ ok: false, error: 'Not configured', recentRuns: [], summary: {} });
  try {
    const r = await fetch(`${relayUrl}/api/supervisor/status`, { headers: { Authorization: `Bearer ${relayToken}` }, signal: AbortSignal.timeout(8000) });
    res.json(r.ok ? await r.json() : { ok: false, error: `Relay ${r.status}`, recentRuns: [], summary: {} });
  } catch (e: any) { res.json({ ok: false, error: e.message, recentRuns: [], summary: {} }); }
});

app.get('/api/diag', devOnly, (req, res) => {
  const requestHost = req.get('host') ?? '';
  const requestProtocol = req.get('x-forwarded-proto') ?? req.protocol;
  const requestOrigin = req.get('origin') ?? '';
  const callbackUrl = config.entra.redirectUri;
  const callbackHost = (() => {
    try {
      return new URL(callbackUrl).host;
    } catch {
      return '';
    }
  })();

  res.json({
    ok: true,
    now: new Date().toISOString(),
    nodeEnv: config.nodeEnv,
    app: {
      webAppUrl: config.webAppUrl,
      corsOrigins: config.corsOrigins
    },
    request: {
      host: requestHost,
      protocol: requestProtocol,
      origin: requestOrigin,
      secure: req.secure
    },
    auth: {
      redirectUri: callbackUrl,
      redirectHost: callbackHost,
      callbackHostMatchesRequestHost: Boolean(callbackHost && requestHost && callbackHost.toLowerCase() === requestHost.toLowerCase()),
      configured: Boolean(config.entra.tenantId && config.entra.clientId && config.entra.clientSecret),
      scopes: config.entra.scopes
    },
    sessionCookiePolicy: {
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction
    },
    runtime: {
      nodeVersion: process.version
    }
  });
});

app.use('/api/auth', authRouter);
app.use('/api', subscriptionRouter);

app.get('/api/debug/connection', devOnly, (req: any, res) => {
  const token = req.session?.accessToken;
  res.json({
    connected: Boolean(token),
    mockMode: config.mockMode,
    hasToken: Boolean(token),
    tokenExpired: token ? (() => {
      try {
        const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).exp;
        return exp ? Date.now() / 1000 > exp : null;
      } catch { return null; }
    })() : null,
    account: req.session?.account ? { username: req.session.account.username } : null,
    nodeEnv: config.nodeEnv,
    corsOrigins: config.corsOrigins,
  });
});

app.use('/api', apiRouter);

if (isProduction) {
  app.get('*', (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/api')) {
      next();
      return;
    }

    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled API error');
  if (err instanceof Error) {
    res.status(500).json({ message: err.message, ...(isProduction ? {} : { stack: err.stack }) });
  } else {
    res.status(500).json({ message: 'Unexpected server error' });
  }
});

async function bootstrap() {
  if (isProduction) {
    try {
      logger.info('Running Prisma migrations...');
      const { execSync } = await import('child_process');
      execSync('npx prisma migrate deploy --schema apps/api/prisma/schema.prisma', {
        stdio: 'inherit',
        cwd: '/home/site/wwwroot'
      });
      logger.info('Prisma migrations complete.');
    } catch (err) {
      logger.warn({ err }, 'Prisma migrate deploy failed — continuing (DB may already be up to date)');
    }
  }

  // Ensure tables exist regardless of migration state (idempotent)
  try {
    const { prisma: db } = await import('./storage/prisma.js');
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SignInEvent" (
        "id"                TEXT     NOT NULL PRIMARY KEY,
        "createdAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "eventType"         TEXT     NOT NULL DEFAULT 'login_success',
        "userPrincipalName" TEXT,
        "displayName"       TEXT,
        "tenantId"          TEXT,
        "ipAddress"         TEXT,
        "userAgent"         TEXT
      )
    `);
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Subscription" (
        "id"            TEXT     NOT NULL PRIMARY KEY,
        "email"         TEXT     NOT NULL,
        "gumroadSaleId" TEXT,
        "status"        TEXT     NOT NULL DEFAULT 'active',
        "subscribedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expiresAt"     DATETIME,
        "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_email_key" ON "Subscription"("email")`);
    await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_gumroadSaleId_key" ON "Subscription"("gumroadSaleId")`);
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Session" (
        "id"        TEXT     NOT NULL PRIMARY KEY,
        "data"      TEXT     NOT NULL DEFAULT '{}',
        "expiresAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt")`);
    logger.info('DB tables verified.');
  } catch (err) {
    logger.warn({ err }, 'DB table verification failed — continuing');
  }

  app.listen(config.port, () => {
    logger.info(`API listening on port ${config.port}`);
  });
}

bootstrap().catch((err) => { logger.error({ err }, 'Fatal startup error'); process.exit(1); });
