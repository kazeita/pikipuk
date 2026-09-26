/**
 * Keyboard + mouse state with pointer lock. Keys use `event.code` so the
 * layout (QWERTY/AZERTY) never changes the physical controls.
 */
export class Input {
  constructor(element, bus) {
    this.el = element;
    this.bus = bus;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.enabled = false;
    this.sensitivity = 1;

    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    addEventListener('blur', () => this.clear());

    addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.mouseDown[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    addEventListener('mouseup', (e) => {
      this.mouseDown[e.button] = false;
      this.mouseReleased[e.button] = true;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Clamp absurd spikes some browsers emit on lock/unlock.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (was && !this.locked) {
        this.clear();
        this.bus.emit('input:unlocked');
      }
      if (this.locked) this.bus.emit('input:locked');
    });
  }

  async lock() {
    if (this.locked) return true;
    try {
      await this.el.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await this.el.requestPointerLock();
      } catch {
        return false;
      }
    }
    return true;
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear() {
    this.down.clear();
    this.mouseDown = [false, false, false];
  }

  isDown(code) {
    return this.down.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  axis(neg, pos) {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  consumeMouse() {
    const out = { x: this.dx * this.sensitivity, y: this.dy * this.sensitivity };
    this.dx = 0;
    this.dy = 0;
    return out;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
  }
}
