// ─────────────────────────────────────────────────────────────────────────────
// BASTION — the Frost Paladin
//
// A towering knight in steel-and-ice plate who fights with a frost-forged
// war maul. Showcase character: every body part is a custom art hook, the
// hammer is a custom weapon function, the cape is a physics chain dressed up
// with a tattered hem, and the special moves have their own ice effects and
// projectile art.
//
// Layout of this file:
//   1. stats + moves      (gameplay — run through the auto-balancer)
//   2. palette + helpers  (shared drawing utilities)
//   3. art hooks          (head, torso, arm, leg, weapon, cape, effects, projectiles)
// ─────────────────────────────────────────────────────────────────────────────
import * as kit from '../../shared/art/kit.js';

const { shade, rgba, clamp, lerp } = kit;

// Distance (rig units, ×u px) from the fist to the centre of the hammer head.
// Hitboxes for hammer moves were placed at hand + forearmDirection × this.
const HAMMER_LEN = 42;

// ── Custom attack poses ─────────────────────────────────────────────────────
// Angles: arms 0 = down, π/2 = forward, π = up. The hammer points along the
// forearm, so its angle is lean + fU + fL.
const STANCE = { flU: 0.38, flL: -0.4, blU: -0.38, blL: -0.2 };
const P = {
  jab: {
    limb: 'frontHand',
    windup: { lean: -0.05, fU: 0.15, fL: 1.75, bU: 0.4, bL: 1.3, ...STANCE },
    strike: { lean: 0.12, fU: 0.55, fL: 1.0, bU: -0.45, bL: 0.9, ...STANCE },
  },
  side: {
    limb: 'frontHand',
    windup: { lean: -0.25, fU: 2.7, fL: 0.7, bU: 0.5, bL: 1.3, bx: -4, ...STANCE },
    strike: { lean: 0.35, fU: 1.05, fL: 0.05, bU: -0.7, bL: 0.6, bx: 2, flU: 0.6, flL: -0.55, blU: -0.5, blL: -0.2 },
  },
  up: {
    limb: 'frontHand',
    windup: { lean: 0.3, fU: 0.5, fL: 0.3, bU: -0.2, bL: 0.6, by: 6, flU: 0.5, flL: -0.8, blU: -0.35, blL: -0.5 },
    strike: { lean: -0.2, fU: 3.0, fL: -0.3, bU: -0.6, bL: 0.5, by: -2, flU: 0.25, flL: -0.2, blU: -0.3, blL: -0.1 },
  },
  down: {
    limb: 'frontHand',
    windup: { lean: 0.45, fU: -0.5, fL: 0.2, bU: -0.3, bL: 1.2, by: 18, head: -0.25, flU: 1.05, flL: -1.9, blU: -0.35, blL: -1.5 },
    strike: { lean: 0.5, fU: 0.72, fL: -0.05, bU: -0.8, bL: 0.8, by: 22, head: -0.3, flU: 1.15, flL: -1.9, blU: -0.5, blL: -1.4 },
  },
  sideSmash: {
    limb: 'frontHand',
    windup: { lean: -0.38, fU: 3.5, fL: 0.35, bU: 3.0, bL: 0.6, by: -2, bx: -6, sy: 1.05, sx: 0.97, flU: 0.35, flL: -0.3, blU: -0.5, blL: -0.2 },
    strike: { lean: 0.55, fU: 0.75, fL: -0.05, bU: 0.4, bL: 0.6, by: 12, bx: 3, sx: 1.07, sy: 0.93, flU: 0.8, flL: -1.0, blU: -0.65, blL: -0.4 },
  },
  upSmash: {
    limb: 'frontHand',
    windup: { lean: 0.35, fU: 0.05, fL: 0.2, bU: 0.2, bL: 1.0, by: 15, sy: 0.9, sx: 1.06, flU: 0.75, flL: -1.4, blU: -0.5, blL: -0.7 },
    strike: { lean: -0.1, fU: 3.15, fL: -0.35, bU: 2.4, bL: 0.6, by: -4, sy: 1.1, sx: 0.95, flU: 0.25, flL: -0.1, blU: -0.25, blL: -0.1 },
  },
  downSmash: {
    limb: 'frontHand',
    windup: { lean: -0.2, fU: 3.3, fL: 0.25, bU: 3.0, bL: 0.4, by: -4, sy: 1.04, flU: 0.4, flL: -0.3, blU: -0.4, blL: -0.2 },
    strike: { lean: 0.6, fU: 0.5, fL: 0.0, bU: 0.3, bL: 0.5, by: 24, sx: 1.08, sy: 0.9, flU: 0.95, flL: -1.6, blU: -0.75, blL: -0.9 },
  },
  nair: {
    limb: 'frontHand', spinTurns: 1,
    windup: { fU: 1.3, fL: 0.2, bU: -1.2, bL: 0.5, flU: 0.7, flL: -1.2, blU: -0.4, blL: -1.2, sy: 0.95 },
    strike: { fU: 1.5, fL: 0.0, bU: -1.5, bL: 0.2, flU: 0.9, flL: -0.7, blU: -0.8, blL: -0.7 },
  },
  fair: {
    limb: 'frontHand',
    windup: { lean: -0.2, fU: 3.2, fL: 0.5, bU: -0.8, bL: 0.6, flU: 0.8, flL: -1.4, blU: 0.2, blL: -1.2 },
    strike: { lean: 0.45, fU: 0.75, fL: -0.1, bU: -1.2, bL: 0.4, flU: 0.6, flL: -1.1, blU: -0.3, blL: -0.8 },
  },
  bair: {
    limb: 'frontHand',
    windup: { lean: -0.1, fU: 2.0, fL: 0.4, bU: -0.6, bL: 0.6, flU: 0.7, flL: -1.3, blU: -0.1, blL: -1.0 },
    strike: { lean: 0.5, head: -0.35, fU: -2.15, fL: -0.05, bU: 1.2, bL: 0.6, flU: 0.6, flL: -1.3, blU: -0.5, blL: -0.6 },
  },
  uair: {
    limb: 'frontHand',
    windup: { lean: 0.15, fU: -1.9, fL: 0.1, bU: 1.0, bL: 0.5, flU: 0.6, flL: -1.2, blU: -0.2, blL: -1.2 },
    strike: { lean: -0.3, head: -0.2, fU: -3.75, fL: 0.05, bU: 0.6, bL: 0.6, flU: 0.4, flL: -0.9, blU: -0.4, blL: -1.0 },
  },
  dair: {
    limb: 'frontHand',
    windup: { lean: 0.1, fU: 3.0, fL: 0.2, bU: 2.8, bL: 0.4, by: -6, flU: 0.9, flL: -1.8, blU: 0.6, blL: -1.7 },
    strike: { lean: 0.15, fU: -0.05, fL: -0.1, bU: -0.6, bL: 0.6, sy: 1.05, flU: 1.05, flL: -2.0, blU: 0.7, blL: -1.8 },
  },
  neutralSpecial: {
    limb: 'frontHand',
    windup: { lean: -0.22, fU: 2.5, fL: 0.9, bU: 0.7, bL: 1.6, bx: -5, ...STANCE },
    strike: { lean: 0.3, fU: 1.15, fL: 0.0, bU: 1.1, bL: 0.4, bx: 3, flU: 0.55, flL: -0.45, blU: -0.5, blL: -0.2 },
  },
  sideSpecial: {
    limb: 'frontHand',
    windup: { lean: -0.05, fU: 1.0, fL: 1.6, bU: 1.0, bL: 1.6, by: 7, sy: 0.96, flU: 0.5, flL: -0.6, blU: -0.6, blL: -0.35 },
    strike: { lean: 0.62, fU: 0.9, fL: 0.65, bU: -0.6, bL: 1.1, bx: 8, sx: 1.08, sy: 0.94, flU: 0.85, flL: -1.1, blU: -0.95, blL: -0.4 },
  },
  upSpecial: {
    limb: 'frontHand',
    windup: { lean: 0.2, fU: 0.3, fL: 0.3, bU: 0.2, bL: 1.0, by: 12, sy: 0.88, sx: 1.08, flU: 0.9, flL: -1.6, blU: 0.5, blL: -1.5 },
    strike: { lean: -0.1, fU: 3.0, fL: -0.1, bU: 2.5, bL: 0.4, sy: 1.1, sx: 0.93, flU: 0.2, flL: -0.4, blU: -0.3, blL: -0.5 },
  },
  downSpecial: {
    limb: 'frontHand',
    windup: { lean: -0.1, fU: 3.25, fL: 0.3, bU: 3.0, bL: 0.4, by: -6, flU: 0.8, flL: -1.6, blU: 0.4, blL: -1.4 },
    strike: { lean: 0.55, fU: 0.55, fL: 0.05, bU: 0.3, bL: 0.4, by: 20, sx: 1.1, sy: 0.9, flU: 0.9, flL: -1.5, blU: -0.75, blL: -0.9 },
  },
};

// ── Colours ──────────────────────────────────────────────────────────────────
// Every hook draws from C, rebound to the resolved palette (alt palettes for
// duplicate picks) at the start of each hook call.
const BASE = Object.freeze({
  out: '#0f1428',
  steel: '#a9b9d2',
  steelDark: '#61708e',
  navy: '#1b2850',
  royal: '#2c58cf',
  gold: '#e9b84f',
  ice: '#8ff1ff',
  iceDeep: '#3fa6e8',
  iceCore: '#effeff',
  warm: '#ffd7a3',
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

export default {
  id: 'bastion',
  name: 'Bastion',
  author: 'Noah',
  description: 'A towering frost-paladin in steel-and-ice plate. Slow to move, slower to fall, and every swing of his glacier maul lands like an avalanche.',

  // ── Stats ── a true heavyweight: max weight, big hurtbox, weak mobility.
  stats: {
    weight: 130,
    runSpeed: 5.4,
    airSpeed: 3.7,
    jumpHeight: 14,
    doubleJumpHeight: 12.5,
    airJumps: 1,
    gravity: 0.8,
    fallSpeed: 13,
    width: 64,
    height: 112,
  },

  // ── Moves ── hitboxes sit on the hammer head (see HAMMER_LEN above).
  moves: {
    jab: {
      name: 'Rime Jab', duration: 22, pose: P.jab, effect: 'ice',
      hitboxes: [{ start: 5, end: 7, x: 74, y: -64, r: 18, damage: 4, angle: 40, knockback: 14, growth: 30 }],
    },
    side: {
      name: 'Rime Swing', duration: 36, pose: P.side, effect: 'ice',
      hitboxes: [
        { start: 11, end: 14, x: 95, y: -62, r: 24, damage: 11, angle: 36, knockback: 30, growth: 92 },
        { start: 11, end: 14, x: 66, y: -66, r: 18, damage: 8, angle: 40, knockback: 24, growth: 80 },
      ],
    },
    up: {
      name: 'Crest Arc', duration: 34, pose: P.up, effect: 'ice',
      hitboxes: [
        { start: 9, end: 14, x: 42, y: -138, r: 26, damage: 9, angle: 88, knockback: 30, growth: 88 },
        { start: 9, end: 14, x: 26, y: -112, r: 18, damage: 7, angle: 85, knockback: 26, growth: 80 },
      ],
    },
    down: {
      name: 'Frost Sweep', duration: 30, pose: P.down, effect: 'ice',
      hitboxes: [{ start: 9, end: 12, x: 90, y: -20, r: 20, damage: 8, angle: 28, knockback: 30, growth: 55 }],
    },
    sideSmash: {
      name: 'Glacier Breaker', duration: 60, pose: P.sideSmash, effect: 'ice',
      hitboxes: [
        { start: 22, end: 25, x: 100, y: -30, r: 30, damage: 18, angle: 38, knockback: 40, growth: 100 },
        { start: 22, end: 25, x: 70, y: -50, r: 20, damage: 13, angle: 45, knockback: 30, growth: 85 },
      ],
    },
    upSmash: {
      name: 'Aurora Pillar', duration: 54, pose: P.upSmash, effect: 'ice',
      hitboxes: [
        { start: 16, end: 21, x: 30, y: -158, r: 26, damage: 17, angle: 88, knockback: 46, growth: 106 },
        { start: 16, end: 21, x: 20, y: -128, r: 22, damage: 13, angle: 88, knockback: 32, growth: 90 },
      ],
    },
    downSmash: {
      name: 'Permafrost Ring', duration: 56, pose: P.downSmash, effect: 'ice',
      hitboxes: [
        { start: 19, end: 22, x: 98, y: -18, r: 30, damage: 16, angle: 30, knockback: 44, growth: 102 },
        { start: 20, end: 24, x: -62, y: -18, r: 30, damage: 13, angle: 150, knockback: 36, growth: 90 },
      ],
    },
    nair: {
      name: 'Frozen Orbit', duration: 36, pose: P.nair, effect: 'ice', landingLag: 12,
      // One hitbox per stretch of the hammer's orbit (group 0 = can only hit once).
      hitboxes: [
        { start: 8, end: 9, x: 82, y: -48, r: 26, damage: 10, angle: 40, knockback: 24, growth: 80 },
        { start: 10, end: 11, x: 28, y: 22, r: 26, damage: 10, angle: 300, knockback: 20, growth: 60 },
        { start: 12, end: 13, x: -62, y: -10, r: 26, damage: 10, angle: 150, knockback: 24, growth: 80 },
        { start: 14, end: 16, x: -66, y: -102, r: 26, damage: 10, angle: 120, knockback: 24, growth: 80 },
        { start: 17, end: 19, x: 52, y: -128, r: 26, damage: 10, angle: 70, knockback: 24, growth: 80 },
      ],
    },
    fair: {
      name: 'Meteor Maul', duration: 42, pose: P.fair, effect: 'ice', landingLag: 18,
      hitboxes: [
        { start: 14, end: 17, x: 86, y: -34, r: 25, damage: 14, angle: 42, knockback: 32, growth: 92 },
        { start: 14, end: 17, x: 62, y: -48, r: 18, damage: 10, angle: 50, knockback: 26, growth: 80 },
      ],
    },
    bair: {
      name: 'Reverse Hammerfall', duration: 40, pose: P.bair, effect: 'ice', landingLag: 16,
      hitboxes: [
        { start: 12, end: 15, x: -64, y: -78, r: 26, damage: 13, angle: 140, knockback: 34, growth: 92 },
        { start: 12, end: 15, x: -36, y: -74, r: 18, damage: 9, angle: 145, knockback: 26, growth: 80 },
      ],
    },
    uair: {
      name: 'Crest Breaker', duration: 38, pose: P.uair, effect: 'ice', landingLag: 14,
      hitboxes: [
        { start: 10, end: 14, x: 50, y: -130, r: 28, damage: 12, angle: 80, knockback: 30, growth: 90 },
        { start: 10, end: 14, x: 30, y: -110, r: 18, damage: 9, angle: 85, knockback: 26, growth: 80 },
      ],
    },
    dair: {
      name: 'Avalanche Drop', duration: 46, pose: P.dair, effect: 'ice', landingLag: 22,
      hitboxes: [
        { start: 16, end: 19, x: 12, y: 4, r: 24, damage: 14, angle: 270, knockback: 30, growth: 70 },
        { start: 20, end: 26, x: 12, y: 2, r: 20, damage: 8, angle: 60, knockback: 24, growth: 60 },
      ],
    },
    neutralSpecial: {
      name: 'Frost Lance', duration: 50, pose: P.neutralSpecial, effect: 'ice',
      projectiles: [{ start: 20, x: 88, y: -76, vx: 8.5, vy: 0, life: 62, r: 14, damage: 9, angle: 30, knockback: 24, growth: 55, style: 'shard' }],
    },
    sideSpecial: {
      name: 'Aegis Rush', duration: 48, pose: P.sideSpecial, effect: 'ice',
      intangible: [5, 14],
      velocity: [{ start: 16, end: 26, vx: 8.5 }],
      hitboxes: [{ start: 16, end: 26, x: 52, y: -74, r: 36, damage: 11, angle: 35, knockback: 34, growth: 75 }],
    },
    upSpecial: {
      name: 'Glacial Ascent', duration: 40, pose: P.upSpecial, effect: 'ice',
      velocity: [{ start: 7, end: 15, vx: 2, vy: -10.5 }],
      hitboxes: [
        { start: 6, end: 9, x: 0, y: -20, r: 34, damage: 5, angle: 80, knockback: 40, growth: 30, group: 0 },
        { start: 11, end: 18, x: 22, y: -150, r: 26, damage: 8, angle: 85, knockback: 30, growth: 70, group: 1 },
      ],
    },
    downSpecial: {
      name: 'Hoarfrost Quake', duration: 54, pose: P.downSpecial, effect: 'ice',
      velocity: [{ start: 3, end: 8, vy: -7 }, { start: 11, end: 15, vy: 14 }],
      hitboxes: [
        { start: 12, end: 15, x: 80, y: -50, r: 28, damage: 10, angle: 290, knockback: 26, growth: 60 },
        { start: 16, end: 19, x: 90, y: -16, r: 30, damage: 10, angle: 55, knockback: 34, growth: 70 },
        { start: 16, end: 19, x: -60, y: -16, r: 30, damage: 10, angle: 125, knockback: 34, growth: 70 },
      ],
      projectiles: [
        { start: 18, x: 100, y: -20, vx: 7, vy: 0, life: 34, r: 16, damage: 4, angle: 60, knockback: 22, growth: 35, style: 'wave' },
        { start: 18, x: -72, y: -20, vx: -7, vy: 0, life: 34, r: 16, damage: 4, angle: 60, knockback: 22, growth: 35, style: 'wave' },
      ],
    },
  },

  art: {
    palette: {
      ...BASE,
      skin: '#d9c2a8', primary: '#2c58cf', secondary: '#1b2850', accent: '#e9b84f',
      hair: '#dff6ff', eyes: '#8ff1ff', boots: '#5f6f8c', outline: '#0f1428',
      effect: '#8fe9ff', effect2: '#ffffff',
    },
    build: { head: 0.95, torso: 1.08, arms: 1.05, legs: 0.95, thickness: 1.3, shoulders: 1.5, hips: 1.4 },
    // The cape is a physics chain; art.back redraws it with a tattered hem and gold trim.
    chains: [{ anchor: 'neck', length: 60, segments: 7, width: 26, endWidth: 38, color: 'royal', color2: 'navy', stiffness: 0.45 }],
    // Alt palettes for duplicate picks (mirror matches / training dummy): cape, plate tint, trim and frost.
    palettes: [
      {},
      // Crimson Warden: red cape, blackened plate, gold trim, ember-orange frost
      { royal: '#c4303a', navy: '#3a1418', steel: '#8a8e9c', steelDark: '#45434f', gold: '#f2c14e', ice: '#ffb36b', iceDeep: '#e0602a', iceCore: '#fff1df',
        primary: '#c4303a', secondary: '#3a1418', eyes: '#ffb36b', effect: '#ffb36b' },
      // Verdant Sentinel: forest cape, bronze-steel, jade frost
      { royal: '#2f8f4e', navy: '#14301f', steel: '#c9b48a', steelDark: '#7a6a48', gold: '#e8e1c4', ice: '#7dffc2', iceDeep: '#22b07a', iceCore: '#eafff5',
        primary: '#2f8f4e', secondary: '#14301f', eyes: '#7dffc2', effect: '#7dffc2' },
      // Twilight Paladin: violet cape, white plate, rose-gold, amethyst frost
      { royal: '#7a3fd0', navy: '#25144a', steel: '#e6e2f0', steelDark: '#8d86a6', gold: '#f0a6a0', ice: '#d6a8ff', iceDeep: '#9a5ae8', iceCore: '#fbf2ff',
        primary: '#7a3fd0', secondary: '#25144a', eyes: '#d6a8ff', effect: '#d6a8ff' },
    ],
    pose: posePatch,
    back: withPalette(drawCape),
    torso: withPalette(drawTorso),
    head: withPalette(drawHelm),
    arm: withPalette(drawArm),
    leg: withPalette(drawLeg),
    weapon: hammerWeapon(),
    front: withPalette(drawFrontFx),
    projectile: withPalette(drawProjectile),
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// ART
// ═════════════════════════════════════════════════════════════════════════════

const bk = (c, back) => (back ? shade(c, -0.26) : c);
const mid = (a, b, t = 0.5) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const angOf = (a, b) => Math.atan2(b.x - a.x, b.y - a.y); // rig angle: 0 = down

/** Polished-steel fill for the current path. `rot` = ctx rotation applied so light stays world-up. */
function metal(ctx, base, { x = 0, y = 0, r = 20, rot = 0, lw = 3, gloss = 0.3 } = {}) {
  const lx = -Math.sin(rot), ly = -Math.cos(rot);
  const g = ctx.createLinearGradient(x + lx * r - ly * r * 0.25, y + ly * r + lx * r * 0.25, x - lx * r, y - ly * r);
  g.addColorStop(0, shade(base, 0.62));
  g.addColorStop(0.26, shade(base, 0.2));
  g.addColorStop(0.5, base);
  g.addColorStop(0.64, shade(base, -0.28));
  g.addColorStop(0.8, shade(base, -0.08));
  g.addColorStop(1, shade(base, -0.5));
  if (lw) { ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = C.out; ctx.stroke(); }
  ctx.fillStyle = g;
  ctx.fill();
  if (gloss) {
    ctx.save();
    ctx.clip();
    const hx = x + lx * r * 0.45, hy = y + ly * r * 0.45;
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.7);
    hg.addColorStop(0, `rgba(255,255,255,${gloss})`);
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.restore();
  }
}

/** Matte cloth fill (tabard, cape, padding). */
function cloth(ctx, base, { x = 0, y = 0, r = 20, rot = 0, lw = 3 } = {}) {
  const lx = -Math.sin(rot), ly = -Math.cos(rot);
  const g = ctx.createLinearGradient(x + lx * r, y + ly * r, x - lx * r, y - ly * r);
  g.addColorStop(0, shade(base, 0.22));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shade(base, -0.4));
  if (lw) { ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = C.out; ctx.stroke(); }
  ctx.fillStyle = g;
  ctx.fill();
}

function goldFill(ctx, back, opts = {}) {
  metal(ctx, bk(C.gold, back), { gloss: 0.4, lw: 2, ...opts });
}

function line(ctx, pts, color, w, alpha = 1, cap = 'round') {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = cap; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

function rivet(ctx, x, y, r, back) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = bk(C.gold, back); ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = C.out; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
}

/** Faceted ice crystal pointing along `ang` (rig angle convention: 0 = +y, π/2 = +x). */
function crystal(ctx, x, y, len, w, ang, { alpha = 1, lw = 2, dim = 0 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-ang);
  ctx.globalAlpha *= alpha;
  const tip = [0, len], sL = [-w, len * 0.3], sR = [w, len * 0.3], base = [0, -len * 0.08];
  ctx.beginPath(); ctx.moveTo(...base); ctx.lineTo(...sL); ctx.lineTo(...tip); ctx.lineTo(...sR); ctx.closePath();
  ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = '#123a6a'; ctx.stroke();
  ctx.fillStyle = shade(C.ice, -0.1 - dim); ctx.fill();
  ctx.beginPath(); ctx.moveTo(...base); ctx.lineTo(...sL); ctx.lineTo(...tip); ctx.closePath();
  ctx.fillStyle = shade(C.iceCore, -dim); ctx.fill();
  ctx.beginPath(); ctx.moveTo(...base); ctx.lineTo(...sR); ctx.lineTo(...tip); ctx.closePath();
  ctx.fillStyle = rgba(shade(C.iceDeep, -dim), 0.75); ctx.fill();
  ctx.restore();
}

/** Six-armed frost sigil (used on the chest, tabard and hammer). */
function sigil(ctx, x, y, r, color, w) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    const cx = Math.cos(a), cy = Math.sin(a);
    ctx.moveTo(0, 0); ctx.lineTo(cx * r, cy * r);
    const bx = cx * r * 0.55, by = cy * r * 0.55;
    ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a + 0.8) * r * 0.3, by + Math.sin(a + 0.8) * r * 0.3);
    ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a - 0.8) * r * 0.3, by + Math.sin(a - 0.8) * r * 0.3);
  }
  ctx.stroke();
  ctx.restore();
}

function sparkle(ctx, x, y, s, color, alpha) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  kit.starPath(ctx, x, y, 4, s, s * 0.22, 0);
  ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

/** Undo the puppet's squash/spin so we can draw in plain fighter space (feet at 0,0). */
function toFighterSpace(ctx, info) {
  const { pose, rig } = info;
  if (pose.spin) {
    const cx = rig.hip.x, cy = rig.hip.y - rig.torsoLen * 0.3;
    ctx.translate(cx, cy); ctx.rotate(-pose.spin); ctx.translate(-cx, -cy);
  }
  ctx.scale(1 / pose.sx, 1 / pose.sy);
}

const moveK = (f, a, b) => clamp((f - a) / Math.max(1, b - a), 0, 1);

// ── Pose tweaks: heavier idle stance and a shoulder-carry run ───────────────
function posePatch(pose, view) {
  if (view.state === 'idle') {
    const b = Math.sin((view.time || 0) * 0.055);
    return { fU: 0.55 + b * 0.03, fL: 0.2, bU: -0.15 - b * 0.03, bL: 0.85, flU: 0.3, flL: -0.22, blU: -0.32, blL: -0.06, by: b * 1.4 + 1 };
  }
  if (view.state === 'run') {
    return { fU: 0.55 + pose.fU * 0.08, fL: 2.55, bU: pose.bU * 0.9, head: -0.02 };
  }
  return statePose(view, bastionTaunt);
}
// Taunt: hammer raised overhead in salute, chest out.
const bastionTaunt = (t) => ({ lean: -0.15, head: -0.2, fU: 2.95, fL: 0.25 + Math.sin(t * 0.2) * 0.08, bU: -0.35, bL: 1.6, flU: 0.4, flL: -0.3, blU: -0.4, blL: -0.2, by: -1 });

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

// ── Cape: physics from art.chains[0], dressed with a tattered hem ───────────
const TATTER = [0.25, 0.95, 0.4, 1.0, 0.15, 0.75, 0.35, 0.9, 0.2];
function drawCape(ctx, info) {
  const st = info.cache.chains?.[0];
  if (!st) return;
  const v = info.view, u = info.u, facing = v.facing || 1;
  const pts = st.pts.map((p) => ({ x: (p.x - (v.x || 0)) * facing, y: p.y - (v.y || 0) }));
  const n = pts.length - 1;
  ctx.save();
  toFighterSpace(ctx, info);
  // Same ribbon maths as the engine's chain renderer, but slightly wider so it covers it.
  const w0 = 26 * u * 0.5 + 1.5, w1 = 38 * u * 0.5 + 1.5;
  const L = [], R = [], N = [];
  for (let i = 0; i <= n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    const w = w0 + (w1 - w0) * (i / n);
    N.push({ nx: -dy / d, ny: dx / d, tx: dx / d, ty: dy / d, w });
    L.push([pts[i].x - (dy / d) * w, pts[i].y + (dx / d) * w]);
    R.push([pts[i].x + (dy / d) * w, pts[i].y - (dx / d) * w]);
  }
  // Ragged hem between the last left and right points.
  const e = N[n], hem = [];
  const m = TATTER.length;
  for (let k = 0; k <= m; k++) {
    const t = k / m;
    const bx = lerp(R[n][0], L[n][0], t), by = lerp(R[n][1], L[n][1], t);
    const ext = k % 2 ? TATTER[k - 1] * 8 * u : -1.5 * u;
    hem.push([bx + e.tx * ext, by + e.ty * ext]);
  }
  const path = () => {
    ctx.beginPath();
    L.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    hem.slice().reverse().forEach(([x, y]) => ctx.lineTo(x, y));
    for (let i = n; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
    ctx.closePath();
  };
  path();
  const g = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[n].x, pts[n].y);
  const capeDark = shade(C.royal, -0.45);
  g.addColorStop(0, capeDark);
  g.addColorStop(0.18, C.royal);
  g.addColorStop(0.7, shade(C.royal, -0.12));
  g.addColorStop(1, capeDark);
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = C.out; ctx.stroke();
  ctx.fillStyle = g; ctx.fill();
  ctx.save();
  path(); ctx.clip();
  // Folds: soft dark and light streaks following the cloth.
  for (const [off, col, w, a] of [[-0.45, shade(C.royal, -0.6), 5 * u, 0.45], [0.1, shade(C.royal, -0.6), 4 * u, 0.35], [-0.12, shade(C.royal, 0.35), 2.4 * u, 0.35], [0.55, shade(C.royal, 0.35), 2 * u, 0.25]]) {
    line(ctx, pts.map((p, i) => [p.x + N[i].nx * N[i].w * off, p.y + N[i].ny * N[i].w * off]), col, w, a);
  }
  // Gold trim along both edges.
  line(ctx, L.map(([x, y], i) => [x - N[i].nx * 2.2 * u, y - N[i].ny * 2.2 * u]), C.gold, 1.8 * u, 0.9);
  line(ctx, R.map(([x, y], i) => [x + N[i].nx * 2.2 * u, y + N[i].ny * 2.2 * u]), C.gold, 1.8 * u, 0.9);
  // Frost creeping up the hem.
  ctx.globalCompositeOperation = 'source-atop';
  const fg = ctx.createLinearGradient(pts[n].x, pts[n].y, pts[n - 2].x, pts[n - 2].y);
  fg.addColorStop(0, rgba(C.ice, 0.55)); fg.addColorStop(1, rgba(C.ice, 0));
  ctx.fillStyle = fg; ctx.fillRect(-400, -400, 800, 800);
  ctx.restore();
  ctx.restore();
}

// ── Torso: cuirass, frost crest, gorget, belt ───────────────────────────────
function drawTorso(ctx, info) {
  const { rig, u, time } = info;
  const L = rig.torsoLen;
  ctx.save();
  ctx.translate(rig.hip.x, rig.hip.y);
  ctx.rotate(rig.lean);
  const rot = rig.lean;
  // Rear tasset + mail skirt peeking out behind.
  kit.blobPath(ctx, [[-13 * u, -2 * u], [-4 * u, -1 * u], [-6 * u, 12 * u], [-15 * u, 10 * u]], 0.3);
  metal(ctx, shade(C.steel, -0.28), { x: -9 * u, y: 5 * u, r: 10 * u, rot });
  // Cuirass
  const body = [[-10.5 * u, 2 * u], [-14 * u, -L * 0.5], [-13 * u, -L - 1 * u], [-5 * u, -L - 4 * u], [6 * u, -L - 4 * u], [14.5 * u, -L - 0.5 * u], [16 * u, -L * 0.58], [12 * u, -L * 0.12], [10.5 * u, 2 * u], [0, 3.5 * u]];
  kit.blobPath(ctx, body, 0.42);
  metal(ctx, C.steel, { x: 2 * u, y: -L * 0.6, r: L * 0.75, rot, gloss: 0.32 });
  ctx.save();
  kit.blobPath(ctx, body, 0.42);
  ctx.clip();
  // Shadow on the rear half (3/4 view) + ab lames.
  const sg = ctx.createLinearGradient(-14 * u, 0, 4 * u, 0);
  sg.addColorStop(0, 'rgba(15,20,40,0.45)'); sg.addColorStop(1, 'rgba(15,20,40,0)');
  ctx.fillStyle = sg; ctx.fillRect(-20 * u, -L - 8 * u, 26 * u, L + 14 * u);
  for (const yy of [-L * 0.26, -L * 0.06]) {
    line(ctx, [[-14 * u, yy - 1 * u], [3 * u, yy + 2.2 * u], [16 * u, yy - 1.2 * u]], C.out, 2.2, 0.8);
    line(ctx, [[-12 * u, yy + 0.8 * u], [3 * u, yy + 4 * u], [15 * u, yy + 0.6 * u]], '#ffffff', 1.2, 0.35);
  }
  // Central keel ridge with highlight.
  line(ctx, [[5 * u, -L - 3 * u], [6.5 * u, -L * 0.6], [4.5 * u, -L * 0.3]], '#ffffff', 1.6 * u, 0.55);
  // Gold inlay framing the chest plate.
  line(ctx, [[-12 * u, -L * 0.36], [4 * u, -L * 0.32], [15.5 * u, -L * 0.4]], C.gold, 1.6 * u, 0.95);
  ctx.restore();
  // Frost crest: gold sigil with a glowing ice heart.
  const pulse = 0.75 + 0.25 * Math.sin(time * 0.08);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, 5.5 * u, -L * 0.66, 11 * u, C.ice, 0.4 * pulse);
  ctx.restore();
  sigil(ctx, 5.5 * u, -L * 0.66, 6.2 * u, C.out, 3.4);
  sigil(ctx, 5.5 * u, -L * 0.66, 6.2 * u, C.gold, 1.7);
  kit.polygonPath(ctx, [[5.5 * u, -L * 0.66 - 3.2 * u], [7.6 * u, -L * 0.66], [5.5 * u, -L * 0.66 + 3.2 * u], [3.4 * u, -L * 0.66]]);
  ctx.fillStyle = C.iceCore; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#1d5a8a'; ctx.stroke();
  // Gorget: two stacked steel collars.
  kit.blobPath(ctx, [[-9 * u, -L + 1 * u], [-8 * u, -L - 5 * u], [8.5 * u, -L - 5.5 * u], [10 * u, -L + 0.5 * u], [1 * u, -L + 3 * u]], 0.4);
  metal(ctx, C.steel, { x: 0, y: -L - 2 * u, r: 9 * u, rot });
  kit.blobPath(ctx, [[-6.5 * u, -L - 3 * u], [-5.5 * u, -L - 8 * u], [6.5 * u, -L - 8.5 * u], [7.5 * u, -L - 3.5 * u], [0.5 * u, -L - 1.5 * u]], 0.4);
  metal(ctx, shade(C.steel, -0.08), { x: 0, y: -L - 5 * u, r: 7 * u, rot });
  line(ctx, [[-8 * u, -L + 0.5 * u], [1 * u, -L + 2.6 * u], [9.5 * u, -L]], C.gold, 1.4 * u, 0.95);
  // Warm sunset rim light down the back.
  kit.rimLight(ctx, [[-12.5 * u, -L - 0.5 * u], [-13.6 * u, -L * 0.5], [-10.5 * u, -1 * u]], C.warm, 2.2, 0.6);
  // Belt (rear part; the front-leg hook redraws the front with the buckle).
  drawBelt(ctx, u, false);
  ctx.restore();
}

function drawBelt(ctx, u, buckle) {
  kit.blobPath(ctx, [[-11.5 * u, -3.5 * u], [11.8 * u, -4.2 * u], [11.6 * u, 0.6 * u], [-11.2 * u, 1.4 * u]], 0.2);
  cloth(ctx, '#3a2a22', { y: -1.5 * u, r: 3 * u, lw: 2.5 });
  line(ctx, [[-10.5 * u, -2.6 * u], [11 * u, -3.3 * u]], '#7a5a40', 1, 0.8);
  if (!buckle) return;
  kit.roundRectPath(ctx, 1.8 * u, -5 * u, 7 * u, 7.2 * u, 1.6 * u);
  goldFill(ctx, false, { x: 5.3 * u, y: -1.4 * u, r: 4 * u });
  kit.polygonPath(ctx, [[5.3 * u, -3.4 * u], [7 * u, -1.4 * u], [5.3 * u, 0.6 * u], [3.6 * u, -1.4 * u]]);
  ctx.fillStyle = C.ice; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#1d5a8a'; ctx.stroke();
}

/** Front of the waist: tasset, tabard flap, belt + buckle. Drawn over the front leg. */
function drawWaistFront(ctx, info, legAngle) {
  const { rig, u, time, view } = info;
  ctx.save();
  ctx.translate(rig.hip.x, rig.hip.y);
  ctx.rotate(rig.lean);
  const thigh = legAngle - rig.lean;
  // Tasset over the front thigh.
  ctx.save();
  ctx.translate(4 * u, 0);
  ctx.rotate(-clamp(thigh * 0.55, -0.5, 1.1));
  kit.blobPath(ctx, [[-7 * u, -1 * u], [8 * u, -1.5 * u], [9.5 * u, 11 * u], [1 * u, 13 * u], [-7.5 * u, 11 * u]], 0.3);
  metal(ctx, C.steel, { y: 5 * u, r: 10 * u, rot: rig.lean });
  line(ctx, [[-7 * u, 4.5 * u], [1 * u, 6 * u], [9 * u, 4 * u]], C.out, 2, 0.75);
  line(ctx, [[-7 * u, 10.2 * u], [1 * u, 12.2 * u], [9.2 * u, 10.2 * u]], C.gold, 1.5 * u, 0.95);
  ctx.restore();
  // Tabard flap — swallowtail, swings with the legs and a little wind.
  const sway = Math.sin(time * 0.07) * 0.06 - clamp((view.vx || 0) * (view.facing || 1) * 0.03, -0.25, 0.25);
  const lift = clamp(thigh * 0.4, -0.25, 0.9);
  ctx.save();
  ctx.translate(3 * u, -1 * u);
  ctx.rotate(-(lift + sway));
  const fl = 26 * u;
  const flap = [[-6 * u, 0], [6.5 * u, 0], [7.5 * u, fl], [0.3 * u, fl - 5 * u], [-7 * u, fl]];
  kit.polygonPath(ctx, flap);
  cloth(ctx, C.royal, { y: fl / 2, r: fl * 0.6, rot: rig.lean });
  ctx.save();
  kit.polygonPath(ctx, flap); ctx.clip();
  ctx.fillStyle = 'rgba(10,16,40,0.35)'; ctx.fillRect(-8 * u, 0, 4 * u, fl + 2 * u);
  ctx.restore();
  // Gold border + sigil
  line(ctx, [[-4.4 * u, 0], [-5.4 * u, fl - 2.5 * u], [0.3 * u, fl - 7 * u], [6 * u, fl - 2.5 * u], [5 * u, 0]], C.gold, 1.3 * u, 0.95);
  sigil(ctx, 0.3 * u, fl * 0.4, 3.6 * u, C.out, 2.6);
  sigil(ctx, 0.3 * u, fl * 0.4, 3.6 * u, C.gold, 1.3);
  ctx.restore();
  drawBelt(ctx, u, true);
  ctx.restore();
}

// ── Helm: great helm with a glowing visor slit and a frost plume ───────────
function drawHelm(ctx, info) {
  const { rig, time, expression: ex, view } = info;
  const r = rig.headR;
  // Plume (behind the helm), streaming back.
  const run = clamp(Math.abs(view.vx || 0) / 6, 0, 1);
  const sw = Math.sin(time * 0.09) * 0.1 * r;
  const plume = [[0.3 * r, -1.15 * r], [-0.3 * r, -1.62 * r], [-1.25 * r, -1.55 * r + sw], [-2.05 * r - run * 0.4 * r, -0.9 * r + sw * 1.5 - run * 0.3 * r], [-2.15 * r - run * 0.6 * r, -0.05 * r + sw * 2 - run * 0.5 * r], [-1.5 * r, -0.55 * r + sw], [-0.75 * r, -0.95 * r]];
  kit.blobPath(ctx, plume, 0.55);
  const pg = ctx.createLinearGradient(0.2 * r, -1.4 * r, -2.1 * r, -0.2 * r);
  pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.45, '#bdefff'); pg.addColorStop(1, '#4f8fe0');
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = C.out; ctx.stroke();
  ctx.fillStyle = pg; ctx.fill();
  for (let i = 0; i < 3; i++) {
    const o = i * 0.18 * r;
    line(ctx, [[-0.2 * r, -1.35 * r + o], [-1.1 * r, -1.3 * r + o + sw], [-1.85 * r, -0.65 * r + o + sw * 1.5]], i === 1 ? '#ffffff' : '#7fb6ee', 1.4, 0.7);
  }
  // Helm shell
  const shell = [[1.08 * r, -0.15 * r], [0.95 * r, -0.85 * r], [0.2 * r, -1.2 * r], [-0.75 * r, -1.0 * r], [-1.08 * r, -0.25 * r], [-1.02 * r, 0.62 * r], [-0.55 * r, 1.02 * r], [0.55 * r, 1.08 * r], [1.08 * r, 0.82 * r], [1.16 * r, 0.3 * r]];
  kit.blobPath(ctx, shell, 0.45);
  metal(ctx, C.steel, { y: -0.1 * r, r: 1.15 * r, rot: rig.headAngle, gloss: 0.4 });
  ctx.save();
  kit.blobPath(ctx, shell, 0.45);
  ctx.clip();
  // Rear shadow and the faceplate plane.
  const hg = ctx.createLinearGradient(-1.1 * r, 0, 0.2 * r, 0);
  hg.addColorStop(0, 'rgba(15,20,40,0.5)'); hg.addColorStop(1, 'rgba(15,20,40,0)');
  ctx.fillStyle = hg; ctx.fillRect(-1.3 * r, -1.4 * r, 1.6 * r, 2.8 * r);
  line(ctx, [[0.42 * r, -1.1 * r], [0.3 * r, 0.2 * r], [0.45 * r, 1.1 * r]], C.out, 2, 0.55);
  line(ctx, [[0.52 * r, -1.0 * r], [0.4 * r, 0.2 * r], [0.55 * r, 1.05 * r]], '#ffffff', 1.4, 0.35);
  // Gold brow band and cheek trim
  line(ctx, [[-1.2 * r, -0.42 * r], [0.2 * r, -0.5 * r], [1.2 * r, -0.42 * r]], C.out, 0.3 * r, 1, 'butt');
  line(ctx, [[-1.2 * r, -0.42 * r], [0.2 * r, -0.5 * r], [1.2 * r, -0.42 * r]], C.gold, 0.2 * r, 1, 'butt');
  line(ctx, [[-1.2 * r, 0.75 * r], [0.2 * r, 0.95 * r], [1.2 * r, 0.7 * r]], C.gold, 0.12 * r, 0.9, 'butt');
  // Breath holes
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = '#0a0e1e';
      ctx.beginPath(); ctx.arc(0.62 * r + j * 0.2 * r, 0.32 * r + i * 0.17 * r, 0.055 * r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  // Visor slit
  const slit = [[0.12 * r, -0.2 * r], [1.15 * r, -0.24 * r], [1.15 * r, -0.04 * r], [0.12 * r, 0.0 * r]];
  kit.polygonPath(ctx, slit);
  ctx.fillStyle = '#070a16'; ctx.fill();
  let glowA = 0.85, len = 1;
  if (ex === 'blink') glowA = 0.25;
  if (ex === 'fierce') { glowA = 1; len = 1.25; }
  if (ex === 'hurt') glowA = 0.35 + 0.5 * Math.abs(Math.sin(time * 0.9));
  if (ex === 'dizzy') glowA = 0.3 + 0.3 * Math.sin(time * 0.3);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, 0.85 * r, -0.11 * r, 0.75 * r * len, C.ice, 0.55 * glowA);
  ctx.restore();
  line(ctx, [[0.3 * r, -0.11 * r], [1.12 * r, -0.14 * r]], C.ice, 0.13 * r, glowA);
  line(ctx, [[0.55 * r, -0.12 * r], [1.0 * r, -0.14 * r]], C.iceCore, 0.06 * r, glowA);
  if (ex === 'fierce') {
    // Frost flare streaming from the visor
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    line(ctx, [[1.1 * r, -0.14 * r], [1.6 * r, -0.3 * r], [2.0 * r, -0.28 * r]], C.ice, 0.08 * r, 0.6);
    ctx.restore();
  }
  // Crest fin (gold-edged) holding the plume
  kit.blobPath(ctx, [[0.65 * r, -0.98 * r], [0.25 * r, -1.42 * r], [-0.55 * r, -1.38 * r], [-0.65 * r, -1.0 * r], [0.0 * r, -1.12 * r]], 0.4);
  goldFill(ctx, false, { x: 0, y: -1.2 * r, r: 0.6 * r, rot: rig.headAngle });
  rivet(ctx, -0.15 * r, -1.2 * r, 0.09 * r, false);
  rivet(ctx, -0.85 * r, 0.2 * r, 0.1 * r, false);
  // Sunset rim light on the back of the helm
  kit.rimLight(ctx, [[-0.55 * r, -1.0 * r], [-1.0 * r, -0.35 * r], [-0.98 * r, 0.45 * r]], C.warm, 2, 0.65);
  // Frost breath puffing from the visor now and then
  const bt = (time + (view.index || 0) * 53) % 150;
  if (info.state === 'idle' && bt < 40) {
    const k = bt / 40;
    ctx.save();
    ctx.globalAlpha = 0.18 * Math.sin(k * Math.PI);
    ctx.fillStyle = '#e8f8ff';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(1.2 * r + k * 0.7 * r + i * 0.22 * r, 0.25 * r - k * 0.4 * r - i * 0.1 * r, (0.07 + k * 0.1 + i * 0.03) * r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

// ── Arms: pauldron, rerebrace, couter, vambrace, gauntlet ───────────────────
function drawArm(ctx, a, info) {
  const { u, back, rig } = info;
  const S = a.shoulder, E = a.elbow, Hd = a.hand;
  const aU = angOf(S, E);
  const steel = bk(C.steel, back);
  // Padded sleeve
  kit.capsulePath(ctx, S.x, S.y, E.x, E.y, 6.4 * u, 5.4 * u);
  cloth(ctx, bk(C.navy, back), { x: S.x, y: S.y, r: 10 * u });
  // Rerebrace plate (lower upper-arm)
  const m1 = mid(S, E, 0.42);
  kit.capsulePath(ctx, m1.x, m1.y, E.x, E.y, 5.9 * u, 5.2 * u);
  metal(ctx, steel, { x: m1.x, y: m1.y, r: 9 * u });
  // Vambrace (forearm), flaring toward the wrist
  kit.capsulePath(ctx, E.x, E.y, Hd.x, Hd.y, 5.0 * u, 5.8 * u);
  metal(ctx, steel, { x: (E.x + Hd.x) / 2, y: (E.y + Hd.y) / 2, r: 11 * u });
  ctx.save();
  ctx.translate(E.x, E.y);
  ctx.rotate(-a.angle);
  const fl = Math.hypot(Hd.x - E.x, Hd.y - E.y);
  line(ctx, [[3.4 * u, 3 * u], [3.8 * u, fl - 6 * u]], '#ffffff', 1.3 * u, back ? 0.2 : 0.45);
  ctx.restore();
  // Couter (elbow cop) with a fan wing
  ctx.save();
  ctx.translate(E.x, E.y);
  ctx.rotate(-aU);
  kit.blobPath(ctx, [[-4.5 * u, -3 * u], [-9.5 * u, 1 * u], [-5 * u, 5 * u], [0, 4 * u]], 0.4);
  metal(ctx, shade(steel, -0.1), { r: 6 * u, rot: -aU, lw: 2.5 });
  ctx.restore();
  kit.circle(ctx, E.x, E.y, 4.6 * u, steel, { outline: C.out, lineWidth: 2.5, gloss: 0.45 });
  rivet(ctx, E.x, E.y, 1.2 * u, back);
  // Gauntlet
  ctx.save();
  ctx.translate(Hd.x, Hd.y);
  ctx.rotate(-a.angle);
  drawGauntlet(ctx, info, back);
  ctx.restore();
  // Pauldron (follows the upper arm partway)
  const pr = rig.lean + clamp(aU - rig.lean, -1.4, 2.4) * 0.4;
  ctx.save();
  ctx.translate(S.x, S.y);
  ctx.rotate(-pr);
  drawPauldron(ctx, info, back, -pr);
  ctx.restore();
}

function drawGauntlet(ctx, info, back) {
  const u = info.u;
  const steel = bk(C.steel, back);
  // Cuff flare
  kit.polygonPath(ctx, [[-5.6 * u, -7.5 * u], [5.6 * u, -7.5 * u], [7 * u, -2 * u], [-6.6 * u, -2 * u]]);
  metal(ctx, steel, { y: -5 * u, r: 6 * u, lw: 2.5 });
  line(ctx, [[-6.4 * u, -2.8 * u], [6.8 * u, -2.8 * u]], bk(C.gold, back), 1.4 * u, 1, 'butt');
  // Fist
  kit.roundRectPath(ctx, -5.6 * u, -3 * u, 11.4 * u, 10.6 * u, 3.2 * u);
  metal(ctx, shade(steel, -0.05), { y: 2 * u, r: 7 * u, lw: 2.5 });
  // Finger lames
  for (const yy of [1.6 * u, 4.4 * u]) line(ctx, [[-5 * u, yy], [5.2 * u, yy]], C.out, 1.4, 0.7);
  // Gold knuckle ridge
  kit.roundRectPath(ctx, -5.2 * u, 5.4 * u, 10.6 * u, 2.6 * u, 1.2 * u);
  goldFill(ctx, back, { y: 6.5 * u, r: 3 * u });
  // Thumb plate
  kit.blobPath(ctx, [[3.5 * u, -1.5 * u], [7.4 * u, 0.5 * u], [6.6 * u, 4.5 * u], [3.8 * u, 3.5 * u]], 0.4);
  metal(ctx, steel, { x: 5 * u, y: 1.5 * u, r: 4 * u, lw: 2 });
}

function drawPauldron(ctx, info, back, rot) {
  const u = info.u;
  const steel = bk(C.steel, back);
  // Lower lames first, the dome on top.
  for (let i = 2; i >= 1; i--) {
    const y = i * 4.2 * u, s = 1 - i * 0.07;
    kit.blobPath(ctx, [[-11 * s * u, y - 1 * u], [-6 * u, y - 5 * u], [6 * u, y - 5 * u], [12 * s * u, y - 1.5 * u], [11 * s * u, y + 2.8 * u], [0, y + 4.2 * u], [-10 * s * u, y + 2.8 * u]], 0.4);
    metal(ctx, shade(steel, -0.06 * i), { y, r: 9 * u, rot, gloss: 0.15 });
    line(ctx, [[-9.5 * s * u, y + 2.2 * u], [0, y + 3.5 * u], [10 * s * u, y + 2.1 * u]], bk(C.gold, back), 1.1 * u, 0.9);
  }
  const dome = [[-12 * u, 2.5 * u], [-11 * u, -5 * u], [-3 * u, -10.5 * u], [6 * u, -10 * u], [12.5 * u, -4.5 * u], [13 * u, 2 * u], [6 * u, 4.8 * u], [-4 * u, 5 * u]];
  kit.blobPath(ctx, dome, 0.45);
  metal(ctx, bk(shade(C.royal, 0.06), back), { y: -3 * u, r: 13 * u, rot, gloss: 0.5 });
  ctx.save();
  kit.blobPath(ctx, dome, 0.45);
  ctx.clip();
  line(ctx, [[-12 * u, 1.5 * u], [-3 * u, 4.2 * u], [6 * u, 3.8 * u], [13 * u, 1 * u]], bk(C.gold, back), 2.2 * u, 1);
  line(ctx, [[-8 * u, -6.5 * u], [0, -8.6 * u], [8 * u, -6.5 * u]], '#ffffff', 1.4 * u, back ? 0.15 : 0.4);
  ctx.restore();
  rivet(ctx, -7 * u, 0.5 * u, 1.2 * u, back);
  rivet(ctx, 8 * u, 0 * u, 1.2 * u, back);
  // Ice crystals growing out of the pauldron
  if (!back) {
    crystal(ctx, -2 * u, -9 * u, 9 * u, 2.4 * u, Math.PI - 0.5, { lw: 1.6 });
    crystal(ctx, -6 * u, -7 * u, 6 * u, 1.8 * u, Math.PI + 0.3 - 1.1, { lw: 1.4 });
  } else {
    crystal(ctx, -2 * u, -9 * u, 8 * u, 2.2 * u, Math.PI - 0.5, { lw: 1.6, dim: 0.3 });
  }
}

// ── Legs: cuisse, poleyn, greave, sabaton ───────────────────────────────────
function drawLeg(ctx, l, info) {
  const { u, back } = info;
  const Hp = l.hip, K = l.knee, F = l.foot;
  const steel = bk(C.steel, back);
  const thighA = angOf(Hp, K);
  // Padded thigh
  kit.capsulePath(ctx, Hp.x, Hp.y, K.x, K.y, 8.2 * u, 6.8 * u);
  cloth(ctx, bk(C.navy, back), { x: Hp.x, y: Hp.y, r: 12 * u });
  // Cuisse plate
  const c0 = mid(Hp, K, 0.25);
  kit.capsulePath(ctx, c0.x, c0.y, K.x, K.y, 7.4 * u, 6.0 * u);
  metal(ctx, steel, { x: c0.x, y: c0.y, r: 12 * u });
  // Greave
  kit.capsulePath(ctx, K.x, K.y, F.x, F.y, 6.6 * u, 5.4 * u);
  metal(ctx, steel, { x: (K.x + F.x) / 2, y: (K.y + F.y) / 2, r: 13 * u });
  ctx.save();
  ctx.translate(K.x, K.y);
  ctx.rotate(-l.angle);
  const sl = Math.hypot(F.x - K.x, F.y - K.y);
  line(ctx, [[4.2 * u, 4 * u], [3.6 * u, sl - 4 * u]], bk(C.gold, back), 1.5 * u, 0.95);
  line(ctx, [[-3.5 * u, 5 * u], [-3 * u, sl - 6 * u]], '#ffffff', 1.1 * u, back ? 0.12 : 0.3);
  ctx.restore();
  // Poleyn (knee cop) with side wing
  ctx.save();
  ctx.translate(K.x, K.y);
  ctx.rotate(-thighA);
  kit.blobPath(ctx, [[-2 * u, -3 * u], [-8.5 * u, 0], [-3 * u, 4 * u]], 0.4);
  metal(ctx, shade(steel, -0.12), { r: 6 * u, rot: -thighA, lw: 2.5 });
  ctx.restore();
  kit.circle(ctx, K.x, K.y, 5.6 * u, steel, { outline: C.out, lineWidth: 2.5, gloss: 0.5 });
  rivet(ctx, K.x + 0.6 * u, K.y, 1.3 * u, back);
  // Sabaton
  ctx.save();
  ctx.translate(F.x, F.y);
  ctx.rotate(-l.angle);
  drawSabaton(ctx, info, back);
  ctx.restore();
  if (!back) drawWaistFront(ctx, info, thighA);
}

function drawSabaton(ctx, info, back) {
  const u = info.u, fr = info.rig.footR;
  const steel = bk(C.steel, back);
  const shape = [[-7 * u, -7.5 * u], [5 * u, -7.5 * u], [9 * u, -3.5 * u], [15 * u, fr - 3 * u], [15.5 * u, fr], [-8 * u, fr], [-8.5 * u, -2 * u]];
  kit.blobPath(ctx, shape, 0.25);
  metal(ctx, steel, { x: 3 * u, y: -2 * u, r: 11 * u, gloss: 0.35 });
  ctx.save();
  kit.blobPath(ctx, shape, 0.25);
  ctx.clip();
  for (const xx of [3 * u, 7 * u]) line(ctx, [[xx, -8 * u], [xx + 2.5 * u, fr]], C.out, 1.6, 0.6);
  // Gold toe cap + dark sole
  ctx.fillStyle = bk(C.gold, back);
  ctx.beginPath(); ctx.moveTo(10.5 * u, -6 * u); ctx.lineTo(18 * u, -6 * u); ctx.lineTo(18 * u, fr + 2); ctx.lineTo(11.5 * u, fr + 2); ctx.closePath(); ctx.fill();
  line(ctx, [[10.5 * u, -6 * u], [11.5 * u, fr]], C.out, 1.6, 0.7);
  ctx.fillStyle = '#1a1f33';
  ctx.fillRect(-10 * u, fr - 1.8 * u, 30 * u, 4 * u);
  ctx.restore();
  // Cuff at the ankle
  kit.roundRectPath(ctx, -7.6 * u, -9.5 * u, 14 * u, 3.4 * u, 1.4 * u);
  goldFill(ctx, back, { y: -8 * u, r: 3 * u });
}

// ── Hammer: the Glacier Maul ────────────────────────────────────────────────
function hammerWeapon() {
  const fn = (ctx, info) => { usePalette(info.palette); drawHammer(ctx, info); };
  // The engine's swing trail reads `weapon.length` (in rig units) to find the tip;
  // a function's own .length is its argument count, so set it explicitly.
  Object.defineProperty(fn, 'length', { value: HAMMER_LEN });
  return fn;
}

function drawHammer(ctx, info) {
  const { u, time, state, view } = info;
  const Lh = HAMMER_LEN * u;
  const attacking = state === 'attack';
  const hot = attacking || view.charging;
  // Frost aura
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, Lh, 0, (hot ? 34 : 24) * u, C.ice, (hot ? 0.55 : 0.28) + 0.06 * Math.sin(time * 0.15));
  ctx.restore();
  // Haft
  kit.capsulePath(ctx, -9 * u, 0, Lh - 4 * u, 0, 2.5 * u, 2.5 * u);
  const hg = ctx.createLinearGradient(0, -2.5 * u, 0, 2.5 * u);
  hg.addColorStop(0, '#6d7fa6'); hg.addColorStop(0.35, '#33415f'); hg.addColorStop(1, '#141a2e');
  ctx.lineWidth = 3; ctx.strokeStyle = C.out; ctx.stroke();
  ctx.fillStyle = hg; ctx.fill();
  // Leather grip wraps
  for (let x = -6; x < 12; x += 3) line(ctx, [[x * u, -2.4 * u], [(x + 2) * u, 2.4 * u]], '#5a3a26', 1.4 * u, 0.9);
  // Gold collars
  for (const x of [-9, 14, HAMMER_LEN - 16]) {
    kit.roundRectPath(ctx, (x - 1.5) * u, -3.6 * u, 3 * u, 7.2 * u, 1 * u);
    goldFill(ctx, false, { x: x * u, r: 4 * u, rot: 0 });
  }
  // Pommel gem
  kit.polygonPath(ctx, [[-14 * u, 0], [-10.5 * u, -3 * u], [-8.5 * u, 0], [-10.5 * u, 3 * u]]);
  ctx.fillStyle = C.ice; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#123a6a'; ctx.stroke();
  // Langets running up into the head
  kit.polygonPath(ctx, [[Lh - 18 * u, -3.4 * u], [Lh - 6 * u, -4 * u], [Lh - 6 * u, 4 * u], [Lh - 18 * u, 3.4 * u]]);
  metal(ctx, C.steel, { x: Lh - 12 * u, r: 6 * u, lw: 2.5 });
  // Head: maul block with two flat faces
  const x0 = Lh - 9 * u, x1 = Lh + 9 * u, hy = 15 * u, b = 3 * u;
  const block = [[x0 + b, -hy], [x1 - b, -hy], [x1, -hy + b], [x1, hy - b], [x1 - b, hy], [x0 + b, hy], [x0, hy - b], [x0, -hy + b]];
  kit.polygonPath(ctx, block);
  metal(ctx, C.steel, { x: Lh, r: 16 * u, gloss: 0.4 });
  ctx.save();
  kit.polygonPath(ctx, block); ctx.clip();
  // Bevel shading and gold bands near both faces
  ctx.fillStyle = 'rgba(15,20,40,0.35)'; ctx.fillRect(x0, -hy, 18 * u, 4 * u); ctx.fillRect(x1 - 4 * u, -hy, 4 * u, 2 * hy);
  for (const s of [-1, 1]) {
    ctx.fillStyle = C.gold;
    ctx.fillRect(x0 - 1, s * 9.5 * u - 1.6 * u, 18 * u + 2, 3.2 * u);
    line(ctx, [[x0, s * 9.5 * u - 1.6 * u], [x1, s * 9.5 * u - 1.6 * u]], C.out, 1.2, 0.8);
    line(ctx, [[x0, s * 9.5 * u + 1.6 * u], [x1, s * 9.5 * u + 1.6 * u]], C.out, 1.2, 0.8);
  }
  ctx.restore();
  // Striking faces (slightly wider plates)
  for (const s of [-1, 1]) {
    kit.roundRectPath(ctx, x0 - 1.5 * u, s > 0 ? hy - 1 * u : -hy - 3 * u, 21 * u, 4 * u, 1.2 * u);
    metal(ctx, shade(C.steel, -0.1), { x: Lh, y: s * hy, r: 8 * u, lw: 2.5, gloss: 0.5 });
  }
  // Glowing rune on the side of the head
  const pulse = 0.7 + 0.3 * Math.sin(time * 0.12) + (hot ? 0.3 : 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, Lh, 0, 9 * u, C.ice, 0.5 * pulse);
  ctx.restore();
  sigil(ctx, Lh, 0, 4.6 * u, '#0b2a4a', 2.6);
  sigil(ctx, Lh, 0, 4.6 * u, rgba(C.iceCore, clamp(pulse, 0, 1)), 1.4);
  // Ice crust: crystals growing off the head and a crown spike
  crystal(ctx, x1, 0, 14 * u, 3.6 * u, Math.PI / 2);
  crystal(ctx, x1 - 1 * u, -hy + 4 * u, 8 * u, 2.4 * u, Math.PI / 2 + 0.7);
  crystal(ctx, x1 - 1 * u, hy - 4 * u, 8 * u, 2.4 * u, Math.PI / 2 - 0.7);
  crystal(ctx, x0 + 4 * u, -hy - 1 * u, 7 * u, 2 * u, Math.PI - 0.3);
  crystal(ctx, x0 + 4 * u, hy + 1 * u, 7 * u, 2 * u, 0.3);
  // Warm rim along the back edge of the head
  kit.rimLight(ctx, [[x0 + 1 * u, -hy + 3 * u], [x0 + 1 * u, hy - 3 * u]], C.warm, 1.6, 0.5);
  // Frost motes orbiting the head (+ crackling arcs while swinging)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const n = hot ? 7 : 4;
  for (let i = 0; i < n; i++) {
    const ph = (time * 0.025 + i * 0.37) % 1;
    const a = i * 2.1 + time * 0.03;
    const rr = (14 + ph * 14) * u;
    sparkle(ctx, Lh + Math.cos(a) * rr, Math.sin(a) * rr, (2.5 + (1 - ph) * 2.5) * u, i % 2 ? C.iceCore : C.ice, (1 - ph) * 0.9);
  }
  if (hot) {
    const rnd = kit.seeded(Math.floor(time / 3) * 7 + 1);
    for (let k = 0; k < 2; k++) {
      let px = Lh + (rnd() - 0.5) * 10 * u, py = (rnd() - 0.5) * 24 * u;
      const pts = [[px, py]];
      const a = rnd() * Math.PI * 2;
      for (let j = 0; j < 4; j++) { px += Math.cos(a) * 5 * u + (rnd() - 0.5) * 5 * u; py += Math.sin(a) * 5 * u + (rnd() - 0.5) * 5 * u; pts.push([px, py]); }
      line(ctx, pts, C.ice, 1.6 * u, 0.85);
      line(ctx, pts, '#ffffff', 0.6 * u, 0.9);
    }
  }
  ctx.restore();
}

// ── Move effects drawn in front of the body ─────────────────────────────────
function iceBurst(ctx, x, y, k, size, seed, spread = 1) {
  if (k <= 0) return;
  const rnd = kit.seeded(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, x, y - 6, size * 1.4, C.ice, 0.55 * k);
  ctx.restore();
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    const h = size * (0.6 + rnd() * 0.6) * (1 - Math.abs(t) * 0.7) * k;
    crystal(ctx, x + t * size * 1.6 * spread, y + 3, h, h * 0.24, Math.PI + t * 0.9, { lw: 2, alpha: Math.min(1, k * 1.5) });
  }
}

function drawFrontFx(ctx, info) {
  const v = info.view, m = v.move;
  const u = info.u;
  ctx.save();
  toFighterSpace(ctx, info);
  if (info.state === 'attack' && m) {
    const f = v.moveFrame;
    const hb = m.hitboxes;
    // rise fast, fade over ~12 frames
    const burst = (s, e, hold = 12) => (f < s ? 0 : f <= e ? moveK(f, s - 1, s + 2) : 1 - moveK(f, e, e + hold));
    switch (m.slot) {
      case 'downSmash': {
        iceBurst(ctx, hb[0].x, 0, burst(hb[0].start, hb[0].end), 34 * u, 3);
        iceBurst(ctx, hb[1].x, 0, burst(hb[1].start, hb[1].end), 30 * u, 9);
        break;
      }
      case 'sideSmash':
        iceBurst(ctx, hb[0].x + 10, 0, burst(hb[0].start, hb[0].end, 14) * 0.8, 26 * u, 5, 0.8);
        break;
      case 'downSpecial': {
        if (v.grounded !== false) {
          const k = burst(hb[1].start, hb[1].end);
          iceBurst(ctx, hb[1].x - 8, 0, k, 28 * u, 11, 0.8);
          iceBurst(ctx, hb[2].x + 8, 0, k, 26 * u, 13, 0.8);
        }
        break;
      }
      case 'upSpecial': {
        // An ice pillar shoves Bastion skyward.
        const k = f < 4 ? 0 : f <= 10 ? moveK(f, 3, 7) : 1 - moveK(f, 10, 20);
        if (k > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          kit.glow(ctx, 0, -10, 40 * u, C.ice, 0.5 * k);
          ctx.restore();
          for (let i = -2; i <= 2; i++) crystal(ctx, i * 8 * u, 18 * u, (30 - Math.abs(i) * 7) * u * k, 4.5 * u, Math.PI + i * 0.25, { alpha: k });
        }
        break;
      }
      case 'upSmash': {
        const k = burst(hb[0].start, hb[0].end, 14);
        if (k > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          kit.glow(ctx, hb[0].x, hb[0].y, 50 * u, '#b8f6ff', 0.5 * k);
          for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + (i - 2) * 0.35;
            line(ctx, [[hb[0].x, hb[0].y], [hb[0].x + Math.cos(a) * 46 * u * k, hb[0].y + Math.sin(a) * 46 * u * k]], C.ice, 3 * u, 0.6 * k);
          }
          ctx.restore();
        }
        break;
      }
      case 'sideSpecial': {
        // Aegis: an ice ward in front while intangible.
        const iv = m.intangible;
        if (iv) {
          const k = f < iv[0] - 1 ? 0 : f <= iv[1] ? moveK(f, iv[0] - 1, iv[0] + 2) : 1 - moveK(f, iv[1], iv[1] + 8);
          if (k > 0) drawAegis(ctx, 54 * u, -58 * u, k, info.time, u);
        }
        break;
      }
      default: break;
    }
  }
  if (v.charging) {
    // Frost gathering toward the hammer head.
    const a = info.rig.armF;
    const hx = (a.hand.x + Math.sin(a.angle) * HAMMER_LEN * u) * info.pose.sx;
    const hy = (a.hand.y + Math.cos(a.angle) * HAMMER_LEN * u) * info.pose.sy;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const ph = (info.time * 0.05 + i / 8) % 1;
      const ang = i * 0.8 + info.time * 0.02;
      const rr = (1 - ph) * 50 * u;
      sparkle(ctx, hx + Math.cos(ang) * rr, hy + Math.sin(ang) * rr, 4 * u, C.iceCore, ph);
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawAegis(ctx, x, y, k, time, u) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = k;
  const R = 36 * u;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, 0, 0, R * 0.9, C.ice, 0.35);
  ctx.restore();
  // Hexagonal crystal ward, seen edge-on (squashed in x).
  ctx.scale(0.45, 1);
  kit.polygonPath(ctx, Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3) * R, Math.sin(i * Math.PI / 3) * R]));
  const g = ctx.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, rgba(C.iceCore, 0.75)); g.addColorStop(0.5, rgba(C.ice, 0.45)); g.addColorStop(1, rgba(C.iceDeep, 0.6));
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.stroke();
  sigil(ctx, 0, 0, R * 0.6, rgba('#ffffff', 0.85), 3);
  ctx.restore();
}

// ── Projectiles: Frost Lance shard and Hoarfrost Quake ground wave ──────────
function drawProjectile(ctx, p) {
  const t = p.t, r = p.r;
  const fade = clamp((p.life || 1) / 8, 0, 1);
  ctx.globalAlpha = fade;
  if (p.style === 'wave') {
    // Ice spikes erupting along the ground (ground is ~20px below the centre).
    const g = 20;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, 0, g - 8, r * 2.4, C.ice, 0.5);
    for (let i = 1; i <= 4; i++) kit.glow(ctx, -i * 12, g - 4, r * (1.2 - i * 0.2), C.ice, 0.25 - i * 0.05);
    ctx.restore();
    const rnd = kit.seeded(Math.floor(t / 4) + 3);
    const spikes = [[-22, 0.45], [-12, 0.7], [-2, 1.0], [8, 0.8], [15, 0.5]];
    for (const [dx, s] of spikes) {
      const h = r * 2.6 * s * (0.85 + rnd() * 0.3);
      crystal(ctx, dx, g, h, h * 0.22, Math.PI + dx * 0.012, { lw: 2 });
    }
    // Mist
    ctx.fillStyle = 'rgba(235,250,255,0.5)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(-26 + i * 14 + Math.sin(t * 0.2 + i) * 3, g - 2, 6 + (i % 2) * 3, 0, Math.PI * 2); ctx.fill();
    }
    return;
  }
  // Frost Lance: a spinning-faceted ice javelin with a frost wake.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 1; i <= 6; i++) kit.glow(ctx, -i * r * 0.9, Math.sin(t * 0.4 + i) * 2, r * (1.5 - i * 0.18), C.ice, 0.32 - i * 0.04);
  kit.glow(ctx, 0, 0, r * 2.4, C.ice, 0.45);
  for (let i = 0; i < 4; i++) {
    const ph = (t * 0.08 + i / 4) % 1;
    sparkle(ctx, -ph * r * 5, Math.sin(i * 2.3 + t * 0.1) * r * 0.9, r * 0.35 * (1 - ph), '#ffffff', 1 - ph);
  }
  ctx.restore();
  const wob = Math.sin(t * 0.5) * 0.1;
  ctx.rotate(wob);
  const L = r * 2.0, W = r * 0.62;
  const tip = [L, 0], tail = [-L * 0.9, 0], top = [-L * 0.1, -W], bot = [-L * 0.1, W];
  ctx.beginPath(); ctx.moveTo(...tail); ctx.lineTo(...top); ctx.lineTo(...tip); ctx.lineTo(...bot); ctx.closePath();
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#123a6a'; ctx.stroke();
  ctx.fillStyle = C.ice; ctx.fill();
  ctx.beginPath(); ctx.moveTo(...tail); ctx.lineTo(...top); ctx.lineTo(...tip); ctx.closePath();
  ctx.fillStyle = C.iceCore; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-L * 0.1, 0); ctx.lineTo(...bot); ctx.lineTo(...tip); ctx.closePath();
  ctx.fillStyle = rgba(C.iceDeep, 0.8); ctx.fill();
  line(ctx, [[-L * 0.6, 0], [L * 0.85, 0]], '#ffffff', 1.5, 0.9);
  // Side shards
  crystal(ctx, -L * 0.35, -W * 0.6, r * 0.9, r * 0.22, Math.PI * 0.8, { lw: 1.6 });
  crystal(ctx, -L * 0.35, W * 0.6, r * 0.9, r * 0.22, Math.PI * 0.2, { lw: 1.6 });
}
