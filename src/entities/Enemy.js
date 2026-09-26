import * as THREE from 'three';
import { Body } from './Body.js';
import { EnemyModel } from './EnemyModel.js';
import { ENEMY_TYPES, MAX_SIMULTANEOUS_ATTACKERS, COMBAT } from '../config.js';
import { rand, chance, angleDiff, clamp } from '../core/math.js';

const MASK = { knight: 0, lancer: 1, warden: 2 };
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _best = new THREE.Vector3();

/**
 * Dream-knight AI. Circles, telegraphs (weapon flares), lunges, blocks and
 * dodges. It reads the floor: it flees cracking tiles, steers around holes
 * and will leap a single gap to reach you – but it cannot see the hidden
 * pressure traps, and a well-placed kick sends it into the abyss.
 */
export class Enemy {
  constructor(game, typeKey, x, z) {
    this.game = game;
    this.type = typeKey;
    this.def = { ...ENEMY_TYPES[typeKey], maskIndex: MASK[typeKey] };
    const d = this.def;
    this.body = new Body(0.42 * d.scale, 1.9 * d.scale);
    this.body.place(x, 0, z);
    this.radius = this.body.radius;
    this.hp = d.hp;
    this.maxHp = d.hp;
    this.model = new EnemyModel(this.def, game.textures);
    game.scene.add(this.model.root);
    this.state = 'spawn';
    this.t = 0;
    this.yaw = Math.atan2(-x, -z);
    this.cooldown = rand(1.0, 2.2);
    this.circleDir = chance(0.5) ? 1 : -1;
    this.circleSwitch = rand(1.5, 3.5);
    this.alive = true;
    this.removed = false;
    this.lastHitT = -10;
    this.hitstunDur = 0.2;
    this.staggerDur = 1;
    this.spawnDur = 1.3;
    this.struck = false;
    this.jumpCd = 0;
    this.engage = d.reach * 0.85;
    this.byTrap = false;
    this.move = new THREE.Vector3();
    this.lean = 0;
    this.updateModel(0);
  }

  get hittable() {
    return this.alive && this.state !== 'spawn' && this.state !== 'fall' && this.state !== 'dying';
  }

  get attacking() {
    return this.state === 'windup' || this.state === 'strike';
  }

  get chest() {
    return new THREE.Vector3(this.body.pos.x, this.body.pos.y + 1.35 * this.def.scale, this.body.pos.z);
  }

  facing(out = _v) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  setState(s) {
    this.state = s;
    this.t = 0;
  }

  onPlayerAttack(player) {
    if (!this.alive || (this.state !== 'approach' && this.state !== 'circle')) return;
    _d.subVectors(player.body.pos, this.body.pos);
    _d.y = 0;
    const dist = _d.length();
    if (dist > 3.8) return;
    _d.normalize();
    if (_d.dot(this.facing()) < 0.4) return;
    if (chance(this.def.blockChance)) {
      this.setState('block');
      this.game.bus.emit('enemy:guard', { enemy: this });
      return;
    }
    if (chance(this.def.dodgeChance)) {
      const side = chance(0.5) ? 1 : -1;
      const sx = _d.z * side;
      const sz = -_d.x * side;
      const tx = this.body.pos.x + sx * 2.4;
      const tz = this.body.pos.z + sz * 2.4;
      if (this.game.ground.hazardAt(tx, tz) === 0) {
        this.body.vel.x = sx * 11;
        this.body.vel.z = sz * 11;
        this.setState('dodge');
        this.game.bus.emit('enemy:dodge', { enemy: this });
      }
    }
  }

  stagger(dur) {
    if (!this.alive) return;
    this.staggerDur = dur;
    this.setState('stagger');
    this.model.flash(0.8);
    this.game.bus.emit('enemy:stagger', { enemy: this });
  }

  takeHit({ damage, dir, knock, lift = 1.2, kind }) {
    if (!this.hittable) return 'none';
    const game = this.game;
    const d = this.def;
    const guarding = this.state === 'block' && this.facing().dot(_v.copy(dir).negate()) > 0.3;
    const hitPos = this.chest;
    if (guarding) {
      if (kind === 'kick' || kind === 'slam') {
        this.hp -= damage * 0.5;
        this.stagger(1.3);
        game.bus.emit('enemy:guardbreak', { enemy: this, pos: hitPos });
      } else {
        this.hp -= damage * 0.15;
        this.body.vel.addScaledVector(dir, 3 / d.mass);
        game.fx.sparks(hitPos, _v.copy(dir).negate().setY(0.4), [1.8, 1.5, 1.0], 22, 7);
        game.bus.emit('enemy:blocked', { enemy: this, pos: hitPos });
        this.model.flash(0.3);
        return 'blocked';
      }
    } else {
      this.hp -= damage;
    }
    this.model.flash(1);
    this.lastHitT = game.time;
    const k = knock / d.mass;
    if (kind === 'kick' || kind === 'slam') {
      this.body.vel.x *= 0.2;
      this.body.vel.z *= 0.2;
    }
    this.body.vel.x += dir.x * k;
    this.body.vel.z += dir.z * k;
    if (k > 5 || kind === 'kick' || kind === 'slam') {
      this.body.vel.y = Math.max(this.body.vel.y, lift / Math.sqrt(d.mass) + 1.2);
      this.body.grounded = false;
    }
    const armored = this.type === 'warden' && (this.state === 'windup' || this.state === 'strike') && kind === 'slash';
    if (!armored && this.state !== 'stagger') {
      this.hitstunDur = kind === 'kick' ? 0.7 : kind === 'slam' ? 0.9 : k > 6 ? 0.45 : 0.24;
      this.setState('hitstun');
    }
    game.fx.sparks(hitPos, _v.copy(dir).setY(0.35), [1.3, 0.9, 1.9], 16, 9);
    game.fx.essence(hitPos, new THREE.Color(d.glow).toArray().map((c) => c * 1.3), 10, 0.3);
    game.bus.emit('enemy:hit', { enemy: this, damage, kind, pos: hitPos });
    if (this.hp <= 0) this.die(false);
    return 'hit';
  }

  die(byTrap) {
    if (!this.alive) return;
    this.alive = false;
    this.byTrap = byTrap;
    if (this.state !== 'fall') this.setState('dying');
    this.game.onEnemyKilled(this, byTrap);
  }

  /** Pick the steering direction closest to `want` that avoids holes and cracking tiles. */
  steer(want) {
    const len = want.length();
    if (len < 0.05) return want.set(0, 0, 0);
    const arena = this.game.ground;
    const p = this.body.pos;
    _d.copy(want).divideScalar(len);
    let bestScore = -Infinity;
    for (let k = 0; k <= 16; k++) {
      let x;
      let z;
      if (k === 16) {
        x = _d.x;
        z = _d.z;
      } else {
        const a = (k / 16) * Math.PI * 2;
        x = Math.sin(a);
        z = Math.cos(a);
      }
      let score = x * _d.x + z * _d.z;
      const h1 = arena.hazardAt(p.x + x * 1.0, p.z + z * 1.0);
      const h2 = arena.hazardAt(p.x + x * 2.1, p.z + z * 2.1);
      score -= h1 >= 3 ? 5 : h1 >= 1 ? h1 * 1.2 : 0;
      score -= h2 >= 3 ? 1.4 : h2 >= 1 ? h2 * 0.4 : 0;
      for (const o of this.game.enemies) {
        if (o === this || !o.alive) continue;
        const dx = o.body.pos.x - (p.x + x);
        const dz = o.body.pos.z - (p.z + z);
        const dd = dx * dx + dz * dz;
        if (dd < 2.5) score -= (2.5 - dd) * 0.5;
      }
      if (score > bestScore) {
        bestScore = score;
        _best.set(x, 0, z);
      }
    }
    return want.copy(_best).multiplyScalar(Math.min(1, len));
  }

  update(dt, time) {
    const game = this.game;
    const d = this.def;
    const b = this.body;
    const player = game.player;
    const arena = game.arena;
    this.t += dt;
    this.cooldown -= dt;
    this.jumpCd -= dt;

    const toP = new THREE.Vector3().subVectors(player.body.pos, b.pos);
    toP.y = 0;
    const dist = toP.length();
    const dirP = dist > 0.001 ? toP.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);
    const move = this.move.set(0, 0, 0);
    let speedMul = 1;
    let turn = 7;
    let face = dirP;
    let control = true;

    switch (this.state) {
      case 'spawn':
        this.model.setDissolve(1 - Math.min(1, this.t / this.spawnDur));
        control = false;
        if (this.t >= this.spawnDur) {
          this.model.setDissolve(0);
          this.setState('approach');
        }
        break;
      case 'approach':
        move.copy(dirP);
        if (dist < this.engage + 0.6) this.setState('circle');
        break;
      case 'circle': {
        if (this.t > this.circleSwitch) {
          this.circleSwitch = this.t + rand(1.2, 3.2);
          if (chance(0.5)) this.circleDir *= -1;
        }
        const radial = clamp((dist - this.engage) * 0.9, -1, 1);
        move.set(dirP.z * this.circleDir, 0, -dirP.x * this.circleDir).multiplyScalar(0.75).addScaledVector(dirP, radial);
        speedMul = 0.62;
        if (dist > this.engage + 3.5) this.setState('approach');
        if (
          this.cooldown <= 0 &&
          dist < d.reach + 1.3 &&
          game.attackerCount() < MAX_SIMULTANEOUS_ATTACKERS &&
          player.alive &&
          player.body.pos.y > -0.6
        ) {
          this.setState('windup');
          game.bus.emit('enemy:windup', { enemy: this });
        }
        break;
      }
      case 'windup':
        if (this.type === 'warden') move.copy(dirP).multiplyScalar(0.25);
        turn = this.type === 'lancer' ? 7 : 4.5;
        if (this.t >= d.windup) {
          this.setState('strike');
          this.struck = false;
          const f = this.facing();
          const lunge = this.type === 'lancer' ? 13 : this.type === 'warden' ? 6 : 9;
          b.vel.x = f.x * lunge;
          b.vel.z = f.z * lunge;
          game.bus.emit('enemy:strike', { enemy: this });
        }
        break;
      case 'strike': {
        turn = 1.2;
        control = false;
        if (!this.struck && this.t >= 0.07) {
          this.struck = true;
          const f = this.facing();
          const dy = Math.abs(player.body.pos.y - b.pos.y);
          if (dist <= d.reach + 0.45 && dirP.dot(f) > 0.4 && dy < 1.7) {
            const res = player.takeHit(d.damage, this);
            if (res === 'parried') this.stagger(COMBAT.block.parryStagger);
            else if (res === 'blocked') b.vel.addScaledVector(f, -4);
          }
        }
        if (this.t >= 0.34 && this.state === 'strike') this.setState('recover');
        break;
      }
      case 'recover':
        control = false;
        if (this.t >= d.recover) {
          this.cooldown = rand(...d.cooldown);
          this.setState('circle');
        }
        break;
      case 'block':
        move.copy(dirP).multiplyScalar(-0.3);
        speedMul = 0.5;
        if (this.t >= 0.8) this.setState('circle');
        break;
      case 'dodge':
        control = false;
        if (this.t >= 0.3) this.setState('circle');
        break;
      case 'hitstun':
        control = false;
        if (this.t >= this.hitstunDur) this.setState('circle');
        break;
      case 'stagger':
        control = false;
        turn = 0;
        if (this.t >= this.staggerDur) {
          this.cooldown = Math.max(this.cooldown, 0.6);
          this.setState('circle');
        }
        break;
      case 'fall':
        control = false;
        turn = 0;
        this.model.setDissolve(clamp((-b.pos.y - 4) / 12, 0, 0.9));
        if (b.pos.y < -16) {
          if (this.alive) this.die(true);
          this.removed = true;
        }
        break;
      case 'dying':
        control = false;
        turn = 0;
        this.model.setDissolve(Math.min(1, this.t / 1.1));
        if (Math.random() < 0.6) game.fx.essence(this.chest, new THREE.Color(d.glow).toArray(), 2, 0.5);
        if (this.t >= 1.15) this.removed = true;
        break;
    }

    // panic: standing on a cracking tile – run for solid stone
    if (b.grounded && control !== false && this.alive && this.state !== 'spawn') {
      const hz = game.ground.hazardAt(b.pos.x, b.pos.z);
      if (hz >= 1) {
        const safe = arena.tilesNear(b.pos.x, b.pos.z, 5.5, (t) => t.hazard === 0).sort(
          (a, c) => Math.hypot(a.x - b.pos.x, a.z - b.pos.z) - Math.hypot(c.x - b.pos.x, c.z - b.pos.z),
        )[0];
        if (safe) {
          move.set(safe.x - b.pos.x, 0, safe.z - b.pos.z).normalize();
          speedMul = 1.35;
          if (this.state === 'windup') this.setState('circle');
        }
      }
    }

    // leap a single gap to reach the player
    if (b.grounded && this.jumpCd <= 0 && (this.state === 'approach' || this.state === 'circle') && dist > 2.8) {
      const h1 = game.ground.hazardAt(b.pos.x + dirP.x * 1.4, b.pos.z + dirP.z * 1.4);
      const h2 = game.ground.hazardAt(b.pos.x + dirP.x * 3.1, b.pos.z + dirP.z * 3.1);
      if (h1 >= 3 && h2 === 0 && Math.random() < dt * 3) {
        b.vel.x = dirP.x * d.speed * 1.2;
        b.vel.z = dirP.z * d.speed * 1.2;
        b.vel.y = 8.4;
        b.grounded = false;
        this.jumpCd = 1.4;
        game.bus.emit('enemy:leap', { enemy: this });
      }
    }

    // movement
    if (b.grounded) {
      if (control && this.alive) {
        this.steer(move);
        const tx = move.x * d.speed * speedMul;
        const tz = move.z * d.speed * speedMul;
        const acc = 34 * dt;
        let dx = tx - b.vel.x;
        let dz = tz - b.vel.z;
        const dl = Math.hypot(dx, dz);
        if (dl > acc) {
          dx *= acc / dl;
          dz *= acc / dl;
        }
        b.vel.x += dx;
        b.vel.z += dz;
      } else {
        const fr = Math.exp(-(this.state === 'strike' ? 5 : 7) * dt);
        b.vel.x *= fr;
        b.vel.z *= fr;
      }
    }

    b.integrate(dt, game.ground, 24);
    if (b.grounded && this.alive) arena.onStep(b.support, this);
    if (!b.grounded && b.pos.y < -1.0 && this.state !== 'fall' && this.state !== 'dying') {
      if (this.state === 'windup' || this.state === 'strike') this.cooldown = 1;
      this.setState('fall');
      game.bus.emit('enemy:fall', { enemy: this });
    }

    if (turn > 0 && face) {
      const target = Math.atan2(face.x, face.z);
      const diff = angleDiff(this.yaw, target);
      this.yaw += clamp(diff, -turn * dt, turn * dt);
    }
    const sp = Math.hypot(b.vel.x, b.vel.z);
    this.lean = clamp(sp / 8, 0, 1) * (this.state === 'approach' ? 1 : 0.4);
    this.updateModel(dt, time, sp);
  }

  updateModel(dt, time = 0, speed = 0) {
    const r = this.model.root;
    r.position.copy(this.body.pos);
    r.rotation.y = this.yaw;
    if (this.state === 'fall') {
      r.rotation.x += dt * 1.5;
      r.rotation.z += dt * 0.9;
    }
    if (dt > 0) this.model.update(dt, { speed, state: this.state, time, lean: this.lean });
  }

  dispose() {
    this.game.scene.remove(this.model.root);
    this.model.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    for (const m of this.model.materials) m.dispose();
  }
}
