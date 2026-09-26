import * as THREE from 'three';
import { patchMaterial } from '../render/patchMaterial.js';

/**
 * The carved moonstone top of the tiles, drawn with GPU instancing. Each
 * tile's live state (cracks, rune heat, sleeping-eye glow, reform shimmer)
 * arrives as per-instance attributes, so hundreds of tiles cost one draw call
 * per texture variant.
 *
 *   aTileA = (crack, heat, eye, rune)     aTileB = (inlay, crackRot, reform, seed)
 */
export function createTileTopMaterial(set, timeU) {
  const mat = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    roughness: 1,
    metalness: 0.06,
    normalScale: new THREE.Vector2(1.35, 1.35),
  });
  return patchMaterial(mat, {
    key: 'tile-top-instanced',
    uniforms: {
      runeMap: { value: set.runeMap },
      crackMap: { value: set.crackMap },
      uTime: timeU,
    },
    vertexPars: /* glsl */ `
      attribute vec4 aTileA;
      attribute vec4 aTileB;
      varying vec4 vTileA;
      varying vec4 vTileB;
    `,
    vertexBegin: /* glsl */ `
      vTileA = aTileA;
      vTileB = aTileB;
    `,
    fragmentPars: /* glsl */ `
      uniform sampler2D runeMap;
      uniform sampler2D crackMap;
      uniform float uTime;
      varying vec4 vTileA;
      varying vec4 vTileB;
      #define uCrack vTileA.x
      #define uHeat vTileA.y
      #define uEye vTileA.z
      #define uRune vTileA.w
      #define uInlay vTileB.x
      #define uCrackRot vTileB.y
      #define uReform vTileB.z
      #define uSeed vTileB.w
      vec2 tileRotUv(vec2 uv, float a) {
        uv -= 0.5;
        float c = cos(a), s = sin(a);
        return vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
      }
    `,
    fragmentMap: /* glsl */ `
      vec3 tileRune = texture2D(runeMap, vMapUv).rgb;
      vec2 tileCr = texture2D(crackMap, tileRotUv(vMapUv, uCrackRot)).rg;
      float crOrder = tileCr.r / max(tileCr.g, 0.001);
      float tileCrack = smoothstep(0.2, 0.7, tileCr.g) * (1.0 - smoothstep(uCrack * 1.08 - 0.04, uCrack * 1.08, crOrder));
      diffuseColor.rgb *= 1.0 - tileCrack * 0.9;
    `,
    fragmentEmissive: /* glsl */ `
      float runePulse = 0.7 + 0.3 * sin(uTime * 1.2 + uSeed * 6.28 + (vMapUv.x + vMapUv.y) * 5.0);
      vec3 runeCol = mix(vec3(0.3, 0.55, 1.7), vec3(2.0, 0.3, 1.2), uHeat);
      totalEmissiveRadiance += runeCol * tileRune.r * uRune * runePulse;
      totalEmissiveRadiance += vec3(0.35, 0.65, 1.3) * tileRune.b * uInlay;
      vec3 eyeCol = mix(vec3(0.75, 0.3, 1.8), vec3(2.6, 0.35, 1.3), uHeat);
      totalEmissiveRadiance += eyeCol * tileRune.g * uEye;
      vec3 crackCol = mix(vec3(1.2, 0.45, 2.4), vec3(3.2, 0.55, 1.6), uHeat);
      totalEmissiveRadiance += crackCol * tileCrack * (1.1 + uHeat * 1.7);
      totalEmissiveRadiance += vec3(0.45, 0.7, 1.8) * uReform * (0.6 + 0.4 * tileRune.r);
    `,
  });
}
