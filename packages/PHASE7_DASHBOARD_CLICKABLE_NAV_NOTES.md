# Phase 7 — Dashboard Clickable Navigation

What changed:
- All main dashboard cards are now clickable.
- Recommended actions keep their click behavior.
- Top Root Causes empty state and rows are clickable.
- Command Metrics cards are clickable.
- Compliance Breakdown rows are clickable.

Recommended mapping:
- Health Score -> Reports
- Critical Issues -> Incidents / Fix Queue
- Readiness Risks -> Readiness Checklist
- Stale Devices -> Windows Enrollment
- KPI cards -> Windows Enrollment
- Compliance rows -> Windows Enrollment

After replacing files:
```powershell
npm install
npm run build
npm run dev
```
