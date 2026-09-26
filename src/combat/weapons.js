import * as THREE from 'three';

/**
 * Weapon meshes built from procedural textures. Local +Y is the blade
 * direction, the flat of the blade faces ±Z and the grip centre is at the
 * origin (that is where the hand holds it).
 */

function bladeGeometry(length, width, thickness = 0.012) {
  const w = width / 2;
  const s = new THREE.Shape();
  s.moveTo(-w, 0);
  s.lineTo(-w * 0.92, length * 0.78);
  s.quadraticCurveTo(-w * 0.8, length * 0.93, 0, length);
  s.quadraticCurveTo(w * 0.8, length * 0.93, w * 0.92, length * 0.78);
  s.lineTo(w, 0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.5,
    bevelSize: width * 0.16,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.translate(0, 0, -thickness / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getY(i) / length, (pos.getX(i) + w) / (w * 2));
  }
  geo.computeVertexNormals();
  return geo;
}

export function createWeaponMaterials(textures, glowColor) {
  const b = textures.blade;
  const blade = new THREE.MeshStandardMaterial({
    map: b.map,
    normalMap: b.normalMap,
    roughnessMap: b.roughnessMap,
    emissiveMap: b.emissiveMap,
    emissive: new THREE.Color(glowColor),
    emissiveIntensity: 2.2,
    metalness: 0.95,
    roughness: 1,
    envMapIntensity: 1.6,
  });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a656, metalness: 1, roughness: 0.28, envMapIntensity: 1.4 });
  const leather = new THREE.MeshStandardMaterial({
    map: textures.leather.map,
    normalMap: textures.leather.normalMap,
    roughness: 0.75,
  });
  leather.map.repeat.set(1, 2);
  const gem = new THREE.MeshStandardMaterial({
    color: new THREE.Color(glowColor),
    emissive: new THREE.Color(glowColor),
    emissiveIntensity: 2.5,
    roughness: 0.1,
    metalness: 0.2,
    flatShading: true,
  });
  return { blade, gold, leather, gem };
}

export function buildWeapon(kind, mats, scale = 1) {
  const g = new THREE.Group();
  let length;
  let tipY;
  if (kind === 'spear') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 2.1, 10), mats.leather);
    shaft.position.y = 0.55;
    const blade = new THREE.Mesh(bladeGeometry(0.42, 0.075, 0.014), mats.blade);
    blade.position.y = 1.6;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 12), mats.gold);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.6;
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.2, 4), mats.gold);
    wing.position.set(0.07, 1.58, 0);
    wing.rotation.z = Math.PI / 2 + 0.6;
    const wing2 = wing.clone();
    wing2.position.x = -0.07;
    wing2.rotation.z = -Math.PI / 2 - 0.6;
    const butt = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), mats.gem);
    butt.position.y = -0.5;
    g.add(shaft, blade, collar, wing, wing2, butt);
    length = 2.1;
    tipY = 2.02;
    g.userData.bladeMesh = blade;
  } else {
    const great = kind === 'greatsword';
    const L = great ? 1.45 : 0.98;
    const W = great ? 0.12 : 0.06;
    const blade = new THREE.Mesh(bladeGeometry(L, W, great ? 0.02 : 0.012), mats.blade);
    blade.position.y = 0.11;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(W * 3.4, 0.032, 0.05), mats.gold);
    guard.position.y = 0.1;
    const tipGeo = new THREE.TorusGeometry(0.035 * (great ? 1.5 : 1), 0.011, 6, 12, Math.PI * 1.2);
    const t1 = new THREE.Mesh(tipGeo, mats.gold);
    t1.position.set(W * 1.7, 0.12, 0);
    t1.rotation.z = -0.4;
    const t2 = new THREE.Mesh(tipGeo, mats.gold);
    t2.position.set(-W * 1.7, 0.12, 0);
    t2.rotation.z = Math.PI + 0.4;
    t2.rotation.y = Math.PI;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.024 * (great ? 1.4 : 1)), mats.gem);
    gem.position.set(0, 0.1, 0.03);
    const gem2 = gem.clone();
    gem2.position.z = -0.03;
    const gripLen = great ? 0.34 : 0.2;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, gripLen, 12), mats.leather);
    grip.position.y = 0.1 - gripLen / 2 - 0.02;
    const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), mats.gold);
    pommel.position.y = 0.1 - gripLen - 0.045;
    pommel.scale.y = 1.4;
    const pommelGem = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mats.gem);
    pommelGem.position.copy(pommel.position);
    pommelGem.position.z = 0.022;
    g.add(blade, guard, t1, t2, gem, gem2, grip, pommel, pommelGem);
    // shift so the grip centre sits at the origin
    for (const c of g.children) c.position.y -= 0.1 - gripLen / 2 - 0.02;
    length = L;
    tipY = 0.11 + L - (0.1 - gripLen / 2 - 0.02);
    g.userData.bladeMesh = blade;
  }
  g.scale.setScalar(scale);
  g.userData.tip = new THREE.Vector3(0, tipY, 0);
  g.userData.base = new THREE.Vector3(0, kind === 'spear' ? 1.6 : tipY - length * 0.92, 0);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}
