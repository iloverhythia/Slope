/*
 * Career: the player's profile, level and stats, opened from the game's
 * Career menu button or the level badge in the HUD. Links to the skin shop. Also records each run
 * (score -> XP) and shows a short summary when a run ends.
 */
(function () {
  "use strict";

  var game = window.SlopeGame;
  var profile = window.SlopeProfile;
  if (!game || !profile || !window.SlopeUI) return;

  var XP_CELLS = 20;
  var els = {};
  var toastTimer = 0;
  var openedFrom = null;

  function fmt(n) {
    return Math.round(n).toLocaleString("en-US");
  }

  function fmtTime(seconds) {
    var m = Math.floor(seconds / 60), h = Math.floor(m / 60);
    if (h) return h + "h " + ("0" + (m % 60)).slice(-2) + "m";
    if (m) return m + "m";
    return Math.round(seconds) + "s";
  }

  function xpCells(cls) {
    var html = "";
    for (var i = 0; i < XP_CELLS; i++) html += '<span class="' + cls + '"></span>';
    return html;
  }

  function fillCells(container, fraction) {
    var filled = Math.round(fraction * XP_CELLS);
    Array.prototype.forEach.call(container.children, function (cell, i) {
      cell.classList.toggle("is-on", i < filled);
    });
  }

  var STATS = [
    ["best", "Best score"],
    ["runs", "Runs"],
    ["average", "Average"],
    ["total", "Total score"],
    ["gems", "Gems"],
    ["playSeconds", "Time played"]
  ];

  function build(ui) {
    var badge = document.createElement("button");
    badge.type = "button";
    badge.className = "slope-btn slope-hud-item slope-level-badge";
    badge.innerHTML = '<span class="slope-level-badge-label">LV</span><span class="slope-level-badge-num">1</span>';
    ui.hud.appendChild(badge);

    var screen = document.createElement("div");
    screen.className = "slope-career";
    screen.id = "slope-career";
    screen.setAttribute("role", "dialog");
    screen.setAttribute("aria-labelledby", "slope-career-title");
    screen.hidden = true;
    screen.innerHTML =
      '<div class="slope-career-inner">' +
        '<h2 class="slope-career-title" id="slope-career-title">Career</h2>' +
        '<section class="slope-player">' +
          '<img class="slope-avatar" alt="" width="48" height="48" hidden>' +
          '<div class="slope-player-text">' +
            '<p class="slope-player-name">Guest</p>' +
            '<p class="slope-player-note"></p>' +
          "</div>" +
          '<p class="slope-player-level"><span>Level</span><strong class="slope-player-level-num">1</strong></p>' +
        "</section>" +
        '<div class="slope-xp">' +
          '<div class="slope-xp-bar" role="progressbar" aria-valuemin="0" aria-label="Progress to next level">' + xpCells("slope-xp-cell") + "</div>" +
          '<p class="slope-xp-text"><span class="slope-xp-amount"></span><span class="slope-xp-next"></span></p>' +
        "</div>" +
        '<dl class="slope-stats">' +
          STATS.map(function (s) {
            return '<div class="slope-stat"><dt>' + s[1] + '</dt><dd data-stat="' + s[0] + '">0</dd></div>';
          }).join("") +
        "</dl>" +
        '<section class="slope-recent" aria-labelledby="slope-recent-label">' +
          '<p class="slope-label" id="slope-recent-label">Recent runs</p>' +
          '<div class="slope-bars"></div>' +
        "</section>" +
        '<p class="slope-account-error" role="status" hidden></p>' +
        '<div class="slope-career-actions">' +
          '<button type="button" class="slope-btn slope-login" hidden>Log in with Claude</button>' +
          '<button type="button" class="slope-btn slope-open-shop" hidden>Skin shop</button>' +
          '<button type="button" class="slope-btn slope-back">Back</button>' +
        "</div>" +
      "</div>";
    ui.root.appendChild(screen);

    var toast = document.createElement("div");
    toast.className = "slope-toast";
    toast.setAttribute("role", "status");
    toast.hidden = true;
    toast.innerHTML =
      '<p class="slope-toast-score"></p>' +
      '<p class="slope-toast-xp"></p>' +
      '<div class="slope-toast-bar" aria-hidden="true">' + xpCells("slope-xp-cell") + "</div>" +
      '<p class="slope-toast-level"></p>';
    ui.root.appendChild(toast);

    els = {
      badge: badge,
      badgeNum: badge.querySelector(".slope-level-badge-num"),
      screen: screen,
      avatar: screen.querySelector(".slope-avatar"),
      name: screen.querySelector(".slope-player-name"),
      note: screen.querySelector(".slope-player-note"),
      level: screen.querySelector(".slope-player-level-num"),
      bar: screen.querySelector(".slope-xp-bar"),
      xpAmount: screen.querySelector(".slope-xp-amount"),
      xpNext: screen.querySelector(".slope-xp-next"),
      bars: screen.querySelector(".slope-bars"),
      error: screen.querySelector(".slope-account-error"),
      login: screen.querySelector(".slope-login"),
      back: screen.querySelector(".slope-back"),
      shop: screen.querySelector(".slope-open-shop"),
      toast: toast
    };

    badge.addEventListener("click", function () { open(badge); });
    els.back.addEventListener("click", close);
    els.shop.hidden = !window.SlopeShop;
    els.shop.addEventListener("click", function () { window.SlopeShop.open(els.shop); });
    els.login.addEventListener("click", function () { profile.signIn(); });
    screen.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    profile.onChange(render);
  }

  function render(p, account) {
    els.badgeNum.textContent = String(p.level);
    els.badge.setAttribute("aria-label", "Career, level " + p.level);
    els.level.textContent = String(p.level);

    els.name.textContent = account.signedIn ? (account.name || "Claude player") : "Guest";
    els.note.textContent = account.signedIn
      ? "Logged in with Claude. Progress follows your account."
      : "Progress is saved on this device.";
    if (account.signedIn && account.avatarUrl) {
      els.avatar.src = account.avatarUrl;
      els.avatar.hidden = false;
    } else {
      els.avatar.hidden = true;
    }
    els.login.hidden = !account.available || account.signedIn;
    els.login.disabled = !!account.busy;
    els.login.textContent = account.busy ? "Logging in..." : "Log in with Claude";
    els.error.hidden = !account.error;
    els.error.textContent = account.error || "";

    fillCells(els.bar, p.levelXp / p.levelNeed);
    els.bar.setAttribute("aria-valuemax", String(p.levelNeed));
    els.bar.setAttribute("aria-valuenow", String(p.levelXp));
    els.xpAmount.textContent = fmt(p.levelXp) + " / " + fmt(p.levelNeed) + " XP";
    els.xpNext.textContent = "to level " + (p.level + 1);

    STATS.forEach(function (s) {
      var dd = els.screen.querySelector('[data-stat="' + s[0] + '"]');
      dd.textContent = s[0] === "playSeconds" ? fmtTime(p.playSeconds) : fmt(p[s[0]]);
    });

    renderRecent(p.recent);
  }

  function renderRecent(recent) {
    els.bars.textContent = "";
    if (!recent.length) {
      var empty = document.createElement("p");
      empty.className = "slope-bars-empty";
      empty.textContent = "Finish a run to see it here.";
      els.bars.appendChild(empty);
      return;
    }
    var max = Math.max.apply(null, recent.map(function (r) { return r.score; }).concat([1]));
    recent.forEach(function (r) {
      var col = document.createElement("div");
      col.className = "slope-bar";
      col.setAttribute("aria-label", "Score " + r.score + (r.gems ? ", " + r.gems + " gems" : ""));
      col.setAttribute("role", "img");
      col.innerHTML = '<span class="slope-bar-value"></span><span class="slope-bar-fill"></span>';
      col.querySelector(".slope-bar-value").textContent = String(r.score);
      col.querySelector(".slope-bar-fill").style.height = Math.max(4, (r.score / max) * 100) + "%";
      els.bars.appendChild(col);
    });
  }

  function open(from) {
    openedFrom = from || null;
    window.SlopeUI.closeSettings();
    els.toast.hidden = true;
    els.screen.hidden = false;
    // The game pauses behind this screen, which covers it.
    if (game.pause) game.pause("career");
    els.back.focus();
  }

  function close() {
    els.screen.hidden = true;
    if (game.resume) game.resume("career");
    if (openedFrom) openedFrom.focus();
    else if (els.screen.contains(document.activeElement)) document.activeElement.blur();
    openedFrom = null;
  }

  function showRunSummary(score, result, gems) {
    var p = profile.get();
    els.toast.querySelector(".slope-toast-score").textContent =
      "Score " + fmt(score) + (gems ? "  +" + gems + (gems === 1 ? " gem" : " gems") : "");
    els.toast.querySelector(".slope-toast-xp").textContent = "+" + fmt(result.xp) + " XP";
    fillCells(els.toast.querySelector(".slope-toast-bar"), p.levelXp / p.levelNeed);
    var levelLine = els.toast.querySelector(".slope-toast-level");
    var leveled = result.levelAfter > result.levelBefore;
    levelLine.textContent = leveled ? "Level up! Level " + result.levelAfter : "Level " + p.level;
    els.toast.classList.toggle("is-level-up", leveled);
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, leveled ? 7000 : 5000);
  }

  game.on("career", function () { open(null); });

  game.on("runend", function (e) {
    var run = window.SlopeGems ? window.SlopeGems.currentRun() : { gems: 0, seconds: 0 };
    var result = profile.recordRun({ score: e.score, gems: run.gems, seconds: run.seconds });
    // Adventure levels show their own result screen.
    var adventure = window.SlopeAdventure && window.SlopeAdventure.handlesRun();
    if (els.toast && !adventure) showRunSummary(e.score, result, run.gems);
  });

  window.SlopeUI.ready(build);
})();
