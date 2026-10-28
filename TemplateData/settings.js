/*
 * Slope settings: a gear button that opens a track color changer.
 *
 * The game is a compiled Unity build, so its colors can't be edited directly.
 * Instead an SVG color matrix tints the game: the neon green becomes the chosen
 * color, while black, white and the red walls stay exactly as they were.
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

  var state = loadState();
  var els = {};
  var rainbowFrame = 0;
  var rainbowHue = 0;
  var lastFrameTime = 0;

  function loadState() {
    var fallback = { color: CLASSIC, rainbow: false };
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && /^#[0-9a-f]{6}$/i.test(saved.color)) {
        return { color: saved.color.toLowerCase(), rainbow: !!saved.rainbow };
      }
    } catch (e) {}
    return fallback;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    if (game) game.style.filter = hex === CLASSIC ? "" : "url(#slope-tint)";
  }

  function render() {
    var hex = state.color;
    els.swatches.forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(!state.rainbow && btn.getAttribute("data-color") === hex));
    });
    els.custom.value = hex;
    els.rainbow.checked = state.rainbow;
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
    els.panel.hidden = false;
    els.toggle.setAttribute("aria-expanded", "true");
    var pressed = els.panel.querySelector('[aria-pressed="true"]');
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

  var GEAR_TEETH = [0, 45, 90, 135, 180, 225, 270, 315].map(function (deg) {
    return '<rect x="10.5" y="1" width="3" height="5" transform="rotate(' + deg + ' 12 12)"/>';
  }).join("");

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
      '<button type="button" class="slope-gear" aria-label="Settings" aria-expanded="false" aria-controls="slope-settings-panel">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
          '<g fill="currentColor">' + GEAR_TEETH + "</g>" +
          '<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="3.5"/>' +
        "</svg>" +
      "</button>" +
      '<div class="slope-panel" id="slope-settings-panel" role="dialog" aria-labelledby="slope-settings-title" hidden>' +
        '<div class="slope-panel-head">' +
          '<h2 class="slope-panel-title" id="slope-settings-title">Settings</h2>' +
          '<button type="button" class="slope-close" aria-label="Close settings">' +
            '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">' +
              '<path d="M1 1 11 11M11 1 1 11" stroke="currentColor" stroke-width="2.5" fill="none"/>' +
            "</svg>" +
          "</button>" +
        "</div>" +
        '<div class="slope-section" role="group" aria-labelledby="slope-color-label">' +
          '<p class="slope-label" id="slope-color-label">Track color</p>' +
          '<div class="slope-swatches">' +
            PRESETS.map(function (p) {
              return '<button type="button" class="slope-swatch" data-color="' + p.color + '" style="--swatch:' + p.color +
                '" aria-label="' + p.name + '" title="' + p.name + '"><span></span></button>';
            }).join("") +
          "</div>" +
          '<p class="slope-readout" aria-live="polite"><span class="slope-readout-name"></span><span class="slope-readout-hex"></span></p>' +
        "</div>" +
        '<div class="slope-section slope-rows">' +
          '<label class="slope-row" for="slope-custom-color"><span>Custom color</span>' +
            '<input type="color" id="slope-custom-color" value="#00ff00"></label>' +
          '<label class="slope-row" for="slope-rainbow"><span>Rainbow mode</span>' +
            '<input type="checkbox" id="slope-rainbow" role="switch"></label>' +
        "</div>" +
        '<button type="button" class="slope-reset">Reset to classic</button>' +
      "</div>";
    document.body.appendChild(root);

    els.root = root;
    els.matrix = root.querySelector("feColorMatrix");
    els.toggle = root.querySelector(".slope-gear");
    els.panel = root.querySelector(".slope-panel");
    els.close = root.querySelector(".slope-close");
    els.swatches = Array.prototype.slice.call(root.querySelectorAll(".slope-swatch"));
    els.custom = root.querySelector("#slope-custom-color");
    els.rainbow = root.querySelector("#slope-rainbow");
    els.name = root.querySelector(".slope-readout-name");
    els.hex = root.querySelector(".slope-readout-hex");

    els.toggle.addEventListener("click", function () {
      if (isOpen()) closePanel(false); else openPanel();
    });
    els.close.addEventListener("click", function () { closePanel(true); });
    els.swatches.forEach(function (btn) {
      btn.addEventListener("click", function () { setColor(btn.getAttribute("data-color")); });
    });
    els.custom.addEventListener("input", function () { setColor(els.custom.value); });
    els.rainbow.addEventListener("change", function () {
      state.rainbow = els.rainbow.checked;
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
