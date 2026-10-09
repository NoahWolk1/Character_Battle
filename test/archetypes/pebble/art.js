// Pebble art (rig: none): a smooth river stone that fills its 40×40 hurtbox
// (rounded corners leave < 10% of the box transparent, so the Lab hurtbox-fit
// check passes). Googly eyes on springs, a moss tuft, speckles, and gravel bursts
// that fill each active hitbox.
import * as kit from '../../../shared/art/kit.js';

const { lerp, clamp, TAU } = kit;
const PAL = {
  main: '#8f9aa8', light: '#c3ccd6', dark: '#59636f', outline: '#262b33', speck: '#6c7480',
  moss: '#6fbf4a', mossDark: '#3d7a2a', eye: '#ffffff', pupil: '#14161a', effect: '#d9c7a3', water: '#7fd0ff',
};
const ALT = [{ ...PAL, main: '#b07a5a', light: '#d9a684', dark: '#734a33', speck: '#8d5d42', outline: '#2c1a10' }];
const easeOut = (t) => 1 - (1 - t) * (1 - t);

/** The stone outline: a slightly lumpy rounded square, 40×40 around (0, -20). */
function stonePath(ctx, w = 40, h = 40) {
  const hw = w / 2, top = -h, r = 13;
  ctx.beginPath();
  ctx.moveTo(-hw + r, top + 1);
  ctx.quadraticCurveTo(0, top - 2, hw - r, top + 1);
  ctx.quadraticCurveTo(hw, top, hw, top + r);
  ctx.quadraticCurveTo(hw + 1.5, -h / 2, hw, -r);
  ctx.quadraticCurveTo(hw, 0, hw - r, 0);
  ctx.lineTo(-hw + r, 0);
  ctx.quadraticCurveTo(-hw, 0, -hw, -r);
  ctx.quadraticCurveTo(-hw - 1.5, -h / 2, -hw, top + r);
  ctx.quadraticCurveTo(-hw, top, -hw + r, top + 1);
  ctx.closePath();
}

function spring(s, target, dt, k = 220, d = 9) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n; i++) { s.v += (k * (target - s.x) - d * s.v) * h; s.x += s.v * h; }
  return s.x;
}

/** Gravel chips + dust filling a hit shape. */
function gravel(ctx, s, pal, seed, a = 1) {
  kit.shapeGlow(ctx, s, pal.effect, 0.4 * a);
  const rnd = kit.seeded(seed);
  ctx.save();
  ctx.globalAlpha *= a;
  const k = kit.shapeKind(s);
  const area = k === 'rect' ? s.w * s.h : k === 'capsule' ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * s.r * 2 + Math.PI * s.r * s.r : Math.PI * s.r * s.r;
  ctx.fillStyle = kit.rgba(pal.effect, 0.4); kit.shapePath(ctx, s); ctx.fill();          // dust cloud
  const n = clamp(Math.round(area / 70), 8, 30);
  for (let i = 0; i < n; i++) {
    const p = kit.shapePoint(s, rnd), r = 3 + rnd() * 4;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) { const ang = (k / 5) * TAU + rnd() * 0.6; const rr = r * (0.7 + rnd() * 0.5); k ? ctx.lineTo(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr) : ctx.moveTo(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr); }
    ctx.closePath();
    ctx.fillStyle = i % 3 ? pal.main : pal.light; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = pal.outline; ctx.stroke();
  }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.globalAlpha *= 0.7;
  kit.shapePath(ctx, s, 1); ctx.stroke();
  ctx.restore();
}

function drawPebble(ctx, v, info, pal) {
  const t = info.time, m = v.move, st = v.state, c = info.cache;
  const mo = info.motion || { squash: 0, stretch: 0, lean: 0 };
  let rot = 0, sx = 1 + mo.squash * 0.25, sy = 1 - mo.squash * 0.22, lift = 0, look = { x: 0.4, y: 0 }, brow = 0, mouth = 'smile';
  const breathe = Math.sin(t * 3) * 0.02;
  sx += breathe; sy -= breathe;
  if (st === 'run') { rot = Math.sin(t * 22) * 0.12; lift = Math.abs(Math.sin(t * 22)) * 3; look = { x: 1, y: 0 }; brow = 0.5; }
  if (st === 'crouch') { sx *= 1.2; sy *= 0.8; }
  if (st === 'hitstun' || st === 'tumble') { rot = t * 14; mouth = 'ow'; brow = -1; }
  if (st === 'helpless') { rot = Math.sin(t * 5) * 0.3; mouth = 'ow'; }
  if (st === 'shield') { mouth = 'grit'; brow = 1; sy *= 0.94; }
  if (!v.grounded && st === 'air') { sy *= 1 + mo.stretch * 0.08; look = { x: 0.3, y: v.vy > 0 ? 0.8 : -0.6 }; }
  let ph = null;
  if (m) {
    ph = m.phase; const pt = m.phaseT || 0;
    const A = ph === 'startup' || ph === 'charge' ? pt : 0, S = ph === 'active' ? 1 : ph === 'recovery' ? 1 - easeOut(pt) : 0;
    brow = 1; mouth = ph === 'active' ? 'yell' : 'grit'; look = { x: 1, y: 0 };
    switch (m.anim) {
      case 'spin': case 'skip': rot = (m.t || 0) * TAU * 2; break;
      case 'flip': rot = -S * Math.PI; look = { x: 0, y: -1 }; break;
      case 'lunge': case 'bonk': case 'slam': rot = -0.25 * A + 0.35 * S; sx *= 1 - 0.1 * A + 0.08 * S; break;
      case 'bump': rot = 0.3 * A - 0.4 * S; look = { x: -1, y: 0 }; break;
      case 'hop': case 'crack': sy *= 1 - 0.2 * A + 0.18 * S; sx *= 1 + 0.15 * A - 0.08 * S; look = { x: 0, y: -1 }; break;
      case 'plummet': rot = 0; sy *= 1.1; look = { x: 0, y: 1 }; break;
      case 'tremor': case 'sweep': sy *= 1 - 0.25 * A; sx *= 1 + 0.2 * A; break;
      case 'hunker': sy *= 0.78; sx *= 1.18; mouth = 'grit'; break;
      case 'proud': lift = Math.abs(Math.sin(t * 8)) * 6; mouth = 'smile'; brow = 0.6; break;
      default: rot = 0.1 * S;
    }
  }
  // eye springs (secondary motion)
  const es = c.eyes || (c.eyes = { x: { x: 0, v: 0 }, y: { x: 0, v: 0 } });
  const lx = spring(es.x, look.x, info.dt || 1 / 60), ly = spring(es.y, look.y + (v.vy || 0) * -0.04, info.dt || 1 / 60);

  // water for the geyser ride
  if (m && m.anim === 'geyser' && ph !== 'startup') {
    const a = ph === 'active' ? 1 : 1 - (m.phaseT || 0);
    ctx.save(); ctx.globalAlpha = a;
    const g = kit.linear(ctx, 0, 0, 0, 60, [kit.rgba(pal.water, 0.9), kit.rgba(pal.water, 0)]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-16, -4);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-16 - i * 1.5 + Math.sin(t * 20 + i) * 2, -4 + i * 10);
    ctx.lineTo(16 + 9, 56);
    for (let i = 6; i >= 0; i--) ctx.lineTo(16 + i * 1.5 + Math.sin(t * 18 + i) * 2, -4 + i * 10);
    ctx.fill();
    for (let i = 0; i < 6; i++) kit.droplet(ctx, Math.sin(i * 2.3 + t * 4) * 20, 4 + ((t * 80 + i * 13) % 50), 3, pal.water, Math.PI / 2);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(0, -20 - lift);
  ctx.rotate(rot);
  ctx.scale(sx, sy);
  ctx.translate(0, 20);
  // body: 3 tiers + rim + outline
  stonePath(ctx);
  ctx.fillStyle = kit.radial(ctx, -8, -30, 2, 34, [pal.light, pal.main, pal.dark]);
  ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = kit.rgba(pal.dark, 0.6);
  ctx.beginPath(); ctx.ellipse(6, -2, 24, 9, -0.1, 0, TAU); ctx.fill();          // ground shadow side
  const rnd = kit.seeded(11);
  for (let i = 0; i < 14; i++) { ctx.fillStyle = i % 4 ? pal.speck : pal.light; ctx.beginPath(); ctx.arc(-18 + rnd() * 36, -38 + rnd() * 36, 0.8 + rnd() * 1.4, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = kit.rgba(pal.outline, 0.5); ctx.lineWidth = 1.2;              // a hairline crack
  ctx.beginPath(); ctx.moveTo(12, -40); ctx.lineTo(9, -33); ctx.lineTo(13, -29); ctx.lineTo(10, -24); ctx.stroke();
  ctx.restore();
  const L = info.light?.dir || { x: -0.45, y: -0.89 };
  ctx.save();                                                                      // rim (lit edge crescent)
  stonePath(ctx); ctx.clip();
  ctx.beginPath(); ctx.rect(-100, -120, 200, 200);
  ctx.translate(-L.x * 3, -L.y * 3); stoneSub(ctx);
  ctx.globalAlpha = 0.6; ctx.fillStyle = info.light?.rim || '#ffc48a'; ctx.fill('evenodd');
  ctx.restore();
  stonePath(ctx);
  ctx.lineWidth = 3; ctx.strokeStyle = pal.outline; ctx.lineJoin = 'round'; ctx.stroke();
  // gloss
  ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(-9, -33, 6, 2.6, -0.4, 0, TAU); ctx.fill(); ctx.restore();
  // moss tuft
  ctx.fillStyle = pal.moss; ctx.strokeStyle = pal.mossDark; ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const bx = -10 + i * 4, sw = Math.sin(t * 4 + i) * 1.5;
    ctx.beginPath(); ctx.moveTo(bx - 3, -39); ctx.quadraticCurveTo(bx + sw, -48 - (i % 2) * 3, bx + 3, -39); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // googly eyes
  for (const ex of [-4, 8]) {
    ctx.beginPath(); ctx.arc(ex, -24, 6, 0, TAU); ctx.fillStyle = pal.eye; ctx.fill();
    ctx.lineWidth = 1.8; ctx.strokeStyle = pal.outline; ctx.stroke();
    ctx.beginPath(); ctx.arc(ex + clamp(lx, -1, 1) * 2.6, -24 + clamp(ly, -1, 1) * 2.6, 2.8, 0, TAU); ctx.fillStyle = pal.pupil; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + clamp(lx, -1, 1) * 2.6 - 1, -25 + clamp(ly, -1, 1) * 2.6, 0.9, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill();
  }
  if (brow) {                                                                      // brows: determined (+) / worried (-)
    ctx.strokeStyle = pal.outline; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-9, -31 - brow); ctx.lineTo(-1, -31 + brow * 1.5); ctx.moveTo(4, -31 + brow * 1.5); ctx.lineTo(13, -31 - brow); ctx.stroke();
  }
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath();
  if (mouth === 'smile') ctx.arc(3, -14, 4, 0.2, Math.PI - 0.2);
  else if (mouth === 'grit') { ctx.moveTo(-1, -13); ctx.lineTo(7, -13); }
  else { ctx.ellipse(3, -12, mouth === 'yell' ? 3.5 : 2.5, mouth === 'yell' ? 3 : 3.5, 0, 0, TAU); ctx.fillStyle = pal.outline; ctx.fill(); }
  ctx.stroke();
  if (st === 'helpless') for (let i = 0; i < 3; i++) { const a = t * 5 + i * 2.1; kit.starPath(ctx, Math.cos(a) * 16, -50 + Math.sin(a) * 4, 5, 4, 1.6, a); ctx.fillStyle = '#ffe36b'; ctx.fill(); }
  ctx.restore();
  // active frames: gravel bursts fill the hitboxes
  if (m && ph === 'active') (info.hitboxes || []).forEach((h, i) => gravel(ctx, h, pal, 7 + i + ((info.simFrame | 0) >> 2), 1));
}
function stoneSub(ctx) {   // stonePath without beginPath (for the evenodd rim cut)
  const hw = 20, top = -40, r = 13;
  ctx.moveTo(-hw + r, top + 1);
  ctx.quadraticCurveTo(0, top - 2, hw - r, top + 1); ctx.quadraticCurveTo(hw, top, hw, top + r);
  ctx.quadraticCurveTo(hw + 1.5, -20, hw, -r); ctx.quadraticCurveTo(hw, 0, hw - r, 0);
  ctx.lineTo(-hw + r, 0); ctx.quadraticCurveTo(-hw, 0, -hw, -r);
  ctx.quadraticCurveTo(-hw - 1.5, -20, -hw, top + r); ctx.quadraticCurveTo(-hw, top, -hw + r, top + 1);
  ctx.closePath();
}

export default {
  rig: 'none',
  bounds: { left: -90, right: 110, top: -120, bottom: 64 },
  palette: PAL,
  palettes: ALT,
  draw(ctx, v, info) { drawPebble(ctx, v, info, info.palette); },

  entities: {
    grit: {
      draw(ctx, e, info) {
        const pal = info.palette;
        ctx.save(); ctx.rotate(e.age * 0.4);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU, r = 6 + ((k * 7) % 3); k ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath();
        ctx.fillStyle = kit.radial(ctx, -2, -2, 0, 8, [pal.light, pal.main, pal.dark]); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
        ctx.restore();
      },
    },
  },

  trail(v) { return v.move && (v.move.anim === 'skip' || v.move.anim === 'spin') ? { x: 0, y: -20 } : null; },

  fx: {
    onHit(fx, ev, info) {
      const P = info.palette, dmg = ev.damage || 0;
      fx.burst({ x: ev.x, y: ev.y, count: 5 + dmg, shape: 'debris', colors: [P.main, P.light, P.dark], speed: [2, 7], gravity: 0.35, life: [14, 26], size: [2, 5] });
      fx.burst({ x: ev.x, y: ev.y, count: 4, shape: 'smoke', colors: [P.effect, '#ffffff'], speed: [1, 3], life: [12, 22], size: [6, 12] });
      if (dmg >= 10) fx.shake(3);
    },
    onLand(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 2, count: ev.heavy ? 8 : 4, shape: 'debris', colors: [info.palette.dark, info.palette.speck], speed: [1, 3], angle: 90, spread: 140, gravity: 0.4, life: [10, 18], size: [1.5, 3] }); },
    onKO(fx, ev, info) {
      fx.burst({ x: ev.x, y: ev.y, count: 18, shape: 'debris', colors: [info.palette.main, info.palette.light], speed: [3, 10], gravity: 0.3, life: [24, 40], size: [3, 6] });
      fx.text({ x: ev.x, y: ev.y - 30, text: 'plink!', size: 18, color: '#ffffff', life: 60 });
    },
    onEvent: {
      skip(fx, ev, info) {
        fx.ring({ x: ev.x, y: ev.y, r0: 6, r1: 40, color: info.palette.water, life: 18, width: 3, flat: true });
        fx.burst({ x: ev.x, y: ev.y, count: 8, shape: 'drip', color: info.palette.water, speed: [2, 5], angle: 90, spread: 90, gravity: 0.35, life: [14, 24], size: [2, 3] });
        fx.sound('splash', { pitch: 1.6, volume: 0.6 });
      },
    },
  },
  sounds: { jump: 'boing' },

  portrait(ctx, size, info) {
    const k = size / 60;
    ctx.save(); ctx.translate(size / 2 - 2 * k, size * 0.9); ctx.scale(k, k);
    drawPebble(ctx, { state: 'idle', move: null, grounded: true, vy: 0 }, { ...info, time: 0.4, dt: 1 / 60, cache: {}, motion: { squash: 0, stretch: 0, lean: 0 } }, info.palette);
    ctx.restore();
  },
};
