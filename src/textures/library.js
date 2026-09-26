import { Noise } from './noise.js';
import { makeCanvas, PixelBuffer, heightToNormal, drawGlyph, drawCrackTree, toTexture, readMask } from './canvas.js';
import { mulberry32, smoothstep, clamp } from '../core/math.js';

/* -------------------------------------------------------------------------- */
/* Rock: tileable strata for slab sides, floating islands and ruins            */
/* -------------------------------------------------------------------------- */
export function rockTexture(size = 512, seed = 11, { moss = 0.3, veins = true } = {}) {
  const noise = new Noise(seed);
  const S = size;
  const albedo = new PixelBuffer(S);
  const rough = new PixelBuffer(S);
  const emis = new PixelBuffer(S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const i = y * S + x;
      const warp = noise.fbm(u * 4, v * 4, 4, 4);
      const strata = Math.sin((v * 10 + warp * 1.6) * Math.PI * 2) * 0.5 + 0.5;
      const n = noise.fbm(u * 8, v * 8, 5, 8);
      const rid = noise.ridged(u * 6, v * 6, 4, 6);
      const fine = noise.value(u * 128, v * 128, 128);
      const crackL = Math.pow(rid, 6);
      const h = 0.45 * n + 0.25 * strata + 0.08 * fine - crackL * 0.5;
      height[i] = h;
      const m = smoothstep(0.62 - moss * 0.25, 0.8, noise.fbm(u * 5 + 3, v * 5 + 8, 4, 5) + (1 - v) * 0.1);
      let r = 0.13 + n * 0.12 + strata * 0.05;
      let g = 0.13 + n * 0.12 + strata * 0.05;
      let b = 0.19 + n * 0.15 + strata * 0.07;
      const k = 1 - crackL * 0.7;
      r *= k * (0.9 + fine * 0.2);
      g *= k * (0.9 + fine * 0.2);
      b *= k * (0.9 + fine * 0.2);
      r = r * (1 - m) + 0.09 * m;
      g = g * (1 - m) + (0.2 + fine * 0.06) * m;
      b = b * (1 - m) + 0.2 * m;
      albedo.set(i, r, g, b);
      const ro = 0.78 + n * 0.15 - strata * 0.05;
      rough.set(i, ro, ro, ro);
      // faint crystal seams that glow in the dark
      const seam = veins ? Math.pow(noise.ridged(u * 3 + 9, v * 3 + 2, 3, 3), 14) : 0;
      const speck = noise.value(u * 200, v * 200, 200) > 0.93 ? m * 0.8 : 0;
      emis.set(i, seam * 0.5 + speck * 0.2, seam * 0.7 + speck, seam + speck * 0.9);
    }
  }
  return {
    map: albedo.texture({ repeat: true }),
    roughnessMap: rough.texture({ srgb: false, repeat: true }),
    normalMap: heightToNormal(height, S, S, 4, true),
    emissiveMap: emis.texture({ repeat: true }),
  };
}

/* -------------------------------------------------------------------------- */
/* Engraved dream-steel for the knights' armour                              */
/* -------------------------------------------------------------------------- */
export function armorTexture(size = 512, seed = 21) {
  const rng = mulberry32(seed);
  const noise = new Noise(seed);
  const S = size;
  const engr = makeCanvas(S);
  const riv = makeCanvas(S);
  const scr = makeCanvas(S);
  for (const l of [engr, riv, scr]) {
    l.ctx.fillStyle = '#000';
    l.ctx.fillRect(0, 0, S, S);
    l.ctx.strokeStyle = '#fff';
    l.ctx.fillStyle = '#fff';
    l.ctx.lineCap = 'round';
  }
  // filigree curls
  engr.ctx.lineWidth = S * 0.006;
  for (let k = 0; k < 16; k++) {
    const cx = rng() * S;
    const cy = rng() * S;
    const dir = rng() < 0.5 ? 1 : -1;
    const turns = 1.4 + rng() * 1.4;
    const r0 = S * (0.03 + rng() * 0.05);
    engr.ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.01) {
      const a = dir * t * turns * Math.PI * 2;
      const r = r0 * (1 - t * 0.85);
      const x = cx + Math.cos(a) * r + t * S * 0.08 * dir;
      const y = cy + Math.sin(a) * r;
      if (t === 0) engr.ctx.moveTo(x, y);
      else engr.ctx.lineTo(x, y);
    }
    engr.ctx.stroke();
    // leaf flicks
    for (let f = 0; f < 3; f++) {
      const a = rng() * Math.PI * 2;
      engr.ctx.beginPath();
      engr.ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      engr.ctx.quadraticCurveTo(
        cx + Math.cos(a + 0.4) * r0 * 1.7,
        cy + Math.sin(a + 0.4) * r0 * 1.7,
        cx + Math.cos(a + 0.2) * r0 * 2.2,
        cy + Math.sin(a + 0.2) * r0 * 2.2,
      );
      engr.ctx.stroke();
    }
  }
  // plate seams + border bands
  engr.ctx.lineWidth = S * 0.012;
  for (const y of [0.12, 0.5, 0.88]) {
    engr.ctx.beginPath();
    engr.ctx.moveTo(0, y * S);
    engr.ctx.lineTo(S, y * S);
    engr.ctx.stroke();
  }
  engr.ctx.lineWidth = S * 0.004;
  for (const y of [0.105, 0.135, 0.485, 0.515, 0.865, 0.895]) {
    engr.ctx.beginPath();
    engr.ctx.moveTo(0, y * S);
    engr.ctx.lineTo(S, y * S);
    engr.ctx.stroke();
  }
  // rivets along seams
  for (const y of [0.12, 0.5, 0.88]) {
    for (let x = S / 24; x < S; x += S / 12) {
      riv.ctx.beginPath();
      riv.ctx.arc(x, y * S + S * 0.035, S * 0.009, 0, Math.PI * 2);
      riv.ctx.fill();
    }
  }
  // scratches
  scr.ctx.lineWidth = 1;
  for (let k = 0; k < 90; k++) {
    const x = rng() * S;
    const y = rng() * S;
    const a = rng() * Math.PI;
    const l = S * (0.01 + rng() * 0.06);
    scr.ctx.globalAlpha = 0.3 + rng() * 0.6;
    scr.ctx.beginPath();
    scr.ctx.moveTo(x, y);
    scr.ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    scr.ctx.stroke();
  }
  const blur = makeCanvas(S);
  blur.ctx.filter = 'blur(1.2px)';
  blur.ctx.drawImage(riv.canvas, 0, 0);
  const mE = readMask(engr.canvas);
  const mR = readMask(blur.canvas);
  const mS = readMask(scr.canvas);

  const albedo = new PixelBuffer(S);
  const rough = new PixelBuffer(S);
  const emis = new PixelBuffer(S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const i = y * S + x;
      const brushed = noise.value(u * 6, v * 180, 0) * 0.6 + noise.value(u * 3, v * 400) * 0.4;
      const n = noise.fbm(u * 6, v * 6, 4);
      const tarn = smoothstep(0.55, 0.8, noise.fbm(u * 3 + 5, v * 3 + 1, 4));
      height[i] = n * 0.2 + brushed * 0.05 - mE[i] * 0.55 + mR[i] * 0.9 - mS[i] * 0.08;
      let base = 0.2 + n * 0.1 + brushed * 0.06;
      let r = base * 0.95;
      let g = base * 0.93;
      let b = base * 1.08;
      // tarnish drifts toward oil-slick violet
      r = r * (1 - tarn * 0.4) + 0.2 * tarn * 0.4;
      g = g * (1 - tarn * 0.4) + 0.12 * tarn * 0.4;
      b = b * (1 - tarn * 0.4) + 0.3 * tarn * 0.4;
      const eng = 1 - mE[i] * 0.75;
      r = r * eng + mS[i] * 0.25 + mR[i] * 0.15;
      g = g * eng + mS[i] * 0.25 + mR[i] * 0.15;
      b = b * eng + mS[i] * 0.28 + mR[i] * 0.18;
      albedo.set(i, r, g, b);
      const ro = 0.3 + brushed * 0.12 + tarn * 0.15 + mE[i] * 0.45 - mS[i] * 0.1;
      rough.set(i, ro, ro, ro);
      const e = mE[i] * (0.35 + n * 0.5);
      emis.set(i, e, e, e);
    }
  }
  return {
    map: albedo.texture(),
    roughnessMap: rough.texture({ srgb: false }),
    normalMap: heightToNormal(height, S, S, 5),
    emissiveMap: emis.texture(),
  };
}

/* -------------------------------------------------------------------------- */
/* Star-embroidered cloak cloth                                              */
/* -------------------------------------------------------------------------- */
export function clothTexture(size = 512, seed = 31) {
  const rng = mulberry32(seed);
  const noise = new Noise(seed);
  const S = size;
  const emb = makeCanvas(S);
  const glow = makeCanvas(S);
  for (const l of [emb, glow]) {
    l.ctx.fillStyle = '#000';
    l.ctx.fillRect(0, 0, S, S);
    l.ctx.strokeStyle = '#fff';
    l.ctx.fillStyle = '#fff';
  }
  // constellations
  for (let c = 0; c < 14; c++) {
    const cx = rng() * S;
    const cy = rng() * S * 0.78;
    const stars = [];
    const count = 3 + Math.floor(rng() * 4);
    for (let s = 0; s < count; s++) stars.push([cx + (rng() - 0.5) * S * 0.22, cy + (rng() - 0.5) * S * 0.18]);
    emb.ctx.lineWidth = 1.2;
    emb.ctx.globalAlpha = 0.7;
    emb.ctx.beginPath();
    stars.forEach((p, k) => (k === 0 ? emb.ctx.moveTo(p[0], p[1]) : emb.ctx.lineTo(p[0], p[1])));
    emb.ctx.stroke();
    emb.ctx.globalAlpha = 1;
    for (const [sx, sy] of stars) {
      const r = S * (0.006 + rng() * 0.008);
      for (const ctx of [emb.ctx, glow.ctx]) {
        ctx.beginPath();
        ctx.moveTo(sx, sy - r * 2);
        ctx.lineTo(sx + r * 0.4, sy - r * 0.4);
        ctx.lineTo(sx + r * 2, sy);
        ctx.lineTo(sx + r * 0.4, sy + r * 0.4);
        ctx.lineTo(sx, sy + r * 2);
        ctx.lineTo(sx - r * 0.4, sy + r * 0.4);
        ctx.lineTo(sx - r * 2, sy);
        ctx.lineTo(sx - r * 0.4, sy - r * 0.4);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  // tiny dust stars
  for (let k = 0; k < 260; k++) {
    const x = rng() * S;
    const y = rng() * S * 0.82;
    glow.ctx.globalAlpha = 0.3 + rng() * 0.5;
    glow.ctx.fillRect(x, y, 1.5, 1.5);
  }
  glow.ctx.globalAlpha = 1;
  // hem band: moon phases between gold rules
  const hy = S * 0.86;
  emb.ctx.lineWidth = S * 0.006;
  for (const y of [hy, S * 0.97]) {
    emb.ctx.beginPath();
    emb.ctx.moveTo(0, y);
    emb.ctx.lineTo(S, y);
    emb.ctx.stroke();
  }
  for (let k = 0; k < 8; k++) {
    const x = (k + 0.5) * (S / 8);
    const y = (hy + S * 0.97) / 2;
    const r = S * 0.022;
    emb.ctx.beginPath();
    emb.ctx.arc(x, y, r, 0, Math.PI * 2);
    emb.ctx.fill();
    emb.ctx.save();
    emb.ctx.globalCompositeOperation = 'destination-out';
    emb.ctx.beginPath();
    emb.ctx.arc(x + r * (((k % 4) - 1.5) * 0.6), y, r * 0.95, 0, Math.PI * 2);
    emb.ctx.fill();
    emb.ctx.restore();
  }
  const mEmb = readMask(emb.canvas);
  const glowSoft = makeCanvas(S);
  glowSoft.ctx.filter = 'blur(1.5px)';
  glowSoft.ctx.drawImage(glow.canvas, 0, 0);
  glowSoft.ctx.filter = 'none';
  glowSoft.ctx.globalCompositeOperation = 'lighten';
  glowSoft.ctx.drawImage(glow.canvas, 0, 0);
  const mGlow = readMask(glowSoft.canvas);

  const albedo = new PixelBuffer(S);
  const emis = new PixelBuffer(S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const i = y * S + x;
      const weave = (Math.sin(x * 1.9) * Math.sin(y * 1.9) * 0.5 + 0.5) * 0.5 + (Math.sin((x + y) * 0.9) * 0.5 + 0.5) * 0.5;
      const n = noise.fbm(u * 6, v * 6, 4);
      const fold = noise.fbm(u * 2, v * 9, 3);
      height[i] = weave * 0.18 + fold * 0.3 + mEmb[i] * 0.25;
      const shade = 0.75 + weave * 0.2 + n * 0.25;
      let r = 0.07 * shade;
      let g = 0.065 * shade;
      let b = 0.19 * shade;
      // gradient to deeper violet at the hem
      r += v * 0.04;
      b -= v * 0.03;
      const e = mEmb[i];
      r = r * (1 - e) + 0.78 * e;
      g = g * (1 - e) + 0.62 * e;
      b = b * (1 - e) + 0.34 * e;
      albedo.set(i, r, g, b);
      const gl = mGlow[i];
      emis.set(i, gl * 0.8, gl * 0.85, gl);
    }
  }
  return {
    map: albedo.texture(),
    emissiveMap: emis.texture(),
    normalMap: heightToNormal(height, S, S, 3),
  };
}

/* -------------------------------------------------------------------------- */
/* Porcelain dream mask with kintsugi and painted tears                       */
/* -------------------------------------------------------------------------- */
export function maskTexture(size = 512, seed = 41, tearHue = '#6a5cff') {
  const rng = mulberry32(seed);
  const noise = new Noise(seed);
  const S = size;
  const paint = makeCanvas(S);
  const gold = makeCanvas(S);
  const eyes = makeCanvas(S);
  const holes = makeCanvas(S);
  for (const l of [gold, eyes, holes]) {
    l.ctx.fillStyle = '#000';
    l.ctx.fillRect(0, 0, S, S);
    l.ctx.fillStyle = '#fff';
    l.ctx.strokeStyle = '#fff';
    l.ctx.lineCap = 'round';
  }
  paint.ctx.clearRect(0, 0, S, S);

  const eyeY = S * 0.5;
  const eyeDX = S * 0.14;
  for (const side of [-1, 1]) {
    const ex = S / 2 + side * eyeDX;
    // eye socket (almond)
    // painted eye-shadow
    const sh = paint.ctx.createRadialGradient(ex, eyeY, S * 0.02, ex, eyeY, S * 0.12);
    sh.addColorStop(0, 'rgba(40,20,70,0.85)');
    sh.addColorStop(1, 'rgba(40,20,70,0)');
    paint.ctx.fillStyle = sh;
    paint.ctx.beginPath();
    paint.ctx.ellipse(ex, eyeY, S * 0.12, S * 0.085, 0, 0, Math.PI * 2);
    paint.ctx.fill();
    holes.ctx.beginPath();
    holes.ctx.moveTo(ex - S * 0.1, eyeY);
    holes.ctx.quadraticCurveTo(ex, eyeY - S * 0.075, ex + S * 0.1, eyeY + side * S * 0.006);
    holes.ctx.quadraticCurveTo(ex, eyeY + S * 0.05, ex - S * 0.1, eyeY);
    holes.ctx.fill();
    // glowing iris slit
    eyes.ctx.beginPath();
    eyes.ctx.ellipse(ex, eyeY, S * 0.065, S * 0.02, 0, 0, Math.PI * 2);
    eyes.ctx.fill();
    // painted tear streaks
    paint.ctx.strokeStyle = tearHue;
    paint.ctx.lineCap = 'round';
    for (let t = 0; t < 2; t++) {
      paint.ctx.lineWidth = S * (0.012 - t * 0.004);
      paint.ctx.beginPath();
      const tx = ex + side * S * 0.01 * (t + 1);
      paint.ctx.moveTo(tx, eyeY + S * 0.045);
      paint.ctx.bezierCurveTo(tx + side * S * 0.01, eyeY + S * 0.12, tx - side * S * 0.01, eyeY + S * 0.18, tx, eyeY + S * (0.24 - t * 0.05));
      paint.ctx.stroke();
      paint.ctx.fillStyle = tearHue;
      paint.ctx.beginPath();
      paint.ctx.arc(tx, eyeY + S * (0.25 - t * 0.05), S * 0.012, 0, Math.PI * 2);
      paint.ctx.fill();
    }
    // lashes painted above the eye
    paint.ctx.strokeStyle = '#1a1830';
    paint.ctx.lineWidth = S * 0.004;
    for (let l = 0; l < 5; l++) {
      const lx = ex - S * 0.05 + l * S * 0.025;
      paint.ctx.beginPath();
      paint.ctx.moveTo(lx, eyeY - S * 0.035);
      paint.ctx.lineTo(lx + side * S * 0.004, eyeY - S * 0.06);
      paint.ctx.stroke();
    }
  }
  // forehead crescent in gold
  gold.ctx.beginPath();
  gold.ctx.arc(S / 2, S * 0.3, S * 0.05, 0, Math.PI * 2);
  gold.ctx.fill();
  gold.ctx.fillStyle = '#000';
  gold.ctx.beginPath();
  gold.ctx.arc(S / 2 + S * 0.022, S * 0.29, S * 0.045, 0, Math.PI * 2);
  gold.ctx.fill();
  gold.ctx.fillStyle = '#fff';
  // kintsugi repairs
  gold.ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const sx = S * (0.3 + rng() * 0.4);
    const sy = rng() < 0.5 ? S * 0.15 : S * 0.85;
    gold.ctx.save();
    gold.ctx.strokeStyle = 'rgb(255,255,255)';
    const tmp = makeCanvas(S);
    tmp.ctx.lineCap = 'round';
    drawCrackTree(tmp.ctx, sx, sy, sy < S / 2 ? Math.PI / 2 : -Math.PI / 2, S * 0.008, rng, S * 0.5);
    gold.ctx.globalCompositeOperation = 'lighten';
    gold.ctx.drawImage(tmp.canvas, 0, 0);
    gold.ctx.restore();
  }
  // lips: a single thin painted line
  paint.ctx.strokeStyle = '#3a1830';
  paint.ctx.lineWidth = S * 0.006;
  paint.ctx.beginPath();
  paint.ctx.moveTo(S * 0.45, S * 0.78);
  paint.ctx.quadraticCurveTo(S * 0.5, S * 0.8, S * 0.55, S * 0.78);
  paint.ctx.stroke();

  const pData = paint.ctx.getImageData(0, 0, S, S).data;
  const mGold = readMask(gold.canvas, 1);
  const mEyes = readMask(eyes.canvas);
  const holeBlur = makeCanvas(S);
  holeBlur.ctx.filter = 'blur(2px)';
  holeBlur.ctx.drawImage(holes.canvas, 0, 0);
  const mHole = readMask(holeBlur.canvas);
  const eyeBlur = makeCanvas(S);
  eyeBlur.ctx.filter = 'blur(4px)';
  eyeBlur.ctx.drawImage(eyes.canvas, 0, 0);
  eyeBlur.ctx.filter = 'none';
  eyeBlur.ctx.globalCompositeOperation = 'lighten';
  eyeBlur.ctx.drawImage(eyes.canvas, 0, 0);
  const mEyeGlow = readMask(eyeBlur.canvas);

  const albedo = new PixelBuffer(S);
  const rough = new PixelBuffer(S);
  const metal = new PixelBuffer(S);
  const emis = new PixelBuffer(S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const i = y * S + x;
      const n = noise.fbm(u * 5, v * 5, 4);
      const craze = Math.pow(noise.ridged(u * 18, v * 18, 3), 10);
      height[i] = n * 0.08 - mHole[i] * 0.8 + mGold[i] * 0.12 - craze * 0.05;
      let r = 0.9 - n * 0.06 - craze * 0.12;
      let g = 0.885 - n * 0.06 - craze * 0.12;
      let b = 0.86 - n * 0.04 - craze * 0.1;
      const pa = pData[i * 4 + 3] / 255;
      if (pa > 0) {
        r = r * (1 - pa) + (pData[i * 4] / 255) * pa;
        g = g * (1 - pa) + (pData[i * 4 + 1] / 255) * pa;
        b = b * (1 - pa) + (pData[i * 4 + 2] / 255) * pa;
      }
      const gd = mGold[i];
      r = r * (1 - gd) + 0.95 * gd;
      g = g * (1 - gd) + 0.72 * gd;
      b = b * (1 - gd) + 0.35 * gd;
      const hole = mHole[i];
      r *= 1 - hole * 0.97;
      g *= 1 - hole * 0.97;
      b *= 1 - hole * 0.95;
      albedo.set(i, r, g, b);
      const ro = 0.18 + n * 0.1 + gd * 0.1 + hole * 0.6;
      rough.set(i, ro, ro, ro);
      metal.set(i, gd, gd, gd);
      // porcelain faintly luminous so the face reads in the dark; eyes blaze
      const glowBase = (1 - hole) * (0.07 + (1 - n) * 0.04) * (1 - gd);
      const e = mEyeGlow[i] * 1.4 + mEyes[i] * 0.8;
      emis.set(i, glowBase + e, glowBase + e, glowBase * 1.2 + e);
    }
  }
  return {
    map: albedo.texture(),
    roughnessMap: rough.texture({ srgb: false }),
    metalnessMap: metal.texture({ srgb: false }),
    normalMap: heightToNormal(height, S, S, 3),
    emissiveMap: emis.texture(),
  };
}

/* -------------------------------------------------------------------------- */
/* Damascus blade with a rune-filled fuller                                   */
/* -------------------------------------------------------------------------- */
export function bladeTexture(w = 1024, h = 128, seed = 51) {
  const rng = mulberry32(seed);
  const noise = new Noise(seed);
  const runes = makeCanvas(w, h);
  runes.ctx.fillStyle = '#000';
  runes.ctx.fillRect(0, 0, w, h);
  runes.ctx.strokeStyle = '#fff';
  runes.ctx.lineWidth = h * 0.035;
  runes.ctx.lineCap = 'round';
  for (let x = w * 0.08; x < w * 0.62; x += h * 0.3) drawGlyph(runes.ctx, x, h / 2, h * 0.18, rng);
  const soft = makeCanvas(w, h);
  soft.ctx.filter = 'blur(2px)';
  soft.ctx.drawImage(runes.canvas, 0, 0);
  soft.ctx.filter = 'none';
  soft.ctx.globalCompositeOperation = 'lighten';
  soft.ctx.drawImage(runes.canvas, 0, 0);
  const mR = readMask(soft.canvas);

  const albedo = new PixelBuffer(w, h);
  const rough = new PixelBuffer(w, h);
  const emis = new PixelBuffer(w, h);
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const i = y * w + x;
      const warp = noise.fbm(u * 6, v * 2, 4) * 3.2;
      const dam = Math.sin((v * 7 + u * 3 + warp) * Math.PI * 2) * 0.5 + 0.5;
      const dam2 = Math.sin((v * 13 - u * 5 + warp * 1.7) * Math.PI * 2) * 0.5 + 0.5;
      const fuller = smoothstep(0.34, 0.4, v) * (1 - smoothstep(0.6, 0.66, v));
      const edge = Math.max(1 - smoothstep(0.0, 0.14, v), smoothstep(0.86, 1, v));
      height[i] = -fuller * 0.4 + edge * -0.2 + dam * 0.02 - mR[i] * 0.2;
      let c = 0.5 + dam * 0.2 + dam2 * 0.1 - fuller * 0.18 + edge * 0.25 - mR[i] * 0.2;
      albedo.set(i, c * 0.92, c * 0.95, c * 1.05);
      const ro = 0.2 + (1 - dam) * 0.12 + fuller * 0.15 - edge * 0.1;
      rough.set(i, ro, ro, ro);
      const e = mR[i] * fuller + edge * 0.08;
      emis.set(i, e, e, e);
    }
  }
  return {
    map: albedo.texture(),
    roughnessMap: rough.texture({ srgb: false }),
    normalMap: heightToNormal(height, w, h, 2.5),
    emissiveMap: emis.texture(),
  };
}

/* -------------------------------------------------------------------------- */
/* Leather grip wrap                                                           */
/* -------------------------------------------------------------------------- */
export function leatherTexture(size = 256, seed = 61) {
  const noise = new Noise(seed);
  const S = size;
  const albedo = new PixelBuffer(S);
  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = y * S + x;
      const band = (u * 1 + v * 6) % 1;
      const wrap = Math.sin(band * Math.PI);
      const n = noise.fbm(u * 16, v * 16, 4, 16);
      height[i] = wrap * 0.6 + n * 0.2;
      const c = 0.12 + wrap * 0.1 + n * 0.08;
      albedo.set(i, c * 1.1, c * 0.8, c * 1.15);
    }
  }
  return { map: albedo.texture({ repeat: true }), normalMap: heightToNormal(height, S, S, 5, true) };
}

/* -------------------------------------------------------------------------- */
/* Moon face with maria and ray craters (alpha disk)                          */
/* -------------------------------------------------------------------------- */
export function moonTexture(size = 512, seed = 71, tint = [0.9, 0.92, 1.0]) {
  const rng = mulberry32(seed);
  const noise = new Noise(seed);
  const S = size;
  const craters = [];
  for (let k = 0; k < 70; k++) craters.push([rng(), rng(), Math.pow(rng(), 3) * 0.09 + 0.008]);
  const buf = new PixelBuffer(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = y * S + x;
      const dx = (u - 0.5) * 2;
      const dy = (v - 0.5) * 2;
      const r2 = dx * dx + dy * dy;
      if (r2 > 1) {
        buf.data[i * 4 + 3] = 0;
        continue;
      }
      const mu = Math.sqrt(1 - r2);
      const maria = smoothstep(0.45, 0.62, noise.fbm(u * 3, v * 3, 5));
      let c = 0.86 - maria * 0.28 + (noise.fbm(u * 24, v * 24, 3) - 0.5) * 0.12;
      for (const [cx, cy, cr] of craters) {
        const d = Math.hypot(u - cx, v - cy) / cr;
        if (d < 1.25) {
          if (d < 0.85) c -= 0.12 * (1 - d / 0.85);
          else if (d < 1.05) c += 0.12;
        }
      }
      const limb = 0.55 + 0.45 * Math.pow(mu, 0.5);
      c *= limb;
      buf.set(i, c * tint[0], c * tint[1], c * tint[2]);
      buf.data[i * 4 + 3] = Math.min(255, (1 - r2) * 255 * 40);
    }
  }
  return buf.texture();
}

/* -------------------------------------------------------------------------- */
/* Emissive glyph strip (armillary rings, halos)                               */
/* -------------------------------------------------------------------------- */
export function runeStripTexture(w = 2048, h = 64, seed = 81) {
  const rng = mulberry32(seed);
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  for (const y of [h * 0.12, h * 0.88]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.lineWidth = h * 0.05;
  for (let x = h * 0.4; x < w; x += h * 0.62) {
    if (rng() < 0.12) {
      ctx.beginPath();
      ctx.arc(x, h / 2, h * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    drawGlyph(ctx, x, h / 2, h * 0.44, rng);
  }
  const soft = makeCanvas(w, h);
  soft.ctx.filter = 'blur(2px)';
  soft.ctx.drawImage(canvas, 0, 0);
  soft.ctx.filter = 'none';
  soft.ctx.globalCompositeOperation = 'lighten';
  soft.ctx.drawImage(canvas, 0, 0);
  return toTexture(soft.canvas, { repeat: true });
}

/* -------------------------------------------------------------------------- */
/* Magic circle seen far below through the holes                              */
/* -------------------------------------------------------------------------- */
export function magicCircleTexture(size = 1024, seed = 91) {
  const rng = mulberry32(seed);
  const { canvas, ctx } = makeCanvas(size);
  const C = size / 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  const ring = (r, w) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(C, C, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  ring(C * 0.97, 5);
  ring(C * 0.93, 2);
  ring(C * 0.8, 3);
  ring(C * 0.55, 3);
  ring(C * 0.5, 1.5);
  ring(C * 0.2, 3);
  // glyph ring
  ctx.lineWidth = 3;
  const n = 36;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.save();
    ctx.translate(C + Math.cos(a) * C * 0.865, C + Math.sin(a) * C * 0.865);
    ctx.rotate(a + Math.PI / 2);
    drawGlyph(ctx, 0, 0, C * 0.075, rng);
    ctx.restore();
  }
  // heptagram
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i <= 7; i++) {
    const a = ((i * 3) / 7) * Math.PI * 2 - Math.PI / 2;
    const x = C + Math.cos(a) * C * 0.8;
    const y = C + Math.sin(a) * C * 0.8;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // moon phases around inner ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = C + Math.cos(a) * C * 0.66;
    const y = C + Math.sin(a) * C * 0.66;
    const r = C * 0.05;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(x + r * Math.cos(a) * ((i % 4) / 2), y + r * Math.sin(a) * ((i % 4) / 2), r * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
  }
  // eye at the heart
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(C - C * 0.14, C);
  ctx.quadraticCurveTo(C, C - C * 0.14, C + C * 0.14, C);
  ctx.quadraticCurveTo(C, C + C * 0.14, C - C * 0.14, C);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(C, C, C * 0.04, 0, Math.PI * 2);
  ctx.fill();
  const soft = makeCanvas(size);
  soft.ctx.filter = 'blur(3px)';
  soft.ctx.drawImage(canvas, 0, 0);
  soft.ctx.filter = 'none';
  soft.ctx.globalCompositeOperation = 'lighten';
  soft.ctx.drawImage(canvas, 0, 0);
  return toTexture(soft.canvas);
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */
export function glowSprite(size = 128, inner = 0.0, hard = false) {
  const { canvas, ctx } = makeCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * inner * 0.5, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(hard ? 0.25 : 0.12, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas, { srgb: false, aniso: false });
}

export function lanternTexture(size = 256, seed = 101) {
  const rng = mulberry32(seed);
  const noise = new Noise(seed);
  const buf = new PixelBuffer(size);
  const sym = makeCanvas(size);
  sym.ctx.fillStyle = '#000';
  sym.ctx.fillRect(0, 0, size, size);
  sym.ctx.strokeStyle = '#fff';
  sym.ctx.lineWidth = size * 0.02;
  sym.ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) drawGlyph(sym.ctx, (k + 0.5) * (size / 4), size * 0.5, size * 0.12, rng);
  const mS = readMask(sym.canvas);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;
      const rib = Math.pow(Math.abs(Math.sin(u * Math.PI * 8)), 40);
      const band = v < 0.08 || v > 0.92 ? 1 : 0;
      const fib = noise.fbm(u * 30, v * 4, 3, 30);
      const glow = 0.85 - Math.abs(v - 0.5) * 0.6;
      let r = (1.0 * glow + fib * 0.1) * (1 - rib * 0.5) * (1 - mS[i] * 0.6);
      let g = (0.55 * glow + fib * 0.06) * (1 - rib * 0.5) * (1 - mS[i] * 0.6);
      let b = (0.28 * glow) * (1 - rib * 0.5) * (1 - mS[i] * 0.4);
      if (band) {
        r = 0.25;
        g = 0.12;
        b = 0.1;
      }
      buf.set(i, r, g, b);
    }
  }
  return buf.texture();
}

export function ghostFrameTexture(size = 256) {
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.filter = 'blur(6px)';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, size - 16, size - 16);
  ctx.filter = 'none';
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, size - 16, size - 16);
  // faint closed eye at the centre: "the tile sleeps"
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(size * 0.4, size * 0.5);
  ctx.quadraticCurveTo(size * 0.5, size * 0.56, size * 0.6, size * 0.5);
  ctx.stroke();
  return toTexture(canvas, { srgb: false });
}

export { clamp };
