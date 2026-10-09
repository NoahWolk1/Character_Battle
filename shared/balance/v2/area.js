// ─────────────────────────────────────────────────────────────────────────────
// Geometry for the v2 validator (spec §4.1.1-4.1.2): hurtbox union area, the
// equal-area radius cap, reach measured from the hurtbox union, and pulling
// shapes in toward the collider center. Body-local coordinates (feet origin,
// +x forward, y down). Pure and deterministic; browser-safe.
// ─────────────────────────────────────────────────────────────────────────────
import { rasterArea } from '../../sim/hurtbox.js';

/**
 * Union area (px²) of body-local shapes on the same deterministic 2 px raster
 * the runtime uses (hurtbox.js), so validator and engine always agree.
 */
export function unionArea(shapes) {
  return shapes && shapes.length ? rasterArea(shapes) : 0;
}

/** Equal-area radius for the radius cap: circle r, capsule r (length is limited by reach), rect √(wh/π). */
export function equalRadius(s) {
  if (s.shape === 'rect') return Math.sqrt(Math.abs(s.w * s.h) / Math.PI);
  return s.r;
}

/** Shrink a shape so its equal-area radius is `r` (rect: uniform w/h scale; others: r). */
export function setEqualRadius(s, r) {
  if (s.shape === 'rect') {
    const k = r / Math.max(1e-9, equalRadius(s));
    s.w = r2(s.w * k); s.h = r2(s.h * k);
  } else s.r = r2(r);
}

// ── distances ───────────────────────────────────────────────────────────────
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Distance from a point to a shape (0 inside). */
export function distToShape(px, py, s) {
  if (s.shape === 'capsule') return Math.max(0, segDist(px, py, s.x1, s.y1, s.x2, s.y2) - s.r);
  if (s.shape === 'rect') {
    const dx = Math.max(0, Math.abs(px - s.x) - s.w / 2);
    const dy = Math.max(0, Math.abs(py - s.y) - s.h / 2);
    return Math.hypot(dx, dy);
  }
  return Math.max(0, Math.hypot(px - s.x, py - s.y) - s.r);
}

const distToUnion = (px, py, shapes) => {
  let d = Infinity;
  for (const s of shapes) d = Math.min(d, distToShape(px, py, s));
  return d;
};

/** Sample points of a shape with the radius to add: [[x, y, pad]]. */
function samples(s) {
  if (s.shape === 'capsule') {
    const out = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; out.push([s.x1 + (s.x2 - s.x1) * t, s.y1 + (s.y2 - s.y1) * t, s.r]); }
    return out;
  }
  if (s.shape === 'rect') {
    const out = [];
    const x1 = s.x - s.w / 2, y1 = s.y - s.h / 2;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      out.push([x1 + s.w * t, y1, 0], [x1 + s.w * t, y1 + s.h, 0], [x1, y1 + s.h * t, 0], [x1 + s.w, y1 + s.h * t, 0]);
    }
    return out;
  }
  return [[s.x, s.y, s.r]];
}

/**
 * v2 reach (§4.1.2): how far the hitbox's far edge extends beyond the nearest
 * point of the hurtbox union (0 if fully inside it).
 */
export function reachBeyond(hit, hurt) {
  if (!hurt || !hurt.length) return reachFrom(hit, 0, 0);
  let m = 0;
  for (const [x, y, pad] of samples(hit)) m = Math.max(m, distToUnion(x, y, hurt) + pad);
  return m;
}

/** Farthest distance of any point of the shape from (ox, oy). */
export function reachFrom(s, ox, oy) {
  if (s.shape === 'capsule') return Math.max(Math.hypot(s.x1 - ox, s.y1 - oy), Math.hypot(s.x2 - ox, s.y2 - oy)) + s.r;
  if (s.shape === 'rect') {
    const dx = Math.abs(s.x - ox) + s.w / 2, dy = Math.abs(s.y - oy) + s.h / 2;
    return Math.hypot(dx, dy);
  }
  return Math.hypot(s.x - ox, s.y - oy) + s.r;
}

/** Shape scaled toward (ox, oy) by k (homothety: positions, plus rect size). Returns a new shape. */
export function pulled(s, k, ox, oy) {
  const px = (x) => ox + (x - ox) * k;
  const py = (y) => oy + (y - oy) * k;
  if (s.shape === 'capsule') return { ...s, x1: px(s.x1), y1: py(s.y1), x2: px(s.x2), y2: py(s.y2) };
  if (s.shape === 'rect') return { ...s, x: px(s.x), y: py(s.y), w: s.w * k, h: s.h * k };
  return { ...s, x: px(s.x), y: py(s.y) };
}

/** Write the geometry of `src` into `dst` (rounded to 0.01). */
export function assignGeometry(dst, src) {
  for (const k of ['x', 'y', 'r', 'w', 'h', 'x1', 'y1', 'x2', 'y2']) if (k in src && typeof src[k] === 'number') dst[k] = r2(src[k]);
}

/** Uniformly scale a shape about (cx, cy) (default: the body origin at the feet). Returns a new shape. */
export function scaledShape(s, k, cx = 0, cy = 0) {
  const X = (x) => r2(cx + (x - cx) * k), Y = (y) => r2(cy + (y - cy) * k);
  if (s.shape === 'capsule') return { ...s, x1: X(s.x1), y1: Y(s.y1), x2: X(s.x2), y2: Y(s.y2), r: r2(s.r * k) };
  if (s.shape === 'rect') return { ...s, x: X(s.x), y: Y(s.y), w: r2(s.w * k), h: r2(s.h * k) };
  return { ...s, x: X(s.x), y: Y(s.y), r: r2(s.r * k) };
}

/** Distance of a point from the collider center (spawn offsets). */
export const offsetFrom = (x, y, ox, oy) => Math.hypot(x - ox, y - oy);

export const r2 = (v) => Math.round(v * 100) / 100;
