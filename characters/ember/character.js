// ─────────────────────────────────────────────────────────────────────────────
// EMBER — street-fighting prodigy with fists that burn.
//
// A showcase of what the art hooks can do:
//   • head:   custom spiky hair (radial fire gradient, rim light, glowing tips
//             that ignite when she attacks) + the shared drawFace() + a cheek plaster
//   • torso:  sleeveless crimson gi with gold trim, charcoal undershirt, sash belt,
//             scarf collar and a little flame crest
//   • arm/leg: hand-wrapped forearms & shins (clipped stripe pattern), gi pants
//   • hands/feet: wrapped fists and slippers that burst into flame on the limb
//             that leads the current attack (drawn in limb space)
//   • back:   flame aura for smashes / specials / smash charge
//   • front:  move-specific fire FX (pillar, ground flames, nova, dash streak)
//             + rising ember particles
//   • chains: a long two-tail scarf and gold sash tails
//   • projectile: custom fireball with licking flame tail and sparks
//   • pose:   a bouncy fighting-game guard stance instead of the default idle
// ─────────────────────────────────────────────────────────────────────────────
import * as kit from '../../shared/art/kit.js';
import { drawFace } from '../../shared/art/puppet.js';
import { ANIMATIONS } from '../../shared/art/anims.js';

// ── Fire colors ─────────────────────────────────────────────────────────────
// Every art hook draws from C, rebound to the resolved palette (alt palettes for
// duplicate picks) at the start of each hook call.
const BASE = Object.freeze({
  fireDeep: '#b0170e', fireRed: '#e8381a', fireOrange: '#ff7a1a', fireAmber: '#ffae2b', fireYellow: '#ffe27a', fireWhite: '#fff8e2',
  wrap: '#efe2cb', wrapLine: '#bfa784', gold: '#f2b33d',
  hair0: '#6e1410', hair1: '#b8231a', hair2: '#e8481c', hair3: '#ff8a22', hair4: '#ffd65a',
  scarf: '#ff6a3a', scarfDark: '#b8221a', scarfLine: '#7a120e', cuff: '#c42a22', pantsCuff: '#8e1d1c',
  tail1: '#d8321f', tail1b: '#ffa53a', tail2: '#a82218', tail2b: '#f2742a',
});
const C = { ...BASE };
function usePalette(p) { for (const k in BASE) C[k] = (p && p[k]) || BASE[k]; }
function withPalette(fn) {
  const w = function (ctx, ...args) {
    usePalette(args[args.length - 1]?.palette); // info (or the projectile record) is always last
    return fn(ctx, ...args);
  };
  Object.defineProperty(w, 'length', { value: fn.length });
  return w;
}

// ── Moves ───────────────────────────────────────────────────────────────────
// Hitbox x/y were placed on the rig's fist/foot positions at the strike pose.
const moves = {
  jab: {
    name: 'Spark Jab', duration: 15, anim: 'jab', effect: 'fire',
    hitboxes: [{ start: 3, end: 5, x: 34, y: -60, r: 17, damage: 3, angle: 50, knockback: 10, growth: 25 }],
  },
  side: {
    name: 'Flare Roundhouse', duration: 25, anim: 'kick', effect: 'fire',
    hitboxes: [
      { start: 6, end: 9, x: 42, y: -43, r: 20, damage: 8, angle: 38, knockback: 22, growth: 82 },
      { start: 6, end: 9, x: 20, y: -42, r: 15, damage: 8, angle: 38, knockback: 22, growth: 82 },
    ],
  },
  up: {
    name: 'Crescent Kick', duration: 24, effect: 'fire',
    pose: {
      limb: 'frontFoot',
      windup: { lean: 0.15, flU: 0.9, flL: -1.7, blU: -0.15, fU: 0.9, fL: 1.8, bU: -0.6, bL: 1.2, by: 3 },
      strike: { lean: -0.35, head: 0.15, flU: 2.75, flL: -0.05, blU: -0.05, blL: -0.1, fU: -0.6, fL: 0.8, bU: 1.3, bL: 1.0, by: -5 },
    },
    hitboxes: [
      { start: 5, end: 10, x: 16, y: -80, r: 22, damage: 7, angle: 92, knockback: 26, growth: 78 },
      { start: 5, end: 10, x: 16, y: -58, r: 15, damage: 7, angle: 80, knockback: 26, growth: 78 },
    ],
  },
  down: {
    name: 'Cinder Sweep', duration: 22, anim: 'sweep', effect: 'fire',
    hitboxes: [{ start: 6, end: 8, x: 40, y: -10, r: 18, damage: 6, angle: 80, knockback: 30, growth: 42 }],
  },
  sideSmash: {
    name: 'Blaze Fist', duration: 44, anim: 'heavyPunch', effect: 'fire',
    hitboxes: [
      { start: 13, end: 16, x: 52, y: -58, r: 24, damage: 15, angle: 38, knockback: 32, growth: 98 },
      { start: 13, end: 16, x: 80, y: -58, r: 18, damage: 13, angle: 38, knockback: 30, growth: 92 },
    ],
  },
  upSmash: {
    name: 'Volcano', duration: 42, anim: 'upSmash', effect: 'fire',
    hitboxes: [
      { start: 11, end: 16, x: 6, y: -112, r: 28, damage: 14, angle: 90, knockback: 32, growth: 96 },
      { start: 11, end: 16, x: 8, y: -148, r: 20, damage: 11, angle: 88, knockback: 30, growth: 90 },
    ],
  },
  downSmash: {
    name: 'Ring of Fire', duration: 42, anim: 'splits', effect: 'fire',
    hitboxes: [
      { start: 10, end: 13, x: 44, y: -8, r: 22, damage: 13, angle: 28, knockback: 30, growth: 92 },
      { start: 10, end: 13, x: -44, y: -8, r: 22, damage: 13, angle: 152, knockback: 30, growth: 92 },
    ],
  },
  nair: {
    name: 'Cinder Wheel', duration: 27, anim: 'spin', effect: 'fire', landingLag: 7,
    hitboxes: [{ start: 5, end: 12, x: 0, y: -44, r: 36, damage: 7, angle: 45, knockback: 20, growth: 76 }],
  },
  fair: {
    name: 'Comet Kick', duration: 30, anim: 'airKick', effect: 'fire', landingLag: 9,
    hitboxes: [
      { start: 6, end: 9, x: 38, y: -46, r: 20, damage: 10, angle: 40, knockback: 26, growth: 86 },
      { start: 6, end: 9, x: 18, y: -44, r: 15, damage: 10, angle: 40, knockback: 26, growth: 86 },
    ],
  },
  bair: {
    name: 'Backdraft', duration: 32, anim: 'backKick', effect: 'fire', landingLag: 10,
    hitboxes: [{ start: 7, end: 10, x: -40, y: -46, r: 21, damage: 12, angle: 145, knockback: 28, growth: 92 }],
  },
  uair: {
    name: 'Flame Arc', duration: 26, anim: 'flipKick', effect: 'fire', landingLag: 7,
    hitboxes: [{ start: 5, end: 10, x: 6, y: -92, r: 26, damage: 7, angle: 86, knockback: 24, growth: 82 }],
  },
  dair: {
    name: 'Meteor Heel', duration: 38, anim: 'stomp', effect: 'fire', landingLag: 15,
    hitboxes: [{ start: 12, end: 15, x: 4, y: 4, r: 22, damage: 12, angle: 275, knockback: 22, growth: 78 }],
  },
  neutralSpecial: {
    name: 'Blaze Shot', duration: 34, anim: 'cast', effect: 'fire',
    projectiles: [{ start: 12, x: 40, y: -58, vx: 10, vy: 0, life: 56, r: 13, damage: 6, angle: 35, knockback: 18, growth: 45, style: 'fireball' }],
  },
  sideSpecial: {
    name: 'Blazing Rush', duration: 38, anim: 'dash', effect: 'fire',
    velocity: [{ start: 6, end: 16, vx: 12, vy: 0 }],
    hitboxes: [{ start: 7, end: 16, x: 44, y: -57, r: 24, damage: 9, angle: 35, knockback: 30, growth: 70 }],
  },
  upSpecial: {
    name: 'Phoenix Rise', duration: 34, effect: 'fire',
    pose: {
      limb: 'frontHand',
      windup: { lean: 0.35, fU: -0.2, fL: 2.3, bU: 0.4, bL: 1.6, flU: 0.9, flL: -1.8, blU: 0.4, blL: -1.6, by: 12, sy: 0.88, sx: 1.08 },
      strike: { lean: -0.1, head: -0.15, fU: 2.95, fL: 0.08, bU: -0.4, bL: 1.6, flU: 0.75, flL: -1.5, blU: -0.15, blL: -0.25, sy: 1.1, sx: 0.93 },
    },
    velocity: [{ start: 4, end: 15, vx: 2.2, vy: -12 }],
    hitboxes: [
      { start: 4, end: 7, x: 16, y: -72, r: 22, damage: 5, angle: 80, knockback: 30, growth: 20 },
      { start: 8, end: 15, x: 8, y: -100, r: 24, damage: 7, angle: 85, knockback: 30, growth: 72 },
    ],
  },
  downSpecial: {
    name: 'Ignition', duration: 38, anim: 'guard', effect: 'fire', intangible: [5, 8],
    hitboxes: [{ start: 8, end: 12, x: 0, y: -42, r: 40, damage: 10, angle: 62, knockback: 34, growth: 70 }],
  },
};

// Moves where more than the "lead" limb catches fire.
const FLAMING = {
  upSmash: ['frontHand', 'backHand'],
  downSmash: ['frontFoot', 'backFoot'],
  nair: ['frontHand', 'backHand', 'frontFoot', 'backFoot'],
  downSpecial: ['frontHand', 'backHand'],
  upSpecial: ['frontHand'],
};

// ── Small helpers ───────────────────────────────────────────────────────────
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const backC = (c, back) => (back ? kit.shade(c, -0.24) : c);

/** How "on fire" a limb is right now (0..1). */
function heat(info, limbName) {
  const v = info.view;
  if (info.state !== 'attack' || !v.move) return 0;
  const m = v.move;
  const lead = m.pose?.limb || ANIMATIONS[m.anim]?.limb || 'frontHand';
  const fr = v.moveFrame || 0;
  const st = Math.max(1, m.startup);
  let end = st;
  for (const h of m.hitboxes) end = Math.max(end, h.end);
  for (const p of m.projectiles) end = Math.max(end, p.start + 2);
  let k;
  if (fr < st) k = 0.3 + 0.7 * (fr / st);
  else if (fr <= end) k = 1;
  else k = Math.max(0, 1 - (fr - end) / 12);
  const lit = lead === limbName || lead === 'body' || FLAMING[m.slot]?.includes(limbName);
  return lit ? k : k * 0.25;
}

/** Phase of the current move: 'windup' | 'active' | 'end', plus 0..1 progress within it. */
function phase(info) {
  const v = info.view, m = v.move;
  if (info.state !== 'attack' || !m) return null;
  const fr = v.moveFrame || 0;
  let start = Infinity, end = 0;
  for (const h of m.hitboxes) { start = Math.min(start, h.start); end = Math.max(end, h.end); }
  if (!Number.isFinite(start)) { start = m.startup; end = m.startup + 2; }
  if (fr < start) return { p: 'windup', k: fr / start, fr, start, end };
  if (fr <= end) return { p: 'active', k: (fr - start) / Math.max(1, end - start), fr, start, end };
  return { p: 'end', k: (fr - end) / Math.max(1, m.duration - end), fr, start, end };
}

// ── Fire drawing ────────────────────────────────────────────────────────────
/** A single flame tongue, base at the origin, tip at (wob, -len). Builds a path. */
function tonguePath(ctx, len, wid, wob) {
  ctx.beginPath();
  ctx.moveTo(-wid, 0);
  ctx.bezierCurveTo(-wid, wid * 1.2, wid, wid * 1.2, wid, 0);
  ctx.bezierCurveTo(wid * 1.05, -len * 0.38, wob + wid * 0.3, -len * 0.68, wob, -len);
  ctx.bezierCurveTo(wob - wid * 0.45, -len * 0.6, -wid * 1.1, -len * 0.36, -wid, 0);
  ctx.closePath();
}

/** Layered stylised flame pointing "up" (-y) from the origin. */
function flame(ctx, len, wid, t, seed = 0, alpha = 1) {
  if (len < 1 || alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, alpha);
  const wob = Math.sin(t * 0.45 + seed) * wid * 0.6 + Math.sin(t * 0.91 + seed * 2.3) * wid * 0.25;
  const fl = 1 + Math.sin(t * 0.73 + seed * 1.7) * 0.1;
  // side licks
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * wid * 0.55, wid * 0.15);
    ctx.rotate(s * (0.38 + Math.sin(t * 0.5 + seed + s) * 0.08));
    tonguePath(ctx, len * 0.55 * (1 + Math.sin(t * 0.62 + seed * 3 + s) * 0.18), wid * 0.5, -wob * 0.5);
    ctx.fillStyle = C.fireRed;
    ctx.fill();
    ctx.restore();
  }
  tonguePath(ctx, len * fl, wid, wob);
  let g = ctx.createLinearGradient(0, wid, 0, -len);
  g.addColorStop(0, C.fireOrange); g.addColorStop(0.55, C.fireRed); g.addColorStop(1, C.fireDeep);
  ctx.fillStyle = g; ctx.fill();
  tonguePath(ctx, len * 0.7 * fl, wid * 0.68, wob * 0.75);
  g = ctx.createLinearGradient(0, wid, 0, -len * 0.7);
  g.addColorStop(0, C.fireYellow); g.addColorStop(0.5, C.fireAmber); g.addColorStop(1, C.fireOrange);
  ctx.fillStyle = g; ctx.fill();
  tonguePath(ctx, len * 0.42 * fl, wid * 0.4, wob * 0.45);
  ctx.fillStyle = C.fireWhite; ctx.fill();
  ctx.restore();
}

/** Flame at (x,y) pointing along unit-ish direction (dx,dy). */
function flameDir(ctx, x, y, dx, dy, len, wid, t, seed, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(dx, -dy));
  flame(ctx, len, wid, t, seed, alpha);
  ctx.restore();
}

function additiveGlow(ctx, x, y, r, color, a) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, x, y, r, color, a);
  ctx.restore();
}

/** Rising ember sparks (deterministic from time, no state needed). */
function embers(ctx, cx, cy, spread, rise, count, t, seed, size, alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const life = 22 + ((i * 7) % 17);
    const tt = t + i * 13.7 + seed * 31;
    const cyc = Math.floor(tt / life);
    const ph = (tt % life) / life;
    const rx = hash(i * 3.1 + cyc * 17.3 + seed);
    const x = cx + (rx - 0.5) * spread + Math.sin(ph * 6 + i) * spread * 0.12;
    const y = cy - ph * rise * (0.6 + hash(i + cyc) * 0.6);
    const s = size * (1 - ph) * (0.6 + rx * 0.6);
    if (s <= 0.2) continue;
    ctx.globalAlpha = alpha * (1 - ph * ph);
    ctx.fillStyle = ph < 0.35 ? C.fireYellow : ph < 0.7 ? C.fireAmber : C.fireRed;
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.6); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s * 1.2); ctx.lineTo(x - s, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Diagonal wrap stripes clipped to the current path. */
function wrapStripes(ctx, a, b, spacing, color, lw) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath();
  for (let s = -spacing; s < len + spacing; s += spacing) {
    const px = a.x + ux * s, py = a.y + uy * s;
    ctx.moveTo(px - nx * 12 - ux * 3, py - ny * 12 - uy * 3);
    ctx.lineTo(px + nx * 12 + ux * 3, py + ny * 12 + uy * 3);
  }
  ctx.stroke();
}

// ── Body parts ──────────────────────────────────────────────────────────────
const HAIR_BACK = [
  [0.7, -0.6], [0.58, -1.42], [0.16, -1.0], [-0.32, -1.78], [-0.42, -1.0], [-1.28, -1.5], [-0.96, -0.62],
  [-1.78, -0.6], [-1.06, -0.12], [-1.58, 0.36], [-0.9, 0.34], [-0.72, 0.62], [-0.36, 0.3], [0.2, -0.3],
];
const HAIR_FRONT = [
  [-1.02, -0.08], [-0.97, -0.7], [-0.48, -1.1], [0.2, -1.16], [0.76, -0.9], [1.12, -0.56], [0.8, -0.5],
  [0.94, -0.16], [0.6, -0.4], [0.38, -0.22], [0.26, -0.45], [-0.12, -0.36], [-0.3, -0.5], [-0.5, 0.05],
  [-0.62, 0.32], [-0.82, 0.1],
];
const HAIR_TIPS = [[0.58, -1.42], [-0.32, -1.78], [-1.28, -1.5], [-1.78, -0.6], [-1.58, 0.36]];

function hairFill(ctx, r) {
  const g = ctx.createRadialGradient(-r * 0.2, r * 0.05, r * 0.2, -r * 0.2, r * 0.05, r * 1.75);
  g.addColorStop(0, C.hair0);
  g.addColorStop(0.42, C.hair1);
  g.addColorStop(0.66, C.hair2);
  g.addColorStop(0.84, C.hair3);
  g.addColorStop(1, C.hair4);
  return g;
}

function drawHead(ctx, info) {
  const { rig, palette, time } = info;
  const r = rig.headR;
  const o = palette.outline;
  const P = (pts) => pts.map(([x, y]) => [x * r, y * r]);
  const hot = Math.max(heat(info, 'frontHand'), heat(info, 'frontFoot'), heat(info, 'backFoot'));

  // Hair tip glow behind everything
  for (let i = 0; i < HAIR_TIPS.length; i++) {
    const [x, y] = HAIR_TIPS[i];
    const fl = 0.5 + 0.5 * Math.sin(time * 0.2 + i * 1.9);
    additiveGlow(ctx, x * r, y * r, r * (0.3 + 0.12 * fl + hot * 0.4), C.fireOrange, 0.14 + 0.08 * fl + hot * 0.3);
  }
  // Hair tips ignite when attacking
  if (hot > 0.05) {
    for (let i = 0; i < 3; i++) {
      const [x, y] = HAIR_TIPS[i];
      const d = Math.hypot(x, y);
      flameDir(ctx, x * r * 0.95, y * r * 0.95, x / d - 0.3, y / d - 0.7, r * 0.8 * hot, r * 0.17, time, i * 2.7, hot);
    }
  }

  // Back hair
  kit.polygonPath(ctx, P(HAIR_BACK));
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = o; ctx.stroke();
  ctx.fillStyle = hairFill(ctx, r); ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(60,8,8,0.35)';
  kit.polygonPath(ctx, P([[-0.2, -0.2], [-1.1, 0.0], [-1.5, 0.7], [-0.4, 0.4]])); ctx.fill();
  ctx.restore();

  // Skull, ear
  kit.circle(ctx, 0, 0, r, palette.skin, { outline: o, gloss: 0.16 });
  // jaw shade
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = 'rgba(160,60,40,0.1)';
  ctx.beginPath(); ctx.ellipse(-r * 0.25, r * 0.75, r * 1.0, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  kit.circle(ctx, -r * 0.14, r * 0.14, r * 0.2, kit.shade(palette.skin, -0.1), { outline: o, lineWidth: 2 });
  // small earring stud
  kit.circle(ctx, -r * 0.16, r * 0.36, r * 0.07, C.gold, { outline: o, lineWidth: 1.2, gloss: 0.6 });

  drawFace(ctx, info, r, { eyeColor: info.palette.eyes, browColor: '#6e130f', blush: false, eyeHeight: 0.23 });
  kit.glow(ctx, r * 0.6, r * 0.28, r * 0.2, '#ff5a4a', 0.22);

  // Front hair / bangs
  kit.polygonPath(ctx, P(HAIR_FRONT));
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = o; ctx.stroke();
  ctx.fillStyle = hairFill(ctx, r); ctx.fill();
  ctx.save(); ctx.clip();
  // strand shading
  ctx.strokeStyle = 'rgba(90,10,10,0.45)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, -r * 0.4); ctx.quadraticCurveTo(-r * 0.2, -r * 0.85, r * 0.5, -r * 0.8);
  ctx.moveTo(-r * 0.2, -r * 0.5); ctx.quadraticCurveTo(r * 0.3, -r * 0.65, r * 0.8, -r * 0.6);
  ctx.stroke();
  ctx.restore();
  // rim light along the crown
  kit.rimLight(ctx, P([[-0.9, -0.62], [-0.48, -1.0], [0.16, -1.06], [0.72, -0.84]]), '#ffe9a8', 2.2, 0.75);
  kit.rimLight(ctx, P([[-0.36, -1.58], [-0.4, -1.12]]), '#fff3c8', 1.6, 0.55);
  kit.rimLight(ctx, P([[0.52, -1.28], [0.3, -1.04]]), '#fff3c8', 1.6, 0.55);

  // tiny bright cores on tips
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < HAIR_TIPS.length; i++) {
    const [x, y] = HAIR_TIPS[i];
    const fl = 0.5 + 0.5 * Math.sin(time * 0.27 + i * 2.3);
    kit.glow(ctx, x * r * 0.97, y * r * 0.97, r * 0.18, C.fireYellow, 0.5 + 0.4 * fl);
  }
  ctx.restore();
  // drifting embers off the hair
  embers(ctx, -r * 0.6, -r * 1.2, r * 1.6, r * 2.2, 4 + Math.round(hot * 6), time, 3, r * 0.09, 0.8);
}

function drawTorso(ctx, info) {
  const { rig, u, palette, time } = info;
  const b = rig.build;
  const o = palette.outline;
  ctx.save();
  ctx.translate(rig.hip.x, rig.hip.y);
  ctx.rotate(rig.lean);
  const L = rig.torsoLen;
  const sw = 13 * u * b.shoulders, ww = 9.5 * u * b.hips, hw = 10.5 * u * b.hips;
  const body = [[-hw, 2 * u], [-ww, -L * 0.45], [-sw, -L + 2 * u], [0, -L - 3 * u], [sw, -L + 2 * u], [ww * 1.05, -L * 0.45], [hw, 2 * u], [0, 5 * u]];
  const bodyPath = () => kit.blobPath(ctx, body, 0.45);

  // Gi jacket
  bodyPath();
  kit.fillShaded(ctx, palette.primary, { outline: o, y: -L / 2, r: L * 0.7, gloss: 0.1, dark: -0.38 });
  ctx.save();
  bodyPath(); ctx.clip();
  // V-neck opening showing the charcoal undershirt
  const V = [[-1 * u, -L - 4 * u], [9 * u, -L - 3 * u], [6.5 * u, -L * 0.42], [3.5 * u, -L * 0.42]];
  kit.polygonPath(ctx, V);
  const ug = ctx.createLinearGradient(0, -L, 0, -L * 0.4);
  ug.addColorStop(0, '#3a323e'); ug.addColorStop(1, '#1e1a22');
  ctx.fillStyle = ug; ctx.fill();
  // lapel trims
  ctx.strokeStyle = C.gold; ctx.lineWidth = 2.6 * u; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-0.5 * u, -L - 3 * u); ctx.lineTo(4 * u, -L * 0.42); ctx.stroke();
  ctx.strokeStyle = kit.shade(C.gold, -0.3); ctx.lineWidth = 2.2 * u;
  ctx.beginPath(); ctx.moveTo(9.5 * u, -L - 2 * u); ctx.lineTo(6.6 * u, -L * 0.42); ctx.stroke();
  // fabric folds
  ctx.strokeStyle = kit.rgba(kit.shade(palette.primary, -0.5), 0.55); ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-sw * 0.7, -L * 0.82); ctx.quadraticCurveTo(-ww * 0.6, -L * 0.55, -ww * 0.3, -L * 0.25);
  ctx.moveTo(-2 * u, -L * 0.62); ctx.quadraticCurveTo(-1 * u, -L * 0.4, -3 * u, -L * 0.18);
  ctx.stroke();
  // flame crest on the chest
  ctx.save();
  ctx.translate(-4.2 * u, -L * 0.62);
  ctx.scale(0.9, 0.9);
  ctx.beginPath();
  ctx.moveTo(0, 3 * u);
  ctx.bezierCurveTo(-3 * u, 2.6 * u, -3.2 * u, -0.8 * u, -1 * u, -3.6 * u);
  ctx.bezierCurveTo(-0.6 * u, -1.6 * u, 0.6 * u, -1.4 * u, 0.4 * u, -2.6 * u);
  ctx.bezierCurveTo(2.6 * u, -0.8 * u, 3 * u, 2.4 * u, 0, 3 * u);
  ctx.closePath();
  ctx.fillStyle = C.gold; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = kit.shade(C.gold, -0.45); ctx.stroke();
  ctx.restore();
  // Sash belt
  const by = -3.5 * u;
  const bg = ctx.createLinearGradient(0, by - 3 * u, 0, by + 4 * u);
  bg.addColorStop(0, '#3c3440'); bg.addColorStop(1, '#17131a');
  ctx.fillStyle = bg;
  ctx.fillRect(-hw * 1.5, by - 3 * u, hw * 3, 6.5 * u);
  ctx.strokeStyle = C.gold; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-hw * 1.5, by - 2 * u); ctx.lineTo(hw * 1.5, by - 2 * u); ctx.stroke();
  // jacket hem below belt
  ctx.fillStyle = kit.shade(palette.primary, -0.3);
  ctx.fillRect(-hw * 1.5, by + 3.5 * u, hw * 3, 6 * u);
  ctx.restore();
  // belt knot
  kit.roundRectPath(ctx, 4.5 * u, by - 3.2 * u, 5 * u, 6.8 * u, 1.6 * u);
  kit.fillShaded(ctx, '#2c2630', { outline: o, lineWidth: 2, r: 5 * u });
  kit.rimLight(ctx, [[5.6 * u, by - 2 * u], [8.4 * u, by - 2 * u]], C.gold, 1.4, 0.9);
  // knot tails
  for (const [dx, rot, len] of [[6 * u, 0.25, 9 * u], [8.4 * u, -0.15, 7.5 * u]]) {
    ctx.save(); ctx.translate(dx, by + 3 * u); ctx.rotate(rot + Math.sin(time * 0.1 + dx) * 0.05);
    kit.roundRectPath(ctx, -1.5 * u, 0, 3 * u, len, 1.2 * u);
    kit.fillShaded(ctx, '#2c2630', { outline: o, lineWidth: 1.8, r: len });
    ctx.fillStyle = C.gold; ctx.fillRect(-1.2 * u, len - 2 * u, 2.4 * u, 1 * u);
    ctx.restore();
  }
  // scarf collar (where the long scarf tails attach)
  ctx.save();
  ctx.translate(1 * u, -L - 1.5 * u);
  ctx.rotate(-0.12);
  kit.blobPath(ctx, [[-7 * u, -1 * u], [-2 * u, -4 * u], [6 * u, -3.4 * u], [8.5 * u, 0.5 * u], [4 * u, 3.6 * u], [-4 * u, 3 * u]], 0.6);
  const sg = ctx.createLinearGradient(0, -4 * u, 0, 4 * u);
  sg.addColorStop(0, C.scarf); sg.addColorStop(1, C.scarfDark);
  ctx.lineWidth = 2.6; ctx.strokeStyle = o; ctx.stroke();
  ctx.fillStyle = sg; ctx.fill();
  ctx.strokeStyle = kit.rgba(C.scarfLine, 0.7); ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(-4 * u, 0); ctx.quadraticCurveTo(1 * u, 1.6 * u, 6 * u, 0); ctx.stroke();
  kit.rimLight(ctx, [[-3 * u, -2.8 * u], [5 * u, -2.6 * u]], '#ffd0a0', 1.4, 0.7);
  ctx.restore();
  ctx.restore();
}

function drawFist(ctx, info, back) {
  const { u, palette, time, rig } = info;
  const o = palette.outline;
  const limbName = back ? 'backHand' : 'frontHand';
  const k = heat(info, limbName);
  const angle = (back ? rig.armB : rig.armF).angle;
  // world-up expressed in hand space, blended with "trail back along the forearm"
  let dx = Math.sin(angle) * 0.8, dy = -Math.cos(angle) * 0.8 - 1;
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const seed = back ? 5.3 : 1.1;
  if (k > 0.02) {
    additiveGlow(ctx, 0, 2 * u, 16 * u * (0.5 + k), C.fireOrange, 0.5 * k);
    flameDir(ctx, 0, 2.5 * u, dx, dy, 22 * u * k, 6.4 * u * Math.sqrt(k), time, seed, Math.min(1, k * 1.4));
  }
  // fist: wrapped knuckles
  const w = 5.4 * u, top = -3.6 * u, bot = 6.4 * u;
  kit.roundRectPath(ctx, -w, top, w * 2, bot - top, 3.6 * u);
  kit.fillShaded(ctx, backC(C.wrap, back), { outline: o, lineWidth: 2.4, y: 1.4 * u, r: 7 * u, gloss: 0.2 });
  ctx.save();
  kit.roundRectPath(ctx, -w, top, w * 2, bot - top, 3.6 * u); ctx.clip();
  wrapStripes(ctx, { x: 0, y: top }, { x: 0, y: bot }, 2.6 * u, backC(C.wrapLine, back), 1.1);
  // crimson knuckle guard
  ctx.fillStyle = backC(C.cuff, back);
  ctx.fillRect(-w, 3.3 * u, w * 2, 3.2 * u);
  ctx.strokeStyle = o; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-w, 3.3 * u); ctx.lineTo(w, 3.3 * u); ctx.stroke();
  // finger creases
  ctx.strokeStyle = kit.rgba(o, 0.6);
  ctx.beginPath();
  for (const fx of [-2.7, 0, 2.7]) { ctx.moveTo(fx * u, 3.6 * u); ctx.lineTo(fx * u, 6.4 * u); }
  ctx.stroke();
  ctx.restore();
  // thumb
  kit.capsulePath(ctx, w * 0.95, -0.4 * u, w * 0.7, 3 * u, 1.9 * u, 1.7 * u);
  kit.fillShaded(ctx, backC(palette.skin, back), { outline: o, lineWidth: 1.8, r: 3 * u });
  if (k > 0.02) {
    // inner heat over the knuckles
    additiveGlow(ctx, 0, 5 * u, 8 * u, C.fireYellow, 0.45 * k);
  } else if (!back && (info.state === 'idle' || info.state === 'run')) {
    additiveGlow(ctx, 0, 4.5 * u, 6 * u, C.fireOrange, 0.18 + 0.08 * Math.sin(time * 0.15));
  }
}

function drawArm(ctx, a, info) {
  const { u, palette } = info;
  const back = info.back;
  const o = palette.outline;
  const skin = backC(palette.skin, back);
  // upper arm (bare) + gi sleeve cap
  kit.limb(ctx, a.shoulder, a.elbow, 5.2 * u, 4.4 * u, skin, { outline: o });
  const sEnd = lerpP(a.shoulder, a.elbow, 0.5);
  kit.limb(ctx, a.shoulder, sEnd, 6.6 * u, 5.8 * u, backC(C.gold, back), { outline: o, lineWidth: 2.4 });
  kit.limb(ctx, a.shoulder, lerpP(a.shoulder, a.elbow, 0.4), 6.6 * u, 5.8 * u, backC(palette.primary, back), { outline: null, lineWidth: 0 });
  // forearm with hand-wraps
  kit.limb(ctx, a.elbow, a.hand, 4.4 * u, 3.9 * u, skin, { outline: o });
  const w0 = lerpP(a.elbow, a.hand, 0.3);
  kit.capsulePath(ctx, w0.x, w0.y, a.hand.x, a.hand.y, 4.6 * u, 4.2 * u);
  kit.fillShaded(ctx, backC(C.wrap, back), { outline: o, lineWidth: 2.2, x: (w0.x + a.hand.x) / 2, y: (w0.y + a.hand.y) / 2, r: 8 * u });
  ctx.save();
  kit.capsulePath(ctx, w0.x, w0.y, a.hand.x, a.hand.y, 4.6 * u, 4.2 * u); ctx.clip();
  wrapStripes(ctx, w0, a.hand, 2.4 * u, backC(C.wrapLine, back), 1.1);
  ctx.restore();
  ctx.save();
  ctx.translate(a.hand.x, a.hand.y);
  ctx.rotate(-a.angle);
  drawFist(ctx, info, back);
  ctx.restore();
}

function drawFoot(ctx, info, back) {
  const { u, palette, time, rig } = info;
  const o = palette.outline;
  const k = heat(info, back ? 'backFoot' : 'frontFoot');
  const angle = (back ? rig.legB : rig.legF).angle;
  if (k > 0.02) {
    // mostly world-up (expressed in foot space), trailing a little back up the shin
    let dx = Math.sin(angle), dy = -Math.cos(angle) - 0.45;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    additiveGlow(ctx, 5 * u, 0, 18 * u * (0.5 + k), C.fireOrange, 0.5 * k);
    flameDir(ctx, 6 * u, 0, dx, dy, 28 * u * k, 7.5 * u * Math.sqrt(k), time, back ? 7.7 : 3.3, Math.min(1, k * 1.4));
  }
  // kung-fu slipper: charcoal upper, wrap strap, gold sole line
  ctx.beginPath();
  ctx.moveTo(-5 * u, -6.5 * u);
  ctx.lineTo(4.5 * u, -6 * u);
  ctx.quadraticCurveTo(12.5 * u, -2.5 * u, 12.8 * u, 2.4 * u);
  ctx.quadraticCurveTo(12.6 * u, 4.2 * u, 10.5 * u, 4.2 * u);
  ctx.lineTo(-5.6 * u, 4.4 * u);
  ctx.quadraticCurveTo(-6.6 * u, 0, -5 * u, -6.5 * u);
  ctx.closePath();
  kit.fillShaded(ctx, backC('#2a2430', back), { outline: o, r: 9 * u, gloss: 0.15 });
  ctx.fillStyle = backC(C.gold, back);
  ctx.fillRect(-5.4 * u, 2.4 * u, 17.4 * u, 1.2 * u);
  kit.roundRectPath(ctx, 2 * u, -5.5 * u, 2.6 * u, 8 * u, 1 * u);
  ctx.fillStyle = backC(C.wrap, back); ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = o; ctx.stroke();
  if (k > 0.02) additiveGlow(ctx, 6 * u, 0, 9 * u, C.fireYellow, 0.4 * k);
}

function drawLeg(ctx, l, info) {
  const { u, palette } = info;
  const back = info.back;
  const o = palette.outline;
  const pants = backC(palette.secondary, back);
  // ankle wraps (under the pant cuff)
  const w0 = lerpP(l.knee, l.foot, 0.5);
  kit.capsulePath(ctx, w0.x, w0.y, l.foot.x, l.foot.y, 4.8 * u, 4.3 * u);
  kit.fillShaded(ctx, backC(C.wrap, back), { outline: o, lineWidth: 2.2, x: (w0.x + l.foot.x) / 2, y: (w0.y + l.foot.y) / 2, r: 8 * u });
  ctx.save();
  kit.capsulePath(ctx, w0.x, w0.y, l.foot.x, l.foot.y, 4.8 * u, 4.3 * u); ctx.clip();
  wrapStripes(ctx, w0, l.foot, 2.4 * u, backC(C.wrapLine, back), 1.1);
  ctx.restore();
  // baggy gi pants
  kit.limb(ctx, l.hip, l.knee, 7.2 * u, 6 * u, pants, { outline: o, dark: -0.4 });
  const cuff = lerpP(l.knee, l.foot, 0.62);
  kit.limb(ctx, l.knee, cuff, 6 * u, 5.8 * u, pants, { outline: o, dark: -0.4 });
  // cuff band
  const c2 = lerpP(l.knee, l.foot, 0.55);
  kit.limb(ctx, c2, cuff, 6 * u, 5.9 * u, backC(C.pantsCuff, back), { outline: o, lineWidth: 2 });
  // knee crease highlight
  kit.rimLight(ctx, [[l.hip.x + 3 * u, l.hip.y + 2 * u], [l.knee.x + 3 * u, l.knee.y - 2 * u]], '#ffffff', 1.4, back ? 0.08 : 0.18);
  ctx.save();
  ctx.translate(l.foot.x, l.foot.y);
  ctx.rotate(-l.angle);
  drawFoot(ctx, info, back);
  ctx.restore();
}

// The scarf itself is an art.chains ribbon; here we read the simulated chain
// points back out of info.cache and make the tips smoulder like embers.
function drawScarfTips(ctx, info) {
  const st = info.cache.chains;
  if (!st) return;
  const { view, rig, pose, time, u } = info;
  const facing = view.facing || 1;
  ctx.save();
  // undo the body's spin/squash so we can draw in the chain's (unrotated) space
  const cx = rig.hip.x, cy = rig.hip.y - rig.torsoLen * 0.3;
  if (pose.spin) { ctx.translate(cx, cy); ctx.rotate(-pose.spin); ctx.translate(-cx, -cy); }
  ctx.scale(1 / pose.sx, 1 / pose.sy);
  const hot = info.state === 'attack' ? 1 : 0.55;
  for (let ci = 0; ci < 2; ci++) {
    const c = st[ci];
    if (!c) continue;
    const n = c.pts.length - 1;
    const a = c.pts[n - 1], b = c.pts[n];
    const bx = (b.x - view.x) * facing, by = b.y - view.y;
    let dx = (b.x - a.x) * facing, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    dx = dx / d - 0.2; dy = dy / d - 1.2;
    additiveGlow(ctx, bx, by, 9 * u, C.fireOrange, 0.45 * hot);
    flameDir(ctx, bx, by, dx, dy, (9 + ci * -2) * u * hot + 4 * u, 2.6 * u, time, ci * 4.1 + 9, 0.95);
    embers(ctx, bx, by, 8 * u, 26 * u, 3, time, 11 + ci, 1.6 * u, 0.9 * hot);
  }
  ctx.restore();
}

// Big translucent flame aura behind the body (smashes, specials, smash charge).
function drawBack(ctx, info) {
  const { rig, u, time, view } = info;
  drawScarfTips(ctx, info);
  const ph = phase(info);
  const m = view.move;
  let k = 0;
  if (view.charging) k = 0.85 + 0.15 * Math.sin(time * 0.5);
  else if (ph && m && (m.category === 'smash' || m.category === 'special' || m.category === 'recovery')) {
    k = ph.p === 'windup' ? ph.k * 0.8 : ph.p === 'active' ? 1 : Math.max(0, 1 - ph.k * 1.6);
  }
  if (k <= 0.02) return;
  const cx = rig.hip.x, cy = rig.hip.y - rig.torsoLen * 0.4;
  if (m?.slot === 'upSpecial' && ph && ph.p !== 'windup') {
    // Phoenix wings: two big flames sweeping back/down from the shoulders + an exhaust trail
    const sx = rig.chest.x, sy = rig.chest.y;
    ctx.save();
    ctx.globalAlpha = 0.9 * k;
    flameDir(ctx, sx - 4 * u, sy, -0.9, 0.55, 58 * u * k, 12 * u, time, 1.3, 1);
    flameDir(ctx, sx + 4 * u, sy, 0.75, 0.75, 46 * u * k, 10 * u, time, 2.9, 1);
    flameDir(ctx, rig.hip.x, rig.hip.y, -0.1, 1, 48 * u * k, 11 * u, time, 4.4, 0.8);
    ctx.restore();
  }
  additiveGlow(ctx, cx, cy, 70 * u * k, C.fireOrange, 0.45 * k);
  ctx.save();
  ctx.globalAlpha = 0.55 * k;
  for (let i = 0; i < 5; i++) {
    const x = cx + (i - 2) * 7 * u;
    const lift = Math.abs(i - 2) * 6 * u;
    ctx.save();
    ctx.translate(x, cy + 22 * u + lift * 0.5);
    ctx.rotate((i - 2) * 0.18);
    flame(ctx, (62 - Math.abs(i - 2) * 12) * u * (0.7 + 0.3 * k), 9 * u, time, i * 1.9, 1);
    ctx.restore();
  }
  ctx.restore();
}

// Move-specific fire FX on top of the body.
function drawFront(ctx, info) {
  const { rig, u, time, view } = info;
  const ph = phase(info);
  if (!ph) return;
  const slot = view.move.slot;
  const active = ph.p === 'active';
  const fade = ph.p === 'active' ? 1 : ph.p === 'end' ? Math.max(0, 1 - ph.k * 2.2) : 0;
  const hand = rig.armF.hand, foot = rig.legF.foot;

  if (slot === 'upSmash' && fade > 0) {
    const x = (rig.armF.hand.x + rig.armB.hand.x) / 2, y = Math.min(rig.armF.hand.y, rig.armB.hand.y);
    additiveGlow(ctx, x, y - 30, 60, C.fireOrange, 0.55 * fade);
    ctx.save(); ctx.translate(x, y + 4);
    flame(ctx, 74 * fade, 17, time, 0.4, fade);
    ctx.restore();
  }
  if (slot === 'downSmash' && fade > 0) {
    for (const s of [1, -1]) {
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.translate(s * (30 + i * 13), 2);
        flame(ctx, (40 - i * 8) * fade, 9 - i, time, i * 2 + s, fade);
        ctx.restore();
      }
      additiveGlow(ctx, s * 44, -10, 40, C.fireOrange, 0.4 * fade);
    }
  }
  if (slot === 'downSpecial' && fade > 0) {
    const cx = rig.hip.x, cy = rig.hip.y - rig.torsoLen * 0.3;
    const R = 30 + (active ? ph.k : 1) * 12;
    additiveGlow(ctx, cx, cy, 60, C.fireOrange, 0.6 * fade);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + time * 0.05;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.rotate(a + Math.PI / 2);
      flame(ctx, 20 * fade, 6.5, time, i * 1.3, fade * 0.9);
      ctx.restore();
    }
  }
  if (slot === 'sideSmash' && fade > 0) {
    additiveGlow(ctx, hand.x + 18, hand.y, 44, C.fireOrange, 0.6 * fade);
    flameDir(ctx, hand.x + 4, hand.y, 1, -0.08, 46 * fade, 14, time, 2.2, fade);
  }
  if (slot === 'sideSpecial' && (active || ph.p === 'end') && fade > 0) {
    // afterburn streak behind the dash
    const cy = rig.hip.y - rig.torsoLen * 0.4;
    ctx.save(); ctx.globalAlpha = 0.85 * fade;
    for (let i = 0; i < 3; i++) flameDir(ctx, rig.hip.x - 6, cy + (i - 1) * 14, -1, (i - 1) * 0.15, 56 - Math.abs(i - 1) * 16, 11, time, i * 2.1, 1);
    ctx.restore();
  }
  if (slot === 'upSpecial' && (active || ph.p === 'end') && fade > 0) {
    additiveGlow(ctx, hand.x, hand.y, 40, C.fireYellow, 0.5 * fade);
  }
  // rising embers from whatever limb leads
  const lead = view.move.pose?.limb || ANIMATIONS[view.move.anim]?.limb || 'frontHand';
  const src = lead === 'frontFoot' ? foot : lead === 'backFoot' ? rig.legB.foot : lead === 'body' ? { x: rig.hip.x, y: rig.hip.y - 20 } : hand;
  const k = ph.p === 'windup' ? 0.5 : ph.p === 'active' ? 1 : fade;
  if (k > 0.05) embers(ctx, src.x, src.y, 26 * u, 60 * u, 9, time, 7, 2.4 * u, k);
}

// ── Projectile: a roaring fireball ──────────────────────────────────────────
function drawProjectile(ctx, p) {
  const r = p.r, t = p.t;
  const fadeIn = Math.min(1, ((p.maxLife || 60) - (p.life ?? 60) + 3) / 5);
  ctx.save();
  ctx.scale(fadeIn, fadeIn);
  additiveGlow(ctx, -r * 0.6, 0, r * 3.2, C.fireOrange, 0.5);
  // flame tail (points backwards, -x)
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * r * 0.55;
    flameDir(ctx, r * 0.1, off, -1, (i - 1) * 0.12, r * (3.4 - Math.abs(i - 1) * 1.1), r * (0.75 - Math.abs(i - 1) * 0.2), t * 1.6, i * 2.5, 0.95);
  }
  // core
  const g = ctx.createRadialGradient(r * 0.25, -r * 0.2, r * 0.1, 0, 0, r * 1.05);
  g.addColorStop(0, C.fireWhite); g.addColorStop(0.35, C.fireYellow); g.addColorStop(0.7, C.fireAmber); g.addColorStop(1, C.fireRed);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = kit.rgba(C.fireDeep, 0.9); ctx.stroke();
  // swirling bands
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = kit.rgba(C.fireOrange, 0.85); ctx.lineWidth = r * 0.22; ctx.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const a = t * 0.35 + i * Math.PI;
    ctx.beginPath(); ctx.arc(0, 0, r * (0.55 + i * 0.2), a, a + 1.6); ctx.stroke();
  }
  ctx.restore();
  additiveGlow(ctx, r * 0.2, 0, r * 1.2, C.fireWhite, 0.55);
  // sparks shed behind
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const ph = ((t * 0.9 + i * 9.3) % 24) / 24;
    const sx = -r * (1 + ph * 4.5);
    const sy = (hash(i + Math.floor((t * 0.9 + i * 9.3) / 24)) - 0.5) * r * 2.2 * (0.4 + ph);
    ctx.globalAlpha = 1 - ph;
    ctx.fillStyle = ph < 0.4 ? C.fireYellow : C.fireOrange;
    ctx.beginPath(); ctx.arc(sx, sy, r * 0.16 * (1 - ph * 0.6), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

// ── Idle guard stance ───────────────────────────────────────────────────────

// ── Grab, throws, stun and taunt poses (the engine's default puppet has none:
// without these they'd all read as the neutral stance) ──────────────────────
function statePose(v, taunt) {
  const t = v.time || 0, s = Math.sin(t * 0.5);
  switch (v.state) {
    case 'stunned': {
      const a = Math.sin(t * 0.12), c = Math.cos(t * 0.12);
      return { lean: 0.32 + a * 0.08, head: 0.45 + c * 0.25, by: 8, bx: a * 2, fU: 0.08 + a * 0.06, fL: 0.12, bU: -0.06 - a * 0.06, bL: 0.1, flU: 0.32, flL: -0.6, blU: -0.4, blL: -0.55, sy: 0.95 };
    }
    case 'grabbed':
      return { lean: -0.3, head: 0.35, by: -2, fU: 2.5 + s * 0.35, fL: 0.6, bU: 2.2 - s * 0.35, bL: 0.8, flU: 0.35 + s * 0.3, flL: -0.7, blU: -0.1 - s * 0.3, blL: -0.6 };
    case 'taunt': return taunt(t);
    case 'grabbing': break;
    default: return null;
  }
  const f = v.moveFrame || 0;
  const k = Math.min(1, f / (Math.max(4, v.move?.duration || 24) * 0.45)); // windup → release
  const mix = (a, b) => { const o = {}; for (const key in b) o[key] = (a[key] ?? 0) + (b[key] - (a[key] ?? 0)) * k; return o; };
  const HOLD = { lean: 0.14, fU: 1.5, fL: 0.12, bU: 1.3, bL: 0.42, flU: 0.4, flL: -0.35, blU: -0.4, blL: -0.25 };
  switch (v.move?.slot) {
    case 'pummel': { const z = Math.abs(Math.sin(f * 0.8)); return { ...HOLD, lean: 0.3, head: -0.12, bU: 0.6 + z * 0.9, bL: 1.6 - z * 1.4, flU: 0.6 + z * 0.8, flL: -1.2 - z * 0.4 }; } // knee + jabs
    case 'fthrow':
      return mix({ ...HOLD, lean: -0.25, fU: 0.6, fL: 1.6, bU: 0.4, bL: 1.6, bx: -4 },
        { lean: 0.42, fU: 1.6, fL: -0.05, bU: 1.45, bL: 0.05, bx: 4, flU: 0.75, flL: -0.9, blU: -0.55, blL: -0.3 });
    case 'bthrow':
      return { ...mix({ ...HOLD, lean: 0.2 }, { lean: -0.35, fU: -1.7, fL: 0.1, bU: -1.5, bL: 0.2, flU: -0.2, flL: -0.3, blU: 0.45, blL: -0.6 }), spin: -Math.PI * k };
    case 'uthrow':
      return mix({ ...HOLD, by: 12, sy: 0.88, sx: 1.08, fU: 0.9, bU: 0.8 },
        { lean: -0.1, head: -0.3, by: -4, sy: 1.1, sx: 0.94, fU: 3.05, fL: -0.1, bU: 2.95, bL: 0.1, flU: 0.1, flL: -0.1, blU: -0.1, blL: -0.1 });
    case 'dthrow':
      return mix({ ...HOLD, fU: 2.7, fL: 0.3, bU: 2.5, bL: 0.4, by: -2 },
        { lean: 0.6, head: 0.3, by: 16, sy: 0.9, fU: 0.35, fL: 0.05, bU: 0.25, bL: 0.1, flU: 1.0, flL: -1.6, blU: -0.45, blL: -1.2 });
    default: return HOLD;
  }
}

// Taunt: fist pumped overhead, the other on her hip.
const emberTaunt = (t) => ({ lean: -0.1, head: -0.25, fU: 3.0 + Math.sin(t * 0.3) * 0.12, fL: 0.15, bU: -0.55, bL: 2.3, flU: 0.25, flL: -0.2, blU: -0.3, blL: -0.15 });

function stance(p, v) {
  if (v.state !== 'idle' && v.state !== 'respawn') return statePose(v, emberTaunt);
  const b = Math.sin((v.time || 0) * 0.13);
  return {
    lean: 0.14 + b * 0.015, by: 3 + b * 1.4, head: 0.06,
    fU: 0.72 + b * 0.05, fL: 2.0, bU: 0.32 - b * 0.04, bL: 2.15,
    flU: 0.34, flL: -0.3 - b * 0.06, blU: -0.36, blL: -0.24 - b * 0.06,
  };
}

export default {
  id: 'ember',
  name: 'Ember',
  author: 'Noah',
  description: 'A street-fighting prodigy whose wrapped fists burst into flame. Fast, aggressive and built for combos: fireballs, blazing kicks, a dashing rush and a rising phoenix uppercut.',

  stats: {
    weight: 86,
    runSpeed: 7.6,
    airSpeed: 5.0,
    jumpHeight: 16,
    doubleJumpHeight: 15,
    airJumps: 1,
    gravity: 0.72,
    fallSpeed: 12,
    width: 48,
    height: 90,
  },

  moves,

  art: {
    palette: {
      ...BASE,
      skin: '#f8caa2', primary: '#b51f27', secondary: '#3b3442', accent: C.gold,
      hair: '#d8361c', eyes: '#ff9a1a', boots: '#2a2430', outline: '#1c0f14',
      effect: '#ff7a1a', effect2: '#ffe27a',
    },
    build: { head: 1.04, shoulders: 1.02, hips: 0.95, thickness: 0.95 },
    pose: stance,
    head: withPalette(drawHead),
    torso: withPalette(drawTorso),
    arm: withPalette(drawArm),
    leg: withPalette(drawLeg),
    back: withPalette(drawBack),
    front: withPalette(drawFront),
    projectile: withPalette(drawProjectile),
    // Chain colours are palette keys, so alt palettes recolour the scarf tails too.
    chains: [
      { anchor: 'neck', length: 56, segments: 9, width: 10, endWidth: 5, color: 'tail1', color2: 'tail1b', stiffness: 0.95, gravity: 0.8 },
      { anchor: 'neck', length: 40, segments: 7, width: 8, endWidth: 4, color: 'tail2', color2: 'tail2b', stiffness: 0.65, gravity: 0.9 },
    ],
    // Alt palettes for duplicate picks (mirror matches / training dummy).
    palettes: [
      {},
      // Blue Flame: cobalt gi, white-hot blue fire, ice-blue hair
      { primary: '#2a5ad8', hair: '#3a8cff', eyes: '#7fd8ff', effect: '#5ab4ff', effect2: '#e8fbff',
        fireDeep: '#1a3fae', fireRed: '#2f7bff', fireOrange: '#4fb0ff', fireAmber: '#8fd8ff', fireYellow: '#d4f4ff', fireWhite: '#f4fdff',
        hair0: '#0f2370', hair1: '#1f4fc4', hair2: '#3a8cff', hair3: '#7fc8ff', hair4: '#dff6ff',
        scarf: '#5ab4ff', scarfDark: '#1f4fc4', scarfLine: '#0f2a70', cuff: '#2a5ad8', pantsCuff: '#173a8e',
        tail1: '#2f7bff', tail1b: '#9fe0ff', tail2: '#1a4fc4', tail2b: '#5ab4ff' },
      // Jade Flame: emerald gi, green fire, teal hair
      { primary: '#1f9a5a', hair: '#2bd47a', eyes: '#8dff9a', effect: '#4fe08a', effect2: '#e4ffd0',
        fireDeep: '#0e6a32', fireRed: '#1fb85a', fireOrange: '#4fe08a', fireAmber: '#9cf27a', fireYellow: '#e0ff9a', fireWhite: '#f6ffe8',
        hair0: '#0b4426', hair1: '#147a44', hair2: '#22b864', hair3: '#5ee89a', hair4: '#d8ffb0',
        scarf: '#4fe08a', scarfDark: '#147a44', scarfLine: '#0b4426', cuff: '#1f9a5a', pantsCuff: '#0f6038',
        tail1: '#22b864', tail1b: '#b8ff8a', tail2: '#147a44', tail2b: '#4fe08a' },
      // Violet Flame: plum gi, magenta fire, white-gold hair
      { primary: '#7a2fb0', hair: '#c45ae8', eyes: '#ff8af0', effect: '#e05aff', effect2: '#ffe0ff',
        fireDeep: '#5a1a8e', fireRed: '#a03ad8', fireOrange: '#e05aff', fireAmber: '#ff8af0', fireYellow: '#ffd0fa', fireWhite: '#fff4ff',
        hair0: '#3a0f5c', hair1: '#7a2fb0', hair2: '#c45ae8', hair3: '#ff9af0', hair4: '#fff0c8',
        scarf: '#e05aff', scarfDark: '#7a2fb0', scarfLine: '#3a0f5c', cuff: '#a03ad8', pantsCuff: '#4a1a70',
        tail1: '#a03ad8', tail1b: '#ff9af0', tail2: '#7a2fb0', tail2b: '#e05aff' },
    ],
  },
};
