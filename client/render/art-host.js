// ─────────────────────────────────────────────────────────────────────────────
// ART HOST — runs a character's ArtDef (spec §6.1-6.3, 6.5, 6.7, §8 art shims).
//
// One ArtHost per loaded character. It turns snapshot fighters into the art
// `view` (§6.2), builds `info` per draw, calls the art hooks behind guards
// (state isolation, save/restore stack check, warn-once errors), paints fighters
// into bounds-sized offscreen canvases, draws entities, trails and portraits.
// Identical online and offline: everything is derived from the snapshot plus
// the IR / validated character, never from the live simulation.
//
// No DOM access at import time: canvases come from `makeCanvas` (OffscreenCanvas,
// <canvas>, or a mock in Node tests).
//
//   const host = new ArtHost(entry, { makeCanvas, lab });
//   const view = host.view(snapFighter, rosterRec, { simFrame });
//   const info = host.info(view, host.fighter(id), { time, dt, frame, fx, light });
//   host.paint(view, info, zoom) → { canvas, ox, oy, w, h }   (body draw, mirrored, clipped)
//   host.drawBack / drawWorld / trail / drawEntity / portrait / preview
// ─────────────────────────────────────────────────────────────────────────────
import * as kit from '../../shared/art/kit.js';
import { humanoid, v1ArtShim, DEFAULT_PALETTE, buildRig } from '../../shared/art/puppet.js';
import { computePose } from '../../shared/art/anims.js';
import { makeSprite } from '../../shared/art/sprite.js';
import { mulberry32, hash32 } from '../../shared/sim/rng.js';

export const DEFAULT_LIGHT = Object.freeze({ dir: Object.freeze({ x: -0.45, y: -0.89 }), rim: '#ffc48a', ambient: '#2a1f3d' });
export const PHASE_NAMES = Object.freeze(['startup', 'active', 'recovery', 'charge', 'hold']);
export const CONTROL_NAMES = Object.freeze(['stun', 'freeze', 'root', 'silence', 'confuse']);
export const ENTITY_KINDS = Object.freeze(['projectile', 'minion', 'trap', 'zone', 'beam', 'clone', 'part']);
export const BOUNDS_LIMIT = Object.freeze({ perAxis: 4, total: 900, pad: 1.4 });
export const PERF = Object.freeze({ warnMs: 2, lowMs: 4, recoverMs: 1.5 });
const CROUCH = 0.68;
const DEG = Math.PI / 180;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);

// ── ArtDef resolution (§6.1, §8) ────────────────────────────────────────────

/**
 * The ArtDef for a character module's default export. v1 files: art with draw →
 * v1ArtShim(art), otherwise humanoid(art). v2 files: humanoid() outputs pass
 * through; no draw → sprites (sheets/clips), shapes (rig 'none') or humanoid(art).
 */
export function resolveArtDef(def) {
  const raw = (def && typeof def.art === 'object' && def.art) || {};
  if (raw.kind === 'humanoid' || raw.kind === 'v1shim') return raw;
  const v1 = !def || def.version === undefined || def.version === 1;
  if (v1) return typeof raw.draw === 'function' ? v1ArtShim(raw) : humanoid(raw);
  if (typeof raw.draw === 'function') return raw;
  if (raw.sheets && raw.clips) return { ...raw, rig: raw.rig || 'none', draw: spriteAutoDraw, auto: 'sprite' };
  if (raw.rig === 'none') return { ...raw, draw: shapeAutoDraw, auto: 'shapes' };
  return humanoid(raw);
}

// Auto-art: first clip set of the sheets.
function spriteAutoDraw(ctx, view, info) {
  const keys = Object.keys(info.sprite.clips);
  const key = keys.includes(view.form) ? view.form : keys[0];
  info.sprite.drawClip(ctx, key, view);
}

// Auto-art for rig:'none' with no draw: the hurtboxes as shaded, rim-lit shapes.
function shapeAutoDraw(ctx, view, info) {
  const P = info.palette;
  const main = P.main || P.primary || '#8a7bd6';
  for (const s of info.hurtboxes) {
    kit.shapePath(ctx, s);
    const c = kit.shapeCenter(s);
    kit.fillShaded(ctx, main, { outline: P.outline || '#16121e', lineWidth: 3, x: c.x, y: c.y, r: 30, gloss: 0.15 });
  }
  if (info.phase.name === 'active') for (const hb of info.hitboxes) kit.shapeGlow(ctx, hb, P.effect || '#ffffff', 0.35);
}

// ── Character model: one interface over the IR and the v1 validated shape ──

const v1MoveCache = new WeakMap();
/** A v1-shaped move (hitboxes x/y/r, projectiles [{start}], startup, slot) for the puppet. */
export function v1Move(def) {
  if (!def || typeof def !== 'object') return null;
  if (Array.isArray(def.projectiles)) return def; // already v1
  let m = v1MoveCache.get(def);
  if (m) return m;
  const hitboxes = (def.hitboxes || []).map((h) => {
    if (!h.shape || h.shape === 'circle') return h;
    const c = h.shape === 'capsule' ? { x: (h.x1 + h.x2) / 2, y: (h.y1 + h.y2) / 2 } : { x: h.x, y: h.y };
    const r = h.shape === 'capsule' ? h.r + Math.hypot(h.x2 - h.x1, h.y2 - h.y1) / 2 : Math.max(h.w, h.h) / 2;
    return { ...h, ...c, r };
  });
  const projectiles = [];
  for (const e of def.timeline || []) if (e.action === 'spawn' && e.when === 'at') projectiles.push({ start: e.at, ...(e.args || {}) });
  m = { ...def, slot: def.slot ?? def.key, hitboxes, projectiles, startup: def.startup ?? 1 };
  v1MoveCache.set(def, m);
  return m;
}

/** Phase window of an action: {startup, activeEnd}. */
export function moveTiming(def) {
  if (!def) return { startup: 1, activeEnd: 0 };
  if (!Array.isArray(def.projectiles) && isNum(def.startup)) {
    return { startup: Math.max(0, def.startup), activeEnd: isNum(def.activeEnd) ? def.activeEnd : def.startup - 1 };
  }
  // v1: same rule as anims.js attackPose
  const startup = Math.max(1, def.startup || 1);
  let activeEnd = startup;
  for (const h of def.hitboxes || []) activeEnd = Math.max(activeEnd, h.end);
  for (const p of def.projectiles || []) activeEnd = Math.max(activeEnd, p.start + 2);
  return { startup, activeEnd };
}

/** Phase name + progress for a move instance. */
export function movePhase(def, frame, { phase = null, charging = false, holding = false, chargeFrames = 0, holdFrames = 0 } = {}) {
  const { startup, activeEnd } = moveTiming(def);
  const duration = Math.max(1, def?.duration || 1);
  let name = phase || (charging ? 'charge' : holding ? 'hold' : frame < startup ? 'startup' : frame <= activeEnd ? 'active' : 'recovery');
  if (name === 'active' && activeEnd < startup) name = 'recovery';
  let t = 0, total = 1;
  if (name === 'startup') { total = Math.max(1, startup); t = frame / total; }
  else if (name === 'active') { total = Math.max(1, activeEnd - startup + 1); t = (frame - startup) / total; }
  else if (name === 'recovery') { const from = Math.max(startup, activeEnd + 1); total = Math.max(1, duration - from); t = (frame - from) / total; }
  else if (name === 'charge') { total = Math.max(1, def?.charge?.max || 60); t = chargeFrames / total; }
  else { total = Math.max(1, def?.hold?.max || 60); t = holdFrames / total; }
  return { name, t: clamp(t, 0, 1), total, startup, activeEnd, duration };
}

/**
 * Wraps a validated character (v2 IR or the v1 validated object) for art.
 * @param {object} character  validator output (IR has `tables` + `forms`)
 * @param {object} [ir]       IR built just for art when the validator didn't return one
 */
export function charModel(character, ir = null) {
  const c = character?.tables && character?.forms ? character : ir;
  if (c) return irModel(c, character);
  return v1Model(character || { stats: { width: 52, height: 92 }, moves: {} });
}

function v1Model(ch) {
  const w = ch.stats?.width ?? 52, h = ch.stats?.height ?? 92;
  const sets = {
    default: [{ shape: 'rect', x: 0, y: -h / 2, w, h }],
    crouch: [{ shape: 'rect', x: 0, y: -(h * CROUCH) / 2, w, h: h * CROUCH }],
  };
  const names = Object.keys(ch.moves || {}).sort();
  return {
    kind: 'v1', id: ch.id, name: ch.name, character: ch, ir: null,
    tables: { forms: ['base'], moves: names, entities: [], statuses: [], resources: [], vars: [] },
    startForm: 'base',
    collider: () => ({ w, h }),
    sets: () => sets,
    stats: () => ch.stats || {},
    move: (n) => (n != null ? ch.moves?.[n] || null : null),
    entity: () => null,
    resource: () => null,
    legacyCharacter: () => ch,
    formArtKey: () => 'base',
  };
}

function irModel(ir, validated) {
  const legacyCache = new Map();
  const form = (f) => ir.forms[f] || ir.forms.base;
  const model = {
    kind: 'ir', id: ir.id, name: ir.meta?.name || ir.id, character: validated || ir, ir,
    tables: ir.tables,
    startForm: ir.meta?.startForm || 'base',
    collider: (f) => form(f).body.collider,
    sets: (f) => form(f).body.hurtboxes,
    stats: (f) => form(f).stats,
    move: (n) => (n != null ? ir.moves[n] || null : null),
    entity: (n) => (n != null ? ir.entities[n] || null : null),
    resource: (n) => ir.resources?.[n] || null,
    formArtKey: (f) => form(f).art || f || 'base',
    /** v1-shaped character for the humanoid puppet (stats.width/height + v1 moves). */
    legacyCharacter(f = 'base') {
      let ch = legacyCache.get(f);
      if (ch) return ch;
      // v1 files: the validator keeps a v1-compatible view (stats.width/height, moves with
      // projectiles) on the IR itself — use it as-is so the puppet sees exactly v1 data.
      const compat = validated && validated.stats && isNum(validated.stats.height) && validated.moves === ir.moves;
      if (f === 'base' && compat && Object.values(ir.moves).every((m) => Array.isArray(m.projectiles))) {
        legacyCache.set(f, validated);
        return validated;
      }
      const col = form(f).body.collider;
      const moves = {};
      for (const n of ir.tables.moves) moves[n] = v1Move(ir.moves[n]);
      ch = { id: ir.id, name: model.name, stats: { ...(ir.legacy?.stats || {}), ...form(f).stats, width: col.w, height: col.h }, moves };
      legacyCache.set(f, ch);
      return ch;
    },
  };
  return model;
}

// ── Shapes for info.hitboxes / info.hurtboxes (body space, ×bodyScale) ──────
function scaleShape(s, k) {
  const shape = s.shape || (s.w !== undefined ? 'rect' : s.x1 !== undefined ? 'capsule' : 'circle');
  if (shape === 'circle') return { shape, x: s.x * k, y: s.y * k, r: s.r * k };
  if (shape === 'capsule') return { shape, x1: s.x1 * k, y1: s.y1 * k, x2: s.x2 * k, y2: s.y2 * k, r: s.r * k };
  return { shape, x: s.x * k, y: s.y * k, w: s.w * k, h: s.h * k };
}

/** Current hurt shapes (same set selection as shared/sim/hurtbox.js). */
export function hurtShapesFor(model, view) {
  const sets = model.sets(view.form);
  let shapes = null;
  const def = view.move?.def;
  if (def?.hurtboxes?.length && view.move) {
    const fr = view.move.frame;
    for (const w of def.hurtboxes) {
      if (fr >= w.from && fr <= w.to) { shapes = w.shapes || (w.set && sets[w.set]) || null; if (shapes) break; }
    }
  }
  if (!shapes && view.state === 'crouch' && sets.crouch) shapes = sets.crouch;
  if (!shapes && !view.grounded && sets.air) shapes = sets.air;
  shapes ||= sets.default || [];
  const k = view.bodyScale ?? 1;
  if (k === 1 && Object.isFrozen(shapes) && shapes.every((s) => s.shape)) return shapes; // validated IR: share, no copies
  return shapes.map((s) => scaleShape(s, k));
}

/** Active hit shapes of the current move (hitbox windows + timeline `hit` entries). */
export function hitShapesFor(view) {
  const m = view.move;
  if (!m || !m.def || view.state === 'hitstun') return [];
  if (m.phase === 'charge' || view.charging) return [];
  const fr = m.frame, def = m.def, k = view.bodyScale ?? 1;
  const out = [];
  for (const h of def.hitboxes || []) if (fr >= h.start && fr <= h.end) out.push(Object.assign(scaleShape(h, k), { group: h.group ?? 0, kind: h.kind || 'strike', effect: h.effect ?? def.effect ?? null }));
  for (const e of def.timeline || []) {
    if (e.action !== 'hit' || !e.args?.shape) continue;
    const from = e.when === 'range' ? e.from : e.at, to = e.when === 'range' ? e.to : e.at + Math.max(1, e.args.frames || 1) - 1;
    if (isNum(from) && fr >= from && fr <= to) out.push(Object.assign(scaleShape(e.args.shape, k), { group: e.args.group ?? 0, kind: 'strike' }));
  }
  return out;
}

/** Union AABB {x1,y1,x2,y2} of shapes (null when empty). */
export function shapesAABB(list) {
  let o = null;
  for (const s of list) {
    let b;
    if (s.shape === 'circle') b = [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r];
    else if (s.shape === 'capsule') b = [Math.min(s.x1, s.x2) - s.r, Math.min(s.y1, s.y2) - s.r, Math.max(s.x1, s.x2) + s.r, Math.max(s.y1, s.y2) + s.r];
    else b = [s.x - s.w / 2, s.y - s.h / 2, s.x + s.w / 2, s.y + s.h / 2];
    if (!o) o = { x1: b[0], y1: b[1], x2: b[2], y2: b[3] };
    else { o.x1 = Math.min(o.x1, b[0]); o.y1 = Math.min(o.y1, b[1]); o.x2 = Math.max(o.x2, b[2]); o.y2 = Math.max(o.y2, b[3]); }
  }
  return o;
}

// ── Guards ──────────────────────────────────────────────────────────────────

/** Resets drawing state an art hook may have changed (transform excluded). */
export function resetCtx(c) {
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.shadowBlur = 0; c.shadowColor = 'rgba(0,0,0,0)'; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
  if ('filter' in c) c.filter = 'none';
  if ('imageSmoothingEnabled' in c) c.imageSmoothingEnabled = true;
  c.setLineDash?.([]);
}

/**
 * Runs an art hook with its context isolated: outer save/restore, and a per-call
 * save/restore counter so unbalanced save() calls are popped afterwards and extra
 * restore() calls can't pop the engine's own state. Returns the thrown error or null.
 */
export function guarded(ctx, fn) {
  const hadSave = Object.prototype.hasOwnProperty.call(ctx, 'save');
  const hadRestore = Object.prototype.hasOwnProperty.call(ctx, 'restore');
  const save = ctx.save, restore = ctx.restore;
  let depth = 0, err = null;
  ctx.save();
  ctx.save = function () { depth++; save.call(this); };
  ctx.restore = function () { if (depth > 0) { depth--; restore.call(this); } };
  try { fn(); } catch (e) { err = e; } finally {
    while (depth > 0) { depth--; restore.call(ctx); }
    if (hadSave) ctx.save = save; else delete ctx.save;
    if (hadRestore) ctx.restore = restore; else delete ctx.restore;
    ctx.restore();
  }
  return err;
}

const NOOP_FX = (() => {
  const nop = () => null;
  const local = new Proxy({}, { get: () => nop });
  return Object.freeze({ burst: nop, ring: nop, line: nop, text: nop, trail: nop, afterimage: nop, decal: nop, shake: nop, flash: nop, sound: () => false, local });
})();

// ── Bounds ──────────────────────────────────────────────────────────────────
const isBounds = (b) => b && isNum(b.left) && isNum(b.right) && isNum(b.top) && isNum(b.bottom);

/** Clamp an author bounds box: each extent ≤ 4× the collider dim, total ≤ 900×900. */
export function clampBounds(b, col) {
  const L = BOUNDS_LIMIT;
  let left = Math.min(-1, Math.max(b.left, -L.perAxis * col.w)), right = Math.max(1, Math.min(b.right, L.perAxis * col.w));
  let top = Math.min(-1, Math.max(b.top, -L.perAxis * col.h)), bottom = Math.max(1, Math.min(b.bottom, L.perAxis * col.h));
  const w = right - left, h = bottom - top;
  if (w > L.total) { const k = L.total / w; left *= k; right *= k; }
  if (h > L.total) { const k = L.total / h; top *= k; bottom *= k; }
  return { left, right, top, bottom };
}

// ── The host ────────────────────────────────────────────────────────────────
export class ArtHost {
  /**
   * @param {object} entry  { id, character, def (module default), ir?, artDef?, assets?, assetsVersion? }
   * @param {object} [o]    { makeCanvas(w, h), lab, light }
   */
  constructor(entry, o = {}) {
    this.entry = entry;
    this.id = entry.id;
    this.model = charModel(entry.character, entry.ir);
    this.art = entry.artDef || resolveArtDef(entry.def || { art: entry.art });
    this.isV1 = !entry.def || entry.def.version === undefined || entry.def.version === 1;
    this.assets = entry.assets || {};
    this.assetsVersion = entry.assetsVersion || 1;
    this.makeCanvas = o.makeCanvas || kit.makeCanvas;
    this.lab = !!o.lab;
    this.light = o.light || DEFAULT_LIGHT;
    this.forms = new Map();
    this.boundsCache = new Map();
    this.fighters = new Map();
    this.portraits = new Map();
    this.warned = new Set();
    this.selfDepth = 0;
    this.clock = 0;        // info() calls (sweep timer)
    this.seen = new Map(); // clone-state / entity-cache key → last clock
  }

  /** Drops caches of clones and entities that haven't been drawn for a while. */
  sweep() {
    const old = this.clock - 600;
    for (const [k, t] of this.seen) {
      if (t > old) continue;
      this.seen.delete(k);
      if (k.startsWith('e:')) {
        const [, fid, eid] = k.split(':');
        this.fighters.get(fid)?.entityCache.delete(Number.isNaN(+eid) ? eid : +eid);
      } else this.fighters.delete(k);
    }
  }

  /** Refresh decoded assets (after async load). Invalidates portraits. */
  setAssets(assets, version) {
    this.assets = assets || {};
    this.assetsVersion = version ?? this.assetsVersion + 1;
    this.forms.clear();
    this.boundsCache.clear();
    this.portraits.clear();
  }

  warn(key, msg, e) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.error(`Art error in ${this.id} (${msg}):`, e);
  }

  // ── Per-form ArtDef (art.forms overrides, sprites per form) ───────────────
  artFor(form = 'base') {
    let a = this.forms.get(form);
    if (a) return a;
    const base = this.art;
    const key = this.model.formArtKey(form);
    const over = base.forms?.[key] || (key !== form ? base.forms?.[form] : null);
    a = over ? { ...base, ...over, entities: { ...(base.entities || {}), ...(over.entities || {}) }, fx: { ...(base.fx || {}), ...(over.fx || {}) } } : base;
    const pal = { ...(base.rig === 'humanoid' ? DEFAULT_PALETTE : {}), ...(base.palette || {}), ...(over?.palette || {}) };
    a = { ...a, palette: pal };
    a.spriteApi = makeSprite(a, this.assets, { kit, stats: (v) => this.model.stats(v?.form || form), placeholder: pal.main || pal.primary });
    this.forms.set(form, a);
    return a;
  }

  /** Palette for a duplicate ordinal (alt palettes for duplicate picks). */
  palette(form = 'base', ordinal = 0) {
    const a = this.artFor(form);
    const alts = a.palettes;
    if (!ordinal || !Array.isArray(alts) || !alts.length) return a.palette;
    const alt = alts[ordinal % alts.length];
    return alt && typeof alt === 'object' ? { ...a.palette, ...alt } : a.palette;
  }

  /** Body-space draw bounds for a form at a body scale. */
  bounds(form = 'base', scale = 1) {
    const ck = `${form}:${scale}`;
    const hit = this.boundsCache.get(ck);
    if (hit) return hit;
    const b = Object.freeze(this.computeBounds(form, scale));
    if (this.boundsCache.size > 64) this.boundsCache.clear();
    this.boundsCache.set(ck, b);
    return b;
  }

  computeBounds(form, scale) {
    const a = this.artFor(form);
    const col = this.model.collider(form);
    const k = Math.max(0.25, scale || 1);
    if (a.legacyCanvas) {
      const H = col.h;
      return { left: -1.7 * H, right: 1.7 * H, top: -2.312 * H, bottom: 1.088 * H, legacy: true };
    }
    let b = a.bounds;
    if (b && !isBounds(b)) b = b[form] || b[this.model.formArtKey(form)] || b.base || null;
    if (!isBounds(b)) {
      const sets = this.model.sets(form);
      const all = [];
      for (const n of Object.keys(sets)) all.push(...sets[n]);
      const box = shapesAABB(all.map((s) => scaleShape(s, 1))) || { x1: -col.w / 2, y1: -col.h, x2: col.w / 2, y2: 0 };
      const p = BOUNDS_LIMIT.pad;
      const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
      b = { left: cx + (box.x1 - cx) * p - 8, right: cx + (box.x2 - cx) * p + 8, top: cy + (box.y1 - cy) * p - 8, bottom: Math.max(16, cy + (box.y2 - cy) * p + 8) };
    }
    b = clampBounds(b, col);
    return k === 1 ? b : { left: b.left * k, right: b.right * k, top: b.top * k, bottom: b.bottom * k };
  }

  // ── Per-fighter render state ──────────────────────────────────────────────
  fighter(id, ordinal = 0) {
    let st = this.fighters.get(id);
    if (!st) {
      st = {
        id, ordinal, artCache: {}, initDone: false, off: null, trail: [], ribbons: new Map(),
        motion: { squash: 0, stretch: 0, lean: 0, wasGrounded: true, lastVy: 0 },
        perf: { avg: 0, n: 0, slow: 0 }, quality: 'high', frameSkip: false, lastPaint: null,
        tints: [], lastInfo: null, lastTime: null, events: [], entityCache: new Map(), seed: hash32(`${this.id}:${id}`),
      };
      this.fighters.set(id, st);
    }
    return st;
  }

  dropFighter(id) { this.fighters.delete(id); }

  // ── View (§6.2) ───────────────────────────────────────────────────────────
  /**
   * Art view for a snapshot fighter.
   * @param {object} f    snapshot fighter (v1 keys + v2 fm/r/sv/st/bs/mv/ctl/…), or a Lab view
   * @param {object} rec  roster record { index, color, tables? }
   * @param {object} [o]  { events, entities, interp }
   */
  view(f, rec = {}, o = {}) {
    const T = rec.tables || this.model.tables;
    const form = typeof f.form === 'string' ? f.form : (T.forms?.[f.fm] ?? 'base');
    const resources = {}, resMax = {};
    const resNames = rec.tables?.resources || (this.model.ir ? this.model.ir.tables.resources.filter((n) => this.model.ir.resources[n]?.sync !== false) : []);
    resNames.forEach((n, i) => {
      const def = this.model.resource(n);
      resources[n] = Array.isArray(f.r) && isNum(f.r[i]) ? f.r[i] : f.resources?.[n] ?? def?.start ?? 0;
      resMax[n] = def?.max ?? 100;
    });
    if (f.resources && !Array.isArray(f.r)) Object.assign(resources, f.resources);
    const statuses = Array.isArray(f.statuses) ? f.statuses
      : (f.st || []).map(([i, frames, stacks]) => ({ name: typeof i === 'string' ? i : T.statuses?.[i] ?? String(i), frames, stacks }));
    const control = typeof f.control === 'string' ? f.control : f.ctl ? CONTROL_NAMES[f.ctl - 1] || null : null;

    // Current move: v2 `mv`, a Lab move name/frame, or the v1 slot/moveFrame.
    let key = null, frame = 0, phaseCode = null, holdFrames = 0, chargeFrames = 0;
    if (Array.isArray(f.mv)) { key = T.moves?.[f.mv[0]] ?? null; frame = f.mv[1]; phaseCode = PHASE_NAMES[f.mv[2]] || null; holdFrames = f.mv[3] || 0; chargeFrames = f.mv[4] || 0; }
    else if (typeof f.moveName === 'string') { key = f.moveName; frame = f.moveFrame || 0; chargeFrames = f.charge || 0; holdFrames = f.hold || 0; }
    else if (f.slot && (f.state === 'attack' || f.state === 'grabbing' || f.state === 'taunt')) { key = f.slot; frame = f.moveFrame || 0; chargeFrames = f.charge || 0; }
    else if (f.move && typeof f.move === 'object' && f.state === 'attack') { key = f.move.slot ?? f.move.key ?? null; frame = f.moveFrame || 0; }
    if (!['attack', 'grabbing', 'taunt'].includes(f.state)) key = null;
    let move = null;
    const def = key != null ? this.model.move(key) || (f.move && typeof f.move === 'object' && f.move.hitboxes ? f.move : null) : null;
    if (def) {
      const ph = movePhase(def, frame, { phase: phaseCode, charging: !!f.charging && !phaseCode, chargeFrames, holdFrames });
      move = {
        name: def.name ?? key, key, slot: def.slot ?? key, anim: def.anim ?? null, def, frame, duration: ph.duration,
        phase: ph.name, phaseT: ph.t, phaseTotal: ph.total, t: clamp(frame / ph.duration, 0, 1),
        charge01: clamp(chargeFrames / Math.max(1, def.charge?.max || 60), 0, 1), chargeFrames, holdFrames,
        startup: ph.startup, activeEnd: ph.activeEnd, color: def.color ?? null, effect: def.effect ?? null,
      };
    }
    const view = {
      ...f,
      index: rec.index ?? f.index ?? 0, color: rec.color ?? f.color ?? '#ffffff', form,
      resources, resMax, vars: f.sv || f.vars || {}, statuses, bodyScale: f.bs ?? f.bodyScale ?? 1, control,
      move, events: o.events || [], entities: o.entities || [],
      hitFlash: f.hitFlash ?? (f.hitlag > 0 && f.state === 'hitstun'), interp: o.interp ?? f.interp ?? 0,
      facing: f.facing || 1, x: f.x || 0, y: f.y || 0, grounded: f.grounded !== false, vx: f.vx || 0, vy: f.vy || 0,
      state: f.state || 'idle', stateFrame: f.stateFrame || 0,
    };
    // The exact v1 view (renderer.viewFor / Lab) for the humanoid puppet.
    Object.defineProperty(view, 'legacy', { value: f.legacyView || null, enumerable: false, writable: true });
    return view;
  }

  /** v1 view for the puppet: snapshot keys + v1 move + moveFrame + doubleJumpFlip. */
  legacyView(view) {
    if (view.legacy) return view.legacy;
    const m = view.move;
    return {
      ...view,
      move: m ? v1Move(m.def) : null,
      moveFrame: m ? m.frame : view.moveFrame || 0,
      charging: m ? m.phase === 'charge' : !!view.charging,
      doubleJumpFlip: view.dj ?? view.doubleJumpFlip ?? 0,
    };
  }

  // ── Info (§6.2) ───────────────────────────────────────────────────────────
  /**
   * @param {object} view
   * @param {object} st    fighter state from fighter()
   * @param {object} [o]   { time (s), dt (s), frame (v1 frame clock), simFrame, fx, light, size, advance }
   */
  info(view, st, o = {}) {
    const host = this;
    const form = view.form || 'base';
    const art = this.artFor(form);
    const col = this.model.collider(form);
    const time = o.time ?? 0;
    const dt = o.dt ?? clamp(st.lastTime == null ? 1 / 60 : time - st.lastTime, 0, 0.1);
    if (o.advance !== false) { st.lastTime = time; this.updateMotion(view, st, dt); }
    const simFrame = o.simFrame ?? 0;
    const hurtboxes = hurtShapesFor(this.model, view);
    const hitboxes = hitShapesFor(view);
    const m = view.move;
    const palette = o.palette || this.palette(form, st.ordinal);
    const frameClock = o.frame ?? Math.round(time * 60);
    const seed = (st.seed ^ Math.imul(simFrame | 0, 0x9e3779b1)) >>> 0;
    const info = {
      kit, palette, time, dt, simFrame, frame: frameClock, cache: st.artCache, assets: this.assets,
      sprite: art.spriteApi, hitboxes, hurtboxes,
      phase: m ? { name: m.phase, t: m.phaseT, total: m.phaseTotal } : { name: null, t: 0, total: 0 },
      fx: o.fx || NOOP_FX, light: o.light || this.light, motion: { squash: st.motion.squash, stretch: st.motion.stretch, lean: st.motion.lean },
      rng: mulberry32(seed), quality: st.quality, lab: this.lab,
      u: col.h / 100, H: col.h, W: col.w, form, bounds: this.bounds(form, view.bodyScale), size: o.size ?? null,
      limb: m ? (m.def?.pose?.limb || null) : null,
      tint(color, alpha = 0.3) { if (typeof color === 'string' && st.tints.length < 4) st.tints.push([color, clamp(+alpha || 0, 0, 0.8)]); },
      drawIdle(ctx, opts = {}) { host.drawIdle(ctx, { size: info.size, palette, ...opts }); },
      drawSelf(ctx, v, opts = {}) { host.drawSelf(ctx, v, st, opts, info); },
    };
    // Lazy, non-enumerable: built only if a hook reads them.
    let rig = null, legacy = null;
    Object.defineProperty(info, 'legacy', {
      enumerable: false,
      get() {
        return (legacy ||= { character: host.model.legacyCharacter(form), view: host.legacyView(view), time: frameClock });
      },
    });
    Object.defineProperty(info, 'rig', {
      enumerable: false, configurable: true,
      get() {
        if (rig) return rig;
        const L = info.legacy;
        const pv = { ...L.view, time: frameClock };
        const pose = computePose(pv, L.character.stats);
        if (typeof art.spec?.pose === 'function') Object.assign(pose, art.spec.pose(pose, pv) || {});
        const grounded = L.view.grounded && !['roll', 'airdodge', 'hitstun'].includes(L.view.state);
        rig = buildRig(pose, col.h, art.spec?.build || art.build, grounded);
        rig.pose = pose;
        return rig;
      },
    });
    st.lastInfo = info;
    if (o.advance !== false && ++this.clock % 120 === 0) this.sweep();
    return info;
  }

  updateMotion(view, st, dt) {
    const m = st.motion;
    const g = view.grounded;
    if (g && !m.wasGrounded && m.lastVy > 2) m.squash = Math.max(m.squash, clamp(m.lastVy / 14, 0.15, 1));
    if (view.state === 'jumpsquat') m.squash = Math.max(m.squash, 0.6);
    m.squash *= Math.exp(-dt * 9);
    if (m.squash < 0.002) m.squash = 0;
    const stats = this.model.stats(view.form) || {};
    m.stretch = g ? 0 : clamp(Math.abs(view.vy) / Math.max(4, (stats.fallSpeed || 10) * 1.4), 0, 1);
    m.lean = clamp(((view.vx || 0) * (view.facing || 1)) / Math.max(1, stats.runSpeed || 6), -1, 1);
    m.wasGrounded = g; m.lastVy = view.vy || 0;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  /** Calls art.init once per fighter cache. */
  ensureInit(st, info, art) {
    if (st.initDone) return;
    st.initDone = true;
    if (typeof art.init === 'function') {
      try { art.init(st.artCache, info); } catch (e) { this.warn('init', 'init', e); }
    }
  }

  /**
   * Body draw at the current transform (body space: feet origin, +x forward,
   * already mirrored). Returns null or the error thrown.
   */
  drawBody(ctx, view, info, st) {
    const art = this.artFor(view.form);
    this.ensureInit(st, info, art);
    if (typeof art.draw !== 'function') return null;
    return guarded(ctx, () => art.draw(ctx, view, info));
  }

  /** Magenta hurtboxes (v1 behavior when a draw throws). */
  drawError(ctx, info) {
    ctx.save();
    resetCtx(ctx);
    ctx.fillStyle = '#f0f';
    for (const s of info.hurtboxes) { kit.shapePath(ctx, s); ctx.fill(); }
    ctx.restore();
  }

  /**
   * Paints the fighter's body into its offscreen canvas at `zoom` device px per
   * world px, mirrored by facing and clipped to bounds; applies tints (art + o.tints) and the
   * global flash overlays. Returns { canvas, ox, oy, w, h } (ox/oy = feet in canvas px).
   * @param {object} [o] { overlay: 'hit'|'charge'|'shieldbreak'|null, overlayAlpha, frameTime }
   */
  paint(view, info, st, zoom, o = {}) {
    const b = this.bounds(view.form, view.bodyScale);
    const facing = view.facing < 0 ? -1 : 1;
    let w, h, ox, oy;
    if (b.legacy) {
      const S = Math.ceil(info.H * 3.4 * zoom); // v1 layout, pixel-identical
      w = h = S; ox = S / 2; oy = S * 0.68;
    } else {
      w = Math.max(1, Math.ceil((b.right - b.left) * zoom)); h = Math.max(1, Math.ceil((b.bottom - b.top) * zoom));
      ox = (facing > 0 ? -b.left : b.right) * zoom; oy = -b.top * zoom;
    }
    // Low quality: redraw every other frame from cache (same size, same facing).
    const lp = st.lastPaint;
    if (st.quality === 'low' && lp && lp.w === w && lp.h === h && lp.ox === ox && (st.frameSkip = !st.frameSkip)) return lp;
    let oc = st.off;
    if (!oc) { oc = st.off = this.makeCanvas(w, h); if (!oc) return null; }
    if (oc.width !== w || oc.height !== h) { oc.width = w; oc.height = h; }
    const c = oc.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    resetCtx(c);
    c.clearRect(0, 0, w, h);
    c.setTransform(zoom * facing, 0, 0, zoom, ox, oy);
    st.tints.length = 0;
    const t0 = nowMs();
    const err = this.drawBody(c, view, info, st);
    this.notePerf(st, nowMs() - t0);
    if (err) {
      this.warn(`draw:${st.id}`, 'draw', err);
      c.setTransform(zoom, 0, 0, zoom, ox, oy);
      this.drawError(c, info);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    resetCtx(c);
    c.globalCompositeOperation = 'source-atop';
    for (const [color, a] of st.tints) { c.fillStyle = kit.rgba(color, a); c.fillRect(0, 0, w, h); }
    if (o.tints) for (const [color, a] of o.tints) { c.fillStyle = kit.rgba(color, a); c.fillRect(0, 0, w, h); } // engine status tints
    if (o.overlay) { c.fillStyle = o.overlay; c.fillRect(0, 0, w, h); }
    c.globalCompositeOperation = 'source-over';
    st.lastPaint = { canvas: oc, ox, oy, w, h, zoom, error: !!err };
    return st.lastPaint;
  }

  notePerf(st, ms) {
    const p = st.perf;
    p.n++;
    p.avg = p.n < 10 ? p.avg + (ms - p.avg) / p.n : p.avg * 0.95 + ms * 0.05;
    p.last = ms;
    if (p.n > 30 && p.avg > PERF.lowMs) st.quality = 'low';
    else if (st.quality === 'low' && p.avg < PERF.recoverMs) st.quality = 'high';
  }

  /** drawBack / drawWorld (world space at the feet, not mirrored, unclipped). */
  drawLayer(ctx, which, view, info, st) {
    const art = this.artFor(view.form);
    const fn = art[which];
    if (typeof fn !== 'function') return;
    this.ensureInit(st, info, art);
    ctx.save();
    ctx.translate(view.x, view.y);
    const err = guarded(ctx, () => fn(ctx, view, info));
    ctx.restore();
    if (err) this.warn(`${which}:${st.id}`, which, err);
  }

  /**
   * Trail sample(s) this frame in body space: art.trail → point | null (default) | false;
   * default = centers of the active hitboxes (max 3). Returns an array (maybe empty).
   */
  trail(view, info) {
    const art = this.artFor(view.form);
    let r = null;
    if (art.trail === false) return [];
    if (typeof art.trail === 'function') {
      try { r = art.trail(view, info); } catch (e) { this.warn('trail', 'trail', e); r = false; }
      if (r === false) return [];
      if (r && isNum(r.x) && isNum(r.y)) return [r];
      if (Array.isArray(r)) return r.filter((p) => p && isNum(p.x) && isNum(p.y)).slice(0, 3);
    }
    if (!view.move || view.move.phase !== 'active') return [];
    return info.hitboxes.slice(0, 3).map((s) => kit.shapeCenter(s));
  }

  /** Idle render for portraits (info.drawIdle): focus point (body px) to the canvas center. */
  drawIdle(ctx, { focus = null, zoom = 1, size = null, palette = null, time = 0.5 } = {}) {
    const S = size || ctx.canvas?.width || 96;
    const v = this.view({ state: 'idle', stateFrame: 30, grounded: true, facing: 1, x: 0, y: 0, form: this.model.startForm }, {});
    const st = this.fighter('__idle');
    const info = this.info(v, st, { time, dt: 1 / 60, frame: 30, advance: false, palette: palette || undefined, size: S });
    const f = focus || { x: 0, y: -info.H * 0.6 };
    ctx.save();
    ctx.translate(S / 2 - f.x * zoom, S / 2 - f.y * zoom);
    ctx.scale(zoom, zoom);
    const err = this.drawBody(ctx, v, info, st);
    ctx.restore();
    if (err) this.warn('idle', 'drawIdle', err);
  }

  /** Re-draws the character with another view (clones): info.drawSelf. */
  drawSelf(ctx, v, st, opts = {}, parentInfo = null) {
    if (!v || this.selfDepth >= 2) return;
    this.selfDepth++;
    try {
      const view = v.move !== undefined && v.resources ? v : this.view(v, {});
      const cst = this.fighter(`${st.id}#self${v.id ?? ''}`, st.ordinal);
      this.seen.set(cst.id, this.clock);
      const info = this.info(view, cst, { time: parentInfo?.time, dt: parentInfo?.dt, frame: parentInfo?.frame, simFrame: parentInfo?.simFrame, fx: parentInfo?.fx, light: parentInfo?.light });
      ctx.save();
      if (isNum(opts.x) || isNum(opts.y)) ctx.translate(opts.x || 0, opts.y || 0);
      if (isNum(opts.scale)) ctx.scale(opts.scale, opts.scale);
      if (isNum(opts.alpha)) ctx.globalAlpha *= clamp(opts.alpha, 0, 1);
      const err = this.drawBody(ctx, view, info, cst);
      ctx.restore();
      if (err) this.warn('drawSelf', 'drawSelf', err);
    } finally { this.selfDepth--; }
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  /** Entity name for a snapshot entity record. */
  entityName(e, rec) {
    if (typeof e.name === 'string') return e.name;
    const T = rec?.tables || this.model.tables;
    return e.t >= 0 ? T.entities?.[e.t] ?? null : null;
  }

  /** Art-facing entity view (vx/vy and angle local to the entity's facing). */
  entityView(e, rec, ownerView = null) {
    const name = this.entityName(e, rec);
    const def = this.model.entity(name);
    const facing = (e.f ?? e.facing) < 0 ? -1 : 1;
    const age = e.g ?? e.age ?? 0, raw = e.l ?? e.life ?? 0;
    const permanent = raw < 0 || raw === Infinity; // wire -1 / sim Infinity = permanent part
    const life = permanent ? 99999 : raw; // finite so art math (life / maxLife) stays 1
    const max = permanent ? 99999 : Math.max(1, age + life);
    const wvx = e.vx || 0, wvy = e.vy || 0;
    const ev = {
      id: e.i ?? e.id, name, kind: ENTITY_KINDS[e.k] ?? def?.kind ?? 'projectile', def, owner: ownerView,
      x: e.x, y: e.y, vx: wvx * facing, vy: wvy, worldVx: wvx, worldVy: wvy,
      angle: isNum(e.a) ? e.a * DEG : 0, age, life, maxLife: max, lifeT: permanent ? 1 : clamp(life / max, 0, 1),
      hp: isNum(e.h) && e.h >= 0 ? e.h : null, len: e.n || def?.length || 0, facing, vars: e.v || e.vars || {},
      shape: def?.shape || { shape: 'circle', x: 0, y: 0, r: e.r || 10 }, render: def?.render || {}, seed: hash32(`e${e.i ?? e.id}`),
      view: null,
    };
    if (Array.isArray(e.c)) {
      const [state, stateFrame, moveIdx, frame, f, grounded] = e.c;
      const T = rec?.tables || this.model.tables;
      const key = moveIdx >= 0 ? T.moves?.[moveIdx] : null;
      ev.view = this.view({ id: ev.id, x: 0, y: 0, facing: f, state, stateFrame, grounded: !!grounded, form: ownerView?.form || 'base', moveName: key ?? undefined, moveFrame: frame, bs: ownerView?.bodyScale }, rec);
    }
    return ev;
  }

  /** Does the art draw this entity itself (art.entities[name].draw)? */
  hasEntityArt(name, form = 'base') { return typeof this.artFor(form).entities?.[name]?.draw === 'function'; }

  /**
   * Draws an entity in world space: origin at the entity, mirrored by its facing.
   * layer 'main' → entities[name].draw (or the fallback); 'world' → drawWorld.
   * o: { st (owner fighter state: per-entity caches), fallback = true }. Returns true if drawn.
   */
  drawEntity(ctx, ev, info, layer = 'main', o = {}) {
    const art = this.artFor(ev.owner?.form || 'base');
    const ea = art.entities?.[ev.name];
    const fn = layer === 'world' ? ea?.drawWorld : ea?.draw;
    if (layer === 'world' && typeof fn !== 'function') return false;
    ctx.save();
    ctx.translate(ev.x, ev.y);
    ctx.scale(ev.facing, 1);
    let ok = true;
    if (typeof fn === 'function') {
      const store = o.st?.entityCache;
      this.seen.set(`e:${o.st?.id}:${ev.id}`, this.clock);
      let ecache = store?.get(ev.id);
      if (!ecache) { ecache = {}; store?.set(ev.id, ecache); }
      const einfo = Object.create(info, { cache: { value: ecache, enumerable: true }, rng: { value: mulberry32((ev.seed ^ (info.simFrame | 0)) >>> 0), enumerable: true } });
      const err = guarded(ctx, () => fn(ctx, ev, einfo));
      if (err) { this.warn(`entity:${ev.name}`, `entities.${ev.name}`, err); this.drawEntityFallback(ctx, ev, info); }
    } else if (o.fallback !== false) {
      ok = this.drawEntityFallback(ctx, ev, info);
    } else ok = false;
    ctx.restore();
    return ok;
  }

  /** Fallback entity look: art.projectile, the v1 projectile styles, or a glowing shape. */
  drawEntityFallback(ctx, ev, info) {
    const art = this.artFor(ev.owner?.form || 'base');
    const pal = info.palette;
    const rd = ev.render || {};
    const c1 = rd.color || pal.effect || '#7fd3ff', c2 = rd.color2 || '#ffffff';
    const r = ev.shape?.r || Math.max(ev.shape?.w || 0, ev.shape?.h || 0) / 2 || 10;
    if (ev.kind === 'projectile' && typeof art.projectile === 'function') {
      const p = { ...ev, r, style: rd.style, color: rd.color, color2: rd.color2, spin: rd.spin, t: info.frame, kit, palette: pal, colors: [c2, c1, kit.shade(c1, -0.35)] };
      const err = guarded(ctx, () => art.projectile(ctx, p, info));
      if (!err) return true;
      this.warn('projectile', 'projectile', err);
    }
    if (ev.kind === 'beam' && ev.len) { kit.beam(ctx, 0, 0, ev.len, Math.max(4, (ev.def?.width || 12) / 2), c1, info.time, { core: c2 }); return true; }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, 0, 0, r * 2.2, c1, 0.55);
    ctx.restore();
    if (ev.shape) {
      kit.shapePath(ctx, ev.shape);
      ctx.fillStyle = kit.rgba(c1, 0.85); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = c2; ctx.stroke();
    }
    return true;
  }

  // ── fx hooks (§6.4): art.fx.onX(fx, ev, info) ─────────────────────────────
  /** Runs an art fx hook. kind: onHit|onHurt|onLand|onJump|onKO|onRespawn|onFormChange|onMove:<name>|onEvent:<name>. */
  fxHook(kind, fx, ev, info, form = 'base') {
    const f = this.artFor(form).fx;
    if (!f) return false;
    let fn;
    if (kind.startsWith('onMove:')) fn = f.onMove?.[kind.slice(7)];
    else if (kind.startsWith('onEvent:')) fn = f.onEvent?.[kind.slice(8)];
    else fn = f[kind];
    if (typeof fn !== 'function') return false;
    try { fn(fx, ev, info); } catch (e) { this.warn(`fx:${kind}`, `fx.${kind}`, e); }
    return true;
  }

  /** Sound mapping for an engine event / move / custom name (art.sounds). undefined = default. */
  soundFor(name, form = 'base') {
    const s = this.artFor(form).sounds;
    return s && Object.prototype.hasOwnProperty.call(s, name) ? s[name] : undefined;
  }

  // ── Portraits (§6.5) ──────────────────────────────────────────────────────
  /**
   * Cached portrait canvas. Key `id:size:paletteIdx:assetsVersion(:dpr:form)`; animated
   * portraits (portrait.animated) re-render at 10 fps. o: { dpr, form, now }.
   */
  portrait(size = 96, paletteIdx = 0, o = {}) {
    const dpr = o.dpr ?? 1;
    const form = o.form && this.model.tables.forms?.includes(o.form) ? o.form : this.model.startForm;
    const key = `${this.id}:${size}:${paletteIdx}:${this.assetsVersion}:${dpr}:${form}`;
    const art = this.artFor(form);
    let p = art.portrait;
    if (p && typeof p === 'object' && !isNum(p.r) && typeof p !== 'function') {
      p = p[form] ?? p[this.model.formArtKey(form)] ?? p.base ?? null;
    }
    const animated = !!(p && p.animated) || !!art.portrait?.animated;
    const hit = this.portraits.get(key);
    const now = o.now ?? nowMs();
    if (hit && (!animated || now - hit.at < 100)) return hit.canvas;
    const c = hit?.canvas || this.makeCanvas(size * dpr, size * dpr);
    if (!c) return null;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const time = animated ? now / 1000 : 0.5;
    const v = this.view({ state: 'idle', stateFrame: 30, grounded: true, facing: 1, x: 0, y: 0, form }, {});
    const st = this.fighter(`__portrait${paletteIdx}:${form}`, paletteIdx);
    st.artCache = animated ? st.artCache : {};
    st.initDone = animated ? st.initDone : false;
    const info = this.info(v, st, { time, dt: 1 / 60, frame: 0, advance: false, size });
    let err = null;
    if (typeof p === 'function') err = guarded(ctx, () => p.call(art, ctx, size, info));
    else if (p && isNum(p.r) && p.r > 0) {
      const zoom = size / (2 * p.r);
      ctx.save();
      ctx.translate(size / 2 - (p.x || 0) * zoom, size / 2 - (p.y || 0) * zoom);
      ctx.scale(zoom, zoom);
      err = this.drawBody(ctx, v, info, st);
      ctx.restore();
    } else err = this.autoPortrait(ctx, size, v, info, st);
    if (err) {
      this.warn('portrait', 'portrait', err);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      resetCtx(ctx);
      ctx.fillStyle = art.palette?.main || art.palette?.primary || '#888';
      ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.35, 0, Math.PI * 2); ctx.fill();
    }
    this.portraits.set(key, { canvas: c, at: now });
    return c;
  }

  /**
   * Default portrait: render idle into a bounds-sized canvas, alpha-crop, frame the
   * top 60% of the opaque box (works for clouds, swarms, slimes).
   */
  autoPortrait(ctx, size, v, info, st) {
    const b = this.bounds(v.form, 1);
    const bw = b.right - b.left, bh = b.bottom - b.top;
    const k = Math.min(2, 256 / Math.max(bw, bh));
    const W = Math.ceil(bw * k), H = Math.ceil(bh * k);
    const tmp = this.makeCanvas(W, H);
    let box = null;
    if (tmp) {
      const t = tmp.getContext('2d');
      t.setTransform(k, 0, 0, k, -b.left * k, -b.top * k);
      const err = this.drawBody(t, v, info, st);
      if (err) return err;
      try {
        const d = t.getImageData(0, 0, W, H).data;
        let x1 = W, y1 = H, x2 = -1, y2 = -1;
        for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4 + 3] > 16) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
        if (x2 >= x1 && y2 >= y1) box = { x1: x1 / k + b.left, y1: y1 / k + b.top, x2: (x2 + 2) / k + b.left, y2: (y2 + 2) / k + b.top };
      } catch { box = null; }
    }
    if (!box) { const hb = shapesAABB(info.hurtboxes) || { x1: -20, y1: -60, x2: 20, y2: 0 }; box = hb; }
    const h60 = (box.y2 - box.y1) * 0.6;
    const side = Math.max(box.x2 - box.x1, h60) * 1.08;
    const cx = (box.x1 + box.x2) / 2, cy = box.y1 + h60 / 2;
    const zoom = size / side;
    ctx.save();
    ctx.translate(size / 2 - cx * zoom, size / 2 - cy * zoom);
    ctx.scale(zoom, zoom);
    const err = this.drawBody(ctx, v, info, st);
    ctx.restore();
    return err;
  }

  // ── Previews (Lab, showcase, contact sheet) ───────────────────────────────
  /**
   * Draws the character directly at the current transform (feet origin, world
   * units), mirrored by view.facing. `partial` is a snapshot-like fighter or a Lab
   * view ({state, moveName|slot, moveFrame, form, resources, …}).
   * @param {object} [o] { id = 'preview', time (s), frame (v1 clock), simFrame, palette, fx, back: true, world: true }
   * @returns {{view, info, error}}
   */
  preview(ctx, partial, o = {}) {
    const st = this.fighter(o.id || 'preview', o.ordinal || 0);
    const view = this.view({ facing: 1, x: 0, y: 0, grounded: true, state: 'idle', stateFrame: 0, ...partial }, o.rec || {});
    const info = this.info(view, st, { time: o.time ?? (o.frame ?? 0) / 60, frame: o.frame, simFrame: o.simFrame ?? o.frame, fx: o.fx, light: o.light, palette: o.palette, dt: o.dt });
    if (o.back !== false) this.drawLayer(ctx, 'drawBack', { ...view, x: 0, y: 0 }, info, st);
    ctx.save();
    ctx.scale(view.facing < 0 ? -1 : 1, 1);
    st.tints.length = 0;
    const t0 = nowMs();
    const error = this.drawBody(ctx, view, info, st);
    this.notePerf(st, nowMs() - t0);
    if (error) { this.warn(`draw:${st.id}`, 'draw', error); this.drawError(ctx, info); }
    ctx.restore();
    if (o.world !== false) this.drawLayer(ctx, 'drawWorld', { ...view, x: 0, y: 0 }, info, st);
    return { view, info, error, perf: st.perf };
  }
}
