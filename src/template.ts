/**
 * HTML shell for Orbital. `renderHTML` takes the stylesheet and the compiled
 * simulation script and returns the page markup with both inlined — the build
 * emits a single, fully self-contained `dist/index.html`. Called by `build.ts`.
 */

export interface RenderInput {
  css: string;
  /** Compiled simulation JavaScript, inlined into the page. */
  js: string;
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
      <div class="toggle-row"><label for="t_field">Field</label>
        <label class="switch"><input type="checkbox" id="t_field"><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_vectors">Vectors</label>
        <label class="switch"><input type="checkbox" id="t_vectors"><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_bary">Barycenter</label>
        <label class="switch"><input type="checkbox" id="t_bary"><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_tides">Tides</label>
        <label class="switch"><input type="checkbox" id="t_tides"><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_hz">Habitable zone</label>
        <label class="switch"><input type="checkbox" id="t_hz"><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_axes">Spin axes</label>
        <label class="switch"><input type="checkbox" id="t_axes"><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_lagrange">Lagrange pts</label>
        <label class="switch"><input type="checkbox" id="t_lagrange"><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_kepler">Kepler areas</label>
        <label class="switch"><input type="checkbox" id="t_kepler"><span class="slider-sw"></span></label></div>
      <div class="toggle-row"><label for="t_sfx">Sound FX</label>
        <label class="switch"><input type="checkbox" id="t_sfx" checked><span class="slider-sw"></span></label></div>
    </div>
  </div>

  <div class="group">
    <div class="group-label">Edit selected body</div>
    <div class="ctrl">
      <div class="ctrl-head"><label>Mass</label><span class="val" id="v_emass">×1.00</span></div>
      <input type="range" id="e_mass" min="-10" max="10" value="0">
    </div>
    <div class="ctrl">
      <div class="ctrl-head"><label>Radius</label><span class="val" id="v_eradius">×1.00</span></div>
      <input type="range" id="e_radius" min="40" max="300" value="100">
    </div>
    <div class="ctrl">
      <div class="ctrl-head"><label>Speed</label><span class="val" id="v_espeed">×1.00</span></div>
      <input type="range" id="e_speed" min="0" max="200" value="100">
    </div>
  </div>

  <div class="group">
    <div class="group-label">Focus body</div>
    <select class="sel" id="sel_focus"></select>
    <div class="hint">Drag to pan · Scroll to zoom (at the cursor) · Click a body to focus &middot; <b>Right-click a body to delete it</b> &middot; <b>Both buttons drag to tilt/spin</b> &middot; Press <b>0</b> to reset view, <b>z</b> to undo.<br><b>☀️ Add star / 🕳️ Black hole:</b> arm it, then click to drop (or drag to fling a fly-by) and watch the system deform.<br><b>🚀 Mission:</b> steer the probe with ←↑↓→ / WASD (prograde, retrograde, lateral) — reach the target before the fuel runs out.<br><b>Touch:</b> drag to pan &middot; pinch to zoom &middot; two fingers to tilt/spin &middot; tap to focus &middot; when 🎯/☀️/🕳️ is armed, drag to aim (tap = drop at rest).</div>
  </div>

  <div class="group">
    <div class="group-label">Experiments</div>
    <div class="ctrl">
      <div class="ctrl-head"><label>Star mass</label><span class="val" id="v_starmass">0.60 M☉</span></div>
      <input type="range" id="s_starmass" min="10" max="200" value="60">
    </div>
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
      <button class="b" id="b_hole">🕳️ Black hole</button>
      <button class="b" id="b_rewind">⏪ Rewind</button>
    </div>
    <div class="btn-row" style="margin-top:6px;">
      <button class="b" id="b_mission">🚀 Mission</button>
      <button class="b" id="b_undo">↶ Undo</button>
    </div>
    <div class="btn-row" style="margin-top:6px;">
      <button class="b" id="b_music">🎵 Ambience</button>
      <button class="b" id="b_share">🔗 Share</button>
    </div>
    <select class="sel" id="sel_preset" style="margin-top:8px;">
      <option value="">✨ Load a scenario…</option>
      <option value="binary">Binary star</option>
      <option value="circumbinary">Circumbinary planets</option>
      <option value="capture">Stellar fly-by</option>
      <option value="chaos">Chaos cluster</option>
      <option value="trappist">TRAPPIST-1 system</option>
      <option value="comets">Comet shower</option>
    </select>
  </div>

  <div class="group">
    <div class="group-label">Saves</div>
    <select class="sel" id="sel_slot">
      <option value="1">Slot 1</option>
      <option value="2">Slot 2</option>
      <option value="3">Slot 3</option>
    </select>
    <div class="btn-row" style="margin-top:6px;">
      <button class="b" id="b_save">💾 Save</button>
      <button class="b" id="b_load">📂 Load</button>
      <button class="b" id="b_export">⬇ Export</button>
      <button class="b" id="b_import">⬆ Import</button>
    </div>
    <input type="file" id="f_import" accept=".json,application/json" style="display:none">
  </div>

  <div class="credit">An interactive N-body sandbox.</div>
</div>
<button id="toggleDash">☰</button>

<div id="buildinfo">Generated from TypeScript · vanilla JS + Canvas<br>Compiled __BUILT_AT__</div>
<div id="readout"></div>
<div id="dayclock"></div>
<div id="mission"></div>
<div id="tip"></div>
<div id="toast"></div>`;

export function renderHTML({ css, js, builtAt }: RenderInput): string {
  const body = BODY.trim().replace("__BUILT_AT__", builtAt);
  // "</script" inside the inlined JS would close the tag early; escaping the
  // slash is a no-op for JavaScript string contents but safe for the parser.
  const safeJs = js.replace(/<\/script/gi, "<\\/script");
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

<script>
${safeJs.trim()}
</script>
</body>
</html>
`;
}
