// §4.2.7 armor and §4.2.10 intangibility budgets, §3.6.3 counter charge, §3.7 hurtbox shrink charge.
import { check, done, fakeFighter, fakeGame, tick } from './helpers.js';

const maxWindow = (frames, w) => {
  let best = 0;
  for (let i = 0, j = 0; i < frames.length; i++) {
    while (frames[i] - frames[j] >= w) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
};

// Permanent intangibility: api.intangible(999) every tick → ≤ 45 frames per rolling 300.
{
  const f = fakeFighter(0);
  const game = fakeGame([f, fakeFighter(1)]);
  const on = [];
  for (let i = 0; i < 3000; i++) {
    game.gov.intangibleRequest(f, 999);
    if (game.gov.intangibleGranted(f)) on.push(game.frame);
    tick(game);
  }
  const m = maxWindow(on, 300);
  check(m <= 45, `intangible ${m} frames in 300 (> 45)`);
  check(m >= 40, `budget should still be usable (${m})`);
  check(game.events.some((e) => e.type === 'gov' && e.rule === 'intangible'), 'denied grants emit gov intangible');
  console.log(`  intangible spam: max ${m}/300 f, ${on.length} frames over 3000`);
}

// Same budget shared with hurtbox shrink (1 px hurtbox set) and action windows.
{
  const f = fakeFighter(0, { action: { def: { intangible: [[0, 999999]] }, frame: 0 } });
  const game = fakeGame([f, fakeFighter(1)]);
  const on = [];
  for (let i = 0; i < 1500; i++) {
    const small = game.gov.chargeHurtArea(f);
    const win = game.gov.intangibleGranted(f);
    if (small || win) on.push(game.frame);
    f.action.frame++;
    tick(game);
  }
  const m = maxWindow(on, 300);
  check(m <= 45, `shrink + window intangibility ${m}/300 (> 45)`);
}

// chargeHurtArea(f, area, defaultArea): only small sets are charged.
{
  const f = fakeFighter(0, { bodyScale: 1 });
  const game = fakeGame([f, fakeFighter(1)]);
  check(game.gov.chargeHurtArea(f, 4000, 4800) && game.gov.intangibleLeft(f) === 45, 'normal-size set is free');
  check(game.gov.chargeHurtArea(f, 1500, 4800) && game.gov.intangibleLeft(f) === 44, 'set below 1600 px² is charged');
  tick(game);
  check(game.gov.chargeHurtArea(f, 2500, 4800) && game.gov.intangibleLeft(f) === 43, 'set below 0.6 × default is charged');
  let kept = 0;
  for (let i = 0; i < 100; i++) { tick(game); if (game.gov.chargeHurtArea(f, 100, 4800)) kept++; }
  check(kept === 43, `1 px hurtbox kept for ${kept} frames (budget 45)`);
}

// Each grant ≤ 20 frames; counters need the full 12.
{
  const f = fakeFighter(0);
  const game = fakeGame([f, fakeFighter(1)]);
  check(game.gov.intangibleRequest(f, 999) === 20, 'single grant capped at 20');
  tick(game, 20);
  check(game.gov.intangibleRequest(f, 20) === 20, 'second grant ok');
  tick(game, 20);
  check(game.gov.intangibleRequest(f, 12, { partial: false }) === 0, 'counter with < 12 budget left fails');
  check(game.gov.intangibleRequest(f, 12) === 5, 'partial grant uses the remaining 5');
}

// Permanent armor at threshold 99 → threshold ≤ 12, uptime ≤ 60 per 300, damage still taken in full.
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t]);
  const on = [];
  let maxThr = 0, armoredHits = 0, fullDamage = true;
  for (let i = 0; i < 3000; i++) {
    game.gov.armorRequest(t, 999, 99);
    const thr = game.gov.armorAt(t);
    maxThr = Math.max(maxThr, thr);
    if (thr > 0) on.push(game.frame);
    if (i % 10 === 0) {
      const before = t.percent;
      const r = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 8, angle: 45, knockback: 30, growth: 50 }, tier: 'special', dir: 1 });
      if (r.armored) armoredHits++;
      if (Math.abs(t.percent - before - r.damage) > 1e-9 || r.prevented > 0) fullDamage = false;
      t.gov.chain.active = false;
      t.percent = 0;
    }
    tick(game);
  }
  const m = maxWindow(on, 300);
  check(maxThr <= 12, `armor threshold ${maxThr} (> 12)`);
  check(m <= 60, `armor uptime ${m}/300 (> 60)`);
  check(armoredHits > 0 && fullDamage, `armored hits still take full damage (${armoredHits} armored)`);
  check(game.events.some((e) => e.type === 'armor'), 'armor events emitted');
  console.log(`  armor spam: threshold ${maxThr}, uptime max ${m}/300 f, ${armoredHits} armored hits`);
}

// Armor fails vs kb ≥ 200, grabs and hits above the threshold; passive armor ≤ 3.
{
  const a = fakeFighter(0), t = fakeFighter(1, { armorPassive: 50 });
  const game = fakeGame([a, t]);
  check(game.gov.armorAt(t) === 3, 'passive armor capped at 3');
  const small = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 2, angle: 45, knockback: 10, growth: 10 }, tier: 'jab', dir: 1 });
  check(small.armored, 'passive armor holds vs a 2-dmg hit');
  const big = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 5, angle: 45, knockback: 10, growth: 10 }, tier: 'jab', dir: 1 });
  check(!big.armored, 'passive armor fails vs a hit above its threshold');
  game.gov.armorRequest(t, 60, 12);
  const grab = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 2, angle: 45, knockback: 10, growth: 10 }, tier: 'throw', dir: 1, grab: true });
  check(!grab.armored, 'armor fails vs grabs');
  t.percent = 900;
  const huge = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 10, angle: 45, knockback: 90, growth: 130 }, tier: 'smash', dir: 1 });
  check(!huge.armored, 'armor fails vs kb ≥ 200');
}

done('defense');
