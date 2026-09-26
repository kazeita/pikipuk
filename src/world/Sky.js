import * as THREE from 'three';
import { GLSL_NOISE } from '../render/patchMaterial.js';

export const MOON_DIR = new THREE.Vector3(-0.45, 0.42, -0.79).normalize();
const MOON2_DIR = new THREE.Vector3(0.78, 0.3, 0.55).normalize();

/**
 * Night sky dome (gradient, nebula band, twinkling star field, aurora
 * curtains), twin moons with halos, a luminous cloud sea far below and a
 * rotating magic circle glimpsed through the holes in the arena.
 */
export class Sky {
  constructor(scene, textures) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.uniforms = {
      uTime: { value: 0 },
      uMoonDir: { value: MOON_DIR.clone() },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 64, 32),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uMoonDir;
          varying vec3 vDir;
          ${GLSL_NOISE}
          float hash31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float fbmQ(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s / 0.875; }
          vec3 starLayer(vec3 d, float scale, float density, float size, float band) {
            vec3 sd = d * scale;
            vec3 cell = floor(sd);
            vec3 f = fract(sd) - 0.5;
            float rnd = hash31(cell);
            if (rnd < density) return vec3(0.0);
            vec3 off = vec3(hash31(cell + 1.3), hash31(cell + 2.7), hash31(cell + 4.1)) - 0.5;
            float dist = length(f - off * 0.5);
            float star = smoothstep(size, 0.0, dist);
            float tw = 0.55 + 0.45 * sin(uTime * (0.8 + rnd * 3.0) + rnd * 91.0);
            vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.82, 0.75), hash31(cell + 9.0));
            tint = mix(tint, vec3(0.8, 0.7, 1.0), step(0.8, hash31(cell + 5.0)));
            return star * tw * tint * (1.0 + band * 1.5);
          }
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 zenith = vec3(0.003, 0.004, 0.02);
            vec3 mid = vec3(0.016, 0.012, 0.06);
            vec3 horizon = vec3(0.09, 0.035, 0.15);
            vec3 below = vec3(0.035, 0.018, 0.08);
            vec3 col = h > 0.0 ? mix(horizon, mid, smoothstep(0.0, 0.28, h)) : mix(horizon, below, smoothstep(0.0, -0.35, h));
            col = mix(col, zenith, smoothstep(0.3, 0.95, h));

            // milky nebula band
            float band = exp(-pow((d.y * 0.85 + d.x * 0.45 + d.z * 0.2 - 0.3) * 2.4, 2.0));
            float n = fbm3(d * 2.4 + vec3(0.0, uTime * 0.003, 0.0));
            float n2 = fbm3(d * 5.0 + vec3(3.1, 1.7, uTime * 0.002));
            vec3 neb = mix(vec3(0.42, 0.12, 0.6), vec3(0.06, 0.34, 0.58), n2);
            neb = mix(neb, vec3(0.8, 0.3, 0.55), smoothstep(0.65, 0.85, n2) * 0.5);
            col += neb * smoothstep(0.42, 0.85, n) * band * 0.42 * smoothstep(-0.1, 0.15, h);
            // dark dust lanes inside the band
            col *= 1.0 - smoothstep(0.55, 0.75, fbmQ(d * 7.0 + 11.0)) * band * 0.5;

            float above = smoothstep(-0.08, 0.08, h);
            col += starLayer(d, 240.0, 0.965, 0.13, band) * 1.6 * above;
            col += starLayer(d, 520.0, 0.93, 0.16, band) * 0.7 * above;
            col += starLayer(d, 90.0, 0.992, 0.09, band) * 3.0 * above;

            // aurora curtains
            float ang = atan(d.z, d.x);
            float ah = smoothstep(0.02, 0.16, h) * (1.0 - smoothstep(0.3, 0.62, h));
            float curtain = fbmQ(vec3(ang * 3.0 + uTime * 0.02, 0.0, uTime * 0.03));
            float rays = fbmQ(vec3(ang * 22.0, h * 2.0 - uTime * 0.08, uTime * 0.05));
            float aur = ah * smoothstep(0.45, 0.8, curtain) * (0.35 + rays);
            vec3 aurCol = mix(vec3(0.1, 0.95, 0.72), vec3(0.62, 0.25, 1.0), smoothstep(0.08, 0.4, h));
            col += aurCol * aur * 0.32;

            // moon glow + horizon mist
            float md = max(dot(d, uMoonDir), 0.0);
            col += vec3(0.45, 0.5, 0.95) * pow(md, 90.0) * 0.8 + vec3(0.35, 0.28, 0.7) * pow(md, 10.0) * 0.18;
            col += vec3(0.22, 0.1, 0.32) * exp(-abs(h) * 16.0) * 0.18;

            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.dome = dome;
    this.group.add(dome);

    // Moons: camera-facing discs with halos, kept far away
    const makeMoon = (dir, dist, size, tex, color, haloColor, haloSize) => {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, fog: false }),
      );
      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(haloSize, haloSize),
        new THREE.MeshBasicMaterial({
          map: textures.glow,
          color: haloColor,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      halo.position.z = -1;
      g.add(halo, disc);
      g.userData = { dir: dir.clone(), dist };
      disc.renderOrder = -9;
      halo.renderOrder = -9;
      this.group.add(g);
      return g;
    };
    this.moons = [
      makeMoon(MOON_DIR, 900, 190, textures.moon, new THREE.Color(1.5, 1.5, 1.65), new THREE.Color(0.35, 0.33, 0.7), 900),
      makeMoon(MOON2_DIR, 950, 60, textures.moon2, new THREE.Color(0.9, 1.5, 1.45), new THREE.Color(0.1, 0.35, 0.35), 330),
    ];

    // Cloud sea far below
    this.cloudUniforms = { uTime: { value: 0 }, uMoonDir: { value: MOON_DIR.clone() } };
    const clouds = new THREE.Mesh(
      new THREE.CircleGeometry(1100, 96),
      new THREE.ShaderMaterial({
        uniforms: this.cloudUniforms,
        transparent: true,
        depthWrite: false,
        fog: false,
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uMoonDir;
          varying vec3 vWorld;
          ${GLSL_NOISE}
          void main() {
            vec2 p = vWorld.xz * 0.012;
            float n = fbm3(vec3(p + vec2(uTime * 0.01, uTime * 0.004), uTime * 0.02));
            float n2 = fbm3(vec3(p * 2.7 - vec2(uTime * 0.015, 0.0), 4.0));
            float c = smoothstep(0.35, 0.8, n * 0.7 + n2 * 0.45);
            vec2 md = normalize(uMoonDir.xz);
            float lit = 0.5 + 0.5 * dot(normalize(vec2(n2 - 0.5, n - 0.5) + md * 0.6), md);
            vec3 col = mix(vec3(0.03, 0.015, 0.08), vec3(0.2, 0.15, 0.38), c * lit);
            col += vec3(0.25, 0.1, 0.35) * pow(c, 3.0) * 0.2;
            float dist = length(vWorld.xz);
            float fade = 1.0 - smoothstep(250.0, 1050.0, dist);
            gl_FragColor = vec4(col, (0.55 + c * 0.45) * fade);
          }
        `,
      }),
    );
    clouds.rotation.x = -Math.PI / 2;
    clouds.position.y = -90;
    clouds.renderOrder = -8;
    this.clouds = clouds;
    scene.add(clouds);

    // A vast rotating sigil below the arena – visible through fallen tiles
    this.circle = new THREE.Mesh(
      new THREE.PlaneGeometry(95, 95),
      new THREE.MeshBasicMaterial({
        map: textures.magicCircle,
        color: new THREE.Color(0.7, 0.45, 1.6),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.circle.rotation.x = -Math.PI / 2;
    this.circle.position.y = -48;
    scene.add(this.circle);
    this.circle2 = this.circle.clone();
    this.circle2.material = this.circle.material.clone();
    this.circle2.material.color = new THREE.Color(0.2, 0.9, 1.0);
    this.circle2.material.opacity = 0.25;
    this.circle2.scale.setScalar(0.55);
    this.circle2.position.y = -40;
    scene.add(this.circle2);
  }

  update(dt, time, camera) {
    this.uniforms.uTime.value = time;
    this.cloudUniforms.uTime.value = time;
    this.group.position.copy(camera.position);
    for (const m of this.moons) {
      m.position.copy(m.userData.dir).multiplyScalar(m.userData.dist);
      m.lookAt(camera.position);
    }
    this.circle.rotation.z = time * 0.03;
    this.circle2.rotation.z = -time * 0.05;
  }
}
