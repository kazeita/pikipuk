import * as THREE from 'three';
import { PLAYER } from '../config.js';

const $ = (id) => document.getElementById(id);
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
export const roman = (n) => ROMAN[n] || String(n);
const _v = new THREE.Vector3();

/** DOM heads-up display, driven by events and a light per-frame sync. */
export class HUD {
  constructor(bus) {
    this.bus = bus;
    this.el = $('hud');
    this.hpFill = $('hpFill');
    this.hpGhost = $('hpGhost');
    this.hpText = $('hpText');
    this.bar = this.hpFill.parentElement;
    this.moons = $('moons');
    this.pips = [...$('dashPips').querySelectorAll('.pip')];
    this.cross = $('crosshair');
    this.hitmark = $('hitmark');
    this.toastEl = $('toast');
    this.banner = $('banner');
    this.bannerMain = $('bannerMain');
    this.bannerSub = $('bannerSub');
    this.roundTitle = $('roundTitle');
    this.roundSub = $('roundSub');
    this.dmgDir = $('dmgDir');
    this.barsEl = $('enemyBars');
    this.hint = $('hint');
    this.enemyBars = new Map();
    this.last = {};
    this.bannerTimer = null;

    for (let i = 0; i < PLAYER.lives; i++) {
      const m = document.createElement('span');
      m.className = 'moon';
      this.moons.appendChild(m);
    }

    bus.on('enemy:hit', () => this.hit());
    bus.on('player:parry', () => this.toast('Parry'));
    bus.on('enemy:guardbreak', () => this.toast('Guard broken'));
    bus.on('player:dodge', () => this.toast('Slipped through'));
    bus.on('enemy:killed', ({ byTrap }) => this.toast(byTrap ? 'Dreamfall' : 'Unmade'));
    bus.on('player:slam', ({ hits }) => hits > 1 && this.toast(`Quake ×${hits}`));
  }

  show(v) {
    this.el.classList.toggle('hidden', !v);
  }

  hit() {
    this.hitmark.classList.remove('on');
    void this.hitmark.offsetWidth;
    this.hitmark.classList.add('on');
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('on');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('on');
  }

  showBanner(main, sub = '', ms = 2400) {
    this.bannerMain.textContent = main;
    this.bannerSub.textContent = sub;
    this.banner.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.banner.classList.remove('on'), ms);
  }

  damageFrom(angle) {
    this.dmgDir.style.transform = `rotate(${angle}rad)`;
    this.dmgDir.style.transition = 'none';
    this.dmgDir.style.opacity = '1';
    void this.dmgDir.offsetWidth;
    this.dmgDir.style.transition = 'opacity 0.9s';
    this.dmgDir.style.opacity = '0';
  }

  setRound(n, remaining) {
    const t = `Dream ${roman(n)}`;
    if (this.last.round !== t) this.roundTitle.textContent = this.last.round = t;
    const s = remaining > 0 ? `${remaining} phantom${remaining === 1 ? '' : 's'} remain${remaining === 1 ? 's' : ''}` : 'the dream deepens';
    if (this.last.sub !== s) this.roundSub.textContent = this.last.sub = s;
  }

  fadeHint() {
    this.hint.style.opacity = '0';
  }

  resetHint() {
    this.hint.style.opacity = '1';
  }

  sync(game) {
    const p = game.player;
    const hp = Math.max(0, p.health) / PLAYER.maxHealth;
    if (this.last.hp !== hp) {
      this.last.hp = hp;
      this.hpFill.style.transform = `scaleX(${hp})`;
      this.hpGhost.style.transform = `scaleX(${hp})`;
      this.hpText.textContent = Math.ceil(Math.max(0, p.health));
      this.bar.classList.toggle('low', hp < 0.3);
    }
    if (this.last.lives !== p.lives) {
      this.last.lives = p.lives;
      [...this.moons.children].forEach((m, i) => m.classList.toggle('spent', i >= p.lives));
    }
    this.pips.forEach((pip, i) => pip.classList.toggle('off', i >= p.dashCharges));
    this.cross.classList.toggle('guard', game.combat.blocking);

    // floating enemy health bars
    const cam = game.render.camera;
    const w = innerWidth;
    const h = innerHeight;
    for (const e of game.enemies) {
      let el = this.enemyBars.get(e);
      if (!el) {
        el = document.createElement('div');
        el.className = 'ebar';
        el.innerHTML = `<b>${e.def.label}</b><i></i>`;
        this.barsEl.appendChild(el);
        this.enemyBars.set(e, el);
      }
      _v.copy(e.body.pos);
      _v.y += 2.35 * e.def.scale;
      _v.project(cam);
      const visible = e.alive && e.state !== 'spawn' && _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      const dist = cam.position.distanceTo(e.body.pos);
      el.style.opacity = visible ? String(Math.max(0, Math.min(1, (26 - dist) / 8))) : '0';
      if (visible) {
        el.style.transform = `translate(${((_v.x + 1) / 2) * w}px, ${((1 - _v.y) / 2) * h}px)`;
        el.firstElementChild.nextElementSibling.style.transform = `scaleX(${Math.max(0, e.hp / e.maxHp)})`;
        el.classList.toggle('warn', e.state === 'windup');
      }
    }
    for (const [e, el] of this.enemyBars) {
      if (e.removed || !game.enemies.includes(e)) {
        el.remove();
        this.enemyBars.delete(e);
      }
    }
  }

  clearEnemies() {
    for (const el of this.enemyBars.values()) el.remove();
    this.enemyBars.clear();
  }
}
