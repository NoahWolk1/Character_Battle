// characters/gertie/scooter.js — the procedural half of Gertie's art: her turbo mobility
// scooter, the props her sprite hands hold (cane, handbag, umbrella, hat pin, rolling pin,
// reacher-grabber, coin purse), the spray/flame/steam effects and the entity painters.
//
// Every solid is painted with paint(): shade tier, base tier shifted toward the light,
// a soft light-tier highlight, a rim band from the stage light, and a plum outline.
// Shapes are sub-path builders (no beginPath) so paint() can reuse them for clip/rim/outline.
import * as kit from '../../shared/art/kit.js';

export const OUT = '#3a2340';
export const LW = 2.8;
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIn = (t) => t * t;
export const backOut = (t) => { const s = 1.7; const u = t - 1; return 1 + u * u * ((s + 1) * u + s); };

// ── materials [base, shade, light] ───────────────────────────────────────────
export const MAT = Object.freeze({
  chrome: ['#d5dae8', '#878ca6', '#ffffff'],
  tire: ['#4b3a55', '#2b2033', '#7d6a8c'],
  seat: ['#6e3f7e', '#462452', '#a274b0'],
  wicker: ['#d9a55a', '#9f6a2e', '#ffd88e'],
  wood: ['#bf7d40', '#7c4a22', '#eab077'],
  bag: ['#36a58e', '#1f6f63', '#8ae6cc'],
  purse: ['#e8b23a', '#a87418', '#ffe08a'],
  canopy: ['#ff8fb0', '#c75b83', '#ffd2e0'],
  cream: ['#fff4e2', '#d9c3b4', '#ffffff'],
  flag: ['#ff9a3d', '#cf5e1c', '#ffd28a'],
  rubber: ['#e8505b', '#a33042', '#ff9a9a'],
  pearl: ['#fffaf0', '#cbbdd0', '#ffffff'],
  yarnA: ['#e86fa0', '#a8406e', '#ffb4d0'],
  yarnB: ['#6fd6c0', '#2f9682', '#c4fff0'],
});

/** Scooter shell materials from the (alt-resolved) palette. */
export const shellMat = (P) => [P.scooter || '#e8505b', P.scooterDark || '#a52f45', P.scooterLight || '#ff9c94'];

// ── sub-path builders ────────────────────────────────────────────────────────
export const S = {
  circle: (x, y, r) => (c) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); c.closePath(); },
  ellipse: (x, y, rx, ry, rot = 0) => (c) => { c.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.closePath(); },
  rr: (x, y, w, h, r) => (c) => {
    r = Math.min(r, w / 2, h / 2);
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  },
  poly: (pts) => (c) => { pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); },
  blob: (pts, tension = 0.5) => (c) => {
    const n = pts.length, k = tension / 3;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      if (i === 0) c.moveTo(p1[0], p1[1]);
      c.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]);
    }
    c.closePath();
  },
  capsule: (x1, y1, x2, y2, r1, r2 = r1) => (c) => {
    const a = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1) || 1e-4;
    const off = Math.asin(clamp((r1 - r2) / len, -1, 1));
    c.moveTo(x1 + Math.cos(a + Math.PI / 2 + off) * r1, y1 + Math.sin(a + Math.PI / 2 + off) * r1);
    c.arc(x1, y1, r1, a + Math.PI / 2 + off, a - Math.PI / 2 - off);
    c.arc(x2, y2, r2, a - Math.PI / 2 - off, a + Math.PI / 2 + off);
    c.closePath();
  },
};

/**
 * Paints a solid: shade tier, base tier (shifted k px toward the light), optional light
 * highlight hi = [x, y, r], clipped details, the rim band, then the outline.
 * L = { x, y, rim, q } — light direction (local space), rim color, quality ('low' skips gloss/rim).
 */
export function paint(c, shape, M, L, o = {}) {
  c.save();
  c.beginPath(); shape(c);
  c.fillStyle = M[1]; c.fill();
  c.save(); c.clip();
  const k = o.k ?? 2;
  c.translate(L.x * k, L.y * k);
  c.beginPath(); shape(c); c.fillStyle = M[0]; c.fill();
  c.translate(-L.x * k, -L.y * k);
  const hq = L.q !== 'low';
  if (o.hi && hq) {
    const [hx, hy, hr] = o.hi, gx = hx + L.x * hr * 0.45, gy = hy + L.y * hr * 0.45;
    const g = c.createRadialGradient(gx, gy, 0, gx, gy, hr);
    g.addColorStop(0, kit.rgba(M[2], 0.85)); g.addColorStop(1, kit.rgba(M[2], 0));
    c.fillStyle = g; c.fillRect(gx - hr, gy - hr, hr * 2, hr * 2);
  }
  if (o.detail) { c.save(); o.detail(c); c.restore(); }
  if (L.rim && o.rim !== false && hq) {
    const w = o.rimW ?? 3.2;
    c.beginPath(); c.rect(-3000, -3000, 6000, 6000);
    c.translate(-L.x * w, -L.y * w); shape(c); c.translate(L.x * w, L.y * w);
    c.globalAlpha *= o.rimA ?? 0.75; c.fillStyle = L.rim; c.fill('evenodd');
  }
  c.restore();
  if (o.lw !== 0) {
    c.beginPath(); shape(c);
    c.lineWidth = o.lw ?? LW; c.strokeStyle = o.out ?? OUT; c.lineJoin = 'round'; c.stroke();
  }
  c.restore();
}

/** Interior line (seams, ribs, wrinkles). */
export function seam(c, pts, color, w = 1.2, alpha = 1) {
  c.save();
  c.globalAlpha *= alpha; c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
  c.restore();
}

/** Frame-rate independent damped spring held in a cache slot {x, v}. */
export function spring(s, target, dt, k = 120, d = 10) {
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = Math.min(dt, 0.1) / n;
  for (let i = 0; i < n; i++) { s.v += (k * (target - s.x) - d * s.v) * h; s.x += s.v * h; }
  return s.x;
}

// ── the scooter ──────────────────────────────────────────────────────────────
// Body px, feet origin, +x forward. Gertie's hip sits on the cushion at (-16, -48).
export const GEO = Object.freeze({
  rear: [-30, -10, 10], front: [33, -8.5, 8.5], pipe: [-50, -21], light: [43, -29],
  flagBase: [-41, -30], tillerLo: [31, -20], tillerHi: [22, -62], basket: [38, -48],
});

function wheel(c, x, y, r, roll, L, far) {
  const T = far ? MAT.tire.map((h) => kit.shade(h, -0.25)) : MAT.tire;
  paint(c, S.circle(x, y, r), T, L, { hi: [x, y, r], lw: 2.4, rimW: 2.4 });
  // hub + spokes turn with the distance travelled
  const hub = far ? MAT.chrome.map((h) => kit.shade(h, -0.3)) : MAT.chrome;
  paint(c, S.circle(x, y, r * 0.52), hub, L, { lw: 1.6, rim: false, hi: [x, y, r * 0.5] });
  c.save();
  c.strokeStyle = kit.rgba(OUT, 0.7); c.lineWidth = 1.2; c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = roll + (i * TAU) / 3;
    c.beginPath(); c.moveTo(x + Math.cos(a) * r * 0.14, y + Math.sin(a) * r * 0.14); c.lineTo(x + Math.cos(a) * r * 0.46, y + Math.sin(a) * r * 0.46); c.stroke();
  }
  c.fillStyle = OUT; c.beginPath(); c.arc(x, y, r * 0.13, 0, TAU); c.fill();
  // tread notches
  c.strokeStyle = kit.rgba('#1a1220', 0.55); c.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const a = roll + (i * TAU) / 10;
    c.beginPath(); c.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78); c.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95); c.stroke();
  }
  c.restore();
}

/** Bendy safety-flag whip with a pennant (secondary motion from `bend`, flutter from `t`). */
function flag(c, P, L, bend, t, speed) {
  const [bx, by] = GEO.flagBase, len = 74;
  const tipA = -Math.PI / 2 - 0.16 + bend;              // angle of the tip
  const tx = bx + Math.cos(tipA) * len, ty = by + Math.sin(tipA) * len;
  const cx = bx + Math.cos(-Math.PI / 2 - 0.16 + bend * 0.25) * len * 0.55, cy = by + Math.sin(-Math.PI / 2 - 0.16 + bend * 0.25) * len * 0.55;
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = OUT; c.lineWidth = 3.4;
  c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(cx, cy, tx, ty); c.stroke();
  c.strokeStyle = '#e8e2f2'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(cx, cy, tx, ty); c.stroke();
  c.restore();
  // pennant: hangs back from the tip, flutters faster with speed
  const ang = tipA + Math.PI / 2 + 0.25;                 // pointing backward
  const fl = Math.sin(t * (6 + speed * 3)) * (0.18 + speed * 0.1);
  const dir = [Math.cos(ang + fl), Math.sin(ang + fl)];
  const nrm = [Math.cos(tipA), Math.sin(tipA)];
  const p0 = [tx, ty], p1 = [tx - nrm[0] * 13, ty - nrm[1] * 13];
  const w = Math.sin(t * (9 + speed * 4)) * 2.2;
  const tip = [tx - nrm[0] * 6 + dir[0] * -22, ty - nrm[1] * 6 + dir[1] * -22];
  const mid = [(p0[0] + tip[0]) / 2 + w, (p0[1] + tip[1]) / 2 - w * 0.5];
  paint(c, S.blob([p0, mid, tip, [(p1[0] + tip[0]) / 2 - w * 0.4, (p1[1] + tip[1]) / 2], p1], 0.35), MAT.flag, L, { lw: 2, rimW: 2.2, hi: [mid[0], mid[1], 8] });
  paint(c, S.circle(tx, ty, 2.2), MAT.flag, L, { lw: 1.4, rim: false });
}

/**
 * Everything behind Gertie: flag, far wheels, exhaust, seat back, shell, wheels, deck,
 * seat, tiller (with the live battery gauge) and the front basket.
 * s = { roll, bend, bounce, t, speed, battery (0..1), lightOn (0..1), rev }
 */
export function scooterBack(c, P, L, s) {
  const SH = shellMat(P);
  flag(c, P, L, s.bend, s.t, s.speed);
  // far-side wheels peek out behind
  wheel(c, GEO.rear[0] + 4, GEO.rear[1] - 1.5, GEO.rear[2] * 0.92, s.roll + 0.7, L, true);
  wheel(c, GEO.front[0] - 4, GEO.front[1] - 1.5, GEO.front[2] * 0.92, s.roll * 1.15 + 1.1, L, true);
  // exhaust pipe (chrome, comically big for a mobility scooter)
  const [px, py] = GEO.pipe, j = s.rev ? Math.sin(s.t * 70) * 0.6 : 0;
  paint(c, S.capsule(px + 18, py + 3, px, py + j, 3.2, 4.4), MAT.chrome, L, { lw: 2.2, rimW: 2, hi: [px + 6, py, 5] });
  paint(c, S.ellipse(px - 0.5, py + j, 2.2, 4.6, 0), ['#3a2a40', '#1e1424', '#5a4a60'], L, { lw: 1.6, rim: false });
  // seat back on its post
  paint(c, S.capsule(-29, -40, -31, -58, 2, 2), MAT.chrome, L, { lw: 2, rim: false });
  paint(c, S.rr(-38, -78, 14, 30, 6), MAT.seat, L, {
    hi: [-33, -72, 10],
    detail: (g) => seam(g, [[-31, -75], [-31, -51]], MAT.seat[1], 1.2, 0.8),
  });
  // rear shell: battery housing + fender
  paint(c, S.blob([[-52, -24], [-46, -36], [-24, -40], [-6, -36], [-4, -22], [-14, -16], [-46, -15]], 0.45), SH, L, {
    hi: [-34, -34, 14], k: 2.4,
    detail: (g) => {
      // racing stripe + lightning decal: she *did* pay for the turbo
      g.fillStyle = kit.rgba('#fff4e2', 0.9);
      g.beginPath(); g.moveTo(-50, -27); g.lineTo(-8, -31); g.lineTo(-8, -28); g.lineTo(-50, -24); g.closePath(); g.fill();
      g.fillStyle = '#ffd166'; g.strokeStyle = OUT; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(-30, -38); g.lineTo(-35, -29); g.lineTo(-31, -29); g.lineTo(-34, -20); g.lineTo(-25, -31); g.lineTo(-29, -31); g.lineTo(-26, -38); g.closePath(); g.fill(); g.stroke();
    },
  });
  // deck (floorboard with a rubber mat)
  paint(c, S.rr(-14, -22, 50, 9, 4), SH, L, { hi: [6, -22, 12], rimW: 2.4 });
  seam(c, [[-10, -20.5], [30, -20.5]], '#2b2033', 2.2, 0.8);
  // front shroud with the headlight
  paint(c, S.blob([[24, -16], [28, -34], [40, -38], [48, -30], [47, -18], [38, -13]], 0.5), SH, L, { hi: [38, -32, 10], k: 2.2 });
  const [lx, ly] = GEO.light;
  paint(c, S.circle(lx, ly, 4.4), MAT.chrome, L, { lw: 2, rim: false });
  c.save();
  const on = s.lightOn;
  c.fillStyle = kit.mix('#fff2b8', '#fffbe8', on);
  c.beginPath(); c.arc(lx + 0.4, ly, 3, 0, TAU); c.fill();
  if (on > 0.05) { c.globalCompositeOperation = 'lighter'; kit.glow(c, lx + 2, ly, 10 + on * 10, '#ffe7a0', 0.35 + on * 0.4); }
  c.restore();
  // wheels + fender lips
  wheel(c, GEO.rear[0], GEO.rear[1] + s.bounce * 0.3, GEO.rear[2], s.roll, L, false);
  wheel(c, GEO.front[0], GEO.front[1] + s.bounce * 0.3, GEO.front[2], s.roll * 1.18, L, false);
  c.save();
  c.lineCap = 'round'; c.strokeStyle = OUT; c.lineWidth = 4.6;
  c.beginPath(); c.arc(GEO.rear[0], GEO.rear[1], 13, Math.PI * 1.08, Math.PI * 1.88); c.stroke();
  c.strokeStyle = SH[0]; c.lineWidth = 2;
  c.beginPath(); c.arc(GEO.rear[0], GEO.rear[1], 13, Math.PI * 1.08, Math.PI * 1.88); c.stroke();
  c.restore();
  // seat cushion on its post
  paint(c, S.capsule(-16, -26, -16, -38, 2.4), MAT.chrome, L, { lw: 2, rim: false });
  paint(c, S.rr(-31, -45, 30, 9, 4.5), MAT.seat, L, { hi: [-20, -45, 10] });
  // tiller column + live battery gauge
  const [t0x, t0y] = GEO.tillerLo, [t1x, t1y] = GEO.tillerHi;
  paint(c, S.capsule(t0x, t0y, t1x, t1y, 3.6, 3), SH, L, { hi: [(t0x + t1x) / 2, (t0y + t1y) / 2, 8], rimW: 2.4 });
  paint(c, S.rr(t1x - 4.5, t1y - 3, 11, 8, 3), ['#3a2a44', '#241a2c', '#6a5a78'], L, { lw: 2, rim: false });
  const n = Math.ceil(s.battery * 4 - 0.01);
  for (let i = 0; i < 4; i++) {
    const lit = i < n, col = n <= 1 ? '#ff5a64' : n === 2 ? '#ffc531' : '#7fe08a';
    c.fillStyle = lit ? col : '#4a3a52';
    c.fillRect(t1x - 3 + i * 2.2, t1y - 0.5, 1.6, 3);
  }
  paint(c, S.capsule(t1x - 2, t1y - 2, t1x - 0.5, t1y - 6, 2.2), ['#3a2a44', '#241a2c', '#6a5a78'], L, { lw: 1.6, rim: false });
  // the basket (contents jiggle on landing)
  basket(c, L, s.jiggle, s.t);
}

function basket(c, L, jig, t) {
  const [bx, by] = GEO.basket;
  // contents first (they poke out of the top)
  const j = jig;
  paint(c, S.circle(bx - 3, by - 7 - j * 0.6, 5.2), MAT.yarnB, L, { lw: 1.8, hi: [bx - 4, by - 9, 4], detail: (g) => seam(g, [[bx - 7, by - 9 - j * 0.6], [bx + 1, by - 5 - j * 0.6]], MAT.yarnB[1], 0.9) });
  paint(c, S.circle(bx + 5, by - 6 - j, 4.4), MAT.yarnA, L, { lw: 1.8, hi: [bx + 4, by - 8, 3.5], detail: (g) => seam(g, [[bx + 2, by - 8 - j], [bx + 8, by - 4 - j]], MAT.yarnA[1], 0.9) });
  seam(c, [[bx + 2, by - 13 - j * 1.4], [bx + 9, by - 22 - j * 1.6]], OUT, 2.6);           // knitting needle
  seam(c, [[bx + 2, by - 13 - j * 1.4], [bx + 9, by - 22 - j * 1.6]], '#e4d6a8', 1.2);
  // daisy on a wire: bobs with the jiggle spring
  const fx = bx - 9 + Math.sin(t * 2.2) * 0.8, fy = by - 15 - j * 1.8;
  seam(c, [[bx - 6, by - 4], [fx, fy]], '#4f8a4a', 1.4);
  c.save();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + t * 0.4;
    c.fillStyle = '#fffdf4'; c.strokeStyle = OUT; c.lineWidth = 0.8;
    c.beginPath(); c.ellipse(fx + Math.cos(a) * 2.6, fy + Math.sin(a) * 2.6, 2, 1.3, a, 0, TAU); c.fill(); c.stroke();
  }
  c.fillStyle = '#ffc531'; c.beginPath(); c.arc(fx, fy, 1.6, 0, TAU); c.fill(); c.stroke();
  c.restore();
  // wicker body
  paint(c, S.poly([[bx - 10, by - 6], [bx + 11, by - 6], [bx + 8, by + 8], [bx - 7, by + 8]]), MAT.wicker, L, {
    hi: [bx - 2, by - 4, 8], lw: 2.2,
    detail: (g) => {
      g.strokeStyle = kit.rgba(MAT.wicker[1], 0.9); g.lineWidth = 0.9;
      for (let y = by - 3; y < by + 8; y += 3) { g.beginPath(); g.moveTo(bx - 11, y); g.lineTo(bx + 12, y); g.stroke(); }
      for (let x = bx - 8; x < bx + 12; x += 3.5) { g.beginPath(); g.moveTo(x, by - 6); g.lineTo(x + 1, by + 8); g.stroke(); }
    },
  });
  paint(c, S.rr(bx - 11.5, by - 7.5, 23.5, 3.4, 1.7), MAT.wicker, L, { lw: 1.8, rim: false });
}

// ── props ────────────────────────────────────────────────────────────────────
/** Walking cane: ferrule end in the hand, crook hook at the far end (angle a, length len). */
export function cane(c, hx, hy, a, len, L) {
  const ex = hx + Math.cos(a) * len, ey = hy + Math.sin(a) * len;
  const bx = hx - Math.cos(a) * 7, by = hy - Math.sin(a) * 7;
  paint(c, S.capsule(bx, by, ex, ey, 2.5), MAT.wood, L, { lw: 2.2, rimW: 1.8, k: 1.2 });
  paint(c, S.capsule(bx - Math.cos(a) * 3, by - Math.sin(a) * 3, bx + Math.cos(a) * 2, by + Math.sin(a) * 2, 2.9), ['#3a2a40', '#1e1424', '#6a5a70'], L, { lw: 1.8, rim: false });
  // the crook: a fat arc curling down and back
  const n = [Math.cos(a + Math.PI / 2), Math.sin(a + Math.PI / 2)];
  const cx = ex + n[0] * 6, cy = ey + n[1] * 6;
  c.save();
  c.lineCap = 'round';
  const a0 = a - Math.PI / 2, a1 = a + Math.PI * 0.62;
  c.strokeStyle = OUT; c.lineWidth = 5 + LW;
  c.beginPath(); c.arc(cx, cy, 6, a0, a1); c.stroke();
  c.strokeStyle = MAT.wood[1]; c.lineWidth = 5;
  c.beginPath(); c.arc(cx, cy, 6, a0, a1); c.stroke();
  c.strokeStyle = MAT.wood[0]; c.lineWidth = 3;
  c.beginPath(); c.arc(cx - L.x * 0.6, cy - L.y * 0.6, 6, a0, a1); c.stroke();
  if (L.rim) { c.strokeStyle = L.rim; c.globalAlpha *= 0.7; c.lineWidth = 1.2; c.beginPath(); c.arc(cx, cy, 7.6, a0, a1); c.stroke(); }
  c.restore();
}

/** Teal handbag with a gold kiss-lock clasp, hanging from straps at (sx, sy). */
export function handbag(c, sx, sy, x, y, rot, sc, L) {
  c.save();
  c.strokeStyle = OUT; c.lineWidth = 3.4; c.lineCap = 'round';
  const top = [x + Math.sin(rot) * 9 * sc, y - Math.cos(rot) * 9 * sc];
  c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo((sx + top[0]) / 2 + 3, (sy + top[1]) / 2 - 3, top[0], top[1]); c.stroke();
  c.strokeStyle = MAT.bag[1]; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo((sx + top[0]) / 2 + 3, (sy + top[1]) / 2 - 3, top[0], top[1]); c.stroke();
  c.translate(x, y); c.rotate(rot); c.scale(sc, sc);
  const Lr = { ...L, x: L.x * Math.cos(-rot) - L.y * Math.sin(-rot), y: L.x * Math.sin(-rot) + L.y * Math.cos(-rot) };
  paint(c, S.blob([[-11, -8], [11, -8], [14, 6], [10, 10], [-10, 10], [-14, 6]], 0.35), MAT.bag, Lr, {
    hi: [-3, -4, 12], k: 2.2,
    detail: (g) => { seam(g, [[-12, -2], [12, -2]], MAT.bag[1], 1.1, 0.8); seam(g, [[-11, 8], [11, 8]], MAT.bag[1], 1, 0.6); },
  });
  paint(c, S.rr(-9, -10.5, 18, 3.6, 1.8), MAT.purse, Lr, { lw: 1.6, rim: false });
  paint(c, S.circle(-2.4, -11.6, 1.8), MAT.purse, Lr, { lw: 1.2, rim: false });
  paint(c, S.circle(2.4, -11.6, 1.8), MAT.purse, Lr, { lw: 1.2, rim: false });
  c.restore();
}

/** Tiny gold coin purse on a chain (jab). */
export function purse(c, hx, hy, x, y, L) {
  seam(c, [[hx, hy], [(hx + x) / 2, (hy + y) / 2 + 3], [x, y - 5]], '#c9a040', 1.4);
  paint(c, S.blob([[x - 6, y - 4], [x + 6, y - 4], [x + 7, y + 3], [x, y + 6], [x - 7, y + 3]], 0.4), MAT.purse, L, { lw: 2, hi: [x - 1, y - 2, 6] });
  paint(c, S.circle(x - 1.6, y - 5, 1.4), MAT.chrome, L, { lw: 1, rim: false });
  paint(c, S.circle(x + 1.6, y - 5, 1.4), MAT.chrome, L, { lw: 1, rim: false });
}

/**
 * Umbrella: handle crook at the hands (hx, hy), canopy centered (cx, cy) with radius R,
 * open 0 (furled spindle) … 1 (dome). wob tilts the canopy (radians).
 */
export function umbrella(c, hx, hy, cx, cy, R, open, wob, L, t) {
  const a = Math.atan2(cy - hy, cx - hx);
  // shaft + crook handle
  paint(c, S.capsule(hx, hy, cx, cy, 1.6), MAT.chrome, L, { lw: 1.8, rim: false });
  c.save();
  c.lineCap = 'round'; c.strokeStyle = OUT; c.lineWidth = 6;
  const hk = [hx - Math.cos(a) * 4, hy - Math.sin(a) * 4];
  c.beginPath(); c.arc(hk[0] + 3.5, hk[1], 3.5, Math.PI, Math.PI * 0.05, true); c.stroke();
  c.strokeStyle = MAT.wood[0]; c.lineWidth = 3;
  c.beginPath(); c.arc(hk[0] + 3.5, hk[1], 3.5, Math.PI, Math.PI * 0.05, true); c.stroke();
  c.restore();
  c.save();
  c.translate(cx, cy); c.rotate(a + Math.PI / 2 + wob);
  const Lr = rotL(L, -(a + Math.PI / 2 + wob));
  if (open < 0.12) {
    // furled: a tapered pink spindle hugging the shaft
    paint(c, S.blob([[0, -8], [4.4, 6], [3, 22], [-3, 22], [-4.4, 6]], 0.5), MAT.canopy, Lr, { lw: 2, hi: [0, 4, 6] });
    seam(c, [[0, -6], [1, 20]], MAT.canopy[1], 1, 0.8);
  } else {
    const w = R * lerp(0.25, 1, open), h = R * lerp(0.9, 0.62, open), n = 7;
    const rim = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = lerp(-w, w, u);
      rim.push([x, h * 0.18 * (1 - open * 0.4)]);
    }
    const dome = (g) => {
      g.moveTo(-w, rim[0][1]);
      g.bezierCurveTo(-w, -h * 0.9, -w * 0.45, -h * 1.15, 0, -h * 1.15);
      g.bezierCurveTo(w * 0.45, -h * 1.15, w, -h * 0.9, w, rim[n][1]);
      for (let i = n - 1; i >= 0; i--) {           // scalloped hem
        const mx = (rim[i][0] + rim[i + 1][0]) / 2;
        g.quadraticCurveTo(mx, rim[i][1] - h * 0.22 * open, rim[i][0], rim[i][1]);
      }
      g.closePath();
    };
    paint(c, dome, MAT.canopy, Lr, {
      hi: [-w * 0.3, -h * 0.8, w * 0.7], k: 2.6, rimW: 3.6,
      detail: (g) => {
        // alternate cream panels + ribs
        for (let i = 0; i < n; i += 2) {
          g.fillStyle = kit.rgba(MAT.cream[0], 0.9);
          g.beginPath(); g.moveTo(0, -h * 1.15);
          g.quadraticCurveTo(lerp(rim[i][0], 0, 0.25), -h * 0.7, rim[i][0], rim[i][1]);
          g.lineTo(rim[i + 1][0], rim[i + 1][1]);
          g.quadraticCurveTo(lerp(rim[i + 1][0], 0, 0.25), -h * 0.7, 0, -h * 1.15);
          g.fill();
        }
        g.fillStyle = kit.rgba(MAT.canopy[1], 0.35);
        g.beginPath(); g.ellipse(0, rim[0][1] + 2, w, h * 0.3, 0, 0, TAU); g.fill();
        g.strokeStyle = kit.rgba(OUT, 0.55); g.lineWidth = 1;
        for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(0, -h * 1.15); g.quadraticCurveTo(lerp(rim[i][0], 0, 0.25), -h * 0.7, rim[i][0], rim[i][1]); g.stroke(); }
      },
    });
    paint(c, S.capsule(0, -h * 1.15, 0, -h * 1.15 - 6, 1.6, 1), MAT.chrome, Lr, { lw: 1.4, rim: false });
    // drip tassels on the hem tips sway a beat behind
    c.fillStyle = MAT.cream[0]; c.strokeStyle = OUT; c.lineWidth = 0.9;
    for (let i = 0; i <= n; i += 1) {
      const sw = Math.sin(t * 5 + i) * 1.2;
      c.beginPath(); c.arc(rim[i][0] + sw, rim[i][1] + 2.2, 1.5, 0, TAU); c.fill(); c.stroke();
    }
  }
  c.restore();
}

/** Hat pin: pearl head at the hand, needle to (tx, ty), star glint at the tip. */
export function hatpin(c, hx, hy, tx, ty, glint, L) {
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = OUT; c.lineWidth = 4.2; c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke();
  c.strokeStyle = '#dfe5f2'; c.lineWidth = 2; c.beginPath(); c.moveTo(hx, hy); c.lineTo(tx, ty); c.stroke();
  c.strokeStyle = '#ffffff'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(hx - 0.6, hy); c.lineTo(tx - 0.6, ty); c.stroke();
  c.restore();
  paint(c, S.circle(hx, hy, 4.2), MAT.pearl, L, { lw: 2, hi: [hx, hy, 4] });
  if (glint > 0) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    kit.glow(c, tx, ty, 10 * glint + 4, '#fff6c8', 0.7 * glint);
    c.fillStyle = '#ffffff';
    kit.starPath(c, tx, ty, 4, 9 * glint + 2, 1.8, Math.PI / 4);
    c.fill();
    c.restore();
  }
}

/** Rolling pin held by one handle, barrel along angle a. */
export function rollingPin(c, hx, hy, a, L) {
  const p = (d) => [hx + Math.cos(a) * d, hy + Math.sin(a) * d];
  const [h0x, h0y] = p(-4), [h1x, h1y] = p(7), [b0x, b0y] = p(7), [b1x, b1y] = p(45), [e0x, e0y] = p(45), [e1x, e1y] = p(55);
  paint(c, S.capsule(h0x, h0y, h1x, h1y, 2.4), MAT.wood, L, { lw: 1.8, rim: false });
  paint(c, S.capsule(e0x, e0y, e1x, e1y, 2.4), MAT.wood, L, { lw: 1.8, rim: false });
  const Lr = rotL(L, -a);
  c.save();
  c.translate(b0x, b0y); c.rotate(a);
  paint(c, S.rr(0, -6.5, 38, 13, 5.5), MAT.wood, Lr, {
    hi: [12, -5, 12],
    detail: (g) => { g.fillStyle = kit.rgba('#ffffff', 0.55); for (const [x, y, r] of [[8, 2, 2.4], [22, -2, 1.8], [30, 3, 2]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); } },  // flour dust
  });
  c.restore();
}

/** Reacher-grabber: trigger handle at the hand, aluminum pole, rubber jaws at (tx, ty). */
export function grabber(c, hx, hy, tx, ty, close, L) {
  const a = Math.atan2(ty - hy, tx - hx);
  paint(c, S.capsule(hx - Math.cos(a) * 4, hy - Math.sin(a) * 4, tx, ty, 1.9), MAT.chrome, L, { lw: 1.8, rim: false });
  paint(c, S.rr(hx - 3, hy - 1, 6, 9, 2), ['#ffc531', '#c98a12', '#ffe9a0'], L, { lw: 1.6, rim: false });
  c.save();
  c.translate(tx, ty); c.rotate(a);
  const op = (1 - close) * 0.7 + 0.08;
  for (const s of [-1, 1]) {
    c.save(); c.rotate(s * op);
    paint(c, S.blob([[0, 0], [8, s * 1.5], [12, s * 4.5], [10, s * 7], [6, s * 5], [2, s * 2.5]], 0.3), MAT.rubber, rotL(L, -(a + s * op)), { lw: 1.6, rim: false });
    c.restore();
  }
  c.restore();
}

/** Hairspray mist: a cone of soft puffs from (nx, ny) toward (tx, ty), amount 0..1. */
export function sprayMist(c, nx, ny, tx, ty, amt, t, rng) {
  if (amt <= 0) return;
  c.save();
  for (let i = 0; i < 22; i++) {
    const u = ((i / 22) + t * 2.2) % 1;
    const sp = (kit.hash01(i, 7) - 0.5) * u * 40;
    const x = lerp(nx, tx, u) + sp, y = lerp(ny, ty, u) + (kit.hash01(i, 9) - 0.5) * 8;
    const r = 4 + u * 15;
    c.globalAlpha = amt * (1 - u * 0.8) * 0.5;
    c.fillStyle = i % 3 ? '#e9f6ff' : '#ffd2ec';
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = amt;
  c.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const u = ((i / 6) + t * 3.1) % 1;
    const x = lerp(nx, tx, u) + (kit.hash01(i, 13) - 0.5) * u * 30, y = lerp(ny, ty, u);
    kit.starPath(c, x, y, 4, 2.6 * (1 - u) + 0.6, 0.7, t * 4 + i); c.fill();
  }
  c.restore();
}

/** Exhaust backfire: layered flame tongue from the pipe toward -x; amt 0..1. */
export function backfire(c, x, y, len, amt, t) {
  if (amt <= 0) return;
  c.save();
  c.globalCompositeOperation = 'lighter';
  const layers = [['#ff5a3c', 1, 0.7], ['#ffb43c', 0.72, 0.85], ['#fff3b0', 0.42, 1]];
  for (const [col, k, al] of layers) {
    const L0 = len * k * (0.6 + 0.4 * amt), W = 19 * k * amt;
    const fl = Math.sin(t * 40 + k * 7) * 3;
    c.globalAlpha = al;
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(x, y - W * 0.5);
    c.bezierCurveTo(x - L0 * 0.4, y - W * 1.2 + fl, x - L0 * 0.8, y - W * 0.6, x - L0, y + fl * 0.4);
    c.bezierCurveTo(x - L0 * 0.8, y + W * 0.6, x - L0 * 0.4, y + W * 1.1 - fl, x, y + W * 0.5);
    c.closePath(); c.fill();
  }
  kit.glow(c, x - len * 0.3 * amt, y, 30 * amt, '#ff8a3c', 0.45 * amt);
  c.restore();
}

/** Tea steam: three wavy wisps rising from (x, y). */
export function steam(c, x, y, t, amt = 1) {
  c.save();
  c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.7 + i / 3) % 1;
    c.globalAlpha = amt * Math.sin(ph * Math.PI) * 0.75;
    c.strokeStyle = '#ffffff'; c.lineWidth = 1.8;
    c.beginPath();
    for (let k = 0; k <= 8; k++) {
      const u = k / 8, yy = y - 2 - ph * 10 - u * 14, xx = x + (i - 1) * 3 + Math.sin(u * 5 + t * 4 + i * 2) * 2.2;
      k ? c.lineTo(xx, yy) : c.moveTo(xx, yy);
    }
    c.stroke();
  }
  c.restore();
}

/** Tiny outlined heart. */
export function heart(c, x, y, s, col, alpha = 1) {
  c.save();
  c.globalAlpha *= alpha;
  c.translate(x, y); c.scale(s, s);
  c.beginPath(); c.moveTo(0, 4);
  c.bezierCurveTo(-7, -1, -4, -7, 0, -3); c.bezierCurveTo(4, -7, 7, -1, 0, 4);
  c.fillStyle = col; c.fill(); c.lineWidth = 1.4 / s; c.strokeStyle = OUT; c.stroke();
  c.restore();
}

/** Rotates a light {x, y, ...} by angle a. */
export function rotL(L, a) {
  const cs = Math.cos(a), sn = Math.sin(a);
  return { ...L, x: L.x * cs - L.y * sn, y: L.x * sn + L.y * cs };
}

// ── entities ─────────────────────────────────────────────────────────────────
/** Procedural dentures (used if the teeth sheet failed to load). open 0..1. */
export function denturesFallback(c, open, L) {
  const o = open * 3;
  paint(c, S.blob([[-9, -1 - o], [-7, -7 - o], [7, -7 - o], [9.5, -1 - o], [-9, 0 - o]], 0.4), ['#ff9fb4', '#cf5f80', '#ffd0dc'], L, { lw: 1.8, rim: false });
  paint(c, S.blob([[-8.4, 2 + o], [8.6, 2 + o], [6.8, 7.6 + o], [-6.6, 7.6 + o]], 0.4), ['#ff9fb4', '#cf5f80', '#ffd0dc'], L, { lw: 1.8, rim: false });
  c.fillStyle = '#fffdf0'; c.strokeStyle = OUT; c.lineWidth = 0.7;
  for (let i = 0; i < 6; i++) { c.beginPath(); c.rect(-7 + i * 2.4, -1.2 - o, 2, 3); c.fill(); c.stroke(); }
  for (let i = 0; i < 5; i++) { c.beginPath(); c.rect(-6 + i * 2.5, -0.6 + o, 2, 3); c.fill(); c.stroke(); }
}

// ── Gertie without her sprite sheet ──────────────────────────────────────────
// Assets can fail (or time out); rather than a ghost placeholder she is rebuilt from the
// same pose joints with simple painted shapes. Seat-relative body px (hip at 0, 0).
const G = Object.freeze({
  skin: ['#f6cdb0', '#d89a84', '#fff0e2'], hair: ['#f4f0fa', '#bfb2d6', '#ffffff'], cardi: ['#b88ddc', '#7d58a8', '#e2c8f8'],
  cardiFar: ['#9a72c2', '#664690', '#c4a6e2'], dress: ['#f08fa6', '#bf5b7a', '#ffc8d4'], stock: ['#ecc8ac', '#c39a84', '#fbe2cc'],
  shoe: ['#7c2f4a', '#4e1a30', '#b0587a'], hat: ['#d4436f', '#952a50', '#ff8fb0'],
});
export function gertieFallback(c, J, p, L) {
  const D = Math.PI / 180, lean = p.lean * D;
  const R = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  const arm = (sh, el, h, far) => {
    const M = far ? G.cardiFar : G.cardi;
    paint(c, S.capsule(sh[0], sh[1], el[0], el[1], 5, 4.4), M, L, { lw: 2.4, rimW: 2.4 });
    paint(c, S.capsule(el[0], el[1], h[0], h[1], 4.4, 3.8), M, L, { lw: 2.4, rimW: 2.4 });
    paint(c, S.circle(h[0], h[1], 3.6), G.skin, L, { lw: 2, rim: false });
  };
  arm(J.shB, J.elB, J.hB, true);
  for (const far of [true, false]) {
    const o = far ? -4 : 0, k = [p.knee[0] + o, p.knee[1]], a = [p.ankle[0] + o, p.ankle[1]];
    paint(c, S.capsule(k[0], k[1], a[0], a[1], 4.2, 3.2), G.stock, L, { lw: 2.4, rim: !far });
    paint(c, S.rr(a[0] - 4, a[1] - 2, 13, 6.5, 3), G.shoe, L, { lw: 2.2, rim: false });
  }
  paint(c, S.blob([[-12, -7], [p.knee[0] * 0.6, p.knee[1] - 6], [p.knee[0] + 5, p.knee[1] + 1], [p.knee[0] - 2, p.knee[1] + 8.6], [-12, 6]], 0.5), G.dress, L, { lw: 2.6 });
  const T = (x, y) => R(x, y, lean);
  paint(c, S.blob([T(-11, 3), T(-14.5, -10), T(-9, -28), T(0, -31.5), T(10, -26), T(14.5, -10), T(11, 4)], 0.5), G.cardi, L, { hi: [...T(-4, -22), 12], k: 2.4 });
  const H = J.head, hr = J.headRot, A = (x, y) => { const q = R(x, y, hr); return [H[0] + q[0], H[1] + q[1]]; };
  paint(c, S.blob([A(-10, -2), A(-8, -11), A(0, -14), A(8, -12), A(4, -4), A(-6, 8)], 0.6), G.hair, L, { lw: 2.4 });
  paint(c, S.circle(...A(4, 0), 10), G.skin, L, { hi: [...A(2, -4), 8] });
  paint(c, S.circle(...A(13, 2), 3), G.skin, L, { lw: 1.8, rim: false });
  for (const [x, r] of [[7, 4.4], [0.8, 3.6]]) {
    const q = A(x, -1);
    c.save(); c.fillStyle = '#f2f8ff'; c.beginPath(); c.arc(q[0], q[1], r, 0, TAU); c.fill();
    c.fillStyle = OUT; c.beginPath(); c.arc(q[0] + 0.6, q[1] + 0.3, 1.5, 0, TAU); c.fill();
    c.strokeStyle = '#c8343f'; c.lineWidth = 1.6; c.beginPath(); c.arc(q[0], q[1], r, 0, TAU); c.stroke(); c.restore();
  }
  paint(c, S.poly([A(-6, -13), A(-5, -19), A(7, -20), A(9, -14)]), G.hat, L, { lw: 2.2 });
  arm(J.shF, J.elF, J.hF, false);
}
