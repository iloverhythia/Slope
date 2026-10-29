/*
 * Steering filters: the page can change what the game hears from the
 * steering keys (the arrow keys, A and D, and Q on AZERTY keyboards).
 *
 *   mirror   left is right and right is left (the Randomizer's Mirror)
 *   ice      a turn goes on for a moment after the key is let go (ice slopes)
 *   wind     short gusts steer the ball one way (wind slopes)
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
 *   SlopeSteer.wind(dir, share)   dir -1 (left) or 1 (right); share of the time a gust blows (0: off)
 *   SlopeSteer.reset()            every filter off
 *   SlopeSteer.state()            { mirror, ice, wind, share, held: { left, right }, out: { left, right } }
 */
(function () {
  "use strict";

  var SIDE = { ArrowLeft: -1, a: -1, A: -1, q: -1, Q: -1, ArrowRight: 1, d: 1, D: 1 };
  var CODE = { ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39], a: ["KeyA", 65], A: ["KeyA", 65],
    q: ["KeyQ", 81], Q: ["KeyQ", 81], d: ["KeyD", 68], D: ["KeyD", 68] };
  var GUST_PERIOD = 0.32;      // seconds from one gust to the next

  var filters = { mirror: false, ice: 0, wind: 0, share: 0 };
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
    var h = heldSides();
    var left = h.left, right = h.right;
    if (filters.mirror) { var swap = left; left = right; right = swap; }
    if (filters.ice) {
      // A turn let go keeps going for a moment; pressing the other way stops it.
      if (was.left && !left) slide.left = t + filters.ice;
      if (was.right && !right) slide.right = t + filters.ice;
      if (left) slide.right = 0;
      if (right) slide.left = 0;
      was = { left: left, right: right };
      if (!left && !right) { left = t < slide.left; right = t < slide.right; }
    } else {
      was = { left: left, right: right };
    }
    if (filters.share > 0 && (t / GUST_PERIOD) % 1 < filters.share) {
      left = filters.wind < 0;
      right = filters.wind > 0;
    }
    return { left: left, right: right };
  }

  function update() {
    if (!on) return;
    var w = wanted(clock());
    setOut("left", w.left);
    setOut("right", w.right);
  }

  function tick() {
    if (!on || !(filters.ice || filters.share)) { ticking = false; return; }
    update();
    requestAnimationFrame(tick);
  }

  // Filters changed: hand the keys over between the player and the page.
  function apply() {
    var want = filters.mirror || filters.ice > 0 || filters.share > 0;
    if (want && !on) {
      // The game holds the player's real keys: let them go, then steer for them.
      Object.keys(held).forEach(function (k) { send("keyup", k); });
      on = true;
      was = { left: false, right: false };
      slide = { left: 0, right: 0 };
    } else if (!want && on) {
      setOut("left", false);
      setOut("right", false);
      on = false;
      Object.keys(held).forEach(function (k) { send("keydown", k); });
      return;
    }
    if (!on) return;
    update();
    if (!ticking && (filters.ice || filters.share)) { ticking = true; requestAnimationFrame(tick); }
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
    wind: function (dir, share) {
      filters.wind = dir < 0 ? -1 : 1;
      filters.share = Math.max(0, Math.min(0.5, +share || 0));
      apply();
    },
    reset: function () { filters = { mirror: false, ice: 0, wind: 0, share: 0 }; apply(); },
    state: function () {
      return { mirror: filters.mirror, ice: filters.ice, wind: filters.wind, share: filters.share,
        held: heldSides(), out: { left: out.left, right: out.right } };
    }
  };
})();
