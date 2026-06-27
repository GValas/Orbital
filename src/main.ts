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
    x: number; y: number;
    vx: number; vy: number;
    trail: Vec2[];
    extra: boolean;        // true for runtime-spawned bodies (comets)
  }

  interface Star { x: number; y: number; r: number; a: number; tw: number; }

  // [name, color, distAU, radiusPx, massEarth, parentIndex, isMoon]
  type BodyDef = [string, string, number, number, number, number | null, boolean];

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

  // Moons are listed immediately after their parent planet; `parent` is the
  // 0-based index of another row, so order matters (a parent must precede its
  // moons). Moon orbital distances are spread for visibility, not to scale.
  const DEFS: BodyDef[] = [
    ["Sun",       "#ffcf4d",  0.00, 26,  333000, null, false],  // 0
    ["Mercury",   "#b9a08a",  0.55,  3.0,   0.055, 0, false],   // 1
    ["Venus",     "#e8c27a",  0.80,  5.4,   0.815, 0, false],   // 2
    ["Earth",     "#6fb1ff",  1.10,  5.7,   1.000, 0, false],   // 3
    ["Moon",      "#cfd3da",  0.16,  2.0,   0.012,   3, true ],
    ["Mars",      "#e06a4a",  1.45,  4.2,   0.107, 0, false],   // 5
    ["Phobos",    "#9a8d80",  0.10,  1.2,   0.000002, 5, true ],
    ["Deimos",    "#a89a88",  0.15,  1.1,   0.000002, 5, true ],
    ["Jupiter",   "#d8a878",  2.30, 15.0, 317.8,   0, false],   // 8
    ["Io",        "#e8e07a",  0.30,  1.9,   0.015,   8, true ],
    ["Europa",    "#cdbfa0",  0.40,  1.7,   0.008,   8, true ],
    ["Ganymede",  "#b7a98f",  0.52,  2.3,   0.025,   8, true ],
    ["Callisto",  "#8d8378",  0.64,  2.2,   0.018,   8, true ],
    ["Saturn",    "#e6cf9c",  3.10, 12.5,  95.2,    0, false],  // 13
    ["Enceladus", "#eef4ff",  0.30,  1.3,   0.00002, 13, true ],
    ["Dione",     "#cdd2da",  0.36,  1.4,   0.0002,  13, true ],
    ["Rhea",      "#cfd0d4",  0.44,  1.6,   0.0004,  13, true ],
    ["Titan",     "#c8a85a",  0.55,  2.0,   0.022,   13, true ],
    ["Iapetus",   "#b8a890",  0.72,  1.6,   0.0003,  13, true ],
    ["Uranus",    "#8fe0e0",  3.85,  9.0,  14.5,    0, false],  // 19
    ["Neptune",   "#5a78e0",  4.55,  8.7,  17.1,    0, false],  // 20
  ];

  let bodies: Body[] = [];
  let nextId = 0;                         // stable id source for new bodies
  const bodyById = (id: number): Body | undefined => bodies.find(b => b.i === id);
  let GRAV_SCALE = 1, TIME_SCALE = 1, SUN_SCALE = 1, ZOOM = 1;
  let REAL_SCALE = false;
  let paused = false;
  let collisions = true;                  // merge bodies on contact

  function makeBodies(): void {
    bodies = DEFS.map((d, i): Body => ({
      i, name: d[0], color: d[1], distAU: d[2], radius: d[3],
      mass: d[4], parent: d[5], isMoon: d[6],
      x: 0, y: 0, vx: 0, vy: 0, trail: [], extra: false,
    }));
    nextId = bodies.length;  // ids 0..n-1 are taken by the DEFS rows
    // Place each body and give it a circular orbital velocity about its parent.
    for (const b of bodies) {
      if (b.parent === null) { b.x = 0; b.y = 0; b.vx = 0; b.vy = 0; continue; }
      const p = bodyById(b.parent)!;
      const ang = Math.random() * Math.PI * 2;
      const r = b.distAU * AU;
      b.x = p.x + Math.cos(ang) * r;
      b.y = p.y + Math.sin(ang) * r;
      // v = sqrt(G*M/r) for a circular orbit about the parent's mass
      const mu = BASE_G * p.mass * (b.parent === 0 ? SUN_SCALE : 1);
      const v = Math.sqrt(mu / r) * Math.sqrt(GRAV_SCALE);
      b.vx = p.vx + Math.sin(ang) * -v;  // perpendicular to radius (CCW)
      b.vy = p.vy + Math.cos(ang) * v;
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

  function step(dt: number): void {
    const G = BASE_G * GRAV_SCALE;
    const n = bodies.length;
    const ax = new Float64Array(n), ay = new Float64Array(n);
    const idxOf = new Map<number, number>();
    for (let k = 0; k < n; k++) idxOf.set(bodies[k].i, k);

    // Pass 1: full N-body among the non-moon bodies.
    for (let a = 0; a < n; a++) {
      const A = bodies[a];
      if (A.isMoon) continue;
      const Amass = massOf(A);
      for (let b = a + 1; b < n; b++) {
        const B = bodies[b];
        if (B.isMoon) continue;
        const Bmass = massOf(B);
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

    // Pass 2: each moon = parent's acceleration + gravity toward the parent.
    for (let k = 0; k < n; k++) {
      const m = bodies[k];
      if (!m.isMoon || m.parent === null) continue;
      const pIdx = idxOf.get(m.parent);
      if (pIdx === undefined) continue;           // parent gone (mid-merge)
      const p = bodies[pIdx];
      ax[k] = ax[pIdx];                           // carried along the parent's orbit
      ay[k] = ay[pIdx];
      const dx = p.x - m.x, dy = p.y - m.y;
      let d2 = dx * dx + dy * dy;
      d2 += 1;
      const inv = 1 / Math.sqrt(d2);
      const f = G * massOf(p) * inv / d2;         // bound only to the parent body
      ax[k] += f * dx; ay[k] += f * dy;
    }

    for (let k = 0; k < n; k++) {
      const b = bodies[k];
      b.vx += ax[k] * dt; b.vy += ay[k] * dt;
    }
    for (let k = 0; k < n; k++) {
      const b = bodies[k];
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
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
    // Moons of the absorbed body are inherited by the survivor.
    for (const x of bodies) if (x.parent === gone.i) x.parent = survivor.i;
    bodies.splice(bodies.indexOf(gone), 1);
    if (cam.focus === gone.i) cam.focus = survivor.i;
    flashes.push({ x: survivor.x, y: survivor.y, age: 0, max: 0.5, r: survivor.radius });
  }

  // --------------------------- Camera ------------------------------
  const cam = { x: 0, y: 0, focus: 0 };  // world coords at screen center
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
  makeStars();
  window.addEventListener("resize", makeStars);

  let showTrails = true, showOrbits = true, showLabels = true;

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

  function draw(time: number): void {
    ctx.fillStyle = "#05060d";
    ctx.fillRect(0, 0, W, H);

    // starfield
    for (const st of stars) {
      ctx.globalAlpha = st.a * (0.6 + 0.4 * Math.sin(time * 0.001 + st.tw));
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

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

    // bodies, back-to-front so nearer ones overlap farther ones when tilted
    const order = viewTilt > 0.001
      ? [...bodies].sort((a, b) => depthOf(a.x, a.y) - depthOf(b.x, b.y))
      : bodies;
    for (const b of order) {
      const [sx, sy] = worldToScreen(b.x, b.y);
      let rad = REAL_SCALE
        ? Math.max(1.4, Math.cbrt(b.mass) * 0.6 * ZOOM * 0.1)
        : b.radius * Math.sqrt(ZOOM);
      rad = Math.min(rad, 70);

      if (b.i === 0) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * 4.5);
        g.addColorStop(0, "rgba(255,221,120,0.55)");
        g.addColorStop(0.4, "rgba(255,160,40,0.18)");
        g.addColorStop(1, "rgba(255,140,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, rad * 4.5, 0, 7); ctx.fill();
      } else {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * 2.2);
        g.addColorStop(0, b.color + "44");
        g.addColorStop(1, b.color + "00");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, rad * 2.2, 0, 7); ctx.fill();
      }

      // body disk with shading
      const bg = ctx.createRadialGradient(sx - rad * 0.35, sy - rad * 0.35, rad * 0.1, sx, sy, rad);
      bg.addColorStop(0, lighten(b.color, 0.4));
      bg.addColorStop(1, b.color);
      ctx.fillStyle = b.i === 0 ? "#ffd34d" : bg;
      ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 7); ctx.fill();

      // Saturn ring
      if (b.name === "Saturn") {
        ctx.save();
        ctx.translate(sx, sy); ctx.rotate(-0.5); ctx.scale(1, 0.34);
        ctx.strokeStyle = "rgba(230,207,156,0.55)"; ctx.lineWidth = rad * 0.45;
        ctx.beginPath(); ctx.arc(0, 0, rad * 1.9, 0, 7); ctx.stroke();
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

    drawReadout();
  }

  // --------------------------- Readout -----------------------------
  const readoutEl = $("readout");
  function fmtMass(m: number): string {
    if (m >= 1000) return (m / 1000).toFixed(0) + "k";
    if (m >= 1) return m.toFixed(m < 10 ? 2 : 0);
    return m.toFixed(3);
  }
  function bodyKind(b: Body): string {
    if (b.i === 0) return "Star";
    if (b.extra) return "Comet";
    if (b.isMoon) return "Moon";
    return "Planet";
  }
  function fmtPeriod(t: number): string {
    if (t < 10) return t.toFixed(2) + " s";
    if (t < 1000) return t.toFixed(1) + " s";
    if (t < 1e6) return (t / 1000).toFixed(1) + "k s";
    return (t / 1e6).toFixed(1) + "M s";
  }
  function row(k: string, v: string): string {
    return `<span class="k">${k}</span><b>${v}</b><br>`;
  }

  function drawReadout(): void {
    const f = bodyById(cam.focus) || bodies[0];
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

    const moons = bodies.filter(b => b.isMoon && b.parent === f.i).length;
    if (moons > 0) html += row("Moons", String(moons));

    if (f.i !== 0) {
      html += row("To Sun", `${(Math.hypot(f.x - sun.x, f.y - sun.y) / AU).toFixed(2)} AU`);
    }
    if (f.parent !== null && f.parent !== 0) {
      const p = bodyById(f.parent);
      if (p) html += row(`To ${p.name}`, `${(Math.hypot(f.x - p.x, f.y - p.y) / AU).toFixed(3)} AU`);
    }

    html += row("Speed", `${speed.toFixed(1)} u/s`);

    if (f.parent !== null) {
      const p = bodyById(f.parent);
      if (p) {
        const r = Math.hypot(f.x - p.x, f.y - p.y);
        const mu = BASE_G * GRAV_SCALE * massOf(p);
        if (mu > 0 && r > 0) html += row("Period", `~${fmtPeriod(2 * Math.PI * Math.sqrt(r * r * r / mu))}`);
      }
    }

    html += `<div class="sep"></div>`;
    html += `<span class="dim">Bodies ${bodies.length} · G ${GRAV_SCALE.toFixed(2)}× · ${TIME_SCALE.toFixed(2)}×t</span>`;
    readoutEl.innerHTML = html;
  }

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
      const simDt = dt * TIME_SCALE;
      const sub = Math.min(40, Math.max(1, Math.ceil(TIME_SCALE)));
      const h = simDt / sub;
      for (let s = 0; s < sub; s++) step(h);

      if (collisions) resolveCollisions();

      for (const b of bodies) {
        if (b.parent === null) continue;
        b.trail.push([b.x, b.y]);
        const max = b.isMoon ? 60 : 240;
        if (b.trail.length > max) b.trail.shift();
      }
    }

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

  $<HTMLInputElement>("t_trails").addEventListener("change", e => showTrails = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_orbits").addEventListener("change", e => showOrbits = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_labels").addEventListener("change", e => showLabels = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_realscale").addEventListener("change", e => REAL_SCALE = (e.target as HTMLInputElement).checked);
  $<HTMLInputElement>("t_collide").addEventListener("change", e => collisions = (e.target as HTMLInputElement).checked);

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
  function resetDefaults(): void {
    setRange("s_speed", 10);   // 0.10×
    setRange("s_grav", 100);   // 1.00×
    setRange("s_sun", 100);    // 1.00×
    setRange("s_zoom", 100);   // 1.00×
    setToggle("t_trails", true);
    setToggle("t_orbits", true);
    setToggle("t_labels", true);
    setToggle("t_realscale", false);
    setToggle("t_collide", true);
    flashes.length = 0;
    viewSpin = 0; viewTilt = DEFAULT_TILT; // default perspective
    if (paused) pauseBtn.click();         // resume if paused
    cam.focus = 0;                        // Sun
    followSuspended = false;
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
    cometN++;
    const ang = Math.random() * Math.PI * 2;
    const r = 5.5 * AU;
    const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
    const toSun = Math.atan2(-y, -x) + (Math.random() - 0.5) * 0.8;
    const mu = BASE_G * bodies[0].mass * SUN_SCALE;
    const v = Math.sqrt(mu / r) * 1.05 * Math.sqrt(Math.max(0.2, GRAV_SCALE));
    bodies.push({
      i: nextId++, name: "Comet " + cometN, color: "#9fe8ff",
      distAU: 5.5, radius: 2.2, mass: 0.0001, parent: 0, isMoon: false,
      x, y, vx: Math.cos(toSun) * v, vy: Math.sin(toSun) * v, trail: [], extra: true,
    });
    buildFocusList();
  });

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
    followSuspended = false;  // re-enable following when a focus is chosen
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
    if (e.key === "h") $("dash").classList.toggle("collapsed");
    if (e.key === "0") { viewSpin = 0; viewTilt = DEFAULT_TILT; }  // reset view
    if (e.key === " ") { e.preventDefault(); pauseBtn.click(); }
  });

  // ----------------------------- Mouse -----------------------------
  canvas.addEventListener("mousedown", e => {
    panning = true; didDrag = false; panLast = [e.clientX, e.clientY];
  });
  // Keep the right mouse button usable for rotation instead of a context menu.
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  window.addEventListener("mouseup", e => {
    if (panning && !didDrag) pickBody(e.clientX, e.clientY);
    panning = false;
  });
  window.addEventListener("mousemove", e => {
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
    const z = Math.max(0.2, Math.min(4, ZOOM * factor));
    setZoom(z);
  }, { passive: false });

  function setZoom(z: number): void {
    ZOOM = Math.max(0.2, Math.min(4, z));
    const s = $<HTMLInputElement>("s_zoom");
    s.value = String(Math.round(ZOOM * 100));
    s.dispatchEvent(new Event("input"));
  }

  // ----------------------------- Touch -----------------------------
  // 1 finger  → pan (tap = focus a body)
  // 2 fingers → pinch to zoom + drag to tilt (vertical) / spin (horizontal)
  let touchMode: "none" | "pan" | "gesture" = "none";
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
      touchMode = "pan"; touchMoved = false;
      touchLast = [e.touches[0].clientX, e.touches[0].clientY];
      tapStart = touchLast;
    } else if (e.touches.length >= 2) {
      touchMode = "gesture"; touchMoved = true;
      touchLast = midpoint(e.touches);
      pinchDist = spread(e.touches);
    }
  }, { passive: false });

  canvas.addEventListener("touchmove", e => {
    e.preventDefault();
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
      if (pinchDist > 0) setZoom(ZOOM * (dist / pinchDist));
      pinchDist = dist;
      const dmx = mid[0] - last[0], dmy = mid[1] - last[1];
      viewSpin += dmx * 0.005;
      viewTilt = Math.max(0, Math.min(1.45, viewTilt + dmy * 0.005));
      touchLast = mid;
    }
  }, { passive: false });

  canvas.addEventListener("touchend", e => {
    if (touchMode === "pan" && !touchMoved && tapStart) pickBody(tapStart[0], tapStart[1]);
    if (e.touches.length === 0) { touchMode = "none"; touchLast = null; }
    else if (e.touches.length === 1) {
      touchMode = "pan"; touchMoved = true;  // continuing after a gesture isn't a tap
      touchLast = [e.touches[0].clientX, e.touches[0].clientY];
    }
  }, { passive: false });

  function pickBody(sx: number, sy: number): void {
    let best = -1, bestD = 24;
    for (const b of bodies) {
      const [bx, by] = worldToScreen(b.x, b.y);
      const d = Math.hypot(bx - sx, by - sy);
      const rad = (REAL_SCALE ? 6 : b.radius) + 8;
      if (d < Math.max(bestD, rad)) { bestD = d; best = b.i; }
    }
    if (best >= 0) { cam.focus = best; selFocus.value = String(best); followSuspended = false; }
  }

  const tip = $("tip");
  function hoverTip(sx: number, sy: number): void {
    let found: Body | null = null;
    for (const b of bodies) {
      const [bx, by] = worldToScreen(b.x, b.y);
      const rad = (REAL_SCALE ? 6 : b.radius) + 7;
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
  makeBodies();
  buildFocusList();
  cam.focus = 0;
  requestAnimationFrame(frame);
})();
