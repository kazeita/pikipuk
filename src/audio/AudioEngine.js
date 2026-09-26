import { rand, pick, clamp } from '../core/math.js';

// Lydian-leaning scale: dreamy, unresolved.
const SCALE = [0, 2, 4, 6, 7, 9, 11];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * Everything audible is synthesised with WebAudio – no asset files.
 * A music-box ambience with a soft pad and wind, plus positional SFX for
 * swings, hits, parries and (crucially) tiles cracking around you.
 */
export class AudioEngine {
  constructor(bus) {
    this.bus = bus;
    this.ctx = null;
    this.volume = 0.8;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.lastCrackle = 0;
    this.wire();
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(this.master);

    // reverb from a generated impulse
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.6, 2.4);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.55;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.startAmbience();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /* ------------------------------------------------------------ primitives */

  out(pan = 0, gain = 1, wet = 0.2) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    g.connect(p);
    p.connect(this.sfx);
    if (wet > 0) {
      const w = ctx.createGain();
      w.gain.value = wet;
      p.connect(w).connect(this.reverb);
    }
    return g;
  }

  tone({ freq = 440, freqEnd, type = 'sine', attack = 0.005, decay = 0.3, gain = 0.3, pan = 0, wet = 0.2, delay = 0, detune = 0, dest }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(dest || this.out(pan, 1, wet));
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  noise({ type = 'bandpass', freq = 1000, freqEnd, q = 1, attack = 0.005, decay = 0.2, gain = 0.3, pan = 0, wet = 0.15, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rand(0.8, 1.2);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + attack + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.out(pan, 1, wet));
    src.start(t, rand(0, 1.5));
    src.stop(t + attack + decay + 0.05);
  }

  /** Stereo pan + distance gain for a world position relative to the listener. */
  spatial(x, z) {
    const L = this.listener;
    const dx = x - L.x;
    const dz = z - L.z;
    const dist = Math.hypot(dx, dz);
    const rx = Math.cos(L.yaw);
    const rz = -Math.sin(L.yaw);
    const pan = dist > 0.01 ? (dx * rx + dz * rz) / dist : 0;
    const gain = 1 / (1 + dist * 0.12);
    return { pan: pan * 0.85, gain, dist };
  }

  /* -------------------------------------------------------------- ambience */

  startAmbience() {
    const ctx = this.ctx;
    // drone pad
    const pad = ctx.createGain();
    pad.gain.value = 0.0;
    pad.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.Q.value = 0.7;
    pad.connect(lp).connect(this.music);
    const padWet = ctx.createGain();
    padWet.gain.value = 0.6;
    lp.connect(padWet).connect(this.reverb);
    this.padOsc = [];
    [38, 45, 50, 57].forEach((n, i) => {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = i < 2 ? 'sine' : 'triangle';
        o.frequency.value = midi(n);
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = i < 2 ? 0.5 : 0.18;
        o.connect(g).connect(pad);
        o.start();
        this.padOsc.push(o);
      }
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 260;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();

    // wind
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 420;
    wf.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.045;
    wind.connect(wf).connect(wg).connect(this.music);
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.11;
    const wlg = ctx.createGain();
    wlg.gain.value = 240;
    wl.connect(wlg).connect(wf.frequency);
    wl.start();
    wind.start();
    this.windGain = wg;

    // music box: sparse, wandering notes
    const root = 62;
    let step = 0;
    const tick = () => {
      if (!this.ctx) return;
      step++;
      const phraseNote = pick(SCALE) + pick([0, 12, 12, 24]);
      if (Math.random() < 0.72) this.musicBox(midi(root + phraseNote), rand(0.035, 0.07));
      if (step % 8 === 0) {
        const base = root + pick([0, 2, 4, 7]) - 12;
        [0, 4, 7, 11].forEach((iv, k) => this.musicBox(midi(base + iv + 12), 0.03, k * 0.11));
      }
      setTimeout(tick, pick([380, 380, 760, 570, 1140]));
    };
    setTimeout(tick, 1200);
  }

  musicBox(freq, gain = 0.05, delay = 0) {
    const dest = this.ctx.createGain();
    dest.gain.value = 1;
    dest.connect(this.music);
    const w = this.ctx.createGain();
    w.gain.value = 0.9;
    dest.connect(w).connect(this.reverb);
    this.tone({ freq, type: 'sine', attack: 0.004, decay: 2.2, gain, delay, dest });
    this.tone({ freq: freq * 2.01, type: 'sine', attack: 0.003, decay: 0.8, gain: gain * 0.35, delay, dest });
    this.tone({ freq: freq * 3.98, type: 'sine', attack: 0.002, decay: 0.25, gain: gain * 0.15, delay, dest });
  }

  /* ------------------------------------------------------------------- SFX */

  wire() {
    const b = this.bus;
    const on = (e, fn) => b.on(e, (p) => this.ctx && fn(p || {}));
    on('player:swing', ({ heavy }) => {
      this.noise({ type: 'bandpass', freq: heavy ? 900 : 1400, freqEnd: heavy ? 300 : 500, q: 1.2, attack: 0.03, decay: heavy ? 0.26 : 0.18, gain: heavy ? 0.5 : 0.38, pan: 0.2 });
      this.tone({ freq: heavy ? 520 : 760, freqEnd: heavy ? 300 : 420, type: 'sine', attack: 0.01, decay: 0.22, gain: 0.05, wet: 0.4 });
    });
    on('player:kick', () => this.noise({ type: 'lowpass', freq: 700, freqEnd: 200, attack: 0.01, decay: 0.16, gain: 0.35 }));
    on('player:dash', () => {
      this.noise({ type: 'bandpass', freq: 500, freqEnd: 2600, q: 0.8, attack: 0.02, decay: 0.22, gain: 0.45, wet: 0.3 });
      this.tone({ freq: 300, freqEnd: 900, type: 'sine', attack: 0.01, decay: 0.2, gain: 0.06, wet: 0.5 });
    });
    on('player:dashReady', () => this.tone({ freq: 1760, type: 'sine', attack: 0.002, decay: 0.25, gain: 0.03, wet: 0.5 }));
    on('player:jump', ({ double }) => {
      this.noise({ type: 'bandpass', freq: double ? 1500 : 900, freqEnd: double ? 3000 : 1600, attack: 0.01, decay: 0.12, gain: 0.18 });
      if (double) this.musicBox(midi(86), 0.05);
    });
    on('player:land', ({ impact }) => {
      if (impact < 4) return;
      const k = clamp(impact / 20, 0.2, 1);
      this.tone({ freq: 90, freqEnd: 45, type: 'sine', attack: 0.004, decay: 0.18, gain: 0.35 * k, wet: 0.05 });
      this.noise({ type: 'lowpass', freq: 500, attack: 0.003, decay: 0.1, gain: 0.25 * k });
    });
    on('player:hurt', () => {
      this.tone({ freq: 160, freqEnd: 60, type: 'sawtooth', attack: 0.005, decay: 0.3, gain: 0.18 });
      this.noise({ type: 'lowpass', freq: 1200, freqEnd: 200, attack: 0.003, decay: 0.25, gain: 0.4 });
      this.tone({ freq: 1244, freqEnd: 900, type: 'sine', attack: 0.004, decay: 0.5, gain: 0.05, wet: 0.7 });
    });
    on('player:block', () => this.clang(0, 0.8));
    on('player:parry', () => {
      this.clang(0, 1.2);
      [0, 4, 7, 12].forEach((iv, k) => this.musicBox(midi(74 + iv), 0.07, k * 0.05));
    });
    on('player:dodge', () => this.tone({ freq: 1400, freqEnd: 2400, type: 'sine', attack: 0.004, decay: 0.12, gain: 0.05, wet: 0.5 }));
    on('player:slamStart', () => this.tone({ freq: 200, freqEnd: 900, type: 'triangle', attack: 0.05, decay: 0.3, gain: 0.06, wet: 0.4 }));
    on('player:slam', () => {
      this.tone({ freq: 70, freqEnd: 30, type: 'sine', attack: 0.004, decay: 0.7, gain: 0.7, wet: 0.2 });
      this.noise({ type: 'lowpass', freq: 900, freqEnd: 120, attack: 0.004, decay: 0.6, gain: 0.6, wet: 0.4 });
      this.tone({ freq: 880, freqEnd: 440, type: 'sine', attack: 0.004, decay: 1.2, gain: 0.06, wet: 0.8 });
    });
    on('player:fall', () => {
      this.noise({ type: 'bandpass', freq: 300, freqEnd: 1800, q: 0.6, attack: 0.4, decay: 1.2, gain: 0.35, wet: 0.6 });
      this.tone({ freq: 600, freqEnd: 120, type: 'sine', attack: 0.1, decay: 1.4, gain: 0.08, wet: 0.8 });
    });
    on('player:lifeLost', () => {
      [0, -3, -7, -12].forEach((iv, k) => this.musicBox(midi(74 + iv), 0.08, k * 0.16));
    });
    on('player:respawn', () => {
      [0, 4, 7, 11, 14].forEach((iv, k) => this.musicBox(midi(62 + iv), 0.06, k * 0.07));
    });

    on('enemy:hit', ({ enemy, kind }) => {
      const s = this.spatial(enemy.body.pos.x, enemy.body.pos.z);
      const heavy = kind !== 'slash';
      this.noise({ type: 'bandpass', freq: heavy ? 700 : 1100, q: 0.8, attack: 0.002, decay: 0.14, gain: 0.55 * s.gain, pan: s.pan, wet: 0.2 });
      this.tone({ freq: heavy ? 110 : 160, freqEnd: 50, type: 'sine', attack: 0.002, decay: 0.2, gain: 0.45 * s.gain, pan: s.pan, wet: 0.05 });
      this.tone({ freq: rand(1900, 2400), freqEnd: 1300, type: 'triangle', attack: 0.002, decay: 0.35, gain: 0.05 * s.gain, pan: s.pan, wet: 0.6 });
    });
    on('enemy:blocked', ({ enemy }) => this.clang(this.spatial(enemy.body.pos.x, enemy.body.pos.z).pan, 0.9));
    on('enemy:guardbreak', ({ enemy }) => {
      const s = this.spatial(enemy.body.pos.x, enemy.body.pos.z);
      this.clang(s.pan, 1.1);
      this.noise({ type: 'lowpass', freq: 1500, freqEnd: 200, attack: 0.002, decay: 0.3, gain: 0.5, pan: s.pan });
    });
    on('enemy:windup', ({ enemy }) => {
      const s = this.spatial(enemy.body.pos.x, enemy.body.pos.z);
      const dur = enemy.def.windup;
      this.tone({ freq: enemy.type === 'warden' ? 180 : 330, freqEnd: enemy.type === 'warden' ? 520 : 990, type: 'triangle', attack: dur * 0.8, decay: 0.15, gain: 0.07 * s.gain + 0.02, pan: s.pan, wet: 0.5 });
      this.noise({ type: 'highpass', freq: 3000, attack: dur * 0.7, decay: 0.1, gain: 0.08 * s.gain, pan: s.pan });
    });
    on('enemy:strike', ({ enemy }) => {
      const s = this.spatial(enemy.body.pos.x, enemy.body.pos.z);
      this.noise({ type: 'bandpass', freq: 1100, freqEnd: 350, q: 1, attack: 0.02, decay: 0.2, gain: 0.35 * s.gain, pan: s.pan });
    });
    on('enemy:stagger', ({ enemy }) => {
      const s = this.spatial(enemy.body.pos.x, enemy.body.pos.z);
      this.tone({ freq: 700, freqEnd: 350, type: 'triangle', attack: 0.004, decay: 0.4, gain: 0.08, pan: s.pan, wet: 0.5 });
    });
    on('enemy:killed', ({ enemy, byTrap }) => {
      const s = this.spatial(enemy.body.pos.x, enemy.body.pos.z);
      const base = byTrap ? 69 : 74;
      [0, 7, 12, 16, 19].forEach((iv, k) => this.musicBox(midi(base + iv), 0.06, k * 0.06));
      this.noise({ type: 'highpass', freq: 4000, attack: 0.2, decay: 1.0, gain: 0.08, pan: s.pan, wet: 0.8 });
    });
    on('enemy:fall', ({ enemy }) => {
      const s = this.spatial(enemy.body.pos.x, enemy.body.pos.z);
      this.tone({ freq: 500, freqEnd: 90, type: 'sawtooth', attack: 0.05, decay: 1.2, gain: 0.05 * s.gain + 0.02, pan: s.pan, wet: 0.7 });
    });
    on('enemy:spawn', ({ enemy }) => {
      const s = this.spatial(enemy.body.pos.x, enemy.body.pos.z);
      this.noise({ type: 'bandpass', freq: 2500, freqEnd: 600, q: 2, attack: 0.6, decay: 0.6, gain: 0.12, pan: s.pan, wet: 0.8 });
      this.tone({ freq: 220, freqEnd: 440, type: 'sine', attack: 0.8, decay: 0.5, gain: 0.05, pan: s.pan, wet: 0.8 });
    });
    on('enemy:leap', ({ enemy }) => {
      const s = this.spatial(enemy.body.pos.x, enemy.body.pos.z);
      this.noise({ type: 'bandpass', freq: 800, freqEnd: 1800, attack: 0.01, decay: 0.15, gain: 0.2 * s.gain, pan: s.pan });
    });

    // --- the traps: you should hear the floor betray you ---
    on('tile:click', ({ tile }) => {
      const s = this.spatial(tile.x, tile.z);
      this.tone({ freq: 2400, type: 'square', attack: 0.001, decay: 0.03, gain: 0.08 * s.gain + 0.03, pan: s.pan, wet: 0.1 });
      this.tone({ freq: 1200, type: 'square', attack: 0.001, decay: 0.04, gain: 0.06 * s.gain + 0.02, pan: s.pan, wet: 0.1, delay: 0.05 });
      this.tone({ freq: 196, freqEnd: 150, type: 'triangle', attack: 0.01, decay: 0.6, gain: 0.12, pan: s.pan, wet: 0.5 });
      this.tone({ freq: 207.6, freqEnd: 155, type: 'triangle', attack: 0.01, decay: 0.6, gain: 0.08, pan: s.pan, wet: 0.5 });
    });
    on('tile:warn', ({ tile, cause }) => {
      if (cause === 'pressure') return;
      const s = this.spatial(tile.x, tile.z);
      this.tone({ freq: cause === 'hunter' ? 150 : 110, freqEnd: cause === 'hunter' ? 120 : 90, type: 'sine', attack: 0.05, decay: 0.8, gain: 0.12 * s.gain, pan: s.pan, wet: 0.4 });
    });
    on('tile:crackle', ({ tile, p }) => {
      const now = this.ctx.currentTime;
      if (now - this.lastCrackle < 0.025) return;
      this.lastCrackle = now;
      const s = this.spatial(tile.x, tile.z);
      if (s.dist > 26) return;
      this.noise({ type: 'highpass', freq: rand(1800, 4200), q: 0.7, attack: 0.001, decay: rand(0.02, 0.06), gain: (0.12 + p * 0.3) * s.gain, pan: s.pan, wet: 0.08 });
      if (Math.random() < 0.3) this.noise({ type: 'bandpass', freq: rand(300, 700), q: 3, attack: 0.001, decay: 0.08, gain: 0.15 * p * s.gain, pan: s.pan });
    });
    on('tile:collapse', ({ tile }) => {
      const s = this.spatial(tile.x, tile.z);
      this.noise({ type: 'lowpass', freq: 1400, freqEnd: 150, attack: 0.003, decay: 0.9, gain: 0.55 * s.gain, pan: s.pan, wet: 0.35 });
      this.tone({ freq: 80, freqEnd: 32, type: 'sine', attack: 0.003, decay: 0.6, gain: 0.4 * s.gain, pan: s.pan, wet: 0.1 });
      for (let k = 0; k < 5; k++) this.noise({ type: 'highpass', freq: rand(1500, 3500), attack: 0.001, decay: 0.04, gain: 0.15 * s.gain, pan: s.pan, delay: rand(0, 0.25) });
    });
    on('tile:reform', ({ tile }) => {
      const s = this.spatial(tile.x, tile.z);
      if (s.dist > 22) return;
      this.tone({ freq: 440, freqEnd: 880, type: 'sine', attack: 0.5, decay: 0.3, gain: 0.03 * s.gain, pan: s.pan, wet: 0.8 });
    });

    on('well:drink', () => [0, 7, 12].forEach((iv, k) => this.musicBox(midi(79 + iv), 0.05, k * 0.08)));
    on('round:start', () => [0, 7, 14, 19].forEach((iv, k) => this.musicBox(midi(55 + iv), 0.08, k * 0.2)));
    on('round:clear', () => [0, 4, 7, 11, 14, 19].forEach((iv, k) => this.musicBox(midi(67 + iv), 0.07, k * 0.09)));
    on('game:over', () => [0, -2, -5, -9, -12].forEach((iv, k) => this.musicBox(midi(62 + iv), 0.08, k * 0.3)));
  }

  clang(pan = 0, strength = 1) {
    this.noise({ type: 'bandpass', freq: 3200, q: 2, attack: 0.001, decay: 0.12, gain: 0.35 * strength, pan, wet: 0.3 });
    this.tone({ freq: 1830, type: 'triangle', attack: 0.001, decay: 0.5, gain: 0.07 * strength, pan, wet: 0.5 });
    this.tone({ freq: 2745, type: 'sine', attack: 0.001, decay: 0.6, gain: 0.05 * strength, pan, wet: 0.5 });
    this.tone({ freq: 1220, type: 'sine', attack: 0.001, decay: 0.7, gain: 0.05 * strength, pan, wet: 0.5 });
  }

  updateListener(x, z, yaw) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }
}
