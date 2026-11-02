/*
 * Core Clicker: a clicker game (the HUD button with the bolt), in the game's
 * look. Tap the core for energy, spend it on upgrades and generators, and
 * boost the main game with it.
 *
 *   Tapping      Stronger taps, Tap multiplier, Lucky taps (crits), Crit power,
 *                Combo (fast taps build a bonus), Tap echo (taps also give a
 *                share of the energy a second)
 *   Generators   nine of them, Spark to Big Bang: energy every second, each
 *                one dearer (15% a copy) and far stronger than the last
 *   Boosters     Overvolt (generators x2 a level), Synergy (+0.5% a level for
 *                every generator owned), Golden cores (a golden orb turns up
 *                now and then: click it for a minute of energy), Night shift
 *                (earns a share of the energy a second while the page is shut,
 *                up to 8 hours)
 *   Main game    Gem amplifier, XP amplifier, Ball trainer: more gems, XP and
 *                ball XP everywhere in the game
 *
 * Overclock is its prestige: it starts the clicker over (energy, generators,
 * upgrades) for shards, more the more energy this run made (the square root
 * of it, in millions). Every shard ever earned is +5% energy for good, and
 * shards buy upgrades that last: Quick start, Auto tapper, Core resonance and
 * Deep focus (gems and XP in the main game for good), Cheap parts, Crit
 * mastery and Shard magnet.
 *
 * Energy builds up once a second while the page is open (the clicker can be
 * closed) and is saved every few seconds, to the profile (profile.js).
 *
 *   SlopeClicker.open(from)
 *   SlopeClicker.boosts()     { gems, xp, ballXp } for the main game
 *   SlopeClicker.state()      the clicker's state (for tools and tests)
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var OFFLINE_CAP = 8 * 3600;      // seconds Night shift pays for at most
  var SAVE_EVERY = 4000;           // ms between quiet saves
  var COMBO_MAX = 50;              // taps
  var SHARD_UNIT = 1e6;            // energy for the first shard

  // Generators: [key, name, price of the first, energy a second each].
  var GENS = [
    ["spark", "Spark", 15, 0.2], ["battery", "Battery", 100, 1], ["dynamo", "Dynamo", 1100, 8],
    ["reactor", "Reactor", 12000, 47], ["fusion", "Fusion core", 130000, 260], ["forge", "Star forge", 1.4e6, 1400],
    ["nebula", "Nebula engine", 2e7, 7800], ["hole", "Black hole", 3.3e8, 44000], ["bang", "Big Bang", 5.1e9, 260000]
  ].map(function (g) { return { key: g[0], name: g[1], base: g[2], cps: g[3] }; });

  // Upgrades bought with energy (reset by Overclock). group: where they show.
  var UPS = [
    { key: "tap", group: "tap", name: "Stronger taps", base: 10, growth: 1.5, max: Infinity, text: function (l) { return "+" + l + " energy a tap"; } },
    { key: "tapmult", group: "tap", name: "Tap multiplier", base: 500, growth: 12, max: 12, text: function (l) { return "Taps x" + Math.pow(2, l); } },
    { key: "crit", group: "tap", name: "Lucky taps", base: 200, growth: 2.2, max: 20, text: function (l) { return (l * 2) + "% of taps are crits"; } },
    { key: "critpow", group: "tap", name: "Crit power", base: 1000, growth: 3, max: 15, text: function (l) { return "Crits x" + (5 + l); } },
    { key: "combo", group: "tap", name: "Combo", base: 300, growth: 2.5, max: 10, text: function (l) { return l ? "Fast taps build up to +" + (l * 10) + "%" : "Off"; } },
    { key: "echo", group: "tap", name: "Tap echo", base: 5000, growth: 3.5, max: 20, text: function (l) { return l ? "Each tap also gives " + l + "% of your energy a second" : "Off"; } },
    { key: "overvolt", group: "boost", name: "Overvolt", base: 2e4, growth: 30, max: 12, text: function (l) { return "Generators x" + Math.pow(2, l); } },
    { key: "synergy", group: "boost", name: "Synergy", base: 1e5, growth: 6, max: 10, text: function (l) { return l ? "+" + fmtNum(l * 0.5) + "% for every generator you own" : "Off"; } },
    { key: "golden", group: "boost", name: "Golden cores", base: 2500, growth: 4, max: 10, text: function (l) { return l ? "A golden core every " + Math.round(goldenEvery(l)) + " s or so: click it for " + (60 + 15 * l) + " s of energy" : "Off"; } },
    { key: "offline", group: "boost", name: "Night shift", base: 5e4, growth: 4, max: 10, text: function (l) { return l ? (l * 10) + "% of your energy a second while away (up to 8 h)" : "Off"; } },
    { key: "ampgems", group: "main", name: "Gem amplifier", base: 1e4, growth: 2.4, max: 40, text: function (l) { return "+" + (l * 5) + "% gems in the game"; } },
    { key: "ampxp", group: "main", name: "XP amplifier", base: 1e4, growth: 2.4, max: 40, text: function (l) { return "+" + (l * 5) + "% XP in the game"; } },
    { key: "ampball", group: "main", name: "Ball trainer", base: 5e4, growth: 2.6, max: 30, text: function (l) { return "+" + (l * 10) + "% ball XP"; } }
  ];
  var GROUPS = [["tap", "Tapping"], ["boost", "Boosters"], ["main", "Main game boosts"]];

  // Shard upgrades (they last through Overclock).
  var SHARD_UPS = [
    { key: "start", name: "Quick start", base: 1, growth: 3, max: 6, text: function (l) { return l ? "Each run starts with " + abbr(startEnergy(l)) + " energy" : "Runs start at 0"; } },
    { key: "autotap", name: "Auto tapper", base: 2, growth: 2, max: 10, text: function (l) { return l ? l + (l === 1 ? " tap" : " taps") + " a second by itself" : "Off"; } },
    { key: "resonance", name: "Core resonance", base: 3, growth: 1.8, max: 20, text: function (l) { return "+" + (l * 10) + "% gems in the game, for good"; } },
    { key: "focus", name: "Deep focus", base: 3, growth: 1.8, max: 20, text: function (l) { return "+" + (l * 10) + "% XP in the game, for good"; } },
    { key: "cheap", name: "Cheap parts", base: 2, growth: 2.2, max: 10, text: function (l) { return "Generators -" + (l * 2) + "%"; } },
    { key: "critmaster", name: "Crit mastery", base: 4, growth: 2.5, max: 5, text: function (l) { return "+" + (l * 5) + "% crit chance"; } },
    { key: "shardgain", name: "Shard magnet", base: 5, growth: 2.5, max: 10, text: function (l) { return "+" + (l * 10) + "% shards from Overclock"; } }
  ];

  function fmtNum(n) { return Math.round(n * 100) / 100 + ""; }
  function abbr(n) {
    if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : String(Math.floor(n));
    return profile.short(n);
  }
  function full(n) { return Math.floor(n).toLocaleString("en-US"); }
  function byKey(list, k) { for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i]; return null; }

  // --- State and numbers --------------------------------------------------------

  var c = profile.get().clicker;
  function up(k) { return c.up[k] || 0; }
  function sup(k) { return c.sup[k] || 0; }
  function owned(k) { return c.gens[k] || 0; }
  function goldenEvery(l) { return 120 / (1 + 0.3 * l); }
  function startEnergy(l) { return l ? 100 * Math.pow(10, l - 1) : 0; }

  function prestigeMult() { return 1 + 0.05 * c.earned; }
  function genCount() { var n = 0; GENS.forEach(function (g) { n += owned(g.key); }); return n; }
  function genPrice(g, have) { return g.base * Math.pow(1.15, have) * (1 - 0.02 * sup("cheap")); }
  function upPrice(u, level) { return u.base * Math.pow(u.growth, level); }
  function shardPrice(u, level) { return Math.round(u.base * Math.pow(u.growth, level)); }

  // Energy a second from generators, all boosts in.
  function cps() {
    var base = 0;
    GENS.forEach(function (g) { base += owned(g.key) * g.cps; });
    return base * Math.pow(2, up("overvolt")) * (1 + 0.005 * up("synergy") * genCount()) * prestigeMult();
  }
  function tapValue() { return (1 + up("tap")) * Math.pow(2, up("tapmult")) * prestigeMult(); }
  function critChance() { return Math.min(0.75, 0.02 * up("crit") + 0.05 * sup("critmaster")); }
  function critMult() { return 5 + up("critpow"); }
  function shardGain() { return Math.floor(Math.sqrt(c.total / SHARD_UNIT) * (1 + 0.1 * sup("shardgain"))); }

  function boosts() {
    return {
      gems: (1 + 0.05 * up("ampgems")) * (1 + 0.1 * sup("resonance")),
      xp: (1 + 0.05 * up("ampxp")) * (1 + 0.1 * sup("focus")),
      ballXp: 1 + 0.1 * up("ampball")
    };
  }

  function earn(n) {
    if (!(n > 0)) return;
    c.energy += n;
    c.total += n;
    c.allTime += n;
  }

  var dirty = false, lastSave = 0;
  function save(notify) {
    c.last = Date.now();
    profile.saveClicker(c, notify);
    c = profile.get().clicker;
    dirty = false;
    lastSave = performance.now();
  }

  // Another tab or an account sign-in can bring another state.
  profile.onChange(function (p) {
    if (p.clicker.allTime !== c.allTime || p.clicker.overclocks !== c.overclocks) c = p.clicker;
  });

  // --- Time -------------------------------------------------------------------

  // Night shift: what was earned while the page was shut.
  var away = 0;
  (function () {
    var gone = c.last ? (Date.now() - c.last) / 1000 : 0;
    if (gone > 30 && up("offline")) {
      away = cps() * Math.min(gone, OFFLINE_CAP) * 0.1 * up("offline");
      earn(away);
      save(false);
    }
  })();

  // Once a second: generators and the auto tapper. Also while the clicker is
  // closed (the page has to be open).
  var lastTick = performance.now(), autoCarry = 0;
  setInterval(function () {
    var now = performance.now(), dt = Math.min(5, (now - lastTick) / 1000);
    lastTick = now;
    var gain = cps() * dt;
    autoCarry += sup("autotap") * dt;
    var taps = Math.floor(autoCarry);
    if (taps) { autoCarry -= taps; gain += taps * tapValue(); c.taps += taps; }
    if (gain > 0) { earn(gain); dirty = true; }
    if (dirty && now - lastSave > SAVE_EVERY) save(false);
    if (shown()) renderNumbers();
  }, 1000);
  window.addEventListener("pagehide", function () { if (dirty) save(false); });
  document.addEventListener("visibilitychange", function () { if (document.hidden && dirty) save(false); });

  // --- Tapping -----------------------------------------------------------------------

  var combo = 0, lastTap = 0;
  function tap(x, y) {
    var now = performance.now();
    combo = now - lastTap < 600 ? Math.min(COMBO_MAX, combo + 1) : 0;
    lastTap = now;
    var crit = Math.random() < critChance();
    var value = tapValue() * (1 + 0.1 * up("combo") * combo / COMBO_MAX) * (crit ? critMult() : 1) + cps() * 0.01 * up("echo");
    earn(value);
    c.taps += 1;
    dirty = true;
    floatText("+" + abbr(value) + (crit ? " crit!" : ""), x, y, crit);
    pulse = 1;
    renderNumbers();
  }

  // --- Buying ------------------------------------------------------------------------

  var buyMode = 1;   // generators: 1, 10 or "max"

  // How many of a generator, for how much, in the buy mode now.
  function genOrder(g) {
    var have = owned(g.key), n = 0, cost = 0, want = buyMode === "max" ? Infinity : buyMode;
    while (n < want) {
      var p = genPrice(g, have + n);
      if (buyMode === "max" ? cost + p > c.energy : false) break;
      cost += p; n++;
      if (n > 5000) break;
    }
    if (buyMode === "max" && n === 0) { n = 1; cost = genPrice(g, have); }
    return { n: n, cost: cost };
  }

  function buyGen(g) {
    var o = genOrder(g);
    if (c.energy < o.cost) { say("You need " + abbr(o.cost - c.energy) + " more energy for " + (o.n > 1 ? o.n + " " : "") + g.name + (o.n > 1 ? "s" : "") + "."); return; }
    c.energy -= o.cost;
    c.gens[g.key] = owned(g.key) + o.n;
    save(false);
    say("Bought " + o.n + " " + g.name + (o.n > 1 ? "s" : "") + ". Now " + abbr(cps()) + " energy a second.");
    render();
  }

  function buyUp(u) {
    var l = up(u.key);
    if (l >= u.max) return;
    var price = upPrice(u, l);
    if (c.energy < price) { say("You need " + abbr(price - c.energy) + " more energy for " + u.name + "."); return; }
    c.energy -= price;
    c.up[u.key] = l + 1;
    save(u.group === "main");   // the main game's boosts changed: tell the page
    say(u.name + " " + (l + 1) + ": " + u.text(l + 1) + ".");
    if (u.key === "golden") scheduleGolden();
    render();
  }

  function buyShard(u) {
    var l = sup(u.key);
    if (l >= u.max) return;
    var price = shardPrice(u, l);
    if (c.shards < price) { say("You need " + (price - c.shards) + " more shards for " + u.name + "."); return; }
    c.shards -= price;
    c.sup[u.key] = l + 1;
    save(true);
    say(u.name + " " + (l + 1) + ": " + u.text(l + 1) + ".");
    render();
  }

  // Overclock: two clicks, then the run starts over for shards.
  var armed = 0;
  function overclock() {
    var gain = shardGain();
    if (gain < 1) return;
    if (!armed) {
      armed = setTimeout(function () { armed = 0; render(); }, 5000);
      els.over.classList.add("is-armed");
      els.over.textContent = "Sure? Click again to start over for " + gain + (gain === 1 ? " shard" : " shards");
      return;
    }
    clearTimeout(armed);
    armed = 0;
    els.over.classList.remove("is-armed");
    c.shards += gain;
    c.earned += gain;
    c.overclocks += 1;
    c.energy = startEnergy(sup("start"));
    c.total = 0;
    c.gens = {};
    c.up = {};
    save(true);
    scheduleGolden();
    say("Overclock! +" + gain + (gain === 1 ? " shard" : " shards") + ". Energy x" + fmtNum(prestigeMult()) + " for good.");
    render();
  }

  // --- Golden cores --------------------------------------------------------------------

  var goldenTimer = 0, goldenHide = 0;
  function scheduleGolden() {
    clearTimeout(goldenTimer);
    if (!up("golden")) return;
    var wait = goldenEvery(up("golden")) * (0.6 + Math.random() * 0.8) * 1000;
    goldenTimer = setTimeout(showGolden, wait);
  }
  function showGolden() {
    if (!els || !shown()) { scheduleGolden(); return; }
    var area = els.coreWrap.getBoundingClientRect();
    els.golden.style.left = Math.round(10 + Math.random() * Math.max(10, area.width - 70)) + "px";
    els.golden.style.top = Math.round(10 + Math.random() * Math.max(10, area.height - 70)) + "px";
    els.golden.hidden = false;
    clearTimeout(goldenHide);
    goldenHide = setTimeout(function () { els.golden.hidden = true; scheduleGolden(); }, 9000);
  }
  function clickGolden() {
    els.golden.hidden = true;
    clearTimeout(goldenHide);
    var value = Math.max(tapValue() * 50, cps() * (60 + 15 * up("golden")));
    earn(value);
    dirty = true;
    say("Golden core! +" + abbr(value) + " energy.");
    floatText("+" + abbr(value), null, null, true);
    renderNumbers();
    scheduleGolden();
  }

  // --- Screen ---------------------------------------------------------------------------

  var els = null, openedFrom = null, loop = 0, pulse = 0, startedAt = 0;
  var BOLT = ["...##", "..##.", ".##..", "#####", "..##.", ".##..", "##..."];
  function boltIcon(size) {
    var dots = "";
    BOLT.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) if (row[x] === "#") dots += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.45"/>';
    });
    return '<svg viewBox="0 0 5 7" width="' + 5 * size + '" height="' + 7 * size + '" fill="currentColor" aria-hidden="true" focusable="false">' + dots + "</svg>";
  }
  function shown() { return !!els && !els.screen.hidden; }
  function say(t) { if (els) els.status.textContent = t; }

  function build(ui) {
    var hud = document.createElement("button");
    hud.type = "button";
    hud.className = "slope-btn slope-hud-item slope-clicker-open";
    hud.title = "Core Clicker";
    hud.setAttribute("aria-label", "Core Clicker");
    hud.innerHTML = boltIcon(3);
    ui.hud.appendChild(hud);
    hud.addEventListener("click", function () { open(hud); });

    var screen = document.createElement("div");
    screen.className = "slope-career slope-clicker";
    screen.id = "slope-clicker";
    screen.setAttribute("role", "dialog");
    screen.setAttribute("aria-labelledby", "slope-clicker-title");
    screen.hidden = true;
    screen.innerHTML =
      '<div class="slope-career-inner slope-clicker-inner">' +
        '<h2 class="slope-career-title" id="slope-clicker-title">Core Clicker</h2>' +
        '<div class="slope-clicker-top">' +
          '<div class="slope-clicker-core-wrap">' +
            '<button type="button" class="slope-clicker-core" aria-label="Tap the core"><canvas aria-hidden="true"></canvas></button>' +
            '<button type="button" class="slope-btn slope-clicker-golden" aria-label="Golden core: click it for a burst of energy" hidden>' + boltIcon(4) + "</button>" +
          "</div>" +
          '<div class="slope-clicker-side">' +
            '<p class="slope-clicker-energy" aria-live="off"><span class="slope-clicker-amount">0</span><span class="slope-clicker-unit">energy</span></p>' +
            '<p class="slope-clicker-rates"></p>' +
            '<p class="slope-clicker-main"></p>' +
            '<p class="slope-clicker-hint">Tap the core (or press Space on it) for energy. Generators make it by themselves, even with this closed. ' +
              "Main game boosts raise your gems, XP and ball XP everywhere.</p>" +
            '<p class="slope-shop-status slope-clicker-status" role="status"></p>' +
          "</div>" +
        "</div>" +
        GROUPS.map(function (g) {
          return '<h3 class="slope-shop-section">' + g[1] + "</h3>" +
            '<ul class="slope-merge-upgrades slope-clicker-ups">' +
              UPS.filter(function (u) { return u.group === g[0]; }).map(rowHtml).join("") +
            "</ul>";
        }).join("") +
        '<h3 class="slope-shop-section">Generators</h3>' +
        '<div class="slope-clicker-modes" role="group" aria-label="Buy">' +
          [1, 10, "max"].map(function (m) { return '<button type="button" class="slope-btn" data-mode="' + m + '" aria-pressed="false">' + (m === "max" ? "Max" : "x" + m) + "</button>"; }).join("") +
        "</div>" +
        '<ul class="slope-merge-upgrades slope-clicker-gens">' +
          GENS.map(function (g) {
            return '<li data-gen="' + g.key + '"><div><p class="slope-merge-upgrade-name"></p><p class="slope-merge-upgrade-effect"></p></div>' +
              '<button type="button" class="slope-btn slope-merge-buy"></button></li>';
          }).join("") +
        "</ul>" +
        '<section class="slope-prestige slope-clicker-over" aria-labelledby="slope-over-title">' +
          '<h3 class="slope-prestige-title" id="slope-over-title">Overclock</h3>' +
          '<p class="slope-prestige-now slope-over-now"></p>' +
          '<p class="slope-prestige-note">Start the clicker over (energy, generators and upgrades) for shards: the more energy this run made, the more (the first at ' + abbr(SHARD_UNIT) + "). " +
            "Every shard you ever earn is +5% energy for good, and shards buy the upgrades below, which last.</p>" +
          '<button type="button" class="slope-btn slope-prestige-btn slope-over-btn"></button>' +
        "</section>" +
        '<ul class="slope-merge-upgrades slope-clicker-shards">' +
          SHARD_UPS.map(function (u) {
            return '<li data-shard="' + u.key + '"><div><p class="slope-merge-upgrade-name"></p><p class="slope-merge-upgrade-effect"></p></div>' +
              '<button type="button" class="slope-btn slope-merge-buy"></button></li>';
          }).join("") +
        "</ul>" +
        '<div class="slope-career-actions"><button type="button" class="slope-btn slope-back">Back</button></div>' +
      "</div>";
    ui.root.appendChild(screen);

    els = {
      screen: screen,
      coreWrap: screen.querySelector(".slope-clicker-core-wrap"),
      core: screen.querySelector(".slope-clicker-core"),
      canvas: screen.querySelector(".slope-clicker-core canvas"),
      golden: screen.querySelector(".slope-clicker-golden"),
      amount: screen.querySelector(".slope-clicker-amount"),
      rates: screen.querySelector(".slope-clicker-rates"),
      main: screen.querySelector(".slope-clicker-main"),
      status: screen.querySelector(".slope-clicker-status"),
      over: screen.querySelector(".slope-over-btn"),
      overNow: screen.querySelector(".slope-over-now"),
      modes: Array.prototype.slice.call(screen.querySelectorAll(".slope-clicker-modes .slope-btn")),
      ups: UPS.map(function (u) { var li = screen.querySelector('[data-up="' + u.key + '"]'); return rowEls(li, u); }),
      gens: GENS.map(function (g) { var li = screen.querySelector('[data-gen="' + g.key + '"]'); return rowEls(li, g); }),
      shards: SHARD_UPS.map(function (u) { var li = screen.querySelector('[data-shard="' + u.key + '"]'); return rowEls(li, u); })
    };
    var size = Math.round(240 * Math.min(2, window.devicePixelRatio || 1));
    els.canvas.width = els.canvas.height = size;

    els.core.addEventListener("click", function (e) {
      var r = els.coreWrap.getBoundingClientRect();
      tap(e.clientX ? e.clientX - r.left : null, e.clientY ? e.clientY - r.top : null);
    });
    els.golden.addEventListener("click", clickGolden);
    els.ups.forEach(function (r) { r.buy.addEventListener("click", function () { buyUp(r.item); }); });
    els.gens.forEach(function (r) { r.buy.addEventListener("click", function () { buyGen(r.item); }); });
    els.shards.forEach(function (r) { r.buy.addEventListener("click", function () { buyShard(r.item); }); });
    els.modes.forEach(function (b) {
      b.addEventListener("click", function () { var m = b.getAttribute("data-mode"); buyMode = m === "max" ? "max" : +m; render(); });
    });
    els.over.addEventListener("click", overclock);
    screen.querySelector(".slope-back").addEventListener("click", close);
    screen.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    if (away > 0) say("Night shift: +" + abbr(away) + " energy while you were away.");
    scheduleGolden();
  }

  function rowHtml(u) {
    return '<li data-up="' + u.key + '"><div><p class="slope-merge-upgrade-name"></p><p class="slope-merge-upgrade-effect"></p></div>' +
      '<button type="button" class="slope-btn slope-merge-buy"></button></li>';
  }
  function rowEls(li, item) {
    return { item: item, li: li, name: li.querySelector(".slope-merge-upgrade-name"), effect: li.querySelector(".slope-merge-upgrade-effect"), buy: li.querySelector("button") };
  }

  function priceHtml(n, unit) {
    return (unit === "shards" ? boltIcon(2) : "") + "<span>" + abbr(n) + (unit === "shards" ? "" : "") + "</span>";
  }

  // The numbers at the top, and which buttons you can afford (every tick).
  function renderNumbers() {
    if (!shown()) return;
    els.amount.textContent = abbr(c.energy);
    els.rates.textContent = abbr(cps()) + " a second  \u00b7  " + abbr(tapValue()) + " a tap" +
      (critChance() ? "  \u00b7  " + Math.round(critChance() * 100) + "% crits x" + critMult() : "") +
      (sup("autotap") ? "  \u00b7  " + sup("autotap") + " auto taps a second" : "");
    els.ups.forEach(function (r) {
      var l = up(r.item.key), maxed = l >= r.item.max;
      r.buy.disabled = maxed || c.energy < upPrice(r.item, l);
    });
    els.gens.forEach(function (r) { r.buy.disabled = c.energy < genOrder(r.item).cost; });
    var gain = shardGain();
    els.over.disabled = gain < 1;
    if (!els.over.classList.contains("is-armed")) {
      els.over.textContent = gain ? "Overclock for +" + gain + (gain === 1 ? " shard" : " shards") : "Overclock: make " + abbr(SHARD_UNIT) + " energy this run first";
    }
  }

  function render() {
    if (!shown()) return;
    var b = boosts();
    els.main.textContent = "Main game: gems x" + b.gems.toFixed(2) + "  \u00b7  XP x" + b.xp.toFixed(2) + "  \u00b7  ball XP x" + b.ballXp.toFixed(2);
    els.ups.forEach(function (r) {
      var u = r.item, l = up(u.key), maxed = l >= u.max;
      r.name.textContent = u.name + (l ? " " + l : "");
      r.effect.textContent = "Now: " + u.text(l) + (maxed ? " (max)" : ". Next: " + u.text(l + 1));
      r.buy.innerHTML = maxed ? "Max" : priceHtml(upPrice(u, l));
      r.buy.setAttribute("aria-label", maxed ? u.name + ", at its best" : "Buy " + u.name + " for " + full(upPrice(u, l)) + " energy");
    });
    els.modes.forEach(function (bt) { bt.setAttribute("aria-pressed", String(bt.getAttribute("data-mode") === String(buyMode))); });
    els.gens.forEach(function (r) {
      var g = r.item, have = owned(g.key), o = genOrder(g);
      r.name.textContent = g.name + (have ? " " + have : "");
      var each = g.cps * Math.pow(2, up("overvolt")) * (1 + 0.005 * up("synergy") * genCount()) * prestigeMult();
      r.effect.textContent = abbr(each) + " energy a second each" + (have ? "  \u00b7  " + abbr(each * have) + " in all" : "");
      r.buy.innerHTML = (o.n > 1 ? "x" + o.n + " " : "") + priceHtml(o.cost);
      r.buy.setAttribute("aria-label", "Buy " + o.n + " " + g.name + " for " + full(o.cost) + " energy");
    });
    els.overNow.textContent = c.earned
      ? c.shards + (c.shards === 1 ? " shard" : " shards") + " to spend  \u00b7  " + c.earned + " earned: energy x" + fmtNum(prestigeMult()) + "  \u00b7  " + c.overclocks + (c.overclocks === 1 ? " overclock" : " overclocks")
      : "No shards yet  \u00b7  this run: " + abbr(c.total) + " energy";
    els.shards.forEach(function (r) {
      var u = r.item, l = sup(u.key), maxed = l >= u.max, price = shardPrice(u, l);
      r.name.textContent = u.name + (l ? " " + l : "");
      r.effect.textContent = "Now: " + u.text(l) + (maxed ? " (max)" : ". Next: " + u.text(l + 1));
      r.buy.innerHTML = maxed ? "Max" : price + (price === 1 ? " shard" : " shards");
      r.buy.disabled = maxed || c.shards < price;
      r.buy.setAttribute("aria-label", maxed ? u.name + ", at its best" : "Buy " + u.name + " for " + price + " shards");
    });
    renderNumbers();
  }

  // Numbers floating up from a tap.
  function floatText(text, x, y, big) {
    if (!shown()) return;
    var r = els.coreWrap.getBoundingClientRect();
    var el = document.createElement("span");
    el.className = "slope-clicker-float" + (big ? " is-big" : "");
    el.textContent = text;
    el.style.left = Math.round(x !== null && x !== undefined ? x : r.width / 2) + "px";
    el.style.top = Math.round(y !== null && y !== undefined ? y : r.height / 2) + "px";
    els.coreWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }

  // The core: a glowing ball with rings of dots turning round it; it swells
  // on a tap, and its rings speed up with the energy a second.
  function drawCore(now) {
    var cv = els.canvas, x = cv.getContext("2d"), W = cv.width, s = W / 240, t = (now - startedAt) / 1000;
    var colour = window.SlopeUI.themeColor || "#00ff00";
    x.clearRect(0, 0, W, W);
    var cx = W / 2, cy = W / 2, r = (62 + 10 * pulse) * s;
    var glow = x.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.9);
    glow.addColorStop(0, colour); glow.addColorStop(0.45, "rgba(0,0,0,0.0)"); glow.addColorStop(1, "rgba(0,0,0,0)");
    x.globalAlpha = 0.5 + 0.3 * pulse;
    x.fillStyle = glow; x.fillRect(0, 0, W, W);
    x.globalAlpha = 1;
    var body = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    body.addColorStop(0, "#ffffff"); body.addColorStop(0.25, colour); body.addColorStop(1, "#021402");
    x.fillStyle = body;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.strokeStyle = colour; x.lineWidth = 3 * s;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    var speed = 0.4 + Math.min(3, Math.log10(1 + cps()) * 0.35);
    [[r + 22 * s, 18, 1], [r + 40 * s, 28, -0.7], [r + 56 * s, 40, 0.45]].forEach(function (ring, k) {
      for (var i = 0; i < ring[1]; i++) {
        var a = i / ring[1] * Math.PI * 2 + t * speed * ring[2];
        x.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(a * 3 + t * 2 + k));
        x.fillStyle = colour;
        x.beginPath(); x.arc(cx + Math.cos(a) * ring[0], cy + Math.sin(a) * ring[0], (2.6 - k * 0.5) * s, 0, Math.PI * 2); x.fill();
      }
    });
    x.globalAlpha = 1;
    pulse *= 0.86;
  }

  function tick(now) {
    loop = 0;
    if (!shown()) return;
    drawCore(now);
    loop = requestAnimationFrame(tick);
  }

  function open(from) {
    if (!els) return;
    openedFrom = from || null;
    window.SlopeUI.closeSettings();
    var toast = window.SlopeUI.root.querySelector(".slope-toast");
    if (toast) toast.hidden = true;
    els.screen.hidden = false;
    els.screen.scrollTop = 0;
    if (game.pause) game.pause("clicker");
    startedAt = performance.now();
    render();
    if (!loop) loop = requestAnimationFrame(tick);
    els.core.focus({ preventScroll: true });
  }

  function close() {
    if (dirty) save(false);
    els.screen.hidden = true;
    els.golden.hidden = true;
    if (game.resume) game.resume("clicker");
    if (openedFrom && document.contains(openedFrom)) openedFrom.focus();
    else if (els.screen.contains(document.activeElement)) document.activeElement.blur();
    openedFrom = null;
  }

  window.SlopeUI.ready(build);

  window.SlopeClicker = {
    open: function (from) { open(from); },
    boosts: boosts,
    state: function () { return { energy: c.energy, total: c.total, cps: cps(), tap: tapValue(), shards: c.shards, earned: c.earned, gain: shardGain(), gens: Object.assign({}, c.gens), up: Object.assign({}, c.up), sup: Object.assign({}, c.sup), overclocks: c.overclocks, taps: c.taps }; },
    // For tools and tests: add energy straight away.
    give: function (n) { earn(n); dirty = true; render(); },
    golden: function () { showGolden(); }
  };
})();
