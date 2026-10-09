// ─────────────────────────────────────────────────────────────────────────────
// v2 status limits (spec §2.2.10, §4.1.2 "statuses are clamped to §4.2.9 caps").
// Custom statuses may only be built from capped modifiers; the runtime Governor
// enforces stacking, immunity and per-target caps.
// ─────────────────────────────────────────────────────────────────────────────
import { STATUS_LIMITS } from '../rules.js';
import { STATUS_CAPS, MOD_RANGES } from '../governor-rules.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function clampNum(obj, key, lo, hi, path, notes, code, rule, { int = false } = {}) {
  const v = obj[key];
  let c = clamp(Number.isFinite(v) ? v : lo, lo, hi);
  if (int) c = Math.round(c);
  if (c !== v) {
    notes.add(code, `${path}.${key}`, `${key} ${v} is outside ${lo}–${hi}; set to ${c}.`, { from: v, to: c, rule });
    obj[key] = c;
  }
}

/** Max frames a status of this control kind may last (§4.2.9). */
export const controlMax = (kind) => STATUS_CAPS.control[kind]?.max ?? STATUS_LIMITS.frames[1];

/** Clamp one custom status in place (W501-W505). */
export function clampStatus(s, path, notes) {
  const L = STATUS_LIMITS;
  clampNum(s, 'frames', L.frames[0], s.control ? Math.min(L.frames[1], controlMax(s.control)) : L.frames[1], path, notes, s.control ? 'W504' : 'W501', s.control ? `STATUS_CAPS.control.${s.control}.max` : 'STATUS_LIMITS.frames', { int: true });
  clampNum(s, 'maxStacks', L.maxStacks[0], L.maxStacks[1], path, notes, 'W501', 'STATUS_LIMITS.maxStacks', { int: true });
  for (const k of Object.keys(s.mods).sort()) {
    const r = MOD_RANGES[k];
    if (r) clampNum(s.mods, k, r[0], r[1], `${path}.mods`, notes, 'W502', `MOD_RANGES.${k}`);
  }
  if (s.dot) {
    clampNum(s.dot, 'every', L.dotMinEvery, 600, `${path}.dot`, notes, 'W503', 'STATUS_LIMITS.dotMinEvery', { int: true });
    clampNum(s.dot, 'damage', 0, L.dotMaxDamage, `${path}.dot`, notes, 'W503', 'STATUS_LIMITS.dotMaxDamage');
  }
  if (s.heal) {
    clampNum(s.heal, 'every', L.healMinEvery, 600, `${path}.heal`, notes, 'W505', 'STATUS_LIMITS.healMinEvery', { int: true });
    clampNum(s.heal, 'amount', 0, L.healMaxAmount, `${path}.heal`, notes, 'W505', 'STATUS_LIMITS.healMaxAmount');
  }
}

/** Clamp every custom status. Built-ins are engine data and already in range. */
export function clampStatuses(draft, notes) {
  const names = Object.keys(draft.statuses).sort();
  if (names.length > STATUS_LIMITS.maxCustom) {
    notes.add('W511', 'statuses', `${names.length} custom statuses (max ${STATUS_LIMITS.maxCustom}); all are kept, but consider merging some.`, { from: names.length, to: STATUS_LIMITS.maxCustom, rule: 'STATUS_LIMITS.maxCustom' });
  }
  for (const n of names) clampStatus(draft.statuses[n], `statuses.${n}`, notes);
}

/**
 * Clamp a hit's status reference ({name, frames, power}) against the status definition.
 * `statuses` = custom (draft) statuses; built-ins are looked up by control kind.
 */
export function clampHitStatus(st, path, notes, draft, builtins) {
  if (!st) return;
  const def = draft.statuses[st.name] || builtins[st.name];
  const ctl = def?.control || null;
  const hi = ctl ? Math.min(STATUS_LIMITS.frames[1], controlMax(ctl)) : STATUS_LIMITS.frames[1];
  if (st.frames !== null && st.frames !== undefined) clampNum(st, 'frames', 1, hi, path, notes, ctl ? 'W504' : 'W501', 'STATUS_LIMITS.frames', { int: true });
  if (st.power !== null && st.power !== undefined) clampNum(st, 'power', 0, 2, path, notes, 'W501', 'status power');
}
