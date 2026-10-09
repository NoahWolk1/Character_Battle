// Input mapping (spec §3.5): per-frame input intake, the press buffer, and
// trigger detection / move resolution. detectTrigger reproduces v1's attack and
// special priority exactly, but emits trigger names instead of starting moves.
import { BUTTONS, INPUT_BUFFER } from '../constants.js';
import { cpuThink } from './ai.js';
import * as script from './script-api.js';
import * as resources from './resources.js';
import { genericAction } from './actions.js';

export const EMPTY_INPUT = Object.freeze(Object.fromEntries(BUTTONS.map((b) => [b, false])));
export const BUFFERED = ['jump', 'attack', 'special', 'strong', 'shield', 'down', 'left', 'right'];
export const HELD_SLOTS = 10; // BUTTONS + taunt (bit 9)

/** Step §3.2 "input": prev/input swap, held-frame counters, buffered press edges. */
export function readInput(f, active) {
  const game = f.game;
  f.prev = f.input;
  f.input = f.cpu ? (active ? cpuThink(game, f) : EMPTY_INPUT) : (f.pendingInput || EMPTY_INPUT);
  for (const b of BUFFERED) if (f.input[b] && !f.prev[b]) f.buffer[b] = game.frame;
  const hf = f.heldFrames;
  for (let i = 0; i < BUTTONS.length && i < HELD_SLOTS; i++) {
    hf[i] = f.input[BUTTONS[i]] ? Math.min(32767, hf[i] + 1) : 0;
  }
}

export function pressed(f, b) { return f.game.frame - f.buffer[b] <= INPUT_BUFFER; }
export function consume(f, b) { f.buffer[b] = -999; }

/** Horizontal stick direction (-1/0/1). Confuse swaps; root ignores it. */
export function dirX(f) {
  const inp = f.input;
  const d = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  if (f.control === 'root') return 0;
  return f.control === 'confuse' ? -d : d;
}

function specialTrigger(f, dir) {
  const inp = f.input;
  if (inp.up) return { trigger: 'upSpecial', face: 0 };
  if (inp.down) return { trigger: 'downSpecial', face: 0 };
  if (dir) return { trigger: 'sideSpecial', face: dir };
  return { trigger: 'neutralSpecial', face: 0 };
}

/**
 * Attack/special trigger from the buffered input, consuming the buttons it used.
 * Returns {trigger, face} (face: direction to turn toward when the move starts, 0 =
 * keep) or null when no attack button was pressed. Ground priority: strong >
 * special > attack. Air: attack|strong > special. (Jump/shield are handled by states.)
 */
export function detectTrigger(f) {
  const inp = f.input;
  const dir = dirX(f);
  const silenced = f.control === 'silence';
  if (f.grounded) {
    if (pressed(f, 'strong')) {
      consume(f, 'strong');
      return { trigger: inp.up ? 'upSmash' : inp.down ? 'downSmash' : 'sideSmash', face: dir };
    }
    if (!silenced && pressed(f, 'special')) {
      consume(f, 'special');
      return specialTrigger(f, dir);
    }
    if (pressed(f, 'attack')) {
      consume(f, 'attack');
      const face = dir && !inp.up && !inp.down ? dir : 0;
      return { trigger: inp.up ? 'up' : inp.down ? 'down' : dir ? 'side' : 'jab', face };
    }
    return null;
  }
  if (pressed(f, 'attack') || pressed(f, 'strong')) {
    consume(f, 'attack'); consume(f, 'strong');
    return { trigger: inp.up ? 'uair' : inp.down ? 'dair' : dir === 0 ? 'nair' : dir === f.facing ? 'fair' : 'bair', face: 0 };
  }
  if (!silenced && pressed(f, 'special')) {
    consume(f, 'special');
    return specialTrigger(f, dir);
  }
  return null;
}

/**
 * Trigger → {def, name} or null (input ignored).
 * name = form.slots[t] ?? base slots[t] ?? t (a SlotFn is evaluated through
 * script-api under the sim guard); def = moves[name] (generic fallback: WP-B).
 * Gates: oncePerAirtime (v1 sideSpecial), requires/cost → `else`.
 */
export function resolveMove(f, trigger) {
  const c = f.char;
  const form = f.form && f.form !== 'base' ? c.forms?.[f.form] : null;
  // SlotFns live in forms[f].slotFns (form fns already inherit base fns); a non-pool result falls back to the string map.
  const fn = (form ? form.slotFns : c.forms?.base?.slotFns)?.[trigger];
  let name = slotName(f, fn, trigger) ?? slotName(f, form?.slots?.[trigger], trigger) ?? slotName(f, (c.slots ?? c.forms?.base?.slots)?.[trigger], trigger) ?? trigger;
  let def = ownMove(c, name) ?? (name === trigger ? genericAction(trigger) : null); // generic fallback (WP-F)
  if (!def) return null;
  if (!f.grounded && (def.oncePerAirtime ?? trigger === 'sideSpecial') && f.air.used.has(name)) return null;
  for (let hops = 0; !(resources.meets(f, def.requires) && resources.canPay(f, def.cost)); hops++) {
    if (hops >= 4) return null;
    name = def.else;
    def = name ? ownMove(c, name) : null;
    if (!def) return null;
  }
  return { def, name };
}

// Own-property lookup: a slot named '__proto__'/'constructor' must not resolve to Object.prototype.
const ownMove = (c, n) => (c.moves && Object.prototype.hasOwnProperty.call(c.moves, n) ? c.moves[n] : undefined);

function slotName(f, s, trigger) {
  if (typeof s === 'string') return s;
  if (typeof s === 'function') { const n = script.slotFn(f, s, trigger); return typeof n === 'string' && ownMove(f.char, n) ? n : null; }
  return null;
}
