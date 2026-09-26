import * as THREE from 'three';

/**
 * Kinematic capsule used by the player and the knights. Stands on solid
 * tiles, falls through holes, and is walled in by neighbouring slabs once it
 * drops below the floor – so a hole really is a hole.
 */
export class Body {
  constructor(radius = 0.4, height = 1.8) {
    this.radius = radius;
    this.height = height;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.landed = false;
    this.impact = 0;
    this.support = null;
    this.airTime = 0;
    this.prevY = 0;
  }

  place(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.prevY = y;
  }

  integrate(dt, ground, gravity) {
    this.prevY = this.pos.y;
    const wasGrounded = this.grounded;
    this.vel.y -= gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.landed = false;

    const surface = ground.support(this.pos.x, this.pos.z, this.radius * 0.5);
    const h = ground.h;
    // stick to gently descending ground (bridge arcs) instead of hopping off it
    const stick = wasGrounded && this.vel.y <= 0 && this.pos.y - h < 0.3;
    if (surface && this.vel.y <= 0 && this.prevY >= h - 0.32 && (this.pos.y <= h || stick)) {
      if (!wasGrounded) {
        this.landed = true;
        this.impact = -this.vel.y;
      }
      this.pos.y = h;
      this.vel.y = 0;
      this.grounded = true;
      this.support = surface;
    } else {
      this.grounded = false;
      this.support = null;
    }
    ground.resolveWalls(this.pos, this.radius, this.height, this.vel);
    this.airTime = this.grounded ? 0 : this.airTime + dt;
  }
}
