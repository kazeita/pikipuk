import { damp, easeOutBack, easeOutCubic, lerp, rand } from '../core/math.js';
import { ARENA } from '../config.js';

const REFORM_TIME = 1.15;
const FALL_TIME = 2.6;

/**
 * One floating slab of the arena. Every tile runs its own state machine, so
 * tiles fall one by one, each with its own telegraph:
 *
 *   solid ─(trigger)→ warning ─→ collapsing ─→ void ─→ reforming ─→ solid
 *
 * `armed` marks a hidden pressure trap: it looks solid, its sleeping eye
 * glows faintly, and it springs the moment anyone steps on it.
 */
export class Tile {
  constructor(arena, { i, j, x, z, mesh, ghost, uniforms, rotY }) {
    this.arena = arena;
    this.i = i;
    this.j = j;
    this.x = x;
    this.z = z;
    this.mesh = mesh;
    this.ghost = ghost;
    this.u = uniforms;
    this.rotY = rotY;
    this.state = 'solid';
    this.t = 0;
    this.warnDur = 1;
    this.voidDur = 6;
    this.cause = null;
    this.armed = false;
    this.y = 0;
    this.vy = 0;
    this.spin = { x: 0, y: 0, z: 0 };
    this.rot = { x: 0, y: 0, z: 0 };
    this.baseRune = 0.75 + Math.random() * 0.45;
    this.crackleT = 0;
    this.dustT = 0;
    this.delay = 0; // pending reform delay (round resets)
    this.dirty = true;
    this.lastStep = -10;
  }

  get solid() {
    return (
      this.state === 'solid' ||
      this.state === 'warning' ||
      (this.state === 'collapsing' && this.t < 0.05) ||
      (this.state === 'reforming' && this.t > REFORM_TIME * 0.82)
    );
  }

  /** 0 = safe, 1..2 = cracking (higher = closer to falling), 3 = gone. */
  get hazard() {
    if (this.state === 'solid') return 0;
    if (this.state === 'warning') return 1 + this.t / this.warnDur;
    if (this.state === 'reforming' && this.t > REFORM_TIME * 0.82) return 0.5;
    return 3;
  }

  get progress() {
    return this.state === 'warning' ? this.t / this.warnDur : 0;
  }

  arm() {
    if (this.state !== 'solid' || this.armed) return false;
    this.armed = true;
    return true;
  }

  trigger(cause, duration) {
    if (this.state !== 'solid') return false;
    this.state = 'warning';
    this.t = 0;
    this.cause = cause;
    this.warnDur = duration;
    this.crackleT = 0.05;
    this.u.uCrackRot.value = Math.floor(Math.random() * 4) * (Math.PI / 2) + (Math.random() < 0.5 ? 0 : 0.35);
    this.arena.bus.emit('tile:warn', { tile: this, cause });
    return true;
  }

  collapse() {
    this.state = 'collapsing';
    this.t = 0;
    this.armed = false;
    this.vy = -1.2;
    this.spin = { x: rand(-1.6, 1.6), y: rand(-0.8, 0.8), z: rand(-1.6, 1.6) };
    this.ghost.visible = true;
    this.ghost.material.opacity = 0;
    this.voidDur = rand(...this.arena.voidTime);
    this.arena.onCollapse(this);
  }

  reform() {
    this.state = 'reforming';
    this.t = 0;
    this.y = -9;
    this.mesh.visible = true;
    this.rot = { x: rand(-0.6, 0.6), y: rand(-0.6, 0.6), z: rand(-0.6, 0.6) };
    this.arena.bus.emit('tile:reform', { tile: this });
    this.arena.onReform(this);
  }

  /** Round reset: bring the tile back after a short, individual delay. */
  restore(delay) {
    this.armed = false;
    if (this.state === 'warning') {
      this.state = 'solid';
      this.t = 0;
      return;
    }
    if (this.state === 'void' || this.state === 'collapsing') {
      this.state = 'void';
      this.mesh.visible = false;
      this.ghost.visible = true;
      this.t = 0;
      this.voidDur = delay;
    }
  }

  update(dt, time) {
    const u = this.u;
    const half = ARENA.thickness / 2;
    this.t += dt;
    switch (this.state) {
      case 'solid': {
        u.uCrack.value = damp(u.uCrack.value, 0, 6, dt);
        u.uHeat.value = damp(u.uHeat.value, 0, 4, dt);
        u.uReform.value = damp(u.uReform.value, 0, 4, dt);
        const eyeTarget = this.armed ? 0.11 + Math.sin(time * 1.7 + this.i * 1.3 + this.j) * 0.05 : 0;
        u.uEye.value = damp(u.uEye.value, eyeTarget, 3, dt);
        u.uRune.value = damp(u.uRune.value, this.baseRune, 3, dt);
        if (this.y !== 0 || this.dirty) {
          this.y = 0;
          this.mesh.position.set(this.x, -half, this.z);
          this.mesh.rotation.set(0, this.rotY, 0);
          this.dirty = true;
        }
        break;
      }
      case 'warning': {
        const p = Math.min(1, this.t / this.warnDur);
        u.uCrack.value = 0.06 + 0.94 * Math.pow(p, 1.25);
        u.uHeat.value = p;
        const eyeTarget = this.cause === 'pressure' ? 1.6 : 0.2 + p * 1.0;
        u.uEye.value = damp(u.uEye.value, eyeTarget, 18, dt);
        u.uRune.value = this.baseRune * (1 + p * 1.1 * (0.55 + 0.45 * Math.sin(time * (12 + p * 34))));
        const amp = 0.008 + p * p * 0.075;
        this.mesh.position.set(
          this.x + (Math.random() - 0.5) * amp * 2,
          -half - p * p * 0.12 + (Math.random() - 0.5) * amp,
          this.z + (Math.random() - 0.5) * amp * 2,
        );
        this.mesh.rotation.set((Math.random() - 0.5) * amp * 0.6, this.rotY, (Math.random() - 0.5) * amp * 0.6);
        this.dirty = true;
        this.crackleT -= dt;
        if (this.crackleT <= 0) {
          this.crackleT = lerp(0.32, 0.06, p) * rand(0.6, 1.4);
          this.arena.bus.emit('tile:crackle', { tile: this, p });
        }
        this.dustT -= dt;
        if (this.dustT <= 0) {
          this.dustT = lerp(0.25, 0.05, p);
          this.arena.onDust(this, p);
        }
        if (p >= 1) this.collapse();
        break;
      }
      case 'collapsing': {
        this.vy -= 24 * dt;
        this.y += this.vy * dt;
        this.rot.x += this.spin.x * dt;
        this.rot.y += this.spin.y * dt;
        this.rot.z += this.spin.z * dt;
        this.mesh.position.set(this.x, -half + this.y, this.z);
        this.mesh.rotation.set(this.rot.x, this.rotY + this.rot.y, this.rot.z);
        u.uCrack.value = 1;
        u.uHeat.value = damp(u.uHeat.value, 0.3, 2, dt);
        u.uRune.value = damp(u.uRune.value, 0, 2, dt);
        u.uEye.value = damp(u.uEye.value, 0, 3, dt);
        this.ghost.material.opacity = Math.min(0.22, this.t * 0.4);
        this.dirty = true;
        if (this.t > FALL_TIME) {
          this.state = 'void';
          this.t = 0;
          this.mesh.visible = false;
        }
        break;
      }
      case 'void': {
        const left = this.voidDur - this.t;
        const pre = left < 1.4 ? 1 - left / 1.4 : 0;
        this.ghost.material.opacity = 0.1 + Math.sin(time * 2.2 + this.i + this.j * 0.7) * 0.05 + pre * 0.55;
        this.ghost.material.color.setRGB(0.5 + pre * 0.6, 0.45 + pre * 0.5, 1.0 + pre * 0.4);
        if (left <= 0) this.reform();
        break;
      }
      case 'reforming': {
        const p = Math.min(1, this.t / REFORM_TIME);
        const e = easeOutBack(p, 1.3);
        this.y = lerp(-9, 0, e);
        const k = 1 - easeOutCubic(p);
        this.mesh.position.set(this.x, -half + this.y, this.z);
        this.mesh.rotation.set(this.rot.x * k, this.rotY + this.rot.y * k, this.rot.z * k);
        u.uCrack.value = 1 - p;
        u.uHeat.value = 0;
        u.uReform.value = (1 - p) * 1.6 + 0.2;
        u.uRune.value = this.baseRune * (1 + (1 - p) * 2);
        u.uEye.value = 0;
        this.ghost.material.opacity = (1 - p) * 0.5;
        this.dirty = true;
        if (p >= 1) {
          this.state = 'solid';
          this.t = 0;
          this.ghost.visible = false;
          this.y = 0;
        }
        break;
      }
    }
  }
}

export { REFORM_TIME };
