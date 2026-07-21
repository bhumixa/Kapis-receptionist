# syntax=docker/dockerfile:1
ARG NODE_VERSION=20-alpine

# --- base: shared dependency install step ----------------------------------
FROM node:${NODE_VERSION} AS base
WORKDIR /app
COPY package*.json ./

# --- development: Angular dev server with hot reload, used by docker-compose.yml
FROM base AS development
RUN npm ci
COPY . .
EXPOSE 4200
CMD ["npx", "ng", "serve", "--host", "0.0.0.0", "--port", "4200"]

# --- build: compiles the production static bundle ---------------------------
FROM base AS build
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

# --- production: static assets served by a minimal nginx (SYSTEM_ARCHITECTURE.md 10.1)
FROM nginx:1.27-alpine AS production
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
