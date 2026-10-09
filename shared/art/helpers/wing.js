// ─────────────────────────────────────────────────────────────────────────────
// WING — membrane (bat/dragon) or feathered wings with a flap cycle.
//
//   const a = wing.flap(info.time, { rate: v.state === 'glide' ? 0.5 : 2.2, amp: 0.9 });
//   wing.draw(ctx, { x: -6, y: -60, span: 70, angle: a, fold: v.grounded ? 0.6 : 0,
//                    style: 'membrane', color: '#7a2f3f', bone: '#3a1420', light: info.light });
//
// Local space: root at (x, y), the wing extends backward (−x) and up at angle 0;
// `angle` raises (−) or lowers (+) the whole wing, `fold` 0..1 tucks it in.
// Draw the far wing first with { back: true } (darker, slightly smaller).
// ─────────────────────────────────────────────────────────────────────────────
import { shade, rgba, lerp, TAU } from '../kit.js';

export const wing = {
  /** Flap angle (radians) for a time in seconds: fast downstroke, slow recovery. */
  flap(time, { rate = 2, amp = 0.8, phase = 0 } = {}) {
    const p = ((time * rate + phase) % 1 + 1) % 1;
    const k = p < 0.4 ? Math.sin((p / 0.4) * Math.PI / 2) : Math.cos(((p - 0.4) / 0.6) * Math.PI / 2);
    return (k - 0.5) * 2 * amp;
  },

  /** Joint points of a wing (shoulder, wrist, finger tips) in body space. */
  joints({ x = 0, y = 0, span = 60, angle = 0, fold = 0, fingers = 4 } = {}) {
    const f = Math.max(0, Math.min(1, fold));
    const a0 = -2.4 + angle * 0.9 + f * 0.9;          // upper arm: back and up
    const upper = span * 0.38 * (1 - f * 0.35);
    const wrist = { x: x + Math.cos(a0) * upper, y: y + Math.sin(a0) * upper };
    const tips = [];
    for (let i = 0; i < fingers; i++) {
      const t = fingers > 1 ? i / (fingers - 1) : 0;
      const a = a0 + lerp(-0.25, 1.35, t) * (1 - f * 0.65) + angle * 0.35;
      const L = span * lerp(0.7, 0.42, t) * (1 - f * 0.55);
      tips.push({ x: wrist.x + Math.cos(a) * L, y: wrist.y + Math.sin(a) * L });
    }
    return { root: { x, y }, wrist, tips };
  },

  /**
   * Draws one wing. style: 'membrane' | 'feather'. back: draws as the far wing.
   * Returns the joints (for effects).
   */
  draw(ctx, o = {}) {
    const { style = 'membrane', color = '#6a2f4a', bone = null, outline = null, back = false, light = null, alpha = 1, time = 0 } = o;
    const j = wing.joints(back ? { ...o, span: (o.span || 60) * 0.88 } : o);
    const base = back ? shade(color, -0.25) : color;
    const out = outline || shade(base, -0.6);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (style === 'feather') {
      const n = 9;
      for (let i = n - 1; i >= 0; i--) {
        const t = i / (n - 1);
        const k = Math.min(j.tips.length - 1, Math.floor(t * (j.tips.length - 1) + 0.5));
        const tip = j.tips[k];
        const sx = lerp(j.wrist.x, j.root.x, t * 0.8), sy = lerp(j.wrist.y, j.root.y, t * 0.8);
        const ex = lerp(tip.x, sx, 0.08), ey = lerp(tip.y, sy, 0.08) + Math.sin(time * 6 + i) * 0.6;
        const a = Math.atan2(ey - sy, ex - sx), L = Math.hypot(ex - sx, ey - sy), w = 4 + (1 - t) * 3;
        ctx.save();
        ctx.translate(sx, sy); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(L / 2, 0, L / 2, w, 0, 0, TAU);
        ctx.lineWidth = 2; ctx.strokeStyle = out; ctx.stroke();
        ctx.fillStyle = i % 2 ? base : shade(base, 0.12); ctx.fill();
        ctx.restore();
      }
      // coverts over the arm
      ctx.beginPath(); ctx.moveTo(j.root.x, j.root.y); ctx.quadraticCurveTo((j.root.x + j.wrist.x) / 2, Math.min(j.root.y, j.wrist.y) - 8, j.wrist.x, j.wrist.y);
      ctx.lineWidth = 9; ctx.strokeStyle = out; ctx.stroke();
      ctx.lineWidth = 6; ctx.strokeStyle = shade(base, 0.18); ctx.stroke();
    } else {
      // membrane between root, wrist, finger tips and back to the body
      ctx.beginPath();
      ctx.moveTo(j.root.x, j.root.y);
      ctx.lineTo(j.wrist.x, j.wrist.y);
      for (let i = 0; i < j.tips.length; i++) {
        const tip = j.tips[i];
        ctx.lineTo(tip.x, tip.y);
        const next = j.tips[i + 1] || { x: j.root.x + (j.root.x - j.wrist.x) * 0.1, y: j.root.y + 18 };
        const mx = (tip.x + next.x) / 2, my = (tip.y + next.y) / 2;
        // scalloped edge sags toward the wrist
        ctx.quadraticCurveTo(lerp(mx, j.wrist.x, 0.28), lerp(my, j.wrist.y, 0.28), next.x, next.y);
      }
      ctx.closePath();
      ctx.lineWidth = 3; ctx.strokeStyle = out; ctx.stroke();
      const g = ctx.createLinearGradient(j.root.x, j.root.y, j.tips[0].x, j.tips[0].y);
      g.addColorStop(0, shade(base, -0.15)); g.addColorStop(0.6, base); g.addColorStop(1, shade(base, 0.2));
      ctx.fillStyle = g; ctx.fill();
      if (light && !back) {
        ctx.save(); ctx.clip();
        ctx.fillStyle = rgba(light.rim || '#ffd2a1', 0.25);
        ctx.beginPath(); ctx.moveTo(j.root.x, j.root.y); ctx.lineTo(j.wrist.x, j.wrist.y); ctx.lineTo(j.tips[0].x, j.tips[0].y); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // bones
      const b = bone || shade(base, -0.45);
      ctx.strokeStyle = b; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(j.root.x, j.root.y); ctx.lineTo(j.wrist.x, j.wrist.y); ctx.stroke();
      ctx.lineWidth = 2;
      for (const tip of j.tips) { ctx.beginPath(); ctx.moveTo(j.wrist.x, j.wrist.y); ctx.lineTo(tip.x, tip.y); ctx.stroke(); }
      ctx.fillStyle = b;
      ctx.beginPath(); ctx.arc(j.wrist.x, j.wrist.y, 3, 0, TAU); ctx.fill();
      // thumb claw
      ctx.beginPath(); ctx.moveTo(j.wrist.x, j.wrist.y - 2); ctx.lineTo(j.wrist.x + 3, j.wrist.y - 8); ctx.lineTo(j.wrist.x + 4, j.wrist.y - 1); ctx.closePath();
      ctx.fillStyle = shade(b, 0.4); ctx.fill();
    }
    ctx.restore();
    return j;
  },
};

export default wing;
