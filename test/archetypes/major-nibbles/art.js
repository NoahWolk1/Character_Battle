// Major Nibbles art. The mech is procedural (shared/art/helpers/mech.js: IK legs and
// arms, riveted plates, thrusters) with the pilot's sprite sitting in the cockpit; on
// foot the hamster is the painted SVG sprite sheet (pilot.svg, 2× source res).
import * as kit from '../../../shared/art/kit.js';
import { mech } from '../../../shared/art/helpers/mech.js';

const C = { hull: '#5d6a40', hullDark: '#3f4a2c', steel: '#9aa6b2', joint: '#ffcf4a', glass: '#9fe3ff', outline: '#1f2414', star: '#f2e6b0', red: '#ff4a3a' };

// Sprite frames on pilot.svg (4 × 3, 128 px, anchor 64,122).
const PF = { idle: 0, idle2: 1, jump: 6, fall: 7, hurt: 8, windup: 9, strike: 10, cheer: 11 };

function pilotFrame(v) {
  if (v.state === 'hitstun' || v.state === 'shieldbreak') return PF.hurt;
  const m = v.move;
  if (m) return m.phase === 'active' ? PF.strike : m.phase === 'startup' || m.phase === 'charge' ? PF.windup : PF.idle;
  return Math.floor((v.stateFrame || 0) / 20) % 2 ? PF.idle2 : PF.idle;
}

/** Hand target for an arm: the active hitbox (punch), pulled back in startup, resting otherwise. */
function handTarget(v, info, rest, back) {
  const m = v.move;
  if (!m) return { x: rest.x, y: rest.y + Math.sin(info.time * 2.5) * 2 };
  if (m.phase === 'active' && info.hitboxes.length) {
    const c = kit.shapeCenter(info.hitboxes[0]);
    return back ? { x: rest.x - 6, y: rest.y } : c;
  }
  if (m.phase === 'startup' || m.phase === 'charge') return { x: rest.x - 30 * m.phaseT, y: rest.y - 12 * m.phaseT };
  return { x: rest.x + 10 * (1 - m.phaseT), y: rest.y };
}

function drawMech(ctx, v, info) {
  const P = info.palette, L = info.light;
  const t = info.time;
  const plating = (v.resources.plating ?? 40) / (v.resMax.plating || 40);
  const running = v.state === 'run';
  const ph = t * 9;
  const sq = info.motion.squash * 8;
  const bob = running ? Math.abs(Math.sin(ph)) * 3 : Math.sin(t * 2) * 1.2;
  const hipY = -50 + sq + bob;

  // legs (far leg first, darker)
  const step = (k) => (running ? { dx: Math.sin(ph + k * Math.PI) * 16, lift: Math.max(0, Math.cos(ph + k * Math.PI)) * 10 } : { dx: 0, lift: 0 });
  const air = !v.grounded;
  for (const k of [1, 0]) {
    const s = step(k);
    const hip = { x: k ? -14 : 14, y: hipY };
    const foot = air ? { x: hip.x + 6, y: -12 } : { x: hip.x + s.dx, y: -4 - s.lift };
    const leg = mech.ik2(hip, foot, 28, 28, 1);
    mech.limb(ctx, leg, { width: 13, color: k ? kit.shade(C.steel, -0.25) : C.steel, joint: C.joint, outline: C.outline, foot: { w: 30, h: 9, dx: 4, color: k ? C.hullDark : C.hull } });
  }
  // back arm
  const backHand = handTarget(v, info, { x: -36, y: -54 }, true);
  mech.limb(ctx, mech.ik2({ x: -22, y: -92 + bob }, backHand, 28, 28, -1), { width: 11, color: kit.shade(C.steel, -0.3), joint: kit.shade(C.joint, -0.3), outline: C.outline });

  // torso
  const ty = -78 + bob + sq * 0.5;
  mech.plate(ctx, { x: 0, y: ty, w: 78, h: 54, r: 10, color: P.main, outline: C.outline, light: L, rivets: true });
  mech.plate(ctx, { x: -6, y: -42 + bob + sq * 0.5, w: 56, h: 18, r: 5, color: kit.shade(P.main, -0.2), outline: C.outline, seam: false });
  // stencil: star + unit number
  kit.starPath(ctx, -16, ty + 4, 5, 9, 4, -Math.PI / 2);
  ctx.fillStyle = kit.rgba(C.star, 0.9); ctx.fill();
  ctx.fillStyle = kit.rgba(C.star, 0.8); ctx.font = 'bold 11px sans-serif'; ctx.fillText('07', 4, ty + 9);
  // battle damage as the plating drains
  if (plating < 0.6) {
    ctx.save(); ctx.strokeStyle = kit.rgba('#111', 0.7); ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(18, ty - 20); ctx.lineTo(10, ty - 8); ctx.lineTo(16, ty + 2); ctx.lineTo(8, ty + 14);
    if (plating < 0.3) { ctx.moveTo(-30, ty - 10); ctx.lineTo(-20, ty); ctx.lineTo(-26, ty + 12); }
    ctx.stroke(); ctx.restore();
    if (plating < 0.3) info.fx.local.smoke({ x: -26, y: ty - 26, rate: 0.25, color: '#4a4a4a', size: [5, 10] });
  }
  // exhaust pipe
  mech.plate(ctx, { x: -38, y: ty - 16, w: 10, h: 26, r: 3, color: C.hullDark, outline: C.outline, seam: false });
  if (running) info.fx.local.smoke({ x: -40, y: ty - 32, rate: 0.35, color: '#8a8a8a', size: [3, 7] });

  // cockpit dome with the pilot inside
  const cx = 6, cy = -110 + bob + sq * 0.3;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, 20, 0, kit.TAU); ctx.lineWidth = 4; ctx.strokeStyle = C.outline; ctx.stroke();
  ctx.fillStyle = kit.radial(ctx, cx - 6, cy - 8, 2, 26, ['#2a3b48', '#16212b']); ctx.fill();
  ctx.clip();
  info.sprite.drawFrame(ctx, 'pilot', pilotFrame(v), { x: cx - 2, y: cy + 22, scale: 0.72 });
  ctx.fillStyle = kit.rgba(C.glass, 0.18); ctx.fillRect(cx - 22, cy - 22, 44, 44);
  ctx.restore();
  kit.rimArc(ctx, cx, cy, 20, L.dir, '#ffffff', 3, 0.7, 1.4);
  ctx.beginPath(); ctx.arc(cx, cy, 20, Math.PI * 0.05, Math.PI * 0.95); ctx.lineWidth = 5; ctx.strokeStyle = C.hullDark; ctx.stroke();
  // antenna with a blinking light
  ctx.strokeStyle = C.outline; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-8, cy - 14); ctx.lineTo(-14, cy - 34 + Math.sin(t * 4) * 1.5); ctx.stroke();
  kit.circle(ctx, -14, cy - 36 + Math.sin(t * 4) * 1.5, 3.2, (t * 2) % 1 < 0.5 ? C.red : '#5a1a14', { outline: C.outline, lineWidth: 1.5 });

  // front arm (punching arm with a piston)
  const sh = { x: 26, y: -94 + bob };
  const hand = handTarget(v, info, { x: 40, y: -56 }, false);
  const arm = mech.ik2(sh, hand, 30, 30, -1);
  mech.piston(ctx, { x: sh.x - 4, y: sh.y + 8 }, { x: (arm.joint.x + arm.end.x) / 2, y: (arm.joint.y + arm.end.y) / 2 }, { width: 4 });
  mech.limb(ctx, arm, { width: 13, color: C.steel, joint: C.joint, outline: C.outline });
  mech.plate(ctx, { x: arm.end.x + 4, y: arm.end.y, w: 22, h: 20, r: 5, color: P.main, outline: C.outline, light: L, seam: false });
  mech.plate(ctx, { x: sh.x, y: sh.y, w: 26, h: 22, r: 7, color: kit.shade(P.main, 0.08), outline: C.outline, light: L, rivets: true, seam: false });

  // thrusters: jet boost, rising jumps
  const jet = v.move?.anim === 'm_jet' && v.move.phase !== 'recovery';
  if (jet || (air && v.vy < -4)) for (const x of [-14, 14]) mech.thruster(ctx, x, -6, Math.PI / 2, jet ? 1.2 : 0.5, t + x, ['#ffffff', '#ffd27a', '#ff6a2a']);
  if (v.move?.anim === 'm_boost' && v.move.phase !== 'recovery') mech.thruster(ctx, -40, -76, Math.PI, 1, t, ['#ffffff', '#ffd27a', '#ff6a2a']);
  if (info.phase.name === 'active') for (const hb of info.hitboxes) kit.shapeGlow(ctx, hb, P.effect, 0.16);
}

function drawPilot(ctx, v, info) {
  const t = info.time;
  const ball = v.move?.anim === 'p_ball' && v.move.phase !== 'recovery';
  if (ball) {
    ctx.save();
    ctx.translate(0, -28);
    ctx.rotate((v.move.frame || 0) * 0.35);
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, kit.TAU);
    ctx.fillStyle = kit.rgba('#cfefff', 0.25); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = kit.rgba('#7fc8e8', 0.9); ctx.stroke();
    ctx.lineWidth = 1.5; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(0, 0, 30, 10 + i * 8, i, 0, kit.TAU); ctx.stroke(); }
    ctx.restore();
  }
  info.sprite.drawClip(ctx, 'pilot', v, { scale: 0.88 });
  if (ball) { ctx.save(); ctx.translate(0, -28); kit.rimArc(ctx, 0, 0, 30, info.light.dir, '#ffffff', 3, 0.8, 1.2); ctx.restore(); }
  // the mech is ready to call back: radio waves over the helmet
  if ((v.resources.plating ?? 0) >= 25) {
    ctx.save(); ctx.strokeStyle = kit.rgba('#7fff9a', 0.5 + 0.4 * Math.sin(t * 8)); ctx.lineWidth = 2;
    for (const r of [8, 14]) { ctx.beginPath(); ctx.arc(8, -60, r, -2.3, -0.8); ctx.stroke(); }
    ctx.restore();
  }
  // impact bursts: the tiny paws/teeth land with a cartoon "pow" that fills the hitbox
  if (info.phase.name === 'active') {
    for (const hb of info.hitboxes) {
      const c = kit.shapeCenter(hb), r = (hb.r || Math.min(hb.w || 20, hb.h || 20) / 2) * 0.9;
      const spin = (v.move?.frame || 0) * 0.3;
      kit.starPath(ctx, c.x, c.y, 8, r, r * 0.55, spin);
      ctx.fillStyle = kit.rgba('#fff3b0', 0.85); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#e07a1a'; ctx.stroke();
      kit.starPath(ctx, c.x, c.y, 8, r * 0.55, r * 0.3, -spin);
      ctx.fillStyle = '#ffffff'; ctx.fill();
    }
  }
}

export default {
  rig: 'none',
  assets: { pilot: './pilot.svg' },
  sheets: { pilot: { image: 'pilot', frameW: 128, frameH: 128, cols: 4, anchor: [64, 122], scale: 0.5 } },
  clips: {
    pilot: {
      idle: { frames: [0, 1], fps: 3, loop: true },
      run: { frames: [2, 3, 4, 5], fps: 12, loop: true, speedFrom: 'vx' },
      jump: { frames: [6] }, fall: { frames: [7] }, helpless: { frames: [7] }, land: { frames: [0] }, crouch: { frames: [9] },
      hurt: { frames: [8] }, tumble: { frames: [8] }, grabbed: { frames: [8] }, shield: { frames: [9] }, taunt: { frames: [11] },
      p_atk: { sync: 'move', startup: [9], active: [10], recovery: [0] },
      p_cheer: { frames: [11, 1], fps: 6, loop: true },
      p_ball: { sync: 'move', startup: [6], active: [6], recovery: [7] },
    },
  },
  bounds: { base: { left: -130, right: 190, top: -210, bottom: 60 }, pilot: { left: -80, right: 110, top: -120, bottom: 14 } },
  palette: { main: C.hull, effect: '#ffcf4a', outline: C.outline },
  palettes: [{}, { main: '#4f6a8a' }, { main: '#8a4f4f' }, { main: '#c9b27a' }],

  draw: drawMech,
  forms: { pilot: { draw: drawPilot } },

  entities: {
    turret: {
      draw(ctx, e, info) {
        const fire = e.age % 50 >= 25 && e.age % 50 < 29;
        ctx.strokeStyle = C.outline; ctx.lineWidth = 3;
        for (const dx of [-12, 12]) { ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(dx, 0); ctx.stroke(); }
        mech.plate(ctx, { x: 0, y: -20, w: 26, h: 18, r: 5, color: C.hull, outline: C.outline, light: info.light, rivets: true, seam: false });
        const a = -0.15 + Math.sin(e.age * 0.05) * 0.2;
        ctx.save(); ctx.translate(4, -24); ctx.rotate(a);
        mech.bone(ctx, { x: 0, y: 0 }, { x: 22, y: 0 }, 6, C.steel, C.outline);
        if (fire) { ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, 26, 0, 12, '#ffe14a', 0.9); }
        ctx.restore();
        kit.circle(ctx, -6, -24, 2.5, (e.age >> 4) % 2 ? '#7fff9a' : '#1f5a2a', { outline: C.outline, lineWidth: 1 });
      },
    },
    pellet: {
      draw(ctx, e) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        kit.glow(ctx, 0, 0, 12, '#ffe14a', 0.7);
        ctx.restore();
        kit.capsulePath(ctx, -7, 0, 3, 0, 3.5);
        ctx.fillStyle = '#fff6c0'; ctx.fill();
      },
    },
    missile: {
      draw(ctx, e, info) {
        ctx.rotate(Math.atan2(e.vy, Math.abs(e.vx) + 0.001));
        mech.thruster(ctx, -10, 0, Math.PI, 0.7, info.time + e.seed, ['#ffffff', '#ffd27a', '#ff6a2a']);
        kit.capsulePath(ctx, -9, 0, 7, 0, 5);
        kit.fillShaded(ctx, '#d8dee6', { outline: C.outline, lineWidth: 2, x: 0, y: 0, r: 8 });
        ctx.beginPath(); ctx.moveTo(7, -5); ctx.lineTo(14, 0); ctx.lineTo(7, 5); ctx.closePath(); ctx.fillStyle = C.red; ctx.fill(); ctx.strokeStyle = C.outline; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-9, -5); ctx.lineTo(-13, -9); ctx.lineTo(-5, -5); ctx.moveTo(-9, 5); ctx.lineTo(-13, 9); ctx.lineTo(-5, 5); ctx.fillStyle = C.hull; ctx.fill();
      },
    },
    seed: {
      draw(ctx, e) {
        ctx.rotate(e.age * 0.4);
        ctx.beginPath(); ctx.ellipse(0, 0, 7, 4, 0, 0, kit.TAU);
        ctx.fillStyle = '#3a3026'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#120e0a'; ctx.stroke();
        ctx.strokeStyle = '#d8d0c0'; ctx.lineWidth = 1; for (const y of [-1.5, 1.5]) { ctx.beginPath(); ctx.moveTo(-5, y); ctx.lineTo(5, y * 0.6); ctx.stroke(); }
      },
    },
    wreck: {
      draw(ctx, e, info) {
        const hpT = e.hp === null ? 1 : e.hp / 15;
        ctx.save(); ctx.rotate(-0.12);
        mech.plate(ctx, { x: 0, y: -22, w: 70, h: 40, r: 8, color: kit.shade(C.hull, -0.3), outline: C.outline, light: info.light, rivets: true });
        ctx.restore();
        ctx.beginPath(); ctx.arc(14, -44, 14, Math.PI, 0); ctx.lineWidth = 3; ctx.strokeStyle = C.outline; ctx.fillStyle = kit.rgba('#2a3b48', 0.9); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = kit.rgba('#111', 0.8); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-20, -36); ctx.lineTo(-8, -22); ctx.lineTo(-16, -10); ctx.stroke();
        kit.circle(ctx, -28, -40, 3, (info.time * 3) % 1 < 0.5 ? C.red : '#4a1410', { outline: C.outline, lineWidth: 1 });
        if (hpT < 0.6 && e.age % 6 === 0) info.fx.burst?.({ x: e.x + 10, y: e.y - 44, count: 1, shape: 'smoke', color: '#3a3a3a', speed: [0.5, 1.5], angle: -90, life: [30, 50] });
      },
    },
  },

  fx: {
    onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 6, shape: 'debris', colors: ['#9aa6b2', '#ffcf4a'], speed: [2, 6], gravity: 0.3, life: [16, 26] }); },
    onFormChange(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 60, count: 18, shape: 'debris', colors: ['#6f7d4f', '#9aa6b2', '#ffcf4a'], speed: [3, 9], gravity: 0.35, life: [24, 40] }); fx.flash('#ffffff', 0.2, 4); },
    onEvent: {
      eject(fx, ev) { fx.text({ x: ev.x, y: ev.y - 140, text: 'EJECT!', color: '#ff4a3a', life: 50, size: 18 }); fx.shake(4); fx.sound('alarm'); },
      redock(fx, ev) { fx.text({ x: ev.x, y: ev.y - 90, text: 'MECH, TO ME!', color: '#7fff9a', life: 50, size: 14 }); },
      squeak(fx, ev) { fx.text({ x: ev.x, y: ev.y - 70, text: 'squeak!', color: '#ffe9a8', life: 36, size: 12 }); fx.sound('squeak'); },
      turretShot(fx, ev) { fx.burst({ x: ev.data.x ?? ev.x, y: ev.data.y ?? ev.y, count: 3, shape: 'spark', color: '#ffe14a', speed: [2, 4], life: 8 }); },
      boom(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 12, shape: 'smoke', colors: ['#ff8a3a', '#ffd27a', '#555555'], speed: [1, 4], life: [16, 30] }); fx.sound('boom', { volume: 0.5 }); },
      wreckBoom(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 24, count: 26, shape: 'debris', colors: ['#3f4a2c', '#9aa6b2'], speed: [3, 9], gravity: 0.35, life: [24, 44] }); fx.shake(5); fx.sound('boom'); },
      stomp(fx, ev) { fx.ring({ x: ev.x, y: ev.y, r0: 10, r1: 100, color: '#d8c8a8', life: 14, flat: true }); fx.shake(3); },
      launch(fx, ev) { fx.sound('whoosh'); },
      deploy(fx, ev) { fx.sound('clank'); },
      salute(fx, ev) { fx.text({ x: ev.x, y: ev.y - 150, text: 'Major Nibbles, reporting!', color: '#f2e6b0', life: 70, size: 14 }); },
    },
  },
  sounds: { jump: 'boing' },
};
