import * as THREE from 'three';
import { Body } from './Body.js';
import { PLAYER, COMBAT } from '../config.js';
import { clamp } from '../core/math.js';

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * First-person dreamer. Mouse-look, fast ground movement, two dash charges
 * (with i-frames), jump + double jump, a short glide, and a life system:
 * falling into the abyss or being cut down costs one of three moons.
 */
export class Player {
  constructor(game) {
    this.game = game;
    this.body = new Body(PLAYER.radius, 1.8);
    this.yaw = 0;
    this.pitch = 0;
    this.health = PLAYER.maxHealth;
    this.lives = PLAYER.lives;
    this.state = 'alive';
    this.invuln = 0;
    this.dashT = 0;
    this.dashCharges = PLAYER.dashCharges;
    this.dashRecharge = 0;
    this.dashDir = new THREE.Vector3();
    this.dashLateral = 0;
    this.lastDashEnd = -10;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.usedDouble = false;
    this.glideLeft = PLAYER.glideTime;
    this.gliding = false;
    this.crouch = 0;
    this.falling = false;
    this.respawnT = 0;
    this.mouse = { x: 0, y: 0 };
    this.hurtT = 0;
  }

  get alive() {
    return this.state === 'alive';
  }

  get controllable() {
    return this.state === 'alive';
  }

  get dashing() {
    return this.dashT > 0;
  }

  reset() {
    this.health = PLAYER.maxHealth;
    this.lives = PLAYER.lives;
    this.state = 'alive';
    this.dashCharges = PLAYER.dashCharges;
    this.spawnAt(0, 0, Math.PI * 0.0);
  }

  spawnAt(x, z, yaw = this.yaw) {
    this.body.place(x, 0.05, z);
    this.yaw = yaw;
    this.pitch = -0.05;
    this.invuln = PLAYER.respawnInvuln;
    this.falling = false;
    this.dashT = 0;
    this.usedDouble = false;
    this.glideLeft = PLAYER.glideTime;
  }

  forward(out = _f) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(dt, input) {
    const game = this.game;
    const b = this.body;
    const look = input.consumeMouse();
    this.mouse = look;
    if (this.state !== 'dead') {
      this.yaw -= look.x * 0.0022;
      this.pitch = clamp(this.pitch - look.y * 0.0022, -1.5, 1.45);
    }
    this.invuln -= dt;
    this.hurtT -= dt;

    if (this.state === 'respawning') {
      this.respawnT -= dt;
      b.vel.multiplyScalar(0.9);
      if (this.respawnT <= 0.55 && !this.respawned) {
        this.respawned = true;
        const t = game.safestTile();
        const toCenter = Math.atan2(t.x, t.z);
        this.spawnAt(t.x, t.z, toCenter);
        this.health = PLAYER.maxHealth;
        game.bus.emit('player:respawn');
      }
      if (this.respawnT <= 0) this.state = 'alive';
      return;
    }
    if (this.state === 'dead') return;

    const f = this.forward(_f);
    _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const ax = input.axis('KeyA', 'KeyD');
    const az = input.axis('KeyS', 'KeyW');
    _w.set(0, 0, 0).addScaledVector(f, az).addScaledVector(_r, ax);
    if (_w.lengthSq() > 1) _w.normalize();

    // timers
    this.jumpBuffer -= dt;
    if (input.wasPressed('Space')) this.jumpBuffer = PLAYER.jumpBuffer;
    this.coyote = b.grounded ? PLAYER.coyoteTime : this.coyote - dt;

    // dash charges
    if (this.dashCharges < PLAYER.dashCharges) {
      this.dashRecharge += dt;
      if (this.dashRecharge >= PLAYER.dashRecharge) {
        this.dashRecharge = 0;
        this.dashCharges++;
        game.bus.emit('player:dashReady');
      }
    }
    const combat = game.combat;
    if ((input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight')) && this.dashCharges > 0 && this.dashT <= 0) {
      const dir = _w.lengthSq() > 0.01 ? _w.clone().normalize() : f.clone();
      this.dashDir.copy(dir);
      this.dashT = PLAYER.dashTime;
      this.dashCharges--;
      this.dashRecharge = Math.min(this.dashRecharge, PLAYER.dashRecharge * 0.3);
      this.invuln = Math.max(this.invuln, PLAYER.dashTime + 0.08);
      this.dashLateral = dir.dot(_r);
      if (!b.grounded) b.vel.y = Math.max(b.vel.y, 1.5);
      game.rig.kickFov(14);
      game.bus.emit('player:dash', { dir });
    }

    let gravity = PLAYER.gravity;
    this.gliding = false;
    if (this.dashT > 0) {
      this.dashT -= dt;
      b.vel.x = this.dashDir.x * PLAYER.dashSpeed;
      b.vel.z = this.dashDir.z * PLAYER.dashSpeed;
      if (!b.grounded) gravity = 4;
      if (this.dashT <= 0) {
        this.lastDashEnd = game.time;
        b.vel.x *= 0.5;
        b.vel.z *= 0.5;
      }
    } else if (combat.state !== 'slamFall') {
      const slow = (combat.attacking ? 0.85 : 1) * (combat.blocking ? 0.55 : 1);
      const speed = PLAYER.moveSpeed * slow;
      const tx = _w.x * speed;
      const tz = _w.z * speed;
      const accel = b.grounded ? PLAYER.groundAccel : PLAYER.airAccel;
      if (b.grounded || _w.lengthSq() > 0.01) {
        let dx = tx - b.vel.x;
        let dz = tz - b.vel.z;
        const dl = Math.hypot(dx, dz);
        const maxd = accel * dt;
        if (dl > maxd) {
          dx *= maxd / dl;
          dz *= maxd / dl;
        }
        b.vel.x += dx;
        b.vel.z += dz;
      }
    } else {
      gravity = 0;
    }

    // jump / double jump
    if (this.jumpBuffer > 0 && combat.state !== 'slamFall') {
      if (b.grounded || this.coyote > 0) {
        b.vel.y = PLAYER.jumpVel;
        b.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        game.bus.emit('player:jump', { double: false });
      } else if (!this.usedDouble) {
        b.vel.y = PLAYER.doubleJumpVel;
        this.usedDouble = true;
        this.jumpBuffer = 0;
        game.fx.shockwave(b.pos, 1.6, [0.5, 0.7, 1.8], 0.4);
        game.fx.essence(b.pos, [0.5, 0.8, 1.8], 10, 0.4);
        game.bus.emit('player:jump', { double: true });
      }
    }

    // glide: hold Space while falling after the double jump
    if (!b.grounded && b.vel.y < 0 && this.usedDouble && input.isDown('Space') && this.glideLeft > 0 && this.dashT <= 0) {
      gravity *= PLAYER.glideGravityScale;
      b.vel.y = Math.max(b.vel.y, -3.2);
      this.glideLeft -= dt;
      this.gliding = true;
    }

    b.integrate(dt, game.arena, gravity);

    if (b.landed) {
      this.usedDouble = false;
      this.glideLeft = PLAYER.glideTime;
      game.rig.land(b.impact);
      game.bus.emit('player:land', { impact: b.impact });
      if (b.impact > 11) game.fx.puff(b.pos, [0.22, 0.18, 0.34], 8, 3);
    }
    if (b.grounded) game.arena.onStep(b.support, this);

    if (!this.falling && b.pos.y < -2.2) {
      this.falling = true;
      game.bus.emit('player:fall');
    }
    if (b.pos.y > -0.5) this.falling = false;
    if (b.pos.y < PLAYER.fallDeathY) this.loseLife('fall');
  }

  /** Enemy strike landed (or was blocked/parried/dodged). */
  takeHit(damage, attacker) {
    if (this.state !== 'alive') return 'none';
    if (this.invuln > 0) {
      this.game.bus.emit('player:dodge');
      return 'dodged';
    }
    const toA = new THREE.Vector3().subVectors(attacker.body.pos, this.body.pos);
    toA.y = 0;
    toA.normalize();
    const facing = toA.dot(this.forward(new THREE.Vector3()));
    const combat = this.game.combat;
    if (combat.blocking && facing > COMBAT.block.frontalDot) {
      if (combat.blockTime <= COMBAT.block.parryWindow) {
        this.game.bus.emit('player:parry', { attacker });
        return 'parried';
      }
      this.health -= damage * (1 - COMBAT.block.reduction);
      this.body.vel.addScaledVector(toA, -4.5);
      this.game.bus.emit('player:block', { attacker });
      if (this.health <= 0) this.loseLife('slain');
      return 'blocked';
    }
    this.health -= damage;
    this.hurtT = 0.35;
    this.body.vel.addScaledVector(toA, -7);
    this.body.vel.y = Math.max(this.body.vel.y, 3.2);
    this.body.grounded = false;
    this.game.bus.emit('player:hurt', { damage, attacker, dir: toA });
    if (this.health <= 0) this.loseLife('slain');
    return 'hit';
  }

  loseLife(reason) {
    if (this.state !== 'alive') return;
    this.lives--;
    this.game.bus.emit('player:lifeLost', { reason, lives: this.lives });
    if (this.lives <= 0) {
      this.state = 'dead';
      this.game.gameOver(reason);
      return;
    }
    this.state = 'respawning';
    this.respawnT = 1.25;
    this.respawned = false;
  }
}
