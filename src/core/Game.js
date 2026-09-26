import * as THREE from 'three';
import { EventBus } from './EventBus.js';
import { Input } from './Input.js';
import { RenderSystem } from '../render/RenderSystem.js';
import { CameraRig } from '../render/CameraRig.js';
import { TextureBank } from '../textures/TextureBank.js';
import { Sky, MOON_DIR } from '../world/Sky.js';
import { Arena } from '../world/Arena.js';
import { TrapDirector } from '../world/TrapDirector.js';
import { Scenery } from '../world/Scenery.js';
import { Effects } from '../fx/Effects.js';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { SwordView } from '../combat/SwordView.js';
import { PlayerCombat } from '../combat/PlayerCombat.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { HUD, roman } from '../ui/HUD.js';
import { Screens } from '../ui/Screens.js';
import { roundRoster, PLAYER } from '../config.js';
import { damp, clamp, rand } from './math.js';

/**
 * Orchestrates systems and the game flow:
 * loading → title (attract camera) → playing ⇄ paused → over.
 */
export class Game {
  constructor() {
    this.bus = new EventBus();
    this.canvas = document.getElementById('view');
    this.render = new RenderSystem(this.canvas);
    this.scene = this.render.scene;
    this.input = new Input(this.canvas, this.bus);
    this.audio = new AudioEngine(this.bus);
    this.hud = new HUD(this.bus);
    this.screens = new Screens(this);
    this.state = 'loading';
    this.time = 0;
    this.clock = 0;
    this.hitstopT = 0;
    this.slowT = 0;
    this.slowScale = 1;
    this.enemies = [];
    this.spawnQueue = [];
    this.round = 0;
    this.roundActive = false;
    this.intermission = 0;
    this.stats = { kills: 0, trapKills: 0, time: 0, round: 0 };
    this.fxState = { damage: 0, dash: 0, aberr: 0, fade: 0 };
    this.last = performance.now();
    this.params = new URLSearchParams(location.search);
  }

  async init() {
    this.textures = await new TextureBank().build(this.render.maxAnisotropy, (p, s) => this.screens.loading(p, s));
    this.sky = new Sky(this.scene, this.textures);
    this.fx = new Effects(this.scene, this.textures);
    this.arena = new Arena(this.scene, this.textures, this.bus, this.fx);
    this.director = new TrapDirector(this.arena, this.bus);
    this.scenery = new Scenery(this.scene, this.textures);
    this.player = new Player(this);
    this.rig = new CameraRig(this.render.camera, this.render.vmCamera);
    this.sword = new SwordView(this.render.vmScene, this.render.vmCamera, this.textures);
    this.combat = new PlayerCombat(this, this.player, this.sword);
    this.setupLights();
    this.setupEnvironment();
    this.setupEvents();
    if (!this.screens.quality) this.render.setQuality(false);

    this.player.reset();
    this.sword.root.visible = false;
    this.render.renderer.compile(this.scene, this.render.camera);
    this.state = 'title';
    this.screens.showTitle();
    this.loop = this.loop.bind(this);
    // ?manual disables the render loop (automated testing drives frames itself)
    if (!this.params.has('manual')) requestAnimationFrame(this.loop);
    if (this.params.has('autoplay')) this.start();
  }

  setupLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x6f6cff, 0x160b2c, 0.42));
    const moon = new THREE.DirectionalLight(0xc2ccff, 1.45);
    moon.position.copy(MOON_DIR).multiplyScalar(45);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const c = moon.shadow.camera;
    c.left = -21;
    c.right = 21;
    c.top = 21;
    c.bottom = -21;
    c.near = 5;
    c.far = 110;
    moon.shadow.bias = -0.0006;
    moon.shadow.normalBias = 0.03;
    moon.shadow.radius = 3;
    s.add(moon, moon.target);
    this.moonLight = moon;
    // violet up-light from the abyss – lights undersides and silhouettes
    const under = new THREE.DirectionalLight(0x9a5cff, 0.6);
    under.position.set(10, -30, 6);
    s.add(under);
    // teal rim from the second moon
    const rim = new THREE.DirectionalLight(0x4fe3d0, 0.4);
    rim.position.set(40, 14, 28);
    s.add(rim);

    const vm = this.render.vmScene;
    vm.add(new THREE.HemisphereLight(0x8a88ff, 0x2a1540, 0.8));
    const vmMoon = new THREE.DirectionalLight(0xd4dcff, 1.8);
    vmMoon.position.copy(MOON_DIR);
    vm.add(vmMoon);
    const vmRim = new THREE.DirectionalLight(0xb07aff, 1.2);
    vmRim.position.set(0.5, -0.6, 0.4);
    vm.add(vmRim);
  }

  /** Image-based lighting from a tiny dream scene so metals have something to reflect. */
  setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.render.renderer);
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(this.sky.dome.geometry, this.sky.dome.material));
    const glowMat = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 12), glowMat(3, 3, 3.6));
    moon.position.copy(MOON_DIR).multiplyScalar(500);
    env.add(moon);
    const panels = [
      [glowMat(0.5, 0.25, 1.1), new THREE.Vector3(0, -400, 0), 900],
      [glowMat(0.1, 0.6, 0.6), new THREE.Vector3(500, 60, 300), 300],
      [glowMat(0.9, 0.45, 0.2), new THREE.Vector3(-400, 20, 400), 160],
    ];
    for (const [m, p, size] of panels) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
      q.position.copy(p);
      q.lookAt(0, 0, 0);
      env.add(q);
    }
    const rt = pmrem.fromScene(env, 0.02, 1, 3000);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.32;
    this.render.vmScene.environment = rt.texture;
    this.render.vmScene.environmentIntensity = 0.6;
    pmrem.dispose();
  }

  setupEvents() {
    const b = this.bus;
    // if the browser refused pointer lock, clicking the view tries again
    this.canvas.addEventListener('mousedown', () => {
      if (this.state === 'playing' && !this.input.locked && !this.params.has('nolock')) this.input.lock();
    });
    b.on('input:unlocked', () => {
      if (this.state === 'playing') this.pause();
    });
    b.on('player:hurt', ({ dir }) => {
      this.fxState.damage = 0.75;
      this.fxState.aberr = 1;
      this.rig.addTrauma(0.55);
      const p = this.player;
      const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      const fwd = p.forward(new THREE.Vector3());
      this.hud.damageFrom(Math.atan2(dir.dot(right), dir.dot(fwd)));
    });
    b.on('player:block', () => {
      this.rig.addTrauma(0.25);
      this.sword.flash(0.8);
      const tip = this.sword.pivot.position;
      this.fx.sparks(this.worldFromView(tip), new THREE.Vector3(0, 0.5, 0), [1.8, 1.4, 0.9], 16, 6);
    });
    b.on('player:parry', ({ attacker }) => {
      this.slowmo(0.3, 0.45);
      this.rig.addTrauma(0.35);
      this.sword.flash(1.5);
      this.fxState.aberr = 1.4;
      this.fx.sparks(attacker.chest, new THREE.Vector3(0, 1, 0), [2, 1.7, 1.0], 36, 9);
      this.fx.shockwave(attacker.body.pos, 2.2, [1.6, 1.3, 0.6], 0.4);
    });
    b.on('player:dash', () => (this.fxState.dash = 1));
    b.on('player:lifeLost', ({ reason }) => {
      if (reason === 'slain') this.slowmo(0.35, 0.6);
    });
    b.on('enemy:hit', () => (this.fxState.aberr = Math.max(this.fxState.aberr, 0.5)));
  }

  worldFromView(v) {
    return v.clone().applyQuaternion(this.render.camera.quaternion).add(this.render.camera.position);
  }

  hitstop(t) {
    this.hitstopT = Math.max(this.hitstopT, t);
  }

  slowmo(scale, t) {
    this.slowScale = scale;
    this.slowT = Math.max(this.slowT, t);
  }

  attackerCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive && e.attacking) n++;
    return n;
  }

  /* ------------------------------------------------------------- flow */

  async start() {
    this.audio.init();
    this.screens.hideAll();
    this.input.enabled = true;
    if (!this.params.has('nolock')) await this.input.lock();
    this.resetRun();
    this.state = 'playing';
    this.hud.show(true);
    this.hud.resetHint();
    setTimeout(() => this.hud.fadeHint(), 14000);
    this.startRound(1);
  }

  restart() {
    this.start();
  }

  pause() {
    this.state = 'paused';
    this.screens.showPause();
    this.input.enabled = false;
  }

  async resume() {
    if (!this.params.has('nolock')) {
      const ok = await this.input.lock();
      // Chrome refuses a re-lock for ~1s after Esc; stay paused and let the player click again
      if (!ok || !this.input.locked) {
        await new Promise((r) => setTimeout(r, 120));
        if (!this.input.locked) return;
      }
    }
    this.screens.hideAll();
    this.input.enabled = true;
    this.last = performance.now();
    this.state = 'playing';
  }

  resetRun() {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    this.spawnQueue.length = 0;
    this.hud.clearEnemies();
    this.stats = { kills: 0, trapKills: 0, time: 0, round: 0 };
    this.player.reset();
    this.combat.reset();
    this.sword.root.visible = true;
    this.director.stop();
    for (const t of this.arena.tiles) t.armed = false;
    this.arena.restoreAll(1.5);
    this.time = 0;
    this.hitstopT = 0;
    this.slowT = 0;
    this.fxState.fade = 0;
  }

  startRound(n) {
    this.round = n;
    this.stats.round = n;
    this.roundActive = true;
    this.intermission = 0;
    this.director.start(n);
    const roster = roundRoster(n);
    roster.forEach((type, k) => this.spawnQueue.push({ type, at: 1.4 + k * 1.1 }));
    this.hud.showBanner(`Dream ${roman(n)}`, n === 1 ? 'the floor is listening' : `${roster.length} phantoms stir`, 2600);
    this.bus.emit('round:start', { round: n });
  }

  spawnEnemy(type) {
    const p = this.player.body.pos;
    let tile = this.arena.randomTile((t) => {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      return t.state === 'solid' && !t.armed && d > 7 && d < 15;
    });
    if (!tile) tile = this.arena.randomTile((t) => t.state === 'solid');
    if (!tile) return;
    const e = new Enemy(this, type, tile.x, tile.z);
    this.enemies.push(e);
    this.fx.essence({ x: tile.x, y: 1, z: tile.z }, new THREE.Color(e.def.glow).toArray(), 40, 0.8);
    this.fx.shockwave({ x: tile.x, y: 0, z: tile.z }, 2.5, new THREE.Color(e.def.glow).toArray(), 0.9);
    this.bus.emit('enemy:spawn', { enemy: e });
  }

  onEnemyKilled(enemy, byTrap) {
    this.stats.kills++;
    if (byTrap) this.stats.trapKills++;
    this.bus.emit('enemy:killed', { enemy, byTrap });
    const remaining = this.enemies.filter((e) => e.alive).length + this.spawnQueue.length;
    if (remaining === 0 && this.roundActive) {
      this.slowmo(0.25, 0.9);
      this.roundActive = false;
      this.intermission = 3.6;
      this.director.stop();
      this.player.health = Math.min(PLAYER.maxHealth, this.player.health + 35);
      setTimeout(() => {
        if (this.state === 'playing' || this.state === 'paused') {
          this.hud.showBanner('The dream deepens', 'lucidity restored', 2200);
          this.bus.emit('round:clear', { round: this.round });
        }
      }, 700);
    }
  }

  gameOver(reason) {
    this.slowmo(0.3, 1.2);
    this.bus.emit('game:over', { reason });
    this.overReason = reason;
    setTimeout(() => {
      this.state = 'over';
      this.input.enabled = false;
      this.input.unlock();
      this.hud.show(false);
      this.director.stop();
      this.screens.showOver(this.stats, reason);
    }, 1500);
  }

  safestTile() {
    let best = null;
    let bestScore = -Infinity;
    for (const t of this.arena.tiles) {
      if (t.state !== 'solid' || t.armed) continue;
      let minE = 14;
      for (const e of this.enemies) if (e.alive) minE = Math.min(minE, Math.hypot(e.body.pos.x - t.x, e.body.pos.z - t.z));
      let n = 0;
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) if (this.arena.grid[t.i + di]?.[t.j + dj]?.state === 'solid') n++;
      const score = minE + n * 0.9 - Math.hypot(t.x, t.z) * 0.3 + rand(0, 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best || { x: 0, z: 0 };
  }

  /* ------------------------------------------------------------- loop */

  loop(now) {
    requestAnimationFrame(this.loop);
    const raw = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += raw;
    let scale = 1;
    if (this.hitstopT > 0) {
      this.hitstopT -= raw;
      scale = 0.05;
    } else if (this.slowT > 0) {
      this.slowT -= raw;
      scale = this.slowScale;
    }
    const dt = raw * scale;

    if (this.state === 'playing' || this.state === 'over') this.update(dt, raw);
    else if (this.state === 'title') this.attract(raw);

    this.sky.update(dt, this.clock, this.render.camera);
    this.scenery.update(this.state === 'paused' ? 0 : dt, this.clock);
    if (this.state !== 'paused') this.fx.update(dt);
    this.updatePost(raw);
    this.render.render(this.clock);
    this.input.endFrame();
  }

  /** Debug/testing: render one frame on demand. */
  debugRender() {
    this.sky.update(0, this.clock, this.render.camera);
    this.updatePost(1 / 60);
    this.render.render(this.clock);
  }

  /** Debug/testing: advance the simulation without rendering (console: somnia.debugStep(5)). */
  debugStep(seconds, dt = 1 / 60) {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      this.clock += dt;
      if (this.state === 'playing' || this.state === 'over') this.update(dt, dt);
      else if (this.state === 'title') this.attract(dt);
      this.fx.update(dt);
      this.input.endFrame();
    }
    return {
      state: this.state,
      time: this.time.toFixed(2),
      player: { hp: this.player.health, lives: this.player.lives, pos: this.player.body.pos.toArray().map((v) => +v.toFixed(2)) },
      enemies: this.enemies.map((e) => `${e.type}:${e.state}:${Math.round(e.hp)}`),
      tiles: this.arena.tiles.reduce((m, t) => ((m[t.state] = (m[t.state] || 0) + 1), m), {}),
      armed: this.arena.tiles.filter((t) => t.armed).length,
    };
  }

  attract(dt) {
    this.time += dt;
    const t = this.clock * 0.045;
    const cam = this.render.camera;
    cam.position.set(Math.sin(t) * 23, 6.5 + Math.sin(this.clock * 0.2) * 1.2, Math.cos(t) * 23);
    cam.lookAt(0, -0.5, 0);
    if (cam.fov !== 62) {
      cam.fov = 62;
      cam.updateProjectionMatrix();
    }
    // the floor dreams on its own
    this.attractT = (this.attractT ?? 1) - dt;
    if (this.attractT <= 0) {
      this.attractT = rand(0.5, 1.2);
      if (this.arena.nonSolidCount() < this.arena.tiles.length * 0.22) {
        const tile = this.arena.randomTile((x) => x.state === 'solid');
        tile?.trigger(Math.random() < 0.2 ? 'pressure' : 'decay', rand(1.2, 2.2));
      }
      const arm = this.arena.randomTile((x) => x.state === 'solid' && !x.armed);
      if (arm && this.arena.tiles.filter((x) => x.armed).length < 10) arm.arm();
    }
    this.arena.voidTime = [3, 6];
    this.arena.update(dt, this.clock);
  }

  update(dt, raw) {
    this.time += dt;
    if (this.state === 'playing') this.stats.time += dt;
    const player = this.player;
    if (this.state === 'playing') {
      player.update(dt, this.input);
      this.combat.update(dt, this.input);
    }
    this.director.update(dt, this.time, { player, enemies: this.enemies });
    this.arena.update(dt, this.clock);

    for (let k = this.spawnQueue.length - 1; k >= 0; k--) {
      const s = this.spawnQueue[k];
      s.at -= dt;
      if (s.at <= 0) {
        this.spawnQueue.splice(k, 1);
        this.spawnEnemy(s.type);
      }
    }
    for (const e of this.enemies) e.update(dt, this.clock);
    this.separate();
    for (let k = this.enemies.length - 1; k >= 0; k--) {
      if (this.enemies[k].removed) {
        this.enemies[k].dispose();
        this.enemies.splice(k, 1);
      }
    }

    if (!this.roundActive && this.intermission > 0 && this.state === 'playing') {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startRound(this.round + 1);
    }

    this.rig.update(dt, player);
    this.sword.update(dt, {
      mouse: player.mouse,
      bob: this.rig.bobOffset,
      dashing: player.dashing,
      landing: this.rig.dip,
    });
    this.sword.root.visible = player.state !== 'dead';
    this.audio.updateListener(player.body.pos.x, player.body.pos.z, player.yaw);
    const alive = this.enemies.filter((e) => e.alive).length + this.spawnQueue.length;
    this.hud.setRound(this.round, alive);
    this.hud.sync(this);
  }

  separate() {
    const p = this.player.body;
    const list = this.enemies.filter((e) => e.alive && e.state !== 'spawn' && e.state !== 'fall');
    for (const e of list) {
      const b = e.body;
      const dx = b.pos.x - p.pos.x;
      const dz = b.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const min = b.radius + p.radius;
      if (d < min && d > 1e-4 && Math.abs(b.pos.y - p.pos.y) < 1.6) {
        const o = (min - d) / d;
        const wp = e.def.mass / (e.def.mass + 1);
        p.pos.x -= dx * o * wp;
        p.pos.z -= dz * o * wp;
        b.pos.x += dx * o * (1 - wp);
        b.pos.z += dz * o * (1 - wp);
      }
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].body;
        const c = list[j].body;
        const dx = c.pos.x - a.pos.x;
        const dz = c.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + c.radius;
        if (d < min && d > 1e-4) {
          const o = ((min - d) / d) * 0.5;
          a.pos.x -= dx * o;
          a.pos.z -= dz * o;
          c.pos.x += dx * o;
          c.pos.z += dz * o;
        }
      }
    }
  }

  updatePost(raw) {
    const fx = this.render.fx;
    const s = this.fxState;
    const p = this.player;
    s.damage = damp(s.damage, 0, 3, raw);
    s.aberr = damp(s.aberr, 0, 5, raw);
    s.dash = damp(s.dash, p?.dashing ? 1 : 0, p?.dashing ? 30 : 7, raw);
    let fade = 0;
    if (p?.state === 'respawning') {
      fade = p.respawnT > 0.55 ? clamp((1.25 - p.respawnT) / 0.5, 0, 1) : clamp(p.respawnT / 0.55, 0, 1);
    }
    s.fade = damp(s.fade, fade, 12, raw);
    const playing = this.state === 'playing' || this.state === 'over';
    fx.uDamage.value = playing ? s.damage : 0;
    fx.uAberration.value = 0.0011 + s.aberr * 0.0045 + (playing ? s.dash * 0.004 : 0);
    fx.uDash.value = playing ? s.dash : 0;
    fx.uLowHealth.value = playing && p.health < 30 && p.alive ? (30 - p.health) / 30 : 0;
    fx.uFade.value = s.fade;
    fx.uWarp.value = playing ? clamp(-p.body.pos.y / 8, 0, 1) + s.fade : 0.3;
  }
}
