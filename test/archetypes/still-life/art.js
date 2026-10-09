// Still Life art: a gilded frame (procedural) around an oil painting that is an image
// asset (painting.svg, used as the body texture; procedural fallback when it fails to
// load). The apple in the painting is alive (eyes), a brush pops out of the frame for
// brush moves, and drawWorld paints the reflect "frame decal" in world space.
import * as kit from '../../../shared/art/kit.js';

const C = { gold: '#b8862a', goldDark: '#5a3a0a', goldLight: '#f0d890', outline: '#3a2408', paint: '#5aa0ff', canvas: '#2e2016', handle: '#7a4a2a' };
const FW = 84, FH = 108, BORDER = 10;

function framePath(ctx, w, h) { kit.roundRectPath(ctx, -w / 2, -h, w, h, 6); }

function fallbackPainting(ctx, x, y, w, h) {
  ctx.fillStyle = kit.linear(ctx, x, y, x, y + h, ['#5a3f2a', '#2e2016']); ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#c8c0aa'; ctx.fillRect(x, y + h * 0.7, w, h * 0.3);
  kit.circle(ctx, x + w * 0.46, y + h * 0.5, w * 0.13, '#e0302a', { outline: '#3a0808', lineWidth: 1.5 });
  kit.ellipse(ctx, x + w * 0.66, y + h * 0.48, w * 0.1, h * 0.12, '#9cc23a', { outline: '#2a3a0e', lineWidth: 1.5 });
  ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + h * 0.58); ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.84, x + w * 0.8, y + h * 0.58); ctx.closePath();
  ctx.fillStyle = '#2f5fae'; ctx.fill();
}

/** Pose of the frame for the current move: rotation about the bottom-center, lift and forward shift. */
function framePose(v, info) {
  const m = v.move, t = info.time;
  let rot = info.motion.lean * 0.06, lift = 0, dx = 0, pivot = 0;
  if (v.state === 'run') { lift = -Math.abs(Math.sin(t * 12)) * 5; rot += Math.sin(t * 12) * 0.04; }
  if (v.state === 'idle') lift = -Math.max(0, Math.sin(t * 2.4)) * 2;
  if (!m) return { rot, lift, dx, pivot };
  const p = m.phase === 'startup' || m.phase === 'charge' ? -m.phaseT : m.phase === 'active' ? 1 : 1 - m.phaseT;
  switch (m.anim) {
    case 'reframe': rot += 0.35 * p; dx = 14 * Math.max(0, p); break;
    case 'pinwheel': rot += (m.phase === 'active' ? m.phaseT : 0) * Math.PI * 2; pivot = -54; break;
    case 'flip': rot -= 0.4 * p; lift = -10 * Math.max(0, p); break;
    case 'fresco': case 'corner': rot += 0.25 * p; dx = 10 * Math.max(0, p); break;
    case 'backing': rot -= 0.35 * p; break;
    case 'easel': lift = -30 * Math.max(0, p); break;
    case 'gilded': rot += 0.05; break;
    case 'kite': rot = -0.35; break;
    default: break;
  }
  return { rot, lift, dx, pivot };
}

function drawBrush(ctx, from, to, info) {
  const a = Math.atan2(to.y - from.y, to.x - from.x), L = Math.hypot(to.x - from.x, to.y - from.y);
  ctx.save(); ctx.translate(from.x, from.y); ctx.rotate(a);
  kit.capsulePath(ctx, 0, 0, L - 18, 0, 3.5, 2.5);
  kit.fillShaded(ctx, C.handle, { outline: C.outline, lineWidth: 2, x: L / 2, y: 0, r: L / 2 });
  ctx.fillStyle = '#c0c8d0'; ctx.fillRect(L - 22, -4, 8, 8); ctx.strokeStyle = C.outline; ctx.lineWidth = 1.5; ctx.strokeRect(L - 22, -4, 8, 8);
  ctx.beginPath(); ctx.moveTo(L - 14, -5); ctx.quadraticCurveTo(L + 4, -6, L + 10, 0); ctx.quadraticCurveTo(L + 4, 6, L - 14, 5); ctx.closePath();
  kit.fillShaded(ctx, info.palette.effect, { outline: C.outline, lineWidth: 1.5, x: L, y: 0, r: 10, gloss: 0.4 });
  ctx.restore();
}

export default {
  rig: 'none',
  assets: { painting: './painting.svg' },
  bounds: { left: -120, right: 160, top: -210, bottom: 24 },
  palette: { main: C.gold, effect: C.paint, outline: C.outline },
  palettes: [{}, { main: '#c0c8d8', effect: '#ff5a8a' }, { main: '#a86a3a', effect: '#7dff9a' }, { main: '#2a2a2a', effect: '#ffd23a' }],

  draw(ctx, v, info) {
    const P = info.palette, L = info.light, t = info.time;
    const pose = framePose(v, info);
    const sq = info.motion.squash;
    // little gilded claw feet (stay on the floor while the frame hops)
    for (const sx of [-1, 1]) {
      const step = v.state === 'run' ? Math.sin(t * 12 + (sx > 0 ? Math.PI : 0)) * 6 : 0;
      ctx.beginPath(); ctx.ellipse(sx * 26 + step, -5, 9, 5, 0, 0, kit.TAU);
      kit.fillShaded(ctx, P.main, { outline: C.outline, lineWidth: 2, x: sx * 26, y: -5, r: 9 });
    }
    ctx.save();
    ctx.translate(pose.dx, pose.lift - 6 + pose.pivot);
    ctx.rotate(pose.rot);
    ctx.translate(0, -pose.pivot);
    ctx.scale(1 + sq * 0.1, 1 - sq * 0.12);
    // frame
    framePath(ctx, FW, FH);
    ctx.lineWidth = 3.5; ctx.strokeStyle = C.outline; ctx.stroke();
    ctx.fillStyle = kit.linear(ctx, -FW / 2, -FH, FW / 2, 0, [C.goldLight, P.main, C.goldDark, P.main]); ctx.fill();
    // canvas: the painting asset (2× source) or a procedural fallback
    const ix = -FW / 2 + BORDER, iy = -FH + BORDER, iw = FW - BORDER * 2, ih = FH - BORDER * 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
    const img = info.assets.painting;
    if (img) ctx.drawImage(img, ix, iy, iw, ih); else fallbackPainting(ctx, ix, iy, iw, ih);
    // paint level: the colors drain toward grey sketch
    const paint = (v.resources.paint ?? 100) / (v.resMax.paint || 100);
    if (paint < 1) { ctx.fillStyle = kit.rgba('#8a8478', (1 - paint) * 0.55); ctx.fillRect(ix, iy, iw, ih); }
    // the apple is alive
    const ax = ix + iw * (88 / 192), ay = iy + ih * (128 / 256);
    const blink = (t * 0.35) % 1 > 0.96 ? 0.15 : 1;
    const look = v.move ? 1.4 : Math.sin(t * 0.8) * 0.8;
    for (const ex of [-4.5, 4.5]) {
      kit.ellipse(ctx, ax + ex, ay - 1, 3.2, 4 * blink, '#ffffff', { outline: '#3a0808', lineWidth: 1.2 });
      if (blink > 0.5) kit.ellipse(ctx, ax + ex + look, ay - 0.5, 1.5, 2, '#1a0808');
    }
    if (v.move?.phase === 'active' || v.state === 'hitstun') { ctx.fillStyle = '#3a0808'; ctx.beginPath(); ctx.ellipse(ax, ay + 7, 3, v.state === 'hitstun' ? 3 : 1.6, 0, 0, kit.TAU); ctx.fill(); }
    // varnish sheen
    ctx.fillStyle = kit.linear(ctx, ix, iy, ix + iw, iy + ih, [kit.rgba('#ffffff', 0.16), kit.rgba('#ffffff', 0), kit.rgba('#ffffff', 0.06)]);
    ctx.fillRect(ix, iy, iw, ih);
    ctx.restore();
    // frame bevel, rosettes, crest
    ctx.strokeStyle = kit.rgba(C.goldDark, 0.9); ctx.lineWidth = 2; ctx.strokeRect(ix - 1, iy - 1, iw + 2, ih + 2);
    ctx.strokeStyle = kit.rgba(C.goldLight, 0.8); ctx.lineWidth = 1.2; ctx.strokeRect(-FW / 2 + 3, -FH + 3, FW - 6, FH - 6);
    for (const [cx, cy] of [[-FW / 2 + 5, -FH + 5], [FW / 2 - 5, -FH + 5], [-FW / 2 + 5, -5], [FW / 2 - 5, -5]]) kit.circle(ctx, cx, cy, 4.5, P.main, { outline: C.outline, lineWidth: 1.5, gloss: 0.5 });
    ctx.beginPath(); ctx.moveTo(-16, -FH); ctx.quadraticCurveTo(-8, -FH - 14, 0, -FH - 16); ctx.quadraticCurveTo(8, -FH - 14, 16, -FH); ctx.closePath();
    kit.fillShaded(ctx, P.main, { outline: C.outline, lineWidth: 2, x: 0, y: -FH - 8, r: 14, gloss: 0.3 });
    kit.rimLight(ctx, [[-FW / 2 + 2, -8], [-FW / 2 + 2, -FH + 4], [FW / 2 - 6, -FH + 2]], L.rim, 2, 0.6);
    ctx.restore();
    // brush for brush moves: from the frame edge into the hitbox
    const m = v.move;
    if (m && ['brush', 'master', 'drip', 'stroke', 'splatter', 'palette'].includes(m.anim)) {
      const from = { x: 30, y: -60 };
      const hb = info.hitboxes[0];
      let to = hb && m.phase === 'active' ? kit.shapeCenter(hb) : { x: 60, y: -96 };
      if (m.phase === 'startup' || m.phase === 'charge') to = { x: 40 - 30 * m.phaseT, y: -100 - 10 * m.phaseT };
      if (m.anim === 'stroke' || m.anim === 'drip') to = m.phase === 'active' || m.phase === 'recovery' ? { x: 70, y: -6 } : { x: 54, y: -50 };
      if (m.anim === 'master' && hb && m.phase === 'active') { const c = kit.shapeCenter(hb); kit.smear(ctx, c.x - 50, c.y + 20, 70, -1.2, 0.3, 14, P.effect, 0.6); }
      drawBrush(ctx, from, to, info);
    }
    if (m?.phase === 'active') for (const hb of info.hitboxes) if (hb.kind !== 'reflect') kit.shapeGlow(ctx, hb, P.effect, 0.15);
    if (v.statuses.some((s) => s.name === 'wet')) info.tint(C.paint, 0.12);
  },

  // World-space frame decal for the reflect: a big golden frame hangs in the air where it reflects.
  drawWorld(ctx, v, info) {
    const m = v.move;
    if (!m || m.anim !== 'reframe' || m.phase === 'recovery') return;
    const k = m.phase === 'active' ? 1 : m.phaseT;
    const f = v.facing < 0 ? -1 : 1, x = 50 * f, y = -56;
    ctx.save();
    ctx.globalAlpha *= 0.85 * k;
    ctx.strokeStyle = C.outline; ctx.lineWidth = 7; ctx.strokeRect(x - 22, y - 58, 44, 116);
    ctx.strokeStyle = info.palette.main; ctx.lineWidth = 5; ctx.strokeRect(x - 22, y - 58, 44, 116);
    ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, x, y, 70, '#ffe7a0', 0.35 * k);
    const sh = ((info.time * 2) % 1) * 140 - 70;
    ctx.strokeStyle = kit.rgba('#ffffff', 0.7); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 20, y + sh); ctx.lineTo(x + 20, y + sh - 24); ctx.stroke();
    ctx.restore();
  },

  trail(v, info) { return info.phase.name === 'active' && info.hitboxes[0] && info.hitboxes[0].kind !== 'reflect' ? kit.shapeCenter(info.hitboxes[0]) : false; },

  entities: {
    splat: {
      draw(ctx, e, info) {
        const a = e.age * 0.3;
        ctx.save(); ctx.rotate(a);
        kit.blobPath(ctx, [[-10, -3], [-4, -10], [6, -9], [11, -1], [7, 8], [-3, 10], [-10, 5]], 0.6);
        kit.fillShaded(ctx, info.palette.effect, { outline: kit.shade(info.palette.effect, -0.6), lineWidth: 2, x: 0, y: 0, r: 11, gloss: 0.5 });
        ctx.restore();
        for (let i = 1; i <= 3; i++) kit.circle(ctx, -e.vx * i * 1.4, -e.vy * i * 1.4, 4 - i, info.palette.effect, { outline: null, lineWidth: 0 });
      },
    },
    paintTrap: {
      draw(ctx, e, info) {
        ctx.save(); ctx.globalAlpha *= Math.min(1, e.lifeT * 4);
        kit.goo(ctx, 76, 10, info.palette.effect, info.time + e.seed, 1);
        ctx.strokeStyle = kit.rgba('#ffffff', 0.55); ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-24, -6); ctx.quadraticCurveTo(0, -10, 22, -6); ctx.stroke();
        ctx.restore();
      },
    },
  },

  fx: {
    onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 9, shape: 'drip', colors: ['#5aa0ff', '#ff5a8a', '#ffd23a'], speed: [2, 6], gravity: 0.3, life: [18, 30] }); },
    onEvent: {
      splatter(fx, ev) { fx.sound('splash'); },
      stroke(fx, ev) { fx.decal({ x: ev.x, y: ev.y, shape: 'splat', r: 34, color: '#5aa0ff' }); fx.sound('splash', { pitch: 1.3 }); },
      reframe(fx, ev) { fx.sound('chime'); },
      dry(fx, ev) { fx.text({ x: ev.x, y: ev.y - 120, text: 'out of paint…', color: '#c8c0aa', life: 40, size: 12 }); },
      pose(fx, ev) { fx.text({ x: ev.x, y: ev.y - 130, text: '✦ a masterpiece ✦', color: '#ffe7a0', life: 60, size: 14 }); },
    },
  },
  sounds: { reflect: 'chime' },
};
