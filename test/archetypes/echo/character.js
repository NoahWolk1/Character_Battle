// ECHO — a canyon echo spirit (spec §10.3 #10: clone-splitter).
// A hooded bell of violet cloth with a shouting mask and two floating hands.
// Down special splits off "the Echo": a mimic clone that replays Echo's inputs
// 30 frames late (clone hits deal 0.5× damage, engine rule). Side special swaps
// places with the Echo if one is out (script teleport, ≤ 200 px, 1 per airtime).
// Exercises: clone kind + mimic motion (delay 30), cost/else, a SlotFn that reads
// view.entities(), api.teleport/despawn from a move script, drawSelf art.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'echo',
  name: 'Echo',
  author: 'ARCH2 (test archetype)',
  description: 'A canyon echo spirit. Everything it does happens twice: split off a delayed copy of yourself, then swap places with it.',
  archetype: 'trickster',

  body: {
    collider: { w: 50, h: 82 },
    hurtboxes: {
      default: [
        { shape: 'circle', x: 0, y: -30, r: 27 },            // the bell cloak
        { shape: 'circle', x: 0, y: -62, r: 20 },            // hood + mask
      ],
      crouch: [{ shape: 'capsule', x1: -20, y1: -24, x2: 20, y2: -24, r: 24 }],
    },
  },

  stats: { weight: 88, runSpeed: 6.6, airSpeed: 4.6, jumpHeight: 14.5, doubleJumpHeight: 13.5, airJumps: 1, gravity: 0.6, fallSpeed: 10.5 },

  resources: {
    resonance: { max: 100, start: 40, regen: 0.06, onHit: { perDamage: 2 },
                 hud: { style: 'ring', label: 'Resonance', color: '#6ff0e6' } },
  },

  hitboxes: {
    chime: { damage: 3, angle: 70, knockback: 14, growth: 10, effect: 'chime' },
    boom: { damage: 7, angle: 40, knockback: 26, growth: 60, effect: 'sonic' },
  },

  entities: {
    echo: {                                               // the copy: replays inputs 30 frames late
      kind: 'clone', shape: { shape: 'circle', x: 0, y: -40, r: 30 }, life: 420, hp: 18, maxAlive: 1,
      motion: { type: 'mimic', delay: 30 }, scale: 0.9,
    },
    shout: {                                              // a widening ring of sound
      kind: 'projectile', shape: { shape: 'circle', r: 16 }, life: 42, maxAlive: 2,
      motion: { type: 'linear', speed: 7 }, collide: 'pass',
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 18, damage: 6, angle: 35, knockback: 18, growth: 40, effect: 'sonic' }],
    },
  },

  moves: {
    jab: { name: 'Tap', duration: 16, anim: 'poke',
      hitboxes: [{ start: 3, end: 5, x: 32, y: -40, r: 15, damage: 3, angle: 60, knockback: 10, growth: 18 }] },
    side: { name: 'Rebound Slap', duration: 26, anim: 'slap',
      hitboxes: [{ start: 7, end: 10, shape: 'capsule', x1: 24, y1: -42, x2: 74, y2: -38, r: 14, damage: 9, angle: 38, knockback: 22, growth: 74 }] },
    up: { name: 'Overhead Clap', duration: 25, anim: 'clapUp',
      hitboxes: [{ start: 6, end: 10, x: 0, y: -98, r: 24, damage: 8, angle: 88, knockback: 24, growth: 72 }] },
    down: { name: 'Low Hum', duration: 22, anim: 'sweep',
      hitboxes: [{ start: 6, end: 9, shape: 'rect', x: 34, y: -8, w: 70, h: 16, damage: 6, angle: 75, knockback: 20, growth: 50 }] },

    sideSmash: { name: 'Sonic Boom', duration: 46, anim: 'boom', effect: 'sonic',
      hitboxes: [{ start: 14, end: 17, x: 58, y: -42, r: 30, damage: 15, angle: 38, knockback: 26, growth: 84 }] },
    upSmash: { name: 'Cathedral Bell', duration: 44, anim: 'bell', effect: 'chime',
      hitboxes: [{ start: 12, end: 17, shape: 'capsule', x1: 0, y1: -60, x2: 0, y2: -130, r: 26, damage: 14, angle: 90, knockback: 30, growth: 88 }] },
    downSmash: { name: 'Ground Ripple', duration: 42, anim: 'ripple', effect: 'sonic',
      hitboxes: [{ start: 11, end: 14, shape: 'rect', x: 0, y: -10, w: 170, h: 22, damage: 13, angle: 30, knockback: 28, growth: 84 }] },

    nair: { name: 'Ring Out', duration: 28, landingLag: 8, anim: 'ring',
      hitboxes: [{ start: 5, end: 15, x: 0, y: -42, r: 40, damage: 7, angle: 50, knockback: 18, growth: 58 }] },
    fair: { name: 'Forward Clap', duration: 28, landingLag: 10, anim: 'clap',
      hitboxes: [{ start: 8, end: 11, x: 48, y: -42, r: 22, damage: 10, angle: 40, knockback: 24, growth: 80 }] },
    bair: { name: 'Back Hand', duration: 26, landingLag: 9, anim: 'backhand',
      hitboxes: [{ start: 6, end: 9, x: -46, y: -40, r: 22, damage: 11, angle: 145, knockback: 26, growth: 84 }] },
    uair: { name: 'Rising Chime', duration: 26, landingLag: 7, anim: 'clapUp',
      hitboxes: [{ start: 5, end: 10, x: 0, y: -96, r: 24, damage: 8, angle: 86, knockback: 22, growth: 76 }] },
    dair: { name: 'Drop Note', duration: 32, landingLag: 14, anim: 'drop',
      hitboxes: [{ start: 9, end: 12, x: 0, y: 4, r: 22, damage: 10, angle: 280, knockback: 16, growth: 60 }] },

    neutralSpecial: { name: 'Shout', duration: 34, anim: 'shout', effect: 'sonic',
      timeline: [{ at: 12, spawn: 'shout', x: 30, y: -50, vx: 7 }, { at: 12, emit: 'shout' }] },

    // Side special: Swap if an Echo is out (SlotFn below), else a short echoing dash.
    sideSpecial: { name: 'Echo Dash', duration: 32, anim: 'dash', oncePerAirtime: true,
      velocity: [{ start: 5, end: 14, vx: 9, vy: -2 }],
      hitboxes: [{ start: 6, end: 14, x: 22, y: -40, r: 26, damage: 6, angle: 45, knockback: 20, growth: 46 }] },
    swap: { name: 'Swap', category: 'special', duration: 30, anim: 'swap', oncePerAirtime: true,
      timeline: [{ at: 8, emit: 'swap' }],
      update(view, api) {
        if (view.me.move.frame !== 9) return;
        const c = view.entities('echo')[0];
        if (!c) return;
        // api.teleport dx is facing-relative: convert the world offset.
        api.teleport((c.x - view.me.x) * view.me.facing, c.y - view.me.y);
        api.despawn(c.id);
      } },

    upSpecial: { name: 'Reverb Rise', duration: 40, anim: 'rise', helpless: true,
      velocity: [{ start: 6, end: 20, vy: -12 }],
      hitboxes: [{ start: 6, end: 18, x: 0, y: -40, r: 30, use: 'chime', rehit: 6 }] },

    downSpecial: { name: 'Split', duration: 36, anim: 'split', cost: { resonance: 40 }, else: 'hum',
      timeline: [{ at: 15, emit: 'split' }, { at: 16, spawn: 'echo', x: -36, y: 0 }] },
    hum: { name: 'Hum', category: 'utility', duration: 24, anim: 'hum',
      hitboxes: [{ start: 6, end: 12, x: 0, y: -42, r: 36, use: 'chime' }] },

    grab: { name: 'Hand Snare', duration: 30, anim: 'grab',
      hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 40, y: -40, w: 40, h: 46 }] },
    pummel: { name: 'Ear Ring', duration: 16, anim: 'pummel',
      timeline: [{ at: 5, release: { damage: 1.5, angle: 0, knockback: 0, growth: 0, setKnockback: 0, effect: 'chime' } }] },
    fthrow: { name: 'Feedback', duration: 30, anim: 'boom',
      timeline: [{ at: 12, release: { damage: 8, angle: 38, knockback: 50, growth: 60 } }] },
    bthrow: { name: 'Over the Shoulder', duration: 34, anim: 'backhand',
      timeline: [{ at: 16, release: { damage: 9, angle: 140, knockback: 52, growth: 62, effect: 'sonic' } }] },
    uthrow: { name: 'Bell Toss', duration: 32, anim: 'bell',
      timeline: [{ at: 14, release: { damage: 7, angle: 90, knockback: 50, growth: 64, effect: 'chime' } }] },
    dthrow: { name: 'Floor Hum', duration: 32, anim: 'ripple',
      timeline: [{ at: 15, release: { damage: 6, angle: 75, knockback: 56, growth: 30, effect: 'sonic' } }] },

    taunt: { name: 'Hello? (hello?)', category: 'taunt', duration: 60, anim: 'hello', timeline: [{ at: 10, emit: 'hello' }] },
  },

  // Swap replaces the dash only while an Echo exists.
  slots: { sideSpecial: (view) => (view.entities('echo').length ? 'swap' : 'sideSpecial') },

  ai: { recovery: ['upSpecial', 'sideSpecial'], prefer: ['downSpecial', 'neutralSpecial'] },
  art,
});
