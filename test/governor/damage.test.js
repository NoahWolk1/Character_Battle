// §4.2.1/4.2.3/4.2.4/4.2.6: per-hit cap, rate limit, proration, BREAK, mitigation, heal, relay.
import { check, done, fakeFighter, fakeGame, tick } from './helpers.js';

const jab1 = { damage: 1, angle: 45, knockback: 5, growth: 10 };

// Rate: 60 hits of 1 damage within 120 frames → ≤ 50 total (soft cap makes it 45).
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t]);
  let total = 0;
  for (let i = 0; i < 60; i++) {
    const r = game.gov.applyHit({ attacker: a, target: t, hb: jab1, tier: 'jab', dir: 1 });
    total += r.damage;
    tick(game, 2);
    t.gov.chain.active = false; // isolate the rate limit from proration/BREAK
  }
  check(total <= 50 + 1e-9, `60×1 dmg in 120 f dealt ${total.toFixed(2)} (> 50)`);
  check(Math.abs(total - 45) < 0.6, `soft cap should land near 45 (got ${total.toFixed(2)})`);
  console.log(`  60 × 1 dmg in 120 f → ${total.toFixed(1)} dealt`);
}

// Hard caps: a flood of 10-dmg hits never exceeds 50/120 f or 140/600 f.
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t]);
  const log = [];
  for (let f = 0; f < 1200; f++) {
    if (f % 3 === 0) {
      const r = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 10, angle: 45, knockback: 5, growth: 10 }, tier: 'special', dir: 1 });
      log.push([game.frame, r.damage]);
      t.gov.chain.active = false;
    }
    tick(game);
  }
  let max120 = 0, max600 = 0;
  for (const [f0] of log) {
    let s1 = 0, s6 = 0;
    for (const [f, d] of log) { if (f >= f0 && f < f0 + 120) s1 += d; if (f >= f0 && f < f0 + 600) s6 += d; }
    max120 = Math.max(max120, s1); max600 = Math.max(max600, s6);
  }
  check(max120 <= 50 + 1e-6, `120-frame damage ${max120.toFixed(2)} > 50`);
  check(max600 <= 140 + 1e-6, `600-frame damage ${max600.toFixed(2)} > 140`);
  check(game.events.some((e) => e.type === 'gov' && e.rule === 'rate'), 'rate trims emit gov events');
  console.log(`  flood: max 120 f = ${max120.toFixed(1)}, max 600 f = ${max600.toFixed(1)}`);
}

// Per-hit cap: 9999 damage → 1.4 × tier maxHit, ≤ 25 absolute.
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t]);
  const r = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 9999, angle: 45, knockback: 999, growth: 999 }, tier: 'smash', dir: 1 });
  check(r.damage <= 25, `9999 hit dealt ${r.damage}`);
  check(r.speed <= 40, `launch speed ${r.speed} > 40`);
  const j = fakeGame([fakeFighter(0), fakeFighter(1)]);
  const r2 = j.gov.applyHit({ attacker: j.fighters[0], target: j.fighters[1], hb: { damage: 9999, angle: 45, knockback: 0, growth: 0 }, tier: 'jab', dir: 1 });
  check(r2.damage === 7, `jab per-hit cap 1.4×5 = 7 (got ${r2.damage})`);
  // Non-finite input never produces NaN.
  const r3 = j.gov.applyHit({ attacker: j.fighters[0], target: j.fighters[1], hb: { damage: NaN, angle: Infinity, knockback: NaN, growth: undefined }, tier: 'nope', dir: 1 });
  check([r3.damage, r3.speed, r3.kx, r3.ky, r3.hitstun, j.fighters[1].percent].every(Number.isFinite), 'no NaN from garbage hitbox');
}

// Proration and BREAK: a 0-to-death multi-hit chain BREAKs by 14 effective hits or 55%.
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t]);
  let hits = 0, broke = null, dealt = 0;
  const seen = [];
  while (hits < 40 && !broke) {
    const r = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 4, angle: 80, knockback: 40, growth: 20 }, tier: 'tilt', dir: 1 });
    hits++; dealt += r.damage; seen.push(r.damage);
    t.state = 'hitstun'; t.hitlag = 0;
    if (r.broke) broke = { hits, dealt, hitstun: r.hitstun };
    tick(game, 3);
  }
  check(broke && broke.hits <= 14, `BREAK by 14 hits or 55% (got ${JSON.stringify(broke)})`);
  check(broke && broke.hitstun === 0, 'BREAK hit has hitstun 0');
  check(seen[1] < seen[0] && seen[5] < seen[1], `proration reduces later hits (${seen.slice(0, 6).join(', ')})`);
  check(game.events.some((e) => e.type === 'break'), 'break event emitted');
  check(game.gov.breakIntangible(t), 'BREAK grants engine intangibility');
  check(game.gov.immuneTo(t, 'grab') && game.gov.immuneTo(t, 'stun'), 'BREAK grants grab/stun immunity');
  tick(game, 30);
  check(!game.gov.breakIntangible(t), 'BREAK intangibility lasts 30 frames');
  console.log(`  BREAK after ${broke.hits} hits / ${broke.dealt.toFixed(1)}%`);
}

// Chain resets after 12 actionable frames.
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t]);
  game.gov.applyHit({ attacker: a, target: t, hb: jab1, tier: 'jab', dir: 1 });
  t.state = 'idle';
  tick(game, 12);
  check(!t.gov.chain.active, 'chain resets after 12 actionable frames');
}

// Mitigation: infinite soak (fraction 1 → 0.5, max 1000) prevents ≤ 50% per hit, ≤ 20/300 f, ≤ 45 per stock.
{
  const a = fakeFighter(0), t = fakeFighter(1, { res: new Float64Array([1000]), soakers: [{ idx: 0, fraction: 1, costPerDamage: 0.5 }] });
  const game = fakeGame([a, t]);
  let prevented = 0, maxFrac = 0;
  const log = [];
  for (let i = 0; i < 200; i++) {
    const before = t.percent;
    const r = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 8, angle: 45, knockback: 5, growth: 5 }, tier: 'special', dir: 1 });
    const raw = r.damage + r.prevented;
    if (raw > 0) maxFrac = Math.max(maxFrac, r.prevented / raw);
    prevented += r.prevented; log.push([game.frame, r.prevented]);
    check(t.percent >= before, 'percent never decreases on hit');
    t.gov.chain.active = false;
    tick(game, 20);
  }
  let maxWin = 0;
  for (const [f0] of log) { let s = 0; for (const [f, p] of log) if (f >= f0 && f < f0 + 300) s += p; maxWin = Math.max(maxWin, s); }
  check(prevented <= 45 + 1e-6, `soak prevented ${prevented.toFixed(2)} per stock (> 45)`);
  check(maxFrac <= 0.5 + 1e-9, `soak prevented ${(maxFrac * 100).toFixed(1)}% of a hit (> 50%)`);
  check(maxWin <= 20 + 1e-6, `soak prevented ${maxWin.toFixed(2)} in 300 f (> 20)`);
  game.gov.onKO(t);
  const r = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 8, angle: 45, knockback: 5, growth: 5 }, tier: 'special', dir: 1 });
  check(r.prevented > 0, 'mitigation budget refreshes on a new stock');
  console.log(`  soak: ${prevented.toFixed(1)} prevented/stock, max ${(maxFrac * 100).toFixed(0)}%/hit, max ${maxWin.toFixed(1)}/300 f`);
}

// damageIn < 1 savings count as mitigation; damageIn clamps to [0.85, 1.15].
{
  const a = fakeFighter(0), t = fakeFighter(1, { mods: { damageIn: 0.01 } });
  const game = fakeGame([a, t]);
  const r = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 10, angle: 45, knockback: 5, growth: 5 }, tier: 'special', dir: 1 });
  check(Math.abs(r.prevented - 1.5) < 1e-9 && Math.abs(r.damage - 8.5) < 1e-9, `damageIn 0.01 → clamped 0.85 (dealt ${r.damage}, prevented ${r.prevented})`);
}

// Infinite heal: api.heal(99) every tick → ≤ 1 per 30 f, ≤ 45 per stock, never below 0, none in hitstun.
{
  const t = fakeFighter(0, { percent: 500 });
  const game = fakeGame([t, fakeFighter(1)]);
  let healed = 0;
  const log = [];
  for (let f = 0; f < 6000; f++) { const h = game.gov.heal(t, 99); healed += h; if (h) log.push([game.frame, h]); tick(game); }
  let max30 = 0;
  for (const [f0] of log) { let s = 0; for (const [f, h] of log) if (f >= f0 && f < f0 + 30) s += h; max30 = Math.max(max30, s); }
  check(healed <= 45 + 1e-6, `healed ${healed.toFixed(2)} per stock (> 45)`);
  check(max30 <= 1 + 1e-6, `healed ${max30.toFixed(2)} in 30 f (> 1)`);
  const low = fakeFighter(2, { percent: 0.4 });
  const g2 = fakeGame([low]);
  g2.gov.heal(low, 99);
  check(low.percent >= 0, 'percent never below 0');
  const stunned = fakeFighter(3, { percent: 50, state: 'hitstun' });
  const g3 = fakeGame([stunned]);
  check(g3.gov.heal(stunned, 5) === 0, 'no heal during hitstun');
  console.log(`  heal spam: ${healed.toFixed(1)} healed over 6000 f, max ${max30.toFixed(2)}/30 f`);
}

// Relay 0.5 part: damage × 0.5 with no knockback; with the budget exhausted it relays 1.0 (full hit).
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t]);
  const hb = { damage: 10, angle: 45, knockback: 60, growth: 80 };
  const r = game.gov.applyHit({ attacker: a, target: t, hb, tier: 'special', dir: 1, relay: 0.5 });
  check(r.relayed && Math.abs(r.damage - 5) < 1e-9 && r.speed === 0 && r.hitstun === 0, `relay 0.5 → 5 dmg, no kb (got ${r.damage}, speed ${r.speed})`);
  t.gov.mit.stock = 45;
  const r2 = game.gov.applyHit({ attacker: a, target: t, hb, tier: 'special', dir: 1, relay: 0.5 });
  check(!r2.relayed && r2.speed > 0 && r2.prevented === 0, 'relay with exhausted budget → full hit');
}

// Shield rate: soft 35 (×0.25), hard 45 per 120 f.
{
  const a = fakeFighter(0), t = fakeFighter(1, { state: 'shield' });
  const game = fakeGame([a, t]);
  let total = 0;
  for (let i = 0; i < 40; i++) { total += game.gov.shieldDamage({ attacker: a, target: t, hb: { damage: 5 }, tier: 'special' }).damage; tick(game, 2); }
  check(total <= 45 + 1e-6, `shield damage ${total} in 80 f (> 45)`);
}

// DoT ticks count toward the rate limit and never touch the combo counter.
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t]);
  const r = game.gov.applyDot(a, t, 5);
  check(r.damage <= 0.5 + 1e-9, `DoT tick capped at 0.5 (got ${r.damage})`);
  check(!t.gov.chain.active, 'DoT does not start a combo chain');
}

// Disabled governor: pass-through, v1 rounding.
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t], { governor: false });
  const r = game.gov.applyHit({ attacker: a, target: t, hb: { damage: 9999, angle: 45, knockback: 10, growth: 10 }, tier: 'smash', dir: 1, stale: 1 });
  check(r.damage === 9999 && t.percent === 999, 'governor:false bypasses every cap');
}

done('damage');
