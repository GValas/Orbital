# Orbital

An interactive **N-body solar system simulator** with a parametric physics
dashboard. Every body attracts every other (`F = G·m₁·m₂/r²`), so the gravity /
mass / time controls genuinely reshape the orbits.

Written in **TypeScript** and compiled into a dependency-free static site
(`dist/index.html` + `dist/app.js`) by a small build script — no framework,
no runtime dependencies.

![Orbital — tilted view of the solar system](docs/screenshot.png)

## Features

- **Real N-body gravity** for the Sun, 8 planets, and comets — orbits respond
  live to the gravity, Sun-mass and time controls.
- **Moons** (Earth, Mars, Jupiter, Saturn) integrated in their parent's frame
  so they orbit their planet stably at the compressed visual scale.
- **Collisions** — overlapping bodies merge (momentum-conserving accretion)
  with a flash; toggleable.
- **Add stars with the mouse** — click to drop a heavy star, or drag to fling a
  fly-by; the whole system feels its gravity and visibly deforms. Mass set by a
  slider. Right-click any body to delete it; **Undo** (or `z`) removes the last
  spawned body.
- **Tidal disruption** (toggle) — a body that strays inside a star's Roche zone
  shatters into a debris stream instead of merging.
- **Scenario presets** — Binary star · Circumbinary planets · Stellar fly-by ·
  Chaos cluster, each seeded with physically sensible orbital speeds.
- **Diagnostics overlays** — gravitational-potential heatmap, per-body velocity
  vectors, and the system barycenter marker.
- **Barnes-Hut** quadtree kicks in automatically for large body counts (e.g.
  debris fields) so the N-body sum stays fast; the exact all-pairs sum runs
  below the threshold. Adaptive sub-stepping tightens near close encounters.
- **Random system generator** — a star with up to 10 planets, each with up to
  4 moons (also resets all controls to defaults).
- **Launch Voyager 1** — a probe leaves Earth on a real escape trajectory and
  can pick up gravity assists from the planets it passes.
- **Asteroid belt + Oort cloud** as animated decorative particle belts.
- **Animated deep-space background** — drifting nebulae and slowly rotating
  spiral galaxies.
- **Terrestrial day counter** — elapsed time in Earth days (1 orbit = 365.25).
- **3D-ish view** — tilt/spin the orbital plane; depth-sorted rendering.
- **Info card** with a mini picture, type, mass, moons, distances and an
  estimated orbital period for any body you click.
- **Touch support** and a responsive, foldable dashboard for phones.

## Controls

| Control | Effect |
| --- | --- |
| **Time speed** | 0–0.2× simulation rate (default 0.10×) |
| **Gravity (G)** | 0–3× the gravitational constant — destabilizes or tightens orbits |
| **Sun mass** | 0.1–3× — reshapes every heliocentric orbit |
| **Zoom** + view toggles | trails, paths, labels, real scale, collisions, belts, trajectory, field, vectors, barycenter, tides |
| **Star mass** | mass of stars dropped with **☀️ Add star** (0.1–2 M☉) |
| **Focus body** | camera follows any planet or moon |
| **Experiments** | Zero-G · Kick planets · Add comet · 🌟 Random system · 🛰️ Voyager 1 · 🎯 Aim & launch · ☀️ Add star · ↶ Undo · scenario presets |
| **Reset** | restore the real solar system and all defaults |

- **Mouse:** drag to pan · scroll to zoom · **click a body to show its info
  card** · **right-click a body to delete it** · hold **both buttons** and drag
  to tilt/spin the plane.
- **Touch:** drag to pan · pinch to zoom · two fingers to tilt/spin · tap a
  body for its card.
- **Keys:** `space` play/pause · `h` fold the menu · `0` reset the view ·
  `z` undo the last added body.

The menu starts folded — click **☰** to open it; clicking outside folds it again.

## Build

Requires **Node ≥ 22.13** (24.x recommended). No `npm install` is needed to
build — type-stripping uses Node's built-in `module.stripTypeScriptTypes`.

```bash
./build.sh             # → writes ./dist/   (also: --open, --serve, --check)
# or:
node build.ts
```

This produces a `dist/` folder with exactly two files — `index.html` (markup +
inlined CSS) and `app.js` (the simulation). Open `dist/index.html` in any modern
browser, or run `./build.sh --serve` to serve `dist/` at
`http://localhost:8000`.

Optional type-check: `npm install` then `npm run typecheck` (`tsc --noEmit`).

## Dev container

A [dev container](.devcontainer/devcontainer.json) is provided so you can build
without installing Node locally (handy on Windows/WSL). Open the folder in
VS Code → **Reopen in Container** (or use GitHub Codespaces); it spins up Node 24
and runs `npm install`. Then inside the container:

```bash
npm run build          # → dist/
npm run serve          # build + serve dist/ on http://localhost:8000
```

## Deploy

The build output is a plain static site — copy the two files in `dist/` to any
static host (GitHub Pages, Netlify, an nginx/Caddy docroot, an S3 bucket, …).
There is no server-side component and nothing to configure.

### NAS Unraid (rsync → nginx)

For the home NAS the site is served by a plain **nginx** container and `dist/`
is synced into it with `rsync` — **no image is built**.

**Préparation (une seule fois)**

1. Sur Unraid, onglet *Docker* → *Add Container* :
   - **Name** : `orbital`
   - **Repository** : `nginx:alpine`
   - **Network Type** : `bridge`
   - **Port** : host `8088` → container `80`
   - **Path** : host `/mnt/user/appdata/orbital/site` → container
     `/usr/share/nginx/html` (en lecture seule)
   - Laisser tourner avec *Restart policy* : `unless-stopped`
2. Copier `.env.deploy.example` en `.env.deploy` (non versionné) et y renseigner
   l'hôte/chemin SSH du NAS (`NAS_HOST`, `NAS_PATH`, …).

> Physics tourne déjà sur le port hôte `8087` ; Orbital utilise `8088` pour
> éviter le conflit. Le dossier hôte (`NAS_PATH`) est créé automatiquement par
> `deploy.sh` lors du premier déploiement, mais le bind-mount du conteneur le
> référence dès sa création — crée le dossier ou lance un premier `deploy.sh`
> avant de démarrer le conteneur.

**Déployer (à chaque mise à jour)**

```bash
npm run deploy                # build + rsync de dist/ vers le NAS
npm run deploy -- --dry-run   # aperçu sans rien écrire
```

`deploy.sh` exécute `./build.sh` puis un `rsync --delete` de `dist/` vers
`NAS_USER@NAS_HOST:NAS_PATH` via SSH. Ouvrir ensuite `http://<ip-du-nas>:8088`
(Ctrl+F5 pour forcer le rafraîchissement).

## Project layout

```
src/main.ts        Simulation + rendering + UI (browser TypeScript)
src/styles.css     Dashboard / scene styling
src/template.ts    HTML shell; inlines the CSS, links dist/app.js
build.ts           Generator → strips types, writes dist/index.html + dist/app.js
build.sh           Convenience wrapper (build / --open / --serve / --check)
.devcontainer/     VS Code / Codespaces dev container (Node 24)
dist/              ← GENERATED build output (gitignored). Do not edit by hand.
```

## Notes

Distances and sizes are **stylized/compressed** so the system fits on screen and
planets stay visible (true scale would put Neptune far off-screen, and moons
inside their planet). The "Realistic scale" toggle sizes bodies by mass instead.
Physics constants are tuned for stable, good-looking orbits rather than SI units;
moon orbits intentionally drop tiny Sun-tidal terms so they stay bound at this
scale.
