// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME GOVERNOR CONSTANTS (spec §4.2). Every runtime cap the engine enforces
// on character-driven damage, movement, defense, entities and statuses.
//
// Static scaling (validate.js) keeps character DATA in range; the Governor
// (shared/sim/governor.js) keeps character BEHAVIOR in range at hit time.
// Only the repo owner should edit this file. Character PRs must not touch it.
// ─────────────────────────────────────────────────────────────────────────────
import * as RULES from './rules.js';

export const GOVERNOR = {
  // §4.2.1 damage pipeline
  multMin: 0.5,
  multMax: 1.5,
  staleMin: 0.5,
  chargeMax: 1.4,             // 1 + 0.4·chargeFrames/60, capped
  chargeFramesFull: 60,
  reflectedMul: 1.25,
  cloneMul: 0.5,
  perHitTierMul: 1.4,         // per-hit cap = min(1.4 × TIER.maxHit, absMaxHit)
  absMaxHit: 25,
  maxSpeed: 40,               // absolute launch-speed cap (kb ≈ 266)
  armorFailKb: 200,           // armor never holds against kb ≥ this
  hitlagMulMin: 0.5,
  hitlagMulMax: 1.5,

  // §4.2.2 KO floor
  hardKoFloor: 60,
  koSafety: 0.95,             // cap = 0.95 × worst Vko in the DI window × ramp
  koRampMin: 0.55,            // ramp at 0%; 1.0 at the floor
  koDiWindow: 12,             // ± degrees searched around the launch angle
  koDiStep: 3,
  spikeVyMax: 9,              // airborne spikes below the floor: vertical speed ≤ 9 px/f
  spikeHitstunMax: 20,
  spikeArc: [200, 340],
  // Wind below the KO floor (§4.2.2 spirit): never pushes an offstage target farther out or down,
  // and never lifts a target higher than windLift px above the main ground.
  windLift: 360,

  // §4.2.3 combo proration and BREAK
  chainIdleReset: 12,         // actionable frames that end a chain
  rehitWeight: 1 / 3,
  prorateStep: 0.06,
  prorateMin: 0.5,
  prorateStunStep: 0.05,
  prorateStunMin: 0.5,
  breakHits: 14,
  breakDamage: 55,
  breakLock: 180,
  breakIntangible: 30,
  breakImmunity: 120,         // stun / freeze / grab immunity after BREAK
  // Hitstun uptime: once a target spent ≥ max of the last `window` frames in hitstun/stun, new
  // hits still launch but deal no hitstun (swarms and rehit fields can't lock a fighter forever).
  lockUptime: { window: 600, max: 300 },

  // §4.2.4 damage rate (per attacker → target)
  rate: { window: 120, longWindow: 600, soft: 40, softMul: 0.25, hard: 50, longHard: 140, minConnect: 0.3 },
  shieldRate: { window: 120, soft: 35, softMul: 0.25, hard: 45 },

  // §4.2.5 air and movement budgets (per airtime)
  air: {
    maxVx: 18,
    maxRiseVy: 17,            // vy ≥ −17
    rise: 380,                // px of non-jump self rise
    stall: 240,               // frames with −1 ≤ vy ≤ 2.5 not caused by knockback
    stallVyMin: -1,
    stallVyMax: 2.5,
    teleports: 1,
    teleportDist: 200,
    groundTeleportEvery: 20, // grounded (sideways) teleports: at most one per this many frames
    longAir: 600,             // frames airborne without landing / being hit → helpless
    hitRefund: 0.5,           // fraction of spent rise/stall refunded on a tumble hit
  },

  // §4.2.6 mitigation (soak, relay, damageIn savings, heal)
  mitigation: { perStock: 45, perHitFrac: 0.5, window: 300, perWindow: 20 },
  heal: { window: 30, perWindow: 1 },

  // §4.2.7 armor
  armor: { maxThreshold: 12, maxPassive: 3, window: 300, uptime: 60 },

  // §4.2.8 entities (per owner)
  entities: {
    maxAlive: 8, maxThreat: 10, maxBeams: 1, maxTrapsZones: 3, maxHp: 3, maxClones: 1,
    spawnWindow: 60, spawnsPerWindow: 4, hpCooldown: 300, maxPerTemplate: 8,
  },

  // §4.2.10 intangibility from character sources
  intangible: { perGrant: 20, window: 300, budget: 45, counterCharge: 12 },
  minHurtArea: 1600,          // §3.7 (BODY_LIMITS.minArea): smaller hurtbox sets are charged as intangibility
};

/** §4.2.9 status, control and modifier caps. */
export const STATUS_CAPS = {
  maxFrames: 300,
  perTarget: 4,
  perOwner: 3,
  dot: { maxPerTick: 0.5, minEvery: 15, perApplication: 10, perTarget: 2 },
  control: {
    stun:    { max: 40,  immunity: 180, group: 'stun' },
    freeze:  { max: 40,  immunity: 180, group: 'stun' },   // stun and freeze share immunity
    root:    { max: 60,  immunity: 0,   group: 'root' },
    silence: { max: 120, immunity: 0,   group: 'silence' },
    confuse: { max: 90,  immunity: 300, group: 'confuse' },
  },
  controlTotal: { window: 600, max: 90, kinds: ['stun', 'freeze', 'root', 'silence', 'grab'] },
  reapplyWindow: 300,         // reapplying control within this halves duration
  reapplyMul: 0.5,
};

/** Modifier ranges, applied after multiplying all sources together (§4.2.9). */
export const MOD_RANGES = {
  speed:       [0.6, 1.25],
  jump:        [0.7, 1.2],
  gravity:     [0.5, 1.4],
  fallSpeed:   [0.7, 1.3],
  damageOut:   [0.8, 1.15],
  damageIn:    [0.85, 1.15],
  knockbackIn: [0.85, 1.2],
};

// Entity kind table (§4.1.3). Prefers rules.js ENTITY_LIMITS once WP-C adds it.
const ENTITY_DEFAULTS = {
  projectile:    { maxHit: 11, threat: 1, koFloor: 140 },
  minion:        { maxHit: 6,  threat: 2, koFloor: 160 },
  trap:          { maxHit: 10, threat: 2, koFloor: 140 },
  zone:          { maxHit: 12, threat: 2, koFloor: 120 },   // burst zone (life ≤ 30, no rehit)
  zoneLingering: { maxHit: 3,  threat: 3, koFloor: 200 },
  beam:          { maxHit: 4,  threat: 3, koFloor: 200 },
  clone:         { maxHit: 9,  threat: 4, koFloor: 140 },   // ×0.5 owner damage is applied as a multiplier
  part:          { maxHit: 0,  threat: 1, koFloor: Infinity },
};

// Move categories added in v2 (§4.1.2). Prefers rules.js CATEGORIES rows once WP-C adds them.
const CATEGORY_DEFAULTS = {
  grab:    { maxHit: 0,  koFloor: Infinity },
  throw:   { maxHit: 12, koFloor: 130 },
  pummel:  { maxHit: 3,  koFloor: Infinity },
  counter: { maxHit: 15, koFloor: 100 },
  utility: { maxHit: 6,  koFloor: 200 },
  taunt:   { maxHit: 2,  koFloor: Infinity },
};

const num = (v, d) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);
const floorOf = (v, d) => (v === null || v === undefined ? d : num(v, d));

function buildTiers() {
  const out = {};
  const cats = RULES.CATEGORIES || {};
  for (const [k, c] of Object.entries(cats)) out[k] = { maxHit: num(c.maxHit, 15), koFloor: floorOf(c.koFloor, 100) };
  for (const [k, c] of Object.entries(CATEGORY_DEFAULTS)) {
    if (!out[k]) out[k] = { ...c };
  }
  const ents = RULES.ENTITY_LIMITS || {};
  for (const [k, c] of Object.entries(ENTITY_DEFAULTS)) {
    const r = ents[k] || {};
    out[k] = { maxHit: num(r.maxHit, c.maxHit), koFloor: floorOf(r.koFloor, c.koFloor) };
  }
  out.status = { maxHit: STATUS_CAPS.dot.maxPerTick, koFloor: Infinity };
  return out;
}

/** Runtime tiers: per-hit cap source and KO floor for every move category and entity kind. */
export const TIER = buildTiers();

/** Threat points per entity kind (§4.2.8). */
export const ENTITY_THREAT = Object.fromEntries(Object.entries(ENTITY_DEFAULTS).map(([k, c]) => {
  const r = (RULES.ENTITY_LIMITS || {})[k] || {};
  return [k, num(r.threat, c.threat)];
}));

// Deep-freeze every export (governor rules are read-only at runtime). Must stay the LAST statement.
import * as self from './governor-rules.js'; import { deepFreeze } from '../util/freeze.js'; Object.values(self).forEach((v) => deepFreeze(v));
