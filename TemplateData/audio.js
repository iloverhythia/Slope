/*
 * Music on and off, for the switch in Settings (settings.js). The game's own
 * sound button is hidden (tools/patch_sound.py).
 *
 * Unity plays its audio through a Web Audio context and connects everything
 * to the context's destination. Each context made here hands out a gain
 * node as its destination instead, so one volume control covers all of the
 * game's audio. The choice is kept with the other settings.
 *
 * Load this before the Unity loader creates its audio context.
 *
 *   SlopeAudio.setMuted(muted) / muted()
 *   SlopeAudio.contexts() / level()   how many contexts go through it, the first one's volume
 */
(function () {
  "use strict";

  var STORAGE_KEY = "slope-settings";
  var muted = false;
  var masters = [];

  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    muted = !!(saved && saved.music === false);
  } catch (e) {}

  function wrapContext(Native) {
    if (!Native) return Native;
    function SlopeAudioContext() {
      var ctx = new (Function.prototype.bind.apply(Native, [null].concat(Array.prototype.slice.call(arguments))))();
      try {
        var real = ctx.destination;
        var master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(real);
        // Anything that asks for the destination gets the master volume;
        // the real one's own properties still read through.
        ["maxChannelCount"].forEach(function (k) {
          try { Object.defineProperty(master, k, { get: function () { return real[k]; } }); } catch (e) {}
        });
        Object.defineProperty(ctx, "destination", { configurable: true, get: function () { return master; } });
        masters.push({ ctx: ctx, gain: master });
      } catch (e) {
        console.warn("Slope audio: can't add the music switch", e);
      }
      return ctx;
    }
    SlopeAudioContext.prototype = Native.prototype;
    return SlopeAudioContext;
  }

  if (window.AudioContext) window.AudioContext = wrapContext(window.AudioContext);
  if (window.webkitAudioContext) window.webkitAudioContext = wrapContext(window.webkitAudioContext);

  function apply() {
    masters.forEach(function (m) {
      try { m.gain.gain.setTargetAtTime(muted ? 0 : 1, m.ctx.currentTime, 0.03); } catch (e) { m.gain.gain.value = muted ? 0 : 1; }
    });
  }

  window.SlopeAudio = {
    muted: function () { return muted; },
    contexts: function () { return masters.length; },
    level: function () { return masters.length ? masters[0].gain.gain.value : null; },
    setMuted: function (next) { muted = !!next; apply(); }
  };
})();
