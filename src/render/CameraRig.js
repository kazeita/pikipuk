import { damp, clamp } from '../core/math.js';
import { PLAYER } from '../config.js';

/**
 * First-person camera feel: head bob, strafe roll, landing dip, FOV kicks,
 * trauma-based shake and recoil impulses. Drives both the world camera and
 * the view-model camera so the sword stays glued to the view.
 */
export class CameraRig {
  constructor(camera, vmCamera) {
    this.camera = camera;
    this.vmCamera = vmCamera;
    this.trauma = 0;
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.roll = 0;
    this.dip = 0;
    this.dipVel = 0;
    this.fovKick = 0;
    this.fov = PLAYER.baseFov;
    this.baseFov = PLAYER.baseFov;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.rollKick = 0;
    this.t = 0;
  }

  addTrauma(a) {
    this.trauma = clamp(this.trauma + a, 0, 1);
  }

  kickFov(a) {
    this.fovKick = Math.max(this.fovKick, a);
  }

  land(impact) {
    this.dipVel -= clamp(impact * 0.045, 0, 0.6);
  }

  recoil(pitch, yaw = 0, roll = 0) {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    this.rollKick += roll;
  }

  update(dt, player) {
    this.t += dt;
    const speed = Math.hypot(player.body.vel.x, player.body.vel.z);
    const grounded = player.body.grounded;

    // head bob
    const targetAmp = grounded && !player.dashing ? clamp(speed / 7.5, 0, 1.2) : 0;
    this.bobAmp = damp(this.bobAmp, targetAmp, 10, dt);
    this.bobPhase += dt * (4 + speed * 1.15);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.055 * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * 0.03 * this.bobAmp;

    // landing spring
    this.dipVel += (-this.dip * 140 - this.dipVel * 16) * dt;
    this.dip += this.dipVel * dt;

    // strafe roll: tilt into sideways motion
    const sinY = Math.sin(player.yaw);
    const cosY = Math.cos(player.yaw);
    const lateral = player.body.vel.x * cosY - player.body.vel.z * sinY;
    const targetRoll = -lateral * 0.0075 + (player.dashing ? -player.dashLateral * 0.06 : 0);
    this.roll = damp(this.roll, targetRoll, 8, dt);
    this.rollKick = damp(this.rollKick, 0, 9, dt);

    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const t = this.t * 38;
    const shakeP = s * 0.05 * (Math.sin(t * 1.13) + Math.sin(t * 2.31) * 0.5);
    const shakeY = s * 0.05 * (Math.sin(t * 0.97 + 3) + Math.sin(t * 2.07 + 1) * 0.5);
    const shakeR = s * 0.06 * Math.sin(t * 1.41 + 7);

    this.recoilPitch = damp(this.recoilPitch, 0, 12, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 12, dt);

    // FOV: speed + dash + kicks
    this.fovKick = damp(this.fovKick, 0, 6, dt);
    const speedFov = clamp((speed - 7) * 0.5, 0, 8);
    const targetFov = this.baseFov + speedFov + this.fovKick;
    this.fov = damp(this.fov, targetFov, 10, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    const p = player.body.pos;
    this.camera.position.set(
      p.x + bobX * cosY,
      p.y + PLAYER.eyeHeight - bobY + this.dip - player.crouch * 0.4,
      p.z - bobX * sinY,
    );
    this.camera.rotation.set(
      player.pitch + shakeP + this.recoilPitch,
      player.yaw + shakeY + this.recoilYaw,
      this.roll + shakeR + this.rollKick,
    );
    this.vmCamera.quaternion.copy(this.camera.quaternion);
    this.vmCamera.position.set(0, 0, 0);
    this.bobOffset = { x: bobX, y: bobY, phase: this.bobPhase, amp: this.bobAmp };
  }
}
