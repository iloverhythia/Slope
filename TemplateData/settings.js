/*
 * Slope settings: a gear button that opens a track color changer, the music
 * switch (audio.js) and a graphics quality choice, drawn in the game's own
 * menu style. Also hosts the page's other UI (window.SlopeUI): the HUD row
 * at the top left and the shared root that keeps key presses away from the
 * game.
 *
 * The game is a compiled Unity build, so its colors can't be edited directly.
 * Instead an SVG color matrix tints the game: the neon green becomes the chosen
 * color, while black, white and the red walls stay exactly as they were.
 * Graphics quality is handled by quality.js (window.SlopeGraphics).
 */
(function () {
  "use strict";

  var STORAGE_KEY = "slope-settings";
  var CLASSIC = "#00ff00";
  var RAINBOW_DEG_PER_SEC = 40;
  var PRESETS = [
    { name: "Classic", color: "#00ff00" },
    { name: "Cyan", color: "#00e5ff" },
    { name: "Blue", color: "#2b6bff" },
    { name: "Purple", color: "#9d4dff" },
    { name: "Pink", color: "#ff3fc8" },
    { name: "Amber", color: "#ffa21f" },
    { name: "Yellow", color: "#ffe81a" },
    { name: "White", color: "#ffffff" }
  ];
  var GRAPHICS = [
    { level: "auto", name: "Auto" },
    { level: "low", name: "Low" },
    { level: "high", name: "High" },
    { level: "ultra", name: "Ultra" }
  ];

  // A 9x9 dot-matrix gear, drawn with the same round dots as the game's lettering.
  // At 27px each dot lands on a whole 3px cell, so it stays crisp.
  var GEAR_DOTS = [
    "...###...",
    ".#.###.#.",
    ".#######.",
    "###...###",
    "###...###",
    "###...###",
    ".#######.",
    ".#.###.#.",
    "...###..."
  ];

  var graphics = window.SlopeGraphics;
  var state = loadState();
  var readyCallbacks = [];

  // Shared host for the page's own UI: settings, HUD items, Career screen.
  var ui = window.SlopeUI = {
    root: null,
    hud: null,
    themeColor: CLASSIC,
    ready: function (fn) {
      if (ui.root) fn(ui); else readyCallbacks.push(fn);
    },
    closeSettings: function () { if (els.panel) closePanel(false); }
  };
  var els = {};
  var rainbowFrame = 0;
  var rainbowHue = 0;
  var lastFrameTime = 0;

  function loadState() {
    var result = { color: CLASSIC, rainbow: false, graphics: graphics ? graphics.getLevel() : "auto",
      music: !(window.SlopeAudio && window.SlopeAudio.muted()) };
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && /^#[0-9a-f]{6}$/i.test(saved.color)) {
        result.color = saved.color.toLowerCase();
        result.rainbow = !!saved.rainbow;
      }
    } catch (e) {}
    return result;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({ v: graphics ? graphics.version : 2 }, state)));
    } catch (e) {}
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(rgb) {
    return "#" + [rgb.r, rgb.g, rgb.b].map(function (v) {
      return ("0" + Math.round(v).toString(16)).slice(-2);
    }).join("");
  }

  function hueToRgb(h) {
    // HSL with full saturation and 50% lightness: the pure hue.
    var x = 1 - Math.abs(((h / 60) % 2) - 1);
    var c = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(h / 60) % 6];
    return { r: c[0] * 255, g: c[1] * 255, b: c[2] * 255 };
  }

  // Maps green to the target color while keeping red, black, white and greys.
  // Columns are what pure red, green and blue become.
  function tintMatrix(rgb) {
    var r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    return [
      1, r, -r, 0, 0,
      0, g, 1 - g, 0, 0,
      0, b, 1 - b, 0, 0,
      0, 0, 0, 1, 0
    ].join(" ");
  }

  function presetName(hex) {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].color === hex) return PRESETS[i].name;
    }
    return "Custom";
  }

  function paint(hex) {
    var game = document.getElementById("gameContainer");
    els.matrix.setAttribute("values", tintMatrix(hexToRgb(hex)));
    els.root.style.setProperty("--slope-color", hex);
    ui.themeColor = hex;
    if (game) game.style.filter = hex === CLASSIC ? "" : "url(#slope-tint)";
  }

  function render() {
    var hex = state.color;
    els.swatches.forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(!state.rainbow && btn.getAttribute("data-color") === hex));
    });
    els.graphics.forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.getAttribute("data-graphics") === state.graphics));
    });
    els.custom.value = hex;
    els.rainbow.setAttribute("aria-pressed", String(state.rainbow));
    els.rainbowState.textContent = state.rainbow ? "On" : "Off";
    els.music.setAttribute("aria-pressed", String(state.music));
    els.musicState.textContent = state.music ? "On" : "Off";
    els.name.textContent = state.rainbow ? "Rainbow" : presetName(hex);
    els.hex.textContent = state.rainbow ? "cycling" : hex.toUpperCase();
    if (state.rainbow) {
      startRainbow();
    } else {
      stopRainbow();
      paint(hex);
    }
  }

  function setColor(hex) {
    state.color = hex.toLowerCase();
    state.rainbow = false;
    saveState();
    render();
  }

  function setGraphics(level) {
    state.graphics = level;
    if (graphics) graphics.setLevel(level);
    saveState();
    render();
  }

  function rainbowStep(time) {
    if (lastFrameTime) rainbowHue = (rainbowHue + (time - lastFrameTime) / 1000 * RAINBOW_DEG_PER_SEC) % 360;
    lastFrameTime = time;
    paint(rgbToHex(hueToRgb(rainbowHue)));
    rainbowFrame = requestAnimationFrame(rainbowStep);
  }

  function startRainbow() {
    if (rainbowFrame) return;
    rainbowHue = 120; // start from the classic green
    lastFrameTime = 0;
    rainbowFrame = requestAnimationFrame(rainbowStep);
  }

  function stopRainbow() {
    cancelAnimationFrame(rainbowFrame);
    rainbowFrame = 0;
  }

  function isOpen() {
    return !els.panel.hidden;
  }

  function openPanel() {
    var toast = els.root.querySelector(".slope-toast"); // shares the spot under the HUD
    if (toast) toast.hidden = true;
    els.panel.hidden = false;
    els.toggle.setAttribute("aria-expanded", "true");
    var pressed = els.panel.querySelector('.slope-swatch[aria-pressed="true"]');
    (pressed || els.close).focus();
  }

  function closePanel(returnFocus) {
    if (!isOpen()) return;
    els.panel.hidden = true;
    els.toggle.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      els.toggle.focus();
    } else if (els.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function gearSvg() {
    var dots = "";
    GEAR_DOTS.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) {
        if (row[x] === "#") dots += '<circle cx="' + (x + 0.5) + '" cy="' + (y + 0.5) + '" r="0.45"/>';
      }
    });
    return '<svg viewBox="0 0 9 9" width="27" height="27" fill="currentColor" aria-hidden="true" focusable="false">' + dots + "</svg>";
  }

  function build() {
    var root = document.createElement("div");
    root.id = "slope-settings";
    root.className = "slope-settings";
    root.innerHTML =
      '<svg class="slope-defs" width="0" height="0" aria-hidden="true" focusable="false">' +
        '<filter id="slope-tint" color-interpolation-filters="sRGB">' +
          '<feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/>' +
        "</filter>" +
      "</svg>" +
      '<div class="slope-hud">' +
        '<button type="button" class="slope-btn slope-gear" aria-label="Settings" aria-expanded="false" aria-controls="slope-settings-panel">' +
          gearSvg() +
        "</button>" +
      "</div>" +
      '<div class="slope-panel" id="slope-settings-panel" role="dialog" aria-labelledby="slope-settings-title" hidden>' +
        '<div class="slope-panel-head">' +
          '<h2 class="slope-panel-title" id="slope-settings-title">Settings</h2>' +
          '<button type="button" class="slope-btn slope-close" aria-label="Close settings">X</button>' +
        "</div>" +
        '<div class="slope-section" role="group" aria-labelledby="slope-color-label">' +
          '<p class="slope-label" id="slope-color-label">Track color</p>' +
          '<div class="slope-swatches">' +
            PRESETS.map(function (p) {
              return '<button type="button" class="slope-btn slope-swatch" data-color="' + p.color + '" style="--swatch:' + p.color +
                '" aria-label="' + p.name + '" title="' + p.name + '"><span></span></button>';
            }).join("") +
          "</div>" +
          '<p class="slope-readout" aria-live="polite"><span class="slope-readout-name"></span><span class="slope-readout-hex"></span></p>' +
        "</div>" +
        '<label class="slope-btn slope-row" for="slope-custom-color">' +
          "<span>Custom color</span>" +
          '<span class="slope-chip"><input type="color" id="slope-custom-color" value="#00ff00"></span>' +
        "</label>" +
        '<button type="button" class="slope-btn slope-row" id="slope-rainbow" aria-pressed="false">' +
          '<span>Rainbow</span><span class="slope-row-state">Off</span>' +
        "</button>" +
        '<button type="button" class="slope-btn slope-row" id="slope-music" aria-pressed="true">' +
          '<span>Music</span><span class="slope-row-state">On</span>' +
        "</button>" +
        '<div class="slope-section" role="group" aria-labelledby="slope-graphics-label">' +
          '<p class="slope-label" id="slope-graphics-label">Graphics</p>' +
          '<div class="slope-segments">' +
            GRAPHICS.map(function (g) {
              return '<button type="button" class="slope-btn" data-graphics="' + g.level + '" aria-pressed="false">' + g.name + "</button>";
            }).join("") +
          "</div>" +
          '<p class="slope-hint">Auto lowers the resolution if the game stutters.</p>' +
        "</div>" +
        '<button type="button" class="slope-btn slope-reset">Reset color</button>' +
      "</div>";
    document.body.appendChild(root);

    els.root = ui.root = root;
    ui.hud = root.querySelector(".slope-hud");
    els.matrix = root.querySelector("feColorMatrix");
    els.toggle = root.querySelector(".slope-gear");
    els.panel = root.querySelector(".slope-panel");
    els.close = root.querySelector(".slope-close");
    els.swatches = Array.prototype.slice.call(root.querySelectorAll(".slope-swatch"));
    els.graphics = Array.prototype.slice.call(root.querySelectorAll("[data-graphics]"));
    els.custom = root.querySelector("#slope-custom-color");
    els.rainbow = root.querySelector("#slope-rainbow");
    els.rainbowState = root.querySelector("#slope-rainbow .slope-row-state");
    els.music = root.querySelector("#slope-music");
    els.musicState = root.querySelector("#slope-music .slope-row-state");
    if (!window.SlopeAudio) els.music.hidden = true;
    els.name = root.querySelector(".slope-readout-name");
    els.hex = root.querySelector(".slope-readout-hex");

    if (!graphics) root.querySelector('[aria-labelledby="slope-graphics-label"]').hidden = true;

    els.toggle.addEventListener("click", function () {
      if (isOpen()) closePanel(false); else openPanel();
    });
    els.close.addEventListener("click", function () { closePanel(true); });
    els.swatches.forEach(function (btn) {
      btn.addEventListener("click", function () { setColor(btn.getAttribute("data-color")); });
    });
    els.graphics.forEach(function (btn) {
      btn.addEventListener("click", function () { setGraphics(btn.getAttribute("data-graphics")); });
    });
    els.custom.addEventListener("input", function () { setColor(els.custom.value); });
    els.rainbow.addEventListener("click", function () {
      state.rainbow = !state.rainbow;
      saveState();
      render();
    });
    els.music.addEventListener("click", function () {
      state.music = !state.music;
      if (window.SlopeAudio) window.SlopeAudio.setMuted(!state.music);
      saveState();
      render();
    });
    root.querySelector(".slope-reset").addEventListener("click", function () { setColor(CLASSIC); });

    // Unity listens for keys on window and blocks Tab. Keep keys pressed inside
    // the settings away from the game, so Tab works here and the ball doesn't steer.
    ["keydown", "keyup", "keypress"].forEach(function (type) {
      root.addEventListener(type, function (e) {
        if (type === "keydown" && e.key === "Escape") closePanel(true);
        e.stopPropagation();
      });
    });
    document.addEventListener("pointerdown", function (e) {
      if (isOpen() && !root.contains(e.target)) closePanel(false);
    });

    render();
    readyCallbacks.splice(0).forEach(function (fn) { fn(ui); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
