import * as THREE from 'three';

const MAX = 48;
const LIFE = 0.16;

/** Additive ribbon swept by the blade edge (lives in view-model space). */
export class SwordTrail {
  constructor(parent, color = new THREE.Color(0.6, 0.85, 2.2)) {
    this.samples = [];
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX * 2 * 3);
    this.alphas = new Float32Array(MAX * 2);
    this.edge = new Float32Array(MAX * 2);
    for (let i = 0; i < MAX; i++) {
      this.edge[i * 2] = 0;
      this.edge[i * 2 + 1] = 1;
    }
    const idx = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.aPos = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('alpha', this.aAlpha);
    geo.setAttribute('edge', new THREE.BufferAttribute(this.edge, 1));
    this.uniforms = { uColor: { value: color } };
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute float alpha; attribute float edge;
          varying float vA; varying float vE;
          void main() { vA = alpha; vE = edge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; varying float vA; varying float vE;
          void main() {
            // clamp: MSAA can extrapolate varyings slightly outside [0,1], and pow() of a
            // negative base is NaN on real GPUs – bloom then smears it into a black screen
            float e = clamp(vE, 0.0, 1.0);
            float a = clamp(vA, 0.0, 1.0);
            float core = e * e * e * e * e * e;
            vec3 c = mix(uColor * vec3(0.8, 0.45, 1.0), uColor + vec3(1.0), core);
            gl_FragColor = vec4(c * a * a * (0.05 + 0.95 * pow(e, 2.2)) * 0.8, 1.0);
          }
        `,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    geo.setDrawRange(0, 0);
    parent.add(this.mesh);
  }

  push(base, tip) {
    this.samples.unshift({ base: base.clone(), tip: tip.clone(), age: 0 });
    if (this.samples.length > MAX) this.samples.length = MAX;
  }

  update(dt) {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[this.samples.length - 1].age > LIFE) this.samples.pop();
    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const a = Math.max(0, 1 - s.age / LIFE) * (1 - i / MAX);
      this.positions.set([s.base.x, s.base.y, s.base.z, s.tip.x, s.tip.y, s.tip.z], i * 6);
      this.alphas[i * 2] = a;
      this.alphas[i * 2 + 1] = a;
    }
    this.aPos.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
  }
}
