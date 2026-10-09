// Test fixture: spec §2 example, verbatim except import paths (test/fixtures is one level deeper than characters/).
// characters/gertie/character.js
// GRANDMA GERTIE — 87 years young, on a souped-up mobility scooter. Throws her dentures,
// rams with the scooter, pinches cheeks, and always has time for tea.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'gertie',
  name: 'Grandma Gertie',
  author: 'Priya',
  description: 'A grandma on a turbo mobility scooter. Bouncing dentures, scooter rams, cheek pinches and a nice cup of tea.',
  archetype: 'grappler',

  body: {
    collider: { w: 66, h: 98 },
    hurtboxes: {
      default: [{ shape: 'rect', x: 0, y: -30, w: 70, h: 56 }, { shape: 'circle', x: 6, y: -78, r: 20 }],
      crouch:  [{ shape: 'rect', x: 0, y: -30, w: 72, h: 56 }],
    },
    armor: { threshold: 2 },                        // jabs and drizzle don't make Grandma flinch
  },
  stats: { weight: 114, runSpeed: 7.6, airSpeed: 3.6, jumpHeight: 12, doubleJumpHeight: 11,
           airJumps: 1, gravity: 0.8, fallSpeed: 13 },
  movement: { glide: { button: 'jump', frames: 110, fallSpeed: 1.8 } },   // the trusty umbrella

  resources: {
    battery: { max: 100, start: 100, regen: 0.25, regenWhen: 'grounded', regenDelay: 60,
               hud: { style: 'ring', label: 'Battery', color: '#7fe08a' } },
  },

  statuses: {
    tangled: { frames: 45, control: 'root', mods: { jump: 0.8 }, visual: 'yarn', tint: '#e86fa0' },
  },

  hitboxes: {
    chomp:  { damage: 5, angle: 40, knockback: 14, growth: 34, effect: 'normal' },
    yarn:   { damage: 2, angle: 80, knockback: 6, growth: 0, status: 'tangled' },
    pinch:  { damage: 2.5, angle: 0, knockback: 0, growth: 0, setKnockback: 0 },
  },

  entities: {
    dentures: { kind: 'projectile', shape: { shape: 'circle', r: 9 }, life: 120, maxAlive: 2,
                motion: { type: 'ballistic', gravity: 0.45 }, collide: 'bounce', maxBounces: 3,
                hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 11, use: 'chomp' }], maxHits: 1,
                render: { style: 'dentures' } },
    yarnBall: { kind: 'trap', shape: { shape: 'circle', r: 12 }, life: 360, hp: 4, maxAlive: 1,
                motion: { type: 'walker', speed: 2.2, gravity: 0.6 }, collide: 'walk',
                hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 14, use: 'yarn', rehit: 60 }] },
  },

  moves: {
    jab:  { name: 'Purse Poke', duration: 18, anim: 'jab',
            hitboxes: [{ start: 4, end: 6, x: 48, y: -52, r: 18, damage: 4, angle: 50, knockback: 12, growth: 26 }] },
    side: { name: 'Cane Hook', duration: 28, anim: 'cane',
            hitboxes: [{ start: 8, end: 11, shape: 'capsule', x1: 30, y1: -50, x2: 104, y2: -40, r: 13,
                         damage: 10, angle: 35, knockback: 24, growth: 78 }] },
    up:   { name: 'Hat Pin', duration: 26, anim: 'hatpin',
            hitboxes: [{ start: 7, end: 11, shape: 'capsule', x1: 8, y1: -90, x2: 8, y2: -140, r: 12,
                         damage: 8, angle: 90, knockback: 24, growth: 76 }] },
    down: { name: 'Drop Stitch', duration: 30, anim: 'knit', timeline: [{ at: 12, spawn: 'yarnBall', x: 40, y: -12 }] },

    sideSmash: { name: 'Handbag Haymaker', duration: 50, anim: 'handbag', armor: [{ from: 6, to: 15, threshold: 10 }],
      hitboxes: [{ start: 16, end: 19, x: 76, y: -54, r: 32, damage: 17, angle: 38, knockback: 34, growth: 96 }] },
    upSmash: { name: 'Umbrella Pop', duration: 44, anim: 'umbrella',
      hitboxes: [{ start: 11, end: 17, shape: 'circle', x: 0, y: -132, r: 44, damage: 15, angle: 88, knockback: 32, growth: 92 }] },
    downSmash: { name: 'Orthopedic Stomp', duration: 46, anim: 'stomp',
      hitboxes: [{ start: 15, end: 18, shape: 'rect', x: 0, y: -10, w: 200, h: 22, damage: 14, angle: 35, knockback: 30, growth: 90 }] },

    nair: { name: 'Wheelie Spin', duration: 30, landingLag: 12, anim: 'wheelie',
      hitboxes: [{ start: 6, end: 18, x: 0, y: -40, r: 50, damage: 7, angle: 45, knockback: 20, growth: 60 }] },
    fair: { name: 'Rolling Pin', duration: 34, landingLag: 14, anim: 'pin',
      hitboxes: [{ start: 11, end: 14, x: 62, y: -50, r: 28, damage: 13, angle: 38, knockback: 28, growth: 90 }] },
    bair: { name: 'Exhaust Puff', duration: 28, landingLag: 11, anim: 'exhaust',
      hitboxes: [{ start: 7, end: 10, x: -58, y: -24, r: 28, damage: 11, angle: 145, knockback: 28, growth: 86, effect: 'fire' }] },
    uair: { name: 'Hairspray', duration: 28, landingLag: 10, anim: 'spray',
      hitboxes: [{ start: 6, end: 12, x: 6, y: -118, r: 30, damage: 8, angle: 88, knockback: 22, growth: 78 }] },
    dair: { name: 'Scooter Slam', duration: 40, landingLag: 22, anim: 'slam',
      velocity: [{ start: 9, end: 30, vy: 14, untilGrounded: true }],
      hitboxes: [{ start: 10, end: 30, shape: 'rect', x: 0, y: 2, w: 74, h: 24, damage: 12, angle: 285, knockback: 28, growth: 72 }],
      timeline: [{ onLand: true, emit: 'slamDust' }] },

    neutralSpecial: { name: 'Denture Toss', duration: 34, anim: 'toss',
      timeline: [{ at: 13, spawn: 'dentures', x: 30, y: -80, vx: 7, vy: -6 }, { at: 13, sfx: 'chatter' }] },
    sideSpecial: { name: 'Full Throttle', duration: 40, anim: 'ram', oncePerAirtime: true,
      cost: { battery: 35 }, else: 'sputter', armor: [{ from: 4, to: 22, threshold: 8 }],
      velocity: [{ start: 5, end: 24, vx: 12 }],
      hitboxes: [{ start: 6, end: 22, x: 40, y: -36, r: 34, damage: 1.5, angle: 20, knockback: 6, growth: 0, rehit: 4 },
                 { start: 23, end: 25, group: 9, x: 44, y: -36, r: 36, damage: 6, angle: 40, knockback: 30, growth: 70 }],
      cancels: [{ from: 18, to: 24, into: ['jump'], onHit: true }] },
    sputter: { name: 'Sputter', category: 'special', duration: 30, anim: 'sputter', timeline: [{ at: 4, emit: 'sputter' }] },
    upSpecial: { name: 'Umbrella Lift', duration: 44, anim: 'lift', helpless: true,
      velocity: [{ start: 6, end: 28, vy: -11.5, vx: 1.5 }],
      hitboxes: [{ start: 6, end: 12, x: 0, y: -120, r: 36, damage: 6, angle: 85, knockback: 26, growth: 50 }] },
    downSpecial: {                                     // hold to sip tea: heals, but you're a sitting duck
      name: 'Tea Break', duration: 30, anim: 'tea', requires: { grounded: true },
      hold: { button: 'special', from: 10, to: 20, max: 300 },
      update(view, api) { if (view.me.move.frame >= 10 && view.input.held('special')) api.heal(0.05); },
    },

    grab:   { name: 'Cheek Pinch', duration: 34, anim: 'grab',
              hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 56, y: -50, w: 50, h: 60 }] },
    pummel: { name: 'Squeeze', duration: 18, anim: 'pinch', timeline: [{ at: 6, release: 'pinch' }] },
    fthrow: { name: 'Shoo!', duration: 30, anim: 'shoo', timeline: [{ at: 12, release: { damage: 9, angle: 40, knockback: 50, growth: 68 } }] },
    bthrow: { name: 'Over the Shoulder', duration: 36, anim: 'shoulder', timeline: [{ at: 20, release: { damage: 10, angle: 140, knockback: 52, growth: 70 } }] },
    uthrow: { name: 'Up You Go', duration: 32, anim: 'upyougo', timeline: [{ at: 15, release: { damage: 8, angle: 90, knockback: 48, growth: 72 } }] },
    dthrow: { name: 'Sit Down', duration: 34, anim: 'sitdown', timeline: [{ at: 17, release: { damage: 7, angle: 75, knockback: 58, growth: 30 } }] },
    taunt:  { name: 'Back In My Day', duration: 90, anim: 'lecture', timeline: [{ at: 8, emit: 'lecture' }] },
  },

  ai: { preferredRange: 80, grapple: true, recovery: ['upSpecial'], prefer: ['grab', 'sideSpecial'] },
  art,
});
