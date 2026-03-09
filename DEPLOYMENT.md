# Production Deployment Runbook (Azure App Service)

## Target Topology
- Deploy as a new Web App on the same App Service Plan used by your existing app.
- Recommended app name: `EnrollmentFlowMonitor-Wa`
- Runtime: Node 22 LTS (Linux and Windows plans are both supported)
- Linux startup command: `node out/apps/api/server.js`
- Windows startup: uses `package.json` `start` and root `web.config`

## New GitHub Repository
- Create a new repo (example): `enrollment-flow-monitor-webapp`
- Push this folder as the root project
- Configure GitHub OIDC secrets in the new repo:
  - `AZURE_CLIENT_ID`
  - `AZURE_TENANT_ID`
  - `AZURE_SUBSCRIPTION_ID`

## App Service Configuration
Set in App Service -> Environment variables -> App settings:

- `NODE_ENV=production`
- `SCM_DO_BUILD_DURING_DEPLOYMENT=false`
- `ENABLE_ORYX_BUILD=false`
- `WEBSITE_WARMUP_PATH=/health`
- `WEBSITES_CONTAINER_START_TIME_LIMIT=1800`
- `SESSION_SECRET=<long-random-secret>`
- `WEB_APP_URL=https://app.<your-domain>`
- `CORS_ORIGINS=https://app.<your-domain>`
- `ENTRA_REDIRECT_URI=https://api.<your-domain>/api/auth/callback`

Entra values (real tenant values required):
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`
- `ENTRA_TENANT_ID`
- `GRAPH_SCOPES`

## Domain + TLS
- Add `api.<your-domain>` and `app.<your-domain>` to the new App Service as needed.
- Bind TLS using SNI SSL with managed certificate.

## Entra App Registration
Authentication -> Web redirect URIs should include:
- `https://api.<your-domain>/api/auth/callback`
- `https://<your-app-name>.azurewebsites.net/api/auth/callback` (fallback)

API permissions must be granted and admin consented.

## CI/CD (GitHub Actions)
Workflow file:
- `.github/workflows/main_enrollmentflowmonitor-wa.yml`

Key behavior:
- Builds `@efm/shared`, `@efm/api`, and `@efm/web`
- Runs Prisma generate for API
- Uploads artifact with hidden files for Prisma runtime
- Deploys with `azure/webapps-deploy`

## Post-Deploy Validation
1. Confirm workflow and Deployment Center report success.
2. Validate `GET /health` returns JSON with `"ok": true`.
3. Validate `GET /` returns the web shell or sign-in landing page.
4. Validate auth via `/api/auth/login` and callback completion.
5. Validate browser calls from web origin pass CORS.

## Troubleshooting
- `503` at startup usually means startup command or app settings mismatch.
- Prisma runtime module errors usually mean deployment artifact missed generated files.
- DNS resolution errors indicate missing/incorrect DNS records.
