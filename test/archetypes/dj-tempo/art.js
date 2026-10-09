// DJ Tempo art (rig: none): a hoodie-wearing DJ with a spinning vinyl record
// for a head, big headphones and an EQ readout on the chest. Everything pulses
// on the match's 120 BPM grid (simFrame % 30), so the art grooves in time with
// the mechanic. The record spins faster as Groove fills.
import * as kit from '../../../shared/art/kit.js';

const { lerp, clamp, TAU } = kit;
const PAL = {
  main: '#5b44b0', dark: '#2e2163', light: '#8f78e0', outline: '#120a24',
  vinyl: '#17141c', vinylHi: '#4a4458', label: '#ff5fd2', label2: '#ffd34d', skin: '#f2c29b', skinDark: '#c98f68',
  phones: '#e9e9f2', phonesDark: '#8d8da3', shoe: '#ffffff', sole: '#ff5fd2', pants: '#1e2440', eq: '#5fffd0', effect: '#ff8ae6',
};
const ALT = [{ ...PAL, main: '#0f6b5a', dark: '#073a31', light: '#2fb79b', label: '#4ad8ff', sole: '#4ad8ff', effect: '#7fe8ff' }];
const BEAT = 30;
const easeOut = (t) => 1 - (1 - t) * (1 - t);

/** 0..1 pulse that peaks on every beat of the global grid. */
const beatPulse = (frame) => { const p = (frame % BEAT) / BEAT; return Math.pow(1 - p, 3); };

function tipOf(m) {
  const h = (m.def?.hitboxes || []).find((b) => b.kind !== 'absorb');
  if (!h) return null;
  const k = kit.shapeKind(h);
  if (k === 'capsule') return Math.hypot(h.x2, h.y2 + 50) >= Math.hypot(h.x1, h.y1 + 50) ? { x: h.x2, y: h.y2, r: h.r } : { x: h.x1, y: h.y1, r: h.r };
  if (k === 'rect') return { x: h.x + h.w * 0.3, y: h.y, r: Math.min(h.w, h.h) / 2 };
  return { x: h.x, y: h.y, r: h.r };
}

function arm(ctx, sx, sy, hx, hy, pal, glove = false) {
  const mx = (sx + hx) / 2 - (hy - sy) * 0.12, my = (sy + hy) / 2 + 6;
  ctx.lineCap = 'round';
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(mx, my, hx, hy); ctx.stroke();
  ctx.strokeStyle = pal.main; ctx.lineWidth = 6.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(hx, hy, glove ? 6 : 5, 0, TAU); ctx.fillStyle = pal.skin; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
}

function record(ctx, x, y, r, spin, pal, expr, t) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = kit.radial(ctx, -r * 0.3, -r * 0.4, 1, r * 1.1, [pal.vinylHi, pal.vinyl]); ctx.fill();
  ctx.lineWidth = 2.6; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.save(); ctx.rotate(spin);
  ctx.strokeStyle = kit.rgba('#ffffff', 0.12); ctx.lineWidth = 0.8;
  for (let rr = r * 0.5; rr < r - 1.5; rr += 2.2) { ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke(); }
  ctx.strokeStyle = kit.rgba('#ffffff', 0.35); ctx.lineWidth = 2;                         // the sheen sweeps with the spin
  ctx.beginPath(); ctx.arc(0, 0, r * 0.75, -0.5, 0.3); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.75, Math.PI - 0.5, Math.PI + 0.3); ctx.stroke();
  ctx.restore();
  // label = face (doesn't spin, it's the DJ's face)
  ctx.beginPath(); ctx.arc(0, 0, r * 0.48, 0, TAU);
  ctx.fillStyle = kit.radial(ctx, -2, -3, 1, r * 0.5, [kit.shade(pal.label, 0.25), pal.label]); ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.fillStyle = pal.outline;
  if (expr === 'hurt') {
    ctx.lineWidth = 1.6; ctx.beginPath();
    for (const ex of [-3.2, 3.2]) { ctx.moveTo(ex - 1.8, -3.5); ctx.lineTo(ex + 1.8, -0.5); ctx.moveTo(ex + 1.8, -3.5); ctx.lineTo(ex - 1.8, -0.5); }
    ctx.stroke();
  } else {                                                                                 // shades
    kit.roundRectPath(ctx, -7, -4.5, 6.2, 3.8, 1.2); ctx.fill(); kit.roundRectPath(ctx, 0.8, -4.5, 6.2, 3.8, 1.2); ctx.fill();
    ctx.fillRect(-1, -3.5, 2, 1);
    ctx.fillStyle = kit.rgba('#ffffff', 0.7); ctx.fillRect(-5.8, -4, 1.6, 1); ctx.fillRect(2, -4, 1.6, 1);
  }
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 1.5; ctx.beginPath();
  if (expr === 'shout') { ctx.ellipse(0, 3.5, 2.4, 2, 0, 0, TAU); ctx.fillStyle = pal.outline; ctx.fill(); }
  else ctx.arc(0, 1.5, 3, 0.25, Math.PI - 0.25);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fillStyle = pal.label2; ctx.fill();         // spindle hole as a "nose"
  ctx.restore();
}

function headphones(ctx, x, y, r, pal) {
  ctx.save(); ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, r + 3, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
  ctx.strokeStyle = pal.phones; ctx.lineWidth = 3.2; ctx.stroke();
  for (const s of [-1, 1]) {
    kit.roundRectPath(ctx, s * (r + 1) - 5, -7, 10, 15, 4);
    ctx.fillStyle = kit.linear(ctx, 0, -7, 0, 8, [pal.phones, pal.phonesDark]); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
    ctx.fillStyle = pal.label; ctx.fillRect(s * (r + 1) - 1.5, -3, 3, 7);
  }
  ctx.restore();
}

function deck(ctx, x, y, spin, pal) {
  ctx.save(); ctx.translate(x, y);
  kit.roundRectPath(ctx, -18, -4, 36, 9, 2); ctx.fillStyle = '#2a2a33'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-2, -5, 13, 4, 0, 0, TAU); ctx.fillStyle = pal.vinyl; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-2, -5, 4, 1.4, 0, 0, TAU); ctx.fillStyle = pal.label; ctx.fill();
  ctx.strokeStyle = kit.rgba('#ffffff', 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(-2, -5, 9, 2.8, 0, spin, spin + 1); ctx.stroke();
  ctx.fillStyle = pal.eq; ctx.fillRect(12, -2, 4, 3);
  ctx.restore();
}

function drawDJ(ctx, v, info, pal) {
  const t = info.time, m = v.move, st = v.state, frame = info.simFrame | 0;
  const mo = info.motion || { squash: 0, stretch: 0, lean: 0 };
  const groove = clamp((v.resources?.groove || 0) / 100, 0, 1);
  const bp = beatPulse(frame);
  const c = info.cache;
  c.spin = (c.spin || 0) + (info.dt || 1 / 60) * (2 + groove * 10);
  let bob = -bp * 3, lean = mo.lean * 0.12, expr = 'cool', squat = mo.squash * 6;
  let lead = null, offHand = { x: -16, y: -78 }, leadRest = { x: 18, y: -40 }, showDeck = false, legKick = 0, legSpread = 0, headTilt = Math.sin(frame / BEAT * Math.PI) * 0.06;
  const walk = st === 'run' ? Math.sin(t * 16) : 0;
  if (st === 'crouch') squat += 14;
  if (st === 'hitstun' || st === 'tumble') { expr = 'hurt'; lean = -0.3; offHand = { x: -22, y: -64 }; leadRest = { x: 22, y: -66 }; }
  if (st === 'shield') { leadRest = { x: 14, y: -76 }; offHand = { x: -6, y: -80 }; }
  if (st === 'helpless') { expr = 'hurt'; headTilt = Math.sin(t * 6) * 0.3; }
  if (!v.grounded && st === 'air') { legSpread = 6; squat -= 2; }
  if (m) {
    const ph = m.phase, pt = m.phaseT || 0;
    const ext = ph === 'active' ? 1 : ph === 'recovery' ? 1 - easeOut(pt) : ph === 'startup' || ph === 'charge' ? -0.3 * pt : 0;
    const tip = tipOf(m);
    expr = ph === 'active' ? 'shout' : 'cool';
    if (tip) {
      if (m.anim === 'kick' || m.anim === 'needle' || m.anim === 'stomp') { legKick = Math.max(0, ext) * 1; lead = null; }
      else lead = ext >= 0 ? { x: lerp(leadRest.x, tip.x, ext), y: lerp(leadRest.y, tip.y, ext) } : { x: leadRest.x + ext * 14, y: leadRest.y - ext * 4 };
      if (m.anim === 'handsUp' || m.anim === 'disco') offHand = { x: -tip.x - 10, y: lead ? lead.y : -100 };
      if (tip.x < -10 && lead) { offHand = lead; lead = { ...leadRest }; }
    }
    if (m.anim === 'scratch' || m.anim === 'drop' || m.anim === 'setup') { showDeck = true; lead = { x: 22 + Math.sin(t * 30) * (m.anim === 'scratch' ? 6 : 0), y: -46 }; }
    if (m.anim === 'spin') lean = Math.sin((m.t || 0) * TAU) * 0.4;
    if (m.anim === 'hype') { offHand = { x: -18, y: -104 - bp * 6 }; lead = { x: 18, y: -104 - bp * 6 }; expr = 'shout'; }
    if (m.anim === 'lift') { squat = -6; }
    lean += 0.08 * Math.max(0, ext) * Math.sign(tip?.x || 1);
  }
  const hipY = -28 + squat * 0.6;

  // beat ring at the feet
  ctx.save(); ctx.globalAlpha = 0.35 + 0.5 * bp; ctx.strokeStyle = pal.eq; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, 16 + (1 - bp) * 18, 3 + (1 - bp) * 3, 0, 0, TAU); ctx.stroke(); ctx.restore();

  ctx.save();
  ctx.rotate(lean);
  // legs + sneakers
  const leg = (x0, fx, fy) => {
    ctx.lineCap = 'round'; ctx.strokeStyle = pal.outline; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x0, hipY); ctx.lineTo(fx, fy - 3); ctx.stroke();
    ctx.strokeStyle = pal.pants; ctx.lineWidth = 5.5; ctx.stroke();
    kit.roundRectPath(ctx, fx - 5, fy - 6, 13, 6, 3); ctx.fillStyle = pal.shoe; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = pal.outline; ctx.stroke();
    ctx.fillStyle = pal.sole; ctx.fillRect(fx - 4, fy - 1.8, 11, 1.6);
  };
  leg(-5, -8 - legSpread + walk * 8, walk > 0 ? -walk * 4 : 0);
  leg(5, legKick > 0 ? lerp(8, 36, legKick) : 8 + legSpread - walk * 8, legKick > 0 ? lerp(0, -10, legKick) : walk < 0 ? walk * 4 : 0);
  // back arm
  arm(ctx, -9, -56 + bob, offHand.x, offHand.y + bob, { ...pal, main: kit.shade(pal.main, -0.15) });
  // hoodie torso
  ctx.save(); ctx.translate(0, bob);
  kit.capsulePath(ctx, 0, -58, 0, hipY + 2, 15);
  ctx.fillStyle = kit.linear(ctx, -15, -70, 15, -20, [pal.light, pal.main, pal.dark]); ctx.fill();
  ctx.lineWidth = 2.8; ctx.strokeStyle = pal.outline; ctx.stroke();
  ctx.save(); kit.capsulePath(ctx, 0, -58, 0, hipY + 2, 15); ctx.clip();
  ctx.fillStyle = kit.rgba(info.light?.rim || '#ffc48a', 0.4); ctx.fillRect(-15, -76, 3, 60);
  ctx.fillStyle = pal.dark; kit.roundRectPath(ctx, -9, -34, 18, 7, 3); ctx.fill();                // pocket
  for (let i = 0; i < 5; i++) {                                                                      // EQ bars, on the beat
    const hgt = 3 + 9 * clamp(bp * (0.5 + 0.5 * kit.hash01(i + Math.floor(frame / 6))) + groove * 0.3, 0, 1);
    ctx.fillStyle = i === 2 ? pal.label : pal.eq; ctx.fillRect(-8 + i * 3.4, -40 - hgt, 2.4, hgt);
  }
  ctx.restore();
  ctx.strokeStyle = pal.outline; ctx.lineWidth = 1.2;                                                // hood strings
  ctx.beginPath(); ctx.moveTo(-3, -60); ctx.lineTo(-4, -50); ctx.moveTo(3, -60); ctx.lineTo(4, -50); ctx.stroke();
  ctx.restore();
  // head: record + headphones
  ctx.save(); ctx.translate(0, -80 + bob * 1.4); ctx.rotate(headTilt);
  record(ctx, 0, 0, 18, c.spin, pal, expr, t);
  headphones(ctx, 0, 0, 18, pal);
  ctx.restore();
  if (showDeck) deck(ctx, 24, -40, c.spin * 3, pal);
  // front arm
  const L = lead || leadRest;
  arm(ctx, 9, -56 + bob, L.x, L.y + (lead ? 0 : bob), pal, true);
  ctx.restore();

  // active: sound-wave fill of each hitbox (bass = pink/teal rings)
  if (m && m.phase === 'active') {
    for (const h of info.hitboxes || []) {
      if (h.kind === 'grab') continue;
      kit.shapeGlow(ctx, h, pal.effect, 0.5);
      ctx.save(); kit.shapePath(ctx, h); ctx.clip();
      ctx.fillStyle = kit.rgba(pal.label, 0.35); kit.shapePath(ctx, h); ctx.fill();
      const cc = kit.shapeCenter(h);
      for (let i = 0; i < 4; i++) { const k = (i / 4 + t * 3) % 1; ctx.globalAlpha = 1 - k; ctx.strokeStyle = i % 2 ? pal.eq : '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cc.x, cc.y, 3 + k * 60, 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
    if (m.anim === 'disco') {                                                                          // the disco ball itself
      const h = info.hitboxes[0];
      if (h) {
        ctx.save(); ctx.translate(h.x, h.y);
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fillStyle = '#cfd6e6'; ctx.fill(); ctx.save(); ctx.clip();
        for (let i = -16; i < 16; i += 5) for (let j = -16; j < 16; j += 5) { ctx.fillStyle = kit.hash01(i * 31 + j + frame) > 0.6 ? '#ffffff' : '#8e97ad'; ctx.fillRect(i, j, 4, 4); }
        ctx.restore(); ctx.lineWidth = 2; ctx.strokeStyle = pal.outline; ctx.stroke(); ctx.restore();
      }
    }
  }
}

export default {
  rig: 'none',
  bounds: { left: -110, right: 140, top: -190, bottom: 34 },
  palette: PAL,
  palettes: ALT,
  draw(ctx, v, info) { drawDJ(ctx, v, info, info.palette); },

  drawBack(ctx, v, info) {
    const g = clamp((v.resources?.groove || 0) / 100, 0, 1);
    if (g < 0.5) return;
    const bp = beatPulse(info.simFrame | 0);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, 0, -60, 60 + bp * 20, info.palette.label, 0.1 + g * 0.2 * bp);
    ctx.restore();
  },

  entities: {
    speaker: {
      draw(ctx, e, info) {
        const pal = info.palette, pump = beatPulse(e.age);                               // its own 30-frame clock
        const a = Math.min(1, e.life / 20);
        ctx.save(); ctx.globalAlpha *= a;
        kit.roundRectPath(ctx, -16, -42, 32, 42, 4);
        ctx.fillStyle = kit.linear(ctx, -16, -42, 16, 0, ['#5a4636', '#3a2c22', '#241a14']); ctx.fill();
        ctx.lineWidth = 2.6; ctx.strokeStyle = pal.outline; ctx.stroke();
        for (const [y, r] of [[-30, 6], [-13, 10 + pump * 2]]) {
          ctx.beginPath(); ctx.arc(0, y, r + 2, 0, TAU); ctx.fillStyle = '#16141a'; ctx.fill();
          ctx.beginPath(); ctx.arc(0, y, r, 0, TAU); ctx.fillStyle = kit.radial(ctx, -2, y - 2, 1, r, ['#6a6878', '#2b2933']); ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.fillStyle = pal.eq; ctx.globalAlpha *= 0.4 + 0.6 * pump; ctx.fillRect(-12, -40, 4, 2);
        ctx.restore();
      },
    },
    pulse: {
      draw(ctx, e, info) {
        const pal = info.palette, k = clamp(e.age / 12, 0, 1);
        ctx.save(); ctx.globalAlpha = 1 - k;
        for (let i = 0; i < 3; i++) { ctx.strokeStyle = i % 2 ? pal.eq : pal.label; ctx.lineWidth = 4 - i; const r = 10 + k * 40 - i * 8; if (r <= 1) continue; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
        ctx.fillStyle = kit.rgba(pal.label, 0.2); ctx.beginPath(); ctx.arc(0, 0, 10 + k * 40, 0, TAU); ctx.fill();
        ctx.restore();
      },
    },
  },

  fx: {
    onHit(fx, ev, info) {
      const P = info.palette, dmg = ev.damage || 0;
      fx.ring({ x: ev.x, y: ev.y, r0: 6, r1: 24 + dmg * 3, color: P.label, life: 12, width: 4 });
      fx.burst({ x: ev.x, y: ev.y, count: 4 + dmg, shape: 'star', colors: [P.eq, P.label, '#ffffff'], speed: [2, 7], life: [10, 20], size: [3, 5] });
    },
    onLand(fx, ev, info) { fx.ring({ x: ev.x, y: ev.y - 2, r0: 6, r1: 30, color: info.palette.eq, life: 12, width: 2, flat: true }); },
    onKO(fx, ev, info) { fx.text({ x: ev.x, y: ev.y - 40, text: '*record scratch*', size: 14, color: '#ffffff', life: 70 }); fx.sound('zip', { pitch: 0.5 }); },
    onEvent: {
      perfect(fx, ev, info) {
        const s = ev.data?.s || 1;
        fx.text({ x: ev.x, y: ev.y - 120, text: s > 1 ? `PERFECT x${s}` : 'PERFECT', size: 14 + Math.min(8, s), color: info.palette.eq, outline: '#120a24', life: 40 });
        fx.sound('chime', { pitch: 1 + s * 0.08, volume: 0.6 });
      },
      drop(fx, ev, info) {
        const big = !!ev.data?.big;
        fx.ring({ x: ev.x, y: ev.y - 50, r0: 10, r1: big ? 120 : 50, color: info.palette.label, life: big ? 20 : 12, width: big ? 8 : 4, blend: 'lighter' });
        if (big) { fx.flash(info.palette.label, 0.2, 4); fx.sound('boom', { volume: 1 }); fx.text({ x: ev.x, y: ev.y - 140, text: 'BASS DROP', size: 22, color: info.palette.label, life: 50 }); }
        else fx.sound('buzz-thwack', { pitch: 0.6, volume: 0.5 });
      },
      hype(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 110, count: 10, shape: 'star', colors: [info.palette.label, info.palette.eq], speed: [1, 4], angle: 90, spread: 90, life: [20, 34], size: [3, 6] }); },
    },
  },
  sounds: { jump: 'whoosh' },

  portrait(ctx, size, info) {
    const k = size / 64;
    ctx.save(); ctx.translate(size / 2, size * 0.58); ctx.scale(k, k);
    record(ctx, 0, 0, 18, 0.6, info.palette, 'cool', 0.5);
    headphones(ctx, 0, 0, 18, info.palette);
    ctx.restore();
  },
};
