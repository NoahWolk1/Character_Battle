// PEBBLE — a very small, very stubborn river stone (spec §10.3 #11: minimum body).
// The default hurtbox is a 40×40 rect = 1600 px², the smallest legal area, which
// costs 25 of the 52 stat points. The stats below deliberately ask for more than
// the remaining 27 so the validator's squeeze has to run (W1xx notes expected).
// Exercises: area pricing at the floor, stat squeeze, small-body reach, crouch set
// at the minimum, a skipping-stone special that bounces off the floor.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'pebble',
  name: 'Pebble',
  author: 'ARCH2 (test archetype)',
  description: 'A tiny river stone with a lot of nerve. Hard to hit, easy to launch. Skips across the stage like it was thrown by a pro.',
  archetype: 'rushdown',

  body: {
    collider: { w: 40, h: 40 },
    hurtboxes: {
      default: [{ shape: 'rect', x: 0, y: -20, w: 40, h: 40 }],      // exactly 1600 px²
      crouch: [{ shape: 'rect', x: 0, y: -16, w: 50, h: 32 }],       // flatter, same area
    },
  },

  // Asks for ~39 paid points; only 27 are left after the 25-point body.
  stats: { weight: 74, runSpeed: 7.8, airSpeed: 5.2, jumpHeight: 16, doubleJumpHeight: 15, airJumps: 2, gravity: 0.72, fallSpeed: 12.5 },

  hitboxes: {
    chip: { damage: 2, angle: 70, knockback: 8, growth: 6, effect: 'rock' },
  },

  entities: {
    grit: {                                                   // a flicked bit of gravel
      kind: 'projectile', shape: { shape: 'circle', r: 6 }, life: 50, maxAlive: 3,
      motion: { type: 'ballistic', gravity: 0.25 }, collide: 'bounce', maxBounces: 1,
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 8, damage: 4, angle: 45, knockback: 12, growth: 30, effect: 'rock' }],
    },
  },

  moves: {
    jab: { name: 'Bonk', duration: 14, anim: 'bonk',
      hitboxes: [{ start: 3, end: 5, x: 30, y: -20, r: 13, damage: 2.5, angle: 60, knockback: 10, growth: 16 }] },
    side: { name: 'Shoulder Check', duration: 24, anim: 'lunge', velocity: [{ start: 4, end: 9, vx: 4 }],
      hitboxes: [{ start: 6, end: 10, x: 32, y: -20, r: 16, damage: 8, angle: 40, knockback: 22, growth: 70 }] },
    up: { name: 'Pop Up', duration: 22, anim: 'hop',
      hitboxes: [{ start: 5, end: 9, x: 0, y: -52, r: 18, damage: 7, angle: 90, knockback: 24, growth: 68 }] },
    down: { name: 'Pebble Sweep', duration: 24, anim: 'sweep',
      hitboxes: [{ start: 5, end: 8, shape: 'rect', x: 30, y: -6, w: 50, h: 12, damage: 5, angle: 80, knockback: 22, growth: 44 }] },
    sideSmash: { name: 'Landslide', duration: 44, anim: 'slam',
      hitboxes: [{ start: 14, end: 17, x: 38, y: -22, r: 22, damage: 15, angle: 38, knockback: 25, growth: 85 }] },
    upSmash: { name: 'Geode Crack', duration: 42, anim: 'crack',
      hitboxes: [{ start: 12, end: 16, shape: 'capsule', x1: 0, y1: -40, x2: 0, y2: -84, r: 20, damage: 14, angle: 90, knockback: 30, growth: 88 }] },
    downSmash: { name: 'Tremor', duration: 40, anim: 'tremor',
      hitboxes: [{ start: 11, end: 14, shape: 'rect', x: 0, y: -8, w: 120, h: 16, damage: 12, angle: 30, knockback: 28, growth: 84 }] },
    nair: { name: 'Tumble', duration: 26, landingLag: 7, anim: 'spin',
      hitboxes: [{ start: 4, end: 14, x: 0, y: -20, r: 28, damage: 7, angle: 50, knockback: 16, growth: 56 }] },
    fair: { name: 'Headbutt', duration: 26, landingLag: 9, anim: 'lunge',
      hitboxes: [{ start: 7, end: 10, x: 30, y: -22, r: 18, damage: 9, angle: 40, knockback: 22, growth: 78 }] },
    bair: { name: 'Back Bump', duration: 24, landingLag: 8, anim: 'bump',
      hitboxes: [{ start: 5, end: 8, x: -30, y: -20, r: 18, damage: 10, angle: 145, knockback: 24, growth: 82 }] },
    uair: { name: 'Flip', duration: 24, landingLag: 6, anim: 'flip',
      hitboxes: [{ start: 5, end: 9, x: 0, y: -50, r: 20, damage: 7, angle: 86, knockback: 22, growth: 74 }] },
    dair: { name: 'Plummet', duration: 30, landingLag: 14, anim: 'plummet', gravity: [{ from: 6, to: 20, scale: 1.4 }],
      hitboxes: [{ start: 8, end: 14, x: 0, y: 2, r: 18, damage: 10, angle: 280, knockback: 14, growth: 56 }] },

    neutralSpecial: { name: 'Flick Grit', duration: 28, anim: 'flick',
      timeline: [{ at: 9, spawn: 'grit', x: 18, y: -26, vx: 7, vy: -3 }] },
    sideSpecial: { name: 'Skip', duration: 40, anim: 'skip', oncePerAirtime: true,
      velocity: [{ start: 6, end: 13, vx: 9, vy: -5 }, { start: 14, end: 23, vx: 8, vy: -4 }],
      hitboxes: [{ start: 6, end: 13, x: 6, y: -20, r: 24, damage: 5, angle: 55, knockback: 18, growth: 40 },
                 { start: 14, end: 23, group: 2, x: 6, y: -20, r: 24, damage: 5, angle: 45, knockback: 20, growth: 50 }],
      timeline: [{ at: 13, emit: 'skip' }] },
    upSpecial: { name: 'Geyser Ride', duration: 40, anim: 'geyser', helpless: true,
      velocity: [{ start: 5, end: 20, vy: -11 }],
      hitboxes: [{ start: 5, end: 20, x: 0, y: 4, r: 22, use: 'chip', rehit: 5 }] },
    downSpecial: { name: 'Hunker', category: 'counter', duration: 34, anim: 'hunker',
      counter: { from: 3, to: 16, then: 'rebound', mul: 1.2 } },
    rebound: { name: 'Rebound', category: 'counter', duration: 30, anim: 'slam',
      hitboxes: [{ start: 2, end: 5, x: 20, y: -20, r: 30, damage: 7, angle: 40, knockback: 28, growth: 74, counterScale: true, effect: 'rock' }] },

    taunt: { name: 'Skip Count', category: 'taunt', duration: 50, anim: 'proud' },
  },

  ai: { recovery: ['upSpecial', 'sideSpecial'], prefer: ['sideSpecial', 'nair'] },
  art,
});
