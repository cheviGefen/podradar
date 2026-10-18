# --- Stage 1: build. Type-check and compile the React app into static files in dist/ ---
FROM node:24-alpine AS build

WORKDIR /app

# Dependencies first: this layer stays cached until package.json or the lockfile changes
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Stage 2: serve. nginx serves the static files and forwards /api to the server ---
# No Node.js in the final image at all: a built React app is just HTML, CSS and JavaScript files.
# This nginx image runs as a non-root user (UID 101).
FROM nginxinc/nginx-unprivileged:1.30-alpine

# Where nginx sends /api; can be overridden with -e or in Kubernetes
ENV API_UPSTREAM=server:8000
# Makes the nginx image put the container's DNS servers into ${NGINX_LOCAL_RESOLVERS}
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
