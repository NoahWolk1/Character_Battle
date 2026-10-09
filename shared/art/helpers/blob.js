// ─────────────────────────────────────────────────────────────────────────────
// BLOB — spring soft body that follows target shapes (slimes, gel, ghosts, goo).
//
//   init(cache) { cache.gel = blob.create({ points: 28, stiffness: 0.18, damping: 0.82, seed: 3 }); }
//   draw(ctx, v, info) {
//     blob.step(info.cache.gel, { shapes: info.hurtboxes, dt: info.dt, impulse: info.motion, wobble: 0.6 });
//     const path = blob.path(info.cache.gel);              // Path2D (+ .pts), body space
//     kit.fillPath(ctx, path, color, { outline });
//     const top = blob.top(info.cache.gel);                  // face anchor
//   }
//
// Each outline point is a damped spring pulled toward where a ray from the shapes'
// centroid leaves their union, so the gel flows between hurtbox sets, stretches
// into hitboxes and jiggles on landing (impulse = info.motion).
// ─────────────────────────────────────────────────────────────────────────────
import { hash01, shapeKind } from '../kit.js';

const TAU = Math.PI * 2;

function inside(s, x, y) {
  const k = shapeKind(s);
  if (k === 'circle') { const dx = x - (s.x || 0), dy = y - (s.y || 0); return dx * dx + dy * dy <= s.r * s.r; }
  if (k === 'rect') return Math.abs(x - s.x) <= s.w / 2 && Math.abs(y - s.y) <= s.h / 2;
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / l2));
  const qx = s.x1 + dx * t - x, qy = s.y1 + dy * t - y;
  return qx * qx + qy * qy <= s.r * s.r;
}
const insideAny = (shapes, x, y) => shapes.some((s) => inside(s, x, y));

function extent(s) {
  const k = shapeKind(s);
  if (k === 'circle') return { x1: s.x - s.r, y1: s.y - s.r, x2: s.x + s.r, y2: s.y + s.r, a: Math.PI * s.r * s.r, cx: s.x, cy: s.y };
  if (k === 'rect') return { x1: s.x - s.w / 2, y1: s.y - s.h / 2, x2: s.x + s.w / 2, y2: s.y + s.h / 2, a: s.w * s.h, cx: s.x, cy: s.y };
  const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  return { x1: Math.min(s.x1, s.x2) - s.r, y1: Math.min(s.y1, s.y2) - s.r, x2: Math.max(s.x1, s.x2) + s.r, y2: Math.max(s.y1, s.y2) + s.r, a: len * 2 * s.r + Math.PI * s.r * s.r, cx: (s.x1 + s.x2) / 2, cy: (s.y1 + s.y2) / 2 };
}

/**
 * Where a ray from (cx, cy) at angle a leaves the union of shapes (outermost exit).
 * Marches outward then refines by bisection; falls back to the centroid distance 0.
 */
export function rayExit(shapes, cx, cy, a, maxR) {
  const dx = Math.cos(a), dy = Math.sin(a);
  const steps = 24;
  let last = -1;
  for (let i = 1; i <= steps; i++) {
    const r = (maxR * i) / steps;
    if (insideAny(shapes, cx + dx * r, cy + dy * r)) last = i;
  }
  if (last < 0) return 0;
  let lo = (maxR * last) / steps, hi = Math.min(maxR, (maxR * (last + 1)) / steps);
  for (let k = 0; k < 8; k++) {
    const mid = (lo + hi) / 2;
    if (insideAny(shapes, cx + dx * mid, cy + dy * mid)) lo = mid; else hi = mid;
  }
  return lo;
}

export const blob = {
  /** New soft-body state. points 8..64, stiffness 0.02..0.6 (spring pull), damping 0.5..0.98. */
  create({ points = 24, stiffness = 0.18, damping = 0.82, seed = 1, inflate = 1.04 } = {}) {
    const n = Math.max(8, Math.min(64, points | 0));
    return {
      n, stiffness, damping, seed, inflate, t: 0, ready: false,
      pts: Array.from({ length: n }, () => ({ x: 0, y: 0, vx: 0, vy: 0 })),
      cx: 0, cy: 0,
    };
  },

  /**
   * Advances the springs toward the union of `shapes` (body-space IR shapes).
   * impulse: {squash, stretch, lean} (info.motion); wobble: jiggle amount (0..3).
   */
  step(st, { shapes = [], dt = 1 / 60, impulse = null, wobble = 0.5 } = {}) {
    if (!st || !shapes.length) return st;
    const h = Math.max(0, Math.min(0.1, dt || 1 / 60)) * 60; // frames this step
    st.t += h / 60;
    // area-weighted centroid and a ray budget
    let ax = 0, ay = 0, A = 0, x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const s of shapes) {
      const e = extent(s);
      ax += e.cx * e.a; ay += e.cy * e.a; A += e.a;
      x1 = Math.min(x1, e.x1); y1 = Math.min(y1, e.y1); x2 = Math.max(x2, e.x2); y2 = Math.max(y2, e.y2);
    }
    let cx = ax / (A || 1), cy = ay / (A || 1);
    if (!insideAny(shapes, cx, cy)) { const e = extent(shapes[0]); cx = e.cx; cy = e.cy; }
    st.cx = cx; st.cy = cy;
    const maxR = Math.hypot(x2 - x1, y2 - y1) + 4;
    const sq = impulse?.squash || 0, sr = impulse?.stretch || 0, lean = impulse?.lean || 0;
    const sx = 1 + sq * 0.22 - sr * 0.12, sy = 1 - sq * 0.25 + sr * 0.15;
    const floor = y2;
    for (let i = 0; i < st.n; i++) {
      const a = (i / st.n) * TAU - Math.PI / 2;
      let r = rayExit(shapes, cx, cy, a, maxR) * st.inflate;
      r *= 1 + Math.sin(st.t * (5 + hash01(i, st.seed) * 3) + i * 1.7) * 0.025 * wobble;
      let tx = cx + Math.cos(a) * r, ty = cy + Math.sin(a) * r;
      // impulse: squash/stretch about the floor, lean shears the top
      tx = cx + (tx - cx) * sx - lean * (floor - ty) * 0.12;
      ty = floor - (floor - ty) * sy;
      const p = st.pts[i];
      if (!st.ready) { p.x = tx; p.y = ty; p.vx = p.vy = 0; continue; }
      const k = Math.min(1, st.stiffness * h);
      p.vx = (p.vx + (tx - p.x) * k) * Math.pow(st.damping, h);
      p.vy = (p.vy + (ty - p.y) * k) * Math.pow(st.damping, h);
      p.x += p.vx * h; p.y += p.vy * h;
    }
    // neighbor smoothing keeps the skin from kinking
    if (st.ready) {
      const pts = st.pts;
      for (let i = 0; i < st.n; i++) {
        const a = pts[(i + st.n - 1) % st.n], b = pts[(i + 1) % st.n], p = pts[i];
        p.x += ((a.x + b.x) / 2 - p.x) * 0.08;
        p.y += ((a.y + b.y) / 2 - p.y) * 0.08;
      }
    }
    st.ready = true;
    return st;
  },

  /** Smooth closed outline: Path2D when available (with .pts attached), else {pts}. */
  path(st) {
    const pts = st.pts.map((p) => [p.x, p.y]);
    if (typeof Path2D === 'undefined') return { pts };
    const path = new Path2D();
    const n = pts.length, t = 0.5 / 3;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      if (i === 0) path.moveTo(p1[0], p1[1]);
      path.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t, p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t, p2[0], p2[1]);
    }
    path.closePath();
    path.pts = pts;
    return path;
  },

  /** Topmost outline point (a face anchor). */
  top(st) {
    let best = st.pts[0];
    for (const p of st.pts) if (p.y < best.y) best = p;
    return { x: best.x, y: best.y };
  },

  /** Centroid the gel is pulled around. */
  center(st) { return { x: st.cx, y: st.cy }; },

  /** Outward spikes along the outline (shaded triangles). */
  spikes(ctx, st, { count = 10, length = 10, width = 7, color = '#1f8a4c', outline = '#0f4a29', from = 0, to = 1 } = {}) {
    const n = st.n;
    ctx.save();
    ctx.lineJoin = 'round';
    for (let k = 0; k < count; k++) {
      const f = from + ((k + 0.5) / count) * (to - from);
      const i = Math.floor(f * n) % n;
      const p = st.pts[i], a = st.pts[(i + n - 1) % n], b = st.pts[(i + 1) % n];
      let nx = b.y - a.y, ny = -(b.x - a.x);
      const d = Math.hypot(nx, ny) || 1;
      nx /= d; ny /= d;
      // outward = away from the centroid
      if ((p.x - st.cx) * nx + (p.y - st.cy) * ny < 0) { nx = -nx; ny = -ny; }
      const L = length * (0.8 + hash01(k, st.seed + 9) * 0.4);
      ctx.beginPath();
      ctx.moveTo(p.x - ny * width / 2, p.y + nx * width / 2);
      ctx.lineTo(p.x + nx * L, p.y + ny * L);
      ctx.lineTo(p.x + ny * width / 2, p.y - nx * width / 2);
      ctx.closePath();
      ctx.lineWidth = 2; ctx.strokeStyle = outline; ctx.stroke();
      ctx.fillStyle = color; ctx.fill();
    }
    ctx.restore();
  },
};

export default blob;
