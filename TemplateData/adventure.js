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
 * Obstacles are put on the track only once the track under them exists, on
 * its real floor (heights and edges come from the track's own geometry,
 * SlopeGame.probeFloor), so they never float in the air or hang off the side.
 *
 * Touching an obstacle crashes the ball (the game's own "collide death").
 * Crossing the finish line unlocks the next level and ends the run the same
 * way, hidden behind the result screen: that is the one path that resets
 * everything in the game (ball, camera, track, fall-out detector) for the
 * next run. A new run is only asked for once the game has cleared the old
 * track, 3 seconds after a run ends. Progress is kept in the profile.
 *
 *   SlopeAdventure.open()        show the level grid
 *   SlopeAdventure.start(n)      play level n (if unlocked)
 *   SlopeAdventure.level(n)      the level's description
 *   SlopeAdventure.isClear(s)    false where a level obstacle stands (gems avoid it)
 *   SlopeAdventure.handlesRun()  true while the current run is an Adventure level
 *   SlopeAdventure.setEndless(on) Advanced mode: normal runs get endless obstacles
 *   SlopeAdventure.dodged()      obstacles passed in the Advanced run
 *   SlopeAdventure.obstacles()   the obstacles on the track now
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var BALL_RADIUS = 0.45;        // the ball is 0.5; a little forgiving
  var PLACE_AHEAD = 60;          // obstacles go on the track from this far ahead (further when fast)...
  var GIVE_UP_AHEAD = 18;        // ...and are left out if no floor shows up before this (further when fast)
  var LOOK_AHEAD = 2.4;          // seconds of travel ahead to start looking, at the ball's speed
  var WARNING = 1.0;             // seconds: no obstacle ever appears closer than this
  var AIR_DROP = 14;             // in the air, look this far below for the floor ahead
  var FIRST_OBSTACLE = 45;       // distance from the start
  var PROBE_REACH = 8;           // look for floor this far to each side
  var PROBE_STEP = 0.5;
  var MIN_FLOOR = 1.8;           // narrowest floor looked at
  var LANE = 2.4;                // every obstacle leaves a lane this wide open (the ball is 1)
  // Lanes in a row must be reachable at the ball's speed: from one lane to the
  // next the ball needs at most half the game's steering speed (about 15
  // units a second sideways), even if it goes faster than measured.
  var STEER = 6;                 // sideways units a second a lane change may need
  var LANE_SLACK = LANE - 2 * BALL_RADIUS - 0.2;  // shift that needs no steering
  var RED = [1.0, 0.08, 0.06];
  var WHITE = [1.0, 1.0, 1.0];
  var LEVEL_STEP = 18;           // levels added to the grid at a time
  var MAX_LENGTH = 1000;         // no level is longer than this (metres)

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
      length: Math.min(MAX_LENGTH, 240 + 45 * (n - 1)),   // metres down the slope
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
    plan.push({ kind: "finish", at: spec.length, a: 0, b: 0, c: 0 });
    return plan;
  }

  // --- Obstacles -----------------------------------------------------------------
  // Each part is a box in slope coordinates: centre (s, x), the floor height
  // it stands on (base, h), a lift above that floor, half sizes (hx sideways,
  // hs along, hh up) and a turn in the slope plane. Moving parts work out
  // their pose from the clock.

  function box(s, x, hx, hs, hh, extra) {
    var part = { s: s, x: x, hx: hx, hs: hs, hh: hh, base: 0, lift: 0, turn: 0, solid: true, glow: 0, color: RED };
    for (var k in extra) part[k] = extra[k];
    return part;
  }

  // track: { cx, hw, h } — the floor's centre, half width and height at s.
  // reach: optional [lo, hi], where the lane's centre can be reached from the
  // obstacle before.
  //
  // Every obstacle is fair: the player can only steer, so each one first picks
  // a lane at least LANE wide that stays open the whole time, and only puts
  // its parts outside it. (A laser across the whole track, for example, could
  // only be passed by luck: the ball can't slow down or jump.)
  function buildObstacle(item, s, track, spec, reach) {
    if (item.kind === "finish") return finishLine(s, track);
    var cx = track.cx, hw = track.hw;
    var x0 = cx - hw, x1 = cx + hw;
    if (x1 - x0 < LANE + 1.2) return []; // a narrow beam: nothing fits beside the lane
    var w = 2 * Math.PI;
    var t = spec.tempo;
    var parts = [];
    // The open lane, and the floor on each side of it.
    var lo = x0 + LANE / 2, hi = x1 - LANE / 2;
    if (reach) {
      // No lane within reach (the track itself moves over there): left out.
      if (reach[0] > hi || reach[1] < lo) return [];
      lo = Math.max(lo, reach[0]);
      hi = Math.min(hi, reach[1]);
    }
    var lane = lo + item.a * (hi - lo);
    var sides = [{ a: x0, b: lane - LANE / 2 }, { a: lane + LANE / 2, b: x1 }]
      .filter(function (r) { return r.b - r.a > 0.05; });
    var wide = sides.slice().sort(function (p, q) { return (q.b - q.a) - (p.b - p.a); })[0];
    function within(r, half, v) { return r.a + half + v * Math.max(0, r.b - r.a - 2 * half); }
    switch (item.kind) {
      case "block":
        // One block (two from level 8) beside the lane.
        sides.forEach(function (r, i) {
          if (r.b - r.a < 1.1) return;
          if (r === wide || (spec.pairs && item.c < 0.5)) parts.push(box(s, within(r, 0.55, i ? item.b : item.c), 0.55, 0.55, 0.55));
        });
        break;
      case "wall":
        // The lane is the gap in the wall.
        sides.forEach(function (r) { parts.push(box(s, (r.a + r.b) / 2, (r.b - r.a) / 2, 0.35, 0.5)); });
        break;
      case "slider":
        // Slides to and fro on its side of the lane, never into it.
        if (wide.b - wide.a < 1.8) break;
        var reach = (wide.b - wide.a - 1.6) / 2, mid = (wide.a + wide.b) / 2, period = 2.6 / t, phase = item.b * w;
        parts.push(box(s, mid, 0.8, 0.6, 0.6, { move: function (p, now) { p.x = mid + reach * Math.sin(now * w / period + phase); } }));
        break;
      case "laser":
        // Beams on both sides of the lane switch on and off; the gap between
        // the two posts is always open.
        var cycle = 2.2 / t, offset = item.b * cycle;
        sides.forEach(function (r) {
          parts.push(box(s, (r.a + r.b) / 2, (r.b - r.a) / 2, 0.1, 0.1, {
            lift: 0.45,
            move: function (p, now) {
              var on = ((now + offset) % cycle) / cycle < 0.5;
              p.solid = on;
              p.glow = on ? 1 : 0;
              p.dim = !on;
            }
          }));
          var post = r.b <= lane ? r.b - 0.15 : r.a + 0.15;
          parts.push(box(s, post, 0.15, 0.15, 0.7, { solid: false }));
        });
        break;
      case "pillar":
        // Pillars rise and sink beside the lane.
        sides.forEach(function (r, i) {
          if (r.b - r.a < 1.4) return;
          if (r !== wide && !(spec.pairs && item.c < 0.5)) return;
          (function (px, phase) {
            var span = 2.6 / t;
            parts.push(box(s, px, 0.7, 0.7, 1.1, {
              move: function (p, now) {
                // Up half the time, down (under the floor) the other half.
                var k = Math.max(0, Math.min(1, 0.5 + 1.4 * Math.sin(now * w / span + phase)));
                p.lift = (k - 1) * 2.3;
              }
            }));
          })(within(r, 0.7, i ? item.b : item.c), item.c * w + i * Math.PI);
        });
        break;
      case "spinner":
        // Turns on its side of the lane; its sweep never reaches the lane.
        var r = (wide.b - wide.a) / 2;
        if (r < 1.0) break;
        var hub = (wide.a + wide.b) / 2;
        var speed = (item.b < 0.5 ? 1 : -1) * w / (3.4 / t), start = item.c * w;
        parts.push(box(s, hub, r - 0.1, 0.22, 0.45, { move: function (p, now) { p.turn = start + now * speed; } }));
        parts.push(box(s, hub, 0.3, 0.3, 0.6, { solid: true })); // the hub
        break;
    }
    parts.forEach(function (p) { p.kind = item.kind; p.base = track.h; });
    parts.lane = lane;
    return parts;
  }

  // Where the next lane may be: within reach of the last one at the speed the
  // ball may have by then (it speeds up quickly, so allow for more).
  function laneReach(last, s, kind, speed) {
    if (!last) return null;
    var room = s - last.s - 2 * BALL_RADIUS - last.depth - (kind === "spinner" ? 3.5 : 0.7);
    var fast = Math.max(12, speed * 1.2 + 12);
    var shift = LANE_SLACK + STEER * Math.max(0, room) / fast;
    return [last.x - shift, last.x + shift];
  }

  function finishLine(s, track) {
    var cx = track.cx, hw = track.hw;
    var parts = [
      box(s, cx, hw, 0.25, 0.02, { solid: false, glow: 1, color: WHITE, lift: -0.02 }),
      box(s, cx - hw + 0.2, 0.2, 0.2, 1.6, { solid: false, color: WHITE }),
      box(s, cx + hw - 0.2, 0.2, 0.2, 1.6, { solid: false, color: WHITE }),
      box(s, cx, hw, 0.2, 0.2, { solid: false, color: WHITE, lift: 3.0, glow: 0.4 })
    ];
    parts.forEach(function (p) { p.kind = "finish"; p.base = track.h; });
    return parts;
  }

  // Open floor at one probe point: the highest flat surface near the ball's
  // floor height, with room above it (under a red side ramp there isn't;
  // under a tunnel roof there is). Its height, or null.
  function openFloor(list, ref, below) {
    var top = null;
    list.forEach(function (hit) {
      if (hit.flat && hit.h > ref - (below || 8) && hit.h < ref + 1 && (top === null || hit.h > top)) top = hit.h;
    });
    if (top === null) return null;
    var covered = list.some(function (hit) { return hit.h > top + 0.05 && hit.h < top + 2; });
    return covered ? null : top;
  }

  // The floor across a few rows of probe points just before, at and just
  // after an obstacle: open in every row and at one height (so one of the
  // game's own blocks next to it doesn't count as free). Neighbouring points
  // at the same height make one floor. Returns the floor that is the likeliest
  // track (at least MIN_FLOOR wide, nearest the ball's height, then nearest
  // x), or null.
  function floorRow(xs, rows, x, ref, below) {
    var per = rows.map(function (hits) { return hits.map(function (list) { return openFloor(list, ref, below); }); });
    var middle = per[per.length >> 1];
    var heights = middle.map(function (h, i) {
      if (h === null) return null;
      for (var r = 0; r < per.length; r++) {
        if (per[r][i] === null || Math.abs(per[r][i] - h) > 0.3) return null;
      }
      return h;
    });
    var runs = [], cur = null;
    heights.forEach(function (h, i) {
      if (h === null) { cur = null; return; }
      if (cur && Math.abs(h - cur.last) < 0.3) { cur.to = i; cur.last = h; cur.hs.push(h); }
      else { cur = { from: i, to: i, last: h, hs: [h] }; runs.push(cur); }
    });
    var best = null, bestScore = Infinity;
    runs.forEach(function (r) {
      var x0 = xs[r.from] - PROBE_STEP / 2, x1 = xs[r.to] + PROBE_STEP / 2;
      if (x1 - x0 < MIN_FLOOR) return;
      // The track runs straight ahead of the ball and drops in steps; the city
      // ground far below and the other beams beside it are not the track.
      var score = Math.abs(r.hs[0] - ref) * 6 + Math.max(0, x0 - x, x - x1) * 8 - (x1 - x0) * 0.2;
      if (score < bestScore) { bestScore = score; best = { x0: x0, x1: x1, hs: r.hs }; }
    });
    if (!best) return null;
    var sorted = best.hs.slice().sort(function (a, b) { return a - b; });
    return { cx: (best.x0 + best.x1) / 2, hw: (best.x1 - best.x0) / 2, h: sorted[sorted.length >> 1] };
  }

  // Ask where the floor is at an upcoming obstacle; the answer comes with the
  // next frame the game draws.
  var PROBE_ROWS = [-1.5, 0, 1.5];

  function probe(item, s, x, ref, below) {
    var xs = [], points = [];
    for (var dx = -PROBE_REACH; dx <= PROBE_REACH + 1e-6; dx += PROBE_STEP) xs.push(x + dx);
    PROBE_ROWS.forEach(function (ds) {
      xs.forEach(function (px) { points.push({ s: s + ds, x: px }); });
    });
    item.state = "probing";
    var forRun = run;
    game.probeFloor(points, function (hits) {
      if (run !== forRun || item.state !== "probing") return;
      var rows = hits ? PROBE_ROWS.map(function (ds, r) { return hits.slice(r * xs.length, (r + 1) * xs.length); }) : null;
      var floor = rows ? floorRow(xs, rows, x, ref, below) : null;
      item.floor = floor;
      item.state = floor ? "found" : "waiting";
    });
  }

  // Does a ball centred at (s, x, h) touch the part? (sphere against a turned box)
  function touches(p, s, x, h) {
    var os = s - p.s, ox = x - p.x;
    if (Math.abs(os) > p.hx + p.hs + 1) return false;
    var c = Math.cos(p.turn), sn = Math.sin(p.turn);
    var lx = ox * c + os * sn, ls = -ox * sn + os * c;
    var lh = h - (p.base + p.lift + p.hh);
    var dx = Math.max(0, Math.abs(lx) - p.hx);
    var ds = Math.max(0, Math.abs(ls) - p.hs);
    var dh = Math.max(0, Math.abs(lh) - p.hh);
    return dx * dx + ds * ds + dh * dh < BALL_RADIUS * BALL_RADIUS;
  }

  // --- The level being played ------------------------------------------------------

  var mode = null;      // null | "playing" | "won" | "failed"
  var run = null;       // { spec, plan, next, parts, startS, goalS, hit, progress }
  var pending = null;   // level to begin at the next run start
  var startTimer = 0;
  var startDelay = 0;
  var menuTimer = 0;
  var lastEnd = -Infinity; // when the last run ended, on the game's clock
  var CLEANUP = 3.7;       // the game clears the old track 3 s (game time) after a run ends
  var gameAt = "menu";  // where the game is: "menu" | "run" | "score"

  function begin(n) {
    var spec = levelSpec(n);
    run = { spec: spec, plan: planLevel(spec), next: 0, parts: [], startS: null, goalS: null,
      hit: null, progress: 0, last: null, lane: null, speed: 0 };
    mode = "playing";
    showHud();
    showIntro(spec);
  }

  // Advanced mode (modes.js): a normal endless run with every kind of
  // obstacle, closer together and quicker the further the ball gets. Same
  // placement and fairness as the levels; a hit is the game's own crash.
  var endless = false, endlessLast = null;
  function beginEndless() {
    run = { endless: true, spec: { n: 0, tempo: 1, pairs: false }, plan: [], next: 0, parts: [], startS: null, goalS: Infinity,
      hit: null, progress: 0, last: null, lane: null, speed: 0, planned: FIRST_OBSTACLE, passed: 0 };
    mode = "playing";
  }
  function extendEndless(ball) {
    var d = ball.s - run.startS;
    while (run.planned < d + Math.max(PLACE_AHEAD, run.speed * LOOK_AHEAD) + 40) {
      var at = run.planned, hard = Math.min(1, at / 2500);
      var kind = ORDER[Math.floor(Math.random() * ORDER.length)];
      run.plan.push({ kind: kind, at: at, a: Math.random(), b: Math.random(), c: Math.random(),
        spec: { tempo: 1 + 0.8 * hard, pairs: at > 600 } });
      run.planned += (22 - 12 * hard) * (0.8 + Math.random() * 0.5) + (kind === "spinner" ? 6 : 0);
    }
    run.plan.forEach(function (item) {
      if (item.state === "placed" && !item.passed && run.startS + item.at < ball.s - 2) { item.passed = true; run.passed++; }
    });
  }

  function now() { return performance.now() / 1000; }

  game.on("frame", function (frame) {
    if (!run || mode === null || run.ended) return;
    var ball = frame.ball;
    if (run.startS === null) {
      run.startS = ball.s;
      if (!run.endless) run.goalS = ball.s + run.spec.length;
    }
    if (run.endless) extendEndless(ball);
    // The ball's speed down the slope, smoothed (game clock).
    var clock = game.gameTime();
    if (run.clock !== undefined && clock > run.clock) {
      var v = (ball.s - run.lastS) / (clock - run.clock);
      if (v >= 0 && v < 300) run.speed = run.speed ? run.speed * 0.8 + v * 0.2 : v;
    }
    run.clock = clock;
    run.lastS = ball.s;
    // The floor height the ball rolls on tells the track ahead from tunnel
    // roofs and the city far below. In the air (off the starting ramp, or
    // over a drop) the track ahead can be lower, so look deeper; obstacles
    // never wait for the ball to land.
    var floor = window.SlopeGems ? window.SlopeGems.floor() : null;
    var ref = floor !== null ? floor : ball.h - 0.5;
    var below = floor === null || ball.h - floor > 0.8 ? AIR_DROP : 8;
    // How far ahead to place, and the nearest an obstacle may appear: more
    // room the faster the ball goes.
    var placeAhead = Math.max(PLACE_AHEAD, run.speed * LOOK_AHEAD);
    var giveUp = Math.max(GIVE_UP_AHEAD, run.speed * WARNING);

    // Put obstacles on the track once the floor under them exists, looking for
    // it straight ahead of the ball.
    // Probes run side by side, but obstacles are placed in order, as each
    // lane is picked from the one before.
    var waiting = [], blocked = false;
    for (var n = run.next; n < run.plan.length; n++) {
      var item = run.plan[n];
      var s = run.startS + item.at;
      if (item.state === "placed" || item.state === "skipped") {
        if (n === run.next) run.next++;
        continue;
      }
      if (s > ball.s + placeAhead) break;
      if (s < ball.s + giveUp) { item.state = "skipped"; continue; } // no floor there in time (a gap)
      if (item.state === "found" && !blocked) {
        var built = buildObstacle(item, s, item.floor, item.spec || run.spec,
          laneReach(run.lane || { s: ball.s, x: ball.x, depth: 0 }, s, item.kind, run.speed));
        if (built.lane !== undefined) run.lane = { s: s, x: built.lane, depth: item.kind === "spinner" ? 3.5 : 0.7 };
        run.parts = run.parts.concat(built);
        item.state = "placed";
        // The track is built in order, so ones before with no floor are over a gap.
        waiting.forEach(function (w) { w.state = "skipped"; });
        waiting = [];
        continue;
      }
      if (item.state === "waiting") item.empty = true;   // looked, and no floor yet
      if (item.state !== "probing" && item.state !== "found") probe(item, s, ball.x, ref, below);
      if (item.empty) waiting.push(item);
      else blocked = true;   // its first answer is still to come
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
          if (p.solid && touches(p, bs, bx, bh)) { run.hit = p.kind; break; }
        }
      }
      if (!run.endless) run.progress = Math.max(0, Math.min(1, (ball.s - run.startS) / run.spec.length));
      if (run.hit && run.endless) {
        mode = "failed";
        game.send("collide death");   // the game's own crash and score screen
      } else if (run.hit) {
        mode = "failed";
        lastEnd = game.gameTime();
        if (!game.send("collide death")) showResult(null);
      } else if (ball.s >= run.goalS) {
        mode = "won";
        run.progress = 1;
        profile.completeLevel(run.spec.n);
        lastEnd = game.gameTime();
        showResult(null); // first, so the crash that ends the run is never seen
        game.send("collide death");
      }
      // Below the floor it was rolling on: it fell off the track.
      if (ref !== null && ball.h < ref - 1.5) run.fell = true;
      if (!run.endless) renderHud();
    }
    run.last = { s: ball.s, x: ball.x, h: ball.h };
  });

  game.on("runstart", function () {
    gameAt = "run";
    clearInterval(startTimer);
    clearTimeout(startDelay);
    clearInterval(menuTimer);
    setStarting(null);
    if (pending !== null) {
      var n = pending;
      pending = null;
      hideScreens();
      begin(n);
    } else if (endless) {
      hideScreens();
      hideHud();
      beginEndless();
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
    lastEnd = Math.max(lastEnd, game.gameTime() - 0.05);
    if (!run || mode === null) return;
    if (run.endless) { endlessLast = { passed: run.passed }; run.parts = []; run = null; mode = null; return; }
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

  // Ask the game to start a run, again until it does. Right after a run ends
  // the game is still on its way to its score screen and ignores the request,
  // and 3 seconds after a run ends it clears the old track: a run started
  // before that would lose its track. So wait until then, showing
  // "Starting..." on the screen the player is looking at.
  function start(n) {
    if (!(n >= 1 && n <= profile.get().advUnlocked)) return;
    pending = n;
    clearInterval(startTimer);
    clearTimeout(startDelay);
    clearInterval(menuTimer);
    setStarting(n);
    var tries = 0;
    function attempt() {
      if (pending === null) { clearInterval(startTimer); return; }
      if (tries++ > 20) {
        clearInterval(startTimer);
        pending = null;
        setStarting(null);
        openGrid(null);
        els.gridStatus.textContent = "The game didn't start. Try again.";
        return;
      }
      game.send("resetPressed");
    }
    (function wait() {
      if (pending === null) return;
      if (game.gameTime() < lastEnd + CLEANUP) { startDelay = setTimeout(wait, 100); return; }
      attempt();
      startTimer = setInterval(attempt, 500);
    })();
  }

  // While a level is starting, the screen shows it and its buttons wait.
  function setStarting(n) {
    if (!els.grid) return;
    var busy = n !== null;
    [els.resultMain, els.resultLevels, els.resultMenu, els.cont, els.back, els.more].forEach(function (b) { b.disabled = busy; });
    els.list.classList.toggle("is-busy", busy);
    if (busy) {
      if (!els.result.hidden) els.resultMain.textContent = "Starting...";
      if (!els.grid.hidden) els.gridStatus.textContent = "Starting level " + n + "...";
    }
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
    if (!run || !run.parts.length || gfxFailed) return;
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
      gl.uniform3fv(gfx.u.uCentre, game.toWorld(p.s, p.base + p.lift + p.hh, p.x));
      gl.uniform3f(gfx.u.uAxisX, SIDE[0] * c + DOWNHILL[0] * sn, SIDE[1] * c + DOWNHILL[1] * sn, SIDE[2] * c + DOWNHILL[2] * sn);
      gl.uniform3f(gfx.u.uAxisZ, DOWNHILL[0] * c - SIDE[0] * sn, DOWNHILL[1] * c - SIDE[1] * sn, DOWNHILL[2] * c - SIDE[2] * sn);
      gl.uniform3f(gfx.u.uHalf, p.hx, p.hh, p.hs);
      gl.uniform3fv(gfx.u.uColor, p.color);
      gl.uniform1f(gfx.u.uGlow, p.glow);
      gl.uniform1f(gfx.u.uEdge, p.dim ? 0.3 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    });
  }, function () { return !!run && run.parts.length > 0 && !gfxFailed; });

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
      '<div class="slope-xp-bar slope-adventure-hud-bar" aria-hidden="true">' + xpCells() + "</div>" +
      '<p class="slope-adventure-hud-togo"></p>';
    ui.root.appendChild(hud);

    // Shown for a moment when a level starts, so it doesn't feel like a normal run.
    var intro = document.createElement("div");
    intro.className = "slope-level-intro";
    intro.setAttribute("role", "status");
    intro.hidden = true;
    intro.innerHTML =
      '<p class="slope-level-intro-title"></p>' +
      '<p class="slope-level-intro-kinds"></p>' +
      '<p class="slope-level-intro-goal"></p>';
    ui.root.appendChild(intro);

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
      resultLevels: result.querySelector(".slope-result-levels"),
      resultMenu: result.querySelector(".slope-result-menu"),
      hud: hud,
      hudTitle: hud.querySelector(".slope-adventure-hud-title"),
      hudBar: hud.querySelector(".slope-adventure-hud-bar"),
      hudToGo: hud.querySelector(".slope-adventure-hud-togo"),
      intro: intro
    };

    els.cont.addEventListener("click", function () { start(profile.get().advUnlocked); });
    els.more.addEventListener("click", function () { addLevels(LEVEL_STEP); });
    els.back.addEventListener("click", function () {
      if (gameAt === "score") goToMenu(); else closeGrid();
    });
    els.list.addEventListener("click", function (e) {
      var tile = e.target.closest("[data-level]");
      if (tile && !tile.disabled && pending === null) start(+tile.getAttribute("data-level"));
    });
    grid.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || pending !== null) return;
      if (gameAt === "score") goToMenu(); else closeGrid();
    });
    els.resultMain.addEventListener("click", function () {
      if (pending === null) start(+els.resultMain.getAttribute("data-level"));
    });
    els.resultLevels.addEventListener("click", function () { openGrid(null); });
    els.resultMenu.addEventListener("click", goToMenu);

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
    // Let go of focus too: keys pressed in the page's UI never reach the game,
    // so a focused (now hidden) button would stop the ball from steering.
    if (els.grid.contains(document.activeElement) || els.result.contains(document.activeElement)) document.activeElement.blur();
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
      : run.hit ? "You hit " + KINDS[run.hit].hit + "."
      : run.fell ? "You fell off the track." : "You crashed before the finish line.";
    fill(els.resultBar, run.progress);
    els.resultBar.setAttribute("aria-valuenow", String(Math.round(run.progress * 100)));
    var gems = window.SlopeGems ? window.SlopeGems.currentRun().gems : 0;
    els.resultStats.textContent = Math.round(run.progress * 100) + "% of the level" +
      (score !== null && score !== undefined ? "  \u00b7  Score " + score + "  \u00b7  +" + profile.xpFor(score) + " XP" : "") +
      (gems ? "  \u00b7  +" + gems + (gems === 1 ? " gem" : " gems") : "");
    els.resultMain.textContent = pending !== null ? "Starting..." : won ? "Next level" : "Retry";
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
    hideIntro();
  }

  function renderHud() {
    if (!els.hud || !run) return;
    var text = "Level " + run.spec.n + "  " + run.spec.title;
    if (els.hudTitle.textContent !== text) els.hudTitle.textContent = text;
    fill(els.hudBar, run.progress);
    var left = Math.max(0, Math.ceil((1 - run.progress) * run.spec.length));
    var toGo = left ? left + " m to the finish" : "Finish!";
    if (els.hudToGo.textContent !== toGo) els.hudToGo.textContent = toGo;
  }

  var introTimer = 0;

  function showIntro(spec) {
    if (!els.intro) return;
    els.intro.querySelector(".slope-level-intro-title").textContent = "Level " + spec.n;
    els.intro.querySelector(".slope-level-intro-kinds").textContent = spec.title;
    els.intro.querySelector(".slope-level-intro-goal").textContent = "Avoid the red obstacles and reach the finish line";
    els.intro.hidden = false;
    clearTimeout(introTimer);
    introTimer = setTimeout(hideIntro, 3000);
  }

  function hideIntro() {
    clearTimeout(introTimer);
    if (els.intro) els.intro.hidden = true;
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
    handlesRun: function () { return !!run && mode !== null && !run.endless; },
    // Advanced mode: normal runs get endless obstacles while this is on.
    setEndless: function (on) { endless = !!on; },
    // Obstacles passed in this Advanced run (or the last one, after it ends).
    dodged: function () { return run && run.endless ? run.passed : endlessLast ? endlessLast.passed : 0; },
    // The obstacles on the track now (slope coordinates; for tools and tests).
    obstacles: function () {
      return run ? run.parts.map(function (p) {
        return { kind: p.kind, s: p.s, x: p.x, h: p.base + p.lift + p.hh, hx: p.hx, hs: p.hs, hh: p.hh, base: p.base, turn: p.turn, solid: p.solid };
      }) : [];
    }
  };

  window.SlopeUI.ready(buildScreens);
})();
