/*
 * Neon Pinball: a pinball table (the HUD button with the ball and flippers),
 * in the game's look, played with the ball skin you wear.
 *
 *   Flippers     Left: Left arrow, Z, A or left Shift. Right: Right arrow, M,
 *                D or right Shift. On a touch screen (or with the mouse), hold
 *                the left or right half of the table.
 *   Plunger      hold Space (or Down) to pull it back, let go to launch; on a
 *                touch screen hold the table while the ball waits in the lane.
 *
 * The table: three pop bumpers, two slingshots, three top lanes (finish them
 * all to raise the playfield multiplier; the flippers move the lit lanes), a
 * bank of three drop targets, a spinner in the left orbit and a saucer that
 * holds the ball for a jackpot. Quick hits build a combo.
 *
 * A game is 3 balls. Its score becomes tickets (one for every 500 points),
 * which buy upgrades:
 *
 *   Table      Extra ball, Ball saver, Drain magnet, Multiball (from the
 *              saucer), Power flippers, Saucer pull
 *   Scoring    Pop bumpers, Spinner gears, Drop targets, Jackpot, Lane lights
 *              (a higher playfield multiplier), Combo lights, Neon multiplier
 *   Rewards    Ticket printer, Gem bumpers (bumpers can drop gems into the
 *              main game)
 *   Main game  Gem lights, XP lights, Golden flippers: more gems, XP and ball
 *              XP everywhere in the game
 *
 * Your best score is worth more gems in the main game too (+10% for every
 * tenfold over 1K), and a game gives the ball you wear some XP.
 *
 *   SlopePinball.open(from)
 *   SlopePinball.boosts()     { gems, xp, ballXp } for the main game
 *   SlopePinball.state()      the table's and the game's state (for tools and tests)
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  // --- Upgrades ----------------------------------------------------------------

  var GROUPS = [["table", "Table"], ["score", "Scoring"], ["reward", "Rewards"], ["main", "Main game"]];
  var UPS = [
    { key: "balls", group: "table", name: "Extra ball", base: 120, growth: 4, max: 4, text: function (l) { return (3 + l) + " balls a game"; } },
    { key: "save", group: "table", name: "Ball saver", base: 30, growth: 2.4, max: 8, text: function (l) { return l ? "A ball lost in the first " + saveSeconds(l) + " s after a launch comes back" : "Off"; } },
    { key: "magnet", group: "table", name: "Drain magnet", base: 60, growth: 2.3, max: 10, text: function (l) { return l ? (l * 6) + "% of draining balls are pulled back up" : "Off"; } },
    { key: "multi", group: "table", name: "Multiball", base: 250, growth: 5, max: 3, text: function (l) { return l ? "The saucer sends out " + l + (l === 1 ? " more ball" : " more balls") : "Off"; } },
    { key: "power", group: "table", name: "Power flippers", base: 25, growth: 2, max: 10, text: function (l) { return l ? "Flippers +" + (l * 5) + "% faster" : "Standard flippers"; } },
    { key: "pull", group: "table", name: "Saucer pull", base: 40, growth: 2.2, max: 10, text: function (l) { return l ? "The saucer pulls in balls from " + pullRadius(l) + " px" : "Off"; } },
    { key: "bumper", group: "score", name: "Pop bumpers", base: 15, growth: 1.6, max: 40, text: function (l) { return abbr(bumperPoints(l)) + " points a hit"; } },
    { key: "spinner", group: "score", name: "Spinner gears", base: 20, growth: 1.6, max: 30, text: function (l) { return abbr(spinPoints(l)) + " points a spin"; } },
    { key: "targets", group: "score", name: "Drop targets", base: 25, growth: 1.65, max: 30, text: function (l) { return abbr(targetPoints(l)) + " a target, " + abbr(targetPoints(l) * 10) + " for the bank"; } },
    { key: "saucer", group: "score", name: "Jackpot", base: 50, growth: 1.75, max: 30, text: function (l) { return abbr(jackpotPoints(l)) + " points from the saucer"; } },
    { key: "lanes", group: "score", name: "Lane lights", base: 100, growth: 3, max: 8, text: function (l) { return "Top lanes raise the playfield multiplier up to x" + (2 + l); } },
    { key: "combo", group: "score", name: "Combo lights", base: 80, growth: 2.5, max: 10, text: function (l) { return l ? "Quick hits build up to +" + (l * 10) + "%" : "Off"; } },
    { key: "mult", group: "score", name: "Neon multiplier", base: 200, growth: 2.2, max: 20, text: function (l) { return "All points x" + fmtNum(1 + 0.25 * l); } },
    { key: "printer", group: "reward", name: "Ticket printer", base: 150, growth: 2.3, max: 20, text: function (l) { return l ? "+" + (l * 10) + "% tickets" : "A ticket for every " + TICKET_POINTS + " points"; } },
    { key: "gemdrop", group: "reward", name: "Gem bumpers", base: 100, growth: 2.5, max: 10, text: function (l) { return l ? l + "% of bumper hits drop gems into the game" : "Off"; } },
    { key: "ampgems", group: "main", name: "Gem lights", base: 60, growth: 1.7, max: 40, text: function (l) { return "+" + (l * 5) + "% gems in the game"; } },
    { key: "ampxp", group: "main", name: "XP lights", base: 60, growth: 1.7, max: 40, text: function (l) { return "+" + (l * 5) + "% XP in the game"; } },
    { key: "ampball", group: "main", name: "Golden flippers", base: 150, growth: 2.1, max: 30, text: function (l) { return "+" + (l * 10) + "% ball XP"; } }
  ];
  var TICKET_POINTS = 500;   // points for a ticket

  function fmtNum(n) { return Math.round(n * 100) / 100 + ""; }
  function abbr(n) { return n < 1000 ? String(Math.floor(n)) : profile.short(n); }
  function full(n) { return Math.floor(n).toLocaleString("en-US"); }

  var pb = profile.get().pinball;
  function up(k) { return pb.up[k] || 0; }
  function upPrice(u, l) { return Math.round(u.base * Math.pow(u.growth, l)); }

  function saveSeconds(l) { return l ? 3 + 3 * l : 0; }
  function pullRadius(l) { return l ? 18 + 3 * l : 0; }   // at most 48: never as far as the left bumper
  function bumperPoints(l) { return 100 * (1 + 0.5 * l); }
  function spinPoints(l) { return 30 * (1 + 0.5 * l); }
  function targetPoints(l) { return 500 * (1 + 0.5 * l); }
  function jackpotPoints(l) { return 2500 * (1 + l); }
  function ballsAGame() { return 3 + up("balls"); }
  function pfMax() { return 2 + up("lanes"); }
  function flipSpeed() { return 22 * (1 + 0.05 * up("power")); }
  function recordBoost() { return 1 + 0.1 * Math.max(0, Math.log10(Math.max(1, pb.best) / 1000)); }
  function ticketsFor(score) { return Math.floor(score / TICKET_POINTS * (1 + 0.1 * up("printer"))); }

  function boosts() {
    return {
      gems: (1 + 0.05 * up("ampgems")) * recordBoost(),
      xp: 1 + 0.05 * up("ampxp"),
      ballXp: 1 + 0.1 * up("ampball")
    };
  }

  function save(notify) {
    profile.savePinball(pb, notify);
    pb = profile.get().pinball;
  }
  // Another tab or an account sign-in can bring another state.
  profile.onChange(function (p) {
    if (JSON.stringify(p.pinball) !== JSON.stringify(pb)) pb = p.pinball;
    ballKey = "";   // the skin or its level may have changed
    if (shown()) render();
  });

  // --- The table (400 x 720, y down) -------------------------------------------------

  var W = 400, H = 720, R = 10;
  var STEP = 1 / 240, GRAVITY = 900, MAX_SPEED = 1800;
  var MID = 188;                          // the playfield's middle (the plunger lane is on the right)
  var LANE_X = 381, LANE_WALL = 366, PLUNGER_Y = 700, PULL = 28;
  var FLIP_LEN = 60, FLIP_R = 7, FLIP_REST = 0.52, FLIP_UP = -0.45, FLIP_DOWN_SPEED = 12;
  var GOLD = "#ffd43b";

  var walls = [];
  function wall(ax, ay, bx, by, r, extra) {
    var w = { ax: ax, ay: ay, bx: bx, by: by, r: r || 3 };
    if (extra) Object.keys(extra).forEach(function (k) { w[k] = extra[k]; });
    walls.push(w);
    return w;
  }
  function chain(points, r) { for (var i = 1; i < points.length; i++) wall(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], r); }
  function mirror(p) { return [2 * MID - p[0], p[1]]; }

  // The arch over the playfield and the plunger lane.
  var ARCH = [];
  for (var i = 0; i <= 36; i++) { var a = Math.PI + Math.PI * i / 36; ARCH.push([203 + 193 * Math.cos(a), 203 + 193 * Math.sin(a)]); }
  chain(ARCH);
  var LEFT_SIDE = [[10, 203], [10, 548], [104, 618]];      // the left wall and its guide to the flipper
  var RIGHT_SIDE = [[366, 240], [366, 548], [272, 618]];   // the lane wall and its guide to the right flipper
  chain(LEFT_SIDE);
  chain(RIGHT_SIDE);
  wall(366, 548, 366, 720);   // the lane wall below that
  wall(104, 618, 104, 760);   // the apron: a lost ball falls straight down the drain
  wall(272, 618, 272, 760);
  wall(396, 203, 396, 720);   // the lane's outer wall
  wall(366, 240, 396, 205, 3, { gate: true });   // one way: out of the lane only
  wall(66, 250, 66, 380);     // the left orbit
  var POSTS = [128, 172, 216, 260];
  POSTS.forEach(function (x) { wall(x, 72, x, 104, 4); });

  // Slingshots: the face toward the playfield kicks.
  var slings = [];
  function sling(A, B, C) {
    wall(A[0], A[1], B[0], B[1]);
    wall(B[0], B[1], C[0], C[1]);
    var face = wall(C[0], C[1], A[0], A[1], 3, { sling: slings.length });
    var nx = -(A[1] - C[1]), ny = A[0] - C[0], n = Math.hypot(nx, ny);
    nx /= n; ny /= n;
    if ((B[0] - C[0]) * nx + (B[1] - C[1]) * ny > 0) { nx = -nx; ny = -ny; }
    face.kx = nx; face.ky = ny;
    slings.push({ pts: [A, B, C], flash: 0 });
  }
  sling([50, 440], [50, 512], [96, 548]);
  sling(mirror([50, 440]), mirror([50, 512]), mirror([96, 548]));

  var targets = [330, 365, 400].map(function (y) { return wall(356, y - 13, 356, y + 13, 4, { target: true, up: true }); });
  var bumpers = [[140, 200], [236, 200], [188, 268]].map(function (p) { return { x: p[0], y: p[1], r: 22, flash: 0, fired: -1 }; });
  var LANES = [150, 194, 238], LANE_Y = 88;
  var SPINNER = { x1: 10, x2: 66, y: 300 };
  var SAUCER = { x: 88, y: 140 };

  var flippers = [
    { x: 114, y: 630, rest: FLIP_REST, up: FLIP_UP, a: FLIP_REST, w: 0, held: false },
    { x: 262, y: 630, rest: Math.PI - FLIP_REST, up: Math.PI - FLIP_UP, a: Math.PI - FLIP_REST, w: 0, held: false }
  ];

  // --- Physics --------------------------------------------------------------------------

  var nx = 0, ny = 0;   // the normal of the last touch
  // Pushes ball b out of a circle of radius r at (px, py) whose surface moves
  // at (sx, sy); returns how hard it hit (0: a touch, -1: no touch).
  function push(b, px, py, r, e, sx, sy) {
    var dx = b.x - px, dy = b.y - py, d2 = dx * dx + dy * dy, min = R + r;
    if (d2 >= min * min) return -1;
    var d = Math.sqrt(d2);
    if (d < 1e-6) { dx = 0; dy = -1; d = 1; }
    nx = dx / d; ny = dy / d;
    b.x = px + nx * min; b.y = py + ny * min;
    var rvx = b.vx - sx, rvy = b.vy - sy, vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
    return -vn;
  }
  // The same for a capsule (segment a-b of radius r); a flipper turns about
  // its pivot at w radians a second.
  function capsule(b, ax, ay, bx, by, r, e, pivot, w) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 ? ((b.x - ax) * dx + (b.y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var px = ax + t * dx, py = ay + t * dy;
    return push(b, px, py, r, e, pivot ? -w * (py - pivot.y) : 0, pivot ? w * (px - pivot.x) : 0);
  }
  function tipOf(f) { return [f.x + FLIP_LEN * Math.cos(f.a), f.y + FLIP_LEN * Math.sin(f.a)]; }
  function plungerTop() { return PLUNGER_Y + PULL * pull; }

  // --- A game -------------------------------------------------------------------------------

  var g = null;            // the game being played
  var pull = 0, pulling = false;
  var spin = { angle: 0, speed: 0 };

  function newBall(auto) {
    return { x: LANE_X, y: PLUNGER_Y - R, vx: 0, vy: 0, rot: 0, ready: true, inLane: true, hold: 0, cool: 0, still: 0, auto: auto ? 0.7 : 0, roll: [false, false, false], extra: !!auto };
  }

  function start() {
    g = { score: 0, ball: 1, pf: 1, lanes: [false, false, false], laneFlash: 0, balls: [newBall(false)], queue: 0, time: 0, saveUntil: 0,
      chain: 0, lastHit: -9, over: false, paused: false, gems: 0, texts: [], jackpots: 0, msg: "", msgT: 0, bankDown: 0, magnetT: 0, nudges: 0, escapes: 0, hits: {} };
    targets.forEach(function (t) { t.up = true; });
    bumpers.forEach(function (b) { b.fired = -1; b.flash = 0; });
    releaseAll();
    say("");
    render();
  }

  function flash(text, t) { g.msg = text; g.msgT = t || 1.6; }
  function floatText(text, x, y, gold) { g.texts.push({ text: text, x: x, y: y, t: 0, gold: !!gold }); if (g.texts.length > 30) g.texts.shift(); }

  // Points, with every multiplier: the playfield, Neon multiplier and the combo.
  function points(base, x, y, gold, what) {
    if (what) g.hits[what] = (g.hits[what] || 0) + 1;
    if (g.time - g.lastHit < 1.2) g.chain = Math.min(20, g.chain + 1); else g.chain = 0;
    g.lastHit = g.time;
    var n = Math.round(base * g.pf * (1 + 0.25 * up("mult")) * (1 + 0.005 * up("combo") * g.chain));
    g.score += n;
    if (x !== undefined) floatText(abbr(n), x, y, gold);
    return n;
  }

  function launch(b, power) {
    b.ready = false;
    b.vy = -(600 + 1100 * Math.max(0.15, Math.min(1, power)));
    b.vx = 0;
    if (!b.extra) g.saveUntil = g.time + saveSeconds(up("save"));
  }

  function hitBumper(bm) {
    bm.flash = 1;
    points(bumperPoints(up("bumper")), bm.x, bm.y - 30, false, "bumper");
    if (up("gemdrop") && Math.random() < 0.01 * up("gemdrop")) {
      var worth = window.SlopeGems ? window.SlopeGems.worth(0) : 1;
      var got = profile.addGems(worth * 3);
      if (got) { g.gems += got; floatText("+" + abbr(got) + " gems", bm.x, bm.y + 30, true); }
    }
  }

  function dropTarget(t) {
    t.up = false;
    points(targetPoints(up("targets")), t.ax - 20, (t.ay + t.by) / 2, false, "target");
    if (targets.every(function (x) { return !x.up; })) {
      points(targetPoints(up("targets")) * 10, 300, 370, true);
      flash("Target bank!");
      g.bankDown = 1.5;
    }
  }

  function rollLane(i) {
    if (g.laneFlash > 0) return;
    points(500, LANES[i], LANE_Y + 26, false, "lane");
    g.lanes[i] = true;
    if (g.lanes.every(Boolean)) {
      points(5000, MID, 140, true);
      if (g.pf < pfMax()) { g.pf++; flash("Playfield x" + g.pf + "!"); } else flash("Lanes complete!");
      g.laneFlash = 1.2;
    }
  }

  function catchSaucer(b) {
    b.hold = 1.1;
    b.vx = b.vy = 0;
    g.jackpots++;
    points(jackpotPoints(up("saucer")), SAUCER.x + 40, SAUCER.y - 10, true, "saucer");
    flash("Jackpot!");
    var more = up("multi"), live = g.balls.length + g.queue;
    if (more && live < 1 + more) { g.queue += 1 + more - live; flash("Multiball!", 2); }
  }

  function stepBall(b, dt) {
    if (b.cool > 0) b.cool -= dt;
    if (b.hold > 0) {
      b.hold -= dt;
      b.x = SAUCER.x; b.y = SAUCER.y;
      if (b.hold <= 0) { b.vx = 40 + Math.random() * 60; b.vy = 380 + Math.random() * 80; b.cool = 1.5; }   // down past the left bumper, to the flippers
      return;
    }
    if (b.ready) {
      b.x = LANE_X; b.y = plungerTop() - R; b.vx = b.vy = 0;
      if (b.auto > 0 && (b.auto -= dt) <= 0) launch(b, 0.85 + Math.random() * 0.15);
      return;
    }
    b.vy += GRAVITY * dt;
    var pl = pullRadius(up("pull"));
    if (pl && b.cool <= 0) {
      var sx = SAUCER.x - b.x, sy = SAUCER.y - b.y, sd = Math.hypot(sx, sy);
      if (sd < pl && sd > 1) { var pa = 2600 * (1 - sd / pl) * dt / sd; b.vx += sx * pa; b.vy += sy * pa; }
    }
    var sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
    var py = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.rot += b.vx * dt / R;
    if (b.inLane && b.x < 355) b.inLane = false;

    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      if ((w.gate && b.inLane) || (w.target && !w.up)) continue;
      var hit = capsule(b, w.ax, w.ay, w.bx, w.by, w.r, w.sling !== undefined ? 0.5 : 0.4);
      if (hit < 0) continue;
      if (w.sling !== undefined && hit > 60 && nx * w.kx + ny * w.ky > 0.5) {
        b.vx += w.kx * 420; b.vy += w.ky * 420;
        slings[w.sling].flash = 1;
        points(10, undefined, undefined, false, "sling");
      } else if (w.target && hit > 40) dropTarget(w);
    }
    for (i = 0; i < bumpers.length; i++) {
      var bm = bumpers[i];
      var bh = push(b, bm.x, bm.y, bm.r, 0.6, 0, 0);
      if (bh >= 0 && g.time - bm.fired > 0.06) {   // a pop bumper fires at any touch: nothing rests on it
        bm.fired = g.time;
        b.vx += nx * 320; b.vy += ny * 320;
        hitBumper(bm);
      }
    }
    for (i = 0; i < flippers.length; i++) {
      var f = flippers[i], tp = tipOf(f);
      capsule(b, f.x, f.y, tp[0], tp[1], FLIP_R, 0.25, f, f.w);
    }

    // Sensors: the top lanes, the spinner and the saucer.
    for (i = 0; i < LANES.length; i++) {
      var inside = Math.abs(b.x - LANES[i]) < 14 && Math.abs(b.y - LANE_Y) < 14;
      if (inside && !b.roll[i]) rollLane(i);
      b.roll[i] = inside;
    }
    if ((py < SPINNER.y) !== (b.y < SPINNER.y) && b.x > SPINNER.x1 && b.x < SPINNER.x2) {
      var spins = 1 + Math.round(Math.abs(b.vy) / 60);
      spin.speed = (b.vy < 0 ? -1 : 1) * Math.min(60, Math.abs(b.vy) / 12);
      points(spinPoints(up("spinner")) * spins, SPINNER.x2 + 24, SPINNER.y, false, "spinner");
    }
    if (b.cool <= 0 && Math.hypot(b.x - SAUCER.x, b.y - SAUCER.y) < 12 && Math.hypot(b.vx, b.vy) < 1100) catchSaucer(b);

    // Back on the plunger (a launch too weak to leave the lane).
    if (b.inLane && b.vy >= 0 && b.y >= plungerTop() - R) { b.ready = true; b.auto = b.extra ? 0.5 : 0; }

    // Drain magnet: a ball falling between the flippers can be pulled back up.
    if (up("magnet") && py < 680 && b.y >= 680 && b.x > 120 && b.x < 256 && g.time > g.magnetT) {
      g.magnetT = g.time + 2;
      if (Math.random() < 0.06 * up("magnet")) {
        b.x = MID; b.y = 668; b.vx = (Math.random() - 0.5) * 120; b.vy = -1050;
        flash("Magnet save!");
      }
    }

    // A ball that sits still (balanced on something) gets a nudge.
    if (Math.hypot(b.vx, b.vy) < 8 && !flippers[0].held && !flippers[1].held) {
      if ((b.still += dt) > 2.5) { b.vx = (Math.random() - 0.5) * 300; b.vy = -260; b.still = 0; g.nudges++; }
    } else b.still = 0;
    if (b.y > H + 30) b.gone = true;
    else if (b.x < 0 || b.x > W || b.y < 0) { b.ready = true; b.inLane = true; b.x = LANE_X; g.escapes++; }   // never happens, but never stuck
  }

  function collideBalls() {
    var list = g.balls;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.ready || a.hold > 0) continue;
      for (var j = i + 1; j < list.length; j++) {
        var b = list[j];
        if (b.ready || b.hold > 0) continue;
        var dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R || d2 < 1e-9) continue;
        var d = Math.sqrt(d2), ux = dx / d, uy = dy / d, over = (2 * R - d) / 2;
        a.x -= ux * over; a.y -= uy * over; b.x += ux * over; b.y += uy * over;
        var vn = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
        if (vn < 0) { var k = vn * 0.95; a.vx += k * ux; a.vy += k * uy; b.vx -= k * ux; b.vy -= k * uy; }
      }
    }
  }

  function step(dt) {
    g.time += dt;
    flippers.forEach(function (f) {
      var t = f.held ? f.up : f.rest, d = t - f.a, s = (f.held ? flipSpeed() : FLIP_DOWN_SPEED) * dt, before = f.a;
      f.a = Math.abs(d) <= s ? t : f.a + (d > 0 ? s : -s);
      f.w = (f.a - before) / dt;
    });
    var waiting = null;
    g.balls.forEach(function (b) { if (b.ready) waiting = b; });
    if (pulling && waiting && !waiting.extra) pull = Math.min(1, pull + dt / 0.9);
    else if (!pulling) pull = 0;
    if (g.queue && !g.balls.some(function (b) { return b.inLane; })) { g.queue--; g.balls.push(newBall(true)); }

    g.balls.forEach(function (b) { stepBall(b, dt); });
    collideBalls();
    var before = g.balls.length;
    g.balls = g.balls.filter(function (b) { return !b.gone; });
    if (before && !g.balls.length && !g.queue) drained();

    bumpers.forEach(function (b) { b.flash = Math.max(0, b.flash - dt * 4); });
    slings.forEach(function (s) { s.flash = Math.max(0, s.flash - dt * 5); });
    if (g.laneFlash > 0 && (g.laneFlash -= dt) <= 0) g.lanes = [false, false, false];
    if (g.bankDown > 0 && (g.bankDown -= dt) <= 0) targets.forEach(function (t) { t.up = true; });
    if (g.msgT > 0) g.msgT -= dt;
    spin.angle += spin.speed * dt;
    spin.speed *= Math.pow(0.35, dt);
    if (Math.abs(spin.speed) < 0.3) spin.speed = 0;
  }

  function drained() {
    if (g.time < g.saveUntil) {
      g.balls.push(newBall(false));
      flash("Ball saved!");
      return;
    }
    g.ball++;
    g.pf = 1;
    g.lanes = [false, false, false];
    g.chain = 0;
    if (g.ball > ballsAGame()) { end(); return; }
    g.balls.push(newBall(false));
    flash("Ball " + g.ball);
    say("Ball " + g.ball + " of " + ballsAGame() + ".");
  }

  // The game is over (or ended early): its score turns into tickets.
  function end() {
    if (!g || g.over) return;
    g.over = true;
    g.balls = [];
    g.queue = 0;
    releaseAll();
    var tickets = ticketsFor(g.score), record = g.score > pb.best;
    pb.tickets += tickets;
    pb.games++;
    pb.total += g.score;
    if (record) pb.best = g.score;
    save(true);
    var levels = g.score ? profile.addBallXp(Math.floor(Math.sqrt(g.score) / 4)) : 0;
    flash(record ? "New record!" : "Game over", 99);
    g.result = { score: g.score, tickets: tickets, record: record };
    say((record ? "New record: " : "Game over: ") + full(g.score) + " points, +" + full(tickets) + (tickets === 1 ? " ticket" : " tickets") +
      (g.gems ? ", +" + full(g.gems) + " gems" : "") + (levels ? ". Ball level up!" : "."));
    render();
  }

  // --- Controls -------------------------------------------------------------------------

  var KEYS = {
    ArrowLeft: "left", KeyZ: "left", KeyA: "left", ShiftLeft: "left",
    ArrowRight: "right", KeyM: "right", KeyD: "right", ShiftRight: "right", Slash: "right",
    Space: "launch", ArrowDown: "launch", KeyS: "launch"
  };
  // What holds each control down (key codes, pointers): a control is on
  // while anything holds it. Letting go always counts, even between games,
  // so nothing stays held into the next game.
  var holders = { left: {}, right: {}, launch: {} };
  function hold(ctl, who, down) {
    if (down) holders[ctl][who] = true; else delete holders[ctl][who];
    apply(ctl, Object.keys(holders[ctl]).length > 0);
  }
  function press(ctl, down) { hold(ctl, "api", down); }

  function apply(ctl, on) {
    if (!g || g.over) return;
    if (on && g.paused) { g.paused = false; last = 0; }
    if (ctl === "launch") {
      if (on) pulling = true;
      else if (pulling) {
        pulling = false;
        var b = g.balls.filter(function (x) { return x.ready && !x.extra; })[0];
        if (b) launch(b, pull);
        pull = 0;
      }
      return;
    }
    var f = flippers[ctl === "left" ? 0 : 1];
    if (on && !f.held && g.laneFlash <= 0) {   // lane change: the lit lanes move with the flipper
      g.lanes = ctl === "left" ? g.lanes.slice(1).concat(g.lanes[0]) : [g.lanes[2]].concat(g.lanes.slice(0, 2));
    }
    f.held = on;
  }
  function releaseAll() {
    holders = { left: {}, right: {}, launch: {} };
    flippers.forEach(function (f) { f.held = false; });
    pulling = false;
    pull = 0;
    pointers = {};
  }
  function pause() {
    if (g && !g.over && !g.paused) { g.paused = true; releaseAll(); }
  }

  // --- Drawing ----------------------------------------------------------------------------

  var els = null, openedFrom = null, loop = 0, last = 0, acc = 0, frameDt = 0, scale = 1, fontFamily = "monospace";
  var staticLayer = null, staticKey = "";
  var ballImg = null, ballKey = "";

  function colour() { return window.SlopeUI.themeColor || "#00ff00"; }

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

  function fit() {
    var rect = els.canvas.getBoundingClientRect();
    var k = Math.max(1, Math.min(3, (rect.width || 360) / W * Math.min(2, window.devicePixelRatio || 1)));
    var w = Math.round(W * k), h = Math.round(H * k);
    if (els.canvas.width !== w || els.canvas.height !== h) { els.canvas.width = w; els.canvas.height = h; staticKey = ""; }
    scale = w / W;
  }

  function line(x, ax, ay, bx, by) { x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke(); }
  function poly(x, pts, close) {
    x.beginPath();
    pts.forEach(function (p, i) { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); });
    if (close) x.closePath();
  }

  // The parts that never move, drawn once (again when the colour or size changes).
  function drawStatic() {
    var key = colour() + "/" + els.canvas.width;
    if (key === staticKey) return;
    staticKey = key;
    staticLayer = staticLayer || document.createElement("canvas");
    staticLayer.width = els.canvas.width; staticLayer.height = els.canvas.height;
    var x = staticLayer.getContext("2d"), c = colour();
    x.setTransform(scale, 0, 0, scale, 0, 0);
    x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
    x.fillStyle = c;
    x.globalAlpha = 0.09;
    for (var gy = 12; gy < H; gy += 16) for (var gx = 12; gx < W; gx += 16) { x.beginPath(); x.arc(gx, gy, 1, 0, Math.PI * 2); x.fill(); }
    x.globalAlpha = 1;
    // Arrows on the playfield that point at the lanes and the saucer.
    x.strokeStyle = c; x.lineWidth = 2; x.globalAlpha = 0.35;
    [[MID, 328, 0], [104, 330, -0.5], [272, 330, 0.5]].forEach(function (a) {
      x.save(); x.translate(a[0], a[1]); x.rotate(a[2]);
      for (var k = 0; k < 3; k++) { poly(x, [[-10, 12 + k * 14], [0, k * 14], [10, 12 + k * 14]]); x.stroke(); }
      x.restore();
    });
    x.globalAlpha = 1;
    x.font = "16px " + fontFamily; x.textAlign = "center"; x.fillStyle = c; x.globalAlpha = 0.45;
    x.fillText("NEON", MID, 470); x.fillText("PINBALL", MID, 490);
    x.globalAlpha = 1;
    // Walls.
    x.shadowColor = c; x.shadowBlur = 8; x.strokeStyle = c; x.lineCap = "round"; x.lineJoin = "round";
    x.lineWidth = 4;
    poly(x, ARCH); x.stroke();
    // The apron under the guides.
    x.fillStyle = c; x.globalAlpha = 0.12;
    poly(x, [[10, 548], [104, 618], [104, 720], [10, 720]], true); x.fill();
    poly(x, [[366, 548], [272, 618], [272, 720], [366, 720]], true); x.fill();
    x.globalAlpha = 1;
    poly(x, LEFT_SIDE.concat([[104, 720]])); x.stroke();
    poly(x, RIGHT_SIDE.concat([[272, 720]])); x.stroke();
    line(x, 366, 548, 366, 720); line(x, 396, 203, 396, 720); line(x, 66, 250, 66, 380);
    x.lineWidth = 2; line(x, 366, 240, 396, 205);
    x.lineWidth = 8; POSTS.forEach(function (px) { line(x, px, 72, px, 104); });
    x.lineWidth = 3;
    slings.forEach(function (s) { poly(x, s.pts, true); x.fillStyle = "#000"; x.fill(); x.stroke(); });
    // The saucer, in gold.
    x.shadowColor = GOLD; x.strokeStyle = GOLD; x.lineWidth = 3;
    x.fillStyle = "#000"; x.beginPath(); x.arc(SAUCER.x, SAUCER.y, 14, 0, Math.PI * 2); x.fill(); x.stroke();
    x.shadowBlur = 0;
  }

  function capsulePath(x, ax, ay, bx, by, r) {
    var a = Math.atan2(by - ay, bx - ax);
    x.beginPath();
    x.arc(ax, ay, r, a + Math.PI / 2, a - Math.PI / 2);
    x.arc(bx, by, r * 0.75, a - Math.PI / 2, a + Math.PI / 2);
    x.closePath();
  }

  function draw() {
    fit();
    drawStatic();
    var x = els.canvas.getContext("2d"), c = colour(), t = performance.now() / 1000;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(staticLayer, 0, 0);
    x.setTransform(scale, 0, 0, scale, 0, 0);
    x.lineCap = "round";

    // Slingshots light up when they kick.
    slings.forEach(function (s) {
      if (!s.flash) return;
      x.globalAlpha = s.flash * 0.8; poly(x, s.pts, true); x.fillStyle = c; x.fill(); x.globalAlpha = 1;
    });
    // Bumpers.
    bumpers.forEach(function (b) {
      x.fillStyle = b.flash ? c : "#000";
      x.globalAlpha = b.flash ? 0.35 + 0.65 * b.flash : 1;
      x.beginPath(); x.arc(b.x, b.y, b.r, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      x.strokeStyle = c; x.lineWidth = 3;
      x.beginPath(); x.arc(b.x, b.y, b.r, 0, Math.PI * 2); x.stroke();
      x.lineWidth = 2;
      x.beginPath(); x.arc(b.x, b.y, b.r - 8, 0, Math.PI * 2); x.stroke();
      x.fillStyle = b.flash > 0.5 ? "#000" : c;
      x.beginPath(); x.arc(b.x, b.y, 4, 0, Math.PI * 2); x.fill();
    });
    // Drop targets.
    targets.forEach(function (tg) {
      x.strokeStyle = c;
      x.globalAlpha = tg.up ? 1 : 0.25;
      x.lineWidth = 8; line(x, tg.ax, tg.ay + 2, tg.bx, tg.by - 2);
      x.globalAlpha = 1;
    });
    // Top lanes: lit, or blinking once all three are.
    var blink = g && g.laneFlash > 0 ? Math.floor(t * 8) % 2 === 0 : false;
    LANES.forEach(function (lx, i) {
      var lit = g && (g.lanes[i] || blink);
      x.strokeStyle = c; x.lineWidth = 2;
      x.fillStyle = lit ? c : "#000";
      x.beginPath(); x.arc(lx, LANE_Y + 26, 6, 0, Math.PI * 2); x.fill(); x.stroke();
    });
    // The playfield multiplier lights.
    for (var m = 2; m <= Math.min(10, pfMax()); m++) {
      var on = g && g.pf >= m, mx = MID + (m - 2 - (Math.min(10, pfMax()) - 2) / 2) * 24;
      x.font = "12px " + fontFamily; x.textAlign = "center";
      x.fillStyle = on ? c : "#000"; x.strokeStyle = c; x.lineWidth = 1.5;
      x.beginPath(); x.arc(mx, 420, 10, 0, Math.PI * 2); x.fill(); x.stroke();
      x.fillStyle = on ? "#000" : c; x.fillText("x" + m, mx, 424);
    }
    // The spinner: a plate turning about its long side.
    var sc = Math.abs(Math.cos(spin.angle));
    x.fillStyle = c; x.globalAlpha = 0.4 + 0.6 * sc;
    x.fillRect(SPINNER.x1 + 4, SPINNER.y - 1 - 5 * sc, SPINNER.x2 - SPINNER.x1 - 8, 2 + 10 * sc);
    x.globalAlpha = 1;
    // The saucer glows when it holds a ball.
    var holding = g && g.balls.some(function (b) { return b.hold > 0; });
    if (holding) { x.fillStyle = GOLD; x.globalAlpha = 0.5 + 0.5 * Math.sin(t * 20); x.beginPath(); x.arc(SAUCER.x, SAUCER.y, 12, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1; }
    // Flippers.
    flippers.forEach(function (f) {
      var tp = tipOf(f);
      capsulePath(x, f.x, f.y, tp[0], tp[1], FLIP_R + 1);
      x.fillStyle = f.held ? c : "#000"; x.globalAlpha = f.held ? 0.35 : 1; x.fill(); x.globalAlpha = 1;
      x.strokeStyle = c; x.lineWidth = 3; x.stroke();
      x.fillStyle = c; x.beginPath(); x.arc(f.x, f.y, 3, 0, Math.PI * 2); x.fill();
    });
    // The plunger.
    var top = plungerTop();
    x.strokeStyle = c; x.lineWidth = 2;
    poly(x, [[LANE_X, top + 6]].concat([0, 1, 2, 3, 4, 5, 6].map(function (k) { return [LANE_X + (k % 2 ? 6 : -6), top + 8 + k * (H - top - 10) / 7]; })));
    x.stroke();
    x.fillStyle = c; x.fillRect(LANE_X - 10, top, 20, 6);

    // Balls.
    var img = ballImage();
    (g ? g.balls : []).forEach(function (b) {
      x.save();
      x.translate(b.x, b.y);
      x.shadowColor = c; x.shadowBlur = 10;
      x.fillStyle = "#000"; x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fill();
      x.shadowBlur = 0;
      if (img) {
        x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.clip();
        x.rotate(b.rot);
        x.drawImage(img, -R * 1.25, -R * 1.25, R * 2.5, R * 2.5);
        x.rotate(-b.rot);
      } else {
        var grad = x.createRadialGradient(-3, -3, 1, 0, 0, R);
        grad.addColorStop(0, "#fff"); grad.addColorStop(0.35, c); grad.addColorStop(1, "#021402");
        x.fillStyle = grad; x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fill();
      }
      x.restore();
      x.strokeStyle = c; x.lineWidth = 1.5;
      x.beginPath(); x.arc(b.x, b.y, R, 0, Math.PI * 2); x.stroke();
      x.fillStyle = "rgba(255,255,255,0.55)";
      x.beginPath(); x.arc(b.x - R * 0.35, b.y - R * 0.4, R * 0.28, 0, Math.PI * 2); x.fill();
    });

    if (!g) return overlay(x, ["Neon Pinball", "Press Space or tap to play"]);
    // Points floating up.
    x.textAlign = "center";
    g.texts = g.texts.filter(function (ft) {
      ft.t += frameDt;
      if (ft.t > 1) return false;
      x.globalAlpha = 1 - ft.t;
      x.font = (ft.gold ? "16px " : "13px ") + fontFamily;
      x.fillStyle = ft.gold ? GOLD : c;
      x.fillText(ft.text, ft.x, ft.y - ft.t * 30);
      return true;
    });
    x.globalAlpha = 1;
    if (g.over) {
      return overlay(x, [g.result.record ? "New record!" : "Game over", full(g.result.score) + " points",
        "+" + full(g.result.tickets) + (g.result.tickets === 1 ? " ticket" : " tickets"), "Space or tap: play again"]);
    }
    if (g.paused) return overlay(x, ["Paused", "Press a flipper or tap to go on"]);
    if (g.msgT > 0) {
      x.font = "22px " + fontFamily; x.fillStyle = GOLD; x.globalAlpha = Math.min(1, g.msgT * 2);
      x.fillText(g.msg, MID, 560); x.globalAlpha = 1;
    }
    var waiting = g.balls.some(function (b) { return b.ready && !b.extra; });
    if (waiting && !pulling) { x.font = "13px " + fontFamily; x.fillStyle = c; x.fillText("Hold Space to launch", MID, 700); }
  }

  function overlay(x, lines) {
    x.fillStyle = "rgba(0,0,0,0.72)"; x.fillRect(20, 250, W - 60, 40 + lines.length * 30);
    x.strokeStyle = colour(); x.lineWidth = 2; x.strokeRect(20, 250, W - 60, 40 + lines.length * 30);
    x.textAlign = "center";
    lines.forEach(function (l, i) {
      x.font = (i ? "16px " : "26px ") + fontFamily;
      x.fillStyle = i ? colour() : GOLD;
      x.fillText(l, MID, 288 + i * 30);
    });
  }

  function frame(now) {
    loop = 0;
    if (!shown()) return;
    frameDt = Math.min(0.1, last ? (now - last) / 1000 : 0);
    if (g && !g.over && !g.paused) {
      acc += frameDt;
      var n = 0;
      while (acc >= STEP && n < 60) { step(STEP); acc -= STEP; n++; if (!g || g.over) break; }
    } else acc = 0;
    last = now;
    draw();
    renderNumbers();
    loop = requestAnimationFrame(frame);
  }

  // --- Screen ---------------------------------------------------------------------------

  var ICON = ["...#...", "..###..", "...#...", ".......", "##...##", ".##.##."];
  var TICKET = ["#######", "##...##", ".#...#.", "##...##", "#######"];
  function dots(rows, size) {
    var s = "";
    rows.forEach(function (row, y) {
      for (var i = 0; i < row.length; i++) if (row[i] === "#") s += '<circle cx="' + (i + 0.5) + '" cy="' + (y + 0.5) + '" r="0.45"/>';
    });
    return '<svg viewBox="0 0 ' + rows[0].length + " " + rows.length + '" width="' + rows[0].length * size + '" height="' + rows.length * size +
      '" fill="currentColor" aria-hidden="true" focusable="false">' + s + "</svg>";
  }
  function shown() { return !!els && !els.screen.hidden; }
  function say(t) { if (els) els.status.textContent = t; }

  function build(ui) {
    var hud = document.createElement("button");
    hud.type = "button";
    hud.className = "slope-btn slope-hud-item slope-pinball-open";
    hud.title = "Neon Pinball";
    hud.setAttribute("aria-label", "Neon Pinball");
    hud.innerHTML = dots(ICON, 3);
    ui.hud.appendChild(hud);
    hud.addEventListener("click", function () { open(hud); });

    var screen = document.createElement("div");
    screen.className = "slope-career slope-pinball";
    screen.id = "slope-pinball";
    screen.setAttribute("role", "dialog");
    screen.setAttribute("aria-labelledby", "slope-pinball-title");
    screen.hidden = true;
    screen.innerHTML =
      '<div class="slope-career-inner slope-pinball-inner">' +
        '<h2 class="slope-career-title" id="slope-pinball-title">Neon Pinball</h2>' +
        '<div class="slope-pinball-top">' +
          '<canvas class="slope-pinball-table" width="400" height="720" tabindex="0" role="application" aria-roledescription="pinball table" ' +
            'aria-label="The pinball table. Flippers: Left and Right arrows (or Z and M). Hold Space to pull the plunger."></canvas>' +
          '<div class="slope-pinball-side">' +
            '<p class="slope-pinball-scoreline" aria-live="off"><span class="slope-pinball-score">0</span><span class="slope-pinball-unit">points</span></p>' +
            '<p class="slope-pinball-info"></p>' +
            '<p class="slope-pinball-tickets"></p>' +
            '<p class="slope-pinball-main"></p>' +
            '<div class="slope-pinball-actions">' +
              '<button type="button" class="slope-btn slope-pinball-play"></button>' +
              '<button type="button" class="slope-btn slope-pinball-end" hidden>End game</button>' +
            "</div>" +
            '<p class="slope-pinball-hint">Flippers: Left and Right arrows, Z and M, or A and D. Hold Space (or Down) to pull the plunger, let go to launch. ' +
              "On a touch screen, hold the left or right half of the table. Every " + TICKET_POINTS + " points is a ticket for the upgrades below.</p>" +
            '<p class="slope-shop-status slope-pinball-status" role="status"></p>' +
          "</div>" +
        "</div>" +
        GROUPS.map(function (gr) {
          return '<h3 class="slope-shop-section">' + gr[1] + "</h3>" +
            '<ul class="slope-merge-upgrades slope-pinball-ups">' +
              UPS.filter(function (u) { return u.group === gr[0]; }).map(function (u) {
                return '<li data-up="' + u.key + '"><div><p class="slope-merge-upgrade-name"></p><p class="slope-merge-upgrade-effect"></p></div>' +
                  '<button type="button" class="slope-btn slope-merge-buy"></button></li>';
              }).join("") +
            "</ul>";
        }).join("") +
        '<div class="slope-career-actions"><button type="button" class="slope-btn slope-back">Back</button></div>' +
      "</div>";
    ui.root.appendChild(screen);

    els = {
      screen: screen,
      canvas: screen.querySelector(".slope-pinball-table"),
      score: screen.querySelector(".slope-pinball-score"),
      info: screen.querySelector(".slope-pinball-info"),
      tickets: screen.querySelector(".slope-pinball-tickets"),
      main: screen.querySelector(".slope-pinball-main"),
      play: screen.querySelector(".slope-pinball-play"),
      end: screen.querySelector(".slope-pinball-end"),
      status: screen.querySelector(".slope-pinball-status"),
      ups: UPS.map(function (u) {
        var li = screen.querySelector('[data-up="' + u.key + '"]');
        return { item: u, name: li.querySelector(".slope-merge-upgrade-name"), effect: li.querySelector(".slope-merge-upgrade-effect"), buy: li.querySelector("button") };
      })
    };
    var family = getComputedStyle(screen).getPropertyValue("--slope-display");
    if (family) fontFamily = family.trim();

    els.play.addEventListener("click", function () { start(); els.canvas.focus({ preventScroll: true }); });
    els.end.addEventListener("click", function () { end(); });
    els.ups.forEach(function (r) { r.buy.addEventListener("click", function () { buy(r.item); }); });
    screen.querySelector(".slope-back").addEventListener("click", close);

    screen.addEventListener("keydown", keyDown);
    screen.addEventListener("keyup", keyUp);
    // With the focus lost to the page (a click on an empty spot), the keys
    // still play.
    document.addEventListener("keydown", function (e) { if (shown() && lost(e)) { keyDown(e); e.stopPropagation(); } });
    document.addEventListener("keyup", function (e) { if (shown() && lost(e)) { keyUp(e); e.stopPropagation(); } });

    // Touch and mouse: the halves of the table are the flippers; while the
    // ball waits in the lane, holding anywhere pulls the plunger.
    els.canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      els.canvas.focus({ preventScroll: true });
      if (!g || g.over) { start(); return; }
      if (g.paused) { g.paused = false; last = 0; return; }
      var r = els.canvas.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, py = (e.clientY - r.top) / r.height * H;
      var waiting = g.balls.some(function (b) { return b.ready && !b.extra; }) && !g.balls.some(function (b) { return !b.ready; });
      var ctl = waiting || (px > LANE_WALL - 10 && py > 400) ? "launch" : px < MID ? "left" : "right";
      pointers[e.pointerId] = ctl;
      try { els.canvas.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
      hold(ctl, "pointer" + e.pointerId, true);
    });
    function lift(e) {
      var ctl = pointers[e.pointerId];
      if (!ctl) return;
      delete pointers[e.pointerId];
      hold(ctl, "pointer" + e.pointerId, false);
    }
    els.canvas.addEventListener("pointerup", lift);
    els.canvas.addEventListener("pointercancel", lift);
    els.canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", function () { if (document.hidden) pause(); });
    window.addEventListener("resize", function () { if (shown()) staticKey = ""; });
  }
  var pointers = {};

  function lost(e) { return e.target === document.body || e.target === document.documentElement; }
  function keyDown(e) {
    if (e.key === "Escape") { close(); return; }
    var ctl = KEYS[e.code];
    if (!ctl) return;
    if (!g || g.over) {   // Space on the table starts a game (on a button it presses the button)
      if (ctl === "launch" && (e.target === els.canvas || lost(e))) { e.preventDefault(); if (!e.repeat) { start(); els.canvas.focus({ preventScroll: true }); } }
      return;
    }
    e.preventDefault();
    if (!e.repeat) hold(ctl, e.code, true);
  }
  function keyUp(e) {
    var ctl = KEYS[e.code];
    if (!ctl) return;
    if (g && !g.over) e.preventDefault();
    hold(ctl, e.code, false);
  }

  function buy(u) {
    var l = up(u.key), price = upPrice(u, l);
    if (l >= u.max || pb.tickets < price) return;
    pb.tickets -= price;
    pb.up[u.key] = l + 1;
    save(true);
    say(u.name + " " + (l + 1) + ": " + u.text(l + 1) + ".");
    render();
  }

  var shownText = {};
  function setText(el, key, text) { if (shownText[key] !== text) { shownText[key] = text; el.textContent = text; } }

  // The numbers that change while a game runs (every frame, cheap).
  function renderNumbers() {
    if (!shown()) return;
    var playing = g && !g.over;
    setText(els.score, "score", abbr(g ? g.score : 0));
    setText(els.info, "info", playing
      ? "Ball " + Math.min(g.ball, ballsAGame()) + " of " + ballsAGame() + "  \u00b7  playfield x" + g.pf +
        (g.chain > 1 && up("combo") ? "  \u00b7  combo " + g.chain : "") + (g.balls.length > 1 ? "  \u00b7  " + g.balls.length + " balls" : "")
      : pb.games ? "Best " + abbr(pb.best) + "  \u00b7  " + full(pb.games) + (pb.games === 1 ? " game" : " games") : "No games yet");
    if (els.play.hidden !== !!playing) {   // Play and End game swap places; the focus goes along
      var focused = document.activeElement;
      els.play.hidden = !!playing;
      els.end.hidden = !playing;
      if (focused === els.end) els.play.focus({ preventScroll: true });
      else if (focused === els.play) els.canvas.focus({ preventScroll: true });
    }
  }

  function render() {
    if (!shown()) return;
    var b = boosts();
    els.tickets.innerHTML = dots(TICKET, 3) + " <span>" + abbr(pb.tickets) + (pb.tickets === 1 ? " ticket" : " tickets") + "</span>";
    els.main.textContent = "Main game: gems x" + b.gems.toFixed(2) + "  \u00b7  XP x" + b.xp.toFixed(2) + "  \u00b7  ball XP x" + b.ballXp.toFixed(2) +
      (pb.best ? "  (record x" + recordBoost().toFixed(2) + ")" : "");
    els.play.textContent = (g && g.over ? "Play again" : "Play") + " (" + ballsAGame() + " balls)";
    els.ups.forEach(function (r) {
      var u = r.item, l = up(u.key), maxed = l >= u.max, price = upPrice(u, l);
      r.name.textContent = u.name + (l ? " " + l : "");
      r.effect.textContent = "Now: " + u.text(l) + (maxed ? " (max)" : ". Next: " + u.text(l + 1));
      r.buy.innerHTML = maxed ? "Max" : dots(TICKET, 2) + "<span>" + abbr(price) + "</span>";
      r.buy.disabled = maxed || pb.tickets < price;
      r.buy.setAttribute("aria-label", maxed ? u.name + ", at its best" : "Buy " + u.name + " for " + full(price) + " tickets");
    });
    renderNumbers();
  }

  function open(from) {
    if (!els) return;
    openedFrom = from || null;
    window.SlopeUI.closeSettings();
    var toast = window.SlopeUI.root.querySelector(".slope-toast");
    if (toast) toast.hidden = true;
    els.screen.hidden = false;
    els.screen.scrollTop = 0;
    if (game.pause) game.pause("pinball");
    ballKey = "";
    staticKey = "";
    last = 0;
    render();
    if (!loop) loop = requestAnimationFrame(frame);
    els.canvas.focus({ preventScroll: true });
  }

  function close() {
    pause();
    els.screen.hidden = true;
    if (game.resume) game.resume("pinball");
    if (openedFrom && document.contains(openedFrom)) openedFrom.focus();
    else if (els.screen.contains(document.activeElement)) document.activeElement.blur();
    openedFrom = null;
  }

  window.SlopeUI.ready(build);

  window.SlopePinball = {
    open: function (from) { open(from); },
    boosts: boosts,
    state: function () {
      return {
        tickets: pb.tickets, best: pb.best, games: pb.games, total: pb.total, up: Object.assign({}, pb.up),
        game: g ? { score: g.score, ball: g.ball, balls: g.balls.map(function (b) { return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, ready: b.ready, hold: b.hold }; }),
          pf: g.pf, lanes: g.lanes.slice(), over: g.over, paused: g.paused, jackpots: g.jackpots, gems: g.gems, time: g.time,
          nudges: g.nudges, escapes: g.escapes, hits: Object.assign({}, g.hits) } : null,
        flippers: flippers.map(function (f) { return { a: f.a, held: f.held }; }),
        targets: targets.map(function (t) { return t.up; })
      };
    },
    // For tools and tests: tickets straight away, the controls, and the
    // table run without drawing (seconds of play, with an optional bot
    // that sets the flippers each step: bot(state) -> { left, right }).
    give: function (n) { pb.tickets += n; save(true); render(); },
    start: start,
    press: press,
    end: end,
    simulate: function (seconds, bot) {
      if (!g || g.over) start();
      var n = Math.round(seconds / STEP);
      for (var k = 0; k < n && !g.over; k++) {
        if (bot) {
          var want = bot({ balls: g.balls, flippers: flippers, time: g.time });
          flippers[0].held = !!want.left; flippers[1].held = !!want.right;
          var b = g.balls.filter(function (x) { return x.ready && !x.extra; })[0];
          if (b && want.launch) launch(b, want.launch);
        }
        step(STEP);
      }
      return window.SlopePinball.state();
    }
  };
})();
