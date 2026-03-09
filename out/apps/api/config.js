import dotenv from 'dotenv';
dotenv.config();
const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
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
        scopes: (process.env.GRAPH_SCOPES ?? 'openid profile offline_access User.Read User.ReadBasic.All').split(' ').filter(Boolean)
    }
};
export function authConfigured() {
    return Boolean(config.entra.tenantId && config.entra.clientId && config.entra.clientSecret);
}
//# sourceMappingURL=config.js.map