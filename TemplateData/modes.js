/*
 * Game modes. The main menu's Play button opens a picker (the game signals
 * #slope-play, tools/patch_play.py) with a moving preview of each mode; the
 * run starts in the chosen mode, and Again keeps it.
 *
 *   Classic      the game as it is
 *   Randomizer   every few seconds a random effect for a short while: some
 *                help (slow motion, gem rain, a magnet, double gems, a
 *                jackpot), some hurt (fast forward, mirrored steering, a
 *                blackout, a wobbling or blurred screen)
 *   Advanced     every obstacle and slope from the Adventure levels,
 *                endlessly, closer and quicker the further the ball gets
 *                (adventure.js)
 *
 *   SlopeModes.current()        the mode of the run being played
 *   SlopeModes.active(effect)   true while a Randomizer effect is on
 *   SlopeModes.open(from)       shows the picker
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var STORAGE_KEY = "slope-mode";
  var MODES = [
    { id: "classic", name: "Classic", text: "The original: the slope, your ball and nothing else in the way." },
    { id: "randomizer", name: "Randomizer", text: "Every few seconds a random effect for a short while. Some help you, some get in your way." },
    { id: "advanced", name: "Advanced", text: "Every obstacle and slope from the Adventure levels, all the way down: closer together and quicker the further you get." }
  ];

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
  var GAP = [3, 6];               // seconds between effects
  var JACKPOT_GEMS = 15;

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  var chosen = "classic";
  try { chosen = byId(MODES, localStorage.getItem(STORAGE_KEY)).id; } catch (e) {}
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
    // An Adventure level is its own thing; anything else plays the chosen mode.
    current = adventureRun() ? null : chosen;
    fx.clock = 0;
    fx.last = null;
    fx.previous = null;
    fx.next = FIRST_EFFECT;
  });

  game.on("runend", function (e) {
    var mode = current;
    stopRandomizer();
    if (mode && profile.recordModeRun) {
      var dodged = mode === "advanced" && window.SlopeAdventure && window.SlopeAdventure.dodged ? window.SlopeAdventure.dodged() : 0;
      profile.recordModeRun(mode, e ? e.score : 0, { dodged: dodged });
    }
  });
  game.on("menu", function () { stopRandomizer(); });

  function choose(id) {
    chosen = byId(MODES, id).id;
    try { localStorage.setItem(STORAGE_KEY, chosen); } catch (e) {}
    if (window.SlopeAdventure && window.SlopeAdventure.setEndless) window.SlopeAdventure.setEndless(chosen === "advanced");
  }
  choose(chosen);

  // --- Picker ---------------------------------------------------------------------

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
        '<p class="slope-shop-note">Pick a mode. Again on the score screen plays the same one.</p>' +
        '<ul class="slope-modes-list">' +
          MODES.map(function (m) {
            return '<li class="slope-mode" data-mode="' + m.id + '">' +
              '<canvas class="slope-mode-preview" aria-hidden="true"></canvas>' +
              '<h3 class="slope-mode-name">' + m.name + "</h3>" +
              '<p class="slope-mode-text">' + m.text + "</p>" +
              '<p class="slope-mode-best"></p>' +
              '<button type="button" class="slope-btn slope-mode-play">Play ' + m.name + "</button>" +
            "</li>";
          }).join("") +
        "</ul>" +
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
      cards: MODES.map(function (m) {
        var li = screen.querySelector('[data-mode="' + m.id + '"]');
        return { mode: m, li: li, canvas: li.querySelector("canvas"), best: li.querySelector(".slope-mode-best"), play: li.querySelector("button") };
      })
    };
    els.cards.forEach(function (card) {
      var scale = Math.min(2, window.devicePixelRatio || 1);
      card.canvas.width = Math.round(240 * scale);
      card.canvas.height = Math.round(150 * scale);
      card.play.addEventListener("click", function () { play(card.mode.id); });
      card.li.addEventListener("pointerenter", function () { mark(card.mode.id); });
    });
    els.back.addEventListener("click", close);
    screen.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  function mark(id) {
    els.cards.forEach(function (c) { c.li.classList.toggle("is-chosen", c.mode.id === id); });
  }

  function renderBest() {
    var stats = profile.get().modes || {};
    els.cards.forEach(function (c) {
      var s = stats[c.mode.id];
      c.best.textContent = s && s.runs ? "Best " + s.best + "  ·  " + s.runs + (s.runs === 1 ? " run" : " runs") : "Not played yet";
    });
  }

  function open(from) {
    if (!els) return;
    openedFrom = from || null;
    window.SlopeUI.closeSettings();
    var toast = window.SlopeUI.root.querySelector(".slope-toast");
    if (toast) toast.hidden = true;
    renderBest();
    mark(chosen);
    els.screen.hidden = false;
    els.screen.scrollTop = 0;
    if (game.pause) game.pause("modes");
    startedAt = performance.now();
    if (!loop) loop = requestAnimationFrame(tick);
    var card = els.cards.filter(function (c) { return c.mode.id === chosen; })[0];
    if (card) card.play.focus({ preventScroll: true });
  }

  function close() {
    els.screen.hidden = true;
    if (game.resume) game.resume("modes");
    if (openedFrom && document.contains(openedFrom)) openedFrom.focus();
    else if (els.screen.contains(document.activeElement)) document.activeElement.blur();
    openedFrom = null;
  }

  function play(id) {
    choose(id);
    close();
    game.send("resetPressed");
  }

  game.on("play", function () { open(null); });

  // --- Previews ----------------------------------------------------------------------
  // The track drawn in perspective, rushing towards the viewer, with the ball
  // weaving along it; Randomizer flashes its effects, Advanced brings obstacles.

  var NEON = "#00ff00", RED = "#ff1a10";
  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var lastDraw = 0;

  function tick(now) {
    loop = 0;
    if (!els || els.screen.hidden) return;
    if (now - lastDraw >= 33) {
      lastDraw = now;
      var t = reduceMotion.matches ? 1.2 : (now - startedAt) / 1000;
      els.cards.forEach(function (c) { drawPreview(c.canvas, c.mode.id, t); });
    }
    loop = requestAnimationFrame(tick);
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
    var vy = H * 0.3, cx = W / 2, half = W * 0.42;
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
    // Randomizer: gem rain, a dark veil, then the effect's name.
    if (effect && (effect.id === "gemrain" || effect.id === "double" || effect.id === "magnet" || effect.id === "jackpot")) {
      for (var g = 0; g < 9; g++) {
        var gz = 1.3 + ((g * 1.1 - t * 2.5) % 9 + 9) % 9, gp = at(gz, ((g * 0.37) % 1.4) - 0.7);
        var gs = 9 * s / gz * 2;
        x.fillStyle = NEON;
        x.beginPath(); x.moveTo(gp[0], gp[1] - gs * 2); x.lineTo(gp[0] + gs, gp[1] - gs); x.lineTo(gp[0], gp[1]); x.lineTo(gp[0] - gs, gp[1] - gs); x.closePath(); x.fill();
      }
    }
    // The ball.
    var bx = cx + weave * half * 0.8, by = H * 0.8, br = H * 0.1;
    if (effect && effect.id === "mirror") bx = cx - weave * half * 0.8;
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
    active: function (id) { return current === "randomizer" && effectActive(id); },
    // Starts an effect now, in a Randomizer run (for tools and tests).
    trigger: function (id) {
      if (current !== "randomizer" || !game.inRun()) return false;
      endEffect();
      startEffect(byId(EFFECTS, id));
      return true;
    },
    effects: EFFECTS,
    open: function (from) { open(from); }
  };
})();
