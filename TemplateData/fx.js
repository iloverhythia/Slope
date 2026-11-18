/*
 * The Randomizer's effects (modes.js picks one every few seconds and plays
 * it): 120 of them, each made of a few parts:
 *
 *   speed      the game's clock (slow motion, fast forward, stop and go...)
 *   filter     colours on the game's canvas (noir, negative, night vision...)
 *   transform  the game's canvas moved (upside down, spinning, shaking...)
 *   overlay    things drawn over the game (snow, rain, confetti, fireworks,
 *              the Matrix, a sniper scope...), in a canvas of their own
 *   veil       dark everywhere but a hole round the ball (Blackout, Spotlight)
 *   steer      the steering keys (mirrored, late, slippery, gusts, dropping
 *              out), through steer.js
 *   gems       what gems are worth, how many there are, how far they are
 *              pulled and how lucky they are (gems.js asks modes.js)
 *   gift       something for free at the start (gems, pinball tickets, Core
 *              Clicker energy, ball XP); every: again and again while it lasts
 *
 * Effects that flash are left out when the system asks for reduced motion,
 * and nothing flashes more than three times a second.
 *
 *   SlopeFx.list               the effects (id, name, text, good, seconds, ...)
 *   SlopeFx.start(e) / frame(e, t, info) / end(e)   (modes.js)
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game) return;

  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function hr(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }   // a steady random number for n
  function deg(x) { return x.toFixed(2) + "deg"; }
  function px(x) { return x.toFixed(1) + "px"; }
  function hueCycle(perSecond, extra) { return function (t) { return "hue-rotate(" + Math.round(t * perSecond) % 360 + "deg) " + (extra || ""); }; }

  function worth() { return window.SlopeGems && window.SlopeGems.worth ? Math.max(1, window.SlopeGems.worth(0)) : 1; }
  function giveGems(n) { if (profile && profile.addGems) profile.addGems(worth() * n); }

  // --- The effects ---------------------------------------------------------------------

  var LIST = [];
  function fx(id, name, text, good, seconds, spec) {
    var e = spec || {};
    e.id = id; e.name = name; e.text = text; e.good = good; e.seconds = seconds;
    LIST.push(e);
  }

  // The first ten.
  fx("slowmo", "Slow-mo", "Everything slows down", true, 6, { speed: 0.55 });
  fx("gemrain", "Gem rain", "Three times the gems", true, 7, { gems: { density: 3 } });
  fx("magnet", "Magnet", "Gems fly to you", true, 7, { gems: { reach: 1.5 } });
  fx("double", "Double gems", "Every gem counts twice", true, 7, { gems: { worth: 2 } });
  fx("jackpot", "Jackpot", "Free gems", true, 2.5, { gift: function () { giveGems(15); } });
  fx("turbo", "Turbo", "Everything speeds up", false, 5, { speed: 1.35 });
  fx("mirror", "Mirror", "Left is right, right is left", false, 5, { steer: { mirror: true } });
  fx("blackout", "Blackout", "The lights go out", false, 5, { veil: 0.2 });
  fx("wobble", "Wobble", "The world sways", false, 6, { transform: function (t) { return "rotate(" + deg(Math.sin(t * 2.1) * 7) + ") scale(1.15)"; } });
  fx("blur", "Blur", "Where are your glasses?", false, 5, { filter: "blur(3px)" });

  // Time.
  fx("bullettime", "Bullet time", "Time almost stops", true, 5, { speed: 0.35, filter: "saturate(0.6) contrast(1.15)" });
  fx("halftime", "Half time", "A little slower", true, 6, { speed: 0.75 });
  fx("calm", "Calm", "Slow and easy", true, 6, { speed: 0.85, filter: "brightness(1.1) saturate(0.9)" });
  fx("zen", "Zen", "Breathe in, breathe out", true, 6, { speed: 0.7, overlay: "aurora" });
  fx("brakes", "Brakes", "Slowing right down", true, 6, { speed: function (t) { return 1.3 - 0.7 * Math.min(1, t / 6); } });
  fx("molasses", "Molasses", "Thick and slow", true, 5, { speed: 0.5, filter: "sepia(0.5) saturate(1.3)" });
  fx("secondwind", "Second wind", "Slower for a moment", true, 4, { speed: 0.6, filter: "brightness(1.15)" });
  fx("hyperdrive", "Hyperdrive", "Hold on tight", false, 4, { speed: 1.55, overlay: "meteors" });
  fx("warp", "Warp speed", "The stars stretch past", false, 4, { speed: 1.45, overlay: "warp", transform: "scale(1.08)" });
  fx("accelerator", "Accelerator", "Faster and faster", false, 6, { speed: function (t) { return 1 + 0.6 * Math.min(1, t / 6); } });
  fx("stopgo", "Stop and go", "Slow, fast, slow, fast", false, 6, { speed: function (t) { return Math.floor(t / 0.8) % 2 ? 1.3 : 0.5; } });
  fx("jitter", "Jittery clock", "Time can't make up its mind", false, 5, { speed: function (t) { return 0.7 + 0.7 * hr(Math.floor(t / 0.3)); } });
  function beat(t) { return Math.pow(Math.abs(Math.sin(t * Math.PI * 1.2)), 8); }
  fx("heartbeat", "Heartbeat", "Ba-dum, ba-dum", false, 6, { speed: function (t) { return 1 + 0.25 * beat(t); }, transform: function (t) { return "scale(" + (1 + 0.06 * beat(t)).toFixed(3) + ")"; } });

  // Colours.
  fx("negative", "Negative", "Everything inverted", false, 5, { filter: "invert(1)" });
  fx("noir", "Film noir", "Black and white", true, 6, { filter: "grayscale(1) contrast(1.3)" });
  fx("oldmovie", "Old movie", "Sepia and scratches", true, 6, { filter: "sepia(1) contrast(1.1)", overlay: "grain" });
  fx("rainbowroad", "Rainbow road", "Colours on the move", true, 6, { filter: hueCycle(120, "saturate(1.6)") });
  fx("opposite", "Opposite day", "Every colour flipped", true, 5, { filter: "hue-rotate(180deg)" });
  fx("vivid", "Vivid", "Turn up the colour", true, 6, { filter: "saturate(3)" });
  fx("washedout", "Washed out", "Where did the colour go?", true, 6, { filter: "saturate(0.2) brightness(1.2)" });
  fx("hardlight", "Hard light", "Contrast turned up", true, 5, { filter: "contrast(2)" });
  fx("neonpop", "Neon pop", "Extra glow", true, 6, { filter: "saturate(2.2) contrast(1.35) brightness(1.1)" });
  fx("sunset", "Sunset", "Golden evening light", true, 6, { filter: "sepia(0.5) hue-rotate(-25deg) saturate(1.7)" });
  fx("dusk", "Dusk", "It's getting dark", false, 6, { filter: "brightness(0.45)" });
  fx("overexposed", "Overexposed", "Too bright!", false, 5, { filter: "brightness(1.9) contrast(0.8)" });
  fx("nightvision", "Night vision", "Green and grainy", false, 6, { filter: "grayscale(1) sepia(1) hue-rotate(50deg) saturate(3) brightness(1.1)", overlay: "grain" });
  fx("thermal", "Thermal camera", "Hot and cold", false, 5, { filter: "invert(1) hue-rotate(180deg) saturate(4) contrast(1.3)" });
  fx("xray", "X-ray", "See right through", false, 5, { filter: "invert(1) grayscale(1) contrast(1.6)" });
  fx("colourstorm", "Colour storm", "Colours everywhere", false, 5, { filter: hueCycle(540, "saturate(2.5)") });
  fx("flicker", "Flickering lights", "Bad wiring", false, 5, { flashy: true, filter: function (t) { return "brightness(" + (0.35 + 0.8 * hr(Math.floor(t * 3))).toFixed(2) + ")"; } });
  fx("pulse", "Pulse", "The lights pulse in and out", false, 6, { filter: function (t) { return "brightness(" + (1 + 0.45 * Math.sin(t * 4)).toFixed(2) + ")"; } });
  fx("deepfreeze", "Deep freeze", "Cold, snowy and slippery", false, 6, { filter: "hue-rotate(180deg) saturate(0.5) brightness(1.25)", overlay: "snow", steer: { ice: 0.3 } });
  fx("thickfog", "Thick fog", "Can't see a thing", false, 6, { filter: "blur(2px) brightness(1.1)", overlay: "fog" });
  fx("daydream", "Daydream", "Soft and fuzzy", false, 5, { filter: "blur(2px) brightness(1.15) saturate(1.4)", overlay: "bubbles" });
  fx("haunted", "Haunted", "Something's out there", false, 6, { flashy: true, overlay: "fog",
    filter: function (t) { return "grayscale(0.85) brightness(" + (0.55 + 0.4 * hr(Math.floor(t * 2.5))).toFixed(2) + ")"; } });

  // The screen moves.
  fx("mirrorworld", "Mirror world", "The screen flips sideways", false, 5, { transform: "scaleX(-1)" });
  fx("lookingglass", "Looking glass", "Flipped screen, flipped steering", false, 5, { transform: "scaleX(-1)", steer: { mirror: true } });
  fx("upsidedown", "Upside down", "Which way is up?", false, 5, { transform: "rotate(180deg)" });
  fx("topsyturvy", "Topsy-turvy", "Upside down, steering flipped", false, 5, { transform: "rotate(180deg)", steer: { mirror: true } });
  fx("tilt", "Tilt", "Leaning left", false, 5, { transform: "rotate(-14deg) scale(1.25)" });
  fx("lean", "Lean", "Leaning right", false, 5, { transform: "rotate(14deg) scale(1.25)" });
  fx("spincycle", "Spin cycle", "Round and round", false, 6, { transform: function (t) { return "rotate(" + deg(t * 60) + ") scale(1.35)"; } });
  fx("closeup", "Close-up", "Zoomed right in", false, 5, { transform: "scale(1.6)" });
  fx("birdseye", "Bird's eye", "Zoomed way out", false, 5, { transform: "scale(0.6)" });
  fx("tinyworld", "Tiny world", "Who shrank the screen?", false, 5, { transform: "scale(0.4)" });
  fx("squashed", "Squashed", "Flat as a pancake", false, 5, { transform: "scaleY(0.55)" });
  fx("skinny", "Skinny", "Squeezed thin", false, 5, { transform: "scaleX(0.55)" });
  fx("shakycam", "Shaky cam", "Hold the camera still!", false, 5, { transform: function () { return "translate(" + px(rnd(-8, 8)) + "," + px(rnd(-8, 8)) + ") scale(1.05)"; } });
  fx("earthquake", "Earthquake", "The ground is shaking", false, 4, { transform: function () { return "translate(" + px(rnd(-22, 22)) + "," + px(rnd(-22, 22)) + ") rotate(" + deg(rnd(-2, 2)) + ") scale(1.1)"; } });
  fx("sway", "Sway", "Side to side", false, 6, { transform: function (t) { return "translateX(" + px(Math.sin(t * 2.4) * 70) + ")"; } });
  fx("bouncy", "Bouncy screen", "Boing, boing, boing", false, 6, { transform: function (t) { return "translateY(" + px(-Math.abs(Math.sin(t * 4)) * 45) + ")"; } });
  fx("breathing", "Breathing", "In and out", false, 6, { transform: function (t) { return "scale(" + (1.08 + 0.12 * Math.sin(t * 2.5)).toFixed(3) + ")"; } });
  fx("funhouse", "Funhouse", "A warped mirror", false, 6, { transform: function (t) { return "skewX(" + deg(Math.sin(t * 1.8) * 18) + ") scale(1.15)"; } });
  fx("seasick", "Seasick", "Rough seas ahead", false, 6, { transform: function (t) { return "rotate(" + deg(Math.sin(t * 1.3) * 9) + ") translateY(" + px(Math.sin(t * 2.1) * 30) + ") scale(1.2)"; } });
  fx("dizzy", "Dizzy", "Everything's spinning", false, 5, { transform: function (t) { return "rotate(" + deg(Math.sin(t * 3) * 11) + ") scale(1.2)"; }, filter: "blur(1.5px)" });

  // Things over the game.
  fx("snowfall", "Snowfall", "A winter wonderland", true, 7, { overlay: "snow" });
  fx("downpour", "Downpour", "Bring an umbrella", false, 6, { overlay: "rain", filter: "brightness(0.85) saturate(0.8)" });
  fx("thunderstorm", "Thunderstorm", "Rain and lightning", false, 6, { flashy: true, overlay: ["rain", "lightning"], filter: "brightness(0.7)" });
  fx("confetti", "Confetti", "Party time!", true, 6, { overlay: "confetti" });
  fx("party", "Party mode", "Confetti and colours", true, 6, { overlay: "confetti", filter: hueCycle(200, "saturate(1.8)") });
  fx("disco", "Disco", "The lights are going", false, 5, { flashy: true, overlay: "strobe", filter: function (t) { return "hue-rotate(" + (Math.floor(t * 2) * 90) % 360 + "deg) saturate(2)"; } });
  fx("bubblebath", "Bubble bath", "Bubbles everywhere", true, 6, { overlay: "bubbles" });
  fx("underwater", "Underwater", "Slow, blue and bubbly", true, 6, { overlay: "bubbles", filter: "hue-rotate(160deg) blur(1px) brightness(0.9)", speed: 0.8 });
  fx("fireflies", "Fireflies", "A summer night", true, 7, { overlay: "fireflies", filter: "brightness(0.7)" });
  fx("love", "Love is in the air", "Hearts everywhere", true, 6, { overlay: "hearts" });
  fx("autumn", "Autumn", "Falling leaves", true, 7, { overlay: "leaves", filter: "sepia(0.3) saturate(1.3)" });
  fx("volcano", "Volcano", "Hot, hot, hot", false, 6, { overlay: "embers", filter: "sepia(0.6) hue-rotate(-30deg) saturate(2)",
    transform: function () { return "translate(" + px(rnd(-3, 3)) + "," + px(rnd(-3, 3)) + ")"; } });
  fx("glitter", "Glitter", "Sparkly!", true, 6, { overlay: "glitter" });
  fx("meteorshower", "Meteor shower", "Make a wish", true, 6, { overlay: "meteors", filter: "brightness(0.8)" });
  fx("matrix", "The Matrix", "Follow the green rain", false, 6, { overlay: "matrix", filter: "grayscale(1) sepia(1) hue-rotate(70deg) saturate(4) brightness(0.8)" });
  fx("deepspace", "Deep space", "Out among the stars", true, 6, { overlay: "stars", filter: "brightness(0.65) saturate(1.3)" });
  fx("northernlights", "Northern lights", "Ribbons in the sky", true, 7, { overlay: "aurora", filter: "brightness(0.85)" });
  fx("arcade", "Arcade", "Insert coin", true, 6, { overlay: "scanlines", filter: "saturate(2) contrast(1.3)" });
  fx("badsignal", "Bad signal", "Static on the line", false, 5, { flashy: true, overlay: "static", filter: function (t) { return "brightness(" + (0.7 + 0.45 * hr(Math.floor(t * 3))).toFixed(2) + ")"; } });
  fx("tunnelvision", "Tunnel vision", "The edges go dark", false, 6, { overlay: "vignette" });
  fx("cinema", "Cinema", "Widescreen", false, 6, { overlay: "letterbox" });
  fx("binoculars", "Binoculars", "Looking far ahead", false, 5, { overlay: "binoculars", transform: "scale(1.3)" });
  fx("scope", "Sniper scope", "Steady... steady...", false, 5, { overlay: "scope", transform: "scale(1.2)" });
  fx("spotlight", "Spotlight", "You're on stage", false, 5, { veil: 0.12 });
  fx("strobe", "Strobe", "Flash, flash, flash", false, 4, { flashy: true, overlay: "strobe" });
  fx("hypnotised", "Hypnotised", "You are getting sleepy", false, 5, { overlay: "spiral", transform: function (t) { return "rotate(" + deg(Math.sin(t * 2) * 5) + ") scale(1.1)"; } });
  fx("lasershow", "Laser show", "Beams everywhere", false, 6, { overlay: "lasers", filter: "brightness(0.8)" });
  fx("fireworks", "Fireworks", "Ooh, aah", true, 6, { overlay: "fireworks", filter: "brightness(0.75)" });

  // The steering keys.
  fx("confusion", "Confusion", "The mirror keeps flipping", false, 6, { steer: { flicker: 1.2 } });
  fx("lag", "Lag", "Your keys arrive late", false, 5, { steer: { lag: 0.25 } });
  fx("satellite", "Satellite delay", "Very, very late", false, 5, { steer: { lag: 0.5 } });
  fx("slippery", "Slippery", "Turns keep sliding", false, 6, { steer: { ice: 0.3 } });
  fx("icerink", "Ice rink", "Like skating on ice", false, 6, { steer: { ice: 0.6 }, filter: "hue-rotate(170deg) saturate(0.6) brightness(1.2)" });
  fx("crosswind", "Crosswind", "Gusts from the right", false, 6, { steer: { drift: -1 }, overlay: "wind" });
  fx("gale", "Gale", "Gusts from the left", false, 6, { steer: { drift: 1 }, overlay: "wind" });
  fx("butterfingers", "Butterfingers", "Your keys keep slipping", false, 6, { steer: { stutter: true } });
  fx("backwards", "Backwards day", "Steering flipped, the world rocking", false, 5, { steer: { mirror: true }, transform: function (t) { return "rotate(" + deg(Math.sin(t * 1.5) * 6) + ")"; } });

  // Gems.
  fx("triplegems", "Triple gems", "Every gem counts three times", true, 6, { gems: { worth: 3 } });
  fx("gemfever", "Gem fever", "Gems are worth five times as much", true, 4, { gems: { worth: 5 } });
  fx("luckystreak", "Lucky streak", "Rare gems turn up more", true, 7, { gems: { luck: 0.5 } });
  fx("goldenhour", "Golden hour", "Golden gems everywhere", true, 6, { gems: { luck: 1 }, filter: "sepia(0.4) saturate(1.5) brightness(1.05)" });
  fx("rarehunt", "Rare hunt", "The rarest gems come out", true, 6, { gems: { luck: 2 } });
  fx("gemfrenzy", "Gem frenzy", "More gems, and they fly to you", true, 6, { gems: { density: 3, reach: 1.5 } });
  fx("megamagnet", "Mega magnet", "Every gem nearby is yours", true, 6, { gems: { reach: 3 } });
  fx("gemstorm", "Gem storm", "Five times the gems", true, 4, { gems: { density: 5 } });
  fx("drought", "Gem drought", "No new gems for now", false, 6, { gems: { density: 0 } });
  fx("megajackpot", "Mega jackpot", "A pile of free gems", true, 2.5, { gift: function () { giveGems(60); } });
  fx("pocketchange", "Pocket change", "A few free gems", true, 2.5, { gift: function () { giveGems(5); } });
  fx("treasure", "Treasure chest", "Free gems inside", true, 2.5, { gift: function () { giveGems(25); } });
  fx("gemshower", "Gem shower", "Gems keep coming", true, 5, { every: [0.4, function () { giveGems(1); }] });
  fx("moneyrain", "Money rain", "Double gems, and it's raining gold", true, 6, { gems: { worth: 2 }, overlay: "coins" });
  fx("pinata", "Pinata", "Confetti and free gems", true, 3, { overlay: "confetti", gift: function () { giveGems(20); } });

  // Gifts for the minigames.
  fx("tickets", "Pinball tickets", "Free tickets for Neon Pinball", true, 2.5, { needs: "SlopePinball", gift: function () { window.SlopePinball.give(25); } });
  fx("powersurge", "Power surge", "A minute of Core Clicker energy", true, 2.5, { needs: "SlopeClicker",
    gift: function () { var c = window.SlopeClicker; c.give(Math.max(500, c.state().cps * 60)); } });
  fx("balltrainer", "Ball trainer", "Ball XP for the ball you wear", true, 2.5, { gift: function () { if (profile && profile.addBallXp) profile.addBallXp(40); } });

  // The ones that can play here: no flashing with reduced motion, and only
  // minigames that are on the page.
  function playable(e) { return !(e.flashy && reduceMotion.matches) && (!e.needs || !!window[e.needs]); }

  // --- The game's canvas: filter and transform ----------------------------------------------

  function canvas() { return document.getElementById("#canvas"); }
  function value(v, t) { return typeof v === "function" ? v(t) : v; }

  // --- The veil: dark everywhere but round the ball ---------------------------------------------

  var veil = null;
  function ballScreen(info) {
    var c = canvas();
    if (!c || !info || !info.vp || !info.ball || !info.ball.world) return null;
    var w = info.ball.world, m = info.vp;
    var cx = m[0] * w[0] + m[4] * w[1] + m[8] * w[2] + m[12], cy = m[1] * w[0] + m[5] * w[1] + m[9] * w[2] + m[13];
    var cw = m[3] * w[0] + m[7] * w[1] + m[11] * w[2] + m[15];
    if (cw <= 0) return null;
    var r = c.getBoundingClientRect();
    return { x: r.left + (cx / cw * 0.5 + 0.5) * r.width, y: r.top + (0.5 - cy / cw * 0.5) * r.height, h: r.height };
  }
  function showVeil(size, info) {
    if (!veil) {
      veil = document.createElement("div");
      veil.className = "slope-veil";
      (window.SlopeUI && window.SlopeUI.root || document.body).appendChild(veil);
    }
    veil.hidden = false;
    var b = ballScreen(info);
    if (b) {
      veil.style.setProperty("--x", b.x.toFixed(0) + "px");
      veil.style.setProperty("--y", (b.y - b.h * 0.12).toFixed(0) + "px");
      veil.style.setProperty("--r", (b.h * size).toFixed(0) + "px");
    }
  }

  // --- Overlays: a canvas of their own over the game -------------------------------------------

  var layer = null, ctx = null, W = 0, H = 0, parts = [], carry = {};
  function ensureLayer() {
    if (!layer) {
      layer = document.createElement("canvas");
      layer.className = "slope-fx-layer";
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
      ctx = layer.getContext("2d");
    }
    var k = Math.min(1.5, window.devicePixelRatio || 1), w = Math.round(window.innerWidth * k), h = Math.round(window.innerHeight * k);
    if (layer.width !== w || layer.height !== h) { layer.width = w; layer.height = h; }
    W = window.innerWidth; H = window.innerHeight;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    layer.hidden = false;
  }
  function clearLayer() {
    parts = []; carry = {};
    if (layer) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, layer.width, layer.height); layer.hidden = true; }
  }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function heart(x, y, s) {
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.35);
    ctx.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.4, y - s, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.4, y - s, x + s, y - s * 0.4, x, y + s * 0.35); ctx.fill();
  }
  var CONFETTI = ["#ff3b3b", "#ffd43b", "#3bff6e", "#3bd5ff", "#ff5bd8", "#9b5bff"];
  var GLYPHS = "01ABCDEF<>*+=#$%".split("");

  // Particles: how many a second (on a 1000 px wide screen), how each starts, and how it looks.
  var PARTS = {
    snow: { rate: 70, make: function () { return { x: rnd(-20, W + 20), y: -10, vx: rnd(-15, 15), vy: rnd(40, 95), r: rnd(1.5, 4), life: 30 }; },
      draw: function (p, t) { ctx.fillStyle = "rgba(255,255,255,0.85)"; circle(p.x + Math.sin(t * 1.5 + p.r * 3) * 10, p.y, p.r); } },
    rain: { rate: 260, make: function () { return { x: rnd(-40, W + 40), y: -20, vx: -120, vy: rnd(900, 1300), life: 3 }; },
      draw: function (p) { ctx.strokeStyle = "rgba(160,200,255,0.55)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 4, p.y + 16); ctx.stroke(); } },
    confetti: { rate: 90, make: function () { return { x: rnd(0, W), y: -10, vx: rnd(-60, 60), vy: rnd(90, 200), a: rnd(0, 6), va: rnd(-8, 8), c: CONFETTI[Math.floor(Math.random() * 6)], life: 20 }; },
      draw: function (p, t, dt) { p.a += p.va * dt; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-5, -3 * Math.abs(Math.cos(p.a * 2)), 10, 6 * Math.abs(Math.cos(p.a * 2)) + 1); ctx.restore(); } },
    bubbles: { rate: 25, make: function () { return { x: rnd(0, W), y: H + 20, vx: rnd(-10, 10), vy: -rnd(50, 120), r: rnd(6, 22), life: 30 }; },
      draw: function (p, t) { ctx.strokeStyle = "rgba(200,240,255,0.7)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x + Math.sin(t * 2 + p.r) * 8, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.5)"; circle(p.x + Math.sin(t * 2 + p.r) * 8 - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.2); } },
    fireflies: { rate: 6, max: 40, make: function () { return { x: rnd(0, W), y: rnd(H * 0.2, H), vx: rnd(-25, 25), vy: rnd(-25, 25), ph: rnd(0, 6), life: 12 }; },
      draw: function (p, t) { var g = 0.5 + 0.5 * Math.sin(t * 3 + p.ph); p.vx += rnd(-40, 40) * 0.016; p.vy += rnd(-40, 40) * 0.016;
        ctx.fillStyle = "rgba(255,240,120," + (0.25 * g).toFixed(2) + ")"; circle(p.x, p.y, 9); ctx.fillStyle = "rgba(255,250,170," + (0.6 + 0.4 * g).toFixed(2) + ")"; circle(p.x, p.y, 2.5); } },
    hearts: { rate: 14, make: function () { return { x: rnd(0, W), y: H + 20, vx: rnd(-15, 15), vy: -rnd(60, 130), s: rnd(8, 18), life: 20 }; },
      draw: function (p, t) { ctx.fillStyle = "rgba(255,90,150,0.85)"; heart(p.x + Math.sin(t * 2 + p.s) * 10, p.y, p.s); } },
    leaves: { rate: 18, make: function () { return { x: rnd(-20, W), y: -20, vx: rnd(10, 50), vy: rnd(50, 110), a: rnd(0, 6), s: rnd(6, 11), c: ["#e0702a", "#c8401f", "#e8b23a", "#9b5a2a"][Math.floor(Math.random() * 4)], life: 20 }; },
      draw: function (p, t, dt) { p.a += dt * 2; ctx.save(); ctx.translate(p.x + Math.sin(t * 1.5 + p.s) * 20, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); } },
    embers: { rate: 50, make: function () { return { x: rnd(0, W), y: H + 10, vx: rnd(-30, 30), vy: -rnd(80, 220), r: rnd(1, 3), life: rnd(1.5, 4) }; },
      draw: function (p) { ctx.fillStyle = "rgba(255," + Math.round(120 + 100 * Math.min(1, p.life / 3)) + ",40," + Math.min(1, p.life).toFixed(2) + ")"; circle(p.x, p.y, p.r); } },
    glitter: { rate: 60, make: function () { return { x: rnd(0, W), y: rnd(0, H), vx: 0, vy: 20, life: rnd(0.4, 1.2), s: rnd(3, 8), c: CONFETTI[Math.floor(Math.random() * 6)] }; },
      draw: function (p) { var a = Math.min(1, p.life * 2); ctx.strokeStyle = p.c; ctx.globalAlpha = a; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(p.x - p.s, p.y); ctx.lineTo(p.x + p.s, p.y); ctx.moveTo(p.x, p.y - p.s); ctx.lineTo(p.x, p.y + p.s); ctx.stroke(); ctx.globalAlpha = 1; } },
    meteors: { rate: 5, make: function () { return { x: rnd(W * 0.2, W * 1.2), y: rnd(-50, H * 0.4), vx: -rnd(500, 800), vy: rnd(250, 400), life: 2 }; },
      draw: function (p) { var g = ctx.createLinearGradient(p.x, p.y, p.x - p.vx * 0.15, p.y - p.vy * 0.15); g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(1, "rgba(255,200,120,0)");
        ctx.strokeStyle = g; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.15, p.y - p.vy * 0.15); ctx.stroke(); } },
    warp: { rate: 160, make: function () { var a = rnd(0, Math.PI * 2), sp = rnd(300, 900); return { x: W / 2 + Math.cos(a) * 20, y: H / 2 + Math.sin(a) * 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 2 }; },
      draw: function (p) { ctx.strokeStyle = "rgba(220,240,255,0.8)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06); ctx.stroke(); } },
    matrix: { rate: 40, make: function () { return { x: Math.floor(rnd(0, W / 16)) * 16, y: -20, vx: 0, vy: rnd(200, 420), life: 6, g: GLYPHS[Math.floor(Math.random() * GLYPHS.length)], n: Math.floor(rnd(6, 16)) }; },
      draw: function (p, t) { ctx.font = "14px monospace"; for (var k = 0; k < p.n; k++) { ctx.fillStyle = k ? "rgba(60,255,120," + (0.8 - k / p.n * 0.8).toFixed(2) + ")" : "#ccffdd";
        ctx.fillText(GLYPHS[(Math.floor(t * 10) + k * 7 + p.n) % GLYPHS.length], p.x, p.y - k * 16); } } },
    coins: { rate: 30, make: function () { return { x: rnd(0, W), y: -20, vx: rnd(-20, 20), vy: rnd(160, 300), a: rnd(0, 6), r: rnd(7, 12), life: 10 }; },
      draw: function (p, t, dt) { p.a += dt * 6; var w = Math.abs(Math.cos(p.a)) * p.r; ctx.fillStyle = "#ffd43b"; ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.max(1.5, w), p.r, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#b8860b"; ctx.lineWidth = 1.5; ctx.stroke(); } },
    wind: { rate: 40, make: function () { var left = current && current.steer && current.steer.drift < 0; return { x: left ? W + 40 : -40, y: rnd(0, H), vx: (left ? -1 : 1) * rnd(700, 1100), vy: rnd(-20, 20), life: 2, l: rnd(30, 90) }; },
      draw: function (p) { ctx.strokeStyle = "rgba(230,240,255,0.45)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - Math.sign(p.vx) * p.l, p.y); ctx.stroke(); } },
    fireworks: { rate: 2.2, make: function () { return { x: rnd(W * 0.15, W * 0.85), y: rnd(H * 0.12, H * 0.5), vx: 0, vy: 0, life: 1.6, c: CONFETTI[Math.floor(Math.random() * 6)], n: Math.floor(rnd(22, 34)) }; },
      draw: function (p) {
        var age = 1.6 - p.life, rr = 20 + age * 150, drop = age * age * 45;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.2));
        if (age < 0.15) { ctx.fillStyle = "rgba(255,255,255,0.9)"; circle(p.x, p.y, 14 * (1 - age / 0.15) + 3); }   // the burst
        ctx.strokeStyle = p.c; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.beginPath();
        for (var k = 0; k < p.n; k++) {   // sparks streaking out
          var a = k / p.n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          ctx.moveTo(p.x + c * rr * 0.8, p.y + s * rr * 0.8 + drop); ctx.lineTo(p.x + c * rr, p.y + s * rr + drop);
        }
        ctx.stroke(); ctx.globalAlpha = 1;
      } }
  };

  // Whole-screen overlays drawn fresh each frame.
  var SHAPES = {
    grain: function () { ctx.fillStyle = "rgba(255,255,255,0.08)"; for (var k = 0; k < 300; k++) ctx.fillRect(rnd(0, W), rnd(0, H), 1.5, 1.5);
      ctx.fillStyle = "rgba(0,0,0,0.25)"; for (k = 0; k < 3; k++) ctx.fillRect(rnd(0, W), 0, 1, H); },
    static: function () { for (var k = 0; k < 1200; k++) { var v = Math.floor(rnd(0, 255)); ctx.fillStyle = "rgba(" + v + "," + v + "," + v + ",0.35)"; ctx.fillRect(rnd(0, W), rnd(0, H), 2, 2); } },
    scanlines: function () { ctx.fillStyle = "rgba(0,0,0,0.28)"; for (var y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2); },
    vignette: function () { var g = ctx.createRadialGradient(W / 2, H * 0.6, Math.min(W, H) * 0.15, W / 2, H * 0.6, Math.max(W, H) * 0.6);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.96)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); },
    letterbox: function () { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H * 0.2); ctx.fillRect(0, H * 0.8, W, H * 0.2); },
    fog: function (t) { for (var k = 0; k < 4; k++) { var y = H * (0.15 + k * 0.22) + Math.sin(t * 0.6 + k) * 20, g = ctx.createLinearGradient(0, y - 90, 0, y + 90);
      g.addColorStop(0, "rgba(220,225,235,0)"); g.addColorStop(0.5, "rgba(220,225,235,0.45)"); g.addColorStop(1, "rgba(220,225,235,0)"); ctx.fillStyle = g; ctx.fillRect(0, y - 90, W, 180); } },
    binoculars: function () { var r = Math.min(W * 0.26, H * 0.42), cy = H * 0.52; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.rect(0, 0, W, H);
      ctx.arc(W / 2 - r * 0.8, cy, r, 0, Math.PI * 2, true); ctx.arc(W / 2 + r * 0.8, cy, r, 0, Math.PI * 2, true); ctx.fill("evenodd"); },
    scope: function (t, info) { var b = ballScreen(info), x = b ? b.x : W / 2, y = b ? b.y - b.h * 0.1 : H * 0.6, r = Math.min(W, H) * 0.3;
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(x, y, r, 0, Math.PI * 2, true); ctx.fill("evenodd");
      ctx.strokeStyle = "rgba(255,40,40,0.9)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 0.15, 0, Math.PI * 2); ctx.stroke(); },
    strobe: function (t) { if (Math.floor(t * 2.5) % 2 === 0 && (t * 2.5) % 1 < 0.35) { ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(0, 0, W, H); } },   // 2.5 a second at most
    lightning: function (t, info, s) {
      if (s.next === undefined) s.next = 0.8;
      if (t > s.next) { s.flash = t; s.next = t + rnd(1.2, 2.4); s.bolt = []; var x = rnd(W * 0.2, W * 0.8), y = 0; while (y < H * 0.7) { s.bolt.push([x, y]); x += rnd(-40, 40); y += rnd(30, 60); } }
      var age = t - (s.flash === undefined ? -9 : s.flash);
      if (age < 0.25) { ctx.fillStyle = "rgba(255,255,255," + (0.4 * (1 - age / 0.25)).toFixed(2) + ")"; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = "rgba(230,240,255,0.95)"; ctx.lineWidth = 3; ctx.beginPath(); s.bolt.forEach(function (pt, i) { if (i) ctx.lineTo(pt[0], pt[1]); else ctx.moveTo(pt[0], pt[1]); }); ctx.stroke(); } },
    aurora: function (t) { for (var k = 0; k < 3; k++) { ctx.beginPath(); for (var x = 0; x <= W; x += 20) { var y = H * (0.12 + k * 0.07) + Math.sin(x * 0.006 + t * (0.7 + k * 0.3) + k) * 30; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.strokeStyle = ["rgba(80,255,170,0.35)", "rgba(120,160,255,0.3)", "rgba(220,110,255,0.25)"][k]; ctx.lineWidth = 26 - k * 6; ctx.stroke(); } },
    spiral: function (t) { ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(t * 1.5); ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 18; ctx.beginPath();
      for (var a = 0; a < 40; a += 0.15) { var r = a * 14; if (a) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(0, 0); } ctx.stroke(); ctx.restore(); },
    lasers: function (t) { for (var k = 0; k < 5; k++) { var a = Math.sin(t * (0.8 + k * 0.23) + k * 1.7) * 0.9 - Math.PI / 2, x0 = W * (0.1 + k * 0.2), y0 = H;
      ctx.strokeStyle = CONFETTI[k]; ctx.globalAlpha = 0.55; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * H * 1.5, y0 + Math.sin(a) * H * 1.5); ctx.stroke(); } ctx.globalAlpha = 1; },
    stars: function (t) { for (var k = 0; k < 90; k++) { var x = hr(k) * W, y = hr(k + 500) * H * 0.75, g = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + k));
      ctx.fillStyle = "rgba(255,255,255," + g.toFixed(2) + ")"; ctx.fillRect(x, y, 2, 2); } }
  };

  var current = null, shapeState = {};
  function drawOverlay(e, t, dt, info) {
    var names = [].concat(e.overlay);
    ensureLayer();
    ctx.clearRect(0, 0, W, H);
    names.forEach(function (n) {
      var P = PARTS[n];
      if (!P) return;
      if (!carry.hasOwnProperty(n)) {   // the first frame: as if it had been going for a while
        carry[n] = 0;
        var start = Math.min(P.max || 400, Math.round(P.rate * (W / 1000) * 2.5));
        for (var k = 0; k < start; k++) {
          var q = P.make(), age = Math.random() * 2.5;
          q.kind = n; q.x += q.vx * age; q.y += q.vy * age; q.life -= age;
          parts.push(q);
        }
      }
      carry[n] += P.rate * (W / 1000) * dt;
      var count = parts.filter(function (p) { return p.kind === n; }).length;
      while (carry[n] >= 1) { carry[n] -= 1; if (count < (P.max || 400)) { var p = P.make(); p.kind = n; parts.push(p); count++; } }
    });
    parts = parts.filter(function (p) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      return p.life > 0 && p.y < H + 60 && p.y > -80 && p.x > -150 && p.x < W + 150;
    });
    parts.forEach(function (p) { PARTS[p.kind].draw(p, t, dt); });
    names.forEach(function (n) { if (SHAPES[n]) SHAPES[n](t, info, shapeState[n] = shapeState[n] || {}); });
  }

  // --- Playing one ----------------------------------------------------------------------

  var everyNext = 0;
  function start(e) {
    current = e;
    shapeState = {};
    everyNext = e.every ? e.every[0] : 0;
    if (e.steer && window.SlopeSteer && window.SlopeSteer.fx) window.SlopeSteer.fx(e.steer);
    if (e.gift) { try { e.gift(); } catch (err) { /* a gift is never worth a broken run */ } }
    if (profile && profile.seeEffect) profile.seeEffect(e.id);
  }

  // t: seconds since the effect began (run time); info: the frame's ball and view.
  var lastT = 0;
  function frame(e, t, info) {
    var dt = Math.max(0, Math.min(0.1, t - lastT));
    lastT = t;
    if (e.speed !== undefined) game.setTimeScale(value(e.speed, t));
    var c = canvas();
    if (c) {
      c.style.filter = e.filter ? value(e.filter, t) : "";
      c.style.transform = e.transform ? value(e.transform, t) : "";
    }
    if (e.veil) showVeil(e.veil, info);
    if (e.overlay && !reduceMotion.matches) drawOverlay(e, t, dt, info);
    if (e.every && t >= everyNext) { everyNext += e.every[0]; try { e.every[1](); } catch (err) { /* as above */ } }
  }

  function end(e) {
    current = null;
    lastT = 0;
    if (e && e.speed !== undefined) game.setTimeScale(1);
    if (e && e.steer && window.SlopeSteer && window.SlopeSteer.fx) window.SlopeSteer.fx(null);
    var c = canvas();
    if (c) { c.style.filter = ""; c.style.transform = ""; }
    if (veil) veil.hidden = true;
    clearLayer();
  }

  window.SlopeFx = {
    list: LIST,
    playable: playable,
    start: start,
    frame: frame,
    end: end
  };
})();
