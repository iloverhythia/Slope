/*
 * Ball skins and the skin shop.
 *
 * Skins are bought with the gems collected on the track. The equipped skin
 * is drawn in place of the game's own ball (SlopeGame.paintBall), on the
 * game's ball mesh with a pattern shader, so it rolls, lights and hides
 * behind walls exactly like the original. The track colour setting tints the
 * whole picture, skins included, so the shop previews use the same tint.
 *
 * The shop opens from the gem counter in the HUD and from the Career screen.
 *
 *   SlopeShop.open(returnFocusTo)
 *   SlopeShop.skins            the skin list
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  // --- Point sets for the cell patterns -------------------------------------

  function normalize(v) {
    var l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function mid(a, b) { return normalize([a[0] + b[0], a[1] + b[1], a[2] + b[2]]); }
  function centre(a, b, c) { return normalize([a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]); }

  var PHI = (1 + Math.sqrt(5)) / 2;
  var ICO = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI],
    [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]].map(normalize);
  var ICO_FACES = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
    [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11],
    [6, 2, 10], [8, 6, 7], [9, 8, 1]];

  // Centres of an icosahedron's faces split in four: their cells are triangles.
  function geodesic() {
    var out = [];
    ICO_FACES.forEach(function (f) {
      var a = ICO[f[0]], b = ICO[f[1]], c = ICO[f[2]];
      var ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      out.push(centre(a, ab, ca), centre(ab, b, bc), centre(ca, bc, c), centre(ab, bc, ca));
    });
    return out;
  }

  // Corners and face centres: twelve pentagons and twenty hexagons.
  function football() {
    return ICO.concat(ICO_FACES.map(function (f) { return centre(ICO[f[0]], ICO[f[1]], ICO[f[2]]); }));
  }

  function fibonacci(n, jitter) {
    var seed = 7, out = [];
    function random() { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; }
    for (var i = 0; i < n; i++) {
      var y = 1 - (i + 0.5) * 2 / n, r = Math.sqrt(1 - y * y), a = i * 2.399963;
      out.push(normalize([Math.cos(a) * r + random() * jitter, y + random() * jitter, Math.sin(a) * r + random() * jitter]));
    }
    return out;
  }

  var MAX_POINTS = 80;

  // --- Skins -----------------------------------------------------------------

  var SKINS = [
    { id: "classic", name: "Classic", price: 0, pattern: 0 },
    { id: "stripes", name: "Stripes", price: 5, pattern: 1 },
    { id: "dots", name: "Dots", price: 10, pattern: 2, points: fibonacci(42, 0) },
    { id: "checker", name: "Checker", price: 15, pattern: 3 },
    { id: "cube", name: "Cube", price: 20, pattern: 4 },
    { id: "spiral", name: "Spiral", price: 25, pattern: 5 },
    { id: "geo", name: "Geo", price: 30, pattern: 6, points: geodesic() },
    { id: "football", name: "Football", price: 40, pattern: 7, points: football(), split: 12 },
    { id: "magma", name: "Magma", price: 50, pattern: 8, points: fibonacci(30, 0.35) },
    { id: "rainbow", name: "Rainbow", price: 60, pattern: 9 },
    { id: "gold", name: "Gold", price: 75, pattern: 10 }
  ];

  SKINS.forEach(function (skin) {
    var flat = new Float32Array(MAX_POINTS * 3);
    (skin.points || []).forEach(function (p, i) { flat.set(p, i * 3); });
    skin.flat = flat;
    skin.count = skin.points ? skin.points.length : 0;
  });

  function skinById(id) {
    for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i];
    return SKINS[0];
  }

  // --- Shader ----------------------------------------------------------------

  var VERTEX_SHADER = [
    "#version 300 es",
    "layout(location = 0) in vec3 aPos;",
    "uniform mat4 uViewProjection;",
    "uniform mat4 uObjectToWorld;",
    "out vec3 vLocal;",
    "out vec3 vNormal;",
    "out vec3 vWorld;",
    "void main() {",
    "  vec4 world = uObjectToWorld * vec4(aPos, 1.0);",
    "  vLocal = aPos;",
    "  vNormal = mat3(uObjectToWorld) * aPos;",
    "  vWorld = world.xyz;",
    "  gl_Position = uViewProjection * world;",
    "}"
  ].join("\n");

  var FRAGMENT_SHADER = [
    "#version 300 es",
    "precision highp float;",
    "in vec3 vLocal;",
    "in vec3 vNormal;",
    "in vec3 vWorld;",
    "uniform int uPattern;",
    "uniform vec3 uCamera;",
    "uniform vec3 uLight;",
    "uniform float uTime;",
    "uniform vec3 uPoints[" + MAX_POINTS + "];",
    "uniform int uCount;",
    "uniform int uSplit;",
    "out vec4 outColor;",
    "",
    "const float PI = 3.14159265;",
    "const vec3 NEON = vec3(0.15, 1.0, 0.15);",
    "",
    "// Antialiased masks: a line of half width w around d = 0, and x > 0.",
    "float line(float d, float w) { float a = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - a, w + a, d); }",
    "float fill(float x) { float a = fwidth(x) + 1e-4; return smoothstep(-a, a, x); }",
    "vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }",
    "",
    "// Distance to four great circles through the poles, 45 degrees apart.",
    "float meridians(vec3 p) {",
    "  return min(min(abs(p.x), abs(p.z)), min(abs(p.x + p.z), abs(p.x - p.z)) * 0.7071068);",
    "}",
    "",
    "// The two nearest points of the point set: their closeness, and the nearest one.",
    "vec3 cells(vec3 p) {",
    "  float b1 = -2.0, b2 = -2.0, nearest = 0.0;",
    "  for (int i = 0; i < " + MAX_POINTS + "; i++) {",
    "    if (i >= uCount) break;",
    "    float d = dot(p, uPoints[i]);",
    "    if (d > b1) { b2 = b1; b1 = d; nearest = float(i); } else if (d > b2) { b2 = d; }",
    "  }",
    "  return vec3(b1, b2, nearest);",
    "}",
    "",
    "void main() {",
    "  vec3 p = normalize(vLocal);",
    "  vec3 n = normalize(vNormal);",
    "  vec3 v = normalize(uCamera - vWorld);",
    "  float facing = max(dot(n, v), 0.0);",
    "  float shade = 0.45 + 0.55 * max(dot(n, uLight), 0.0) + 0.25 * pow(1.0 - facing, 3.0);",
    "  float lat = asin(clamp(p.y, -1.0, 1.0));",
    "  float lon = atan(p.z, p.x);",
    "  vec3 col = vec3(0.0);",
    "",
    "  if (uPattern == 0) {", // Classic: the game's own globe lines
    "    float d = abs(lat) > 1.26 ? min(abs(p.x), abs(p.z)) : meridians(p);",
    "    d = min(d, min(abs(lat), min(abs(abs(lat) - 0.61), abs(abs(lat) - 1.26))));",
    "    col = NEON * line(d, 0.045);",
    "  } else if (uPattern == 1) {", // Stripes
    "    col = mix(vec3(0.02), vec3(1.0, 0.1, 0.08), fill(cos(lat * 7.0))) * shade;",
    "  } else if (uPattern == 2) {", // Dots
    "    vec3 c = cells(p);",
    "    col = vec3(0.1, 1.0, 1.0) * line(sqrt(max(0.0, 2.0 - 2.0 * c.x)), 0.16);",
    "  } else if (uPattern == 3) {", // Checker
    "    col = mix(vec3(0.02), vec3(0.95), fill(sin(lon * 4.0) * sin(lat * 6.0))) * shade;",
    "  } else if (uPattern == 4) {", // Cube: stickers on a cube's faces
    "    vec3 a = abs(p);",
    "    vec2 uv; vec3 face;",
    "    if (a.x >= a.y && a.x >= a.z) { uv = p.yz / a.x; face = p.x > 0.0 ? vec3(1.0, 0.12, 0.1) : vec3(1.0, 0.5, 0.05); }",
    "    else if (a.y >= a.z) { uv = p.xz / a.y; face = p.y > 0.0 ? vec3(0.95) : vec3(1.0, 0.9, 0.1); }",
    "    else { uv = p.xy / a.z; face = p.z > 0.0 ? vec3(0.1, 0.35, 1.0) : vec3(0.1, 0.85, 0.25); }",
    "    vec2 g = abs(uv);",
    "    float d = min(min(abs(g.x - 0.3333), abs(g.y - 0.3333)), min(1.0 - g.x, 1.0 - g.y));",
    "    col = face * shade * (1.0 - line(d, 0.06));",
    "  } else if (uPattern == 5) {", // Spiral
    "    col = vec3(1.0, 0.2, 0.85) * fill(sin(2.0 * lon + 6.0 * lat) - 0.3);",
    "  } else if (uPattern == 6) {", // Geo: a geodesic dome's triangles
    "    vec3 c = cells(p);",
    "    col = vec3(0.85, 0.95, 1.0) * line(c.x - c.y, 0.012);",
    "  } else if (uPattern == 7) {", // Football
    "    vec3 c = cells(p);",
    "    vec3 base = c.z < float(uSplit) ? vec3(0.05) : vec3(0.95);",
    "    col = base * shade * (1.0 - 0.85 * line(c.x - c.y, 0.006));",
    "  } else if (uPattern == 8) {", // Magma: glowing cracks in dark rock
    "    vec3 c = cells(p);",
    "    float e = c.x - c.y;",
    "    float glow = 0.85 + 0.15 * sin(uTime * 2.0);",
    "    col = vec3(0.12, 0.03, 0.02) * shade + vec3(1.0, 0.3, 0.04) * exp(-e * 30.0) * 0.7 * glow;",
    "    col = mix(col, vec3(1.0, 0.85, 0.35) * glow, line(e, 0.012));",
    "  } else if (uPattern == 9) {", // Rainbow
    "    float slice = floor((lon + PI) / (PI / 4.0));",
    "    float gap = max(line(meridians(p), 0.03), line(abs(p.y), 0.03));",
    "    col = hue(slice / 8.0 + uTime * 0.05) * shade * (1.0 - gap);",
    "  } else {", // Gold
    "    vec3 r = reflect(-v, n);",
    "    vec3 sky = mix(vec3(0.2, 0.14, 0.05), vec3(1.0, 0.96, 0.85), smoothstep(-0.15, 0.6, r.y));",
    "    sky += vec3(0.7) * exp(-abs(r.y - 0.05) * 14.0);",
    "    vec3 gold = vec3(1.0, 0.74, 0.28);",
    "    col = gold * sky * (0.75 + 0.25 * max(dot(n, uLight), 0.0)) + gold * 0.4 * pow(1.0 - facing, 4.0);",
    "    col *= 1.0 - 0.6 * line(min(abs(p.y), abs(p.x)), 0.02);",
    "  }",
    "  // A faint rim keeps the round shape visible where the body is black.",
    "  col += vec3(0.1) * pow(1.0 - facing, 2.5) * step(max(col.r, max(col.g, col.b)), 0.04);",
    "  outColor = vec4(col, 1.0);",
    "}"
  ].join("\n");

  function Renderer(gl) {
    function shader(type, src) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    }
    var program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    var u = {};
    ["uViewProjection", "uObjectToWorld", "uPattern", "uCamera", "uLight", "uTime", "uPoints", "uCount", "uSplit"].forEach(function (name) {
      u[name] = gl.getUniformLocation(program, name);
    });
    this.gl = gl;
    this.use = function (skin, vp, o2w, camera, light, time) {
      gl.useProgram(program);
      gl.uniformMatrix4fv(u.uViewProjection, false, vp);
      gl.uniformMatrix4fv(u.uObjectToWorld, false, o2w);
      gl.uniform1i(u.uPattern, skin.pattern);
      gl.uniform3fv(u.uCamera, camera);
      gl.uniform3fv(u.uLight, light);
      gl.uniform1f(u.uTime, time);
      gl.uniform1i(u.uCount, skin.count);
      gl.uniform1i(u.uSplit, skin.split || 0);
      if (skin.count) gl.uniform3fv(u.uPoints, skin.flat);
    };
  }

  // --- Matrices (column-major, like WebGL) ---------------------------------

  function multiply(a, b) {
    var out = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  function rotation(axis, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    var m = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    var i = axis === "x" ? 1 : 0, j = axis === "z" ? 1 : 2;
    m[i * 4 + i] = c; m[i * 4 + j] = s; m[j * 4 + i] = -s; m[j * 4 + j] = c;
    return m;
  }

  function perspective(fovY, near, far) {
    var f = 1 / Math.tan(fovY / 2);
    return new Float32Array([f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
  }

  // The camera sits where the view-projection matrix sends points to w = 0
  // straight ahead: the third column of its inverse.
  function cameraPosition(m) {
    var a = m, inv = [];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    if (Math.abs(inv[11]) < 1e-9) return [0, 0, 0];
    return [inv[8] / inv[11], inv[9] / inv[11], inv[10] / inv[11]];
  }

  // --- The ball in the game --------------------------------------------------

  var LIGHT_GAME = normalize([0.35, 0.8, -0.5]);  // from above, behind the camera
  var equipped = skinById(profile.get().skin);
  var inGame = null;
  var inGameFailed = false;

  profile.onChange(function (p) { equipped = skinById(p.skin); });

  game.paintBall(function (ball) {
    if (equipped.id === "classic" || inGameFailed) return false;
    if (!inGame || inGame.gl !== ball.gl) {
      try {
        inGame = new Renderer(ball.gl);
      } catch (e) {
        inGameFailed = true; // e.g. no WebGL2: keep the game's own ball
        console.warn("Slope skins: can't draw skins here", e);
        return false;
      }
    }
    inGame.use(equipped, ball.vp, ball.o2w, cameraPosition(ball.vp), LIGHT_GAME, performance.now() / 1000);
    ball.draw();
    return true;
  });

  // --- Shop previews -----------------------------------------------------------

  var PREVIEW_CSS = 96;
  var LIGHT_PREVIEW = normalize([0.35, 0.8, 0.5]);
  var preview = null;

  function setupPreview() {
    var size = Math.round(PREVIEW_CSS * Math.min(2, window.devicePixelRatio || 1));
    var canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    var gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
    if (!gl) return null;
    var renderer;
    try { renderer = new Renderer(gl); } catch (e) { console.warn("Slope skins: no previews", e); return null; }

    // A unit sphere.
    var rows = 28, cols = 40, pos = [], idx = [];
    for (var r = 0; r <= rows; r++) {
      var t = r / rows * Math.PI;
      for (var c = 0; c <= cols; c++) {
        var f = c / cols * Math.PI * 2;
        pos.push(Math.sin(t) * Math.cos(f), Math.cos(t), Math.sin(t) * Math.sin(f));
      }
    }
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var i = r * (cols + 1) + c;
        idx.push(i, i + 1, i + cols + 1, i + 1, i + cols + 2, i + cols + 1);
      }
    }
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 0);

    var distance = 3.6;
    var vp = multiply(perspective(35 * Math.PI / 180, 0.1, 10),
      new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -distance, 1]));
    return { canvas: canvas, gl: gl, renderer: renderer, vp: vp, camera: [0, 0, distance], count: idx.length };
  }

  function drawPreview(skin, target, time) {
    var p = preview;
    // Rolls towards the viewer, tilted so the top shows, like the ball on the track.
    var o2w = multiply(rotation("z", 0.35), rotation("x", time * 0.8));
    p.gl.clear(p.gl.COLOR_BUFFER_BIT | p.gl.DEPTH_BUFFER_BIT);
    p.renderer.use(skin, p.vp, o2w, p.camera, LIGHT_PREVIEW, time);
    p.gl.drawElements(p.gl.TRIANGLES, p.count, p.gl.UNSIGNED_SHORT, 0);
    var ctx = target.getContext("2d");
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(p.canvas, 0, 0, target.width, target.height);
  }

  // --- Shop screen --------------------------------------------------------------

  var els = {};
  var openedFrom = null;
  var loop = 0;
  var lastFilter = null;
  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  function gemIcon() {
    return window.SlopeGems && window.SlopeGems.iconSvg ? window.SlopeGems.iconSvg(14, 12) : "";
  }

  function build(ui) {
    var screen = document.createElement("div");
    screen.className = "slope-career slope-shop";
    screen.id = "slope-shop";
    screen.setAttribute("role", "dialog");
    screen.setAttribute("aria-labelledby", "slope-shop-title");
    screen.hidden = true;
    screen.innerHTML =
      '<div class="slope-career-inner slope-shop-inner">' +
        '<h2 class="slope-career-title" id="slope-shop-title">Shop</h2>' +
        '<p class="slope-shop-balance">' + gemIcon().replace(/width="14" height="12"/, 'width="28" height="24"') +
          '<span class="slope-shop-gems">0</span><span class="slope-shop-gems-label">gems</span></p>' +
        '<p class="slope-shop-note">Collect gems on the track to buy ball skins.</p>' +
        '<ul class="slope-skins">' +
          SKINS.map(function (s) {
            return '<li class="slope-skin" data-skin="' + s.id + '">' +
              '<canvas class="slope-skin-preview" width="' + PREVIEW_CSS + '" height="' + PREVIEW_CSS + '" aria-hidden="true"></canvas>' +
              '<p class="slope-skin-name">' + s.name + "</p>" +
              '<p class="slope-skin-price"></p>' +
              '<button type="button" class="slope-btn slope-skin-action"></button>' +
            "</li>";
          }).join("") +
        "</ul>" +
        '<p class="slope-shop-status" role="status"></p>' +
        '<div class="slope-career-actions">' +
          '<button type="button" class="slope-btn slope-back">Back</button>' +
        "</div>" +
      "</div>";
    ui.root.appendChild(screen);

    els = {
      screen: screen,
      gems: screen.querySelector(".slope-shop-gems"),
      gemsLabel: screen.querySelector(".slope-shop-gems-label"),
      status: screen.querySelector(".slope-shop-status"),
      back: screen.querySelector(".slope-back"),
      cards: SKINS.map(function (s) {
        var li = screen.querySelector('[data-skin="' + s.id + '"]');
        return {
          skin: s,
          li: li,
          canvas: li.querySelector("canvas"),
          price: li.querySelector(".slope-skin-price"),
          action: li.querySelector(".slope-skin-action")
        };
      })
    };

    var scale = Math.min(2, window.devicePixelRatio || 1);
    els.cards.forEach(function (card) {
      card.canvas.width = card.canvas.height = Math.round(PREVIEW_CSS * scale);
      card.action.addEventListener("click", function () { choose(card.skin); });
    });
    els.back.addEventListener("click", close);
    screen.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    profile.onChange(render);
  }

  function render(p) {
    if (!els.screen) return;
    els.gems.textContent = String(p.gems);
    els.gemsLabel.textContent = p.gems === 1 ? "gem" : "gems";
    els.cards.forEach(function (card) {
      var s = card.skin;
      var owned = s.id === "classic" || p.skins.indexOf(s.id) !== -1;
      var on = skinById(p.skin).id === s.id;
      card.li.classList.toggle("is-equipped", on);
      card.action.disabled = false;
      card.action.removeAttribute("aria-pressed");
      if (on) {
        card.price.textContent = "On your ball";
        card.action.textContent = "Equipped";
        card.action.setAttribute("aria-pressed", "true");
        card.action.setAttribute("aria-label", s.name + ", equipped");
      } else if (owned) {
        card.price.textContent = "Owned";
        card.action.textContent = "Equip";
        card.action.setAttribute("aria-label", "Equip " + s.name);
      } else {
        var short = s.price - p.gems;
        card.price.innerHTML = gemIcon() + "<span>" + s.price + (short > 0 ? " (" + short + " more)" : "") + "</span>";
        card.action.textContent = "Buy";
        card.action.disabled = short > 0;
        card.action.setAttribute("aria-label", "Buy " + s.name + " for " + s.price + " gems" +
          (short > 0 ? ", you need " + short + " more" : ""));
      }
    });
  }

  function choose(skin) {
    var p = profile.get();
    if (skinById(p.skin).id === skin.id) return;
    if (skin.id === "classic" || p.skins.indexOf(skin.id) !== -1) {
      profile.equipSkin(skin.id);
      els.status.textContent = skin.name + " is on your ball.";
    } else if (profile.buySkin(skin.id, skin.price)) {
      els.status.textContent = "Bought " + skin.name + ". It's on your ball now.";
    } else {
      els.status.textContent = "You need " + (skin.price - p.gems) + " more gems for " + skin.name + ".";
    }
    var card = els.cards.filter(function (c) { return c.skin === skin; })[0];
    if (card) card.action.focus();
  }

  function drawPreviews(time) {
    var filter = (document.getElementById("gameContainer") || {}).style;
    filter = filter ? filter.filter : "";
    var tint = filter !== lastFilter;
    lastFilter = filter;
    els.cards.forEach(function (card) {
      if (tint) card.canvas.style.filter = filter; // match the track colour tint
      drawPreview(card.skin, card.canvas, time);
    });
  }

  function tick(now) {
    if (els.screen.hidden) { loop = 0; return; }
    drawPreviews(now / 1000);
    loop = reduceMotion.matches ? 0 : requestAnimationFrame(tick);
  }

  function open(from) {
    if (!els.screen) return;
    openedFrom = from || null;
    window.SlopeUI.closeSettings();
    var toast = window.SlopeUI.root.querySelector(".slope-toast");
    if (toast) toast.hidden = true;
    els.status.textContent = "";
    els.screen.hidden = false;
    els.screen.scrollTop = 0;
    if (preview === null) preview = setupPreview() || false;
    lastFilter = null;
    if (preview && !loop) loop = requestAnimationFrame(tick);
    els.back.focus({ preventScroll: true });
  }

  function close() {
    els.screen.hidden = true;
    if (openedFrom && document.contains(openedFrom)) openedFrom.focus();
    else if (els.screen.contains(document.activeElement)) document.activeElement.blur();
    openedFrom = null;
  }

  window.SlopeShop = { open: open, skins: SKINS };
  window.SlopeUI.ready(build);
})();
