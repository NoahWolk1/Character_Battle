# CLAUDE.md

Character Battle is a Smash-style 2D platform fighter: a Node/Express/Socket.IO server plus a vanilla ES-module canvas client, with **no build step**. Friends add their own fighters as `characters/<id>/`. Characters can be **literally anything** (clouds, swarms, mechs, dragons, slimes, a chess army…): Character System v2 gives maximal creative freedom, a static **auto-balancer** scales every kit into fair limits, and a runtime **Governor** guarantees nobody can be one-shot or become unkillable, whatever the character's code does.

There are two kinds of sessions. Figure out which one you're in:

- **(A) A friend creating or modifying their character.** This is the common case. Follow section A strictly.
- **(B) The repo owner (NoahWolk1) working on the engine.** Only when the user explicitly says they're working on the engine, stages, balance rules, server or client. See section B.

If unsure, assume **A** and ask which character id is theirs.

---

## A. Creating or modifying a character

### Hard rules
1. **Only create or edit files inside `characters/<their-id>/`.** Never edit `shared/`, `server/`, `client/`, `scripts/`, `docs/`, `test/`, `.github/`, `package.json`, `render.yaml`, `characters/_template/`, or **anyone else's character folder**. CI fails a PR that touches anything else.
2. **Never work around the balancer or the Governor.** If `npm run validate -- <id> --explain` shows W-notes, retune the design; don't fight the limits.
3. If the character truly needs an engine feature, **don't implement it**. Tell the user what to ask the repo owner for, and design around it (the COOKBOOK mapping table lists a primitive for almost everything).
4. Code rules (`npm run lint`, E020): imports only from the character's own folder, `../../shared/art/**` and `../../shared/char/api.js`. No network, timers, globals, `process`, `fs`, `eval`, `import()`, prototype edits, module-level `let`/`var`, or top-level side effects. Sim code (`update`, `think`, `behavior.*`, slot functions, `ai.hint`) must be deterministic: `view.rng()`, never `Math.random`/`Date`/`performance`, and no module state.
5. Gameplay is data plus sandboxed scripts that go through the `api` (CHARACTER_GUIDE §16). Art lives in `art.js` and never affects gameplay.
6. **Done means:** 0 E-notes, **0 W-notes** (or each one explained to the user), 0 Lab warnings, `npm test` green, and you have **opened and looked at the contact-sheet PNG yourself** (Read `.cache/contact-sheets/<id>.png`) after your last art change. Never claim art is finished without looking at it.
7. Don't invent API: every field, call and limit is in the generated tables of `docs/CHARACTER_GUIDE.md` / `docs/ART_GUIDE.md`. Unknown keys are ignored (I001), so a typo silently does nothing — read the I-notes too.

### Description → Kit procedure
1. **Pitch:** a one-line silhouette, 3 adjectives, one signature mechanic, one weakness.
2. **Map the concept to primitives** with `docs/COOKBOOK.md` (storm cloud, swarm, grandma, slime, mech + pilot, dragon, living painting, giant, clone-splitter, chess army, ghost, vehicle, turret builder, musician, time mage, and a "my character can…" → primitive table). Read `characters/nimbus`, `characters/gertie` and `characters/gloop` — full v2 roster examples.
3. **Write the kit table:** the 16 triggers (`jab side up down sideSmash upSmash downSmash nair fair bair uair dair neutralSpecial sideSpecial upSpecial downSpecial`) plus `grab pummel fthrow bthrow uthrow dthrow taunt` and any extra pool moves: slot, name, purpose, primitive, rough frame data. Give it 1–2 KO moves, combo starters, a safe poke and a real recovery.
4. **Scaffold** (new characters only): `npm run new-character -- <id> "Display Name"` (id: lowercase letters/digits/dashes, 2–24 chars, starts with a letter, equals the folder name). Then write `character.js` with `defineCharacter` (`docs/CHARACTER_GUIDE.md` has every field; the generated tables are exact).
5. **Validate:** `npm run validate -- <id> --explain --json` and iterate until the notes are empty, or explain each remaining one to the user. Keep the design intent: trade startup, endlag, reach or KO power instead of lowering everything.
6. **Art plan:** one line per state and per move (anticipation → impact → follow-through), then write `art.js` (`docs/ART_GUIDE.md` Part A; humanoids may use the puppet, Part B). **Art quality must be exceptional**: value tiers, rim light from `info.light`, tinted outlines, a living idle, secondary motion, fx and sounds for every event, the striking part inside the real hitbox on active frames.
7. **Lab and contact sheet:** `npm run art-check -- <id> --sheet`, then **read `.cache/contact-sheets/<id>.png`**, critique it against ART_GUIDE A11, fix every Lab warning, and do at least two passes.
8. **Test:** `npm test` must pass.
9. **Play:** the user runs `npm run dev` and opens `http://localhost:3000/?train=<id>&cpu=hard` to fight a hard CPU (plain `?train=<id>` = a standing dummy; `&vs=<other-id>` picks the opponent) (H hitboxes · R reset · **Y slow-mo** · **T taunt**). If gov events fire in normal play, retune instead of leaning on the Governor. Art Lab: `http://localhost:3000/lab.html?char=<id>&boxes=1`.
10. **Ship:** commit only `characters/<id>/`, push a branch and open a PR.

### Quick facts (details in the guides)
- 60 fps; frames and pixels. Body-local coords: origin at the feet, +x forward, y < 0 up. Angles: 0 forward, 90 up, 180 back, 270 spike.
- Bodies are any shapes (circles, capsules, rects); small bodies cost stat points, big ones refund them. Stat budget 52 per form.
- Moves are a pool routed by `slots` (strings or slot functions); forms remap slots. Hitboxes in the same `group` hit once per move.
- Scripts deal damage only through named `hitboxes` templates. Resources and vars are free; everything they unlock is governed.
- Keyboard: move WASD/arrows · jump Space · attack J · special K · smash I · shield L/Shift · grab = shield + attack · taunt T.

---

## B. Working on the engine (repo owner)

### Architecture map
```
shared/                     runs on BOTH server (Node) and browser (served at /shared); no build step
  constants.js              universal rules: physics, shield, dodges, stale moves, smash charge, buttons
  char/                     api.js (defineCharacter), schema.js (field tables), normalize-v1/v2, ir.js, generics, suggest
  balance/rules.js          static limits (single source of truth)   governor-rules.js  runtime caps
  balance/validate.js + v2/ static auto-scaling → frozen IR + coded notes + report
  sim/                      game.js (step order), fighter, states (closed state enum), input-map, actions, hits, combat,
                            hurtbox, shapes, entities, movement, physics, status, resources, ko-table, rng, guard (sim realm guard),
                            script-api (sandboxed hooks + fault policy), governor, snapshot, ai.js (CPU; ai-v1.js frozen for goldens)
  stages/index.js           stage registry (getStage, STAGE_IDS)
  art/                      kit.js, sprite.js, puppet.js, anims.js, helpers/{blob,swarm,serpent,tentacle,wing,quadruped,mech}.js
server/                     index.js, characters.js (+ catalog-worker), rooms.js + room-worker.js (one worker per room, watchdog), dev-routes.js (Lab endpoints)
client/                     main.js, match.js, input.js, characters.js, assets.js, audio.js, render/{renderer,art-host,particles,effects,hud}.js, lab.html + lab.js + lab/, ui/showcase.js
scripts/                    validate, lint-characters, check-assets, fuzz, audit, migrate, gen-docs, art-check, contact-sheet, golden-test, sim-smoke-test, new-character
test/                       golden, char, validate, governor, sim/actions/entities/…, ai, art/fx/lab, integration, server, tooling, cheaters (§10.2), archetypes (§10.3)
docs/                       CHARACTER_GUIDE.md, ART_GUIDE.md, COOKBOOK.md (tables generated by scripts/gen-docs.js), design/CHARACTER_SYSTEM_V2.md (the spec)
```

### Principles
- **Limits live in one place:** static limits in `shared/balance/rules.js`, runtime caps in `shared/balance/governor-rules.js`, universal rules in `shared/constants.js`, field tables in `shared/char/schema.js`. After changing any of them run `npm run docs` (regenerates the doc tables; `npm test` runs `docs:check`).
- **The sim only reads the validated IR.** Never read a raw character module in `shared/sim/`.
- `shared/` stays isomorphic (no Node-only or DOM-only APIs) and the sim deterministic (`game.rng` / `view.rng`, never `Math.random`/`Date.now`).
- Golden replays (`npm run golden`) pin v1 behaviour with `{governor: false, legacyKo: true, grabs: false, aiVersion: 1}`; keep them byte-identical.

### Common tasks
- **New stage:** `shared/stages/<id>.js` (same shape as `sky-sanctum.js`), list it in `shared/stages/index.js`, add its art class to `STAGE_ART` in `client/render/renderer.js` (art in `client/render/stages/<id>.js`). Keep `REFERENCE` blast distances in `constants.js` at or below the smallest stage's.
- **New effect / sound preset / kit helper:** add it to its table (`schema.EFFECT_PRESETS`, `client/audio.js`, `shared/art/kit.js`), then `npm run docs`.
- **Reviewing a character PR:** CI runs lint, the asset check and the full suite and posts each character's report to the step summary; the `scope` job fails PRs that touch more than one character folder or anything outside `characters/` (unless labelled `engine`).

### Commands
`npm run dev` (watch, port 3000) · `npm start` · `npm test` · `npm run validate [-- <id>] [--explain|--json|--audit]` · `npm run lint` · `npm run assets` · `npm run docs` / `docs:check` · `npm run art-check -- <id> [--sheet]` · `npm run contact-sheet -- <id>` · `npm run calibrate` · `npm run fuzz` · `npm run migrate -- <id>` · `npm run new-character -- <id> ["Name"]` · `npm run test:archetypes:full`

Deployment: `render.yaml` (Render Blueprint, free web service, health check `/healthz`, auto-deploys `main`). CI: `.github/workflows/validate.yml`.
