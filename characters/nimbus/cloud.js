// Nimbus art: the cloud renderer (merged puffs, 3 value tiers, rim light, belly
// shadow, inner lightning) and the face. Body space: feet origin, +x forward.
import * as kit from '../../shared/art/kit.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const easeIn = (t) => clamp(t, 0, 1) ** 2;
export const backOut = (t) => { t = clamp(t, 0, 1) - 1; return 1 + t * t * (2.7 * t + 1.7); };

// Storm slate body, cyan-white electricity, buttery eyes. Alt palettes for duplicate picks.
export const PAL = {
  outline: '#191a36', dark: '#343a66', mid: '#4f5890', light: '#7a84bd', hi: '#b2b9e6', belly: '#20234a',
  eye: '#fff3b8', eyeGlow: '#ffd75e', bolt: '#9ff4ff', boltCore: '#ffffff', spark: '#fff59a',
  rain: '#8fd0ff', ice: '#e2f8ff', mouth: '#0d0e26',
  main: '#4f5890', effect: '#9ff4ff', secondary: '#fff59a',
};
export const ALT_PALETTES = [
  {},
  { outline: '#231436', dark: '#47306b', mid: '#664a94', light: '#9378c2', hi: '#c6b0ec', belly: '#2b1c48', bolt: '#ffb8f4', spark: '#ffe0fa', eye: '#fff0fb', eyeGlow: '#ff9be8', main: '#664a94', effect: '#ffb8f4' },
  { outline: '#12261d', dark: '#2a4a3c', mid: '#436a58', light: '#6c9682', hi: '#a6cdb8', belly: '#183026', bolt: '#d6ff8a', spark: '#f2ffc4', eye: '#f4ffd8', eyeGlow: '#c8ff6a', main: '#436a58', effect: '#d6ff8a' },
  { outline: '#26160f', dark: '#4c3327', mid: '#6d4f40', light: '#987566', hi: '#cfab9a', belly: '#2f1f17', bolt: '#ffb46a', spark: '#ffe6b0', eye: '#ffe6b8', eyeGlow: '#ff9a3c', main: '#6d4f40', effect: '#ffb46a' },
];

// Base puffs [x, y, r]. Back to front; the first five form the dark belly line.
export const BASE = [
  [-31, -30, 18], [-13, -21, 17], [12, -21, 18], [32, -31, 19],
  [1, -42, 28], [-21, -54, 18], [16, -59, 21], [-3, -70, 13],
];
export const CORE = 4; // index of the big puff the face sits on

/** Light direction in body space (the body canvas is mirrored by facing). */
export function bodyLight(info, facing) {
  const d = info.light?.dir || { x: -0.45, y: -0.89 };
  const x = d.x * (facing < 0 ? -1 : 1), y = d.y, n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n, rim: info.light?.rim || '#ffc48a' };
}

function union(ctx, P, grow = 0, dx = 0, dy = 0) {
  ctx.beginPath();
  for (const p of P) {
    const r = Math.max(0.5, p.r + grow);
    ctx.moveTo(p.x + dx + r, p.y + dy);
    ctx.arc(p.x + dx, p.y + dy, r, 0, TAU);
  }
}

/**
 * Paints a merged puff cluster. P: [{x, y, r, top?}]. o: { outline, flash (0..1),
 * flashAt {x,y}, grey (0..1), alpha, contour }.
 */
export function drawCloud(ctx, P, pal, L, o = {}) {
  if (!P.length) return;
  const ow = o.outline ?? 3.2;
  const grey = o.grey || 0;
  const col = (c) => (grey ? kit.mix(c, '#8a8a94', grey * 0.6) : c);
  let minY = Infinity, maxY = -Infinity;
  for (const p of P) { minY = Math.min(minY, p.y - p.r); maxY = Math.max(maxY, p.y + p.r); }
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  // Outline: the union grown by the stroke width (no inner seams).
  union(ctx, P, ow); ctx.fillStyle = col(pal.outline); ctx.fill();
  ctx.save();
  union(ctx, P); ctx.clip();
  // Rim tier: whatever the away-shifted body doesn't cover is the lit edge.
  ctx.fillStyle = kit.mix(col(pal.hi), L.rim, 0.62); ctx.fillRect(-600, -600, 1200, 1200);
  union(ctx, P, 0, -L.x * 2.4, -L.y * 2.4); ctx.clip();
  ctx.fillStyle = col(pal.dark); ctx.fillRect(-600, -600, 1200, 1200);
  // Mid and light tiers: each puff's lit cap, shifted toward the light.
  ctx.fillStyle = col(pal.mid);
  ctx.beginPath();
  for (const p of P) { const r = p.r * 0.9; ctx.moveTo(p.x + L.x * p.r * 0.14 + r, p.y + L.y * p.r * 0.14); ctx.arc(p.x + L.x * p.r * 0.14, p.y + L.y * p.r * 0.14, r, 0, TAU); }
  ctx.fill();
  ctx.fillStyle = col(pal.light);
  ctx.beginPath();
  for (const p of P) { const r = p.r * 0.62, cx = p.x + L.x * p.r * 0.36, cy = p.y + L.y * p.r * 0.36; ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
  ctx.fill();
  ctx.globalAlpha *= 0.85;
  ctx.fillStyle = col(pal.hi);
  ctx.beginPath();
  for (const p of P) {
    if (p.y > (minY + maxY) / 2 || p.r < 9) continue;
    const r = p.r * 0.26, cx = p.x + L.x * p.r * 0.5, cy = p.y + L.y * p.r * 0.5;
    ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU);
  }
  ctx.fill();
  ctx.globalAlpha /= 0.85;
  // Cauliflower seams: a dark arc on the shadow side of every upper puff.
  if (o.contour !== false) {
    const a = Math.atan2(-L.y, -L.x);
    ctx.strokeStyle = kit.rgba(col(pal.outline), 0.42); ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    for (const p of P) {
      if (p.r < 10 || p.y > maxY - 14) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 1.2, a - 0.95, a + 0.75); ctx.stroke();
    }
  }
  // Storm belly: the flat base sinks into deep shadow.
  const g = ctx.createLinearGradient(0, maxY - 24, 0, maxY);
  g.addColorStop(0, kit.rgba(col(pal.belly), 0)); g.addColorStop(1, kit.rgba(col(pal.belly), 0.85));
  ctx.fillStyle = g; ctx.fillRect(-600, maxY - 24, 1200, 26);
  // Lightning lit from inside.
  if (o.flash > 0.01) {
    const f = o.flashAt || { x: 0, y: (minY + maxY) / 2 };
    ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, f.x, f.y, 34 + o.flash * 22, pal.bolt, 0.55 * o.flash);
    kit.glow(ctx, f.x, f.y, 12 + o.flash * 8, '#ffffff', 0.5 * o.flash);
  }
  ctx.restore();
  ctx.restore();
}

/**
 * The face. f = {x, y} between the eyes (body space), expr: 'grumpy' | 'effort' |
 * 'roar' | 'blow' | 'hurt' | 'dizzy' | 'sleep' | 'happy'. look = {x, y} pupil offset (-1..1).
 */
export function drawFace(ctx, f, pal, expr, t, o = {}) {
  const s = o.scale || 1, look = o.look || { x: 0.6, y: 0 }, blink = o.blink || 0, glow = o.glow ?? 0.35;
  const ink = pal.outline;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.scale(s, s);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const eyes = [{ x: -9, rx: 5.2, ry: 6.6 }, { x: 9, rx: 6.2, ry: 7.6 }]; // far eye smaller (3/4 view)
  if (expr === 'hurt') {
    ctx.strokeStyle = ink; ctx.lineWidth = 3.4;
    for (const e of eyes) { ctx.beginPath(); ctx.moveTo(e.x - 5, -5); ctx.lineTo(e.x + 4, 0); ctx.lineTo(e.x - 5, 5); ctx.stroke(); }
  } else if (expr === 'dizzy') {
    ctx.strokeStyle = pal.eye; ctx.lineWidth = 2.2;
    for (const e of eyes) {
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) { const a = i * 0.55 + t * 9, r = i * 0.27; ctx[i ? 'lineTo' : 'moveTo'](e.x + Math.cos(a) * r, Math.sin(a) * r); }
      ctx.stroke();
    }
  } else if (expr === 'sleep' || blink > 0.85) {
    ctx.strokeStyle = ink; ctx.lineWidth = 3;
    for (const e of eyes) { ctx.beginPath(); ctx.arc(e.x, -1, e.rx, 0.25, Math.PI - 0.25); ctx.stroke(); }
  } else {
    const squint = expr === 'effort' ? 0.45 : expr === 'happy' ? 0.5 : 1 - blink;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of eyes) kit.glow(ctx, e.x, 0, e.ry * 2.6, pal.eyeGlow, glow);
    ctx.restore();
    for (const e of eyes) {
      kit.ellipse(ctx, e.x, 0, e.rx + 1.6, e.ry * squint + 1.6, ink, { outline: null });
      ctx.beginPath(); ctx.ellipse(e.x, 0, e.rx, Math.max(0.6, e.ry * squint), 0, 0, TAU);
      ctx.fillStyle = pal.eye; ctx.fill();
      // pupil
      if (expr !== 'roar' || o.pupils) {
        ctx.save(); ctx.clip();
        ctx.fillStyle = ink;
        ctx.beginPath(); ctx.ellipse(e.x + look.x * e.rx * 0.45, look.y * e.ry * 0.35 + 0.5, e.rx * 0.42, e.ry * 0.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(e.x + look.x * e.rx * 0.45 - 1.2, look.y * e.ry * 0.35 - 1.6, 1.3, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
    // Heavy lids slanting inward: the grump.
    if (expr !== 'happy') {
      const k = expr === 'roar' || expr === 'effort' ? 1.25 : 1;
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.moveTo(-16, -9 * k); ctx.lineTo(-2, -2.5 * k + 1); ctx.lineTo(-2, -9); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(17, -10 * k); ctx.lineTo(1.5, -2.8 * k + 1); ctx.lineTo(1.5, -10); ctx.closePath(); ctx.fill();
    }
  }
  // Brow ridge (a thick storm-dark V).
  if (expr !== 'happy' && expr !== 'sleep') {
    const k = expr === 'hurt' || expr === 'dizzy' ? -0.6 : expr === 'roar' || expr === 'effort' ? 1.3 : 1;
    ctx.strokeStyle = ink; ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.moveTo(-17, -11 - 1.5 * k); ctx.quadraticCurveTo(-8, -10, 0, -6 + 2.5 * k); ctx.quadraticCurveTo(9, -10, 19, -12 - 2 * k); ctx.stroke();
  }
  // Mouth
  ctx.fillStyle = pal.mouth; ctx.strokeStyle = ink;
  if (expr === 'roar' || expr === 'blow') {
    const open = clamp(o.open ?? 1, 0, 1.4);
    const w = expr === 'blow' ? 5 : 10, h = (expr === 'blow' ? 5 : 7) * open + 1.5;
    ctx.beginPath();
    if (expr === 'blow') ctx.ellipse(4, 15, w, h, 0, 0, TAU);
    else { ctx.moveTo(-8, 12); ctx.quadraticCurveTo(2, 9, 14, 11); ctx.quadraticCurveTo(10, 13 + h * 2, 1, 13 + h * 2.1); ctx.quadraticCurveTo(-7, 13 + h * 1.6, -8, 12); }
    ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
    if (o.mouthGlow > 0) {
      ctx.save(); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      kit.glow(ctx, 3, 14 + h, 14, pal.bolt, 0.9 * o.mouthGlow);
      ctx.restore();
    }
  } else if (expr === 'hurt' || expr === 'dizzy') {
    ctx.lineWidth = 2.6; ctx.beginPath();
    for (let i = 0; i <= 6; i++) ctx[i ? 'lineTo' : 'moveTo'](-7 + i * 3, 14 + (i % 2 ? -2 : 2));
    ctx.stroke();
  } else if (expr === 'happy') {
    ctx.lineWidth = 2.8; ctx.beginPath(); ctx.arc(3, 9, 7, 0.35, Math.PI - 0.35); ctx.stroke();
  } else if (expr !== 'sleep') {
    // grumpy frown that grumbles a little
    const w = Math.sin(t * 3.1) * 0.8;
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-6, 15 + w); ctx.quadraticCurveTo(3, 9.5, 12, 14 - w); ctx.stroke();
  }
  ctx.restore();
}

/** Crawling static arcs between random points on the upper body (rng = info.rng). */
export function staticArcs(ctx, rng, P, pal, n, alpha = 1) {
  if (n <= 0 || P.length < 2) return;
  for (let i = 0; i < n; i++) {
    const a = P[(rng() * P.length) | 0], b = P[(rng() * P.length) | 0];
    if (a === b) continue;
    const aa = rng() * TAU, ba = rng() * TAU;
    kit.lightning(ctx, rng, a.x + Math.cos(aa) * a.r * 0.8, a.y + Math.sin(aa) * a.r * 0.8, b.x + Math.cos(ba) * b.r * 0.8, b.y + Math.sin(ba) * b.r * 0.8, pal.bolt, 1.4, alpha, { core: pal.boltCore, jag: 0.3 });
  }
}

/**
 * A lightning bolt that reads on bright skies too: dark outline, colored body,
 * white core (source-over), plus an optional additive glow. Returns the points.
 */
export function bolt(ctx, rng, x1, y1, x2, y2, pal, width = 4, alpha = 1, { branches = 0, jag = 0.18, segments = 0, glow = 0, color = pal.bolt, outline = true } = {}) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const n = segments || Math.max(4, Math.round(len / 16));
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  const pts = [[x1, y1]];
  for (let i = 1; i < n; i++) {
    const t = i / n, off = (rng() - 0.5) * 2 * jag * len / Math.sqrt(n) * Math.sin(Math.PI * t) * 1.6;
    pts.push([lerp(x1, x2, t) + nx * off, lerp(y1, y2, t) + ny * off]);
  }
  pts.push([x2, y2]);
  const paths = [pts];
  for (let b = 0; b < branches; b++) {
    const i = 1 + Math.floor(rng() * (n - 2)), [bx, by] = pts[i];
    const bl = len * (0.12 + rng() * 0.2), ba = Math.atan2(y2 - y1, x2 - x1) + (rng() < 0.5 ? -1 : 1) * (0.4 + rng() * 0.5);
    const q = [[bx, by]];
    for (let j = 1; j <= 3; j++) q.push([bx + Math.cos(ba) * bl * j / 3 + (rng() - 0.5) * bl * 0.25, by + Math.sin(ba) * bl * j / 3 + (rng() - 0.5) * bl * 0.25]);
    paths.push(q);
  }
  const stroke = (w, c, a, sub = 1) => {
    ctx.globalAlpha = a; ctx.strokeStyle = c;
    paths.forEach((P, k) => {
      ctx.lineWidth = Math.max(0.6, k ? w * 0.55 * sub : w);
      ctx.beginPath(); P.forEach(([px, py], i) => ctx[i ? 'lineTo' : 'moveTo'](px, py)); ctx.stroke();
    });
  };
  ctx.save();
  const base = ctx.globalAlpha * alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (glow) { ctx.globalCompositeOperation = 'lighter'; stroke(glow, kit.rgba(color, 0.3), base * 0.8); ctx.globalCompositeOperation = 'source-over'; }
  if (outline) stroke(width + clamp(width * 0.7, 2, 4), pal.outline, base * 0.9);
  stroke(width, color, base);
  stroke(Math.max(0.8, width * 0.42), '#ffffff', base);
  ctx.restore();
  return pts;
}

/** Rain streaks in a column (top-centered at x,y). Respects the parent alpha. */
export function rain(ctx, time, { x = 0, y = 0, w = 80, h = 120, color = '#8fd0ff', alpha = 1, density = 1, slant = 0.16, speed = 520, seed = 0, under = null } = {}) {
  const n = Math.round((w * h) / 240 * density);
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const px = x - w / 2 + kit.hash01(i, 7 + seed) * w;
    const ly = (kit.hash01(i, 11 + seed) * h + time * speed * (0.8 + kit.hash01(i, 3 + seed) * 0.4)) % h;
    const len = 9 + kit.hash01(i, 5 + seed) * 11;
    const k = Math.min(1, ly / 18, (h - ly) / 30);
    if (k <= 0) continue;
    const lw = 1.1 + kit.hash01(i, 9 + seed) * 1.1;
    if (under) {                                    // a dark backing so rain reads on a bright sky
      ctx.globalAlpha = base * alpha * k * 0.4; ctx.strokeStyle = under; ctx.lineWidth = lw + 1.6;
      ctx.beginPath(); ctx.moveTo(px - slant * len, y + ly - len); ctx.lineTo(px, y + ly); ctx.stroke();
      ctx.strokeStyle = color;
    }
    ctx.globalAlpha = base * alpha * k * 0.85;
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(px - slant * len, y + ly - len); ctx.lineTo(px, y + ly); ctx.stroke();
  }
  ctx.restore();
}

/** A faceted hailstone / ice shard with outline and a bright facet. */
export function hail(ctx, x, y, r, rot, pal) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  const pts = [];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, rr = r * (0.78 + kit.hash01(i, Math.round(r * 7)) * 0.32); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  ctx.beginPath(); pts.forEach(([px, py], i) => ctx[i ? 'lineTo' : 'moveTo'](px, py)); ctx.closePath();
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1.6, r * 0.18); ctx.strokeStyle = pal.outline; ctx.stroke();
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, pal.ice); g.addColorStop(1, kit.mix(pal.ice, pal.mid, 0.55));
  ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.moveTo(pts[3][0] * 0.5, pts[3][1] * 0.5); ctx.lineTo(pts[4][0] * 0.8, pts[4][1] * 0.8); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** Curved wind streaks along +x from (x, y), length len, spread h. */
export function windLines(ctx, time, x, y, len, h, color, { n = 7, alpha = 0.8, width = 2.4, seed = 0 } = {}) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  const base = ctx.globalAlpha;
  for (let i = 0; i < n; i++) {
    const oy = (kit.hash01(i, 31 + seed) - 0.5) * h;
    const ph = (time * 2.6 + kit.hash01(i, 37 + seed)) % 1;
    const sx = x + ph * len * 0.75, l = len * (0.22 + kit.hash01(i, 41 + seed) * 0.2);
    ctx.globalAlpha = base * alpha * Math.sin(ph * Math.PI);
    ctx.lineWidth = width * (0.6 + kit.hash01(i, 43 + seed) * 0.7);
    ctx.beginPath(); ctx.moveTo(sx, y + oy);
    ctx.bezierCurveTo(sx + l * 0.4, y + oy - 4, sx + l * 0.7, y + oy + 3, sx + l, y + oy - 2);
    ctx.stroke();
  }
  ctx.restore();
}
