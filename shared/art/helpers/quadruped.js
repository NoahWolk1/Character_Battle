// ─────────────────────────────────────────────────────────────────────────────
// QUADRUPED — four-legged gait rig (wolves, horses, dragons on foot, cats, mounts).
//
//   const q = quadruped.pose(v, info, { length: 90, height: 56, gait: 'trot' });
//   quadruped.draw(ctx, q, { color: '#8a6a4a', belly: '#d8c0a0', light: info.light });
//   // or draw your own body using q.body / q.legs[i].{hip,knee,foot} / q.head / q.tail
//
// Body space, facing +x, feet on y = 0 when grounded. The gait phase comes from the
// sim view (stateFrame + speed), so it is deterministic and in sync online/offline.
// Legs use 2-bone IK (mech.ik2); hind knees bend backward like real quadrupeds.
// ─────────────────────────────────────────────────────────────────────────────
import { mech } from './mech.js';
import { shade, rgba, blobPath, TAU } from '../kit.js';

const GAITS = {
  walk: { offsets: [0, 0.5, 0.25, 0.75], lift: 0.45, rate: 1.1, bob: 0.02 },
  trot: { offsets: [0, 0.5, 0.5, 0], lift: 0.6, rate: 1.6, bob: 0.035 },
  gallop: { offsets: [0, 0.1, 0.55, 0.65], lift: 0.8, rate: 2.2, bob: 0.06 },
};

export const quadruped = {
  /**
   * Pose for a view. o: { length, height, gait: 'walk'|'trot'|'gallop'|'auto', stride, leg (bone len), speed (0..1 override) }
   * @returns {{body, head, tail, legs: [{hip, knee, foot, front}], phase, speed}}
   */
  pose(view, info = {}, o = {}) {
    const length = o.length ?? 90, height = o.height ?? 56;
    const leg = o.leg ?? height * 0.52;
    const stats = o.stats || {};
    const vx = Math.abs(view?.vx || 0), run = stats.runSpeed || 6;
    const speed = o.speed ?? Math.min(1.4, vx / run);
    const gaitName = o.gait && o.gait !== 'auto' ? o.gait : speed > 1 ? 'gallop' : speed > 0.45 ? 'trot' : 'walk';
    const g = GAITS[gaitName] || GAITS.walk;
    const grounded = view?.grounded !== false;
    const frame = view?.state === 'run' ? view.stateFrame || 0 : (info.time || 0) * 60 * 0.15;
    const phase = (frame / 60) * g.rate * (0.6 + speed);
    const stride = (o.stride ?? length * 0.32) * Math.min(1, speed + 0.05);
    const bob = grounded ? Math.abs(Math.sin(phase * TAU)) * height * g.bob : 0;
    const crouch = view?.state === 'crouch' || view?.state === 'jumpsquat' ? height * 0.18 : 0;
    const air = !grounded ? (view.vy < 0 ? -0.12 : 0.1) : 0;
    const body = { x: 0, y: -height + bob + crouch, angle: air + (o.pitch || 0), length, height };
    const ca = Math.cos(body.angle), sa = Math.sin(body.angle);
    const at = (dx, dy) => ({ x: body.x + dx * ca - dy * sa, y: body.y + dx * sa + dy * ca });
    const hips = [at(length * 0.36, height * 0.12), at(length * 0.32, height * 0.12), at(-length * 0.36, height * 0.1), at(-length * 0.4, height * 0.1)];
    const legs = hips.map((hip, i) => {
      const front = i < 2;
      const p = ((phase + g.offsets[i]) % 1 + 1) % 1;
      let fx, fy;
      if (!grounded) { fx = hip.x + (front ? 0.35 : -0.35) * leg; fy = hip.y + leg * 1.45; }
      else if (p < 0.5) { fx = hip.x + stride * (0.5 - p * 2) * 0.5; fy = 0; } // stance: foot slides back
      else { const s = (p - 0.5) * 2; fx = hip.x + stride * (s - 0.5) * 0.5; fy = -Math.sin(s * Math.PI) * leg * g.lift * Math.min(1, speed + 0.2); }
      const ik = mech.ik2(hip, { x: fx, y: fy }, leg, leg * 0.95, front ? 1 : -1);
      return { hip, knee: ik.joint, foot: ik.end, front, ik };
    });
    const head = { ...at(length * 0.58, -height * 0.32), angle: body.angle - 0.15 + Math.sin(phase * TAU) * 0.04 };
    const tail = { ...at(-length * 0.52, -height * 0.05), angle: Math.PI + 0.5 + Math.sin(phase * TAU + 1) * 0.25 - speed * 0.3 };
    return { body, head, tail, legs, phase, speed, gait: gaitName };
  },

  /** Simple shaded default look (body blob, head, ears, tail, legs far-to-near). */
  draw(ctx, q, { color = '#8a6a4a', belly = null, outline = null, eye = '#1a1010', light = null } = {}) {
    const o = outline || shade(color, -0.6);
    const far = q.legs.filter((_, i) => i % 2 === 1), near = q.legs.filter((_, i) => i % 2 === 0);
    for (const l of far) mech.limb(ctx, l.ik, { width: q.body.height * 0.16, color: shade(color, -0.22), joint: shade(color, -0.22), outline: o });
    // tail
    const t = q.tail, tl = q.body.length * 0.45;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = o; ctx.lineWidth = q.body.height * 0.16 + 3;
    ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.quadraticCurveTo(t.x + Math.cos(t.angle) * tl * 0.6, t.y + Math.sin(t.angle) * tl * 0.2, t.x + Math.cos(t.angle) * tl, t.y + Math.sin(t.angle) * tl); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = q.body.height * 0.16; ctx.stroke();
    ctx.restore();
    // body
    const { x, y, angle, length: L, height: H } = q.body;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    blobPath(ctx, [[-L * 0.5, -H * 0.12], [-L * 0.3, -H * 0.34], [L * 0.2, -H * 0.36], [L * 0.5, -H * 0.2], [L * 0.46, H * 0.18], [0, H * 0.28], [-L * 0.46, H * 0.2]], 0.5);
    ctx.lineWidth = 3; ctx.strokeStyle = o; ctx.stroke();
    const g = ctx.createLinearGradient(0, -H * 0.36, 0, H * 0.28);
    g.addColorStop(0, shade(color, 0.22)); g.addColorStop(0.55, color); g.addColorStop(1, belly || shade(color, -0.25));
    ctx.fillStyle = g; ctx.fill();
    if (light) { ctx.save(); ctx.clip(); ctx.strokeStyle = rgba(light.rim || '#ffd2a1', 0.55); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-L * 0.4, -H * 0.3); ctx.quadraticCurveTo(0, -H * 0.42, L * 0.45, -H * 0.24); ctx.stroke(); ctx.restore(); }
    ctx.restore();
    // head
    const h = q.head, hr = H * 0.28;
    ctx.save();
    ctx.translate(h.x, h.y); ctx.rotate(h.angle);
    for (const ex of [-0.25, 0.15]) { ctx.beginPath(); ctx.moveTo(hr * ex, -hr * 0.6); ctx.lineTo(hr * (ex + 0.15), -hr * 1.5); ctx.lineTo(hr * (ex + 0.45), -hr * 0.55); ctx.closePath(); ctx.fillStyle = shade(color, -0.1); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = o; ctx.stroke(); }
    blobPath(ctx, [[-hr * 0.7, -hr * 0.5], [hr * 0.4, -hr * 0.7], [hr * 1.5, -hr * 0.1], [hr * 1.5, hr * 0.35], [hr * 0.2, hr * 0.7], [-hr * 0.8, hr * 0.4]], 0.5);
    ctx.lineWidth = 3; ctx.strokeStyle = o; ctx.stroke();
    ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = eye; ctx.beginPath(); ctx.arc(hr * 0.55, -hr * 0.18, hr * 0.13, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(hr * 0.6, -hr * 0.23, hr * 0.05, 0, TAU); ctx.fill();
    ctx.fillStyle = o; ctx.beginPath(); ctx.arc(hr * 1.45, hr * 0.05, hr * 0.12, 0, TAU); ctx.fill();
    ctx.restore();
    for (const l of near) mech.limb(ctx, l.ik, { width: q.body.height * 0.17, color, joint: color, outline: o });
  },
};

export default quadruped;
