# Enrollment Flow Monitor — Phase 2 Delta

This delta contains the next implementation step focused on:
- Command Center
- Fix Queue
- Guided Remediation surface
- Mobile breakpoint cleanup
- Root build script including web

## Files included
- `package.json`
- `packages/shared/src/index.ts`
- `apps/api/src/engines/incidents.ts`
- `apps/api/src/routes/api.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/index.css`

## What changed

### Command Center
- Dashboard renamed to **Command Center**
- Added dashboard fields:
  - `healthScore`
  - `activeCriticalIssues`
  - `activeIssues`
  - `readinessRisks`
  - `staleDevices`
  - `recommendedActions`
  - `topRootCauses`
- New hero score card + recommended actions + root causes UI

### Fix Queue
- Incidents renamed to **Fix Queue**
- Incident enrichment added:
  - `priority`
  - `nextBestAction`
  - `rootCauseConfidence`
  - `owner`
  - `status`
  - `slaState`
  - `likelyCause`
  - `remediationSteps`
  - `verificationSteps`
  - `details`
- Custom Fix Queue card layout in the frontend

### Guided Remediation
- Incident details now include remediation and verification guidance generated in the backend
- Selecting a Fix Queue card updates the right-side summary/details panel

### Mobile
- Mobile breakpoint moved from `1024px` to `768px`
- Added dedicated responsive styles for Command Center and Fix Queue

### Build
- Root build now includes `@efm/web`

## Local validation to run on your machine
```powershell
npm install
npm run prisma:generate -w @efm/api
npm run build
npm run dev
```

## Notes
Inside this container, TypeScript validation could not complete because the uploaded project snapshot is missing the local type definitions resolution for `node` and `vite/client` in this environment. On your machine, after `npm install` and `prisma generate`, validate the build normally.
