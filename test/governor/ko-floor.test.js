// §4.2.2 hit-time KO floor: spikes, charged smashes, ledge snipes, offstage spike cap.
import { check, done, fakeFighter, fakeGame, flies, DI_INPUTS, STAGE } from './helpers.js';
import { TIER } from '../../shared/balance/governor-rules.js';

const LEDGE = STAGE.ground.x2 - 6;

/** One isolated hit (fresh governor state) → {res, ko}. */
function hit({ p, hb, tier, weight = 100, x = 0, y = 0, grounded = true, input = {}, dir = 1, chargeFrames = 0 }) {
  const a = fakeFighter(0, { x: x - 40 * dir, facing: dir });
  const t = fakeFighter(1, { x, y, grounded, state: grounded ? 'idle' : 'air', percent: p, input, stats: { weight, gravity: 0.65, fallSpeed: 11, height: 92 } });
  const game = fakeGame([a, t]);
  const res = game.gov.applyHit({ attacker: a, target: t, hb, tier, dir, chargeFrames });
  return { res, ko: flies(t, res), t, stats: game.gov.stats };
}

// 1. Spike dair 275/90/130/14 can't KO a grounded w100 target below 110% (pre-hit), anywhere on stage, any DI.
{
  const hb = { damage: 14, angle: 275, knockback: 90, growth: 130 };
  let kos = 0, worst = null;
  for (let p = 0; p < 110; p += 1) {
    for (const x of [0, -300, 300, -LEDGE, LEDGE]) {
      for (const dir of [1, -1]) {
        for (const input of DI_INPUTS) {
          const r = hit({ p, hb, tier: 'aerial', x, dir, input });
          if (r.ko) { kos++; worst = worst ?? { p, x, dir, input }; }
        }
      }
    }
  }
  check(kos === 0, `spike dair KOs a grounded target below 110% (${kos} cases, first ${JSON.stringify(worst)})`);
  // Sanity: the same move is lethal once the floor is passed.
  let lethalAt = Infinity;
  for (let p = 110; p <= 400 && lethalAt === Infinity; p += 5) if (hit({ p, hb, tier: 'aerial' }).ko) lethalAt = p;
  check(lethalAt < 400, `spike dair should still KO a grounded target at high % (got ${lethalAt})`);
  console.log(`  spike dair (grounded, center) first KO at ${lethalAt}%`);
}

// 2. A fully charged max smash can't KO from center below 85% (w70 and w100, grounded and airborne, any DI).
{
  let kos = 0, first = null;
  for (const angle of [0, 15, 30, 45, 60, 75, 90, 105, 135, 165]) {
    const hb = { damage: 18, angle, knockback: 90, growth: 130 };
    for (let p = 0; p < 85; p += 1) {
      for (const weight of [70, 100]) {
        for (const grounded of [true, false]) {
          for (const input of DI_INPUTS) {
            const r = hit({ p, hb, tier: 'smash', weight, grounded, y: grounded ? 0 : -1, input, chargeFrames: 60 });
            if (r.ko) { kos++; first = first ?? { angle, p, weight, grounded, input }; }
          }
        }
      }
    }
  }
  check(kos === 0, `charged smash KOs from center below 85% (${kos} cases, first ${JSON.stringify(first)})`);
  const r = hit({ p: 50, hb: { damage: 18, angle: 45, knockback: 90, growth: 130 }, tier: 'smash', chargeFrames: 60 });
  check(r.res.damage === 25 && r.res.gov.includes('perHit'), `charged 18-dmg smash trimmed to the 25 per-hit cap (got ${r.res.damage})`);
}

// 3. At 0%, a 25-damage max-knockback hit at the ledge doesn't KO (every tier, every angle, any DI).
{
  let kos = 0, first = null, n = 0;
  for (const tier of Object.keys(TIER)) {
    for (let angle = 0; angle < 360; angle += 5) {
      const hb = { damage: 25, angle, knockback: 90, growth: 130 };
      for (const [x, grounded, dir] of [[LEDGE, true, 1], [-LEDGE, true, -1], [STAGE.ground.x2 + 40, false, 1], [STAGE.ground.x1 - 40, false, -1]]) {
        for (const input of DI_INPUTS) {
          n++;
          const r = hit({ p: 0, hb, tier, x, grounded, dir, input });
          if (r.ko) { kos++; first = first ?? { tier, angle, x, grounded, input }; }
        }
      }
    }
  }
  check(kos === 0, `max-kb 25-dmg hit at the ledge KOs a 0% target (${kos}/${n} cases, first ${JSON.stringify(first)})`);
}

// 4. Ledge sniper (§10.2 #4): a max-kb jab vs a target at the ledge never KOs below 60%.
//    Also reports the earliest ledge KO per tier for a max-knockback hit at that tier's per-hit cap.
{
  let kos = 0, first = null;
  for (let p = 0; p < 60; p += 2) {
    for (let angle = 0; angle <= 180; angle += 10) {
      for (const weight of [70, 100]) {
        const r = hit({ p, hb: { damage: 9, angle, knockback: 90, growth: 130 }, tier: 'jab', x: LEDGE, weight });
        if (r.ko) { kos++; first = first ?? { p, angle, weight }; }
      }
    }
  }
  check(kos === 0, `ledge sniper jab KOs below 60% (${kos}, first ${JSON.stringify(first)})`);
  const rows = [];
  for (const tier of ['jab', 'tilt', 'smash', 'aerial', 'special', 'recovery', 'throw', 'projectile']) {
    const dmg = Math.min(25, 1.4 * TIER[tier].maxHit);
    let at = Infinity;
    for (let p = 0; p < 200 && at === Infinity; p += 2) {
      for (let angle = 0; angle <= 90 && at === Infinity; angle += 5) {
        if (hit({ p, hb: { damage: dmg, angle, knockback: 90, growth: 130 }, tier, x: LEDGE, weight: 70 }).ko) at = p;
      }
    }
    rows.push(`${tier} ${at}%`);
    check(at >= 40, `${tier}: max-kb ledge KO below 40% (${at}%)`);
  }
  console.log(`  earliest ledge KO, max kb at per-hit cap vs w70: ${rows.join(', ')}`);
}

// 5. Offstage spike below the floor: vertical speed ≤ 9 px/f and hitstun ≤ 20.
{
  for (const angle of [210, 250, 270, 290, 330]) {
    const r = hit({ p: 20, hb: { damage: 14, angle, knockback: 90, growth: 130 }, tier: 'aerial', x: STAGE.ground.x2 + 40, grounded: false });
    check(Math.abs(r.res.ky) <= 9 + 1e-9, `airborne spike ${angle}° vertical speed ${r.res.ky.toFixed(2)} > 9`);
    check(r.res.hitstun <= 20, `airborne spike ${angle}° hitstun ${r.res.hitstun} > 20`);
    check(r.res.downwardCapped && r.res.gov.includes('koFloor'), `airborne spike ${angle}° should be KO-floor capped`);
    // Owner decision (a): a spike cap is counted apart from upward KO-floor clamps.
    if (r.res.gov.includes('spike')) check(r.stats.spikeCaps === 1 && r.stats.koClamps === 0, `airborne spike ${angle}° counted as spike cap`);
  }
  const spikes = [250, 270, 290].map((angle) => hit({ p: 20, hb: { damage: 14, angle, knockback: 90, growth: 130 }, tier: 'aerial', x: 0, grounded: false }));
  check(spikes.some((r) => r.res.gov.includes('spike')), 'a mid-stage airborne spike below the floor is a spike cap');
  // A grounded upward launch above the KO speed is a real KO-floor clamp.
  const up = hit({ p: 20, hb: { damage: 20, angle: 90, knockback: 200, growth: 200 }, tier: 'aerial', x: 0 });
  check(up.res.gov.includes('koFloor') && !up.res.gov.includes('spike') && up.stats.koClamps === 1 && up.stats.spikeCaps === 0, 'upward clamp counts as koClamps');
}

// 6. Above the floor the cap does not apply (normal Smash play).
{
  const r = hit({ p: 150, hb: { damage: 14, angle: 45, knockback: 60, growth: 100 }, tier: 'smash' });
  check(!r.res.gov.includes('koFloor'), 'no KO-floor clamp above the floor');
}

done('ko-floor');
