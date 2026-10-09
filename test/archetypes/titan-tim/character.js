// TITAN TIM — a lumberjack who grows into a giant (spec §10.3 #8). Archetype stress
// test for: scaleRange [0.6, 1.6] driven by KOs and percent (area priced at the 0.6
// minimum), collider push-out when growing next to the stage, and grabs at any size.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

const MIN = 0.6, MAX = 1.6;

export default defineCharacter({
  id: 'titan-tim',
  name: 'Titan Tim',
  author: 'archetype suite',
  description: 'Starts the match knee-high and grows with every KO he scores and every hit he takes (it makes him mad). At full size he is a mountain in overalls; lose a stock and he shrinks back a size.',
  archetype: 'grappler',

  body: {
    collider: { w: 64, h: 110 },
    hurtboxes: {
      default: [
        { shape: 'rect', x: 0, y: -70, w: 58, h: 52 },
        { shape: 'circle', x: 4, y: -106, r: 16 },
        { shape: 'rect', x: 0, y: -22, w: 46, h: 44 },
      ],
      crouch: [{ shape: 'rect', x: 0, y: -38, w: 66, h: 76 }],
    },
    scaleRange: [MIN, MAX], // priced at 0.6: small Tim pays for being small
  },
  stats: { weight: 116, runSpeed: 5.6, airSpeed: 3.8, jumpHeight: 13, doubleJumpHeight: 12, airJumps: 1, gravity: 0.78, fallSpeed: 12.5 },

  vars: { kills: 0, lastHitId: '', lastHitAt: -9999 },
  sync: ['kills'],

  hitboxes: {
    fist: { damage: 9, angle: 40, knockback: 22, growth: 76, effect: 'heavy' },
  },

  entities: {
    boulder: {
      kind: 'projectile', shape: { shape: 'circle', r: 14 }, life: 90, maxAlive: 1,
      motion: { type: 'ballistic', gravity: 0.45 }, collide: 'bounce', maxBounces: 1,
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 16, damage: 9, angle: 45, knockback: 20, growth: 56, effect: 'heavy' }],
    },
  },

  moves: {
    jab: { name: 'Flick', duration: 18, anim: 'flick',
      hitboxes: [{ start: 4, end: 6, x: 44, y: -74, r: 16, damage: 4, angle: 60, knockback: 12, growth: 22 }] },
    side: { name: 'Backhand', duration: 30, anim: 'backhand',
      hitboxes: [{ start: 9, end: 12, x: 66, y: -72, r: 22, use: 'fist' }] },
    up: { name: 'Head Bonk', duration: 30, anim: 'bonk',
      hitboxes: [{ start: 8, end: 12, x: 6, y: -128, r: 24, damage: 9, angle: 88, knockback: 24, growth: 74 }] },
    down: { name: 'Toe Stub', duration: 26, anim: 'stub',
      hitboxes: [{ start: 7, end: 9, x: 40, y: -10, r: 18, damage: 6, angle: 80, knockback: 24, growth: 44 }] },
    sideSmash: { name: 'Colossus Punch', duration: 50, anim: 'colossus', armor: [{ from: 6, to: 16, threshold: 8 }],
      hitboxes: [{ start: 17, end: 20, x: 84, y: -74, r: 28, damage: 17, angle: 38, knockback: 22, growth: 76, effect: 'heavy' }] },
    upSmash: { name: 'Sky Clap', duration: 46, anim: 'clap',
      hitboxes: [{ start: 14, end: 18, shape: 'capsule', x1: -30, y1: -140, x2: 40, y2: -140, r: 26, damage: 15, angle: 90, knockback: 28, growth: 88 }] },
    downSmash: { name: 'Earthshaker', duration: 48, anim: 'earthshaker',
      hitboxes: [{ start: 16, end: 19, shape: 'rect', x: 0, y: -10, w: 190, h: 22, damage: 14, angle: 32, knockback: 28, growth: 84, effect: 'heavy' }],
      timeline: [{ at: 16, camera: { shake: 5 } }, { at: 16, emit: 'quake' }] },
    nair: { name: 'Belly Flop', duration: 30, landingLag: 12, anim: 'flop',
      hitboxes: [{ start: 7, end: 16, x: 0, y: -60, r: 38, damage: 8, angle: 50, knockback: 20, growth: 60 }] },
    fair: { name: 'Hammer Fist', duration: 34, landingLag: 14, anim: 'hammer',
      hitboxes: [{ start: 11, end: 14, group: 0, x: 54, y: -50, r: 26, damage: 12, angle: 290, knockback: 14, growth: 56, effect: 'heavy' },
        { start: 11, end: 14, group: 0, x: 40, y: -84, r: 20, damage: 10, angle: 45, knockback: 22, growth: 70 }] },
    bair: { name: 'Back Elbow', duration: 28, landingLag: 10, anim: 'elbow',
      hitboxes: [{ start: 7, end: 10, x: -50, y: -74, r: 22, damage: 11, angle: 145, knockback: 26, growth: 84 }] },
    uair: { name: 'Antler Bonk', duration: 28, landingLag: 9, anim: 'antler',
      hitboxes: [{ start: 6, end: 11, x: 4, y: -134, r: 24, damage: 8, angle: 86, knockback: 22, growth: 76 }] },
    dair: { name: 'Boot Drop', duration: 36, landingLag: 18, anim: 'boot',
      hitboxes: [{ start: 10, end: 14, x: 2, y: 4, r: 24, damage: 11, angle: 285, knockback: 16, growth: 54 }] },
    neutralSpecial: { name: 'Boulder Toss', duration: 42, anim: 'toss',
      timeline: [{ at: 16, spawn: 'boulder', x: 30, y: -120, vx: 7, vy: -7 }] },
    sideSpecial: { name: 'Giant Stride', duration: 40, anim: 'stride', oncePerAirtime: true, armor: [{ from: 6, to: 20, threshold: 6 }],
      velocity: [{ start: 6, end: 20, vx: 9 }],
      hitboxes: [{ start: 8, end: 20, x: 36, y: -60, r: 30, damage: 8, angle: 40, knockback: 26, growth: 56 }] },
    upSpecial: { name: 'Titan Leap', duration: 46, anim: 'leap', helpless: true,
      velocity: [{ start: 7, end: 24, vy: -11.5, vx: 1.5 }],
      hitboxes: [{ start: 7, end: 13, x: 4, y: -120, r: 30, damage: 7, angle: 85, knockback: 24, growth: 48 }] },
    downSpecial: { name: 'Ground Slam', duration: 44, anim: 'slam', requires: { grounded: true }, else: 'boot',
      hitboxes: [{ start: 15, end: 18, shape: 'capsule', x1: -70, y1: -12, x2: 70, y2: -12, r: 24, damage: 11, angle: 80, knockback: 30, growth: 50 }],
      timeline: [{ at: 15, camera: { shake: 4 } }, { at: 15, emit: 'quake' }] },
    boot: { name: 'Boot Drop', category: 'aerial', duration: 36, landingLag: 18, anim: 'boot',
      hitboxes: [{ start: 10, end: 14, x: 2, y: 4, r: 24, damage: 11, angle: 285, knockback: 16, growth: 54 }] },

    grab: { name: 'Big Mitt', duration: 32, anim: 'grab', throw: { holdAt: { x: 46, y: -70 } },
      hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 48, y: -64, w: 46, h: 60 }] },
    pummel: { name: 'Squeeze', duration: 16, anim: 'squeeze', timeline: [{ at: 5, release: { damage: 2, angle: 0, knockback: 0, growth: 0, setKnockback: 0 } }] },
    fthrow: { name: 'Pocket Toss', duration: 30, anim: 'fthrow', timeline: [{ at: 12, release: { damage: 9, angle: 40, knockback: 50, growth: 66 } }] },
    bthrow: { name: 'Over the Shoulder', duration: 34, anim: 'bthrow', timeline: [{ at: 16, release: { damage: 10, angle: 140, knockback: 52, growth: 68 } }] },
    uthrow: { name: 'Sky High', duration: 32, anim: 'uthrow', timeline: [{ at: 14, release: { damage: 8, angle: 90, knockback: 50, growth: 70 } }] },
    dthrow: { name: 'Stomp Pin', duration: 34, anim: 'dthrow', timeline: [{ at: 16, release: { damage: 7, angle: 75, knockback: 56, growth: 30 } }] },
    taunt: { name: 'Flex', duration: 60, anim: 'flex', timeline: [{ at: 10, emit: 'flex' }] },
  },

  behavior: {
    tick(view, api) {
      const v = view.vars;
      // KO credit: an enemy hit in the last 4 s just disappeared (dead) from the enemy list.
      if (v.lastHitId && view.frame - v.lastHitAt < 240 && !view.enemies().some((e) => e.id === v.lastHitId)) {
        api.vars.set('kills', Math.min(5, v.kills + 1));
        api.vars.set('lastHitId', '');
        api.emit('grow');
      }
      const kills = view.vars.kills;
      api.setBodyScale(Math.min(MAX, MIN + 0.25 * kills + Math.min(0.35, view.me.percent / 400)));
    },
    onHit(view, api, ev) {
      if (!ev.targetId) return;
      api.vars.set('lastHitId', ev.targetId);
      api.vars.set('lastHitAt', view.frame);
    },
    onKO(view, api) { api.vars.set('kills', Math.max(0, view.vars.kills - 1)); api.vars.set('lastHitId', ''); },
  },

  ai: { preferredRange: 70, grapple: true, recovery: ['upSpecial', 'sideSpecial'], prefer: ['grab', 'sideSmash'] },
  art,
});
