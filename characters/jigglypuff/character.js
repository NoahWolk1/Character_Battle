// JIGGLYPUFF — the Balloon Pokémon, Smash style. A pink puffball with four midair
// jumps and the best air drift in the game, a lingering Body Kick, a KO Back Kick,
// Rollout, Pound, Sing (puts foes to sleep) and Rest: a point-blank KO flower that
// leaves Jigglypuff fast asleep if it whiffs. Light as a feather, so it dies early.
import { defineCharacter } from '../../shared/char/api.js';
import art from './art.js';

const CENTER = -31; // body center (y) of the round body

export default defineCharacter({
  id: 'jigglypuff',
  name: 'Jigglypuff',
  author: 'Noah',
  description: 'The Balloon Pokémon. Floats with four midair jumps, walls out with aerials, rolls in with Rollout, sings foes to sleep and Rests them off the top.',
  archetype: 'trickster',

  body: {
    collider: { w: 60, h: 62 },
    hurtboxes: {
      default: [{ shape: 'circle', x: 0, y: CENTER, r: 31 }],
      crouch: [{ shape: 'capsule', x1: -16, y1: -22, x2: 16, y2: -22, r: 22 }],
      ball: [{ shape: 'circle', x: 0, y: CENTER, r: 28 }],
    },
  },

  // Light and floaty: minimum weight, slow on the ground, best-in-class air drift, 4 midair jumps.
  stats: { weight: 70, runSpeed: 5.0, airSpeed: 6, jumpHeight: 12.5, doubleJumpHeight: 11.6, airJumps: 3, gravity: 0.5, fallSpeed: 8 },

  vars: { rollCharge: 0 },
  sync: ['rollCharge'],

  statuses: {
    // Sing's lullaby: a short sleep (a capped stun), shown with Zs on the target.
    sleep: { frames: 40, control: 'stun', visual: 'sleep', tint: '#ffb6e1' },
  },

  hitboxes: {
    lullaby: { damage: 1, angle: 90, knockback: 0, growth: 0, setKnockback: 0, effect: 'sing', status: 'sleep', hitlagMul: 0.5 },
  },

  moves: {
    // ── Ground ──
    jab: { name: 'Double Slap', duration: 22, anim: 'slap', effect: 'punch',
      hitboxes: [
        { start: 3, end: 4, x: 38, y: -32, r: 15, damage: 3, angle: 70, knockback: 8, growth: 10 },
        { start: 10, end: 11, x: 40, y: -34, r: 16, damage: 4, angle: 45, knockback: 18, growth: 40 },
      ] },
    side: { name: 'Pivot Kick', duration: 26, anim: 'ftilt', effect: 'kick',
      hitboxes: [{ start: 6, end: 9, shape: 'capsule', x1: 18, y1: -22, x2: 62, y2: -20, r: 13, damage: 9, angle: 32, knockback: 22, growth: 74 }] },
    up: { name: 'Up Kick', duration: 26, anim: 'utilt', effect: 'kick',
      hitboxes: [{ start: 6, end: 10, shape: 'capsule', x1: 10, y1: -50, x2: -8, y2: -92, r: 15, damage: 8, angle: 95, knockback: 24, growth: 70 }] },
    down: { name: 'Low Kick', duration: 22, anim: 'dtilt', effect: 'kick',
      hitboxes: [{ start: 6, end: 8, shape: 'capsule', x1: 18, y1: -8, x2: 66, y2: -6, r: 10, damage: 8, angle: 28, knockback: 20, growth: 52 }] },

    // ── Smashes ──
    sideSmash: { name: 'Smash Kick', duration: 46, anim: 'fsmash', effect: 'kick',
      velocity: [{ start: 12, end: 16, vx: 4 }],
      hitboxes: [{ start: 14, end: 17, shape: 'capsule', x1: 24, y1: -28, x2: 82, y2: -26, r: 17, damage: 16, angle: 36, knockback: 18, growth: 82 }] },
    upSmash: { name: 'Headbutt', duration: 44, anim: 'usmash', effect: 'punch',
      intangible: [13, 18],
      hitboxes: [{ start: 13, end: 18, x: 6, y: -76, r: 24, damage: 15, angle: 88, knockback: 30, growth: 90 }] },
    downSmash: { name: 'Splits Kick', duration: 42, anim: 'dsmash', effect: 'kick',
      hitboxes: [
        { start: 11, end: 14, shape: 'capsule', x1: 14, y1: -8, x2: 74, y2: -8, r: 13, damage: 13, angle: 30, knockback: 28, growth: 84 },
        { start: 11, end: 14, shape: 'capsule', x1: -14, y1: -8, x2: -74, y2: -8, r: 13, damage: 13, angle: 150, knockback: 28, growth: 84, group: 0 },
      ] },

    // ── Aerials: the heart of the character ──
    nair: { name: 'Body Kick', duration: 34, landingLag: 6, anim: 'nair', effect: 'kick',
      hitboxes: [ // same group: the clean early kick, or the weak lingering one
        { start: 6, end: 9, shape: 'capsule', x1: 10, y1: -20, x2: 44, y2: -16, r: 17, damage: 11, angle: 40, knockback: 22, growth: 82, group: 0 },
        { start: 10, end: 28, shape: 'capsule', x1: 10, y1: -20, x2: 40, y2: -18, r: 15, damage: 6, angle: 45, knockback: 16, growth: 50, group: 0 },
      ] },
    fair: { name: 'Dropkick', duration: 30, landingLag: 9, anim: 'fair', effect: 'kick',
      hitboxes: [{ start: 7, end: 10, shape: 'capsule', x1: 22, y1: -26, x2: 58, y2: -24, r: 17, damage: 9, angle: 45, knockback: 20, growth: 72 }] },
    bair: { name: 'Back Kick', duration: 30, landingLag: 9, anim: 'bair', effect: 'kick',
      hitboxes: [{ start: 8, end: 11, shape: 'capsule', x1: -18, y1: -26, x2: -60, y2: -28, r: 17, damage: 13, angle: 145, knockback: 26, growth: 88 }] },
    uair: { name: 'Arm Swipe', duration: 28, landingLag: 7, anim: 'uair', effect: 'punch',
      hitboxes: [{ start: 6, end: 10, shape: 'capsule', x1: 26, y1: -56, x2: -24, y2: -70, r: 17, damage: 9, angle: 82, knockback: 22, growth: 76 }] },
    dair: { name: 'Drill Kick', duration: 40, landingLag: 12, anim: 'dair', effect: 'kick',
      hitboxes: [
        { start: 6, end: 24, shape: 'capsule', x1: 6, y1: -8, x2: 22, y2: 10, r: 16, damage: 1.5, angle: 290, knockback: 8, growth: 0, setKnockback: 30, rehit: 4, group: 0 },
        { start: 26, end: 27, shape: 'capsule', x1: 6, y1: -8, x2: 22, y2: 10, r: 18, damage: 3, angle: 60, knockback: 20, growth: 50, group: 1 },
      ] },

    // ── Specials ──
    neutralSpecial: { // hold to charge: the longer the wind-up, the faster the roll
      name: 'Rollout', duration: 28, anim: 'rolloutCharge', effect: 'earth',
      hold: { button: 'special', from: 8, to: 12, max: 90, release: 'rolloutRoll' },
      gravity: [{ from: 1, to: 28, scale: 0.4 }],
      timeline: [{ at: 4, sfx: 'rollCharge' }],
      update(view, api) { api.vars.set('rollCharge', Math.min(90, view.me.move.holdFrames)); },
    },
    rolloutRoll: { name: 'Rollout!', category: 'special', duration: 46, anim: 'rollout', effect: 'earth',
      hurtboxes: [{ from: 1, to: 36, set: 'ball' }],
      velocity: [{ start: 1, end: 34, vx: 6.5 }],
      hitboxes: [{ start: 6, end: 34, x: 0, y: CENTER, r: 30, damage: 11, angle: 40, knockback: 24, growth: 66 }],
      timeline: [
        { at: 1, emit: 'rollStart' },
        { onHit: true, velocity: { vx: -4, vy: -7 } },   // bonk off the target like the real thing
        { onHit: true, goto: 36 },
      ],
      update(view, api) {
        const m = view.me.move;
        if (m.hitSomething || m.frame > 34) return;
        const k = view.vars.rollCharge / 90;               // 0..1 charge
        api.velocity(6.5 + 3.5 * k, null);
      },
    },
    sideSpecial: { name: 'Pound', duration: 36, anim: 'pound', effect: 'punch',
      velocity: [{ start: 6, end: 14, vx: 4.2, vy: -3.4, airOnly: true }, { start: 6, end: 14, vx: 3.2 }],
      hitboxes: [{ start: 10, end: 13, x: 40, y: -30, r: 22, damage: 11, angle: 42, knockback: 24, growth: 68 }] },
    upSpecial: { name: 'Sing', duration: 84, anim: 'sing', effect: 'sing', helpless: false,
      gravity: [{ from: 1, to: 84, scale: 0.3 }],
      velocity: [{ start: 1, end: 3, vy: -2, airOnly: true }],
      hitboxes: [ // two overlapping rings of song around Jigglypuff
        { start: 22, end: 60, x: 30, y: CENTER, r: 40, use: 'lullaby', rehit: 18, group: 0 },
        { start: 22, end: 60, x: -30, y: CENTER, r: 40, use: 'lullaby', rehit: 18, group: 0 },
      ],
      timeline: [{ at: 18, emit: 'singStart' }, { from: 22, to: 60, every: 12, emit: 'note' }, { at: 20, sfx: 'sing' }] },
    downSpecial: { // Rest: a pinpoint KO flower, then a long nap either way
      name: 'Rest', duration: 150, anim: 'rest', effect: 'rest',
      hitboxes: [{ start: 6, end: 7, x: 0, y: CENTER, r: 22, damage: 15, angle: 88, knockback: 40, growth: 120, hitlagMul: 1.5 }],
      timeline: [{ at: 6, emit: 'restFlash' }, { onHit: true, emit: 'restFlower' }, { from: 30, to: 140, every: 30, emit: 'zzz' }, { at: 6, sfx: 'rest' }] },

    // ── Grab and throws ──
    grab: { name: 'Grab', duration: 30, anim: 'grab', throw: { holdAt: { x: 46, y: -4 } },
      hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 42, y: -32, w: 40, h: 44 }] },
    pummel: { name: 'Slap', duration: 16, anim: 'pummel',
      timeline: [{ at: 5, release: { damage: 1.5, angle: 0, knockback: 0, growth: 0, setKnockback: 0 } }] },
    fthrow: { name: 'Body Slam', duration: 30, anim: 'fthrow',
      timeline: [{ at: 12, release: { damage: 10, angle: 40, knockback: 50, growth: 60 } }] },
    bthrow: { name: 'Backflip Toss', duration: 36, anim: 'bthrow',
      timeline: [{ at: 18, release: { damage: 11, angle: 140, knockback: 52, growth: 66 } }] },
    uthrow: { name: 'Puff Pop', duration: 32, anim: 'uthrow',
      timeline: [{ at: 14, release: { damage: 9, angle: 90, knockback: 48, growth: 68 } }] },
    dthrow: { name: 'Body Rub', duration: 40, anim: 'dthrow',
      timeline: [{ from: 6, to: 24, every: 6, emit: 'rub' }, { at: 28, release: { damage: 9, angle: 75, knockback: 56, growth: 32 } }] },

    taunt: { name: 'Puff Up', duration: 60, anim: 'taunt', timeline: [{ at: 10, emit: 'puffUp' }, { at: 10, sfx: 'taunt' }] },
  },

  ai: {
    preferredRange: 90,
    recovery: ['sideSpecial'],
    prefer: ['nair', 'bair', 'fair'],
    avoid: ['taunt'],
    // Sing → Rest: if a foe is asleep within reach, take the nap.
    hint: (view) => {
      const foe = view.nearestEnemy();
      if (!foe) return null;
      const asleep = foe.statuses.some((s) => s.name === 'sleep');
      const close = Math.abs(foe.x - view.me.x) < 46 && Math.abs(foe.y - view.me.y) < 50;
      return asleep && close ? { press: 'downSpecial' } : null;
    },
  },
  art,
});
