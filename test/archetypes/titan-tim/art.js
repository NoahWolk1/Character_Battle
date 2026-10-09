// Titan Tim art: a procedural lumberjack giant (plaid, overalls, beanie, big red beard).
// The art host does not scale the body canvas by bodyScale, so draw() scales itself by
// view.bodyScale; hitbox centers (already ×bodyScale) are divided back for the IK hands.
import * as kit from '../../../shared/art/kit.js';
import { mech } from '../../../shared/art/helpers/mech.js';

const C = { skin: '#f0b48a', beard: '#c2461e', plaid: '#c8282e', plaidDark: '#5a0e14', denim: '#3a5a9a', denimDark: '#1e2e5a', boot: '#5a3a1e', beanie: '#2e7a4a', outline: '#24140e', eye: '#1a0e08' };

function plaid(ctx, x, y, w, h, base) {
  ctx.fillStyle = base; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = kit.rgba(C.plaidDark, 0.55);
  for (let i = 0; i < w; i += 12) ctx.fillRect(x + i, y, 5, h);
  for (let j = 0; j < h; j += 12) ctx.fillRect(x, y + j, w, 5);
  ctx.fillStyle = kit.rgba('#000000', 0.25);
  for (let i = 0; i < w; i += 12) for (let j = 0; j < h; j += 12) ctx.fillRect(x + i, y + j, 5, 5);
}

function handTarget(v, info, rest, k, back) {
  const m = v.move;
  if (!m) return { x: rest.x, y: rest.y + Math.sin(info.time * 2) * 2 };
  if (m.phase === 'active' && info.hitboxes.length && !back) { const c = kit.shapeCenter(info.hitboxes[0]); return { x: c.x / k, y: c.y / k }; }
  if (m.anim === 'clap' && m.phase === 'active') return { x: -10, y: -140 };
  if (m.phase === 'startup' || m.phase === 'charge') return { x: rest.x - 26 * m.phaseT, y: rest.y - 20 * m.phaseT };
  return rest;
}

export default {
  rig: 'none',
  // Bounds are in body px at scale 1; the host multiplies them by bodyScale.
  bounds: { left: -110, right: 150, top: -190, bottom: 44 },
  palette: { main: C.plaid, effect: '#ffd27a', outline: C.outline },
  palettes: [{}, { main: '#2e6aa8' }, { main: '#3a8a3a' }, { main: '#6a3a8a' }],

  draw(ctx, v, info) {
    const k = v.bodyScale || 1;
    const t = info.time, P = info.palette, L = info.light;
    ctx.save();
    ctx.scale(k, k);
    const run = v.state === 'run';
    const ph = t * 10;
    const sq = info.motion.squash * 6;
    const bob = run ? Math.abs(Math.sin(ph)) * 3 : Math.sin(t * 2.2) * 1;
    const hipY = -46 + sq + bob;
    // legs (far first)
    for (const s of [1, 0]) {
      const sw = run ? Math.sin(ph + s * Math.PI) * 14 : 0;
      const lift = run ? Math.max(0, Math.cos(ph + s * Math.PI)) * 8 : 0;
      const hip = { x: s ? -10 : 10, y: hipY };
      const foot = !v.grounded ? { x: hip.x + 8, y: -14 } : { x: hip.x + sw, y: -6 - lift };
      const leg = mech.ik2(hip, foot, 21, 21, -1);
      const col = s ? C.denimDark : C.denim;
      kit.limb(ctx, leg.root, leg.joint, 10, 9, col, { outline: C.outline, lineWidth: 2.5 });
      kit.limb(ctx, leg.joint, leg.end, 9, 8, col, { outline: C.outline, lineWidth: 2.5 });
      ctx.beginPath(); ctx.ellipse(leg.end.x + 5, leg.end.y + 1, 13, 7, 0, 0, kit.TAU);
      kit.fillShaded(ctx, s ? kit.shade(C.boot, -0.25) : C.boot, { outline: C.outline, lineWidth: 2.5, x: leg.end.x, y: leg.end.y, r: 12 });
    }
    // back arm
    const sy = -86 + bob + sq;
    const bh = handTarget(v, info, { x: -26, y: -50 }, k, true);
    const barm = mech.ik2({ x: -20, y: sy }, bh, 24, 24, -1);
    kit.limb(ctx, barm.root, barm.joint, 9, 8, kit.shade(P.main, -0.35), { outline: C.outline, lineWidth: 2.5 });
    kit.limb(ctx, barm.joint, barm.end, 8, 7, kit.shade(P.main, -0.35), { outline: C.outline, lineWidth: 2.5 });
    kit.circle(ctx, barm.end.x, barm.end.y, 8, kit.shade(C.skin, -0.2), { outline: C.outline, lineWidth: 2.5 });
    // torso: plaid shirt + overall bib
    const ty = -96 + bob + sq;
    ctx.save();
    kit.roundRectPath(ctx, -28, ty, 56, 54, 14);
    ctx.lineWidth = 3.5; ctx.strokeStyle = C.outline; ctx.stroke();
    ctx.clip();
    plaid(ctx, -30, ty - 2, 60, 58, P.main);
    ctx.fillStyle = kit.linear(ctx, 0, ty + 20, 0, ty + 56, [C.denim, C.denimDark]);
    ctx.fillRect(-20, ty + 24, 40, 32);
    ctx.fillRect(-16, ty, 6, 26); ctx.fillRect(10, ty, 6, 26);
    ctx.restore();
    kit.circle(ctx, -13, ty + 26, 3, '#e8c060', { outline: C.outline, lineWidth: 1.5 });
    kit.circle(ctx, 13, ty + 26, 3, '#e8c060', { outline: C.outline, lineWidth: 1.5 });
    kit.rimLight(ctx, [[-26, ty + 46], [-27, ty + 12], [-14, ty + 1]], L.rim, 2.5, 0.55);
    // belt line / pocket
    ctx.strokeStyle = kit.rgba(C.outline, 0.6); ctx.lineWidth = 1.5; ctx.strokeRect(-8, ty + 32, 16, 10);
    // head
    const hx = 4 + info.motion.lean * 2, hy = -108 + bob + sq;
    const mad = Math.min(1, (v.percent || 0) / 120);
    kit.circle(ctx, hx, hy, 15, C.skin, { outline: C.outline, lineWidth: 3, gloss: 0.12 });
    // beard
    ctx.beginPath(); ctx.moveTo(hx - 13, hy + 1); ctx.quadraticCurveTo(hx - 16, hy + 24, hx + 4, hy + 28); ctx.quadraticCurveTo(hx + 22, hy + 22, hx + 16, hy + 1);
    ctx.quadraticCurveTo(hx + 6, hy + 9, hx - 13, hy + 1); ctx.closePath();
    kit.fillShaded(ctx, C.beard, { outline: C.outline, lineWidth: 2.5, x: hx, y: hy + 10, r: 16 });
    ctx.strokeStyle = kit.rgba('#ffb08a', 0.5); ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(hx - 8 + i * 6, hy + 6); ctx.lineTo(hx - 9 + i * 6, hy + 18); ctx.stroke(); }
    // eyes + brows (angrier with damage), nose
    const blink = (t * 0.3) % 1 > 0.965 ? 0.2 : 1;
    for (const ex of [2, 10]) { kit.ellipse(ctx, hx + ex, hy - 1, 2.6, 3 * blink, '#ffffff', { outline: C.outline, lineWidth: 1 }); kit.ellipse(ctx, hx + ex + 0.8, hy - 0.6, 1.4, 1.9 * blink, C.eye); }
    ctx.strokeStyle = C.beard; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx - 2, hy - 6 - (1 - mad) * 2); ctx.lineTo(hx + 5, hy - 5 + mad * 2); ctx.moveTo(hx + 8, hy - 5 + mad * 2); ctx.lineTo(hx + 14, hy - 6 - (1 - mad) * 2); ctx.stroke();
    kit.circle(ctx, hx + 9, hy + 4, 3.5, kit.shade(C.skin, -0.08), { outline: C.outline, lineWidth: 1.5 });
    if (v.move?.phase === 'active' || v.state === 'hitstun') { ctx.fillStyle = '#5a1a14'; ctx.beginPath(); ctx.ellipse(hx + 5, hy + 10, 4, 3, 0, 0, kit.TAU); ctx.fill(); }
    // beanie
    ctx.beginPath(); ctx.moveTo(hx - 15, hy - 8); ctx.quadraticCurveTo(hx - 12, hy - 30, hx + 4, hy - 30); ctx.quadraticCurveTo(hx + 18, hy - 28, hx + 15, hy - 8); ctx.closePath();
    kit.fillShaded(ctx, C.beanie, { outline: C.outline, lineWidth: 2.5, x: hx, y: hy - 18, r: 14 });
    kit.roundRectPath(ctx, hx - 16, hy - 12, 32, 7, 3); kit.fillShaded(ctx, kit.shade(C.beanie, -0.2), { outline: C.outline, lineWidth: 2, x: hx, y: hy - 9, r: 14 });
    kit.circle(ctx, hx + 2, hy - 32, 4, '#e8e0d0', { outline: C.outline, lineWidth: 1.5 });
    // front arm
    const fh = handTarget(v, info, { x: 30, y: -50 }, k, false);
    const farm = mech.ik2({ x: 20, y: sy }, fh, 24, 24, -1);
    kit.limb(ctx, farm.root, farm.joint, 10, 9, P.main, { outline: C.outline, lineWidth: 2.5 });
    kit.limb(ctx, farm.joint, farm.end, 9, 8, P.main, { outline: C.outline, lineWidth: 2.5 });
    kit.circle(ctx, farm.end.x, farm.end.y, 9, C.skin, { outline: C.outline, lineWidth: 2.5, gloss: 0.15 });
    // the held boulder before the toss
    if (v.move?.anim === 'toss' && v.move.phase === 'startup') kit.circle(ctx, farm.end.x, farm.end.y - 10, 13, '#8a8478', { outline: C.outline, lineWidth: 2.5, gloss: 0.2 });
    ctx.restore();
    if (v.move?.phase === 'active') for (const hb of info.hitboxes) kit.shapeGlow(ctx, hb, P.effect, 0.14);
    // growth sparkle while the body scale is climbing
    const c = info.cache;
    if (c.lastScale !== undefined && k > c.lastScale + 0.001) info.fx.local.spark?.({ x: 0, y: -60 * k, rate: 0.6, color: '#ffe7a0' });
    c.lastScale = k;
  },

  trail(v, info) { return info.phase.name === 'active' && info.hitboxes[0] ? kit.shapeCenter(info.hitboxes[0]) : false; },

  entities: {
    boulder: {
      draw(ctx, e) {
        ctx.rotate(e.age * 0.15);
        kit.blobPath(ctx, [[-14, -4], [-8, -13], [6, -14], [14, -4], [12, 9], [-2, 14], [-13, 8]], 0.4);
        kit.fillShaded(ctx, '#8a8478', { outline: C.outline, lineWidth: 2.5, x: 0, y: 0, r: 14, gloss: 0.15 });
        ctx.strokeStyle = kit.rgba(C.outline, 0.5); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(2, 0); ctx.lineTo(-2, 6); ctx.stroke();
      },
    },
  },

  fx: {
    onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 8, shape: 'spark', colors: ['#ffffff', '#ffd27a'], speed: [2, 7], life: [10, 18] }); },
    onEvent: {
      grow(fx, ev) { fx.text({ x: ev.x, y: ev.y - 180, text: 'TIM GROWS!', color: '#ffd27a', life: 60, size: 18 }); fx.ring({ x: ev.x, y: ev.y - 60, r0: 20, r1: 140, color: '#ffd27a', life: 20 }); fx.sound('roar', { pitch: 0.7 }); },
      quake(fx, ev) { fx.ring({ x: ev.x, y: ev.y, r0: 10, r1: 130, color: '#d8c8a8', life: 14, flat: true }); fx.burst({ x: ev.x, y: ev.y, count: 10, shape: 'debris', color: '#8a7a5a', speed: [3, 6], gravity: 0.4, life: [18, 30] }); },
      flex(fx, ev) { fx.text({ x: ev.x, y: ev.y - 150, text: 'TIMBER!', color: '#ffffff', life: 50, size: 16 }); },
    },
  },
  portrait(ctx, size, info) { info.drawIdle(ctx, { focus: { x: 4, y: -100 }, zoom: size / 70 }); },
};
