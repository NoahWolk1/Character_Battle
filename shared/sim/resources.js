// ─────────────────────────────────────────────────────────────────────────────
// resources.js — per-fighter resources (meters) and validated vars (spec §3.11). WP-H.
//
//   init(f)                   f.res = Float64Array (declared order, ir.tables.resources) at
//                             `start`; f.resSpent = Int32Array (frame of the last spend);
//                             f.vars = copy of initializers; f.soakers (Governor §4.2.6).
//   tick(f)                   §3.2 "resources.tick": regen (after regenDelay, when regenWhen
//                             matches) and decay toward min; clamped to [min, max].
//   index/get/add/set         add/set are immediate (own, non-power state), clamped.
//   canPay/pay/meets          Action cost / requires (§2.2.8).
//   setVar(f, k, v) -> bool   §3.11: declared key, same type, strings ≤ 24, finite numbers
//                             clamped ±1e6, serialized total ≤ 2 KB. Rejections are no-ops.
//   onDamage(f, role, amount) 'hit' | 'hurt': perDamage adds with the governed damage.
//   respawn(f)                resetOnRespawn resources → start; vars → initializers.
// v1 characters have no resources or vars: everything is a no-op / true.
// ─────────────────────────────────────────────────────────────────────────────

export const VAR_LIMITS = Object.freeze({ maxKeys: 32, strLen: 24, absMax: 1e6, bytes: 2048 });
const NEVER = -1e9;
const EMPTY = Object.freeze([]);

const names = (f) => f.char.tables?.resources || (f.char.resources ? Object.keys(f.char.resources) : EMPTY);
const defOf = (f, i) => (f.char.resources || {})[names(f)[i]] || {};
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function init(f) {
  const list = names(f);
  f.res = new Float64Array(list.length);
  f.resSpent = new Int32Array(list.length).fill(NEVER);
  const soakers = [];
  list.forEach((n, i) => {
    const d = f.char.resources[n] || {};
    f.res[i] = clampRes(f, i, fin(d.start, fin(d.max, 0)));
    if (d.soak) soakers.push({ idx: i, fraction: fin(d.soak.fraction), costPerDamage: fin(d.soak.costPerDamage, 1), forms: d.soak.forms || null });
  });
  f.soakers = soakers;
  f.vars = initVars(f);
}

function initVars(f) {
  const out = {};
  const src = f.char.vars;
  if (!src) return out;
  const keys = f.char.tables?.vars || Object.keys(src).sort();
  for (const k of keys) out[k] = src[k];
  return out;
}

export function tick(f) {
  const n = f.res.length;
  if (!n) return;
  const frame = f.game ? f.game.frame : 0;
  for (let i = 0; i < n; i++) {
    const d = defOf(f, i);
    let v = f.res[i];
    const regen = fin(d.regen);
    if (regen && frame - f.resSpent[i] >= fin(d.regenDelay) && regenOk(f, d.regenWhen)) v += regen;
    const decay = fin(d.decay);
    if (decay > 0) { const lo = fin(d.min); v = v > lo ? Math.max(lo, v - decay) : v; }
    f.res[i] = clampRes(f, i, v);
  }
}

function regenOk(f, when) {
  if (!when || when === 'always') return true;
  if (when === 'grounded') return !!f.grounded;
  if (when === 'airborne') return !f.grounded;
  if (when.startsWith('form:')) return f.form === when.slice(5);
  return true;
}

export function index(f, name) {
  const ix = f.char.tables?.index?.resources;
  if (ix) return Object.prototype.hasOwnProperty.call(ix, name) ? ix[name] : -1;
  return names(f).indexOf(name);
}

export function get(f, name) { const i = index(f, name); return i < 0 ? 0 : f.res[i]; }

function clampRes(f, i, v) {
  const d = defOf(f, i);
  return Math.max(fin(d.min, 0), Math.min(fin(d.max, Infinity), v));
}

function spent(f, i) { f.resSpent[i] = f.game ? f.game.frame : 0; }

export function add(f, name, d) {
  const i = index(f, name);
  if (i < 0 || !Number.isFinite(d)) return;
  if (d < 0) spent(f, i);
  f.res[i] = clampRes(f, i, f.res[i] + d);
}

export function set(f, name, v) {
  const i = index(f, name);
  if (i < 0 || !Number.isFinite(v)) return;
  if (v < f.res[i]) spent(f, i);
  f.res[i] = clampRes(f, i, v);
}

export function canPay(f, cost) {
  if (!cost) return true;
  for (const n in cost) { const i = index(f, n); if (i < 0 || f.res[i] < cost[n]) return false; }
  return true;
}

export function pay(f, cost) {
  if (!cost) return;
  for (const n in cost) {
    const i = index(f, n);
    if (i < 0) continue;
    f.res[i] = clampRes(f, i, f.res[i] - fin(cost[n]));
    spent(f, i);
  }
}

export function meets(f, req) {
  if (!req) return true;
  if (req.form && req.form !== f.form) return false;
  if (req.grounded && !f.grounded) return false;
  if (req.airborne && f.grounded) return false;
  if (req.resource) for (const n in req.resource) if (get(f, n) < req.resource[n]) return false;
  if (req.var) for (const k in req.var) if (f.vars[k] !== req.var[k]) return false;
  return true;
}

/** §3.11 vars.set. Returns false (no-op) when rejected; callers emit the warning. */
export function setVar(f, k, v) {
  const init = f.char.vars;
  if (!init || typeof k !== 'string' || !Object.prototype.hasOwnProperty.call(init, k)) return false;
  const t = typeof init[k];
  if (typeof v !== t) return false;
  if (t === 'number') {
    if (!Number.isFinite(v)) return false;
    v = Math.max(-VAR_LIMITS.absMax, Math.min(VAR_LIMITS.absMax, v));
  } else if (t === 'string') {
    if (v.length > VAR_LIMITS.strLen) v = v.slice(0, VAR_LIMITS.strLen);
  } else if (t !== 'boolean') return false;
  const prev = f.vars[k];
  if (prev === v) return true;
  f.vars[k] = v;
  if (varBytes(f.vars) > VAR_LIMITS.bytes) { f.vars[k] = prev; return false; }
  return true;
}

/** Serialized size of a vars object (JSON, keys sorted for determinism). */
export function varBytes(vars) {
  let n = 2;
  for (const k of Object.keys(vars).sort()) n += JSON.stringify(k).length + JSON.stringify(vars[k]).length + 2;
  return n;
}

export function onDamage(f, role, amount) {
  if (!f || !f.res || !f.res.length || !(amount > 0)) return;
  const key = role === 'hit' ? 'onHit' : 'onHurt';
  for (let i = 0; i < f.res.length; i++) {
    const g = defOf(f, i)[key];
    if (!g) continue;
    const d = fin(g.perDamage) * amount;
    if (d) { if (d < 0) spent(f, i); f.res[i] = clampRes(f, i, f.res[i] + d); }
  }
}

export function respawn(f) {
  for (let i = 0; i < f.res.length; i++) {
    const d = defOf(f, i);
    if (d.resetOnRespawn === false) continue;
    f.res[i] = clampRes(f, i, fin(d.start, fin(d.max, 0)));
    f.resSpent[i] = NEVER;
  }
  f.vars = initVars(f);
}

/** {name: value} in declared order (views, HUD, debugging). */
export function snapshot(f) {
  const out = {};
  names(f).forEach((n, i) => { out[n] = f.res[i]; });
  return out;
}
