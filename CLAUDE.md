# CLAUDE.md

Guidance for working in this repository.

## What this is

Orbital — a single-page, dependency-free **N-body solar system simulator**.
Written in TypeScript, compiled into a static `dist/` (HTML5 Canvas, vanilla JS,
no framework, no runtime deps). The build emits exactly one file:
`dist/index.html` — a single self-contained file (markup + inlined CSS + inlined JS).

## Golden rule

**Never edit the files in `dist/` by hand.** They are generated build artifacts
(gitignored). Edit the sources in `src/` (and `build.ts` / `src/template.ts`)
and regenerate.

## Source layout

```
src/main.ts        Simulation + physics + rendering + all UI wiring (browser TS)
src/styles.css     Dashboard / scene / overlay styling
src/template.ts    HTML shell; renderHTML() inlines the CSS and the compiled JS
build.ts           Generator: strips TS types, writes a self-contained dist/index.html
build.sh           Wrapper around build.ts (--open / --serve / --check)
.devcontainer/     VS Code / Codespaces dev container (Node 24)
```

`main.ts` is one big IIFE. `i` is a body's **stable id** (Sun = 0); `parent`
and the camera focus / selection are ids, resolved via `bodyById()` — not array
indices (so bodies can be removed by collisions safely).

## Build / verify

Requires **Node ≥ 22.13** (24.x). No `npm install` needed to build —
type-stripping uses Node's built-in `module.stripTypeScriptTypes`.

```bash
./build.sh            # regenerate dist/  (or: node build.ts)
./build.sh --check    # build + tsc --noEmit  (needs `npm install` once)
```

Always run `./build.sh --check` after changing `.ts` and confirm typecheck
passes before committing. On this machine Node is the Windows `node.exe`; the
scripts locate it automatically. Alternatively, use the dev container
(`.devcontainer/`) for a clean Node 24 Linux toolchain.

For pure-physics changes, sanity-check the math with a tiny standalone Node
harness in the scratchpad (this is how moon binding, collisions, and the
Voyager escape were verified) rather than only eyeballing the canvas.

## Conventions

- Keep it framework-free and single-file-output. No new runtime dependencies.
- New control? Wire it in all three places: markup (`template.ts`), state +
  listener (`main.ts`), and reset it in `resetControls()` so Reset / Random
  system restore it.
- Physics is stylized, not SI: distances/sizes are compressed; moons use a
  hybrid integrator (parent's frame) so they stay bound at this scale.
- `dist/index.html` carries a compile timestamp; the build output is gitignored,
  so there's no artifact churn in commits.

## Deploy

The build output (`dist/`) is a plain static site — one file, no server-side
component, copyable to any static host (GitHub Pages, Netlify, an nginx/Caddy
docroot, S3, …).

For the home NAS, deployment is a single command — `npm run deploy`
(`deploy.sh`) runs `./build.sh` then `rsync --delete`s `dist/` over SSH to a
folder served by a plain `nginx:alpine` container on the Unraid NAS (no image is
built). Target host/path come from `.env.deploy` (gitignored; see
`.env.deploy.example`) or env vars (`NAS_USER` / `NAS_HOST` / `NAS_PATH` /
`NAS_PORT`). Use `./deploy.sh --dry-run` to preview the sync without writing.

## Repo

GitHub: https://github.com/GValas/Orbital — commit to `main` and push when asked.
