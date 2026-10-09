// ─────────────────────────────────────────────────────────────────────────────
// The authoritative game simulation. Runs on the server for online matches and
// in the browser for practice / local matches. Pure logic — no rendering.
//
// Characters only provide DATA (normalized by shared/balance/validate.js);
// every rule about damage, knockback, health and stocks lives in shared/sim/.
// This file is the facade plus the fixed step order (spec §3.2); the work is
// split across the modules in §3.1:
//   input-map  states  actions  movement  physics  hurtbox  shapes  hits
//   entities  status  resources  script-api  fighter  snapshot  governor
// ─────────────────────────────────────────────────────────────────────────────
import { MATCH, BUTTONS } from '../constants.js';
import { mulberry32, resolveSeed } from './rng.js';
import { createFighter, checkBlastZones } from './fighter.js';
import { readInput } from './input-map.js';
import * as states from './states.js';
import * as movement from './movement.js';
import * as physics from './physics.js';
import * as hits from './hits.js';
import * as entities from './entities.js';
import * as status from './status.js';
import * as resources from './resources.js';
import * as script from './script-api.js';
import * as snap from './snapshot.js';

// The runtime Governor (§4.2, WP-D) is optional at load time: if the module is
// missing or fails to import, matches run with v1 rules and a single warning.
let Governor = null;
try {
  ({ Governor } = await import('./governor.js'));
} catch (e) {
  const missing = /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to fetch|error loading dynamically imported module|Importing a module script failed/i.test(`${e && (e.code || '')} ${e && e.message}`);
  if (!missing) console.warn(`sim: governor.js failed to load, running ungoverned: ${e && e.message}`);
}

export const DEFAULT_RULES = Object.freeze({
  stocks: MATCH.stocks, infinite: false, countdown: true,
  governor: true, grabs: true, legacyKo: false, // seed: hash of player ids + stage id
});

export class Game {
  /**
   * @param {object} opts
   * @param {object} opts.stage  stage geometry (shared/stages/*.js)
   * @param {Array}  opts.players [{ id, name, character (normalized), cpu?: 'easy'|'normal'|'hard', color }]
   * @param {object} [opts.rules] { stocks, infinite, countdown, seed, governor=true, grabs=true, legacyKo=false }
   */
  constructor({ stage, players, rules = {} }) {
    this.stage = stage;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.rng = mulberry32(resolveSeed(this.rules.seed, players, stage.id)); // seeded sim randomness (CPU AI only)
    this.frame = 0;
    this.phase = this.rules.countdown ? 'countdown' : 'playing';
    this.phaseFrame = 0;
    this.events = [];
    this.winner = null;
    entities.init(this);
    this.fighters = players.map((p, i) => createFighter(this, p, i));
    // Governor: guarded by rules.governor; null = exact v1 rules (golden replays).
    this.gov = this.rules.governor && Governor ? new Governor(this) : null;
    if (this.gov) movement.prewarm(this); // KO tables for forms / gravity statuses (no mid-match hitch)
    for (const f of this.fighters) script.run(f, 'init'); // behavior.init at match start (§2.2.13)
  }

  /** v1 name for the entity store (v1 projectiles). */
  get projectiles() { return this.entities; }

  fighter(id) { return this.fighters.find((f) => f.id === id); }

  setInput(id, input) {
    const f = this.fighter(id);
    if (!f || f.cpu) return;
    const clean = {};
    for (const b of BUTTONS) clean[b] = !!(input && input[b]);
    f.pendingInput = clean;
  }

  emit(e) { this.events.push(e); }

  drainEvents() { const e = this.events; this.events = []; return e; }

  setState(f, state) { states.setState(f, state); }

  isIntangible(f) { return hits.isIntangible(f, true); } // observer: never charges budget

  // ── Main step: the fixed order of spec §3.2 ─────────────────────────────
  step() {
    this.frame++;
    this.phaseFrame++;
    // 0. countdown (v1: inputs and stateFrame still tick; the GO frame is live)
    if (this.phase === 'countdown') {
      if (this.phaseFrame % 60 === 0 || this.phaseFrame === 1) this.emit({ type: 'countdown', n: Math.max(0, 3 - Math.floor(this.phaseFrame / 60)) });
      if (this.phaseFrame >= MATCH.countdownFrames) { this.phase = 'playing'; this.phaseFrame = 0; this.emit({ type: 'go' }); }
    }
    const active = this.phase !== 'countdown';

    // 1. fighters, in index order
    for (const f of this.fighters) {
      if (f.eliminated) continue;
      readInput(f, active);
      if (!active) { f.stateFrame++; continue; }
      if (f.hitlag > 0) { f.hitlag--; continue; }
      status.tick(f);
      resources.tick(f);
      const live = states.update(f); // timers, shield, dead/respawn, ground/air → actions
      script.flush(f);
      script.run(f, 'tick');
      script.flush(f);
      if (live) {
        movement.update(f);
        physics.integrate(f);
      }
    }
    if (!active) return;

    entities.update(this);              // 2. entities (id order)
    hits.resolve(this);                 // 3. hits
    script.runQueued(this);             // 4. onHit / onHurt hooks, flush
    checkBlastZones(this);              // 5. blast zones → ko → respawn hooks
    if (this.gov) { this.gov.endFrame(this); for (const f of this.fighters) status.syncBreak(f); } // 6. governor windows (a BREAK frees the target this frame)
    this.checkMatchEnd();               // 7.
  }

  checkMatchEnd() {
    if (this.phase !== 'playing' || this.rules.infinite) return;
    const remaining = this.fighters.filter((f) => !f.eliminated);
    if (remaining.length <= 1 && this.fighters.length > 1) {
      this.phase = 'ended';
      this.phaseFrame = 0;
      this.winner = remaining[0]?.id || null;
      if (remaining[0]) remaining[0].placement = 1;
      this.emit({ type: 'gameover', winner: this.winner });
    }
  }

  // ── Serialization (snapshot.js) ────────────────────────────────────────
  roster() { return snap.roster(this); }
  snapshot() { return snap.snapshot(this); }
  projectilesV1() { return snap.projectilesV1(this); }
}
