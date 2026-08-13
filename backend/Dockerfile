FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

FROM base AS development
COPY backend backend
COPY migrations migrations
CMD ["npm", "run", "dev", "-w", "backend"]

FROM base AS build
COPY backend backend
RUN npm run build -w backend

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev --workspace backend --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY migrations migrations
USER node
EXPOSE 3000
CMD ["node", "backend/dist/index.js"]
