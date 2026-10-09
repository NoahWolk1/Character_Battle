// ─────────────────────────────────────────────────────────────────────────────
// SERPENT — a spine chain that follows its head (snakes, dragons, eels, worms, scarves).
//
//   init(cache) { cache.spine = serpent.create({ segments: 18, length: 150 }); }
//   draw(ctx, v, info) {
//     const head = { x: 30 + info.motion.lean * 6, y: -50 + Math.sin(info.time * 3) * 4 };
//     serpent.step(info.cache.spine, { head, dt: info.dt, slither: v.state === 'run' ? 8 : 3, time: info.time, gravity: 0.2 });
//     serpent.draw(ctx, info.cache.spine, { width: [16, 3], color: '#4fae5a', belly: '#d8e7a0', light: info.light });
//   }
//
// Points are in body space. Segment lengths are enforced every step (no stretching);
// `slither` adds a travelling lateral wave, `gravity` lets the tail droop.
// ─────────────────────────────────────────────────────────────────────────────
import { shade, rgba, lerp, TAU } from '../kit.js';

export const serpent = {
  create({ segments = 16, length = 120, dir = { x: -1, y: 0 } } = {}) {
    const n = Math.max(2, Math.min(64, segments | 0));
    const seg = length / n;
    return { n, seg, length, ready: false, t: 0, pts: Array.from({ length: n + 1 }, (_, i) => ({ x: dir.x * seg * i, y: dir.y * seg * i, px: dir.x * seg * i, py: dir.y * seg * i })) };
  },

  /**
   * Moves the head to `head` and drags the body. slither: wave amplitude (px);
   * wavelength in segments; gravity px/frame²; stiffness 0..1 (straightening).
   */
  step(st, { head, dt = 1 / 60, slither = 0, wavelength = 8, speed = 6, time = null, gravity = 0, stiffness = 0.1, floor = null } = {}) {
    if (!st || !head) return st;
    const h = Math.max(0, Math.min(0.1, dt || 1 / 60)) * 60;
    st.t = time ?? st.t + h / 60;
    const P = st.pts;
    if (!st.ready) { // first step: lay the body out behind the head
      for (const p of P) { p.x += head.x; p.y += head.y; p.px = p.x; p.py = p.y; }
      st.ready = true;
    }
    P[0].x = head.x; P[0].y = head.y;
    for (let i = 1; i <= st.n; i++) {
      const p = P[i];
      const vx = (p.x - p.px) * 0.86, vy = (p.y - p.py) * 0.86;
      p.px = p.x; p.py = p.y;
      p.x += vx * h; p.y += (vy + gravity) * h;
      if (floor != null && p.y > floor) p.y = floor;
    }
    for (let k = 0; k < 3; k++) {
      for (let i = 1; i <= st.n; i++) {
        const a = P[i - 1], b = P[i];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        dx /= d; dy /= d;
        // straighten toward the previous segment's direction
        if (i > 1 && stiffness) {
          const c = P[i - 2];
          let px = a.x - c.x, py = a.y - c.y;
          const pd = Math.hypot(px, py) || 1;
          px /= pd; py /= pd;
          dx = lerp(dx, px, stiffness); dy = lerp(dy, py, stiffness);
          const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
        }
        b.x = a.x + dx * st.seg; b.y = a.y + dy * st.seg;
      }
    }
    // travelling wave, applied perpendicular to the local direction (visual only)
    st.wave = [];
    for (let i = 0; i <= st.n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(st.n, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const amp = slither * Math.min(1, i / 3) * (1 - (i / st.n) * 0.3);
      const off = Math.sin(st.t * speed - (i / wavelength) * TAU) * amp;
      st.wave.push({ x: P[i].x - (dy / d) * off, y: P[i].y + (dx / d) * off });
    }
    return st;
  },

  /** Spine points (with the slither wave applied). */
  points(st) { return st.wave || st.pts.map((p) => ({ x: p.x, y: p.y })); },

  /**
   * Draws the body as a tapered ribbon: width = [head, tail] or fn(t 0..1) → px.
   * belly: lighter underside band; scales: draw scale arcs; outline: dark edge.
   */
  draw(ctx, st, { width = [14, 3], color = '#4fae5a', belly = null, outline = null, scales = true, light = null, alpha = 1 } = {}) {
    const pts = serpent.points(st);
    const n = pts.length - 1;
    const W = typeof width === 'function' ? width : (t) => lerp(width[0], width[1], t);
    const left = [], right = [], norms = [];
    for (let i = 0; i <= n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const w = W(i / n) / 2;
      norms.push([-dy / d, dx / d]);
      left.push([pts[i].x - (dy / d) * w, pts[i].y + (dx / d) * w]);
      right.push([pts[i].x + (dy / d) * w, pts[i].y - (dx / d) * w]);
    }
    const o = outline || shade(color, -0.55);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const trace = () => {
      ctx.beginPath();
      left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
      ctx.closePath();
    };
    trace();
    ctx.lineWidth = 3; ctx.strokeStyle = o; ctx.stroke();
    const g = ctx.createLinearGradient(pts[0].x, pts[0].y - W(0), pts[0].x, pts[0].y + W(0));
    g.addColorStop(0, shade(color, 0.22)); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = g; ctx.fill();
    ctx.save();
    trace(); ctx.clip();
    if (belly) {
      ctx.strokeStyle = belly; ctx.lineWidth = W(0.2) * 0.35;
      ctx.beginPath();
      pts.forEach((p, i) => { const w = W(i / n) * 0.28; const x = p.x + norms[i][0] * w, y = p.y + norms[i][1] * w; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    if (scales) {
      ctx.strokeStyle = rgba(shade(color, -0.4), 0.5); ctx.lineWidth = 1;
      for (let i = 1; i < n; i += 1) {
        const w = W(i / n) * 0.45;
        const a = Math.atan2(norms[i][1], norms[i][0]);
        ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, w, a + 0.9, a + Math.PI - 0.9); ctx.stroke();
      }
    }
    if (light) {
      // rim on the lit edge
      const side = (light.dir.x * norms[0][0] + light.dir.y * norms[0][1]) > 0 ? left : right;
      ctx.strokeStyle = rgba('#ffffff', 0.45); ctx.lineWidth = 2;
      ctx.beginPath(); side.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  },
};

export default serpent;
