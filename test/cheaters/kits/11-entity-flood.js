// #11 Entity flood: spawn 50 homing minions per frame (script + a timeline `every`).
// Invariant: ≤ 8 alive, ≤ 10 threat, ≤ 4 spawns per 60 frames; damage rate ≤ 50 per
// 120 frames (attacker → target, every source combined).
import { load, scenario, maxWindow, GOVERNOR } from '../harness.js';
import { ENTITY_THREAT } from '../../../shared/balance/governor-rules.js';
import { kindTier } from '../../../shared/sim/entities.js';

export const def = {
  version: 2, id: 'hivemind', name: 'Hivemind',
  entities: {
    bee: {
      kind: 'minion', life: 99999, hp: 999, maxAlive: 999, shape: { shape: 'circle', x: 0, y: 0, r: 14 },
      motion: { type: 'homing', speed: 99, turn: 9, target: 'nearestEnemy' },
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 40, damage: 999, angle: 45, knockback: 99, growth: 99, rehit: 3 }],
      every: { frames: 1, spawn: 'bee' },
    },
    dart: { kind: 'projectile', life: 999, shape: { shape: 'circle', x: 0, y: 0, r: 10 }, motion: { type: 'homing', speed: 99, turn: 9 }, hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 30, damage: 999, angle: 45, knockback: 50, growth: 50 }] },
  },
  moves: { neutralSpecial: { duration: 30, timeline: [{ from: 1, to: 29, every: 1, spawn: 'bee', x: 0, y: -40, count: 5 }] } },
  behavior: { tick(view, api) { for (let i = 0; i < 50; i++) api.spawn(i % 2 ? 'bee' : 'dart', { x: 20, y: -40 }); api.startMove('neutralSpecial'); } },
};

export default {
  n: 11, name: 'entity-flood', character: 'hivemind', invariant: '≤ 8 alive, ≤ 10 threat, ≤ 4 spawns/60 f, ≤ 50 dmg/120 f',
  async run({ ck, opp }) {
    const v = load(def);
    let maxAlive = 0, maxThreat = 0;
    const spawns = [];
    const dealt = [];
    const S = await scenario({
      cheater: v, opp, frames: 3000, ck,
      each(S) {
        const mine = S.game.entities.filter((e) => e.owner === S.me.id && e.life > 0 && !e.dead);
        const threat = mine.reduce((s, e) => s + (ENTITY_THREAT[kindTier(e.def || {})] ?? 1), 0);
        maxAlive = Math.max(maxAlive, mine.length);
        maxThreat = Math.max(maxThreat, threat);
        ck.check(mine.length <= GOVERNOR.entities.maxAlive, `${mine.length} live entities (> 8, frame ${S.frame})`, 'alive');
        ck.check(threat <= GOVERNOR.entities.maxThreat, `threat ${threat} (> 10, frame ${S.frame})`, 'threat');
        for (const e of S.frameEvents) {
          if (e.type === 'spawn' && e.o === S.me.id) spawns.push({ frame: S.frame });
        }
      },
    });
    // exact (unrounded) governed damage: strikes + DoT ticks from the cheater to the opponent
    for (const h of S.hits) if (h.attacker === S.me.id && h.target === S.foe.id) dealt.push({ frame: h.frame, d: h.r.damage });
    for (const d of S.dots) if (d.source === S.me.id && d.target === S.foe.id) dealt.push({ frame: d.frame, d: d.damage });
    dealt.sort((a, b) => a.frame - b.frame);
    const s60 = maxWindow(spawns, 60);
    const d120 = maxWindow(dealt, 120, (x) => x.d);
    const d600 = maxWindow(dealt, 600, (x) => x.d);
    ck.check(s60 <= GOVERNOR.entities.spawnsPerWindow, `${s60} spawns within 60 frames (> 4)`);
    ck.check(d120 <= GOVERNOR.rate.hard + 1e-6, `${d120.toFixed(1)} damage to one target within 120 frames (> 50)`);
    ck.check(d600 <= GOVERNOR.rate.longHard + 1e-6, `${d600.toFixed(1)} damage to one target within 600 frames (> 140)`);
    if (opp === 'dummy') ck.check(spawns.length > 10 && dealt.length > 0, `kit not exercised: ${spawns.length} spawns, ${dealt.length} hits`);
    return { maxAlive, maxThreat, spawns: spawns.length, spawns60: s60, dmg120: +d120.toFixed(1), dmg600: +d600.toFixed(1), commandCap: S.gov.scriptCommands || 0 };
  },
};
