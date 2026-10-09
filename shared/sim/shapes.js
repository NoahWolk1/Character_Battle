// Collision shapes (spec §2.2.2, §3.1). Pure math, no game state.
//
// Local (body-space) shapes — origin at the collider's feet center, +x forward:
//   circle   { shape?: 'circle', x, y, r }          (default when `shape` is absent)
//   capsule  { shape: 'capsule', x1, y1, x2, y2, r }
//   rect     { shape: 'rect', x, y, w, h }          (x, y = CENTER, axis-aligned)
// World shapes come from mirror(); world rects additionally carry their bounds
// x1/y1/x2/y2 so overlap tests use exactly the arithmetic v1 used.

export const kindOf = (s) => s.shape || 'circle';

/**
 * Local shape → world shape: mirror x by facing, scale by bodyScale, translate to (x, y).
 * The arithmetic is chosen so a v1 hurtbox rect {x:0, y:-h/2, w, h} at scale 1
 * produces bit-identical bounds to v1's `f.x ± w/2, f.y − h, f.y`.
 */
export function mirror(s, facing, scale, x, y) {
  const k = kindOf(s);
  if (k === 'circle') return { shape: 'circle', x: x + s.x * facing * scale, y: y + s.y * scale, r: s.r * scale };
  if (k === 'capsule') {
    return {
      shape: 'capsule',
      x1: x + s.x1 * facing * scale, y1: y + s.y1 * scale,
      x2: x + s.x2 * facing * scale, y2: y + s.y2 * scale,
      r: s.r * scale,
    };
  }
  const lx1 = s.x - s.w / 2, lx2 = s.x + s.w / 2;
  const ly1 = s.y - s.h / 2, ly2 = s.y + s.h / 2;
  const x1 = facing >= 0 ? x + lx1 * scale : x - lx2 * scale;
  const x2 = facing >= 0 ? x + lx2 * scale : x - lx1 * scale;
  const y1 = y + ly1 * scale, y2 = y + ly2 * scale;
  return { shape: 'rect', x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1, x1, y1, x2, y2 };
}

/** Bounds of a rect (world rects carry them; local rects derive them). */
function rb(s) {
  if (s.x1 !== undefined) return s;
  return { x1: s.x - s.w / 2, x2: s.x + s.w / 2, y1: s.y - s.h / 2, y2: s.y + s.h / 2 };
}

/** Axis-aligned bounding box {x1, y1, x2, y2} of any shape (local or world). */
export function aabb(s) {
  const k = kindOf(s);
  if (k === 'circle') return { x1: s.x - s.r, y1: s.y - s.r, x2: s.x + s.r, y2: s.y + s.r };
  if (k === 'capsule') {
    return {
      x1: Math.min(s.x1, s.x2) - s.r, y1: Math.min(s.y1, s.y2) - s.r,
      x2: Math.max(s.x1, s.x2) + s.r, y2: Math.max(s.y1, s.y2) + s.r,
    };
  }
  const b = rb(s);
  return { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
}

/** Union AABB of a shape list (null if empty). */
export function aabbAll(list) {
  let out = null;
  for (const s of list) {
    const b = aabb(s);
    if (!out) out = { ...b };
    else { out.x1 = Math.min(out.x1, b.x1); out.y1 = Math.min(out.y1, b.y1); out.x2 = Math.max(out.x2, b.x2); out.y2 = Math.max(out.y2, b.y2); }
  }
  return out;
}

// ── distance helpers ──────────────────────────────────────────────────────
function segPointD2(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}

function cross(ax, ay, bx, by, cx, cy) { return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); }

function onSeg(ax, ay, bx, by, px, py) {
  return Math.min(ax, bx) <= px && px <= Math.max(ax, bx) && Math.min(ay, by) <= py && py <= Math.max(ay, by);
}

function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(cx, cy, dx, dy, ax, ay), d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy), d4 = cross(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSeg(cx, cy, dx, dy, ax, ay)) return true;
  if (d2 === 0 && onSeg(cx, cy, dx, dy, bx, by)) return true;
  if (d3 === 0 && onSeg(ax, ay, bx, by, cx, cy)) return true;
  if (d4 === 0 && onSeg(ax, ay, bx, by, dx, dy)) return true;
  return false;
}

function segSegD2(ax, ay, bx, by, cx, cy, dx, dy) {
  if (segsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    segPointD2(cx, cy, dx, dy, ax, ay), segPointD2(cx, cy, dx, dy, bx, by),
    segPointD2(ax, ay, bx, by, cx, cy), segPointD2(ax, ay, bx, by, dx, dy),
  );
}

function pointRectD2(px, py, b) {
  const nx = Math.max(b.x1, Math.min(px, b.x2));
  const ny = Math.max(b.y1, Math.min(py, b.y2));
  return (px - nx) ** 2 + (py - ny) ** 2;
}

/** Squared distance from a segment to an AABB (0 when they touch/intersect). */
function segRectD2(ax, ay, bx, by, b) {
  const inside = (x, y) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
  if (inside(ax, ay) || inside(bx, by)) return 0;
  const edges = [[b.x1, b.y1, b.x2, b.y1], [b.x2, b.y1, b.x2, b.y2], [b.x2, b.y2, b.x1, b.y2], [b.x1, b.y2, b.x1, b.y1]];
  let best = Math.min(pointRectD2(ax, ay, b), pointRectD2(bx, by, b));
  for (const e of edges) {
    if (segsIntersect(ax, ay, bx, by, e[0], e[1], e[2], e[3])) return 0;
    best = Math.min(best, segPointD2(ax, ay, bx, by, e[0], e[1]));
  }
  return best;
}

/** v1's circle-vs-rect test, kept bit-identical (inclusive). */
function circleRect(c, b) {
  const nx = Math.max(b.x1, Math.min(c.x, b.x2));
  const ny = Math.max(b.y1, Math.min(c.y, b.y2));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 <= c.r * c.r;
}

/**
 * Do two shapes overlap? Inclusive (touching counts). Shapes must be in the same
 * space (both local or both world). Circle/capsule use segment distance; rect-rect
 * is the axis-aligned SAT.
 */
export function overlap(a, b) {
  let ka = kindOf(a), kb = kindOf(b);
  // canonical order: circle < capsule < rect
  const rank = { circle: 0, capsule: 1, rect: 2 };
  if (rank[ka] > rank[kb]) { const t = a; a = b; b = t; const tk = ka; ka = kb; kb = tk; }
  if (ka === 'circle') {
    if (kb === 'circle') { const dx = a.x - b.x, dy = a.y - b.y, r = a.r + b.r; return dx * dx + dy * dy <= r * r; }
    if (kb === 'capsule') { const r = a.r + b.r; return segPointD2(b.x1, b.y1, b.x2, b.y2, a.x, a.y) <= r * r; }
    return circleRect(a, rb(b));
  }
  if (ka === 'capsule') {
    if (kb === 'capsule') { const r = a.r + b.r; return segSegD2(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2) <= r * r; }
    return segRectD2(a.x1, a.y1, a.x2, a.y2, rb(b)) <= a.r * a.r;
  }
  const p = rb(a), q = rb(b);
  return p.x1 <= q.x2 && q.x1 <= p.x2 && p.y1 <= q.y2 && q.y1 <= p.y2;
}

/** Any shape of list A overlaps any shape of list B? */
export function overlapAny(as, bs) {
  for (const a of as) for (const b of bs) if (overlap(a, b)) return true;
  return false;
}

/** Point-in-shape (inclusive). Used by tests and area rasterization. */
export function contains(s, px, py) {
  const k = kindOf(s);
  if (k === 'circle') return (px - s.x) ** 2 + (py - s.y) ** 2 <= s.r * s.r;
  if (k === 'capsule') return segPointD2(s.x1, s.y1, s.x2, s.y2, px, py) <= s.r * s.r;
  const b = rb(s);
  return px >= b.x1 && px <= b.x2 && py >= b.y1 && py <= b.y2;
}

/** Center point of a shape (hit sparks, push direction). */
export function center(s) {
  const k = kindOf(s);
  if (k === 'circle') return { x: s.x, y: s.y };
  if (k === 'capsule') return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
  const b = rb(s);
  return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
}
