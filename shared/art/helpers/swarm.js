// ─────────────────────────────────────────────────────────────────────────────
// SWARM — boids that flock inside target shapes (bee swarms, bats, sparks, crowds).
//
//   init(cache) { cache.bees = swarm.create({ count: 36, seed: 7 }); }
//   draw(ctx, v, info) {
//     const shapes = info.phase.name === 'active' ? info.hitboxes : info.hurtboxes;
//     swarm.step(info.cache.bees, { shapes, dt: info.dt, speed: v.state === 'attack' ? 6 : 3 });
//     swarm.draw(ctx, info.cache.bees, { color: '#ffd23a', stripe: '#2a1a08', wings: true, light: info.light });
//   }
//
// Agents steer to personal targets sampled inside the shapes (re-rolled now and then),
// with separation and a little alignment, so the silhouette reads as the hurtbox and
// pours into the hitbox on active frames. Deterministic for a given seed and inputs.
// ─────────────────────────────────────────────────────────────────────────────
import { seeded, shapePoint, rgba, shade, TAU } from '../kit.js';

export const swarm = {
  /** count 1..200; size [min, max] px; seed for deterministic targets. */
  create({ count = 30, seed = 1, size = [2.5, 4.5], spread = 30 } = {}) {
    const rnd = seeded(seed);
    const n = Math.max(1, Math.min(200, count | 0));
    const agents = Array.from({ length: n }, (_, i) => ({
      x: (rnd() - 0.5) * spread, y: -spread - rnd() * spread, vx: 0, vy: 0, tx: 0, ty: 0,
      retarget: 0, phase: rnd() * TAU, size: size[0] + rnd() * (size[1] - size[0]), slot: i,
    }));
    return { agents, rnd, t: 0, ready: false };
  },

  /**
   * Steps the flock. shapes: body-space IR shapes (each agent picks one, area-weighted
   * by order); speed px/frame cap; cohesion/separation/alignment weights.
   */
  step(st, { shapes = [], dt = 1 / 60, speed = 3.5, accel = 0.35, separation = 1, alignment = 0.15, jitter = 0.4, retarget = 40, scatter = 0 } = {}) {
    if (!st || !shapes.length) return st;
    const h = Math.max(0, Math.min(0.1, dt || 1 / 60)) * 60;
    st.t += h / 60;
    const A = st.agents, rnd = st.rnd;
    for (const a of A) {
      a.retarget -= h;
      if (a.retarget <= 0 || !st.ready) {
        const s = shapes[a.slot % shapes.length];
        const p = shapePoint(s, rnd);
        a.tx = p.x; a.ty = p.y;
        a.retarget = retarget * (0.5 + rnd());
        if (!st.ready) { a.x = p.x; a.y = p.y; }
      }
    }
    const sep2 = 10 * 10;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      let fx = (a.tx - a.x) * 0.06, fy = (a.ty - a.y) * 0.06;
      let sx = 0, sy = 0, avx = 0, avy = 0, nn = 0;
      for (let j = Math.max(0, i - 6); j < Math.min(A.length, i + 7); j++) {
        if (j === i) continue;
        const b = A[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < sep2 && d2 > 0.0001) { sx += dx / d2; sy += dy / d2; }
        avx += b.vx; avy += b.vy; nn++;
      }
      fx += sx * 6 * separation + (nn ? (avx / nn - a.vx) * alignment : 0);
      fy += sy * 6 * separation + (nn ? (avy / nn - a.vy) * alignment : 0);
      fx += Math.sin(st.t * 7 + a.phase) * jitter;
      fy += Math.cos(st.t * 9 + a.phase * 1.3) * jitter;
      if (scatter) { fx += Math.cos(a.phase) * scatter; fy += Math.sin(a.phase) * scatter; }
      const m = Math.hypot(fx, fy), cap = accel * 2;
      if (m > cap) { fx *= cap / m; fy *= cap / m; }
      a.vx += fx * h; a.vy += fy * h;
      const v = Math.hypot(a.vx, a.vy);
      if (v > speed) { a.vx *= speed / v; a.vy *= speed / v; }
      a.x += a.vx * h; a.y += a.vy * h;
    }
    st.ready = true;
    return st;
  },

  /**
   * Draws the agents. Default look: shaded body with stripes and blurred wings;
   * pass drawAgent(ctx, agent, i, t) to draw anything else (bats, sparks, notes…).
   */
  draw(ctx, st, { color = '#ffd23a', stripe = null, outline = null, wings = true, light = null, drawAgent = null, alpha = 1 } = {}) {
    const t = st.t;
    const o = outline || shade(color, -0.55);
    // back-to-front by y for a little depth
    const order = [...st.agents].sort((a, b) => a.y - b.y);
    ctx.save();
    ctx.globalAlpha *= alpha;
    for (const a of order) {
      if (drawAgent) { ctx.save(); drawAgent(ctx, a, a.slot, t); ctx.restore(); continue; }
      const s = a.size, ang = Math.atan2(a.vy, a.vx || 0.0001);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(ang);
      if (wings) {
        const f = Math.sin(t * 60 + a.phase) * 0.5 + 0.5;
        ctx.fillStyle = rgba('#ffffff', 0.45);
        ctx.beginPath(); ctx.ellipse(-s * 0.2, -s * (0.6 + f * 0.5), s * 0.9, s * 0.45, -0.5, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-s * 0.2, s * (0.6 + f * 0.5), s * 0.9, s * 0.45, 0.5, 0, TAU); ctx.fill();
      }
      ctx.beginPath(); ctx.ellipse(0, 0, s * 1.25, s * 0.85, 0, 0, TAU);
      ctx.lineWidth = Math.max(1, s * 0.35); ctx.strokeStyle = o; ctx.stroke();
      ctx.fillStyle = color; ctx.fill();
      if (stripe) {
        ctx.save(); ctx.clip();
        ctx.fillStyle = stripe;
        for (const k of [-0.35, 0.3]) ctx.fillRect(k * s * 1.25 - s * 0.18, -s, s * 0.36, s * 2);
        ctx.restore();
      }
      if (light) {
        ctx.fillStyle = rgba('#ffffff', 0.55);
        ctx.beginPath(); ctx.arc(s * 0.4, -s * 0.35, s * 0.28, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  },

  /** AABB {x1,y1,x2,y2} of the flock (camera framing, portraits). */
  bounds(st) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const a of st.agents) { x1 = Math.min(x1, a.x); y1 = Math.min(y1, a.y); x2 = Math.max(x2, a.x); y2 = Math.max(y2, a.y); }
    return { x1, y1, x2, y2 };
  },
};

export default swarm;
