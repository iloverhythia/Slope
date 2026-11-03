/*
 * Sky High: a 2D game mode, played from the Play picker (modes.js). The ball
 * bounces by itself whenever it lands on a platform; steer it left and right
 * (arrows or A/D, or hold the left or right half of a touch screen) to land
 * on the next one and climb as high as you can. The sides wrap round: off
 * the left edge, back in on the right. Falling below the screen ends the run,
 * and so does a red mine. Scored in metres.
 *
 *   Platforms   plain, moving (from 60 m), crumbling (one bounce, from
 *               120 m) and red traps that break under the ball (from 150 m);
 *               the sure way up is only ever plain and moving ones
 *   Springs     on some platforms: a bounce nearly twice as high
 *   Rockets     fly straight up for a couple of seconds, through everything
 *   Shields     take one mine hit for you
 *   Gems        on platforms and in trails: every rarity (gems.js), worth
 *               what they are worth in the game
 *
 * It gets harder the higher it goes: wider gaps, narrower platforms, more
 * moving and crumbling ones, more traps and mines (full strength at 900 m).
 * Every platform on the way up can be reached with a plain bounce, and mines
 * are never put on the way between one and the next.
 *
 * Drawn in a 2D canvas over the game (which is paused meanwhile) in the
 * track colour, with your ball skin. Runs count in the profile like the
 * platformer's (profile.recordPlatformer, mode "sky"): best and average
 * height, bounces, gems, XP and ball XP.
 *
 *   SlopeSky.start()     a new run
 *   SlopeSky.active()    true while it is on screen
 *   SlopeSky.state()     the run (for tools and tests)
 *   SlopeSky.sim(seconds, bot, seed)   a run without drawing (tests):
 *                        bot(state) -> -1, 0 or 1 each step
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var W = 360;                      // the play column, in world units (y goes up)
  var R = 12;                       // the ball
  var UNIT = 20;                    // world units in a metre
  var G = 1500, JUMP = 900, SPRING = 1.75, MAX_FALL = 1500;
  var MAX_VX = 360, ACCEL = 2800, DRAG = 7;
  var ROCKET_SPEED = 1150, ROCKET_TIME = 2.2;
  var REACH = JUMP * JUMP / (2 * G);   // 270: as high as a bounce goes
  var DT = 1 / 120, MAX_STEPS = 12;
  var VIEW = 640;                   // world units on screen, top to bottom, at least
  var GOLD = "#ffd43b", RED = "#ff1a10", SHIELD = "#5ad1ff";
  var KEYS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };

  // --- The world ------------------------------------------------------------------

  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function metresAt(y) { return y / UNIT; }
  function difficulty(y) { return Math.min(1, metresAt(y) / 900); }
  function wrapDx(a, b) { var d = a - b; if (d > W / 2) d -= W; if (d < -W / 2) d += W; return d; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function newWorld(seed) {
    var w = { rand: rng(seed), plats: [], items: [], mines: [], lastX: W / 2, lastY: 0, lastAmp: 0,
      nextRocket: 150 * UNIT, nextShield: 220 * UNIT };
    w.plats.push({ x: W / 2, y: 0, w: W, kind: "ground" });
    return w;
  }

  // A platform's x now (moving ones swing from side to side).
  function platX(p, t) { return p.kind === "moving" ? p.cx + p.amp * Math.sin(p.speed * t + p.phase) : p.x; }

  function gem(w, x, y, plat, dx) {
    w.items.push({ kind: "gem", x: x, y: y, plat: plat || null, dx: dx || 0, rarity: -1 });
  }

  // Adds platforms (one sure way up, and more besides), items and mines up to height top.
  function extend(w, top) {
    var r = w.rand;
    while (w.lastY < top) {
      var y0 = w.lastY, x0 = w.lastX, d = difficulty(y0), m = metresAt(y0);
      // The sure way up is plain and moving platforms only: nothing on it
      // breaks, so from wherever the ball lands the next one is in reach.
      var kind = m > 60 && r() < 0.06 + 0.3 * d ? "moving" : "plain";
      var maxGap = REACH * (kind === "moving" ? 0.72 : 0.8);
      var gap = Math.min(maxGap, 62 + 130 * d + r() * (28 + 40 * d));
      var width = 92 - 34 * d + r() * 12;
      // Within 150 sideways of the last one (the sides wrap), so a missed
      // bounce can still come back to it.
      var x = ((x0 + (r() - 0.5) * 300) % W + W) % W, y = y0 + gap;
      x = Math.max(width / 2, Math.min(W - width / 2, x));
      var p = { x: x, y: y, w: width, kind: kind };
      if (kind === "moving") {
        p.amp = Math.min(60 + 50 * d, (W - width) / 2 - 4) * (0.6 + 0.4 * r());
        p.cx = Math.max(width / 2 + p.amp, Math.min(W - width / 2 - p.amp, x));
        p.speed = 0.9 + 1.4 * d + r() * 0.5;
        p.phase = r() * Math.PI * 2;
      }
      if (kind === "plain" && r() < 0.07) p.spring = (r() - 0.5) * (width - 26);
      w.plats.push(p);
      if (r() < 0.35) gem(w, x, y + 34, p, 0);

      // More platforms in the gap: plenty low down, fewer higher up; some
      // crumble (one bounce) and some are traps.
      var extras = r() < 0.75 - 0.55 * d ? 1 + (r() < 0.5 - 0.4 * d ? 1 : 0) : 0;
      if (m > 120 && r() < 0.25 + 0.35 * d) extras++;
      for (var k = 0; k < extras; k++) {
        var ey = y0 + 24 + r() * Math.max(1, gap - 48), ew = 70 - 20 * d + r() * 14, ex = ew / 2 + r() * (W - ew);
        var clash = [[x0, y0, width], [x, y, width]].some(function (q) { return Math.abs(ey - q[1]) < 30 && Math.abs(wrapDx(ex, q[0])) < (ew + q[2]) / 2 + 12; });
        if (clash) continue;
        var kr = r(), trap = m > 150 && kr < 0.22 + 0.2 * d, crumble = !trap && m > 120 && kr < 0.5 + 0.2 * d;
        var e = { x: ex, y: ey, w: ew, kind: trap ? "trap" : crumble ? "crumble" : "plain" };
        if (!trap && !crumble && r() < 0.05) e.spring = (r() - 0.5) * (ew - 26);
        w.plats.push(e);
        if (!trap && r() < 0.2) gem(w, ex, ey + 34, e, 0);
      }
      // A trail of gems up the gap now and then.
      if (r() < 0.08) {
        var gx = W * 0.15 + r() * W * 0.7;
        for (var j = 1; j <= 4; j++) gem(w, gx, y0 + gap * j / 5, null, 0);
      }
      // Mines, from 200 m: never on the way from one platform to the next.
      if (m > 200 && r() < 0.2 + 0.35 * d) {
        for (var tries = 0; tries < 30; tries++) {
          var mx = 20 + r() * (W - 40), my = (y0 + y) / 2 + (r() - 0.5) * gap * 0.3;
          if (Math.abs(wrapDx(mx, x0)) >= 120 + w.lastAmp && Math.abs(wrapDx(mx, x)) >= 120 && (kind !== "moving" || Math.abs(wrapDx(mx, p.cx)) >= 120 + p.amp) &&
              clearAbove(w, mx, my)) {
            w.mines.push({ x: mx, y: my, phase: r() * 6 });
            break;
          }
        }
      }
      if (y >= w.nextRocket) { w.items.push({ kind: "rocket", x: x, y: y + 52, plat: p, dx: 0 }); w.nextRocket += (330 + 300 * r()) * UNIT; }
      else if (y >= w.nextShield) { w.items.push({ kind: "shield", x: x, y: y + 52, plat: p, dx: 0 }); w.nextShield += (260 + 260 * r()) * UNIT; }
      w.lastY = y;
      w.lastX = kind === "moving" ? p.cx : x;
      w.lastAmp = kind === "moving" ? p.amp : 0;
    }
  }

  // Nothing under a mine that a bounce straight up would carry into it.
  function clearAbove(w, mx, my) {
    for (var i = w.plats.length - 1; i >= 0 && i > w.plats.length - 40; i--) {
      var q = w.plats[i];
      if (q.y > my + 10 || q.y < my - REACH - 30 || q.kind === "trap") continue;
      var half = q.w / 2 + 36 + (q.kind === "moving" ? q.amp : 0);
      if (Math.abs(wrapDx(mx, q.kind === "moving" ? q.cx : q.x)) < half) return false;
    }
    return true;
  }

  function prune(w, below) {
    w.plats = w.plats.filter(function (p) { return p.y > below; });
    w.items = w.items.filter(function (i) { return i.y > below && !i.gone; });
    w.mines = w.mines.filter(function (m) { return m.y > below && !m.gone; });
  }

  function itemPos(it, t) { return it.plat && it.plat.kind === "moving" ? platX(it.plat, t) + it.dx : it.x; }

  // --- A run ----------------------------------------------------------------------------

  var run = null;      // the run being played (or simulated)

  function newRun(seed) {
    var w = newWorld(seed);
    var rn = { world: w, t: 0, ball: { x: W / 2, y: R, vx: 0, vy: JUMP, rot: 0, squash: 0 }, camY: -60, top: 0,
      bounces: 0, rocket: 0, shield: false, safe: 0, dead: null, events: [], seed: seed };
    extend(w, VIEW * 2);
    return rn;
  }

  function step(rn, dt, dir, viewH) {
    rn.t += dt;
    var b = rn.ball, w = rn.world;
    if (dir) b.vx += dir * ACCEL * dt;
    else b.vx *= Math.exp(-DRAG * dt);
    b.vx = Math.max(-MAX_VX, Math.min(MAX_VX, b.vx));
    b.x += b.vx * dt;
    b.x = ((b.x % W) + W) % W;
    b.rot += b.vx * dt / R;
    if (rn.rocket > 0) { rn.rocket -= dt; b.vy = rn.rocket > 0.5 ? ROCKET_SPEED : lerp(JUMP * 0.5, ROCKET_SPEED, rn.rocket / 0.5); }   // eases off at the end
    else b.vy = Math.max(-MAX_FALL, b.vy - G * dt);
    if (rn.safe > 0) rn.safe -= dt;
    var py = b.y;
    b.y += b.vy * dt;
    b.squash *= Math.exp(-10 * dt);

    // Landing: only coming down onto a platform's top.
    if (b.vy < 0 && rn.rocket <= 0) {
      for (var i = 0; i < w.plats.length; i++) {
        var p = w.plats[i];
        if (p.broken !== undefined) continue;
        if (py - R < p.y - 0.01 || b.y - R > p.y) continue;
        var px = platX(p, rn.t);
        if (Math.abs(wrapDx(b.x, px)) > p.w / 2 + R * 0.5) continue;
        if (p.kind === "trap") { p.broken = rn.t; rn.events.push({ kind: "trap", x: px, y: p.y }); continue; }
        b.y = p.y + R;
        var spring = p.spring !== undefined && Math.abs(wrapDx(b.x, px + p.spring)) < 18;
        b.vy = JUMP * (spring ? SPRING : 1);
        b.squash = 1;
        if (spring) p.sprung = rn.t;
        if (p.kind === "crumble") p.broken = rn.t;
        rn.bounces++;
        rn.events.push({ kind: spring ? "spring" : "bounce", x: b.x, y: p.y });
        break;
      }
    }

    // Items and mines.
    w.items.forEach(function (it) {
      if (it.gone) return;
      var ix = itemPos(it, rn.t), dx = wrapDx(b.x, ix), dy = b.y - it.y;
      if (dx * dx + dy * dy > (R + 14) * (R + 14)) return;
      it.gone = true;
      if (it.kind === "rocket") { rn.rocket = ROCKET_TIME; rn.events.push({ kind: "rocket", x: ix, y: it.y }); }
      else if (it.kind === "shield") { rn.shield = true; rn.events.push({ kind: "shield", x: ix, y: it.y }); }
      else rn.events.push({ kind: "gem", item: it, x: ix, y: it.y });
    });
    w.mines.forEach(function (mn) {
      if (mn.gone) return;
      var dx = wrapDx(b.x, mn.x), dy = b.y - (mn.y + Math.sin(rn.t * 2 + mn.phase) * 6);
      if (dx * dx + dy * dy > (R + 12) * (R + 12)) return;
      if (rn.rocket > 0 || rn.safe > 0) { if (rn.rocket > 0) { mn.gone = true; rn.events.push({ kind: "pop", x: mn.x, y: mn.y }); } return; }
      if (rn.shield) { rn.shield = false; rn.safe = 1; mn.gone = true; rn.events.push({ kind: "pop", x: mn.x, y: mn.y }); return; }
      rn.dead = "mine";
    });

    // The view only goes up; below it is the end.
    viewH = viewH || VIEW;
    rn.camY = Math.max(rn.camY, b.y - viewH * 0.58);   // the ball a little above the middle: room to fall back
    rn.top = Math.max(rn.top, b.y - R);
    if (b.y < rn.camY - 3 * R) rn.dead = rn.dead || "fell";
    extend(w, rn.camY + viewH + 600);
    if (rn.t % 1 < dt) prune(w, rn.camY - 400);
  }

  function metres(rn) { return Math.max(0, Math.floor(metresAt(rn.top))); }

  // --- Playing -------------------------------------------------------------------------------

  var state = "off";        // off, playing, paused, over
  var els = null, loop = 0, lastFrame = 0, acc = 0, viewH = VIEW;
  var held = { left: 0, right: 0 }, keyDir = {}, pointers = {};
  var tally = null, best = 0, particles = [], floats = [];
  var coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)") : { matches: false };
  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  function gemsApi() { return window.SlopeGems; }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function short(n) { return profile.short ? profile.short(n) : fmt(n); }

  function dir() {
    var d = 0;
    Object.keys(keyDir).forEach(function (k) { d += keyDir[k]; });
    d += (held.right ? 1 : 0) - (held.left ? 1 : 0);
    return d > 0 ? 1 : d < 0 ? -1 : 0;
  }

  function start() {
    if (!els) return false;
    hideScreens();
    run = newRun(Math.floor(Math.random() * 1e9));
    tally = gemsApi() && gemsApi().tally ? gemsApi().tally() : { gems: 0, pickups: 0, golds: 0, rares: {} };
    best = profile.get().modes.sky ? profile.get().modes.sky.best : 0;
    keyDir = {}; held = { left: 0, right: 0 }; pointers = {};
    particles = []; floats = [];
    acc = 0;
    lastFrame = 0;
    state = "playing";
    els.root.hidden = false;
    els.hud.hidden = false;
    els.pause.hidden = false;
    var toast = window.SlopeUI.root.querySelector(".slope-toast");
    if (toast) toast.hidden = true;
    window.SlopeUI.closeSettings();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    game.pause("sky");
    document.documentElement.classList.add("slope-own-game");   // the HUD makes room for the pause button (settings.css)
    ballKey = "";
    showIntro();
    if (!loop) loop = requestAnimationFrame(frame);
    return true;
  }

  // What happened in the steps just run: gems, sparks.
  function handleEvents() {
    var api = gemsApi();
    run.events.forEach(function (e) {
      if (e.kind === "gem") {
        var r = e.item.rarity >= 0 ? e.item.rarity : 0;
        var added = profile.addGems(api ? api.worth(r) : 1);
        if (api && api.count) api.count(tally, r, added); else { tally.gems += added; tally.pickups++; }
        if (api && r >= 2) api.found(r, added);
        burst(e.x, e.y, gemColour(r), 8);
      } else if (e.kind === "bounce") burst(e.x, e.y, null, 5);
      else if (e.kind === "spring") { burst(e.x, e.y, GOLD, 12); floatText("Spring!", e.x, e.y + 40, GOLD); }
      else if (e.kind === "rocket") floatText("Rocket!", e.x, e.y + 30, GOLD);
      else if (e.kind === "shield") floatText("Shield!", e.x, e.y + 30, SHIELD);
      else if (e.kind === "pop") burst(e.x, e.y, RED, 14);
      else if (e.kind === "trap") burst(e.x, e.y, RED, 8);
    });
    run.events = [];
  }

  function frame(now) {
    loop = 0;
    if (state === "off") return;
    var dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (state === "playing" && somethingOnTop()) pause();   // a screen over it (the shop, Merge...) pauses the climb
    if (state === "paused" && els.pauseScreen.hidden && !somethingOnTop()) showPause();   // and the pause screen comes back after
    if (state === "playing") {
      acc += dt;
      var n = 0;
      while (acc >= DT && n < MAX_STEPS && !run.dead) { step(run, DT, dir(), viewH); acc -= DT; n++; }
      if (n >= MAX_STEPS) acc = 0;
      // Rarities are picked as gems come into view.
      run.world.items.forEach(function (it) { if (it.kind === "gem" && it.rarity < 0) it.rarity = gemsApi() ? gemsApi().roll() : 0; });
      handleEvents();
      if (run.dead) end();
    }
    tickEffects(dt);
    draw(now / 1000);
    renderHud();
    if (state !== "off") loop = requestAnimationFrame(frame);
  }

  function pause() {
    if (state !== "playing") return;
    state = "paused";
    keyDir = {}; held = { left: 0, right: 0 }; pointers = {};
    els.pauseLine.textContent = fmt(metres(run)) + " m so far" + (tally.gems ? "  \u00b7  +" + short(tally.gems) + " gems" : "");
    if (!somethingOnTop()) showPause();
  }
  function showPause() {
    els.pauseScreen.hidden = false;
    els.resume.focus({ preventScroll: true });
  }
  function somethingOnTop() {
    if (document.hidden) return true;
    var panel = document.getElementById("slope-settings-panel");
    if (panel && !panel.hidden) return true;
    var screens = window.SlopeUI.root.querySelectorAll(".slope-career");
    for (var i = 0; i < screens.length; i++) if (!screens[i].hidden && screens[i] !== els.pauseScreen && screens[i] !== els.result) return true;
    return false;
  }

  function resume() {
    if (state !== "paused") return;
    els.pauseScreen.hidden = true;
    if (els.pauseScreen.contains(document.activeElement)) document.activeElement.blur();
    state = "playing";
    lastFrame = 0;
    acc = 0;
  }

  function end() {
    state = "over";
    keyDir = {}; held = { left: 0, right: 0 };
    var m = metres(run), xpScore = Math.round(m / 3);
    var result = profile.recordPlatformer({ mode: "sky", score: m, xpScore: xpScore, won: false,
      gems: tally.gems, golds: tally.golds, rares: tally.rares, seconds: run.t, jumps: run.bounces });
    if (profile.addBallXp) result.ballLevels = profile.addBallXp(xpScore);
    burst(run.ball.x, run.ball.y, run.dead === "mine" ? RED : null, 20);
    hideIntro();
    setTimeout(function () { if (state === "over") showResult(result); }, 900);
  }

  function quit(toModes) {
    if (state === "playing" || state === "paused") {
      state = "over";
      profile.recordPlatformer({ mode: "sky", score: metres(run), xpScore: 0, won: false,
        gems: tally.gems, golds: tally.golds, rares: tally.rares, seconds: run.t, jumps: run.bounces });
    }
    state = "off";
    hideScreens();
    hideIntro();
    els.root.hidden = true;
    els.hud.hidden = true;
    els.pause.hidden = true;
    els.keys.hidden = true;
    document.documentElement.classList.remove("slope-own-game");
    game.resume("sky");
    if (toModes && window.SlopeModes) window.SlopeModes.open(null);
  }

  // While Sky High is on screen, its keys never reach the game.
  ["keydown", "keyup"].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (state === "off" || somethingOnTop()) return;   // a screen on top (Merge, Pinball...) has the keys
      var inUi = window.SlopeUI.root && window.SlopeUI.root.contains(e.target) && e.target !== document.body;
      if (state !== "playing") {
        if (type === "keydown" && e.key === "Escape" && state === "paused") { e.preventDefault(); resume(); }
        if (!inUi) e.stopImmediatePropagation();
        return;
      }
      if (type === "keydown" && (e.key === "Escape" || e.code === "KeyP")) { e.preventDefault(); e.stopImmediatePropagation(); pause(); return; }
      var k = KEYS[e.code];
      if (inUi && !k) return;
      e.stopImmediatePropagation();
      if (!k) return;
      e.preventDefault();
      if (type === "keydown") keyDir[e.code] = k; else delete keyDir[e.code];
    }, true);
  });
  window.addEventListener("blur", function () { if (state === "playing") pause(); });
  document.addEventListener("visibilitychange", function () { if (document.hidden && state === "playing") pause(); });

  // --- Drawing -------------------------------------------------------------------------------

  var ctx = null, scale = 1, ox = 0, ballImg = null, ballKey = "";

  function colour() { return window.SlopeUI.themeColor || "#00ff00"; }
  function gemColour(r) {
    var api = gemsApi();
    if (!api || !api.colours) return colour();
    var c = api.colours(r, performance.now() / 1000).edge;
    return "rgb(" + c.map(function (v) { return Math.round(v * 255); }).join(",") + ")";
  }

  function ballImage() {
    var S = window.SlopeSkins;
    if (!ballKey && S && S.image && S.equipped) {
      var url = S.image(S.equipped());
      ballKey = url || "none";
      ballImg = null;
      if (url) { ballImg = new Image(); ballImg.src = url; }
    }
    return ballImg && ballImg.complete && ballImg.naturalWidth ? ballImg : null;
  }

  function resize() {
    var c = els.canvas, k = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(c.clientWidth * k)), h = Math.max(1, Math.round(c.clientHeight * k));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    scale = Math.min(w / W, h / VIEW);
    ox = (w - W * scale) / 2;
    viewH = h / scale;
  }

  function burst(x, y, col, n) {
    if (reduceMotion.matches) return;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 60, life: 0.5 + Math.random() * 0.3, col: col });
    }
    if (particles.length > 200) particles.splice(0, particles.length - 200);
  }
  function floatText(text, x, y, col) { floats.push({ text: text, x: x, y: y, t: 0, col: col }); }
  function tickEffects(dt) {
    particles = particles.filter(function (p) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 500 * dt; return p.life > 0; });
    floats = floats.filter(function (f) { f.t += dt; f.y += 40 * dt; return f.t < 1.1; });
  }

  function draw(time) {
    if (!run) return;
    resize();
    var c = els.canvas, x = ctx, H = c.height, s = scale, col = colour(), t = run.t;
    function sy(y) { return H - (y - run.camY) * s; }
    function sx(wx) { return ox + wx * s; }
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = "#000";
    x.fillRect(0, 0, c.width, H);

    // The sky: a dot grid that drifts slower than the platforms, and stars
    // that come out the higher you get.
    x.fillStyle = col;
    var grid = 24 * s, shift = (run.camY * s * 0.5) % grid;
    x.globalAlpha = 0.08;
    for (var gy = H + shift; gy > -grid; gy -= grid) for (var gx = ox + grid / 2; gx < ox + W * s; gx += grid) x.fillRect(gx, gy, 1.5 * s, 1.5 * s);
    var starA = Math.min(0.8, Math.max(0, metresAt(run.camY) - 150) / 600);
    if (starA > 0) {
      x.fillStyle = "#ffffff";
      for (var i = 0; i < 60; i++) {
        var px = ((i * 7919) % 1000) / 1000 * c.width;
        var py = (((i * 4271) % 1000) / 1000 * H * 1.5 + run.camY * s * 0.15) % (H * 1.5) - H * 0.25;
        x.globalAlpha = starA * (0.4 + 0.6 * Math.abs(Math.sin(time * 1.3 + i)));
        x.fillRect(px, py, 1.6 * s, 1.6 * s);
      }
    }
    x.globalAlpha = 1;

    // The column's edges (the sides wrap round), and height marks.
    x.strokeStyle = col; x.lineWidth = 1.5 * s; x.globalAlpha = 0.35;
    x.setLineDash([6 * s, 8 * s]);
    x.beginPath(); x.moveTo(ox, 0); x.lineTo(ox, H); x.moveTo(ox + W * s, 0); x.lineTo(ox + W * s, H); x.stroke();
    x.setLineDash([]);
    x.globalAlpha = 1;
    x.font = Math.round(11 * s) + "px " + font; x.textAlign = "left";
    var step50 = 50 * UNIT;
    for (var my = Math.ceil(run.camY / step50) * step50; my < run.camY + viewH; my += step50) {
      if (my <= 0) continue;
      x.globalAlpha = 0.25; x.fillStyle = col;
      x.fillRect(ox, sy(my), 14 * s, 1.5 * s);
      x.fillText(Math.round(metresAt(my)) + " m", ox + 18 * s, sy(my) + 4 * s);
    }
    x.globalAlpha = 1;
    if (best > 0) {
      var by = best * UNIT;
      if (by > run.camY && by < run.camY + viewH) {
        x.strokeStyle = GOLD; x.lineWidth = 2 * s; x.setLineDash([10 * s, 8 * s]);
        x.beginPath(); x.moveTo(ox, sy(by)); x.lineTo(ox + W * s, sy(by)); x.stroke();
        x.setLineDash([]);
        x.fillStyle = GOLD; x.textAlign = "right";
        x.fillText("Best " + fmt(best) + " m", ox + W * s - 6 * s, sy(by) - 6 * s);
      }
    }

    // Draws something at world x (and again across the edge when it straddles it).
    function wrapped(wx, half, fn) {
      fn(sx(wx));
      if (wx - half < 0) fn(sx(wx + W));
      if (wx + half > W) fn(sx(wx - W));
    }

    x.save();
    x.beginPath(); x.rect(ox, 0, W * s, H); x.clip();

    // Platforms.
    run.world.plats.forEach(function (p) {
      var py = sy(p.y);
      if (py < -40 || py > H + 40) return;
      var px = platX(p, t), hw = p.w / 2 * s, hh = 5 * s;
      if (p.broken !== undefined) {
        var k = t - p.broken;
        if (k > 0.7) return;
        x.globalAlpha = 1 - k / 0.7;
        x.strokeStyle = p.kind === "trap" ? RED : col; x.lineWidth = 2 * s;
        [-1, 1].forEach(function (side) {
          x.save();
          x.translate(sx(px) + side * hw / 2 + side * k * 40 * s, py + k * k * 500 * s);
          x.rotate(side * k * 2);
          x.strokeRect(-hw / 2, -hh, hw, hh * 2);
          x.restore();
        });
        x.globalAlpha = 1;
        return;
      }
      var trap = p.kind === "trap";
      x.fillStyle = trap ? "rgba(255,26,16,0.15)" : "#000";
      x.strokeStyle = trap ? RED : col;
      x.lineWidth = 2.5 * s;
      if (p.kind === "crumble" || trap) x.setLineDash([7 * s, 5 * s]);
      x.shadowColor = trap ? RED : col; x.shadowBlur = p.kind === "ground" ? 0 : 8 * s;
      x.beginPath(); x.rect(sx(px) - hw, py - hh, hw * 2, hh * 2); x.fill(); x.stroke();
      x.setLineDash([]);
      x.shadowBlur = 0;
      if (p.kind === "crumble") {   // cracks
        x.lineWidth = 1.5 * s; x.beginPath();
        x.moveTo(sx(px) - hw * 0.3, py - hh); x.lineTo(sx(px) - hw * 0.2, py); x.lineTo(sx(px) - hw * 0.35, py + hh);
        x.moveTo(sx(px) + hw * 0.4, py - hh); x.lineTo(sx(px) + hw * 0.3, py + hh);
        x.stroke();
      }
      if (p.kind === "moving") {   // little arrows at the ends
        x.fillStyle = col;
        [-1, 1].forEach(function (side) {
          var ax = sx(px) + side * (hw + 7 * s);
          x.beginPath(); x.moveTo(ax + side * 5 * s, py); x.lineTo(ax - side * 1 * s, py - 4 * s); x.lineTo(ax - side * 1 * s, py + 4 * s); x.fill();
        });
      }
      if (p.spring !== undefined) {   // a gold coil, stretched just after a bounce
        var up = p.sprung !== undefined && t - p.sprung < 0.25 ? 1.8 : 1, spx = sx(px + p.spring);
        x.strokeStyle = GOLD; x.lineWidth = 2.5 * s;
        x.beginPath(); x.moveTo(spx - 7 * s, py - hh);
        for (var z = 1; z <= 4; z++) x.lineTo(spx + (z % 2 ? 7 : -7) * s, py - hh - z * 3 * up * s);
        x.stroke();
        x.fillStyle = GOLD; x.fillRect(spx - 9 * s, py - hh - 14 * up * s, 18 * s, 3 * s);
      }
    });

    // Items.
    run.world.items.forEach(function (it) {
      if (it.gone) return;
      var ix = itemPos(it, t), iy = sy(it.y + Math.sin(time * 3 + it.x) * 3);
      if (iy < -30 || iy > H + 30) return;
      wrapped(ix, 14, function (cx) {
        if (it.kind === "gem") {
          var r = it.rarity >= 0 ? it.rarity : 0, gc = gemColour(r), wv = Math.abs(Math.cos(time * 2 + it.y)) * 0.6 + 0.4, gs = (8 + Math.min(4, r)) * s;
          x.fillStyle = "#000"; x.strokeStyle = gc; x.lineWidth = 2 * s;
          x.shadowColor = gc; x.shadowBlur = 8 * s;
          x.beginPath(); x.moveTo(cx, iy - gs); x.lineTo(cx + gs * wv, iy); x.lineTo(cx, iy + gs); x.lineTo(cx - gs * wv, iy); x.closePath();
          x.fill(); x.stroke(); x.shadowBlur = 0;
        } else if (it.kind === "rocket") {
          x.save(); x.translate(cx, iy); x.fillStyle = GOLD; x.strokeStyle = GOLD; x.lineWidth = 2 * s;
          x.shadowColor = GOLD; x.shadowBlur = 10 * s;
          x.beginPath(); x.moveTo(0, -14 * s); x.lineTo(6 * s, -4 * s); x.lineTo(6 * s, 8 * s); x.lineTo(-6 * s, 8 * s); x.lineTo(-6 * s, -4 * s); x.closePath(); x.fill();
          x.beginPath(); x.moveTo(-6 * s, 2 * s); x.lineTo(-11 * s, 11 * s); x.lineTo(-6 * s, 8 * s); x.moveTo(6 * s, 2 * s); x.lineTo(11 * s, 11 * s); x.lineTo(6 * s, 8 * s); x.stroke();
          x.restore(); x.shadowBlur = 0;
        } else {
          x.strokeStyle = SHIELD; x.lineWidth = 2.5 * s; x.shadowColor = SHIELD; x.shadowBlur = 10 * s;
          x.beginPath(); x.arc(cx, iy, 12 * s, 0, Math.PI * 2); x.stroke();
          x.beginPath(); x.moveTo(cx, iy - 7 * s); x.lineTo(cx + 6 * s, iy - 3 * s); x.lineTo(cx + 4 * s, iy + 5 * s); x.lineTo(cx, iy + 8 * s);
          x.lineTo(cx - 4 * s, iy + 5 * s); x.lineTo(cx - 6 * s, iy - 3 * s); x.closePath(); x.stroke();
          x.shadowBlur = 0;
        }
      });
    });

    // Mines: red, spiked, pulsing.
    run.world.mines.forEach(function (mn) {
      if (mn.gone) return;
      var my2 = sy(mn.y + Math.sin(t * 2 + mn.phase) * 6);
      if (my2 < -30 || my2 > H + 30) return;
      wrapped(mn.x, 20, function (cx) {
        var pr = (10 + Math.sin(time * 8 + mn.phase) * 1) * s;
        x.strokeStyle = RED; x.fillStyle = "#1a0000"; x.lineWidth = 2 * s;
        x.shadowColor = RED; x.shadowBlur = 10 * s;
        x.beginPath(); x.arc(cx, my2, pr, 0, Math.PI * 2); x.fill(); x.stroke();
        x.beginPath();
        for (var k = 0; k < 8; k++) {
          var a = k / 8 * Math.PI * 2 + time;
          x.moveTo(cx + Math.cos(a) * pr, my2 + Math.sin(a) * pr);
          x.lineTo(cx + Math.cos(a) * (pr + 6 * s), my2 + Math.sin(a) * (pr + 6 * s));
        }
        x.stroke(); x.shadowBlur = 0;
        x.fillStyle = RED; x.beginPath(); x.arc(cx, my2, 3 * s, 0, Math.PI * 2); x.fill();
      });
    });

    // Particles and words.
    particles.forEach(function (p) {
      x.globalAlpha = Math.min(1, p.life * 2); x.fillStyle = p.col || col;
      x.fillRect(sx(p.x) - 1.5 * s, sy(p.y) - 1.5 * s, 3 * s, 3 * s);
    });
    x.globalAlpha = 1;
    x.textAlign = "center"; x.font = Math.round(16 * s) + "px " + font;
    floats.forEach(function (f) {
      x.globalAlpha = Math.max(0, 1 - f.t / 1.1); x.fillStyle = f.col || col;
      x.fillText(f.text, sx(f.x), sy(f.y));
    });
    x.globalAlpha = 1;

    // The ball: squashed for a moment after a bounce; a flame under it on a
    // rocket; a ring round it with a shield.
    var b = run.ball;
    if (!(state === "over" && run.dead)) {
      var img = ballImage();
      wrapped(b.x, R, function (cx) {
        var cy = sy(b.y), rr = R * s, sq = b.squash * 0.25;
        if (run.rocket > 0) {
          x.fillStyle = GOLD; x.globalAlpha = 0.85;
          x.beginPath(); x.moveTo(cx - 7 * s, cy + rr * 0.6); x.lineTo(cx, cy + rr + (18 + Math.random() * 12) * s); x.lineTo(cx + 7 * s, cy + rr * 0.6); x.fill();
          x.globalAlpha = 1;
        }
        x.save();
        x.translate(cx, cy + rr * sq);
        x.scale(1 + sq, 1 - sq);
        x.shadowColor = col; x.shadowBlur = 12 * s;
        x.fillStyle = "#000"; x.beginPath(); x.arc(0, 0, rr, 0, Math.PI * 2); x.fill();
        x.shadowBlur = 0;
        if (img) {
          x.save(); x.beginPath(); x.arc(0, 0, rr, 0, Math.PI * 2); x.clip();
          x.rotate(b.rot); x.drawImage(img, -rr * 1.25, -rr * 1.25, rr * 2.5, rr * 2.5); x.restore();
        } else {
          var gr = x.createRadialGradient(-rr * 0.3, -rr * 0.3, 1, 0, 0, rr);
          gr.addColorStop(0, "#fff"); gr.addColorStop(0.35, col); gr.addColorStop(1, "#021402");
          x.fillStyle = gr; x.beginPath(); x.arc(0, 0, rr, 0, Math.PI * 2); x.fill();
        }
        x.strokeStyle = col; x.lineWidth = 1.5 * s;
        x.beginPath(); x.arc(0, 0, rr, 0, Math.PI * 2); x.stroke();
        x.restore();
        if (run.shield || run.safe > 0) {
          x.strokeStyle = SHIELD; x.lineWidth = 2 * s; x.globalAlpha = run.safe > 0 ? 0.4 + 0.4 * Math.sin(time * 30) : 0.8;
          x.beginPath(); x.arc(cx, cy, rr + 7 * s, 0, Math.PI * 2); x.stroke();
          x.globalAlpha = 1;
        }
      });
    }
    x.restore();

    // A ball out of sight above the screen (a rocket or a spring): an arrow at the top.
    if (sy(b.y) < 0) {
      x.fillStyle = col;
      x.beginPath(); x.moveTo(sx(b.x), 6 * s); x.lineTo(sx(b.x) - 8 * s, 18 * s); x.lineTo(sx(b.x) + 8 * s, 18 * s); x.fill();
    }
  }

  // --- Screens -----------------------------------------------------------------------------

  var font = '"Slope Chargen", monospace';
  var introTimer = 0, keysTimer = 0;

  function cells() { var h = ""; for (var i = 0; i < 20; i++) h += '<span class="slope-xp-cell"></span>'; return h; }
  function fill(bar, f) {
    var on = Math.round(f * 20);
    Array.prototype.forEach.call(bar.children, function (c, i) { c.classList.toggle("is-on", i < on); });
  }
  function screen(cls, inner) {
    var s = document.createElement("div");
    s.className = "slope-career " + cls;
    s.setAttribute("role", "dialog");
    s.hidden = true;
    s.innerHTML = inner;
    window.SlopeUI.root.appendChild(s);
    return s;
  }
  var PAUSE_ICON = '<svg viewBox="0 0 5 5" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">' +
    [0, 1, 2, 3, 4].map(function (y) { return '<circle cx="1" cy="' + (y + 0.5) + '" r="0.45"/><circle cx="4" cy="' + (y + 0.5) + '" r="0.45"/>'; }).join("") + "</svg>";

  function build(ui) {
    var root = document.createElement("div");
    root.className = "slope-sky";
    root.hidden = true;
    root.innerHTML = '<canvas class="slope-sky-canvas" aria-label="Sky High"></canvas>';
    document.body.appendChild(root);
    var canvas = root.querySelector("canvas");
    ctx = canvas.getContext("2d");
    var family = getComputedStyle(ui.root).getPropertyValue("--slope-display");
    if (family) font = family.trim();

    // Touch (or the mouse): hold the left or right half to steer.
    canvas.addEventListener("pointerdown", function (e) {
      if (state !== "playing") return;
      e.preventDefault();
      var side = e.clientX < window.innerWidth / 2 ? "left" : "right";
      pointers[e.pointerId] = side;
      held[side]++;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
    });
    function lift(e) {
      var side = pointers[e.pointerId];
      if (!side) return;
      delete pointers[e.pointerId];
      held[side] = Math.max(0, held[side] - 1);
    }
    canvas.addEventListener("pointerup", lift);
    canvas.addEventListener("pointercancel", lift);
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    var keys = document.createElement("p");
    keys.className = "slope-plat-keys slope-sky-keys";
    keys.hidden = true;
    ui.root.appendChild(keys);

    var hud = document.createElement("div");
    hud.className = "slope-adventure-hud slope-sky-hud";
    hud.hidden = true;
    hud.innerHTML = '<p class="slope-adventure-hud-title"></p>' +
      '<div class="slope-xp-bar slope-adventure-hud-bar" aria-hidden="true">' + cells() + "</div>" +
      '<p class="slope-adventure-hud-togo"></p>';
    ui.root.appendChild(hud);

    var pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.className = "slope-btn slope-plat-pause slope-sky-pause";
    pauseBtn.setAttribute("aria-label", "Pause");
    pauseBtn.innerHTML = PAUSE_ICON;
    pauseBtn.hidden = true;
    ui.root.appendChild(pauseBtn);

    var intro = document.createElement("div");
    intro.className = "slope-level-intro slope-sky-intro";
    intro.setAttribute("role", "status");
    intro.hidden = true;
    intro.innerHTML = '<p class="slope-level-intro-title">Sky High</p><p class="slope-level-intro-kinds"></p><p class="slope-level-intro-goal"></p>';
    ui.root.appendChild(intro);

    var pauseScreen = screen("slope-adventure-result slope-sky-paused",
      '<div class="slope-career-inner slope-result-inner">' +
        '<h2 class="slope-career-title slope-result-title" id="slope-sky-pause-title">Paused</h2>' +
        '<p class="slope-result-line"></p>' +
        '<div class="slope-career-actions">' +
          '<button type="button" class="slope-btn slope-sky-resume">Resume</button>' +
          '<button type="button" class="slope-btn slope-sky-restart">Restart</button>' +
          '<button type="button" class="slope-btn slope-sky-quit">Menu</button>' +
        "</div>" +
      "</div>");
    pauseScreen.setAttribute("aria-labelledby", "slope-sky-pause-title");

    var result = screen("slope-adventure-result slope-sky-result",
      '<div class="slope-career-inner slope-result-inner">' +
        '<h2 class="slope-career-title slope-result-title" id="slope-sky-result-title"></h2>' +
        '<p class="slope-result-line"></p>' +
        '<div class="slope-xp-bar slope-result-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Height against your best">' + cells() + "</div>" +
        '<p class="slope-result-stats"></p>' +
        '<div class="slope-career-actions">' +
          '<button type="button" class="slope-btn slope-sky-again">Again</button>' +
          '<button type="button" class="slope-btn slope-sky-modes">Modes</button>' +
          '<button type="button" class="slope-btn slope-sky-menu">Menu</button>' +
        "</div>" +
      "</div>");
    result.setAttribute("aria-labelledby", "slope-sky-result-title");

    els = {
      root: root, canvas: canvas, keys: keys, hud: hud, pause: pauseBtn, intro: intro,
      hudTitle: hud.querySelector(".slope-adventure-hud-title"), hudBar: hud.querySelector(".slope-adventure-hud-bar"),
      hudLine: hud.querySelector(".slope-adventure-hud-togo"),
      pauseScreen: pauseScreen, pauseLine: pauseScreen.querySelector(".slope-result-line"), resume: pauseScreen.querySelector(".slope-sky-resume"),
      result: result, resultTitle: result.querySelector(".slope-result-title"), resultLine: result.querySelector(".slope-result-line"),
      resultBar: result.querySelector(".slope-result-bar"), resultStats: result.querySelector(".slope-result-stats"),
      again: result.querySelector(".slope-sky-again")
    };

    pauseBtn.addEventListener("click", pause);
    els.resume.addEventListener("click", resume);
    pauseScreen.querySelector(".slope-sky-restart").addEventListener("click", function () { quit(false); start(); });
    pauseScreen.querySelector(".slope-sky-quit").addEventListener("click", function () { quit(false); });
    els.again.addEventListener("click", function () { start(); });
    result.querySelector(".slope-sky-modes").addEventListener("click", function () { quit(true); });
    result.querySelector(".slope-sky-menu").addEventListener("click", function () { quit(false); });
    profile.onChange(function () { ballKey = ""; });
  }

  function hideScreens() {
    if (!els) return;
    [els.pauseScreen, els.result].forEach(function (s) {
      if (s.contains(document.activeElement)) document.activeElement.blur();
      s.hidden = true;
    });
  }

  function showIntro() {
    els.intro.querySelector(".slope-level-intro-kinds").textContent = "How high can you go?";
    els.intro.querySelector(".slope-level-intro-goal").textContent = best ? "Your best is " + fmt(best) + " m" : "Land on the platforms to bounce higher";
    els.intro.hidden = false;
    clearTimeout(introTimer);
    introTimer = setTimeout(hideIntro, 2400);
    els.keys.textContent = coarse.matches ? "Hold the left or right side to steer" : "Left and Right arrows or A and D to steer  \u00b7  Esc to pause";
    els.keys.hidden = false;
    clearTimeout(keysTimer);
    keysTimer = setTimeout(function () { els.keys.hidden = true; }, 6000);
  }
  function hideIntro() { clearTimeout(introTimer); if (els) els.intro.hidden = true; }

  var shownHud = {};
  function renderHud() {
    if (!run || state === "off") return;
    var m = metres(run);
    var title = "Sky High  " + fmt(m) + " m";
    var line = (best ? (m > best ? "New best!" : "Best " + fmt(best) + " m") : "Your first climb") +
      (run.rocket > 0 ? "  \u00b7  Rocket!" : "") + (run.shield ? "  \u00b7  Shield" : "") +
      (tally && tally.gems ? "  \u00b7  +" + short(tally.gems) + " gems" : "");
    if (shownHud.title !== title) { shownHud.title = title; els.hudTitle.textContent = title; }
    if (shownHud.line !== line) { shownHud.line = line; els.hudLine.textContent = line; }
    var f = best ? Math.min(1, m / best) : 0;
    if (shownHud.f !== f) { shownHud.f = f; fill(els.hudBar, f); }
  }

  function showResult(result) {
    var m = metres(run), cause = run.dead === "mine" ? "You hit a mine." : "You fell.";
    els.resultTitle.textContent = fmt(m) + " m";
    els.resultLine.textContent = (m > best ? "New best! " : "") + cause;
    fill(els.resultBar, best ? Math.min(1, m / Math.max(best, m)) : 1);
    els.resultBar.setAttribute("aria-valuenow", String(best ? Math.round(Math.min(1, m / Math.max(best, m)) * 100) : 100));
    els.resultStats.textContent = "Best " + fmt(Math.max(best, m)) + " m  \u00b7  " + fmt(run.bounces) + (run.bounces === 1 ? " bounce" : " bounces") +
      (tally.gems ? "  \u00b7  +" + short(tally.gems) + (tally.gems === 1 ? " gem" : " gems") : "") +
      (result && result.xp ? "  \u00b7  +" + fmt(result.xp) + " XP" : "") +
      (result && result.ballLevels && profile.ball ? "  \u00b7  Ball level " + profile.ball().level + "!" : "");
    els.hud.hidden = true;
    els.pause.hidden = true;
    els.result.hidden = false;
    els.again.focus({ preventScroll: true });
  }

  window.SlopeUI.ready(build);

  window.SlopeSky = {
    start: start,
    active: function () { return state !== "off"; },
    pause: pause,
    resume: resume,
    quit: function () { quit(false); },
    // For tests: end the run now, as a fall.
    finish: function () { if (state === "playing" && run) run.dead = "fell"; },
    state: function () {
      return run ? { state: state, t: run.t, metres: metres(run), ball: Object.assign({}, run.ball), bounces: run.bounces, dead: run.dead,
        rocket: run.rocket, shield: run.shield, gems: tally ? tally.gems : 0, camY: run.camY, viewH: viewH } : null;
    },
    // A run without drawing or saving, for tests: how high a bot gets.
    sim: function (seconds, bot, seed, keep) {
      var rn = newRun(seed === undefined ? 1 : seed), n = Math.round(seconds / DT), stats = { springs: 0, rockets: 0, shields: 0, gems: 0, traps: 0, pops: 0 };
      for (var k = 0; k < n && !rn.dead; k++) {
        var d = bot ? bot({ ball: rn.ball, t: rn.t, plats: rn.world.plats.map(function (p) { return { x: platX(p, rn.t), y: p.y, w: p.w, kind: p.kind, broken: p.broken !== undefined }; }),
          mines: rn.world.mines, camY: rn.camY, rocket: rn.rocket, REACH: REACH, W: W, at: function (i, t) { return platX(rn.world.plats[i], t); } }) : 0;
        step(rn, DT, d, VIEW);
        rn.events.forEach(function (e) { if (e.kind === "spring") stats.springs++; else if (e.kind === "rocket") stats.rockets++; else if (e.kind === "shield") stats.shields++; else if (e.kind === "gem") stats.gems++; else if (e.kind === "trap") stats.traps++; else if (e.kind === "pop") stats.pops++; });
        rn.events = [];
      }
      return { metres: metres(rn), t: rn.t, dead: rn.dead, bounces: rn.bounces, stats: stats, run: keep ? rn : undefined };
    },
    world: function (seed, upTo) { var w = newWorld(seed); extend(w, upTo); return w; },
    REACH: REACH, W: W, UNIT: UNIT
  };
})();
