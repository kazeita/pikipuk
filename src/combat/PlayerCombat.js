import * as THREE from 'three';
import { COMBAT } from '../config.js';
import { damp } from '../core/math.js';

const _to = new THREE.Vector3();

/**
 * The player's sword work: a three-hit combo, dash-thrust, aerial ground
 * slam (which shatters tiles), a kick that launches knights into holes, and
 * block with a tight parry window.
 */
export class PlayerCombat {
  constructor(game, player, view) {
    this.game = game;
    this.player = player;
    this.view = view;
    this.state = 'idle';
    this.t = 0;
    this.def = null;
    this.hitDone = false;
    this.combo = 0;
    this.comboTimer = 0;
    this.buffer = 0;
    this.kickBuffer = 0;
    this.kickCd = 0;
    this.blocking = false;
    this.blockTime = 0;
  }

  get attacking() {
    return this.state !== 'idle';
  }

  reset() {
    this.state = 'idle';
    this.buffer = 0;
    this.kickBuffer = 0;
    this.combo = 0;
    this.blocking = false;
    this.view.anim = null;
    this.view.boot.visible = false;
  }

  forward() {
    const y = this.player.yaw;
    return new THREE.Vector3(-Math.sin(y), 0, -Math.cos(y));
  }

  update(dt, input) {
    const p = this.player;
    this.buffer -= dt;
    this.kickBuffer -= dt;
    this.kickCd -= dt;
    this.comboTimer -= dt;
    if (!p.controllable) {
      this.blocking = false;
      this.view.blockAmt = damp(this.view.blockAmt, 0, 12, dt);
      return;
    }
    if (input.mousePressed[0]) this.buffer = 0.3;
    if (input.wasPressed('KeyF') || input.wasPressed('KeyE') || input.wasPressed('KeyQ')) this.kickBuffer = 0.3;

    const wantBlock = input.mouseDown[2] && this.state === 'idle';
    if (wantBlock && !this.blocking) {
      this.blockTime = 0;
      this.game.bus.emit('player:guard');
    }
    this.blocking = wantBlock;
    if (this.blocking) this.blockTime += dt;
    this.view.blockAmt = damp(this.view.blockAmt, this.blocking ? 1 : 0, 16, dt);

    switch (this.state) {
      case 'idle':
        if (this.kickBuffer > 0 && this.kickCd <= 0) this.startKick();
        else if (this.buffer > 0 && !this.blocking) this.startAttack();
        break;
      case 'attack':
      case 'kick':
        this.t += dt;
        if (!this.hitDone && this.t >= this.def.dur * this.def.hitAt) {
          this.hitDone = true;
          this.resolve(this.def, this.state === 'kick' ? 'kick' : this.def.name === 'thrust' ? 'thrust' : 'slash');
        }
        if (this.state === 'attack' && this.buffer > 0 && this.t >= this.def.dur * 0.6 && this.def.name !== 'thrust') {
          this.state = 'idle';
          this.startAttack(true);
          break;
        }
        if (this.t >= this.def.dur) {
          this.state = 'idle';
          this.comboTimer = COMBAT.comboWindow;
        }
        break;
      case 'slamFall':
        p.body.vel.y = -36;
        p.body.vel.x *= 0.9;
        p.body.vel.z *= 0.9;
        if (p.body.grounded) this.slamImpact();
        else if (p.body.pos.y < -1.5) {
          // missed the floor – you are falling into the dream
          this.state = 'idle';
          this.view.anim = null;
        }
        break;
      case 'slamLand':
        this.t += dt;
        if (this.t > 0.34) this.state = 'idle';
        break;
    }
  }

  startAttack(chained = false) {
    const p = this.player;
    this.buffer = 0;
    const heightAbove = p.body.pos.y;
    if (!p.body.grounded && p.pitch < -0.45 && heightAbove > 0.7) {
      this.state = 'slamFall';
      this.view.holdSlam();
      this.game.bus.emit('player:slamStart');
      return;
    }
    const sinceDash = this.game.time - p.lastDashEnd;
    let def;
    if (p.dashing || sinceDash < COMBAT.dashStrikeWindow) {
      def = COMBAT.thrust;
      const f = this.forward();
      p.body.vel.x += f.x * COMBAT.thrust.lunge;
      p.body.vel.z += f.z * COMBAT.thrust.lunge;
      this.combo = 0;
      this.game.rig.kickFov(8);
    } else {
      if (!chained && this.comboTimer <= 0) this.combo = 0;
      def = COMBAT.combo[this.combo];
      this.combo = (this.combo + 1) % COMBAT.combo.length;
      if (p.body.grounded) {
        const f = this.forward();
        p.body.vel.x += f.x * 2.4;
        p.body.vel.z += f.z * 2.4;
      }
    }
    this.def = def;
    this.state = 'attack';
    this.t = 0;
    this.hitDone = false;
    this.view.play(def.name, def.dur);
    const rig = this.game.rig;
    if (def.name === 'slashR') rig.recoil(0.0, 0.025, -0.03);
    else if (def.name === 'slashL') rig.recoil(0.0, -0.025, 0.03);
    else if (def.name === 'overhead') rig.recoil(-0.035, 0, 0);
    else rig.recoil(-0.01, 0, 0);
    this.game.bus.emit('player:swing', { name: def.name, heavy: def.name !== 'slashR' && def.name !== 'slashL' });
    for (const e of this.game.enemies) e.onPlayerAttack?.(this.player);
  }

  startKick() {
    this.kickBuffer = 0;
    this.kickCd = COMBAT.kick.cooldown;
    this.def = { ...COMBAT.kick, name: 'kick' };
    this.state = 'kick';
    this.t = 0;
    this.hitDone = false;
    this.view.play('kick', COMBAT.kick.dur);
    this.game.rig.recoil(0.02, 0, 0);
    this.game.bus.emit('player:kick');
  }

  resolve(def, kind) {
    const p = this.player;
    const f = this.forward();
    const hits = [];
    for (const e of this.game.enemies) {
      if (!e.hittable) continue;
      _to.subVectors(e.body.pos, p.body.pos);
      const dy = _to.y;
      _to.y = 0;
      const dist = _to.length() - e.radius;
      if (dist > def.range || Math.abs(dy) > 2.3) continue;
      _to.normalize();
      const ang = Math.acos(Math.max(-1, Math.min(1, _to.dot(f))));
      if (ang > def.arc && dist > 0.35) continue;
      // kicks and thrusts send knights where you are looking – aim them at the holes
      const aimed = kind === 'kick' || kind === 'thrust';
      const dir = aimed ? f.clone().multiplyScalar(0.8).addScaledVector(_to, 0.2).normalize() : _to.clone();
      const res = e.takeHit({
        damage: def.damage,
        dir,
        knock: def.knock,
        lift: def.lift ?? (kind === 'kick' ? COMBAT.kick.lift : 1.2),
        kind,
      });
      hits.push({ e, res });
    }
    if (hits.length) {
      const heavy = kind !== 'slash' || def.name === 'overhead';
      this.game.hitstop(heavy ? COMBAT.hitstop * 1.6 : COMBAT.hitstop);
      this.game.rig.addTrauma(heavy ? 0.42 : 0.26);
      this.view.flash(1);
    }
    return hits;
  }

  slamImpact() {
    const p = this.player;
    this.state = 'slamLand';
    this.t = 0;
    this.view.play('slam', 0.42);
    const S = COMBAT.slam;
    const struck = [];
    for (const e of this.game.enemies) {
      if (!e.hittable) continue;
      _to.subVectors(e.body.pos, p.body.pos);
      _to.y = 0;
      const d = _to.length();
      if (d > S.radius + e.radius) continue;
      _to.normalize();
      const falloff = 1 - Math.min(1, d / (S.radius + e.radius)) * 0.5;
      e.takeHit({ damage: S.damage * falloff, dir: _to.clone(), knock: S.knock * falloff, lift: 5, kind: 'slam' });
      struck.push(e);
    }
    const tiles = [];
    if (p.body.support) tiles.push(p.body.support);
    for (const e of struck) {
      const t = this.game.arena.tileAt(e.body.pos.x, e.body.pos.z);
      if (t && !tiles.includes(t)) tiles.push(t);
    }
    this.game.director.slam(tiles);
    this.game.fx.shockwave(p.body.pos, S.radius * 1.2, [0.7, 0.55, 1.9], 0.6);
    this.game.fx.shockwave(p.body.pos, S.radius * 0.7, [1.6, 0.6, 1.8], 0.35);
    this.game.fx.puff(p.body.pos, [0.22, 0.18, 0.34], 22, 6);
    this.game.fx.sparks(new THREE.Vector3(p.body.pos.x, 0.1, p.body.pos.z), new THREE.Vector3(0, 1, 0), [1.2, 0.7, 1.8], 30, 8);
    this.game.rig.addTrauma(0.75);
    this.game.rig.kickFov(-6);
    this.game.hitstop(0.08);
    this.game.bus.emit('player:slam', { hits: struck.length });
  }
}
