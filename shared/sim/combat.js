// Knockback math, shared by the simulation and the balance validator.
import { COMBAT, PHYSICS, REFERENCE } from '../constants.js';
import { getStage, DEFAULT_STAGE_ID } from '../stages/index.js';

const DEFAULT_STAGE = getStage(DEFAULT_STAGE_ID);

const DEG = Math.PI / 180;
const SPIKE_ARC = [200, 340]; // mirrors GOVERNOR.spikeArc / spikeVyMax (kept local: combat.js stays dependency-light)
const SPIKE_VY = 9;

/**
 * Smash-style knockback.
 * @param {number} percentAfter target's damage % after the hit is applied
 * @param {number} damage       damage of the hit
 * @param {number} weight       target weight
 * @param {number} base         hitbox base knockback
 * @param {number} growth       hitbox knockback growth (100 = normal)
 */
export function knockback(percentAfter, damage, weight, base, growth) {
  const p = percentAfter;
  const scaled = (p / 10 + (p * damage) / 20) * (200 / (weight + 100)) * 1.4 + 18;
  return scaled * (growth / 100) + base;
}

export function launchSpeed(kb) {
  return kb * COMBAT.knockbackScale;
}

export function hitstunFrames(kb) {
  return Math.min(PHYSICS.maxHitstun, Math.floor(kb * PHYSICS.hitstunPerKnockback));
}

export function hitlagFrames(damage) {
  return Math.min(COMBAT.hitlagMax, Math.floor(COMBAT.hitlagBase + damage * COMBAT.hitlagPerDamage));
}

/** Converts a hitbox angle (0 = forward, 90 = up) into a velocity vector. */
export function angleToVector(angleDeg, facing, speed) {
  const a = angleDeg * DEG;
  return { x: Math.cos(a) * speed * facing, y: -Math.sin(a) * speed };
}

/**
 * Simulates a launch and reports whether it reaches a blast zone.
 * Legacy form `(speed, angle, gravity?, fallSpeed?)`: v1 estimator (REFERENCE distances,
 * center stage, top/sides only). Kept bit-identical for legacyKo / golden replays.
 * v2 form `(speed, angle, opts)`: see simulateLaunch.
 */
export function launchReachesBlastZone(speed, angleDeg, gravity = 0.65, fallSpeed = 11) {
  if (gravity && typeof gravity === 'object') return simulateLaunch(speed, angleDeg, gravity);
  return legacyLaunch(speed, angleDeg, gravity, fallSpeed);
}

function legacyLaunch(speed, angleDeg, gravity, fallSpeed) {
  const a = angleDeg * DEG;
  let kx = Math.cos(a) * speed;
  let ky = -Math.sin(a) * speed;
  let vy = 0;
  let x = 0;
  let y = 0;
  for (let f = 0; f < 400; f++) {
    const mag = Math.hypot(kx, ky);
    if (mag <= PHYSICS.launchDecay) { kx = 0; ky = 0; } else {
      const k = (mag - PHYSICS.launchDecay) / mag;
      kx *= k; ky *= k;
    }
    vy = Math.min(vy + gravity, fallSpeed);
    x += kx;
    y += ky + vy;
    if (Math.abs(x) >= REFERENCE.blastDistanceX || -y >= REFERENCE.blastDistanceY) return true;
    if (kx === 0 && ky === 0) return false;
  }
  return false;
}

/**
 * v2 launch simulation against the REAL blast zones of a stage (all four sides),
 * mirroring the engine's hitstun physics: vy accumulates gravity (≤ fallSpeed),
 * knockback decays linearly, KO when x < left, x > right, y > bottom or y − height < top.
 * The launch ends (no KO) once knockback has fully decayed.
 * @param {number} speed  launch speed (px/frame)
 * @param {number} angleDeg launch angle (0 = forward, 90 = up), relative to `dir`
 * @param {object} [o]
 * @param {object} [o.stage]  stage geometry (default: sky-sanctum)
 * @param {number} [o.gravity=0.65] [o.fallSpeed=11] target physics
 * @param {{x,y}} [o.origin={x:0,y:0}] launch origin (world)
 * @param {number} [o.dir=1]  facing of the launch (+1 → angle 0 points to +x)
 * @param {number} [o.height=0] target collider height (top blast check)
 * @param {boolean} [o.solid=false] collide with the main ground (bounce/land like the engine)
 */
export function simulateLaunch(speed, angleDeg, o = {}) {
  const stage = o.stage || DEFAULT_STAGE;
  const b = stage.blast;
  const g = stage.ground;
  const gravity = o.gravity ?? 0.65;
  const fallSpeed = o.fallSpeed ?? 11;
  const height = o.height ?? 0;
  const solid = !!o.solid;
  const a = angleDeg * DEG;
  const dir = o.dir === -1 ? -1 : 1;
  let kx = Math.cos(a) * speed * dir;
  let ky = -Math.sin(a) * speed;
  let vy = 0;
  let x = o.origin ? o.origin.x : 0;
  let y = o.origin ? o.origin.y : 0;
  for (let f = 0; f < 600; f++) {
    vy = Math.min(vy + gravity, fallSpeed);
    const mag = Math.hypot(kx, ky);
    if (mag > 0) {
      if (mag <= PHYSICS.launchDecay) { kx = 0; ky = 0; } else {
        const k = (mag - PHYSICS.launchDecay) / mag;
        kx *= k; ky *= k;
      }
    }
    const oy = y;
    x += kx;
    y += ky + vy;
    if (x < b.left || x > b.right || y > b.bottom || y - height < b.top) return true;
    if (solid && x >= g.x1 && x <= g.x2 && y >= g.y && oy <= g.y + 0.01) {
      y = g.y;
      if (Math.hypot(kx, ky) > 5) { ky = -Math.abs(ky) * 0.55; vy = -Math.abs(vy) * 0.3; } else return false;
    } else if (solid && x > g.x1 && x < g.x2 && y > g.y && y - height < g.bottom) {
      return false; // inside the stage body: blocked
    }
    if (kx === 0 && ky === 0) return false;
  }
  return false;
}

/**
 * Lowest % (pre-hit) at which this hitbox KOs (Infinity if never).
 * No `opts` (or opts.legacyKo): the v1 estimator — reference fighter from center stage,
 * REFERENCE distances, no spikes/charge/DI. Used for v1 characters and golden parity.
 * v2 (`opts` given, legacyKo falsy): real blast zones, minimum over
 *   weight ∈ opts.weights (default [70, 100]), charge ×1 and ×opts.chargeMul (if opts.canCharge),
 *   DI −12/0/+12, grounded (spike flip, center) and airborne (center with the stage solid,
 *   plus origin (ground.x2 + 40, 0) for downward angles).
 * @param {{damage, angle, knockback, growth, setKnockback?}} hb
 * Pass `opts.floor` (the tier's KO floor) to model the runtime offstage-spike cap
 * (§4.2.2: below the floor, airborne spikes keep ≤ 9 px/f vertical), so static scaling
 * does not crush spikes that the Governor already makes survivable.
 * @param {object} [opts] {legacyKo, stage, gravity, fallSpeed, height, weights, canCharge,
 *   chargeMul=1.4, maxHit=25, di=[-12,0,12], situations=['grounded','air'], floor}
 */
export function estimateKoPercent(hb, opts) {
  if (!opts || opts.legacyKo) return legacyEstimate(hb);
  const kos = koPredicate(hb, opts);
  if (!kos(999)) return Infinity;
  if (kos(0)) return 0;
  let lo = 0, hi = 999;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kos(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

function legacyEstimate({ damage, angle, knockback: base, growth }) {
  const kos = (p) => {
    const kb = knockback(p + damage, damage, REFERENCE.weight, base, growth);
    return launchReachesBlastZone(launchSpeed(kb), normalizeAngle(angle));
  };
  if (!kos(999)) return Infinity;
  let lo = 0, hi = 999;
  if (kos(0)) return 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kos(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

function koPredicate(hb, opts) {
  const stage = opts.stage || DEFAULT_STAGE;
  const phys = { stage, gravity: opts.gravity ?? 0.65, fallSpeed: opts.fallSpeed ?? 11, height: opts.height ?? 0 };
  const weights = opts.weights || [70, 100];
  const charges = opts.canCharge ? [1, opts.chargeMul ?? 1.4] : [1];
  const dis = opts.di || [-12, 0, 12];
  const sits = opts.situations || ['grounded', 'air'];
  const maxHit = opts.maxHit ?? 25;
  const raw = normalizeAngle(hb.angle ?? 0);
  const ledge = { x: stage.ground.x2 + 40, y: stage.ground.y };
  // Launch cases independent of percent: [angle, origin, solid].
  const cases = [];
  for (const s of sits) {
    const base = s === 'grounded' && raw > 180 && raw < 360 ? 360 - raw : raw;
    for (const d of dis) {
      const ang = normalizeAngle(base + d);
      if (s === 'grounded') cases.push([ang, null, false, false]);
      else {
        const spike = ang > SPIKE_ARC[0] && ang < SPIKE_ARC[1];
        cases.push([ang, null, true, spike]);
        if (raw > 180 && raw < 360) cases.push([ang, ledge, true, spike]);
      }
    }
  }
  const fixed = typeof hb.setKnockback === 'number';
  return (p) => {
    for (const w of weights) {
      for (const c of charges) {
        const dmg = Math.min(maxHit, (hb.damage || 0) * c);
        const kb = fixed ? hb.setKnockback : knockback(Math.min(999, p + dmg), dmg, w, hb.knockback || 0, hb.growth || 0);
        const sp = Math.min(40, launchSpeed(kb));
        const capped = opts.floor !== undefined && p + dmg < opts.floor;
        for (const [ang, origin, solid, spike] of cases) {
          const v = capped && spike ? Math.min(sp, SPIKE_VY / Math.max(0.2, Math.abs(Math.sin(ang * DEG)))) : sp;
          if (simulateLaunch(v, ang, { ...phys, origin, solid })) return true;
        }
      }
    }
    return false;
  };
}

export function normalizeAngle(angle) {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}
