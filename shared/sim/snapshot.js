// ─────────────────────────────────────────────────────────────────────────────
// snapshot.js — wire serialization of a Game (spec §7). Owned by WP-J.
//
// CONTRACT:
//   snapshot(game) -> object     every v1 key with v1 values/rounding (golden parity
//                                hashes the v1 projection), plus the v2 keys below.
//   roster(game) -> object[]     {id, name, charId, index, cpu, tables}; the server adds
//                                `hash`. `tables` are the name tables snapshot indices use.
//   projectilesV1(game) -> []    v1 projectile records {id, owner, charId, x, y, vx, vy,
//                                r, life, maxLife, style, color, color2, spin, effect}.
//   tablesOf(char) -> tables     {moves, entities, statuses, resources, forms, vars}
//   enforceBudget(snap) -> snap  size caps (≤ 1.5 KB per fighter, ≤ 6 KB total).
//
// Fighter v2 keys (all always present):
//   fm  form index (tables.forms)            r   synced resources, 1 decimal (tables.resources)
//   sv  synced vars {k: v} (tables.vars)     st  [[statusIdx | name, frames, stacks]] (name when
//                                                not in the fighter's own tables.statuses)
//   bs  body scale (2 decimals)              mv  [moveIdx, frame, phase, holdFrames, chargeFrames] | 0
//   ctl 0 | 1..5 (CONTROL order)             gb  [otherId, 0 grabbing | 1 grabbed] | 0
//   ar  1 while armor is active              cb  governor combo counter
//   phase codes: 0 startup, 1 active, 2 recovery, 3 charge, 4 hold.
// Entities (`entities`, every live entity incl. v1 projectiles):
//   {i id, o owner fighter INDEX, t typeIdx (owner's tables.entities, -1 unknown),
//    k kind (ENTITY_KINDS index), x, y int, vx, vy 1 decimal, a angle deg int, g age,
//    l life, h hp|-1, n len|0, f facing, v {≤4 synced vars}}, clones add
//    c: [state, stateFrame, moveIdx, frame, facing, grounded].
//    To fit 4 fighters × 8 entities in 6 KB, default-valued entity keys are OMITTED:
//    a (0), h (-1), n (0), v ({}). Readers use decodeEntity(e) or default them.
// `projectiles` (v1 shape) keeps carrying v1 projectiles for one release; `slot` and
// `moveFrame` stay as well. Budget: custom data (sv, v) is truncated first, then clone
// pose data, then the oldest entities — each truncation is logged once.
// Fighter action data lives in f.action (current ActionInst) and f.lastAction (most
// recent, never cleared) — v1's `moveFrame`/`charge` read from lastAction.
// ─────────────────────────────────────────────────────────────────────────────
import { isIntangiblePure } from './hits.js';

export const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

export const SNAPSHOT_BUDGET = Object.freeze({ total: 6144, fighter: 1536, entityVars: 4 });
export const ENTITY_KIND_CODES = Object.freeze(['projectile', 'minion', 'trap', 'zone', 'beam', 'clone', 'part']);
export const CONTROL_CODES = Object.freeze(['stun', 'freeze', 'root', 'silence', 'confuse']); // ctl = index + 1
export const PHASE_CODES = Object.freeze({ startup: 0, active: 1, recovery: 2, charge: 3, hold: 4 });

// ── Name tables ─────────────────────────────────────────────────────────────
const tableCache = new WeakMap();
const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o).sort() : []);

/** Snapshot name tables for a (validated) character. Cached per character object. */
export function tablesOf(c) {
  if (!c || typeof c !== 'object') return { moves: [], entities: [], statuses: [], resources: [], forms: ['base'], vars: [] };
  let t = tableCache.get(c);
  if (t) return t;
  const T = c.tables || {};
  const resAll = T.resources || Object.keys(c.resources || {});
  const resDefs = c.resources || {};
  const forms = T.forms || ['base', ...keysOf(c.forms).filter((n) => n !== 'base')];
  t = {
    moves: T.moves || keysOf(c.moves),
    entities: T.entities || keysOf(c.entities),
    statuses: T.statuses || keysOf(c.statuses),
    resources: resAll.filter((n) => resDefs[n]?.sync !== false),   // synced only (order of `r`)
    forms,
    vars: T.sync || (Array.isArray(c.sync) ? [...c.sync] : []),     // synced vars only
  };
  t.index = {
    moves: indexMap(t.moves), entities: indexMap(t.entities), statuses: indexMap(t.statuses),
    forms: indexMap(t.forms),
    resAll: indexMap(resAll),
  };
  tableCache.set(c, t);
  return t;
}

function indexMap(list) { const m = new Map(); list.forEach((n, i) => m.set(n, i)); return m; }
const idx = (map, name) => (map.has(name) ? map.get(name) : -1);

// ── Fighter v2 fields ────────────────────────────────────────────────────────
function phaseOf(f, a) {
  if (typeof a.phase === 'string' && a.phase in PHASE_CODES) return PHASE_CODES[a.phase];
  if (a.charging) return 3;
  if (a.holding) return 4;
  const rep = f.char.report?.moves?.[a.name];
  const def = a.def || {};
  const startup = rep?.startup ?? def.startup;
  const activeEnd = rep?.activeEnd ?? (Array.isArray(def.hitboxes) && def.hitboxes.length ? Math.max(...def.hitboxes.map((h) => h.end | 0)) : null);
  if (startup == null) return 0;
  if (a.frame < startup) return 0;
  return activeEnd != null && a.frame <= activeEnd ? 1 : 2;
}

function v2Fields(f, t) {
  const out = {};
  out.fm = Math.max(0, idx(t.index.forms, f.form || 'base'));
  // resources: synced only, in declared order
  const r = [];
  if (f.res && t.resources.length) for (const n of t.resources) { const i = idx(t.index.resAll, n); r.push(i >= 0 ? r1(f.res[i] || 0) : 0); }
  out.r = r;
  const sv = {};
  if (f.vars) for (const k of t.vars) if (k in f.vars) sv[k] = f.vars[k];
  out.sv = sv;
  const st = [];
  if (Array.isArray(f.statuses)) {
    // Index into the target's own table; a status defined by another character (e.g.
    // Nimbus's 'soaked' on Gertie) isn't in it, so it travels by name instead.
    for (const s of f.statuses) { const i = idx(t.index.statuses, s.name); st.push([i >= 0 ? i : String(s.name), s.frames | 0, s.stacks || 1]); }
  }
  out.st = st;
  out.bs = r2(f.bodyScale ?? 1);
  const a = f.action;
  out.mv = a ? [idx(t.index.moves, a.name), a.frame | 0, phaseOf(f, a), a.holdFrames | 0, a.chargeFrames | 0] : 0;
  out.ctl = f.control ? CONTROL_CODES.indexOf(f.control) + 1 : 0;
  out.gb = f.grab ? [f.grab.other, f.grab.role === 'grabbed' ? 1 : 0] : 0;
  const gov = f.game?.gov;
  out.ar = gov && f.gov && typeof gov.activeArmorRaw === 'function' && gov.activeArmorRaw(f) > 0 ? 1 : 0;
  out.cb = f.gov?.chain?.active ? f.gov.chain.n | 0 : 0;
  return out;
}

// ── Snapshot ────────────────────────────────────────────────────────────────
export function snapshot(game) {
  const snap = {
    frame: game.frame,
    phase: game.phase,
    phaseFrame: game.phaseFrame,
    winner: game.winner,
    fighters: game.fighters.map((f) => {
      const a = f.action, la = f.lastAction;
      return {
        id: f.id, x: r1(f.x), y: r1(f.y), vx: r1(f.vx), vy: r1(f.vy), kx: r1(f.kx), ky: r1(f.ky),
        facing: f.facing, state: f.state, stateFrame: f.stateFrame, grounded: f.grounded,
        slot: a ? a.name : null, moveFrame: la ? la.frame : 0, charging: a ? a.charging : false, charge: la ? la.chargeFrames : 0,
        percent: f.percent, stocks: f.stocks, shield: r1(f.shield), intangible: isIntangiblePure(f),
        hitlag: f.hitlag, tumble: f.tumble, dj: f.doubleJumpFlip, eliminated: f.eliminated,
        kos: f.kos, falls: f.falls, damageDealt: Math.round(f.damageDealt), placement: f.placement,
        respawnFrame: f.state === 'respawn' ? f.stateFrame : 0,
        ...v2Fields(f, tablesOf(f.char)),
      };
    }),
    projectiles: projectilesV1(game),
    entities: entitiesOf(game),
  };
  if (!game._snapLog) Object.defineProperty(game, '_snapLog', { value: new Set() });
  return enforceBudget(snap, SNAPSHOT_BUDGET, game._snapLog);
}

const pick = (p, rd, k) => (k in p ? p[k] : rd[k]); // keep v1 nulls exactly
const isV1Projectile = (e) => !e.kind || !!(e.legacy || e.def?.legacy);

export function projectilesV1(game) {
  const out = [];
  for (const p of game.entities) {
    if (!isV1Projectile(p)) continue;
    const rd = p.def?.render || {};
    out.push({
      id: p.id, owner: p.owner, charId: p.charId, x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy),
      r: p.r, life: p.life, maxLife: p.maxLife, style: pick(p, rd, 'style'), color: pick(p, rd, 'color'),
      color2: pick(p, rd, 'color2'), spin: pick(p, rd, 'spin'), effect: p.effect,
    });
  }
  return out;
}

function entitiesOf(game) {
  const out = [];
  for (const e of game.entities) {
    // Art and tables come from the author (a reflected entity keeps its art; owner changes).
    const ai = typeof e.authorIdx === 'number' ? e.authorIdx : e.ownerIdx;
    const owner = typeof ai === 'number' ? game.fighters[ai] : game.fighters.find((f) => f.id === e.owner);
    const t = owner ? tablesOf(owner.char) : null;
    const rec = {
      i: e.id, o: owner ? owner.index : -1, t: t && e.name != null ? idx(t.index.entities, e.name) : -1,
      k: Math.max(0, ENTITY_KIND_CODES.indexOf(e.kind || 'projectile')),
      x: Math.round(e.x), y: Math.round(e.y), vx: r1(e.vx || 0), vy: r1(e.vy || 0),
      g: e.age ?? ((e.maxLife ?? 0) - (e.life ?? 0)), l: Number.isFinite(e.life) ? e.life | 0 : -1, f: e.facing || 1, // -1 = permanent (relay-1 parts)
    };
    const a = Math.round(e.angle || 0);
    if (a) rec.a = a;
    if (typeof e.hp === 'number' && Number.isFinite(e.hp)) rec.h = Math.round(e.hp);
    if (e.len) rec.n = Math.round(e.len);
    const v = syncedEntityVars(e);
    if (v) rec.v = v;
    if (e.kind === 'clone' && e.minor) {
      const m = e.minor, ma = m.action;
      rec.c = [m.state, m.stateFrame | 0, ma && t ? idx(t.index.moves, ma.name) : -1, ma ? ma.frame | 0 : 0, m.facing || 1, m.grounded ? 1 : 0];
    }
    out.push(rec);
  }
  return out;
}

/** Fills the omitted default keys of a wire entity record (returns a new object). */
export function decodeEntity(e) {
  return { a: 0, h: -1, n: 0, v: {}, ...e };
}

function syncedEntityVars(e) {
  const v = e.vars;
  if (!v || typeof v !== 'object') return null;
  const keys = Array.isArray(e.def?.sync) ? e.def.sync : Object.keys(v);
  const out = {};
  let n = 0;
  for (const k of keys) {
    if (n >= SNAPSHOT_BUDGET.entityVars) break;
    if (k in v) { out[k] = v[k]; n++; }
  }
  return n ? out : null;
}

// ── Budget ──────────────────────────────────────────────────────────────────
// Each truncation is logged once per game (enforceBudget's `log` set), else once per process.
const loggedGlobal = new Set();
let logged = loggedGlobal;
function logOnce(key, msg) {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(`snapshot: ${msg}`);
}

/** Cheap upper-bound estimate; avoids JSON.stringify for typical frames. */
function roughSize(snap) {
  let n = 200 + snap.fighters.length * 520 + snap.entities.length * 140 + snap.projectiles.length * 190;
  for (const f of snap.fighters) n += f.st.length * 16 + f.r.length * 8 + (Object.keys(f.sv).length ? 400 : 0);
  for (const e of snap.entities) if (e.v) n += 120;
  return n;
}

const size = (o) => JSON.stringify(o).length;

/** Enforces the §7 caps in place (custom data first). Returns the snapshot. */
export function enforceBudget(snap, budget = SNAPSHOT_BUDGET, log = loggedGlobal) {
  if (roughSize(snap) <= budget.total * 0.8) return snap;
  logged = log;
  try { return truncate(snap, budget); } finally { logged = loggedGlobal; }
}

function truncate(snap, budget) {
  for (const f of snap.fighters) {
    if (size(f) <= budget.fighter) continue;
    if (Object.keys(f.sv).length) { f.sv = {}; logOnce(`sv:${f.id}`, `fighter ${f.id} synced vars dropped (over ${budget.fighter} B)`); }
    if (size(f) > budget.fighter && f.st.length > 8) { f.st = f.st.slice(0, 8); logOnce(`st:${f.id}`, `fighter ${f.id} statuses truncated`); }
  }
  if (size(snap) <= budget.total) return snap;
  for (const e of snap.entities) delete e.v;
  logOnce('ev', 'entity vars dropped (snapshot over budget)');
  if (size(snap) <= budget.total) return snap;
  for (const f of snap.fighters) f.sv = {};
  logOnce('sv', 'synced vars dropped (snapshot over budget)');
  if (size(snap) <= budget.total) return snap;
  for (const e of snap.entities) delete e.c;
  logOnce('c', 'clone pose data dropped (snapshot over budget)');
  let total = size(snap);
  if (total <= budget.total) return snap;
  // Drop the oldest entities (lowest ids) until it fits; v1 projectile copies go with them.
  const drop = new Set();
  const ents = snap.entities;
  let k = 0;
  while (total > budget.total && k < ents.length) {
    drop.add(ents[k].i);
    total -= JSON.stringify(ents[k]).length + 1;
    const p = snap.projectiles.find((q) => q.id === ents[k].i);
    if (p) total -= JSON.stringify(p).length + 1;
    k++;
  }
  snap.entities = ents.filter((e) => !drop.has(e.i));
  snap.projectiles = snap.projectiles.filter((p) => !drop.has(p.id));
  logOnce('ent', `${drop.size} entities omitted (snapshot over budget)`);
  return snap;
}

// ── Roster ──────────────────────────────────────────────────────────────────
export function roster(game) {
  return game.fighters.map((f) => {
    const t = tablesOf(f.char);
    return {
      id: f.id, name: f.name, charId: f.charId, index: f.index, cpu: f.cpu,
      tables: { moves: t.moves, entities: t.entities, statuses: t.statuses, resources: t.resources, forms: t.forms, vars: t.vars },
    };
  });
}
