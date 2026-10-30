/*
 * Player profile: XP, level, gems, gem upgrades, ball skins, backgrounds,
 * Adventure progress and run stats.
 *
 * XP comes from score: every run earns score x 10 XP. Reaching level L takes
 * 50 * L * (L - 1) XP in total, so each level needs 100 XP more than the last.
 *
 * Progress is kept in this browser. Inside a Claude artifact the player can
 * also log in with Claude; the profile then lives in their own private
 * document (data/users/<id>/profile) and follows them across devices.
 * Guest progress made before logging in is added to the account once.
 *
 * Account writes are gathered up: at most one every couple of seconds, and
 * none when nothing changed (the merge game's clicks, gems and purchases come
 * in bursts). This browser also keeps its own copy of the account's progress,
 * apart from guest progress, so nothing is lost if a write can't be made and
 * nothing is ever added to the account twice.
 *
 *   SlopeProfile.get()             current profile with level info
 *   SlopeProfile.recordRun(run)    { score, gems, golds, seconds } -> { xp, levelBefore, levelAfter }
 *   SlopeProfile.recordModeRun(mode, score, { dodged })   a run in a game mode (modes.js)
 *   SlopeProfile.xpFor(score)      XP a run with that score earns
 *   SlopeProfile.addGems(n)            n can be fractional (gem multiplier): the
 *                                      fraction is kept; returns whole gems added
 *   SlopeProfile.buyUpgrade(id, price) spends gems on a gem upgrade; true if bought
 *   SlopeProfile.buySkin(id, price)   spends gems; true if bought (and equips it)
 *   SlopeProfile.equipSkin(id)
 *   SlopeProfile.buyBackground(id, price)  spends gems; true if bought (and shows it)
 *   SlopeProfile.equipBackground(id)       "none" is the game's own black
 *   SlopeProfile.buySlope(id, price) / equipSlope(id)   "track-..." and "pillar-..." styles
 *   SlopeProfile.saveMerge(state, notify)  the merge game's state (get().merge)
 *   SlopeProfile.spendGems(price)          true if paid
 *   SlopeProfile.completeLevel(n)     Adventure level n beaten: unlocks n + 1
 *   SlopeProfile.onChange(fn)
 *   SlopeProfile.account           { available, signedIn, name, avatarUrl, error }
 *   SlopeProfile.signIn()          asks the viewer to allow Claude login
 */
(function () {
  "use strict";

  var LOCAL_KEY = "slope-profile";             // guest progress
  var ACCOUNT_KEY = "slope-profile-account";   // this browser's copy of the account's progress
  var FLUSH_DELAY = 2000;                      // ms: account writes at most this often
  var XP_PER_POINT = 10;
  var RECENT_RUNS = 12;

  var listeners = [];
  var data = readLocal();
  var remote = null; // { ref, id } once signed in
  var accountId = null; // the account this browser plays as (kept if writes stop working)
  var flushTimer = 0, inFlight = false, lastWritten = "", failures = 0;

  var account = {
    available: !!(window.claude && typeof window.claude.use === "function"),
    signedIn: false,
    busy: false,
    name: "",
    avatarUrl: "",
    error: ""
  };

  function blank() {
    return { xp: 0, gems: 0, runs: 0, best: 0, total: 0, bestGems: 0, playSeconds: 0, recent: [], skins: [], skin: "classic", advUnlocked: 1, advWins: 0,
      upgrades: [], gemBank: 0, backgrounds: [], background: "none",
      slopes: [], track: "track-classic", pillar: "pillar-classic", merge: cleanMerge(null),
      gemsTotal: 0, goldTotal: 0, spent: 0, longestRun: 0, modes: cleanModes(null) };
  }

  // Runs per game mode (modes.js): { runs, best, total, dodged }.
  function modeNames() { return ["classic", "randomizer", "advanced"]; }
  function cleanModes(m) {
    function n(v) { v = Math.floor(+v); return isFinite(v) && v >= 0 ? v : 0; }
    var out = {};
    m = m && typeof m === "object" ? m : {};
    modeNames().forEach(function (k) {
      var x = m[k] && typeof m[k] === "object" ? m[k] : {};
      out[k] = { runs: n(x.runs), best: n(x.best), total: n(x.total), dodged: n(x.dodged) };
    });
    return out;
  }

  // The merge game (merge.js): best ball level, the board (a level or 0 per
  // space), clicks towards the next ball and its upgrades.
  // (A function, so it is ready before the profile is first read.)
  function mergeUpgrades() { return ["fast", "auto", "better", "lucky", "board", "charm"]; }
  function cleanMerge(m) {
    function n(v, max) { v = Math.floor(+v); return isFinite(v) && v >= 0 ? Math.min(v, max) : 0; }
    var out = { best: 0, board: [], clicks: 0, made: 0, up: {} };
    m = m && typeof m === "object" ? m : {};
    out.best = n(m.best, 999999);
    out.clicks = n(m.clicks, 100);
    out.made = n(m.made, 1e12);
    out.board = Array.isArray(m.board) ? m.board.slice(0, 64).map(function (v) { return n(v, 999999); }) : [];
    mergeUpgrades().forEach(function (k) { out.up[k] = n(m.up && m.up[k], 1000); });
    return out;
  }

  function clean(d) {
    var b = blank();
    if (!d || typeof d !== "object") return b;
    Object.keys(b).forEach(function (k) {
      if (k === "recent") b.recent = Array.isArray(d.recent) ? d.recent.slice(-RECENT_RUNS) : [];
      else if (k === "skins") b.skins = Array.isArray(d.skins) ? d.skins.filter(isSkinId) : [];
      else if (k === "skin") b.skin = isSkinId(d.skin) ? d.skin : "classic";
      else if (k === "upgrades") b.upgrades = Array.isArray(d.upgrades) ? d.upgrades.filter(isUpgradeId) : [];
      else if (k === "backgrounds") b.backgrounds = Array.isArray(d.backgrounds) ? d.backgrounds.filter(isSkinId) : [];
      else if (k === "background") b.background = isSkinId(d.background) ? d.background : "none";
      else if (k === "merge") b.merge = cleanMerge(d.merge);
      else if (k === "modes") b.modes = cleanModes(d.modes);
      else if (k === "slopes") b.slopes = Array.isArray(d.slopes) ? d.slopes.filter(isSlopeId) : [];
      else if (k === "track" || k === "pillar") b[k] = isSlopeId(d[k]) && d[k].indexOf(k + "-") === 0 ? d[k] : k + "-classic";
      else if (typeof d[k] === "number" && isFinite(d[k]) && d[k] >= 0) b[k] = d[k];
    });
    b.advUnlocked = Math.max(1, Math.floor(b.advUnlocked));
    b.gems = Math.floor(b.gems);
    b.gemBank = b.gemBank < 1 ? b.gemBank : 0;
    return b;
  }

  function isSlopeId(id) {
    return typeof id === "string" && /^(track|pillar)-[a-z0-9-]{1,32}$/.test(id);
  }

  function isSkinId(id) {
    return typeof id === "string" && /^[a-z0-9-]{1,32}$/.test(id);
  }

  function isUpgradeId(id) {
    return typeof id === "string" && /^[1-9][0-9]{0,5}[LRC]$/.test(id);
  }

  function readLocal() {
    try { return clean(JSON.parse(localStorage.getItem(LOCAL_KEY) || "null")); } catch (e) { return blank(); }
  }

  function writeLocal(d) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(d)); } catch (e) {}
  }

  function levelFor(xp) {
    var level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * xp) / 100)) / 2));
    var start = 50 * level * (level - 1);
    return { level: level, into: xp - start, need: 100 * level };
  }

  function snapshot() {
    var info = levelFor(data.xp);
    return Object.assign({}, data, {
      recent: data.recent.slice(),
      skins: data.skins.slice(),
      upgrades: data.upgrades.slice(),
      backgrounds: data.backgrounds.slice(),
      slopes: data.slopes.slice(),
      merge: JSON.parse(JSON.stringify(data.merge)),
      modes: JSON.parse(JSON.stringify(data.modes)),
      level: info.level,
      levelXp: info.into,
      levelNeed: info.need,
      average: data.runs ? Math.round(data.total / data.runs) : 0
    });
  }

  function changed() {
    var snap = snapshot();
    listeners.forEach(function (fn) {
      try { fn(snap, account); } catch (e) { console.error(e); }
    });
  }

  function save() {
    if (!remote) {
      // Logged in but not writing to the account just now: its copy, never guest progress.
      if (accountId) writeAccountCopy(); else writeLocal(data);
      return;
    }
    // Kept in this browser at once, written to the account a moment later.
    writeAccountCopy();
    scheduleFlush(FLUSH_DELAY);
  }

  function writeAccountCopy() {
    if (!accountId) return;
    try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ id: accountId, at: Date.now(), data: data })); } catch (e) {}
  }

  function readAccountCopy(id) {
    try {
      var copy = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null");
      return copy && copy.id === id && copy.data ? { at: +copy.at || 0, data: clean(copy.data) } : null;
    } catch (e) { return null; }
  }

  function scheduleFlush(ms) {
    if (flushTimer || !remote) return;
    flushTimer = setTimeout(flush, ms);
  }

  // One write at a time, of the whole profile, only when it changed.
  function flush() {
    flushTimer = 0;
    if (!remote) return;
    if (inFlight) { scheduleFlush(FLUSH_DELAY); return; }
    var text = JSON.stringify(data);
    if (text === lastWritten) return;
    var body = JSON.parse(text);
    body.updatedAt = Date.now();
    var forRemote = remote;
    inFlight = true;
    forRemote.ref.set(body).then(function () {
      inFlight = false;
      failures = 0;
      if (remote !== forRemote) return;
      lastWritten = text;
      if (account.error) { account.error = ""; changed(); }
    }, function (e) {
      inFlight = false;
      if (remote !== forRemote) return;
      var code = e && e.code;
      // A busy moment: try again shortly (longer when told to slow down).
      if ((code === "unavailable" || code === "resource_exhausted" || code === "quota_exceeded") && failures < 6) {
        failures++;
        scheduleFlush(code === "unavailable" ? 1000 + Math.random() * 2000 : 10000 * failures);
        return;
      }
      // The account can't take writes now: keep playing on this browser's
      // copy, which goes to the account the next time you log in.
      console.warn("Slope profile: account save failed", code);
      remote = null;
      account.signedIn = false;
      account.error = "Couldn't save to your Claude account just now. Your progress is kept on this device and goes to your account next time you log in.";
      changed();
    });
  }

  // Leaving the page: write what is waiting.
  function flushNow() {
    if (!flushTimer) return;
    clearTimeout(flushTimer);
    flush();
  }
  window.addEventListener("pagehide", flushNow);
  document.addEventListener("visibilitychange", function () { if (document.hidden) flushNow(); });

  // XP for a score; the upgrade tree can add to it (upgrades.js).
  function xpFor(score) {
    var boost = window.SlopeUpgrades && window.SlopeUpgrades.xp ? window.SlopeUpgrades.xp() : 1;
    return Math.round(Math.max(0, Math.floor(score || 0)) * XP_PER_POINT * boost);
  }

  function recordRun(run) {
    var score = Math.max(0, Math.floor(run.score || 0));
    var gems = Math.max(0, Math.floor(run.gems || 0));
    var before = levelFor(data.xp).level;
    var xp = xpFor(score);
    data.xp += xp;
    data.runs += 1;
    data.total += score;
    data.best = Math.max(data.best, score);
    data.bestGems = Math.max(data.bestGems, gems);
    data.gemsTotal += gems;
    data.goldTotal += Math.max(0, Math.floor(run.golds || 0));
    data.longestRun = Math.max(data.longestRun, Math.round(run.seconds || 0));
    data.playSeconds += Math.max(0, Math.round(run.seconds || 0));
    data.recent.push({ score: score, gems: gems, at: Date.now() });
    data.recent = data.recent.slice(-RECENT_RUNS);
    save();
    changed();
    return { xp: xp, levelBefore: before, levelAfter: levelFor(data.xp).level };
  }

  function addGems(n) {
    if (!(n > 0)) return 0;
    var total = data.gemBank + n;
    var whole = Math.floor(total + 1e-9);
    data.gemBank = Math.max(0, total - whole);
    data.gems += whole;
    if (accountId) writeAccountCopy(); else writeLocal(data); // the account gets them with the run
    changed();
    return whole;
  }

  function buyUpgrade(id, price) {
    price = Math.floor(price);
    if (!isUpgradeId(id) || !(price >= 0) || data.upgrades.indexOf(id) !== -1 || data.gems < price) return false;
    data.gems -= price;
    data.spent += price;
    data.upgrades.push(id);
    save();
    changed();
    return true;
  }

  function buySkin(id, price) {
    price = Math.floor(price);
    if (!isSkinId(id) || !(price >= 0) || data.skins.indexOf(id) !== -1 || data.gems < price) return false;
    data.gems -= price;
    data.spent += price;
    data.skins.push(id);
    data.skin = id;
    save();
    changed();
    return true;
  }

  function buyBackground(id, price) {
    price = Math.floor(price);
    if (!isSkinId(id) || !(price >= 0) || data.backgrounds.indexOf(id) !== -1 || data.gems < price) return false;
    data.gems -= price;
    data.spent += price;
    data.backgrounds.push(id);
    data.background = id;
    save();
    changed();
    return true;
  }

  function equipBackground(id) {
    if (!isSkinId(id) || (id !== "none" && data.backgrounds.indexOf(id) === -1)) return;
    data.background = id;
    save();
    changed();
  }

  // Slope styles: "track-..." for the track, "pillar-..." for the pillars.
  function buySlope(id, price) {
    price = Math.floor(price);
    if (!isSlopeId(id) || !(price >= 0) || data.slopes.indexOf(id) !== -1 || data.gems < price) return false;
    data.gems -= price;
    data.spent += price;
    data.slopes.push(id);
    data[id.split("-")[0]] = id;
    save();
    changed();
    return true;
  }

  function equipSlope(id) {
    if (!isSlopeId(id) || (!/-classic$/.test(id) && data.slopes.indexOf(id) === -1)) return;
    data[id.split("-")[0]] = id;
    save();
    changed();
  }

  // Merge game state. notify: tell the page (the best ball changed); plain
  // board moves and clicks are only saved.
  // A run in a game mode ended (modes.js); extra: { dodged } for Advanced.
  function recordModeRun(mode, score, extra) {
    var m = data.modes[mode];
    if (!m) return;
    score = Math.max(0, Math.floor(score || 0));
    m.runs += 1;
    m.best = Math.max(m.best, score);
    m.total += score;
    m.dodged += Math.max(0, Math.floor((extra && extra.dodged) || 0));
    save();
    changed();
  }

  function saveMerge(m, notify) {
    data.merge = cleanMerge(m);
    save();
    if (notify) changed();
  }

  function spendGems(price) {
    price = Math.floor(price);
    if (!(price >= 0) || data.gems < price) return false;
    data.gems -= price;
    data.spent += price;
    save();
    changed();
    return true;
  }

  function equipSkin(id) {
    var secret = /^secret-([1-9][0-9]{0,5})$/.exec(id);
    if (secret) {
      if (+secret[1] > data.merge.best) return;   // not reached in the merge game yet
    } else if (!isSkinId(id) || (id !== "classic" && data.skins.indexOf(id) === -1)) return;
    data.skin = id;
    save();
    changed();
  }

  function completeLevel(n) {
    n = Math.floor(n);
    if (!(n >= 1)) return;
    data.advWins += 1;
    data.advUnlocked = Math.max(data.advUnlocked, n + 1);
    save();
    changed();
  }

  function merge(a, b) {
    return clean({
      xp: a.xp + b.xp,
      gems: a.gems + b.gems,
      runs: a.runs + b.runs,
      best: Math.max(a.best, b.best),
      total: a.total + b.total,
      bestGems: Math.max(a.bestGems, b.bestGems),
      playSeconds: a.playSeconds + b.playSeconds,
      skins: a.skins.concat(b.skins.filter(function (id) { return a.skins.indexOf(id) === -1; })),
      skin: a.skin !== "classic" ? a.skin : b.skin,
      advUnlocked: Math.max(a.advUnlocked, b.advUnlocked),
      upgrades: a.upgrades.concat(b.upgrades.filter(function (id) { return a.upgrades.indexOf(id) === -1; })),
      gemBank: (a.gemBank + b.gemBank) % 1,
      backgrounds: a.backgrounds.concat(b.backgrounds.filter(function (id) { return a.backgrounds.indexOf(id) === -1; })),
      background: a.background !== "none" ? a.background : b.background,
      slopes: a.slopes.concat(b.slopes.filter(function (id) { return a.slopes.indexOf(id) === -1; })),
      track: a.track !== "track-classic" ? a.track : b.track,
      pillar: a.pillar !== "pillar-classic" ? a.pillar : b.pillar,
      gemsTotal: a.gemsTotal + b.gemsTotal,
      goldTotal: a.goldTotal + b.goldTotal,
      spent: a.spent + b.spent,
      longestRun: Math.max(a.longestRun, b.longestRun),
      modes: modeNames().reduce(function (o, k) {
        var x = a.modes[k], y = b.modes[k];
        o[k] = { runs: x.runs + y.runs, best: Math.max(x.best, y.best), total: x.total + y.total, dodged: x.dodged + y.dodged };
        return o;
      }, {}),
      merge: {
        best: Math.max(a.merge.best, b.merge.best),
        board: a.merge.board.some(Boolean) ? a.merge.board : b.merge.board,
        clicks: a.merge.clicks,
        made: a.merge.made + b.merge.made,
        up: mergeUpgrades().reduce(function (o, k) { o[k] = Math.max(a.merge.up[k], b.merge.up[k]); return o; }, {})
      },
      advWins: a.advWins + b.advWins,
      recent: a.recent.concat(b.recent).sort(function (x, y) { return (x.at || 0) - (y.at || 0); })
    });
  }

  // A store call, tried once more after a moment if the store was briefly unavailable.
  function retry(call) {
    return call().catch(function (e) {
      if (!e || e.code !== "unavailable") throw e;
      return new Promise(function (r) { setTimeout(r, 800 + Math.random() * 1200); }).then(call);
    });
  }

  function fail(code) { var e = new Error(code); e.code = code; return e; }

  function connect() {
    var claude = window.claude;
    return Promise.all([claude.use("user"), claude.use("db")]).then(function (caps) {
      var user = caps[0], db = caps[1];
      if (!user || !db) throw fail("unavailable");
      return Promise.all([user.id(), user.me()]).then(function (who) {
        var id = who[0], me = who[1];
        if (!id) throw fail("no-identity");
        var ref = db.doc("data/users/" + id + "/profile");
        return retry(function () { return ref.get(); }).then(function (snap) {
          var body = snap.exists ? snap.data() : null;
          var saved = body ? clean(body) : blank();
          // Progress this browser kept for the account and never got to write.
          var copy = readAccountCopy(id);
          var newer = !!copy && copy.at > ((body && +body.updatedAt) || 0);
          if (newer) saved = copy.data;
          var guest = readLocal();
          var hasGuest = guest.runs > 0 || guest.gems > 0 || guest.skins.length > 0 || guest.advUnlocked > 1 || guest.upgrades.length > 0 ||
            guest.backgrounds.length > 0 || guest.slopes.length > 0 || guest.merge.best > 0;
          data = hasGuest ? merge(saved, guest) : saved;
          remote = { ref: ref, id: id };
          accountId = id;
          failures = 0;
          lastWritten = body && !newer ? JSON.stringify(clean(body)) : "";
          account.signedIn = true;
          account.name = me.name || "";
          account.avatarUrl = me.avatarUrl || "";
          account.error = "";
          if (hasGuest) writeLocal(blank()); // guest progress now belongs to the account
          writeAccountCopy();
          if (hasGuest || newer || !body) scheduleFlush(0);
          changed();
        });
      });
    });
  }

  function signIn() {
    if (!account.available || account.signedIn || account.busy) return Promise.resolve();
    account.busy = true;
    account.error = "";
    changed();
    return window.claude.use("permissions").then(function (perms) {
      return perms ? perms.request(["user", "db"]) : null;
    }).then(function (states) {
      if (states && (states.user === "denied" || states.db === "denied")) throw fail("denied");
      if (states && (states.user === "unavailable" || states.db === "unavailable")) throw fail("unavailable");
      return connect();
    }).catch(function (e) {
      var code = (e && e.code) || "error";
      account.error = code === "denied"
        ? "Login was not allowed. You can turn it on in the artifact's Permissions menu."
        : code === "unavailable" || code === "not_granted" || code === "capability_disabled"
          ? "Logging in with Claude isn't available here. Open the game on claude.ai to log in; until then progress is saved on this device."
          : "Couldn't log in with Claude just now (" + code + "). Your progress is saved on this device; try again in a moment.";
      console.warn("Slope profile: login failed", code, e);
    }).then(function () {
      account.busy = false;
      changed();
    });
  }

  // Log back in without asking when the viewer already allowed it.
  if (account.available) {
    window.claude.use("permissions").then(function (perms) {
      if (!perms) return null;
      return perms.state();
    }).then(function (states) {
      if (states && states.user === "granted" && states.db === "granted") return connect();
      return null;
    }).catch(function () {});
  }

  window.SlopeProfile = {
    get: snapshot,
    levelFor: levelFor,
    xpPerPoint: XP_PER_POINT,
    xpFor: xpFor,
    recordRun: recordRun,
    addGems: addGems,
    buySkin: buySkin,
    buyUpgrade: buyUpgrade,
    buyBackground: buyBackground,
    buySlope: buySlope,
    saveMerge: saveMerge,
    recordModeRun: recordModeRun,
    spendGems: spendGems,
    equipSlope: equipSlope,
    equipBackground: equipBackground,
    equipSkin: equipSkin,
    completeLevel: completeLevel,
    signIn: signIn,
    account: account,
    onChange: function (fn) { listeners.push(fn); fn(snapshot(), account); }
  };
})();
