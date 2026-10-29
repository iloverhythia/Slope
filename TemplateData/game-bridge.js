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
 *   SlopeGame.gameTime()           seconds on the game's clock (slower than real time on slow frames)
 *   SlopeGame.pause(reason) / resume(reason) / paused()
 *   SlopeGame.on("scene", fn, wants)  wants(): anything to draw this frame?
 *   SlopeGame.on("scene", function ({ gl, vp }) { ... })   WebGL2 only
 *   SlopeGame.paintBall(function ({ gl, vp, o2w, draw }) { ... return true; })
 *   SlopeGame.paintTrail(function ({ gl, program, draw }) { ... return true; })
 *   SlopeGame.paintBackground(function ({ gl, vp, width, height }) { ... })   behind the scene, each frame
 *   SlopeGame.retexture({ frame, edge, floor, tower, wall, block })   other tiles for the world
 *   SlopeGame.probeFloor([{ s, x }, ...], function (hits) { ... })   floor heights from the track geometry
 */
(function () {
  "use strict";

  var BALL_INDEX_COUNT = 2304;   // the ball's sphere mesh
  var VP_NAME = "hlslcc_mtx4x4unity_MatrixVP";
  var O2W_NAME = "hlslcc_mtx4x4unity_ObjectToWorld";
  var STATIC_DRAW = 0x88e4;
  var SQRT1_2 = Math.SQRT1_2;

  var handlers = {};
  var sceneWants = [];   // per "scene" handler: does it have anything to draw this frame?
  var ballPainter = null;
  var trailPainter = null;
  var backgroundPainter = null;
  var texturePainter = null;   // { kind: canvas } replacement tiles
  function on(name, fn, wants) {
    (handlers[name] = handlers[name] || []).push(fn);
    if (name === "scene") sceneWants.push(wants || function () { return true; });
  }
  var gameDrew = false;  // the game drew something in this animation frame
  var frameMs = 16;      // time between the game's frames, smoothed
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

  // Bytes of a WebGL upload source (WebGL2 bufferData/bufferSubData can take
  // an element offset and length into the source view).
  function asBytes(src, srcOffset, length) {
    if (!src.buffer) return new Uint8Array(src);
    var size = src.BYTES_PER_ELEMENT || 1;
    var start = (srcOffset || 0) * size;
    var n = length ? length * size : src.byteLength - start;
    return new Uint8Array(src.buffer, (src.byteOffset || 0) + start, n);
  }

  // --- Floor probes ---------------------------------------------------------------
  // "Where is the floor under these points?" Answered from the next frame's
  // track geometry: every surface of every mesh drawn, static or batched.
  // Each point gets the surfaces above it: { h, flat }, h in slope height,
  // flat when the surface is parallel to the slope (floors and tops; the
  // red side ramps are not).

  var probeQueue = [];   // asked for, answered during the next frame
  var probing = [];      // being answered during this frame's draws

  function probeMesh(gl, state, count, type, offset, m) {
    var attrib = state.attrib0, elems = state.elements;
    if (!attrib || !attrib.buffer || !elems) return;
    var vdata = attrib.buffer.__slopeData || attrib.buffer.__slopeLive;
    var idata = elems.__slopeData || elems.__slopeLive;
    if (!vdata || !idata) return;
    var wide = type === gl.UNSIGNED_INT, bpe = wide ? 4 : 2;
    if (offset % bpe || offset + count * bpe > idata.byteLength) return;
    var indices = wide ? new Uint32Array(idata.buffer, idata.byteOffset + offset, count)
      : new Uint16Array(idata.buffer, idata.byteOffset + offset, count);
    var verts = new DataView(vdata.buffer, vdata.byteOffset, vdata.byteLength);
    var stride = attrib.stride, base = attrib.offset;
    // Everything asked for this frame, with bounds for quick rejects: all of
    // it, and each request (usually a row of points at one distance).
    var smin = Infinity, smax = -Infinity, xmin = Infinity, xmax = -Infinity;
    var groups = probing.map(function (q) {
      var g = { s0: Infinity, s1: -Infinity, x0: Infinity, x1: -Infinity, pts: [] };
      q.points.forEach(function (p, j) {
        g.pts.push([p.s, p.x, q.hits[j]]);
        g.s0 = Math.min(g.s0, p.s); g.s1 = Math.max(g.s1, p.s); g.x0 = Math.min(g.x0, p.x); g.x1 = Math.max(g.x1, p.x);
      });
      smin = Math.min(smin, g.s0); smax = Math.max(smax, g.s1); xmin = Math.min(xmin, g.x0); xmax = Math.max(xmax, g.x1);
      return g;
    });
    var S = [0, 0, 0], H = [0, 0, 0], X = [0, 0, 0];
    for (var i = 0; i + 2 < count; i += 3) {
      for (var k = 0; k < 3; k++) {
        var p = base + indices[i + k] * stride;
        if (p + 12 > vdata.byteLength) return;
        var lx = verts.getFloat32(p, true), ly = verts.getFloat32(p + 4, true), lz = verts.getFloat32(p + 8, true);
        var wx = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
        var wy = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
        var wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
        S[k] = (wz - wy) * SQRT1_2; H[k] = (wy + wz) * SQRT1_2; X[k] = wx;
      }
      var ts0 = Math.min(S[0], S[1], S[2]), ts1 = Math.max(S[0], S[1], S[2]);
      var tx0 = Math.min(X[0], X[1], X[2]), tx1 = Math.max(X[0], X[1], X[2]);
      if (ts1 < smin || ts0 > smax || tx1 < xmin || tx0 > xmax) continue;
      var as = S[1] - S[0], ah = H[1] - H[0], ax = X[1] - X[0];
      var bs = S[2] - S[0], bh = H[2] - H[0], bx = X[2] - X[0];
      var nx = ah * bs - as * bh, nh = as * bx - ax * bs, ns = ax * bh - ah * bx;
      var len = Math.sqrt(nx * nx + nh * nh + ns * ns);
      if (len < 1e-9) continue;
      var flat = Math.abs(nh) >= 0.9 * len;
      var det = as * bx - bs * ax;
      if (Math.abs(det) < 1e-12) continue;
      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        if (grp.s1 < ts0 || grp.s0 > ts1 || grp.x1 < tx0 || grp.x0 > tx1) continue;
        for (var j = 0; j < grp.pts.length; j++) {
          var pt = grp.pts[j], ps = pt[0], px = pt[1];
          if (ps < ts0 || ps > ts1 || px < tx0 || px > tx1) continue;
          var u = ((ps - S[0]) * bx - bs * (px - X[0])) / det;
          var v = (as * (px - X[0]) - (ps - S[0]) * ax) / det;
          if (u < -1e-4 || v < -1e-4 || u + v > 1 + 1e-4) continue;
          pt[2].push({ h: H[0] + u * ah + v * bh, flat: flat });
        }
      }
    }
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

    // Runs draw() with the switches set by setup(), then puts back the game's
    // state. The state it changes is tracked as the game sets it, so saving
    // it needs no queries (a query like getParameter(DEPTH_FUNC) can stall
    // the GPU).
    function isolated(setup, draw) {
      var saved = {
        program: currentProgram,
        vertexArray: currentVao,
        arrayBinding: arrayBuffer,
        switches: SWITCHES.map(function (c) { return gl.isEnabled(c); }),
        depthFunc: depthFuncNow,
        depthMask: depthMaskNow,
        colorMask: colorMaskNow.slice(),
        tracked: { vao: vao, arrayBuffer: arrayBuffer }
      };
      setup(saved);
      try {
        draw();
      } finally {
        gl.useProgram(saved.program);
        raw.bindVertexArray.call(gl, saved.vertexArray);
        currentVao = saved.vertexArray;
        raw.bindBuffer.call(gl, gl.ARRAY_BUFFER, saved.arrayBinding);
        SWITCHES.forEach(function (c, i) { if (saved.switches[i]) gl.enable(c); else gl.disable(c); });
        gl.depthFunc(saved.depthFunc);
        gl.depthMask(saved.depthMask);
        gl.colorMask.apply(gl, saved.colorMask);
        vao = saved.tracked.vao;
        arrayBuffer = saved.tracked.arrayBuffer;
      }
    }

    function drawScene(viewProjection) {
      if (!handlers.scene || !gl.createVertexArray) return;
      if (!sceneWants.some(function (w) { try { return w(); } catch (e) { return false; } })) return;
      isolated(function () {
        SWITCHES.forEach(function (c) { if (c === gl.DEPTH_TEST) gl.enable(c); else gl.disable(c); });
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.colorMask(true, true, true, true);
      }, function () {
        emit("scene", { gl: gl, vp: viewProjection });
      });
    }

    // A background painter draws right after the camera's clear (colour and
    // depth, on screen), with no depth test or depth writes, so everything
    // the game draws lands on top of it. The clear's alpha is left alone and
    // the game's scissor rectangle still applies.
    //
    // Backgrounds are soft and full screen, so they are drawn into a small
    // image (about BACKGROUND_PIXELS) and stretched over the screen: one
    // texture read a pixel instead of the whole background shader. That pass
    // uses the browser's own framebuffer and viewport calls, past the
    // wrappers here and in quality.js, and puts back everything the game's
    // own state cache expects.
    //
    // On a slow device (long frames) the image is redrawn only every second
    // or third frame, and stretched over the screen every frame.
    var BACKGROUND_PIXELS = 250000;
    var bgEvery = 1, bgCount = 0;
    var sceneVp = null;   // the last view-projection the 3D scene was drawn with
    var activeTextureNow = gl.TEXTURE0;
    wrap("activeTexture", function (a) { activeTextureNow = a[0]; });
    var boundTex = {};   // texture unit -> the 2D texture the game has bound there
    wrap("bindTexture", function (a) { if (a[0] === gl.TEXTURE_2D) boundTex[activeTextureNow - gl.TEXTURE0] = a[1]; });

    // --- Track textures --------------------------------------------------
    // The whole world is tiled with a few 32x32 textures: black squares with
    // a neon edge or a neon middle. Each is recognised by its pixels when the
    // game uploads it (RGB, or DXT1 blocks: the first colour of a block on
    // the top edge and one in the middle) and tagged with a kind. A texture
    // painter can then have them drawn with other tiles: they are swapped
    // in for the draw only, and only for the 3D scene (the ball and the
    // menus use one of them too).
    function tone(rgb) {
      var r = rgb[0], g = rgb[1];
      if (g > 120 && g > r * 2) return "green";
      if (r > 120 && r > g * 2) return r > 200 ? "red" : "darkred";
      return "black";
    }
    function dxtColour(d, block) {
      var c = d[block * 8] | (d[block * 8 + 1] << 8);
      return [((c >> 11) & 31) * 8, ((c >> 5) & 63) * 4, (c & 31) * 8];
    }
    function tagTexture(kind) {
      var tex = boundTex[activeTextureNow - gl.TEXTURE0];
      if (tex && kind) tex.__slopeKind = kind;
    }
    wrap("texSubImage2D", function (a) {
      if (a[1] !== 0 || a[4] !== 32 || a[5] !== 32 || a[6] !== gl.RGB || !a[8] || !a[8].buffer) return;
      var px = a[8];
      function at(x, y) { var i = (y * 32 + x) * 3; return [px[i], px[i + 1], px[i + 2]]; }
      if (tone(at(16, 0)) !== "green" || tone(at(16, 16)) !== "black") return;
      tagTexture(tone(at(1, 1)) === "green" ? "frame" : "tower");
    });
    wrap("compressedTexSubImage2D", function (a) {
      if (a[1] !== 0 || a[4] !== 32 || a[5] !== 32 || !a[7] || !a[7].buffer || a[7].length < 512) return;
      var edge = tone(dxtColour(a[7], 4)), middle = tone(dxtColour(a[7], 27));
      var kind = edge === "green" && middle === "black" ? "edge"
        : edge === "black" && middle === "green" ? "floor"
        : edge === "red" && middle === "black" ? "wall"
        : edge === "darkred" && middle === "black" ? "block" : null;
      tagTexture(kind);
    });

    var textureFor = (function () {
      var made = [];
      return function (source) {
        for (var i = 0; i < made.length; i++) if (made[i].source === source) return made[i].tex;
        var unit = activeTextureNow - gl.TEXTURE0, before = boundTex[unit];
        var unpack = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
        var flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
        if (unpack) raw.bindBuffer.call(gl, gl.PIXEL_UNPACK_BUFFER, null);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        var tex = gl.createTexture();
        raw.bindTexture.call(gl, gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        var aniso = gl.getExtension("EXT_texture_filter_anisotropic");
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
        raw.bindTexture.call(gl, gl.TEXTURE_2D, before || null);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
        if (unpack) raw.bindBuffer.call(gl, gl.PIXEL_UNPACK_BUFFER, unpack);
        made.push({ source: source, tex: tex });
        // Old tiles nobody uses any more go.
        if (made.length > 24) gl.deleteTexture(made.shift().tex);
        return tex;
      };
    })();

    // Draws with unit 0's texture swapped for its replacement, if it has one.
    function drawRetextured(args) {
      var tex = boundTex[0], source = tex && tex.__slopeKind && texturePainter && texturePainter[tex.__slopeKind];
      if (!source) return raw.drawElements.apply(gl, args);
      var unit = activeTextureNow;
      try {
        var swap = textureFor(source);
        if (unit !== gl.TEXTURE0) native.activeTexture.call(gl, gl.TEXTURE0);
        raw.bindTexture.call(gl, gl.TEXTURE_2D, swap);
        raw.drawElements.apply(gl, args);
      } finally {
        raw.bindTexture.call(gl, gl.TEXTURE_2D, tex);
        if (unit !== gl.TEXTURE0) native.activeTexture.call(gl, unit);
      }
    }
    var native = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
    var bgTarget = null;

    function compile(vs, fs) {
      function shader(type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      }
      var program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      return program;
    }

    function backgroundTarget(w, h) {
      var t = bgTarget;
      if (!t) {
        t = bgTarget = { w: 0, h: 0, fbo: gl.createFramebuffer(), vao: gl.createVertexArray(), texture: null };
        t.program = compile([
          "#version 300 es",
          "void main() {",
          "  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));",
          "  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);",
          "}"].join("\n"), [
          "#version 300 es",
          "precision mediump float;",
          "uniform sampler2D uImage;",
          "uniform vec2 uSize;",
          "out vec4 outColor;",
          "void main() { outColor = vec4(texture(uImage, gl_FragCoord.xy / uSize).rgb, 1.0); }"].join("\n"));
        t.uImage = gl.getUniformLocation(t.program, "uImage");
        t.uSize = gl.getUniformLocation(t.program, "uSize");
        t.unit = Math.min(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS), 32) - 1;
      }
      if (t.w !== w || t.h !== h) {
        withUnit(t.unit, function () {
          if (t.texture) gl.deleteTexture(t.texture);
          t.texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t.texture);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        });
        native.bindFramebuffer.call(gl, DRAW_FRAMEBUFFER, t.fbo);
        gl.framebufferTexture2D(DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
        native.bindFramebuffer.call(gl, DRAW_FRAMEBUFFER, null);
        t.w = w; t.h = h;
      }
      return t;
    }

    // Runs fn with texture unit `unit` active, then puts back that unit's
    // texture and the active unit.
    function withUnit(unit, fn) {
      var before = activeTextureNow;
      native.activeTexture.call(gl, gl.TEXTURE0 + unit);
      var bound = gl.getParameter(gl.TEXTURE_BINDING_2D);
      try { fn(); } finally {
        gl.bindTexture(gl.TEXTURE_2D, bound);
        native.activeTexture.call(gl, before);
      }
    }

    function drawBackground() {
      isolated(function () {
        SWITCHES.forEach(function (c) { if (c !== gl.SCISSOR_TEST) gl.disable(c); });
        gl.depthMask(false);
        gl.colorMask(true, true, true, false);
      }, function () {
        try {
          var W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
          var k = Math.max(1, Math.sqrt(W * H / BACKGROUND_PIXELS));
          var w = Math.max(1, Math.round(W / k)), h = Math.max(1, Math.round(H / k));
          var fresh = !bgTarget || bgTarget.w !== w || bgTarget.h !== h;
          var t = backgroundTarget(w, h);
          if (frameMs > (bgEvery === 1 ? 24 : 46)) bgEvery = Math.min(3, bgEvery + 1);
          else if (frameMs < (bgEvery === 3 ? 34 : 18)) bgEvery = Math.max(1, bgEvery - 1);
          if (fresh || ++bgCount >= bgEvery) { bgCount = 0; paintBackgroundImage(t, w, h); }
          // Stretch it over the screen.
          gl.useProgram(t.program);
          gl.bindVertexArray(t.vao);
          withUnit(t.unit, function () {
            gl.bindTexture(gl.TEXTURE_2D, t.texture);
            gl.uniform1i(t.uImage, t.unit);
            gl.uniform2f(t.uSize, W, H);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          });
        } catch (e) {
          console.error(e);
        }
      });
    }

    function paintBackgroundImage(t, w, h) {
      var view = gl.getParameter(gl.VIEWPORT), scissor = gl.isEnabled(gl.SCISSOR_TEST);
      native.bindFramebuffer.call(gl, DRAW_FRAMEBUFFER, t.fbo);
      native.viewport.call(gl, 0, 0, w, h);
      if (scissor) gl.disable(gl.SCISSOR_TEST);
      try {
        backgroundPainter({ gl: gl, vp: sceneVp, width: w, height: h });
      } finally {
        native.bindFramebuffer.call(gl, DRAW_FRAMEBUFFER, null);
        native.viewport.call(gl, view[0], view[1], view[2], view[3]);
        if (scissor) gl.enable(gl.SCISSOR_TEST);
      }
    }
    wrap("clear", function (a) {
      var mask = a[0];
      if (backgroundPainter && onScreen && native && gl.createVertexArray && (mask & gl.COLOR_BUFFER_BIT) && (mask & gl.DEPTH_BUFFER_BIT) &&
          colorMaskNow[0] && colorMaskNow[1] && colorMaskNow[2]) drawBackground();
    });

    // The speed-up trail is drawn with the game's only shader that multiplies
    // a texture by vertex colours. Keep each program's sources so it can be
    // recognised (and copied by a trail painter).
    var currentProgram = null, currentVao = null;
    var depthFuncNow = gl.LESS, depthMaskNow = true, colorMaskNow = [true, true, true, true];
    wrap("depthFunc", function (a) { depthFuncNow = a[0]; });
    wrap("depthMask", function (a) { depthMaskNow = !!a[0]; });
    wrap("colorMask", function (a) { colorMaskNow = [!!a[0], !!a[1], !!a[2], !!a[3]]; });
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
    // A deleted object is no longer bound (and can't be bound again).
    wrap("deleteBuffer", function (a) { if (a[0] && a[0] === arrayBuffer) arrayBuffer = null; });
    wrap("deleteVertexArray", function (a) { if (a[0] && a[0] === currentVao) { currentVao = null; vao = defaultVao; } });

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
      gameDrew = true;
      if (isTrail() && paintTrail(arguments, "drawArrays")) return;
      raw.drawArrays.apply(gl, arguments);
    };

    wrap("createBuffer", function (a, buffer) { if (buffer) buffer.__slopeId = nextId++; });
    wrap("bindBuffer", function (a) {
      if (a[0] === gl.ARRAY_BUFFER) arrayBuffer = a[1];
      else if (a[0] === gl.ELEMENT_ARRAY_BUFFER) vao.elements = a[1];
    });
    wrap("bindVertexArray", function (a) { currentVao = a[0] || null; vao = a[0] || defaultVao; if (!vao.__slopeInit) vao.__slopeInit = true; });
    wrap("vertexAttribPointer", function (a) {
      if (a[0] === 0) vao.attrib0 = { buffer: arrayBuffer, stride: a[4] || 12, offset: a[5] };
    });
    wrap("bufferData", function (a) {
      // Keep a copy of static meshes so their bounds can be measured.
      var target = a[0] === gl.ELEMENT_ARRAY_BUFFER ? vao.elements : arrayBuffer;
      if (!target) return;
      target.__slopeBounds = null;
      var bytes = typeof a[1] === "number" ? null : asBytes(a[1]);
      if (a[2] === STATIC_DRAW && bytes) {
        target.__slopeData = new Uint8Array(bytes);
        target.__slopeLive = null;
      } else {
        // Per-frame geometry (the game's batched track pieces): a live copy,
        // read only by floor probes.
        target.__slopeData = null;
        target.__slopeLive = bytes ? new Uint8Array(bytes) : typeof a[1] === "number" ? new Uint8Array(a[1]) : null;
      }
    });
    wrap("bufferSubData", function (a) {
      var target = a[0] === gl.ELEMENT_ARRAY_BUFFER ? vao.elements : arrayBuffer;
      if (!target || !a[2]) return;
      var bytes = asBytes(a[2], a[3], a[4]), at = a[1] || 0;
      var copy = target.__slopeData || target.__slopeLive;
      if (!copy || copy.length < at + bytes.length) {
        var grown = new Uint8Array(at + bytes.length);
        if (copy) grown.set(copy);
        copy = grown;
        if (target.__slopeData) target.__slopeData = copy; else target.__slopeLive = copy;
      }
      copy.set(bytes, at);
      target.__slopeBounds = null;
    });
    wrap("bindFramebuffer", function (a) {
      if (a[0] === gl.FRAMEBUFFER || a[0] === DRAW_FRAMEBUFFER) onScreen = !a[1];
    });
    wrap("getUniformLocation", function (a, loc) {
      if (!loc) return;
      if (a[1] === VP_NAME || a[1] === O2W_NAME) loc.__slopeName = a[1];
      if (a[0] && a[0].__slopeTrail) {
        (a[0].__slopeLocs = a[0].__slopeLocs || {})[a[1]] = loc;
        loc.__slopeKeep = true;
      }
    });
    var o2wBuffer = new Float32Array(16);
    wrap("uniform4fv", function (a) {
      // Copy now: Emscripten passes views into memory it reuses for later calls.
      var loc = a[0];
      if (!loc) return;
      var name = loc.__slopeName;
      if (name === VP_NAME) vp = new Float32Array(a[1].subarray(0, 16));
      else if (name === O2W_NAME) { o2wBuffer.set(a[1].subarray(0, 16)); o2w = o2wBuffer; }
      if (loc.__slopeKeep) keep("uniform4fv", a);
    });
    // Keep a copy of a call's values: the location's __slopeValue is
    // [method, ...arguments after the location], replayable on another program.
    function keep(method, a) {
      var out = [method];
      for (var i = 1; i < a.length; i++) {
        var v = a[i];
        if (v && v.buffer) { // a view of the game's memory: copy just what is read
          var from = a[i + 1] || 0, len = a[i + 2];
          out.push(v.slice(from, len ? from + len : v.length));
          break;
        }
        out.push(v);
      }
      a[0].__slopeValue = out;
    }
    ["uniform1i", "uniform1f", "uniform2f", "uniform3f", "uniform4f",
     "uniform1iv", "uniform1fv", "uniform2fv", "uniform3fv", "uniform4iv",
     "uniformMatrix3fv", "uniformMatrix4fv"].forEach(function (method) {
      if (!gl[method]) return;
      wrap(method, function (a) { if (a[0] && a[0].__slopeKeep) keep(method, a); });
    });
    // The ball can be drawn by the page instead (ball skins): the painter
    // draws the game's own ball mesh with its own program, so position, size,
    // rolling and depth all stay the game's.
    function paintBall(args) {
      if (!ballPainter) return false;
      var program = currentProgram;
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
      gameDrew = true;
      var seen = onScreen && vp && o2w && isPerspective(vp);
      if (seen) sceneVp = vp;
      var isBall = seen && count === BALL_INDEX_COUNT;
      var painted = isBall ? paintBall(arguments) : isTrail() && paintTrail(arguments, "drawElements");
      if (!painted) {
        if (seen && !isBall && texturePainter && native) drawRetextured(arguments);
        else raw.drawElements.apply(gl, arguments);
      }
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
      if (probing.length) probeMesh(gl, vao, count, arguments[2], arguments[3], o2w);
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
  // The game's own clock: it moves with the frames, and a long frame counts
  // as at most a third of a second (Unity's maximum delta time), so on a slow
  // device it falls behind the wall clock. The game's delayed events (like
  // the track clean-up after a crash) run on it.
  var pauseReasons = {}, paused = false;
  function applyPause() {
    var instance = window.gameInstance, m = instance && instance.Module;
    if (!m || !m.pauseMainLoop || !m.SendMessage) return; // still loading
    var want = Object.keys(pauseReasons).length > 0;
    try {
      if (want && !paused) { m.pauseMainLoop(); paused = true; }
      else if (!want && paused) { m.resumeMainLoop(); paused = false; }
    } catch (e) { console.warn("Slope: can't pause the game", e); }
  }

  // Only frames the game draws count, so a paused game's clock stands still.
  var gameTime = 0, lastFrameTime = null;
  var raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    return raf.call(window, function (time) {
      gameDrew = false;
      // Probes asked for since the last answer are answered by the next frame
      // the game draws (other code's animation frames draw nothing).
      if (!probing.length && probeQueue.length) {
        probing = probeQueue;
        probeQueue = [];
      }
      try {
        callback(time);
      } finally {
        if (gameDrew && time !== lastFrameTime) {
          if (lastFrameTime !== null) {
            gameTime += Math.min(Math.max(0, time - lastFrameTime) / 1000, 1 / 3);
            frameMs += (Math.min(200, Math.max(0, time - lastFrameTime)) - frameMs) * 0.1;
          }
          lastFrameTime = time;
        }
        if (frame) {
          var answered = probing, done = frame;
          probing = [];
          frame = null;
          answered.forEach(function (q) {
            try { q.done(done.ball ? q.hits : null); } catch (e) { console.error(e); }
          });
          if (done.ball) emit("frame", done);
        }
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
    gameTime: function () { return gameTime; },
    // Pause the game while the page covers it (shop, career); resumes when
    // every reason to pause is gone.
    pause: function (reason) { pauseReasons[reason] = true; applyPause(); },
    resume: function (reason) { delete pauseReasons[reason]; applyPause(); },
    paused: function () { return paused; },
    paintBall: function (fn) { ballPainter = fn || null; },
    paintTrail: function (fn) { trailPainter = fn || null; },
    paintBackground: function (fn) { backgroundPainter = fn || null; },
    // Replacement tiles for the world's textures: { frame, edge, floor, tower,
    // wall, block } -> a canvas (square, a power of two), or null for the game's own.
    retexture: function (tiles) {
      var any = tiles && Object.keys(tiles).some(function (k) { return tiles[k]; });
      texturePainter = any ? tiles : null;
    },
    // Ask for the surfaces under points [{ s, x }]. done(hits) runs after the
    // next frame the game draws, with one array of { h, flat } per point, or
    // null if that frame had no ball (no 3D scene).
    probeFloor: function (points, done) {
      probeQueue.push({ points: points, hits: points.map(function () { return []; }), done: done });
    },
    toSlope: toSlope,
    // Slope coordinates back to world coordinates.
    toWorld: function (s, h, x) {
      return [x, (h - s) * SQRT1_2, (h + s) * SQRT1_2];
    }
  };
})();
