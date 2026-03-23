# Enrollment Flow Monitor — QA / Final Release Checklist

## 1) Release blockers

A release is **not ready** until all of these are green:

- [ ] `npm install` completes successfully on a clean machine
- [ ] `npm run prisma:generate -w @efm/api` completes successfully
- [ ] `npm run build` completes successfully for `@efm/shared`, `@efm/api`, and `@efm/web`
- [ ] `npm run dev` starts both API and Web without runtime errors
- [ ] Sign in / sign out works
- [ ] Command Center loads in connected mode
- [ ] Fix Queue loads without null/undefined rendering issues
- [ ] Reports view loads and export action is reachable
- [ ] OCR view handles image upload and manual text entry safely
- [ ] Mobile navigation opens/closes correctly
- [ ] Empty states are readable and actionable

## 2) Smoke test matrix

### Auth
- [ ] Guest preview loads
- [ ] Sign in redirects correctly
- [ ] Connected user info appears in header
- [ ] Write permission gating blocks sensitive actions when missing

### Command Center
- [ ] Health score card renders
- [ ] Recommended actions render even when there is only one action
- [ ] Top root causes empty state renders cleanly
- [ ] Refresh button updates `last refresh`

### Fix Queue
- [ ] Priority badge renders for all incident severities
- [ ] Selecting an incident updates details panel
- [ ] Placeholder incidents do not break counts
- [ ] Remediation steps render as list / cards without overflow

### Reports
- [ ] Top errors list renders
- [ ] `Critical` severity does not break type assumptions
- [ ] Health score trend renders
- [ ] Export CTA is visible and safe when no data exists

### OCR
- [ ] Manual paste path works
- [ ] Image upload path works
- [ ] OCR failure shows user-friendly message

### Mobile
- [ ] Sidebar drawer opens and closes
- [ ] No horizontal overflow on dashboard
- [ ] Right rail stacks below main content
- [ ] Buttons remain touch-friendly

## 3) Acceptance criteria

The release is acceptable when:

1. The product feels like a **Command Center**, not just a raw admin tool.
2. The first screen tells the user **what matters now**.
3. The Fix Queue tells the user **what to fix next**.
4. Empty states explain what the view is checking and what to do next.
5. Desktop and mobile both feel intentional.

## 4) Recommended next implementation after this release

- Workflow persistence: `owner`, `status`, `notes`
- Executive reports polish
- Scheduled reporting / exports
- Multi-tenant / MSP mode
- RBAC / role separation
