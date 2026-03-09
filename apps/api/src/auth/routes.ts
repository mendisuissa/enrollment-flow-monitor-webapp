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

authRouter.get('/status', (req: any, res) => {
  if (!req.session?.account || !req.session?.accessToken) {
    return res.json({ connected: false, upn: '', tenantId: '', displayName: '' });
  }

  return res.json({
    connected: true,
    upn: req.session.account.username ?? '',
    tenantId: req.session.account.tenantId ?? '',
    displayName: req.session.account.name ?? ''
  });
});

/**
 * NEW: /api/auth/me
 * Use this to verify session state quickly from browser.
 */
authRouter.get('/me', (req: any, res) => {
  if (!req.session?.account) {
    return res.status(401).json({ connected: false });
  }

  return res.json({
    connected: true,
    account: req.session.account ?? null
  });
});

/**
 * NEW: /api/auth/debug/token
 * Decodes JWT payload and returns scopes/roles for troubleshooting.
 * IMPORTANT: disable this endpoint in production if you don't want it exposed.
 */
authRouter.get('/debug/token', (req: any, res) => {
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
      tokenPreview: accessToken.substring(0, 40) + '...'
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
    tokenPreview: accessToken.substring(0, 40) + '...',
    // Delegated scopes usually appear as scp. App permissions appear as roles.
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
    const redirectUri = `${origin}/api/auth/callback`;

    req.session.authRedirectUri = redirectUri;
    req.session.authReturnUrl = origin;

    const msal = getMsalApp();
    const authCodeUrl = await msal.getAuthCodeUrl({
      scopes: config.entra.scopes,
      redirectUri
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

    const msal = getMsalApp();
    const tokenResponse = await msal.acquireTokenByCode({
      code,
      scopes: config.entra.scopes,
      redirectUri
    });

    req.session.accessToken = tokenResponse?.accessToken;
    req.session.account = {
      username: tokenResponse?.account?.username,
      tenantId: tokenResponse?.tenantId,
      name: tokenResponse?.account?.name
    };

    const returnUrl = req.session.authReturnUrl ?? config.webAppUrl;

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
