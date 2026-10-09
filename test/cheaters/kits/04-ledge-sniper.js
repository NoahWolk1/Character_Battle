// #4 Ledge sniper: a max-knockback jab against a 0% target standing at the ledge.
// Invariant: no KO below 60%, and no launch above the tier floor × ramp cap.
import { load, scenario, put, busy, GOVERNOR, TIER } from '../harness.js';
import { worstKoSpeed } from '../../../shared/sim/ko-table.js';

export const def = {
  version: 2, id: 'sniper', name: 'Sniper',
  moves: {
    jab: { duration: 14, hitboxes: [{ start: 2, end: 4, x: 36, y: -46, r: 30, damage: 5, angle: 40, knockback: 999, growth: 999 }] },
    side: { duration: 22, hitboxes: [{ start: 5, end: 7, x: 40, y: -46, r: 30, damage: 12, angle: 30, knockback: 999, growth: 999 }] },
  },
};

const PCTS = [0, 0, 15, 30, 45, 59];

export default {
  n: 4, name: 'ledge-sniper', character: 'sniper', invariant: 'no KO below 60%; launch ≤ 0.95·Vko·ramp below the floor',
  async run({ ck, opp }) {
    const v = load(def);
    let trial = 0, t0 = -1000;
    const S = await scenario({
      cheater: v, opp, frames: 3600, ck,
      input(S, me) {
        const k = S.frame - t0;
        if (k >= 200) {
          if (busy(me) || busy(S.foe)) return {};
          t0 = S.frame; trial++;
          put(S, S.foe, { x: 520, percent: PCTS[trial % PCTS.length], facing: -1 });
          put(S, me, { x: 470, facing: 1 });
          return {};
        }
        if (k === 2) return trial % 2 ? { attack: true } : { attack: true, right: true };
        // the idle dummy never recovers: once the launch is over (no knockback left), bring it back
        if (k > 20 && k < 200 && S.foe.state !== 'hitstun' && !busy(S.foe) && (S.foe.y > 0 || Math.abs(S.foe.x) > 540)) put(S, S.foe, { x: 300 });
        return {};
      },
    });
    const gov = S.game.gov;
    const mine = S.hits.filter((h) => h.attacker === 'p1' && h.target === S.foe.id);
    for (const h of mine) {
      const F = Math.max(GOVERNOR.hardKoFloor, TIER[h.tier]?.koFloor ?? 100);
      if (h.pre.percent >= F) continue;
      const worst = worstKoSpeed(gov.koTableFor(S.foe), h.r.angle, GOVERNOR.koDiWindow, GOVERNOR.koDiStep);
      const cap = GOVERNOR.koSafety * worst * (GOVERNOR.koRampMin + (1 - GOVERNOR.koRampMin) * (h.pre.percent / F));
      ck.check(h.r.speed <= cap + 1e-6, `${h.tier} hit at ${h.pre.percent}% launched at ${h.r.speed.toFixed(2)} > floor×ramp cap ${cap.toFixed(2)} (frame ${h.frame})`, 'cap');
    }
    for (const ko of S.hitKOs) {
      if (ko.id !== S.foe.id || !ko.last || ko.last.attacker !== 'p1') continue;
      ck.check(ko.last.pre.percent >= 60, `ledge snipe KO'd the target at ${ko.last.pre.percent}% (< 60%, frame ${ko.frame})`, 'ko60');
    }
    if (opp === 'dummy') ck.check(mine.length >= 10, `only ${mine.length} ledge hits landed`);
    return { hits: mine.length, hitKOs: S.hitKOs.length, maxSpeed: Math.max(0, ...mine.map((h) => +h.r.speed.toFixed(2))) };
  },
};
