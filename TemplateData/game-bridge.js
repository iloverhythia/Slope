/*
 * Game bridge: what the page can see of the running Unity game.
 *
 * Signals from the game (added to its data by tools/patch_menu.py): the game
 * sets the page hash, which arrives here as a hashchange.
 *   #slope-run-start      a run started
 *   #slope-score-<n>      the run ended with score n
 *   #slope-career         the Career menu button was pressed
 *   #slope-adventure      the Adventure menu button was pressed
 *   #slope-shop           the Shop menu button was pressed
 *   #slope-menu           the main menu is shown
 *
 * The page can also send events to the game's EventManager state machine
 * (SlopeGame.send), e.g. "resetPressed" starts a run from the menu or the
 * score screen and "collide death" crashes the ball.
 *
 * Per frame, from the game's WebGL calls: the main camera's view-projection
 * matrix, the ball's position, and the sideways extent of the track pieces on
 * screen. The track is a 45 degree slope, so positions are also given in
 * slope coordinates: s (distance down the track), h (height off the slope
 * plane) and x (sideways).
 *
 * "scene" handlers draw into the game's own 3D scene: they run right after
 * the ball is drawn, with depth testing on, so walls and the ball hide what
 * they draw like any other object. The game's WebGL state is saved before and
 * restored after, so the game never notices.
 *
 * A ball painter draws the ball in place of the game: it gets the game's
 * WebGL context with the ball's mesh bound, the camera and the ball's
 * object-to-world matrix, and calls draw() after switching to its own
 * program. Returning false lets the game draw its own ball. A trail painter
 * does the same for the ball's speed-up trail (program is the game's trail
 * program, with its shader sources in program.__slopeSources), so the trail
 * keeps its shape and only shows when the game shows it.
 *
 * Load after quality.js and before the Unity loader creates the game canvas.
 *
 *   SlopeGame.on("runstart" | "runend" | "career" | "adventure" | "shop" | "menu" | "frame", handler)
 *   SlopeGame.send(eventName)      send an event to the game's EventManager
 *   SlopeGame.inRun()              true while a run is going
 *   SlopeGame.on("scene", function ({ gl, vp }) { ... })   WebGL2 only
 *   SlopeGame.paintBall(function ({ gl, vp, o2w, draw }) { ... return true; })
 *   SlopeGame.paintTrail(function ({ gl, program, draw }) { ... return true; })
 */
(function () {
  "use strict";

  var BALL_INDEX_COUNT = 2304;   // the ball's sphere mesh
  var VP_NAME = "hlslcc_mtx4x4unity_MatrixVP";
  var O2W_NAME = "hlslcc_mtx4x4unity_ObjectToWorld";
  var STATIC_DRAW = 0x88e4;
  var SQRT1_2 = Math.SQRT1_2;

  var handlers = {};
  var ballPainter = null;
  var trailPainter = null;
  function on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); }
  function emit(name, data) {
    (handlers[name] || []).forEach(function (fn) {
      try { fn(data); } catch (e) { console.error(e); }
    });
  }

  // --- Signals ---------------------------------------------------------------

  function clearHash() {
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {
      location.hash = "";
    }
  }

  var inRun = false;

  // The game can send two signals in one frame (a screen state that returns
  // straight to the menu), so each hashchange is read from its own new URL,
  // not from the current hash.
  function readSignal(e) {
    var url = e && e.newURL ? e.newURL : location.href;
    var hash = url.indexOf("#") === -1 ? "" : url.slice(url.indexOf("#"));
    var m = /^#slope-(run-start|career|adventure|shop|menu|score-(\d+))$/.exec(hash);
    if (!m) return;
    if (/^#slope-/.test(location.hash)) clearHash();
    if (m[1] === "run-start") {
      inRun = true;
      emit("runstart");
    } else if (m[1] === "career" || m[1] === "adventure" || m[1] === "shop" || m[1] === "menu") {
      emit(m[1]);
    } else if (inRun) {
      // A crash followed by a fall reports the score twice: count the run once.
      inRun = false;
      emit("runend", { score: parseInt(m[2], 10) });
    }
  }
  window.addEventListener("hashchange", readSignal);

  // --- Frame data from WebGL --------------------------------------------------

  function toSlope(p) {
    return { s: (p[2] - p[1]) * SQRT1_2, h: (p[1] + p[2]) * SQRT1_2, x: p[0] };
  }

  function isPerspective(vp) {
    return vp[3] !== 0 || vp[7] !== 0 || vp[11] !== 0;
  }

  var frame = null;
  function newFrame() { return { vp: null, ball: null, pieces: [] }; }

  function localBounds(gl, state, count, type, offset) {
    var attrib = state.attrib0, elems = state.elements;
    if (!attrib || !attrib.buffer || !attrib.buffer.__slopeData || !elems || !elems.__slopeData) return null;
    var key = count + ":" + type + ":" + offset + ":" + attrib.stride + ":" + attrib.offset;
    var cache = attrib.buffer.__slopeBounds || (attrib.buffer.__slopeBounds = {});
    var ecache = cache[elems.__slopeId] || (cache[elems.__slopeId] = {});
    if (key in ecache) return ecache[key];
    var data = elems.__slopeData, verts = new DataView(attrib.buffer.__slopeData.buffer);
    var indices = type === gl.UNSIGNED_INT
      ? new Uint32Array(data.buffer, data.byteOffset + offset, count)
      : new Uint16Array(data.buffer, data.byteOffset + offset, count);
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    try {
      for (var i = 0; i < indices.length; i++) {
        var p = attrib.offset + indices[i] * attrib.stride;
        for (var k = 0; k < 3; k++) {
          var v = verts.getFloat32(p + k * 4, true);
          if (v < mn[k]) mn[k] = v;
          if (v > mx[k]) mx[k] = v;
        }
      }
    } catch (e) {
      return (ecache[key] = null);
    }
    return (ecache[key] = { mn: mn, mx: mx });
  }

  // World extent of a mesh, in slope coordinates, from its local box corners.
  function slopeExtent(m, b) {
    var out = { s0: Infinity, s1: -Infinity, x0: Infinity, x1: -Infinity };
    for (var c = 0; c < 8; c++) {
      var l = [c & 1 ? b.mx[0] : b.mn[0], c & 2 ? b.mx[1] : b.mn[1], c & 4 ? b.mx[2] : b.mn[2]];
      var w = [0, 1, 2].map(function (r) { return m[r] * l[0] + m[4 + r] * l[1] + m[8 + r] * l[2] + m[12 + r]; });
      var p = toSlope(w);
      out.s0 = Math.min(out.s0, p.s); out.s1 = Math.max(out.s1, p.s);
      out.x0 = Math.min(out.x0, p.x); out.x1 = Math.max(out.x1, p.x);
    }
    return out;
  }

  function instrument(gl) {
    var DRAW_FRAMEBUFFER = 0x8ca9;
    var vao = { attrib0: null, elements: null };
    var defaultVao = vao;
    var arrayBuffer = null, nextId = 1;
    var vp = null, o2w = null, onScreen = true;
    var raw = {}; // the unwrapped methods

    function wrap(name, after) {
      var fn = gl[name];
      if (!fn) return;
      raw[name] = fn;
      gl[name] = function () {
        var result = fn.apply(gl, arguments);
        after(arguments, result);
        return result;
      };
    }

    // Draw extra objects into the scene without disturbing the game's state.
    var SWITCHES = gl.createVertexArray ? [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.STENCIL_TEST, gl.SCISSOR_TEST,
      gl.POLYGON_OFFSET_FILL, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE, gl.RASTERIZER_DISCARD] : [];

    function drawScene(viewProjection) {
      if (!handlers.scene || !gl.createVertexArray) return;
      var saved = {
        program: gl.getParameter(gl.CURRENT_PROGRAM),
        vertexArray: gl.getParameter(gl.VERTEX_ARRAY_BINDING),
        arrayBinding: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
        switches: SWITCHES.map(function (c) { return gl.isEnabled(c); }),
        depthFunc: gl.getParameter(gl.DEPTH_FUNC),
        depthMask: gl.getParameter(gl.DEPTH_WRITEMASK),
        colorMask: gl.getParameter(gl.COLOR_WRITEMASK),
        tracked: { vao: vao, arrayBuffer: arrayBuffer }
      };
      SWITCHES.forEach(function (c) { if (c === gl.DEPTH_TEST) gl.enable(c); else gl.disable(c); });
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.colorMask(true, true, true, true);
      try {
        emit("scene", { gl: gl, vp: viewProjection });
      } finally {
        gl.useProgram(saved.program);
        raw.bindVertexArray.call(gl, saved.vertexArray);
        raw.bindBuffer.call(gl, gl.ARRAY_BUFFER, saved.arrayBinding);
        SWITCHES.forEach(function (c, i) { if (saved.switches[i]) gl.enable(c); else gl.disable(c); });
        gl.depthFunc(saved.depthFunc);
        gl.depthMask(saved.depthMask);
        gl.colorMask.apply(gl, saved.colorMask);
        vao = saved.tracked.vao;
        arrayBuffer = saved.tracked.arrayBuffer;
      }
    }

    // The speed-up trail is drawn with the game's only shader that multiplies
    // a texture by vertex colours. Keep each program's sources so it can be
    // recognised (and copied by a trail painter).
    var currentProgram = null;
    wrap("shaderSource", function (a) { if (a[0]) a[0].__slopeSource = a[1]; });
    wrap("attachShader", function (a) { if (a[0]) (a[0].__slopeShaders = a[0].__slopeShaders || []).push(a[1]); });
    wrap("linkProgram", function (a) {
      var program = a[0];
      if (!program) return;
      var src = (program.__slopeShaders || []).map(function (sh) { return sh.__slopeSource || ""; });
      program.__slopeSources = src;
      program.__slopeTrail = src.length === 2 && /in_COLOR0/.test(src[0]) &&
        /SV_Target0 = u_xlat10_0 \* vs_COLOR0;/.test(src[1]);
    });
    wrap("useProgram", function (a) { currentProgram = a[0]; });

    function isTrail() {
      return trailPainter && onScreen && currentProgram && currentProgram.__slopeTrail;
    }

    function paintTrail(args, method) {
      var program = currentProgram;
      try {
        return !!trailPainter({ gl: gl, program: program, draw: function () { raw[method].apply(gl, args); } });
      } catch (e) {
        console.error(e);
        return false;
      } finally {
        gl.useProgram(program);
      }
    }

    raw.drawArrays = gl.drawArrays;
    gl.drawArrays = function () {
      if (isTrail() && paintTrail(arguments, "drawArrays")) return;
      raw.drawArrays.apply(gl, arguments);
    };

    wrap("createBuffer", function (a, buffer) { if (buffer) buffer.__slopeId = nextId++; });
    wrap("bindBuffer", function (a) {
      if (a[0] === gl.ARRAY_BUFFER) arrayBuffer = a[1];
      else if (a[0] === gl.ELEMENT_ARRAY_BUFFER) vao.elements = a[1];
    });
    wrap("bindVertexArray", function (a) { vao = a[0] || defaultVao; if (!vao.__slopeInit) vao.__slopeInit = true; });
    wrap("vertexAttribPointer", function (a) {
      if (a[0] === 0) vao.attrib0 = { buffer: arrayBuffer, stride: a[4] || 12, offset: a[5] };
    });
    wrap("bufferData", function (a) {
      // Keep a copy of static meshes so their bounds can be measured.
      var target = a[0] === gl.ELEMENT_ARRAY_BUFFER ? vao.elements : arrayBuffer;
      if (!target) return;
      target.__slopeBounds = null;
      if (a[2] === STATIC_DRAW && typeof a[1] !== "number" && a[1]) {
        var src = a[1].buffer ? new Uint8Array(a[1].buffer, a[1].byteOffset || 0, a[1].byteLength) : new Uint8Array(a[1]);
        target.__slopeData = new Uint8Array(src);
      } else {
        target.__slopeData = null;
      }
    });
    wrap("bindFramebuffer", function (a) {
      if (a[0] === gl.FRAMEBUFFER || a[0] === DRAW_FRAMEBUFFER) onScreen = !a[1];
    });
    wrap("getUniformLocation", function (a, loc) {
      if (loc && (a[1] === VP_NAME || a[1] === O2W_NAME)) loc.__slopeName = a[1];
    });
    wrap("uniform4fv", function (a) {
      // Copy now: Emscripten passes views into memory it reuses for later calls.
      var name = a[0] && a[0].__slopeName;
      if (name === VP_NAME) vp = new Float32Array(a[1].subarray(0, 16));
      else if (name === O2W_NAME) o2w = new Float32Array(a[1].subarray(0, 16));
    });
    // The ball can be drawn by the page instead (ball skins): the painter
    // draws the game's own ball mesh with its own program, so position, size,
    // rolling and depth all stay the game's.
    function paintBall(args) {
      if (!ballPainter) return false;
      var program = gl.getParameter(gl.CURRENT_PROGRAM);
      try {
        return !!ballPainter({ gl: gl, vp: vp, o2w: o2w, draw: function () { raw.drawElements.apply(gl, args); } });
      } catch (e) {
        console.error(e);
        return false;
      } finally {
        gl.useProgram(program);
      }
    }

    raw.drawElements = gl.drawElements;
    gl.drawElements = function (mode, count) {
      var seen = onScreen && vp && o2w && isPerspective(vp);
      var isBall = seen && count === BALL_INDEX_COUNT;
      var painted = isBall ? paintBall(arguments) : isTrail() && paintTrail(arguments, "drawElements");
      if (!painted) raw.drawElements.apply(gl, arguments);
      if (!seen) return;
      frame = frame || newFrame();
      if (isBall) {
        frame.vp = vp;
        frame.ball = toSlope([o2w[12], o2w[13], o2w[14]]);
        frame.ball.world = [o2w[12], o2w[13], o2w[14]];
        if (!frame.sceneDrawn) {
          frame.sceneDrawn = true;
          drawScene(vp);
        }
        return;
      }
      var bounds = localBounds(gl, vao, count, arguments[2], arguments[3]);
      if (!bounds) return;
      var ext = slopeExtent(o2w, bounds);
      var width = ext.x1 - ext.x0;
      if (width > 3 && width < 14 && ext.s1 - ext.s0 < 600) frame.pieces.push(ext);
    };
  }

  var getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    var gl = getContext.apply(this, arguments);
    if (gl && this.id === "#canvas" && /webgl/.test(type) && !gl.__slopeBridge) {
      gl.__slopeBridge = true;
      instrument(gl);
    }
    return gl;
  };

  // Hand each finished frame to listeners right after the game draws it, in
  // the same task, so anything drawn on top lines up with no lag.
  var raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    return raf.call(window, function (time) {
      callback(time);
      if (frame) {
        var done = frame; frame = null;
        if (done.ball) emit("frame", done);
      }
    });
  };

  window.SlopeGame = {
    on: on,
    send: function (eventName) {
      var instance = window.gameInstance;
      if (!instance || !instance.Module || !instance.Module.SendMessage) return false;
      try {
        instance.SendMessage("EventManager", "SendEvent", eventName);
        return true;
      } catch (e) {
        return false;
      }
    },
    inRun: function () { return inRun; },
    paintBall: function (fn) { ballPainter = fn || null; },
    paintTrail: function (fn) { trailPainter = fn || null; },
    toSlope: toSlope,
    // Slope coordinates back to world coordinates.
    toWorld: function (s, h, x) {
      return [x, (h - s) * SQRT1_2, (h + s) * SQRT1_2];
    }
  };
})();
