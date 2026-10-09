// #26 (new) Clone + reflect loop: spawn a mimic clone every frame (a clone can't spawn
// clones, but the owner keeps trying), and arm the clone with a reflect box so the clone's
// attacks and the owner's projectiles ping between them. Invariant: ≤ 1 clone alive; clone
// strikes deal ≤ 0.5 × owner damage and are capped; a clone never spawns a clone; the
// entity/threat budgets hold under the flood.
import { load, scenario, GOVERNOR } from '../harness.js';
import { ENTITY_THREAT } from '../../../shared/balance/governor-rules.js';
import { kindTier } from '../../../shared/sim/entities.js';

export const def = {
  version: 2, id: 'twinner', name: 'Twinner',
  entities: {
    echo: { kind: 'clone', life: 600, hp: 25, scale: 1, motion: { type: 'mimic', delay: 6 }, shape: { shape: 'circle', x: 0, y: -40, r: 26 } },
    dart: { kind: 'projectile', life: 200, reflectable: true, shape: { shape: 'circle', x: 0, y: 0, r: 9 }, motion: { type: 'linear', speed: 9 }, hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 14, damage: 10, angle: 30, knockback: 40, growth: 40 }] },
  },
  moves: {
    jab: { duration: 16, hitboxes: [{ start: 2, end: 4, x: 34, y: -46, r: 28, damage: 5, angle: 40, knockback: 20, growth: 40 }] },
    neutralSpecial: { duration: 20, timeline: [{ at: 2, spawn: 'dart', x: 30, y: -40 }] },
  },
  behavior: {
    tick(view, api) {
      for (let i = 0; i < 10; i++) api.spawn('echo', { x: 40, y: 0 }); // flood: the governor must keep only one
      if (view.frame % 20 === 0) api.startMove('neutralSpecial');
      const e = view.nearestEnemy();
      if (e && Math.abs(e.x - view.me.x) < 120) api.startMove('jab');
    },
  },
};

export default {
  n: 26, name: 'clone-swarm', character: 'twinner', invariant: '≤ 1 clone; clone hits ≤ 0.5× and capped; no clone-of-clone',
  async run({ ck, opp }) {
    const v = load(def);
    let maxClones = 0, maxAlive = 0, maxThreat = 0;
    const S = await scenario({
      cheater: v, opp, frames: 2400, ck,
      setup(S) { S.me.x = -40; S.foe.x = 60; },
      each(S) {
        const mine = S.game.entities.filter((e) => e.owner === S.me.id && e.life > 0 && !e.dead);
        const clones = mine.filter((e) => e.kind === 'clone');
        maxClones = Math.max(maxClones, clones.length);
        maxAlive = Math.max(maxAlive, mine.length);
        maxThreat = Math.max(maxThreat, mine.reduce((s, e) => s + (ENTITY_THREAT[kindTier(e.def || {})] ?? 1), 0));
        ck.check(clones.length <= GOVERNOR.entities.maxClones, `${clones.length} clones alive (> 1, frame ${S.frame})`, 'clones');
        ck.check(mine.length <= GOVERNOR.entities.maxAlive, `${mine.length} entities (> 8)`, 'alive');
        // A clone must never itself own an entity (no clone-of-clone, no clone projectiles).
        for (const c of clones) ck.check(!S.game.entities.some((x) => x.owner === (c.minor && c.minor.id)), `a clone owns entities (frame ${S.frame})`, 'cloneOwns');
      },
    });
    const cloneHits = S.hits.filter((h) => h.clone);
    for (const h of cloneHits) {
      ck.check(h.r.damage <= GOVERNOR.absMaxHit + 1e-6, `clone hit ${h.r.damage} (> 25)`, 'cap');
      ck.check(h.r.intended <= h.hb.damage * GOVERNOR.cloneMul * 1.5 + 1e-6, `clone hit intended ${h.r.intended} > 0.5×base×caps (frame ${h.frame})`, 'half');
    }
    if (opp === 'dummy') ck.check(maxClones >= 1, 'no clone ever spawned (kit not exercised)');
    return { maxClones, maxAlive, maxThreat, cloneHits: cloneHits.length, reflects: S.events.filter((e) => e.type === 'reflect').length };
  },
};
