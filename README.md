## Slope

The Unity engine source and the compiled and deployed version of Slope on Github Pages.

Credit to https://github.com/cgolden15/Slope-Game/ for the source.

### Added in this version

- **Settings** (gear, top left): track color presets, a custom color, rainbow mode, and Auto / Low / High / Ultra graphics. Auto (the default) lowers the resolution when frames are dropped and raises it again when there is time to spare.
- **Sharper graphics**: the game is drawn at full screen resolution or higher, with antialiasing, without changing its menus (`TemplateData/quality.js`).
- **Instant steering**: the ball moves sideways the moment a key is pressed and stops when it is released.
- **Gems** on the track, drawn as part of the game's 3D scene. Roll through them to collect them.
- **Skin shop** (Shop button in the main menu, the gem counter, or the Career screen): 48 ball skins to buy with gems. Each skin has its own color for the ball's speed-up trail, which still only appears on speed up. The previews are drawn once and only the skin under the pointer (or the one you wear) spins, and the game pauses behind the shop, so the page stays smooth.
- **Backgrounds** (the shop's Backgrounds tab): 16 animated skies to buy, from a starfield and a sunset to code rain, a storm and a black hole. They are drawn behind the track (right after the game clears the screen each frame), on the menu and in every run, and line up with where the track meets the horizon. They are drawn into a small image and stretched over the screen, and redrawn less often on a slow device, so they stay cheap.
- **Gem upgrades** (the shop's Upgrades tab): an endless upgrade tree. The centre line raises the gem multiplier (each gem you pick up is worth the multiplier; fractions add up). The side upgrades take turns between Magnet (wider pickup reach, gems drift to the ball), More gems, Lucky (golden gems worth 5), XP and Shop sale (cheaper skins and backgrounds), plus more multiplier; kinds with a limit stop appearing once it is reached. Every 10th tier boosts more, and prices grow 20% a tier.
- **Adventure** button in the main menu: an endless grid of levels. Reach a level's finish line to unlock the next one. Every level has its own obstacles to avoid (blocks, walls with a gap, sliders, lasers, rising pillars, spinners); levels 1 to 6 bring in one new obstacle each, later levels mix them and get denser and faster. Obstacles are put on the track's real floor (read from the track's geometry) only once that part of the track exists. Every obstacle leaves an open lane, and each lane is placed within steering reach of the one before at the ball's current speed, so every level can be beaten.
- **Career** button in the main menu: profile, level and stats. Every run earns score x 10 XP.
- In the Claude artifact version you can log in with Claude so your Career follows your account.

### How the game data is changed

The game is a compiled Unity build, so new behavior is added two ways:

- Page scripts in `TemplateData/` read what the game draws and draw into it (`game-bridge.js`, `gems.js`, `skins.js`, `backgrounds.js`, `upgrades.js`, `adventure.js`, `profile.js`, `career.js`, `settings.js`). They can also send events to the game's EventManager state machine (start a run, crash the ball, go back to the menu).
- Small edits to the game's PlayMaker state machines in `Build/slope_data.unityweb`, made with the scripts in `tools/`:
  - steering sets the ball's sideways speed instead of pushing it with a force
  - the main menu gets Adventure, Shop and Career buttons, in a slightly smaller button style (added to the game's GUI skin) so seven buttons fit
  - the game signals run start, final score, menu button clicks and "menu shown" to the page through the URL hash

To apply the edits to an original `slope_data.unityweb` (safe to run again):

```bash
pip install UnityPy
python tools/patch_data.py Build/slope_data.unityweb
```
