// #30 (new) SlotFns returning varying / junk / cross-category moves: every trigger routes
// through a function that returns a move name chosen by view.rng() (allowed) and view.frame,
// sometimes a non-existent name, sometimes junk, trying to fire the strongest move from a
// weak input (e.g. jab → a smash) or to crash resolution. Invariant: a slot only ever
// resolves to a real pool move; junk/unknown returns fall back safely; every landed hit
// still respects its own category cap; the match stays deterministic.
import { load, scenario, brawler, stateHash } from '../harness.js';
import { CATEGORIES } from '../../../shared/balance/rules.js';
import { GOVERNOR } from '../../../shared/balance/governor-rules.js';

const POOL = ['lightJab', 'bigSmash', 'spike', 'recover'];
const pick = (view) => {
  const r = view.rng();
  if (r < 0.2) return 12345;                 // junk: not a string
  if (r < 0.4) return 'doesNotExist';        // unknown pool name
  if (r < 0.5) return null;
  return POOL[Math.floor(view.frame) % POOL.length]; // a real (possibly much stronger) move
};

export const def = {
  version: 2, id: 'roulette', name: 'Roulette',
  moves: {
    lightJab: { category: 'jab', duration: 14, hitboxes: [{ start: 2, end: 4, x: 30, y: -46, r: 22, damage: 4, angle: 40, knockback: 10, growth: 10 }] },
    bigSmash: { category: 'smash', duration: 44, hitboxes: [{ start: 12, end: 15, x: 46, y: -46, r: 40, damage: 18, angle: 40, knockback: 40, growth: 90 }] },
    spike: { category: 'aerial', duration: 30, hitboxes: [{ start: 4, end: 10, x: 0, y: 10, r: 30, damage: 12, angle: 275, knockback: 70, growth: 110 }] },
    recover: { category: 'recovery', duration: 30, hitboxes: [{ start: 3, end: 8, x: 20, y: -60, r: 30, damage: 8, angle: 90, knockback: 40, growth: 60 }] },
  },
  slots: Object.fromEntries(['jab', 'side', 'up', 'down', 'nair', 'fair', 'bair', 'uair', 'neutralSpecial', 'sideSpecial', 'upSpecial', 'downSpecial', 'sideSmash', 'upSmash', 'downSmash'].map((t) => [t, pick])),
};

export default {
  n: 30, name: 'slot-random', character: 'roulette', invariant: 'slot → real pool move only; junk falls back; category caps; deterministic',
  async run({ ck, opp }) {
    const v = load(def);
    const names = new Set(Object.keys(v.character.moves));
    const run = () => scenario({
      cheater: v, opp, frames: 1500, ck,
      input: brawler(['attack', 'attack+fwd', 'attack+up', 'attack+down', 'special', 'strong+fwd'], { gap: 6 }),
      each(S) {
        const a = S.me.action;
        if (a) ck.check(names.has(a.name) || a.name === undefined, `active move "${a.name}" is not a real pool move (frame ${S.frame})`, 'name');
      },
    });
    const S = await run();
    for (const h of S.hits) {
      if (h.attacker !== S.me.id) continue;
      const cap = Math.min(1.4 * (CATEGORIES[h.tier]?.maxHit ?? 25), GOVERNOR.absMaxHit);
      ck.check(h.r.damage <= cap + 1e-6, `hit (${h.tier}) dealt ${h.r.damage} > cap ${cap} (frame ${h.frame})`, `cap:${h.tier}`);
    }
    // Determinism: a randomized SlotFn driven by view.rng() still replays bit-for-bit.
    const h1 = stateHash(S.game);
    const S2 = await run();
    ck.check(stateHash(S2.game) === h1, 'a view.rng()-driven SlotFn broke determinism between two same-seed runs');
    const landed = S.hits.filter((h) => h.attacker === S.me.id).length;
    if (opp === 'dummy') ck.check(landed > 0, 'no slot-driven move landed (kit not exercised)');
    return { landed, slotWarnings: S.gov.slot || 0, deterministic: stateHash(S2.game) === h1 };
  },
};
