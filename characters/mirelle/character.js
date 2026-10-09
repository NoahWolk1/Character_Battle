// ─────────────────────────────────────────────────────────────────────────────
// MIRELLE, the Tide-Witch
//
// A floaty zoner: lobbed water orbs, pearl volleys and rolling waves keep foes
// at staff's length, while long coral-staff swings punish anyone who wades in.
// Slow, showy smashes (an erupting geyser!) reward good reads.
//
// Coordinates: x = pixels in FRONT of you (negative = behind), y = pixels
// relative to your FEET (negative = up). Time is in frames (60 per second).
// Hitboxes are placed on the staff tip/shaft for each strike pose (64-unit staff).
// All drawing lives in ./art.js.
// ─────────────────────────────────────────────────────────────────────────────
import { art } from './art.js';

export default {
  id: 'mirelle',
  name: 'Mirelle',
  author: 'Noah',
  description: 'A tide-witch who bends the sea to her coral staff. Floaty zoner: lob water orbs, spray pearls, ride a waterspout home and finish with an erupting geyser.',

  stats: {
    weight: 86,           // medium-light
    runSpeed: 6.0,
    airSpeed: 4.7,
    jumpHeight: 15,
    doubleJumpHeight: 15,
    airJumps: 2,          // floaty: two mid-air jumps
    gravity: 0.54,
    fallSpeed: 9.4,
    width: 50,
    height: 96,
  },

  moves: {
    // ── Ground normals: staff swings with long reach, modest damage ───────
    jab: {
      name: 'Coral Tap', duration: 20, effect: 'water',
      pose: {
        windup: { lean: -0.05, fU: 0.5, fL: 1.7, bU: 0.4, bL: 1.2, flU: 0.25, blU: -0.25 },
        strike: { lean: 0.12, fU: 1.15, fL: 0.3, bU: -0.3, bL: 0.8, flU: 0.35, blU: -0.3, bx: 3 },
      },
      hitboxes: [
        { start: 5, end: 7, x: 80, y: -58, r: 13, damage: 3, angle: 45, knockback: 14, growth: 25 },
        { start: 5, end: 7, x: 50, y: -58, r: 12, damage: 2.5, angle: 50, knockback: 12, growth: 25 },
      ],
    },
    side: {
      name: 'Crescent Sweep', duration: 30, effect: 'water',
      pose: {
        windup: { lean: -0.2, fU: 2.7, fL: 0.3, bU: -0.5, bL: 0.6, flU: 0.3, blU: -0.3 },
        strike: { lean: 0.3, fU: 1.3, fL: 0.05, bU: -0.9, bL: 0.5, flU: 0.55, flL: -0.4, blU: -0.45, bx: 6 },
      },
      hitboxes: [
        { start: 9, end: 12, x: 88, y: -65, r: 17, damage: 9, angle: 35, knockback: 22, growth: 82 },
        { start: 9, end: 12, x: 55, y: -62, r: 14, damage: 7, angle: 40, knockback: 20, growth: 72 },
      ],
    },
    up: {
      name: 'Foam Arc', duration: 30, effect: 'water',
      pose: {
        windup: { lean: 0.25, fU: 0.6, fL: 1.2, bU: -0.3, flU: 0.4, flL: -0.6, blU: -0.3, by: 4 },
        strike: { lean: -0.2, fU: 3.05, fL: 0.1, bU: -0.6, bL: 0.5, flU: 0.15, blU: -0.2, sy: 1.04 },
      },
      hitboxes: [
        { start: 8, end: 12, x: 16, y: -142, r: 18, damage: 7, angle: 85, knockback: 24, growth: 84 },
        { start: 8, end: 12, x: 10, y: -110, r: 16, damage: 6, angle: 88, knockback: 22, growth: 76 },
      ],
    },
    down: {
      name: 'Undertow', duration: 26, effect: 'water',
      pose: {
        windup: { lean: 0.45, by: 18, fU: 0.1, fL: 1.4, bU: 0.3, bL: 1.2, flU: 1.0, flL: -2.0, blU: -0.3, blL: -1.8, head: 0.2 },
        strike: { lean: 0.55, by: 22, fU: 0.75, fL: 0.05, bU: -0.6, bL: 0.6, flU: 1.1, flL: -2.1, blU: -0.3, blL: -1.9, head: 0.15 },
      },
      hitboxes: [
        { start: 7, end: 9, x: 84, y: -20, r: 15, damage: 6, angle: 20, knockback: 26, growth: 45 },
        { start: 7, end: 9, x: 52, y: -28, r: 13, damage: 5, angle: 25, knockback: 24, growth: 40 },
      ],
    },

    // ── Smashes: slow but stylish ─────────────────────────────────────────
    sideSmash: {
      name: 'Breaker Wave', duration: 54, anim: 'overhead', effect: 'water',
      hitboxes: [
        { start: 19, end: 23, x: 97, y: -54, r: 25, damage: 16, angle: 36, knockback: 34, growth: 100 },
        { start: 19, end: 23, x: 62, y: -55, r: 18, damage: 13, angle: 40, knockback: 30, growth: 92 },
      ],
    },
    upSmash: {
      name: 'Erupting Geyser', duration: 58, effect: 'water',
      pose: {
        windup: { lean: -0.15, fU: 2.9, fL: 0.3, bU: 2.6, bL: 0.4, by: -2, sy: 1.05, sx: 0.96 },
        strike: { lean: 0.35, fU: 0.45, fL: 0.05, bU: 0.5, bL: 0.6, flU: 0.5, flL: -0.6, blU: -0.4, by: 6 },
      },
      hitboxes: [
        // the burst pops them up into the column…
        { start: 17, end: 19, group: 0, x: 72, y: -30, r: 30, damage: 4, angle: 90, knockback: 45, growth: 10 },
        // …which then launches them skyward
        { start: 20, end: 27, group: 1, x: 72, y: -112, r: 32, damage: 13, angle: 88, knockback: 36, growth: 106 },
      ],
    },
    downSmash: {
      name: 'Riptide Ring', duration: 50, anim: 'slam', effect: 'water',
      hitboxes: [
        { start: 16, end: 19, x: 70, y: -16, r: 28, damage: 14, angle: 30, knockback: 30, growth: 94 },
        { start: 16, end: 19, x: -60, y: -16, r: 28, damage: 13, angle: 150, knockback: 30, growth: 92 },
      ],
    },

    // ── Aerials ───────────────────────────────────────────────────────────
    nair: {
      name: 'Whirlpool', duration: 32, anim: 'spin', effect: 'water', landingLag: 8,
      hitboxes: [
        // a whirlpool around her body, plus the staff tip sweeping a full circle
        { start: 6, end: 11, group: 0, x: 0, y: -46, r: 32, damage: 5, angle: 60, knockback: 18, growth: 30 },
        { start: 6, end: 7, group: 0, x: 78, y: -54, r: 18, damage: 5, angle: 60, knockback: 18, growth: 30 },
        { start: 8, end: 9, group: 0, x: 34, y: 16, r: 18, damage: 5, angle: 60, knockback: 18, growth: 30 },
        { start: 10, end: 11, group: 0, x: -50, y: 10, r: 18, damage: 5, angle: 60, knockback: 18, growth: 30 },
        { start: 12, end: 17, group: 1, x: 0, y: -46, r: 32, damage: 6, angle: 42, knockback: 22, growth: 74 },
        { start: 12, end: 13, group: 1, x: -76, y: -70, r: 18, damage: 6, angle: 42, knockback: 22, growth: 74 },
        { start: 14, end: 15, group: 1, x: -12, y: -128, r: 18, damage: 6, angle: 42, knockback: 22, growth: 74 },
        { start: 16, end: 17, group: 1, x: 66, y: -92, r: 18, damage: 6, angle: 42, knockback: 22, growth: 74 },
      ],
    },
    fair: {
      name: 'Moon Crescent', duration: 32, effect: 'water', landingLag: 10,
      pose: {
        windup: { lean: -0.2, fU: 2.7, fL: 0.4, bU: -0.6, bL: 0.6, flU: 0.8, flL: -1.4, blU: 0.1, blL: -1.2 },
        strike: { lean: 0.2, fU: 1.25, fL: 0.05, bU: -1.0, bL: 0.5, flU: 0.7, flL: -1.2, blU: -0.1, blL: -1.0 },
      },
      hitboxes: [
        { start: 8, end: 11, x: 82, y: -58, r: 18, damage: 10, angle: 40, knockback: 24, growth: 88 },
        { start: 8, end: 11, x: 50, y: -60, r: 15, damage: 8, angle: 45, knockback: 22, growth: 80 },
      ],
    },
    bair: {
      name: 'Backwash', duration: 32, effect: 'water', landingLag: 12,
      pose: {
        windup: { lean: -0.1, fU: 0.9, fL: 1.6, bU: -0.4, bL: 0.6, flU: 0.6, flL: -1.2, blU: -0.2, blL: -1.0 },
        strike: { lean: 0.35, fU: -1.95, fL: 0.0, bU: 0.9, bL: 0.5, head: -0.3, flU: 0.5, flL: -1.0, blU: -0.3, blL: -0.8 },
        limb: 'frontHand',
      },
      hitboxes: [
        { start: 9, end: 12, x: -66, y: -54, r: 18, damage: 12, angle: 145, knockback: 30, growth: 98 },
        { start: 9, end: 12, x: -40, y: -57, r: 15, damage: 9, angle: 145, knockback: 24, growth: 84 },
      ],
    },
    uair: {
      name: 'Spindrift', duration: 30, effect: 'water', landingLag: 8,
      pose: {
        windup: { lean: 0.15, fU: 1.2, fL: 0.9, bU: -0.6, flU: 0.6, flL: -1.2, blU: 0.0, blL: -1.0 },
        strike: { lean: -0.25, fU: 3.1, fL: 0.05, bU: -0.8, bL: 0.5, flU: 0.5, flL: -1.0, blU: 0.1, blL: -1.2 },
      },
      hitboxes: [
        { start: 7, end: 11, x: 19, y: -138, r: 20, damage: 8, angle: 86, knockback: 24, growth: 86 },
        { start: 7, end: 11, x: 12, y: -108, r: 16, damage: 6, angle: 88, knockback: 22, growth: 76 },
      ],
    },
    dair: {
      name: 'Anchor Drop', duration: 40, effect: 'water', landingLag: 16,
      pose: {
        windup: { fU: 2.6, fL: 0.3, bU: 2.4, bL: 0.3, by: -8, flU: 1.0, flL: -1.8, blU: 0.7, blL: -1.6 },
        strike: { lean: 0.05, fU: 0.15, fL: 0.0, bU: -0.4, bL: 0.6, flU: 0.4, flL: -1.3, blU: -0.2, blL: -1.0, by: -6 },
      },
      hitboxes: [
        { start: 13, end: 16, x: 24, y: 4, r: 17, damage: 11, angle: 275, knockback: 18, growth: 70 },
        { start: 13, end: 20, x: 12, y: -18, r: 14, damage: 7, angle: 70, knockback: 20, growth: 60 },
      ],
    },

    // ── Specials: the sea answers ─────────────────────────────────────────
    neutralSpecial: {
      name: 'Tide Orb', duration: 42, anim: 'cast', effect: 'water',
      projectiles: [
        { start: 16, x: 88, y: -78, vx: 6.5, vy: -2.2, gravity: 0.07, life: 95, r: 15, damage: 8, angle: 40, knockback: 22, growth: 52, style: 'tideorb' },
      ],
    },
    sideSpecial: {
      name: 'Pearl Spray', duration: 44, anim: 'thrust', effect: 'water',
      projectiles: [
        { start: 14, x: 92, y: -80, vx: 9.5, vy: -3.6, gravity: 0.16, life: 55, r: 8, damage: 3, angle: 40, knockback: 12, growth: 30, style: 'pearl' },
        { start: 14, x: 92, y: -78, vx: 10, vy: -1.6, gravity: 0.16, life: 55, r: 8, damage: 3, angle: 40, knockback: 12, growth: 30, style: 'pearl' },
        { start: 14, x: 92, y: -76, vx: 10.5, vy: 0.4, gravity: 0.16, life: 55, r: 8, damage: 3, angle: 40, knockback: 12, growth: 30, style: 'pearl' },
      ],
    },
    upSpecial: {
      name: 'Waterspout', duration: 44, anim: 'rise', effect: 'water',
      velocity: [{ start: 6, end: 19, vx: 1.8, vy: -11 }],
      hitboxes: [
        { start: 6, end: 11, group: 0, x: 0, y: -34, r: 34, damage: 4, angle: 85, knockback: 30, growth: 25 },
        { start: 15, end: 19, group: 1, x: 6, y: -96, r: 30, damage: 7, angle: 84, knockback: 30, growth: 70 },
      ],
    },
    downSpecial: {
      name: 'Bubble Ward', duration: 48, effect: 'water',
      pose: {
        windup: { lean: -0.1, fU: 1.6, fL: 1.2, bU: 1.4, bL: 1.4, by: 6, sy: 0.95 },
        strike: { lean: -0.05, fU: 2.7, fL: 0.2, bU: 2.1, bL: 0.6, flU: 0.25, blU: -0.25, by: -2, sy: 1.04 },
        limb: 'body',
      },
      hitboxes: [
        { start: 9, end: 15, x: 0, y: -48, r: 40, damage: 6, angle: 60, knockback: 34, growth: 40 },
      ],
      projectiles: [
        { start: 18, x: 32, y: -20, vx: 5.5, vy: 0, life: 48, r: 17, damage: 5, angle: 55, knockback: 20, growth: 40, style: 'tidewave' },
        { start: 18, x: -32, y: -20, vx: -5.5, vy: 0, life: 48, r: 17, damage: 5, angle: 55, knockback: 20, growth: 40, style: 'tidewave' },
      ],
    },
  },

  art,
};
