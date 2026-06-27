# syntax=docker/dockerfile:1

# ─── Stage 1: generate index.html from the TypeScript sources ───────────────
# Node 24 has the native type-stripping the generator relies on, so no npm
# install is needed — the build is a single `node build.ts`.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json build.ts ./
COPY src ./src
RUN node build.ts && test -s index.html

# ─── Stage 2: serve the static page with a tiny nginx ───────────────────────
FROM nginx:1.27-alpine AS runtime
LABEL org.opencontainers.image.title="Orbital" \
      org.opencontainers.image.description="N-body solar system simulator" \
      org.opencontainers.image.source="https://github.com/GValas/Orbital"

# Replace the stock site with our hardened static-file config.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/orbital.conf
COPY --from=build /app/index.html /usr/share/nginx/html/index.html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://localhost/ || exit 1

# nginx:alpine's default CMD already runs `nginx -g 'daemon off;'`.
