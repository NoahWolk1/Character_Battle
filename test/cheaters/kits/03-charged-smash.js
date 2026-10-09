// #3 Fully charged smash against a weight-70 target.
// Invariant: no KO from center stage below 85% (smash tier floor).
import { load, scenario, put, busy } from '../harness.js';

export const def = {
  version: 2, id: 'slugger', name: 'Slugger',
  stats: { weight: 120 },
  moves: {
    sideSmash: {
      duration: 48, charge: { button: 'strong', at: 9, max: 60 },
      hitboxes: [{ start: 12, end: 16, x: 44, y: -46, r: 40, damage: 18, angle: 38, knockback: 999, growth: 999 }],
    },
    upSmash: {
      duration: 48, charge: { button: 'strong', at: 9, max: 60 },
      hitboxes: [{ start: 12, end: 16, x: 10, y: -90, r: 46, damage: 18, angle: 88, knockback: 999, growth: 999 }],
    },
  },
};

const PCTS = [0, 30, 55, 70, 80, 84, 84.9, 140]; // 140: control trial (a KO there is legal)
const FLOOR = 85;

export default {
  n: 3, name: 'charged-smash', character: 'slugger', invariant: 'no center-stage KO below 85% (weight-70 target)',
  async run({ ck, opp }) {
    const v = load(def);
    let trial = 0, t0 = -1000;
    const S = await scenario({
      cheater: v, opp, frames: 3600, ck, dummy: { weight: 70 },
      input(S, me) {
        const k = S.frame - t0;
        if (k >= 240) {
          if (busy(me) || busy(S.foe)) return {};
          t0 = S.frame; trial++;
          put(S, S.foe, { x: 0, percent: PCTS[trial % PCTS.length], facing: -1 });
          put(S, me, { x: -52, facing: 1 });
          return {};
        }
        if (k >= 2 && k < 72) return { strong: true, right: k === 2, up: trial % 3 === 0 }; // hold to full charge
        return {};
      },
    });
    const smashes = S.hits.filter((h) => h.attacker === 'p1' && h.target === S.foe.id);
    for (const ko of S.hitKOs) {
      if (ko.id !== S.foe.id || !ko.last || ko.last.attacker !== 'p1') continue;
      ck.check(ko.last.pre.percent >= FLOOR || Math.abs(ko.last.pre.x) > 150, `charged smash KO'd the target from center at ${ko.last.pre.percent}% (< ${FLOOR}%, frame ${ko.frame})`, 'early');
    }
    const charged = smashes.filter((h) => h.charge >= 50);
    if (opp === 'dummy') ck.check(charged.length >= 8, `only ${charged.length} fully charged smashes landed`);
    const below = smashes.filter((h) => h.pre.percent < FLOOR && Math.abs(h.pre.x) <= 150);
    return { smashes: smashes.length, charged: charged.length, belowFloorCenter: below.length, hitKOs: S.hitKOs.map((k) => k.last && k.last.pre.percent) };
  },
};
