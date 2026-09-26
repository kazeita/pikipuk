/**
 * Everything a body can stand on or bump into: the arena tiles first, then
 * extra walkable surfaces (bridges, islands) and solid pillars.
 * `support()` returns the surface under a point and leaves its height in `h`.
 */
export class Ground {
  constructor(arena) {
    this.arena = arena;
    this.surfaces = [];
    this.pillars = [];
    this.h = 0;
  }

  addSurface(surface) {
    this.surfaces.push(surface);
    return surface;
  }

  addPillar(x, z, r, bottom = -1, top = 8) {
    this.pillars.push({ x, z, r, bottom, top });
  }

  support(x, z, r = 0.2) {
    const t = this.arena.support(x, z, r);
    if (t) {
      this.h = 0;
      return t;
    }
    for (const s of this.surfaces) {
      const h = s.heightAt(x, z, r);
      if (h !== null) {
        this.h = h;
        return s;
      }
    }
    return null;
  }

  /** 0 safe … 3 void. Used by the knights' steering. */
  hazardAt(x, z) {
    const t = this.arena.tileAt(x, z);
    if (t) return t.hazard;
    for (const s of this.surfaces) if (s.heightAt(x, z, 0) !== null) return 0;
    return 3;
  }

  resolveWalls(pos, radius, height, vel) {
    this.arena.resolveWalls(pos, radius, height, vel);
    for (const p of this.pillars) {
      if (pos.y > p.top || pos.y + height < p.bottom) continue;
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const d = Math.hypot(dx, dz);
      const min = p.r + radius;
      if (d < min && d > 1e-4) {
        const nx = dx / d;
        const nz = dz / d;
        pos.x = p.x + nx * min;
        pos.z = p.z + nz * min;
        if (vel) {
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) {
            vel.x -= nx * vn;
            vel.z -= nz * vn;
          }
        }
      }
    }
  }
}

/** A gently arched walkway from `a` to `b` (x/z points), `halfWidth` wide. */
export class BridgeSurface {
  constructor(a, b, halfWidth, arc) {
    this.ax = a.x;
    this.az = a.z;
    this.dx = b.x - a.x;
    this.dz = b.z - a.z;
    this.len = Math.hypot(this.dx, this.dz);
    this.dx /= this.len;
    this.dz /= this.len;
    this.halfWidth = halfWidth;
    this.arc = arc;
  }

  heightAt(x, z, r = 0) {
    const px = x - this.ax;
    const pz = z - this.az;
    const along = px * this.dx + pz * this.dz;
    if (along < -r - 0.3 || along > this.len + r + 0.3) return null;
    const lateral = Math.abs(px * this.dz - pz * this.dx);
    if (lateral > this.halfWidth + r * 0.5) return null;
    const t = Math.max(0, Math.min(1, along / this.len));
    return this.arc * Math.sin(Math.PI * t);
  }
}

/** A flat round island top. */
export class DiscSurface {
  constructor(x, z, radius, y = 0) {
    this.x = x;
    this.z = z;
    this.radius = radius;
    this.y = y;
  }

  heightAt(x, z, r = 0) {
    return Math.hypot(x - this.x, z - this.z) <= this.radius + r * 0.5 ? this.y : null;
  }
}
