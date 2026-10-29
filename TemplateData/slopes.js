/*
 * Slope styles, on the shop's Slope tab: other tiles for the world.
 *
 * Slope's world is tiled with a few small textures: black squares with a
 * neon green edge (the track's frames and tunnels, the towers) or a green
 * middle (the floor), and red ones for the deadly walls and blocks. A track
 * style redraws the green track tiles and a pillar style the towers, walls
 * and blocks; the game bridge swaps them in as the game draws its scene
 * (SlopeGame.retexture). The tiles stay neon green and red, so the track
 * colour setting still tints them.
 *
 *   SlopeSlopes.track / SlopeSlopes.pillars   the style lists
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var SIZE = 64;                       // tile size (the game's own are 32)
  var GREEN = "#00ff00", RED = "#e80000", DARK_RED = "#a80000";
  var THICK = 0.1, THIN = 0.05;        // edge widths, as a share of the tile

  var TRACK = [
    { id: "track-classic", name: "Classic", price: 0 },
    { id: "track-grid", name: "Grid", price: 40, style: "grid" },
    { id: "track-chevron", name: "Chevron", price: 45, style: "chevron" },
    { id: "track-dots", name: "Dots", price: 50, style: "dots" },
    { id: "track-diamond", name: "Diamond", price: 55, style: "diamond" },
    { id: "track-hex", name: "Hex", price: 60, style: "hex" },
    { id: "track-bricks", name: "Bricks", price: 65, style: "bricks" },
    { id: "track-waves", name: "Waves", price: 70, style: "waves" },
    { id: "track-circuit", name: "Circuit", price: 80, style: "circuit" },
    { id: "track-double", name: "Double", price: 85, style: "double" },
    { id: "track-glow", name: "Glow", price: 100, style: "glow" },
    { id: "track-rainbow", name: "Rainbow", price: 120, style: "rainbow" }
  ];
  var PILLARS = [
    { id: "pillar-classic", name: "Classic", price: 0 },
    { id: "pillar-grid", name: "Grid", price: 35, style: "grid" },
    { id: "pillar-stripes", name: "Stripes", price: 40, style: "stripes" },
    { id: "pillar-bricks", name: "Bricks", price: 45, style: "bricks" },
    { id: "pillar-rings", name: "Rings", price: 50, style: "rings" },
    { id: "pillar-zigzag", name: "Zigzag", price: 55, style: "zigzag" },
    { id: "pillar-checker", name: "Checker", price: 60, style: "checker" },
    { id: "pillar-hex", name: "Hex", price: 70, style: "hex" },
    { id: "pillar-circles", name: "Circles", price: 75, style: "circles" },
    { id: "pillar-glass", name: "Glass", price: 90, style: "glass" }
  ];

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  // --- Tiles -------------------------------------------------------------------
  // Each style draws a tile two ways: "edge" (a neon outline, like the frames,
  // towers and red walls) and "fill" (a neon middle, like the floor).

  function path(x, pts, close) {
    x.beginPath();
    x.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
    if (close) x.closePath();
  }
  function border(x, S, w) { x.lineWidth = w; x.strokeRect(w / 2, w / 2, S - w, S - w); }
  function hexagon(x, S, r) {
    var pts = [];
    for (var i = 0; i < 6; i++) { var a = Math.PI / 3 * i + Math.PI / 6; pts.push([S / 2 + r * Math.cos(a), S / 2 + r * Math.sin(a)]); }
    path(x, pts, true);
  }
  function wave(x, S, y, amp) {
    x.beginPath();
    for (var i = 0; i <= 32; i++) { var u = i / 32; x.lineTo(u * S, y + amp * Math.sin(u * Math.PI * 2)); }
  }

  var STYLES = {
    grid: function (x, S, mode, w) {
      if (mode === "fill") {
        var g = S * 0.09, q = (S - 3 * g) / 2;
        [[g, g], [2 * g + q, g], [g, 2 * g + q], [2 * g + q, 2 * g + q]].forEach(function (p) { x.fillRect(p[0], p[1], q, q); });
        return;
      }
      border(x, S, w);
      x.lineWidth = w * 0.6;
      path(x, [[S / 2, 0], [S / 2, S]]); x.stroke();
      path(x, [[0, S / 2], [S, S / 2]]); x.stroke();
    },
    chevron: function (x, S, mode, w) {
      if (mode !== "fill") border(x, S, w);
      x.lineWidth = mode === "fill" ? S * 0.2 : w;
      x.lineJoin = "miter";
      path(x, [[S * 0.12, S * 0.3], [S * 0.5, S * 0.68], [S * 0.88, S * 0.3]]); x.stroke();
    },
    dots: function (x, S, mode, w) {
      if (mode === "fill") { x.beginPath(); x.arc(S / 2, S / 2, S * 0.32, 0, Math.PI * 2); x.fill(); return; }
      border(x, S, w * 0.5);
      var r = Math.max(2, w * 0.9);
      [[0.18, 0.18], [0.5, 0.18], [0.82, 0.18], [0.18, 0.5], [0.5, 0.5], [0.82, 0.5], [0.18, 0.82], [0.5, 0.82], [0.82, 0.82]].forEach(function (p) {
        x.beginPath(); x.arc(p[0] * S, p[1] * S, r, 0, Math.PI * 2); x.fill();
      });
    },
    diamond: function (x, S, mode, w) {
      var m = mode === "fill" ? S * 0.12 : 0;
      path(x, [[S / 2, m], [S - m, S / 2], [S / 2, S - m], [m, S / 2]], true);
      if (mode === "fill") { x.fill(); return; }
      border(x, S, w);
      x.lineWidth = w * 0.7;
      path(x, [[S / 2, 0], [S, S / 2], [S / 2, S], [0, S / 2]], true); x.stroke();
    },
    hex: function (x, S, mode, w) {
      hexagon(x, S, S * (mode === "fill" ? 0.36 : 0.4));
      if (mode === "fill") { x.fill(); return; }
      x.lineWidth = w * 0.8; x.stroke();
      border(x, S, w * 0.5);
    },
    bricks: function (x, S, mode, w) {
      if (mode === "fill") {
        var g = S * 0.07, h = (S - 3 * g) / 2;
        x.fillRect(g, g, S - 2 * g, h);                         // top row: one brick
        x.fillRect(g, 2 * g + h, S / 2 - 1.5 * g, h);           // bottom row: two
        x.fillRect(S / 2 + 0.5 * g, 2 * g + h, S / 2 - 1.5 * g, h);
        return;
      }
      border(x, S, w);
      x.lineWidth = w * 0.6;
      path(x, [[0, S / 2], [S, S / 2]]); x.stroke();
      path(x, [[S / 2, S / 2], [S / 2, S]]); x.stroke();
    },
    waves: function (x, S, mode, w) {
      if (mode === "fill") {
        x.lineWidth = S * 0.16;
        [0.2, 0.5, 0.8].forEach(function (y) { wave(x, S, y * S, S * 0.08); x.stroke(); });
        return;
      }
      border(x, S, w * 0.6);
      x.lineWidth = w * 0.8;
      wave(x, S, S / 2, S * 0.14); x.stroke();
    },
    circuit: function (x, S, mode, w) {
      var lw = mode === "fill" ? S * 0.1 : w * 0.7;
      if (mode !== "fill") border(x, S, w);
      x.lineWidth = lw;
      x.lineJoin = "round";
      path(x, [[S * 0.22, 0], [S * 0.22, S * 0.5], [S * 0.62, S * 0.5]]); x.stroke();
      path(x, [[S, S * 0.78], [S * 0.72, S * 0.78], [S * 0.72, S * 0.66]]); x.stroke();
      path(x, [[S * 0.4, S], [S * 0.4, S * 0.78]]); x.stroke();
      [[0.62, 0.5], [0.72, 0.66], [0.4, 0.78]].forEach(function (p) {
        x.beginPath(); x.arc(p[0] * S, p[1] * S, lw * 1.3, 0, Math.PI * 2); x.fill();
      });
    },
    double: function (x, S, mode, w) {
      if (mode === "fill") {
        x.fillRect(S * 0.1, S * 0.1, S * 0.8, S * 0.8);
        x.fillStyle = "#000"; x.fillRect(S * 0.3, S * 0.3, S * 0.4, S * 0.4);
        return;
      }
      border(x, S, w * 0.7);
      x.lineWidth = w * 0.7;
      x.strokeRect(S * 0.22, S * 0.22, S * 0.56, S * 0.56);
    },
    glow: function (x, S, mode, w, colour) {
      if (mode === "fill") {
        var g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.55);
        g.addColorStop(0, colour); g.addColorStop(0.55, colour); g.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = g; x.fillRect(0, 0, S, S);
        return;
      }
      x.shadowColor = colour;
      x.shadowBlur = S * 0.14;
      border(x, S, w * 0.8);
      border(x, S, w * 0.8);
      x.shadowBlur = 0;
    },
    rainbow: function (x, S, mode, w) {
      var g = x.createLinearGradient(0, 0, S, S);
      ["#ff2020", "#ffd000", "#20ff40", "#20e0ff", "#4060ff", "#ff40e0"].forEach(function (c, i) { g.addColorStop(i / 5, c); });
      x.strokeStyle = x.fillStyle = g;
      if (mode === "fill") { x.fillRect(S * 0.1, S * 0.1, S * 0.8, S * 0.8); return; }
      border(x, S, w);
    },
    stripes: function (x, S, mode, w) {
      x.save();
      x.beginPath(); x.rect(0, 0, S, S); x.clip();
      x.lineWidth = mode === "fill" ? S * 0.14 : w * 0.7;
      for (var k = -1; k <= 2; k++) { path(x, [[k * S / 2 - S * 0.2, S + S * 0.2], [k * S / 2 + S + S * 0.2, -S * 0.2]]); x.stroke(); }
      x.restore();
      if (mode !== "fill") border(x, S, w);
    },
    rings: function (x, S, mode, w) {
      var lw = mode === "fill" ? S * 0.1 : w * 0.8;
      x.lineWidth = lw;
      [0, 0.17, 0.34].forEach(function (k) { x.strokeRect(k * S + lw / 2, k * S + lw / 2, S - 2 * k * S - lw, S - 2 * k * S - lw); });
    },
    zigzag: function (x, S, mode, w) {
      if (mode !== "fill") border(x, S, w);
      x.lineWidth = mode === "fill" ? S * 0.16 : w * 0.8;
      x.lineJoin = "miter";
      path(x, [[0, S * 0.62], [S * 0.25, S * 0.38], [S * 0.5, S * 0.62], [S * 0.75, S * 0.38], [S, S * 0.62]]); x.stroke();
    },
    checker: function (x, S, mode, w, colour) {
      if (mode !== "fill") { x.globalAlpha = 0.35; }
      x.fillRect(0, 0, S / 2, S / 2); x.fillRect(S / 2, S / 2, S / 2, S / 2);
      x.globalAlpha = 1;
      if (mode !== "fill") border(x, S, w);
    },
    circles: function (x, S, mode, w) {
      x.lineWidth = mode === "fill" ? S * 0.14 : w * 0.8;
      x.beginPath(); x.arc(S / 2, S / 2, S * 0.32, 0, Math.PI * 2); x.stroke();
      if (mode !== "fill") border(x, S, w * 0.6);
    },
    glass: function (x, S, mode, w) {
      x.globalAlpha = mode === "fill" ? 0.5 : 0.2;
      x.fillRect(0, 0, S, S);
      x.globalAlpha = 1;
      border(x, S, w);
      x.lineWidth = w * 0.5;
      path(x, [[S * 0.2, S * 0.45], [S * 0.45, S * 0.2]]); x.stroke();
    }
  };

  var tileCache = {};
  function tile(style, mode, width, colour) {
    var key = style + "/" + mode + "/" + width + "/" + colour;
    if (tileCache[key]) return tileCache[key];
    var c = document.createElement("canvas");
    c.width = c.height = SIZE;
    var x = c.getContext("2d");
    x.fillStyle = "#000";
    x.fillRect(0, 0, SIZE, SIZE);
    x.strokeStyle = x.fillStyle = colour;
    STYLES[style](x, SIZE, mode, Math.max(2, SIZE * width), colour);
    return (tileCache[key] = c);
  }
  function tileUrl(c) { return c.__url || (c.__url = c.toDataURL()); }

  // The tiles for the world: track style for the frames and floor, pillar
  // style for the towers, walls and blocks.
  function tilesFor(track, pillar) {
    var t = track.style, p = pillar.style;
    return {
      frame: t ? tile(t, "edge", THICK, GREEN) : null,
      edge: t ? tile(t, "edge", THICK, GREEN) : null,
      floor: t ? tile(t, "fill", THICK, GREEN) : null,
      tower: p ? tile(p, "edge", THIN, GREEN) : null,
      wall: p ? tile(p, "edge", THICK, RED) : null,
      block: p ? tile(p, "edge", THICK, DARK_RED) : null
    };
  }

  var current = { track: null, pillar: null };
  function apply(p) {
    var track = byId(TRACK, p.track), pillar = byId(PILLARS, p.pillar);
    if (track === current.track && pillar === current.pillar) return;
    current = { track: track, pillar: pillar };
    game.retexture(tilesFor(track, pillar));
  }
  profile.onChange(apply);

  // --- Shop tab ----------------------------------------------------------------

  var els = null, cards = [];

  function gemIcon() {
    return window.SlopeGems && window.SlopeGems.iconSvg ? window.SlopeGems.iconSvg(14, 12) : "";
  }
  function priceOf(item) {
    return window.SlopeUpgrades && window.SlopeUpgrades.price ? window.SlopeUpgrades.price(item.price) : item.price;
  }

  // A stretch of track (floor and walls) or a few pillars and a red block,
  // drawn with CSS 3D transforms and the same tint as the game.
  function previewHtml(slot, item) {
    return '<div class="slope-tile-preview slope-tile-' + slot + '" aria-hidden="true" data-item="' + item.id + '"></div>';
  }

  function paintPreview(el, slot, item) {
    var style = item.style;
    // Classic shows the game's own look: plain neon edges and a neon floor.
    var edge = tileUrl(style ? tile(style, "edge", THICK, GREEN) : classicTile("edge", THICK, GREEN));
    var fill = tileUrl(style ? tile(style, "fill", THICK, GREEN) : classicTile("fill", THICK, GREEN));
    var thin = tileUrl(style ? tile(style, "edge", THIN, GREEN) : classicTile("edge", THIN, GREEN));
    var red = tileUrl(style ? tile(style, "edge", THICK, RED) : classicTile("edge", THICK, RED));
    var dark = tileUrl(style ? tile(style, "edge", THICK, DARK_RED) : classicTile("edge", THICK, DARK_RED));
    function face(cls, url) { return '<div class="' + cls + '" style="background-image:url(' + url + ')"></div>'; }
    el.innerHTML = slot === "track"
      ? face("slope-tile-floor", fill) + face("slope-tile-left", edge) + face("slope-tile-right", edge)
      : face("slope-tile-ground", tileUrl(classicTile("fill", THICK, GREEN))) +
        face("slope-tile-tower slope-tile-tower-a", thin) + face("slope-tile-tower-side slope-tile-tower-a-side", thin) +
        face("slope-tile-tower slope-tile-tower-b", thin) + face("slope-tile-tower-side slope-tile-tower-b-side", thin) +
        face("slope-tile-block", red) + face("slope-tile-block-top", dark);
  }

  // The game's own tiles, redrawn for the previews.
  function classicTile(mode, width, colour) {
    var key = "classic/" + mode + "/" + width + "/" + colour;
    if (tileCache[key]) return tileCache[key];
    var c = document.createElement("canvas");
    c.width = c.height = SIZE;
    var x = c.getContext("2d");
    x.fillStyle = "#000"; x.fillRect(0, 0, SIZE, SIZE);
    x.strokeStyle = x.fillStyle = colour;
    if (mode === "fill") x.fillRect(SIZE * 0.12, SIZE * 0.12, SIZE * 0.76, SIZE * 0.76);
    else border(x, SIZE, Math.max(2, SIZE * width));
    return (tileCache[key] = c);
  }

  function section(slot, title, list) {
    return '<h3 class="slope-shop-section">' + title + "</h3>" +
      '<ul class="slope-skins slope-bgs" data-slot="' + slot + '">' +
        list.map(function (item) {
          return '<li class="slope-skin slope-bg" data-slope="' + item.id + '">' +
            previewHtml(slot, item) +
            '<p class="slope-skin-name">' + item.name + "</p>" +
            '<p class="slope-skin-price"></p>' +
            '<button type="button" class="slope-btn slope-skin-action"></button>' +
          "</li>";
        }).join("") +
      "</ul>";
  }

  function build(panel) {
    panel.innerHTML =
      '<p class="slope-shop-note">Change the tiles of the track you roll on, and of the towers and red walls around it.</p>' +
      section("track", "Track", TRACK) +
      section("pillar", "Pillars", PILLARS) +
      '<p class="slope-shop-status" role="status"></p>';
    els = { panel: panel, status: panel.querySelector(".slope-shop-status"), painted: false };
    cards = [];
    [["track", TRACK], ["pillar", PILLARS]].forEach(function (pair) {
      pair[1].forEach(function (item) {
        var li = panel.querySelector('[data-slope="' + item.id + '"]');
        var card = { slot: pair[0], item: item, li: li, preview: li.querySelector(".slope-tile-preview"),
          price: li.querySelector(".slope-skin-price"), action: li.querySelector(".slope-skin-action") };
        card.action.addEventListener("click", function () { choose(card); });
        cards.push(card);
      });
    });
    panel.addEventListener("slope-show", function () {
      els.status.textContent = "";
      if (!els.painted) {
        els.painted = true;
        cards.forEach(function (c) { paintPreview(c.preview, c.slot, c.item); });
      }
      render(profile.get());
    });
    profile.onChange(render);
  }

  function render(p) {
    if (!els) return;
    cards.forEach(function (card) {
      var item = card.item;
      var owned = /-classic$/.test(item.id) || p.slopes.indexOf(item.id) !== -1;
      var on = p[card.slot] === item.id;
      var what = item.name + (card.slot === "track" ? " track" : " pillars");
      card.li.classList.toggle("is-equipped", on);
      card.action.disabled = false;
      card.action.removeAttribute("aria-pressed");
      if (on) {
        card.price.textContent = "In use";
        card.action.textContent = "In use";
        card.action.setAttribute("aria-pressed", "true");
        card.action.setAttribute("aria-label", what + ", in use");
      } else if (owned) {
        card.price.textContent = "Owned";
        card.action.textContent = "Use";
        card.action.setAttribute("aria-label", "Use the " + what);
      } else {
        var price = priceOf(item), short = price - p.gems;
        card.price.innerHTML = gemIcon() + "<span>" + price + (short > 0 ? " (" + short + " more)" : "") + "</span>";
        card.action.textContent = "Buy";
        card.action.disabled = short > 0;
        card.action.setAttribute("aria-label", "Buy the " + what + " for " + price + " gems" + (short > 0 ? ", you need " + short + " more" : ""));
      }
    });
  }

  function choose(card) {
    var p = profile.get(), item = card.item, what = item.name + (card.slot === "track" ? " track" : " pillars");
    if (p[card.slot] === item.id) return;
    var price = priceOf(item);
    if (/-classic$/.test(item.id) || p.slopes.indexOf(item.id) !== -1) {
      profile.equipSlope(item.id);
      els.status.textContent = "The " + what + " are on.";
    } else if (profile.buySlope(item.id, price)) {
      els.status.textContent = "Bought the " + what + ". They're on now.";
    } else {
      els.status.textContent = "You need " + (price - p.gems) + " more gems for the " + what + ".";
    }
    card.action.focus();
  }

  window.SlopeUI.ready(function () {
    var panel = window.SlopeShop && window.SlopeShop.panel("slope");
    if (panel) build(panel);
  });

  window.SlopeSlopes = { track: TRACK, pillars: PILLARS };
})();
