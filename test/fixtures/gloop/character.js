// Test fixture: spec §2 example, verbatim except import paths (test/fixtures is one level deeper than characters/).
// characters/gloop/character.js
// GLOOP — a lab slime that won't hold still. BLOB is balanced, PUDDLE is fast and slippery
// (crawls on walls), SPIKE is hard and heavy with a counter. Mass = size: eat projectiles to grow.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

const BLOB_SLOTS = {};                                // base slots = identity names
export default defineCharacter({
  id: 'gloop',
  name: 'Gloop',
  author: 'Sam',
  description: 'A shapeshifting lab slime. Blob, Puddle or Spike form; eats projectiles to grow; splits off a little copycat.',
  archetype: 'trickster',

  body: {
    collider: { w: 60, h: 66 },
    hurtboxes: {
      default: [{ shape: 'circle', x: 0, y: -30, r: 30 }, { shape: 'circle', x: 0, y: -54, r: 18 }],
      crouch:  [{ shape: 'capsule', x1: -26, y1: -18, x2: 26, y2: -18, r: 18 }],
    },
    scaleRange: [0.8, 1.2],
  },
  stats: { weight: 92, runSpeed: 6.2, airSpeed: 4.8, jumpHeight: 15, doubleJumpHeight: 14, airJumps: 1, gravity: 0.62, fallSpeed: 10.5 },

  forms: {
    puddle: {
      stats: { weight: 80, runSpeed: 8.2, airSpeed: 5.4, jumpHeight: 13, gravity: 0.7 },
      body: { collider: { w: 84, h: 28 },
              hurtboxes: { default: [{ shape: 'capsule', x1: -32, y1: -14, x2: 32, y2: -14, r: 14 }] } },
      movement: { crawl: { frames: 100, speed: 5.5 }, wallCling: { frames: 40 } },
      slots: { jab: 'splash', side: 'slither', up: 'geyser', nair: 'splashRing', neutralSpecial: 'globShot' },
    },
    spike: {
      stats: { weight: 126, runSpeed: 4.8, airSpeed: 3.4, jumpHeight: 12, doubleJumpHeight: 11, gravity: 0.82, fallSpeed: 13.5 },
      body: { collider: { w: 64, h: 80 },
              hurtboxes: { default: [{ shape: 'rect', x: 0, y: -36, w: 60, h: 60 }, { shape: 'circle', x: 0, y: -72, r: 14 }] } },
      armor: { threshold: 3 },
      slots: { jab: 'needle', side: 'lance', sideSmash: 'urchin', neutralSpecial: 'bristle' },
    },
  },

  resources: {
    mass: { max: 100, start: 60, regen: 0.04, onHurt: { perDamage: -0.6 },
            hud: { style: 'pips', label: 'Mass', color: '#7dff9a' } },
  },

  statuses: {
    sticky: { frames: 90, stack: 'refresh', mods: { speed: 0.7, jump: 0.8 }, visual: 'goo', tint: '#7dff9a' },
  },

  hitboxes: {
    goo:   { damage: 4, angle: 45, knockback: 12, growth: 30, effect: 'poison', status: 'sticky' },
    spine: { damage: 6, angle: 40, knockback: 18, growth: 50, effect: 'slash' },
    eat:   { kind: 'absorb' },
  },

  entities: {
    glob: { kind: 'projectile', shape: { shape: 'circle', r: 8 }, life: 80, maxAlive: 3,
            motion: { type: 'ballistic', gravity: 0.35 }, collide: 'stick',
            hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 10, use: 'goo' }],
            onExpire: [{ spawn: 'puddleTrap' }] },
    puddleTrap: { kind: 'trap', shape: { shape: 'rect', x: 0, y: -4, w: 60, h: 8 }, life: 240, hp: 3, maxAlive: 2,
                  motion: { type: 'stationary', snapToGround: true },
                  hitboxes: [{ shape: 'rect', x: 0, y: -4, w: 60, h: 10, damage: 1, angle: 90, knockback: 0, growth: 0,
                               setKnockback: 0, status: 'sticky', rehit: 60 }] },
    gloopling: { kind: 'clone', shape: { shape: 'circle', x: 0, y: -20, r: 20 }, life: 480, hp: 12, maxAlive: 1,
                 motion: { type: 'mimic', delay: 18 }, scale: 0.6 },
  },

  moves: {
    // ── BLOB (base) ──
    jab:  { name: 'Jiggle Jab', duration: 16, anim: 'poke',
            hitboxes: [{ start: 3, end: 5, x: 32, y: -34, r: 16, damage: 3, angle: 60, knockback: 10, growth: 20 }] },
    side: { name: 'Stretch Slap', duration: 26, anim: 'stretch',
            hitboxes: [{ start: 7, end: 10, shape: 'capsule', x1: 20, y1: -34, x2: 96, y2: -30, r: 14, damage: 9, angle: 38, knockback: 22, growth: 78 }] },
    up:   { name: 'Bubble Pop', duration: 25, anim: 'tall',
            hitboxes: [{ start: 6, end: 10, x: 0, y: -86, r: 26, damage: 8, angle: 88, knockback: 24, growth: 76 }] },
    down: { name: 'Ooze Sweep', duration: 22, anim: 'flat',
            hitboxes: [{ start: 6, end: 9, shape: 'rect', x: 34, y: -8, w: 76, h: 16, use: 'goo' }] },
    sideSmash: { name: 'Haymaker Pseudopod', duration: 46, anim: 'pod',
            hitboxes: [{ start: 14, end: 17, shape: 'capsule', x1: 30, y1: -36, x2: 120, y2: -40, r: 22, damage: 16, angle: 38, knockback: 34, growth: 94 }] },
    upSmash: { name: 'Geyser Burst', duration: 44, anim: 'geyser',
            hitboxes: [{ start: 12, end: 17, shape: 'capsule', x1: 0, y1: -30, x2: 0, y2: -140, r: 26, damage: 15, angle: 90, knockback: 32, growth: 92 }] },
    downSmash: { name: 'Splat', duration: 42, anim: 'splat',
            hitboxes: [{ start: 11, end: 14, shape: 'rect', x: 0, y: -10, w: 190, h: 22, damage: 13, angle: 30, knockback: 30, growth: 88 }] },
    nair: { name: 'Wobble', duration: 28, landingLag: 8, anim: 'wobble',
            hitboxes: [{ start: 5, end: 16, x: 0, y: -34, r: 40, damage: 7, angle: 50, knockback: 18, growth: 60 }] },
    fair: { name: 'Lunge Lobe', duration: 28, landingLag: 10, anim: 'pod',
            hitboxes: [{ start: 8, end: 11, x: 48, y: -36, r: 24, damage: 10, angle: 40, knockback: 24, growth: 84 }] },
    bair: { name: 'Back Blorp', duration: 26, landingLag: 9, anim: 'blorp',
            hitboxes: [{ start: 6, end: 9, x: -48, y: -34, r: 24, damage: 11, angle: 145, knockback: 26, growth: 86 }] },
    uair: { name: 'Drip Up', duration: 26, landingLag: 7, anim: 'tall',
            hitboxes: [{ start: 5, end: 10, x: 0, y: -88, r: 26, damage: 8, angle: 86, knockback: 22, growth: 78 }] },
    dair: { name: 'Anvil Drip', duration: 32, landingLag: 14, anim: 'drop',
            hitboxes: [{ start: 9, end: 12, x: 0, y: 4, r: 24, damage: 11, angle: 275, knockback: 24, growth: 76 }] },

    neutralSpecial: {                                // eats projectiles: grows (mass) instead of healing
      name: 'Engulf', duration: 34, anim: 'gulp',
      hitboxes: [{ start: 6, end: 20, shape: 'circle', x: 30, y: -34, r: 36, use: 'eat' }],
      onAbsorb: [{ resource: { name: 'mass', add: 15 } }, { emit: 'gulp' }],
    },
    sideSpecial: { name: 'Bounce Off', duration: 32, anim: 'bounce', oncePerAirtime: true,
            velocity: [{ start: 4, end: 16, vx: 10, vy: -4 }],
            hitboxes: [{ start: 5, end: 15, x: 20, y: -30, r: 30, damage: 7, angle: 50, knockback: 22, growth: 50 }] },
    upSpecial: { name: 'Slingshot', duration: 42, anim: 'sling', helpless: true,
            hold: { button: 'special', from: 4, to: 8, max: 30 },
            timeline: [{ from: 10, to: 24, steer: { speed: 11, turn: 0.18 } }],
            hitboxes: [{ start: 10, end: 24, x: 0, y: -30, r: 28, damage: 6, angle: 70, knockback: 24, growth: 40 }] },
    downSpecial: {                                   // cycles forms: blob → puddle → spike → blob
      name: 'Morph', duration: 24, anim: 'morph',
      update(view, api) {
        if (view.me.move.frame !== 10) return;
        const next = { base: 'puddle', puddle: 'spike', spike: 'base' }[view.me.form];
        api.form(next);
      },
    },
    taunt: { name: 'Split Off', category: 'utility', duration: 40, anim: 'split', cost: { mass: 30 }, else: 'jiggle',
             timeline: [{ at: 18, spawn: 'gloopling', x: -40, y: 0 }] },
    jiggle: { name: 'Jiggle', category: 'taunt', duration: 30, anim: 'wobble' },

    // ── PUDDLE ──
    splash:     { name: 'Splash', category: 'jab', duration: 14, anim: 'p_splash',
                  hitboxes: [{ start: 2, end: 4, shape: 'rect', x: 30, y: -10, w: 50, h: 20, damage: 2.5, angle: 70, knockback: 10, growth: 18 }] },
    slither:    { name: 'Slither Trip', category: 'tilt', duration: 24, anim: 'p_slither', velocity: [{ start: 4, end: 12, vx: 7 }],
                  hitboxes: [{ start: 5, end: 12, shape: 'rect', x: 30, y: -8, w: 60, h: 16, damage: 7, angle: 80, knockback: 30, growth: 40 }] },
    geyser:     { name: 'Puddle Geyser', category: 'tilt', duration: 28, anim: 'p_geyser',
                  hitboxes: [{ start: 8, end: 12, shape: 'capsule', x1: 0, y1: 0, x2: 0, y2: -110, r: 18, damage: 8, angle: 90, knockback: 26, growth: 70 }] },
    splashRing: { name: 'Splash Ring', category: 'aerial', duration: 26, landingLag: 6, anim: 'p_ring',
                  hitboxes: [{ start: 4, end: 14, shape: 'capsule', x1: -40, y1: -12, x2: 40, y2: -12, r: 18, damage: 6, angle: 60, knockback: 18, growth: 50 }] },
    globShot:   { name: 'Glob Shot', category: 'special', duration: 30, anim: 'p_spit',
                  timeline: [{ at: 10, spawn: 'glob', x: 24, y: -16, vx: 8, vy: -4 }] },

    // ── SPIKE ──
    needle: { name: 'Needle', category: 'jab', duration: 18, anim: 's_needle',
              hitboxes: [{ start: 4, end: 6, shape: 'capsule', x1: 20, y1: -40, x2: 70, y2: -40, r: 8, use: 'spine' }] },
    lance:  { name: 'Lance', category: 'tilt', duration: 30, anim: 's_lance',
              hitboxes: [{ start: 9, end: 12, shape: 'capsule', x1: 20, y1: -40, x2: 120, y2: -40, r: 10, damage: 11, angle: 35, knockback: 26, growth: 80, effect: 'slash' }] },
    urchin: { name: 'Urchin Burst', category: 'smash', duration: 50, anim: 's_urchin', armor: [{ from: 6, to: 16, threshold: 12 }],
              hitboxes: [{ start: 17, end: 20, x: 0, y: -40, r: 66, damage: 17, angle: 45, knockback: 34, growth: 94, effect: 'slash' }] },
    bristle: { name: 'Bristle', category: 'counter', duration: 40, anim: 's_bristle',
               counter: { from: 4, to: 20, then: 'bristleHit', mul: 1.2 } },
    bristleHit: { name: 'Bristle!', category: 'counter', duration: 30, anim: 's_urchin',
                  hitboxes: [{ start: 2, end: 5, x: 0, y: -40, r: 60, damage: 8, angle: 40, knockback: 30, growth: 80, counterScale: true }] },
  },

  slots: {
    ...BLOB_SLOTS,
    // In blob form, side special is a dash; at very low mass it's the same move (data-only variants are fine too).
    upSpecial: (view) => (view.me.form === 'spike' ? 'upSpecial' : 'upSpecial'),
  },

  behavior: {
    tick(view, api) { api.setBodyScale(0.8 + 0.4 * (view.res.mass / 100)); },
    onKO(view, api) { api.form('base'); },
  },

  ai: { recovery: { base: ['upSpecial', 'sideSpecial'], puddle: ['upSpecial'], spike: ['upSpecial'] }, prefer: ['neutralSpecial'] },
  art,
});
