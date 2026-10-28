/*
 * Gems: collectibles placed on the track ahead of the ball.
 *
 * Gems are drawn on a canvas over the game, projected with the game camera
 * (from game-bridge.js) so they sit on the track and move with it. They are
 * placed between the track's edges, using the sideways extent of the track
 * pieces on screen, and hover just above the floor the ball is rolling on.
 * Roll through one to collect it. Collected gems are saved to the profile;
 * they can't be spent on anything yet.
 *
 *   SlopeGems.currentRun()   { gems, seconds } for the run in progress
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  if (!game) return;

  var BALL_RADIUS = 0.5;
  var GEM_SIZE = 0.42;          // world units, centre to tip
  var HOVER = 0.8;              // gem centre above the floor
  var SPAWN_AHEAD = 75;         // place gems this far down the track
  var FADE_IN = 18;             // fade in over this distance after spawning
  var GAP_MIN = 20, GAP_MAX = 38;
  var EDGE_MARGIN = 1.1;        // keep away from the track's edges
  var PICKUP = { s: 0.95, x: 0.95, h: 1.6 };

  var NORMAL = [0, Math.SQRT1_2, Math.SQRT1_2];   // slope "up"
  var SIDE = [1, 0, 0];
  var DOWNHILL = [0, -Math.SQRT1_2, Math.SQRT1_2];

  var gems = [];
  var pops = [];
  var running = false;
  var nextS = null;
  var floorH = null;
  var lastBall = null;
  var grounded = 0;            // frames the ball has been on the floor
  var lastTime = 0;
  var run = { gems: 0, start: 0 };
  var lastFrame = null;

  var canvas = document.createElement("canvas");
  canvas.className = "slope-fx";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  var counter = null;

  // --- Colour: the complement of the track colour ----------------------------

  function hexToHsl(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: max === 0 ? 0 : d / max };
  }

  function gemHue() {
    var theme = hexToHsl((window.SlopeUI && window.SlopeUI.themeColor) || "#00ff00");
    return theme.s < 0.2 ? 315 : (theme.h + 180) % 360; // white track: pink gems
  }

  // --- Placement -------------------------------------------------------------

  function trackRange(pieces, s) {
    var lo = -Infinity, hi = Infinity, any = false, narrow = false;
    pieces.forEach(function (p) {
      if (s < p.s0 || s > p.s1) return;
      var isNarrow = p.x1 - p.x0 < 9; // the side rails
      if (isNarrow && !narrow) { lo = -Infinity; hi = Infinity; narrow = true; }
      if (narrow && !isNarrow) return;
      lo = Math.max(lo, p.x0); hi = Math.min(hi, p.x1); any = true;
    });
    if (!any || hi - lo < 1) return null;
    return { lo: lo + EDGE_MARGIN, hi: hi - EDGE_MARGIN };
  }

  function spawnAhead(frame) {
    var ball = frame.ball;
    if (nextS === null) nextS = ball.s + 30;
    var guard = 0;
    while (nextS < ball.s + SPAWN_AHEAD && guard++ < 8) {
      var range = trackRange(frame.pieces, nextS);
      if (!range) { nextS += 8; continue; }
      var x = range.hi > range.lo ? range.lo + Math.random() * (range.hi - range.lo) : (range.lo + range.hi) / 2;
      var line = Math.random() < 0.3 ? 3 : 1;
      for (var i = 0; i < line; i++) {
        gems.push({ s: nextS + i * 3.5, x: x, h: floorH + HOVER, born: nextS + i * 3.5, spin: Math.random() * 6.3 });
      }
      nextS += GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN) + (line - 1) * 3.5;
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
    wipe(); // frames can stop as soon as the ball is gone
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
    lastFrame = frame;
    if (lastBall && ball.s < lastBall.s - 20) reset(); // the ball was moved back
    // The floor is the slope plane under the ball; keep the last value while airborne.
    var under = ball.h - BALL_RADIUS;
    var steady = lastBall && Math.abs(ball.h - lastBall.h) < 0.05 + dt * 2;
    grounded = steady ? grounded + 1 : 0;
    if (floorH === null || under < floorH || (steady && Math.abs(under - floorH) < 0.8)) floorH = under;

    if (running && grounded > 3) {
      spawnAhead(frame);
      var settle = 1 - Math.exp(-dt * 6);
      gems.forEach(function (g) {
        if (g.s - ball.s < 20) g.h += (floorH + HOVER - g.h) * settle; // settle onto the floor ahead
        if (!g.taken && lastBall && touches(g, lastBall, ball)) collect(g, frame);
      });
      gems = gems.filter(function (g) { return !g.taken && g.s > ball.s - 8; });
    }
    lastBall = { s: ball.s, h: ball.h, x: ball.x };
    draw(frame);
  });

  function collect(g, frame) {
    g.taken = true;
    run.gems += 1;
    var p = project(frame.vp, game.toWorld(g.s, g.h, g.x));
    if (p) pops.push({ x: p.x, y: p.y, t: performance.now(), hue: gemHue() });
    if (window.SlopeProfile) window.SlopeProfile.addGems(1);
    if (counter) {
      counter.classList.remove("is-bumped");
      void counter.offsetWidth; // restart the animation
      counter.classList.add("is-bumped");
    }
  }

  // --- Drawing ---------------------------------------------------------------

  var cssW = 0, cssH = 0, dpr = 1;

  function fit() {
    var game = document.getElementById("gameContainer");
    var rect = game ? game.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = rect.width; cssH = rect.height;
    canvas.style.left = rect.left + "px"; canvas.style.top = rect.top + "px";
    canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
    var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function project(vp, p) {
    var cx = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    var cy = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    var cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    if (cw < 0.3) return null;
    return { x: (cx / cw * 0.5 + 0.5) * cssW, y: (0.5 - cy / cw * 0.5) * cssH, w: cw };
  }

  function add(a, b, k) { return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]; }

  function drawGem(vp, g, time, hue, alpha) {
    var c = game.toWorld(g.s, g.h + Math.sin(time / 380 + g.spin) * 0.08, g.x);
    var spin = time / 700 + g.spin;
    var pts = [add(c, NORMAL, GEM_SIZE * 1.3), add(c, NORMAL, -GEM_SIZE * 1.3)];
    for (var k = 0; k < 4; k++) {
      var a = spin + k * Math.PI / 2;
      pts.push(add(add(c, SIDE, Math.cos(a) * GEM_SIZE), DOWNHILL, Math.sin(a) * GEM_SIZE));
    }
    var sp = pts.map(function (p) { return project(vp, p); });
    if (sp.some(function (p) { return !p; })) return;
    var centre = project(vp, c);
    var radius = Math.abs(sp[0].y - sp[1].y) * 0.75 + 2;

    ctx.globalAlpha = alpha;
    var glow = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius * 2.2);
    glow.addColorStop(0, "hsla(" + hue + ",100%,62%,0.55)");
    glow.addColorStop(1, "hsla(" + hue + ",100%,62%,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(centre.x, centre.y, radius * 2.2, 0, Math.PI * 2); ctx.fill();

    var faces = [];
    for (var i = 0; i < 4; i++) {
      var e1 = 2 + i, e2 = 2 + (i + 1) % 4;
      faces.push([0, e1, e2], [1, e2, e1]);
    }
    faces.forEach(function (f, n) {
      f.idx = n; // facets alternate light and dark, like a cut stone
      f.depth = (sp[f[0]].w + sp[f[1]].w + sp[f[2]].w) / 3;
    });
    faces.sort(function (p, q) { return q.depth - p.depth; }); // far faces first
    faces.forEach(function (f) {
      var a = sp[f[0]], b = sp[f[1]], d = sp[f[2]];
      var top = f[0] === 0;
      var light = top ? 60 + (f.idx % 4 < 2 ? 14 : 0) : 36 + (f.idx % 4 < 2 ? 10 : 0);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(d.x, d.y); ctx.closePath();
      ctx.fillStyle = "hsla(" + hue + ",100%," + light + "%,0.92)";
      ctx.fill();
      ctx.strokeStyle = "hsl(" + hue + ",100%,86%)";
      ctx.lineWidth = Math.max(1, radius / 14);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  var dirty = false; // something is drawn on the overlay

  function draw(frame) {
    fit();
    var time = performance.now();
    var shown = running ? gems : [];
    if (!shown.length && !pops.length) {
      if (dirty) { wipe(); dirty = false; }
      return;
    }
    dirty = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    var hue = gemHue();
    var ball = frame.ball;
    shown.slice().sort(function (a, b) { return b.s - a.s; }).forEach(function (g) {
      var age = (ball.s + SPAWN_AHEAD) - g.born;
      var alpha = Math.max(0, Math.min(1, age / FADE_IN));
      if (alpha > 0) drawGem(frame.vp, g, time, hue, alpha);
    });
    drawPops(time);
  }

  function drawPops(time) {
    pops = pops.filter(function (p) { return time - p.t < 650; });
    pops.forEach(function (p) {
      var k = (time - p.t) / 650;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = "hsl(" + p.hue + ",100%,70%)";
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10 + k * 34, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "hsl(" + p.hue + ",100%,74%)";
      ctx.font = '24px "Slope Chargen", monospace';
      ctx.textAlign = "center";
      ctx.fillText("+1", p.x, p.y - 18 - k * 40);
    });
    ctx.globalAlpha = 1;
  }

  // Clear the overlay for sure: resetting the size empties the canvas.
  function wipe() {
    var w = canvas.width;
    canvas.width = w;
  }

  // Keep the overlay clear when the game stops drawing frames with the ball.
  setInterval(function () {
    if (lastFrame && performance.now() - (lastFrame.seen || 0) > 400) {
      wipe();
      lastFrame = null;
    }
  }, 500);
  game.on("frame", function (f) { f.seen = performance.now(); });

  // --- HUD counter -----------------------------------------------------------

  // A dot-matrix gem, in the same round dots as the game's lettering.
  var GEM_DOTS = ["..###..", ".#####.", "#######", ".#####.", "..###..", "...#..."];

  function gemIcon() {
    var dots = "";
    GEM_DOTS.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        if (row[x] === "#") dots += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.45"/>';
      }
    });
    return '<svg viewBox="0 0 7 6" width="21" height="18" fill="currentColor" aria-hidden="true" focusable="false">' + dots + "</svg>";
  }

  function mountCounter(ui) {
    counter = document.createElement("div");
    counter.className = "slope-hud-item slope-gems";
    counter.setAttribute("role", "status");
    counter.innerHTML = gemIcon() + '<span class="slope-gems-count">0</span><span class="slope-visually-hidden"> gems</span>';
    ui.hud.appendChild(counter);
    ui.root.insertBefore(canvas, ui.root.firstChild);
    var count = counter.querySelector(".slope-gems-count");
    if (window.SlopeProfile) {
      window.SlopeProfile.onChange(function (p) { count.textContent = String(p.gems); });
    }
    setInterval(function () {
      counter.style.setProperty("--slope-gem", "hsl(" + gemHue() + ",100%,66%)");
    }, 250);
  }

  if (window.SlopeUI) window.SlopeUI.ready(mountCounter);

  window.SlopeGems = {
    // Gems still on the track, in slope coordinates.
    list: function () {
      return gems.map(function (g) { return { s: g.s, x: g.x, h: g.h }; });
    },
    currentRun: function () {
      return { gems: run.gems, seconds: run.start ? (performance.now() - run.start) / 1000 : 0 };
    }
  };
})();
