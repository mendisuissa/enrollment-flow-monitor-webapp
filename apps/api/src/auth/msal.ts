import { ConfidentialClientApplication } from '@azure/msal-node';
import { authConfigured, config } from '../config.js';

let app: ConfidentialClientApplication | null = null;

export function getMsalApp(): ConfidentialClientApplication {
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
