FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

FROM base AS development
COPY frontend frontend
EXPOSE 5173
CMD ["npm", "run", "dev", "-w", "frontend"]

FROM base AS build
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY frontend frontend
RUN npm run build -w frontend

FROM nginx:1.27-alpine AS production
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
