// #14 0-to-death multi-hit "infinite": a rehit-3 jab with a long active window that drags
// the target along (angle 0 toward the attacker, tiny knockback), restarted forever.
// Invariant: BREAK by 14 effective hits (rehit hits count 1/3) or 55% chain damage;
// no KO from a chain below the floor.
import { load, scenario, GOVERNOR } from '../harness.js';

export const def = {
  version: 2, id: 'blender', name: 'Blender',
  moves: {
    jab: {
      duration: 60, velocity: [{ start: 0, end: 60, vx: 2 }],
      cancels: [{ from: 1, to: 60, into: ['jab'], onHit: true }],
      hitboxes: [{ start: 2, end: 58, x: 36, y: -46, r: 44, damage: 4, angle: 90, knockback: 22, growth: 0, rehit: 3 }],
    },
    side: { duration: 40, hitboxes: [{ start: 3, end: 38, x: 40, y: -46, r: 44, damage: 6, angle: 90, knockback: 22, growth: 0, rehit: 3 }] },
  },
  behavior: {
    tick(view, api) { const e = view.nearestEnemy(); if (e && Math.abs(e.x - view.me.x) < 110) api.startMove(view.frame % 2 ? 'jab' : 'side'); },
  },
};

const LOCKED = new Set(['hitstun', 'stunned', 'grabbed']);

export default {
  n: 14, name: 'multihit-infinite', character: 'blender', invariant: 'BREAK by 14 effective hits or 55%; no chain KO below floor',
  async run({ ck, opp }) {
    const v = load(def);
    let n = 0, dmg = 0, idle = 0, maxN = 0, maxDmg = 0, hi = 0;
    const S = await scenario({
      cheater: v, opp, frames: 3600, ck,
      input: (S, me) => (Math.abs(S.foe.x - me.x) > 60 ? { [S.foe.x > me.x ? 'right' : 'left']: true } : {}),
      each(S) {
        const t = S.foe;
        for (; hi < S.hits.length; hi++) {
          const h = S.hits[hi];
          if (h.target !== t.id) continue;
          n += h.rehit ? GOVERNOR.rehitWeight : 1; dmg += h.r.damage;
          maxN = Math.max(maxN, n); maxDmg = Math.max(maxDmg, dmg);
          ck.check(n < GOVERNOR.breakHits + 1e-6 || h.r.broke, `chain reached ${n.toFixed(2)} effective hits without a BREAK (frame ${h.frame})`, 'n');
          ck.check(dmg - h.r.damage < GOVERNOR.breakDamage + 1e-6 || h.r.broke, `chain dealt ${dmg.toFixed(1)}% without a BREAK (frame ${h.frame})`, 'dmg');
          if (h.r.broke) { ck.check(h.r.hitstun === 0, `BREAK hit still gave ${h.r.hitstun} hitstun`, 'breakStun'); n = 0; dmg = 0; }
        }
        if (S.breaks.some((b) => b.frame === S.frame && b.target === t.id)) { n = 0; dmg = 0; }
        if (t.hitlag > 0 || LOCKED.has(t.state)) idle = 0; else if (++idle >= GOVERNOR.chainIdleReset) { n = 0; dmg = 0; }
      },
    });
    for (const ko of S.hitKOs) {
      if (ko.id !== S.foe.id || !ko.last || ko.last.attacker !== S.me.id) continue;
      ck.check(ko.last.pre.percent >= GOVERNOR.hardKoFloor, `chain KO at ${ko.last.pre.percent.toFixed(1)}% (< 60%, frame ${ko.frame})`, 'chainKO');
    }
    const landed = S.hits.filter((h) => h.attacker === S.me.id).length;
    if (opp === 'dummy') ck.check(landed > 40 && S.breaks.length > 0, `kit not exercised: ${landed} hits, ${S.breaks.length} BREAKs`);
    return { landed, breaks: S.breaks.length, maxChainHits: +maxN.toFixed(2), maxChainDamage: +maxDmg.toFixed(1), hitKOs: S.hitKOs.length };
  },
};
