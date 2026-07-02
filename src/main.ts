/**
 * Orbital — interactive N-body solar system simulator.
 *
 * This file is the simulation source. It is transpiled (types stripped) and
 * inlined into `index.html` by `build.ts`. It targets the browser DOM and is
 * never executed under Node.
 */

(() => {
  "use strict";

  // ----------------------------- Types -----------------------------
  type Vec2 = [number, number];

  interface Body {
    i: number;
    name: string;
    color: string;
    distAU: number;
    radius: number;
    mass: number;          // relative to Earth = 1
    parent: number | null; // index of body it orbits, or null for the Sun
    isMoon: boolean;
    ecc: number;           // orbital eccentricity at spawn (0 = circular)
    x: number; y: number;
    vx: number; vy: number;
    trail: Vec2[];
    extra: boolean;        // true for runtime-spawned bodies (comets)
    isStar?: boolean;      // true for runtime-dropped stars (self-lit, glowing)
    isHole?: boolean;      // true for black holes (event horizon + accretion disk)
  }

  interface Star { x: number; y: number; r: number; a: number; tw: number; }

  // [name, color, distAU(semi-major axis), radiusPx, massEarth, parentIndex, isMoon, eccentricity?]
  type BodyDef = [string, string, number, number, number, number | null, boolean, number?];

  // --------------------------- Canvas ------------------------------
  const canvas = document.getElementById("scene") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  let W = 0, H = 0;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  function resize(): void {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ----------------------------------------------------------------
  // Model. Distances in "AU-ish" sim units, scaled to pixels by AU.
  // Masses relative to Earth = 1. The Sun dominates so orbits are
  // near-Keplerian, but every body attracts every other (true N-body).
  // ----------------------------------------------------------------
  const AU = 90;        // pixels per AU at zoom 1 (compressed view)
  const BASE_G = 2600;  // tuned so circular orbits look good at this scale
  // Earth's orbital period in sim-seconds (at default G) — 1 year = 365.25 days.
  const EARTH_YEAR_SIM = 2 * Math.PI * Math.sqrt(Math.pow(1.10 * AU, 3) / (BASE_G * 333000));

  // Moons are listed immediately after their parent planet; `parent` is the
  // 0-based index of another row, so order matters (a parent must precede its
  // moons). Moon orbital distances are spread for visibility, not to scale.
  const DEFS: BodyDef[] = [
    ["Sun",       "#ffcf4d",  0.00, 26,  333000, null, false],  // 0
    ["Mercury",   "#b9a08a",  0.55,  3.0,   0.055, 0, false, 0.21],   // 1
    ["Venus",     "#e8c27a",  0.80,  5.4,   0.815, 0, false, 0.01],   // 2
    ["Earth",     "#6fb1ff",  1.10,  5.7,   1.000, 0, false, 0.02],   // 3
    ["Moon",      "#cfd3da",  0.16,  2.0,   0.012,   3, true, 0.05],
    ["Mars",      "#e06a4a",  1.45,  4.2,   0.107, 0, false, 0.09],   // 5
    ["Phobos",    "#9a8d80",  0.10,  1.2,   0.000002, 5, true ],
    ["Deimos",    "#a89a88",  0.15,  1.1,   0.000002, 5, true ],
    ["Jupiter",   "#d8a878",  2.30, 15.0, 317.8,   0, false, 0.05],   // 8
    ["Io",        "#e8e07a",  0.30,  1.9,   0.015,   8, true ],
    ["Europa",    "#cdbfa0",  0.40,  1.7,   0.008,   8, true ],
    ["Ganymede",  "#b7a98f",  0.52,  2.3,   0.025,   8, true ],
    ["Callisto",  "#8d8378",  0.64,  2.2,   0.018,   8, true ],
    ["Saturn",    "#e6cf9c",  3.10, 12.5,  95.2,    0, false, 0.06],  // 13
    ["Enceladus", "#eef4ff",  0.30,  1.3,   0.00002, 13, true ],
    ["Dione",     "#cdd2da",  0.36,  1.4,   0.0002,  13, true ],
    ["Rhea",      "#cfd0d4",  0.44,  1.6,   0.0004,  13, true ],
    ["Titan",     "#c8a85a",  0.55,  2.0,   0.022,   13, true ],
    ["Iapetus",   "#b8a890",  0.72,  1.6,   0.0003,  13, true ],
    ["Uranus",    "#8fe0e0",  3.85,  9.0,  14.5,    0, false, 0.05],  // 19
    ["Neptune",   "#5a78e0",  4.55,  8.7,  17.1,    0, false, 0.01],  // 20
  ];

  let bodies: Body[] = [];
  let nextId = 0;                         // stable id source for new bodies
  const bodyById = (id: number): Body | undefined => bodies.find(b => b.i === id);
  let GRAV_SCALE = 1, TIME_SCALE = 1, SUN_SCALE = 1, ZOOM = 1;
  let REAL_SCALE = false;
  let paused = false;
  let collisions = true;                  // merge bodies on contact
  let simTime = 0;                        // total elapsed simulation time (sim-seconds)
  let timeDir = 1;                        // +1 forward, −1 rewinding (leapfrog is reversible)

  function makeBodies(): void {
    bodies = DEFS.map((d, i): Body => ({
      i, name: d[0], color: d[1], distAU: d[2], radius: d[3],
      mass: d[4], parent: d[5], isMoon: d[6], ecc: d[7] ?? 0,
      x: 0, y: 0, vx: 0, vy: 0, trail: [], extra: false,
    }));
    nextId = bodies.length;  // ids 0..n-1 are taken by the DEFS rows
    addedStack.length = 0;   // old-world ids could collide with the fresh ones
    // Place each body on an (optionally eccentric) orbit about its parent.
    // distAU is the semi-major axis a; we start every body at perihelion.
    for (const b of bodies) {
      if (b.parent === null) { b.x = 0; b.y = 0; b.vx = 0; b.vy = 0; continue; }
      const p = bodyById(b.parent)!;
      const ang = Math.random() * Math.PI * 2;
      const a = b.distAU * AU;
      const e = Math.max(0, Math.min(0.9, b.ecc));
      const rp = a * (1 - e);                 // perihelion distance
      b.x = p.x + Math.cos(ang) * rp;
      b.y = p.y + Math.sin(ang) * rp;
      // vis-viva at perihelion: v² = (G·M/a)·(1+e)/(1-e)  → circular when e=0
      const mu = BASE_G * p.mass * (b.parent === 0 ? SUN_SCALE : 1) * GRAV_SCALE;
      const v = Math.sqrt(mu / a * (1 + e) / (1 - e));
      b.vx = p.vx + Math.sin(ang) * -v;  // perpendicular to radius (CCW)
      b.vy = p.vy + Math.cos(ang) * v;
    }
    makeRings();
    baselineEnergy();
  }

  // Create a body on an (optionally eccentric) orbit about `parent`, fresh id.
  function spawnOrbiter(parent: Body, distAU: number, radius: number, mass: number,
                        color: string, name: string, isMoon: boolean, ecc = 0): Body {
    const ang = Math.random() * Math.PI * 2;
    const a = distAU * AU;
    const e = Math.max(0, Math.min(0.9, ecc));
    const rp = a * (1 - e);
    const mu = BASE_G * massOf(parent) * GRAV_SCALE;
    const v = Math.sqrt(mu / a * (1 + e) / (1 - e));
    return {
      i: nextId++, name, color, distAU, radius, mass, parent: parent.i, isMoon, ecc: e,
      x: parent.x + Math.cos(ang) * rp, y: parent.y + Math.sin(ang) * rp,
      vx: parent.vx + Math.sin(ang) * -v, vy: parent.vy + Math.cos(ang) * v,
      trail: [], extra: false,
    };
  }

  const PALETTE = ["#6fb1ff", "#e06a4a", "#d8a878", "#8fe0e0", "#5a78e0",
                   "#e8c27a", "#b9a08a", "#9fd17a", "#c98fe0", "#e6cf9c"];
  const NAMES = ["Aon", "Bel", "Cyr", "Dris", "Eos", "Fenn", "Gala", "Hyl", "Ira", "Kael",
                 "Lyra", "Mir", "Nyx", "Orin", "Pyr", "Rho", "Syl", "Tyr", "Vael", "Zeph"];

  // Random system: a star with up to 10 planets, each with up to 4 moons.
  function makeRandomSystem(): void {
    endMission(null);
    bodies = [];
    nextId = 0;
    flashes.length = 0;
    addedStack.length = 0;   // old-world ids could collide with the fresh ones
    const sun: Body = {
      i: nextId++, name: "Sun", color: "#ffcf4d", distAU: 0,
      radius: 22 + Math.random() * 8, mass: 333000, parent: null, isMoon: false, ecc: 0,
      x: 0, y: 0, vx: 0, vy: 0, trail: [], extra: false,
    };
    bodies.push(sun);

    const nPlanets = 1 + Math.floor(Math.random() * 10);          // 1..10
    let dist = 0.5 + Math.random() * 0.3;
    for (let p = 0; p < nPlanets; p++) {
      dist += 0.32 + Math.random() * 0.6;
      const mass = Math.pow(10, Math.random() * 3.7 - 1.3);       // ~0.05 .. ~250 M⊕
      const radius = Math.max(3, Math.min(16, Math.cbrt(mass) * 2.2 + 2));
      const name = NAMES[Math.floor(Math.random() * NAMES.length)] + "-" + (p + 1);
      const ecc = Math.random() < 0.5 ? Math.random() * 0.18 : 0;   // some elliptical
      const planet = spawnOrbiter(sun, dist, radius, mass, PALETTE[p % PALETTE.length], name, false, ecc);
      bodies.push(planet);

      const nMoons = Math.floor(Math.random() * 5);               // 0..4
      let md = (radius / AU) * 2.2 + 0.06;                        // clear of the planet disk
      for (let mn = 0; mn < nMoons; mn++) {
        md += 0.07 + Math.random() * 0.12;
        const mmass = mass * (0.0005 + Math.random() * 0.008);
        const mradius = Math.max(1.2, Math.min(5, Math.min(radius * 0.42, Math.cbrt(mmass) * 2 + 1)));
        bodies.push(spawnOrbiter(planet, md, mradius, mmass, "#cfd3da",
          name + " " + String.fromCharCode(97 + mn), true));
      }
    }
    cam.focus = 0; selected = 0; simTime = 0; followSuspended = false;
    belt = []; oort = [];   // a random system has no predefined belts
    baselineEnergy();
    buildFocusList();
  }

  // Populate the asteroid belt (between Mars & Jupiter) and the far Oort cloud.
  function makeRings(): void {
    belt = []; oort = [];
    const sunMass = 333000;
    for (let i = 0; i < 520; i++) {
      const r = (1.62 + Math.random() * 0.46) * AU;   // between Mars and Jupiter
      const w = Math.sqrt(BASE_G * sunMass / (r * r * r));
      const s = 110 + Math.floor(Math.random() * 70);
      const al = (0.22 + Math.random() * 0.5).toFixed(2);
      belt.push({ a: Math.random() * Math.PI * 2, r, w, c: `rgba(${s},${(s * 0.85) | 0},${(s * 0.64) | 0},${al})` });
    }
    for (let i = 0; i < 640; i++) {
      const r = (5.1 + Math.random() * 2.9) * AU;      // far beyond Neptune
      const w = Math.sqrt(BASE_G * sunMass / (r * r * r));
      const al = (0.10 + Math.random() * 0.32).toFixed(2);
      oort.push({ a: Math.random() * Math.PI * 2, r, w, c: `rgba(190,210,235,${al})` });
    }
  }

  function advanceRings(simDt: number): void {
    const g = Math.sqrt(GRAV_SCALE);
    for (const p of belt) p.a += p.w * g * simDt;
    for (const p of oort) p.a += p.w * g * simDt;
  }

  function drawRings(): void {
    if (!showRings) return;
    const sun = bodies[0];
    if (!sun) return;
    for (const p of belt) {
      const [sx, sy] = worldToScreen(sun.x + Math.cos(p.a) * p.r, sun.y + Math.sin(p.a) * p.r);
      ctx.fillStyle = p.c; ctx.fillRect(sx, sy, 1.3, 1.3);
    }
    for (const p of oort) {
      const [sx, sy] = worldToScreen(sun.x + Math.cos(p.a) * p.r, sun.y + Math.sin(p.a) * p.r);
      ctx.fillStyle = p.c; ctx.fillRect(sx, sy, 1.1, 1.1);
    }
  }

  // --------------------------- Physics -----------------------------
  // Hybrid model. Sun + planets + comets interact via true all-pairs N-body.
  // Moons, however, sit far outside their planet's Hill sphere at this
  // compressed visual scale, so under full N-body the Sun would dominate and
  // they'd never orbit their planet. Instead each moon is integrated in its
  // parent's accelerating frame: it feels the parent's gravity plus inherits
  // the parent's external (Sun + planets) acceleration, so it cleanly circles
  // the planet while the planet still does real N-body around the Sun.
  function massOf(b: Body): number {
    return b.i === 0 ? b.mass * SUN_SCALE : b.mass;
  }

  // ------------------------- Barnes-Hut ----------------------------
  // For large body counts the O(n²) all-pairs sum gets expensive, so above a
  // threshold pass 1 uses a Barnes-Hut quadtree (O(n log n)): distant clusters
  // are approximated by their centre of mass when s/d < θ. Below the threshold
  // the exact double loop runs, so the default system is bit-for-bit unchanged.
  const BH_THRESHOLD = 80;
  const BH_THETA = 0.7;
  interface QNode {
    cx: number; cy: number; hs: number;        // cell centre + half-size
    m: number; mx: number; my: number;         // total mass + Σ(mass·pos)
    body: number;                              // single-body index, or -1 if internal
    nw: QNode | null; ne: QNode | null; sw: QNode | null; se: QNode | null;
  }
  function qnode(cx: number, cy: number, hs: number): QNode {
    return { cx, cy, hs, m: 0, mx: 0, my: 0, body: -1, nw: null, ne: null, sw: null, se: null };
  }
  function qPlace(node: QNode, k: number, bs: Body[]): void {
    const b = bs[k], half = node.hs / 2;
    const east = b.x >= node.cx, south = b.y >= node.cy;
    let child: QNode;
    if (!east && !south) child = (node.nw ??= qnode(node.cx - half, node.cy - half, half));
    else if (east && !south) child = (node.ne ??= qnode(node.cx + half, node.cy - half, half));
    else if (!east && south) child = (node.sw ??= qnode(node.cx - half, node.cy + half, half));
    else child = (node.se ??= qnode(node.cx + half, node.cy + half, half));
    qInsert(child, k, bs);
  }
  function qInsert(node: QNode, k: number, bs: Body[]): void {
    const b = bs[k], mk = massOf(b);
    if (node.body === -1 && node.m === 0) {       // empty leaf → store body
      node.body = k; node.m = mk; node.mx = b.x * mk; node.my = b.y * mk;
      return;
    }
    node.m += mk; node.mx += b.x * mk; node.my += b.y * mk;
    if (node.hs < 0.25) return;                   // coincident cluster: don't subdivide
    if (node.body >= 0) { const e = node.body; node.body = -1; qPlace(node, e, bs); }
    qPlace(node, k, bs);
  }
  function qAccel(node: QNode | null, k: number, bx: number, by: number, G: number, out: Vec2): void {
    if (!node || node.m === 0) return;
    if (node.body === k) return;                  // self leaf
    const comx = node.mx / node.m, comy = node.my / node.m;
    const dx = comx - bx, dy = comy - by;
    const d2 = dx * dx + dy * dy + 4;             // matches the direct softening
    const d = Math.sqrt(d2);
    if (node.body >= 0 || (node.hs * 2) / d < BH_THETA) {
      const f = (G * node.m) / (d2 * d);          // G·m/d³ → ×(dx,dy) = G·m/d² along r̂
      out[0] += f * dx; out[1] += f * dy;
      return;
    }
    qAccel(node.nw, k, bx, by, G, out);
    qAccel(node.ne, k, bx, by, G, out);
    qAccel(node.sw, k, bx, by, G, out);
    qAccel(node.se, k, bx, by, G, out);
  }
  const bhOut: Vec2 = [0, 0];
  function bhAccel(bs: Body[], idx: number[], ax: Float64Array, ay: Float64Array, G: number): void {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const k of idx) {
      const b = bs[k];
      if (b.x < minx) minx = b.x; if (b.x > maxx) maxx = b.x;
      if (b.y < miny) miny = b.y; if (b.y > maxy) maxy = b.y;
    }
    const root = qnode((minx + maxx) / 2, (miny + maxy) / 2, Math.max(maxx - minx, maxy - miny) / 2 + 1);
    for (const k of idx) qInsert(root, k, bs);
    for (const k of idx) {
      const b = bs[k];
      bhOut[0] = 0; bhOut[1] = 0;
      qAccel(root, k, b.x, b.y, G, bhOut);
      ax[k] = bhOut[0]; ay[k] = bhOut[1];
    }
  }

  // Fill ax/ay with the acceleration on every body in `bs` at its current
  // position. Pass 1 is full N-body among non-moons; pass 2 binds each moon to
  // its parent in the parent's accelerating frame. Pure function of positions —
  // so it can be called twice per leapfrog step and on cloned arrays (prediction).
  function computeAccel(bs: Body[], ax: Float64Array, ay: Float64Array): void {
    const G = BASE_G * GRAV_SCALE;
    const n = bs.length;
    ax.fill(0, 0, n); ay.fill(0, 0, n);
    const idxOf = new Map<number, number>();
    for (let k = 0; k < n; k++) idxOf.set(bs[k].i, k);

    // Pass 1: N-body among the non-moon bodies — exact double loop by default,
    // Barnes-Hut once the count crosses BH_THRESHOLD.
    const big: number[] = [];
    for (let k = 0; k < n; k++) if (!bs[k].isMoon) big.push(k);
    if (big.length > BH_THRESHOLD) {
      bhAccel(bs, big, ax, ay, G);
    } else {
      for (let ai = 0; ai < big.length; ai++) {
        const a = big[ai], A = bs[a], Amass = massOf(A);
        for (let bi = ai + 1; bi < big.length; bi++) {
          const b = big[bi], B = bs[b], Bmass = massOf(B);
          const dx = B.x - A.x, dy = B.y - A.y;
          let d2 = dx * dx + dy * dy;
          d2 += 4;                                  // softening: avoid singularities
          const inv = 1 / Math.sqrt(d2);
          const f = G * inv / d2;                   // = G / d^2 per unit mass
          const fx = f * dx, fy = f * dy;
          ax[a] += fx * Bmass; ay[a] += fy * Bmass;
          ax[b] -= fx * Amass; ay[b] -= fy * Amass;
        }
      }
    }

    // Pass 2: each moon = parent's acceleration + gravity toward the parent.
    for (let k = 0; k < n; k++) {
      const m = bs[k];
      if (!m.isMoon || m.parent === null) continue;
      const pIdx = idxOf.get(m.parent);
      if (pIdx === undefined) continue;           // parent gone (mid-merge)
      const p = bs[pIdx];
      ax[k] = ax[pIdx];                           // carried along the parent's orbit
      ay[k] = ay[pIdx];
      const dx = p.x - m.x, dy = p.y - m.y;
      let d2 = dx * dx + dy * dy;
      d2 += 1;
      const inv = 1 / Math.sqrt(d2);
      const f = G * massOf(p) * inv / d2;         // bound only to the parent body
      ax[k] += f * dx; ay[k] += f * dy;
    }
  }

  // Reused accel scratch buffers (grown as the body count changes).
  let sAx = new Float64Array(0), sAy = new Float64Array(0);

  // Velocity-Verlet / leapfrog (kick–drift–kick): half-kick, full drift,
  // recompute forces, half-kick. Conserves energy far better than Euler, so
  // orbits stay stable over long runs instead of slowly spiralling.
  function step(dt: number): void {
    const n = bodies.length;
    if (sAx.length < n) { sAx = new Float64Array(n); sAy = new Float64Array(n); }
    computeAccel(bodies, sAx, sAy);
    const hd = dt * 0.5;
    for (let k = 0; k < n; k++) { const b = bodies[k]; b.vx += sAx[k] * hd; b.vy += sAy[k] * hd; }
    for (let k = 0; k < n; k++) { const b = bodies[k]; b.x += b.vx * dt; b.y += b.vy * dt; }
    computeAccel(bodies, sAx, sAy);
    for (let k = 0; k < n; k++) { const b = bodies[k]; b.vx += sAx[k] * hd; b.vy += sAy[k] * hd; }
  }

  // ----------------------- Energy diagnostic -----------------------
  // Total mechanical energy of the true N-body subsystem (non-moons). Moons use
  // the hybrid frame model and aren't conservative, so they're excluded — this
  // tracks how well the integrator conserves energy for the planets + Sun.
  let energy0 = 0;
  function totalEnergy(): number {
    const G = BASE_G * GRAV_SCALE;
    const ns = bodies.filter(b => !b.isMoon);
    let ke = 0, pe = 0;
    for (const b of ns) ke += 0.5 * massOf(b) * (b.vx * b.vx + b.vy * b.vy);
    for (let a = 0; a < ns.length; a++) {
      for (let b = a + 1; b < ns.length; b++) {
        const A = ns[a], B = ns[b];
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.sqrt(dx * dx + dy * dy + 4);   // matches the force softening
        pe -= G * massOf(A) * massOf(B) / d;
      }
    }
    return ke + pe;
  }
  function baselineEnergy(): void { energy0 = totalEnergy(); }

  // ---------------------- Trajectory prediction --------------------
  // Integrate a throwaway copy of the whole system forward and return the
  // future path of body `id`. Reuses step() by temporarily pointing the global
  // `bodies` at the clone, so the predicted motion matches the sim exactly.
  function predictPath(id: number, steps: number, dt: number): Vec2[] {
    const saved = sAx, savedY = sAy;          // don't clobber the live scratch
    sAx = new Float64Array(0); sAy = new Float64Array(0);
    const real = bodies;
    bodies = real.map(b => ({ ...b, trail: [] }));
    const target = bodies.find(b => b.i === id);
    const path: Vec2[] = [];
    if (target) {
      for (let s = 0; s < steps; s++) {
        step(dt);
        if (s % 2 === 0) path.push([target.x, target.y]);   // sample every other step
      }
    }
    bodies = real;
    sAx = saved; sAy = savedY;
    return path;
  }

  // ----------------------- Orbital elements ------------------------
  // Osculating 2-body elements of `b` about its parent, from the instantaneous
  // state vector (vis-viva). Returns null when parentless or unbound.
  interface Elements {
    a: number; e: number; rp: number; ra: number; period: number;
    px: number; py: number;          // unit vector toward periapsis
    parent: Body;
  }
  function orbitalElements(b: Body): Elements | null {
    if (b.parent === null) return null;
    const p = bodyById(b.parent);
    if (!p || p === b) return null;
    const mu = BASE_G * GRAV_SCALE * massOf(p);
    if (mu <= 0) return null;
    const rx = b.x - p.x, ry = b.y - p.y;
    const vx = b.vx - p.vx, vy = b.vy - p.vy;
    const r = Math.hypot(rx, ry);
    if (r < 1e-9) return null;
    const v2 = vx * vx + vy * vy;
    const eps = v2 / 2 - mu / r;                 // specific orbital energy
    if (eps >= 0) return null;                   // parabolic / hyperbolic
    const a = -mu / (2 * eps);
    // Eccentricity vector (points at periapsis): e = ((v²−μ/r)·r − (r·v)·v)/μ
    const rv = rx * vx + ry * vy;
    const ex = ((v2 - mu / r) * rx - rv * vx) / mu;
    const ey = ((v2 - mu / r) * ry - rv * vy) / mu;
    const el = Math.hypot(ex, ey);
    const e = Math.min(0.999999, el);
    const ux = el > 1e-6 ? ex / el : rx / r, uy = el > 1e-6 ? ey / el : ry / r;
    return {
      a, e, rp: a * (1 - e), ra: a * (1 + e),
      period: 2 * Math.PI * Math.sqrt(a * a * a / mu),
      px: ux, py: uy, parent: p,
    };
  }

  // Periapsis / apoapsis markers on the selected body's osculating orbit.
  function drawApsides(): void {
    const f = bodyById(selected);
    if (!f || f.parent === null) return;
    const el = orbitalElements(f);
    if (!el || el.e < 0.01) return;              // ~circular: apsides meaningless
    const pts: [number, number, string][] = [
      [el.parent.x + el.px * el.rp, el.parent.y + el.py * el.rp, "peri"],
      [el.parent.x - el.px * el.ra, el.parent.y - el.py * el.ra, "apo"],
    ];
    ctx.save();
    ctx.strokeStyle = "#ffd27a"; ctx.fillStyle = "rgba(255,210,122,0.9)";
    ctx.lineWidth = 1.2;
    ctx.font = "9.5px ui-sans-serif, system-ui"; ctx.textAlign = "center";
    for (const [wx, wy, label] of pts) {
      const [sx, sy] = worldToScreen(wx, wy);
      ctx.beginPath();
      ctx.moveTo(sx, sy - 4); ctx.lineTo(sx + 4, sy);
      ctx.lineTo(sx, sy + 4); ctx.lineTo(sx - 4, sy);
      ctx.closePath(); ctx.stroke();
      ctx.fillText(label, sx, sy - 8);
    }
    ctx.restore();
  }

  // ------------------------ Lagrange points ------------------------
  // L1–L5 of the (parent, selected body) pair, using the standard restricted
  // three-body approximations (Hill radius for L1/L2). Only meaningful when
  // the primary dominates, so the markers hide when m1 < 20·m2.
  function drawLagrange(): void {
    if (!showLagrange) return;
    const b = bodyById(selected);
    if (!b || b.parent === null) return;
    const p = bodyById(b.parent);
    if (!p || p === b) return;
    const m1 = massOf(p), m2 = massOf(b);
    if (m2 <= 0 || m1 < m2 * 20) return;
    const dx = b.x - p.x, dy = b.y - p.y;
    const r = Math.hypot(dx, dy);
    if (r < 1e-6) return;
    const ux = dx / r, uy = dy / r;
    const d = r * Math.cbrt(m2 / (3 * m1));      // Hill-sphere distance
    const l3 = r * (1 + 5 * m2 / (12 * m1));     // slightly outside the mirror orbit
    const cs = 0.5, sn = Math.sqrt(3) / 2;       // ±60° for L4/L5
    const pts: [number, number, string][] = [
      [p.x + ux * (r - d), p.y + uy * (r - d), "L1"],
      [p.x + ux * (r + d), p.y + uy * (r + d), "L2"],
      [p.x - ux * l3, p.y - uy * l3, "L3"],
      [p.x + (ux * cs - uy * sn) * r, p.y + (uy * cs + ux * sn) * r, "L4"],
      [p.x + (ux * cs + uy * sn) * r, p.y + (uy * cs - ux * sn) * r, "L5"],
    ];
    ctx.save();
    ctx.strokeStyle = "rgba(159,209,122,0.9)"; ctx.fillStyle = "rgba(159,209,122,0.9)";
    ctx.lineWidth = 1.2;
    ctx.font = "9.5px ui-sans-serif, system-ui"; ctx.textAlign = "center";
    for (const [wx, wy, label] of pts) {
      const [sx, sy] = worldToScreen(wx, wy);
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy); ctx.lineTo(sx + 4, sy);
      ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4);
      ctx.stroke();
      ctx.fillText(label, sx, sy - 7);
    }
    ctx.restore();
  }

  // ---------------- Kepler's second law visualisation ---------------
  // While enabled, the selected body's parent-relative track is sampled each
  // frame and drawn as radius-vector wedges bucketed by equal sim-time — the
  // wedges all sweep equal areas (short & fat near periapsis, long & thin near
  // apoapsis), which is exactly Kepler's second law.
  let kepId = -1;
  let kepSamples: { x: number; y: number; t: number }[] = [];
  function sampleKepler(): void {
    if (!showKepler || timeDir < 0) { kepSamples.length = 0; kepId = -1; return; }
    const b = bodyById(selected);
    if (!b || b.parent === null) { kepSamples.length = 0; kepId = -1; return; }
    if (b.i !== kepId) { kepSamples.length = 0; kepId = b.i; }
    const p = bodyById(b.parent);
    if (!p) return;
    kepSamples.push({ x: b.x - p.x, y: b.y - p.y, t: simTime });
    const el = orbitalElements(b);
    const span = el ? el.period : 2;             // keep ~one orbit of history
    while (kepSamples.length && kepSamples[0].t < simTime - span) kepSamples.shift();
    if (kepSamples.length > 4000) kepSamples.shift();
  }
  function drawKepler(): void {
    if (!showKepler || kepSamples.length < 3) return;
    const b = bodyById(kepId);
    if (!b || b.parent === null) return;
    const p = bodyById(b.parent);
    if (!p) return;
    const el = orbitalElements(b);
    const interval = (el ? el.period : 2) / 8;   // 8 equal-time wedges per orbit
    if (!(interval > 0)) return;
    ctx.save();
    const [px0, py0] = worldToScreen(p.x, p.y);
    const flush = (from: number, to: number, parity: number): void => {
      if (to - from < 1) return;
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      for (let i = from; i <= to; i++) {
        const [sx, sy] = worldToScreen(p.x + kepSamples[i].x, p.y + kepSamples[i].y);
        ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fillStyle = parity ? "rgba(122,162,255,0.15)" : "rgba(255,210,122,0.15)";
      ctx.fill();
    };
    let bucket = Math.floor(kepSamples[0].t / interval);
    let start = 0;
    for (let i = 1; i < kepSamples.length; i++) {
      const bk = Math.floor(kepSamples[i].t / interval);
      if (bk !== bucket) { flush(start, i, bucket & 1); start = i; bucket = bk; }
    }
    flush(start, kepSamples.length - 1, bucket & 1);
    ctx.restore();
  }

  // ------------------------- Collisions ----------------------------
  // Accretion: when two bodies overlap they merge into one, conserving
  // momentum. The more massive body survives and grows; the other is removed.
  interface Flash { x: number; y: number; age: number; max: number; r: number; }
  const flashes: Flash[] = [];

  function resolveCollisions(): void {
    let merged = false, again = true;
    while (again) {
      again = false;
      for (let a = 0; a < bodies.length && !again; a++) {
        for (let b = a + 1; b < bodies.length; b++) {
          const A = bodies[a], B = bodies[b];
          const dx = B.x - A.x, dy = B.y - A.y;
          const rs = A.radius + B.radius;
          if (dx * dx + dy * dy <= rs * rs) {
            mergeBodies(A, B);
            merged = true; again = true;   // restart: the array changed
            break;
          }
        }
      }
    }
    if (merged) buildFocusList();
  }

  function mergeBodies(A: Body, B: Body): void {
    const survivor = A.mass >= B.mass ? A : B;
    const gone = survivor === A ? B : A;
    const m = A.mass + B.mass;
    survivor.x = (A.mass * A.x + B.mass * B.x) / m;
    survivor.y = (A.mass * A.y + B.mass * B.y) / m;
    survivor.vx = (A.mass * A.vx + B.mass * B.vx) / m;   // momentum conserved
    survivor.vy = (A.mass * A.vy + B.mass * B.vy) / m;
    survivor.radius = Math.cbrt(A.radius ** 3 + B.radius ** 3);  // volume-preserving
    survivor.mass = m;
    // If the survivor orbited the body it absorbed (a moon out-massing its
    // planet), it takes over that body's orbit slot — never itself as parent.
    if (survivor.parent === gone.i) { survivor.parent = gone.parent; survivor.isMoon = gone.isMoon; }
    // Moons of the absorbed body are inherited by the survivor.
    for (const x of bodies) if (x !== survivor && x.parent === gone.i) x.parent = survivor.i;
    bodies.splice(bodies.indexOf(gone), 1);
    if (cam.focus === gone.i) cam.focus = survivor.i;
    if (selected === gone.i) selected = survivor.i;
    flashes.push({ x: survivor.x, y: survivor.y, age: 0, max: 0.5, r: survivor.radius });
    sfxBoom(Math.cbrt(Math.min(gone.radius, survivor.radius)) * 0.9);
  }

  // ------------------------- Tidal disruption ----------------------
  // Roche-style shredding: a non-star body that strays inside a star's tidal
  // zone is torn into a spray of debris (a stylized tidal stream), instead of
  // cleanly merging. Off by default; only triggers very close to a star, so the
  // default system (whose planets never get that close) is untouched.
  function resolveTides(): void {
    const stars = bodies.filter(isStarBody);
    if (!stars.length || bodies.length > 420) return;
    let changed = false;
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      if (isStarBody(b) || b.isMoon || b.mass < 1e-4) continue;
      for (const s of stars) {
        if (massOf(s) < b.mass * 50) continue;        // need a dominant tide-raiser
        const dist = Math.hypot(b.x - s.x, b.y - s.y);
        if (dist > 0 && dist < s.radius * 1.3) { shatter(b, s); changed = true; break; }
      }
    }
    if (changed) buildFocusList();
  }
  function shatter(b: Body, s: Body): void {
    const idx = bodies.indexOf(b);
    if (idx < 0) return;
    bodies.splice(idx, 1);
    if (cam.focus === b.i) cam.focus = s.i;
    if (selected === b.i) selected = s.i;
    flashes.push({ x: b.x, y: b.y, age: 0, max: 0.6, r: b.radius * 2 });
    sfxBoom(1.4);
    const n = Math.min(10, 5 + Math.floor(b.radius));
    const frac = 1 / n;
    const spread = Math.hypot(b.vx, b.vy) * 0.12 + 0.4;
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2;
      bodies.push({
        i: nextId++, name: "Debris", color: lighten(b.color, 0.1),
        distAU: 0, radius: Math.max(0.8, b.radius * Math.cbrt(frac)),
        mass: b.mass * frac, parent: 0, isMoon: false, ecc: 0, extra: true,
        x: b.x + Math.cos(ang) * b.radius, y: b.y + Math.sin(ang) * b.radius,
        vx: b.vx + Math.cos(ang) * spread, vy: b.vy + Math.sin(ang) * spread,
        trail: [],
      });
    }
  }

  // --------------------------- Camera ------------------------------
  const cam = { x: 0, y: 0, focus: 0 };  // world coords at screen center
  let selected = 0;                      // body shown in the info card (id) — independent of camera follow
  let panning = false, panLast: Vec2 | null = null, didDrag = false;
  let followSuspended = false, followTimer: number | null = null;

  // View orientation of the orbital plane (both-buttons drag to change):
  //   viewSpin — yaw about the plane's normal (rotate the top-down map)
  //   viewTilt — pitch toward edge-on; 0 = top-down, ~1.45 ≈ nearly edge-on
  const DEFAULT_TILT = 1.0;  // ~57°: the perspective the scene opens with
  let viewSpin = 0, viewTilt = DEFAULT_TILT;

  // Project a world point: spin in-plane, then foreshorten Y by the tilt.
  function worldToScreen(wx: number, wy: number): Vec2 {
    const dx = wx - cam.x, dy = wy - cam.y;
    const cs = Math.cos(viewSpin), sn = Math.sin(viewSpin);
    const rx = dx * cs - dy * sn;
    const ry = dx * sn + dy * cs;
    return [rx * ZOOM + W / 2, ry * Math.cos(viewTilt) * ZOOM + H / 2];
  }

  // Depth of a world point into the screen (used for painter's-order drawing).
  function depthOf(wx: number, wy: number): number {
    return (wx - cam.x) * Math.sin(viewSpin) + (wy - cam.y) * Math.cos(viewSpin);
  }

  // Inverse of worldToScreen: un-foreshorten Y, then un-spin. Used to turn a
  // pointer position into a world point (drag-to-launch).
  function screenToWorld(sx: number, sy: number): Vec2 {
    const rx = (sx - W / 2) / ZOOM;
    const ry = (sy - H / 2) / ZOOM / Math.cos(viewTilt);
    const cs = Math.cos(viewSpin), sn = Math.sin(viewSpin);
    const dx = rx * cs + ry * sn;       // R(spin)⁻¹ = Rᵀ
    const dy = -rx * sn + ry * cs;
    return [cam.x + dx, cam.y + dy];
  }

  // --------------------------- Stars -------------------------------
  let stars: Star[] = [];
  function makeStars(): void {
    stars = [];
    const count = Math.floor((W * H) / 5500);
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 1.3 + 0.2, a: Math.random() * 0.6 + 0.2,
        tw: Math.random() * Math.PI * 2,
      });
    }
  }
  // Background nebulae (gas clouds) + distant spiral galaxies — animated,
  // screen-space, drawn additively so they glow over the near-black sky.
  interface Nebula { x: number; y: number; r: number; col: [number, number, number]; ph: number; drift: number; }
  interface Galaxy { x: number; y: number; r: number; rotSpeed: number; phase: number; hue: [number, number, number]; }
  let nebulae: Nebula[] = [];
  let galaxies: Galaxy[] = [];

  function makeBackground(): void {
    const clouds: [number, number, number][] =
      [[120, 80, 200], [60, 110, 200], [40, 160, 170], [200, 70, 150], [90, 70, 185]];
    nebulae = [];
    for (let i = 0; i < 5; i++) {
      nebulae.push({
        x: Math.random() * W, y: Math.random() * H, r: 190 + Math.random() * 330,
        col: clouds[i % clouds.length], ph: Math.random() * Math.PI * 2, drift: 16 + Math.random() * 26,
      });
    }
    const hues: [number, number, number][] = [[180, 200, 255], [255, 212, 180], [210, 190, 255]];
    galaxies = [];
    const g = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < g; i++) {
      galaxies.push({
        x: Math.random() * W, y: Math.random() * H, r: 42 + Math.random() * 58,
        rotSpeed: (0.00006 + Math.random() * 0.0002) * (Math.random() < 0.5 ? -1 : 1),
        phase: Math.random() * Math.PI * 2, hue: hues[i % hues.length],
      });
    }
  }

  function drawGalaxy(x: number, y: number, r: number, rot: number, hue: [number, number, number]): void {
    const [hr, hg, hb] = hue;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, 0.5);  // tilt the disk
    const disk = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    disk.addColorStop(0, `rgba(${hr},${hg},${hb},0.16)`);
    disk.addColorStop(0.45, `rgba(${hr},${hg},${hb},0.05)`);
    disk.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
    ctx.fillStyle = disk; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(${hr},${hg},${hb},0.16)`;            // two spiral arms
    for (let arm = 0; arm < 2; arm++) {
      for (let t = 0; t < 1; t += 0.05) {
        const ang = arm * Math.PI + t * 4.4, rr = r * (0.12 + t * 0.9), sz = 1.6 * (1 - t) + 0.4;
        ctx.beginPath(); ctx.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, sz, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
    const core = ctx.createRadialGradient(x, y, 0, x, y, r * 0.42);  // bright round core
    core.addColorStop(0, "rgba(255,255,255,0.5)");
    core.addColorStop(0.4, `rgba(${hr},${hg},${hb},0.22)`);
    core.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, 7); ctx.fill();
  }

  function drawBackground(time: number): void {
    ctx.globalCompositeOperation = "lighter";
    for (const n of nebulae) {
      const cx = n.x + Math.cos(time * 0.00005 + n.ph) * n.drift;
      const cy = n.y + Math.sin(time * 0.00007 + n.ph * 1.3) * n.drift;
      const r = n.r * (0.85 + 0.15 * Math.sin(time * 0.0003 + n.ph));
      const [cr, cg, cb] = n.col;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.10)`);
      grad.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.035)`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    }
    for (const gx of galaxies) drawGalaxy(gx.x, gx.y, gx.r, gx.phase + time * gx.rotSpeed, gx.hue);
    ctx.globalCompositeOperation = "source-over";
  }

  makeStars();
  makeBackground();
  window.addEventListener("resize", () => { makeStars(); makeBackground(); });

  let showTrails = true, showOrbits = false, showLabels = true, showRings = true;
  let showPredict = false;   // draw the selected body's future trajectory
  let showField = false;     // gravitational potential heatmap overlay
  let showVectors = false;   // per-body velocity vectors
  let showBary = false;      // system centre-of-mass marker
  let tides = false;         // tidal (Roche) disruption near stars — off by default
  let showHZ = false;        // habitable ("Goldilocks") zone ring around the star
  let showAxes = false;      // draw each body's spin axis at its real obliquity
  let showLagrange = false;  // L1–L5 markers for the selected body's pair
  let showKepler = false;    // equal-area wedges (Kepler's 2nd law) for the selection
  let sfxOn = true;          // synthesized event sounds (collisions, launches…)

  // Drag-to-aim: arms the comet-launcher ("launch"), the star-dropper ("star")
  // or the black-hole dropper ("hole"). Press + drag on empty space sets the new
  // body's velocity (the drag vector × gain); a plain click drops it at rest.
  let launchMode = false, addStarMode = false, addHoleMode = false;
  let aimKind: "none" | "launch" | "star" | "hole" = "none";
  let launchStartW: Vec2 | null = null;   // aim origin, world coords
  let launchCurS: Vec2 | null = null;     // current pointer, screen coords
  let launchN = 0;
  let STAR_MASS_SCALE = 1;                 // dropped-star mass, in solar masses

  // Ids of runtime-spawned bodies in spawn order — powers Undo (z / button).
  const addedStack: number[] = [];
  function recordAdded(id: number): void { addedStack.push(id); }

  // Decorative particle belts (asteroid belt + Oort cloud). These are visual
  // only — they orbit at the right relative rate but aren't part of the N-body.
  interface Particle { a: number; r: number; w: number; c: string; }
  let belt: Particle[] = [];
  let oort: Particle[] = [];

  // --------------------------- Render ------------------------------
  function lighten(hex: string, amt: number): string {
    const c = hex.replace("#", "");
    if (c.length < 6) return hex;
    let r = parseInt(c.slice(0, 2), 16);
    let g = parseInt(c.slice(2, 4), 16);
    let b = parseInt(c.slice(4, 6), 16);
    r = Math.min(255, r + (255 - r) * amt);
    g = Math.min(255, g + (255 - g) * amt);
    b = Math.min(255, b + (255 - b) * amt);
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  const isComet = (b: Body): boolean => b.extra && b.name.startsWith("Comet");
  // On-screen radius of a body's disk — the single source of truth shared by
  // the renderer and by hit-testing (click / hover / delete), so picking stays
  // accurate at any zoom and in Real-scale mode.
  function screenRadius(b: Body): number {
    const rad = REAL_SCALE
      ? Math.max(1.4, Math.cbrt(b.mass) * 0.6 * ZOOM * 0.1)
      : b.radius * Math.sqrt(ZOOM);
    return Math.min(rad, 70);
  }
  // The original Sun (id 0) plus any runtime-dropped stars: drawn self-lit with
  // a glow, with no night-side terminator.
  const isStarBody = (b: Body): boolean => b.i === 0 || !!b.isStar;

  // Comet tails: a glowing plume pointing directly away from the Sun, longer
  // the closer the comet is (solar wind / sublimation). Purely cosmetic.
  function drawCometTails(): void {
    const sun = bodies[0];
    if (!sun) return;
    ctx.globalCompositeOperation = "lighter";
    for (const b of bodies) {
      if (!isComet(b)) continue;
      const dx = b.x - sun.x, dy = b.y - sun.y;
      const dist = Math.hypot(dx, dy) || 1;
      const distAU = dist / AU;
      const ux = dx / dist, uy = dy / dist;                  // unit vector away from Sun
      const lenWorld = Math.min(3.2 * AU, (1.1 * AU) / Math.max(0.35, distAU - 0.2));
      const [hx, hy] = worldToScreen(b.x, b.y);
      const [tx, ty] = worldToScreen(b.x + ux * lenWorld, b.y + uy * lenWorld);
      const grad = ctx.createLinearGradient(hx, hy, tx, ty);
      grad.addColorStop(0, "rgba(190,235,255,0.55)");
      grad.addColorStop(0.4, "rgba(140,200,255,0.22)");
      grad.addColorStop(1, "rgba(120,170,255,0)");
      ctx.strokeStyle = grad;
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2, b.radius * 1.8 * Math.sqrt(ZOOM));
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
    }
    ctx.lineCap = "butt";
    ctx.globalCompositeOperation = "source-over";
  }

  // Future-path overlay for the selected body. Horizon scales with its orbital
  // period so one sees roughly one orbit ahead (or a long arc when unbound).
  function drawPrediction(): void {
    if (!showPredict) return;
    const f = bodyById(selected);
    if (!f || f.i === 0) return;
    let horizon = 0.8;
    if (f.parent !== null) {
      const p = bodyById(f.parent);
      if (p) {
        const r = Math.hypot(f.x - p.x, f.y - p.y);
        const mu = BASE_G * GRAV_SCALE * massOf(p);
        if (mu > 0 && r > 0) horizon = 2 * Math.PI * Math.sqrt(r * r * r / mu) * 1.15;
      }
    }
    horizon = Math.max(0.1, Math.min(12, horizon));
    const steps = 260;
    const path = predictPath(f.i, steps, horizon / steps);
    if (path.length < 2) return;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = lighten(f.color, 0.35) + "cc";
    ctx.beginPath();
    for (let i = 0; i < path.length; i++) {
      const [sx, sy] = worldToScreen(path[i][0], path[i][1]);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Aim arrow while dragging in launch/star mode: drag length/direction sets the
  // new body's velocity. A live label shows the resulting speed (and, for stars,
  // the mass it'll be dropped with).
  function drawAimArrow(): void {
    if (aimKind === "none" || !launchStartW || !launchCurS) return;
    const [sx, sy] = worldToScreen(launchStartW[0], launchStartW[1]);
    const [ex, ey] = launchCurS;
    const col = aimKind === "star" ? "#ffd9a0" : aimKind === "hole" ? "#8fb8ff" : "#ffd27a";
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    const ang = Math.atan2(ey - sy, ex - sx);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang - 0.4) * 12, ey - Math.sin(ang - 0.4) * 12);
    ctx.lineTo(ex - Math.cos(ang + 0.4) * 12, ey - Math.sin(ang + 0.4) * 12);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill();
    // readout: speed = drag (world) × gain; star also shows its mass
    const p1 = screenToWorld(ex, ey);
    const speed = Math.hypot(p1[0] - launchStartW[0], p1[1] - launchStartW[1]) * LAUNCH_GAIN;
    let label = `${speed.toFixed(0)} u/s`;
    if (aimKind === "star") label += ` · ${fmtMass(333000 * STAR_MASS_SCALE)} M⊕`;
    if (aimKind === "hole") label += ` · ${fmtMass(333000 * STAR_MASS_SCALE * 10)} M⊕`;
    ctx.font = "11px ui-sans-serif, system-ui"; ctx.textAlign = "left";
    ctx.fillStyle = "#0a0c18cc";
    const tw = ctx.measureText(label).width;
    ctx.fillRect(ex + 10, ey - 9, tw + 8, 16);
    ctx.fillStyle = col;
    ctx.fillText(label, ex + 14, ey + 3);
    ctx.restore();
  }

  // Gravitational-potential heatmap. Sampled on a small offscreen grid (summing
  // the well of every massive body) then scaled up smoothly — so adding a star
  // visibly carves a new well and bends the field. Purely diagnostic.
  let fieldCanvas: HTMLCanvasElement | null = null;
  let fieldCtx: CanvasRenderingContext2D | null = null;
  function drawField(): void {
    if (!showField) return;
    const G = BASE_G * GRAV_SCALE;
    const massive = bodies.filter(b => !b.isMoon && (b.isStar || b.i === 0 || b.mass >= 0.3));
    if (!massive.length) return;
    const cols = 96, rows = Math.max(1, Math.round((96 * H) / W));
    if (!fieldCanvas) { fieldCanvas = document.createElement("canvas"); fieldCtx = fieldCanvas.getContext("2d"); }
    if (!fieldCtx) return;
    fieldCanvas.width = cols; fieldCanvas.height = rows;
    const img = fieldCtx.createImageData(cols, rows);
    const data = img.data;
    const phi = new Float64Array(cols * rows);
    let mn = Infinity, mx = -Infinity;
    for (let j = 0; j < rows; j++) {
      const sy = ((j + 0.5) / rows) * H;
      for (let i = 0; i < cols; i++) {
        const sx = ((i + 0.5) / cols) * W;
        const [wx, wy] = screenToWorld(sx, sy);
        let p = 0;
        for (const b of massive) {
          const dx = wx - b.x, dy = wy - b.y;
          p += massOf(b) / Math.sqrt(dx * dx + dy * dy + 64);
        }
        const v = Math.log(1 + p * G * 1e-4);     // compress the enormous range
        phi[j * cols + i] = v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    const span = mx - mn || 1;
    for (let k = 0; k < cols * rows; k++) {
      const t = (phi[k] - mn) / span;             // 0 shallow … 1 deep well
      const o = k * 4;
      data[o] = 40 + t * 150; data[o + 1] = 70 + t * 110; data[o + 2] = 150 + t * 105;
      data[o + 3] = Math.round(t * t * 120);
    }
    fieldCtx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fieldCanvas, 0, 0, W, H);
    ctx.restore();
  }

  // Mass-weighted centre of mass + mean velocity of the N-body subsystem.
  function systemBary(): { x: number; y: number; vx: number; vy: number; m: number } {
    let m = 0, x = 0, y = 0, vx = 0, vy = 0;
    for (const b of bodies) {
      if (b.isMoon) continue;
      const mm = massOf(b);
      m += mm; x += mm * b.x; y += mm * b.y; vx += mm * b.vx; vy += mm * b.vy;
    }
    if (m > 0) { x /= m; y /= m; vx /= m; vy /= m; }
    return { x, y, vx, vy, m };
  }
  function drawBarycenter(): void {
    if (!showBary) return;
    const c = systemBary();
    const [sx, sy] = worldToScreen(c.x, c.y);
    ctx.save();
    ctx.strokeStyle = "#ff7ad9"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx - 9, sy); ctx.lineTo(sx + 9, sy);
    ctx.moveTo(sx, sy - 9); ctx.lineTo(sx, sy + 9);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 7); ctx.stroke();
    ctx.globalAlpha = 0.85; ctx.fillStyle = "#ff7ad9";
    ctx.font = "10px ui-sans-serif, system-ui"; ctx.textAlign = "left";
    ctx.fillText("barycenter", sx + 11, sy + 3);
    ctx.restore();
  }

  // Per-body velocity arrows (direction via the view transform, length ∝ speed).
  function drawVectors(): void {
    if (!showVectors) return;
    ctx.save();
    ctx.strokeStyle = "rgba(120,230,170,0.9)"; ctx.fillStyle = "rgba(120,230,170,0.9)";
    ctx.lineWidth = 1.4;
    for (const b of bodies) {
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < 1e-4) continue;
      const [sx, sy] = worldToScreen(b.x, b.y);
      const [tx, ty] = worldToScreen(b.x + b.vx, b.y + b.vy);
      const ang = Math.atan2(ty - sy, tx - sx);
      const len = Math.min(64, 7 + sp * 0.6);
      const ex = sx + Math.cos(ang) * len, ey = sy + Math.sin(ang) * len;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.4) * 5, ey - Math.sin(ang - 0.4) * 5);
      ctx.lineTo(ex - Math.cos(ang + 0.4) * 5, ey - Math.sin(ang + 0.4) * 5);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // Habitable zone: the orbital band around the central star where a planet
  // could hold liquid water. Inner/outer radii scale with √luminosity (a
  // stylized mass proxy), so a brighter/heavier Sun pushes the band outward.
  function drawHabitableZone(): void {
    if (!showHZ) return;
    const star = bodies[0];
    if (!star || star.parent !== null) return;       // need a central body
    const effMass = star.mass * (star.i === 0 ? SUN_SCALE : 1);
    const lum = Math.sqrt(Math.max(0.05, effMass / 333000));
    const rin = 0.95 * lum * AU, rout = 1.50 * lum * AU;
    ctx.save();
    ctx.beginPath();
    let first = true;
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      const [x, y] = worldToScreen(star.x + Math.cos(a) * rout, star.y + Math.sin(a) * rout);
      first ? (ctx.moveTo(x, y), first = false) : ctx.lineTo(x, y);
    }
    for (let k = 96; k >= 0; k--) {
      const a = (k / 96) * Math.PI * 2;
      const [x, y] = worldToScreen(star.x + Math.cos(a) * rin, star.y + Math.sin(a) * rin);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(90,210,140,0.07)";
    ctx.fill("evenodd");
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(110,230,150,0.22)";
    for (const r of [rin, rout]) {
      ctx.beginPath();
      for (let k = 0; k <= 96; k++) {
        const a = (k / 96) * Math.PI * 2;
        const [x, y] = worldToScreen(star.x + Math.cos(a) * r, star.y + Math.sin(a) * r);
        (k === 0) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(time: number): void {
    ctx.fillStyle = "#05060d";
    ctx.fillRect(0, 0, W, H);

    drawBackground(time);

    // starfield
    for (const st of stars) {
      ctx.globalAlpha = st.a * (0.6 + 0.4 * Math.sin(time * 0.001 + st.tw));
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawField();
    drawHabitableZone();

    // orbit paths (ring around parent at current distance)
    if (showOrbits) {
      ctx.lineWidth = 1;
      for (const b of bodies) {
        if (b.parent === null || b.extra) continue;
        const p = bodyById(b.parent);
        if (!p) continue;
        const dx = b.x - p.x, dy = b.y - p.y;
        const r = Math.sqrt(dx * dx + dy * dy);
        ctx.strokeStyle = b.isMoon ? "rgba(160,170,200,0.10)" : "rgba(140,160,230,0.16)";
        ctx.beginPath();
        const N = 72;
        for (let k = 0; k <= N; k++) {
          const a = (k / N) * Math.PI * 2;
          const [sx, sy] = worldToScreen(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
          if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
    }

    // trails
    if (showTrails) {
      for (const b of bodies) {
        if (b.parent === null || b.trail.length < 2) continue;
        ctx.lineWidth = b.isMoon ? 0.8 : 1.4;
        ctx.beginPath();
        for (let i = 0; i < b.trail.length; i++) {
          const [sx, sy] = worldToScreen(b.trail[i][0], b.trail[i][1]);
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = b.color + "55";
        ctx.stroke();
      }
    }

    drawKepler();
    drawRings();
    drawCometTails();
    drawPrediction();
    drawApsides();
    drawLagrange();

    // bodies, back-to-front so nearer ones overlap farther ones when tilted
    const sunBody = bodyById(0) || bodies[0];
    const order = viewTilt > 0.001
      ? [...bodies].sort((a, b) => depthOf(a.x, a.y) - depthOf(b.x, b.y))
      : bodies;
    for (const b of order) {
      const [sx, sy] = worldToScreen(b.x, b.y);
      const rad = screenRadius(b);

      if (b.isHole) {
        drawBlackHole(sx, sy, rad, time);
        if (showLabels && rad > 1.2) {
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = "#cfd6ef";
          ctx.font = "11.5px ui-sans-serif, system-ui";
          ctx.textAlign = "center";
          ctx.fillText(b.name, sx, sy - rad * 3.6 - 6);
          ctx.globalAlpha = 1;
        }
        continue;
      }

      if (b.i === 0) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * 4.5);
        g.addColorStop(0, "rgba(255,221,120,0.55)");
        g.addColorStop(0.4, "rgba(255,160,40,0.18)");
        g.addColorStop(1, "rgba(255,140,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, rad * 4.5, 0, 7); ctx.fill();
      } else if (b.isStar) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * 4.5);
        g.addColorStop(0, b.color + "99");
        g.addColorStop(0.4, b.color + "33");
        g.addColorStop(1, b.color + "00");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, rad * 4.5, 0, 7); ctx.fill();
      } else {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * 2.2);
        g.addColorStop(0, b.color + "44");
        g.addColorStop(1, b.color + "00");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, rad * 2.2, 0, 7); ctx.fill();
      }

      // body disk, lit from the Sun's direction (so we see phases/terminator)
      let lx = -0.35, ly = -0.35;                      // default light dir (Sun itself)
      if (!isStarBody(b) && sunBody) {
        const [ssx, ssy] = worldToScreen(sunBody.x, sunBody.y);
        const ddx = ssx - sx, ddy = ssy - sy, dl = Math.hypot(ddx, ddy) || 1;
        lx = ddx / dl; ly = ddy / dl;
      }
      const bg = ctx.createRadialGradient(sx + lx * rad * 0.55, sy + ly * rad * 0.55, rad * 0.1, sx, sy, rad);
      bg.addColorStop(0, lighten(b.color, 0.4));
      bg.addColorStop(1, b.color);
      ctx.fillStyle = b.i === 0 ? "#ffd34d" : isStarBody(b) ? lighten(b.color, 0.35) : bg;
      ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 7); ctx.fill();

      // night side: dark crescent on the side facing away from the Sun
      if (!isStarBody(b) && rad > 2.4 && sunBody) {
        ctx.save();
        ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 7); ctx.clip();
        const nx = sx - lx * rad * 0.75, ny = sy - ly * rad * 0.75;
        const sh = ctx.createRadialGradient(nx, ny, rad * 0.15, nx, ny, rad * 1.7);
        sh.addColorStop(0, "rgba(2,3,10,0.80)");
        sh.addColorStop(0.55, "rgba(2,3,10,0.34)");
        sh.addColorStop(1, "rgba(2,3,10,0)");
        ctx.fillStyle = sh;
        ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
        ctx.restore();
      }

      // Saturn ring
      if (b.name === "Saturn") {
        ctx.save();
        ctx.translate(sx, sy); ctx.rotate(-0.5); ctx.scale(1, 0.34);
        ctx.strokeStyle = "rgba(230,207,156,0.55)"; ctx.lineWidth = rad * 0.45;
        ctx.beginPath(); ctx.arc(0, 0, rad * 1.9, 0, 7); ctx.stroke();
        ctx.restore();
      }

      // Spin axis at the body's real obliquity (schematic: tilt is measured from
      // screen-vertical, with a marked north pole). Uranus lies on its side, etc.
      if (showAxes && BODY_TILT[b.name] !== undefined && rad > 1.4) {
        const tilt = BODY_TILT[b.name] * Math.PI / 180;
        const len = rad * 2.1;
        const dx = Math.sin(tilt), dy = -Math.cos(tilt);   // north end direction
        ctx.save();
        ctx.strokeStyle = "rgba(255,236,160,0.8)"; ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(sx - dx * len, sy - dy * len);
        ctx.lineTo(sx + dx * len, sy + dy * len);
        ctx.stroke();
        // north-pole cap
        ctx.fillStyle = "rgba(255,236,160,0.95)";
        ctx.beginPath(); ctx.arc(sx + dx * len, sy + dy * len, 1.8, 0, 7); ctx.fill();
        ctx.restore();
      }

      if (showLabels && (!b.isMoon || ZOOM > 1.6) && rad > 1.2) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#cfd6ef";
        ctx.font = (b.isMoon ? "10px " : "11.5px ") + "ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(b.name, sx, sy - rad - 6);
        ctx.globalAlpha = 1;
      }
    }

    // collision flashes — expanding fading rings
    for (const fl of flashes) {
      const [sx, sy] = worldToScreen(fl.x, fl.y);
      const t = fl.age / fl.max;
      const rad = (fl.r + 6) * (1 + t * 3) * Math.sqrt(ZOOM);
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = "#ffd9a0";
      ctx.lineWidth = 2 * (1 - t) + 0.5;
      ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawVectors();
    drawBarycenter();
    drawAimArrow();
    drawReadout();
    updateDayClock();
  }

  // A dropped black hole: additive accretion disk + photon ring around a
  // pitch-black event horizon (drawn instead of the usual lit planet disk).
  function drawBlackHole(sx: number, sy: number, rad: number, time: number): void {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.globalCompositeOperation = "lighter";
    ctx.save();
    ctx.rotate(time * 0.0005);
    ctx.scale(1, 0.38);                              // tilted accretion disk
    const disk = ctx.createRadialGradient(0, 0, rad * 1.2, 0, 0, rad * 3.6);
    disk.addColorStop(0, "rgba(255,196,110,0.55)");
    disk.addColorStop(0.5, "rgba(190,130,255,0.18)");
    disk.addColorStop(1, "rgba(130,90,255,0)");
    ctx.fillStyle = disk;
    ctx.beginPath(); ctx.arc(0, 0, rad * 3.6, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(255,220,160,0.45)";      // hot inner rim
    ctx.lineWidth = rad * 0.5;
    ctx.beginPath(); ctx.arc(0, 0, rad * 1.7, 0, 7); ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(255,240,200,0.9)";       // photon ring
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, rad * 1.22, 0, 7); ctx.stroke();
    ctx.fillStyle = "#000005";                       // event horizon
    ctx.beginPath(); ctx.arc(0, 0, rad * 1.12, 0, 7); ctx.fill();
    ctx.restore();
  }

  // --------------------------- Readout -----------------------------
  const readoutEl = $("readout");
  const dayEl = $("dayclock");

  function updateDayClock(): void {
    const days = (simTime / EARTH_YEAR_SIM) * 365.25;
    const whole = Math.floor(days).toLocaleString("en-US");
    const yr = days / 365.25;
    dayEl.textContent = yr >= 2 ? `🌍 ${whole} days · ${yr.toFixed(1)} yr` : `🌍 ${whole} days`;
  }
  function fmtMass(m: number): string {
    if (m >= 1000) return (m / 1000).toFixed(0) + "k";
    if (m >= 1) return m.toFixed(m < 10 ? 2 : 0);
    return m.toFixed(3);
  }
  function bodyKind(b: Body): string {
    if (b.isHole) return "Black hole";
    if (isStarBody(b)) return "Star";
    if (b.name === "Debris") return "Debris";
    if (b.extra) return b.name.startsWith("Comet") ? "Comet" : "Probe";
    if (b.isMoon) return "Moon";
    return "Planet";
  }
  // Orbital period in human time. The sim is calibrated so Earth's orbit is one
  // year (EARTH_YEAR_SIM sim-seconds), so we report short orbits in days and
  // long ones in years — same scale as the elapsed-time clock.
  function fmtPeriod(t: number): string {
    const yr = t / EARTH_YEAR_SIM;
    const days = yr * 365.25;
    if (days < 2) return days.toFixed(2) + " d";
    if (yr < 2) return days.toFixed(0) + " d";
    if (yr < 1000) return yr.toFixed(1) + " yr";
    return (yr / 1000).toFixed(1) + "k yr";
  }
  function row(k: string, v: string): string {
    return `<span class="k">${k}</span><b>${v}</b><br>`;
  }

  // Curated real-world blurbs shown in the info card. Keyed by body name for
  // the default system; runtime bodies fall back to a per-kind description.
  const BODY_FACTS: Record<string, string> = {
    "Sun":       "G2V yellow dwarf holding 99.86% of the system's mass. It fuses ~600M tons of hydrogen every second; its surface burns near 5,500 °C.",
    "Mercury":   "The smallest planet and closest to the Sun. With almost no atmosphere it swings from 430 °C by day to −180 °C at night.",
    "Venus":     "The hottest planet — a runaway CO₂ greenhouse traps 465 °C. It spins backwards, so a day lasts longer than its year.",
    "Earth":     "The only known world with liquid-water oceans and life. 71% of its surface is ocean, shepherded by one large Moon.",
    "Moon":      "Earth's only natural satellite. It raises the ocean tides and is slowly drifting away at about 3.8 cm per year.",
    "Mars":      "The Red Planet, rusted by iron-oxide dust. Home to polar ice caps and Olympus Mons, the tallest volcano known.",
    "Phobos":    "Mars's larger moon, orbiting so low it rises in the west. Tides will pull it into Mars within ~50 million years.",
    "Deimos":    "Mars's tiny outer moon — barely 12 km across, most likely a captured asteroid.",
    "Jupiter":   "The giant: 2.5× the mass of every other planet combined. Its Great Red Spot is a storm raging for centuries.",
    "Io":        "The most volcanic body in the Solar System, kneaded and heated by Jupiter's relentless tides.",
    "Europa":    "An icy shell over a salty global ocean — one of the most promising places to search for life.",
    "Ganymede":  "The largest moon in the Solar System — bigger than Mercury, and the only moon with its own magnetic field.",
    "Callisto":  "One of the most heavily cratered worlds known: an ancient surface almost unchanged for billions of years.",
    "Saturn":    "Crowned by a bright ring system of ice and rock. So low in density it would float in water.",
    "Enceladus": "Fires icy geysers from a hidden subsurface ocean through cracks at its south pole.",
    "Dione":     "An icy Saturnian moon laced with bright cliffs of fractured ice.",
    "Rhea":      "Saturn's second-largest moon — a frozen, heavily cratered ball of ice.",
    "Titan":     "Larger than Mercury; the only moon with a thick atmosphere and lakes of liquid methane.",
    "Iapetus":   "The two-toned moon — one hemisphere bright as snow, the other dark as coal.",
    "Uranus":    "An ice giant tipped on its side, rolling around the Sun like a ball.",
    "Neptune":   "The windiest planet: supersonic gales top 2,000 km/h beneath a deep-blue methane sky.",
  };
  const KIND_FACTS: Record<string, string> = {
    "Comet":  "An icy wanderer. Sunlight boils off gas and dust into a glowing tail that always points away from the Sun.",
    "Probe":  "A human-built spacecraft, coasting on momentum across the system.",
    "Star":   "A massive, self-luminous body whose gravity reshapes every orbit around it.",
    "Black hole": "A collapsed star so dense not even light escapes its event horizon. Only its accretion disk betrays it.",
    "Debris": "Fragments flung out by a collision.",
  };
  function bodyFact(b: Body): string {
    return BODY_FACTS[b.name] || KIND_FACTS[bodyKind(b)] || "";
  }

  // Real-world physical stats (not the stylized sim values) shown in the card.
  // dia = equatorial diameter, day = rotation/solar day, temp = mean surface,
  // grav = surface gravity (Earth = 1 g), moons = real satellite count.
  interface BodyData { dia: string; day: string; temp: string; grav: string; moons?: number; }
  const BODY_DATA: Record<string, BodyData> = {
    "Sun":       { dia: "1,392,700 km", day: "25 d",   temp: "5,500 °C",  grav: "28 g" },
    "Mercury":   { dia: "4,879 km",     day: "176 d",  temp: "167 °C",    grav: "0.38 g", moons: 0 },
    "Venus":     { dia: "12,104 km",    day: "243 d",  temp: "464 °C",    grav: "0.90 g", moons: 0 },
    "Earth":     { dia: "12,742 km",    day: "24 h",   temp: "15 °C",     grav: "1 g",    moons: 1 },
    "Moon":      { dia: "3,474 km",     day: "27.3 d", temp: "−20 °C",    grav: "0.17 g" },
    "Mars":      { dia: "6,779 km",     day: "24.6 h", temp: "−63 °C",    grav: "0.38 g", moons: 2 },
    "Phobos":    { dia: "22.5 km",      day: "7.7 h",  temp: "−40 °C",    grav: "0.0006 g" },
    "Deimos":    { dia: "12.4 km",      day: "30.3 h", temp: "−40 °C",    grav: "0.0003 g" },
    "Jupiter":   { dia: "139,820 km",   day: "9.9 h",  temp: "−110 °C",   grav: "2.53 g", moons: 95 },
    "Io":        { dia: "3,643 km",     day: "1.8 d",  temp: "−130 °C",   grav: "0.18 g" },
    "Europa":    { dia: "3,122 km",     day: "3.5 d",  temp: "−160 °C",   grav: "0.13 g" },
    "Ganymede":  { dia: "5,268 km",     day: "7.2 d",  temp: "−160 °C",   grav: "0.15 g" },
    "Callisto":  { dia: "4,821 km",     day: "16.7 d", temp: "−140 °C",   grav: "0.13 g" },
    "Saturn":    { dia: "116,460 km",   day: "10.7 h", temp: "−140 °C",   grav: "1.06 g", moons: 146 },
    "Enceladus": { dia: "504 km",       day: "1.4 d",  temp: "−200 °C",   grav: "0.01 g" },
    "Dione":     { dia: "1,123 km",     day: "2.7 d",  temp: "−186 °C",   grav: "0.02 g" },
    "Rhea":      { dia: "1,527 km",     day: "4.5 d",  temp: "−174 °C",   grav: "0.03 g" },
    "Titan":     { dia: "5,150 km",     day: "16 d",   temp: "−179 °C",   grav: "0.14 g" },
    "Iapetus":   { dia: "1,469 km",     day: "79 d",   temp: "−143 °C",   grav: "0.02 g" },
    "Uranus":    { dia: "50,724 km",    day: "17.2 h", temp: "−195 °C",   grav: "0.89 g", moons: 28 },
    "Neptune":   { dia: "49,244 km",    day: "16 h",   temp: "−200 °C",   grav: "1.14 g", moons: 16 },
  };
  // Axial tilt (obliquity) of the spin axis vs. the orbital plane, in degrees.
  // Venus & Uranus are near-flipped — the sandbox draws each body's axis from
  // this so the famous tilts (Earth's 23°, Uranus on its side) are visible.
  const BODY_TILT: Record<string, number> = {
    "Sun": 7.25, "Mercury": 0.03, "Venus": 177.4, "Earth": 23.4, "Mars": 25.2,
    "Jupiter": 3.1, "Saturn": 26.7, "Uranus": 97.8, "Neptune": 28.3, "Moon": 6.7,
  };

  function drawReadout(): void {
    // No selection (e.g. tapped empty space) — hide the card for an unobstructed
    // view, which matters most on small/mobile screens.
    const f = bodyById(selected);
    if (!f) { readoutEl.style.display = "none"; return; }
    readoutEl.style.display = "";
    const sun = bodies[0];
    const speed = Math.hypot(f.vx, f.vy);

    // mini picture of the body — a shaded disk (with Saturn's ring / star glow)
    const lit = lighten(f.color, 0.45);
    const glow = f.i === 0 ? 24 : 12;
    const ring = f.name === "Saturn" ? `<span class="ring"></span>` : "";
    const astro =
      `<div class="astro" style="background:radial-gradient(circle at 35% 30%, ${lit}, ${f.color});` +
      `box-shadow:0 0 ${glow}px ${f.color}aa;">${ring}</div>`;

    let html = `<div class="head">${astro}<div>` +
      `<div class="name">${f.name}</div><div class="kind">${bodyKind(f)}</div></div></div>`;
    html += row("Mass", `${fmtMass(f.mass)} M⊕`);

    // Real-world physical stats (static reference data for the named body).
    const data = BODY_DATA[f.name];
    if (data) {
      html += row("Diameter", data.dia);
      html += row("Day", data.day);
      html += row("Temp", data.temp);
      html += row("Surface g", data.grav);
    }
    if (BODY_TILT[f.name] !== undefined) html += row("Axial tilt", `${BODY_TILT[f.name]}°`);

    const moons = bodies.filter(b => b.isMoon && b.parent === f.i).length;
    if (data && data.moons !== undefined) html += row("Moons", `${moons} sim · ${data.moons} real`);
    else if (moons > 0) html += row("Moons", String(moons));

    if (sun && f.i !== sun.i) {
      const label = sun.i === 0 ? "To Sun" : `To ${sun.name}`;
      html += row(label, `${(Math.hypot(f.x - sun.x, f.y - sun.y) / AU).toFixed(2)} AU`);
    }
    if (f.parent !== null && f.parent !== 0) {
      const p = bodyById(f.parent);
      if (p) html += row(`To ${p.name}`, `${(Math.hypot(f.x - p.x, f.y - p.y) / AU).toFixed(3)} AU`);
    }

    html += row("Speed", `${speed.toFixed(1)} u/s`);

    if (f.parent !== null) {
      // Live osculating elements — they respond to kicks, edits and fly-bys.
      const el = orbitalElements(f);
      if (el) {
        html += row("Semi-major", `${(el.a / AU).toFixed(2)} AU`);
        html += row("Peri/Apo", `${(el.rp / AU).toFixed(2)} / ${(el.ra / AU).toFixed(2)} AU`);
        html += row("Period", `~${fmtPeriod(el.period)}`);
        html += row("Eccentr.", el.e < 0.005 ? "~circular" : el.e.toFixed(2));
      } else {
        html += row("Orbit", "unbound (escape)");
      }
    }

    // Energy-conservation diagnostic. Changing G / Sun mass / the body set
    // legitimately changes the system's energy, so re-baseline when they do;
    // otherwise the drift reflects the integrator alone.
    if (GRAV_SCALE !== lastG || SUN_SCALE !== lastSun || bodies.length !== lastCount) {
      baselineEnergy();
      lastG = GRAV_SCALE; lastSun = SUN_SCALE; lastCount = bodies.length;
    }
    const e = totalEnergy();
    const drift = energy0 !== 0 ? ((e - energy0) / Math.abs(energy0)) * 100 : 0;
    const dStr = (drift >= 0 ? "+" : "") + drift.toFixed(2) + "%";
    html += row("Energy ΔE", dStr);

    const fact = bodyFact(f);
    if (fact) html += `<div class="sep"></div><div class="fact">${fact}</div>`;

    html += `<div class="sep"></div>`;
    html += `<span class="dim">Bodies ${bodies.length} · G ${GRAV_SCALE.toFixed(2)}× · ${TIME_SCALE.toFixed(2)}×t</span>`;
    readoutEl.innerHTML = html;
  }
  let lastG = 1, lastSun = 1, lastCount = -1;

  // ----------------------------- Loop ------------------------------
  let lastT = performance.now();
  function frame(now: number): void {
    let dt = (now - lastT) / 1000; lastT = now;
    dt = Math.min(dt, 0.05);

    for (let i = flashes.length - 1; i >= 0; i--) {
      flashes[i].age += dt;
      if (flashes[i].age >= flashes[i].max) flashes.splice(i, 1);
    }

    if (!paused && TIME_SCALE > 0) {
      const simDt = dt * TIME_SCALE * timeDir;
      simTime += simDt;
      // Adaptive sub-stepping: the base rate tracks TIME_SCALE, then tightens
      // (up to ×8) near deep wells — close approaches to a star are stiff and
      // need finer steps to stay stable. Never coarser than the base.
      let stiff = 1;
      const starsArr = bodies.filter(isStarBody);
      if (starsArr.length) {
        for (const b of bodies) {
          if (b.isMoon || isStarBody(b)) continue;
          for (const s of starsArr) {
            const d = Math.hypot(b.x - s.x, b.y - s.y);
            if (d > 0) stiff = Math.max(stiff, (s.radius * 6) / d);
          }
        }
      }
      const sub = Math.min(200, Math.ceil(Math.min(40, Math.max(1, Math.ceil(TIME_SCALE))) * Math.min(8, stiff)));
      const h = simDt / sub;
      for (let s = 0; s < sub; s++) step(h);

      advanceRings(simDt);
      // Collisions & tides are irreversible — suspend them while rewinding.
      if (tides && timeDir > 0) resolveTides();
      if (collisions && timeDir > 0) resolveCollisions();
      checkPerihelion();
      sampleKepler();

      for (const b of bodies) {
        if (b.parent === null) continue;
        b.trail.push([b.x, b.y]);
        const max = b.isMoon ? 60 : 240;
        if (b.trail.length > max) b.trail.shift();
      }
    }

    syncEditor();
    updateMission();

    // follow focus (unless the user is actively panning the view)
    const f = bodyById(cam.focus);
    if (f && !followSuspended) {
      cam.x += (f.x - cam.x) * 0.12;
      cam.y += (f.y - cam.y) * 0.12;
    }

    draw(now);
    requestAnimationFrame(frame);
  }

  // --------------------------- Controls ----------------------------
  function $<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }

  function bindRange(
    id: string, valId: string,
    fn: (v: number) => number,
    fmt: (out: number, raw: number) => string,
  ): void {
    const el = $<HTMLInputElement>(id), v = $(valId);
    const update = (): void => {
      const out = fn(+el.value);
      if (v && fmt) v.textContent = fmt(out, +el.value);
    };
    el.addEventListener("input", update); update();
  }

  bindRange("s_speed", "v_speed", v => (TIME_SCALE = v / 100), o => o.toFixed(2) + "×");
  bindRange("s_grav",  "v_grav",  v => (GRAV_SCALE = v / 100), o => o.toFixed(2) + "×");
  bindRange("s_sun",   "v_sun",   v => (SUN_SCALE  = v / 100), o => o.toFixed(2) + "×");
  bindRange("s_zoom",  "v_zoom",  v => (ZOOM       = v / 100), o => o.toFixed(2) + "×");
  bindRange("s_starmass", "v_starmass", v => (STAR_MASS_SCALE = v / 100), o => o.toFixed(2) + " M☉");

  $<HTMLInputElement>("t_trails").addEventListener("change", e => showTrails = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_orbits").addEventListener("change", e => showOrbits = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_labels").addEventListener("change", e => showLabels = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_realscale").addEventListener("change", e => REAL_SCALE = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_collide").addEventListener("change", e => collisions = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_rings").addEventListener("change", e => showRings = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_predict").addEventListener("change", e => showPredict = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_field").addEventListener("change", e => showField = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_vectors").addEventListener("change", e => showVectors = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_bary").addEventListener("change", e => showBary = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_tides").addEventListener("change", e => tides = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_hz").addEventListener("change", e => showHZ = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_axes").addEventListener("change", e => showAxes = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_lagrange").addEventListener("change", e => showLagrange = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_kepler").addEventListener("change", e => showKepler = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_sfx").addEventListener("change", e => sfxOn = (e.target as HTMLInputElement).checked);

  const pauseBtn = $<HTMLButtonElement>("b_pause");
  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "▶ Play" : "⏸ Pause";
    pauseBtn.classList.toggle("active", paused);
  });

  // Reset everything to first-load defaults: physics sliders, view toggles,
  // camera orientation, pause state, focus, and the bodies themselves.
  function setRange(id: string, value: number): void {
    const s = $<HTMLInputElement>(id);
    s.value = String(value);
    s.dispatchEvent(new Event("input"));   // drives the bound scale + label
  }
  function setToggle(id: string, on: boolean): void {
    const c = $<HTMLInputElement>(id);
    c.checked = on;
    c.dispatchEvent(new Event("change"));  // drives the show* flag
  }
  // Reset all the dashboard controls (sliders, toggles, view, pause) to defaults.
  function resetControls(): void {
    setRange("s_speed", 2);    // 0.02×
    setRange("s_grav", 100);   // 1.00×
    setRange("s_sun", 100);    // 1.00×
    setRange("s_zoom", 100);   // 1.00×
    setRange("s_starmass", 60);// 0.60 M☉
    setToggle("t_trails", true);
    setToggle("t_orbits", false);
    setToggle("t_labels", true);
    setToggle("t_realscale", false);
    setToggle("t_collide", true);
    setToggle("t_rings", true);
    setToggle("t_predict", false);
    setToggle("t_field", false);
    setToggle("t_vectors", false);
    setToggle("t_bary", false);
    setToggle("t_tides", false);
    setToggle("t_hz", false);
    setToggle("t_axes", false);
    setToggle("t_lagrange", false);
    setToggle("t_kepler", false);
    setToggle("t_sfx", true);
    setLaunchMode(false);
    setAddStarMode(false);
    setAddHoleMode(false);
    timeDir = 1;
    rewindBtn.classList.remove("active");
    viewSpin = 0; viewTilt = DEFAULT_TILT; // default perspective
    if (paused) pauseBtn.click();         // resume if paused
    followSuspended = false;
  }
  function resetDefaults(): void {
    endMission(null);
    resetControls();
    flashes.length = 0;
    cam.focus = 0; selected = 0; simTime = 0;
    // Drop any share-state hash so a reload after Reset boots the defaults,
    // not the previously shared system.
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    makeBodies();
    buildFocusList();
  }
  $("b_reset").addEventListener("click", resetDefaults);

  // Experiments
  $("b_zerog").addEventListener("click", () => {
    const s = $<HTMLInputElement>("s_grav");
    s.value = "0"; s.dispatchEvent(new Event("input"));
  });
  $("b_kick").addEventListener("click", () => {
    // Random impulse scaled to each body's orbital speed about its parent, so
    // the kick is always a meaningful fraction (orbits turn eccentric/chaotic).
    for (const b of bodies) {
      if (b.parent === null) continue;
      const p = bodyById(b.parent);
      const rvx = b.vx - (p ? p.vx : 0), rvy = b.vy - (p ? p.vy : 0);
      const orbitalSpeed = Math.hypot(rvx, rvy);
      const a = Math.random() * Math.PI * 2;
      const m = orbitalSpeed * (0.15 + Math.random() * 0.35);  // 15–50% of orbital speed
      b.vx += Math.cos(a) * m; b.vy += Math.sin(a) * m;
    }
  });
  let cometN = 0;
  $("b_comet").addEventListener("click", () => {
    // Aim at the actual central star (which may have drifted off the origin,
    // or not be id 0 anymore after mergers) instead of the world origin.
    const sun = bodyById(0) ?? bodies.find(isStarBody) ?? bodies[0];
    if (!sun) return;
    cometN++;
    const ang = Math.random() * Math.PI * 2;
    const r = 5.5 * AU;
    const x = sun.x + Math.cos(ang) * r, y = sun.y + Math.sin(ang) * r;
    const toSun = Math.atan2(sun.y - y, sun.x - x) + (Math.random() - 0.5) * 0.8;
    const mu = BASE_G * massOf(sun);
    const v = Math.sqrt(mu / r) * 1.05 * Math.sqrt(Math.max(0.2, GRAV_SCALE));
    const id = nextId++;
    bodies.push({
      i: id, name: "Comet " + cometN, color: "#9fe8ff",
      distAU: 5.5, radius: 2.2, mass: 0.0001, parent: sun.i, isMoon: false, ecc: 0,
      x, y, vx: sun.vx + Math.cos(toSun) * v, vy: sun.vy + Math.sin(toSun) * v, trail: [], extra: true,
    });
    recordAdded(id);
    buildFocusList();
  });
  $("b_random").addEventListener("click", () => { resetControls(); makeRandomSystem(); });
  // Launch a probe from Earth on a prograde escape trajectory (full N-body, so
  // it can gain gravity assists from the planets it passes).
  $("b_voyager").addEventListener("click", () => {
    const earth = bodies.find(b => b.name === "Earth");
    if (!earth) return;                       // e.g. in a random system there is no Earth
    const sp = Math.hypot(earth.vx, earth.vy) || 1;
    const off = earth.radius + 8;             // start just ahead of Earth to avoid merging
    const id = nextId++;
    bodies.push({
      i: id, name: "Voyager 1", color: "#e8eef7",
      distAU: Math.hypot(earth.x, earth.y) / AU, radius: 1.6, mass: 0.00001,
      parent: 0, isMoon: false, ecc: 0, extra: true,
      x: earth.x + (earth.vx / sp) * off, y: earth.y + (earth.vy / sp) * off,
      vx: earth.vx * 1.5, vy: earth.vy * 1.5,  // prograde boost → heliocentric escape
      trail: [],
    });
    selected = id;                            // show the probe's card
    recordAdded(id);
    buildFocusList();
  });
  $("b_undo").addEventListener("click", undoLast);

  // ---- Time rewind ----
  // The leapfrog integrator is time-symmetric, so stepping with a negative dt
  // literally replays history backwards. Irreversible events (collisions,
  // tides) are suspended while rewinding.
  const rewindBtn = $<HTMLButtonElement>("b_rewind");
  rewindBtn.addEventListener("click", () => {
    timeDir = -timeDir;
    rewindBtn.classList.toggle("active", timeDir < 0);
    showToast(timeDir < 0 ? "⏪ Time reversed" : "▶ Time forward");
  });

  // ------------------------- Mission mode --------------------------
  // Gravity golf: a probe leaves Earth toward a random target planet with a
  // limited fuel budget. Arrow keys / WASD fire impulses relative to the
  // probe's velocity: ↑ prograde, ↓ retrograde, ←/→ lateral.
  const missionEl = $("mission");
  const missionBtn = $<HTMLButtonElement>("b_mission");
  let missionOn = false, missionProbe = -1, missionTarget = -1, missionFuel = 0;
  const MISSION_FUEL = 100, THRUST_COST = 4, THRUST_DV = 40;
  const MISSION_TARGETS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

  function startMission(): void {
    resetDefaults();                    // fresh, known solar system
    const earth = bodies.find(b => b.name === "Earth");
    const candidates = bodies.filter(b => MISSION_TARGETS.includes(b.name));
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    if (!earth || !target) return;
    const sp = Math.hypot(earth.vx, earth.vy) || 1;
    const off = earth.radius + 8;
    const id = nextId++;
    bodies.push({
      i: id, name: "Pilot 1", color: "#9effd0",
      distAU: Math.hypot(earth.x, earth.y) / AU, radius: 1.8, mass: 0.00001,
      parent: 0, isMoon: false, ecc: 0, extra: true,
      x: earth.x + (earth.vx / sp) * off, y: earth.y + (earth.vy / sp) * off,
      vx: earth.vx * 1.12, vy: earth.vy * 1.12,   // gentle prograde boost, still bound
      trail: [],
    });
    recordAdded(id);
    buildFocusList();
    missionOn = true; missionProbe = id; missionTarget = target.i; missionFuel = MISSION_FUEL;
    cam.focus = id; selected = id;
    selFocus.value = String(id);
    missionBtn.classList.add("active");
    missionBtn.textContent = "🚀 Abort";
    setRange("s_speed", 4);             // brisk but steerable
    setToggle("t_predict", true);       // show where you're headed
    sfxBlip(700);
    showToast(`🚀 Mission: reach ${target.name}! Thrust with ←↑↓→ / WASD`);
  }
  function endMission(msg: string | null, win = false): void {
    if (!missionOn) return;
    missionOn = false; missionProbe = -1; missionTarget = -1;
    missionEl.style.display = "none";
    missionBtn.classList.remove("active");
    missionBtn.textContent = "🚀 Mission";
    if (msg) { showToast(msg); sfxChime(win); }
  }
  missionBtn.addEventListener("click", () => {
    if (missionOn) endMission("Mission aborted");
    else startMission();
  });

  function missionThrust(dir: "pro" | "retro" | "left" | "right"): void {
    if (!missionOn || missionFuel < THRUST_COST) return;
    const probe = bodyById(missionProbe);
    if (!probe) return;
    const sp = Math.hypot(probe.vx, probe.vy) || 1;
    let ux = probe.vx / sp, uy = probe.vy / sp;
    if (dir === "retro") { ux = -ux; uy = -uy; }
    else if (dir === "left") { const t = ux; ux = uy; uy = -t; }
    else if (dir === "right") { const t = ux; ux = -uy; uy = t; }
    probe.vx += ux * THRUST_DV; probe.vy += uy * THRUST_DV;
    missionFuel -= THRUST_COST;
    sfxBlip(440);
  }
  function updateMission(): void {
    if (!missionOn) return;
    const probe = bodyById(missionProbe), target = bodyById(missionTarget);
    if (!probe || !target) { endMission("💥 Probe destroyed — mission failed"); return; }
    const d = Math.hypot(probe.x - target.x, probe.y - target.y);
    if (d < Math.max(10, target.radius * 2.5)) {
      endMission(`🏁 ${target.name} reached — mission accomplished!`, true);
      return;
    }
    const sun = bodyById(0);
    if (sun && Math.hypot(probe.x - sun.x, probe.y - sun.y) > 9 * AU) {
      endMission("🌌 Probe lost to deep space — mission failed");
      return;
    }
    missionEl.style.display = "block";
    const fuelPct = Math.max(0, (missionFuel / MISSION_FUEL) * 100);
    missionEl.innerHTML =
      `🎯 ${target.name} · ${(d / AU).toFixed(2)} AU ` +
      `<span class="fuel"><i style="width:${fuelPct}%"></i></span>` +
      `⛽ ${missionFuel} · ←↑↓→`;
  }

  // ---- Scenario presets ----
  // Pre-built systems that show off the N-body deformation. Each wipes the world
  // and seeds a fresh configuration with physically sensible orbital speeds.
  function clearWorld(): void {
    endMission(null);
    bodies = []; nextId = 0; flashes.length = 0; addedStack.length = 0;
    belt = []; oort = []; simTime = 0; followSuspended = false;
  }
  function mkStar(x: number, y: number, vx: number, vy: number,
                  mass: number, color: string, name: string): Body {
    const b: Body = {
      i: nextId++, name, color, distAU: 0, radius: Math.max(10, Math.min(34, Math.cbrt(mass) * 0.34)),
      mass, parent: null, isMoon: false, ecc: 0, x, y, vx, vy, trail: [], extra: false, isStar: true,
    };
    bodies.push(b);
    return b;
  }
  function afterPreset(): void {
    cam.focus = 0; selected = 0; simTime = 0;
    baselineEnergy(); buildFocusList();
  }
  function presetBinary(): void {
    clearWorld();
    const G = BASE_G * GRAV_SCALE;
    const m1 = 333000 * 0.7, m2 = 333000 * 0.5, sep = 2.4 * AU, M = m1 + m2;
    const vrel = Math.sqrt(G * M / sep);
    mkStar(-sep * m2 / M, 0, 0, -vrel * m2 / M, m1, "#ffcf4d", "Alpha");
    mkStar(sep * m1 / M, 0, 0, vrel * m1 / M, m2, "#ffb36b", "Beta");
    const alpha = bodies[0];
    bodies.push(spawnOrbiter(alpha, 0.45, 4.5, 1, "#6fb1ff", "Alpha b", false, 0.02));
    bodies.push(spawnOrbiter(alpha, 0.72, 5.5, 2, "#e06a4a", "Alpha c", false, 0.04));
    afterPreset();
  }
  function presetCircumbinary(): void {
    clearWorld();
    const G = BASE_G * GRAV_SCALE;
    const m1 = 333000 * 0.6, m2 = 333000 * 0.55, sep = 0.7 * AU, M = m1 + m2;
    const vrel = Math.sqrt(G * M / sep);
    mkStar(-sep * m2 / M, 0, 0, -vrel * m2 / M, m1, "#ffd9a0", "Primary");
    mkStar(sep * m1 / M, 0, 0, vrel * m1 / M, m2, "#ffb36b", "Secondary");
    // Planets orbit the *pair* at large radius (treat both as a point at centre).
    for (const [R, col, nm, e] of [[2.6, "#6fb1ff", "Tatooine", 0], [3.5, "#8fe0e0", "Far b", 0.05]] as
         [number, string, string, number][]) {
      const r = R * AU, ang = Math.random() * Math.PI * 2;
      const v = Math.sqrt(G * M / r);
      bodies.push({
        i: nextId++, name: nm, color: col, distAU: R, radius: 5, mass: 1.5,
        parent: 0, isMoon: false, ecc: e, extra: false, trail: [],
        x: Math.cos(ang) * r, y: Math.sin(ang) * r,
        vx: Math.sin(ang) * -v, vy: Math.cos(ang) * v,
      });
    }
    afterPreset();
  }
  function presetCapture(): void {
    resetControls();
    makeBodies();
    // An intruder star sweeps in from the lower-left on a fast, deep pass through
    // the inner system. Speed is sized to orbital speeds here (~10³ u/s) and aimed
    // with an offset so it whips past rather than diving dead-centre.
    const x0 = -6 * AU, y0 = -4 * AU, aimx = 1.4 * AU, aimy = 0.6 * AU;
    const dx = aimx - x0, dy = aimy - y0, dl = Math.hypot(dx, dy);
    const mu = BASE_G * GRAV_SCALE * 333000 * SUN_SCALE;
    const speed = Math.sqrt(2 * mu / Math.hypot(x0, y0)) * 0.95;   // just sub-escape
    starN++;
    const id = nextId++;
    bodies.push({
      i: id, name: "Star " + starN, color: "#ff9d6b", distAU: 6, radius: 24,
      mass: 333000 * 0.8, parent: null, isMoon: false, ecc: 0, extra: true, isStar: true,
      x: x0, y: y0, vx: (dx / dl) * speed, vy: (dy / dl) * speed, trail: [],
    });
    recordAdded(id);
    afterPreset();
  }
  function presetChaos(): void {
    clearWorld();
    const n = 5, G = BASE_G * GRAV_SCALE, Mtot = 333000 * 0.5 * n;
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2, r = (1.3 + Math.random() * 0.7) * AU;
      // ~70% of the local circular speed (tangential) + a small random kick:
      // bound enough to stay a cluster, hot enough to scatter chaotically.
      const vc = Math.sqrt(G * (Mtot * 0.5) / r) * 0.7;
      const jitter = () => (Math.random() - 0.5) * vc * 0.4;
      mkStar(Math.cos(ang) * r, Math.sin(ang) * r,
        Math.sin(ang) * -vc + jitter(), Math.cos(ang) * vc + jitter(),
        333000 * (0.3 + Math.random() * 0.5), STAR_COLORS[k % STAR_COLORS.length], "Star " + (k + 1));
    }
    afterPreset();
  }
  // A compact red-dwarf system: seven small rocky worlds packed inside what
  // would be Mercury's orbit, echoing the real TRAPPIST-1 (three in the HZ).
  function presetTrappist(): void {
    clearWorld();
    const star = mkStar(0, 0, 0, 0, 333000 * 0.09, "#ff6b4d", "TRAPPIST-1");
    // Colors must be 6-digit hex — the renderer appends an alpha channel
    // (e.g. color + "44"), which is invalid on 3-digit shorthand.
    const planets: [number, number, string, string][] = [
      [0.30, 4.6, "#cc9999", "TRAPPIST-1 b"], [0.40, 4.4, "#ccbb88", "TRAPPIST-1 c"],
      [0.52, 4.2, "#99ccff", "TRAPPIST-1 d"], [0.66, 4.6, "#6fb1ff", "TRAPPIST-1 e"],
      [0.80, 4.8, "#88ffdd", "TRAPPIST-1 f"], [0.96, 4.6, "#77eecc", "TRAPPIST-1 g"],
      [1.14, 4.0, "#aaccdd", "TRAPPIST-1 h"],
    ];
    for (const [R, rad, col, nm] of planets) {
      bodies.push(spawnOrbiter(star, R, rad, 0.6 + Math.random() * 0.6, col, nm, false, 0.01));
    }
    afterPreset();
    setToggle("t_hz", true);   // the packed HZ is the whole point — show it
  }
  // The familiar Solar System, then a swarm of comets falling in from the Oort
  // cloud on near-parabolic plunges — tails flare as they round the Sun.
  function presetCometShower(): void {
    resetControls();
    makeBodies();
    const mu = BASE_G * bodies[0].mass * SUN_SCALE;
    for (let n = 0; n < 14; n++) {
      cometN++;
      const ang = Math.random() * Math.PI * 2;
      const r = (5.0 + Math.random() * 2.5) * AU;
      const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
      const toSun = Math.atan2(-y, -x) + (Math.random() - 0.5) * 0.6;
      const v = Math.sqrt(mu / r) * (0.95 + Math.random() * 0.2) * Math.sqrt(Math.max(0.2, GRAV_SCALE));
      const id = nextId++;
      bodies.push({
        i: id, name: "Comet " + cometN, color: "#9fe8ff",
        distAU: r / AU, radius: 2.2, mass: 0.0001, parent: 0, isMoon: false, ecc: 0,
        x, y, vx: Math.cos(toSun) * v, vy: Math.sin(toSun) * v, trail: [], extra: true,
      });
      recordAdded(id);
    }
    afterPreset();
  }
  const presets: Record<string, () => void> = {
    binary: presetBinary, circumbinary: presetCircumbinary,
    capture: presetCapture, chaos: presetChaos,
    trappist: presetTrappist, comets: presetCometShower,
  };
  const selPreset = $<HTMLSelectElement>("sel_preset");
  selPreset.addEventListener("change", () => {
    const fn = presets[selPreset.value];
    if (fn) { fn(); showToast("✨ " + selPreset.options[selPreset.selectedIndex].text); }
    selPreset.value = "";   // snap back to the placeholder
  });

  // ---- Drag-to-launch ----
  const launchBtn = $<HTMLButtonElement>("b_launch");
  function setLaunchMode(on: boolean): void {
    launchMode = on;
    if (on) { setAddStarMode(false); setAddHoleMode(false); }  // modes are exclusive
    aimKind = "none"; launchStartW = null; launchCurS = null;
    launchBtn.classList.toggle("active", on);
    launchBtn.textContent = on ? "🎯 Aiming…" : "🎯 Aim & launch";
    canvas.style.cursor = on ? "crosshair" : "";
  }
  launchBtn.addEventListener("click", () => setLaunchMode(!launchMode));

  // Spawn a body at world point `p0` with velocity = drag vector × gain. A
  // longer drag → faster body. Spawned as a small icy comet so it gets a tail.
  function launchBody(p0: Vec2, p1World: Vec2): void {
    const vx = (p1World[0] - p0[0]) * LAUNCH_GAIN;
    const vy = (p1World[1] - p0[1]) * LAUNCH_GAIN;
    launchN++;
    const id = nextId++;
    bodies.push({
      i: id, name: "Comet L" + launchN, color: "#9fe8ff",
      distAU: Math.hypot(p0[0], p0[1]) / AU, radius: 2.4, mass: 0.02,
      parent: 0, isMoon: false, ecc: 0, extra: true,
      x: p0[0], y: p0[1], vx, vy, trail: [],
    });
    selected = id;
    recordAdded(id);
    buildFocusList();
    sfxBlip(520);
  }
  const LAUNCH_GAIN = 22;   // world-units of speed per world-unit of drag

  // ---- Add-star (click to drop, or drag to fling a fly-by star) ----
  // A star is a free N-body body (no parent), so every planet and the Sun feel
  // its gravity and the whole system visibly bends around it. Click = drop it at
  // rest; drag = give it a velocity (a fly-by that whips past and tugs a tidal
  // stream behind it). Mass is set by the Star mass slider.
  const addStarBtn = $<HTMLButtonElement>("b_addstar");
  function setAddStarMode(on: boolean): void {
    addStarMode = on;
    if (on) { setLaunchMode(false); setAddHoleMode(false); }   // modes are exclusive
    aimKind = "none"; launchStartW = null; launchCurS = null;
    addStarBtn.classList.toggle("active", on);
    addStarBtn.textContent = on ? "☀️ Click / drag…" : "☀️ Add star";
    canvas.style.cursor = on ? "crosshair" : "";
  }
  addStarBtn.addEventListener("click", () => setAddStarMode(!addStarMode));

  const STAR_COLORS = ["#ffcf4d", "#ffd9a0", "#ffb36b", "#ff9d6b", "#cfe3ff", "#ffe9b0"];
  let starN = 0;
  // Drop a star at world point `p0`. If `p1World` differs, its velocity is the
  // drag vector × gain (a fly-by); otherwise it's stationary. Mass comes from the
  // Star mass slider (in solar masses).
  function placeStar(p0: Vec2, p1World: Vec2 = p0): void {
    starN++;
    const mass = 333000 * STAR_MASS_SCALE;
    const radius = Math.max(12, Math.min(34, Math.cbrt(mass) * 0.34));
    const color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
    const id = nextId++;
    bodies.push({
      i: id, name: "Star " + starN, color, distAU: Math.hypot(p0[0], p0[1]) / AU,
      radius, mass, parent: null, isMoon: false, ecc: 0, extra: true, isStar: true,
      x: p0[0], y: p0[1],
      vx: (p1World[0] - p0[0]) * LAUNCH_GAIN, vy: (p1World[1] - p0[1]) * LAUNCH_GAIN,
      trail: [],
    });
    selected = id;
    recordAdded(id);
    buildFocusList();
    sfxBlip(330);
    showToast("☀️ Star added — watch the orbits bend");
  }

  // ---- Black hole (click to drop, or drag to fling — like Add star) ----
  // 10× the Star-mass slider, tiny radius, no light: a compact monster that
  // whips everything around it (and shreds what strays close when Tides is on).
  const holeBtn = $<HTMLButtonElement>("b_hole");
  function setAddHoleMode(on: boolean): void {
    addHoleMode = on;
    if (on) { setLaunchMode(false); setAddStarMode(false); }
    aimKind = "none"; launchStartW = null; launchCurS = null;
    holeBtn.classList.toggle("active", on);
    holeBtn.textContent = on ? "🕳️ Click / drag…" : "🕳️ Black hole";
    canvas.style.cursor = on ? "crosshair" : "";
  }
  holeBtn.addEventListener("click", () => setAddHoleMode(!addHoleMode));

  let holeN = 0;
  function placeHole(p0: Vec2, p1World: Vec2 = p0): void {
    holeN++;
    const mass = 333000 * STAR_MASS_SCALE * 10;
    const id = nextId++;
    bodies.push({
      i: id, name: "Black hole " + holeN, color: "#8fb8ff",
      distAU: Math.hypot(p0[0], p0[1]) / AU, radius: 7, mass,
      parent: null, isMoon: false, ecc: 0, extra: true, isStar: true, isHole: true,
      x: p0[0], y: p0[1],
      vx: (p1World[0] - p0[0]) * LAUNCH_GAIN, vy: (p1World[1] - p0[1]) * LAUNCH_GAIN,
      trail: [],
    });
    selected = id;
    recordAdded(id);
    buildFocusList();
    sfxBlip(180);
    showToast("🕳️ Black hole dropped — nothing escapes");
  }

  // ------------------------- Sound effects -------------------------
  // Short synthesized cues (no asset files): collision boom, launch blip,
  // comet-perihelion whoosh, mission chimes. They ride the shared ambient
  // AudioContext, so they stay silent until the first user gesture creates it
  // (autoplay policy) and can be muted with the "Sound FX" toggle.
  function sfxCtx(): AudioContext | null {
    return sfxOn && audioCtx && audioCtx.state === "running" ? audioCtx : null;
  }
  function sfxBoom(size = 1): void {
    const ctx = sfxCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.5 + 0.3 * Math.min(2, size);
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    noise.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, now);
    lp.frequency.exponentialRampToValueAtTime(90, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.45, 0.16 * size), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(lp).connect(g).connect(ctx.destination);
    const thump = ctx.createOscillator(); thump.type = "sine";
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(38, now + 0.4);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(Math.min(0.35, 0.14 * size), now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    thump.connect(tg).connect(ctx.destination);
    noise.start(now); thump.start(now); thump.stop(now + 0.6);
  }
  function sfxBlip(freq = 660): void {
    const ctx = sfxCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = "triangle";
    o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, now + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(now); o.stop(now + 0.3);
  }
  function sfxWhoosh(): void {
    const ctx = sfxCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 1.6), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(2400, now + 0.7);
    bp.frequency.exponentialRampToValueAtTime(240, now + 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.06, now + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    noise.connect(bp).connect(g).connect(ctx.destination);
    noise.start(now);
  }
  function sfxChime(win: boolean): void {
    const ctx = sfxCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const notes = win ? [523.25, 659.25, 783.99, 1046.5] : [392, 311.13, 233.08];
    notes.forEach((f, k) => {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + k * 0.12);
      g.gain.linearRampToValueAtTime(0.12, now + k * 0.12 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + k * 0.12 + 1.2);
      o.connect(g).connect(ctx.destination);
      o.start(now + k * 0.12); o.stop(now + k * 0.12 + 1.3);
    });
  }
  // Comet-perihelion detector: when a comet's Sun-relative radial velocity
  // flips from inbound to outbound close to the star, it just rounded
  // perihelion — cue the whoosh (its tail is at maximum right then).
  const periRv = new Map<number, number>();
  function checkPerihelion(): void {
    const sun = bodyById(0) ?? bodies.find(isStarBody);
    if (!sun) return;
    for (const b of bodies) {
      if (!isComet(b)) continue;
      const rv = (b.x - sun.x) * (b.vx - sun.vx) + (b.y - sun.y) * (b.vy - sun.vy);
      const prev = periRv.get(b.i);
      if (prev !== undefined && prev < 0 && rv >= 0 &&
          Math.hypot(b.x - sun.x, b.y - sun.y) < 1.4 * AU) sfxWhoosh();
      periRv.set(b.i, rv);
    }
  }

  // --------------------- Ambient audio (generative) ----------------
  // Zen / deep-space ambience synthesised live with the Web Audio API — no asset
  // files, in keeping with the two-file build. A slow detuned saw drone runs
  // through a gently swept low-pass into a synthesised reverb, with soft
  // pentatonic tones drifting in at random. Started on the button (a user
  // gesture, as autoplay policies require).
  let audioCtx: AudioContext | null = null;
  let musicOn = false;
  let musicGain: GainNode | null = null;
  let voices: AudioScheduledSourceNode[] = [];
  let musicNodes: AudioNode[] = [];   // graph nodes to disconnect on stop
  let noteTimer: number | null = null;

  function buildReverb(ctx: AudioContext): ConvolverNode {
    const len = Math.floor(ctx.sampleRate * 3.2);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const c = ctx.createConvolver(); c.buffer = buf;
    return c;
  }

  function startMusic(): void {
    if (musicOn) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx;
    void ctx.resume();
    musicOn = true;

    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    const reverb = buildReverb(ctx);
    const wet = ctx.createGain(); wet.gain.value = 0.7;
    const dry = ctx.createGain(); dry.gain.value = 0.5;
    musicGain.connect(dry).connect(ctx.destination);
    musicGain.connect(reverb); reverb.connect(wet); wet.connect(ctx.destination);
    musicNodes = [musicGain, dry, reverb, wet];
    musicGain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 5);   // slow swell in

    // Drone: root + fifth + octave, detuned, through a slowly swept low-pass.
    const root = 110; // A2
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass";
    filt.frequency.value = 460; filt.Q.value = 1.2; filt.connect(musicGain);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 200;
    lfo.connect(lfoGain); lfoGain.connect(filt.frequency); lfo.start();
    voices = [lfo];
    const partials: [number, number, number][] = [[1, -5, 0.4], [1.5, 4, 0.22], [2, 7, 0.13], [1, 8, 0.3]];
    for (const [mult, det, g] of partials) {
      const o = ctx.createOscillator(); o.type = "sawtooth";
      o.frequency.value = root * mult; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og); og.connect(filt); o.start();
      voices.push(o);
    }

    // Drifting tones — A-minor pentatonic across a couple of octaves.
    const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];
    const pluck = (): void => {
      if (!musicOn || !audioCtx) return;
      const now = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = "sine";
      o.frequency.value = scale[Math.floor(Math.random() * scale.length)];
      const g = ctx.createGain(); g.gain.value = 0.0001;
      g.gain.linearRampToValueAtTime(0.1, now + 1.6);                   // slow attack
      g.gain.exponentialRampToValueAtTime(0.0008, now + 6);            // long release
      o.connect(g);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      g.connect(pan); pan.connect(reverb); pan.connect(dry);
      o.start(now); o.stop(now + 6.3);
      noteTimer = window.setTimeout(pluck, 3500 + Math.random() * 5500);
    };
    noteTimer = window.setTimeout(pluck, 1800);
  }

  function stopMusic(): void {
    if (!musicOn || !audioCtx || !musicGain) return;
    musicOn = false;
    const ctx = audioCtx;
    if (noteTimer !== null) { clearTimeout(noteTimer); noteTimer = null; }
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);   // fade out
    const dying = voices; voices = [];
    const graph = musicNodes; musicNodes = [];
    window.setTimeout(() => {
      for (const v of dying) { try { v.stop(); } catch { /* already stopped */ } }
      // Tear the graph down so repeated on/off toggles don't pile up reverbs
      // and filters that stay connected to the destination forever.
      for (const n of graph) { try { n.disconnect(); } catch { /* detached */ } }
    }, 1700);
  }

  const musicBtn = $<HTMLButtonElement>("b_music");
  let musicWanted = true;                 // on by default…
  musicBtn.classList.add("active");
  musicBtn.addEventListener("click", () => {
    if (musicOn) { musicWanted = false; stopMusic(); musicBtn.classList.remove("active"); }
    else { musicWanted = true; startMusic(); musicBtn.classList.add("active"); showToast("🎵 Ambient space — on"); }
  });
  // …but autoplay policies require a user gesture, so start on the first
  // interaction anywhere (other than the button, which manages itself).
  function firstGesture(e: Event): void {
    const t = e.target as HTMLElement | null;
    if (t && t.closest && t.closest("#b_music")) return;
    if (musicWanted && !musicOn) startMusic();
    if (musicOn) {
      window.removeEventListener("pointerdown", firstGesture);
      window.removeEventListener("keydown", firstGesture);
    }
  }
  window.addEventListener("pointerdown", firstGesture);
  window.addEventListener("keydown", firstGesture);

  // ---- Serialize / restore the full simulation state ----
  // One payload format shared by the URL-hash share link, the localStorage
  // save slots, and JSON export/import.
  function buildStatePayload(): unknown {
    return {
      v: 1,
      sc: [TIME_SCALE, GRAV_SCALE, SUN_SCALE, ZOOM, STAR_MASS_SCALE],
      vw: [+viewSpin.toFixed(3), +viewTilt.toFixed(3)],
      tg: [showTrails, showOrbits, showLabels, REAL_SCALE, collisions, showRings, showPredict,
           showField, showVectors, showBary, tides, showHZ, showAxes, showLagrange, showKepler],
      t: +simTime.toFixed(2),
      f: cam.focus,
      b: bodies.map(b => [
        b.i, b.name, b.color, +b.distAU.toFixed(3), +b.radius.toFixed(2), b.mass,
        b.parent, b.isMoon ? 1 : 0, b.extra ? 1 : 0,
        +b.x.toFixed(2), +b.y.toFixed(2), +b.vx.toFixed(3), +b.vy.toFixed(3),
        b.isStar ? 1 : 0, +b.ecc.toFixed(3), b.isHole ? 1 : 0,
      ]),
    };
  }

  $("b_share").addEventListener("click", () => {
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(buildStatePayload()))));
    const url = location.origin + location.pathname + "#s=" + code;
    location.hash = "s=" + code;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => showToast("🔗 Link copied to clipboard"),
        () => showToast("🔗 Link in address bar"));
    } else {
      showToast("🔗 Link in address bar");
    }
  });

  // Rebuild the full simulation state from a payload (share hash, save slot,
  // or imported JSON). Returns false when the payload isn't valid.
  function applyStatePayload(p: any): boolean {
    if (!p || p.v !== 1 || !Array.isArray(p.b) || !Array.isArray(p.sc) || !Array.isArray(p.vw)) return false;
    endMission(null);
    bodies = p.b.map((r: any[]): Body => ({
      i: r[0], name: r[1], color: r[2], distAU: r[3], radius: r[4], mass: r[5],
      parent: r[6], isMoon: !!r[7], extra: !!r[8], ecc: r[14] ?? 0,
      x: r[9], y: r[10], vx: r[11], vy: r[12], trail: [],
      isStar: !!r[13], isHole: !!r[15],
    }));
    nextId = bodies.reduce((mx, b) => Math.max(mx, b.i), -1) + 1;
    addedStack.length = 0;   // stale ids from the previous world could collide
    flashes.length = 0;
    setRange("s_speed", Math.round(p.sc[0] * 100));
    setRange("s_grav", Math.round(p.sc[1] * 100));
    setRange("s_sun", Math.round(p.sc[2] * 100));
    setRange("s_zoom", Math.round(p.sc[3] * 100));
    if (p.sc[4] != null) setRange("s_starmass", Math.round(p.sc[4] * 100));
    viewSpin = p.vw[0]; viewTilt = p.vw[1];
    const t = p.tg || [];
    setToggle("t_trails", !!t[0]); setToggle("t_orbits", !!t[1]);
    setToggle("t_labels", !!t[2]); setToggle("t_realscale", !!t[3]);
    setToggle("t_collide", !!t[4]); setToggle("t_rings", !!t[5]);
    setToggle("t_predict", !!t[6]);
    setToggle("t_field", !!t[7]); setToggle("t_vectors", !!t[8]);
    setToggle("t_bary", !!t[9]); setToggle("t_tides", !!t[10]);
    setToggle("t_hz", !!t[11]); setToggle("t_axes", !!t[12]);
    setToggle("t_lagrange", !!t[13]); setToggle("t_kepler", !!t[14]);
    simTime = p.t || 0;
    cam.focus = p.f ?? 0; selected = cam.focus;
    followSuspended = false;
    // Belts only make sense for a Sun-like central system; recreate if present.
    if (bodies.some(b => b.name === "Earth") || bodies.some(b => b.name === "Jupiter")) makeRings();
    else { belt = []; oort = []; }
    baselineEnergy();
    buildFocusList();
    return true;
  }
  function restoreFromHash(): boolean {
    const m = location.hash.match(/s=([^&]+)/);
    if (!m) return false;
    try {
      return applyStatePayload(JSON.parse(decodeURIComponent(escape(atob(m[1])))));
    } catch { return false; }
  }

  // ---- Local save slots + JSON export/import ----
  const slotKey = (n: string): string => "orbital.save." + n;
  const curSlot = (): string => $<HTMLSelectElement>("sel_slot").value;
  $("b_save").addEventListener("click", () => {
    try {
      localStorage.setItem(slotKey(curSlot()), JSON.stringify(buildStatePayload()));
      showToast("💾 Saved to slot " + curSlot());
    } catch { showToast("⚠️ Could not save (storage unavailable)"); }
  });
  $("b_load").addEventListener("click", () => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(slotKey(curSlot())); } catch { /* blocked */ }
    if (!raw) { showToast("Slot " + curSlot() + " is empty"); return; }
    try {
      if (applyStatePayload(JSON.parse(raw))) showToast("📂 Loaded slot " + curSlot());
      else showToast("⚠️ Slot " + curSlot() + " is corrupted");
    } catch { showToast("⚠️ Slot " + curSlot() + " is corrupted"); }
  });
  $("b_export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(buildStatePayload())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "orbital-system.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast("⬇ System exported as JSON");
  });
  const importInput = $<HTMLInputElement>("f_import");
  $("b_import").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = "";              // allow re-importing the same file
    if (!file) return;
    file.text().then(txt => {
      try {
        if (applyStatePayload(JSON.parse(txt))) showToast("⬆ System imported");
        else showToast("⚠️ Not a valid Orbital save");
      } catch { showToast("⚠️ Not a valid Orbital save"); }
    });
  });

  // Lightweight transient toast (reuses styling defined in styles.css).
  let toastTimer: number | null = null;
  function showToast(msg: string): void {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove("show"), 1800);
  }

  // Focus dropdown
  const selFocus = $<HTMLSelectElement>("sel_focus");
  function buildFocusList(): void {
    selFocus.innerHTML = "";
    for (const b of bodies) {
      const o = document.createElement("option");
      o.value = String(b.i); o.textContent = (b.isMoon ? "  ↳ " : "") + b.name;
      selFocus.appendChild(o);
    }
    selFocus.value = String(cam.focus);
  }
  selFocus.addEventListener("change", e => {
    cam.focus = +(e.target as HTMLSelectElement).value;
    selected = cam.focus;     // also show the followed body's card
    followSuspended = false;  // re-enable following when a focus is chosen
  });

  // ------------------------- Body editor ---------------------------
  // Live multipliers applied to the currently selected body. The baseline
  // (and the slider positions) rebase whenever the selection changes, so each
  // slider always reads "× the value it had when you selected this body".
  const eMass = $<HTMLInputElement>("e_mass");
  const eRadius = $<HTMLInputElement>("e_radius");
  const eSpeed = $<HTMLInputElement>("e_speed");
  const vEMass = $("v_emass"), vERadius = $("v_eradius"), vESpeed = $("v_espeed");
  let editId: number | null = null;
  let editBase = { mass: 1, radius: 1, speed: 0 };
  function syncEditor(): void {
    if (editId === selected) return;
    editId = selected;
    const b = bodyById(selected);
    for (const el of [eMass, eRadius, eSpeed]) el.disabled = !b;
    eMass.value = "0"; eRadius.value = "100"; eSpeed.value = "100";
    const neutral = b ? "×1.00" : "—";
    vEMass.textContent = vERadius.textContent = vESpeed.textContent = neutral;
    if (b) {
      const p = b.parent !== null ? bodyById(b.parent) : undefined;
      const rvx = b.vx - (p ? p.vx : 0), rvy = b.vy - (p ? p.vy : 0);
      editBase = { mass: b.mass, radius: b.radius, speed: Math.hypot(rvx, rvy) };
    }
  }
  eMass.addEventListener("input", () => {
    const b = bodyById(selected); if (!b) return;
    const k = Math.pow(10, +eMass.value / 10);          // ×0.1 … ×10, log scale
    b.mass = editBase.mass * k;
    vEMass.textContent = "×" + (k >= 3 ? k.toFixed(1) : k.toFixed(2));
    baselineEnergy();                                    // mass edits change E legitimately
  });
  eRadius.addEventListener("input", () => {
    const b = bodyById(selected); if (!b) return;
    const k = +eRadius.value / 100;
    b.radius = editBase.radius * k;
    vERadius.textContent = "×" + k.toFixed(2);
  });
  eSpeed.addEventListener("input", () => {
    const b = bodyById(selected); if (!b) return;
    const k = +eSpeed.value / 100;
    const p = b.parent !== null ? bodyById(b.parent) : undefined;
    const pvx = p ? p.vx : 0, pvy = p ? p.vy : 0;
    const rvx = b.vx - pvx, rvy = b.vy - pvy;
    const cur = Math.hypot(rvx, rvy);
    const target = editBase.speed * k;                   // keep direction, scale magnitude
    if (cur > 1e-9) { b.vx = pvx + (rvx / cur) * target; b.vy = pvy + (rvy / cur) * target; }
    vESpeed.textContent = "×" + k.toFixed(2);
    baselineEnergy();
  });

  // Menu starts folded (class set in markup). ☰ unfolds, × folds, and a
  // pointer-press anywhere outside the menu auto-folds it.
  $("toggleDash").addEventListener("click", () => $("dash").classList.remove("collapsed"));
  $("closeDash").addEventListener("click", () => $("dash").classList.add("collapsed"));
  document.addEventListener("pointerdown", e => {
    const dash = $("dash");
    if (dash.classList.contains("collapsed")) return;     // already folded
    const target = e.target as Node;
    if (dash.contains(target) || $("toggleDash").contains(target)) return;  // inside menu / open button
    dash.classList.add("collapsed");
  });
  document.addEventListener("keydown", e => {
    // With a button/select/slider focused, Space must keep its native meaning
    // (activate the control) — otherwise it would both pause AND re-trigger it.
    const tag = (e.target as HTMLElement | null)?.tagName;
    const onControl = tag === "BUTTON" || tag === "SELECT" || tag === "INPUT";
    // Arrows/WASD only clash with fields whose value they'd change — a focused
    // button (e.g. the just-clicked Mission button) shouldn't block thrusters.
    const onField = tag === "SELECT" || tag === "INPUT";
    if (missionOn && !onField) {            // mission thrusters
      const k = e.key;
      if (k === "ArrowUp" || k === "w") { e.preventDefault(); missionThrust("pro"); }
      else if (k === "ArrowDown" || k === "s") { e.preventDefault(); missionThrust("retro"); }
      else if (k === "ArrowLeft" || k === "a") { e.preventDefault(); missionThrust("left"); }
      else if (k === "ArrowRight" || k === "d") { e.preventDefault(); missionThrust("right"); }
    }
    if (e.key === "h") $("dash").classList.toggle("collapsed");
    if (e.key === "0") { viewSpin = 0; viewTilt = DEFAULT_TILT; }  // reset view
    if (e.key === " " && !onControl) { e.preventDefault(); pauseBtn.click(); }
    if (e.key === "z" || e.key === "Z") undoLast();
    if (e.key === "Escape") {
      if (launchMode) setLaunchMode(false);
      if (addStarMode) setAddStarMode(false);
      if (addHoleMode) setAddHoleMode(false);
    }
  });

  // ----------------------------- Mouse -----------------------------
  canvas.addEventListener("mousedown", e => {
    // Left-press in an aim mode (launch/star) begins aiming a new body. A plain
    // click (no drag) drops it at rest; dragging sets its velocity.
    if ((launchMode || addStarMode || addHoleMode) && e.button === 0) {
      aimKind = launchMode ? "launch" : addStarMode ? "star" : "hole";
      launchStartW = screenToWorld(e.clientX, e.clientY);
      launchCurS = [e.clientX, e.clientY];
      panLast = null; panning = false;
      return;
    }
    panning = true; didDrag = false; panLast = [e.clientX, e.clientY];
  });
  // Keep the right mouse button usable for rotation instead of a context menu.
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  window.addEventListener("mouseup", e => {
    if (aimKind !== "none" && launchStartW && e.button === 0) {
      const p1 = screenToWorld(e.clientX, e.clientY);
      if (aimKind === "launch") launchBody(launchStartW, p1);
      else if (aimKind === "star") placeStar(launchStartW, p1);
      else placeHole(launchStartW, p1);
      aimKind = "none"; launchStartW = null; launchCurS = null;
      return;
    }
    if (e.button === 2) {                       // right-click (no drag) removes a body
      if (!didDrag) deleteBodyAt(e.clientX, e.clientY);
      panning = false; return;
    }
    if (panning && !didDrag) pickBody(e.clientX, e.clientY);
    panning = false;
  });
  window.addEventListener("mousemove", e => {
    if (aimKind !== "none") { launchCurS = [e.clientX, e.clientY]; return; }
    hoverTip(e.clientX, e.clientY);
    const last = panLast;
    if (!last) return;
    const dx = e.clientX - last[0], dy = e.clientY - last[1];

    // Both buttons held → rotate the orbital plane (spin = yaw, tilt = pitch).
    if ((e.buttons & 3) === 3) {
      viewSpin += dx * 0.005;
      viewTilt = Math.max(0, Math.min(1.45, viewTilt + dy * 0.005));
      if (Math.abs(dx) + Math.abs(dy) > 1) didDrag = true;
      panLast = [e.clientX, e.clientY];
      return;
    }

    // Left button held → pan. Convert the screen delta back through the
    // current tilt + spin so dragging tracks the view at any orientation.
    if (!panning || !(e.buttons & 1)) return;
    if (Math.abs(dx) + Math.abs(dy) > 3) didDrag = true;
    const sdx = dx, sdy = dy / Math.cos(viewTilt);
    const cs = Math.cos(viewSpin), sn = Math.sin(viewSpin);
    cam.x -= (sdx * cs + sdy * sn) / ZOOM;
    cam.y -= (-sdx * sn + sdy * cs) / ZOOM;
    followSuspended = true;
    if (followTimer !== null) clearTimeout(followTimer);
    followTimer = window.setTimeout(() => (followSuspended = false), 1200);
    panLast = [e.clientX, e.clientY];
  });

  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    zoomAt(ZOOM * factor, e.clientX, e.clientY);
  }, { passive: false });

  function setZoom(z: number): void {
    ZOOM = Math.max(0.2, Math.min(4, z));
    const s = $<HTMLInputElement>("s_zoom");
    s.value = String(Math.round(ZOOM * 100));
    s.dispatchEvent(new Event("input"));
  }

  // Zoom keeping the world point under (sx, sy) fixed — except while the camera
  // is actively following a body, where keeping the body centered feels better.
  function zoomAt(z: number, sx: number, sy: number): void {
    const following = !followSuspended && !!bodyById(cam.focus);
    const before = screenToWorld(sx, sy);
    setZoom(z);
    if (following) return;
    const after = screenToWorld(sx, sy);
    cam.x += before[0] - after[0];
    cam.y += before[1] - after[1];
  }

  // ----------------------------- Touch -----------------------------
  // 1 finger  → pan (tap = focus a body); in an armed aim mode → drag to aim
  // 2 fingers → pinch to zoom + drag to tilt (vertical) / spin (horizontal)
  let touchMode: "none" | "pan" | "gesture" | "aim" = "none";
  let touchLast: Vec2 | null = null;   // last finger / two-finger midpoint
  let tapStart: Vec2 | null = null;
  let touchMoved = false;
  let pinchDist = 0;

  function midpoint(t: TouchList): Vec2 {
    return [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
  }
  function spread(t: TouchList): number {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }

  canvas.addEventListener("touchstart", e => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      // Armed launch/star mode: the finger aims exactly like the mouse does —
      // drag sets the velocity, a plain tap drops the body at rest.
      if (launchMode || addStarMode || addHoleMode) {
        touchMode = "aim";
        aimKind = launchMode ? "launch" : addStarMode ? "star" : "hole";
        launchStartW = screenToWorld(x, y);
        launchCurS = [x, y];
        touchLast = [x, y]; tapStart = null; touchMoved = false;
        return;
      }
      touchMode = "pan"; touchMoved = false;
      touchLast = [x, y];
      tapStart = touchLast;
    } else if (e.touches.length >= 2) {
      if (touchMode === "aim") {           // second finger cancels the aim
        aimKind = "none"; launchStartW = null; launchCurS = null;
      }
      touchMode = "gesture"; touchMoved = true;
      touchLast = midpoint(e.touches);
      pinchDist = spread(e.touches);
    }
  }, { passive: false });

  canvas.addEventListener("touchmove", e => {
    e.preventDefault();
    if (touchMode === "aim" && e.touches.length === 1 && aimKind !== "none") {
      launchCurS = [e.touches[0].clientX, e.touches[0].clientY];
      return;
    }
    const last = touchLast;
    if (!last) return;

    if (touchMode === "pan" && e.touches.length === 1) {
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      const dx = x - last[0], dy = y - last[1];
      if (Math.abs(dx) + Math.abs(dy) > 6) touchMoved = true;
      const sdx = dx, sdy = dy / Math.cos(viewTilt);
      const cs = Math.cos(viewSpin), sn = Math.sin(viewSpin);
      cam.x -= (sdx * cs + sdy * sn) / ZOOM;
      cam.y -= (-sdx * sn + sdy * cs) / ZOOM;
      followSuspended = true;
      if (followTimer !== null) clearTimeout(followTimer);
      followTimer = window.setTimeout(() => (followSuspended = false), 1200);
      touchLast = [x, y];
    } else if (touchMode === "gesture" && e.touches.length >= 2) {
      const mid = midpoint(e.touches), dist = spread(e.touches);
      if (pinchDist > 0) zoomAt(ZOOM * (dist / pinchDist), mid[0], mid[1]);
      pinchDist = dist;
      const dmx = mid[0] - last[0], dmy = mid[1] - last[1];
      viewSpin += dmx * 0.005;
      viewTilt = Math.max(0, Math.min(1.45, viewTilt + dmy * 0.005));
      touchLast = mid;
    }
  }, { passive: false });

  canvas.addEventListener("touchend", e => {
    if (touchMode === "aim" && aimKind !== "none" && launchStartW && launchCurS) {
      const p1 = screenToWorld(launchCurS[0], launchCurS[1]);
      if (aimKind === "launch") launchBody(launchStartW, p1);
      else if (aimKind === "star") placeStar(launchStartW, p1);
      else placeHole(launchStartW, p1);
      aimKind = "none"; launchStartW = null; launchCurS = null;
    } else if (touchMode === "pan" && !touchMoved && tapStart) {
      pickBody(tapStart[0], tapStart[1]);
    }
    if (e.touches.length === 0) { touchMode = "none"; touchLast = null; }
    else if (e.touches.length === 1) {
      touchMode = "pan"; touchMoved = true;  // continuing after a gesture isn't a tap
      touchLast = [e.touches[0].clientX, e.touches[0].clientY];
    }
  }, { passive: false });

  // Clicking/tapping a body only shows its info card; it does NOT move/follow
  // the camera. Use the Focus dropdown to make the camera follow a body.
  function pickBody(sx: number, sy: number): void {
    let best = -1, bestD = 24;
    for (const b of bodies) {
      const [bx, by] = worldToScreen(b.x, b.y);
      const d = Math.hypot(bx - sx, by - sy);
      const rad = screenRadius(b) + 8;
      if (d < Math.max(bestD, rad)) { bestD = d; best = b.i; }
    }
    selected = best;   // best === -1 when the click missed every body: hides the card
  }

  // Remove a body from the sim. Its children are freed (re-parented to the Sun's
  // frame as full N-body bodies) so nothing is left orbiting a ghost.
  function removeBody(b: Body): void {
    for (const x of bodies) if (x.parent === b.i) { x.parent = null; x.isMoon = false; }
    const bi = bodies.indexOf(b);
    if (bi >= 0) bodies.splice(bi, 1);
    const ai = addedStack.lastIndexOf(b.i);
    if (ai >= 0) addedStack.splice(ai, 1);
    if (cam.focus === b.i) cam.focus = bodies[0] ? bodies[0].i : 0;
    if (selected === b.i) selected = cam.focus;
    flashes.push({ x: b.x, y: b.y, age: 0, max: 0.4, r: b.radius });
    buildFocusList();
  }
  // Right-click / right-tap a body to delete it.
  function deleteBodyAt(sx: number, sy: number): void {
    let best: Body | null = null, bestD = 26;
    for (const b of bodies) {
      const [bx, by] = worldToScreen(b.x, b.y);
      const d = Math.hypot(bx - sx, by - sy);
      const rad = screenRadius(b) + 8;
      if (d < Math.max(bestD, rad)) { bestD = d; best = b; }
    }
    if (best) { const n = best.name; removeBody(best); showToast("✕ Removed " + n); }
  }
  // Undo: remove the most recently spawned body still present.
  function undoLast(): void {
    while (addedStack.length) {
      const b = bodyById(addedStack[addedStack.length - 1]);
      if (b) { removeBody(b); showToast("↶ Undid " + b.name); return; }
      addedStack.pop();   // stale id (already merged/removed) — discard and retry
    }
    showToast("Nothing to undo");
  }

  const tip = $("tip");
  function hoverTip(sx: number, sy: number): void {
    let found: Body | null = null;
    for (const b of bodies) {
      const [bx, by] = worldToScreen(b.x, b.y);
      const rad = screenRadius(b) + 7;
      if (Math.hypot(bx - sx, by - sy) < Math.max(10, rad)) { found = b; break; }
    }
    if (found) {
      tip.style.display = "block";
      tip.style.left = sx + "px"; tip.style.top = sy + "px";
      const sp = Math.hypot(found.vx, found.vy).toFixed(1);
      tip.innerHTML = `<b>${found.name}</b> · ${fmtMass(found.mass)} M⊕ · ${sp} u/s`;
    } else {
      tip.style.display = "none";
    }
  }

  // ----------------------------- Boot ------------------------------
  if (!restoreFromHash()) {
    makeBodies();
    buildFocusList();
    cam.focus = 0;
    selected = 0;
  }
  requestAnimationFrame(frame);
})();
