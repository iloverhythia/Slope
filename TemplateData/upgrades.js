/*
 * Gem upgrade tree, on the shop's Upgrades tab. It never ends, and the only
 * thing it raises is the gem multiplier: every gem picked up on the track is
 * worth that many gems (fractions add up across pickups, see
 * SlopeProfile.addGems).
 *
 * Tier t has three upgrades: two side ones (tL, tR) and a centre one (tC).
 * The sides need the centre of the tier above; the centre needs both sides.
 * Every 10th tier is a milestone with bigger boosts. Prices grow 20% a tier.
 *
 *   SlopeUpgrades.multiplier()   the gem multiplier: 1 + every bought boost
 *   SlopeUpgrades.node(id)       { id, tier, part, boost, price, milestone }
 */
(function () {
  "use strict";

  var profile = window.SlopeProfile;
  if (!profile) return;

  var MILESTONE = 10;
  var PRICE_START = 3;
  var PRICE_GROWTH = 1.2;
  var EXTRA_TIERS = 2;   // locked tiers shown past the furthest one you can buy

  // Boosts are kept in hundredths, so adding them up stays exact.
  function node(id) {
    var m = /^([1-9][0-9]*)([LRC])$/.exec(id);
    if (!m) return null;
    var tier = +m[1], part = m[2], milestone = tier % MILESTONE === 0;
    var base = Math.round(PRICE_START * Math.pow(PRICE_GROWTH, tier - 1));
    var centre = part === "C";
    return {
      id: id,
      tier: tier,
      part: part,
      milestone: milestone,
      boost: centre ? (milestone ? 50 : 15) : (milestone ? 10 : 5),
      price: centre ? base * (milestone ? 3 : 2) : base
    };
  }

  function needs(n) {
    if (n.part === "C") return [n.tier + "L", n.tier + "R"];
    return n.tier > 1 ? [(n.tier - 1) + "C"] : [];
  }

  function multiplierOf(owned) {
    var hundredths = 100;
    owned.forEach(function (id) { var n = node(id); if (n) hundredths += n.boost; });
    return hundredths / 100;
  }

  function fmtMult(m) { return "x" + m.toFixed(2); }
  function fmtBoost(n) { return "+" + (n.boost / 100).toFixed(2) + "x"; }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }

  var owned = profile.get().upgrades;
  profile.onChange(function (p) { owned = p.upgrades; });

  window.SlopeUpgrades = {
    multiplier: function () { return multiplierOf(owned); },
    node: node
  };

  // --- Shop tab -------------------------------------------------------------

  var NODE_H = 64, ROW_GAP = 26, ROW = NODE_H + ROW_GAP, TIER_H = 2 * ROW;
  var X = { L: 100, C: 300, R: 500 };  // centres, in a 600-wide drawing
  var els = null, tiers = 0, nodes = {};

  function gemIcon() {
    return window.SlopeGems && window.SlopeGems.iconSvg ? window.SlopeGems.iconSvg(14, 12) : "";
  }

  function build(panel) {
    panel.innerHTML =
      '<div class="slope-upgrades-head">' +
        '<p class="slope-upgrades-mult"><span class="slope-upgrades-mult-label">Gem multiplier</span>' +
          '<span class="slope-upgrades-mult-value"></span></p>' +
        '<p class="slope-shop-note">Every gem you pick up is worth your multiplier. ' +
          "Each upgrade opens the next ones, and the tree never ends. Every 10th tier boosts more.</p>" +
      "</div>" +
      '<div class="slope-tree">' +
        '<svg class="slope-tree-lines" aria-hidden="true" preserveAspectRatio="none"></svg>' +
        '<ol class="slope-tree-tiers"></ol>' +
      "</div>" +
      '<p class="slope-tree-more">The tree keeps going: buy these to see the next tiers.</p>' +
      '<p class="slope-shop-status slope-upgrades-status" role="status"></p>';
    els = {
      panel: panel,
      value: panel.querySelector(".slope-upgrades-mult-value"),
      lines: panel.querySelector(".slope-tree-lines"),
      list: panel.querySelector(".slope-tree-tiers"),
      status: panel.querySelector(".slope-upgrades-status"),
      mult: document.querySelector(".slope-shop-mult")
    };
    panel.addEventListener("slope-show", function () {
      els.status.textContent = "";
      render(profile.get());
      var next = firstBuyable();
      if (next) requestAnimationFrame(function () { scrollToNode(next); });
    });
    profile.onChange(render);
  }

  function addTier(t) {
    var li = document.createElement("li");
    li.className = "slope-tier" + (t % MILESTONE === 0 ? " is-milestone" : "");
    li.innerHTML =
      '<p class="slope-tier-label">Tier ' + t + (t % MILESTONE === 0 ? "<span>Milestone</span>" : "") + "</p>" +
      ["L", "R", "C"].map(function (part) {
        var n = node(t + part);
        return '<button type="button" class="slope-btn slope-upgrade slope-upgrade-' + part.toLowerCase() +
          '" data-id="' + n.id + '"><span class="slope-upgrade-boost">' + fmtBoost(n) + "</span>" +
          '<span class="slope-upgrade-price"></span></button>';
      }).join("");
    els.list.appendChild(li);
    ["L", "R", "C"].forEach(function (part) {
      var n = node(t + part), button = li.querySelector('[data-id="' + n.id + '"]');
      nodes[n.id] = { n: n, button: button, price: button.querySelector(".slope-upgrade-price") };
      button.addEventListener("click", function () { buy(n); });
    });
  }

  function stateOf(n, have, gems) {
    if (have[n.id]) return "owned";
    if (!needs(n).every(function (id) { return have[id]; })) return "locked";
    return gems >= n.price ? "ready" : "short";
  }

  // The furthest tier with an upgrade you own or can buy now.
  function reach(have) {
    var t = 1;
    Object.keys(have).forEach(function (id) {
      var n = node(id);
      if (n) t = Math.max(t, n.part === "C" ? n.tier + 1 : n.tier);
    });
    return t;
  }

  function render(p) {
    var mult = multiplierOf(owned);
    if (els && els.mult) {
      els.mult.textContent = mult > 1 ? fmtMult(mult) + " per gem" : "";
      els.mult.hidden = !(mult > 1);
    }
    if (!els || els.panel.hidden) return;
    var have = {};
    owned.forEach(function (id) { have[id] = true; });
    els.value.textContent = fmtMult(mult);
    var want = reach(have) + EXTRA_TIERS;
    while (tiers < want) addTier(++tiers);
    for (var id in nodes) {
      var o = nodes[id], n = o.n, state = stateOf(n, have, p.gems), b = o.button;
      b.className = b.className.replace(/ is-\w+/g, "") + " is-" + state + (n.milestone ? " is-milestone" : "");
      b.disabled = state === "owned" || state === "locked";
      b.setAttribute("aria-disabled", String(state !== "ready"));
      var what = fmtBoost(n) + " gem multiplier, tier " + n.tier;
      if (state === "owned") {
        o.price.textContent = "Bought";
        b.setAttribute("aria-label", what + ", bought");
      } else {
        var short = n.price - p.gems;
        o.price.innerHTML = gemIcon() + "<span>" + fmt(n.price) + "</span>";
        b.setAttribute("aria-label", what + ", " + fmt(n.price) + " gems" +
          (state === "locked" ? ", locked" : state === "short" ? ", you need " + fmt(short) + " more" : ""));
      }
    }
    drawLines(have);
  }

  // Elbow connectors: each tier's sides join into its centre, and each centre
  // branches into the next tier's sides. Lit once the upgrade above is bought.
  function drawLines(have) {
    var height = tiers * TIER_H - ROW_GAP, dim = [], lit = [];
    for (var t = 1; t <= tiers; t++) {
      var top = (t - 1) * TIER_H, mid = top + NODE_H + ROW_GAP / 2, centre = top + ROW;
      ["L", "R"].forEach(function (part) {
        (have[t + part] ? lit : dim).push("M" + X[part] + " " + (top + NODE_H) + "V" + mid + "H" + X.C + "V" + centre);
      });
      if (t < tiers) {
        var down = centre + NODE_H + ROW_GAP / 2, next = t * TIER_H;
        ["L", "R"].forEach(function (part) {
          (have[t + "C"] ? lit : dim).push("M" + X.C + " " + (centre + NODE_H) + "V" + down + "H" + X[part] + "V" + next);
        });
      }
    }
    els.lines.setAttribute("viewBox", "0 0 600 " + height);
    els.lines.style.height = height + "px";
    els.lines.innerHTML =
      '<path class="slope-tree-line" d="' + dim.join("") + '"/>' +
      '<path class="slope-tree-line is-lit" d="' + lit.join("") + '"/>';
  }

  function firstBuyable() {
    var have = {};
    owned.forEach(function (id) { have[id] = true; });
    var best = null;
    for (var id in nodes) {
      var n = nodes[id].n;
      if (stateOf(n, have, Infinity) === "ready" && (!best || n.tier < best.n.tier)) best = nodes[id];
    }
    return best;
  }

  function scrollToNode(o) {
    var screen = els.panel.closest(".slope-shop") || document.scrollingElement;
    var r = o.button.getBoundingClientRect(), s = screen.getBoundingClientRect();
    if (r.top < s.top || r.bottom > s.bottom) screen.scrollTop += r.top - s.top - s.height / 2 + r.height / 2;
  }

  function buy(n) {
    var p = profile.get();
    var state = stateOf(n, owned.reduce(function (h, id) { h[id] = true; return h; }, {}), p.gems);
    if (state === "owned" || state === "locked") return;
    if (state === "short") {
      els.status.textContent = "You need " + fmt(n.price - p.gems) + " more gems for this upgrade.";
      return;
    }
    var focused = document.activeElement === nodes[n.id].button;
    if (profile.buyUpgrade(n.id, n.price)) {
      els.status.textContent = "Bought " + fmtBoost(n) + ". Your gem multiplier is " + fmtMult(multiplierOf(owned)) + ".";
      // The bought button turns off: keep the keyboard on the tree.
      var next = firstBuyable();
      if (focused) (next ? next.button : els.panel.closest(".slope-shop").querySelector(".slope-back")).focus({ preventScroll: true });
    }
  }

  function start() {
    var panel = window.SlopeShop && window.SlopeShop.panel("upgrades");
    if (panel) build(panel);
  }
  if (window.SlopeUI) window.SlopeUI.ready(start);
})();
