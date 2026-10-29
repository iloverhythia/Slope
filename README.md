## Slope

The Unity engine source and the compiled and deployed version of Slope on Github Pages.

Credit to https://github.com/cgolden15/Slope-Game/ for the source.

### Added in this version

- **Game modes**: Play opens a picker with a moving preview of each mode. Again on the score screen keeps the mode.
  - **Classic**: the game as it is.
  - **Randomizer**: every few seconds a random effect for a short while. Some help (slow motion, gem rain, a gem magnet, double gems, a gem jackpot), some hurt (fast forward, mirrored steering, a blackout around the ball, a wobbling or blurred screen). A banner under the HUD shows the effect and the time left.
  - **Advanced**: every obstacle and slope from the Adventure levels, endlessly, a little closer together and quicker the further the ball gets. A hit is the game's own crash.

- **Settings** (gear, top left): track color presets, a custom color, rainbow mode, the music switch (the game's own sound button is gone), and Auto / Low / High / Ultra graphics. Auto (the default) lowers the resolution when frames are dropped and raises it again when there is time to spare.
- **Sharper graphics**: the game is drawn at full screen resolution or higher, with antialiasing, without changing its menus (`TemplateData/quality.js`).
- **Instant steering**: the ball moves sideways the moment a key is pressed and stops when it is released.
- **Gems** on the track, drawn as part of the game's 3D scene. Roll through them to collect them.
- **Skin shop** (Shop button in the main menu, the gem counter, or the Career screen): 48 ball skins to buy with gems. Each skin has its own color for the ball's speed-up trail, which still only appears on speed up. The previews are drawn once and only the skin under the pointer (or the one you wear) spins, and the game pauses behind the shop, so the page stays smooth.
- **Backgrounds** (the shop's Backgrounds tab): 16 animated skies to buy, from a starfield and a sunset to code rain, a storm and a black hole. They are drawn behind the track (right after the game clears the screen each frame), on the menu and in every run, and line up with where the track meets the horizon. They are drawn into a small image and stretched over the screen, and redrawn less often on a slow device, so they stay cheap.
- **Slope styles** (the shop's Slope tab): other tiles for the world. 19 track styles (grid, chevron, dots, hex, circuit, maze, pixels, stars, ice, rainbow and more) redraw the floor and the tunnel frames; 17 pillar styles (bricks, rings, spiral, target, steps, neon, fire, gold and more) redraw the towers and the red walls and blocks. The game's tile textures are recognised when they are loaded and swapped for the chosen ones as the scene is drawn (not for the ball or the menus).
- **Merge** (the HUD button next to the level, or from the shop): click Spawn 10 times for a ball, then drag a ball onto one of the same level (or click one, then the other) to merge them into the next level. Levels never end, and every level is a secret ball skin to wear in the game. Your best ball makes every gem worth more (+10% a level), each new best level pays gems, and Merge has its own upgrades: Fast hands, Auto clicker, Better balls, Lucky merge, Bigger board and Gem charm.
- **Gem upgrades** (the shop's Upgrades tab): an endless upgrade tree. The centre line raises the gem multiplier (each gem you pick up is worth the multiplier; fractions add up). The side upgrades take turns between Magnet (wider pickup reach, gems drift to the ball), More gems, Lucky (golden gems worth 5), XP and Shop sale (cheaper skins and backgrounds), plus more multiplier; kinds with a limit stop appearing once it is reached. Every 10th tier boosts more, and prices grow 20% a tier.
- **Adventure** button in the main menu: an endless grid of levels. Reach a level's finish line to unlock the next one.
  - **13 obstacles**: blocks, walls with a gap, sliders, lasers, rising pillars, spinners, doors (a wall whose gap slides), pendulums, droppers (blocks that fall where a red mark shows), rams (blocks that charge up and down the slope), spikes, orbiters (blocks circling a post) and slalom gates.
  - **5 other slopes** on stretches of track, each with its own floor and a banner while the ball is on it: a narrow winding trench, lava with a dark path through it, boost (green chevrons; the game runs 1.3 times as fast), ice (a turn slides on for 0.2 s after the key is let go) and wind (the ball drifts one way, about a quarter of full steering, and can be steered against).
  - Levels 1 to 18 bring in one new obstacle or slope each; later levels mix two or three obstacles and often a slope or two, and get a little denser and quicker (about two obstacles every 100 m early on, four to five in late levels). Levels grow longer up to 1000 m and no further.
  - Obstacles are put on the track's real floor (read from the track's geometry) as soon as that part of the track exists, also while the ball is in the air (then on the floor it will land on), and never closer than about a second of travel at the ball's speed.
  - Every obstacle leaves an open lane, and each lane is placed within steering reach of the one before at the ball's current speed, so every level can be beaten. A simulation (a ball with half the game's steering, wind included) gets through every level.
- **Career** button in the main menu: profile, level and stats (score, runs and averages per mode, gems collected and spent, golden gems, longest run, Adventure and Merge progress, what you have collected). Every run earns score x 10 XP.
- In the Claude artifact version you can log in with Claude so your Career follows your account.

### How the game data is changed

The game is a compiled Unity build, so new behavior is added two ways:

- Page scripts in `TemplateData/` read what the game draws and draw into it (`game-bridge.js`, `gems.js`, `skins.js`, `backgrounds.js`, `slopes.js`, `merge.js`, `modes.js`, `upgrades.js`, `adventure.js`, `audio.js`, `profile.js`, `career.js`, `settings.js`). They can also send events to the game's EventManager state machine (start a run, crash the ball, go back to the menu). `steer.js` can change what the game hears from the steering keys (mirrored, sliding on ice, wind gusts).
- Small edits to the game's PlayMaker state machines in `Build/slope_data.unityweb`, made with the scripts in `tools/`:
  - steering sets the ball's sideways speed instead of pushing it with a force
  - the main menu gets Adventure, Shop and Career buttons, in a slightly smaller button style (added to the game's GUI skin) so seven buttons fit
  - the game signals run start, final score, menu button clicks and "menu shown" to the page through the URL hash
  - the game's sound button is switched off (its Image and Button components), since music is in Settings now
  - the Play button asks the page for its game mode picker (#slope-play) instead of starting a run; the page starts the run once a mode is picked

To apply the edits to an original `slope_data.unityweb` (safe to run again):

```bash
pip install UnityPy
python tools/patch_data.py Build/slope_data.unityweb
```
