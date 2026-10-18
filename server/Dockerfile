# --- Stage 1: build. All dependencies, including TypeScript, to compile src/ into dist/ ---
FROM node:24-alpine AS build

WORKDIR /app

# Dependencies first: this layer stays cached until package.json or the lockfile changes
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: runtime. Only production dependencies and the compiled JavaScript ---
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# The node image comes with a non-root user "node" (UID 1000). The numeric UID lets Kubernetes verify runAsNonRoot.
USER 1000

EXPOSE 8000

# node directly, not "npm start": that way SIGTERM reaches our process instead of stopping at npm
CMD ["node", "dist/server.js"]
