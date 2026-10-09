// ─────────────────────────────────────────────────────────────────────────────
// AUTO-BALANCER (validator v2, spec §4.1). Runs on the server at startup, in the
// browser before every match, and in `npm run validate`.
//
// Philosophy: characters may use ANY numbers. Instead of rejecting a character,
// the balancer SCALES anything too strong back into the limits from rules.js and
// records a coded note for each adjustment. Only structural errors (E0xx) block
// loading. The result's `character` is the deep-frozen IR (shared/char/ir.js) —
// the simulation never reads the original module.
//
//   validateCharacter(def, {expectedId}) → {ok, errors, notes, warnings, character: IR, report}
//
// Dispatch:
//   v1 files (no version / version 1) → the v1 rules path below, byte-for-byte the
//     pre-v2 validator (v1 pricing, reach from center, INTANGIBLE_MAX 10, legacy KO
//     estimator), then its exact numbers go through normalize → buildIR.
//   v2 files → normalize → v2 scalers (shared/balance/v2/*) → buildIR.
//   Both → finalizeIR (compat mirrors, precomputed areas/phases) → deepFreeze.
// Pure and deterministic; browser-safe.
// ─────────────────────────────────────────────────────────────────────────────
import {
  STATS, HURTBOX_AREA, STAT_BUDGET, MOVE_SLOTS, CATEGORIES, KNOCKBACK_LIMITS,
  PROJECTILE_LIMITS, MOVEMENT_LIMITS, MOVE_BUDGET, META_LIMITS, INTANGIBLE_MAX,
} from './rules.js';
import { estimateKoPercent } from '../sim/combat.js';
import { ANIMATIONS, NEUTRAL } from '../art/anims.js';
import { normalize, isV1 } from '../char/normalize-v2.js';
import { normalizeV1 } from '../char/normalize-v1.js';
import { buildIR } from '../char/ir.js';
import { BUILTIN_STATUSES, V1_SLOTS } from '../char/schema.js';
import { deepFreeze as freezeAll } from '../util/freeze.js';
import { makeNotes, finishNote } from './v2/report.js';
import { clampStatuses } from './v2/statuses.js';
import { clampResources } from './v2/resources.js';
import { clampForms } from './v2/forms.js';
import { clampTemplates, clampActions, clampAction, recheckKo } from './v2/actions.js';
import { clampEntities, kindKey } from './v2/entities.js';
import { budgetForms, entityDamage, execs, scoreAction, formPower } from './v2/score.js';
import { unionArea } from './v2/area.js';

const EFFECTS = ['punch', 'kick', 'slash', 'fire', 'ice', 'electric', 'magic', 'water', 'wind', 'dark', 'light', 'poison', 'earth', 'none'];
const KNOWN_MOVE_FIELDS = ['name', 'duration', 'anim', 'pose', 'effect', 'color', 'hitboxes', 'projectiles', 'velocity', 'landingLag', 'intangible', 'description', 'sound'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, d) => (isNum(v) ? v : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

export function statPoints(stats) {
  let total = 0;
  const breakdown = {};
  for (const [key, rule] of Object.entries(STATS)) {
    if (!rule.points) continue;
    const t = (stats[key] - rule.min) / (rule.max - rule.min);
    breakdown[key] = +(clamp(t, 0, 1) * rule.points).toFixed(1);
    total += breakdown[key];
  }
  const area = stats.width * stats.height;
  const t = (HURTBOX_AREA.free - area) / (HURTBOX_AREA.free - HURTBOX_AREA.min);
  breakdown.hurtboxArea = +(clamp(t, 0, 1) * HURTBOX_AREA.points).toFixed(1);
  total += breakdown.hurtboxArea;
  return { total: +total.toFixed(1), breakdown };
}

// ═════════════════════════════════════════════════════════════════════════════
// DISPATCHER
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Validate (and auto-balance) any character module default export.
 * @param {*} def
 * @param {{expectedId?: string}} [opts]
 * @returns {{ok: boolean, errors: Note[], notes: Note[], warnings: Note[], character: IR|null, report: object}}
 *   errors → structural problems (E0xx); the character can't be loaded.
 *   notes  → coded W/I notes (each also stringifies to a one-line message).
 *   character → the deep-frozen IR the sim, AI, snapshot and art host read (shared/char/ir.js).
 */
export function validateCharacter(def, opts = {}) {
  try {
    return isV1(def) ? validateV1(def, opts) : validateV2(def, opts);
  } catch (e) {
    // Never let a hostile or malformed def crash the caller (catalog, room worker, CLI).
    const msg = `reading the character threw: ${e && e.message ? e.message : String(e)}`;
    const err = finishNote({ code: 'E004', severity: 'error', path: '', why: msg, text: msg });
    return { ok: false, errors: [err], notes: [], warnings: [], character: null, report: null };
  }
}

// ── v1 files: exact v1 numbers, then the shared IR pipeline ─────────────────
const V1_NOTE_CODES = [
  [/^name shortened/, 'W101'], [/^stats\.\S+ isn't a stat/, 'I001'], [/^stats\.\S+ wasn't a number/, 'I004'],
  [/^stats\.\S+ .* scaled into range/, 'W110'], [/^hurtbox was smaller/, 'W133'], [/^stats cost/, 'W120'],
  [/isn't a move slot/, 'I010'], [/missing — using a generic move/, 'I002'], [/isn't a move field/, 'I001'],
  [/\.anim ".*" unknown/, 'I004'], [/\.effect ".*" unknown/, 'I004'], [/active window capped/, 'W203'],
  [/^\S+\.hitboxes\[\d+\]\.r /, 'W214'], [/pulled in to the/, 'W215'], [/^\S+\.hitboxes\[\d+\]\.damage /, 'W210'],
  [/^\S+\.hitboxes\[\d+\]\.(knockback|growth) /, 'W212'], [/would KO at/, 'W213'], [/projectiles; only the first/, 'W409'],
  [/projectiles\[\d+\] speed/, 'W403'], [/projectiles\[\d+\]\.life/, 'W402'], [/projectiles\[\d+\]\.r /, 'W413'],
  [/projectiles\[\d+\]\.gravity/, 'W403'], [/projectiles\[\d+\]\.damage/, 'W401'], [/spawn point pulled/, 'W409'],
  [/projectiles\[\d+\]\.start/, 'W202'], [/came out on frame/, 'W202'], [/moved you/, 'W302'],
  [/intangible capped/, 'W220'], [/\.landingLag →/, 'W222'], [/total damage; every hit scaled/, 'W211'],
  [/too fast for its damage/, 'W201'], [/^total move power/, 'W601'],
];

/** v1 string note → coded note (why/text = the exact v1 message). */
function v1Note(msg) {
  const code = (V1_NOTE_CODES.find(([re]) => re.test(msg)) || [null, 'W200'])[1];
  const m = /^((?:stats|moves)\.[^\s:]+?)(?=[\s:]|\.?$)/.exec(msg);
  const path = m ? m[1].replace(/\.$/, '') : { W101: 'name', W120: 'stats', W133: 'stats', W601: 'moves' }[code] || '';
  return finishNote({ code, severity: code[0] === 'I' ? 'info' : 'warn', path, why: msg, rule: 'v1 rules (legacy)', text: msg });
}
function v1Error(msg) {
  const code = /export default/.test(msg) ? 'E003' : 'E001';
  return finishNote({ code, severity: 'error', path: code === 'E001' ? 'id' : '', why: msg, text: msg });
}

/** The legacy validator's clean character as v1 source syntax for normalizeV1 (numbers already final). */
function v1Source(lc, raw) {
  const rawMoves = raw && typeof raw.moves === 'object' && raw.moves ? raw.moves : {};
  const moves = {};
  for (const [slot, m] of Object.entries(lc.moves)) {
    const src = {
      name: m.name, duration: m.duration, anim: m.anim, effect: m.effect,
      hitboxes: m.hitboxes.map((h) => ({ ...h })), velocity: m.velocity.map((v) => ({ ...v })),
      projectiles: m.projectiles.map((p) => ({ ...p })),
    };
    if (m.pose) src.pose = m.pose;
    if (m.color) src.color = m.color;
    if (m.intangible) src.intangible = [...m.intangible];
    if (m.category === 'aerial') src.landingLag = m.landingLag;
    const r = rawMoves[slot];
    if (r && typeof r === 'object') {
      if (typeof r.description === 'string') src.description = r.description;
      if (r.sound !== undefined && r.sound !== null && typeof r.sound !== 'function') src.sound = r.sound;
    }
    moves[slot] = src;
  }
  return { id: lc.id, name: lc.name, author: lc.author, description: lc.description, stats: { ...lc.stats }, moves };
}

function validateV1(def, opts) {
  const L = validateV1Legacy(def, opts);
  const errors = L.errors.map(v1Error);
  const notes = L.notes.map(v1Note);
  if (!L.ok) return { ok: false, errors, notes, warnings: notes, character: null, report: L.report };
  const lc = L.character;
  const n = normalize(v1Source(lc, def), { expectedId: lc.id });
  if (n.errors.length || !n.draft) {
    // Should never happen (the legacy output is clean); surface it rather than guess.
    const errs = n.errors.map(finishNote);
    return { ok: false, errors: errs, notes, warnings: notes, character: null, report: L.report };
  }
  const draft = n.draft;
  draft.legacy = normalizeV1(def, opts).draft?.legacy ?? draft.legacy;
  // Engine generics for the new triggers (grab, throws, taunt) still pass the v2 action clamps.
  draft.forms.base.stats = { ...lc.stats };
  const env = v2Env(draft, makeNotes());
  const b = draft.forms.base.body;
  env.bodies = { base: { hurt: b.hurtboxes.default, cy: -b.collider.h / 2, collider: b.collider } };
  for (const k of Object.keys(draft.moves).sort()) if (!V1_SLOTS.includes(k)) clampAction(draft.moves[k], k, env);
  // Slots the v1 validator filled with its generic move are generic in the IR too.
  const rawMoves = def.moves && typeof def.moves === 'object' ? def.moves : {};
  const v1gen = V1_SLOTS.filter((slot) => !(rawMoves[slot] && typeof rawMoves[slot] === 'object'));
  for (const slot of v1gen) draft.moves[slot].generic = true;
  draft.generics = [...v1gen, ...draft.generics.filter((g) => !v1gen.includes(g))];
  const report = { source: 1, ...L.report, moves: {} };
  for (const [slot, r] of Object.entries(L.report.moves)) report.moves[slot] = { ...r };
  const ir = buildIR(draft, { report });
  for (const slot of V1_SLOTS) {
    const a = ir.moves[slot];
    if (!a) continue;
    a.projectiles = lc.moves[slot].projectiles.map((p) => ({ ...p }));
    a.timeline = a.timeline.filter((e) => !(e.action === 'spawn' && ir.entities[e.args.entity]?.legacy?.v1));
  }
  const character = finalizeIR(ir, draft);
  return { ok: true, errors, notes, warnings: notes, character, report: character.report };
}

// ── v2 files ────────────────────────────────────────────────────────────────
function v2Env(draft, notes) {
  return { draft, notes, builtins: BUILTIN_STATUSES, cache: new Map(), reach: {}, rise: {}, bodies: null };
}

function clampMeta(draft, notes) {
  const cut = (k, max) => {
    if (typeof draft[k] === 'string' && draft[k].length > max) {
      notes.add('W101', k, `${k} is longer than ${max} characters; shortened.`, { from: draft[k].length, to: max, rule: `META_LIMITS.${k}Max` });
      draft[k] = draft[k].slice(0, max);
    }
  };
  cut('name', META_LIMITS.nameMax);
  cut('description', META_LIMITS.descriptionMax);
  cut('author', 32);
}

function validateV2(def, opts) {
  const n = normalize(def, opts);
  const errors = n.errors.map(finishNote);
  const notes = n.notes.map(finishNote);
  if (errors.length || !n.draft) return { ok: false, errors, notes, warnings: notes, character: null, report: {} };
  const draft = n.draft;
  const W = makeNotes();
  const env = v2Env(draft, W);
  clampMeta(draft, W);
  clampStatuses(draft, W);
  clampResources(draft, W);
  const fr = clampForms(env);
  env.bodies = fr.bodies;
  clampTemplates(env);
  clampEntities(env);
  clampActions(env);
  budgetForms(env);
  recheckKo(env);
  // Final numbers → final scores (recheckKo can only lower power).
  const scores = {};
  for (const k of Object.keys(draft.moves).sort()) scores[k] = scoreAction(draft.moves[k], env);
  const power = {};
  for (const f of draft.formOrder) power[f] = formPower(draft, f, scores, env);

  const report = { source: 2, forms: {}, moves: {}, entities: {} };
  let worstStat = 0, worstPower = 0;
  for (const f of draft.formOrder) {
    const x = fr.forms[f];
    report.forms[f] = {
      statPoints: x.statPoints, statBudget: STAT_BUDGET, movePower: power[f].total, moveBudget: MOVE_BUDGET,
      pricedArea: Math.round(x.pricedArea), scaleMin: x.scaleMin, perTrigger: power[f].per,
    };
    worstStat = Math.max(worstStat, x.statPoints.total);
    worstPower = Math.max(worstPower, power[f].total);
  }
  Object.assign(report, { statPoints: fr.forms.base.statPoints, statBudget: STAT_BUDGET, movePower: power.base.total, moveBudget: MOVE_BUDGET });
  let intang = 0, armor = 0;
  for (const k of Object.keys(draft.moves).sort()) {
    const a = draft.moves[k];
    const fi = a.intangible.reduce((s, [x, y]) => s + Math.max(0, y - x + 1), 0) + a.timeline.filter((e) => e.action === 'intangible').reduce((s, e) => s + e.args.frames * execs(e), 0);
    const fa = a.armor.reduce((s, w) => s + Math.max(0, w.to - w.from + 1), 0) + a.timeline.filter((e) => e.action === 'armor').reduce((s, e) => s + e.args.frames * execs(e), 0);
    intang = Math.max(intang, fi);
    armor = Math.max(armor, fa);
    report.moves[k] = { ...scores[k], rise: env.rise[k] ?? 0, intangibleFrames: fi, armorFrames: fa };
  }
  for (const k of Object.keys(draft.entities).sort()) {
    const e = draft.entities[k];
    report.entities[k] = { kind: e.kind, limits: kindKey(e), damage: Math.round(entityDamage(e) * 100) / 100, life: e.life };
  }
  report.budgets = { selfRise: Math.max(0, ...Object.values(env.rise)), intangible: intang, armorUptime: armor };
  report.headroom = { stat: Math.round((STAT_BUDGET - worstStat) * 10) / 10, power: Math.round((MOVE_BUDGET - worstPower) * 10) / 10 };
  const ir = buildIR(draft, { report });
  const character = finalizeIR(ir, draft);
  const all = [...notes, ...W.list];
  return { ok: true, errors, notes: all, warnings: all, character, report: character.report };
}

// ── IR finishing (both paths) ───────────────────────────────────────────────
/**
 * Adds what the sim reads beyond buildIR, then detaches and deep-freezes:
 *  - compat mirrors: name/author/description (= meta), stats/body (= forms.base),
 *    stats.width/height = collider w/h in every form (v1 consumers: AI, HUD, art);
 *  - report.area[set] (base form, only sets whose area is the same in every form
 *    that has them) and report.areaByForm[form][set]: union px² at bodyScale 1;
 *  - report.moves[n].phases: [{name, from, to}] startup/active/recovery frame tables.
 */
function finalizeIR(ir, draft) {
  ir.name = ir.meta.name;
  ir.author = ir.meta.author;
  ir.description = ir.meta.description;
  for (const f of ir.tables.forms) {
    const F = ir.forms[f];
    if (ir.version === 1 && f === 'base') continue; // v1: the exact legacy stats (incl. width/height) are already there
    F.stats = { ...F.stats, width: F.body.collider.w, height: F.body.collider.h };
  }
  ir.stats = ir.forms.base.stats;
  ir.body = ir.forms.base.body;
  const byForm = {};
  for (const f of ir.tables.forms) {
    byForm[f] = {};
    for (const s of Object.keys(ir.forms[f].body.hurtboxes).sort()) byForm[f][s] = unionArea(ir.forms[f].body.hurtboxes[s]);
  }
  const area = {};
  for (const s of Object.keys(byForm.base)) if (ir.tables.forms.every((f) => byForm[f][s] === undefined || byForm[f][s] === byForm.base[s])) area[s] = byForm.base[s];
  ir.report.area = area;
  ir.report.areaByForm = byForm;
  for (const n of ir.tables.moves) {
    const a = ir.moves[n];
    const rm = ir.report.moves[n];
    const end = a.activeEnd ?? a.startup - 1;
    rm.phases = a.activeEnd === null
      ? [{ name: 'startup', from: 1, to: a.duration }]
      : [{ name: 'startup', from: 1, to: a.startup - 1 }, { name: 'active', from: a.startup, to: end }, { name: 'recovery', from: end + 1, to: a.duration }];
  }
  if (draft.generics.length) ir.report.generics = [...draft.generics];
  return freezeAll(detach(ir));
}

/** Structural copy of plain objects/arrays (functions and class instances kept by reference). */
function detach(v, seen = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v);
  if (Array.isArray(v)) { const out = []; seen.set(v, out); for (const x of v) out.push(detach(x, seen)); return out; }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  const out = {};
  seen.set(v, out);
  // defineProperty: author keys like 'constructor' must not hit a frozen Object.prototype (hardened realms).
  for (const k of Object.keys(v)) Object.defineProperty(out, k, { value: detach(v[k], seen), enumerable: true, writable: true, configurable: true });
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// v1 RULES PATH — the pre-v2 validator, unchanged (golden parity, spec §8).
// Returns the v1-shaped result: string errors/notes and the v1 character.
// ═════════════════════════════════════════════════════════════════════════════
/**
 * @returns {{ ok, errors: string[], notes: string[], character, report }}
 *  errors → the character can't be loaded at all (rare)
 *  notes  → things the auto-balancer scaled or filled in (character still loads)
 */
export function validateV1Legacy(def, { expectedId } = {}) {
  const errors = [];
  const notes = [];
  const note = (m) => notes.push(m);

  if (!def || typeof def !== 'object') {
    return { ok: false, errors: ['Character module must `export default` an object.'], notes, warnings: notes, character: null, report: {} };
  }

  // ── Meta ────────────────────────────────────────────────────────────────
  let id = def.id ?? expectedId;
  if (typeof id !== 'string' || !META_LIMITS.idPattern.test(id)) errors.push(`id "${id}" must be lowercase letters/digits/dashes, 2-24 chars, starting with a letter.`);
  if (expectedId && id !== expectedId) errors.push(`id "${id}" must match its folder name "${expectedId}".`);
  let name = typeof def.name === 'string' && def.name.trim() ? def.name.trim() : String(id);
  if (name.length > META_LIMITS.nameMax) { note(`name shortened to ${META_LIMITS.nameMax} characters.`); name = name.slice(0, META_LIMITS.nameMax); }
  const description = typeof def.description === 'string' ? def.description.slice(0, META_LIMITS.descriptionMax) : '';
  const author = typeof def.author === 'string' ? def.author.slice(0, 32) : 'unknown';

  // ── Stats ───────────────────────────────────────────────────────────────
  const stats = balanceStats(def.stats || {}, note);

  // ── Moves ───────────────────────────────────────────────────────────────
  const srcMoves = def.moves || {};
  for (const key of Object.keys(srcMoves)) if (!MOVE_SLOTS[key]) note(`moves.${key} isn't a move slot, so it's never used. Slots: ${Object.keys(MOVE_SLOTS).join(', ')}`);
  const drafts = {};
  for (const [slot, category] of Object.entries(MOVE_SLOTS)) {
    let src = srcMoves[slot];
    if (!src || typeof src !== 'object') { note(`moves.${slot} missing — using a generic move.`); src = genericMove(slot, category); }
    drafts[slot] = draftMove(slot, category, src, stats, note);
  }

  // Character-wide power budget: if the kit as a whole is too strong, weaken the
  // strongest moves first until it fits.
  let reports = Object.fromEntries(Object.entries(drafts).map(([s, d]) => [s, scoreMove(d)]));
  let movePower = sumPower(reports);
  if (movePower > MOVE_BUDGET) {
    const before = movePower;
    for (let iter = 0; iter < 60 && movePower > MOVE_BUDGET; iter++) {
      const avg = movePower / Object.keys(reports).length;
      for (const [slot, rep] of Object.entries(reports)) {
        if (rep.power > avg * 0.9) weakenMove(drafts[slot], 0.94);
      }
      reports = Object.fromEntries(Object.entries(drafts).map(([s, d]) => [s, scoreMove(d)]));
      movePower = sumPower(reports);
    }
    note(`total move power ${before.toFixed(1)} was over the budget of ${MOVE_BUDGET}; strongest moves were scaled down → ${movePower.toFixed(1)}.`);
  }

  const moves = {};
  for (const [slot, d] of Object.entries(drafts)) moves[slot] = finalizeMove(d);

  const character = errors.length ? null : deepFreeze({ id, name, author, description, stats, moves });
  const sp = statPoints(stats);
  return {
    ok: errors.length === 0,
    errors,
    notes,
    warnings: notes,
    character,
    report: { statPoints: sp, statBudget: STAT_BUDGET, movePower: +movePower.toFixed(1), moveBudget: MOVE_BUDGET, moves: reports },
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────
function balanceStats(src, note) {
  const stats = {};
  for (const key of Object.keys(src)) if (!STATS[key]) note(`stats.${key} isn't a stat the engine uses (ignored).`);
  for (const [key, rule] of Object.entries(STATS)) {
    let v = src[key];
    if (!isNum(v)) { v = rule.default; if (src[key] !== undefined) note(`stats.${key} wasn't a number — using ${rule.default}.`); }
    if (v < rule.min || v > rule.max) { const c = clamp(v, rule.min, rule.max); note(`stats.${key} ${v} scaled into range → ${c} (allowed ${rule.min}–${rule.max}).`); v = c; }
    stats[key] = v;
  }
  stats.airJumps = Math.round(stats.airJumps);
  // Tiny hurtboxes are hard to hit: enforce a minimum area by growing proportionally.
  const area = stats.width * stats.height;
  if (area < HURTBOX_AREA.min) {
    const k = Math.sqrt(HURTBOX_AREA.min / area);
    stats.width = r2(clamp(stats.width * k, STATS.width.min, STATS.width.max));
    stats.height = r2(Math.max(stats.height * k, HURTBOX_AREA.min / stats.width));
    note(`hurtbox was smaller than the minimum area; grown to ${stats.width}×${stats.height}.`);
  }
  // Over budget? Pull every paid stat toward its minimum by the same fraction.
  const before = statPoints(stats).total;
  if (before > STAT_BUDGET) {
    const orig = { ...stats };
    let lo = 0, hi = 1;
    const apply = (t) => {
      for (const [key, rule] of Object.entries(STATS)) {
        if (!rule.points) continue;
        stats[key] = rule.min + (orig[key] - rule.min) * t;
      }
      stats.airJumps = Math.floor(stats.airJumps + 1e-9);
    };
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; apply(mid); if (statPoints(stats).total > STAT_BUDGET) hi = mid; else lo = mid; }
    apply(Math.max(0, lo - 0.004));
    // round DOWN so rounding can never push the total back over budget
    for (const [key, rule] of Object.entries(STATS)) if (rule.points) stats[key] = rule.min + Math.floor((stats[key] - rule.min) * 100) / 100;
    note(`stats cost ${before} points (budget ${STAT_BUDGET}); all paid stats were scaled ${Math.round((1 - lo) * 100)}% toward their minimums.`);
  }
  return stats;
}

// ── Moves ─────────────────────────────────────────────────────────────────
function draftMove(slot, category, src, stats, note) {
  const cat = CATEGORIES[category];
  const P = `moves.${slot}`;
  for (const k of Object.keys(src)) if (!KNOWN_MOVE_FIELDS.includes(k)) note(`${P}.${k} isn't a move field (ignored).`);
  const centerY = -stats.height / 2;

  let anim = typeof src.anim === 'string' && ANIMATIONS[src.anim] ? src.anim : defaultAnim(slot);
  if (src.anim && !ANIMATIONS[src.anim]) note(`${P}.anim "${src.anim}" unknown — using "${anim}".`);
  const pose = cleanPose(src.pose);
  const effect = EFFECTS.includes(src.effect) ? src.effect : 'punch';
  if (src.effect && !EFFECTS.includes(src.effect)) note(`${P}.effect "${src.effect}" unknown — options: ${EFFECTS.join(', ')}`);

  let duration = Math.round(num(src.duration, cat.minDuration + 8));

  const hitboxes = (Array.isArray(src.hitboxes) ? src.hitboxes : []).filter((h) => h && typeof h === 'object').map((h, i) => {
    const HP = `${P}.hitboxes[${i}]`;
    const hb = {
      start: Math.round(num(h.start, cat.minStartup)), end: Math.round(num(h.end, num(h.start, cat.minStartup) + 3)),
      x: num(h.x, 30), y: num(h.y, centerY), r: num(h.r, 20),
      damage: num(h.damage, 4), angle: num(h.angle, 45), knockback: num(h.knockback, 20), growth: num(h.growth, 60),
      group: Number.isInteger(h.group) ? h.group : 0,
    };
    if (hb.end < hb.start) hb.end = hb.start;
    if (hb.end - hb.start > 40) { hb.end = hb.start + 40; note(`${HP} active window capped at 40 frames.`); }
    if (hb.r > cat.maxRadius || hb.r < 4) { const c = clamp(hb.r, 4, cat.maxRadius); note(`${HP}.r ${hb.r} → ${c}.`); hb.r = c; }
    const reach = Math.hypot(hb.x, hb.y - centerY) + hb.r;
    if (reach > cat.maxReach) {
      const k = (cat.maxReach - hb.r) / (reach - hb.r);
      hb.x = r2(hb.x * k); hb.y = r2(centerY + (hb.y - centerY) * k);
      note(`${HP} reached ${reach.toFixed(0)}px; pulled in to the ${category} max of ${cat.maxReach}px.`);
    }
    if (hb.damage > cat.maxHit || hb.damage < 0) { const c = clamp(hb.damage, 0, cat.maxHit); note(`${HP}.damage ${hb.damage} → ${c} (${category} max per hit).`); hb.damage = c; }
    if (hb.knockback > KNOCKBACK_LIMITS.maxBase || hb.knockback < 0) { const c = clamp(hb.knockback, 0, KNOCKBACK_LIMITS.maxBase); note(`${HP}.knockback ${hb.knockback} → ${c}.`); hb.knockback = c; }
    if (hb.growth > KNOCKBACK_LIMITS.maxGrowth || hb.growth < 0) { const c = clamp(hb.growth, 0, KNOCKBACK_LIMITS.maxGrowth); note(`${HP}.growth ${hb.growth} → ${c}.`); hb.growth = c; }
    capKo(hb, cat.koFloor, `${HP}`, note);
    return hb;
  });

  const srcProj = Array.isArray(src.projectiles) ? src.projectiles.filter((p) => p && typeof p === 'object') : [];
  if (srcProj.length > PROJECTILE_LIMITS.maxPerMove) note(`${P} fired ${srcProj.length} projectiles; only the first ${PROJECTILE_LIMITS.maxPerMove} are used.`);
  const projectiles = srcProj.slice(0, PROJECTILE_LIMITS.maxPerMove).map((p, i) => {
    const PP = `${P}.projectiles[${i}]`;
    const pr = {
      start: Math.round(num(p.start, PROJECTILE_LIMITS.minStartup)), x: num(p.x, 30), y: num(p.y, centerY),
      vx: num(p.vx, 8), vy: num(p.vy, 0), gravity: num(p.gravity, 0), life: Math.round(num(p.life, 60)), r: num(p.r, 12),
      damage: num(p.damage, 5), angle: num(p.angle, 40), knockback: num(p.knockback, 15), growth: num(p.growth, 40),
      style: typeof p.style === 'string' ? p.style.slice(0, 24) : 'orb',
      color: typeof p.color === 'string' ? p.color : null,
      color2: typeof p.color2 === 'string' ? p.color2 : null,
      spin: num(p.spin, 0),
    };
    const speed = Math.hypot(pr.vx, pr.vy);
    if (speed > PROJECTILE_LIMITS.maxSpeed) { const k = PROJECTILE_LIMITS.maxSpeed / speed; pr.vx = r2(pr.vx * k); pr.vy = r2(pr.vy * k); note(`${PP} speed ${speed.toFixed(1)} → ${PROJECTILE_LIMITS.maxSpeed}.`); }
    if (pr.life > PROJECTILE_LIMITS.maxLife || pr.life < 1) { const c = clamp(pr.life, 1, PROJECTILE_LIMITS.maxLife); note(`${PP}.life → ${c}.`); pr.life = c; }
    if (pr.r > PROJECTILE_LIMITS.maxRadius || pr.r < 3) { const c = clamp(pr.r, 3, PROJECTILE_LIMITS.maxRadius); note(`${PP}.r → ${c}.`); pr.r = c; }
    if (Math.abs(pr.gravity) > PROJECTILE_LIMITS.maxGravity) { pr.gravity = clamp(pr.gravity, -PROJECTILE_LIMITS.maxGravity, PROJECTILE_LIMITS.maxGravity); note(`${PP}.gravity capped.`); }
    if (pr.damage > PROJECTILE_LIMITS.maxDamage || pr.damage < 0) { const c = clamp(pr.damage, 0, PROJECTILE_LIMITS.maxDamage); note(`${PP}.damage ${pr.damage} → ${c}.`); pr.damage = c; }
    pr.knockback = clamp(pr.knockback, 0, KNOCKBACK_LIMITS.maxBase);
    pr.growth = clamp(pr.growth, 0, KNOCKBACK_LIMITS.maxGrowth);
    const off = Math.hypot(pr.x, pr.y - centerY);
    if (off > 110) { const k = 110 / off; pr.x = r2(pr.x * k); pr.y = r2(centerY + (pr.y - centerY) * k); note(`${PP} spawn point pulled within 110px of your body.`); }
    if (pr.start < PROJECTILE_LIMITS.minStartup) { note(`${PP}.start ${pr.start} → ${PROJECTILE_LIMITS.minStartup}.`); pr.start = PROJECTILE_LIMITS.minStartup; }
    capKo(pr, Math.max(140, cat.koFloor), PP, note);
    return pr;
  });

  // Startup: if anything comes out too early, push the whole move later.
  const starts = [...hitboxes.map((h) => h.start), ...projectiles.map((p) => p.start)];
  const startup0 = starts.length ? Math.min(...starts) : cat.minStartup;
  const shift = Math.max(0, cat.minStartup - startup0);
  if (shift) {
    for (const h of hitboxes) { h.start += shift; h.end += shift; }
    for (const p of projectiles) p.start += shift;
    duration += shift;
    note(`${P} came out on frame ${startup0}; ${category} moves start on frame ${cat.minStartup}+ so it was delayed ${shift} frame(s).`);
  }

  const velocity = (Array.isArray(src.velocity) ? src.velocity : []).filter((v) => v && typeof v === 'object').map((v) => ({
    start: Math.round(num(v.start, 1)) + shift, end: Math.round(num(v.end, num(v.start, 1))) + shift,
    vx: isNum(v.vx) ? clamp(v.vx, -MOVEMENT_LIMITS.maxVx, MOVEMENT_LIMITS.maxVx) : null,
    vy: isNum(v.vy) ? clamp(v.vy, -MOVEMENT_LIMITS.maxVy, MOVEMENT_LIMITS.maxVy) : null,
  }));
  // Movement totals (recovery distance)
  const travel = (s = 1) => {
    let rise = 0, side = 0, lastVy = 0;
    for (const v of velocity) {
      const frames = Math.max(0, v.end - v.start + 1);
      if (v.vy !== null && v.vy < 0) { rise += -v.vy * s * frames; lastVy = v.vy * s; }
      if (v.vx !== null) side += Math.abs(v.vx * s) * frames;
    }
    return { rise: rise + (lastVy * lastVy) / 1.0, side };
  };
  const maxRise = slot === 'upSpecial' ? MOVEMENT_LIMITS.maxRise : 120;
  let mv = travel();
  if (mv.rise > maxRise || mv.side > MOVEMENT_LIMITS.maxTravel) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 25; i++) { const m = (lo + hi) / 2; const t = travel(m); if (t.rise > maxRise || t.side > MOVEMENT_LIMITS.maxTravel) hi = m; else lo = m; }
    for (const v of velocity) { if (v.vx !== null) v.vx = r2(v.vx * lo); if (v.vy !== null && v.vy < 0) v.vy = r2(v.vy * lo); }
    note(`${P} moved you ~${Math.round(mv.rise)}px up / ${Math.round(mv.side)}px sideways; scaled to fit (max ${maxRise} up, ${MOVEMENT_LIMITS.maxTravel} sideways).`);
    mv = travel();
  }

  let intangible = null;
  if (Array.isArray(src.intangible) && isNum(src.intangible[0]) && isNum(src.intangible[1])) {
    let [a, b] = src.intangible.map((x) => Math.round(x) + shift);
    if (b - a + 1 > INTANGIBLE_MAX) { b = a + INTANGIBLE_MAX - 1; note(`${P}.intangible capped at ${INTANGIBLE_MAX} frames.`); }
    intangible = [Math.max(1, a), b];
  }

  let landingLag = 0;
  if (category === 'aerial') {
    landingLag = Math.round(num(src.landingLag, 10));
    if (landingLag < cat.minLandingLag) { note(`${P}.landingLag → ${cat.minLandingLag}.`); landingLag = cat.minLandingLag; }
    landingLag = Math.min(40, landingLag);
  }

  const d = {
    slot, category, cat, P, note, centerY, anim, pose, effect, color: typeof src.color === 'string' ? src.color : null,
    name: typeof src.name === 'string' && src.name.trim() ? src.name.slice(0, 28) : slot,
    duration, hitboxes, projectiles, velocity, intangible, landingLag, rise: Math.round(mv.rise), travel: Math.round(mv.side),
  };
  fitDamageAndDuration(d);
  return d;
}

function capKo(hb, floor, label, note) {
  let ko = estimateKoPercent(hb);
  if (ko >= floor) return;
  const before = ko;
  for (let i = 0; i < 80 && ko < floor; i++) {
    hb.knockback = r2(hb.knockback * 0.93);
    hb.growth = r2(hb.growth * 0.93);
    ko = estimateKoPercent(hb);
  }
  note(`${label} would KO at ~${before}%; knockback scaled so it KOs at ~${ko}% (floor ${floor}%).`);
}

/** Total damage, damage-per-frame and minimum duration. */
function fitDamageAndDuration(d) {
  const { cat, P, note } = d;
  let total = totalDamage(d);
  if (total > cat.maxTotal) {
    const k = cat.maxTotal / total;
    for (const h of d.hitboxes) h.damage = r2(h.damage * k);
    for (const p of d.projectiles) p.damage = r2(p.damage * k);
    note(`${P} dealt ${r2(total)} total damage; every hit scaled by ${k.toFixed(2)} to fit the ${d.category} max of ${cat.maxTotal}.`);
    total = totalDamage(d);
  }
  let lastActive = 0;
  for (const h of d.hitboxes) lastActive = Math.max(lastActive, h.end);
  for (const p of d.projectiles) lastActive = Math.max(lastActive, p.start);
  for (const v of d.velocity) lastActive = Math.max(lastActive, v.end);
  const need = Math.max(cat.minDuration, lastActive + 3, Math.ceil(total / cat.maxDps));
  if (d.duration < need) {
    if (d.duration >= Math.max(cat.minDuration, lastActive + 3)) note(`${P} was too fast for its damage; duration ${d.duration} → ${need} frames.`);
    d.duration = need;
  }
  d.duration = Math.min(d.duration, 150);
}

function totalDamage(d) {
  const groups = {};
  for (const h of d.hitboxes) groups[h.group] = Math.max(groups[h.group] || 0, h.damage);
  d.projectiles.forEach((p, i) => { groups[`p${i}`] = p.damage; });
  return Object.values(groups).reduce((a, b) => a + b, 0);
}

function weakenMove(d, k) {
  for (const h of [...d.hitboxes, ...d.projectiles]) {
    h.damage = r2(h.damage * k);
    h.knockback = r2(h.knockback * k);
    h.growth = r2(h.growth * k);
  }
}

function scoreMove(d) {
  const cat = d.cat;
  const total = totalDamage(d);
  const starts = [...d.hitboxes.map((h) => h.start), ...d.projectiles.map((p) => p.start)];
  const startup = starts.length ? Math.min(...starts) : d.duration;
  let bestKo = Infinity, reach = 0;
  for (const h of d.hitboxes) { bestKo = Math.min(bestKo, estimateKoPercent(h)); reach = Math.max(reach, Math.hypot(h.x, h.y - d.centerY) + h.r); }
  for (const p of d.projectiles) bestKo = Math.min(bestKo, estimateKoPercent(p));
  const c01 = (v) => clamp(v, 0, 1);
  const dmgEff = c01(total / cat.maxTotal);
  const koEff = Number.isFinite(bestKo) ? c01((cat.koFloor * 2.2 - bestKo) / (cat.koFloor * 1.2)) : 0;
  const speedEff = c01((cat.minStartup * 3 - startup) / (cat.minStartup * 2));
  const frameEff = c01((cat.minDuration * 2 - d.duration) / cat.minDuration);
  const reachEff = c01(reach / cat.maxReach);
  let power = 10 * (0.32 * dmgEff + 0.26 * koEff + 0.16 * speedEff + 0.14 * frameEff + 0.12 * reachEff);
  if (d.projectiles.length) power += 1.5;
  if (d.intangible) power += 0.15 * (d.intangible[1] - d.intangible[0] + 1);
  return { category: d.category, startup, duration: d.duration, totalDamage: r2(total), koPercent: bestKo, reach: Math.round(reach), power: r2(power) };
}

const sumPower = (reports) => Object.values(reports).reduce((a, r) => a + r.power, 0);

function finalizeMove(d) {
  const starts = [...d.hitboxes.map((h) => h.start), ...d.projectiles.map((p) => p.start)];
  return {
    name: d.name, slot: d.slot, category: d.category, duration: d.duration, anim: d.anim, pose: d.pose,
    effect: d.effect, color: d.color, startup: starts.length ? Math.min(...starts) : d.duration,
    landingLag: d.landingLag, intangible: d.intangible, totalDamage: r2(totalDamage(d)),
    hitboxes: d.hitboxes, projectiles: d.projectiles, velocity: d.velocity,
  };
}

/** Custom attack poses: { windup: {...joint angles}, strike: {...}, spinTurns, limb } */
function cleanPose(p) {
  if (!p || typeof p !== 'object') return null;
  const one = (src) => {
    if (!src || typeof src !== 'object') return null;
    const o = { ...NEUTRAL };
    for (const k of Object.keys(NEUTRAL)) if (isNum(src[k])) o[k] = src[k];
    return o;
  };
  const windup = one(p.windup), strike = one(p.strike);
  if (!windup || !strike) return null;
  return { windup, strike, spinTurns: clamp(num(p.spinTurns, 0), -4, 4), limb: typeof p.limb === 'string' ? p.limb : 'frontHand' };
}

function genericMove(slot, category) {
  const cat = CATEGORIES[category];
  const up = slot.startsWith('u');
  const down = slot.startsWith('d');
  return {
    name: slot,
    duration: cat.minDuration + 10,
    hitboxes: [{ start: cat.minStartup + 2, end: cat.minStartup + 5, x: up ? 10 : 38, y: up ? -95 : down ? -10 : -50, r: 22, damage: Math.round(cat.maxHit * 0.5), angle: up ? 85 : 40, knockback: 25, growth: 55 }],
    velocity: slot === 'upSpecial' ? [{ start: 4, end: 16, vy: -12 }] : [],
  };
}

export function defaultAnim(slot) {
  return {
    jab: 'jab', side: 'punch', up: 'uppercut', down: 'sweep', sideSmash: 'heavyPunch', upSmash: 'upSmash', downSmash: 'splits',
    nair: 'spin', fair: 'airKick', bair: 'backKick', uair: 'flipKick', dair: 'stomp',
    neutralSpecial: 'cast', sideSpecial: 'dash', upSpecial: 'rise', downSpecial: 'slam',
  }[slot];
}

function deepFreeze(o) {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); });
  return Object.freeze(o);
}
