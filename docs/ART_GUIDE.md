# Art Guide (v2)

How to make your fighter look **exceptional** — whatever it is. A storm cloud, a bee swarm, a
grandma on a scooter, a slime, a mech, a dragon: procedural Canvas 2D, sprite sheets and hybrids
are all first-class, and the humanoid puppet is just one optional helper. Art never affects
gameplay: the simulation only reads the validated data (see [CHARACTER_GUIDE.md](CHARACTER_GUIDE.md)).

- **Part A** — the art contract every character uses (`art.js`, `draw`, `view`, `info`, entities, fx, sounds, portraits, the Lab, the quality bar).
- **Part B** — the humanoid puppet (`rig: 'humanoid'`): palette/build/hooks/poses, the v1 path used by ember, bastion, volt and mirelle.

Preview in the **Art Lab**: `http://localhost:3000/lab.html?char=<id>` (`&boxes=1` shape-accurate
hit/hurtboxes, `&frame=strike` freeze every move on its strike frame, `&form=<f>`, `&palette=<n>`,
`&sil=1` silhouette, `&half=1` 0.5× camera, `&still=1` no animation, `&checks=1` run the automatic
checks, `&speed=<x>` playback speed, `&sandbox=1` a live Governor sandbox vs a dummy, `&sbmove=<move>` to
repeat one move in it). Export the contact sheet with `npm run art-check -- <id> --sheet` and **read**
`.cache/contact-sheets/<id>.png`.

---

## Contents

**Part A — the art contract**

- [A1. The ArtDef](#a1-the-artdef)
- [A2. `draw(ctx, view, info)`](#a2-drawctx-view-info)
- [A3. `view`](#a3-view)
- [A4. `info`](#a4-info)
- [A5. Procedural recipes and helpers](#a5-procedural-recipes-and-helpers)
- [A6. Sprites and images](#a6-sprites-and-images)
- [A7. Entities, world layers and trails](#a7-entities-world-layers-and-trails)
- [A8. Effects, particles and sound](#a8-effects-particles-and-sound)
- [A9. Portraits, palettes, HUD](#a9-portraits-palettes-hud)
- [A10. The Lab, art-check and the contact sheet](#a10-the-lab-art-check-and-the-contact-sheet)
- [A11. The quality bar](#a11-the-quality-bar)

**Part B — the humanoid puppet** (sections 1–15 below)

---

# Part A — the art contract

## A1. The ArtDef

`art.js` exports one object (client only; it may import `../../shared/art/**` and your own files):

```js
import * as kit from '../../shared/art/kit.js';
export default {
  rig: 'none',                                   // 'none' = you draw everything; for the puppet use humanoid({...}) (Part B)
  bounds: { left: -90, right: 110, top: -170, bottom: 14 },   // body px; or per form { base: {...}, puddle: {...} }
  palette: { main: '#5d7fd6', effect: '#bfe9ff', outline: '#1b2346' },
  palettes: [{}, { main: '#d65d9e' }, { main: '#5dd6a2' }],   // alternates for duplicate picks
  assets: { sheet: './cloud.png', zap: './zap.ogg' },        // decoded before the match (null if missing)
  sheets: {}, clips: {},                                      // sprite sheets (A6)
  init(cache, info) { cache.puffs = []; },                    // per-fighter persistent cache
  draw(ctx, view, info) { /* body space, mirrored for you, clipped to bounds */ },
  drawBack(ctx, view, info) {},                               // world space at the feet, behind all fighters
  drawWorld(ctx, view, info) {},                              // world space, after fighters and entities (beams, tethers)
  entities: { bolt: { draw(ctx, e, info) {} } },              // one per entity (A7)
  trail: (view, info) => null,                                // null = default (active hitbox centers), false = none
  fx: { onHit(fx, ev, info) {}, onEvent: { thunder(fx, ev) {} } },   // A8
  sounds: { jump: 'whoosh', thunder: 'thunder', zap: 'zap' },        // events/moves → assets, presets or SynthSpecs
  portrait: { x: 0, y: -60, r: 50 },                          // or (ctx, size, info) => void (A9)
  hud(ctx, rect, info) {},                                    // extra widget in the player card
  forms: { puddle: { bounds: { left: -110, right: 150, top: -130, bottom: 12 } } },
};
```

Bounds: default = hurtbox AABB × 1.4; each extent is clamped to ≤ 4× the collider, total ≤ 900 ×
900 body px. Everything outside is clipped, and the Lab warns when opaque pixels touch the edge.

## A2. `draw(ctx, view, info)`

Called every rendered frame (60 Hz, up to 4 fighters) into an offscreen canvas in **body space**:
origin at the feet, +x forward (already mirrored when facing left), y up is negative. The host
does **not** apply `bodyScale` to `draw`: `info.hurtboxes`/`info.hitboxes` and `info.bounds` are
already scaled, but your own drawing and sprites are not, so art that grows with `bodyScale`
should `ctx.scale(view.bodyScale, view.bodyScale)` itself (and divide box positions back), or
build its shapes from `info.hurtboxes`. The engine adds the global polish: hit flash, intangibility
flicker, player-color rim, shadow, shield bubble, name tag. If `draw` throws, a magenta hurtbox is
drawn and the Lab shows the error.

Drive everything from the **phase**, not raw frame numbers — phases are computed from the
*validated* move, so animation stays aligned after the balancer shifts frames:

```js
draw(ctx, v, info) {
  const m = v.move;                                      // null when not in a move
  const p = info.phase;                                  // { name: 'startup'|'active'|'recovery'|'charge'|'hold'|null, t: 0..1 }
  const ease = (t) => t * t * (3 - 2 * t);
  const windup = p.name === 'startup' ? ease(p.t) : 0;
  const strike = p.name === 'active' ? 1 : p.name === 'recovery' ? 1 - p.t : 0;
  // anticipation → impact → follow-through; put the striking part INSIDE info.hitboxes on active frames
}
```

## A3. `view`

The snapshot fighter (identical online and offline) plus:

`index, color, form, state, stateFrame, grounded, facing, x, y, vx, vy, percent, stocks, resources {name: value}, resMax,
vars (synced), statuses [{name, frames, stacks}], bodyScale, control, hitFlash, interp, entities [own], events [one-shot since last render],
move: null | { name, anim, def (validated action), frame, duration, phase, phaseT, t, charge01, chargeFrames, holdFrames, startup, activeEnd, effect, color }`.

`view.state` is one of the sim's closed enum (`shared/sim/states.js`): `idle run crouch jumpsquat air land attack shield roll
spotdodge airdodge hitstun helpless shieldbreak dead respawn grabbing grabbed stunned glide fly wallcling crawl taunt`.
Branch on those (e.g. `v.state === 'hitstun'`, `v.state === 'air' && v.vy < 0` for rising; `view.tumble` is true in
tumble hitstun). Moves run in `attack`, `grabbing` (grab, pummel, throws) or `taunt`, with `view.move` set.
Sprite clip names (A6) are friendlier aliases: `air` → `jump`/`fall` by `vy`, `hitstun` → `tumble`/`hurt`,
`shieldbreak` → `stunned`/`hurt`, `jumpsquat` → `crouch`/`land`. Check every state in the Lab.

## A4. `info`

| member | what it is |
|---|---|
| `info.kit` | the kit (A5) |
| `info.palette` | your palette, already resolved for the duplicate-pick alternate |
| `info.time`, `info.dt`, `info.simFrame` | smooth seconds, frame delta, sim frame |
| `info.cache` | per-fighter persistent object (springs, trails, flocks, canvases) |
| `info.assets` | decoded images/sounds by name (`null` if missing — handle it) |
| `info.sprite` | `drawClip(ctx, sheetOrForm, view, opts)`, `drawFrame(ctx, sheet, index, opts)` |
| `info.hitboxes`, `info.hurtboxes` | the **real** active hit shapes and current hurt shapes, body space |
| `info.phase` | `{name, t, total}` shorthand of the move phase |
| `info.fx` | the world particle API (A8), plus `fx.local` emitters attached to you |
| `info.light` | `{dir: {x, y}, rim, ambient}` from the stage — use it for rim light |
| `info.motion` | `{squash, stretch, lean}` from velocity and landings |
| `info.rng` | visual-only seeded random (stable per frame) |
| `info.quality` | `'high'` or `'low'` (the renderer drops to low if your draw is slow) |
| `info.tint(color, alpha)` | tint the whole fighter this frame (statuses) |
| `info.drawIdle(ctx, opts)`, `info.drawSelf(ctx, view, opts)` | draw yourself again (clones, reflections, portraits) |
| `info.u`, `info.H`, `info.W` | collider units (u = H/100) |
| `info.bounds`, `info.form`, `info.lab` | current bounds, form, true inside the Lab |
| `info.rig` | humanoid rig (lazy; Part B) |

## A5. Procedural recipes and helpers

`../../shared/art/kit.js` exports (generated):

<!-- gen:kit-exports -->
`beam` `blinkIcon` `blobPath` `capsulePath` `circle` `clamp` `cloudPuffs` `droplet` `ellipse` `fillPath` `fillShaded` `glow` `goo` `groupAlpha` `hash01` `lerp` `lightning` `limb` `linear` `makeCanvas` `mix` `noise1` `outline` `parse` `parseCacheSize` `polygonPath` `radial` `rain` `rgba` `rimArc` `rimLight` `rimLightPath` `roundRectPath` `seeded` `shade` `shapeCenter` `shapeGlow` `shapeKind` `shapePath` `shapePoint` `smear` `speedLines` `starPath` `toHex` `yarnBall`
<!-- /gen:kit-exports -->

Shape-following helpers in `../../shared/art/helpers/` (each file's header has a copy-paste example):

| helper | for |
|---|---|
| `blob.js` | soft bodies that spring toward the hurtbox/hitbox shapes: slimes, gel, ghosts, clouds |
| `swarm.js` | boids that flock inside shapes and pour into hitboxes: bees, bats, sparks, crowds |
| `serpent.js` | spine chains: snakes, dragons, eels, scarves, tails |
| `tentacle.js` | curling limbs with FABRIK reach into hitboxes: octopi, vines |
| `wing.js` | membrane or feathered wings with a flap cycle and fold |
| `quadruped.js` | four-legged gait rig with IK legs: wolves, horses, dragons on foot |
| `mech.js` | rigid plates, pistons, thrusters and 2-bone IK: robots, mechs, machines |

Recipe for a non-humanoid (see `characters/nimbus/art.js`, `characters/gloop/art.js`):

1. Build the silhouette from `info.hurtboxes` (so art and hurtboxes agree by construction), then exaggerate it on active frames toward `info.hitboxes`.
2. Paint in 2–3 value tiers per material (shadow, base, light), add a rim light along the edge facing `info.light.dir`, then a dark tinted outline (2.5–3.5 u, never pure black).
3. Give it a face or a focal point that reacts (`hurt`, attacking, idle blinks).
4. Never let idle be static: breathing, drifting particles, secondary motion through `info.cache` springs.

## A6. Sprites and images

```js
assets: { body: './gertie.png' },
sheets: { body: { image: 'body', frameW: 128, frameH: 128, cols: 8, anchor: [64, 120], scale: 1, pixelated: false } },
clips: { body: { idle: { frames: [0, 1, 2, 3], fps: 8, loop: true }, run: { frames: [8, 9, 10, 11], fps: 12, loop: true, speedFrom: 'vx' },
                 ram: { sync: 'move', startup: [16, 17], active: [18], recovery: [19, 20] } } },
draw(ctx, v, info) { if (!info.sprite.drawClip(ctx, 'body', v)) drawFallback(ctx, v, info); },
```

Clip resolution: a clip named after `move.anim` → the state clip → `idle`. Clip names for states (generated):

<!-- gen:state-clips -->
`idle` `run` `jump` `fall` `land` `crouch` `shield` `roll` `spotdodge` `airdodge` `hurt` `tumble` `helpless` `grabbing` `grabbed` `stunned` `glide` `fly` `wallcling` `crawl` `taunt` `dead` `respawn`
<!-- /gen:state-clips -->

`sync: 'move'` maps each phase across its frame list, so sprites stay aligned with scaled frame
data. Paint source art at ≥ 2× display size; `pixelated: true` for pixel art. Missing assets are
`null`: always keep a procedural fallback. Asset formats and limits (`npm run assets`, generated):

<!-- gen:asset-limits -->
| asset | formats | limits |
|---|---|---|
| images | png, webp, svg | ≤ 1.5 MB each, ≤ 4096 px per side; SVG without scripts or external references |
| audio | ogg, mp3 | ≤ 400 KB each |
| code | js, mjs | ≤ 300 KB total |
| notes | json, md, txt |  |
| whole folder |  | ≤ 6 MB, ≤ 40 files; anything else (jpg, gif, wav, …) is an error |
<!-- /gen:asset-limits -->

## A7. Entities, world layers and trails

Every entity can have its own art: `entities: { name: { draw(ctx, e, info), drawWorld?(ctx, e, info) } }`.
`draw` is in entity space (origin at the entity, rotated/mirrored for its heading); `e` has
`{id, name, kind, def, owner, x, y, vx, vy, angle, age, life, maxLife, lifeT, hp, len, facing, vars, shape, render, seed, view}`.
Beams have `len`; clones have `view` — draw them with `info.drawSelf(ctx, e.view, {alpha, scale})`.
Entities without art fall back to the v1 projectile styles (`render: {style, color, color2, spin}`).

`drawBack` and `drawWorld` draw in world space at your feet (not mirrored, not clipped): auras,
gilded frames, tethers, beams, text. `trail` returns the point a motion trail should follow.

## A8. Effects, particles and sound

Engine events call `art.fx.onX(fx, ev, info)` and fall back to defaults: `onHit onHurt onLand onJump
onKO onRespawn onFormChange`, `onMove: {[moveName]: fn}`, and `onEvent: {[name]: fn}` for your
timeline `emit` / `api.emit` events (`ev.data` is the JSON you sent).

```js
fx: {
  onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 12, shape: 'spark', colors: ['#fff', '#7fd3ff'], speed: [3, 9], life: [10, 18], blend: 'lighter' }); fx.shake(3); },
  onEvent: { thunder(fx, ev) { fx.flash('#e8fbff', 0.25, 4); fx.line({ x: ev.x, y: ev.y - 400, x2: ev.x, y2: ev.y, jag: 30, width: 6 }); fx.sound('thunder'); } },
},
```

The `fx` API: `burst`, `ring`, `line`, `text`, `trail(id, …)`, `afterimage`, `decal` (fades over 3
s), `shake(≤ 8)`, `flash(color, ≤ 0.35, ≤ 6 f)`, `sound(name, {volume, pitch})`, and
`fx.local.<shape>({x, y, rate, …})` emitters attached to you. Budgets: ≤ 400 live particles per
character, 2000 global; ≤ 8 sounds per second. Particle shapes (generated):

<!-- gen:fx-shapes -->
`spark` `dot` `smoke` `debris` `ring` `drip` `streak` `glow` `star` `shard`
<!-- /gen:fx-shapes -->

`sounds` maps any engine event, move name or custom event to an asset name, a preset, a SynthSpec
`{type, freq: [a, b], dur, gain, vibrato}`, or `null`. Presets (generated):

<!-- gen:sound-presets -->
`zip` `buzz-thwack` `clank` `boom` `squeak` `zap` `splash` `whoosh` `crunch` `chime` `roar` `alarm` `boing` `honk` `thunder` `gulp`

Limits: ≤ 8 sounds per second per character, SynthSpec dur ≤ 2 s, freq 20–12000 Hz.
<!-- /gen:sound-presets -->

## A9. Portraits, palettes, HUD

- `portrait`: a function `(ctx, size, info)`, a framing circle `{x, y, r}` in body px, or per form. The default renders idle and frames the top 60% of the opaque pixels — fine for clouds and slimes, but a hand-framed portrait is better. `portrait.animated = true` redraws at 10 fps in the HUD.
- `palettes[n]` is used for the n-th duplicate pick; keep the silhouette and change the hues.
- Resources get HUD bars/pips/rings automatically (`resources.<name>.hud`); `art.hud(ctx, rect, info)` adds a custom widget.

## A10. The Lab, art-check and the contact sheet

The Lab shows every state, every pool move (throws, taunt, cancel-only and `else` moves included),
every form, entity gallery, resource/var sliders, status toggles, the phase bar and a perf meter.
Automatic checks (`&checks=1`, or `npm run art-check -- <id>`):

| check | warns when |
|---|---|
| hitbox coverage | an active hitbox has < 15% opaque coverage ("floating in empty space") |
| hurtbox fit | > 45% of the silhouette is outside the hurtboxes, or > 30% of the hurtbox area is transparent |
| bounds overflow | opaque pixels touch the canvas edge |
| contrast | the silhouette's luminance is too close to the stage palette |
| perf | `draw` averages > 2 ms (informational in headless runs) |

`npm run art-check -- <id> --sheet` (or `npm run contact-sheet -- <id>`) writes
`.cache/contact-sheets/<id>.png`: idle, run, jump, fall, hurt, shield, every move at its strike
frame, every form, every entity and the portrait. **Read it, critique it against A11, fix, repeat
(at least two passes).**

## A11. The quality bar

- [ ] 2–3 value tiers per material, plus a rim light from `info.light`.
- [ ] Outline 2.5–3.5 u in a dark hue from the palette (never pure black).
- [ ] Idle is never static; secondary motion through springs/chains/`info.cache`.
- [ ] Anticipation in startup, smear/impact in active, follow-through in recovery — all from `phase`.
- [ ] On active frames the striking part is **inside** the real hitbox shapes.
- [ ] fx for hit, land, KO and every custom event; sounds mapped.
- [ ] A readable silhouette at 0.5× (`&half=1`, `&sil=1`) against the sunset stage (cool saturated colors and clean whites pop; warm-on-warm needs a dark or cool accent).
- [ ] Every state, form and entity looks right in the Lab; a hand-framed portrait; alternate palettes.
- [ ] `draw` stays cheap: no per-frame canvases or `getImageData`, cache paths, `info.rng`/`kit.seeded` instead of `Math.random`.
- [ ] Zero Lab warnings, or each one explained to the user.

---

# Part B — the humanoid puppet

How a v2 `art` object resolves (`resolveArtDef` in `client/render/art-host.js`): a `draw` function → yours, used as is; no `draw` but `sheets` + `clips` → the first clip set is drawn automatically; no `draw` and `rig: 'none'` → auto-art from your hurtbox shapes (shaded, rim-lit placeholders); anything else → **the humanoid puppet**. The explicit way to get the puppet is the `humanoid(spec)` helper, which turns the puppet fields below into a complete ArtDef (Part A fields such as `fx`, `sounds`, `entities`, `forms`, `assets`, `drawBack`/`drawWorld` and `portrait` pass through):

```js
import { humanoid, defaultHead } from '../../shared/art/puppet.js';
export default humanoid({
  palette: { skin: '#f1c7a5', hair: '#3a2a4a', primary: '#2f6fd1', secondary: '#f2f2f2', accent: '#ffcc33', outline: '#1a1430', effect: '#7fd3ff' },
  hair: { style: 'spiky' }, weapon: { type: 'sword', length: 62 },
  head(ctx, info) { defaultHead(ctx, info, { hair: { style: 'spiky' } }); /* + a scar, a mask… */ },   // hooks: §6
  fx: { onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 10, shape: 'spark' }); } },
});
```

Everything in Part A still applies (fx, sounds, entities, portraits, the Lab, the quality bar); this part covers the puppet-specific fields. ember and bastion use it with hooks; volt and mirelle use the rig from a custom `draw`.

### Part B contents

1. [Three levels of control](#1-three-levels-of-control)
2. [How the puppet rig works](#2-how-the-puppet-rig-works)
3. [Palette](#3-palette)
4. [Build multipliers](#4-build-multipliers)
5. [Hair, face, headgear, weapon, chains](#5-hair-face-headgear-weapon-chains)
6. [Drawing hooks](#6-drawing-hooks)
7. [The `info` object](#7-the-info-object)
8. [Full custom drawing: `art.draw`](#8-full-custom-drawing-artdraw)
9. [Custom projectiles: `art.projectile`](#9-custom-projectiles-artprojectile)
10. [Pose overrides: `art.pose`](#10-pose-overrides-artpose)
11. [Custom move poses](#custom-move-poses)
12. [Built-in animations](#12-built-in-animations)
13. [Effects and colors](#13-effects-and-colors)
14. [Kit helpers](#14-kit-helpers)
15. [Art quality checklist](#15-art-quality-checklist)

---

## 1. Three levels of control

| Level | You write | Good for |
|---|---|---|
| **Configure** | `palette`, `build`, `hair`, `face`, `headgear`, `weapon`, `chains` | A polished humanoid in minutes |
| **Override parts** | Hooks: `head`, `torso`, `arm`, `hand`, `leg`, `foot`, `back`, `front` (plus a weapon function) | Armor, masks, tails, wings, glowing runes, keeping the auto-animation |
| **Draw everything** | `art.draw(ctx, info)` | Robots, blobs, animals, anything non-humanoid. You still get the animated rig to drive it. |

Mix freely. For example, *Ember* uses the default puppet plus custom hooks, *Bastion* adds a hammer weapon and a cape chain, *Mirelle* carries a staff, and *Volt* is a fully custom `art.draw` robot. Look at their `characters/<id>/character.js` files for inspiration.

## 2. How the puppet rig works

Every frame the engine picks a **pose** (joint angles) for the fighter's current state: idle breathing, run cycle, jump, attack windup and strike, hitstun, and so on. It then builds a **rig** (joint positions in pixels) from that pose and draws the parts in this order:

```
chains (layer 'back')
── body transform: squash (sx, sy) and spin applied around the body center ──
  art.back
  back arm  (darker)
  back leg  (darker)
  torso
  front leg
  head      (skull, face, hair, headgear)
  weapon    (held in the front hand)
  front arm
  art.front
── end body transform ──
chains (layer 'front')
```

If you define `art.draw`, everything between the body-transform lines is replaced by your function (chains still draw).

**Rig space** (what most hooks draw in):
- Origin `(0, 0)` = **between the feet, on the ground**.
- **+x = the way the fighter faces.** The canvas is already mirrored for left-facing fighters, so always draw facing right. (Mirrored text reads backwards, so avoid text.)
- **+y = down.** The top of the head is about `y = -H`.
- `u = H / 100` is the **rig unit**: 1% of the fighter's `stats.height`. Size everything in `u` so it scales with the hurtbox.

Default proportions at `build` = 1: legs 40u (thigh 20 + shin 20), torso 25u, head radius 14u, upper arm 15u, forearm 14u. Altogether about 100u = `H` tall, so the drawing matches the hurtbox.

**Rendering budget:** each fighter is drawn into an offscreen canvas about `3.4 × H` square, with the feet 68% of the way down. Anything farther than about **1.7 H** to either side, **2.3 H** above the feet, or **1.1 H** below them is clipped. The renderer adds a player-color rim glow, a white hit flash, a charge flash and intangibility flicker on top of your art. You don't need to draw those.

## 3. Palette

```js
palette: {
  skin: '#f1c3a0', primary: '#4a7bd6', secondary: '#2a2f45', accent: '#f2c14e',
  hair: '#2b1d16', eyes: '#2a6bd1', boots: '#1d1a24', gloves: null, outline: '#16121e',
  effect: '#7fd3ff', effect2: '#ffffff',
  // optional part overrides (a palette key OR a color):
  sleeves: 'primary', forearms: 'skin', pants: 'secondary',
}
```

| Key | Default | Used for |
|---|---|---|
| `skin` | `#f1c3a0` | Head, default forearms and hands |
| `primary` | `#4a7bd6` | Torso, upper arms (sleeves), default chain color |
| `secondary` | `#2a2f45` | Legs (pants), belt |
| `accent` | `#f2c14e` | Belt buckle, default headgear, sword guard |
| `hair` | `#2b1d16` | Hair, eyebrows |
| `eyes` | `#2a6bd1` | Iris |
| `boots` | `#1d1a24` | Default feet |
| `gloves` | `null` (= skin) | Hands |
| `outline` | `#16121e` | Every outline. Keep it very dark. |
| `effect` | `#7fd3ff` | **Overrides hit-spark colors for all your moves**, the default trail color, the projectile color, the staff gem |
| `effect2` | `#ffffff` | Free for your own hooks |
| `sleeves`, `forearms`, `pants` | primary / skin / secondary | Optional: a palette key name or a color |

You can add any extra keys you want (`palette.glow`, `palette.armor`, …) and read them in your hooks via `info.palette` or `info.color('glow')`.

## 4. Build multipliers

```js
build: { head: 1, torso: 1, arms: 1, legs: 1, thickness: 1, shoulders: 1, hips: 1 }
```

| Key | Effect |
|---|---|
| `head` | Head radius |
| `torso` | Torso length |
| `arms` | Upper arm and forearm length |
| `legs` | Thigh and shin length |
| `thickness` | Limb, hand and foot thickness |
| `shoulders` | Shoulder width (also torso top width) |
| `hips` | Hip width (also torso bottom width) |

Build changes only the drawing, **not** the hurtbox. If `head`, `torso` or `legs` go well above or below 1, the drawn height drifts from `stats.height`. Re-balance them (e.g. `legs: 1.15, torso: 0.85`) and check in the Art Lab with **hitboxes** on that the yellow hurtbox still hugs the body.

## 5. Hair, face, headgear, weapon, chains

```js
hair:     { style: 'spiky', color: '#ff5a2a' },   // spiky | short (default) | long | bun | mohawk | none
face:     { eyeColor: '#ffcc00', eyeHeight: 0.24, browColor: '#3a1a10', blush: false },
headgear: { type: 'horns', color: '#e8e0d0' },    // band | horns | crown | helmet  (color defaults to accent)
weapon:   { type: 'sword', length: 62, color: '#d8e2f0', glow: '#7fd3ff' },
chains:   [{ anchor: 'neck', length: 70, segments: 8, width: 30, endWidth: 18, color: '#8a1c2c', layer: 'back' }],
```

**Weapon** (drawn in the front hand, along the forearm):

| Field | Default | Notes |
|---|---|---|
| `type` | — | `sword`, `staff`, `hammer`, `spear` |
| `length` | 60 | In rig units (% of height) |
| `color` | `#d8e2f0` | Blade / hammer head / spear tip |
| `glow` | none | Color of a glow shown while attacking |
| `angle` | 0 | Extra rotation (radians) relative to the forearm |
| `grip`, `guard` | brown, accent | Sword handle and crossguard |
| `shaft` | brown | Staff / hammer / spear shaft |
| `gem` | `palette.effect` | Staff orb |

Instead of an object, `weapon` can be a **function** `(ctx, info) => {}`. It's drawn with the origin at the hand and **+x pointing along the forearm, away from the elbow**. Draw your weapon extending along +x. Weapon attacks get a swoosh trail at the weapon tip, using `length`.

**Chains** are physics ribbons: capes, scarves, tails, ponytails, headband tails.

| Field | Default | Notes |
|---|---|---|
| `anchor` | `'neck'` | `neck`, `head`, `hip`, `back` |
| `length` | 60 | Rig units |
| `segments` | 7 | More = smoother (keep ≤ 12) |
| `width`, `endWidth` | 16, 4 | Rig units, root → tip |
| `color`, `color2` | primary, darker | Root → tip gradient |
| `layer` | `'back'` | `'back'` (behind body) or `'front'` |
| `stiffness` | 0.35 | How strongly it trails behind you |
| `gravity` | 1 | Negative = floats up (flames, spirit wisps) |

## 6. Drawing hooks

All hooks are optional. A hook **replaces** that part's default drawing. Each hook receives `(ctx, info)`; limb hooks also get the joint positions.

| Hook | Signature | Coordinate space |
|---|---|---|
| `art.back` | `(ctx, info)` | Rig space, drawn **behind** everything (wings, jetpacks, auras, back of a cloak) |
| `art.torso` | `(ctx, info)` | Rig space. Use `rig.hip`, `rig.chest`, `rig.lean`, `rig.torsoLen` |
| `art.head` | `(ctx, info)` | Origin = **head center**, rotated with the head; radius `rig.headR`; face toward +x |
| `art.arm` | `(ctx, arm, info)` | Rig space. `arm = { shoulder, elbow, hand, angle }`. Replaces the **whole arm including the hand** |
| `art.hand` | `(ctx, info)` | Origin = hand; **+y points down the forearm** (elbow is at −y); +x = palm/front at rest |
| `art.leg` | `(ctx, leg, info)` | Rig space. `leg = { hip, knee, foot, angle }`. Replaces the **whole leg including the foot** |
| `art.foot` | `(ctx, info)` | Origin = ankle; shin comes in from −y; **toe points +x**; ground is about `+4u` |
| `art.front` | `(ctx, info)` | Rig space, drawn **on top** of everything (chest emblems over the arm, visors, sparks) |
| `art.weapon` | `(ctx, info)` (if a function) | Origin = front hand, +x along the forearm |

Arms, hands, legs and feet are called **twice**, once for the back limb and once for the front. `info.back` is `true` for the back one. Use `info.color('primary', info.back)` to get it automatically darkened (−22%) for depth.

You can reuse the defaults inside your hooks:

```js
import { defaultHead, drawFace } from '../../shared/art/puppet.js';
// …
head(ctx, info) {
  defaultHead(ctx, info, { hair: { style: 'none' } });          // normal head, no hair
  const r = info.rig.headR;
  info.kit.circle(ctx, r * 0.5, -r * 0.1, r * 0.35, '#222', { outline: info.palette.outline }); // eyepatch
},
```

### Example: armored arm with a glowing gauntlet

```js
arm(ctx, a, info) {
  const { kit, u, palette } = info;
  const t = info.rig.build.thickness;
  kit.limb(ctx, a.shoulder, a.elbow, 6.5 * u * t, 5.5 * u * t, info.color('primary', info.back), { outline: palette.outline, gloss: 0.3 });
  kit.limb(ctx, a.elbow, a.hand, 5.5 * u * t, 6.5 * u * t, info.color('accent', info.back), { outline: palette.outline, gloss: 0.4 });
  if (!info.back && info.state === 'attack') kit.glow(ctx, a.hand.x, a.hand.y, 18 * u, palette.effect, 0.6);
  kit.circle(ctx, a.hand.x, a.hand.y, 7 * u * t, info.color('accent', info.back), { outline: palette.outline, gloss: 0.5 });
},
```

### Example: tail on the back layer that wags while idle

```js
back(ctx, info) {
  const { kit, rig, u, time, palette } = info;
  const wag = info.state === 'idle' ? Math.sin(time * 0.12) * 6 * u : 0;
  const base = { x: rig.hip.x - 6 * u, y: rig.hip.y - 2 * u };
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - 3 * u);
  ctx.quadraticCurveTo(base.x - 22 * u, base.y + 4 * u, base.x - 30 * u + wag, base.y - 18 * u);
  ctx.quadraticCurveTo(base.x - 18 * u, base.y + 8 * u, base.x, base.y + 3 * u);
  ctx.closePath();
  kit.fillShaded(ctx, kit.shade(palette.hair, -0.1), { outline: palette.outline, x: base.x - 15 * u, y: base.y, r: 20 * u });
},
```

## 7. The `info` object

| Field | Description |
|---|---|
| `kit` | The art kit (section 14), same as `import * as kit from '../../shared/art/kit.js'` |
| `palette` | Your palette merged over the defaults |
| `color(key, back?)` | `palette[key]` (or `key` itself if it's a color), darkened 22% when `back` is true |
| `rig` | Joint positions (below) |
| `pose` | The current pose (joint angles, see [custom move poses](#custom-move-poses)) |
| `H`, `W` | `stats.height`, `stats.width` (px) |
| `u` | Rig unit = `H / 100` |
| `time` | Render frame counter (~60 per second). **Animate with this.** |
| `state` | `idle run jumpsquat land crouch air shield roll spotdodge airdodge hitstun helpless shieldbreak respawn attack` |
| `view` | Raw fighter view: `state, stateFrame, grounded, vx, vy, facing, move, moveFrame, charging, tumble, index, x, y` (`move` is the balanced move, with `move.slot`, `move.startup`, `move.duration`, `move.hitboxes`…) |
| `expression` | `normal`, `blink`, `fierce` (attacking/charging), `hurt` (hitstun), `dizzy` (shield break), `worried` (helpless) |
| `back` | `true` while drawing the back arm/leg/hand/foot |
| `cache` | Per-fighter object kept between frames. The renderer and chains also store data here, so **namespace your keys** (`info.cache.myChar ||= {}`) |
| `character` | The balanced character (`stats`, `moves`, `name`…) |

**`rig` fields:** `u, H, headR, footR, torsoLen, build, hip, chest, neck, headC, headAngle, lean, up, fwd, armF, armB, legF, legB`. Points are `{x, y}`. `up`/`fwd` are unit vectors along the torso. `armF`/`armB` are `{ shoulder, elbow, hand, angle }` and `legF`/`legB` are `{ hip, knee, foot, angle }` (F = front, B = back).

Useful timing: during an attack, `view.moveFrame < view.move.startup` is the **windup**, and frames from `startup` to the last hitbox `end` are **active**.

## 8. Full custom drawing: `art.draw`

`art.draw(ctx, info)` replaces the whole body (back hook, limbs, torso, head, weapon, front hook). You draw in rig space (feet at the origin, facing +x, about `H` tall) and can still use the animated `info.rig` to move your parts. Squash, stretch and spin are already applied for you.

```js
art: {
  palette: { primary: '#3a4a5e', accent: '#ffd23a', effect: '#5ad8ff', outline: '#10131c' },
  draw(ctx, info) {
    const { kit, rig, u, time, palette, view } = info;
    // Hover body that follows the rig's hip/chest so it squashes, leans and flips with the animations.
    const bob = Math.sin(time * 0.1) * 2 * u;
    const c = { x: rig.chest.x, y: rig.chest.y + 6 * u + bob };
    kit.glow(ctx, c.x, -2 * u, 26 * u, palette.effect, 0.25);                  // thruster glow on the floor
    kit.roundRectPath(ctx, c.x - 20 * u, c.y - 18 * u, 40 * u, 40 * u, 8 * u);
    kit.fillShaded(ctx, palette.primary, { outline: palette.outline, x: c.x, y: c.y, r: 30 * u, gloss: 0.35 });
    // Arms follow the rig's arm joints (so attack animations still read)
    for (const [arm, back] of [[rig.armB, true], [rig.armF, false]]) {
      kit.limb(ctx, arm.shoulder, arm.hand, 4 * u, 6 * u, info.color('accent', back), { outline: palette.outline });
    }
    // Visor, with an expression
    const eye = info.expression === 'hurt' ? '#ff4d5e' : palette.effect;
    kit.roundRectPath(ctx, rig.headC.x - 4 * u, rig.headC.y - 4 * u, 16 * u, 7 * u, 3 * u);
    ctx.fillStyle = eye; ctx.fill();
    kit.glow(ctx, rig.headC.x + 4 * u, rig.headC.y, 12 * u, eye, 0.5);
  },
},
```

Tips:
- Keep the drawing roughly inside the `W × H` hurtbox so hits look fair.
- Drive parts from `rig.armF.hand`, `rig.legF.foot`, `rig.headC`… so every built-in animation (and your custom poses) still reads as the right move.
- The **character-select portrait** frames where the puppet's head would be (`rig.headC` at idle, time 0). Put your "face" near there.

## 9. Custom projectiles: `art.projectile`

```js
projectile(ctx, p) {
  // origin = projectile center, +x = direction of travel (already mirrored)
  const { kit, t, r, palette } = p;
  kit.glow(ctx, 0, 0, r * 2.4, palette.effect, 0.55);
  kit.starPath(ctx, 0, 0, 6, r * 1.2, r * 0.5, t * 0.2);
  ctx.fillStyle = '#fff'; ctx.fill();
},
```

`p` contains: `x, y, vx, vy, r, life, maxLife, style, color, color2, spin, effect, owner, charId, id`, plus `t` (render time), `kit`, `palette` and `colors` (the 3 effect colors). Use `p.style` to draw different projectiles for different moves (`style` can be any string up to 24 chars, e.g. `'bubble'`, `'feather'`), and `1 - p.life / p.maxLife` for age-based animation. If your function throws, the built-in style is drawn instead.

## 10. Pose overrides: `art.pose`

`art.pose(pose, view)` runs every frame after the engine computes a pose. Return an object of joint values to override (or nothing). `view` has `state, stateFrame, grounded, vx, vy, move, moveFrame, charging, tumble, facing, time`.

```js
pose(pose, view) {
  if (view.state === 'idle') return { fU: 2.6, fL: 0.4, head: Math.sin(view.time * 0.05) * 0.08 }; // hand on hip / raised staff
  if (view.state === 'run') return { lean: pose.lean + 0.15 };                                      // lean harder into the run
  if (view.move?.slot === 'neutralSpecial' && view.charging) return { sy: 0.95 };
},
```

Great for signature idles, a hovering character (`by: -6` always), a stiff robot (zero out `lean`), or a four-legged creature reading the rig differently.

<a id="custom-move-poses"></a>
## 11. Custom move poses

Any move can define its own animation instead of a built-in `anim`:

```js
fair: {
  name: 'Crescent Slash', duration: 32, effect: 'slash', landingLag: 9,
  pose: {
    windup: { lean: -0.3, fU: 3.0, fL: 0.4, bU: -0.8, flU: 0.6, flL: -1.2, blU: -0.4, blL: -1.0 },
    strike: { lean: 0.35, fU: 0.6, fL: 0.0, bU: -1.2, flU: 0.9, flL: -0.6, blU: -0.6, blL: -0.8 },
    spinTurns: 0,          // whole-body flips during the active frames (−4..4)
    limb: 'frontHand',     // swoosh trail source: frontHand | frontFoot | backFoot | head | body
  },
  hitboxes: [{ start: 8, end: 11, x: 46, y: -58, r: 26, damage: 11, angle: 40, knockback: 24, growth: 92 }],
},
```

**Timing:** during startup the body eases from neutral (or the falling pose in the air) into `windup`. Over the 3 frames after `startup` it snaps to `strike` and holds through the last active frame, then eases back to neutral by `duration`.

**Joints** (radians unless noted; any key you omit uses the NEUTRAL value; values are for a fighter facing right):

| Key | NEUTRAL | Meaning |
|---|---|---|
| `lean` | 0.06 | Torso tilt, + = forward |
| `head` | 0 | Head tilt relative to the torso |
| `spin` | 0 | Whole-body rotation |
| `bx`, `by` | 0, 0 | Body offset in rig units (+x forward, +y down: crouch) |
| `sx`, `sy` | 1, 1 | Squash and stretch |
| `fU`, `fL` | 0.25, 0.55 | **Front arm**: upper arm (relative to torso: 0 = down, π/2 = forward, π = up), forearm (relative to upper arm; + bends the elbow forward) |
| `bU`, `bL` | −0.2, 0.5 | **Back arm**, same convention |
| `flU`, `flL` | 0.14, −0.12 | **Front leg**: thigh (relative to vertical: 0 = down, + = forward), shin (relative to thigh; − bends the knee back) |
| `blU`, `blL` | −0.12, −0.08 | **Back leg**, same convention |

Workflow: open the Art Lab, freeze at the active frame (`&frame=<startup+2>`), tick **hitboxes**, and tweak until the striking limb sits inside the red circle.

## 12. Built-in animations

Set `anim: '<name>'` on a move. **Limb** is where the swoosh trail comes from.

| Name | Limb | Default for | Description |
|---|---|---|---|
| `jab` | frontHand | jab | Quick straight punch |
| `punch` | frontHand | side | Committed straight |
| `heavyPunch` | frontHand | sideSmash | Big wind-up lunge punch |
| `uppercut` | frontHand | up | Rising uppercut |
| `upSmash` | frontHand | upSmash | Crouch then both arms overhead |
| `sweep` | frontFoot | down | Low leg sweep |
| `splits` | frontFoot | downSmash | Splits kick both ways |
| `kick` | frontFoot | — | Standing front kick |
| `slash` | frontHand | — | High-to-low weapon swing |
| `overhead` | frontHand | — | Two-handed overhead smash |
| `thrust` | frontHand | — | Lunging stab |
| `headbutt` | head | — | Head-first lunge |
| `spin` | body (1 turn) | nair | Spinning limbs-out |
| `airKick` | frontFoot | fair | Flying kick |
| `backKick` | backFoot | bair | Mule kick behind |
| `flipKick` | frontFoot (−1 turn) | uair | Bicycle flip |
| `stomp` | frontFoot | dair | Downward stomp |
| `cast` | frontHand | neutralSpecial | Two-hand push / spell |
| `dash` | frontHand | sideSpecial | Low forward rush |
| `rise` | frontHand | upSpecial | Arms-up rising leap |
| `slam` | frontHand | downSpecial | Overhead ground slam |
| `guard` | body | — | Braced block / counter stance |
| `drill` | frontFoot (2 turns) | — | Arms-up spinning drill |

Movement states (idle, run, jump/fall, crouch, shield, roll, hitstun, helpless, …) are animated automatically. Customize them with `art.pose`.

## 13. Effects and colors

`effect` on a move picks hit sparks, swoosh trail colors, projectile defaults and hit sounds. Each has three colors (core, mid, outer):

| Effect | Colors |
|---|---|
| `punch` (default) | `#ffffff` `#ffe08a` `#ff9a3a` |
| `kick` | `#ffffff` `#ffd27a` `#ff7a3a` |
| `slash` | `#ffffff` `#bfe8ff` `#5aa8ff` |
| `fire` | `#fff3b0` `#ff8a2a` `#d6281c` |
| `ice` | `#ffffff` `#a8f2ff` `#4aa0ff` |
| `electric` | `#ffffff` `#fff36b` `#5ad8ff` |
| `magic` | `#ffe8ff` `#d48aff` `#7b5cff` |
| `water` | `#effcff` `#6ad0ff` `#2a7bd6` |
| `wind` | `#ffffff` `#d0fff2` `#7ae0c8` |
| `dark` | `#e6ccff` `#8a3ad8` `#2a0a4a` |
| `light` | `#ffffff` `#fff6c8` `#ffd36b` |
| `poison` | `#f0ffc0` `#9ae05a` `#7a3ab8` |
| `earth` | `#fff0d0` `#c89a60` `#6a4a30` |
| `none` | `#ffffff` `#e0e0e0` `#a0a0a0` |

Overrides: `move.color` recolors that move's trail. `palette.effect`, if set, recolors **all** your hit sparks and is the fallback trail and projectile color. Projectile `color`/`color2` recolor that projectile. If you want per-move effect colors on hit, leave `palette.effect` unset and use the `effect` names.

Sounds vary by effect too: `electric`, `fire`, and `ice`/`magic`/`light` have extra layers.

## 14. Kit helpers

`info.kit`, or `import * as kit from '../../shared/art/kit.js'`:

| Helper | What it does |
|---|---|
| `shade(color, amt)` | Lighten (`amt` > 0) or darken (< 0), −1..1 |
| `mix(c1, c2, t)` | Blend two colors |
| `rgba(color, alpha)` | Color with alpha, as a string |
| `parse(color)`, `toHex({r,g,b})` | Color conversion |
| `capsulePath(ctx, x1, y1, x2, y2, r1, r2)` | Tapered capsule path (limbs, horns, blades) |
| `roundRectPath(ctx, x, y, w, h, r)` | Rounded rectangle path |
| `polygonPath(ctx, [[x,y], …])` | Polygon path |
| `blobPath(ctx, [[x,y], …], tension)` | Smooth closed curve through points (hair, capes, organic shapes) |
| `starPath(ctx, x, y, points, r1, r2, rot)` | Star / spiky burst |
| `fillShaded(ctx, color, { outline, lineWidth, x, y, r, light, dark, gloss })` | **Fill the current path with a lit gradient plus outline.** The workhorse. |
| `limb(ctx, a, b, r1, r2, color, opts)` | Shaded capsule between two joints |
| `circle(ctx, x, y, r, color, opts)` | Shaded circle |
| `glow(ctx, x, y, r, color, alpha)` | Soft radial glow |
| `rimLight(ctx, [[x,y], …], color, width, alpha)` | Thin highlight stroke along an edge |
| `seeded(seed)` | Deterministic random generator `() => 0..1` (stable sparkles and patterns) |
| `lerp`, `clamp`, `TAU` | Math |

From `../../shared/art/puppet.js`: `defaultHead(ctx, info, art)`, `drawFace(ctx, info, r, face)`, `drawWeapon(ctx, arm, info, weaponSpec)`, `DEFAULT_PALETTE`.

## 15. Art quality checklist (puppet specifics; see also A11)

The bar is "looks like it belongs in a real game". Before you call it done:

- [ ] **Outlines** on every shape (`palette.outline`, about 3 px). Very dark, slightly tinted (purple-black reads well on this stage). Nothing should float without a contour.
- [ ] **Shading:** use `fillShaded` (light from upper-front) and add `gloss` on metal, gems and hair. Add **rim light** (`kit.rimLight`) on the top or back edges of hair and armor.
- [ ] **Depth:** back limbs darker (`info.color(key, info.back)`), front details on top.
- [ ] **Palette harmony with the stage.** *Sky Sanctum* is a sunset: indigo-to-magenta sky, peach and orange horizon, warm cream stone with gold trim. Saturated **cool** colors (teal, cyan, royal blue, violet) and clean whites pop against it. Warm-on-warm (orange/tan) can blend into the background, so add a strong dark or cool accent if you go warm. Pick 1 main color, 1–2 supporting colors, 1 accent, and stick to them.
- [ ] **Readable silhouette** at about **130 px tall** (normal zoom). Zoom out in your head: can you tell who it is from the shape alone? Exaggerate one feature (huge hair, horns, a cape, an oversized weapon).
- [ ] **Expressions:** custom heads should react to `info.expression` (at least `hurt` and `fierce`), and blink.
- [ ] **Alive at idle:** use `info.time` for breathing glows, flickering flames, floating particles, swaying accessories. Chains handle capes and tails for free.
- [ ] **Moves read:** the striking limb or weapon is inside the red hitbox circle on active frames (Art Lab, hitboxes on, ¼×). Signature moves get custom `pose`s.
- [ ] **Every state looks right** in the Art Lab: idle, run, jump, fall, crouch, shield, hitstun, tumble, helpless, shield break, roll, air dodge, and all 16 moves, at full speed and ¼×.
- [ ] **Portrait** (character select) looks good: the head area at idle, `time = 0`.
- [ ] **Performance:** this runs 60 times a second for up to 4 fighters. No loops over hundreds of shapes per frame, no `getImageData`/`putImageData`, no creating canvases every frame (cache them in `info.cache`). Avoid feeding a *continuously changing* color into `kit.shade`/`mix`/`rgba` every frame, because the kit caches every color string it parses. Vary `ctx.globalAlpha` instead. Use `kit.seeded()` for deterministic randomness instead of `Math.random()` flicker.
- [ ] **No errors:** if your art throws, the fighter is drawn as a magenta box. Check the browser console.
- [ ] **Stay in bounds:** about ±1.7 H horizontally, 2.3 H above the feet, 1.1 H below.
