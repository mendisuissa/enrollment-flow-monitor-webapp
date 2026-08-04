import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

function resolveSessionSecret(): string {
  const provided = process.env.SESSION_SECRET?.trim();

  if (isProduction) {
    if (!provided || provided.length < 32 || provided === 'dev-session-secret') {
      throw new Error('SESSION_SECRET must be set to a strong value (32+ chars) in production.');
    }
    return provided;
  }

  return provided && provided.length >= 16 ? provided : 'dev-session-secret';
}

// ── Scope helpers ─────────────────────────────────────────
// GRAPH_SCOPES_READ  — initial login (read-only)
// GRAPH_SCOPES_WRITE — elevated login (write/privileged actions)
// GRAPH_SCOPES       — legacy fallback if new vars not set
const LEGACY_SCOPES = (process.env.GRAPH_SCOPES ?? 'openid profile offline_access User.Read DeviceManagementManagedDevices.Read.All').split(' ').filter(Boolean);

const READ_SCOPES  = process.env.GRAPH_SCOPES_READ
  ? process.env.GRAPH_SCOPES_READ.split(' ').filter(Boolean)
  : LEGACY_SCOPES;

const WRITE_SCOPES = process.env.GRAPH_SCOPES_WRITE
  ? process.env.GRAPH_SCOPES_WRITE.split(' ').filter(Boolean)
  : [
      ...READ_SCOPES,
      'DeviceManagementManagedDevices.PrivilegedOperations.All',
      'DeviceManagementManagedDevices.ReadWrite.All'
    ];

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv,
  mockMode: (process.env.MOCK_MODE ?? 'false').toLowerCase() === 'true',
  databaseUrl: process.env.DATABASE_URL ?? (isProduction ? 'file:/home/data/efm.db' : 'file:./prisma/dev.db'),
  logFile: process.env.LOG_FILE ?? (isProduction ? '/home/LogFiles/efm/app.log' : './logs/app.log'),
  sessionSecret: resolveSessionSecret(),
  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((item) => item.trim()).filter(Boolean),
  refreshIntervalSeconds: 60,
  incidentWindowMinutes: 120,
  incidentThresholdCount: 10,
  severityThresholds: {
    Low: 10,
    Medium: 25,
    High: 50
  },
  entra: {
    tenantId: process.env.ENTRA_TENANT_ID ?? '',
    clientId: process.env.ENTRA_CLIENT_ID ?? '',
    clientSecret: process.env.ENTRA_CLIENT_SECRET ?? '',
    redirectUri: process.env.ENTRA_REDIRECT_URI ?? 'http://localhost:4000/api/auth/callback',
    // Read-only scopes for initial login
    scopes: READ_SCOPES,
    // Write/privileged scopes for elevated login
    scopesWrite: WRITE_SCOPES
  },
  // Dedicated QA app registration used only by the automated QA bot to reach
  // /enroll without a real interactive Microsoft sign-in. The bot presents a
  // client-credentials token; /api/auth/qa-login accepts it only if it was
  // signed by this exact tenant AND issued to this exact app id (see
  // auth/qaAuth.ts) — a client-credentials token from any other app,
  // including a real user's own token, is rejected.
  qaLogin: {
    clientId: process.env.QA_ENROLLMENT_CLIENT_ID ?? '',
    tenantId: process.env.QA_ENROLLMENT_TENANT_ID || process.env.ENTRA_TENANT_ID || ''
  }
};

export function authConfigured(): boolean {
  return Boolean(config.entra.tenantId && config.entra.clientId && config.entra.clientSecret);
}
