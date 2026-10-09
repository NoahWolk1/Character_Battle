// characters/gloop/gel.js — Gloop's gel painter. Pure canvas helpers (no state):
// palettes, the 3-tier translucent body with rim + specular, inner bubbles and
// nucleus, the floating eyes and mouth, shaded spikes, and the swallowed bolt.
// All coordinates are body space (feet origin, +x forward); `L` is the light
// direction in body space (info.light.dir with x flipped by facing).
import * as kit from '../../shared/art/kit.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const easeIn = (t) => clamp(t, 0, 1) ** 2;
export const hash = kit.hash01;

// Lime lab-gel. Outline is a dark green (never black); light/main/deep are the 3 value tiers.
export const PAL = {
  main: '#25b06f', light: '#8be8b4', deep: '#0e643f', core: '#074128', outline: '#052a19',
  spec: '#f4fff6', eye: '#f3fff6', pupil: '#0a2015', mouth: '#0b3a22', effect: '#7dff9a', glow: '#d2ffdd',
};
// Alt palettes for duplicate picks: berry, blue raspberry, grape (cool hues pop on the sunset).
export const ALT_PALETTES = [
  {},
  { main: '#f26aa9', light: '#ffc6df', deep: '#a8286a', core: '#7a1048', outline: '#4a0a2c', pupil: '#2a0618', mouth: '#4a0a2c', effect: '#ff8ac4', glow: '#ffdcee' },
  { main: '#5cb4f2', light: '#c2e7ff', deep: '#1f5fa8', core: '#123f7a', outline: '#0a2648', pupil: '#06142a', mouth: '#0a2648', effect: '#8ad0ff', glow: '#daf0ff' },
  { main: '#9466ec', light: '#d6c2ff', deep: '#5a2fae', core: '#3a1a7a', outline: '#22104a', pupil: '#16082e', mouth: '#22104a', effect: '#c3a2ff', glow: '#ece2ff' },
];

const FORM_CACHE = new Map();
/** Palette for a form: Spike is denser (darker, more saturated) with pale tips. */
export function formPalette(P, form) {
  const key = `${form}|${P.main}|${P.deep}|${P.outline}`;
  let out = FORM_CACHE.get(key);
  if (out) return out;
  const B = { ...PAL, ...P };
  if (form === 'spike') {
    out = { ...B, light: kit.mix(B.light, B.main, 0.35), main: kit.mix(B.main, B.deep, 0.3), deep: kit.mix(B.deep, B.core, 0.35),
      tip: kit.mix(B.light, '#ffffff', 0.5), spine: kit.mix(B.deep, B.outline, 0.25) };
  } else out = { ...B, tip: B.light, spine: B.deep };
  if (FORM_CACHE.size > 64) FORM_CACHE.clear();
  FORM_CACHE.set(key, out);
  return out;
}

/** Axis-aligned box of outline points ([x, y] or {x, y}). */
export function boxOf(pts) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) {
    const x = p.x ?? p[0], y = p.y ?? p[1];
    if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  if (!Number.isFinite(x1)) return { x1: -30, y1: -60, x2: 30, y2: 0, cx: 0, cy: -30, w: 60, h: 60 };
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 };
}

// ── Paths (Path2D, body space) ──────────────────────────────────────────────
const HAS_PATH = typeof Path2D !== 'undefined';
const mkPath = () => (HAS_PATH ? new Path2D() : null);

/** Smooth closed Catmull-Rom outline through [x, y] points (pts attached). */
export function smoothPath(pts) {
  // one winding direction for every piece, so the nonzero union never punches holes
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) pts = pts.slice().reverse();
  const path = mkPath();
  if (!path) return { pts };
  const n = pts.length, t = 0.5 / 3;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (i === 0) path.moveTo(p1[0], p1[1]);
    path.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t, p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t, p2[0], p2[1]);
  }
  path.closePath();
  path.pts = pts;
  return path;
}

/** Tapered capsule (root r1 → tip r2): a pseudopod. */
export function taperPath(x1, y1, r1, x2, y2, r2) {
  const path = mkPath();
  if (!path) return null;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len <= Math.abs(r1 - r2) + 0.5) {
    const big = r1 >= r2;
    path.arc(big ? x1 : x2, big ? y1 : y2, Math.max(0.5, big ? r1 : r2), 0, TAU);
    return path;
  }
  // tangent points sit at ±(90° − β) from the axis, β = asin((r1 − r2) / len)
  const a = Math.atan2(dy, dx), off = Math.asin(clamp((r1 - r2) / len, -1, 1));
  path.arc(x1, y1, r1, a + Math.PI / 2 - off, a - Math.PI / 2 + off);
  path.arc(x2, y2, r2, a - Math.PI / 2 + off, a + Math.PI / 2 - off);
  path.closePath();
  return path;
}

/** A crystal spine: round root, straight flanks, sharp point `ext` beyond the tip. */
export function spinePath(x1, y1, r1, x2, y2, ext) {
  const path = mkPath();
  if (!path) return null;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const a = Math.atan2(dy, dx);
  path.arc(x1, y1, r1, a + Math.PI / 2, a - Math.PI / 2);
  path.lineTo(x2 + ux * ext, y2 + uy * ext);
  path.closePath();
  return path;
}

/** Wobbling ball (n points around a circle, sine ripple). */
export function ballPts(x, y, r, time, { n = 14, amp = 0.05, seed = 1, sy = 1 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (1 + amp * Math.sin(time * (6 + hash(i, seed) * 4) + i * 2.1));
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * sy]);
  }
  return pts;
}

/** A goo slab from x1 to x2, bottom at `bottom`, height h, rippling top. */
export function slabPts(x1, x2, bottom, h, time, seed = 2) {
  const pts = [], w = Math.max(4, x2 - x1), n = Math.max(4, Math.round(w / 14));
  const r = Math.min(h * 0.5, w * 0.25);
  pts.push([x1 + r * 0.3, bottom], [x2 - r * 0.3, bottom], [x2, bottom - h * 0.45]);
  for (let i = n; i >= 0; i--) {
    const f = i / n, x = lerp(x2 - r * 0.6, x1 + r * 0.6, 1 - f);
    const ripple = Math.sin(time * 9 + f * 9 + seed) * h * 0.12 + (hash(i, seed) - 0.5) * h * 0.18;
    pts.push([x, bottom - h + ripple]);
  }
  pts.push([x1, bottom - h * 0.45]);
  return pts;
}

/** Path that is everything (inside box ± pad) EXCEPT `p` (clip with 'evenodd'). */
function outside(p, b, pad = 40) {
  const o = new Path2D();
  o.rect(b.x1 - pad, b.y1 - pad, b.w + pad * 2, b.h + pad * 2);
  o.addPath(p);
  return o;
}

/** Rim band inside `path` on the side facing `dir` (box-limited, cheap). */
function band(ctx, path, b, dir, color, width, alpha) {
  const p = outside(path, b), m = new Path2D();
  m.addPath(p, { a: 1, b: 0, c: 0, d: 1, e: -dir.x * width, f: -dir.y * width });
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.clip(path);
  ctx.fillStyle = color;
  ctx.fill(m, 'evenodd');
  ctx.restore();
}

/**
 * Paints a union of gel pieces as ONE material: outline stroked under an opaque fill
 * (so interior seams vanish), 3 value tiers along the light, depth + subsurface
 * glow, inner content (o.inner, clipped), embedded face (o.face, clipped, with a
 * gel film over it), terminator, rim + cool inner edge per piece (clipped away from
 * the other pieces so seams stay clean), and a wet specular window on piece 0.
 * pieces: Path2D[] (piece 0 = main body); box: AABB of the union.
 */
export function paintUnion(ctx, pieces, box, P, L, o = {}) {
  if (!HAS_PATH || !pieces.length) return;
  const { rim = '#ffc48a', lw = 3.2, alpha = 1, low = false } = o;
  const { cx, cy, w, h } = box;
  const R = Math.max(8, Math.max(w, h) / 2);
  const U = new Path2D();
  for (const p of pieces) U.addPath(p);
  ctx.save();
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw * 2; ctx.strokeStyle = P.outline;
  for (const p of pieces) ctx.stroke(p);
  ctx.fillStyle = kit.linear(ctx, cx + L.x * R, cy + L.y * R, cx - L.x * R * 0.9, cy - L.y * R * 0.9,
    [[0, P.light], [0.26, P.main], [0.68, P.deep], [1, P.core]]);
  ctx.fill(U);
  ctx.save();
  ctx.clip(U);
  // depth: thicker gel darkens toward the far side of the core
  ctx.fillStyle = kit.radial(ctx, cx - L.x * R * 0.3, cy - L.y * R * 0.2 + h * 0.08, 0, R * 1.05,
    [[0, kit.rgba(P.core, 0.3)], [0.6, kit.rgba(P.core, 0.1)], [1, kit.rgba(P.core, 0)]]);
  ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
  // subsurface: light through the gel pools low on the far side
  const bx = cx - L.x * w * 0.26, by = box.y2 - Math.min(h * 0.22, 16);
  ctx.fillStyle = kit.radial(ctx, bx, by, 0, Math.max(10, Math.min(w, h * 1.6) * 0.5),
    [[0, kit.rgba(P.glow, 0.5)], [0.5, kit.rgba(P.light, 0.2)], [1, kit.rgba(P.light, 0)]]);
  ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
  if (o.inner) o.inner(ctx, box);
  if (o.face) {
    o.face(ctx);
    ctx.fillStyle = kit.rgba(P.main, 0.12); // a film of gel over the floating face
    ctx.fill(U);
  }
  ctx.restore();
  // per-piece light bands, clipped off the other pieces
  for (let i = 0; i < pieces.length; i++) {
    if (low && i > 0) break;
    ctx.save();
    for (let j = 0; j < pieces.length; j++) if (j !== i) ctx.clip(outside(pieces[j], box), 'evenodd');
    const pr = i === 0 ? R : R * 0.6, NL = { x: -L.x, y: -L.y };
    band(ctx, pieces[i], box, NL, P.core, Math.max(4, pr * 0.2), 0.3);   // terminator
    if (!low) band(ctx, pieces[i], box, NL, P.glow, 1.6, 0.28);         // bounce light
    band(ctx, pieces[i], box, L, rim, 3.4, 0.85);                        // stage rim
    if (!low) band(ctx, pieces[i], box, L, P.spec, 1.3, 0.7);           // wet edge
    ctx.restore();
  }
  // specular window + glint on the body
  ctx.save();
  ctx.clip(pieces[0]);
  const sx = cx + L.x * w * 0.24, sy = cy + L.y * h * 0.3;
  ctx.fillStyle = kit.radial(ctx, sx, sy, 0, R * 0.55, [[0, kit.rgba(P.spec, 0.32)], [1, kit.rgba(P.spec, 0)]]);
  ctx.fillRect(sx - R, sy - R, R * 2, R * 2);
  ctx.translate(sx, sy); ctx.rotate(Math.atan2(L.y, L.x) + Math.PI / 2);
  const rx = clamp(w * 0.15, 4, 16), ry = clamp(Math.min(w, h) * 0.075, 2, 6.5);
  ctx.fillStyle = kit.rgba(P.spec, 0.85);
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = kit.rgba('#ffffff', 0.9);
  ctx.beginPath(); ctx.arc(rx * 1.25, ry * 1.6, Math.max(1.4, ry * 0.55), 0, TAU); ctx.fill();
  ctx.restore();
  ctx.restore();
}

/** Particle shape: a glossy gel droplet that points along its velocity. */
export function gelDrop(ctx, p) {
  const T = ctx.getTransform ? ctx.getTransform() : null;
  if (T) ctx.rotate(-Math.atan2(T.b, T.a)); // cancel the particle's random spin
  const sp = Math.hypot(p.vx || 0, p.vy || 0);
  const r = p.size * 0.5 * (0.6 + 0.4 * p.k);
  if (sp > 1.2) kit.droplet(ctx, 0, 0, r, p.color, Math.atan2(p.vy, p.vx));
  else {
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.9, 0, 0, TAU); ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.25); ctx.strokeStyle = kit.shade(p.color, -0.5); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.35, r * 0.28, 0, TAU); ctx.fill();
  }
}

/** Rising translucent bubbles inside `box` (call inside the body clip). */
export function bubbles(ctx, box, P, time, { count = 7, speed = 1, seed = 3, size = 1 } = {}) {
  const { x1, y2, w, h, cx } = box;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const sp = (0.18 + hash(i, seed) * 0.22) * speed;
    const ph = (time * sp + hash(i, seed + 1)) % 1;
    const r = (1.4 + hash(i, seed + 2) * 2.8) * size * (0.7 + ph * 0.5);
    const x = cx + (hash(i, seed + 3) - 0.5) * w * 0.7 + Math.sin(time * 2.2 + i * 1.9) * 2.5;
    const y = y2 - 6 - ph * Math.max(10, h - 14);
    if (x < x1 + 3) continue;
    const a = Math.sin(ph * Math.PI) * 0.75;
    ctx.globalAlpha = a * 0.35;
    ctx.fillStyle = P.light;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.globalAlpha = a;
    ctx.lineWidth = 1; ctx.strokeStyle = P.glow;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.38, Math.max(0.6, r * 0.28), 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** Dark cell nucleus; k = mass 0..1 sets its size; full = glowing (globShot ready). */
export function nucleus(ctx, x, y, r, P, time, full = 0) {
  const n = 9, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (1 + 0.12 * Math.sin(time * 2.1 + i * 2.3) + (hash(i, 77) - 0.5) * 0.18);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.86]);
  }
  ctx.save();
  kit.blobPath(ctx, pts, 0.5);
  ctx.fillStyle = kit.radial(ctx, x - r * 0.2, y - r * 0.2, 0, r * 1.1, [[0, kit.rgba(P.core, 0.55)], [0.7, kit.rgba(P.core, 0.3)], [1, kit.rgba(P.core, 0.08)]]);
  ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = kit.rgba(P.deep, 0.5); ctx.stroke();
  if (full > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 7);
    kit.glow(ctx, x, y, r * (1.4 + pulse * 0.4), P.effect, 0.35 * full);
    ctx.fillStyle = kit.rgba('#ffffff', 0.5 * full * pulse);
    ctx.beginPath(); ctx.arc(x, y, r * 0.25, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/** A rusty lab bolt slowly turning inside the gel (Gloop's first meal). */
export function bolt(ctx, x, y, s, rot, P, alpha = 0.6) {
  const metal = kit.mix('#a7b0ba', P.deep, 0.45), dark = kit.mix('#5a5f68', P.core, 0.4), rust = kit.mix('#b0612e', P.deep, 0.35);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.lineJoin = 'round'; ctx.lineWidth = 1.3; ctx.strokeStyle = dark;
  ctx.fillStyle = metal;
  ctx.beginPath(); ctx.rect(-2.2, 0, 4.4, 11); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = dark; ctx.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-2.2, 2.5 + i * 2.4); ctx.lineTo(2.2, 1.5 + i * 2.4); ctx.stroke(); }
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 5, -1.5 + Math.sin(a) * 2.6); }
  ctx.closePath(); ctx.fillStyle = metal; ctx.fill(); ctx.stroke();
  ctx.fillStyle = kit.rgba(rust, 0.8);
  ctx.beginPath(); ctx.arc(1.5, 6, 1.3, 0, TAU); ctx.fill();
  ctx.fillStyle = kit.rgba('#ffffff', 0.55);
  ctx.beginPath(); ctx.ellipse(-1.6, -2.6, 1.8, 0.8, -0.3, 0, TAU); ctx.fill();
  ctx.restore();
}

/** Something swallowed by Engulf: a glowing orb that dissolves (k 1 → 0). */
export function morsel(ctx, x, y, r, P, k, time) {
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha *= clamp(k * 1.4, 0, 1);
  kit.glow(ctx, x, y, r * 2.4, P.effect, 0.5 * k);
  ctx.fillStyle = kit.mix('#fff6c8', P.light, 1 - k);
  ctx.beginPath(); ctx.arc(x, y, r * (0.4 + 0.6 * k), 0, TAU); ctx.fill();
  ctx.strokeStyle = kit.rgba('#ffffff', 0.7 * k); ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const a = time * 3 + i * 2.1;
    ctx.beginPath(); ctx.arc(x, y, r * (1.3 + 0.3 * i) * (1.2 - k * 0.2), a, a + 1.1); ctx.stroke();
  }
  ctx.restore();
}

/**
 * Two eyes floating in the gel. o: { expr, look:{x,y}, blink 0..1, size, spread, L }
 * expr: normal | focus | angry | happy | hurt | dizzy | shock | squint | closed
 */
export function eyes(ctx, x, y, P, o = {}) {
  const { expr = 'normal', look = { x: 0.6, y: 0 }, blink = 0, size = 1, spread = 15, L = { x: -0.45, y: -0.89 }, time = 0 } = o;
  const rx = 6.6 * size, ry = 8.6 * size;
  for (const side of [-1, 1]) {
    const k = side < 0 ? 0.86 : 1; // far eye a touch smaller (3/4 view)
    const ex = x + side * spread * 0.5 * size, ey = y + (side < 0 ? 1 : 0);
    eye(ctx, ex, ey, rx * k, ry * k, side, P, expr, look, blink, L, time);
  }
}

function eye(ctx, x, y, rx, ry, side, P, expr, look, blink, L, time) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const ink = P.pupil;
  if (expr === 'happy' || expr === 'closed') {
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(2, rx * 0.42);
    ctx.beginPath();
    if (expr === 'happy') ctx.arc(x, y + ry * 0.25, rx * 0.8, Math.PI * 1.1, Math.PI * 1.9);
    else ctx.arc(x, y - ry * 0.1, rx * 0.8, Math.PI * 0.12, Math.PI * 0.88);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (expr === 'hurt') { // squeezed > < chevrons
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(2, rx * 0.42);
    const d = -side;
    ctx.beginPath();
    ctx.moveTo(x - d * rx * 0.7, y - ry * 0.55); ctx.lineTo(x + d * rx * 0.55, y); ctx.lineTo(x - d * rx * 0.7, y + ry * 0.55);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const open = expr === 'squint' ? 0.35 : expr === 'shock' ? 1.12 : 1;
  const bk = clamp(1 - blink, 0.08, 1) * open;
  const sRy = ry * bk, sRx = rx * (expr === 'shock' ? 1.1 : 1);
  // sclera (soft-shaded) with a dark hue outline
  ctx.beginPath(); ctx.ellipse(x, y, sRx, sRy, 0, 0, TAU);
  ctx.fillStyle = kit.radial(ctx, x + L.x * sRx * 0.4, y + L.y * sRy * 0.4, 0, Math.max(sRx, sRy) * 1.2, [P.eye, kit.mix(P.eye, P.main, 0.35)]);
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, rx * 0.26); ctx.strokeStyle = P.outline; ctx.stroke();
  if (bk > 0.2) {
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y, sRx, sRy, 0, 0, TAU); ctx.clip();
    if (expr === 'dizzy') {
      ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.2, rx * 0.22);
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = time * 9 * side + i * 0.55, r = (i / 24) * Math.min(sRx, sRy) * 0.85;
        ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.stroke();
    } else {
      const pr = expr === 'shock' ? 0.32 : 0.6;
      const px = x + clamp(look.x, -1, 1) * sRx * 0.36, py = y + clamp(look.y, -1, 1) * sRy * 0.3;
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.ellipse(px, py, sRx * pr, sRy * pr * 1.1, 0, 0, TAU); ctx.fill();
      // iris tint ring + catchlight on the lit side
      ctx.strokeStyle = kit.rgba(P.deep, 0.7); ctx.lineWidth = Math.max(0.8, rx * 0.12);
      ctx.beginPath(); ctx.ellipse(px, py, sRx * pr * 0.72, sRy * pr * 0.8, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(px + L.x * sRx * 0.28, py + L.y * sRy * 0.22, Math.max(1, rx * 0.22), 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(px - L.x * sRx * 0.2, py - L.y * sRy * 0.24, Math.max(0.5, rx * 0.09), 0, TAU); ctx.fill();
    }
    // lids: focus/angry slant down toward the front; squint cuts both
    if (expr === 'focus' || expr === 'angry') {
      const drop = expr === 'angry' ? 0.55 : 0.32;
      ctx.fillStyle = P.deep;
      ctx.beginPath();
      ctx.moveTo(x - sRx * 1.3, y - sRy * 1.3);
      ctx.lineTo(x + sRx * 1.3, y - sRy * 1.3);
      ctx.lineTo(x + sRx * 1.3, y - sRy * (0.9 - drop * 1.6));
      ctx.lineTo(x - sRx * 1.3, y - sRy * (0.9 - drop * 0.2));
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (expr === 'focus' || expr === 'angry') {
      const drop = expr === 'angry' ? 0.55 : 0.32;
      ctx.strokeStyle = P.outline; ctx.lineWidth = Math.max(1.6, rx * 0.3);
      ctx.beginPath();
      ctx.moveTo(x - sRx * 1.05, y - sRy * (0.9 - drop * 0.2) - 1);
      ctx.lineTo(x + sRx * 1.1, y - sRy * (0.9 - drop * 1.6) - 1);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.8, rx * 0.36);
    ctx.beginPath(); ctx.moveTo(x - sRx * 0.9, y); ctx.lineTo(x + sRx * 0.9, y); ctx.stroke();
  }
  ctx.restore();
}

/** Mouth: smile | grin | flat | o | wavy | open (open 0..1 sizes the gape). */
export function mouth(ctx, x, y, P, kind = 'smile', size = 1, open = 1) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = P.mouth; ctx.lineWidth = 2.2 * size;
  const s = size;
  if (kind === 'smile') {
    ctx.beginPath(); ctx.arc(x, y - 3 * s, 5 * s, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke();
  } else if (kind === 'flat') {
    ctx.beginPath(); ctx.moveTo(x - 4 * s, y); ctx.quadraticCurveTo(x, y + 1 * s, x + 4.5 * s, y - 1.2 * s); ctx.stroke();
  } else if (kind === 'wavy') {
    ctx.beginPath(); ctx.moveTo(x - 6 * s, y);
    for (let i = 1; i <= 4; i++) ctx.lineTo(x - 6 * s + i * 3 * s, y + (i % 2 ? -2 : 2) * s);
    ctx.stroke();
  } else {
    // filled mouths: o / grin / open
    const w = kind === 'o' ? 3.4 * s : kind === 'grin' ? 7 * s : (5 + 9 * open) * s;
    const h = kind === 'o' ? 4 * s : kind === 'grin' ? 5 * s : (3 + 11 * open) * s;
    ctx.beginPath();
    if (kind === 'grin') { ctx.moveTo(x - w, y - h * 0.3); ctx.quadraticCurveTo(x, y + h * 1.4, x + w, y - h * 0.5); ctx.quadraticCurveTo(x, y + h * 0.1, x - w, y - h * 0.3); }
    else ctx.ellipse(x, y, w, h, 0, 0, TAU);
    ctx.fillStyle = kit.radial(ctx, x, y + h * 0.3, 0, Math.max(w, h), [kit.shade(P.mouth, -0.4), P.mouth]);
    ctx.fill();
    ctx.lineWidth = 1.8 * s; ctx.strokeStyle = P.outline; ctx.stroke();
    if (kind === 'open' && open > 0.3) { // tongue + wet highlight
      ctx.save(); ctx.clip();
      ctx.fillStyle = kit.mix('#ff7a9a', P.main, 0.35);
      ctx.beginPath(); ctx.ellipse(x + w * 0.1, y + h * 0.75, w * 0.6, h * 0.45, 0, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.fillStyle = kit.rgba('#ffffff', 0.6);
      ctx.beginPath(); ctx.ellipse(x - w * 0.45, y - h * 0.55, w * 0.22, h * 0.12, -0.4, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Shaded spikes on the outline (two-tone facets, pale tips). Points whose outward
 * normal faces the floor are skipped. o: { count, len, width, time, glint 0..1, seed }
 */
export function spikes(ctx, gel, P, L, o = {}) {
  const { count = 14, len = 13, width = 10, time = 0, glint = 0, seed = 5, lw = 2.2 } = o;
  const n = gel.n, pts = gel.pts;
  ctx.save();
  ctx.lineJoin = 'round';
  for (let k = 0; k < count; k++) {
    const i = Math.floor(((k + 0.5) / count) * n) % n;
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    let nx = b.y - a.y, ny = -(b.x - a.x);
    const d = Math.hypot(nx, ny) || 1;
    nx /= d; ny /= d;
    if ((p.x - gel.cx) * nx + (p.y - gel.cy) * ny < 0) { nx = -nx; ny = -ny; }
    if (ny > 0.55) continue; // no spikes into the floor
    const Lk = len * (0.75 + hash(k, seed) * 0.5) * (1 + 0.07 * Math.sin(time * 3.1 + k * 1.3));
    const tx = -ny, ty = nx; // tangent
    const bx = p.x - nx * 4, by = p.y - ny * 4; // base sunk into the gel
    const tipX = p.x + nx * Lk, tipY = p.y + ny * Lk;
    const lit = tx * L.x + ty * L.y > 0 ? 1 : -1; // which facet faces the light
    const hw = width / 2;
    // outline pass (whole spike)
    ctx.beginPath();
    ctx.moveTo(bx + tx * hw, by + ty * hw); ctx.lineTo(tipX, tipY); ctx.lineTo(bx - tx * hw, by - ty * hw); ctx.closePath();
    ctx.lineWidth = lw; ctx.strokeStyle = P.outline; ctx.stroke();
    // facets
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(bx + tx * hw * s, by + ty * hw * s); ctx.lineTo(tipX, tipY); ctx.lineTo(bx, by); ctx.closePath();
      ctx.fillStyle = s === lit ? P.main : P.spine; ctx.fill();
    }
    // pale tip
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - nx * Lk * 0.32 + tx * hw * 0.32, tipY - ny * Lk * 0.32 + ty * hw * 0.32);
    ctx.lineTo(tipX - nx * Lk * 0.32 - tx * hw * 0.32, tipY - ny * Lk * 0.32 - ty * hw * 0.32);
    ctx.closePath(); ctx.fillStyle = P.tip; ctx.fill();
    if (glint > 0) kit.glow(ctx, tipX, tipY, 6 + glint * 6, '#ffffff', 0.55 * glint);
  }
  ctx.restore();
}
