# syntax=docker/dockerfile:1
ARG NODE_VERSION=20-alpine

# --- base: shared dependency install step ----------------------------------
FROM node:${NODE_VERSION} AS base
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma

# --- development: full toolchain, used by docker-compose.yml locally -------
FROM base AS development
RUN npm ci
RUN npx prisma generate
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# --- build: compiles the production bundle ----------------------------------
FROM base AS build
RUN npm ci
RUN npx prisma generate
COPY . .
RUN npm run build

# --- production: slim runtime, no dev toolchain (SYSTEM_ARCHITECTURE.md 10.1)
FROM node:${NODE_VERSION} AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
