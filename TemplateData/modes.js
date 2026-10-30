/*
 * Game modes. The main menu's Play button opens a picker (the game signals
 * #slope-play, tools/patch_play.py): the modes in a list, grouped (Slope and
 * Platformer), and the selected one's moving preview, what it is, your best
 * and a Play button. A Slope run starts in the chosen mode, and Again keeps
 * it. The platformer's modes start the platformer instead (platformer.js):
 *
 *   Platformer Endless     a course that never ends
 *   Platformer Adventure   its level grid
 *
 *   Classic      the game as it is
 *   Randomizer   every few seconds a random effect for a short while: some
 *                help (slow motion, gem rain, a magnet, double gems, a
 *                jackpot), some hurt (fast forward, mirrored steering, a
 *                blackout, a wobbling or blurred screen)
 *   Advanced     every obstacle and slope from the Adventure levels,
 *                endlessly, closer and quicker the further the ball gets
 *                (adventure.js)
 *   Gem Rush     60 seconds to grab as many gems as you can: three times the
 *                gems, and they fly to the ball (gems.js reads that from
 *                active()); the run ends when time is up, and its best is
 *                counted in gems
 *   Legacy       the original game's steering: a push that builds up sideways
 *                speed, which the ball keeps after the key is let go (states
 *                in the game's ControlManager, tools/patch_legacy.py, switched
 *                on with LegacySteerOn at the start of the run)
 *
 *   SlopeModes.current()        the mode of the run being played
 *   SlopeModes.active(effect)   true while a Randomizer effect is on (or Gem Rush's gem rain and magnet)
 *   SlopeModes.open(from)       shows the picker
 *   SlopeModes.play(id)         plays a mode, as its Play button does
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var STORAGE_KEY = "slope-mode";        // the Slope mode Again plays
  var PICK_KEY = "slope-mode-pick";      // the mode selected in the picker (any)
  var SLOPE_KEYS = "Arrows or A/D to steer";
  var PLAT_KEYS = "W A S D to roll, Space to jump, arrows to look around";
  var GROUPS = [{ id: "slope", name: "Slope" }, { id: "platformer", name: "Platformer", tag: "New" }];
  var MODES = [
    { id: "classic", group: "slope", name: "Classic", text: "The original: the slope, your ball and nothing else in the way.", keys: SLOPE_KEYS },
    { id: "randomizer", group: "slope", name: "Randomizer", text: "Every few seconds a random effect for a short while. Some help you, some get in your way.", keys: SLOPE_KEYS },
    { id: "advanced", group: "slope", name: "Advanced", text: "Every obstacle and slope from the Adventure levels, all the way down: closer together and quicker the further you get.", keys: SLOPE_KEYS },
    { id: "rush", group: "slope", name: "Gem Rush", text: "60 seconds to grab every gem you can. Three times the gems, and they fly to you.", keys: SLOPE_KEYS },
    { id: "legacy", group: "slope", name: "Legacy", text: "The original steering: the ball picks up speed sideways while you hold a key, and keeps sliding when you let go.", keys: SLOPE_KEYS },
    { id: "plat-endless", group: "platformer", name: "Endless", play: "Play Endless",
      text: "A 3D platformer in Slope's world. Roll, jump the gaps and dodge everything red on a winding course that never ends, and gets harder and faster the further you go.", keys: PLAT_KEYS },
    { id: "plat-adventure", group: "platformer", name: "Adventure", play: "Choose a level",
      text: "Platformer levels with a finish line: gaps, hurdles, spikes, lifts, sweepers, lasers, bounce pads and more, one new thing a level. Beat one to unlock the next.", keys: PLAT_KEYS }
  ];
  function isPlatformer(id) { return /^plat-/.test(id); }

  var EFFECTS = [
    { id: "slowmo", name: "Slow-mo", text: "Everything slows down", good: true, seconds: 6 },
    { id: "gemrain", name: "Gem rain", text: "Three times the gems", good: true, seconds: 7 },
    { id: "magnet", name: "Magnet", text: "Gems fly to you", good: true, seconds: 7 },
    { id: "double", name: "Double gems", text: "Every gem counts twice", good: true, seconds: 7 },
    { id: "jackpot", name: "Jackpot", text: "Free gems", good: true, seconds: 2.5 },
    { id: "turbo", name: "Turbo", text: "Everything speeds up", good: false, seconds: 5 },
    { id: "mirror", name: "Mirror", text: "Left is right, right is left", good: false, seconds: 5 },
    { id: "blackout", name: "Blackout", text: "The lights go out", good: false, seconds: 5 },
    { id: "wobble", name: "Wobble", text: "The world sways", good: false, seconds: 6 },
    { id: "blur", name: "Blur", text: "Where are your glasses?", good: false, seconds: 5 }
  ];
  var FIRST_EFFECT = 5;           // seconds into the run
  var RUSH_SECONDS = 60;          // a Gem Rush run
  var GAP = [3, 6];               // seconds between effects
  var JACKPOT_GEMS = 15;

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  var chosen = "classic";
  try { chosen = byId(MODES, localStorage.getItem(STORAGE_KEY)).id; } catch (e) {}
  if (isPlatformer(chosen)) chosen = "classic";
  var picked = chosen;
  try { picked = byId(MODES, localStorage.getItem(PICK_KEY) || chosen).id; } catch (e) {}
  var current = null;   // the mode of the run in progress (null: not a mode run)

  // --- Randomizer --------------------------------------------------------------

  var fx = { on: null, until: 0, next: 0, clock: 0, last: null, ball: null, vp: null, previous: null };

  function effectActive(id) { return !!(fx.on && fx.on.id === id); }

  function startEffect(e) {
    fx.on = e;
    fx.until = fx.clock + e.seconds;
    if (e.id === "slowmo") game.setTimeScale(0.55);
    if (e.id === "turbo") game.setTimeScale(1.35);
    if (e.id === "mirror") mirror(true);
    if (e.id === "jackpot") profile.addGems(JACKPOT_GEMS);
    showBanner(e);
    applyLook();
  }

  function endEffect() {
    var e = fx.on;
    if (!e) return;
    fx.on = null;
    if (e.id === "slowmo" || e.id === "turbo") game.setTimeScale(1);
    if (e.id === "mirror") mirror(false);
    hideBanner();
    applyLook();
  }

  function stopRandomizer() {
    endEffect();
    fx.last = null;
  }

  // The effects run on the time the run has been going (paused screens and
  // slow frames don't count), measured on the wall clock.
  game.on("frame", function (f) {
    if (current !== "randomizer" || !game.inRun()) return;
    var now = game.realNow() / 1000;
    if (fx.last !== null) fx.clock += Math.min(0.25, now - fx.last);
    fx.last = now;
    fx.ball = f.ball;
    fx.vp = f.vp || fx.vp;
    if (fx.on && fx.clock >= fx.until) {
      endEffect();
      fx.next = fx.clock + GAP[0] + Math.random() * (GAP[1] - GAP[0]);
    }
    if (!fx.on && fx.clock >= fx.next) {
      var pool = EFFECTS.filter(function (e) { return e.id !== fx.previous; });
      var e = pool[Math.floor(Math.random() * pool.length)];
      fx.previous = e.id;
      startEffect(e);
    }
    if (fx.on) { updateBanner(); updateLook(); }
  });

  // --- Gem Rush -----------------------------------------------------------------
  // The same clock as the effects: run time on the wall clock. When it runs
  // out, the run ends the game's own way (and its score screen shows).

  var rush = { clock: 0, last: null, over: false };

  game.on("frame", function () {
    if (current !== "rush" || !game.inRun() || rush.over) return;
    var now = game.realNow() / 1000;
    if (rush.last !== null) rush.clock += Math.min(0.25, now - rush.last);
    rush.last = now;
    var left = Math.max(0, RUSH_SECONDS - rush.clock);
    showRush(left);
    if (left <= 0) {
      rush.over = true;
      game.send("collide death");
    }
  });

  function rushGems() { return window.SlopeGems ? window.SlopeGems.currentRun().gems : 0; }

  function showRush(left) {
    if (!banner) return;
    banner.classList.remove("is-bad");
    banner.querySelector(".slope-effect-name").textContent = left > 0 ? "Gem Rush" : "Time's up!";
    banner.querySelector(".slope-effect-text").textContent = "+" + profile.short(rushGems()) + " gems" + (left > 0 ? "  \u00b7  " + Math.ceil(left) + " s left" : "");
    banner.querySelector(".slope-effect-bar span").style.transform = "scaleX(" + (left / RUSH_SECONDS).toFixed(3) + ")";
    banner.hidden = false;
  }

  // --- Legacy -------------------------------------------------------------------
  // The game starts every run with its instant steering; a Legacy run switches
  // to the original steering at once, and again a moment later in case the
  // game's own reset came after (only while no steering key is held, as the
  // switch waits for a fresh key press).

  var legacyTimers = [], legacyOn = false;
  function setLegacy(on) {
    legacyTimers.forEach(clearTimeout);
    legacyTimers = [];
    if (!on && !legacyOn) return;
    legacyOn = on;
    var event = on ? "LegacySteerOn" : "LegacySteerOff";
    game.sendTo("ControlManager", event);
    if (on) {
      [250, 700].forEach(function (ms) {
        legacyTimers.push(setTimeout(function () {
          var steer = window.SlopeSteer && window.SlopeSteer.state();
          if (current === "legacy" && !(steer && (steer.held.left || steer.held.right))) game.sendTo("ControlManager", event);
        }, ms));
      });
    }
  }

  // Mirrored steering: the game hears the opposite key (steer.js).
  function mirror(on) {
    if (window.SlopeSteer) window.SlopeSteer.mirror(on);
  }

  // Screen effects: on the game's canvas (the track colour tint sits on its
  // container, so they combine), and a dark veil with a hole around the ball.
  var veil = null;
  function canvas() { return document.getElementById("#canvas"); }
  function applyLook() {
    var c = canvas();
    if (c) {
      c.style.filter = effectActive("blur") ? "blur(3px)" : "";
      if (!effectActive("wobble")) c.style.transform = "";
    }
    if (veil) veil.hidden = !effectActive("blackout");
  }
  function updateLook() {
    var c = canvas();
    if (c && effectActive("wobble")) {
      var t = fx.clock;
      c.style.transform = "rotate(" + (Math.sin(t * 2.1) * 7).toFixed(2) + "deg) scale(1.15)";
    }
    if (veil && effectActive("blackout") && c && fx.vp && fx.ball && fx.ball.world) {
      var w = fx.ball.world, m = fx.vp;
      var cx = m[0] * w[0] + m[4] * w[1] + m[8] * w[2] + m[12], cy = m[1] * w[0] + m[5] * w[1] + m[9] * w[2] + m[13];
      var cw = m[3] * w[0] + m[7] * w[1] + m[11] * w[2] + m[15];
      if (cw > 0) {
        var r = c.getBoundingClientRect();
        var x = r.left + (cx / cw * 0.5 + 0.5) * r.width, y = r.top + (0.5 - cy / cw * 0.5) * r.height;
        veil.style.setProperty("--x", x.toFixed(0) + "px");
        veil.style.setProperty("--y", (y - r.height * 0.12).toFixed(0) + "px");
        veil.style.setProperty("--r", (r.height * 0.2).toFixed(0) + "px");
      }
    }
  }

  // The banner under the HUD: the effect's name, what it does, time left.
  var banner = null;
  function showBanner(e) {
    if (!banner) return;
    banner.classList.toggle("is-bad", !e.good);
    banner.querySelector(".slope-effect-name").textContent = e.name;
    banner.querySelector(".slope-effect-text").textContent = e.text;
    banner.hidden = false;
    updateBanner();
  }
  function updateBanner() {
    if (!banner || !fx.on) return;
    var left = Math.max(0, fx.until - fx.clock) / fx.on.seconds;
    banner.querySelector(".slope-effect-bar span").style.transform = "scaleX(" + left.toFixed(3) + ")";
  }
  function hideBanner() { if (banner) banner.hidden = true; }

  // --- Runs ----------------------------------------------------------------------

  function adventureRun() { return window.SlopeAdventure && window.SlopeAdventure.handlesRun && window.SlopeAdventure.handlesRun(); }

  // (This loads after adventure.js, whose run start handler has already
  // decided whether the run is an Adventure level.)
  game.on("runstart", function () {
    stopRandomizer();
    hideBanner();
    rush = { clock: 0, last: null, over: false };
    // An Adventure level is its own thing; anything else plays the chosen mode.
    current = adventureRun() ? null : chosen;
    setLegacy(current === "legacy");
    fx.clock = 0;
    fx.last = null;
    fx.previous = null;
    fx.next = FIRST_EFFECT;
  });

  game.on("runend", function (e) {
    var mode = current;
    stopRandomizer();
    hideBanner();   // the run summary shows in its place
    if (mode && profile.recordModeRun) {
      var dodged = mode === "advanced" && window.SlopeAdventure && window.SlopeAdventure.dodged ? window.SlopeAdventure.dodged() : 0;
      // A Gem Rush counts the gems it got; the other modes their score.
      profile.recordModeRun(mode, mode === "rush" ? rushGems() : e ? e.score : 0, { dodged: dodged });
    }
  });
  game.on("menu", function () { stopRandomizer(); hideBanner(); });

  function choose(id) {
    if (isPlatformer(id)) return;
    chosen = byId(MODES, id).id;
    try { localStorage.setItem(STORAGE_KEY, chosen); } catch (e) {}
    if (window.SlopeAdventure && window.SlopeAdventure.setEndless) window.SlopeAdventure.setEndless(chosen === "advanced");
  }
  choose(chosen);

  // --- Picker ---------------------------------------------------------------------
  // The modes in a list on the left, grouped; the selected one on the right
  // with a big moving preview. Up and down keys move through the list, Enter
  // (or a double click) plays.

  var els = null, openedFrom = null, loop = 0, startedAt = 0;

  function build(ui) {
    var screen = document.createElement("div");
    screen.className = "slope-career slope-modes";
    screen.id = "slope-modes";
    screen.setAttribute("role", "dialog");
    screen.setAttribute("aria-labelledby", "slope-modes-title");
    screen.hidden = true;
    screen.innerHTML =
      '<div class="slope-career-inner slope-modes-inner">' +
        '<h2 class="slope-career-title" id="slope-modes-title">Play</h2>' +
        '<div class="slope-modes-body">' +
          '<nav class="slope-modes-nav" aria-label="Game modes">' +
            GROUPS.map(function (g) {
              return '<section class="slope-modes-group" aria-labelledby="slope-modes-group-' + g.id + '">' +
                '<h3 class="slope-modes-group-title" id="slope-modes-group-' + g.id + '">' + g.name +
                  (g.tag ? '<span class="slope-modes-tag">' + g.tag + "</span>" : "") + "</h3>" +
                '<ul class="slope-modes-list">' +
                  MODES.filter(function (m) { return m.group === g.id; }).map(function (m) {
                    return '<li><button type="button" class="slope-btn slope-mode-row" data-mode="' + m.id + '" aria-pressed="false">' +
                      '<span class="slope-mode-row-name">' + m.name + "</span>" +
                      '<span class="slope-mode-row-best"></span></button></li>';
                  }).join("") +
                "</ul></section>";
            }).join("") +
          "</nav>" +
          '<div class="slope-mode-detail">' +
            '<canvas class="slope-mode-preview" aria-hidden="true"></canvas>' +
            '<p class="slope-mode-group-name"></p>' +
            '<h3 class="slope-mode-name" aria-live="polite"></h3>' +
            '<p class="slope-mode-text"></p>' +
            '<p class="slope-mode-keys"></p>' +
            '<p class="slope-mode-best"></p>' +
            '<button type="button" class="slope-btn slope-mode-play"></button>' +
          "</div>" +
        "</div>" +
        '<div class="slope-career-actions"><button type="button" class="slope-btn slope-back">Back</button></div>' +
      "</div>";
    ui.root.appendChild(screen);

    banner = document.createElement("div");
    banner.className = "slope-effect";
    banner.setAttribute("role", "status");
    banner.hidden = true;
    banner.innerHTML = '<p class="slope-effect-name"></p><p class="slope-effect-text"></p><div class="slope-effect-bar" aria-hidden="true"><span></span></div>';
    ui.root.appendChild(banner);

    veil = document.createElement("div");
    veil.className = "slope-veil";
    veil.hidden = true;
    ui.root.appendChild(veil);

    els = {
      screen: screen,
      back: screen.querySelector(".slope-back"),
      canvas: screen.querySelector(".slope-mode-preview"),
      group: screen.querySelector(".slope-mode-group-name"),
      name: screen.querySelector(".slope-mode-name"),
      text: screen.querySelector(".slope-mode-text"),
      keys: screen.querySelector(".slope-mode-keys"),
      best: screen.querySelector(".slope-mode-best"),
      play: screen.querySelector(".slope-mode-play"),
      rows: MODES.map(function (m) {
        var b = screen.querySelector('.slope-mode-row[data-mode="' + m.id + '"]');
        return { mode: m, button: b, best: b.querySelector(".slope-mode-row-best") };
      })
    };
    var scale = Math.min(2, window.devicePixelRatio || 1);
    els.canvas.width = Math.round(480 * scale);
    els.canvas.height = Math.round(240 * scale);
    els.rows.forEach(function (row, i) {
      row.button.addEventListener("click", function () { select(row.mode.id); });
      row.button.addEventListener("dblclick", function () { play(row.mode.id); });
      row.button.addEventListener("keydown", function (e) {
        var to = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? els.rows.length - 1 : null;
        if (to !== null) {
          e.preventDefault();
          var next = els.rows[(to + els.rows.length) % els.rows.length];
          select(next.mode.id);
          next.button.focus();
        } else if (e.key === "Enter") {
          e.preventDefault();
          play(row.mode.id);
        }
      });
    });
    els.play.addEventListener("click", function () { play(picked); });
    els.back.addEventListener("click", close);
    screen.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  function groupOf(id) { return byId(GROUPS, byId(MODES, id).group); }

  function select(id) {
    var m = byId(MODES, id);
    picked = m.id;
    try { localStorage.setItem(PICK_KEY, picked); } catch (e) {}
    els.rows.forEach(function (r) { r.button.setAttribute("aria-pressed", String(r.mode.id === picked)); });
    els.group.textContent = groupOf(picked).name;
    els.name.textContent = m.name;
    els.text.textContent = m.text;
    els.keys.textContent = m.keys;
    els.best.textContent = bestLine(m.id, true);
    els.play.textContent = m.play || "Play " + m.name;
    lastDraw = 0;
  }

  // The best line of a mode: short in the list, longer under the preview.
  function bestLine(id, long) {
    var p = profile.get(), stats = p.modes || {};
    if (id === "plat-adventure") {
      var beaten = (p.platUnlocked || 1) - 1;
      if (!beaten && !(stats.platadv && stats.platadv.runs)) return long ? "Not played yet" : "";
      return long ? "Level " + p.platUnlocked + " next  \u00b7  " + beaten + (beaten === 1 ? " level" : " levels") + " beaten" : "Level " + p.platUnlocked;
    }
    var s = stats[id === "plat-endless" ? "platformer" : id];
    if (!s || !s.runs) return long ? "Not played yet" : "";
    var unit = id === "rush" ? " gems" : id === "plat-endless" ? " m" : "";
    var bestText = id === "rush" ? profile.short(s.best) : s.best;   // Gem Rush counts gems: 1.2K, 3.4M...
    return long ? "Best " + bestText + unit + "  \u00b7  " + s.runs + (s.runs === 1 ? " run" : " runs") : "Best " + bestText + unit;
  }

  function renderBest() {
    els.rows.forEach(function (r) { r.best.textContent = bestLine(r.mode.id, false); });
  }

  function open(from) {
    if (!els) return;
    openedFrom = from || null;
    window.SlopeUI.closeSettings();
    var toast = window.SlopeUI.root.querySelector(".slope-toast");
    if (toast) toast.hidden = true;
    renderBest();
    select(picked);
    els.screen.hidden = false;
    els.screen.scrollTop = 0;
    if (game.pause) game.pause("modes");
    startedAt = performance.now();
    if (!loop) loop = requestAnimationFrame(tick);
    var row = els.rows.filter(function (r) { return r.mode.id === picked; })[0];
    if (row) row.button.focus({ preventScroll: true });
  }

  function close() {
    els.screen.hidden = true;
    if (game.resume) game.resume("modes");
    if (openedFrom && document.contains(openedFrom)) openedFrom.focus();
    else if (els.screen.contains(document.activeElement)) document.activeElement.blur();
    openedFrom = null;
  }

  function play(id) {
    var m = byId(MODES, id);
    if (isPlatformer(m.id)) {
      var plat = window.SlopePlatformer;
      if (!plat) return;
      picked = m.id;
      try { localStorage.setItem(PICK_KEY, picked); } catch (e) {}
      close();
      if (m.id === "plat-endless") plat.start("endless"); else plat.openLevels(null);
      return;
    }
    select(m.id);
    choose(m.id);
    close();
    game.send("resetPressed");
  }

  game.on("play", function () { open(null); });

  // --- Previews ----------------------------------------------------------------------
  // The selected mode, moving. Slope modes: the track drawn in perspective,
  // rushing towards the viewer, with the ball weaving along it; Randomizer
  // flashes its effects, Advanced brings obstacles, Gem Rush a stream of gems
  // and its countdown. Platformer: blocks floating in the dark, the ball
  // jumping a gap and a red wall.

  var NEON = "#00ff00", RED = "#ff1a10";
  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var lastDraw = 0;

  function tick(now) {
    loop = 0;
    if (!els || els.screen.hidden) return;
    if (now - lastDraw >= 33) {
      lastDraw = now;
      var t = reduceMotion.matches ? 1.2 : (now - startedAt) / 1000;
      if (isPlatformer(picked)) drawPlatformer(els.canvas, picked === "plat-adventure", t);
      else drawPreview(els.canvas, picked, t);
    }
    loop = requestAnimationFrame(tick);
  }

  // A ball (black, neon globe lines) at x, y with radius r, turned by t.
  function ball(x, cx, cy, r, s, t) {
    x.fillStyle = "#000";
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.strokeStyle = NEON;
    x.lineWidth = 2 * s;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.ellipse(cx, cy, r, r * Math.abs(Math.cos(t * 4)), 0, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.moveTo(cx, cy - r); x.lineTo(cx, cy + r); x.stroke();
  }

  function label(x, text, W, s, colour) {
    x.save();
    x.font = (18 * s) + 'px "Slope Chargen", monospace';
    x.textAlign = "center";
    x.fillStyle = colour || NEON;
    x.fillText(text, W / 2, 26 * s);
    x.restore();
  }

  // The platformer: a repeating stretch of course coming towards the viewer
  // (floor, gap, floor with a red wall, a step up), and the ball jumping it.
  var PLAT_LOOP = 16;
  var PLAT_PIECES = [
    { from: 0, to: 6, h: 0 },
    { from: 8.2, to: 16, h: 0, wall: 12 }
  ];
  function drawPlatformer(cv, adventure, t) {
    var x = cv.getContext("2d"), W = cv.width, H = cv.height, s = H / 150;
    x.fillStyle = "#000";
    x.fillRect(0, 0, W, H);
    var vy = H * 0.3, cx = W / 2, half = W * 0.2;
    // A point at depth z (1 is the viewer's feet), sideways lateral, height h.
    var speed = 5, travel = t * speed, ballAt = 1.9;
    // The course bends left and right; the view follows the bend at the ball.
    function bend(z) { return 1.6 * Math.sin((z + travel) / 6); }
    var here = bend(ballAt);
    function at(z, lateral, h) { return [cx + (lateral + (bend(z) - here) * Math.min(1, (z - 1) / 4)) * half / z, vy + (H * 0.95 - vy - h * H * 0.42) / z]; }
    // The pieces in view, far first.
    var parts = [];
    for (var k = -1; k < 5; k++) {
      PLAT_PIECES.forEach(function (p) {
        var z0 = k * PLAT_LOOP + p.from - travel + 1.2, z1 = k * PLAT_LOOP + p.to - travel + 1.2;
        if (z1 < 0.9 || z0 > 30) return;
        parts.push({ z0: Math.max(0.9, z0), z1: z1, wall: p.wall !== undefined ? k * PLAT_LOOP + p.wall - travel + 1.2 : null, fin: adventure && k % 3 === 2 });
      });
    }
    parts.sort(function (a, b) { return b.z1 - a.z1; });
    parts.forEach(function (p) {
      var a = at(p.z0, -1, 0), b = at(p.z0, 1, 0), c = at(p.z1, 1, 0), d = at(p.z1, -1, 0);
      var a2 = at(p.z0, -1, -0.35), b2 = at(p.z0, 1, -0.35);
      x.globalAlpha = Math.min(1, 6 / p.z1);
      // Front face, then the top with its tiles.
      x.fillStyle = "#010601";
      x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.lineTo(b2[0], b2[1]); x.lineTo(a2[0], a2[1]); x.closePath(); x.fill();
      x.strokeStyle = NEON;
      x.lineWidth = Math.max(1, 2 * s / p.z0);
      x.stroke();
      x.fillStyle = "#031503";
      x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.lineTo(c[0], c[1]); x.lineTo(d[0], d[1]); x.closePath(); x.fill();
      x.stroke();
      x.lineWidth = Math.max(1, 1.2 * s / p.z0);
      for (var z = Math.ceil(p.z0 + travel) - travel; z < p.z1; z += 1) {
        var l = at(z, -1, 0), r = at(z, 1, 0);
        x.globalAlpha = Math.min(1, 3 / z) * 0.6;
        x.beginPath(); x.moveTo(l[0], l[1]); x.lineTo(r[0], r[1]); x.stroke();
      }
      x.globalAlpha = Math.min(1, 6 / p.z1);
      if (p.wall !== null && p.wall > 1) {
        var w0 = at(p.wall, -1, 0), w1 = at(p.wall, 1, 0.55), hgt = w0[1] - w1[1];
        x.fillStyle = "rgba(255,26,16,0.25)";
        x.fillRect(w0[0], w1[1], w1[0] - w0[0], hgt);
        x.strokeStyle = RED;
        x.lineWidth = Math.max(1, 2.5 * s / p.wall);
        x.strokeRect(w0[0], w1[1], w1[0] - w0[0], hgt);
      }
      if (p.fin && p.z1 > 1) {
        // Adventure: a finish gate at the end of every third stretch.
        var g0 = at(p.z1 - 0.5, -1, 0), g1 = at(p.z1 - 0.5, 1, 1.4);
        x.strokeStyle = "#fff";
        x.lineWidth = Math.max(1, 3 * s / p.z1);
        x.strokeRect(g0[0], g1[1], g1[0] - g0[0], g0[1] - g1[1]);
      }
      x.globalAlpha = 1;
    });
    // The ball: up over the gap and the wall.
    var pos = (travel + ballAt - 1.2) % PLAT_LOOP, h = 0;
    function hop(from, to, top) { if (pos > from && pos < to) { var u = (pos - from) / (to - from); h = Math.max(h, 4 * top * u * (1 - u)); } }
    hop(4.6, 9.4, 1.2);
    hop(10.6, 13.6, 1.0);
    var under = at(ballAt, 0, 0), centre = at(ballAt, 0, h + 0.3), r = H * 0.09;
    if (!(pos > 6 && pos < 8.2)) {
      x.fillStyle = "rgba(0,0,0,0.6)";
      x.beginPath(); x.ellipse(under[0], under[1], r * (1 - h * 0.25), r * 0.3, 0, 0, Math.PI * 2); x.fill();
    }
    ball(x, centre[0], centre[1] - r * 0.7, r, s, t);
    label(x, adventure ? "Level " + (1 + Math.floor(t / 4) % 9) : Math.floor(t * speed) + " m", W, s);
  }

  function drawPreview(cv, mode, t) {
    var x = cv.getContext("2d"), W = cv.width, H = cv.height, s = H / 150;
    var effect = mode === "randomizer" ? EFFECTS[Math.floor(t / 1.6) % EFFECTS.length] : null;
    x.save();
    x.fillStyle = "#000";
    x.fillRect(0, 0, W, H);
    if (effect && effect.id === "wobble") {
      x.translate(W / 2, H / 2); x.rotate(Math.sin(t * 3) * 0.12); x.scale(1.15, 1.15); x.translate(-W / 2, -H / 2);
    }
    var speed = effect && effect.id === "slowmo" ? 0.45 : effect && effect.id === "turbo" ? 1.8 : 1;
    var vy = H * 0.3, cx = W / 2, half = H * 0.65;
    function at(z, lateral) { return [cx + lateral * half / z, vy + (H - vy) / z]; }
    // The track: black, neon edges, chevrons coming closer.
    var a = at(1, -1), b = at(1, 1), far = at(40, 0);
    x.fillStyle = "#020a02";
    x.beginPath(); x.moveTo(a[0], H); x.lineTo(far[0] - 1, far[1]); x.lineTo(far[0] + 1, far[1]); x.lineTo(b[0], H); x.closePath(); x.fill();
    x.strokeStyle = NEON;
    x.lineWidth = 2 * s;
    x.beginPath(); x.moveTo(a[0], H); x.lineTo(far[0], far[1]); x.moveTo(b[0], H); x.lineTo(far[0], far[1]); x.stroke();
    var phase = (t * 3 * speed) % 1;
    for (var k = 0; k < 14; k++) {
      var z = 1 + (k + 1 - phase) * 1.6;
      var l = at(z, -0.8), m = at(z + 0.5, 0), r = at(z, 0.8);
      x.globalAlpha = Math.min(1, 3 / z);
      x.lineWidth = Math.max(1, 5 * s / z);
      x.beginPath(); x.moveTo(l[0], l[1]); x.lineTo(m[0], m[1]); x.lineTo(r[0], r[1]); x.stroke();
    }
    x.globalAlpha = 1;
    // Advanced: red obstacles on the way.
    var weave = Math.sin(t * 1.7) * 0.45;
    if (mode === "advanced") {
      for (var j = 0; j < 4; j++) {
        var oz = 1.4 + ((j * 2.3 - t * 2.2) % 9.2 + 9.2) % 9.2;
        var lane = [-0.55, 0.5, 0, -0.2][j], wide = j === 2 ? 0.9 : 0.32;
        var p0 = at(oz, lane - wide / 2), p1 = at(oz, lane + wide / 2);
        var hgt = (j === 2 ? 10 : 28) * s / oz * 2.2;
        x.fillStyle = "rgba(255,26,16,0.25)";
        x.fillRect(p0[0], p0[1] - hgt, p1[0] - p0[0], hgt);
        x.strokeStyle = RED;
        x.lineWidth = Math.max(1, 2.5 * s / oz);
        x.strokeRect(p0[0], p0[1] - hgt, p1[0] - p0[0], hgt);
      }
      weave = Math.sin(t * 2.4) * 0.5;
    }
    // Randomizer: gem rain, a dark veil, then the effect's name. Gem Rush:
    // gems all the way, drifting towards the ball.
    var rushing = mode === "rush";
    if (rushing || (effect && (effect.id === "gemrain" || effect.id === "double" || effect.id === "magnet" || effect.id === "jackpot"))) {
      for (var g = 0; g < (rushing ? 16 : 9); g++) {
        var gz = 1.3 + ((g * (rushing ? 0.6 : 1.1) - t * 2.5) % 9 + 9) % 9, lat = ((g * 0.37) % 1.4) - 0.7;
        if (rushing) lat += (weave * 0.8 - lat) * Math.max(0, 1 - (gz - 1.3) / 3);   // pulled to the ball as they come close
        var gp = at(gz, lat);
        var gs = 9 * s / gz * 2;
        x.fillStyle = NEON;
        x.beginPath(); x.moveTo(gp[0], gp[1] - gs * 2); x.lineTo(gp[0] + gs, gp[1] - gs); x.lineTo(gp[0], gp[1]); x.lineTo(gp[0] - gs, gp[1] - gs); x.closePath(); x.fill();
      }
    }
    // Legacy: the ball swings wide and lags behind, with a trail as it slides.
    if (mode === "legacy") weave = Math.sin(t * 1.3 - 0.6) * 0.6;
    // The ball.
    var bx = cx + weave * half * 0.8, by = H * 0.8, br = H * 0.1;
    if (effect && effect.id === "mirror") bx = cx - weave * half * 0.8;
    if (mode === "legacy") {
      for (var tr = 4; tr >= 1; tr--) {
        var px = cx + Math.sin(t * 1.3 - 0.6 - tr * 0.12) * 0.6 * half * 0.8;
        x.globalAlpha = 0.12 * (5 - tr);
        x.strokeStyle = NEON;
        x.lineWidth = 2 * s;
        x.beginPath(); x.arc(px, by, br, 0, Math.PI * 2); x.stroke();
      }
      x.globalAlpha = 1;
    }
    x.fillStyle = "#000";
    x.beginPath(); x.arc(bx, by, br, 0, Math.PI * 2); x.fill();
    x.strokeStyle = NEON;
    x.lineWidth = 2 * s;
    x.beginPath(); x.arc(bx, by, br, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.ellipse(bx, by, br * Math.abs(Math.cos(t * 4)), br, 0, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.moveTo(bx - br, by); x.lineTo(bx + br, by); x.stroke();
    if (effect && effect.id === "blackout") {
      var v = x.createRadialGradient(bx, by - br, br * 1.5, bx, by - br, br * 4);
      v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.96)");
      x.fillStyle = v; x.fillRect(0, 0, W, H);
    }
    x.restore();
    if (mode === "legacy") {
      x.save();
      x.font = (18 * s) + 'px "Slope Chargen", monospace';
      x.textAlign = "center";
      x.fillStyle = NEON;
      x.fillText("Original steering", W / 2, 24 * s);
      x.restore();
    }
    if (rushing) {
      // The countdown, looping.
      x.save();
      x.font = (18 * s) + 'px "Slope Chargen", monospace';
      x.textAlign = "center";
      x.fillStyle = NEON;
      x.fillText("0:" + ("0" + (59 - Math.floor(t * 4) % 60)).slice(-2), W / 2, 24 * s);
      x.restore();
    }
    if (effect) {
      x.save();
      if (effect.id === "blur") { x.filter = "blur(" + (2 * s) + "px)"; x.drawImage(cv, 0, 0); x.filter = "none"; }
      x.font = (18 * s) + 'px "Slope Chargen", monospace';
      x.textAlign = "center";
      x.fillStyle = effect.good ? NEON : RED;
      x.fillText(effect.name, W / 2, 24 * s);
      x.restore();
    }
  }

  window.SlopeUI.ready(build);

  window.SlopeModes = {
    current: function () { return current; },
    chosen: function () { return chosen; },
    active: function (id) {
      if (current === "rush") return !rush.over && game.inRun() && (id === "gemrain" || id === "magnet");
      return current === "randomizer" && effectActive(id);
    },
    // Starts an effect now, in a Randomizer run (for tools and tests).
    trigger: function (id) {
      if (current !== "randomizer" || !game.inRun()) return false;
      endEffect();
      startEffect(byId(EFFECTS, id));
      return true;
    },
    effects: EFFECTS,
    open: function (from) { open(from); },
    play: function (id) { play(id); },
    modes: MODES
  };
})();
