import * as THREE from 'three';
import { buildWeapon, createWeaponMaterials } from './weapons.js';
import { SwordTrail } from './SwordTrail.js';
import { damp, easeInOutSine, easeOutCubic, clamp, lerp } from '../core/math.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

function quatFrom(dir, flat, out) {
  _y.copy(dir).normalize();
  _z.copy(flat).addScaledVector(_y, -flat.dot(_y)).normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

function pose(pos, dir, flat) {
  return { pos: pos.clone(), quat: quatFrom(dir, flat, new THREE.Quaternion()) };
}

const IDLE = pose(new THREE.Vector3(0.44, -0.44, -0.64), V(-0.16, 0.7, -0.7), V(0.75, 0.1, 0.8));
const BLOCK = pose(new THREE.Vector3(0.2, -0.2, -0.5), V(-1, 0.22, -0.3), V(0, 0.4, 1));
const KICK = pose(new THREE.Vector3(0.5, -0.46, -0.34), V(0.35, 0.85, 0.2), V(0, 0, 1));
const SLAM_HOLD = pose(new THREE.Vector3(0.2, -0.02, -0.42), V(0.2, 1, -0.1), V(1, 0, 0.2));
const THRUST_BACK = pose(new THREE.Vector3(0.28, -0.3, -0.26), V(-0.1, 0.12, -1), V(0, 1, 0));
const THRUST_OUT = pose(new THREE.Vector3(0.08, -0.2, -0.88), V(-0.04, 0.06, -1), V(0, 1, 0));

/** Swing arcs: blade direction sweeps from e1 toward e2 inside their plane. */
function arc(e1, e2, from, to, center, reach, w, s) {
  const a = e1.clone().normalize();
  const b = e2.clone().addScaledVector(a, -e2.dot(a)).normalize();
  const n = new THREE.Vector3().crossVectors(a, b);
  return { a, b, n, from, to, center, reach, w, s };
}
const ARCS = {
  slashR: arc(V(0.85, 0.48, -0.3), V(-0.1, 0.0, -1), -0.12, 3.0, new THREE.Vector3(0.06, -0.27, -0.52), 0.3, 0.3, 0.58),
  slashL: arc(V(-0.85, 0.52, -0.3), V(0.1, 0.0, -1), -0.12, 3.0, new THREE.Vector3(0.1, -0.27, -0.52), 0.3, 0.3, 0.58),
  overhead: arc(V(0.25, 1, -0.2), V(0, -0.1, -1), -0.05, 2.35, new THREE.Vector3(0.1, -0.2, -0.46), 0.26, 0.38, 0.64),
  slam: arc(V(0.2, 1, -0.15), V(0, -0.1, -1), -0.05, 2.45, new THREE.Vector3(0.06, -0.2, -0.46), 0.26, 0.0, 0.32),
};

function arcPose(def, theta, out) {
  const d = new THREE.Vector3().copy(def.a).multiplyScalar(Math.cos(theta)).addScaledVector(def.b, Math.sin(theta));
  out.pos.copy(def.center).addScaledVector(d, def.reach);
  quatFrom(d, def.n, out.quat);
  return out;
}

function blend(a, b, t, out) {
  out.pos.copy(a.pos).lerp(b.pos, t);
  out.quat.copy(a.quat).slerp(b.quat, t);
  return out;
}

/**
 * The first-person sword: moonsteel blade, gold guard, gauntleted hand and
 * forearm, a kicking boot, a light that travels with the blade and an
 * additive trail during swings.
 */
export class SwordView {
  constructor(vmScene, vmCamera, textures) {
    this.root = new THREE.Group();
    vmCamera.add(this.root);

    const mats = createWeaponMaterials(textures, 0x7ad8ff);
    this.mats = mats;
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.sword = buildWeapon('sword', mats, 0.8);
    this.pivot.add(this.sword);

    const armor = new THREE.MeshStandardMaterial({
      map: textures.armor.map,
      normalMap: textures.armor.normalMap,
      roughnessMap: textures.armor.roughnessMap,
      emissiveMap: textures.armor.emissiveMap,
      emissive: new THREE.Color(0.35, 0.6, 1.4),
      emissiveIntensity: 0.9,
      metalness: 0.85,
      roughness: 1,
      color: 0xb8b4d8,
    });
    this.armorMat = armor;
    // gauntlet wrapped around the grip
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, 0.075), armor);
    palm.position.set(0.012, 0, 0.004);
    const fingers = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.06, 4, 8), armor);
    fingers.rotation.z = Math.PI / 2;
    fingers.position.set(-0.012, -0.005, 0.03);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.04, 4, 8), armor);
    thumb.position.set(-0.03, 0.03, -0.025);
    thumb.rotation.x = 0.8;
    const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.02), mats.gold);
    knuckle.position.set(-0.01, 0.0, 0.055);
    hand.add(palm, fingers, thumb, knuckle);
    this.pivot.add(hand);

    // forearm (oriented each frame from hand toward the shoulder anchor)
    this.forearm = new THREE.Group();
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.06, 1, 12), armor);
    fore.position.y = 0.5;
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 6, 16), mats.gold);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.06;
    const rune = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 6, 20), mats.gem);
    rune.rotation.x = Math.PI / 2;
    rune.position.y = 0.3;
    this.forearm.add(fore, cuff, rune);
    this.foreMesh = fore;
    this.root.add(this.forearm);
    this.shoulder = new THREE.Vector3(0.46, -0.78, 0.1);

    // boot for kicks
    this.boot = new THREE.Group();
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), armor);
    shin.position.y = 0.2;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.3), armor);
    foot.position.set(0, -0.06, -0.08);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.32), mats.gold);
    sole.position.set(0, -0.13, -0.08);
    this.boot.add(shin, foot, sole);
    this.boot.visible = false;
    this.root.add(this.boot);

    // blade light
    this.light = new THREE.PointLight(0x7ad8ff, 0.6, 2.2, 2);
    this.root.add(this.light);

    this.trail = new SwordTrail(this.root);

    this.current = { pos: IDLE.pos.clone(), quat: IDLE.quat.clone() };
    this.from = { pos: IDLE.pos.clone(), quat: IDLE.quat.clone() };
    this.target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.tmpA = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.tmpB = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.anim = null;
    this.blockAmt = 0;
    this.sway = { x: 0, y: 0, r: 0 };
    this.time = 0;
    this.glow = 0;
    this.prevTip = null;
    this.prevBase = null;
  }

  play(name, dur) {
    this.from.pos.copy(this.current.pos);
    this.from.quat.copy(this.current.quat);
    this.anim = { name, t: 0, dur };
    this.prevTip = null;
    if (name === 'kick') this.boot.visible = true;
  }

  holdSlam() {
    this.play('slamHold', 0.18);
  }

  flash(amount = 1) {
    this.glow = Math.max(this.glow, amount);
  }

  computeTarget(dt) {
    const a = this.anim;
    const out = this.target;
    let trailing = false;
    if (!a) {
      blend(IDLE, BLOCK, this.blockAmt, out);
      return false;
    }
    a.t += dt;
    const p = clamp(a.t / a.dur, 0, 1);
    const arcDef = ARCS[a.name];
    if (arcDef) {
      if (p < arcDef.w) {
        arcPose(arcDef, arcDef.from, this.tmpA);
        blend(this.from, this.tmpA, easeOutCubic(p / arcDef.w), out);
      } else if (p < arcDef.s) {
        const q = easeInOutSine((p - arcDef.w) / (arcDef.s - arcDef.w));
        arcPose(arcDef, lerp(arcDef.from, arcDef.to, q), out);
        trailing = true;
      } else {
        arcPose(arcDef, arcDef.to, this.tmpA);
        blend(this.tmpA, IDLE, easeInOutSine((p - arcDef.s) / (1 - arcDef.s)), out);
      }
    } else if (a.name === 'thrust') {
      if (p < 0.18) blend(this.from, THRUST_BACK, easeOutCubic(p / 0.18), out);
      else if (p < 0.42) {
        blend(THRUST_BACK, THRUST_OUT, easeOutCubic((p - 0.18) / 0.24), out);
        trailing = true;
      } else if (p < 0.6) blend(THRUST_OUT, THRUST_OUT, 0, out);
      else blend(THRUST_OUT, IDLE, easeInOutSine((p - 0.6) / 0.4), out);
    } else if (a.name === 'kick') {
      blend(this.from, KICK, easeOutCubic(Math.min(1, p / 0.2)), this.tmpA);
      blend(this.tmpA, IDLE, p > 0.65 ? easeInOutSine((p - 0.65) / 0.35) : 0, out);
      // boot punches forward out of the bottom of the view
      const k = p < 0.35 ? easeOutCubic(p / 0.35) : 1 - easeInOutSine((p - 0.35) / 0.65);
      this.boot.position.set(0.02, lerp(-1.05, -0.5, k), lerp(-0.15, -0.95, k));
      this.boot.rotation.set(lerp(0.2, -1.25, k), 0.1, 0);
      if (p >= 1) this.boot.visible = false;
    } else if (a.name === 'slamHold') {
      blend(this.from, SLAM_HOLD, easeOutCubic(p), out);
      if (p >= 1) {
        a.t = a.dur; // hold
        return false;
      }
    }
    if (p >= 1 && a.name !== 'slamHold') this.anim = null;
    return trailing;
  }

  update(dt, { mouse, bob, dashing, landing }) {
    this.time += dt;
    const trailing = this.computeTarget(dt);

    this.sway.x = damp(this.sway.x, clamp(-mouse.x * 0.0011, -0.07, 0.07), 9, dt);
    this.sway.y = damp(this.sway.y, clamp(mouse.y * 0.0011, -0.06, 0.06), 9, dt);
    this.sway.r = damp(this.sway.r, clamp(-mouse.x * 0.004, -0.2, 0.2), 8, dt);

    // follow the target closely during animations, softly otherwise
    const k = this.anim ? 1 : 1 - Math.exp(-14 * dt);
    this.current.pos.lerp(this.target.pos, k);
    this.current.quat.slerp(this.target.quat, k);

    const breathe = Math.sin(this.time * 1.7) * 0.006;
    this.pivot.position.copy(this.current.pos);
    this.pivot.position.x += this.sway.x + (bob?.x || 0) * 0.5;
    this.pivot.position.y += this.sway.y + breathe - (bob?.y || 0) * 0.6 + (landing || 0) * 0.5;
    this.pivot.position.z += dashing ? 0.08 : 0;
    this.pivot.quaternion.copy(this.current.quat);
    this.pivot.rotateZ(this.sway.r);

    // forearm from hand toward shoulder anchor
    const hand = this.pivot.position;
    const dir = new THREE.Vector3().subVectors(this.shoulder, hand);
    const len = Math.min(0.55, dir.length());
    dir.normalize();
    this.forearm.position.copy(hand);
    this.forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.foreMesh.scale.y = len;
    this.foreMesh.position.y = len / 2;

    // trail sampling (sub-stepped so fast arcs stay smooth)
    const tip = this.sword.userData.tip.clone().applyQuaternion(this.pivot.quaternion).add(this.pivot.position);
    const base = this.sword.userData.base.clone().lerp(this.sword.userData.tip, 0.5).applyQuaternion(this.pivot.quaternion).add(this.pivot.position);
    if (trailing) {
      if (this.prevTip) {
        for (let s = 1; s <= 4; s++) {
          const t = s / 4;
          this.trail.push(this.prevBase.clone().lerp(base, t), this.prevTip.clone().lerp(tip, t));
        }
      } else this.trail.push(base, tip);
      this.prevTip = tip;
      this.prevBase = base;
    } else {
      this.prevTip = null;
    }
    this.trail.update(dt);

    this.glow = damp(this.glow, 0, 5, dt);
    const g = 1.8 + this.glow * 1.4 + (trailing ? 0.6 : 0);
    this.mats.blade.emissiveIntensity = g;
    this.light.position.copy(tip).lerp(base, 0.5);
    this.light.intensity = 0.15 + this.glow * 0.6 + (trailing ? 0.25 : 0);
  }
}
