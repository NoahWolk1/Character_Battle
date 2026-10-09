// ─────────────────────────────────────────────────────────────────────────────
// v2 damage accounting, KO estimates and the per-form power budget (§4.1.5).
//   tally(a)      every static damage source of an action (hitboxes with rehit,
//                 timeline hits/releases, entity spawns × 0.5)
//   koOf(hit)     the fixed v2 estimator (combat.js), cached per run
//   scoreAction   v1 power formula + v2 additions, × the resource-cost discount
//   budgetForms   MOVE_BUDGET per form over its 16 core triggers
// ─────────────────────────────────────────────────────────────────────────────
import { CATEGORIES, MOVE_BUDGET, REACH_BEYOND, ENTITY_RULES } from '../rules.js';
import { estimateKoPercent } from '../../sim/combat.js';
import { V1_SLOTS } from '../../char/schema.js';
import { actionTiming } from '../../char/ir.js';
import { r2 } from './area.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const c01 = (v) => clamp(v, 0, 1);
const EXCLUDED = new Set(['throw', 'pummel', 'taunt']);

/** Limits row for a category (falls back to special). */
export const rowOf = (cat) => CATEGORIES[cat] || CATEGORIES.special;

// ── KO estimates ────────────────────────────────────────────────────────────
/**
 * v2 KO estimate (pre-hit %, Infinity = never). `floor` models the runtime
 * offstage-spike cap; `canCharge` adds the ×1.4 full-charge case.
 */
export function koOf(hit, { floor, canCharge = false, cache } = {}) {
  const key = `${hit.damage}|${hit.angle}|${hit.knockback}|${hit.growth}|${hit.setKnockback}|${floor}|${canCharge ? 1 : 0}`;
  if (cache && cache.has(key)) return cache.get(key);
  const opts = { canCharge };
  if (floor !== undefined && floor !== null) opts.floor = floor;
  const v = estimateKoPercent({ damage: hit.damage, angle: hit.angle, knockback: hit.knockback, growth: hit.growth, setKnockback: hit.setKnockback ?? undefined }, opts);
  if (cache) cache.set(key, v);
  return v;
}

/**
 * Scale knockback/growth (and setKnockback) down until the hit no longer KOs below `floor`.
 * Binary search on one factor, so it costs ≤ 14 estimates. Returns {before, after, k} or null.
 */
export function capKo(hit, floor, { canCharge = false, cache } = {}) {
  const before = koOf(hit, { floor, canCharge, cache });
  if (before >= floor) return null;
  const orig = { knockback: hit.knockback, growth: hit.growth, setKnockback: hit.setKnockback };
  const at = (k) => ({ ...hit, knockback: r2(orig.knockback * k), growth: r2(orig.growth * k), setKnockback: typeof orig.setKnockback === 'number' ? r2(orig.setKnockback * k) : orig.setKnockback });
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (koOf(at(mid), { floor, canCharge, cache }) >= floor) lo = mid; else hi = mid;
  }
  const fin = at(lo);
  hit.knockback = fin.knockback; hit.growth = fin.growth; hit.setKnockback = fin.setKnockback;
  return { before, after: koOf(hit, { floor, canCharge, cache }), k: lo };
}

// ── Damage accounting ───────────────────────────────────────────────────────
/** Hits one box can land on one target in its window. */
export const boxHits = (h) => (h.rehit ? Math.ceil((h.end - h.start + 1) / h.rehit) : 1);

/**
 * Hits one entity box can land on one target, mirroring entities.hitLimit (owner decision d):
 * projectiles/traps stop after maxHits + pierce; other kinds rehit for their whole window
 * unless maxHits > 1 is set (priced up to UNLIMITED_HITS rehits).
 */
export const UNLIMITED_HITS = 4;
export function entityBoxHits(e, h) {
  const life = Math.max(1, Math.min(e.life, h.end) - h.start + 1);
  const windows = h.rehit ? Math.ceil(life / h.rehit) : 1;
  const max = Math.max(1, e.maxHits);
  if (e.kind !== 'projectile' && e.kind !== 'trap' && max <= 1) return Math.min(windows, UNLIMITED_HITS);
  return Math.min(max + Math.max(0, e.pierce), windows);
}

/** Damage of the `hit` entries in an entity's lists (each list fires about once). draft: templates. */
function listHitDamage(e, draft) {
  if (!draft) return 0;
  let t = 0;
  for (const k of ['onSpawn', 'onExpire', 'onDeath', 'onHit']) {
    let m = 0;
    for (const x of e[k] || []) if (x.action === 'hit' && draft.hitboxes[x.args.template]) m = Math.max(m, draft.hitboxes[x.args.template].damage);
    t += m;
  }
  return t;
}

/** Static damage of one spawned entity (before × count × share), §4.1.3. draft (optional): list hits. */
export function entityDamage(e, draft = null) {
  if (!e || e.kind === 'clone') return 0;
  if (e.kind === 'part') return listHitDamage(e, draft);
  const groups = new Map();
  for (const h of e.hitboxes) {
    if (h.kind === 'wind' || h.kind === 'grab') continue;
    groups.set(h.group, Math.max(groups.get(h.group) || 0, h.damage * entityBoxHits(e, h)));
  }
  let t = listHitDamage(e, draft);
  for (const v of groups.values()) t += v;
  return t;
}

/**
 * Wind displacement (px) a set of boxes can impose on one target: push × hits, ≤ 6 px per frame
 * of the union window. Entities pass themselves for their rehit/hit rules.
 */
export function windDisplacement(boxes, e = null) {
  let px = 0, lo = Infinity, hi = -Infinity;
  for (const h of boxes) {
    if (h.kind !== 'wind' || !(h.push > 0)) continue;
    const end = e ? Math.min(e.life, h.end) : h.end;
    px += h.push * (e ? (h.rehit ? Math.ceil(Math.max(1, end - h.start + 1) / h.rehit) : 1) : boxHits(h));
    lo = Math.min(lo, h.start); hi = Math.max(hi, end);
  }
  return px > 0 ? Math.min(px, 6 * (hi - lo + 1)) : 0;
}

/** Spawns the Governor lets one action make (≤ 4 per 60 frames, §4.2.8) — the static count is capped at this. */
export const spawnCap = (a) => 4 * Math.max(1, Math.ceil(a.duration / 60));

/** Executions of a timeline entry (range entries repeat every `every`). */
export const execs = (e) => (e.when === 'range' ? Math.floor((e.to - e.from) / Math.max(1, e.every)) + 1 : 1);

/**
 * Every static damage source of an action. env = {draft, builtins}.
 * @returns {{own, ext, total, extraHits, spawns, statuses, stunFrames, hits: object[]}}
 *   hits: the hit records whose numbers count (hitboxes, release hits) for KO/score.
 */
export function tally(a, env) {
  const { draft } = env;
  const groups = new Map();
  let extraHits = 0, spawns = 0, ext = 0;
  let wind = windDisplacement(a.hitboxes);
  const statuses = [];
  const put = (key, v) => groups.set(key, Math.max(groups.get(key) || 0, v));
  for (const h of a.hitboxes) {
    const n = boxHits(h);
    put(`g${h.group}`, h.damage * n);
    extraHits += n - 1;
    if (h.status) statuses.push(h.status);
  }
  a.timeline.forEach((e, i) => {
    const x = execs(e);
    if (e.action === 'hit') {
      const t = draft.hitboxes[e.args.template];
      if (!t) return;
      put(e.args.group !== null ? `g${e.args.group}` : `t${i}`, t.damage * x);
      extraHits += x - 1;
      if (t.status) statuses.push(t.status);
    } else if (e.action === 'release') {
      put(`r${i}`, e.args.hit.damage * x);
      if (e.args.hit.status) statuses.push(e.args.hit.status);
    } else if (e.action === 'spawn') {
      const ent = draft.entities[e.args.entity];
      const n = Math.min(e.args.count * x, spawnCap(a));
      spawns += n;
      ext += entityDamage(ent, draft) * n * ENTITY_RULES.damageShare;
      if (ent) wind += windDisplacement(ent.hitboxes, ent) * n;
    }
  });
  // move.update scripts: templates named in api.hit('…') strike like one timeline hit.
  const sh = scriptRefs(draft).moves[a.key];
  if (sh) {
    let m = 0;
    for (const n of sh.hits) if (draft.hitboxes[n]) { m = Math.max(m, draft.hitboxes[n].damage); if (draft.hitboxes[n].status) statuses.push(draft.hitboxes[n].status); }
    put('script', m);
  }
  let own = 0;
  for (const v of groups.values()) own += v;
  let stunFrames = 0;
  for (const s of statuses) {
    const def = draft.statuses[s.name] || env.builtins[s.name];
    if (def && (def.control === 'stun' || def.control === 'freeze')) stunFrames += s.frames ?? def.frames;
  }
  return { own: r2(own), ext: r2(ext), total: r2(own + ext), extraHits, spawns, statuses: statuses.length, stunFrames, wind: Math.round(wind) };
}

// ── Script references (static scan; scripts stay runtime-governed) ──────────
const scriptCache = new WeakMap();
const srcOf = (fn) => { try { return typeof fn === 'function' ? Function.prototype.toString.call(fn) : ''; } catch { return ''; } };

/**
 * Templates and statuses named by api.hit / api.status in the character's scripts.
 * A non-literal template name counts as every template. Cached per draft.
 * @returns {{moves: {[key]: {hits: string[]}}, hooks: {hits: string[], tick: boolean, statuses: string[]}}}
 */
export function scriptRefs(draft) {
  let r = scriptCache.get(draft);
  if (r) return r;
  const all = Object.keys(draft.hitboxes || {}).sort();
  const scan = (src) => {
    const hits = new Set(), statuses = new Set();
    for (const m of src.matchAll(/\.hit\(\s*(?:(['"`])([^'"`]{1,64})\1)?/g)) {
      if (m[2] !== undefined) { if (all.includes(m[2])) hits.add(m[2]); } else for (const n of all) hits.add(n);
    }
    for (const m of src.matchAll(/\.status\(\s*([^,)]{1,80}),\s*(['"`])([^'"`]{1,64})\2/g)) if (!/^['"`]self['"`]$/.test(m[1].trim())) statuses.add(m[3]);
    return { hits: [...hits].sort(), statuses: [...statuses].sort() };
  };
  r = { moves: {}, hooks: { hits: [], tick: false, statuses: [] } };
  for (const [k, a] of Object.entries(draft.moves || {})) {
    const x = scan(srcOf(a.update));
    if (x.hits.length) r.moves[k] = { hits: x.hits };
    r.hooks.statuses.push(...x.statuses);
  }
  const hooks = new Set();
  for (const [h, fn] of Object.entries(draft.behavior || {})) {
    const x = scan(srcOf(fn));
    for (const n of x.hits) hooks.add(n);
    if (h === 'tick' && x.hits.length) r.hooks.tick = true;
    r.hooks.statuses.push(...x.statuses);
  }
  for (const e of Object.values(draft.entities || {})) {
    const x = scan(srcOf(e.think));
    for (const n of x.hits) hooks.add(n);
    r.hooks.statuses.push(...x.statuses);
  }
  r.hooks.hits = [...hooks].sort();
  r.hooks.statuses = [...new Set(r.hooks.statuses)].sort();
  scriptCache.set(draft, r);
  return r;
}

/**
 * Power of script-only damage and statuses (added to every form): each template a behavior
 * hook or entity think can api.hit is priced like an instant special (× 1.5 when called from tick);
 * each status scripts put on others costs like a hitbox status (+ control frames).
 */
export function scriptedPower(draft, env = {}) {
  const r = scriptRefs(draft);
  const row = rowOf('special');
  let p = 0;
  for (const n of r.hooks.hits) {
    const t = draft.hitboxes[n];
    if (!t || !(t.damage > 0 || t.push > 0)) continue;
    const ko = t.kind === 'strike' ? koOf(t, { floor: row.koFloor, cache: env.cache }) : Infinity;
    const koEff = Number.isFinite(ko) ? c01((row.koFloor * 2.2 - ko) / (row.koFloor * 1.2)) : 0;
    let q = 10 * (0.32 * c01(t.damage / row.maxTotal) + 0.26 * koEff + 0.16) + (t.push > 0 ? t.push / 2 : 0);
    if (t.status) q += 1;
    p += r.hooks.tick ? 1.5 * q : q;
  }
  for (const n of r.hooks.statuses) {
    const def = draft.statuses?.[n] || env.builtins?.[n];
    if (!def) continue;
    p += 1 + (def.control ? 0.05 * (def.frames || 0) : 0) + (def.mods && Object.keys(def.mods).length ? 0.5 : 0);
  }
  return r2(p);
}

/** Strike-like hit records of an action whose knockback matters (hitboxes + throw releases). */
export function strikeHits(a) {
  const out = a.hitboxes.filter((h) => h.kind === 'strike' || h.kind === 'wind');
  for (const e of a.timeline) if (e.action === 'release') out.push(e.args.hit);
  return out;
}

// ── Power score (§4.1.5) ────────────────────────────────────────────────────
const intangibleFrames = (a) => a.intangible.reduce((s, [x, y]) => s + Math.max(0, y - x + 1), 0)
  + a.timeline.filter((e) => e.action === 'intangible').reduce((s, e) => s + e.args.frames * execs(e), 0);

/**
 * Power of one action (≈ 0–10 before additions). env: {draft, builtins, cache, reach: {name: px}}.
 */
export function scoreAction(a, env) {
  const row = rowOf(a.category);
  const t = tally(a, env);
  let bestKo = Infinity;
  const floor = Number.isFinite(row.koFloor) ? row.koFloor : undefined;
  for (const h of strikeHits(a)) bestKo = Math.min(bestKo, koOf(h, { floor, canCharge: !!a.charge, cache: env.cache }));
  const startup = actionTiming(a).startup;
  const reach = env.reach?.[a.key] ?? 0;
  const dmgEff = row.maxTotal > 0 ? c01(t.total / row.maxTotal) : 0;
  const koEff = Number.isFinite(bestKo) && Number.isFinite(row.koFloor) ? c01((row.koFloor * 2.2 - bestKo) / (row.koFloor * 1.2)) : 0;
  const speedEff = c01((row.minStartup * 3 - startup) / (row.minStartup * 2));
  const frameEff = c01((row.minDuration * 2 - a.duration) / row.minDuration);
  const reachEff = c01(reach / (REACH_BEYOND[a.category] || REACH_BEYOND.special));
  let power = 10 * (0.32 * dmgEff + 0.26 * koEff + 0.16 * speedEff + 0.14 * frameEff + 0.12 * reachEff);
  power += 1.5 * t.spawns + 0.5 * t.extraHits + 1 * t.statuses + 0.1 * t.stunFrames + t.wind / 120;
  for (const w of a.armor) power += 0.05 * w.threshold * Math.max(0, w.to - w.from + 1);
  for (const e of a.timeline) if (e.action === 'armor') power += 0.05 * e.args.threshold * e.args.frames * execs(e);
  if (a.category === 'grab' || a.hitboxes.some((h) => h.kind === 'grab')) power += 2;
  power += 0.15 * intangibleFrames(a);
  if (a.cost) {
    let frac = 0;
    for (const [res, n] of Object.entries(a.cost)) { const r = env.draft.resources[res]; if (r && r.max > r.min) frac += Math.max(0, n) / (r.max - r.min); }
    power *= 0.85 + 0.15 * (1 - c01(frac));
  }
  return {
    category: a.category, startup, duration: a.duration, totalDamage: t.total, ownDamage: t.own, entityDamage: t.ext,
    koPercent: bestKo, reach: Math.round(reach), power: r2(power), spawns: t.spawns, extraHits: t.extraHits, wind: t.wind,
  };
}

/** Weaken one action's own strikes (damage, knockback, growth) by k. */
export function weaken(a, k) {
  for (const h of strikeHits(a)) {
    h.damage = r2(h.damage * k);
    h.knockback = r2(h.knockback * k);
    h.growth = r2(h.growth * k);
    if (typeof h.setKnockback === 'number') h.setKnockback = r2(h.setKnockback * k);
  }
}

/** Trim the fixed-bonus extras of one action (phase 2). Returns true if something changed. */
function trimExtras(a, env) {
  let did = false;
  for (const w of a.intangible) if (w[1] >= w[0]) { w[1] -= 2; did = true; }
  a.intangible = a.intangible.filter((w) => w[1] >= w[0]);
  for (const w of a.armor) if (w.threshold > 0) { w.threshold = w.threshold * 0.8 < 0.5 ? 0 : r2(w.threshold * 0.8); did = true; }
  for (const h of a.hitboxes) if (h.rehit && h.rehit < 60) { h.rehit = Math.min(60, h.rehit + 2); did = true; }
  for (const h of strikeHits(a)) {
    if (!h.status) continue;
    const def = env.draft.statuses[h.status.name] || env.builtins[h.status.name];
    const f = h.status.frames ?? def?.frames ?? 0;
    h.status = f > 10 ? { ...h.status, frames: Math.floor(f * 0.75) } : null;
    did = true;
  }
  for (const e of a.timeline) {
    const g = e.args;
    if (e.action === 'intangible' && g.frames > 0) { g.frames = Math.max(0, g.frames - 2); did = true; }
    else if (e.action === 'armor' && g.threshold > 0) { g.threshold = g.threshold * 0.8 < 0.5 ? 0 : r2(g.threshold * 0.8); did = true; }
    else if (e.action === 'spawn' && g.count > 1) { g.count--; did = true; }
    else if ((e.action === 'spawn' || e.action === 'hit') && e.when === 'range' && execs(e) > 1) { e.every = Math.min(e.to - e.from + 1, e.every * 2); did = true; }
  }
  return did;
}

/** Moves a slot move reaches through cancels / next / else / counter.then / hold.release. */
function linked(a, moves) {
  const out = new Set();
  for (const n of [a.else, a.next, a.counter?.then, typeof a.hold?.release === 'string' ? a.hold.release : null]) if (n && moves[n]) out.add(n);
  for (const c of a.cancels) for (const n of c.into) if (moves[n]) out.add(n);
  out.delete(a.key);
  return [...out].sort();
}

/** Power of one form: Σ over the 16 core triggers (+50% of linked-only moves) + scripted power. */
export function formPower(draft, form, scores, env = null) {
  const slots = draft.forms[form].slots;
  const cands = draft.forms[form].slotMoves || {};
  const core = new Set(V1_SLOTS.flatMap((t) => [slots[t], ...(cands[t] || [])]));
  let total = 0;
  const per = {};
  for (const t of V1_SLOTS) {
    let best = null;
    // A slot function can return any of its candidates: price the strongest.
    for (const n of [slots[t], ...(cands[t] || [])]) {
      const a = draft.moves[n];
      if (!a || EXCLUDED.has(a.category)) continue;
      let p = scores[n].power;
      for (const l of linked(a, draft.moves)) if (!core.has(l) && !EXCLUDED.has(draft.moves[l].category)) p += 0.5 * scores[l].power;
      if (best === null || p > best) best = p;
    }
    if (best === null) continue;
    per[t] = r2(best);
    total += best;
  }
  const sp = scriptedPower(draft, env || {});
  if (sp > 0) { per.scripts = sp; total += sp; }
  return { total: r2(total), per };
}

/**
 * Enforce MOVE_BUDGET per form (mutates draft moves). Returns {scores, power: {form: {total, per}}}.
 * env: {draft, builtins, cache, reach, notes, rescore(name)}.
 */
export function budgetForms(env) {
  const { draft, notes } = env;
  const names = Object.keys(draft.moves).sort();
  const scores = {};
  const rescore = (n) => { scores[n] = scoreAction(draft.moves[n], env); };
  names.forEach(rescore);
  const power = {};
  for (const form of draft.formOrder) {
    let fp = formPower(draft, form, scores, env);
    const before = fp.total;
    if (fp.total > MOVE_BUDGET) {
      const sm = draft.forms[form].slotMoves || {};
      const core = [...new Set(V1_SLOTS.flatMap((t) => [draft.forms[form].slots[t], ...(sm[t] || [])]))].filter((n) => draft.moves[n] && !EXCLUDED.has(draft.moves[n].category)).sort();
      for (let iter = 0; iter < 60 && fp.total > MOVE_BUDGET; iter++) {
        const avg = fp.total / V1_SLOTS.length;
        for (const n of core) if (scores[n].power > avg * 0.9) { weaken(draft.moves[n], 0.94); rescore(n); }
        fp = formPower(draft, form, scores, env);
      }
      let trimmed = 0;
      for (let iter = 0; iter < 400 && fp.total > MOVE_BUDGET; iter++) {
        const order = [...core].sort((x, y) => scores[y].power - scores[x].power || (x < y ? -1 : 1));
        const n = order.find((m) => trimExtras(draft.moves[m], env));
        if (!n) break;
        trimmed++;
        rescore(n);
        fp = formPower(draft, form, scores, env);
      }
      const P = form === 'base' ? 'moves' : `forms.${form}`;
      notes.add('W601', P, `form ${form} move power ${before} is over the budget of ${MOVE_BUDGET}; its strongest moves were scaled down → ${fp.total}.`,
        { from: before, to: fp.total, rule: 'MOVE_BUDGET', fix: 'make a few moves slower, shorter-ranged or weaker on purpose, or put strong moves behind a resource cost (discount up to 15%).' });
      if (trimmed) notes.add('W602', P, `fixed bonuses (intangibility, armor, rehits, spawn counts) were trimmed ${trimmed} time(s) to fit the budget.`, { rule: 'MOVE_BUDGET' });
    }
    power[form] = fp;
  }
  // Earlier forms can only have gone down; recompute all for the report.
  for (const form of draft.formOrder) power[form] = formPower(draft, form, scores, env);
  return { scores, power };
}

