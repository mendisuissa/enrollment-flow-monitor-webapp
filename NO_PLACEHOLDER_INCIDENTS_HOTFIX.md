# Hotfix — Remove fake placeholder incident

This hotfix updates `apps/api/src/engines/incidents.ts`.

## What changed
When there are no active incidents, the API now returns:
```json
{"rows":[],"message":"No active incidents in current window."}
```

instead of returning a fake placeholder row with:
- P3
- Low
- 1970 timestamp
- signature none

## Replace
- `apps/api/src/engines/incidents.ts`

## After replacing
Run:
```powershell
npm run build
```

Then deploy the API again.
