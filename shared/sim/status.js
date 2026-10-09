// ─────────────────────────────────────────────────────────────────────────────
// status.js — status effects (spec §3.10, caps §4.2.9). WP-H.
//
//   init(f)                  f.statuses = [], f.mods = neutral, f.modSets = {},
//                            f.control = null, f.controlFrames = 0.
//   apply(target, name, {frames, power, source}) -> bool
//                            def lookup: source's IR statuses → target's → built-ins.
//                            Gated by Governor.statusRequest (caps, DR, immunity).
//   tick(f)                  §3.2 "status.tick": f.formCd countdown, DoT (Governor.applyDot),
//                            heal (Governor.heal), control (stun/freeze → 'stunned'),
//                            expiry, BREAK release, f.mods / f.stats recompute.
//   statMods(f) -> mods      Π status mods (power, stacks) × Π modSets, clamped (§4.2.9).
//   clear(f)                 everything off (KO).
//   controlCode(f) -> 0..5   snapshot `ctl` (0 none, stun freeze root silence confuse).
//
// Instance (f.statuses[i], also read by the Governor and script views):
//   { name, def, source: fighterId|null, frames, total, age, stacks, power }
// Iteration is in list (application) order; deterministic.
// v1 characters never receive statuses: tick is a two-comparison no-op.
// ─────────────────────────────────────────────────────────────────────────────
import { MATCH } from '../constants.js';
import { MOD_RANGES, STATUS_CAPS } from '../balance/governor-rules.js';
import { BUILTIN_STATUSES } from '../char/schema.js';
import { effectiveStats } from './fighter.js';
import { setState } from './states.js';
import { refreshKoTable } from './movement.js';

export const NEUTRAL_MODS = Object.freeze({ speed: 1, jump: 1, gravity: 1, fallSpeed: 1, damageIn: 1, damageOut: 1, knockbackIn: 1 });
const MOD_KEYS = Object.keys(NEUTRAL_MODS);
/** Snapshot codes / priority order for f.control (strongest first). */
export const CONTROL_KINDS = Object.freeze(['stun', 'freeze', 'root', 'silence', 'confuse']);
const CONTROL_PRIORITY = ['freeze', 'stun', 'root', 'silence', 'confuse'];
const STUN_LIKE = new Set(['stun', 'freeze']);
// States a stun/freeze waits behind (it takes over when they end, if frames remain).
const STUN_BLOCKED = new Set(['hitstun', 'dead', 'respawn', 'grabbed', 'grabbing', 'shieldbreak', 'stunned']);
const POWER_MIN = 0.25, POWER_MAX = 2;

const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function init(f) {
  f.statuses = [];
  f.mods = NEUTRAL_MODS;
  f.modSets = {};
  f.control = null;
  f.controlFrames = 0;
}

// Normalized built-ins (for v1 targets/sources whose char has no IR status table).
const BUILTIN = {};
for (const [n, s] of Object.entries(BUILTIN_STATUSES)) BUILTIN[n] = Object.freeze(normDef(s));
function normDef(s) {
  return {
    frames: fin(s.frames, 60), stack: s.stack || 'refresh', maxStacks: Math.max(1, Math.min(3, fin(s.maxStacks, 1) | 0)),
    mods: s.mods || {}, dot: s.dot || null, control: s.control || null, heal: s.heal || null,
    visual: s.visual ?? null, tint: s.tint ?? null, icon: s.icon ?? null,
  };
}

/** StatusDef for `name`: the source character's table, then the target's, then built-ins. */
export function lookup(name, source, target) {
  if (typeof name !== 'string') return null;
  const own = (c) => (c && c.statuses && Object.prototype.hasOwnProperty.call(c.statuses, name) ? c.statuses[name] : null);
  return own(source && source.char) || own(target && target.char) || BUILTIN[name] || null;
}

const idOf = (s) => (s && typeof s === 'object' ? s.id ?? null : s ?? null);

/**
 * Applies a status. `source` is the owning fighter (or its id); null/target itself = self.
 * Returns true when an instance was created or refreshed.
 */
export function apply(target, name, opts = {}) {
  if (!target || !Array.isArray(target.statuses) || target.eliminated) return false;
  if (target.state === 'dead' || target.state === 'respawn') return false;
  const game = target.game;
  const src = opts.source && typeof opts.source === 'object' ? opts.source
    : opts.source != null && game ? game.fighter(opts.source) : null;
  const def = lookup(name, src, target);
  if (!def) {
    if (game) game.emit({ type: 'gov', rule: 'statusUnknown', who: idOf(src), target: target.id, amount: 0 });
    return false;
  }
  const list = target.statuses;
  const existing = list.find((s) => s.name === name);
  const stack = def.stack || 'refresh';
  if (existing && stack === 'ignore') return false;
  const power = clamp(fin(opts.power, 1), POWER_MIN, POWER_MAX);
  let frames = Math.floor(fin(opts.frames ?? def.frames, def.frames));
  const sid = idOf(src);
  const gov = game && game.gov;
  let dot = def.dot, control = def.control;
  if (gov && typeof gov.statusRequest === 'function') {
    const r = gov.statusRequest(src || null, target, name, def, { frames });
    if (!r || !r.ok) return false;
    frames = r.frames;
    if (r.dot !== undefined) dot = r.dot;
    if (r.control !== undefined) control = r.control;
  } else {
    // Ungoverned: still never exceed the hard per-kind frame caps.
    frames = Math.min(frames, STATUS_CAPS.maxFrames);
    if (control && STATUS_CAPS.control[control]) frames = Math.min(frames, STATUS_CAPS.control[control].max);
  }
  if (!(frames > 0)) return false;
  if (dot) dot = { every: Math.max(STATUS_CAPS.dot.minEvery, fin(dot.every, 15) | 0), damage: clamp(fin(dot.damage), 0, STATUS_CAPS.dot.maxPerTick) };
  if (existing) {
    if (stack === 'add') existing.stacks = Math.min(def.maxStacks || 1, existing.stacks + 1);
    existing.frames = Math.max(existing.frames, frames);
    existing.total = existing.frames;
    existing.power = Math.max(existing.power, power);
    existing.dot = dot; existing.control = control;
    if (sid != null) existing.source = sid;
  } else {
    list.push({ name, def, source: sid ?? target.id, frames, total: frames, age: 0, stacks: 1, power, dot, control });
  }
  if (game) game.emit({ type: 'status', target: target.id, name, on: true, frames, by: sid });
  refresh(target);
  return true;
}

/** Removes every instance named `name` (or matching a predicate). Returns the count removed. */
export function remove(f, name) {
  const list = f.statuses;
  if (!list || !list.length) return 0;
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (typeof name === 'function' ? name(s) : s.name === name) {
      list.splice(i, 1); n++;
      if (f.game) f.game.emit({ type: 'status', target: f.id, name: s.name, on: false });
    }
  }
  if (n) refresh(f);
  return n;
}

export function tick(f) {
  if (f.formCd > 0) f.formCd--;
  const list = f.statuses;
  const g = f.gov;
  if (g && g.breakNow !== undefined && g.breakNow !== f.breakSeen) onBreak(f, g.breakNow);
  if (!list.length) {
    if (f.control) refresh(f);
    return;
  }
  const game = f.game;
  const gov = game && game.gov;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    s.age++;
    s.frames--;
    if (s.dot && s.dot.damage > 0 && s.age % s.dot.every === 0) {
      const dmg = s.dot.damage * Math.min(s.stacks, 3) * s.power;
      const src = s.source != null && s.source !== f.id ? game.fighter(s.source) : null;
      let dealt;
      if (gov && typeof gov.applyDot === 'function') dealt = gov.applyDot(src, f, dmg).damage;
      else { dealt = Math.min(STATUS_CAPS.dot.maxPerTick, dmg); f.percent = clamp(f.percent + dealt, 0, MATCH.maxPercent); }
      if (src) src.damageDealt += dealt;
      game.emit({ type: 'dot', id: f.id, by: src ? src.id : null, name: s.name, damage: Math.round(dealt * 10) / 10, percent: f.percent });
    }
    const heal = s.def.heal;
    if (heal && fin(heal.amount) > 0 && s.age % Math.max(1, fin(heal.every, 30) | 0) === 0) {
      const amt = fin(heal.amount) * s.power;
      if (gov && typeof gov.heal === 'function') gov.heal(f, amt);
      else if (f.state !== 'hitstun') f.percent = Math.max(0, f.percent - amt);
    }
  }
  let expired = false;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].frames > 0) continue;
    const s = list.splice(i, 1)[0];
    expired = true;
    game.emit({ type: 'status', target: f.id, name: s.name, on: false });
  }
  if (expired || list.length || f.control) refresh(f);
}

/** Applies a BREAK the Governor declared this frame right away (game.js, after gov.endFrame). */
export function syncBreak(f) {
  const g = f.gov;
  if (g && g.breakNow !== undefined && g.breakNow !== f.breakSeen) onBreak(f, g.breakNow);
}

/** BREAK (§4.2.3): the Governor freed the target — drop control statuses, become actionable. */
function onBreak(f, frame) {
  f.breakSeen = frame;
  const had = f.statuses.some((s) => s.control);
  if (had) remove(f, (s) => !!s.control);
  if (f.state === 'stunned') setState(f, f.grounded ? 'idle' : 'air');
}

/** Recomputes control, f.mods and (when mods changed) f.stats and the KO table. */
export function refresh(f) {
  updateControl(f);
  const m = statMods(f);
  if (m !== f.mods) {
    f.mods = m;
    f.stats = effectiveStats(f);
    refreshKoTable(f);
  }
}

function updateControl(f) {
  let best = null, frames = 0;
  for (const kind of CONTROL_PRIORITY) {
    for (const s of f.statuses) if (s.control === kind && s.frames > frames) { best = kind; frames = s.frames; }
    if (best) break;
  }
  f.control = best;
  f.controlFrames = frames;
  if (best && STUN_LIKE.has(best)) {
    if (!STUN_BLOCKED.has(f.state)) {
      setState(f, 'stunned');
      f.fastFall = false;
    }
  } else if (f.state === 'stunned') {
    setState(f, f.grounded ? 'idle' : 'air');
  }
}

/** Product of all status mods and api.modify sets, clamped per §4.2.9. Returns f.mods if unchanged. */
export function statMods(f) {
  const list = f.statuses || [];
  const sets = f.modSets;
  let setKeys = null;
  if (sets) for (const k in sets) { (setKeys || (setKeys = [])).push(k); }
  if (!list.length && !setKeys) return isNeutral(f.mods) ? f.mods : NEUTRAL_MODS;
  const acc = { speed: 1, jump: 1, gravity: 1, fallSpeed: 1, damageIn: 1, damageOut: 1, knockbackIn: 1 };
  for (const s of list) {
    const mods = s.def.mods;
    if (!mods) continue;
    const k = Math.min(s.stacks, 3) * s.power;
    for (const key of MOD_KEYS) {
      const v = mods[key];
      if (typeof v === 'number' && Number.isFinite(v)) acc[key] *= Math.max(0.05, 1 + (v - 1) * k);
    }
  }
  if (setKeys) {
    setKeys.sort();
    for (const n of setKeys) {
      const mods = sets[n];
      if (!mods) continue;
      for (const key of MOD_KEYS) { const v = mods[key]; if (typeof v === 'number' && Number.isFinite(v)) acc[key] *= v; }
    }
  }
  for (const key of MOD_KEYS) { const r = MOD_RANGES[key]; acc[key] = clamp(Math.round(acc[key] * 1e6) / 1e6, r[0], r[1]); }
  const cur = f.mods;
  if (cur && MOD_KEYS.every((k) => cur[k] === acc[k])) return cur;
  return isNeutral(acc) ? NEUTRAL_MODS : Object.freeze(acc);
}

function isNeutral(m) { return !m || MOD_KEYS.every((k) => m[k] === 1); }

export function clear(f) {
  if (f.statuses.length && f.game) for (const s of f.statuses) f.game.emit({ type: 'status', target: f.id, name: s.name, on: false });
  f.statuses.length = 0;
  f.control = null;
  f.controlFrames = 0;
  if (f.modSets) for (const k in f.modSets) delete f.modSets[k];
  if (f.mods !== NEUTRAL_MODS) {
    f.mods = NEUTRAL_MODS;
    f.stats = effectiveStats(f);
    refreshKoTable(f);
  }
}

/** Snapshot `ctl` code: 0 none, 1 stun, 2 freeze, 3 root, 4 silence, 5 confuse. */
export function controlCode(f) { return f.control ? CONTROL_KINDS.indexOf(f.control) + 1 : 0; }
