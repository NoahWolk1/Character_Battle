// ─────────────────────────────────────────────────────────────────────────────
// actions.js — the action (move) interpreter (spec §3.6, WP-F).
//
// Reads two action shapes (anything absent falls back to the v1 rule shown):
//  - v1 validator output (character.moves[slot]): duration, hitboxes (circles),
//    velocity [{start, end, vx|null, vy|null}], projectiles, intangible [s, e],
//    landingLag, startup. No timeline.
//  - IRAction (shared/char/ir.js): the v1 fields plus timeline, hold, charge,
//    cancels, next, counter, armor, hurtboxes, gravity, cost, requires, else,
//    throw, update.
//   charge         {button, at, max} | null — default for category 'smash':
//                  {button:'strong', at: max(1, startup − 3), max: 60}
//   helpless       bool — default: started from the upSpecial trigger
//   oncePerAirtime bool — default: started from the sideSpecial trigger
//   velocity[].airOnly (runtime extension): the window only applies while airborne,
//                  so grounded moves can't lift off by accident (v1 feedback).
//
// Frame semantics (v1): a.frame starts at 0; each update increments it FIRST and
// then runs that frame's timeline/windows, so the first processed frame is 1.
// Charge freezes and hold loops are decided at the top of the update from the
// frame shown last tick (§3.6 steps 1-2); goto / hold / release frame jumps take
// effect on the next update.
//
// ActionInst (f.action while acting; f.lastAction keeps the latest, v1 quirk):
//   { id, def, name, trigger, frame, aerial, hitKeys: Set, hitSomething, chargeFrames,
//     charging, holding, holdFrames, holdReleased, loops, jump, landed, onHitFired,
//     counterArmed, counterIn, counterMul, steer }
//
// EXPORTS:
//   startAction(f, def, {trigger, name}) -> inst|null   pays cost, sets f.action,
//                       enters attack/grabbing/taunt, halves grounded vx for
//                       non-special/recovery, emits {type:'move', id, slot, effect, name, trigger}.
//   updateAction(f)     per frame: charge → hold → frame++ → timeline → velocity/gravity
//                       windows → cancels → move.update → end check (next/helpless).
//   endAction(f)        leave the action: next is NOT started; helpless/idle/air.
//   activeHitboxes(f) -> [{hb, shape (world), key}]  key = `${group}` or
//                       `${group}:${floor((t−start)/rehit)}`; hits.js prefixes `${target}:`.
//   intangibleAt(f), chargeOf(def), phaseOf(f), genericAction(trigger)
//   onLand(f)           physics.touchGround: timeline onLand entries, untilGrounded.
//   onHitConnect(f, h)  hits.afterHit: hitbox onHit lists, timeline onHit entries.
//   tryCounter(t, h)    hits.js before a strike applies: true = cancelled (§3.6.3).
//   grabConnect(game, h) + resolveGrabs(game)   grab hits are queued, then resolved
//                       after all strikes this frame (grab-vs-grab tech, strike wins).
//   updateGrab(f)       states.js 'grabbing'/'grabbed' (§3.6.2).
//   cancelInto(f, name, {script}) -> bool     api.cancelInto (WP-I).
//   actionLeft(f, inst) / grabLeft(f)         states.setState hooks (action
//                       interrupted; grab state left → release the partner).
// ─────────────────────────────────────────────────────────────────────────────
import { COMBAT, MATCH } from '../constants.js';
import { CATEGORIES } from '../balance/rules.js';
import { TRIGGER_CATEGORY } from '../char/schema.js';
import { genericMove } from '../char/generics.js';
import { setState } from './states.js';
import { leaveGround, clampAbs } from './physics.js';
import { drift, gravity, friction } from './movement.js';
import { pressed, consume, dirX, detectTrigger, resolveMove } from './input-map.js';
import { mirror } from './shapes.js';
import { collider } from './hurtbox.js';
import { applyHit } from './hits.js';
import { setForm } from './fighter.js';
import * as entities from './entities.js';
import * as resources from './resources.js';
import * as status from './status.js';
import * as script from './script-api.js';

const GRAB = Object.freeze({
  minHold: 30, maxHold: 120, perPercent: 0.35, mash: 3, pummelEvery: 14,
  pushFrames: 12, pushSpeed: 6, immunity: 10, throwHoldAfter: 10,
});
const COUNTER = Object.freeze({ intangible: 12, attackerHitlag: 20, maxIn: 25 });
const MAX_GOTO = 8;
const MAX_CHAIN = 4;            // else/next hops per start (cycle guard)
const INTANGIBLE_GRANT = 20;    // ungoverned per-grant cap (Governor: perGrant)

const counterMaxHit = () => (CATEGORIES.counter && CATEGORIES.counter.maxHit) || 15;
const isV1Char = (f) => (f.char.version ?? 1) === 1;
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ── def preparation (cached; defs may be frozen) ────────────────────────────
const chargeCache = new WeakMap();
const prepCache = new WeakMap();

export function chargeOf(def) {
  if (def.charge !== undefined) return def.charge;
  let c = chargeCache.get(def);
  if (c === undefined) {
    c = def.category === 'smash' ? { button: 'strong', at: Math.max(1, def.startup - 3), max: COMBAT.smashChargeMax } : null;
    chargeCache.set(def, c);
  }
  return c;
}

/** Timeline split by trigger kind: at (frame → entries), ranges, land, hit. */
function prep(def) {
  let p = prepCache.get(def);
  if (p) return p;
  p = { at: new Map(), ranges: [], land: [], hit: [], any: false };
  for (const e of Array.isArray(def.timeline) ? def.timeline : []) {
    if (!e || typeof e.action !== 'string') continue;
    const when = e.when ?? (e.at != null ? 'at' : e.from != null ? 'range' : null);
    if (when === 'at') { if (!p.at.has(e.at)) p.at.set(e.at, []); p.at.get(e.at).push(e); }
    else if (when === 'range') p.ranges.push(e);
    else if (when === 'land') p.land.push(e);
    else if (when === 'hit') p.hit.push(e);
    else continue;
    p.any = true;
  }
  prepCache.set(def, p);
  return p;
}

// ── generic fallback (§3.5: def = ir.moves[name] ?? generic(t)) ────────────
const genericCache = new Map();
const nn = (v) => (typeof v === 'number' ? v : null);
const HIT_DEFAULTS = {
  kind: 'strike', damage: 0, angle: 0, knockback: 0, growth: 0, setKnockback: null, effect: 'normal', status: null,
  shieldMul: 1, hitlagMul: 1, push: 0, tier: null,
};

function genericTimeline(list) {
  const out = [];
  for (const e of list || []) {
    const key = Object.keys(e).find((k) => k !== 'at' && k !== 'from' && k !== 'to' && k !== 'every');
    if (!key) continue;
    const v = e[key];
    let args;
    if (key === 'release') args = { template: null, hit: { ...HIT_DEFAULTS, ...v } };
    else if (key === 'emit') args = { name: String(v), data: null };
    else if (key === 'sfx') args = { sound: v };
    else args = typeof v === 'object' && v ? { ...v } : { value: v };
    out.push({ when: e.at != null ? 'at' : 'range', at: e.at ?? null, from: e.from ?? null, to: e.to ?? null, every: e.every ?? (e.from != null ? 1 : null), action: key, args });
  }
  return out;
}

/**
 * Runtime action for `trigger` when the character has no move for it (the v1
 * validator output has no grab/pummel/throws/taunt). Frozen, cached per trigger.
 */
export function genericAction(trigger) {
  if (genericCache.has(trigger)) return genericCache.get(trigger);
  const src = genericMove(trigger);
  let def = null;
  if (src) {
    const category = src.category || TRIGGER_CATEGORY[trigger] || 'special';
    const hitboxes = (src.hitboxes || []).map((h, i) => ({
      shape: h.shape || 'circle', ...HIT_DEFAULTS, ...h, group: h.group ?? i, rehit: null, onHit: [], counterScale: false, air: !!h.air,
    }));
    const timeline = genericTimeline(src.timeline);
    const starts = [...hitboxes.map((h) => h.start), ...timeline.filter((e) => e.when === 'at').map((e) => e.at)];
    const startup = starts.length ? Math.min(...starts) : src.duration;
    def = Object.freeze({
      key: trigger, name: src.name || trigger, category, duration: src.duration, hitboxes, timeline,
      velocity: (src.velocity || []).map((v) => ({ start: v.start, end: v.end ?? v.start, vx: nn(v.vx), vy: nn(v.vy), mode: 'set', untilGrounded: false })),
      projectiles: [], intangible: [], armor: [], hurtboxes: [], gravity: [],
      landingLag: category === 'aerial' ? Math.max(10, CATEGORIES.aerial?.minLandingLag ?? 0) : null,
      helpless: trigger === 'upSpecial', oncePerAirtime: trigger === 'sideSpecial',
      cost: null, requires: null, else: null, hold: null, charge: category === 'smash' ? undefined : null, cancels: [], next: null,
      counter: null, onAbsorb: [], throw: null, anim: src.anim ?? null, effect: null, update: null, generic: true, startup,
    });
  }
  genericCache.set(trigger, def);
  return def;
}

function moveDef(f, name) {
  const m = f.char.moves;
  return name != null && m && Object.prototype.hasOwnProperty.call(m, name) ? m[name] : null;
}

/** name → {def, name} through requires/cost → else (≤ 4 hops) and once-per-airtime. */
function gate(f, name, trigger = null) {
  let def = moveDef(f, name) ?? (name === trigger ? genericAction(trigger) : null);
  for (let hops = 0; def; hops++) {
    if (!f.grounded && def.oncePerAirtime && f.air.used.has(name)) return null;
    if (resources.meets(f, def.requires) && resources.canPay(f, def.cost)) return { def, name };
    if (hops >= MAX_CHAIN) return null;
    name = def.else;
    def = moveDef(f, name);
  }
  return null;
}

// ── start / end ─────────────────────────────────────────────────────────────
function stateFor(def, f) {
  const c = def.category;
  if ((c === 'throw' || c === 'pummel') && f.grab && f.grab.role === 'grabbing') return 'grabbing';
  if (c === 'taunt') return 'taunt';
  return 'attack';
}

export function startAction(f, def, { trigger = null, name = null } = {}) {
  if (!def) return null;
  const prev = f.action;
  if (prev) { f.action = null; actionLeft(f, prev); }
  resources.pay(f, def.cost);
  setState(f, stateFor(def, f));
  f.actionSeq = (f.actionSeq | 0) + 1;
  const inst = {
    id: f.actionSeq, def, name: name ?? def.key ?? def.slot ?? trigger, trigger, frame: 0, aerial: !f.grounded,
    hitKeys: new Set(), hitSomething: false, chargeFrames: 0, charging: false,
    holding: false, holdFrames: 0, holdReleased: false, loops: 0, jump: null, landed: false, onHitFired: false,
    counterArmed: false, counterIn: 0, counterMul: 1, steer: null, setVx: -1, setVy: -1,
  };
  f.action = inst;
  f.lastAction = inst;
  if (!f.grounded && (def.oncePerAirtime ?? trigger === 'sideSpecial')) {
    f.air.used.add(inst.name);
    if (trigger === 'sideSpecial') f.usedSideSpecial = true; // v1 flag (ai.js reads it)
  }
  if (f.grounded && def.category !== 'special' && def.category !== 'recovery') f.vx *= 0.5;
  f.game.emit({ type: 'move', id: f.id, slot: inst.name, effect: def.effect, name: inst.name, trigger });
  return inst;
}

/** Switch to another pool move (cancel, next, release, counter.then). */
function switchTo(f, name, trigger) {
  const r = gate(f, name, null);
  if (!r) return null;
  return startAction(f, r.def, { trigger, name: r.name });
}

/** Leave the action without starting `next`: helpless if airborne and helpless, else idle/air. */
export function endAction(f) {
  const a = f.action;
  if (!a) return;
  f.action = null;
  actionLeft(f, a);
  if (f.state === 'grabbing' && f.grab && f.grab.role === 'grabbing') {
    // Pummel done → keep holding. A throw that never released → let go.
    if (a.def.category === 'pummel') return;
    releaseGrab(f, { push: true });
    return;
  }
  const helpless = a.def.helpless ?? a.trigger === 'upSpecial';
  if (helpless && !f.grounded) setState(f, 'helpless');
  else setState(f, f.grounded ? 'idle' : 'air');
}

/** states.setState hook: f.action was cleared (ended, interrupted, or switched). */
export function actionLeft(f, inst) {
  entities.onActionEnd(f, inst);
}

// ── per-frame update ────────────────────────────────────────────────────────
export function updateAction(f) {
  const a = f.action;
  const m = a.def;
  const st = f.stats;
  const inp = f.input;
  const gov = f.game.gov;
  // 1. Charge: the frame freezes while the button is held.
  const ch = chargeOf(m);
  if (ch && a.frame === ch.at && inp[ch.button] && a.chargeFrames < Math.min(ch.max, COMBAT.smashChargeMax)) {
    a.chargeFrames++;
    a.charging = true;
    friction(f);
    if (!f.grounded && !isV1Char(f)) gravity(f, gravityScale(m, a.frame)); // v1 quirk: no gravity while charging
    return;
  }
  a.charging = false;

  // 2. Hold: loop to hold.from while held (≤ max frames); release on let-go.
  let next = a.frame + 1;
  if (a.jump !== null) { next = a.jump; a.jump = null; }
  else if (m.hold) {
    const h = m.hold;
    const len = h.to - h.from + 1;
    const held = !!inp[h.button];
    const inWin = a.frame >= h.from && a.frame <= h.to;
    if (inWin && held && a.frame === h.to && len > 0 && a.holdFrames + len <= h.max) {
      next = h.from;
      a.holdFrames += len;
      a.holding = true;
    } else if (inWin && !a.holdReleased && (!held || a.frame === h.to)) {
      a.holdReleased = true;
      a.holding = false;
      if (typeof h.release === 'string') {
        if (switchTo(f, h.release, a.trigger)) return;
      } else if (typeof h.release === 'number') next = h.release;
    }
  }
  a.frame = next;
  const fr = a.frame;

  // 3. Timeline.
  const p = prep(m);
  if (p.any) {
    const list = p.at.get(fr);
    if (list) for (const e of list) { runEntry(f, a, e, null); if (f.action !== a) return; }
    for (const e of p.ranges) {
      if (fr >= e.from && fr <= e.to && (fr - e.from) % Math.max(1, e.every || 1) === 0) { runEntry(f, a, e, null); if (f.action !== a) return; }
    }
  }

  // 4. Velocity and gravity windows (v1 order and float ops for v1 defs).
  let setVx = a.setVx === fr, setVy = a.setVy === fr;
  for (const v of m.velocity || []) {
    if (fr >= v.start && fr <= v.end) {
      if ((v.untilGrounded && a.landed) || (v.airOnly && f.grounded)) continue;
      if (gov && gov.selfVelocity) {
        const add = v.mode === 'add';
        const nvx = v.vx != null ? (add ? f.vx + v.vx * f.facing : v.vx * f.facing) : f.vx;
        const nvy = v.vy != null ? (add ? f.vy + v.vy : v.vy) : f.vy;
        const r = gov.selfVelocity(f, nvx, nvy, 'velocity') || { vx: nvx, vy: nvy };
        if (v.vx != null) { f.vx = r.vx; setVx = true; }
        if (v.vy != null) { f.vy = r.vy; setVy = true; if (f.vy < 0 && f.grounded) leaveGround(f); }
        continue;
      }
      if (v.mode === 'add') {
        if (v.vx != null) { f.vx += v.vx * f.facing; setVx = true; }
        if (v.vy != null) { f.vy += v.vy; setVy = true; if (f.vy < 0 && f.grounded) leaveGround(f); }
        continue;
      }
      if (v.vx != null) { f.vx = v.vx * f.facing; setVx = true; }
      if (v.vy != null) { f.vy = v.vy; setVy = true; if (v.vy < 0 && f.grounded) leaveGround(f); }
    } else if (fr === v.end + 1 && !f.grounded) {
      f.vx = clampAbs(f.vx, st.airSpeed * 1.1);
    }
  }
  if (m.projectiles) for (const pr of m.projectiles) if (fr === pr.start) entities.spawnProjectile(f, pr);

  if (f.grounded) {
    if (!setVx) friction(f);
  } else {
    if (!setVx) drift(f, dirX(f), m.category === 'aerial' ? 1 : 0.6);
    if (m.category === 'aerial' && inp.down && pressed(f, 'down') && f.vy > -2) { f.fastFall = true; consume(f, 'down'); }
    if (!setVy) gravity(f, gravityScale(m, fr));
  }

  // 5. Cancels.
  if (m.cancels && m.cancels.length && tryCancels(f, a)) return;

  // 6. Move script (queued commands are flushed by game.js after states.update).
  if (typeof m.update === 'function') {
    script.runUpdate(f, m.update);
    if (f.action !== a) return;
  }

  // 7. End check.
  if (a.frame >= m.duration && a.jump === null) {
    if (m.next && moveDef(f, m.next)) {
      const prevState = f.state;
      const nx = gate(f, m.next, null);
      if (nx && (prevState !== 'grabbing' || nx.def.category === 'pummel' || nx.def.category === 'throw')) {
        startAction(f, nx.def, { trigger: a.trigger, name: nx.name });
        return;
      }
    }
    endAction(f);
  }
}

function gravityScale(m, fr) {
  const g = m.gravity;
  if (!g || !g.length) return 1;
  let s = 1;
  for (const w of g) if (fr >= w.from && fr <= w.to) s *= fin(w.scale, 1);
  return Math.max(0.3, Math.min(1.5, s));
}

// ── cancels (§3.6 step 5) ───────────────────────────────────────────────────
function cancelSpecial(f, kind) {
  if (kind === 'jump') {
    if (!pressed(f, 'jump')) return false;
    if (f.grounded) { consume(f, 'jump'); endTo(f, 'jumpsquat'); return true; }
    if (f.jumpsLeft <= 0) return false;
    endTo(f, 'air'); // the buffered press double-jumps next frame (airLogic)
    return true;
  }
  if (kind === 'shield') {
    if (!(pressed(f, 'shield') || f.input.shield)) return false;
    if (f.grounded) { consume(f, 'shield'); endTo(f, 'shield'); return true; }
    if (f.usedAirDodge) return false;
    endTo(f, 'air'); // buffered shield → air dodge next frame
    return true;
  }
  return false;
}

function endTo(f, state) {
  const a = f.action;
  f.action = null;
  if (a) actionLeft(f, a);
  setState(f, state);
}

function tryCancels(f, a) {
  const fr = a.frame;
  for (const c of a.def.cancels) {
    if (fr < c.from || fr > c.to || (c.onHit && !a.hitSomething)) continue;
    const into = Array.isArray(c.into) ? c.into : [];
    if (c.button) {
      if (!pressed(f, c.button)) continue;
      for (const n of into) {
        if ((n === 'jump' || n === 'shield') && cancelSpecial(f, n)) return true;
        const r = moveDef(f, n) ? gate(f, n, null) : resolveMove(f, n);
        if (r) { consume(f, c.button); startAction(f, r.def, { trigger: moveDef(f, n) ? a.trigger : n, name: r.name }); return true; }
      }
      continue;
    }
    if (into.includes('jump') && cancelSpecial(f, 'jump')) return true;
    if (into.includes('shield') && cancelSpecial(f, 'shield')) return true;
    // A buffered trigger that resolves to a listed move (or trigger, or 'any').
    const saved = { ...f.buffer };
    const t = detectTrigger(f);
    if (!t) continue;
    const r = resolveMove(f, t.trigger);
    if (r && (into.includes('any') || into.includes(t.trigger) || into.includes(r.name))) {
      if (t.face) f.facing = t.face;
      startAction(f, r.def, { trigger: t.trigger, name: r.name });
      return true;
    }
    Object.assign(f.buffer, saved); // not allowed: give the presses back
  }
  return false;
}

/** api.cancelInto: only inside a cancels window listing `name` (or 'any'), or into else/next. */
export function cancelInto(f, name, { script: fromScript = false } = {}) { // eslint-disable-line no-unused-vars
  const a = f.action;
  if (!a || !moveDef(f, name)) return false;
  const d = a.def;
  let ok = d.else === name || d.next === name;
  if (!ok && Array.isArray(d.cancels)) {
    for (const c of d.cancels) {
      if (a.frame < c.from || a.frame > c.to || (c.onHit && !a.hitSomething)) continue;
      if (Array.isArray(c.into) && (c.into.includes(name) || c.into.includes('any'))) { ok = true; break; }
    }
  }
  return ok && !!switchTo(f, name, a.trigger);
}

// ── timeline actions (§2.2.9) ───────────────────────────────────────────────
function nearestEnemy(f) {
  let best = null, bd = Infinity;
  for (const o of f.game.fighters) {
    if (o === f || o.eliminated || o.state === 'dead' || o.state === 'respawn') continue;
    const d = Math.hypot(o.x - f.x, o.y - f.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function selfVel(f, vx, vy, src = 'velocity') {
  const gov = f.game.gov;
  if (gov && gov.selfVelocity) return gov.selfVelocity(f, vx, vy, src) || { vx, vy };
  return { vx: clampAbs(vx, 18), vy: Math.max(vy, -17) };
}

function applyVel(f, a, vx, vy, setX, setY) {
  const r = selfVel(f, vx, vy);
  const fr = a ? a.frame : -1;
  if (setX) { f.vx = r.vx; if (a) a.setVx = fr; }
  if (setY) {
    f.vy = r.vy;
    if (a) a.setVy = fr;
    if (f.vy < 0 && f.grounded) leaveGround(f);
  }
}

/**
 * Runs one timeline action for f. `ctx` = {target, hit} for hitbox/onHit lists.
 * Entries are IR-normalized ({action, args}).
 */
function runEntry(f, a, e, ctx) {
  const game = f.game;
  const gov = game.gov;
  const x = e.args || {};
  switch (e.action) {
    case 'spawn':
      entities.spawn(f, x.entity, {
        x: x.x, y: x.y, vx: x.vx, vy: x.vy, count: x.count, spread: x.spread, aimAt: x.aimAt,
        bindToMove: x.bindToMove ? a : null, action: a, slot: a ? a.name : null, tier: a ? a.def.category : null, source: 'action',
      });
      return;
    case 'velocity': {
      if ((x.untilGrounded && a && a.landed) || (x.airOnly && f.grounded)) return;
      const add = x.mode === 'add';
      const vx = x.vx != null ? (add ? f.vx + x.vx * f.facing : x.vx * f.facing) : f.vx;
      const vy = x.vy != null ? (add ? f.vy + x.vy : x.vy) : f.vy;
      applyVel(f, a, vx, vy, x.vx != null, x.vy != null);
      return;
    }
    case 'impulse':
      applyVel(f, a, f.vx + fin(x.vx) * f.facing, f.vy + fin(x.vy), x.vx != null, x.vy != null);
      return;
    case 'steer': {
      if (!a) return;
      const speed = Math.max(0, Math.min(12, fin(x.speed)));
      const turn = Math.max(0, Math.min(0.3, fin(x.turn)));
      if (a.steer === null) a.steer = Math.hypot(f.vx, f.vy) > 0.5 ? Math.atan2(f.vy, f.vx) : (f.facing > 0 ? 0 : Math.PI);
      const sx = dirX(f), sy = (f.input.down ? 1 : 0) - (f.input.up ? 1 : 0);
      if (sx || sy) {
        let d = Math.atan2(sy, sx) - a.steer;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        a.steer += Math.max(-turn, Math.min(turn, d));
      }
      applyVel(f, a, Math.cos(a.steer) * speed, Math.sin(a.steer) * speed, true, true);
      if (Math.abs(f.vx) > 0.5) f.facing = f.vx > 0 ? 1 : -1;
      return;
    }
    case 'teleport': teleport(f, fin(x.dx), fin(x.dy), x.relative === 'world'); return;
    case 'hit': {
      const tpl = f.char.hitboxes && Object.prototype.hasOwnProperty.call(f.char.hitboxes, x.template) ? f.char.hitboxes[x.template] : null;
      if (!tpl || !x.shape) return;
      const frames = Math.max(1, Math.min(20, x.frames | 0 || 1));
      const tier = tpl.tier || (a ? a.def.category : 'special');
      const hb = { ...tpl, ...x.shape, kind: tpl.kind === 'wind' ? 'wind' : 'strike', tier, group: x.group ?? 0, start: 0, end: frames };
      script.addExtraHit(f, hb, { frames, group: x.group ?? 0, slot: a ? a.name : x.template, tier, effect: tpl.effect || (a && a.def.effect) });
      return;
    }
    case 'resource':
      if (x.set != null) resources.set(f, x.name, x.set);
      if (x.add != null) resources.add(f, x.name, x.add);
      return;
    case 'cost': resources.pay(f, x.costs); return;
    case 'form': if (!(f.formCd > 0)) setForm(f, x.form); return;
    case 'status': status.apply(f, x.status, { source: f }); return;
    case 'armor':
      if (gov && gov.armorRequest) gov.armorRequest(f, x.frames, x.threshold);
      return;
    case 'intangible':
      if (gov && gov.intangibleRequest) gov.intangibleRequest(f, x.frames);
      else f.intangibleFrames = Math.max(f.intangibleFrames | 0, Math.min(INTANGIBLE_GRANT, fin(x.frames) | 0));
      return;
    case 'facing':
      if (x.facing === 'turn') f.facing = -f.facing;
      else { const o = (ctx && ctx.target) || nearestEnemy(f); if (o && o.x !== f.x) f.facing = o.x > f.x ? 1 : -1; }
      return;
    case 'release': throwRelease(f, a, x); return;
    case 'endIf': {
      const r = x.resource;
      if ((r && resources.get(f, r.name) < r.below) || (x.grounded && f.grounded) || (x.airborne && !f.grounded)) {
        if (a && f.action === a) endAction(f);
      }
      return;
    }
    case 'goto':
      if (a && a.loops < MAX_GOTO) { a.loops++; a.jump = Math.max(0, x.frame | 0); }
      return;
    case 'emit': {
      let json = null;
      if (x.data != null) { try { json = JSON.stringify(x.data); } catch { json = null; } if (json && json.length > 256) json = null; }
      script.emitFx(f, 'fx', x.name, json);
      return;
    }
    case 'sfx': script.emitFx(f, 'sfx', x.sound); return;
    case 'camera': script.emitFx(f, 'camera', 'camera', null, { shake: x.shake }); return;
    default:
  }
}

function teleport(f, dx, dy, world) {
  if (!world) dx *= f.facing;
  const gov = f.game.gov;
  if (gov && gov.teleportRequest) {
    const g = gov.teleportRequest(f, dx, dy);
    if (!g.ok) return;
    dx = g.dx; dy = g.dy;
  } else {
    const len = Math.hypot(dx, dy);
    if (len > 200) { dx *= 200 / len; dy *= 200 / len; }
  }
  f.x += dx; f.y += dy;
  if (f.grounded && dy < 0) leaveGround(f);
  // Destination inside the main ground → pushed out through the nearest face.
  const g = f.game.stage.ground;
  const col = collider(f);
  const hw = col.w / 2;
  if (!(f.x + hw > g.x1 && f.x - hw < g.x2 && f.y > g.y && f.y - col.h < g.bottom)) return;
  const up = f.y - g.y, down = g.bottom - (f.y - col.h), left = f.x + hw - g.x1, right = g.x2 - (f.x - hw);
  const mn = Math.min(up, down, left, right);
  if (mn === up) f.y = g.y;
  else if (mn === down) f.y = g.bottom + col.h;
  else if (mn === left) f.x = g.x1 - hw;
  else f.x = g.x2 + hw;
}

// ── hit shapes (§3.6.1) ─────────────────────────────────────────────────────
export function activeHitboxes(f) {
  const a = f.action;
  if (!a || a.charging || (f.state !== 'attack' && f.state !== 'grabbing' && f.state !== 'taunt')) return [];
  const out = [];
  const t = a.frame;
  const list = a.def.hitboxes;
  for (let i = 0; i < list.length; i++) {
    let hb = list[i];
    if (t >= hb.start && t <= hb.end) {
      const g = hb.group ?? i;
      const key = hb.rehit ? `${g}:${Math.floor((t - hb.start) / hb.rehit)}` : `${g}`;
      if (hb.counterScale && a.counterIn > 0) hb = counterScaled(a, hb);
      out.push({ hb, shape: mirror(hb, f.facing, f.bodyScale, f.x, f.y), key });
    }
  }
  return out;
}

function counterScaled(a, hb) {
  if (!a.scaled) a.scaled = new Map();
  let s = a.scaled.get(hb);
  if (!s) {
    const dmg = Math.max(0, Math.min(counterMaxHit(), Math.max(fin(hb.damage), a.counterIn * a.counterMul)));
    s = { ...hb, damage: dmg };
    a.scaled.set(hb, s);
  }
  return s;
}

function inWindows(w, fr) {
  if (!w || !w.length) return false;
  if (typeof w[0] === 'number') return fr >= w[0] && fr <= w[1];
  for (const x of w) if (fr >= x[0] && fr <= x[1]) return true;
  return false;
}

/** Action intangible window active (pure; the Governor decides if it is granted). */
export function intangibleAt(f) {
  const a = f.action;
  if (!a || !a.def.intangible) return false;
  return inWindows(a.def.intangible, a.frame);
}

/** Move phase for views/art: 'charge'|'hold'|'startup'|'active'|'recovery' (null = no action). */
export function phaseOf(f) {
  const a = f.action;
  if (!a) return null;
  const d = a.def;
  if (a.charging) return 'charge';
  if (d.hold && a.holding && a.frame >= d.hold.from && a.frame <= d.hold.to) return 'hold';
  const startup = typeof d.startup === 'number' ? d.startup : (d.hitboxes.length ? Math.min(...d.hitboxes.map((h) => h.start)) : d.duration);
  const end = typeof d.activeEnd === 'number' ? d.activeEnd : (d.hitboxes.length ? Math.max(...d.hitboxes.map((h) => h.end)) : -1);
  if (a.frame < startup) return 'startup';
  if (a.frame <= end) return 'active';
  return 'recovery';
}

// ── landing / hit hooks ─────────────────────────────────────────────────────
export function onLand(f) {
  const a = f.action;
  if (!a) return;
  a.landed = true;
  const p = prep(a.def);
  for (const e of p.land) { runEntry(f, a, e, null); if (f.action !== a) return; }
}

/** A strike from f landed on h.target (hits.afterHit; not projectiles). */
export function onHitConnect(f, h) {
  const a = f.action;
  if (!a) return;
  a.hitSomething = true;
  const ctx = { target: h.target, hit: h };
  const lists = h.hb && Array.isArray(h.hb.onHit) ? h.hb.onHit : null;
  if (lists) for (const e of lists) { runEntry(f, a, e, ctx); if (f.action !== a) return; }
  if (!a.onHitFired) {
    a.onHitFired = true;
    for (const e of prep(a.def).hit) { runEntry(f, a, e, ctx); if (f.action !== a) return; }
  }
}

/** One of f's absorb boxes ate entity e (entities.absorb): run the action's onAbsorb list. */
export function onAbsorb(f, e) {
  const a = f.action;
  if (!a || !Array.isArray(a.def.onAbsorb)) return;
  const ctx = { target: null, hit: null, entity: e };
  for (const x of a.def.onAbsorb) { runEntry(f, a, x, ctx); if (f.action !== a) return; }
}

// ── counter (§3.6.3) ────────────────────────────────────────────────────────
/** hits.js asks before a strike applies to f. true = cancelled by f's counter window. */
export function tryCounter(f, h) {
  const game = f.game;
  if (f.counterFrame === game.frame) return true; // already countered this frame: the rest is absorbed too
  const a = f.action;
  const c = a && a.def.counter;
  if (!c || f.state !== 'attack' || a.frame < c.from || a.frame > c.to || a.counterArmed === 'used') return false;
  if (h.kind && h.kind !== 'strike') return false;
  const gov = game.gov;
  if (gov && gov.intangibleRequest) {
    if (!(gov.intangibleRequest(f, COUNTER.intangible, { partial: false }) > 0)) return false; // budget empty: hit lands
  } else {
    f.intangibleFrames = Math.max(f.intangibleFrames | 0, COUNTER.intangible);
  }
  a.counterArmed = 'used';
  f.counterFrame = game.frame;
  const atk = h.attacker;
  if (atk && !h.projectile && !h.entity && !h.extra) atk.hitlag = Math.max(atk.hitlag | 0, COUNTER.attackerHitlag);
  const incoming = Math.max(0, Math.min(COUNTER.maxIn, fin(h.hb && h.hb.damage)));
  game.emit({ type: 'counter', id: f.id, attacker: atk ? atk.id : null, x: h.x, y: h.y, damage: incoming });
  if (atk && atk !== f) f.facing = atk.x >= f.x ? 1 : -1;
  if (c.then) {
    const inst = switchTo(f, c.then, a.trigger);
    if (inst) { inst.counterIn = incoming; inst.counterMul = fin(c.mul, 1.2); }
  }
  return true;
}

// ── grabs and throws (§3.6.2) ───────────────────────────────────────────────
const pendingGrabs = new WeakMap(); // game → [hit]

/** hits.js dispatches `kind:'grab'` hits here; they resolve after all strikes (resolveGrabs). */
export function grabConnect(game, h) {
  let list = pendingGrabs.get(game);
  if (!list) { list = []; pendingGrabs.set(game, list); }
  list.push(h);
}

function grabbable(t, h, game) {
  if (t.eliminated || t.state === 'dead' || t.state === 'respawn' || t.state === 'grabbed') return false;
  if (!t.grounded && !(h.hb && h.hb.air)) return false;
  if ((t.grabImmuneUntil | 0) > game.frame) return false;
  if (game.gov && game.gov.immuneTo && game.gov.immuneTo(t, 'grab')) return false;
  return true;
}

/** End of hits.resolve: grab-vs-grab techs, strike beats grab, first grab wins. */
export function resolveGrabs(game) {
  const list = pendingGrabs.get(game);
  if (!list || !list.length) return;
  pendingGrabs.set(game, []);
  const now = game.frame;
  const techs = new Set();
  for (const h of list) {
    for (const o of list) {
      if (o !== h && o.attacker === h.target && o.target === h.attacker) { techs.add(h.attacker); techs.add(h.target); }
    }
  }
  for (const f of techs) {
    if (f.action && f.state === 'attack') endAction(f);
    f.vx = -f.facing * GRAB.pushSpeed * 0.5;
  }
  if (techs.size) game.emit({ type: 'grabtech', ids: [...techs].map((f) => f.id) });
  for (const h of list) {
    const a = h.attacker, t = h.target;
    if (!a || !t || techs.has(a)) continue;
    if (a.state !== 'attack' || !a.action) continue;
    if (a.noGrab || t.noGrab) continue; // clones/minors never grab or get grabbed
    if (a.lastHitFrame === now || t.lastHitFrame === now) continue; // a strike this frame wins
    if (!grabbable(t, h, game)) continue;
    const want = Math.round(Math.max(GRAB.minHold, Math.min(GRAB.maxHold, GRAB.minHold + GRAB.perPercent * t.percent)));
    let max = want;
    if (game.gov && game.gov.grabRequest) {
      const r = game.gov.grabRequest(a, t, want);
      if (!r || !r.ok) continue;
      max = r.frames;
    }
    connectGrab(game, a, t, h, max);
  }
}

function connectGrab(game, a, t, h, max) {
  const inst = a.action;
  a.action = null;
  if (inst) actionLeft(a, inst);
  if (t.grab) setState(t, t.grounded ? 'idle' : 'air'); // t was holding someone: let them go
  setState(a, 'grabbing');
  const local = ((h.x ?? t.x) - a.x) * a.facing;
  a.grab = { role: 'grabbing', other: t.id, frames: 0, max, holdX: local, at: game.frame, pummelAt: -999, throwing: false };
  const tAct = t.action;
  setState(t, 'grabbed');
  if (tAct) actionLeft(t, tAct);
  t.grab = { role: 'grabbed', other: a.id, frames: 0, max, at: game.frame };
  t.vx = t.vy = t.kx = t.ky = 0;
  t.hitstun = 0;
  a.vx = 0;
  holdVictim(a, t);
  game.emit({ type: 'grab', id: a.id, target: t.id, x: t.x, y: t.y });
}

function holdVictim(a, t) {
  const at = a.action && a.action.def.throw && a.action.def.throw.holdAt;
  const hx = at ? fin(at.x, a.grab.holdX) : a.grab.holdX;
  const hy = at ? (a.grounded ? Math.min(0, fin(at.y)) : fin(at.y)) : 0; // never inside the floor
  t.x = a.x + a.facing * hx;
  t.y = a.y + hy;
  t.vx = t.vy = t.kx = t.ky = 0;
  t.facing = -a.facing;
  t.grounded = a.grounded && hy === 0;
  t.platform = t.grounded ? a.platform : -1;
}

function partner(f) {
  const g = f.grab;
  if (!g || g.other == null) return null;
  const o = f.game.fighter(g.other);
  if (!o || !o.grab || o.grab.other !== f.id) return null;
  if (g.role === 'grabbing' && o.state !== 'grabbed') return null;
  if (g.role === 'grabbed' && o.state !== 'grabbing') return null;
  return o;
}

/** Time-out / mash-out / BREAK release. push: 12 frames of pushback at 6 px/f for both. */
function releaseGrab(a, { push = true, breakOut = false } = {}) {
  const game = a.game;
  const t = partner(a);
  const dir = a.facing;
  a.grab = null;
  if (a.action) { const i = a.action; a.action = null; actionLeft(a, i); }
  if (t) {
    t.grab = null;
    t.grabImmuneUntil = game.frame + GRAB.immunity;
    if (game.gov && game.gov.grabReleased) game.gov.grabReleased(t, GRAB.immunity);
  }
  if (push && !breakOut) {
    a.grab = { role: 'release', other: null, frames: GRAB.pushFrames, vx: -dir * GRAB.pushSpeed };
    a.vx = a.grab.vx;
    if (t) { t.grab = { role: 'release', other: null, frames: GRAB.pushFrames, vx: dir * GRAB.pushSpeed }; t.vx = t.grab.vx; }
  }
  if (!a.grab) setState(a, a.grounded ? 'idle' : 'air');
  if (t && !t.grab) setState(t, t.grounded ? 'idle' : 'air');
  game.emit({ type: 'grabrelease', id: a.id, target: t ? t.id : null });
}

/** states.setState hook: f left 'grabbing'/'grabbed' while f.grab is set → release the partner. */
export function grabLeft(f) {
  const g = f.grab;
  f.grab = null;
  if (!g || g.role === 'release') return;
  const o = f.game.fighter(g.other);
  if (!o || !o.grab || o.grab.other !== f.id) return;
  o.grab = null;
  if (g.role === 'grabbing') {
    o.grabImmuneUntil = f.game.frame + GRAB.immunity;
    if (f.game.gov && f.game.gov.grabReleased) f.game.gov.grabReleased(o, GRAB.immunity);
    if (o.state === 'grabbed') setState(o, o.grounded ? 'idle' : 'air');
  } else if (o.state === 'grabbing') {
    if (o.action && o.action.def.category === 'throw') setState(o, 'attack'); // finish the throw animation
    else setState(o, o.grounded ? 'idle' : 'air');
  }
  f.game.emit({ type: 'grabrelease', id: g.role === 'grabbing' ? f.id : o.id, target: g.role === 'grabbing' ? o.id : f.id });
}

function brokeOut(f, since) {
  const b = f.gov && f.gov.breakNow;
  return typeof b === 'number' && b >= since;
}

/** states.js 'grabbing' / 'grabbed' (ground and air). */
export function updateGrab(f) {
  const g = f.grab;
  if (!g) { setState(f, f.grounded ? 'idle' : 'air'); return; }
  if (g.role === 'release') {
    f.vx = g.vx;
    if (!f.grounded) gravity(f);
    if (--g.frames <= 0) { f.grab = null; setState(f, f.grounded ? 'idle' : 'air'); }
    return;
  }
  if (g.role === 'grabbed') return updateGrabbed(f, g);
  return updateGrabbing(f, g);
}

function updateGrabbing(f, g) {
  const game = f.game;
  const t = partner(f);
  if (!t) {
    f.grab = null;
    if (f.action && f.action.def.category === 'throw') setState(f, 'attack');
    else endTo(f, f.grounded ? 'idle' : 'air');
    return;
  }
  if (brokeOut(t, g.at) || brokeOut(f, g.at)) { releaseGrab(f, { push: false, breakOut: true }); return; }
  const a = f.action;
  const throwing = a && a.def.category === 'throw';
  if (!throwing) g.frames++;
  t.grab.frames = g.frames;
  if (!throwing && g.frames >= g.max) { releaseGrab(f, { push: true }); return; }
  if (a) {
    updateAction(f);
    if (f.grab === g && f.state === 'grabbing') holdVictim(f, t);
    return;
  }
  if (f.grounded) friction(f); else gravity(f);
  // Throws: a direction press (or held after a short delay), relative to facing.
  const inp = f.input, prev = f.prev;
  const edge = (b) => inp[b] && !prev[b];
  const late = g.frames >= GRAB.throwHoldAfter;
  const dx = dirX(f);
  let trig = null;
  if (inp.up && (edge('up') || late)) trig = 'uthrow';
  else if (inp.down && (edge('down') || late)) trig = 'dthrow';
  else if (dx && (edge(dx > 0 ? 'right' : 'left') || late)) trig = dx === f.facing ? 'fthrow' : 'bthrow';
  if (trig) {
    const r = resolveMove(f, trig);
    if (r) { startAction(f, r.def, { trigger: trig, name: r.name }); if (f.grab === g) holdVictim(f, t); return; }
  }
  if (pressed(f, 'attack') && game.frame - g.pummelAt >= GRAB.pummelEvery) {
    const r = resolveMove(f, 'pummel');
    consume(f, 'attack');
    if (r) { g.pummelAt = game.frame; startAction(f, r.def, { trigger: 'pummel', name: r.name }); }
  }
  if (f.grab === g) holdVictim(f, t); // startAction may have released the grab
}

function updateGrabbed(f, g) {
  const a = partner(f);
  if (!a) { f.grab = null; setState(f, f.grounded ? 'idle' : 'air'); return; }
  if (brokeOut(f, g.at)) { releaseGrab(a, { push: false, breakOut: true }); return; }
  // Mash: each new press of any button takes 3 frames off the hold.
  const inp = f.input, prev = f.prev;
  let presses = 0;
  for (const b in inp) if (inp[b] && !prev[b]) presses++;
  const ag = a.grab;
  const throwing = a.action && a.action.def.category === 'throw';
  if (presses && !throwing) {
    ag.frames += GRAB.mash * presses;
    g.frames = ag.frames;
    if (ag.frames >= ag.max) { releaseGrab(a, { push: true }); return; }
  }
  holdVictim(a, f);
}

/** Throw/pummel `release` (§3.6.2): a throw-tier hit on the held victim through the Governor. */
function throwRelease(f, a, x) {
  const t = f.grab && f.grab.role === 'grabbing' ? partner(f) : null;
  if (!t || !a) return;
  const game = f.game;
  const hit = x.hit || (x.template && f.char.hitboxes ? f.char.hitboxes[x.template] : null);
  if (!hit) return;
  const pummel = a.def.category === 'pummel';
  const h = {
    attacker: f, target: t, hb: hit, x: t.x, y: t.y - collider(t).h / 2, dir: f.facing, slot: a.name, effect: hit.effect || a.def.effect,
    charge: 0, tier: hit.tier || (pummel ? 'pummel' : 'throw'), kind: 'throw', key: 'throw',
  };
  if (pummel) { pummelHit(game, h); return; }
  // Throw: the grab ends, then the hit applies (ignores shield/intangibility: the victim is held).
  f.grab = null;
  t.grab = null;
  setState(f, 'attack');
  setState(t, t.grounded ? 'idle' : 'air');
  t.grabImmuneUntil = game.frame + GRAB.immunity;
  if (game.gov && game.gov.grabReleased) game.gov.grabReleased(t, GRAB.immunity);
  applyHit(game, h);
  game.emit({ type: 'throw', id: f.id, target: t.id, name: a.name });
}

/** Pummel damage: no knockback, the grab holds. */
function pummelHit(game, h) {
  const { attacker: f, target: t, hb } = h;
  const gov = game.gov;
  let damage;
  if (gov) {
    const r = gov.applyHit({
      attacker: f, target: t, hb, kind: 'throw', tier: h.tier, stale: 1, chargeFrames: 0, dir: f.facing,
      reflected: false, clone: false, rehit: false, grab: true, di: false,
    });
    damage = r ? r.damage : 0;
  } else {
    damage = Math.round(fin(hb.damage) * 10) / 10;
    t.percent = Math.min(MATCH.maxPercent, t.percent + damage);
  }
  t.hitlag = Math.max(t.hitlag | 0, 4);
  f.damageDealt += damage;
  t.lastHitBy = f.id;
  t.lastHitFrame = game.frame;
  game.emit({
    type: 'hit', attacker: f.id, target: t.id, x: h.x, y: h.y, damage: Math.round(damage * 10) / 10, kb: 0, effect: h.effect,
    angle: 0, dir: h.dir, percent: t.percent, strong: false, gov: [], armored: false, broke: false,
  });
  if (f.action) f.action.hitSomething = true;
  resources.onDamage(f, 'hit', damage);
  resources.onDamage(t, 'hurt', damage);
  script.queueHitEvent(game, { attacker: f, target: t, damage, move: h.slot, entity: null, tier: h.tier, kind: 'throw', x: h.x, y: h.y });
}
