// ─────────────────────────────────────────────────────────────────────────────
// normalize — any character file (v1 or v2) → a NORMALIZED v2 draft:
// every default filled, every reference checked, every shorthand expanded, so
// the scalers (shared/balance/v2/*) and buildIR (ir.js) see exactly one shape.
//
//   normalize(def, {expectedId}) → { draft, notes, errors }
//
// What it does:   fills defaults (schema.js), resolves form inheritance and
//                 trigger routing, merges hit templates into hitboxes, expands
//                 timeline shorthands, converts v1 projectiles to entities,
//                 inserts generic moves, reports structural errors (E0xx) and
//                 info notes (I0xx, with did-you-mean).
// What it doesn't: clamp or scale anything (W-notes are the validator's job),
//                 run any character code, or mutate its input.
// Unknown fields are kept (in `extra` on the record that had them) and reported.
// ─────────────────────────────────────────────────────────────────────────────
import { META_LIMITS, CATEGORIES } from '../balance/rules.js';
import {
  CHARACTER_FIELDS, BODY_FIELDS, COLLIDER_FIELDS, BODY_ARMOR_FIELDS, STAT_FIELDS, V1_ONLY_STATS, MOVEMENT_MODES, CRAWL_SPEED_DEFAULT,
  RESOURCE_FIELDS, RES_SOAK_FIELDS, RES_HUD_FIELDS, PER_DAMAGE_FIELDS, HIT_FIELDS, HITBOX_FIELDS, SHAPE_FIELDS, SHAPE_KINDS,
  ACTION_FIELDS, VELOCITY_FIELDS, HOLD_FIELDS, CHARGE_FIELDS, CANCEL_FIELDS, COUNTER_FIELDS, REQUIRES_FIELDS, ARMOR_WINDOW_FIELDS,
  HURT_WINDOW_FIELDS, GRAVITY_WINDOW_FIELDS, THROW_FIELDS, TIMELINE_TIMING, TIMELINE_ACTIONS, TIMELINE_ACTION_KEYS,
  STATUS_FIELDS, STATUS_MOD_KEYS, BUILTIN_STATUSES, ENTITY_FIELDS, MOTION_FIELDS, EVERY_FIELDS, FORM_FIELDS, HOOKS, AI_FIELDS,
  TRIGGERS, V1_SLOTS, NEW_TRIGGERS, TRIGGER_CATEGORY, CATEGORY_NAMES, CATEGORY_TIMING_FALLBACK, TIER_NAMES, HIT_KINDS, WIND_DIRS,
  ENTITY_KINDS, MOTION_TYPES, COLLIDE_MODES, CONTROL_KINDS, STACK_MODES, HUD_STYLES, ACTION_BUTTONS, CANCEL_SPECIALS,
  ARCHETYPES, EFFECT_PRESETS, DEFAULT_BODY, CROUCH_HEIGHT, NOTE_CODES,
} from './schema.js';
import { didYouMean } from './suggest.js';
import { genericMove } from './generics.js';
import { isV1, normalizeV1, convertProjectiles } from './normalize-v1.js';

export { isV1 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFn = (v) => typeof v === 'function';
const isStr = (v) => typeof v === 'string';
const int = (v) => Math.round(v);
const keys = (o) => (isObj(o) ? Object.keys(o) : []);

/**
 * Normalize any character module default export.
 * @param {*} def
 * @param {{expectedId?: string}} [opts]
 * @returns {{draft: Draft|null, notes: Note[], errors: Note[]}}
 */
export function normalize(def, opts = {}) {
  if (!isV1(def)) return normalizeV2(def, opts);
  const a = normalizeV1(def, opts);
  if (!a.draft) return a;
  const b = normalizeV2(a.draft, { ...opts, fromV1: true });
  return { draft: b.draft, notes: [...a.notes, ...b.notes], errors: [...a.errors, ...b.errors] };
}

/**
 * Normalize a v2 CharacterDef (or the v2 source produced by normalizeV1).
 * @returns {{draft: Draft|null, notes: Note[], errors: Note[]}}
 */
export function normalizeV2(def, opts = {}) {
  const ctx = makeCtx();
  if (!isObj(def)) {
    ctx.err('E003', '', 'the character module must `export default` an object (use export default defineCharacter({...})).');
    return { draft: null, notes: ctx.notes, errors: ctx.errors };
  }
  let draft = null;
  try {
    if (reservedNames(def, ctx)) return { draft: null, notes: ctx.notes, errors: ctx.errors };
    draft = normalizeDef(def, opts, ctx);
  } catch (e) {
    // Getters/proxies on the def that throw count as "throw at load time".
    ctx.err('E004', '', `reading the character threw: ${e && e.message ? e.message : String(e)}`);
    draft = null;
  }
  return { draft, notes: ctx.notes, errors: ctx.errors };
}

// Author-named maps whose keys must not shadow Object.prototype (lookups use plain objects).
const RESERVED = new Set(Object.getOwnPropertyNames(Object.prototype));
const NAMED_MAPS = ['moves', 'hitboxes', 'entities', 'statuses', 'resources', 'vars', 'forms', 'slots'];
function reservedNames(def, ctx) {
  let bad = false;
  const scan = (obj, path) => {
    if (!isObj(obj)) return;
    for (const k of Object.keys(obj)) {
      if (RESERVED.has(k)) { ctx.err('E018', `${path}.${k}`, `${path}.${k}: "${k}" is a reserved JavaScript name and can't be used as a name.`); bad = true; }
    }
  };
  for (const m of NAMED_MAPS) scan(def[m], m);
  if (isObj(def.forms)) for (const f of Object.keys(def.forms)) if (isObj(def.forms[f])) scan(def.forms[f].slots, `forms.${f}.slots`);
  return bad;
}

// ── Notes ───────────────────────────────────────────────────────────────────

/**
 * @typedef {{code: string, severity: 'error'|'warn'|'info', path: string, why: string, fix?: string,
 *   from?: *, to?: *, rule?: string, suggest?: string|null}} Note
 */
function makeCtx() {
  const notes = [];
  const errors = [];
  const mk = (code, path, why, extra) => {
    const n = { code, severity: NOTE_CODES[code].severity, path, why, fix: NOTE_CODES[code].fix, ...extra };
    if (n.suggest === undefined || n.suggest === null) delete n.suggest;
    else if (!/Did you mean/.test(n.why)) n.why += ` Did you mean "${n.suggest}"?`;
    return n;
  };
  return {
    notes, errors,
    note: (code, path, why, extra = {}) => { notes.push(mk(code, path, why, extra)); },
    err: (code, path, why, extra = {}) => { errors.push(mk(code, path, why, extra)); },
  };
}

/** Report unknown keys of `src` (vs `known`), return them as an `extra` object (or undefined). */
function unknownKeys(src, known, path, ctx, { skip = [] } = {}) {
  const extra = {};
  let any = false;
  const list = Array.isArray(known) ? known : Object.keys(known);
  for (const k of Object.keys(src)) {
    if (list.includes(k) || skip.includes(k)) continue;
    extra[k] = src[k];
    any = true;
    ctx.note('I001', join(path, k), `${join(path, k)} isn't a known field (kept, not used by the engine).`, { suggest: didYouMean(k, list) });
  }
  return any ? extra : undefined;
}
const join = (path, k) => (path ? `${path}.${k}` : k);

/** E015: find functions inside a data subtree. */
function noFns(v, path, ctx, seen = new Set(), depth = 0) {
  if (isFn(v)) { ctx.err('E015', path, `${path || 'value'} is a function, but data is required here.`); return; }
  if (v === null || typeof v !== 'object' || seen.has(v) || depth > 24) return;
  seen.add(v);
  if (Array.isArray(v)) v.forEach((x, i) => noFns(x, `${path}[${i}]`, ctx, seen, depth + 1));
  else for (const k of Object.keys(v)) noFns(v[k], join(path, k), ctx, seen, depth + 1);
}
function fnOrNull(v, path, ctx) {
  if (v === undefined || v === null) return null;
  if (isFn(v)) return v;
  ctx.err('E015', path, `${path} must be a function.`);
  return null;
}

// ── Small field readers ────────────────────────────────────────────────────
function numOr(v, d, path, ctx, { round = false } = {}) {
  if (isNum(v)) return round ? int(v) : v;
  if (v !== undefined && v !== null) ctx.note('I004', path, `${path} should be a number — using ${d}.`, { from: String(v), to: d });
  return d;
}
function boolOr(v, d, path, ctx) {
  if (typeof v === 'boolean') return v;
  if (v !== undefined && v !== null) ctx.note('I004', path, `${path} should be true or false — using ${d}.`, { to: d });
  return d;
}
function strOr(v, d, path, ctx) {
  if (isStr(v)) return v;
  if (v !== undefined && v !== null) ctx.note('I004', path, `${path} should be a string — using ${JSON.stringify(d)}.`, { to: d });
  return d;
}
function enumOr(v, values, d, path, ctx) {
  if (values.includes(v)) return v;
  if (v !== undefined && v !== null) {
    ctx.note('I004', path, `${path} "${v}" isn't one of ${values.join(', ')} — using ${JSON.stringify(d)}.`, { from: v, to: d, suggest: isStr(v) ? didYouMean(v, values) : null });
  }
  return d;
}
function listOr(v, path, ctx) {
  if (Array.isArray(v)) return v;
  if (v !== undefined && v !== null) ctx.note('I004', path, `${path} should be a list — ignored.`);
  return [];
}
function objOr(v, path, ctx) {
  if (isObj(v)) return v;
  if (v !== undefined && v !== null) ctx.note('I004', path, `${path} should be an object — ignored.`);
  return null;
}
/** JSON-safe deep copy of presentation data (render, emit data); null if it can't be serialized (cycles, BigInt). */
const copyData = (v) => {
  if (v === undefined) return null;
  if (v === null || typeof v !== 'object') return typeof v === 'bigint' || isFn(v) ? null : v;
  try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
};

// ── Shapes ──────────────────────────────────────────────────────────────────
export const SHAPE_KEYS = ['shape', 'x', 'y', 'r', 'w', 'h', 'x1', 'y1', 'x2', 'y2'];

/**
 * Normalize a Shape. `def` provides geometry defaults (e.g. v1 hitbox x/y/r).
 * @returns {{shape: 'circle', x, y, r} | {shape: 'capsule', x1, y1, x2, y2, r} | {shape: 'rect', x, y, w, h}}
 */
export function normShape(s, path, ctx, def = {}) {
  if (!isObj(s)) {
    ctx.note('I004', path, `${path} should be a shape — using a circle r ${def.r ?? 20}.`);
    s = {};
  }
  let kind = s.shape;
  if (!SHAPE_KINDS.includes(kind)) {
    const inferred = 'x1' in s || 'x2' in s ? 'capsule' : 'w' in s || 'h' in s ? 'rect' : 'circle';
    if (kind !== undefined) ctx.note('I004', `${path}.shape`, `${path}.shape "${kind}" isn't circle, capsule or rect — using ${inferred}.`, { suggest: isStr(kind) ? didYouMean(kind, SHAPE_KINDS) : null });
    kind = inferred;
  }
  const g = (k, d) => {
    const fallback = def[k] ?? SHAPE_FIELDS[kind][k].default ?? d;
    if (isNum(s[k])) return s[k];
    if (s[k] !== undefined) ctx.note('I004', `${path}.${k}`, `${path}.${k} should be a number — using ${fallback}.`);
    else if (['r', 'w', 'h'].includes(k) && def[k] === undefined) ctx.note('I004', `${path}.${k}`, `${path} has no ${k} — using ${fallback}.`, { to: fallback });
    return fallback;
  };
  if (kind === 'capsule') return { shape: 'capsule', x1: g('x1'), y1: g('y1'), x2: g('x2'), y2: g('y2'), r: g('r') };
  if (kind === 'rect') return { shape: 'rect', x: g('x'), y: g('y'), w: g('w'), h: g('h') };
  return { shape: 'circle', x: g('x'), y: g('y'), r: g('r') };
}
function normShapes(list, path, ctx) {
  return listOr(list, path, ctx).map((s, i) => {
    const P = `${path}[${i}]`;
    if (isObj(s)) unknownKeys(s, SHAPE_KEYS, P, ctx);
    return normShape(s, P, ctx);
  });
}

/** Body-space AABB of shapes, or null. */
export function shapesAABB(shapes) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const s of shapes || []) {
    let a, b, c, d;
    if (s.shape === 'capsule') { a = Math.min(s.x1, s.x2) - s.r; c = Math.max(s.x1, s.x2) + s.r; b = Math.min(s.y1, s.y2) - s.r; d = Math.max(s.y1, s.y2) + s.r; }
    else if (s.shape === 'rect') { a = s.x - s.w / 2; c = s.x + s.w / 2; b = s.y - s.h / 2; d = s.y + s.h / 2; }
    else { a = s.x - s.r; c = s.x + s.r; b = s.y - s.r; d = s.y + s.r; }
    x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d);
  }
  return Number.isFinite(x1) ? { x1, y1, x2, y2 } : null;
}

// ── Main ────────────────────────────────────────────────────────────────────
function normalizeDef(def, opts, ctx) {
  const fromV1 = !!opts.fromV1;
  if (def.version !== 2 && def.version !== undefined && def.version !== 1) {
    ctx.note('I004', 'version', `version ${JSON.stringify(def.version)} isn't 1 or 2 — reading the file as v2.`);
  }
  const extra = unknownKeys(def, CHARACTER_FIELDS, '', ctx, { skip: fromV1 ? ['legacy'] : [] });

  // Meta
  const id = def.id ?? opts.expectedId;
  if (!isStr(id) || !META_LIMITS.idPattern.test(id)) {
    ctx.err('E001', 'id', `id ${JSON.stringify(id)} must be lowercase letters/digits/dashes, 2–24 chars, starting with a letter.`);
  } else if (opts.expectedId && id !== opts.expectedId) {
    ctx.err('E001', 'id', `id "${id}" must match its folder name "${opts.expectedId}".`);
  }
  const name = isStr(def.name) && def.name.trim() ? def.name.trim() : null;
  if (!name) ctx.err('E002', 'name', 'name is missing.');
  const author = strOr(def.author, '', 'author', ctx);
  const description = strOr(def.description, '', 'description', ctx);
  const archetype = enumOr(def.archetype, ARCHETYPES, 'allrounder', 'archetype', ctx);

  // Data-only subtrees must not hold functions (E015).
  for (const k of ['body', 'stats', 'movement', 'resources', 'vars', 'sync', 'hitboxes', 'statuses', 'startForm']) noFns(def[k], k, ctx);

  // Pool names first: routing and references need them.
  let srcMoves = {};
  if (isFn(def.moves)) ctx.err('E015', 'moves', 'moves must be an object of move definitions, not a function.');
  else if (isObj(def.moves)) srcMoves = def.moves;
  else if (def.moves !== undefined && def.moves !== null) ctx.note('I004', 'moves', 'moves should be an object — ignored.');

  // v1-style `projectiles` (v1 files and v2 files alike) → auto entities + spawn entries.
  const srcEntities = { ...(isObj(def.entities) ? def.entities : {}) };
  const projSpawns = {};
  const baseBodySrc = isObj(def.body) ? def.body : {};
  const centerGuess = -(guessColliderH(baseBodySrc) / 2);
  for (const [k, m] of Object.entries(srcMoves)) {
    if (!isObj(m) || m.projectiles === undefined) continue;
    const effect = isStr(m.effect) ? m.effect : null;
    const conv = convertProjectiles(k, m.projectiles, { effect, centerY: centerGuess, path: `moves.${k}` });
    for (const n of conv.notes) ctx.notes.push(n);
    Object.assign(srcEntities, conv.entities);
    projSpawns[k] = conv.spawns;
  }

  const ref = {
    moves: new Set(Object.keys(srcMoves)),
    entities: new Set(Object.keys(srcEntities)),
    templates: isObj(def.hitboxes) ? def.hitboxes : {},
    statuses: new Set([...Object.keys(BUILTIN_STATUSES), ...keys(def.statuses)]),
    resources: new Set(keys(def.resources)),
    vars: new Set(keys(def.vars)),
    forms: new Set(['base', ...keys(def.forms)]),
    hurtSets: new Set(['default', 'crouch', 'air', ...keys(baseBodySrc.hurtboxes)]),
  };
  for (const fdef of Object.values(isObj(def.forms) ? def.forms : {})) if (isObj(fdef?.body?.hurtboxes)) for (const s of Object.keys(fdef.body.hurtboxes)) ref.hurtSets.add(s);
  const refNote = (kind, name, path, list) => ctx.note('I005', path, `${path}: unknown ${kind} "${name}".`, { suggest: isStr(name) ? didYouMean(name, [...list]) : null });

  // Templates, statuses, resources, vars, sync
  const hitboxes = {};
  for (const [k, t] of Object.entries(ref.templates)) {
    if (!isObj(t)) { ctx.note('I004', `hitboxes.${k}`, `hitboxes.${k} should be an object — ignored.`); continue; }
    const P = `hitboxes.${k}`;
    const ex = unknownKeys(t, HIT_FIELDS, P, ctx);
    hitboxes[k] = normHit(t, P, ctx, { effect: null, ref, refNote });
    if (ex) hitboxes[k].extra = ex;
  }
  const statuses = {};
  for (const [k, s] of Object.entries(isObj(def.statuses) ? def.statuses : {})) {
    if (BUILTIN_STATUSES[k]) ctx.note('I008', `statuses.${k}`, `statuses.${k} replaces the built-in "${k}" status.`);
    statuses[k] = normStatus(s, `statuses.${k}`, ctx);
  }
  const resources = {};
  for (const [k, r] of Object.entries(isObj(def.resources) ? def.resources : {})) resources[k] = normResource(r, k, `resources.${k}`, ctx, ref, refNote);
  const vars = {};
  for (const [k, v] of Object.entries(isObj(def.vars) ? def.vars : {})) {
    if ((isNum(v)) || typeof v === 'boolean' || isStr(v)) vars[k] = v;
    else if (!isFn(v)) ctx.err('E016', `vars.${k}`, `vars.${k} must be a finite number, boolean or string (got ${v === null ? 'null' : typeof v === 'number' ? String(v) : typeof v}).`);
  }
  const sync = [];
  for (const [i, v] of listOr(def.sync, 'sync', ctx).entries()) {
    if (!isStr(v)) { ctx.note('I004', `sync[${i}]`, `sync[${i}] should be a var name — ignored.`); continue; }
    if (!ref.vars.has(v)) refNote('var', v, `sync[${i}]`, ref.vars);
    else if (!sync.includes(v)) sync.push(v);
  }

  // Forms: base + declared, fully resolved (inheritance) — routing below.
  const formOrder = ['base'];
  const forms = {};
  const baseStats = normStats(def.stats, null, 'stats', ctx);
  const baseBody = normBody(def.body, null, 'body', ctx);
  forms.base = {
    stats: baseStats,
    body: baseBody.body,
    movement: normMovement(def.movement, null, baseStats, 'movement', ctx),
    armor: baseBody.armor,
    art: 'base',
  };
  const srcForms = isObj(def.forms) ? def.forms : {};
  if (def.forms !== undefined && !isObj(def.forms)) ctx.note('I004', 'forms', 'forms should be an object — ignored.');
  for (const [fname, fsrc] of Object.entries(srcForms)) {
    const P = `forms.${fname}`;
    if (fname === 'base') { ctx.note('I004', P, 'forms.base is implicit (the top-level definition) — ignored.'); continue; }
    if (!isObj(fsrc)) { ctx.note('I004', P, `${P} should be an object — ignored.`); ref.forms.delete(fname); continue; }
    for (const k of ['stats', 'body', 'movement', 'armor', 'art']) noFns(fsrc[k], `${P}.${k}`, ctx);
    const ex = unknownKeys(fsrc, FORM_FIELDS, P, ctx);
    const stats = normStats(fsrc.stats, baseStats, `${P}.stats`, ctx);
    const body = fsrc.body !== undefined ? normBody(fsrc.body, forms.base.body, `${P}.body`, ctx) : { body: copyData(forms.base.body), armor: null };
    let armor = forms.base.armor;
    if (body.armor) armor = body.armor;
    if (fsrc.armor !== undefined) armor = normArmor(fsrc.armor, `${P}.armor`, ctx);
    formOrder.push(fname);
    forms[fname] = {
      stats, body: body.body, movement: normMovement(fsrc.movement, forms.base.movement, stats, `${P}.movement`, ctx),
      armor, art: strOr(fsrc.art, fname, `${P}.art`, ctx),
    };
    if (ex) forms[fname].extra = ex;
  }
  let startForm = 'base';
  if (def.startForm !== undefined) {
    if (isStr(def.startForm) && ref.forms.has(def.startForm)) startForm = def.startForm;
    else ctx.err('E011', 'startForm', `startForm "${def.startForm}" isn't a form.`, { suggest: isStr(def.startForm) ? didYouMean(def.startForm, [...ref.forms]) : null });
  }

  // Routing: form.slots[t] → base slots[t] → t; missing identity targets → generic moves.
  const routing = resolveRouting(def, srcForms, formOrder, ref, ctx);
  for (const f of formOrder) {
    forms[f].slots = routing.slots[f]; forms[f].slotFns = routing.slotFns[f];
    // Slot functions: the move names they can return (string literals in their source) are routed too.
    const cands = {};
    for (const [t, fn] of Object.entries(routing.slotFns[f])) { const c = slotCandidates(fn, ref.moves); if (c.length) cands[t] = c; }
    forms[f].slotMoves = cands;
  }
  const generics = [];
  for (const f of formOrder) {
    for (const t of TRIGGERS) {
      const n = forms[f].slots[t];
      if (ref.moves.has(n) || generics.includes(n)) continue;
      if (n === t && genericMove(t)) generics.push(t);
    }
  }
  // A slot function covers its trigger (the generic is only its null fallback): no I002.
  const missingV1 = generics.filter((t) => V1_SLOTS.includes(t) && !formOrder.every((f) => forms[f].slotFns[t]));
  for (const t of missingV1) ctx.note('I002', `moves.${t}`, `moves.${t} missing — using a generic move.`, { suggest: didYouMean(t, [...ref.moves]) });
  const missingNew = generics.filter((t) => NEW_TRIGGERS.includes(t));
  if (missingNew.length) ctx.note('I003', 'moves', `generic moves used for: ${missingNew.join(', ')}.`);

  // Category / helpless / oncePerAirtime defaults come from the triggers that route to each move.
  const routedFrom = {};
  for (const f of formOrder) {
    for (const t of TRIGGERS) {
      const n = forms[f].slots[t];
      (routedFrom[n] ||= []).push(t);
      for (const c of forms[f].slotMoves[t] || []) if (!(routedFrom[c] ||= []).includes(t)) routedFrom[c].push(t);
    }
  }
  const centerY = -forms.base.body.collider.h / 2;

  // Entities (need templates/entities/statuses for references)
  const entities = {};
  for (const [k, e] of Object.entries(srcEntities)) entities[k] = normEntity(e, k, `entities.${k}`, ctx, ref, refNote);

  // Moves
  const moves = {};
  const mctx = { ref, refNote, centerY, routedFrom };
  for (const [k, m] of Object.entries(srcMoves)) {
    const P = `moves.${k}`;
    if (isFn(m)) { ctx.err('E015', P, `${P} is a function, but a move must be an object.`); continue; }
    if (!isObj(m)) { ctx.err('E017', P, `${P} must be an object with a duration.`); continue; }
    const src = projSpawns[k] ? { ...m, timeline: [...(Array.isArray(m.timeline) ? m.timeline : []), ...projSpawns[k]] } : m;
    moves[k] = normAction(src, k, P, ctx, mctx);
  }
  for (const t of generics) {
    ref.moves.add(t);
    const silent = makeCtx();
    moves[t] = normAction(genericMove(t), t, `moves.${t}`, silent, mctx);
    moves[t].generic = true;
  }

  // Reachability (info only: scripts may still startMove anything)
  const reach = new Set(Object.keys(routedFrom));
  for (const a of Object.values(moves)) {
    for (const n of [a.else, a.next, isStr(a.hold?.release) ? a.hold.release : null, a.counter?.then]) if (n) reach.add(n);
    for (const c of a.cancels) for (const n of c.into) reach.add(n);
  }
  for (const k of Object.keys(moves)) {
    if (!reach.has(k)) ctx.note('I006', `moves.${k}`, `moves.${k} isn't routed from any trigger or referenced by another move (only scripts can start it).`);
  }

  // Behavior, AI
  const behavior = {};
  const bsrc = objOr(def.behavior, 'behavior', ctx) || {};
  const bextra = unknownKeys(bsrc, HOOKS, 'behavior', ctx);
  for (const h of HOOKS) behavior[h] = fnOrNull(bsrc[h], `behavior.${h}`, ctx);
  if (bextra) behavior.extra = bextra;
  const ai = normAI(def.ai, ctx, ref, refNote, formOrder);

  /** @type {Draft} */
  const draft = {
    version: 2,
    sourceVersion: fromV1 ? 1 : 2,
    id: isStr(id) ? id : null,
    name: name ?? (isStr(id) ? id : ''),
    author, description, archetype, startForm,
    formOrder, forms,
    moves, hitboxes, entities, statuses, resources, vars, sync, behavior, ai,
    generics,
    art: def.art === undefined ? null : def.art,
    legacy: fromV1 && isObj(def.legacy) ? def.legacy : null,
  };
  if (extra) draft.extra = extra;
  return draft;
}

function guessColliderH(body) {
  if (isObj(body.collider) && isNum(body.collider.h)) return body.collider.h;
  const def = body.hurtboxes?.default;
  if (Array.isArray(def)) {
    const box = shapesAABB(def.filter(isObj).map((s) => normShape(s, '', makeCtx())));
    if (box) return Math.max(1, -box.y1);
  }
  return DEFAULT_BODY.h;
}

// ── Stats, body, movement ───────────────────────────────────────────────────
function normStats(src, inherit, path, ctx) {
  const out = {};
  const s = objOr(src, path, ctx) || {};
  for (const k of Object.keys(s)) {
    if (STAT_FIELDS[k]) continue;
    if (V1_ONLY_STATS.includes(k)) ctx.note('I001', `${path}.${k}`, `${path}.${k} is v1 only — in v2 use body.collider / body.hurtboxes (kept, not used).`, { fix: 'move the size into body: { collider: { w, h } }.' });
    else ctx.note('I001', `${path}.${k}`, `${path}.${k} isn't a stat the engine uses (kept, not used).`, { suggest: didYouMean(k, Object.keys(STAT_FIELDS)) });
  }
  for (const [k, spec] of Object.entries(STAT_FIELDS)) {
    const d = inherit ? inherit[k] : spec.default;
    out[k] = numOr(s[k], d, `${path}.${k}`, ctx);
  }
  return out;
}

function normArmor(src, path, ctx) {
  if (src === null || src === undefined || src === false) return null;
  if (isNum(src)) return { threshold: src };
  const a = objOr(src, path, ctx);
  if (!a) return null;
  unknownKeys(a, BODY_ARMOR_FIELDS, path, ctx);
  return { threshold: numOr(a.threshold, 0, `${path}.threshold`, ctx) };
}

function normBody(src, inherit, path, ctx) {
  const b = objOr(src, path, ctx) || {};
  const extra = unknownKeys(b, BODY_FIELDS, path, ctx);
  const hurtboxes = {};
  const hsrc = objOr(b.hurtboxes, `${path}.hurtboxes`, ctx) || {};
  for (const [set, list] of Object.entries(hsrc)) hurtboxes[set] = normShapes(list, `${path}.hurtboxes.${set}`, ctx);
  let collider = null;
  if (b.collider !== undefined) {
    const c = objOr(b.collider, `${path}.collider`, ctx);
    if (c) {
      unknownKeys(c, COLLIDER_FIELDS, `${path}.collider`, ctx);
      if (isNum(c.w) && isNum(c.h)) collider = { w: c.w, h: c.h };
      else ctx.note('I004', `${path}.collider`, `${path}.collider needs numeric w and h — derived from the hurtboxes instead.`);
    }
  }
  if (!collider && hurtboxes.default?.length) {
    const box = shapesAABB(hurtboxes.default);
    collider = { w: Math.max(1, Math.round(box.x2 - box.x1)), h: Math.max(1, Math.round(-box.y1)) };
  }
  if (!collider) collider = inherit ? { ...inherit.collider } : { ...DEFAULT_BODY };
  if (!hurtboxes.default?.length) {
    hurtboxes.default = inherit && !b.collider ? copyData(inherit.hurtboxes.default) : [{ shape: 'rect', x: 0, y: -collider.h / 2, w: collider.w, h: collider.h }];
  }
  if (!hurtboxes.crouch) {
    const ch = collider.h * CROUCH_HEIGHT;
    hurtboxes.crouch = inherit && !b.collider && !hsrc.default ? copyData(inherit.hurtboxes.crouch) : [{ shape: 'rect', x: 0, y: -ch / 2, w: collider.w, h: ch }];
  }
  let scaleRange = inherit ? [...inherit.scaleRange] : [1, 1];
  if (b.scaleRange !== undefined) {
    if (Array.isArray(b.scaleRange) && isNum(b.scaleRange[0]) && isNum(b.scaleRange[1])) scaleRange = [Math.min(b.scaleRange[0], b.scaleRange[1]), Math.max(b.scaleRange[0], b.scaleRange[1])];
    else if (isNum(b.scaleRange)) scaleRange = [b.scaleRange, b.scaleRange];
    else ctx.note('I004', `${path}.scaleRange`, `${path}.scaleRange should be [min, max] — using [${scaleRange}].`);
  }
  const body = { collider, hurtboxes, scaleRange };
  if (extra) body.extra = extra;
  return { body, armor: b.armor !== undefined ? normArmor(b.armor, `${path}.armor`, ctx) : null };
}

function normMovement(src, inherit, stats, path, ctx) {
  const out = {};
  if (inherit) for (const [m, p] of Object.entries(inherit)) out[m] = { ...p };
  const s = objOr(src, path, ctx) || {};
  for (const [mode, val] of Object.entries(s)) {
    const P = `${path}.${mode}`;
    const spec = MOVEMENT_MODES[mode];
    if (!spec) { ctx.note('I001', P, `${P} isn't a movement mode (kept, not used). Modes: ${Object.keys(MOVEMENT_MODES).join(', ')}.`, { suggest: didYouMean(mode, Object.keys(MOVEMENT_MODES)) }); continue; }
    if (val === null || val === false) { delete out[mode]; continue; }
    const v = val === true ? {} : objOr(val, P, ctx);
    if (!v) continue;
    unknownKeys(v, spec.params, P, ctx);
    const params = {};
    for (const [k, ps] of Object.entries(spec.params)) {
      const inh = out[mode]?.[k];
      let d = inh ?? ps.default;
      if (mode === 'crawl' && k === 'speed' && d === undefined) d = Math.round(stats.runSpeed * CRAWL_SPEED_DEFAULT * 100) / 100;
      if (ps.type === 'enum') params[k] = enumOr(v[k], ps.values, d, `${P}.${k}`, ctx);
      else if (ps.type === 'bool') params[k] = boolOr(v[k], d, `${P}.${k}`, ctx);
      else params[k] = numOr(v[k], d, `${P}.${k}`, ctx, { round: ps.type === 'int' });
    }
    out[mode] = params;
  }
  return out;
}

// ── Resources, statuses ─────────────────────────────────────────────────────
function normResource(src, name, path, ctx, ref, refNote) {
  const r = objOr(src, path, ctx) || {};
  const extra = unknownKeys(r, RESOURCE_FIELDS, path, ctx);
  let max = r.max;
  if (!isNum(max)) { ctx.note('I004', `${path}.max`, `${path}.max is missing — using 100.`, { to: 100 }); max = 100; }
  const perDamage = (v, P) => {
    if (v === undefined || v === null) return null;
    if (isNum(v)) return { perDamage: v };
    const o = objOr(v, P, ctx);
    if (!o) return null;
    unknownKeys(o, PER_DAMAGE_FIELDS, P, ctx);
    return { perDamage: numOr(o.perDamage, 0, `${P}.perDamage`, ctx) };
  };
  const formList = (v, P) => {
    if (v === undefined || v === null) return null;
    return listOr(v, P, ctx).filter((f, i) => {
      if (isStr(f) && ref.forms.has(f)) return true;
      refNote('form', f, `${P}[${i}]`, ref.forms);
      return false;
    });
  };
  let soak = null;
  if (r.soak !== undefined && r.soak !== null) {
    const o = objOr(r.soak, `${path}.soak`, ctx);
    if (o) {
      unknownKeys(o, RES_SOAK_FIELDS, `${path}.soak`, ctx);
      soak = { fraction: numOr(o.fraction, 0.25, `${path}.soak.fraction`, ctx), costPerDamage: numOr(o.costPerDamage, 1, `${path}.soak.costPerDamage`, ctx), forms: formList(o.forms, `${path}.soak.forms`) };
    }
  }
  const hsrc = r.hud === undefined ? {} : objOr(r.hud, `${path}.hud`, ctx) || {};
  if (r.hud !== undefined) unknownKeys(hsrc, RES_HUD_FIELDS, `${path}.hud`, ctx);
  let regenWhen = 'always';
  if (r.regenWhen !== undefined) {
    const w = r.regenWhen;
    if (['always', 'grounded', 'airborne'].includes(w)) regenWhen = w;
    else if (isStr(w) && w.startsWith('form:')) {
      if (!ref.forms.has(w.slice(5))) refNote('form', w.slice(5), `${path}.regenWhen`, ref.forms);
      regenWhen = w;
    } else ctx.note('I004', `${path}.regenWhen`, `${path}.regenWhen should be always, grounded, airborne or form:<name> — using always.`, { suggest: isStr(w) ? didYouMean(w, ['always', 'grounded', 'airborne']) : null });
  }
  const min = numOr(r.min, 0, `${path}.min`, ctx);
  const out = {
    min, max, start: numOr(r.start, max, `${path}.start`, ctx),
    regen: numOr(r.regen, 0, `${path}.regen`, ctx), regenDelay: numOr(r.regenDelay, 0, `${path}.regenDelay`, ctx, { round: true }), regenWhen,
    decay: numOr(r.decay, 0, `${path}.decay`, ctx),
    onHit: perDamage(r.onHit, `${path}.onHit`), onHurt: perDamage(r.onHurt, `${path}.onHurt`), soak,
    resetOnRespawn: boolOr(r.resetOnRespawn, true, `${path}.resetOnRespawn`, ctx), sync: boolOr(r.sync, true, `${path}.sync`, ctx),
    hud: {
      style: enumOr(hsrc.style, HUD_STYLES, 'bar', `${path}.hud.style`, ctx), label: strOr(hsrc.label, name, `${path}.hud.label`, ctx),
      color: strOr(hsrc.color, null, `${path}.hud.color`, ctx), forms: formList(hsrc.forms, `${path}.hud.forms`),
    },
  };
  if (extra) out.extra = extra;
  return out;
}

/** Normalize a StatusDef (also used for built-ins by buildIR). */
export function normStatus(src, path, ctx = makeCtx()) {
  const s = objOr(src, path, ctx) || {};
  const extra = unknownKeys(s, STATUS_FIELDS, path, ctx);
  let frames = s.frames;
  if (!isNum(frames)) { ctx.note('I004', `${path}.frames`, `${path}.frames is missing — using 120.`, { to: 120 }); frames = 120; }
  const mods = {};
  const msrc = s.mods === undefined ? {} : objOr(s.mods, `${path}.mods`, ctx) || {};
  unknownKeys(msrc, STATUS_MOD_KEYS, `${path}.mods`, ctx);
  for (const k of STATUS_MOD_KEYS) if (msrc[k] !== undefined) mods[k] = numOr(msrc[k], 1, `${path}.mods.${k}`, ctx);
  const pair = (v, P, a, b, da, db) => {
    if (v === undefined || v === null) return null;
    const o = objOr(v, P, ctx);
    if (!o) return null;
    unknownKeys(o, [a, b], P, ctx);
    return { [a]: numOr(o[a], da, `${P}.${a}`, ctx, { round: true }), [b]: numOr(o[b], db, `${P}.${b}`, ctx) };
  };
  const out = {
    frames: int(frames), stack: enumOr(s.stack, STACK_MODES, 'refresh', `${path}.stack`, ctx), maxStacks: numOr(s.maxStacks, 1, `${path}.maxStacks`, ctx, { round: true }),
    mods, dot: pair(s.dot, `${path}.dot`, 'every', 'damage', 15, 0.5), control: enumOr(s.control, CONTROL_KINDS, null, `${path}.control`, ctx),
    heal: pair(s.heal, `${path}.heal`, 'every', 'amount', 30, 0),
    visual: strOr(s.visual, null, `${path}.visual`, ctx), tint: strOr(s.tint, null, `${path}.tint`, ctx), icon: strOr(s.icon, null, `${path}.icon`, ctx),
  };
  if (extra) out.extra = extra;
  return out;
}

// ── Hits ────────────────────────────────────────────────────────────────────
const HIT_KEYS = Object.keys(HIT_FIELDS);
const STRIKE_DEFAULTS = { damage: 4, angle: 45, knockback: 20, growth: 60 };

function normStatusRef(v, path, ctx, ref, refNote) {
  if (v === undefined || v === null || v === false) return null;
  let o;
  if (isStr(v)) o = { name: v, frames: null, power: null };
  else if (isObj(v) && isStr(v.name)) {
    unknownKeys(v, ['name', 'frames', 'power'], path, ctx);
    o = { name: v.name, frames: isNum(v.frames) ? int(v.frames) : null, power: isNum(v.power) ? v.power : null };
  } else { ctx.note('I004', path, `${path} should be a status name or {name, frames?, power?} — ignored.`); return null; }
  if (ref && !ref.statuses.has(o.name)) refNote('status', o.name, path, ref.statuses);
  return o;
}

/** HitTemplate fields from a raw object (template merged with inline fields already). */
function normHit(h, path, ctx, { effect, ref, refNote }) {
  const kind = enumOr(h.kind, HIT_KINDS, 'strike', `${path}.kind`, ctx);
  const out = { kind };
  const missing = [];
  for (const k of ['damage', 'angle', 'knockback', 'growth']) {
    const d = kind === 'strike' ? STRIKE_DEFAULTS[k] : 0;
    if (isNum(h[k])) { out[k] = h[k]; continue; }
    out[k] = d;
    if (h[k] !== undefined) ctx.note('I004', `${path}.${k}`, `${path}.${k} should be a number — using ${d}.`, { to: d });
    else if (kind === 'strike' && !(isNum(h.setKnockback) && (k === 'knockback' || k === 'growth'))) missing.push(k);
  }
  if (missing.length) ctx.note('I004', path, `${path} has no ${missing.join('/')} — using ${missing.map((k) => `${k} ${STRIKE_DEFAULTS[k]}`).join(', ')}.`);
  out.setKnockback = isNum(h.setKnockback) ? h.setKnockback : null;
  out.effect = isStr(h.effect) ? h.effect : effect ?? 'normal';
  if (isStr(h.effect) && !EFFECT_PRESETS.includes(h.effect)) {
    const s = didYouMean(h.effect, EFFECT_PRESETS);
    if (s) ctx.note('I009', `${path}.effect`, `${path}.effect "${h.effect}" isn't a preset (kept).`, { suggest: s });
  }
  out.status = normStatusRef(h.status, `${path}.status`, ctx, ref, refNote);
  out.shieldMul = numOr(h.shieldMul, 1, `${path}.shieldMul`, ctx);
  out.hitlagMul = numOr(h.hitlagMul, 1, `${path}.hitlagMul`, ctx);
  out.push = numOr(h.push, 0, `${path}.push`, ctx);
  if (kind === 'wind') out.windDir = enumOr(h.windDir, WIND_DIRS, 'facing', `${path}.windDir`, ctx);
  out.tier = enumOr(h.tier, TIER_NAMES, null, `${path}.tier`, ctx);
  return out;
}

/** Inline fields override the named template (`use`). Exported for the validator's per-use re-merge. */
export function mergeTemplate(template, inline) {
  const out = isObj(template) ? { ...template } : {};
  for (const k of HIT_KEYS) if (inline[k] !== undefined) out[k] = inline[k];
  return out;
}

const HITBOX_KEYS = [...SHAPE_KEYS, ...HIT_KEYS, ...Object.keys(HITBOX_FIELDS)];

function normHitbox(h, i, path, ctx, hc) {
  const P = `${path}[${i}]`;
  if (!isObj(h)) { ctx.note('I004', P, `${P} should be a hitbox object — ignored.`); return null; }
  const extra = unknownKeys(h, HITBOX_KEYS, P, ctx);
  let tpl = null;
  let use = null;
  if (h.use !== undefined && h.use !== null) {
    if (isStr(h.use) && isObj(hc.ref.templates[h.use])) { tpl = hc.ref.templates[h.use]; use = h.use; }
    else ctx.err('E013', `${P}.use`, `${P}.use "${h.use}" isn't a template in hitboxes.`, { suggest: isStr(h.use) ? didYouMean(h.use, Object.keys(hc.ref.templates)) : null });
  }
  const shape = normShape(h, P, ctx, hc.shapeDefaults || {});
  const hit = normHit(mergeTemplate(tpl, h), P, ctx, { effect: hc.effect, ref: hc.ref, refNote: hc.refNote });
  let start, end;
  if (hc.entity) {
    start = numOr(h.start, 0, `${P}.start`, ctx, { round: true });
    end = numOr(h.end, hc.life, `${P}.end`, ctx, { round: true });
  } else {
    if (!isNum(h.start)) ctx.note('I004', `${P}.start`, `${P}.start is missing — using frame ${hc.minStartup}.`, { to: hc.minStartup });
    start = isNum(h.start) ? int(h.start) : hc.minStartup;
    end = numOr(h.end, start + 3, `${P}.end`, ctx, { round: true });
  }
  const out = {
    ...shape, start, end,
    group: Number.isInteger(h.group) ? h.group : i,
    use, ...hit,
    rehit: isNum(h.rehit) ? int(h.rehit) : null,
    onHit: normActions(h.onHit, `${P}.onHit`, ctx, hc),
    counterScale: boolOr(h.counterScale, false, `${P}.counterScale`, ctx),
    air: boolOr(h.air, false, `${P}.air`, ctx),
  };
  if (extra) out.extra = extra;
  return out;
}

// ── Timeline ────────────────────────────────────────────────────────────────
const TIMING_KEYS = Object.keys(TIMELINE_TIMING);

function normActions(list, path, ctx, hc) {
  return listOr(list, path, ctx).map((e, i) => normEntry(e, `${path}[${i}]`, ctx, hc, false)).filter(Boolean);
}
function normTimeline(list, path, ctx, hc) {
  return listOr(list, path, ctx).map((e, i) => normEntry(e, `${path}[${i}]`, ctx, hc, true)).filter(Boolean);
}

/**
 * TimelineEntry → { when: 'at'|'range'|'land'|'hit'|null, at, from, to, every, action, args }.
 * `when` is null for TimelineAction lists (onHit/onAbsorb/onSpawn/…).
 */
function normEntry(e, P, ctx, hc, timing) {
  if (!isObj(e)) { ctx.err('E014', P, `${P} must be an object like { at: 10, spawn: 'orb' }.`); return null; }
  const actionKeys = Object.keys(e).filter((k) => TIMELINE_ACTIONS[k]);
  if (actionKeys.length !== 1) {
    const stray = Object.keys(e).filter((k) => !TIMING_KEYS.includes(k) && !TIMELINE_ACTIONS[k]);
    const sug = stray.map((k) => didYouMean(k, TIMELINE_ACTION_KEYS)).find(Boolean) || null;
    ctx.err('E014', P, actionKeys.length
      ? `${P} has ${actionKeys.length} actions (${actionKeys.join(', ')}); use one entry per action.`
      : `${P} has no action key (one of ${TIMELINE_ACTION_KEYS.join(', ')}).`, { suggest: sug });
    return null;
  }
  const action = actionKeys[0];
  const spec = TIMELINE_ACTIONS[action];
  const out = { when: null, at: null, from: null, to: null, every: null, action, args: null };
  if (timing) {
    if (isNum(e.at)) { out.when = 'at'; out.at = int(e.at); }
    else if (isNum(e.from) || isNum(e.to)) {
      out.when = 'range';
      out.from = int(isNum(e.from) ? e.from : e.to);
      out.to = int(isNum(e.to) ? e.to : e.from);
      out.every = Math.max(1, numOr(e.every, 1, `${P}.every`, ctx, { round: true }));
    } else if (e.onLand) out.when = 'land';
    else if (e.onHit) out.when = 'hit';
    else { ctx.note('I004', P, `${P} has no timing (at, from/to, onLand or onHit) — using at: 0.`); out.when = 'at'; out.at = 0; }
  } else {
    for (const k of TIMING_KEYS) if (e[k] !== undefined) ctx.note('I001', `${P}.${k}`, `${P}.${k}: timing isn't used in this list (kept, ignored).`);
  }
  // Params: value is the primary arg (siblings = params) or an object of params.
  const v = e[action];
  const siblings = {};
  for (const k of Object.keys(e)) if (k !== action && !TIMING_KEYS.includes(k)) siblings[k] = e[k];
  let raw;
  if (spec.map) raw = isObj(v) ? v : {};
  else if (spec.inlineHit && isObj(v)) raw = { ...siblings, inline: v };
  else if (isObj(v)) raw = { ...siblings, ...v };
  else if (spec.primary) raw = { ...siblings, [spec.primary]: v };
  else { ctx.note('I004', `${P}.${action}`, `${P}.${action} should be an object of parameters.`); raw = { ...siblings }; }
  if (!spec.map) {
    const known = [...Object.keys(spec.params), ...(spec.inlineHit ? ['inline'] : [])];
    unknownKeys(raw, known, P, ctx);
  }
  noFns(raw, P, ctx);
  out.args = normArgs(action, raw, P, ctx, hc);
  return out;
}

function normArgs(action, a, P, ctx, hc) {
  const { ref, refNote } = hc;
  const n = (k, d, o) => numOr(a[k], d, `${P}.${k}`, ctx, o);
  const nn = (k) => (isNum(a[k]) ? a[k] : null);
  switch (action) {
    case 'spawn':
      if (!isStr(a.entity) || !ref.entities.has(a.entity)) {
        ctx.err('E012', `${P}.spawn`, `${P}.spawn "${a.entity}" isn't an entity.`, { suggest: isStr(a.entity) ? didYouMean(a.entity, [...ref.entities]) : null });
      }
      return {
        entity: a.entity, x: n('x', 0), y: n('y', 0), vx: nn('vx'), vy: nn('vy'), count: n('count', 1, { round: true }), spread: n('spread', 0),
        aimAt: enumOr(a.aimAt, ['nearestEnemy'], null, `${P}.aimAt`, ctx), bindToMove: boolOr(a.bindToMove, false, `${P}.bindToMove`, ctx),
      };
    case 'velocity':
      return { vx: nn('vx'), vy: nn('vy'), mode: enumOr(a.mode, ['set', 'add'], 'set', `${P}.mode`, ctx), untilGrounded: boolOr(a.untilGrounded, false, `${P}.untilGrounded`, ctx), airOnly: boolOr(a.airOnly, false, `${P}.airOnly`, ctx) };
    case 'impulse': return { vx: n('vx', 0), vy: n('vy', 0) };
    case 'steer': return { speed: n('speed', 8), turn: n('turn', 0.1) };
    case 'teleport': return { dx: n('dx', 0), dy: n('dy', 0), relative: enumOr(a.relative, ['facing', 'world'], 'facing', `${P}.relative`, ctx) };
    case 'hit': {
      if (!isStr(a.template) || !isObj(ref.templates[a.template])) {
        ctx.err('E013', `${P}.hit`, `${P}.hit "${a.template}" isn't a template in hitboxes.`, { suggest: isStr(a.template) ? didYouMean(a.template, Object.keys(ref.templates)) : null });
      }
      return { template: a.template, shape: normShape(a, P, ctx), frames: n('frames', 1, { round: true }), group: isNum(a.group) ? int(a.group) : null };
    }
    case 'resource':
      if (!isStr(a.name) || !ref.resources.has(a.name)) refNote('resource', a.name, `${P}.resource`, ref.resources);
      return { name: a.name ?? null, add: nn('add'), set: nn('set') };
    case 'cost': return { costs: normCosts(a, `${P}.cost`, ctx, ref, refNote) };
    case 'form':
      if (!isStr(a.form) || !ref.forms.has(a.form)) refNote('form', a.form, `${P}.form`, ref.forms);
      return { form: a.form ?? null };
    case 'status':
      if (!isStr(a.status) || !ref.statuses.has(a.status)) refNote('status', a.status, `${P}.status`, ref.statuses);
      return { status: a.status ?? null };
    case 'armor': return { frames: n('frames', 10, { round: true }), threshold: n('threshold', 6) };
    case 'intangible': return { frames: n('frames', 0, { round: true }) };
    case 'facing': return { facing: enumOr(a.facing, ['turn', 'toward'], 'turn', `${P}.facing`, ctx) };
    case 'release': {
      let tpl = null;
      let template = null;
      if (a.inline === undefined) {
        if (isStr(a.template) && isObj(ref.templates[a.template])) { tpl = ref.templates[a.template]; template = a.template; }
        else ctx.err('E013', `${P}.release`, `${P}.release "${a.template}" isn't a template in hitboxes.`, { suggest: isStr(a.template) ? didYouMean(a.template, Object.keys(ref.templates)) : null });
      } else unknownKeys(a.inline, HIT_FIELDS, `${P}.release`, ctx);
      return { template, hit: normHit(tpl ? { ...tpl } : a.inline || {}, `${P}.release`, ctx, { effect: hc.effect, ref, refNote }) };
    }
    case 'endIf': {
      let resource = null;
      if (isObj(a.resource)) {
        if (!ref.resources.has(a.resource.name)) refNote('resource', a.resource.name, `${P}.endIf.resource`, ref.resources);
        resource = { name: a.resource.name ?? null, below: numOr(a.resource.below, 0, `${P}.endIf.resource.below`, ctx) };
      }
      return { resource, grounded: a.grounded === true, airborne: a.airborne === true };
    }
    case 'goto': return { frame: n('frame', 0, { round: true }) };
    case 'emit': return { name: strOr(a.name, 'event', `${P}.emit`, ctx), data: a.data === undefined ? null : copyData(a.data) };
    case 'sfx': return { sound: strOr(a.sound, null, `${P}.sfx`, ctx) };
    case 'camera': return { shake: n('shake', 0) };
    default: return { ...a };
  }
}

function normCosts(src, path, ctx, ref, refNote) {
  const out = {};
  for (const [k, v] of Object.entries(isObj(src) ? src : {})) {
    if (!ref.resources.has(k)) { refNote('resource', k, `${path}.${k}`, ref.resources); continue; }
    if (isNum(v)) out[k] = v;
    else ctx.note('I004', `${path}.${k}`, `${path}.${k} should be a number — ignored.`);
  }
  return out;
}

// ── Actions ─────────────────────────────────────────────────────────────────
const catTiming = (category) => CATEGORIES[category] || CATEGORY_TIMING_FALLBACK[category] || CATEGORIES.special;

function normAction(src, key, P, ctx, mctx) {
  const { ref, refNote, centerY, routedFrom } = mctx;
  const extra = unknownKeys(src, ACTION_FIELDS, P, ctx);
  for (const k of Object.keys(src)) if (k !== 'update' && ACTION_FIELDS[k]) noFns(src[k], `${P}.${k}`, ctx);
  const routes = routedFrom[key] || [];
  const defaultCat = routes.length ? TRIGGER_CATEGORY[routes[0]] : 'special';
  const category = enumOr(src.category, CATEGORY_NAMES, defaultCat, `${P}.category`, ctx);
  let duration = 0;
  if (isNum(src.duration)) duration = int(src.duration);
  else ctx.err('E017', `${P}.duration`, `${P}.duration is ${src.duration === undefined ? 'missing' : 'not a number'}.`);
  const effect = strOr(src.effect, null, `${P}.effect`, ctx);
  if (effect && !EFFECT_PRESETS.includes(effect)) {
    const s = didYouMean(effect, EFFECT_PRESETS);
    if (s) ctx.note('I009', `${P}.effect`, `${P}.effect "${effect}" isn't a preset (kept).`, { suggest: s });
  }
  const cat = catTiming(category);
  const hc = { ref, refNote, effect, minStartup: cat.minStartup, shapeDefaults: { x: 0, y: centerY, r: 20 } };

  const hitboxes = listOr(src.hitboxes, `${P}.hitboxes`, ctx).map((h, i) => normHitbox(h, i, `${P}.hitboxes`, ctx, hc)).filter(Boolean);
  const timeline = normTimeline(src.timeline, `${P}.timeline`, ctx, hc);
  const velocity = listOr(src.velocity, `${P}.velocity`, ctx).filter((v, i) => isObj(v) || (ctx.note('I004', `${P}.velocity[${i}]`, 'should be an object — ignored.'), false)).map((v, i) => {
    const VP = `${P}.velocity[${i}]`;
    unknownKeys(v, VELOCITY_FIELDS, VP, ctx);
    const start = numOr(v.start, 1, `${VP}.start`, ctx, { round: true });
    return {
      start, end: numOr(v.end, start, `${VP}.end`, ctx, { round: true }), vx: isNum(v.vx) ? v.vx : null, vy: isNum(v.vy) ? v.vy : null,
      mode: enumOr(v.mode, ['set', 'add'], 'set', `${VP}.mode`, ctx), untilGrounded: boolOr(v.untilGrounded, false, `${VP}.untilGrounded`, ctx),
      airOnly: boolOr(v.airOnly, false, `${VP}.airOnly`, ctx),
    };
  });
  const windows = (list, WP, known, map) => listOr(list, WP, ctx).map((w, i) => {
    if (!isObj(w)) { ctx.note('I004', `${WP}[${i}]`, 'should be an object — ignored.'); return null; }
    unknownKeys(w, known, `${WP}[${i}]`, ctx);
    const from = numOr(w.from, 0, `${WP}[${i}].from`, ctx, { round: true });
    return { from, to: numOr(w.to, from, `${WP}[${i}].to`, ctx, { round: true }), ...map(w, `${WP}[${i}]`) };
  }).filter(Boolean);

  const moveRef = (v, VP) => {
    if (v === undefined || v === null) return null;
    if (isStr(v) && ref.moves.has(v)) return v;
    refNote('move', v, VP, ref.moves);
    return null;
  };

  // hold / charge
  let hold = null;
  if (src.hold !== undefined && src.hold !== null) {
    const h = objOr(src.hold, `${P}.hold`, ctx);
    if (h) {
      unknownKeys(h, HOLD_FIELDS, `${P}.hold`, ctx);
      const btn = category === 'smash' ? 'strong' : category === 'special' || category === 'recovery' ? 'special' : 'attack';
      const from = numOr(h.from, 0, `${P}.hold.from`, ctx, { round: true });
      let release = null;
      if (isNum(h.release)) release = int(h.release);
      else if (h.release !== undefined && h.release !== null) release = moveRef(h.release, `${P}.hold.release`);
      hold = {
        button: enumOr(h.button, ACTION_BUTTONS, btn, `${P}.hold.button`, ctx), from, to: numOr(h.to, from, `${P}.hold.to`, ctx, { round: true }),
        max: numOr(h.max, 120, `${P}.hold.max`, ctx, { round: true }), release,
      };
    }
  }
  let charge = null;
  if (src.charge === undefined) {
    // Smash default, except when a hold already uses the move's freeze window.
    if (category === 'smash' && !hold) charge = { button: 'strong', at: null, max: 60, auto: true };
  } else if (src.charge !== null && src.charge !== false) {
    const c = src.charge === true ? {} : objOr(src.charge, `${P}.charge`, ctx);
    if (c) {
      unknownKeys(c, CHARGE_FIELDS, `${P}.charge`, ctx);
      charge = {
        button: enumOr(c.button, ACTION_BUTTONS, 'strong', `${P}.charge.button`, ctx), at: isNum(c.at) ? int(c.at) : null,
        max: numOr(c.max, 60, `${P}.charge.max`, ctx, { round: true }), auto: !isNum(c.at),
      };
    }
  }

  // intangible: [s, e] or [s, e][]
  let intangible = [];
  if (src.intangible !== undefined && src.intangible !== null) {
    const v = src.intangible;
    const pair = (p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]);
    if (pair(v)) intangible = [[int(v[0]), int(v[1])]];
    else if (Array.isArray(v) && v.every(pair)) intangible = v.map((p) => [int(p[0]), int(p[1])]);
    else ctx.note('I004', `${P}.intangible`, `${P}.intangible should be [start, end] or a list of them — ignored.`);
  }

  // requires
  let requires = null;
  if (src.requires !== undefined && src.requires !== null) {
    const r = objOr(src.requires, `${P}.requires`, ctx);
    if (r) {
      unknownKeys(r, REQUIRES_FIELDS, `${P}.requires`, ctx);
      requires = {};
      if (r.form !== undefined) { if (!ref.forms.has(r.form)) refNote('form', r.form, `${P}.requires.form`, ref.forms); requires.form = r.form; }
      if (r.grounded !== undefined) requires.grounded = !!r.grounded;
      if (r.airborne !== undefined) requires.airborne = !!r.airborne;
      if (r.resource !== undefined) requires.resource = normCosts(r.resource, `${P}.requires.resource`, ctx, ref, refNote);
      if (r.var !== undefined && isObj(r.var)) {
        requires.var = {};
        for (const [k, v] of Object.entries(r.var)) { if (!ref.vars.has(k)) refNote('var', k, `${P}.requires.var.${k}`, ref.vars); else requires.var[k] = v; }
      }
    }
  }

  // cancels
  const cancels = listOr(src.cancels, `${P}.cancels`, ctx).map((c, i) => {
    const CP = `${P}.cancels[${i}]`;
    if (!isObj(c)) { ctx.note('I004', CP, 'should be an object — ignored.'); return null; }
    unknownKeys(c, CANCEL_FIELDS, CP, ctx);
    const from = numOr(c.from, 0, `${CP}.from`, ctx, { round: true });
    const into = (Array.isArray(c.into) ? c.into : isStr(c.into) ? [c.into] : []).filter((n, j) => {
      if (isStr(n) && (ref.moves.has(n) || TRIGGERS.includes(n) || CANCEL_SPECIALS.includes(n))) return true;
      refNote('cancel target', n, `${CP}.into[${j}]`, [...ref.moves, ...TRIGGERS, ...CANCEL_SPECIALS]);
      return false;
    });
    return { from, to: numOr(c.to, from, `${CP}.to`, ctx, { round: true }), into, onHit: boolOr(c.onHit, false, `${CP}.onHit`, ctx), button: enumOr(c.button, ACTION_BUTTONS, null, `${CP}.button`, ctx) };
  }).filter(Boolean);

  // counter
  let counter = null;
  if (src.counter !== undefined && src.counter !== null) {
    const c = objOr(src.counter, `${P}.counter`, ctx);
    if (c) {
      unknownKeys(c, COUNTER_FIELDS, `${P}.counter`, ctx);
      const from = numOr(c.from, 0, `${P}.counter.from`, ctx, { round: true });
      counter = { from, to: numOr(c.to, from, `${P}.counter.to`, ctx, { round: true }), then: moveRef(c.then, `${P}.counter.then`), mul: numOr(c.mul, 1.2, `${P}.counter.mul`, ctx) };
    }
  }

  let thr = null;
  if (src.throw !== undefined && src.throw !== null) {
    const t = objOr(src.throw, `${P}.throw`, ctx);
    if (t) {
      unknownKeys(t, THROW_FIELDS, `${P}.throw`, ctx);
      thr = { holdAt: isObj(t.holdAt) && isNum(t.holdAt.x) && isNum(t.holdAt.y) ? { x: t.holdAt.x, y: t.holdAt.y } : null };
    }
  }

  const out = {
    key,
    name: isStr(src.name) && src.name.trim() ? src.name : key,
    category, duration, hitboxes, timeline, velocity, intangible,
    armor: windows(src.armor, `${P}.armor`, ARMOR_WINDOW_FIELDS, (w, WP) => ({ threshold: numOr(w.threshold, 0, `${WP}.threshold`, ctx) })),
    hurtboxes: windows(src.hurtboxes, `${P}.hurtboxes`, HURT_WINDOW_FIELDS, (w, WP) => {
      if (w.set !== undefined && w.set !== null && !ref.hurtSets.has(w.set)) refNote('hurtbox set', w.set, `${WP}.set`, ref.hurtSets);
      return { set: isStr(w.set) ? w.set : null, shapes: Array.isArray(w.shapes) ? normShapes(w.shapes, `${WP}.shapes`, ctx) : null };
    }),
    gravity: windows(src.gravity, `${P}.gravity`, GRAVITY_WINDOW_FIELDS, (w, WP) => ({ scale: numOr(w.scale, 1, `${WP}.scale`, ctx) })),
    landingLag: isNum(src.landingLag) ? int(src.landingLag) : (src.landingLag !== undefined && src.landingLag !== null && ctx.note('I004', `${P}.landingLag`, 'should be a number.'), category === 'aerial' ? 10 : null),
    helpless: boolOr(src.helpless, routes.includes('upSpecial'), `${P}.helpless`, ctx),
    oncePerAirtime: boolOr(src.oncePerAirtime, routes.includes('sideSpecial'), `${P}.oncePerAirtime`, ctx),
    cost: src.cost === undefined || src.cost === null ? null : normCosts(src.cost, `${P}.cost`, ctx, ref, refNote),
    requires,
    else: moveRef(src.else, `${P}.else`),
    hold, charge, cancels,
    next: moveRef(src.next, `${P}.next`),
    counter,
    onAbsorb: normActions(src.onAbsorb, `${P}.onAbsorb`, ctx, hc),
    throw: thr,
    anim: strOr(src.anim, null, `${P}.anim`, ctx),
    pose: src.pose === undefined ? null : src.pose,
    effect,
    color: strOr(src.color, null, `${P}.color`, ctx),
    sound: src.sound === undefined ? null : src.sound,
    description: strOr(src.description, '', `${P}.description`, ctx),
    update: fnOrNull(src.update, `${P}.update`, ctx),
    generic: false,
  };
  if (extra) out.extra = extra;
  return out;
}

// ── Entities ────────────────────────────────────────────────────────────────
const KIND_MOTION = { projectile: 'linear', minion: 'walker', trap: 'stationary', zone: 'stationary', beam: 'attached', clone: 'mimic', part: 'attached' };

const PERMANENT = 1e9; // frames (≈ 193 days): "until KO"

/** Entity vars: ≤ 4 keys of number|boolean|string (strings ≤ 24 chars, numbers clamped ±1e6). */
function entityVars(src, P, ctx) {
  if (src === undefined || src === null) return null;
  if (!isObj(src)) { ctx.note('I004', P, `${P} should be an object of number/boolean/string values — ignored.`); return null; }
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (Object.keys(out).length >= 4) { ctx.note('I004', `${P}.${k}`, `${P}: entities keep at most 4 vars — "${k}" ignored.`); continue; }
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(-1e6, Math.min(1e6, v));
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 24);
    else ctx.note('I004', `${P}.${k}`, `${P}.${k} must be a finite number, boolean or string — ignored.`);
  }
  return out;
}

function normEntity(src, name, P, ctx, ref, refNote) {
  if (!isObj(src)) { ctx.note('I004', P, `${P} should be an object — using a default projectile.`); src = {}; }
  const extra = unknownKeys(src, ENTITY_FIELDS, P, ctx, { skip: ['legacy'] });
  for (const k of Object.keys(src)) if (k !== 'think' && ENTITY_FIELDS[k]) noFns(src[k], `${P}.${k}`, ctx);
  let kind = src.kind;
  if (!ENTITY_KINDS.includes(kind)) {
    ctx.note('I004', `${P}.kind`, `${P}.kind ${kind === undefined ? 'is missing' : `"${kind}" isn't a kind`} — using "projectile". Kinds: ${ENTITY_KINDS.join(', ')}.`, { suggest: isStr(kind) ? didYouMean(kind, ENTITY_KINDS) : null });
    kind = 'projectile';
  }
  if (src.shape === undefined && kind !== 'clone') ctx.note('I004', `${P}.shape`, `${P}.shape is missing — using a circle r 10 at (0,0).`, { to: 'circle r 10' });
  const shape = normShape(src.shape ?? { r: 10 }, `${P}.shape`, ctx, src.shape === undefined ? { r: 10 } : {});
  let life = src.life;
  const permanentPart = kind === 'part' && (src.relay === undefined || (isNum(src.relay) && src.relay >= 1));
  if (!isNum(life) && permanentPart) life = PERMANENT; // relay-1 parts are extra hurtboxes: permanent by default
  else if (!isNum(life)) { ctx.note('I004', `${P}.life`, `${P}.life is missing — using 60 frames.`, { to: 60 }); life = 60; }
  life = int(life);
  const hp = numOr(src.hp, 0, `${P}.hp`, ctx);
  const msrc = src.motion === undefined ? {} : objOr(src.motion, `${P}.motion`, ctx) || {};
  unknownKeys(msrc, MOTION_FIELDS, `${P}.motion`, ctx);
  const motion = { type: enumOr(msrc.type, MOTION_TYPES, KIND_MOTION[kind], `${P}.motion.type`, ctx) };
  for (const [k, spec] of Object.entries(MOTION_FIELDS)) {
    if (k === 'type' || msrc[k] === undefined) continue;
    if (spec.type === 'enum') motion[k] = enumOr(msrc[k], spec.values, null, `${P}.motion.${k}`, ctx);
    else if (spec.type === 'bool') motion[k] = !!msrc[k];
    else if (spec.type === 'object') motion[k] = isObj(msrc[k]) ? { x: isNum(msrc[k].x) ? msrc[k].x : 0, y: isNum(msrc[k].y) ? msrc[k].y : 0 } : null;
    else motion[k] = numOr(msrc[k], 0, `${P}.motion.${k}`, ctx, { round: spec.type === 'int' });
  }
  const effect = isStr(src.render?.effect) ? src.render.effect : null;
  const hc = { ref, refNote, effect, entity: true, life };
  const hitboxes = listOr(src.hitboxes, `${P}.hitboxes`, ctx).map((h, i) => normHitbox(h, i, `${P}.hitboxes`, ctx, hc)).filter(Boolean);
  let every = null;
  if (src.every !== undefined && src.every !== null) {
    const ev = objOr(src.every, `${P}.every`, ctx);
    if (ev) {
      unknownKeys(ev, EVERY_FIELDS, `${P}.every`, ctx);
      if (!isStr(ev.spawn) || !ref.entities.has(ev.spawn)) ctx.err('E012', `${P}.every.spawn`, `${P}.every.spawn "${ev.spawn}" isn't an entity.`, { suggest: isStr(ev.spawn) ? didYouMean(ev.spawn, [...ref.entities]) : null });
      every = {
        frames: numOr(ev.frames, 60, `${P}.every.frames`, ctx, { round: true }), spawn: ev.spawn ?? null,
        x: numOr(ev.x, 0, `${P}.every.x`, ctx), y: numOr(ev.y, 0, `${P}.every.y`, ctx), vx: isNum(ev.vx) ? ev.vx : null, vy: isNum(ev.vy) ? ev.vy : null,
        aim: enumOr(ev.aim, ['nearestEnemy'], null, `${P}.every.aim`, ctx),
      };
    }
  }
  const anchor = isObj(src.anchor) ? { x: numOr(src.anchor.x, 0, `${P}.anchor.x`, ctx), y: numOr(src.anchor.y, 0, `${P}.anchor.y`, ctx) } : null;
  const out = {
    kind, shape, life, hp,
    maxAlive: isNum(src.maxAlive) ? int(src.maxAlive) : null,
    maxHits: numOr(src.maxHits, 1, `${P}.maxHits`, ctx, { round: true }),
    pierce: numOr(src.pierce, 0, `${P}.pierce`, ctx, { round: true }),
    motion,
    collide: enumOr(src.collide, COLLIDE_MODES, 'die', `${P}.collide`, ctx),
    platforms: boolOr(src.platforms, false, `${P}.platforms`, ctx),
    maxBounces: numOr(src.maxBounces, 3, `${P}.maxBounces`, ctx, { round: true }),
    hitboxes,
    hurtbox: src.hurtbox !== undefined ? normShapes(src.hurtbox, `${P}.hurtbox`, ctx) : hp > 0 ? [{ ...shape }] : [],
    relay: numOr(src.relay, 1, `${P}.relay`, ctx),
    length: isNum(src.length) ? src.length : null,
    width: isNum(src.width) ? src.width : null,
    anchor,
    reflectable: boolOr(src.reflectable, true, `${P}.reflectable`, ctx),
    absorbable: boolOr(src.absorbable, true, `${P}.absorbable`, ctx),
    clank: boolOr(src.clank, true, `${P}.clank`, ctx),
    clash: boolOr(src.clash, false, `${P}.clash`, ctx),
    every,
    onSpawn: normActions(src.onSpawn, `${P}.onSpawn`, ctx, hc),
    onHit: normActions(src.onHit, `${P}.onHit`, ctx, hc),
    onExpire: normActions(src.onExpire, `${P}.onExpire`, ctx, hc),
    onDeath: normActions(src.onDeath, `${P}.onDeath`, ctx, hc),
    think: fnOrNull(src.think, `${P}.think`, ctx),
    scale: numOr(src.scale, 1, `${P}.scale`, ctx),
    vars: entityVars(src.vars, `${P}.vars`, ctx),
    render: (isObj(src.render) && copyData(src.render)) || {},
    tier: enumOr(src.tier, TIER_NAMES, null, `${P}.tier`, ctx),
    legacy: isObj(src.legacy) ? { ...src.legacy } : null,
  };
  if (extra) out.extra = extra;
  return out;
}

// ── Routing ─────────────────────────────────────────────────────────────────
/** Move names a SlotFn can return: string literals in its source that name a move (sorted). */
export function slotCandidates(fn, moves) {
  let src = '';
  try { src = Function.prototype.toString.call(fn); } catch { return []; }
  const out = new Set();
  for (const m of src.matchAll(/(['"`])([A-Za-z_$][\w$-]{0,63})\1/g)) if (moves.has(m[2])) out.add(m[2]);
  return [...out].sort();
}

function resolveRouting(def, srcForms, formOrder, ref, ctx) {
  const slots = {};
  const slotFns = {};
  const read = (raw, path, code, inherit, inheritFns) => {
    const out = { ...inherit };
    const fns = { ...inheritFns };
    if (raw === undefined || raw === null) return { out, fns };
    if (!isObj(raw)) { ctx.err(code, path, `${path} must be an object mapping triggers to move names.`); return { out, fns }; }
    for (const [t, v] of Object.entries(raw)) {
      const P = `${path}.${t}`;
      if (!TRIGGERS.includes(t)) {
        ctx.note('I001', P, `${P}: "${t}" isn't a trigger (kept, not used).`, { suggest: didYouMean(t, TRIGGERS) });
        continue;
      }
      if (isStr(v)) {
        if (ref.moves.has(v)) { out[t] = v; delete fns[t]; }
        else ctx.err(code, P, `${P} → "${v}", but there is no moves.${v}.`, { suggest: didYouMean(v, [...ref.moves]) });
      } else if (isFn(v)) fns[t] = v;
      else ctx.err(code, P, `${P} must be a move name or a function (view) => name.`);
    }
    return { out, fns };
  };
  const identity = Object.fromEntries(TRIGGERS.map((t) => [t, t]));
  const base = read(def.slots, 'slots', 'E010', identity, {});
  slots.base = base.out;
  slotFns.base = base.fns;
  for (const f of formOrder.slice(1)) {
    const r = read(srcForms[f].slots, `forms.${f}.slots`, 'E011', base.out, base.fns);
    slots[f] = r.out;
    slotFns[f] = r.fns;
  }
  return { slots, slotFns };
}

// ── AI ──────────────────────────────────────────────────────────────────────
function normAI(src, ctx, ref, refNote, formOrder) {
  const a = objOr(src, 'ai', ctx) || {};
  const extra = unknownKeys(a, AI_FIELDS, 'ai', ctx);
  const names = (list, P) => listOr(list, P, ctx).filter((n, i) => {
    if (isStr(n) && (ref.moves.has(n) || TRIGGERS.includes(n))) return true;
    refNote('move', n, `${P}[${i}]`, ref.moves);
    return false;
  });
  let recovery = null;
  if (Array.isArray(a.recovery)) recovery = names(a.recovery, 'ai.recovery');
  else if (isObj(a.recovery)) {
    recovery = {};
    for (const [f, list] of Object.entries(a.recovery)) {
      if (!formOrder.includes(f)) { refNote('form', f, `ai.recovery.${f}`, formOrder); continue; }
      recovery[f] = names(list, `ai.recovery.${f}`);
    }
  } else if (a.recovery !== undefined && a.recovery !== null) ctx.note('I004', 'ai.recovery', 'ai.recovery should be a list of move names (or per form) — ignored.');
  const out = {
    preferredRange: isNum(a.preferredRange) ? a.preferredRange : null,
    zoning: boolOr(a.zoning, false, 'ai.zoning', ctx),
    recovery,
    prefer: names(a.prefer, 'ai.prefer'),
    avoid: names(a.avoid, 'ai.avoid'),
    grapple: boolOr(a.grapple, false, 'ai.grapple', ctx),
    hint: fnOrNull(a.hint, 'ai.hint', ctx),
  };
  if (extra) out.extra = extra;
  return out;
}

/**
 * The normalized draft. Same shape as the IR minus `tables`/`report` (see ir.js for field docs).
 * @typedef {object} Draft
 * @property {2} version
 * @property {1|2} sourceVersion
 * @property {string|null} id
 * @property {string} name
 * @property {string} author
 * @property {string} description
 * @property {string} archetype
 * @property {string} startForm
 * @property {string[]} formOrder           ['base', ...declared forms]
 * @property {Object<string, import('./ir.js').IRForm>} forms
 * @property {Object<string, import('./ir.js').IRAction>} moves   Includes inserted generic moves.
 * @property {Object<string, import('./ir.js').IRHit>} hitboxes
 * @property {Object<string, import('./ir.js').IREntity>} entities
 * @property {Object<string, import('./ir.js').IRStatus>} statuses  Custom only (buildIR adds built-ins).
 * @property {Object<string, import('./ir.js').IRResource>} resources
 * @property {Object<string, number|boolean|string>} vars
 * @property {string[]} sync
 * @property {import('./ir.js').IRBehavior} behavior
 * @property {import('./ir.js').IRAI} ai
 * @property {string[]} generics            Trigger names that got a generic move.
 * @property {object|null} art              The author's ArtDef (client only), by reference.
 * @property {object|null} legacy           v1 origin info (see ir.js IR.legacy).
 * @property {object} [extra]               Unknown top-level fields, kept.
 */
