# CLAUDE.md

Guidance for working in this repository.

## What this is

Orbital — a single-page, dependency-free **N-body solar system simulator**.
Written in TypeScript, compiled into one self-contained `index.html` that runs
in any browser (HTML5 Canvas, vanilla JS, no framework, no runtime deps).

## Golden rule

**Never edit `index.html` by hand.** It is a generated build artifact. Edit the
sources in `src/` (and `build.ts` / `src/template.ts`) and regenerate.

## Source layout

```
src/main.ts        Simulation + physics + rendering + all UI wiring (browser TS)
src/styles.css     Dashboard / scene / overlay styling
src/template.ts    HTML shell; renderHTML() inlines the CSS + compiled JS
build.ts           Generator: reads sources, strips TS types, writes index.html
build.sh           Wrapper around build.ts (--open / --serve / --check)
bundle.sh          Produces a runtime-only deploy folder (./bundle/) for a NAS
docker.sh          Build & run the production image locally
Dockerfile         Multi-stage image (build from source -> nginx)
deploy/nginx.conf  nginx config baked into the images
```

`main.ts` is one big IIFE. `i` is a body's **stable id** (Sun = 0); `parent`
and the camera focus / selection are ids, resolved via `bodyById()` — not array
indices (so bodies can be removed by collisions safely).

## Build / verify

Requires **Node ≥ 22.13** (24.x). No `npm install` needed to build —
type-stripping uses Node's built-in `module.stripTypeScriptTypes`.

```bash
./build.sh            # regenerate index.html  (or: node build.ts)
./build.sh --check    # build + tsc --noEmit  (needs `npm install` once)
```

Always run `./build.sh --check` after changing `.ts` and confirm typecheck
passes before committing. On this machine Node is the Windows `node.exe`; the
scripts locate it automatically.

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
- `index.html` carries a compile timestamp, so every rebuild yields a 1-line
  diff — that's expected churn, not a real change.

## Deploy

```bash
./docker.sh                       # local: build image + run on :8088
./bundle.sh                       # make ./bundle/ to copy to a server / NAS
```

Unraid (no compose plugin needed): copy `bundle/` to the NAS, then `./run.sh`
inside it (bind-mounts the page into stock nginx on :8088). See README for the
full step-by-step.

## Repo

GitHub: https://github.com/GValas/Orbital — commit to `main` and push when asked.
