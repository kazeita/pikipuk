import { generateTileSet } from './stoneTile.js';
import {
  rockTexture,
  armorTexture,
  clothTexture,
  maskTexture,
  bladeTexture,
  leatherTexture,
  moonTexture,
  runeStripTexture,
  magicCircleTexture,
  glowSprite,
  lanternTexture,
  ghostFrameTexture,
} from './library.js';
import { setMaxAnisotropy } from './canvas.js';

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Generates every texture procedurally at startup (no image assets), yielding
 * between steps so the loading bar can animate.
 */
export class TextureBank {
  async build(maxAniso, onProgress = () => {}) {
    setMaxAnisotropy(Math.min(8, maxAniso));
    const steps = [
      ['carving moonstone…', () => (this.tiles = [generateTileSet(512, 101)])],
      ['etching runes…', () => this.tiles.push(generateTileSet(512, 202))],
      ['listening to the stone…', () => this.tiles.push(generateTileSet(512, 303))],
      ['raising islands…', () => (this.rock = rockTexture(512, 11))],
      ['forging dream-steel…', () => (this.armor = armorTexture(512, 21))],
      ['embroidering the night…', () => (this.cloth = clothTexture(512, 31))],
      [
        'glazing porcelain…',
        () =>
          (this.masks = [maskTexture(512, 41, '#6a5cff'), maskTexture(512, 43, '#20c6c0'), maskTexture(512, 47, '#ff4f9a')]),
      ],
      ['folding the blade…', () => (this.blade = bladeTexture(1024, 128, 51))],
      [
        'hanging the moons…',
        () => {
          this.leather = leatherTexture(256, 61);
          this.moon = moonTexture(512, 71);
          this.moon2 = moonTexture(256, 73, [0.75, 1.0, 0.98]);
        },
      ],
      [
        'drawing the sigils…',
        () => {
          this.runeStrip = runeStripTexture(2048, 64, 81);
          this.magicCircle = magicCircleTexture(1024, 91);
          this.glow = glowSprite(128);
          this.lantern = lanternTexture(256, 101);
          this.ghostFrame = ghostFrameTexture(256);
        },
      ],
    ];
    for (let i = 0; i < steps.length; i++) {
      onProgress(i / steps.length, steps[i][0]);
      await frame();
      await frame();
      steps[i][1]();
    }
    onProgress(1, 'falling asleep…');
    await frame();
    return this;
  }
}
