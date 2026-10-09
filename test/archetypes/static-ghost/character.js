// STATIC GHOST — a poltergeist living in a dead TV channel (spec §10.3 #12).
// A sheet of TV snow with a CRT for a face. It phases through things: Channel Surf
// is a dash with a 12-frame timeline `intangible`, Fade Out asks api.intangible(20)
// from a script, and Ghost Step has a 12-frame action window. Together they want far
// more than the Governor's 45 frames per 300, so back-to-back phasing gets denied:
// the scripts see view.budget().intangibleLeft, emit 'noSignal', and the art tears
// the picture while the move "should" be phased but isn't.
// Exercises: all three intangibility sources, the budget view, denial feedback.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'static-ghost',
  name: 'Static Ghost',
  author: 'ARCH2 (test archetype)',
  description: 'A poltergeist living in a dead TV channel. Phases through attacks and people, until the signal drops out.',
  archetype: 'trickster',

  body: {
    collider: { w: 52, h: 86 },
    hurtboxes: {
      default: [
        { shape: 'rect', x: 0, y: -66, w: 44, h: 36 },              // the CRT head
        { shape: 'capsule', x1: 0, y1: -44, x2: 0, y2: -18, r: 22 }, // the static sheet
      ],
      crouch: [{ shape: 'rect', x: 0, y: -28, w: 56, h: 56 }],
    },
  },

  stats: { weight: 84, runSpeed: 6.2, airSpeed: 4.9, jumpHeight: 14, doubleJumpHeight: 13, airJumps: 1, gravity: 0.56, fallSpeed: 9.5 },
  movement: { hover: { button: 'jump', frames: 60, fallSpeed: 1.6, drift: 1 } },

  vars: { fadeCd: 0 },
  sync: ['fadeCd'],

  hitboxes: {
    snow: { damage: 2, angle: 60, knockback: 8, growth: 8, effect: 'static' },
    jumpscare: { damage: 9, angle: 50, knockback: 30, growth: 70, effect: 'static' },
  },

  entities: {
    testPattern: {                                           // a drifting card of color bars
      kind: 'projectile', shape: { shape: 'rect', x: 0, y: 0, w: 30, h: 22 }, life: 70, maxAlive: 2,
      motion: { type: 'linear', speed: 6 }, collide: 'pass',
      hitboxes: [{ shape: 'rect', x: 0, y: 0, w: 32, h: 24, damage: 6, angle: 40, knockback: 16, growth: 40, effect: 'static' }],
    },
  },

  moves: {
    jab: { name: 'Static Pop', duration: 16, anim: 'pop',
      hitboxes: [{ start: 3, end: 5, x: 34, y: -50, r: 16, damage: 3, angle: 60, knockback: 10, growth: 18, effect: 'static' }] },
    side: { name: 'Channel Slap', duration: 26, anim: 'slap',
      hitboxes: [{ start: 7, end: 10, shape: 'capsule', x1: 24, y1: -44, x2: 80, y2: -40, r: 14, damage: 9, angle: 38, knockback: 22, growth: 74 }] },
    up: { name: 'Antenna Zap', duration: 25, anim: 'antenna',
      hitboxes: [{ start: 6, end: 10, x: 0, y: -112, r: 22, damage: 8, angle: 88, knockback: 24, growth: 72, effect: 'electric' }] },
    down: { name: 'Low Signal', duration: 22, anim: 'low',
      hitboxes: [{ start: 6, end: 9, shape: 'rect', x: 34, y: -8, w: 70, h: 16, use: 'snow', damage: 5, knockback: 20, growth: 46, angle: 78 }] },
    sideSmash: { name: 'Broadcast', duration: 46, anim: 'broadcast',
      hitboxes: [{ start: 14, end: 18, shape: 'rect', x: 66, y: -60, w: 80, h: 34, damage: 15, angle: 38, knockback: 26, growth: 84, effect: 'static' }] },
    upSmash: { name: 'Rabbit Ears', duration: 44, anim: 'ears',
      hitboxes: [{ start: 12, end: 17, shape: 'capsule', x1: 0, y1: -90, x2: 0, y2: -150, r: 22, damage: 14, angle: 90, knockback: 30, growth: 88, effect: 'electric' }] },
    downSmash: { name: 'Snowstorm', duration: 42, anim: 'storm',
      hitboxes: [{ start: 11, end: 14, shape: 'rect', x: 0, y: -14, w: 170, h: 28, damage: 13, angle: 30, knockback: 28, growth: 84, effect: 'static' }] },
    nair: { name: 'Interference', duration: 28, landingLag: 8, anim: 'spin',
      hitboxes: [{ start: 5, end: 15, x: 0, y: -46, r: 40, damage: 7, angle: 50, knockback: 18, growth: 58, effect: 'static' }] },
    fair: { name: 'Remote Jab', duration: 28, landingLag: 10, anim: 'slap',
      hitboxes: [{ start: 8, end: 11, x: 50, y: -48, r: 22, damage: 10, angle: 40, knockback: 24, growth: 80 }] },
    bair: { name: 'Rear Projection', duration: 26, landingLag: 9, anim: 'back',
      hitboxes: [{ start: 6, end: 9, x: -48, y: -46, r: 22, damage: 11, angle: 145, knockback: 26, growth: 84, effect: 'static' }] },
    uair: { name: 'Vertical Hold', duration: 26, landingLag: 7, anim: 'antenna',
      hitboxes: [{ start: 5, end: 10, x: 0, y: -108, r: 24, damage: 8, angle: 86, knockback: 22, growth: 76, effect: 'electric' }] },
    dair: { name: 'Tube Drop', duration: 32, landingLag: 14, anim: 'drop',
      hitboxes: [{ start: 9, end: 12, x: 0, y: 2, r: 22, damage: 10, angle: 280, knockback: 16, growth: 60 }] },

    neutralSpecial: { name: 'Test Pattern', duration: 32, anim: 'broadcast',
      timeline: [{ at: 11, spawn: 'testPattern', x: 34, y: -62, vx: 6 }] },

    // Phase-through dash: timeline intangibility (governed; up to 20 frames per grant).
    sideSpecial: { name: 'Channel Surf', duration: 38, anim: 'surf', oncePerAirtime: true,
      timeline: [{ at: 3, intangible: 12 }],                  // static cap: 12 per action (W220)
      velocity: [{ start: 4, end: 20, vx: 10, vy: 0 }],
      gravity: [{ from: 4, to: 20, scale: 0.3 }],
      hitboxes: [{ start: 21, end: 24, x: 20, y: -46, r: 30, use: 'jumpscare' }],
      update(view, api) {
        if (view.me.move.frame === 2 && view.budget().intangibleLeft < 12) api.emit('noSignal', { left: view.budget().intangibleLeft });
      } },

    upSpecial: { name: 'Signal Boost', duration: 40, anim: 'boost', helpless: true,
      velocity: [{ start: 6, end: 22, vy: -11 }],
      hitboxes: [{ start: 6, end: 20, x: 0, y: -50, r: 30, use: 'snow', rehit: 6 }] },

    // Script-granted intangibility: vanish, drift, reappear with a jump scare.
    // While Fade Out cools down (var gate), down special becomes Ghost Step instead.
    downSpecial: { name: 'Fade Out', duration: 44, anim: 'fade', requires: { var: { fadeCd: 0 } }, else: 'ghostStep',
      hitboxes: [{ start: 30, end: 33, x: 10, y: -46, r: 36, use: 'jumpscare' }],
      update(view, api) {
        if (view.me.move.frame !== 4) return;
        if (view.budget().intangibleLeft >= 20) api.intangible(20);
        else { api.intangible(20); api.emit('noSignal', { left: view.budget().intangibleLeft }); } // still asks: the Governor denies
        api.vars.set('fadeCd', 90);
      } },

    // Action-window intangibility: a short sidestep through a hit (12 f static cap).
    ghostStep: { name: 'Ghost Step', category: 'utility', duration: 26, anim: 'step', intangible: [3, 14],
      velocity: [{ start: 3, end: 14, vx: 5 }] },

    grab: { name: 'Possess', duration: 30, anim: 'grab',
      hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 42, y: -46, w: 42, h: 52 }] },
    pummel: { name: 'Bad Reception', duration: 16, anim: 'pop',
      timeline: [{ at: 5, release: { damage: 1.5, angle: 0, knockback: 0, growth: 0, setKnockback: 0, effect: 'static' } }] },
    fthrow: { name: 'Change Channel', duration: 30, anim: 'slap',
      timeline: [{ at: 12, release: { damage: 8, angle: 38, knockback: 50, growth: 60, effect: 'static' } }] },
    bthrow: { name: 'Rewind', duration: 34, anim: 'back',
      timeline: [{ at: 16, release: { damage: 9, angle: 140, knockback: 52, growth: 62, effect: 'static' } }] },
    uthrow: { name: 'Uplink', duration: 32, anim: 'ears',
      timeline: [{ at: 14, release: { damage: 7, angle: 90, knockback: 50, growth: 64, effect: 'electric' } }] },
    dthrow: { name: 'Off Switch', duration: 32, anim: 'low',
      timeline: [{ at: 15, release: { damage: 6, angle: 75, knockback: 56, growth: 30, effect: 'static' } }] },

    taunt: { name: 'Boo!', category: 'taunt', duration: 50, anim: 'boo', timeline: [{ at: 12, emit: 'boo' }] },
  },

  behavior: {
    tick(view, api) { if (view.vars.fadeCd > 0) api.vars.set('fadeCd', view.vars.fadeCd - 1); },
  },

  ai: { recovery: ['upSpecial', 'sideSpecial'], prefer: ['sideSpecial', 'downSpecial'] },
  art,
});
