/*
 * Platformer: a 3D jumping game in Slope's look, played from the Play
 * picker (modes.js) in two modes:
 *
 *   Endless     one course that never ends, harder the further you get;
 *               scored in metres
 *   Adventure   a ladder of levels with a finish line; beating one unlocks
 *               the next (and keeps your best time)
 *
 * W/A/S/D roll the ball the way the camera looks, Space jumps (hold it for
 * a higher jump), the arrow keys look around (left and right turn the
 * camera, up and down tilt it; dragging does the same), Esc pauses. The
 * camera follows the course round its corners and comes back behind the
 * ball a moment after you stop looking around. On a touch screen, buttons
 * roll and jump and a drag looks around. Red things kill, and so does
 * falling off. Endless gets faster the further you go.
 *
 * The courses and the physics are in platformer-core.js. This file draws
 * them in a WebGL2 canvas over the game (which is paused meanwhile): black
 * blocks tiled with your track style, red hazards tiled with your pillar
 * style, your ball skin, your background, and gems of every rarity
 * (gems.js), all tinted with the track colour like the game.
 *
 *   SlopePlatformer.start("endless") / start("adventure", n)
 *   SlopePlatformer.openLevels(from)   the Adventure level grid
 *   SlopePlatformer.active()           true while it is on screen
 *   SlopePlatformer.state()            the run (for tools and tests)
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  var core = window.SlopePlatCore;
  if (!game || !profile || !core || !window.SlopeUI) return;

  var DT = 1 / 120;              // physics step
  var MAX_STEPS = 12;            // per frame (a slow frame doesn't run away)
  var VIEW = 110;                // drawn this far ahead
  var LEVEL_STEP = 18;
  var R = core.R;
  var KEYS = {
    KeyW: "fwd", KeyS: "back", KeyA: "left", KeyD: "right", Space: "jump",
    ArrowLeft: "lookLeft", ArrowRight: "lookRight", ArrowUp: "lookUp", ArrowDown: "lookDown"
  };
  var LOOK_TURN = 2.2;          // radians a second, arrow keys
  var LOOK_TILT = 1.2;
  var LOOK_BACK = 1.4;          // seconds after looking around before the camera comes back
  var CAM_DIST = 4.8, CAM_TILT = 0.45, TILT_MIN = 0.08, TILT_MAX = 1.15;

  // --- Matrices (column-major) -----------------------------------------------------------

  function multiply(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function perspective(fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function lookAt(eye, target, up) {
    var f = norm(sub(target, eye)), s = norm(cross(f, up)), u = cross(s, f);
    return new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1]);
  }
  // Rotation by angle about a unit axis, as a 3x3 (column-major).
  function axisAngle(ax, a) {
    var c = Math.cos(a), s = Math.sin(a), t = 1 - c, x = ax[0], y = ax[1], z = ax[2];
    return [t * x * x + c, t * x * y + s * z, t * x * z - s * y,
      t * x * y - s * z, t * y * y + c, t * y * z + s * x,
      t * x * z + s * y, t * y * z - s * x, t * z * z + c];
  }
  function mul3(a, b) {
    var o = [];
    for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    return o;
  }
  function orthonormal(m) {
    var x = norm([m[0], m[1], m[2]]), y = [m[3], m[4], m[5]];
    var d = dot(x, y); y = norm([y[0] - x[0] * d, y[1] - x[1] * d, y[2] - x[2] * d]);
    var z = cross(x, y);
    return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
  }

  // World positions as they are (kept as a hook for the drawing code).
  function W(p) { return p; }

  // --- Shaders -------------------------------------------------------------------------------

  var BOX_VS = [
    "#version 300 es",
    "layout(location = 0) in vec3 aPos;",
    "layout(location = 1) in vec3 aNormal;",
    "uniform mat4 uVP;",
    "uniform vec3 uCentre, uHalf;",
    "uniform float uYaw;",
    "out vec3 vLocal, vNormal, vLight, vWorld;",
    "void main() {",
    "  vec3 l = aPos * uHalf;",
    "  float c = cos(uYaw), s = sin(uYaw);",
    "  vec3 r = vec3(c * l.x - s * l.z, l.y, s * l.x + c * l.z);",
    "  vLocal = l;",
    "  vNormal = aNormal;",
    "  vLight = vec3(c * aNormal.x - s * aNormal.z, aNormal.y, s * aNormal.x + c * aNormal.z);",
    "  vWorld = uCentre + r;",
    "  gl_Position = uVP * vec4(vWorld, 1.0);",
    "}"
  ].join("\n");

  // Styles: 0 floor, 1 red hazard, 2 lift, 3 bounce pad, 4 laser, 5 shadow,
  // 6 finish gate, 7 crumbling tile, 8 column under a floor.
  var BOX_FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec3 vLocal, vNormal, vLight, vWorld;",
    "uniform vec3 uHalf, uColor, uCam;",
    "uniform float uAlong;",
    "uniform int uStyle;",
    "uniform float uTime, uGlow;",
    "uniform sampler2D uFloor, uEdge, uWall;",
    "out vec4 outColor;",
    "const vec3 NEON = vec3(0.0, 1.0, 0.0);",
    "const vec3 RED = vec3(1.0, 0.05, 0.03);",
    "void main() {",
    "  vec3 e = uHalf - abs(vLocal);",
    "  float lo = min(e.x, min(e.y, e.z)), hi = max(e.x, max(e.y, e.z));",
    "  float mid = e.x + e.y + e.z - lo - hi;",
    "  float aa = fwidth(mid) + 1e-4;",
    "  float edge = 1.0 - smoothstep(0.05 - aa, 0.05 + aa, mid);",
    "  vec3 n = abs(vNormal);",
    "  vec3 q = vec3(vLocal.x, vLocal.y, vLocal.z + uAlong);",   // tiles run along the course
    "  vec2 uv = n.y > 0.5 ? q.xz : n.x > 0.5 ? q.zy : q.xy;",
    "  float light = 0.55 + 0.45 * max(0.0, dot(vLight, normalize(vec3(0.3, 0.9, -0.4))));",
    "  vec3 c;",
    "  if (uStyle == 5) {",                       // the ball's shadow: a dark disc with a ring
    "    float d = length(vLocal.xz) / uHalf.x;",
    "    float ring = smoothstep(0.78, 0.86, d) * (1.0 - smoothstep(0.92, 1.0, d));",
    "    float a = (1.0 - smoothstep(0.85, 1.0, d)) * 0.7;",
    "    outColor = vec4(NEON * ring * 0.8, max(a, ring * 0.9) * uGlow);",
    "    return;",
    "  }",
    "  if (uStyle == 0 || uStyle == 2 || uStyle == 7) {",
    "    c = n.y > 0.5 && vNormal.y > 0.0 ? texture(uFloor, uv * 0.5).rgb * 0.42 : texture(uEdge, uv * 0.6).rgb * 0.6;",
    "    if (uStyle == 7) {",                        // cracks
    "      float k = abs(fract(uv.x * 0.9 + 0.3 * sin(uv.y * 2.1)) - 0.5) * abs(fract(uv.y * 0.8 + 0.4 * sin(uv.x * 1.7)) - 0.5);",
    "      c = mix(c, RED * 0.9, 1.0 - smoothstep(0.004, 0.012, k));",
    "    }",
    "    c *= light;",
    "    c = mix(c, uStyle == 7 ? RED : NEON, edge * (uStyle == 2 ? 1.0 : 0.85));",
    "  } else if (uStyle == 1) {",
    "    c = texture(uWall, uv * 0.9).rgb * light;",
    "    c = mix(c + RED * 0.06, RED, edge);",
    "  } else if (uStyle == 3) {",                  // bounce pad: chevrons running forward
    "    float v = fract(q.z * 0.8 - abs(vLocal.x) * 0.5 - uTime * 2.0);",
    "    float band = smoothstep(0.0, 0.05, v) - smoothstep(0.35, 0.4, v);",
    "    c = mix(vec3(0.0, 0.06, 0.0), NEON, band) * light;",
    "    c = mix(c, NEON, edge);",
    "  } else if (uStyle == 4) {",                  // laser: bright when on, a faint outline when off
    "    c = uGlow > 0.5 ? mix(RED, vec3(1.0, 0.75, 0.7), 0.35 + 0.25 * sin(uTime * 30.0)) : RED * 0.12 + RED * edge * 0.5;",
    "  } else if (uStyle == 6) {",                  // finish: checks
    "    float ch = mod(floor(uv.x * 2.0) + floor(uv.y * 2.0), 2.0);",
    "    c = mix(vec3(0.05), vec3(0.9), ch) * light;",
    "    c = mix(c, NEON, edge);",
    "  } else {",                                    // a column under a floor
    "    c = texture(uEdge, uv * 0.6).rgb * 0.45 * light;",
    "    c = mix(c, NEON * 0.5, edge);",
    "  }",
    "  float fog = smoothstep(" + (VIEW * 0.55).toFixed(1) + ", " + VIEW.toFixed(1) + ", length(vWorld - uCam));",
    "  outColor = vec4(c * (1.0 - fog), 1.0);",
    "}"
  ].join("\n");

  // Faceted things (spikes, gems): dark faces, bright edges.
  var FACET_VS = [
    "#version 300 es",
    "layout(location = 0) in vec3 aPos;",
    "layout(location = 1) in vec3 aBary;",
    "layout(location = 2) in vec3 aNormal;",
    "uniform mat4 uVP;",
    "uniform vec3 uCentre, uScale;",
    "uniform float uYaw;",
    "out vec3 vBary, vWorld;",
    "out float vLight;",
    "void main() {",
    "  float c = cos(uYaw), s = sin(uYaw);",
    "  vec3 l = aPos * uScale;",
    "  vec3 r = vec3(c * l.x - s * l.z, l.y, s * l.x + c * l.z);",
    "  vec3 nr = normalize(vec3(c * aNormal.x - s * aNormal.z, aNormal.y, s * aNormal.x + c * aNormal.z));",
    "  vLight = 0.35 + 0.65 * max(0.0, dot(nr, normalize(vec3(0.3, 0.8, -0.5))));",
    "  vBary = aBary;",
    "  vWorld = uCentre + r;",
    "  gl_Position = uVP * vec4(vWorld, 1.0);",
    "}"
  ].join("\n");

  var FACET_FS = [
    "#version 300 es",
    "precision highp float;",
    "in vec3 vBary, vWorld;",
    "in float vLight;",
    "uniform vec3 uFace, uEdge, uCam;",
    "out vec4 outColor;",
    "void main() {",
    "  float d = min(min(vBary.x, vBary.y), vBary.z);",
    "  float line = 1.0 - smoothstep(0.04, 0.07, d);",
    "  vec3 c = mix(uFace * vLight, uEdge, line);",
    "  float fog = smoothstep(" + (VIEW * 0.55).toFixed(1) + ", " + VIEW.toFixed(1) + ", length(vWorld - uCam));",
    "  outColor = vec4(c * (1.0 - fog), 1.0);",
    "}"
  ].join("\n");

  // --- Meshes --------------------------------------------------------------------------------

  function cubeMesh() {
    var faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]
    ];
    var data = [];
    faces.forEach(function (f) {
      var n = f[0], u = f[1], v = f[2];
      [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]].forEach(function (ab) {
        data.push(n[0] + u[0] * ab[0] + v[0] * ab[1], n[1] + u[1] * ab[0] + v[1] * ab[1], n[2] + u[2] * ab[0] + v[2] * ab[1], n[0], n[1], n[2]);
      });
    });
    return new Float32Array(data);
  }

  // Triangles with corner markers (for edge lines) and flat normals.
  function facets(tris) {
    var data = [];
    tris.forEach(function (t) {
      var n = norm(cross(sub(t[1], t[0]), sub(t[2], t[0])));
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(function (bary, i) {
        data.push(t[i][0], t[i][1], t[i][2], bary[0], bary[1], bary[2], n[0], n[1], n[2]);
      });
    });
    return new Float32Array(data);
  }

  function pyramidMesh() {
    var top = [0, 1, 0], c = [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]];
    var tris = [];
    for (var i = 0; i < 4; i++) tris.push([top, c[(i + 1) % 4], c[i]]);
    return facets(tris);
  }

  function gemMesh() {
    var top = [0, 1.35, 0], bottom = [0, -1.35, 0], ring = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]];
    var tris = [];
    for (var i = 0; i < 4; i++) {
      var a = ring[i], b = ring[(i + 1) % 4];
      tris.push([top, b, a], [bottom, a, b]);
    }
    return facets(tris);
  }

  function sphereMesh() {
    var rows = 20, cols = 28, pos = [], idx = [];
    for (var r = 0; r <= rows; r++) {
      var t = r / rows * Math.PI;
      for (var c = 0; c <= cols; c++) {
        var f = c / cols * Math.PI * 2;
        pos.push(Math.sin(t) * Math.cos(f), Math.cos(t), Math.sin(t) * Math.sin(f));
      }
    }
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      var i = r * (cols + 1) + c;
      idx.push(i, i + cols + 1, i + 1, i + 1, i + cols + 1, i + cols + 2);
    }
    return { pos: new Float32Array(pos), idx: new Uint16Array(idx) };
  }

  // --- GL setup --------------------------------------------------------------------------------

  var gfx = null;

  function program(gl, vs, fs, names) {
    function shader(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    }
    var p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {};
    names.forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    return { p: p, u: u };
  }

  function vao(gl, data, layout) {
    var v = gl.createVertexArray();
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    var stride = layout.reduce(function (a, n) { return a + n; }, 0) * 4, off = 0;
    layout.forEach(function (n, i) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, n, gl.FLOAT, false, stride, off);
      off += n * 4;
    });
    return { vao: v, count: data.length / (stride / 4) };
  }

  function setup(canvas) {
    var gl = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
    if (!gl) return null;
    var g = { gl: gl };
    g.box = program(gl, BOX_VS, BOX_FS, ["uVP", "uCentre", "uHalf", "uYaw", "uColor", "uCam", "uStyle", "uTime", "uGlow", "uFloor", "uEdge", "uWall", "uAlong"]);
    g.facet = program(gl, FACET_VS, FACET_FS, ["uVP", "uCentre", "uScale", "uYaw", "uFace", "uEdge", "uCam"]);
    g.cube = vao(gl, cubeMesh(), [3, 3]);
    g.pyramid = vao(gl, pyramidMesh(), [3, 3, 3]);
    g.gem = vao(gl, gemMesh(), [3, 3, 3]);
    var s = sphereMesh();
    g.sphere = gl.createVertexArray();
    gl.bindVertexArray(g.sphere);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, s.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, s.idx, gl.STATIC_DRAW);
    g.sphereCount = s.idx.length;
    gl.bindVertexArray(null);
    try { g.ball = window.SlopeSkins && window.SlopeSkins.renderer ? window.SlopeSkins.renderer(gl) : null; } catch (e) { g.ball = null; }
    g.background = window.SlopeBackgrounds && window.SlopeBackgrounds.painter ? window.SlopeBackgrounds.painter(gl) : null;
    g.aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    g.textures = { floor: gl.createTexture(), edge: gl.createTexture(), wall: gl.createTexture() };
    g.tileKey = null;
    return g;
  }

  // The tiles of your track and pillar styles (slopes.js), as textures.
  function updateTiles() {
    var gl = gfx.gl, tiles = window.SlopeSlopes && window.SlopeSlopes.tiles ? window.SlopeSlopes.tiles() : null;
    var key = tiles ? tiles.key : "plain";
    if (key === gfx.tileKey) return;
    gfx.tileKey = key;
    ["floor", "edge", "wall"].forEach(function (k) {
      gl.bindTexture(gl.TEXTURE_2D, gfx.textures[k]);
      if (tiles) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tiles[k]);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(k === "wall" ? [200, 0, 0, 255] : [0, 120, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      if (gfx.aniso) gl.texParameterf(gl.TEXTURE_2D, gfx.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    });
  }

  // --- State -----------------------------------------------------------------------------------

  var els = null;
  var mode = null;            // "endless" | "adventure" while on screen
  var levelN = 0;
  var run = null;
  var state = "off";          // off | playing | paused | over
  var held = {};
  var jumpQueued = false;
  var acc = 0, lastFrame = 0, loop = 0;
  var cam = null;
  var look = { yaw: 0, tilt: 0, last: -1e9 };   // looking around: offsets from behind the ball
  var camYaw = 0, courseYaw = 0;
  var spin = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  var rarity = {};            // gem id -> rarity index (rolled when first seen)
  var tally = null;           // gems picked up this run
  var best = 0;               // best before this run (metres, or seconds for a level)
  var openedFrom = null;
  var startedAt = 0;
  var shownLevels = 0;
  var lastTiles = 0;
  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)") : { matches: false };

  function gemsApi() { return window.SlopeGems; }
  function rarityOf(g) {
    if (rarity[g.id] === undefined) rarity[g.id] = gemsApi() ? gemsApi().roll() : 0;
    return rarity[g.id];
  }

  // --- Running -----------------------------------------------------------------------------------

  function start(kind, n) {
    if (!els) return false;
    if (!gfx) {
      try { gfx = setup(els.canvas); } catch (e) { console.warn("Slope platformer: can't draw", e); gfx = null; }
      if (!gfx) { showUnsupported(); return false; }
    }
    hideScreens();
    mode = kind === "adventure" ? "adventure" : "endless";
    levelN = mode === "adventure" ? Math.max(1, Math.min(Math.floor(n) || 1, profile.get().platUnlocked)) : 0;
    var course = mode === "adventure" ? core.buildLevel(levelN) : core.endless(Math.floor(Math.random() * 1e9));
    run = core.newRun(course);
    rarity = {};
    tally = gemsApi() && gemsApi().tally ? gemsApi().tally() : { gems: 0, pickups: 0, golds: 0, rares: {} };
    var p = profile.get();
    best = mode === "adventure" ? (p.platTimes[levelN] || 0) / 10 : p.modes.platformer.best;
    held = {};
    jumpQueued = false;
    acc = 0;
    cam = null;
    look = { yaw: 0, tilt: 0, last: -1e9 };
    courseYaw = 0;
    lastCam = 0;
    spin = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    startedAt = performance.now();
    state = "playing";
    els.root.hidden = false;
    els.hud.hidden = false;
    els.pause.hidden = false;
    els.touch.hidden = !coarse.matches;
    var toast = window.SlopeUI.root.querySelector(".slope-toast");
    if (toast) toast.hidden = true;
    window.SlopeUI.closeSettings();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    game.pause("platformer");
    game.resume("platformer-levels");   // started from the level grid
    showIntro();
    lastFrame = 0;
    if (!loop) loop = requestAnimationFrame(frame);
    return true;
  }

  // The keys as a direction in the world: forward is the way the camera looks.
  function input() {
    var side = (held.right ? 1 : 0) - (held.left ? 1 : 0), fwd = (held.fwd ? 1 : 0) - (held.back ? 1 : 0);
    var fx = Math.sin(camYaw), fz = Math.cos(camYaw);   // forward on the ground
    var rx = -fz, rz = fx;                              // right on screen
    var jump = jumpQueued;
    jumpQueued = false;
    return { x: fx * fwd + rx * side, z: fz * fwd + rz * side, jump: jump, hold: !!held.jump };
  }

  // Arrow keys (and drags) look around; a moment after, the camera comes back.
  function lookAround(dt, now) {
    var turn = (held.lookLeft ? 1 : 0) - (held.lookRight ? 1 : 0), tilt = (held.lookDown ? 1 : 0) - (held.lookUp ? 1 : 0);
    if (turn || tilt) {
      look.yaw += turn * LOOK_TURN * dt;
      look.tilt += tilt * LOOK_TILT * dt;
      look.last = now;
    } else if (now - look.last > LOOK_BACK * 1000) {
      var k = 1 - Math.exp(-dt * 2.5);
      look.yaw -= look.yaw * k;
      look.tilt -= look.tilt * k;
    }
    look.yaw = Math.max(-Math.PI, Math.min(Math.PI, look.yaw));
    look.tilt = Math.max(TILT_MIN - CAM_TILT, Math.min(TILT_MAX - CAM_TILT, look.tilt));
  }

  function frame(now) {
    loop = 0;
    if (state === "off") return;
    var dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (state === "playing") {
      if (somethingOnTop()) { pause(); }
      else {
        acc += dt;
        var steps = 0;
        while (acc >= DT && steps < MAX_STEPS) {
          var inp = input();
          if (steps > 0) inp.jump = false;
          core.step(run, inp, DT);
          collect();
          acc -= DT;
          steps++;
          if (run.dead || run.won) break;
        }
        if (steps >= MAX_STEPS) acc = 0;
        if (run.course.endless) {
          run.course.extend(run.s + VIEW + 30);
          if (run.lastPrune === undefined || run.s - run.lastPrune > 60) { run.course.prune(run.s - 30); run.lastPrune = run.s; }
        }
        lookAround(dt, now);
        roll(dt);
        renderHud();
        if (run.dead || run.won) end();
      }
    }
    draw(now / 1000);
    if (state === "playing" || state === "over") loop = requestAnimationFrame(frame);
  }

  // Gems picked up this step: their rarity's worth (gems.js), a pop for rare ones.
  function collect() {
    var api = gemsApi();
    run.taken.forEach(function (g) {
      var r = rarityOf(g);
      var added = profile.addGems(api ? api.worth(r) : 1);
      if (api && api.count) api.count(tally, r, added); else { tally.gems += added; tally.pickups++; }
      if (api && r >= 2) api.found(r, added);
    });
  }

  // The ball rolls the way it moves.
  function roll(dt) {
    var b = run.ball, v = [-b.vx, 0, b.vz], speed = Math.hypot(v[0], v[2]);
    if (speed < 0.01 || !dt) return;
    var axis = norm(cross([0, 1, 0], v));
    spin = orthonormal(mul3(axisAngle(axis, speed * dt / R), spin));
  }

  function somethingOnTop() {
    if (document.hidden) return true;
    var panel = document.getElementById("slope-settings-panel");
    if (panel && !panel.hidden) return true;
    var screens = window.SlopeUI.root.querySelectorAll(".slope-career");
    for (var i = 0; i < screens.length; i++) {
      if (!screens[i].hidden && !els.own.has(screens[i])) return true;
    }
    return false;
  }

  function pause() {
    if (state !== "playing") return;
    state = "paused";
    held = {};
    els.pauseTitle.textContent = mode === "adventure" ? "Level " + levelN : "Endless";
    els.pauseLine.textContent = mode === "adventure"
      ? Math.round(progress() * 100) + "% of the way  \u00b7  " + run.t.toFixed(1) + " s"
      : metres() + " m so far";
    els.pauseLevels.hidden = mode !== "adventure";
    if (!somethingOnTop()) {
      els.pauseScreen.hidden = false;
      els.resume.focus({ preventScroll: true });
    }
    draw(performance.now() / 1000);
  }

  function resume() {
    if (state !== "paused") return;
    els.pauseScreen.hidden = true;
    if (els.pauseScreen.contains(document.activeElement)) document.activeElement.blur();
    state = "playing";
    lastFrame = 0;
    acc = 0;
    held = {};
    if (!loop) loop = requestAnimationFrame(frame);
  }

  function metres() { return Math.max(0, Math.floor(run.furthest - 2)); }
  function progress() { return Math.max(0, Math.min(1, (run.furthest - 2) / (run.course.length - 2))); }

  function end() {
    state = "over";
    held = {};
    var won = run.won, seconds = run.t;
    var score = mode === "adventure" ? (won ? levelN : 0) : metres();
    var xpScore = mode === "adventure" ? (won ? 10 + 3 * levelN : Math.round(progress() * (5 + levelN))) : Math.round(metres() / 4);
    var result = profile.recordPlatformer({
      mode: mode === "adventure" ? "platadv" : "platformer", score: score, xpScore: xpScore, won: won,
      gems: tally.gems, golds: tally.golds, rares: tally.rares, seconds: seconds, jumps: run.jumps
    });
    var unlockedBefore = profile.get().platUnlocked;
    if (won) profile.completePlatLevel(levelN, seconds);
    hideIntro();
    // A moment to see what happened, then the result.
    setTimeout(function () {
      if (state !== "over") return;
      showResult(won, result, seconds, unlockedBefore);
    }, won ? 600 : 900);
  }

  function quit(toModes) {
    if (state === "playing" || state === "paused") {
      // Leaving a run part way still counts the gems and the try.
      run.dead = run.dead || "quit";
      state = "over";
      profile.recordPlatformer({ mode: mode === "adventure" ? "platadv" : "platformer", score: mode === "adventure" ? 0 : metres(),
        xpScore: 0, won: false, gems: tally.gems, golds: tally.golds, rares: tally.rares, seconds: run.t, jumps: run.jumps });
    }
    state = "off";
    mode = null;
    hideScreens();
    els.root.hidden = true;
    els.hud.hidden = true;
    els.pause.hidden = true;
    els.keys.hidden = true;
    els.touch.hidden = true;
    hideIntro();
    game.resume("platformer");
    if (toModes && window.SlopeModes) window.SlopeModes.open(null);
  }

  // --- Keys ----------------------------------------------------------------------------------------
  // While the platformer plays, its keys never reach the game.

  ["keydown", "keyup"].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (state === "off") return;
      var inUi = window.SlopeUI.root && window.SlopeUI.root.contains(e.target) && e.target !== document.body;
      if (state !== "playing") {
        // Menus: their own keys; Escape goes back to the game.
        if (type === "keydown" && e.key === "Escape" && state === "paused") { e.preventDefault(); resume(); }
        if (!inUi) { e.stopImmediatePropagation(); }
        return;
      }
      var k = KEYS[e.code] || (e.key === " " ? "jump" : null);
      if (type === "keydown" && e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); pause(); return; }
      if (inUi && !k) return;
      e.stopImmediatePropagation();
      if (!k) return;
      e.preventDefault();
      if (type === "keydown") {
        if (k === "jump" && !e.repeat) jumpQueued = true;
        held[k] = true;
      } else {
        held[k] = false;
      }
    }, true);
  });
  window.addEventListener("blur", function () { held = {}; if (state === "playing") pause(); });

  // --- Drawing ---------------------------------------------------------------------------------------

  function resize() {
    var c = els.canvas, level = window.SlopeGraphics && window.SlopeGraphics.getLevel ? window.SlopeGraphics.getLevel() : "auto";
    var scale = Math.min(window.devicePixelRatio || 1, 2) * (level === "low" ? 0.6 : level === "ultra" ? 1.25 : 1);
    var w = Math.max(1, Math.round(c.clientWidth * scale)), h = Math.max(1, Math.round(c.clientHeight * scale));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  // Behind the ball, facing the way the course goes where the ball is (turned
  // by looking around), a little above it; slow to follow jumps up and down.
  var lastCam = 0;
  function camera(time) {
    var b = run.ball, target = [b.x, Math.max(b.floorY + R, Math.min(b.y, b.floorY + 2)), b.z];
    var dt = lastCam ? Math.min(0.1, Math.max(0, time - lastCam)) : 0;
    lastCam = time;
    if (b.ground) { var h = core.heading(b.ground); courseYaw = Math.atan2(h[0], h[1]); }
    if (!cam) { cam = target.slice(); camYaw = courseYaw; }
    // Smoothing by time, so slow and fast screens turn alike.
    function ease(rate) { return reduceMotion.matches ? 1 : 1 - Math.exp(-dt * rate); }
    cam[0] = target[0];
    cam[2] = target[2];
    cam[1] += (target[1] - cam[1]) * ease(4.5);
    var want = courseYaw + look.yaw, diff = Math.atan2(Math.sin(want - camYaw), Math.cos(want - camYaw));
    camYaw += diff * ease(performance.now() - look.last < 200 ? 30 : 6);
    var tilt = CAM_TILT + look.tilt, fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    var eye = [cam[0] - fx * CAM_DIST * Math.cos(tilt), cam[1] + 0.3 + CAM_DIST * Math.sin(tilt), cam[2] - fz * CAM_DIST * Math.cos(tilt)];
    var at = [cam[0] + fx * 6, cam[1] + 0.2, cam[2] + fz * 6];
    return { eye: eye, at: at };
  }

  function draw(time) {
    if (!gfx || !run) return;
    var gl = gfx.gl;
    resize();
    if (time - lastTiles > 1) { updateTiles(); lastTiles = time; }
    var cv = els.canvas, aspect = cv.width / cv.height;
    var view = camera(time);
    var proj = perspective((aspect < 1 ? 72 : 58) * Math.PI / 180, aspect, 0.1, VIEW + 20);
    var vp = multiply(proj, lookAt(view.eye, view.at, [0, 1, 0]));
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);

    // The background, where the course heads off to.
    if (gfx.background && gfx.background.on()) {
      gl.disable(gl.DEPTH_TEST);
      var f = [0, -0.12, 1, 0], x = vp[0] * f[0] + vp[4] * f[1] + vp[8] * f[2], y = vp[1] * f[0] + vp[5] * f[1] + vp[9] * f[2], w = vp[3] * f[0] + vp[7] * f[1] + vp[11] * f[2];
      gfx.background.draw({ time: time, width: cv.width, height: cv.height, vanish: w > 0 ? [x / w, y / w] : [0, 0.2], travel: run.ball.z });
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    var t = run.t, bx = run.ball.x, bz = run.ball.z;
    function inView(x, z, reach) { var dx = x - bx, dz = z - bz, r = VIEW + reach; return dx * dx + dz * dz < r * r; }
    var box = gfx.box;
    gl.useProgram(box.p);
    gl.bindVertexArray(gfx.cube.vao);
    gl.uniformMatrix4fv(box.u.uVP, false, vp);
    gl.uniform3fv(box.u.uCam, view.eye);
    gl.uniform1f(box.u.uTime, time % 1000);
    [["uFloor", "floor", 0], ["uEdge", "edge", 1], ["uWall", "wall", 2]].forEach(function (s) {
      gl.activeTexture(gl.TEXTURE0 + s[2]);
      gl.bindTexture(gl.TEXTURE_2D, gfx.textures[s[1]]);
      gl.uniform1i(box.u[s[0]], s[2]);
    });
    function boxAt(c, hx, hy, hz, style, yaw, glow, along) {
      gl.uniform3fv(box.u.uCentre, W(c));
      gl.uniform3f(box.u.uHalf, hx, hy, hz);
      gl.uniform1i(box.u.uStyle, style);
      gl.uniform1f(box.u.uYaw, yaw || 0);
      gl.uniform1f(box.u.uAlong, along || 0);
      gl.uniform1f(box.u.uGlow, glow === undefined ? 1 : glow);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }
    var spikes = [], gate = null;
    run.course.items.forEach(function (o) {
      if (!inView(o.x, o.z, o.reach || 0)) return;
      var c = core.at(o, t, run), yaw = o.yaw || 0, along = (o.s || 0) % 64;
      switch (o.kind) {
        case "floor":
          boxAt(c, o.hx, o.hy, o.hz, 0, yaw, 1, along);
          // A tower under it, fading into the dark.
          if (o.hz > 1.5) boxAt([c[0], c[1] - o.hy - 20, c[2]], Math.min(0.5, o.hx * 0.3), 20, Math.min(0.5, o.hz * 0.3), 8, yaw);
          break;
        case "crumble":
          var touched = run.touched[o.id];
          if (touched !== undefined && t > touched + core.CRUMBLE + 1.2) break;
          var sh = core.shake(o, t, run);
          c[0] += sh * o.ux; c[2] += sh * o.uz;
          boxAt(c, o.hx, o.hy, o.hz, 7, yaw, 1, along);
          break;
        case "lift": boxAt(c, o.hx, o.hy, o.hz, 2, yaw, 1, along); break;
        case "pad": boxAt(c, o.hx, o.hy, o.hz, 3, yaw, 1, along); break;
        case "hurdle": case "slider": case "post": boxAt(c, o.hx, o.hy, o.hz, 1, yaw); break;
        case "laser": boxAt(c, o.hx, o.hy, o.hz, 4, yaw, core.laserOn(o, t) ? 1 : 0); break;
        case "sweeper":
          // The bar lies along its angle (a box's x axis turned by yaw goes to (cos, sin)).
          boxAt(c, o.arm, o.thick, o.thick, 1, core.sweeperAngle(o, t));
          break;
        case "spikes": spikes.push(o); break;
        case "gate": gate = { o: o, c: c }; break;
      }
    });
    if (gate) {
      var g = gate.o, gc = gate.c, side = g.hx - 0.15;
      boxAt([gc[0] - g.ux * side, gc[1], gc[2] - g.uz * side], 0.15, g.hy, 0.15, 6, g.yaw);
      boxAt([gc[0] + g.ux * side, gc[1], gc[2] + g.uz * side], 0.15, g.hy, 0.15, 6, g.yaw);
      boxAt([gc[0], gc[1] + g.hy - 0.25, gc[2]], g.hx, 0.25, 0.15, 6, g.yaw);
    }

    // Spikes and gems: faceted.
    var facet = gfx.facet;
    gl.useProgram(facet.p);
    gl.uniformMatrix4fv(facet.u.uVP, false, vp);
    gl.uniform3fv(facet.u.uCam, view.eye);
    gl.bindVertexArray(gfx.pyramid.vao);
    gl.uniform3f(facet.u.uFace, 0.25, 0.01, 0.0);
    gl.uniform3f(facet.u.uEdge, 1.0, 0.08, 0.05);
    spikes.forEach(function (o) {
      var nx = Math.max(1, Math.round(o.hx / 0.35)), nz = Math.max(1, Math.round(o.hz / 0.35));
      var sx = o.hx / nx, sz = o.hz / nz;
      gl.uniform1f(facet.u.uYaw, o.yaw || 0);
      gl.uniform3f(facet.u.uScale, sx, o.hy, sz);
      for (var i = 0; i < nx; i++) for (var j = 0; j < nz; j++) {
        var lx = -o.hx + sx * (2 * i + 1), lz = -o.hz + sz * (2 * j + 1);
        gl.uniform3fv(facet.u.uCentre, W([o.x + lx * o.ux + lz * o.vx, o.y, o.z + lx * o.uz + lz * o.vz]));
        gl.drawArrays(gl.TRIANGLES, 0, gfx.pyramid.count);
      }
    });
    gl.bindVertexArray(gfx.gem.vao);
    var api = gemsApi();
    run.course.gems.forEach(function (gm) {
      if (run.got[gm.id] || gm.s < run.s - 0.8 || !inView(gm.x, gm.z, 0)) return;   // passed ones would hang in front of the camera
      var r = rarityOf(gm), k = api ? api.rarities[r] : { size: 1, spin: 1 };
      var col = api ? api.colours(r, time) : { edge: [0.3, 1, 0.3], face: [0, 0.16, 0.01] };
      var s = 0.36 * (k.size || 1);
      gl.uniform3fv(facet.u.uFace, col.face);
      gl.uniform3fv(facet.u.uEdge, col.edge);
      gl.uniform3f(facet.u.uScale, s, s, s);
      gl.uniform1f(facet.u.uYaw, time * 1.4 * (k.spin || 1) + gm.id);
      gl.uniform3fv(facet.u.uCentre, W([gm.x, gm.y + Math.sin(time * 2 + gm.id) * 0.08, gm.z]));
      gl.drawArrays(gl.TRIANGLES, 0, gfx.gem.count);
    });

    // The ball, in your skin.
    var b = run.ball, pos = W([b.x, b.y, b.z]);
    {
      var m = spin, o2w = new Float32Array([m[0] * R, m[1] * R, m[2] * R, 0, m[3] * R, m[4] * R, m[5] * R, 0, m[6] * R, m[7] * R, m[8] * R, 0, pos[0], pos[1], pos[2], 1]);
      var skins = window.SlopeSkins;
      if (gfx.ball && skins && skins.equipped) {
        gfx.ball.use(skins.equipped(), vp, o2w, view.eye, norm([0.35, 0.8, -0.5]), time);
      } else {
        gl.useProgram(box.p);
      }
      gl.bindVertexArray(gfx.sphere);
      gl.drawElements(gl.TRIANGLES, gfx.sphereCount, gl.UNSIGNED_SHORT, 0);
    }

    // Its shadow on whatever is below it.
    var under = floorUnder(b, t);
    if (under !== null && b.y - under < 12) {
      gl.useProgram(box.p);
      gl.bindVertexArray(gfx.cube.vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      var size = R * Math.max(0.45, 1 - (b.y - R - under) * 0.08);
      boxAt([b.x, under + 0.02, b.z], size, 0.01, size, 5, 0, 1);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  function floorUnder(b, t) {
    var top = null;
    run.course.items.forEach(function (o) {
      var dx = o.x - b.x, dz = o.z - b.z, r = (o.reach || 0) + 1;
      if (!o.solid || dx * dx + dz * dz > r * r) return;
      var c = core.at(o, t, run), l = core.local(o, c, b);
      if (Math.abs(l[0]) > o.hx || Math.abs(l[2]) > o.hz) return;
      var y = c[1] + o.hy;
      if (y <= b.y + 0.05 && (top === null || y > top)) top = y;
    });
    return top;
  }

  // --- Screens ------------------------------------------------------------------------------------------

  var ICONS = {
    lock: [".###.", "#...#", "#...#", "#####", "##.##", "##.##", "#####"],
    check: ["....#", "...##", "#.##.", "###..", ".#..."],
    pause: ["##.##", "##.##", "##.##", "##.##", "##.##"]
  };
  function icon(name, size) {
    var rows = ICONS[name], w = rows[0].length, dots = "";
    rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) if (row[x] === "#") dots += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.45"/>';
    });
    return '<svg viewBox="0 0 ' + w + " " + rows.length + '" width="' + size * w + '" height="' + size * rows.length +
      '" fill="currentColor" aria-hidden="true" focusable="false">' + dots + "</svg>";
  }
  function cells() { var h = ""; for (var i = 0; i < 20; i++) h += '<span class="slope-xp-cell"></span>'; return h; }
  function fill(bar, f) {
    var on = Math.round(f * 20);
    Array.prototype.forEach.call(bar.children, function (c, i) { c.classList.toggle("is-on", i < on); });
  }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }

  function screen(cls, inner) {
    var s = document.createElement("div");
    s.className = "slope-career " + cls;
    s.setAttribute("role", "dialog");
    s.hidden = true;
    s.innerHTML = inner;
    window.SlopeUI.root.appendChild(s);
    return s;
  }

  function build(ui) {
    var root = document.createElement("div");
    root.className = "slope-plat";
    root.hidden = true;
    root.innerHTML = '<canvas class="slope-plat-canvas" aria-label="Platformer"></canvas>';
    document.body.appendChild(root);

    // Dragging on the game looks around (mouse or finger).
    var canvas = root.querySelector("canvas"), drag = null;
    canvas.addEventListener("pointerdown", function (e) {
      if (state !== "playing") return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      look.yaw -= (e.clientX - drag.x) * 0.006;
      look.tilt += (e.clientY - drag.y) * 0.004;
      look.last = performance.now();
      drag.x = e.clientX; drag.y = e.clientY;
    });
    ["pointerup", "pointercancel"].forEach(function (t) {
      canvas.addEventListener(t, function () { drag = null; canvas.classList.remove("is-dragging"); });
    });

    // The controls, for the first seconds of a run (in the UI root, for its colours).
    var keys = document.createElement("p");
    keys.className = "slope-plat-keys";
    keys.hidden = true;
    keys.textContent = "W A S D to roll  \u00b7  Space to jump (hold for higher)  \u00b7  Arrows or drag to look around  \u00b7  Esc to pause";
    ui.root.appendChild(keys);

    var hud = document.createElement("div");
    hud.className = "slope-adventure-hud slope-plat-hud";
    hud.hidden = true;
    hud.innerHTML = '<p class="slope-adventure-hud-title"></p>' +
      '<div class="slope-xp-bar slope-adventure-hud-bar" aria-hidden="true">' + cells() + "</div>" +
      '<p class="slope-adventure-hud-togo"></p>';
    ui.root.appendChild(hud);

    // Touch screens: a pad to roll and a jump button.
    var touch = document.createElement("div");
    touch.className = "slope-plat-touch";
    touch.hidden = true;
    touch.innerHTML =
      '<div class="slope-plat-pad">' +
        [["fwd", "Forward", "^"], ["left", "Left", "<"], ["right", "Right", ">"], ["back", "Back", "v"]].map(function (b) {
          return '<button type="button" class="slope-btn slope-plat-touch-' + b[0] + '" data-key="' + b[0] + '" aria-label="' + b[1] + '">' + b[2] + "</button>";
        }).join("") +
      "</div>" +
      '<button type="button" class="slope-btn slope-plat-jump" data-key="jump">Jump</button>';
    ui.root.appendChild(touch);
    Array.prototype.forEach.call(touch.querySelectorAll("[data-key]"), function (b) {
      var k = b.getAttribute("data-key");
      function down(e) {
        e.preventDefault();
        if (state !== "playing") return;
        if (k === "jump" && !held.jump) jumpQueued = true;
        held[k] = true;
        b.setAttribute("aria-pressed", "true");
      }
      function up() { held[k] = false; b.setAttribute("aria-pressed", "false"); }
      b.addEventListener("pointerdown", down);
      ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) { b.addEventListener(t, up); });
      b.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    });

    var pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.className = "slope-btn slope-plat-pause";
    pauseBtn.setAttribute("aria-label", "Pause");
    pauseBtn.innerHTML = icon("pause", 4);
    pauseBtn.hidden = true;
    ui.root.appendChild(pauseBtn);

    var intro = document.createElement("div");
    intro.className = "slope-level-intro";
    intro.setAttribute("role", "status");
    intro.hidden = true;
    intro.innerHTML = '<p class="slope-level-intro-title"></p><p class="slope-level-intro-kinds"></p><p class="slope-level-intro-goal"></p>';
    ui.root.appendChild(intro);

    var pauseScreen = screen("slope-adventure-result slope-plat-paused",
      '<div class="slope-career-inner slope-result-inner">' +
        '<h2 class="slope-career-title slope-result-title" id="slope-plat-pause-title">Paused</h2>' +
        '<p class="slope-result-line"></p>' +
        '<div class="slope-career-actions">' +
          '<button type="button" class="slope-btn slope-plat-resume">Resume</button>' +
          '<button type="button" class="slope-btn slope-plat-restart">Restart</button>' +
          '<button type="button" class="slope-btn slope-plat-levels">Levels</button>' +
          '<button type="button" class="slope-btn slope-plat-quit">Menu</button>' +
        "</div>" +
      "</div>");
    pauseScreen.setAttribute("aria-labelledby", "slope-plat-pause-title");

    var result = screen("slope-adventure-result slope-plat-result",
      '<div class="slope-career-inner slope-result-inner">' +
        '<h2 class="slope-career-title slope-result-title" id="slope-plat-result-title"></h2>' +
        '<p class="slope-result-line"></p>' +
        '<div class="slope-xp-bar slope-result-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Progress">' + cells() + "</div>" +
        '<p class="slope-result-stats"></p>' +
        '<div class="slope-career-actions">' +
          '<button type="button" class="slope-btn slope-result-main"></button>' +
          '<button type="button" class="slope-btn slope-result-levels">Levels</button>' +
          '<button type="button" class="slope-btn slope-result-modes">Modes</button>' +
          '<button type="button" class="slope-btn slope-result-menu">Menu</button>' +
        "</div>" +
      "</div>");
    result.setAttribute("aria-labelledby", "slope-plat-result-title");

    var grid = screen("slope-adventure slope-plat-levels-screen",
      '<div class="slope-career-inner slope-adventure-inner">' +
        '<h2 class="slope-career-title" id="slope-plat-levels-title">Platformer</h2>' +
        '<p class="slope-adventure-note">Jump your way to the finish line to unlock the next level. Red things and falling off end the try.</p>' +
        '<button type="button" class="slope-btn slope-adventure-continue"></button>' +
        '<ol class="slope-levels"></ol>' +
        '<div class="slope-career-actions">' +
          '<button type="button" class="slope-btn slope-levels-more">More levels</button>' +
          '<button type="button" class="slope-btn slope-back">Back</button>' +
        "</div>" +
      "</div>");
    grid.setAttribute("aria-labelledby", "slope-plat-levels-title");

    var unsupported = screen("slope-adventure-result slope-plat-unsupported",
      '<div class="slope-career-inner slope-result-inner">' +
        '<h2 class="slope-career-title slope-result-title">Platformer</h2>' +
        "<p class=\"slope-result-line\">This browser can't draw the platformer (it needs WebGL 2).</p>" +
        '<div class="slope-career-actions"><button type="button" class="slope-btn slope-back">Back</button></div>' +
      "</div>");

    els = {
      root: root, canvas: root.querySelector("canvas"), keys: keys,
      hud: hud, hudTitle: hud.querySelector(".slope-adventure-hud-title"), hudBar: hud.querySelector(".slope-adventure-hud-bar"),
      hudLine: hud.querySelector(".slope-adventure-hud-togo"),
      pause: pauseBtn, intro: intro, touch: touch,
      pauseScreen: pauseScreen, pauseTitle: pauseScreen.querySelector(".slope-result-title"), pauseLine: pauseScreen.querySelector(".slope-result-line"),
      resume: pauseScreen.querySelector(".slope-plat-resume"), pauseLevels: pauseScreen.querySelector(".slope-plat-levels"),
      result: result, resultTitle: result.querySelector(".slope-result-title"), resultLine: result.querySelector(".slope-result-line"),
      resultBar: result.querySelector(".slope-result-bar"), resultStats: result.querySelector(".slope-result-stats"),
      resultMain: result.querySelector(".slope-result-main"), resultLevels: result.querySelector(".slope-result-levels"),
      grid: grid, list: grid.querySelector(".slope-levels"), cont: grid.querySelector(".slope-adventure-continue"),
      unsupported: unsupported
    };
    els.own = new Set([pauseScreen, result, grid, unsupported]);

    pauseBtn.addEventListener("click", pause);
    els.resume.addEventListener("click", resume);
    pauseScreen.querySelector(".slope-plat-restart").addEventListener("click", function () { restart(); });
    els.pauseLevels.addEventListener("click", function () { quit(false); openLevels(null); });
    pauseScreen.querySelector(".slope-plat-quit").addEventListener("click", function () { quit(false); });
    els.resultMain.addEventListener("click", function () {
      var next = +els.resultMain.getAttribute("data-level");
      start(mode, next);
    });
    els.resultLevels.addEventListener("click", function () { quit(false); openLevels(null); });
    result.querySelector(".slope-result-modes").addEventListener("click", function () { quit(true); });
    result.querySelector(".slope-result-menu").addEventListener("click", function () { quit(false); });
    els.cont.addEventListener("click", function () { start("adventure", profile.get().platUnlocked); });
    grid.querySelector(".slope-levels-more").addEventListener("click", function () { addLevels(LEVEL_STEP); });
    grid.querySelector(".slope-back").addEventListener("click", closeLevels);
    grid.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLevels(); });
    els.list.addEventListener("click", function (e) {
      var tile = e.target.closest("[data-level]");
      if (tile && !tile.disabled) start("adventure", +tile.getAttribute("data-level"));
    });
    unsupported.querySelector(".slope-back").addEventListener("click", function () {
      unsupported.hidden = true;
      if (window.SlopeModes) window.SlopeModes.open(null);
    });
    profile.onChange(function () { if (!grid.hidden) renderTiles(); });
  }

  function restart() {
    var n = levelN, m = mode;
    quit(false);
    start(m, n);
  }

  function hideScreens() {
    if (!els) return;
    [els.pauseScreen, els.result, els.grid, els.unsupported].forEach(function (s) {
      if (s.contains(document.activeElement)) document.activeElement.blur();
      s.hidden = true;
    });
  }

  function showUnsupported() {
    hideScreens();
    els.unsupported.hidden = false;
    els.unsupported.querySelector(".slope-back").focus({ preventScroll: true });
  }

  var introTimer = 0, keysTimer = 0;
  function showIntro() {
    var spec = mode === "adventure" ? core.level(levelN) : null;
    els.intro.querySelector(".slope-level-intro-title").textContent = spec ? "Level " + levelN : "Endless";
    els.intro.querySelector(".slope-level-intro-kinds").textContent = spec ? spec.title : "How far can you go?";
    els.intro.querySelector(".slope-level-intro-goal").textContent = spec
      ? (spec.fresh ? core.KINDS[spec.fresh].text + ". " : "") + "Reach the finish line"
      : best ? "Your best is " + fmt(best) + " m" : "Jump the gaps, dodge the red";
    els.intro.hidden = false;
    clearTimeout(introTimer);
    introTimer = setTimeout(hideIntro, 2600);
    els.keys.hidden = coarse.matches;
    clearTimeout(keysTimer);
    keysTimer = setTimeout(function () { els.keys.hidden = true; }, 7000);
  }
  function hideIntro() { clearTimeout(introTimer); if (els) els.intro.hidden = true; }

  function renderHud() {
    var title, line, frac;
    if (mode === "adventure") {
      title = "Level " + levelN + "  " + core.level(levelN).title;
      frac = progress();
      line = Math.max(0, Math.ceil(run.course.length - run.furthest)) + " m to go  \u00b7  " + run.t.toFixed(1) + " s";
    } else {
      title = "Endless  " + fmt(metres()) + " m";
      frac = best ? Math.min(1, metres() / best) : 0;
      line = (best ? (metres() > best ? "New best!" : "Best " + fmt(best) + " m") : "Your first run") +
        "  \u00b7  speed x" + (core.speed(run) / core.SPEED).toFixed(2);
    }
    if (tally && tally.gems) line += "  \u00b7  +" + fmt(tally.gems) + " gems";
    if (els.hudTitle.textContent !== title) els.hudTitle.textContent = title;
    if (els.hudLine.textContent !== line) els.hudLine.textContent = line;
    fill(els.hudBar, frac);
  }

  function showResult(won, xp, seconds, unlockedBefore) {
    var adv = mode === "adventure";
    var hit = run.dead && core.KINDS[run.dead] && core.KINDS[run.dead].hit;
    var cause = run.dead === "fell" ? "You fell off." : run.dead === "post" ? "You hit a sweeper's post." : hit ? "You hit " + hit + "." : "";
    els.result.classList.toggle("is-won", won);
    if (adv) {
      els.resultTitle.textContent = "Level " + levelN + (won ? " complete" : " failed");
      els.resultLine.textContent = won
        ? (unlockedBefore === levelN ? "Level " + (levelN + 1) + " unlocked." : best && seconds < best ? "New best time!" : "Well jumped.")
        : cause;
      fill(els.resultBar, progress());
      els.resultBar.setAttribute("aria-valuenow", String(Math.round(progress() * 100)));
    } else {
      els.resultTitle.textContent = fmt(metres()) + " m";
      els.resultLine.textContent = (metres() > best ? "New best! " : "") + cause;
      fill(els.resultBar, best ? Math.min(1, metres() / Math.max(best, metres())) : 1);
    }
    var bestTime = adv ? (profile.get().platTimes[levelN] || 0) / 10 : 0;
    els.resultStats.textContent = (adv ? (won ? "Time " + seconds.toFixed(1) + " s" + (bestTime ? "  \u00b7  Best " + bestTime.toFixed(1) + " s" : "") : Math.round(progress() * 100) + "% of the level")
      : "Best " + fmt(Math.max(best, metres())) + " m") +
      "  \u00b7  " + run.jumps + (run.jumps === 1 ? " jump" : " jumps") +
      (tally.gems ? "  \u00b7  +" + fmt(tally.gems) + (tally.gems === 1 ? " gem" : " gems") : "") +
      (xp && xp.xp ? "  \u00b7  +" + fmt(xp.xp) + " XP" : "");
    els.resultMain.textContent = adv ? (won ? "Next level" : "Retry") : "Again";
    els.resultMain.setAttribute("data-level", String(adv ? (won ? levelN + 1 : levelN) : 0));
    els.resultLevels.hidden = !adv;
    els.hud.hidden = true;
    els.pause.hidden = true;
    els.touch.hidden = true;
    els.result.hidden = false;
    els.resultMain.focus({ preventScroll: true });
  }

  // --- Level grid ---------------------------------------------------------------------------------------

  function tileHtml(n, unlocked, times) {
    var spec = core.level(n), beaten = n < unlocked, next = n === unlocked, locked = n > unlocked;
    var kind = spec.fresh ? core.KINDS[spec.fresh].name : core.KINDS[spec.kinds[0]].name + " +" + (spec.kinds.length - 1);
    var time = times[n] ? (times[n] / 10).toFixed(1) + " s" : "";
    var label = "Level " + n + ", " + spec.title + (beaten ? ", beaten" + (time ? ", best " + time : "") : locked ? ", locked" : ", play next");
    return '<li><button type="button" class="slope-btn slope-level-tile' + (beaten ? " is-beaten" : "") + (next ? " is-next" : "") +
      '" data-level="' + n + '"' + (locked ? " disabled" : "") + ' aria-label="' + label + '">' +
      '<span class="slope-level-num">' + n + "</span>" +
      '<span class="slope-level-kind">' + (locked ? icon("lock", 3) : beaten && time ? icon("check", 3) + " " + time : kind) + "</span>" +
      "</button></li>";
  }

  function renderTiles() {
    var p = profile.get(), html = "";
    for (var n = 1; n <= shownLevels; n++) html += tileHtml(n, p.platUnlocked, p.platTimes);
    els.list.innerHTML = html;
    els.cont.textContent = "Play level " + p.platUnlocked;
    els.cont.setAttribute("aria-label", "Play level " + p.platUnlocked + ", " + core.level(p.platUnlocked).title);
  }

  function addLevels(count) {
    var p = profile.get(), html = "";
    for (var i = 0; i < count; i++) html += tileHtml(++shownLevels, p.platUnlocked, p.platTimes);
    els.list.insertAdjacentHTML("beforeend", html);
  }

  function openLevels(from) {
    if (!els) return;
    openedFrom = from || null;
    window.SlopeUI.closeSettings();
    var unlocked = profile.get().platUnlocked;
    shownLevels = Math.max(shownLevels, Math.ceil((unlocked + LEVEL_STEP) / 6) * 6);
    renderTiles();
    hideScreens();
    els.grid.hidden = false;
    els.grid.scrollTop = 0;
    game.pause("platformer-levels");
    var next = els.list.querySelector(".is-next");
    if (next && next.getBoundingClientRect().bottom > window.innerHeight) next.scrollIntoView({ block: "center" });
    els.cont.focus({ preventScroll: true });
  }

  function closeLevels() {
    els.grid.hidden = true;
    game.resume("platformer-levels");
    if (window.SlopeModes) window.SlopeModes.open(openedFrom);
    openedFrom = null;
  }

  window.SlopeUI.ready(build);

  window.SlopePlatformer = {
    start: function (kind, n) { return start(kind, n); },
    openLevels: openLevels,
    active: function () { return state !== "off"; },
    pause: pause,
    resume: resume,
    quit: function () { quit(false); },
    state: function () {
      return run ? { mode: mode, level: levelN, state: state, t: run.t, ball: Object.assign({}, run.ball, { ground: run.ball.ground ? run.ball.ground.kind : null }),
        dead: run.dead, won: run.won, jumps: run.jumps, metres: metres(), progress: mode === "adventure" ? progress() : null, gems: tally ? tally.gems : 0,
        s: run.s, camYaw: camYaw, courseYaw: courseYaw, look: Object.assign({}, look), speed: core.speed(run),
        items: run.course.items.length } : null;
    },
    run: function () { return run; },
    keys: function () { return { held: Object.assign({}, held), jumpQueued: jumpQueued }; },
    core: core
  };
})();
