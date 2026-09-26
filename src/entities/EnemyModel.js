import * as THREE from 'three';
import { patchMaterial, GLSL_NOISE } from '../render/patchMaterial.js';
import { buildWeapon, createWeaponMaterials } from '../combat/weapons.js';
import { damp, lerp, clamp } from '../core/math.js';

const DISSOLVE_PARS = /* glsl */ `
  uniform float uFlash;
  uniform float uDissolve;
  uniform vec3 uEdgeColor;
  varying vec3 vDissolvePos;
  ${GLSL_NOISE}
`;
const DISSOLVE_MAP = /* glsl */ `
  float dn = vnoise(vDissolvePos * 9.0) * 0.65 + vnoise(vDissolvePos * 23.0) * 0.35;
  if (dn < uDissolve) discard;
`;
const DISSOLVE_EMIT = /* glsl */ `
  float dEdge = (1.0 - smoothstep(0.0, 0.09, dn - uDissolve)) * step(0.001, uDissolve);
  totalEmissiveRadiance += uEdgeColor * dEdge * 5.0 + vec3(0.8, 0.75, 1.0) * uFlash * 0.45;
`;

function enemyMaterial(mat, uniforms, cloak = false) {
  return patchMaterial(mat, {
    key: cloak ? 'enemy-cloak' : 'enemy',
    uniforms,
    vertexPars: /* glsl */ `
      varying vec3 vDissolvePos;
      ${cloak ? 'uniform float uTime; uniform float uSway;' : ''}
    `,
    vertexBegin: /* glsl */ `
      vDissolvePos = position;
      ${
        cloak
          ? `float hang = clamp(-position.y / 1.35, 0.0, 1.0);
             transformed.z -= (sin(uTime * 3.1 + position.y * 4.0 + position.x * 3.0) * 0.045 + uSway * 0.45 + 0.05) * hang * hang;
             transformed.x += sin(uTime * 2.2 + position.y * 3.3) * 0.035 * hang;`
          : ''
      }
    `,
    fragmentPars: DISSOLVE_PARS,
    fragmentMap: DISSOLVE_MAP,
    fragmentEmissive: DISSOLVE_EMIT,
  });
}

/**
 * Procedural dream-knight: engraved steel, porcelain mask with glowing eyes
 * and painted tears, star-embroidered cloak that billows with speed, halo,
 * and a weapon per type. Animated with simple procedural rigs.
 */
export class EnemyModel {
  constructor(def, textures) {
    this.def = def;
    this.root = new THREE.Group();
    this.uniforms = {
      uFlash: { value: 0 },
      uDissolve: { value: 1 },
      uEdgeColor: { value: new THREE.Color(def.glow).multiplyScalar(1.6) },
      uTime: { value: 0 },
      uSway: { value: 0 },
    };
    const U = this.uniforms;
    const glow = new THREE.Color(def.glow);
    const tint = new THREE.Color(def.color);

    const a = textures.armor;
    const armor = enemyMaterial(
      new THREE.MeshStandardMaterial({
        map: a.map,
        normalMap: a.normalMap,
        roughnessMap: a.roughnessMap,
        emissiveMap: a.emissiveMap,
        emissive: glow.clone().multiplyScalar(0.9),
        emissiveIntensity: 1.2,
        color: new THREE.Color(0.75, 0.72, 0.9).lerp(tint, 0.18),
        metalness: 0.88,
        roughness: 1,
      }),
      U,
    );
    const c = textures.cloth;
    const clothMat = (sway) =>
      enemyMaterial(
        new THREE.MeshStandardMaterial({
          map: c.map,
          emissiveMap: c.emissiveMap,
          normalMap: c.normalMap,
          emissive: glow.clone(),
          emissiveIntensity: 1.3,
          color: new THREE.Color(1, 1, 1).lerp(tint, 0.35),
          roughness: 0.85,
          side: THREE.DoubleSide,
        }),
        U,
        sway,
      );
    const cloth = clothMat(false);
    const cloak = clothMat(true);
    const m = textures.masks[def.maskIndex ?? 0];
    const mask = (this.maskMat = enemyMaterial(
      new THREE.MeshStandardMaterial({
        map: m.map,
        normalMap: m.normalMap,
        roughnessMap: m.roughnessMap,
        metalnessMap: m.metalnessMap,
        emissiveMap: m.emissiveMap,
        emissive: glow.clone().multiplyScalar(2.2),
        emissiveIntensity: 1.6,
        roughness: 1,
        metalness: 1,
      }),
      U,
    ));
    const dark = enemyMaterial(new THREE.MeshStandardMaterial({ color: 0x120e22, roughness: 0.9 }), U);
    const wm = createWeaponMaterials(textures, def.glow);
    for (const k of Object.keys(wm)) wm[k] = enemyMaterial(wm[k], U);
    const gold = wm.gold;
    this.weaponMats = wm;
    this.materials = [armor, cloth, cloak, mask, dark, ...Object.values(wm)];

    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 12);

    const body = new THREE.Group();
    this.root.add(body);
    this.body = body;
    const hips = new THREE.Group();
    hips.position.y = 1.0;
    body.add(hips);
    this.hips = hips;
    mesh(new THREE.SphereGeometry(0.19, 16, 12), dark, hips).scale.set(1.2, 0.8, 0.9);

    // legs
    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.13, -0.05, 0);
      hips.add(hip);
      mesh(cap(0.085, 0.3), armor, hip, 0, -0.22, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.45;
      hip.add(knee);
      mesh(new THREE.SphereGeometry(0.072, 12, 8), gold, knee, 0, 0, 0.055);
      mesh(cap(0.075, 0.3), armor, knee, 0, -0.22, 0);
      mesh(new THREE.BoxGeometry(0.14, 0.1, 0.27), armor, knee, 0, -0.47, 0.05);
      return { hip, knee };
    });

    // torso
    const spine = new THREE.Group();
    spine.position.y = 0.1;
    hips.add(spine);
    this.spine = spine;
    const chest = mesh(cap(0.2, 0.26), armor, spine, 0, 0.3, 0);
    chest.scale.set(1.28, 1, 0.82);
    mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 24), gold, spine, 0, 0.05, 0).rotation.x = Math.PI / 2;
    const skirt = mesh(new THREE.CylinderGeometry(0.22, 0.36, 0.52, 20, 3, true), cloth, spine, 0, -0.2, 0);
    skirt.castShadow = true;
    // chest sigil
    mesh(new THREE.OctahedronGeometry(0.045), wm.gem, spine, 0, 0.36, 0.17);
    for (const side of [-1, 1]) {
      const p = mesh(new THREE.SphereGeometry(0.14, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), armor, spine, side * 0.3, 0.5, 0);
      p.scale.set(1.25, 1, 1.12);
      p.rotation.z = -side * 0.35;
      mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 20, Math.PI), gold, spine, side * 0.3, 0.5, 0).rotation.set(0, Math.PI / 2, -side * 0.35);
    }

    // head
    const neck = new THREE.Group();
    neck.position.y = 0.62;
    spine.add(neck);
    const head = new THREE.Group();
    head.position.y = 0.13;
    head.scale.setScalar(0.86);
    neck.add(head);
    this.head = head;
    mesh(new THREE.SphereGeometry(0.15, 22, 16), armor, head).scale.set(1, 1.15, 1.05);
    const hood = mesh(new THREE.SphereGeometry(0.19, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), cloth, head, 0, 0.02, -0.035);
    hood.scale.set(1, 1.12, 1.1);
    hood.rotation.x = -0.25;
    const maskMesh = mesh(
      new THREE.SphereGeometry(0.162, 28, 20, Math.PI / 2 - 1.15, 2.3, Math.PI * 0.22, Math.PI * 0.55),
      mask,
      head,
      0,
      0,
      0.012,
    );
    maskMesh.scale.set(1, 1.12, 1.08);
    if (def.halo) {
      const halo = mesh(
        new THREE.TorusGeometry(0.21, 0.012, 8, 40),
        new THREE.MeshBasicMaterial({ color: glow.clone().multiplyScalar(2.2) }),
        head,
        0,
        0.3,
        -0.06,
      );
      halo.rotation.x = Math.PI / 2 - 0.35;
      halo.castShadow = false;
      this.halo = halo;
    } else {
      // moth antennae for the lancer
      for (const side of [-1, 1]) {
        const ant = mesh(new THREE.ConeGeometry(0.035, 0.34, 6), gold, head, side * 0.09, 0.26, -0.02);
        ant.rotation.z = -side * 0.5;
        ant.rotation.x = -0.35;
      }
    }

    // arms
    this.arms = [-1, 1].map((side) => {
      const sh = new THREE.Group();
      sh.position.set(side * 0.31, 0.44, 0);
      spine.add(sh);
      mesh(cap(0.065, 0.24), armor, sh, 0, -0.17, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.34;
      sh.add(elbow);
      mesh(new THREE.SphereGeometry(0.062, 10, 8), gold, elbow);
      mesh(cap(0.06, 0.22), armor, elbow, 0, -0.15, 0);
      mesh(new THREE.BoxGeometry(0.1, 0.12, 0.11), armor, elbow, 0, -0.33, 0);
      const hand = new THREE.Group();
      hand.position.y = -0.36;
      elbow.add(hand);
      return { sh, elbow, hand, side };
    });
    // weapon in the knight's right hand (its right is -x because it faces +z)
    this.weapon = buildWeapon(def.weapon, wm, def.weapon === 'greatsword' ? 1.0 : 1.0);
    this.weapon.rotation.x = Math.PI / 2;
    if (def.weapon === 'spear') this.weapon.position.y = 0;
    this.arms[0].hand.add(this.weapon);

    // cloak
    const cloakGeo = new THREE.PlaneGeometry(0.66, 1.35, 6, 16);
    cloakGeo.translate(0, -0.675, 0);
    const cloakMesh = mesh(cloakGeo, cloak, spine, 0, 0.56, -0.19);
    cloakMesh.rotation.x = 0.1;

    this.root.scale.setScalar(def.scale);
    this.walkPhase = Math.random() * 10;
    this.anim = { windup: 0, strike: 0, block: 0, stagger: 0, flail: 0, walk: 0 };
    this.setDissolve(1);
  }

  setDissolve(v) {
    this.uniforms.uDissolve.value = v;
    if (this.halo) this.halo.visible = v < 0.35;
  }

  flash(v = 1) {
    this.uniforms.uFlash.value = Math.max(this.uniforms.uFlash.value, v);
  }

  /** s: { speed, state, t, windupP, strikeP, time, lean, yawVel } */
  update(dt, s) {
    const U = this.uniforms;
    U.uTime.value = s.time;
    U.uFlash.value = damp(U.uFlash.value, 0, 12, dt);
    U.uSway.value = damp(U.uSway.value, clamp(s.speed / 7, 0, 1), 5, dt);
    const A = this.anim;
    const tgt = {
      windup: s.state === 'windup' ? 1 : 0,
      strike: s.state === 'strike' ? 1 : 0,
      block: s.state === 'block' ? 1 : 0,
      stagger: s.state === 'stagger' || s.state === 'hitstun' ? 1 : 0,
      flail: s.state === 'fall' ? 1 : 0,
      walk: clamp(s.speed / 5, 0, 1.3),
    };
    const rate = { windup: 9, strike: 26, block: 12, stagger: 10, flail: 6, walk: 8 };
    for (const k in A) A[k] = damp(A[k], tgt[k], rate[k], dt);

    this.walkPhase += dt * (3 + s.speed * 1.9);
    const w = A.walk;
    const ph = this.walkPhase;
    this.legs[0].hip.rotation.x = Math.sin(ph) * 0.65 * w - A.flail * 0.6;
    this.legs[1].hip.rotation.x = -Math.sin(ph) * 0.65 * w + A.flail * 0.4;
    this.legs[0].knee.rotation.x = Math.max(0, -Math.sin(ph)) * 0.9 * w + A.flail * 0.8;
    this.legs[1].knee.rotation.x = Math.max(0, Math.sin(ph)) * 0.9 * w + A.flail * 0.5;
    this.hips.position.y = 1.0 + Math.abs(Math.cos(ph)) * 0.04 * w - A.stagger * 0.05;

    const breathe = Math.sin(s.time * 1.8 + this.walkPhase * 0.1) * 0.03;
    this.spine.rotation.x = breathe + (s.lean || 0) * 0.25 - A.stagger * 0.35 + A.strike * 0.3 - A.windup * 0.12;
    this.spine.rotation.y = -A.windup * 0.45 + A.strike * 0.35;
    this.spine.rotation.z = Math.sin(ph) * 0.04 * w;
    this.head.rotation.x = A.stagger * 0.4 + Math.sin(s.time * 0.9) * 0.04;
    this.head.rotation.z = A.stagger * Math.sin(s.time * 14) * 0.2;

    const spear = this.def.weapon === 'spear';
    const [R, L] = this.arms;
    // weapon arm
    let shX = -0.45 + Math.sin(ph) * 0.2 * w;
    let shZ = 0.1;
    let elX = -0.7;
    if (spear) {
      shX = lerp(shX, -1.35, A.windup);
      elX = lerp(elX, -1.9, A.windup);
      shX = lerp(shX, -1.55, A.strike);
      elX = lerp(elX, 0.05, A.strike);
    } else {
      shX = lerp(shX, -2.55, A.windup);
      shZ = lerp(shZ, 0.35, A.windup);
      elX = lerp(elX, -0.4, A.windup);
      shX = lerp(shX, 0.25, A.strike);
      elX = lerp(elX, -0.15, A.strike);
    }
    shX = lerp(shX, -1.3, A.block);
    shZ = lerp(shZ, -0.6, A.block);
    elX = lerp(elX, -1.1, A.block);
    shX = lerp(shX, 0.4, A.stagger);
    shX = lerp(shX, -2.9, A.flail);
    R.sh.rotation.set(shX, 0, shZ + Math.sin(s.time * 20) * 0.3 * A.flail);
    R.elbow.rotation.x = elX;
    this.weapon.rotation.z = lerp(0, 1.2, A.block);

    // off arm
    let lx = -0.2 - Math.sin(ph) * 0.3 * w;
    lx = lerp(lx, -0.9, A.windup);
    lx = lerp(lx, -2.8, A.flail);
    L.sh.rotation.set(lx, 0, -0.15 - Math.sin(s.time * 18) * 0.3 * A.flail);
    L.elbow.rotation.x = -0.5 - A.windup * 0.6;

    if (this.halo) {
      this.halo.rotation.z = s.time * 1.2;
      this.halo.position.y = 0.3 + Math.sin(s.time * 2) * 0.02;
    }
    // telegraph: weapon glows during windup
    this.weaponMats.blade.emissiveIntensity = 2.2 + A.windup * 7 + A.strike * 4;
    this.weaponMats.gem.emissiveIntensity = 2.5 + A.windup * 6;
    // the mask's eyes blaze while it winds up – read the face, then react
    this.maskMat.emissiveIntensity = 1.6 + A.windup * 4 + A.strike * 2 - A.stagger * 1.2;
  }

  weaponTipWorld(out) {
    return this.weapon.localToWorld(out.copy(this.weapon.userData.tip));
  }
}
