import * as THREE from 'three';
import { BridgeSurface, DiscSurface } from './Ground.js';
import { ARENA } from '../config.js';
import { mulberry32, TAU, damp } from '../core/math.js';

const OUTPOSTS = [
  { angle: 0.9, radius: 6.5, bridge: 12, name: 'Hollow of Lanterns' },
  { angle: 2.75, radius: 5.5, bridge: 10, name: 'Moth Shrine' },
  { angle: 4.3, radius: 7.5, bridge: 14, name: 'Sunken Choir' },
];
const WELL_CHARGE = 45; // lucidity a moonwell gives before it runs dry
const WELL_RECHARGE = 22; // seconds to refill
const WELL_RATE = 9; // lucidity per second while standing in it

/**
 * Walkable islands off the arena edge, each reached by an arched bridge of
 * floating stone planks with glowing rune-chain railings. Each island holds
 * pillars (real cover), crystals, and a moonwell that slowly restores
 * lucidity – no traps out here, but the knights follow you.
 */
export class Outposts {
  constructor(scene, textures, ground, arena, scenery, bus) {
    this.scene = scene;
    this.tex = textures;
    this.ground = ground;
    this.arena = arena;
    this.scenery = scenery;
    this.bus = bus;
    this.rng = mulberry32(9091);
    this.wells = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    const r = textures.rock;
    const tiled = (tex, n) => {
      const t = tex.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(n, n);
      t.needsUpdate = true;
      return t;
    };
    this.plankMat = new THREE.MeshStandardMaterial({
      map: textures.tiles[1].map,
      normalMap: textures.tiles[1].normalMap,
      roughnessMap: textures.tiles[1].roughnessMap,
      color: new THREE.Color(0.85, 0.85, 1.0),
    });
    this.rockTop = new THREE.MeshStandardMaterial({
      map: tiled(r.map, 3),
      normalMap: tiled(r.normalMap, 3),
      roughnessMap: tiled(r.roughnessMap, 3),
      emissiveMap: tiled(r.emissiveMap, 3),
      emissive: new THREE.Color(0.5, 0.8, 1.3),
      emissiveIntensity: 1.1,
      color: new THREE.Color(0.8, 0.82, 1.0),
    });
    this.chainMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.62, 2.0) });
    this.orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.6, 1.3) });

    for (const def of OUTPOSTS) this.build(def);
  }

  /** Walk outward from the centre until the tiles run out. */
  edgeAlong(angle) {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let last = 0;
    for (let d = 0; d < ARENA.radius + ARENA.tileSize * 2; d += 0.1) {
      if (this.arena.tileAt(dx * d, dz * d)) last = d;
    }
    return last;
  }

  build(def) {
    const dx = Math.cos(def.angle);
    const dz = Math.sin(def.angle);
    const start = this.edgeAlong(def.angle) - 0.15;
    const end = start + def.bridge;
    const cx = dx * (end + def.radius - 0.4);
    const cz = dz * (end + def.radius - 0.4);
    const a = { x: dx * start, z: dz * start };
    const b = { x: dx * end, z: dz * end };
    const arc = 0.9;
    const halfWidth = 1.05;
    this.ground.addSurface(new BridgeSurface(a, b, halfWidth, arc));
    this.ground.addSurface(new DiscSurface(cx, cz, def.radius - 0.35));
    this.buildBridge(a, b, arc, halfWidth);
    this.buildIsland(cx, cz, def);
  }

  buildBridge(a, b, arc, halfWidth) {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const dir = new THREE.Vector3((b.x - a.x) / len, 0, (b.z - a.z) / len);
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const yaw = Math.atan2(dir.x, dir.z);
    const heightAt = (t) => arc * Math.sin(Math.PI * t);
    const plankLen = 0.78;
    const step = 0.92;
    const count = Math.floor(len / step);
    const plankGeo = new THREE.BoxGeometry(halfWidth * 2.2, 0.18, plankLen);
    const planks = new THREE.InstancedMesh(plankGeo, this.plankMat, count);
    planks.castShadow = true;
    planks.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count;
      const h = heightAt(t);
      const slope = (arc * Math.PI * Math.cos(Math.PI * t)) / len;
      p.set(a.x + dir.x * t * len, h - 0.09, a.z + dir.z * t * len);
      // tiny dreamlike misalignment so it reads as floating stones, not a floor
      e.set(-Math.atan(slope) + (this.rng() - 0.5) * 0.03, yaw + (this.rng() - 0.5) * 0.06, (this.rng() - 0.5) * 0.04);
      q.setFromEuler(e);
      m.compose(p, q, s);
      planks.setMatrixAt(k, m);
    }
    this.group.add(planks);

    // railings: posts with glowing orbs, joined by sagging rune-chains
    const postGeo = new THREE.CylinderGeometry(0.05, 0.07, 1.0, 8);
    const orbGeo = new THREE.SphereGeometry(0.09, 12, 8);
    const postsPerSide = Math.max(3, Math.round(len / 3));
    const posts = new THREE.InstancedMesh(postGeo, this.scenery.stoneMat, postsPerSide * 2);
    const orbs = new THREE.InstancedMesh(orbGeo, this.orbMat, postsPerSide * 2);
    let n = 0;
    for (const sgn of [-1, 1]) {
      const tops = [];
      for (let k = 0; k < postsPerSide; k++) {
        const t = k / (postsPerSide - 1);
        const h = heightAt(t);
        const base = new THREE.Vector3(a.x + dir.x * t * len, h, a.z + dir.z * t * len).addScaledVector(side, sgn * (halfWidth + 0.08));
        m.makeTranslation(base.x, base.y + 0.5, base.z);
        posts.setMatrixAt(n, m);
        m.makeTranslation(base.x, base.y + 1.05, base.z);
        orbs.setMatrixAt(n, m);
        n++;
        tops.push(new THREE.Vector3(base.x, base.y + 1.0, base.z));
      }
      const pts = [];
      for (let k = 0; k < tops.length - 1; k++) {
        for (let q2 = 0; q2 < 8; q2++) {
          const f = q2 / 8;
          const v = tops[k].clone().lerp(tops[k + 1], f);
          v.y -= Math.sin(Math.PI * f) * 0.28;
          pts.push(v);
        }
      }
      pts.push(tops[tops.length - 1]);
      const chain = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.02, 5), this.chainMat);
      this.group.add(chain);
    }
    this.group.add(posts, orbs);
  }

  buildIsland(cx, cz, def) {
    const R = def.radius;
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    this.group.add(g);

    // walkable top: a thick stone disc
    const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.94, 0.7, 56, 1), [
      this.scenery.rockMat,
      this.rockTop,
      this.scenery.rockMat,
    ]);
    top.position.y = -0.35;
    top.receiveShadow = true;
    top.castShadow = true;
    g.add(top);
    // rocky underside
    const under = new THREE.Mesh(this.scenery.islandGeometry(R * 1.02, R * 2.3, 700 + Math.floor(def.angle * 100)), this.scenery.rockMat);
    under.position.y = -0.95;
    g.add(under);
    this.scenery.addCrystalCluster(g, 0, -R * 1.6, 0, R * 0.2, this.scenery.crystalMat2, true);
    // glowing rim of glyphs
    const tex = this.tex.runeStrip.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.round(R * 2), 1);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.02, R * 0.95, 0.5, 64, 1, true),
      new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(0.5, 0.6, 1.8),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    rim.position.y = -0.3;
    g.add(rim);

    // pillars: cover you can fight around
    const pillars = 3;
    for (let k = 0; k < pillars; k++) {
      const ang = def.angle + Math.PI * 0.35 + (k / pillars) * TAU * 0.8;
      const px = Math.cos(ang) * R * 0.62;
      const pz = Math.sin(ang) * R * 0.62;
      const h = 2.6 + this.rng() * 2.8;
      const broken = this.rng() < 0.4;
      this.scenery.addColumn(g, px, 0, pz, h, broken);
      this.ground.addPillar(cx + px, cz + pz, 0.68, -1, h + 1.2);
    }
    for (let k = 0; k < 3; k++) {
      const ang = this.rng() * TAU;
      const rr = R * (0.45 + this.rng() * 0.35);
      this.scenery.addCrystalCluster(g, Math.cos(ang) * rr, 0, Math.sin(ang) * rr, 0.45 + this.rng() * 0.35, this.rng() < 0.5 ? this.scenery.crystalMat : this.scenery.crystalMat2);
    }

    // moonwell
    const well = new THREE.Group();
    g.add(well);
    const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.16, 10, 40), this.scenery.stoneMat);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = 0.12;
    well.add(rimMesh);
    const u = { uTime: { value: 0 }, uFill: { value: 1 } };
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1.3, 48),
      new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float uTime, uFill; varying vec2 vUv;
          void main() {
            vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
            float swirl = sin(a * 5.0 + r * 9.0 - uTime * 1.6) * 0.5 + 0.5;
            float ripple = sin(r * 22.0 - uTime * 3.0) * 0.5 + 0.5;
            vec3 c = mix(vec3(0.15, 0.25, 0.9), vec3(0.6, 0.95, 1.6), swirl * 0.6 + ripple * 0.25);
            c = mix(vec3(0.05, 0.04, 0.12), c, uFill);
            gl_FragColor = vec4(c * (0.3 + 0.7 * uFill) * (1.0 - smoothstep(0.85, 1.0, r)), 0.92);
          }
        `,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.05;
    well.add(water);
    // (no point light: extra lights make every material in the scene more expensive)
    this.wells.push({ x: cx, z: cz, charge: WELL_CHARGE, u, active: false });
  }

  update(dt, time, player, fx) {
    for (const w of this.wells) {
      w.u.uTime.value = time;
      const inside =
        player.alive && player.body.grounded && Math.hypot(player.body.pos.x - w.x, player.body.pos.z - w.z) < 1.4;
      const healing = inside && w.charge > 0 && player.health < 100;
      if (healing) {
        const amt = Math.min(WELL_RATE * dt, w.charge, 100 - player.health);
        player.health += amt;
        w.charge -= amt;
        if (!w.active) this.bus.emit('well:drink');
        if (Math.random() < dt * 14) fx.essence({ x: player.body.pos.x, y: 0.4, z: player.body.pos.z }, [0.5, 0.9, 1.8], 2, 0.6);
      } else if (!inside) {
        w.charge = Math.min(WELL_CHARGE, w.charge + (WELL_CHARGE / WELL_RECHARGE) * dt);
      }
      w.active = healing;
      const fill = w.charge / WELL_CHARGE;
      w.u.uFill.value = damp(w.u.uFill.value, fill, 4, dt);
    }
  }
}
