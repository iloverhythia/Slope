/*
 * Sharper rendering for the Unity build.
 *
 * Unity sizes its canvas in CSS pixels and lays out the menus in fixed pixel
 * sizes, so on a high-DPI screen the game is drawn at low resolution and
 * stretched. Enlarging the canvas directly would shrink the menus instead.
 *
 * So the game keeps seeing its normal canvas size, while its drawing buffer
 * is made larger and every viewport and scissor rectangle on screen is scaled
 * up to match. The layout and click positions stay exactly the same; the
 * picture is drawn at the screen's full resolution, or twice that and then
 * smoothed down by the browser. 4x multisampling smooths the edges on top.
 *
 * This build only ever draws straight to the screen (no render textures,
 * reads or blits from it), so viewport and scissor are all that need scaling.
 *
 * "Auto" (the default) starts at the screen's resolution and watches the
 * frame rate while the game runs: if frames are being dropped it draws at a
 * lower resolution, and when there is time to spare it goes back up, as far
 * as twice the screen's resolution.
 *
 * Load this before the Unity loader creates the game canvas.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "slope-settings";
  var LEVELS = ["auto", "low", "high", "ultra"];
  var DEFAULT_LEVEL = "auto";
  var SETTINGS_VERSION = 2;  // before 2, "ultra" was the default and is read as "auto"
  // Upper limit for the drawing buffer, so large or slow screens stay smooth.
  var MAX_PIXELS = 6000000;
  var AUTO_MAX_PIXELS = 4500000;
  var AUTO_STEP = 0.85;       // each step down draws 0.85x as many pixels across
  var AUTO_WINDOW = 120;      // frames per check
  var AUTO_SLOW = 1.45;       // a frame this many refresh intervals long was dropped
  var DRAW_FRAMEBUFFER = 0x8ca9;

  var canvasProto = HTMLCanvasElement.prototype;
  var widthProp = Object.getOwnPropertyDescriptor(canvasProto, "width");
  var heightProp = Object.getOwnPropertyDescriptor(canvasProto, "height");
  var getContext = canvasProto.getContext;

  var level = savedLevel();
  var gameCanvas = null;
  var glState = null;

  function savedLevel() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && saved.graphics === "ultra" && saved.v !== SETTINGS_VERSION) return DEFAULT_LEVEL;
      if (saved && LEVELS.indexOf(saved.graphics) !== -1) return saved.graphics;
    } catch (e) {}
    return DEFAULT_LEVEL;
  }

  function isGameCanvas(canvas) {
    return canvas.id === "#canvas";
  }

  function targetScale(w, h) {
    var dpr = window.devicePixelRatio || 1;
    if (level === "auto") return autoScale(w, h);
    var scale = level === "low" ? 1 : level === "high" ? dpr : dpr * 2;
    if (w && h) scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (w * h)));
    return Math.max(1, scale);
  }

  // --- Auto ----------------------------------------------------------------
  // auto.scale is relative to the screen's resolution (1 = one buffer pixel
  // per screen pixel). A scale that dropped frames becomes the ceiling, so the
  // resolution doesn't bounce between two steps.
  var auto = { scale: 1, ceiling: Infinity, intervals: [], last: 0, calm: 0, refresh: 0 };

  function autoLimits(w, h) {
    var dpr = window.devicePixelRatio || 1;
    var most = 2;
    if (w && h) most = Math.min(most, Math.sqrt(AUTO_MAX_PIXELS / (w * h)) / dpr);
    return { least: 1 / dpr, most: Math.max(1 / dpr, most) };
  }

  function autoScale(w, h) {
    var dpr = window.devicePixelRatio || 1, lim = autoLimits(w, h);
    auto.scale = Math.min(Math.max(auto.scale, lim.least), lim.most);
    return Math.max(1, auto.scale * dpr);
  }

  function gameIsRunning() {
    var game = window.SlopeGame;
    if (game && game.paused && game.paused()) return false;
    return document.visibilityState !== "hidden" && !!gameCanvas;
  }

  function autoFrame(time) {
    requestFrame(autoFrame);
    var gap = auto.last ? time - auto.last : 0;
    auto.last = time;
    if (level !== "auto" || !gameIsRunning() || gap <= 0 || gap > 250) return;
    auto.intervals.push(gap);
    if (auto.intervals.length < AUTO_WINDOW) return;
    // The display's own frame interval: the quickest frames seen lately (the
    // menu draws at full rate), let up slowly in case the display changes.
    var sorted = auto.intervals.slice().sort(function (a, b) { return a - b; });
    var quick = sorted[Math.floor(sorted.length * 0.1)];
    auto.refresh = auto.refresh ? Math.min(auto.refresh * 1.03, quick) : quick;
    var slow = auto.intervals.filter(function (g) { return g > auto.refresh * AUTO_SLOW; }).length / auto.intervals.length;
    auto.intervals = [];
    var w = gameCanvas.__slopeWidth, h = gameCanvas.__slopeHeight, lim = autoLimits(w, h);
    var next = auto.scale;
    if (slow > 0.08 && auto.scale > lim.least) {
      auto.ceiling = auto.scale;
      next = auto.scale * AUTO_STEP;
      auto.calm = 0;
    } else if (slow < 0.01) {
      // Steady for three checks in a row: try one step up, below the ceiling.
      // After a long steady while, the ceiling lets up one step.
      auto.calm++;
      if (auto.calm >= 30 && auto.ceiling < Infinity) { auto.ceiling /= AUTO_STEP; auto.calm = 3; }
      if (auto.calm >= 3 && auto.scale / AUTO_STEP < auto.ceiling * 0.999) next = auto.scale / AUTO_STEP;
    } else {
      auto.calm = 0;
    }
    next = Math.min(Math.max(next, lim.least), lim.most);
    if (Math.abs(next - auto.scale) > 1e-3) {
      auto.scale = next;
      auto.calm = 0;
      resizeBuffer(gameCanvas);
    }
  }
  var requestFrame = window.requestAnimationFrame.bind(window);
  requestFrame(autoFrame);

  // Sets the real buffer size from the size the game asked for.
  function resizeBuffer(canvas) {
    var w = canvas.__slopeWidth, h = canvas.__slopeHeight;
    if (!w || !h) return;
    var scale = targetScale(w, h);
    var realW = Math.round(w * scale), realH = Math.round(h * scale);
    if (widthProp.get.call(canvas) !== realW) widthProp.set.call(canvas, realW);
    if (heightProp.get.call(canvas) !== realH) heightProp.set.call(canvas, realH);
    if (glState) glState.refresh();
  }

  ["width", "height"].forEach(function (prop) {
    var native = prop === "width" ? widthProp : heightProp;
    var key = prop === "width" ? "__slopeWidth" : "__slopeHeight";
    Object.defineProperty(canvasProto, prop, {
      configurable: true,
      enumerable: native.enumerable,
      get: function () {
        if (isGameCanvas(this) && this[key]) return this[key];
        return native.get.call(this);
      },
      set: function (value) {
        if (!isGameCanvas(this)) return native.set.call(this, value);
        gameCanvas = this;
        this[key] = value;
        resizeBuffer(this);
      }
    });
  });

  function scaleContext(gl, canvas) {
    var viewport = gl.viewport, scissor = gl.scissor, bindFramebuffer = gl.bindFramebuffer;
    var onScreen = true;
    var viewportRect = null, scissorRect = null;

    function apply(fn, rect) {
      if (!rect) return;
      if (!onScreen || !canvas.__slopeWidth) return fn.call(gl, rect[0], rect[1], rect[2], rect[3]);
      var kx = widthProp.get.call(canvas) / canvas.__slopeWidth;
      var ky = heightProp.get.call(canvas) / canvas.__slopeHeight;
      var x0 = Math.round(rect[0] * kx), y0 = Math.round(rect[1] * ky);
      fn.call(gl, x0, y0, Math.round((rect[0] + rect[2]) * kx) - x0, Math.round((rect[1] + rect[3]) * ky) - y0);
    }

    gl.viewport = function (x, y, w, h) {
      viewportRect = [x, y, w, h];
      apply(viewport, viewportRect);
    };
    gl.scissor = function (x, y, w, h) {
      scissorRect = [x, y, w, h];
      apply(scissor, scissorRect);
    };
    gl.bindFramebuffer = function (target, framebuffer) {
      bindFramebuffer.call(gl, target, framebuffer);
      if (target !== gl.FRAMEBUFFER && target !== DRAW_FRAMEBUFFER) return;
      if (onScreen === !framebuffer) return;
      onScreen = !framebuffer;
      apply(viewport, viewportRect);
      apply(scissor, scissorRect);
    };

    return {
      refresh: function () {
        apply(viewport, viewportRect);
        apply(scissor, scissorRect);
      }
    };
  }

  canvasProto.getContext = function (type, attributes) {
    if (!isGameCanvas(this) || !/webgl/.test(type)) return getContext.apply(this, arguments);
    var gl = getContext.call(this, type, Object.assign({}, attributes, { antialias: true }));
    if (gl && !gl.__slopeScaled) {
      gl.__slopeScaled = true;
      gameCanvas = this;
      glState = scaleContext(gl, this);
    }
    return gl;
  };

  // Moving the window to a screen with a different pixel density fires resize.
  window.addEventListener("resize", function () {
    if (gameCanvas) resizeBuffer(gameCanvas);
  });

  window.SlopeGraphics = {
    levels: LEVELS.slice(),
    getLevel: function () {
      return level;
    },
    setLevel: function (next) {
      if (LEVELS.indexOf(next) === -1) return;
      if (next === "auto" && level !== "auto") { auto.ceiling = Infinity; auto.calm = 0; auto.intervals = []; }
      level = next;
      if (gameCanvas) resizeBuffer(gameCanvas);
    },
    version: SETTINGS_VERSION,
    // The current drawing scale: buffer pixels per CSS pixel.
    scale: function () {
      return gameCanvas && gameCanvas.__slopeWidth ? widthProp.get.call(gameCanvas) / gameCanvas.__slopeWidth : 1;
    }
  };
})();
