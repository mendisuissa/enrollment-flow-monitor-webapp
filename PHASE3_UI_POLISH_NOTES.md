# Enrollment Flow Monitor — Phase 3 UI Polish Delta

## Included
- Narrower right rail / details panel
- Stronger Command Center hierarchy
- Bigger hero score card with status badge
- Cleaner KPI cards with softer borders
- Recommended Actions redesigned as actionable cards
- Better empty state for Top Root Causes
- Improved spacing, typography, and mobile stacking

## Replace
- `apps/web/src/App.tsx`
- `apps/web/src/index.css`

## After replacing
```powershell
npm install
npm run prisma:generate -w @efm/api
npm run build
npm run dev
```

## Next recommendation batch
After this UI pass, the next release step should be:
1. QA/final hardening
2. Empty states across all views
3. Fix Queue workflow persistence (owner/status/notes)
4. Executive report polish
