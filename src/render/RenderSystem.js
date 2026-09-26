import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { DreamShader } from './DreamShader.js';
import { PLAYER } from '../config.js';

/**
 * Owns the WebGL renderer, the world scene + camera, the first-person
 * view-model scene (rendered on top with its own depth) and the post chain.
 */
export class RenderSystem {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.baseRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    this.scale = 1;
    this.frameEMA = 1 / 60;
    this.adaptT = 0;
    renderer.setPixelRatio(this.baseRatio);
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0b0720, 0.0064);
    this.camera = new THREE.PerspectiveCamera(PLAYER.baseFov, innerWidth / innerHeight, 0.05, 2000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 20);
    this.vmCamera.rotation.order = 'YXZ';
    this.vmScene.add(this.vmCamera);

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.worldPass = new RenderPass(this.scene, this.camera);
    this.vmPass = new RenderPass(this.vmScene, this.vmCamera);
    this.vmPass.clear = false;
    this.vmPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.72, 0.5, 0.86);
    this.output = new OutputPass();
    this.dream = new ShaderPass(DreamShader);
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.vmPass);
    // Safety net: a single NaN/Inf pixel would be smeared across the frame by bloom.
    this.scrub = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
          gl_FragColor = vec4(min(c.rgb, vec3(64.0)), 1.0);
        }`,
    });
    this.composer.addPass(this.scrub);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.dream);

    this.fx = this.dream.uniforms;
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  get maxAnisotropy() {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  setQuality(high) {
    this.baseRatio = high ? Math.min(window.devicePixelRatio || 1, 1.25) : 0.75;
    this.renderer.shadowMap.enabled = high;
    this.scale = 1;
    this.applyScale();
  }

  applyScale() {
    this.renderer.setPixelRatio(this.baseRatio * this.scale);
    this.resize();
  }

  /**
   * Dynamic resolution: if frames run long, render fewer pixels; creep back up
   * when there is headroom. Keeps laptops near 60 fps instead of 15.
   */
  adapt(rawDt) {
    this.frameEMA = this.frameEMA * 0.92 + rawDt * 0.08;
    this.adaptT += rawDt;
    if (this.adaptT < 1.0) return;
    this.adaptT = 0;
    if (this.frameEMA > 1 / 50 && this.scale > 0.5) {
      this.scale = Math.max(0.5, this.scale - (this.frameEMA > 1 / 30 ? 0.2 : 0.1));
      this.applyScale();
    } else if (this.frameEMA < 1 / 58 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.05);
      this.applyScale();
    }
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.fx.uResolution.value.set(w * pr, h * pr);
  }

  render(time) {
    this.fx.uTime.value = time;
    this.composer.render();
  }
}
