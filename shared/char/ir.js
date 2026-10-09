// ─────────────────────────────────────────────────────────────────────────────
// IR — the one shape the simulation, AI, snapshot and art host read.
//
//   const { draft } = normalize(def, {expectedId});   // normalize-v2.js
//   ...scalers clamp `draft` in place (shared/balance/v2/*)...
//   const ir = buildIR(draft, { report });            // then deepFreeze(ir)
//
// buildIR is structural only: it derives per-action timing (startup, active
// end, smash charge frame) from the FINAL numbers, adds built-in statuses,
// sorts every keyed map into name tables (§3.2: no logic may depend on object
// key order) and attaches a base report (AI metadata, §9 WP-O). It never
// clamps, never runs character code, and returns a fresh, UNFROZEN object
// (the validator freezes it).
//
// Conventions for every consumer:
//  - Units px/frames; y down; body-local +x = forward (mirror by facing).
//  - Optional numbers are `null` (never undefined). Lists are always arrays.
//  - Frames are integers. Hitbox windows are inclusive: start ≤ t ≤ end.
//  - `extra` (optional, on any record) holds unknown author fields: ignore it.
//  - Iterate keyed maps through `ir.tables.*` (sorted), never Object.keys order.
// ─────────────────────────────────────────────────────────────────────────────
import { TRIGGERS, BUILTIN_STATUSES } from './schema.js';
import { normStatus, shapesAABB } from './normalize-v2.js';

const sorted = (o) => Object.keys(o || {}).sort();
const indexOf = (list) => Object.fromEntries(list.map((n, i) => [n, i]));

/**
 * Timing derived from an action's final numbers (§6.2 phases).
 * Active sources: hitboxes, and `spawn` / `hit` / `release` timeline entries with a frame.
 * @param {IRAction} a
 * @returns {{startup: number, activeEnd: number|null}}  startup = first active frame (duration if none, v1 rule).
 */
export function actionTiming(a) {
  const starts = [];
  const ends = [];
  for (const h of a.hitboxes) { starts.push(h.start); ends.push(h.end); }
  for (const e of a.timeline) {
    if (e.action !== 'spawn' && e.action !== 'hit' && e.action !== 'release') continue;
    if (e.when === 'at') { starts.push(e.at); ends.push(e.at + (e.action === 'hit' ? Math.max(1, e.args.frames) - 1 : 0)); }
    else if (e.when === 'range') { starts.push(e.from); ends.push(e.to); }
  }
  return { startup: starts.length ? Math.min(...starts) : a.duration, activeEnd: ends.length ? Math.max(...ends) : null };
}

/**
 * Build the IR from a normalized (and optionally scaled) draft.
 * @param {import('./normalize-v2.js').Draft} draft
 * @param {{report?: object}} [opts]  report from the validator; merged over the base report (per move, too).
 * @returns {IR}
 */
export function buildIR(draft, { report = null } = {}) {
  if (!draft) return null;
  const formOrder = [...draft.formOrder];

  // Routes: which (form, trigger) pairs reach each move statically.
  const routes = {};
  for (const f of formOrder) {
    for (const t of TRIGGERS) {
      const n = draft.forms[f].slots[t];
      (routes[n] ||= { triggers: [], pairs: [] });
      if (!routes[n].triggers.includes(t)) routes[n].triggers.push(t);
      routes[n].pairs.push({ form: f, trigger: t });
    }
  }

  const moves = {};
  for (const n of sorted(draft.moves)) {
    const a = draft.moves[n];
    const { startup, activeEnd } = actionTiming(a);
    const charge = a.charge && a.charge.auto ? { ...a.charge, at: Math.max(1, startup - 3) } : a.charge;
    moves[n] = { ...a, routes: routes[n] ? [...routes[n].triggers] : [], startup, activeEnd, charge };
  }

  const forms = {};
  for (const f of formOrder) {
    const src = draft.forms[f];
    forms[f] = {
      stats: src.stats, body: src.body, movement: src.movement, slots: src.slots, slotFns: src.slotFns,
      armor: src.armor, art: src.art, hurtSets: ['default', ...sorted(src.body.hurtboxes).filter((s) => s !== 'default')],
    };
    if (src.extra) forms[f].extra = src.extra;
  }

  const statuses = {};
  const allStatus = { ...BUILTIN_STATUSES, ...draft.statuses };
  for (const n of sorted(allStatus)) {
    statuses[n] = draft.statuses[n] ? { ...draft.statuses[n], builtin: false } : { ...normStatus(BUILTIN_STATUSES[n], `statuses.${n}`), builtin: true };
  }
  const pick = (o) => Object.fromEntries(sorted(o).map((n) => [n, o[n]]));
  const hitboxes = pick(draft.hitboxes);
  const entities = pick(draft.entities);

  const tables = {
    triggers: [...TRIGGERS],
    forms: formOrder,
    moves: Object.keys(moves),
    entities: Object.keys(entities),
    statuses: Object.keys(statuses),
    resources: Object.keys(draft.resources),          // declared order (f.res Float64Array layout, §3.3)
    vars: sorted(draft.vars),
    sync: [...draft.sync],
    hitboxes: Object.keys(hitboxes),
  };
  tables.index = {
    forms: indexOf(tables.forms), moves: indexOf(tables.moves), entities: indexOf(tables.entities), statuses: indexOf(tables.statuses),
    resources: indexOf(tables.resources), vars: indexOf(tables.vars), hitboxes: indexOf(tables.hitboxes),
  };

  const base = baseReport(draft, moves, routes);
  const merged = { ...base, ...(report || {}) };
  merged.moves = {};
  for (const n of tables.moves) merged.moves[n] = { ...base.moves[n], ...(report?.moves?.[n] || {}) };

  /** @type {IR} */
  const ir = {
    id: draft.id,
    version: draft.sourceVersion,
    meta: { name: draft.name, author: draft.author, description: draft.description, archetype: draft.archetype, startForm: draft.startForm },
    forms,
    moves,
    hitboxes,
    entities,
    statuses,
    resources: draft.resources,
    vars: draft.vars,
    sync: draft.sync,
    behavior: draft.behavior,
    ai: draft.ai,
    tables,
    report: merged,
    generics: [...draft.generics],
    legacy: draft.legacy,
  };
  if (draft.extra) ir.extra = draft.extra;
  return ir;
}

function baseReport(draft, moves, routes) {
  const recoveryNames = new Set();
  const rec = draft.ai.recovery;
  if (Array.isArray(rec)) rec.forEach((n) => recoveryNames.add(n));
  else if (rec) Object.values(rec).forEach((l) => l.forEach((n) => recoveryNames.add(n)));
  const out = { moves: {}, runtimeGoverned: [] };
  for (const [n, a] of Object.entries(moves)) {
    const shapes = [...a.hitboxes];
    for (const e of a.timeline) if (e.action === 'hit') shapes.push(e.args.shape);
    const box = shapesAABB(shapes);
    const spawns = [];
    for (const e of a.timeline) if (e.action === 'spawn' && !spawns.includes(e.args.entity)) spawns.push(e.args.entity);
    const trig = routes[n]?.triggers || [];
    out.moves[n] = {
      category: a.category, startup: a.startup, activeEnd: a.activeEnd, duration: a.duration,
      reachBox: box, spawns,
      isRecovery: trig.includes('upSpecial') || recoveryNames.has(n) || a.helpless,
      isGrab: a.category === 'grab' || a.hitboxes.some((h) => h.kind === 'grab'),
      isThrow: a.category === 'throw',
      scripted: !!a.update,
      routes: routes[n] ? routes[n].pairs.map((p) => `${p.form}:${p.trigger}`) : [],
      generic: !!a.generic,
    };
    if (a.update) out.runtimeGoverned.push(`moves.${n}.update`);
  }
  for (const [h, fn] of Object.entries(draft.behavior)) if (typeof fn === 'function') out.runtimeGoverned.push(`behavior.${h}`);
  for (const [n, e] of Object.entries(draft.entities)) if (e.think) out.runtimeGoverned.push(`entities.${n}.think`);
  return out;
}

// ── IR typedefs (the contract for WP-C/E/F/G/H/I/J/K/O) ─────────────────────

/**
 * @typedef {object} IR
 * @property {string} id
 * @property {1|2} version          SOURCE format: 1 = converted v1 file (use the v1 rules path / legacy art), 2 = v2 file.
 * @property {{name: string, author: string, description: string, archetype: string, startForm: string}} meta
 * @property {Object<string, IRForm>} forms     Always has 'base'. Order: tables.forms.
 * @property {Object<string, IRAction>} moves   The pool, incl. generic moves (sorted keys).
 * @property {Object<string, IRHit>} hitboxes   Named templates (for api.hit / timeline hit / release).
 * @property {Object<string, IREntity>} entities  Incl. auto entities `${move}#p${i}` from v1 projectiles.
 * @property {Object<string, IRStatus>} statuses  Built-ins + custom (custom overrides built-in).
 * @property {Object<string, IRResource>} resources  Declared order.
 * @property {Object<string, number|boolean|string>} vars  Initial values (reset on respawn).
 * @property {string[]} sync        Var names sent to clients.
 * @property {IRBehavior} behavior
 * @property {IRAI} ai
 * @property {IRTables} tables
 * @property {IRReport} report
 * @property {string[]} generics    Triggers that got a generic move (also flagged `generic: true` on the move).
 * @property {IRLegacy|null} legacy  Non-null only for v1 files.
 * @property {object} [extra]       Unknown top-level author fields (kept, ignore).
 * Added by the validator (shared/balance/validate.js finalizeIR) — read-only compat mirrors (same objects):
 * @property {string} name          = meta.name
 * @property {string} author        = meta.author
 * @property {string} description   = meta.description
 * @property {object} stats         = forms.base.stats (incl. width/height, see IRForm.stats)
 * @property {IRBody} body          = forms.base.body
 * Art is NOT in the IR: the client reads `art` from the character module (art host, §6).
 * The validator returns the IR detached from the author's objects and deep-frozen.
 */

/**
 * A fully resolved form (inheritance from base already applied).
 * @typedef {object} IRForm
 * @property {{weight: number, runSpeed: number, airSpeed: number, jumpHeight: number, doubleJumpHeight: number,
 *   airJumps: number, gravity: number, fallSpeed: number, width: number, height: number}} stats
 *   Final (scaled) stats. width/height mirror body.collider w/h (v1: the exact v1 stats) for v1-era readers.
 *   Values are as the sim reads them; status mods are applied at runtime (fighter.effectiveStats).
 * @property {IRBody} body
 * @property {IRMovement} movement
 * @property {Record<string, string>} slots   EVERY trigger (tables.triggers) → pool move name (static mapping;
 *   a slot function's fallback). Always resolves to an existing ir.moves key.
 * @property {Record<string, Function>} slotFns  trigger → SlotFn (call under guard; non-pool result → use slots[t]).
 * @property {{threshold: number}|null} armor  Passive flinch armor for this form.
 * @property {string} art                     art.forms key.
 * @property {string[]} hurtSets              Hurtbox set names, 'default' first, rest sorted.
 */
/**
 * @typedef {object} IRBody
 * @property {{w: number, h: number}} collider
 * @property {Object<string, IRShape[]>} hurtboxes   Always has `default` and `crouch`; maybe `air` and custom sets.
 * @property {[number, number]} scaleRange
 */
/**
 * Normalized shape (body-local, feet origin). Exactly one of:
 * @typedef {{shape: 'circle', x: number, y: number, r: number}
 *   | {shape: 'capsule', x1: number, y1: number, x2: number, y2: number, r: number}
 *   | {shape: 'rect', x: number, y: number, w: number, h: number}} IRShape   rect x,y = center
 */
/**
 * Only enabled modes are present; every param filled.
 * @typedef {object} IRMovement
 * @property {{button: string, frames: number, fallSpeed: number, drift: number}} [hover]
 * @property {{button: string, frames: number, fallSpeed: number, speed: number, turn: number}} [glide]
 * @property {{button: string, fuel: number, thrust: number, maxRise: number}} [fly]
 * @property {{frames: number, wallJump: boolean, jumpVx: number, jumpVy: number}} [wallCling]
 * @property {{frames: number, speed: number}} [crawl]
 */

/**
 * Hit fields (templates, merged hitboxes, throw releases).
 * @typedef {object} IRHit
 * @property {'strike'|'grab'|'wind'|'reflect'|'absorb'} kind
 * @property {number} damage
 * @property {number} angle
 * @property {number} knockback
 * @property {number} growth
 * @property {number|null} setKnockback
 * @property {string} effect         Never null: hit's own, else the move's effect, else 'normal'.
 * @property {{name: string, frames: number|null, power: number|null}|null} status
 * @property {number} shieldMul
 * @property {number} hitlagMul
 * @property {number} push           Wind px/frame (0 otherwise).
 * @property {string|null} tier      null = inherit from context (move category / entity kind / script).
 */
/**
 * Action or entity hitbox: shape + window + merged hit fields (template already applied; `use` kept for reports).
 * @typedef {IRShape & IRHit & {start: number, end: number, group: number, use: string|null, rehit: number|null,
 *   onHit: IRTimelineEntry[], counterScale: boolean, air: boolean}} IRHitbox
 *   Hit key: rehit ? `${target}:${group}:${floor((t−start)/rehit)}` : `${target}:${group}` (§3.6.1).
 *   Entity hitbox start/end are entity ages.
 */

/**
 * Normalized timeline entry / timeline action. `args` by action:
 *   spawn {entity, x, y, vx|null, vy|null, count, spread, aimAt|null, bindToMove}
 *   velocity {vx|null, vy|null, mode: 'set'|'add', untilGrounded, airOnly}   impulse {vx, vy}   steer {speed, turn}
 *   teleport {dx, dy, relative: 'facing'|'world'}   hit {template, shape: IRShape, frames, group|null}
 *   resource {name, add|null, set|null}   cost {costs: {res: n}}   form {form}   status {status}
 *   armor {frames, threshold}   intangible {frames}   facing {facing: 'turn'|'toward'}
 *   release {template|null, hit: IRHit}   endIf {resource: {name, below}|null, grounded, airborne}
 *   goto {frame}   emit {name, data|null}   sfx {sound}   camera {shake}
 * @typedef {object} IRTimelineEntry
 * @property {'at'|'range'|'land'|'hit'|null} when  null inside TimelineAction lists (onHit/onAbsorb/onSpawn/onExpire/onDeath).
 * @property {number|null} at
 * @property {number|null} from
 * @property {number|null} to
 * @property {number|null} every   (range only; ≥ 1)
 * @property {string} action
 * @property {object} args
 */

/**
 * @typedef {object} IRAction
 * @property {string} key            Pool key (stale-move/hit bookkeeping id; v1: the slot name).
 * @property {string} name           Display name.
 * @property {string} category       Limits row + runtime tier.
 * @property {number} duration
 * @property {IRHitbox[]} hitboxes
 * @property {IRTimelineEntry[]} timeline   Source order. v2 `projectiles` → spawn entries at p.start. For v1 files
 *   (ir.version 1) the validator strips the auto-entity spawns again and keeps `projectiles` inline instead (below).
 * @property {object[]} [projectiles]  v1 files only, the 16 v1 slots: the exact v1 projectile records
 *   {start, x, y, vx, vy, gravity, life, r, damage, angle, knockback, growth, style, color, color2, spin}, spawned at
 *   p.start (actions.js contract). The matching entities `${key}#p${i}` (legacy.v1) stay in ir.entities for art/reference.
 * @property {{start: number, end: number, vx: number|null, vy: number|null, mode: 'set'|'add', untilGrounded: boolean, airOnly: boolean}[]} velocity
 *   v1 semantics: null = don't touch that axis; vx is forward (mirror by facing).
 * @property {[number, number][]} intangible  Windows (inclusive), possibly empty.
 * @property {{from: number, to: number, threshold: number}[]} armor
 * @property {{from: number, to: number, set: string|null, shapes: IRShape[]|null}[]} hurtboxes
 * @property {{from: number, to: number, scale: number}[]} gravity
 * @property {number|null} landingLag  Aerials: number; others null (engine default landing lag).
 * @property {boolean} helpless
 * @property {boolean} oncePerAirtime
 * @property {Object<string, number>|null} cost
 * @property {{form?: string, grounded?: boolean, airborne?: boolean, resource?: Object<string, number>, var?: Object<string, *>}|null} requires
 * @property {string|null} else
 * @property {{button: string, from: number, to: number, max: number, release: string|number|null}|null} hold
 * @property {{button: string, at: number, max: number, auto: boolean}|null} charge   auto: at = max(1, startup − 3) (v1 rule).
 * @property {{from: number, to: number, into: string[], onHit: boolean, button: string|null}[]} cancels
 * @property {string|null} next
 * @property {{from: number, to: number, then: string|null, mul: number}|null} counter
 * @property {IRTimelineEntry[]} onAbsorb
 * @property {{holdAt: {x: number, y: number}|null}|null} throw   holdAt null = grab box center.
 * @property {string|null} anim
 * @property {*} pose
 * @property {string|null} effect
 * @property {string|null} color
 * @property {*} sound
 * @property {string} description
 * @property {Function|null} update   (view, api) => void
 * @property {boolean} generic        Inserted by generics.js.
 * @property {string[]} routes        Triggers that statically route here (any form), TRIGGERS order.
 * @property {number} startup         First active frame (duration if none).
 * @property {number|null} activeEnd  Last active frame.
 */

/**
 * @typedef {object} IREntity
 * @property {'projectile'|'minion'|'trap'|'zone'|'beam'|'clone'|'part'} kind
 * @property {IRShape} shape
 * @property {number} life
 * @property {number} hp              0 = no hp.
 * @property {number|null} maxAlive
 * @property {number} maxHits
 * @property {number} pierce
 * @property {{type: string, speed?: number, accel?: number, maxSpeed?: number, gravity?: number, turn?: number, wobble?: number,
 *   target?: string|null, delay?: number, radius?: number, around?: string|null, offset?: {x: number, y: number}|null,
 *   snapToGround?: boolean, out?: number, back?: number}} motion   Only author-given motion params are present (engine defaults otherwise).
 * @property {'die'|'bounce'|'stick'|'walk'|'pass'} collide
 * @property {boolean} platforms
 * @property {number} maxBounces
 * @property {IRHitbox[]} hitboxes
 * @property {IRShape[]} hurtbox      [] = no hurtbox.
 * @property {number} relay
 * @property {number|null} length
 * @property {number|null} width
 * @property {{x: number, y: number}|null} anchor
 * @property {boolean} reflectable
 * @property {boolean} absorbable
 * @property {boolean} clank
 * @property {boolean} clash
 * @property {{frames: number, spawn: string, x: number, y: number, vx: number|null, vy: number|null, aim: string|null}|null} every
 * @property {IRTimelineEntry[]} onSpawn
 * @property {IRTimelineEntry[]} onHit
 * @property {IRTimelineEntry[]} onExpire
 * @property {IRTimelineEntry[]} onDeath
 * @property {Function|null} think
 * @property {number} scale
 * @property {object} render          {style?, color?, color2?, spin?, ...} passed to art.
 * @property {string|null} tier
 * @property {{v1: true, move: string, index: number}|null} legacy  v1 projectile origin (snapshot `projectiles` parity).
 */

/**
 * @typedef {object} IRStatus
 * @property {number} frames
 * @property {'refresh'|'add'|'ignore'} stack
 * @property {number} maxStacks
 * @property {{speed?: number, jump?: number, gravity?: number, fallSpeed?: number, damageIn?: number, damageOut?: number, knockbackIn?: number}} mods  Only given keys.
 * @property {{every: number, damage: number}|null} dot
 * @property {'stun'|'freeze'|'root'|'silence'|'confuse'|null} control
 * @property {{every: number, amount: number}|null} heal
 * @property {string|null} visual
 * @property {string|null} tint
 * @property {string|null} icon
 * @property {boolean} builtin
 */

/**
 * @typedef {object} IRResource
 * @property {number} min
 * @property {number} max
 * @property {number} start
 * @property {number} regen
 * @property {number} regenDelay
 * @property {string} regenWhen  ('always'|'grounded'|'airborne'|'form:<name>')
 * @property {number} decay
 * @property {{perDamage: number}|null} onHit
 * @property {{perDamage: number}|null} onHurt
 * @property {{fraction: number, costPerDamage: number, forms: string[]|null}|null} soak
 * @property {boolean} resetOnRespawn
 * @property {boolean} sync
 * @property {{style: string, label: string, color: string|null, forms: string[]|null}} hud
 */

/**
 * Every hook key present; null when not defined.
 * @typedef {{init: Function|null, tick: Function|null, onHit: Function|null, onHurt: Function|null, onLand: Function|null,
 *   onKO: Function|null, onRespawn: Function|null, onFormChange: Function|null, extra?: object}} IRBehavior
 */
/**
 * @typedef {{preferredRange: number|null, zoning: boolean, recovery: string[]|Object<string, string[]>|null,
 *   prefer: string[], avoid: string[], grapple: boolean, hint: Function|null}} IRAI
 */

/**
 * Name tables for deterministic iteration and snapshot indices (§3.2, §7).
 * @typedef {object} IRTables
 * @property {string[]} triggers
 * @property {string[]} forms (base first, then declared)
 * @property {string[]} moves
 * @property {string[]} entities
 * @property {string[]} statuses  (sorted)
 * @property {string[]} resources  (declared order)
 * @property {string[]} vars (sorted)
 * @property {string[]} sync
 * @property {string[]} hitboxes   (sorted)
 * @property {{forms: Object<string, number>, moves: Object<string, number>, entities: Object<string, number>, statuses: Object<string, number>,
 *   resources: Object<string, number>, vars: Object<string, number>, hitboxes: Object<string, number>}} index
 */

/**
 * Base report from buildIR, merged with (and overridable by) the validator's report.
 * @typedef {object} IRReport
 * @property {Object<string, {category: string, startup: number, activeEnd: number|null, duration: number,
 *   reachBox: {x1: number, y1: number, x2: number, y2: number}|null, spawns: string[], isRecovery: boolean, isGrab: boolean,
 *   isThrow: boolean, scripted: boolean, routes: string[], generic: boolean}>} moves   routes: 'form:trigger'.
 * @property {string[]} runtimeGoverned   Script sources ('moves.x.update', 'behavior.tick', 'entities.y.think').
 * Validator additions (both paths unless noted):
 * @property {1|2} source               Which rules path scaled the numbers.
 * @property {Object<string, number>} area   Union area px² (bodyScale 1) per hurtbox set name of the base form; only
 *   sets with the same area in every form that has them (hurtbox.js reads this; others fall back to the raster).
 * @property {Object<string, Object<string, number>>} areaByForm  form → set → px².
 * Top-level statPoints {total, breakdown}, statBudget, movePower, moveBudget: the base form's (v1 report keys,
 *   identical to the pre-v2 validator for v1 files).
 * report.moves[n] also has: phases [{name: 'startup'|'active'|'recovery', from, to}] (frames 1..duration, §6.2),
 *   totalDamage, koPercent, reach, power (+ v2: ownDamage, entityDamage, spawns, extraHits, rise, intangibleFrames, armorFrames).
 * v2 only: forms {[f]: {statPoints, statBudget, movePower, moveBudget, pricedArea, scaleMin, perTrigger}},
 *   entities {[n]: {kind, limits, damage, life}}, budgets {selfRise, intangible, armorUptime}, headroom {stat, power}.
 */

/**
 * v1 origin info (normalize-v1.js).
 * @typedef {object} IRLegacy
 * @property {1} version
 * @property {object} stats            The raw v1 stats (incl. width/height) for the v1 rules path.
 * @property {'humanoid'|'shim'} art   'humanoid': art has no draw → humanoid(art); 'shim': wrap art.draw with v1ArtShim.
 * @property {object} extra            Top-level keys v1 ignored.
 * @property {object} unusedMoves      Non-slot v1 moves (ignored).
 * @property {object} extraMoveFields  Per slot, move fields v1 ignored.
 */
