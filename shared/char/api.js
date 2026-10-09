// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER API v2 — the one engine module a character file may import.
//
//   import { defineCharacter } from '../../shared/char/api.js';
//   export default defineCharacter({ id: 'nimbus', name: 'Nimbus', ... });
//
// defineCharacter is an identity function that stamps `version: 2`. It does no
// validation (the validator does, and explains every change); it exists so
// editors autocomplete every field from the JSDoc types below.
// Full reference: docs/CHARACTER_GUIDE.md (tables generated from schema.js).
// Units: px and frames (60/s). y grows DOWN. Body-local +x = forward.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark a character definition as v2 (spec §2.1). Returns `{ ...def, version: 2 }`.
 * Non-objects are returned unchanged so the validator can report E003.
 * @param {CharacterDef} def
 * @returns {CharacterDef}
 */
export function defineCharacter(def) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return def;
  return { ...def, version: 2 };
}

// ── Basic types ─────────────────────────────────────────────────────────────

/**
 * @typedef {'jab'|'side'|'up'|'down'|'sideSmash'|'upSmash'|'downSmash'|'nair'|'fair'|'bair'|'uair'|'dair'
 *   |'neutralSpecial'|'sideSpecial'|'upSpecial'|'downSpecial'
 *   |'grab'|'pummel'|'fthrow'|'bthrow'|'uthrow'|'dthrow'|'taunt'} Trigger
 *   The 16 v1 input slots plus the optional v2 triggers. `grab` = shield+attack on the ground.
 */
/** @typedef {'jab'|'tilt'|'smash'|'aerial'|'special'|'recovery'|'grab'|'throw'|'pummel'|'counter'|'utility'|'taunt'} Category */
/** @typedef {Category|'projectile'|'minion'|'trap'|'zone'|'beam'|'clone'|'status'} Tier */
/** @typedef {'jump'|'attack'|'special'|'strong'|'shield'|'taunt'|'up'|'down'|'left'|'right'} Button */
/** @typedef {'rushdown'|'zoner'|'heavy'|'trickster'|'summoner'|'grappler'|'allrounder'} Archetype */

/**
 * Body-local shape: origin at the collider's feet center, +x forward. The engine mirrors by facing
 * and scales by bodyScale. A shape with `r` and no `shape` is a circle.
 * @typedef {{shape?: 'circle', x?: number, y?: number, r: number}} CircleShape
 * @typedef {{shape: 'capsule', x1: number, y1: number, x2: number, y2: number, r: number}} CapsuleShape
 * @typedef {{shape: 'rect', x: number, y: number, w: number, h: number}} RectShape  x,y = CENTER
 * @typedef {CircleShape|CapsuleShape|RectShape} Shape
 */

// ── CharacterDef (§2.2.1) ───────────────────────────────────────────────────

/**
 * @typedef {object} CharacterDef
 * @property {2} [version]                     Set by defineCharacter. Missing/1 = v1 file.
 * @property {string} id                       /^[a-z][a-z0-9-]{1,23}$/, must equal the folder name. (E001)
 * @property {string} name                     ≤ 18 chars. (E002 if missing)
 * @property {string} [author]
 * @property {string} [description]            ≤ 220 chars.
 * @property {Archetype} [archetype='allrounder'] Hint for AI and docs only.
 * @property {BodyDef} [body]                  Default: v1 52×92 rect.
 * @property {StatsDef} [stats]
 * @property {MovementDef} [movement]          Default {} (plain walker).
 * @property {Object<string, ResourceDef>} [resources]   ≤ 6.
 * @property {Object<string, number|boolean|string>} [vars]  ≤ 32 keys; strings ≤ 24; numbers clamped ±1e6.
 * @property {string[]} [sync]                 Var names sent to clients (≤ 16). Resources sync by default.
 * @property {Object<string, HitTemplate>} [hitboxes]    Named templates: the ONLY way scripts deal damage.
 * @property {Object<string, StatusDef>} [statuses]      Custom statuses (≤ 8). Built-ins: burn poison freeze stun slow root silence confuse weaken vulnerable float mark.
 * @property {Object<string, EntityDef>} [entities]      ≤ 16 definitions.
 * @property {Object<string, Action>} [moves]  A pool; v1 slot names are just pool names.
 * @property {Partial<Record<Trigger, string|SlotFn>>} [slots]  Routes triggers to move names. Default identity.
 * @property {Object<string, FormDef>} [forms] ≤ 6. The base definition is the implicit form 'base'.
 * @property {string} [startForm='base']       (E011 if unknown)
 * @property {Hooks} [behavior]
 * @property {AIHints} [ai]
 * @property {ArtDef} [art]                    Client only; the sim never reads it.
 */

/**
 * Pure function of the read-only view; must return a pool move name. Anything else falls back to
 * the static mapping (or the generic move).
 * @callback SlotFn
 * @param {View} view
 * @returns {string}
 */

// ── Body, stats, movement (§2.2.3–2.2.5) ───────────────────────────────────

/**
 * @typedef {object} BodyDef
 * @property {{w: number, h: number}} [collider]  w [20..160], h [20..200]. Default: AABB of hurtboxes.default.
 *   Used for stage physics, ledge snap and the blast-zone top check.
 * @property {{default?: Shape[], crouch?: Shape[], air?: Shape[], [set: string]: Shape[]|undefined}} [hurtboxes]
 *   ≤ 6 shapes per set, ≤ 8 sets. Default: collider rect; crouch: same rect at 0.68 height.
 * @property {[number, number]} [scaleRange=[1,1]]  Clamped to [0.6..1.6]; setBodyScale range. Area priced at min.
 * @property {{threshold: number}} [armor]     Passive flinch armor [0..3] damage; 2.5 stat points per point.
 */

/**
 * Per form; unspecified form stats inherit from base. Ranges/costs as v1 STATS (rules.js).
 * @typedef {object} StatsDef
 * @property {number} [weight]           70–130
 * @property {number} [runSpeed]         4.5–8.5
 * @property {number} [airSpeed]         3.2–6
 * @property {number} [jumpHeight]       12–18
 * @property {number} [doubleJumpHeight] 11–17
 * @property {number} [airJumps]         1–3
 * @property {number} [gravity]          0.5–0.85 (free)
 * @property {number} [fallSpeed]        8–14 (free)
 */

/**
 * Engine-implemented movement modes (§3.8). Values are clamped into range.
 * @typedef {object} MovementDef
 * @property {{button?: Button, frames?: number, fallSpeed?: number, drift?: number}} [hover]   cost 2; frames [1..120]=90, fallSpeed [1..4]=1.5, drift [0.5..1.2]=1
 * @property {{button?: Button, frames?: number, fallSpeed?: number, speed?: number, turn?: number}} [glide]  cost 2; frames [1..150]=120, fallSpeed [1.2..4]=1.6, speed [1..1.3]×airSpeed=1.15, turn [0..0.1]=0.05
 * @property {{button?: Button, fuel?: number, thrust?: number, maxRise?: number}} [fly]  cost 6; fuel [1..180]=90, thrust [0.1..0.9]=0.6, maxRise [1..5]=4
 * @property {{frames?: number, wallJump?: boolean, jumpVx?: number, jumpVy?: number}} [wallCling]  cost 1; frames [1..60]=45
 * @property {{frames?: number, speed?: number}} [crawl]  cost 2; frames [1..120]=90, speed [1..0.8×runSpeed]
 */

/**
 * Resources gate actions and feed scripts; they create no power by themselves.
 * @typedef {object} ResourceDef
 * @property {number} max                [1..1000]
 * @property {number} [min=0]
 * @property {number} [start]            Default max.
 * @property {number} [regen=0]          Per frame.
 * @property {number} [regenDelay=0]     Frames after the last spend.
 * @property {'always'|'grounded'|'airborne'|string} [regenWhen='always']  Or `form:<name>`.
 * @property {number} [decay=0]          Per frame toward min.
 * @property {{perDamage: number}} [onHit]   Added per point of damage dealt (governed damage).
 * @property {{perDamage: number}} [onHurt]  Added per point of damage taken.
 * @property {{fraction: number, costPerDamage: number, forms?: string[]}} [soak]  Plating: fraction [0..0.5], cost ≥ 0.5 (§4.2.6).
 * @property {boolean} [resetOnRespawn=true]
 * @property {boolean} [sync=true]
 * @property {{style?: 'bar'|'pips'|'ring'|'none', label?: string, color?: string, forms?: string[]}} [hud]
 */

// ── Hits (§2.2.7) ───────────────────────────────────────────────────────────

/**
 * @typedef {object} HitTemplate
 * @property {'strike'|'grab'|'wind'|'reflect'|'absorb'} [kind='strike']
 * @property {number} [damage]        Strike damage (%).
 * @property {number} [angle]         Degrees: 0 forward, 90 up, 270 spike.
 * @property {number} [knockback]     Base knockback.
 * @property {number} [growth]        Knockback growth with target %.
 * @property {number} [setKnockback]  Fixed knockback (ignores %); [0..120].
 * @property {string} [effect='normal']  Open vocabulary (art); 14 v1 names keep presets.
 * @property {string|{name: string, frames?: number, power?: number}} [status]
 * @property {number} [shieldMul=1]   [0.5..1.5]
 * @property {number} [hitlagMul=1]   [0.5..1.5]
 * @property {number} [push]          Wind only, [0..6] px/frame.
 * @property {Tier} [tier]            Default: inherited from the move/entity/script context.
 */

/**
 * An action hitbox: a Shape plus timing plus inline HitTemplate fields (inline overrides `use`).
 * @typedef {Shape & HitTemplate & {
 *   start?: number, end?: number, group?: number, use?: string, rehit?: number,
 *   onHit?: TimelineAction[], counterScale?: boolean, air?: boolean }} Hitbox
 *   group defaults to the list index (v1 files: 0). rehit ≥ 3. `air` lets a grab box catch airborne targets.
 */

// ── Action (§2.2.8) ─────────────────────────────────────────────────────────

/**
 * @typedef {object} Action
 * @property {number} duration          Frames. (E017 if missing) Clamped to [minDuration..150].
 * @property {string} [name]            ≤ 24, default pool key.
 * @property {Category} [category]      Default: category of the first trigger routed to it, else 'special'.
 * @property {Hitbox[]} [hitboxes]
 * @property {TimelineEntry[]} [timeline]
 * @property {{start: number, end: number, vx?: number, vy?: number, mode?: 'set'|'add', untilGrounded?: boolean}[]} [velocity]
 * @property {object[]} [projectiles]   v1 projectiles; auto-converted to entities + spawns.
 * @property {[number, number]|[number, number][]} [intangible]  ≤ 12 frames total per action.
 * @property {{from: number, to: number, threshold: number}[]} [armor]  Threshold in damage [0..12]; flinch-only.
 * @property {{from: number, to: number, set?: string, shapes?: Shape[]}[]} [hurtboxes]  Hurtbox override windows.
 * @property {{from: number, to: number, scale: number}[]} [gravity]  scale [0.3..1.5].
 * @property {number} [landingLag]      Aerials: v1 rules (default 10).
 * @property {boolean} [helpless]       Default true only when routed from upSpecial.
 * @property {boolean} [oncePerAirtime] Default true only when routed from sideSpecial.
 * @property {Object<string, number>} [cost]  Resources spent when the action starts.
 * @property {{form?: string, grounded?: boolean, airborne?: boolean, resource?: Object<string, number>, var?: Object<string, *>}} [requires]
 * @property {string} [else]            Move run when cost/requires is unmet (otherwise the input is ignored).
 * @property {{button: Button, from: number, to: number, max: number, release?: string|number}} [hold]
 *   Loops frames from..to while held, ≤ max [1..600] total frames; on release jumps to `release`.
 * @property {{button?: Button, at?: number, max?: number}|null} [charge]  Smash default {button:'strong', at: startup−3, max: 60}; null disables.
 * @property {{from: number, to: number, into: string[], onHit?: boolean, button?: Button}[]} [cancels]
 *   `into`: move names, triggers, 'jump', 'shield' or 'any'.
 * @property {string} [next]            Starts automatically at `duration`.
 * @property {{from: number, to: number, then: string, mul?: number}} [counter]  mul [1..1.3]=1.2 (§3.6.3).
 * @property {TimelineAction[]} [onAbsorb]  Fires when one of this action's absorb boxes eats an entity.
 * @property {{holdAt?: {x: number, y: number}}} [throw]  Throws only: where the victim is held.
 * @property {string} [anim]            Opaque string passed to art.
 * @property {object} [pose]            Humanoid helper only.
 * @property {string} [effect]          Presentation; default effect of this move's hitboxes.
 * @property {string} [color]
 * @property {string} [sound]
 * @property {string} [description]
 * @property {(view: View, api: Api) => void} [update]  Per-frame script, after the timeline.
 */

// ── Timeline (§2.2.9) ───────────────────────────────────────────────────────

/**
 * Exactly ONE action key per entry (E014). The key's value is either the primary argument
 * (`spawn: 'ionBeam'`, `emit: 'thunder'`, `release: 'pinch'`) with params as sibling keys,
 * or an object of params (`steer: {speed: 11, turn: 0.18}`, `release: {damage: 9, ...}`).
 * @typedef {object} TimelineAction
 * @property {string} [spawn]      Entity name; params {x, y, vx?, vy?, count?=1 [1..5], spread?=0, aimAt?: 'nearestEnemy', bindToMove?: false}
 * @property {{vx?: number, vy?: number, mode?: 'set'|'add', untilGrounded?: boolean}} [velocity]
 * @property {{vx?: number, vy?: number}} [impulse]
 * @property {{speed: number, turn: number}} [steer]   Stick-directed; speed [0..12], turn [0..0.3].
 * @property {{dx: number, dy: number, relative?: 'facing'|'world'}} [teleport]  ≤ 200 px, 1 per airtime.
 * @property {string} [hit]        Template name; params: a Shape plus {frames?=1, group?}.
 * @property {{name: string, add?: number, set?: number}} [resource]
 * @property {Object<string, number>} [cost]
 * @property {string} [form]       Form name (45 f cooldown).
 * @property {string} [status]     Status name (self only).
 * @property {{frames: number, threshold: number}} [armor]
 * @property {number} [intangible] Frames.
 * @property {'turn'|'toward'} [facing]
 * @property {string|HitTemplate} [release]  Throws/pummels: template name or inline hit.
 * @property {{resource?: {name: string, below: number}, grounded?: true, airborne?: true}} [endIf]
 * @property {number} [goto]       Frame; ≤ 8 loops per action instance.
 * @property {string} [emit]       Custom render event; params {data?} (JSON ≤ 256 B).
 * @property {string} [sfx]        Asset or preset name.
 * @property {{shake: number}} [camera]  shake [0..8].
 */
/**
 * @typedef {TimelineAction & ({at: number} | {from: number, to: number, every?: number} | {onLand: true} | {onHit: true})} TimelineEntry
 */

// ── Statuses, entities, forms (§2.2.10–2.2.12) ─────────────────────────────

/**
 * @typedef {object} StatusDef
 * @property {number} frames            [1..300]
 * @property {'refresh'|'add'|'ignore'} [stack='refresh']
 * @property {number} [maxStacks=1]     [1..3]
 * @property {{speed?: number, jump?: number, gravity?: number, fallSpeed?: number, damageIn?: number, damageOut?: number, knockbackIn?: number}} [mods]
 *   Multipliers; combined then clamped (speed 0.6–1.25, jump 0.7–1.2, gravity 0.5–1.4, fallSpeed 0.7–1.3,
 *   damageOut 0.8–1.15, damageIn 0.85–1.15, knockbackIn 0.85–1.2).
 * @property {{every: number, damage: number}} [dot]  every ≥ 15, damage ≤ 0.5.
 * @property {'stun'|'freeze'|'root'|'silence'|'confuse'} [control]
 * @property {{every: number, amount: number}} [heal]  Self statuses only (mitigation budget).
 * @property {string} [visual]
 * @property {string} [tint]
 * @property {string} [icon]
 */

/**
 * @typedef {object} EntityMotion
 * @property {'ballistic'|'linear'|'homing'|'orbit'|'attached'|'stationary'|'walker'|'boomerang'|'mimic'} type
 * @property {number} [speed]
 * @property {number} [accel]
 * @property {number} [maxSpeed]
 * @property {number} [gravity]
 * @property {number} [turn]   Homing ≤ 0.12 rad/f.
 * @property {number} [wobble]
 * @property {'nearestEnemy'|'owner'} [target]
 * @property {number} [delay]
 * @property {number} [radius]
 * @property {'owner'} [around]
 * @property {{x: number, y: number}} [offset]
 * @property {boolean} [snapToGround]
 * @property {number} [out]
 * @property {number} [back]
 */

/**
 * @typedef {object} EntityDef
 * @property {'projectile'|'minion'|'trap'|'zone'|'beam'|'clone'|'part'} kind
 * @property {Shape} shape             Body/visual and default hurt shape.
 * @property {number} life             Frames.
 * @property {number} [hp]             >0 = can be destroyed by damage (and gets a hurtbox).
 * @property {number} [maxAlive]       ≤ 8.
 * @property {number} [maxHits=1]
 * @property {number} [pierce=0]
 * @property {EntityMotion} motion
 * @property {'die'|'bounce'|'stick'|'walk'|'pass'} [collide='die']
 * @property {boolean} [platforms=false]
 * @property {number} [maxBounces=3]
 * @property {(Shape & HitTemplate & {start?: number, end?: number, use?: string, rehit?: number, group?: number})[]} [hitboxes]  Relative to the entity.
 * @property {Shape[]} [hurtbox]       Default [shape] if hp > 0.
 * @property {number} [relay]          Parts only: [0.5..1].
 * @property {number} [length]         Beams: ≤ 520.
 * @property {number} [width]          Beams: ≤ 24.
 * @property {{x: number, y: number}} [anchor]  Beam/attached offset from the owner's feet.
 * @property {boolean} [reflectable=true]
 * @property {boolean} [absorbable=true]
 * @property {boolean} [clank=true]
 * @property {boolean} [clash=false]
 * @property {{frames: number, spawn: string, x?: number, y?: number, vx?: number, vy?: number, aim?: 'nearestEnemy'}} [every]  frames ≥ 30.
 * @property {TimelineAction[]} [onSpawn]
 * @property {TimelineAction[]} [onHit]
 * @property {TimelineAction[]} [onExpire]
 * @property {TimelineAction[]} [onDeath]
 * @property {(view: View, e: EntityView, api: Api) => void} [think]  Per-frame entity script.
 * @property {number} [scale]          Clones: hurtbox scale [0.5..1].
 * @property {{style?: string, color?: string, color2?: string, spin?: number}} [render]  Passed to art.
 */

/**
 * Forms share the single moves pool and remap slots: form.slots[t] → base slots[t] → t.
 * @typedef {object} FormDef
 * @property {Partial<StatsDef>} [stats]   Unspecified stats inherit from base.
 * @property {BodyDef} [body]
 * @property {MovementDef} [movement]
 * @property {Partial<Record<Trigger, string|SlotFn>>} [slots]
 * @property {{threshold: number}} [armor]
 * @property {string} [art]                art.forms key (default form name).
 */

// ── Hooks, AI (§2.2.13–2.2.14) ─────────────────────────────────────────────

/**
 * Hooks are notifications: they can never change the numbers of the hit that triggered them.
 * @typedef {object} Hooks
 * @property {(view: View, api: Api) => void} [init]       Match start and each respawn.
 * @property {(view: View, api: Api) => void} [tick]       Every frame after the fighter update.
 * @property {(view: View, api: Api, ev: HitEvent) => void} [onHit]   Once per hit dealt.
 * @property {(view: View, api: Api, ev: HitEvent) => void} [onHurt]  Once per hit taken.
 * @property {(view: View, api: Api) => void} [onLand]
 * @property {(view: View, api: Api) => void} [onKO]
 * @property {(view: View, api: Api) => void} [onRespawn]
 * @property {(view: View, api: Api, ev: {from: string, to: string}) => void} [onFormChange]
 */
/**
 * @typedef {{damage: number, granted: number, attackerId?: string, targetId?: string, move: string|null,
 *   entity: string|null, entityId: number|null, intended: number, tier: Tier, kind: string, x: number, y: number}} HitEvent
 */
/**
 * @typedef {object} AIHints
 * @property {number} [preferredRange]
 * @property {boolean} [zoning]
 * @property {string[]|Object<string, string[]>} [recovery]  Move names, or per form.
 * @property {string[]} [prefer]
 * @property {string[]} [avoid]
 * @property {boolean} [grapple]
 * @property {(view: View) => (null|{press?: Trigger, hold?: Trigger})} [hint]  Evaluated at most every 10 frames.
 */

// ── Script view and api (§3.12) — read-only view, queued governed commands ─

/**
 * @typedef {object} View  Frozen, read-only.
 * @property {number} frame
 * @property {{id: string, x: number, y: number, vx: number, vy: number, facing: 1|-1, grounded: boolean, state: string,
 *   stateFrame: number, percent: number, stocks: number, form: string, bodyScale: number,
 *   move: null|{name: string, frame: number, phase: 'startup'|'active'|'recovery'|'charge'|'hold', holdFrames: number,
 *     chargeFrames: number, hitSomething: boolean, counterIn: number},
 *   air: {riseLeft: number, stallLeft: number, jumpsLeft: number, teleportsLeft: number, flyFuel: number},
 *   statuses: {name: string, frames: number, stacks: number}[], control: string|null}} me
 * @property {Object<string, number>} res
 * @property {Object<string, *>} vars
 * @property {{held(b: Button): boolean, pressed(b: Button): boolean, released(b: Button): boolean, heldFrames(b: Button): number,
 *   dir(): {x: -1|0|1, y: -1|0|1}}} input
 * @property {() => EnemyView[]} enemies
 * @property {(from?: {x: number, y: number}) => EnemyView|null} nearestEnemy
 * @property {(name?: string) => EntityView[]} entities
 * @property {{ground: object, platforms: object[], blast: object}} stage
 * @property {() => number} rng        Per-fighter seeded stream in [0, 1). Use instead of Math.random.
 * @property {() => {entities: number, threat: number, riseLeft: number, stallLeft: number, intangibleLeft: number,
 *   armorLeft: number, mitigationLeft: number, statusSlotsLeft: number}} budget
 */
/** @typedef {{id: string, x: number, y: number, vx: number, vy: number, facing: 1|-1, grounded: boolean, state: string, percent: number, statuses: object[], form: string}} EnemyView */
/** @typedef {{id: number, name: string, x: number, y: number, vx: number, vy: number, age: number, life: number, hp: number, hits?: number, facing?: 1|-1, vars: object}} EntityView */

/**
 * Immediate calls touch only own state (res, vars, evars). Everything else is queued and governed.
 * @typedef {object} Api
 * @property {{add(name: string, d: number): void, set(name: string, v: number): void}} res
 * @property {{set(key: string, v: number|boolean|string): void}} vars
 * @property {{set(key: string, v: number|boolean|string): void}} [evars]  Entity scripts only.
 * @property {(name: string) => void} startMove
 * @property {(name: string) => void} cancelInto
 * @property {() => void} endMove
 * @property {(vx: number|null, vy: number|null, opts?: {mode?: 'set'|'add'}) => void} velocity
 * @property {(vx: number, vy: number) => void} impulse
 * @property {(dx: number, dy: number) => void} teleport
 * @property {(name: string, opts?: {x?: number, y?: number, worldX?: number, worldY?: number, vx?: number, vy?: number,
 *   angle?: number, facing?: 1|-1, target?: 'nearestEnemy'}) => void} spawn  In think: starts at the entity
 *   (x/vx mirrored by the owner's facing unless `facing` is given); worldX/worldY clamped to ±600 px around it.
 * @property {(id: number) => void} despawn
 * @property {(id: number, cmd: {target?: string, moveTo?: {x: number, y: number}}) => void} command
 * @property {(template: string, shape: Shape, opts?: {frames?: number, group?: number}) => void} hit  Template-only damage.
 * @property {(target: 'self'|string, name: string) => void} status
 * @property {(name: string) => void} form
 * @property {(s: number) => void} setBodyScale
 * @property {(set: string|null) => void} setHurtboxes
 * @property {(key: string, mods: StatusDef['mods']|null) => void} modify
 * @property {(frames: number, threshold: number) => void} armor
 * @property {(frames: number) => void} intangible
 * @property {(amount: number) => void} heal
 * @property {(name: string, data?: object) => void} emit
 * @property {(name: string) => void} sfx
 * @property {(opts: {shake: number}) => void} camera
 */

// ── ArtDef (§6.1, client only) ──────────────────────────────────────────────

/**
 * @typedef {{left: number, right: number, top: number, bottom: number}} Bounds
 * @typedef {{image: string, frameW: number, frameH: number, cols?: number, anchor: [number, number], scale?: number, pixelated?: boolean, padding?: number}} Sheet
 * @typedef {{frames: number[], fps?: number, loop?: boolean, speedFrom?: 'vx'|'vy'}
 *   | {sync: 'move', startup?: number[], active?: number[], recovery?: number[], charge?: number[], hold?: number[]}} Clip
 */
/**
 * @typedef {object} ArtDef
 * @property {'humanoid'|'none'} [rig]   Default 'humanoid' if no draw().
 * @property {Bounds|Object<string, Bounds>} [bounds]  Per form allowed.
 * @property {object} [palette]
 * @property {object[]} [palettes]
 * @property {Object<string, string>} [assets]   name → './relative/path'
 * @property {Object<string, Sheet>} [sheets]
 * @property {Object<string, Object<string, Clip>>} [clips]
 * @property {(cache: object, info: object) => void} [init]
 * @property {(ctx: CanvasRenderingContext2D, view: object, info: object) => void} [draw]       Body space, mirrored, clipped to bounds.
 * @property {(ctx: CanvasRenderingContext2D, view: object, info: object) => void} [drawBack]   World space at feet, before fighters.
 * @property {(ctx: CanvasRenderingContext2D, view: object, info: object) => void} [drawWorld]  World space, after fighters/entities.
 * @property {Object<string, {draw: Function, drawWorld?: Function}>} [entities]
 * @property {(ctx: CanvasRenderingContext2D, p: object, info: object) => void} [projectile]  v1 fallback for projectile entities.
 * @property {(view: object, info: object) => ({x: number, y: number}|null|false)} [trail]
 * @property {object} [fx]       {onHit, onHurt, onLand, onJump, onKO, onRespawn, onFormChange, onMove: {}, onEvent: {}}
 * @property {Object<string, *>} [sounds]
 * @property {Function|{x: number, y: number, r: number}|object} [portrait]
 * @property {(ctx: CanvasRenderingContext2D, rect: object, info: object) => void} [hud]
 * @property {Object<string, Partial<ArtDef>>} [forms]
 */
