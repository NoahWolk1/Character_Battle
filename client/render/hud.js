// Screen-space HUD: player cards (portrait, percent, stocks, resource widgets, status
// icons, governor feedback, art.hud slot), off-screen bubbles, banners.
//
// Data sources (all optional, v1 characters simply have none):
//   snapshot fighter: r (synced resources, tables.resources order), st [[statusIdx, frames, stacks]], fm (form idx)
//                     or art-host view fields: resources {name: v}, statuses [{name, frames, stacks}], form
//   roster info R.info(id): {color, tables, entry: {character (IR), art}}
//   R.effects.hud (Effects.hudState): {armor, breakT, tired, crack, resist, trims[]}
//   portraits: setPortraitSource(fn) — default uses client/characters.js `portrait(entry, size, opts)`.
import * as kit from '../../shared/art/kit.js';

// ── Portrait source (art host, WP-K) ────────────────────────────────────────────
let portraitFn = null;
let portraitLoading = false;
/** fn(entry, size, {form, paletteIdx, t}) → CanvasImageSource | null */
export function setPortraitSource(fn) { portraitFn = typeof fn === 'function' ? fn : null; }
function loadDefaultPortrait() {
  if (portraitFn || portraitLoading || typeof document === 'undefined') return;
  portraitLoading = true;
  import('../characters.js').then((m) => { if (!portraitFn && typeof m.portrait === 'function') portraitFn = m.portrait; }).catch(() => {});
}
function portraitOf(r, size, f, time) {
  loadDefaultPortrait();
  if (!portraitFn || !r?.entry) return null;
  const p = r.entry.art?.portrait;
  const animated = !!(p && typeof p === 'object' && p.animated) || !!(typeof p === 'function' && p.animated);
  const opts = { form: f?.form ?? formName(r, f), paletteIdx: r.paletteIdx ?? 0 };
  if (animated) opts.t = Math.floor(time * 10) / 10;   // 10 fps redraw (§6.5)
  try { return portraitFn(r.entry, size, opts) || null; } catch { return null; }
}

export function damageColor(p) {
  const stops = [[0, '#ffffff'], [40, '#fff1a8'], [80, '#ffb347'], [120, '#ff5a3a'], [170, '#d0122a'], [240, '#7a0614']];
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      return kit.mix(ca, cb, (p - a) / (b - a));
    }
  }
  return stops[stops.length - 1][1];
}

// ── Model (pure; unit-tested) ────────────────────────────────────────────────
const BUILTIN_FRAMES = { burn: 120, poison: 240, freeze: 30, stun: 24, slow: 120, root: 45, silence: 90, confuse: 60, weaken: 180, vulnerable: 180, float: 90, mark: 120 };
export const STATUS_GLYPHS = Object.freeze(['burn', 'poison', 'freeze', 'stun', 'slow', 'root', 'silence', 'confuse', 'weaken', 'vulnerable', 'float', 'mark', 'shield', 'heart', 'bolt', 'star', 'skull', 'eye', 'clock']);
const STATUS_TINTS = {
  burn: '#ff8a2a', poison: '#9ae05a', freeze: '#a8f2ff', stun: '#fff36b', slow: '#7ab8ff', root: '#c89a60',
  silence: '#c9c3d6', confuse: '#d48aff', weaken: '#ff7a8a', vulnerable: '#ff5a3a', float: '#d0fff2', mark: '#ff4d5e',
};
const isColor = (c) => typeof c === 'string' && c.length > 2 && c.length < 64;
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Name tables for a roster entry: roster-provided, IR tables, or derived. */
export function tablesFor(r) {
  if (r?.tables) return r.tables;
  const c = r?.entry?.character;
  if (!c) return { resources: [], statuses: [], forms: ['base'] };
  if (r._hudTables) return r._hudTables;
  const T = c.tables || {};
  const res = (T.resources || Object.keys(c.resources || {})).filter((n) => c.resources?.[n]?.sync !== false);
  const t = { resources: res, statuses: T.statuses || Object.keys(c.statuses || {}).sort(), forms: T.forms || ['base', ...Object.keys(c.forms || {}).filter((n) => n !== 'base').sort()] };
  try { Object.defineProperty(r, '_hudTables', { value: t, enumerable: false }); } catch { /* frozen */ }
  return t;
}

function formName(r, f) {
  if (typeof f?.form === 'string') return f.form;
  const forms = tablesFor(r).forms || ['base'];
  return forms[f?.fm | 0] || 'base';
}

/**
 * What the card shows for one fighter.
 * @returns {{form: string, resources: {name, label, style, color, value, min, max, frac}[],
 *            statuses: {name, frames, stacks, max, frac, icon, tint}[]}}
 */
export function hudModel(r, f, lookup = null) {
  const c = r?.entry?.character || {};
  const t = tablesFor(r);
  const form = formName(r, f);
  const resources = [];
  const defs = c.resources || {};
  const names = t.resources || [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i], d = defs[name];
    if (!d) continue;
    const hud = d.hud || {};
    const style = hud.style || 'bar';
    if (style === 'none') continue;
    if (Array.isArray(hud.forms) && hud.forms.length && !hud.forms.includes(form)) continue;
    let value = Array.isArray(f?.r) ? f.r[i] : f?.resources?.[name];
    value = num(value, num(d.start, num(d.max, 0)));
    const min = num(d.min, 0), max = Math.max(min + 1e-6, num(d.max, 100));
    resources.push({
      name, label: String(hud.label || name).slice(0, 14), style: ['bar', 'pips', 'ring'].includes(style) ? style : 'bar',
      color: isColor(hud.color) ? hud.color : (r?.color || '#9fe8ff'), value, min, max, frac: Math.max(0, Math.min(1, (value - min) / (max - min))),
    });
  }
  const statuses = [];
  const sdefs = c.statuses || {};
  const defOf = (name) => sdefs[name] || (lookup && lookup(name)) || {}; // foreign statuses: the source's def
  const list = Array.isArray(f?.st) ? f.st.map(([i, frames, stacks]) => ({ name: typeof i === 'string' ? i : t.statuses?.[i], frames, stacks }))
    : Array.isArray(f?.statuses) ? f.statuses : [];
  for (const s of list) {
    if (!s || typeof s.name !== 'string') continue;
    const d = defOf(s.name);
    const max = Math.max(1, num(d.frames, BUILTIN_FRAMES[s.name] ?? Math.max(1, num(s.frames, 1))));
    statuses.push({
      name: s.name, frames: num(s.frames, 0), stacks: num(s.stacks, 1), max, frac: Math.max(0, Math.min(1, num(s.frames, 0) / max)),
      icon: typeof d.icon === 'string' && d.icon ? d.icon : s.name, tint: isColor(d.tint) ? d.tint : STATUS_TINTS[s.name] || '#d8c8ff',
    });
  }
  return { form, resources, statuses };
}

// ── Cards ────────────────────────────────────────────────────────────────────
/**
 * "P1 · Ann", "CPU 3", "CPU 2 · Rex": CPUs get their slot number so duplicate picks stay
 * distinguishable; generic names ("CPU", "CPU normal", "P2") are not repeated.
 */
export function playerLabel(r) {
  const n = (r?.index ?? 0) + 1;
  const base = r?.cpu ? `CPU ${n}` : `P${n}`;
  const name = String(r?.name || '').trim();
  return !name || name === base || /^(cpu\b|p\d+$)/i.test(name) ? base : `${base} · ${name}`;
}

export function drawHud(ctx, R, view, opts = {}) {
  const W = R.cam.w / R.dpr, H = R.cam.h / R.dpr;
  const n = view.fighters.length;
  const cardW = Math.min(250, (W - 40) / n - 14);
  const lookup = (name) => { for (const x of R.roster || []) { const d = x?.entry?.character?.statuses?.[name]; if (d) return d; } return null; };
  const models = view.fighters.map((f) => { const r = R.info(f.id); return r?.entry ? hudModel(r, f, lookup) : null; });
  // Cards grow a strip when anyone has resource widgets or an art.hud slot.
  const strip = view.fighters.some((f, i) => { const r = R.info(f.id); return models[i]?.resources.some((x) => x.style !== 'ring') || typeof r?.entry?.art?.hud === 'function'; });
  const cardH = strip ? 112 : 92;
  const total = n * cardW + (n - 1) * 16;
  let x = (W - total) / 2;
  const y = H - cardH - 18;
  view.fighters.forEach((f, i) => {
    const r = R.info(f.id);
    if (!r?.entry) return;
    drawCard(ctx, R, f, r, models[i], x, y, cardW, cardH, strip, opts);
    x += cardW + 16;
  });
}

function drawCard(ctx, R, f, r, model, x, y, w, h, strip, opts) {
  const hs = R.hudState.get(f.id) || { shake: 0 };
  hs.shake = (hs.shake || 0) * 0.85;
  R.hudState.set(f.id, hs);
  const fb = R.effects?.hud?.get?.(f.id) || null;
  const time = (R.time || 0) / 60;
  const out = f.eliminated;
  ctx.save();
  ctx.globalAlpha = out ? 0.45 : 1;
  // panel
  kit.roundRectPath(ctx, x, y, w, h, 16);
  const bg = ctx.createLinearGradient(x, y, x, y + h);
  bg.addColorStop(0, 'rgba(30,18,48,0.88)'); bg.addColorStop(1, 'rgba(12,8,22,0.92)');
  ctx.fillStyle = bg; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = kit.rgba(r.color, 0.9); ctx.stroke();
  // color band
  ctx.save();
  kit.roundRectPath(ctx, x, y, w, h, 16); ctx.clip();
  const band = ctx.createLinearGradient(x, y, x + w, y);
  band.addColorStop(0, kit.rgba(r.color, 0.55)); band.addColorStop(0.6, kit.rgba(r.color, 0));
  ctx.fillStyle = band; ctx.fillRect(x, y, w, h);
  if (fb?.armor > 0) drawCardSheen(ctx, x, y, w, h, 1 - fb.armor / 18);
  ctx.restore();
  if (fb?.armor > 0) { kit.roundRectPath(ctx, x, y, w, h, 16); ctx.lineWidth = 3; ctx.strokeStyle = kit.rgba('#e6eefa', fb.armor / 18); ctx.stroke(); }
  // portrait (shrinks to make room for ring resources so they stay inside the card)
  const rings = model ? model.resources.filter((res) => res.style === 'ring').slice(0, 2) : [];
  const ps = 78 - 12 * rings.length;
  const px = x + 8 + 6 * rings.length, py = y + h - ps - 6 - 6 * rings.length;
  const pcx = px + ps / 2, pcy = py + ps / 2;
  ctx.save();
  ctx.beginPath(); ctx.arc(pcx, pcy, ps / 2, 0, Math.PI * 2);
  ctx.fillStyle = kit.rgba(r.color, 0.25); ctx.fill();
  ctx.clip();
  const img = portraitOf(r, 96, f, time);
  if (img) ctx.drawImage(img, px - 9, py - 9, ps + 18, ps + 18);
  else drawPortraitPlaceholder(ctx, pcx, pcy, ps / 2, r);
  ctx.restore();
  ctx.beginPath(); ctx.arc(pcx, pcy, ps / 2, 0, Math.PI * 2);
  ctx.lineWidth = 3; ctx.strokeStyle = r.color; ctx.stroke();
  // ring-style resources wrap the portrait
  rings.forEach((res, i) => drawPortraitRing(ctx, pcx, pcy, ps / 2 + 5 + i * 6, res, hs, time));
  // name
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 14px "Rajdhani", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  const tx = x + 96;
  ctx.fillText(playerLabel(r).slice(0, 22), tx, y + 20);
  ctx.font = '600 12px "Rajdhani", sans-serif';
  const cname = String(r.entry.character?.name || r.entry.id || '').toUpperCase();
  // ring resources are labelled in their own color, right-aligned on the character-name row
  let rx = x + w - 10;
  ctx.textAlign = 'right';
  for (const res of rings) {
    const t = `${res.label.toUpperCase()} ${Math.round(res.frac * 100)}%`;
    ctx.fillStyle = res.color; ctx.fillText(t, rx, y + 35);
    rx -= ctx.measureText(t).width + 8;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(cname, tx, y + 35, Math.max(30, rx - tx));
  if (fb?.tired > 0) drawTiredBadge(ctx, tx + ctx.measureText(cname).width + 12, y + 31, fb.tired);
  // percent
  const sx = (Math.random() - 0.5) * hs.shake, sy = (Math.random() - 0.5) * hs.shake;
  const pct = Math.floor(f.percent);
  const col = damageColor(f.percent);
  ctx.font = '400 42px "Bungee", "Rajdhani", sans-serif';
  ctx.textAlign = 'left';
  ctx.lineWidth = 6; ctx.strokeStyle = '#120a1c'; ctx.lineJoin = 'round';
  const label = out ? 'OUT' : `${pct}`;
  ctx.strokeText(label, tx + sx, y + 78 + sy);
  ctx.fillStyle = col; ctx.fillText(label, tx + sx, y + 78 + sy);
  const tw = ctx.measureText(label).width;
  if (!out) {
    ctx.font = '400 20px "Bungee", sans-serif';
    ctx.strokeText('%', tx + tw + 3 + sx, y + 78 + sy);
    ctx.fillText('%', tx + tw + 3 + sx, y + 78 + sy);
    if (fb?.trims?.length) drawTrims(ctx, tx + tw + 26, y + 58, fb.trims);
  }
  // stocks
  if (!opts.infinite) {
    for (let i = 0; i < f.stocks; i++) {
      const cx = x + w - 16 - i * 17, cy = y + 18;
      ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = r.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    }
  }
  // resource strip + art.hud slot
  if (strip && model) drawStrip(ctx, R, f, r, model, tx, y + h - 22, x + w - 10 - tx, 16, hs, time);
  // status icons ride on the card's top edge
  if (model?.statuses.length) drawStatusRow(ctx, x + 14, y - 6, model.statuses, time);
  if (fb?.breakT > 0) drawBreakBadge(ctx, x + w - 34, y - 6, fb.breakT);
  ctx.restore();
}

function drawPortraitPlaceholder(ctx, cx, cy, rad, r) {
  // Shown until the art host's portrait is ready: initial on a soft gradient.
  const g = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.4, 2, cx, cy, rad);
  g.addColorStop(0, kit.rgba(r.color, 0.65)); g.addColorStop(1, kit.rgba(r.color, 0.1));
  ctx.fillStyle = g; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  ctx.font = `400 ${Math.round(rad)}px "Bungee", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(String(r.entry?.character?.name || '?').slice(0, 1).toUpperCase(), cx, cy + 2);
  ctx.textBaseline = 'alphabetic';
}

// Trailing "ghost" value so drops read like a fighting-game meter.
function lagValue(hs, key, v) {
  hs.lag = hs.lag || {};
  const prev = hs.lag[key];
  const out = prev === undefined || v >= prev ? v : prev + (v - prev) * 0.08;
  hs.lag[key] = out;
  return out;
}

function drawPortraitRing(ctx, cx, cy, rad, res, hs, time) {
  const a0 = -Math.PI / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,6,18,0.85)';
  ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
  const ghost = (lagValue(hs, res.name, res.value) - res.min) / (res.max - res.min);
  if (ghost > res.frac + 0.002) { ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a0 + ghost * Math.PI * 2); ctx.stroke(); }
  if (res.frac > 0.002) {
    const full = res.frac >= 0.999;
    ctx.lineWidth = 3.5; ctx.strokeStyle = res.color;
    if (full) { ctx.shadowColor = res.color; ctx.shadowBlur = 8 + 4 * Math.sin(time * 6); }
    ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a0 + res.frac * Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    // bright head on the arc
    const a = a0 + res.frac * Math.PI * 2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawStrip(ctx, R, f, r, model, x, y, w, h, hs, time) {
  const items = model.resources.filter((res) => res.style !== 'ring');
  const hook = typeof r.entry.art?.hud === 'function' && !(hs.hudErrors >= 3);
  const n = items.length + (hook ? 1 : 0);
  if (!n || w < 20) return;
  const gap = 8, iw = (w - gap * (n - 1)) / n;
  let cx = x;
  for (const res of items) {
    if (res.style === 'pips') drawPips(ctx, cx, y, iw, h, res);
    else drawBar(ctx, cx, y, iw, h, res, hs, time);
    cx += iw + gap;
  }
  if (hook) drawArtHud(ctx, R, f, r, model, { x: cx, y: y - 2, w: iw, h: h + 4 }, hs, time);
}

function drawLabel(ctx, x, y, text) {
  ctx.font = '700 9px "Rajdhani", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(text.toUpperCase(), x, y);
  return ctx.measureText(text.toUpperCase()).width;
}

function drawBar(ctx, x, y, w, h, res, hs, time) {
  drawLabel(ctx, x, y + 6, res.label);
  const by = y + 8, bh = Math.max(5, h - 9);
  kit.roundRectPath(ctx, x, by, w, bh, bh / 2);
  ctx.fillStyle = 'rgba(8,4,16,0.9)'; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
  ctx.save();
  kit.roundRectPath(ctx, x, by, w, bh, bh / 2); ctx.clip();
  const ghost = (lagValue(hs, res.name, res.value) - res.min) / (res.max - res.min);
  if (ghost > res.frac) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x, by, w * ghost, bh); }
  const g = ctx.createLinearGradient(0, by, 0, by + bh);
  g.addColorStop(0, kit.shade(res.color, 0.35)); g.addColorStop(0.55, res.color); g.addColorStop(1, kit.shade(res.color, -0.3));
  ctx.fillStyle = g; ctx.fillRect(x, by, w * res.frac, bh);
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(x, by + 1, w * res.frac, Math.max(1, bh * 0.3));
  if (res.frac >= 0.999) {   // full meter shimmer
    const sx = x + ((time * 90) % (w + 30)) - 15;
    const sg = ctx.createLinearGradient(sx - 12, 0, sx + 12, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.7)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.fillRect(sx - 12, by, 24, bh);
  }
  ctx.strokeStyle = 'rgba(10,6,18,0.55)'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const tx = x + (w * i) / 4; ctx.beginPath(); ctx.moveTo(tx, by + 1); ctx.lineTo(tx, by + bh - 1); ctx.stroke(); }
  ctx.restore();
}

function drawPips(ctx, x0, y, w0, h, res) {
  // label on the left, pips to its right on the same row (never under the label)
  const lw = drawLabel(ctx, x0, y + h / 2 + 4, res.label);
  const x = x0 + lw + 6, w = Math.max(10, w0 - lw - 6);
  const span = res.max - res.min;
  const count = span <= 10 ? Math.max(1, Math.round(span)) : 10;
  const per = span / count;
  const filled = (res.value - res.min) / per;
  const s = Math.min(6, (w - 2) / count / 2 - 0.5, h / 2 - 1);
  const cy = y + h / 2 + 1;
  const step = (w - s * 2) / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    const px = x + s + (count > 1 ? i * step : (w - s * 2) / 2);
    const fill = Math.max(0, Math.min(1, filled - i));
    const path = () => kit.polygonPath(ctx, [[px, cy - s], [px + s, cy], [px, cy + s], [px - s, cy]]);
    path(); ctx.fillStyle = 'rgba(8,4,16,0.9)'; ctx.fill();
    if (fill > 0) {
      ctx.save(); path(); ctx.clip();
      ctx.fillStyle = res.color; ctx.fillRect(px - s, cy + s - fill * s * 2, s * 2, fill * s * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(px - s, cy - s, s * 2, s * 0.6);
      ctx.restore();
    }
    path(); ctx.lineWidth = 1.2; ctx.strokeStyle = fill >= 1 ? '#ffffff' : 'rgba(255,255,255,0.35)'; ctx.stroke();
  }
  return lw;
}

function drawArtHud(ctx, R, f, r, model, rect, hs, time) {
  ctx.save();
  ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  hs.artCache = hs.artCache || {};
  const resources = {}, resMax = {};
  for (const x of model.resources) { resources[x.name] = x.value; resMax[x.name] = x.max; }
  const info = {
    kit, time, color: r.color, palette: { ...(r.entry.art?.palette || {}) }, view: f, form: model.form,
    resources, resMax, statuses: model.statuses.map((s) => ({ name: s.name, frames: s.frames, stacks: s.stacks })),
    character: r.entry.character, cache: hs.artCache, u: rect.h / 20,
  };
  try { r.entry.art.hud(ctx, { ...rect }, info); } catch (e) {
    hs.hudErrors = (hs.hudErrors || 0) + 1;
    if (hs.hudErrors === 1) console.error(`art.hud failed for ${r.entry.character?.id}:`, e);
  }
  ctx.restore();
  resetCtx(ctx);
}

// ── Status icons ─────────────────────────────────────────────────────────────
function drawStatusRow(ctx, x, y, statuses, time) {
  const R = 11;
  statuses.slice(0, 6).forEach((s, i) => {
    const cx = x + R + i * (R * 2 + 5), cy = y;
    const low = s.frames < 30 && s.frac < 0.35;
    if (low && Math.sin(time * 18) < -0.3) return;   // blink before it expires
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14,8,26,0.94)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = kit.rgba(s.tint, 0.45); ctx.stroke();
    // remaining-time arc
    ctx.lineWidth = 2.5; ctx.strokeStyle = s.tint; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + s.frac * Math.PI * 2); ctx.stroke();
    drawGlyph(ctx, s.icon, cx, cy, R * 0.62, s.tint, s.name);
    if (s.stacks > 1) {
      ctx.font = '800 9px "Rajdhani", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = '#120a1c'; ctx.strokeText(`x${s.stacks}`, cx + R * 0.75, cy + R * 0.75);
      ctx.fillStyle = '#ffffff'; ctx.fillText(`x${s.stacks}`, cx + R * 0.75, cy + R * 0.75);
    }
    ctx.restore();
  });
}

/** Vector status glyph centered at (x, y), half-size s. Unknown names: ≤2-char text or initial. */
export function drawGlyph(ctx, icon, x, y, s, color = '#ffffff', name = '') {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.2, s * 0.22); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const P = (pts) => kit.polygonPath(ctx, pts.map(([a, b]) => [a * s, b * s]));
  const line = (...pts) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a * s, b * s) : ctx.moveTo(a * s, b * s))); ctx.stroke(); };
  switch (icon) {
    case 'burn':
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.9, -s * 0.1, s * 0.6, s * 0.55); ctx.quadraticCurveTo(0, s * 1.1, -s * 0.6, s * 0.55);
      ctx.quadraticCurveTo(-s * 0.8, 0, -s * 0.1, -s * 0.35); ctx.quadraticCurveTo(0, -s * 0.6, 0, -s); ctx.fill();
      ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.ellipse(0, s * 0.45, s * 0.28, s * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'poison':
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.8, s * 0.1, s * 0.6, s * 0.5); ctx.arc(0, s * 0.35, s * 0.62, 0.3, Math.PI - 0.3); ctx.quadraticCurveTo(-s * 0.8, s * 0.1, 0, -s); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-s * 0.2, s * 0.25, s * 0.16, 0, Math.PI * 2); ctx.fill();
      break;
    case 'freeze':
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI; line([Math.cos(a), Math.sin(a)], [-Math.cos(a), -Math.sin(a)]); }
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); line([c * 0.6 + sn * 0.25, sn * 0.6 - c * 0.25], [c * 0.85, sn * 0.85], [c * 0.6 - sn * 0.25, sn * 0.6 + c * 0.25]); }
      break;
    case 'stun': case 'star':
      kit.starPath(ctx, 0, 0, 5, s, s * 0.45, -Math.PI / 2); ctx.fill();
      break;
    case 'slow': case 'clock':
      ctx.beginPath(); ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2); ctx.stroke();
      line([0, -0.55], [0, 0], [0.4, 0.25]);
      break;
    case 'root':
      line([0, -1], [0, 0.2]); line([0, 0.2], [-0.7, 0.9]); line([0, 0.2], [0.7, 0.9]); line([0, 0.2], [0, 1]); line([-0.35, -0.3], [0, -0.05], [0.35, -0.3]);
      break;
    case 'silence':
      ctx.beginPath(); ctx.ellipse(0, -s * 0.1, s * 0.85, s * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
      line([-0.75, 0.75], [0.75, -0.85]);
      break;
    case 'confuse':
      ctx.beginPath(); for (let i = 0; i <= 24; i++) { const a = i * 0.45, rr = s * (0.1 + i * 0.035); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.stroke();
      break;
    case 'weaken':
      line([-0.6, -0.6], [0, 0], [0.6, -0.6]); line([-0.6, 0.1], [0, 0.7], [0.6, 0.1]);
      break;
    case 'vulnerable': case 'shield':
      P([[0, -1], [0.85, -0.6], [0.7, 0.4], [0, 1], [-0.7, 0.4], [-0.85, -0.6]]); ctx.stroke();
      if (icon === 'vulnerable') line([0.05, -0.8], [-0.2, -0.1], [0.2, 0.2], [-0.05, 0.85]);
      break;
    case 'float':
      line([-0.6, 0.1], [0, -0.5], [0.6, 0.1]); line([-0.6, 0.7], [0, 0.1], [0.6, 0.7]);
      break;
    case 'mark':
      ctx.beginPath(); ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2); ctx.stroke();
      line([0, -1], [0, -0.35]); line([0, 0.35], [0, 1]); line([-1, 0], [-0.35, 0]); line([0.35, 0], [1, 0]);
      break;
    case 'heart':
      ctx.beginPath(); ctx.moveTo(0, s * 0.8); ctx.bezierCurveTo(-s * 1.3, -s * 0.1, -s * 0.5, -s * 1.1, 0, -s * 0.35); ctx.bezierCurveTo(s * 0.5, -s * 1.1, s * 1.3, -s * 0.1, 0, s * 0.8); ctx.fill();
      break;
    case 'bolt':
      P([[0.2, -1], [-0.55, 0.15], [-0.05, 0.15], [-0.25, 1], [0.55, -0.2], [0.05, -0.2]]); ctx.fill();
      break;
    case 'skull':
      ctx.beginPath(); ctx.arc(0, -s * 0.15, s * 0.75, Math.PI * 0.85, Math.PI * 2.15); ctx.lineTo(s * 0.45, s * 0.85); ctx.lineTo(-s * 0.45, s * 0.85); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#120a1c'; ctx.beginPath(); ctx.arc(-s * 0.3, -s * 0.1, s * 0.2, 0, Math.PI * 2); ctx.arc(s * 0.3, -s * 0.1, s * 0.2, 0, Math.PI * 2); ctx.fill();
      break;
    case 'eye':
      ctx.beginPath(); ctx.moveTo(-s, 0); ctx.quadraticCurveTo(0, -s * 0.9, s, 0); ctx.quadraticCurveTo(0, s * 0.9, -s, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.32, 0, Math.PI * 2); ctx.fill();
      break;
    default: {
      const txt = typeof icon === 'string' && icon.length && [...icon].length <= 2 ? icon : String(name || icon || '?').slice(0, 1).toUpperCase();
      ctx.font = `800 ${Math.round(s * 1.7)}px "Rajdhani", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, 0, s * 0.1);
    }
  }
  ctx.restore();
}

// ── Governor feedback on the card (§4.2.12) ──────────────────────────────────
function drawCardSheen(ctx, x, y, w, h, t) {
  const sx = x - 40 + t * (w + 80);
  const g = ctx.createLinearGradient(sx - 30, y, sx + 30, y + h);
  g.addColorStop(0, 'rgba(220,232,255,0)'); g.addColorStop(0.5, 'rgba(240,246,255,0.55)'); g.addColorStop(1, 'rgba(220,232,255,0)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}

function drawTrims(ctx, x, y, trims) {
  trims.forEach((t, i) => {
    if (t.amount == null) return;
    const k = Math.max(0, Math.min(1, t.t / 50));
    ctx.save();
    ctx.globalAlpha *= Math.min(1, k * 2.5);
    ctx.font = '800 13px "Rajdhani", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const ty = y - (1 - k) * 14 - i * 13;
    const s = `+${Math.round(t.amount * 10) / 10} resisted`;
    ctx.lineWidth = 3; ctx.strokeStyle = '#120a1c'; ctx.strokeText(s, x, ty);
    ctx.fillStyle = '#aaa4b6'; ctx.fillText(s, x, ty);
    ctx.restore();
  });
}

function drawTiredBadge(ctx, x, y, t) {
  ctx.save();
  ctx.globalAlpha *= Math.min(1, t / 15);
  ctx.fillStyle = '#bfe6ff';
  ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.quadraticCurveTo(x + 5, y, x, y + 3); ctx.quadraticCurveTo(x - 5, y, x, y - 7); ctx.fill();
  ctx.font = 'italic 700 10px "Rajdhani", sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#d6d0e2';
  ctx.fillText('tired', x + 6, y + 2);
  ctx.restore();
}

function drawBreakBadge(ctx, x, y, t) {
  const age = 70 - t;
  const s = age < 8 ? 1.5 - age * 0.06 : 1;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-0.12); ctx.scale(s, s);
  ctx.globalAlpha *= Math.min(1, t / 12);
  ctx.font = '400 16px "Bungee", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = 6; ctx.strokeStyle = '#1a0a26'; ctx.strokeText('BREAK!', 0, 0);
  const g = ctx.createLinearGradient(0, -9, 0, 9); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#7af0ff');
  ctx.fillStyle = g; ctx.fillText('BREAK!', 0, 0);
  ctx.restore();
}

function resetCtx(c) {
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  c.shadowBlur = 0; c.shadowColor = 'rgba(0,0,0,0)';
  if ('filter' in c) c.filter = 'none';
  c.setLineDash?.([]);
}

function bodyHeight(r) {
  const c = r?.entry?.character;
  return num(c?.stats?.height, num(c?.forms?.base?.body?.collider?.h, num(c?.body?.collider?.h, 90)));
}

// ── Off-screen bubbles and banners ───────────────────────────────────────────
export function drawOffscreenBubbles(ctx, R, view) {
  const W = R.cam.w / R.dpr, H = R.cam.h / R.dpr;
  const c = R.cam;
  const time = (R.time || 0) / 60;
  for (const f of view.fighters) {
    if (f.state === 'dead' || f.eliminated) continue;
    const r = R.info(f.id);
    if (!r?.entry) continue;
    const hgt = bodyHeight(r) * num(f.bs, 1);
    const sx = ((f.x - c.x) * c.zoom + c.w / 2) / R.dpr;
    const sy = ((f.y - hgt / 2 - c.y) * c.zoom + c.h / 2) / R.dpr;
    const m = 50;
    if (sx > -10 && sx < W + 10 && sy > -10 && sy < H + 10) continue;
    const bx = Math.max(m, Math.min(W - m, sx)), by = Math.max(m, Math.min(H - m, sy));
    ctx.save();
    ctx.beginPath(); ctx.arc(bx, by, 32, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15,8,25,0.8)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = r.color; ctx.stroke();
    ctx.clip();
    const img = portraitOf(r, 96, f, time);
    if (img) ctx.drawImage(img, bx - 36, by - 36, 72, 72);
    else drawPortraitPlaceholder(ctx, bx, by, 32, r);
    ctx.restore();
    const a = Math.atan2(sy - by, sx - bx);
    ctx.fillStyle = r.color;
    kit.polygonPath(ctx, [[bx + Math.cos(a) * 44, by + Math.sin(a) * 44], [bx + Math.cos(a + 0.35) * 33, by + Math.sin(a + 0.35) * 33], [bx + Math.cos(a - 0.35) * 33, by + Math.sin(a - 0.35) * 33]]);
    ctx.fill();
  }
}

export function drawBanner(ctx, R, b) {
  const W = R.cam.w / R.dpr, H = R.cam.h / R.dpr;
  const life = b.hold ? 9999 : 55;
  if (b.t > life) return false;
  const k = Math.min(1, b.t / 8);
  const scale = 0.6 + kit.clamp(1.25 - (1 - k) * 2, 0.6, 1.25) * 0.5 + (b.t < 8 ? (1 - k) * 0.8 : 0);
  const alpha = b.hold ? 1 : Math.min(1, (life - b.t) / 12);
  ctx.save();
  ctx.translate(W / 2, H * 0.42);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.font = `400 ${Math.min(150, W * 0.13)}px "Bungee", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 18; ctx.strokeStyle = '#1a0a26'; ctx.strokeText(b.text, 0, 0);
  const g = ctx.createLinearGradient(0, -60, 0, 60);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, b.color); g.addColorStop(1, '#ff8a3a');
  ctx.fillStyle = g; ctx.fillText(b.text, 0, 0);
  ctx.restore();
  return true;
}
