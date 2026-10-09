// #1 9999 in every stat and damage; 999 knockback and growth.
// Invariant: stat and move budgets hold (static). No hit > 25 damage (runtime).
import { load, scenario, brawler } from '../harness.js';
import { STAT_BUDGET, MOVE_BUDGET, CATEGORIES } from '../../../shared/balance/rules.js';

const SLOTS = ['jab', 'side', 'up', 'down', 'sideSmash', 'upSmash', 'downSmash', 'nair', 'fair', 'bair', 'uair', 'dair', 'neutralSpecial', 'sideSpecial', 'upSpecial', 'downSpecial'];
const hb = { shape: 'circle', x: 40, y: -45, r: 9999, start: 1, end: 9999, damage: 9999, angle: 45, knockback: 999, growth: 999 };
const stats = {};
for (const k of ['weight', 'runSpeed', 'airSpeed', 'jumpHeight', 'doubleJumpHeight', 'airJumps', 'gravity', 'fallSpeed']) stats[k] = 9999;
const moves = {};
for (const s of SLOTS) moves[s] = { duration: 1, hitboxes: [{ ...hb }, { ...hb, x: -40, group: 1 }] };

export const def = {
  version: 2, id: 'maxer', name: 'Maxer', stats, moves,
  hitboxes: { nuke: { damage: 9999, angle: 45, knockback: 999, growth: 999 } },
  behavior: { tick(view, api) { if (view.frame % 7 === 0) api.hit('nuke', { shape: 'circle', x: 30, y: -40, r: 9999 }, { frames: 99 }); } },
};

export default {
  n: 1, name: 'maxed-everything', character: 'maxer', invariant: 'stat/move budgets hold; no hit > 25',
  async run({ ck, opp }) {
    const v = load(def);
    const rp = v.report;
    ck.check(rp.statPoints.total <= STAT_BUDGET + 1e-6, `stat points ${rp.statPoints.total} > budget ${STAT_BUDGET}`);
    ck.check(rp.movePower <= MOVE_BUDGET + 1e-6, `move power ${rp.movePower} > budget ${MOVE_BUDGET}`);
    for (const [name, m] of Object.entries(v.character.moves)) {
      const cat = CATEGORIES[m.category] || CATEGORIES.special;
      for (const h of m.hitboxes) {
        ck.check(h.damage <= cat.maxHit + 1e-6, `${name}: damage ${h.damage} > ${m.category}.maxHit ${cat.maxHit}`);
        if (h.r !== undefined) ck.check(h.r <= cat.maxRadius + 1e-6, `${name}: radius ${h.r} > ${cat.maxRadius}`);
      }
    }
    for (const t of Object.values(v.character.hitboxes)) ck.check(t.damage <= 25, `template damage ${t.damage}`);
    const S = await scenario({
      cheater: v, opp, frames: 2400, ck,
      input: brawler(['attack', 'attack+fwd', 'strong+fwd', 'attack+up', 'special', 'special+fwd', 'strong+up', 'attack+down', 'strong+down', 'special+down'], { gap: 6 }),
    });
    const mine = S.hits.filter((h) => h.attacker === 'p1');
    for (const h of mine) {
      ck.check(h.r.damage <= 25 + 1e-9, `hit dealt ${h.r.damage} > 25 (frame ${h.frame})`, 'gt25');
      const cap = Math.min(1.4 * (h.tier ? (CATEGORIES[h.tier]?.maxHit ?? 25) : 25), 25);
      ck.check(h.r.damage <= cap + 1e-6, `hit dealt ${h.r.damage} > per-hit cap ${cap} (${h.tier})`, `cap:${h.tier}`);
    }
    for (const e of S.events) if (e.type === 'hit' && e.attacker === 'p1') ck.check(e.damage <= 25, `hit event damage ${e.damage}`, 'ev25');
    if (opp === 'dummy') ck.check(mine.length >= 10, `only ${mine.length} hits landed (the kit did not exercise the pipeline)`);
    return { hits: mine.length, maxHit: Math.max(0, ...mine.map((h) => h.r.damage)), kos: S.kos.length, statPoints: rp.statPoints.total, movePower: rp.movePower };
  },
};
