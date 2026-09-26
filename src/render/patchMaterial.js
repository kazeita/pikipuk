/**
 * Inject GLSL into a built-in material while keeping all of three.js's
 * lighting, shadows and fog. `uniforms` objects are shared by reference, so
 * mutating `uniforms.x.value` later updates the shader.
 */
export function patchMaterial(material, opts) {
  const { key, uniforms = {}, vertexPars, vertexBegin, fragmentPars, fragmentMap, fragmentEmissive, fragmentEnd } = opts;
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const rep = (src, hook, code, after = true) =>
      code ? src.replace(hook, after ? `${hook}\n${code}` : `${code}\n${hook}`) : src;
    shader.vertexShader = rep(shader.vertexShader, '#include <common>', vertexPars);
    shader.vertexShader = rep(shader.vertexShader, '#include <begin_vertex>', vertexBegin);
    shader.fragmentShader = rep(shader.fragmentShader, '#include <common>', fragmentPars);
    shader.fragmentShader = rep(shader.fragmentShader, '#include <map_fragment>', fragmentMap);
    shader.fragmentShader = rep(shader.fragmentShader, '#include <emissivemap_fragment>', fragmentEmissive);
    shader.fragmentShader = rep(shader.fragmentShader, '#include <dithering_fragment>', fragmentEnd);
  };
  material.customProgramCacheKey = () => key;
  return material;
}

/** Shared GLSL: cheap 3D value noise. */
export const GLSL_NOISE = /* glsl */ `
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i + vec3(0,0,0)), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;
