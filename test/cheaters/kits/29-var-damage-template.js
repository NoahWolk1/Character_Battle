// #29 (new) Var-driven damage templates: the kit keeps a "power" var it pumps every frame
// and references named hit templates whose declared damage is 999, hoping a var or a per-
// frame recompute leaks past the static cap. It also fires api.hit with huge shapes and a
// timeline `hit` that supplies inline damage. Invariant: template damage is fixed at load
// (≤ the tier's maxHit), api.hit geometry is clamped to the tier reach, and no governed hit
// exceeds the per-hit cap no matter what the vars say.
import { load, scenario, put, busy } from '../harness.js';
import { CATEGORIES } from '../../../shared/balance/rules.js';
import { GOVERNOR } from '../../../shared/balance/governor-rules.js';

export const def = {
  version: 2, id: 'templater', name: 'Templater',
  vars: { power: 0 },
  hitboxes: {
    nuke: { damage: 999, angle: 45, knockback: 999, growth: 999, tier: 'smash' },
    poke: { damage: 999, angle: 20, knockback: 10, growth: 10 },
  },
  moves: {
    neutralSpecial: {
      duration: 40, category: 'special',
      timeline: [{ at: 4, hit: 'nuke', shape: 'circle', x: 30, y: -40, r: 300, frames: 10 }, { from: 0, to: 39, every: 1, resource: undefined }],
      hitboxes: [{ start: 5, end: 9, x: 40, y: -45, r: 46, use: 'nuke', damage: 999 }],
    },
  },
  behavior: {
    tick(view, api) {
      api.vars.set('power', (view.vars.power || 0) + 100);
      api.hit('nuke', { shape: 'circle', x: 30, y: -40, r: 900 }, { frames: 20 });
      api.hit('poke', { shape: 'rect', x: 0, y: -40, w: 999, h: 999 }, { frames: 20 });
      const e = view.nearestEnemy();
      if (e && Math.abs(e.x - view.me.x) < 140) api.startMove('neutralSpecial');
    },
  },
};

export default {
  n: 29, name: 'var-damage-template', character: 'templater', invariant: 'template damage fixed ≤ tier maxHit; per-hit cap holds',
  async run({ ck, opp }) {
    const v = load(def);
    // Templates are clamped at load. (Named templates keep their declared damage but the
    // runtime caps it; move hitboxes using a template are clamped into the category.)
    for (const m of Object.values(v.character.moves)) for (const h of m.hitboxes || []) {
      const cat = CATEGORIES[m.category] || CATEGORIES.special;
      ck.check(h.damage <= cat.maxHit + 1e-6, `${m.category} hitbox damage ${h.damage} > ${cat.maxHit} after load`, 'ir');
    }
    const S = await scenario({
      cheater: v, opp, frames: 2000, ck,
      setup(S) { S.me.x = -40; S.foe.x = 40; },
      each(S) { if (!busy(S.foe) && S.foe.state !== 'hitstun' && (Math.abs(S.foe.x - S.me.x) > 70 || S.foe.y !== 0)) put(S, S.foe, { x: S.me.x + 55 }); },
    });
    const mine = S.hits.filter((h) => h.attacker === S.me.id);
    for (const h of mine) {
      ck.check(h.r.damage <= GOVERNOR.absMaxHit + 1e-6, `hit dealt ${h.r.damage} (> 25, frame ${h.frame})`, 'cap25');
      const tcap = Math.min(1.4 * (CATEGORIES[h.tier]?.maxHit ?? 25), 25);
      ck.check(h.r.damage <= tcap + 1e-6, `hit dealt ${h.r.damage} > per-hit cap ${tcap} (${h.tier})`, `cap:${h.tier}`);
    }
    ck.check(S.me.vars.power <= 1e6, `power var ${S.me.vars.power} exceeded the ±1e6 clamp`);
    if (opp === 'dummy') ck.check(mine.length > 5, `kit not exercised: ${mine.length} hits`);
    return { hits: mine.length, maxDamage: Math.max(0, ...mine.map((h) => +h.r.damage.toFixed(1))), powerVar: S.me.vars.power };
  },
};
