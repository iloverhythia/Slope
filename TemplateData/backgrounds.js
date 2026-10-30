/*
 * Backgrounds, bought in the shop's Backgrounds tab.
 *
 * The game's sky is plain black. A background is drawn right after the game
 * clears the screen each frame (SlopeGame.paintBackground), before anything
 * else, with no depth, so the track, the ball and the menus all land on top
 * of it. Each one is a small full-screen shader. Some of them line up with
 * the point where the track meets the horizon (worked out from the game's
 * camera), and some move with the ball.
 *
 * The track colour setting tints the whole picture, backgrounds included,
 * so the shop previews bake in the same tint.
 *
 *   SlopeBackgrounds.list      the background list
 *   SlopeBackgrounds.painter(gl)   the background in use, drawn in another WebGL2 context
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var BACKGROUNDS = [
    { id: "none", name: "Classic", price: 0, kind: 0 },
    { id: "starfield", name: "Starfield", price: 40, kind: 1 },
    { id: "prism", name: "Prism", price: 45, kind: 11 },
    { id: "snowfall", name: "Snowfall", price: 50, kind: 9 },
    { id: "daylight", name: "Daylight", price: 55, kind: 14 },
    { id: "sunset", name: "Sunset", price: 60, kind: 2 },
    { id: "deepsea", name: "Deep Sea", price: 65, kind: 6 },
    { id: "aurora", name: "Aurora", price: 70, kind: 4 },
    { id: "nebula", name: "Nebula", price: 75, kind: 5 },
    { id: "coderain", name: "Code Rain", price: 80, kind: 7 },
    { id: "hive", name: "Hive", price: 85, kind: 13 },
    { id: "storm", name: "Storm", price: 90, kind: 8, still: 3.1 * 12 + 0.02 },  // just after a strike
    { id: "inferno", name: "Inferno", price: 95, kind: 10 },
    { id: "synthwave", name: "Synthwave", price: 110, kind: 3 },
    { id: "planet", name: "Ringed Planet", price: 120, kind: 12 },
    { id: "galaxy", name: "Galaxy", price: 140, kind: 15 },
    { id: "blackhole", name: "Black Hole", price: 160, kind: 16 }
  ];

  function byId(id) {
    for (var i = 0; i < BACKGROUNDS.length; i++) if (BACKGROUNDS[i].id === id) return BACKGROUNDS[i];
    return BACKGROUNDS[0];
  }

  // --- Shader ----------------------------------------------------------------
  // One triangle covers the screen. q is the screen in units of half its
  // height (x scaled by the aspect ratio), v is where the track meets the
  // horizon in the same units, px is one pixel in those units.

  var VERTEX_SHADER = [
    "#version 300 es",
    "void main() {",
    "  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));",
    "  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);",
    "}"
  ].join("\n");

  var FRAGMENT_SHADER = [
    "#version 300 es",
    "precision highp float;",
    "uniform int uKind;",
    "uniform float uTime;",
    "uniform vec2 uSize;",
    "uniform vec2 uVanish;",
    "uniform float uTravel;",
    "uniform int uPreview;",
    "uniform vec3 uTint;",
    "uniform int uBakeTint;",
    "out vec4 outColor;",
    "",
    "const float PI = 3.14159265;",
    "const vec3 NEON = vec3(0.15, 1.0, 0.15);",
    "float t, px;",
    "",
    "float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }",
    "vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n + 17.0)); }",
    "float noise(vec2 p) {",
    "  vec2 i = floor(p), f = fract(p);",
    "  f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);",
    "}",
    "float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.02 + 3.1; a *= 0.5; } return v; }",
    "vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }",
    "float soft(float d, float r) { return 1.0 - smoothstep(r * 0.4, r, d); }",
    "",
    "// Twinkling stars on a grid of cells, at least a pixel wide.",
    "float stars(vec2 q, float scale, float density) {",
    "  vec2 g = q * scale, id = floor(g), f = fract(g) - 0.5;",
    "  float h = h21(id);",
    "  if (h < 1.0 - density) return 0.0;",
    "  vec2 o = (h22(id + 3.7) - 0.5) * 0.6;",
    "  float r = max(0.07, 1.3 * px * scale);",
    "  float tw = 0.6 + 0.4 * sin(t * (1.0 + h * 3.0) + h * 40.0);",
    "  return soft(length(f - o), r) * tw * (0.4 + 0.6 * fract(h * 13.0));",
    "}",
    "",
    "// Shop previews: a stretch of track in front, so the background is seen behind it.",
    "vec3 track(vec2 q, vec2 v, vec3 col) {",
    "  if (q.y > v.y) return col;",
    "  float k = (v.y - q.y) / (v.y + 1.0);",
    "  float half_ = 0.02 + 0.8 * k;",
    "  float dx = abs(q.x - v.x);",
    "  float inside = 1.0 - smoothstep(half_ - px, half_ + px, dx);",
    "  col = mix(col, vec3(0.0), inside);",
    "  float edge = 1.0 - smoothstep(0.0, max(px * 1.5, 0.012 * k), abs(dx - half_));",
    "  float b = fract(1.0 / (k + 0.06) * 0.4 + uTime * 0.5);",
    "  float bar = smoothstep(0.0, 0.05, b) * (1.0 - smoothstep(0.12, 0.17, b)) * inside * (0.4 + 0.6 * k);",
    "  return col + NEON * (edge + bar * 0.6);",
    "}",
    "",
    "void main() {",
    "  vec2 uv = gl_FragCoord.xy / uSize;",
    "  vec2 p = uv * 2.0 - 1.0;",
    "  float a = uSize.x / uSize.y;",
    "  vec2 q = vec2(p.x * a, p.y);",
    "  vec2 v = vec2(uVanish.x * a, uVanish.y);",
    "  vec2 d = q - v;",
    "  t = mod(uTime, 3600.0);",
    "  px = 2.0 / uSize.y;",
    "  float dy = q.y - v.y;",
    "  vec3 col = vec3(0.0);",
    "",
    "  if (uKind == 1) {", // Starfield: stars streaming out from the horizon
    "    col = mix(vec3(0.0, 0.0, 0.02), vec3(0.02, 0.02, 0.08), uv.y);",
    "    float r = length(d), an = atan(d.y, d.x);",
    "    for (int i = 0; i < 3; i++) {",
    "      float fi = float(i), k = 14.0 + fi * 9.0;",
    "      vec2 g = vec2(an / PI * k, log(r + 0.001) * (5.0 + fi) - t * (0.25 + 0.12 * fi) - uTravel * 0.004 * (1.0 + fi));",
    "      vec2 id = floor(g), f = fract(g) - 0.5;",
    "      id.x = mod(id.x, 2.0 * k);",
    "      float h = h21(id + fi * 31.0);",
    "      if (h > 0.82) {",
    "        float s = length(vec2(f.x, f.y * 0.35));",
    "        col += vec3(0.75, 0.85, 1.0) * (1.0 - smoothstep(0.03, 0.09, s)) * smoothstep(0.02, 0.25, r) * (0.5 + 0.5 * fract(h * 7.0));",
    "      }",
    "    }",
    "  } else if (uKind == 2) {", // Sunset: a striped sun on the horizon
    "    vec3 low = vec3(1.0, 0.6, 0.25), mid = vec3(0.85, 0.22, 0.45), top = vec3(0.12, 0.04, 0.28);",
    "    col = dy > 0.0 ? mix(mix(low, mid, smoothstep(0.0, 0.45, dy)), top, smoothstep(0.35, 1.3, dy))",
    "                   : mix(vec3(0.35, 0.08, 0.25), vec3(0.06, 0.02, 0.1), smoothstep(0.0, 0.6, -dy));",
    "    vec2 c = v + vec2(0.0, 0.3);",
    "    float sr = length(q - c);",
    "    float disc = 1.0 - smoothstep(0.34 - px, 0.34 + px, sr);",
    "    float below = c.y - q.y;",
    "    float sf = fract(below * 10.0), sw = fwidth(below * 10.0);",
    "    float cut = below > 0.02 ? smoothstep(1.0 - below * 1.3 - sw, 1.0 - below * 1.3 + sw, sf) : 0.0;",
    "    vec3 sun = mix(vec3(1.0, 0.35, 0.55), vec3(1.0, 0.9, 0.35), smoothstep(-0.3, 0.3, q.y - c.y));",
    "    col = mix(col, sun, disc * (1.0 - cut));",
    "    col += vec3(1.0, 0.45, 0.3) * 0.35 * exp(-max(0.0, sr - 0.3) * 4.0) * (dy > 0.0 ? 1.0 : 0.3);",
    "  } else if (uKind == 3) {", // Synthwave: a neon grid floor that rushes past
    "    col = mix(vec3(0.05, 0.0, 0.12), vec3(0.0), smoothstep(0.0, 1.2, dy));",
    "    col += stars(q, 40.0, 0.12) * vec3(0.8, 0.7, 1.0) * step(0.0, dy);",
    "    col += vec3(1.0, 0.2, 0.7) * 0.6 * exp(-abs(dy) * 9.0);",
    "    if (dy < 0.0) {",
    "      float z = 0.45 / -dy, x = d.x * z;",
    "      float gz = z * 0.6 + t * 0.4 + uTravel * 0.03, gx = x * 0.8;",
    "      float lz = 1.0 - smoothstep(0.0, fwidth(gz) * 1.5, 0.5 - abs(fract(gz) - 0.5));",
    "      float lx = 1.0 - smoothstep(0.0, fwidth(gx) * 1.5, 0.5 - abs(fract(gx) - 0.5));",
    "      float fade = exp(-z * 0.08) * smoothstep(0.0, 0.05, -dy);",
    "      col += (vec3(1.0, 0.15, 0.75) * lz + vec3(0.2, 0.6, 1.0) * lx) * fade;",
    "    }",
    "  } else if (uKind == 4) {", // Aurora: green and violet curtains
    "    col = mix(vec3(0.0, 0.02, 0.05), vec3(0.01, 0.0, 0.08), uv.y) + stars(q, 50.0, 0.1) * 0.8;",
    "    for (int i = 0; i < 2; i++) {",
    "      float fi = float(i);",
    "      float x = q.x * (0.7 + 0.3 * fi) + t * (0.02 + 0.015 * fi) + fi * 4.0;",
    "      float base = 0.15 + 0.35 * fi + 0.25 * (noise(vec2(x * 1.3, fi * 9.0 + t * 0.05)) - 0.5) + 0.08 * sin(x * 2.5 + t * 0.3);",
    "      float h = q.y - base;",
    "      float curtain = smoothstep(-0.04, 0.03, h) * exp(-max(h, 0.0) * (3.0 + fi * 2.0));",
    "      float rays = 0.45 + 0.55 * noise(vec2(x * 30.0, t * 0.4 + fi * 5.0));",
    "      col += mix(vec3(0.1, 1.0, 0.5), vec3(0.6, 0.2, 1.0), clamp(h * 2.0, 0.0, 1.0)) * curtain * rays * 0.55;",
    "    }",
    "  } else if (uKind == 5) {", // Nebula: drifting clouds of gas
    "    vec2 s = q + vec2(t * 0.01, 0.0);",
    "    float n1 = fbm(s * 1.2), n2 = fbm(s * 2.0 + 7.3);",
    "    col = vec3(0.01, 0.0, 0.03) + vec3(0.45, 0.1, 0.6) * smoothstep(0.4, 0.85, n1);",
    "    col += vec3(0.1, 0.35, 0.8) * smoothstep(0.45, 0.9, n2) * 0.8;",
    "    col += vec3(1.0, 0.4, 0.6) * pow(smoothstep(0.5, 0.9, n1 * n2 * 1.8), 2.0) * 0.6;",
    "    col += stars(q, 45.0, 0.12) + stars(q + 3.1, 90.0, 0.08) * 0.6;",
    "  } else if (uKind == 6) {", // Deep sea: light from above and rising bubbles
    "    col = mix(vec3(0.0, 0.03, 0.1), vec3(0.0, 0.28, 0.42), smoothstep(-1.0, 1.0, q.y));",
    "    float rays = pow(0.5 + 0.5 * sin(q.x * 6.0 + 1.5 * sin(q.x * 2.3 + t * 0.25) + t * 0.15), 8.0);",
    "    col += vec3(0.25, 0.6, 0.7) * rays * smoothstep(-0.6, 1.0, q.y) * 0.35;",
    "    float c = noise(q * 6.0 + vec2(t * 0.3, t * 0.2)) + noise(q * 9.0 - vec2(t * 0.25, -t * 0.15));",
    "    col += vec3(0.3, 0.7, 0.8) * pow(1.0 - abs(c - 1.0), 6.0) * 0.25 * smoothstep(0.0, 1.0, q.y);",
    "    vec2 g = vec2(q.x * 7.0, q.y * 7.0 - t * 0.8), id = floor(g), f = fract(g) - 0.5;",
    "    float h = h21(id);",
    "    if (h > 0.85) {",
    "      f.x += 0.2 * sin(t * 2.0 + h * 30.0);",
    "      float br = 0.08 + 0.1 * fract(h * 9.0);",
    "      col += vec3(0.5, 0.85, 0.95) * (1.0 - smoothstep(0.0, max(0.03, px * 7.0 * 1.5), abs(length(f) - br))) * 0.7;",
    "    }",
    "  } else if (uKind == 7) {", // Code rain: falling columns of dot-matrix glyphs
    "    col = vec3(0.0, 0.015, 0.0);",
    "    vec2 cell = vec2(0.055, 0.08) * max(1.0, px * 280.0);",
    "    vec2 g = vec2(q.x, -q.y) / cell, id = floor(g), f = fract(g);",
    "    float speed = 6.0 + 10.0 * h21(vec2(id.x, 1.0));",
    "    float len = 10.0 + 18.0 * h21(vec2(id.x, 2.0));",
    "    float rows = 2.0 / cell.y;",   // on screen; each stream then runs on past the bottom
    "    float head = mod(t * speed + h21(vec2(id.x, 3.0)) * 200.0, rows + 30.0) - rows * 0.5;",
    "    float behind = head - id.y;",
    "    if (behind >= 0.0 && behind < len) {",
    "      float glyph = floor(t * (2.0 + 3.0 * h21(id)) + h21(id + 5.0) * 10.0);",
    "      vec2 dg = vec2(f.x * 6.0, f.y * 8.0), di = floor(dg), df = fract(dg) - 0.5;",
    "      float on = (di.x < 5.0 && di.y < 7.0) ? step(0.45, h21(id * 7.0 + di + glyph * 13.1)) : 0.0;",
    "      float dotm = on * (1.0 - smoothstep(0.3, 0.45, length(df)));",
    "      float b = 1.0 - behind / len;",
    "      col += (behind < 1.0 ? vec3(0.75, 1.0, 0.8) : vec3(0.1, 1.0, 0.3) * b * b) * dotm;",
    "    }",
    "  } else if (uKind == 8) {", // Storm: dark clouds, rain and lightning
    "    float n = fbm(q * vec2(1.2, 2.0) + vec2(t * 0.03, 0.0));",
    "    col = mix(vec3(0.05, 0.06, 0.08), vec3(0.26, 0.28, 0.33), smoothstep(0.3, 0.75, n)) * smoothstep(-1.4, 1.0, q.y);",
    "    float epoch = floor(t / 3.1), local = t - epoch * 3.1;",
    "    float strikes = uPreview == 1 ? 1.0 : step(0.4, h21(vec2(epoch, 1.0)));",   // previews show one every time
    "    float env = strikes * exp(-local * 5.0) * (0.7 + 0.3 * sin(local * 70.0));",
    "    col += vec3(0.5, 0.55, 0.7) * env * smoothstep(0.3, 0.8, n) * 1.2;",
    "    float bx = (h21(vec2(epoch, 2.0)) - 0.5) * 1.4 * a + 0.12 * (noise(vec2(q.y * 5.0, epoch)) - 0.5)",
    "      + 0.04 * (noise(vec2(q.y * 22.0, epoch + 4.0)) - 0.5);",
    "    float bottom = v.y + 0.1 + 0.4 * h21(vec2(epoch, 3.0));",
    "    col += vec3(0.8, 0.85, 1.0) * exp(-abs(q.x - bx) / (px * 1.5 + 0.004)) * step(bottom, q.y) * env * 2.0;",
    "    vec2 rg = vec2((q.x + q.y * 0.25) * 60.0, q.y * 3.0 + t * 6.0), rid = floor(rg), rf = fract(rg);",
    "    col += vec3(0.45, 0.5, 0.6) * step(0.92, h21(rid)) * (1.0 - smoothstep(0.0, 0.12, abs(rf.x - 0.5))) * smoothstep(0.0, 0.5, rf.y) * 0.35;",
    "  } else if (uKind == 9) {", // Snowfall
    "    col = mix(vec3(0.01, 0.02, 0.06), vec3(0.06, 0.1, 0.2), smoothstep(-1.0, 1.0, q.y));",
    "    for (int i = 0; i < 3; i++) {",
    "      float fi = float(i), sc = 5.0 + fi * 4.0;",
    "      vec2 g = q * sc + vec2(0.0, t * (0.5 + 0.35 * fi));",
    "      g.x += sin(g.y * 0.7 + fi * 2.0 + t * 0.5) * 0.35;",
    "      vec2 id = floor(g), f = fract(g) - 0.5;",
    "      float h = h21(id + fi * 17.0);",
    "      if (h > 0.55) {",
    "        vec2 o = (h22(id + fi) - 0.5) * 0.5;",
    "        float r = max((0.05 + 0.06 * fract(h * 5.0)) * (1.2 - fi * 0.25), px * sc * 1.2);",
    "        col += vec3(0.85, 0.9, 1.0) * soft(length(f - o), r) * (0.95 - fi * 0.25);",
    "      }",
    "    }",
    "  } else if (uKind == 10) {", // Inferno: rising flames and embers
    "    vec2 s = vec2(q.x * 1.6, q.y * 1.2 - t * 0.35);",
    "    float heat = fbm(s + fbm(s * 1.5 + t * 0.1)) * (1.1 - uv.y * 0.7);",
    "    col = mix(vec3(0.08, 0.0, 0.0), vec3(0.75, 0.12, 0.02), smoothstep(0.25, 0.6, heat));",
    "    col = mix(col, vec3(1.0, 0.6, 0.1), smoothstep(0.55, 0.85, heat)) * 0.8;",
    "    vec2 g = vec2(q.x * 9.0, q.y * 9.0 - t * 1.6), id = floor(g), f = fract(g) - 0.5;",
    "    float h = h21(id);",
    "    if (h > 0.88) {",
    "      f.x += 0.25 * sin(t * 3.0 + h * 50.0);",
    "      col += vec3(1.0, 0.7, 0.3) * soft(length(f), max(0.08, px * 9.0 * 1.2)) * (0.5 + 0.5 * sin(t * 6.0 + h * 20.0));",
    "    }",
    "  } else if (uKind == 11) {", // Prism: slow rainbow bands
    "    float k = q.x * 0.18 + q.y * 0.12 + t * 0.03 + 0.05 * sin(q.y * 3.0 + t * 0.5);",
    "    col = hue(k) * (0.35 + 0.15 * sin(q.x * 4.0 - q.y * 3.0 + t * 0.6)) * 0.85;",
    "  } else if (uKind == 12) {", // Ringed planet
    "    col = vec3(0.0, 0.0, 0.015) + stars(q, 45.0, 0.12) + stars(q + 7.0, 85.0, 0.08) * 0.6;",
    "    vec2 c = v + vec2(min(0.75, a * 0.55), 0.35), e = q - c;",
    "    float R = 0.38, pd = length(e);",
    "    vec2 re = mat2(cos(0.35), sin(0.35), -sin(0.35), cos(0.35)) * e;",
    "    re.y /= 0.28;",
    "    float rr = length(re);",
    "    float ring = smoothstep(0.5, 0.52, rr) * (1.0 - smoothstep(0.86, 0.88, rr)) * (0.55 + 0.45 * sin(rr * 60.0));",
    "    float front = step(re.y, 0.0);",
    "    float body = 1.0 - smoothstep(R - px, R + px, pd);",
    "    vec3 nrm = vec3(e / R, sqrt(max(0.0, 1.0 - dot(e, e) / (R * R))));",
    "    float lit = max(0.0, dot(nrm, normalize(vec3(-0.6, 0.4, 0.7))));",
    "    vec3 pc = mix(vec3(0.75, 0.55, 0.35), vec3(0.95, 0.85, 0.65), 0.5 + 0.5 * sin(asin(clamp(nrm.y, -1.0, 1.0)) * 12.0 + 2.0 * noise(e * 6.0)));",
    "    col = mix(col, pc * (0.08 + 0.92 * lit), body);",
    "    col = mix(col, vec3(0.85, 0.75, 0.6) * ring + col * 0.2, ring * max(front, 1.0 - body) * 0.9);",
    "  } else if (uKind == 13) {", // Hive: hexagons lit by passing waves
    "    vec2 g = q * 4.0, r = vec2(1.0, 1.7320508), hr = r * 0.5;",
    "    vec2 ga = mod(g, r) - hr, gb = mod(g - hr, r) - hr;",
    "    vec2 hg = dot(ga, ga) < dot(gb, gb) ? ga : gb, cid = g - hg;",
    "    float edge = 0.5 - max(dot(abs(hg), vec2(0.5, 0.8660254)), abs(hg.x));",
    "    float wave = 0.5 + 0.5 * sin(t * 1.2 - length(cid - v * 4.0) * 0.8 + h21(cid) * 2.0);",
    "    vec3 c = mix(vec3(0.0, 0.6, 1.0), vec3(0.7, 0.1, 1.0), 0.5 + 0.5 * sin(cid.x * 0.3 + t * 0.2));",
    "    col = c * (0.04 + 0.1 * wave * wave) + c * (1.0 - smoothstep(0.0, 0.03 + fwidth(edge) * 1.5, edge)) * (0.25 + 0.6 * wave);",
    "  } else if (uKind == 14) {", // Daylight: blue sky and drifting clouds
    "    col = mix(vec3(0.72, 0.86, 1.0), vec3(0.22, 0.48, 0.92), smoothstep(-0.1, 1.2, dy));",
    "    col = mix(col, vec3(0.8, 0.88, 0.95), 1.0 - smoothstep(-0.8, 0.0, dy));",
    "    vec2 s = vec2(q.x * 0.9 + t * 0.012, q.y * 2.2);",
    "    float cloud = smoothstep(0.5, 0.72, fbm(s * 1.5)) * smoothstep(-0.05, 0.25, dy);",
    "    col = mix(col, vec3(1.0) * (0.85 + 0.15 * smoothstep(0.5, 0.9, fbm(s * 3.0 + 1.0))), cloud * 0.9);",
    "    col += vec3(1.0, 0.95, 0.8) * 0.4 * exp(-length(q - vec2(-a * 0.6, 0.85)) * 3.0);",
    "  } else if (uKind == 15) {", // Galaxy: a slowly turning spiral above the track
    "    col = vec3(0.0, 0.0, 0.02) + stars(q, 50.0, 0.1) * 0.7;",
    "    vec2 e = mat2(cos(-0.3), sin(-0.3), -sin(-0.3), cos(-0.3)) * (q - v - vec2(0.0, 0.45));",
    "    e.y *= 2.4;",
    "    float r = length(e), an = atan(e.y, e.x);",
    "    float arms = pow(0.5 + 0.5 * cos(2.0 * (an - log(r + 0.02) * 2.4) + t * 0.05), 3.0);",
    "    float dust = fbm(e * 5.0 + 2.0);",
    "    col += mix(vec3(0.35, 0.45, 1.0), vec3(0.8, 0.5, 1.0), dust) * arms * exp(-r * 2.6) * (0.6 + 0.6 * dust);",
    "    col += vec3(1.0, 0.85, 0.6) * exp(-r * 14.0) * 1.2;",
    "  } else if (uKind == 16) {", // Black hole: a glowing disc bent around a dark centre
    "    vec2 e = q - v - vec2(0.0, 0.42);",
    "    float r = length(e);",
    "    vec2 de = vec2(e.x, e.y / 0.22);",
    "    float dr = length(de), an = atan(de.y, de.x) - t * 0.8;",
    "    float disc = smoothstep(0.22, 0.3, dr) * (1.0 - smoothstep(0.55, 0.75, dr));",
    "    float swirl = 0.6 + 0.4 * noise(vec2(cos(an), sin(an)) * 2.5 + dr * 6.0);",
    "    vec3 hot = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.9, 0.7), 1.0 - smoothstep(0.25, 0.6, dr)) * disc * swirl;",
    "    float behind = step(0.0, e.y);",
    "    col = stars(q, 50.0, 0.1) * 0.6 + hot * behind;",
    "    col *= smoothstep(0.17, 0.19, r);",
    "    col += vec3(1.0, 0.75, 0.45) * exp(-abs(r - 0.19) * 70.0) * 0.9;",
    "    col += hot * (1.0 - behind);",
    "  }",
    "  if (uPreview == 1) col = track(q, v, col);",
    "  // Shop previews bake in the track colour tint (the game gets it from CSS).",
    "  if (uBakeTint == 1) col = vec3(col.r + uTint.r * (col.g - col.b), uTint.g * col.g + (1.0 - uTint.g) * col.b, uTint.b * col.g + (1.0 - uTint.b) * col.b);",
    "  outColor = vec4(col, 1.0);",
    "}"
  ].join("\n");

  function Painter(gl) {
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
    ["uKind", "uTime", "uSize", "uVanish", "uTravel", "uPreview", "uTint", "uBakeTint"].forEach(function (name) {
      u[name] = gl.getUniformLocation(program, name);
    });
    var vao = gl.createVertexArray();  // no attributes: the triangle comes from gl_VertexID
    this.gl = gl;
    this.draw = function (bg, o) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform1i(u.uKind, bg.kind);
      gl.uniform1f(u.uTime, o.time);
      gl.uniform2f(u.uSize, o.width, o.height);
      gl.uniform2f(u.uVanish, o.vanish[0], o.vanish[1]);
      gl.uniform1f(u.uTravel, o.travel || 0);
      gl.uniform1i(u.uPreview, o.preview ? 1 : 0);
      gl.uniform1i(u.uBakeTint, o.tint ? 1 : 0);
      if (o.tint) gl.uniform3fv(u.uTint, o.tint);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  }

  // --- In the game -----------------------------------------------------------

  var equipped = byId(profile.get().background);
  var painter = null, failed = false;
  var vanish = [0, 0.3];   // where the track meets the horizon, smoothed
  var travel = 0;

  game.on("frame", function (f) { if (f.ball) travel = f.ball.s; });

  // The downhill direction seen from infinitely far: the view-projection of
  // the direction (0, -1, 1) / sqrt(2) with w = 0.
  function horizon(vp) {
    if (!vp) return;
    var S = Math.SQRT1_2;
    var x = -vp[4] * S + vp[8] * S, y = -vp[5] * S + vp[9] * S, w = -vp[7] * S + vp[11] * S;
    if (!(w > 1e-6)) return;
    var nx = Math.max(-1.5, Math.min(1.5, x / w)), ny = Math.max(-1.5, Math.min(1.5, y / w));
    vanish[0] += (nx - vanish[0]) * 0.2;
    vanish[1] += (ny - vanish[1]) * 0.2;
  }

  function paint(f) {
    if (failed || !equipped.kind) return;
    if (!painter || painter.gl !== f.gl) {
      try {
        painter = new Painter(f.gl);
      } catch (e) {
        failed = true;
        game.paintBackground(null);
        console.warn("Slope backgrounds: can't draw backgrounds here", e);
        return;
      }
    }
    horizon(f.vp);
    painter.draw(equipped, { time: performance.now() / 1000, width: f.width, height: f.height, vanish: vanish, travel: travel });
  }

  function apply() { game.paintBackground(equipped.kind && !failed ? paint : null); }
  profile.onChange(function (p) {
    var next = byId(p.background);
    if (next !== equipped) { equipped = next; apply(); }
  });
  apply();

  // --- Shop tab ----------------------------------------------------------------
  // Same approach as the skin previews: one small WebGL canvas draws them all,
  // each card gets a still once it scrolls into view (a couple per frame),
  // and only the card under the pointer or focus (else the one in use)
  // animates.

  var PREVIEW_W = 200, PREVIEW_H = 125;
  var SCALE = Math.min(1.5, window.devicePixelRatio || 1);
  var PREVIEW_VANISH = [0, 0.2];
  var STILL_TIME = 37.0;      // a moment that looks good in every background
  var ANIM_INTERVAL = 33;
  var STILLS_PER_FRAME = 2;
  var preview = null;
  var els = null, cards = [], hovered = null, animating = null, animFrom = 0, lastAnim = 0, loop = 0, stillTint = null;
  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  function setupPreview() {
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(PREVIEW_W * SCALE);
    canvas.height = Math.round(PREVIEW_H * SCALE);
    var gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
    if (!gl) return false;
    try { return { canvas: canvas, gl: gl, painter: new Painter(gl) }; } catch (e) {
      console.warn("Slope backgrounds: no previews", e);
      return false;
    }
  }

  function themeRgb() {
    var hex = (window.SlopeUI && window.SlopeUI.themeColor) || "#00ff00";
    var n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function drawPreview(bg, target, time) {
    var p = preview;
    p.gl.viewport(0, 0, p.canvas.width, p.canvas.height);
    p.painter.draw(bg, { time: time, width: p.canvas.width, height: p.canvas.height, vanish: PREVIEW_VANISH, travel: time * 20, preview: true, tint: themeRgb() });
    var ctx = target.__ctx || (target.__ctx = target.getContext("2d"));
    ctx.drawImage(p.canvas, 0, 0, target.width, target.height);
  }

  function gemIcon() {
    return window.SlopeGems && window.SlopeGems.iconSvg ? window.SlopeGems.iconSvg(14, 12) : "";
  }

  function priceOf(bg) {
    return window.SlopeUpgrades && window.SlopeUpgrades.price ? window.SlopeUpgrades.price(bg.price) : bg.price;
  }

  function build(panel) {
    panel.innerHTML =
      '<p class="slope-shop-note">Backgrounds go behind the track: on the menu and in every run.</p>' +
      '<ul class="slope-skins slope-bgs">' +
        BACKGROUNDS.map(function (bg) {
          return '<li class="slope-skin slope-bg" data-bg="' + bg.id + '">' +
            '<canvas class="slope-bg-preview" aria-hidden="true"></canvas>' +
            '<p class="slope-skin-name">' + bg.name + "</p>" +
            '<p class="slope-skin-price"></p>' +
            '<button type="button" class="slope-btn slope-skin-action"></button>' +
          "</li>";
        }).join("") +
      "</ul>" +
      '<p class="slope-shop-status" role="status"></p>';
    els = { panel: panel, screen: panel.closest(".slope-shop"), status: panel.querySelector(".slope-shop-status") };
    cards = BACKGROUNDS.map(function (bg) {
      var li = panel.querySelector('[data-bg="' + bg.id + '"]');
      var card = { bg: bg, li: li, canvas: li.querySelector("canvas"), price: li.querySelector(".slope-skin-price"),
        action: li.querySelector(".slope-skin-action"), visible: false, dirty: true };
      card.canvas.width = Math.round(PREVIEW_W * SCALE);
      card.canvas.height = Math.round(PREVIEW_H * SCALE);
      li.__card = card;
      card.action.addEventListener("click", function () { choose(bg); });
      li.addEventListener("pointerenter", function () { hovered = card; });
      li.addEventListener("pointerleave", function () { if (hovered === card) hovered = null; });
      li.addEventListener("focusin", function () { hovered = card; });
      return card;
    });
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { en.target.__card.visible = en.isIntersecting; });
      }, { root: els.screen, rootMargin: "120px" });
      cards.forEach(function (card) { io.observe(card.li); });
    } else {
      cards.forEach(function (card) { card.visible = true; });
    }
    panel.addEventListener("slope-show", function () {
      els.status.textContent = "";
      render(profile.get());
      start();
    });
    profile.onChange(render);
  }

  function render(p) {
    if (!els) return;
    cards.forEach(function (card) {
      var bg = card.bg;
      var owned = bg.id === "none" || p.backgrounds.indexOf(bg.id) !== -1;
      var on = byId(p.background).id === bg.id;
      card.li.classList.toggle("is-equipped", on);
      card.action.disabled = false;
      card.action.removeAttribute("aria-pressed");
      if (on) {
        card.price.textContent = "In use";
        card.action.textContent = "In use";
        card.action.setAttribute("aria-pressed", "true");
        card.action.setAttribute("aria-label", bg.name + " background, in use");
      } else if (owned) {
        card.price.textContent = "Owned";
        card.action.textContent = "Use";
        card.action.setAttribute("aria-label", "Use the " + bg.name + " background");
      } else {
        var price = priceOf(bg), short = price - p.gems;
        card.price.innerHTML = gemIcon() + "<span>" + price + (short > 0 ? " (" + short + " more)" : "") + "</span>";
        card.action.textContent = "Buy";
        card.action.disabled = short > 0;
        card.action.setAttribute("aria-label", "Buy the " + bg.name + " background for " + price + " gems" +
          (short > 0 ? ", you need " + short + " more" : ""));
      }
    });
  }

  function choose(bg) {
    var p = profile.get();
    if (byId(p.background).id === bg.id) return;
    var price = priceOf(bg);
    if (bg.id === "none" || p.backgrounds.indexOf(bg.id) !== -1) {
      profile.equipBackground(bg.id);
      els.status.textContent = bg.id === "none" ? "Back to the classic black sky." : bg.name + " is your background now.";
    } else if (profile.buyBackground(bg.id, price)) {
      els.status.textContent = "Bought " + bg.name + ". It's your background now.";
    } else {
      els.status.textContent = "You need " + (price - p.gems) + " more gems for " + bg.name + ".";
    }
    var card = cards.filter(function (c) { return c.bg === bg; })[0];
    if (card) card.action.focus();
  }

  function shown() { return els && !els.panel.hidden && els.screen && !els.screen.hidden; }

  function tick(now) {
    loop = 0;
    if (!shown() || !preview) return;
    var theme = window.SlopeUI.themeColor;
    if (theme !== stillTint) {
      stillTint = theme;
      cards.forEach(function (c) { c.dirty = true; });
    }
    var want = hovered || cards.filter(function (c) { return c.li.classList.contains("is-equipped"); })[0] || null;
    if (reduceMotion.matches) want = null;
    if (want !== animating) {
      if (animating) animating.dirty = true;
      animating = want;
      animFrom = now;
    }
    var budget = STILLS_PER_FRAME;
    for (var i = 0; i < cards.length && budget > 0; i++) {
      var card = cards[i];
      if (card.dirty && card.visible && card !== animating) {
        drawPreview(card.bg, card.canvas, card.bg.still || STILL_TIME);
        card.dirty = false;
        budget--;
      }
    }
    if (animating && animating.visible && now - lastAnim >= ANIM_INTERVAL) {
      lastAnim = now;
      drawPreview(animating.bg, animating.canvas, (animating.bg.still || STILL_TIME) + (now - animFrom) / 1000);
    }
    loop = requestAnimationFrame(tick);
  }

  function start() {
    if (preview === null) preview = setupPreview();
    if (preview && !loop) loop = requestAnimationFrame(tick);
  }

  function setup() {
    var panel = window.SlopeShop && window.SlopeShop.panel("backgrounds");
    if (panel) build(panel);
  }
  window.SlopeUI.ready(setup);

  window.SlopeBackgrounds = {
    list: BACKGROUNDS,
    // The background in use, for another WebGL2 context (the platformer):
    // null for the plain black sky, else { draw({ time, width, height, vanish, travel }) }.
    painter: function (gl) {
      var p = null;
      try { p = new Painter(gl); } catch (e) { return null; }
      return { draw: function (o) { if (equipped.kind) p.draw(equipped, o); }, on: function () { return !!equipped.kind; } };
    }
  };
})();
