// Echo art (rig: none): a violet bell-cloak with a shouting mask and two floating
// hands. Strikes put the lead hand inside the active hitbox (startup = wind-up,
// active = strike + sound arcs, recovery = return). The clone is the same art
// drawn again through info.drawSelf in a cyan "delayed" palette.
import * as kit from '../../../shared/art/kit.js';

const { lerp, clamp, TAU } = kit;
const PAL = {
  main: '#4a2d82', dark: '#2a1650', light: '#7a55c4', rim: '#e2b8ff', outline: '#1a0d33',
  mask: '#f4ead6', maskShade: '#c4ae8e', glow: '#6ff0e6', effect: '#9ff7ee', hand: '#efe4ff',
};
const GHOST = {
  main: '#2f7f86', dark: '#16474f', light: '#5fc9c7', rim: '#c8fff8', outline: '#0b2a30',
  mask: '#dffbf6', maskShade: '#9fd3cb', glow: '#ff9cf0', effect: '#ffc4f6', hand: '#e8fffb',
};
const ALT = [{ ...PAL, main: '#8a2d4e', dark: '#4e1428', light: '#c75a7e', rim: '#ffd0de', outline: '#2a0816' }];

const easeOut = (t) => 1 - (1 - t) * (1 - t);

/** Rim light inside any path builder: the shape minus itself shifted away from the light. */
function rim(ctx, build, dir, color, w = 3, alpha = 0.55) {
  ctx.save();
  build(ctx, true); ctx.clip();
  ctx.beginPath(); ctx.rect(-1e4, -1e4, 2e4, 2e4);
  ctx.translate(-dir.x * w, -dir.y * w);
  build(ctx, false);
  ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.fill('evenodd');
  ctx.restore();
}
const REST_FRONT = { x: 24, y: -36 }, REST_BACK = { x: -20, y: -42 };

/** Far point of a hit shape (the striking tip). */
function tipOf(s) {
  const k = kit.shapeKind(s);
  if (k === 'capsule') return Math.hypot(s.x2, s.y2 + 40) >= Math.hypot(s.x1, s.y1 + 40) ? { x: s.x2, y: s.y2, r: s.r } : { x: s.x1, y: s.y1, r: s.r };
  if (k === 'rect') return { x: s.x + Math.sign(s.x || 1) * s.w * 0.3, y: s.y, r: Math.min(s.w, s.h) / 2 };
  return { x: s.x, y: s.y, r: s.r };
}

/** Lead-hand target + extension (0..1) for the current move, from the validated def. */
function strike(v) {
  const m = v.move;
  if (!m || !m.def) return null;
  const h = (m.def.hitboxes || []).find((b) => b.kind !== 'absorb') || null;
  if (!h) return null;
  const tip = tipOf(h);
  const pt = m.phaseT || 0;
  const ext = m.phase === 'active' ? 1 : m.phase === 'recovery' ? 1 - easeOut(pt) : m.phase === 'startup' || m.phase === 'charge' ? -0.35 * pt : 0;
  return { tip, ext, phase: m.phase, pt };
}

function handAt(ctx, x, y, r, pal, glow, open = 0) {
  if (glow > 0) kit.glow(ctx, x, y, r * 2.4, pal.glow, 0.45 * glow);
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * (0.9 + open * 0.2), 0, 0, TAU);
  ctx.fillStyle = kit.radial(ctx, -r * 0.3, -r * 0.4, 0, r * 1.2, [pal.hand, kit.shade(pal.hand, -0.22)]);
  ctx.fill();
  ctx.lineWidth = 2.6; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(r * 0.75, -r * 0.35, r * 0.38, r * 0.3, -0.5, 0, TAU);   // thumb
  ctx.fillStyle = pal.hand; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.3, r * 0.3, Math.PI * 1.1, Math.PI * 1.7);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.globalAlpha *= 0.8; ctx.stroke();
  ctx.restore();
}

/** Sound arcs fanning out from a point, facing +x (or angle). */
function soundArcs(ctx, x, y, r, pal, t, a = 1, ang = 0, n = 3) {
  if (a <= 0.01) return;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const k = (i + ((t * 3) % 1)) / n;
    const rr = r * (0.35 + 0.75 * k);
    ctx.globalAlpha = a * (1 - k) * 0.95;
    ctx.strokeStyle = i % 2 ? pal.glow : '#ffffff';
    ctx.lineWidth = 4 - k * 2;
    ctx.beginPath(); ctx.arc(-r * 0.3, 0, rr, -0.85, 0.85); ctx.stroke();
  }
  ctx.restore();
}

/** Cloak path: hood peak at top, bell hem with scallops. */
function cloakPath(ctx, o, t, begin = true) {
  const top = -84 * o.sy, hem = -4, w = 30 * o.sx, sway = o.sway;
  if (begin) ctx.beginPath();
  ctx.moveTo(o.peak, top);
  ctx.bezierCurveTo(16 * o.sx, top + 2, 22 * o.sx, -60, 21 * o.sx, -44 * o.sy);
  ctx.bezierCurveTo(22 * o.sx, -24, w + 2 + sway, hem - 8, w + sway, hem);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const x0 = lerp(w, -w, i / n) + sway, x1 = lerp(w, -w, (i + 1) / n) + sway;
    const d = 5 + Math.sin(t * 5 + i * 1.7) * 2;
    ctx.quadraticCurveTo((x0 + x1) / 2, hem + d, x1, hem);
  }
  ctx.bezierCurveTo(-w - 2 + sway, hem - 8, -22 * o.sx, -24, -21 * o.sx, -44 * o.sy);
  ctx.bezierCurveTo(-22 * o.sx, -66, -14 * o.sx, top + 4, o.peak, top);
  ctx.closePath();
}

function drawEcho(ctx, v, info, pal) {
  const t = info.time, m = v.move, st = v.state;
  const mo = info.motion || { squash: 0, stretch: 0, lean: 0 };
  const bob = Math.sin(t * 2.6) * 2.2;
  const o = { sx: 1 + mo.squash * 0.18 - mo.stretch * 0.08, sy: 1 - mo.squash * 0.16 + mo.stretch * 0.1, sway: -mo.lean * 6, peak: -4 - mo.lean * 6, tilt: mo.lean * 0.08 };
  let expr = 'calm', open = 0.25, glowAmt = 0.4, front = { ...REST_FRONT }, back = { ...REST_BACK };
  const s = strike(v);
  if (st === 'crouch') { o.sy *= 0.78; o.sx *= 1.12; }
  if (st === 'hitstun' || st === 'tumble') { expr = 'hurt'; o.tilt = -0.25; front = { x: 30, y: -66 }; back = { x: -28, y: -64 }; }
  if (st === 'helpless') { expr = 'dizzy'; glowAmt = 0.1; }
  if (st === 'shield') { front = { x: 14, y: -48 }; back = { x: 10, y: -32 }; expr = 'calm'; }
  if (st === 'run') { o.tilt += 0.12; back = { x: -30, y: -30 }; }
  if (st === 'grabbing') { front = { x: 38, y: -40 }; back = { x: 30, y: -34 }; }
  if (s) {
    expr = s.phase === 'startup' || s.phase === 'charge' ? 'focus' : 'shout';
    open = s.phase === 'active' ? 1 : s.phase === 'recovery' ? 1 - s.pt : 0.4;
    const target = s.ext >= 0 ? { x: lerp(REST_FRONT.x, s.tip.x, s.ext), y: lerp(REST_FRONT.y, s.tip.y, s.ext) }
      : { x: REST_FRONT.x + (REST_FRONT.x - s.tip.x) * -s.ext * 0.6, y: REST_FRONT.y + (REST_FRONT.y - s.tip.y) * -s.ext * 0.3 };
    if (s.tip.x < -5) back = target; else front = target;
    if (m.anim === 'clapUp' || m.anim === 'clap' || m.anim === 'boom') back = { x: target.x - 10, y: target.y + 6 };
    o.tilt += s.ext * 0.1 * Math.sign(s.tip.x || 1);
    glowAmt = 0.4 + 0.6 * Math.max(0, s.ext);
  }
  if (m && (m.anim === 'shout' || m.anim === 'hello' || m.anim === 'hum' || m.anim === 'split')) {
    expr = 'shout'; open = m.phase === 'startup' ? 0.5 * m.phaseT : 1;
    front = { x: 16, y: -66 }; back = { x: -14, y: -58 };
  }
  if (m && m.anim === 'rise') { o.sy *= 1.15; o.sx *= 0.9; front = { x: 12, y: -96 }; back = { x: -12, y: -94 }; }

  // ripples under the hem (it hovers a hair above the floor)
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const k = ((t * 0.9 + i / 3) % 1);
    ctx.globalAlpha = (1 - k) * 0.55;
    ctx.strokeStyle = pal.glow; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 10 + k * 26, 2 + k * 4, 0, 0, TAU); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(0, bob - 2);
  ctx.rotate(o.tilt);
  handAt(ctx, back.x, back.y, 8.5, { ...pal, hand: kit.shade(pal.hand, -0.12) }, glowAmt * 0.6);
  // cloak: 3 value tiers + rim + outline
  cloakPath(ctx, o, t);
  ctx.fillStyle = kit.linear(ctx, -20, -80, 20, 0, [pal.light, pal.main, pal.dark]);
  ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = kit.rgba(pal.dark, 0.55);                       // fold shadows
  for (const fx of [-14, 4, 18]) { ctx.beginPath(); ctx.ellipse(fx + o.sway * 0.5, -18, 4, 22, 0.05 * fx / 10, 0, TAU); ctx.fill(); }
  ctx.restore();
  rim(ctx, (c, b) => cloakPath(c, o, t, b), info.light?.dir || { x: -0.5, y: -0.85 }, pal.rim, 3, 0.55);
  cloakPath(ctx, o, t);
  ctx.lineWidth = 3; ctx.strokeStyle = pal.outline; ctx.lineJoin = 'round'; ctx.stroke();
  // hood opening + mask
  const mx = 5, my = -60 * o.sy;
  ctx.beginPath(); ctx.ellipse(mx, my, 15, 18, 0, 0, TAU); ctx.fillStyle = pal.outline; ctx.fill();
  ctx.save();
  ctx.translate(mx + 1, my + 1);
  if (expr === 'hurt') ctx.rotate(-0.3);
  ctx.beginPath(); ctx.ellipse(0, 0, 11.5, 14, 0, 0, TAU);
  ctx.fillStyle = kit.radial(ctx, -4, -6, 1, 16, [pal.mask, pal.maskShade]); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.fillStyle = pal.outline;
  if (expr === 'hurt' || expr === 'dizzy') {
    ctx.lineWidth = 2;
    for (const ex of [-4.5, 4.5]) { ctx.beginPath(); ctx.moveTo(ex - 2.5, -6.5); ctx.lineTo(ex + 2.5, -1.5); ctx.moveTo(ex + 2.5, -6.5); ctx.lineTo(ex - 2.5, -1.5); ctx.stroke(); }
  } else {
    const squint = expr === 'focus' ? 0.5 : 1;
    for (const ex of [-4.5, 4.5]) { ctx.beginPath(); ctx.ellipse(ex, -4, 1.9, 3.4 * squint, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = pal.glow;
    for (const ex of [-4.5, 4.5]) { ctx.beginPath(); ctx.arc(ex, -4.4, 0.9, 0, TAU); ctx.fill(); }
  }
  const mr = 1.8 + open * 3.6;                                   // the "O" mouth
  ctx.beginPath(); ctx.ellipse(1, 6, mr * 0.85, mr, 0, 0, TAU);
  ctx.fillStyle = pal.outline; ctx.fill();
  if (open > 0.6) { ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, 1, 6, mr * 2, pal.glow, 0.5 * open); }
  ctx.restore();
  handAt(ctx, front.x, front.y, 9.5, pal, glowAmt, s && s.phase === 'active' ? 1 : 0);
  if (s && s.phase === 'active') {
    const tx = front.x, ty = front.y;
    soundArcs(ctx, tx, ty, Math.max(18, s.tip.r * 1.2), pal, t, 1, Math.atan2(ty + 40, tx));
    kit.glow(ctx, tx, ty, s.tip.r, pal.effect, 0.35);
  }
  if (m && (m.anim === 'shout' || m.anim === 'hello') && m.phase !== 'startup') soundArcs(ctx, 22, -54, 26, pal, t, 1 - (m.phase === 'recovery' ? m.phaseT : 0));
  if (m && (m.anim === 'ring' || m.anim === 'hum' || m.anim === 'rise') && m.phase === 'active') {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) { ctx.globalAlpha = 0.6 - i * 0.25; ctx.strokeStyle = pal.glow; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -42, 26 + i * 12 + Math.sin(t * 20) * 2, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }
  if (m && m.anim === 'ripple' && m.phase === 'active') {
    ctx.save(); ctx.strokeStyle = pal.glow; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) { ctx.globalAlpha = 0.8 - i * 0.2; ctx.beginPath(); ctx.ellipse(0, -6, 30 + i * 26, 6 + i * 2, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }
  if (expr === 'dizzy') {
    for (let i = 0; i < 3; i++) { const a = t * 4 + i * 2.1; kit.starPath(ctx, Math.cos(a) * 22, -92 + Math.sin(a) * 5, 5, 5, 2, a); ctx.fillStyle = pal.glow; ctx.fill(); }
  }
  ctx.restore();
  // Active frames: the strike is a burst of sound that fills the hitbox itself.
  if (s && s.phase === 'active') for (const h of info.hitboxes || []) sonicShape(ctx, h, pal, t);
}

/** Translucent pressure-wave fill + rippling edge for one hit shape. */
function sonicShape(ctx, h, pal, t) {
  if (h.kind === 'grab') return;
  kit.shapeGlow(ctx, h, pal.glow, 0.45);
  ctx.save();
  kit.shapePath(ctx, h); ctx.clip();
  const c = kit.shapeCenter(h);
  ctx.globalAlpha = 0.5; ctx.fillStyle = pal.effect;
  kit.shapePath(ctx, h); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    const k = (i / 4 + t * 2.5) % 1;
    ctx.globalAlpha = 0.8 * (1 - k);
    ctx.beginPath(); ctx.arc(c.x, c.y, 4 + k * 70, 0, TAU); ctx.stroke();
  }
  ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.85; ctx.strokeStyle = pal.glow; ctx.lineWidth = 2;
  kit.shapePath(ctx, h, 1); ctx.stroke(); ctx.restore();
}

export default {
  rig: 'none',
  bounds: { left: -110, right: 150, top: -170, bottom: 34 },
  palette: PAL,
  palettes: ALT,

  draw(ctx, v, info) {
    // Clones arrive through drawSelf with a numeric entity id (fighters have string ids).
    const ghost = typeof v.id === 'number';
    drawEcho(ctx, v, info, ghost ? GHOST : info.palette);
  },

  entities: {
    echo: {
      draw(ctx, e, info) {
        const fade = Math.min(1, e.age / 10, e.life / 20);
        if (e.view) info.drawSelf(ctx, e.view, { alpha: 0.72 * fade, scale: e.def?.scale || 0.9 });
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 * fade;
        ctx.strokeStyle = GHOST.rim; ctx.lineWidth = 1;
        for (let y = -80; y < 0; y += 6) { const o = Math.sin(info.time * 9 + y * 0.3) * 3; ctx.beginPath(); ctx.moveTo(-24 + o, y); ctx.lineTo(24 + o, y); ctx.stroke(); }
        ctx.restore();
      },
    },
    shout: {
      draw(ctx, e, info) {
        const pal = info.palette, k = clamp(e.age / 42, 0, 1);
        const r = 14 + k * 8, a = Math.min(1, e.life / 8);
        kit.glow(ctx, 0, 0, r * 1.6, pal.glow, 0.35 * a);
        soundArcs(ctx, 0, 0, r * 1.5, pal, info.time, a, 0, 4);
        ctx.save(); ctx.globalAlpha *= a;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = kit.rgba(pal.glow, 0.35); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = pal.effect; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(1, 1, r * 0.12, r * 0.18, 0, 0, TAU); ctx.fillStyle = pal.outline; ctx.fill();
        ctx.restore();
      },
    },
  },

  fx: {
    onHit(fx, ev, info) {
      const P = info.palette, dmg = ev.damage || 0, { x, y } = ev;
      fx.ring({ x, y, r0: 6, r1: 26 + dmg * 3, color: P.glow, life: 14, width: 4, blend: 'lighter' });
      fx.ring({ x, y, r0: 4, r1: 16 + dmg * 2, color: '#ffffff', life: 10, width: 2 });
      fx.burst({ x, y, count: 5 + dmg, shape: ev.effect === 'chime' ? 'star' : 'streak', colors: [P.glow, P.rim, '#ffffff'], speed: [3, 8], life: [10, 18], size: [2, 4], blend: 'lighter' });
    },
    onLand(fx, ev, info) { fx.ring({ x: ev.x, y: ev.y - 2, r0: 6, r1: 34, color: info.palette.glow, life: 14, width: 3, flat: true, alpha: 0.7 }); },
    onJump(fx, ev, info) { fx.ring({ x: ev.x, y: ev.y - 4, r0: 8, r1: ev.double ? 40 : 28, color: info.palette.rim, life: 12, width: 3, flat: true }); },
    onKO(fx, ev, info) {
      const P = info.palette;
      for (let i = 0; i < 4; i++) fx.ring({ x: ev.x, y: ev.y, r0: 10 + i * 20, r1: 120 + i * 40, color: i % 2 ? P.glow : P.rim, life: 20 + i * 6, width: 5 });
      fx.text({ x: ev.x, y: ev.y - 40, text: 'o...o...', color: P.mask, size: 18, life: 70 });
      fx.sound('chime', { pitch: 0.6 });
    },
    onRespawn(fx, ev, info) { fx.ring({ x: ev.x, y: ev.y - 44, r0: 80, r1: 16, color: info.palette.glow, life: 20, width: 4 }); },
    onEvent: {
      split(fx, ev, info) {
        fx.ring({ x: ev.x, y: ev.y - 42, r0: 10, r1: 70, color: GHOST.glow, life: 16, width: 4, blend: 'lighter' });
        fx.burst({ x: ev.x, y: ev.y - 42, count: 14, shape: 'glow', colors: [GHOST.light, info.palette.glow], speed: [1, 4], life: [12, 22], size: [6, 12], blend: 'lighter' });
        fx.sound('chime', { pitch: 1.3 });
      },
      swap(fx, ev, info) {
        fx.flash(info.palette.glow, 0.12, 2);
        fx.burst({ x: ev.x, y: ev.y - 42, count: 12, shape: 'streak', colors: [info.palette.glow, '#ffffff'], speed: [4, 9], life: [8, 14], blend: 'lighter' });
        fx.sound('zip');
      },
      shout(fx, ev, info) { fx.sound('whoosh', { pitch: 1.4 }); fx.ring({ x: ev.x, y: ev.y - 50, r0: 10, r1: 40, color: info.palette.glow, life: 10, width: 3 }); },
      hello(fx, ev, info) {
        fx.text({ x: ev.x, y: ev.y - 100, text: 'hello?', color: info.palette.mask, size: 18, life: 50 });
        fx.text({ x: ev.x + 30, y: ev.y - 120, text: 'hello?', color: info.palette.glow, size: 13, life: 60, alpha: 0.6 });
      },
    },
  },

  sounds: { jump: 'whoosh' },

  portrait(ctx, size, info) {
    const k = size / 100;
    ctx.save();
    ctx.translate(size / 2 - 6 * k, size * 1.02);
    ctx.scale(k * 1.15, k * 1.15);
    drawEcho(ctx, { state: 'idle', move: null }, { ...info, time: 0.5, motion: { squash: 0, stretch: 0, lean: 0 } }, info.palette);
    ctx.restore();
  },
};
