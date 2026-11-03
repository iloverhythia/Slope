/*
 * Merge: a small game of its own, opened from the HUD (and from the shop).
 *
 * Click Spawn ten times to get a ball. Drag a ball onto another of the same
 * level (or click one, then the other) to merge them into a ball one level
 * higher. Levels never end, and every level is a secret ball skin
 * (SlopeSkins.secret) to wear in the game. The best ball also makes every
 * gem picked up on the track worth more, and the game has upgrades of its
 * own, bought with gems.
 *
 * Special balls come from upgrades: a star (drop it on any ball, or any
 * ball on it, to level that ball up), a gem ball (click it for gems), a
 * mystery crate (click it for a surprise: a higher ball, a star, a gem ball,
 * a bomb or gems) and a merge bomb (click it to merge every pair on the
 * board at once). On the board stars are odd negatives (-1, -3...), gem
 * balls even ones (-2, -4...), a crate -101 and a bomb -102; balls are
 * their level. The bin deletes a ball dropped on it (or clicked, then the
 * bin); your best ball only on the second try. Sort lines the board up,
 * highest first.
 *
 * Orders (three, up to five) each want a ball of some level: drag one onto
 * the order (or click it, then the order) for gems; every fifth brings a
 * crate. Merges less than 3 s apart build a combo, which pays with Merge
 * combo.
 *
 *   SlopeMerge.boost()     the gem boost from the best ball (1 = none)
 *   SlopeMerge.open(from)
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var BASE_CLICKS = 10;
  var BOARDS = [{ cols: 4, size: 16 }, { cols: 5, size: 20 }, { cols: 5, size: 25 }, { cols: 6, size: 30 }, { cols: 6, size: 36 },
    { cols: 7, size: 42 }, { cols: 7, size: 49 }];
  var STAR = -1, GEM = -2;    // special balls on the board (the first tier)
  // Two matching special balls merge into the next tier: stars are odd
  // (-1, -3, -5...), gem balls even (-2, -4, -6...), up to tier 10.
  var MAX_TIER = 10;
  var ROMAN = ["", "", " II", " III", " IV", " V", " VI", " VII", " VIII", " IX", " X"];
  var STAR_COLORS = [null, "#ffd43b", "#3bd5ff", "#ff5bd8", "#9b5bff", "#ff7a3b", "#3bff9e", "#ff3b3b", "#ffe8a0", "#ffffff"];
  var GEM_COLORS = ["#ffcc33", "#ff8a3b", "#ff4fa0", "#3bd5ff", "#9b5bff", "#3bff6e", "#ff3b3b", "#7fffd4", "#ffd700", "#ffffff"];
  var CRATE = -101, BOMB = -102;
  function isStar(v) { return v < 0 && v >= -20 && (-v) % 2 === 1; }
  function isGem(v) { return v < 0 && v >= -20 && (-v) % 2 === 0; }
  function isBox(v) { return v === CRATE || v === BOMB; }   // a crate or a bomb: clicked, never merged
  function tierOf(v) { return Math.ceil(-v / 2); }
  function starOf(t) { return -(2 * t - 1); }
  function gemOf(t) { return -(2 * t); }
  function starLevels(t) { return Math.pow(2, t) - 1; }           // +1, +3, +7, +15...
  function specialName(v) { return v === CRATE ? "Mystery crate" : v === BOMB ? "Merge bomb" : (isStar(v) ? "Star" : "Gem ball") + ROMAN[tierOf(v)]; }
  function specialColor(v) {
    if (v === CRATE) return "#e0a050";
    if (v === BOMB) return "#ff5533";
    var t = tierOf(v) - 1;
    return isStar(v) ? (STAR_COLORS[t] || window.SlopeUI.themeColor || "#00ff00") : GEM_COLORS[t];
  }
  var NEW_BEST_GEMS = 5;      // gems for each new best level, times the level
  var ORDER_GEMS = 20;        // gems an order pays, times its level
  var ORDERS = 3;             // orders at a time (More orders adds two)
  var COMBO_GAP = 3000;       // ms between merges that keep a combo going
  var COMBO_MAX = 10;
  var BOOST_PER_LEVEL = 0.1;  // gem boost a level above the first, plus Gem charm

  var UPGRADES = [
    { key: "fast", name: "Fast hands", max: 7, base: 15, growth: 1.7,
      effect: function (l) { return (BASE_CLICKS - l) + " clicks a ball"; } },
    { key: "auto", name: "Auto clicker", max: 20, base: 25, growth: 1.8,
      effect: function (l) { return l ? fmtNum(l * 0.5) + (l * 0.5 === 1 ? " click" : " clicks") + " a second" + (up("background") ? "" : " while open") : "Off"; } },
    { key: "double", name: "Double spawn", max: 10, base: 50, growth: 1.9,
      effect: function (l) { return (l * 6) + "% chance Spawn makes two balls"; } },
    { key: "better", name: "Better balls", max: Infinity, base: 60, growth: 2.2,
      effect: function (l) { return "New balls are level " + (1 + l) + " (at most 2 below your best)"; } },
    { key: "lucky", name: "Lucky merge", max: 12, base: 30, growth: 1.75,
      effect: function (l) { return (l * 4) + "% chance a merge skips a level"; } },
    { key: "combo", name: "Merge combo", max: 10, base: 150, growth: 1.9,
      effect: function (l) { return l ? "Merges less than 3 s apart build a combo (up to x" + COMBO_MAX + "): each pays " + fmtNum(l * 0.25) + " gems x combo x level" : "Off"; } },
    { key: "star", name: "Star balls", max: 10, base: 70, growth: 2,
      effect: function (l) { return l ? (l * 2) + "% of new balls are stars: drop one on a ball (not your best) to level it up" : "None"; } },
    { key: "gemball", name: "Gem balls", max: 10, base: 40, growth: 1.85,
      effect: function (l) { return l ? (l * 3) + "% of new balls are gem balls: click one for " + abbr(Math.round(gemBallValue(l) * (1 + 0.25 * up("polish")))) + " gems" : "None"; } },
    { key: "crate", name: "Mystery crates", max: 10, base: 120, growth: 1.9,
      effect: function (l) { return l ? (l * 2) + "% of new balls are crates: click one for a higher ball, a star, a gem ball, a bomb or gems" : "None (every fifth order brings one)"; } },
    { key: "bomb", name: "Merge bombs", max: 5, base: 500, growth: 2.4,
      effect: function (l) { return l ? l + "% of new balls are bombs: click one to merge every pair on the board at once" : "None (crates sometimes hold one)"; } },
    { key: "pay", name: "Merge pay", max: 20, base: 90, growth: 1.9,
      effect: function (l) { return l ? "Every merge pays " + fmtNum(l * 0.5) + " gems per level of the new ball" : "Off"; } },
    { key: "orderpay", name: "Order bonus", max: 20, base: 80, growth: 1.8,
      effect: function (l) { return "Orders pay " + abbr(Math.round(ORDER_GEMS * (1 + 0.25 * l))) + " gems per level of the ball (+" + (l * 25) + "%)"; } },
    { key: "ordermore", name: "More orders", max: 2, base: 300, growth: 4,
      effect: function (l) { return (ORDERS + l) + " orders at a time"; } },
    { key: "automerge", name: "Auto merge", max: 10, base: 150, growth: 2.2,
      effect: function (l) { return l ? "Merges the lowest pair by itself every " + fmtNum(autoMergeEvery(l)) + (autoMergeEvery(l) === 1 ? " second" : " seconds") + (up("background") ? "" : " while open") : "Off"; } },
    { key: "multimerge", name: "Multi merge", max: 4, base: 400, growth: 2.6,
      effect: function (l) { return "Auto merge merges " + (1 + l) + (l ? " pairs" : " pair") + " at a time"; } },
    { key: "autospecial", name: "Special auto merge", max: 1, base: 600, growth: 1,
      effect: function (l) { return l ? "Auto merge also merges matching stars and gem balls" : "Off: auto merge leaves stars and gem balls alone"; } },
    { key: "background", name: "Background merge", max: 1, base: 2500, growth: 1,
      effect: function (l) { return l ? "Auto clicker and auto merge keep going while Merge is closed" : "Off: they only work while Merge is open"; } },
    { key: "power", name: "Power clicks", max: 10, base: 40, growth: 1.8,
      effect: function (l) { return l ? (l * 5) + "% chance a click counts three times" : "Off"; } },
    { key: "starpow", name: "Star power", max: 10, base: 120, growth: 2,
      effect: function (l) { return l ? (l * 6) + "% of new stars come a tier higher" : "Off"; } },
    { key: "polish", name: "Gem polish", max: 20, base: 60, growth: 1.7,
      effect: function (l) { return "Gem balls are worth +" + (l * 25) + "%"; } },
    { key: "echo", name: "Echo merge", max: 10, base: 200, growth: 2.2,
      effect: function (l) { return l ? (l * 3) + "% chance a merge leaves one of its two balls behind" : "Off"; } },
    { key: "jackpot", name: "Merge jackpot", max: 10, base: 90, growth: 1.9,
      effect: function (l) { return l ? (l * 2) + "% chance a merge drops a gem ball" : "Off"; } },
    { key: "board", name: "Bigger board", max: BOARDS.length - 1, base: 80, growth: 2.5,
      effect: function (l) { return BOARDS[l].size + " spaces"; } },
    { key: "charm", name: "Gem charm", max: Infinity, base: 100, growth: 2,
      effect: function (l) { return "+" + Math.round((BOOST_PER_LEVEL + 0.02 * l) * 100) + "% gems per ball level"; } }
  ];

  function fmtNum(n) { return Math.round(n * 100) / 100 + ""; }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }   // full, for screen readers
  function abbr(n) { return profile.short ? profile.short(n) : fmt(n); }   // short, for the screen: 1.2K, 3.4M...
  function priceOf(u, level) { return Math.round(u.base * Math.pow(u.growth, level)); }

  var state = profile.get().merge;
  function up(key) { return state.up[key] || 0; }
  function clicksNeeded() { return Math.max(3, BASE_CLICKS - up("fast")); }
  function boardInfo() { return BOARDS[Math.min(up("board"), BOARDS.length - 1)]; }
  // New balls: Better balls raises them (up to 2 below your best); Gem
  // Prestige raises where they start.
  function spawnLevel() {
    var start = profile.boosts ? profile.boosts().mergeStart : 1;
    return Math.max(start, Math.min(1 + up("better"), state.best - 2));
  }
  function boostOf(m) { return m.best > 1 ? 1 + (m.best - 1) * (BOOST_PER_LEVEL + 0.02 * (m.up.charm || 0)) : 1; }
  function gemBallValue(l) { return Math.round((5 + 2 * Math.max(1, state.best)) * (1 + 0.1 * l)); }
  // A gem ball of tier t: three times the one below, plus Gem polish.
  function gemValue(t) { return Math.round(gemBallValue(up("gemball")) * (1 + 0.25 * up("polish")) * Math.pow(3, t - 1)); }
  // Seconds between auto merges: 10, 8, 6, 4, 2, then 1.7 down to 0.5 at level 10.
  function autoMergeEvery(l) { return l <= 5 ? Math.max(2, 12 - 2 * l) : Math.max(0.5, Math.round((2 - 0.3 * (l - 5)) * 10) / 10); }

  function fitBoard() {
    var size = boardInfo().size;
    while (state.board.length < size) state.board.push(0);
  }
  fitBoard();

  profile.onChange(function (p) {
    // Another tab or an account sign-in can bring a different state.
    if (JSON.stringify(p.merge) !== JSON.stringify(state)) { state = p.merge; fitBoard(); if (els) render(); }
  });

  function skin(level) { return window.SlopeSkins ? window.SlopeSkins.secret(level) : { id: "secret-" + level, name: "Level " + level }; }
  function image(level) {
    if (level < 0) return specialImage(level);
    return window.SlopeSkins && window.SlopeSkins.image ? window.SlopeSkins.image(skin(level)) : null;
  }

  // Special balls: a dark ball with a ring and a dot-matrix star or gem, in
  // the track colour (the star) or gold (the gem ball).
  var STAR_DOTS = ["....#....", "...###...", "#########", ".#######.", "..#####..", ".###.###.", ".##...##."];
  var GEM_DOTS = ["..###..", ".#####.", "#######", ".#####.", "..###..", "...#..."];
  var CRATE_DOTS = ["#######", "#.....#", "#.###.#", "#...#.#", "#..##.#", "#.....#", "#..#..#", "#######"];
  var BOMB_DOTS = ["......##", ".....#..", "..####..", ".######.", "########", "########", ".######.", "..####.."];
  function specialImage(kind) {
    var color = specialColor(kind), t = isBox(kind) ? 1 : tierOf(kind);
    var rows = kind === CRATE ? CRATE_DOTS : kind === BOMB ? BOMB_DOTS : isStar(kind) ? STAR_DOTS : GEM_DOTS, w = rows[0].length, h = rows.length;
    var cell = 34 / Math.max(w, h), ox = 32 - (w * cell) / 2, oy = 32 - (h * cell) / 2, dots = "";
    rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        if (row[x] === "#") dots += '<circle cx="' + (ox + (x + 0.5) * cell).toFixed(1) + '" cy="' + (oy + (y + 0.5) * cell).toFixed(1) + '" r="' + (cell * 0.42).toFixed(2) + '"/>';
      }
    });
    // Higher tiers: a second ring (2+), a glow (4+), and a pip for each tier along the top.
    var pips = "";
    for (var k = 1; k < t; k++) {
      var ang = Math.PI * (1.15 + 0.7 * (k - 0.5) / Math.max(1, t - 1));
      pips += '<circle cx="' + (32 + 24.5 * Math.cos(ang)).toFixed(1) + '" cy="' + (32 + 24.5 * Math.sin(ang)).toFixed(1) + '" r="2"/>';
    }
    return "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      (t >= 4 ? '<defs><radialGradient id="g"><stop offset="0.6" stop-color="' + color + '" stop-opacity="0.35"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></radialGradient></defs>' +
        '<circle cx="32" cy="32" r="32" fill="url(#g)"/>' : "") +
      '<circle cx="32" cy="32" r="29" fill="#050505" stroke="' + color + '" stroke-width="3"/>' +
      (t >= 2 ? '<circle cx="32" cy="32" r="24.5" fill="none" stroke="' + color + '" stroke-width="1" stroke-opacity="0.6"/>' : "") +
      '<g fill="' + color + '">' + dots + pips + "</g></svg>");
  }

  function commit(notify) { profile.saveMerge(state, notify); state = profile.get().merge; }

  // --- Screen ------------------------------------------------------------------

  var els = null, openedFrom = null, selected = -1, autoTimer = 0, autoCarry = 0, drag = null, pendingTrash = -1;
  var combo = 0, lastMerge = 0, autoActing = false;

  // A dot-matrix pair of balls for the HUD button.
  var ICON_DOTS = ["..##.##..", ".#..#..#.", "#..#.#..#", ".#..#..#.", "..##.##.."];
  function icon() {
    var dots = "";
    ICON_DOTS.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) if (row[x] === "#") dots += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.45"/>';
    });
    return '<svg viewBox="0 0 9 5" width="27" height="15" fill="currentColor" aria-hidden="true" focusable="false">' + dots + "</svg>";
  }

  // A dot-matrix bin: lid, handle and a ribbed body.
  var BIN_DOTS = ["..###..", "#######", ".#####.", ".#.#.#.", ".#.#.#.", ".#.#.#.", ".#####."];
  function binIcon() {
    var dots = "";
    BIN_DOTS.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) if (row[x] === "#") dots += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.45"/>';
    });
    return '<svg viewBox="0 0 7 7" width="21" height="21" fill="currentColor" aria-hidden="true" focusable="false">' + dots + "</svg>";
  }

  function gemIcon() {
    return window.SlopeGems && window.SlopeGems.iconSvg ? window.SlopeGems.iconSvg(14, 12) : "";
  }

  function build(ui) {
    var hudButton = document.createElement("button");
    hudButton.type = "button";
    hudButton.className = "slope-btn slope-hud-item slope-merge-open";
    hudButton.title = "Merge";
    hudButton.setAttribute("aria-label", "Merge game");
    hudButton.innerHTML = icon();
    ui.hud.appendChild(hudButton);
    hudButton.addEventListener("click", function () { open(hudButton); });

    var screen = document.createElement("div");
    screen.className = "slope-career slope-merge";
    screen.id = "slope-merge";
    screen.setAttribute("role", "dialog");
    screen.setAttribute("aria-labelledby", "slope-merge-title");
    screen.hidden = true;
    screen.innerHTML =
      '<div class="slope-career-inner slope-merge-inner">' +
        '<h2 class="slope-career-title" id="slope-merge-title">Merge</h2>' +
        '<p class="slope-merge-summary"></p>' +
        '<section class="slope-merge-orders-box" aria-labelledby="slope-merge-orders-title">' +
          '<h3 class="slope-shop-section" id="slope-merge-orders-title">Orders</h3>' +
          '<ul class="slope-merge-orders"></ul>' +
        "</section>" +
        '<div class="slope-merge-play">' +
          '<div class="slope-merge-board" role="group" aria-label="Board"></div>' +
          '<div class="slope-merge-side">' +
            '<button type="button" class="slope-btn slope-merge-spawn"><span class="slope-merge-spawn-label">Spawn</span>' +
              '<span class="slope-merge-dots" aria-hidden="true"></span></button>' +
            '<div class="slope-merge-tools">' +
              '<button type="button" class="slope-btn slope-merge-sort" aria-label="Sort the board, highest first">Sort</button>' +
              '<button type="button" class="slope-btn slope-merge-trash" aria-label="Bin: delete a ball">' + binIcon() + "<span>Bin</span></button>" +
            "</div>" +
            '<p class="slope-merge-hint">Click Spawn ' + BASE_CLICKS + ' times for a ball. Drag a ball onto one of the same level ' +
              "(or click one, then the other) to merge them. Every new level is a secret skin, and your best ball makes gems worth more. " +
              "Stars level up any ball but your best; click a gem ball for gems, a crate to open it, a bomb to merge every pair. Two matching stars or gem balls merge into a stronger one. " +
              "Drop a ball on an order for gems, or in the bin to delete it.</p>" +
            '<p class="slope-shop-status slope-merge-status" role="status"></p>' +
          "</div>" +
        "</div>" +
        '<h3 class="slope-shop-section">Upgrades</h3>' +
        '<ul class="slope-merge-upgrades"></ul>' +
        '<p class="slope-shop-note slope-merge-link slope-merge-prestige">Gem Prestige starts Merge and the gem upgrade tree over for boosts that last for good. ' +
          '<button type="button" class="slope-btn">Gem Prestige</button></p>' +
        '<h3 class="slope-shop-section">Secret skins</h3>' +
        '<p class="slope-shop-note slope-merge-skins-note"></p>' +
        '<ul class="slope-skins slope-merge-skins"></ul>' +
        '<div class="slope-career-actions"><button type="button" class="slope-btn slope-back">Back</button></div>' +
      "</div>";
    ui.root.appendChild(screen);
    screen.querySelector(".slope-merge-prestige button").addEventListener("click", function () {
      close();
      if (window.SlopeShop) window.SlopeShop.open(null, "upgrades");
      setTimeout(function () {
        var box = document.querySelector(".slope-prestige");
        if (box) { box.scrollIntoView({ block: "center" }); var b = box.querySelector("button"); if (b && !b.disabled) b.focus({ preventScroll: true }); }
      }, 150);
    });

    els = {
      screen: screen,
      hud: hudButton,
      summary: screen.querySelector(".slope-merge-summary"),
      board: screen.querySelector(".slope-merge-board"),
      spawn: screen.querySelector(".slope-merge-spawn"),
      trash: screen.querySelector(".slope-merge-trash"),
      dots: screen.querySelector(".slope-merge-dots"),
      status: screen.querySelector(".slope-merge-status"),
      upgrades: screen.querySelector(".slope-merge-upgrades"),
      skins: screen.querySelector(".slope-merge-skins"),
      skinsNote: screen.querySelector(".slope-merge-skins-note"),
      back: screen.querySelector(".slope-back"),
      orders: screen.querySelector(".slope-merge-orders"),
      sort: screen.querySelector(".slope-merge-sort"),
      cells: [], upgradeRows: {}, skinCards: {}, orderCards: []
    };
    els.sort.addEventListener("click", sortBoard);
    els.orders.addEventListener("click", function (e) {
      var skip = e.target.closest(".slope-merge-order-skip");
      if (skip) { skipOrder(+skip.getAttribute("data-order")); return; }
      var card = e.target.closest(".slope-merge-order");
      if (!card) return;
      var k = +card.getAttribute("data-order");
      if (selected >= 0) deliver(selected, k);
      else say("Click a level " + state.orders[k] + " ball, then this order (or drag the ball onto it).");
    });

    UPGRADES.forEach(function (u) {
      var li = document.createElement("li");
      li.innerHTML = '<div class="slope-merge-upgrade-text"><p class="slope-merge-upgrade-name"></p><p class="slope-merge-upgrade-effect"></p></div>' +
        '<button type="button" class="slope-btn slope-merge-buy"></button>';
      els.upgrades.appendChild(li);
      var row = { li: li, name: li.querySelector(".slope-merge-upgrade-name"), effect: li.querySelector(".slope-merge-upgrade-effect"), buy: li.querySelector("button") };
      row.buy.addEventListener("click", function () { buyUpgrade(u); });
      els.upgradeRows[u.key] = row;
    });

    // Power clicks: now and then a click counts three times.
    els.spawn.addEventListener("click", function () { click(Math.random() < up("power") * 0.05 ? 3 : 1); });
    els.trash.addEventListener("click", function () {
      if (selected >= 0) trash(selected);
      else say("Drag a ball onto the bin (or click a ball, then the bin) to delete it.");
    });
    els.back.addEventListener("click", close);
    screen.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    // A drag is followed on the whole window, not just the board, so a
    // release anywhere (or a lost pointer, a second finger, switching away)
    // always ends it and never leaves a ball floating on the screen.
    els.board.addEventListener("pointerdown", pointerDown);
    window.addEventListener("pointermove", pointerMove, true);
    window.addEventListener("pointerup", pointerUp, true);
    window.addEventListener("pointercancel", function (e) { if (drag && e.pointerId === drag.id) endDrag(); }, true);
    els.board.addEventListener("lostpointercapture", function (e) { if (drag && e.pointerId === drag.id && !drag.moving) endDrag(); });
    window.addEventListener("blur", function () { endDrag(); });
    document.addEventListener("visibilitychange", function () { if (document.hidden) endDrag(); });
    els.board.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    els.board.addEventListener("click", function (e) {
      if (e.detail !== 0) return;   // pointers are handled above; this is the keyboard
      var cell = e.target.closest(".slope-merge-cell");
      if (cell) tap(+cell.getAttribute("data-i"));
    });

    // The shop's Skins tab points here for the secret skins.
    var panel = window.SlopeShop && window.SlopeShop.panel("skins");
    if (panel) {
      var link = document.createElement("p");
      link.className = "slope-shop-note slope-merge-link";
      link.innerHTML = 'Secret skins come from the Merge game. <button type="button" class="slope-btn">Play Merge</button>';
      panel.insertBefore(link, panel.querySelector(".slope-skins"));
      link.querySelector("button").addEventListener("click", function () {
        var shop = document.getElementById("slope-shop");
        if (shop) shop.querySelector(".slope-back").click();
        open(els.hud);
      });
    }
  }

  // --- Board ---------------------------------------------------------------------

  function shown() { return !!els && !els.screen.hidden; }

  function renderBoard() {
    if (!shown()) return;
    var info = boardInfo();
    els.board.style.setProperty("--cols", info.cols);
    while (els.cells.length < state.board.length) {
      var i = els.cells.length;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "slope-merge-cell";
      b.setAttribute("data-i", i);
      b.innerHTML = '<img alt="" draggable="false"><span class="slope-merge-level"></span>';
      els.board.appendChild(b);
      els.cells.push({ el: b, img: b.querySelector("img"), label: b.querySelector(".slope-merge-level"), level: null });
    }
    state.board.forEach(function (level, i) { paintCell(i, level); });
  }

  function paintCell(i, level) {
    var c = els.cells[i];
    c.el.classList.toggle("is-selected", i === selected);
    if (c.level === level) return;
    c.level = level;
    c.el.classList.toggle("is-empty", !level);
    // Higher balls get flashier spaces: a glow (8+), a pulse (16+), a spinning
    // ring (28+), a rainbow ring (45+), a burst of rays (70+).
    // Special balls glow from tier 3, and more the higher they go.
    var tier = level > 0 ? (level >= 70 ? 5 : level >= 45 ? 4 : level >= 28 ? 3 : level >= 16 ? 2 : level >= 8 ? 1 : 0)
      : isBox(level) ? 1 : level < 0 ? Math.min(5, Math.max(0, tierOf(level) - 2)) : 0;
    c.el.className = c.el.className.replace(/ ?is-tier-\d/g, "") + (tier ? " is-tier-" + tier : "");
    if (tier && level > 0) {
      var a = skin(level).trail || [0, 1, 0];
      c.el.style.setProperty("--ball-glow", "rgb(" + a.map(function (v) { return Math.round(v * 255); }).join(",") + ")");
    } else if (tier) c.el.style.setProperty("--ball-glow", specialColor(level));
    else c.el.style.removeProperty("--ball-glow");
    if (isBox(level)) {
      c.img.src = specialImage(level);
      c.img.hidden = false;
      c.label.textContent = level === CRATE ? "?" : "!";
      c.el.setAttribute("aria-label", level === CRATE ? "Mystery crate: click it to open it" : "Merge bomb: click it to merge every pair on the board");
    } else if (level < 0) {
      c.img.src = specialImage(level);
      c.img.hidden = false;
      var t = tierOf(level), value = gemValue(t);
      c.label.textContent = isStar(level) ? "+" + starLevels(t) : "+" + abbr(value);
      c.el.setAttribute("aria-label", isStar(level)
        ? specialName(level) + ": drop it on any ball but your best to raise it " + starLevels(t) + (t > 1 ? " levels" : " level") + (t < MAX_TIER ? ", or onto another " + specialName(level) + " to merge them" : "")
        : specialName(level) + ": click it for " + fmt(value) + " gems" + (t < MAX_TIER ? ", or drag it onto another " + specialName(level) + " to merge them" : ""));
    } else if (level) {
      var url = image(level), s = skin(level);
      if (url) c.img.src = url; else c.img.removeAttribute("src");
      c.img.hidden = !url;
      c.label.textContent = level;
      c.el.setAttribute("aria-label", s.name + ", level " + level);
    } else {
      c.img.hidden = true;
      c.label.textContent = "";
      c.el.setAttribute("aria-label", "Empty space");
    }
  }

  function pop(i) {
    if (!shown()) return;
    var el = els.cells[i].el;
    el.classList.remove("is-pop");
    void el.offsetWidth;   // restart the animation
    el.classList.add("is-pop");
  }

  // Moves, merges or swaps the ball at `from` with what is at `to`. A star
  // levels up the ball it meets, either way round.
  function act(from, to) {
    selected = -1;
    pendingTrash = -1;
    if (from === to || !state.board[from]) { renderBoard(); return; }
    var a = state.board[from], b = state.board[to];
    if (!b) {
      state.board[to] = a; state.board[from] = 0;
      commit(false);
    } else if (a > 0 && a === b) {
      var lucky = Math.random() < up("lucky") * 0.04;
      made(from, to, a + (lucky ? 2 : 1), lucky ? "Lucky! " : "", a);
    } else if ((isStar(a) || isGem(a)) && a === b) {
      // Two matching special balls: the next tier.
      var t = tierOf(a);
      if (t >= MAX_TIER) {
        say(specialName(a) + " is as strong as it gets.");
        renderBoard();
        return;
      }
      var up1 = isStar(a) ? starOf(t + 1) : gemOf(t + 1);
      state.board[to] = up1; state.board[from] = 0;
      state.made += 1;
      commit(false);
      say("Merged into a " + specialName(up1) + "! " + (isStar(up1) ? "It raises a ball " + starLevels(t + 1) + " levels." : "It's worth " + abbr(gemValue(t + 1)) + " gems."));
      pop(to);
    } else if ((isStar(a) && b > 0) || (isStar(b) && a > 0)) {
      // A star raises any ball but your best (as far as your best, no further):
      // new bests come from merging.
      var star = isStar(a) ? a : b, target = isStar(a) ? b : a;
      if (target >= state.best) {
        say("Stars can't level up your best ball (level " + state.best + "). Use it on a lower one.");
        renderBoard();
        return;
      }
      made(from, to, Math.min(state.best, target + starLevels(tierOf(star))), specialName(star) + "! ");
    } else {
      state.board[to] = a; state.board[from] = b;
      commit(false);
    }
    render();
  }

  // A merge (or a star) made a ball of `level` at `to`. A merge of two balls
  // of level `pair` can echo (one of them stays) or drop a jackpot gem ball.
  function made(from, to, level, how, pair) {
    state.board[to] = level; state.board[from] = 0;
    state.made += 1;
    if (pair && Math.random() < up("echo") * 0.03) {
      state.board[from] = pair;
      how = "Echo! " + how;
    }
    if (pair && Math.random() < up("jackpot") * 0.02) {
      var empty = [];
      state.board.forEach(function (v, i) { if (!v) empty.push(i); });
      if (empty.length) {
        var spot = empty[Math.floor(Math.random() * empty.length)];
        state.board[spot] = GEM;
        how = "Jackpot gem ball! " + how;
        setTimeout(function () { pop(spot); }, 0);
      }
    }
    var pay = Math.round(level * up("pay") * 0.5);
    // A combo: merges by your hand (or a bomb) less than 3 s apart.
    if (pair && !autoActing) {
      var now = performance.now();
      combo = now - lastMerge < COMBO_GAP ? Math.min(COMBO_MAX, combo + 1) : 1;
      lastMerge = now;
      if (combo > 1 && up("combo")) {
        pay += Math.round(level * combo * 0.25 * up("combo"));
        how = "Combo x" + combo + "! " + how;
      } else if (combo > 2) how = "Combo x" + combo + "! " + how;
    }
    if (level > state.best) {
      var gems = NEW_BEST_GEMS * level;
      state.best = level;
      commit(true);
      profile.addGems(gems + pay);
      say(how + "New ball: " + skin(level).name + " (level " + level + ")! Its secret skin is yours, and +" + abbr(gems + pay) + " gems.");
      renderSkins();
    } else {
      commit(false);
      if (pay) profile.addGems(pay);
      say(how + "Merged into level " + level + "." + (pay ? " +" + abbr(pay) + " gems." : ""));
    }
    pop(to);
  }

  // A gem ball, clicked: its gems.
  function cashGem(i) {
    var v = state.board[i], value = gemValue(tierOf(v));
    state.board[i] = 0;
    commit(false);
    profile.addGems(value);
    say(specialName(v) + ": +" + abbr(value) + " gems!");
    render();
  }

  // The bin: the ball at i goes. Your best ball needs a second try.
  function trash(i) {
    selected = -1;
    var v = state.board[i];
    if (!v) { renderBoard(); return; }
    if (v > 0 && v >= state.best && pendingTrash !== i) {
      pendingTrash = i;
      say("That's your best ball. Put it in the bin again to delete it.");
      renderBoard();
      return;
    }
    pendingTrash = -1;
    state.board[i] = 0;
    commit(false);
    say(v < 0 ? specialName(v) + " deleted." : "Level " + v + " ball deleted.");
    render();
  }

  // A mystery crate, clicked: what was inside takes its space (or gems).
  function openCrate(i) {
    var r = Math.random(), inside, text;
    if (r < 0.4) {
      inside = Math.max(spawnLevel(), Math.min(state.best - 1, spawnLevel() + 1 + Math.floor(Math.random() * 3)));
      text = "a level " + inside + " ball";
    } else if (r < 0.6) { inside = Math.random() < 0.25 ? starOf(2) : STAR; text = "a " + specialName(inside); }
    else if (r < 0.8) { inside = Math.random() < 0.25 ? gemOf(2) : GEM; text = "a " + specialName(inside); }
    else if (r < 0.9) { inside = BOMB; text = "a merge bomb"; }
    else inside = 0;
    state.board[i] = inside;
    commit(false);
    if (inside) say("Crate: " + text + "!");
    else { var g = gemValue(2); profile.addGems(g); say("Crate: +" + abbr(g) + " gems!"); }
    render();
    pop(i);
  }

  // A merge bomb, clicked: every pair on the board merges, the lowest first,
  // again and again until none are left.
  function explode(i) {
    state.board[i] = 0;
    commit(false);
    var count = 0;
    for (; count < 80; count++) {
      var first = {}, pair = null;
      state.board.forEach(function (v, k) {
        if (v <= 0) return;
        if (first[v] === undefined) first[v] = k;
        else if (!pair || v < pair.level) pair = { from: k, to: first[v], level: v };
      });
      if (!pair) break;
      act(pair.from, pair.to);
    }
    say("Bomb! " + (count ? count + (count === 1 ? " merge" : " merges") + (combo > 1 ? ", combo x" + combo : "") + "." : "Nothing to merge."));
    render();
  }

  function tap(i) {
    if (selected === -1) {
      if (isGem(state.board[i])) { cashGem(i); return; }
      if (state.board[i] === CRATE) { openCrate(i); return; }
      if (state.board[i] === BOMB) { explode(i); return; }
      if (state.board[i]) { selected = i; renderBoard(); }
      return;
    }
    act(selected, i);
  }

  // Dragging: a copy of the ball follows the pointer; dropping it on another
  // space merges, moves or swaps. A press without moving is a click.
  function pointerDown(e) {
    var cell = e.target.closest(".slope-merge-cell");
    if (!cell || e.button > 0) return;
    if (drag) { endDrag(); return; }   // a second finger or button: drop the first drag
    if (e.isPrimary === false) return;
    var i = +cell.getAttribute("data-i");
    drag = { from: i, x: e.clientX, y: e.clientY, id: e.pointerId, moving: false, ghost: null };
    try { els.board.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function pointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (!state.board[drag.from] || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moving = true;
      var src = els.cells[drag.from];
      var ghost = drag.ghost = document.createElement("div");
      ghost.className = "slope-merge-ghost";
      ghost.innerHTML = src.el.innerHTML;
      window.SlopeUI.root.appendChild(ghost);
      src.el.classList.add("is-lifted");
    }
    drag.ghost.style.transform = "translate(" + (e.clientX - 32) + "px," + (e.clientY - 32) + "px)";
    var over = document.elementFromPoint(e.clientX, e.clientY);
    els.trash.classList.toggle("is-over", !!(over && over.closest(".slope-merge-trash")));
    var onOrder = over && over.closest(".slope-merge-order");
    els.orderCards.forEach(function (oc) { oc.btn.classList.toggle("is-over", oc.btn === onOrder); });
  }

  function pointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    endDrag();
    if (!d.moving) { tap(d.from); return; }
    var under = document.elementFromPoint(e.clientX, e.clientY);
    if (under && under.closest(".slope-merge-trash")) { trash(d.from); return; }
    var order = under && under.closest(".slope-merge-order");
    if (order) { deliver(d.from, +order.getAttribute("data-order")); return; }
    var cell = under && under.closest(".slope-merge-cell");
    if (cell && els.board.contains(cell)) act(d.from, +cell.getAttribute("data-i"));
  }

  function endDrag() {
    var d = drag;
    drag = null;
    if (d) { try { els.board.releasePointerCapture(d.id); } catch (err) {} }
    // Clear every floating copy and lifted space, not only this drag's.
    Array.prototype.forEach.call(window.SlopeUI.root.querySelectorAll(".slope-merge-ghost"), function (g) { g.remove(); });
    els.cells.forEach(function (c) { c.el.classList.remove("is-lifted"); });
    els.trash.classList.remove("is-over");
    els.orderCards.forEach(function (oc) { oc.btn.classList.remove("is-over"); });
  }

  // --- Orders -----------------------------------------------------------------------

  function orderSlots() { return ORDERS + up("ordermore"); }
  function orderGems(level) { return Math.round(ORDER_GEMS * level * (1 + 0.25 * up("orderpay"))); }
  // A ball one or more merges away: above what Spawn makes, below your best.
  function newOrderLevel() {
    var lo = Math.max(spawnLevel() + 1, state.best - 4), hi = Math.max(lo, state.best - 1);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  // Every slot has an order once there is a first ball.
  function fillOrders() {
    if (!state.best) return false;
    var changed = false;
    while (state.orders.length < orderSlots()) { state.orders.push(0); changed = true; }
    if (state.orders.length > orderSlots()) { state.orders.length = orderSlots(); changed = true; }
    state.orders.forEach(function (v, k) { if (!v) { state.orders[k] = newOrderLevel(); changed = true; } });
    return changed;
  }

  // The ball at i goes to order k, if it is the level the order wants.
  function deliver(i, k) {
    selected = -1;
    var v = state.board[i], want = state.orders[k];
    if (!want) { renderBoard(); return; }
    if (v !== want) {
      say(v > 0 ? "That order wants a level " + want + " ball (this one is level " + v + ")." : "Orders want balls, not " + specialName(v).toLowerCase() + "s.");
      renderBoard();
      return;
    }
    var gems = orderGems(want);
    state.board[i] = 0;
    state.orders[k] = newOrderLevel();
    state.delivered += 1;
    var crate = -1;
    if (state.delivered % 5 === 0) {   // every fifth order: a crate
      var empty = [];
      state.board.forEach(function (x, j) { if (!x) empty.push(j); });
      if (empty.length) { crate = empty[Math.floor(Math.random() * empty.length)]; state.board[crate] = CRATE; }
    }
    commit(false);
    profile.addGems(gems);
    say("Order delivered: +" + abbr(gems) + " gems!" + (crate >= 0 ? " And a mystery crate." : ""));
    render();
    if (crate >= 0) pop(crate);
  }

  function skipOrder(k) {
    if (!state.orders[k]) return;
    var before = state.orders[k];
    for (var tries = 0; tries < 6 && state.orders[k] === before; tries++) state.orders[k] = newOrderLevel();
    commit(false);
    say("New order: a level " + state.orders[k] + " ball.");
    renderOrders();
  }

  function renderOrders() {
    if (!shown()) return;
    if (fillOrders()) commit(false);
    if (!state.best) {
      els.orders.innerHTML = '<li class="slope-merge-orders-empty">Spawn your first ball to get orders.</li>';
      els.orderCards = [];
      return;
    }
    if (els.orderCards.length !== state.orders.length) {
      els.orders.innerHTML = state.orders.map(function (v, k) {
        return '<li><button type="button" class="slope-btn slope-merge-order" data-order="' + k + '"><img alt="" draggable="false">' +
          '<span class="slope-merge-order-name"></span><span class="slope-merge-order-reward"></span></button>' +
          '<button type="button" class="slope-btn slope-merge-order-skip" data-order="' + k + '">Skip</button></li>';
      }).join("");
      els.orderCards = Array.prototype.map.call(els.orders.querySelectorAll(".slope-merge-order"), function (b) {
        return { btn: b, img: b.querySelector("img"), name: b.querySelector(".slope-merge-order-name"), reward: b.querySelector(".slope-merge-order-reward"), level: null, skip: b.parentNode.querySelector(".slope-merge-order-skip") };
      });
    }
    state.orders.forEach(function (v, k) {
      var oc = els.orderCards[k], gems = orderGems(v);
      if (oc.level !== v) {
        oc.level = v;
        var url = image(v);
        if (url) oc.img.src = url; else oc.img.removeAttribute("src");
        oc.name.textContent = "Level " + v;
      }
      oc.reward.textContent = "+" + abbr(gems) + " gems";
      var have = state.board.indexOf(v) >= 0;
      oc.btn.classList.toggle("is-ready", have);
      oc.btn.setAttribute("aria-label", "Order: a level " + v + " ball for " + fmt(gems) + " gems" + (have ? ", you have one" : ""));
      oc.skip.setAttribute("aria-label", "Skip the level " + v + " order");
    });
  }

  // Sort: balls highest first, then stars, gem balls, crates and bombs.
  function sortBoard() {
    selected = -1;
    function rank(v) { return v > 0 ? 1e7 + v : isStar(v) ? 3e6 + tierOf(v) : isGem(v) ? 2e6 + tierOf(v) : v === CRATE ? 2 : 1; }
    var balls = state.board.filter(Boolean).sort(function (a, b) { return rank(b) - rank(a); });
    state.board = state.board.map(function (v, i) { return i < balls.length ? balls[i] : 0; });
    commit(false);
    say("Sorted.");
    render();
  }

  // --- Spawning ------------------------------------------------------------------

  function click(n) {
    var need = clicksNeeded();
    state.clicks = Math.min(need, state.clicks + n);
    if (state.clicks >= need) {
      var empty = [];
      state.board.forEach(function (v, i) { if (!v) empty.push(i); });
      if (!empty.length) {
        say("The board is full: merge some balls to make room.");
      } else {
        // Sometimes a star or a gem ball (upgrades), and sometimes two balls.
        var r = Math.random(), starChance = up("star") * 0.02, gemChance = up("gemball") * 0.03, crateChance = up("crate") * 0.02, bombChance = up("bomb") * 0.01;
        var kind = !state.best ? spawnLevel() : r < starChance ? STAR : r < starChance + gemChance ? GEM :
          r < starChance + gemChance + crateChance ? CRATE : r < starChance + gemChance + crateChance + bombChance ? BOMB : spawnLevel();
        // Star power: some stars come a tier (or two) higher.
        if (kind === STAR && Math.random() < up("starpow") * 0.06) kind = starOf(Math.random() < 0.25 ? 3 : 2);
        var i = empty.splice(Math.floor(Math.random() * empty.length), 1)[0];
        state.board[i] = kind;
        state.clicks = 0;
        var first = kind > state.best;
        if (first) state.best = kind;
        var second = -1;
        if (empty.length && Math.random() < up("double") * 0.06) {
          second = empty[Math.floor(Math.random() * empty.length)];
          state.board[second] = spawnLevel();
        }
        commit(first);
        renderBoard();
        pop(i);
        if (second >= 0) pop(second);
        if (first) { renderSkins(); say("Your first ball! Merge two of the same level to make the next one."); }
        else if (isStar(kind)) say("A " + specialName(kind) + "! Drop it on any ball but your best to raise it " + starLevels(tierOf(kind)) + (tierOf(kind) > 1 ? " levels" : " level") + ", or merge two stars.");
        else if (kind === GEM) say("A gem ball! Click it for " + abbr(gemValue(1)) + " gems, or merge two for a bigger one.");
        else if (kind === CRATE) say("A mystery crate! Click it to see what's inside.");
        else if (kind === BOMB) say("A merge bomb! Click it to merge every pair on the board at once.");
        else if (second >= 0) say("Double spawn: two balls!");
      }
    } else {
      commit(false);
    }
    renderSpawn();
  }

  function renderSpawn() {
    if (!shown()) return;
    var need = clicksNeeded(), dots = "";
    for (var i = 0; i < need; i++) dots += '<span class="' + (i < state.clicks ? "is-on" : "") + '"></span>';
    els.dots.innerHTML = dots;
    els.spawn.setAttribute("aria-label", "Spawn a ball, " + state.clicks + " of " + need + " clicks");
  }

  function startAuto() {
    stopAuto();
    if (!up("auto")) return;
    autoCarry = 0;
    var last = performance.now();
    autoTimer = setInterval(function () {
      if (!keepRunning()) { stopAuto(); return; }
      var now = performance.now(), rate = up("auto") * 0.5;
      autoCarry += rate * Math.min(1, (now - last) / 1000);
      last = now;
      var whole = Math.floor(autoCarry);
      if (whole > 0) { autoCarry -= whole; click(whole); }
    }, 100);
  }
  function stopAuto() { clearInterval(autoTimer); autoTimer = 0; }

  // Auto merge: every few seconds the lowest pair of the same level merges.
  var autoMergeTimer = 0;
  function startAutoMerge() {
    stopAutoMerge();
    if (up("automerge")) autoMergeTimer = setInterval(autoMergeOnce, autoMergeEvery(up("automerge")) * 1000);
  }
  function stopAutoMerge() { clearInterval(autoMergeTimer); autoMergeTimer = 0; }
  // The timers run while Merge is open, or always with Background merge.
  function keepRunning() { return shown() || up("background") > 0; }
  // The lowest pair first (Multi merge: several pairs at a time); with
  // Special auto merge, matching stars and gem balls too, after the balls.
  function autoMergeOnce() {
    if (!up("automerge") || !keepRunning()) { stopAutoMerge(); return; }
    if (drag || selected !== -1) return;   // never under the player's hand
    function rank(v) { return v > 0 ? v : 1e6 + tierOf(v); }
    for (var k = 0, times = 1 + up("multimerge"); k < times; k++) {
      var first = {}, pair = null;
      state.board.forEach(function (v, i) {
        if (!v || isBox(v) || (v < 0 && (!up("autospecial") || tierOf(v) >= MAX_TIER))) return;
        if (first[v] === undefined) first[v] = i;
        else if (!pair || rank(v) < rank(pair.level)) pair = { from: i, to: first[v], level: v };
      });
      if (!pair) break;
      autoActing = true;
      try { act(pair.from, pair.to); } finally { autoActing = false; }
    }
  }

  // Background merge: started with the page, and kept going after Merge closes.
  function startBackground() {
    if (!up("background")) return;
    if (!autoTimer) startAuto();
    if (!autoMergeTimer) startAutoMerge();
  }

  // --- Upgrades and skins ----------------------------------------------------------

  function renderUpgrades() {
    var gems = profile.get().gems;
    UPGRADES.forEach(function (u) {
      var row = els.upgradeRows[u.key], level = up(u.key), maxed = level >= u.max, price = priceOf(u, level);
      row.name.textContent = u.name + (level ? " " + level : "");
      row.effect.textContent = "Now: " + u.effect(level) + (maxed ? " (max)" : ". Next: " + u.effect(level + 1));
      row.buy.disabled = maxed || gems < price;
      row.buy.innerHTML = maxed ? "Max" : gemIcon() + "<span>" + abbr(price) + "</span>";
      row.buy.setAttribute("aria-label", maxed ? u.name + ", at its best" : "Buy " + u.name + " for " + fmt(price) + " gems" + (gems < price ? ", you need " + fmt(price - gems) + " more" : ""));
    });
  }

  function buyUpgrade(u) {
    var level = up(u.key);
    if (level >= u.max) return;
    var price = priceOf(u, level);
    if (!profile.spendGems(price)) { say("You need " + abbr(price - profile.get().gems) + " more gems for " + u.name + "."); return; }
    state = profile.get().merge;
    state.up[u.key] = level + 1;
    fitBoard();
    commit(true);
    if (u.key === "auto") startAuto();
    if (u.key === "automerge") startAutoMerge();
    if (u.key === "background") startBackground();
    say(u.name + " is now " + (level + 1) + ": " + u.effect(level + 1) + ".");
    render();
  }

  function renderSkins() {
    if (!shown()) return;
    var p = profile.get(), found = Math.max(state.best, p.secretBest || 0);
    els.skinsNote.textContent = found ? "You've found " + found + (found === 1 ? " ball" : " balls") + ". Merge for more: they never run out."
      : "Spawn your first ball to find the first one.";
    for (var level = 1; level <= found; level++) {
      var card = els.skinCards[level];
      if (!card) {
        var s = skin(level), li = document.createElement("li");
        li.className = "slope-skin";
        li.innerHTML = '<img class="slope-skin-preview" alt="">' + '<p class="slope-skin-name"></p>' +
          '<p class="slope-skin-price"></p><button type="button" class="slope-btn slope-skin-action"></button>';
        li.querySelector(".slope-skin-name").textContent = s.name;
        li.querySelector(".slope-skin-price").textContent = "Level " + level;
        var url = image(level);
        if (url) li.querySelector("img").src = url;
        els.skins.appendChild(li);
        card = els.skinCards[level] = { li: li, action: li.querySelector("button"), skin: s };
        card.action.addEventListener("click", (function (id) { return function () { profile.equipSkin(id); renderSkins(); }; })(s.id));
      }
      var on = p.skin === card.skin.id;
      card.li.classList.toggle("is-equipped", on);
      card.action.textContent = on ? "Equipped" : "Equip";
      card.action.setAttribute("aria-pressed", String(on));
      card.action.setAttribute("aria-label", on ? card.skin.name + ", on your ball" : "Equip " + card.skin.name);
    }
  }

  function renderSummary() {
    var boost = boostOf(state);
    var p = profile.get();
    els.summary.innerHTML = (state.best
      ? "Best ball: <strong>" + skin(state.best).name + "</strong> (level " + state.best + ")  \u00b7  gems x" + boost.toFixed(2)
      : "No balls yet") +
      (p.prestige ? "  \u00b7  Prestige " + p.prestige : "") +
      (state.delivered ? "  \u00b7  " + fmt(state.delivered) + (state.delivered === 1 ? " order" : " orders") + " delivered" : "");
  }

  function render() {
    if (!shown()) return;
    renderSummary();
    renderOrders();
    renderBoard();
    renderSpawn();
    renderUpgrades();
  }

  function say(text) { if (els) els.status.textContent = text; }

  // --- Open and close --------------------------------------------------------------

  // Ball pictures carry the track colour tint: new colour, new pictures.
  var pictureTint = null;
  function open(from) {
    if (!els) return;
    openedFrom = from || null;
    window.SlopeUI.closeSettings();
    var shop = document.getElementById("slope-shop");
    if (shop && !shop.hidden) shop.querySelector(".slope-back").click();
    var toast = window.SlopeUI.root.querySelector(".slope-toast");
    if (toast) toast.hidden = true;
    if (pictureTint !== window.SlopeUI.themeColor) {
      pictureTint = window.SlopeUI.themeColor;
      els.cells.forEach(function (c) { c.level = null; });
      Object.keys(els.skinCards).forEach(function (k) { var u = image(+k); if (u) els.skinCards[k].li.querySelector("img").src = u; });
    }
    say("");
    selected = -1;
    els.screen.hidden = false;
    els.screen.scrollTop = 0;
    if (game.pause) game.pause("merge");
    render();
    renderSkins();
    if (up("auto")) startAuto();
    startAutoMerge();
    els.spawn.focus({ preventScroll: true });
  }

  function close() {
    endDrag();
    selected = -1;
    if (!up("background")) {
      stopAuto();
      stopAutoMerge();
    }
    els.screen.hidden = true;
    if (game.resume) game.resume("merge");
    if (openedFrom && document.contains(openedFrom)) openedFrom.focus();
    else if (els.screen.contains(document.activeElement)) document.activeElement.blur();
    openedFrom = null;
  }

  profile.onChange(function () { if (els && !els.screen.hidden) { renderUpgrades(); renderSummary(); } });

  window.SlopeUI.ready(function (ui) {
    build(ui);
    startBackground();
  });

  window.SlopeMerge = {
    boost: function () { return boostOf(state); },
    open: function (from) { open(from); }
  };
})();
