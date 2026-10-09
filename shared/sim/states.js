// Fighter state machine (spec §3.4): the closed state enum, per-frame timers,
// shield/dodges, and ground/air logic. Movement physics live in movement.js /
// physics.js; moves live in actions.js.
import { PHYSICS, SHIELD, DODGE } from '../constants.js';
import { leaveGround, land, approach, clampAbs } from './physics.js';
import { gravity, friction, queueAir, modeLogic, RUN_ACCEL } from './movement.js';
import { pressed, consume, dirX, detectTrigger, resolveMove } from './input-map.js';
import { startAction, updateAction, updateGrab, actionLeft, grabLeft } from './actions.js';
import { updateDead, updateRespawn } from './fighter.js';
import { collider } from './hurtbox.js';

/** The closed state enum. Anything else is a bug (asserted in setState). */
export const STATES = Object.freeze([
  'idle', 'run', 'crouch', 'jumpsquat', 'air', 'land', 'attack', 'shield', 'roll', 'spotdodge',
  'airdodge', 'hitstun', 'helpless', 'shieldbreak', 'dead', 'respawn', 'grabbing', 'grabbed',
  'stunned', 'glide', 'fly', 'wallcling', 'crawl', 'taunt',
]);
const STATE_SET = new Set(STATES);
/** States in which the fighter may start moves (v1). */
export const ACTIONABLE = Object.freeze(new Set(['idle', 'run', 'crouch', 'air']));
/** States that keep f.action alive. */
const KEEPS_ACTION = new Set(['attack', 'grabbing', 'taunt']);

const DEV = typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';
let warned = false;

export function isState(s) { return STATE_SET.has(s); }

export function setState(f, state) {
  if (!STATE_SET.has(state)) {
    if (DEV) throw new Error(`sim: unknown fighter state "${state}" (${f.charId}). Valid: ${STATES.join(' ')}`);
    if (!warned) { warned = true; console.warn(`sim: unknown fighter state "${state}" coerced`); }
    state = f.grounded ? 'idle' : 'air';
  }
  f.state = state;
  f.stateFrame = 0;
  if (!KEEPS_ACTION.has(state) && f.action) { const a = f.action; f.action = null; actionLeft(f, a); }
  if (f.grab && state !== 'grabbing' && state !== 'grabbed') grabLeft(f); // release the partner (WP-F)
}

/**
 * Step §3.2 "states.update": timers, shield regen, dead/respawn, ground/air logic
 * (which runs actions.updateAction for 'attack'). Returns false when the fighter
 * is dead/respawning (no movement or physics this frame, as in v1).
 */
export function update(f) {
  f.stateFrame++;
  if (f.invuln > 0) f.invuln--;
  if (f.intangibleFrames > 0) f.intangibleFrames--;
  if (f.dropThrough > 0) f.dropThrough--;
  if (f.doubleJumpFlip > 0) f.doubleJumpFlip--;
  if (f.state !== 'shield' && f.state !== 'shieldbreak') f.shield = Math.min(SHIELD.max, f.shield + SHIELD.regen);

  switch (f.state) {
    case 'dead': updateDead(f); return false;
    case 'respawn': updateRespawn(f); return false;
  }

  if (f.grounded) groundLogic(f); else airLogic(f);
  return true;
}

function tryTrigger(f, t) {
  const r = resolveMove(f, t.trigger);
  if (!r) return;
  if (t.face) f.facing = t.face;
  startAction(f, r.def, { trigger: t.trigger, name: r.name });
}

export function groundLogic(f) {
  const inp = f.input;
  const st = f.stats;
  const dir = dirX(f);

  switch (f.state) {
    case 'jumpsquat':
      friction(f);
      if (f.stateFrame >= PHYSICS.jumpSquat) {
        const full = inp.jump;
        f.vy = -st.jumpHeight * (full ? 1 : PHYSICS.shortHopFactor);
        if (dir) f.vx = dir * Math.max(Math.abs(f.vx), st.airSpeed * 0.75);
        f.vx = clampAbs(f.vx, st.airSpeed * 1.15);
        leaveGround(f);
        setState(f, 'air');
        f.game.emit({ type: 'jump', id: f.id, x: f.x, y: f.y });
      }
      return;
    case 'land':
      friction(f);
      if (f.stateFrame >= f.lag) setState(f, 'idle');
      else return;
      break;
    case 'attack': case 'taunt': return updateAction(f);
    case 'shield': return updateShield(f, dir);
    case 'roll': return updateRoll(f);
    case 'spotdodge':
      friction(f);
      if (f.stateFrame >= DODGE.spot.duration) setState(f, 'idle');
      return;
    case 'shieldbreak':
      friction(f);
      if (f.stateFrame >= SHIELD.breakStun) { f.shield = SHIELD.max * 0.4; setState(f, 'idle'); }
      return;
    case 'hitstun':
      friction(f);
      if (--f.hitstun <= 0) setState(f, 'idle');
      return;
    case 'helpless': case 'air': case 'airdodge':
      land(f, PHYSICS.landingLag);
      return;
    case 'grabbing': case 'grabbed': return updateGrab(f); // actions.js (WP-F)
    case 'stunned':
      friction(f); // owned by status.js / actions.js (WP-F/H)
      return;
    case 'glide': case 'fly': case 'wallcling': case 'crawl':
      setState(f, 'idle'); // air-only modes end on the ground (movement.js)
      break;
  }

  // Actionable: idle / run / crouch
  if (pressed(f, 'jump')) { consume(f, 'jump'); return setState(f, 'jumpsquat'); }
  const game = f.game;
  if (game.rules.grabs && (pressed(f, 'shield') || inp.shield) && pressed(f, 'attack')) {
    const r = resolveMove(f, 'grab');
    if (r) { consume(f, 'shield'); consume(f, 'attack'); startAction(f, r.def, { trigger: 'grab', name: r.name }); return; }
  }
  if (pressed(f, 'shield') || inp.shield) {
    consume(f, 'shield');
    if (dir && pressed(f, dir > 0 ? 'right' : 'left')) return startRoll(f, dir);
    if (inp.down && pressed(f, 'down')) return startSpotDodge(f);
    return setState(f, 'shield');
  }
  const t = detectTrigger(f);
  if (t) return tryTrigger(f, t);
  if (inp.taunt && !f.prev.taunt) {
    const r = resolveMove(f, 'taunt');
    if (r) { startAction(f, r.def, { trigger: 'taunt', name: r.name }); return; }
  }
  if (inp.down && pressed(f, 'down') && f.platform >= 0) {
    consume(f, 'down');
    f.dropThrough = PHYSICS.dropThroughFrames;
    f.y += 2;
    leaveGround(f);
    return setState(f, 'air');
  }
  if (inp.down) {
    if (f.state !== 'crouch') setState(f, 'crouch');
    friction(f);
    return;
  }
  if (dir) {
    if (f.state !== 'run') { setState(f, 'run'); if (f.facing !== dir) f.vx *= 0.3; }
    f.facing = dir;
    f.vx = approach(f.vx, dir * st.runSpeed, RUN_ACCEL);
    if (f.stateFrame % 16 === 1) f.game.emit({ type: 'step', id: f.id, x: f.x, y: f.y });
    return;
  }
  if (f.state !== 'idle') setState(f, 'idle');
  friction(f);
}

export function airLogic(f) {
  const inp = f.input;
  const st = f.stats;
  const dir = dirX(f);

  switch (f.state) {
    case 'attack': case 'taunt':
      updateAction(f);
      return;
    case 'hitstun':
      if (--f.hitstun <= 0) { setState(f, 'air'); }
      queueAir(f, null); // free-fall physics run in movement.update
      return;
    case 'airdodge': {
      const k = Math.max(0, 1 - f.stateFrame / 22);
      if (f.dodgeDir) { f.vx = f.dodgeVx * k; f.vy = f.dodgeVy * k; } else { gravity(f, 0.5); }
      if (f.stateFrame >= DODGE.air.duration) setState(f, 'air');
      return;
    }
    case 'helpless':
      queueAir(f, dir, 0.7);
      return;
    case 'shieldbreak':
      queueAir(f, null);
      return;
    case 'grabbing': case 'grabbed': return updateGrab(f); // actions.js (WP-F)
    case 'stunned':
      queueAir(f, null); // control/grab owned by status.js / actions.js
      return;
    case 'glide': case 'fly': case 'wallcling': case 'crawl':
      if (modeLogic(f)) return; // movement.js; false = dropped to 'air'
      break;
    case 'jumpsquat': case 'land': case 'shield': case 'roll': case 'spotdodge':
    case 'idle': case 'run': case 'crouch':
      setState(f, 'air');
      break;
  }

  // Actionable in air
  if (pressed(f, 'jump') && f.jumpsLeft > 0) {
    consume(f, 'jump');
    f.jumpsLeft--;
    f.vy = -st.doubleJumpHeight;
    f.vx = dir * st.airSpeed;
    f.fastFall = false;
    f.doubleJumpFlip = 20;
    f.game.emit({ type: 'doublejump', id: f.id, x: f.x, y: f.y });
  } else if (pressed(f, 'shield') && !f.usedAirDodge) {
    consume(f, 'shield');
    f.usedAirDodge = true;
    const dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    const len = Math.hypot(dir, dy);
    f.dodgeDir = len ? 1 : 0;
    f.dodgeVx = len ? (dir / len) * DODGE.air.speed : 0;
    f.dodgeVy = len ? (dy / len) * DODGE.air.speed : 0;
    if (!len) { f.vx *= 0.4; f.vy *= 0.3; }
    setState(f, 'airdodge');
    f.game.emit({ type: 'dodge', id: f.id, x: f.x, y: f.y });
    return;
  } else {
    const t = detectTrigger(f);
    if (t) tryTrigger(f, t);
  }
  if (inp.down && pressed(f, 'down') && f.vy > -2 && f.state !== 'attack') { f.fastFall = true; consume(f, 'down'); }
  if (f.state === 'attack') { gravity(f); return; }
  queueAir(f, dir, 1);
}

// ── Shield & dodges ─────────────────────────────────────────────────────────
function updateShield(f, dir) {
  const inp = f.input;
  friction(f);
  f.shield -= SHIELD.decay;
  if (f.shieldStun > 0) { f.shieldStun--; return; }
  if (f.shield <= 0) return breakShield(f);
  if (pressed(f, 'jump')) { consume(f, 'jump'); return setState(f, 'jumpsquat'); }
  if (dir && pressed(f, dir > 0 ? 'right' : 'left')) { consume(f, dir > 0 ? 'right' : 'left'); return startRoll(f, dir); }
  if (inp.down && pressed(f, 'down')) { consume(f, 'down'); return startSpotDodge(f); }
  if (!inp.shield) { setState(f, 'land'); f.lag = 6; }
}

export function breakShield(f) {
  f.shield = 0;
  setState(f, 'shieldbreak');
  f.vy = -9;
  leaveGround(f);
  f.game.emit({ type: 'shieldbreak', id: f.id, x: f.x, y: f.y - collider(f).h / 2 });
}

function startRoll(f, dir) {
  setState(f, 'roll');
  f.dodgeDir = dir;
  f.game.emit({ type: 'dodge', id: f.id, x: f.x, y: f.y });
}

function startSpotDodge(f) {
  setState(f, 'spotdodge');
  f.game.emit({ type: 'dodge', id: f.id, x: f.x, y: f.y });
}

function updateRoll(f) {
  const d = DODGE.roll;
  const k = f.stateFrame / d.duration;
  f.vx = f.dodgeDir * (d.distance / d.duration) * 2 * Math.max(0, 1 - k) * 1.0;
  if (f.stateFrame >= d.duration) { f.vx = 0; setState(f, 'idle'); f.facing = -f.dodgeDir; }
}
