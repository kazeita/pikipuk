import * as THREE from 'three';
import { Particles } from './Particles.js';
import { rand, TAU } from '../core/math.js';
import { ARENA } from '../config.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * High-level effects used by gameplay: sparks, dream essence, tile rubble,
 * dust, shockwave rings and reform shimmer.
 */
export class Effects {
  constructor(scene, textures) {
    this.scene = scene;
    this.glow = new Particles(scene, textures.glow, { max: 3500, additive: true });
    this.dust = new Particles(scene, textures.glow, { max: 1400, additive: false });

    // Rubble chunks – instanced, textured with rock
    const geo = new THREE.DodecahedronGeometry(0.22, 0);
    const mat = new THREE.MeshStandardMaterial({
      map: textures.rock.map,
      normalMap: textures.rock.normalMap,
      roughness: 0.9,
      emissive: new THREE.Color(0.9, 0.25, 1.2),
      emissiveIntensity: 0.0,
      flatShading: true,
    });
    this.chunkMax = 260;
    this.chunks = new THREE.InstancedMesh(geo, mat, this.chunkMax);
    this.chunks.frustumCulled = false;
    this.chunks.castShadow = true;
    this.chunkData = Array.from({ length: this.chunkMax }, () => ({
      life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, s: 1,
    }));
    this.chunkCursor = 0;
    for (let i = 0; i < this.chunkMax; i++) {
      _m.makeScale(0, 0, 0);
      this.chunks.setMatrixAt(i, _m);
    }
    scene.add(this.chunks);

    // Shockwave rings
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.9, 1, 96);
    ringGeo.rotateX(-Math.PI / 2);
    for (let k = 0; k < 6; k++) {
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.visible = false;
      scene.add(ring);
      this.rings.push({ mesh: ring, life: 0, max: 1, radius: 1 });
    }
  }

  sparks(pos, dir, color = [1.4, 0.9, 1.8], count = 18, speed = 9) {
    for (let k = 0; k < count; k++) {
      const vx = dir.x * speed * rand(0.3, 1) + rand(-1, 1) * speed * 0.55;
      const vy = dir.y * speed * rand(0.3, 1) + rand(-0.3, 1) * speed * 0.55;
      const vz = dir.z * speed * rand(0.3, 1) + rand(-1, 1) * speed * 0.55;
      this.glow.emit(pos.x, pos.y, pos.z, vx, vy, vz, {
        color: [color[0] * 1.2, color[1] * 1.2, color[2] * 1.2],
        size: rand(0.04, 0.09),
        sizeEnd: 0.0,
        life: rand(0.2, 0.5),
        gravity: 14,
        drag: 2.5,
      });
    }
  }

  essence(pos, color = [0.7, 0.5, 1.4], count = 26, spread = 0.6) {
    for (let k = 0; k < count; k++) {
      this.glow.emit(
        pos.x + rand(-spread, spread),
        pos.y + rand(-spread, spread) * 1.5,
        pos.z + rand(-spread, spread),
        rand(-1.2, 1.2),
        rand(0.5, 3.2),
        rand(-1.2, 1.2),
        { color, size: rand(0.12, 0.3), sizeEnd: 0.02, life: rand(0.7, 1.6), gravity: -0.8, drag: 1.4 },
      );
    }
  }

  puff(pos, color = [0.2, 0.17, 0.3], count = 10, speed = 2.5) {
    for (let k = 0; k < count; k++) {
      const a = rand(0, TAU);
      this.dust.emit(pos.x, pos.y + 0.05, pos.z, Math.cos(a) * speed * rand(0.4, 1), rand(0.2, 1.2), Math.sin(a) * speed * rand(0.4, 1), {
        color,
        size: rand(0.35, 0.7),
        sizeEnd: rand(0.9, 1.5),
        life: rand(0.5, 1.1),
        gravity: -0.3,
        drag: 3,
      });
    }
  }

  chunk(x, y, z, vx, vy, vz, s = 1) {
    const d = this.chunkData[this.chunkCursor];
    this.chunkCursor = (this.chunkCursor + 1) % this.chunkMax;
    Object.assign(d, {
      life: rand(2.2, 3.4), x, y, z, vx, vy, vz,
      rx: rand(0, TAU), ry: rand(0, TAU), rz: rand(0, TAU),
      wx: rand(-8, 8), wy: rand(-8, 8), wz: rand(-8, 8),
      s: s * rand(0.5, 1.4),
    });
  }

  /** Dust sifting from under a cracking tile + tiny sparks from its cracks. */
  tileDust(tile, p) {
    const half = (ARENA.tileSize - ARENA.gap) / 2;
    const n = 1 + Math.floor(p * 3);
    for (let k = 0; k < n; k++) {
      const ex = tile.x + rand(-half, half);
      const ez = tile.z + rand(-half, half);
      this.dust.emit(ex, -ARENA.thickness, ez, rand(-0.2, 0.2), rand(-1.5, -0.4), rand(-0.2, 0.2), {
        color: [0.2, 0.17, 0.3],
        size: rand(0.12, 0.25),
        sizeEnd: 0.5,
        life: rand(0.8, 1.6),
        gravity: 2,
        drag: 1,
      });
      if (Math.random() < 0.35 + p * 0.5) {
        this.glow.emit(tile.x + rand(-half, half) * 0.8, 0.05, tile.z + rand(-half, half) * 0.8, rand(-0.6, 0.6), rand(0.6, 2.2), rand(-0.6, 0.6), {
          color: [2.2, 0.5, 1.8],
          size: rand(0.05, 0.1),
          sizeEnd: 0,
          life: rand(0.3, 0.7),
          gravity: 3,
          drag: 1,
        });
      }
      if (p > 0.55 && Math.random() < 0.25) {
        this.chunk(tile.x + rand(-half, half), -0.1, tile.z + rand(-half, half), rand(-0.3, 0.3), rand(-1, 0), rand(-0.3, 0.3), 0.35);
      }
    }
  }

  tileCollapse(tile) {
    const half = (ARENA.tileSize - ARENA.gap) / 2;
    for (let k = 0; k < 14; k++) {
      const x = tile.x + rand(-half, half);
      const z = tile.z + rand(-half, half);
      this.chunk(x, rand(-0.4, 0.05), z, (x - tile.x) * rand(0.6, 1.8), rand(0, 3), (z - tile.z) * rand(0.6, 1.8), rand(0.7, 1.5));
    }
    for (let k = 0; k < 16; k++) {
      const a = rand(0, TAU);
      this.dust.emit(tile.x + Math.cos(a) * half, 0.1, tile.z + Math.sin(a) * half, Math.cos(a) * rand(0.5, 2.5), rand(0.2, 1.4), Math.sin(a) * rand(0.5, 2.5), {
        color: [0.16, 0.13, 0.26],
        size: rand(0.35, 0.6),
        sizeEnd: rand(1.0, 1.5),
        life: rand(0.8, 1.5),
        gravity: -0.2,
        drag: 2.2,
      });
    }
    this.essence({ x: tile.x, y: 0.2, z: tile.z }, [1.6, 0.4, 1.6], 18, 1.0);
  }

  tileReform(tile) {
    const half = (ARENA.tileSize - ARENA.gap) / 2;
    for (let k = 0; k < 26; k++) {
      const x = tile.x + rand(-half, half);
      const z = tile.z + rand(-half, half);
      this.glow.emit(x, rand(-6, -1), z, 0, rand(4, 9), 0, {
        color: [0.5, 0.8, 1.8],
        size: rand(0.1, 0.22),
        sizeEnd: 0,
        life: rand(0.5, 1.0),
        gravity: 3,
        drag: 1.5,
      });
    }
  }

  shockwave(pos, radius = 4, color = [0.7, 0.6, 1.8], life = 0.55) {
    const r = this.rings.find((x) => x.life <= 0) || this.rings[0];
    r.life = life;
    r.max = life;
    r.radius = radius;
    r.mesh.visible = true;
    r.mesh.position.set(pos.x, pos.y + 0.06, pos.z);
    r.mesh.material.color.setRGB(color[0], color[1], color[2]);
  }

  update(dt) {
    this.glow.update(dt);
    this.dust.update(dt);
    let dirty = false;
    for (let i = 0; i < this.chunkMax; i++) {
      const d = this.chunkData[i];
      if (d.life <= 0) continue;
      dirty = true;
      d.life -= dt;
      d.vy -= 22 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.rx += d.wx * dt;
      d.ry += d.wy * dt;
      d.rz += d.wz * dt;
      const s = d.life > 0 ? d.s * Math.min(1, d.life * 2) : 0;
      _e.set(d.rx, d.ry, d.rz);
      _q.setFromEuler(_e);
      _p.set(d.x, d.y, d.z);
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      this.chunks.setMatrixAt(i, _m);
    }
    if (dirty) this.chunks.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - r.life / r.max;
      const s = 0.4 + t * r.radius;
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = (1 - t) * 0.9;
      if (r.life <= 0) r.mesh.visible = false;
    }
  }
}
