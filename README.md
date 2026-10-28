## Slope

The Unity engine source and the compiled and deployed version of Slope on Github Pages.

Credit to https://github.com/cgolden15/Slope-Game/ for the source.

### Added in this version

- **Settings** (gear, top left): track color presets, a custom color, rainbow mode, and Low / High / Ultra graphics.
- **Sharper graphics**: the game is drawn at full screen resolution or higher, with antialiasing, without changing its menus (`TemplateData/quality.js`).
- **Instant steering**: the ball moves sideways the moment a key is pressed and stops when it is released.
- **Gems** on the track. Roll through them to collect them; they can't be spent yet.
- **Career** button in the main menu: profile, level and stats. Every run earns score x 10 XP.
- In the Claude artifact version you can log in with Claude so your Career follows your account.

### How the game data is changed

The game is a compiled Unity build, so new behavior is added two ways:

- Page scripts in `TemplateData/` draw over the game and read what it draws (`game-bridge.js`, `gems.js`, `profile.js`, `career.js`, `settings.js`).
- Small edits to the game's PlayMaker state machines in `Build/slope_data.unityweb`, made with the scripts in `tools/`:
  - steering sets the ball's sideways speed instead of pushing it with a force
  - the main menu gets the Career button
  - the game signals run start, final score and Career clicks to the page through the URL hash

To apply the edits to an original `slope_data.unityweb` (safe to run again):

```bash
pip install UnityPy
python tools/patch_data.py Build/slope_data.unityweb
```
