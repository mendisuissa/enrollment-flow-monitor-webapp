FROM node:20-alpine
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm install

COPY . .
RUN npm run build -w @efm/shared && npm run build -w @efm/web

WORKDIR /app/apps/web
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
