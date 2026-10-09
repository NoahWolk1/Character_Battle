// ─────────────────────────────────────────────────────────────────────────────
// Generic moves: what a trigger does when the character has no move for it.
// The 16 v1 slots reproduce v1's genericMove exactly (golden parity); the new
// triggers get a plain grab, pummel, four throws and a taunt (spec §2.2.1).
// Returned in v2 source syntax (a fresh object per call) so they go through
// the same normalizer and scalers as authored moves.
// ─────────────────────────────────────────────────────────────────────────────
import { CATEGORIES } from '../balance/rules.js';
import { TRIGGER_CATEGORY, V1_SLOTS } from './schema.js';

const release = (damage, angle, knockback, growth, extra = {}) => ({ damage, angle, knockback, growth, ...extra });

const NEW_GENERICS = {
  grab: () => ({
    name: 'Grab', category: 'grab', duration: 30, anim: 'grab',
    hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 44, y: -50, w: 44, h: 56, group: 0 }],
  }),
  pummel: () => ({
    name: 'Pummel', category: 'pummel', duration: 16, anim: 'pummel',
    timeline: [{ at: 5, release: release(1.5, 0, 0, 0, { setKnockback: 0 }) }],
  }),
  fthrow: () => ({ name: 'Forward Throw', category: 'throw', duration: 30, anim: 'fthrow', timeline: [{ at: 12, release: release(8, 40, 50, 60) }] }),
  bthrow: () => ({ name: 'Back Throw', category: 'throw', duration: 34, anim: 'bthrow', timeline: [{ at: 16, release: release(9, 140, 52, 62) }] }),
  uthrow: () => ({ name: 'Up Throw', category: 'throw', duration: 32, anim: 'uthrow', timeline: [{ at: 14, release: release(7, 90, 50, 64) }] }),
  dthrow: () => ({ name: 'Down Throw', category: 'throw', duration: 32, anim: 'dthrow', timeline: [{ at: 15, release: release(6, 75, 56, 30) }] }),
  taunt: () => ({ name: 'Taunt', category: 'taunt', duration: 60, anim: 'taunt', timeline: [{ at: 8, emit: 'taunt' }] }),
};

/** v1 genericMove, verbatim numbers (validate.js), plus explicit v1 group 0. */
function v1Generic(slot) {
  const category = TRIGGER_CATEGORY[slot];
  const cat = CATEGORIES[category];
  const up = slot.startsWith('u');
  const down = slot.startsWith('d');
  return {
    name: slot,
    category,
    duration: cat.minDuration + 10,
    hitboxes: [{
      start: cat.minStartup + 2, end: cat.minStartup + 5, x: up ? 10 : 38, y: up ? -95 : down ? -10 : -50, r: 22,
      damage: Math.round(cat.maxHit * 0.5), angle: up ? 85 : 40, knockback: 25, growth: 55, group: 0,
    }],
    velocity: slot === 'upSpecial' ? [{ start: 4, end: 16, vy: -12 }] : [],
  };
}

/** Triggers that have a generic move. */
export const GENERIC_TRIGGERS = [...V1_SLOTS, ...Object.keys(NEW_GENERICS)];

/** True if `trigger` has a generic move. */
export const hasGeneric = (trigger) => GENERIC_TRIGGERS.includes(trigger);

/**
 * A fresh generic move (v2 source syntax) for `trigger`, or null if none.
 * @param {string} trigger
 * @returns {import('./api.js').Action | null}
 */
export function genericMove(trigger) {
  if (V1_SLOTS.includes(trigger)) return v1Generic(trigger);
  return NEW_GENERICS[trigger] ? NEW_GENERICS[trigger]() : null;
}
