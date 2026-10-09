# Character Cookbook

Concrete recipes for turning *any* description into a kit. Each recipe maps a concept onto
engine primitives, gives a **validated snippet** (`node scripts/gen-docs.js --check` loads every
`recipe=` block with 0 errors and 0 W-notes), and lists the art plan and the traps.

How to use a recipe: copy the parts you need into your `characters/<id>/character.js`, rename
everything, then fill in the rest of the 16 triggers (missing ones fall back to a generic move
with an I002 note). The field reference is [CHARACTER_GUIDE.md](CHARACTER_GUIDE.md); the art
contract is [ART_GUIDE.md](ART_GUIDE.md). Three full roster examples are worth reading first:

| example | shows |
|---|---|
| `characters/nimbus` | storm cloud: hover, lingering + burst zones, a held beam, wind, a custom status, scripted hits |
| `characters/gertie` | grandma on a scooter: sprites + procedural, grab and throws, armor, heal, bounce, root trap |
| `characters/gloop` | slime: 3 forms, body scale, crawl, absorb, counter, a mimic clone, a slot function |

General rules that every recipe follows:

- **The concept is the silhouette.** Hurtboxes are your body (circles, capsules, rects, ≤ 6 per set). Smaller bodies cost stat points; huge ones refund them.
- **Damage only comes from data:** hitboxes, entity hitboxes, `release`, and named `hitboxes` templates (the only thing `api.hit` accepts).
- **Resources and vars are free.** They create no power by themselves; everything they unlock is governed. Use them for any meter, ammo, mood, size, mana, beat or timer.
- **Don't fight the Governor.** If `npm run validate -- <id> --audit` or training shows gov events in normal play, retune.

---

## 1. Storm cloud (zoner that floats)

**Primitives:** multi-circle body, `hover`, a custom `soaked` status, a lingering `zone` that rains,
a burst `zone` for lightning, a `beam`, wind (`kind: 'wind'`), a script that targets soaked foes.

```js recipe=storm-cloud
archetype: 'zoner',
body: {
  collider: { w: 72, h: 64 },
  hurtboxes: {
    default: [{ shape: 'circle', x: 0, y: -40, r: 30 }, { shape: 'circle', x: -30, y: -32, r: 20 }, { shape: 'circle', x: 30, y: -34, r: 22 }],
  },
},
stats: { weight: 82, airSpeed: 5.6, airJumps: 2, gravity: 0.5, fallSpeed: 8 },
movement: { hover: { button: 'jump', frames: 110, fallSpeed: 1.2, drift: 1.15 } },
statuses: { soaked: { frames: 240, mods: { speed: 0.9 }, visual: 'drip', tint: '#4aa3ff' } },
hitboxes: {
  drizzle: { damage: 1, angle: 80, knockback: 4, growth: 0, effect: 'water', status: 'soaked' },
  bolt: { damage: 8, angle: 75, knockback: 30, growth: 74, effect: 'electric' },
  gust: { kind: 'wind', push: 5 },
},
entities: {
  raincloud: {
    kind: 'zone', shape: { shape: 'rect', x: 0, y: 0, w: 120, h: 40 }, life: 300, maxAlive: 1,
    motion: { type: 'stationary' }, collide: 'pass',
    hitboxes: [{ shape: 'rect', x: 0, y: 110, w: 110, h: 200, use: 'drizzle', rehit: 30 }],
  },
  strike: {
    kind: 'zone', shape: { shape: 'rect', x: 0, y: -160, w: 30, h: 320 }, life: 18,
    motion: { type: 'stationary', snapToGround: true },
    hitboxes: [{ start: 8, end: 11, shape: 'rect', x: 0, y: -160, w: 40, h: 320, use: 'bolt' }],
  },
},
moves: {
  neutralSpecial: {
    name: 'Call Lightning', duration: 38,
    update(view, api) {
      if (view.me.move.frame !== 14) return;
      const foe = view.nearestEnemy();
      const dx = foe && Math.abs(foe.x - view.me.x) < 420 ? (foe.x - view.me.x) * view.me.facing : 160;
      api.spawn('strike', { x: dx });
      api.emit('thunder', { x: view.me.x + dx * view.me.facing });
    },
  },
  sideSpecial: { name: 'Gust Front', duration: 32,
    hitboxes: [{ start: 6, end: 18, shape: 'rect', x: 84, y: -40, w: 120, h: 46, use: 'gust' }] },
  downSpecial: { name: 'Seed the Clouds', duration: 36, timeline: [{ at: 14, spawn: 'raincloud', x: 100, y: -150 }] },
},
```

**Art:** `rig: 'none'`, `kit.cloudPuffs` in 2–3 value tiers, `kit.rain` under the raincloud
entity, `kit.lightning` (seeded with `info.rng`) in the `strike` entity's `draw`, a grumpy face that
squints in `hitstun`. Rain particles via `fx.local.drip`.
**Traps:** hover is charged to the stall budget (240 frames per airtime), so a cloud cannot float
forever. `status` from a hitbox is applied through the Governor (≤ 4 statuses per target).

## 2. Bee swarm (size = health of the swarm)

**Primitives:** a `bees` resource that *is* the swarm size (`onHurt` drains it), `setBodyScale`
driven by it, homing `minion` bees (`maxAlive` and the entity budget clamp floods), the
`swarm` art helper.

```js recipe=bee-swarm
archetype: 'summoner',
body: {
  collider: { w: 70, h: 70 },
  hurtboxes: { default: [{ shape: 'circle', x: 0, y: -38, r: 34 }] },
  scaleRange: [0.7, 1.2],
},
stats: { weight: 76, runSpeed: 5.6, airSpeed: 4.8, jumpHeight: 13, doubleJumpHeight: 12, airJumps: 1, gravity: 0.55, fallSpeed: 9 },
movement: { fly: { button: 'jump', fuel: 70, thrust: 0.5, maxRise: 3 } },
resources: {
  bees: { max: 60, start: 60, regen: 0.05, onHurt: { perDamage: -1.2 }, hud: { style: 'pips', label: 'Bees', color: '#ffd23a' } },
},
hitboxes: { sting: { damage: 2, angle: 60, knockback: 8, growth: 20, effect: 'poison', status: 'poison' } },
entities: {
  bee: {
    kind: 'minion', shape: { shape: 'circle', r: 6 }, life: 180, hp: 1, maxAlive: 6,
    motion: { type: 'homing', speed: 5, turn: 0.1, delay: 10, wobble: 0.3, target: 'nearestEnemy' }, collide: 'pass',
    hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 8, use: 'sting', rehit: 30 }],
  },
},
moves: {
  neutralSpecial: { name: 'Release the Bees', duration: 34, cost: { bees: 10 }, else: 'buzz',
    timeline: [{ at: 12, spawn: 'bee', x: 30, y: -40, count: 3, spread: 20, aimAt: 'nearestEnemy' }] },
  buzz: { name: 'Angry Buzz', category: 'special', duration: 28, timeline: [{ at: 6, emit: 'buzz' }] },
},
behavior: {
  tick(view, api) { api.setBodyScale(0.7 + 0.5 * (view.res.bees / 60)); },
},
```

**Art:** `swarm.create({count: 40})` in `init`, `swarm.step` toward `info.hurtboxes` (or toward
`info.hitboxes` on active frames so the bees *pour into* the hitbox), `swarm.draw` with stripes and
wings. Draw fewer agents as `v.resources.bees` drops.
**Traps:** asking for 60 bees is fine; the entity budget keeps ≤ 8 alive, ≤ 10 threat and
≤ 4 spawns per 60 frames. Use `view.budget().entities` in scripts to predict refusals.

## 3. Grandma on a scooter (sprite heavy, grappler)

**Primitives:** a wide rect + circle body, passive `body.armor`, grab + 4 throws with `release`,
a bouncing `projectile` (dentures), a `trap` that roots (knitting), a self `heal` from a tea
move, sprites for the body plus procedural overlays. Full version: `characters/gertie`.

```js recipe=grandma-scooter
archetype: 'grappler',
body: {
  collider: { w: 80, h: 90 },
  hurtboxes: { default: [{ shape: 'rect', x: 0, y: -26, w: 80, h: 52 }, { shape: 'circle', x: -6, y: -70, r: 22 }] },
  armor: { threshold: 2 },
},
stats: { weight: 118, runSpeed: 7, airSpeed: 3.6, jumpHeight: 13, airJumps: 1, gravity: 0.78, fallSpeed: 12.5 },
hitboxes: { yarn: { damage: 2, angle: 90, knockback: 0, growth: 0, setKnockback: 10, status: 'root' } },
entities: {
  dentures: {
    kind: 'projectile', shape: { shape: 'circle', r: 10 }, life: 120, maxAlive: 1,
    motion: { type: 'ballistic', gravity: 0.4 }, collide: 'bounce', maxBounces: 3,
    hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 12, damage: 6, angle: 50, knockback: 20, growth: 40 }],
  },
  knitting: {
    kind: 'trap', shape: { shape: 'rect', x: 0, y: -6, w: 50, h: 12 }, life: 360, hp: 4, maxAlive: 1,
    motion: { type: 'stationary', snapToGround: true },
    hitboxes: [{ shape: 'rect', x: 0, y: -8, w: 50, h: 16, use: 'yarn', rehit: 60 }],
  },
},
moves: {
  neutralSpecial: { name: 'Denture Toss', duration: 32, timeline: [{ at: 11, spawn: 'dentures', x: 30, y: -60, vx: 7, vy: -6 }] },
  downSpecial: { name: 'Tea Break', duration: 60, requires: { grounded: true },
    update(view, api) { if (view.me.move.frame % 30 === 29) api.heal(1); } },
  sideSpecial: { name: 'Leave Knitting', duration: 30, timeline: [{ at: 10, spawn: 'knitting', x: 40, y: 0 }] },
  grab: { name: 'Handbag Snag', duration: 30, throw: { holdAt: { x: 46, y: -40 } },
    hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 50, y: -44, w: 46, h: 54 }] },
  pummel: { name: 'Cheek Pinch', duration: 16, timeline: [{ at: 5, release: { damage: 2, angle: 0, knockback: 0, growth: 0, setKnockback: 0 } }] },
  fthrow: { name: 'Shoo', duration: 28, timeline: [{ at: 10, release: { damage: 8, angle: 40, knockback: 50, growth: 66 } }] },
  bthrow: { name: 'Reverse Gear', duration: 32, timeline: [{ at: 16, release: { damage: 9, angle: 140, knockback: 52, growth: 68 } }] },
  uthrow: { name: 'Hip Check', duration: 30, timeline: [{ at: 12, release: { damage: 7, angle: 90, knockback: 50, growth: 70 } }] },
  dthrow: { name: 'Parking Job', duration: 32, timeline: [{ at: 14, release: { damage: 6, angle: 75, knockback: 56, growth: 30 } }] },
},
ai: { grapple: true },
```

**Art:** a painted sprite sheet for grandma + scooter (`sheets`/`clips`, ≥ 2× display size, a
`sync: 'move'` clip for each big move), procedural overlays for the exhaust puff and the swinging
handbag (`fx.local.smoke` at the tailpipe), spinning dentures entity.
**Traps:** heal is a mitigation budget (≤ 1 per 30 frames, ≤ 45 per stock), so tea is a
comeback tool, not immortality. Armor is flinch-only: grandma still takes the damage.

## 4. Shapeshifting slime (forms)

**Primitives:** `forms` with their own `body`, `stats`, `movement` and `slots`; a form-cycling
move using `api.form`; `crawl`; an `absorb` hitbox with `onAbsorb`; a `counter`. Full version:
`characters/gloop`.

```js recipe=slime-forms
archetype: 'trickster',
body: {
  collider: { w: 64, h: 70 },
  hurtboxes: { default: [{ shape: 'circle', x: 0, y: -33, r: 33 }, { shape: 'circle', x: 0, y: -58, r: 21 }] },
},
forms: {
  puddle: {
    stats: { weight: 76, runSpeed: 7.6 },
    body: { collider: { w: 88, h: 32 }, hurtboxes: { default: [{ shape: 'capsule', x1: -32, y1: -16, x2: 32, y2: -16, r: 16 }] } },
    movement: { crawl: { frames: 100, speed: 5.5 } },
    slots: { jab: 'splash' },
  },
},
resources: { mass: { max: 100, start: 60, hud: { style: 'pips', label: 'Mass' } } },
hitboxes: { eat: { kind: 'absorb' } },
moves: {
  downSpecial: { name: 'Morph', duration: 26, timeline: [{ at: 9, emit: 'morph' }],
    update(view, api) { if (view.me.move.frame === 10) api.form(view.me.form === 'base' ? 'puddle' : 'base'); } },
  neutralSpecial: { name: 'Engulf', duration: 34,
    hitboxes: [{ start: 6, end: 20, x: 32, y: -36, r: 36, use: 'eat' }],
    onAbsorb: [{ resource: { name: 'mass', add: 15 } }, { emit: 'gulp' }] },
  splash: { name: 'Splash', category: 'jab', duration: 14,
    hitboxes: [{ start: 2, end: 4, shape: 'rect', x: 32, y: -12, w: 50, h: 20, damage: 2.5, angle: 70, knockback: 10, growth: 18 }] },
  bristle: { name: 'Bristle', category: 'counter', duration: 40, counter: { from: 4, to: 20, then: 'bristleHit', mul: 1.2 } },
  bristleHit: { name: 'Bristle!', category: 'counter', duration: 30,
    hitboxes: [{ start: 2, end: 5, x: 0, y: -42, r: 40, damage: 8, angle: 40, knockback: 30, growth: 80, counterScale: true }] },
},
slots: { sideSpecial: 'bristle' },
behavior: { onKO(view, api) { api.form('base'); } },
```

**Art:** the `blob` helper: a spring soft body that follows `info.hurtboxes`, so every form change
and every hitbox stretch is animated for free. Branch on `v.form` (or use `art.forms`) for eyes and
details. Give each form its own `bounds` if it is much wider/taller.
**Traps:** each form is priced separately against the 52-point stat budget and 112 move budget.
Form changes have a 45-frame cooldown and 6 frames of transition hitlag.

## 5. Hamster-piloted mech (forms + soak plating + eject)

**Primitives:** `mech` and `pilot` forms; a `plating` resource with `soak` (budgeted mitigation)
only in mech form; a `tick` hook that ejects to `pilot` when plating is gone; a turret
`minion` with a `think` script; a breakable `part` (relay 0.5) as a shield arm.

```js recipe=hamster-mech
archetype: 'heavy',
body: {
  collider: { w: 76, h: 110 },
  hurtboxes: { default: [{ shape: 'rect', x: 0, y: -60, w: 70, h: 80 }, { shape: 'rect', x: 0, y: -12, w: 50, h: 24 }] },
},
stats: { weight: 124, runSpeed: 5.2, airSpeed: 3.6, jumpHeight: 13, gravity: 0.8, fallSpeed: 13 },
resources: {
  plating: { max: 60, start: 60, soak: { fraction: 0.4, costPerDamage: 1, forms: ['base'] }, resetOnRespawn: true,
             hud: { style: 'bar', label: 'Plating', color: '#9fb4c8', forms: ['base'] } },
},
forms: {
  pilot: {
    stats: { weight: 72, runSpeed: 6.8, airSpeed: 4.4, jumpHeight: 14, doubleJumpHeight: 13, airJumps: 1, gravity: 0.6, fallSpeed: 10 },
    body: { collider: { w: 46, h: 46 }, hurtboxes: { default: [{ shape: 'circle', x: 0, y: -23, r: 23 }] } },
    slots: { neutralSpecial: 'rebuild' },
  },
},
hitboxes: { bolt: { damage: 3, angle: 30, knockback: 10, growth: 20, effect: 'electric' } },
entities: {
  turret: {
    kind: 'minion', shape: { shape: 'rect', x: 0, y: -14, w: 28, h: 28 }, life: 600, hp: 8, maxAlive: 1,
    motion: { type: 'stationary', snapToGround: true },
    every: { frames: 60, spawn: 'pellet', x: 10, y: -20, aim: 'nearestEnemy' },
  },
  pellet: {
    kind: 'projectile', shape: { shape: 'circle', r: 5 }, life: 60,
    motion: { type: 'linear', speed: 9 }, hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 7, use: 'bolt' }],
  },
  shieldArm: {
    kind: 'part', shape: { shape: 'rect', x: 40, y: -60, w: 14, h: 60 }, life: 600, hp: 20, relay: 0.5,
    motion: { type: 'attached' }, anchor: { x: 0, y: 0 },
  },
},
moves: {
  neutralSpecial: { name: 'Deploy Turret', duration: 40, timeline: [{ at: 16, spawn: 'turret', x: 50, y: 0 }] },
  downSpecial: { name: 'Raise Shield', duration: 30, timeline: [{ at: 8, spawn: 'shieldArm' }] },
  rebuild: { name: 'Rebuild', category: 'special', duration: 100, requires: { grounded: true },
    timeline: [{ at: 80, form: 'base' }, { at: 80, resource: { name: 'plating', set: 30 } }] },
  grab: { name: 'Claw', duration: 30, hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 40, y: -30, w: 40, h: 50 }] },
},
behavior: {
  tick(view, api) { if (view.me.form === 'base' && view.res.plating <= 0) { api.form('pilot'); api.emit('eject'); } },
},
```

**Art:** the `mech` helper (`mech.ik2` legs, `mech.plate` with rivets and `info.light`,
`mech.thruster` on jumps), a hamster in a glass cockpit drawn procedurally, sparks via
`fx.burst({shape: 'spark'})` on `onHurt` when plating is low; `art.forms.pilot` draws just the
hamster. Plating bar shows only in mech form (`hud.forms`).
**Traps:** soak is capped by the mitigation budget (≤ 45 per stock, ≤ 50% of one hit, ≤ 20 per
300 frames). A relay-0.5 part must have hp ≤ 25 and life ≤ 900, and its prevented damage also
comes out of that budget.

## 6. Dragon (huge body, glide, fire beam)

**Primitives:** a big collider and hurtbox (area above 5600 px² *refunds* stat points), `glide`,
wing `part`s at relay 1 (extra hurtbox, no protection), a fire `beam` (≤ 520 long), `burn`.

```js recipe=dragon
archetype: 'heavy',
body: {
  collider: { w: 140, h: 110 },
  hurtboxes: {
    default: [{ shape: 'capsule', x1: -50, y1: -50, x2: 40, y2: -60, r: 34 }, { shape: 'circle', x: 62, y: -88, r: 24 }],
  },
},
stats: { weight: 128, runSpeed: 6.5, airSpeed: 4.6, jumpHeight: 14, airJumps: 2, gravity: 0.7, fallSpeed: 12 },
movement: { glide: { button: 'jump', frames: 120, fallSpeed: 1.6, speed: 1.15 } },
hitboxes: { flame: { damage: 2, angle: 40, knockback: 8, growth: 10, effect: 'fire', status: 'burn' } },
entities: {
  fireBreath: {
    kind: 'beam', shape: { shape: 'capsule', x1: 0, y1: 0, x2: 360, y2: 0, r: 12 }, life: 60,
    motion: { type: 'attached' }, anchor: { x: 80, y: -88 }, length: 360, width: 12,
    hitboxes: [{ shape: 'capsule', x1: 0, y1: 0, x2: 360, y2: 0, r: 12, use: 'flame', rehit: 10 }],
  },
  wing: {
    kind: 'part', shape: { shape: 'capsule', x1: -10, y1: -90, x2: -70, y2: -130, r: 14 }, life: Infinity, relay: 1,
    motion: { type: 'attached' },
  },
},
moves: {
  neutralSpecial: { name: 'Fire Breath', duration: 70, hold: { button: 'special', from: 20, to: 40, max: 60 },
    timeline: [{ at: 18, spawn: 'fireBreath', bindToMove: true }, { at: 18, camera: { shake: 2 } }] },
},
behavior: { init(view, api) { api.spawn('wing'); } },
```

**Art:** `serpent` for the neck and tail, `wing.draw` (membrane, far wing first with
`back: true`), `quadruped.pose` for the legs when grounded; set big `bounds` (≤ 4 × collider per
axis); `kit.beam` plus flame particles in the beam entity's `draw`. Check the 0.5× silhouette.
**Traps:** big bodies are easy to hit; that is the trade the refund pays for. Relay-1 parts are
*more* body, never armor.

## 7. Living painting (paint resource, painted traps, reflect frame)

**Primitives:** `rig: 'none'` art, a `paint` resource that regenerates while grounded, traps painted on
the floor that `slow`, a `reflect` frame, a frame decal drawn in `drawWorld`, an image asset as a
texture.

```js recipe=living-painting
archetype: 'trickster',
body: {
  collider: { w: 64, h: 96 },
  hurtboxes: { default: [{ shape: 'rect', x: 0, y: -48, w: 60, h: 90 }] },
},
resources: { paint: { max: 100, start: 100, regen: 0.3, regenWhen: 'grounded', hud: { style: 'ring', label: 'Paint', color: '#e85a9a' } } },
hitboxes: {
  smear: { damage: 2, angle: 70, knockback: 10, growth: 10, status: 'slow', effect: 'paint' },
  frame: { kind: 'reflect' },
},
entities: {
  puddle: {
    kind: 'trap', shape: { shape: 'rect', x: 0, y: -3, w: 70, h: 6 }, life: 480, maxAlive: 2,
    motion: { type: 'stationary', snapToGround: true },
    hitboxes: [{ shape: 'rect', x: 0, y: -6, w: 70, h: 12, use: 'smear', rehit: 60 }],
  },
},
moves: {
  downSpecial: { name: 'Wet Paint', duration: 30, cost: { paint: 30 }, requires: { grounded: true },
    timeline: [{ at: 10, spawn: 'puddle', x: 60, y: 0 }] },
  sideSpecial: { name: 'Frame Up', duration: 34,
    hitboxes: [{ start: 6, end: 16, shape: 'rect', x: 44, y: -48, w: 20, h: 96, use: 'frame' }] },
},
```

**Art:** `assets: { canvas: './canvas.png' }` as a `createPattern` texture (handle
`info.assets.canvas === null`), brush strokes as `kit.smear`, a gilded frame drawn in `drawWorld`
during Frame Up, `fx.decal` paint splats on hit. The `effect: 'paint'` name is open vocabulary:
unknown effects fall back to the move color, then `palette.effect`.
**Traps:** reflected projectiles get ×1.25 damage once, keep their tier, and are speed-capped.

## 8. Growing giant (scaleRange)

**Primitives:** `body.scaleRange` up to 1.6 (area is priced at the *minimum* scale), a `size` var
that grows on hits and shrinks on KO, `setBodyScale` (≤ 0.02 per frame).

```js recipe=growing-giant
archetype: 'heavy',
body: {
  collider: { w: 50, h: 80 },
  hurtboxes: { default: [{ shape: 'capsule', x1: 0, y1: -18, x2: 0, y2: -62, r: 24 }] },
  scaleRange: [0.8, 1.6],
},
stats: { weight: 106, runSpeed: 5.4, gravity: 0.75, fallSpeed: 12 },
vars: { size: 0.8 },
sync: ['size'],
behavior: {
  init(view, api) { api.vars.set('size', 0.8); },
  onHit(view, api, ev) { api.vars.set('size', Math.min(1.6, view.vars.size + ev.granted * 0.01)); },
  tick(view, api) { if (Math.abs(view.me.bodyScale - view.vars.size) > 0.01) api.setBodyScale(view.vars.size); },
  onKO(view, api) { api.vars.set('size', 0.8); },
},
```

**Art:** the host does **not** scale `draw` by `bodyScale` — start `draw` with
`ctx.scale(v.bodyScale, v.bodyScale)` (or build from `info.hurtboxes`, which are already scaled),
and scale sprites and particle sizes yourself. Declare `bounds` at scale 1: the host multiplies them
by `bodyScale`. Add ground shake via `fx.shake` on landing when big.
**Traps:** growth makes the hurtbox bigger too: that is the fairness. The collider is pushed out
of the ground on growth.

## 9. Clone-splitter (mimic clone)

**Primitives:** a `clone` entity with `motion: {type: 'mimic', delay}`: it replays the owner's
inputs `delay` frames later with the owner's moves (×0.5 damage, ×0.7 knockback, hp instead of
percent, ≤ 1 alive).

```js recipe=clone-splitter
archetype: 'trickster',
resources: { focus: { max: 100, start: 100, regen: 0.15, hud: { style: 'bar', label: 'Focus' } } },
entities: {
  echo: { kind: 'clone', shape: { shape: 'circle', x: 0, y: -40, r: 24 }, life: 480, hp: 15, maxAlive: 1,
          motion: { type: 'mimic', delay: 30 }, scale: 0.9 },
},
moves: {
  downSpecial: { name: 'Split', duration: 36, cost: { focus: 50 }, else: 'fizzle',
    timeline: [{ at: 14, spawn: 'echo', x: -30, y: 0 }, { at: 14, emit: 'split' }] },
  fizzle: { name: 'Fizzle', category: 'special', duration: 26 },
},
```

**Art:** `info.drawSelf(ctx, e.view, {alpha: 0.6, tint: '#7fd3ff'})` in the clone entity's
`draw` paints the owner's own art at the clone's state, so the echo animates for free; add an
afterimage trail (`fx.afterimage`).
**Traps:** clones cannot grab, spawn clones, change form or run behavior hooks; their move
`update` scripts run and spend the *owner's* budgets.

## 10. Chess army (walker minions you command)

**Primitives:** `walker` minions with `maxAlive: 3`, `api.command(id, {moveTo})` to march them,
promotion via `api.despawn` + `api.spawn` at the same spot, the threat budget (minions cost 2).

```js recipe=chess-army
archetype: 'summoner',
hitboxes: { poke: { damage: 4, angle: 50, knockback: 14, growth: 30 } },
entities: {
  pawn: {
    kind: 'minion', shape: { shape: 'rect', x: 0, y: -16, w: 20, h: 32 }, life: 900, hp: 6, maxAlive: 3,
    motion: { type: 'walker', speed: 1.5 }, collide: 'walk',
    hitboxes: [{ shape: 'rect', x: 14, y: -16, w: 16, h: 20, use: 'poke', rehit: 40 }],
  },
  queen: {
    kind: 'minion', shape: { shape: 'rect', x: 0, y: -24, w: 24, h: 48 }, life: 600, hp: 12, maxAlive: 1,
    motion: { type: 'walker', speed: 3 }, collide: 'walk',
    hitboxes: [{ shape: 'circle', x: 0, y: -24, r: 30, damage: 6, angle: 60, knockback: 20, growth: 40, rehit: 30 }],
  },
},
moves: {
  neutralSpecial: { name: 'Pawn Forward', duration: 30, timeline: [{ at: 10, spawn: 'pawn', x: 40, y: 0 }] },
  sideSpecial: { name: 'Advance', duration: 28,
    update(view, api) {
      if (view.me.move.frame !== 6) return;
      const foe = view.nearestEnemy();
      for (const p of view.entities('pawn')) api.command(p.id, { moveTo: { x: foe ? foe.x : p.x + 200 * view.me.facing, y: p.y } });
    } },
  downSpecial: { name: 'Promote', duration: 40,
    update(view, api) {
      if (view.me.move.frame !== 12) return;
      const p = view.entities('pawn')[0];
      if (p) { api.despawn(p.id); api.spawn('queen', { worldX: p.x, worldY: p.y }); api.emit('promote', { x: p.x }); }
    } },
},
```

**Art:** draw each piece in its entity `draw` (carved wood: `kit.fillShaded` with gloss, a dark
outline from the palette), a king body for the fighter itself, tiny marching bob from `e.age`.
**Traps:** `maxAlive` per template plus ≤ 8 alive and ≤ 10 threat per owner: three pawns (6) +
a queen (2) fit, a fourth pawn expires the oldest one.

## 11. Ghost (intangibility, phasing, floaty)

**Primitives:** an `intangible` window on a phase move (≤ 12 frames per action), a shrink-to-
nothing hurtbox set (`hurtboxes` window; frames under 1600 px² are charged to the 45-per-300
intangibility budget), the `float` status on self, `hover`, a `confuse` touch.

```js recipe=ghost
archetype: 'trickster',
body: {
  collider: { w: 52, h: 84 },
  hurtboxes: {
    default: [{ shape: 'capsule', x1: 0, y1: -24, x2: 0, y2: -60, r: 26 }],
    wisp: [{ shape: 'circle', x: 0, y: -40, r: 16 }],
  },
},
stats: { weight: 78, airSpeed: 5.4, gravity: 0.5, fallSpeed: 8 },
movement: { hover: { frames: 90, fallSpeed: 1.2 } },
hitboxes: { spook: { damage: 5, angle: 60, knockback: 18, growth: 40, effect: 'dark', status: 'confuse' } },
moves: {
  downSpecial: { name: 'Fade', duration: 40, intangible: [4, 14], hurtboxes: [{ from: 4, to: 24, set: 'wisp' }],
    timeline: [{ at: 4, emit: 'fade' }] },
  sideSpecial: { name: 'Haunt', duration: 36, velocity: [{ start: 6, end: 18, vx: 9 }],
    hitboxes: [{ start: 8, end: 18, x: 30, y: -40, r: 26, use: 'spook' }] },
  neutralSpecial: { name: 'Lighten', duration: 30, timeline: [{ at: 8, status: 'float' }] },
},
```

**Art:** `blob` with low stiffness for a drifting sheet, `ctx.globalAlpha` drop while
`v.state === 'attack'` and `phase.name === 'active'` on Fade, a cracked flicker when a gov
`intangible` event fires (the host already flickers; add your own `fx.onEvent` sparkle).
**Traps:** denied intangibility is reported as `{type: 'gov', rule: 'intangible'}` and the hit
lands. Design the ghost so it is fun *within* 45 frames per 5 seconds.

## 12. Vehicle (a monster truck with momentum)

**Primitives:** a wide, low body; `velocity` windows with `mode: 'add'` for acceleration; a
`hold` rev-up that loops while the button is held; `cancels` into a jump (ramp); `armor` during
the charge; `oncePerAirtime` on the boost.

```js recipe=vehicle
archetype: 'rushdown',
body: {
  collider: { w: 110, h: 60 },
  hurtboxes: { default: [{ shape: 'rect', x: 0, y: -32, w: 110, h: 44 }, { shape: 'circle', x: -36, y: -12, r: 12 }, { shape: 'circle', x: 36, y: -12, r: 12 }] },
},
stats: { weight: 120, runSpeed: 8.2, airSpeed: 3.4, jumpHeight: 13, gravity: 0.82, fallSpeed: 13.5 },
moves: {
  sideSpecial: { name: 'Burnout', duration: 60, oncePerAirtime: true,
    hold: { button: 'special', from: 6, to: 12, max: 60 },
    velocity: [{ start: 14, end: 30, vx: 1.2, mode: 'add' }],
    armor: [{ from: 14, to: 30, threshold: 6 }],
    cancels: [{ from: 20, to: 40, into: ['jump'], onHit: false }],
    hitboxes: [{ start: 14, end: 30, shape: 'rect', x: 50, y: -30, w: 30, h: 50, damage: 9, angle: 40, knockback: 26, growth: 60 }],
    timeline: [{ at: 6, sfx: 'roar' }, { from: 14, to: 30, every: 4, emit: 'exhaust' }] },
},
```

**Art:** `rig: 'none'`; wheels rotate by distance travelled (accumulate `v.vx * info.dt` in
`info.cache`), suspension squash from `info.motion.squash`, `kit.speedLines` while
`Math.abs(v.vx) > 6`, exhaust via `fx.local.smoke`, tire marks with `fx.decal`.
**Traps:** total horizontal travel per move ≤ 340 px (W302); the Governor caps self speed at
|vx| ≤ 18.

## 13. Plant / turret builder

**Primitives:** a `seed` trap that grows into a turret via `every` (periodic spawns aimed at the
nearest enemy), a `vine` minion with `orbit` motion around the owner, a `sun` resource that the
builder spends.

```js recipe=plant-builder
archetype: 'summoner',
resources: { sun: { max: 100, start: 50, regen: 0.12, hud: { style: 'bar', label: 'Sun', color: '#ffe066' } } },
hitboxes: { thorn: { damage: 3, angle: 35, knockback: 10, growth: 25, effect: 'earth' } },
entities: {
  sprout: {
    kind: 'trap', shape: { shape: 'circle', x: 0, y: -14, r: 14 }, life: 600, hp: 6, maxAlive: 2,
    motion: { type: 'stationary', snapToGround: true },
    every: { frames: 75, spawn: 'seedShot', x: 0, y: -24, aim: 'nearestEnemy' },
  },
  seedShot: {
    kind: 'projectile', shape: { shape: 'circle', r: 5 }, life: 70,
    motion: { type: 'linear', speed: 8 }, hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 7, use: 'thorn' }],
  },
  vine: {
    kind: 'minion', shape: { shape: 'circle', r: 10 }, life: 300, maxAlive: 1,
    motion: { type: 'orbit', radius: 60, speed: 0.08, around: 'owner' }, collide: 'pass',
    hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 12, use: 'thorn', rehit: 30 }],
  },
},
moves: {
  downSpecial: { name: 'Plant', duration: 34, cost: { sun: 40 }, requires: { grounded: true }, else: 'wilt',
    timeline: [{ at: 12, spawn: 'sprout', x: 50, y: 0 }] },
  wilt: { name: 'Wilt', category: 'special', duration: 26 },
  neutralSpecial: { name: 'Overgrowth', duration: 30, cost: { sun: 25 }, timeline: [{ at: 10, spawn: 'vine' }] },
},
```

**Art:** `tentacle` for vines (reach toward the hitbox with `target`), a growth animation from
`e.age` in the sprout's `draw`, falling leaves via `fx.local.debris` while running.
**Traps:** traps + zones ≤ 3 per owner; entities with hp ≤ 3; a destroyed hp-entity template has a
300-frame cooldown.

## 14. Musician (rhythm resource)

**Primitives:** a `groove` resource that decays, a beat derived from `view.frame` (deterministic,
identical for everyone), moves that add groove when started on the beat, and a slot function
that swaps the smash for a finisher at full groove.

```js recipe=musician
archetype: 'allrounder',
resources: { groove: { max: 100, start: 0, decay: 0.08, hud: { style: 'pips', label: 'Groove', color: '#c07aff' } } },
vars: { beatStreak: 0 },
moves: {
  jab: { name: 'Downbeat', duration: 16,
    hitboxes: [{ start: 3, end: 5, x: 36, y: -50, r: 18, damage: 3, angle: 45, knockback: 12, growth: 25, effect: 'magic' }],
    update(view, api) {
      if (view.me.move.frame !== 0) return;
      const onBeat = view.frame % 30 < 6;
      api.vars.set('beatStreak', onBeat ? view.vars.beatStreak + 1 : 0);
      if (onBeat) { api.res.add('groove', 10); api.emit('onBeat'); }
    } },
  encore: { name: 'Encore', category: 'smash', duration: 50, cost: { groove: 100 },
    hitboxes: [{ start: 15, end: 19, x: 0, y: -48, r: 46, damage: 18, angle: 45, knockback: 22, growth: 75, effect: 'magic' }],
    timeline: [{ at: 15, camera: { shake: 5 } }, { at: 15, emit: 'encore' }] },
},
slots: { sideSmash: (view) => (view.res.groove >= 100 ? 'encore' : 'sideSmash') },
```

**Art:** a metronome pulse in `drawBack` synced to `info.simFrame % 30`, notes as `fx.text`
glyphs on `onBeat`, the HUD widget `art.hud` showing the beat. `sounds: {onBeat: 'chime'}`.
**Traps:** never use `Date.now()` or `performance.now()` for timing (lint E020; the guard throws).
`view.frame` is the clock.

## 15. Time mage (rewind via vars + teleport)

**Primitives:** a `tick` hook that records a position every 60 frames into number vars, a move
whose `update` teleports back toward it (≤ 200 px, once per airtime), a `slow` field (zone) and a
`hold` to "stop time" that is really a long, budgeted stall.

```js recipe=time-mage
archetype: 'zoner',
vars: { markX: 0, markY: 0, markSet: false },
sync: ['markX', 'markY', 'markSet'],          // send them to the art (the ghost at the mark)
hitboxes: { chrono: { damage: 2, angle: 60, knockback: 6, growth: 10, effect: 'magic', status: 'slow' } },
entities: {
  timeField: {
    kind: 'zone', shape: { shape: 'circle', r: 70 }, life: 240, maxAlive: 1,
    motion: { type: 'stationary' }, collide: 'pass',
    hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 70, use: 'chrono', rehit: 40 }],
  },
},
moves: {
  downSpecial: { name: 'Rewind', duration: 36, timeline: [{ at: 6, emit: 'rewind' }],
    update(view, api) {
      if (view.me.move.frame !== 8 || !view.vars.markSet) return;
      api.teleport((view.vars.markX - view.me.x) * view.me.facing, view.vars.markY - view.me.y);
    } },
  neutralSpecial: { name: 'Time Field', duration: 34, timeline: [{ at: 12, spawn: 'timeField', x: 120, y: -40 }] },
},
behavior: {
  tick(view, api) {
    if (view.frame % 60 !== 0) return;
    api.vars.set('markX', view.me.x); api.vars.set('markY', view.me.y); api.vars.set('markSet', true);
  },
  onRespawn(view, api) { api.vars.set('markSet', false); },
},
```

**Art:** a ghost silhouette at the mark (`drawWorld` with `info.drawIdle` at alpha 0.3, reading
the synced vars), clock-hand `kit.smear` arcs, a desaturating `fx.flash` on rewind.
**Traps:** a teleport is relative (`dx` is along facing) and clamped to 200 px; it can't push you
into the stage. "Rewinding damage" would be healing: `api.heal` is ≤ 1 per 30 frames and comes out
of the 45-per-stock mitigation budget, so make rewind about position, not percent.

---

## Mapping table: "my character can…" → primitive

| it can… | use |
|---|---|
| float / glide / fly / climb walls / crawl on ceilings | `movement.hover` / `glide` / `fly` / `wallCling` / `crawl` |
| change shape, stance or vehicle | `forms` (own body, stats, movement, slots) + `api.form` or a `form` timeline entry |
| grow / shrink | `body.scaleRange` + `api.setBodyScale` |
| have ammo, mana, heat, mood, size, combo meter | `resources` (+ `cost`, `requires`, `else`, `onHit`/`onHurt` perDamage) |
| shoot / throw / drop / summon / build | `entities` (`projectile`, `minion`, `trap`, `zone`, `beam`, `clone`, `part`) + `spawn` |
| reflect / eat projectiles / blow wind | hit `kind: 'reflect'` / `'absorb'` (+ `onAbsorb`) / `'wind'` (`push`) |
| grab, hold and throw | `grab` move with a `kind: 'grab'` box, `pummel`, `fthrow`…`dthrow` with `release` |
| counter | `counter: {from, to, then}` + `counterScale` hitboxes |
| shrug off hits | `armor` windows / `body.armor` (flinch-only), `soak` resources |
| poison / stun / slow / mark | built-in statuses, or custom `statuses` from capped `mods` |
| make a move depend on state | `requires`, `else`, a slot function, `endIf`, `cancels`, `update` scripts |
| react to events | `behavior` hooks (`onHit`, `onHurt`, `onLand`, `onKO`, …) |
| show a meter | `resources[].hud` (bar / pips / ring), or `art.hud` |
| be slow, lumbering or heavy (slower than the stat minimum) | keep `runSpeed`/`airSpeed` at the minimum and `api.modify('heavy', { speed: 0.6 })` in `behavior.init` (runs on each respawn; `speed` ×0.6–1.25) |
| spawn from a turret / minion | `api.spawn` in its `think` starts at the entity (offsets mirror by the owner's facing; `facing`, `angle`, `target: 'nearestEnemy'`), or an `every` timer |
