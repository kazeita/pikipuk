import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ARENA } from '../config.js';
import { Tile } from './Tile.js';
import { createTileTopMaterial } from './tileMaterial.js';
import { mulberry32 } from '../core/math.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * The circular arena of floating moonstone slabs. Handles tile lookup,
 * support/collision queries for bodies, and forwards tile events to effects.
 */
export class Arena {
  constructor(scene, textures, bus, fx) {
    this.scene = scene;
    this.tex = textures;
    this.bus = bus;
    this.fx = fx;
    this.S = ARENA.tileSize;
    this.N = ARENA.grid;
    this.tiles = [];
    this.grid = [];
    this.timeU = { value: 0 };
    this.voidTime = [6, 9];
    this.pressureWarn = 0.62;
    this.build();
  }

  build() {
    const { S, N } = this;
    const rng = mulberry32(4242);
    const size = S - ARENA.gap;
    const base = new RoundedBoxGeometry(size, ARENA.thickness, size, 3, Math.min(0.07, ARENA.thickness * 0.3));
    // split the slab into a carved-top geometry and a sides geometry sharing attributes
    const idx = base.index ? base.index.array : Array.from({ length: base.attributes.position.count }, (_, k) => k);
    const topGroup = base.groups[2];
    const topIdx = Array.from(idx.slice(topGroup.start, topGroup.start + topGroup.count));
    const sideIdx = [];
    for (const g of base.groups) if (g !== topGroup) sideIdx.push(...idx.slice(g.start, g.start + g.count));
    const shareGeo = (index) => {
      const g = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, base.attributes[k]);
      g.setIndex(index);
      return g;
    };

    const r = this.tex.rock;
    const side = new THREE.MeshStandardMaterial({
      map: r.map,
      normalMap: r.normalMap,
      roughnessMap: r.roughnessMap,
      emissiveMap: r.emissiveMap,
      emissive: new THREE.Color(0.5, 0.75, 1.2),
      emissiveIntensity: 0.9,
      color: new THREE.Color(0.7, 0.72, 0.95),
    });
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // lay out the grid first so we know how many instances each mesh needs
    const cells = [];
    for (let i = 0; i < N; i++) {
      this.grid[i] = [];
      for (let j = 0; j < N; j++) {
        const x = (i - (N - 1) / 2) * S;
        const z = (j - (N - 1) / 2) * S;
        this.grid[i][j] = null;
        if (Math.hypot(x, z) <= ARENA.radius) cells.push({ i, j, x, z, variant: Math.floor(rng() * this.tex.tiles.length) });
      }
    }
    const V = this.tex.tiles.length;
    const counts = new Array(V).fill(0);
    for (const c of cells) c.slot = counts[c.variant]++;

    this.tops = this.tex.tiles.map((set, v) => {
      const geo = shareGeo(topIdx);
      const n = Math.max(1, counts[v]);
      const A = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const B = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aTileA', A);
      geo.setAttribute('aTileB', B);
      const mesh = new THREE.InstancedMesh(geo, createTileTopMaterial(set, this.timeU), n);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { mesh, A, B };
    });
    this.sides = new THREE.InstancedMesh(shareGeo(sideIdx), side, cells.length);
    this.sides.castShadow = true;
    this.sides.receiveShadow = true;
    this.sides.frustumCulled = false;
    this.group.add(this.sides);

    // ghost outlines of fallen tiles: additive, brightness baked into instance colour
    const ghostGeo = new THREE.PlaneGeometry(size, size);
    ghostGeo.rotateX(-Math.PI / 2);
    this.ghosts = new THREE.InstancedMesh(
      ghostGeo,
      new THREE.MeshBasicMaterial({
        map: this.tex.ghostFrame,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      cells.length,
    );
    this.ghosts.frustumCulled = false;
    this.ghosts.renderOrder = 2;
    this.group.add(this.ghosts);
    const black = new THREE.Color(0, 0, 0);

    cells.forEach((c, index) => {
      const uniforms = {
        uCrack: { value: 0 },
        uHeat: { value: 0 },
        uEye: { value: 0 },
        uRune: { value: 1 },
        uInlay: { value: 0.55 + rng() * 0.3 },
        uCrackRot: { value: 0 },
        uReform: { value: 0 },
        uSeed: { value: rng() },
      };
      const rotY = Math.floor(rng() * 4) * (Math.PI / 2);
      const mesh = new THREE.Object3D(); // transform proxy – written into the instance buffers
      mesh.position.set(c.x, -ARENA.thickness / 2, c.z);
      mesh.rotation.y = rotY;
      const ghost = { visible: false, material: { opacity: 0, color: new THREE.Color(0.5, 0.45, 1.0) } };
      _m.makeTranslation(c.x, -0.04, c.z);
      this.ghosts.setMatrixAt(index, _m);
      this.ghosts.setColorAt(index, black);
      const tile = new Tile(this, { i: c.i, j: c.j, x: c.x, z: c.z, mesh, ghost, uniforms, rotY });
      tile.isTile = true;
      tile.index = index;
      tile.variant = c.variant;
      tile.slot = c.slot;
      this.grid[c.i][c.j] = tile;
      this.tiles.push(tile);
    });
    for (const t of this.tiles) {
      t.edge = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([di, dj]) => !this.grid[t.i + di]?.[t.j + dj]);
    }

    // Rock stalactites under every slab (one draw call)
    const stal = new THREE.ConeGeometry(0.95, 2.6, 7, 3);
    stal.rotateX(Math.PI);
    stal.translate(0, -1.3, 0);
    const pos = stal.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      if (y < -0.1 && y > -2.5) {
        pos.setX(k, pos.getX(k) * (0.85 + rng() * 0.3));
        pos.setZ(k, pos.getZ(k) * (0.85 + rng() * 0.3));
      }
    }
    stal.scale(S / 2.5, Math.max(0.5, S / 2.5), S / 2.5);
    stal.computeVertexNormals();
    const stalMat = new THREE.MeshStandardMaterial({
      map: r.map,
      normalMap: r.normalMap,
      emissiveMap: r.emissiveMap,
      emissive: new THREE.Color(0.5, 0.75, 1.3),
      emissiveIntensity: 1.2,
      roughness: 0.9,
    });
    this.stalactites = new THREE.InstancedMesh(stal, stalMat, this.tiles.length);
    this.stalScale = this.tiles.map(() => ({ s: 0.7 + rng() * 0.5, h: 0.6 + rng() * 0.9, r: rng() * Math.PI }));
    this.stalactites.frustumCulled = false;
    this.group.add(this.stalactites);

    // Glowing rim: a thin halo ring just below the arena edge
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA.radius + 1.6, 0.09, 8, 160),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.5, 2.2) }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -1.4;
    this.group.add(halo);
    const tex = this.tex.runeStrip.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14, 1);
    this.haloRunes = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA.radius + 1.6, ARENA.radius + 1.3, 0.9, 160, 1, true),
      new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(0.55, 0.6, 1.9),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.haloRunes.position.y = -2.1;
    this.group.add(this.haloRunes);
  }

  cellOf(x, z) {
    return { i: Math.floor(x / this.S + this.N / 2), j: Math.floor(z / this.S + this.N / 2) };
  }

  tileAt(x, z) {
    const i = Math.floor(x / this.S + this.N / 2);
    const j = Math.floor(z / this.S + this.N / 2);
    return this.grid[i]?.[j] || null;
  }

  solidAt(x, z) {
    const t = this.tileAt(x, z);
    return !!t && t.solid;
  }

  /** A solid tile under the point, or within `r` of it (forgiving edges). */
  support(x, z, r = 0.2) {
    const t = this.tileAt(x, z);
    if (t && t.solid) return t;
    const offs = [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ];
    for (const [dx, dz] of offs) {
      const o = this.tileAt(x + dx, z + dz);
      if (o && o.solid) return o;
    }
    return null;
  }

  /** Hazard score used by the AI: 0 safe … 3 void/edge. */
  hazardAt(x, z) {
    const t = this.tileAt(x, z);
    if (!t) return 3;
    return t.hazard;
  }

  /** Push a body out of solid slabs when it is inside a hole. */
  resolveWalls(pos, radius, height, vel = null) {
    if (pos.y > -0.02 || pos.y + height < -ARENA.thickness) return;
    const { i, j } = this.cellOf(pos.x, pos.z);
    const half = (this.S - ARENA.gap) / 2;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const t = this.grid[i + di]?.[j + dj];
        if (!t || !t.solid) continue;
        const cx = Math.max(t.x - half, Math.min(pos.x, t.x + half));
        const cz = Math.max(t.z - half, Math.min(pos.z, t.z + half));
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d = Math.hypot(dx, dz);
        if (d < radius) {
          if (d > 1e-4) {
            const nx = dx / d;
            const nz = dz / d;
            pos.x = cx + nx * radius;
            pos.z = cz + nz * radius;
            if (vel) {
              const vn = vel.x * nx + vel.z * nz;
              if (vn < 0) {
                vel.x -= nx * vn;
                vel.z -= nz * vn;
              }
            }
          } else {
            // centre is inside the slab (should be rare) – eject toward own cell centre
            const ox = (i + 0.5 - this.N / 2) * this.S;
            const oz = (j + 0.5 - this.N / 2) * this.S;
            pos.x += Math.sign(ox - t.x) * 0.05;
            pos.z += Math.sign(oz - t.z) * 0.05;
          }
        }
      }
    }
  }

  onStep(tile, actor) {
    if (!tile || !tile.isTile) return;
    tile.lastStep = this.timeU.value;
    if (tile.armed && tile.state === 'solid') {
      tile.trigger('pressure', this.pressureWarn);
      this.bus.emit('tile:click', { tile, actor });
    }
  }

  onCollapse(tile) {
    this.fx.tileCollapse(tile);
    this.bus.emit('tile:collapse', { tile });
  }

  onReform(tile) {
    this.fx.tileReform(tile);
  }

  onDust(tile, p) {
    this.fx.tileDust(tile, p);
  }

  nonSolidCount() {
    let n = 0;
    for (const t of this.tiles) if (t.state !== 'solid') n++;
    return n;
  }

  randomTile(filter) {
    const list = this.tiles.filter(filter);
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  tilesNear(x, z, radius, filter = () => true) {
    return this.tiles.filter((t) => Math.hypot(t.x - x, t.z - z) <= radius && filter(t));
  }

  /** Round reset: every missing tile returns on its own staggered delay. */
  restoreAll(spread = 2.4) {
    for (const t of this.tiles) t.restore(0.2 + Math.random() * spread);
  }

  update(dt, time) {
    this.timeU.value = time;
    let ghostDirty = false;
    for (let k = 0; k < this.tiles.length; k++) {
      const t = this.tiles[k];
      t.update(dt, time);
      const top = this.tops[t.variant];
      const u = t.u;
      const a = top.A.array;
      const b = top.B.array;
      const o = t.slot * 4;
      a[o] = u.uCrack.value;
      a[o + 1] = u.uHeat.value;
      a[o + 2] = u.uEye.value;
      a[o + 3] = u.uRune.value;
      b[o] = u.uInlay.value;
      b[o + 1] = u.uCrackRot.value;
      b[o + 2] = u.uReform.value;
      b[o + 3] = u.uSeed.value;

      const g = t.ghost;
      const go = g.visible ? Math.max(0, g.material.opacity) : 0;
      if (go !== t.lastGhost) {
        t.lastGhost = go;
        _c.copy(g.material.color).multiplyScalar(go);
        this.ghosts.setColorAt(k, _c);
        ghostDirty = true;
      }

      if (t.dirty) {
        t.dirty = false;
        const m = t.mesh;
        if (m.visible) {
          m.updateMatrix();
          _m.copy(m.matrix);
        } else {
          _m.makeScale(0, 0, 0);
        }
        top.mesh.setMatrixAt(t.slot, _m);
        top.mesh.instanceMatrix.needsUpdate = true;
        this.sides.setMatrixAt(k, _m);
        this.sides.instanceMatrix.needsUpdate = true;

        const st = this.stalScale[k];
        _e.set(m.rotation.x, m.rotation.y + st.r, m.rotation.z);
        _q.setFromEuler(_e);
        _p.set(m.position.x, m.position.y - ARENA.thickness / 2 + 0.02, m.position.z);
        const vis = m.visible ? 1 : 0;
        _s.set(st.s * vis, st.h * vis, st.s * vis);
        _m.compose(_p, _q, _s);
        this.stalactites.setMatrixAt(k, _m);
        this.stalactites.instanceMatrix.needsUpdate = true;
      }
    }
    for (const top of this.tops) {
      top.A.needsUpdate = true;
      top.B.needsUpdate = true;
    }
    if (ghostDirty) this.ghosts.instanceColor.needsUpdate = true;
    this.haloRunes.rotation.y = time * 0.02;
  }
}
