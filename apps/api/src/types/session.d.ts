import 'express-session';

declare module 'express-session' {
  interface SessionData {
    accessToken?: string;          // read-only token (GRAPH_SCOPES_READ)
    writeAccessToken?: string;     // elevated token (GRAPH_SCOPES_WRITE) — required for device actions
    hasWritePermissions?: boolean; // derived from writeAccessToken presence
    authRedirectUri?: string;
    authReturnUrl?: string;
    authElevated?: boolean;        // flag: current login flow is elevated
    account?: {
      username?: string;
      tenantId?: string;
      name?: string;
    };
  }
}
