#!/usr/bin/env bash
#
# bundle.sh — collect everything needed to deploy Orbital with Docker into a
# single folder (plus a .tar.gz), ready to copy to a server / Unraid NAS.
#
#   ./bundle.sh              → ./bundle/  and  ./bundle.tar.gz
#   ./bundle.sh out/orbital  → custom output directory
#
# The bundle supports both deployment paths:
#   • build path  — `docker compose up -d`  (Dockerfile rebuilds index.html)
#   • mount path  — bind-mount index.html into a stock nginx (no build)
#
set -euo pipefail
cd "$(dirname "$0")"

OUT="${1:-${BUNDLE_DIR:-bundle}}"

# Files needed for the Docker build context + a ready-made index.html so the
# bundle also works as a no-build bind-mount.
FILES=(
  Dockerfile
  docker-compose.yml
  .dockerignore
  docker.sh
  package.json
  build.ts
  deploy/nginx.conf
  src/main.ts
  src/styles.css
  src/template.ts
  index.html
)

# Refresh index.html so the bundled copy matches the current sources.
echo "› Regenerating index.html ..."
./build.sh >/dev/null

echo "› Staging bundle in '$OUT/' ..."
rm -rf "$OUT"
mkdir -p "$OUT"
for f in "${FILES[@]}"; do
  if [ ! -e "$f" ]; then echo "Error: missing '$f'" >&2; exit 1; fi
  mkdir -p "$OUT/$(dirname "$f")"
  cp "$f" "$OUT/$f"
done

# Tarball next to the folder for easy transfer.
base="$(basename "$OUT")"
( cd "$OUT/.." && tar czf "$base.tar.gz" "$base" )

echo "✓ Bundle ready:"
echo "    folder : $OUT/"
echo "    tarball: ${OUT}.tar.gz  ($(du -h "${OUT}.tar.gz" | cut -f1))"
echo
echo "Deploy on the target host:"
echo "    tar xzf $base.tar.gz && cd $base && docker compose up -d"
