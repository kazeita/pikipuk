import { trapParams } from '../config.js';
import { rand, chance, pick } from '../core/math.js';

/**
 * Decides which tile becomes a trap next. Only one trigger fires per tick of
 * a randomised clock, so the floor erodes tile by tile – never in a wave.
 *
 *  decay    – a random tile cracks slowly (long telegraph)
 *  hunter   – the tile where the player is about to be (keeps you moving)
 *  fuse     – a short line of tiles cracks in sequence, like a lit fuse
 *  pressure – hidden armed tiles that spring when stepped on (Arena.onStep)
 *  slam     – tiles the player's ground-slam shatters (Player → trapSlam)
 */
export class TrapDirector {
  constructor(arena, bus) {
    this.arena = arena;
    this.bus = bus;
    this.queue = [];
    this.params = trapParams(1);
    this.timer = 0;
    this.grace = 0;
    this.armTimer = 0;
    this.active = false;
  }

  start(round, protectedPoints = []) {
    this.params = trapParams(round);
    this.arena.voidTime = this.params.voidTime;
    this.arena.pressureWarn = this.params.warn.pressure;
    this.queue.length = 0;
    this.grace = 3.2;
    this.timer = rand(...this.params.interval);
    this.armTimer = 1.5;
    this.protectedPoints = protectedPoints;
    this.active = true;
  }

  stop() {
    this.active = false;
    this.queue.length = 0;
  }

  get maxNonSolid() {
    return Math.floor(this.arena.tiles.length * this.params.maxVoidFraction);
  }

  canTrigger(tile) {
    return tile && tile.state === 'solid';
  }

  update(dt, time, { player, enemies }) {
    if (!this.active) return;
    this.grace -= dt;

    // scheduled fuse steps
    for (let k = this.queue.length - 1; k >= 0; k--) {
      const q = this.queue[k];
      q.at -= dt;
      if (q.at <= 0) {
        this.queue.splice(k, 1);
        if (this.canTrigger(q.tile)) q.tile.trigger('fuse', this.params.warn.fuse);
      }
    }

    // keep the hidden pressure traps topped up, silently, one at a time
    this.armTimer -= dt;
    if (this.armTimer <= 0) {
      this.armTimer = rand(0.4, 1.1);
      const armed = this.arena.tiles.filter((t) => t.armed).length;
      if (armed < this.params.hiddenTraps) {
        const t = this.arena.randomTile(
          (c) =>
            c.state === 'solid' &&
            !c.armed &&
            time - c.lastStep > 1.5 &&
            Math.hypot(c.x - player.body.pos.x, c.z - player.body.pos.z) > 3.2,
        );
        if (t) t.arm();
      }
    }

    if (this.grace > 0) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = rand(...this.params.interval);

    if (this.arena.nonSolidCount() >= this.maxNonSolid) {
      this.timer = 0.5;
      return;
    }

    const roll = Math.random();
    if (roll < this.params.hunterChance && player.alive && this.fireHunter(player)) return;
    if (roll < this.params.hunterChance + this.params.fuseChance && this.fireFuse(player)) return;
    this.fireDecay(player, enemies);
  }

  fireHunter(player) {
    const p = player.body.pos;
    const v = player.body.vel;
    const lead = 0.55;
    const tile = this.arena.tileAt(p.x + v.x * lead, p.z + v.z * lead);
    if (!this.canTrigger(tile)) return false;
    return tile.trigger('hunter', this.params.warn.hunter);
  }

  fireFuse(player) {
    const p = player.body.pos;
    const start = this.arena.randomTile((t) => {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      return t.state === 'solid' && d > 3.5 && d < 14;
    });
    if (!start) return false;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
    ];
    const [di, dj] = pick(dirs);
    const len = 3 + Math.floor(Math.random() * 3);
    let delay = 0;
    let added = 0;
    for (let k = 0; k < len; k++) {
      const t = this.arena.grid[start.i + di * k]?.[start.j + dj * k];
      if (!t || t.state !== 'solid') break;
      this.queue.push({ tile: t, at: delay });
      delay += 0.3;
      added++;
    }
    return added > 0;
  }

  fireDecay(player, enemies) {
    const p = player.body.pos;
    let focus = null;
    const r = Math.random();
    if (r < 0.3 && enemies.length) {
      const e = pick(enemies.filter((e) => e.alive));
      if (e) focus = e.body.pos;
    } else if (r < 0.6) {
      focus = p;
    }
    const tile = this.arena.randomTile((t) => {
      if (t.state !== 'solid') return false;
      if (focus) return Math.hypot(t.x - focus.x, t.z - focus.z) < 7.5;
      return true;
    });
    if (tile) tile.trigger('decay', this.params.warn.decay);
  }

  /** The player's ground-slam shatters the slab they land on and those under struck foes. */
  slam(tiles) {
    for (const t of tiles) if (this.canTrigger(t)) t.trigger('slam', this.params.warn.slam);
  }
}

export { chance };
