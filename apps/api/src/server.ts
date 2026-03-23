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
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://login.microsoftonline.com;");
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
// IMPORTANT:
// Do NOT throw on unknown origins.
// Throwing here causes 500 responses which breaks loading same-origin static assets
// (scripts/styles) on Azure App Service when Origin is present.
// For non-allowed origins we simply disable CORS headers (browser will block XHR/fetch).
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, health probes, etc.)
    if (!origin) return callback(null, true);

    // Explicit allow-list
    if (config.corsOrigins.includes(origin)) return callback(null, true);

    // Not allowed: don't set CORS headers, but don't fail the request.
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
  cookie: {
    httpOnly: true,
    // 'none' required in production when frontend/backend share the same origin via
    // Azure custom domain but the OAuth redirect goes through azurewebsites.net first.
    // 'lax' breaks the session cookie on the redirect back from Entra.
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction
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

// Public diagnostic — no auth required, safe metadata only
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

  app.listen(config.port, () => {
    logger.info(`API listening on port ${config.port}`);
  });
}

bootstrap();
