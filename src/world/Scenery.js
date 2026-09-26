import * as THREE from 'three';
import { Noise } from '../textures/noise.js';
import { mulberry32, TAU } from '../core/math.js';

/**
 * Everything around the arena: drifting rock islands with ruins and
 * crystals, an inverted island hanging overhead, a spiral stair to nowhere,
 * armillary rune rings orbiting the arena, rising paper lanterns (two of
 * which carry real lights across the tiles) and a cloud of dream motes.
 */
export class Scenery {
  constructor(scene, textures) {
    this.scene = scene;
    this.tex = textures;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.islands = [];
    this.rng = mulberry32(777);

    this.rockMat = new THREE.MeshStandardMaterial({
      map: textures.rock.map,
      normalMap: textures.rock.normalMap,
      roughnessMap: textures.rock.roughnessMap,
      emissiveMap: textures.rock.emissiveMap,
      emissive: new THREE.Color(0.5, 0.8, 1.2),
      emissiveIntensity: 1.3,
      normalScale: new THREE.Vector2(1.4, 1.4),
    });
    this.stoneMat = new THREE.MeshStandardMaterial({
      map: textures.tiles[0].map,
      normalMap: textures.tiles[0].normalMap,
      roughnessMap: textures.tiles[0].roughnessMap,
    });
    this.runeBandMat = new THREE.MeshBasicMaterial({
      map: textures.runeStrip,
      color: new THREE.Color(0.5, 0.75, 1.8),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.crystalMat = new THREE.MeshStandardMaterial({
      color: 0x6a5cff,
      emissive: new THREE.Color(0.35, 0.25, 1.4),
      emissiveIntensity: 1.6,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88,
      flatShading: true,
    });
    this.crystalMat2 = this.crystalMat.clone();
    this.crystalMat2.color = new THREE.Color(0x4fe3d0);
    this.crystalMat2.emissive = new THREE.Color(0.1, 0.9, 0.8);

    this.buildIslands();
    this.buildInvertedIsland();
    this.buildStair();
    this.buildRings();
    this.buildLanterns();
    this.buildMotes();
  }

  islandGeometry(radius, depth, seed) {
    const geo = new THREE.IcosahedronGeometry(1, 4);
    const noise = new Noise(seed);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const ang = Math.atan2(v.z, v.x);
      const edge = noise.fbm(ang * 1.5 + 10, v.y * 2, 3);
      if (v.y > 0.1) {
        const k = 1 + (edge - 0.5) * 0.35;
        v.x *= radius * k;
        v.z *= radius * k;
        v.y = 0.1 * radius * 0.12 + (noise.fbm(v.x * 0.2, v.z * 0.2, 3) - 0.5) * radius * 0.08;
      } else {
        const t = Math.max(0, -v.y);
        const taper = 1 - Math.pow(t, 1.4) * 0.85;
        const jag = 1 + (noise.ridged(ang * 3, v.y * 4, 3) - 0.4) * 0.5;
        v.x *= radius * taper * jag;
        v.z *= radius * taper * jag;
        v.y = -Math.pow(t, 0.9) * depth * (0.8 + noise.fbm(v.x * 0.3 + 5, v.z * 0.3, 3) * 0.6);
      }
      pos.setXYZ(i, v.x, v.y, v.z);
      uv[i * 2] = ((ang / TAU + 0.5) * radius) / 6;
      uv[i * 2 + 1] = v.y / 6;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
  }

  addCrystalCluster(parent, x, y, z, scale, mat, down = false) {
    const count = 3 + Math.floor(this.rng() * 4);
    for (let i = 0; i < count; i++) {
      const h = (0.8 + this.rng() * 1.6) * scale;
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.35 * scale, 0), mat);
      c.scale.set(1, h / (0.35 * scale), 1);
      c.position.set(x + (this.rng() - 0.5) * scale * 1.3, y + (down ? -h * 0.5 : h * 0.5), z + (this.rng() - 0.5) * scale * 1.3);
      c.rotation.set((this.rng() - 0.5) * 0.7, this.rng() * TAU, (this.rng() - 0.5) * 0.7);
      parent.add(c);
    }
  }

  addColumn(parent, x, y, z, h, broken) {
    const col = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, h, 14, 1), this.stoneMat);
    shaft.position.y = h / 2 + 0.4;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.4, 1.7), this.stoneMat);
    base.position.y = 0.2;
    col.add(shaft, base);
    if (!broken) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 1.6), this.stoneMat);
      cap.position.y = h + 0.62;
      col.add(cap);
    }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.35, 24, 1, true), this.runeBandMat);
    band.position.y = h * 0.62;
    col.add(band);
    col.position.set(x, y, z);
    if (broken) col.rotation.z = (this.rng() - 0.5) * 0.35;
    parent.add(col);
    return col;
  }

  buildIslands() {
    const defs = [
      { r: 9, d: 16, dist: 58, ang: 0.3, y: -6, ruins: 'arch' },
      { r: 6, d: 11, dist: 44, ang: 1.5, y: 6, ruins: 'columns' },
      { r: 12, d: 22, dist: 82, ang: 2.5, y: -14, ruins: 'columns' },
      { r: 5, d: 9, dist: 40, ang: 3.4, y: -3, ruins: 'crystals' },
      { r: 8, d: 14, dist: 66, ang: 4.3, y: 12, ruins: 'stair' },
      { r: 4, d: 8, dist: 36, ang: 5.2, y: 2, ruins: 'crystals' },
      { r: 14, d: 26, dist: 120, ang: 5.8, y: -20, ruins: 'arch' },
      { r: 7, d: 12, dist: 105, ang: 1.0, y: 18, ruins: 'crystals' },
      { r: 10, d: 18, dist: 140, ang: 3.9, y: 4, ruins: 'columns' },
      { r: 3, d: 6, dist: 30, ang: 2.0, y: -9, ruins: 'crystals' },
    ];
    defs.forEach((d, idx) => {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(this.islandGeometry(d.r, d.d, 300 + idx * 13), this.rockMat);
      mesh.receiveShadow = true;
      g.add(mesh);
      const top = 0.15;
      if (d.ruins === 'arch') {
        const h = d.r * 0.55;
        this.addColumn(g, -d.r * 0.35, top, 0, h, false);
        this.addColumn(g, d.r * 0.35, top, 0, h, false);
        const arc = new THREE.Mesh(new THREE.TorusGeometry(d.r * 0.35, 0.5, 10, 32, Math.PI), this.stoneMat);
        arc.position.y = h + 1.1;
        g.add(arc);
        const glow = new THREE.Mesh(new THREE.TorusGeometry(d.r * 0.35 - 0.6, 0.12, 8, 48, Math.PI), this.runeBandMat);
        glow.position.y = h + 1.1;
        g.add(glow);
        this.addCrystalCluster(g, 0, top, d.r * 0.3, 1.2, this.crystalMat);
      } else if (d.ruins === 'columns') {
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * TAU + this.rng();
          this.addColumn(g, Math.cos(a) * d.r * 0.5, top, Math.sin(a) * d.r * 0.5, d.r * (0.3 + this.rng() * 0.4), this.rng() < 0.5);
        }
        this.addCrystalCluster(g, 0, top, 0, 1.4, this.crystalMat2);
      } else if (d.ruins === 'crystals') {
        this.addCrystalCluster(g, 0, top, 0, d.r * 0.35, this.rng() < 0.5 ? this.crystalMat : this.crystalMat2);
        this.addCrystalCluster(g, d.r * 0.4, top, -d.r * 0.2, d.r * 0.2, this.crystalMat);
      } else if (d.ruins === 'stair') {
        this.stairBase = g;
      }
      // hanging crystals beneath
      this.addCrystalCluster(g, 0, -d.d * 0.7, 0, d.r * 0.18, this.crystalMat2, true);
      g.position.set(Math.cos(d.ang) * d.dist, d.y, Math.sin(d.ang) * d.dist);
      g.rotation.y = this.rng() * TAU;
      g.userData = { baseY: d.y, phase: this.rng() * TAU, speed: 0.15 + this.rng() * 0.2, amp: 0.6 + this.rng() * 1.2 };
      this.group.add(g);
      this.islands.push(g);
    });
  }

  buildInvertedIsland() {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(this.islandGeometry(16, 28, 999), this.rockMat);
    g.add(mesh);
    this.addCrystalCluster(g, 0, 0.2, 0, 3.5, this.crystalMat);
    this.addCrystalCluster(g, 5, 0.2, 3, 2, this.crystalMat2);
    this.addColumn(g, -6, 0.1, -2, 9, true);
    g.rotation.x = Math.PI;
    g.position.set(-35, 95, 60);
    g.userData = { baseY: 95, phase: 1, speed: 0.07, amp: 2 };
    this.group.add(g);
    this.islands.push(g);
  }

  buildStair() {
    const steps = 46;
    const geo = new THREE.BoxGeometry(3.2, 0.5, 1.4);
    const mesh = new THREE.InstancedMesh(geo, this.stoneMat, steps);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (let i = 0; i < steps; i++) {
      const a = i * 0.32;
      const r = 5;
      p.set(Math.cos(a) * r, 1 + i * 0.85, Math.sin(a) * r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      const fade = 1 - i / steps;
      s.set(1, 1, 1).multiplyScalar(0.4 + fade * 0.6);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    const holder = this.stairBase || this.group;
    holder.add(mesh);
  }

  buildRings() {
    this.rings = [];
    const defs = [
      { r: 75, tube: 0.55, tilt: [0.35, 0, 0.15], speed: 0.02, color: [0.6, 0.45, 1.8], rep: 10 },
      { r: 92, tube: 0.7, tilt: [-0.25, 0, 0.5], speed: -0.014, color: [0.3, 1.2, 1.3], rep: 12 },
      { r: 118, tube: 0.9, tilt: [0.1, 0, -0.35], speed: 0.009, color: [1.4, 0.8, 0.5], rep: 14 },
    ];
    for (const d of defs) {
      const tex = this.tex.runeStrip.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(d.rep, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(...d.color),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, d.tube, 6, 256), mat);
      const holder = new THREE.Group();
      holder.rotation.set(d.tilt[0], d.tilt[1], d.tilt[2]);
      holder.position.y = 10;
      holder.add(ring);
      ring.rotation.x = Math.PI / 2;
      ring.userData.speed = d.speed;
      this.group.add(holder);
      this.rings.push(ring);
    }
  }

  buildLanterns() {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector2(0.18 + Math.sin(t * Math.PI) * 0.28, t * 0.85 - 0.42));
    }
    const geo = new THREE.LatheGeometry(pts, 14);
    const mat = new THREE.MeshStandardMaterial({
      map: this.tex.lantern,
      emissiveMap: this.tex.lantern,
      emissive: new THREE.Color(1.0, 0.55, 0.25),
      emissiveIntensity: 2.6,
      roughness: 0.9,
      side: THREE.DoubleSide,
      fog: true,
    });
    const count = 70;
    this.lanterns = new THREE.InstancedMesh(geo, mat, count);
    this.lanternData = [];
    for (let i = 0; i < count; i++) {
      const near = i < 14;
      const r = near ? 18 + this.rng() * 14 : 32 + this.rng() * 90;
      this.lanternData.push({
        a: this.rng() * TAU,
        r,
        y: -30 + this.rng() * 90,
        rise: 0.6 + this.rng() * 0.9,
        orbit: (this.rng() - 0.5) * 0.02,
        sway: this.rng() * TAU,
        s: near ? 1.1 + this.rng() * 0.4 : 1.3 + this.rng() * 1.2,
      });
    }
    this.lanterns.frustumCulled = false;
    this.group.add(this.lanterns);

    // Glow sprites around lanterns
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    glowGeo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(count), 1));
    this.lanternGlow = new THREE.Points(
      glowGeo,
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: this.tex.glow }, uScale: { value: innerHeight } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute float size; uniform float uScale;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * uScale / -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          void main() {
            float a = texture2D(uMap, gl_PointCoord).a;
            gl_FragColor = vec4(vec3(1.0, 0.55, 0.22) * a * 0.55, 1.0);
          }
        `,
      }),
    );
    this.lanternGlow.frustumCulled = false;
    this.group.add(this.lanternGlow);

    // Two lanterns orbit close enough to throw warm light across the tiles
    this.lanternLights = [0, 1].map((k) => {
      const l = new THREE.PointLight(0xffa98a, 14, 20, 1.7);
      this.scene.add(l);
      return { light: l, a: k * Math.PI, r: 12 + k * 3, speed: 0.07 + k * 0.03, y: 4.5 + k };
    });
    this.lanternLightMeshes = this.lanternLights.map(() => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.setScalar(1.3);
      this.scene.add(m);
      return m;
    });
    this.lanternMatrix = new THREE.Matrix4();
  }

  buildMotes() {
    const count = 900;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const col = new Float32Array(count * 3);
    const palette = [
      [0.6, 0.85, 1.0],
      [0.75, 0.55, 1.0],
      [1.0, 0.75, 0.45],
      [0.45, 1.0, 0.85],
    ];
    for (let i = 0; i < count; i++) {
      const a = this.rng() * TAU;
      const r = 3 + Math.pow(this.rng(), 0.7) * 60;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = -25 + this.rng() * 50;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = this.rng() * 100;
      const c = palette[Math.floor(this.rng() * palette.length)];
      col.set(c, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.moteUniforms = { uTime: { value: 0 }, uMap: { value: this.tex.glow }, uScale: { value: innerHeight } };
    const motes = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.moteUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute float seed; attribute vec3 color;
          uniform float uTime; uniform float uScale;
          varying vec3 vCol; varying float vA;
          void main() {
            vec3 p = position;
            float t = uTime * (0.15 + fract(seed * 0.37) * 0.25);
            p.x += sin(t + seed) * 1.6;
            p.z += cos(t * 0.8 + seed * 1.7) * 1.6;
            p.y = mod(p.y + uTime * (0.25 + fract(seed * 0.71) * 0.5) + 25.0, 50.0) - 25.0;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float tw = 0.5 + 0.5 * sin(uTime * (1.5 + fract(seed) * 3.0) + seed * 7.0);
            gl_PointSize = (0.12 + fract(seed * 1.31) * 0.2) * uScale / -mv.z * (0.6 + tw);
            gl_Position = projectionMatrix * mv;
            vCol = color; vA = tw * smoothstep(90.0, 20.0, -mv.z);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap; varying vec3 vCol; varying float vA;
          void main() {
            float a = texture2D(uMap, gl_PointCoord).a;
            gl_FragColor = vec4(vCol * a * vA * 1.6, 1.0);
          }
        `,
      }),
    );
    motes.frustumCulled = false;
    this.group.add(motes);
  }

  update(dt, time) {
    for (const g of this.islands) {
      const u = g.userData;
      g.position.y = u.baseY + Math.sin(time * u.speed + u.phase) * u.amp;
      g.rotation.y += dt * 0.004;
    }
    for (const r of this.rings) r.rotation.z += r.userData.speed * dt;

    const m = this.lanternMatrix;
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const gpos = this.lanternGlow.geometry.attributes.position;
    const gsize = this.lanternGlow.geometry.attributes.size;
    this.lanternData.forEach((d, i) => {
      d.y += d.rise * dt;
      if (d.y > 70) d.y = -35;
      d.a += d.orbit * dt;
      const sway = Math.sin(time * 0.7 + d.sway) * 0.6;
      p.set(Math.cos(d.a) * d.r + sway, d.y, Math.sin(d.a) * d.r);
      q.setFromEuler(new THREE.Euler(Math.sin(time + d.sway) * 0.12, d.sway, Math.cos(time * 0.8 + d.sway) * 0.12));
      s.setScalar(d.s);
      m.compose(p, q, s);
      this.lanterns.setMatrixAt(i, m);
      gpos.setXYZ(i, p.x, p.y, p.z);
      gsize.setX(i, d.s * 6);
    });
    this.lanterns.instanceMatrix.needsUpdate = true;
    gpos.needsUpdate = true;
    gsize.needsUpdate = true;

    this.lanternLights.forEach((L, k) => {
      L.a += L.speed * dt;
      const y = L.y + Math.sin(time * 0.5 + k * 2) * 1.2;
      L.light.position.set(Math.cos(L.a) * L.r, y, Math.sin(L.a) * L.r);
      L.light.intensity = 13 + Math.sin(time * 9 + k) * 1.0 + Math.sin(time * 23 + k * 3) * 0.6;
      const mesh = this.lanternLightMeshes[k];
      mesh.position.copy(L.light.position);
      mesh.rotation.set(Math.sin(time * 0.9 + k) * 0.1, time * 0.2, Math.cos(time * 0.7) * 0.1);
    });

    this.moteUniforms.uTime.value = time;
  }
}
