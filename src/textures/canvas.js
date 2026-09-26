import * as THREE from 'three';

let maxAniso = 8;
export const setMaxAnisotropy = (n) => (maxAniso = n);

export function makeCanvas(w, h = w) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, ctx };
}

export function toTexture(canvas, { srgb = true, repeat = false, aniso = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso ? maxAniso : 1;
  tex.needsUpdate = true;
  return tex;
}

/** Read a canvas channel into a Float32 mask (0..1). */
export function readMask(canvas, channel = 0) {
  const { width: w, height: h } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = data[i * 4 + channel] / 255;
  return out;
}

/** Pixel buffer that is written per-pixel and then turned into a texture. */
export class PixelBuffer {
  constructor(w, h = w) {
    this.w = w;
    this.h = h;
    const { canvas, ctx } = makeCanvas(w, h);
    this.canvas = canvas;
    this.ctx = ctx;
    this.img = ctx.createImageData(w, h);
    this.data = this.img.data;
  }

  set(i, r, g, b) {
    const k = i * 4;
    this.data[k] = r < 0 ? 0 : r > 1 ? 255 : r * 255;
    this.data[k + 1] = g < 0 ? 0 : g > 1 ? 255 : g * 255;
    this.data[k + 2] = b < 0 ? 0 : b > 1 ? 255 : b * 255;
    this.data[k + 3] = 255;
  }

  commit() {
    this.ctx.putImageData(this.img, 0, 0);
    return this.canvas;
  }

  texture(opts) {
    this.commit();
    return toTexture(this.canvas, opts);
  }
}

/**
 * Convert a height field into a tangent-space normal map.
 * Canvas rows run top→bottom while v runs bottom→top (flipY), hence the sign.
 */
export function heightToNormal(height, w, h, strength = 3, wrap = false) {
  const buf = new PixelBuffer(w, h);
  const at = (x, y) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else {
      x = x < 0 ? 0 : x >= w ? w - 1 : x;
      y = y < 0 ? 0 : y >= h ? h - 1 : y;
    }
    return height[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
      const dy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
      let nx = -dx * strength * (w / 256);
      let ny = dy * strength * (h / 256);
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      buf.set(y * w + x, nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5);
    }
  }
  return buf.texture({ srgb: false });
}

/** A random rune-like glyph drawn from strokes on a 3×3 lattice. */
export function drawGlyph(ctx, cx, cy, size, rng) {
  const pts = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) pts.push([cx + (i - 1) * size * 0.5, cy + (j - 1) * size * 0.5]);
  const strokes = 2 + Math.floor(rng() * 3);
  ctx.beginPath();
  for (let s = 0; s < strokes; s++) {
    const a = pts[Math.floor(rng() * 9)];
    const b = pts[Math.floor(rng() * 9)];
    const kind = rng();
    if (kind < 0.55) {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    } else if (kind < 0.8) {
      const r = size * (0.18 + rng() * 0.3);
      const st = rng() * Math.PI * 2;
      ctx.moveTo(a[0] + Math.cos(st) * r, a[1] + Math.sin(st) * r);
      ctx.arc(a[0], a[1], r, st, st + Math.PI * (0.8 + rng() * 1.1));
    } else {
      ctx.moveTo(a[0] + size * 0.08, a[1]);
      ctx.arc(a[0], a[1], size * 0.08, 0, Math.PI * 2);
    }
  }
  ctx.stroke();
}

/** Recursive branching crack path, stroked with its path-order in the red channel. */
export function drawCrackTree(ctx, x, y, angle, width, rng, size, depth = 0, travelled = 0) {
  const maxLen = size * 0.62;
  let px = x;
  let py = y;
  let a = angle;
  let t = travelled;
  for (let step = 0; step < 90; step++) {
    const len = size * (0.012 + rng() * 0.02);
    a += (rng() - 0.5) * 0.9;
    const nx = px + Math.cos(a) * len;
    const ny = py + Math.sin(a) * len;
    t += len;
    const order = Math.min(1, t / maxLen);
    ctx.strokeStyle = `rgb(${Math.round(order * 255)},255,0)`;
    ctx.lineWidth = Math.max(0.8, width * (1 - order * 0.55));
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    px = nx;
    py = ny;
    if (px < -4 || py < -4 || px > size + 4 || py > size + 4) break;
    if (depth < 3 && rng() < 0.085) {
      const side = rng() < 0.5 ? -1 : 1;
      drawCrackTree(ctx, px, py, a + side * (0.5 + rng() * 0.7), width * 0.6, rng, size, depth + 1, t);
    }
    if (depth > 0 && rng() < 0.03) break;
  }
}
