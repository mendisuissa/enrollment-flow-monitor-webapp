# Enrollment Flow Monitor Web App

Feature-for-feature web implementation of the desktop app using React + TypeScript + Vite (frontend) and Node.js + Express + TypeScript (backend).

## Project Structure

- `apps/web` - React UI
- `apps/api` - Express API, auth, Graph integration, normalization/incidents engines
- `packages/shared` - shared types/models

## Quick Start

Workspace root:

`C:\temp\KillWindowsApp\Enrollment-Webapp`

```bash
npm install
npm run prisma:generate
npm run dev
```

Web: `http://localhost:5173`
API: `http://localhost:4000`

## Docker

```bash
docker-compose up --build
```

## Output Paths

- Build outputs: `C:\temp\KillWindowsApp\Enrollment-Webapp\out`
- Release artifacts: `C:\temp\KillWindowsApp\Enrollment-Webapp\artifacts`

## Mock Mode

API supports fixture mode with no tenant required:

- Set `MOCK_MODE=true` (default in docker-compose)
- Fixtures live in `apps/api/fixtures`

## Auth Setup (Real Tenant)

Set these environment variables for API:

- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`
- `ENTRA_REDIRECT_URI` (for example `http://localhost:4000/api/auth/callback`)
- `GRAPH_SCOPES` (space-separated)

## Key Behaviors Preserved

- Null-safe grid + selection
- Placeholder incident row when no incidents
- Apps view renders apps even when statuses are empty
- Users view renders users even when devices are empty
- Friendly endpoint errors for empty/403/unsupported
- Export CSV/JSON + copy runbook + logs download
