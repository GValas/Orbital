# Orbital

An interactive **N-body solar system simulator** with a parametric physics
dashboard. Real gravitational attraction between every body (`F = G·m₁·m₂/r²`),
so the gravity / mass / time controls genuinely reshape the orbits.

The whole thing is written in **TypeScript** and compiled into a single,
dependency-free `index.html` by a build script.

## Project layout

```
src/main.ts       Simulation + rendering + UI wiring (browser TypeScript)
src/styles.css     Dashboard / scene styling
src/template.ts    HTML shell; inlines the CSS + compiled JS
build.ts           Generator → reads the sources, strips types, writes index.html
index.html         ← GENERATED. Open this in a browser. Do not edit by hand.
```

## Build

Requires **Node ≥ 22.13** (24.x recommended). No `npm install` is needed to
build — type-stripping uses Node's built-in `module.stripTypeScriptTypes`.

```bash
npm run build          # node build.ts  → writes ./index.html
npm run serve          # build, then serve at http://localhost:8000
```

Then open `index.html` in any modern browser.

### Optional: type-check

```bash
npm install            # pulls typescript + @types/node (dev only)
npm run typecheck      # tsc --noEmit
```

## Controls

| Control | Effect |
| --- | --- |
| **Time speed** | 0–5× simulation rate (slow-mo ↔ fast-forward) |
| **Gravity (G)** | 0–3× the gravitational constant — destabilizes or tightens orbits |
| **Sun mass** | 0.1–3× — reshapes every heliocentric orbit |
| **Zoom / View toggles** | trails, orbit paths, labels, mass-scaled body sizes |
| **Focus body** | camera follows any planet or moon |
| **Experiments** | Zero-G · Kick planets · Add comet |

Mouse: drag to pan · scroll to zoom · click a body to focus · hover for stats.
Keys: `space` pause/play · `h` hide the dashboard.

## Notes

Distances and sizes are **stylized/compressed** so the system fits on screen and
planets stay visible (true scale would put Neptune far off-screen). The
"Realistic scale" toggle sizes bodies by mass instead. Physics constants are
tuned for stable, good-looking orbits rather than SI units.
