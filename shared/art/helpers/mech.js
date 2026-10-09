// ─────────────────────────────────────────────────────────────────────────────
// MECH — rigid parts plus 2-bone IK (robots, mechs, armor, puppets, machines).
//
//   const leg = mech.ik2({ x: 0, y: -60 }, { x: 12, y: 0 }, 34, 34, -1);   // hip → foot, knee forward
//   mech.limb(ctx, leg, { width: 10, color: '#8a96a8', joint: '#ffcf4a' });
//   mech.plate(ctx, { x: 0, y: -80, w: 60, h: 46, r: 8, angle: 0.05, color: '#5d6f8c', light: info.light, rivets: true });
//   mech.piston(ctx, { x: -10, y: -70 }, leg.joint, { width: 5 });
//   mech.thruster(ctx, 0, 0, Math.PI / 2, power, info.time, ['#fff', '#7fd3ff', '#2a6bd1']);
//
// IK is analytic (law of cosines) and clamps unreachable targets to full extension.
// ─────────────────────────────────────────────────────────────────────────────
import { shade, rgba, glow, roundRectPath, TAU } from '../kit.js';

export const mech = {
  /**
   * Two-bone IK from `root` toward `target` with bone lengths a, b.
   * bend: +1 / −1 picks the elbow/knee side (in body space, +1 = clockwise).
   * @returns {{root, joint, end, a1, a2, reached}} a1/a2 = bone angles (rad)
   */
  ik2(root, target, a, b, bend = 1) {
    let dx = target.x - root.x, dy = target.y - root.y;
    let d = Math.hypot(dx, dy);
    const max = a + b - 1e-6, min = Math.abs(a - b) + 1e-6;
    const reached = d <= max && d >= min;
    if (d < 1e-6) { dx = 0; dy = 1; d = 1e-6; }
    const dc = Math.max(min, Math.min(max, d));
    const base = Math.atan2(dy, dx);
    const cosA = (a * a + dc * dc - b * b) / (2 * a * dc);
    const off = Math.acos(Math.max(-1, Math.min(1, cosA))) * (bend >= 0 ? 1 : -1);
    const a1 = base - off;
    const joint = { x: root.x + Math.cos(a1) * a, y: root.y + Math.sin(a1) * a };
    const a2 = Math.atan2(root.y + Math.sin(base) * dc - joint.y, root.x + Math.cos(base) * dc - joint.x);
    const end = { x: joint.x + Math.cos(a2) * b, y: joint.y + Math.sin(a2) * b };
    return { root: { ...root }, joint, end, a1, a2, reached };
  },

  /** Draws an IK limb: two shaded bones, joint caps, optional foot/hand plate. */
  limb(ctx, ik, { width = 9, width2 = null, color = '#8a96a8', joint = null, outline = null, foot = null } = {}) {
    const o = outline || shade(color, -0.6);
    const w2 = width2 ?? width * 0.85;
    mech.bone(ctx, ik.root, ik.joint, width, color, o);
    mech.bone(ctx, ik.joint, ik.end, w2, shade(color, 0.06), o);
    const jc = joint || shade(color, 0.3);
    for (const [p, r] of [[ik.root, width * 0.62], [ik.joint, width * 0.55]]) {
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.lineWidth = 2; ctx.strokeStyle = o; ctx.stroke();
      ctx.fillStyle = jc; ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.5);
      ctx.beginPath(); ctx.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.3, 0, TAU); ctx.fill();
    }
    if (foot) mech.plate(ctx, { x: ik.end.x + (foot.dx || 4), y: ik.end.y - (foot.h || 6) / 2, w: foot.w || width * 2.2, h: foot.h || 6, r: 2, color: foot.color || shade(color, -0.15), outline: o });
  },

  /** A straight, slightly tapered rigid segment between two points. */
  bone(ctx, p, q, width, color, outline) {
    const a = Math.atan2(q.y - p.y, q.x - p.x), L = Math.hypot(q.x - p.x, q.y - p.y);
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(a);
    roundRectPath(ctx, 0, -width / 2, L, width, Math.min(width / 2, 4));
    ctx.lineWidth = 2.5; ctx.strokeStyle = outline; ctx.stroke();
    const g = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
    g.addColorStop(0, shade(color, 0.25)); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  },

  /**
   * Armor plate centered at (x, y): rounded rect with bevel, panel seam, rivets and
   * a rim on the lit side (light = info.light).
   */
  plate(ctx, { x = 0, y = 0, w = 40, h = 30, r = 6, angle = 0, color = '#5d6f8c', outline = null, light = null, rivets = false, seam = true } = {}) {
    const o = outline || shade(color, -0.6);
    ctx.save();
    ctx.translate(x, y); if (angle) ctx.rotate(angle);
    roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
    ctx.lineWidth = 3; ctx.strokeStyle = o; ctx.stroke();
    const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    g.addColorStop(0, shade(color, 0.28)); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, -0.32));
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = rgba('#ffffff', 0.35); ctx.lineWidth = 2;
    roundRectPath(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, Math.max(1, r - 2)); ctx.stroke();
    if (seam) { ctx.strokeStyle = rgba(o, 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-w / 2, h * 0.12); ctx.lineTo(w / 2, h * 0.05); ctx.stroke(); }
    if (light) {
      const lx = light.dir.x, ly = light.dir.y;
      ctx.fillStyle = rgba(light.rim || '#ffd2a1', 0.3);
      ctx.beginPath(); ctx.rect(-w / 2 + lx * w * 0.5, -h / 2 + ly * h * 0.5, w, h); ctx.rect(-w / 2, -h / 2, w, h); ctx.fill('evenodd');
    }
    ctx.restore();
    if (rivets) {
      ctx.fillStyle = shade(color, -0.4);
      for (const [rx, ry] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath(); ctx.arc(rx * (w / 2 - 5), ry * (h / 2 - 5), 1.6, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  },

  /** Hydraulic piston between two points (sleeve + rod). */
  piston(ctx, p, q, { width = 5, color = '#c0c8d4', sleeve = '#4a5468', outline = '#1c2230' } = {}) {
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    mech.bone(ctx, p, { x: mx + (q.x - p.x) * 0.1, y: my + (q.y - p.y) * 0.1 }, width * 1.6, sleeve, outline);
    mech.bone(ctx, { x: mx, y: my }, q, width, color, outline);
  },

  /** Thruster flame along `angle` (rad) with power 0..1.5; colors [core, mid, outer]. */
  thruster(ctx, x, y, angle, power = 1, time = 0, colors = ['#ffffff', '#7fd3ff', '#2a6bd1']) {
    if (power <= 0) return;
    const flick = 0.85 + Math.sin(time * 40) * 0.1 + Math.sin(time * 67) * 0.05;
    const L = (10 + 26 * power) * flick, W = 6 + 3 * power;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, L * 0.35, 0, L * 0.9, colors[2], 0.35 * Math.min(1, power + 0.3));
    for (const [k, c, a] of [[1, colors[2], 0.6], [0.7, colors[1], 0.85], [0.38, colors[0], 1]]) {
      ctx.globalAlpha = a;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(0, -W * k); ctx.quadraticCurveTo(L * k * 0.6, -W * k * 0.6, L * k, 0); ctx.quadraticCurveTo(L * k * 0.6, W * k * 0.6, 0, W * k); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  },
};

export default mech;
