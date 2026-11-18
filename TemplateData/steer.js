/*
 * Steering filters: the page can change what the game hears from the
 * steering keys (the arrow keys, A and D, and Q on AZERTY keyboards).
 *
 *   mirror   left is right and right is left (the Randomizer's Mirror)
 *   ice      a turn goes on for a moment after the key is let go (ice slopes)
 *   fx       the Randomizer's effects (fx.js), on top of those: its own
 *            mirror and ice, lag (the keys reach the game late), flicker
 *            (the mirror flips on and off), drift (a gust steers one way now
 *            and then) and stutter (the keys drop out for a moment)
 *
 * While no filter is on, the keys go straight to the game. While one is on,
 * the real keys are caught before the game sees them, and the game hears
 * ArrowLeft and ArrowRight from the page instead (keyboard events sent to its
 * canvas, which the game takes like real ones). When filters start or stop,
 * what the game holds is let go and the keys the player holds are pressed
 * again the new way, so the ball never steers by itself.
 *
 * Load after game-bridge.js.
 *
 *   SlopeSteer.mirror(on)
 *   SlopeSteer.ice(seconds)       how long a turn goes on after its key is let go (0: off)
 *   SlopeSteer.fx({ mirror, ice, lag, flicker, drift, stutter }) / fx(null)
 *   SlopeSteer.reset()            every filter off
 *   SlopeSteer.state()            { mirror, ice, held: { left, right }, out: { left, right } }
 */
(function () {
  "use strict";

  var SIDE = { ArrowLeft: -1, a: -1, A: -1, q: -1, Q: -1, ArrowRight: 1, d: 1, D: 1 };
  var CODE = { ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39], a: ["KeyA", 65], A: ["KeyA", 65],
    q: ["KeyQ", 81], Q: ["KeyQ", 81], d: ["KeyD", 68], D: ["KeyD", 68] };

  var filters = { mirror: false, ice: 0, fx: null };
  var hist = [];               // lag: what the player held, and when
  var stut = { next: 0, until: 0 };   // stutter: the next drop-out
  var held = {};               // real keys the player holds: key -> true
  var out = { left: false, right: false };   // what the game holds while a filter is on
  var slide = { left: 0, right: 0 };        // ice: a turn goes on until then
  var was = { left: false, right: false };  // the player's turn last tick (after the mirror)
  var on = false;              // a filter is on: keys are caught
  var ticking = false;

  function clock() {
    var game = window.SlopeGame;
    return (game && game.realNow ? game.realNow() : Date.now()) / 1000;
  }

  function keyEvent(type, key, code, keyCode) {
    var ev = new KeyboardEvent(type, { key: key, code: code, bubbles: true, cancelable: true });
    try {
      Object.defineProperty(ev, "keyCode", { get: function () { return keyCode; } });
      Object.defineProperty(ev, "which", { get: function () { return keyCode; } });
    } catch (e) {}
    ev.__slopeSynthetic = true;
    return ev;
  }

  function send(type, key) {
    var target = document.getElementById("#canvas") || document.body;
    var c = CODE[key];
    target.dispatchEvent(keyEvent(type, key, c[0], c[1]));
  }

  function setOut(side, down) {
    if (out[side] === down) return;
    out[side] = down;
    send(down ? "keydown" : "keyup", side === "left" ? "ArrowLeft" : "ArrowRight");
  }

  // What the player is steering: -1, 0 or 1 per side held.
  function heldSides() {
    var left = false, right = false;
    Object.keys(held).forEach(function (k) { if (SIDE[k] < 0) left = true; else right = true; });
    return { left: left, right: right };
  }

  // What the game should hear now, with every filter applied.
  function wanted(t) {
    var h = heldSides(), f = filters.fx || {};
    var left = h.left, right = h.right;
    if (f.stutter) {   // now and then the keys drop out
      if (t >= stut.next) { stut.until = t + 0.16; stut.next = t + 0.45 + Math.random() * 0.9; }
      if (t < stut.until) left = right = false;
    }
    if (f.lag) {   // the game hears what was held a moment ago
      hist.push([t, left, right]);
      while (hist.length > 1 && hist[1][0] <= t - f.lag) hist.shift();
      if (hist[0][0] <= t - f.lag) { left = hist[0][1]; right = hist[0][2]; } else left = right = false;
    }
    var mir = filters.mirror !== !!f.mirror;
    if (f.flicker && Math.floor(t / f.flicker) % 2 === 1) mir = !mir;
    if (mir) { var swap = left; left = right; right = swap; }
    var ice = Math.max(filters.ice, f.ice || 0);
    if (ice) {
      // A turn let go keeps going for a moment; pressing the other way stops it.
      if (was.left && !left) slide.left = t + ice;
      if (was.right && !right) slide.right = t + ice;
      if (left) slide.right = 0;
      if (right) slide.left = 0;
      was = { left: left, right: right };
      if (!left && !right) { left = t < slide.left; right = t < slide.right; }
    } else {
      was = { left: left, right: right };
    }
    if (f.drift && !left && !right && t % 1.1 < 0.28) { if (f.drift < 0) left = true; else right = true; }   // a gust
    return { left: left, right: right };
  }
  // Filters that change with time, not only with key presses.
  function timed() { var f = filters.fx || {}; return filters.ice > 0 || f.ice > 0 || f.lag > 0 || f.flicker > 0 || !!f.drift || !!f.stutter; }

  function update() {
    if (!on) return;
    var w = wanted(clock());
    setOut("left", w.left);
    setOut("right", w.right);
  }

  // Ice runs on the clock, between key presses too.
  function tick() {
    if (!on || !timed()) { ticking = false; return; }
    update();
    requestAnimationFrame(tick);
  }

  // Filters changed: hand the keys over between the player and the page.
  function apply() {
    var want = filters.mirror || filters.ice > 0 || !!filters.fx;
    if (want && !on) {
      // The game holds the player's real keys: let them go, then steer for them.
      Object.keys(held).forEach(function (k) { send("keyup", k); });
      on = true;
      was = { left: false, right: false };
      slide = { left: 0, right: 0 };
      hist = [];
    } else if (!want && on) {
      setOut("left", false);
      setOut("right", false);
      on = false;
      Object.keys(held).forEach(function (k) { send("keydown", k); });
      return;
    }
    if (!on) return;
    update();
    if (!ticking && timed()) { ticking = true; requestAnimationFrame(tick); }
  }

  function editable(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  ["keydown", "keyup"].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (e.__slopeSynthetic || !SIDE[e.key] || editable(e.target)) return;
      if (type === "keydown") held[e.key] = true; else delete held[e.key];
      if (!on) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (type === "keydown" && e.repeat) return;
      update();
    }, true);
  });

  window.addEventListener("blur", function () {
    held = {};
    if (on) update();
  });

  window.SlopeSteer = {
    mirror: function (v) { filters.mirror = !!v; apply(); },
    ice: function (seconds) { filters.ice = Math.max(0, +seconds || 0); apply(); },
    fx: function (f) { filters.fx = f || null; hist = []; stut = { next: 0, until: 0 }; apply(); },
    reset: function () { filters = { mirror: false, ice: 0, fx: null }; apply(); },
    state: function () {
      return { mirror: filters.mirror, ice: filters.ice, fx: filters.fx, held: heldSides(), out: { left: out.left, right: out.right } };
    }
  };
})();
