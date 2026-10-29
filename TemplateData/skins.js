/*
 * Ball skins and the shop (skins here; backgrounds.js, slopes.js and
 * upgrades.js fill its other tabs).
 *
 * Skins are bought with the gems collected on the track. The equipped skin
 * is drawn in place of the game's own ball (SlopeGame.paintBall), on the
 * game's ball mesh with a pattern shader, so it rolls, lights and hides
 * behind walls exactly like the original. Each skin also has its own colour
 * for the ball's speed-up trail (SlopeGame.paintTrail): the game's trail,
 * recoloured, so it still only appears on speed up. The track colour
 * setting tints the whole picture, skins included, so the shop previews use
 * the same tint.
 *
 * The shop opens from the game's Shop menu button, the gem counter in the HUD
 * and the Career screen.
 *
 *   SlopeShop.open(returnFocusTo)
 *   SlopeShop.skins            the skin list
 *   SlopeSkins.secret(level)   the merge game's secret skin for a ball level
 *   SlopeSkins.image(skin)     a still picture of a skin (data URL)
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

  // trail: the colour of the ball's speed-up trail ("rainbow" cycles along
  // it); Classic keeps the game's own trail.
  var SKINS = [
    { id: "classic", name: "Classic", price: 0, pattern: 0, trail: null },
    { id: "stripes", name: "Stripes", price: 5, pattern: 1, trail: [1.0, 0.15, 0.1] },
    { id: "dots", name: "Dots", price: 10, pattern: 2, points: fibonacci(42, 0), trail: [0.1, 1.0, 1.0] },
    { id: "checker", name: "Checker", price: 15, pattern: 3, trail: [1.0, 1.0, 1.0] },
    { id: "cube", name: "Cube", price: 20, pattern: 4, trail: [0.2, 0.45, 1.0] },
    { id: "spiral", name: "Spiral", price: 25, pattern: 5, trail: [1.0, 0.2, 0.85] },
    { id: "basketball", name: "Basketball", price: 30, pattern: 11, trail: [1.0, 0.5, 0.1] },
    { id: "tennis", name: "Tennis", price: 30, pattern: 12, trail: [0.85, 1.0, 0.2] },
    { id: "geo", name: "Geo", price: 30, pattern: 6, points: geodesic(), trail: [0.7, 0.9, 1.0] },
    { id: "watermelon", name: "Watermelon", price: 35, pattern: 15, trail: [1.0, 0.3, 0.4] },
    { id: "football", name: "Football", price: 40, pattern: 7, points: football(), split: 12, trail: [0.95, 0.95, 0.95] },
    { id: "eightball", name: "8-Ball", price: 45, pattern: 13, trail: [0.85, 0.85, 1.0] },
    { id: "eyeball", name: "Eyeball", price: 45, pattern: 14, trail: [0.25, 0.55, 1.0] },
    { id: "magma", name: "Magma", price: 50, pattern: 8, points: fibonacci(30, 0.35), trail: [1.0, 0.45, 0.05] },
    { id: "moon", name: "Moon", price: 55, pattern: 17, points: fibonacci(26, 0.5), trail: [0.8, 0.8, 0.85] },
    { id: "ice", name: "Ice", price: 60, pattern: 20, points: fibonacci(22, 0.45), trail: [0.6, 0.9, 1.0] },
    { id: "rainbow", name: "Rainbow", price: 60, pattern: 9, trail: "rainbow" },
    { id: "earth", name: "Earth", price: 70, pattern: 16, trail: [0.2, 0.55, 1.0] },
    { id: "gold", name: "Gold", price: 75, pattern: 10, trail: [1.0, 0.75, 0.25] },
    { id: "disco", name: "Disco", price: 80, pattern: 19, trail: "rainbow" },
    { id: "galaxy", name: "Galaxy", price: 100, pattern: 18, trail: [0.6, 0.3, 1.0] },
    { id: "smiley", name: "Smiley", price: 30, pattern: 27, trail: [1.0, 0.85, 0.1] },
    { id: "zebra", name: "Zebra", price: 35, pattern: 22, trail: [0.95, 0.95, 0.95] },
    { id: "golf", name: "Golf", price: 35, pattern: 28, points: fibonacci(80, 0.05), trail: [0.9, 0.95, 0.9] },
    { id: "tiger", name: "Tiger", price: 40, pattern: 21, trail: [1.0, 0.55, 0.1] },
    { id: "camo", name: "Camo", price: 45, pattern: 23, trail: [0.5, 0.6, 0.3] },
    { id: "honeycomb", name: "Honeycomb", price: 50, pattern: 26, trail: [1.0, 0.7, 0.1] },
    { id: "marble", name: "Marble", price: 55, pattern: 24, trail: [0.85, 0.9, 1.0] },
    { id: "circuit", name: "Circuit", price: 65, pattern: 25, trail: [0.3, 1.0, 0.5] },
    { id: "sun", name: "Sun", price: 85, pattern: 29, trail: [1.0, 0.6, 0.1] },
    { id: "plasma", name: "Plasma", price: 120, pattern: 30, trail: "rainbow" },
    { id: "beachball", name: "Beach Ball", price: 30, pattern: 31, trail: [1.0, 0.85, 0.1] },
    { id: "cookie", name: "Cookie", price: 30, pattern: 40, points: fibonacci(28, 0.5), trail: [0.85, 0.6, 0.3] },
    { id: "peppermint", name: "Peppermint", price: 35, pattern: 41, trail: [1.0, 0.15, 0.2] },
    { id: "baseball", name: "Baseball", price: 35, pattern: 34, trail: [1.0, 0.2, 0.15] },
    { id: "volleyball", name: "Volleyball", price: 40, pattern: 35, trail: [1.0, 0.85, 0.15] },
    { id: "pumpkin", name: "Pumpkin", price: 45, pattern: 32, trail: [1.0, 0.55, 0.05] },
    { id: "sprinkles", name: "Sprinkles", price: 45, pattern: 33, points: fibonacci(70, 0.6), trail: "rainbow" },
    { id: "wood", name: "Wood", price: 45, pattern: 44, trail: [0.8, 0.55, 0.3] },
    { id: "bowling", name: "Bowling", price: 50, pattern: 36, trail: [0.6, 0.2, 1.0] },
    { id: "leopard", name: "Leopard", price: 55, pattern: 43, points: fibonacci(60, 0.45), trail: [1.0, 0.7, 0.3] },
    { id: "ocean", name: "Ocean", price: 60, pattern: 39, trail: [0.1, 0.6, 1.0] },
    { id: "cyber", name: "Cyber", price: 65, pattern: 37, trail: [0.1, 0.9, 1.0] },
    { id: "mars", name: "Mars", price: 70, pattern: 46, trail: [1.0, 0.35, 0.1] },
    { id: "tiedye", name: "Tie-Dye", price: 75, pattern: 45, trail: "rainbow" },
    { id: "jupiter", name: "Jupiter", price: 80, pattern: 42, trail: [0.95, 0.75, 0.5] },
    { id: "chrome", name: "Chrome", price: 90, pattern: 38, trail: [0.9, 0.95, 1.0] },
    { id: "hologram", name: "Hologram", price: 110, pattern: 48, trail: [0.3, 1.0, 1.0] },
    { id: "diamond", name: "Diamond", price: 150, pattern: 47, points: fibonacci(36, 0.3), trail: [0.75, 0.95, 1.0] }
  ];

  // The shop lists them cheapest first (Classic, free, stays first).
  SKINS.sort(function (a, b) { return a.price - b.price; });

  SKINS.forEach(function (skin) {
    var flat = new Float32Array(MAX_POINTS * 3);
    (skin.points || []).forEach(function (p, i) { flat.set(p, i * 3); });
    skin.flat = flat;
    skin.count = skin.points ? skin.points.length : 0;
  });

  function skinById(id) {
    var secret = /^secret-([1-9][0-9]{0,5})$/.exec(id || "");
    if (secret) return secretSkin(+secret[1]);
    for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i];
    return SKINS[0];
  }

  // --- Secret skins ------------------------------------------------------------
  // Each ball level of the merge game (merge.js) is a skin of its own, without
  // end: a shape and two colours picked from the level, and from level 10 a
  // glowing rim, from 20 sparkles, with more shine every level.

  var SECRET_NAMES = ["Pebble", "Spark", "Ember", "Comet", "Pulse", "Nova", "Orbit", "Flare", "Quartz", "Prism",
    "Vortex", "Nebula", "Pulsar", "Quasar", "Zenith", "Aurora", "Eclipse", "Halo", "Titan", "Infinity"];
  var ROMAN = ["", " II", " III", " IV", " V", " VI", " VII", " VIII", " IX", " X"];
  var secretCache = {};

  function hsv(h, s, v) {
    var c = [5, 3, 1].map(function (n) { var k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); });
    return c;
  }

  function secretSkin(level) {
    if (secretCache[level]) return secretCache[level];
    var seed = level * 977 + 13;
    function random() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var round = Math.floor((level - 1) / SECRET_NAMES.length);
    var name = SECRET_NAMES[(level - 1) % SECRET_NAMES.length] + (round < ROMAN.length ? ROMAN[round] : " " + (round + 1));
    var hueA = (0.13 + level * 0.618034) % 1, hueB = (hueA + 0.25 + random() * 0.5) % 1;
    var a = hsv(hueA, 0.85, 1), b = hsv(hueB, 0.7, level % 3 === 0 ? 0.15 : 0.95);
    var skin = {
      id: "secret-" + level,
      name: name,
      level: level,
      pattern: 49,
      count: 0,
      flat: new Float32Array(MAX_POINTS * 3),
      trail: a,
      secret: {
        a: a,
        b: b,
        p: [level <= 6 ? level - 1 : Math.floor(random() * 6), 3 + Math.floor(random() * 6), Math.min(1, level / 25), level >= 10 ? Math.min(1, (level - 9) / 20) : 0],
        q: [level >= 20 ? 1 : 0, 0.3 + random() * 0.9, 0, 0]
      }
    };
    secretCache[level] = skin;
    return skin;
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
    "uniform vec3 uTint;",
    "uniform int uBakeTint;",
    "uniform vec3 uSecretA, uSecretB;",
    "uniform vec4 uSecretP, uSecretQ;",
    "out vec4 outColor;",
    "",
    "const float PI = 3.14159265;",
    "const vec3 NEON = vec3(0.15, 1.0, 0.15);",
    "",
    "// Antialiased masks: a line of half width w around d = 0, and x > 0.",
    "float line(float d, float w) { float a = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - a, w + a, d); }",
    "float fill(float x) { float a = fwidth(x) + 1e-4; return smoothstep(-a, a, x); }",
    "vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }",
    "float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }",
    "float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }",
    "float noise3(vec3 x) {",
    "  vec3 i = floor(x), f = fract(x);",
    "  f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),",
    "             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);",
    "}",
    "float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise3(p); p *= 2.03; a *= 0.5; } return v; }",
    "",
    "// Distance to four great circles through the poles, 45 degrees apart.",
    "float meridians(vec3 p) {",
    "  return min(min(abs(p.x), abs(p.z)), min(abs(p.x + p.z), abs(p.x - p.z)) * 0.7071068);",
    "}",
    "",
    "// Which face of a cube around the ball p is on (1 to 6), and where on it (-1 to 1).",
    "float cubeFace(vec3 p, out vec2 uv) {",
    "  vec3 a = abs(p);",
    "  if (a.x >= a.y && a.x >= a.z) { uv = p.yz / a.x; return p.x > 0.0 ? 1.0 : 2.0; }",
    "  if (a.y >= a.z) { uv = p.xz / a.y; return p.y > 0.0 ? 3.0 : 4.0; }",
    "  uv = p.xy / a.z; return p.z > 0.0 ? 5.0 : 6.0;",
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
    "  } else if (uPattern == 10) {", // Gold
    "    vec3 r = reflect(-v, n);",
    "    vec3 sky = mix(vec3(0.2, 0.14, 0.05), vec3(1.0, 0.96, 0.85), smoothstep(-0.15, 0.6, r.y));",
    "    sky += vec3(0.7) * exp(-abs(r.y - 0.05) * 14.0);",
    "    vec3 gold = vec3(1.0, 0.74, 0.28);",
    "    col = gold * sky * (0.75 + 0.25 * max(dot(n, uLight), 0.0)) + gold * 0.4 * pow(1.0 - facing, 4.0);",
    "    col *= 1.0 - 0.6 * line(min(abs(p.y), abs(p.x)), 0.02);",
    "  } else if (uPattern == 11) {", // Basketball
    "    float d = min(min(abs(p.x), abs(p.y)), abs(abs(p.z) - 0.72));",
    "    vec3 leather = vec3(0.95, 0.42, 0.08) * (0.88 + 0.12 * noise3(p * 60.0));",
    "    col = leather * shade * (1.0 - 0.92 * line(d, 0.022));",
    "  } else if (uPattern == 12) {", // Tennis
    "    vec3 felt = vec3(0.8, 1.0, 0.22) * (0.85 + 0.15 * noise3(p * 45.0));",
    "    col = mix(felt, vec3(0.97), line(abs(lat - 0.5 * sin(2.0 * lon)), 0.065)) * shade;",
    "  } else if (uPattern == 13) {", // 8-Ball
    "    float dz = distance(p, vec3(0.0, 0.0, 1.0));",
    "    float disc = 1.0 - fill(dz - 0.42);",
    "    float r1 = length(p.xy - vec2(0.0, 0.105)), r2 = length(p.xy - vec2(0.0, -0.095));",
    "    float eight = line(min(abs(r1 - 0.07), abs(r2 - 0.085)), 0.022) * disc;",
    "    vec3 base = mix(vec3(0.02), vec3(0.95), disc) * (1.0 - eight);",
    "    float spec = pow(max(dot(reflect(-v, n), uLight), 0.0), 40.0);",
    "    col = base * shade + vec3(spec * 0.8) + vec3(0.12) * pow(1.0 - facing, 3.0);",
    "  } else if (uPattern == 14) {", // Eyeball
    "    float dz = distance(p, vec3(0.0, 0.0, 1.0));",
    "    float ang = atan(p.y, p.x);",
    "    vec3 iris = mix(vec3(0.05, 0.2, 0.6), vec3(0.3, 0.65, 1.0), 0.6 + 0.4 * sin(ang * 36.0)) * (1.0 - 0.5 * smoothstep(0.3, 0.42, dz));",
    "    vec3 white = vec3(0.96, 0.94, 0.9) * (1.0 - 0.35 * line(abs(fbm(p * 5.0) - 0.5), 0.012) * smoothstep(0.2, -0.6, p.z));",
    "    vec3 base = mix(white, iris, 1.0 - fill(dz - 0.42));",
    "    base = mix(base, vec3(0.01), 1.0 - fill(dz - 0.17));",
    "    float spec = pow(max(dot(reflect(-v, n), uLight), 0.0), 60.0);",
    "    col = base * shade + vec3(spec);",
    "  } else if (uPattern == 15) {", // Watermelon
    "    float stripe = fill(sin(lon * 7.0 + 0.5 * sin(lat * 5.0) + 0.3 * sin(lat * 11.0)) - 0.15);",
    "    col = mix(vec3(0.05, 0.32, 0.07), vec3(0.4, 0.78, 0.3), stripe) * shade;",
    "  } else if (uPattern == 16) {", // Earth
    "    float h = fbm(p * 2.2 + 3.1);",
    "    vec3 sea = mix(vec3(0.02, 0.12, 0.45), vec3(0.05, 0.3, 0.75), smoothstep(0.3, 0.52, h));",
    "    vec3 land = mix(vec3(0.12, 0.5, 0.14), vec3(0.6, 0.5, 0.28), smoothstep(0.55, 0.75, fbm(p * 4.0 + 9.0)));",
    "    vec3 base = mix(sea, land, fill(h - 0.52));",
    "    base = mix(base, vec3(0.95), fill(abs(p.y) - 0.86 + 0.05 * noise3(p * 8.0)));",
    "    col = base * shade + vec3(0.3, 0.6, 1.0) * pow(1.0 - facing, 3.0) * 0.6;",
    "  } else if (uPattern == 17) {", // Moon
    "    vec3 c = cells(p);",
    "    float d = sqrt(max(0.0, 2.0 - 2.0 * c.x));",
    "    float r = 0.1 + 0.14 * hash1(c.z);",
    "    float crater = hash1(c.z + 7.0) > 0.25 ? 1.0 : 0.0;",
    "    float g = 0.55 * (0.8 + 0.35 * fbm(p * 4.0));",
    "    g *= 1.0 - 0.25 * crater * (1.0 - fill(d - r));",
    "    g += 0.2 * crater * line(d - r, 0.02);",
    "    col = vec3(g) * shade;",
    "  } else if (uPattern == 18) {", // Galaxy
    "    float neb = fbm(p * 3.0);",
    "    vec3 base = mix(vec3(0.03, 0.0, 0.1), vec3(0.4, 0.1, 0.65), smoothstep(0.4, 0.8, neb));",
    "    base += vec3(0.1, 0.35, 0.7) * smoothstep(0.55, 0.9, fbm(p * 5.0 + 7.0));",
    "    vec3 q = p * 26.0;",
    "    float star = step(0.92, hash3(floor(q))) * (1.0 - smoothstep(0.0, 0.3, length(fract(q) - 0.5)));",
    "    col = base + vec3(star) * (0.7 + 0.3 * sin(uTime * 3.0 + hash3(floor(q)) * 40.0));",
    "  } else if (uPattern == 19) {", // Disco: mirror tiles
    "    float rows = 14.0, cols = 28.0;",
    "    vec2 uv = vec2((lon + PI) / (2.0 * PI) * cols, (lat + PI * 0.5) / PI * rows);",
    "    vec2 id = floor(uv), f = fract(uv);",
    "    float grout = line(min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)), 0.06);",
    "    float k = hash1(id.x * 31.0 + id.y * 7.0);",
    "    float flash = 0.55 + 0.45 * sin(uTime * 4.0 + k * 30.0);",
    "    vec3 r = reflect(-v, n);",
    "    vec3 mirror = vec3(0.75, 0.8, 0.9) * (0.4 + 0.6 * k) * (0.6 + 0.6 * smoothstep(-0.2, 0.8, r.y)) * flash;",
    "    col = mirror * (1.0 - 0.85 * grout);",
    "  } else if (uPattern == 20) {", // Ice
    "    vec3 c = cells(p);",
    "    vec3 base = mix(vec3(0.45, 0.7, 0.9), vec3(0.75, 0.9, 1.0), noise3(p * 6.0));",
    "    base = mix(base, vec3(0.97, 1.0, 1.0), line(c.x - c.y, 0.01) * 0.8);",
    "    col = base * shade + vec3(0.6, 0.85, 1.0) * pow(1.0 - facing, 2.5) * 0.7;",
    "  } else if (uPattern == 21) {", // Tiger
    "    float stripe = fill(sin(lon * 6.0 + 4.0 * fbm(p * 2.5)) - 0.45);",
    "    vec3 fur = mix(vec3(1.0, 0.55, 0.1), vec3(1.0, 0.85, 0.6), smoothstep(-0.5, -0.9, p.y));",
    "    col = mix(fur, vec3(0.03), stripe) * shade;",
    "  } else if (uPattern == 22) {", // Zebra
    "    float stripe = fill(sin(p.y * 13.0 + 3.0 * fbm(p * 2.0) + 1.5 * sin(lon * 2.0)));",
    "    col = mix(vec3(0.95), vec3(0.03), stripe) * shade;",
    "  } else if (uPattern == 23) {", // Camo
    "    float a = fbm(p * 2.6), b = fbm(p * 2.6 + 9.0);",
    "    vec3 c1 = mix(vec3(0.33, 0.36, 0.2), vec3(0.18, 0.25, 0.12), fill(a - 0.5));",
    "    c1 = mix(c1, vec3(0.32, 0.23, 0.13), fill(b - 0.56));",
    "    c1 = mix(c1, vec3(0.55, 0.5, 0.34), fill(a - b - 0.18));",
    "    col = c1 * shade;",
    "  } else if (uPattern == 24) {", // Marble
    "    float vein = abs(sin(p.x * 4.0 + p.y * 2.0 + fbm(p * 3.0) * 8.0));",
    "    vec3 base = mix(vec3(0.35, 0.38, 0.45), vec3(0.93, 0.92, 0.9), smoothstep(0.0, 0.25, vein));",
    "    float spec = pow(max(dot(reflect(-v, n), uLight), 0.0), 30.0);",
    "    col = base * shade + vec3(spec * 0.5);",
    "  } else if (uPattern == 25 || uPattern == 26) {", // Circuit, Honeycomb: on a cube's faces
    "    vec3 a = abs(p);",
    "    vec2 uv; float faceId;",
    "    if (a.x >= a.y && a.x >= a.z) { uv = p.yz / a.x; faceId = p.x > 0.0 ? 1.0 : 2.0; }",
    "    else if (a.y >= a.z) { uv = p.xz / a.y; faceId = p.y > 0.0 ? 3.0 : 4.0; }",
    "    else { uv = p.xy / a.z; faceId = p.z > 0.0 ? 5.0 : 6.0; }",
    "    if (uPattern == 25) {",
    "      vec2 q = uv * 3.0 + 3.0, cell = floor(q), f = fract(q);",
    "      float h = hash3(vec3(cell, faceId));",
    "      float trace = line(h < 0.5 ? abs(f.y - 0.5) : abs(f.x - 0.5), 0.07);",
    "      float pad = h > 0.75 ? line(abs(length(f - 0.5) - 0.16), 0.05) : 0.0;",
    "      vec3 board = vec3(0.02, 0.13, 0.07) * shade;",
    "      col = mix(board, vec3(0.3, 1.0, 0.5), max(trace, 0.0));",
    "      col = mix(col, vec3(1.0, 0.8, 0.3), pad);",
    "    } else {",
    "      vec2 q = uv * 3.0;",
    "      vec2 r = vec2(1.0, 1.7320508), hr = r * 0.5;",
    "      vec2 ga = mod(q, r) - hr, gb = mod(q - hr, r) - hr;",
    "      vec2 g = dot(ga, ga) < dot(gb, gb) ? ga : gb;",
    "      float edge = 0.5 - max(dot(abs(g), vec2(0.5, 0.8660254)), abs(g.x));",
    "      vec3 honey = mix(vec3(0.75, 0.42, 0.02), vec3(1.0, 0.78, 0.2), smoothstep(0.0, 0.4, edge));",
    "      col = mix(vec3(0.25, 0.12, 0.0), honey, smoothstep(0.03, 0.08, edge)) * shade;",
    "    }",
    "  } else if (uPattern == 27) {", // Smiley
    "    vec3 face = vec3(1.0, 0.86, 0.12);",
    "    float front = step(0.0, p.z);",
    "    float eyes = 1.0 - fill(min(length(p.xy - vec2(-0.25, 0.25)), length(p.xy - vec2(0.25, 0.25))) - 0.09);",
    "    float smile = line(abs(length(p.xy - vec2(0.0, 0.08)) - 0.42), 0.035) * step(p.y, -0.05);",
    "    col = mix(face, vec3(0.08, 0.05, 0.0), max(eyes, smile) * front) * shade;",
    "  } else if (uPattern == 28) {", // Golf: white with dimples
    "    vec3 c = cells(p);",
    "    float d = sqrt(max(0.0, 2.0 - 2.0 * c.x));",
    "    float dimple = 1.0 - smoothstep(0.0, 0.17, d);",
    "    col = vec3(0.95) * shade * (1.0 - 0.18 * dimple);",
    "  } else if (uPattern == 29) {", // Sun
    "    float glow = fbm(p * 3.0 + vec3(0.0, uTime * 0.25, 0.0));",
    "    col = mix(vec3(1.0, 0.42, 0.02), vec3(1.0, 0.95, 0.55), smoothstep(0.35, 0.75, glow));",
    "    col += vec3(1.0, 0.5, 0.1) * pow(1.0 - facing, 2.0) * 0.6;",
    "  } else if (uPattern == 30) {", // Plasma
    "    float t = uTime;",
    "    float k = sin(p.x * 6.0 + t) + sin(p.y * 7.0 - t * 1.3) + sin(p.z * 5.0 + t * 0.7) + sin(length(p.xy) * 8.0 - t);",
    "    col = hue(k * 0.25 + t * 0.05) * (0.8 + 0.2 * shade);",
    "  } else if (uPattern == 31) {", // Beach ball: six panels, white caps
    "    float seg = floor(mod(lon + PI, 2.0 * PI) / (PI / 3.0));",
    "    vec3 c = seg < 0.5 ? vec3(1.0, 0.15, 0.1) : seg < 1.5 ? vec3(0.97) : seg < 2.5 ? vec3(0.1, 0.4, 1.0)",
    "      : seg < 3.5 ? vec3(1.0, 0.85, 0.1) : seg < 4.5 ? vec3(0.97) : vec3(0.15, 0.8, 0.3);",
    "    c = mix(c, vec3(0.97), fill(abs(p.y) - 0.88));",
    "    float spec = pow(max(dot(reflect(-v, n), uLight), 0.0), 30.0);",
    "    col = c * shade + vec3(spec * 0.6);",
    "  } else if (uPattern == 32) {", // Pumpkin: ribs, a stem and a glowing face
    "    vec3 c = mix(vec3(0.5, 0.17, 0.02), vec3(1.0, 0.5, 0.05), smoothstep(0.0, 0.6, abs(sin(lon * 5.0))));",
    "    c = mix(c, vec3(0.25, 0.45, 0.1), fill(p.y - 0.93));",
    "    vec2 f = p.xy;",
    "    vec2 e1 = f - vec2(-0.27, 0.18), e2 = f - vec2(0.27, 0.18);",
    "    float eyes = max(fill(0.1 - 1.6 * abs(e1.x) - e1.y) * fill(e1.y + 0.08), fill(0.1 - 1.6 * abs(e2.x) - e2.y) * fill(e2.y + 0.08));",
    "    float my = -0.3 + 0.35 * f.x * f.x;",
    "    float teeth = 0.075 - 0.035 * step(0.5, fract(f.x * 6.0 + 0.25));",
    "    float mouth = fill(teeth - abs(f.y - my)) * fill(0.45 - abs(f.x));",
    "    float glow = 0.85 + 0.15 * sin(uTime * 5.0);",
    "    col = mix(c * shade, vec3(1.0, 0.8, 0.25) * glow, max(eyes, mouth) * step(0.0, p.z));",
    "  } else if (uPattern == 33) {", // Sprinkles: pink frosting, coloured sprinkles
    "    vec3 c = cells(p);",
    "    vec3 q = uPoints[int(c.z)];",
    "    vec3 t1 = normalize(cross(q, vec3(0.0, 1.0, 0.01))), t2 = cross(q, t1);",
    "    float an = hash1(c.z) * PI;",
    "    vec2 l = vec2(dot(p - q, t1), dot(p - q, t2));",
    "    l = vec2(cos(an) * l.x + sin(an) * l.y, -sin(an) * l.x + cos(an) * l.y);",
    "    float dash = length(max(abs(l) - vec2(0.055, 0.0), 0.0));",
    "    vec3 frosting = vec3(1.0, 0.55, 0.75) * (0.9 + 0.1 * noise3(p * 12.0));",
    "    col = mix(frosting, hue(hash1(c.z + 5.0)), line(dash, 0.022)) * shade;",
    "  } else if (uPattern == 34) {", // Baseball: red double stitching
    "    float d = lat - 0.45 * sin(2.0 * lon);",
    "    float stitch = line(abs(abs(d) - 0.055), 0.018) * step(0.5, fract(lon * 24.0 / PI));",
    "    vec3 leather = vec3(0.96, 0.94, 0.88) * (0.9 + 0.1 * noise3(p * 40.0));",
    "    leather *= 1.0 - 0.12 * line(abs(d), 0.012);",
    "    col = mix(leather, vec3(0.85, 0.08, 0.06), stitch) * shade;",
    "  } else if (uPattern == 35) {", // Volleyball: three panels on each face of a cube
    "    vec2 uv; float face = cubeFace(p, uv);",
    "    float across = mod(face, 2.0) < 0.5 ? uv.x : uv.y;",
    "    float strip = floor(clamp((across + 1.0) * 1.5, 0.0, 2.99));",
    "    vec3 c = strip == 1.0 ? vec3(1.0, 0.84, 0.15) : (mod(face, 3.0) < 0.5 ? vec3(0.1, 0.35, 0.9) : vec3(0.97));",
    "    float seam = min(abs(fract((across + 1.0) * 1.5) - 0.5) * -1.0 + 0.5, min(1.0 - abs(uv.x), 1.0 - abs(uv.y)));",
    "    col = c * shade * (1.0 - 0.75 * line(seam, 0.035));",
    "  } else if (uPattern == 36) {", // Bowling: glossy swirl, three finger holes
    "    float sw = sin(fbm(p * 2.5) * 12.0) * 0.5 + 0.5;",
    "    vec3 c = mix(vec3(0.15, 0.02, 0.35), vec3(0.45, 0.12, 0.8), smoothstep(0.3, 0.7, sw));",
    "    float dh = min(min(distance(p, normalize(vec3(-0.13, 0.45, 0.88))), distance(p, normalize(vec3(0.13, 0.45, 0.88)))),",
    "      distance(p, normalize(vec3(0.0, 0.15, 0.99))));",
    "    c = mix(c, vec3(0.01), 1.0 - fill(dh - 0.07));",
    "    float spec = pow(max(dot(reflect(-v, n), uLight), 0.0), 50.0);",
    "    col = c * shade + vec3(spec * 0.9) + vec3(0.25, 0.1, 0.4) * pow(1.0 - facing, 3.0);",
    "  } else if (uPattern == 37) {", // Cyber: a glowing grid with pulses
    "    float d1 = abs(fract(lon * 4.0 / PI + 0.5) - 0.5) * (PI / 4.0) * cos(lat);",
    "    float d2 = abs(fract(lat * 8.0 / PI + 0.5) - 0.5) * (PI / 8.0);",
    "    float d = min(d1, d2);",
    "    float pulse = 0.5 + 0.5 * sin(lat * 6.0 - uTime * 3.0);",
    "    col = vec3(0.1, 0.9, 1.0) * (line(d, 0.018) + 0.35 * exp(-d * 40.0) * pulse) + vec3(0.0, 0.03, 0.06);",
    "  } else if (uPattern == 38) {", // Chrome: a mirror of a bright sky and dark ground
    "    vec3 r = reflect(-v, n);",
    "    vec3 env = r.y > 0.0 ? mix(vec3(0.55, 0.6, 0.7), vec3(0.95, 0.97, 1.0), r.y) : mix(vec3(0.18), vec3(0.4), -r.y);",
    "    env += vec3(0.6) * exp(-abs(r.y) * 30.0);",
    "    col = env * 0.9 + vec3(pow(max(dot(r, uLight), 0.0), 80.0));",
    "  } else if (uPattern == 39) {", // Ocean: rolling waves and foam
    "    float w = fbm(p * 3.0 + vec3(uTime * 0.2, 0.0, uTime * 0.15));",
    "    vec3 c = mix(vec3(0.0, 0.2, 0.45), vec3(0.1, 0.55, 0.8), smoothstep(0.3, 0.7, w));",
    "    c += vec3(0.8, 0.95, 1.0) * line(abs(w - 0.62), 0.012) * 0.8;",
    "    float spec = pow(max(dot(reflect(-v, n), uLight), 0.0), 40.0);",
    "    col = c * shade + vec3(spec * 0.6);",
    "  } else if (uPattern == 40) {", // Cookie: dough with chocolate chips
    "    vec3 c = cells(p);",
    "    float d = sqrt(max(0.0, 2.0 - 2.0 * c.x));",
    "    float chip = hash1(c.z + 3.0) > 0.35 ? 1.0 - fill(d - 0.06 - 0.07 * hash1(c.z) - 0.02 * noise3(p * 30.0)) : 0.0;",
    "    vec3 dough = vec3(0.82, 0.6, 0.32) * (0.8 + 0.25 * fbm(p * 8.0));",
    "    col = mix(dough, vec3(0.2, 0.09, 0.03), chip) * shade;",
    "  } else if (uPattern == 41) {", // Peppermint: a red and white swirl
    "    float sw = sin(atan(p.y, p.x) * 8.0 + acos(clamp(p.z, -1.0, 1.0)) * 3.0);",
    "    float spec = pow(max(dot(reflect(-v, n), uLight), 0.0), 40.0);",
    "    col = mix(vec3(0.97), vec3(0.9, 0.05, 0.1), fill(sw - 0.1)) * shade + vec3(spec * 0.7);",
    "  } else if (uPattern == 42) {", // Jupiter: cloud bands and a great red spot
    "    float b = p.y * 9.0 + 0.6 * fbm(p * vec3(3.0, 12.0, 3.0) + vec3(uTime * 0.03, 0.0, 0.0));",
    "    vec3 c = mix(vec3(0.75, 0.6, 0.45), vec3(0.95, 0.88, 0.75), 0.5 + 0.5 * sin(b));",
    "    c = mix(c, vec3(0.6, 0.38, 0.25), smoothstep(0.6, 1.0, sin(b * 0.5 + 1.0)) * 0.5);",
    "    float spot = length((p - normalize(vec3(0.5, -0.35, 0.8))) * vec3(1.0, 1.8, 1.0));",
    "    c = mix(c, vec3(0.8, 0.3, 0.15), 1.0 - smoothstep(0.1, 0.17, spot));",
    "    col = c * shade;",
    "  } else if (uPattern == 43) {", // Leopard: broken rosettes
    "    vec3 c = cells(p);",
    "    float d = sqrt(max(0.0, 2.0 - 2.0 * c.x)) + 0.04 * (noise3(p * 20.0) - 0.5);",
    "    float r = 0.075 + 0.03 * hash1(c.z);",
    "    vec3 fur = mix(vec3(0.92, 0.68, 0.32), vec3(0.8, 0.5, 0.18), 1.0 - fill(d - r + 0.01));",
    "    float ring = line(d - r, 0.022 + 0.01 * hash1(c.z + 2.0)) * step(0.25, noise3(p * 16.0));",
    "    col = mix(fur, vec3(0.08, 0.05, 0.02), ring) * shade;",
    "  } else if (uPattern == 44) {", // Wood: rings and grain under varnish
    "    float rr = length(p.xz + vec2(0.3, 0.2)) * 9.0 + 1.5 * fbm(p * 3.0) + 0.3 * noise3(p * vec3(40.0, 8.0, 40.0));",
    "    float g = fract(rr);",
    "    vec3 c = mix(vec3(0.5, 0.29, 0.12), vec3(0.78, 0.54, 0.3), smoothstep(0.0, 0.7, g) * (1.0 - smoothstep(0.85, 1.0, g)));",
    "    float spec = pow(max(dot(reflect(-v, n), uLight), 0.0), 25.0);",
    "    col = c * shade + vec3(spec * 0.25);",
    "  } else if (uPattern == 45) {", // Tie-dye: a swirl of colours
    "    float k = atan(p.y, p.x) / (2.0 * PI) * 3.0 + acos(clamp(p.z, -1.0, 1.0)) * 1.2 + 0.25 * fbm(p * 3.0);",
    "    col = hue(k) * (0.8 + 0.2 * shade) * (0.8 + 0.2 * sin(k * 25.0));",
    "  } else if (uPattern == 46) {", // Mars: rusty plains, dark lands, an ice cap
    "    vec3 c = mix(vec3(0.55, 0.18, 0.07), vec3(0.85, 0.42, 0.18), smoothstep(0.35, 0.7, fbm(p * 2.5 + 11.0)));",
    "    c = mix(c, vec3(0.35, 0.12, 0.06), smoothstep(0.62, 0.8, fbm(p * 5.0)));",
    "    c = mix(c, vec3(0.95, 0.92, 0.9), fill(p.y - 0.9 + 0.04 * noise3(p * 10.0)));",
    "    col = c * shade + vec3(0.9, 0.4, 0.2) * pow(1.0 - facing, 3.0) * 0.4;",
    "  } else if (uPattern == 47) {", // Diamond: sparkling facets
    "    vec3 c = cells(p);",
    "    float k = hash1(c.z);",
    "    float sparkle = pow(0.5 + 0.5 * sin(uTime * 2.0 + k * 30.0), 8.0);",
    "    vec3 facet = mix(vec3(0.55, 0.75, 0.95), vec3(1.0), k) * (0.6 + 0.4 * shade);",
    "    facet += hue(k + uTime * 0.1) * 0.35 * sparkle;",
    "    col = mix(facet, vec3(1.0), line(c.x - c.y, 0.008) * 0.8);",
    "  } else if (uPattern == 48) {", // Hologram: scanlines, flicker and a bright rim
    "    float scan = 0.6 + 0.4 * sin(vWorld.y * 60.0 - uTime * 6.0);",
    "    float flick = 0.85 + 0.15 * sin(uTime * 23.0) * sin(uTime * 7.0);",
    "    col = vec3(0.2, 0.9, 1.0) * (0.15 + 0.85 * pow(1.0 - facing, 2.0)) * scan * flick;",
    "    col += vec3(0.6, 1.0, 1.0) * line(meridians(p), 0.015) * 0.5;",
    "  } else if (uPattern == 49) {", // Secret skins from the merge game: one shape, two colours, more shine each level
    "    int kind = int(uSecretP.x + 0.5);",
    "    float f = uSecretP.y, t = uTime * uSecretQ.y, m;",
    "    if (kind == 0) m = fill(sin(lat * f * 2.0 + t));",
    "    else if (kind == 1) m = fill(sin(lon * f + t) * sin(lat * f));",
    "    else if (kind == 2) m = fill(sin(lon * 2.0 + lat * f * 1.5 + t));",
    "    else if (kind == 3) m = fill(sin(acos(clamp(p.z, -1.0, 1.0)) * f * 2.0 - t * 2.0));",
    "    else if (kind == 4) m = smoothstep(0.42, 0.58, fbm(p * f * 0.6 + vec3(t * 0.2)));",
    "    else m = fill(sin(p.x * f + sin(p.y * f * 0.7 + t) * 2.0));",
    "    vec3 c = mix(uSecretB, uSecretA, m);",
    "    float spec = pow(max(dot(reflect(-v, n), uLight), 0.0), 20.0 + 80.0 * uSecretP.z);",
    "    col = c * shade + vec3(spec) * (0.15 + 0.85 * uSecretP.z);",
    "    col += uSecretA * uSecretP.w * (0.6 + 0.4 * sin(uTime * 3.0)) * pow(1.0 - facing, 2.0);",
    "    if (uSecretQ.x > 0.5) {",
    "      vec3 q = p * 22.0;",
    "      float h = hash3(floor(q));",
    "      col += vec3(step(0.93, h) * (1.0 - smoothstep(0.0, 0.3, length(fract(q) - 0.5)))) * (0.5 + 0.5 * sin(uTime * 4.0 + h * 50.0));",
    "    }",
    "  }",
    "  // A faint rim keeps the round shape visible where the body is black.",
    "  col += vec3(0.1) * pow(1.0 - facing, 2.5) * step(max(col.r, max(col.g, col.b)), 0.04);",
    "  // Shop previews bake in the track colour tint (the game gets it from CSS).",
    "  if (uBakeTint == 1) col = vec3(col.r + uTint.r * (col.g - col.b), uTint.g * col.g + (1.0 - uTint.g) * col.b, uTint.b * col.g + (1.0 - uTint.b) * col.b);",
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
    ["uViewProjection", "uObjectToWorld", "uPattern", "uCamera", "uLight", "uTime", "uPoints", "uCount", "uSplit", "uTint", "uBakeTint",
     "uSecretA", "uSecretB", "uSecretP", "uSecretQ"].forEach(function (name) {
      u[name] = gl.getUniformLocation(program, name);
    });
    this.gl = gl;
    this.use = function (skin, vp, o2w, camera, light, time, tint) {
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
      gl.uniform1i(u.uBakeTint, tint ? 1 : 0);
      if (tint) gl.uniform3fv(u.uTint, tint);
      if (skin.secret) {
        gl.uniform3fv(u.uSecretA, skin.secret.a);
        gl.uniform3fv(u.uSecretB, skin.secret.b);
        gl.uniform4fv(u.uSecretP, skin.secret.p);
        gl.uniform4fv(u.uSecretQ, skin.secret.q);
      }
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

  // --- The speed-up trail ----------------------------------------------------------
  // The game's own trail, drawn with a copy of the game's trail shader in the
  // skin's colour: same shape, same fade, and it still only shows when the
  // game shows it (on speed up).

  var TRAIL_OUTPUT = "SV_Target0 = u_xlat10_0 * vs_COLOR0;";
  var TINT_FUNCTION = [
    "uniform mediump vec3 uSlopeTint;",
    "uniform mediump float uSlopeRainbow;",
    "uniform highp float uSlopeTime;",
    "mediump vec4 slopeTint(mediump vec4 c, highp vec2 uv) {",
    "  mediump float k = max(c.r, max(c.g, c.b));",
    "  mediump vec3 tint = uSlopeRainbow > 0.5",
    "    ? clamp(abs(mod((uv.x * 1.5 - uSlopeTime * 0.5) * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0)",
    "    : uSlopeTint;",
    "  return vec4(tint * k, c.a);",
    "}"
  ].join("\n");
  var trailFailed = false;

  function tintedTrail(gl, unity) {
    if (unity.__slopeTint !== undefined) return unity.__slopeTint;
    unity.__slopeTint = null;
    var src = unity.__slopeSources;
    if (!src || src[1].indexOf(TRAIL_OUTPUT) === -1) return null;
    var fs = src[1].replace("void main()", TINT_FUNCTION + "\nvoid main()")
      .replace(TRAIL_OUTPUT, "SV_Target0 = slopeTint(u_xlat10_0 * vs_COLOR0, vs_TEXCOORD0.xy);");
    function shader(type, text) {
      var sh = gl.createShader(type);
      gl.shaderSource(sh, text);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    }
    var program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, src[0]));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fs));
    // Same attribute slots as the game's program, so the game's vertex data lines up.
    var i, n = gl.getProgramParameter(unity, gl.ACTIVE_ATTRIBUTES);
    for (i = 0; i < n; i++) {
      var attrib = gl.getActiveAttrib(unity, i);
      gl.bindAttribLocation(program, gl.getAttribLocation(unity, attrib.name), attrib.name);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    unity.__slopeTint = {
      program: program,
      locations: {},  // the game's uniform name -> this program's location
      tint: gl.getUniformLocation(program, "uSlopeTint"),
      rainbow: gl.getUniformLocation(program, "uSlopeRainbow"),
      time: gl.getUniformLocation(program, "uSlopeTime")
    };
    return unity.__slopeTint;
  }

  // The game's uniform values, as the bridge kept them when the game set them
  // (reading them back with getUniform would stall the GPU every frame).
  function copyUniforms(gl, unity, tinted) {
    var locs = unity.__slopeLocs || {};
    for (var name in locs) {
      var value = locs[name].__slopeValue;
      if (!value) continue;
      var to = tinted.locations[name];
      if (to === undefined) to = tinted.locations[name] = gl.getUniformLocation(tinted.program, name);
      if (to) gl[value[0]].apply(gl, [to].concat(value.slice(1)));
    }
  }

  game.paintTrail(function (t) {
    var trail = equipped.trail;
    if (!trail || trailFailed) return false;
    var gl = t.gl, tinted;
    try {
      tinted = tintedTrail(gl, t.program);
    } catch (e) {
      trailFailed = true; // keep the game's own trail
      console.warn("Slope skins: can't recolour the trail", e);
      return false;
    }
    if (!tinted) return false;
    gl.useProgram(tinted.program);
    copyUniforms(gl, t.program, tinted);
    var rainbow = trail === "rainbow";
    gl.uniform3fv(tinted.tint, rainbow ? [1, 1, 1] : trail);
    gl.uniform1f(tinted.rainbow, rainbow ? 1 : 0);
    gl.uniform1f(tinted.time, performance.now() / 1000);
    t.draw();
    return true;
  });

  // --- Shop previews -----------------------------------------------------------
  // One small WebGL canvas draws every preview. A preview is drawn once as a
  // still (when its card scrolls into view, a few per frame) and copied into
  // its card; only one card spins at a time: the one under the pointer or
  // focus, else the equipped skin. The track colour tint is baked into the
  // drawing, so the cards need no CSS filters.

  var PREVIEW_CSS = 88;
  var PREVIEW_SCALE = Math.min(1.5, window.devicePixelRatio || 1);
  var STILL = -0.35;          // roll angle of a still: front facing, top showing
  var SPIN_INTERVAL = 33;     // ms between frames of the spinning preview (~30 fps)
  var STILLS_PER_FRAME = 3;
  var LIGHT_PREVIEW = normalize([0.35, 0.8, 0.5]);
  var preview = null;

  function setupPreview() {
    var size = Math.round(PREVIEW_CSS * PREVIEW_SCALE);
    var canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    var gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
    if (!gl) return null;
    var renderer;
    try { renderer = new Renderer(gl); } catch (e) { console.warn("Slope skins: no previews", e); return null; }

    // A unit sphere.
    var rows = 24, cols = 32, pos = [], idx = [];
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
    return { canvas: canvas, gl: gl, renderer: renderer, vp: vp, camera: [0, 0, distance], count: idx.length, size: size };
  }

  function themeRgb() {
    var hex = (window.SlopeUI && window.SlopeUI.themeColor) || "#00ff00";
    var n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function drawPreview(skin, target, angle, time, tint) {
    var p = preview;
    // Rolls towards the viewer, tilted so the top shows, like the ball on the track.
    var o2w = multiply(rotation("z", 0.35), rotation("x", angle));
    p.gl.clear(p.gl.COLOR_BUFFER_BIT | p.gl.DEPTH_BUFFER_BIT);
    p.renderer.use(skin, p.vp, o2w, p.camera, LIGHT_PREVIEW, time, tint);
    p.gl.drawElements(p.gl.TRIANGLES, p.count, p.gl.UNSIGNED_SHORT, 0);
    var ctx = target.__ctx || (target.__ctx = target.getContext("2d"));
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(p.canvas, 0, 0, target.width, target.height);
  }

  // --- Shop screen --------------------------------------------------------------

  var els = {};
  var openedFrom = null;
  var loop = 0;
  var tab = "skins";
  var hovered = null;          // card under the pointer or focus
  var spinning = null;         // card spinning now
  var spinFrom = 0, lastSpin = 0;
  var stillTint = null;        // theme colour the stills were drawn in
  var lastTintCheck = 0;
  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  function gemIcon() {
    return window.SlopeGems && window.SlopeGems.iconSvg ? window.SlopeGems.iconSvg(14, 12) : "";
  }

  // What a skin costs now (the upgrade tree can take money off).
  function priceOf(skin) {
    return window.SlopeUpgrades && window.SlopeUpgrades.price ? window.SlopeUpgrades.price(skin.price) : skin.price;
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
          '<span class="slope-shop-gems">0</span><span class="slope-shop-gems-label">gems</span>' +
          '<span class="slope-shop-mult"></span></p>' +
        '<div class="slope-tabs" role="tablist" aria-label="Shop">' +
          '<button type="button" class="slope-btn slope-tab" role="tab" id="slope-tab-skins" aria-controls="slope-panel-skins" data-tab="skins">Skins</button>' +
          '<button type="button" class="slope-btn slope-tab" role="tab" id="slope-tab-backgrounds" aria-controls="slope-panel-backgrounds" data-tab="backgrounds">Backgrounds</button>' +
          '<button type="button" class="slope-btn slope-tab" role="tab" id="slope-tab-slope" aria-controls="slope-panel-slope" data-tab="slope">Slope</button>' +
          '<button type="button" class="slope-btn slope-tab" role="tab" id="slope-tab-upgrades" aria-controls="slope-panel-upgrades" data-tab="upgrades">Upgrades</button>' +
        "</div>" +
        '<div class="slope-tab-panel" role="tabpanel" id="slope-panel-skins" aria-labelledby="slope-tab-skins">' +
          '<p class="slope-shop-note">Collect gems on the track to buy ball skins. Each skin has its own speed-up trail.</p>' +
          '<ul class="slope-skins">' +
            SKINS.map(function (s) {
              return '<li class="slope-skin" data-skin="' + s.id + '">' +
                '<canvas class="slope-skin-preview" aria-hidden="true"></canvas>' +
                '<p class="slope-skin-name">' + s.name + "</p>" +
                '<p class="slope-skin-price"></p>' +
                '<button type="button" class="slope-btn slope-skin-action"></button>' +
              "</li>";
            }).join("") +
          "</ul>" +
          '<p class="slope-shop-status" role="status"></p>' +
        "</div>" +
        '<div class="slope-tab-panel" role="tabpanel" id="slope-panel-backgrounds" aria-labelledby="slope-tab-backgrounds" hidden></div>' +
        '<div class="slope-tab-panel" role="tabpanel" id="slope-panel-slope" aria-labelledby="slope-tab-slope" hidden></div>' +
        '<div class="slope-tab-panel" role="tabpanel" id="slope-panel-upgrades" aria-labelledby="slope-tab-upgrades" hidden></div>' +
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
      tabs: Array.prototype.slice.call(screen.querySelectorAll(".slope-tab")),
      panels: { skins: screen.querySelector("#slope-panel-skins"), backgrounds: screen.querySelector("#slope-panel-backgrounds"),
        slope: screen.querySelector("#slope-panel-slope"), upgrades: screen.querySelector("#slope-panel-upgrades") },
      cards: SKINS.map(function (s) {
        var li = screen.querySelector('[data-skin="' + s.id + '"]');
        return {
          skin: s,
          li: li,
          canvas: li.querySelector("canvas"),
          price: li.querySelector(".slope-skin-price"),
          action: li.querySelector(".slope-skin-action"),
          visible: false,
          dirty: true
        };
      })
    };

    els.cards.forEach(function (card) {
      card.canvas.width = card.canvas.height = Math.round(PREVIEW_CSS * PREVIEW_SCALE);
      card.li.__card = card;
      card.action.addEventListener("click", function () { choose(card.skin); });
      card.li.addEventListener("pointerenter", function () { hovered = card; });
      card.li.addEventListener("pointerleave", function () { if (hovered === card) hovered = null; });
      card.li.addEventListener("focusin", function () { hovered = card; });
    });
    els.tabs.forEach(function (b, i) {
      b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); });
      b.addEventListener("keydown", function (e) {
        var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        var to = els.tabs[(i + step + els.tabs.length) % els.tabs.length];
        showTab(to.getAttribute("data-tab"));
        to.focus();
      });
    });
    els.back.addEventListener("click", close);
    screen.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    // Only cards on screen get their previews drawn.
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { en.target.__card.visible = en.isIntersecting; });
      }, { root: screen, rootMargin: "120px" });
      els.cards.forEach(function (card) { io.observe(card.li); });
    } else {
      els.cards.forEach(function (card) { card.visible = true; });
    }

    showTab("skins");
    profile.onChange(render);
  }

  function showTab(name) {
    tab = name;
    els.tabs.forEach(function (b) {
      var on = b.getAttribute("data-tab") === name;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    Object.keys(els.panels).forEach(function (k) { els.panels[k].hidden = k !== name; });
    els.panels[name].dispatchEvent(new CustomEvent("slope-show"));
    if (!els.screen.hidden) startLoop();
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
        var price = priceOf(s), short = price - p.gems;
        card.price.innerHTML = gemIcon() + "<span>" + price + (short > 0 ? " (" + short + " more)" : "") + "</span>";
        card.action.textContent = "Buy";
        card.action.disabled = short > 0;
        card.action.setAttribute("aria-label", "Buy " + s.name + " for " + price + " gems" +
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
    } else if (profile.buySkin(skin.id, priceOf(skin))) {
      els.status.textContent = "Bought " + skin.name + ". It's on your ball now.";
    } else {
      els.status.textContent = "You need " + (priceOf(skin) - p.gems) + " more gems for " + skin.name + ".";
    }
    var card = els.cards.filter(function (c) { return c.skin === skin; })[0];
    if (card) card.action.focus();
  }

  function tick(now) {
    loop = 0;
    if (els.screen.hidden || tab !== "skins" || !preview) return;
    // A new track colour (or a step of rainbow mode) redraws the stills.
    var theme = window.SlopeUI.themeColor;
    if (theme !== stillTint && now - lastTintCheck > 400) {
      stillTint = theme;
      lastTintCheck = now;
      els.cards.forEach(function (card) { card.dirty = true; });
    }
    var tint = themeRgb();
    // The spinning card: under the pointer or focus, else the equipped one.
    var want = hovered || els.cards.filter(function (c) { return c.li.classList.contains("is-equipped"); })[0] || null;
    if (reduceMotion.matches) want = null;
    if (want !== spinning) {
      if (spinning) spinning.dirty = true; // back to its still
      spinning = want;
      spinFrom = now;
    }
    var budget = STILLS_PER_FRAME;
    for (var i = 0; i < els.cards.length && budget > 0; i++) {
      var card = els.cards[i];
      if (card.dirty && card.visible && card !== spinning) {
        drawPreview(card.skin, card.canvas, STILL, 0, tint);
        card.dirty = false;
        budget--;
      }
    }
    if (spinning && spinning.visible && now - lastSpin >= SPIN_INTERVAL) {
      lastSpin = now;
      drawPreview(spinning.skin, spinning.canvas, STILL + (now - spinFrom) / 1000 * 0.8, now / 1000, tint);
    }
    loop = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (preview === null) preview = setupPreview() || false;
    if (preview && !loop) loop = requestAnimationFrame(tick);
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
    // The game pauses behind the shop: nothing to see there, and the shop stays smooth.
    if (game.pause) game.pause("shop");
    showTab(tab);
    els.back.focus({ preventScroll: true });
  }

  function close() {
    els.screen.hidden = true;
    if (game.resume) game.resume("shop");
    hovered = null;
    if (openedFrom && document.contains(openedFrom)) openedFrom.focus();
    else if (els.screen.contains(document.activeElement)) document.activeElement.blur();
    openedFrom = null;
  }

  game.on("shop", function () { open(null); });

  // A still picture of a skin (the shop's preview drawing, with the track
  // colour tint), as a data URL for other screens. Kept per tint.
  var imageCache = {};
  function skinImage(skin) {
    var key = skin.id + "/" + ((window.SlopeUI && window.SlopeUI.themeColor) || "");
    if (imageCache[key]) return imageCache[key];
    if (preview === null) preview = setupPreview() || false;
    if (!preview) return null;
    var c = document.createElement("canvas");
    c.width = c.height = preview.size;
    drawPreview(skin, c, STILL, 0, themeRgb());
    return (imageCache[key] = c.toDataURL());
  }

  window.SlopeSkins = { byId: skinById, secret: secretSkin, image: skinImage };

  window.SlopeShop = {
    open: function (from, which) { if (which) tab = which; open(from); },
    tab: function () { return tab; },
    show: function (name) { if (els.panels && els.panels[name]) showTab(name); },
    skins: SKINS,
    panel: function (name) { return els.panels ? els.panels[name] : null; }
  };
  window.SlopeUI.ready(build);
})();
