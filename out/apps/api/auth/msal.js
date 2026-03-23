import { ConfidentialClientApplication } from '@azure/msal-node';
import { authConfigured, config } from '../config.js';
let app = null;
export function getMsalApp() {
    if (!authConfigured()) {
        throw new Error('Entra auth is not configured. Set ENTRA_* variables.');
    }
    if (!app) {
        app = new ConfidentialClientApplication({
            auth: {
                clientId: config.entra.clientId,
                authority: `https://login.microsoftonline.com/${config.entra.tenantId}`,
                clientSecret: config.entra.clientSecret
            }
        });
    }
    return app;
}
//# sourceMappingURL=msal.js.map