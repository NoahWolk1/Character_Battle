// Rewinda art (rig: none): a little time mage whose body is an hourglass. The top
// bulb shows the real Sand resource, the stream runs while it refills, and the
// clock-hand staff is the weapon. drawWorld paints a ghost at the synced rewind
// point (vars tx/ty) so players can see where Rewind will take her.
import * as kit from '../../../shared/art/kit.js';

const { lerp, clamp, TAU } = kit;
const PAL = {
  main: '#2b3a78', dark: '#161f45', light: '#4f64b8', outline: '#120f26',
  wood: '#8a5a2b', woodDark: '#5a3816', woodLight: '#c08a52', glass: '#dff3ff', sand: '#f3c969', sandDark: '#c9973d',
  skin: '#d9c6f2', skinDark: '#a68cc9', gold: '#ffd34d', star: '#fff2a8', effect: '#b9a2ff', ghost: '#9fe0ff',
};
const ALT = [{ ...PAL, main: '#7a2b4e', dark: '#45162a', light: '#b8507e', effect: '#ff9cc8', ghost: '#ffb3d9' }];
const easeOut = (t) => 1 - (1 - t) * (1 - t);

function tipOf(m) {
  const h = (m.def?.hitboxes || []).find((b) => b.kind !== 'grab');
  if (!h) return null;
  const k = kit.shapeKind(h);
  if (k === 'capsule') return Math.hypot(h.x2, h.y2 + 56) >= Math.hypot(h.x1, h.y1 + 56) ? { x: h.x2, y: h.y2, r: h.r } : { x: h.x1, y: h.y1, r: h.r };
  if (k === 'rect') return { x: h.x + h.w * 0.3, y: h.y, r: Math.min(h.w, h.h) / 2 };
  return { x: h.x, y: h.y, r: h.r };
}

/** Hourglass bulb path (top: y0→neck, bottom: neck→y1). */
function bulb(ctx, yTop, yBot, w, neckAtBottom) {
  ctx.beginPath();
  if (neckAtBottom) {
    ctx.moveTo(-w, yTop); ctx.lineTo(w, yTop);
    ctx.bezierCurveTo(w + 2, yTop + (yBot - yTop) * 0.6, 4, yBot - 4, 2.5, yBot);
    ctx.lineTo(-2.5, yBot);
    ctx.bezierCurveTo(-4, yBot - 4, -w - 2, yTop + (yBot - yTop) * 0.6, -w, yTop);
  } else {
    ctx.moveTo(-2.5, yTop); ctx.lineTo(2.5, yTop);
    ctx.bezierCurveTo(4, yTop + 4, w + 2, yTop + (yBot - yTop) * 0.4, w, yBot);
    ctx.lineTo(-w, yBot);
    ctx.bezierCurveTo(-w - 2, yTop + (yBot - yTop) * 0.4, -4, yTop + 4, -2.5, yTop);
  }
  ctx.closePath();
}

function hourglass(ctx, sand, flowing, pal, t, spin = 0) {
  const W = 16;
  // glass + sand (top bulb y -76..-47, bottom -47..-20)
  ctx.save();
  bulb(ctx, -76, -47, W, true); ctx.fillStyle = kit.rgba(pal.glass, 0.45); ctx.fill();
  ctx.save(); bulb(ctx, -76, -47, W, true); ctx.clip();
  const topH = 27 * clamp(sand, 0, 1);
  ctx.fillStyle = kit.linear(ctx, 0, -47 - topH, 0, -47, [pal.sand, pal.sandDark]);
  ctx.beginPath(); ctx.moveTo(-W - 4, -47); ctx.lineTo(-W - 4, -47 - topH + 3); ctx.quadraticCurveTo(0, -47 - topH + 8, W + 4, -47 - topH + 3); ctx.lineTo(W + 4, -47); ctx.fill();
  ctx.restore();
  bulb(ctx, -47, -20, W, false); ctx.fillStyle = kit.rgba(pal.glass, 0.45); ctx.fill();
  ctx.save(); bulb(ctx, -47, -20, W, false); ctx.clip();
  const botH = 4 + 18 * (1 - clamp(sand, 0, 1));
  ctx.fillStyle = kit.linear(ctx, 0, -20 - botH, 0, -20, [pal.sand, pal.sandDark]);
  ctx.beginPath(); ctx.moveTo(-W - 4, -20); ctx.lineTo(-W - 4, -22); ctx.quadraticCurveTo(0, -20 - botH * 2, W + 4, -22); ctx.lineTo(W + 4, -20); ctx.fill();
  if (flowing) { ctx.fillStyle = pal.sand; ctx.fillRect(-0.9, -47, 1.8, 27 - botH * 0.6); for (let i = 0; i < 3; i++) ctx.fillRect(-0.6 + Math.sin(t * 20 + i) * 0.6, -46 + ((t * 60 + i * 9) % 22), 1.2, 1.2); }
  ctx.restore();
  ctx.lineWidth = 2.4; ctx.strokeStyle = pal.outline;
  bulb(ctx, -76, -47, W, true); ctx.stroke(); bulb(ctx, -47, -20, W, false); ctx.stroke();
  ctx.fillStyle = kit.rgba('#ffffff', 0.55);                                           // glass glints
  ctx.beginPath(); ctx.ellipse(-9, -66, 2, 6, 0.2, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-10, -30, 2, 5, -0.2, 0, TAU); ctx.fill();
  ctx.restore();
  // frame: caps + posts
  for (const y of [-82, -20]) {
    kit.roundRectPath(ctx, -21, y, 42, 6, 2.5);
    ctx.fillStyle = kit.linear(ctx, 0, y, 0, y + 6, [pal.woodLight, pal.wood, pal.woodDark]); ctx.fill();
    ctx.lineWidth = 2.2; ctx.strokeStyle = pal.outline; ctx.stroke();
  }
  for (const x of [-19, 19]) {
    ctx.fillStyle = pal.wood; ctx.fillRect(x - 1.8, -76, 3.6, 56); ctx.lineWidth = 1.6; ctx.strokeRect(x - 1.8, -76, 3.6, 56);
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(x, -70 + k * 15, 2.4, 0, TAU); ctx.fillStyle = pal.woodLight; ctx.fill(); ctx.stroke(); }
  }
  // clock emblem on the neck (hands run backward during Rewind)
  ctx.beginPath(); ctx.arc(0, -47, 5.5, 0, TAU); ctx.fillStyle = pal.gold; ctx.fill(); ctx.lineWidth = 1.6; ctx.stroke();
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, -47); ctx.lineTo(Math.cos(spin) * 4, -47 + Math.sin(spin) * 4); ctx.moveTo(0, -47); ctx.lineTo(Math.cos(spin / 12) * 2.6, -47 + Math.sin(spin / 12) * 2.6); ctx.stroke();
}

function head(ctx, pal, t, expr, hatTilt) {
  ctx.save(); ctx.translate(0, -95);
  ctx.beginPath(); ctx.arc(0, 0, 12.5, 0, TAU);
  ctx.fillStyle = kit.radial(ctx, -4, -4, 1, 14, [kit.shade(pal.skin, 0.2), pal.skin, pal.skinDark]); ctx.fill();
  ctx.lineWidth = 2.4; ctx.strokeStyle = pal.outline; ctx.stroke();
  // eyes: one plain, one behind a clock-face monocle
  ctx.fillStyle = pal.outline;
  if (expr === 'hurt') { ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-1, -2); ctx.lineTo(3, 2); ctx.moveTo(3, -2); ctx.lineTo(-1, 2); ctx.stroke(); }
  else { const blink = (t % 4) < 0.1; ctx.beginPath(); ctx.ellipse(1, 0, 1.6, blink ? 0.4 : 2.4, 0, 0, TAU); ctx.fill(); }
  ctx.beginPath(); ctx.arc(7.5, -0.5, 4.5, 0, TAU); ctx.fillStyle = kit.rgba('#ffffff', 0.85); ctx.fill(); ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.8; ctx.stroke();
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(7.5, -0.5); ctx.lineTo(7.5 + Math.cos(t * 2) * 3, -0.5 + Math.sin(t * 2) * 3); ctx.stroke();
  ctx.strokeStyle = pal.gold; ctx.beginPath(); ctx.moveTo(11, 2); ctx.quadraticCurveTo(12, 10, 6, 14); ctx.stroke();   // monocle chain
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 1.5; ctx.beginPath();
  if (expr === 'cast') { ctx.ellipse(3, 6, 2, 2.2, 0, 0, TAU); ctx.fillStyle = pal.outline; ctx.fill(); } else ctx.arc(3, 5, 2.6, 0.3, Math.PI - 0.3);
  ctx.stroke();
  // wizard hat
  ctx.rotate(hatTilt);
  ctx.beginPath(); ctx.ellipse(0, -9, 19, 4.5, 0, 0, TAU); ctx.fillStyle = pal.dark; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-11, -10); ctx.quadraticCurveTo(-6, -26, -10, -40 + Math.sin(t * 2) * 2); ctx.quadraticCurveTo(2, -30, 11, -10); ctx.closePath();
  ctx.fillStyle = kit.linear(ctx, -11, -40, 11, -10, [pal.light, pal.main, pal.dark]); ctx.fill(); ctx.stroke();
  ctx.fillStyle = pal.gold; ctx.fillRect(-10, -14, 21, 3);
  for (const [sx, sy, r] of [[-2, -22, 2.6], [3, -16.5, 1.6], [-6, -30, 1.4]]) { kit.starPath(ctx, sx, sy, 5, r, r * 0.45, t * 0.5); ctx.fillStyle = pal.star; ctx.fill(); }
  ctx.restore();
}

function staff(ctx, hx, hy, tx, ty, pal, glow) {
  const ang = Math.atan2(ty - hy, tx - hx), len = Math.max(30, Math.hypot(tx - hx, ty - hy) + 8);
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang);
  ctx.lineCap = 'round';
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(len - 10, 0); ctx.stroke();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(len, 0); ctx.lineTo(len - 14, -7); ctx.lineTo(len - 10, 0); ctx.lineTo(len - 14, 7); ctx.closePath();  // minute-hand arrow
  ctx.fillStyle = pal.gold; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.beginPath(); ctx.arc(-10, 0, 4, 0, TAU); ctx.fillStyle = pal.gold; ctx.fill(); ctx.stroke();
  if (glow > 0) { ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, len - 6, 0, 16, pal.effect, 0.6 * glow); }
  ctx.restore();
}

function drawRewinda(ctx, v, info, pal) {
  const t = info.time, m = v.move, st = v.state;
  const mo = info.motion || { squash: 0, stretch: 0, lean: 0 };
  const sand = clamp((v.resources?.sand ?? 100) / (v.resMax?.sand || 100), 0, 1);
  let rot = 0, bob = Math.sin(t * 2.2) * 1.5, expr = 'calm', hatTilt = -0.1 + Math.sin(t * 1.6) * 0.04, spin = t * 1.5;
  let hand = { x: 24, y: -50 }, staffTip = { x: 30, y: -90 }, glow = 0, step = st === 'run' ? Math.sin(t * 15) : 0;
  if (st === 'hitstun' || st === 'tumble') { expr = 'hurt'; rot = -0.35; hatTilt = -0.5; }
  if (st === 'helpless') { expr = 'hurt'; rot = Math.sin(t * 4) * 0.2; }
  if (st === 'crouch') bob += 8;
  if (st === 'run') rot = 0.1;
  if (st === 'shield') { staffTip = { x: 34, y: -40 }; hand = { x: 26, y: -60 }; }
  if (m) {
    const ph = m.phase, pt = m.phaseT || 0;
    const ext = ph === 'active' ? 1 : ph === 'recovery' ? 1 - easeOut(pt) : 0;
    const A = ph === 'startup' || ph === 'charge' ? pt : 0;
    expr = 'cast'; glow = ext;
    const tip = tipOf(m);
    if (tip) {
      const rest = { x: 30, y: -90 };
      const wind = { x: rest.x - 30, y: rest.y - 10 };
      staffTip = ext > 0 ? { x: lerp(rest.x, tip.x + Math.sign(tip.x || 1) * (tip.r || 10) * 0.5, ext), y: lerp(rest.y, tip.y, ext) } : { x: lerp(rest.x, wind.x, A), y: lerp(rest.y, wind.y, A) };
      if (tip.x < -10 && ext > 0) { hand = { x: -24, y: -54 }; }
      if (Math.abs(tip.x) < 20 && tip.y > -20) { hand = { x: 10, y: -30 }; }
    }
    if (m.anim === 'rewind') { spin = -t * 30; rot = Math.sin(t * 25) * 0.05; glow = 1; }
    if (m.anim === 'spin') rot = Math.sin((m.t || 0) * TAU * 1.5) * 0.45;
    if (m.anim === 'cast' || m.anim === 'watch') { staffTip = { x: 46, y: -70 }; }
    if (m.anim === 'skip') { glow = 1; }
  }
  const flowing = sand < 0.995;

  // starry cape behind
  ctx.save(); ctx.translate(0, bob);
  ctx.beginPath(); ctx.moveTo(-14, -82); ctx.quadraticCurveTo(-34 - mo.lean * 10, -50, -26 + Math.sin(t * 3) * 3 - mo.lean * 14, -14);
  ctx.lineTo(-6, -22); ctx.closePath();
  ctx.fillStyle = kit.linear(ctx, -30, -80, 0, -14, [pal.light, pal.main, pal.dark]); ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = pal.outline; ctx.stroke();
  for (const [x, y] of [[-22, -60], [-18, -40], [-26, -28]]) { kit.starPath(ctx, x, y, 4, 1.8, 0.8, t); ctx.fillStyle = pal.star; ctx.fill(); }
  ctx.restore();

  ctx.save();
  ctx.translate(0, -48); ctx.rotate(rot); ctx.translate(0, 48);
  ctx.translate(0, bob * 0.5);
  // feet (curly slippers)
  for (const [fx, s] of [[-9, 1], [9, -1]]) {
    const dx = step * 6 * s;
    ctx.beginPath(); ctx.moveTo(fx + dx - 6, -1); ctx.quadraticCurveTo(fx + dx, -12, fx + dx + 8, -4); ctx.quadraticCurveTo(fx + dx + 12, -8, fx + dx + 10, -2); ctx.lineTo(fx + dx - 6, 0); ctx.closePath();
    ctx.fillStyle = pal.main; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
  }
  ctx.fillStyle = pal.dark; ctx.fillRect(-12, -16, 6, 12); ctx.fillRect(6, -16, 6, 12);
  hourglass(ctx, sand, flowing, pal, t, spin);
  // back arm
  ctx.lineCap = 'round'; ctx.strokeStyle = pal.outline; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(-18, -66); ctx.quadraticCurveTo(-30, -56, -26, -44); ctx.stroke();
  ctx.strokeStyle = pal.main; ctx.lineWidth = 4; ctx.stroke();
  head(ctx, pal, t, expr, hatTilt);
  // front arm + staff
  staff(ctx, hand.x, hand.y, staffTip.x, staffTip.y, pal, glow);
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(18, -66); ctx.quadraticCurveTo(hand.x + 2, -66, hand.x, hand.y); ctx.stroke();
  ctx.strokeStyle = pal.light; ctx.lineWidth = 4; ctx.stroke();
  ctx.beginPath(); ctx.arc(hand.x, hand.y, 4, 0, TAU); ctx.fillStyle = pal.skin; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = pal.outline; ctx.stroke();
  if (expr === 'hurt' && st === 'helpless') for (let i = 0; i < 3; i++) { const a = t * 4 + i * 2.1; kit.starPath(ctx, Math.cos(a) * 20, -126 + Math.sin(a) * 4, 5, 4, 1.6, a); ctx.fillStyle = pal.star; ctx.fill(); }
  ctx.restore();

  // active: clockwork arcs fill each hitbox
  if (m && m.phase === 'active') for (const h of info.hitboxes || []) {
    if (h.kind === 'grab') continue;
    kit.shapeGlow(ctx, h, pal.effect, 0.55);
    ctx.save(); kit.shapePath(ctx, h); ctx.clip();
    ctx.fillStyle = kit.rgba(pal.effect, 0.35); kit.shapePath(ctx, h); ctx.fill();
    const c = kit.shapeCenter(h);
    ctx.strokeStyle = pal.gold; ctx.lineWidth = 2;
    for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU + t; ctx.beginPath(); ctx.moveTo(c.x + Math.cos(a) * 14, c.y + Math.sin(a) * 14); ctx.lineTo(c.x + Math.cos(a) * 60, c.y + Math.sin(a) * 60); ctx.stroke(); }
    ctx.restore();
    ctx.save(); ctx.strokeStyle = pal.gold; ctx.lineWidth = 2; kit.shapePath(ctx, h, 1); ctx.stroke(); ctx.restore();
  }
}

function pocketWatch(ctx, r, frac, pal, t) {
  ctx.beginPath(); ctx.arc(0, -r - 3, 3, 0, TAU); ctx.lineWidth = 2; ctx.strokeStyle = pal.gold; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = pal.gold; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r - 3, 0, TAU); ctx.fillStyle = '#fffbe8'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r - 3, -Math.PI / 2, -Math.PI / 2 + frac * TAU); ctx.closePath(); ctx.fillStyle = kit.rgba('#ff5d5d', 0.45); ctx.fill();
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(-Math.PI / 2 + frac * TAU) * (r - 4), Math.sin(-Math.PI / 2 + frac * TAU) * (r - 4)); ctx.stroke();
}

export default {
  rig: 'none',
  bounds: { left: -110, right: 150, top: -210, bottom: 34 },
  palette: PAL,
  palettes: ALT,
  draw(ctx, v, info) { drawRewinda(ctx, v, info, info.palette); },

  // The rewind point (synced vars, world space): a faint ghost + a backwards clock.
  drawWorld(ctx, v, info) {
    const vars = v.vars || {};
    if ((vars.filled || 0) < 6 || v.state === 'dead' || v.state === 'respawn') return;
    let dx = (vars.tx ?? v.x) - v.x, dy = (vars.ty ?? v.y) - v.y;
    const d = Math.hypot(dx, dy);
    if (d < 24) return;
    if (d > 200) { dx *= 200 / d; dy *= 200 / d; }                       // where she'd actually land
    const ready = (v.resources?.sand ?? 0) >= 60;
    const pal = info.palette, t = info.time;
    ctx.save(); ctx.translate(dx, dy);
    ctx.globalAlpha = ready ? 0.35 + 0.1 * Math.sin(t * 4) : 0.12;
    ctx.strokeStyle = pal.ghost; ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.ellipse(0, -50, 22, 52, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(0, -50, 12, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(Math.cos(-t * 3) * 9, -50 + Math.sin(-t * 3) * 9); ctx.stroke();
    ctx.restore();
  },

  entities: {
    clockBomb: {
      draw(ctx, e, info) {
        const pal = info.palette, frac = clamp(e.age / 50, 0, 1);
        if (e.age < 50) {
          const sh = frac > 0.7 ? Math.sin(info.time * 60) * 2 * frac : 0;
          ctx.save(); ctx.translate(sh, Math.sin(info.time * 3) * 2);
          if (frac > 0.6) kit.glow(ctx, 0, 0, 30, '#ff5d5d', 0.3 * (Math.sin(info.time * 20) * 0.5 + 0.5));
          pocketWatch(ctx, 14, frac, pal, info.time);
          ctx.restore();
        } else {
          const k = clamp((e.age - 50) / 6, 0, 1);
          ctx.save(); ctx.globalAlpha = 1 - k * 0.6;
          kit.glow(ctx, 0, 0, 50, pal.gold, 0.7);
          ctx.strokeStyle = pal.gold; ctx.lineWidth = 6 - k * 4; ctx.beginPath(); ctx.arc(0, 0, 16 + k * 32, 0, TAU); ctx.stroke();
          for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 20, Math.sin(a) * 20); ctx.lineTo(Math.cos(a) * (30 + k * 18), Math.sin(a) * (30 + k * 18)); ctx.stroke(); }
          ctx.restore();
        }
      },
    },
    stasis: {
      draw(ctx, e, info) {
        const pal = info.palette, t = info.time, a = Math.min(1, e.age / 10, e.life / 20);
        ctx.save(); ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(0, -40, 60, 0, TAU);
        ctx.fillStyle = kit.radial(ctx, 0, -40, 10, 60, [kit.rgba(pal.effect, 0.05), kit.rgba(pal.effect, 0.3)]); ctx.fill();
        ctx.strokeStyle = pal.effect; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = pal.gold; ctx.font = 'bold 10px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const R = ['XII', 'III', 'VI', 'IX'];
        for (let i = 0; i < 4; i++) { const ang = (i / 4) * TAU - Math.PI / 2 + t * 0.2; ctx.fillText(R[i], Math.cos(ang) * 48, -40 + Math.sin(ang) * 48); }
        ctx.strokeStyle = pal.gold; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(Math.cos(t * 0.3) * 30, -40 + Math.sin(t * 0.3) * 30); ctx.stroke();
        ctx.restore();
      },
    },
  },

  fx: {
    onHit(fx, ev, info) {
      const P = info.palette, dmg = ev.damage || 0;
      fx.ring({ x: ev.x, y: ev.y, r0: 6, r1: 22 + dmg * 3, color: P.gold, life: 12, width: 3 });
      fx.burst({ x: ev.x, y: ev.y, count: 5 + dmg, shape: 'dot', colors: [P.sand, P.sandDark, '#ffffff'], speed: [2, 6], gravity: 0.25, life: [12, 22], size: [2, 3] });
    },
    onLand(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 2, count: 4, shape: 'dot', color: info.palette.sand, speed: [1, 2.5], angle: 90, spread: 140, gravity: 0.3, life: [10, 18], size: [1.5, 2.5] }); },
    onKO(fx, ev, info) { fx.text({ x: ev.x, y: ev.y - 40, text: "time's up", size: 16, color: info.palette.gold, life: 70 }); fx.sound('chime', { pitch: 0.5 }); },
    onEvent: {
      rewind(fx, ev, info) {
        const P = info.palette;
        fx.ring({ x: ev.x, y: ev.y - 50, r0: 70, r1: 10, color: P.ghost, life: 18, width: 4 });
        fx.text({ x: ev.x, y: ev.y - 130, text: '<< REWIND', size: 14, color: P.ghost, life: 40 });
        fx.sound('zip', { pitch: 0.7 });
      },
      tick(fx, ev, info) { fx.sound('chime', { pitch: 2, volume: 0.4 }); },
      skipOut(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 50, count: 10, shape: 'dot', colors: [info.palette.sand, info.palette.effect], speed: [1, 4], life: [10, 18], size: [2, 3] }); },
      skipIn(fx, ev, info) { fx.ring({ x: ev.x, y: ev.y - 50, r0: 40, r1: 8, color: info.palette.effect, life: 10, width: 3 }); },
    },
  },
  sounds: { jump: 'whoosh' },

  portrait(ctx, size, info) {
    const k = size / 112;
    ctx.save(); ctx.translate(size / 2 - 4 * k, size * 0.98); ctx.scale(k, k);
    drawRewinda(ctx, { state: 'idle', move: null, resources: { sand: 70 }, resMax: { sand: 100 } }, { ...info, time: 0.5, motion: { squash: 0, stretch: 0, lean: 0 } }, info.palette);
    ctx.restore();
  },
};
