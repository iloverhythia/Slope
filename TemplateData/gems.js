/*
 * Gems: collectibles on the track ahead of the ball.
 *
 * Gems are drawn inside the game's own 3D scene (see "scene" in
 * game-bridge.js), so the walls and the ball hide them, they get the game's
 * antialiasing, and the track colour setting tints them like everything else.
 * They are built like the game's own pieces: dark faces with bright neon
 * edges, resting on their tip on the track and turning slowly.
 *
 * Gems are placed on stretches of track whose floor edges can be measured
 * from what the game draws, at the height of the floor the ball is rolling
 * on. Roll through one to collect it; it simply disappears. Collected gems
 * are saved to the profile and spent in the skin shop (skins.js). They
 * have no effect on the game itself.
 *
 *   SlopeGems.list()         gems still on the track (slope coordinates)
 *   SlopeGems.iconSvg(w, h)  the dot-matrix gem icon, as SVG markup
 *   SlopeGems.currentRun()   { gems, seconds } for the run in progress
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  if (!game) return;

  var BALL_RADIUS = 0.5;
  var GEM_RADIUS = 0.36;        // world units, centre to the side corners
  var GEM_TALL = 1.35;          // tip-to-centre height, relative to the radius
  var REST = GEM_RADIUS * GEM_TALL + 0.02; // centre above the floor: resting on its tip
  var SPIN = 1.4;               // radians per second
  var SPAWN_AHEAD = 80;         // place gems this far down the track
  var GAP_MIN = 20, GAP_MAX = 38;
  var EDGE_MARGIN = 1.1;        // keep away from the track's edges
  var PICKUP = { s: 0.95, x: 0.95, h: 1.6 };

  // Slope directions in world space: up off the track, sideways, downhill.
  var NORMAL = [0, Math.SQRT1_2, Math.SQRT1_2];
  var SIDE = [1, 0, 0];
  var DOWNHILL = [0, -Math.SQRT1_2, Math.SQRT1_2];

  var gems = [];
  var running = false;
  var nextS = null;
  var floorH = null;
  var lastBall = null;
  var grounded = 0;            // frames the ball has been on the floor
  var lastTime = 0;
  var run = { gems: 0, start: 0 };

  // --- Placement -------------------------------------------------------------

  // The tunnel floors are single meshes, so their edges can be measured from
  // what the game draws. Other stretches (the city) are drawn in batches that
  // can't be measured, so they get no gems rather than gems beside the track.
  function isFloor(p) { return p.x1 - p.x0 < 9; }

  function trackRange(pieces, s) {
    var lo = -Infinity, hi = Infinity, any = false;
    pieces.forEach(function (p) {
      if (!isFloor(p) || s < p.s0 || s > p.s1) return;
      lo = Math.max(lo, p.x0); hi = Math.min(hi, p.x1); any = true;
    });
    if (!any || hi - lo < 2 * EDGE_MARGIN) return null;
    return { lo: lo + EDGE_MARGIN, hi: hi - EDGE_MARGIN };
  }

  // The first point at or after s that has measured floor under it.
  function nextFloor(pieces, s) {
    var best = Infinity;
    pieces.forEach(function (p) {
      if (isFloor(p) && p.s1 > s) best = Math.min(best, Math.max(p.s0, s));
    });
    return best;
  }

  function spawnAhead(frame) {
    var ball = frame.ball;
    // Never place a gem close enough to be seen appearing.
    nextS = Math.max(nextS === null ? -Infinity : nextS, ball.s + 30);
    for (var guard = 0; guard < 8; guard++) {
      var s = nextFloor(frame.pieces, nextS);
      if (s > ball.s + SPAWN_AHEAD) return;
      var range = trackRange(frame.pieces, s);
      if (!range) { nextS = s + 4; continue; }
      var x = range.lo + Math.random() * (range.hi - range.lo);
      var line = Math.random() < 0.3 ? 3 : 1;
      for (var i = 0; i < line; i++) {
        if (i && !trackRange(frame.pieces, s + i * 3.5)) break;
        gems.push({ s: s + i * 3.5, x: x, h: floorH + REST, turn: Math.random() * Math.PI });
      }
      nextS = s + GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN) + (line - 1) * 3.5;
    }
  }

  // --- Run lifecycle ---------------------------------------------------------

  function reset() {
    gems = [];
    nextS = null;
    floorH = null;
    lastBall = null;
    grounded = 0;
  }

  game.on("runstart", function () {
    reset();
    running = true;
    run = { gems: 0, start: performance.now() };
  });

  game.on("runend", function () {
    running = false;
    gems = [];
  });

  // --- Per frame -------------------------------------------------------------

  // Did the ball pass through the gem since the last frame? Checking the whole
  // path, not just where the ball is now, keeps fast balls and slow frames fair.
  function touches(g, from, to) {
    var lo = Math.min(from.s, to.s) - PICKUP.s, hi = Math.max(from.s, to.s) + PICKUP.s;
    if (g.s < lo || g.s > hi) return false;
    var span = to.s - from.s;
    var t = span ? Math.max(0, Math.min(1, (g.s - from.s) / span)) : 1;
    var x = from.x + (to.x - from.x) * t, h = from.h + (to.h - from.h) * t;
    return Math.abs(g.x - x) < PICKUP.x && Math.abs(g.h - h) < PICKUP.h;
  }

  game.on("frame", function (frame) {
    var ball = frame.ball;
    var now = performance.now();
    var dt = lastTime ? Math.min(0.25, (now - lastTime) / 1000) : 0;
    lastTime = now;
    if (lastBall && ball.s < lastBall.s - 20) reset(); // the ball was moved back
    // The floor is the track under the ball. Rolling on it, the ball keeps its
    // height above the slope; on the starting ramp or in the air the height
    // changes as it moves, so the last floor is kept until it lands.
    var level = lastBall && Math.abs(ball.h - lastBall.h) < 0.02 + 0.05 * Math.abs(ball.s - lastBall.s);
    grounded = level ? grounded + 1 : 0;
    if (grounded > 3) floorH = ball.h - BALL_RADIUS;

    if (running) {
      if (floorH !== null && grounded > 3) spawnAhead(frame);
      var settle = 1 - Math.exp(-dt * 6);
      gems.forEach(function (g) {
        g.h += (floorH + REST - g.h) * settle; // follow the floor if it changes level
        if (lastBall && touches(g, lastBall, ball)) collect(g);
      });
      gems = gems.filter(function (g) { return !g.taken && g.s > ball.s - 8; });
    }
    lastBall = { s: ball.s, h: ball.h, x: ball.x };
  });

  function collect(g) {
    g.taken = true;
    run.gems += 1;
    if (window.SlopeProfile) window.SlopeProfile.addGems(1);
  }

  // --- Drawing in the game's scene ----------------------------------------------

  var VERTEX_SHADER = [
    "attribute vec3 aPos;",
    "attribute vec3 aBary;",
    "attribute vec3 aNormal;",
    "uniform mat4 uViewProjection;",
    "uniform vec3 uCentre, uSide, uUp, uDownhill;",
    "uniform float uRadius;",
    "varying vec3 vBary;",
    "varying float vLight;",
    "void main() {",
    "  vec3 world = uCentre + (uSide * aPos.x + uUp * aPos.y + uDownhill * aPos.z) * uRadius;",
    "  vec3 n = normalize(uSide * aNormal.x + uUp * aNormal.y + uDownhill * aNormal.z);",
    "  vLight = 0.35 + 0.65 * max(0.0, dot(n, normalize(vec3(0.35, 0.75, -0.55))));",
    "  vBary = aBary;",
    "  gl_Position = uViewProjection * vec4(world, 1.0);",
    "}"
  ].join("\n");

  // Green is the game's own neon: the track colour setting tints it with the rest.
  var FRAGMENT_SHADER = [
    "precision mediump float;",
    "varying vec3 vBary;",
    "varying float vLight;",
    "void main() {",
    "  float edge = min(min(vBary.x, vBary.y), vBary.z);",
    "  float line = 1.0 - smoothstep(0.045, 0.075, edge);",
    "  vec3 face = vec3(0.0, 0.16, 0.01) * vLight;",
    "  gl_FragColor = vec4(mix(face, vec3(0.3, 1.0, 0.3), line), 1.0);",
    "}"
  ].join("\n");

  // An octahedron: a point up, a point down, four corners around the middle.
  function gemMesh() {
    var top = [0, GEM_TALL, 0], bottom = [0, -GEM_TALL, 0];
    var ring = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]];
    var data = [];
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function face(a, b, c) {
      var n = cross(sub(b, a), sub(c, a));
      var len = Math.hypot(n[0], n[1], n[2]);
      n = [n[0] / len, n[1] / len, n[2] / len];
      [[a, [1, 0, 0]], [b, [0, 1, 0]], [c, [0, 0, 1]]].forEach(function (v) {
        data.push(v[0][0], v[0][1], v[0][2], v[1][0], v[1][1], v[1][2], n[0], n[1], n[2]);
      });
    }
    for (var i = 0; i < 4; i++) {
      var a = ring[i], b = ring[(i + 1) % 4];
      face(top, b, a);
      face(bottom, a, b);
    }
    return new Float32Array(data);
  }

  var res = null;     // GL resources for the game's context
  var failed = false;

  function setup(gl) {
    function shader(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    }
    var program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.bindAttribLocation(program, 0, "aPos");
    gl.bindAttribLocation(program, 1, "aBary");
    gl.bindAttribLocation(program, 2, "aNormal");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));

    var vertexArray = gl.createVertexArray();
    gl.bindVertexArray(vertexArray);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, gemMesh(), gl.STATIC_DRAW);
    for (var i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 36, i * 12);
    }
    var u = {};
    ["uViewProjection", "uCentre", "uSide", "uUp", "uDownhill", "uRadius"].forEach(function (name) {
      u[name] = gl.getUniformLocation(program, name);
    });
    return { gl: gl, program: program, vertexArray: vertexArray, u: u };
  }

  game.on("scene", function (scene) {
    if (!running || !gems.length || failed) return;
    var gl = scene.gl;
    if (!res || res.gl !== gl) {
      try { res = setup(gl); } catch (e) { failed = true; console.warn("Slope gems: can't draw", e); return; }
    }
    gl.useProgram(res.program);
    gl.bindVertexArray(res.vertexArray);
    gl.uniformMatrix4fv(res.u.uViewProjection, false, scene.vp);
    gl.uniform3fv(res.u.uUp, NORMAL);
    gl.uniform1f(res.u.uRadius, GEM_RADIUS);
    var t = performance.now() / 1000;
    gems.forEach(function (g) {
      var a = t * SPIN + g.turn, c = Math.cos(a), s = Math.sin(a);
      gl.uniform3fv(res.u.uCentre, game.toWorld(g.s, g.h, g.x));
      gl.uniform3f(res.u.uSide, SIDE[0] * c + DOWNHILL[0] * s, SIDE[1] * c + DOWNHILL[1] * s, SIDE[2] * c + DOWNHILL[2] * s);
      gl.uniform3f(res.u.uDownhill, DOWNHILL[0] * c - SIDE[0] * s, DOWNHILL[1] * c - SIDE[1] * s, DOWNHILL[2] * c - SIDE[2] * s);
      gl.drawArrays(gl.TRIANGLES, 0, 24);
    });
  });

  // --- HUD counter -----------------------------------------------------------

  // A dot-matrix gem, in the same round dots as the game's lettering.
  var GEM_DOTS = ["..###..", ".#####.", "#######", ".#####.", "..###..", "...#..."];

  function gemIcon(width, height) {
    var dots = "";
    GEM_DOTS.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        if (row[x] === "#") dots += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.45"/>';
      }
    });
    return '<svg viewBox="0 0 7 6" width="' + (width || 21) + '" height="' + (height || 18) +
      '" fill="currentColor" aria-hidden="true" focusable="false">' + dots + "</svg>";
  }

  // The counter also opens the skin shop, where gems are spent.
  function mountCounter(ui) {
    var counter = document.createElement("button");
    counter.type = "button";
    counter.className = "slope-btn slope-hud-item slope-gems";
    counter.title = "Skin shop";
    counter.innerHTML = gemIcon() + '<span class="slope-gems-count" aria-hidden="true">0</span>';
    ui.hud.appendChild(counter);
    var count = counter.querySelector(".slope-gems-count");
    function show(n) {
      count.textContent = String(n);
      counter.setAttribute("aria-label", "Skin shop, " + n + (n === 1 ? " gem" : " gems"));
    }
    show(0);
    counter.addEventListener("click", function () {
      if (window.SlopeShop) window.SlopeShop.open(counter);
    });
    if (window.SlopeProfile) window.SlopeProfile.onChange(function (p) { show(p.gems); });
  }

  if (window.SlopeUI) window.SlopeUI.ready(mountCounter);

  window.SlopeGems = {
    iconSvg: gemIcon,
    list: function () {
      return gems.map(function (g) { return { s: g.s, x: g.x, h: g.h }; });
    },
    currentRun: function () {
      return { gems: run.gems, seconds: run.start ? (performance.now() - run.start) / 1000 : 0 };
    }
  };
})();
