# Phase 6 — Incident Workflow Persistence

What this delta adds:
- Persisted workflow for incidents: owner, status, notes, updatedAt
- Prisma model: `IncidentWorkflow`
- API endpoints:
  - `GET /api/incidents/workflows`
  - `POST /api/incidents/:signature/workflow`
- Incidents view now merges saved workflow data back into incident rows
- Right panel in the Incidents screen now includes a workflow editor

## Important after replacing files
Because Prisma schema changed, run:

```powershell
npm install
npx prisma db push --schema apps/api/prisma/schema.prisma
npm run prisma:generate -w @efm/api
npm run build
npm run dev
```

## Scope
This phase intentionally does **not** change the homepage.
It only adds workflow persistence to the incidents experience.
