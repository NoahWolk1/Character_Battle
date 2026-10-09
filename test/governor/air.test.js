// §4.2.5 air and movement budgets: speed caps, rise, stall, teleports, long-air backstop, resets.
import { check, done, fakeFighter, fakeGame, tick } from './helpers.js';
import { GOVERNOR } from '../../shared/balance/governor-rules.js';

/** Minimal airborne integration: script sets velocity, gravity unless set, Governor airTick, move. */
function fly(game, f, frames, want) {
  let minY = f.y;
  for (let i = 0; i < frames; i++) {
    const w = want(i);
    if (w) { const v = game.gov.selfVelocity(f, w.vx, w.vy, w.src); f.vx = v.vx; f.vy = v.vy; } else f.vy = Math.min(f.stats.fallSpeed, f.vy + f.stats.gravity);
    game.gov.airTick(f);
    f.x += f.vx; f.y += f.vy;
    minY = Math.min(minY, f.y);
    tick(game);
  }
  return minY;
}

// Flight stall: velocity(0, −50) every tick → vy ≥ −17, rise ≤ 380 px per airtime.
{
  const f = fakeFighter(0, { grounded: false, state: 'air', y: -10, air: {} });
  const game = fakeGame([f, fakeFighter(1)]);
  let maxUp = 0;
  const minY = fly(game, f, 400, () => ({ vx: 99, vy: -50 }));
  // re-run a check on the clamp itself
  const v = game.gov.selfVelocity(fakeFighter(2, { grounded: false, state: 'air' }), 99, -50);
  maxUp = -v.vy;
  check(v.vx === 18 && maxUp <= 17, `self velocity clamps to |vx| ≤ 18, vy ≥ −17 (got ${v.vx}, ${v.vy})`);
  const rise = -10 - minY;
  check(rise <= 380 + 1e-6, `rose ${rise.toFixed(1)} px (> 380)`);
  check(rise >= 370, `rise budget should be usable (${rise.toFixed(1)})`);
  check(f.air.rise <= 380 + 1e-6, 'f.air.rise mirrors the budget');
  check(game.events.some((e) => e.type === 'gov' && e.rule === 'rise'), 'rise exhaustion emits gov');
  console.log(`  velocity(0,−50) spam: rose ${rise.toFixed(1)} px`);
}

// Engine jumps are free; a tumble hit refunds half of the spent rise and stall.
check(GOVERNOR.air.hitRefund === 0.5, 'GOVERNOR.air.hitRefund is 0.5 (owner decision c)');
{
  const f = fakeFighter(0, { grounded: false, state: 'air', y: -10 });
  const game = fakeGame([f, fakeFighter(1)]);
  fly(game, f, 30, () => ({ vx: 0, vy: -15, src: 'jump' }));
  check(f.gov.air.rise === 0, 'jumps are not charged to rise');
  fly(game, f, 40, () => ({ vx: 0, vy: -12 }));
  const spent = f.gov.air.rise;
  const a = fakeFighter(1);
  f.y = -10; // the KO floor is height-aware: hit at stage level so the launch is a plain tumble
  game.gov.applyHit({ attacker: a, target: f, hb: { damage: 10, angle: 45, knockback: 60, growth: 80 }, tier: 'special', dir: 1 });
  check(Math.abs(f.gov.air.rise - spent / 2) < 1e-9, `tumble hit refunds half the rise (${spent} → ${f.gov.air.rise})`);
}

// Stall: hover/float with −1 ≤ vy ≤ 2.5 → ≤ 240 frames; afterwards stallExhausted (normal gravity).
{
  const f = fakeFighter(0, { grounded: false, state: 'air', y: -400 });
  const game = fakeGame([f, fakeFighter(1)]);
  let firstOut = -1;
  for (let i = 0; i < 400; i++) {
    const info = game.gov.airTick(f);
    if (info.stallExhausted && firstOut < 0) firstOut = i;
    f.vy = info.stallExhausted ? Math.min(11, f.vy + 0.65) : 0.4; // movement obeys the flag
    f.y += f.vy;
    tick(game);
  }
  check(firstOut > 0 && firstOut <= 240, `stall exhausted at frame ${firstOut} (≤ 240)`);
  check(f.gov.air.stall <= 240, `stall counted ${f.gov.air.stall}`);
  game.gov.airReset(f);
  check(!game.gov.stallExhausted(f) && f.gov.air.stall === 0, 'landing resets stall');
}

// Long-air backstop: 600 frames airborne without landing or being hit → helpless.
{
  const f = fakeFighter(0, { grounded: false, state: 'air', y: -400 });
  const game = fakeGame([f, fakeFighter(1)]);
  let at = -1;
  for (let i = 0; i < 700 && at < 0; i++) { f.vy = -5; if (game.gov.airTick(f).helpless) at = i + 1; tick(game); }
  check(at === 600, `helpless after 600 airborne frames (got ${at})`);
}

// Teleport spam: teleport(0, −500) every tick → ≤ 1 per airtime, ≤ 200 px.
{
  const f = fakeFighter(0, { grounded: false, state: 'air', y: -100 });
  const game = fakeGame([f, fakeFighter(1)]);
  let ok = 0, dist = 0;
  for (let i = 0; i < 300; i++) {
    const r = game.gov.teleportRequest(f, 0, -500);
    if (r.ok) { ok++; dist = Math.max(dist, Math.hypot(r.dx, r.dy)); }
    tick(game);
  }
  check(ok === 1, `${ok} teleports in one airtime (> 1)`);
  check(dist <= 200 + 1e-9, `teleport distance ${dist} (> 200)`);
  game.gov.airReset(f);
  check(game.gov.teleportRequest(f, 50, 0).ok, 'landing restores the teleport');
  const g = fakeFighter(1, { grounded: true });
  check(game.gov.teleportRequest(g, 150, 0).ok, 'a grounded flat teleport is free (no airtime charge)');
  check(!game.gov.teleportRequest(g, -150, 0).ok, 'grounded flat teleports are rate-limited (cheater #31 ground-blink)');
  game.frame += 20;
  check(game.gov.teleportRequest(g, -150, 0).ok, 'another grounded teleport after the cooldown');
  g.state = 'hitstun';
  check(!game.gov.teleportRequest(g, 0, -100).ok, 'no teleporting out of hitstun');
  g.state = 'idle';
}

// Budget view.
{
  const f = fakeFighter(0);
  const game = fakeGame([f, fakeFighter(1)]);
  const b = game.gov.budget(f);
  check(b.riseLeft === 380 && b.stallLeft === 240 && b.intangibleLeft === 45 && b.armorLeft === 60 && b.mitigationLeft === 20 && b.entities === 8 && b.threat === 10 && b.statusSlotsLeft === 4,
    `fresh budget ${JSON.stringify(b)}`);
}

done('air');
