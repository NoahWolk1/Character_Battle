# Character Guide (v2)

Everything you need to design a fighter's **gameplay**: the body, stats, movement modes, moves,
hitboxes, the timeline, resources, statuses, entities, forms, scripts, AI hints, and how the
balancer and the runtime Governor keep it all fair. Drawing is in [ART_GUIDE.md](ART_GUIDE.md);
concept-to-kit recipes (storm cloud, swarm, mech, dragon, slime, chess army…) are in
[COOKBOOK.md](COOKBOOK.md).

> **Freedom first.** Your character can be *anything*. Type any numbers you like: nothing is
> rejected for being too strong. The static balancer (`shared/balance/validate.js`) scales
> anything over the limits back into range and `npm run validate -- <id> --explain` tells you
> exactly what changed and how to get your intent back. The runtime **Governor**
> (`shared/sim/governor.js`) then guarantees, whatever code you write, that nobody gets one-shot
> or becomes unkillable. The only hard errors are structural (E-codes, §20).

Tables marked *generated* are produced from the engine's own tables by `npm run docs`
(`scripts/gen-docs.js`), and `npm test` fails if they drift — they are always exact.

---

## Contents

1. [Quick start](#1-quick-start)
2. [File layout and code rules](#2-file-layout-and-code-rules)
3. [Units, coordinates, angles](#3-units-coordinates-angles)
4. [The character object](#4-the-character-object)
5. [Body: collider, hurtboxes, size](#5-body-collider-hurtboxes-size)
6. [Stats and the stat budget](#6-stats-and-the-stat-budget)
7. [Movement modes](#7-movement-modes)
8. [Triggers, slots and inputs](#8-triggers-slots-and-inputs)
9. [Moves (actions)](#9-moves-actions)
10. [Hitboxes and hit templates](#10-hitboxes-and-hit-templates)
11. [The timeline](#11-the-timeline)
12. [Resources and vars](#12-resources-and-vars)
13. [Statuses](#13-statuses)
14. [Entities](#14-entities)
15. [Forms](#15-forms)
16. [Scripts: hooks, view and api](#16-scripts-hooks-view-and-api)
17. [AI hints](#17-ai-hints)
18. [Static balance: categories and limits](#18-static-balance-categories-and-limits)
19. [The runtime Governor](#19-the-runtime-governor)
20. [Notes: E, I and W codes](#20-notes-e-i-and-w-codes)
21. [Universal rules and controls](#21-universal-rules-and-controls)
22. [Testing workflow](#22-testing-workflow)
23. [v1 characters](#23-v1-characters)

---

## 1. Quick start

```bash
npm install
npm run new-character -- frost-knight "Frost Knight"   # copies the v2 template
npm run dev                                             # http://localhost:3000
```

- Training: `http://localhost:3000/?train=frost-knight` (a standing dummy); add `&cpu=hard` (or `easy`/`normal`) to fight a CPU, `&vs=<id>` to pick its character
- Art Lab: `http://localhost:3000/lab.html?char=frost-knight` (add `&boxes=1`, `&frame=strike`, `&still=1`, `&checks=1`)
- Balance report: `npm run validate -- frost-knight --explain` (`--json` for tools, `--audit` to play CPU matches and report the Governor's work)
- Art checks and contact sheet: `npm run art-check -- frost-knight --sheet` → `.cache/contact-sheets/frost-knight.png`
- Full suite (run before every PR): `npm test`

`npm run dev` restarts the server when files change and the roster is re-scanned on every refresh. **Edit, save, refresh.**

## 2. File layout and code rules

```
characters/
  _template/            the v2 starting point (folders starting with _ are not in the roster)
  frost-knight/
    character.js        export default defineCharacter({ id: 'frost-knight', ... })
    art.js              the ArtDef (client only; see ART_GUIDE)
    *.js, *.png, *.svg, *.ogg …  anything else you import or reference from art.assets
```

```js
import { defineCharacter } from '../../shared/char/api.js';
import art from './art.js';
export default defineCharacter({ id: 'frost-knight', name: 'Frost Knight', /* … */ art });
```

`defineCharacter` just tags the object `version: 2` and gives editors autocomplete; a file without it
is treated as v1 (§23).

**Code rules** (enforced by `npm run lint` — E020 — and CI):

- Imports only from your own folder, `../../shared/art/**` and `../../shared/char/api.js`. No `import()`.
- No network, timers, `process`, `fs`, `eval`, `Function`, `globalThis` tricks, prototype edits, or top-level side effects. The file loads on the server and in every browser.
- Code that the simulation runs (`update`, `think`, `behavior.*`, slot functions, `ai.hint`, and everything they call) must be deterministic: use `view.rng()`, never `Math.random`, `Date` or `performance`, and never write module-level state. Keep per-fighter state in `vars`/`resources`.
- Module-level `let`/`var` are not allowed (art caches go in `info.cache` or a `const cache = {}` object).
- Assets (checked by `npm run assets`, part of `npm test` and CI):

<!-- gen:asset-limits -->
| asset | formats | limits |
|---|---|---|
| images | png, webp, svg | ≤ 1.5 MB each, ≤ 4096 px per side; SVG without scripts or external references |
| audio | ogg, mp3 | ≤ 400 KB each |
| code | js, mjs | ≤ 300 KB total |
| notes | json, md, txt |  |
| whole folder |  | ≤ 6 MB, ≤ 40 files; anything else (jpg, gif, wav, …) is an error |
<!-- /gen:asset-limits -->

**Why gameplay can't be hacked:** the sim never reads your module directly. The validator builds a
clean, deep-frozen IR; scripts get frozen views and a command API whose every call goes through a
Governor gate (§16, §19).

## 3. Units, coordinates, angles

- **Time:** frames at 60 fps (frame 1 is the first frame of a move). **Distance:** px. **Speed:** px/frame.
- **Body-local coordinates:** origin at the collider's feet center, `x > 0` = in **front** (mirrored automatically when facing left), `y < 0` = **up**.
- **Launch angles** (degrees, relative to facing):

```
              90  (straight up)
               |
 180  (back) --+-- 0  (forward)
               |
              270  (straight down = spike)
```

Against a grounded target, downward angles are mirrored upward so spikes pop them up.

## 4. The character object

<!-- gen:character-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `version` | int | set to 2 by defineCharacter; missing or 1 = v1 file |  | File format version. |
| `id` | string | **required** (E001) |  | Matches /^[a-z][a-z0-9-]{1,23}$/ and the folder name. |
| `name` | string | **required** (E002) | 1–18 | Display name (truncated with a note if longer). |
| `author` | string | '' |  |  |
| `description` | string | '' | 0–220 |  |
| `archetype` | 'rushdown' \| 'zoner' \| 'heavy' \| 'trickster' \| 'summoner' \| 'grappler' \| 'allrounder' | 'allrounder' |  | Hint for AI and docs only. |
| `body` | object of BodyDef | v1 defaults (52×92 rect) |  |  |
| `stats` | object of StatsDef | STATS[*].default |  |  |
| `movement` | object of MovementDef | {} |  | Engine movement modes (walker if empty). |
| `resources` | map of ResourceDef | {} | ≤ 6 |  |
| `vars` | map of number\|boolean\|string | {} | ≤ 32 | Strings ≤ 24 chars; numbers finite, clamped to ±1e6. |
| `sync` | var name[] | [] | ≤ 16 | Var names sent to clients. Resources sync by default. |
| `hitboxes` | map of HitTemplate | {} |  | Named strike templates: the only way scripts deal damage. |
| `statuses` | map of StatusDef | {} | ≤ 8 |  |
| `entities` | map of EntityDef | {} | ≤ 16 |  |
| `moves` | map of Action | {} |  | A pool. v1 slot names are just pool names. |
| `slots` | map of string\|SlotFn | identity (slots.jab = "jab", …) |  | Routes triggers to move names. |
| `forms` | map of FormDef | {} | ≤ 6 | The base definition is the implicit form "base". |
| `startForm` | form name | 'base' (E011 if unknown) |  |  |
| `behavior` | object of Hooks | {} |  |  |
| `ai` | object of AIHints | {} |  |  |
| `art` | object of ArtDef | auto-art |  | Client only. The sim never reads it. |
<!-- /gen:character-fields -->

Keys the engine doesn't know are kept (with an I001 note and a did-you-mean suggestion) but unused.

## 5. Body: collider, hurtboxes, size

Your body is **any shape**: up to 8 named hurtbox sets of up to 6 shapes (circles, capsules, rects).
The **collider** is an axis-aligned box used for stage physics and blast zones. Hurtboxes are what
gets hit.

```js
body: {
  collider: { w: 60, h: 80 },
  hurtboxes: {
    default: [{ shape: 'circle', x: 0, y: -40, r: 34 }, { shape: 'capsule', x1: -20, y1: -70, x2: 20, y2: -70, r: 12 }],
    crouch:  [{ shape: 'rect', x: 0, y: -24, w: 70, h: 48 }],
    air:     [{ shape: 'circle', x: 0, y: -40, r: 30 }],
    puffed:  [{ shape: 'circle', x: 0, y: -50, r: 48 }],   // selected by api.setHurtboxes('puffed') or a move window
  },
  scaleRange: [0.8, 1.3],   // api.setBodyScale(s) may resize you inside this range (priced at the minimum)
  armor: { threshold: 2 },  // passive flinch armor (costs stat points)
}
```

Shapes: `{shape:'circle', x, y, r}` (the default when `r` is present), `{shape:'capsule', x1, y1, x2, y2, r}`,
`{shape:'rect', x, y, w, h}` with **x, y = center**.

The engine picks the active set in this order: the move's `hurtboxes` window → a set chosen by
`api.setHurtboxes` → `crouch` while crouching → `air` while airborne → `default`.

<!-- gen:body-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `collider` | object of {w, h} | AABB of hurtboxes.default | w 20–160, h 20–200 | Stage physics, ledge snap, blast-zone top. |
| `hurtboxes` | map of Shape[] | default: collider rect; crouch: same rect at 0.68 height | ≤ 8, ≤ 6 shapes each |  |
| `scaleRange` | list | [1,1] | 0.6–1.6 | setBodyScale bounds; area priced at min. |
| `armor` | object of {threshold} |  | threshold 0–3 | Passive flinch armor (damage), 2.5 stat pts per point. |
<!-- /gen:body-fields -->

<!-- gen:body-limits -->
| limit | value |
|---|---|
| collider w / h | 20–160 / 20–200 |
| shapes per hurtbox set / sets | 6 / 8 |
| envelope (M = max(w, h)) | x ∈ [−2·M, 2·M], y ∈ [−2.5·h, 0.5·h] |
| scaleRange | 0.6–1.6 |
| passive armor | 0–3 damage |
| priced area | 1600–16000 px² |
<!-- /gen:body-limits -->

**Size is priced.** Small bodies are harder to hit, so hurtbox area costs stat points; big bodies
refund them. Area is measured on the rasterized `default` set (overlaps count once), at the
smallest `scaleRange`:

<!-- gen:area-curve -->
| priced area A (px²) | stat points |
|---|---|
| 1600 ≤ A < 2900 | 15 + 10·(2900 − A)/1300  (max 25) |
| 2900 ≤ A ≤ 5600 | 15·(5600 − A)/2700 |
| A > 5600 | refund −min(10, 10·(A − 5600)/8400) |
| A > 16000 | shapes are scaled down uniformly (W133) |

A = union area of `hurtboxes.default` × scaleRange[0]². Passive armor costs 2.5 points per point of threshold.
<!-- /gen:area-curve -->

## 6. Stats and the stat budget

Each form's stats are priced separately against the same budget. Costs are linear from 0 at the
minimum to the listed cost at the maximum; `gravity` and `fallSpeed` are free.

<!-- gen:stats -->
| stat | min | max | default | points at max | what it does |
|---|---|---|---|---|---|
| `weight` | 70 | 130 | 100 | 20 | Heavier = survives longer, but is a bigger combo target. |
| `runSpeed` | 4.5 | 8.5 | 6.4 | 20 | Max ground speed (px/frame). |
| `airSpeed` | 3.2 | 6 | 4.5 | 15 | Max horizontal air speed (px/frame). |
| `jumpHeight` | 12 | 18 | 15 | 10 | Initial jump velocity (px/frame). |
| `doubleJumpHeight` | 11 | 17 | 14 | 10 | Mid-air jump velocity (px/frame). |
| `airJumps` | 1 | 3 | 1 | 12 | Number of mid-air jumps (whole number). |
| `gravity` | 0.5 | 0.85 | 0.65 | 0 | Free trade-off: floaty vs. fast-falling. |
| `fallSpeed` | 8 | 14 | 11 | 0 | Free trade-off: max fall speed. |
<!-- /gen:stats -->

<!-- gen:budgets -->
| budget | value | what it covers |
|---|---|---|
| `STAT_BUDGET` | 52 | stat points per form (stats + movement modes + passive armor + hurtbox area) |
| `MOVE_BUDGET` | 112 | move power per form, over the 16 core triggers as resolved |
<!-- /gen:budgets -->

Over budget? Every paid stat is pulled toward its minimum by the same fraction until it fits
(W120). Movement modes, passive armor and small bodies are added to the bill; big bodies subtract.

Gut feel: jump height ≈ `jumpHeight² / (2 × gravity)` px (15 at 0.65 ≈ 173 px).

## 7. Movement modes

Engine-implemented modes, per form. Every frame spent in a mode counts against the air budget
(§19), so stalling forever is impossible.

<!-- gen:movement-modes -->
| mode | stat cost | params (default, range) |
|---|---|---|
| `hover` | 2 | button = jump; frames = 90 [1–120]; fallSpeed = 1.5 [1–4]; drift = 1 [0.5–1.2] |
| `glide` | 2 | button = jump; frames = 120 [1–150]; fallSpeed = 1.6 [1.2–4]; speed = 1.15 [1–1.3]; turn = 0.05 [0–0.1] |
| `fly` | 6 | button = jump; fuel = 90 [1–180]; thrust = 0.6 [0.1–0.9]; maxRise = 4 [1–5] |
| `wallCling` | 1 | frames = 45 [1–60]; wallJump = true; jumpVx = 6 [0–8]; jumpVy = 11 [0–14] |
| `crawl` | 2 | frames = 90 [1–120]; speed = 0.6 × runSpeed [1–0.8×runSpeed] |
<!-- /gen:movement-modes -->

```js
movement: { hover: { button: 'jump', frames: 90, fallSpeed: 1.5 } }                   // a cloud
movement: { glide: { frames: 120 }, wallCling: { frames: 40 } }                         // a squirrel
forms: { puddle: { movement: { crawl: { frames: 100, speed: 5 } } } }                   // a slime
```

How each mode starts and ends (all start from free air, never during a move, hitstun or helpless):

- **hover**: hold `button` while falling; ends on release, after `frames`, or on landing. Aerials work while hovering.
- **glide**: hold `button` while falling; release, attack or shield drops out; only aerials from glide.
- **fly**: hold `button` with fuel left (for `jump`: after the air jumps are gone, or while falling); release or any attack ends it.
- **wallCling**: hold toward the main stage's side wall while touching it; once per airtime. Jump = wall jump; away, down or any attack drops.
- **crawl**: climbs the main stage's **side walls and underside** (not the ground — a ground crawl is
  just a low body and a slow `runSpeed`, e.g. a form). Enter by holding toward a wall plus up/down (or just
  toward it without `wallCling`), or up while under the stage; jump leaps off, away/down drops.

## 8. Triggers, slots and inputs

Inputs produce **triggers**; `slots` route each trigger to a move in your pool. By default every
trigger routes to the move with the same name (`slots.jab = 'jab'`). A trigger with no move gets a
generic move (I002), including generic grab, pummel and throws.

<!-- gen:triggers -->
| trigger | input | default category |
|---|---|---|
| `jab` | attack, neutral | jab |
| `side` | attack + left/right | tilt |
| `up` | attack + up | tilt |
| `down` | attack + down | tilt |
| `sideSmash` | smash + left/right (or neutral) | smash |
| `upSmash` | smash + up | smash |
| `downSmash` | smash + down | smash |
| `nair` | attack in the air, neutral | aerial |
| `fair` | air attack toward facing | aerial |
| `bair` | air attack away from facing | aerial |
| `uair` | air attack + up | aerial |
| `dair` | air attack + down | aerial |
| `neutralSpecial` | special, neutral | special |
| `sideSpecial` | special + left/right (once per airtime by default) | special |
| `upSpecial` | special + up (helpless after, by default) | recovery |
| `downSpecial` | special + down | special |
| `grab` | shield + attack on the ground | grab |
| `pummel` | attack while grabbing (≤ 1 per 14 frames) | pummel |
| `fthrow` | forward while grabbing | throw |
| `bthrow` | back while grabbing | throw |
| `uthrow` | up while grabbing | throw |
| `dthrow` | down while grabbing | throw |
| `taunt` | taunt button (T), grounded | taunt |
<!-- /gen:triggers -->

Inputs (keyboard solo): move WASD/arrows · jump Space · attack J · special K · smash I (hold to
charge) · shield L/Shift · grab = shield + attack · taunt T. Ground priority: smash > special >
attack. In the air, attack/smash beat special.

**Slot functions** route by state: `slots: { neutralSpecial: (view) => view.res.mass >= 95 ? 'globShot' : 'neutralSpecial' }`.
They are pure (read-only `view`, §16) and must return a pool name; anything else falls back to the
static mapping. Forms can remap slots too (§15). Resolution order: form slot function → form
slots → base slot function → base slots → the trigger name.

The validator can't see inside a slot function, so a move that is *only* returned by one (here
`globShot`) gets `I006 isn't routed from any trigger` — expected, explain it to the user — and its
category can't be inferred from the trigger: set `category` on it explicitly (otherwise it is
balanced as `special`).

## 9. Moves (actions)

`moves` is a **pool** of named actions. The 16 classic slot names are just pool names; add as many
extra moves as you like (follow-ups, `else` fallbacks, cancel targets, form variants).

```js
moves: {
  side: { name: 'Gust', duration: 28, hitboxes: [{ start: 7, end: 10, x: 50, y: -40, r: 22, damage: 8, angle: 35, knockback: 22, growth: 70 }] },
  neutralSpecial: { name: 'Zap', duration: 34, cost: { charge: 30 }, else: 'fizzle',
    timeline: [{ at: 12, spawn: 'bolt', x: 40, y: -50 }, { at: 12, sfx: 'zap' }] },
  fizzle: { name: 'Fizzle', category: 'special', duration: 26, timeline: [{ at: 4, emit: 'fizzle' }] },
}
```

<!-- gen:action-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `name` | string | pool key | 1–24 |  |
| `category` | enum | category of the first trigger routed to it, else special | jab, tilt, smash, aerial, special, recovery, grab, throw, pummel, counter, utility, taunt |  |
| `duration` | int | **required** (E017) | minDuration–150 |  |
| `hitboxes` | list of Hitbox | [] |  |  |
| `timeline` | list of TimelineEntry | [] |  |  |
| `velocity` | list of {start, end, vx?, vy?, mode?, untilGrounded?, airOnly?} | [] |  |  |
| `projectiles` | list of v1 projectile | [] |  | Converted to entities plus spawn entries (§8). |
| `intangible` | window | — |  | [s, e] or [s, e][]; ≤ 12 frames per action. |
| `armor` | list of {from, to, threshold} | [] | threshold 0–12 |  |
| `hurtboxes` | list of {from, to, set?, shapes?} | [] |  |  |
| `gravity` | list of {from, to, scale} | [] | scale 0.3–1.5 |  |
| `landingLag` | int | aerials: 10; others: engine default |  |  |
| `helpless` | bool | true only when routed from upSpecial |  |  |
| `oncePerAirtime` | bool | true only when routed from sideSpecial |  |  |
| `cost` | map of number | — |  |  |
| `requires` | object of {form?, grounded?, airborne?, resource?, var?} | — |  |  |
| `else` | move name | — |  |  |
| `hold` | object of {button, from, to, max, release?} | — |  |  |
| `charge` | object of {button, at, max} | smash: {button: 'strong', at: startup − 3, max: 60} |  |  |
| `cancels` | list of {from, to, into, onHit?, button?} | [] |  |  |
| `next` | move name | — |  |  |
| `counter` | object of {from, to, then, mul} | — |  |  |
| `onAbsorb` | list of TimelineAction | [] |  |  |
| `throw` | object of {holdAt?: {x, y}} | — |  |  |
| `anim` | string | — |  | Opaque string passed to art. |
| `pose` | any | — |  | Humanoid helper only. |
| `effect` | string | — |  | Presentation; also the default effect of its hitboxes. |
| `color` | string | — |  |  |
| `sound` | any | — |  | Presentation (sound key for art). |
| `description` | string | '' |  | Docs / showcase text. |
| `update` | fn | — |  | (view, api) => void, per frame after the timeline. |
<!-- /gen:action-fields -->

**Hold, charge, cancels, counters, requirements:**

<!-- gen:hold-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `button` | enum | special for specials, strong for smashes, else attack | jump, attack, special, strong, shield, taunt, up, down, left, right |  |
| `from` | int |  |  |  |
| `to` | int |  |  |  |
| `max` | int | 120 | 1–600 |  |
| `release` | any of moveName \| frame | — |  |  |
<!-- /gen:hold-fields -->

<!-- gen:charge-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `button` | enum | 'strong' | jump, attack, special, strong, shield, taunt, up, down, left, right |  |
| `at` | int | max(1, startup − 3) |  |  |
| `max` | int | 60 | 1–60 |  |
<!-- /gen:charge-fields -->

<!-- gen:cancel-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `from` | int |  |  |  |
| `to` | int |  |  |  |
| `into` | list of moveName \| Trigger \| jump \| shield \| any |  |  |  |
| `onHit` | bool | false |  |  |
| `button` | enum | — | jump, attack, special, strong, shield, taunt, up, down, left, right |  |
<!-- /gen:cancel-fields -->

<!-- gen:counter-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `from` | int |  |  |  |
| `to` | int |  |  |  |
| `then` | move name |  |  |  |
| `mul` | number | 1.2 | 1–1.3 |  |
<!-- /gen:counter-fields -->

<!-- gen:requires-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `form` | form name |  |  |  |
| `grounded` | bool |  |  |  |
| `airborne` | bool |  |  |  |
| `resource` | map of number |  |  |  |
| `var` | map of any |  |  |  |
<!-- /gen:requires-fields -->

**Self-movement** (`velocity` windows; the timeline also has `velocity`, `impulse`, `steer`, `teleport`):

<!-- gen:velocity-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `start` | int | 1 |  |  |
| `end` | int | start |  |  |
| `vx` | number | — |  |  |
| `vy` | number | — |  |  |
| `mode` | 'set' \| 'add' | 'set' |  |  |
| `untilGrounded` | bool | false |  |  |
| `airOnly` | bool | false |  | Only applies while airborne (grounded moves never lift off). |
<!-- /gen:velocity-fields -->

A move's `update(view, api)` runs every frame after its timeline — the escape hatch for anything the
data can't express (§16).

## 10. Hitboxes and hit templates

A hitbox is a **Shape** + `{start, end}` (frames) + hit fields. Hitboxes in the same `group` hit a
target once per move; use different groups for multi-hits and list sweetspots first. `rehit: N`
lets the same box hit again every N frames (lingering zones, drills).

```js
hitboxes: { zap: { damage: 6, angle: 60, knockback: 20, growth: 50, effect: 'electric', status: 'stun' } },
moves: { up: { duration: 26, hitboxes: [{ start: 6, end: 9, x: 0, y: -90, r: 26, use: 'zap', damage: 7 }] } },  // inline fields override the template
```

Named templates in the top-level `hitboxes` are reusable with `use`, and are **the only way scripts
and timeline `hit` entries deal damage**.

<!-- gen:hit-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `kind` | 'strike' \| 'grab' \| 'wind' \| 'reflect' \| 'absorb' | 'strike' |  |  |
| `damage` | number | strike: required (4 with a note); other kinds: 0 |  |  |
| `angle` | number | strike: 45; other kinds: 0 |  | Degrees, 0 = forward, 90 = up, 270 = spike. |
| `knockback` | number | strike: 20; other kinds: 0 |  |  |
| `growth` | number | strike: 60; other kinds: 0 |  |  |
| `setKnockback` | number | — | 0–120 | Fixed knockback (ignores %). |
| `effect` | string | the move's effect, else 'normal' |  | Open vocabulary (art); the 14 v1 names keep presets. |
| `status` | any of string \| {name, frames?, power?} | — |  |  |
| `shieldMul` | number | 1 | 0.5–1.5 |  |
| `hitlagMul` | number | 1 | 0.5–1.5 |  |
| `push` | number | 0 | 0–6 | Wind only, px/frame per axis (cap 6). |
| `windDir` | 'facing' \| 'away' \| 'toward' \| 'angle' | 'facing' |  | Wind only. facing: along the source's facing (entities: travel direction when free-flying); away / toward: from / to the box center (2D: pull, vacuum, gravity well); angle: along `angle` (90 = updraft). Offstage targets below the KO floor are never pushed farther out, up past ~360 px or down. |
| `tier` | enum | — | jab, tilt, smash, aerial, special, recovery, grab, throw, pummel, counter, utility, taunt, projectile, minion, trap, zone, beam, clone, status | Default: inherited from the move/entity/script context. |
<!-- /gen:hit-fields -->

<!-- gen:hitbox-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `start` | int | action: category minStartup; entity: 0 |  |  |
| `end` | int | action: start + 3; entity: life |  |  |
| `group` | int | list index (v1 files: 0) |  | Each group hits each target once (per rehit window). |
| `use` | template name | — (inline fields; E013 if it names an unknown template) |  | Template name; inline fields override it. |
| `rehit` | int | — | 3–∞ | Re-hit every N frames. |
| `onHit` | list of TimelineAction | [] |  |  |
| `counterScale` | bool | false |  | Scale damage with the countered hit (§3.6.3). |
| `air` | bool | false |  | Grab boxes only: also grab airborne targets. |
<!-- /gen:hitbox-fields -->

Hit kinds:

<!-- gen:hit-kinds -->
`strike` `grab` `wind` `reflect` `absorb`
<!-- /gen:hit-kinds -->

`effect` is an open vocabulary for the art (particles, colors, sounds). These names have engine presets:

<!-- gen:effects -->
`punch` `kick` `slash` `fire` `ice` `electric` `magic` `water` `wind` `dark` `light` `poison` `earth` `none`
<!-- /gen:effects -->

## 11. The timeline

`timeline` entries fire at a frame (`at`), over a range (`from`/`to`, optionally `every`), on
landing (`onLand: true`) or on hit (`onHit: true`). Each entry has **exactly one** action key.

```js
timeline: [
  { at: 10, spawn: 'raincloud', x: 100, y: -150 },
  { from: 4, to: 20, every: 4, hit: 'drizzle', shape: 'rect', x: 40, y: -20, w: 80, h: 20 },
  { onHit: true, resource: { name: 'charge', add: 10 } },
  { at: 30, endIf: { grounded: true } },
]
```

<!-- gen:timeline-timing -->
| timing key | meaning |
|---|---|
| `at: n` | runs once on frame n |
| `from: a, to: b, every?: k` | runs on frames a..b, every k frames (default 1) |
| `onLand: true` | runs when the fighter lands during the move |
| `onHit: true` | runs when the move first connects |
<!-- /gen:timeline-timing -->

<!-- gen:timeline-actions -->
| key | value / params | governed by |
|---|---|---|
| `spawn` | entity; sibling keys: x=0, y=0, vx, vy, count=1 [1–5], spread=0, aimAt="nearestEnemy", bindToMove=false | entity budget (§4.2.8) |
| `velocity` | { vx, vy, mode="set"\|"add", untilGrounded=false, airOnly=false } | speed cap, rise budget |
| `impulse` | { vx=0, vy=0 } | speed cap, rise budget |
| `steer` | { speed=8 [0–12], turn=0.1 [0–0.3] } | speed cap, rise budget |
| `teleport` | { dx=0, dy=0, relative="facing"\|"world" } | ≤ 200 px, 1 per airtime, rise budget |
| `hit` | template; sibling keys: shape="circle"\|"capsule"\|"rect", frames=1, group, x, y, r, w, h, x1, y1, x2, y2 | template caps plus the Governor |
| `resource` | { name, add, set } | none (own state) |
| `cost` | { resourceName: amount, … } | none |
| `form` | form | form cooldown (45 f) |
| `status` | status | status caps |
| `armor` | { frames=10, threshold=6 [0–12] } | armor budget |
| `intangible` | frames | intangibility budget |
| `facing` | facing | none |
| `release` | template name, or an inline HitTemplate object | throw caps |
| `endIf` | { resource, grounded, airborne } | none |
| `goto` | frame | ≤ 8 loops per action instance |
| `emit` | name; sibling keys: data | fx budget |
| `sfx` | sound | sound budget |
| `camera` | { shake=0 [0–8] } | none |
<!-- /gen:timeline-actions -->

## 12. Resources and vars

**Resources** are meters (mana, heat, ammo, bees, plating, groove…). They gate moves (`cost`,
`requires`, `else`), feed scripts, and the HUD draws them automatically. They create no power by
themselves — everything they unlock is governed — so `max` and `regen` are free. `soak` (damage
absorbed by the resource) is defensive and budgeted.

<!-- gen:resource-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `min` | number | 0 |  |  |
| `max` | number | 100 (with a note) if missing | 1–1000 |  |
| `start` | number | max |  |  |
| `regen` | number | 0 |  | Per frame. |
| `regenDelay` | int | 0 |  | Frames after the last spend before regen resumes. |
| `regenWhen` | string | 'always' |  |  |
| `decay` | number | 0 |  | Per frame toward min. |
| `onHit` | object of {perDamage} | — |  |  |
| `onHurt` | object of {perDamage} | — |  |  |
| `soak` | object of {fraction [0..0.5], costPerDamage ≥0.5, forms?} | — |  | Plating: budgeted mitigation (§4.2.6). |
| `resetOnRespawn` | bool | true |  |  |
| `sync` | bool | true |  |  |
| `hud` | object of {style, label, color, forms} | {style: "bar", label: name} |  |  |
<!-- /gen:resource-fields -->

`hud` (how the meter is drawn in the player card):

<!-- gen:resource-hud-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `style` | 'bar' \| 'pips' \| 'ring' \| 'none' | 'bar' |  |  |
| `label` | string |  |  |  |
| `color` | string | — |  |  |
| `forms` | form name[] | — |  |  |
<!-- /gen:resource-hud-fields -->

**Vars** (`vars: { combo: 0, mode: 'calm', armed: false }`) are free-form per-fighter state for
scripts: ≤ 32 keys of number, boolean or string. Set them with `api.vars.set(k, v)`; the type must
match the initializer. They reset on respawn. List names in `sync` to send them to the art (≤ 16).

## 13. Statuses

Built-in statuses work by name everywhere (`status: 'burn'` on a hitbox, `{ status: 'slow' }` in
a timeline, `api.status(id, 'stun')`):

<!-- gen:builtin-statuses -->
| name | frames | effect |
|---|---|---|
| `burn` | 120 | DoT 0.5 every 15 f |
| `poison` | 240 | DoT 0.5 every 30 f |
| `freeze` | 30 | control: freeze |
| `stun` | 24 | control: stun |
| `slow` | 120 | speed ×0.7 |
| `root` | 45 | control: root |
| `silence` | 90 | control: silence |
| `confuse` | 60 | control: confuse |
| `weaken` | 180 | damageOut ×0.85 |
| `vulnerable` | 180 | damageIn ×1.1 |
| `float` | 90 | gravity ×0.6 |
| `mark` | 300 | no effect (a tag for scripts) |
<!-- /gen:builtin-statuses -->

Custom statuses are built only from capped modifiers:

<!-- gen:status-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `frames` | int | 120 (with a note) if missing | 1–300 |  |
| `stack` | 'refresh' \| 'add' \| 'ignore' | 'refresh' |  |  |
| `maxStacks` | int | 1 | 1–3 |  |
| `mods` | object of StatusMods | {} | speed 0.6–1.25, jump 0.7–1.2, gravity 0.5–1.4, fallSpeed 0.7–1.3, damageIn 0.85–1.15, damageOut 0.8–1.15, knockbackIn 0.85–1.2 |  |
| `dot` | object of {every ≥15, damage ≤0.5} | — |  |  |
| `control` | 'stun' \| 'freeze' \| 'root' \| 'silence' \| 'confuse' | — |  |  |
| `heal` | object of {every, amount} | — |  | Self statuses only; mitigation budget. |
| `visual` | string | — |  |  |
| `tint` | string | — |  |  |
| `icon` | string | — |  |  |
<!-- /gen:status-fields -->

<!-- gen:mod-ranges -->
| modifier | combined range |
|---|---|
| `speed` | 0.6–1.25 |
| `jump` | 0.7–1.2 |
| `gravity` | 0.5–1.4 |
| `fallSpeed` | 0.7–1.3 |
| `damageOut` | 0.8–1.15 |
| `damageIn` | 0.85–1.15 |
| `knockbackIn` | 0.85–1.2 |
<!-- /gen:mod-ranges -->

<!-- gen:status-caps -->
| cap | value |
|---|---|
| status frames | ≤ 300 |
| statuses per target / from one owner | ≤ 4 / ≤ 3 |
| DoT | ≤ 0.5 per tick, every ≥ 15 f, ≤ 10 per application, ≤ 2 DoTs per target |
| stun | ≤ 40 f, then 180 f immunity (stun group) |
| freeze | ≤ 40 f, then 180 f immunity (stun group) |
| root | ≤ 60 f |
| silence | ≤ 120 f |
| confuse | ≤ 90 f, then 300 f immunity (confuse group) |
| total control | ≤ 90 f per 600 f per target (stun, freeze, root, silence, grab) |
| re-applying control | within 300 f → duration ×0.5 |
<!-- /gen:status-caps -->

<!-- gen:status-limits -->
| limit | value |
|---|---|
| custom statuses | ≤ 8 |
| status frames / maxStacks | 1–300 / 1–3 |
| dot | every ≥ 15, damage ≤ 0.5 |
| heal | every ≥ 30, amount ≤ 1 |
| resources / max | ≤ 6 / 1–1000 |
| soak fraction / costPerDamage | 0–0.5 / ≥ 0.5 |
| vars / synced vars | ≤ 32 / ≤ 16 |
| var strings / numbers | ≤ 24 chars / ±1000000 |
<!-- /gen:status-limits -->

## 14. Entities

Anything that isn't your body: projectiles, minions, traps, zones, beams, clones and parts.
Define them once in `entities`, spawn them from the timeline (`spawn`), `every`, `onExpire`/
`onDeath` chains, or scripts (`api.spawn`).

```js
entities: {
  bolt:  { kind: 'projectile', shape: { r: 8 }, life: 60, motion: { type: 'linear', speed: 9 },
           hitboxes: [{ r: 10, damage: 6, angle: 40, knockback: 18, growth: 45, effect: 'electric' }] },
  pawn:  { kind: 'minion', shape: { x: 0, y: -16, r: 16 }, life: 900, hp: 12, maxAlive: 3,
           motion: { type: 'walker', speed: 2.5 }, hitboxes: [{ x: 0, y: -16, r: 18, damage: 4, angle: 50, knockback: 14, growth: 30, rehit: 40 }],
           think(view, e, api) { const t = view.nearestEnemy(e); if (t) api.command(e.id, { target: t.id }); } },
  wing:  { kind: 'part', shape: { r: 20 }, hurtbox: [{ r: 20 }], anchor: { x: -30, y: -70 } },  // relay 1: an extra hurtbox, permanent by default
  turret:{ kind: 'minion', life: 600, shape: { r: 12 }, vars: { shots: 0 }, motion: { type: 'stationary' },
           every: { frames: 45, spawn: 'bolt', aim: 'nearestEnemy' } },
}
```

<!-- gen:entity-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `kind` | 'projectile' \| 'minion' \| 'trap' \| 'zone' \| 'beam' \| 'clone' \| 'part' | 'projectile' (with a note) |  |  |
| `shape` | shape | circle r 10 |  |  |
| `life` | int | 60 (with a note) |  |  |
| `hp` | number | 0 |  | 0 = no hp (clanks unless clank:false). |
| `maxAlive` | int | — | 1–8 |  |
| `maxHits` | int | projectile/trap: 1 (+ pierce); other kinds: unlimited |  | Hits before the entity is spent. On minion/zone/beam/part/clone a value ≤ 1 means unlimited (they end by life/hp; rehit still gates repeats). |
| `pierce` | int | 0 |  |  |
| `motion` | object of Motion | by kind: projectile linear, minion walker, beam/part attached, clone mimic, trap/zone stationary |  |  |
| `collide` | 'die' \| 'bounce' \| 'stick' \| 'walk' \| 'pass' | 'die' |  |  |
| `platforms` | bool | false |  |  |
| `maxBounces` | int | 3 |  |  |
| `hitboxes` | list of Shape & HitTemplate & {start?, end?, use?, rehit?} | [] |  |  |
| `hurtbox` | shapes | [shape] if hp > 0, else none |  |  |
| `relay` | number | 1 | 0.5–1 | Parts only. |
| `length` | number | — | 0–520 | Beams. |
| `width` | number | — | 0–24 | Beams. |
| `anchor` | object of {x, y} | — |  |  |
| `reflectable` | bool | true |  |  |
| `absorbable` | bool | true |  |  |
| `clank` | bool | true |  |  |
| `clash` | bool | false |  |  |
| `every` | object of {frames ≥30, spawn, x?, y?, vx?, vy?, aim?} | — |  |  |
| `onSpawn` | list of TimelineAction | [] |  | Runs spawn, emit, sfx, camera, resource, status, hit (a template box on the entity) and form / velocity / impulse (on the owner, through its normal gates); other actions are removed (W415). |
| `onHit` | list of TimelineAction | [] |  | Runs spawn, emit, sfx, camera, resource, status, hit (a template box on the entity) and form / velocity / impulse (on the owner, through its normal gates); other actions are removed (W415). |
| `onExpire` | list of TimelineAction | [] |  | Runs spawn, emit, sfx, camera, resource, status, hit (a template box on the entity) and form / velocity / impulse (on the owner, through its normal gates); other actions are removed (W415). |
| `onDeath` | list of TimelineAction | [] |  | Runs spawn, emit, sfx, camera, resource, status, hit (a template box on the entity) and form / velocity / impulse (on the owner, through its normal gates); other actions are removed (W415). |
| `think` | fn | — |  | (view, e, api) => void. api.hit here strikes from the entity (its kind's caps). |
| `scale` | number | 1 | 0.5–1 | Clones: hurtbox scale. |
| `render` | object of {style?, color?, color2?, spin?} | {} |  |  |
| `tier` | enum | — | jab, tilt, smash, aerial, special, recovery, grab, throw, pummel, counter, utility, taunt, projectile, minion, trap, zone, beam, clone, status | Default ENTITY_LIMITS[kind].tier. |
| `vars` | object of {[k]: number\|boolean\|string} | — |  | Per-entity vars (≤ 4 keys), set from think with api.evars.set. |
<!-- /gen:entity-fields -->

<!-- gen:motion-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `type` | 'ballistic' \| 'linear' \| 'homing' \| 'orbit' \| 'attached' \| 'stationary' \| 'walker' \| 'boomerang' \| 'mimic' |  |  |  |
| `speed` | number |  |  |  |
| `accel` | number |  |  |  |
| `maxSpeed` | number |  |  |  |
| `gravity` | number |  |  |  |
| `turn` | number |  | 0–0.12 |  |
| `wobble` | number |  |  |  |
| `target` | 'nearestEnemy' \| 'owner' |  |  |  |
| `delay` | int |  |  |  |
| `radius` | number |  |  |  |
| `around` | 'owner' |  |  |  |
| `offset` | object of {x, y} |  |  |  |
| `snapToGround` | bool |  |  |  |
| `out` | int |  |  |  |
| `back` | number |  |  |  |
<!-- /gen:motion-fields -->

<!-- gen:every-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `frames` | int |  | 30–∞ |  |
| `spawn` | entity name | **required** (E012) |  |  |
| `x` | number | 0 |  |  |
| `y` | number | 0 |  |  |
| `vx` | number | — |  |  |
| `vy` | number | — |  |  |
| `aim` | 'nearestEnemy' | — |  |  |
<!-- /gen:every-fields -->

Per-kind limits (life, threat, hit counts, tier). By default projectiles and traps are spent after
one hit (`maxHits` 1, plus `pierce`); minions, zones, beams, parts and clones end by life or hp
(rehit keys still apply):

<!-- gen:entity-limits -->
| kind | max hit | min rehit | max life | max speed | max hp | threat | tier | KO floor % | extra |
|---|---|---|---|---|---|---|---|---|---|
| `projectile` | 11 | 10 | 240 | 14 | 6 | 1 | projectile | 140 | radius ≤ 28 |
| `minion` | 6 | 20 | 1200 | 8 | 20 | 2 | minion | 160 |  |
| `trap` | 10 | 45 | 900 | 6 | 15 | 2 | trap | 140 |  |
| `zone` | 12 | — | 30 | — | 0 | 2 | zone | 120 |  |
| `zoneLingering` | 3 | 15 | 360 | — | 0 | 3 | zone | 200 |  |
| `beam` | 4 | 8 | 90 | — | 0 | 3 | beam | 200 | length ≤ 520, width ≤ 24 |
| `clone` | 9 | — | 600 | — | 25 | 4 | clone | 140 | ×0.5 owner damage |
| `part` | 0 | — | ∞ | — | 25 | 1 | — | ∞ | relay 0.5–1; relay < 1 → hp ≤ 25, life ≤ 900 |
<!-- /gen:entity-limits -->

<!-- gen:entity-rules -->
| rule | value |
|---|---|
| entity definitions | ≤ 16 |
| homing turn | ≤ 0.12 rad/frame |
| every.frames | ≥ 30 |
| spawn offset from the body | ≤ 160 px |
| spawn count per entry | ≤ 5 (the Governor grants ≤ 4 spawns per 60 f per owner, so more at once is trimmed) |
| maxAlive | ≤ 8 |
| clone scale | 0.5–1 |
| share of entity damage counted in the spawning move's maxTotal | ×0.5 |
| default maxHits | projectile and trap: 1 (+ pierce); minion, zone, beam, part, clone: unlimited unless maxHits > 1 (they end by life/hp; rehit still applies) |
<!-- /gen:entity-rules -->

**Parts** (`kind: 'part'`, attached) are extra hurtboxes. `relay: 1` = a hit on the part is a hit
on you (wings, tails; permanent). `relay` 0.5–1 = the part soaks part of the damage (shields,
wrecks) — it then needs `hp ≤ 25` and a limited life, and the soaked share comes out of your
mitigation budget. **Clones** (`motion: { type: 'mimic', delay }`) replay your inputs with a delay
and deal half damage.

**Spawning from `think`:** `api.spawn(name, opts)` called in an entity's `think` starts **at that
entity**: `x`/`y` are offsets from the entity, mirrored by the *owner's* facing (pass `facing: e.facing`,
or `facing: 1` for raw world directions, to mirror by something else). `worldX`/`worldY` are world
coordinates, clamped to ±600 px around the entity. `vx`/`vy` are mirrored by the same facing,
`angle` (degrees, 0 = forward, positive = down) re-aims at the same speed, and `target: 'nearestEnemy'`
aims at the closest enemy. Accepted opts: `x, y, worldX, worldY, vx, vy, angle, facing, target`;
`count`, `spread` and `aimAt` are timeline-only and ignored by `api.spawn`. From fighter hooks and
`move.update`, the same opts are relative to the fighter. Every spawn path shares the Governor's
spawn rate (see `gov-entities` in §19), so ≤ 4 entities per 60 frames — `count: 5` is always
trimmed to 4.

## 15. Forms

Stances, transformations, mechs and pilots. A form overrides any of `stats`, `body`, `movement`,
`slots` and `armor`; anything unspecified is inherited from base. Forms share the one `moves`
pool and remap triggers with `slots`.

```js
forms: {
  puddle: { stats: { runSpeed: 7.6 }, body: { collider: { w: 90, h: 24 }, hurtboxes: { default: [{ shape: 'rect', x: 0, y: -12, w: 90, h: 24 }] } },
            movement: { crawl: { frames: 100 } }, slots: { jab: 'splash', upSpecial: 'spout' } },
},
moves: { downSpecial: { name: 'Morph', duration: 26, timeline: [{ at: 10, form: 'puddle' }] }, /* … */ },
```

<!-- gen:form-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `stats` | object of Partial<StatsDef> |  |  | Unspecified stats inherit from base. |
| `body` | object of BodyDef |  |  | Defaults to the base body. |
| `movement` | object of MovementDef |  |  | Merged over base movement per mode; a mode set to null/false is removed. |
| `slots` | map of string\|SlotFn | base slots (E011 if one names an unknown move) |  |  |
| `armor` | object of {threshold} |  |  | Passive armor for this form (default: base body.armor). |
| `art` | string | form name |  | art.forms key. |
<!-- /gen:form-fields -->

Switching has a 45-frame cooldown and 6 frames of transition hitlag; the collider is pushed out of
the ground. On KO you return to `startForm`.

## 16. Scripts: hooks, view and api

Real JavaScript for the long tail. Code may run in `move.update(view, api)`, `entity.think(view, e, api)`,
`behavior.*` hooks, slot functions and `ai.hint`. Every call is sandboxed: `Math.random`, `Date` and
`performance` throw ("use view.rng()"), views are frozen, and **every effect goes through a
Governor gate** — scripts can never directly change numbers, and they deal damage only through
named `hitboxes` templates.

### Hooks (`behavior`)

<!-- gen:hooks -->
| hook | signature | when | queued commands apply |
|---|---|---|---|
| `init` | (view, api) | match start and each respawn | immediately |
| `tick` | (view, api) | every frame after the fighter update | immediately after the hook |
| `onHit` | (view, api, ev) | once per hit dealt (after hit resolution) | after all hooks that frame |
| `onHurt` | (view, api, ev) | once per hit taken (after hit resolution) | after all hooks that frame |
| `onLand` | (view, api) | on landing | immediately after the hook |
| `onKO` | (view, api) | when the fighter is KO'd | immediately after the hook |
| `onRespawn` | (view, api) | on respawn | immediately after the hook |
| `onFormChange` | (view, api, {from, to}) | when the form changes | immediately after the hook |
<!-- /gen:hooks -->

`ev = {damage, granted, intended, targetId (onHit) | attackerId (onHurt), move, entity, entityId, tier, kind, x, y}`
(`intended` = before the Governor, `granted` = what actually landed; there is no KO flag — a KO
happens later, at the blast zone, and only the KO'd fighter's own `onKO` runs). Hooks are
notifications: they can never change the hit that triggered them.

### view (read-only)

| member | what you get |
|---|---|
| `view.frame` | match frame |
| `view.me` | `{id, x, y, vx, vy, facing, grounded, state, stateFrame, percent, stocks, form, bodyScale, move, air, statuses, control}`; `move` = `{name, frame, phase: 'startup'\|'active'\|'recovery'\|'charge'\|'hold', holdFrames, chargeFrames, hitSomething, counterIn}`; `air` = `{riseLeft, stallLeft, jumpsLeft, teleportsLeft, flyFuel}` |
| `view.res` | `{[resource]: value}` |
| `view.vars` | `{[var]: value}` |
| `view.input` | `held(b)`, `pressed(b)`, `released(b)`, `heldFrames(b)`, `dir()` → `{x, y}`; buttons: `left right up down jump attack special strong shield taunt` |
| `view.enemies()` | `[{id, x, y, vx, vy, facing, grounded, state, percent, statuses, form}]` |
| `view.nearestEnemy(from?)` | the closest enemy (to you, or to `{x, y}`), or null |
| `view.entities(name?)` | your live entities `[{id, name, x, y, vx, vy, age, life, hp, hits, facing, vars}]` (`hp` −1 = no hp) |
| `view.stage` | frozen geometry `{ground, platforms, blast}` |
| `view.rng()` | deterministic per-fighter random number in [0, 1) |
| `view.budget()` | what the Governor will still grant: `{entities, threat, riseLeft, stallLeft, teleportsLeft, intangibleLeft, armorLeft, mitigationLeft, statusSlotsLeft}` |

In `think`, `e` = `{id, name, x, y, vx, vy, age, life, hp, hits, facing, vars}`.

### api

**Immediate** (your own state only): `api.res.add(name, d)`, `api.res.set(name, v)`,
`api.vars.set(key, v)`, and in `think` `api.evars.set(key, v)` (entity `vars`, declared on the
entity def, ≤ 4 keys).

**Queued and governed** (applied at the next flush point, in call order; they return nothing — use
`view.budget()` to predict the outcome):

| call | gate and meaning |
|---|---|
| `api.startMove(name)` | only when actionable (buffered 7 frames, like input) |
| `api.cancelInto(name)` | only inside a `cancels` window that lists it |
| `api.endMove()` | ends the current move |
| `api.velocity(vx, vy, {mode})` / `api.impulse(vx, vy)` | speed cap and rise budget (\|vx\| ≤ 18, vy ≥ −17) |
| `api.teleport(dx, dy)` | ≤ 200 px, once per airtime, facing-relative dx; pushed out of the ground |
| `api.spawn(name, {x, y, worldX, worldY, vx, vy, angle, facing, target})` / `api.despawn(id)` / `api.command(id, {target, moveTo})` | entity budget and spawn rate; your own entities only; in `think` the spawn starts at the entity (§14) |
| `api.hit(template, shape, {frames, group})` | template-only damage, reach clamped to the move's tier |
| `api.status(target, name)` | `'self'`, or an enemy you just hit / touched / hit within 60 f and 220 px |
| `api.form(name)` | 45 f cooldown, 6 f transition |
| `api.setBodyScale(s)` | clamped to `body.scaleRange`, ≤ 0.02 per frame |
| `api.setHurtboxes(set \| null)` | a declared set; area rules apply |
| `api.modify(key, mods)` | named self-modifier set (§13 ranges); `null` removes it |
| `api.armor(frames, threshold)` / `api.intangible(frames)` | armor and intangibility budgets |
| `api.heal(amount)` | heal budget (≤ 1% per 30 f; excess is dropped — use a `heal` status for regen) |
| `api.emit(name, data)` / `api.sfx(name)` / `api.camera({shake})` | render events (data ≤ 256 B JSON, ≤ 8 per frame) |

Script limits and the fault policy (3 throws, or 2 calls over 8 ms, or an average over 1 ms per
tick across 60 ticks — timing ignored for the first 120 ticks — disables that fighter's scripts for
the match; data keeps working):

<!-- gen:script-limits -->
| limit | value |
|---|---|
| faults that disable a fighter's scripts | 3 throws, or 2 calls > 8 ms, or > 1 ms/tick averaged over 60 ticks (timing ignored for the first 120 ticks) |
| queued commands per fighter per frame | ≤ 24 |
| fx events per frame / emit data | ≤ 8 / ≤ 256 B JSON |
| startMove buffer when not actionable | 7 frames |
| form cooldown / transition hitlag | 45 / 6 frames |
| setBodyScale rate | ≤ 0.02 per frame, within body.scaleRange (0.6–1.6) |
| api.hit frames | 1–20 |
| status by id | target within 220 px and hit by you within 60 frames (or the onHit target / entity contact) |
| modify sets | ≤ 8 |
| ai.hint | evaluated at most every 10 frames |
<!-- /gen:script-limits -->

## 17. AI hints

CPUs read your validated kit (startup, reach, damage, KO %, spawns, recovery moves, movement
modes) automatically. Hints make them play your character the way you intend:

<!-- gen:ai-fields -->
| field | type | default | range | notes |
|---|---|---|---|---|
| `preferredRange` | number | — |  |  |
| `zoning` | bool | false |  |  |
| `recovery` | any of string[] \| {[form]: string[]} | — |  |  |
| `prefer` | move name[] | [] |  |  |
| `avoid` | move name[] | [] |  |  |
| `grapple` | bool | false |  |  |
| `hint` | fn | — |  | (view) => null \| {press?, hold?}: a trigger name (jab … downSpecial, or grab), routed through slots; other names do nothing. hold = keep pressing it for 20 frames. Evaluated every ≤ 10 frames, followed ~60% of the time. |
<!-- /gen:ai-fields -->

```js
ai: { preferredRange: 260, zoning: true, recovery: { base: ['upSpecial', 'sideSpecial'], puddle: ['upSpecial'] },
      prefer: ['neutralSpecial'], avoid: ['taunt'], grapple: false,
      hint: (view) => (view.res.charge >= 80 ? { press: 'downSpecial' } : null) },
```

## 18. Static balance: categories and limits

Every move belongs to a category (from its trigger, or `category`), which selects its static limits
and runtime tier.

<!-- gen:categories -->
| category | max hit | max total | min startup | min duration | KO floor % | max reach (abs) | reach beyond body (v2) | max radius | max dps |
|---|---|---|---|---|---|---|---|---|---|
| `jab` | 5 | 9 | 2 | 14 | 220 | 100 ×1.8 | 70 | 30 | 0.45 |
| `tilt` | 12 | 13 | 5 | 22 | 125 | 125 ×1.8 | 95 | 36 | 0.5 |
| `smash` | 18 | 20 | 10 | 38 | 85 | 140 ×1.8 | 110 | 46 | 0.48 |
| `aerial` | 14 | 15 | 4 | 24 | 110 | 120 ×1.8 | 90 | 40 | 0.55 |
| `special` | 15 | 18 | 6 | 26 | 100 | 135 ×1.8 | 105 | 42 | 0.5 |
| `recovery` | 12 | 14 | 3 | 30 | 120 | 125 ×1.8 | 95 | 40 | 0.45 |
| `grab` | 0 | 0 | 6 | 28 | ∞ | 100 ×1.8 | 60 | 30 | — |
| `throw` | 12 | 14 | 1 | 24 | 130 | 100 ×1.8 | 60 | 36 | 0.6 |
| `pummel` | 3 | 3 | 2 | 14 | ∞ | 90 ×1.8 | 60 | 30 | 0.25 |
| `counter` | 15 | 15 | 2 | 30 | 100 | 125 ×1.8 | 90 | 40 | 0.6 |
| `utility` | 6 | 8 | 4 | 20 | 200 | 120 ×1.8 | 80 | 40 | 0.4 |
| `taunt` | 2 | 2 | 6 | 40 | ∞ | 100 ×1.8 | 60 | 40 | 0.1 |
<!-- /gen:categories -->

<!-- gen:action-limits -->
| limit | value |
|---|---|
| duration | category minDuration–150 |
| one hitbox window | ≤ 40 frames |
| hitbox radius | ≥ 4 |
| rehit | ≥ 3 |
| knockback / growth / setKnockback | ≤ 90 / 0–130 / 0–120 |
| intangible frames per action / per timeline grant | ≤ 12 / ≤ 20 |
| action armor threshold | ≤ 12 damage |
| landingLag | 0–40 |
| gravity window scale | 0.3–1.5 |
| hold.max / charge.max / counter.mul | 1–600 / 1–60 / 1–1.3 |
| shieldMul, hitlagMul / wind push | 0.5–1.5 / 0–6 px/f |
| steer speed / turn | 0–12 / 0–0.3 |
| teleport | ≤ 200 px |
| camera shake | 0–8 |
| self speed in a move | \|vx\| ≤ 14, \|vy\| ≤ 17 |
| rise per move | upSpecial-routed ≤ 300 px, others ≤ 120 px |
| horizontal travel per move | ≤ 340 px |
<!-- /gen:action-limits -->

<!-- gen:tiers -->
| tier | tier max hit (runtime cap = min(1.4 ×, 25)) | KO floor % |
|---|---|---|
| `jab` | 5 | 220 |
| `tilt` | 12 | 125 |
| `smash` | 18 | 85 |
| `aerial` | 14 | 110 |
| `special` | 15 | 100 |
| `recovery` | 12 | 120 |
| `grab` | 0 | ∞ |
| `throw` | 12 | 130 |
| `pummel` | 3 | ∞ |
| `counter` | 15 | 100 |
| `utility` | 6 | 200 |
| `taunt` | 2 | ∞ |
| `projectile` | 11 | 140 |
| `minion` | 6 | 160 |
| `trap` | 10 | 140 |
| `zone` | 12 | 120 |
| `zoneLingering` | 3 | 200 |
| `beam` | 4 | 200 |
| `clone` | 9 | 140 |
| `part` | 0 | ∞ |
| `status` | 0.5 | ∞ |
<!-- /gen:tiers -->

Each move also has a **power budget** (damage, KO power, reach, speed, extras) and each form a
total move-power budget; over-budget moves are scaled (W2xx notes). `--explain` shows every move's
startup, damage, KO % and power.

## 19. The runtime Governor

The Governor sits inside the hit pipeline and the physics step. It is the actual fairness
guarantee: whatever data or code a character has, these caps hold.

<!-- gen:gov-hit -->
| step | rule |
|---|---|
| multiplier | stale (≥ 0.5) × charge (≤ 1.4) × damageOut × damageIn × reflected 1.25 × clone 0.5, clamped 0.5–1.5 |
| per-hit cap | min(1.4 × tier max hit, 25) |
| launch speed | ≤ 40 px/f |
| KO floor | below max(60, tier KO floor)% the launch is capped to 0.95 × the weakest KO speed within ±12° (DI) × ramp (0.55 at 0% → 1 at the floor) |
| spikes on airborne targets below the floor | angles 200–340: vertical speed ≤ 9, hitstun ≤ 20 (intended; counted apart from KO-floor clamps) |
| armor | flinch-only; fails against kb ≥ 200 |
| hitlagMul | 0.5–1.5 |
<!-- /gen:gov-hit -->

<!-- gen:gov-combo -->
| rule | value |
|---|---|
| chain ends after | 12 actionable frames |
| rehit hits count as | 0.333 hit |
| damage proration | max(0.5, 1 − 0.06·(n − 1)) |
| hitstun proration | max(0.5, 1 − 0.05·(n − 1)) |
| BREAK | n ≥ 14, or chain damage ≥ 55, or 180 non-actionable frames → 30 f intangible + 120 f stun/freeze/grab immunity |
<!-- /gen:gov-combo -->

<!-- gen:gov-rate -->
| window (attacker → target, all sources) | rule |
|---|---|
| 120 frames | above 40 damage the excess is ×0.25; hard cap 50 |
| 600 frames | hard cap 140 |
| trimmed hits | still deal ≥ 0.3 so they connect |
| shield, 120 frames | soft 35 (×0.25), hard 45 |
<!-- /gen:gov-rate -->

<!-- gen:gov-air -->
| budget (per airtime) | value |
|---|---|
| self velocity | \|vx\| ≤ 18, vy ≥ −17 |
| rise from non-jump sources | ≤ 380 px |
| stall (frames with -1 ≤ vy ≤ 2.5 not from knockback) | ≤ 240 |
| teleports | ≤ 1 per airtime, ≤ 200 px; grounded sideways ≤ 1 per 20 frames; none in hitstun, stun or grabbed |
| long-air backstop | 600 frames airborne without landing or being hit → helpless |
| refund on a tumble hit | 50% of spent rise and stall |
<!-- /gen:gov-air -->

<!-- gen:gov-defense -->
| budget | value |
|---|---|
| mitigation (soak + relay + damageIn savings + heal) | ≤ 45 per stock, ≤ 50% of one hit, ≤ 20 per 300 frames |
| heal rate | ≤ 1 per 30 frames, never in hitstun |
| armor | threshold ≤ 12 (passive ≤ 3); active uptime ≤ 60 per 300 frames |
| intangibility from character sources | ≤ 20 per grant; ≤ 45 per 300 frames (a successful counter costs 12) |
| tiny hurtboxes | frames below 1600 px² (or 0.6 × default area) are charged as intangibility |
<!-- /gen:gov-defense -->

<!-- gen:gov-entities -->
| runtime cap (per owner) | value |
|---|---|
| alive / threat points | ≤ 8 / ≤ 10 |
| beams / traps+zones / entities with hp / clones | ≤ 1 / ≤ 3 / ≤ 3 / ≤ 1 |
| spawn rate | ≤ 4 per 60 frames |
| hp-entity template cooldown after it dies | 300 frames |
| threat per kind | projectile 1, minion 2, trap 2, zone 2, zoneLingering 3, beam 3, clone 4, part 1 |
<!-- /gen:gov-entities -->

If gov events fire in normal play (training shows them, and `npm run validate -- <id> --audit`
counts them), retune rather than leaning on the Governor.

## 20. Notes: E, I and W codes

**E-codes** block loading (structural problems). **I-codes** are information (unknown keys, generic
fallbacks). **W-codes** mean the balancer changed a number — each says how to get your intent back.
Aim for zero W-notes.

<!-- gen:codes-e -->
| code | meaning | fix |
|---|---|---|
| `E001` | bad, missing or mismatched id | use lowercase letters/digits/dashes (2–24 chars, starting with a letter) matching the folder name. |
| `E002` | missing name | add name: 'Your Name' (≤ 18 characters). |
| `E003` | module default is not an object | export default defineCharacter({ ... }). |
| `E004` | import or throw at load time | remove top-level side effects; character files must only declare data and functions. |
| `E010` | a slots value names a missing move, or is neither a string nor a function | point the slot at a key of moves, or use (view) => name. |
| `E011` | startForm or a form slot references something unknown | declare the form under forms, or point the slot at a key of moves. |
| `E012` | an entity reference (spawn, every, onExpire) is unknown | declare the entity under entities. |
| `E013` | a hit template referenced by use/hit/release is unknown | declare it under hitboxes, or write the hit fields inline. |
| `E014` | a timeline entry has zero or multiple action keys | split it into one entry per action (spawn, velocity, hit, emit, …). |
| `E015` | a function where data is required, or a non-function where a function is required | only update, think, behavior.*, slot functions and ai.hint may be functions. |
| `E016` | a vars initializer is non-serializable or of a bad type | vars may only hold finite numbers, booleans or strings. |
| `E017` | a move duration is missing or not a number | add duration: <frames> (60 = one second). |
| `E018` | a name collides with a built-in JavaScript property (constructor, toString, __proto__, …) | rename it, e.g. constructor → builder. |
| `E020` | lint failure (scripts/lint-characters.js; CI and npm test) | see the rule id and fix printed with the note |
<!-- /gen:codes-e -->

<!-- gen:codes-i -->
| code | meaning | fix |
|---|---|---|
| `I001` | unknown field (kept, not used by the engine) | check the spelling, or remove it. |
| `I002` | a trigger has no move, so a generic move is used | add a move with that name, or route the trigger with slots. |
| `I003` | grab/throws/taunt fall back to generic moves | add moves named grab, pummel, fthrow, bthrow, uthrow, dthrow, taunt to customize them. |
| `I004` | a missing or malformed value was replaced by its default | set it explicitly. |
| `I005` | unknown reference (ignored at runtime) | check the spelling of the move/status/resource/form/var name. |
| `I006` | move is not reachable from any trigger, else, next, cancel, hold or counter | route it with slots, or call api.startMove from a script. Moves a slot function returns as a literal name ('majorChord') count as routed from its trigger. |
| `I007` | v1 character file converted to v2 (no changes needed) | optional: npm run migrate -- <id>. |
| `I008` | a custom status overrides a built-in status | rename it if you meant a new status. |
| `I009` | effect name is close to a v1 preset | effects are open vocabulary; fix the spelling to get the preset. |
| `I010` | v1 move key is not a slot, so it is never used | rename it to a slot name. |
<!-- /gen:codes-i -->

<!-- gen:codes-w -->
| code | what was adjusted | how to get your intent back |
|---|---|---|
| `W101` | text too long | shorten it (names ≤ 18, move names ≤ 24, descriptions ≤ 220). |
| `W110` | stat out of range | pick a value inside the range; the stat is clamped either way. Slower than the minimum on purpose? Keep the minimum and call api.modify('heavy', { speed: 0.6 }) in behavior.init (§13 ranges). |
| `W120` | stats over budget | lower a stat you care less about, or buy points back with a bigger hurtbox. |
| `W130` | collider out of range | collider w 20–160, h 20–200. |
| `W131` | too many hurtbox shapes or sets | ≤ 6 shapes per set, ≤ 8 sets. |
| `W132` | hurtbox outside the body envelope | keep shapes within x ±2·max(w,h), y −2.5h…0.5h of the feet. |
| `W133` | hurtbox area out of range | priced area (default set × scaleMin²) must be 1600–16000 px². |
| `W134` | scaleRange clamped | scaleRange must stay within 0.6–1.6. |
| `W135` | passive armor clamped | passive armor is 0–3 damage (2.5 stat points per point). |
| `W136` | hurtbox off the body | every hurtbox set must overlap the collider (cover its center, ≥ 20% of it, or sit ≥ 50% on it). |
| `W140` | too many forms | use at most 6 forms. |
| `W200` | v1 adjustment | see the message; v1 files use the v1 rules. |
| `W201` | duration adjusted | give the move more recovery, or less damage per frame. |
| `W202` | startup delayed | add anticipation frames on purpose (animation reads better too). |
| `W203` | active window capped | split long windows into separate boxes, or use rehit. |
| `W210` | per-hit damage capped | keep it feeling huge with growth, or split it into a multi-hit group. |
| `W211` | total damage scaled | fewer hits, a longer rehit, or move some damage into another move. |
| `W212` | knockback clamped | knockback ≤ 90, growth ≤ 130, setKnockback ≤ 120. |
| `W213` | KO floor | use less knockback with more growth, or a less direct angle. |
| `W214` | hitbox radius clamped | make the box smaller, or use a capsule along the limb. |
| `W215` | reach pulled in | move the hitbox closer, or give the body a bigger hurtbox there. |
| `W216` | rehit raised | rehit must be ≥ 3 frames. |
| `W217` | hit modifier clamped | shieldMul/hitlagMul 0.5–1.5, push 0–6. |
| `W220` | intangibility capped | ≤ 12 intangible frames per action, ≤ 20 per grant. |
| `W221` | armor clamped | action armor threshold ≤ 12, ≤ 60 frames per grant. |
| `W222` | landing lag clamped | aerials 6–40 frames. |
| `W223` | hold/charge/counter clamped | hold.max 1–600, charge.max 1–60, counter.mul 1–1.3. |
| `W224` | gravity window clamped | gravity scale 0.3–1.5. |
| `W230` | hit template clamped | templates are clamped against the strictest move/entity that uses them. |
| `W301` | self speed clamped | \|vx\| ≤ 14, \|vy\| ≤ 17 px/frame. |
| `W302` | travel / rise scaled | upSpecial may rise 300 px, other moves 120; any move travels ≤ 340 px. |
| `W303` | teleport clamped | teleports are ≤ 200 px. |
| `W304` | steer clamped | steer speed 0–12, turn 0–0.3. |
| `W310` | movement mode clamped | see MOVEMENT_MODES ranges. |
| `W401` | entity hit clamped | see ENTITY_LIMITS for the kind. |
| `W402` | entity life clamped | see ENTITY_LIMITS[kind].maxLife. |
| `W403` | entity speed clamped | see ENTITY_LIMITS[kind].maxSpeed. |
| `W404` | entity hp clamped | see ENTITY_LIMITS[kind].maxHp. |
| `W405` | entity rehit raised | see ENTITY_LIMITS[kind].minRehit. |
| `W406` | beam size clamped | beams are ≤ 520 px long and ≤ 24 px thick. |
| `W407` | homing turn clamped | homing turn ≤ 0.12 rad/frame. |
| `W408` | every.frames raised | periodic spawns are at most every 30 frames. |
| `W409` | spawn clamped | count ≤ 5, spawn point ≤ 160 px from the body. |
| `W410` | maxAlive clamped | maxAlive ≤ 8. |
| `W411` | relay/scale clamped | parts relay 0.5–1; clone scale 0.5–1. |
| `W412` | entity KO floor | entities KO late by design; use less knockback. |
| `W413` | entity size clamped | projectiles are ≤ 28 px radius. |
| `W414` | too many entities | ≤ 16 entity definitions. |
| `W415` | entity list action removed | entity lists run spawn, emit, sfx, camera, resource, status, hit (on the entity), form and velocity/impulse (on the owner). |
| `W416` | entity grab box | grab boxes only work on moves; use a strike that pulls, or a grab move. |
| `W501` | status clamped | frames 1–300, maxStacks 1–3. |
| `W502` | status modifier clamped | see MOD_RANGES. |
| `W503` | DoT clamped | dot every ≥ 15 frames, damage ≤ 0.5. |
| `W504` | control duration clamped | stun/freeze ≤ 40, root ≤ 60, silence ≤ 120, confuse ≤ 90 frames. |
| `W505` | heal clamped | heal ≤ 1 per 30 frames. |
| `W510` | resource clamped | max 1–1000, start within min–max, soak fraction ≤ 0.5. |
| `W511` | too many resources/vars/statuses | ≤ 6 resources, 32 vars, 16 synced vars, 8 custom statuses. |
| `W512` | var clamped | strings ≤ 24 characters, numbers within ±1e6. |
| `W601` | power budget | make a few moves slower, shorter-ranged or weaker on purpose, or add a resource cost. |
| `W602` | fixed bonuses trimmed | spend less on intangibility, armor and spawns. |
<!-- /gen:codes-w -->

## 21. Universal rules and controls

Same for everyone, not editable by characters: shield, dodges, DI, stale-move decay, smash charge
(×1.4 max), respawn, blast zones, the stage. Hit by the same move repeatedly? Damage decays.

Keyboard (solo / training): move WASD or arrows · jump Space · attack J · special K · smash I ·
shield L or Shift · grab = shield + attack · **taunt T**. Training: **H** hitboxes · **R** reset
positions · **Y** slow-mo. Gamepad: X attack · B special · right stick smash · bumpers/triggers
shield · A/Y jump · Back taunt.

## 22. Testing workflow

1. `npm run validate -- <id> --explain` until the notes are empty (or each one is explained).
2. `npm run lint` and `npm run assets` (also part of `npm test`).
3. Art Lab: `lab.html?char=<id>&boxes=1` — every state, move, form and entity; `npm run art-check -- <id> --sheet` and **read the contact sheet PNG**.
4. Training against a hard CPU: `/?train=<id>&cpu=hard` (plain `/?train=<id>` is a standing dummy). Watch for gov events.
5. `npm test`.

## 23. v1 characters

A file with no `version` (no `defineCharacter`) is v1: `stats` (including `width`/`height`) and
the 16 `moves` with `hitboxes`, `projectiles`, `velocity`, `intangible`, `landingLag`, plus a puppet
`art`. v1 files keep loading unchanged and are balanced with the v1 rules. `npm run migrate -- <id>`
rewrites a v1 file into v2 syntax (behaviour preserved; it lists the balance notes that are new under
v2 rules).
