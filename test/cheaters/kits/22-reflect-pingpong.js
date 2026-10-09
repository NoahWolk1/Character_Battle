// #22 Reflect ping-pong: two reflector entities (the cheater's and a teammate's) bounce
// a projectile back and forth to stack the ×1.25 reflected bonus and the speed every pass.
// Invariant: the reflected ×1.25 damage applies only once; the projectile speed cap holds;
// the projectile's life still expires (no immortal loop).
import { load, scenario, GOVERNOR } from '../harness.js';
import { LIMITS as ENT_LIMITS } from '../../../shared/sim/entities.js';

export const def = {
  version: 2, id: 'bouncer', name: 'Bouncer',
  entities: {
    shot: { kind: 'projectile', life: 300, reflectable: true, shape: { shape: 'circle', x: 0, y: 0, r: 10 }, motion: { type: 'linear', speed: 10 }, hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 16, damage: 10, angle: 30, knockback: 40, growth: 40 }] },
    mirror: { kind: 'trap', life: 600, shape: { shape: 'rect', x: 0, y: -40, w: 24, h: 120 }, motion: { type: 'stationary' }, hitboxes: [{ shape: 'rect', x: 0, y: -40, w: 24, h: 120, kind: 'reflect' }] },
  },
  moves: { neutralSpecial: { duration: 20, timeline: [{ at: 2, spawn: 'shot', x: 30, y: -40 }] } },
  behavior: {
    init(view, api) { api.spawn('mirror', { x: 0, y: 0 }); },
    tick(view, api) {
      if (view.entities('mirror').length < 1) api.spawn('mirror', { x: 0, y: 0 });
      if (view.frame % 24 === 0) api.startMove('neutralSpecial');
    },
  },
};

export default {
  n: 22, name: 'reflect-pingpong', character: 'bouncer', invariant: 'reflected ×1.25 once; speed cap; life expires',
  async run({ ck, opp }) {
    const v = load(def);
    const teammate = load({ ...def, id: 'bouncer2', name: 'Bouncer2' }).character;
    let maxSpeed = 0, maxReflects = 0, maxLifeSeen = 0;
    const S = await scenario({
      cheater: v, opp, frames: 2400, ck, extra: [{ character: teammate }],
      setup(S) { S.me.x = -200; S.foe.x = 500; S.game.fighters[2].x = 200; S.game.fighters[2].facing = -1; },
      each(S) {
        for (const e of S.game.entities) {
          if (!e.kind || e.kind !== 'projectile' || e.dead) continue;
          const sp = Math.hypot(e.vx, e.vy);
          maxSpeed = Math.max(maxSpeed, sp);
          maxLifeSeen = Math.max(maxLifeSeen, e.maxLife - e.life);
          // v1 reflect cap is 14 px/f; a projectile may not accelerate past it by repeated bounces.
          ck.check(sp <= 14 + 1e-6, `reflected projectile travelling at ${sp.toFixed(2)} px/f (> 14, frame ${S.frame})`, 'speed');
          ck.check(e.age <= e.maxLife, `projectile age ${e.age} exceeds life ${e.maxLife}`, 'life');
        }
      },
    });
    // The reflected bonus is a one-shot ×1.25, never compounding: a single reflected hit's
    // multiplier is ≤ reflectedMul, and the per-hit cap still bounds it.
    for (const h of S.hits) {
      if (!h.reflected) continue;
      maxReflects++;
      ck.check(h.r.damage <= GOVERNOR.absMaxHit + 1e-6, `reflected hit dealt ${h.r.damage} (> 25)`, 'dmg');
      const base = h.hb.damage * GOVERNOR.reflectedMul * 1.5 + 1e-6; // staleness/charge ≤ their caps already in multMax
      ck.check(h.r.intended <= base, `reflected hit intended ${h.r.intended} > base×1.25×caps ${base.toFixed(1)}`, 'once');
    }
    ck.check(ENT_LIMITS.reflectMul <= 1.2 + 1e-9, `reflect speed multiplier ${ENT_LIMITS.reflectMul} compounds fast`);
    if (opp === 'dummy') ck.check(S.events.some((e) => e.type === 'reflect'), 'no reflect ever happened (kit not exercised)');
    return { reflectEvents: S.events.filter((e) => e.type === 'reflect').length, reflectedHits: maxReflects, maxProjectileSpeed: +maxSpeed.toFixed(2), maxLifeConsumed: maxLifeSeen };
  },
};
