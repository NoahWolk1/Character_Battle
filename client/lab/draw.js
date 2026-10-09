// Art Lab drawing (browser): character / entity tiles through the art host,
// shape-accurate box overlays, silhouette + status tints, the §6.6 pixel
// checks and the contact sheet. Pure math lives in ./core.js.
import * as kit from '../../shared/art/kit.js';
import { SkySanctumArt } from '../render/stages/sky-sanctum.js';
import { hitShapesFor } from '../render/art-host.js';
import { BUILTIN_STATUSES } from '../../shared/char/schema.js';
import * as core from './core.js';
import {
  frameBox, fitTransform, entityRecord, entityBox, alphaMask, hitboxCoverage, hurtboxFit, edgeTouches,
  meanLightness, evaluate, moveList, moveView, stateList, activeWindow, sheetLayout, formForMove, strikeFrame,
} from './core.js';

const nowMs = () => performance.now();
let scratch = null;
function layerCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ── Stage reference (lighting + contrast) ──────────────────────────────────
let stageRef = null;
/** Stage art light and mean L* of the backdrop behind fighters (cached). */
export function stageReference(stage) {
  if (stageRef) return stageRef;
  const art = new SkySanctumArt(stage);
  const w = 320, h = 180;
  const c = layerCanvas(w, h);
  const ctx = c.getContext('2d');
  let L = 40;
  try {
    art.drawBackground(ctx, { x: 0, y: -200, zoom: 0.6, w, h }, 0);
    const d = ctx.getImageData(0, Math.floor(h * 0.25), w, Math.floor(h * 0.5)).data;
    const m = new Uint8Array(d.length / 4).fill(1);
    L = meanLightness(d, m) ?? L;
  } catch { /* keep default */ }
  stageRef = { art, light: art.light, L, backdrop: c };
  return stageRef;
}

// ── Box overlay ─────────────────────────────────────────────────────────────
/**
 * Shape-accurate hurt/hit boxes in body space at the current transform.
 * Faint = the move's inactive hitboxes; red = active strike; cyan = grab; violet = other kinds.
 */
export function drawBoxes(ctx, info, view, px = 1) {
  ctx.save();
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = '#ffe36b';
  ctx.fillStyle = 'rgba(255,227,107,0.12)';
  for (const s of info.hurtboxes) { kit.shapePath(ctx, s); ctx.fill(); ctx.stroke(); }
  const def = view.move?.def;
  if (def) {
    ctx.setLineDash([4 * px, 4 * px]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    for (const h of def.hitboxes || []) { kit.shapePath(ctx, h.shape ? h : { shape: 'circle', ...h }); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  for (const s of info.hitboxes) {
    const kind = s.kind || 'strike';
    const c = kind === 'grab' ? '#4be3ff' : kind === 'strike' ? '#ff2d4a' : '#c46bff';
    kit.shapePath(ctx, s);
    ctx.fillStyle = kit.rgba(c, 0.45); ctx.fill();
    ctx.strokeStyle = c; ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(0, 0, 3 * px, 0, Math.PI * 2); ctx.fill(); // feet origin
  ctx.restore();
}

/** Status tints + silhouette applied to a transparent character layer. */
function finishLayer(lc, o, view, host) {
  const c = lc.getContext('2d');
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  // art tints (info.tint) first, then status tints (o.tints, else the IR / built-in defs)
  for (const [color, a] of o.artTints || []) { c.fillStyle = kit.rgba(color, a); c.fillRect(0, 0, lc.width, lc.height); }
  const tints = o.tints || (view.statuses || []).map((s) => (host.model.ir?.statuses?.[s.name] || BUILTIN_STATUSES[s.name])?.tint);
  for (const t of tints) if (typeof t === 'string') { c.fillStyle = kit.rgba(t, 0.22); c.fillRect(0, 0, lc.width, lc.height); }
  if (o.silhouette) {
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = '#16121e';
    c.fillRect(0, 0, lc.width, lc.height);
  }
  c.restore();
}

/**
 * Renders a character tile.
 * @param {CanvasRenderingContext2D} ctx  target (device px)
 * @param {object} lab   { host, id (cache id), partial, w, h, box, time, frame, palette, boxes, silhouette, half, light, bg }
 * @returns {{view, info, error, ms}}
 */
export function drawCharacterTile(ctx, lab) {
  const { host, w, h } = lab;
  const H = host.model.collider(lab.partial.form || 'base').h;
  const box = lab.box || frameBox(host.bounds(lab.partial.form || 'base', lab.partial.bodyScale || 1), H);
  let tf = fitTransform(box, w, h);
  if (lab.half) {
    // 0.5× camera preview: the in-game size at camera zoom 0.6, halved.
    const s = 0.6 * 0.5 * (lab.dpr || 1);
    tf = { scale: s, ox: w / 2, oy: h * 0.78 };
  }
  // background
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (lab.silhouette) { ctx.fillStyle = '#e9e4ef'; ctx.fillRect(0, 0, w, h); }
  else if (lab.bg) ctx.drawImage(lab.bg, 0, 0, w, h);
  else ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = lab.silhouette ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.14)';
  ctx.fillRect(0, Math.round(tf.oy), w, Math.max(1, Math.round(tf.scale)));
  // character → transparent layer (tints, silhouette), then composite
  const lc = (scratch && scratch.width === w && scratch.height === h) ? scratch : (scratch = layerCanvas(w, h));
  const c = lc.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, h);
  c.setTransform(tf.scale, 0, 0, tf.scale, tf.ox, tf.oy);
  const t0 = nowMs();
  const r = host.preview(c, lab.partial, {
    id: lab.id, time: lab.time, frame: lab.frame, simFrame: lab.frame, palette: lab.palette, light: lab.light, ordinal: lab.ordinal || 0,
  });
  const ms = nowMs() - t0;
  c.setTransform(1, 0, 0, 1, 0, 0);
  finishLayer(lc, { ...lab, artTints: host.fighter(lab.id || 'preview').tints }, r.view, host);
  ctx.drawImage(lc, 0, 0);
  if (lab.boxes) {
    ctx.setTransform(tf.scale, 0, 0, tf.scale, tf.ox, tf.oy);
    drawBoxes(ctx, r.info, r.view, 1 / tf.scale);
  }
  ctx.restore();
  return { ...r, ms, tf };
}

/**
 * Renders one entity on its own (entity gallery, contact sheet).
 * @param {object} lab { host, name, age, w, h, form, palette, boxes, silhouette, time, light, bg, id }
 */
export function drawEntityTile(ctx, lab) {
  const { host, w, h } = lab;
  const ir = host.model.ir;
  const def = ir?.entities?.[lab.name];
  const rec = entityRecord(ir, lab.name, lab.age, 1);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (lab.silhouette) { ctx.fillStyle = '#e9e4ef'; ctx.fillRect(0, 0, w, h); }
  else if (lab.bg) ctx.drawImage(lab.bg, 0, 0, w, h);
  else ctx.clearRect(0, 0, w, h);
  if (!rec) { ctx.restore(); return null; }
  const tf = fitTransform(entityBox(def), w, h, { maxScale: 3 });
  const lc = (scratch && scratch.width === w && scratch.height === h) ? scratch : (scratch = layerCanvas(w, h));
  const c = lc.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, h);
  c.setTransform(tf.scale, 0, 0, tf.scale, tf.ox, tf.oy);
  const st = host.fighter(lab.id || `ent:${lab.name}`, lab.ordinal || 0);
  const ownerView = host.view({ state: 'idle', grounded: true, facing: 1, x: 0, y: 0, form: lab.form || host.model.startForm }, {});
  const info = host.info(ownerView, st, { time: lab.time, frame: lab.age, simFrame: lab.age, palette: lab.palette, light: lab.light, advance: false });
  const ev = host.entityView(rec, {}, ownerView);
  const t0 = nowMs();
  host.drawEntity(c, ev, info, 'main', { st });
  host.drawEntity(c, ev, info, 'world', { st });
  const ms = nowMs() - t0;
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (lab.silhouette) finishLayer(lc, lab, { statuses: [] }, host);
  ctx.drawImage(lc, 0, 0);
  if (lab.boxes && def) {
    ctx.setTransform(tf.scale, 0, 0, tf.scale, tf.ox, tf.oy);
    ctx.lineWidth = 1.5 / tf.scale;
    if (def.hurtbox?.length) { ctx.strokeStyle = '#ffe36b'; for (const s of def.hurtbox) { kit.shapePath(ctx, s); ctx.stroke(); } }
    for (const hb of def.hitboxes || []) {
      const on = rec.g >= hb.start && rec.g <= hb.end;
      kit.shapePath(ctx, hb);
      ctx.fillStyle = on ? 'rgba(255,45,74,0.45)' : 'rgba(255,255,255,0.08)'; ctx.fill();
    }
    if (def.shape) { ctx.setLineDash([3 / tf.scale, 3 / tf.scale]); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; kit.shapePath(ctx, def.shape); ctx.stroke(); }
  }
  ctx.restore();
  return { ev, ms };
}

// ── §6.6 automatic checks ───────────────────────────────────────────────────
// Readback through one CPU canvas: the paint canvas stays GPU-backed (as in game), so draw
// timings are honest and the copy + read is ~4× faster than a willReadFrequently paint.
let readback = null;
function readPixels(src, w, h) {
  readback ||= layerCanvas(1, 1);
  const c = readback.getContext('2d', { willReadFrequently: true });
  if (readback.width !== w || readback.height !== h) { readback.width = w; readback.height = h; } else c.clearRect(0, 0, w, h);
  c.drawImage(src, 0, 0);
  return c.getImageData(0, 0, w, h).data;
}

/**
 * Paints `partial` into the host's bounds-sized offscreen canvas (exactly what the
 * renderer composites in game) and returns its pixels + body→pixel transform.
 */
function paintPixels(host, partial, o) {
  const st = host.fighter(o.id || 'lab-check', o.ordinal || 0);
  st.quality = 'high'; st.lastPaint = null;
  const view = host.view({ facing: 1, x: 0, y: 0, grounded: true, state: 'idle', stateFrame: 0, ...partial }, {});
  const info = host.info(view, st, { time: o.time ?? 0.5, frame: o.frame ?? 30, simFrame: o.frame ?? 30, palette: o.palette, light: o.light, dt: 1 / 60 });
  const b = host.bounds(view.form, view.bodyScale);
  const span = b.legacy ? info.H * 3.4 : Math.max(b.right - b.left, b.bottom - b.top);
  const zoom = Math.min(1.5, 360 / Math.max(1, span));
  const p = host.paint(view, info, st, zoom, {});
  if (!p) return null;
  const data = readPixels(p.canvas, p.w, p.h);
  o.samples?.push(st.perf.last || 0);
  return { view, info, data, w: p.w, h: p.h, tf: { ox: p.ox, oy: p.oy, k: zoom, facing: 1 }, error: p.error, legacy: !!b.legacy };
}

/**
 * Runs every §6.6 check for a character. Returns { warnings, measures }.
 * o: { stage, palette, light, form, perfMs }
 */
export function runChecks(host, o = {}) {
  const ir = host.model.ir;
  const form = o.form || host.model.startForm;
  const stage = o.stage ? stageReference(o.stage) : null;
  const samples = [];
  const opts = { palette: o.palette, light: o.light || stage?.light, samples };
  const m = { coverage: [], fit: null, edges: [], silhouetteL: null, stageL: stage?.L ?? null, perfMs: null };
  const errors = [];

  // Idle: hurtbox fit, contrast, edges.
  const idle = paintPixels(host, { form }, { ...opts, id: 'chk:idle' });
  if (idle) {
    const op = alphaMask(idle.data, idle.w, idle.h);
    const f = hurtboxFit(op, idle.info.hurtboxes, idle.w, idle.h, idle.tf);
    m.fit = { ...f, where: 'idle' };
    m.silhouetteL = meanLightness(idle.data, op);
    if (!idle.legacy) m.edges.push({ where: 'idle', ...edgeTouches(op, idle.w, idle.h) });
    if (idle.error) errors.push('idle: draw threw (magenta hurtboxes shown)');
  }
  // States: edges.
  for (const s of stateList(ir, form)) {
    if (s.label === 'idle') continue;
    const r = paintPixels(host, { ...s.view, form, stateFrame: 12 }, { ...opts, id: `chk:${s.label}` });
    if (!r) continue;
    if (r.error) errors.push(`${s.label}: draw threw`);
    if (!r.legacy) m.edges.push({ where: s.label, ...edgeTouches(alphaMask(r.data, r.w, r.h), r.w, r.h) });
  }
  // Moves: hitbox coverage on every active frame, edges on every frame sampled.
  const t0 = nowMs();
  const world = typeof host.artFor(form)?.drawWorld === 'function';
  for (const mv of moveList(ir)) {
    const def = mv.def;
    const w = activeWindow(def);
    const frames = new Set([0, Math.floor(def.duration / 2)]);
    if (w) for (let f = w.from; f <= w.to; f++) frames.add(f);
    let worst = null;
    for (const fr of [...frames].sort((a, b) => a - b)) {
      const r = paintPixels(host, moveView(mv.name, def, fr, { form: formForMove(mv, form) }), { ...opts, id: `chk:m:${mv.name}`, frame: fr });
      if (!r) continue;
      if (r.error) { errors.push(`${mv.name} f${fr}: draw threw`); break; }
      const op = alphaMask(r.data, r.w, r.h);
      if (!r.legacy) {
        const e = edgeTouches(op, r.w, r.h);
        if (e.left + e.right + e.top + e.bottom) m.edges.push({ where: `${mv.name} f${fr}`, ...e });
      }
      const hits = hitShapesFor(r.view).filter((s) => (s.kind || 'strike') !== 'wind').map((s, i) => ({ shape: s, label: `#${i}` }));
      for (const c of hitboxCoverage(op, hits, r.w, r.h, r.tf, { offCanvas: !world })) if (!worst || c.coverage < worst.coverage) worst = { ...c, where: `${mv.name} f${fr}` };
    }
    if (worst) m.coverage.push(worst);
  }
  // Perf: mean body draw time over every check paint (first 3 dropped: init + warm-up).
  const warm = samples.slice(3);
  m.perfMs = o.perfMs ?? (warm.length ? warm.reduce((a, b) => a + b, 0) / warm.length : null);
  m.checkMs = nowMs() - t0;
  m.edges = core.mergeEdges(m.edges).slice(0, 8);
  const warnings = evaluate(m);
  for (const e of errors) warnings.unshift({ check: 'error', where: e.split(':')[0], message: e });
  return { warnings, measures: m };
}

// ── Contact sheet ───────────────────────────────────────────────────────────
/**
 * PNG grid (§6.6): idle, run, jump, fall, hurt, shield, every move at its active
 * midpoint, every form, entities and the portrait. Returns a canvas.
 */
export function contactSheet(host, o = {}) {
  const ir = host.model.ir;
  const form = o.form || host.model.startForm;
  const tiles = [];
  const pick = ['idle', 'run', 'jump', 'fall', 'hurt', 'shield'];
  const states = stateList(ir, form);
  for (const k of pick) { const s = states.find((x) => x.label === k); if (s) tiles.push({ label: k, sub: 'state', partial: { ...s.view, form, stateFrame: 20 } }); }
  for (const mv of moveList(ir)) {
    const fr = strikeFrame(mv.def);
    tiles.push({ label: mv.name, sub: `${mv.routes[0] || mv.category} · f${fr}`, partial: moveView(mv.name, mv.def, fr, { form: formForMove(mv, form) }), frame: fr });
  }
  for (const f of ir.tables.forms) if (f !== form || ir.tables.forms.length > 1) tiles.push({ label: `form ${f}`, sub: 'idle', partial: { form: f, stateFrame: 20 } });
  for (const n of ir.tables.entities) if (!ir.entities[n].legacy) tiles.push({ label: n, sub: ir.entities[n].kind, entity: n });
  tiles.push({ label: 'portrait', sub: 'portrait', portrait: true });

  const T = o.tile || 240;
  const L = sheetLayout(tiles.length, { tile: T, cols: o.cols || 6 });
  const sheet = layerCanvas(L.width, L.height);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#17111f'; ctx.fillRect(0, 0, L.width, L.height);
  ctx.fillStyle = '#fff6ec'; ctx.font = '700 26px Rajdhani, sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillText(`${host.model.name} (${host.id}) — contact sheet`, 14, L.header / 2);
  ctx.font = '600 15px Rajdhani, sans-serif'; ctx.fillStyle = '#c9b8de';
  ctx.fillText(`${tiles.length} tiles · palette ${o.ordinal || 0}${o.boxes ? ' · boxes' : ''}`, L.width - 260, L.header / 2);
  const tc = layerCanvas(T, T);
  const tctx = tc.getContext('2d');
  const box = o.box || null;
  tiles.forEach((t, i) => {
    const { x, y } = L.at(i);
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, T, T);
    if (t.portrait) {
      const p = host.portrait(T * 0.8, o.ordinal || 0, { dpr: 1, form });
      tctx.fillStyle = '#2a1f3d'; tctx.fillRect(0, 0, T, T);
      if (p) tctx.drawImage(p, T * 0.1, T * 0.1, T * 0.8, T * 0.8);
    } else if (t.entity) {
      drawEntityTile(tctx, { host, name: t.entity, age: 20, w: T, h: T, form, palette: o.palette, boxes: o.boxes, light: o.light, bg: o.bg, time: 0.5, id: `sheet:e:${t.entity}` });
    } else {
      drawCharacterTile(tctx, { host, id: `sheet:${t.label}`, partial: t.partial, w: T, h: T, box: box && !t.partial.form ? box : null, time: 0.5, frame: t.frame ?? 20, palette: o.palette, ordinal: o.ordinal, boxes: o.boxes, light: o.light, bg: o.bg });
    }
    ctx.fillStyle = '#241a30'; ctx.fillRect(x, y, T, T + L.label);
    ctx.drawImage(tc, x, y);
    ctx.fillStyle = '#fff6ec'; ctx.font = '700 14px Rajdhani, sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText(t.label.toUpperCase(), x + 6, y + T + L.label / 2);
    ctx.fillStyle = '#9d8bb5'; ctx.font = '600 12px Rajdhani, sans-serif';
    const sw = ctx.measureText(t.sub).width;
    ctx.fillText(t.sub, x + T - sw - 6, y + T + L.label / 2);
  });
  return sheet;
}

/** POSTs a canvas as PNG to /dev/contact-sheet/:id. Resolves to the server's JSON. */
export async function postSheet(canvas, id) {
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  const r = await fetch(`/dev/contact-sheet/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: blob });
  if (!r.ok) throw new Error(`contact sheet upload failed: ${r.status} ${await r.text()}`);
  return r.json();
}
