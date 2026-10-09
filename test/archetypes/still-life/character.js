// STILL LIFE — a living still-life painting in a gilded frame (spec §10.3 #7). Archetype
// stress test for: rig 'none', a paint resource, painted traps, a reflect frame, a
// drawWorld frame decal, and an image asset (painting.svg) used as the body texture.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'still-life',
  name: 'Still Life',
  author: 'archetype suite',
  description: 'A bowl-of-fruit oil painting that walked out of the gallery. Spends paint on splatters and slick brushstroke traps, and swings its gilded frame to send projectiles back.',
  archetype: 'trickster',

  body: {
    collider: { w: 76, h: 104 },
    hurtboxes: {
      default: [{ shape: 'rect', x: 0, y: -54, w: 76, h: 100 }],
      crouch: [{ shape: 'rect', x: 0, y: -36, w: 84, h: 68 }],
    },
  },
  stats: { weight: 96, runSpeed: 6.2, airSpeed: 4.6, jumpHeight: 14.5, doubleJumpHeight: 13.5, airJumps: 1, gravity: 0.62, fallSpeed: 11 },

  resources: {
    paint: { max: 100, start: 100, regen: 0.15, regenDelay: 45, hud: { style: 'bar', label: 'Paint', color: '#5aa0ff' } },
  },

  statuses: {
    wet: { frames: 120, stack: 'refresh', mods: { speed: 0.75, jump: 0.85 }, visual: 'paint', tint: '#5aa0ff', icon: 'drop' },
  },

  hitboxes: {
    brush: { damage: 7, angle: 40, knockback: 20, growth: 66, effect: 'paint' },
    frame: { damage: 9, angle: 45, knockback: 22, growth: 74, effect: 'heavy' },
  },

  entities: {
    splat: {
      kind: 'projectile', shape: { shape: 'circle', r: 10 }, life: 70, maxAlive: 2,
      motion: { type: 'ballistic', gravity: 0.38 }, collide: 'stick',
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 12, damage: 5, angle: 45, knockback: 12, growth: 30, effect: 'paint', status: 'wet' }],
      onExpire: [{ spawn: 'paintTrap' }],
      render: { color: '#5aa0ff' },
    },
    paintTrap: {
      kind: 'trap', shape: { shape: 'rect', x: 0, y: -5, w: 76, h: 10 }, life: 480, maxAlive: 2,
      motion: { type: 'stationary', snapToGround: true },
      hitboxes: [{ shape: 'rect', x: 0, y: -6, w: 76, h: 12, damage: 2, angle: 80, knockback: 18, growth: 0, setKnockback: 18, status: 'wet', rehit: 45, effect: 'paint' }],
      render: { color: '#5aa0ff' },
    },
  },

  moves: {
    jab: { name: 'Corner Jab', duration: 18, anim: 'corner',
      hitboxes: [{ start: 3, end: 5, x: 48, y: -60, r: 16, damage: 3, angle: 60, knockback: 10, growth: 20 }] },
    side: { name: 'Brush Swipe', duration: 28, anim: 'brush',
      hitboxes: [{ start: 8, end: 11, shape: 'capsule', x1: 40, y1: -70, x2: 104, y2: -50, r: 15, use: 'brush' }] },
    up: { name: 'Frame Flip', duration: 28, anim: 'flip',
      hitboxes: [{ start: 7, end: 12, shape: 'capsule', x1: -30, y1: -116, x2: 30, y2: -116, r: 20, damage: 8, angle: 90, knockback: 22, growth: 74 }] },
    down: { name: 'Drip', duration: 26, anim: 'drip',
      hitboxes: [{ start: 7, end: 10, shape: 'rect', x: 40, y: -8, w: 70, h: 16, damage: 6, angle: 75, knockback: 22, growth: 44, effect: 'paint', status: 'wet' }] },
    sideSmash: { name: 'Masterstroke', duration: 48, anim: 'master',
      hitboxes: [{ start: 15, end: 18, shape: 'capsule', x1: 40, y1: -90, x2: 120, y2: -40, r: 22, damage: 16, angle: 38, knockback: 24, growth: 80, effect: 'paint' }] },
    upSmash: { name: 'Easel Launch', duration: 46, anim: 'easel',
      hitboxes: [{ start: 13, end: 17, shape: 'capsule', x1: 0, y1: -100, x2: 0, y2: -150, r: 30, damage: 15, angle: 90, knockback: 28, growth: 86 }] },
    downSmash: { name: 'Palette Spin', duration: 44, anim: 'palette',
      hitboxes: [{ start: 13, end: 16, shape: 'capsule', x1: -80, y1: -16, x2: 80, y2: -16, r: 20, damage: 13, angle: 30, knockback: 28, growth: 84, effect: 'paint' }] },
    nair: { name: 'Pinwheel Frame', duration: 30, landingLag: 9, anim: 'pinwheel',
      hitboxes: [{ start: 6, end: 16, x: 0, y: -54, r: 40, damage: 7, angle: 50, knockback: 20, growth: 58 }] },
    fair: { name: 'Fresco', duration: 30, landingLag: 10, anim: 'fresco',
      hitboxes: [{ start: 9, end: 12, x: 64, y: -60, r: 24, use: 'frame' }] },
    bair: { name: 'Backing Board', duration: 28, landingLag: 10, anim: 'backing',
      hitboxes: [{ start: 7, end: 10, x: -56, y: -56, r: 26, damage: 11, angle: 145, knockback: 26, growth: 84 }] },
    uair: { name: 'Crown Molding', duration: 28, landingLag: 9, anim: 'crown',
      hitboxes: [{ start: 6, end: 11, shape: 'capsule', x1: -36, y1: -120, x2: 36, y2: -120, r: 20, damage: 8, angle: 86, knockback: 22, growth: 76 }] },
    dair: { name: 'Gilded Drop', duration: 36, landingLag: 16, anim: 'gilded',
      hitboxes: [{ start: 10, end: 14, shape: 'rect', x: 0, y: 2, w: 70, h: 20, damage: 11, angle: 280, knockback: 14, growth: 60 }] },

    neutralSpecial: { name: 'Splatter', duration: 34, anim: 'splatter', cost: { paint: 15 }, else: 'dryBrush',
      timeline: [{ at: 12, spawn: 'splat', x: 40, y: -70, vx: 7, vy: -6 }, { at: 12, emit: 'splatter' }] },
    // Reflect frame: the gilded frame swings forward and sends projectiles back.
    sideSpecial: { name: 'Reframe', duration: 38, anim: 'reframe',
      hitboxes: [
        { start: 6, end: 18, kind: 'reflect', shape: 'rect', x: 50, y: -56, w: 34, h: 104 },
        { start: 19, end: 21, shape: 'rect', x: 44, y: -56, w: 40, h: 90, use: 'frame' },
      ],
      timeline: [{ at: 6, emit: 'reframe' }] },
    upSpecial: { name: 'Canvas Kite', duration: 46, anim: 'kite', helpless: true,
      velocity: [{ start: 6, end: 22, vy: -11, vx: 2 }],
      gravity: [{ from: 23, to: 45, scale: 0.5 }],
      hitboxes: [{ start: 6, end: 13, x: 0, y: -110, r: 30, damage: 6, angle: 85, knockback: 24, growth: 46 }] },
    downSpecial: { name: 'Brushstroke', duration: 34, anim: 'stroke', cost: { paint: 25 }, else: 'dryBrush', requires: { grounded: true },
      timeline: [{ at: 12, spawn: 'paintTrap', x: 54, y: 0 }, { at: 12, emit: 'stroke' }] },
    dryBrush: { name: 'Dry Brush', category: 'special', duration: 28, anim: 'dry', timeline: [{ at: 6, emit: 'dry' }] },
    taunt: { name: 'Gallery Pose', category: 'taunt', duration: 60, anim: 'pose', timeline: [{ at: 10, emit: 'pose' }] },
  },

  behavior: {
    // Creative juices: landing hits refills a little paint.
    onHit(view, api) { api.res.add('paint', 1.5); },
  },

  ai: { preferredRange: 140, recovery: ['upSpecial'], prefer: ['neutralSpecial', 'sideSpecial'] },
  art,
});
