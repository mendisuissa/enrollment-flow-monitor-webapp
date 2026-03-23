# Smoke Test Commands

Run from the repository root:

```powershell
npm install
npm run prisma:generate -w @efm/api
npm run build
npm run dev
```

Useful validation commands:

```powershell
node -v
npm -v
npm ls @prisma/client prisma
```

If Prisma fails:

```powershell
npx prisma generate --schema apps/api/prisma/schema.prisma
```

If you want a clean reinstall:

```powershell
Remove-Item -Recurse -Force .
ode_modules -ErrorAction SilentlyContinue
Remove-Item -Force .\package-lock.json -ErrorAction SilentlyContinue
npm install
npm run prisma:generate -w @efm/api
npm run build
npm run dev
```
