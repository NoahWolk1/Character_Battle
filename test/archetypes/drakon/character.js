// DRAKON — an ancient fire dragon (spec §10.3 #6). Archetype stress test for: a
// 150×120 collider, a ~15000 px² hurtbox (area refund), two wing parts at relay 1
// (hittable extensions of the body), glide, a 520 px fire beam, and art bounds at the
// 4× collider limit (camera framing and the shadow must still be right).
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

// life: a relay-1 part is permanent; 1e9 frames (Infinity is clamped to the same value).
const WING = { kind: 'part', relay: 1, life: 1e9, motion: { type: 'attached' }, clank: false };

export default defineCharacter({
  id: 'drakon',
  name: 'Drakon',
  author: 'archetype suite',
  description: 'An ancient fire dragon the size of a bus. Huge and easy to hit (so it gets a big stat refund), glides on vast wings that can be struck, and breathes a stage-crossing jet of fire.',
  archetype: 'heavy',

  body: {
    collider: { w: 150, h: 120 },
    hurtboxes: {
      default: [
        { shape: 'capsule', x1: -46, y1: -62, x2: 34, y2: -66, r: 33 },
        { shape: 'capsule', x1: 40, y1: -78, x2: 74, y2: -108, r: 20 },
        { shape: 'circle', x: 90, y: -112, r: 21 },
        { shape: 'capsule', x1: -78, y1: -50, x2: -118, y2: -30, r: 15 },
        { shape: 'rect', x: -4, y: -14, w: 100, h: 26 },
      ],
      crouch: [{ shape: 'capsule', x1: -60, y1: -36, x2: 70, y2: -40, r: 34 }],
      air: [
        { shape: 'capsule', x1: -50, y1: -66, x2: 40, y2: -70, r: 34 },
        { shape: 'circle', x: 86, y: -96, r: 24 },
        { shape: 'capsule', x1: -84, y1: -60, x2: -120, y2: -50, r: 15 },
      ],
    },
  },
  stats: { weight: 130, runSpeed: 6.2, airSpeed: 4.2, jumpHeight: 13.5, doubleJumpHeight: 12.5, airJumps: 1, gravity: 0.72, fallSpeed: 12 },
  movement: { glide: { button: 'jump', frames: 150, fallSpeed: 1.4, speed: 1.2, turn: 0.06 } },

  hitboxes: {
    claw: { damage: 8, angle: 40, knockback: 22, growth: 72, effect: 'slash' },
    flame: { damage: 2, angle: 35, knockback: 6, growth: 8, effect: 'fire', status: 'burn' },
  },

  entities: {
    // Wings: relay 1 parts — hitting a wing is hitting Drakon (bigger target, no free damage).
    wingNear: { ...WING, anchor: { x: -6, y: -104 }, shape: { shape: 'capsule', x1: 0, y1: 0, x2: -64, y2: -40, r: 18 } },
    wingFar: { ...WING, anchor: { x: 14, y: -110 }, shape: { shape: 'capsule', x1: 0, y1: 0, x2: -44, y2: -52, r: 14 } },
    fireBreath: {
      kind: 'beam', length: 520, width: 22, life: 50, maxAlive: 1, anchor: { x: 104, y: -108 },
      motion: { type: 'attached' },
      hitboxes: [{ shape: 'capsule', x1: 10, y1: 0, x2: 500, y2: 132, r: 20, use: 'flame', rehit: 10 }],
      render: { color: '#ff7a1a', color2: '#fff1a8' },
    },
    ember: {
      kind: 'projectile', shape: { shape: 'circle', r: 9 }, life: 80, maxAlive: 3,
      motion: { type: 'ballistic', gravity: 0.3 }, collide: 'die',
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 12, damage: 5, angle: 45, knockback: 12, growth: 40, effect: 'fire' }],
      render: { color: '#ff7a1a' },
    },
  },

  moves: {
    jab: { name: 'Claw Swipe', duration: 20, anim: 'claw',
      hitboxes: [{ start: 4, end: 6, x: 104, y: -40, r: 22, damage: 4, angle: 55, knockback: 12, growth: 20, effect: 'slash' }] },
    side: { name: 'Horn Gore', duration: 30, anim: 'gore',
      hitboxes: [{ start: 9, end: 12, x: 132, y: -96, r: 24, use: 'claw' }] },
    up: { name: 'Wing Flick', duration: 30, anim: 'flick',
      hitboxes: [{ start: 8, end: 13, shape: 'capsule', x1: -30, y1: -150, x2: 40, y2: -170, r: 22, damage: 8, angle: 92, knockback: 24, growth: 72 }] },
    down: { name: 'Tail Sweep', duration: 30, anim: 'sweep',
      hitboxes: [{ start: 9, end: 12, shape: 'rect', x: -60, y: -12, w: 150, h: 22, damage: 8, angle: 70, knockback: 24, growth: 54 }] },
    sideSmash: { name: 'Dragon Bite', duration: 52, anim: 'bite',
      hitboxes: [{ start: 18, end: 21, x: 150, y: -96, r: 30, damage: 17, angle: 40, knockback: 22, growth: 76, effect: 'slash' }] },
    upSmash: { name: 'Wing Burst', duration: 50, anim: 'burst',
      hitboxes: [{ start: 15, end: 20, shape: 'capsule', x1: -50, y1: -150, x2: 50, y2: -150, r: 36, damage: 15, angle: 88, knockback: 28, growth: 86 }] },
    downSmash: { name: 'Quake Stomp', duration: 50, anim: 'quake',
      hitboxes: [{ start: 16, end: 19, shape: 'rect', x: 0, y: -10, w: 260, h: 24, damage: 14, angle: 32, knockback: 28, growth: 84 }],
      timeline: [{ at: 16, camera: { shake: 6 } }, { at: 16, emit: 'quake' }] },
    nair: { name: 'Barrel Roll', duration: 34, landingLag: 12, anim: 'roll',
      hitboxes: [{ start: 7, end: 18, x: 0, y: -66, r: 40, damage: 8, angle: 45, knockback: 22, growth: 62 }] },
    fair: { name: 'Rake', duration: 34, landingLag: 14, anim: 'rake',
      hitboxes: [{ start: 10, end: 14, x: 124, y: -62, r: 28, damage: 12, angle: 40, knockback: 24, growth: 82, effect: 'slash' }] },
    bair: { name: 'Tail Whip', duration: 32, landingLag: 12, anim: 'whip',
      hitboxes: [{ start: 9, end: 12, x: -150, y: -40, r: 26, damage: 13, angle: 150, knockback: 26, growth: 84 }] },
    uair: { name: 'Flame Crest', duration: 30, landingLag: 10, anim: 'crest',
      hitboxes: [{ start: 7, end: 12, x: 40, y: -160, r: 30, damage: 9, angle: 86, knockback: 22, growth: 76, effect: 'fire' }] },
    dair: { name: 'Talon Dive', duration: 40, landingLag: 20, anim: 'talon',
      velocity: [{ start: 10, end: 30, vy: 13, untilGrounded: true }],
      hitboxes: [{ start: 10, end: 30, shape: 'rect', x: 10, y: 4, w: 110, h: 26, damage: 11, angle: 285, knockback: 18, growth: 52 }],
      timeline: [{ onLand: true, emit: 'quake' }] },

    neutralSpecial: { name: 'Inferno Breath', duration: 76, anim: 'breath',
      timeline: [{ at: 18, spawn: 'fireBreath', x: 104, y: -108, bindToMove: true }, { at: 18, emit: 'roar' }] },
    sideSpecial: { name: 'Ember Spit', duration: 40, anim: 'spit',
      timeline: [{ at: 14, spawn: 'ember', x: 110, y: -110, vx: 9, vy: -3, count: 3, spread: 12 }] },
    upSpecial: { name: 'Skyward Beat', duration: 48, anim: 'skyward', helpless: true,
      velocity: [{ start: 8, end: 25, vy: -11.5, vx: 1 }],
      hitboxes: [{ start: 8, end: 14, shape: 'capsule', x1: -80, y1: -90, x2: 80, y2: -90, r: 30, damage: 7, angle: 80, knockback: 24, growth: 50 }] },
    downSpecial: { name: 'Hoard Guard', duration: 46, anim: 'guard', armor: [{ from: 4, to: 24, threshold: 12 }],
      hitboxes: [{ start: 20, end: 24, shape: 'capsule', x1: -100, y1: -40, x2: 100, y2: -40, r: 32, damage: 10, angle: 45, knockback: 28, growth: 70, effect: 'fire' }] },
    taunt: { name: 'Roar', category: 'taunt', duration: 70, anim: 'roar', timeline: [{ at: 14, emit: 'roar' }, { at: 14, camera: { shake: 3 } }] },
  },

  behavior: {
    // Wings exist from match start and come back after every respawn (parts despawn on KO).
    init(view, api) { api.spawn('wingNear', {}); api.spawn('wingFar', {}); },
  },

  ai: { preferredRange: 220, zoning: true, recovery: ['upSpecial'], prefer: ['neutralSpecial', 'sideSpecial'] },
  art,
});
