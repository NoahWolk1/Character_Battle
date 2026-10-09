// #16 Relay-0 wall: a `part` with relay 0, permanent life and 9999 hp held in front,
// respawned constantly. Invariant: normalized to relay ≥ 0.5, hp ≤ 25, life ≤ 900;
// the mitigation budget applies (≤ 50%/hit, ≤ 45/stock).
import { load, scenario, maxWindow, brawler } from '../harness.js';

export const def = {
  version: 2, id: 'bulwark', name: 'Bulwark',
  entities: {
    wall: { kind: 'part', relay: 0, life: 999999, hp: 9999, maxAlive: 99, shape: { shape: 'rect', x: 0, y: -50, w: 80, h: 140 }, motion: { type: 'attached' }, anchor: { x: 70, y: 0 } },
  },
  behavior: { tick(view, api) { if (view.entities('wall').length < 3) api.spawn('wall'); } },
};

export default {
  n: 16, name: 'relay-wall', character: 'bulwark', invariant: 'relay ≥ 0.5, hp ≤ 25, life ≤ 900; mitigation budget',
  async run({ ck, opp }) {
    const v = load(def);
    const w = v.character.entities.wall;
    ck.check(w.relay >= 0.5, `IR relay ${w.relay} (< 0.5)`);
    ck.check(w.hp <= 25, `IR hp ${w.hp} (> 25)`);
    ck.check(w.life <= 900 && w.life > 0, `IR life ${w.life} (not in (0, 900])`);
    const S = await scenario({
      cheater: v, opp, frames: 3600, ck, // the dummy pokes from range: its attacks reach the wall in front of the cheater
      dummyRole: brawler(['attack', 'attack+fwd', 'strong+fwd'], { gap: 14, reach: 105, target: (s) => s.me }),
      setup(S) { S.me.x = -100; S.foe.x = 10; },
      each(S) {
        for (const e of S.game.entities) {
          if (e.owner !== S.me.id || e.kind !== 'part' || e.dead) continue;
          ck.check(e.relay >= 0.5, `live part relay ${e.relay}`, 'relay');
          ck.check(e.hp === null || e.hp <= 25, `live part hp ${e.hp}`, 'hp');
          ck.check(e.maxLife <= 900, `live part life ${e.maxLife}`, 'life');
        }
      },
    });
    const onMe = S.hits.filter((h) => h.target === S.me.id);
    let stock = 0, worst = 0, ki = 0;
    const koFrames = S.kos.filter((k) => k.id === S.me.id).map((k) => k.frame);
    for (const h of onMe) {
      while (ki < koFrames.length && koFrames[ki] <= h.frame) { ki++; stock = 0; }
      ck.check(h.r.prevented <= 0.5 * h.r.partDamage + 1e-6, `relay prevented ${h.r.prevented.toFixed(2)} of ${h.r.partDamage.toFixed(2)} (> 50%)`, 'perHit');
      stock += h.r.prevented; worst = Math.max(worst, stock);
    }
    ck.check(worst <= 45 + 1e-6, `prevented ${worst.toFixed(1)} in one stock (> 45)`);
    const w300 = maxWindow(onMe, 300, (h) => h.r.prevented);
    ck.check(w300 <= 20 + 1e-6, `prevented ${w300.toFixed(1)} per 300 f (> 20)`);
    const relayed = onMe.filter((h) => h.relay !== undefined).length;
    if (opp === 'dummy') ck.check(relayed > 0, 'no hit was relayed through the wall (kit not exercised)');
    return { hitsTaken: onMe.length, relayed, preventedPerStock: +worst.toFixed(1), prevented300: +w300.toFixed(1), irWall: { relay: w.relay, hp: w.hp, life: w.life } };
  },
};
