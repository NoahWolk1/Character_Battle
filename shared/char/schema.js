// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER SCHEMA v2 — the single table of every field a character file may
// use: type, default and legal range (spec §2.2). Shared by the normalizers
// (unknown-field detection, defaults), the validator (ranges) and the docs
// generator (scripts/gen-docs.js renders these tables).
//
// Ranges here are documentation + data for the validator: normalize() never
// clamps (it only fills defaults and reports structure); the scalers in
// shared/balance/v2/* clamp and explain.
//
// Field spec: { type, default?, defaultDoc?, range?: [min, max], int?, values?,
//               of?, ref?, required?: 'E0xx', maxKeys?, doc }
//   type: 'number' | 'int' | 'bool' | 'string' | 'enum' | 'shape' | 'shapes'
//       | 'window' | 'object' | 'map' | 'list' | 'fn' | 'ref' | 'any'
//   ref:  'move' | 'entity' | 'template' | 'status' | 'resource' | 'form' | 'var'
// ─────────────────────────────────────────────────────────────────────────────
import { STATS, MOVE_SLOTS } from '../balance/rules.js';
import { deepFreezeAll } from '../util/freeze.js';

const f = (type, extra = {}) => ({ type, ...extra });

// ── Vocabularies ────────────────────────────────────────────────────────────
/** The 16 v1 input slots, in v1 order. */
export const V1_SLOTS = Object.keys(MOVE_SLOTS);
/** Optional triggers added in v2. */
export const NEW_TRIGGERS = ['grab', 'pummel', 'fthrow', 'bthrow', 'uthrow', 'dthrow', 'taunt'];
/** Every trigger, in resolution/report order. */
export const TRIGGERS = [...V1_SLOTS, ...NEW_TRIGGERS];
/** Default category per trigger (MOVE_SLOTS plus the new triggers). */
export const TRIGGER_CATEGORY = {
  ...MOVE_SLOTS, grab: 'grab', pummel: 'pummel', fthrow: 'throw', bthrow: 'throw', uthrow: 'throw', dthrow: 'throw', taunt: 'taunt',
};
export const THROW_TRIGGERS = ['fthrow', 'bthrow', 'uthrow', 'dthrow'];
export const CATEGORY_NAMES = ['jab', 'tilt', 'smash', 'aerial', 'special', 'recovery', 'grab', 'throw', 'pummel', 'counter', 'utility', 'taunt'];
/** Tiers a hit can use: move categories plus runtime-only tiers (§4.1.3, §4.2). */
export const TIER_NAMES = [...CATEGORY_NAMES, 'projectile', 'minion', 'trap', 'zone', 'beam', 'clone', 'status'];
/**
 * Startup/duration fallbacks for categories that rules.js CATEGORIES may not
 * have yet (§4.1.2 new rows). Used only to fill defaults (generic hitbox start).
 */
export const CATEGORY_TIMING_FALLBACK = {
  grab: { minStartup: 6, minDuration: 28 }, throw: { minStartup: 1, minDuration: 24 }, pummel: { minStartup: 2, minDuration: 14 },
  counter: { minStartup: 2, minDuration: 30 }, utility: { minStartup: 4, minDuration: 20 }, taunt: { minStartup: 6, minDuration: 40 },
};
export const ARCHETYPES = ['rushdown', 'zoner', 'heavy', 'trickster', 'summoner', 'grappler', 'allrounder'];
export const SHAPE_KINDS = ['circle', 'capsule', 'rect'];
export const HIT_KINDS = ['strike', 'grab', 'wind', 'reflect', 'absorb'];
export const WIND_DIRS = ['facing', 'away', 'toward', 'angle'];
export const ENTITY_KINDS = ['projectile', 'minion', 'trap', 'zone', 'beam', 'clone', 'part'];
export const MOTION_TYPES = ['ballistic', 'linear', 'homing', 'orbit', 'attached', 'stationary', 'walker', 'boomerang', 'mimic'];
export const COLLIDE_MODES = ['die', 'bounce', 'stick', 'walk', 'pass'];
export const CONTROL_KINDS = ['stun', 'freeze', 'root', 'silence', 'confuse'];
export const STACK_MODES = ['refresh', 'add', 'ignore'];
export const HUD_STYLES = ['bar', 'pips', 'ring', 'none'];
/** Buttons a hold/charge/cancel may name (constants.js BUTTONS plus taunt). */
export const ACTION_BUTTONS = ['jump', 'attack', 'special', 'strong', 'shield', 'taunt', 'up', 'down', 'left', 'right'];
/** Extra `cancels.into` targets besides move and trigger names. */
export const CANCEL_SPECIALS = ['jump', 'shield', 'any'];
/** The 14 v1 effect presets (effect is an open vocabulary; unknown names fall back in art). */
export const EFFECT_PRESETS = ['punch', 'kick', 'slash', 'fire', 'ice', 'electric', 'magic', 'water', 'wind', 'dark', 'light', 'poison', 'earth', 'none'];
/** Default v1 body (stats.width/height defaults). */
export const DEFAULT_BODY = { w: STATS.width.default, h: STATS.height.default };
export const CROUCH_HEIGHT = 0.68;

// ── Shapes (§2.2.2) ─────────────────────────────────────────────────────────
export const SHAPE_FIELDS = {
  circle: { x: f('number', { default: 0 }), y: f('number', { default: 0 }), r: f('number', { default: 20, doc: 'Radius.' }) },
  capsule: {
    x1: f('number', { default: 0 }), y1: f('number', { default: 0 }), x2: f('number', { default: 0 }), y2: f('number', { default: 0 }),
    r: f('number', { default: 12 }),
  },
  rect: { x: f('number', { default: 0, doc: 'Center x.' }), y: f('number', { default: 0, doc: 'Center y.' }), w: f('number', { default: 40 }), h: f('number', { default: 40 }) },
};

// ── CharacterDef (§2.2.1) ───────────────────────────────────────────────────
export const CHARACTER_FIELDS = {
  version: f('int', { values: [1, 2], defaultDoc: 'set to 2 by defineCharacter; missing or 1 = v1 file', doc: 'File format version.' }),
  id: f('string', { required: 'E001', doc: 'Matches /^[a-z][a-z0-9-]{1,23}$/ and the folder name.' }),
  name: f('string', { required: 'E002', range: [1, 18], doc: 'Display name (truncated with a note if longer).' }),
  author: f('string', { default: '' }),
  description: f('string', { default: '', range: [0, 220] }),
  archetype: f('enum', { values: ARCHETYPES, default: 'allrounder', doc: 'Hint for AI and docs only.' }),
  body: f('object', { of: 'BodyDef', defaultDoc: 'v1 defaults (52×92 rect)' }),
  stats: f('object', { of: 'StatsDef', defaultDoc: 'STATS[*].default' }),
  movement: f('object', { of: 'MovementDef', default: {}, doc: 'Engine movement modes (walker if empty).' }),
  resources: f('map', { of: 'ResourceDef', default: {}, maxKeys: 6 }),
  vars: f('map', { of: 'number|boolean|string', default: {}, maxKeys: 32, doc: 'Strings ≤ 24 chars; numbers finite, clamped to ±1e6.' }),
  sync: f('list', { ref: 'var', default: [], maxKeys: 16, doc: 'Var names sent to clients. Resources sync by default.' }),
  hitboxes: f('map', { of: 'HitTemplate', default: {}, doc: 'Named strike templates: the only way scripts deal damage.' }),
  statuses: f('map', { of: 'StatusDef', default: {}, maxKeys: 8 }),
  entities: f('map', { of: 'EntityDef', default: {}, maxKeys: 16 }),
  moves: f('map', { of: 'Action', default: {}, doc: 'A pool. v1 slot names are just pool names.' }),
  slots: f('map', { of: 'string|SlotFn', defaultDoc: 'identity (slots.jab = "jab", …)', doc: 'Routes triggers to move names.' }),
  forms: f('map', { of: 'FormDef', default: {}, maxKeys: 6, doc: 'The base definition is the implicit form "base".' }),
  startForm: f('ref', { ref: 'form', default: 'base', required: 'E011' }),
  behavior: f('object', { of: 'Hooks', default: {} }),
  ai: f('object', { of: 'AIHints', default: {} }),
  art: f('object', { of: 'ArtDef', defaultDoc: 'auto-art', doc: 'Client only. The sim never reads it.' }),
};

// ── BodyDef (§2.2.3) ────────────────────────────────────────────────────────
export const BODY_FIELDS = {
  collider: f('object', { of: '{w, h}', defaultDoc: 'AABB of hurtboxes.default', range: { w: [20, 160], h: [20, 200] }, doc: 'Stage physics, ledge snap, blast-zone top.' }),
  hurtboxes: f('map', { of: 'Shape[]', defaultDoc: 'default: collider rect; crouch: same rect at 0.68 height', maxKeys: 8, maxShapes: 6 }),
  scaleRange: f('list', { default: [1, 1], range: [0.6, 1.6], doc: 'setBodyScale bounds; area priced at min.' }),
  armor: f('object', { of: '{threshold}', range: { threshold: [0, 3] }, doc: 'Passive flinch armor (damage), 2.5 stat pts per point.' }),
};
export const COLLIDER_FIELDS = { w: f('number', { range: [20, 160] }), h: f('number', { range: [20, 200] }) };
export const BODY_ARMOR_FIELDS = { threshold: f('number', { default: 0, range: [0, 3] }) };

// ── StatsDef (§2.2.4) — same ranges/costs as v1 STATS minus width/height ───
export const V1_ONLY_STATS = ['width', 'height'];
export const STAT_FIELDS = Object.fromEntries(Object.entries(STATS).filter(([k]) => !V1_ONLY_STATS.includes(k)).map(([k, s]) => [k,
  f(k === 'airJumps' ? 'int' : 'number', { default: s.default, range: [s.min, s.max], points: s.points, doc: s.help })]));

// ── MovementDef (§2.2.5) ────────────────────────────────────────────────────
export const MOVEMENT_MODES = {
  hover: {
    cost: 2,
    params: {
      button: f('enum', { values: ACTION_BUTTONS, default: 'jump' }), frames: f('int', { default: 90, range: [1, 120] }),
      fallSpeed: f('number', { default: 1.5, range: [1.0, 4] }), drift: f('number', { default: 1, range: [0.5, 1.2] }),
    },
  },
  glide: {
    cost: 2,
    params: {
      button: f('enum', { values: ACTION_BUTTONS, default: 'jump' }), frames: f('int', { default: 120, range: [1, 150] }),
      fallSpeed: f('number', { default: 1.6, range: [1.2, 4] }), speed: f('number', { default: 1.15, range: [1, 1.3], doc: '× airSpeed.' }),
      turn: f('number', { default: 0.05, range: [0, 0.1] }),
    },
  },
  fly: {
    cost: 6,
    params: {
      button: f('enum', { values: ACTION_BUTTONS, default: 'jump' }), fuel: f('int', { default: 90, range: [1, 180] }),
      thrust: f('number', { default: 0.6, range: [0.1, 0.9] }), maxRise: f('number', { default: 4, range: [1, 5] }),
    },
  },
  wallCling: {
    cost: 1,
    params: {
      frames: f('int', { default: 45, range: [1, 60] }), wallJump: f('bool', { default: true }),
      jumpVx: f('number', { default: 6, range: [0, 8] }), jumpVy: f('number', { default: 11, range: [0, 14] }),
    },
  },
  crawl: {
    cost: 2,
    params: {
      frames: f('int', { default: 90, range: [1, 120] }),
      speed: f('number', { defaultDoc: '0.6 × runSpeed', range: [1, '0.8×runSpeed'] }),
    },
  },
};
/** Default crawl speed as a fraction of the form's runSpeed. */
export const CRAWL_SPEED_DEFAULT = 0.6;

// ── ResourceDef (§2.2.6) ────────────────────────────────────────────────────
export const RESOURCE_FIELDS = {
  min: f('number', { default: 0 }),
  max: f('number', { range: [1, 1000], defaultDoc: '100 (with a note) if missing' }),
  start: f('number', { defaultDoc: 'max' }),
  regen: f('number', { default: 0, doc: 'Per frame.' }),
  regenDelay: f('int', { default: 0, doc: 'Frames after the last spend before regen resumes.' }),
  regenWhen: f('string', { default: 'always', values: ['always', 'grounded', 'airborne', 'form:<name>'] }),
  decay: f('number', { default: 0, doc: 'Per frame toward min.' }),
  onHit: f('object', { of: '{perDamage}', default: null }),
  onHurt: f('object', { of: '{perDamage}', default: null }),
  soak: f('object', { of: '{fraction [0..0.5], costPerDamage ≥0.5, forms?}', default: null, doc: 'Plating: budgeted mitigation (§4.2.6).' }),
  resetOnRespawn: f('bool', { default: true }),
  sync: f('bool', { default: true }),
  hud: f('object', { of: '{style, label, color, forms}', defaultDoc: '{style: "bar", label: name}' }),
};
export const RES_SOAK_FIELDS = { fraction: f('number', { range: [0, 0.5], default: 0.25 }), costPerDamage: f('number', { range: [0.5, Infinity], default: 1 }), forms: f('list', { ref: 'form', default: null }) };
export const RES_HUD_FIELDS = { style: f('enum', { values: HUD_STYLES, default: 'bar' }), label: f('string'), color: f('string', { default: null }), forms: f('list', { ref: 'form', default: null }) };
export const PER_DAMAGE_FIELDS = { perDamage: f('number', { default: 0 }) };

// ── HitTemplate (§2.2.7) ────────────────────────────────────────────────────
export const HIT_FIELDS = {
  kind: f('enum', { values: HIT_KINDS, default: 'strike' }),
  damage: f('number', { defaultDoc: 'strike: required (4 with a note); other kinds: 0' }),
  angle: f('number', { defaultDoc: 'strike: 45; other kinds: 0', doc: 'Degrees, 0 = forward, 90 = up, 270 = spike.' }),
  knockback: f('number', { defaultDoc: 'strike: 20; other kinds: 0' }),
  growth: f('number', { defaultDoc: 'strike: 60; other kinds: 0' }),
  setKnockback: f('number', { default: null, range: [0, 120], doc: 'Fixed knockback (ignores %).' }),
  effect: f('string', { defaultDoc: "the move's effect, else 'normal'", doc: 'Open vocabulary (art); the 14 v1 names keep presets.' }),
  status: f('any', { of: 'string | {name, frames?, power?}', default: null, ref: 'status' }),
  shieldMul: f('number', { default: 1, range: [0.5, 1.5] }),
  hitlagMul: f('number', { default: 1, range: [0.5, 1.5] }),
  push: f('number', { default: 0, range: [0, 6], doc: 'Wind only, px/frame per axis (cap 6).' }),
  windDir: f('enum', { values: WIND_DIRS, default: 'facing', doc: "Wind only. facing: along the source's facing (entities: travel direction when free-flying); away / toward: from / to the box center (2D: pull, vacuum, gravity well); angle: along `angle` (90 = updraft). Offstage targets below the KO floor are never pushed farther out, up past ~360 px or down." }),
  tier: f('enum', { values: TIER_NAMES, default: null, doc: 'Default: inherited from the move/entity/script context.' }),
};
/** Extra fields an action/entity hitbox may carry on top of Shape + HitTemplate. */
export const HITBOX_FIELDS = {
  start: f('int', { defaultDoc: 'action: category minStartup; entity: 0' }),
  end: f('int', { defaultDoc: 'action: start + 3; entity: life' }),
  group: f('int', { defaultDoc: 'list index (v1 files: 0)', doc: 'Each group hits each target once (per rehit window).' }),
  use: f('ref', { ref: 'template', default: null, defaultDoc: '— (inline fields; E013 if it names an unknown template)', doc: 'Template name; inline fields override it.' }),
  rehit: f('int', { default: null, range: [3, Infinity], doc: 'Re-hit every N frames.' }),
  onHit: f('list', { of: 'TimelineAction', default: [] }),
  counterScale: f('bool', { default: false, doc: 'Scale damage with the countered hit (§3.6.3).' }),
  air: f('bool', { default: false, doc: 'Grab boxes only: also grab airborne targets.' }),
};

// ── Action (§2.2.8) ─────────────────────────────────────────────────────────
export const ACTION_FIELDS = {
  name: f('string', { defaultDoc: 'pool key', range: [1, 24] }),
  category: f('enum', { values: CATEGORY_NAMES, defaultDoc: 'category of the first trigger routed to it, else special' }),
  duration: f('int', { required: 'E017', range: ['minDuration', 150] }),
  hitboxes: f('list', { of: 'Hitbox', default: [] }),
  timeline: f('list', { of: 'TimelineEntry', default: [] }),
  velocity: f('list', { of: '{start, end, vx?, vy?, mode?, untilGrounded?, airOnly?}', default: [] }),
  projectiles: f('list', { of: 'v1 projectile', default: [], doc: 'Converted to entities plus spawn entries (§8).' }),
  intangible: f('window', { default: null, doc: '[s, e] or [s, e][]; ≤ 12 frames per action.' }),
  armor: f('list', { of: '{from, to, threshold}', default: [], range: { threshold: [0, 12] } }),
  hurtboxes: f('list', { of: '{from, to, set?, shapes?}', default: [] }),
  gravity: f('list', { of: '{from, to, scale}', default: [], range: { scale: [0.3, 1.5] } }),
  landingLag: f('int', { defaultDoc: 'aerials: 10; others: engine default' }),
  helpless: f('bool', { defaultDoc: 'true only when routed from upSpecial' }),
  oncePerAirtime: f('bool', { defaultDoc: 'true only when routed from sideSpecial' }),
  cost: f('map', { of: 'number', ref: 'resource', default: null }),
  requires: f('object', { of: '{form?, grounded?, airborne?, resource?, var?}', default: null }),
  else: f('ref', { ref: 'move', default: null }),
  hold: f('object', { of: '{button, from, to, max, release?}', default: null }),
  charge: f('object', { of: '{button, at, max}', defaultDoc: "smash: {button: 'strong', at: startup − 3, max: 60}" }),
  cancels: f('list', { of: '{from, to, into, onHit?, button?}', default: [] }),
  next: f('ref', { ref: 'move', default: null }),
  counter: f('object', { of: '{from, to, then, mul}', default: null }),
  onAbsorb: f('list', { of: 'TimelineAction', default: [] }),
  throw: f('object', { of: '{holdAt?: {x, y}}', default: null }),
  anim: f('string', { default: null, doc: 'Opaque string passed to art.' }),
  pose: f('any', { default: null, doc: 'Humanoid helper only.' }),
  effect: f('string', { default: null, doc: 'Presentation; also the default effect of its hitboxes.' }),
  color: f('string', { default: null }),
  sound: f('any', { default: null, doc: 'Presentation (sound key for art).' }),
  description: f('string', { default: '', doc: 'Docs / showcase text.' }),
  update: f('fn', { default: null, doc: '(view, api) => void, per frame after the timeline.' }),
};
export const VELOCITY_FIELDS = {
  start: f('int', { default: 1 }), end: f('int', { defaultDoc: 'start' }), vx: f('number', { default: null }), vy: f('number', { default: null }),
  mode: f('enum', { values: ['set', 'add'], default: 'set' }), untilGrounded: f('bool', { default: false }),
  airOnly: f('bool', { default: false, doc: 'Only applies while airborne (grounded moves never lift off).' }),
};
export const HOLD_FIELDS = {
  button: f('enum', { values: ACTION_BUTTONS, defaultDoc: "special for specials, strong for smashes, else attack" }),
  from: f('int'), to: f('int'), max: f('int', { default: 120, range: [1, 600] }),
  release: f('any', { of: 'moveName | frame', default: null }),
};
export const CHARGE_FIELDS = {
  button: f('enum', { values: ACTION_BUTTONS, default: 'strong' }), at: f('int', { defaultDoc: 'max(1, startup − 3)' }),
  max: f('int', { default: 60, range: [1, 60] }),
};
export const CANCEL_FIELDS = {
  from: f('int'), to: f('int'), into: f('list', { of: 'moveName | Trigger | jump | shield | any' }),
  onHit: f('bool', { default: false }), button: f('enum', { values: ACTION_BUTTONS, default: null }),
};
export const COUNTER_FIELDS = { from: f('int'), to: f('int'), then: f('ref', { ref: 'move' }), mul: f('number', { default: 1.2, range: [1, 1.3] }) };
export const REQUIRES_FIELDS = {
  form: f('ref', { ref: 'form' }), grounded: f('bool'), airborne: f('bool'),
  resource: f('map', { of: 'number', ref: 'resource' }), var: f('map', { of: 'any', ref: 'var' }),
};
export const ARMOR_WINDOW_FIELDS = { from: f('int'), to: f('int'), threshold: f('number', { range: [0, 12] }) };
export const HURT_WINDOW_FIELDS = { from: f('int'), to: f('int'), set: f('string', { default: null }), shapes: f('shapes', { default: null }) };
export const GRAVITY_WINDOW_FIELDS = { from: f('int'), to: f('int'), scale: f('number', { default: 1, range: [0.3, 1.5] }) };
export const THROW_FIELDS = { holdAt: f('object', { of: '{x, y}', defaultDoc: 'grab box center' }) };

// ── Timeline (§2.2.9) ───────────────────────────────────────────────────────
export const TIMELINE_TIMING = {
  at: f('int'), from: f('int'), to: f('int'), every: f('int', { default: 1 }), onLand: f('bool'), onHit: f('bool'),
};
/**
 * Timeline actions. `primary` names the param the action key's value fills when
 * it isn't an object (`{at: 12, spawn: 'ionBeam', x: 30}` → entity = 'ionBeam');
 * other params are siblings, or the value itself when it is an object
 * (`{steer: {speed: 11, turn: 0.18}}`).
 */
export const TIMELINE_ACTIONS = {
  spawn: { primary: 'entity', governedBy: 'entity budget (§4.2.8)', params: {
    entity: f('ref', { ref: 'entity', required: 'E012' }), x: f('number', { default: 0 }), y: f('number', { default: 0 }),
    vx: f('number', { default: null }), vy: f('number', { default: null }), count: f('int', { default: 1, range: [1, 5] }),
    spread: f('number', { default: 0 }), aimAt: f('enum', { values: ['nearestEnemy'], default: null }), bindToMove: f('bool', { default: false }),
  } },
  velocity: { primary: null, governedBy: 'speed cap, rise budget', params: {
    vx: f('number', { default: null }), vy: f('number', { default: null }), mode: f('enum', { values: ['set', 'add'], default: 'set' }),
    untilGrounded: f('bool', { default: false }), airOnly: f('bool', { default: false }),
  } },
  impulse: { primary: null, governedBy: 'speed cap, rise budget', params: { vx: f('number', { default: 0 }), vy: f('number', { default: 0 }) } },
  steer: { primary: null, governedBy: 'speed cap, rise budget', params: { speed: f('number', { default: 8, range: [0, 12] }), turn: f('number', { default: 0.1, range: [0, 0.3] }) } },
  teleport: { primary: null, governedBy: '≤ 200 px, 1 per airtime, rise budget', params: {
    dx: f('number', { default: 0 }), dy: f('number', { default: 0 }), relative: f('enum', { values: ['facing', 'world'], default: 'facing' }),
  } },
  hit: { primary: 'template', governedBy: 'template caps plus the Governor', params: {
    template: f('ref', { ref: 'template', required: 'E013' }), shape: f('enum', { values: SHAPE_KINDS }), frames: f('int', { default: 1 }), group: f('int', { default: null }),
    x: f('number'), y: f('number'), r: f('number'), w: f('number'), h: f('number'), x1: f('number'), y1: f('number'), x2: f('number'), y2: f('number'),
  } },
  resource: { primary: null, governedBy: 'none (own state)', params: { name: f('ref', { ref: 'resource' }), add: f('number', { default: null }), set: f('number', { default: null }) } },
  cost: { primary: null, governedBy: 'none', params: {}, map: true, doc: '{cost: {res: n}}' },
  form: { primary: 'form', governedBy: 'form cooldown (45 f)', params: { form: f('ref', { ref: 'form' }) } },
  status: { primary: 'status', governedBy: 'status caps', params: { status: f('ref', { ref: 'status' }) } },
  armor: { primary: null, governedBy: 'armor budget', params: { frames: f('int', { default: 10 }), threshold: f('number', { default: 6, range: [0, 12] }) } },
  intangible: { primary: 'frames', governedBy: 'intangibility budget', params: { frames: f('int', { range: [1, 20] }) } },
  facing: { primary: 'facing', governedBy: 'none', params: { facing: f('enum', { values: ['turn', 'toward'] }) } },
  release: { primary: 'template', governedBy: 'throw caps', inlineHit: true, params: { template: f('ref', { ref: 'template', required: 'E013' }) } },
  endIf: { primary: null, governedBy: 'none', params: { resource: f('object', { of: '{name, below}' }), grounded: f('bool'), airborne: f('bool') } },
  goto: { primary: 'frame', governedBy: '≤ 8 loops per action instance', params: { frame: f('int') } },
  emit: { primary: 'name', governedBy: 'fx budget', params: { name: f('string'), data: f('any', { default: null, doc: 'JSON, ≤ 256 B.' }) } },
  sfx: { primary: 'sound', governedBy: 'sound budget', params: { sound: f('string') } },
  camera: { primary: null, governedBy: 'none', params: { shake: f('number', { default: 0, range: [0, 8] }) } },
};
export const TIMELINE_ACTION_KEYS = Object.keys(TIMELINE_ACTIONS);

// ── StatusDef (§2.2.10) and built-ins ──────────────────────────────────────
export const STATUS_MOD_RANGES = {
  speed: [0.6, 1.25], jump: [0.7, 1.2], gravity: [0.5, 1.4], fallSpeed: [0.7, 1.3], damageIn: [0.85, 1.15], damageOut: [0.8, 1.15], knockbackIn: [0.85, 1.2],
};
export const STATUS_MOD_KEYS = Object.keys(STATUS_MOD_RANGES);
export const STATUS_FIELDS = {
  frames: f('int', { range: [1, 300], defaultDoc: '120 (with a note) if missing' }),
  stack: f('enum', { values: STACK_MODES, default: 'refresh' }),
  maxStacks: f('int', { default: 1, range: [1, 3] }),
  mods: f('object', { of: 'StatusMods', default: {}, range: STATUS_MOD_RANGES }),
  dot: f('object', { of: '{every ≥15, damage ≤0.5}', default: null }),
  control: f('enum', { values: CONTROL_KINDS, default: null }),
  heal: f('object', { of: '{every, amount}', default: null, doc: 'Self statuses only; mitigation budget.' }),
  visual: f('string', { default: null }), tint: f('string', { default: null }), icon: f('string', { default: null }),
};
export const BUILTIN_STATUSES = {
  burn: { frames: 120, dot: { every: 15, damage: 0.5 }, visual: 'burn' },
  poison: { frames: 240, dot: { every: 30, damage: 0.5 }, visual: 'poison' },
  freeze: { frames: 30, control: 'freeze', visual: 'freeze' },
  stun: { frames: 24, control: 'stun', visual: 'stun' },
  slow: { frames: 120, mods: { speed: 0.7 }, visual: 'slow' },
  root: { frames: 45, control: 'root', visual: 'root' },
  silence: { frames: 90, control: 'silence', visual: 'silence' },
  confuse: { frames: 60, control: 'confuse', visual: 'confuse' },
  weaken: { frames: 180, mods: { damageOut: 0.85 }, visual: 'weaken' },
  vulnerable: { frames: 180, mods: { damageIn: 1.1 }, visual: 'vulnerable' },
  float: { frames: 90, mods: { gravity: 0.6 }, visual: 'float' },
  mark: { frames: 300, visual: 'mark' },
};

// ── EntityDef (§2.2.11) ─────────────────────────────────────────────────────
const ENTITY_LIST_DOC = 'Runs spawn, emit, sfx, camera, resource, status, hit (a template box on the entity) and form / velocity / impulse (on the owner, through its normal gates); other actions are removed (W415).';
export const ENTITY_FIELDS = {
  kind: f('enum', { values: ENTITY_KINDS, defaultDoc: "'projectile' (with a note)" }),
  shape: f('shape', { defaultDoc: 'circle r 10' }),
  life: f('int', { defaultDoc: '60 (with a note)' }),
  hp: f('number', { default: 0, doc: '0 = no hp (clanks unless clank:false).' }),
  maxAlive: f('int', { default: null, range: [1, 8] }),
  maxHits: f('int', { default: 1, defaultDoc: 'projectile/trap: 1 (+ pierce); other kinds: unlimited', doc: 'Hits before the entity is spent. On minion/zone/beam/part/clone a value ≤ 1 means unlimited (they end by life/hp; rehit still gates repeats).' }),
  pierce: f('int', { default: 0 }),
  motion: f('object', { of: 'Motion', defaultDoc: 'by kind: projectile linear, minion walker, beam/part attached, clone mimic, trap/zone stationary' }),
  collide: f('enum', { values: COLLIDE_MODES, default: 'die' }),
  platforms: f('bool', { default: false }),
  maxBounces: f('int', { default: 3 }),
  hitboxes: f('list', { of: 'Shape & HitTemplate & {start?, end?, use?, rehit?}', default: [] }),
  hurtbox: f('shapes', { defaultDoc: '[shape] if hp > 0, else none' }),
  relay: f('number', { default: 1, range: [0.5, 1], doc: 'Parts only.' }),
  length: f('number', { default: null, range: [0, 520], doc: 'Beams.' }),
  width: f('number', { default: null, range: [0, 24], doc: 'Beams.' }),
  anchor: f('object', { of: '{x, y}', default: null }),
  reflectable: f('bool', { default: true }), absorbable: f('bool', { default: true }),
  clank: f('bool', { default: true }), clash: f('bool', { default: false }),
  every: f('object', { of: '{frames ≥30, spawn, x?, y?, vx?, vy?, aim?}', default: null }),
  onSpawn: f('list', { of: 'TimelineAction', default: [], doc: ENTITY_LIST_DOC }), onHit: f('list', { of: 'TimelineAction', default: [], doc: ENTITY_LIST_DOC }),
  onExpire: f('list', { of: 'TimelineAction', default: [], doc: ENTITY_LIST_DOC }), onDeath: f('list', { of: 'TimelineAction', default: [], doc: ENTITY_LIST_DOC }),
  think: f('fn', { default: null, doc: '(view, e, api) => void. api.hit here strikes from the entity (its kind\'s caps).' }),
  scale: f('number', { default: 1, range: [0.5, 1], doc: 'Clones: hurtbox scale.' }),
  render: f('object', { of: '{style?, color?, color2?, spin?}', default: {} }),
  tier: f('enum', { values: TIER_NAMES, default: null, doc: 'Default ENTITY_LIMITS[kind].tier.' }),
  vars: f('object', { of: '{[k]: number|boolean|string}', default: null, doc: 'Per-entity vars (≤ 4 keys), set from think with api.evars.set.' }),
};
export const MOTION_FIELDS = {
  type: f('enum', { values: MOTION_TYPES }), speed: f('number'), accel: f('number'), maxSpeed: f('number'), gravity: f('number'),
  turn: f('number', { range: [0, 0.12] }), wobble: f('number'), target: f('enum', { values: ['nearestEnemy', 'owner'] }), delay: f('int'),
  radius: f('number'), around: f('enum', { values: ['owner'] }), offset: f('object', { of: '{x, y}' }), snapToGround: f('bool'),
  out: f('int'), back: f('number'),
};
export const EVERY_FIELDS = {
  frames: f('int', { range: [30, Infinity] }), spawn: f('ref', { ref: 'entity', required: 'E012' }),
  x: f('number', { default: 0 }), y: f('number', { default: 0 }), vx: f('number', { default: null }), vy: f('number', { default: null }),
  aim: f('enum', { values: ['nearestEnemy'], default: null }),
};

// ── FormDef (§2.2.12), Hooks (§2.2.13), AIHints (§2.2.14) ──────────────────
export const FORM_FIELDS = {
  stats: f('object', { of: 'Partial<StatsDef>', doc: 'Unspecified stats inherit from base.' }),
  body: f('object', { of: 'BodyDef', doc: 'Defaults to the base body.' }),
  movement: f('object', { of: 'MovementDef', doc: 'Merged over base movement per mode; a mode set to null/false is removed.' }),
  slots: f('map', { of: 'string|SlotFn', required: 'E011' }),
  armor: f('object', { of: '{threshold}', doc: 'Passive armor for this form (default: base body.armor).' }),
  art: f('string', { defaultDoc: 'form name', doc: 'art.forms key.' }),
};
export const HOOKS = ['init', 'tick', 'onHit', 'onHurt', 'onLand', 'onKO', 'onRespawn', 'onFormChange'];
export const AI_FIELDS = {
  preferredRange: f('number', { default: null }), zoning: f('bool', { default: false }),
  recovery: f('any', { of: 'string[] | {[form]: string[]}', default: null, ref: 'move' }),
  prefer: f('list', { ref: 'move', default: [] }), avoid: f('list', { ref: 'move', default: [] }),
  grapple: f('bool', { default: false }), hint: f('fn', { default: null, doc: '(view) => null | {press?, hold?}: a trigger name (jab … downSpecial, or grab), routed through slots; other names do nothing. hold = keep pressing it for 20 frames. Evaluated every ≤ 10 frames, followed ~60% of the time.' }),
};

// ── ArtDef (§6.1) — documentation only; art is client-side and unchecked here ─
export const ARTDEF_FIELDS = {
  rig: f('enum', { values: ['humanoid', 'none'], defaultDoc: "'humanoid' if no draw()" }), bounds: f('object'), palette: f('object'), palettes: f('list'),
  assets: f('map'), sheets: f('map'), clips: f('map'), init: f('fn'), draw: f('fn'), drawBack: f('fn'), drawWorld: f('fn'),
  entities: f('map'), projectile: f('fn'), trail: f('fn'), fx: f('object'), sounds: f('map'), portrait: f('any'), hud: f('fn'), forms: f('map'),
};

// ── Note codes owned by the schema layer (§4.1.6 errors, §4.1.7 I-notes) ──
export const NOTE_CODES = {
  E001: { severity: 'error', why: 'bad, missing or mismatched id', fix: 'use lowercase letters/digits/dashes (2–24 chars, starting with a letter) matching the folder name.' },
  E002: { severity: 'error', why: 'missing name', fix: "add name: 'Your Name' (≤ 18 characters)." },
  E003: { severity: 'error', why: 'module default is not an object', fix: 'export default defineCharacter({ ... }).' },
  E004: { severity: 'error', why: 'import or throw at load time', fix: 'remove top-level side effects; character files must only declare data and functions.' },
  E010: { severity: 'error', why: 'a slots value names a missing move, or is neither a string nor a function', fix: 'point the slot at a key of moves, or use (view) => name.' },
  E011: { severity: 'error', why: 'startForm or a form slot references something unknown', fix: 'declare the form under forms, or point the slot at a key of moves.' },
  E012: { severity: 'error', why: 'an entity reference (spawn, every, onExpire) is unknown', fix: 'declare the entity under entities.' },
  E013: { severity: 'error', why: 'a hit template referenced by use/hit/release is unknown', fix: 'declare it under hitboxes, or write the hit fields inline.' },
  E014: { severity: 'error', why: 'a timeline entry has zero or multiple action keys', fix: 'split it into one entry per action (spawn, velocity, hit, emit, …).' },
  E015: { severity: 'error', why: 'a function where data is required, or a non-function where a function is required', fix: 'only update, think, behavior.*, slot functions and ai.hint may be functions.' },
  E016: { severity: 'error', why: 'a vars initializer is non-serializable or of a bad type', fix: 'vars may only hold finite numbers, booleans or strings.' },
  E017: { severity: 'error', why: 'a move duration is missing or not a number', fix: 'add duration: <frames> (60 = one second).' },
  E018: { severity: 'error', why: 'a name collides with a built-in JavaScript property (constructor, toString, __proto__, …)', fix: 'rename it, e.g. constructor → builder.' },
  I001: { severity: 'info', why: 'unknown field (kept, not used by the engine)', fix: 'check the spelling, or remove it.' },
  I002: { severity: 'info', why: 'a trigger has no move, so a generic move is used', fix: 'add a move with that name, or route the trigger with slots.' },
  I003: { severity: 'info', why: 'grab/throws/taunt fall back to generic moves', fix: 'add moves named grab, pummel, fthrow, bthrow, uthrow, dthrow, taunt to customize them.' },
  I004: { severity: 'info', why: 'a missing or malformed value was replaced by its default', fix: 'set it explicitly.' },
  I005: { severity: 'info', why: 'unknown reference (ignored at runtime)', fix: 'check the spelling of the move/status/resource/form/var name.' },
  I006: { severity: 'info', why: 'move is not reachable from any trigger, else, next, cancel, hold or counter', fix: 'route it with slots, or call api.startMove from a script. Moves a slot function returns as a literal name (\'majorChord\') count as routed from its trigger.' },
  I007: { severity: 'info', why: 'v1 character file converted to v2 (no changes needed)', fix: 'optional: npm run migrate -- <id>.' },
  I008: { severity: 'info', why: 'a custom status overrides a built-in status', fix: 'rename it if you meant a new status.' },
  I009: { severity: 'info', why: 'effect name is close to a v1 preset', fix: 'effects are open vocabulary; fix the spelling to get the preset.' },
  I010: { severity: 'info', why: 'v1 move key is not a slot, so it is never used', fix: 'rename it to a slot name.' },
};

// Schema tables are read-only. Must stay the LAST statement.
import * as self from './schema.js'; deepFreezeAll(self);
