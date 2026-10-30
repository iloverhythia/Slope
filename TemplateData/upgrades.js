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
 * Some centre upgrades also unlock a rarer gem (gems.js): Sapphire at tier
 * 4, Amethyst at 8, Diamond at 13, Prismatic at 18 and Cosmic at 25.
 *
 *   SlopeUpgrades.multiplier() / magnet() / spawn() / luck() / xp() / discount()
 *   SlopeUpgrades.hasRarity(id)  true once that gem rarity is unlocked
 *   SlopeUpgrades.maxPlan()      what Buy max would buy now: { ids, cost }
 *
 * Buy max keeps buying the cheapest upgrade you can afford (which opens the
 * next ones) until the gems run out.
 *
 * The tab also holds Gem Prestige (profile.js): start the tree and the merge
 * game over for prestige points, which boost gems and XP for good.
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
  // Gem rarities the tree unlocks, by tier (gems.js).
  var RARITIES = (window.SlopeGems && window.SlopeGems.rarities) || [];
  function unlockAt(tier) {
    for (var i = 0; i < RARITIES.length; i++) if (RARITIES[i].tier === tier) return RARITIES[i];
    return null;
  }

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
    var unlock = centre ? unlockAt(tier) : null;
    return {
      unlock: unlock ? unlock.id : null,
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
    var sum = { mult: 100, magnet: 0, spawn: 0, lucky: 0, xp: 0, discount: 0 }, rarities = {};
    list.forEach(function (id) {
      var n = node(id);
      if (!n) return;
      sum[n.kind] += n.amount;
      if (n.unlock) rarities[n.unlock] = true;
    });
    ORDER.forEach(function (k) { if (KINDS[k].cap) sum[k] = Math.min(sum[k], KINDS[k].per * KINDS[k].cap); });
    return {
      multiplier: sum.mult / 100,
      magnet: sum.magnet / 100,
      spawn: sum.spawn / 100,
      lucky: sum.lucky / 100,
      xp: 1 + sum.xp / 100,
      discount: sum.discount / 100,
      rarities: rarities,
      percent: sum
    };
  }

  function fmtMult(m) { return "x" + m.toFixed(2); }
  function fmtAmount(n) {
    if (n.kind === "mult") return "+" + (n.amount / 100).toFixed(2) + "x";
    return (n.kind === "discount" ? "-" : "+") + n.amount + "%";
  }
  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }   // full, for screen readers
  function abbr(n) { return profile.short ? profile.short(n) : fmt(n); }   // short, for the screen: 1.2K, 3.4M...

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
    hasRarity: function (id) { return !!fx.rarities[id]; },
    price: function (base) { return base > 0 ? Math.max(1, Math.round(base * (1 - fx.discount))) : 0; },
    maxPlan: function () { return maxPlan(profile.get().gems); },
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

  function rarityOf(id) {
    for (var i = 0; i < RARITIES.length; i++) if (RARITIES[i].id === id) return i;
    return -1;
  }
  function rgb(c) { return "rgb(" + c.map(function (v) { return Math.round(v * 255); }).join(",") + ")"; }
  function rarityColour(i) {
    return window.SlopeGems ? rgb(window.SlopeGems.colours(i, 1.3).edge) : "currentColor";
  }
  function pct(v) { return (v * 100).toFixed(v < 0.01 ? 2 : 1).replace(/\.?0+$/, "") + "%"; }

  // The rarities beyond the plain gem: icon, name, worth and chance (or where
  // in the tree it unlocks).
  function rarityRows() {
    var luck = fx.lucky;
    return RARITIES.slice(1).map(function (k, j) {
      var i = j + 1, open = i === 1 ? luck > 0 : !!fx.rarities[k.id];
      var chance = i === 1 ? luck : k.chance * (1 + 5 * luck);
      return '<li class="slope-rarity' + (open ? "" : " is-locked") + '" style="--rarity:' + rarityColour(i) + '">' +
        '<span class="slope-rarity-icon">' + gemIcon() + "</span>" +
        '<span class="slope-rarity-name">' + k.name + "</span>" +
        '<span class="slope-rarity-worth">x' + k.worth + "</span>" +
        '<span class="slope-rarity-chance">' + (open ? pct(chance) : i === 1 ? "Lucky" : "Tier " + k.tier) + "</span></li>";
    }).join("");
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
        '<ul class="slope-rarities" aria-label="Gem rarities"></ul>' +
        '<p class="slope-shop-note">Every gem you pick up is worth your multiplier. The other upgrades pull gems in, ' +
          "put more on the track, make some golden (worth 5), add XP and take gems off shop prices. " +
          "Some centre upgrades unlock rarer gems, worth far more. " +
          "Each upgrade opens the next ones, and the tree never ends.</p>" +
      "</div>" +
      '<section class="slope-prestige" aria-labelledby="slope-prestige-title">' +
        '<h3 class="slope-prestige-title" id="slope-prestige-title">Gem Prestige</h3>' +
        '<p class="slope-prestige-now"></p>' +
        '<p class="slope-prestige-note">Start this upgrade tree and your Merge game (board, balls and Merge upgrades) over for prestige points. ' +
          "Each point is +25% gems and +10% XP for good, and every 3 points new merge balls start a level higher. " +
          "You get a point for every 5 levels of your best merge ball and every 3 tiers of the tree. Gems, skins (secret ones too) and everything else stay.</p>" +
        '<button type="button" class="slope-btn slope-prestige-btn"></button>' +
        '<p class="slope-prestige-status" role="status"></p>' +
      "</section>" +
      '<div class="slope-tree-actions">' +
        '<button type="button" class="slope-btn slope-buy-max"></button>' +
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
      rarities: panel.querySelector(".slope-rarities"),
      prestigeNow: panel.querySelector(".slope-prestige-now"),
      buyMax: panel.querySelector(".slope-buy-max"),
      prestigeBtn: panel.querySelector(".slope-prestige-btn"),
      prestigeStatus: panel.querySelector(".slope-prestige-status"),
      mult: document.querySelector(".slope-shop-mult")
    };
    panel.addEventListener("slope-show", function () {
      els.status.textContent = "";
      render(profile.get());
      var next = firstBuyable();
      if (next) requestAnimationFrame(function () { scrollToNode(next); });
    });
    profile.onChange(render);
    els.buyMax.addEventListener("click", buyMax);
    // Two clicks: the first asks, the second (within 5 s) does it.
    var armed = 0;
    els.prestigeBtn.addEventListener("click", function () {
      var gain = profile.prestigeGain();
      if (gain < 1) return;
      if (!armed) {
        armed = setTimeout(function () { armed = 0; renderPrestige(profile.get()); }, 5000);
        els.prestigeBtn.classList.add("is-armed");
        els.prestigeBtn.textContent = "Sure? Click again to reset the tree and Merge";
        return;
      }
      clearTimeout(armed);
      armed = 0;
      els.prestigeBtn.classList.remove("is-armed");
      var got = profile.prestige();
      var b = profile.boosts();
      els.prestigeStatus.textContent = got ? "Prestige! +" + got + (got === 1 ? " point" : " points") + ". Gems x" + b.gems.toFixed(2) + " and XP x" + b.xp.toFixed(2) + " for good." : "";
      tiers = 0; nodes = {}; els.list.innerHTML = "";
      render(profile.get());
    });
  }

  function renderPrestige(p) {
    var gain = profile.prestigeGain(), b = profile.boosts();
    els.prestigeNow.textContent = p.prestige
      ? "Prestige " + p.prestige + "  \u00b7  gems x" + b.gems.toFixed(2) + "  \u00b7  XP x" + b.xp.toFixed(2) + "  \u00b7  merge balls start at level " + b.mergeStart
      : "No prestige yet";
    if (!els.prestigeBtn.classList.contains("is-armed")) {
      var then = profile.boostsFor(p.prestige + gain);
      els.prestigeBtn.textContent = gain ? "Prestige for +" + gain + (gain === 1 ? " point" : " points") + " (gems x" + then.gems.toFixed(2) + ")" : "Prestige";
    }
    els.prestigeBtn.disabled = gain < 1;
    els.prestigeBtn.setAttribute("aria-label", gain ? "Gem Prestige for " + gain + " points: resets the upgrade tree and the Merge game"
      : "Gem Prestige: reach merge level 5 or tree tier 3 first");
    if (gain < 1) els.prestigeBtn.title = "Reach merge level 5 or finish 3 tiers of the tree first";
    else els.prestigeBtn.removeAttribute("title");
  }

  function addTier(t) {
    var li = document.createElement("li");
    li.className = "slope-tier" + (t % MILESTONE === 0 ? " is-milestone" : "");
    li.innerHTML =
      '<p class="slope-tier-label">Tier ' + t + (t % MILESTONE === 0 ? "<span>Milestone</span>" : "") + "</p>" +
      ["L", "R", "C"].map(function (part) {
        var n = node(t + part), r = n.unlock ? rarityOf(n.unlock) : -1;
        return '<button type="button" class="slope-btn slope-upgrade slope-upgrade-' + part.toLowerCase() + (n.unlock ? " is-unlock" : "") +
          '" data-id="' + n.id + '" data-kind="' + n.kind + '"' + (n.unlock ? ' style="--rarity:' + rarityColour(r) + '"' : "") +
          '><span class="slope-upgrade-boost">' + fmtAmount(n) + "</span>" +
          '<span class="slope-upgrade-kind">' + (n.unlock ? '<span class="slope-upgrade-gem">' + gemIcon() + "</span>" + RARITIES[r].name + " gems" : KINDS[n.kind].name) + "</span>" +
          '<span class="slope-upgrade-price"></span></button>';
      }).join("");
    els.list.appendChild(li);
    ["L", "R", "C"].forEach(function (part) {
      var n = node(t + part), button = li.querySelector('[data-id="' + n.id + '"]');
      nodes[n.id] = { n: n, button: button, price: button.querySelector(".slope-upgrade-price") };
      button.addEventListener("click", function () { buy(n); });
    });
  }

  // Buy max: the cheapest upgrade you can afford, again and again (each one
  // bought may open the next). Ties go to the lower tier.
  function maxPlan(gems) {
    var have = {}, ids = [], cost = 0;
    owned.forEach(function (id) { have[id] = true; });
    for (var guard = 0; guard < 5000; guard++) {
      var best = null, top = reach(have);
      for (var t = 1; t <= top; t++) {
        ["L", "R", "C"].forEach(function (part) {
          var n = node(t + part);
          if (stateOf(n, have, gems) === "ready" && (!best || n.price < best.price)) best = n;
        });
      }
      if (!best) break;
      have[best.id] = true;
      ids.push({ id: best.id, price: best.price });
      gems -= best.price;
      cost += best.price;
    }
    return { ids: ids, cost: cost };
  }

  function renderBuyMax(p) {
    var plan = maxPlan(p.gems), n = plan.ids.length;
    els.buyMax.disabled = !n;
    els.buyMax.innerHTML = n
      ? "Buy max: " + n + (n === 1 ? " upgrade" : " upgrades") + " for " + gemIcon() + "<span>" + abbr(plan.cost) + "</span>"
      : "Buy max: nothing you can afford yet";
    els.buyMax.setAttribute("aria-label", n ? "Buy max: " + n + " upgrades for " + fmt(plan.cost) + " gems" : "Buy max: nothing you can afford yet");
  }

  function buyMax() {
    var p = profile.get(), plan = maxPlan(p.gems);
    if (!plan.ids.length) return;
    var before = fx.multiplier;
    if (profile.buyUpgrades(plan.ids)) {
      var unlocked = plan.ids.map(function (u) { return node(u.id).unlock; }).filter(Boolean);
      els.status.textContent = "Bought " + plan.ids.length + (plan.ids.length === 1 ? " upgrade" : " upgrades") + " for " + abbr(plan.cost) + " gems. " +
        "Gem multiplier " + fmtMult(before) + " to " + fmtMult(fx.multiplier) + "." +
        (unlocked.length ? " New gems: " + unlocked.map(function (id) { return RARITIES[rarityOf(id)].name; }).join(", ") + "!" : "");
      var next = firstBuyable();
      if (next) requestAnimationFrame(function () { scrollToNode(next); });
    }
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
      // Everything a gem is worth: the tree, the merge game's best ball and Gem Prestige.
      var worth = mult * (window.SlopeMerge ? window.SlopeMerge.boost() : 1) * (profile.boosts ? profile.boosts().gems : 1);
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
    var rows = rarityRows();
    if (els.rarities.__html !== rows) els.rarities.innerHTML = els.rarities.__html = rows;
    renderPrestige(p);
    renderBuyMax(p);
    var want = reach(have) + EXTRA_TIERS;
    while (tiers < want) addTier(++tiers);
    for (var id in nodes) {
      var o = nodes[id], n = o.n, state = stateOf(n, have, p.gems), b = o.button;
      b.className = b.className.replace(/ is-\w+/g, "") + " is-" + state + (n.milestone ? " is-milestone" : "") + (n.unlock ? " is-unlock" : "");
      b.disabled = state === "owned" || state === "locked";
      b.setAttribute("aria-disabled", String(state !== "ready"));
      var what = fmtAmount(n) + " " + KINDS[n.kind].what + (n.unlock ? ", unlocks " + RARITIES[rarityOf(n.unlock)].name + " gems" : "") + ", tier " + n.tier;
      if (state === "owned") {
        o.price.textContent = "Bought";
        b.setAttribute("aria-label", what + ", bought");
      } else {
        var short = n.price - p.gems;
        o.price.innerHTML = gemIcon() + "<span>" + abbr(n.price) + "</span>";
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
      els.status.textContent = "You need " + abbr(n.price - p.gems) + " more gems for this upgrade.";
      return;
    }
    var focused = document.activeElement === nodes[n.id].button;
    if (profile.buyUpgrade(n.id, n.price)) {
      var k = n.unlock ? RARITIES[rarityOf(n.unlock)] : null;
      els.status.textContent = k
        ? "Bought " + fmtAmount(n) + ". " + k.name + " gems (worth " + k.worth + ") now turn up on the track."
        : n.kind === "mult"
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
