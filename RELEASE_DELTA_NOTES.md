# Enrollment Flow Monitor — Release Delta Notes

## Included in this delta
- Root build now includes the web workspace
- Command Center / Fix Queue / Executive Reports / Readiness Risks naming polish
- Dashboard payload enriched with Health Score, critical/open issues, readiness risks, stale devices, recommended actions, and top root causes
- Incident payload enriched with priority, next best action, confidence, owner, status, and SLA state
- Mobile breakpoint tightened from 1024px to 768px
- Mobile UI overrides for denser but cleaner release behavior

## Suggested QA smoke test
1. Run `npm install`
2. Run `npm run prisma:generate -w @efm/api`
3. Run `npm run build`
4. Validate Command Center data loads
5. Validate Fix Queue rows still render and selection updates the details panel
6. Validate mobile width at 768px and below
7. Validate Executive Reports export
8. Validate write-action permission gating
