// VENDY — a sentient vending machine (ARCH2 invention #1).
// A 120-px-tall heavy with passive armor. Landing hits earns coins; Dispense spends
// one and a seeded roll (view.rng) picks the product: a fizzing soda can (bouncing
// projectile), a candy bar (ground trap that trips) or a bag of chips (walker minion
// that bursts when it expires). Restock is a held move that refills coins under armor.
// Exercises: big-body area refund, passive armor, resource gating with cost/else,
// script spawns chosen by rng, onExpire → burst zone chain, hold loops, `every` timeline.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

const PRODUCTS = ['soda', 'candy', 'chips'];

export default defineCharacter({
  id: 'vendy',
  name: 'Vendy',
  author: 'ARCH2 (test archetype)',
  description: 'A sentient vending machine. Hits earn coins, coins buy random snacks with very real consequences. Heavy, armored, and out of order more than it admits.',
  archetype: 'heavy',

  body: {
    collider: { w: 70, h: 120 },
    hurtboxes: {
      default: [{ shape: 'rect', x: 0, y: -60, w: 70, h: 120 }],
      crouch: [{ shape: 'rect', x: 0, y: -46, w: 74, h: 92 }],
    },
    armor: { threshold: 2 },
  },

  stats: { weight: 128, runSpeed: 5.2, airSpeed: 3.6, jumpHeight: 13, doubleJumpHeight: 12, airJumps: 1, gravity: 0.8, fallSpeed: 13 },

  resources: {
    coins: { max: 8, start: 3, onHit: { perDamage: 0.2 }, hud: { style: 'pips', label: 'Coins', color: '#ffd34d' } },
  },
  vars: { lastProduct: 'soda' },
  sync: ['lastProduct'],

  hitboxes: {
    fizz: { damage: 3, angle: 70, knockback: 18, growth: 30, effect: 'soda' },
    trip: { damage: 4, angle: 85, knockback: 30, growth: 20, effect: 'candy', status: { name: 'stun', frames: 20 } },
    crunch: { damage: 6, angle: 50, knockback: 22, growth: 50, effect: 'chips' },
  },

  // Circles for the moving entities (round snacks bounce and roll best); the candy trap is a rect.
  entities: {
    soda: {
      kind: 'projectile', shape: { shape: 'circle', x: 0, y: 0, r: 12 }, life: 110, maxAlive: 2,
      motion: { type: 'ballistic', gravity: 0.4 }, collide: 'bounce', maxBounces: 3,
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 14, damage: 7, angle: 45, knockback: 20, growth: 46, effect: 'soda' }],
    },
    candy: {
      kind: 'trap', shape: { shape: 'rect', x: 0, y: -5, w: 34, h: 10 }, life: 420, hp: 4, maxAlive: 2,
      motion: { type: 'stationary', snapToGround: true },
      hitboxes: [{ shape: 'rect', x: 0, y: -6, w: 36, h: 14, use: 'trip' }],
    },
    chips: {
      kind: 'minion', shape: { shape: 'circle', x: 0, y: -16, r: 16 }, life: 200, hp: 6, maxAlive: 1,
      motion: { type: 'walker', speed: 2.2 }, collide: 'walk',
      hitboxes: [{ shape: 'rect', x: 0, y: -16, w: 28, h: 32, use: 'crunch', rehit: 40 }],
      onExpire: [{ spawn: 'chipBurst' }, { emit: 'crunch' }],
      onDeath: [{ spawn: 'chipBurst' }],
    },
    chipBurst: {
      kind: 'zone', shape: { shape: 'circle', x: 0, y: -16, r: 40 }, life: 14,
      motion: { type: 'stationary' },
      hitboxes: [{ start: 2, end: 5, shape: 'circle', x: 0, y: -16, r: 42, damage: 7, angle: 70, knockback: 24, growth: 50, effect: 'chips' }],
    },
  },

  moves: {
    jab: { name: 'Glove Pop', duration: 18, anim: 'glove',
      hitboxes: [{ start: 4, end: 6, x: 54, y: -60, r: 16, damage: 4, angle: 60, knockback: 12, growth: 20 }] },
    side: { name: 'Door Swing', duration: 30, anim: 'door',
      hitboxes: [{ start: 9, end: 12, shape: 'rect', x: 62, y: -64, w: 46, h: 70, damage: 10, angle: 38, knockback: 24, growth: 78 }] },
    up: { name: 'Marquee Bonk', duration: 28, anim: 'hop',
      hitboxes: [{ start: 7, end: 11, shape: 'rect', x: 0, y: -132, w: 70, h: 24, damage: 9, angle: 88, knockback: 26, growth: 74 }] },
    down: { name: 'Coin Return', duration: 24, anim: 'flap',
      hitboxes: [{ start: 7, end: 10, shape: 'rect', x: 50, y: -10, w: 50, h: 18, damage: 6, angle: 78, knockback: 22, growth: 48 }] },

    sideSmash: { name: 'Mega Glove', duration: 50, anim: 'glove', armor: [{ from: 6, to: 16, threshold: 10 }],
      hitboxes: [{ start: 17, end: 20, x: 84, y: -60, r: 26, damage: 17, angle: 40, knockback: 23, growth: 78 }] },
    upSmash: { name: 'Soda Geyser', duration: 46, anim: 'geyser',
      hitboxes: [{ start: 13, end: 18, shape: 'capsule', x1: 0, y1: -126, x2: 0, y2: -200, r: 26, damage: 15, angle: 90, knockback: 30, growth: 88, effect: 'soda' }] },
    downSmash: { name: 'Tip Over', duration: 50, anim: 'tip',
      hitboxes: [{ start: 15, end: 18, shape: 'rect', x: 60, y: -14, w: 110, h: 28, damage: 16, angle: 50, knockback: 26, growth: 82 }] },

    nair: { name: 'Shake It', duration: 30, landingLag: 10, anim: 'shake',
      hitboxes: [{ start: 6, end: 16, shape: 'rect', x: 0, y: -60, w: 76, h: 64, damage: 8, angle: 55, knockback: 18, growth: 60 }] },
    fair: { name: 'Air Glove', duration: 30, landingLag: 12, anim: 'glove',
      hitboxes: [{ start: 9, end: 12, x: 60, y: -62, r: 22, damage: 11, angle: 40, knockback: 24, growth: 80 }] },
    bair: { name: 'Back Panel', duration: 30, landingLag: 11, anim: 'back',
      hitboxes: [{ start: 8, end: 11, shape: 'rect', x: -44, y: -60, w: 30, h: 100, damage: 12, angle: 145, knockback: 26, growth: 82 }] },
    uair: { name: 'Lid Flip', duration: 28, landingLag: 9, anim: 'hop',
      hitboxes: [{ start: 6, end: 11, shape: 'rect', x: 0, y: -132, w: 70, h: 24, damage: 9, angle: 86, knockback: 22, growth: 76 }] },
    dair: { name: 'Anvil Mode', duration: 38, landingLag: 18, anim: 'drop', gravity: [{ from: 8, to: 30, scale: 1.5 }],
      hitboxes: [{ start: 10, end: 20, shape: 'rect', x: 0, y: -2, w: 66, h: 18, damage: 12, angle: 280, knockback: 15, growth: 58 }] },

    // Dispense: costs a coin; the roll happens in the script (seeded per fighter).
    neutralSpecial: { name: 'Dispense', duration: 36, anim: 'dispense', cost: { coins: 1 }, else: 'outOfOrder',
      update(view, api) {
        if (view.me.move.frame !== 12) return;
        const pick = PRODUCTS[Math.floor(view.rng() * PRODUCTS.length)] || 'soda';
        api.vars.set('lastProduct', pick);
        if (pick === 'soda') api.spawn('soda', { x: 40, y: -20, vx: 6, vy: -7 });
        else if (pick === 'candy') api.spawn('candy', { x: 70, y: 0 });
        else api.spawn('chips', { x: 50, y: 0 });
        api.emit('dispense', { p: pick });
      } },
    outOfOrder: { name: 'Out of Order', category: 'special', duration: 30, anim: 'broken',
      timeline: [{ at: 6, emit: 'outOfOrder' }],
      hitboxes: [{ start: 8, end: 12, x: 0, y: -60, r: 42, damage: 3, angle: 60, knockback: 16, growth: 20, effect: 'electric' }] },

    sideSpecial: { name: 'Shoulder Charge', duration: 40, anim: 'charge', oncePerAirtime: true,
      armor: [{ from: 6, to: 20, threshold: 8 }],
      velocity: [{ start: 6, end: 20, vx: 8 }],
      hitboxes: [{ start: 8, end: 20, shape: 'rect', x: 40, y: -60, w: 30, h: 100, damage: 10, angle: 40, knockback: 26, growth: 64 }] },
    upSpecial: { name: 'Soda Rocket', duration: 44, anim: 'rocket', helpless: true,
      velocity: [{ start: 6, end: 24, vy: -11 }],
      hitboxes: [{ start: 6, end: 22, shape: 'rect', x: 0, y: 10, w: 40, h: 30, use: 'fizz', rehit: 6 }] },

    // Restock: hold special to keep refilling (loops 10→22), one coin every 20 frames.
    downSpecial: { name: 'Restock', duration: 36, anim: 'restock', armor: [{ from: 4, to: 30, threshold: 4 }],
      hold: { button: 'special', from: 10, to: 22, max: 120 },
      timeline: [{ from: 10, to: 22, every: 12, resource: { name: 'coins', add: 0.25 } }, { at: 10, emit: 'restock' }] },

    grab: { name: 'Coin Slot', duration: 34, anim: 'grab',
      hitboxes: [{ start: 8, end: 10, kind: 'grab', shape: 'rect', x: 52, y: -60, w: 44, h: 60 }] },
    pummel: { name: 'Keypad', duration: 16, anim: 'shake',
      timeline: [{ at: 5, release: { damage: 2, angle: 0, knockback: 0, growth: 0, setKnockback: 0 } }] },
    fthrow: { name: 'Refund', duration: 34, anim: 'door',
      timeline: [{ at: 14, release: { damage: 9, angle: 38, knockback: 52, growth: 62 } }] },
    bthrow: { name: 'Recycling', duration: 36, anim: 'back',
      timeline: [{ at: 17, release: { damage: 10, angle: 140, knockback: 54, growth: 64 } }] },
    uthrow: { name: 'Pop the Top', duration: 34, anim: 'geyser',
      timeline: [{ at: 15, release: { damage: 8, angle: 90, knockback: 52, growth: 66, effect: 'soda' } }] },
    dthrow: { name: 'Tip Onto', duration: 36, anim: 'tip',
      timeline: [{ at: 16, release: { damage: 7, angle: 75, knockback: 56, growth: 32 } }] },

    taunt: { name: 'Exact Change Only', category: 'taunt', duration: 60, anim: 'taunt', timeline: [{ at: 10, emit: 'jingle' }] },
  },

  ai: { recovery: ['upSpecial', 'sideSpecial'], prefer: ['neutralSpecial', 'sideSmash'] },
  art,
});
