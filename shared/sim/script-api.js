// ─────────────────────────────────────────────────────────────────────────────
// script-api.js — sandboxed character code: views, api, command queue, timing,
// fault isolation (spec §3.12, §5 items 1-2). Owned by WP-I.
//
// Character code runs in exactly five places, all through call() below:
//   behavior.*  run(f, hook, ev)          init tick onHit onHurt onLand onKO onRespawn onFormChange
//   move.update runUpdate(f, fn)          actions.updateAction (WP-F); game.js flushes after
//   entity.think runThink(game, e, fn)    entities.update (WP-G); flushes the owner itself
//   SlotFn      slotFn(f, fn, trigger)    input-map.resolveMove; returns a name or null
//   ai.hint     aiHint(f)                 ai.js (WP-O); cached for 10 frames
// Each call: guard.enter(idx) + clock → fn(view, api, ev) → finally guard.exit + budget.
// Faults: 3 throws, 2 calls > 8 ms, or > 1 ms/tick averaged over 60 ticks → every
// (timing faults are ignored for the first 120 ticks: module load / JIT warm-up / GC)
// script of that fighter (and its entities/clones) is off for the match, and
// {type:'gov', rule:'scriptsDisabled', who} is emitted. Declarative data keeps running.
//
// view (makeView) is frozen and lazy; arrays are rebuilt per access. api (makeApi):
//   immediate  api.res.add/set, api.vars.set, api.evars.set (entity think only)
//   queued     everything else → f.cmdQueue (plain data, sanitized at call time inside
//              the guard) → applied by flush(f) in call order through Governor gates.
//   ≤ 24 queued commands per fighter per frame (extras dropped + gov 'scriptCommands').
// Both are dead once the call returns (stashed api calls are ignored; stale views throw).
// Hooks never receive game, fighter or entity records.
//
// Flush points (§3.2, §2.2.13): step 1 after states.update (move.update commands) and
// after 'tick'; entity think → owner flush; step 4 runQueued (onHit/onHurt, then
// flushAll); init/onLand/onKO/onRespawn/onFormChange flush right after their hook.
//
// Extra hit boxes (api.hit; WP-F timeline `hit` entries should use addExtraHit):
//   f.extraHits = [{id, hb (local shape + hit fields), frames, key, hitKeys:Set, slot,
//   tier, effect}]. hits.collectHits calls collectExtraHits(); runQueued (step 4)
//   decrements `frames` (= hit passes left) and drops expired entries.
//
// Clones / minor fighters (WP-G): set `m.minorOf = ownerFighter`. Minors run move
// update scripts only (no behavior hooks); budgets, faults and rng are the owner's.
// ─────────────────────────────────────────────────────────────────────────────
import { BUTTONS } from '../constants.js';
import { CATEGORIES } from '../balance/rules.js';
import { GOVERNOR, STATUS_CAPS } from '../balance/governor-rules.js';
import guard from './guard.js';
import { mulberry32, hash32, resolveSeed } from './rng.js';
import { mirror, overlapAny, center } from './shapes.js';
import { bodyOf, collider, hurtShapes } from './hurtbox.js';
import { ACTIONABLE, setState } from './states.js';
import { leaveGround } from './physics.js';
import { effectiveStats, setForm } from './fighter.js';
import { clampMods } from './governor.js';
import { isIntangible } from './hits.js';
import * as actions from './actions.js';
import * as entities from './entities.js';
import * as status from './status.js';
import * as resources from './resources.js';

// ── limits (§3.12) ──────────────────────────────────────────────────────────
export const LIMITS = Object.freeze({
  maxThrows: 3, maxCallMs: 8, maxSlowCalls: 2, avgTickMs: 1, avgWindow: 60, timingGrace: 120,
  cmdsPerFrame: 24, fxPerFrame: 8, fxDataBytes: 256, startMoveBuffer: 7,
  formCooldown: 45, formHitlag: 6, scaleRate: 0.02, scaleMin: 0.6, scaleMax: 1.6,
  maxVx: 18, maxRiseVy: 17, teleportDist: 200, statusRange: 220, statusRecent: 60,
  hitFramesMax: 20, maxModSets: 8, hintEvery: 10, flushDepth: 4, nameLen: 32,
  moveHitRehit: 8, freeHitRehit: 120, // api.hit rehit floors: same template → same target (move.update); any hook box → same target (other hooks)
});
// api.hit from hooks other than move.update is refused in these states (onHurt may answer hitstun).
const HIT_DENY = new Set(['hitstun', 'stunned', 'grabbed', 'shieldbreak', 'shield', 'dead', 'respawn']);
const L = LIMITS;

// Hidden per-fighter runtime state (never serialized, never visible to scripts).
const RT = new WeakMap();
const HIT_EVENTS = new WeakMap(); // game → queued hit events for step 4
const STAGE_VIEWS = new WeakMap(); // stage → frozen geometry

function rt(f) {
  let s = RT.get(f);
  if (!s) {
    s = {
      rng: null, cmdFrame: -1, cmdCount: 0, capFrame: -1, fxFrame: -1, fxCount: 0,
      times: new Float64Array(L.avgWindow), tFrame: -1, tSum: 0, slowCalls: 0,
      buffer: null, lastHitOn: new Map(), scaleTarget: null, scaleFrame: -1,
      formAt: -1e9, warned: new Set(), hintFrame: -1e9, hint: null, hitSeq: 0, depth: 0,
      tplHitAt: new Map(), hitDeniedAt: -1e9,
    };
    RT.set(f, s);
  }
  return s;
}

const rootOf = (f) => (f && f.minorOf) || f;
const isMinor = (f) => !!(f && f.minorOf);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const str = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null);
const frameOf = (f) => (f.game ? f.game.frame : 0);

// ── lifecycle ───────────────────────────────────────────────────────────────
export function init(f) {
  f.cmdQueue = [];
  f.scriptsDisabled = false;
  f.scriptFaults = 0;
  f.scriptTime = 0;
}

/**
 * Declarative owner effects from entity lists (form / velocity): queued like api commands and
 * applied at the next flush through the same gates. Not subject to the script command cap.
 */
export function ownerCommand(f, cmd) {
  const r = rootOf(f);
  if (!r || r.eliminated || !r.cmdQueue) return;
  r.cmdQueue.push({ ...cmd, from: 'entity' });
}

/** Respawn (fighter.updateDead): drop per-life script state (scale target, buffered move). */
export function onRespawn(f) {
  const s = rt(f);
  s.scaleTarget = null;
  s.buffer = null;
}

/** Per-fighter script rng: mulberry32(matchSeed ^ hash32(id)); separate from game.rng. */
function rngOf(f) {
  const r = rootOf(f);
  const s = rt(r);
  if (!s.rng) {
    const g = r.game;
    const seed = resolveSeed(g.rules.seed, g.fighters || [{ id: r.id }], g.stage && g.stage.id);
    s.rng = mulberry32((seed ^ hash32(r.id)) >>> 0);
  }
  return s.rng;
}

// ── the guarded call ───────────────────────────────────────────────────────
function emitGov(f, rule, amount, extra) {
  const g = f.game;
  if (!g) return;
  g.emit({ type: 'gov', rule, who: f.id, target: null, amount: Math.round(num(amount) * 10) / 10, ...extra });
  if (g.gov && g.gov.stats) g.gov.stats.events[rule] = (g.gov.stats.events[rule] || 0) + 1;
}

/** Disable every script of f (root) for the rest of the match. */
export function disable(f, reason) {
  const r = rootOf(f);
  if (r.scriptsDisabled) return;
  r.scriptsDisabled = true;
  r.cmdQueue.length = 0;
  rt(r).buffer = null;
  emitGov(r, 'scriptsDisabled', r.scriptFaults, { reason });
}

function account(r, ms, timing) {
  r.scriptTime += ms;
  if (!timing || r.scriptsDisabled) return;
  const fr = frameOf(r);
  if (fr < L.timingGrace) return; // warm-up: no timing faults (owner decision b)
  const s = rt(r);
  if (ms > L.maxCallMs && ++s.slowCalls >= L.maxSlowCalls) { disable(r, 'slow'); return; }
  const w = L.avgWindow;
  if (fr !== s.tFrame) { // advance the 60-tick ring, zeroing skipped ticks
    const gap = s.tFrame < 0 ? w : Math.min(w, fr - s.tFrame);
    for (let i = 1; i <= gap; i++) { const k = (((s.tFrame + i) % w) + w) % w; s.tSum -= s.times[k]; s.times[k] = 0; }
    s.tFrame = fr;
  }
  s.times[((fr % w) + w) % w] += ms;
  s.tSum += ms;
  if (s.tSum > L.avgTickMs * w) disable(r, 'budget');
}

function fault(r, hook, e) {
  // Reading an error may run user getters: do it inside the guard.
  let msg = 'error';
  guard.enter(r.index);
  try { msg = String((e && e.message) || e).slice(0, 200); } catch { /* keep default */ } finally { guard.exit(); }
  r.scriptFaults++;
  if (r.game) r.game.emit({ type: 'scriptError', id: r.id, hook, message: msg, faults: r.scriptFaults });
  if (typeof console !== 'undefined' && r.scriptFaults <= L.maxThrows) console.warn(`[${r.charId}] ${hook} threw (${r.scriptFaults}/${L.maxThrows}): ${msg}`);
  if (r.scriptFaults >= L.maxThrows) disable(r, 'throws');
}

/**
 * Runs character code fn under the guard with the clock and fault isolation.
 * mode: 'api' → fn(view, api, ...args); 'view' → fn(view, ...args).
 * ctx: {kind, entity?, hitTargetId?, contactId?} (engine data, never shown to scripts).
 */
function call(f, fn, ctx, mode, args) {
  const r = rootOf(f);
  if (typeof fn !== 'function' || !r || r.scriptsDisabled || !r.game) return undefined;
  if (!guard.isInstalled()) { try { guard.install(); } catch { /* host froze globals first */ } }
  ctx.dead = false;
  ctx.memo = {};
  const view = makeView(f, ctx);
  const api = mode === 'api' ? makeApi(f, ctx) : null;
  const timing = r.game.rules.scriptTiming !== false;
  let out, err = null, threw = false;
  guard.enter(r.index);
  const t0 = guard.clock();
  try {
    out = mode === 'api' ? fn(view, api, ...args) : fn(view, ...args);
  } catch (e) {
    threw = true; err = e;
  } finally {
    guard.exit();
    ctx.dead = true;
    account(r, guard.clock() - t0, timing);
  }
  if (threw) { fault(r, ctx.kind, err); return undefined; }
  return r.scriptsDisabled ? undefined : out;
}

const IMMEDIATE_FLUSH = new Set(['init', 'onLand', 'onKO', 'onRespawn', 'onFormChange']);

/** behavior[hook](view, api, ev). Commands of init/onLand/onKO/onRespawn/onFormChange apply now. */
export function run(f, hook, ev, ctxExtra) {
  if (isMinor(f)) return;
  const fn = f.char && f.char.behavior ? f.char.behavior[hook] : null;
  if (typeof fn !== 'function') return;
  const arg = ev === undefined ? [] : [freezeData(ev)];
  call(f, fn, { kind: hook, ...ctxExtra }, 'api', arg);
  if (IMMEDIATE_FLUSH.has(hook)) flush(f);
}

/** move.update(view, api) for actions.updateAction. game.js flushes after states.update. */
export function runUpdate(f, fn) { call(f, fn, { kind: 'update' }, 'api', []); }

/**
 * entity.think(view, e, api) for entities.update (WP-G), then flushes the owner.
 * opts.contactId: id of a fighter the entity is touching (allows api.status on it).
 */
export function runThink(game, e, fn, opts = {}) {
  const owner = game.fighters.find((o) => o.id === e.owner) || null;
  if (!owner || typeof fn !== 'function') return;
  const ctx = { kind: 'think', entity: e, contactId: opts.contactId ?? null };
  // think's argument order is (view, e, api): wrap so call() keeps one code path.
  call(owner, (view, api) => fn(view, entityView(e), api), ctx, 'api', []);
  flush(owner);
}

/** SlotFn(view) → move name string, or null (static mapping / generic fallback). */
export function slotFn(f, fn, trigger) {
  const out = call(f, fn, { kind: 'slot' }, 'view', [trigger]);
  return typeof out === 'string' && out.length <= 64 ? out : null;
}

/** ai.hint(view) → frozen {press?, hold?} | null, evaluated at most every 10 frames. */
export function aiHint(f) {
  const fn = f.char && f.char.ai ? f.char.ai.hint : null;
  if (typeof fn !== 'function' || rootOf(f).scriptsDisabled) return null;
  const s = rt(f);
  const fr = frameOf(f);
  if (fr - s.hintFrame < L.hintEvery) return s.hint;
  s.hintFrame = fr;
  const out = call(f, fn, { kind: 'hint' }, 'view', []);
  let h = null;
  if (out && typeof out === 'object') {
    const press = str(out.press), hold = str(out.hold);
    if (press || hold) h = Object.freeze({ press, hold });
  }
  s.hint = h;
  return h;
}

// ── views (§3.12.2) ─────────────────────────────────────────────────────────
function freezeData(v, depth = 0) {
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
  if (depth > 4) return null;
  if (Array.isArray(v)) return Object.freeze(v.map((x) => freezeData(x, depth + 1)));
  const out = {};
  for (const k of Object.keys(v)) out[k] = freezeData(v[k], depth + 1);
  return Object.freeze(out);
}

function statusList(t) {
  const list = Array.isArray(t.statuses) ? t.statuses : [];
  return Object.freeze(list.map((s) => Object.freeze({ name: s.name, frames: num(s.frames), stacks: num(s.stacks, 1) })));
}

function moveView(f) {
  const a = f.action;
  if (!a) return null;
  const d = a.def || {};
  let startup = d.startup, activeEnd = d.activeEnd;
  if (typeof startup !== 'number' || typeof activeEnd !== 'number') {
    const hb = Array.isArray(d.hitboxes) ? d.hitboxes : [];
    startup = hb.length ? Math.min(...hb.map((h) => h.start)) : (d.duration | 0);
    activeEnd = hb.length ? Math.max(...hb.map((h) => h.end)) : -1;
  }
  const t = a.frame;
  let phase;
  if (a.charging) phase = 'charge';
  else if (d.hold && a.holdFrames > 0 && t >= d.hold.from && t <= d.hold.to) phase = 'hold';
  else if (t < startup) phase = 'startup';
  else if (t <= activeEnd) phase = 'active';
  else phase = 'recovery';
  return Object.freeze({
    name: a.name, frame: t, phase, holdFrames: num(a.holdFrames), chargeFrames: num(a.chargeFrames),
    hitSomething: !!a.hitSomething, counterIn: num(a.counterIn),
  });
}

function budgetOf(f) {
  const r = rootOf(f);
  const g = r.game.gov;
  if (g && g.budget) return Object.freeze({ ...g.budget(r) });
  const A = GOVERNOR.air, E = GOVERNOR.entities;
  const live = (r.game.entities || []).filter((e) => e.owner === r.id && entities.alive(e)).length;
  return Object.freeze({
    entities: Math.max(0, E.maxAlive - live), threat: E.maxThreat,
    riseLeft: Math.max(0, A.rise - num(r.air && r.air.rise)), stallLeft: Math.max(0, A.stall - num(r.air && r.air.stall)),
    teleportsLeft: Math.max(0, A.teleports - num(r.air && r.air.teleports)),
    intangibleLeft: GOVERNOR.intangible.budget, armorLeft: GOVERNOR.armor.uptime,
    mitigationLeft: num(GOVERNOR.mitigation && GOVERNOR.mitigation.perStock, 45),
    statusSlotsLeft: Math.max(0, STATUS_CAPS.perTarget - (Array.isArray(r.statuses) ? r.statuses.length : 0)),
  });
}

function meView(f) {
  const b = budgetOf(f);
  return Object.freeze({
    id: f.id, x: f.x, y: f.y, vx: f.vx, vy: f.vy, facing: f.facing, grounded: !!f.grounded,
    state: f.state, stateFrame: f.stateFrame, percent: f.percent, stocks: f.stocks,
    form: f.form || 'base', bodyScale: num(f.bodyScale, 1), move: moveView(f),
    air: Object.freeze({
      riseLeft: b.riseLeft, stallLeft: b.stallLeft, jumpsLeft: num(f.jumpsLeft),
      teleportsLeft: num(b.teleportsLeft), flyFuel: num(f.air && f.air.flyFuel),
    }),
    statuses: statusList(f), control: f.control || null,
  });
}

function enemyView(t) {
  return Object.freeze({
    id: t.id, x: t.x, y: t.y, vx: t.vx, vy: t.vy, facing: t.facing, grounded: !!t.grounded,
    state: t.state, percent: t.percent, statuses: statusList(t), form: t.form || 'base',
  });
}

function entityView(e) {
  return Object.freeze({
    id: e.id, name: e.name ?? e.slot ?? null, x: e.x, y: e.y, vx: num(e.vx), vy: num(e.vy),
    age: num(e.age), life: num(e.life), hp: num(e.hp, -1), hits: num(e.hits), facing: e.facing ?? 1,
    vars: freezeData(e.vars || {}),
  });
}

function stageView(stage) {
  let v = STAGE_VIEWS.get(stage);
  if (!v) {
    v = freezeData({ ground: stage.ground, platforms: stage.platforms || [], blast: stage.blast });
    STAGE_VIEWS.set(stage, v);
  }
  return v;
}

function resNames(f) { return (f.char.tables && f.char.tables.resources) || Object.keys(f.char.resources || {}); }

function enemiesOf(f) {
  const r = rootOf(f);
  return r.game.fighters.filter((t) => t !== r && t !== f && !t.eliminated && t.state !== 'dead');
}

/**
 * Frozen, lazily built read-only view of fighter f (§3.12.2). With a ctx from call(),
 * it goes stale (throws) once that call returns; without one it is always live.
 */
export function makeView(f, ctx = null) {
  // Memoized per call (ctx.memo, invalidated by immediate api calls); uncached without ctx.
  const memo = ctx ? ctx.memo || (ctx.memo = {}) : null;
  const once = (k, build) => (memo ? memo[k] || (memo[k] = build()) : build());
  const live = () => { if (ctx && ctx.dead) throw new TypeError('stale view: views are only valid during the call that received them'); };
  const r = rootOf(f);
  const bi = (b) => BUTTONS.indexOf(b);
  const input = Object.freeze({
    held: (b) => { live(); return !!(f.input && f.input[b]); },
    pressed: (b) => { live(); return !!(f.input && f.input[b] && !(f.prev && f.prev[b])); },
    released: (b) => { live(); return !!(!(f.input && f.input[b]) && f.prev && f.prev[b]); },
    heldFrames: (b) => { live(); const i = bi(b); return i >= 0 && f.heldFrames ? f.heldFrames[i] : 0; },
    dir: () => {
      live();
      const i = f.input || {};
      return Object.freeze({ x: (i.right ? 1 : 0) - (i.left ? 1 : 0), y: (i.down ? 1 : 0) - (i.up ? 1 : 0) });
    },
  });
  return Object.freeze({
    get frame() { live(); return f.game.frame; },
    get me() { live(); return once('me', () => meView(f)); },
    get res() {
      live();
      return once('res', () => { const o = {}; resNames(r).forEach((n, i) => { o[n] = r.res ? r.res[i] : 0; }); return Object.freeze(o); });
    },
    get vars() { live(); return once('vars', () => freezeData(r.vars || {})); },
    input,
    enemies: () => { live(); return Object.freeze(enemiesOf(f).map(enemyView)); },
    nearestEnemy: (from) => {
      live();
      const px = from && typeof from.x === 'number' ? from.x : f.x;
      const py = from && typeof from.y === 'number' ? from.y : f.y;
      let best = null, bd = Infinity;
      for (const t of enemiesOf(f)) { const d = (t.x - px) ** 2 + (t.y - py) ** 2; if (d < bd) { bd = d; best = t; } }
      return best ? enemyView(best) : null;
    },
    entities: (name) => {
      live();
      const list = (r.game.entities || []).filter((e) => e.owner === r.id && entities.alive(e) && (name === undefined || (e.name ?? e.slot) === name));
      return Object.freeze(list.map(entityView));
    },
    get stage() { live(); return stageView(r.game.stage); },
    rng: () => { live(); return rngOf(f)(); },
    budget: () => { live(); return budgetOf(f); },
  });
}

// ── api (§3.12.3) ───────────────────────────────────────────────────────────
function queue(f, ctx, cmd) {
  if (ctx.dead) return;
  const r = rootOf(f);
  if (r.scriptsDisabled) return;
  const s = rt(r);
  const fr = frameOf(r);
  if (s.cmdFrame !== fr) { s.cmdFrame = fr; s.cmdCount = 0; }
  if (++s.cmdCount > L.cmdsPerFrame) {
    if (s.capFrame !== fr) { s.capFrame = fr; emitGov(r, 'scriptCommands', L.cmdsPerFrame); }
    return;
  }
  cmd.from = ctx.kind;
  if (ctx.hitTargetId != null) cmd.hitTargetId = ctx.hitTargetId;
  if (ctx.contactId != null) cmd.contactId = ctx.contactId;
  if (f !== r) cmd.minor = true;
  (f.cmdQueue || r.cmdQueue).push(cmd);
}

const SHAPE_NUM = ['x', 'y', 'r', 'w', 'h', 'x1', 'y1', 'x2', 'y2'];
function cleanShape(s) {
  if (!s || typeof s !== 'object') return null;
  const kind = s.shape === 'rect' || s.shape === 'capsule' ? s.shape : 'circle';
  const out = { shape: kind };
  for (const k of SHAPE_NUM) out[k] = num(s[k], 0);
  if (kind === 'circle' && out.r <= 0) return null;
  if (kind === 'rect' && (out.w <= 0 || out.h <= 0)) return null;
  if (kind === 'capsule' && out.r <= 0) return null;
  return out;
}

/** UTF-8 byte length (no allocation; surrogate pairs count 4). */
function utf8Bytes(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

function cleanJson(data) {
  if (data === undefined || data === null) return { json: null };
  let j;
  try { j = JSON.stringify(data); } catch { return { json: null, truncated: true }; }
  if (typeof j !== 'string') return { json: null };
  if (j.length > L.fxDataBytes || utf8Bytes(j) > L.fxDataBytes) return { json: null, truncated: true }; // the limit is in wire bytes
  return { json: j };
}

/**
 * Api object for one call (§3.12.3). Immediate calls touch only own state; every
 * other call is sanitized now (inside the guard) and queued for flush(f).
 */
export function makeApi(f, ctx = { kind: 'external', dead: false, memo: {} }) {
  const r = rootOf(f);
  const q = (cmd) => queue(f, ctx, cmd);
  const inval = (k) => { if (ctx.memo) ctx.memo[k] = undefined; };
  const res = Object.freeze({
    add: (n, d) => { if (ctx.dead || r.scriptsDisabled || typeof n !== 'string') return; resources.add(r, n, num(d, NaN)); inval('res'); },
    set: (n, v) => { if (ctx.dead || r.scriptsDisabled || typeof n !== 'string') return; resources.set(r, n, num(v, NaN)); inval('res'); },
  });
  const vars = Object.freeze({
    set: (k, v) => {
      if (ctx.dead || r.scriptsDisabled || typeof k !== 'string') return;
      if (typeof v !== 'number' && typeof v !== 'boolean' && typeof v !== 'string') return;
      if (resources.setVar(r, k, v) === false) warnOnce(r, `var:${k}`, 'scriptVar');
      inval('vars');
    },
  });
  const api = {
    res, vars,
    startMove: (name) => { if (str(name)) q({ op: 'startMove', name }); },
    cancelInto: (name) => { if (str(name)) q({ op: 'cancelInto', name }); },
    endMove: () => q({ op: 'endMove' }),
    velocity: (vx, vy, opts) => {
      const mode = opts && opts.mode === 'add' ? 'add' : 'set';
      const x = vx === null || vx === undefined ? null : num(vx, null);
      const y = vy === null || vy === undefined ? null : num(vy, null);
      if (x === null && y === null) return;
      q({ op: 'velocity', vx: x, vy: y, mode });
    },
    impulse: (vx, vy) => q({ op: 'velocity', vx: num(vx), vy: num(vy), mode: 'add' }),
    teleport: (dx, dy) => q({ op: 'teleport', dx: num(dx), dy: num(dy) }),
    spawn: (name, opts) => {
      if (!str(name)) return;
      const o = {};
      if (opts && typeof opts === 'object') {
        for (const k of ['x', 'y', 'worldX', 'worldY', 'vx', 'vy', 'angle', 'facing']) if (typeof opts[k] === 'number' && Number.isFinite(opts[k])) o[k] = opts[k];
        if (typeof opts.target === 'string') o.target = opts.target;
      }
      const c = { op: 'spawn', name, opts: o };
      if (ctx.entity) c.entityId = ctx.entity.id; // think/every spawns originate at the entity
      q(c);
    },
    despawn: (id) => { if (Number.isInteger(id)) q({ op: 'despawn', id }); },
    command: (id, cmd) => {
      if (!Number.isInteger(id) || !cmd || typeof cmd !== 'object') return;
      const c = {};
      if (typeof cmd.target === 'string') c.target = cmd.target;
      if (cmd.moveTo && typeof cmd.moveTo === 'object') c.moveTo = { x: num(cmd.moveTo.x), y: num(cmd.moveTo.y) };
      q({ op: 'command', id, cmd: c });
    },
    hit: (template, shape, opts) => {
      const s = cleanShape(shape);
      if (!str(template) || !s) return;
      const frames = clamp(Math.floor(num(opts && opts.frames, 1)), 1, L.hitFramesMax);
      const group = Math.floor(num(opts && opts.group, 0));
      q({ op: 'hit', template, shape: s, frames, group, ...(ctx.entity ? { entityId: ctx.entity.id } : {}) });
    },
    status: (target, name) => {
      if (!str(name)) return;
      if (target !== 'self' && typeof target !== 'string') return;
      q({ op: 'status', target, name });
    },
    form: (name) => { if (str(name)) q({ op: 'form', name }); },
    setBodyScale: (s) => { if (typeof s === 'number' && Number.isFinite(s)) q({ op: 'scale', s }); },
    setHurtboxes: (set) => { if (set === null || str(set)) q({ op: 'hurtboxes', set }); },
    modify: (key, mods) => {
      if (!str(key) || key in Object.prototype) return; // 'constructor'/'toString' would write to a frozen prototype
      if (mods === null) { q({ op: 'modify', key, mods: null }); return; }
      if (!mods || typeof mods !== 'object') return;
      const m = {};
      for (const k of ['speed', 'jump', 'gravity', 'fallSpeed', 'damageIn', 'damageOut', 'knockbackIn']) if (typeof mods[k] === 'number' && Number.isFinite(mods[k])) m[k] = mods[k];
      q({ op: 'modify', key, mods: m });
    },
    armor: (frames, threshold) => q({ op: 'armor', frames: Math.max(0, Math.floor(num(frames))), threshold: Math.max(0, num(threshold)) }),
    intangible: (frames) => q({ op: 'intangible', frames: Math.max(0, Math.floor(num(frames))) }),
    heal: (amount) => { const a = num(amount); if (a > 0) q({ op: 'heal', amount: a }); },
    emit: (name, data) => { if (str(name)) q({ op: 'fx', name: name.slice(0, L.nameLen), ...cleanJson(data) }); },
    sfx: (name) => { if (str(name)) q({ op: 'sfx', name: name.slice(0, L.nameLen) }); },
    camera: (opts) => q({ op: 'camera', shake: clamp(num(opts && opts.shake), 0, 8) }),
  };
  if (ctx.entity) {
    const e = ctx.entity;
    api.evars = Object.freeze({
      set: (k, v) => {
        if (ctx.dead || r.scriptsDisabled || typeof k !== 'string') return;
        setEntityVar(e, k, v);
      },
    });
  }
  return Object.freeze(api);
}

/** Entity var rule (§3.11 applied to e.vars): declared key, same type, clamps. */
function setEntityVar(e, k, v) {
  if (!e.vars || !Object.prototype.hasOwnProperty.call(e.vars, k)) return false;
  const cur = e.vars[k];
  if (typeof v !== typeof cur) return false;
  if (typeof v === 'number') { if (!Number.isFinite(v)) return false; v = clamp(v, -1e6, 1e6); }
  else if (typeof v === 'string') v = v.slice(0, 24);
  else if (typeof v !== 'boolean') return false;
  e.vars[k] = v;
  return true;
}

function warnOnce(f, key, rule) {
  const s = rt(f);
  if (s.warned.has(key)) return;
  s.warned.add(key);
  emitGov(f, rule, 0, { detail: key.slice(0, 48) });
}

// ── flush: apply queued commands through the gates ──────────────────────────
/** Applies f's queued commands in call order (§3.2 flush points). */
export function flush(f) {
  const r = rootOf(f);
  const s = rt(f);
  stepScale(f);
  if (s.buffer) tryBuffered(f, s);
  if (!f.cmdQueue || !f.cmdQueue.length || s.depth >= L.flushDepth) return;
  const list = f.cmdQueue;
  f.cmdQueue = [];
  s.depth++;
  try {
    for (const c of list) { if (r.scriptsDisabled) break; apply(f, c); }
  } finally { s.depth--; }
}

/** Flushes every fighter in index order. */
export function flushAll(game) { for (const f of game.fighters) flush(f); }

function moveDef(f, name) {
  const m = f.char.moves;
  return m && Object.prototype.hasOwnProperty.call(m, name) ? m[name] : null;
}

const actionable = (f) => ACTIONABLE.has(f.state) && !(f.hitlag > 0) && f.control !== 'stun' && f.control !== 'freeze';

function startMove(f, name) {
  const def = moveDef(f, name);
  if (!def) return true; // unknown: drop
  if (!f.grounded && (def.oncePerAirtime ?? false) && f.air.used.has(name)) return true;
  if (!resources.meets(f, def.requires) || !resources.canPay(f, def.cost)) return true;
  actions.startAction(f, def, { trigger: null, name });
  return true;
}

function tryBuffered(f, s) {
  const b = s.buffer;
  if (frameOf(f) > b.until) { s.buffer = null; return; }
  if (!actionable(f)) return;
  s.buffer = null;
  startMove(f, b.name);
}

function inWindow(c, t) { return t >= num(c.from, 0) && t <= num(c.to, -1); }

function cancelInto(f, name) {
  if (typeof actions.cancelInto === 'function') { actions.cancelInto(f, name, { script: true }); return; }
  const a = f.action;
  if (!a) return;
  const d = a.def || {};
  const def = moveDef(f, name);
  if (!def) return;
  let ok = d.else === name || d.next === name;
  if (!ok && Array.isArray(d.cancels)) {
    for (const c of d.cancels) {
      if (!inWindow(c, a.frame) || (c.onHit && !a.hitSomething)) continue;
      if (Array.isArray(c.into) && (c.into.includes(name) || c.into.includes('any'))) { ok = true; break; }
    }
  }
  if (!ok || !resources.meets(f, def.requires) || !resources.canPay(f, def.cost)) return;
  actions.startAction(f, def, { trigger: a.trigger, name });
}

function teleport(f, dx, dy) {
  const gov = f.game.gov;
  if (gov && gov.teleportRequest) {
    const g = gov.teleportRequest(f, dx * f.facing, dy);
    if (!g.ok) return;
    dx = g.dx; dy = g.dy;
  } else {
    if ((!f.grounded || dy < 0) && f.air.teleports >= GOVERNOR.air.teleports) return;
    const len = Math.hypot(dx, dy);
    if (len > L.teleportDist) { dx *= L.teleportDist / len; dy *= L.teleportDist / len; }
    dx *= f.facing;
    if (!f.grounded || dy < 0) f.air.teleports++;
  }
  f.x += dx; f.y += dy;
  if (f.grounded && dy < 0) {
    leaveGround(f);
    if (f.state === 'idle' || f.state === 'run' || f.state === 'crouch' || f.state === 'land') setState(f, 'air');
  }
  pushOutOfGround(f);
}

/** Destination inside the main ground → pushed out through the nearest face. */
function pushOutOfGround(f) {
  const g = f.game.stage.ground;
  const col = collider(f);
  const hw = col.w / 2;
  if (!(f.x + hw > g.x1 && f.x - hw < g.x2 && f.y > g.y && f.y - col.h < g.bottom)) return;
  const up = f.y - g.y, down = g.bottom - (f.y - col.h), left = f.x + hw - g.x1, right = g.x2 - (f.x - hw);
  const m = Math.min(up, down, left, right);
  if (m === up) f.y = g.y;
  else if (m === down) f.y = g.bottom + col.h;
  else if (m === left) f.x = g.x1 - hw;
  else f.x = g.x2 + hw;
}

function velocity(f, c) {
  const fv = c.vx === null ? null : c.vx * f.facing; // forward-relative, like timeline velocity
  let vx = fv === null ? f.vx : c.mode === 'add' ? f.vx + fv : fv;
  let vy = c.vy === null ? f.vy : c.mode === 'add' ? f.vy + c.vy : c.vy;
  const gov = f.game.gov;
  if (gov && gov.selfVelocity) ({ vx, vy } = gov.selfVelocity(f, vx, vy, 'script'));
  else { vx = clamp(vx, -L.maxVx, L.maxVx); vy = Math.max(vy, -L.maxRiseVy); }
  if (c.vx !== null) f.vx = vx;
  if (c.vy !== null) {
    f.vy = vy;
    if (vy < 0 && f.grounded) {
      leaveGround(f);
      if (f.state === 'idle' || f.state === 'run' || f.state === 'crouch' || f.state === 'land') setState(f, 'air');
    }
  }
}

function formBody(f) {
  const c = f.char;
  const form = f.form || 'base';
  return (form !== 'base' && c.forms && c.forms[form] && c.forms[form].body) || c.body || (c.forms && c.forms.base && c.forms.base.body) || null;
}

function scaleRange(f) {
  const b = formBody(f);
  const sr = b && Array.isArray(b.scaleRange) ? b.scaleRange : [1, 1];
  const lo = clamp(num(sr[0], 1), L.scaleMin, L.scaleMax);
  return [lo, clamp(num(sr[1], 1), lo, L.scaleMax)];
}

/** Moves bodyScale toward the scripted target by ≤ 0.02 per frame (once per frame). */
function stepScale(f) {
  const s = rt(f);
  if (s.scaleTarget === null) return;
  const fr = frameOf(f);
  if (s.scaleFrame === fr) return;
  s.scaleFrame = fr;
  const [lo, hi] = scaleRange(f);
  const target = clamp(s.scaleTarget, lo, hi);
  const cur = num(f.bodyScale, 1);
  const next = cur < target ? Math.min(target, cur + L.scaleRate) : Math.max(target, cur - L.scaleRate);
  if (next !== cur) { f.bodyScale = Math.round(next * 1e6) / 1e6; pushOutOfGround(f); }
  if (f.bodyScale === target) s.scaleTarget = null;
}

/** Reach clamp for api.hit: geometry stays inside the tier's maxReach / maxRadius (§3.12.3). */
function clampReach(f, shape, tier) {
  const cat = CATEGORIES[tier] || CATEGORIES.special;
  const cy = -bodyOf(f).collider.h / 2; // fighter center, body space (unscaled)
  const s = { ...shape };
  const pull = (x, y, rr) => {
    const d = Math.hypot(x, y - cy);
    if (d + rr <= cat.maxReach || d === 0) return [x, y];
    const k = Math.max(0, cat.maxReach - rr) / d;
    return [x * k, cy + (y - cy) * k];
  };
  if (s.shape === 'circle') {
    s.r = clamp(s.r, 1, cat.maxRadius);
    [s.x, s.y] = pull(s.x, s.y, s.r);
  } else if (s.shape === 'capsule') {
    s.r = clamp(s.r, 1, cat.maxRadius);
    [s.x1, s.y1] = pull(s.x1, s.y1, s.r);
    [s.x2, s.y2] = pull(s.x2, s.y2, s.r);
  } else {
    s.w = clamp(s.w, 1, cat.maxRadius * 2);
    s.h = clamp(s.h, 1, cat.maxRadius * 2);
    [s.x, s.y] = pull(s.x, s.y, Math.hypot(s.w, s.h) / 2);
  }
  return s;
}

/**
 * Adds a short-lived hit box (api.hit, timeline `hit`) to f.extraHits.
 * hb: local shape + hit fields. opts: {frames=1, group=0, slot, tier, effect}.
 */
export function addExtraHit(f, hb, opts = {}) {
  const s = rt(f);
  const id = ++s.hitSeq;
  const x = {
    id, hb, frames: Math.max(1, opts.frames | 0 || 1), key: `x${id}:${opts.group | 0}`, hitKeys: new Set(),
    slot: opts.slot || 'hit', tier: opts.tier || 'special', effect: opts.effect || hb.effect || 'normal',
  };
  if (opts.rehit) { x.tpl = opts.free ? '*free' : opts.slot; x.rehit = opts.rehit; } // api.hit: per-target floor (per template / all hook boxes)
  if (opts.world) { x.world = opts.world; x.entity = opts.entity || null; x.grace = 1; } // entity lists: fixed world shape
  f.extraHits.push(x);
}

function scriptHit(f, c) {
  const tpl = f.char.hitboxes && Object.prototype.hasOwnProperty.call(f.char.hitboxes, c.template) ? f.char.hitboxes[c.template] : null;
  if (!tpl) { warnOnce(f, `hit:${c.template}`, 'scriptHit'); return; }
  // Only a move's own update script strikes freely; tick/onHit/onHurt/think boxes are refused while
  // the fighter can't act (onHurt may answer hitstun), and all of them together hit a target at
  // most once per freeHitRehit frames.
  const free = c.from !== 'update';
  if (c.entityId != null) {
    // think: the box sits on the entity (entity tier and caps), hook rehit floor.
    const e = (f.game.entities || []).find((x) => x.id === c.entityId && entities.alive(x));
    if (e) entities.entityHit(f.game, e, rootOf(f), { template: c.template, shape: c.shape, frames: c.frames, group: c.group }, { rehit: L.freeHitRehit, free: true });
    return;
  }
  if (free && HIT_DENY.has(f.state) && !(c.from === 'onHurt' && f.state === 'hitstun')) {
    const s = rt(f);
    if (frameOf(f) - s.hitDeniedAt >= 60) { s.hitDeniedAt = frameOf(f); emitGov(f, 'scriptHit', 0, { detail: f.state }); }
    return;
  }
  const a = f.action;
  // Tier: the current move's category; with no move, special for move-less contexts and utility for
  // hook boxes (an ambient aura/counter-zap: utility per-hit cap and KO floor).
  const tier = (a && a.def && CATEGORIES[a.def.category] && a.def.category) || (free ? 'utility' : 'special');
  const cat = CATEGORIES[tier];
  const shape = clampReach(f, c.shape, tier);
  const kind = tpl.kind === 'wind' ? 'wind' : 'strike'; // template-only damage: no grabs/reflects
  const hb = {
    ...tpl, ...shape, kind, tier,
    damage: clamp(num(tpl.damage, 0), 0, cat.maxHit), group: c.group, start: 0, end: c.frames,
  };
  addExtraHit(f, hb, { frames: c.frames, group: c.group, slot: c.template, tier, effect: tpl.effect || (a && a.def.effect), rehit: free ? L.freeHitRehit : L.moveHitRehit, free });
}

function statusAllowed(f, c, t) {
  if (c.hitTargetId === t.id || c.contactId === t.id) return true;
  const at = rt(f).lastHitOn.get(t.id);
  return at !== undefined && frameOf(f) - at <= L.statusRecent && Math.hypot(t.x - f.x, t.y - f.y) <= L.statusRange;
}

function fxAllowed(f) {
  const s = rt(f);
  const fr = frameOf(f);
  if (s.fxFrame !== fr) { s.fxFrame = fr; s.fxCount = 0; }
  if (++s.fxCount > L.fxPerFrame) { if (s.fxCount === L.fxPerFrame + 1) emitGov(f, 'scriptFx', L.fxPerFrame); return false; }
  return true;
}

/**
 * fx / sfx / camera events with the per-fighter cap (8 per frame). Exported so the
 * timeline (WP-F) shares the cap. data: JSON string (≤ 256 B) or null.
 */
export function emitFx(f, type, name, json = null, extra = {}) {
  if (!fxAllowed(rootOf(f))) return;
  if (type === 'fx') f.game.emit({ type: 'fx', id: f.id, name, data: json ? JSON.parse(json) : null, ...extra });
  else if (type === 'sfx') f.game.emit({ type: 'sfx', id: f.id, name });
  else if (type === 'camera') f.game.emit({ type: 'camera', id: f.id, shake: clamp(num(extra.shake), 0, 8) });
}

function apply(f, c) {
  const game = f.game;
  const gov = game.gov;
  switch (c.op) {
    case 'startMove': {
      if (!moveDef(f, c.name)) { warnOnce(f, `move:${c.name}`, 'scriptMove'); return; }
      if (actionable(f)) startMove(f, c.name);
      else rt(f).buffer = { name: c.name, until: frameOf(f) + L.startMoveBuffer };
      return;
    }
    case 'cancelInto': cancelInto(f, c.name); return;
    case 'endMove': if (f.action) actions.endAction(f); return;
    case 'velocity': velocity(f, c); return;
    case 'teleport': teleport(f, c.dx, c.dy); return;
    case 'spawn': {
      if (c.minor && f.char.entities && f.char.entities[c.name] && f.char.entities[c.name].kind === 'clone') return;
      if (!f.char.entities || !Object.prototype.hasOwnProperty.call(f.char.entities, c.name)) { warnOnce(f, `entity:${c.name}`, 'scriptSpawn'); return; }
      const src = c.entityId != null ? (game.entities || []).find((x) => x.id === c.entityId && entities.alive(x)) : null;
      entities.spawn(f, c.name, src ? { ...c.opts, source: 'script', from: src, facing: c.opts.facing ?? (rootOf(f).facing || 1) } : { ...c.opts, source: 'script' });
      return;
    }
    case 'despawn': case 'command': {
      const r = rootOf(f);
      const e = (game.entities || []).find((x) => x.id === c.id);
      if (!e || e.owner !== r.id || !entities.alive(e)) return;
      if (c.op === 'despawn') entities.despawn(game, e);
      else if (typeof entities.command === 'function') entities.command(game, e, c.cmd);
      return;
    }
    case 'hit': scriptHit(f, c); return;
    case 'status': {
      const t = c.target === 'self' ? f : game.fighters.find((x) => x.id === c.target);
      if (!t || t.eliminated) return;
      if (t !== f && !statusAllowed(rootOf(f), c, t)) { emitGov(f, 'scriptStatus', 0, { detail: c.name }); return; }
      status.apply(t, c.name, { source: rootOf(f) });
      return;
    }
    case 'form': {
      if (isMinor(f)) return;
      const known = c.name === 'base' || (f.char.forms && Object.prototype.hasOwnProperty.call(f.char.forms, c.name));
      if (!known) { warnOnce(f, `form:${c.name}`, 'scriptForm'); return; }
      const s = rt(f);
      if (c.name === f.form || frameOf(f) - s.formAt < L.formCooldown || f.formCd > 0) return;
      if (setForm(f, c.name) !== false) {
        s.formAt = frameOf(f);
        f.hitlag = Math.max(f.hitlag | 0, L.formHitlag);
      }
      return;
    }
    case 'scale': rt(f).scaleTarget = c.s; stepScale(f); return;
    case 'hurtboxes': {
      if (c.set === null) { f.hurtSet = null; return; }
      if (Object.hasOwn(bodyOf(f).sets, c.set)) f.hurtSet = c.set; else warnOnce(f, `hurt:${c.set}`, 'scriptHurtboxes');
      return;
    }
    case 'modify': {
      if (!f.modSets) f.modSets = {};
      if (c.mods === null) delete f.modSets[c.key];
      else {
        if (!(c.key in f.modSets) && Object.keys(f.modSets).length >= L.maxModSets) { warnOnce(f, 'modify:cap', 'scriptModify'); return; }
        f.modSets[c.key] = clampMods(c.mods);
      }
      if (status.refresh) status.refresh(f); // mods + stats + quantized KO table (WP-H)
      else { const m = status.statMods(f); if (m && m !== f.mods) f.mods = m; f.stats = effectiveStats(f); }
      return;
    }
    case 'armor': if (gov && gov.armorRequest) gov.armorRequest(f, c.frames, c.threshold); return;
    case 'intangible': {
      if (gov && gov.intangibleRequest) gov.intangibleRequest(f, c.frames);
      else f.intangibleFrames = Math.max(f.intangibleFrames | 0, Math.min(c.frames, GOVERNOR.intangible.perGrant));
      return;
    }
    case 'heal': if (gov && gov.heal && f.state !== 'hitstun') gov.heal(f, c.amount); return;
    case 'fx': emitFx(f, 'fx', c.name, c.json, c.truncated ? { truncated: true } : {}); return;
    case 'sfx': emitFx(f, 'sfx', c.name); return;
    case 'camera': emitFx(f, 'camera', 'camera', null, { shake: c.shake }); return;
    default:
  }
}

// ── hits: extra boxes (step 3) and hook events (step 4) ─────────────────────
/**
 * hits.collectHits: candidate hits from a's f.extraHits (before a's action boxes).
 * Clones pass opts {root, entity}: their boxes hit as clone-tier projectiles of the owner.
 */
export function collectExtraHits(game, a, alive, out, opts = null) {
  if (a.state === 'respawn' || a.state === 'dead') return;
  const root = (opts && opts.root) || a;
  const tpl = rt(rootOf(a)).tplHitAt;
  const now = frameOf(a);
  for (const x of a.extraHits) {
    if (!(x.frames > 0)) continue;
    x.grace = 0;
    const shape = x.world || mirror(x.hb, a.facing, num(a.bodyScale, 1), a.x, a.y);
    for (const t of alive) {
      if (t === a || t === root || isIntangible(t)) continue;
      const key = `${t.id}:${x.key}`;
      if (x.hitKeys.has(key)) continue;
      const tk = x.rehit ? `${t.id}:${x.tpl}` : null;
      if (tk && tpl.has(tk) && now - tpl.get(tk) < x.rehit) continue;
      if (!overlapAny([shape], hurtShapes(t))) continue;
      x.hitKeys.add(key);
      if (tk) tpl.set(tk, now);
      const c = center(shape);
      const ent = opts ? opts.entity : x.world ? x.entity : null;
      out.push({
        attacker: root, target: t, hb: x.hb, x: c.x, y: c.y, dir: x.world ? (x.entity?.facing || a.facing) : a.facing, slot: x.slot, effect: x.effect,
        charge: 0, tier: opts ? 'clone' : x.tier, kind: x.hb.kind || 'strike', key, extra: true,
        ...(ent || x.world ? { projectile: true, entity: ent } : {}),
      });
    }
  }
}

/** Expire extra boxes (step 4): one pass per frame. Exported for clone minors (entities.js). */
export function expireExtraHits(f) {
  const xs = f.extraHits;
  if (!xs || !xs.length) return;
  if (f.state === 'dead') { xs.length = 0; return; }
  let n = 0;
  for (const x of xs) if (x.grace > 0 ? x.grace-- > 0 : --x.frames > 0) xs[n++] = x; // grace: added after this frame's hit pass
  xs.length = n;
}

/** hits.js records each landed hit: {attacker, target, damage, move, entity, tier, kind, x, y}. */
export function queueHitEvent(game, ev) {
  let list = HIT_EVENTS.get(game);
  if (!list) { list = []; HIT_EVENTS.set(game, list); }
  list.push(ev);
  if (ev.attacker && ev.target) rt(rootOf(ev.attacker)).lastHitOn.set(ev.target.id, game.frame);
}

function hitEv(ev, role) {
  const e = ev.entity;
  return {
    damage: num(ev.damage), granted: num(ev.granted ?? ev.damage), intended: num(ev.intended ?? ev.damage),
    [role === 'hit' ? 'targetId' : 'attackerId']: role === 'hit' ? ev.target.id : (ev.attacker ? ev.attacker.id : null),
    move: ev.move ?? null, entity: e ? (e.name ?? e.slot ?? null) : null, entityId: e ? e.id : null,
    tier: ev.tier ?? null, kind: ev.kind ?? 'strike', x: num(ev.x), y: num(ev.y),
  };
}

/** Step 4 of §3.2: expire extra boxes, onHit/onHurt per queued event (fighters by index), flushAll. */
export function runQueued(game) {
  for (const f of game.fighters) expireExtraHits(f);
  for (const e of game.entities || []) if (e.minor) expireExtraHits(e.minor);
  const list = HIT_EVENTS.get(game);
  if (list && list.length) {
    HIT_EVENTS.set(game, []);
    for (const f of game.fighters) {
      const b = f.char && f.char.behavior;
      if (!b || (typeof b.onHit !== 'function' && typeof b.onHurt !== 'function')) continue;
      for (const ev of list) {
        if (ev.attacker === f && typeof b.onHit === 'function') run(f, 'onHit', hitEv(ev, 'hit'), { hitTargetId: ev.target.id });
        if (ev.target === f && typeof b.onHurt === 'function') run(f, 'onHurt', hitEv(ev, 'hurt'));
      }
    }
  }
  flushAll(game);
}

/** Debug/telemetry: script state of f (no references to live records). */
export function info(f) {
  const r = rootOf(f);
  return { disabled: !!r.scriptsDisabled, faults: r.scriptFaults | 0, timeMs: num(r.scriptTime), queued: (f.cmdQueue || []).length };
}
