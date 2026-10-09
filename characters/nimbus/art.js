// Nimbus art: a fully procedural storm cloud (rig: none). Every frame builds a
// "pose" (puff layout + face + overlays) from the state and the move phase, then
// paints it with cloud.js (merged puffs, 3 value tiers, sunset rim, storm belly).
import * as kit from '../../shared/art/kit.js';
import {
  PAL, ALT_PALETTES, BASE, CORE, TAU, clamp, lerp, easeOut, easeIn, backOut,
  bodyLight, drawCloud, drawFace, staticArcs, rain, hail, windLines, bolt,
} from './cloud.js';

const CY = -42;                                  // body center (swirl / scatter / tumble pivot)
const FACE = { x: 8, y: -5 };                    // face offset from the core puff
// Fallback hitbox tips per move key [x, y, r] (used before the def is readable).
const TIPS = {
  jab: [34, -40, 18], side: [90, -36, 14], fair: [50, -40, 24], grab: [60, -40, 24], up: [0, -96, 28],
  uair: [0, -96, 28], upSmash: [0, -150, 26], uthrow: [0, -96, 26], bair: [-52, -40, 26], bthrow: [-52, -40, 24],
  thunderhead: [40, -44, 40], dair: [0, 6, 26],
};

// ── small helpers ────────────────────────────────────────────────────────────
const flick = (t, rate = 31) => 0.55 + 0.45 * Math.sin(t * rate) * Math.sin(t * rate * 0.37 + 1.3);

/** Reach tip of a move: the far end of its first strike hitbox (body px). */
function tipOf(m) {
  const h = m.def?.hitboxes?.find((b) => b.kind !== 'grab' || m.anim === 'engulf') || null;
  if (h) {
    const k = kit.shapeKind(h);
    if (k === 'capsule') {
      const far = Math.hypot(h.x2, h.y2 + 40) >= Math.hypot(h.x1, h.y1 + 40);
      return { x: (far ? h.x2 : h.x1), y: (far ? h.y2 : h.y1), r: h.r };
    }
    if (k === 'rect') return { x: h.x + h.w * 0.25, y: h.y, r: Math.min(h.w, h.h) / 2 };
    return { x: h.x, y: h.y, r: h.r };
  }
  const d = TIPS[m.key];
  return d ? { x: d[0], y: d[1], r: d[2] } : { x: 40, y: -40, r: 20 };
}

/** Spring for secondary motion (cache-held, frame-rate independent). */
function spring(s, target, dt, k = 140, d = 11) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) { s.v += (k * (target - s.x) - d * s.v) * h; s.x += s.v * h; }
  return s.x;
}

/** Hover amount 0..1 (no snapshot flag: slow descent while airborne), smoothed in the cache. */
function hoverAmt(v, info) {
  const c = info.cache;
  if (c.hovT === info.time) return c.hov || 0;
  const on = !v.grounded && (v.state === 'air' || v.state === 'attack') && v.vy > 0.25 && v.vy < 1.6 ? 1 : 0;
  c.hov = lerp(c.hov || 0, on, 1 - Math.exp(-(info.dt || 0) * 7));
  c.hovT = info.time;
  return c.hov;
}

function newPose() {
  return {
    sx: 1, sy: 1, dx: 0, dy: 0, shear: 0, rot: 0, grow: 1, pivotY: -4, swirl: 0, scatter: 0, jitter: 0,
    churn: 1, expr: 'grumpy', look: null, open: 1, mouthGlow: 0, glow: null, flash: 0, flashAt: null,
    faceDx: 0, faceDy: 0, faceScale: 1, alpha: 1, grey: 0, dark: 0, arcs: 0, extra: [], back: [], front: [],
    wisp: 1, stars: 0,
  };
}

/** Adds a tapering chain of puffs from a to the tip (ext 0..1 = how far it reaches). */
function arm(list, a, tip, ext, r0 = 17, sag = -4) {
  const tx = lerp(a.x, tip.x, ext), ty = lerp(a.y, tip.y, ext);
  const n = 5;
  for (let i = 1; i <= n; i++) {
    const s = i / n;
    const r = lerp(r0, tip.r * 1.05, s) * (0.65 + 0.35 * ext);
    list.push({ x: lerp(a.x, tx, s), y: lerp(a.y, ty, s) + Math.sin(s * Math.PI) * sag, r });
  }
}

/** Glowing electric spark burst (spat or tip-of-arm). */
function sparkBurst(ctx, rng, pal, x, y, r, a) {
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, x, y, r * 1.9, pal.bolt, 0.75 * a);
  kit.glow(ctx, x, y, r * 0.8, '#ffffff', 0.7 * a);
  ctx.restore();
  for (let i = 0; i < 4; i++) {
    const ang = rng() * TAU, l = r * (0.7 + rng() * 0.6);
    kit.lightning(ctx, rng, x, y, x + Math.cos(ang) * l, y + Math.sin(ang) * l, pal.bolt, 1.6, a, { core: pal.boltCore, jag: 0.35 });
  }
  ctx.save();
  ctx.globalAlpha *= a;
  kit.starPath(ctx, x, y, 6, r * 0.75, r * 0.22, rng() * TAU);
  ctx.fillStyle = pal.spark; ctx.fill();
  ctx.restore();
}

/** Translucent vapor jet (gust) from x0 to x1 at height y. */
function vaporJet(ctx, t, pal, x0, x1, y, h, a) {
  if (a <= 0.01) return;
  ctx.save();
  for (let i = 0; i < 7; i++) {
    const s = ((t * 1.8 + i / 7) % 1);
    const x = lerp(x0, x1 - h * 0.3, s), r = lerp(h * 0.25, h * 0.5, s) * (1 - 0.4 * s * s);
    ctx.globalAlpha = a * 0.4 * Math.sin(s * Math.PI);
    ctx.fillStyle = pal.hi;
    ctx.beginPath(); ctx.ellipse(x, y + Math.sin(i * 2.1 + t * 6) * 4, r * 1.3, r, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
  windLines(ctx, t, x0, y, x1 - x0, h * 0.9, '#ffffff', { n: 8, alpha: 0.85 * a, width: 2.6, seed: 3 });
}

/** Orbiting dizzy stars. */
function dizzyStars(ctx, t, pal, cx, cy, n = 3) {
  for (let i = 0; i < n; i++) {
    const a = t * 4 + (i / n) * TAU;
    const x = cx + Math.cos(a) * 30, y = cy + Math.sin(a) * 8;
    kit.starPath(ctx, x, y, 5, 6, 2.6, t * 3 + i);
    ctx.fillStyle = pal.spark; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = pal.outline; ctx.stroke();
  }
}

// ── move animations (driven by the validated phase) ──────────────────────────
// k = { m, ph, pt, f, A (wind-up 0..1), S (strike 1 → 0 in follow-through), t, tip, rng, pal }
const ANIMS = {
  puff(o, k) {                                     // Spit Spark
    o.sx = 1 - 0.07 * k.A; o.dx = -4 * k.A + 6 * k.S; o.faceScale = 1 + 0.08 * k.A;
    o.expr = k.ph === 'startup' ? 'blow' : 'roar';
    o.open = k.ph === 'startup' ? 0.35 : 0.3 + 0.7 * k.S; o.mouthGlow = k.ph === 'startup' ? k.A * 0.7 : k.S;
    const a = k.ph === 'active' ? 1 : k.ph === 'recovery' ? 1 - clamp(k.pt / 0.4, 0, 1) : 0;
    if (a > 0) o.front.push((ctx) => sparkBurst(ctx, k.rng, k.pal, k.tip.x, k.tip.y, k.tip.r, a));
  },

  reach(o, k) {                                    // Squall Arm (water) / Front Bolt (electric)
    const elec = k.m.key !== 'side';
    o.dx = -6 * k.A + 4 * k.S; o.shear = -0.07 * k.A + 0.07 * k.S;
    o.expr = k.ph === 'startup' ? 'effort' : 'roar'; o.open = 0.6;
    const ext = k.ph === 'active' ? 1 : k.ph === 'recovery' ? 1 - easeOut(k.pt) : 0.12 * k.A;
    if (ext > 0.02) arm(o.extra, { x: 20, y: -42 }, k.tip, ext, 18, -5);
    const tx = lerp(20, k.tip.x, ext), ty = lerp(-42, k.tip.y, ext);
    if (elec) {
      o.mouthGlow = k.S * 0.6;
      o.flash = k.ph === 'active' ? 0.7 : 0.5 * k.A * flick(k.t);
      o.flashAt = { x: tx * 0.6, y: ty };
      if (ext > 0.3) o.front.push((ctx) => sparkBurst(ctx, k.rng, k.pal, tx, ty, k.tip.r * ext, k.ph === 'active' ? 1 : ext));
    } else if (ext > 0.25) {
      o.front.push((ctx) => {                     // squall: rain shed off the arm
        rain(ctx, k.t, { x: (20 + tx) / 2 + 6, y: ty + 6, w: Math.max(10, tx - 20), h: 46, color: k.pal.rain, alpha: ext, density: 1.6, slant: -0.3, seed: 4, under: k.pal.outline });
        windLines(ctx, k.t, 10, ty, tx - 4, 22, k.pal.hi, { n: 4, alpha: 0.6 * ext, seed: 9 });
      });
    }
  },

  tower(o, k) {                                    // Anvil Top / Cumulonimbus / Sky Sizzle / Lightning Rod
    const elec = k.m.key === 'upSmash' || k.m.key === 'uair' || k.m.key === 'uthrow';
    o.sy = 1 - 0.16 * k.A + 0.1 * k.S; o.sx = 1 + 0.1 * k.A - 0.06 * k.S;
    o.expr = k.ph === 'startup' ? 'effort' : 'roar'; o.open = 0.8; o.look = { x: 0.15, y: -1 };
    const ext = k.ph === 'active' ? 1 : k.ph === 'recovery' ? 1 - easeOut(k.pt) : 0.15 * k.A;
    if (ext > 0.02) {
      const top = { x: k.tip.x, y: lerp(-70, k.tip.y, ext) };
      const n = Math.max(2, Math.ceil(Math.abs(top.y + 64) / 20));
      for (let i = 1; i <= n; i++) {
        const s = i / n;
        o.extra.push({ x: Math.sin(s * 5 + k.t * 4) * 3, y: lerp(-64, top.y + k.tip.r * 0.3, s), r: lerp(20, k.tip.r * 0.75, s) * (0.6 + 0.4 * ext) });
      }
      const w = k.tip.r * (0.6 + 0.4 * ext);                     // the anvil: flat, wide crown
      o.extra.push({ x: top.x - w * 0.95, y: top.y + 3, r: w * 0.62 }, { x: top.x + w * 0.95, y: top.y + 2, r: w * 0.66 },
        { x: top.x, y: top.y - 2, r: w * 0.9 });
      if (elec) {
        o.flash = 0.8 * ext; o.flashAt = { x: 0, y: top.y };
        o.front.push((ctx) => {
          kit.lightning(ctx, k.rng, (k.rng() - 0.5) * 16, -60, top.x + (k.rng() - 0.5) * 20, top.y - w * 0.4, k.pal.bolt, 2.6, ext, { core: k.pal.boltCore, branches: 2, glow: 10 });
          if (k.ph === 'active') sparkBurst(ctx, k.rng, k.pal, top.x, top.y - w * 0.5, w * 0.8, 0.8);
        });
      } else {
        o.front.push((ctx) => {                   // updraft swirl around the column
          ctx.save();
          ctx.strokeStyle = k.pal.hi; ctx.lineCap = 'round'; ctx.lineWidth = 2.4;
          for (let i = 0; i < 3; i++) {
            const y = lerp(-62, top.y, (k.t * 2.2 + i / 3) % 1);
            ctx.globalAlpha = 0.7 * ext;
            ctx.beginPath(); ctx.ellipse(0, y, 26, 6, 0, 0.2 + i, Math.PI + 0.6 + i); ctx.stroke();
          }
          ctx.restore();
        });
      }
    }
  },

  flatten(o, k) {                                  // Downpour / Flash Flood
    const e = k.ph === 'startup' ? k.A : k.ph === 'active' ? 1 : 1 - easeOut(k.pt);
    o.sy = 1 - 0.36 * e; o.sx = 1 + 0.22 * e; o.dx = 8 * e; o.expr = 'effort'; o.look = { x: 0.5, y: 0.8 };
    if (e > 0.05) for (let i = 0; i < 4; i++) o.extra.push({ x: 4 + i * 20, y: -12 + Math.sin(k.t * 8 + i) * 1.5, r: 13 * e });
    const pour = k.ph === 'active' ? 1 : k.ph === 'recovery' ? 1 - k.pt : 0;
    if (pour > 0) {
      o.front.push((ctx) => {
        rain(ctx, k.t * 1.6, { x: 32, y: -14, w: 96, h: 16, color: k.pal.rain, alpha: pour, density: 3, slant: 0.05, speed: 300, seed: 6, under: k.pal.outline });
        ctx.save();                               // splashes at the ground line
        ctx.strokeStyle = k.pal.rain; ctx.lineWidth = 1.6; ctx.globalAlpha *= 0.8 * pour;
        for (let i = 0; i < 6; i++) {
          const s = (k.t * 3 + i * 0.37) % 1, x = -14 + kit.hash01(i, 77) * 92;
          ctx.beginPath(); ctx.ellipse(x, -1, 3 + s * 7, 1 + s * 2, 0, Math.PI, TAU); ctx.stroke();
        }
        ctx.restore();
      });
    }
  },

  beam(o, k) {                                     // Ion Beam (fires at frame 12, held)
    const firing = k.f >= 12 && k.ph !== 'recovery';
    if (k.ph === 'recovery') {
      const r = 1 - easeOut(k.pt);
      o.dx = -6 * r; o.expr = 'grumpy'; o.mouthGlow = 0.4 * r; o.arcs = 1;
      o.front.push((ctx) => { ctx.save(); ctx.globalAlpha *= r; kit.glow(ctx, 30, -40, 14, k.pal.bolt, 0.5); ctx.restore(); });
    } else if (!firing) {
      const a = clamp(k.f / 12, 0, 1);
      o.sx = 1 - 0.08 * a; o.sy = 1 + 0.06 * a; o.dx = -5 * easeIn(a); o.expr = 'effort';
      o.mouthGlow = a; o.arcs = 1 + Math.round(a * 3); o.flash = 0.45 * a * flick(k.t); o.flashAt = { x: 22, y: -40 };
      o.front.push((ctx) => {                     // charging orb with sparks being sucked in
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        kit.glow(ctx, 30, -40, 10 + 18 * a, k.pal.bolt, 0.7 * a);
        kit.glow(ctx, 30, -40, 4 + 6 * a, '#ffffff', 0.9 * a);
        ctx.strokeStyle = k.pal.bolt; ctx.lineCap = 'round'; ctx.lineWidth = 1.6;
        for (let i = 0; i < 6; i++) {
          const ang = i * 1.05 + k.t * 3, d = 46 * (1 - ((k.t * 2.4 + i / 6) % 1));
          ctx.globalAlpha = a * 0.8;
          ctx.beginPath(); ctx.moveTo(30 + Math.cos(ang) * d, -40 + Math.sin(ang) * d);
          ctx.lineTo(30 + Math.cos(ang) * (d + 8), -40 + Math.sin(ang) * (d + 8)); ctx.stroke();
        }
        ctx.restore();
      });
    } else {
      o.expr = 'roar'; o.open = 1.3; o.mouthGlow = 1; o.dx = -6; o.jitter = 1.1; o.faceDy = -3;
      o.flash = 0.7; o.flashAt = { x: 22, y: -40 }; o.arcs = 2; o.shear = -0.05;
      o.front.push((ctx) => { ctx.save(); ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, 32, -40, 26, k.pal.bolt, 0.85); kit.glow(ctx, 32, -40, 10, '#ffffff', 1); ctx.restore(); });
    }
  },

  swell(o, k) {                                    // Thunderhead
    if (k.ph === 'startup') {
      o.grow = 1 + 0.14 * k.A; o.dy = -3 * k.A; o.dx = -3 * k.A; o.dark = 0.35 * k.A; o.expr = 'effort';
      o.flash = 0.4 * k.A * flick(k.t, 23); o.flashAt = { x: 6, y: -50 }; o.arcs = Math.round(3 * k.A);
      return;
    }
    const e = k.ph === 'active' ? 1 : 1 - easeOut(k.pt);
    o.grow = 1 + 0.1 * e - 0.05 * Math.sin(k.ph === 'recovery' ? k.pt * Math.PI : 0);
    o.dx = 8 * e; o.dark = 0.2 * e; o.expr = 'roar'; o.open = 1.2 * e + 0.2; o.mouthGlow = e;
    const t = k.tip;
    o.extra.push({ x: t.x - 16, y: t.y - 6, r: 22 * e }, { x: t.x + 2, y: t.y + 4, r: 24 * e },
      { x: t.x - 4, y: t.y - 18, r: 16 * e }, { x: t.x + 12, y: t.y + 16, r: 14 * e });
    o.flash = e; o.flashAt = { x: t.x - 6, y: t.y };
    o.front.push((ctx) => {
      if (k.ph === 'active') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        kit.glow(ctx, t.x, t.y, t.r * 1.5, k.pal.bolt, 0.6); ctx.restore();
        for (let i = 0; i < 6; i++) {
          const a = -1.6 + (i / 5) * 3.2 + (k.rng() - 0.5) * 0.4;
          kit.lightning(ctx, k.rng, t.x - 8, t.y, t.x - 8 + Math.cos(a) * t.r * 1.15, t.y + Math.sin(a) * t.r * 1.15, k.pal.bolt, 2.4, 1, { core: k.pal.boltCore, glow: 8 });
        }
      } else staticArcs(ctx, k.rng, o.extra.slice(-4), k.pal, 2, e);
    });
  },

  burst(o, k) {                                    // Hailstorm
    if (k.ph === 'startup') {
      o.sx = 1 - 0.15 * k.A; o.sy = 1 - 0.12 * k.A; o.expr = 'effort'; o.jitter = 0.8 * k.A;
      o.front.push((ctx) => {                     // ice glints condensing in the belly
        for (let i = 0; i < 4; i++) hail(ctx, -24 + i * 16, -14 + (i % 2) * 5, 2 + 3 * k.A, k.t * 2 + i, k.pal);
      });
      return;
    }
    const e = k.ph === 'active' ? 1 : 1 - easeOut(k.pt);
    const u = k.ph === 'active' ? k.pt * 0.45 : 0.45 + k.pt * 0.55;  // time since the burst
    o.sx = 1 + 0.32 * e; o.sy = 1 - 0.2 * e; o.expr = 'roar'; o.open = e;
    o.front.push((ctx) => {
      ctx.save(); ctx.globalAlpha *= clamp(1.4 - u, 0, 1);
      for (let i = 0; i < 10; i++) {
        const side = i % 2 ? 1 : -1, h = kit.hash01(i, 51);
        const x = side * (16 + u * (60 + h * 30)), y = -20 - Math.sin(u * Math.PI) * (6 + h * 16) + (h - 0.5) * 22;
        hail(ctx, x, y, 5 + kit.hash01(i, 53) * 5, u * 9 * side + i, k.pal);
      }
      ctx.strokeStyle = k.pal.ice; ctx.lineWidth = 3; ctx.globalAlpha *= 0.7;
      ctx.beginPath(); ctx.ellipse(0, -20, 30 + u * 60, 10 + u * 16, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    });
  },

  spin(o, k) {                                     // Pressure Ring
    const fin = k.f >= 18 && k.ph !== 'recovery';
    if (k.ph === 'startup') { o.sy = 1 - 0.08 * k.A; o.swirl = -0.4 * k.A; o.expr = 'effort'; return; }
    const sp = k.ph === 'active' ? (k.f - 5) * 0.34 : 13 * 0.34 + easeOut(k.pt) * 1.2;
    o.swirl = sp; o.expr = fin ? 'roar' : 'effort'; o.open = 1;
    const a = k.ph === 'active' ? 1 : 1 - k.pt;
    if (fin) { o.flash = 1; o.flashAt = { x: 0, y: CY }; }
    o.front.push((ctx) => {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {                // wind ring
        const s = sp * 1.3 + i * 2.1;
        ctx.globalAlpha = 0.75 * a; ctx.strokeStyle = i ? k.pal.hi : '#ffffff'; ctx.lineWidth = 3.5 - i;
        ctx.beginPath(); ctx.arc(0, CY, 36 + i * 4, s, s + 1.7); ctx.stroke();
      }
      ctx.restore();
      if (fin) for (let i = 0; i < 6; i++) {
        const b = (i / 6) * TAU + k.rng();
        kit.lightning(ctx, k.rng, Math.cos(b) * 22, CY + Math.sin(b) * 22, Math.cos(b) * 44, CY + Math.sin(b) * 44, k.pal.bolt, 2, 1, { core: k.pal.boltCore });
      }
    });
  },

  puffBack(o, k) {                                 // Back Draft / Backwash
    o.look = { x: -1, y: 0 };
    if (k.ph === 'startup') { o.dx = 4 * k.A; o.grow = 1 + 0.06 * k.A; o.expr = 'effort'; o.faceScale = 1 + 0.06 * k.A; return; }
    const e = k.ph === 'active' ? 1 : 1 - easeOut(k.pt);
    o.dx = -3 * e; o.expr = 'roar'; o.open = 0.7;
    const t = k.tip;
    o.extra.push({ x: lerp(-30, t.x + 12, e), y: t.y + 2, r: 20 * e }, { x: lerp(-34, t.x, e), y: t.y - 6, r: t.r * 0.9 * e },
      { x: lerp(-36, t.x - 12, e), y: t.y + 8, r: 15 * e });
    o.front.push((ctx) => {
      ctx.save(); ctx.scale(-1, 1);
      windLines(ctx, k.t, -t.x - 6, t.y, 66, 44, k.pal.hi, { n: 7, alpha: e, width: 3, seed: 5 });
      ctx.restore();
    });
  },

  drop(o, k) {                                     // Hail Drop
    o.look = { x: 0.2, y: 1 };
    const t = k.tip;
    if (k.ph === 'startup') {
      o.dy = -5 * k.A; o.sy = 1 - 0.1 * k.A; o.sx = 1 + 0.06 * k.A; o.expr = 'effort';
      o.front.push((ctx) => {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, 0, -8, 10 + 14 * k.A, k.pal.ice, 0.5 * k.A); ctx.restore();
        hail(ctx, 0, -10, 4 + 12 * k.A, k.t * 3, k.pal);
      });
      return;
    }
    const fall = k.ph === 'active' ? 0 : easeIn(k.pt) * 50, a = k.ph === 'active' ? 1 : 1 - k.pt;
    o.dy = -3; o.expr = k.ph === 'active' ? 'roar' : 'grumpy'; o.open = 0.6;
    o.front.push((ctx) => {
      ctx.save(); ctx.globalAlpha *= a;
      ctx.strokeStyle = k.pal.ice; ctx.lineCap = 'round'; ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 10, t.y + fall - t.r - 20); ctx.lineTo(i * 10, t.y + fall - t.r - 4); ctx.stroke(); }
      hail(ctx, t.x, t.y + fall, t.r * 0.92, k.f * 0.2, k.pal);
      ctx.restore();
    });
  },

  summon(o, k) {                                   // Call Lightning / Seed the Clouds (event at frame 14)
    const seed = k.m.key === 'downSpecial';
    const pre = clamp(k.f / 14, 0, 1), post = k.f >= 14 ? clamp((k.f - 14) / Math.max(1, k.m.duration - 14), 0, 1) : 0;
    o.look = { x: 0.3, y: -1 };
    if (k.f < 14) {
      o.sy = 1 + 0.12 * easeIn(pre); o.sx = 1 - 0.05 * pre; o.dy = -4 * pre; o.expr = 'effort';
      o.glow = 0.35 + 0.65 * pre; o.arcs = 1 + Math.round(3 * pre); o.flash = 0.5 * pre * flick(k.t); o.flashAt = { x: 0, y: -66 };
      if (seed) o.extra.push({ x: 22 + 10 * pre, y: -80 - 8 * pre, r: 4 + 9 * pre });
      o.front.push((ctx) => {                     // static rising off the crown
        ctx.save(); ctx.fillStyle = k.pal.spark;
        for (let i = 0; i < 6; i++) {
          const s = (k.t * 1.5 + i / 6) % 1;
          ctx.globalAlpha = pre * Math.sin(s * Math.PI);
          ctx.beginPath(); ctx.arc(-30 + kit.hash01(i, 61) * 60, -70 - s * 40, 1.8, 0, TAU); ctx.fill();
        }
        ctx.restore();
      });
      return;
    }
    const e = 1 - easeOut(post);
    o.expr = 'roar'; o.open = e + 0.2; o.mouthGlow = e; o.flash = e; o.flashAt = { x: 0, y: -60 };
    o.sy = 1 + 0.1 * e; o.grow = 1 + 0.04 * e;
    if (seed) {
      const s = clamp(post * 3, 0, 1);
      if (s < 1) o.front.push((ctx) => {          // the seeded puff flies off toward the rain cloud spot
        const x = lerp(32, 100, easeOut(s)), y = lerp(-88, -150, easeOut(s));
        drawCloud(ctx, [{ x: x - 6, y, r: 9 }, { x: x + 5, y: y - 3, r: 11 }], k.pal, k.L, { outline: 2.4, alpha: 1 - s, contour: false });
      });
    } else if (post < 0.4) {
      o.front.push((ctx) => {
        const a = 1 - post / 0.4;
        kit.lightning(ctx, k.rng, 0, -78, (k.rng() - 0.5) * 30, -178, k.pal.bolt, 3.4, a, { core: k.pal.boltCore, branches: 2, glow: 14 });
      });
    }
  },

  blow(o, k) {                                     // Gust Front / Gale Toss
    if (k.ph === 'startup') {
      o.grow = 1 + 0.07 * k.A; o.faceScale = 1 + 0.1 * k.A; o.expr = 'blow'; o.open = 0.2; o.dx = -2 * k.A; o.faceDx = 2 * k.A;
      return;
    }
    const e = k.ph === 'active' ? 1 : 1 - easeOut(k.pt);
    o.expr = 'blow'; o.open = 0.5 + 0.7 * e; o.dx = -5 * e; o.shear = -0.05 * e; o.faceDx = 3 * e;
    const gust = k.m.key === 'sideSpecial';
    o.front.push((ctx) => vaporJet(ctx, k.t, k.pal, 26, gust ? 146 : 110, -40, 46, e));
  },

  rise(o, k) {                                     // Updraft
    o.look = { x: 0.2, y: -1 };
    if (k.ph === 'startup') { o.sy = 1 - 0.2 * k.A; o.sx = 1 + 0.12 * k.A; o.expr = 'effort'; return; }
    const e = k.ph === 'active' ? 1 : 1 - easeOut(k.pt);
    o.sy = 1 + 0.25 * e; o.sx = 1 - 0.14 * e; o.pivotY = CY; o.expr = 'effort'; o.wisp = 1 + 2 * e;
    o.front.push((ctx) => {
      ctx.save(); ctx.strokeStyle = k.pal.hi; ctx.lineCap = 'round'; ctx.lineWidth = 2.6;
      for (let i = 0; i < 4; i++) {
        const s = (k.t * 2.6 + i / 4) % 1, y = lerp(10, -100, s);
        ctx.globalAlpha = e * 0.8 * Math.sin(s * Math.PI);
        ctx.beginPath(); ctx.ellipse(0, y, 34 - s * 8, 7, 0, 0.3 + i, 2.6 + i); ctx.stroke();
      }
      ctx.restore();
    });
  },

  engulf(o, k) {                                   // Fog Bank (grab)
    if (k.ph === 'startup') { o.dx = -4 * k.A; o.expr = 'effort'; return; }
    const e = k.ph === 'active' ? 1 : 1 - easeOut(k.pt);
    o.dx = 6 * e; o.expr = 'roar'; o.open = 1.4 * e;
    o.extra.push({ x: 40, y: -60, r: 16 * e }, { x: 40 + 18 * e, y: -54, r: 12 * e }, { x: 40, y: -20, r: 15 * e }, { x: 40 + 16 * e, y: -26, r: 11 * e });
    o.front.push((ctx) => {                       // fog wisps drawing in
      ctx.save(); ctx.fillStyle = k.pal.hi;
      for (let i = 0; i < 5; i++) {
        const s = (k.t * 2 + i / 5) % 1;
        ctx.globalAlpha = 0.45 * e * Math.sin(s * Math.PI);
        ctx.beginPath(); ctx.arc(lerp(80, 36, s), -40 + (kit.hash01(i, 71) - 0.5) * 40, 6 - s * 3, 0, TAU); ctx.fill();
      }
      ctx.restore();
    });
  },

  prickle(o, k) {                                  // Static Prickle (pummel)
    const e = k.ph === 'startup' ? k.A : k.ph === 'active' ? 1 : 1 - k.pt;
    o.jitter = 1.4 * e; o.arcs = 2 + Math.round(2 * e); o.flash = 0.6 * e; o.flashAt = { x: 26, y: -40 }; o.expr = 'effort';
    o.extra.push({ x: 40, y: -54, r: 13 }, { x: 40, y: -26, r: 13 });
    o.front.push((ctx) => { for (let i = 0; i < 3; i++) kit.lightning(ctx, k.rng, 34, -40, 58 + k.rng() * 10, -40 + (k.rng() - 0.5) * 40, k.pal.bolt, 1.6, e, { core: k.pal.boltCore }); });
  },

  grumble(o, k) {                                  // Rumble (taunt)
    const r = Math.abs(Math.sin(k.f * 0.33));
    o.jitter = 1.2; o.dark = 0.25; o.expr = 'roar'; o.open = 0.3 + 0.7 * r; o.mouthGlow = 0.3 * r; o.arcs = 3;
    o.flash = k.f % 17 < 3 ? 0.8 : 0; o.flashAt = { x: (k.f % 3 - 1) * 18, y: -54 };
    o.sy = 1 + 0.03 * Math.sin(k.f * 0.66);
    o.front.push((ctx) => rain(ctx, k.t, { x: 0, y: -8, w: 70, h: 40, color: k.pal.rain, alpha: 0.85, density: 1.4, seed: 2, under: k.pal.outline }));
  },
};

// ── state poses ──────────────────────────────────────────────────────────────
function statePose(o, v, k, info) {
  const t = k.t, mo = info.motion;
  switch (v.state) {
    case 'run':
      o.shear = 0.14 * Math.max(0.4, mo.lean); o.dx = 2; o.churn = 1.8; o.sy = 1 + 0.03 * Math.sin(t * 15); o.wisp = 1.8;
      o.look = { x: 1, y: 0.1 };
      break;
    case 'air': {
      const hov = hoverAmt(v, info);
      if (v.vy < 0) { o.sy = 1 + 0.12 * mo.stretch; o.sx = 1 - 0.08 * mo.stretch; o.pivotY = CY; }
      else { o.sy = 1 - 0.04 * mo.stretch; o.sx = 1 + 0.05 * mo.stretch; }
      o.sx += 0.08 * hov; o.sy -= 0.07 * hov; o.look = { x: 0.6, y: 0.3 + 0.5 * hov };
      o.shear = 0.06 * mo.lean;
      break;
    }
    case 'crouch': o.sx = 1.2; o.sy = 0.56; o.look = { x: 0.5, y: 0.6 }; o.churn = 0.6; break;
    case 'shield': o.grow = 0.92; o.expr = 'effort'; o.jitter = 0.3; break;
    case 'roll': case 'spotdodge': case 'airdodge': {
      const s = Math.sin(clamp(v.stateFrame / 20, 0, 1) * Math.PI);
      o.scatter = 9 * s; o.alpha = 1 - 0.45 * s; o.grow = 1 - 0.15 * s; o.expr = 'effort'; o.wisp = 1 + 2 * s;
      break;
    }
    case 'hitstun': {
      o.expr = 'hurt'; const sp = Math.hypot(v.vx, v.vy);
      o.scatter = 6 * Math.exp(-v.stateFrame / 8);
      o.rot = sp > 9 ? v.stateFrame * 0.28 * (v.vx * v.facing >= 0 ? -1 : 1) : clamp(-v.vx * v.facing * 0.03, -0.3, 0.3);
      o.wisp = 2;
      break;
    }
    case 'helpless': o.grey = 0.55; o.expr = 'dizzy'; o.sy = 0.94; o.stars = 2; o.churn = 0.5; break;
    case 'shieldbreak': case 'stunned':
      o.expr = 'dizzy'; o.stars = 3; o.jitter = 0.4;
      if (v.control === 'freeze') { o.grey = 0.35; o.churn = 0; o.stars = 0; }
      break;
    case 'grabbed': o.sx = 0.86; o.sy = 1.08; o.jitter = 0.6; o.expr = 'hurt'; break;
    case 'grabbing': if (!v.move) { o.extra.push({ x: 40, y: -58, r: 15 }, { x: 40, y: -22, r: 15 }, { x: 50, y: -40, r: 11 }); } break;
    case 'respawn': o.glow = 1; o.flash = 0.3 + 0.2 * Math.sin(t * 6); break;
    default: break;
  }
  if (mo.squash > 0) { o.sx *= 1 + mo.squash * 0.25; o.sy *= 1 - mo.squash * 0.25; }
}

// ── the body ─────────────────────────────────────────────────────────────────
function buildPose(v, info, pal, L) {
  const t = info.time, o = newPose();
  const m = v.move;
  const k = { t, rng: info.rng, pal, L, m, f: 0, ph: null, pt: 0, A: 0, S: 0, tip: null };
  if (m) {
    k.f = m.frame; k.ph = m.phase; k.pt = m.phaseT;
    k.A = m.phase === 'startup' ? easeOut(m.phaseT) : m.phase === 'charge' || m.phase === 'hold' ? 1 : 0;
    k.S = m.phase === 'active' ? 1 : m.phase === 'recovery' ? 1 - backOut(m.phaseT) * 0.999 : 0;
    k.S = clamp(k.S, -0.15, 1);
    k.tip = tipOf(m);
  }
  statePose(o, v, k, info);
  if (m && ANIMS[m.anim]) ANIMS[m.anim](o, k);
  if (v.hitFlash) o.expr = 'hurt';
  return { o, k };
}

function layoutPuffs(o, info, cache, dt, v) {
  const t = info.time, ch = o.churn;
  // Secondary motion: the upper puffs lag behind velocity (spring → overshoot on stops).
  cache.lx ||= { x: 0, v: 0 }; cache.ly ||= { x: 0, v: 0 };
  const lx = spring(cache.lx, clamp(-(v.vx || 0) * (v.facing || 1) * 1.4, -9, 9), dt);
  const ly = spring(cache.ly, clamp(-(v.vy || 0) * 0.9, -9, 9), dt);
  const out = [];
  for (let i = 0; i < BASE.length; i++) {
    const [bx, by, br] = BASE[i];
    let x = bx + Math.sin(t * 0.9 * ch + i * 1.7) * 1.4 * ch;
    let y = by + Math.sin(t * 1.25 * ch + i * 2.3) * 1.7 * ch + Math.sin(t * 2.1) * 1.2;   // breath
    const r = br * (1 + Math.sin(t * 1.05 * ch + i * 0.9) * 0.045 * ch + Math.sin(t * 2.1 + 1) * 0.015);
    if (o.swirl) { const dx = x, dy = y - CY, c = Math.cos(o.swirl), s = Math.sin(o.swirl); x = dx * c - dy * s; y = CY + dx * s + dy * c; }
    if (o.scatter) { const dx = x, dy = y - CY, d = Math.hypot(dx, dy) || 1; x += (dx / d) * o.scatter; y += (dy / d) * o.scatter; }
    const w = clamp((-4 - y) / 80, 0, 1);
    out.push({ x: x + lx * w, y: y + ly * w, r });
  }
  const sm = (o.sx + o.sy) / 2;
  const jx = o.jitter ? (info.rng() - 0.5) * 2 * o.jitter : 0, jy = o.jitter ? (info.rng() - 0.5) * 2 * o.jitter : 0;
  for (const p of out) {
    p.x *= o.sx; p.y = o.pivotY + (p.y - o.pivotY) * o.sy;
    p.x += o.shear * (o.pivotY - p.y) + o.dx + jx; p.y += o.dy + jy;
    p.r *= o.grow * sm;
  }
  return { P: out, core: out[CORE], lag: { x: lx, y: ly } };
}

function drawWisps(ctx, t, pal, lag, o) {
  const n = 3, speed = 0.42 * o.wisp;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const p = (t * speed + i / n) % 1;
    const sx = -40 + o.dx, sy = -58 + i * 15 + o.dy;
    const dx = -0.75 + lag.x * 0.08, dy = -0.35 + lag.y * 0.06;
    const x = sx + dx * p * 46, y = sy + dy * p * 46 + Math.sin(t * 2 + i) * 2;
    const r = (8 - p * 5) * (o.wisp > 1 ? 1.2 : 1);
    const a = o.alpha * 0.8 * Math.sin(p * Math.PI) * (1 - p * 0.5);
    // vapor tufts: a lit puff with a soft fringe (no outline: it's thin air)
    ctx.globalAlpha = a * 0.45;
    ctx.fillStyle = pal.hi;
    ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, TAU); ctx.fill();
    ctx.globalAlpha = a;
    ctx.fillStyle = pal.light;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.arc(x + r * 0.9, y + r * 0.25, r * 0.7, 0, TAU); ctx.fill();
    ctx.fillStyle = kit.mix(pal.hi, '#ffffff', 0.3);
    ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.35, r * 0.5, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function paint(ctx, v, info, pal0, opts = {}) {
  const facing = opts.facing ?? (v.facing < 0 ? -1 : 1);
  let L = bodyLight(info, facing);
  const { o, k } = buildPose(v, info, pal0, L);
  const pal = o.dark ? { ...pal0, mid: kit.mix(pal0.mid, pal0.dark, o.dark), light: kit.mix(pal0.light, pal0.mid, o.dark), hi: kit.mix(pal0.hi, pal0.light, o.dark) } : pal0;
  k.pal = pal;
  const cache = info.cache;
  const dt = clamp(cache.lt == null ? 1 / 60 : info.time - cache.lt, 0, 0.1);
  if (!opts.still) cache.lt = info.time;
  const { P, core, lag } = layoutPuffs(o, info, cache, opts.still ? 0 : dt, v);
  for (const e of o.extra) if (e.r > 4) P.push(e);       // tiny puffs would read as dark specks
  const c = clamp((v.resources?.charge || 0) / (v.resMax?.charge || 100), 0, 1);
  if (o.rot) { const cs = Math.cos(-o.rot), sn = Math.sin(-o.rot); L = { ...L, x: L.x * cs - L.y * sn, y: L.x * sn + L.y * cs }; }
  k.L = L;

  ctx.save();
  if (o.rot) { ctx.translate(0, CY); ctx.rotate(o.rot); ctx.translate(0, -CY); }
  for (const fn of o.back) fn(ctx);
  if (info.quality !== 'low') drawWisps(ctx, info.time, pal, lag, o);
  // Inner storm light: a charged cloud flickers on its own.
  let flash = o.flash, flashAt = o.flashAt;
  if (!flash && c > 0.3 && kit.noise1(info.time * 9, 3) > 1 - c * 0.22) { flash = 0.35 * c; flashAt = P[(kit.hash01(Math.floor(info.time * 3), 5) * 6) | 0]; }
  drawCloud(ctx, P, pal, L, { outline: 3.2, flash, flashAt, grey: o.grey, alpha: o.alpha, contour: info.quality !== 'low' });
  // Charge: arcs crawling over the cloud, under the face (more with more static).
  const arcs = o.arcs + (c > 0.15 && info.rng() < 0.35 + c * 0.6 ? Math.round(c * 3) : 0);
  if (arcs > 0) staticArcs(ctx, info.rng, P.slice(0, BASE.length), pal, info.quality === 'low' ? Math.min(1, arcs) : arcs, 0.9);
  // Face
  const blink = ((info.time + (info.cache.blinkSeed ||= 0.7)) % 3.9) < 0.11 ? 1 : 0;
  const idleLook = { x: 0.55 + Math.sin(info.time * 0.6) * 0.35 + (kit.noise1(info.time * 0.4, 9) > 0.82 ? -1.2 : 0), y: Math.sin(info.time * 0.45) * 0.25 };
  const sm = (o.sx + o.sy) / 2;
  ctx.save();
  ctx.globalAlpha *= o.alpha;
  drawFace(ctx, { x: core.x + FACE.x * o.sx + o.faceDx, y: core.y + FACE.y * o.sy + o.faceDy }, pal, o.expr, info.time, {
    scale: o.faceScale * clamp(sm, 0.85, 1.15) * Math.min(1.12, o.grow), look: o.look || idleLook, blink,
    glow: o.glow ?? 0.3 + 0.5 * c, open: o.open, mouthGlow: o.mouthGlow,
  });
  ctx.restore();
  if (o.stars) dizzyStars(ctx, info.time, pal, core.x, core.y - 46, o.stars);
  if (v.control === 'freeze') for (let i = 0; i < 5; i++) hail(ctx, P[i].x, P[i].y - P[i].r * 0.6, 4, i, pal);
  for (const fn of o.front) fn(ctx);
  ctx.restore();
}

// ── entities ─────────────────────────────────────────────────────────────────
const RAIN_PUFFS = [[-44, 6, 14], [-22, 9, 17], [2, 8, 18], [26, 9, 16], [46, 6, 13], [-30, -6, 15], [-6, -12, 20], [20, -10, 17], [38, -3, 12]];

function drawStrike(ctx, e, info, big) {
  const pal = info.palette, a = e.age, top = big ? -340 : -320, w = big ? 1.5 : 1, rng = info.rng;
  const L = bodyLight(info, e.facing);
  const sky = (p, flash) => drawCloud(ctx, [                // the thunderhead that throws the bolt
    { x: -26 * w, y: top + 14, r: (8 + 10 * p) * w }, { x: -8 * w, y: top + 2, r: (10 + 12 * p) * w }, { x: 14 * w, y: top + 6, r: (9 + 11 * p) * w },
    { x: 30 * w, y: top + 16, r: (6 + 8 * p) * w }, { x: 2, y: top + 18, r: (9 + 10 * p) * w }], pal, L, { outline: 2.8, flash, flashAt: { x: 0, y: top + 14 }, contour: false });
  ctx.save();
  if (a < 8) {                                     // telegraph: target ring, a gathering cloud, rising static
    const p = 0.3 + 0.7 * (a / 8);                 // starts 30% gathered: readable from frame 0
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, 0, -4, (22 + 20 * p) * w, pal.bolt, 0.2 + 0.3 * p);
    ctx.restore();
    ctx.lineWidth = 4.5; ctx.strokeStyle = pal.outline; ctx.globalAlpha = 0.5 * (0.4 + 0.6 * p);
    ctx.beginPath(); ctx.ellipse(0, -2, (30 - 12 * p) * w, (8 - 3 * p) * w, 0, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2.2; ctx.strokeStyle = pal.bolt; ctx.globalAlpha = 0.5 + 0.5 * p;
    ctx.stroke();
    ctx.globalAlpha = 1;
    sky(p, p * 0.6 * flick(info.time, 40));
    for (let i = 0; i < 4; i++) {                  // sparks crawling up from the target
      const s = (p + i / 4) % 1;
      ctx.fillStyle = pal.spark; ctx.globalAlpha = 1 - s;
      ctx.beginPath(); ctx.arc((kit.hash01(i, e.id | 0) - 0.5) * 34, -s * 46, 2.2, 0, TAU); ctx.fill();
    }
  } else if (a < 12) {                             // the bolt (hitbox live)
    const width = big ? 9 : 6, hw = big ? 28 : 20;
    const g = ctx.createLinearGradient(-hw, 0, hw, 0);
    g.addColorStop(0, kit.rgba(pal.bolt, 0)); g.addColorStop(0.5, kit.rgba(pal.bolt, 0.32)); g.addColorStop(1, kit.rgba(pal.bolt, 0));
    ctx.fillStyle = g; ctx.fillRect(-hw, top, hw * 2, -top);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, 0, -6, 60 * w, pal.bolt, 0.45);
    ctx.restore();
    sky(1, 1);
    bolt(ctx, rng, (rng() - 0.5) * 20, top + 10, (rng() - 0.5) * 30, -4, pal, width * 0.45, 0.75, { jag: 0.22 });
    bolt(ctx, rng, 0, top + 14, 0, 0, pal, width, 1, { branches: big ? 4 : 2, glow: big ? 36 : 24, jag: 0.12 });
    // ground impact: a hot splash with an outline, and a spark crown
    ctx.globalAlpha = 1; ctx.fillStyle = pal.outline;
    ctx.beginPath(); ctx.ellipse(0, -1, 40 * w + 3, 9 * w + 3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = pal.spark;
    ctx.beginPath(); ctx.ellipse(0, -1, 40 * w, 9 * w, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(0, -2, 20 * w, 4.5 * w, 0, 0, TAU); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const ang = Math.PI + 0.35 + (i / 4) * (Math.PI - 0.7), l = (16 + rng() * 22) * w;
      bolt(ctx, rng, 0, -4, Math.cos(ang) * l * 1.6, -4 + Math.sin(ang) * l, pal, 2.6, 0.95, { segments: 4, jag: 0.35, outline: false, glow: 7 });
    }
  } else {                                          // afterglow, then scorch smoke
    const p = clamp((a - 12) / 8, 0, 1);
    sky(1 - p, 0);
    bolt(ctx, rng, 0, top + 14, 0, 0, pal, (big ? 4 : 2.6) * (1 - p) + 0.6, 1 - p, { jag: 0.1, outline: p < 0.3 });
    ctx.globalAlpha = 0.55 * (1 - p);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? pal.dark : pal.outline;
      ctx.beginPath(); ctx.arc((i - 1.5) * 10, -6 - p * 30 - i * 4, 6 + p * 8, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

/** The Ion Beam: a crackling cyan lance with a dark edge so it reads on any sky. */
function drawBeam(ctx, e, info) {
  const pal = info.palette, t = info.time, rng = info.rng;
  const len = (e.len || 300) * easeOut(Math.min(1, (e.age + 1) / 5));
  const a = Math.min(1, e.life / 6);
  const w = 12 + Math.sin(t * 37) * 1.5 + Math.sin(t * 23 + 1) * 1.2;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';    // soft bloom around the shaft
  const g = ctx.createLinearGradient(0, -w * 2.2, 0, w * 2.2);
  g.addColorStop(0, kit.rgba(pal.bolt, 0)); g.addColorStop(0.5, kit.rgba(pal.bolt, 0.35)); g.addColorStop(1, kit.rgba(pal.bolt, 0));
  ctx.fillStyle = g; ctx.fillRect(0, -w * 2.2, len, w * 4.4);
  ctx.restore();
  kit.capsulePath(ctx, 0, 0, len, 0, w * 0.95 + 3); ctx.fillStyle = pal.outline; ctx.fill();
  kit.capsulePath(ctx, 0, 0, len, 0, w * 0.95);
  const body = ctx.createLinearGradient(0, -w, 0, w);
  body.addColorStop(0, pal.bolt); body.addColorStop(0.5, kit.mix(pal.bolt, '#ffffff', 0.55)); body.addColorStop(1, kit.mix(pal.bolt, pal.mid, 0.35));
  ctx.fillStyle = body; ctx.fill();
  kit.capsulePath(ctx, 0, 0, len, 0, Math.max(1.5, w * 0.34)); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.fillStyle = '#ffffff';                                 // energy bands rolling outward
  for (let i = 0; i < 5; i++) {
    const x = ((t * 2.4 + i / 5) % 1) * len;
    ctx.globalAlpha = a * 0.75;
    ctx.beginPath(); ctx.ellipse(x, 0, w * 0.8, w * 0.42, 0, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = a;
  for (let i = 0; i < 2; i++) bolt(ctx, rng, 6, (i ? 1 : -1) * w * 0.3, len - 4, (rng() - 0.5) * w * 0.6, pal, 2.2, 0.8, { jag: 0.04, segments: 16, color: i ? pal.spark : pal.bolt, outline: false });
  // muzzle (an orb at the mouth) and the crackling impact end
  for (const [x, r] of [[0, w * 1.4], [len, w * 1.2 + Math.sin(t * 40) * 2]]) {
    ctx.fillStyle = pal.outline; ctx.beginPath(); ctx.arc(x, 0, r + 2.6, 0, TAU); ctx.fill();
    ctx.fillStyle = pal.bolt; ctx.beginPath(); ctx.arc(x, 0, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, 0, r * 0.55, 0, TAU); ctx.fill();
  }
  for (let i = 0; i < 4; i++) {
    const ang = (rng() - 0.5) * 2.6, l = 16 + rng() * 18;
    bolt(ctx, rng, len + 8, 0, len + 8 + Math.cos(ang) * l, Math.sin(ang) * l, pal, 2.4, 0.95, { segments: 3, jag: 0.4 });
  }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, 0, 0, 28, pal.bolt, 0.5);
  kit.glow(ctx, len, 0, 24, pal.bolt, 0.5);
  ctx.restore();
  ctx.restore();
}

// ── ArtDef ───────────────────────────────────────────────────────────────────
export default {
  rig: 'none',
  bounds: { left: -132, right: 182, top: -210, bottom: 34 },
  palette: PAL,
  palettes: ALT_PALETTES,

  draw(ctx, v, info) {
    const bs = v.bodyScale || 1;
    if (bs !== 1) ctx.scale(bs, bs);
    paint(ctx, v, info, info.palette);
  },

  // Behind every fighter: a charged storm hums with a soft electric aura.
  drawBack(ctx, v, info) {
    const c = clamp((v.resources?.charge || 0) / (v.resMax?.charge || 100), 0, 1);
    if (c < 0.2) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, 0, -44 * (v.bodyScale || 1), 64 + c * 20 + Math.sin(info.time * 5) * 4, info.palette.bolt, 0.12 + c * 0.16);
    ctx.restore();
  },

  // World space (unclipped, not mirrored): rain that falls past the body bounds.
  drawWorld(ctx, v, info) {
    const pal = info.palette, f = v.facing < 0 ? -1 : 1;
    const hov = hoverAmt(v, info);
    if (hov > 0.05 && !(v.move && v.move.anim === 'rise')) rain(ctx, info.time, { x: 2 * f, y: -6, w: 64, h: 70, color: pal.rain, alpha: 0.55 * hov, density: 0.8, slant: 0.1 * f, seed: 1, under: pal.outline });
    if (v.move?.anim === 'rise' && v.move.phase !== 'startup') {
      const a = v.move.phase === 'active' ? 1 : 1 - v.move.phaseT;
      rain(ctx, info.time, { x: 0, y: -10, w: 72, h: 130, color: pal.rain, alpha: a, density: 1.5, slant: 0.05, seed: 8, under: pal.outline });
    }
  },

  entities: {
    raincloud: {
      draw(ctx, e, info) {
        const pal = info.palette, t = info.time;
        const fade = Math.min(0.4 + 0.6 * Math.min(1, e.age / 12), e.life / 30); // puffs in from 40%: readable from frame 0
        const L = bodyLight(info, e.facing);
        rain(ctx, t, { x: 0, y: 12, w: 112, h: 200, color: pal.rain, alpha: fade, density: 1.25, slant: 0.12, seed: 11, under: pal.outline });
        const P = RAIN_PUFFS.map(([x, y, r], i) => ({ x: x + Math.sin(t * 1.1 + i) * 1.5, y: y + Math.sin(t * 1.6 + i * 2) * 1.5, r: r * (0.4 + 0.6 * fade) }));
        const fl = kit.noise1(t * 7 + (e.id | 0), 13) > 0.86 ? 0.6 : 0;
        drawCloud(ctx, P, pal, L, { outline: 2.8, alpha: fade, flash: fl, flashAt: { x: 0, y: 0 } });
        ctx.save(); ctx.globalAlpha *= fade;
        drawFace(ctx, { x: 6, y: -2 }, pal, kit.noise1(t * 0.5, 4) > 0.7 ? 'sleep' : 'grumpy', t, { scale: 0.55, look: { x: 0.2, y: 1 }, glow: 0.2 });
        ctx.restore();
      },
    },
    strike: { draw(ctx, e, info) { drawStrike(ctx, e, info, false); } },
    bigStrike: { draw(ctx, e, info) { drawStrike(ctx, e, info, true); } },
    ionBeam: { draw(ctx, e, info) { drawBeam(ctx, e, info); } },
  },

  trail(v) {
    const a = v.move?.anim;
    return a === 'flatten' || a === 'rise' || a === 'blow' || a === 'grumble' || a === 'prickle' ? false : null;
  },

  fx: {
    onHit(fx, ev, info) {
      const P = info.palette, dmg = ev.damage || 0, pow = clamp((ev.kb || 0) / 120, 0, 1);
      const launch = (ev.dir || 1) < 0 ? 180 - (ev.angle ?? 45) : (ev.angle ?? 45);
      const { x, y } = ev;
      switch (ev.effect) {
        case 'water':
          fx.burst({ x, y, count: dmg < 2 ? 3 : 8 + dmg, shape: 'drip', colors: [P.rain, '#ffffff'], speed: [1.5, 5 + pow * 4], angle: 90, spread: 150, gravity: 0.35, life: [14, 26], size: [2, 4] });
          if (dmg >= 2) fx.ring({ x, y, r0: 8, r1: 34 + pow * 30, color: P.rain, life: 14, width: 3 });
          return;
        case 'ice':
          fx.burst({ x, y, count: 8 + dmg, shape: 'shard', colors: [P.ice, '#ffffff', P.light], speed: [3, 9], angle: launch, spread: 140, gravity: 0.25, spin: 0.3, life: [16, 28], size: [3, 6] });
          fx.burst({ x, y, count: 6, shape: 'glow', color: P.ice, speed: [0.5, 2], life: [8, 14], size: [10, 18], blend: 'lighter' });
          return;
        case 'wind':
          fx.burst({ x, y, count: 6 + dmg, shape: 'streak', colors: ['#ffffff', P.hi], speed: [8, 14], angle: launch, spread: 40, life: [8, 14], size: [2, 3] });
          fx.burst({ x, y, count: 4, shape: 'smoke', colors: [P.light, P.hi], speed: [1, 3], life: [18, 30], size: [8, 14] });
          return;
        default: {                                 // electric
          fx.burst({ x, y, count: 6 + dmg, shape: 'spark', colors: [P.bolt, P.spark, '#ffffff'], speed: [3, 8 + pow * 6], angle: launch, spread: 200, life: [10, 20], blend: 'lighter' });
          const n = 2 + Math.round(pow * 3);
          for (let i = 0; i < n; i++) {
            const a = (launch + (i / n - 0.5) * 140) * Math.PI / 180, l = 30 + dmg * 3 + pow * 40;
            fx.line({ x, y, x2: x + Math.cos(a) * l, y2: y - Math.sin(a) * l, color: P.bolt, core: '#ffffff', width: 2.5, jag: 9, life: 7 });
          }
          if (pow > 0.6) fx.flash(P.bolt, 0.12, 2);
        }
      }
    },
    onHurt(fx, ev, info) {                        // vapor knocked loose
      const P = info.palette;
      fx.burst({ x: ev.x, y: ev.y, count: 3 + Math.round((ev.damage || 0) / 3), shape: 'smoke', colors: [P.light, P.mid, P.hi], speed: [2, 5], life: [16, 28], size: [6, 12], drag: 0.9 });
    },
    onLand(fx, ev, info) {                        // a cloud doesn't kick dust, it spreads vapor
      const P = info.palette, n = ev.heavy ? 5 : 3;
      for (const ang of [0, 180]) fx.burst({ x: ev.x, y: ev.y - 6, count: n, shape: 'smoke', colors: [P.light, P.hi], speed: [1.5, 3.5], angle: ang, spread: 20, drag: 0.9, life: [20, 34], size: [8, 14] });
      if (ev.heavy) fx.burst({ x: ev.x, y: ev.y - 4, count: 6, shape: 'drip', color: P.rain, speed: [1.5, 3.5], angle: 90, spread: 120, gravity: 0.3, life: [12, 20], size: [2, 3] });
    },
    onJump(fx, ev, info) {
      const P = info.palette;
      fx.ring({ x: ev.x, y: ev.y - 4, r0: 10, r1: ev.double ? 46 : 34, color: P.hi, life: 14, width: 4, flat: true, alpha: 0.8 });
      fx.burst({ x: ev.x, y: ev.y - 4, count: ev.double ? 8 : 4, shape: 'drip', color: P.rain, speed: [1, 2.5], angle: 270, spread: 60, gravity: 0.35, life: [12, 22], size: [2, 3] });
    },
    onKO(fx, ev, info) {                          // the storm pops: bolts, vapor and a last rumble
      const P = info.palette;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.3, l = 90 + (i % 2) * 50;
        fx.line({ x: ev.x, y: ev.y, x2: ev.x + Math.cos(a) * l, y2: ev.y + Math.sin(a) * l, color: P.bolt, core: '#ffffff', width: 4, jag: 16, life: 12 });
      }
      fx.burst({ x: ev.x, y: ev.y, count: 20, shape: 'smoke', colors: [P.mid, P.light, P.dark], speed: [3, 10], drag: 0.9, life: [26, 44], size: [10, 20] });
      fx.burst({ x: ev.x, y: ev.y, count: 18, shape: 'drip', colors: [P.rain, '#ffffff'], speed: [4, 10], gravity: 0.3, life: [20, 36], size: [2, 4] });
      fx.flash(P.bolt, 0.25, 4);
      fx.sound('thunder', { volume: 0.9, pitch: 0.8 });
    },
    onRespawn(fx, ev, info) {                     // condenses out of thin air
      const P = info.palette;
      fx.ring({ x: ev.x, y: ev.y - 44, r0: 90, r1: 24, color: P.hi, life: 22, width: 5, alpha: 0.8 });
      fx.burst({ x: ev.x, y: ev.y - 44, count: 14, shape: 'spark', colors: [P.bolt, P.spark], speed: [1, 4], life: [16, 26], blend: 'lighter' });
    },
    onMove: {
      upSpecial(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 6, count: 8, shape: 'smoke', colors: [info.palette.light, info.palette.hi], speed: [2, 4], angle: 270, spread: 100, life: [18, 30], size: [8, 14] }); },
      sideSpecial(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 40, count: 5, shape: 'smoke', color: info.palette.hi, speed: [1, 2], life: [16, 26], size: [8, 12] }); },
    },
    onEvent: {
      thunder(fx, ev) {
        const big = !!ev.data?.big;
        fx.flash('#e8fbff', big ? 0.3 : 0.15, big ? 5 : 3);
        fx.shake(big ? 7 : 3);
        fx.sound('thunder', { volume: big ? 1 : 0.6, pitch: big ? 0.85 : 1.1 });
      },
      discharge(fx, ev, info) {
        const P = info.palette, cy = ev.y - 40;
        fx.ring({ x: ev.x, y: cy, r0: 20, r1: 74, color: P.bolt, life: 12, width: 5, blend: 'lighter' });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          fx.line({ x: ev.x + Math.cos(a) * 24, y: cy + Math.sin(a) * 24, x2: ev.x + Math.cos(a) * 70, y2: cy + Math.sin(a) * 70, color: P.bolt, width: 3, jag: 10, life: 8 });
        }
        fx.shake(4);
        fx.sound('zap', { volume: 0.8 });
      },
      rumble(fx, ev, info) {
        fx.sound('thunder', { volume: 0.4, pitch: 0.7 });
        fx.shake(2);
        fx.burst({ x: ev.x, y: ev.y - 84, count: 4, shape: 'smoke', color: info.palette.dark, speed: [0.5, 1.5], angle: 90, spread: 60, life: [24, 40], size: [8, 14] });
      },
      rod(fx, ev, info) {
        fx.line({ x: ev.x, y: ev.y - 90, x2: ev.x, y2: ev.y - 320, color: info.palette.bolt, core: '#ffffff', width: 6, jag: 18, life: 10 });
        fx.flash('#e8fbff', 0.18, 3);
        fx.sound('zap', { volume: 0.9, pitch: 0.8 });
      },
    },
  },

  sounds: { jump: 'whoosh', 'zap-loop': 'zap', 'rain-start': 'splash' },

  // HUD / select portrait: a close-up of the grump with a bolt behind it.
  portrait(ctx, size, info) {
    const pal = info.palette, k = size / 104;
    ctx.save();
    ctx.translate(size / 2 - 3 * k, size / 2 + 46 * k);
    ctx.scale(k, k);
    kit.lightning(ctx, 7, -52, -112, -22, -60, pal.bolt, 3, 0.9, { core: '#ffffff', glow: 10, segments: 6 });
    kit.lightning(ctx, 19, 58, -104, 34, -70, pal.bolt, 2.2, 0.75, { core: '#ffffff', segments: 5 });
    const P = BASE.map(([x, y, r]) => ({ x, y, r }));
    drawCloud(ctx, P, pal, bodyLight(info, 1), { outline: 3.4 });
    const c = P[CORE];
    drawFace(ctx, { x: c.x + FACE.x, y: c.y + FACE.y }, pal, 'grumpy', 0.5, { look: { x: 0.35, y: 0 }, glow: 0.55 });
    ctx.restore();
  },
};
