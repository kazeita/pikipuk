// Central tuning for Somnia. Everything gameplay-related lives here so the
// feel of the arena, the traps and the fight can be adjusted in one place.

export const ARENA = {
  tileSize: 3,        // metres per tile
  gap: 0.3,             // visual seam between tiles
  grid: 39,             // grid cells per side (odd, so a tile sits at the centre)
  radius: 40,         // tiles whose centre lies inside this circle exist
  thickness: 0.2,      // slab depth
};

export const PLAYER = {
  eyeHeight: 1.62,
  radius: 0.38,
  moveSpeed: 7.6,
  groundAccel: 75,
  airAccel: 24,
  friction: 11,
  gravity: 26,
  jumpVel: 8.9,
  doubleJumpVel: 8.2,
  glideGravityScale: 0.22, // holding Space while falling after a double jump
  glideTime: 0.95,
  coyoteTime: 0.12,
  jumpBuffer: 0.14,
  dashSpeed: 21,
  dashTime: 0.17,
  dashCharges: 2,
  dashRecharge: 1.1,
  maxHealth: 100,
  lives: 3,
  fallDeathY: -18,
  respawnInvuln: 1.8,
  baseFov: 80,
};

export const COMBAT = {
  // Light combo: three swings, the third is a heavier overhead finisher
  combo: [
    { name: 'slashR', dur: 0.36, hitAt: 0.34, damage: 20, range: 2.75, arc: 1.05, knock: 3.5 },
    { name: 'slashL', dur: 0.36, hitAt: 0.34, damage: 20, range: 2.75, arc: 1.05, knock: 3.5 },
    { name: 'overhead', dur: 0.52, hitAt: 0.42, damage: 34, range: 3.0, arc: 0.7, knock: 7.5 },
  ],
  comboWindow: 0.34,         // time after a swing in which the next click chains
  thrust: { name: 'thrust', dur: 0.4, hitAt: 0.22, damage: 38, range: 3.7, arc: 0.45, knock: 9, lunge: 11 },
  dashStrikeWindow: 0.28,    // attack within this long after a dash = lunge thrust
  slam: { damage: 28, radius: 4.2, knock: 12, minFall: 0.6 },
  kick: { dur: 0.42, hitAt: 0.14, damage: 6, range: 2.35, arc: 0.95, knock: 10.5, lift: 1.6, cooldown: 0.55 },
  block: { frontalDot: 0.25, reduction: 0.8, parryWindow: 0.2, parryStagger: 1.4 },
  hitstop: 0.055,
};

// Trap pacing per dream (round). Tiles are only ever triggered one at a time,
// on a staggered clock, each with its own telegraph.
export function trapParams(round) {
  const r = Math.min(round, 8);
  return {
    interval: [Math.max(0.55, 1.9 - r * 0.16), Math.max(1.0, 3.0 - r * 0.22)],
    maxVoidFraction: Math.min(0.36, 0.16 + r * 0.025),
    hiddenTraps: Math.min(20, 7 + r * 2),
    hunterChance: Math.min(0.38, 0.12 + r * 0.035),
    fuseChance: Math.min(0.26, 0.06 + r * 0.03),
    warn: { decay: 1.75, hunter: Math.max(0.95, 1.3 - r * 0.04), fuse: 0.95, pressure: 0.62, slam: 1.2 },
    voidTime: [Math.max(4.5, 8 - r * 0.35), Math.max(7, 11.5 - r * 0.4)],
  };
}

export const ENEMY_TYPES = {
  knight: {
    label: 'Wisp Knight', hp: 80, speed: 5.2, damage: 13, reach: 2.4, windup: 0.6, recover: 0.7,
    scale: 1.0, mass: 1.0, color: 0x9d7bff, glow: 0xc9a6ff, blockChance: 0.35, dodgeChance: 0.12,
    weapon: 'sword', cooldown: [1.1, 2.0], halo: true,
  },
  lancer: {
    label: 'Moth Lancer', hp: 56, speed: 6.8, damage: 12, reach: 3.5, windup: 0.48, recover: 0.6,
    scale: 0.94, mass: 0.8, color: 0x5fe1d6, glow: 0x9ff7ee, blockChance: 0.1, dodgeChance: 0.45,
    weapon: 'spear', cooldown: [0.9, 1.6], halo: false,
  },
  warden: {
    label: 'Sleep Warden', hp: 190, speed: 3.9, damage: 25, reach: 3.0, windup: 0.95, recover: 1.0,
    scale: 1.38, mass: 2.6, color: 0xff6fa3, glow: 0xffa8c9, blockChance: 0.5, dodgeChance: 0.0,
    weapon: 'greatsword', cooldown: [1.6, 2.6], halo: true,
  },
};

export const ROUNDS = [
  ['knight'],
  ['knight', 'lancer'],
  ['knight', 'knight', 'lancer'],
  ['warden', 'lancer'],
  ['warden', 'knight', 'lancer', 'lancer'],
];

export function roundRoster(round) {
  if (round <= ROUNDS.length) return ROUNDS[round - 1];
  const n = Math.min(3 + Math.floor((round - ROUNDS.length) / 2), 6);
  const pool = ['knight', 'knight', 'lancer', 'lancer', 'warden'];
  const out = ['warden'];
  while (out.length < n) out.push(pool[Math.floor(Math.random() * pool.length)]);
  return out;
}

export const MAX_SIMULTANEOUS_ATTACKERS = 2;
