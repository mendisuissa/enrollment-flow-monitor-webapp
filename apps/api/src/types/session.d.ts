import 'express-session';

declare module 'express-session' {
  interface SessionData {
    accessToken?: string;
    authRedirectUri?: string;
    authReturnUrl?: string;
    account?: {
      username?: string;
      tenantId?: string;
      name?: string;
    };
  }
}
