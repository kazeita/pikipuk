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

  integrate(dt, arena, gravity) {
    this.prevY = this.pos.y;
    const wasGrounded = this.grounded;
    this.vel.y -= gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.landed = false;

    const tile = arena.support(this.pos.x, this.pos.z, this.radius * 0.5);
    if (tile && this.pos.y <= 0 && this.prevY >= -0.32 && this.vel.y <= 0) {
      if (!wasGrounded) {
        this.landed = true;
        this.impact = -this.vel.y;
      }
      this.pos.y = 0;
      this.vel.y = 0;
      this.grounded = true;
      this.support = tile;
    } else {
      this.grounded = false;
      this.support = null;
      if (this.pos.y < -0.02) arena.resolveWalls(this.pos, this.radius, this.height, this.vel);
    }
    this.airTime = this.grounded ? 0 : this.airTime + dt;
  }
}
