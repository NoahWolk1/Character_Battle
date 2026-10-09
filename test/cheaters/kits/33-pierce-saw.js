// #33 (new) Lingering pierce saw: a parked projectile with maxHits 999, pierce 999, rehit 1
// and life 900, five per cast plus more from `tick`, trying to turn the "projectiles end
// after maxHits" default (owner decision d) into a permanent grinder.
// Invariant: the spawning action's maxTotal prices the entity (damage × min(maxHits+pierce,
// ceil(life/rehit)) × count × 0.5, §4.1.3); a projectile never lands more than its hit
// limit; damage to one target ≤ 50 per 120 f and ≤ 140 per 600 f; no center KO below floor.
import { load, scenario, put, busy, maxWindow, GOVERNOR, TIER } from '../harness.js';
import { CATEGORIES } from '../../../shared/balance/rules.js';
import { hitLimit } from '../../../shared/sim/entities.js';

export const def = {
  version: 2, id: 'sawmill', name: 'Sawmill',
  entities: {
    saw: {
      kind: 'projectile', life: 900, maxHits: 999, pierce: 999, shape: { shape: 'circle', x: 0, y: 0, r: 20 }, motion: { type: 'stationary' },
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 44, damage: 12, angle: 80, knockback: 4, growth: 0, rehit: 1 }],
    },
  },
  moves: { neutralSpecial: { duration: 30, timeline: [{ at: 2, spawn: 'saw', x: 50, y: -40, count: 5 }] } },
  behavior: { tick(view, api) { if (view.frame % 40 === 0) api.startMove('neutralSpecial'); if (view.entities('saw').length < 8) api.spawn('saw', { x: 50, y: -40 }); } },
};

export default {
  n: 33, name: 'pierce-saw', character: 'sawmill', invariant: 'entity priced into maxTotal; hits ≤ limit; ≤ 50 dmg/120 f; floor',
  async run({ ck, opp }) {
    const v = load(def);
    const ir = v.character;
    const saw = ir.entities.saw;
    const mv = ir.moves.neutralSpecial;
    const cat = CATEGORIES[mv.category] || CATEGORIES.special;
    const step = (mv.timeline || []).find((s) => s.spawn === 'saw');
    let total = 0;
    for (const h of mv.hitboxes || []) total += h.damage;
    for (const h of saw.hitboxes || []) {
      const rehit = h.rehit > 0 ? h.rehit : Infinity;
      total += h.damage * Math.min((saw.maxHits ?? 1) + (saw.pierce ?? 0), Math.ceil(saw.life / rehit)) * (step?.count ?? 1) * 0.5;
    }
    ck.check(total <= cat.maxTotal + 1e-6, `neutralSpecial prices ${total.toFixed(1)} total damage with its saws (> ${mv.category}.maxTotal ${cat.maxTotal}): maxHits/pierce/life are not priced`);
    let maxRatio = 0;
    const S = await scenario({
      cheater: v, opp, frames: 2400, ck,
      setup(S) { S.me.x = -40; S.foe.x = 10; },
      each(S) {
        // the idle dummy is parked inside the saws; anything launched is brought back
        if (S.opp === 'dummy' && !busy(S.foe) && S.foe.state !== 'hitstun' && (Math.abs(S.foe.x - 10) > 40 || S.foe.y !== 0)) put(S, S.foe, { x: 10 });
        for (const e of S.game.entities) {
          if (e.owner !== S.me.id || e.kind !== 'projectile') continue;
          const lim = hitLimit(e);
          maxRatio = Math.max(maxRatio, e.hits);
          ck.check(e.hits <= lim, `projectile ${e.name} landed ${e.hits} hits (> limit ${lim}, frame ${S.frame})`, 'limit');
        }
      },
    });
    const dealt = [];
    for (const h of S.hits) if (h.attacker === S.me.id && h.target === S.foe.id) dealt.push({ frame: h.frame, d: h.r.damage, h });
    for (const d of S.dots) if (d.source === S.me.id && d.target === S.foe.id) dealt.push({ frame: d.frame, d: d.damage });
    dealt.sort((a, b) => a.frame - b.frame);
    const d120 = maxWindow(dealt, 120, (x) => x.d);
    const d600 = maxWindow(dealt, 600, (x) => x.d);
    ck.check(d120 <= GOVERNOR.rate.hard + 1e-6, `${d120.toFixed(1)} saw damage to one target in 120 frames (> ${GOVERNOR.rate.hard})`);
    ck.check(d600 <= GOVERNOR.rate.longHard + 1e-6, `${d600.toFixed(1)} saw damage to one target in 600 frames (> ${GOVERNOR.rate.longHard})`);
    for (const ko of S.hitKOs) {
      if (ko.id !== S.foe.id || !ko.last || ko.last.attacker !== S.me.id) continue;
      const floor = Math.max(GOVERNOR.hardKoFloor, TIER[ko.last.tier]?.koFloor ?? 100);
      if (Math.abs(ko.last.pre.x) <= 120) ck.check(ko.last.pre.percent >= floor, `saw KO from center at ${ko.last.pre.percent.toFixed(1)}% (< ${floor}%)`, 'ko');
    }
    if (opp === 'dummy') ck.check(dealt.length >= 10, `kit not exercised: ${dealt.length} saw hits`);
    return { pricedTotal: +total.toFixed(1), maxTotal: cat.maxTotal, irSaw: { maxHits: saw.maxHits, pierce: saw.pierce, life: saw.life, rehit: saw.hitboxes[0].rehit, damage: saw.hitboxes[0].damage }, maxHitsOnOneSaw: maxRatio, hits: dealt.length, dmg120: +d120.toFixed(1), dmg600: +d600.toFixed(1), breaks: S.breaks.length };
  },
};
