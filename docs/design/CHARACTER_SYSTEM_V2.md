# Character System v2: Final Spec ("Describe anything. The engine keeps it fair.")

Status: implementation-ready. Audience: engine, tools and art implementers. Repo: `/Users/noahwolk/Character_Battle`.

Backbone: the **"expressive"** design, chosen because creative freedom is the owner's top priority. Ideas grafted in from the others:
- From **fairness**: scripts can only deal damage through templates; hurtbox shrink counts as intangibility; worker-per-room with a watchdog; a runtime audit in the report; real hitbox shapes are passed to the art.
- From **authoring**: hooks queue commands; the KO cap uses a per-target percent ramp; armor never reduces damage; coded notes with did-you-mean suggestions; `defineCharacter` and JSDoc; the Description→Kit procedure; a cheater fuzz suite; golden replays first.

Every weakness the judges raised is closed. §11 maps each one to its fix.

Conventions:
- Units are px and frames at 60 Hz.
- y grows downward. Body-local +x means "forward"; the engine mirrors by facing.
- "MUST", "SHOULD" and "MAY" are normative.
- Every constant named below lives in one of these frozen files: `shared/balance/rules.js` (static limits), `shared/balance/governor-rules.js` (runtime limits, new), or `shared/constants.js`.

---

## 1. Goals and non-goals

### 1.1 Goals
1. **Anything goes.** A friend's description can become a playable character with no engine changes. Examples: a storm cloud, a bee swarm, a grandma on a scooter, a shapeshifting slime, a hamster in a mech, a dragon, a living painting, a growing giant, a clone-splitter, a chess army.
   - Bodies can be any shape and size.
   - Characters can have forms and stances, resources and vars, entities (projectiles, minions, traps, zones, beams, clones, parts), statuses, movement modes (hover, glide, fly, wall-cling, crawl), grabs and throws, counters, reflect, absorb, wind and armor.
   - Real JavaScript is allowed for the long tail.
2. **Nobody can one-shot anyone or become unkillable, whatever code they write.** A runtime **Governor** inside the hit pipeline and the physics step enforces this. Static auto-scaling shapes the data and explains every change, but the Governor is the actual guarantee.
3. **Never block a creator for being too strong.** The only hard errors are the ones listed in §4.1.6. Otherwise power is scaled, and the report explains what changed and how to get the intent back.
4. **Server authority and determinism.** The sim is deterministic given inputs and a seed. Online play is server-authoritative, and one bad character MUST NOT be able to hang other rooms.
5. **v1 keeps working.** ember, bastion, volt, mirelle, `_template` and any in-flight v1 file load unchanged. The refactor is proven by golden replays to match v1 frame for frame.
6. **Exceptional art for anything.** Procedural, sprite-sheet and hybrid art are all first-class. The humanoid puppet becomes an optional helper. Art lines up with hitboxes by construction.
   - Every character gets world-space VFX, sounds, correct portraits and previews, and an Art Lab with automatic quality checks and a contact sheet that Claude can read.

### 1.2 Non-goals
- Rollback netcode. Determinism keeps the door open, but it is not built here.
- A sandbox that is safe against hostile strangers. The boundary is still owner PR review; see §5. SES or isolated-vm is a documented future step.
- New buttons beyond one `taunt` bit, analog stick input, or motion inputs beyond what `heldFrames` and `dir` allow.
- Character-defined engine states, character edits to global rules (shield, dodge, DI, respawn, blast zones), and character-defined stages.
- Teams. The game stays free-for-all.

---

## 2. Character file format

### 2.1 Module shape

```js
// characters/<id>/character.js   (imports allowed: ./**, ../../shared/art/**, ../../shared/char/api.js)
import { defineCharacter } from '../../shared/char/api.js';  // identity fn + JSDoc types; sets version:2
import art from './art.js';
export default defineCharacter({ ...CharacterDef });
```

A file with no `version` field (or `version: 1`) is v1 and goes through `normalizeV1` (§8).

`defineCharacter(def)` returns `{ ...def, version: 2 }`. It does no validation itself; it exists for autocomplete and documentation.

### 2.2 Type reference

Notation:
- `T?` means optional, `=x` is the default, and `[a..b]` is the legal range.
- Values outside a range are **scaled or clamped with a note**, never rejected.
- **(E)** marks a structural error that blocks loading (§4.1.6).

#### 2.2.1 CharacterDef

| key | type | default | notes |
|---|---|---|---|
| `version` | `2` | set by `defineCharacter` | |
| `id` | string matching `/^[a-z][a-z0-9-]{1,23}$/` | **(E)** if missing, invalid, or ≠ folder name | |
| `name` | string ≤ 18 | **(E)** if missing | Truncated with a note if longer. |
| `author`, `description` | string, description ≤ 220 | `''` | |
| `archetype?` | `'rushdown'\|'zoner'\|'heavy'\|'trickster'\|'summoner'\|'grappler'\|'allrounder'` | `'allrounder'` | Hint for AI and docs only. |
| `body` | BodyDef | from v1 defaults (52×92 rect) | |
| `stats` | StatsDef | `STATS[*].default` | |
| `movement?` | MovementDef | `{}` (walker) | |
| `resources?` | `{[name]: ResourceDef}` | `{}` | ≤ 6 resources. |
| `vars?` | `{[name]: number\|boolean\|string}` | `{}` | ≤ 32 keys. Strings ≤ 24 characters. Numbers must be finite and are clamped to ±1e6. |
| `sync?` | `string[]` | `[]` | Var names sent to clients, ≤ 16. Resources sync by default. |
| `hitboxes?` | `{[name]: HitTemplate}` | `{}` | Named strike templates. These are the **only** way scripts deal damage. |
| `statuses?` | `{[name]: StatusDef}` | `{}` | Custom statuses, ≤ 8. |
| `entities?` | `{[name]: EntityDef}` | `{}` | ≤ 16 definitions. |
| `moves` | `{[name]: Action}` | `{}` | A **pool**. v1 slot names are just pool names. |
| `slots?` | `{[Trigger]: string \| SlotFn}` | identity (`slots.jab = 'jab'`, …) | Routes triggers to move names. |
| `forms?` | `{[name]: FormDef}` | `{}` | ≤ 6 forms. The base definition is the implicit form `'base'`. |
| `startForm?` | string | `'base'` | **(E)** if it names an unknown form. |
| `behavior?` | Hooks | `{}` | Sandboxed hooks (§3.12). |
| `ai?` | AIHints | `{}` | |
| `art?` | ArtDef | auto-art | Client only. The sim never reads it. |

**Triggers.** These are the 16 v1 input slots plus the new optional triggers listed below.
- v1 slots: `jab side up down sideSmash upSmash downSmash nair fair bair uair dair neutralSpecial sideSpecial upSpecial downSpecial`
- New optional triggers: `grab pummel fthrow bthrow uthrow dthrow taunt`
  - `grab` is shield+attack while grounded and not already in a move. No wire change is needed.
  - `taunt` is input bit 9.
- If a trigger resolves to a missing move, a generic move is used with a note. Generic grab, pummel and throws are defined in `shared/char/generics.js`.

**SlotFn**: `(view) => string`. It is pure, gets the read-only view from §3.12.2, and must return a pool name. Any other return value falls back to the static mapping, or to the generic move, and produces a runtime warning event in training only.

#### 2.2.2 Shapes

```ts
type Shape =
  | { shape?: 'circle', x: number, y: number, r: number }             // default when r present and no shape
  | { shape: 'capsule', x1: number, y1: number, x2: number, y2: number, r: number }
  | { shape: 'rect', x: number, y: number, w: number, h: number };     // x,y = CENTER; axis-aligned in body space
```
Coordinates are body-local: origin at the collider's feet center, +x forward. The engine mirrors x by facing and scales by `bodyScale`.

#### 2.2.3 BodyDef

| key | type | default | range |
|---|---|---|---|
| `collider` | `{w, h}` | AABB of `hurtboxes.default` | w `[20..160]`, h `[20..200]`. Used for stage physics, ledge snap, and the blast-zone top check. |
| `hurtboxes` | `{default: Shape[], crouch?: Shape[], air?: Shape[], [setName]: Shape[]}` | `default`: a rect the size of the collider. `crouch`: the same rect at 0.68 height. | ≤ 6 shapes per set and ≤ 8 sets. Every shape must fit inside the envelope x ∈ `[−2·M, 2·M]`, y ∈ `[−2.5·h, 0.5·h]`, where M = max(w, h). Out-of-envelope shapes are clamped. |
| `scaleRange?` | `[min, max]` | `[1, 1]` | Clamped to `[0.6..1.6]`. Scripts may call `setBodyScale` within this range. The validator prices area at `min`. |
| `armor?` | `{ threshold }` | none | Passive armor `[0..3]` damage, priced at 2.5 stat points per point of threshold (§4.1.1). |

The engine selects a hurtbox set automatically in this order:
1. the action's `hurtboxes` window (§2.2.8)
2. a set selected by script (`api.setHurtboxes`)
3. `crouch` while crouching
4. `air` while airborne
5. `default`

#### 2.2.4 StatsDef (per form)

Stats: `weight runSpeed airSpeed jumpHeight doubleJumpHeight airJumps gravity fallSpeed`.
- Ranges and costs are the same as v1 `STATS` (rules.js). `width` and `height` are **v1 only**; in v2 they are replaced by `body`.
- A form inherits any unspecified stats from base.

#### 2.2.5 MovementDef (per form; engine-implemented modes, §3.8)

| mode | params (clamped) | stat cost |
|---|---|---|
| `hover` | `{button='jump', frames [1..120]=90, fallSpeed [1.0..4]=1.5, drift [0.5..1.2]=1}` | 2 |
| `glide` | `{button='jump', frames [1..150]=120, fallSpeed [1.2..4]=1.6, speed [1..1.3]×airSpeed=1.15, turn [0..0.1]=0.05}` | 2 |
| `fly` | `{button='jump', fuel [1..180]=90, thrust [0.1..0.9]=0.6, maxRise [1..5]=4}` | 6 |
| `wallCling` | `{frames [1..60]=45, wallJump=true, jumpVx [0..8]=6, jumpVy [0..14]=11}` | 1 |
| `crawl` | `{frames [1..120]=90, speed [1..0.8×runSpeed]}` | 2 |

#### 2.2.6 ResourceDef

```ts
{ min?: 0, max: number /*[1..1000]*/, start?: max, regen?: 0 /*per frame*/, regenDelay?: 0, regenWhen?: 'always'|'grounded'|'airborne'|`form:${string}`,
  decay?: 0 /*per frame toward min*/, onHit?: { perDamage: number }, onHurt?: { perDamage: number },
  soak?: { fraction: number /*[0..0.5]*/, costPerDamage: number /*>=0.5*/, forms?: string[] },  // "plating": see §4.2.6
  resetOnRespawn?: true, sync?: true, hud?: { style: 'bar'|'pips'|'ring'|'none'='bar', label?: string, color?: string, forms?: string[] } }
```
Resources only gate actions and feed scripts. They create no power by themselves, since everything they unlock is governed. That is why `max` and `regen` aren't limited beyond the ranges above. The exception is `soak`, which is defensive and budgeted.

#### 2.2.7 HitTemplate (named, in `hitboxes`) and inline hit fields

```ts
{ kind?: 'strike'|'grab'|'wind'|'reflect'|'absorb' = 'strike',
  damage: number, angle: number, knockback: number, growth: number,     // strike
  setKnockback?: number,      // fixed kb (ignores %); [0..120]
  effect?: string = 'normal', // open vocabulary (art); 14 v1 names keep presets
  status?: string | { name: string, frames?: number, power?: number },
  shieldMul?: 1 /*[0.5..1.5]*/, hitlagMul?: 1 /*[0.5..1.5]*/,
  push?: number /*wind only, [0..6] px/f*/,
  tier?: Category /* default: inherited from the move/entity/script context */ }
```

#### 2.2.8 Action (pool entry; superset of a v1 move)

| field | type | default | semantics |
|---|---|---|---|
| `name` | string ≤ 24 | pool key | Display name. |
| `category` | `'jab'\|'tilt'\|'smash'\|'aerial'\|'special'\|'recovery'\|'grab'\|'throw'\|'pummel'\|'counter'\|'utility'\|'taunt'` | Category of the first trigger that routes to it (rules.js `MOVE_SLOTS` plus `grab`→grab, `pummel`→pummel, throws→throw, taunt→taunt). Otherwise `special`. | Selects the static limits row and the runtime tier. |
| `duration` | int | **(E)** if missing or not a number | Clamped to `[minDuration..150]`. |
| `hitboxes` | `Hitbox[]` | `[]` | `Hitbox = Shape & {start, end, group?=index, use?: templateName, ...inline HitTemplate fields, rehit?: int≥3, onHit?: TimelineAction[], counterScale?: bool}`. When both are present, inline fields override the template. |
| `timeline` | `TimelineEntry[]` | `[]` | See §2.2.9. |
| `velocity` | `{start,end,vx?,vy?,mode?='set'\|'add', untilGrounded?}[]` | `[]` | Same as v1, plus `mode` and `untilGrounded`. |
| `projectiles` | v1 projectile[] | `[]` | Auto-converted to entities plus spawns (§8). |
| `intangible` | `[s,e]` or `[s,e][]` | none | ≤ 12 frames total per action (static limit). |
| `armor` | `{from,to,threshold}[]` | none | Threshold in damage, `[0..12]`. Flinch-only (§4.2.7). |
| `hurtboxes` | `{from,to,set?: name, shapes?: Shape[]}[]` | none | Overrides the hurtboxes during a window. |
| `gravity` | `{from,to,scale [0.3..1.5]}[]` | none | |
| `landingLag` | int | aerials: v1 rules | |
| `helpless` | bool | `true` only when routed from `upSpecial` | Enters helpless if the action ends airborne. |
| `oncePerAirtime` | bool | `true` only when routed from `sideSpecial` | |
| `cost` | `{[res]: n}` | none | Spent when the action starts. |
| `requires` | `{form?, grounded?, airborne?, resource?: {[res]: min}, var?: {[k]: v}}` | none | |
| `else` | move name | none | Runs if `cost` or `requires` is unmet. Without it, the input is ignored. |
| `hold` | `{button, from, to, max [1..600], release?: moveName \| frame}` | none | While `button` is held, the interpreter loops back from frame `to` to frame `from` for up to `max` total frames. On release it jumps to `release`. |
| `charge` | `{button, at, max [1..60]=60}` | smash: `{button:'strong', at: startup−3}` | Freezes at frame `at` while the button is held. Damage ×(1 + 0.4·frames/60), with the runtime cap at ×1.4. |
| `cancels` | `{from, to, into: (moveName\|Trigger\|'jump'\|'shield'\|'any')[], onHit?: bool, button?: Button}[]` | none | |
| `next` | move name | none | Starts automatically at `duration`. |
| `counter` | `{from, to, then: moveName, mul [1..1.3]=1.2}` | none | §3.6.3 |
| `onAbsorb` | `TimelineAction[]` | none | Fires when one of this action's `absorb` hitboxes eats an entity. |
| `throw` | `{holdAt?: {x,y}}` | grab box center | Throws only: where the victim is held before `release`. |
| `anim`, `pose`, `effect`, `color` | presentation | | `anim` is an opaque string passed to art. `pose` is only interpreted by the humanoid helper. |
| `update` | `(view, api) => void` | none | Per-frame script, run after the timeline (§3.12). |

#### 2.2.9 Timeline

`TimelineEntry = ({at: int} | {from: int, to: int, every?: int} | {onLand: true} | {onHit: true}) & TimelineAction`

Each `TimelineAction` has exactly **one** action key from the table below. An entry with zero or several keys is an **(E)** error.

| key | params | governed by |
|---|---|---|
| `spawn` | `entityName` + `{x,y,vx?,vy?,count?=1 [1..5], spread?=0, aimAt?: 'nearestEnemy', bindToMove?: false}` | entity budget (§4.2.8) |
| `velocity` | `{vx?, vy?, mode?='set', untilGrounded?}` | speed cap, rise budget |
| `impulse` | `{vx?, vy?}` | the same |
| `steer` | `{speed [0..12], turn [0..0.3]}` (stick-directed) | the same |
| `teleport` | `{dx, dy, relative?='facing'}` | ≤ 200 px, 1 per airtime, rise budget |
| `hit` | `templateName` + `Shape` + `{frames?=1, group?}` | static template caps plus the Governor |
| `resource` | `{name, add?\|set?}` | none (own state) |
| `cost` | `{[res]: n}` | none |
| `form` | `formName` | form cooldown (45 f) |
| `status` | `statusName` (self only) | status caps |
| `armor` | `{frames, threshold}` | armor budget |
| `intangible` | `frames` | intangibility budget |
| `facing` | `'turn'\|'toward'` | none |
| `release` | `templateName \| inline HitTemplate` (throws only) | throw caps |
| `endIf` | `{resource: {name, below}} \| {grounded: true} \| {airborne: true}` | none |
| `goto` | `frame` | ≤ 8 loops per action instance |
| `emit` | `name` + `{data?}` (custom render event, data ≤ 256 B) | fx budget |
| `sfx` | `assetOrPreset` | sound budget |
| `camera` | `{shake [0..8]}` | none |

#### 2.2.10 StatusDef (custom, built only from capped modifiers)

```ts
{ frames: int /*[1..300]*/, stack?: 'refresh'|'add'|'ignore' = 'refresh', maxStacks?: 1 /*[1..3]*/,
  mods?: { speed?, jump?, gravity?, fallSpeed?, damageIn?, damageOut?, knockbackIn? },   // caps §4.2.9
  dot?: { every: int /*>=15*/, damage: number /*<=0.5*/ }, control?: 'stun'|'freeze'|'root'|'silence'|'confuse',
  heal?: { every: int, amount: number },   // self statuses only; counted in the mitigation budget
  visual?: string, tint?: string, icon?: string }
```

Built-in statuses are available to everyone by name:

| name | definition |
|---|---|
| `burn` | `dot {every:15, damage:0.5}`, 120 f |
| `poison` | `dot {every:30, damage:0.5}`, 240 f |
| `freeze` | `control:'freeze'`, 30 f |
| `stun` | `control:'stun'`, 24 f |
| `slow` | `mods.speed 0.7`, 120 f |
| `root` | `control:'root'`, 45 f |
| `silence` | `control:'silence'`, 90 f |
| `confuse` | `control:'confuse'`, 60 f |
| `weaken` | `damageOut 0.85`, 180 f |
| `vulnerable` | `damageIn 1.1`, 180 f |
| `float` | `gravity 0.6`, 90 f |
| `mark` | no mods (a tag for scripts) |

#### 2.2.11 EntityDef

```ts
{ kind: 'projectile'|'minion'|'trap'|'zone'|'beam'|'clone'|'part',
  shape: Shape,                         // body/visual & default hurt shape
  life: int, hp?: number, maxAlive?: int, maxHits?: 1, pierce?: 0,
  motion: { type: 'ballistic'|'linear'|'homing'|'orbit'|'attached'|'stationary'|'walker'|'boomerang'|'mimic',
            speed?, accel?, maxSpeed?, gravity?, turn?, wobble?, target?: 'nearestEnemy'|'owner', delay?,
            radius?, around?: 'owner', offset?: {x,y}, snapToGround?, out?, back? },
  collide?: 'die'|'bounce'|'stick'|'walk'|'pass' = 'die',  platforms?: false, maxBounces?: 3,
  hitboxes?: (Shape & {start?=0, end?=life, use?, ...HitTemplate, rehit?})[],   // positions relative to entity
  hurtbox?: Shape[],                    // default [shape] if hp>0
  relay?: number,                       // part only: [0.5..1]
  length?: number, width?: number,      // beam: capsule from owner anchor along facing
  anchor?: {x, y},                      // beam/attached: offset from owner feet
  reflectable?: true, absorbable?: true, clank?: true, clash?: false,
  every?: { frames: int /*>=30*/, spawn: entityName, x?, y?, vx?, vy?, aim?: 'nearestEnemy' },
  onSpawn?: TimelineAction[], onHit?: TimelineAction[], onExpire?: TimelineAction[], onDeath?: TimelineAction[],
  think?: (view, e, api) => void,       // per-frame entity script
  scale?: number,                       // clone: hurtbox scale [0.5..1]
  render?: { style?, color?, color2?, spin? } }      // passed to art; v1 projectile styles
```

#### 2.2.12 FormDef

`{ stats?, body?, movement?, slots?, armor?, art?: string /* art.forms key, default = form name */ }`
- Forms share the single `moves` pool and remap `slots`.
- Trigger resolution order: `form.slots[t]`, then `base slots[t]`, then `t`.

#### 2.2.13 Hooks (`behavior`)

| hook | signature | when it runs | command apply point |
|---|---|---|---|
| `init` | `(view, api)` | match start and each respawn | immediately |
| `tick` | `(view, api)` | every frame after the fighter update | immediately after the hook |
| `onHit` | `(view, api, ev)` | after hit resolution, once per hit dealt | after all hooks for that frame |
| `onHurt` | `(view, api, ev)` | after hit resolution, once per hit taken | after all hooks for that frame |
| `onLand` | `(view, api)` | on landing | immediately after the hook |
| `onKO` | `(view, api)` | when the fighter is KO'd | immediately after the hook |
| `onRespawn` | `(view, api)` | on respawn | immediately after the hook |
| `onFormChange` | `(view, api, {from, to})` | when the form changes | immediately after the hook |

`ev = {damage, granted, intended, attackerId|targetId, move, entity, entityId, tier, kind, x, y}` (no `killed` flag: a KO happens later, at the blast zone, and is not reported to the attacker's scripts). Hooks are notifications: they can **never** change the numbers of the hit that triggered them.

#### 2.2.14 AIHints

```ts
{ preferredRange?: number, zoning?: boolean,
  recovery?: string[] | {[form]: string[]},
  prefer?: string[], avoid?: string[], grapple?: boolean,
  hint?: (view) => null | {press?: Trigger, hold?: Trigger} }
```
`hint` is evaluated at most every 10 frames.

### 2.3 Example A: "Nimbus", a sentient storm cloud (procedural, rig: none)

It shows multi-circle hurtboxes, hover, a resource, statuses that set up synergy, burst zones and lingering zones, a beam held with a resource cost, wind, a script that picks a target, a template-only scripted hit, and a hook cooldown stored in vars.

```js
// characters/nimbus/character.js
// NIMBUS — a grumpy thundercloud. Rain soaks foes; lightning on soaked foes hits harder.
// Static charge builds as Nimbus lands hits and fuels the Ion Beam.
import { defineCharacter } from '../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'nimbus',
  name: 'Nimbus',
  author: 'Alex',
  description: 'A grumpy thundercloud. Soaks foes with rain, then cashes the puddles in for lightning. Floats a long time, but not forever.',
  archetype: 'zoner',

  body: {
    collider: { w: 72, h: 64 },
    hurtboxes: {
      default: [
        { shape: 'circle', x: 0,   y: -40, r: 30 },
        { shape: 'circle', x: -30, y: -32, r: 20 },
        { shape: 'circle', x: 30,  y: -34, r: 22 },
      ],
      crouch: [{ shape: 'capsule', x1: -32, y1: -22, x2: 32, y2: -22, r: 20 }],
    },
  },

  stats: { weight: 82, runSpeed: 5.4, airSpeed: 5.6, jumpHeight: 13, doubleJumpHeight: 12,
           airJumps: 2, gravity: 0.5, fallSpeed: 8 },
  movement: { hover: { button: 'jump', frames: 110, fallSpeed: 1.2, drift: 1.15 } },

  resources: {
    charge: { max: 100, start: 0, decay: 0.03, onHit: { perDamage: 2.5 },
              hud: { style: 'bar', label: 'Static', color: '#9fe8ff' } },
  },
  vars: { dischargeCd: 0 },
  sync: [],

  statuses: {
    soaked: { frames: 240, stack: 'refresh', mods: { speed: 0.9, jump: 0.92 }, visual: 'drip', tint: '#4aa3ff' },
  },

  hitboxes: {
    drizzle:   { damage: 1,  angle: 80, knockback: 4,  growth: 0,  effect: 'water', status: 'soaked' },
    bolt:      { damage: 8,  angle: 75, knockback: 30, growth: 74, effect: 'electric' },
    megabolt:  { damage: 13, angle: 80, knockback: 34, growth: 88, effect: 'electric', status: 'stun' },
    ion:       { damage: 2,  angle: 30, knockback: 6,  growth: 0,  effect: 'electric' },
    discharge: { damage: 4,  angle: 60, knockback: 26, growth: 30, effect: 'electric' },
    gust:      { kind: 'wind', push: 5 },
  },

  entities: {
    raincloud: {                                   // lingering zone: rain falls in a column below it
      kind: 'zone', shape: { shape: 'rect', x: 0, y: 0, w: 120, h: 40 }, life: 300, maxAlive: 1,
      motion: { type: 'stationary' }, collide: 'pass',
      hitboxes: [{ shape: 'rect', x: 0, y: 110, w: 110, h: 200, use: 'drizzle', rehit: 30 }],
    },
    strike: {                                      // burst zone: a lightning column at a spot
      kind: 'zone', shape: { shape: 'rect', x: 0, y: -160, w: 30, h: 320 }, life: 18,
      motion: { type: 'stationary', snapToGround: true },
      hitboxes: [{ start: 8, end: 11, shape: 'rect', x: 0, y: -160, w: 40, h: 320, use: 'bolt' }],
    },
    bigStrike: {
      kind: 'zone', shape: { shape: 'rect', x: 0, y: -170, w: 44, h: 340 }, life: 20,
      motion: { type: 'stationary', snapToGround: true },
      hitboxes: [{ start: 8, end: 11, shape: 'rect', x: 0, y: -170, w: 56, h: 340, use: 'megabolt' }],
    },
    ionBeam: {
      kind: 'beam', shape: { shape: 'capsule', x1: 0, y1: 0, x2: 300, y2: 0, r: 12 }, life: 90,
      motion: { type: 'attached' }, anchor: { x: 30, y: -40 }, length: 300, width: 12,
      hitboxes: [{ shape: 'capsule', x1: 0, y1: 0, x2: 300, y2: 0, r: 12, use: 'ion', rehit: 8 }],
    },
  },

  moves: {
    jab:  { name: 'Spit Spark', duration: 16, anim: 'puff', effect: 'electric',
            hitboxes: [{ start: 3, end: 5, x: 34, y: -40, r: 18, damage: 3, angle: 60, knockback: 10, growth: 20 }] },
    side: { name: 'Squall Arm', duration: 26, anim: 'reach',
            hitboxes: [{ start: 7, end: 10, shape: 'capsule', x1: 20, y1: -40, x2: 90, y2: -36, r: 14,
                         damage: 9, angle: 38, knockback: 22, growth: 76, effect: 'water' }] },
    up:   { name: 'Anvil Top', duration: 25, anim: 'tower',
            hitboxes: [{ start: 6, end: 11, x: 0, y: -96, r: 28, damage: 8, angle: 88, knockback: 26, growth: 74 }] },
    down: { name: 'Downpour', duration: 24, anim: 'flatten',
            hitboxes: [{ start: 5, end: 14, shape: 'rect', x: 30, y: -8, w: 90, h: 16, use: 'drizzle', rehit: 4 },
                       { start: 15, end: 16, shape: 'rect', x: 30, y: -8, w: 90, h: 16, group: 9,
                         damage: 4, angle: 70, knockback: 24, growth: 40 }] },

    sideSmash: {                                   // beam if charged, plain thunderhead otherwise
      name: 'Ion Beam', category: 'smash', duration: 40, anim: 'beam',
      requires: { resource: { charge: 20 } }, else: 'thunderhead',
      hold: { button: 'strong', from: 12, to: 22, max: 100 },
      timeline: [{ at: 12, spawn: 'ionBeam', x: 30, y: -40, bindToMove: true }, { at: 12, sfx: 'zap-loop' }],
      update(view, api) {
        if (view.me.move.frame >= 12 && view.input.held('strong')) api.res.add('charge', -0.7);
        if (view.res.charge <= 0) api.endMove();
      },
    },
    thunderhead: { name: 'Thunderhead', category: 'smash', duration: 44, anim: 'swell',
      hitboxes: [{ start: 13, end: 16, x: 40, y: -44, r: 40, damage: 15, angle: 40, knockback: 32, growth: 94, effect: 'electric' }] },
    upSmash: { name: 'Cumulonimbus', duration: 44, anim: 'tower',
      hitboxes: [{ start: 12, end: 18, shape: 'capsule', x1: 0, y1: -40, x2: 0, y2: -150, r: 26,
                   damage: 15, angle: 90, knockback: 32, growth: 92, effect: 'electric' }] },
    downSmash: { name: 'Hailstorm', duration: 42, anim: 'burst',
      hitboxes: [{ start: 11, end: 14, x: 0, y: -24, r: 60, damage: 13, angle: 30, knockback: 30, growth: 88, effect: 'ice' }] },

    nair: { name: 'Pressure Ring', duration: 28, landingLag: 8, anim: 'spin',
      hitboxes: [{ start: 5, end: 17, x: 0, y: -40, r: 44, damage: 1.5, angle: 60, knockback: 6, growth: 0, rehit: 5 },
                 { start: 18, end: 19, group: 9, x: 0, y: -40, r: 46, damage: 4, angle: 45, knockback: 22, growth: 60 }] },
    fair: { name: 'Front Bolt', duration: 28, landingLag: 10, anim: 'reach',
      hitboxes: [{ start: 8, end: 11, x: 50, y: -40, r: 24, damage: 10, angle: 40, knockback: 24, growth: 82, effect: 'electric' }] },
    bair: { name: 'Back Draft', duration: 26, landingLag: 9, anim: 'puffBack', velocity: [{ start: 6, end: 9, vx: 2, mode: 'add' }],
      hitboxes: [{ start: 6, end: 9, x: -52, y: -40, r: 26, damage: 11, angle: 145, knockback: 26, growth: 86 }] },
    uair: { name: 'Sky Sizzle', duration: 26, landingLag: 7, anim: 'tower',
      hitboxes: [{ start: 5, end: 10, x: 0, y: -96, r: 28, damage: 8, angle: 88, knockback: 22, growth: 78, effect: 'electric' }] },
    dair: { name: 'Hail Drop', duration: 32, landingLag: 14, anim: 'drop',
      hitboxes: [{ start: 9, end: 12, x: 0, y: 6, r: 26, damage: 11, angle: 280, knockback: 26, growth: 76, effect: 'ice' }] },

    neutralSpecial: {
      name: 'Call Lightning', duration: 38, anim: 'summon',
      update(view, api) {
        if (view.me.move.frame !== 14) return;
        const foe = view.nearestEnemy();
        const inRange = foe && Math.abs(foe.x - view.me.x) < 420;
        if (inRange && foe.statuses.some((s) => s.name === 'soaked') && view.res.charge >= 30) {
          api.res.add('charge', -30);
          api.spawn('bigStrike', { worldX: foe.x });
          api.emit('thunder', { big: true });
        } else {
          api.spawn('strike', { x: inRange ? (foe.x - view.me.x) * view.me.facing : 160 });
          api.emit('thunder', { big: false });
        }
      },
    },
    sideSpecial: { name: 'Gust Front', duration: 32, anim: 'blow', oncePerAirtime: true,
      velocity: [{ start: 4, end: 10, vx: -3 }],
      hitboxes: [{ start: 6, end: 18, shape: 'rect', x: 90, y: -40, w: 140, h: 60, use: 'gust' }] },
    upSpecial: { name: 'Updraft', duration: 40, anim: 'rise', helpless: true,
      velocity: [{ start: 6, end: 26, vy: -11 }],
      hitboxes: [{ start: 6, end: 26, x: 0, y: -30, r: 34, use: 'drizzle', rehit: 6 }] },
    downSpecial: { name: 'Seed the Clouds', duration: 36, anim: 'summon',
      timeline: [{ at: 14, spawn: 'raincloud', x: 120, y: -170 }, { at: 14, sfx: 'rain-start' }] },

    taunt: { name: 'Rumble', category: 'taunt', duration: 60, anim: 'grumble', timeline: [{ at: 10, emit: 'rumble' }] },
  },

  behavior: {
    tick(view, api) { if (view.vars.dischargeCd > 0) api.vars.set('dischargeCd', view.vars.dischargeCd - 1); },
    onHurt(view, api, ev) {
      // Getting hit while highly charged zaps everything around Nimbus (once per 2 s).
      if (view.res.charge >= 50 && view.vars.dischargeCd === 0 && ev.damage >= 4) {
        api.res.add('charge', -25);
        api.vars.set('dischargeCd', 120);
        api.hit('discharge', { shape: 'circle', x: 0, y: -40, r: 56 }, { frames: 3 });
        api.emit('discharge');
      }
    },
  },

  ai: { preferredRange: 260, zoning: true, recovery: ['upSpecial', 'sideSpecial'], prefer: ['neutralSpecial', 'downSpecial'] },
  art,
});
```

```js
// characters/nimbus/art.js — procedural: layered puffs with sunset rim light, angry face, rain and arcs.
import * as kit from '../../shared/art/kit.js';

const PAL = { dark: '#3b4560', mid: '#5d6a8c', light: '#9aa7c8', rim: '#ffd2a1', eye: '#fff7d6', bolt: '#bff4ff' };
const PUFFS = [[0, -48, 30], [-30, -36, 21], [30, -38, 23], [-14, -62, 19], [16, -64, 20], [0, -26, 26]];

export default {
  rig: 'none',
  bounds: { left: -110, right: 130, top: -170, bottom: 30 },
  palette: { main: PAL.mid, effect: PAL.bolt, outline: '#232842' },
  palettes: [{}, { mid: '#7b6a8c' }, { mid: '#5d8c7a' }, { mid: '#8c6a5d' }],

  draw(ctx, v, info) {
    const { time: t, phase, motion, light } = info;
    const anger = v.state === 'attack' || v.state === 'hitstun' ? 1 : 0;
    const squash = motion.squash;                                      // landing/jump squash from engine
    const swell = phase.name === 'startup' ? phase.t * 0.12 : phase.name === 'active' ? 0.15 : 0;
    const s = v.bodyScale * (1 + swell);
    ctx.save(); ctx.scale(s * (1 + squash * 0.15), s * (1 - squash * 0.15));
    for (const [i, [x, y, r]] of PUFFS.entries()) {                    // back-to-front: dark under, light top
      const bob = Math.sin(t * 2 + i) * 2;
      kit.circle(ctx, x, y + bob + 4, r, PAL.dark);
      const g = ctx.createRadialGradient(x - r * 0.3, y + bob - r * 0.4, r * 0.2, x, y + bob, r);
      g.addColorStop(0, PAL.light); g.addColorStop(1, anger ? '#4a4f6e' : PAL.mid);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y + bob, r, 0, kit.TAU); ctx.fill();
      kit.rimArc(ctx, x, y + bob, r, light.dir, PAL.rim, 2.2, 0.8);
    }
    // face
    const blink = (t % 3.4) < 0.1 ? 0.15 : 1;
    for (const ex of [-9, 9]) kit.ellipse(ctx, 10 + ex, -48, 4.5, 5.5 * blink, PAL.eye);
    ctx.strokeStyle = '#232842'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(1, -58 + anger * 2); ctx.lineTo(14, -55 - anger * 3); ctx.lineTo(27, -58 + anger * 2); ctx.stroke();
    // charge: arcs crawling over the cloud
    const c = v.resources.charge / 100;
    for (let i = 0; i < Math.round(c * 5); i++) kit.lightning(ctx, info.rng, -30 + i * 14, -70, -24 + i * 14, -20, PAL.bolt, 1.5, 0.7);
    ctx.restore();
    // swarm the hitbox: active hitboxes glow so the visual IS the hitbox
    if (phase.name === 'active') for (const hb of info.hitboxes) kit.shapeGlow(ctx, hb, PAL.bolt, 0.35);
  },

  drawWorld(ctx, v, info) {                                            // unclipped: rain streaks below cloud
    if (v.state === 'attack' && v.move?.name === 'Updraft') kit.rain(ctx, info, { x: 0, y: -10, w: 70, h: 120, color: '#8fc3ff' });
  },

  entities: {
    raincloud: { draw(ctx, e, info) { kit.cloudPuffs(ctx, 0, 0, 60, PAL.dark, info.time); kit.rain(ctx, info, { x: 0, y: 10, w: 110, h: 200, color: '#8fc3ff', fade: e.lifeT }); } },
    strike:    { draw(ctx, e, info) { if (e.age >= 6) kit.lightning(ctx, info.rng, 0, -320, 0, 0, PAL.bolt, 6, 1, { branches: 3, glow: 18 }); } },
    bigStrike: { draw(ctx, e, info) { if (e.age >= 6) kit.lightning(ctx, info.rng, 0, -340, 0, 0, '#ffffff', 10, 1, { branches: 5, glow: 30 }); } },
    ionBeam:   { draw(ctx, e, info) { kit.beam(ctx, 0, 0, e.len, 12, PAL.bolt, info.time, { core: '#ffffff', jitter: 3 }); } },
  },

  fx: {
    onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 10, shape: 'spark', color: PAL.bolt, speed: [3, 8], life: [10, 18], blend: 'lighter' }); },
    onEvent: {
      thunder(fx, ev) { fx.flash('#e8fbff', ev.data.big ? 0.3 : 0.15, 4); fx.shake(ev.data.big ? 7 : 3); fx.sound('thunder', { volume: ev.data.big ? 1 : 0.6 }); },
      discharge(fx, ev) { fx.ring({ x: ev.x, y: ev.y - 40, r0: 20, r1: 70, color: PAL.bolt, life: 12 }); },
      rumble(fx, ev) { fx.sound('thunder', { volume: 0.4, pitch: 0.7 }); },
    },
  },
  assets: { thunder: './thunder.ogg' },
  sounds: { jump: 'whoosh', hit: null, 'zap-loop': 'zap', 'rain-start': 'splash' },
  portrait: { x: 4, y: -46, r: 52 },
};
```

### 2.4 Example B: "Grandma Gertie", sprite-sheet heavy grappler

It shows sprite sheets with phase-synced clips, passive armor, armored attacks, a command grab and throws, a pummel, bouncing projectiles, a rolling trap that roots, a battery resource, a hold-to-heal move (budgeted), glide, and a taunt.

```js
// characters/gertie/character.js
// GRANDMA GERTIE — 87 years young, on a souped-up mobility scooter. Throws her dentures,
// rams with the scooter, pinches cheeks, and always has time for tea.
import { defineCharacter } from '../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'gertie',
  name: 'Grandma Gertie',
  author: 'Priya',
  description: 'A grandma on a turbo mobility scooter. Bouncing dentures, scooter rams, cheek pinches and a nice cup of tea.',
  archetype: 'grappler',

  body: {
    collider: { w: 66, h: 98 },
    hurtboxes: {
      default: [{ shape: 'rect', x: 0, y: -30, w: 70, h: 56 }, { shape: 'circle', x: 6, y: -78, r: 20 }],
      crouch:  [{ shape: 'rect', x: 0, y: -30, w: 72, h: 56 }],
    },
    armor: { threshold: 2 },                        // jabs and drizzle don't make Grandma flinch
  },
  stats: { weight: 114, runSpeed: 7.6, airSpeed: 3.6, jumpHeight: 12, doubleJumpHeight: 11,
           airJumps: 1, gravity: 0.8, fallSpeed: 13 },
  movement: { glide: { button: 'jump', frames: 110, fallSpeed: 1.8 } },   // the trusty umbrella

  resources: {
    battery: { max: 100, start: 100, regen: 0.25, regenWhen: 'grounded', regenDelay: 60,
               hud: { style: 'ring', label: 'Battery', color: '#7fe08a' } },
  },

  statuses: {
    tangled: { frames: 45, control: 'root', mods: { jump: 0.8 }, visual: 'yarn', tint: '#e86fa0' },
  },

  hitboxes: {
    chomp:  { damage: 5, angle: 40, knockback: 14, growth: 34, effect: 'normal' },
    yarn:   { damage: 2, angle: 80, knockback: 6, growth: 0, status: 'tangled' },
    pinch:  { damage: 2.5, angle: 0, knockback: 0, growth: 0, setKnockback: 0 },
  },

  entities: {
    dentures: { kind: 'projectile', shape: { shape: 'circle', r: 9 }, life: 120, maxAlive: 2,
                motion: { type: 'ballistic', gravity: 0.45 }, collide: 'bounce', maxBounces: 3,
                hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 11, use: 'chomp' }], maxHits: 1,
                render: { style: 'dentures' } },
    yarnBall: { kind: 'trap', shape: { shape: 'circle', r: 12 }, life: 360, hp: 4, maxAlive: 1,
                motion: { type: 'walker', speed: 2.2, gravity: 0.6 }, collide: 'walk',
                hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 14, use: 'yarn', rehit: 60 }] },
  },

  moves: {
    jab:  { name: 'Purse Poke', duration: 18, anim: 'jab',
            hitboxes: [{ start: 4, end: 6, x: 48, y: -52, r: 18, damage: 4, angle: 50, knockback: 12, growth: 26 }] },
    side: { name: 'Cane Hook', duration: 28, anim: 'cane',
            hitboxes: [{ start: 8, end: 11, shape: 'capsule', x1: 30, y1: -50, x2: 104, y2: -40, r: 13,
                         damage: 10, angle: 35, knockback: 24, growth: 78 }] },
    up:   { name: 'Hat Pin', duration: 26, anim: 'hatpin',
            hitboxes: [{ start: 7, end: 11, shape: 'capsule', x1: 8, y1: -90, x2: 8, y2: -140, r: 12,
                         damage: 8, angle: 90, knockback: 24, growth: 76 }] },
    down: { name: 'Drop Stitch', duration: 30, anim: 'knit', timeline: [{ at: 12, spawn: 'yarnBall', x: 40, y: -12 }] },

    sideSmash: { name: 'Handbag Haymaker', duration: 50, anim: 'handbag', armor: [{ from: 6, to: 15, threshold: 10 }],
      hitboxes: [{ start: 16, end: 19, x: 76, y: -54, r: 32, damage: 17, angle: 38, knockback: 34, growth: 96 }] },
    upSmash: { name: 'Umbrella Pop', duration: 44, anim: 'umbrella',
      hitboxes: [{ start: 11, end: 17, shape: 'circle', x: 0, y: -132, r: 44, damage: 15, angle: 88, knockback: 32, growth: 92 }] },
    downSmash: { name: 'Orthopedic Stomp', duration: 46, anim: 'stomp',
      hitboxes: [{ start: 15, end: 18, shape: 'rect', x: 0, y: -10, w: 200, h: 22, damage: 14, angle: 35, knockback: 30, growth: 90 }] },

    nair: { name: 'Wheelie Spin', duration: 30, landingLag: 12, anim: 'wheelie',
      hitboxes: [{ start: 6, end: 18, x: 0, y: -40, r: 50, damage: 7, angle: 45, knockback: 20, growth: 60 }] },
    fair: { name: 'Rolling Pin', duration: 34, landingLag: 14, anim: 'pin',
      hitboxes: [{ start: 11, end: 14, x: 62, y: -50, r: 28, damage: 13, angle: 38, knockback: 28, growth: 90 }] },
    bair: { name: 'Exhaust Puff', duration: 28, landingLag: 11, anim: 'exhaust',
      hitboxes: [{ start: 7, end: 10, x: -58, y: -24, r: 28, damage: 11, angle: 145, knockback: 28, growth: 86, effect: 'fire' }] },
    uair: { name: 'Hairspray', duration: 28, landingLag: 10, anim: 'spray',
      hitboxes: [{ start: 6, end: 12, x: 6, y: -118, r: 30, damage: 8, angle: 88, knockback: 22, growth: 78 }] },
    dair: { name: 'Scooter Slam', duration: 40, landingLag: 22, anim: 'slam',
      velocity: [{ start: 9, end: 30, vy: 14, untilGrounded: true }],
      hitboxes: [{ start: 10, end: 30, shape: 'rect', x: 0, y: 2, w: 74, h: 24, damage: 12, angle: 285, knockback: 28, growth: 72 }],
      timeline: [{ onLand: true, emit: 'slamDust' }] },

    neutralSpecial: { name: 'Denture Toss', duration: 34, anim: 'toss',
      timeline: [{ at: 13, spawn: 'dentures', x: 30, y: -80, vx: 7, vy: -6 }, { at: 13, sfx: 'chatter' }] },
    sideSpecial: { name: 'Full Throttle', duration: 40, anim: 'ram', oncePerAirtime: true,
      cost: { battery: 35 }, else: 'sputter', armor: [{ from: 4, to: 22, threshold: 8 }],
      velocity: [{ start: 5, end: 24, vx: 12 }],
      hitboxes: [{ start: 6, end: 22, x: 40, y: -36, r: 34, damage: 1.5, angle: 20, knockback: 6, growth: 0, rehit: 4 },
                 { start: 23, end: 25, group: 9, x: 44, y: -36, r: 36, damage: 6, angle: 40, knockback: 30, growth: 70 }],
      cancels: [{ from: 18, to: 24, into: ['jump'], onHit: true }] },
    sputter: { name: 'Sputter', category: 'special', duration: 30, anim: 'sputter', timeline: [{ at: 4, emit: 'sputter' }] },
    upSpecial: { name: 'Umbrella Lift', duration: 44, anim: 'lift', helpless: true,
      velocity: [{ start: 6, end: 28, vy: -11.5, vx: 1.5 }],
      hitboxes: [{ start: 6, end: 12, x: 0, y: -120, r: 36, damage: 6, angle: 85, knockback: 26, growth: 50 }] },
    downSpecial: {                                     // hold to sip tea: heals, but you're a sitting duck
      name: 'Tea Break', duration: 30, anim: 'tea', requires: { grounded: true },
      hold: { button: 'special', from: 10, to: 20, max: 300 },
      update(view, api) { if (view.me.move.frame >= 10 && view.input.held('special')) api.heal(0.05); },
    },

    grab:   { name: 'Cheek Pinch', duration: 34, anim: 'grab',
              hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 56, y: -50, w: 50, h: 60 }] },
    pummel: { name: 'Squeeze', duration: 18, anim: 'pinch', timeline: [{ at: 6, release: 'pinch' }] },
    fthrow: { name: 'Shoo!', duration: 30, anim: 'shoo', timeline: [{ at: 12, release: { damage: 9, angle: 40, knockback: 50, growth: 68 } }] },
    bthrow: { name: 'Over the Shoulder', duration: 36, anim: 'shoulder', timeline: [{ at: 20, release: { damage: 10, angle: 140, knockback: 52, growth: 70 } }] },
    uthrow: { name: 'Up You Go', duration: 32, anim: 'upyougo', timeline: [{ at: 15, release: { damage: 8, angle: 90, knockback: 48, growth: 72 } }] },
    dthrow: { name: 'Sit Down', duration: 34, anim: 'sitdown', timeline: [{ at: 17, release: { damage: 7, angle: 75, knockback: 58, growth: 30 } }] },
    taunt:  { name: 'Back In My Day', duration: 90, anim: 'lecture', timeline: [{ at: 8, emit: 'lecture' }] },
  },

  ai: { preferredRange: 80, grapple: true, recovery: ['upSpecial'], prefer: ['grab', 'sideSpecial'] },
  art,
});
```

```js
// characters/gertie/art.js — painted sprite sheet (2× source res) plus procedural overlays.
import * as kit from '../../shared/art/kit.js';

export default {
  rig: 'none',
  assets: { sheet: './gertie.png', teeth: './teeth.png', chatter: './chatter.ogg', honk: './honk.ogg' },
  sheets: {
    body:  { image: 'sheet', frameW: 256, frameH: 256, cols: 8, anchor: [112, 236], scale: 0.5 },
    teeth: { image: 'teeth', frameW: 48, frameH: 48, cols: 4, anchor: [24, 24], scale: 0.5 },
  },
  clips: {
    body: {
      idle:   { frames: [0, 1, 2, 3], fps: 6, loop: true },
      run:    { frames: [8, 9, 10, 11], fps: 14, loop: true, speedFrom: 'vx' },
      jump:   { frames: [16] }, fall: { frames: [17] }, glide: { frames: [18, 19], fps: 6, loop: true },
      hurt:   { frames: [20] }, tumble: { frames: [21, 22], fps: 10, loop: true },
      shield: { frames: [23] }, crouch: { frames: [24] }, land: { frames: [24] },
      grabbing: { frames: [56] }, grabbed: { frames: [20] }, helpless: { frames: [17] }, taunt: { frames: [60, 61], fps: 4, loop: true },
      jab:      { sync: 'move', startup: [26], active: [27], recovery: [28] },
      cane:     { sync: 'move', startup: [32, 33], active: [34], recovery: [35, 36] },
      handbag:  { sync: 'move', startup: [40, 41, 42], active: [43], recovery: [44, 45], charge: [42] },
      ram:      { sync: 'move', startup: [48], active: [49, 50], recovery: [51] },
      tea:      { sync: 'move', startup: [52, 53], hold: [54, 55], recovery: [53] },
      grab:     { sync: 'move', startup: [56], active: [57], recovery: [58] },
      // unlisted anims fall back: state clip → idle
    },
  },
  bounds: { left: -90, right: 140, top: -170, bottom: 16 },
  palette: { main: '#c9a0dc', effect: '#ffd166', outline: '#3a2340' },

  draw(ctx, v, info) {
    info.sprite.drawClip(ctx, 'body', v);                               // engine picks clip from move.anim/state/phase
    if (v.state === 'run' || v.move?.anim === 'ram') info.fx.local.smoke({ x: -40, y: -14, rate: 0.6, color: '#9a9a9a', size: [4, 9] });
    if (v.resources.battery < 35) kit.blinkIcon(ctx, -20, -112, 'battery-low', info.time);
    if (v.move?.anim === 'ram' && v.move.phase === 'active') kit.speedLines(ctx, -60, -60, 120, 70, '#ffffff', info.time);
  },
  trail(v, info) { return v.move?.anim === 'cane' ? { x: 104, y: -40 } : null; },   // null = hitbox-center default

  entities: {
    dentures: { draw(ctx, e, info) { info.sprite.drawFrame(ctx, 'teeth', (e.age >> 2) % 4, { rotate: e.age * 0.3 }); } },
    yarnBall: { draw(ctx, e, info) { kit.yarnBall(ctx, 0, 0, 12, '#e86fa0', e.age * 0.2, { trail: true }); } },
  },
  fx: {
    onEvent: {
      lecture(fx, ev) { fx.text({ x: ev.x, y: ev.y - 120, text: 'Back in MY day…', color: '#fff', life: 70, size: 16 }); },
      sputter(fx, ev) { fx.burst({ x: ev.x - 30, y: ev.y - 14, count: 8, shape: 'smoke', color: '#555', speed: [1, 2], life: 30 }); fx.sound('honk', { pitch: 0.6 }); },
      slamDust(fx, ev) { fx.ring({ x: ev.x, y: ev.y, r0: 10, r1: 90, color: '#d8c8a8', life: 14, flat: true }); fx.shake(4); },
    },
  },
  sounds: { taunt: 'honk' },
  portrait(ctx, size, info) { info.drawIdle(ctx, { focus: { x: 6, y: -80 }, zoom: size / 90 }); },
};
```

### 2.5 Example C: "Gloop", a shapeshifting slime (forms, body scale, crawl, absorb, counter, clone)

It shows three forms with different bodies, movement and slots; mass driving `bodyScale`; crawl; an absorb hitbox; a counter; a mimic clone; sticky globs; a slot function; and soft-body procedural art.

```js
// characters/gloop/character.js
// GLOOP — a lab slime that won't hold still. BLOB is balanced, PUDDLE is fast and slippery
// (crawls on walls), SPIKE is hard and heavy with a counter. Mass = size: eat projectiles to grow.
import { defineCharacter } from '../../shared/char/api.js';
import art from './art.js';

const BLOB_SLOTS = {};                                // base slots = identity names
export default defineCharacter({
  id: 'gloop',
  name: 'Gloop',
  author: 'Sam',
  description: 'A shapeshifting lab slime. Blob, Puddle or Spike form; eats projectiles to grow; splits off a little copycat.',
  archetype: 'trickster',

  body: {
    collider: { w: 60, h: 66 },
    hurtboxes: {
      default: [{ shape: 'circle', x: 0, y: -30, r: 30 }, { shape: 'circle', x: 0, y: -54, r: 18 }],
      crouch:  [{ shape: 'capsule', x1: -26, y1: -18, x2: 26, y2: -18, r: 18 }],
    },
    scaleRange: [0.8, 1.2],
  },
  stats: { weight: 92, runSpeed: 6.2, airSpeed: 4.8, jumpHeight: 15, doubleJumpHeight: 14, airJumps: 1, gravity: 0.62, fallSpeed: 10.5 },

  forms: {
    puddle: {
      stats: { weight: 80, runSpeed: 8.2, airSpeed: 5.4, jumpHeight: 13, gravity: 0.7 },
      body: { collider: { w: 84, h: 28 },
              hurtboxes: { default: [{ shape: 'capsule', x1: -32, y1: -14, x2: 32, y2: -14, r: 14 }] } },
      movement: { crawl: { frames: 100, speed: 5.5 }, wallCling: { frames: 40 } },
      slots: { jab: 'splash', side: 'slither', up: 'geyser', nair: 'splashRing', neutralSpecial: 'globShot' },
    },
    spike: {
      stats: { weight: 126, runSpeed: 4.8, airSpeed: 3.4, jumpHeight: 12, doubleJumpHeight: 11, gravity: 0.82, fallSpeed: 13.5 },
      body: { collider: { w: 64, h: 80 },
              hurtboxes: { default: [{ shape: 'rect', x: 0, y: -36, w: 60, h: 60 }, { shape: 'circle', x: 0, y: -72, r: 14 }] } },
      armor: { threshold: 3 },
      slots: { jab: 'needle', side: 'lance', sideSmash: 'urchin', neutralSpecial: 'bristle' },
    },
  },

  resources: {
    mass: { max: 100, start: 60, regen: 0.04, onHurt: { perDamage: -0.6 },
            hud: { style: 'pips', label: 'Mass', color: '#7dff9a' } },
  },

  statuses: {
    sticky: { frames: 90, stack: 'refresh', mods: { speed: 0.7, jump: 0.8 }, visual: 'goo', tint: '#7dff9a' },
  },

  hitboxes: {
    goo:   { damage: 4, angle: 45, knockback: 12, growth: 30, effect: 'poison', status: 'sticky' },
    spine: { damage: 6, angle: 40, knockback: 18, growth: 50, effect: 'slash' },
    eat:   { kind: 'absorb' },
  },

  entities: {
    glob: { kind: 'projectile', shape: { shape: 'circle', r: 8 }, life: 80, maxAlive: 3,
            motion: { type: 'ballistic', gravity: 0.35 }, collide: 'stick',
            hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 10, use: 'goo' }],
            onExpire: [{ spawn: 'puddleTrap' }] },
    puddleTrap: { kind: 'trap', shape: { shape: 'rect', x: 0, y: -4, w: 60, h: 8 }, life: 240, hp: 3, maxAlive: 2,
                  motion: { type: 'stationary', snapToGround: true },
                  hitboxes: [{ shape: 'rect', x: 0, y: -4, w: 60, h: 10, damage: 1, angle: 90, knockback: 0, growth: 0,
                               setKnockback: 0, status: 'sticky', rehit: 60 }] },
    gloopling: { kind: 'clone', shape: { shape: 'circle', x: 0, y: -20, r: 20 }, life: 480, hp: 12, maxAlive: 1,
                 motion: { type: 'mimic', delay: 18 }, scale: 0.6 },
  },

  moves: {
    // ── BLOB (base) ──
    jab:  { name: 'Jiggle Jab', duration: 16, anim: 'poke',
            hitboxes: [{ start: 3, end: 5, x: 32, y: -34, r: 16, damage: 3, angle: 60, knockback: 10, growth: 20 }] },
    side: { name: 'Stretch Slap', duration: 26, anim: 'stretch',
            hitboxes: [{ start: 7, end: 10, shape: 'capsule', x1: 20, y1: -34, x2: 96, y2: -30, r: 14, damage: 9, angle: 38, knockback: 22, growth: 78 }] },
    up:   { name: 'Bubble Pop', duration: 25, anim: 'tall',
            hitboxes: [{ start: 6, end: 10, x: 0, y: -86, r: 26, damage: 8, angle: 88, knockback: 24, growth: 76 }] },
    down: { name: 'Ooze Sweep', duration: 22, anim: 'flat',
            hitboxes: [{ start: 6, end: 9, shape: 'rect', x: 34, y: -8, w: 76, h: 16, use: 'goo' }] },
    sideSmash: { name: 'Haymaker Pseudopod', duration: 46, anim: 'pod',
            hitboxes: [{ start: 14, end: 17, shape: 'capsule', x1: 30, y1: -36, x2: 120, y2: -40, r: 22, damage: 16, angle: 38, knockback: 34, growth: 94 }] },
    upSmash: { name: 'Geyser Burst', duration: 44, anim: 'geyser',
            hitboxes: [{ start: 12, end: 17, shape: 'capsule', x1: 0, y1: -30, x2: 0, y2: -140, r: 26, damage: 15, angle: 90, knockback: 32, growth: 92 }] },
    downSmash: { name: 'Splat', duration: 42, anim: 'splat',
            hitboxes: [{ start: 11, end: 14, shape: 'rect', x: 0, y: -10, w: 190, h: 22, damage: 13, angle: 30, knockback: 30, growth: 88 }] },
    nair: { name: 'Wobble', duration: 28, landingLag: 8, anim: 'wobble',
            hitboxes: [{ start: 5, end: 16, x: 0, y: -34, r: 40, damage: 7, angle: 50, knockback: 18, growth: 60 }] },
    fair: { name: 'Lunge Lobe', duration: 28, landingLag: 10, anim: 'pod',
            hitboxes: [{ start: 8, end: 11, x: 48, y: -36, r: 24, damage: 10, angle: 40, knockback: 24, growth: 84 }] },
    bair: { name: 'Back Blorp', duration: 26, landingLag: 9, anim: 'blorp',
            hitboxes: [{ start: 6, end: 9, x: -48, y: -34, r: 24, damage: 11, angle: 145, knockback: 26, growth: 86 }] },
    uair: { name: 'Drip Up', duration: 26, landingLag: 7, anim: 'tall',
            hitboxes: [{ start: 5, end: 10, x: 0, y: -88, r: 26, damage: 8, angle: 86, knockback: 22, growth: 78 }] },
    dair: { name: 'Anvil Drip', duration: 32, landingLag: 14, anim: 'drop',
            hitboxes: [{ start: 9, end: 12, x: 0, y: 4, r: 24, damage: 11, angle: 275, knockback: 24, growth: 76 }] },

    neutralSpecial: {                                // eats projectiles: grows (mass) instead of healing
      name: 'Engulf', duration: 34, anim: 'gulp',
      hitboxes: [{ start: 6, end: 20, shape: 'circle', x: 30, y: -34, r: 36, use: 'eat' }],
      onAbsorb: [{ resource: { name: 'mass', add: 15 } }, { emit: 'gulp' }],
    },
    sideSpecial: { name: 'Bounce Off', duration: 32, anim: 'bounce', oncePerAirtime: true,
            velocity: [{ start: 4, end: 16, vx: 10, vy: -4 }],
            hitboxes: [{ start: 5, end: 15, x: 20, y: -30, r: 30, damage: 7, angle: 50, knockback: 22, growth: 50 }] },
    upSpecial: { name: 'Slingshot', duration: 42, anim: 'sling', helpless: true,
            hold: { button: 'special', from: 4, to: 8, max: 30 },
            timeline: [{ from: 10, to: 24, steer: { speed: 11, turn: 0.18 } }],
            hitboxes: [{ start: 10, end: 24, x: 0, y: -30, r: 28, damage: 6, angle: 70, knockback: 24, growth: 40 }] },
    downSpecial: {                                   // cycles forms: blob → puddle → spike → blob
      name: 'Morph', duration: 24, anim: 'morph',
      update(view, api) {
        if (view.me.move.frame !== 10) return;
        const next = { base: 'puddle', puddle: 'spike', spike: 'base' }[view.me.form];
        api.form(next);
      },
    },
    taunt: { name: 'Split Off', category: 'utility', duration: 40, anim: 'split', cost: { mass: 30 }, else: 'jiggle',
             timeline: [{ at: 18, spawn: 'gloopling', x: -40, y: 0 }] },
    jiggle: { name: 'Jiggle', category: 'taunt', duration: 30, anim: 'wobble' },

    // ── PUDDLE ──
    splash:     { name: 'Splash', category: 'jab', duration: 14, anim: 'p_splash',
                  hitboxes: [{ start: 2, end: 4, shape: 'rect', x: 30, y: -10, w: 50, h: 20, damage: 2.5, angle: 70, knockback: 10, growth: 18 }] },
    slither:    { name: 'Slither Trip', category: 'tilt', duration: 24, anim: 'p_slither', velocity: [{ start: 4, end: 12, vx: 7 }],
                  hitboxes: [{ start: 5, end: 12, shape: 'rect', x: 30, y: -8, w: 60, h: 16, damage: 7, angle: 80, knockback: 30, growth: 40 }] },
    geyser:     { name: 'Puddle Geyser', category: 'tilt', duration: 28, anim: 'p_geyser',
                  hitboxes: [{ start: 8, end: 12, shape: 'capsule', x1: 0, y1: 0, x2: 0, y2: -110, r: 18, damage: 8, angle: 90, knockback: 26, growth: 70 }] },
    splashRing: { name: 'Splash Ring', category: 'aerial', duration: 26, landingLag: 6, anim: 'p_ring',
                  hitboxes: [{ start: 4, end: 14, shape: 'capsule', x1: -40, y1: -12, x2: 40, y2: -12, r: 18, damage: 6, angle: 60, knockback: 18, growth: 50 }] },
    globShot:   { name: 'Glob Shot', category: 'special', duration: 30, anim: 'p_spit',
                  timeline: [{ at: 10, spawn: 'glob', x: 24, y: -16, vx: 8, vy: -4 }] },

    // ── SPIKE ──
    needle: { name: 'Needle', category: 'jab', duration: 18, anim: 's_needle',
              hitboxes: [{ start: 4, end: 6, shape: 'capsule', x1: 20, y1: -40, x2: 70, y2: -40, r: 8, use: 'spine' }] },
    lance:  { name: 'Lance', category: 'tilt', duration: 30, anim: 's_lance',
              hitboxes: [{ start: 9, end: 12, shape: 'capsule', x1: 20, y1: -40, x2: 120, y2: -40, r: 10, damage: 11, angle: 35, knockback: 26, growth: 80, effect: 'slash' }] },
    urchin: { name: 'Urchin Burst', category: 'smash', duration: 50, anim: 's_urchin', armor: [{ from: 6, to: 16, threshold: 12 }],
              hitboxes: [{ start: 17, end: 20, x: 0, y: -40, r: 66, damage: 17, angle: 45, knockback: 34, growth: 94, effect: 'slash' }] },
    bristle: { name: 'Bristle', category: 'counter', duration: 40, anim: 's_bristle',
               counter: { from: 4, to: 20, then: 'bristleHit', mul: 1.2 } },
    bristleHit: { name: 'Bristle!', category: 'counter', duration: 30, anim: 's_urchin',
                  hitboxes: [{ start: 2, end: 5, x: 0, y: -40, r: 60, damage: 8, angle: 40, knockback: 30, growth: 80, counterScale: true }] },
  },

  slots: {
    ...BLOB_SLOTS,
    // In blob form, side special is a dash; at very low mass it's the same move (data-only variants are fine too).
    upSpecial: (view) => (view.me.form === 'spike' ? 'upSpecial' : 'upSpecial'),
  },

  behavior: {
    tick(view, api) { api.setBodyScale(0.8 + 0.4 * (view.res.mass / 100)); },
    onKO(view, api) { api.form('base'); },
  },

  ai: { recovery: { base: ['upSpecial', 'sideSpecial'], puddle: ['upSpecial'], spike: ['upSpecial'] }, prefer: ['neutralSpecial'] },
  art,
});
```

```js
// characters/gloop/art.js — soft-body gel (shared/art/helpers/blob.js) that springs toward the current hurtbox shapes.
import * as kit from '../../shared/art/kit.js';
import { blob } from '../../shared/art/helpers/blob.js';

const GEL = { base: '#57e389', deep: '#1f8a4c', spec: '#eafff1', outline: '#0f4a29', eye: '#0b1f14' };

export default {
  rig: 'none',
  bounds: { base: { left: -100, right: 150, top: -170, bottom: 16 },
            puddle: { left: -110, right: 150, top: -130, bottom: 12 },
            spike: { left: -110, right: 150, top: -150, bottom: 16 } },
  palette: { main: GEL.base, effect: '#7dff9a', outline: GEL.outline },
  palettes: [{}, { base: '#e35798', deep: '#8a1f56' }, { base: '#57a6e3', deep: '#1f4f8a' }, { base: '#e3c457', deep: '#8a6f1f' }],

  init(cache) { cache.gel = blob.create({ points: 28, stiffness: 0.18, damping: 0.82, seed: 3 }); },

  draw(ctx, v, info) {
    const target = info.phase.name === 'active' && info.hitboxes.length ? [...info.hurtboxes, ...info.hitboxes] : info.hurtboxes;
    blob.step(info.cache.gel, { shapes: target, dt: info.dt, impulse: info.motion, wobble: v.state === 'hitstun' ? 2 : 0.6 });
    const path = blob.path(info.cache.gel);
    // body: deep core → base → specular, translucent inner bubbles
    kit.fillPath(ctx, path, kit.radial(ctx, 0, -40, 10, 70, [GEL.base, GEL.deep]), { outline: GEL.outline, lineWidth: 3 });
    ctx.save(); ctx.clip(path);
    for (let i = 0; i < 6; i++) kit.circle(ctx, Math.sin(info.time * 0.7 + i * 2) * 20, -20 - ((info.time * 12 + i * 17) % 50), 2 + (i % 3), 'rgba(255,255,255,0.25)');
    kit.rimLightPath(ctx, path, info.light.dir, GEL.spec, 3, 0.6);
    ctx.restore();
    if (v.form === 'spike') blob.spikes(ctx, info.cache.gel, { count: 12, length: 12, color: GEL.deep, outline: GEL.outline });
    // face rides the topmost blob point; squints when attacking
    const top = blob.top(info.cache.gel);
    const sq = v.state === 'attack' ? 0.4 : 1;
    kit.ellipse(ctx, top.x + 6, top.y + 14, 4, 6 * sq, GEL.eye); kit.ellipse(ctx, top.x + 18, top.y + 14, 4, 6 * sq, GEL.eye);
    for (const s of v.statuses) if (s.name === 'sticky') info.tint('#7dff9a', 0.15);
  },

  entities: {
    glob:       { draw(ctx, e, info) { kit.droplet(ctx, 0, 0, 8, GEL.base, Math.atan2(e.vy, e.vx), GEL.outline); } },
    puddleTrap: { draw(ctx, e, info) { kit.goo(ctx, 60, 8, GEL.base, info.time, e.lifeT); } },
    gloopling:  { draw(ctx, e, info) { info.drawSelf(ctx, e.view, { scale: 0.6, alpha: 0.85 }); } },   // re-uses draw() with the clone's view
  },
  fx: {
    onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 8, shape: 'drip', color: GEL.base, speed: [2, 6], gravity: 0.3, life: [20, 30] }); },
    onEvent: { gulp(fx, ev) { fx.sound('gulp'); fx.ring({ x: ev.x + 30, y: ev.y - 34, r0: 40, r1: 10, color: '#7dff9a', life: 10 }); } },
    onFormChange(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 30, count: 20, shape: 'drip', color: GEL.base, speed: [3, 7], gravity: 0.35, life: 30 }); },
  },
  sounds: { gulp: 'splash', jump: 'boing' },
};
```

---

## 3. Simulation model and exact engine changes

### 3.1 Module layout (`shared/sim/`)

| file | owns | replaces (game.js) |
|---|---|---|
| `game.js` | `Game` facade with the same constructor and `step/setInput/snapshot/roster/drainEvents`, plus fixed step order | — |
| `fighter.js` | `createFighter`, timers, respawn, `setForm`, `effectiveStats(f)` | createFighter, updateDead, updateRespawn |
| `states.js` | closed state enum, `groundLogic`, `airLogic`, `setState` (throws in dev on an unknown state) | groundLogic, airLogic, setState |
| `input-map.js` | `detectTrigger(f)`, `resolveMove(f, trigger)` | :175-188, :265-271, :295-306 |
| `actions.js` | action interpreter (`startAction`, `updateAction`, `endAction`, cancels, hold, charge, counter, grab/throw flow) | startMove, startSpecial, updateAttack |
| `movement.js` | gravity, drift, movement modes, air budget hooks | drift, gravity |
| `physics.js` | `integrate`, `collide` (collider), `touchGround`, `land`, `leaveGround` | integrate, collide, touchGround, land, leaveGround |
| `shapes.js` | `mirror(shape, facing, scale, x, y)`, `overlap(a, b)` for circle/capsule/rect (SAT and segment distance), `aabb(shape)` | circleRect |
| `hurtbox.js` | `hurtShapes(f)` (set selection, overrides, scale), area lookup | hurtbox |
| `hits.js` | `collectHits(game)`, `resolveHits(game)`, kind resolution, `applyHit` pipeline | activeHitboxes, resolveHits, applyHit, staleMultiplier |
| `entities.js` | entity store, motions, collide modes, clones, parts, beams | spawnProjectile, updateProjectiles |
| `status.js` | apply, tick, expire, `statMods(f)` | — |
| `resources.js` | resource tick, `res.add/set`, vars validation | — |
| `governor.js` | every runtime cap (§4.2) | — |
| `ko-table.js` | `buildKoTable(stage, gravity, fallSpeed)` | — |
| `script-api.js` | views, api objects, command queue, timing, error isolation | — |
| `guard.js` | `simGuard`: wraps `Math.random`, `Date.now`, `performance.now` to throw while character sim code runs | — |
| `rng.js` | `mulberry32(seed)`, `hash32(str)` | — |
| `snapshot.js` | `snapshot(game)`, `roster(game)`, name tables | snapshot, roster |
| `ai.js` | CPU (uses `game.rng`, IR metadata) | — |

The `Game` constructor signature stays the same. The new optional `rules` fields are: `seed` (default: hash of player ids and stage id), `governor = true`, `grabs = true`, and `legacyKo = false` (golden replay mode).

### 3.2 Fixed step order (`Game.step`)

```
0  if countdown: tick countdown; return
1  for f in fighters (index order):
     input: prev = input; input = cpu ? ai.think(f) : pending; heldFrames[b]++ or 0; buffer edges
     if f.hitlag > 0: f.hitlag--; continue
     status.tick(f)                 // DoT goes through Governor.applyDot; control statuses set f.control
     resources.tick(f)
     states.update(f)               // timers, shield, dead/respawn, ground/air logic → actions.update(f)
                                    //   actions.update: charge → hold → timeline → velocity/gravity windows
                                    //   → cancels → move.update(view, api) → end check
     script.flush(f)                // apply queued commands from move.update
     script.run(f, 'tick'); script.flush(f)
     movement.update(f)             // modes (hover/glide/fly/cling/crawl), gravity, drift, Governor.air
     physics.integrate(f)           // kx/ky decay, pos += v+k, collide(collider)
2  entities.update(game)            // id order: motion → think(view,e,api) → flush → every → stage collide → life/expire
3  hits.resolve(game)               // collect → kind resolution → Governor.applyHit → queue onHit/onHurt events
4  for f: script.run(f, 'onHit'/'onHurt' per queued event); entity onHit lists; script.flushAll()
5  checkBlastZones (collider top/sides/bottom) → ko(f) → script onKO → despawn owner's minions/clones/zones/beams
   respawn transitions → script onRespawn
6  governor.endFrame(game)          // ring buffer cursors, budget windows
7  checkMatchEnd
```
All iteration orders are fixed: fighters by index, entities by id, hitboxes by list index. No logic may depend on object key order. Keyed maps are iterated through arrays of names sorted at IR build time.

### 3.3 Fighter record (`fighter.js`)

These fields are added to the v1 record:

```ts
form: string, formCd: int,
res: Float64Array (declared order), vars: object (validated), statuses: StatusInst[],
mods: { speed, jump, gravity, fallSpeed, damageIn, damageOut, knockbackIn }  // recomputed each frame, clamped
bodyScale: number, hurtSet: string|null,
action: ActionInst|null,       // {def, name, frame, loops, holdFrames, chargeFrames, hitKeys:Set, hitSomething, counterArmed}
armorPassive: number, control: null|'stun'|'freeze'|'root'|'silence'|'confuse', controlFrames: int,
air: { rise: number, stall: int, teleports: int, flyFuel: int, hoverFrames: int, glideFrames: int, clingUsed: bool, crawlFrames: int },
grab: null | { role: 'grabbing'|'grabbed', other: id, frames: int, max: int },
gov: GovernorFighterState,     // §4.2
heldFrames: Int16Array(10), scriptsDisabled: bool, scriptFaults: int
```
`stats` is now `effectiveStats(f)`: the form's stats × status/mod multipliers, clamped. **Only `governor.js` and `fighter.ko/respawn` may write `percent` and `stocks`.** In debug builds this is enforced with a setter assertion.

### 3.4 States (`states.js`), a closed enum

`idle run crouch jumpsquat air land attack shield roll spotdodge airdodge hitstun helpless shieldbreak dead respawn grabbing grabbed stunned glide fly wallcling crawl taunt`

- `hover` is a flag on `air`. `taunt` is an `attack` whose category is `taunt`; the state exists only for art.
- `stunned` covers stun and freeze; `f.control` tells them apart for art. Root and silence are flags, not states.
  - root: horizontal input is ignored.
  - silence: special triggers are ignored.
  - confuse: left and right are swapped in `input-map`.
- Actionable states are the same as in v1: idle, run, crouch, and air.
- Priority order is unchanged from v1, with one addition. On the ground, shield+attack resolves to the `grab` trigger before shield and roll when `rules.grabs` is on. Taunt has the lowest priority, grounded only.
- `setState` keeps `f.action` only for `attack`, `grabbing` and `taunt`.

### 3.5 Input mapping (`input-map.js`)

```js
detectTrigger(f) -> Trigger|null     // identical logic to v1 lines, emitting names instead of starting moves
resolveMove(f, trigger) -> ActionDef // name = form.slots[t] ?? base.slots[t] ?? t; SlotFn evaluated under simGuard;
                                     // def = ir.moves[name] ?? generic(t); then requires/cost → else
```
- `oncePerAirtime` is tracked per move name, in `f.air.used: Set` (reset on landing or when hit).
- v1's `usedSideSpecial` becomes `oncePerAirtime` on the move routed from sideSpecial. It is reset on landing and in `applyHit`, matching v1.

### 3.6 Action interpreter (`actions.js`)

`startAction(f, def, {trigger})`:
1. Pay `cost`.
2. Set `f.action`.
3. Enter `attack` (or `grabbing` for throws).
4. Grounded non-special/recovery categories halve vx (v1 behavior).
5. Emit `{type:'move', id, name, trigger}`.

`updateAction(f)` runs each frame (`a = f.action`, `t = a.frame`):
1. **charge.** If `def.charge` and `t === charge.at` and the button is held and `a.chargeFrames < charge.max`: increment `a.chargeFrames` and **return** (the frame is frozen).
2. **hold.** If `def.hold` and `t === hold.to` and the button is held and `a.holdFrames < hold.max`: set `a.frame = hold.from` and add the elapsed loop length to `holdFrames`. On release while `hold.from ≤ t ≤ hold.to`: jump to `release` (a move switches the action; a frame number jumps there).
3. **timeline.** Run entries where `at === t`, or where `from ≤ t ≤ to` and `(t − from) % every === 0`. `onLand` entries fire from `physics.touchGround`. `onHit` entries fire when the action's first hit connects.
4. **velocity and gravity windows.** Same as v1. `mode:'add'` adds instead of setting. `untilGrounded` stops at landing. Every self-velocity write goes through `Governor.selfVelocity(f, vx, vy, source)` (§4.2.5).
5. **cancels.** If the frame is inside a window, the `onHit` condition holds, and the buffered trigger or button resolves to a move in `into` (or `'jump'`/`'shield'`/`'any'`): start it.
6. **update script** under simGuard and timing.
7. `a.frame++`. If `a.frame ≥ duration`: start `next` if set; otherwise end. On end, if airborne and `helpless`, go to `helpless`; otherwise go to `idle`/`air`. Aerial landing lag works as in v1 (`touchGround`).

**3.6.1 Hit shapes for an action.** `activeHitboxes(f)` yields boxes with `start ≤ t ≤ end`, mirrored and scaled. Boxes with `rehit` produce a key `${target}:${group}:${floor((t−start)/rehit)}`; boxes without it produce `${target}:${group}` (v1). One-shot `hit` timeline entries and `api.hit` boxes enter `f.extraHits` with a frame count.

**3.6.2 Grabs and throws.**
- A `kind:'grab'` box hits grounded, non-intangible targets that are not already grabbed. Add `air:true` on the hitbox to also hit airborne targets. Grabs beat shields.
- On connect:
  - attacker: state `grabbing`, `grab.max = clamp(30 + 0.35·p_target, 30, 120)` frames.
  - target: state `grabbed`, held at `def.throw?.holdAt ?? box center`.
  - Each new press of any button by the target subtracts 3 frames.
- While grabbing:
  - `attack` → the `pummel` trigger (at most once per 14 frames).
  - Forward/back/up/down relative to facing → `fthrow`/`bthrow`/`uthrow`/`dthrow`.
  - When `grab.frames ≥ grab.max`: release. Both fighters get 12 frames of pushback at 6 px/frame, and the target gets 10 frames of grab immunity.
- A throw's `release` timeline entry is applied as a `throw`-tier hit through the Governor. It ignores the target's shield and intangibility only when the target is `grabbed`.
- If either fighter is hit by a third party during the grab, both are released.
- Grab-vs-grab in the same frame: both release (the grabs tech).
- Strike-vs-grab in the same frame: the strike wins.

**3.6.3 Counter.**
- During `counter.from ≤ t ≤ counter.to`, an incoming `strike` from a fighter, entity or script (not grab, wind, DoT or throw) is **cancelled** (no damage or knockback) if `Governor.intangibleRequest(f, 12)` succeeds.
- If the attacker was a melee fighter, they take 20 frames of hitlag.
- The defender switches to `counter.then` with `f.action.counterIn = min(incoming, 25)`.
- Hitboxes with `counterScale` deal `clamp(max(hb.damage, counterIn × mul), 0, CATEGORIES.counter.maxHit = 15)`.
- If the intangibility budget is empty, the counter fails and the hit lands normally.
- Emits `{type:'counter'}`.

**3.6.4 Armor** is flinch-only (§4.2.7). Windows come from `def.armor`, `timeline armor` and `api.armor`, all checked by `Governor.armorAt(f)`.

### 3.7 Hurtboxes (`hurtbox.js`) and collider

- `hurtShapes(f)` → mirrored, scaled world shapes. The set is chosen in the order given in §2.2.3.
- The validator precomputes each set's union area `A[set]` on a 2 px raster, deterministically. Runtime area is `A[set] · bodyScale²`.
- If runtime area < `BODY_LIMITS.minArea (1600)`, or < `0.6 × A[default] × scaleMin²`, each such frame is charged 1 frame to the intangibility budget (§4.2.6). If the budget is empty, the engine falls back to `default` shapes for that frame.
- The collider (`body.collider × bodyScale`) handles all stage physics, the auto ledge-snap and the blast-zone top check (`f.y − collider.h·bodyScale`).
  - When a form change or scale increase makes the collider overlap the main ground, the fighter is pushed up out of it.
  - Crouch shrinks the collider to 0.68 height (v1).
- Crouch hurtboxes: the `crouch` set, or the v1 rule when no set is given.

### 3.8 Movement modes (`movement.js`)

Every mode below is engine code, and every frame spent in it is charged to the air budget (§4.2.5).

**hover**
- Active when airborne with vy > 0, the button is held, and `air.hoverFrames < frames`.
- vy is capped at `fallSpeed`, and drift is multiplied by `drift`.

**glide**
- Entered with the same condition as hover. State `glide`.
- vx approaches `facing·speed·airSpeed`. vy is capped at `fallSpeed`, and up/down tilts the glide by ±`turn`·vx.
- Exits on release, landing, any attack (only aerials may be used from glide; it exits to `air`), or running out of frames.

**fly**
- While the button is held and `air.flyFuel > 0`: `vy = max(vy − thrust, −maxRise)`, and horizontal speed is `airSpeed`. State `fly`.
- Fuel is spent 1 per frame. It refills only on landing.
- Rise is charged through `Governor.selfVelocity`.

**wallCling**
- Triggers when touching a side face of `stage.ground` while airborne, with `!air.clingUsed`.
- vy = 0.4 for `frames`. Jump does a wall jump (`vx = −facing·jumpVx`, `vy = −jumpVy`), and the wall jump does not cost an air jump.

**crawl**
- Triggers when touching a side face or the underside of the ground, with crawl enabled, while holding toward the surface.
- State `crawl`: the fighter moves along the surface at `speed`, for up to `frames` per airtime. Jump detaches with a wall jump.
- Crawl does not reset jumps or air budgets.

Being hit exits every mode. Only engine-recognized states can result, which removes v1's fall-through problem.

### 3.9 Entities (`entities.js`)

Record:
```ts
{ id (game-wide counter), owner, ownerIdx, name, def, kind, x, y, vx, vy, angle, age, life, hp, hits, bounces,
  facing, tier, hitKeys: Set, vars: {} (≤4 synced keys), bindToMove: actionInstId|null, stuck, reflected }
```

- `spawn(owner, name, opts)`:
  1. Run `Governor.spawnRequest(owner, def, count)`. It may expire older entities or refuse.
  2. Resolve the position: owner feet plus mirrored offset, clamped to 160 px. `worldX` (from scripts) is clamped to within 600 px of the owner.
  3. Velocity is mirrored by facing. `aimAt` rotates the velocity toward the target.
  4. The tier comes from the spawning action's category, or from `ENTITY_LIMITS[kind].tier` for spawns made by hooks, `think` or `every`.

Motions:

| type | behavior |
|---|---|
| ballistic | `vy += gravity` (≤ 0.8) |
| linear | `v += accel` along the heading, speed ≤ maxSpeed |
| homing | after `delay` frames, rotate the heading toward the target by ≤ `turn` (≤ 0.12 rad/f), plus seeded `wobble` |
| orbit | position = owner center + radius·(cos, sin)(age·speed) |
| attached | position = owner feet + mirrored anchor. Beams also take their facing from the owner. |
| stationary | `snapToGround` places the entity on the surface directly below (ground or platform) |
| walker | gravity, walks along surfaces at `speed`, turns at ledges |
| boomerang | linear out for `out` frames, then homes to the owner, despawning on contact |
| mimic | clones only (§3.9.2) |

Collide modes, checked against the main ground and against platforms when `platforms: true`:

| mode | behavior |
|---|---|
| die | v1 behavior |
| bounce | reflect velocity × 0.8, up to `maxBounces` bounces |
| stick | velocity becomes 0 and the entity stays until life ends |
| walk | as walker |
| pass | no collision |

Life and death:
- When `life` runs out: fire `onExpire` and despawn.
- When `hp` reaches 0: fire `onDeath` and despawn.
- Each time an entity hitbox lands a hit: fire `onHit`, increment `hits`, and despawn when `hits > maxHits + pierce`.

Melee and entity interactions (in `hits.js`):
- An enemy `strike` hitbox overlapping an enemy entity:
  - If the entity has hp, it takes the damage. Entities take no knockback, except clones, which take kb.
  - Otherwise, if `clank` (default true), the entity is destroyed. This is v1 behavior.
- A `reflect` box flips `owner`, negates velocity (speed ×1.1, still capped), sets `reflected` (damage ×1.25 once), and keeps the tier.
- An `absorb` box destroys an absorbable entity and fires the action's `onAbsorb`.
- Entity vs entity: only `clash: true` pairs from different owners destroy each other.
- When the owner is KO'd: all minions, clones, zones, beams and parts despawn. Projectiles and traps persist.

`bindToMove` entities despawn when the binding action ends. A beam also despawns if its owner is hit, unless the owner has armor active.

**3.9.1 Parts.** A part is `kind:'part'`, `motion:'attached'`, and has its own hurtbox.
- `relay = 1`: hits on the part are treated **exactly** as hits on the core (damage plus knockback). These are extra hurtbox shapes, so they are allowed with any life, including permanent.
- `relay` in `[0.5, 1)`: requires `hp ≤ 25` and `life ≤ 900`.
  - A hit on the part applies `damage × relay` to the core, with no knockback or hitstun, and costs the part hp equal to the full damage.
  - The prevented portion `(1 − relay) × damage` is charged to the owner's mitigation budget. When that budget is empty, relay becomes 1 (full hit).
  - When the part's hp reaches 0, it despawns and the template has a 300-frame cooldown.

This closes the "relay-0 permanent wall" hole.

**3.9.2 Clones (mimic).**
- A clone is a "minor fighter" created with `fighter.createMinor(owner, def)`. It has its own position, velocity, collider and hurtbox (the owner's base shapes × `scale`), plus `hp` instead of percent and stocks.
- Every frame it receives the owner's input from `delay` frames earlier (from a ring buffer) and runs the same state machine and action interpreter, with the owner's IR and the owner's current form.
- Restrictions:
  - Clone hits deal damage × 0.5 and knockback/growth × 0.7, and use the `clone` tier.
  - Clones cannot grab, spawn clones, change form, or run behavior hooks. Move `update` scripts run, but `api.spawn` is limited to non-clone entities and counts against the **owner's** budget.
  - Clones take damage into hp and receive knockback. They die at hp 0, at a blast zone, or at end of life.
  - Clones have no stocks.

### 3.10 Statuses (`status.js`)

- `apply(target, name, {frames, power, source})` runs through `Governor.statusRequest`. That check covers per-target caps, diminishing returns and immunity.
- Stacking: `refresh` resets the frame count, `add` adds a stack (up to maxStacks) and refreshes frames, `ignore` leaves an existing instance alone.
- `tick`:
  - DoT: every `every` frames, call `Governor.applyDot(source, target, damage)`. DoT uses the `status` tier, has no knockback, counts toward the rate limit, and does not increase combo n.
  - Control: set `f.control`. Stun and freeze force `stunned`.
  - Heal: `Governor.heal`.
- `statMods(f)` multiplies the mods from all active statuses with `api.modify` sets, then clamps each to its §4.2.9 range.
- Everything clears on KO.

### 3.11 Resources and vars (`resources.js`)

- `tick` applies regen (after `regenDelay` frames since the last spend, and only if `regenWhen` matches) and decay. Values are clamped to `[min, max]`.
- `onHit`/`onHurt` `perDamage` adds are applied after each hit, using the governed damage.
- `soak` is applied inside the Governor (§4.2.6).
- `res.add` and `res.set` take effect **immediately**, because they only touch the fighter's own non-power state.
- `vars.set(k, v)`:
  - The key must have been declared.
  - The type must match the initializer's type.
  - Strings are truncated to 24 characters. Non-finite numbers are rejected (no-op plus a warning). Numbers are clamped to ±1e6.
  - The serialized total must stay ≤ 2 KB; otherwise the set is rejected.
- `resetOnRespawn` resources go back to `start` on respawn. Vars reset to their initializers on respawn.

### 3.12 Scripting (`script-api.js`)

**3.12.1 Where code may run.** Code may run in these places, all on the sim side:
- `move.update`
- `entity.think`
- `behavior.*`
- `SlotFn`
- `ai.hint`

Each call is wrapped:
```js
guard.enter(fighterIdx); t0 = clock();      // clock = captured original performance.now
try { fn(view, api, ev) } catch (e) { onFault(f, e) }
finally { guard.exit(); budget.add(f, clock() - t0) }
```

- **Faults.** After 3 throws, or 1 call longer than 8 ms, or an average above 1 ms per tick over 60 ticks, all of that fighter's scripts (and its entities' scripts) are disabled for the match. Declarative behavior keeps running. The engine emits `{type:'gov', rule:'scriptsDisabled', who}`.
- **Guard.** While the guard is active, `Math.random`, `Date.now`, `performance.now` and `new Date()` throw with "use view.rng()".
- **Room workers** (§5) make true infinite loops survivable.

**3.12.2 view** is read-only, frozen and lazily built. Arrays are rebuilt per call, without dirty tracking.

```ts
view.frame                         // match frame
view.me: { id, x, y, vx, vy, facing, grounded, state, stateFrame, percent, stocks, form, bodyScale,
           move: null | { name, frame, phase: 'startup'|'active'|'recovery'|'charge'|'hold', holdFrames, chargeFrames, hitSomething, counterIn },
           air: { riseLeft, stallLeft, jumpsLeft, teleportsLeft, flyFuel }, statuses: [{name, frames, stacks}], control }
view.res: { [name]: number }       view.vars: { [k]: v }
view.input: { held(b), pressed(b), released(b), heldFrames(b), dir(): {x:-1|0|1, y:-1|0|1} }
view.enemies(): [{ id, x, y, vx, vy, facing, grounded, state, percent, statuses, form }]
view.nearestEnemy(from?: {x,y}): enemy|null
view.entities(name?): own entities [{ id, name, x, y, vx, vy, hp, age, life, vars }]
view.stage: frozen geometry { ground, platforms, blast }
view.rng(): number in [0,1)        // mulberry32(seed ^ hash32(fighterId)) — per-fighter stream
view.budget(): { entities, threat, riseLeft, stallLeft, intangibleLeft, armorLeft, mitigationLeft, statusSlotsLeft }
// entity.think gets `e` = { id, name, x, y, vx, vy, age, life, hp, hits, facing, vars }
```

**3.12.3 api.** There are two classes of calls.
- **Immediate (own state only):** `api.res.add(n, d)`, `api.res.set(n, v)`, `api.vars.set(k, v)`, and for entities `api.evars.set(k, v)`.
- **Queued (governed):** applied at the flush points in §3.2, in call order, each through its Governor gate. They return `void`. Use `view.budget()` to predict whether a call will be granted.

| call | gate and semantics |
|---|---|
| `startMove(name)` | Only when actionable (otherwise buffered for 7 frames, like input). From hooks, only into pool moves. |
| `cancelInto(name)` | Only inside a current `cancels` window that lists `name`, or from the action named in `else`/`next`. |
| `endMove()` | Ends the current action at the next flush. |
| `velocity(vx, vy, {mode='set'})` / `impulse(vx, vy)` | `Governor.selfVelocity`. \|vx\| ≤ 18, vy ≥ −17, rise budget applies. |
| `teleport(dx, dy)` | ≤ 200 px, 1 per airtime. Rise is charged. The destination must be outside the ground (otherwise it is pushed out). |
| `spawn(name, opts)` / `despawn(id)` / `command(id, {target?: id, moveTo?: {x,y}})` | Entity budget. Only own entities. |
| `hit(templateName, shape, {frames=1, group})` | **Template-only damage.** Geometry is clamped to the current tier's reach. The tier is the current move's category, or `special` when there is none. Each `{group}` hits each target once per call instance. |
| `status(target: 'self' \| id, name)` | A target id is allowed only from onHit for that hit's target, or from entity contact, or when the target is within 220 px and was hit by this fighter within 60 frames. |
| `form(name)` | Cooldown 45 frames, applied with 6 frames of transition hitlag. Unknown names are ignored with a warning. |
| `setBodyScale(s)` | Clamped to `body.scaleRange`. Changes are rate-limited to 0.02 per frame. |
| `setHurtboxes(setName \| null)` | The set must be declared. Area rules apply (§3.7). |
| `modify(key, mods)` | Named self-modifier set. Clamped per §4.2.9 and combined with statuses. `modify(key, null)` removes it. |
| `armor(frames, threshold)` / `intangible(frames)` | Armor and intangibility budgets. |
| `heal(amount)` | Mitigation and heal budget. Not allowed during hitstun. |
| `emit(name, data)` / `sfx(name)` / `camera({shake})` | Data is JSON-only and ≤ 256 B. At most 8 fx events per frame per fighter. |

There are at most 24 queued commands per fighter per frame; extras are dropped with a gov event. Hooks and scripts never receive `game`, fighter records, entity records or mutable views.

### 3.13 Hit resolution (`hits.js`)

1. **Collect** every candidate `(source, box, target)` pair in order: fighters by index, then each fighter's action boxes (list order), then `extraHits`, then entities by id. Targets are enemy fighters' `hurtShapes` and enemy entities that have hurtboxes.
2. **Filter:**
   - The target is not intangible (see `isIntangible`: v1 sources plus character-granted, budgeted sources).
   - The hit key has not already been used.
   - The target is not in respawn.
   - The source is not the target's own character or one of its own entities.
3. **Resolve kinds in this order:**
   1. counter windows on the target
   2. reflect and absorb (vs entities)
   3. grab-vs-grab, then strike-vs-grab
   4. wind (push only)
   5. strike
   
   Trades are simultaneous: every result is computed, then applied.
4. **Apply** each strike through `Governor.applyHit(ctx)` (§4.2.1). Shielded targets use the v1 shield path, with `shieldMul` and the shield rate limit.
5. **Record** `onHit` and `onHurt` events for step 4 of §3.2, then emit the `hit` event with `gov: string[]`.

`isIntangible(f)` returns true for:
- v1 sources: invuln, dodge windows, respawn
- action `intangible` windows, `timeline intangible` and `api.intangible`, but only while `Governor.intangibleGranted(f)`
- the 30 frames after a combo BREAK (engine-sourced, not charged)

### 3.14 ko, respawn, blast zones

- Blast zones are checked against the collider: `x < left`, `x > right`, `y > bottom`, or `y − colliderH < top`.
- `ko(f)` does what v1 does. It also clears statuses and Governor per-stock budgets, resets the form to `startForm`, and runs `onKO`, then despawns owned entities per §3.9.
- Respawn does what v1 does, then runs `init`, then `onRespawn`.

---

## 4. Balance

### 4.1 Static scaling (`shared/balance/validate.js` + `shared/balance/v2/*`)

`validateCharacter(def, {expectedId}) → {ok, errors, notes, character: IR (deep-frozen), report}`.
- The signature is unchanged. It is pure and deterministic, and returns identical output on the server and in the browser.
- v1 input goes through `normalizeV1`. v2 input goes through `normalizeV2`. Both then go through the same scalers.

**4.1.1 Stats (per form).**
- Each form's resolved stats are priced separately against `STAT_BUDGET = 52`, using v1 `statPoints` with these additions:
  - movement modes (§2.2.5 cost column)
  - passive armor: 2.5 points per point of threshold
  - hurtbox area cost, computed on `A[default] · scaleMin²` with the **v2 curve**:
    - `A ∈ [2900, 5600]`: `15·(5600 − A)/2700` (identical to v1)
    - `A ∈ [1600, 2900)`: `15 + 10·(2900 − A)/1300` (max 25)
    - `A > 5600`: refund `−min(10, 10·(A − 5600)/8400)`
    - `A` is clamped to `[1600, 16000]`. Above 16000, shapes are scaled down uniformly, with a note.
- If a form is over budget, the v1 binary-search squeeze runs on paid stats. Refunds can bring a form under budget.
- v1 characters use v1 pricing exactly (§8).

**4.1.2 Actions** (per pool entry, by category):
- All v1 per-category clamps carry over: maxHit, maxTotal, minStartup shift, minDuration, maxDps, the radius cap, knockback limits, the travel and rise budget (upSpecial-routed ≤ 300 rise, others ≤ 120, travel ≤ 340), landing lag, and intangibility ≤ 12 per action (v1 stays at 10 for v1 files).
- Capsules and rects are converted to an equal-area radius for the radius cap. The capsule length itself is limited only by reach.
- Reach (v2) is measured from the nearest point of the `default` hurtbox union to the far edge of the hitbox. The limit is `REACH_BEYOND[cat]`:

  | category | jab | tilt | smash | aerial | special | recovery | throw/grab | counter | utility | taunt |
  |---|---|---|---|---|---|---|---|---|---|---|
  | reach (px) | 70 | 95 | 110 | 90 | 105 | 95 | 60 | 90 | 80 | 60 |

  There is also an absolute limit from the collider center of `1.8 × v1 maxReach`. Over-reaching shapes are pulled in along their center ray.
- `rehit` must be ≥ 3. A rehit box counts `ceil((end − start + 1)/rehit) × damage` toward maxTotal.
- New categories, added to `CATEGORIES`:

| cat | maxHit | maxTotal | minStartup | minDuration | koFloor | maxDps |
|---|---|---|---|---|---|---|
| grab | 0 | 0 | 6 | 28 | — | — |
| throw | 12 | 14 | — | 24 | 130 | 0.6 |
| pummel | 3 | 3 | 2 | 14 | ∞ (setKnockback 0) | 0.25 |
| counter | 15 | 15 | 2 | 30 | 100 | 0.6 |
| utility | 6 | 8 | 4 | 20 | 200 | 0.4 |
| taunt | 2 | 2 | 6 | 40 | ∞ | 0.1 |

- Templates are clamped once against the strictest category of any move or entity that uses them. Each use is also clamped in context.
- Statuses are clamped to §4.2.9 caps. Resources are clamped to §2.2.6 ranges.

**4.1.3 Entities** are clamped per kind (`ENTITY_LIMITS`):

| kind | maxHit | min rehit | maxLife | max speed | max hp | threat | tier / koFloor |
|---|---|---|---|---|---|---|---|
| projectile | 11 | 10 | 240 | 14 | 6 | 1 | projectile / 140 |
| minion | 6 | 20 | 1200 | 8 | 20 | 2 | minion / 160 |
| trap | 10 | 45 | 900 | 6 | 15 | 2 | trap / 140 |
| zone, burst (life ≤ 30, no rehit) | 12 | — | 30 | — | — | 2 | zone / 120 |
| zone, lingering | 3 | 15 | 360 | — | — | 3 | zone / 200 |
| beam | 4 | 8 | 90 | — (length ≤ 520, width ≤ 24) | — | 3 | beam / 200 |
| clone | ×0.5 owner | — | 600 | owner | 25 | 4 | clone / 140 |
| part | own hitboxes: 0 | — | ∞ if relay = 1, else 900 | — | 25 (if relay < 1) | 1 | — |

Other entity limits:
- homing turn ≤ 0.12 rad/f
- `every.frames` ≥ 30
- spawn offset ≤ 160 px
- `count` ≤ 5
- `maxAlive` ≤ 8
- An entity's total damage counts toward the **spawning action's** maxTotal:

  ```
  damage × min(maxHits + pierce, ceil(life/rehit)) × count × 0.5
  ```

  Entities spawned by hooks, `think` or `every` are excluded from maxTotal and governed at runtime.

**4.1.4 KO estimator (fixed; `shared/sim/combat.js` + `ko-table.js`).**
- `launchReachesBlastZone(speed, angle, {gravity, fallSpeed, origin, stage})` uses the **real stage blast zones** (`stage.blast`, measured from the origin) and checks all four sides.
  - The default origin is center stage, `(0, 0)`.
  - For angles in `(180°, 360°)` against an airborne target, the estimator also tests origin `(ground.x2 + 40, 0)` (just off the ledge). The worse result wins.
- The grounded-spike flip is applied for the grounded case.
- `estimateKoPercent` reports the minimum over: target weight ∈ {70, 100}, charge ×1.4 (if the move can charge), and DI −12/0/+12.
- `REFERENCE` is kept only for `legacyKo` mode (golden replays).
- The static `capKo` uses this estimator, so the runtime cap rarely fires (calibration).

**4.1.5 Power budget.**
- `MOVE_BUDGET = 112` applies **per form**, over that form's 16 core triggers as resolved.
- Additions to the score:
  - +1.5 per entity spawn, +0.5 per extra possible hit
  - +1 per status applied
  - +0.1 per stun frame
  - +0.05 × armor threshold × armor frames
  - +2 for a grab
  - +0.15 per intangible frame
- Moves reachable only through cancels, `next` or `else` add 50% of their score to the slot that reaches them.
- `cost` discount: score × `(0.85 + 0.15·(1 − cost/max))`.
- Throws, pummel and taunt are not in the budget.
- Scripted moves and hooks are listed as **"runtime-governed"** in the report.

**4.1.6 Structural errors (the only reasons a character won't load).** Each comes with a coded message and a fix:
- E001: bad, missing or mismatched id
- E002: missing name
- E003: module default is not an object
- E004: import or throw at load time
- E010: a `slots` value names a missing move, or is neither a string nor a function
- E011: `startForm` or a form slot references something unknown
- E012: an entity reference (`spawn`, `every`, `onExpire`) is unknown
- E013: a template referenced by `use` or `api.hit` is unknown (statically detectable `use` only)
- E014: a timeline entry has zero or multiple action keys
- E015: a function is found where data is required, or a non-function is found where a function is required
- E016: a vars initializer is non-serializable or of a bad type
- E017: a move `duration` is missing or not a number
- E020: lint failure (CI only)

**4.1.7 Notes format.**

```ts
{ code: 'W210', severity: 'info'|'warn', path: 'moves.sideSmash.hitboxes[0].damage', from: 40, to: 18,
  rule: 'CATEGORIES.smash.maxHit', why: 'one hit may not deal more than 18%.',
  fix: 'keep it feeling huge with growth (KO floor allows ≤112 here) or split into a 2-hit group (maxTotal 20).' }
```

Note code families:

| range | area |
|---|---|
| W1xx | stats and body |
| W2xx | action damage, frames and reach |
| W3xx | movement and travel |
| W4xx | entities |
| W5xx | statuses and resources |
| W6xx | power budget |
| I0xx | info (fallbacks, did-you-mean via Levenshtein ≤ 2 on field, slot, move and template names; unknown fields are kept and reported, never silently stripped) |

**4.1.8 CLI report.** `npm run validate -- <id> [--explain] [--json] [--audit]`

```
Grandma Gertie (v2) — loads ✔   3 adjustments · 0 errors
  STATS   form base: 55.0/52 → paid stats −6% (runSpeed 7.6→7.4, weight 114→112)  [passive armor 2 = 5 pts]
  W210    moves.sideSmash.hitboxes[0].damage 17 → 17 ✔   KO ≥ 86% (floor 85) at full charge vs w70
  W402    entities.dentures.life 120 ✔   threat 1×2
  POWER   form base 104.8/112
  BUDGETS self-rise/airtime ≈ 254/380 px · intangible 0 f · armor uptime (static) 31 f/300
  RUNTIME-GOVERNED  downSpecial (update script: heal), behavior: —
  AUDIT   (24 CPU matches × 3 seeds × 120 s, seeded)  damage trimmed 0.3% · KO-floor clamps 0 · BREAKs 1 ·
          rise exhausted 0× · mitigation used 9%/stock avg · scripts 0.02 ms/tick
  HEADROOM 0 stat pts · 7.2 move power
```
`--json` emits `{ok, errors, notes, report, audit}`. CI writes the human report to `$GITHUB_STEP_SUMMARY`.

### 4.2 Runtime Governor (`shared/sim/governor.js`, constants in `shared/balance/governor-rules.js`)

The Governor applies to every damage source: fighter boxes, entities, script hits, DoT, counters and throws. It also covers every self-movement and defensive source. All numbers below are `GOVERNOR.*` constants.

**4.2.1 `applyHit(ctx)` pipeline (strike, non-shield):**

```
mult  = stale(≥0.5) × chargeMul(1 + 0.4·chargeFrames/60, ≤1.4) × attacker.mods.damageOut × target.mods.damageIn
      × (reflected ? 1.25 : 1) × (clone ? 0.5 : 1)
mult  = clamp(mult, 0.5, 1.5)
d     = hb.damage × mult
d     = d × prorate(n)                                   // §4.2.3
d     = min(d, min(1.4 × TIER[tier].maxHit, 25))          // per-hit cap  [gov:'perHit']
d     = rateLimit(attacker→target, d)                     // §4.2.4       [gov:'rate']
d     = soakAndMitigate(target, d)                        // §4.2.6       (resources.soak, part relay, damageIn<1 savings)
percentAfter = min(999, target.percent + d)
kb    = setKnockback ?? knockback(percentAfter, d, target.stats.weight, base, growth) × target.mods.knockbackIn(0.85..1.2)
if armorAt(target) ≥ d and kb < 200:  apply damage + hitlag only; emit 'armor'; return     // §4.2.7
angle = normalize(hb.angle); if target.grounded and 180<angle<360: angle = 360−angle
angle += DI (v1)
speed = launchSpeed(kb)
speed = capLaunch(speed, angle, percentAfter, tier, target)                               // §4.2.2 [gov:'koFloor']
speed = min(speed, 40)                                                                     // abs cap (kb≈266)
hitstun = hitstunFrames(kb) × prorateStun(n) ; if downwardCapped: hitstun ≤ 20
→ BREAK check (§4.2.3) → write percent, kx/ky, state, hitlag (×hitlagMul 0.5..1.5) ; emit hit{gov[]}
```
Under `legacyKo`, the stages after per-hit damage are bypassed when `rules.governor = false` (golden parity).

**4.2.2 Hit-time KO floor, with a per-target ramp and the DI worst case.**
- At match start, for each fighter × form (deduplicated by `(gravity, fallSpeed)`), build `Vko[θ]` for θ = 0..359 (1° bins).
- `Vko[θ]` is the minimum launch speed that reaches any blast zone from center stage, found by binary search on speed using that target's gravity and fallSpeed. Results are cached per stage. The cost is about 3M simple operations per unique pair, which is about 15 ms.
- Floor: `F = max(GOVERNOR.hardKoFloor = 60, TIER[tier].koFloor)`.

```js
export function capLaunch(speed, angle, pAfter, tier, target) {
  const F = Math.max(60, TIER[tier].koFloor);
  if (pAfter >= F) return speed;
  let worst = Infinity;
  for (let d = -12; d <= 12; d += 3) worst = Math.min(worst, target.koTable[(Math.round(angle + d) % 360 + 360) % 360]);
  const ramp = 0.55 + 0.45 * (pAfter / F);              // 0.55 at 0%, 1.0 at the floor
  let cap = 0.95 * worst * ramp;
  if (angle > 200 && angle < 340 && !target.grounded) {  // offstage/air spikes below floor: survivable
    cap = Math.min(cap, 9 / Math.max(0.2, Math.sin(-angle * Math.PI / 180) * -1 || 1)); // vertical component ≤ 9 px/f
    target._downwardCapped = true;
  }
  return Math.min(speed, cap);
}
```
Rationale: distance traveled scales roughly with speed squared. At 0%, the cap is 0.52 of the speed needed to KO from center. That carries a fighter about 27% of the center-to-blast distance (≈ 290 px against the 520 px from ledge to side blast), so an early kill at the ledge is impossible. At p = F, ordinary edge-of-stage KOs are possible, which is normal Smash play.

**4.2.3 Combo proration and BREAK.**
- A target's chain is active while it is in `hitstun`, `stunned`, `grabbed` or hitlag, or until it has been actionable for 12 consecutive frames.
- `n` = effective hits in the chain. Rehit-generated hits from the same box group count 1/3. DoT and wind count 0.
- `prorate(n) = max(0.5, 1 − 0.06·(n−1))`. `prorateStun(n) = max(0.5, 1 − 0.05·(n−1))`.
- `lock` = frames in the chain spent non-actionable.
- **BREAK** triggers when `n ≥ 14`, or chain damage ≥ 55, or `lock ≥ 180`. The next hit's launch is applied with hitstun 0. The target is immediately actionable with 30 frames of engine intangibility, and gets 120 frames of immunity to stun, freeze and grab.
- The chain then resets, and the engine emits `{type:'break', target}`.

**4.2.4 Damage rate (per attacker → target, all of the attacker's sources combined).**
- Ring buffers keyed by frame. Windows: 120 frames and 600 frames.
- **Soft:** once the 120-frame sum exceeds 40, the excess is multiplied by 0.25.
- **Hard:** the 120-frame sum may not exceed 50 and the 600-frame sum may not exceed 140. A hit is trimmed to the remaining headroom, with a minimum of 0.3 damage so the hit still "connects".
- Shield damage has a separate limit: soft 35 per 120 frames (×0.25), hard 45.

**4.2.5 Air and movement budgets** (per airtime). They reset on landing on ground or a platform, on ledge-snap (which in this engine places the fighter on the ground, so it is a landing), and on respawn. When hit with kb ≥ the tumble threshold, half of the rise and stall spent so far is refunded.
- `selfVelocity(f, vx, vy, src)`: `|vx| ≤ 18`, `vy ≥ −17`.
- `rise`: total self-generated upward displacement from non-jump sources (velocity windows, steer, impulse, teleport, fly thrust, api.velocity) is ≤ **380 px**. Once it is spent, upward self-velocity is clamped to 0.
- `stall`: frames airborne with `−1 ≤ vy ≤ 2.5` that were not caused by knockback, including hover, glide, fly, cling and scripted float, are ≤ **240**. Once spent, the fighter gets normal gravity and fallSpeed, and modes are disabled until landing.
- `teleports`: ≤ 1 per airtime, ≤ 200 px.
- A long-air backstop: after 600 frames airborne without landing or being hit, the fighter enters `helpless`.

**4.2.6 Defensive / mitigation budget** (the anti-infinite-health guard). "Prevented damage" is the sum of:
- resource soak
- part relay < 1
- damageIn < 1 savings
- heal (status heal, api.heal, absorb-heal)

Limits:
- ≤ **45 per stock**, ≤ 50% of any single hit, ≤ **20 per rolling 300 frames**
- heal rate ≤ 1 per 30 frames, no heal during hitstun, percent never below 0
- nothing can write stocks

Soak: `soaked = min(d·fraction, res/costPerDamage, budgets)`. Then `res −= soaked·costPerDamage` and `d −= soaked`. When the budget is exhausted, soak and relay switch off until the next stock.

**4.2.7 Armor (flinch-only).**
- Damage is always taken in full; armor only prevents knockback and hitstun.
- Action and script armor threshold ≤ 12, passive ≤ 3.
- Active armor uptime ≤ **60 frames per rolling 300 frames**. Passive armor is exempt but tiny and priced.
- Armor fails against kb ≥ 200 and against grabs.
- Each armored hit emits `{type:'armor'}`.

**4.2.8 Entities.** Per owner:
- ≤ 8 alive and ≤ 10 threat points
- ≤ 1 beam, ≤ 3 traps and zones combined, ≤ 3 entities with hp, ≤ 1 clone

Spawning:
- Spawn rate ≤ 4 per 60 frames.
- Spawning over budget expires the oldest entity of the same kind first, then the oldest overall. Beams and clones replace the existing one.
- When a hp-entity template dies, it has a 300-frame cooldown.

Entity damage counts toward §4.2.3 and §4.2.4.

**4.2.9 Status, control and modifier caps.**

| status | cap |
|---|---|
| DoT | ≤ 0.5 per 15 frames per instance, ≤ 10 per application, ≤ 2 DoTs per target |
| stun / freeze | ≤ 40 frames, then 180 frames of immunity to stun/freeze from anyone |
| root | ≤ 60 frames |
| silence | ≤ 120 frames |
| confuse | ≤ 90 frames, 300 frames of immunity |
| total control | ≤ 90 frames per 600 frames per target (stun, freeze, root, silence, grab hold). Reapplying within 300 frames halves duration. |
| per target | ≤ 4 statuses, ≤ 3 from a single owner |
| status `frames` | ≤ 300 |

Modifier ranges, applied after multiplying all sources together:

| mod | range |
|---|---|
| speed | 0.6–1.25 |
| jump | 0.7–1.2 |
| gravity | 0.5–1.4 |
| fallSpeed | 0.7–1.3 |
| damageOut | 0.8–1.15 |
| damageIn | 0.85–1.15 (savings below 1 count as mitigation) |
| knockbackIn | 0.85–1.2 |

**4.2.10 Intangibility from character sources.**
- Each grant ≤ 20 frames, ≤ 12 per action statically.
- At runtime ≤ **45 frames per rolling 300 frames**, which includes frames charged by hurtbox shrink (§3.7) and successful counters (12 each).
- Engine dodges, respawn and BREAK are exempt.
- When a grant is denied, the engine emits `{type:'gov', rule:'intangible'}` and the art shows a "cracked" flicker.

**4.2.11 Absolute invariants** (tested): KOs happen only through blast zones; stocks are written only by `ko()`; percent stays in `[0, 999]`; respawn invulnerability is 120 frames; shield, dodge, DI and ledge rules are global; no NaN anywhere.

**4.2.12 Feedback.**
- Every clamp emits `{type:'gov', rule, who, target?, amount}` and adds a tag to `hit.gov`.
- The client shows trimmed damage numbers in grey with a "resisted" spark, armor as a metallic flash, an exhausted stall budget as a "too tired" puff, and a "BREAK!" pop.
- Training mode and the Lab show a governor ticker and log.
- Calibration rule: ember, bastion, volt and mirelle in CPU matches must see under 1% of damage trimmed and **0** KO-floor clamps. Constants are tuned against this before release.

---

## 5. Trust and security model

Threat model: friends' Claude sessions that are over-eager to win, plus honest mistakes such as infinite loops or huge assets. The real boundary is owner PR review with branch protection. The layers below catch accidents and make sure one bad character can't take down the server.

1. **Freeze before import.**
   - `shared/balance/rules.js`, `governor-rules.js`, `constants.js` and `shared/art/kit.js` call `deepFreeze` on their exports at module end.
   - `server/index.js`, the room workers and the catalog worker import `shared/sim/*` and `shared/balance/*` **before** any character module.
   - ES modules run in strict mode, so a write to a frozen object throws.
2. **Room workers.**
   - Each match runs in `worker_threads` (`server/room-worker.js`). The worker's module graph contains only `shared/` and `characters/`.
   - Inside the worker, before importing characters:
     1. `guard.install()` wraps `Math.random`, `Date.now` and `performance.now`. The wrappers throw while the guard is active and pass through otherwise.
     2. Then `Object.freeze` is applied to `Math`, `JSON`, `Object.prototype`, `Array.prototype`, `Function.prototype` and `Reflect`.
     
     This order resolves the conflict between the simGuard and freezing.
   - **Watchdog:** the worker writes its tick counter and the index of the fighter whose code is running into a `SharedArrayBuffer`. If the main thread sees no tick for 500 ms, it terminates the worker and emits `match:aborted {reason:'hung', character}`. Other rooms are unaffected.
   - Env `ROOM_WORKERS=0` falls back to in-process rooms for development.
3. **Catalog worker.** `server/catalog-worker.js` imports and validates all characters. It returns only JSON (meta, report, folder hash) to the main process, with a 10 s timeout per character. The Express/Socket.IO process **never imports character code**.
4. **Lint** (`scripts/lint-characters.js`, `acorn` + `acorn-walk` devDependencies). Required in CI and part of `npm test`. Rules:
   - Imports only from `./**`, `../../shared/art/**` and `../../shared/char/api.js`. No dynamic `import()`.
   - Top level may contain only imports, `const`/`function`/`class` declarations, and `export default`. No module-level `let`/`var` mutation, and no top-level calls except `defineCharacter(...)`, pure helpers, and `Object.freeze`.
   - Banned everywhere: `process`, `require`, `globalThis`, `global`, `eval`, `Function`, `import()`, `fetch`, `XMLHttpRequest`, `WebSocket`, `setTimeout`, `setInterval`, `Atomics`, `SharedArrayBuffer`, `__proto__`, `.prototype =`, `Object.defineProperty`/`setPrototypeOf`/`Reflect.*` on imported bindings, assignment to properties of imported bindings, and `localStorage`/`document.cookie`.
   - Banned in sim-reachable functions (`update`, `think`, `behavior.*`, slot functions, `ai.hint`): `Math.random`, `Date`, `performance`, `window`, `document`. `while(true)`/`for(;;)` without a `break` is an error.
   - `window`, `document`, `Image` and `Audio` are allowed only inside functions in `art.js` or `art`, never at top level, because the server imports `art.js` transitively.
5. **Asset check** (`scripts/check-assets.js`):

   | asset type | allowed formats | limits |
   |---|---|---|
   | images | png, webp, svg | ≤ 1.5 MB each, ≤ 4096 px per side |
   | audio | ogg, mp3 | ≤ 400 KB each |
   | per folder | — | ≤ 6 MB total, ≤ 40 files |
   | JS | — | ≤ 300 KB total |
6. **CI scope**: the existing warning is upgraded to a required check. A character PR may touch only `characters/<one-id>/`; anything else requires owner review via CODEOWNERS.
7. **Fuzz in CI** inside a worker with a kill timeout (§10). Fails on a throw, a hang, NaN, an invariant violation, or `scriptsDisabled`.
8. **Future (documented, not built):** SES `Compartment` or isolated-vm for hooks. The API shape (data in, commands out) is already compatible.

---

## 6. Art and rendering contract

### 6.1 ArtDef (client only)

```ts
{ rig?: 'humanoid'|'none',          // default: 'humanoid' if no draw(); 'none' skips computePose/buildRig
  bounds?: Bounds | {[form]: Bounds},  // body px {left(<0), right, top(<0), bottom}; default = hurtbox AABB ×1.4;
                                     // clamp each extent ≤ 4×collider dim, total ≤ 900×900 body px
  palette?: {...}, palettes?: [{...}] // alt palettes for duplicate picks (index = duplicate ordinal)
  assets?: {[name]: './rel/path'},   sheets?: {[name]: Sheet},   clips?: {[sheetOrForm]: {[clip]: Clip}},
  init?(cache, info),
  draw?(ctx, view, info),            // body space, mirrored by engine, clipped to bounds, offscreen canvas
  drawBack?(ctx, view, info),        // world space at feet, NOT mirrored, unclipped, before all fighters
  drawWorld?(ctx, view, info),       // same, after fighters and entities (beams, tethers, text)
  entities?: {[entityName]: { draw(ctx, e, info), drawWorld?(ctx, e, info) }},
  projectile?(ctx, p, info),         // v1 fallback for projectile-kind entities without a draw
  trail?(view, info) => {x,y} | null | false,   // null → default (centers of active hitboxes); false → no trail
  fx?: { onHit, onHurt, onLand, onJump, onKO, onRespawn, onFormChange, onMove: {[name]: fn}, onEvent: {[custom]: fn} },
  sounds?: {[engineEvent|moveName|customName|timeline sfx key]: assetName | presetName | SynthSpec | null},
  portrait?: (ctx, size, info) => void | {x, y, r} | {[form]: ...},
  hud?(ctx, rect, info),             // extra widget in the player card (clipped)
  forms?: {[form]: Partial<ArtDef>},
  // rig:'humanoid' only: build, pose, chains, weapon, head/torso/arm/leg/hand/foot/back/front hooks (v1 semantics)
}
Sheet = { image: assetName, frameW, frameH, cols?, anchor: [x, y], scale = 1, pixelated = false, padding = 0 }
Clip  = { frames: int[], fps = 10, loop = false, speedFrom?: 'vx'|'vy' }
      | { sync: 'move', startup?: int[], active?: int[], recovery?: int[], charge?: int[], hold?: int[] }
```

### 6.2 view and info (built per frame by `client/render/art-host.js`; identical online and offline)

- **view**: the snapshot fighter plus:
  ```ts
  { index, color, form, resources: {name: value}, resMax, vars (synced), statuses: [{name, frames, stacks}], bodyScale, control,
    move: null | { name, anim, def (validated IR action), frame, duration, phase: 'startup'|'active'|'recovery'|'charge'|'hold',
                   phaseT: 0..1, t: 0..1, charge01 },
    events: [...one-shot since last render], entities: [own], hitFlash, interp }
  ```
- **phase** comes from the **validated** action:
  - startup is everything before the first hitbox start, spawn or `hit` entry
  - active runs from there through the last active frame
  - recovery is the rest
  - charge and hold come from the action instance

  Because phase is computed after scaling, animation still lines up after the balancer shifts frames.
- **info**:
  ```ts
  { kit, palette (alt-resolved), time (smooth s), dt, simFrame, cache (per-fighter, persistent), assets (decoded),
    sprite: { drawClip(ctx, sheetOrForm, view, opts?), drawFrame(ctx, sheet, index, opts?) },
    hitboxes: Shape[] (active, body space), hurtboxes: Shape[] (current, body space),
    phase: { name, t, total },                        // shorthand of view.move phase
    fx (world particle API, §6.4) with fx.local emitters attached to the fighter,
    light: { dir: {x,y}, rim: '#hex', ambient: '#hex' } (from stage), motion: { squash, stretch, lean } (from velocity/landing),
    rng (visual-only seeded), quality: 'high'|'low', tint(color, alpha), drawIdle(ctx, opts), drawSelf(ctx, view, opts),
    rig (lazy getter; built only if accessed — humanoid helper), u = colliderH/100, H, W, lab: bool }
  ```

The renderer keeps the global polish layer for everyone: hit flash, intangibility flicker, player-color rim, shadow sized from `bounds` and the collider, the shield bubble sized from the hurtbox AABB, and the name tag above `bounds.top`. When a draw throws, the engine draws a magenta hurtbox, which is v1 behavior. A hook's transform is always restored with save/restore, which fixes the bug at renderer.js:347-354.

### 6.3 Sprites and images

- `client/assets.js` resolves each `art.assets` entry with `new URL(path, moduleUrl)`. The module URL comes from the folder: `/characters/<id>/`. Images are decoded to `ImageBitmap` and sounds to `AudioBuffer`.
- `loadCharacters()` waits for all assets before the roster resolves, behind a loading bar, with a 5 s timeout per character. If an asset fails, `assets[name]` is null and art must handle that case. The Lab warns.
- The server never touches `assets`, since they are just strings.
- **Clip resolution order:**
  1. a clip whose name equals `move.anim`, if there is a move
  2. the state clip: `idle`, `run`, `jump` (rising), `fall`, `land`, `crouch`, `shield`, `roll`, `spotdodge`, `airdodge`, `hurt` (hitstun), `tumble`, `helpless`, `grabbing`, `grabbed`, `stunned`, `glide`, `fly`, `wallcling`, `crawl`, `taunt`, `dead`, `respawn`
  3. `idle`
  
  `sync:'move'` maps `phaseT` across each phase's frame array. `speedFrom` scales fps by `|v|/stat`.
- `pixelated: true` sets `imageSmoothingEnabled = false` for that sheet's draws. The offscreen canvas is created at device resolution × zoom. Docs recommend painting source art at ≥ 2× display size.

### 6.4 Effects, particles, sound

- `client/render/particles.js` is a pooled, world-space particle system. Particles draw in two layers: behind and in front of fighters.
- API:
  - `fx.burst({x, y, count, shape: 'spark'|'dot'|'smoke'|'debris'|'ring'|'drip'|'streak'|drawFn|{sheet, frame}, color|colors, speed:[a,b], angle, spread, gravity, drag, life:[a,b], size:[a,b], fade, blend:'lighter'|'source-over'})`
  - `fx.ring`, `fx.line`, `fx.text`, `fx.trail(id, {...})`, `fx.afterimage`, `fx.decal` (fades over 3 s)
  - `fx.shake(≤8)`, `fx.flash(color, ≤0.35, ≤6f)`, `fx.sound(name, {volume ≤1, pitch})`
  - `fx.local.<shape>({x, y, rate, ...})`: an emitter attached to the fighter, in body coordinates
- Budgets: ≤ 400 live particles per character and 2000 globally (oldest dropped first); ≤ 8 sounds per second per character.
- Engine events call `art.fx.onX(fx, ev, info)` and fall back to the defaults. Custom events (`emit`) call `art.fx.onEvent[name]`.
- `effect` names are an open vocabulary. The 14 v1 names keep their presets. An unknown name uses `move.color`, then `palette.effect`.
- `client/audio.js` adds a preset synth library: `zip buzz-thwack clank boom squeak zap splash whoosh crunch chime roar alarm boing honk thunder gulp`. `sounds` can map any engine event, move name or custom event to an asset, a preset, a `SynthSpec {type, freq:[a,b], dur, gain, vibrato}`, or null. A global mixer ducks character sounds under hit sounds.

### 6.5 Portraits and previews

- `portrait` can be a function, a framing circle `{x, y, r}` in body px, or a per-form value.
- **Default portrait:** render idle at t = 0.5 s into a canvas sized from bounds, compute the alpha bounding box, and frame the top 60% of it. This works for clouds, swarms and slimes.
- The portrait cache key is `id:size:paletteIdx:assetsVersion` and is built only after assets load. This fixes the "blank forever" bug.
- `portrait.animated: true` lets the HUD redraw at 10 fps.
- The showcase (`client/ui/showcase.js`) scales by `bounds` and plays the character's **resolved** moves for every trigger, cycling through forms.

### 6.6 Art Lab v2 (`client/lab.js`, `lab.html`)

Features:
- state list, every pool move (including throws, cancel-only moves and the taunt), and a form switcher
- resource and var sliders, status toggles, an entity gallery (each entity animated on its own), and spawn buttons
- frame scrubber with phase markers, a shape-accurate hurtbox and hitbox overlay, and a governor log
- silhouette mode, 0.5× camera preview, alternate palettes, and a per-draw ms perf meter

**Automatic checks** run in Lab and through `npm run art-check` (headless Chrome is not required; the checks run in the Lab page, and `--ci` mode is optional):

| check | warning condition |
|---|---|
| Hitbox coverage | On each active frame, opaque coverage inside each hitbox is < 15% ("hitbox floating in empty space"). |
| Hurtbox fit | More than 45% of the opaque silhouette is outside the hurtboxes, or more than 30% of the hurtbox area is transparent. |
| Bounds overflow | Opaque pixels touch the canvas edge. |
| Contrast | Mean silhouette luminance ΔL vs the stage palette is < 12. |
| Perf | `draw` takes > 2 ms on average. Above 4 ms the renderer switches to `quality: 'low'` and redraws at 30 Hz from cache. |

**Contact Sheet export** is a PNG grid of idle, run, jump, fall, hurt, shield, each move at its active midpoint, each form, entities and the portrait. The Lab POSTs it to the dev-only endpoint `POST /dev/contact-sheet/:id`, which exists only when `NODE_ENV !== 'production'`. The endpoint writes `.cache/contact-sheets/<id>.png` (gitignored), which Claude reads to critique the art.

### 6.7 The humanoid puppet as an optional kit

- `shared/art/puppet.js` exports `humanoid(spec) → ArtDef` with `draw`, `trail` (rig limb plus weapon length, the v1 logic), `portrait` (rig head) and `bounds`.
- `drawFighter`, `drawFace`, `ANIMATIONS` and `kit` keep their existing exports.
- The rig is built lazily, only when accessed. v1 `art.draw` characters (volt, mirelle) still receive `info.rig`, `info.pose` and the rest of v1 `info` through the shim.
- New helpers live in `shared/art/helpers/`: `swarm.js` (boids with target shapes), `blob.js` (spring soft body that follows target shapes), `serpent.js` (spine chain), `wing.js`, `tentacle.js`, `quadruped.js`, `mech.js` (rigid parts plus 2-bone IK).
- `kit.js` additions: `rimArc`, `rimLightPath`, `shapeGlow`, `shapePoint`, `lightning`, `beam`, `rain`, `goo`, `droplet`, `seeded`, `radial`, `speedLines`, `capsulePath`, `outline` (sprite dilate).

### 6.8 Quality bar (ART_GUIDE v2; checklist enforced by the procedure in §9 WP-P)

- 2–3 value tiers per material, with a rim light from `info.light`.
- Outline 2.5–3.5 u in a dark hue from the palette (never pure black).
- The idle is never static.
- Anticipation during startup, smear or impact during active, follow-through during recovery (all driven by `phase`).
- Secondary motion through chains or cache.
- fx for hit, land, KO and every custom event.
- A readable silhouette at 0.5×.
- Zero Lab warnings, or each one explained to the user.

---

## 7. Networking and snapshot changes

- **Protocol version.** `match:start` carries `{protocol: 2, roster, seed, stageId, rules}`. `roster` gains per-character `{id, hash, tables: {moves: [...names], entities: [...], statuses: [...], resources: [...], forms: [...], vars: [...synced]}}` so snapshots can use indices.
- **Character hash.** `/api/characters` returns `[{id, hash}]`, where hash is the sha1 of the folder contents (computed by the catalog worker). The client imports `/characters/<id>/character.js?v=<hash>`. When a room starts, the server rejects clients whose reported hashes differ ("refresh to update characters").
- **Input.** The bitmask gains bit 9 = `taunt`. `BUTTONS` gains `'taunt'` (constants.js), and `decodeInput` in rooms.js handles it. The default key in `client/input.js` is `T` (gamepad: Select/Back).
- **Fighter snapshot** keeps all v1 keys and adds:

  ```ts
  fm: formIdx, r: number[] (synced resources, 1 decimal), sv: {k: v} (synced vars), st: [[statusIdx, frames, stacks]],
  bs: bodyScale (2 decimals), mv: [moveIdx, frame, phaseCode(0..4), holdFrames, chargeFrames] | 0,
  ctl: 0|1..5 (control), gb: grab ? [otherId, role] : 0, ar: armorActive?1:0, cb: comboN
  ```
  `slot` and `moveFrame` remain for one release.
- **Entities** replace `projectiles`:

  ```ts
  entities: [{ i: id, o: ownerId, t: typeIdx, k: kindCode, x: int, y: int, vx: r1, vy: r1, a: angleDeg int, g: age, l: life, h: hp|-1, n: len|0, f: facing, v: {≤4 synced vars} }]
  ```
  Clones additionally carry `c: [state, stateFrame, moveIdx, frame, facing, grounded]` so the art can draw them with `drawSelf`.
- **New events:** `fx {id, name, data}`, `sfx {id, name}`, `gov {rule, who, target, amount}`, `break`, `armor`, `counter`, `reflect`, `absorb`, `grab`, `throw`, `status {target, name, on}`, `form {id, from, to}`, `spawn`/`despawn {i}` (optional; art may infer these instead).
- **Budget.** The snapshot is ≤ 1.5 KB per fighter and ≤ 6 KB per snapshot at 30 Hz. `snapshot.js` truncates custom data first and logs it. JSON stays the format; delta encoding is deferred.
- **Room worker IPC** carries `postMessage({type:'input', id, mask})` into the worker and `{type:'snap', s, e}` / `{type:'end', results}` out of it. The main thread re-emits to Socket.IO unchanged.

---

## 8. Backward compatibility with v1

- **Detection.** No `version`, or `version: 1`, means v1, which goes to `shared/char/normalize-v1.js`.
- **`normalizeV1(def)` → v2 draft:**
  - `stats.width`/`height` become `body.collider` plus a `default` rect hurtbox and a `crouch` rect at 0.68 height.
  - Each `moves[slot]` becomes a pool entry with `slots[slot] = slot`. Category comes from `MOVE_SLOTS`.
  - `projectiles[i]` becomes an auto entity `${slot}#p${i}` (`kind:'projectile'`, `motion:'ballistic'` with v1 gravity, `collide:'die'`, `maxHits: 1`, `clank: true`, `render: {style, color, color2, spin}`) plus a `spawn` timeline entry at `p.start`.
  - upSpecial gets `helpless: true`, sideSpecial gets `oncePerAirtime: true`, and smash moves get `charge: {button:'strong', at: startup−3, max: 60}`.
  - `anim` and `pose` are preserved. `art` without `draw` becomes `humanoid(art)`. `art` with `draw` is wrapped by `v1ArtShim`, which passes the v1 `info` shape (rig, pose, palette, u, kit, expression, …). `art.projectile` is used for auto entities.
- **Numbers.** v1 characters are scaled by the **v1 rules path** (v1 stat pricing, v1 reach from center, `INTANGIBLE_MAX` 10, v1 KO estimator in `legacyKo`). The output is identical to today's validator, **except** for the intended fixes when `legacyKo = false`: the bottom zone, the spike flip, full charge, and real blast distances. Those changes appear as new notes.
- **Grabs.** v1 characters get the generic grab and throws when `rules.grabs` is on. The golden-replay gate runs with `grabs: false`, and the v1 CPU never presses shield+attack.
- **Golden replays** (`scripts/record-golden.js`, run in WP-A **before** any sim edit): seeded CPU matches of every pairing among ember, bastion, volt, mirelle and `_template`, 2 seeds × 60 s. The recorder stores a SHA-1 of the snapshot every 60 frames, plus all events.
  - After the refactor, `scripts/golden-test.js` must match byte for byte with `{governor: false, legacyKo: true, grabs: false}`.
  - It must then also pass the calibration rule (§4.2.12) with `{governor: true}`.
- **No v1 file ever needs to change.** `npm run migrate -- <id>` optionally rewrites a v1 file to v2 syntax: it adds `defineCharacter`, `body` and entities.

---

## 9. Implementation work breakdown

Ordering: **WP-A** comes first. After that, **B, D and E** run in parallel (E publishes interface stubs on day 1). Then **C, F, G, H, I, J** run in parallel. **K, L, M, N, O, P** can start on the interfaces as soon as WP-E's stubs exist.

Each WP owns its files exclusively. A row's "Consumes" column lists interfaces only. `game.js` is owned by WP-E; other WPs ask for one-line wiring through a stub that WP-E pre-creates.

| WP | Files owned | Provides | Consumes | Acceptance |
|---|---|---|---|---|
| **A: Foundations and safety net** (S) | `shared/sim/rng.js`, `shared/sim/guard.js`, `shared/util/freeze.js`; deep-freeze tails in `rules.js` and `constants.js` (one-line edits); `shared/sim/ai.js` (rng switch and :72 null guard only, then handed to WP-O); `scripts/record-golden.js`, `scripts/golden-test.js`; `client/render/renderer.js` (save/restore fix only, then handed to WP-K) | `mulberry32`, `hash32`, `guard.install/enter/exit`, `deepFreeze`; golden fixtures in `test/golden/*.json` | — | Golden recorded on unmodified v1 logic. ai.js has no `Math.random`. Mutating `CATEGORIES` throws. Existing `npm test` passes. |
| **B: Schema and IR** (M) | `shared/char/api.js` (defineCharacter + full JSDoc typedefs), `shared/char/schema.js` (field tables, defaults, ranges, shared by validator and docs), `shared/char/normalize-v1.js`, `shared/char/normalize-v2.js`, `shared/char/generics.js`, `shared/char/suggest.js` (Levenshtein), `shared/char/ir.js` (IR typedef plus `buildIR`) | `normalize(def) → {draft, notes, errors}`. IR shape: `{id, meta, version, forms: {[f]: {stats, body, movement, slots, armor}}, moves: {[n]: Action}, hitboxes, entities, statuses, resources, vars, sync, behavior, ai, tables, report}` | — | Round-trips all v1 characters. The three §2 examples normalize with 0 errors. Unknown fields produce I-notes and are kept. |
| **C: Validator v2** (L) | `shared/balance/validate.js` (dispatcher, same export), `shared/balance/v2/{stats,body,area,actions,entities,statuses,resources,forms,score,report}.js`, `rules.js` additions (`ENTITY_LIMITS`, `STATUS_LIMITS`, `BODY_LIMITS`, `MOVEMENT_MODES`, `REACH_BEYOND`, new `CATEGORIES` rows), `scripts/validate.js` (`--explain`, `--json`, `--audit` hook) | `validateCharacter` → frozen IR plus coded notes. Precomputed `area[set]` and phase tables per action. | B's normalize, D's `estimateKoPercent` | v1 outputs are deep-equal to pre-change snapshots (`legacyKo`). The cheater "9999" kit stays within budgets. All E0xx codes are covered by unit tests. Deterministic: two runs produce identical JSON. |
| **D: Governor and KO math** (M) | `shared/sim/governor.js`, `shared/sim/ko-table.js`, `shared/sim/combat.js`, `shared/balance/governor-rules.js` | `new Governor(game)` with `applyHit(ctx) → {damage, speed, angle, hitstun, gov[], armored, broke}`, `applyDot`, `selfVelocity`, `teleportRequest`, `intangibleRequest`, `intangibleGranted`, `armorAt`, `spawnRequest`, `statusRequest`, `heal`, `soak`, `chargeHurtArea`, `airReset`, `endFrame`, `budget(f)`; `buildKoTable`; fixed `estimateKoPercent` | stage, fighter fields (§3.3) | Unit tests: the spike dair 275/90/130/14 can't KO a grounded w100 target below 110%. A charged smash can't KO below 85% from center. At 0% a 25-damage max-kb hit at the ledge doesn't KO. Rate limit: 60 hits of 1 damage within 120 frames are trimmed to ≤ 50 total. Mitigation ≤ 45 per stock. |
| **E: Sim core refactor** (XL, critical path) | `shared/sim/game.js`, `fighter.js`, `states.js`, `input-map.js`, `physics.js`, `shapes.js`, `hurtbox.js`, `hits.js`; stub files for `actions.js`, `entities.js`, `status.js`, `resources.js`, `movement.js`, `script-api.js`, `snapshot.js` with the exported signatures in §3 (stubs reproduce v1 behavior) | The module boundaries in §3.1 and the step order in §3.2 | A, D (behind `rules.governor`) | Golden replays byte-identical. A shape-overlap test matrix (circle/capsule/rect, 10k random cases vs brute-force sampling). No unknown states (dev assert). |
| **F: Action interpreter** (L) | `shared/sim/actions.js` | `startAction`, `updateAction`, `endAction`, `activeHitboxes`, grab/throw/counter flow, cancels/hold/charge/next/else | IR, Governor, `entities.spawn`, `status.apply`, `script.run` | Unit sims: hold loops ≤ max; charge gives ×1.4 at 60 frames; cancel only inside its window; a grab with mashing escapes at the expected frame; counter-then damage ≤ 15; v1 moves behave identically (golden). |
| **G: Entities** (L) | `shared/sim/entities.js`, plus `fighter.createMinor` (coordinate a one-function PR with E) | `spawn`, `despawn`, `update`, `hitboxesOf(e)`, `hurtShapesOf(e)`, reflect/absorb/clank hooks, parts, beams, clones | IR, Governor, shapes, actions (clones) | Every motion type is covered by a deterministic trajectory test. Budgets enforced. v1 projectiles replay identically (golden). A part with relay 0.5 and the mitigation budget exhausted relays 1.0. |
| **H: Status, resources, forms, movement** (M-L) | `shared/sim/status.js`, `resources.js`, `movement.js`; `setForm` lives in `fighter.js` (E creates the stub, H fills it) | `status.apply/tick/statMods`, `resources.tick/add/set`, `vars.set`, movement modes, `setForm` | Governor | Each mode respects frame and fuel caps. Stall exhaustion forces a fall. Control immunity windows hold. A form switch pushes the collider out of the ground. |
| **I: Script runtime** (M) | `shared/sim/script-api.js` | `makeView(f)`, `makeApi(f, ctx)`, `run(f, hook, ev)`, `flush(f)`, timing, faults, command cap | Governor, F/G/H functions, guard | `Math.random` throws inside hooks. A hook throwing 3 times disables scripts and emits a gov event. Commands apply in order at the defined points. Views are frozen (mutation throws). |
| **J: Server and network** (M) | `server/room-worker.js`, `server/catalog-worker.js`, `server/rooms.js`, `server/characters.js`, `server/index.js`, `shared/sim/snapshot.js` (taken over from the E stub), `client/match.js`, `client/input.js`, `BUTTONS` in constants.js (one line) | Protocol v2, hashes, the watchdog, the taunt bit | Game API | An infinite-loop test character aborts only its own room within 1 s while another room keeps ticking. Snapshot ≤ 6 KB with 4 fighters × 8 entities. Hash mismatch is rejected. `ROOM_WORKERS=0` works. |
| **K: Art host** (L) | `client/render/renderer.js`, `client/render/art-host.js`, `client/assets.js`, `client/characters.js`, `shared/art/sprite.js`, `shared/art/puppet.js`, `shared/art/helpers/*.js`, `shared/art/kit.js` (additions) | ArtDef contract (§6.1-6.3, 6.5, 6.7) | snapshot v2, IR tables | ember/bastion/volt/mirelle render pixel-identically, within a tolerance of ≤ 1% differing pixels on the contact sheet (old vs new). The three examples render without errors. Portraits are non-blank after async load. |
| **L: FX, audio, HUD** (M) | `client/render/particles.js`, `client/render/effects.js`, `client/render/hud.js`, `client/audio.js` | the `fx` API, sound presets, resource bars/pips/rings, status icons, BREAK and gov pops, `art.hud` slot | art-host's info, events | Particle caps hold under a 2000-burst stress test. HUD shows resources for all three examples. Unknown effect names fall back. |
| **M: Lab, showcase, contact sheet** (M) | `client/lab.js`, `client/lab.html`, `client/ui/showcase.js`, the `/dev/contact-sheet` route (as a separate `server/dev-routes.js`, mounted by J behind a flag) | §6.6 tools and checks | K, L | Lab loads every character, including a forms character. The contact sheet PNG is written. Each check fires on a purpose-built bad fixture. |
| **N: Tooling and CI** (M) | `scripts/lint-characters.js`, `scripts/check-assets.js`, `scripts/fuzz.js`, `scripts/sim-smoke-test.js`, `scripts/audit.js`, `scripts/migrate.js`, `.github/workflows/validate.yml`, `.github/CODEOWNERS`, `package.json` (scripts, devDeps acorn/acorn-walk), `.gitignore` | `npm test` = lint + assets + validate + golden + smoke + fuzz (quick) | everything | §10 suites green. CI posts the report to the step summary. |
| **O: AI** (M) | `shared/sim/ai.js` | Reads IR metadata (`report.moves[n] = {startup, reachBox, category, spawns, isRecovery, isGrab}`), `ai` hints, a recovery list (falls back to `helpless` moves), dodges hostile entities, uses `game.rng` | IR, view helpers | Hard CPU recovers in ≥ 95% of offstage situations with each example. No crash on any test kit. Deterministic under a seed. |
| **P: Docs, templates, examples** (M) | `docs/CHARACTER_GUIDE.md`, `docs/ART_GUIDE.md`, `docs/COOKBOOK.md`, `scripts/gen-docs.js` (tables generated from `schema.js` and rules), `CLAUDE.md` section A, `characters/_template/*` (v2), `characters/_examples/{nimbus,gertie,gloop}/` (§2 code plus placeholder art assets), `scripts/new-character.js` | the Description→Kit procedure | all | The examples load and pass `npm test`. Docs tables match rules (a gen-docs diff check in CI). |

**Description→Kit procedure** (written into CLAUDE.md by WP-P):
1. Pitch: a one-line silhouette, 3 adjectives, one signature mechanic, one weakness.
2. Map the concept to primitives using `docs/COOKBOOK.md`. It covers storm cloud, swarm, grandma, slime, mech+pilot, dragon (glide + big bounds + priced hurtbox + fire beam), living painting (paint resource + painted traps + reflect frame), giant (scaleRange), clone-splitter, chess army (minions with `walker` motion and `maxAlive` 3).
3. Write the 16-row kit table (slot, name, purpose, primitive, rough frame data), plus extras.
4. Write `character.js`.
5. Run `npm run validate -- <id> --explain --json` and iterate until the notes are empty or each remaining one is explained to the user.
6. Write the art plan (a line per state and move), then `art.js`.
7. In the Lab, export the contact sheet, **read the PNG**, critique it against §6.8, fix all warnings, and do at least 2 passes.
8. Run `npm test`.
9. Play training against a hard CPU. If gov events fire in normal play, retune rather than leaning on the Governor.
10. Open the PR, touching only `characters/<id>/`.

---

## 10. Test plan

### 10.1 Smoke and regression (every `npm test`)

| suite | what it checks |
|---|---|
| Lint and assets | Every character folder passes lint and the asset check. |
| Validate | Every character loads. The report is deterministic: two runs produce the same JSON hash. |
| Golden | v1 replay hashes match (governor off, `legacyKo`), then the calibration run passes (governor on, under 1% trimmed, 0 KO clamps). |
| Smoke matches | All pairs and 4-player free-for-alls with hard CPUs, seeded, 120 s each. Checks: no NaN or Infinity in any numeric field of fighters or entities; percent stays in `[0, 999]`; stocks never increase; every match ends within 8 minutes with 3 stocks; script time is ≤ 0.5 ms per tick on average. |
| Determinism | Each character's match runs twice with the same seed; the state hash every 60 frames must be equal. |
| Snapshot size | ≤ 6 KB worst case; worst case logged. |
| Perf | Sim ≤ 2 ms per tick per room at 4 fighters × 8 entities each (Node 20, CI box). |

### 10.2 Adversarial cheater characters

These live in `test/cheaters/*` and are not loaded by the server. Each one runs headless against a reference dummy and a hard CPU, inside a worker with a 10 s kill timeout.

| # | Kit | Invariant that must hold |
|---|---|---|
| 1 | 9999 in every stat and damage; 999 kb and growth | Stat and move budgets hold. No hit > 25 damage. |
| 2 | Spike dair (angle 275, kb 90, growth 130) | No KO of a grounded target below 110%. Offstage spike below the floor gives vertical speed ≤ 9 and hitstun ≤ 20. |
| 3 | Fully charged smash, weight-70 target | No KO from center below 85%. |
| 4 | Ledge sniper: max-kb jab against a 0% target at the ledge | No KO below 60%, and none below the tier floor × ramp. |
| 5 | Infinite heal: `tick` calls `api.heal(99)` | Healed ≤ 45 per stock and ≤ 1 per 30 frames. Percent ≥ 0. |
| 6 | Infinite soak: plating with fraction 1 and max 1000 | Prevented ≤ 50% of each hit and ≤ 45 per stock. |
| 7 | Permanent intangibility: `api.intangible(999)` every tick, plus a 1 px hurtbox set | Character-sourced intangibility ≤ 45 frames per 300 frames, including the shrink charge. |
| 8 | Permanent armor at threshold 99 | Threshold ≤ 12. Uptime ≤ 60 frames per 300. Full damage still taken. |
| 9 | Flight stall: `fly` fuel 9999 plus `api.velocity(0, −50)` every tick | Rise ≤ 380 px per airtime. Stall ≤ 240 frames. Helpless after 600 frames airborne. |
| 10 | Teleport spam: `api.teleport(0, −500)` every tick | ≤ 1 teleport per airtime, ≤ 200 px. |
| 11 | Entity flood: spawn 50 homing minions per frame | ≤ 8 alive, ≤ 10 threat, ≤ 4 spawns per 60 frames. Damage rate ≤ 50 per 120 frames. |
| 12 | DoT stack: 10 burn statuses per hit | ≤ 2 DoTs and ≤ 4 statuses per target. DoT ≤ 10 per application. |
| 13 | Stun-lock: a 1-frame-startup stun jab on repeat | Control ≤ 90 frames per 600. Immunity holds. BREAK at lock ≥ 180. |
| 14 | 0-to-death multi-hit infinite (rehit 3 jab with drag) | BREAK by 14 effective hits or 55%. No KO from a chain below the floor. |
| 15 | Grab chain: re-grab immediately after throw | 10 frames of grab immunity after release; BREAK grants 120 frames of grab immunity. Throw-tier KO floor 130. |
| 16 | Relay-0 wall part with permanent life | Normalized to relay ≥ 0.5, hp ≤ 25, life ≤ 900. Mitigation budget applies. |
| 17 | Rule mutation: `CATEGORIES.smash.maxHit = 999` at import | Throws at load (E004). The character fails to load and other characters are unaffected. |
| 18 | `Math.random`, `Date.now` and module `let` in hooks | Lint errors. At runtime the guard throws, and scripts are disabled after 3 throws. |
| 19 | Infinite loop in `tick` | In CI, the worker is killed and the test fails with a message naming the character. In the room-worker test, only that room aborts. |
| 20 | Bandwidth bomb: emit 10 KB of data every frame, 32 synced vars with long strings | Data truncated to 256 B and 8 fx per frame. Vars ≤ 2 KB. Snapshot ≤ 6 KB. |
| 21 | Hook trying to mutate a view (`view.me.percent = 0`) or reach `game` | TypeError (frozen view). No effect on state. |
| 22 | Reflect ping-pong between two reflectors | ×1.25 damage only once. Speed cap holds. Life still expires. |
| 23 | Self-buff stacking: 20 `modify` sets of damageOut 2 | Combined damageOut ≤ 1.15. |
| 24 | Body-scale abuse: `setBodyScale(0.01)` | Clamped to `scaleRange`, which is clamped to ≥ 0.6. Area priced at the minimum. |

### 10.3 Weird-archetype stress characters

These live in `test/archetypes/*` and must load with 0 errors and pass all invariants in 4-player free-for-alls. Each also gets a contact sheet rendered in the Lab with 0 errors.

| # | Archetype | Primitives exercised |
|---|---|---|
| 1 | Nimbus (storm cloud) | §2.3: hover, beam, zones, status synergy, scripted hits |
| 2 | Grandma Gertie | §2.4: sprites, grab and throws, armor, heal, bounce, root trap |
| 3 | Gloop (slime) | §2.5: forms, scale, crawl, absorb, counter, clone |
| 4 | Buzzwarm (bee swarm) | Resource-as-size, 60 homing minions requested (budget clamps to 8), swarm helper art, an onHurt resource drain |
| 5 | Major Nibbles (hamster in a mech) | Forms mech/pilot, soak plating → eject, wreck part (relay 0.5), turret minion with `think`, sprite plus procedural |
| 6 | Drakon (dragon) | Collider 150×120, hurtbox area 15000 (refund), wing parts at relay 1, glide, a fire beam of length 520, bounds 4× collider; camera and shadow stay correct |
| 7 | Still Life (living painting) | rig none, paint resource, painted traps, reflect frame, `drawWorld` frame decal, an image asset as a texture |
| 8 | Titan Tim (growing giant) | `scaleRange` [0.6, 1.6] driven by kills and percent; area priced at 0.6; collider push-out on growth |
| 9 | Checkmate (chess army) | Three `walker` minions with `maxAlive` 3 and `command()`; queen promotion through vars; threat budget |
| 10 | Echo (clone-splitter) | `mimic` clone with delay 30, a clone hit at 0.5× damage, `drawSelf` art |
| 11 | Pebble (minimum body) | Hurtbox area 1600 (25 points); budget squeeze verified; Lab hurtbox-fit check passes |
| 12 | Static Ghost | 45 frames of intangibility per 300 with a phase-through move; the Governor-denied flicker is visible |

Each archetype also has a Lab fixture with one deliberately bad frame per art check (hitbox off-art, overflow, low contrast). The tests assert that each warning fires.

---

## 11. Judge weaknesses and their fixes

| Weakness raised | Fix in this spec |
|---|---|
| Relay-0 permanent parts used as walls | §3.9.1: relay ∈ [0.5, 1]. Relay < 1 requires hp ≤ 25 and life ≤ 900. Prevented damage counts as mitigation, and relay becomes 1 when the budget is exhausted. |
| Shrinking per-frame hurtboxes gives free intangibility | §3.7: frames below the area minimum are charged to the intangibility budget. |
| KO cap at center stage still kills a 0% target near the ledge; ignores target gravity | §4.2.2: per-target table built from each target's gravity and fallSpeed, plus a percent ramp, the DI worst case, and an offstage spike cap. |
| Air budget reset on ledge-snap allows a stall loop | §4.2.5: ledge-snap in this engine places you on the ground, so it is a real landing. A 600-frame long-air helpless backstop and the stall budget are added. |
| Too many overlapping mechanisms (Claude's error surface) | One movement gate (`selfVelocity`), one timeline vocabulary, coded notes with did-you-mean, JSDoc, the cookbook and the procedure. Two-class api (immediate own-state vs queued governed). |
| Hook infinite loops hang the server | §5: room workers plus a SharedArrayBuffer watchdog. The catalog worker means the main process never imports character code. |
| Freezing `Math` in the main Express process is risky | Freezing happens only inside workers, after `guard.install`. The main process freezes only engine exports. |
| simGuard conflicts with freezing `Math` | Order is specified: install the guard, then freeze. |
| onHurt before applyHit makes hit numbers depend on hook order | Hooks are notifications after the hit. Defensive effects are declarative (soak, relay, armor) and computed inside the Governor. |
| Scripts can emit unvalidated numbers | `api.hit` accepts templates only. Every damage number comes from validated data. |
| Collider clamped to v1 ranges | Collider w 20–160, h 20–200, with area pricing that charges for small bodies and refunds large ones (§4.1.1). |
| Caps that are too tight (resources ≤ 3, vars ≤ 8, beam 420) | Resources ≤ 6, vars ≤ 32, beam ≤ 520, hurtbox sets ≤ 8, per-move `update` scripts allowed. |
| Movement modes tax concept-defining traits | Small costs (1–6 points). The runtime budgets are the real guarantee. |
| Loose damage rate and combo guard | Soft cap 40/120 at ×0.25, hard caps 50/120 and 140/600, proration, and a real BREAK. |
| Armor threshold in kb units is hard to reason about | Threshold is in damage, and armor is flinch-only. |
| Scripted moves get no static feedback | The report lists "runtime-governed" moves, and an `--audit` runtime pass reports trimming, clamps and script cost from seeded fuzz matches. |
| Validator silently strips new fields | Unknown fields are kept and reported (I-notes with did-you-mean). |
| Client/server character version skew | Folder hash, `?v=hash` imports, and match-time hash rejection. |
| Portrait baked before images load; headless characters framed wrongly | Assets are preloaded, the cache key includes `assetsVersion`, and portraits are auto-cropped from alpha or set with `{x, y, r}`. |
| Art clipped to 3.4H; trails tied to rig limbs | `bounds`-sized canvases, unclipped `drawBack`/`drawWorld`, and `trail()` defaulting to hitbox centers. |
| Renderer projectile throw/restore bug | Fixed in WP-A (save/restore around every hook). |
| ai.js:72 crash and `Math.random` | WP-A guard plus rng; WP-O metadata-driven AI. |
| Refactor while showcase agents build on v1 | Golden replays recorded first. The v1 rules path is kept. No v1 file changes. |

Key existing files touched:
- `/Users/noahwolk/Character_Battle/shared/sim/game.js`, `combat.js`, `ai.js`
- `/Users/noahwolk/Character_Battle/shared/balance/validate.js`, `rules.js`
- `/Users/noahwolk/Character_Battle/shared/constants.js`
- `/Users/noahwolk/Character_Battle/shared/art/puppet.js`, `kit.js`
- `/Users/noahwolk/Character_Battle/server/index.js`, `characters.js`, `rooms.js`
- `/Users/noahwolk/Character_Battle/client/characters.js`, `match.js`, `input.js`, `audio.js`, `lab.js`
- `/Users/noahwolk/Character_Battle/client/render/renderer.js`, `effects.js`, `hud.js`
- `/Users/noahwolk/Character_Battle/client/ui/showcase.js`
- `/Users/noahwolk/Character_Battle/scripts/*`
- `/Users/noahwolk/Character_Battle/.github/workflows/validate.yml`
- `/Users/noahwolk/Character_Battle/package.json`
- `/Users/noahwolk/Character_Battle/CLAUDE.md`
- `/Users/noahwolk/Character_Battle/docs/CHARACTER_GUIDE.md`, `docs/ART_GUIDE.md`
- `/Users/noahwolk/Character_Battle/characters/_template/character.js`