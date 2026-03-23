# Azure workflow hotfix

This hotfix prevents `/api/incidents/workflows` from returning HTTP 500 when the `IncidentWorkflow` table has not been created yet.

## What changed
- `apps/api/src/routes/api.ts`
  - `GET /api/incidents/workflows` now returns `{ rows: [] }` and logs a warning instead of failing with 500.

## Why
Azure App Service is currently serving the frontend successfully, but the workflow table is missing in the SQLite database. Returning an empty workflow list keeps the Fix Queue UI usable until the database schema is applied.

## Still required later
To enable real workflow persistence, you still need to create the table in production:

```bash
npx prisma db push --schema apps/api/prisma/schema.prisma
npm run prisma:generate -w @efm/api
```
