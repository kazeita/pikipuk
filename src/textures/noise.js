import { mulberry32 } from '../core/math.js';

/**
 * Seeded, optionally tileable value noise with fBm helpers.
 * Returns values in [0, 1].
 */
export class Noise {
  constructor(seed = 1) {
    const rng = mulberry32(seed);
    const p = new Uint16Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint16Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.vals[i] = rng();
  }

  value(x, y, period = 0) {
    let xi = Math.floor(x);
    let yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    let x1 = xi + 1;
    let y1 = yi + 1;
    if (period) {
      xi = ((xi % period) + period) % period;
      yi = ((yi % period) + period) % period;
      x1 = ((x1 % period) + period) % period;
      y1 = ((y1 % period) + period) % period;
    }
    const P = this.perm;
    const V = this.vals;
    const a = V[P[P[xi & 255] + (yi & 255)]];
    const b = V[P[P[x1 & 255] + (yi & 255)]];
    const c = V[P[P[xi & 255] + (y1 & 255)]];
    const d = V[P[P[x1 & 255] + (y1 & 255)]];
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  fbm(x, y, octaves = 5, period = 0, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.value(x * f, y * f, period ? period * f : 0);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }

  ridged(x, y, octaves = 5, period = 0) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.value(x * f, y * f, period ? period * f : 0) * 2 - 1);
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}
