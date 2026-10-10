// JIGGLYPUFF art — fully procedural. A round pink puffball with huge teal eyes, two
// pointed ears, a curl of fur on the forehead and stubby arms and feet that stretch
// out into every kick. Rollout curls into a rolling ball, Sing pulls out a microphone
// and pulses pastel rings of song, Rest lies down in a little nap with Zs.
//
// Body space: origin at the feet, +x forward, y < 0 up. The body is a circle of
// radius R around C = (0, CY); every limb is drawn toward the move's real hitbox.
import * as kit from '../../shared/art/kit.js';

const TAU = Math.PI * 2;
const R = 31, CY = -31;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const lp = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

const PALETTE = {
  main: '#ffc6de', light: '#fff4f9', shadow: '#f4a4c5', deep: '#d877a2', outline: '#80305a',
  earIn: '#4a2a3e', iris: '#45c4e0', irisDark: '#1a7fa2', pupil: '#103650', mouth: '#8a2348',
  blush: '#ff7fae', mic: '#3b3f52', micHead: '#c8ccd8', effect: '#ff8fc4', song: '#ffd1f0', note: '#7a3fd0',
  bow: '', bowDark: '',
};

// Alternates for duplicate picks: a lilac shiny, a mint one with a red flower bow, a sky one with a blue bow.
const PALETTES = [
  {},
  { main: '#f0b4ee', light: '#fde3fb', shadow: '#cc84cf', deep: '#a45aa8', outline: '#3c1240', iris: '#3fc4a8', irisDark: '#13705a', effect: '#e4a0ff' },
  { main: '#bfe9cf', light: '#eafff1', shadow: '#88c7a2', deep: '#5c9f78', outline: '#173a2a', iris: '#3b8fe0', irisDark: '#173f86', effect: '#8fe8b0', bow: '#e8364a', bowDark: '#8a1426' },
  { main: '#b9d6ff', light: '#e6f1ff', shadow: '#86a8e0', deep: '#5c7cc0', outline: '#16244a', iris: '#2fb0a0', irisDark: '#0f6056', effect: '#9fc8ff', bow: '#3a5ce0', bowDark: '#16287a' },
];

// ── Hitbox helpers: where the striking part should be ────────────────────────
function tip(h) {
  if (!h) return null;
  if (h.shape === 'capsule' || h.x1 !== undefined) return { x: h.x2, y: h.y2 };
  return { x: h.x || 0, y: h.y || 0 };
}
function root(h) {
  if (!h) return null;
  if (h.shape === 'capsule' || h.x1 !== undefined) return { x: h.x1, y: h.y1 };
  return { x: h.x || 0, y: h.y || 0 };
}
const defBox = (v, i = 0) => v.move?.def?.hitboxes?.[i] || null;

// ── Pose: everything the painter needs, computed from state + move phase ─────
function basePose() {
  return {
    cx: 0, cy: CY, rot: 0, sx: 1, sy: 1, puff: 1, ball: false, roll: 0,
    armF: { x: 31, y: -19 }, armB: { x: -30, y: -21 },
    footF: null, footB: null,                       // null = attached to the body
    legF: false, legB: false, armReachF: false, armReachB: false,
    eyes: 'open', mouth: 'smile', look: { x: 0.25, y: 0 },
    mic: false, smear: null, spinFx: 0, drill: 0, zzz: 0, stars: false, flashRest: 0,
  };
}

// windup 0..1 in startup, strike 1 in active fading in recovery
function phaseK(info) {
  const p = info.phase || {};
  const w = p.name === 'startup' ? ease(p.t) : p.name === 'charge' || p.name === 'hold' ? 1 : 0;
  const s = p.name === 'active' ? 1 : p.name === 'recovery' ? 1 - ease(p.t) : 0;
  return { w, s, name: p.name, t: p.t || 0 };
}

// Move poses (by `anim`). Each one moves limbs toward the move's validated hitboxes.
const MOVES = {
  slap(P, v, k, info) {
    const second = v.move.frame >= 8;
    const hb = info.hitboxes[0] || defBox(v, second ? 1 : 0);
    const t = tip(hb);
    const arm = second ? 'armB' : 'armF';
    P[arm] = lp({ x: 12, y: -30 }, t, Math.max(k.s, 0));
    if (second) { P.armB = lp({ x: -14, y: -30 }, t, k.s); P.armReachB = true; } else P.armReachF = true;
    P.rot = 0.12 * k.s - 0.06 * k.w; P.eyes = 'fierce';
  },
  ftilt(P, v, k) {
    const t = tip(defBox(v));
    P.legF = true; P.footF = lp({ x: 4, y: -10 }, t, k.s);
    P.rot = -0.28 * k.s + 0.12 * k.w; P.footB = { x: -12, y: -3 }; P.eyes = 'fierce';
    P.armF = { x: 20, y: -46 }; P.armB = { x: -28, y: -40 };
  },
  utilt(P, v, k) {
    const h = defBox(v);
    const along = k.name === 'active' ? ease(clamp(k.t * 1.4, 0, 1)) : 1;
    const t = lp(root(h), tip(h), along);
    P.legF = true; P.footF = lp({ x: 10, y: -8 }, t, k.s);
    P.rot = -0.42 * k.s + 0.1 * k.w; P.cx = -3 * k.s; P.eyes = 'fierce'; P.look = { x: 0.1, y: -0.5 * k.s };
    P.armF = { x: 28, y: -18 }; P.armB = { x: -26, y: -18 };
    if (k.name === 'active') P.smear = { x: 0, y: -50, r: 44, a0: -0.4, a1: -2.3 };
  },
  dtilt(P, v, k) {
    const t = tip(defBox(v));
    P.legF = true; P.footF = lp({ x: 8, y: -6 }, t, k.s);
    P.sy = 1 - 0.12 * Math.max(k.s, k.w); P.sx = 1 + 0.08 * k.s; P.cy = CY + 4 * k.s; P.rot = -0.12 * k.s; P.eyes = 'fierce';
  },
  fsmash(P, v, k, info) {
    const t = tip(defBox(v));
    const charging = k.name === 'charge';
    const shiver = charging ? Math.sin(info.time * 60) * 0.03 : 0;
    P.legF = true; P.footF = lp({ x: -2, y: -12 }, t, k.s);
    P.rot = -0.42 * k.s + 0.32 * k.w + shiver; P.cx = -8 * k.w + 6 * k.s;
    P.eyes = charging || k.w > 0 ? 'squint' : 'fierce'; P.mouth = 'grit';
    P.armF = { x: 6, y: -60 }; P.armB = { x: -32, y: -46 };
    if (k.name === 'active') P.smear = { x: 18, y: -24, r: 56, a0: 1.1, a1: -0.05 };
  },
  usmash(P, v, k, info) {
    const charging = k.name === 'charge';
    const shiver = charging ? Math.sin(info.time * 60) * 0.02 : 0;
    const crouch = Math.max(k.w, charging ? 1 : 0) * (1 - k.s);
    P.sy = 1 - 0.22 * crouch + 0.16 * k.s; P.sx = 1 + 0.16 * crouch - 0.08 * k.s;
    P.cy = CY + 8 * crouch - 26 * k.s; P.cx = 5 * k.s; P.rot = 0.18 * k.s + shiver;
    P.eyes = k.s > 0.3 ? 'closed' : 'squint'; P.mouth = k.s > 0.3 ? 'grit' : 'flat';
    P.armF = { x: 26, y: -12 }; P.armB = { x: -24, y: -12 };
    if (k.name === 'active') P.smear = { x: 6, y: -60, r: 42, a0: -2.2, a1: -0.8 };
  },
  dsmash(P, v, k, info) {
    const charging = k.name === 'charge';
    const t = tip(defBox(v, 0)), tb = tip(defBox(v, 1)) || { x: -t.x, y: t.y };
    P.legF = true; P.legB = true;
    P.footF = lp({ x: 12, y: -6 }, t, k.s); P.footB = lp({ x: -12, y: -6 }, tb, k.s);
    P.sy = 1 - 0.18 * Math.max(k.s, k.w) + (charging ? Math.sin(info.time * 50) * 0.02 : 0); P.sx = 1 + 0.12 * k.s;
    P.cy = CY + 6 * Math.max(k.s, k.w) - 6 * k.s;
    P.armF = { x: 18, y: -66 }; P.armB = { x: -18, y: -66 }; P.eyes = 'fierce'; P.mouth = 'open';
  },
  nair(P, v, k) {
    const t = tip(defBox(v));
    P.legF = true; P.footF = lp({ x: 8, y: -6 }, t, k.s);
    P.rot = -0.55 * k.s; P.eyes = 'fierce'; P.footB = { x: -14, y: -8 };
    P.armF = { x: 4, y: -62 }; P.armB = { x: -30, y: -44 };
  },
  fair(P, v, k) {
    const t = tip(defBox(v)), r0 = root(defBox(v));
    P.legF = true; P.legB = true;
    P.footF = lp({ x: 8, y: -6 }, t, k.s); P.footB = lp({ x: -8, y: -6 }, lp(r0, t, 0.82), k.s);
    P.rot = -0.95 * k.s + 0.2 * k.w; P.eyes = 'fierce'; P.mouth = 'grit';
    P.armF = { x: -4, y: -64 }; P.armB = { x: -30, y: -50 };
  },
  bair(P, v, k) {
    const t = tip(defBox(v));
    P.legB = true; P.footB = lp({ x: -8, y: -6 }, t, k.s);
    P.rot = 0.5 * k.s - 0.15 * k.w; P.eyes = 'fierce'; P.look = { x: -0.6 * k.s, y: 0 };
    P.armF = { x: 30, y: -40 }; P.armB = { x: 8, y: -62 };
  },
  uair(P, v, k) {
    const h = defBox(v);
    const along = k.name === 'active' ? ease(k.t) : k.name === 'recovery' ? 1 : 0;
    const t = lp(root(h), tip(h), along);
    P.armF = lp({ x: 26, y: -30 }, t, Math.max(k.s, 0.2 * k.w)); P.armReachF = true;
    P.rot = -0.18 * k.s; P.look = { x: 0.1, y: -0.7 }; P.eyes = 'fierce';
    if (k.name === 'active') P.smear = { x: 0, y: -48, r: 30, a0: -0.6, a1: -2.6 };
  },
  dair(P, v, k, info) {
    const h = defBox(v), t = tip(h);
    const on = Math.max(k.s, k.w * 0.6);
    P.legF = true; P.legB = true;
    P.footF = lp({ x: 10, y: -4 }, { x: t.x + 4, y: t.y - 2 }, on); P.footB = lp({ x: -10, y: -4 }, { x: t.x - 10, y: t.y - 6 }, on);
    P.cy = CY - 10 * on; P.rot = 0.12 * on; P.drill = k.name === 'active' ? 1 : 0;
    P.sx = 1 - (P.drill ? 0.12 * Math.abs(Math.sin(info.time * 30)) : 0);
    P.look = { x: Math.sin(info.time * 30) * 0.8 * P.drill, y: 0.4 };
    P.eyes = 'fierce'; P.armF = { x: 16, y: -62 }; P.armB = { x: -20, y: -60 };
  },
  rolloutCharge(P, v, k, info) {
    P.ball = true;
    const charge = clamp((v.vars?.rollCharge || 0) / 90, 0, 1);
    const c = info.cache;
    c.roll = (c.roll || 0) + (0.12 + 0.55 * charge) * k.w * clamp(info.dt * 60, 0, 3);
    P.roll = c.roll; P.spinFx = 0.4 + 0.6 * charge; P.sy = 1 - 0.06 * k.w;
  },
  rollout(P, v, k, info) {
    P.ball = true;
    const c = info.cache;
    c.roll = (c.roll || 0) + (Math.abs(v.vx) / R) * clamp(info.dt * 60, 0, 3) * (v.move.frame < 36 ? 1 : 0.3);
    P.roll = c.roll; P.spinFx = clamp(Math.abs(v.vx) / 10, 0, 1);
  },
  pound(P, v, k) {
    const t = tip(defBox(v));
    P.armF = lp({ x: -18, y: -36 }, t, k.s); P.armReachF = true;
    if (k.name === 'startup') P.armF = lp({ x: 22, y: -26 }, { x: -20, y: -48 }, k.w);
    P.rot = 0.26 * k.s - 0.18 * k.w; P.cx = 6 * k.s - 3 * k.w; P.eyes = 'fierce'; P.mouth = 'grit';
    P.armB = { x: -26, y: -20 };
  },
  sing(P, v, k, info) {
    const sway = Math.sin(info.time * 3.2);
    P.mic = true; P.armF = { x: 20, y: -22 }; P.armB = { x: -28, y: -34 + sway * 4 };
    P.rot = sway * 0.12; P.eyes = 'closed'; P.mouth = v.move.frame > 16 ? 'sing' : 'smile';
    P.sy = 1 + 0.03 * Math.sin(info.time * 6.4); P.sx = 2 - P.sy;
  },
  rest(P, v, k) {
    const f = v.move.frame;
    const down = ease(clamp(f / 6, 0, 1));
    P.rot = -0.28 * down; P.sy = 1 - 0.12 * down; P.sx = 1 + 0.08 * down; P.cy = CY + 3 * down;
    P.eyes = f >= 4 ? 'sleep' : 'closed'; P.mouth = f >= 8 ? 'snore' : 'smile';
    P.armF = { x: 22, y: -14 }; P.armB = { x: -26, y: -14 }; P.footF = { x: 16, y: -6 }; P.footB = { x: -6, y: -4 };
    P.zzz = f >= 14 ? 1 : 0; P.flashRest = f >= 5 && f <= 9 ? 1 - (f - 5) / 5 : 0;
  },
  grab(P, v, k) {
    const h = defBox(v), c = h ? { x: h.x, y: h.y } : { x: 42, y: -32 };
    P.armF = lp({ x: 24, y: -26 }, { x: c.x + 10, y: c.y - 6 }, k.s); P.armB = lp({ x: -20, y: -26 }, { x: c.x + 2, y: c.y + 8 }, k.s);
    P.armReachF = P.armReachB = true; P.rot = 0.18 * k.s; P.eyes = 'fierce';
  },
  pummel(P, v, k) {
    P.armF = lp({ x: 30, y: -36 }, { x: 46, y: -22 }, Math.max(k.s, k.w)); P.armReachF = true; P.armB = { x: 36, y: -14 }; P.armReachB = true;
    P.eyes = 'fierce'; P.rot = 0.1;
  },
  fthrow(P, v, k) {
    P.cx = 12 * k.s - 4 * k.w; P.rot = 0.36 * k.s - 0.2 * k.w; P.armF = { x: 40, y: -30 }; P.armB = { x: 36, y: -18 };
    P.armReachF = P.armReachB = true; P.eyes = 'fierce'; P.mouth = 'grit';
  },
  bthrow(P, v) {
    const t = clamp(v.move.frame / Math.max(1, v.move.duration * 0.6), 0, 1);
    P.rot = -TAU * ease(t); P.cy = CY - Math.sin(Math.PI * t) * 26; P.armF = { x: 20, y: -62 }; P.armB = { x: -20, y: -62 };
    P.eyes = 'fierce'; P.mouth = 'open';
  },
  uthrow(P, v, k) {
    P.puff = 1 + 0.26 * k.s + 0.06 * k.w; P.cy = CY - 4 * k.s; P.armF = { x: 18, y: -70 }; P.armB = { x: -18, y: -70 };
    P.eyes = k.s > 0 ? 'closed' : 'fierce'; P.mouth = k.s > 0 ? 'puff' : 'grit';
  },
  dthrow(P, v, k, info) {
    const on = v.move.frame >= 4 && v.move.frame < 30 ? 1 : 0;
    P.cx = 20 * on + Math.sin(info.time * 28) * 5 * on; P.cy = CY + 6 * on; P.sy = 1 - 0.18 * on; P.sx = 1 + 0.12 * on; P.rot = 0.42 * on;
    P.eyes = on ? 'closed' : 'fierce'; P.mouth = on ? 'grit' : 'smile';
    P.armF = { x: 46, y: -6 }; P.armB = { x: 28, y: -4 };
  },
  taunt(P, v, k, info) {
    const t = clamp(v.move.frame / v.move.duration, 0, 1);
    const inflate = Math.sin(Math.PI * clamp((t - 0.12) / 0.7, 0, 1));
    P.puff = 1 + 0.32 * inflate; P.cy = CY - R * 0.32 * inflate;
    P.armF = { x: 30 + 6 * inflate, y: -40 - 10 * inflate }; P.armB = { x: -30 - 6 * inflate, y: -40 - 10 * inflate };
    P.eyes = inflate > 0.2 ? 'happy' : 'open'; P.mouth = inflate > 0.2 ? 'puff' : 'smile';
    P.rot = Math.sin(info.time * 5) * 0.05;
  },
};

function statePose(P, v, info) {
  const t = info.time, cache = info.cache;
  const blink = (t % 3.9) < 0.13;
  switch (v.state) {
    case 'idle': case 'respawn': {
      const br = Math.sin(t * 2.6);
      P.sy = 1 + 0.025 * br; P.sx = 1 - 0.02 * br;
      P.armF = { x: 31, y: -19 + br * 1.5 }; P.armB = { x: -30, y: -21 + br * 1.5 };
      if (blink) P.eyes = 'blink';
      P.look = { x: 0.25 + 0.15 * Math.sin(t * 0.7), y: 0.05 * Math.sin(t * 0.9) };
      break;
    }
    case 'run': {
      const ph = t * 15;
      P.rot = 0.14; P.cy = CY - Math.abs(Math.sin(ph)) * 4;
      P.footF = { x: 6 + Math.cos(ph) * 12, y: -4 - Math.max(0, Math.sin(ph)) * 8 };
      P.footB = { x: -6 - Math.cos(ph) * 12, y: -4 - Math.max(0, -Math.sin(ph)) * 8 };
      P.armF = { x: 32, y: -20 - Math.sin(ph) * 4 }; P.armB = { x: -30, y: -20 + Math.sin(ph) * 4 };
      P.mouth = 'open';
      break;
    }
    case 'crouch': P.sy = 0.74; P.sx = 1.2; P.cy = -24; P.armF = { x: 30, y: -14 }; P.armB = { x: -28, y: -14 }; P.footF = { x: 16, y: -3 }; P.footB = { x: -16, y: -3 }; if (blink) P.eyes = 'blink'; break;
    case 'jumpsquat': case 'land': P.sy = 0.84; P.sx = 1.12; P.cy = CY + 4; break;
    case 'air': case 'helpless': {
      const rising = v.vy < -1;
      const flap = rising ? Math.sin(t * 22) : 0;
      if (rising) { P.armF = { x: 28, y: -46 - flap * 8 }; P.armB = { x: -26, y: -46 + flap * 8 }; P.footF = { x: 9, y: -6 }; P.footB = { x: -9, y: -6 }; P.mouth = 'open'; }
      else { P.armF = { x: 32, y: -34 }; P.armB = { x: -30, y: -34 }; P.footF = { x: 12, y: -2 }; P.footB = { x: -12, y: -2 }; }
      if (v.state === 'helpless') { P.eyes = 'worried'; P.mouth = 'flat'; }
      else if (blink) P.eyes = 'blink';
      break;
    }
    case 'shield': P.sy = 0.92; P.sx = 1.05; P.eyes = 'squint'; P.mouth = 'flat'; P.armF = { x: 18, y: -30 }; P.armB = { x: -18, y: -30 }; break;
    case 'roll': case 'spotdodge': {
      P.ball = true; cache.roll = (cache.roll || 0) + (v.state === 'roll' ? 0.32 : 0.18) * clamp(info.dt * 60, 0, 3); P.roll = cache.roll; P.spinFx = 0.4;
      break;
    }
    case 'airdodge': P.rot = Math.sin(v.stateFrame * 0.35) * 0.3; P.eyes = 'closed'; P.mouth = 'flat'; P.armF = { x: 18, y: -40 }; P.armB = { x: -18, y: -40 }; break;
    case 'hitstun': {
      P.eyes = 'hurt'; P.mouth = 'open';
      const fl = Math.sin(t * 30);
      P.armF = { x: 30, y: -44 + fl * 8 }; P.armB = { x: -30, y: -44 - fl * 8 };
      P.footF = { x: 14, y: -2 }; P.footB = { x: -14, y: -2 };
      if (v.tumble) { cache.tumble = (cache.tumble || 0) + 0.28 * clamp(info.dt * 60, 0, 3); P.rot = cache.tumble; }
      else P.rot = -0.25;
      break;
    }
    case 'shieldbreak': case 'stunned': P.eyes = 'dizzy'; P.mouth = 'open'; P.stars = true; P.rot = Math.sin(t * 3) * 0.15; P.armF = { x: 26, y: -16 }; P.armB = { x: -26, y: -16 }; break;
    case 'grabbed': P.eyes = 'hurt'; P.mouth = 'open'; P.sx = 0.88; P.sy = 1.08; P.armF = { x: 30, y: -48 }; P.armB = { x: -30, y: -48 }; break;
    case 'glide': case 'fly': case 'wallcling': case 'crawl': break;
    default: break;
  }
}

function buildPose(v, info) {
  const P = basePose();
  const m = v.move;
  if (m && (v.state === 'attack' || v.state === 'grabbing' || v.state === 'taunt') && MOVES[m.anim]) {
    const k = phaseK(info);
    MOVES[m.anim](P, v, k, info);
  } else statePose(P, v, info);
  if (v.state !== 'tumble' && !(v.state === 'hitstun' && v.tumble)) info.cache.tumble = 0;
  return P;
}

// Body-local point → body space, through the pose transform (rotation + squash around the center).
function bodyPt(P, lx, ly) {
  const c = Math.cos(P.rot), s = Math.sin(P.rot);
  const x = lx * P.sx * P.puff, y = ly * P.sy * P.puff;
  return { x: P.cx + x * c - y * s, y: P.cy + x * s + y * c };
}

// ── Painters ──────────────────────────────────────────────────────────────────
function drawLeg(ctx, P, Pal, hipL, foot, back, light) {
  const hip = bodyPt(P, hipL.x, hipL.y);
  const col = back ? Pal.shadow : Pal.main;
  kit.limb(ctx, hip, foot, 10.5, 9, col, { outline: Pal.outline, lineWidth: 3, light: 0.25, dark: -0.12 });
  drawFoot(ctx, Pal, foot, Math.atan2(foot.y - hip.y, foot.x - hip.x), back, light);
}

function drawFoot(ctx, Pal, f, ang, back, light) {
  ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(ang);
  ctx.beginPath(); ctx.ellipse(2, 0, 11, 8, 0, 0, TAU);
  kit.fillShaded(ctx, back ? Pal.shadow : Pal.main, { outline: Pal.outline, lineWidth: 3, x: 2, y: 0, r: 11, light: 0.3, dark: -0.12 });
  ctx.beginPath(); ctx.ellipse(6, 1, 4.5, 5, 0, 0, TAU); ctx.fillStyle = kit.rgba(back ? Pal.deep : Pal.shadow, 0.6); ctx.fill(); // pad
  ctx.restore();
  if (!back) kit.rimArc(ctx, f.x, f.y, 9, light.dir, Pal.light, 2, 0.5, 1.2);
}

function drawArm(ctx, P, Pal, shoulderL, hand, back, reach, light) {
  const sh = bodyPt(P, shoulderL.x, shoulderL.y);
  const col = back ? Pal.shadow : Pal.main;
  const d = Math.hypot(hand.x - sh.x, hand.y - sh.y);
  if (reach && d > 10) kit.limb(ctx, sh, hand, 6.5, 6, col, { outline: Pal.outline, lineWidth: 3, light: 0.25, dark: -0.12 });
  // stubby nub of a hand
  const a = Math.atan2(hand.y - sh.y, hand.x - sh.x);
  const hx = hand.x, hy = hand.y;
  ctx.beginPath(); ctx.ellipse(hx, hy, reach ? 9.5 : 10, reach ? 8 : 7, a, 0, TAU);
  kit.fillShaded(ctx, col, { outline: Pal.outline, lineWidth: 3, x: hx, y: hy, r: 10, light: 0.3, dark: -0.12 });
  if (!back) kit.rimArc(ctx, hx, hy, 8, light.dir, Pal.light, 1.8, 0.45, 1.2);
  return { x: hx, y: hy, a };
}

function drawEar(ctx, Pal, side, sway) {
  // side: +1 front ear, -1 back ear. Drawn in body-local coords (origin at the body center).
  const base = side > 0 ? -0.95 : -2.2;            // where the ear leaves the circle (radians)
  const w = 0.46;
  const a0 = base - w, a1 = base + w;
  const tipA = base + (side > 0 ? 0.12 : -0.12) + sway;
  const p0 = { x: Math.cos(a0) * (R - 2), y: Math.sin(a0) * (R - 2) };
  const p1 = { x: Math.cos(a1) * (R - 2), y: Math.sin(a1) * (R - 2) };
  const tp = { x: Math.cos(tipA) * (R + 24), y: Math.sin(tipA) * (R + 24) };
  ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
  ctx.quadraticCurveTo((p0.x + tp.x) / 2 - 2, (p0.y + tp.y) / 2 - 2, tp.x, tp.y);
  ctx.quadraticCurveTo((p1.x + tp.x) / 2 + 2, (p1.y + tp.y) / 2 + 2, p1.x, p1.y); ctx.closePath();
  kit.fillShaded(ctx, side > 0 ? Pal.main : Pal.shadow, { outline: Pal.outline, lineWidth: 3, x: tp.x, y: tp.y + 8, r: 16 });
  // dark inner ear
  const ip0 = lp(p0, p1, 0.25), ip1 = lp(p0, p1, 0.75), it = lp(tp, { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, 0.22);
  ctx.beginPath(); ctx.moveTo(ip0.x, ip0.y); ctx.quadraticCurveTo((ip0.x + it.x) / 2, (ip0.y + it.y) / 2 - 1, it.x, it.y);
  ctx.quadraticCurveTo((ip1.x + it.x) / 2, (ip1.y + it.y) / 2 + 1, ip1.x, ip1.y); ctx.closePath();
  ctx.fillStyle = Pal.earIn; ctx.fill();
}

function drawTuft(ctx, Pal, sway) {
  // The forehead curl: one tuft rising from the crown and curling forward into a spiral.
  const s = sway;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(-6, -R + 6);
    ctx.bezierCurveTo(-4 + s * 3, -R - 8, 12 + s * 5, -R - 9, 13 + s * 4, -R - 1);
    ctx.bezierCurveTo(13.5 + s * 3, -R + 5, 6 + s * 2, -R + 6, 6 + s * 1.5, -R + 1.5);
  };
  path(); ctx.strokeStyle = Pal.outline; ctx.lineWidth = 11; ctx.stroke();
  path(); ctx.strokeStyle = Pal.main; ctx.lineWidth = 6; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-3, -R - 1); ctx.bezierCurveTo(-1 + s * 3, -R - 6, 7 + s * 4, -R - 7, 10 + s * 4, -R - 3);
  ctx.strokeStyle = kit.rgba(Pal.light, 0.9); ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

function drawBow(ctx, Pal) {
  if (!Pal.bow) return;
  ctx.save(); ctx.translate(-16, -R + 2); ctx.rotate(-0.5);
  for (const sd of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(sd * 12, -10, sd * 15, 0); ctx.quadraticCurveTo(sd * 12, 10, 0, 0); ctx.closePath();
    kit.fillShaded(ctx, Pal.bow, { outline: Pal.outline, lineWidth: 2.5, x: sd * 8, y: 0, r: 10, gloss: 0.3 });
  }
  kit.circle(ctx, 0, 0, 4.5, Pal.bowDark || Pal.bow, { outline: Pal.outline, lineWidth: 2.5 });
  ctx.restore();
}

function drawEye(ctx, Pal, x, y, rx, ry, P, mode) {
  const lw = 2.6;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = Pal.outline;
  if (mode === 'blink' || mode === 'closed' || mode === 'sleep') {
    ctx.lineWidth = 3; ctx.beginPath();
    if (mode === 'sleep') { ctx.moveTo(x - rx * 0.8, y + 1); ctx.lineTo(x + rx * 0.8, y + 1); }
    else ctx.arc(x, y - (mode === 'closed' ? 3 : 0), rx * 0.85, mode === 'closed' ? 0.25 : 0.2, mode === 'closed' ? Math.PI - 0.25 : Math.PI - 0.2);
    ctx.stroke(); ctx.restore(); return;
  }
  if (mode === 'happy') { ctx.lineWidth = 3.2; ctx.beginPath(); ctx.arc(x, y + 3, rx * 0.8, Math.PI + 0.35, TAU - 0.35); ctx.stroke(); ctx.restore(); return; }
  if (mode === 'hurt') {
    ctx.lineWidth = 3.2; ctx.beginPath();
    ctx.moveTo(x - rx * 0.7, y - ry * 0.5); ctx.lineTo(x + rx * 0.5, y); ctx.lineTo(x - rx * 0.7, y + ry * 0.5);
    ctx.stroke(); ctx.restore(); return;
  }
  if (mode === 'dizzy') {
    ctx.lineWidth = 2.4; ctx.beginPath();
    for (let i = 0; i <= 26; i++) { const a = i * 0.55, r = i * 0.32; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke(); ctx.restore(); return;
  }
  // open-type eyes: white sclera ring, big teal iris, dark pupil, highlights
  const squint = mode === 'squint' ? 0.55 : mode === 'fierce' ? 0.82 : 1;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry * squint, 0, 0, TAU);
  ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = lw; ctx.stroke();
  ctx.save(); ctx.clip();
  const ix = x + P.look.x * rx * 0.35, iy = y + P.look.y * ry * 0.3 + 1;
  ctx.beginPath(); ctx.ellipse(ix, iy, rx * 0.86, ry * 0.9, 0, 0, TAU);
  ctx.fillStyle = kit.radial(ctx, ix, iy + ry * 0.2, 1, ry, [kit.shade(Pal.iris, 0.35), Pal.iris, Pal.irisDark]); ctx.fill();
  ctx.beginPath(); ctx.ellipse(ix + rx * 0.05, iy + 1, rx * 0.36, ry * 0.44, 0, 0, TAU); ctx.fillStyle = Pal.pupil; ctx.fill();
  ctx.beginPath(); ctx.ellipse(ix - rx * 0.3, iy - ry * 0.38, rx * 0.36, ry * 0.3, -0.4, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.beginPath(); ctx.arc(ix + rx * 0.32, iy + ry * 0.38, rx * 0.15, 0, TAU); ctx.fill();
  ctx.restore();
  // upper lid line (thick lash line, the Jigglypuff look)
  ctx.lineWidth = 3.4; ctx.beginPath(); ctx.ellipse(x, y, rx, ry * squint, 0, Math.PI + 0.25, TAU - 0.25); ctx.stroke();
  if (mode === 'fierce' || mode === 'squint') {
    const dir = x > 4 ? 1 : -1;
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - rx * 0.9 * dir, y - ry * squint - 5); ctx.lineTo(x + rx * 0.7 * dir, y - ry * squint - 1); ctx.stroke();
  }
  if (mode === 'worried') {
    const dir = x > 4 ? 1 : -1;
    ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(x - rx * 0.8 * dir, y - ry - 1); ctx.lineTo(x + rx * 0.6 * dir, y - ry - 6); ctx.stroke();
  }
  ctx.restore();
}

function drawMouth(ctx, Pal, x, y, mode, t) {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = Pal.outline; ctx.lineWidth = 2.6;
  switch (mode) {
    case 'open': case 'sing': {
      const h = mode === 'sing' ? 5 + Math.abs(Math.sin(t * 7)) * 3 : 5;
      ctx.beginPath(); ctx.ellipse(x, y + 1, 4.5, h, 0, 0, TAU); ctx.fillStyle = Pal.mouth; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y + h * 0.55, 2.8, h * 0.35, 0, 0, TAU); ctx.fillStyle = Pal.blush; ctx.fill();
      break;
    }
    case 'puff': ctx.beginPath(); ctx.ellipse(x, y, 3.5, 2.5, 0, 0, TAU); ctx.fillStyle = Pal.mouth; ctx.fill(); ctx.stroke(); break;
    case 'grit': ctx.beginPath(); ctx.moveTo(x - 5, y + 1); ctx.lineTo(x + 5, y - 1); ctx.stroke(); break;
    case 'flat': ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.stroke(); break;
    case 'snore': ctx.beginPath(); ctx.ellipse(x, y, 3, 2.2 + Math.sin(t * 2.2) * 0.8, 0, 0, TAU); ctx.fillStyle = Pal.mouth; ctx.fill(); ctx.stroke(); break;
    default: ctx.beginPath(); ctx.arc(x, y - 3, 5, 0.35, Math.PI - 0.35); ctx.stroke();
  }
  ctx.restore();
}

// The round body, ears, curl and face — drawn in body-local coords around the center.
function drawBody(ctx, P, Pal, info, v) {
  const L = info.light, cache = info.cache, t = info.time;
  ctx.save();
  ctx.translate(P.cx, P.cy); ctx.rotate(P.rot + (P.ball ? P.roll : 0)); ctx.scale(P.sx * P.puff, P.sy * P.puff);

  if (P.ball) {
    // Curled up for Rollout: ears folded flat, a spinning swirl, the face rolling around with it.
    for (const sd of [1, -1]) drawEar(ctx, Pal, sd, 0.9 * sd);
    ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, TAU);
    kit.fillShaded(ctx, Pal.main, { outline: Pal.outline, lineWidth: 2.8, x: 0, y: 0, r: R, light: 0.3, dark: -0.32 });
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(0, 0, R * (0.35 + i * 0.2), i * 2.1, i * 2.1 + 1.6);
      ctx.strokeStyle = kit.rgba(i === 1 ? Pal.light : Pal.shadow, 0.9); ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.restore();
    drawEye(ctx, Pal, 12, -6, 6.5, 6, P, 'closed'); drawEye(ctx, Pal, -4, -6, 5.5, 6, P, 'closed');
    ctx.restore();
    // rim light in unrotated space
    kit.rimArc(ctx, P.cx, P.cy, (R - 3) * P.sy, L.dir, Pal.light, 3, 0.75);
    return;
  }

  // ears (back one first), tuft spring
  const earSway = clamp(cache.earV || 0, -0.4, 0.4);
  drawEar(ctx, Pal, -1, -earSway);
  // the body circle with three value tiers
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU);
  kit.fillShaded(ctx, Pal.main, { outline: Pal.outline, lineWidth: 2.8, x: 0, y: 0, r: R, light: 0.2, dark: -0.07 });
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R - 1.6, 0, TAU); ctx.clip();
  ctx.beginPath(); ctx.ellipse(4, R * 0.95, R * 1.05, R * 0.55, 0, 0, TAU); ctx.fillStyle = kit.rgba(Pal.shadow, 0.45); ctx.fill(); // belly shadow
  ctx.beginPath(); ctx.ellipse(-R * 0.35, -R * 0.45, R * 0.42, R * 0.28, -0.6, 0, TAU); ctx.fillStyle = kit.rgba(Pal.light, 0.55); ctx.fill(); // soft highlight
  ctx.restore();
  drawEar(ctx, Pal, 1, earSway);
  kit.rimArc(ctx, 0, 0, R - 2, L.dir, Pal.light, 3, 0.8);
  drawTuft(ctx, Pal, clamp(cache.tuft || 0, -1, 1));
  drawBow(ctx, Pal);

  // face (3/4 view toward +x)
  const fx = 5 + P.look.x * 2;
  drawEye(ctx, Pal, fx + 11, -5, 9.5, 11.5, P, P.eyes);
  drawEye(ctx, Pal, fx - 11, -5, 8.2, 11, P, P.eyes);
  if (P.eyes !== 'hurt' && P.eyes !== 'dizzy') {
    ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = Pal.blush;
    ctx.beginPath(); ctx.ellipse(fx + 21, 9, 5, 3, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(fx - 20, 9, 4, 3, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  drawMouth(ctx, Pal, fx + 1, 13, P.mouth, t);
  ctx.restore();
}

function drawMic(ctx, Pal, hand) {
  ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(-1.15);
  kit.roundRectPath(ctx, -2, -4, 22, 8, 3);
  kit.fillShaded(ctx, Pal.mic, { outline: Pal.outline, lineWidth: 2.5, x: 9, y: 0, r: 11, gloss: 0.4 });
  kit.circle(ctx, 24, 0, 7.5, Pal.micHead, { outline: Pal.outline, lineWidth: 2.5, gloss: 0.6 });
  ctx.strokeStyle = kit.rgba(Pal.outline, 0.5); ctx.lineWidth = 1.2;
  for (const d of [-3, 0, 3]) { ctx.beginPath(); ctx.moveTo(24 + d, -6); ctx.lineTo(24 + d, 6); ctx.stroke(); }
  ctx.restore();
}

function drawNote(ctx, x, y, s, color, outline, kind) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = color; ctx.strokeStyle = outline; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.ellipse(0, 0, 4.6, 3.4, -0.4, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.rect(3.4, -14, 2, 13); ctx.fill(); ctx.stroke();
  if (kind) { ctx.beginPath(); ctx.moveTo(5.4, -14); ctx.quadraticCurveTo(11, -10, 9, -4); ctx.lineWidth = 2.4; ctx.stroke(); }
  ctx.restore();
}

// Particle shape: a music note (fx.burst shape function).
function noteParticle(ctx, p) {
  const T = ctx.getTransform ? ctx.getTransform() : null;
  if (T) ctx.rotate(-Math.atan2(T.b, T.a) + Math.sin(p.seed + p.k * 6) * 0.3);
  drawNote(ctx, 0, 0, p.size / 10, p.color, '#3a1440', p.seed & 1);
}
// Particle shape: Rest's little flower.
function flowerParticle(ctx, p) {
  const r = p.size * 0.5;
  ctx.fillStyle = p.color;
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; ctx.beginPath(); ctx.ellipse(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, r * 0.5, r * 0.32, a, 0, TAU); ctx.fill(); }
  ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, TAU); ctx.fillStyle = '#ffe36b'; ctx.fill();
}

function drawZ(ctx, x, y, s, alpha, Pal) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.scale(s, s); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const path = () => { ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, -6); ctx.lineTo(-6, 6); ctx.lineTo(6, 6); };
  path(); ctx.strokeStyle = Pal.outline; ctx.lineWidth = 6; ctx.stroke();
  path(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
}

export default {
  rig: 'none',
  bounds: { left: -118, right: 128, top: -150, bottom: 30 },
  palette: PALETTE,
  palettes: PALETTES,

  init(cache) { cache.tuft = 0; cache.tuftV = 0; cache.earV = 0; cache.roll = 0; cache.tumble = 0; },

  draw(ctx, v, info) {
    const Pal = info.palette, cache = info.cache, t = info.time, L = info.light;
    const P = buildPose(v, info);
    const dt = clamp(info.dt || 1 / 60, 0, 0.1) * 60;

    // secondary motion: the forehead curl and the ears lag behind velocity on springs
    const target = clamp(-v.vx * 0.08 + v.vy * 0.04 - P.rot * 0.5, -1, 1) + Math.sin(t * 2.1) * 0.08;
    cache.tuftV = (cache.tuftV + (target - cache.tuft) * 0.18 * dt) * Math.pow(0.82, dt);
    cache.tuft += cache.tuftV * dt;
    if (info.lab && v.state === 'idle' && !v.move) cache.tuft = clamp(cache.tuft, -0.3, 0.3);
    cache.earV = lerp(cache.earV || 0, clamp(v.vy * 0.03, -0.3, 0.3) + Math.sin(t * 1.7) * 0.03, 0.2);

    // motion squash from the host (landing / jumpsquat / air speed)
    const sq = (info.motion?.squash || 0) - (info.motion?.stretch || 0) * 0.5;
    P.sx *= 1 + sq * 0.14; P.sy *= 1 - sq * 0.14;
    if (!P.ball && v.grounded) P.cy += sq * 4;

    // anchors on the body (body-local)
    const hipF = { x: 10, y: R * 0.7 }, hipB = { x: -10, y: R * 0.7 };
    const shF = { x: R * 0.72, y: R * 0.2 }, shB = { x: -R * 0.72, y: R * 0.2 };
    const restFF = bodyPt(P, 11, R * 0.9), restFB = bodyPt(P, -11, R * 0.9);
    const footF = P.footF || restFF, footB = P.footB || restFB;

    // Sing: pastel rings of song filling the real hitboxes
    if (v.move?.anim === 'sing' && info.phase.name === 'active') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const hb of info.hitboxes) {
        kit.shapePath(ctx, hb);
        ctx.fillStyle = kit.radial(ctx, hb.x, hb.y, 4, hb.r, [kit.rgba(Pal.song, 0.55), kit.rgba(Pal.effect, 0.3)]); ctx.fill();
      }
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.9 + i / 3) % 1);
        ctx.globalAlpha = 0.8 * (1 - k);
        ctx.beginPath(); ctx.ellipse(0, CY, 20 + k * 52, 18 + k * 30, 0, 0, TAU); ctx.strokeStyle = i === 1 ? Pal.note : Pal.effect; ctx.stroke();
      }
      ctx.restore();
    }

    if (P.ball) {
      // Rollout: dust and speed streaks behind the ball
      if (P.spinFx > 0) {
        ctx.save(); ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const yy = P.cy - 20 + i * 13, len = 20 + 22 * P.spinFx + kit.noise1(t * 6 + i, i) * 12;
          ctx.globalAlpha = 0.55 * P.spinFx; ctx.strokeStyle = i & 1 ? Pal.light : '#ffffff'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(P.cx - R - 4, yy); ctx.lineTo(P.cx - R - 4 - len, yy); ctx.stroke();
        }
        ctx.restore();
        if (v.grounded) info.fx.local.smoke({ x: -18, y: -2, rate: 0.35 * P.spinFx, color: '#e8d8c8', size: [4, 8], life: [14, 22] });
      }
      drawBody(ctx, P, Pal, info, v);
      return;
    }

    // smear arcs behind the strike
    if (P.smear) kit.smear(ctx, P.smear.x, P.smear.y, P.smear.r, P.smear.a0, P.smear.a1, 12, Pal.light, 0.7);

    // back limbs, body, front limbs
    if (P.legB) drawLeg(ctx, P, Pal, hipB, footB, true, L); else drawFoot(ctx, Pal, footB, 0, true, L);
    const handB = drawArm(ctx, P, Pal, shB, P.armB, true, P.armReachB, L);
    const frontLegOver = P.legF && footF.x > 0;
    if (!frontLegOver) { if (P.legF) drawLeg(ctx, P, Pal, hipF, footF, false, L); else drawFoot(ctx, Pal, footF, 0, false, L); }
    drawBody(ctx, P, Pal, info, v);
    if (frontLegOver) drawLeg(ctx, P, Pal, hipF, footF, false, L);
    const handF = drawArm(ctx, P, Pal, shF, P.armF, false, P.armReachF, L);
    if (P.mic) drawMic(ctx, Pal, handF);
    void handB;

    // Drill Kick: spiralling wind around the feet
    if (P.drill) {
      const c = { x: (footF.x + footB.x) / 2, y: (footF.y + footB.y) / 2 };
      ctx.save(); ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a = t * 26 + i * 2.1;
        ctx.beginPath(); ctx.ellipse(c.x, c.y - 4, 20, 9, 0.75, a, a + 2.2);
        ctx.strokeStyle = kit.rgba(i === 1 ? '#ffffff' : Pal.light, 0.85); ctx.lineWidth = 3; ctx.stroke();
      }
      ctx.restore();
    }

    // impact flash on active frames: a puff star at the striking point
    if (info.phase.name === 'active' && v.move && v.move.anim !== 'sing' && v.move.anim !== 'rest') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const hb of info.hitboxes) {
        if (hb.kind && hb.kind !== 'strike') continue;
        const p = kit.shapeKind(hb) === 'capsule' ? { x: hb.x2, y: hb.y2 } : kit.shapeCenter(hb);
        const r = hb.r || Math.min(hb.w || 20, hb.h || 20) / 2;
        kit.glow(ctx, p.x, p.y, r * 1.1, Pal.effect, 0.35);
      }
      ctx.restore();
    }

    // Rest: the point-blank flash, then Zs drifting up
    if (P.flashRest > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      kit.glow(ctx, 0, CY, 46, '#fff6c8', 0.8 * P.flashRest);
      kit.starPath(ctx, 0, CY, 8, 34 * P.flashRest + 10, 8, t * 2); ctx.fillStyle = kit.rgba('#ffffff', 0.8 * P.flashRest); ctx.fill();
      ctx.restore();
    }
    if (P.zzz) {
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.45 + i / 3) % 1;
        drawZ(ctx, 18 + k * 30 + Math.sin(k * 6 + i) * 4, -64 - k * 60, 0.6 + k * 0.6, Math.sin(Math.PI * k), Pal);
      }
    }
    // Dizzy stars after a shield break
    if (P.stars) {
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i / 3) * TAU;
        const x = P.cx + Math.cos(a) * 26, y = P.cy - R - 12 + Math.sin(a) * 6;
        kit.starPath(ctx, x, y, 5, 6, 2.6, a); ctx.fillStyle = '#ffe36b'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = Pal.outline; ctx.stroke();
      }
    }
    // A living idle: an occasional music note floats off Jigglypuff
    if (v.state === 'idle' && !info.lab) info.fx.local.emit(noteParticle, { x: 14, y: -70, rate: 0.008, colors: [Pal.note, Pal.effect], speed: [0.3, 0.8], angle: 80, spread: 30, gravity: -0.02, life: [50, 70], size: [9, 12] });
  },

  drawBack(ctx, v, info) {
    // a soft pink glow under the feet while singing
    if (v.move?.anim === 'sing' && info.phase.name === 'active') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.scale(1, 0.3);
      kit.glow(ctx, 0, 0, 90, info.palette.effect, 0.25);
      ctx.restore();
    }
  },

  trail: (v, info) => {
    if (!v.move || info.phase.name !== 'active' || !info.hitboxes.length) return null;
    const hb = info.hitboxes[0];
    if (v.move.anim === 'sing' || v.move.anim === 'rest') return false;
    return kit.shapeKind(hb) === 'capsule' ? { x: hb.x2, y: hb.y2 } : kit.shapeCenter(hb);
  },

  fx: {
    onHit(fx, ev, info) {
      const P = info.palette, dmg = ev.damage || 0, pow = clamp((ev.kb || 0) / 120, 0, 1);
      if (ev.effect === 'sing') {
        fx.burst({ x: ev.x, y: ev.y - 10, count: 3, shape: noteParticle, colors: [P.note, P.effect], speed: [0.6, 1.6], angle: 90, spread: 70, gravity: -0.03, life: [30, 46], size: [10, 13] });
        return;
      }
      if (ev.effect === 'rest' || dmg >= 14) {
        fx.burst({ x: ev.x, y: ev.y, count: 10, shape: flowerParticle, colors: ['#ffb6e1', '#ff7fae', '#ffffff'], speed: [2, 7], gravity: 0.08, drag: 0.96, life: [30, 50], size: [10, 16] });
        fx.ring({ x: ev.x, y: ev.y, r0: 10, r1: 90, color: '#fff6c8', life: 16, width: 6 });
        fx.flash('#fff6c8', 0.25, 4); fx.shake(6);
      }
      fx.burst({ x: ev.x, y: ev.y, count: 5 + Math.round(dmg * 0.7), shape: 'star', colors: ['#ffffff', P.effect, P.light], speed: [2, 6 + 5 * pow], life: [12, 22], size: [5, 10] });
      fx.burst({ x: ev.x, y: ev.y, count: 2, shape: 'glow', color: P.effect, speed: [0.3, 1], life: [8, 12], size: [16, 26], blend: 'lighter' });
      if (dmg >= 8) fx.ring({ x: ev.x, y: ev.y, r0: 6, r1: 24 + dmg * 2 + pow * 30, color: P.light, life: 12, width: 4 });
      if (pow > 0.6) fx.shake(2 + pow * 4);
    },
    onHurt(fx, ev, info) {
      fx.burst({ x: ev.x, y: ev.y, count: 4, shape: 'dot', colors: [info.palette.main, info.palette.light], speed: [1, 3], life: [12, 20], size: [3, 6] });
    },
    onLand(fx, ev, info) {
      fx.ring({ x: ev.x, y: ev.y - 2, r0: 8, r1: ev.heavy ? 46 : 30, color: info.palette.light, life: 12, width: 3, flat: true, alpha: 0.8 });
      fx.burst({ x: ev.x, y: ev.y - 3, count: ev.heavy ? 6 : 3, shape: 'smoke', color: '#f0e2d8', speed: [0.6, 1.8], angle: 90, spread: 160, life: [14, 22], size: [5, 9] });
    },
    onJump(fx, ev, info) {
      // every midair jump is a little puff of air
      fx.ring({ x: ev.x, y: ev.y - 2, r0: 6, r1: ev.double ? 40 : 28, color: info.palette.light, life: 12, width: 3, flat: true, alpha: 0.8 });
      if (ev.double) fx.burst({ x: ev.x, y: ev.y, count: 4, shape: 'smoke', color: '#ffffff', speed: [0.5, 1.5], angle: 270, spread: 80, life: [12, 20], size: [5, 9], alpha: 0.7 });
    },
    onKO(fx, ev, info) {
      const P = info.palette;
      fx.burst({ x: ev.x, y: ev.y, count: 22, shape: 'star', colors: ['#ffffff', P.main, P.effect], speed: [4, 13], life: [26, 44], size: [6, 12] });
      fx.ring({ x: ev.x, y: ev.y, r0: 20, r1: 130, color: P.effect, life: 18, width: 7 });
      fx.flash(P.light, 0.2, 4);
      fx.sound({ type: 'sine', freq: [1200, 300], dur: 0.6, gain: 0.25, vibrato: 0.05 });
    },
    onRespawn(fx, ev, info) {
      fx.burst({ x: ev.x, y: ev.y - 40, count: 6, shape: noteParticle, colors: [info.palette.note, info.palette.effect], speed: [0.6, 1.8], angle: 90, spread: 140, gravity: -0.02, life: [40, 60], size: [10, 13] });
    },
    onEvent: {
      singStart(fx, ev, info) {
        fx.ring({ x: ev.x, y: ev.y - 31, r0: 20, r1: 80, color: info.palette.song, life: 20, width: 4 });
      },
      note(fx, ev, info) {
        const P = info.palette;
        fx.burst({ x: ev.x, y: ev.y - 60, count: 2, shape: noteParticle, colors: [P.note, P.effect, '#7fd3ff'], speed: [0.8, 2], angle: 90, spread: 140, gravity: -0.02, life: [40, 60], size: [10, 14] });
      },
      restFlash(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 31, count: 6, shape: 'star', colors: ['#ffffff', '#fff6c8'], speed: [1, 3], life: [10, 16], size: [6, 10] }); },
      restFlower(fx, ev) {
        fx.burst({ x: ev.x, y: ev.y - 40, count: 14, shape: flowerParticle, colors: ['#ffb6e1', '#ff7fae', '#ffffff', '#ffe36b'], speed: [2, 8], gravity: 0.1, drag: 0.96, life: [40, 60], size: [12, 18] });
        fx.text({ x: ev.x, y: ev.y - 110, text: 'REST!', color: '#ffffff', outline: '#4a1530', size: 18, life: 40 });
      },
      zzz(fx, ev) { fx.sound({ type: 'sine', freq: [180, 140], dur: 0.5, gain: 0.08 }, { volume: 0.5 }); },
      rollStart(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 4, count: 6, shape: 'smoke', color: '#e8d8c8', speed: [1, 3], angle: 160, spread: 40, life: [14, 24], size: [6, 10] }); },
      rub(fx, ev, info) { fx.burst({ x: ev.x + 30, y: ev.y - 8, count: 3, shape: 'star', colors: ['#ffffff', info.palette.effect], speed: [1, 3], life: [10, 16], size: [4, 7] }); },
      puffUp(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 60, count: 3, shape: noteParticle, colors: [info.palette.note, info.palette.effect], speed: [0.5, 1.5], angle: 90, spread: 90, gravity: -0.02, life: [40, 60], size: [10, 13] }); },
    },
  },

  sounds: {
    jump: { type: 'sine', freq: [520, 900], dur: 0.12, gain: 0.16 },
    land: { type: 'sine', freq: [260, 160], dur: 0.08, gain: 0.12 },
    rollCharge: { type: 'triangle', freq: [180, 420], dur: 0.5, gain: 0.14 },
    rollStart: 'zip',
    sing: { type: 'sine', freq: [784, 988], dur: 1.6, gain: 0.18, vibrato: { rate: 6, depth: 0.04 } },
    note: { type: 'sine', freq: [1046, 1046], dur: 0.25, gain: 0.08, vibrato: 0.03 },
    rest: 'chime',
    restFlower: 'boom',
    rub: 'squeak',
    taunt: { type: 'sine', freq: [660, 990], dur: 0.5, gain: 0.16, vibrato: { rate: 8, depth: 0.05 } },
    puffUp: 'boing',
    pound: 'buzz-thwack',
  },

  // A hand-framed close-up: the face, ears and curl.
  portrait(ctx, size, info) {
    const Pal = info.palette || PALETTE, k = size / 100;
    const P = basePose();
    P.cx = 0; P.cy = 0;
    const fake = { light: info.light || { dir: { x: -0.5, y: -0.85 } }, cache: { tuft: 0.2, earV: 0 }, time: 0 };
    ctx.save();
    ctx.translate(size / 2, size / 2 + 10 * k);
    ctx.scale(k * 1.12, k * 1.12);
    drawBody(ctx, P, Pal, fake, {});
    ctx.restore();
  },
};
