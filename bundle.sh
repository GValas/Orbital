#!/usr/bin/env bash
#
# bundle.sh — produce a minimal, runtime-only Docker deployment bundle.
#
#   ./bundle.sh              → ./bundle/
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

# A no-compose deploy script: bind-mounts the page into a stock nginx.
# Removes any existing container first, so it's safe to re-run for updates.
cat > "$OUT/run.sh" <<'RUN'
#!/usr/bin/env bash
# Deploy Orbital with a stock nginx, bind-mounting the page (no build, no compose).
#   ./run.sh        start (or restart) the container
# Override: ORBITAL_PORT (8088), ORBITAL_NAME (orbital), ORBITAL_IMAGE (nginx:1.27-alpine)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NAME="${ORBITAL_NAME:-orbital}"
PORT="${ORBITAL_PORT:-8088}"
IMAGE="${ORBITAL_IMAGE:-nginx:1.27-alpine}"

echo "› Removing any existing '$NAME' container ..."
docker rm -f "$NAME" >/dev/null 2>&1 || true

echo "› Starting '$NAME' on port $PORT ..."
docker run -d --name "$NAME" --restart unless-stopped -p "$PORT:80" \
  -v "$DIR/index.html:/usr/share/nginx/html/index.html:ro" \
  -v "$DIR/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  "$IMAGE" >/dev/null

echo "✓ Running → http://localhost:$PORT  (or http://<host-ip>:$PORT)"
docker ps --filter "name=$NAME" --format '   {{.Names}}: {{.Status}}  {{.Ports}}'
RUN
chmod +x "$OUT/run.sh"

echo "✓ Runtime bundle ready ($(find "$OUT" -type f | wc -l | tr -d ' ') files):"
find "$OUT" -type f | sort | sed 's/^/    /'
echo
echo "Deploy on the target host (copy the folder over, then):"
echo "    cd $OUT && ./run.sh          # no compose needed; safe to re-run"
echo "  or, if you have the Compose plugin:"
echo "    cd $OUT && docker compose up -d"
