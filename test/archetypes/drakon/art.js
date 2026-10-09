// Drakon art: quadruped gait rig (shared/art/helpers/quadruped.js) under a custom
// scaled body, a serpent-chain tail, membrane wings (wing.js) that fold on the ground
// and spread to glide, and a head that lunges into the bite / gore hitboxes.
import * as kit from '../../../shared/art/kit.js';
import { quadruped } from '../../../shared/art/helpers/quadruped.js';
import { serpent } from '../../../shared/art/helpers/serpent.js';
import { wing } from '../../../shared/art/helpers/wing.js';
import { mech } from '../../../shared/art/helpers/mech.js';

const C = { hide: '#a8262e', hideDark: '#5a1018', belly: '#e8b75a', horn: '#3a2a26', claw: '#f3ead8', outline: '#2a0a10', eye: '#ffde4a', membrane: '#c2453c', fire: '#ff7a1a' };

function wingPose(v, info) {
  const glide = v.state === 'glide' || v.move?.anim === 'skyward';
  const air = !v.grounded;
  const burst = v.move?.anim === 'burst' || v.move?.anim === 'flick';
  if (burst && v.move.phase === 'active') return { angle: 0.85, fold: 0 };
  if (glide) return { angle: wing.flap(info.time, { rate: 0.6, amp: 0.25 }) - 0.2, fold: 0 };
  if (air) return { angle: wing.flap(info.time, { rate: v.vy < 0 ? 2.4 : 1.4, amp: 0.8 }), fold: 0.1 };
  return { angle: 0.9 + Math.sin(info.time * 1.5) * 0.04, fold: 0.88 };
}

function headTarget(v, info, base) {
  const m = v.move;
  if (m && (m.anim === 'bite' || m.anim === 'gore' || m.anim === 'crest')) {
    if (m.phase === 'active' && info.hitboxes[0]) { const c = kit.shapeCenter(info.hitboxes[0]); return { x: c.x - 26, y: c.y + 6, jaw: 0.55 }; }
    if (m.phase === 'startup' || m.phase === 'charge') return { x: base.x - 26 * m.phaseT, y: base.y - 10 * m.phaseT, jaw: 0.2 };
  }
  if (m && (m.anim === 'breath' || m.anim === 'roar' || m.anim === 'spit')) return { x: base.x + 8, y: base.y + 2, jaw: m.phase === 'startup' ? 0.25 + 0.2 * m.phaseT : 0.6 };
  return { x: base.x + info.motion.lean * 4, y: base.y + Math.sin(info.time * 2) * 3, jaw: 0.04 };
}

/** A thick dragon leg: muscled thigh, scaled shin, three claws. */
function leg(ctx, l, color) {
  const { root, joint, end } = l.ik;
  ctx.beginPath(); ctx.ellipse(root.x, root.y + 4, l.front ? 15 : 19, l.front ? 20 : 24, l.front ? 0.2 : -0.3, 0, kit.TAU);
  kit.fillShaded(ctx, color, { outline: C.outline, lineWidth: 3, x: root.x, y: root.y, r: 20 });
  kit.limb(ctx, root, joint, 12, 10, color, { outline: C.outline, lineWidth: 3 });
  kit.limb(ctx, joint, end, 10, 8, kit.shade(color, -0.08), { outline: C.outline, lineWidth: 3 });
  ctx.fillStyle = C.claw; ctx.strokeStyle = C.outline; ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(end.x + 1 + i * 6, end.y - 3); ctx.lineTo(end.x + 10 + i * 6, end.y + 4); ctx.lineTo(end.x + i * 6, end.y + 4); ctx.closePath(); ctx.fill(); ctx.stroke(); }
}

function drawHead(ctx, h, jaw, info, v) {
  const t = info.time;
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.scale(1.35, 1.35);
  ctx.rotate(-0.08 + jaw * 0.3);
  // horns (back)
  for (const [x, y, s] of [[-14, -14, 1], [-6, -16, 0.8]]) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - 26 * s, y - 14 * s, x - 40 * s, y - 2 * s); ctx.quadraticCurveTo(x - 22 * s, y - 2 * s, x + 6, y + 6);
    kit.fillShaded(ctx, C.horn, { outline: C.outline, lineWidth: 2.5, x: x - 18, y, r: 20 });
  }
  // lower jaw (opens)
  ctx.save(); ctx.translate(-4, 4); ctx.rotate(jaw * 0.9);
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.quadraticCurveTo(20, 6, 40, 4); ctx.lineTo(40, 10); ctx.quadraticCurveTo(14, 18, -8, 10); ctx.closePath();
  kit.fillShaded(ctx, kit.shade(C.hide, -0.12), { outline: C.outline, lineWidth: 2.5, x: 16, y: 8, r: 20 });
  ctx.fillStyle = C.claw; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(10 + i * 8, 3); ctx.lineTo(13 + i * 8, -3); ctx.lineTo(16 + i * 8, 3); ctx.fill(); }
  ctx.restore();
  // mouth glow while the jaw is open
  if (jaw > 0.2) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, 24, 6, 26, C.fire, 0.55 * jaw); ctx.restore(); }
  // skull + snout
  ctx.beginPath(); ctx.moveTo(-18, -10); ctx.quadraticCurveTo(0, -20, 22, -12); ctx.quadraticCurveTo(42, -8, 46, 0); ctx.quadraticCurveTo(42, 6, 30, 6); ctx.lineTo(-4, 8); ctx.quadraticCurveTo(-20, 6, -18, -10); ctx.closePath();
  kit.fillShaded(ctx, C.hide, { outline: C.outline, lineWidth: 3, x: 8, y: -6, r: 26, gloss: 0.12 });
  kit.rimLight(ctx, [[-14, -12], [4, -18], [24, -13], [42, -6]], info.light.rim, 2, 0.6);
  // brow ridge, eye, nostril
  ctx.fillStyle = kit.shade(C.hide, -0.35); ctx.beginPath(); ctx.moveTo(-2, -12); ctx.quadraticCurveTo(8, -18, 16, -11); ctx.lineTo(14, -9); ctx.quadraticCurveTo(6, -13, -2, -9); ctx.fill();
  const blink = (t * 0.4) % 1 > 0.97 ? 0.2 : 1;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, 8, -8, 9, C.eye, 0.5); ctx.restore();
  kit.ellipse(ctx, 8, -8, 4.2, 3 * blink, C.eye, { outline: C.outline, lineWidth: 1.5 });
  kit.ellipse(ctx, 9, -8, 1.2, 2.6 * blink, '#2a0a00');
  kit.ellipse(ctx, 40, -3, 2.2, 1.4, C.outline);
  if (v.state === 'idle' && (t % 3) < 0.6) info.fx.local.smoke({ x: h.x + 44, y: h.y - 6, rate: 0.2, color: '#6a5a5a', size: [2, 5] });
  ctx.restore();
}

export default {
  rig: 'none',
  bounds: { left: -450, right: 450, top: -480, bottom: 100 }, // the 4× collider limit (vertical) and 900 px total
  palette: { main: C.hide, effect: C.fire, outline: C.outline },
  palettes: [{}, { main: '#2f6f4a', effect: '#7dff9a' }, { main: '#3a4a8a', effect: '#7fd3ff' }, { main: '#4a3a3a', effect: '#ffb03a' }],

  init(cache) { cache.tail = serpent.create({ segments: 14, length: 100, dir: { x: -1, y: 0.15 } }); },

  draw(ctx, v, info) {
    const P = info.palette, L = info.light;
    const q = quadruped.pose(v, info, { length: 150, height: 70, gait: 'auto', stats: { runSpeed: 6.2 }, leg: 30 });
    const hide = P.main;
    // reaching claws/talons: put the near front / hind foot into the active hitbox
    const m = v.move;
    if (m && m.phase === 'active' && info.hitboxes[0] && ['claw', 'rake', 'talon'].includes(m.anim)) {
      const c = kit.shapeCenter(info.hitboxes[0]);
      const l = q.legs[m.anim === 'talon' ? 2 : 0];
      l.ik = mech.ik2(l.hip, c, 30, 29, l.front ? 1 : -1);
    }
    const wp = wingPose(v, info);
    // far wing
    wing.draw(ctx, { x: 14, y: q.body.y - 30, span: 150, angle: wp.angle, fold: wp.fold, style: 'membrane', color: kit.shade(hide, -0.1), bone: C.hideDark, back: true, time: info.time });
    // tail (serpent chain dragged behind the hips; whips forward on bair)
    const whip = m?.anim === 'whip' && m.phase === 'active';
    const tailRoot = { x: -70, y: q.body.y + 18 };
    const tail = info.cache.tail;
    serpent.step(tail, { head: whip ? { x: tailRoot.x - 10, y: tailRoot.y - 20 } : tailRoot, dt: info.dt, slither: v.state === 'run' ? 6 : 3, time: info.time, gravity: 0.35, stiffness: whip ? 0.4 : 0.12 });
    serpent.draw(ctx, tail, { width: [30, 5], color: hide, belly: C.belly, outline: C.outline, light: L });
    const tp = serpent.points(tail);
    const tip = tp[tp.length - 1], pre = tp[tp.length - 2];
    ctx.save(); ctx.translate(tip.x, tip.y); ctx.rotate(Math.atan2(tip.y - pre.y, tip.x - pre.x));
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(10, -10); ctx.lineTo(20, 0); ctx.lineTo(10, 10); ctx.closePath();
    kit.fillShaded(ctx, C.horn, { outline: C.outline, lineWidth: 2, x: 8, y: 0, r: 10 });
    ctx.restore();
    // far legs
    for (const l of q.legs.filter((_, i) => i % 2 === 1)) leg(ctx, l, kit.shade(hide, -0.3));
    // body
    const { x, y, angle } = q.body;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    kit.blobPath(ctx, [[-80, -6], [-52, -38], [10, -44], [60, -34], [84, -6], [60, 30], [0, 38], [-62, 26]], 0.5);
    ctx.lineWidth = 3.5; ctx.strokeStyle = C.outline; ctx.stroke();
    ctx.fillStyle = kit.linear(ctx, 0, -44, 0, 38, [kit.shade(hide, 0.22), hide, kit.shade(hide, -0.25)]); ctx.fill();
    ctx.save(); ctx.clip();
    // belly plates
    ctx.fillStyle = C.belly; ctx.beginPath(); ctx.ellipse(10, 34, 72, 18, 0, 0, kit.TAU); ctx.fill();
    ctx.strokeStyle = kit.shade(C.belly, -0.35); ctx.lineWidth = 1.5;
    for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(10 + i * 15, 18); ctx.lineTo(8 + i * 15, 40); ctx.stroke(); }
    // scale arcs
    ctx.strokeStyle = kit.rgba(C.hideDark, 0.45); ctx.lineWidth = 1.4;
    for (let r = 0; r < 3; r++) for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(-64 + i * 17 + (r % 2) * 8, -26 + r * 14, 7, 0.2, Math.PI - 0.2); ctx.stroke(); }
    ctx.restore();
    kit.rimLight(ctx, [[-70, -22], [-40, -40], [10, -46], [56, -36]], L.rim, 3, 0.55);
    // spine ridge
    ctx.fillStyle = C.horn;
    for (let i = 0; i < 6; i++) { const sx = -56 + i * 20; ctx.beginPath(); ctx.moveTo(sx - 7, -38 + Math.abs(i - 2.5) * 1.5); ctx.lineTo(sx, -54 + Math.abs(i - 2.5) * 2); ctx.lineTo(sx + 7, -40 + Math.abs(i - 2.5) * 1.5); ctx.closePath(); ctx.fill(); ctx.strokeStyle = C.outline; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.restore();
    // neck + head
    const base = { x: 100, y: y - 40 };
    const ht = headTarget(v, info, base);
    const neckRoot = { x: 52, y: y - 10 };
    ctx.save();
    ctx.lineCap = 'round';
    for (const [w, c] of [[38, C.outline], [32, hide]]) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(neckRoot.x, neckRoot.y); ctx.quadraticCurveTo(neckRoot.x + 18, ht.y + 10, ht.x - 10, ht.y + 4); ctx.stroke(); }
    ctx.strokeStyle = C.belly; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(neckRoot.x + 10, neckRoot.y + 12); ctx.quadraticCurveTo(neckRoot.x + 26, ht.y + 20, ht.x - 4, ht.y + 12); ctx.stroke();
    ctx.restore();
    drawHead(ctx, ht, ht.jaw, info, v);
    // near legs
    for (const l of q.legs.filter((_, i) => i % 2 === 0)) leg(ctx, l, hide);
    // near wing
    wing.draw(ctx, { x: -6, y: q.body.y - 24, span: 170, angle: wp.angle, fold: wp.fold, style: 'membrane', color: kit.mix(hide, C.membrane, 0.4), bone: C.hideDark, light: L, time: info.time });
    if (m && m.phase === 'active') for (const hb of info.hitboxes) kit.shapeGlow(ctx, hb, P.effect, 0.14);
    if (v.statuses.some((s) => s.name === 'burn')) info.tint('#ff7a1a', 0.1);
  },

  trail(v, info) { return info.phase.name === 'active' && info.hitboxes[0] ? kit.shapeCenter(info.hitboxes[0]) : false; },

  entities: {
    wingNear: { draw() {} }, // drawn by the body (layered around it); the part only adds the hurt shape
    wingFar: { draw() {} },
    fireBreath: {
      // A widening cone of fire along the beam capsule, with rolling flame blobs.
      draw(ctx, e, info) {
        const ang = Math.atan2(132, 490), len = Math.min(e.len || 520, 520) * Math.min(1, e.age / 8);
        const k = Math.min(1, e.age / 6) * Math.min(1, e.life / 8);
        ctx.save();
        ctx.rotate(ang);
        ctx.globalAlpha *= k;
        const flick = (i) => Math.sin(info.time * 30 + i * 1.7) * 5;
        ctx.beginPath(); ctx.moveTo(4, -8);
        for (let i = 1; i <= 8; i++) ctx.lineTo(10 + (len * i) / 8, -8 - i * 3.6 + flick(i));
        for (let i = 8; i >= 1; i--) ctx.lineTo(10 + (len * i) / 8, 8 + i * 3.6 - flick(i + 9));
        ctx.lineTo(4, 8); ctx.closePath();
        ctx.fillStyle = kit.linear(ctx, 0, 0, len, 0, ['#fff6c8', '#ffd23a', '#ff7a1a', kit.rgba('#c8281a', 0.6)]); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 14; i++) {
          const d = ((i * 41 + e.age * 13) % Math.max(1, len)), s = 8 + d * 0.06;
          const yy = Math.sin(info.time * 18 + i * 2.1) * (3 + d * 0.05);
          kit.glow(ctx, 10 + d, yy, s * 1.8, i % 3 ? '#ff7a1a' : '#ffd23a', 0.5);
        }
        kit.glow(ctx, 0, 0, 40, '#fff1a8', 0.6);
        ctx.restore();
      },
    },
    ember: {
      draw(ctx, e, info) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        kit.glow(ctx, 0, 0, 22, '#ff7a1a', 0.6);
        for (let i = 1; i <= 3; i++) kit.glow(ctx, -e.vx * i * 1.2, -e.vy * i * 1.2, 12 - i * 2, '#ffb03a', 0.3);
        ctx.restore();
        kit.circle(ctx, 0, 0, 8, '#ffcf6a', { outline: '#a8261a', lineWidth: 2, gloss: 0.5 });
      },
    },
  },

  fx: {
    onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 8, shape: 'spark', colors: ['#fff1a8', '#ff7a1a'], speed: [2, 6], life: [12, 20] }); },
    onLand(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 10, shape: 'smoke', color: '#b8a888', speed: [1, 3], life: [18, 28] }); },
    onEvent: {
      roar(fx, ev) { fx.ring({ x: ev.x + 90, y: ev.y - 110, r0: 20, r1: 140, color: '#ffd27a', life: 18 }); fx.sound('roar'); },
      quake(fx, ev) { fx.ring({ x: ev.x, y: ev.y, r0: 20, r1: 160, color: '#d8c8a8', life: 16, flat: true }); fx.burst({ x: ev.x, y: ev.y, count: 14, shape: 'debris', color: '#8a7a5a', speed: [3, 7], gravity: 0.4, life: [20, 34] }); },
    },
  },
  sounds: { neutralSpecial: 'roar', jump: 'whoosh' },
  portrait: { x: 70, y: -100, r: 70 },
};
