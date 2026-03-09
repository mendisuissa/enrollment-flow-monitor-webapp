FROM node:20-alpine
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm install

COPY . .
RUN npm run prisma:generate -w @efm/api && npm run build -w @efm/shared && npm run build -w @efm/api

WORKDIR /app/apps/api
CMD ["node", "/app/out/apps/api/server.js"]
