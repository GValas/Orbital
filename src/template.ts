/**
 * HTML shell for Orbital. `renderHTML` takes the stylesheet and the URL of the
 * compiled simulation script and returns the page markup. The CSS is inlined;
 * the JavaScript is loaded from a sibling file (e.g. `app.js`) so the build
 * emits exactly two artifacts into `dist/`. Called by `build.ts`.
 */

export interface RenderInput {
  css: string;
  /** Relative URL of the compiled script, e.g. "app.js". */
  scriptSrc: string;
  builtAt: string;
}

/** The static markup the simulation script binds to. */
const BODY = `
<canvas id="scene"></canvas>

<div id="dash" class="collapsed">
  <div class="title"><span class="dot"></span><h1>Orbital</h1><button id="closeDash" aria-label="Close panel">×</button></div>
  <div class="subtitle">An interactive N-body solar system. Tune the physics and watch orbits respond.</div>

  <div class="group">
    <div class="group-label">Simulation</div>
    <div class="ctrl">
      <div class="ctrl-head"><label>Time speed</label><span class="val" id="v_speed">0.02×</span></div>
      <input type="range" id="s_speed" min="0" max="20" value="2">
    </div>
    <div class="ctrl">
      <div class="ctrl-head"><label>Gravity (G)</label><span class="val" id="v_grav">1.00×</span></div>
      <input type="range" id="s_grav" min="0" max="300" value="100">
    </div>
    <div class="ctrl">
      <div class="ctrl-head"><label>Sun mass</label><span class="val" id="v_sun">1.00×</span></div>
      <input type="range" id="s_sun" min="10" max="300" value="100">
    </div>
    <div class="btn-row">
      <button class="b" id="b_pause">⏸ Pause</button>
      <button class="b" id="b_reset">↺ Reset</button>
    </div>
  </div>

  <div class="group">
    <div class="group-label">View</div>
    <div class="ctrl">
      <div class="ctrl-head"><label>Zoom</label><span class="val" id="v_zoom">1.00×</span></div>
      <input type="range" id="s_zoom" min="20" max="400" value="100">
    </div>
    <div class="toggles">
      <div class="toggle-row"><label for="t_trails">Trails</label>
        <label class="switch"><input type="checkbox" id="t_trails" checked><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_orbits">Paths</label>
        <label class="switch"><input type="checkbox" id="t_orbits"><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_labels">Labels</label>
        <label class="switch"><input type="checkbox" id="t_labels" checked><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_realscale">Real scale</label>
        <label class="switch"><input type="checkbox" id="t_realscale"><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_collide">Collisions</label>
        <label class="switch"><input type="checkbox" id="t_collide" checked><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_rings">Belts</label>
        <label class="switch"><input type="checkbox" id="t_rings" checked><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_predict">Trajectory</label>
        <label class="switch"><input type="checkbox" id="t_predict"><span class="slider-sw"></span></label></div>
    </div>
  </div>

  <div class="group">
    <div class="group-label">Focus body</div>
    <select class="sel" id="sel_focus"></select>
    <div class="hint">Drag to pan · Scroll to zoom · Click a body to focus &middot; <b>Both buttons drag to tilt/spin</b> &middot; Press <b>0</b> to reset view.<br><b>☀️ Add star:</b> arm it, then click anywhere to drop a heavy star and watch the system deform.<br><b>Touch:</b> drag to pan &middot; pinch to zoom &middot; two fingers to tilt/spin &middot; tap to focus.</div>
  </div>

  <div class="group">
    <div class="group-label">Experiments</div>
    <div class="btn-row">
      <button class="b" id="b_zerog">Zero-G</button>
      <button class="b" id="b_kick">Kick planets</button>
      <button class="b" id="b_comet">Add comet</button>
    </div>
    <div class="btn-row" style="margin-top:6px;">
      <button class="b" id="b_random">🌟 Random system</button>
      <button class="b" id="b_voyager">🛰️ Voyager 1</button>
    </div>
    <div class="btn-row" style="margin-top:6px;">
      <button class="b" id="b_launch">🎯 Aim &amp; launch</button>
      <button class="b" id="b_addstar">☀️ Add star</button>
    </div>
    <div class="btn-row" style="margin-top:6px;">
      <button class="b" id="b_share">🔗 Share</button>
    </div>
  </div>

  <div class="credit">An interactive N-body sandbox.</div>
</div>
<button id="toggleDash">☰</button>

<div id="buildinfo">Generated from TypeScript · vanilla JS + Canvas<br>Compiled __BUILT_AT__</div>
<div id="readout"></div>
<div id="dayclock"></div>
<div id="tip"></div>
<div id="toast"></div>`;

export function renderHTML({ css, scriptSrc, builtAt }: RenderInput): string {
  const body = BODY.trim().replace("__BUILT_AT__", builtAt);
  return `<!DOCTYPE html>
<!--
  AUTO-GENERATED by build.ts — do not edit directly.
  Edit src/main.ts / src/styles.css / src/template.ts and run \`npm run build\`.
-->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Orbital — Solar System Simulator</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%230b0e1c'/%3E%3Cpolygon points='16,3 19.8,12.3 29.8,12.3 21.7,18.5 24.9,28 16,22.2 7.1,28 10.3,18.5 2.2,12.3 12.2,12.3' fill='%23ffd24d'/%3E%3C/svg%3E">
<style>
${css.trim()}
</style>
</head>
<body>
${body}

<script src="${scriptSrc}"></script>
</body>
</html>
`;
}
