// legacyKo / governor:false parity: Governor.legacyHit and estimateKoPercent(hb) must reproduce
// the v1 math bit-for-bit (frozen copies of the v1 code below).
import { check, done, fakeFighter, fakeGame } from './helpers.js';
import { COMBAT, PHYSICS, REFERENCE, MATCH } from '../../shared/constants.js';
import { estimateKoPercent, launchReachesBlastZone, knockback, launchSpeed, hitstunFrames, hitlagFrames, angleToVector, normalizeAngle } from '../../shared/sim/combat.js';

// ── frozen v1 reference (shared/sim/combat.js @ 1967501) ──
function v1Launch(speed, angleDeg, gravity = 0.65, fallSpeed = 11) {
  const a = angleDeg * Math.PI / 180;
  let kx = Math.cos(a) * speed, ky = -Math.sin(a) * speed, vy = 0, x = 0, y = 0;
  for (let f = 0; f < 400; f++) {
    const mag = Math.hypot(kx, ky);
    if (mag <= PHYSICS.launchDecay) { kx = 0; ky = 0; } else { const k = (mag - PHYSICS.launchDecay) / mag; kx *= k; ky *= k; }
    vy = Math.min(vy + gravity, fallSpeed);
    x += kx; y += ky + vy;
    if (Math.abs(x) >= REFERENCE.blastDistanceX || -y >= REFERENCE.blastDistanceY) return true;
    if (kx === 0 && ky === 0) return false;
  }
  return false;
}
function v1Estimate({ damage, angle, knockback: base, growth }) {
  const kos = (p) => v1Launch(launchSpeed(knockback(p + damage, damage, REFERENCE.weight, base, growth)), normalizeAngle(angle));
  if (!kos(999)) return Infinity;
  let lo = 0, hi = 999;
  if (kos(0)) return 0;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (kos(mid)) hi = mid; else lo = mid; }
  return hi;
}
// v1 Game.applyHit (non-shield branch) numeric core.
function v1Hit(t, { hb, dir, stale, charge }) {
  const chargeMul = 1 + (charge / COMBAT.smashChargeMax) * COMBAT.smashChargeBonus;
  const damage = Math.round(hb.damage * stale * chargeMul * 10) / 10;
  t.percent = Math.min(MATCH.maxPercent, t.percent + damage);
  const kb = knockback(t.percent, damage, t.stats.weight, hb.knockback, hb.growth);
  let angle = normalizeAngle(hb.angle);
  if (t.grounded && angle > 180 && angle < 360) angle = 360 - angle;
  const ix = ((t.input.right ? 1 : 0) - (t.input.left ? 1 : 0));
  const iy = ((t.input.up ? 1 : 0) - (t.input.down ? 1 : 0));
  if (ix || iy) {
    const rad = (angle * Math.PI) / 180;
    const lx = Math.cos(rad) * dir, ly = Math.sin(rad);
    const cross = lx * iy - ly * ix;
    const len = Math.hypot(ix, iy);
    angle += PHYSICS.diMaxDegrees * (cross / len) * (dir > 0 ? 1 : -1);
  }
  const v = angleToVector(angle, dir, launchSpeed(kb));
  return { damage, percent: t.percent, kx: v.x, ky: v.y, hitstun: hitstunFrames(kb), hitlag: hitlagFrames(damage), kb };
}

// estimateKoPercent(hb) with no opts (and with {legacyKo:true}) === v1, over a grid.
{
  let n = 0, bad = 0;
  for (const damage of [1, 4.5, 9, 14, 18]) for (const angle of [0, 30, 45, 80, 90, 135, 200, 270, 361, -45]) {
    for (const base of [0, 20, 55, 90]) for (const growth of [0, 40, 100, 130]) {
      const hb = { damage, angle, knockback: base, growth };
      const want = v1Estimate(hb);
      n++;
      if (estimateKoPercent(hb) !== want || estimateKoPercent(hb, { legacyKo: true }) !== want) bad++;
    }
  }
  check(bad === 0, `legacy estimateKoPercent differs from v1 in ${bad}/${n} cases`);
  let lb = 0;
  for (let s = 0; s < 40; s += 0.7) for (let a = 0; a < 360; a += 13) if (launchReachesBlastZone(s, a) !== v1Launch(s, a) || launchReachesBlastZone(s, a, 0.5, 9) !== v1Launch(s, a, 0.5, 9)) lb++;
  check(lb === 0, `legacy launchReachesBlastZone differs in ${lb} cases`);
}

// governor:false applyHit === v1 hit math, bit-identical, including DI and grounded spikes.
{
  let n = 0, bad = 0, first = null;
  const inputs = [{}, { left: true }, { right: true, up: true }, { down: true }, { left: true, down: true }];
  for (const damage of [0.5, 3, 7.3, 12, 18]) for (const angle of [0, 45, 88, 135, 275, 300, 361]) for (const p of [0, 37.4, 120, 990]) {
    for (const input of inputs) for (const grounded of [true, false]) for (const dir of [1, -1]) for (const charge of [0, 31, 60]) {
      const hb = { damage, angle, knockback: 40, growth: 90 };
      const stale = 0.91;
      const t1 = fakeFighter(1, { percent: p, input, grounded, stats: { weight: 87, gravity: 0.65, fallSpeed: 11, height: 92 } });
      const t2 = { ...t1 };
      const game = fakeGame([fakeFighter(0), t1], { governor: false });
      const r = game.gov.applyHit({ attacker: game.fighters[0], target: t1, hb, dir, stale, chargeFrames: charge, tier: 'smash' });
      const w = v1Hit(t2, { hb, dir, stale, charge });
      n++;
      const same = r.damage === w.damage && t1.percent === w.percent && r.kx === w.kx && r.ky === w.ky && r.hitstun === w.hitstun && r.hitlag === w.hitlag && r.kb === w.kb;
      if (!same) { bad++; first = first ?? { r, w }; }
    }
  }
  check(bad === 0, `legacyHit differs from v1 in ${bad}/${n} cases: ${JSON.stringify(first)}`);
  const game = fakeGame([fakeFighter(0), fakeFighter(1)], { governor: false });
  check(game.gov.shieldDamage({ hb: { damage: 7.25 }, stale: 1, chargeFrames: 0 }).damage === Math.round(7.25 * 10) / 10, 'legacy shield damage = v1 rounding');
}

done('legacy');
