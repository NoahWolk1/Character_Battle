// Checkmate art: carved-marble chess pieces (lathe profiles with value tiers and a rim
// light). The king hops like a piece moved across the board, a floating scepter strikes
// into the hitboxes, and drawBack paints the board square he stands on.
import * as kit from '../../../shared/art/kit.js';

const C = { marble: '#efe6d2', vein: '#b8a88a', outline: '#3a2e22', gold: '#e0b040', ruby: '#d0283a', ebony: '#2a2430', eye: '#2a1e14' };

/** Lathe-turned piece outline: profile [[radius, y], …] from the base up, mirrored around x = 0. */
function lathe(ctx, prof) {
  ctx.beginPath();
  prof.forEach(([r, y], i) => (i ? ctx.lineTo(r, y) : ctx.moveTo(r, y)));
  for (let i = prof.length - 1; i >= 0; i--) ctx.lineTo(-prof[i][0], prof[i][1]);
  ctx.closePath();
}

/** Is a palette color dark (ebony pieces get light veins and glowing eyes)? */
function isDark(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  if (!Number.isFinite(n)) return false;
  return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255 < 0.4;
}

function marble(ctx, color, info, x, y, r) {
  kit.fillShaded(ctx, color, { outline: C.outline, lineWidth: 3, x, y, r, light: 0.18, dark: -0.28, gloss: 0.25 });
  ctx.save(); ctx.clip();
  ctx.strokeStyle = isDark(color) ? kit.rgba('#c8b8e8', 0.3) : kit.rgba(C.vein, 0.35); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x - r, y - r * 0.2); ctx.bezierCurveTo(x - r * 0.3, y - r * 0.6, x + r * 0.2, y + r * 0.3, x + r, y - r * 0.4); ctx.stroke();
  ctx.restore();
}

const KING = [[28, 0], [28, -8], [20, -14], [22, -20], [14, -26], [11, -56], [18, -62], [18, -67], [10, -70], [14, -86], [16, -96], [0, -98]];
const PAWN = [[13, 0], [13, -5], [9, -8], [10, -11], [6, -14], [5, -24], [9, -27], [6, -29], [0, -29]];
const QUEEN = [[15, 0], [15, -5], [10, -9], [11, -12], [7, -16], [5, -38], [10, -42], [7, -45], [0, -45]];

function king(ctx, v, info) {
  const P = info.palette, t = info.time;
  // hop: pieces "move" by hopping; squash on landing
  const hop = v.state === 'run' ? -Math.abs(Math.sin(t * 9)) * 9 : 0;
  const sq = info.motion.squash;
  const m = v.move;
  let tilt = info.motion.lean * 0.08;
  if (m) {
    const p = m.phase === 'startup' || m.phase === 'charge' ? -m.phaseT : m.phase === 'active' ? 1 : 1 - m.phaseT;
    if (['decree', 'mate', 'arc', 'tap'].includes(m.anim)) tilt += 0.18 * p;
    if (m.anim === 'rebuff') tilt -= 0.25 * p;
    if (m.anim === 'spinboard' && m.phase === 'active') tilt += m.phaseT * Math.PI * 2;
  }
  ctx.save();
  ctx.translate(0, hop);
  ctx.translate(0, -50); ctx.rotate(tilt); ctx.translate(0, 50);
  ctx.scale(1 + sq * 0.12, 1 - sq * 0.15);
  lathe(ctx, KING);
  marble(ctx, P.main, info, 0, -50, 50);
  kit.rimLight(ctx, [[-27, -6], [-13, -30], [-11, -56], [-15, -88]], info.light.rim, 2.5, 0.6);
  // collar + gold band
  ctx.fillStyle = P.accent || C.gold; ctx.fillRect(-15, -66, 30, 4); ctx.strokeStyle = C.outline; ctx.lineWidth = 1.5; ctx.strokeRect(-15, -66, 30, 4);
  // face: carved stern eyes and a royal mustache
  const blink = (t * 0.3) % 1 > 0.965 ? 0.2 : 1;
  const angry = m && m.phase !== 'recovery';
  const dark = isDark(P.main);
  const eye = dark ? '#ffd86a' : C.eye, line = dark ? kit.shade(P.main, 0.5) : C.outline;
  if (dark) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, 3, -82, 16, '#ffb03a', 0.3); ctx.restore(); }
  for (const ex of [-1, 1]) {
    kit.ellipse(ctx, ex * 5 + 3, -82, 2.2, 3 * blink, eye);
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ex * 9 + 3, -88 + (angry ? ex * -1.5 : 0)); ctx.lineTo(ex * 2 + 3, -87); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(3, -76); ctx.quadraticCurveTo(-6, -71, -11, -76); ctx.quadraticCurveTo(-4, -74, 3, -76); ctx.quadraticCurveTo(10, -74, 17, -76); ctx.quadraticCurveTo(12, -71, 3, -76);
  ctx.fillStyle = dark ? kit.shade(P.main, 0.45) : kit.shade(C.vein, -0.3); ctx.fill();
  // crown with cross
  ctx.beginPath(); ctx.moveTo(-16, -96); ctx.lineTo(-18, -110); ctx.lineTo(-8, -102); ctx.lineTo(0, -114); ctx.lineTo(8, -102); ctx.lineTo(18, -110); ctx.lineTo(16, -96); ctx.closePath();
  kit.fillShaded(ctx, C.gold, { outline: C.outline, lineWidth: 2.5, x: 0, y: -104, r: 16, gloss: 0.5 });
  kit.roundRectPath(ctx, -3, -128, 6, 16, 1.5); kit.fillShaded(ctx, C.gold, { outline: C.outline, lineWidth: 2, x: 0, y: -120, r: 8 });
  kit.roundRectPath(ctx, -8, -124, 16, 5, 1.5); kit.fillShaded(ctx, C.gold, { outline: C.outline, lineWidth: 2, x: 0, y: -122, r: 8 });
  kit.circle(ctx, 0, -105, 2.6, C.ruby, { outline: C.outline, lineWidth: 1 });
  ctx.restore();
}

function scepter(ctx, v, info) {
  const m = v.move, t = info.time;
  let pos = { x: 34, y: -60 + Math.sin(t * 2.6) * 4 }, ang = -1.1 + Math.sin(t * 1.3) * 0.1;
  if (m) {
    const hb = info.hitboxes[0];
    if (m.phase === 'active' && hb) { const c = kit.shapeCenter(hb); ang = Math.atan2(c.y + 60, c.x) * 0.6; pos = { x: c.x - Math.cos(ang) * 30, y: c.y - Math.sin(ang) * 30 }; }
    else if (m.phase === 'startup' || m.phase === 'charge') { pos = { x: 30 - 22 * m.phaseT, y: -70 - 18 * m.phaseT }; ang = -2 * m.phaseT - 0.6; }
  }
  ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(ang);
  kit.capsulePath(ctx, -30, 0, 22, 0, 3.6);
  kit.fillShaded(ctx, C.gold, { outline: C.outline, lineWidth: 2, x: 0, y: 0, r: 26 });
  for (const x of [-30, -6]) { kit.roundRectPath(ctx, x - 2, -5, 4, 10, 1.5); kit.fillShaded(ctx, C.gold, { outline: C.outline, lineWidth: 1.5, x, y: 0, r: 6 }); }
  kit.starPath(ctx, 30, 0, 4, 13, 5, 0); kit.fillShaded(ctx, C.gold, { outline: C.outline, lineWidth: 1.5, x: 30, y: 0, r: 12, gloss: 0.5 });
  kit.circle(ctx, 30, 0, 7, C.ruby, { outline: C.outline, lineWidth: 2, gloss: 0.6 });
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, 30, 0, m && m.phase === 'active' ? 34 : 14, C.ruby, m && m.phase === 'active' ? 0.6 : 0.35); ctx.restore();
  ctx.restore();
}

function piece(ctx, prof, color, info, h, opts = {}) {
  lathe(ctx, prof);
  marble(ctx, color, info, 0, -h / 2, h);
  if (opts.eyes !== false) for (const ex of [-1, 1]) kit.ellipse(ctx, ex * 2.6 + 1.5, -h * 0.72, 1.1, 1.6, isDark(color) ? '#ffd86a' : C.eye);
}

export default {
  rig: 'none',
  bounds: { left: -110, right: 150, top: -200, bottom: 56 },
  // Ebony by default (reads against the bright sunset stage); ivory for the duplicate pick.
  palette: { main: C.ebony, accent: C.gold, effect: '#ffe7a0', outline: '#0e0a12' },
  palettes: [{}, { main: C.marble, effect: '#b48aff' }, { main: '#6a2a3a' }, { main: '#2a4a6a' }],

  draw(ctx, v, info) {
    king(ctx, v, info);
    scepter(ctx, v, info);
    // promotion progress: gold pips above the crown
    const promo = v.vars?.promo ?? 0;
    for (let i = 0; i < 3; i++) kit.circle(ctx, -10 + i * 10, -140, 3, i < promo ? C.gold : kit.rgba('#000000', 0.25), { outline: i < promo ? C.outline : null, lineWidth: 1 });
    if (v.move?.phase === 'active') for (const hb of info.hitboxes) kit.shapeGlow(ctx, hb, info.palette.effect, 0.14);
  },

  // The board square under the king (world space, behind every fighter).
  drawBack(ctx, v, info) {
    if (!v.grounded) return;
    ctx.save();
    ctx.globalAlpha *= 0.22;
    ctx.transform(1, 0, 0, 0.3, 0, 0);
    for (let i = -3; i < 3; i++) for (let j = -1; j < 1; j++) { ctx.fillStyle = (i + j) % 2 ? '#2a2430' : '#efe6d2'; ctx.fillRect(i * 20, j * 20, 20, 20); }
    ctx.restore();
  },

  trail(v, info) { return info.phase.name === 'active' && info.hitboxes[0] ? kit.shapeCenter(info.hitboxes[0]) : false; },

  entities: {
    pawn: {
      draw(ctx, e, info) {
        const march = Math.abs(Math.sin(e.age * 0.25)) * 3;
        ctx.save(); ctx.translate(0, -march); ctx.scale(1.35, 1.35);
        piece(ctx, PAWN, info.palette.main, info, 29);
        // little spear
        ctx.strokeStyle = C.outline; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(8, -6); ctx.lineTo(14, -30); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(14, -34); ctx.lineTo(12, -28); ctx.lineTo(16, -29); ctx.closePath(); ctx.fillStyle = '#c0c8d0'; ctx.fill();
        ctx.restore();
        if (e.hp !== null && e.hp < 6) { ctx.strokeStyle = kit.rgba('#000', 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-4, -30); ctx.lineTo(1, -22); ctx.lineTo(-3, -14); ctx.stroke(); }
      },
    },
    queen: {
      draw(ctx, e, info) {
        const bob = Math.sin(info.time * 3 + e.seed) * 3;
        ctx.save(); ctx.translate(0, bob);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, 0, -28, 40, '#b48aff', 0.35); ctx.restore();
        ctx.scale(1.25, 1.25);
        piece(ctx, QUEEN, info.palette.main, info, 45);
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) { const x = -9 + i * 3; ctx.lineTo(x, i % 2 ? -50 : -56); }
        ctx.lineTo(9, -45); ctx.lineTo(-9, -45); ctx.closePath();
        kit.fillShaded(ctx, C.gold, { outline: C.outline, lineWidth: 1.6, x: 0, y: -50, r: 8, gloss: 0.5 });
        ctx.fillStyle = '#7a3ab4'; ctx.fillRect(-6, -36, 12, 3);
        ctx.restore();
      },
    },
    rook: {
      draw(ctx, e, info) {
        ctx.save(); ctx.globalAlpha *= Math.min(1, e.lifeT * 5);
        kit.roundRectPath(ctx, -17, -46, 34, 46, 3);
        marble(ctx, info.palette.main, info, 0, -24, 30);
        ctx.beginPath(); for (let i = 0; i < 4; i++) ctx.rect(-19 + i * 10, -54, 7, 9);
        marble(ctx, info.palette.main, info, 0, -50, 20);
        ctx.restore();
      },
    },
  },

  fx: {
    onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 7, shape: 'debris', colors: ['#efe6d2', '#b8a88a'], speed: [2, 6], gravity: 0.35, life: [16, 26] }); },
    onEvent: {
      deploy(fx, ev) { fx.burst({ x: ev.x + 46, y: ev.y - 10, count: 8, shape: 'smoke', color: '#efe6d2', speed: [1, 3], life: [14, 22] }); fx.sound('clank', { pitch: 1.4 }); },
      crowned(fx, ev) { fx.ring({ x: ev.x, y: ev.y - 30, r0: 10, r1: 70, color: '#b48aff', life: 18 }); fx.text({ x: ev.x, y: ev.y - 90, text: 'PROMOTED!', color: '#e0b040', life: 50, size: 14 }); fx.sound('chime'); },
      advance(fx, ev) { fx.text({ x: ev.x, y: ev.y - 150, text: 'Advance!', color: '#ffffff', life: 36, size: 14 }); },
      hold(fx, ev) { fx.text({ x: ev.x, y: ev.y - 150, text: 'Hold the line!', color: '#ffffff', life: 36, size: 14 }); },
      castle(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 40, count: 10, shape: 'spark', color: '#e0b040', speed: [2, 5], life: [10, 18] }); fx.sound('whoosh'); },
      pawnTaken(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 20, count: 12, shape: 'debris', color: '#efe6d2', speed: [2, 6], gravity: 0.4, life: [20, 34] }); },
      check(fx, ev) { fx.text({ x: ev.x, y: ev.y - 150, text: 'Check.', color: '#e0b040', life: 50, size: 16 }); },
    },
  },
};
