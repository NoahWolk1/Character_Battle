// Keyboard + gamepad input. Each "source" produces the engine's button set.
import { BUTTONS } from '../shared/constants.js'; // relative so node tests can import this module

const KEYMAPS = {
  // Solo / online: everything on one keyboard
  solo: {
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
    jump: ['Space'], attack: ['KeyJ', 'KeyZ'], special: ['KeyK', 'KeyX'], strong: ['KeyI', 'KeyC'], shield: ['KeyL', 'ShiftLeft', 'ShiftRight'], taunt: ['KeyT'],
  },
  // Local 2P: left half of the keyboard
  p1: {
    left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'],
    jump: ['Space'], attack: ['KeyF'], special: ['KeyG'], strong: ['KeyH'], shield: ['ShiftLeft', 'KeyQ'], taunt: ['KeyT'],
  },
  // Local 2P: right half of the keyboard
  p2: {
    left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
    jump: ['Slash', 'Numpad0'], attack: ['Period', 'Numpad1'], special: ['Comma', 'Numpad2'], strong: ['KeyM', 'Numpad3'], shield: ['KeyL', 'ShiftRight', 'NumpadEnter'], taunt: ['Quote', 'NumpadAdd'],
  },
};

export const CONTROL_HELP = {
  solo: 'Move WASD / Arrows · Jump Space · Attack J · Special K · Smash I (hold to charge) · Shield/Dodge L or Shift · Taunt T',
  p1: 'Move WASD · Jump Space · Attack F · Special G · Smash H · Shield Shift/Q · Taunt T',
  p2: 'Move Arrows · Jump / · Attack . · Special , · Smash M · Shield L / Right Shift · Taunt \' (quote)',
  pad: 'Stick/D-pad move · A/Y jump · X attack · B special · Right stick smash · Bumpers/Triggers shield · Back/Select taunt · Start pause · Menus: D-pad move, A select, B back',
};

const down = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    down.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());
}
const pads = () => (typeof navigator !== 'undefined' && navigator.getGamepads?.()) || [];

export function blankInput() { return Object.fromEntries(BUTTONS.map((b) => [b, false])); }

/**
 * 'any' = full keyboard + Gamepad 1. In local multi-human setups it must not steal
 * controls another slot claimed, so it resolves to 'any!p2,pad0' (minus those keys/pads).
 */
export function resolveSources(types) {
  return types.map((t) => {
    if (t !== 'any') return t;
    const claimed = [...new Set(types.filter((o) => o !== 'any' && (KEYMAPS[o] || o === 'pad0')))].sort();
    return claimed.length ? `any!${claimed.join(',')}` : 'any';
  });
}

const derived = new Map();
/** Keymap + pad list for an 'any[!claimed,...]' source. */
export function anyLayout(source) {
  if (!derived.has(source)) {
    const claimed = (source.split('!')[1] || '').split(',').filter(Boolean);
    const taken = new Set(claimed.flatMap((c) => Object.values(KEYMAPS[c] || {}).flat()));
    const keys = Object.fromEntries(Object.entries(KEYMAPS.solo).map(([b, ks]) => [b, ks.filter((k) => !taken.has(k))]));
    derived.set(source, { keys, pads: claimed.includes('pad0') ? [] : [0] });
  }
  return derived.get(source);
}

function pollKeys(map) {
  const o = {};
  for (const b of BUTTONS) o[b] = !!map[b]?.some((k) => down.has(k));
  return o;
}

export function pollSource(source) {
  if (source.startsWith('any')) {
    // keyboard OR first gamepad — used for solo, training and online play
    const { keys, pads: ps } = anyLayout(source);
    const a = pollKeys(keys);
    for (const i of ps) { const b = pollPad(i); for (const k of BUTTONS) a[k] = a[k] || b[k]; }
    return a;
  }
  if (source.startsWith('pad')) return pollPad(Number(source.slice(3)));
  return pollKeys(KEYMAPS[source] || KEYMAPS.solo);
}

/** Raw gamepad button (9 = Start, 0 = A, 1 = B). */
export function padButton(i, n) { return !!pads()[i]?.buttons[n]?.pressed; }

/** Rising-edge tracker for gamepad buttons; `get(i, n)` is injectable for tests. */
export class PadEdges {
  constructor(get = padButton) { this.get = get; this.prev = new Map(); }
  /** True once when button n on any pad in `indices` goes down. */
  pressed(n, indices = [0, 1, 2, 3]) {
    let hit = false;
    for (const i of indices) {
      const k = `${i}:${n}`, now = this.get(i, n);
      if (now && !this.prev.get(k)) hit = true;
      this.prev.set(k, now);
    }
    return hit;
  }
}

function pollPad(i) {
  const o = blankInput();
  const pad = pads()[i];
  if (!pad) return o;
  const b = (n) => !!pad.buttons[n]?.pressed;
  const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
  const dz = 0.4;
  o.left = ax < -dz || b(14);
  o.right = ax > dz || b(15);
  o.up = ay < -dz || b(12);
  o.down = ay > dz || b(13);
  o.jump = b(0) || b(3);
  o.attack = b(2);
  o.special = b(1);
  o.shield = b(4) || b(5) || b(6) || b(7);
  o.taunt = b(8); // Back / Select / Share
  // Right stick = smash attack in that direction ("C-stick")
  const rx = pad.axes[2] || 0, ry = pad.axes[3] || 0;
  if (Math.hypot(rx, ry) > 0.55) {
    o.strong = true;
    if (Math.abs(rx) > Math.abs(ry)) { o.left = rx < 0; o.right = rx > 0; o.up = o.down = false; } else { o.up = ry < 0; o.down = ry > 0; o.left = o.right = false; }
  }
  return o;
}

export function connectedPads() {
  return [...pads()].filter(Boolean).map((p) => p.index);
}

/** Bitmask for the wire: bit i = BUTTONS[i] (bit 9 = taunt). */
export function encodeInput(o) {
  let m = 0;
  BUTTONS.forEach((b, i) => { if (o[b]) m |= 1 << i; });
  return m;
}

export function isDown(code) { return down.has(code); }
