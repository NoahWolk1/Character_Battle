// ─────────────────────────────────────────────────────────────────────────────
// TENTACLE — curling, swaying, reaching limbs (octopi, vines, eldritch things, tails).
//
//   init(cache) { cache.arms = [0, 1, 2].map((i) => tentacle.create({ segments: 12, length: 70, seed: i })); }
//   draw(ctx, v, info) {
//     const reach = info.phase.name === 'active' && info.hitboxes[0] ? kit.shapeCenter(info.hitboxes[0]) : null;
//     tentacle.step(t, { root: { x: 10, y: -30 }, angle: 0.4, curl: 0.6, time: info.time, target: reach });
//     tentacle.draw(ctx, t, { width: [10, 2], color: '#b0507a', suckers: '#f2c0d0', light: info.light });
//   }
//
// Pose = base angle + curl along the length + a travelling sway; a `target` blends in a
// FABRIK reach so strikes land exactly in the hitbox. Segment lengths never change.
// ─────────────────────────────────────────────────────────────────────────────
import { shade, rgba, lerp, hash01, TAU } from '../kit.js';

export const tentacle = {
  create({ segments = 12, length = 70, seed = 1 } = {}) {
    const n = Math.max(3, Math.min(48, segments | 0));
    return { n, seg: length / n, length, seed, reach: 0, pts: Array.from({ length: n + 1 }, (_, i) => ({ x: i * (length / n), y: 0 })) };
  },

  /**
   * root {x,y}; angle (rad, 0 = +x); curl (rad per length, + = clockwise); sway amplitude;
   * target {x,y}|null → reach (eased in/out over a few frames); time in seconds.
   */
  step(st, { root = { x: 0, y: 0 }, angle = 0, curl = 0.5, sway = 0.35, speed = 2.2, time = 0, target = null, dt = 1 / 60 } = {}) {
    const n = st.n, seg = st.seg;
    const pts = [{ x: root.x, y: root.y }];
    let a = angle, x = root.x, y = root.y;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      a += (curl * t * t * 2.2) / n + Math.sin(time * speed + i * 0.55 + hash01(st.seed, 3) * TAU) * sway * t / n * 3;
      x += Math.cos(a) * seg; y += Math.sin(a) * seg;
      pts.push({ x, y });
    }
    const h = Math.max(0, Math.min(0.1, dt || 1 / 60)) * 60;
    st.reach = target ? Math.min(1, st.reach + 0.25 * h) : Math.max(0, st.reach - 0.12 * h);
    if (st.reach > 0) {
      const goal = target || st.goal || pts[n];
      st.goal = goal;
      const ik = fabrik(pts.map((p) => ({ ...p })), goal, seg);
      const k = st.reach * st.reach * (3 - 2 * st.reach);
      for (let i = 0; i <= n; i++) { pts[i].x = lerp(pts[i].x, ik[i].x, k); pts[i].y = lerp(pts[i].y, ik[i].y, k); }
    }
    st.pts = pts;
    return st;
  },

  tip(st) { const p = st.pts[st.n]; return { x: p.x, y: p.y }; },

  /** Tapered limb with optional sucker dots along the underside and a rim light. */
  draw(ctx, st, { width = [10, 2], color = '#b0507a', outline = null, suckers = null, light = null, alpha = 1 } = {}) {
    const pts = st.pts, n = st.n;
    const W = typeof width === 'function' ? width : (t) => lerp(width[0], width[1], t);
    const L = [], R = [], N = [];
    for (let i = 0; i <= n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const w = W(i / n) / 2;
      N.push([-dy / d, dx / d]);
      L.push([pts[i].x - (dy / d) * w, pts[i].y + (dx / d) * w]);
      R.push([pts[i].x + (dy / d) * w, pts[i].y - (dx / d) * w]);
    }
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    L.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    const tip = pts[n];
    ctx.arc(tip.x, tip.y, Math.max(0.5, W(1) / 2), Math.atan2(N[n][1], N[n][0]), Math.atan2(N[n][1], N[n][0]) + Math.PI, true);
    for (let i = n; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
    ctx.closePath();
    ctx.lineWidth = 3; ctx.strokeStyle = outline || shade(color, -0.55); ctx.stroke();
    const g = ctx.createLinearGradient(pts[0].x, pts[0].y, tip.x, tip.y);
    g.addColorStop(0, shade(color, -0.12)); g.addColorStop(1, shade(color, 0.15));
    ctx.fillStyle = g; ctx.fill();
    if (suckers) {
      ctx.fillStyle = suckers; ctx.strokeStyle = rgba(shade(suckers, -0.4), 0.8); ctx.lineWidth = 1;
      for (let i = 1; i < n; i += 1) {
        const w = W(i / n) / 2, r = Math.max(0.8, w * 0.32);
        const x = pts[i].x + N[i][0] * w * 0.55, y = pts[i].y + N[i][1] * w * 0.55;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
      }
    }
    if (light) {
      ctx.strokeStyle = rgba(light.rim || '#ffffff', 0.5); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      const side = light.dir.x * N[0][0] + light.dir.y * N[0][1] < 0 ? L : R;
      ctx.beginPath(); side.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
    ctx.restore();
  },
};

/** FABRIK chain solve (root fixed) toward goal; returns the points. */
export function fabrik(pts, goal, seg, iters = 6) {
  const n = pts.length - 1;
  const root = { ...pts[0] };
  for (let k = 0; k < iters; k++) {
    pts[n].x = goal.x; pts[n].y = goal.y;
    for (let i = n - 1; i >= 0; i--) {
      const dx = pts[i].x - pts[i + 1].x, dy = pts[i].y - pts[i + 1].y, d = Math.hypot(dx, dy) || 1;
      pts[i].x = pts[i + 1].x + (dx / d) * seg; pts[i].y = pts[i + 1].y + (dy / d) * seg;
    }
    pts[0].x = root.x; pts[0].y = root.y;
    for (let i = 1; i <= n; i++) {
      const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y, d = Math.hypot(dx, dy) || 1;
      pts[i].x = pts[i - 1].x + (dx / d) * seg; pts[i].y = pts[i - 1].y + (dy / d) * seg;
    }
  }
  return pts;
}

export default tentacle;
