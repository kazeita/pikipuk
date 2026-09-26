import { Noise } from './noise.js';
import { makeCanvas, readMask, PixelBuffer, heightToNormal, drawGlyph, drawCrackTree, toTexture } from './canvas.js';
import { mulberry32, smoothstep } from '../core/math.js';

/**
 * One variant of the arena's carved moonstone tile.
 *
 * Produces:
 *  map          – albedo: veined slate, worn bevels, carved medallion, moss, hairline cracks
 *  normalMap    – from the carved height field
 *  roughnessMap – polished medallion, rough grooves and moss
 *  runeMap      – R: rune ring glow, G: the sleeping-eye glyph (trap tell), B: silver inlay + lichen specks
 *  crackMap     – R/G: crack path order, used to grow glowing cracks when a tile is about to fall
 */
export function generateTileSet(size, seed) {
  const rng = mulberry32(seed);
  const noise = new Noise(seed * 7 + 3);
  const S = size;
  const C = S / 2;

  // --- vector layers drawn with canvas ----------------------------------
  const rune = makeCanvas(S);
  const eye = makeCanvas(S);
  const inlay = makeCanvas(S);
  const carve = makeCanvas(S);
  const hair = makeCanvas(S);
  for (const l of [rune, eye, inlay, carve, hair]) {
    l.ctx.fillStyle = '#000';
    l.ctx.fillRect(0, 0, S, S);
    l.ctx.lineCap = 'round';
    l.ctx.lineJoin = 'round';
  }

  // Frame groove + inlay line
  const frame = S * 0.085;
  carve.ctx.strokeStyle = '#fff';
  carve.ctx.lineWidth = S * 0.016;
  carve.ctx.strokeRect(frame, frame, S - frame * 2, S - frame * 2);
  inlay.ctx.strokeStyle = '#fff';
  inlay.ctx.lineWidth = S * 0.0045;
  inlay.ctx.strokeRect(frame, frame, S - frame * 2, S - frame * 2);

  // Corner ornaments: quarter moons and diamonds
  for (const [cx, cy, rot] of [
    [frame, frame, 0],
    [S - frame, frame, Math.PI / 2],
    [S - frame, S - frame, Math.PI],
    [frame, S - frame, -Math.PI / 2],
  ]) {
    for (const ctx of [carve.ctx, inlay.ctx]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = ctx === carve.ctx ? S * 0.01 : S * 0.004;
      ctx.beginPath();
      ctx.arc(0, 0, S * 0.07, 0, Math.PI / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(S * 0.035, S * 0.02);
      ctx.lineTo(S * 0.05, S * 0.035);
      ctx.lineTo(S * 0.035, S * 0.05);
      ctx.lineTo(S * 0.02, S * 0.035);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  // Medallion rings
  const rOuter = S * 0.33;
  const rInner = S * 0.235;
  carve.ctx.strokeStyle = '#fff';
  for (const [r, w] of [
    [rOuter, 0.012],
    [rOuter - S * 0.018, 0.005],
    [rInner, 0.01],
    [S * 0.13, 0.006],
  ]) {
    carve.ctx.lineWidth = S * w;
    carve.ctx.beginPath();
    carve.ctx.arc(C, C, r, 0, Math.PI * 2);
    carve.ctx.stroke();
  }
  inlay.ctx.lineWidth = S * 0.0035;
  inlay.ctx.beginPath();
  inlay.ctx.arc(C, C, rOuter - S * 0.018, 0, Math.PI * 2);
  inlay.ctx.stroke();

  // Rune ring
  const glyphs = 14;
  rune.ctx.strokeStyle = '#fff';
  rune.ctx.lineWidth = S * 0.0075;
  const rMid = (rOuter + rInner) / 2 - S * 0.008;
  for (let i = 0; i < glyphs; i++) {
    const a = (i / glyphs) * Math.PI * 2;
    rune.ctx.save();
    rune.ctx.translate(C + Math.cos(a) * rMid, C + Math.sin(a) * rMid);
    rune.ctx.rotate(a + Math.PI / 2);
    drawGlyph(rune.ctx, 0, 0, S * 0.055, rng);
    rune.ctx.restore();
  }
  // Star ticks between medallion and eye
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const r0 = S * 0.145;
    const r1 = S * (i % 2 ? 0.19 : 0.215);
    rune.ctx.lineWidth = S * 0.005;
    rune.ctx.beginPath();
    rune.ctx.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
    rune.ctx.lineTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
    rune.ctx.stroke();
  }

  // The sleeping eye (every tile carries it; only trap tiles let it glow)
  {
    const g = eye.ctx;
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineWidth = S * 0.009;
    const w = S * 0.085;
    const h = S * 0.045;
    g.beginPath();
    g.moveTo(C - w, C);
    g.quadraticCurveTo(C, C - h * 1.6, C + w, C);
    g.quadraticCurveTo(C, C + h * 1.6, C - w, C);
    g.stroke();
    g.beginPath();
    g.arc(C, C, S * 0.024, 0, Math.PI * 2);
    g.fill();
    // lashes
    g.lineWidth = S * 0.005;
    for (let i = -2; i <= 2; i++) {
      const x = C + i * w * 0.38;
      const y = C + h * 0.78 * (1 - Math.abs(i) * 0.18);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + i * S * 0.006, y + S * 0.028);
      g.stroke();
    }
  }
  carve.ctx.drawImage(rune.canvas, 0, 0);
  carve.ctx.globalCompositeOperation = 'lighten';
  carve.ctx.drawImage(eye.canvas, 0, 0);
  carve.ctx.globalCompositeOperation = 'source-over';

  // Permanent hairline cracks (weathering, not the trap cracks)
  hair.ctx.strokeStyle = '#fff';
  for (let k = 0; k < 3; k++) {
    let x = rng() * S;
    let y = rng() < 0.5 ? 0 : S;
    let a = Math.atan2(C - y, C - x) + (rng() - 0.5);
    hair.ctx.lineWidth = 1 + rng() * 1.2;
    hair.ctx.beginPath();
    hair.ctx.moveTo(x, y);
    const steps = 10 + rng() * 22;
    for (let s = 0; s < steps; s++) {
      a += (rng() - 0.5) * 0.8;
      x += Math.cos(a) * S * 0.012;
      y += Math.sin(a) * S * 0.012;
      hair.ctx.lineTo(x, y);
    }
    hair.ctx.stroke();
  }

  // Soft glow versions of the emissive layers
  const soften = (layer, px) => {
    const { canvas, ctx } = makeCanvas(S);
    ctx.filter = `blur(${px}px)`;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'lighten';
    ctx.drawImage(layer.canvas, 0, 0);
    return canvas;
  };
  const carveSoft = makeCanvas(S);
  carveSoft.ctx.filter = `blur(${S / 340}px)`;
  carveSoft.ctx.drawImage(carve.canvas, 0, 0);

  const mCarve = readMask(carveSoft.canvas);
  const mHair = readMask(hair.canvas);
  const mRune = readMask(soften(rune, S / 260));
  const mEye = readMask(soften(eye, S / 200));
  const mInlay = readMask(inlay.canvas);

  // --- per-pixel material ------------------------------------------------
  const albedo = new PixelBuffer(S);
  const rough = new PixelBuffer(S);
  const runeBuf = new PixelBuffer(S);
  const height = new Float32Array(S * S);
  const hue = rng();
  const baseA = [0.13 + hue * 0.03, 0.14, 0.21 + hue * 0.04];
  const baseB = [0.25, 0.26, 0.35];

  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const i = y * S + x;
      const d = Math.min(u, v, 1 - u, 1 - v);
      const r = Math.hypot(u - 0.5, v - 0.5);
      const n = noise.fbm(u * 5, v * 5, 5);
      const warp = noise.fbm(u * 2.5 + 7.3, v * 2.5 + 1.1, 4);
      const fine = noise.value(u * 90, v * 90) * 0.55 + noise.value(u * 190, v * 190) * 0.45;
      const vein = Math.pow(1 - Math.abs(Math.sin((u * 2.2 + v * 3.1 + warp * 4.2) * Math.PI)), 22);
      const vein2 = Math.pow(1 - Math.abs(Math.sin((u * -3.7 + v * 1.4 + warp * 6.0) * Math.PI)), 40);

      // Worn bevel and chipped edges
      const bevel = smoothstep(0, 0.03, d);
      const chipN = noise.fbm(u * 26 + 3, v * 26 + 9, 3);
      const chip = d < 0.06 ? Math.max(0, chipN - 0.6) * 2.4 * (1 - d / 0.06) : 0;
      const pits = Math.max(0, noise.value(u * 70 + 5, v * 70 + 2) - 0.86) * 3;

      const carveV = mCarve[i];
      const polish = 1 - smoothstep(0.16, 0.36, r);
      const mossN = noise.fbm(u * 7 + 11, v * 7 + 5, 4);
      const moss = smoothstep(0.58, 0.78, mossN + carveV * 0.28 + (1 - smoothstep(0, 0.1, d)) * 0.22 - polish * 0.25);

      height[i] = 0.55 * bevel + 0.14 * n + 0.04 * fine - 0.5 * carveV - chip - pits * 0.3 - mHair[i] * 0.3 + moss * 0.06;

      // Albedo
      let cr = baseA[0] + (baseB[0] - baseA[0]) * n;
      let cg = baseA[1] + (baseB[1] - baseA[1]) * n;
      let cb = baseA[2] + (baseB[2] - baseA[2]) * n;
      const veinL = vein * 0.28 + vein2 * 0.18;
      cr += veinL * 0.9;
      cg += veinL * 0.92;
      cb += veinL;
      const grain = 0.86 + fine * 0.22;
      cr *= grain;
      cg *= grain;
      cb *= grain;
      // polished medallion: slightly cooler + brighter
      cr += polish * 0.02;
      cg += polish * 0.03;
      cb += polish * 0.06;
      // carved grooves are dark and dusty
      const dark = 1 - carveV * 0.6 - mHair[i] * 0.45 - pits * 0.3;
      cr *= dark;
      cg *= dark;
      cb *= dark;
      // edge wear catches light
      const wear = (1 - bevel) * 0.18 + chip * 0.2;
      cr += wear;
      cg += wear;
      cb += wear * 1.1;
      // moss / lichen – teal, dreamlike
      const mossCol = [0.12 + fine * 0.05, 0.24 + fine * 0.08, 0.24 + fine * 0.05];
      cr = cr * (1 - moss) + mossCol[0] * moss;
      cg = cg * (1 - moss) + mossCol[1] * moss;
      cb = cb * (1 - moss) + mossCol[2] * moss;
      albedo.set(i, cr, cg, cb);

      const ro = 0.66 + n * 0.16 - polish * 0.28 + carveV * 0.22 + moss * 0.25 + (1 - bevel) * 0.05;
      rough.set(i, ro, ro, ro);

      const speck = noise.value(u * 210 + 1, v * 210 + 7) > 0.9 ? moss * 0.9 : 0;
      runeBuf.set(i, mRune[i], mEye[i], Math.min(1, mInlay[i] * 0.9 + speck));
    }
  }

  // --- the trap crack map ------------------------------------------------
  const crack = makeCanvas(S);
  crack.ctx.fillStyle = '#000';
  crack.ctx.fillRect(0, 0, S, S);
  crack.ctx.lineCap = 'round';
  const ox = C + (rng() - 0.5) * S * 0.12;
  const oy = C + (rng() - 0.5) * S * 0.12;
  const arms = 5 + Math.floor(rng() * 3);
  for (let k = 0; k < arms; k++) {
    const a = (k / arms) * Math.PI * 2 + rng() * 0.6;
    drawCrackTree(crack.ctx, ox, oy, a, S * 0.012, rng, S);
  }
  // small shatter ring around origin
  crack.ctx.strokeStyle = 'rgb(20,255,0)';
  crack.ctx.lineWidth = S * 0.006;
  crack.ctx.beginPath();
  for (let k = 0; k <= 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const rr = S * (0.035 + rng() * 0.02);
    const px = ox + Math.cos(a) * rr;
    const py = oy + Math.sin(a) * rr;
    if (k === 0) crack.ctx.moveTo(px, py);
    else crack.ctx.lineTo(px, py);
  }
  crack.ctx.stroke();

  return {
    map: albedo.texture({ srgb: true }),
    roughnessMap: rough.texture({ srgb: false }),
    normalMap: heightToNormal(height, S, S, 5.5),
    runeMap: runeBuf.texture({ srgb: false }),
    crackMap: toTexture(crack.canvas, { srgb: false }),
  };
}
