// ─────────────────────────────────────────────────────────────────────────────
// v2 stat pricing and squeeze, per form (spec §4.1.1).
//   cost = v1 paid-stat points + movement modes + passive armor (2.5/pt)
//        + hurtbox area (v2 curve on A[default]·scaleMin²; big bodies refund).
// Over budget → the v1 binary-search squeeze on paid stats. v1 files never get
// here (they keep exact v1 pricing in validate.js).
// ─────────────────────────────────────────────────────────────────────────────
import { STATS, HURTBOX_AREA, STAT_BUDGET, BODY_LIMITS, MOVEMENT_MODES } from '../rules.js';
import { r2 } from './area.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r1 = (v) => +v.toFixed(1);

/** Stats a form may set (v1 STATS minus width/height, which v2 replaces with `body`). */
export const STAT_KEYS = Object.keys(STATS).filter((k) => k !== 'width' && k !== 'height');
const PAID = STAT_KEYS.filter((k) => STATS[k].points);

/** Hurtbox-area cost (v2 curve, §4.1.1). A is clamped to [minArea, maxArea]. Negative = refund. */
export function areaCost(A) {
  const a = clamp(A, BODY_LIMITS.minArea, BODY_LIMITS.maxArea);
  const { free, min, points } = HURTBOX_AREA;
  if (a > free) return -Math.min(BODY_LIMITS.refundMax, (BODY_LIMITS.refundMax * (a - free)) / BODY_LIMITS.refundSpan);
  if (a >= min) return (points * (free - a)) / (free - min);
  return points + (BODY_LIMITS.smallPoints * (min - a)) / (min - BODY_LIMITS.minArea);
}

/** Stat cost of movement modes. */
export function movementCost(movement) {
  let c = 0;
  for (const m of Object.keys(movement || {}).sort()) c += MOVEMENT_MODES[m]?.cost ?? 0;
  return c;
}

/**
 * Price one form. `pricedArea` = A[default] × scaleMin².
 * @returns {{total: number, breakdown: Object<string, number>}}
 */
export function priceForm({ stats, movement, armor, pricedArea }) {
  const breakdown = {};
  let total = 0;
  for (const k of PAID) {
    const rule = STATS[k];
    breakdown[k] = r1(clamp((stats[k] - rule.min) / (rule.max - rule.min), 0, 1) * rule.points);
    total += breakdown[k];
  }
  breakdown.hurtboxArea = r1(areaCost(pricedArea));
  breakdown.movement = r1(movementCost(movement));
  breakdown.armor = r1((armor?.threshold || 0) * BODY_LIMITS.armorPoints);
  total += breakdown.hurtboxArea + breakdown.movement + breakdown.armor;
  return { total: r1(total), breakdown };
}

/** Clamp every stat into its v1 range (W110). */
export function clampStats(stats, path, notes) {
  for (const k of STAT_KEYS) {
    const rule = STATS[k];
    let v = isNum(stats[k]) ? stats[k] : rule.default;
    if (v < rule.min || v > rule.max) {
      const c = clamp(v, rule.min, rule.max);
      notes.add('W110', `${path}.${k}`, `${k} ${v} is outside ${rule.min}–${rule.max}; scaled to ${c}.`, { from: v, to: c, rule: `STATS.${k}` });
      v = c;
    }
    stats[k] = v;
  }
  if (stats.airJumps !== Math.round(stats.airJumps)) stats.airJumps = Math.round(stats.airJumps);
}

/** Clamp movement-mode params into MOVEMENT_MODES ranges (W310). */
export function clampMovement(movement, stats, path, notes) {
  for (const mode of Object.keys(movement).sort()) {
    const spec = MOVEMENT_MODES[mode];
    if (!spec) continue;
    const p = movement[mode];
    for (const [k, [lo, hiRaw]] of Object.entries(spec.ranges)) {
      if (!isNum(p[k])) continue;
      const hi = typeof hiRaw === 'string' ? r2(parseFloat(hiRaw) * stats.runSpeed) : hiRaw;
      const lo2 = Math.min(lo, hi);
      if (p[k] < lo2 || p[k] > hi) {
        const c = clamp(p[k], lo2, hi);
        notes.add('W310', `${path}.${mode}.${k}`, `${mode}.${k} ${p[k]} is outside ${lo2}–${hi}; set to ${c}.`, { from: p[k], to: c, rule: `MOVEMENT_MODES.${mode}` });
        p[k] = c;
      }
    }
  }
}

/**
 * Squeeze a form's paid stats toward their minimums until it fits STAT_BUDGET (v1 algorithm).
 * Mutates `stats`. Returns the final price.
 */
export function squeezeForm(form, pricedArea, path, notes) {
  const price = () => priceForm({ stats: form.stats, movement: form.movement, armor: form.armor, pricedArea });
  const before = price();
  if (before.total <= STAT_BUDGET) return before;
  const stats = form.stats;
  const orig = { ...stats };
  const apply = (t) => {
    for (const k of PAID) stats[k] = STATS[k].min + (orig[k] - STATS[k].min) * t;
    stats.airJumps = Math.floor(stats.airJumps + 1e-9);
  };
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; apply(mid); if (price().total > STAT_BUDGET) hi = mid; else lo = mid; }
  apply(Math.max(0, lo - 0.004));
  for (const k of PAID) stats[k] = STATS[k].min + Math.floor((stats[k] - STATS[k].min) * 100) / 100;
  const after = price();
  const changed = PAID.filter((k) => stats[k] !== orig[k]).map((k) => `${k} ${r2(orig[k])}→${r2(stats[k])}`);
  notes.add('W120', path, `costs ${before.total}/${STAT_BUDGET} stat points; paid stats scaled ${Math.round((1 - lo) * 100)}% toward their minimums (${changed.join(', ') || 'no change'}) → ${after.total}.`,
    { from: before.total, to: after.total, rule: 'STAT_BUDGET', fix: 'lower a stat you care less about, give the body a bigger hurtbox (refund), or drop a movement mode/armor.' });
  return after;
}
