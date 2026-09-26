import * as THREE from 'three';

/**
 * Final screen-space pass (runs after tone mapping): chromatic aberration,
 * dash motion blur, dream colour grade, vignette, damage tint, grain, fades.
 */
export const DreamShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 0.0025 },
    uDash: { value: 0 },
    uDamage: { value: 0 },
    uLowHealth: { value: 0 },
    uVignette: { value: 1 },
    uGrain: { value: 0.035 },
    uSaturation: { value: 1.05 },
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color(0xe8e0ff) },
    uWarp: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uDash, uDamage, uLowHealth, uVignette, uGrain, uSaturation, uFade, uWarp;
    uniform vec2 uResolution;
    uniform vec3 uFadeColor;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r = length(c * vec2(uResolution.x / uResolution.y, 1.0)) * 0.8;

      // slow dream "breathing" warp at the edges, stronger while falling / respawning
      float w = 0.0035 + uWarp * 0.02;
      uv += c * sin(uTime * 0.6 + r * 6.0) * w * r;

      float ab = uAberration * (0.3 + r * 2.2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;

      if (uDash > 0.002) {
        vec3 acc = col;
        for (int i = 1; i < 10; i++) {
          float s = float(i) / 10.0 * uDash * 0.075;
          acc += texture2D(tDiffuse, uv - c * s).rgb;
        }
        col = mix(col, acc / 10.0, smoothstep(0.05, 0.35, r));
      }

      // dream grade: indigo shadows, cool mids, a touch of rose in highlights
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col += vec3(0.010, 0.006, 0.030) * (1.0 - smoothstep(0.0, 0.35, l));
      col *= mix(vec3(0.95, 0.96, 1.06), vec3(1.04, 0.99, 1.02), smoothstep(0.5, 1.0, l));
      col = mix(vec3(l), col, uSaturation - uLowHealth * 0.45);

      float vig = smoothstep(0.95, 0.2, r * uVignette);
      col *= mix(0.5, 1.0, vig);

      float pulse = 0.6 + 0.4 * sin(uTime * 7.0);
      col = mix(col, vec3(0.55, 0.04, 0.3), clamp(uDamage + uLowHealth * 0.35 * pulse, 0.0, 1.0) * smoothstep(0.2, 0.85, r));

      col += (hash(vUv * uResolution + fract(uTime) * 91.0) - 0.5) * uGrain;
      col = mix(col, uFadeColor, uFade);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
