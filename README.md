# Character Battle

**A Smash-style 2D platform fighter where every friend builds their own character.**

Clone the repo, ask Claude Code (or your own two hands) to turn **any** description into a fighter — a storm cloud, a bee swarm, a grandma on a scooter, a shapeshifting slime, a hamster in a mech, a dragon, a chess army — then battle your friends online. Go as wild as you want: an **auto-balancer** scales anything overpowered back into fair limits, and a runtime **Governor** guarantees nobody gets one-shot or becomes unkillable, so creativity is unlimited and fairness is guaranteed.

## Features

- **Platform fighting:** percent-based damage, knockback that grows with damage, stocks, blast zones, platforms, shields, rolls, spot and air dodges, short hops, fast-falling, directional influence, charged smash attacks, stale-move negation.
- **Online multiplayer:** 2–4 players per room with 4-letter room codes. The server is authoritative at 60 Hz. Hosts can add CPUs, and a CPU takes over if someone disconnects mid-match.
- **Local play:** up to 4 players (2 sharing a keyboard, plus gamepads), CPUs at three difficulty levels, and training mode with a hitbox overlay and slow-mo.
- **Build-your-own fighters (Character System v2):** any body shape, forms, resources, movement modes (hover, glide, fly, wall-cling, crawl), projectiles, minions, traps, zones, beams, clones and parts, statuses, grabs and throws, counters, reflect/absorb, plus sandboxed scripts for the long tail. Each character lives in `characters/<id>/`.
- **Auto-balancer:** caps damage, knockback and KO percent, enforces a stat budget and a move power budget, limits recovery distance and projectiles, and sets hurtbox minimums. It **scales instead of rejecting**, and tells you exactly what it changed.
- **Free-form art:** procedural Canvas 2D (with soft-body, swarm, serpent, tentacle, wing, quadruped and mech helpers), sprite sheets, or the animated humanoid puppet; world-space particles, synth sound presets, portraits.
- **Art Lab + art checks:** every state, move, form and entity with shape-accurate hitboxes, automatic quality checks and a contact-sheet PNG (`npm run art-check`).
- **CPUs that read your kit:** they zone with your projectiles, use your recovery and movement modes, grab, mash out and follow your `ai` hints.
- No build step. Plain Node + ES modules.

## Quick start

```bash
npm install
npm run dev          # → http://localhost:3000
```

Requires Node 20+.

## Controls

| | Keyboard (solo / online) | Gamepad |
|---|---|---|
| Move | WASD / Arrow keys | Left stick / D-pad |
| Jump | Space | A / Y |
| Attack (+ direction) | J (or Z) | X |
| Special (+ direction) | K (or X) | B |
| Smash (hold to charge) | I (or C) | Right stick |
| Shield / dodge | L or Shift | Bumpers / triggers |
| Grab | Shield + attack | Bumper + X |
| Taunt | T | Back / Select |

Shield + left/right = roll, shield + down = spot dodge, shield in the air = air dodge. Down on a platform drops through it, and down while falling fast-falls. Up + special is your recovery. **Local 2-player keyboard:** P1 uses WASD, Space, F/G/H, Shift/Q, taunt T. P2 uses the arrow keys, `/`, `.`, `,`, `M`, L/Right Shift, taunt `'`. Esc pauses. In training: H = hitboxes, Y = slow-mo, R = reset (T is taunt).

## Add your character

```bash
npm run new-character -- frost-knight "Frost Knight"
npm run dev
# training:  http://localhost:3000/?train=frost-knight            (standing dummy)
#            http://localhost:3000/?train=frost-knight&cpu=hard   (cpu=easy|normal|hard, &vs=<id> picks the opponent)
# art lab:   http://localhost:3000/lab.html?char=frost-knight
npm run validate -- frost-knight --explain   # what did the auto-balancer change, and how to get it back
npm run art-check -- frost-knight --sheet   # Lab checks + .cache/contact-sheets/frost-knight.png
npm test                              # must pass before a PR
```

- **[docs/CHARACTER_GUIDE.md](docs/CHARACTER_GUIDE.md):** every field, script call and limit (tables generated from the engine).
- **[docs/COOKBOOK.md](docs/COOKBOOK.md):** recipes that map concepts (clouds, swarms, mechs, dragons, slimes…) onto engine primitives.
- **[docs/ART_GUIDE.md](docs/ART_GUIDE.md):** the art contract, helpers, sprites, fx, the Lab and the quality bar; plus the humanoid puppet.
- Full examples: `characters/nimbus` (storm cloud), `characters/gertie` (grandma on a scooter), `characters/gloop` (shapeshifting slime).
- Using Claude Code? Just say *"make me a character"*. [CLAUDE.md](CLAUDE.md) tells it the workflow and the rules.

## Project structure

```
characters/
  _template/                starting point (copied by `npm run new-character`)
  <id>/                     one folder per fighter: character.js (kit) + art.js (+ assets)
shared/                     runs on server AND in the browser
  constants.js              universal rules (physics, shields, dodges, stale moves…)
  char/                     defineCharacter, schema, normalizers, IR
  balance/                  static limits (rules.js), runtime caps (governor-rules.js), the auto-balancer
  sim/                      deterministic simulation, Governor, entities, scripts sandbox, CPU AI
  art/                      drawing kit, sprite helper, shape-following helpers, humanoid puppet
  stages/                   stage registry + geometry
server/                     Express + Socket.IO: static files, lobbies, one worker thread per match
client/                     menus, rendering (art host, particles, HUD), input, audio, Art Lab (lab.html)
scripts/                    validate, lint, asset check, fuzz, migrate, gen-docs, art-check, smoke test, new-character
test/                       golden replays, unit suites, AI, cheater and weird-archetype suites
docs/                       character guide, art guide, cookbook, design spec
render.yaml                 Render deployment blueprint
.github/                    CI workflow, CODEOWNERS, PR template
```

## Balance philosophy

**Maximum creative freedom, guaranteed fairness.**

Characters are **data + art + sandboxed scripts**. When the game loads a character, `shared/balance/validate.js` builds a clean, frozen copy (the IR), and **the simulation only ever reads that copy**. Scripts get read-only views and a command API where every call passes a Governor gate; they can only deal damage through named hit templates. Art functions can draw anything, but they never touch game state.

Anything over the limits in `shared/balance/rules.js` gets **scaled back, not rejected**:

- per-hit and per-move **damage caps** by move category (jab, tilt, smash, aerial, special, recovery)
- **knockback** caps and **KO-percent floors**: no move can KO a standard fighter from center stage before its floor (85% for a maxed smash), so nothing one-shots
- a **52-point stat budget** (weight, speed, jumps…) and **hurtbox minimums**, so there's no infinite health and no un-hittable specks
- a **move power budget** of 112 across all 16 moves, so the strongest moves are trimmed first if a kit is too strong overall
- **recovery distance**, dash distance, **projectile** count, speed, size and lifetime, intangibility frames, minimum startup and duration
- universal rules for everyone: shields, dodges, stale-move negation, DI, helpless after up-special, side-special once per airtime

On top of that, the runtime **Governor** enforces per-hit, combo, rate, air-time, mitigation, intangibility and entity budgets during play, whatever a character's code does.

`npm run validate -- <id> --explain` lists every adjustment with its fix, so designers can tune until there are none.

## Server, protocol and environment

- **Trust boundary:** the Express/Socket.IO process never imports character code. `server/catalog-worker.js` validates every character in a worker (10 s timeout each) and returns JSON only: ids, a sha1 **hash** of each folder, notes and reports. `/api/characters` returns `[{id, hash}]`; clients import `/characters/<id>/character.js?v=<hash>`.
- **Room workers:** every match runs in its own `worker_threads` worker (`server/room-worker.js`) with the sim guard installed and the realm frozen. A **500 ms watchdog** (`WATCHDOG_MS`) terminates a hung match and emits `match:aborted {reason: 'hung', character}` naming the fighter whose code was running; other rooms keep ticking.
- **Protocol v2** (`PROTOCOL = 2` in `server/rooms.js`, which documents every message): `client:hello {protocol, hashes}` → `room:create` / `room:join` / `room:select` / `room:ready` / `room:addBot` / `room:removeBot` / `room:settings` / `room:leave` / `room:start` (server → `room:state`) → `match:start {protocol: 2, roster: [{…, hash, tables}], seed, stageId, rules}` → `snap {s, e}` at about 30 Hz → `match:end {results, winner}` or `match:aborted {reason, character, message}` (reasons `hung`, `invalid`, `stale`, `error`, `crashed` — the worker exited). Inputs (`input <mask>`) are a 10-bit mask (`BUTTONS` in `shared/constants.js`; bit 9 = taunt). If a player's reported character hashes differ from the server's, the start is rejected and they get `room:stale {ids, message}` ("refresh to update characters").

| env var | effect |
|---|---|
| `PORT` | listen port (default 3000) |
| `NODE_ENV=production` | `/api/characters` serves the catalog loaded at boot (otherwise it re-scans changed folders on every request) and dev routes are off |
| `ROOM_WORKERS=0` | run matches in-process (debugging only: no watchdog, character code loads into the server process) |
| `DEV_ROUTES=1` | mount `server/dev-routes.js` (Lab contact-sheet / art-check endpoints) even in production |

## Deploying to Render

The repo includes a [Render Blueprint](https://render.com/docs/blueprint-spec) (`render.yaml`): one free Node web service.

1. Push the repo to GitHub.
2. In the Render dashboard, choose **New → Blueprint**, then pick this repository. Render reads `render.yaml` and creates the `character-battle` service (`npm ci` → `npm start`, health check `/healthz`, `NODE_ENV=production`).
3. Share the `https://<service>.onrender.com` URL with friends. Click **Online**, create a room, and share the 4-letter code.

Notes:
- **WebSockets work out of the box** on Render web services. Socket.IO needs no extra config, and the server listens on Render's `PORT`.
- **Free plan cold starts:** the service sleeps after ~15 minutes without traffic, and the first visit afterwards takes a little while (often 30–60 s) to wake it. Upgrade the plan in `render.yaml` if that's annoying.
- **Auto-deploy:** every push or merge to `main` redeploys. In production the roster is loaded once at startup, so new characters appear after the redeploy.

## Contributing (friends)

1. **Fork** the repo (or create a branch if you have access).
2. `npm run new-character -- <your-id>` and build your fighter. **Only touch `characters/<your-id>/`.**
3. `npm run validate -- <your-id>` (aim for zero auto-balance notes) and `npm test`.
4. Open a **pull request**. The checklist template appears automatically.
5. **CI** runs `npm test`, posts your character's balance report, and fails a PR that touches anything outside one `characters/<id>/` folder (engine and balance files are owned by @NoahWolk1 via CODEOWNERS).
6. After review and **merge** to `main`, **Render redeploys** and your fighter is live for everyone.

Want an engine feature (a new animation, effect, mechanic or stage)? Open an issue instead of changing `shared/`, `server/` or `client/` in a character PR.
