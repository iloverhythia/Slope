/*
 * Gem upgrade tree, on the shop's Upgrades tab. It never ends.
 *
 * Tier t has three upgrades: two side ones (tL, tR) and a centre one (tC).
 * The sides need the centre of the tier above; the centre needs both sides.
 * Every 10th tier is a milestone with bigger multiplier boosts. Prices grow
 * 20% a tier.
 *
 * The centres (and tier 1, and milestones) raise the gem multiplier: every
 * gem picked up is worth that many gems (fractions add up, see
 * SlopeProfile.addGems). From tier 2 the sides take turns between six kinds:
 *   Multiplier   +0.05x
 *   Magnet       +15% pickup reach, and gems drift towards the ball
 *   More gems    +10% gems on the track
 *   Lucky        +2% chance a gem is golden (worth 5)
 *   XP           +10% XP from every run
 *   Shop sale    -3% on skins and backgrounds
 * Kinds with a limit stop turning up once the tree holds enough of them to
 * reach it; their places go to the multiplier.
 *
 *   SlopeUpgrades.multiplier() / magnet() / spawn() / luck() / xp() / discount()
 *   SlopeUpgrades.price(base)    a shop price after the sale
 *   SlopeUpgrades.node(id)       { id, tier, part, kind, amount, price, milestone }
 */
(function () {
  "use strict";

  var profile = window.SlopeProfile;
  if (!profile) return;

  var MILESTONE = 10;
  var PRICE_START = 3;
  var PRICE_GROWTH = 1.2;
  var EXTRA_TIERS = 2;   // locked tiers shown past the furthest one you can buy

  // amount: per upgrade, in hundredths (multiplier) or percent; cap: how many
  // the tree holds at most.
  var KINDS = {
    mult: { name: "Multiplier", what: "gem multiplier" },
    magnet: { name: "Magnet", what: "pickup reach", per: 15, cap: 10 },
    spawn: { name: "More gems", what: "gems on the track", per: 10, cap: 10 },
    lucky: { name: "Lucky", what: "chance of golden gems", per: 2, cap: 15 },
    xp: { name: "XP", what: "XP from every run", per: 10 },
    discount: { name: "Shop sale", what: "off skins and backgrounds", per: 3, cap: 15 }
  };
  var ORDER = ["magnet", "spawn", "lucky", "xp", "discount"];
  var CYCLE = ["magnet", "spawn", "lucky", "xp", "discount", "mult", "spawn", "magnet", "xp", "lucky", "mult", "discount"];

  // The side upgrades' kinds, in tree order from tier 2, worked out once.
  // Once every limited kind is used up the pattern simply repeats, so tiers
  // past that point are worked out directly.
  var sideKinds = [], placed = {}, settled = false;
  function repeating(i) {
    var k = (Math.floor(i / 2) + 2) % MILESTONE === 0 ? "mult" : CYCLE[i % CYCLE.length];
    return KINDS[k].cap ? "mult" : k;
  }
  function sideKind(tier, part) {
    var i = (tier - 2) * 2 + (part === "R" ? 1 : 0);
    while (!settled && sideKinds.length <= i) {
      var j = sideKinds.length, t = Math.floor(j / 2) + 2;
      var k = t % MILESTONE === 0 ? "mult" : CYCLE[j % CYCLE.length];
      if (KINDS[k].cap && (placed[k] || 0) >= KINDS[k].cap) k = "mult";
      placed[k] = (placed[k] || 0) + 1;
      sideKinds.push(k);
      settled = ORDER.every(function (name) { return !KINDS[name].cap || (placed[name] || 0) >= KINDS[name].cap; });
    }
    return i < sideKinds.length ? sideKinds[i] : repeating(i);
  }

  function node(id) {
    var m = /^([1-9][0-9]*)([LRC])$/.exec(id);
    if (!m) return null;
    var tier = +m[1], part = m[2], milestone = tier % MILESTONE === 0;
    var base = Math.round(PRICE_START * Math.pow(PRICE_GROWTH, tier - 1));
    var centre = part === "C";
    var kind = centre || tier === 1 ? "mult" : sideKind(tier, part);
    return {
      id: id,
      tier: tier,
      part: part,
      milestone: milestone,
      kind: kind,
      amount: kind === "mult" ? (centre ? (milestone ? 50 : 15) : (milestone ? 10 : 5)) : KINDS[kind].per,
      price: centre ? base * (milestone ? 3 : 2) : base
    };
  }

  function needs(n) {
    if (n.part === "C") return [n.tier + "L", n.tier + "R"];
    return n.tier > 1 ? [(n.tier - 1) + "C"] : [];
  }

  function effectsOf(list) {
    var sum = { mult: 100, magnet: 0, spawn: 0, lucky: 0, xp: 0, discount: 0 };
    list.forEach(function (id) { var n = node(id); if (n) sum[n.kind] += n.amount; });
    ORDER.forEach(function (k) { if (KINDS[k].cap) sum[k] = Math.min(sum[k], KINDS[k].per * KINDS[k].cap); });
    return {
      multiplier: sum.mult / 100,
      magnet: sum.magnet / 100,
      spawn: sum.spawn / 100,
      lucky: sum.lucky / 100,
      xp: 1 + sum.xp / 100,
      discount: sum.discount / 100,
      percent: sum
    };
  }

  function fmtMult(m) { return "x" + m.toFixed(2); }
  function fmtAmount(n) {
    if (n.kind === "mult") return "+" + (n.amount / 100).toFixed(2) + "x";
    return (n.kind === "discount" ? "-" : "+") + n.amount + "%";
  }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }

  var owned = profile.get().upgrades;
  var fx = effectsOf(owned);
  profile.onChange(function (p) { owned = p.upgrades; fx = effectsOf(owned); });

  window.SlopeUpgrades = {
    multiplier: function () { return fx.multiplier; },
    magnet: function () { return fx.magnet; },       // extra pickup reach: 0.15 is +15%
    spawn: function () { return fx.spawn; },         // extra gems on the track
    luck: function () { return fx.lucky; },          // chance a gem is golden
    xp: function () { return fx.xp; },               // XP factor
    discount: function () { return fx.discount; },   // off shop prices
    price: function (base) { return base > 0 ? Math.max(1, Math.round(base * (1 - fx.discount))) : 0; },
    node: node,
    kinds: KINDS
  };

  // --- Shop tab -------------------------------------------------------------

  var NODE_H = 78, ROW_GAP = 26, ROW = NODE_H + ROW_GAP, TIER_H = 2 * ROW;
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
        '<ul class="slope-upgrades-effects">' +
          ORDER.map(function (k) {
            return '<li data-kind="' + k + '"><span>' + KINDS[k].name + '</span><span class="slope-effect-value"></span></li>';
          }).join("") +
        "</ul>" +
        '<p class="slope-shop-note">Every gem you pick up is worth your multiplier. The other upgrades pull gems in, ' +
          "put more on the track, make some golden (worth 5), add XP and take gems off shop prices. " +
          "Each upgrade opens the next ones, and the tree never ends.</p>" +
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
      effects: ORDER.map(function (k) { return { kind: k, li: panel.querySelector('[data-kind="' + k + '"]') }; }),
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
          '" data-id="' + n.id + '" data-kind="' + n.kind + '"><span class="slope-upgrade-boost">' + fmtAmount(n) + "</span>" +
          '<span class="slope-upgrade-kind">' + KINDS[n.kind].name + "</span>" +
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

  // The furthest tier open to you: the one after the last centre in an
  // unbroken line from tier 1.
  function reach(have) {
    var t = 1;
    while (have[t + "C"]) t++;
    return t;
  }

  function effectText(k) {
    var v = fx.percent[k];
    if (!v) return "0%";
    return (k === "discount" ? "-" : "+") + v + "%" + (KINDS[k].cap && v >= KINDS[k].per * KINDS[k].cap ? " max" : "");
  }

  function render(p) {
    var mult = fx.multiplier;
    if (els && els.mult) {
      // Everything a gem is worth: the tree and the merge game's best ball.
      var worth = mult * (window.SlopeMerge ? window.SlopeMerge.boost() : 1);
      els.mult.textContent = worth > 1 ? fmtMult(worth) + " per gem" : "";
      els.mult.hidden = !(worth > 1);
    }
    if (!els || els.panel.hidden) return;
    var have = {};
    owned.forEach(function (id) { have[id] = true; });
    els.value.textContent = fmtMult(mult);
    els.effects.forEach(function (e) {
      e.li.querySelector(".slope-effect-value").textContent = effectText(e.kind);
      e.li.classList.toggle("is-zero", !fx.percent[e.kind]);
    });
    var want = reach(have) + EXTRA_TIERS;
    while (tiers < want) addTier(++tiers);
    for (var id in nodes) {
      var o = nodes[id], n = o.n, state = stateOf(n, have, p.gems), b = o.button;
      b.className = b.className.replace(/ is-\w+/g, "") + " is-" + state + (n.milestone ? " is-milestone" : "");
      b.disabled = state === "owned" || state === "locked";
      b.setAttribute("aria-disabled", String(state !== "ready"));
      var what = fmtAmount(n) + " " + KINDS[n.kind].what + ", tier " + n.tier;
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
      els.status.textContent = n.kind === "mult"
        ? "Bought " + fmtAmount(n) + ". Your gem multiplier is " + fmtMult(fx.multiplier) + "."
        : "Bought " + KINDS[n.kind].name + " " + fmtAmount(n) + ". Now " + effectText(n.kind) + " " + KINDS[n.kind].what + ".";
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
