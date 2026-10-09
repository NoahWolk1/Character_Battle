// Vendy art (rig: none): a cherry-red vending machine with an LED marquee face,
// a lit glass window of snacks, a coin readout that shows the real `coins`
// resource, a spring-loaded boxing glove, and a door that swings as an attack.
import * as kit from '../../../shared/art/kit.js';

const { lerp, clamp, TAU } = kit;
const PAL = {
  main: '#d6303d', dark: '#8e1622', light: '#ff6a6f', side: '#a01d2a', outline: '#2a0a10',
  glass: '#2c4a63', glassLight: '#9fe0ff', chrome: '#d9dde3', chromeDark: '#7d848f', led: '#7dffb0', ledOff: '#123321',
  glove: '#e8343a', coin: '#ffd34d', effect: '#ffe08a', soda: '#5a2a12', foam: '#fff6e6',
};
const ALT = [{ ...PAL, main: '#2f6bd6', dark: '#173c86', light: '#6aa1ff', side: '#20509f', outline: '#0a1430', glove: '#ffb02e' }];
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const W = 70, H = 120, HW = 35;

function can(ctx, x, y, s, c1, c2, pal) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  kit.roundRectPath(ctx, -4, -7, 8, 14, 2);
  ctx.fillStyle = kit.linear(ctx, -4, 0, 4, 0, [kit.shade(c1, 0.3), c1, kit.shade(c1, -0.35)]); ctx.fill();
  ctx.fillStyle = c2; ctx.fillRect(-4, -2, 8, 3);
  ctx.fillStyle = pal.chrome; ctx.fillRect(-4, -7, 8, 1.6);
  ctx.lineWidth = 1; ctx.strokeStyle = pal.outline; kit.roundRectPath(ctx, -4, -7, 8, 14, 2); ctx.stroke();
  ctx.restore();
}
function candyBar(ctx, x, y, s, pal) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(-9, -3); ctx.lineTo(9, -3); ctx.lineTo(11, 0); ctx.lineTo(9, 3); ctx.lineTo(-9, 3); ctx.lineTo(-11, 0); ctx.closePath();
  ctx.fillStyle = '#7a3ccf'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.fillStyle = '#ffd34d'; ctx.fillRect(-4, -2, 8, 4);
  ctx.restore();
}
function chipBag(ctx, x, y, s, pal, t = 0, face = false) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(-10, -14); for (let i = 0; i <= 4; i++) ctx.lineTo(-10 + i * 5, -14 + (i % 2 ? -2 : 0));
  ctx.quadraticCurveTo(13, 0, 10, 14); for (let i = 0; i <= 4; i++) ctx.lineTo(10 - i * 5, 14 + (i % 2 ? 2 : 0));
  ctx.quadraticCurveTo(-13, 0, -10, -14); ctx.closePath();
  ctx.fillStyle = kit.linear(ctx, -10, 0, 10, 0, ['#ffd23a', '#ffb000', '#d98a00']); ctx.fill();
  ctx.lineWidth = 1.6; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.fillStyle = '#e8343a'; ctx.beginPath(); ctx.ellipse(0, 2, 7, 5, 0, 0, TAU); ctx.fill();
  if (face) {
    ctx.fillStyle = '#ffffff';
    for (const ex of [-4, 4]) { ctx.beginPath(); ctx.arc(ex, -6, 2.6, 0, TAU); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = pal.outline; for (const ex of [-3.4, 4.6]) { ctx.beginPath(); ctx.arc(ex, -6, 1.2, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}

/** Spring arm from (ax, ay) to the glove at (gx, gy). */
function springGlove(ctx, ax, ay, gx, gy, r, pal) {
  const dx = gx - ax, dy = gy - ay, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
  ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
  ctx.strokeStyle = pal.chromeDark; ctx.lineWidth = 3;
  ctx.beginPath();
  const coils = Math.max(3, Math.round(len / 7));
  for (let i = 0; i <= coils * 2; i++) { const x = (i / (coils * 2)) * (len - r * 0.6); ctx.lineTo(x, i % 2 ? -5 : 5); }
  ctx.stroke();
  ctx.strokeStyle = pal.chrome; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.translate(len, 0);
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.9, 0, 0, TAU);
  ctx.fillStyle = kit.radial(ctx, -r * 0.3, -r * 0.4, 1, r * 1.2, [kit.shade(pal.glove, 0.35), pal.glove, kit.shade(pal.glove, -0.4)]); ctx.fill();
  ctx.lineWidth = 2.6; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-r * 0.2, -r * 0.62, r * 0.45, r * 0.28, -0.3, 0, TAU); ctx.fillStyle = pal.glove; ctx.fill(); ctx.stroke();  // thumb
  ctx.fillStyle = '#ffffff'; ctx.fillRect(-r - 3, -r * 0.4, 5, r * 0.8); ctx.strokeRect(-r - 3, -r * 0.4, 5, r * 0.8);                       // cuff
  ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(r * 0.1, -r * 0.3, r * 0.35, r * 0.18, -0.4, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.restore();
}

function ledFace(ctx, expr, pal, t, coins) {
  // marquee panel: x -30..30, y -116..-102
  kit.roundRectPath(ctx, -30, -117, 60, 16, 4); ctx.fillStyle = '#0c1410'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.save(); kit.roundRectPath(ctx, -30, -117, 60, 16, 4); ctx.clip();
  const dot = (x, y, on) => { ctx.fillStyle = on ? pal.led : pal.ledOff; ctx.fillRect(x - 1, y - 1, 2, 2); };
  if (expr === 'broken') {
    const msg = 'OUT OF ORDER  ';
    ctx.fillStyle = '#ff5d5d'; ctx.font = 'bold 9px monospace';
    ctx.fillText(msg + msg, -30 - ((t * 40) % 80), -105);
  } else {
    const eye = (cx, mode) => {
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        let on = false;
        if (mode === 'open') on = Math.abs(i) + Math.abs(j) <= 2;
        else if (mode === 'happy') on = j === -Math.abs(i) + 1 && Math.abs(i) <= 2;
        else if (mode === 'angry') on = (j >= -1 && Math.abs(i) <= 2 && j + (cx < 0 ? -i : i) * 0.5 >= -0.5) && j <= 2;
        else if (mode === 'x') on = Math.abs(i) === Math.abs(j);
        else if (mode === 'closed') on = j === 0;
        dot(cx + i * 2.6, -109 + j * 2.6, on);
      }
    };
    const blink = (t % 3.5) < 0.12;
    const mode = expr === 'hurt' ? 'x' : expr === 'angry' ? 'angry' : expr === 'happy' ? 'happy' : blink ? 'closed' : 'open';
    eye(-14, mode); eye(14, mode);
    ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, -14, -109, 10, pal.led, 0.25); kit.glow(ctx, 14, -109, 10, pal.led, 0.25);
  }
  ctx.restore();
}

function drawVendy(ctx, v, info, pal) {
  const t = info.time, m = v.move, st = v.state;
  const mo = info.motion || { squash: 0, stretch: 0, lean: 0 };
  const coins = Math.round(v.resources?.coins ?? 3);
  let rot = 0, pivot = { x: 0, y: 0 }, hop = 0, sx = 1 + mo.squash * 0.1, sy = 1 - mo.squash * 0.1;
  let expr = 'idle', door = 0, flap = 0, glove = null, geyser = 0, shake = 0, crack = false, jets = 0, lightA = 0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7);
  const vib = Math.sin(t * 70) * 0.35;                                 // the compressor hum
  if (st === 'run') { rot = 0.06 + Math.sin(t * 16) * 0.05; pivot = { x: 0, y: 0 }; hop = Math.abs(Math.sin(t * 16)) * 3; }
  if (st === 'hitstun' || st === 'tumble') { expr = 'hurt'; crack = true; rot = -0.2; pivot = { x: 0, y: -60 }; }
  if (st === 'helpless') { expr = 'broken'; lightA = 0.3 + 0.5 * (Math.sin(t * 30) > 0); }
  if (st === 'shield') expr = 'angry';
  if (st === 'crouch') { sy *= 0.82; sx *= 1.06; }
  if (st === 'air' && !v.grounded) rot = clamp((v.vx || 0) * 0.01, -0.08, 0.08);
  if (m) {
    const ph = m.phase, pt = m.phaseT || 0;
    const A = ph === 'startup' || ph === 'charge' ? pt : 0, S = ph === 'active' ? 1 : ph === 'recovery' ? 1 - easeOut(pt) : 0;
    expr = 'angry';
    const h = (m.def?.hitboxes || []).find((b) => b.kind !== 'grab');
    switch (m.anim) {
      case 'glove': if (h) glove = { x: lerp(HW - 4, h.x, S), y: h.y, r: Math.max(12, (h.r || 16) * 0.95), ext: S }; rot = -0.06 * A + 0.05 * S; pivot = { x: -HW, y: 0 }; break;
      case 'door': door = S - 0.3 * A; break;
      case 'hop': hop = 10 * S; sy *= 1 + 0.08 * S - 0.1 * A; break;
      case 'flap': flap = S; break;
      case 'geyser': geyser = S; sy *= 1 - 0.08 * A; break;
      case 'tip': rot = 1.25 * easeOut(Math.min(1, S + 0.6 * A)) * (ph === 'recovery' ? S : 1); pivot = { x: HW, y: 0 }; if (ph === 'startup') rot = -0.12 * A; break;
      case 'shake': shake = 1; break;
      case 'back': rot = -0.15 * S + 0.06 * A; pivot = { x: 0, y: 0 }; break;
      case 'drop': rot = 0; sy *= 1.04; break;
      case 'dispense': flap = ph === 'startup' ? A * 0.5 : S; expr = 'happy'; break;
      case 'broken': expr = 'broken'; shake = 0.6; lightA = 0.4 + 0.5 * (Math.sin(t * 40) > 0); break;
      case 'charge': rot = 0.18 * Math.max(A, S); pivot = { x: HW, y: 0 }; break;
      case 'rocket': jets = ph === 'startup' ? A : S; break;
      case 'restock': expr = 'happy'; door = 0.35; break;
      case 'taunt': expr = 'happy'; hop = Math.abs(Math.sin(t * 9)) * 5; break;
      case 'grab': { const g = m.def?.hitboxes?.[0]; if (g) glove = { x: lerp(HW - 4, g.x + 4, S), y: g.y, r: 14, ext: S }; } break;
      default: break;
    }
    if (shake) rot += Math.sin(t * 60) * 0.07 * shake;
  }

  // soda jets (behind)
  if (jets > 0.02) {
    ctx.save();
    for (const jx of [-18, 18]) {
      const g = kit.linear(ctx, 0, 0, 0, 50, [kit.rgba(PAL.foam, 0.95), kit.rgba(PAL.soda, 0.0)]);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(jx - 8, -2); ctx.lineTo(jx + 8, -2); ctx.lineTo(jx + 14 + Math.sin(t * 40) * 3, 46 * jets); ctx.lineTo(jx - 14, 46 * jets); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(jx + Math.sin(t * 30 + i) * 8, 8 + ((t * 120 + i * 11) % 36), 3, 0, TAU); ctx.fillStyle = PAL.foam; ctx.fill(); }
    }
    ctx.restore();
  }

  ctx.save();
  ctx.translate(vib * 0.4, -hop);
  ctx.translate(pivot.x, pivot.y); ctx.rotate(rot); ctx.translate(-pivot.x, -pivot.y);
  ctx.scale(sx, sy);

  // glove behind the body when retracted is hidden; when extended it draws in front (below)
  // feet
  ctx.fillStyle = '#222'; ctx.fillRect(-30, -4, 12, 4); ctx.fillRect(18, -4, 12, 4);
  // side panel (depth on the back side)
  ctx.beginPath(); ctx.moveTo(-HW, -112); ctx.lineTo(-HW - 7, -106); ctx.lineTo(-HW - 7, -6); ctx.lineTo(-HW, -4); ctx.closePath();
  ctx.fillStyle = pal.side; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = pal.outline; ctx.stroke();
  // cabinet
  kit.roundRectPath(ctx, -HW, -H, W, H - 4, 8);
  ctx.fillStyle = kit.linear(ctx, -HW, -H, HW, 0, [pal.light, pal.main, pal.dark]); ctx.fill();
  ctx.save(); kit.roundRectPath(ctx, -HW, -H, W, H - 4, 8); ctx.clip();
  ctx.fillStyle = kit.rgba('#ffffff', 0.22); ctx.fillRect(-HW, -H, W, 3);                                 // top rim light
  ctx.fillStyle = kit.rgba(info.light?.rim || '#ffc48a', 0.35); ctx.fillRect(-HW, -H, 3, H);             // lit edge
  ctx.restore();
  kit.roundRectPath(ctx, -HW, -H, W, H - 4, 8); ctx.lineWidth = 3; ctx.strokeStyle = pal.outline; ctx.stroke();
  ledFace(ctx, expr, pal, t, coins);

  // window (x -30..12, y -98..-30): lit shelves of snacks
  const wx = -30, wy = -98, ww = 42, wh = 66;
  ctx.save();
  kit.roundRectPath(ctx, wx, wy, ww, wh, 3); ctx.fillStyle = pal.glass; ctx.fill(); ctx.clip();
  ctx.globalAlpha = lightA; ctx.fillStyle = kit.linear(ctx, 0, wy, 0, wy + wh, [kit.rgba(pal.glassLight, 0.45), kit.rgba(pal.glassLight, 0.1)]); ctx.fillRect(wx, wy, ww, wh);
  ctx.globalAlpha = 1;
  for (let r = 0; r < 3; r++) {
    const y = wy + 18 + r * 21;
    ctx.fillStyle = pal.chromeDark; ctx.fillRect(wx, y + 1, ww, 2);
    for (let c = 0; c < 3; c++) {
      const x = wx + 8 + c * 13, b = Math.sin(t * 2 + r + c) * 0.4;
      ctx.strokeStyle = pal.chrome; ctx.lineWidth = 1; ctx.beginPath(); for (let k = 0; k < 6; k++) ctx.lineTo(x - 5 + k * 2, y - 2 + (k % 2) * 3); ctx.stroke();
      if (r === 0) can(ctx, x, y - 8 + b, 0.9, c === 1 ? '#2f8f4e' : '#c42a2a', '#ffffff', pal);
      else if (r === 1) candyBar(ctx, x, y - 4 + b, 0.55, pal);
      else chipBag(ctx, x, y - 8 + b, 0.38, pal);
    }
  }
  ctx.fillStyle = kit.rgba('#ffffff', 0.28);                                                             // glass glare
  ctx.beginPath(); ctx.moveTo(wx + 4, wy); ctx.lineTo(wx + 14, wy); ctx.lineTo(wx + 2, wy + wh); ctx.lineTo(wx - 8, wy + wh); ctx.fill();
  if (crack) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(wx + 26, wy + 20); ctx.lineTo(wx + 18, wy + 32); ctx.lineTo(wx + 30, wy + 40); ctx.moveTo(wx + 18, wy + 32); ctx.lineTo(wx + 8, wy + 30); ctx.stroke(); }
  ctx.restore();
  kit.roundRectPath(ctx, wx, wy, ww, wh, 3); ctx.lineWidth = 2.5; ctx.strokeStyle = pal.outline; ctx.stroke();

  // control column: coin readout (real resource), keypad, slot
  kit.roundRectPath(ctx, 16, -97, 15, 11, 2); ctx.fillStyle = '#0c1410'; ctx.fill(); ctx.stroke();
  ctx.fillStyle = pal.coin; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillText(String(coins), 23.5, -88.5);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { ctx.fillStyle = (i + j + Math.floor(t * 3)) % 7 === 0 ? pal.led : pal.chrome; ctx.fillRect(17 + i * 5, -80 + j * 5, 3.5, 3.5); }
  kit.roundRectPath(ctx, 19, -58, 9, 14, 2); ctx.fillStyle = pal.chromeDark; ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#111'; ctx.fillRect(22.5, -56, 2, 10);
  // delivery flap (opens on Coin Return / Dispense)
  ctx.save();
  ctx.translate(-26, -26);
  ctx.fillStyle = '#16181c'; ctx.fillRect(0, 0, 44, 16);
  ctx.transform(1, 0, 0, Math.cos(flap * 1.3), 0, 0);
  kit.roundRectPath(ctx, 0, 0, 44, 16, 2); ctx.fillStyle = kit.linear(ctx, 0, 0, 0, 16, [pal.chrome, pal.chromeDark]); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.fillStyle = pal.outline; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('PUSH', 22, 10);
  ctx.restore();
  // swinging glass door (Door Swing): hinge on the front edge
  if (door > 0.02) {
    ctx.save();
    ctx.translate(HW, -98);
    const open = clamp(door, 0, 1);
    const dw = 54 * Math.max(0.08, Math.sin(open * 1.45));             // door width seen edge-on → face-on
    kit.roundRectPath(ctx, 0, 0, dw, 72, 3);
    ctx.fillStyle = kit.linear(ctx, 0, 0, dw, 0, [kit.rgba(pal.glassLight, 0.75), kit.rgba(pal.glass, 0.85)]); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = pal.main; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; kit.roundRectPath(ctx, -2, -2, dw + 4, 76, 4); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.6; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(Math.max(8, dw * 0.5), 34); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  if (glove && glove.ext > 0.02) springGlove(ctx, HW - 6, glove.y, glove.x, glove.y, glove.r, pal);
  if (geyser > 0.02) {
    const top = -H - 80 * geyser;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(-16, -H); ctx.bezierCurveTo(-26, (top - H) / 2, -30, top, 0, top - 10); ctx.bezierCurveTo(30, top, 26, (top - H) / 2, 16, -H); ctx.closePath();
    ctx.fillStyle = kit.linear(ctx, 0, top, 0, -H, [PAL.foam, '#c9873e', PAL.soda]); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = pal.outline; ctx.stroke();
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(Math.sin(i * 2.1 + t * 9) * 18, top + 4 + i * 10, 5 - i * 0.4, 0, TAU); ctx.fillStyle = PAL.foam; ctx.fill(); }
    ctx.restore();
  }
  if (expr === 'broken' && m) for (let i = 0; i < 3; i++) kit.lightning(ctx, info.rng || kit.seeded(i + 1), 0, -100, Math.sin(i * 2.2) * 50, -60 + i * 20, '#9fe8ff', 2, 0.9, { core: '#ffffff' });
  if (m && m.phase === 'active' && (m.anim === 'flap' || m.anim === 'shake')) for (const h of info.hitboxes || []) { kit.shapeGlow(ctx, h, pal.effect, 0.5); ctx.save(); ctx.globalAlpha = 0.6; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; kit.shapePath(ctx, h, 1); ctx.stroke(); ctx.restore(); }
  if (m && m.anim === 'flap' && m.phase === 'active') for (let i = 0; i < 5; i++) { const x = 30 + i * 9, y = -10 - Math.abs(Math.sin(t * 9 + i)) * 6; ctx.beginPath(); ctx.ellipse(x, y, 4.5, 4.5, 0, 0, TAU); ctx.fillStyle = pal.coin; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = pal.outline; ctx.stroke(); }
}

export default {
  rig: 'none',
  bounds: { left: -100, right: 200, top: -280, bottom: 60 },
  palette: PAL,
  palettes: ALT,
  draw(ctx, v, info) { drawVendy(ctx, v, info, info.palette); },

  entities: {
    soda: { draw(ctx, e, info) { ctx.rotate(e.age * 0.35); can(ctx, 0, 0, 1.6, '#c42a2a', '#ffffff', info.palette); } },
    candy: {
      draw(ctx, e, info) {
        const a = Math.min(1, e.life / 20);
        ctx.save(); ctx.globalAlpha *= a; candyBar(ctx, 0, -5, 1.6, info.palette);
        ctx.globalAlpha *= 0.5 + 0.5 * Math.sin(info.time * 6); kit.glow(ctx, 0, -5, 16, '#ffd34d', 0.3); ctx.restore();
      },
    },
    chips: {
      draw(ctx, e, info) {
        const t = info.time, step = Math.sin(t * 14 + e.id);
        ctx.strokeStyle = info.palette.outline; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(-5 + step * 4, 0); ctx.moveTo(5, -4); ctx.lineTo(5 - step * 4, 0); ctx.stroke();
        chipBag(ctx, 0, -17, 1.05, info.palette, t, true);
        if (e.lifeT < 0.2) { ctx.globalAlpha = Math.sin(t * 30) > 0 ? 0.6 : 0; kit.glow(ctx, 0, -16, 24, '#ffffff', 0.7); }
      },
    },
    chipBurst: {
      draw(ctx, e, info) {
        const k = clamp(e.age / 14, 0, 1);
        ctx.save(); ctx.globalAlpha = 1 - k;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU, r = 10 + k * 40;
          ctx.save(); ctx.translate(Math.cos(a) * r, -16 + Math.sin(a) * r); ctx.rotate(a + k * 5);
          ctx.beginPath(); ctx.ellipse(0, 0, 6, 4, 0, 0, TAU); ctx.fillStyle = '#ffcf3a'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = info.palette.outline; ctx.stroke();
          ctx.restore();
        }
        kit.glow(ctx, 0, -16, 40 * (0.5 + k), '#fff2b0', 0.5);
        ctx.restore();
      },
    },
  },

  fx: {
    onHit(fx, ev, info) {
      const P = info.palette, dmg = ev.damage || 0;
      if (ev.effect === 'soda') fx.burst({ x: ev.x, y: ev.y, count: 8 + dmg, shape: 'drip', colors: [P.foam, '#c9873e'], speed: [2, 6], gravity: 0.3, life: [14, 24], size: [2, 4] });
      else if (ev.effect === 'chips' || ev.effect === 'candy') fx.burst({ x: ev.x, y: ev.y, count: 8, shape: 'debris', colors: ['#ffcf3a', '#e8343a'], speed: [2, 6], gravity: 0.3, life: [14, 24], size: [2, 4] });
      else fx.burst({ x: ev.x, y: ev.y, count: 6 + dmg, shape: 'star', colors: [P.coin, '#ffffff'], speed: [2, 7], life: [10, 20], size: [3, 5] });
      if (dmg >= 12) { fx.shake(4); fx.ring({ x: ev.x, y: ev.y, r0: 10, r1: 60, color: P.coin, life: 14, width: 4 }); }
    },
    onLand(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 2, count: ev.heavy ? 10 : 5, shape: 'smoke', colors: ['#d8c8b0', '#ffffff'], speed: [1, 3], angle: 90, spread: 160, life: [16, 26], size: [6, 12] }); if (ev.heavy) fx.shake(3); },
    onKO(fx, ev, info) {
      fx.burst({ x: ev.x, y: ev.y, count: 20, shape: 'star', colors: [info.palette.coin, '#ffffff'], speed: [3, 10], gravity: 0.25, life: [24, 40], size: [3, 6] });
      fx.text({ x: ev.x, y: ev.y - 40, text: 'SOLD OUT', size: 18, color: '#ff5d5d', life: 70 });
    },
    onEvent: {
      dispense(fx, ev, info) { fx.sound('clank', { pitch: 1.2 }); fx.text({ x: ev.x, y: ev.y - 140, text: String(ev.data?.p || '').toUpperCase() + '!', size: 14, color: info.palette.led, life: 40 }); },
      outOfOrder(fx, ev) { fx.sound('buzz-thwack', { pitch: 0.6 }); fx.burst({ x: ev.x, y: ev.y - 100, count: 8, shape: 'spark', colors: ['#9fe8ff', '#ffffff'], speed: [2, 6], life: [8, 14], blend: 'lighter' }); },
      restock(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 70, count: 6, shape: 'star', color: info.palette.coin, speed: [1, 3], angle: 90, spread: 60, life: [16, 26], size: [3, 5] }); fx.sound('chime'); },
      crunch(fx, ev) { fx.sound('crunch'); fx.shake(2); },
      jingle(fx, ev, info) { fx.sound('chime', { pitch: 1.5 }); fx.text({ x: ev.x, y: ev.y - 140, text: 'EXACT CHANGE ONLY', size: 12, color: info.palette.led, life: 60 }); },
    },
  },
  sounds: { jump: 'boing' },

  portrait(ctx, size, info) {
    const k = size / 132;
    ctx.save(); ctx.translate(size / 2 + 2 * k, size * 0.97); ctx.scale(k, k);
    drawVendy(ctx, { state: 'idle', move: null, resources: { coins: 3 } }, { ...info, time: 0.5, motion: { squash: 0, stretch: 0, lean: 0 } }, info.palette);
    ctx.restore();
  },
};
