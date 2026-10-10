// BRUH — a huge, pale, disembodied hand on two stubby legs.
// Every hit is a light tap on the damage meter but a cannon on the launch: low damage,
// big base knockback and steep growth. He points, pokes, slaps, punches and yeets junk.
// Hold jump while falling and he flattens out palm-down like a parachute (hover); the
// flat "chute" hurtbox is wide, so floating is safe recovery but a big target.
import { defineCharacter } from '../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'bruh',
  name: 'Bruh',
  author: 'demibabs',
  description: 'A huge pale hand on two little legs. Points, pokes, slaps, punches and throws junk. Barely scratches you, then sends you to the moon. Holds jump to flatten out and parachute down.',
  archetype: 'heavy',

  // Body-local: origin at the feet, +x forward. The hand stands fingers-up, back of the
  // hand toward the camera, thumb sticking out forward; the legs come out of the wrist.
  body: {
    collider: { w: 74, h: 150 },
    hurtboxes: {
      default: [
        { shape: 'rect', x: 0, y: -25, w: 40, h: 50 },                         // legs
        { shape: 'rect', x: 0, y: -81, w: 72, h: 64 },                         // palm
        { shape: 'rect', x: -2, y: -132, w: 64, h: 40 },                       // fingers
        { shape: 'capsule', x1: 32, y1: -74, x2: 50, y2: -102, r: 10 },        // thumb
      ],
      crouch: [
        { shape: 'rect', x: 0, y: -14, w: 40, h: 28 },
        { shape: 'rect', x: 6, y: -44, w: 96, h: 40 },                         // folded over, knuckles forward
      ],
      chute: [                                                                 // flattened palm-down parachute
        { shape: 'rect', x: 0, y: -100, w: 156, h: 30 },
        { shape: 'capsule', x1: 0, y1: -84, x2: 0, y2: -12, r: 18 },           // dangling legs
      ],
    },
  },

  stats: { weight: 122, runSpeed: 6.6, airSpeed: 4.6, jumpHeight: 14.5, doubleJumpHeight: 13,
           airJumps: 1, gravity: 0.72, fallSpeed: 12.5 },
  movement: { hover: { button: 'jump', frames: 120, fallSpeed: 1.2, drift: 1.2 } },

  vars: { chute: false, junk: 0 },
  sync: ['chute', 'junk'],

  hitboxes: {
    bullet: { damage: 3, angle: 32, knockback: 40, growth: 100, effect: 'punch' },
    junk:   { damage: 6, angle: 42, knockback: 50, growth: 120, effect: 'earth' },
  },

  entities: {
    bullet: {                                      // Finger Gun: a little "pew" of pressure
      kind: 'projectile', shape: { shape: 'circle', r: 7 }, life: 46, maxAlive: 2,
      motion: { type: 'linear', speed: 12 }, collide: 'die',
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 10, use: 'bullet' }],
    },
    junk: {                                        // Yeet: whatever he had lying around
      kind: 'projectile', shape: { shape: 'circle', r: 14 }, life: 90, maxAlive: 2,
      motion: { type: 'ballistic', gravity: 0.45 }, collide: 'die',
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 16, use: 'junk' }],
      vars: { kind: 0 },                           // 0 brick, 1 bowling ball, 2 rubber duck, 3 soda can
      think(view, e, api) { if (e.age <= 1) api.evars.set('kind', view.vars.junk); },
    },
  },

  moves: {
    // ── Ground ───────────────────────────────────────────────────────────────
    jab: { name: 'Poke', duration: 18, anim: 'poke', effect: 'punch',
      hitboxes: [{ start: 3, end: 5, shape: 'capsule', x1: 40, y1: -84, x2: 84, y2: -78, r: 13,
                   damage: 3, angle: 35, knockback: 22, growth: 40 }] },
    side: { name: 'Backhand', duration: 32, anim: 'backhand', effect: 'punch',
      hitboxes: [{ start: 9, end: 12, shape: 'capsule', x1: 30, y1: -78, x2: 98, y2: -70, r: 24,
                   damage: 6, angle: 38, knockback: 75, growth: 130 }] },
    up: { name: 'This Guy', duration: 28, anim: 'pointUp', effect: 'punch',
      hitboxes: [{ start: 6, end: 11, shape: 'capsule', x1: 6, y1: -140, x2: 14, y2: -196, r: 18,
                   damage: 5, angle: 88, knockback: 44, growth: 110 }] },
    down: { name: 'Ankle Flick', duration: 24, anim: 'flick', effect: 'punch',
      hitboxes: [{ start: 6, end: 8, shape: 'rect', x: 66, y: -12, w: 62, h: 22,
                   damage: 4, angle: 72, knockback: 36, growth: 50 }] },

    // ── Smashes ──────────────────────────────────────────────────────────────
    sideSmash: { name: 'BRUH Slap', duration: 54, anim: 'slap', effect: 'punch',
      hitboxes: [{ start: 17, end: 20, shape: 'capsule', x1: 30, y1: -80, x2: 110, y2: -70, r: 34,
                   damage: 10, angle: 36, knockback: 42, growth: 110 }],
      timeline: [{ at: 17, emit: 'slap' }, { at: 17, camera: { shake: 5 } }] },
    upSmash: { name: 'High Five', duration: 50, anim: 'highFive', effect: 'punch',
      hitboxes: [{ start: 14, end: 19, shape: 'capsule', x1: 0, y1: -120, x2: 0, y2: -185, r: 36,
                   damage: 9, angle: 88, knockback: 66, growth: 130 }],
      timeline: [{ at: 14, emit: 'clap' }] },
    downSmash: { name: 'Floor Slap', duration: 50, anim: 'floorSlap', effect: 'earth',
      hitboxes: [{ start: 15, end: 18, shape: 'rect', x: 0, y: -14, w: 226, h: 28,
                   damage: 9, angle: 28, knockback: 44, growth: 112 }],
      timeline: [{ at: 15, emit: 'quake' }, { at: 15, camera: { shake: 4 } }] },

    // ── Aerials ──────────────────────────────────────────────────────────────
    nair: { name: 'Jazz Hands', duration: 30, landingLag: 8, anim: 'jazz', effect: 'punch',
      hitboxes: [{ start: 5, end: 12, shape: 'capsule', x1: -50, y1: -96, x2: 50, y2: -96, r: 34,
                   damage: 5, angle: 50, knockback: 50, growth: 120 }] },
    fair: { name: 'Karate Chop', duration: 34, landingLag: 11, anim: 'chop', effect: 'punch',
      hitboxes: [{ start: 9, end: 12, shape: 'capsule', x1: 40, y1: -118, x2: 84, y2: -56, r: 22,
                   damage: 7, angle: 40, knockback: 62, growth: 130 }] },
    bair: { name: 'Swat', duration: 30, landingLag: 10, anim: 'swat', effect: 'punch',
      hitboxes: [{ start: 8, end: 11, shape: 'capsule', x1: -30, y1: -76, x2: -92, y2: -70, r: 24,
                   damage: 7, angle: 145, knockback: 65, growth: 130 }] },
    uair: { name: 'Finger Snap', duration: 28, landingLag: 8, anim: 'snap', effect: 'punch',
      hitboxes: [{ start: 7, end: 10, x: 6, y: -150, r: 30,
                   damage: 5, angle: 86, knockback: 55, growth: 130 }],
      timeline: [{ at: 7, emit: 'snap' }] },
    dair: { name: 'Palm Drop', duration: 38, landingLag: 16, anim: 'palmDrop', effect: 'earth',
      hitboxes: [{ start: 12, end: 16, shape: 'rect', x: 0, y: 4, w: 92, h: 30,
                   damage: 7, angle: 275, knockback: 24, growth: 75 }] },

    // ── Specials ─────────────────────────────────────────────────────────────
    neutralSpecial: { name: 'Finger Gun', duration: 36, anim: 'fingerGun',
      timeline: [{ at: 13, spawn: 'bullet', x: 84, y: -80 }, { at: 13, emit: 'pew' }] },
    sideSpecial: { name: 'Knuckle Sandwich', duration: 44, anim: 'punch', effect: 'punch',
      velocity: [{ start: 8, end: 18, vx: 10 }, { start: 8, end: 18, vy: -0.6, airOnly: true }],
      hitboxes: [{ start: 9, end: 18, x: 56, y: -80, r: 32,
                   damage: 8, angle: 40, knockback: 60, growth: 130 }] },
    upSpecial: { name: 'Thumbs Up', duration: 46, anim: 'thumbsUp', effect: 'punch',
      velocity: [{ start: 7, end: 22, vx: 2, vy: -11 }],
      hitboxes: [{ start: 7, end: 12, shape: 'capsule', x1: 10, y1: -120, x2: 10, y2: -160, r: 26,
                   damage: 6, angle: 85, knockback: 32, growth: 70 }] },
    downSpecial: { name: 'Yeet', duration: 44, anim: 'yeet',
      update(view, api) { if (view.me.move.frame === 1) api.vars.set('junk', Math.floor(view.rng() * 4)); },
      timeline: [{ at: 18, spawn: 'junk', x: 40, y: -100, vx: 7, vy: -8 }, { at: 18, emit: 'yeet' }] },

    // ── Grab and throws: he IS a hand ────────────────────────────────────────
    grab: { name: 'Grab', duration: 30, anim: 'grab',
      hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 60, y: -70, w: 48, h: 58 }] },
    pummel: { name: 'Squeeze', duration: 16, anim: 'squeeze',
      timeline: [{ at: 5, release: { damage: 1.5, angle: 0, knockback: 0, growth: 0, setKnockback: 0, effect: 'punch' } }] },
    fthrow: { name: 'Fastball', duration: 30, anim: 'fthrow',
      timeline: [{ at: 12, release: { damage: 5, angle: 38, knockback: 90, growth: 124, effect: 'punch' } }] },
    bthrow: { name: 'Over the Shoulder', duration: 34, anim: 'bthrow',
      timeline: [{ at: 16, release: { damage: 5, angle: 138, knockback: 86, growth: 124, effect: 'punch' } }] },
    uthrow: { name: 'Toss Up', duration: 32, anim: 'uthrow',
      timeline: [{ at: 13, release: { damage: 4, angle: 90, knockback: 90, growth: 130, effect: 'punch' } }] },
    dthrow: { name: 'Dribble', duration: 32, anim: 'dthrow',
      timeline: [{ at: 14, release: { damage: 4, angle: 78, knockback: 52, growth: 40, effect: 'earth' } }] },

    taunt: { name: 'Bruh.', category: 'taunt', duration: 70, anim: 'bruh', timeline: [{ at: 18, emit: 'bruh' }] },
  },

  behavior: {
    init(view, api) { api.vars.set('chute', false); api.setHurtboxes(null); },
    // Parachute: the engine's hover runs while jump is held and he falls; mirror it into a
    // synced var (for the art) and swap to the wide, flat "chute" hurtbox.
    tick(view, api) {
      const me = view.me;
      const chute = !me.grounded && (me.state === 'air' || me.state === 'attack') && !me.move
        && view.input.held('jump') && me.vy >= 0 && me.vy <= 2;
      if (chute !== view.vars.chute) {
        api.vars.set('chute', chute);
        api.setHurtboxes(chute ? 'chute' : null);
      }
    },
  },

  ai: { preferredRange: 100, recovery: ['upSpecial', 'sideSpecial'], prefer: ['side', 'sideSmash', 'bair', 'fthrow'], grapple: true },
  art,
});
