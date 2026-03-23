# Phase 8 — Smart Filters + Saved Views

## What this delta adds
- Smart filters for **Fix Queue / Incidents**
  - P1
  - Critical
  - Investigating
  - Unassigned
  - No Notes
  - Resolved
- Smart filters for **Device views**
  - Non-Compliant
  - Stale Sync
  - Windows Only
  - Unknown User
  - Errors Only
- **Save current view** button
- Saved views scoped per current screen
- Saved views stored in browser `localStorage`

## How to use
1. Open **Incidents** or any device screen.
2. Apply search + filter chips.
3. Click **Save current view**.
4. Re-open the saved view from the pill list.

## Notes
- This is intentionally lightweight: saved views are local to the browser for fast adoption.
- No backend schema changes are required in this phase.
- This phase is designed to stack cleanly on top of your current UI work.
