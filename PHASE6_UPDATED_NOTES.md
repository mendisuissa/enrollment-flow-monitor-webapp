Updated Phase 6 delta

Included fixes:
- DashboardData type alignment
- IncidentWorkflowRecord export
- Workflow status alignment
- Prisma SQLite env example (.env.example)

After applying:
1. Copy .env.example to .env
2. Run npm install
3. Run npx prisma db push --schema apps/api/prisma/schema.prisma
4. Run npm run prisma:generate -w @efm/api
5. Run npm run build
6. Run npm run dev
