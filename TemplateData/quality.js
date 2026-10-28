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
 * Load this before the Unity loader creates the game canvas.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "slope-settings";
  var LEVELS = ["low", "high", "ultra"];
  var DEFAULT_LEVEL = "ultra";
  // Upper limit for the drawing buffer, so large or slow screens stay smooth.
  var MAX_PIXELS = 6000000;
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
      if (saved && LEVELS.indexOf(saved.graphics) !== -1) return saved.graphics;
    } catch (e) {}
    return DEFAULT_LEVEL;
  }

  function isGameCanvas(canvas) {
    return canvas.id === "#canvas";
  }

  function targetScale(w, h) {
    var dpr = window.devicePixelRatio || 1;
    var scale = level === "low" ? 1 : level === "high" ? dpr : dpr * 2;
    if (w && h) scale = Math.min(scale, Math.sqrt(MAX_PIXELS / (w * h)));
    return Math.max(1, scale);
  }

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
      level = next;
      if (gameCanvas) resizeBuffer(gameCanvas);
    }
  };
})();
