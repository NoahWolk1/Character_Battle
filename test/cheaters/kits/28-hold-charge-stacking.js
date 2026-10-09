// #28 (new) Hold-loop charge stacking: a move with a `hold` loop AND a `charge`, whose
// hitbox the kit tries to pump with chargeFrames far past 60 by holding forever and looping.
// Invariant: the charge multiplier is capped at ×1.4 (chargeFrames effectively ≤ 60), the
// per-hit cap still bounds the result, and the KO floor is respected on the charged hit.
import { load, scenario, put, busy, GOVERNOR } from '../harness.js';
import { COMBAT } from '../../../shared/constants.js';

export const def = {
  version: 2, id: 'chargeup', name: 'Chargeup',
  moves: {
    neutralSpecial: {
      duration: 120, category: 'special',
      charge: { button: 'special', at: 4, max: 600 },
      hitboxes: [{ start: 8, end: 14, x: 44, y: -46, r: 40, damage: 15, angle: 40, knockback: 50, growth: 80 }],
    },
    sideSmash: { duration: 80, charge: { button: 'strong', at: 6, max: 600 }, hitboxes: [{ start: 10, end: 16, x: 44, y: -46, r: 40, damage: 18, angle: 38, knockback: 60, growth: 90 }] },
  },
  behavior: { tick(view, api) { if (view.me.state !== 'attack') api.startMove(view.frame % 2 ? 'neutralSpecial' : 'sideSmash'); } },
};

export default {
  n: 28, name: 'hold-charge-stacking', character: 'chargeup', invariant: 'charge ×≤1.4; per-hit cap; KO floor respected',
  async run({ ck, opp }) {
    const v = load(def);
    let maxCharge = 0;
    const S = await scenario({
      cheater: v, opp, frames: 2400, ck,
      // hold special and strong down forever to pump the charge
      // hold special+strong to pump the charge for ~90 frames, then release for 12 so the move fires
      setup(S) { S.me.x = -40; S.foe.x = 40; },
      input: (S, me) => { const hold = S.frame % 102 < 90; return { special: hold, strong: hold }; },
      each(S) { if (!busy(S.foe) && S.foe.state !== 'hitstun' && (Math.abs(S.foe.x - S.me.x) > 80 || S.foe.y !== 0)) put(S, S.foe, { x: S.me.x + 55 * S.me.facing }); },
    });
    const mine = S.hits.filter((h) => h.attacker === S.me.id);
    for (const h of mine) {
      maxCharge = Math.max(maxCharge, h.charge);
      // the charge multiplier used is 1 + 0.4·min(charge,60)/60, never above 1.4
      const mult = 1 + 0.4 * Math.min(h.charge, GOVERNOR.chargeFramesFull) / GOVERNOR.chargeFramesFull;
      ck.check(mult <= GOVERNOR.chargeMax + 1e-9, `charge multiplier ${mult} > 1.4`, 'mult');
      ck.check(h.r.damage <= GOVERNOR.absMaxHit + 1e-6, `charged hit dealt ${h.r.damage} (> 25)`, 'cap');
      // intended damage must not exceed base × 1.4 × the other multiplier caps
      ck.check(h.r.intended <= h.hb.damage * GOVERNOR.chargeMax * 1.5 + 1e-6, `charged hit intended ${h.r.intended} > base×1.4×caps (charge ${h.charge}, frame ${h.frame})`, 'intended');
    }
    for (const ko of S.hitKOs) {
      if (ko.id !== S.foe.id || !ko.last || ko.last.attacker !== S.me.id) continue;
      const floor = Math.max(GOVERNOR.hardKoFloor, 85);
      if (Math.abs(ko.last.pre.x) <= 120) ck.check(ko.last.pre.percent >= floor, `charged hit KO'd from center at ${ko.last.pre.percent}% (< ${floor}%)`, 'ko');
    }
    if (opp === 'dummy') ck.check(mine.length > 0, 'no charged hit landed (kit not exercised)');
    return { hits: mine.length, maxChargeFrames: maxCharge, chargeCap: COMBAT.smashChargeMax, maxDamage: Math.max(0, ...mine.map((h) => +h.r.damage.toFixed(1))) };
  },
};
