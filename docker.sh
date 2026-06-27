#!/usr/bin/env bash
#
# docker.sh — build and run the production Orbital container (nginx + page).
#
#   ./docker.sh            Build the image and (re)start the container
#   ./docker.sh build      Build the image only
#   ./docker.sh run        (Re)start the container from the current image
#   ./docker.sh stop       Stop and remove the container
#   ./docker.sh logs       Follow container logs
#
# Override defaults via env vars:
#   ORBITAL_IMAGE (orbital:latest)  ORBITAL_NAME (orbital)  ORBITAL_PORT (8088)
#
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${ORBITAL_IMAGE:-orbital:latest}"
NAME="${ORBITAL_NAME:-orbital}"
PORT="${ORBITAL_PORT:-8088}"

build() {
  echo "› Building image '$IMAGE' ..."
  docker build -t "$IMAGE" .
}

run() {
  echo "› (Re)starting container '$NAME' on host port $PORT ..."
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d \
    --name "$NAME" \
    --restart unless-stopped \
    -p "$PORT:80" \
    "$IMAGE" >/dev/null
  echo "✓ Running → http://localhost:$PORT"
}

case "${1:-up}" in
  up)    build; run ;;
  build) build ;;
  run)   run ;;
  stop)  docker rm -f "$NAME" >/dev/null 2>&1 && echo "✓ stopped" || echo "not running" ;;
  logs)  docker logs -f "$NAME" ;;
  *) echo "usage: $0 {up|build|run|stop|logs}" >&2; exit 1 ;;
esac
