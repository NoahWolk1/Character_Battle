// ─────────────────────────────────────────────────────────────────────────────
// BALANCE RULES — the hard limits every character must obey.
//
// Characters are free to use ANY numbers they like. The auto-balancer
// (validate.js) then SCALES anything that goes past these limits back into range
// — e.g. a 999-damage punch becomes a max-strength punch, a 300-weight tank gets
// its stats squeezed into the shared budget. Nothing is rejected for being too
// strong; it just gets scaled, and `npm run validate` reports every adjustment.
// So nobody can ship a one-shot move or infinite health, but nobody is blocked.
//
// Only the repo owner should edit this file. Character PRs must not touch it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stats: each has a legal range and a point cost. Better stats cost more points,
 * and every character gets the same STAT_BUDGET to spend.
 * `points` is the cost at the max end of the range (cost scales linearly from min).
 */
export const STATS = {
  weight:           { min: 70,  max: 130, points: 20, default: 100, help: 'Heavier = survives longer, but is a bigger combo target.' },
  runSpeed:         { min: 4.5, max: 8.5, points: 20, default: 6.4, help: 'Max ground speed (px/frame).' },
  airSpeed:         { min: 3.2, max: 6.0, points: 15, default: 4.5, help: 'Max horizontal air speed (px/frame).' },
  jumpHeight:       { min: 12,  max: 18,  points: 10, default: 15,  help: 'Initial jump velocity (px/frame).' },
  doubleJumpHeight: { min: 11,  max: 17,  points: 10, default: 14,  help: 'Mid-air jump velocity (px/frame).' },
  airJumps:         { min: 1,   max: 3,   points: 12, default: 1,   help: 'Number of mid-air jumps (whole number).' },
  gravity:          { min: 0.5, max: 0.85, points: 0, default: 0.65, help: 'Free trade-off: floaty vs. fast-falling.' },
  fallSpeed:        { min: 8,   max: 14,  points: 0, default: 11,  help: 'Free trade-off: max fall speed.' },
  width:            { min: 38,  max: 72,  points: 0, default: 52,  help: 'Hurtbox width. Paid for via hurtbox area below.' },
  height:           { min: 70,  max: 118, points: 0, default: 92,  help: 'Hurtbox height. Paid for via hurtbox area below.' },
};

/** Smaller hurtboxes are harder to hit, so they cost points. */
export const HURTBOX_AREA = { free: 5600, min: 2900, points: 15 };

export const STAT_BUDGET = 52;

/**
 * The 16 move slots. Any slot a character leaves out gets a plain generic move.
 * Each move belongs to a category with its own limits.
 */
export const MOVE_SLOTS = {
  jab: 'jab',
  side: 'tilt',
  up: 'tilt',
  down: 'tilt',
  sideSmash: 'smash',
  upSmash: 'smash',
  downSmash: 'smash',
  nair: 'aerial',
  fair: 'aerial',
  bair: 'aerial',
  uair: 'aerial',
  dair: 'aerial',
  neutralSpecial: 'special',
  sideSpecial: 'special',
  upSpecial: 'recovery',
  downSpecial: 'special',
};

/**
 * Per-category limits.
 *  maxHit       max damage of any single hitbox
 *  maxTotal     max damage if every hit of the move connects (multi-hits included)
 *  minStartup   earliest frame a hitbox (or projectile) may come out
 *  minDuration  shortest legal total move length (frames)
 *  koFloor      the move may NOT KO the reference fighter from center stage below this %
 *  maxReach     farthest a hitbox edge may reach from the fighter's center (px)
 *  maxRadius    biggest hitbox radius
 *  maxDps       totalDamage / duration ceiling (prevents fast + strong)
 */
export const CATEGORIES = {
  jab:      { maxHit: 5,  maxTotal: 9,  minStartup: 2,  minDuration: 14, koFloor: 220, maxReach: 100, maxRadius: 30, maxDps: 0.45 },
  tilt:     { maxHit: 12, maxTotal: 13, minStartup: 5,  minDuration: 22, koFloor: 125, maxReach: 125, maxRadius: 36, maxDps: 0.5 },
  smash:    { maxHit: 18, maxTotal: 20, minStartup: 10, minDuration: 38, koFloor: 85,  maxReach: 140, maxRadius: 46, maxDps: 0.48 },
  aerial:   { maxHit: 14, maxTotal: 15, minStartup: 4,  minDuration: 24, koFloor: 110, maxReach: 120, maxRadius: 40, maxDps: 0.55, minLandingLag: 6 },
  special:  { maxHit: 15, maxTotal: 18, minStartup: 6,  minDuration: 26, koFloor: 100, maxReach: 135, maxRadius: 42, maxDps: 0.5 },
  recovery: { maxHit: 12, maxTotal: 14, minStartup: 3,  minDuration: 30, koFloor: 120, maxReach: 125, maxRadius: 40, maxDps: 0.45 },
  // v2 categories (§4.1.2). koFloor Infinity = may never KO; maxDps null = no dps limit.
  // maxReach (from collider center) only feeds the 1.8× absolute reach limit; v2 reach uses REACH_BEYOND.
  grab:     { maxHit: 0,  maxTotal: 0,  minStartup: 6,  minDuration: 28, koFloor: Infinity, maxReach: 100, maxRadius: 30, maxDps: null },
  throw:    { maxHit: 12, maxTotal: 14, minStartup: 1,  minDuration: 24, koFloor: 130, maxReach: 100, maxRadius: 36, maxDps: 0.6 },
  pummel:   { maxHit: 3,  maxTotal: 3,  minStartup: 2,  minDuration: 14, koFloor: Infinity, maxReach: 90,  maxRadius: 30, maxDps: 0.25, setKnockback: 0 },
  counter:  { maxHit: 15, maxTotal: 15, minStartup: 2,  minDuration: 30, koFloor: 100, maxReach: 125, maxRadius: 40, maxDps: 0.6 },
  utility:  { maxHit: 6,  maxTotal: 8,  minStartup: 4,  minDuration: 20, koFloor: 200, maxReach: 120, maxRadius: 40, maxDps: 0.4 },
  taunt:    { maxHit: 2,  maxTotal: 2,  minStartup: 6,  minDuration: 40, koFloor: Infinity, maxReach: 100, maxRadius: 40, maxDps: 0.1 },
};

export const KNOCKBACK_LIMITS = { maxBase: 90, maxGrowth: 130, minGrowth: 0 };

export const PROJECTILE_LIMITS = {
  maxPerMove: 3,
  maxDamage: 11,
  maxSpeed: 13,
  maxLife: 100,
  maxRadius: 28,
  maxGravity: 0.8,
  minStartup: 8,
};

/** Self-movement during moves (dashes, recovery jumps). */
export const MOVEMENT_LIMITS = {
  maxVx: 14,
  maxVy: 17,
  maxRise: 300,     // px an upSpecial may carry you upward
  maxTravel: 340,   // px of horizontal travel a single move may give you
};

/** Frames of invincibility a single move may grant (e.g. a counter or a dodge-attack). */
export const INTANGIBLE_MAX = 10;

/**
 * Each move earns "power points" (roughly 0–10). If the sum across all 16 moves is
 * over budget, the auto-balancer weakens every move a little until it fits.
 */
export const MOVE_BUDGET = 112;

export const META_LIMITS = {
  nameMax: 18,
  descriptionMax: 220,
  idPattern: /^[a-z][a-z0-9-]{1,23}$/,
};

// ── v2 additions (spec §4.1) ────────────────────────────────────────────────

/**
 * v2 reach limit per category (§4.1.2): px from the nearest point of the `default`
 * hurtbox union to the far edge of the hitbox. There is also an absolute limit of
 * REACH_ABS_MUL × CATEGORIES[cat].maxReach from the collider center.
 */
export const REACH_BEYOND = {
  jab: 70, tilt: 95, smash: 110, aerial: 90, special: 105, recovery: 95,
  grab: 60, throw: 60, pummel: 60, counter: 90, utility: 80, taunt: 60,
};
export const REACH_ABS_MUL = 1.8;

/** v2 action limits that are not per-category (§2.2.8, §4.1.2). v1 files keep INTANGIBLE_MAX. */
export const ACTION_LIMITS = {
  maxDuration: 150,
  maxActive: 40,          // longest single hitbox window (frames)
  minRadius: 4,
  minRehit: 3,
  intangibleMax: 12,      // per action: all windows + timeline grants
  intangibleGrant: 20,    // one timeline `intangible` grant
  armorMax: 12,           // action armor threshold (damage)
  landingLag: [0, 40],
  gravityScale: [0.3, 1.5],
  holdMax: [1, 600],
  chargeMax: [1, 60],
  counterMul: [1, 1.3],
  hitMul: [0.5, 1.5],     // shieldMul, hitlagMul
  push: [0, 6],
  setKnockback: [0, 120],
  steer: { speed: [0, 12], turn: [0, 0.3] },
  teleport: 200,
  cameraShake: [0, 8],
  maxRiseOther: 120,      // rise budget for moves not routed from upSpecial (upSpecial: MOVEMENT_LIMITS.maxRise)
};

/**
 * Body limits (§2.2.3, §4.1.1). Area A = union area of `hurtboxes.default` × scaleMin².
 * Area cost (v2 curve): A ∈ [HURTBOX_AREA.min, free]: v1 cost;
 * A ∈ [minArea, HURTBOX_AREA.min): HURTBOX_AREA.points + smallPoints·(min − A)/(min − minArea);
 * A > free: refund −min(refundMax, refundMax·(A − free)/refundSpan).
 */
export const BODY_LIMITS = {
  collider: { w: [20, 160], h: [20, 200] },
  maxShapes: 6,
  maxSets: 8,
  envelope: { x: 2, up: 2.5, down: 0.5 },   // x ∈ [−2M, 2M], y ∈ [−2.5h, 0.5h], M = max(w, h)
  minCover: 0.2,                            // every set covers the collider center, ≥ 20% of it,
  minInside: 0.5,                           // or keeps ≥ 50% of its own area on it (else W136)
  scaleRange: [0.6, 1.6],
  armorMax: 3,
  armorPoints: 2.5,                         // stat points per point of passive threshold
  minArea: 1600,
  maxArea: 16000,
  smallPoints: 10,
  refundMax: 10,
  refundSpan: 8400,
};

/** Movement modes (§2.2.5): stat cost + clamped param ranges ('0.8×runSpeed' = fraction of the form's runSpeed). */
export const MOVEMENT_MODES = {
  hover:     { cost: 2, ranges: { frames: [1, 120], fallSpeed: [1.0, 4], drift: [0.5, 1.2] } },
  glide:     { cost: 2, ranges: { frames: [1, 150], fallSpeed: [1.2, 4], speed: [1, 1.3], turn: [0, 0.1] } },
  fly:       { cost: 6, ranges: { fuel: [1, 180], thrust: [0.1, 0.9], maxRise: [1, 5] } },
  wallCling: { cost: 1, ranges: { frames: [1, 60], jumpVx: [0, 8], jumpVy: [0, 14] } },
  crawl:     { cost: 2, ranges: { frames: [1, 120], speed: [1, '0.8×runSpeed'] } },
};

/**
 * Entity limits per kind (§4.1.3). governor-rules.js reads maxHit, koFloor and threat.
 * `zone` = burst zone (life ≤ 30, no rehit); any other zone is `zoneLingering`.
 * clone: damageMul × owner damage at runtime; maxHit is the static per-hit cap.
 * part: own hitboxes deal 0; relay-1 parts may live forever, relay < 1 parts ≤ partLife.
 */
export const ENTITY_LIMITS = {
  projectile:    { maxHit: 11, minRehit: 10,   maxLife: 240,  maxSpeed: 14,   maxHp: 6,  threat: 1, tier: 'projectile', koFloor: 140, maxRadius: 28 },
  minion:        { maxHit: 6,  minRehit: 20,   maxLife: 1200, maxSpeed: 8,    maxHp: 20, threat: 2, tier: 'minion', koFloor: 160 },
  trap:          { maxHit: 10, minRehit: 45,   maxLife: 900,  maxSpeed: 6,    maxHp: 15, threat: 2, tier: 'trap', koFloor: 140 },
  zone:          { maxHit: 12, minRehit: null, maxLife: 30,   maxSpeed: null, maxHp: 0,  threat: 2, tier: 'zone', koFloor: 120 },
  zoneLingering: { maxHit: 3,  minRehit: 15,   maxLife: 360,  maxSpeed: null, maxHp: 0,  threat: 3, tier: 'zone', koFloor: 200 },
  beam:          { maxHit: 4,  minRehit: 8,    maxLife: 90,   maxSpeed: null, maxHp: 0,  threat: 3, tier: 'beam', koFloor: 200, maxLength: 520, maxWidth: 24 },
  clone:         { maxHit: 9,  minRehit: null, maxLife: 600,  maxSpeed: null, maxHp: 25, threat: 4, tier: 'clone', koFloor: 140, damageMul: 0.5 },
  part:          { maxHit: 0,  minRehit: null, maxLife: Infinity, maxSpeed: null, maxHp: 25, threat: 1, tier: null, koFloor: Infinity, partLife: 900, relay: [0.5, 1] },
};

/** Entity limits shared by every kind (§4.1.3). */
export const ENTITY_RULES = {
  maxDefs: 16,
  maxTurn: 0.12,          // homing turn, rad/frame
  minEvery: 30,           // every.frames
  maxSpawnOffset: 160,    // spawn point distance from the collider center
  maxCount: 5,            // spawn count per entry
  maxAlive: 8,
  cloneScale: [0.5, 1],
  damageShare: 0.5,       // entity damage × this counts toward the spawning action's maxTotal
  // TimelineActions that run in entity lists (onSpawn/onHit/onExpire/onDeath); others are dropped (W415).
  listActions: ['spawn', 'emit', 'sfx', 'camera', 'resource', 'status', 'hit', 'form', 'velocity', 'impulse'],
};

/** Status, resource and var limits (§2.2.1, §2.2.6, §2.2.10; runtime caps: governor-rules.js STATUS_CAPS). */
export const STATUS_LIMITS = {
  maxCustom: 8,
  frames: [1, 300],
  maxStacks: [1, 3],
  dotMinEvery: 15,
  dotMaxDamage: 0.5,
  healMinEvery: 30,
  healMaxAmount: 1,
  maxResources: 6,
  resourceMax: [1, 1000],
  soakFraction: [0, 0.5],
  soakMinCost: 0.5,
  maxVars: 32,
  maxVarString: 24,
  maxVarNumber: 1e6,
  maxSync: 16,
};

// NOTE: new exports go ABOVE this line — the freeze tail must stay the last statement.
// Deep-freeze every export (engine rules are read-only at runtime). Must stay the LAST statement.
import * as self from './rules.js'; import { deepFreeze } from '../util/freeze.js'; Object.values(self).forEach((v) => deepFreeze(v));
