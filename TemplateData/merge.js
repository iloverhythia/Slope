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
 *   SlopeMerge.boost()     the gem boost from the best ball (1 = none)
 *   SlopeMerge.open(from)
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var BASE_CLICKS = 10;
  var BOARDS = [{ cols: 4, size: 16 }, { cols: 5, size: 20 }, { cols: 5, size: 25 }, { cols: 6, size: 30 }, { cols: 6, size: 36 }];
  var NEW_BEST_GEMS = 5;      // gems for each new best level, times the level
  var BOOST_PER_LEVEL = 0.1;  // gem boost a level above the first, plus Gem charm

  var UPGRADES = [
    { key: "fast", name: "Fast hands", max: 7, base: 15, growth: 1.7,
      effect: function (l) { return (BASE_CLICKS - l) + " clicks a ball"; } },
    { key: "auto", name: "Auto clicker", max: 10, base: 25, growth: 1.8,
      effect: function (l) { return l ? fmtNum(l * 0.5) + (l * 0.5 === 1 ? " click" : " clicks") + " a second while open" : "Off"; } },
    { key: "better", name: "Better balls", max: Infinity, base: 60, growth: 2.2,
      effect: function (l) { return "New balls are level " + (1 + l) + " (at most 2 below your best)"; } },
    { key: "lucky", name: "Lucky merge", max: 12, base: 30, growth: 1.75,
      effect: function (l) { return (l * 4) + "% chance a merge skips a level"; } },
    { key: "board", name: "Bigger board", max: BOARDS.length - 1, base: 80, growth: 2.5,
      effect: function (l) { return BOARDS[l].size + " spaces"; } },
    { key: "charm", name: "Gem charm", max: Infinity, base: 100, growth: 2,
      effect: function (l) { return "+" + Math.round((BOOST_PER_LEVEL + 0.02 * l) * 100) + "% gems per ball level"; } }
  ];

  function fmtNum(n) { return Math.round(n * 100) / 100 + ""; }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function priceOf(u, level) { return Math.round(u.base * Math.pow(u.growth, level)); }

  var state = profile.get().merge;
  function up(key) { return state.up[key] || 0; }
  function clicksNeeded() { return Math.max(3, BASE_CLICKS - up("fast")); }
  function boardInfo() { return BOARDS[Math.min(up("board"), BOARDS.length - 1)]; }
  function spawnLevel() { return Math.max(1, Math.min(1 + up("better"), state.best - 2)); }
  function boostOf(m) { return m.best > 1 ? 1 + (m.best - 1) * (BOOST_PER_LEVEL + 0.02 * (m.up.charm || 0)) : 1; }

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
  function image(level) { return window.SlopeSkins && window.SlopeSkins.image ? window.SlopeSkins.image(skin(level)) : null; }

  function commit(notify) { profile.saveMerge(state, notify); state = profile.get().merge; }

  // --- Screen ------------------------------------------------------------------

  var els = null, openedFrom = null, selected = -1, autoTimer = 0, autoCarry = 0, drag = null;

  // A dot-matrix pair of balls for the HUD button.
  var ICON_DOTS = ["..##.##..", ".#..#..#.", "#..#.#..#", ".#..#..#.", "..##.##.."];
  function icon() {
    var dots = "";
    ICON_DOTS.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) if (row[x] === "#") dots += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.45"/>';
    });
    return '<svg viewBox="0 0 9 5" width="27" height="15" fill="currentColor" aria-hidden="true" focusable="false">' + dots + "</svg>";
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
        '<div class="slope-merge-play">' +
          '<div class="slope-merge-board" role="group" aria-label="Board"></div>' +
          '<div class="slope-merge-side">' +
            '<button type="button" class="slope-btn slope-merge-spawn"><span class="slope-merge-spawn-label">Spawn</span>' +
              '<span class="slope-merge-dots" aria-hidden="true"></span></button>' +
            '<p class="slope-merge-hint">Click Spawn ' + BASE_CLICKS + ' times for a ball. Drag a ball onto one of the same level ' +
              "(or click one, then the other) to merge them. Every new level is a secret skin, and your best ball makes gems worth more.</p>" +
            '<p class="slope-shop-status slope-merge-status" role="status"></p>' +
          "</div>" +
        "</div>" +
        '<h3 class="slope-shop-section">Upgrades</h3>' +
        '<ul class="slope-merge-upgrades"></ul>' +
        '<h3 class="slope-shop-section">Secret skins</h3>' +
        '<p class="slope-shop-note slope-merge-skins-note"></p>' +
        '<ul class="slope-skins slope-merge-skins"></ul>' +
        '<div class="slope-career-actions"><button type="button" class="slope-btn slope-back">Back</button></div>' +
      "</div>";
    ui.root.appendChild(screen);

    els = {
      screen: screen,
      hud: hudButton,
      summary: screen.querySelector(".slope-merge-summary"),
      board: screen.querySelector(".slope-merge-board"),
      spawn: screen.querySelector(".slope-merge-spawn"),
      dots: screen.querySelector(".slope-merge-dots"),
      status: screen.querySelector(".slope-merge-status"),
      upgrades: screen.querySelector(".slope-merge-upgrades"),
      skins: screen.querySelector(".slope-merge-skins"),
      skinsNote: screen.querySelector(".slope-merge-skins-note"),
      back: screen.querySelector(".slope-back"),
      cells: [], upgradeRows: {}, skinCards: {}
    };

    UPGRADES.forEach(function (u) {
      var li = document.createElement("li");
      li.innerHTML = '<div class="slope-merge-upgrade-text"><p class="slope-merge-upgrade-name"></p><p class="slope-merge-upgrade-effect"></p></div>' +
        '<button type="button" class="slope-btn slope-merge-buy"></button>';
      els.upgrades.appendChild(li);
      var row = { li: li, name: li.querySelector(".slope-merge-upgrade-name"), effect: li.querySelector(".slope-merge-upgrade-effect"), buy: li.querySelector("button") };
      row.buy.addEventListener("click", function () { buyUpgrade(u); });
      els.upgradeRows[u.key] = row;
    });

    els.spawn.addEventListener("click", function () { click(1); });
    els.back.addEventListener("click", close);
    screen.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    els.board.addEventListener("pointerdown", pointerDown);
    els.board.addEventListener("pointermove", pointerMove);
    els.board.addEventListener("pointerup", pointerUp);
    els.board.addEventListener("pointercancel", function () { endDrag(); });
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

  function renderBoard() {
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
      els.cells.push({ el: b, img: b.querySelector("img"), label: b.querySelector(".slope-merge-level"), level: -1 });
    }
    state.board.forEach(function (level, i) { paintCell(i, level); });
  }

  function paintCell(i, level) {
    var c = els.cells[i];
    c.el.classList.toggle("is-selected", i === selected);
    if (c.level === level) return;
    c.level = level;
    c.el.classList.toggle("is-empty", !level);
    if (level) {
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
    var el = els.cells[i].el;
    el.classList.remove("is-pop");
    void el.offsetWidth;   // restart the animation
    el.classList.add("is-pop");
  }

  // Moves, merges or swaps the ball at `from` with what is at `to`.
  function act(from, to) {
    selected = -1;
    if (from === to || !state.board[from]) { renderBoard(); return; }
    var a = state.board[from], b = state.board[to];
    if (!b) {
      state.board[to] = a; state.board[from] = 0;
      commit(false);
    } else if (a === b) {
      var lucky = Math.random() < up("lucky") * 0.04;
      var level = a + (lucky ? 2 : 1);
      state.board[to] = level; state.board[from] = 0;
      state.made += 1;
      var best = level > state.best;
      if (best) {
        var gems = NEW_BEST_GEMS * level;
        state.best = level;
        commit(true);
        profile.addGems(gems);
        say("New ball: " + skin(level).name + " (level " + level + ")! Its secret skin is yours, and +" + gems + " gems.");
        renderSkins();
      } else {
        commit(false);
        say((lucky ? "Lucky! " : "") + "Merged into level " + level + ".");
      }
      pop(to);
    } else {
      state.board[to] = a; state.board[from] = b;
      commit(false);
    }
    render();
  }

  function tap(i) {
    if (selected === -1) {
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
    var i = +cell.getAttribute("data-i");
    drag = { from: i, x: e.clientX, y: e.clientY, id: e.pointerId, moving: false, ghost: null };
    els.board.setPointerCapture(e.pointerId);
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
  }

  function pointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    endDrag();
    if (!d.moving) { tap(d.from); return; }
    var under = document.elementFromPoint(e.clientX, e.clientY);
    var cell = under && under.closest(".slope-merge-cell");
    if (cell && els.board.contains(cell)) act(d.from, +cell.getAttribute("data-i"));
  }

  function endDrag() {
    if (!drag) return;
    if (drag.ghost) drag.ghost.remove();
    if (els.cells[drag.from]) els.cells[drag.from].el.classList.remove("is-lifted");
    drag = null;
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
        var i = empty[Math.floor(Math.random() * empty.length)], level = spawnLevel();
        state.board[i] = level;
        state.clicks = 0;
        var first = level > state.best;
        if (first) state.best = level;
        commit(first);
        renderBoard();
        pop(i);
        if (first) { renderSkins(); say("Your first ball! Merge two of the same level to make the next one."); }
      }
    } else {
      commit(false);
    }
    renderSpawn();
  }

  function renderSpawn() {
    var need = clicksNeeded(), dots = "";
    for (var i = 0; i < need; i++) dots += '<span class="' + (i < state.clicks ? "is-on" : "") + '"></span>';
    els.dots.innerHTML = dots;
    els.spawn.setAttribute("aria-label", "Spawn a ball, " + state.clicks + " of " + need + " clicks");
  }

  function startAuto() {
    stopAuto();
    autoCarry = 0;
    var last = performance.now();
    autoTimer = setInterval(function () {
      var now = performance.now(), rate = up("auto") * 0.5;
      autoCarry += rate * Math.min(1, (now - last) / 1000);
      last = now;
      var whole = Math.floor(autoCarry);
      if (whole > 0) { autoCarry -= whole; click(whole); }
    }, 100);
  }
  function stopAuto() { clearInterval(autoTimer); autoTimer = 0; }

  // --- Upgrades and skins ----------------------------------------------------------

  function renderUpgrades() {
    var gems = profile.get().gems;
    UPGRADES.forEach(function (u) {
      var row = els.upgradeRows[u.key], level = up(u.key), maxed = level >= u.max, price = priceOf(u, level);
      row.name.textContent = u.name + (level ? " " + level : "");
      row.effect.textContent = "Now: " + u.effect(level) + (maxed ? " (max)" : ". Next: " + u.effect(level + 1));
      row.buy.disabled = maxed || gems < price;
      row.buy.innerHTML = maxed ? "Max" : gemIcon() + "<span>" + fmt(price) + "</span>";
      row.buy.setAttribute("aria-label", maxed ? u.name + ", at its best" : "Buy " + u.name + " for " + fmt(price) + " gems" + (gems < price ? ", you need " + fmt(price - gems) + " more" : ""));
    });
  }

  function buyUpgrade(u) {
    var level = up(u.key);
    if (level >= u.max) return;
    var price = priceOf(u, level);
    if (!profile.spendGems(price)) { say("You need " + fmt(price - profile.get().gems) + " more gems for " + u.name + "."); return; }
    state = profile.get().merge;
    state.up[u.key] = level + 1;
    fitBoard();
    commit(true);
    if (u.key === "auto") startAuto();
    say(u.name + " is now " + (level + 1) + ": " + u.effect(level + 1) + ".");
    render();
  }

  function renderSkins() {
    var p = profile.get();
    els.skinsNote.textContent = state.best ? "You've found " + state.best + (state.best === 1 ? " ball" : " balls") + ". Merge for more: they never run out."
      : "Spawn your first ball to find the first one.";
    for (var level = 1; level <= state.best; level++) {
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
    els.summary.innerHTML = state.best
      ? "Best ball: <strong>" + skin(state.best).name + "</strong> (level " + state.best + ")  \u00b7  gems x" + boost.toFixed(2)
      : "No balls yet";
  }

  function render() {
    if (!els) return;
    renderSummary();
    renderBoard();
    renderSpawn();
    renderUpgrades();
  }

  function say(text) { els.status.textContent = text; }

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
      els.cells.forEach(function (c) { c.level = -1; });
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
    els.spawn.focus({ preventScroll: true });
  }

  function close() {
    endDrag();
    stopAuto();
    els.screen.hidden = true;
    if (game.resume) game.resume("merge");
    if (openedFrom && document.contains(openedFrom)) openedFrom.focus();
    else if (els.screen.contains(document.activeElement)) document.activeElement.blur();
    openedFrom = null;
  }

  profile.onChange(function () { if (els && !els.screen.hidden) { renderUpgrades(); renderSummary(); } });

  window.SlopeUI.ready(build);

  window.SlopeMerge = {
    boost: function () { return boostOf(state); },
    open: function (from) { open(from); }
  };
})();
