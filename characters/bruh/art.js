// Bruh art: a fully procedural hand (rig: none). Every frame builds a numeric "pose"
// (wrist position, hand rotation/flip/squash, per-finger curl/bend/length, thumb,
// perspective flatness for the parachute, feet) from the state and the validated move phase, then paints
// it: rubber-hose legs and sneakers, shaded tube fingers, a smooth palm with rim light,
// back-of-hand knuckles or palm creases, and a wristwatch (with ticking hands).
// Strike poses are placed with anchors so the striking part lands in the real hitbox.
import * as kit from '../../shared/art/kit.js';

const TAU = Math.PI * 2;
const { clamp, lerp } = kit;
const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);

const PALETTE = {
  skin: '#fdf3f0', skinLight: '#ffffff', skinMid: '#f3e2e0', skinShade: '#ebd5d8', skinDeep: '#b8909f',
  nail: '#ffd3d6', blush: '#ffb3bd', vein: '#aab8e6',
  strap: '#3f6fe0', strapDark: '#25409a', bezel: '#ffcf4a', face: '#f7fbff',
  shoe: '#f4f6fd', shoeLight: '#3f6fe0', sole: '#9fb0e6',
  outline: '#3a1f44', effect: '#fff1b8', ink: '#3a1f44',
};

// ── Hand geometry (hand-local px): origin = wrist center, −y toward the fingertips,
// +x = thumb side. The back of the hand faces the camera when flip = 1.
const PALM = [[-23, 5], [-32, -12], [-36, -34], [-36, -54], [-27, -64], [-10, -67], [9, -67], [25, -65],
  [35, -57], [37, -36], [33, -14], [24, 5]];
const FINGERS = [ // index, middle, ring, pinky
  { x: 25, y: -60, len: 38, r: 8.6 },
  { x: 8.5, y: -64, len: 43, r: 9.0 },
  { x: -8.5, y: -63, len: 40, r: 8.6 },
  { x: -25, y: -58, len: 31, r: 7.6 },
];
const THUMB = { x: 25, y: -16, len1: 24, len2: 21, r: 10 };
const REST_FAN = [0.15, 0.04, -0.06, -0.17];
const LEG_REST = 50;

const KEYS = ['wx', 'wy', 'rot', 'flip', 'sx', 'sy', 'fan', 'c0', 'c1', 'c2', 'c3', 'b0', 'b1', 'b2', 'b3',
  'l0', 'l1', 'l2', 'l3', 'ta', 'tc', 'persp', 'f1x', 'f1y', 'f2x', 'f2y', 'toe'];

const rest = () => ({
  wx: 0, wy: -50, rot: 0, flip: 1, sx: 1, sy: 1, fan: 1,
  c0: 0.06, c1: 0.06, c2: 0.08, c3: 0.1, b0: 0, b1: 0, b2: 0, b3: 0, l0: 1, l1: 1, l2: 1, l3: 1,
  ta: 0.75, tc: 0.15, persp: 0, f1x: -13, f1y: 0, f2x: 13, f2y: 0, toe: 0,
});
const curls = (a, b, c, d) => ({ c0: a, c1: b, c2: c, c3: d });
const fist = (k = 1) => curls(k, k, k, k);

function blend(a, b, t) {
  const o = { ...a };
  for (const k of KEYS) if (b[k] !== undefined && a[k] !== undefined) o[k] = lerp(a[k], b[k], t);
  return o;
}

// ── Transform helpers ────────────────────────────────────────────────────────
function prep(p) { p.cos = Math.cos(p.rot); p.sin = Math.sin(p.rot); return p; }
/** Hand-local point → body space. */
function T(p, x, y) {
  const lx = x * p.flip * p.sx, ly = y * p.sy;
  return { x: p.wx + lx * p.cos - ly * p.sin, y: p.wy + lx * p.sin + ly * p.cos };
}
/** Hand-local direction at angle a from "up" (+ toward the thumb) → body space unit vector. */
function D(p, a) {
  let x = Math.sin(a) * p.flip, y = -Math.cos(a);
  const n = Math.hypot(x, y) || 1; x /= n; y /= n;
  return { x: x * p.cos - y * p.sin, y: x * p.sin + y * p.cos };
}
const add = (a, d, k) => ({ x: a.x + d.x * k, y: a.y + d.y * k });

/** All hand points in body space. */
function geo(p) {
  prep(p);
  const g = { palm: PALM.map(([x, y]) => T(p, x, y)), fingers: [], wrist: { x: p.wx, y: p.wy } };
  const s = clamp((Math.abs(p.sx) + p.sy) / 2, 0.75, 1.3);
  const lenK = Math.pow(Math.max(0.5, p.sy), 0.6);
  for (let i = 0; i < 4; i++) {
    const F = FINGERS[i], c = p[`c${i}`], b = p[`b${i}`];
    const a = REST_FAN[i] * p.fan + b * 0.3;
    const base = T(p, F.x, F.y);
    const L = F.len * p[`l${i}`] * (1 - 0.68 * c) * lenK;
    const joint = add(base, D(p, a), L * 0.55);
    const d2 = D(p, a + b);
    const tip = add(joint, d2, L * 0.45);
    g.fingers.push({ base, joint, tip, d2, r: F.r * s, c, i });
  }
  const ta = p.ta, tc = p.tc;
  const tb = T(p, THUMB.x, THUMB.y);
  const tj = add(tb, D(p, ta), THUMB.len1 * lenK);
  const td = D(p, ta - tc * 1.7);
  g.thumb = { base: tb, joint: tj, tip: add(tj, td, THUMB.len2 * lenK * (1 - 0.3 * tc)), d2: td, r: THUMB.r * s };
  g.strap = [T(p, -31, -3), T(p, 31, -3), T(p, 33, -15), T(p, -33, -15)];
  g.hips = [T(p, -11, 9), T(p, 11, 9)];
  // Flat (parachute, floor slap): the whole hand is squashed toward a grazing view about the
  // palm center (drawHand applies it to the paint); the legs then hang from under the palm.
  g.pc = T(p, 0, -36);
  g.pk = 1 - 0.6 * clamp(p.persp, 0, 1);
  if (p.persp > 0.01) {
    const u = clamp(p.persp, 0, 1);
    g.hips = g.hips.map((h, i) => ({ x: lerp(h.x, g.pc.x + (i ? 12 : -12), u), y: lerp(h.y, g.pc.y + 4, u) }));
  }
  return g;
}

const ANCHORS = {
  index: (g) => g.fingers[0].tip, middle: (g) => g.fingers[1].tip, fingers: (g) => g.fingers[1].joint,
  thumb: (g) => g.thumb.tip, palm: (g, p) => T(p, 0, -36), knuckles: (g, p) => T(p, 0, -62),
};
/** Moves the wrist so the named hand point lands on target (body px). */
function place(p, anchor, target) {
  if (!anchor || !target) return p;
  p.wx = 0; p.wy = 0;
  const a = ANCHORS[anchor](geo(p), p);
  p.wx = target.x - a.x; p.wy = target.y - a.y;
  return p;
}

// ── Hitbox helpers (validated shapes from the move def) ──────────────────────
function hitOf(m) {
  const hs = m?.def?.hitboxes;
  return hs && hs.length ? hs[0] : null;
}
function tipOf(h, fb) {
  if (!h) return fb;
  const k = kit.shapeKind(h);
  if (k === 'capsule') {
    const far = Math.hypot(h.x2, h.y2 + 60) >= Math.hypot(h.x1, h.y1 + 60);
    return { x: far ? h.x2 : h.x1, y: far ? h.y2 : h.y1 };
  }
  if (k === 'rect') return { x: h.x + h.w * 0.35 * Math.sign(h.x || 0), y: h.y };
  return { x: h.x, y: h.y };
}
const centerOf = (h, fb) => (h ? kit.shapeCenter(h) : fb);
function strikeAt(def) {
  for (const e of def?.timeline || []) if (typeof e.at === 'number' && (e.spawn || e.release || e.emit)) return e.at;
  return null;
}

// ── Move animations: wind (startup end pose) and strike (active pose) ────────
// k = { h, A, S, ph, pt, t, f, charge, v }
const ANIMS = {
  poke(k) {
    const tip = tipOf(k.h, { x: 84, y: -78 });
    return {
      wind: { rot: 1.2, flip: -1, ...curls(0.35, 1, 1, 1), ta: 0.5, tc: 0.4, wx: -12, wy: -52 },
      strike: { rot: 1.5, flip: -1, ...curls(0, 1, 1, 1), l0: 1.2, ta: 0.6, tc: 0.25, anchor: 'index', at: { x: tip.x - 4, y: tip.y } },
    };
  },
  backhand(k) {
    const c = centerOf(k.h, { x: 64, y: -74 });
    return {
      wind: { rot: -0.75, flip: 1, wx: -12, wy: -46, fan: 0.7, ta: 0.5, f2x: 18 },
      strike: { rot: 1.3, flip: 1, fan: 0.6, ...fist(0.04), ta: 0.4, anchor: 'fingers', at: { x: c.x + 14, y: c.y + 2 }, f1x: -20, f2x: 20 },
      smear: { from: -0.75, to: 1.3, r: 92, w: 30 },
    };
  },
  pointUp(k) {
    const tip = tipOf(k.h, { x: 14, y: -196 });
    return {
      wind: { rot: 0.25, ...curls(0.6, 1, 1, 1), ta: 1.1, wy: -38, sy: 0.9 },
      strike: { rot: -0.06, sy: 1.1, ...curls(0, 1, 1, 1), l0: 1.7, ta: 1.35, tc: 0, anchor: 'index', at: { x: tip.x - 2, y: tip.y + 4 }, f1y: 0, f2y: -6 },
    };
  },
  flick(k) {
    const r = k.h ? { x: k.h.x + k.h.w / 2 - 8, y: k.h.y } : { x: 92, y: -12 };
    return {
      wind: { rot: 1.75, ...curls(1, 0.6, 0.6, 0.7), ta: 0.9, tc: 1, wx: -6, wy: -56, f1x: -22, f2x: 4 },
      strike: { rot: 2.05, ...curls(0, 0.7, 0.75, 0.8), l0: 1.15, ta: 0.6, tc: 0.6, anchor: 'index', at: r, f1x: -24, f2x: 6 },
    };
  },
  slap(k) {
    const c = centerOf(k.h, { x: 70, y: -75 });
    return {
      wind: { rot: -1.05, flip: 1, wx: -18, wy: -50, sx: 1.08, sy: 1.08, fan: 1.6, ...fist(0), ta: 1.0, f1x: -22, f2x: 10 },
      strike: { rot: 1.3, flip: -1, sx: 1.15, sy: 1.22, fan: 1.25, ...fist(0), ta: 0.9, anchor: 'fingers', at: { x: c.x + 18, y: c.y }, f1x: -26, f2x: 24 },
      smear: { from: -1.05, to: 1.3, r: 112, w: 46 },
    };
  },
  highFive(k) {
    const c = centerOf(k.h, { x: 0, y: -150 });
    return {
      wind: { wy: -30, sy: 0.82, sx: 1.12, ...fist(0.35), ta: 0.4, f1x: -18, f2x: 18 },
      strike: { rot: 0.04, sy: 1.25, sx: 1.12, fan: 2.4, ...fist(0), ta: 1.25, anchor: 'palm', at: { x: c.x, y: c.y - 2 }, f1x: -8, f1y: -16, f2x: 10, f2y: -20, toe: 0.5 },
    };
  },
  floorSlap(k) {
    return {
      wind: { wy: -66, sy: 1.15, rot: 0, fan: 1.5, ...fist(0.1), ta: 1.0, f1y: -2, f2y: -2, toe: 0.3 },
      strike: { persp: 0.75, rot: 1.57, fan: 4.4, sx: 1.12, ...fist(0), ta: 1.2, b0: 0.3, b1: 0.25, b2: 0.2, b3: 0.15, l0: 1.2, l1: 1.2, l2: 1.2, l3: 1.25, anchor: 'palm', at: { x: -8, y: -20 }, f1x: -40, f2x: 38 },
      quake: true,
    };
  },
  jazz(k) {
    const c = centerOf(k.h, { x: 0, y: -96 });
    const sh = Math.sin(k.t * 34);
    const w = (i) => 0.45 * Math.sin(k.t * 40 + i * 1.7);
    return {
      wind: { fan: 2.6, rot: -0.2, ...fist(0.3) },
      strike: { fan: 4.2, rot: 0.22 * sh, ...fist(0), b0: w(0), b1: w(1), b2: w(2), b3: w(3), ta: 1.7, sx: 1.12,
                anchor: 'palm', at: { x: c.x + 4 * sh, y: c.y + 10 }, f1x: -18 + 6 * sh, f1y: -10, f2x: 16 - 6 * sh, f2y: -4 },
    };
  },
  chop(k) {
    const c = centerOf(k.h, { x: 62, y: -87 });
    return {
      wind: { rot: -0.45, fan: 0.3, ...fist(0), ta: 0.25, tc: 0.4, wy: -54, wx: -6 },
      strike: { rot: 1.25, fan: 0.25, ...fist(0), ta: 0.2, tc: 0.5, anchor: 'fingers', at: { x: c.x + 6, y: c.y + 4 } },
      smear: { from: -0.45, to: 1.25, r: 86, w: 28 },
    };
  },
  swat(k) {
    const c = centerOf(k.h, { x: -62, y: -73 });
    return {
      wind: { rot: 0.65, flip: 1, fan: 1.2, wx: 6, wy: -46 },
      strike: { rot: -1.4, flip: -1, fan: 1.2, ...fist(0), ta: 0.9, anchor: 'fingers', at: { x: c.x - 12, y: c.y } },
      smear: { from: 0.65, to: -1.4, r: 90, w: 32 },
    };
  },
  snap(k) {
    const c = centerOf(k.h, { x: 6, y: -150 });
    return {
      wind: { rot: -0.1, ...curls(0.15, 0.45, 0.55, 0.6), ta: 0.35, tc: 0.9, wy: -48 },
      strike: { rot: 0.05, ...curls(0.1, 1, 0.6, 0.65), ta: 1.25, tc: 0, anchor: 'knuckles', at: { x: c.x, y: c.y + 26 } },
    };
  },
  palmDrop(k) {
    const c = centerOf(k.h, { x: 0, y: 4 });
    return {
      wind: { rot: 1.2, persp: 0.4, wy: -62, fan: 2, ...fist(0), f1y: -24, f2y: -30, toe: 0.4 },
      strike: { rot: 1.57, persp: 0.75, fan: 4.4, ...fist(0), ta: 1.2, anchor: 'palm', at: { x: c.x + 4, y: c.y - 4 }, f1x: -16, f1y: -46, f2x: 12, f2y: -52, toe: 1.4 },
    };
  },
  fingerGun() {
    return {
      wind: { rot: 1.5, flip: -1, ...curls(0, 1, 1, 1), l0: 1.1, ta: 1.7, tc: 0.1, anchor: 'index', at: { x: 72, y: -80 } },
      strike: { rot: 1.18, flip: -1, ...curls(0, 1, 1, 1), l0: 1.1, ta: 0.45, tc: 0.4, anchor: 'index', at: { x: 76, y: -92 } },
      muzzle: true,
    };
  },
  punch(k) {
    const c = centerOf(k.h, { x: 56, y: -80 });
    return {
      wind: { rot: 0.85, flip: -1, ...fist(1), ta: 0.3, tc: 1, wx: -22, wy: -48, f1x: -24, f2x: 4 },
      strike: { rot: 1.55, flip: -1, ...fist(1), ta: 0.25, tc: 1, sx: 1.08, sy: 1.08, anchor: 'knuckles', at: { x: c.x + 16, y: c.y + 2 }, f1x: -26, f2x: 16 },
      lines: true,
    };
  },
  thumbsUp(k) {
    const tip = tipOf(k.h, { x: 10, y: -160 });
    return {
      wind: { rot: 1.4, flip: -1, ...fist(1), ta: 0.6, tc: 0.6, wy: -34, sy: 0.9 },
      strike: { rot: 1.57, flip: -1, ...fist(1), ta: 1.57, tc: 0, sx: 1.1, sy: 1.1, anchor: 'thumb', at: { x: tip.x, y: tip.y + 6 }, f1x: -8, f1y: -6, f2x: 8, f2y: -2, toe: 0.8 },
      lines: 'up',
    };
  },
  yeet() {
    return {
      wind: { rot: -1.15, flip: 1, ...fist(0.55), ta: 0.6, tc: 0.7, wx: -12, wy: -50, f1x: -22, f2x: 12 },
      strike: { rot: 0.85, flip: 1, fan: 1.6, ...fist(0), ta: 1.1, wx: 10, wy: -48, f1x: -20, f2x: 22 },
      smear: { from: -1.15, to: 0.85, r: 96, w: 30 }, carry: true,
    };
  },
  grab(k) {
    const c = centerOf(k.h, { x: 60, y: -70 });
    return {
      wind: { rot: 1.1, flip: -1, fan: 1.8, ...fist(0), ta: 1.2, wx: -6 },
      strike: { rot: 1.4, flip: -1, fan: 1.2, ...fist(0.65), ta: 0.6, tc: 0.7, anchor: 'palm', at: c },
    };
  },
  squeeze() {
    return {
      wind: { rot: 1.35, flip: -1, ...fist(0.6), ta: 0.6, tc: 0.6, anchor: 'palm', at: { x: 54, y: -68 } },
      strike: { rot: 1.35, flip: -1, ...fist(0.95), sx: 0.88, sy: 1.05, ta: 0.4, tc: 1, anchor: 'palm', at: { x: 52, y: -68 } },
    };
  },
  fthrow() {
    return {
      wind: { rot: -1.2, flip: 1, ...fist(0.7), ta: 0.5, tc: 0.8, wx: -16, wy: -52, f1x: -24, f2x: 8 },
      strike: { rot: 1.55, flip: 1, fan: 1.5, ...fist(0), ta: 1.0, wx: 8, wy: -60, f1x: -22, f2x: 22 },
      smear: { from: -1.2, to: 1.55, r: 100, w: 34 },
    };
  },
  bthrow() {
    return {
      wind: { rot: 0.9, flip: -1, ...fist(0.7), ta: 0.5, tc: 0.8, wx: 10, wy: -48 },
      strike: { rot: -1.75, flip: -1, fan: 1.5, ...fist(0), ta: 1.0, wx: -10, wy: -60, f1x: -22, f2x: 18 },
      smear: { from: 0.9, to: -1.75, r: 100, w: 34 },
    };
  },
  uthrow() {
    return {
      wind: { rot: 1.25, flip: -1, ...fist(0.7), ta: 0.5, wy: -32, sy: 0.85, f1x: -18, f2x: 18 },
      strike: { rot: -0.05, sy: 1.22, fan: 2.0, ...fist(0), ta: 1.2, wy: -62, f1y: -12, f2y: -16, toe: 0.5 },
    };
  },
  dthrow() {
    return {
      wind: { rot: 0.5, flip: 1, fan: 1.2, wx: 10, wy: -66, sy: 1.1, ...fist(0.1) },
      strike: { rot: 2.0, flip: 1, fan: 1.3, ...fist(0), ta: 0.9, wx: 8, wy: -50, f1x: -20, f2x: 12 },
    };
  },
  bruh(k) {
    const shake = k.f > 18 && k.f < 52 ? Math.sin(k.f * 0.32) * 0.16 : 0;
    const sag = { rot: 0.62 + shake, sy: 0.9, sx: 1.04, ...curls(0.3, 0.4, 0.45, 0.55), b0: 0.35, b1: 0.4, b2: 0.45, b3: 0.5,
      ta: 0.25, tc: 0.4, wx: 4, wy: -38, fan: 0.7 };
    return { wind: sag, strike: sag, hold: true };
  },
};

// ── State poses ──────────────────────────────────────────────────────────────
function statePose(v, info, c, inMove) {
  const p = rest();
  const t = info.time;
  const st = inMove ? (v.grounded ? 'idle' : 'air') : v.state;
  const wig = (i, a, s = 14) => a * Math.sin(t * s + i * 1.3);
  switch (st) {
    case 'run': {
      const ph = c.runPh;
      const s1 = Math.sin(ph), s2 = Math.sin(ph + Math.PI);
      Object.assign(p, {
        rot: 0.16 + 0.04 * Math.sin(ph * 2), wy: -52 + 3 * Math.abs(Math.cos(ph)), wx: 4, fan: 1.15,
        f1x: 2 + s2 * 17, f1y: -Math.max(0, Math.cos(ph + Math.PI)) * 12, f2x: 2 + s1 * 17, f2y: -Math.max(0, Math.cos(ph)) * 12,
        b0: wig(0, 0.12, 18), b1: wig(1, 0.12, 18), b2: wig(2, 0.12, 18), b3: wig(3, 0.14, 18), ta: 0.9,
      });
      break;
    }
    case 'crouch':
      Object.assign(p, { rot: 1.5, flip: 1, sx: 0.85, wx: -40, wy: -38, ...fist(0.28), ta: 0.25, tc: 0.6, f1x: -26, f2x: -4,
        sy: 0.92 + 0.02 * Math.sin(t * 2.4) });
      break;
    case 'jumpsquat': case 'land':
      Object.assign(p, { wy: -42, sy: 0.86, sx: 1.08, f1x: -17, f2x: 17, ...fist(0.2), fan: 1.3 });
      break;
    case 'air': case 'helpless': case 'fly': case 'glide': {
      if (v.vy < -1) Object.assign(p, { wy: -54, rot: -0.05, fan: 1.25, ...fist(0), ta: 0.95, f1x: -9, f1y: -16, f2x: 12, f2y: -22, toe: 0.2 });
      else Object.assign(p, { wy: -54, rot: 0.05, fan: 1.1, f1x: -11, f1y: 4, f2x: 10, f2y: 1, toe: 0.55,
        b0: wig(0, 0.12), b1: wig(1, 0.12), b2: wig(2, 0.12), b3: wig(3, 0.12) });
      if (st === 'helpless') Object.assign(p, { rot: 0.3 + 0.08 * Math.sin(t * 5), ...curls(0.35, 0.4, 0.45, 0.5), b0: 0.4, b1: 0.45, b2: 0.5, b3: 0.55, ta: 0.3 });
      break;
    }
    case 'shield':
      Object.assign(p, { flip: -1, rot: 0.12, fan: 1.7, ...fist(0), ta: 1.15, wx: 6, wy: -52, f1x: -18, f2x: 14 });
      break;
    case 'roll': case 'airdodge': {
      const spin = v.state === 'roll' ? (v.stateFrame || 0) * 0.42 * 1 : Math.sin((v.stateFrame || 0) * 0.3) * 0.4;
      Object.assign(p, { ...fist(1), ta: 0.25, tc: 1, sy: 0.85, rot: spin, wy: -40, f1x: -8, f1y: -10, f2x: 8, f2y: -14 });
      place(p, 'palm', { x: 0, y: -62 });
      break;
    }
    case 'spotdodge':
      Object.assign(p, { persp: 0.85, rot: 1.57, fan: 2.6, ...fist(0), f1x: -30, f2x: 30 });
      place(p, 'palm', { x: 6, y: -20 });
      break;
    case 'hitstun': case 'stunned': case 'shieldbreak': case 'grabbed': {
      const fl = (i) => 0.35 * Math.sin(t * 31 + i * 2.1);
      Object.assign(p, { fan: 3.2, ...fist(0), b0: fl(0), b1: fl(1), b2: fl(2), b3: fl(3), ta: 1.7, rot: -0.38, wx: -6,
        f1x: -14 + 7 * Math.sin(t * 24), f1y: -6 + 5 * Math.cos(t * 24), f2x: 14 + 7 * Math.sin(t * 24 + 2), f2y: -10 + 5 * Math.cos(t * 24 + 2), toe: 0.6 });
      if (v.tumble) { p.rot = (t * 9) % TAU; place(p, 'palm', { x: 0, y: -72 }); }
      if (!v.grounded && !v.tumble) p.wy = -56;
      if (v.state === 'shieldbreak' || v.state === 'stunned') Object.assign(p, { rot: 0.5 + 0.12 * Math.sin(t * 3), fan: 1, ...curls(0.4, 0.5, 0.55, 0.6), b0: 0.5, b1: 0.5, b2: 0.55, b3: 0.6, f1x: -14, f1y: 0, f2x: 14, f2y: 0 });
      break;
    }
    case 'grabbing':
      Object.assign(p, { rot: 1.35, flip: -1, ...fist(0.7), ta: 0.6, tc: 0.7 });
      place(p, 'palm', { x: 54, y: -68 });
      break;
    default: { // idle and friends: breathing, a finger drum, a twiddling thumb
      const br = Math.sin(t * 2.2);
      const cyc = t % 4.2;
      const tap = (i) => { const d = cyc - (3 - i) * 0.16; return d > 0 && d < 0.22 ? Math.sin((d / 0.22) * Math.PI) * 0.55 : 0; };
      Object.assign(p, {
        wy: -50 + br * 1.3, sy: 1 + br * 0.018, sx: 1 - br * 0.012, rot: 0.03 * Math.sin(t * 1.1), wx: 1.5 * Math.sin(t * 1.1),
        c0: 0.06 + tap(0), c1: 0.06 + tap(1), c2: 0.08 + tap(2), c3: 0.1 + tap(3), ta: 0.75 + 0.1 * Math.sin(t * 1.6), tc: 0.15 + 0.1 * Math.sin(t * 1.6),
      });
    }
  }
  return p;
}

// ── Painting ─────────────────────────────────────────────────────────────────
/** A shaded tube along a polyline/quadratic (fingers, thumb, legs): outline, 3 value tiers. */
function tube(ctx, pts, w, P, L, dark = false) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 3) ctx.quadraticCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y);
  else ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = P.outline; ctx.lineWidth = w + 5; ctx.stroke();
  ctx.strokeStyle = dark ? P.skinShade : P.skinShade; ctx.lineWidth = w; ctx.stroke();
  ctx.save();
  ctx.translate(L.x * w * 0.14, L.y * w * 0.14);
  ctx.strokeStyle = dark ? P.skinMid : P.skin; ctx.lineWidth = w * 0.72; ctx.stroke();
  ctx.translate(L.x * w * 0.12, L.y * w * 0.12);
  ctx.globalAlpha *= dark ? 0.35 : 0.85; ctx.strokeStyle = P.skinLight; ctx.lineWidth = w * 0.26; ctx.stroke();
  ctx.restore();
}

/** Smooth closed path through points (Catmull-Rom → Bézier). */
function smoothPath(pts) {
  const path = new Path2D(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (i === 0) path.moveTo(p1.x, p1.y);
    path.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
  }
  path.closePath();
  return path;
}

function drawShoe(ctx, foot, toe, P, back) {
  ctx.save();
  ctx.translate(foot.x, foot.y);
  ctx.rotate(toe);
  ctx.beginPath();
  ctx.moveTo(-9, 0); ctx.lineTo(15, 0);
  ctx.quadraticCurveTo(21, 0, 20, -5); ctx.quadraticCurveTo(18, -11, 7, -12);
  ctx.lineTo(-5, -12); ctx.quadraticCurveTo(-11, -12, -11, -5); ctx.closePath();
  kit.fillShaded(ctx, back ? kit.shade(P.shoe, -0.12) : P.shoe, { outline: P.outline, lineWidth: 3, x: 4, y: -6, r: 14, light: 0.1, dark: -0.18 });
  ctx.save(); ctx.clip();
  ctx.fillStyle = back ? kit.shade(P.sole, -0.12) : P.sole;
  ctx.fillRect(-12, -3.4, 34, 4);
  ctx.strokeStyle = back ? kit.shade(P.shoeLight, -0.15) : P.shoeLight; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-6, -6); ctx.quadraticCurveTo(4, -4, 13, -9); ctx.stroke();   // the swoosh
  ctx.restore();
  ctx.restore();
}

function drawLeg(ctx, hip, foot, toe, P, L, back) {
  const ankle = { x: foot.x - Math.sin(toe) * 9, y: foot.y - Math.cos(toe) * 9 };
  const dx = ankle.x - hip.x, dy = ankle.y - hip.y, d = Math.hypot(dx, dy) || 1;
  const bulge = Math.sqrt(Math.max(0, LEG_REST * LEG_REST - d * d)) * 0.7;
  const nx = dy / d, ny = -dx / d;                           // perpendicular, toward +x when the leg points down
  const k = nx >= 0 ? 1 : -1;
  const ctrl = { x: (hip.x + ankle.x) / 2 + nx * bulge * k, y: (hip.y + ankle.y) / 2 + ny * bulge * k };
  tube(ctx, [hip, ctrl, ankle], 15, P, L, back);
  drawShoe(ctx, foot, toe, P, back);
}

function drawFinger(ctx, f, P, L, palmSide) {
  tube(ctx, [f.base, f.joint, f.tip], f.r * 2, P, L);
  const d = f.d2, nx = -d.y, ny = d.x;
  ctx.save();
  ctx.globalAlpha *= 0.3; ctx.fillStyle = P.blush;                 // warm fingertips: skin, not a glove
  ctx.beginPath(); ctx.arc(f.tip.x - d.x * f.r * 0.15, f.tip.y - d.y * f.r * 0.15, f.r * 0.78, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.lineCap = 'round';
  if (!palmSide && f.c < 0.5) {                               // fingernail
    const cx = f.tip.x - d.x * f.r * 0.25, cy = f.tip.y - d.y * f.r * 0.25;
    ctx.translate(cx, cy); ctx.rotate(Math.atan2(d.y, d.x));
    kit.roundRectPath(ctx, -f.r * 0.75, -f.r * 0.52, f.r * 1.25, f.r * 1.04, f.r * 0.45);
    ctx.fillStyle = P.nail; ctx.fill();
    ctx.lineWidth = 1.3; ctx.strokeStyle = P.skinDeep; ctx.stroke();
    ctx.fillStyle = P.skinLight; ctx.globalAlpha *= 0.85;
    ctx.beginPath(); ctx.ellipse(0, -f.r * 0.2, f.r * 0.32, f.r * 0.14, 0, 0, TAU); ctx.fill();
  } else if (f.c < 0.6) {                                    // knuckle creases / pad lines
    ctx.strokeStyle = P.skinDeep; ctx.globalAlpha *= 0.7; ctx.lineWidth = 1.5;
    for (const o of palmSide ? [0] : [-2.5, 2.5]) {
      const jx = f.joint.x + d.x * o, jy = f.joint.y + d.y * o;
      ctx.beginPath(); ctx.moveTo(jx - nx * f.r * 0.45, jy - ny * f.r * 0.45); ctx.lineTo(jx + nx * f.r * 0.45, jy + ny * f.r * 0.45); ctx.stroke();
    }
  } else {                                                   // curled: knuckle highlight
    ctx.globalAlpha *= 0.8; ctx.fillStyle = P.skinLight;
    ctx.beginPath(); ctx.arc(f.tip.x + L.x * f.r * 0.35, f.tip.y + L.y * f.r * 0.35, f.r * 0.32, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawThumb(ctx, g, P, L, palmSide) {
  const th = g.thumb;
  tube(ctx, [th.base, th.joint, th.tip], th.r * 2, P, L);
  if (!palmSide) {
    const d = th.d2;
    ctx.save();
    ctx.translate(th.tip.x - d.x * th.r * 0.3, th.tip.y - d.y * th.r * 0.3); ctx.rotate(Math.atan2(d.y, d.x));
    kit.roundRectPath(ctx, -th.r * 0.7, -th.r * 0.5, th.r * 1.15, th.r, th.r * 0.45);
    ctx.fillStyle = P.nail; ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = P.skinDeep; ctx.stroke();
    ctx.restore();
  }
}

function drawHand(ctx, p, g, P, L, rim, time) {
  const palmSide = p.flip < 0;
  const palm = smoothPath(g.palm);
  const pc = T(p, 0, -34);
  if (!palmSide) drawThumb(ctx, g, P, L, false);
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = 5.5; ctx.strokeStyle = P.outline; ctx.stroke(palm); ctx.restore();
  const order = palmSide ? [0, 1, 2, 3] : [3, 2, 1, 0];
  for (const i of order) drawFinger(ctx, g.fingers[i], P, L, palmSide);

  // Palm: 3 value tiers along the light, an occlusion band at the wrist, rim light.
  const R = 48;
  ctx.fillStyle = kit.linear(ctx, pc.x - L.x * R, pc.y - L.y * R, pc.x + L.x * R, pc.y + L.y * R, [P.skinShade, P.skin, P.skinLight]);
  ctx.fill(palm);
  ctx.save();
  ctx.clip(palm);
  const w0 = T(p, 0, 8), w1 = T(p, 0, -26);
  ctx.fillStyle = kit.linear(ctx, w0.x, w0.y, w1.x, w1.y, [kit.rgba(P.skinDeep, 0.32), kit.rgba(P.skinDeep, 0)]);
  ctx.fill(palm);
  ctx.lineCap = 'round';
  if (!palmSide && Math.abs(p.flip) > 0.25) {
    // tendons fanning to the knuckles, a faint vein, knuckle bumps
    ctx.strokeStyle = P.skinShade; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.55;
    for (const F of FINGERS) {
      const a = T(p, F.x * 0.3, -8), b = T(p, F.x * 0.92, -52), m = T(p, F.x * 0.62, -30);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(m.x, m.y, b.x, b.y); ctx.stroke();
    }
    ctx.strokeStyle = P.vein; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.5;
    const v0 = T(p, -14, 2), v1 = T(p, -4, -22), v2 = T(p, 8, -40);
    ctx.beginPath(); ctx.moveTo(v0.x, v0.y); ctx.quadraticCurveTo(v1.x, v1.y, v2.x, v2.y); ctx.stroke();
    ctx.globalAlpha = 0.75;
    for (const F of FINGERS) {
      const k = T(p, F.x, F.y + 3);
      ctx.fillStyle = P.blush; ctx.globalAlpha = 0.28;
      ctx.beginPath(); ctx.ellipse(k.x, k.y, 8, 5.5, p.rot, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = P.skinLight; ctx.beginPath(); ctx.ellipse(k.x + L.x * 2, k.y + L.y * 2, 5, 3.4, p.rot, 0, TAU); ctx.fill();
      ctx.strokeStyle = P.skinDeep; ctx.lineWidth = 1.3; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(k.x, k.y, 4.5, p.rot + 0.4, p.rot + Math.PI - 0.4); ctx.stroke();
      ctx.globalAlpha = 0.75;
    }
  } else if (palmSide && Math.abs(p.flip) > 0.25) {
    // palm creases + the pad under the thumb
    const th = T(p, 22, -14);
    ctx.fillStyle = kit.radial(ctx, th.x, th.y, 2, 26, [kit.rgba(P.skinLight, 0.5), kit.rgba(P.skinLight, 0)]);
    ctx.fill(palm);
    ctx.strokeStyle = P.skinDeep; ctx.lineWidth = 1.8; ctx.globalAlpha = 0.6;
    const line = (pts) => { const q = pts.map(([x, y]) => T(p, x, y)); ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.quadraticCurveTo(q[1].x, q[1].y, q[2].x, q[2].y); ctx.stroke(); };
    line([[-33, -50], [-8, -42], [20, -55]]);
    line([[30, -40], [0, -36], [-26, -30]]);
    line([[28, -38], [8, -24], [10, -2]]);
  }
  ctx.restore();
  kit.rimLightPath(ctx, palm, L, rim, 3.5, 0.7);

  // Palm side: curled fingers fold over the palm (a real fist), thumb in front.
  if (palmSide) {
    for (const f of g.fingers) {
      if (f.c < 0.45) continue;
      const F = FINGERS[f.i];
      const a = T(p, F.x * 0.95, F.y + 2), b = T(p, F.x * 0.85, F.y + 2 + 30 * f.c);
      tube(ctx, [a, b], F.r * 1.9, P, L);
    }
    drawThumb(ctx, g, P, L, true);
  }
  // A wristwatch on the wrist (the legs come out of the wrist stump below it).
  const strap = smoothPath(g.strap);
  const s0 = T(p, 0, -3), s1 = T(p, 0, -15);
  ctx.save();
  ctx.lineWidth = 5; ctx.strokeStyle = P.outline; ctx.lineJoin = 'round'; ctx.stroke(strap);
  ctx.fillStyle = kit.linear(ctx, s0.x, s0.y, s1.x, s1.y, [P.strapDark, P.strap, kit.shade(P.strap, 0.3)]); ctx.fill(strap);
  ctx.clip(strap);
  const h0 = T(p, -34, -12), h1 = T(p, 34, -12);
  ctx.strokeStyle = kit.shade(P.strap, 0.45); ctx.lineWidth = 1.6; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(h0.x, h0.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
  ctx.restore();
  const fc = T(p, 2, -9);
  if (!palmSide && Math.abs(p.flip) > 0.3) {
    const fr = 10.5 * clamp((Math.abs(p.sx) + p.sy) / 2, 0.8, 1.2);
    kit.circle(ctx, fc.x, fc.y, fr, P.bezel, { outline: P.outline, lineWidth: 2.4, gloss: 0.6 });
    kit.circle(ctx, fc.x, fc.y, fr * 0.7, P.face, { outline: null, lineWidth: 0 });
    ctx.save();
    ctx.strokeStyle = P.outline; ctx.lineCap = 'round';
    const hand = (a, len, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(fc.x, fc.y); ctx.lineTo(fc.x + Math.sin(a) * len, fc.y - Math.cos(a) * len); ctx.stroke(); };
    hand(time * 0.35, fr * 0.42, 2);
    hand(Math.floor(time) * (TAU / 60), fr * 0.58, 1.3);
    ctx.globalAlpha = 0.8; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(fc.x - fr * 0.3, fc.y - fr * 0.35, fr * 0.22, fr * 0.12, -0.5, 0, TAU); ctx.fill();
    ctx.restore();
  } else if (palmSide) {
    const b = T(p, -2, -9);
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(p.rot);
    kit.roundRectPath(ctx, -6, -5, 12, 10, 2.5);
    ctx.lineWidth = 2; ctx.strokeStyle = P.bezel; ctx.stroke();
    ctx.restore();
  }
}

/** Comic strike extras: smear arcs, speed lines, a muzzle flash, the held junk. */
function drawExtras(ctx, anim, k, p, g, P, info) {
  const active = k.ph === 'active' ? 1 : k.ph === 'recovery' ? Math.max(0, 1 - k.pt * 2.5) : 0;
  if (anim.smear && active > 0) {
    const s = anim.smear;
    const sgn = s.to > s.from ? 1 : -1;
    const a0 = s.from - Math.PI / 2, a1 = s.to - Math.PI / 2;
    kit.smear(ctx, g.wrist.x, g.wrist.y, s.r, a0, a1 + sgn * 0.12, s.w, '#ffffff', 0.75 * active);
  }
  if (anim.lines && active > 0) {
    ctx.save(); ctx.globalAlpha *= active;
    if (anim.lines === 'up') kit.speedLines(ctx, g.wrist.x - 40, g.wrist.y + 10, 80, 90, '#ffffff', k.t, { count: 7, alpha: 0.8, dir: 1, width: 2.5 });
    else kit.speedLines(ctx, g.wrist.x - 110, g.wrist.y - 40, 110, 70, '#ffffff', k.t, { count: 8, alpha: 0.8, dir: -1, width: 2.5 });
    ctx.restore();
  }
  if (anim.muzzle && (k.ph === 'active' || (k.ph === 'recovery' && k.pt < 0.15))) {
    const tip = g.fingers[0].tip;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, tip.x + 10, tip.y, 30, P.effect, 0.8);
    kit.starPath(ctx, tip.x + 12, tip.y, 7, 16, 6, k.t * 8);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
  }
  if (anim.quake && active > 0 && k.h) {
    const half = (k.h.w || 200) / 2;
    ctx.save(); ctx.lineCap = 'round';
    for (const sgn of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = (k.h.x || 0) + sgn * half * (0.55 + 0.2 * i);
        ctx.globalAlpha = 0.85 * active * (1 - i * 0.25);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3 - i * 0.6;
        ctx.beginPath(); ctx.ellipse(x, -4, 10 + i * 6, 10 + i * 7, 0, Math.PI * (sgn > 0 ? 1.15 : 1.35), Math.PI * (sgn > 0 ? 1.65 : 1.85)); ctx.stroke();
      }
      kit.glow(ctx, (k.h.x || 0) + sgn * half * 0.8, -6, 26, P.effect, 0.45 * active);
    }
    ctx.restore();
  }
  if (anim.carry && k.ph === 'startup') {
    const c = T(p, 0, -48);
    drawJunk(ctx, k.v.vars?.junk ?? 0, c.x, c.y - 8, k.t * 2, P);
  }
}

// ── Junk (Yeet) ──────────────────────────────────────────────────────────────
function drawJunk(ctx, kind, x, y, rot, P) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  const o = { outline: P.outline, lineWidth: 2.6 };
  switch (kind | 0) {
    case 1: { // bowling ball
      kit.circle(ctx, 0, 0, 15, '#2b2f7a', { ...o, gloss: 0.6 });
      ctx.fillStyle = '#141532';
      for (const [hx, hy] of [[-4, -6], [3, -7], [-1, 1]]) { ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, TAU); ctx.fill(); }
      break;
    }
    case 2: { // rubber duck
      ctx.beginPath(); ctx.ellipse(0, 3, 15, 10, 0, 0, TAU);
      kit.fillShaded(ctx, '#ffd23a', { ...o, x: 0, y: 3, r: 15, gloss: 0.3 });
      kit.circle(ctx, 7, -8, 8, '#ffd23a', { ...o, gloss: 0.3 });
      ctx.beginPath(); ctx.moveTo(14, -8); ctx.lineTo(21, -6); ctx.lineTo(14, -4); ctx.closePath();
      ctx.fillStyle = '#ff8a2a'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = P.outline; ctx.stroke();
      ctx.fillStyle = P.outline; ctx.beginPath(); ctx.arc(9, -10, 1.6, 0, TAU); ctx.fill();
      break;
    }
    case 3: { // soda can
      kit.roundRectPath(ctx, -9, -15, 18, 30, 4);
      kit.fillShaded(ctx, '#e8344a', { ...o, x: 0, y: 0, r: 16, gloss: 0.45 });
      ctx.fillStyle = '#f3f5ff'; ctx.fillRect(-9, -4, 18, 6);
      ctx.fillStyle = '#c9ccd8'; ctx.fillRect(-7, -15, 14, 3);
      break;
    }
    default: { // brick
      kit.roundRectPath(ctx, -16, -9, 32, 18, 2.5);
      kit.fillShaded(ctx, '#c4553a', { ...o, x: 0, y: 0, r: 18 });
      ctx.strokeStyle = '#7a2e22'; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.moveTo(-4, -9); ctx.lineTo(-4, 0); ctx.moveTo(6, 0); ctx.lineTo(6, 9); ctx.stroke();
    }
  }
  ctx.restore();
}

// ── The ArtDef ───────────────────────────────────────────────────────────────
export default {
  rig: 'none',
  bounds: { left: -160, right: 180, top: -285, bottom: 56 },
  palette: PALETTE,
  palettes: [{},
    { skin: '#efc6a4', skinLight: '#fde4cc', skinMid: '#e2b08c', skinShade: '#c9926f', skinDeep: '#9a6a52', nail: '#f7d2c0', strap: '#d8343e', strapDark: '#8e1d2a', shoeLight: '#d8343e', sole: '#e8a0a8' },
    { skin: '#a6dc8c', skinLight: '#e0ffc8', skinMid: '#94c97a', skinShade: '#76ad62', skinDeep: '#4c7a44', nail: '#d8f5b0', vein: '#5f8fb0', strap: '#7a3fd8', strapDark: '#46208a', shoeLight: '#7a3fd8', sole: '#b9a0e8' },
    { skin: '#9a6a52', skinLight: '#d39f80', skinMid: '#8a5d48', skinShade: '#704634', skinDeep: '#4a2c22', nail: '#d8b0a0', vein: '#6a5a80', strap: '#1f6e5a', strapDark: '#0f3e32', bezel: '#d8dce8', shoeLight: '#1f6e5a', sole: '#8fcfbf' }],

  init(cache) { cache.runPh = 0; cache.flat = 0; cache.lastSnap = -1; },

  draw(ctx, v, info) {
    const P = info.palette, c = info.cache;
    const t = info.time, dt = Math.min(0.05, info.dt || 1 / 60);
    const L0 = info.light?.dir || { x: -0.45, y: -0.89 };
    const L = { x: L0.x * (v.facing < 0 ? -1 : 1), y: L0.y };
    const rim = info.light?.rim || '#ffc48a';

    if (v.state === 'run') c.runPh = (c.runPh || 0) + Math.abs(v.vx || 0) * 0.075 * dt * 60;
    const m = v.move;
    const inMove = !!m && (v.state === 'attack' || v.state === 'grabbing' || v.state === 'taunt');
    let p = statePose(v, info, c, inMove);

    // Parachute: the synced `chute` var, smoothed so the hand visibly unfolds.
    // (The Lab's "hover" tile sets view.hover instead of the var, and snaps the spring.)
    const chuteOn = (!!v.vars?.chute || !!v.hover) && !inMove;
    c.flat = info.lab && v.hover ? 1 : lerp(c.flat || 0, chuteOn ? 1 : 0, 1 - Math.exp(-dt * 14));
    if (c.flat > 0.01) {
      const sway = Math.sin(t * 2.1);
      const tilt = clamp((v.vx || 0) * (v.facing || 1) * 0.025, -0.15, 0.15);
      const fl = (i) => 0.08 * Math.sin(t * 9 + i);                 // canopy edges flutter, tips droop into an arch
      const chute = { ...p, persp: 0.6, rot: 1.57 + 0.05 * sway + tilt, fan: 4.4, sx: 1.12, ...fist(0), ta: 1.0, tc: 0.3,
        b0: 0.5 + fl(0), b1: 0.42 + fl(1), b2: 0.36 + fl(2), b3: 0.3 + fl(3),
        f1x: -12 + 5 * Math.sin(t * 3.4), f1y: -20 + 4 * Math.cos(t * 3.4), f2x: 10 + 5 * Math.sin(t * 3.4 + 2.4), f2y: -14 + 4 * Math.cos(t * 3.4 + 2.4), toe: 0.9 };
      place(chute, 'palm', { x: -16, y: -98 + 2 * sway });
      p = blend(p, chute, ease(c.flat));
    }

    // Moves: rest → wind (startup) → strike (active) → rest (recovery), all from the validated phase.
    let anim = null, k = null;
    if (inMove && ANIMS[m.anim]) {
      let ph = info.phase.name, pt = info.phase.t;
      const f = m.frame || 0, dur = m.duration || 30;
      if (!m.def?.hitboxes?.length) {
        const at = strikeAt(m.def) ?? Math.round(dur * 0.35);
        if (f < at) { ph = 'startup'; pt = f / at; } else if (f < at + 5) { ph = 'active'; pt = (f - at) / 5; } else { ph = 'recovery'; pt = (f - at - 5) / Math.max(1, dur - at - 5); }
      }
      k = { h: hitOf(m), ph, pt: clamp(pt || 0, 0, 1), t, f, v, charge: m.charge01 || 0 };
      anim = ANIMS[m.anim](k);
      const make = (part) => {
        const q = { ...p, ...part };
        if (part.anchor) place(q, part.anchor, part.at);
        return q;
      };
      const wind = make(anim.wind), strike = make(anim.strike);
      if (anim.hold) p = blend(p, wind, ease(clamp(f / 12, 0, 1)) * (1 - ease(clamp((f - dur + 14) / 14, 0, 1))));
      else if (ph === 'startup') p = blend(p, wind, ease(k.pt));
      else if (ph === 'charge' || ph === 'hold') {
        p = wind;
        const tr = 1.5 + 2.5 * k.charge;
        p.wx += Math.sin(t * 70) * tr * 0.5; p.wy += Math.cos(t * 83) * tr * 0.4;
        p.sx *= 1 + 0.08 * k.charge; p.sy *= 1 + 0.08 * k.charge;
      } else if (ph === 'active') p = strike;
      else p = blend(strike, p, ease(k.pt));
    }
    // Landing squash / airborne stretch from the host's motion springs.
    const sq = (info.motion?.squash || 0) - (info.motion?.stretch || 0) * 0.4;
    p.sy *= 1 - sq * 0.12; p.sx *= 1 + sq * 0.1;

    const g = geo(p);
    const bs = v.bodyScale || 1;
    ctx.save();
    if (bs !== 1) ctx.scale(bs, bs);

    // Ground contact shadow under the feet (flattened, darker when grounded).
    if (v.grounded) {
      ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = P.outline;
      ctx.beginPath(); ctx.ellipse((p.f1x + p.f2x) / 2 + 3, 1, 34, 5, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    // Legs behind the hand (back leg darker), feet in body space.
    drawLeg(ctx, g.hips[0], { x: p.f1x, y: p.f1y }, p.toe, P, L, true);
    drawLeg(ctx, g.hips[1], { x: p.f2x, y: p.f2y }, p.toe, P, L, false);
    if (anim && (k.ph === 'active' || k.ph === 'recovery') && anim.smear) drawExtras(ctx, { smear: anim.smear }, k, p, g, P, info);
    if (g.pk < 0.999) {
      ctx.save();
      ctx.translate(g.pc.x, g.pc.y); ctx.scale(1, g.pk); ctx.translate(-g.pc.x, -g.pc.y);
      drawHand(ctx, p, g, P, L, rim, t);
      ctx.restore();
    } else drawHand(ctx, p, g, P, L, rim, t);
    if (anim) drawExtras(ctx, { ...anim, smear: null }, k, p, g, P, info);

    // Chute: air rushing past the canopy.
    if (c.flat > 0.5) {
      ctx.save(); ctx.globalAlpha *= (c.flat - 0.5) * 2;
      ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round'; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {                              // air rushing up past the canopy
        const ph = (t * 1.6 + kit.hash01(i, 31)) % 1, x = (i < 3 ? -1 : 1) * (70 + 22 * kit.hash01(i, 33));
        const y = -40 - ph * 110;
        ctx.globalAlpha = 0.5 * Math.sin(ph * Math.PI) * (c.flat - 0.5) * 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 14 - 10 * kit.hash01(i, 35)); ctx.stroke();
      }
      ctx.restore();
    }
    // Dizzy after a shield break.
    if (v.state === 'shieldbreak' || v.state === 'stunned') {
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i / 3) * TAU, top = T(p, 0, -112);
        kit.starPath(ctx, top.x + Math.cos(a) * 30, top.y + Math.sin(a) * 8, 5, 6, 2.6, t * 3 + i);
        ctx.fillStyle = '#ffe14d'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = P.outline; ctx.stroke();
      }
    }
    ctx.restore();
  },

  trail: null,

  entities: {
    bullet: {
      draw(ctx, e, info) {
        const P = info.palette;
        const a = Math.atan2(e.vy || 0, e.vx || 1);
        ctx.save(); ctx.rotate(a);
        ctx.globalCompositeOperation = 'lighter';
        kit.glow(ctx, 0, 0, 22, P.effect, 0.6);
        ctx.strokeStyle = kit.rgba(P.effect, 0.7); ctx.lineCap = 'round';
        for (const [y, l] of [[-5, 26], [0, 38], [5, 22]]) { ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-6, y); ctx.lineTo(-6 - l, y); ctx.stroke(); }
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, TAU);
        kit.fillShaded(ctx, '#fff6d0', { outline: P.outline, lineWidth: 2.4, x: 0, y: 0, r: 10, gloss: 0.6 });
        ctx.restore();
      },
    },
    junk: {
      draw(ctx, e, info) {
        const kind = e.vars?.kind ?? Math.floor(kit.hash01(e.seed || e.id || 0, 7) * 4);
        ctx.save();
        ctx.globalAlpha *= 0.35;
        kit.speedLines(ctx, -44, -12, 34, 24, '#ffffff', info.time, { count: 4, alpha: 0.9, dir: -1, width: 2 });
        ctx.restore();
        drawJunk(ctx, kind, 0, 0, (e.age || 0) * 0.28, info.palette);
      },
    },
  },

  fx: {
    onHit(fx, ev) {
      fx.burst({ x: ev.x, y: ev.y, count: 10, shape: 'spark', colors: ['#ffffff', '#fff1b8', '#ffd34d'], speed: [4, 10], life: [10, 18], blend: 'lighter' });
      fx.burst({ x: ev.x, y: ev.y, count: 4, shape: 'star', colors: ['#ffffff', '#ffe14d'], speed: [2, 6], life: [16, 26] });
      fx.ring({ x: ev.x, y: ev.y, r0: 8, r1: 54, color: '#ffffff', life: 12 });
    },
    onLand(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 6, shape: 'smoke', color: '#e9dfe6', speed: [1, 3], angle: 90, spread: 80, life: [14, 24] }); return true; },
    onJump(fx, ev) { if (ev.double) fx.ring({ x: ev.x, y: ev.y, r0: 6, r1: 34, color: '#ffffff', life: 12 }); return true; },
    onKO(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 18, shape: 'star', colors: ['#ffffff', '#ffe14d', '#3f6fe0'], speed: [2, 8], life: [30, 50] }); return true; },
    onEvent: {
      slap(fx, ev) { fx.ring({ x: ev.x, y: ev.y - 76, r0: 30, r1: 140, color: '#ffffff', life: 14 }); fx.text({ x: ev.x, y: ev.y - 170, text: 'SLAP!', color: '#ffe14d', size: 20, life: 34 }); },
      clap(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 180, count: 8, shape: 'star', colors: ['#ffffff', '#ffe14d'], speed: [2, 6], life: [16, 28] }); fx.ring({ x: ev.x, y: ev.y - 165, r0: 20, r1: 80, color: '#ffffff', life: 12 }); },
      quake(fx, ev) {
        for (const s of [-1, 1]) fx.burst({ x: ev.x + s * 90, y: ev.y, count: 8, shape: 'debris', color: '#e9dfe6', speed: [2, 6], angle: 90 - s * 30, spread: 40, life: [16, 28] });
        fx.burst({ x: ev.x, y: ev.y, count: 10, shape: 'smoke', color: '#e9dfe6', speed: [1, 4], angle: 90, spread: 160, life: [18, 30] });
      },
      snap(fx, ev) { fx.ring({ x: ev.x, y: ev.y - 150, r0: 6, r1: 48, color: '#fff1b8', life: 10, blend: 'lighter' }); fx.burst({ x: ev.x, y: ev.y - 150, count: 6, shape: 'spark', color: '#ffffff', speed: [3, 7], life: [8, 14], blend: 'lighter' }); },
      pew(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 82, count: 4, shape: 'smoke', color: '#ffffff', speed: [0.5, 1.5], angle: 90, spread: 50, life: [16, 26] }); },
      yeet(fx, ev) { fx.text({ x: ev.x, y: ev.y - 160, text: 'yeet', color: '#ffffff', size: 16, life: 30 }); },
      bruh(fx, ev) { fx.text({ x: ev.x, y: ev.y - 165, text: 'bruh.', color: '#e9dfe6', size: 22, life: 60 }); },
    },
  },

  sounds: {
    jump: 'whoosh', slap: 'buzz-thwack', clap: 'buzz-thwack', quake: 'boom', pew: 'zip', yeet: 'whoosh',
    snap: { type: 'square', freq: [2600, 1900], dur: 0.05, gain: 0.25 },
    bruh: { type: 'sawtooth', freq: [150, 92], dur: 0.6, gain: 0.2, vibrato: 0.04 },
  },
  portrait: { x: 0, y: -84, r: 70 },
};
