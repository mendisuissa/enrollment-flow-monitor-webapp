Executive Reports + SLA ready files

Included files:
- packages/shared/src/index.ts
- apps/api/src/routes/api.ts
- apps/web/src/App.tsx
- apps/web/src/index.css

What changed:
- Added ExecutiveSummary and ExecutiveFailureCause types
- Extended ReportData with executiveSummary
- API now returns executive summary metrics:
  * openIncidents
  * resolvedIncidents
  * slaBreached
  * slaAtRisk
  * topFailureCauses
- Reports screen now shows Executive Snapshot cards and Top Failure Causes
- Fix Queue uses clearer SLA pill styling

Notes:
- I validated the shared/web edits structurally.
- Build in this environment stopped at apps/api due missing node type defs in the uploaded project environment ("Cannot find type definition file for 'node'"), which is an environment/dependency issue rather than from these report/SLA edits.