import { Router, type Request } from 'express';
import { config } from '../config.js';
import { getMsalApp } from './msal.js';

export const authRouter = Router();

function getRequestOrigin(req: Request): string {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host') || '';
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${host}`;
}

function decodeTokenScopes(token: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    const scp: string = payload?.scp ?? '';
    const roles: string[] = payload?.roles ?? [];
    return [...scp.split(' ').filter(Boolean), ...roles];
  } catch {
    return [];
  }
}

function devOnly(_req: Request, res: any, next: any): void {
  if (config.nodeEnv === 'production') {
    res.status(404).json({ message: 'Not found.' });
    return;
  }
  next();
}

authRouter.get('/status', (req: any, res) => {
  if (!req.session?.account || !req.session?.accessToken) {
    return res.json({ connected: false, upn: '', tenantId: '', displayName: '', hasWritePermissions: false });
  }

  const scopes = decodeTokenScopes(req.session.accessToken);
  const writeScopes = [
    'DeviceManagementManagedDevices.PrivilegedOperations.All',
    'DeviceManagementManagedDevices.ReadWrite.All'
  ];
  const hasWritePermissions = writeScopes.some((s) => scopes.includes(s)) || req.session?.hasWritePermissions === true;

  return res.json({
    connected: true,
    upn: req.session.account.username ?? '',
    tenantId: req.session.account.tenantId ?? '',
    displayName: req.session.account.name ?? '',
    hasWritePermissions
  });
});

authRouter.get('/me', (req: any, res) => {
  if (!req.session?.account) {
    return res.status(401).json({ connected: false });
  }

  return res.json({
    connected: true,
    account: req.session.account ?? null
  });
});

authRouter.get('/debug/token', devOnly, (req: any, res) => {
  const accessToken: string | undefined = req.session?.accessToken;

  if (!accessToken) {
    return res.status(401).json({
      connected: false,
      message: 'No access token in session'
    });
  }

  const parts = accessToken.split('.');
  if (parts.length < 2) {
    return res.status(400).json({
      connected: true,
      message: 'Token does not look like a JWT',
      tokenPreview: `${accessToken.substring(0, 40)}...`
    });
  }

  let payload: any = null;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  } catch {
    payload = 'Unable to decode token payload';
  }

  return res.json({
    connected: true,
    user: req.session?.account ?? null,
    tokenPreview: `${accessToken.substring(0, 40)}...`,
    scopes: payload?.scp ?? null,
    roles: payload?.roles ?? null,
    tenantId: payload?.tid ?? null,
    audience: payload?.aud ?? null,
    expires: payload?.exp ?? null,
    issuedAt: payload?.iat ?? null
  });
});

authRouter.get('/login', async (req: any, res) => {
  try {
    const origin = getRequestOrigin(req);

    const redirectUri = config.entra.redirectUri !== 'http://localhost:4000/api/auth/callback'
      ? config.entra.redirectUri
      : `${origin}/api/auth/callback`;

    const elevated = req.query.elevated === 'true';

    req.session.authRedirectUri = redirectUri;
    req.session.authReturnUrl = config.webAppUrl !== 'http://localhost:5173'
      ? config.webAppUrl
      : origin;

    req.session.authElevated = elevated;

    const msal = getMsalApp();
    const scopes = elevated ? config.entra.scopesWrite : config.entra.scopes;

    const authCodeUrl = await msal.getAuthCodeUrl({
      scopes,
      redirectUri,
      prompt: elevated ? 'consent' : undefined
    });

    res.redirect(authCodeUrl);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Login setup failed.' });
  }
});

authRouter.get('/callback', async (req: any, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    return res.status(400).send('Missing auth code.');
  }

  try {
    const redirectUri = req.session.authRedirectUri ?? config.entra.redirectUri;
    const returnUrl = req.session.authReturnUrl ?? config.webAppUrl;
    const isElevated = req.session.authElevated === true;

    const msal = getMsalApp();
    const scopes = isElevated ? config.entra.scopesWrite : config.entra.scopes;

    const tokenResponse = await msal.acquireTokenByCode({ code, scopes, redirectUri });

    if (isElevated) {
      req.session.writeAccessToken = tokenResponse?.accessToken;
      req.session.hasWritePermissions = true;
      req.session.account = {
        username: tokenResponse?.account?.username ?? req.session.account?.username,
        tenantId: tokenResponse?.tenantId ?? req.session.account?.tenantId,
        name: tokenResponse?.account?.name ?? req.session.account?.name
      };
    } else {
      req.session.accessToken = tokenResponse?.accessToken;
      req.session.account = {
        username: tokenResponse?.account?.username,
        tenantId: tokenResponse?.tenantId,
        name: tokenResponse?.account?.name
      };
    }

    req.session.authElevated = undefined;
    req.session.authRedirectUri = undefined;
    req.session.authReturnUrl = undefined;

    res.redirect(returnUrl);
  } catch (error) {
    res.status(500).send(error instanceof Error ? error.message : 'Auth callback failed');
  }
});

authRouter.post('/logout', (req: any, res) => {
  req.session?.destroy(() => {
    res.json({ ok: true });
  });
});
