import jwt, { type JwtHeader, type SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { config } from '../config.js';

/**
 * Validates the client-credentials token presented by the automated QA bot
 * (POST /api/auth/qa-login). This exists so the bot can exercise the
 * post-login /enroll UI without a real interactive Microsoft sign-in and
 * without any password/App Password ever touching the bot — see
 * routes.ts for the endpoint and why this approach was chosen over a
 * shared browser SSO session.
 *
 * Security model: the token must be signed by the configured tenant's real
 * signing keys (verified via Microsoft's JWKS, not just decoded) AND its
 * app identity (azp/appid) must match QA_ENROLLMENT_CLIENT_ID exactly.
 * A token from any other app — including a real user's own delegated
 * token — is rejected. There is no bypass if this env var is unset;
 * validateQaToken() throws instead of skipping the check.
 */

let _client: jwksClient.JwksClient | null = null;

function getJwksClient(): jwksClient.JwksClient {
  if (!_client) {
    _client = jwksClient({
      jwksUri: `https://login.microsoftonline.com/${config.qaLogin.tenantId}/discovery/v2.0/keys`,
      cache: true,
      cacheMaxAge: 12 * 60 * 60 * 1000,
      rateLimit: true,
    });
  }
  return _client;
}

function getSigningKey(header: JwtHeader, callback: SigningKeyCallback) {
  getJwksClient().getSigningKey(header.kid, (err, key) => {
    if (err || !key) return callback(err ?? new Error('No signing key found'));
    callback(null, key.getPublicKey());
  });
}

export interface QaTokenClaims {
  appid?: string;
  azp?: string;
  aud?: string;
  tid?: string;
  iss?: string;
}

export function validateQaToken(bearerToken: string): Promise<QaTokenClaims> {
  return new Promise((resolve, reject) => {
    if (!config.qaLogin.clientId || !config.qaLogin.tenantId) {
      reject(new Error('QA login not configured — set QA_ENROLLMENT_CLIENT_ID and QA_ENROLLMENT_TENANT_ID.'));
      return;
    }

    jwt.verify(
      bearerToken,
      getSigningKey,
      {
        algorithms: ['RS256'],
        issuer: [
          `https://login.microsoftonline.com/${config.qaLogin.tenantId}/v2.0`,
          `https://sts.windows.net/${config.qaLogin.tenantId}/`,
        ],
      },
      (err, decoded) => {
        if (err) {
          reject(err);
          return;
        }

        const claims = decoded as QaTokenClaims;
        const appId = claims.azp || claims.appid;

        if (appId !== config.qaLogin.clientId) {
          reject(new Error(`Token app id "${appId ?? 'unknown'}" is not the allowed QA app registration.`));
          return;
        }

        const expectedAudiences = [config.entra.clientId, `api://${config.entra.clientId}`];
        if (claims.aud && !expectedAudiences.includes(claims.aud)) {
          reject(new Error(`Token audience "${claims.aud}" does not match this app.`));
          return;
        }

        resolve(claims);
      }
    );
  });
}
