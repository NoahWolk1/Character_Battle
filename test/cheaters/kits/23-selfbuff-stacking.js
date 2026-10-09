// #23 Self-buff stacking: 20 api.modify sets of damageOut 2 (and damageIn 0.1, speed 9),
// plus stacking buff statuses. Invariant: the combined damageOut ≤ 1.15 (every mod stays
// in its §4.2.9 range after all sources multiply).
import { load, scenario, brawler, MOD_RANGES } from '../harness.js';

const statuses = {};
for (let i = 0; i < 6; i++) statuses[`rage${i}`] = { frames: 300, stack: 'add', maxStacks: 3, mods: { damageOut: 2, speed: 2, knockbackIn: 0.1 } };

export const def = {
  version: 2, id: 'juicer', name: 'Juicer', statuses,
  moves: { jab: { duration: 16, hitboxes: [{ start: 2, end: 4, x: 34, y: -46, r: 26, damage: 5, angle: 40, knockback: 20, growth: 40 }] } },
  behavior: {
    init(view, api) { for (let i = 0; i < 30; i++) api.modify(`b${i}`, { damageOut: 2, damageIn: 0.1, speed: 9, jump: 9, gravity: 9, fallSpeed: 9, knockbackIn: 9 }); },
    tick(view, api) {
      for (let i = 0; i < 30; i++) api.modify(`b${i}`, { damageOut: 2, damageIn: 0.1, speed: 9, knockbackIn: 0.01 });
      for (let i = 0; i < 6; i++) { api.status('self', `rage${i}`); api.status('self', 'weaken'); }
    },
  },
};

export default {
  n: 23, name: 'selfbuff-stacking', character: 'juicer', invariant: 'combined damageOut ≤ 1.15 (every mod clamped)',
  async run({ ck, opp }) {
    const v = load(def);
    const seen = { damageOut: 0, speed: 0, damageIn: 2 };
    const S = await scenario({
      cheater: v, opp, frames: 1800, ck, input: brawler(['attack', 'attack+fwd'], { gap: 12 }),
      each(S) {
        const m = S.me.mods;
        if (!m) return;
        for (const [k, [lo, hi]] of Object.entries(MOD_RANGES)) ck.check(m[k] >= lo - 1e-6 && m[k] <= hi + 1e-6, `mods.${k} = ${m[k]} outside [${lo}, ${hi}] (frame ${S.frame})`, `range:${k}`);
        seen.damageOut = Math.max(seen.damageOut, m.damageOut);
        seen.speed = Math.max(seen.speed, m.speed);
        seen.damageIn = Math.min(seen.damageIn, m.damageIn);
        // damageOut must actually be clamped (the kit tries to push it to 2^many)
        ck.check(m.damageOut <= 1.15 + 1e-6, `damageOut ${m.damageOut} > 1.15 (frame ${S.frame})`, 'dout');
      },
    });
    // Also check it on the wire: no dealt hit exceeds base × 1.15 × the other caps.
    for (const h of S.hits) {
      if (h.attacker !== S.me.id) continue;
      ck.check(h.dOut <= 1.15 + 1e-6, `hit used damageOut ${h.dOut} (frame ${h.frame})`, 'hitDout');
    }
    const landed = S.hits.filter((h) => h.attacker === S.me.id).length;
    if (opp === 'dummy') ck.check(landed > 0, 'no hits landed (kit not exercised)');
    return { maxDamageOut: +seen.damageOut.toFixed(3), maxSpeed: +seen.speed.toFixed(3), minDamageIn: +seen.damageIn.toFixed(3), modifyCap: S.gov.scriptModify || 0, landed };
  },
};
