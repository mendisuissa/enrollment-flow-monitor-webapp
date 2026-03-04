import { Router } from 'express';
import { config } from '../config.js';
import { getMsalApp } from './msal.js';
export const authRouter = Router();
function getRequestOrigin(req) {
    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || req.get('host') || '';
    const protocol = forwardedProto || req.protocol;
    return `${protocol}://${host}`;
}
authRouter.get('/status', (req, res) => {
    if (!req.session.account || !req.session.accessToken) {
        return res.json({ connected: false, upn: '', tenantId: '', displayName: '' });
    }
    return res.json({
        connected: true,
        upn: req.session.account.username ?? '',
        tenantId: req.session.account.tenantId ?? '',
        displayName: req.session.account.name ?? ''
    });
});
authRouter.get('/login', async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Login setup failed.' });
    }
});
authRouter.get('/callback', async (req, res) => {
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
    }
    catch (error) {
        res.status(500).send(error instanceof Error ? error.message : 'Auth callback failed');
    }
});
authRouter.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ ok: true });
    });
});
//# sourceMappingURL=routes.js.map