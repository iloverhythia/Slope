/*
 * Platformer core: the courses and the physics of the platformer
 * (platformer.js draws them and runs the screens). Nothing here touches the
 * page, so tools and tests can run it on its own (node: require it).
 *
 * Coordinates: x sideways (right is +), y up, z forward. One unit is a metre;
 * the ball is 1 across.
 *
 * A course is a list of items (platforms, red hazards, lifts, pads...), gems
 * and a finish line. It winds: every so often it turns left or right on a
 * wide corner platform, so each stretch has its own heading and every item
 * its own frame (sideways axis u, forward axis v; boxes are boxes in that
 * frame). Adventure level n is always the same course; Endless builds its
 * course ahead of the ball as it goes, harder and faster the further it gets
 * (top speed up to 1.6 times at 1500 m).
 *
 * Every course is built within what the ball can do, with room to spare:
 * at full speed (7.5 m/s) a jump rises 2 m and carries 5.6 m on the flat, so
 * gaps are at most 3.6 m (2.6 m when the far side is higher), steps up at
 * most 1.1 m, red walls at most 0.9 m high and spikes at most 2.2 m deep.
 * Lifts, sweepers and lasers wait for nobody, but there is always a moment
 * when the way is clear, and room to stand and wait for it.
 *
 *   SlopePlatCore.level(n)        { n, kinds, fresh, title, length, d } for Adventure level n
 *   SlopePlatCore.buildLevel(n)   the course of Adventure level n
 *   SlopePlatCore.endless(seed)   an Endless course: course.extend(s) builds it up to s metres
 *   SlopePlatCore.newRun(course)  a run on the course, the ball at the start
 *   SlopePlatCore.step(run, input, dt)   input { x, z: -1..1 (a world direction), jump: pressed this step, hold: held }
 *   SlopePlatCore.speed(run)      the run's top speed now
 *   SlopePlatCore.heading(item)   the forward direction of an item's stretch of course [x, z]
 *   SlopePlatCore.at(item, t, run)   where a (moving or crumbling) item is at time t: [x, y, z]
 *   SlopePlatCore.copyRun(run)    a copy to try moves on (the course is shared, never changed)
 *   SlopePlatCore.KINDS / INTRO   obstacle kinds and the order levels bring them in
 */
(function (root) {
  "use strict";

  var R = 0.5;                  // ball radius
  var GRAVITY = 28;
  var JUMP = 10.5;              // take-off speed: rises 1.97 m, 0.75 s in the air
  var BOUNCE = 16;              // off a bounce pad: rises 4.6 m
  var SPEED = 7.5;              // top speed, any direction
  var ACCEL = 46, AIR_ACCEL = 22, BRAKE = 38;
  var COYOTE = 0.1;             // a jump still works this long after rolling off an edge
  var BUFFER = 0.14;            // a jump pressed this long before landing still happens
  var CUT = 0.55;               // letting go of jump early keeps this much of the rise
  var FALL = 14;                // this far below the last floor: fallen off
  var CRUMBLE = 0.45;           // seconds a crumbling tile holds after it is touched
  var REST = 4;                 // floor between obstacles
  var MAX_HEADING = 1.4;        // radians the course may turn away from its first direction

  var KINDS = {
    gap: { name: "Gaps", text: "Jump the gaps", hit: "" },
    hurdle: { name: "Hurdles", text: "Jump over the red walls", hit: "a red wall" },
    step: { name: "Steps", text: "Jump up the steps", hit: "" },
    spikes: { name: "Spikes", text: "Jump over the spikes", hit: "the spikes" },
    slider: { name: "Sliders", text: "Red blocks slide across: dodge or jump them", hit: "a slider" },
    narrow: { name: "Beams", text: "Keep to the narrow beams", hit: "" },
    lift: { name: "Lifts", text: "Ride the moving platforms across", hit: "" },
    sweeper: { name: "Sweepers", text: "Jump the spinning bars", hit: "a sweeper" },
    laser: { name: "Lasers", text: "Jump the beams or wait for them to switch off", hit: "a laser" },
    bounce: { name: "Bounce pads", text: "Roll over a pad to fly up the wall", hit: "" },
    crumble: { name: "Crumbling tiles", text: "They fall once touched: keep moving", hit: "" }
  };
  var INTRO = ["gap", "hurdle", "step", "spikes", "slider", "narrow", "lift", "sweeper", "laser", "bounce", "crumble"];

  // --- Random numbers --------------------------------------------------------------

  function seeded(seed) {
    var s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // --- Levels --------------------------------------------------------------------------

  // Levels 1 to 11 each bring in one new obstacle (mixed with one seen before
  // from level 3); after that every level mixes two or three.
  function level(n) {
    n = Math.max(1, Math.floor(n));
    var random = seeded(n * 7919 + 17);
    var d = clamp((n - 1) / 30, 0, 1);
    var kinds, fresh = null;
    if (n <= INTRO.length) {
      fresh = INTRO[n - 1];
      kinds = [fresh];
      if (n >= 3) kinds.push(INTRO[Math.floor(random() * (n - 1))]);
    } else {
      var pool = INTRO.slice(), count = n < 20 ? 2 : 3;
      kinds = [];
      while (kinds.length < count) kinds.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    }
    var title = fresh ? KINDS[fresh].name : kinds.map(function (k) { return KINDS[k].name; }).join(" + ");
    return { n: n, kinds: kinds, fresh: fresh, title: title, length: Math.min(480, 80 + 12 * n), d: d, seed: n * 104729 + 3 };
  }

  // --- Building courses ---------------------------------------------------------------

  // The builder keeps a cursor in the current stretch of course: the far end
  // of the last floor (z, forward), its top (y), its centre (x, sideways) and
  // width. A stretch starts at a point (ox, oz) with a heading; D is how far
  // along the whole course that point is.
  function Builder(seed) {
    this.random = seeded(seed);
    this.items = [];
    this.gems = [];
    this.path = [];          // the course's centre line: { x, y, z, s } (for tools and bots)
    this.nextItem = 0; this.nextGem = 0;
    this.z = 0; this.y = 0; this.x = 0; this.w = 5;
    this.lowest = 0;
    this.ox = 0; this.oz = 0; this.D = 0;
    this.heading = 0;
    this.face(0);
  }

  // Heading a (radians, 0 is +z): forward v = (sin a, cos a), sideways u = (cos a, -sin a).
  Builder.prototype.face = function (a) {
    this.heading = a;
    this.vx = Math.sin(a); this.vz = Math.cos(a);
    this.ux = Math.cos(a); this.uz = -Math.sin(a);
  };

  Builder.prototype.world = function (x, z) {
    return [this.ox + x * this.ux + z * this.vx, this.oz + x * this.uz + z * this.vz];
  };

  // Adds an item given in the stretch's frame (x sideways, z forward).
  Builder.prototype.add = function (item) {
    var w = this.world(item.x, item.z);
    item.s = this.D + item.z;
    item.x = w[0]; item.z = w[1];
    item.ux = this.ux; item.uz = this.uz; item.vx = this.vx; item.vz = this.vz;
    item.yaw = -this.heading;
    item.reach = Math.sqrt((item.hx || 0) * (item.hx || 0) + (item.hz || 0) * (item.hz || 0)) + (item.move && item.move.ax !== 1 ? item.move.amp : 0);
    item.id = this.nextItem++;
    this.items.push(item);
    return item;
  };

  Builder.prototype.point = function (x, z) {
    var w = this.world(x, z);
    this.path.push({ x: w[0], y: this.y, z: w[1], s: this.D + z });
  };

  // A floor from the cursor forward: top at y, centred on x. Returns its
  // place in the stretch's frame.
  Builder.prototype.floor = function (len, extra) {
    var thick = (extra && extra.thick) || 1.2;
    var local = { x: this.x, z: this.z + len / 2, hx: this.w / 2, hz: len / 2 };
    this.point(this.x, this.z);
    local.item = this.add(Object.assign({ kind: "floor", x: this.x, y: this.y - thick / 2, z: this.z + len / 2,
      hx: this.w / 2, hy: thick / 2, hz: len / 2, solid: true }, extra || {}));
    this.z += len;
    this.point(this.x, this.z);
    this.lowest = Math.min(this.lowest, this.y);
    return local;
  };

  Builder.prototype.gem = function (x, y, z) {
    var w = this.world(x, z);
    this.gems.push({ x: w[0], y: y, z: w[1], s: this.D + z, id: this.nextGem++ });
  };

  // A line of gems along the floor ahead (before building it).
  Builder.prototype.gemLine = function (from, count, gapZ) {
    for (var i = 0; i < count; i++) this.gem(this.x, this.y + 0.9, from + i * gapZ);
  };

  Builder.prototype.rest = function (len) {
    var start = this.z;
    this.floor(len || REST);
    if (this.random() < 0.35 && (len || REST) >= 4) this.gemLine(start + 1, 3, 1.2);
  };

  Builder.prototype.shift = function (amount) {
    this.x = clamp(this.x + (this.random() * 2 - 1) * amount, -4, 4);
  };

  // A corner: a wide square floor centred where the last floor ends, then a
  // new stretch from there, turned by delta. The course never heads more
  // than 80 degrees off its first direction, so it never comes back on itself.
  Builder.prototype.turn = function (delta) {
    if (Math.abs(this.heading + delta) > MAX_HEADING) delta = -delta;
    var joint = this.world(this.x, this.z);
    this.D += this.z;
    this.ox = joint[0]; this.oz = joint[1];
    this.face(this.heading + delta);
    this.x = 0; this.z = 0;
    var half = this.w / 2 + 0.6;
    this.add({ kind: "floor", corner: true, x: 0, y: this.y - 0.6, z: 0, hx: half, hy: 0.6, hz: half, solid: true });
    this.point(0, 0);
    this.z = half;
    this.floor(3.5);   // room to settle into the new direction
  };

  // Between obstacles: a rest, and now and then a corner.
  Builder.prototype.between = function (turnChance) {
    this.rest(REST + this.random() * 2);
    if (this.random() < turnChance) {
      var sign = this.random() < 0.5 ? -1 : 1;
      this.turn(sign * lerp(0.35, 1.0, this.random()));
    }
  };

  var FEATURES = {
    gap: function (b, d) {
      var up = b.random() < 0.3, dy = up ? lerp(0.3, 1.0, b.random()) : -lerp(0, 1.4, b.random());
      var g = lerp(1.6, up ? 2.6 : 3.6, Math.min(1, d * 1.3) * (0.4 + 0.6 * b.random()));
      var x0 = b.x, y0 = b.y, z0 = b.z;
      b.z += g; b.y += dy; b.shift(0.6 + 1.6 * d);
      // A gem over the middle of the gap, at the top of the jump.
      if (b.random() < 0.6) b.gem((x0 + b.x) / 2, Math.max(y0, b.y) + 1.7, z0 + g / 2);
      b.floor(lerp(9, 5, d) + b.random() * 2);
    },
    step: function (b, d) {
      var n = 2 + Math.floor(b.random() * (1 + 2 * d));
      for (var i = 0; i < n; i++) {
        if (b.random() < 0.4 * d) b.z += lerp(0.6, 1.4, b.random());
        b.y += lerp(0.6, 1.1, Math.min(1, d + 0.3) * b.random());
        b.floor(lerp(4.5, 3.2, d));
      }
      b.gem(b.x, b.y + 0.9, b.z - 1.5);
      b.floor(3);
    },
    hurdle: function (b, d) {
      var count = d > 0.5 && b.random() < 0.5 ? 2 : 1, z0 = b.z + 4;
      var f = b.floor(6 + count * 5);
      for (var i = 0; i < count; i++) {
        var h = lerp(0.5, 0.9, Math.min(1, d + b.random() * 0.4));
        b.add({ kind: "hurdle", x: f.x, y: b.y + h / 2, z: z0 + i * 5, hx: f.hx, hy: h / 2, hz: 0.25, deadly: true });
        b.gem(f.x, b.y + h + 1.1, z0 + i * 5);
      }
    },
    spikes: function (b, d) {
      var depth = lerp(1.2, 2.2, Math.min(1, d + 0.2 * b.random()));
      var z0 = b.z + 4;
      var f = b.floor(8 + depth + 1);
      // Early on the spikes leave a lane to go round them.
      var lane = d < 0.35 && b.random() < 0.6;
      var hx = lane ? f.hx - 1.1 : f.hx, x = lane ? f.x + (b.random() < 0.5 ? -1.1 : 1.1) : f.x;
      b.add({ kind: "spikes", x: x, y: b.y + 0.22, z: z0 + depth / 2, hx: hx, hy: 0.22, hz: depth / 2, deadly: true });
    },
    slider: function (b, d) {
      var count = d > 0.4 ? 2 : 1, z0 = b.z + 4;
      var f = b.floor(7 + count * 4.5);
      for (var i = 0; i < count; i++) {
        var period = lerp(3.4, 2.2, d);
        b.add({ kind: "slider", x: f.x, y: b.y + 0.5, z: z0 + i * 4.5, hx: 0.5, hy: 0.5, hz: 0.5, deadly: true,
          move: { ax: 0, amp: f.hx - 0.5, period: period, phase: b.random() * Math.PI * 2 } });
      }
      b.gemLine(z0 + 2, 1, 1);
    },
    narrow: function (b, d) {
      var w0 = b.w, segs = 2 + Math.floor(b.random() * 2);
      b.w = lerp(2.2, 1.5, d);
      for (var i = 0; i < segs; i++) {
        if (i) {
          b.x = clamp(b.x + (b.random() < 0.5 ? -1 : 1) * lerp(0.6, 1.1, b.random()), -4, 4);
          b.z += lerp(0.8, 1.8, b.random() * (0.5 + d));   // a short hop between beams
        }
        var start = b.z;
        b.floor(lerp(5, 7, b.random()));
        if (i === 1) b.gemLine(start + 1.5, 3, 1.3);
      }
      b.w = w0;
      b.floor(2);
    },
    lift: function (b, d) {
      var g = lerp(6, 9, Math.min(1, d + 0.3 * b.random())), period = lerp(4.6, 3.6, d);
      var z0 = b.z, ends = 1.5 + 0.3;
      // The lift's top is level with both floors; at either end it nearly touches them.
      var lo = z0 + ends, hi = z0 + g - ends;
      b.add({ kind: "lift", x: b.x, y: b.y - 0.25, z: (lo + hi) / 2, hx: 1.5, hy: 0.25, hz: 1.5, solid: true,
        move: { ax: 2, amp: (hi - lo) / 2, period: period, phase: -Math.PI / 2 } });
      b.gem(b.x, b.y + 0.9, z0 + g / 2);
      b.z += g;
      b.floor(6);
    },
    sweeper: function (b, d) {
      var w0 = b.w;
      b.w = 6;
      var f = b.floor(12);
      var pz = f.z, speed = lerp(1.5, 2.5, d) * (b.random() < 0.5 ? -1 : 1);
      b.add({ kind: "post", x: f.x, y: b.y + 1.0, z: pz, hx: 0.25, hy: 1.0, hz: 0.25, deadly: true });
      b.add({ kind: "sweeper", x: f.x, y: b.y + 0.35, z: pz, arm: 2.85, thick: 0.15, speed: speed, phase: b.random() * Math.PI,
        hx: 2.85, hy: 0.15, hz: 2.85, deadly: true });
      b.gem(f.x + 1.6, b.y + 0.9, pz - 2);
      b.w = w0;
    },
    laser: function (b, d) {
      var count = 1 + Math.floor(b.random() * (1 + 2 * d));
      var z0 = b.z + 4;
      var f = b.floor(5 + count * 3.5);
      var curtain = d > 0.45 && b.random() < 0.5;
      for (var i = 0; i < count; i++) {
        var h = curtain && i === 0 ? 1.6 : 0.08, y = curtain && i === 0 ? b.y + 1.6 : b.y + 0.45;
        b.add({ kind: "laser", x: f.x, y: y, z: z0 + i * 3.5, hx: f.hx, hy: h, hz: 0.08, deadly: true,
          blink: { on: lerp(1.2, 1.6, d), off: lerp(1.4, 1.1, d), phase: b.random() * 2 } });
      }
    },
    bounce: function (b, d) {
      var start = b.z;
      b.floor(8);
      b.add({ kind: "pad", x: b.x, y: b.y + 0.08, z: start + 4, hx: b.w / 2 - 0.4, hy: 0.08, hz: 1, solid: true, pad: true });
      var rise = lerp(2.4, 3.2, d), y0 = b.y;
      b.y += rise;
      b.floor(7, { thick: rise + 1.2 });
      b.gem(b.x, y0 + 3.4, start + 7);
    },
    crumble: function (b, d) {
      var n = 3 + Math.floor(b.random() * (1 + 2 * d)), w0 = b.w;
      b.w = 2.6;
      for (var i = 0; i < n; i++) {
        b.z += lerp(1.0, 1.8, Math.min(1, d + 0.3 * b.random()));
        b.shift(0.5);
        b.floor(2.6, { kind: "crumble", crumble: true, thick: 0.5 });
        if (i % 2) b.gem(b.x, b.y + 0.9, b.z - 1.3);
      }
      b.w = w0;
      b.z += 1.4;
      b.floor(5);
    }
  };

  function start(b) {
    b.floor(10);
    b.gemLine(5, 3, 1.2);
  }

  function finish(b) {
    b.rest(3);
    var f = b.floor(10);
    return b.add({ kind: "gate", x: f.x, y: b.y + 1.6, z: f.z - f.hz + 3, hx: f.hx, hy: 1.6, hz: 0.15, finish: true });
  }

  // The kinds a level uses, in turn, with the newest one most often.
  function buildLevel(n) {
    var spec = level(n);
    var b = new Builder(spec.seed);
    start(b);
    var i = 0;
    while (b.D + b.z < spec.length) {
      var kind = spec.fresh && i % 3 !== 2 ? spec.fresh : spec.kinds[Math.floor(b.random() * spec.kinds.length)];
      FEATURES[kind](b, spec.d);
      b.between(i ? 0.45 : 0.25);
      i++;
    }
    var gate = finish(b);
    return { items: b.items, gems: b.gems, path: b.path, gate: gate, length: gate.s, lowest: b.lowest, spec: spec, endless: false };
  }

  // Endless: obstacles come in one by one over the first 400 m, and the
  // course gets harder up to 1500 m, and faster: the top speed grows from
  // 7.5 to 12 m/s by then.
  function endless(seed) {
    var b = new Builder(seed || 1);
    start(b);
    var course = { items: b.items, gems: b.gems, path: b.path, gate: null, length: Infinity, endless: true, lowest: 0 };
    course.speed = function (s) { return SPEED * (1 + 0.6 * clamp(s / 1500, 0, 1)); };
    course.extend = function (s) {
      while (b.D + b.z < s) {
        var at = b.D + b.z;
        var open = INTRO.slice(0, Math.min(INTRO.length, 2 + Math.floor(at / 45)));
        var kind = open[Math.floor(b.random() * open.length)];
        FEATURES[kind](b, clamp(at / 1500, 0, 1));
        b.between(at < 30 ? 0.2 : 0.5);
      }
      course.lowest = b.lowest;
    };
    // Drop what is long behind the ball (Endless runs can be long).
    course.prune = function (s) {
      var keep = function (o) { return o.s + (o.hz || 0) + (o.reach || 0) > s; };
      var items = b.items.filter(keep), gems = b.gems.filter(keep), path = b.path.filter(function (p) { return p.s > s - 20; });
      if (items.length !== b.items.length) { b.items.length = 0; Array.prototype.push.apply(b.items, items); }
      if (gems.length !== b.gems.length) { b.gems.length = 0; Array.prototype.push.apply(b.gems, gems); }
      if (path.length !== b.path.length) { b.path.length = 0; Array.prototype.push.apply(b.path, path); }
    };
    course.extend(140);
    return course;
  }

  // --- Moving things -----------------------------------------------------------------------

  // An item's centre at time t (lifts and sliders move; crumbled tiles fall).
  function at(item, t, run) {
    var p = [item.x, item.y, item.z];
    if (item.move) {
      var off = item.move.amp * Math.sin((t / item.move.period) * Math.PI * 2 + item.move.phase), ax = item.move.ax;
      if (ax === 1) p[1] += off;
      else if (ax === 0) { p[0] += off * item.ux; p[2] += off * item.uz; }
      else { p[0] += off * item.vx; p[2] += off * item.vz; }
    }
    var touched = run && item.crumble ? run.touched[item.id] : undefined;
    if (touched !== undefined && t > touched + CRUMBLE) {
      var f = t - touched - CRUMBLE;
      p[1] -= 0.5 * 18 * f * f;
    }
    return p;
  }

  // A crumbling tile shakes a little once touched, before it falls.
  function shake(item, t, run) {
    var touched = run && item.crumble ? run.touched[item.id] : undefined;
    if (touched === undefined || t > touched + CRUMBLE) return 0;
    return Math.sin((t - touched) * 70) * 0.05 * ((t - touched) / CRUMBLE);
  }

  function laserOn(item, t) {
    var b = item.blink, cycle = b.on + b.off;
    return ((t + b.phase) % cycle + cycle) % cycle < b.on;
  }

  // The sweeper's bar: both arms, through the post, at angle a.
  function sweeperAngle(item, t) { return item.phase + item.speed * t; }

  // --- Runs ----------------------------------------------------------------------------------

  function newRun(course) {
    return {
      course: course,
      t: 0,
      ball: { x: 0, y: R + 0.001, z: 2, vx: 0, vy: 0, vz: 0, grounded: true, ground: null, coyote: 0, buffer: 0, rising: false, floorY: 0 },
      jumps: 0,
      bounces: 0,
      dead: null,         // what ended the run: "fell" or a kind of hazard
      won: false,
      taken: [],          // gems picked up this step (the page counts them)
      got: {},            // gem id -> true, picked up in this run
      touched: {},        // crumbling tile id -> when it was first touched
      s: 2,               // how far along the course the ball is (metres)
      furthest: 2
    };
  }

  function copyRun(run) {
    var c = Object.assign({}, run);
    c.ball = Object.assign({}, run.ball);
    c.got = Object.assign({}, run.got);
    c.touched = Object.assign({}, run.touched);
    c.taken = [];
    return c;
  }

  function approach(v, target, step) {
    return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
  }

  // The ball's centre in an item's frame (item centre c): [sideways, up, forward].
  function local(o, c, ball) {
    var dx = ball.x - c[0], dz = ball.z - c[2];
    return [dx * o.ux + dz * o.uz, ball.y - c[1], dx * o.vx + dz * o.vz];
  }

  // Pushes the ball out of a box; returns the push direction's height (1: standing on it), or null.
  function push(ball, c, o) {
    var l = local(o, c, ball);
    var px = clamp(l[0], -o.hx, o.hx), py = clamp(l[1], -o.hy, o.hy), pz = clamp(l[2], -o.hz, o.hz);
    var dx = l[0] - px, dy = l[1] - py, dz = l[2] - pz, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= R * R) return null;
    var nx, ny, nz, depth;
    if (d2 > 1e-10) {
      var d = Math.sqrt(d2);
      nx = dx / d; ny = dy / d; nz = dz / d; depth = R - d;
    } else {
      // The centre is inside: out through the nearest face.
      var faces = [[o.hy - l[1], 0, 1, 0], [l[1] + o.hy, 0, -1, 0], [o.hx - l[0], 1, 0, 0], [l[0] + o.hx, -1, 0, 0], [o.hz - l[2], 0, 0, 1], [l[2] + o.hz, 0, 0, -1]];
      faces.sort(function (a, b) { return a[0] - b[0]; });
      nx = faces[0][1]; ny = faces[0][2]; nz = faces[0][3]; depth = faces[0][0] + R;
    }
    var wx = nx * o.ux + nz * o.vx, wz = nx * o.uz + nz * o.vz;
    ball.x += wx * depth; ball.y += ny * depth; ball.z += wz * depth;
    var vn = ball.vx * wx + ball.vy * ny + ball.vz * wz;
    if (vn < 0) { ball.vx -= vn * wx; ball.vy -= vn * ny; ball.vz -= vn * wz; }
    return ny;
  }

  // How far the ball's centre is from a box (0 inside).
  function boxDistance(ball, c, o, shrink) {
    var l = local(o, c, ball);
    var dx = Math.max(0, Math.abs(l[0]) - o.hx * shrink), dy = Math.max(0, Math.abs(l[1]) - o.hy * shrink), dz = Math.max(0, Math.abs(l[2]) - o.hz * shrink);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function near(o, ball, extra) {
    var dx = o.x - ball.x, dz = o.z - ball.z, r = o.reach + extra;
    return dx * dx + dz * dz < r * r;
  }

  function hits(o, ball, t) {
    if (o.kind === "laser" && !laserOn(o, t)) return false;
    if (o.kind === "sweeper") {
      if (Math.abs(ball.y - o.y) > R + o.thick) return false;
      var a = sweeperAngle(o, t), ux = Math.cos(a), uz = Math.sin(a);
      var rx = ball.x - o.x, rz = ball.z - o.z;
      var along = clamp(rx * ux + rz * uz, -o.arm, o.arm);
      var ex = rx - along * ux, ez = rz - along * uz, ey = ball.y - o.y;
      return Math.sqrt(ex * ex + ez * ez + ey * ey) < R + o.thick - 0.04;
    }
    // A little forgiving: spikes are pointed, edges are thin.
    var shrink = o.kind === "spikes" ? 0.75 : 0.92;
    return boxDistance(ball, at(o, t), o, shrink) < R * 0.9;
  }

  // One step of the game (keep dt small: the page steps at 1/120 s).
  function step(run, input, dt) {
    var b = run.ball, course = run.course, t0 = run.t, t1 = run.t + dt;
    run.taken = [];
    if (run.dead || run.won) return run;
    run.t = t1;

    // Jump timing: pressed a moment early, or a moment after leaving the edge.
    b.buffer = input.jump ? BUFFER : Math.max(0, b.buffer - dt);
    b.coyote = b.grounded ? COYOTE : Math.max(0, b.coyote - dt);

    // Running: straight to the keys' direction, quick to turn.
    var ix = clamp(input.x || 0, -1, 1), iz = clamp(input.z || 0, -1, 1), len = Math.sqrt(ix * ix + iz * iz);
    if (len > 1) { ix /= len; iz /= len; }
    var top = speed(run), k = top / SPEED;
    var accel = (b.grounded ? (len > 0.05 ? ACCEL : BRAKE) : AIR_ACCEL) * k;
    b.vx = approach(b.vx, ix * top, accel * dt);
    b.vz = approach(b.vz, iz * top, accel * dt);

    if (b.buffer > 0 && (b.grounded || b.coyote > 0)) {
      b.vy = JUMP;
      b.grounded = false;
      b.coyote = 0;
      b.buffer = 0;
      b.rising = true;
      run.jumps += 1;
    }
    if (b.rising && !input.hold && b.vy > 0) { b.vy *= CUT; b.rising = false; }
    if (b.vy <= 0) b.rising = false;
    b.vy -= GRAVITY * dt;

    // Standing on something that moves: go with it.
    if (b.ground && (b.ground.move || b.ground.crumble)) {
      var p0 = at(b.ground, t0, run), p1 = at(b.ground, t1, run);
      b.x += p1[0] - p0[0]; b.z += p1[2] - p0[2];
      if (p1[1] > p0[1]) b.y += p1[1] - p0[1];
    }

    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;

    // Floors, lifts, pads: push the ball out; standing if pushed up.
    var ground = null, items = course.items;
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < items.length; i++) {
        var o = items[i];
        if (!o.solid || !near(o, b, R + 0.6)) continue;
        if (o.crumble && run.touched[o.id] !== undefined && t1 > run.touched[o.id] + CRUMBLE + 0.6) continue;   // gone
        var ny = push(b, at(o, t1, run), o);
        if (ny !== null && ny > 0.7) ground = o;
      }
    }
    b.grounded = !!ground;
    b.ground = ground;
    if (ground) {
      b.floorY = at(ground, t1, run)[1] + ground.hy;
      if (ground.crumble && run.touched[ground.id] === undefined) run.touched[ground.id] = t1;
      if (ground.pad) {
        b.vy = BOUNCE;
        b.grounded = false;
        b.ground = null;
        b.rising = false;
        run.bounces += 1;
      }
    }

    // Red things.
    for (var j = 0; j < items.length; j++) {
      var h = items[j];
      if (!h.deadly || !near(h, b, R + 1)) continue;
      if (hits(h, b, t1)) {
        run.dead = h.kind;
        return run;
      }
    }

    // Gems.
    var gems = course.gems;
    for (var g = 0; g < gems.length; g++) {
      var gem = gems[g];
      if (run.got[gem.id] || Math.abs(gem.z - b.z) > 1.2 || Math.abs(gem.x - b.x) > 1.2) continue;
      var dx = gem.x - b.x, dy = gem.y - b.y, dz = gem.z - b.z;
      if (dx * dx + dy * dy + dz * dz < 0.95 * 0.95) { run.got[gem.id] = true; run.taken.push(gem); }
    }

    // How far along the course: from the floor under the ball.
    if (ground) {
      var gl = local(ground, at(ground, t1, run), b);
      run.s = ground.s + clamp(gl[2], -ground.hz, ground.hz);
      run.furthest = Math.max(run.furthest, run.s);
    }
    if (b.y < Math.min(b.floorY, course.lowest) - FALL) run.dead = "fell";
    else if (course.gate && crossed(course.gate, b)) run.won = true;
    return run;
  }

  // Through the finish gate: past its line, between its posts.
  function crossed(gate, b) {
    var l = local(gate, [gate.x, gate.y, gate.z], b);
    return l[2] >= 0 && l[2] < 3 && Math.abs(l[0]) <= gate.hx + 0.3 && Math.abs(l[1]) < gate.hy + 1.5;
  }

  function speed(run) { return run.course.speed ? run.course.speed(run.furthest) : SPEED; }
  function heading(o) { return [o.vx, o.vz]; }

  var core = {
    R: R, GRAVITY: GRAVITY, JUMP: JUMP, BOUNCE: BOUNCE, SPEED: SPEED, CRUMBLE: CRUMBLE,
    KINDS: KINDS,
    INTRO: INTRO,
    level: level,
    buildLevel: buildLevel,
    endless: endless,
    newRun: newRun,
    copyRun: copyRun,
    step: step,
    speed: speed,
    heading: heading,
    local: local,
    at: at,
    shake: shake,
    laserOn: laserOn,
    sweeperAngle: sweeperAngle,
    seeded: seeded
  };
  if (typeof module === "object" && module.exports) module.exports = core;
  else root.SlopePlatCore = core;
})(typeof window !== "undefined" ? window : this);
