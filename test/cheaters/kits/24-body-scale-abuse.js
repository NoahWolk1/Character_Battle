// #24 Body-scale abuse: setBodyScale(0.01) (and 50) every tick, with a scaleRange the kit
// tries to set to [0.01, 50]. Invariant: clamped to scaleRange, which is clamped to
// [0.6, 1.6]; the validator prices hurtbox area at the minimum scale.
import { load, scenario } from '../harness.js';
import { LIMITS as SCRIPT_LIMITS } from '../../../shared/sim/script-api.js';

export const def = {
  version: 2, id: 'shrinker', name: 'Shrinker',
  body: { collider: { w: 60, h: 100 }, scaleRange: [0.01, 50], hurtboxes: { default: [{ shape: 'rect', x: 0, y: -50, w: 60, h: 100 }] } },
  moves: { jab: { duration: 16, hitboxes: [{ start: 2, end: 4, x: 34, y: -40, r: 24, damage: 4, angle: 40, knockback: 15, growth: 20 }] } },
  // 0.01 for 400 frames (must settle at the 0.6 floor), 50 for 400 (the 1.6 ceiling), then flicker
  behavior: { tick(view, api) { const f = view.frame; api.setBodyScale(f < 400 ? 0.01 : f < 800 ? 50 : f % 2 ? 0.01 : 50); } },
};

export default {
  n: 24, name: 'body-scale-abuse', character: 'shrinker', invariant: 'scale clamped to scaleRange ⊆ [0.6, 1.6]; area priced at min',
  async run({ ck, opp }) {
    const v = load(def);
    const body = v.character.body || v.character.forms?.base?.body;
    const sr = body.scaleRange;
    ck.check(sr[0] >= 0.6 - 1e-9 && sr[1] <= 1.6 + 1e-9 && sr[0] <= sr[1], `scaleRange ${JSON.stringify(sr)} not clamped to [0.6, 1.6]`);
    ck.check(sr[0] >= SCRIPT_LIMITS.scaleMin - 1e-9, `scaleRange min ${sr[0]} < runtime scaleMin ${SCRIPT_LIMITS.scaleMin}`);
    // Area is priced at the minimum scale: pricedArea = default area × scaleMin², and a
    // range reaching down to 0.6 costs more stat points than the same body at [1, 1].
    const rawArea = body.hurtboxes.default.reduce((s, h) => s + (h.w ?? 2 * h.r) * (h.h ?? 2 * h.r), 0);
    const base = v.report.forms?.base || {};
    ck.check(Math.abs(base.scaleMin - sr[0]) < 1e-9, `report scaleMin ${base.scaleMin} ≠ clamped scaleRange min ${sr[0]}`);
    ck.check(Math.abs(base.pricedArea - rawArea * sr[0] * sr[0]) <= 1, `pricedArea ${base.pricedArea} ≠ area ${rawArea} × ${sr[0]}² (area not priced at the minimum scale)`);
    const fixed = load({ ...def, body: { ...def.body, scaleRange: [1, 1] } });
    const cost = (r) => r.report.forms?.base?.statPoints?.breakdown?.hurtboxArea ?? 0;
    ck.check(cost(v) > cost(fixed), `shrinking range not charged: hurtboxArea cost ${cost(v)} vs ${cost(fixed)} at [1, 1]`);
    let lo = 9, hi = 0;
    const S = await scenario({
      cheater: v, opp, frames: 1200, ck,
      input: (S) => (S.frame === 380 || S.frame === 780 ? { attack: true } : {}),
      each(S) {
        const s = S.me.bodyScale;
        lo = Math.min(lo, s); hi = Math.max(hi, s);
        ck.check(s >= sr[0] - 1e-6 && s <= sr[1] + 1e-6, `bodyScale ${s} outside scaleRange [${sr[0]}, ${sr[1]}] (frame ${S.frame})`, 'range');
        ck.check(s >= 0.6 - 1e-6 && s <= 1.6 + 1e-6, `bodyScale ${s} outside [0.6, 1.6] (frame ${S.frame})`, 'abs');
      },
    });
    ck.check(lo <= 0.6 + 0.02 && hi >= 1.6 - 0.02, `scale never reached the clamps (min ${lo.toFixed(3)}, max ${hi.toFixed(3)}; kit not exercised)`);
    return { pricedArea: base.pricedArea, hurtboxAreaCost: cost(v), hurtboxAreaCostFixed: cost(fixed), scaleRange: sr, minScaleSeen: +lo.toFixed(3), maxScaleSeen: +hi.toFixed(3) };
  },
};
