import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

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
  mockMode: (process.env.MOCK_MODE ?? 'true').toLowerCase() === 'true',
  databaseUrl: process.env.DATABASE_URL ?? (isProduction ? 'file:/home/data/efm.db' : 'file:./prisma/dev.db'),
  logFile: process.env.LOG_FILE ?? (isProduction ? '/home/LogFiles/efm/app.log' : './logs/app.log'),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-session-secret',
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
  }
};

export function authConfigured(): boolean {
  return Boolean(config.entra.tenantId && config.entra.clientId && config.entra.clientSecret);
}
