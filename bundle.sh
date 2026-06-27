#!/usr/bin/env bash
#
# bundle.sh — produce a minimal, runtime-only Docker deployment bundle.
#
#   ./bundle.sh              → ./bundle/  and  ./bundle.tar.gz
#   ./bundle.sh out/orbital  → custom output directory
#
# The bundle contains ONLY what's needed to serve the app — the prebuilt page,
# the nginx config, and a single-stage Dockerfile that copies the page in.
# No TypeScript sources, no Node, no build step on the target host.
#
set -euo pipefail
cd "$(dirname "$0")"

OUT="${1:-${BUNDLE_DIR:-bundle}}"

# Refresh index.html so the bundled copy matches the current sources.
echo "› Regenerating index.html ..."
./build.sh >/dev/null

echo "› Staging runtime bundle in '$OUT/' ..."
rm -rf "$OUT"
mkdir -p "$OUT"

# The two real artifacts.
cp index.html        "$OUT/index.html"
cp deploy/nginx.conf "$OUT/nginx.conf"

# A tiny single-stage image: stock nginx + the prebuilt page. No build tooling.
cat > "$OUT/Dockerfile" <<'DOCKERFILE'
# Runtime-only image — serves the prebuilt index.html with a tiny nginx.
FROM nginx:1.27-alpine
LABEL org.opencontainers.image.title="Orbital" \
      org.opencontainers.image.source="https://github.com/GValas/Orbital"
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf  /etc/nginx/conf.d/orbital.conf
COPY index.html  /usr/share/nginx/html/index.html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://localhost/ || exit 1
DOCKERFILE

cat > "$OUT/docker-compose.yml" <<'COMPOSE'
# Production deployment for Orbital (runtime-only).
# Works with `docker compose up -d` and Unraid's Compose Manager plugin.
services:
  orbital:
    build: .
    image: orbital:latest
    container_name: orbital
    restart: unless-stopped
    ports:
      - "${ORBITAL_PORT:-8088}:80"
COMPOSE

# Tarball next to the folder for easy transfer.
base="$(basename "$OUT")"
( cd "$OUT/.." && tar czf "$base.tar.gz" "$base" )

echo "✓ Runtime bundle ready ($(find "$OUT" -type f | wc -l | tr -d ' ') files):"
find "$OUT" -type f | sort | sed 's/^/    /'
echo "    tarball: ${OUT}.tar.gz ($(du -h "${OUT}.tar.gz" | cut -f1))"
echo
echo "Deploy on the target host:"
echo "    tar xzf $base.tar.gz && cd $base && docker compose up -d"
echo "Or without building an image (pure bind-mount):"
echo "    docker run -d --name orbital --restart unless-stopped -p 8088:80 \\"
echo "      -v \"\$PWD/index.html:/usr/share/nginx/html/index.html:ro\" \\"
echo "      -v \"\$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro\" nginx:1.27-alpine"
