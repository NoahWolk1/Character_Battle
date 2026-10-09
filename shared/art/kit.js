// ─────────────────────────────────────────────────────────────────────────────
// ART KIT — drawing helpers for character art (Canvas 2D).
// Every art hook receives this kit as `info.kit`, or you can import it:
//   import * as kit from '../../shared/art/kit.js';
// Coordinates in hooks are in "rig space": origin at the part's anchor,
// +x = the direction the fighter faces, +y = down.
// ─────────────────────────────────────────────────────────────────────────────

import { deepFreezeAll } from '../util/freeze.js';
import * as KIT from './kit.js';

// ── Color ───────────────────────────────────────────────────────────────────
// LRU-bounded so animated color strings (rgba with changing alpha…) can't leak.
const PARSE_MAX = 512;
const cache = new Map();
export function parse(c) {
  const hit = cache.get(c);
  if (hit) { if (cache.size > 64) { cache.delete(c); cache.set(c, hit); } return hit; }
  let r = 0, g = 0, b = 0, a = 1;
  if (typeof c !== 'string') c = String(c ?? '#000');
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else {
    const m = c.match(/[\d.]+/g) || [0, 0, 0];
    [r, g, b] = m.map(Number); a = m[3] !== undefined ? Number(m[3]) : 1;
  }
  const out = Object.freeze({ r, g, b, a });
  cache.set(c, out);
  if (cache.size > PARSE_MAX) cache.delete(cache.keys().next().value);
  return out;
}
/** Current parse-cache size (tests). */
export const parseCacheSize = () => cache.size;
const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export function toHex({ r, g, b }) { return `#${hex2(r)}${hex2(g)}${hex2(b)}`; }

/** Lighten (amt > 0) or darken (amt < 0) a color. amt in -1..1 */
export function shade(c, amt) {
  const { r, g, b } = parse(c);
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  return toHex({ r: r + (t - r) * p, g: g + (t - g) * p, b: b + (t - b) * p });
}
export function mix(c1, c2, t) {
  const a = parse(c1), b = parse(c2);
  return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}
export function rgba(c, alpha) {
  const { r, g, b } = parse(c);
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
}

// ── Paths ───────────────────────────────────────────────────────────────────
/** Tapered capsule from (x1,y1) radius r1 to (x2,y2) radius r2. Builds a path (no fill). */
export function capsulePath(ctx, x1, y1, x2, y2, r1, r2 = r1) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 0.0001;
  const a = Math.atan2(dy, dx);
  // Outer tangents: the larger end wraps π + 2·off, the smaller π − 2·off (round caps on both).
  const off = Math.asin(Math.max(-1, Math.min(1, (r1 - r2) / len)));
  ctx.beginPath();
  ctx.arc(x1, y1, r1, a + Math.PI / 2 - off, a - Math.PI / 2 + off);
  ctx.arc(x2, y2, r2, a - Math.PI / 2 + off, a + Math.PI / 2 - off);
  ctx.closePath();
}

export function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function polygonPath(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/** Smooth closed shape through points (Catmull-Rom → Bézier). */
export function blobPath(ctx, pts, tension = 0.5) {
  const n = pts.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (i === 0) ctx.moveTo(p1[0], p1[1]);
    const t = tension / 3;
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t, p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t, p2[0], p2[1]);
  }
  ctx.closePath();
}

export function starPath(ctx, x, y, points, r1, r2, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i * Math.PI) / points;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

// ── Fills ───────────────────────────────────────────────────────────────────
/**
 * Fill the current path with a lit gradient + outline. `lightDir` is where light
 * comes from in rig space (default: up and slightly forward).
 */
export function fillShaded(ctx, color, { outline = '#14101c', lineWidth = 3, x = 0, y = 0, r = 30, light = 0.28, dark = -0.32, gloss = 0 } = {}) {
  const g = ctx.createLinearGradient(x - r * 0.4, y - r, x + r * 0.5, y + r);
  g.addColorStop(0, shade(color, light));
  g.addColorStop(0.45, color);
  g.addColorStop(1, shade(color, dark));
  if (outline && lineWidth) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = outline;
    ctx.stroke();
  }
  ctx.fillStyle = g;
  ctx.fill();
  if (gloss) {
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = gloss;
    const hg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.5, 0, x - r * 0.3, y - r * 0.5, r);
    hg.addColorStop(0, 'rgba(255,255,255,0.9)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.restore();
  }
}

/** Draws a shaded limb segment between two joints. */
export function limb(ctx, a, b, r1, r2, color, opts = {}) {
  capsulePath(ctx, a.x, a.y, b.x, b.y, r1, r2);
  fillShaded(ctx, color, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: Math.hypot(b.x - a.x, b.y - a.y) / 2 + r1, ...opts });
}

export function circle(ctx, x, y, r, color, opts = {}) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  fillShaded(ctx, color, { x, y, r, ...opts });
}

/** Soft radial glow (additive-looking). */
export function glow(ctx, x, y, r, color, alpha = 0.6) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.4, rgba(color, alpha * 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Thin bright highlight stroke along a curve — great for rim light on hair/armor. */
export function rimLight(ctx, pts, color = '#ffffff', width = 2, alpha = 0.55) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

// ── Misc helpers ────────────────────────────────────────────────────────────
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const TAU = Math.PI * 2;

// ─────────────────────────────────────────────────────────────────────────────
// v2 additions. Everything below is pure Canvas 2D and works in any body space
// (draw), world space (drawBack/drawWorld/entities) or portrait canvas.
// "dir" arguments are unit vectors pointing TOWARD the light (info.light.dir).
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic hash noise in [0,1) for an integer (and optional salt). */
export function hash01(n, salt = 0) {
  let h = Math.imul((n | 0) ^ Math.imul(salt | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth 1-D value noise in [0,1). */
export function noise1(x, salt = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash01(i, salt) * (1 - u) + hash01(i + 1, salt) * u;
}
// Accept an rng function, an object with next(), or a numeric seed.
function rngOf(r) {
  if (typeof r === 'function') return r;
  if (r && typeof r.next === 'function') return () => r.next();
  return seeded(typeof r === 'number' ? r : 1);
}

/** Flat (or shaded with opts.shaded) ellipse; opts.outline strokes it. */
export function ellipse(ctx, x, y, rx, ry, color, opts = {}) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, Math.abs(rx)), Math.max(0.01, Math.abs(ry)), opts.rotation || 0, 0, TAU);
  if (opts.shaded) return fillShaded(ctx, color, { x, y, r: Math.max(rx, ry), ...opts });
  ctx.fillStyle = color; ctx.fill();
  if (opts.outline) { ctx.lineWidth = opts.lineWidth || 2; ctx.strokeStyle = opts.outline; ctx.stroke(); }
}

/** Radial gradient with evenly spaced stops; colors = ['#a', '#b'] or [[0, '#a'], [1, '#b']]. */
export function radial(ctx, x, y, r0, r1, colors, x1 = x, y1 = y) {
  const g = ctx.createRadialGradient(x, y, Math.max(0, r0), x1, y1, Math.max(0.01, r1));
  addStops(g, colors);
  return g;
}
/** Linear gradient with evenly spaced stops. */
export function linear(ctx, x0, y0, x1, y1, colors) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  addStops(g, colors);
  return g;
}
function addStops(g, colors) {
  const n = colors.length;
  colors.forEach((c, i) => (Array.isArray(c) ? g.addColorStop(c[0], c[1]) : g.addColorStop(n > 1 ? i / (n - 1) : 0, c)));
}

// Traces a Path2D or an [[x,y],…] / [{x,y},…] polygon into the context's current path.
function tracePts(ctx, pts, dx = 0, dy = 0, closed = true) {
  pts.forEach((p, i) => {
    const x = (p.x ?? p[0]) + dx, y = (p.y ?? p[1]) + dy;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  if (closed) ctx.closePath();
}
const isPath2D = (p) => typeof Path2D !== 'undefined' && p instanceof Path2D;
function ptsOf(path) { return Array.isArray(path) ? path : path?.pts || null; }

/** Fills a Path2D / point list with a color or gradient, optional outline (stroked under the fill edge). */
export function fillPath(ctx, path, fill, { outline = null, lineWidth = 3, alpha = 1 } = {}) {
  ctx.save();
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  ctx.lineJoin = 'round';
  if (isPath2D(path)) {
    if (outline) { ctx.lineWidth = lineWidth; ctx.strokeStyle = outline; ctx.stroke(path); }
    ctx.fillStyle = fill; ctx.fill(path);
  } else {
    const pts = ptsOf(path);
    if (pts?.length) {
      ctx.beginPath(); tracePts(ctx, pts);
      if (outline) { ctx.lineWidth = lineWidth; ctx.strokeStyle = outline; ctx.stroke(); }
      ctx.fillStyle = fill; ctx.fill();
    }
  }
  ctx.restore();
}

/** Thin rim-light arc on the side of a circle that faces the light. */
export function rimArc(ctx, x, y, r, dir = { x: -0.5, y: -0.85 }, color = '#ffffff', width = 2, alpha = 0.6, span = 1.7) {
  const a = Math.atan2(dir.y, dir.x);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r - width * 0.6), a - span / 2, a + span / 2); ctx.stroke();
  ctx.restore();
}

/**
 * Rim light along any closed path: a crescent band inside the shape on the lit side
 * (the shape minus itself shifted away from the light).
 */
export function rimLightPath(ctx, path, dir = { x: -0.5, y: -0.85 }, color = '#ffffff', width = 3, alpha = 0.6) {
  const dx = -dir.x * width, dy = -dir.y * width;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  if (isPath2D(path)) {
    ctx.clip(path);
    const p = new Path2D();
    p.rect(-1e4, -1e4, 2e4, 2e4);
    p.addPath(path, { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });
    ctx.fill(p, 'evenodd');
  } else {
    const pts = ptsOf(path);
    if (pts?.length) {
      ctx.beginPath(); tracePts(ctx, pts); ctx.clip();
      ctx.beginPath(); ctx.rect(-1e4, -1e4, 2e4, 2e4); tracePts(ctx, pts, dx, dy);
      ctx.fill('evenodd');
    }
  }
  ctx.restore();
}

// ── Shapes (IR shapes: circle {x,y,r} | capsule {x1,y1,x2,y2,r} | rect {x,y,w,h} center) ──
export function shapeKind(s) { return s.shape || (s.w !== undefined ? 'rect' : s.x1 !== undefined ? 'capsule' : 'circle'); }

/** Builds the path of a shape (no fill). */
export function shapePath(ctx, s, grow = 0) {
  const k = shapeKind(s);
  if (k === 'rect') { roundRectPath(ctx, s.x - s.w / 2 - grow, s.y - s.h / 2 - grow, s.w + grow * 2, s.h + grow * 2, Math.min(6, s.w / 4, s.h / 4) + grow); return; }
  if (k === 'capsule') { capsulePath(ctx, s.x1, s.y1, s.x2, s.y2, s.r + grow); return; }
  ctx.beginPath(); ctx.arc(s.x || 0, s.y || 0, Math.max(0.1, s.r + grow), 0, TAU);
}
/** Center of a shape. */
export function shapeCenter(s) {
  return shapeKind(s) === 'capsule' ? { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 } : { x: s.x || 0, y: s.y || 0 };
}
/** A point inside the shape. `rnd` = rng function (or seed number). */
export function shapePoint(s, rnd = Math.random) {
  const r = rngOf(rnd);
  const k = shapeKind(s);
  if (k === 'rect') return { x: s.x + (r() - 0.5) * s.w, y: s.y + (r() - 0.5) * s.h };
  const a = r() * TAU, d = Math.sqrt(r()) * s.r;
  if (k === 'capsule') { const t = r(); return { x: lerp(s.x1, s.x2, t) + Math.cos(a) * d, y: lerp(s.y1, s.y2, t) + Math.sin(a) * d }; }
  return { x: (s.x || 0) + Math.cos(a) * d, y: (s.y || 0) + Math.sin(a) * d };
}
/** Soft additive glow filling a shape: the visual IS the hitbox. */
export function shapeGlow(ctx, s, color = '#ffffff', alpha = 0.4) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const k = shapeKind(s);
  if (k === 'circle') glow(ctx, s.x || 0, s.y || 0, s.r * 1.5, color, alpha);
  else {
    const c = shapeCenter(s);
    const ext = k === 'rect' ? Math.max(s.w, s.h) / 2 : Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 2 + s.r;
    shapePath(ctx, s, 2);
    ctx.fillStyle = radial(ctx, c.x, c.y, 0, ext * 1.2, [rgba(color, alpha), rgba(color, alpha * 0.35)]);
    ctx.fill();
  }
  ctx.globalAlpha *= alpha * 0.9;
  shapePath(ctx, s);
  ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
  ctx.restore();
}

// ── Elemental effects ───────────────────────────────────────────────────────
/** Jagged lightning bolt from (x1,y1) to (x2,y2). rng = info.rng (or a seed) keeps it deterministic. */
export function lightning(ctx, rng, x1, y1, x2, y2, color = '#bff4ff', width = 3, alpha = 1, { branches = 0, glow: glowW = 0, segments = 0, jag = 0.22, core = '#ffffff' } = {}) {
  const r = rngOf(rng);
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const n = segments || Math.max(4, Math.round(len / 14));
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  const pts = [[x1, y1]];
  for (let i = 1; i < n; i++) {
    const t = i / n, off = (r() - 0.5) * 2 * jag * len / Math.sqrt(n) * Math.sin(Math.PI * t) * 1.6;
    pts.push([lerp(x1, x2, t) + nx * off, lerp(y1, y2, t) + ny * off]);
  }
  pts.push([x2, y2]);
  const stroke = (w, c, a) => {
    ctx.globalAlpha = a; ctx.strokeStyle = c; ctx.lineWidth = w;
    ctx.beginPath(); tracePts(ctx, pts, 0, 0, false); ctx.stroke();
  };
  ctx.save();
  const base = ctx.globalAlpha * alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';
  if (glowW) stroke(glowW, rgba(color, 0.25), base);
  stroke(width * 2.4, color, base * 0.45);
  stroke(width, color, base);
  stroke(Math.max(0.6, width * 0.4), core, base);
  for (let b = 0; b < branches; b++) {
    const i = 1 + Math.floor(r() * (n - 2));
    const [bx, by] = pts[i];
    const bl = len * (0.15 + r() * 0.25), ba = Math.atan2(y2 - y1, x2 - x1) + (r() - 0.5) * 1.6;
    ctx.restore(); ctx.save();
    lightning(ctx, r, bx, by, bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl, color, width * 0.55, alpha * 0.8, { core, jag });
  }
  ctx.restore();
}

/** Energy beam from (x,y) along +x (rotate the ctx for other angles). */
export function beam(ctx, x, y, len, width, color = '#7fd3ff', time = 0, { core = '#ffffff', jitter = 2, angle = 0, alpha = 1 } = {}) {
  ctx.save();
  ctx.translate(x, y); if (angle) ctx.rotate(angle);
  ctx.globalAlpha *= alpha;
  ctx.globalCompositeOperation = 'lighter';
  const j = Math.sin(time * 37) * jitter * 0.5 + Math.sin(time * 23 + 1) * jitter * 0.5;
  const w = width + j;
  ctx.fillStyle = linear(ctx, 0, -w * 1.6, 0, w * 1.6, [rgba(color, 0), rgba(color, 0.35), rgba(color, 0)]);
  ctx.fillRect(0, -w * 1.6, len, w * 3.2);
  capsulePath(ctx, 0, 0, len, 0, w * 0.6);
  ctx.fillStyle = rgba(color, 0.85); ctx.fill();
  capsulePath(ctx, 0, 0, len, 0, Math.max(1, w * 0.25));
  ctx.fillStyle = core; ctx.fill();
  glow(ctx, 0, 0, w * 2.4, color, 0.8);
  glow(ctx, len, 0, w * 1.8, color, 0.6);
  // travelling energy bands
  for (let i = 0; i < 6; i++) {
    const t = ((time * 2.2 + i / 6) % 1) * len;
    ctx.globalAlpha = 0.5 * alpha;
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.ellipse(t, 0, w * 0.9, w * 0.45, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** Rain streaks in a rect (x = center, y = top). info.time drives the fall (seconds). */
export function rain(ctx, info, { x = 0, y = 0, w = 80, h = 120, color = '#8fc3ff', fade = 1, density = 1, angle = 0.18, speed = 420 } = {}) {
  const t = info?.time || 0;
  const n = Math.round((w * h) / 260 * density);
  ctx.save();
  ctx.globalAlpha *= clamp(fade, 0, 1);
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const px = x - w / 2 + hash01(i, 7) * w;
    const ly = (hash01(i, 11) * h + t * speed * (0.8 + hash01(i, 3) * 0.4)) % h;
    const len = 8 + hash01(i, 5) * 10;
    const k = 1 - Math.abs(ly / h - 0.5) * 1.6;
    if (k <= 0) continue;
    ctx.globalAlpha = clamp(fade, 0, 1) * k * 0.8;
    ctx.lineWidth = 1 + hash01(i, 9) * 1.2;
    ctx.beginPath(); ctx.moveTo(px - angle * len, y + ly - len); ctx.lineTo(px, y + ly); ctx.stroke();
  }
  ctx.restore();
}

/** Cluster of shaded cloud puffs around (x,y), gently breathing over `time` (seconds). */
export function cloudPuffs(ctx, x, y, r, color = '#5d6a8c', time = 0, { count = 6, light = { x: -0.4, y: -0.9 }, rim = '#ffffff' } = {}) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + 0.4;
    const pr = r * (0.42 + hash01(i, 21) * 0.22) * (1 + Math.sin(time * 1.6 + i) * 0.04);
    const px = x + Math.cos(a) * r * 0.5, py = y + Math.sin(a) * r * 0.22 - (i % 2) * r * 0.12;
    circle(ctx, px, py, pr, color, { outline: shade(color, -0.45), lineWidth: 2, r: pr, gloss: 0.12 });
    rimArc(ctx, px, py, pr, light, rim, 1.6, 0.45);
  }
  circle(ctx, x, y - r * 0.12, r * 0.55, shade(color, 0.08), { outline: null, r: r * 0.55, gloss: 0.15 });
}

/** Wobbling goo puddle (w×h) centered at the origin; k scales/fades it. */
export function goo(ctx, w, h, color = '#57e389', time = 0, k = 1) {
  k = clamp(k, 0, 1.5);
  if (k <= 0.01) return;
  const n = 14, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const wob = 1 + Math.sin(time * 3 + i * 1.7) * 0.06 + (hash01(i, 31) - 0.5) * 0.12;
    pts.push([Math.cos(a) * w * 0.5 * wob * k, Math.min(h * 0.4, Math.sin(a) * h * 0.5 * wob * k)]);
  }
  ctx.save();
  ctx.globalAlpha *= Math.min(1, k * 1.4);
  blobPath(ctx, pts, 0.6);
  fillShaded(ctx, color, { outline: shade(color, -0.5), lineWidth: 2, r: w * 0.4, gloss: 0.3 });
  for (let i = 0; i < 3; i++) {
    const bx = (hash01(i, 41) - 0.5) * w * 0.6 * k, ph = (time * 0.8 + hash01(i, 43)) % 1;
    ctx.globalAlpha = 0.5 * (1 - ph) * Math.min(1, k);
    ctx.strokeStyle = shade(color, 0.6); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(bx, -h * 0.1, 1.5 + ph * 4, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

/** Teardrop pointing along `angle` (radians): round head forward, tail trailing back. */
export function droplet(ctx, x, y, r, color = '#57e389', angle = 0, outline = null) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-r * 2.4, 0);
  ctx.quadraticCurveTo(-r * 0.6, -r * 1.05, 0, -r);
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.quadraticCurveTo(-r * 0.6, r * 1.05, -r * 2.4, 0);
  ctx.closePath();
  fillShaded(ctx, color, { outline: outline || shade(color, -0.5), lineWidth: Math.max(1.5, r * 0.22), r: r * 1.5, gloss: 0.45 });
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath(); ctx.ellipse(r * 0.25, -r * 0.4, r * 0.28, r * 0.16, -0.4, 0, TAU); ctx.fill();
  ctx.restore();
}

/** Motion streaks inside a rect (x,y = top-left), scrolling backward (dir -1) over time. */
export function speedLines(ctx, x, y, w, h, color = '#ffffff', time = 0, { count = 9, alpha = 0.7, dir = -1, width = 2 } = {}) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const ly = y + (i + 0.5) / count * h + (hash01(i, 51) - 0.5) * h / count;
    const ph = (time * 3 + hash01(i, 53)) % 1;
    const len = w * (0.25 + hash01(i, 55) * 0.35);
    const sx = dir < 0 ? x + w - ph * (w + len) : x - len + ph * (w + len);
    ctx.globalAlpha = alpha * Math.sin(ph * Math.PI);
    ctx.lineWidth = width * (0.6 + hash01(i, 57));
    ctx.beginPath(); ctx.moveTo(Math.max(x, sx), ly); ctx.lineTo(Math.min(x + w, sx + len), ly); ctx.stroke();
  }
  ctx.restore();
}

/** Crescent smear for active frames: arc from a0 to a1 (radians) at radius r. */
export function smear(ctx, x, y, r, a0, a1, width, color = '#ffffff', alpha = 0.8) {
  const n = 16, outer = [], inner = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = lerp(a0, a1, t), w = width * Math.sin(Math.PI * Math.pow(t, 0.7));
    outer.push([x + Math.cos(a) * (r + w / 2), y + Math.sin(a) * (r + w / 2)]);
    inner.push([x + Math.cos(a) * (r - w / 2), y + Math.sin(a) * (r - w / 2)]);
  }
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath(); tracePts(ctx, [...outer, ...inner.reverse()]);
  ctx.fillStyle = linear(ctx, x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r, [rgba(color, 0), rgba(color, 0.6), color]);
  ctx.fill();
  ctx.restore();
}

/** Small blinking status icon: 'battery-low' | 'warning' | 'heart' | 'zzz' | 'alert' | 'question'. */
export function blinkIcon(ctx, x, y, icon = 'alert', time = 0, { size = 14, color = '#ff4d5e', rate = 2.5 } = {}) {
  if (Math.sin(time * rate * TAU) < -0.2) return;
  const s = size;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = '#1a1020';
  switch (icon) {
    case 'battery-low':
      roundRectPath(ctx, -s * 0.7, -s * 0.4, s * 1.3, s * 0.8, 2); ctx.fillStyle = '#f4f0f8'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1a1020'; ctx.fillRect(s * 0.6, -s * 0.18, s * 0.18, s * 0.36);
      ctx.fillStyle = color; ctx.fillRect(-s * 0.58, -s * 0.28, s * 0.3, s * 0.56);
      break;
    case 'heart':
      ctx.beginPath(); ctx.moveTo(0, s * 0.45);
      ctx.bezierCurveTo(-s, -s * 0.1, -s * 0.45, -s * 0.85, 0, -s * 0.3);
      ctx.bezierCurveTo(s * 0.45, -s * 0.85, s, -s * 0.1, 0, s * 0.45);
      ctx.fillStyle = color; ctx.fill(); ctx.stroke();
      break;
    case 'zzz':
      ctx.font = `bold ${s}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#f4f0f8';
      ctx.strokeText('z', 0, 0); ctx.fillText('z', 0, 0); ctx.strokeText('z', s * 0.6, -s * 0.6); ctx.fillText('z', s * 0.6, -s * 0.6);
      break;
    default: {
      polygonPath(ctx, [[0, -s * 0.6], [s * 0.6, s * 0.45], [-s * 0.6, s * 0.45]]);
      ctx.fillStyle = icon === 'warning' ? '#ffc531' : color; ctx.fill(); ctx.stroke();
      ctx.font = `bold ${s * 0.75}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = '#1a1020';
      ctx.fillText(icon === 'question' ? '?' : '!', 0, s * 0.35);
    }
  }
  ctx.restore();
}

/** Ball of yarn rolling by `rot` radians; {trail:true} adds a loose strand. */
export function yarnBall(ctx, x, y, r, color = '#e86fa0', rot = 0, { trail = false, outline = null } = {}) {
  const o = outline || shade(color, -0.55);
  if (trail) {
    ctx.save(); ctx.strokeStyle = shade(color, -0.1); ctx.lineWidth = Math.max(1.2, r * 0.14); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - r * 0.6, y + r * 0.7);
    ctx.bezierCurveTo(x - r * 1.6, y + r * 1.2, x - r * 2.2, y + r * 0.2 + Math.sin(rot) * r * 0.4, x - r * 3.2, y + r * 0.8);
    ctx.stroke(); ctx.restore();
  }
  circle(ctx, x, y, r, color, { outline: o, lineWidth: Math.max(1.5, r * 0.16), r, gloss: 0.2 });
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.96, 0, TAU); ctx.clip();
  ctx.strokeStyle = shade(color, -0.3); ctx.lineWidth = Math.max(1, r * 0.1);
  for (let i = 0; i < 5; i++) {
    const a = rot + i * 0.63;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.05, r * (0.25 + i * 0.14), a, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

// ── Offscreen helpers ───────────────────────────────────────────────────────
const tempPool = [];
/**
 * A scratch canvas: a DOM canvas on the main thread (rasterizes exactly like the game
 * canvas; OffscreenCanvas anti-aliases slightly differently), OffscreenCanvas in
 * workers, null where neither exists (Node).
 */
export function makeCanvas(w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  if (typeof document !== 'undefined' && document.createElement) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}
function borrow(w, h) {
  let c = tempPool.pop() || makeCanvas(w, h);
  if (!c) return null;
  if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
  return c;
}

/**
 * Group alpha: renders drawFn into a scratch layer, then composites it at `alpha`,
 * so overlapping translucent parts don't double up (clean ghosts, water, glass).
 */
export function groupAlpha(ctx, alpha, drawFn) {
  const W = ctx.canvas?.width, H = ctx.canvas?.height;
  const layer = W && H ? borrow(W, H) : null;
  if (!layer) { ctx.save(); ctx.globalAlpha *= alpha; drawFn(ctx); ctx.restore(); return; }
  const l = layer.getContext('2d');
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.clearRect(0, 0, W, H);
  l.setTransform(ctx.getTransform());
  try { drawFn(l); } finally {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= alpha;
    ctx.drawImage(layer, 0, 0, W, H, 0, 0, W, H);
    ctx.restore();
    if (tempPool.length < 4) tempPool.push(layer);
  }
}

/** Sprite outline: draws `image` (or a sub-rect) dilated by px in `color`, then the image on top. */
export function outline(ctx, image, x, y, w, h, color = '#16121e', px = 2, src = null) {
  if (!image) return;
  const [sx, sy, sw, sh] = src || [0, 0, image.width, image.height];
  const pad = Math.ceil(px) + 1;
  const scaleX = sw / w, scaleY = sh / h;
  const tw = Math.ceil(sw + pad * 2 * scaleX), th = Math.ceil(sh + pad * 2 * scaleY);
  const layer = borrow(tw, th);
  if (!layer) { ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h); return; }
  const l = layer.getContext('2d');
  l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, layer.width, layer.height);
  const ox = pad * scaleX, oy = pad * scaleY;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    l.drawImage(image, sx, sy, sw, sh, ox + Math.cos(a) * px * scaleX, oy + Math.sin(a) * px * scaleY, sw, sh);
  }
  l.globalCompositeOperation = 'source-in';
  l.fillStyle = color; l.fillRect(0, 0, tw, th);
  l.globalCompositeOperation = 'source-over';
  ctx.drawImage(layer, 0, 0, tw, th, x - pad, y - pad, w + pad * 2, h + pad * 2);
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  if (tempPool.length < 4) tempPool.push(layer);
}

// §5.1: frozen exports, so character code can't patch the shared kit for everyone.
deepFreezeAll(KIT);
