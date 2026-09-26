# Somnia — The Nocturne Arena

A first-person sword duel on a floating, dreaming arena at night. Every tile
beneath you is a trap waiting to happen. Built with three.js and Vite; every
texture, model and sound is generated procedurally at startup, so there are no
asset files.

## Run

```bash
npm install
npm run dev        # opens http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

Requires Node 20.19+ (Vite 7). Click **Enter the dream** to lock the mouse; press
**Esc** to pause.

## Controls

| Input | Action |
| --- | --- |
| WASD / Mouse | Move / look |
| LMB | Strike (3-hit combo: right, left, overhead finisher) |
| Shift then LMB | Dash (2 charges, i-frames); strike right after = lunge thrust |
| RMB | Guard; raise it just as a blow lands to **parry** (staggers, slows time) |
| F (or E/Q) | Kick. Knights fly where you look, so aim them at holes |
| Space | Jump, double jump; hold while falling to glide |
| In air, look down + LMB | Ground slam: shockwave, and shatters the tiles under you and under struck knights |

## The traps

Tiles never vanish together. Each slab runs its own state machine
(`src/world/Tile.js`):

`solid → warning (cracks grow, trembles, dust, crackle) → collapsing → void (ghost outline) → reforming`

The `TrapDirector` (`src/world/TrapDirector.js`) fires one trigger at a time on a
randomised clock and caps how much of the floor can be missing at once:

- **Decay**: a random tile cracks slowly, sometimes near you, sometimes near a knight.
- **Hunter**: the tile where you're about to be. Standing still is dangerous.
- **Fuse**: a short line of tiles cracks in sequence.
- **Pressure**: hidden armed tiles. Look for the faint violet *eye* in the
  medallion. Step on one and it clicks, the eye blazes, and you have about 0.6s.
  Knights can't see them either.
- **Slam**: your own ground slam shatters tiles.

Crackles, clicks and collapses are positional, so you can hear the floor fail behind you.

## Architecture

```
src/
  main.js                 entry
  config.js               all tuning: arena, movement, combat, trap pacing, enemy types, rounds
  core/      Game.js      flow (title → playing ⇄ paused → over), loop, hitstop/slow-mo
             Input.js     keyboard/mouse + pointer lock
             EventBus.js  pub/sub between systems (audio + HUD only listen)
             math.js
  render/    RenderSystem.js   renderer, world + view-model scenes, post chain
             DreamShader.js    aberration, dash blur, grade, vignette, damage, grain, fades
             CameraRig.js      bob, strafe roll, landing dip, FOV kicks, trauma shake
             patchMaterial.js  GLSL injection into standard materials
  textures/  TextureBank.js    builds everything at load
             stoneTile.js      carved moonstone: albedo/normal/roughness/rune/crack maps
             library.js        rock, engraved armour, star cloth, porcelain masks, damascus blade, moon…
  world/     Arena.js, Tile.js, TrapDirector.js, tileMaterial.js, Sky.js, Scenery.js
  entities/  Body.js (shared capsule physics), Player.js, Enemy.js (AI), EnemyModel.js
  combat/    PlayerCombat.js, SwordView.js, SwordTrail.js, weapons.js
  fx/        Effects.js, Particles.js
  audio/     AudioEngine.js    WebAudio music-box ambience + synthesized SFX
  ui/        HUD.js, Screens.js
```

Debug helpers (browser console): `somnia.debugStep(seconds)` advances the
simulation, and `?autoplay` in the URL skips the title screen.
