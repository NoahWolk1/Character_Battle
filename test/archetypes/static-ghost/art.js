// Static Ghost art (rig: none): a CRT television floating on a sheet of TV snow.
// The screen is the face. Phasing (snapshot `intangible`) makes the sheet go thin
// with a rolling scanline; when a phase move is in its window but the Governor
// denied the frames, the picture tears and the screen shows NO SIGNAL bars.
import * as kit from '../../../shared/art/kit.js';

const { lerp, clamp, TAU } = kit;
const PAL = {
  main: '#9aa7b4', light: '#e6eef4', dark: '#4a5663', outline: '#1b1d2b',
  casing: '#c9a77a', casingDark: '#8a6a45', casingLight: '#ecd3a8', screen: '#16324a', glow: '#8ff6ff',
  face: '#bfffe8', effect: '#b9f3ff', magenta: '#ff4fd8', cyan: '#3ff2ff',
};
const ALT = [{ ...PAL, casing: '#4a4f5c', casingDark: '#2b2f38', casingLight: '#7a8090', screen: '#2a1238', glow: '#ff9cf0', face: '#ffd6f6' }];
const BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
const PHASE_WIN = { surf: [3, 14], fade: [4, 23], step: [3, 14] };
const easeOut = (t) => 1 - (1 - t) * (1 - t);

/** Seeded TV-snow blocks inside the current clip. */
function snow(ctx, rng, x, y, w, h, pal, alpha = 1, cell = 3) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  for (let yy = y; yy < y + h; yy += cell) {
    for (let xx = x; xx < x + w; xx += cell) {
      const v = rng();
      ctx.fillStyle = v < 0.33 ? pal.dark : v < 0.75 ? pal.main : pal.light;
      ctx.fillRect(xx, yy, cell, cell);
    }
  }
  ctx.restore();
}

function sheetPath(ctx, t, o) {
  const w = 22 * o.sx, top = -52, hem = -4 * o.sy;
  ctx.beginPath();
  ctx.moveTo(-w + 2, top);
  ctx.lineTo(w - 2, top);
  ctx.bezierCurveTo(w + 6 + o.lean * 4, -38, w + 4 + o.lean * 8, -14, w + o.lean * 10, hem);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const x0 = lerp(w, -w, i / n) + o.lean * 10, x1 = lerp(w, -w, (i + 1) / n) + o.lean * 10;
    ctx.quadraticCurveTo((x0 + x1) / 2, hem - 9 + Math.sin(t * 6 + i * 2) * 4, x1, hem + Math.sin(t * 5 + i) * 2);
  }
  ctx.bezierCurveTo(-w - 4 + o.lean * 8, -14, -w - 6 + o.lean * 4, -38, -w + 2, top);
  ctx.closePath();
}

function screenFace(ctx, x, y, w, h, expr, pal, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = pal.face; ctx.strokeStyle = pal.face; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  ctx.shadowColor = pal.glow; ctx.shadowBlur = 6;
  const px = (cx, cy, s = 3) => ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
  switch (expr) {
    case 'angry':
      ctx.beginPath(); ctx.moveTo(-11, -7); ctx.lineTo(-4, -4); ctx.moveTo(11, -7); ctx.lineTo(4, -4); ctx.stroke();
      px(-7, -1, 4); px(7, -1, 4);
      ctx.beginPath(); ctx.ellipse(0, 7, 5, 3.5, 0, 0, TAU); ctx.fill();
      break;
    case 'hurt':
      ctx.beginPath(); for (const ex of [-7, 7]) { ctx.moveTo(ex - 3, -6); ctx.lineTo(ex + 3, 0); ctx.moveTo(ex + 3, -6); ctx.lineTo(ex - 3, 0); } ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, 8); ctx.lineTo(-2, 5); ctx.lineTo(2, 8); ctx.lineTo(6, 5); ctx.stroke();
      break;
    case 'scare':
      ctx.beginPath(); ctx.arc(-7, -3, 4.5, 0, TAU); ctx.arc(7, -3, 4.5, 0, TAU); ctx.fill();
      ctx.fillStyle = pal.screen; px(-7, -3, 2.5); px(7, -3, 2.5);
      ctx.fillStyle = pal.face; ctx.beginPath(); ctx.ellipse(0, 9, 8, 5, 0, 0, TAU); ctx.fill();
      break;
    case 'dizzy':
      ctx.beginPath(); for (const ex of [-7, 7]) { for (let a = 0; a < 9; a += 0.4) { const r = a * 0.5; ctx.lineTo(ex + Math.cos(a + t * 8) * r, -3 + Math.sin(a + t * 8) * r); } ctx.moveTo(7, -3); } ctx.stroke();
      break;
    case 'nosignal':
      ctx.shadowBlur = 0;
      BARS.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-w / 2 + (i * w) / 7, -h / 2, w / 7 + 0.5, h * 0.7); });
      ctx.fillStyle = '#000'; ctx.fillRect(-w / 2, h * 0.2, w, h * 0.3);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 5px monospace'; ctx.textAlign = 'center'; ctx.fillText('NO SIGNAL', 0, h * 0.4);
      break;
    default: { // happy, blinking
      const blink = (t % 3.2) < 0.12;
      if (blink) { ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(-4, -3); ctx.moveTo(4, -3); ctx.lineTo(10, -3); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(-10, -1); ctx.lineTo(-7, -5); ctx.lineTo(-4, -1); ctx.moveTo(4, -1); ctx.lineTo(7, -5); ctx.lineTo(10, -1); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, 4, 4, 0.2, Math.PI - 0.2); ctx.stroke();
    }
  }
  ctx.restore();
}

/** Static-filled hit shape with an electric edge (the visual is the hitbox). */
function staticShape(ctx, s, pal, rng, t) {
  ctx.save();
  kit.shapePath(ctx, s); ctx.clip();
  const c = kit.shapeCenter(s), R = 90;
  snow(ctx, rng, c.x - R, c.y - R, R * 2, R * 2, pal, 0.75, 4);
  ctx.globalCompositeOperation = 'lighter';
  kit.shapeGlow(ctx, s, pal.glow, 0.5);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = pal.cyan; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
  ctx.translate(1.5, 0); kit.shapePath(ctx, s, 1); ctx.stroke();
  ctx.strokeStyle = pal.magenta; ctx.translate(-3, 0); kit.shapePath(ctx, s, 1); ctx.stroke();
  ctx.restore();
}

function tipOf(m) {
  const h = (m.def?.hitboxes || []).find((b) => b.kind !== 'grab');
  if (!h) return null;
  const k = kit.shapeKind(h);
  if (k === 'capsule') return Math.hypot(h.x2, h.y2 + 46) >= Math.hypot(h.x1, h.y1 + 46) ? { x: h.x2, y: h.y2, r: h.r } : { x: h.x1, y: h.y1, r: h.r };
  if (k === 'rect') return { x: h.x, y: h.y, r: Math.min(h.w, h.h) / 2 };
  return { x: h.x, y: h.y, r: h.r };
}

function drawGhost(ctx, v, info, pal) {
  const t = info.time, m = v.move, st = v.state;
  const mo = info.motion || { squash: 0, stretch: 0, lean: 0 };
  const rng = info.rng || kit.seeded((info.simFrame | 0) + 3);
  const o = { sx: 1 + mo.squash * 0.15, sy: 1 - mo.squash * 0.12, lean: -mo.lean };
  let expr = 'happy', bodyA = 1, tear = 0, tvTilt = Math.sin(t * 1.7) * 0.04, tvDy = Math.sin(t * 2.4) * 2.5, arm = null, ears = 0;
  if (st === 'hitstun' || st === 'tumble') { expr = 'hurt'; tvTilt = -0.3; tear = 0.4; }
  if (st === 'helpless') { expr = 'dizzy'; bodyA = 0.7; }
  if (st === 'shield') { expr = 'angry'; }
  if (st === 'crouch') { o.sy *= 0.8; tvDy += 10; }
  if (st === 'run') o.lean -= 0.6;
  if (m) {
    const ph = m.phase, pt = m.phaseT || 0;
    const ext = ph === 'active' ? 1 : ph === 'recovery' ? 1 - easeOut(pt) : 0;
    expr = 'angry';
    const tip = tipOf(m);
    if (tip && ext > 0 && Math.abs(tip.x) > 26) arm = { tip, ext };
    if (m.anim === 'antenna' || m.anim === 'ears') ears = ext;
    if (ph === 'startup') { tvTilt -= 0.12 * pt * Math.sign(tip?.x || 1); }
    const win = PHASE_WIN[m.anim];
    if (win) {
      const inWin = m.frame >= win[0] && m.frame <= win[1];
      if (inWin && v.intangible) { bodyA = m.anim === 'fade' ? 0.18 : 0.42; expr = 'happy'; }
      else if (inWin && !v.intangible) { tear = 1; expr = 'nosignal'; }        // Governor said no
    }
    if (m.anim === 'fade' && m.frame >= 26 && m.frame < 36) { expr = 'scare'; bodyA = 1; }
    if (m.anim === 'boo') expr = m.phase === 'active' || m.frame > 10 ? 'scare' : 'happy';
  } else if (v.intangible && st !== 'respawn') bodyA = 0.45;

  // the sheet of snow
  ctx.save();
  ctx.globalAlpha *= bodyA;
  sheetPath(ctx, t, o);
  ctx.save(); ctx.clip();
  snow(ctx, rng, -36, -56, 72, 60, pal, 1, 3);
  ctx.fillStyle = kit.linear(ctx, 0, -56, 0, 0, [kit.rgba('#ffffff', 0.25), kit.rgba(pal.dark, 0.45)]); ctx.fillRect(-40, -60, 80, 64);
  const roll = ((t * 40) % 70) - 60;
  ctx.fillStyle = kit.rgba('#ffffff', 0.35); ctx.fillRect(-40, roll, 80, 4);
  ctx.restore();
  ctx.lineWidth = 2; ctx.strokeStyle = pal.cyan; ctx.save(); ctx.translate(1.5, 0); sheetPath(ctx, t, o); ctx.stroke(); ctx.restore();
  ctx.strokeStyle = pal.magenta; ctx.save(); ctx.translate(-1.5, 0); sheetPath(ctx, t, o); ctx.stroke(); ctx.restore();
  sheetPath(ctx, t, o); ctx.lineWidth = 2.6; ctx.strokeStyle = pal.outline; ctx.stroke();
  // static arm reaching toward the strike
  if (arm) {
    const a = { x: 14 * Math.sign(arm.tip.x), y: -40 };
    const tx = lerp(a.x, arm.tip.x, arm.ext), ty = lerp(a.y, arm.tip.y, arm.ext);
    kit.capsulePath(ctx, a.x, a.y, tx, ty, 10, Math.max(6, arm.tip.r * 0.55));
    ctx.save(); ctx.clip(); snow(ctx, rng, Math.min(a.x, tx) - 30, Math.min(a.y, ty) - 30, Math.abs(tx - a.x) + 60, Math.abs(ty - a.y) + 60, pal, 1, 3); ctx.restore();
    kit.capsulePath(ctx, a.x, a.y, tx, ty, 10, Math.max(6, arm.tip.r * 0.55)); ctx.lineWidth = 2.4; ctx.strokeStyle = pal.outline; ctx.stroke();
  }
  ctx.restore();

  // the TV (face): tears horizontally when the signal is denied
  ctx.save();
  ctx.translate(0, -66 + tvDy);
  ctx.rotate(tvTilt);
  ctx.globalAlpha *= Math.max(bodyA, 0.55);
  // rabbit ears
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const el = 22 + ears * 26;
  for (const sgn of [-1, 1]) {
    const a = -Math.PI / 2 + sgn * (0.45 - ears * 0.25) + Math.sin(t * 3 + sgn) * 0.06;
    ctx.beginPath(); ctx.moveTo(sgn * 4, -18); ctx.lineTo(sgn * 4 + Math.cos(a) * el, -18 + Math.sin(a) * el);
    ctx.lineWidth = 3.6; ctx.strokeStyle = pal.outline; ctx.stroke(); ctx.lineWidth = 1.6; ctx.strokeStyle = '#d7dde6'; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = pal.outline;
    ctx.beginPath(); ctx.arc(sgn * 4 + Math.cos(a) * el, -18 + Math.sin(a) * el, 2.8, 0, TAU); ctx.fillStyle = pal.glow; ctx.fill(); ctx.stroke();
    if (ears > 0.5) kit.lightning(ctx, rng, sgn * 4 + Math.cos(a) * el, -18 + Math.sin(a) * el, 0, -46 - ears * 40, pal.glow, 2, ears, { core: '#ffffff', jag: 0.3 });
  }
  const slices = tear > 0 ? 5 : 1;
  for (let i = 0; i < slices; i++) {
    ctx.save();
    if (slices > 1) {
      ctx.beginPath(); ctx.rect(-40, -20 + (i * 40) / slices, 80, 40 / slices + 0.5); ctx.clip();
      ctx.translate((rng() - 0.5) * 12 * tear, 0);
    }
    kit.roundRectPath(ctx, -23, -19, 46, 38, 8);
    ctx.fillStyle = kit.linear(ctx, 0, -19, 0, 19, [pal.casingLight, pal.casing, pal.casingDark]); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = pal.outline; ctx.stroke();
    ctx.fillStyle = kit.rgba('#ffffff', 0.35); ctx.fillRect(-19, -16, 30, 2.5);                    // rim light on the casing
    kit.roundRectPath(ctx, -18, -14, 30, 26, 6);
    ctx.fillStyle = kit.radial(ctx, -3, -1, 2, 22, [kit.shade(pal.screen, 0.35), pal.screen]); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
    ctx.save(); kit.roundRectPath(ctx, -18, -14, 30, 26, 6); ctx.clip();
    screenFace(ctx, -3, -1, 30, 26, expr, pal, t);
    ctx.fillStyle = kit.rgba('#000000', 0.25); for (let y = -14; y < 12; y += 3) ctx.fillRect(-18, y, 30, 1);
    ctx.fillStyle = kit.rgba('#ffffff', 0.18); ctx.beginPath(); ctx.ellipse(-9, -8, 8, 4, -0.4, 0, TAU); ctx.fill();
    ctx.restore();
    for (const ky of [-6, 4]) { ctx.beginPath(); ctx.arc(17, ky, 2.6, 0, TAU); ctx.fillStyle = pal.casingDark; ctx.fill(); ctx.lineWidth = 1.4; ctx.stroke(); } // knobs
    ctx.restore();
  }
  ctx.restore();

  if (m && (m.phase === 'active' || (m.anim === 'grab' && m.phase !== 'startup'))) for (const h of info.hitboxes || []) staticShape(ctx, h, pal, rng, t);
  if (expr === 'dizzy') for (let i = 0; i < 3; i++) { const a = t * 4 + i * 2.1; kit.starPath(ctx, Math.cos(a) * 24, -100 + Math.sin(a) * 5, 5, 5, 2, a); ctx.fillStyle = pal.glow; ctx.fill(); }
}

export default {
  rig: 'none',
  bounds: { left: -110, right: 150, top: -200, bottom: 34 },
  palette: PAL,
  palettes: ALT,
  draw(ctx, v, info) { drawGhost(ctx, v, info, info.palette); },

  entities: {
    testPattern: {
      draw(ctx, e, info) {
        const pal = info.palette, a = Math.min(1, e.life / 10, (e.age + 1) / 4);
        ctx.save(); ctx.globalAlpha *= a; ctx.rotate(Math.sin(info.time * 6) * 0.08);
        kit.roundRectPath(ctx, -17, -13, 34, 26, 4); ctx.fillStyle = '#111'; ctx.fill();
        BARS.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-15 + i * (30 / 7), -11, 30 / 7 + 0.4, 15); });
        ctx.fillStyle = '#e8e8e8'; ctx.fillRect(-15, 5, 30, 5);
        kit.roundRectPath(ctx, -17, -13, 34, 26, 4); ctx.lineWidth = 2.5; ctx.strokeStyle = pal.outline; ctx.stroke();
        ctx.strokeStyle = pal.cyan; ctx.lineWidth = 1.5; ctx.strokeRect(-19, -15, 38, 30);
        ctx.restore();
      },
    },
  },

  trail(v) { return v.move && (v.move.anim === 'surf' || v.move.anim === 'fade' || v.move.anim === 'step') ? false : null; },

  fx: {
    onHit(fx, ev, info) {
      const P = info.palette, dmg = ev.damage || 0;
      fx.burst({ x: ev.x, y: ev.y, count: 6 + dmg, shape: 'dot', colors: ['#ffffff', P.main, P.dark], speed: [2, 7], life: [8, 16], size: [2, 3] });
      fx.burst({ x: ev.x, y: ev.y, count: 3, shape: 'spark', colors: [P.cyan, P.magenta], speed: [3, 7], life: [8, 14], blend: 'lighter' });
      if (dmg >= 9) fx.ring({ x: ev.x, y: ev.y, r0: 8, r1: 44, color: P.glow, life: 12, width: 3 });
    },
    onKO(fx, ev, info) {
      fx.flash('#ffffff', 0.2, 3);
      fx.text({ x: ev.x, y: ev.y - 40, text: '- OFF AIR -', size: 16, color: '#ffffff', life: 70 });
      fx.sound('zap', { pitch: 0.5 });
    },
    onRespawn(fx, ev, info) { fx.text({ x: ev.x, y: ev.y - 110, text: 'CH 13', size: 14, color: info.palette.glow, life: 50 }); },
    onEvent: {
      noSignal(fx, ev, info) {
        fx.text({ x: ev.x, y: ev.y - 120, text: 'NO SIGNAL', size: 15, color: '#ff5d6c', outline: '#14091e', life: 45 });
        fx.burst({ x: ev.x, y: ev.y - 50, count: 10, shape: 'dot', colors: ['#ffffff', info.palette.dark], speed: [1, 4], life: [8, 16], size: [2, 4] });
        fx.sound('buzz-thwack', { pitch: 0.7, volume: 0.5 });
      },
      boo(fx, ev, info) { fx.text({ x: ev.x + 30, y: ev.y - 110, text: 'BOO!', size: 22, color: info.palette.face, life: 45 }); fx.shake(2); },
    },
  },
  sounds: { jump: 'whoosh' },

  portrait(ctx, size, info) {
    const k = size / 96;
    ctx.save(); ctx.translate(size / 2, size * 0.98); ctx.scale(k, k);
    drawGhost(ctx, { state: 'idle', move: null }, { ...info, time: 0.5, motion: { squash: 0, stretch: 0, lean: 0 }, rng: kit.seeded(5) }, info.palette);
    ctx.restore();
  },
};
