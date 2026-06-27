#!/usr/bin/env bash
#
# build.sh — generate index.html from the TypeScript sources.
#
#   ./build.sh            Build index.html
#   ./build.sh --serve    Build, then serve at http://localhost:8000
#   ./build.sh --check    Build, then run `tsc --noEmit` (needs npm install)
#   ./build.sh --open     Build, then open index.html in the default browser
#
set -euo pipefail

cd "$(dirname "$0")"

# --- Locate a Node >= 22.13 runtime -----------------------------------------
# Prefer a native `node`; fall back to a Windows node.exe when running under WSL.
find_node() {
  if command -v node >/dev/null 2>&1; then
    echo "node"; return 0
  fi
  for cand in \
    "/mnt/c/Program Files/nodejs/node.exe" \
    "/mnt/c/Program Files (x86)/nodejs/node.exe"; do
    [ -x "$cand" ] && { echo "$cand"; return 0; }
  done
  if command -v node.exe >/dev/null 2>&1; then
    echo "node.exe"; return 0
  fi
  return 1
}

NODE="$(find_node)" || {
  echo "Error: Node.js not found. Install Node >= 22.13 (24.x recommended)." >&2
  exit 1
}

# --- Version guard (needs module.stripTypeScriptTypes) ----------------------
ver="$("$NODE" -p 'process.versions.node')"
major="${ver%%.*}"
rest="${ver#*.}"; minor="${rest%%.*}"
if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 13 ]; }; then
  echo "Error: Node $ver is too old; need >= 22.13 for native type-stripping." >&2
  exit 1
fi

# --- Build ------------------------------------------------------------------
echo "› Building with Node $ver ..."
"$NODE" build.ts

# --- Optional flags ---------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --check)
      echo "› Type-checking ..."
      if [ -f node_modules/typescript/lib/tsc.js ]; then
        "$NODE" node_modules/typescript/lib/tsc.js --noEmit
        echo "✓ Typecheck passed"
      else
        echo "  (skipped: run \`npm install\` first to enable --check)" >&2
      fi
      ;;
    --open)
      target="$(pwd)/index.html"
      echo "› Opening $target"
      if command -v xdg-open >/dev/null 2>&1; then xdg-open "$target" >/dev/null 2>&1 &
      elif command -v open >/dev/null 2>&1; then open "$target"
      elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$(wslpath -w "$target" 2>/dev/null || echo "$target")" || true
      else echo "  Open this in a browser: file://$target"; fi
      ;;
    --serve)
      port=8000
      echo "› Serving at http://localhost:$port  (Ctrl-C to stop)"
      if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$port"
      elif command -v python >/dev/null 2>&1; then exec python -m http.server "$port"
      else echo "Error: python not found; cannot serve." >&2; exit 1; fi
      ;;
  esac
done

echo "✓ Done. Open: file://$(pwd)/index.html"
