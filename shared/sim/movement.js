// ─────────────────────────────────────────────────────────────────────────────
// movement.js — gravity, drift, friction, movement modes, air budgets (§3.8, §4.2.5). WP-H.
//
//   queueAir(f, dir, driftMult, gravMult)  states.js air logic queues its free-fall
//                           physics here (dir null = no drift); update() applies it.
//   update(f)               §3.2 "movement.update" (after states/actions/scripts, before
//                           physics.integrate): queued drift+gravity, the modes
//                           hover / glide / fly / wallCling / crawl, Governor.airTick
//                           (rise clamp, stall exhaustion, long-air → helpless).
//   modeLogic(f, dir) -> bool  states.airLogic for glide/fly/wallcling/crawl: input and
//                           exits. false = dropped to 'air' (caller falls through to the
//                           actionable air logic, so attack/special/shield/jump work).
//   drift / gravity / friction   v1 primitives (still called inline by actions.js and
//                           ground logic at v1's call sites; golden parity).
//   airReset(f)             landing / respawn: refill per-airtime mode counters.
//   movementOf(f)           the current form's IR movement ({} for v1).
//   pushOut(f) -> bool      push the collider out of the main ground (form switch, scale).
//   refreshKoTable(f), prewarm(game)   KO tables for modded/form stats (§4.2.2, no hitch).
// v1 characters: queued physics is exactly v1's drift-then-gravity; no modes.
// ─────────────────────────────────────────────────────────────────────────────
import { PHYSICS } from '../constants.js';
import { approach, touchGround } from './physics.js';
import { setState } from './states.js';
import { dirX, pressed, consume } from './input-map.js';
import { collider } from './hurtbox.js';
import { buildKoTable, koTableKey } from './ko-table.js';

export const AIR_ACCEL = 0.42;
export const RUN_ACCEL = 0.9;
const GLIDE_ACCEL = 0.3;
const CLING_SLIDE = 0.4;
const EMPTY = Object.freeze({});
const MODE_STATES = new Set(['glide', 'fly', 'wallcling', 'crawl']);
const FREE_AIR = new Set(['air', 'glide', 'fly', 'wallcling', 'crawl']);
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ── v1 primitives ───────────────────────────────────────────────────────────
export function drift(f, dir, mult) {
  const max = f.stats.airSpeed * mult;
  if (dir) f.vx = approach(f.vx, dir * max, AIR_ACCEL);
  else f.vx = approach(f.vx, 0, PHYSICS.airFriction);
}

export function gravity(f, mult = 1) {
  const st = f.stats;
  const max = f.fastFall ? st.fallSpeed * PHYSICS.fastFallMultiplier : st.fallSpeed;
  if (f.fastFall && f.vy > 0) f.vy = max;
  else f.vy = Math.min(max, f.vy + st.gravity * mult);
}

export function friction(f) { f.vx = approach(f.vx, 0, PHYSICS.groundFriction); }

/** Movement modes of the fighter's current form (IR: only enabled modes present). */
export function movementOf(f) {
  const c = f.char;
  const form = f.form && f.form !== 'base' ? c.forms?.[f.form] : null;
  return (form && form.movement) || c.forms?.base?.movement || c.movement || EMPTY;
}

export function airReset(f) {
  const a = f.air;
  if (!a) return;
  a.rise = 0; a.stall = 0; a.teleports = 0;
  a.hoverFrames = 0; a.glideFrames = 0; a.clingUsed = false; a.crawlFrames = 0;
  a.flyFuel = fin(movementOf(f).fly?.fuel);
}

// ── queued free-fall physics ────────────────────────────────────────────────
export function queueAir(f, dir, driftMult = 1, gravMult = 1) {
  const q = f.mvq || (f.mvq = { on: false, dir: 0, drift: 0, grav: 1 });
  q.on = true; q.dir = dir; q.drift = driftMult; q.grav = gravMult;
}

const held = (f, b) => !!(f.input && f.input[b || 'jump']);

/** Stall budget spent (Governor): modes off, normal gravity / fallSpeed until landing. */
function exhausted(f) {
  const gov = f.game && f.game.gov;
  return !!(gov && gov.stallExhausted && gov.stallExhausted(f));
}

function selfVel(f, vx, vy, src) {
  const gov = f.game && f.game.gov;
  if (!gov || !gov.selfVelocity) return { vx, vy };
  return gov.selfVelocity(f, vx, vy, src);
}

export function update(f) {
  const q = f.mvq;
  const M = movementOf(f);
  f.hovering = false;
  if (M === EMPTY) {
    if (q && q.on) applyQueued(f, q, 1);
  } else {
    runModes(f, M);
  }
  if (f.mvq) f.mvq.on = false;
  airGovern(f);
}

function applyQueued(f, q, driftMul) {
  if (q.dir !== null) drift(f, q.dir, q.drift * driftMul);
  const m = f.mods;
  if (m && (m.gravity < 1 || m.fallSpeed < 1) && exhausted(f)) {
    // Stall exhausted: reducing gravity mods no longer apply (§4.2.5).
    const st = f.stats;
    const g = m.gravity < 1 ? st.gravity / m.gravity : st.gravity;
    const fs = m.fallSpeed < 1 ? st.fallSpeed / m.fallSpeed : st.fallSpeed;
    const max = f.fastFall ? fs * PHYSICS.fastFallMultiplier : fs;
    if (f.fastFall && f.vy > 0) f.vy = max; else f.vy = Math.min(max, f.vy + g * q.grav);
  } else gravity(f, q.grav);
}

function runModes(f, M) {
  const tired = exhausted(f);
  if (tired && MODE_STATES.has(f.state)) { setState(f, 'air'); queueAir(f, dirX(f), 1, 1); }
  const q = f.mvq;
  if (f.grounded) { if (q && q.on) applyQueued(f, q, 1); return; }
  const st = f.state;
  if (st === 'glide') return glidePhysics(f, M.glide);
  if (st === 'fly') return flyPhysics(f, M.fly);
  if (st === 'wallcling') return clingPhysics(f, M.wallCling);
  if (st === 'crawl') return crawlPhysics(f, M.crawl);
  // Mode entry from free air (the action-independent 'air' state).
  if (st === 'air' && !tired && !(f.modeLock > f.game.frame)) {
    const a = f.air;
    const wall = wallContact(f);
    const C = M.crawl;
    if (C && a.crawlFrames < C.frames) {
      const dir = dirX(f);
      if (wall && dir === wall && (f.input.up || f.input.down || !M.wallCling)) return enterCrawl(f, C, 'side', wall);
      if (!wall && f.input.up && underContact(f)) return enterCrawl(f, C, 'under', 0);
    }
    const W = M.wallCling;
    if (W && wall && !a.clingUsed && dirX(f) === wall) {
      a.clingUsed = true;
      f.facing = wall;
      f.clingSide = wall;
      setState(f, 'wallcling');
      f.vx = 0; f.vy = CLING_SLIDE; f.fastFall = false;
      f.game.emit({ type: 'cling', id: f.id, x: f.x, y: f.y });
      return;
    }
    const F = M.fly;
    if (F && a.flyFuel > 0 && held(f, F.button) && (F.button !== 'jump' || f.jumpsLeft === 0 || f.vy >= 0)) {
      setState(f, 'fly');
      f.fastFall = false;
      return flyPhysics(f, F);
    }
    const G = M.glide;
    if (G && a.glideFrames < G.frames && held(f, G.button) && f.vy >= 0 && !f.fastFall) {
      setState(f, 'glide');
      return glidePhysics(f, G);
    }
  }
  // Hover: a flag on free fall (and aerial attacks), never a state.
  const H = M.hover;
  const hover = H && !tired && (st === 'air' || st === 'attack') && f.vy >= 0 && !f.fastFall
    && f.air.hoverFrames < H.frames && held(f, H.button);
  if (q && q.on) applyQueued(f, q, hover ? fin(H.drift, 1) : 1);
  if (hover) {
    f.air.hoverFrames++;
    f.hovering = true;
    if (f.vy > H.fallSpeed) f.vy = H.fallSpeed;
  }
}

function glidePhysics(f, G) {
  const a = f.air;
  a.glideFrames++;
  const target = f.facing * fin(G.speed, 1.15) * f.stats.airSpeed;
  f.vx = approach(f.vx, target, GLIDE_ACCEL);
  const tilt = (f.input.down ? 1 : 0) - (f.input.up ? 1 : 0);
  let vy = Math.min(f.vy + f.stats.gravity * 0.5, G.fallSpeed);
  vy += tilt * fin(G.turn, 0.05) * Math.abs(f.vx);
  if (vy < 0) vy = selfVel(f, f.vx, vy, 'glide').vy;
  f.vy = Math.min(vy, G.fallSpeed * 2);
}

function flyPhysics(f, F) {
  const a = f.air;
  a.flyFuel = Math.max(0, a.flyFuel - 1);
  const dir = dirX(f);
  f.vx = approach(f.vx, dir * f.stats.airSpeed, AIR_ACCEL);
  if (dir) f.facing = dir;
  if (f.input.down) { gravity(f); return; } // controlled descent: no thrust
  let vy = Math.max(f.vy - F.thrust, -F.maxRise);
  if (vy < 0) vy = selfVel(f, f.vx, vy, 'fly').vy;
  f.vy = vy;
}

function clingPhysics(f) {
  f.vx = 0;
  f.vy = CLING_SLIDE;
}

function enterCrawl(f, C, surface, side) {
  setState(f, 'crawl');
  f.crawlSurface = surface;
  f.clingSide = side;
  if (side) f.facing = side;
  f.fastFall = false;
  f.vx = 0; f.vy = 0;
  return crawlPhysics(f, C);
}

function crawlPhysics(f, C) {
  const g = f.game.stage.ground;
  const col = collider(f);
  const hw = col.w / 2, h = col.h;
  const sp = Math.max(0.5, fin(C.speed, 3));
  f.air.crawlFrames++;
  if (f.crawlSurface === 'under') {
    const dir = dirX(f);
    f.y = g.bottom + h;
    f.vy = 0;
    f.vx = dir * sp;
    if (dir) f.facing = dir;
    // Wrap around the corner onto the side face.
    const nx = f.x + f.vx;
    if (nx < g.x1 + 1 || nx > g.x2 - 1) {
      const side = nx < g.x1 + 1 ? 1 : -1;  // wall is to the right of a fighter on the left face
      f.crawlSurface = 'side';
      f.clingSide = side;
      f.facing = side;
      f.x = side > 0 ? g.x1 - hw : g.x2 + hw;
      f.y = g.bottom + h - 1;
      f.vx = 0;
    }
    return;
  }
  // Side face: up/down along the wall.
  const side = f.clingSide;
  f.x = side > 0 ? g.x1 - hw : g.x2 + hw;
  f.vx = 0;
  const v = (f.input.down ? 1 : 0) - (f.input.up ? 1 : 0);
  let vy = v * sp;
  if (vy < 0) vy = selfVel(f, 0, vy, 'crawl').vy;
  f.vy = vy;
  if (vy < 0 && f.y + vy <= g.y + 1) {
    // Climb over the top: a ledge-style landing.
    f.x = side > 0 ? g.x1 + 6 : g.x2 - 6;
    f.vy = 0;
    setState(f, 'air');
    touchGround(f, -1, g.y, 8);
    f.game.emit({ type: 'ledge', id: f.id, x: f.x, y: f.y });
    return;
  }
  if (vy > 0 && f.y + vy - h >= g.bottom - 0.5) {
    // Round the bottom corner onto the underside.
    f.crawlSurface = 'under';
    f.x = side > 0 ? g.x1 + hw : g.x2 - hw;
    f.y = g.bottom + h;
    f.vy = 0;
  }
}

/**
 * states.airLogic hook for the mode states. Handles input-driven exits; returns
 * true when the mode continues (physics run in update), false after dropping
 * to 'air' (the caller falls through to the actionable air logic).
 */
export function modeLogic(f) {
  const M = movementOf(f);
  const st = f.state;
  const inp = f.input;
  const drop = () => { lock(f); setState(f, 'air'); return false; };
  const attackPressed = pressed(f, 'attack') || pressed(f, 'strong');
  if (st === 'glide') {
    const G = M.glide;
    if (!G || !held(f, G.button) || f.air.glideFrames >= G.frames) return drop();
    if (pressed(f, 'special')) consume(f, 'special'); // only aerials from glide
    if (attackPressed || pressed(f, 'shield')) return drop();
    const dir = dirX(f);
    if (dir && dir !== f.facing) { f.facing = dir; f.vx *= -0.5; }
    return true;
  }
  if (st === 'fly') {
    const F = M.fly;
    if (!F || !held(f, F.button) || f.air.flyFuel <= 0) return drop();
    if (attackPressed || pressed(f, 'special') || pressed(f, 'shield')) return drop();
    return true;
  }
  if (st === 'wallcling') {
    const W = M.wallCling;
    if (!W || f.stateFrame > W.frames || !wallContact(f)) return drop();
    if (pressed(f, 'jump')) {
      if (W.wallJump === false) return drop();
      consume(f, 'jump');
      wallJump(f, f.clingSide, W.jumpVx, W.jumpVy);
      return true;
    }
    if (dirX(f) === -f.clingSide || (inp.down && pressed(f, 'down'))) return drop();
    if (attackPressed || pressed(f, 'special') || pressed(f, 'shield')) return drop();
    return true;
  }
  if (st === 'crawl') {
    const C = M.crawl;
    if (!C || f.air.crawlFrames >= C.frames) return drop();
    if (pressed(f, 'jump')) {
      consume(f, 'jump');
      if (f.crawlSurface === 'side') {
        const W = M.wallCling || EMPTY;
        wallJump(f, f.clingSide, fin(W.jumpVx, 6), fin(W.jumpVy, 11));
      } else { setState(f, 'air'); f.vy = 1; }
      return true;
    }
    if (f.crawlSurface === 'side' && dirX(f) === -f.clingSide) return drop();
    if (f.crawlSurface === 'under' && inp.down) { f.vy = 1; return drop(); }
    if (attackPressed || pressed(f, 'special') || pressed(f, 'shield')) return drop();
    return true;
  }
  return drop();
}

/** Wall jump away from the wall on `side` (+1 = wall to the right). Not an air jump. */
function wallJump(f, side, jumpVx, jumpVy) {
  lock(f);
  setState(f, 'air');
  f.facing = -side;
  f.vx = -side * fin(jumpVx, 6);
  f.vy = -fin(jumpVy, 11);
  f.fastFall = false;
  f.game.emit({ type: 'walljump', id: f.id, x: f.x, y: f.y });
}

// No mode re-entry for a few frames after leaving one (wall jump, letting go).
const MODE_LOCK = 10;
function lock(f) { f.modeLock = f.game.frame + MODE_LOCK; }

/** +1 when touching the main ground's LEFT face (wall to the right), −1 right face, 0 none. */
export function wallContact(f) {
  const g = f.game.stage.ground;
  const col = collider(f);
  const hw = col.w / 2;
  if (!(f.y > g.y + 1 && f.y - col.h < g.bottom)) return 0;
  if (Math.abs(f.x - (g.x1 - hw)) <= 1.5) return 1;
  if (Math.abs(f.x - (g.x2 + hw)) <= 1.5) return -1;
  return 0;
}

function underContact(f) {
  const g = f.game.stage.ground;
  const col = collider(f);
  return f.x > g.x1 && f.x < g.x2 && Math.abs(f.y - col.h - g.bottom) <= 2;
}

// ── Governor air accounting (§4.2.5) ────────────────────────────────────────
function airGovern(f) {
  const gov = f.game && f.game.gov;
  if (!gov || !gov.airTick) return;
  const info = gov.airTick(f);
  if (!info) return;
  if (info.stallExhausted && MODE_STATES.has(f.state)) setState(f, 'air');
  if (info.helpless && FREE_AIR.has(f.state) && !f.grounded) {
    setState(f, 'helpless');
    f.game.emit({ type: 'gov', rule: 'longAirHelpless', who: f.id, target: null, amount: 0 });
  }
}

// ── Collider push-out (§3.7) ────────────────────────────────────────────────
/** Pushes the collider out of the main ground by the smallest move (ties: up). */
export function pushOut(f) {
  const g = f.game.stage.ground;
  const col = collider(f);
  const hw = col.w / 2, h = col.h;
  if (f.grounded && f.platform < 0) return false;          // standing on top: no overlap
  if (!(f.x + hw > g.x1 && f.x - hw < g.x2 && f.y > g.y && f.y - h < g.bottom)) return false;
  const up = f.y - g.y, left = f.x + hw - g.x1, right = g.x2 - (f.x - hw), down = g.bottom + h - f.y;
  const m = Math.min(up, left, right, down);
  if (m === up) { f.y = g.y; f.vy = Math.min(0, f.vy); }
  else if (m === left) { f.x = g.x1 - hw; f.vx = Math.min(0, f.vx); }
  else if (m === right) { f.x = g.x2 + hw; f.vx = Math.max(0, f.vx); }
  else { f.y = g.bottom + h; f.vy = Math.max(0, f.vy); }
  return true;
}

// ── KO tables for modded / form stats (§4.2.2) ──────────────────────────────
// Modded gravity/fallSpeed are quantized conservatively (gravity DOWN to 0.05,
// fallSpeed UP to 0.5: both make Vko smaller = a stricter floor) so a status
// never creates more than a handful of table keys, all prewarmed at match start.
function koStats(f, st, mods) {
  let gravity = st.gravity, fallSpeed = st.fallSpeed;
  if (mods && (mods.gravity !== 1 || mods.fallSpeed !== 1)) {
    gravity = Math.max(0.05, Math.floor(gravity * 20 + 1e-9) / 20);
    fallSpeed = Math.ceil(fallSpeed * 2 - 1e-9) / 2;
  }
  return { gravity, fallSpeed, height: fin(st.height, 0) };
}

function koTable(stage, s) {
  const k = koTableKey(fin(s.gravity, 0.65), fin(s.fallSpeed, 11), s.height);
  return buildKoTable(stage, k.gravity, k.fallSpeed, k.height);
}

/** Sets f.koTable for modded stats (quantized); clears it when gravity mods are neutral. */
export function refreshKoTable(f) {
  const game = f.game;
  const m = f.mods;
  const modded = m && (m.gravity !== 1 || m.fallSpeed !== 1);
  if (!modded) { if (f.koTable) f.koTable = null; return; }
  if (!game || !game.gov || !game.stage) return;
  f.koTable = koTable(game.stage, koStats(f, f.stats, m));
}

/** Match start: build every KO table a v2 fighter can need (forms × referenced gravity statuses). */
export function prewarm(game) {
  if (!game || game.rules?.governor === false || !game.stage) return;
  const v2 = game.fighters.filter((f) => f.char && f.char.forms && f.char.tables);
  if (!v2.length) return;
  const mods = referencedGravityMods(game.fighters);
  for (const f of game.fighters) {
    const c = f.char;
    const formNames = c.tables?.forms || ['base'];
    for (const form of formNames) {
      const st = form === 'base' ? (c.stats ?? c.forms?.base?.stats) : { ...(c.stats ?? c.forms?.base?.stats), ...(c.forms?.[form]?.stats || {}) };
      if (!st) continue;
      koTable(game.stage, { gravity: st.gravity, fallSpeed: st.fallSpeed, height: fin(st.height, 0) });
      for (const m of mods) {
        const g = Math.min(1.4, Math.max(0.5, m.gravity)), fs = Math.min(1.3, Math.max(0.7, m.fallSpeed));
        const mm = { gravity: g, fallSpeed: fs };
        koTable(game.stage, koStats(f, { gravity: st.gravity * g, fallSpeed: st.fallSpeed * fs, height: st.height }, mm));
      }
    }
  }
}

/** Gravity/fallSpeed mods of every status referenced by a hit, entity or timeline in the roster. */
function referencedGravityMods(fighters) {
  const names = new Set();
  const seen = new WeakSet();
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 8 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    const s = o.status;
    if (typeof s === 'string') names.add(s); else if (s && typeof s.name === 'string') names.add(s.name);
    for (const k in o) if (k !== 'status' && typeof o[k] === 'object') walk(o[k], depth + 1);
  };
  const out = [];
  const keys = new Set();
  for (const f of fighters) {
    const c = f.char;
    if (!c || !c.tables) continue;
    names.clear();
    walk(c.moves, 0); walk(c.hitboxes, 0); walk(c.entities, 0);
    for (const n of [...names].sort()) {
      const d = c.statuses?.[n];
      const m = d && d.mods;
      if (!m || ((m.gravity ?? 1) === 1 && (m.fallSpeed ?? 1) === 1)) continue;
      const key = `${m.gravity ?? 1}|${m.fallSpeed ?? 1}`;
      if (keys.has(key)) continue;
      keys.add(key);
      out.push({ gravity: fin(m.gravity, 1), fallSpeed: fin(m.fallSpeed, 1) });
    }
  }
  return out;
}
