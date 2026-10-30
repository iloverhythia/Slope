/*
 * Adventure: an endless ladder of levels, opened from the game's Adventure
 * menu button.
 *
 * Every level is a run of the normal game with a finish line and its own
 * set of obstacles, drawn into the game's 3D scene in the game's style
 * (black boxes with red neon edges): blocks, walls with a gap, sliders,
 * lasers that switch on and off, pillars that rise from the floor, spinning
 * bars, walls whose gap slides, pendulums, blocks that drop from the sky,
 * rams that charge up and down the slope, spikes, orbiting blocks and
 * slalom gates.
 *
 * Some stretches of track are other kinds of slope, with their own floor:
 * a narrow winding trench, lava with a safe path through it, boost (the game
 * speeds up) and ice (turns slide on after the key is let go; steer.js
 * changes what the game hears from the keys).
 *
 * Levels 1 to 17 bring in one new obstacle or slope each; after that every
 * level mixes two or three obstacles and often a slope or two, and they get
 * quicker and a little denser.
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
 *   SlopeAdventure.slope()       the slope the ball is on ("normal", "narrow", "lava", "boost", "ice")
 *   SlopeAdventure.zones()       the run's stretches of other slopes (slope coordinates)
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
  var GREEN = [0.3, 1.0, 0.3];   // the game's own neon (tinted with the track colour)
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
    spinner: { name: "Spinners", hit: "a spinner" },
    door: { name: "Doors", hit: "a sliding door", text: "The gap in the wall slides to and fro" },
    pendulum: { name: "Pendulums", hit: "a pendulum", text: "Weights swing beside your lane" },
    dropper: { name: "Droppers", hit: "a falling block", text: "Blocks drop where the red marks are" },
    ram: { name: "Rams", hit: "a ram", text: "Blocks charge up and down the slope" },
    spikes: { name: "Spikes", hit: "the spikes", text: "Spikes pop up beside your lane" },
    orbiter: { name: "Orbiters", hit: "an orbiter", text: "Blocks circle around a post" },
    slalom: { name: "Slalom", hit: "a slalom gate", text: "Weave left and right through the gates" },
    // The parts of the narrow and lava slopes.
    narrow: { name: "Narrow slope", hit: "the side of the trench" },
    lava: { name: "Lava slope", hit: "the lava" }
  };
  var ORDER = ["block", "wall", "slider", "laser", "pillar", "spinner",
    "door", "pendulum", "dropper", "ram", "spikes", "orbiter", "slalom"];

  // Stretches of track that are another kind of slope. path: a winding
  // path to follow (built of parts); the others change how the ball handles.
  var SLOPES = {
    narrow: { name: "Narrow slope", short: "Narrow", text: "Stay in the winding trench", path: true },
    lava: { name: "Lava slope", short: "Lava", text: "Keep to the dark path", path: true },
    boost: { name: "Boost slope", short: "Boost", text: "Everything speeds up" },
    ice: { name: "Ice slope", short: "Ice", text: "Turns slide on after you let go" }
  };
  var SLOPE_ORDER = ["narrow", "boost", "ice", "lava"];
  // Levels 1 to 17 each bring in one new obstacle or slope.
  var INTRO = ["block", "wall", "slider", "laser", "pillar", "spinner", "door", "narrow", "pendulum",
    "dropper", "boost", "ram", "spikes", "ice", "orbiter", "slalom", "lava"];

  // How far an obstacle reaches along the slope from its centre: the lanes
  // before and after it must be reachable around it.
  var DEPTH = { spinner: 3.5, ram: 3.8, orbiter: 2.5, pendulum: 3.4, dropper: 0.8, spikes: 0.8 };
  var ROOMY = { slider: 1, spinner: 1, pendulum: 1, orbiter: 1, dropper: 1, ram: 1 };
  function depthOf(kind) { return DEPTH[kind] || 0.7; }

  // Floor panel looks (the fragment shader's uStyle).
  var STYLE = { box: 0, lava: 1, boost: 2, ice: 3, mark: 5 };
  var PATH = { narrow: 3.6, lava: 3.0 };   // the open path through a narrow or lava slope (the ball is 1)
  var SEGMENT = 3;               // slopes are built in pieces this long
  var BOOST = 1.3;               // game speed on a boost slope
  var ICE_SLIDE = 0.2;           // seconds a turn slides on, on ice

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

  // count different items from list (seeded).
  function pick(random, list, count) {
    var pool = list.slice(), out = [];
    while (out.length < count && pool.length) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    return out;
  }

  function levelSpec(n) {
    var random = seeded(n * 7919 + 13);
    var fresh = n <= INTRO.length ? INTRO[n - 1] : null;   // what the level brings in
    var metKinds = INTRO.slice(0, Math.min(n - 1, INTRO.length)).filter(function (k) { return !SLOPES[k]; });
    var kinds, slopes = [];
    if (n <= 6) {
      // One new obstacle per level, mixed with the ones before it.
      kinds = [ORDER[n - 1]].concat(ORDER.slice(0, n - 1));
    } else if (fresh && !SLOPES[fresh]) {
      kinds = [fresh].concat(pick(random, metKinds, 2));
    } else if (fresh) {
      slopes = [fresh];
      kinds = pick(random, metKinds, 2);
    } else {
      kinds = pick(random, ORDER, 2 + Math.floor(random() * 2));
      var r = random();
      if (r < 0.7) slopes = pick(random, SLOPE_ORDER, r < 0.2 ? 2 : 1);
    }
    var hard = Math.min(1, (n - 1) / 40);
    return {
      n: n,
      kinds: kinds,                     // kinds[0] is the level's main obstacle
      slopes: slopes,                   // the other slopes on its stretches
      fresh: fresh,
      length: Math.min(MAX_LENGTH, 240 + 45 * (n - 1)),   // metres down the slope
      gap: 34 - 16 * hard,              // track between obstacles
      tempo: 1 + 0.8 * hard,            // speed of moving obstacles
      pairs: n >= 12,                   // some obstacles come two at a time
      seed: n * 7919 + 13,
      title: fresh ? (SLOPES[fresh] || KINDS[fresh]).name
        : slopes.map(function (k) { return SLOPES[k].short; })
          .concat(kinds.map(function (k) { return KINDS[k].name; })).join(" + ")
    };
  }

  // One obstacle at `at` (a slalom is three gates that switch sides);
  // returns where the next one may go.
  function addObstacle(plan, kind, at, random, gap, spec) {
    if (kind === "slalom") {
      var first = random() < 0.5 ? 0.02 : 0.98;
      for (var i = 0; i < 3; i++) {
        plan.push({ kind: kind, at: at + i * 8, a: i % 2 ? 1 - first : first, b: random(), c: random(), spec: spec });
      }
      at += 16;
    } else {
      plan.push({ kind: kind, at: at, a: random(), b: random(), c: random(), spec: spec });
    }
    return at + gap * (0.8 + random() * 0.5) + depthOf(kind) * 1.5;
  }

  // The stretches of other slopes in a level: [{ type, from, to }], in
  // metres from the start.
  function planZones(spec, random) {
    var zones = [];
    if (!spec.slopes.length) return zones;
    var intro = !!SLOPES[spec.fresh];
    var at = intro ? 50 : 70 + random() * 40;
    for (var i = 0; ; i++) {
      var type = spec.slopes[i % spec.slopes.length], path = SLOPES[type].path;
      var len = ((path ? 40 : 60) + random() * (path ? 25 : 40)) * (intro ? 1.3 : 1);
      if (at + len > spec.length - 35) break;
      zones.push({ type: type, from: at, to: at + len });
      at += len + (intro ? 45 + random() * 30 : 90 + random() * 70);
    }
    return zones;
  }

  // The pieces of a slope stretch, one every SEGMENT metres: a narrow or lava
  // path winds (step: which way it bends there), the others are floor panels.
  function addZone(plan, zone, random, spec) {
    var path = SLOPES[zone.type].path, phase = random() * 2 * Math.PI;
    for (var k = 0, at = zone.from; at <= zone.to; k++, at += SEGMENT) {
      plan.push(path
        ? { kind: zone.type, at: at, a: random(), b: 0, c: 0, step: Math.sin(phase + k * 0.3), first: k === 0, zone: zone, spec: spec }
        : { kind: "panel", at: at, a: 0, b: 0, c: 0, zone: zone, panel: true, spec: spec });
    }
  }

  function zoneAt(zones, at, margin) {
    for (var i = 0; i < zones.length; i++) {
      if (at > zones[i].from - margin && at < zones[i].to + margin) return zones[i];
    }
    return null;
  }

  function planLevel(spec) {
    var random = seeded(spec.seed + 1);
    var zones = planZones(spec, random);
    var plan = [];
    var at = FIRST_OBSTACLE;
    while (at < spec.length - 25) {
      var kind = random() < 0.55 ? spec.kinds[0] : spec.kinds[Math.floor(random() * spec.kinds.length)];
      // A narrow or lava stretch is the obstacle there.
      var zone = zoneAt(zones, at, 10) || zoneAt(zones, at + (kind === "slalom" ? 16 : 0), 10);
      if (zone && SLOPES[zone.type].path) { at = zone.to + 12 + random() * 8; continue; }
      at = addObstacle(plan, kind, at, random, spec.gap);
    }
    zones.forEach(function (z) { addZone(plan, z, random); });
    plan.push({ kind: "finish", at: spec.length, a: 0, b: 0, c: 0 });
    plan.sort(function (p, q) { return p.at - q.at; });
    plan.zones = zones;
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
  function buildObstacle(item, s, track, spec, reach, speed) {
    if (item.kind === "finish") return finishLine(s, track);
    if (item.kind === "panel") return slopePanel(item, s, track);
    var cx = track.cx, hw = track.hw;
    var x0 = cx - hw, x1 = cx + hw;
    var path = !!SLOPES[item.kind];      // a piece of a narrow or lava slope
    var open = path ? PATH[item.kind] : LANE;   // the width kept open
    if (x1 - x0 < open + 1.2) return []; // a narrow beam: nothing fits beside the lane
    var w = 2 * Math.PI;
    var t = spec.tempo;
    var parts = [];
    // The open lane, and the floor on each side of it.
    var lo = x0 + open / 2, hi = x1 - open / 2;
    var prev = reach ? (reach[0] + reach[1]) / 2 : null;
    if (reach) {
      // No lane within reach (the track itself moves over there): left out.
      if (reach[0] > hi || reach[1] < lo) return [];
      lo = Math.max(lo, reach[0]);
      hi = Math.min(hi, reach[1]);
    }
    // Obstacles that need room on one side put the lane near an edge.
    var a = ROOMY[item.kind] ? (item.a < 0.5 ? item.a * 0.2 : 1 - (1 - item.a) * 0.2) : item.a;
    var lane = lo + a * (hi - lo);
    if (path && !item.first && prev !== null) {
      // A slope's path bends smoothly, never faster than the ball can follow.
      var fast = Math.max(12, (speed || 0) * 1.2 + 12);
      lane = Math.max(lo, Math.min(hi, prev + item.step * Math.min(0.6, STEER * SEGMENT / fast)));
    }
    var sides = [{ a: x0, b: lane - open / 2 }, { a: lane + open / 2, b: x1 }]
      .filter(function (r) { return r.b - r.a > 0.05; });
    var wide = sides.slice().sort(function (p, q) { return (q.b - q.a) - (p.b - p.a); })[0];
    function within(r, half, v) { return r.a + half + v * Math.max(0, r.b - r.a - 2 * half); }
    // Obstacles on one side only, unless pairs are on and this one comes as a pair.
    function used(r) { return r === wide || (spec.pairs && item.c < 0.35); }
    switch (item.kind) {
      case "block":
        // One block (two in some later levels) beside the lane.
        sides.forEach(function (r, i) {
          if (r.b - r.a < 1.1) return;
          if (used(r)) parts.push(box(s, within(r, 0.55, i ? item.b : item.c), 0.55, 0.55, 0.55));
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
          if (r.b - r.a < 1.4 || !used(r)) return;
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
        var speedTurn = (item.b < 0.5 ? 1 : -1) * w / (3.4 / t), start = item.c * w;
        parts.push(box(s, hub, r - 0.1, 0.22, 0.45, { move: function (p, now) { p.turn = start + now * speedTurn; } }));
        parts.push(box(s, hub, 0.3, 0.3, 0.6, { solid: true })); // the hub
        break;
      case "door":
        // A wall whose gap slides to and fro; the lane always stays inside the gap.
        var swing = Math.max(0.5, Math.min(1.4, (x1 - x0 - LANE) / 4)), doorPeriod = 3 / t, doorPhase = item.b * w;
        [-1, 1].forEach(function (side) {
          parts.push(box(s, lane, 0.1, 0.35, 0.5, {
            move: function (p, now) {
              var o = swing * Math.sin(now * w / doorPeriod + doorPhase);
              if (side < 0) span(p, x0, lane - LANE / 2 - swing + o);
              else span(p, lane + LANE / 2 + swing + o, x1);
            }
          }));
        });
        break;
      case "pendulum":
        // A weight swings from a beam overhead, on its side of the lane:
        // sideways where that side is wide, along the slope where it isn't.
        var half = (wide.b - wide.a) / 2;
        if (half < 0.6) break;
        var ARM = 3.6, top = ARM + 0.52, centre = (wide.a + wide.b) / 2;
        var across = half - 0.75 >= 1.0;
        var most = across ? Math.asin(Math.min(0.6, (half - 0.75) / ARM)) : 0.7;
        var swingPeriod = 2.6 / t, swingPhase = item.b * w;
        var angle = function (now) { return most * Math.sin(now * w / swingPeriod + swingPhase); };
        var hang = function (p, now, len) {
          var a = angle(now);
          if (across) { p.x = centre + len * Math.sin(a); p.roll = a; }
          else { p.s = s + len * Math.sin(a); p.pitch = a; }
          p.lift = top - len * Math.cos(a) - p.hh;
        };
        // A post at the track's edge and a beam from it over the weight.
        var outer = wide.a <= x0 + 0.01 ? wide.a + 0.12 : wide.b - 0.12;
        parts.push(box(s, outer, 0.12, 0.12, top / 2));
        parts.push(across ? box(s, centre, half, 0.18, 0.12, { solid: false, lift: top - 0.12 })
          : box(s, (outer + centre) / 2, Math.abs(outer - centre) / 2 + 0.12, 0.18, 0.12, { solid: false, lift: top - 0.12 }));
        parts.push(box(s, centre, 0.06, 0.06, ARM / 2, { solid: false, move: function (p, now) { hang(p, now, ARM / 2); } }));
        parts.push(box(s, centre, 0.5, 0.5, 0.5, { move: function (p, now) { hang(p, now, ARM); } }));
        break;
      case "dropper":
        // Blocks fall from the sky beside the lane, rest a moment and rise
        // again; a red mark on the floor shows where they land.
        var dropPeriod = 3 / t;
        sides.forEach(function (r, i) {
          if (r.b - r.a < 1.5 || !used(r)) return;
          var px = within(r, 0.75, i ? item.b : item.c), phase = item.c + i * 0.5;
          var high = function (now) {
            var k = ((now / dropPeriod + phase) % 1 + 1) % 1;
            if (k < 0.4) return 1;                                         // waiting up high
            if (k < 0.5) { var f = (k - 0.4) / 0.1; return 1 - f * f; }    // falling
            if (k < 0.75) return 0;                                        // down
            return (k - 0.75) / 0.25;                                      // going back up
          };
          parts.push(box(s, px, 0.75, 0.75, 0.005, { solid: false, lift: 0.03, style: STYLE.mark,
            move: function (p, now) { p.glow = 1 - high(now); } }));
          parts.push(box(s, px, 0.7, 0.7, 0.7, { move: function (p, now) { p.lift = high(now) * 5.5; } }));
        });
        break;
      case "ram":
        // Blocks charge up and down the slope beside the lane.
        var ramPeriod = 3.2 / t;
        sides.forEach(function (r, i) {
          if (r.b - r.a < 1.5 || !used(r)) return;
          var px = within(r, 0.7, i ? item.b : item.c), phase = (item.b + i * 0.5) * w;
          parts.push(box(s, px, 0.7, 0.7, 0.7, { move: function (p, now) { p.s = s + 3 * Math.sin(now * w / ramPeriod + phase); } }));
        });
        break;
      case "spikes":
        // Two rows of spikes beside the lane pop up and sink in a wave.
        var spikePeriod = 2.4 / t;
        sides.forEach(function (r) {
          var width = r.b - r.a;
          if (width < 0.6) return;
          var count = Math.max(1, Math.floor(width / 0.7));
          for (var k = 0; k < count; k++) {
            [-0.6, 0.6].forEach(function (ds, row) {
              var px = r.a + (k + 0.5) * width / count, phase = item.b * w - px * 0.8 - row * 0.6;
              parts.push(box(s + ds, px, 0.15, 0.15, 0.55, { glow: 0.25, move: function (p, now) {
                var up = Math.min(1, Math.max(0, 0.5 + 1.2 * Math.sin(now * w / spikePeriod + phase)));
                p.lift = (up - 1) * 1.15;
              } }));
            });
          }
        });
        break;
      case "orbiter":
        // Two blocks circle a post on their side of the lane.
        var radius = Math.min(2.0, (wide.b - wide.a) / 2 - 0.6);
        if (radius < 0.6) break;
        var post = (wide.a + wide.b) / 2, spin = (item.b < 0.5 ? 1 : -1) * w / (3 / t), from = item.c * w;
        parts.push(box(s, post, 0.22, 0.22, 0.9));
        [0, Math.PI].forEach(function (off) {
          parts.push(box(s, post, 0.45, 0.45, 0.45, { move: function (p, now) {
            var a = from + off + now * spin;
            p.x = post + radius * Math.cos(a); p.s = s + radius * Math.sin(a); p.turn = a;
          } }));
        });
        break;
      case "slalom":
        // A gate: a tall lit wall with the lane as its gap. The three gates
        // of a slalom put their gaps on alternate sides.
        sides.forEach(function (r) { parts.push(box(s, (r.a + r.b) / 2, (r.b - r.a) / 2, 0.2, 0.8, { glow: 0.35 })); });
        break;
      case "narrow":
        // A narrow slope: the floor beside the path is walled off, low, so
        // the path is a winding trench.
        sides.forEach(function (r) { parts.push(box(s, (r.a + r.b) / 2, (r.b - r.a) / 2, SEGMENT / 2, 0.3)); });
        break;
      case "lava":
        // A lava slope: the floor beside the path is lava.
        sides.forEach(function (r) {
          parts.push(box(s, (r.a + r.b) / 2, (r.b - r.a) / 2, SEGMENT / 2, 0.01, { lift: 0.03, style: STYLE.lava, hazard: true }));
        });
        break;
    }
    var at = now();
    parts.forEach(function (p) {
      p.kind = item.kind;
      p.base = track.h;
      if (p.move) p.move(p, at);
    });
    parts.lane = lane;
    return parts;
  }

  // A part that spans a to b sideways; hidden when there is nothing left of it.
  function span(p, a, b) {
    if (b - a < 0.08) { p.hidden = true; p.solid = false; return; }
    p.hidden = false;
    p.solid = true;
    p.x = (a + b) / 2;
    p.hx = (b - a) / 2;
  }

  // A floor panel of a boost or ice slope, across the whole track.
  function slopePanel(item, s, track) {
    var z = item.zone;
    var p = box(s, track.cx, track.hw, SEGMENT / 2, 0.01, { solid: false, lift: 0.03, style: STYLE[z.type],
      color: z.type === "boost" ? GREEN : WHITE });
    p.kind = "panel";
    p.base = track.h;
    return [p];
  }

  // Where the next lane may be: within reach of the last one at the speed the
  // ball may have by then (it speeds up quickly, so allow for more).
  function laneReach(last, s, kind, speed) {
    if (!last) return null;
    var room = s - last.s - 2 * BALL_RADIUS - last.depth - depthOf(kind);
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
  // next frame the game draws. The rows cover as much of the slope as the
  // obstacle does.
  function probeRows(kind) {
    if (kind === "ram") return [-3.5, -1.75, 0, 1.75, 3.5];
    if (kind === "orbiter" || kind === "pendulum") return [-2.5, 0, 2.5];
    if (kind === "panel" || SLOPES[kind]) return [-1.4, 0, 1.4];
    return [-1.5, 0, 1.5];
  }

  function probe(item, s, x, ref, below) {
    var xs = [], points = [];
    var rowsAt = probeRows(item.kind);
    for (var dx = -PROBE_REACH; dx <= PROBE_REACH + 1e-6; dx += PROBE_STEP) xs.push(x + dx);
    rowsAt.forEach(function (ds) {
      xs.forEach(function (px) { points.push({ s: s + ds, x: px }); });
    });
    item.state = "probing";
    var forRun = run;
    game.probeFloor(points, function (hits) {
      if (run !== forRun || item.state !== "probing") return;
      var rows = hits ? rowsAt.map(function (ds, r) { return hits.slice(r * xs.length, (r + 1) * xs.length); }) : null;
      var floor = rows ? floorRow(xs, rows, x, ref, below) : null;
      item.floor = floor;
      item.state = floor ? "found" : "waiting";
    });
  }

  // In the air: the highest floor right under the ball (answered next frame).
  function probeLanding(ball) {
    if (run.landingAsked) return;
    run.landingAsked = true;
    var forRun = run, top = ball.h - 0.4;
    game.probeFloor([{ s: ball.s, x: ball.x }], function (hits) {
      if (run !== forRun) return;
      run.landingAsked = false;
      var best = null;
      ((hits && hits[0]) || []).forEach(function (hit) {
        if (hit.flat && hit.h < top && (best === null || hit.h > best)) best = hit.h;
      });
      run.landing = best;
      run.noLanding = best === null ? (run.noLanding || 0) + 1 : 0;
    });
  }

  // Does a ball centred at (s, x, h) touch the part? (sphere against a turned box)
  function touches(p, s, x, h) {
    var os = s - p.s, ox = x - p.x;
    if (Math.abs(os) > p.hx + p.hs + 1) return false;
    var c = Math.cos(p.turn), sn = Math.sin(p.turn);
    var lx = ox * c + os * sn, ls = -ox * sn + os * c;
    // Lava burns where the ball rolls on it (its middle over it), not in the air.
    if (p.hazard) return Math.abs(lx) < p.hx - 0.1 && Math.abs(ls) < p.hs && h - p.base < 0.95;
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
  // obstacle and, now and then, a stretch of another slope; they come a
  // little closer together and quicker the further the ball gets. Same
  // placement and fairness as the levels; a hit is the game's own crash.
  var endless = false, endlessLast = null;
  function beginEndless() {
    var plan = [];
    plan.zones = [];
    run = { endless: true, spec: { n: 0, tempo: 1, pairs: false }, plan: plan, next: 0, parts: [], startS: null, goalS: Infinity,
      hit: null, progress: 0, last: null, lane: null, speed: 0, planned: FIRST_OBSTACLE,
      nextZone: 260 + Math.random() * 120, passed: 0, counted: 0 };
    mode = "playing";
  }
  function extendEndless(ball) {
    var d = ball.s - run.startS, added = false;
    while (run.planned < d + Math.max(PLACE_AHEAD, run.speed * LOOK_AHEAD) + 60) {
      var at = run.planned, hard = Math.min(1, at / 3000);
      var spec = { tempo: 1 + 0.8 * hard, pairs: at > 1200 };
      added = true;
      if (at >= run.nextZone) {
        var type = SLOPE_ORDER[Math.floor(Math.random() * SLOPE_ORDER.length)], path = SLOPES[type].path;
        var zone = { type: type, from: at, to: at + (path ? 40 : 60) + Math.random() * (path ? 30 : 50) };
        run.plan.zones.push(zone);
        addZone(run.plan, zone, Math.random, spec);
        run.nextZone = zone.to + 200 + Math.random() * 150;
        // A narrow or lava stretch is the obstacle there.
        if (path) { run.planned = zone.to + 12 + Math.random() * 8; continue; }
      }
      var kind = ORDER[Math.floor(Math.random() * ORDER.length)];
      if (kind === "slalom" && at + 26 > run.nextZone) kind = "wall";   // its gates stay clear of the next stretch
      run.planned = addObstacle(run.plan, kind, at, Math.random, 34 - 16 * hard, spec);
    }
    // New pieces of a stretch can come after obstacles already planned.
    if (added) {
      var zones = run.plan.zones;
      run.plan.sort(function (p, q) { return p.at - q.at; });
      run.plan.zones = zones;
    }
    // Obstacles passed: every obstacle (each slalom gate) and every narrow or
    // lava stretch the ball got through.
    for (; run.counted < run.plan.length; run.counted++) {
      var item = run.plan[run.counted];
      if (run.startS + item.at >= ball.s - 2) break;
      if (item.state !== "placed" || item.panel) continue;
      if (!SLOPES[item.kind] || item.at + SEGMENT > item.zone.to) run.passed++;
    }
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
    // over a drop) it is the floor right under the ball, where it will land
    // (high on the starting ramp, the top of the tunnel roof ahead is nearer
    // than the tunnel's floor); the track ahead can be lower still, so look
    // deeper. Obstacles never wait for the ball to land.
    var floor = window.SlopeGems ? window.SlopeGems.floor() : null;
    var airborne = floor === null || ball.h - floor > 0.8;
    // (No floor under it: asked again; over a real gap for a while, the
    // ball's own height has to do.)
    if (airborne) probeLanding(ball); else { run.landing = undefined; run.noLanding = 0; }
    var overGap = run.landing === null && run.noLanding > 20;
    var landingKnown = !airborne || typeof run.landing === "number" || overGap;
    var ref = !airborne ? floor : typeof run.landing === "number" ? run.landing : ball.h - 0.5;
    var below = airborne ? AIR_DROP : 8;
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
          laneReach(run.lane || { s: ball.s, x: ball.x, depth: 0 }, s, item.kind, run.speed), run.speed);
        if (built.lane !== undefined) {
          run.lane = { s: s, x: built.lane, depth: depthOf(item.kind) };
          (run.lanes = run.lanes || []).push({ s: s, x: built.lane, kind: item.kind });
          if (run.lanes.length > 64) run.lanes.shift();
        }
        run.parts = run.parts.concat(built);
        item.state = "placed";
        // The track is built in order, so ones before with no floor are over a gap.
        waiting.forEach(function (w) { w.state = "skipped"; });
        waiting = [];
        continue;
      }
      if (item.state === "waiting") item.empty = true;   // looked, and no floor yet
      if (item.state !== "probing" && item.state !== "found") {
        if (!landingKnown) { blocked = true; continue; }
        probe(item, s, ball.x, ref, below);
      }
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
    updateZone(ball);
    run.last = { s: ball.s, x: ball.x, h: ball.h };
  });

  // --- Other slopes ---------------------------------------------------------------
  // On a boost or ice stretch the ball handles differently while it is
  // on it; a banner says which slope it is and how much is left.

  var zoneOn = null;

  function updateZone(ball) {
    var zone = null;
    if (run && mode === "playing" && run.startS !== null) {
      var d = ball.s - run.startS;
      zone = zoneAt(run.plan.zones || [], d, 0);
    }
    if (zone !== zoneOn) setZone(zone);
    if (zone) renderZone((zone.to - d) / (zone.to - zone.from));
  }

  function setZone(zone) {
    var was = zoneOn;
    zoneOn = zone;
    var steer = window.SlopeSteer;
    if (was && was.type === "boost") game.setTimeScale(1);
    if (was && steer && was.type === "ice") steer.ice(0);
    if (zone && zone.type === "boost") game.setTimeScale(BOOST);
    if (zone && steer && zone.type === "ice") steer.ice(ICE_SLIDE);
    if (zone) showZone(zone); else hideZone();
  }

  game.on("runstart", function () {
    gameAt = "run";
    setZone(null);
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
    setZone(null);
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
    setZone(null);
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
    setZone(null);
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

  // Black faces and neon edges, like the game's own red blocks. Floor
  // panels (uStyle > 0) get a pattern in track units instead: lava, boost
  // chevrons, ice or a landing mark. Colours keep to red, the
  // game's green and greys, so the track colour setting tints them like the
  // rest of the game.
  var FRAGMENT_SHADER = [
    "#version 300 es",
    "precision highp float;",
    "in vec3 vLocal;",
    "in vec3 vNormal;",
    "uniform vec3 uHalf, uColor;",
    "uniform float uGlow, uEdge, uStyle, uTime;",
    "uniform vec2 uOrigin;",
    "out vec4 outColor;",
    "void main() {",
    "  vec3 e = uHalf - abs(vLocal);",
    "  float lo = min(e.x, min(e.y, e.z)), hi = max(e.x, max(e.y, e.z));",
    "  float mid = e.x + e.y + e.z - lo - hi;", // distance to the nearest edge
    "  float aa = fwidth(mid) + 1e-4;",
    "  float line = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, mid);",
    "  if (uStyle < 0.5) {",
    "    float light = 0.55 + 0.45 * max(0.0, dot(vNormal, normalize(vec3(0.3, 0.8, -0.5))));",
    "    vec3 face = mix(vec3(0.015), uColor * 0.9, uGlow) * light;",
    "    outColor = vec4(mix(face, uColor * uEdge, line), 1.0);",
    "    return;",
    "  }",
    "  vec2 q = vec2(vLocal.x + uOrigin.x, vLocal.z + uOrigin.y);", // x sideways, y downhill
    "  float aq = fwidth(q.x) + fwidth(q.y) + 1e-4;",
    "  vec3 c;",
    "  if (uStyle < 1.5) {", // lava
    "    float n = sin(q.x * 1.7 + uTime * 1.3) * sin(q.y * 1.1 - uTime * 0.8) + 0.5 * sin((q.x - q.y) * 2.3 + uTime * 1.9);",
    "    c = mix(vec3(0.42, 0.02, 0.0), vec3(1.0, 0.16, 0.02), 0.5 + 0.33 * n);",
    "    c = mix(c, vec3(1.0, 0.45, 0.12), smoothstep(0.8, 1.3, n));",
    "  } else if (uStyle < 2.5) {", // boost: chevrons pointing downhill, running down
    "    float v = fract((q.y + abs(vLocal.x) * 0.6) * 0.45 - uTime * 1.6);",
    "    float band = smoothstep(0.0, 0.03 + aq, v) - smoothstep(0.32, 0.35 + aq, v);",
    "    c = mix(vec3(0.0, 0.045, 0.0), vec3(0.3, 1.0, 0.3), band);",
    "  } else if (uStyle < 3.5) {", // ice: a pale sheet with cracks and a passing shine
    "    float l1 = abs(fract(q.x * 0.5 + 0.25 * sin(q.y * 0.9)) - 0.5);",
    "    float l2 = abs(fract(q.y * 0.35 + 0.3 * sin(q.x * 1.3)) - 0.5);",
    "    float crack = 1.0 - smoothstep(0.012, 0.03 + aq, min(l1, l2));",
    "    float shine = exp(-pow((fract((q.x + q.y) * 0.08 - uTime * 0.25) - 0.5) * 9.0, 2.0));",
    "    c = mix(vec3(0.36, 0.4, 0.42) + 0.22 * shine, vec3(0.92), crack);",
    "  } else {", // a landing mark: brighter as the block comes down
    "    float ring = 1.0 - smoothstep(0.08, 0.1 + aq, min(e.x, e.z));",
    "    c = uColor * (0.12 + 0.3 * uGlow + ring * (0.35 + 0.65 * uGlow));",
    "  }",
    "  c = mix(c, uColor, 1.0 - smoothstep(0.05, 0.05 + aq, e.x));", // its edges
    "  outColor = vec4(c, 1.0);",
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
    ["uViewProjection", "uCentre", "uAxisX", "uAxisY", "uAxisZ", "uHalf", "uColor", "uGlow", "uEdge",
      "uStyle", "uTime", "uOrigin"].forEach(function (name) {
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
    gl.uniform1f(gfx.u.uTime, now() % 1000);
    run.parts.forEach(function (p) {
      if (p.hidden) return;
      if (p.pitch) {
        // Tilted about the sideways axis (a pendulum swinging along the slope).
        var pc = Math.cos(p.pitch), ps = Math.sin(p.pitch);
        gl.uniform3fv(gfx.u.uAxisX, SIDE);
        gl.uniform3f(gfx.u.uAxisY, NORMAL[0] * pc - DOWNHILL[0] * ps, NORMAL[1] * pc - DOWNHILL[1] * ps, NORMAL[2] * pc - DOWNHILL[2] * ps);
        gl.uniform3f(gfx.u.uAxisZ, DOWNHILL[0] * pc + NORMAL[0] * ps, DOWNHILL[1] * pc + NORMAL[1] * ps, DOWNHILL[2] * pc + NORMAL[2] * ps);
      } else if (p.roll) {
        // Tilted sideways, about the downhill axis (a pendulum's arm and weight).
        var rc = Math.cos(p.roll), rs = Math.sin(p.roll);
        gl.uniform3f(gfx.u.uAxisX, SIDE[0] * rc + NORMAL[0] * rs, SIDE[1] * rc + NORMAL[1] * rs, SIDE[2] * rc + NORMAL[2] * rs);
        gl.uniform3f(gfx.u.uAxisY, NORMAL[0] * rc - SIDE[0] * rs, NORMAL[1] * rc - SIDE[1] * rs, NORMAL[2] * rc - SIDE[2] * rs);
        gl.uniform3fv(gfx.u.uAxisZ, DOWNHILL);
      } else {
        var c = Math.cos(p.turn), sn = Math.sin(p.turn);
        gl.uniform3f(gfx.u.uAxisX, SIDE[0] * c + DOWNHILL[0] * sn, SIDE[1] * c + DOWNHILL[1] * sn, SIDE[2] * c + DOWNHILL[2] * sn);
        gl.uniform3fv(gfx.u.uAxisY, NORMAL);
        gl.uniform3f(gfx.u.uAxisZ, DOWNHILL[0] * c - SIDE[0] * sn, DOWNHILL[1] * c - SIDE[1] * sn, DOWNHILL[2] * c - SIDE[2] * sn);
      }
      gl.uniform3fv(gfx.u.uCentre, game.toWorld(p.s, p.base + p.lift + p.hh, p.x));
      gl.uniform3f(gfx.u.uHalf, p.hx, p.hh, p.hs);
      gl.uniform3fv(gfx.u.uColor, p.color);
      gl.uniform1f(gfx.u.uGlow, p.glow);
      gl.uniform1f(gfx.u.uEdge, p.dim ? 0.3 : 1);
      gl.uniform1f(gfx.u.uStyle, p.style || 0);
      gl.uniform2f(gfx.u.uOrigin, p.x, p.s);
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

    // The slope the ball is on, when it isn't the normal one (its look from modes.css).
    var zone = document.createElement("div");
    zone.className = "slope-effect slope-zone";
    zone.setAttribute("role", "status");
    zone.hidden = true;
    zone.innerHTML = '<p class="slope-effect-name"></p><p class="slope-effect-text"></p>' +
      '<div class="slope-effect-bar" aria-hidden="true"><span></span></div>';
    ui.root.appendChild(zone);

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
      zone: zone,
      zoneBar: zone.querySelector(".slope-effect-bar span"),
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
    var main = spec.fresh ? (SLOPES[spec.fresh] || KINDS[spec.fresh]).name
      : spec.slopes.length ? SLOPES[spec.slopes[0]].name : KINDS[spec.kinds[0]].name;
    var more = spec.fresh ? 0 : spec.slopes.length + spec.kinds.length - 1;
    var kind = main + (more ? " +" + more : "");
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
    var news = spec.fresh && (SLOPES[spec.fresh] || KINDS[spec.fresh]).text;
    els.intro.querySelector(".slope-level-intro-goal").textContent =
      news ? news + ". Reach the finish line" : "Avoid the red obstacles and reach the finish line";
    els.intro.hidden = false;
    clearTimeout(introTimer);
    introTimer = setTimeout(hideIntro, 3000);
  }

  function hideIntro() {
    clearTimeout(introTimer);
    if (els.intro) els.intro.hidden = true;
  }

  function showZone(zone) {
    if (!els.zone) return;
    var info = SLOPES[zone.type];
    els.zone.querySelector(".slope-effect-name").textContent = info.name;
    els.zone.querySelector(".slope-effect-text").textContent = info.text;
    // Under the level's progress panel while it shows.
    els.zone.style.top = els.hud && !els.hud.hidden ? Math.round(els.hud.getBoundingClientRect().bottom + 8) + "px" : "";
    els.zone.hidden = false;
  }

  function renderZone(left) {
    if (els.zoneBar) els.zoneBar.style.transform = "scaleX(" + Math.max(0, Math.min(1, left)).toFixed(3) + ")";
  }

  function hideZone() {
    if (els.zone) els.zone.hidden = true;
  }

  window.SlopeAdventure = {
    open: function (from) { openGrid(from); },
    start: start,
    level: levelSpec,
    isClear: function (s) {
      if (!run || run.startS === null || mode !== "playing") return true;
      for (var i = 0; i < run.plan.length; i++) {
        var item = run.plan[i];
        if (!item.panel && Math.abs(run.startS + item.at - s) < depthOf(item.kind) + 4.3) return false;
      }
      return Math.abs(run.goalS - s) > 3;
    },
    handlesRun: function () { return !!run && mode !== null && !run.endless; },
    // Advanced mode: normal runs get endless obstacles while this is on.
    setEndless: function (on) { endless = !!on; },
    // The slope the ball is on now ("normal" when none), and the stretches of the run.
    slope: function () { return zoneOn ? zoneOn.type : "normal"; },
    zones: function () {
      return run && run.startS !== null ? (run.plan.zones || []).map(function (z) {
        return { type: z.type, from: run.startS + z.from, to: run.startS + z.to };
      }) : [];
    },
    // Obstacles passed in this Advanced run (or the last one, after it ends).
    dodged: function () { return run && run.endless ? run.passed : endlessLast ? endlessLast.passed : 0; },
    // The open lanes of the obstacles placed lately (slope coordinates; for tools and tests).
    lanes: function () { return run && run.lanes ? run.lanes.slice() : []; },
    // The obstacles on the track now (slope coordinates; for tools and tests).
    obstacles: function () {
      return run ? run.parts.map(function (p) {
        return { kind: p.kind, s: p.s, x: p.x, h: p.base + p.lift + p.hh, hx: p.hx, hs: p.hs, hh: p.hh, base: p.base, turn: p.turn,
          solid: p.solid, hidden: !!p.hidden, hazard: !!p.hazard, style: p.style || 0 };
      }) : [];
    }
  };

  window.SlopeUI.ready(buildScreens);
})();
