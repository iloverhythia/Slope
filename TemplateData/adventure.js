/*
 * Adventure: an endless ladder of levels, opened from the game's Adventure
 * menu button.
 *
 * Every level is a run of the normal game with a finish line and its own
 * set of obstacles, drawn into the game's 3D scene in the game's style
 * (black boxes with red neon edges): blocks, walls with a gap, sliders,
 * lasers that switch on and off, pillars that rise from the floor and
 * spinning bars. Levels 1 to 6 bring in one new obstacle each; after that
 * every level mixes two or three, and they get denser and faster.
 *
 * Touching an obstacle crashes the ball (the game's own "collide death").
 * Crossing the finish line ends the run quietly ("fall death") and unlocks
 * the next level. Progress is kept in the profile.
 *
 *   SlopeAdventure.open()        show the level grid
 *   SlopeAdventure.start(n)      play level n (if unlocked)
 *   SlopeAdventure.level(n)      the level's description
 *   SlopeAdventure.isClear(s)    false where a level obstacle stands (gems avoid it)
 *   SlopeAdventure.handlesRun()  true while the current run is an Adventure level
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var BALL_RADIUS = 0.45;        // the ball is 0.5; a little forgiving
  var ACTIVATE_AHEAD = 75;       // obstacles appear this far down the track
  var FIRST_OBSTACLE = 60;       // distance from the start
  var FALLBACK_HALF_WIDTH = 3.3; // the tunnel floor is about 6.7 wide
  var RED = [1.0, 0.08, 0.06];
  var WHITE = [1.0, 1.0, 1.0];
  var LEVEL_STEP = 18;           // levels added to the grid at a time

  var S = Math.SQRT1_2;
  var SIDE = [1, 0, 0];
  var NORMAL = [0, S, S];
  var DOWNHILL = [0, -S, S];

  // --- Levels ------------------------------------------------------------------

  var KINDS = {
    block: { name: "Blocks", hit: "a block" },
    wall: { name: "Walls", hit: "a wall" },
    slider: { name: "Sliders", hit: "a slider" },
    laser: { name: "Lasers", hit: "a laser" },
    pillar: { name: "Pillars", hit: "a pillar" },
    spinner: { name: "Spinners", hit: "a spinner" }
  };
  var ORDER = ["block", "wall", "slider", "laser", "pillar", "spinner"];

  // Small seeded random generator (mulberry32): the same level is the same every time.
  function seeded(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function levelSpec(n) {
    var random = seeded(n * 7919 + 13);
    var kinds;
    if (n <= ORDER.length) {
      // One new obstacle per level, mixed with the ones before it.
      kinds = [ORDER[n - 1]].concat(ORDER.slice(0, n - 1));
    } else {
      var pool = ORDER.slice();
      kinds = [];
      var count = 2 + Math.floor(random() * 2);
      while (kinds.length < count) kinds.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    }
    var hard = Math.min(1, (n - 1) / 30);
    return {
      n: n,
      kinds: kinds,                     // kinds[0] is the level's main obstacle
      length: Math.min(1400, 240 + 45 * (n - 1)),
      gap: 22 - 12 * hard,              // track between obstacles
      tempo: 1 + 0.8 * hard,            // speed of moving obstacles
      pairs: n >= 8,                    // some obstacles come two at a time
      seed: n * 7919 + 13,
      title: n <= ORDER.length || kinds.length === 1
        ? KINDS[kinds[0]].name
        : kinds.map(function (k) { return KINDS[k].name; }).join(" + ")
    };
  }

  function planLevel(spec) {
    var random = seeded(spec.seed + 1);
    var plan = [];
    var at = FIRST_OBSTACLE;
    while (at < spec.length - 25) {
      var kind = random() < 0.55 ? spec.kinds[0] : spec.kinds[Math.floor(random() * spec.kinds.length)];
      plan.push({ kind: kind, at: at, a: random(), b: random(), c: random() });
      at += spec.gap * (0.8 + random() * 0.5) + (kind === "spinner" ? 6 : 0);
    }
    return plan;
  }

  // --- Obstacles -----------------------------------------------------------------
  // Each part is a box in slope coordinates: centre (s, x, h above the floor's
  // surface), half sizes (hx sideways, hs along, hh up) and a turn in the
  // slope plane. Moving parts work out their pose from the clock.

  function box(s, x, hx, hs, hh, extra) {
    var part = { s: s, x: x, hx: hx, hs: hs, hh: hh, lift: 0, turn: 0, solid: true, glow: 0, color: RED };
    for (var k in extra) part[k] = extra[k];
    return part;
  }

  function buildObstacle(item, s, track, spec) {
    var cx = track.cx, hw = track.hw;
    var w = 2 * Math.PI;
    var t = spec.tempo;
    var parts = [];
    function across(v, margin) { return cx + (v * 2 - 1) * Math.max(0, hw - margin); }
    switch (item.kind) {
      case "block":
        parts.push(box(s, across(item.a, 0.7), 0.55, 0.55, 0.55));
        if (spec.pairs && item.c < 0.5) {
          var x2 = across(item.b, 0.7);
          if (Math.abs(x2 - parts[0].x) < 2.4) x2 = parts[0].x + (parts[0].x > cx ? -2.4 : 2.4);
          parts.push(box(s + 1.5, x2, 0.55, 0.55, 0.55));
        }
        break;
      case "wall":
        var gap = 2.4, gx = across(item.a, 1.6);
        var left = gx - gap / 2 - (cx - hw), right = cx + hw - (gx + gap / 2);
        if (left > 0.2) parts.push(box(s, cx - hw + left / 2, left / 2, 0.35, 0.5));
        if (right > 0.2) parts.push(box(s, gx + gap / 2 + right / 2, right / 2, 0.35, 0.5));
        break;
      case "slider":
        var reach = Math.max(0.5, hw - 0.9), period = 2.6 / t, phase = item.a * w;
        parts.push(box(s, cx, 0.8, 0.6, 0.6, { move: function (p, now) { p.x = cx + reach * Math.sin(now * w / period + phase); } }));
        if (spec.pairs && item.c < 0.4) {
          parts.push(box(s + 5, cx, 0.8, 0.6, 0.6, { move: function (p, now) { p.x = cx - reach * Math.sin(now * w / period + phase); } }));
        }
        break;
      case "laser":
        var cycle = 2.2 / t, offset = item.a * cycle;
        parts.push(box(s, cx, hw, 0.1, 0.1, {
          lift: 0.45,
          move: function (p, now) {
            var on = ((now + offset) % cycle) / cycle < 0.5;
            p.solid = on;
            p.glow = on ? 1 : 0;
            p.dim = !on;
          }
        }));
        parts.push(box(s, cx - hw - 0.15, 0.15, 0.15, 0.7, { solid: false }));
        parts.push(box(s, cx + hw + 0.15, 0.15, 0.15, 0.7, { solid: false }));
        break;
      case "pillar":
        var count = spec.pairs && item.c < 0.5 ? 2 : 1;
        for (var i = 0; i < count; i++) {
          (function (px, phase) {
            var span = 2.6 / t;
            parts.push(box(s, px, 0.7, 0.7, 1.1, {
              move: function (p, now) {
                // Up half the time, down (under the floor) the other half.
                var k = Math.max(0, Math.min(1, 0.5 + 1.4 * Math.sin(now * w / span + phase)));
                p.lift = (k - 1) * 2.3;
              }
            }));
          })(across(i ? item.b : item.a, 0.8), item.c * w + i * Math.PI);
        }
        break;
      case "spinner":
        var speed = (item.a < 0.5 ? 1 : -1) * w / (3.4 / t), start = item.b * w;
        parts.push(box(s, cx, hw * 0.85, 0.22, 0.45, { move: function (p, now) { p.turn = start + now * speed; } }));
        parts.push(box(s, cx, 0.3, 0.3, 0.6, { solid: true })); // the hub
        break;
    }
    parts.forEach(function (p) { p.kind = item.kind; });
    return parts;
  }

  function finishLine(s, track) {
    var cx = track.cx, hw = track.hw;
    return [
      box(s, cx, hw, 0.25, 0.02, { solid: false, glow: 1, color: WHITE, lift: -0.02 }),
      box(s, cx - hw - 0.25, 0.2, 0.2, 1.6, { solid: false, color: WHITE }),
      box(s, cx + hw + 0.25, 0.2, 0.2, 1.6, { solid: false, color: WHITE }),
      box(s, cx, hw + 0.45, 0.2, 0.2, { solid: false, color: WHITE, lift: 3.0, glow: 0.4 })
    ];
  }

  // Does a ball centred at (s, x, h) touch the part? (sphere against a turned box)
  function touches(p, s, x, h, floor) {
    var os = s - p.s, ox = x - p.x;
    if (Math.abs(os) > p.hx + p.hs + 1) return false;
    var c = Math.cos(p.turn), sn = Math.sin(p.turn);
    var lx = ox * c + os * sn, ls = -ox * sn + os * c;
    var lh = h - (floor + p.lift + p.hh);
    var dx = Math.max(0, Math.abs(lx) - p.hx);
    var ds = Math.max(0, Math.abs(ls) - p.hs);
    var dh = Math.max(0, Math.abs(lh) - p.hh);
    return dx * dx + ds * ds + dh * dh < BALL_RADIUS * BALL_RADIUS;
  }

  // --- The level being played ------------------------------------------------------

  var mode = null;      // null | "playing" | "won" | "failed"
  var run = null;       // { spec, plan, next, parts, startS, goalS, track, hit, progress }
  var pending = null;   // level to begin at the next run start
  var startTimer = 0;
  var menuTimer = 0;
  var gameAt = "menu";  // where the game is: "menu" | "run" | "score"

  function trackAt(pieces, s) {
    var lo = -Infinity, hi = Infinity, any = false;
    pieces.forEach(function (p) {
      if (p.x1 - p.x0 >= 9 || s < p.s0 || s > p.s1) return; // the tunnel floor only
      lo = Math.max(lo, p.x0); hi = Math.min(hi, p.x1); any = true;
    });
    return any && hi - lo > 3 ? { cx: (lo + hi) / 2, hw: (hi - lo) / 2 } : null;
  }

  function begin(n) {
    var spec = levelSpec(n);
    run = { spec: spec, plan: planLevel(spec), next: 0, parts: [], startS: null, goalS: null,
      track: null, hit: null, progress: 0, finishShown: false, last: null };
    mode = "playing";
    showHud();
  }

  function now() { return performance.now() / 1000; }

  game.on("frame", function (frame) {
    if (!run || mode === null || run.ended) return;
    var ball = frame.ball;
    if (run.startS === null) {
      run.startS = ball.s;
      run.goalS = ball.s + run.spec.length;
    }
    // Obstacles stand on the floor the ball rolls on; wait until it's known
    // (the ball starts on a ramp above the track).
    var floor = window.SlopeGems ? window.SlopeGems.floor() : ball.h - 0.5;
    if (floor === null || floor === undefined) { run.last = { s: ball.s, x: ball.x, h: ball.h }; return; }
    run.floor = floor;
    var measured = trackAt(frame.pieces, ball.s + 10);
    if (measured) run.track = measured;
    var fallback = run.track || { cx: ball.x, hw: FALLBACK_HALF_WIDTH };

    // Bring obstacles in as they come into view.
    while (run.next < run.plan.length && run.startS + run.plan[run.next].at < ball.s + ACTIVATE_AHEAD) {
      var item = run.plan[run.next++];
      var s = run.startS + item.at;
      run.parts = run.parts.concat(buildObstacle(item, s, trackAt(frame.pieces, s) || fallback, run.spec));
    }
    if (!run.finishShown && run.goalS < ball.s + ACTIVATE_AHEAD) {
      run.finishShown = true;
      run.parts = run.parts.concat(finishLine(run.goalS, trackAt(frame.pieces, run.goalS) || fallback));
    }
    var t = now();
    run.parts.forEach(function (p) { if (p.move) p.move(p, t); });
    run.parts = run.parts.filter(function (p) { return p.s > ball.s - 10; });

    if (mode === "playing") {
      // Check the whole path since the last frame, so fast balls can't skip through.
      var from = run.last || ball;
      var dist = Math.hypot(ball.s - from.s, ball.x - from.x, ball.h - from.h);
      var steps = Math.min(8, Math.max(1, Math.ceil(dist / 0.3)));
      for (var i = 1; i <= steps && !run.hit; i++) {
        var k = i / steps;
        var bs = from.s + (ball.s - from.s) * k, bx = from.x + (ball.x - from.x) * k, bh = from.h + (ball.h - from.h) * k;
        for (var j = 0; j < run.parts.length; j++) {
          var p = run.parts[j];
          if (p.solid && touches(p, bs, bx, bh, floor)) { run.hit = p.kind; break; }
        }
      }
      run.progress = Math.max(0, Math.min(1, (ball.s - run.startS) / run.spec.length));
      if (run.hit) {
        mode = "failed";
        if (!game.send("collide death")) showResult(null);
      } else if (ball.s >= run.goalS) {
        mode = "won";
        run.progress = 1;
        profile.completeLevel(run.spec.n);
        if (!game.send("fall death")) showResult(null);
      }
      renderHud();
    }
    run.last = { s: ball.s, x: ball.x, h: ball.h };
  });

  game.on("runstart", function () {
    gameAt = "run";
    clearInterval(startTimer);
    clearInterval(menuTimer);
    if (pending !== null) {
      var n = pending;
      pending = null;
      hideScreens();
      begin(n);
    } else {
      // A normal run (Play, or the game's own restart): not an Adventure level.
      mode = null;
      run = null;
      hideScreens();
      hideHud();
    }
  });

  game.on("runend", function (e) {
    gameAt = "score";
    if (!run || mode === null) return;
    if (mode === "playing") mode = "failed"; // the game's own crash or a fall
    run.ended = true;
    run.parts = [];
    showResult(e ? e.score : null);
    hideHud();
  });

  game.on("menu", function () {
    gameAt = "menu";
    clearInterval(menuTimer);
  });

  game.on("adventure", function () { openGrid(null); });

  // Ask the game to start a run, again until it does: right after a crash the
  // game is still on its way to the score screen and ignores the request.
  function start(n) {
    if (!(n >= 1 && n <= profile.get().advUnlocked)) return;
    pending = n;
    hideScreens();
    clearInterval(startTimer);
    clearInterval(menuTimer);
    var tries = 0;
    function attempt() {
      if (pending === null) { clearInterval(startTimer); return; }
      if (tries++ > 20) {
        clearInterval(startTimer);
        pending = null;
        openGrid(null);
        els.gridStatus.textContent = "The game didn't start. Try again.";
        return;
      }
      game.send("resetPressed");
    }
    attempt();
    startTimer = setInterval(attempt, 500);
  }

  function goToMenu() {
    hideScreens();
    mode = null;
    run = null;
    if (gameAt === "menu") return;
    var tries = 0;
    clearInterval(menuTimer);
    function attempt() {
      if (gameAt === "menu" || tries++ > 20) { clearInterval(menuTimer); return; }
      game.send("BackToHome");
    }
    attempt();
    menuTimer = setInterval(attempt, 500);
  }

  // --- Drawing ----------------------------------------------------------------------

  var VERTEX_SHADER = [
    "#version 300 es",
    "layout(location = 0) in vec3 aPos;",
    "layout(location = 1) in vec3 aNormal;",
    "uniform mat4 uViewProjection;",
    "uniform vec3 uCentre, uAxisX, uAxisY, uAxisZ, uHalf;",
    "out vec3 vLocal;",
    "out vec3 vNormal;",
    "void main() {",
    "  vec3 l = aPos * uHalf;",
    "  vLocal = l;",
    "  vNormal = aNormal;",
    "  gl_Position = uViewProjection * vec4(uCentre + uAxisX * l.x + uAxisY * l.y + uAxisZ * l.z, 1.0);",
    "}"
  ].join("\n");

  // Black faces and neon edges, like the game's own red blocks.
  var FRAGMENT_SHADER = [
    "#version 300 es",
    "precision highp float;",
    "in vec3 vLocal;",
    "in vec3 vNormal;",
    "uniform vec3 uHalf, uColor;",
    "uniform float uGlow, uEdge;",
    "out vec4 outColor;",
    "void main() {",
    "  vec3 e = uHalf - abs(vLocal);",
    "  float lo = min(e.x, min(e.y, e.z)), hi = max(e.x, max(e.y, e.z));",
    "  float mid = e.x + e.y + e.z - lo - hi;", // distance to the nearest edge
    "  float aa = fwidth(mid) + 1e-4;",
    "  float line = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, mid);",
    "  float light = 0.55 + 0.45 * max(0.0, dot(vNormal, normalize(vec3(0.3, 0.8, -0.5))));",
    "  vec3 face = mix(vec3(0.015), uColor * 0.9, uGlow) * light;",
    "  outColor = vec4(mix(face, uColor * uEdge, line), 1.0);",
    "}"
  ].join("\n");

  function cubeMesh() {
    var faces = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]
    ];
    var data = [];
    faces.forEach(function (f) {
      var n = f[0], u = f[1], v = f[2];
      function corner(a, b) { return [n[0] + u[0] * a + v[0] * b, n[1] + u[1] * a + v[1] * b, n[2] + u[2] * a + v[2] * b]; }
      [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]].forEach(function (ab) {
        data.push.apply(data, corner(ab[0], ab[1]).concat(n));
      });
    });
    return new Float32Array(data);
  }

  var gfx = null;
  var gfxFailed = false;

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
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, cubeMesh(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    var u = {};
    ["uViewProjection", "uCentre", "uAxisX", "uAxisY", "uAxisZ", "uHalf", "uColor", "uGlow", "uEdge"].forEach(function (name) {
      u[name] = gl.getUniformLocation(program, name);
    });
    return { gl: gl, program: program, vao: vao, u: u };
  }

  game.on("scene", function (scene) {
    if (!run || !run.parts.length || gfxFailed || run.floor === undefined) return;
    var gl = scene.gl;
    if (!gfx || gfx.gl !== gl) {
      try { gfx = setup(gl); } catch (e) { gfxFailed = true; console.warn("Slope adventure: can't draw obstacles", e); return; }
    }
    gl.useProgram(gfx.program);
    gl.bindVertexArray(gfx.vao);
    gl.uniformMatrix4fv(gfx.u.uViewProjection, false, scene.vp);
    gl.uniform3fv(gfx.u.uAxisY, NORMAL);
    run.parts.forEach(function (p) {
      var c = Math.cos(p.turn), sn = Math.sin(p.turn);
      gl.uniform3fv(gfx.u.uCentre, game.toWorld(p.s, run.floor + p.lift + p.hh, p.x));
      gl.uniform3f(gfx.u.uAxisX, SIDE[0] * c + DOWNHILL[0] * sn, SIDE[1] * c + DOWNHILL[1] * sn, SIDE[2] * c + DOWNHILL[2] * sn);
      gl.uniform3f(gfx.u.uAxisZ, DOWNHILL[0] * c - SIDE[0] * sn, DOWNHILL[1] * c - SIDE[1] * sn, DOWNHILL[2] * c - SIDE[2] * sn);
      gl.uniform3f(gfx.u.uHalf, p.hx, p.hh, p.hs);
      gl.uniform3fv(gfx.u.uColor, p.color);
      gl.uniform1f(gfx.u.uGlow, p.glow);
      gl.uniform1f(gfx.u.uEdge, p.dim ? 0.3 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    });
  });

  // --- Screens ------------------------------------------------------------------------

  var els = {};
  var shownLevels = 0;
  var openedFrom = null;

  // Dot-matrix icons in the game's lettering style.
  var ICONS = {
    lock: [".###.", "#...#", "#...#", "#####", "##.##", "##.##", "#####"],
    check: ["....#", "...##", "#.##.", "###..", ".#..."]
  };

  function icon(name, size) {
    var rows = ICONS[name], w = rows[0].length, dots = "";
    rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        if (row[x] === "#") dots += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.45"/>';
      }
    });
    return '<svg viewBox="0 0 ' + w + " " + rows.length + '" width="' + size * w + '" height="' + size * rows.length +
      '" fill="currentColor" aria-hidden="true" focusable="false">' + dots + "</svg>";
  }

  function xpCells() {
    var html = "";
    for (var i = 0; i < 20; i++) html += '<span class="slope-xp-cell"></span>';
    return html;
  }

  function fill(bar, fraction) {
    var on = Math.round(fraction * 20);
    Array.prototype.forEach.call(bar.children, function (cell, i) { cell.classList.toggle("is-on", i < on); });
  }

  function buildScreens(ui) {
    var grid = document.createElement("div");
    grid.className = "slope-career slope-adventure";
    grid.id = "slope-adventure";
    grid.setAttribute("role", "dialog");
    grid.setAttribute("aria-labelledby", "slope-adventure-title");
    grid.hidden = true;
    grid.innerHTML =
      '<div class="slope-career-inner slope-adventure-inner">' +
        '<h2 class="slope-career-title" id="slope-adventure-title">Adventure</h2>' +
        '<p class="slope-adventure-note">Reach the finish line to unlock the next level. Every level has its own obstacles: touch one and you crash.</p>' +
        '<button type="button" class="slope-btn slope-adventure-continue"></button>' +
        '<p class="slope-adventure-status" role="status"></p>' +
        '<ol class="slope-levels"></ol>' +
        '<div class="slope-career-actions">' +
          '<button type="button" class="slope-btn slope-levels-more">More levels</button>' +
          '<button type="button" class="slope-btn slope-back">Back</button>' +
        "</div>" +
      "</div>";
    ui.root.appendChild(grid);

    var result = document.createElement("div");
    result.className = "slope-career slope-adventure-result";
    result.setAttribute("role", "dialog");
    result.setAttribute("aria-labelledby", "slope-result-title");
    result.hidden = true;
    result.innerHTML =
      '<div class="slope-career-inner slope-result-inner">' +
        '<h2 class="slope-career-title slope-result-title" id="slope-result-title"></h2>' +
        '<p class="slope-result-line"></p>' +
        '<div class="slope-xp-bar slope-result-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Level progress">' + xpCells() + "</div>" +
        '<p class="slope-result-stats"></p>' +
        '<div class="slope-career-actions">' +
          '<button type="button" class="slope-btn slope-result-main"></button>' +
          '<button type="button" class="slope-btn slope-result-levels">Levels</button>' +
          '<button type="button" class="slope-btn slope-result-menu">Menu</button>' +
        "</div>" +
      "</div>";
    ui.root.appendChild(result);

    var hud = document.createElement("div");
    hud.className = "slope-adventure-hud";
    hud.hidden = true;
    hud.innerHTML =
      '<p class="slope-adventure-hud-title"></p>' +
      '<div class="slope-xp-bar slope-adventure-hud-bar" aria-hidden="true">' + xpCells() + "</div>";
    ui.root.appendChild(hud);

    els = {
      grid: grid,
      list: grid.querySelector(".slope-levels"),
      cont: grid.querySelector(".slope-adventure-continue"),
      gridStatus: grid.querySelector(".slope-adventure-status"),
      more: grid.querySelector(".slope-levels-more"),
      back: grid.querySelector(".slope-back"),
      result: result,
      resultTitle: result.querySelector(".slope-result-title"),
      resultLine: result.querySelector(".slope-result-line"),
      resultBar: result.querySelector(".slope-result-bar"),
      resultStats: result.querySelector(".slope-result-stats"),
      resultMain: result.querySelector(".slope-result-main"),
      hud: hud,
      hudTitle: hud.querySelector(".slope-adventure-hud-title"),
      hudBar: hud.querySelector(".slope-adventure-hud-bar")
    };

    els.cont.addEventListener("click", function () { start(profile.get().advUnlocked); });
    els.more.addEventListener("click", function () { addLevels(LEVEL_STEP); });
    els.back.addEventListener("click", function () {
      if (gameAt === "score") goToMenu(); else closeGrid();
    });
    els.list.addEventListener("click", function (e) {
      var tile = e.target.closest("[data-level]");
      if (tile && !tile.disabled) start(+tile.getAttribute("data-level"));
    });
    grid.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { if (gameAt === "score") goToMenu(); else closeGrid(); }
    });
    els.resultMain.addEventListener("click", function () {
      var n = +els.resultMain.getAttribute("data-level");
      start(n);
    });
    result.querySelector(".slope-result-levels").addEventListener("click", function () { openGrid(null); });
    result.querySelector(".slope-result-menu").addEventListener("click", goToMenu);

    // More levels appear as you scroll down: the grid never ends.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        if (entries.some(function (en) { return en.isIntersecting; }) && !grid.hidden) addLevels(LEVEL_STEP);
      }, { root: grid, rootMargin: "200px" }).observe(els.more);
    }

    profile.onChange(function () { if (!grid.hidden) renderTiles(); });
  }

  function tileHtml(n, unlocked) {
    var spec = levelSpec(n);
    var beaten = n < unlocked, next = n === unlocked, locked = n > unlocked;
    var kind = KINDS[spec.kinds[0]].name + (n > ORDER.length && spec.kinds.length > 1 ? " +" + (spec.kinds.length - 1) : "");
    var label = "Level " + n + ", " + spec.title + (beaten ? ", beaten" : locked ? ", locked" : ", play next");
    return '<li><button type="button" class="slope-btn slope-level-tile' + (beaten ? " is-beaten" : "") + (next ? " is-next" : "") +
      '" data-level="' + n + '"' + (locked ? " disabled" : "") + ' aria-label="' + label + '">' +
      '<span class="slope-level-num">' + n + "</span>" +
      '<span class="slope-level-kind">' + (locked ? icon("lock", 3) : (beaten ? icon("check", 3) + " " : "") + kind) + "</span>" +
      "</button></li>";
  }

  function renderTiles() {
    var unlocked = profile.get().advUnlocked;
    var html = "";
    for (var n = 1; n <= shownLevels; n++) html += tileHtml(n, unlocked);
    els.list.innerHTML = html;
    els.cont.textContent = "Play level " + unlocked;
    els.cont.setAttribute("aria-label", "Play level " + unlocked + ", " + levelSpec(unlocked).title);
  }

  function addLevels(count) {
    var unlocked = profile.get().advUnlocked;
    var html = "";
    for (var i = 0; i < count; i++) html += tileHtml(++shownLevels, unlocked);
    els.list.insertAdjacentHTML("beforeend", html);
  }

  function hideScreens() {
    if (!els.grid) return;
    els.grid.hidden = true;
    els.result.hidden = true;
  }

  function openGrid(from) {
    if (!els.grid) return;
    openedFrom = from || null;
    window.SlopeUI.closeSettings();
    var unlocked = profile.get().advUnlocked;
    shownLevels = Math.max(shownLevels, Math.ceil((unlocked + LEVEL_STEP) / 6) * 6);
    renderTiles();
    els.gridStatus.textContent = "";
    els.result.hidden = true;
    els.grid.hidden = false;
    var next = els.list.querySelector(".is-next");
    els.grid.scrollTop = 0;
    if (next && next.getBoundingClientRect().bottom > window.innerHeight) next.scrollIntoView({ block: "center" });
    els.cont.focus({ preventScroll: true });
  }

  function closeGrid() {
    els.grid.hidden = true;
    if (openedFrom && document.contains(openedFrom)) openedFrom.focus();
    else if (els.grid.contains(document.activeElement)) document.activeElement.blur();
    openedFrom = null;
  }

  function showResult(score) {
    if (!els.result || !run) return;
    var spec = run.spec, won = mode === "won";
    els.resultTitle.textContent = "Level " + spec.n + (won ? " complete" : " failed");
    els.resultLine.textContent = won
      ? (spec.n + 1 === profile.get().advUnlocked ? "Level " + (spec.n + 1) + " unlocked." : "Well rolled.")
      : run.hit ? "You hit " + KINDS[run.hit].hit + "." : "You crashed before the finish line.";
    fill(els.resultBar, run.progress);
    els.resultBar.setAttribute("aria-valuenow", String(Math.round(run.progress * 100)));
    var gems = window.SlopeGems ? window.SlopeGems.currentRun().gems : 0;
    els.resultStats.textContent = Math.round(run.progress * 100) + "% of the level" +
      (score !== null && score !== undefined ? "  \u00b7  Score " + score + "  \u00b7  +" + score * profile.xpPerPoint + " XP" : "") +
      (gems ? "  \u00b7  +" + gems + (gems === 1 ? " gem" : " gems") : "");
    els.resultMain.textContent = won ? "Next level" : "Retry";
    els.resultMain.setAttribute("data-level", String(won ? spec.n + 1 : spec.n));
    els.grid.hidden = true;
    els.result.classList.toggle("is-won", won);
    els.result.hidden = false;
    window.SlopeUI.closeSettings();
    els.resultMain.focus({ preventScroll: true });
  }

  function showHud() {
    if (!els.hud) return;
    var toast = window.SlopeUI.root.querySelector(".slope-toast");
    if (toast) toast.hidden = true;
    renderHud();
    els.hud.hidden = false;
  }

  function hideHud() {
    if (els.hud) els.hud.hidden = true;
  }

  function renderHud() {
    if (!els.hud || !run) return;
    var text = "Level " + run.spec.n + "  " + run.spec.title;
    if (els.hudTitle.textContent !== text) els.hudTitle.textContent = text;
    fill(els.hudBar, run.progress);
  }

  window.SlopeAdventure = {
    open: function (from) { openGrid(from); },
    start: start,
    level: levelSpec,
    isClear: function (s) {
      if (!run || run.startS === null || mode !== "playing") return true;
      for (var i = 0; i < run.plan.length; i++) {
        if (Math.abs(run.startS + run.plan[i].at - s) < (run.plan[i].kind === "spinner" ? 8 : 5)) return false;
      }
      return Math.abs(run.goalS - s) > 3;
    },
    handlesRun: function () { return !!run && mode !== null; }
  };

  window.SlopeUI.ready(buildScreens);
})();
