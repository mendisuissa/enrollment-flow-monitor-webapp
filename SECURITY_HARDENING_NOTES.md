# Enrollment Flow Monitor — Security hardening delta

This delta applies the main recommendations from the security review:

## Implemented
- Removed the generic Graph query API exposure
- Removed the Graph Query UI from the web app
- Enforced strong `SESSION_SECRET` in production (32+ chars, no dev fallback)
- Added production security headers
- Added simple API rate limiting
- Restricted diagnostics to development-only
- Removed token preview debug route from auth
- Added object-level validation for device actions
- Added tenant-bound validation for workflow writes
- Added payload validation for bulk device actions and workflow updates

## Files
- apps/api/src/config.ts
- apps/api/src/server.ts
- apps/api/src/auth/routes.ts
- apps/api/src/routes/api.ts
- apps/web/src/App.tsx

## Required production settings
Set a strong secret in Azure App Service:
- `SESSION_SECRET` = long random string (32+ chars)

## Notes
- The Graph Query drawer and `/api/graph/query` are intentionally removed.
- Existing fixed business endpoints remain.
- If you want stronger rate limiting or centralized audit logs next, that should be a follow-up phase.