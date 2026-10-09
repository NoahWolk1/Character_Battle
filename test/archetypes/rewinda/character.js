// REWINDA — a time mage whose body is an hourglass (ARCH2 invention #3).
// Every 20 frames a hook records where she was (and her percent) into a 6-slot
// ring of vars: a 2-second history. Rewind spends Sand to jump back to the oldest
// snapshot (script teleport, ≤ 200 px, once per airtime) and to undo some of the
// damage taken since (api.heal + a self 'mended' heal-over-time status; the
// Governor allows at most 1% healed per 30 frames). The rewind
// point is synced so the art can show a ghost of where she'll land.
// Exercises: a vars ring buffer (19 keys), synced vars, api.teleport + api.heal
// gating, delayed-hit burst zone, a lingering slow zone, timeline teleport.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

const SLOTS = 6, EVERY = 20;
const key = (i, k) => `h${i}${k}`;
const HISTORY = Object.fromEntries(Array.from({ length: SLOTS * 3 }, (_, n) => [key(Math.floor(n / 3), 'xyp'[n % 3]), 0]));

export default defineCharacter({
  id: 'rewinda',
  name: 'Rewinda',
  author: 'ARCH2 (test archetype)',
  description: 'A time mage with an hourglass for a body. Bombs that go off later, fields that slow the clock, and a rewind that puts her back where she was two seconds ago.',
  archetype: 'zoner',

  body: {
    collider: { w: 46, h: 108 },
    hurtboxes: {
      default: [
        { shape: 'capsule', x1: 0, y1: -70, x2: 0, y2: -22, r: 20 },  // the hourglass
        { shape: 'circle', x: 0, y: -96, r: 14 },                     // head under the hat
      ],
      crouch: [{ shape: 'capsule', x1: 0, y1: -50, x2: 0, y2: -22, r: 22 }],
    },
  },

  stats: { weight: 86, runSpeed: 5.8, airSpeed: 4.8, jumpHeight: 14.5, doubleJumpHeight: 13.5, airJumps: 1, gravity: 0.55, fallSpeed: 9.5 },

  resources: {
    sand: { max: 100, start: 100, regen: 0.18, regenDelay: 60, hud: { style: 'bar', label: 'Sand', color: '#f3c969' } },
  },
  vars: { ...HISTORY, head: 0, filled: 0, tx: 0, ty: 0 },
  sync: ['tx', 'ty', 'filled'],

  statuses: {
    // Heals arrive at most 1% per 30 frames (Governor), so the undo is a slow mend.
    mended: { frames: 180, stack: 'refresh', heal: { every: 30, amount: 1 }, visual: 'sand', tint: '#f3c969' },
  },

  hitboxes: {
    tick: { damage: 1, angle: 80, knockback: 4, growth: 0, effect: 'time', status: 'slow' },
    chime: { damage: 10, angle: 60, knockback: 28, growth: 70, effect: 'time' },
  },

  entities: {
    // Goes off 50 frames after it's set. A trap, not a zone: a zone living > 30 f is
    // priced as lingering (max 3 damage).
    clockBomb: {
      kind: 'trap', shape: { shape: 'circle', x: 0, y: 0, r: 16 }, life: 56, maxAlive: 2,
      motion: { type: 'stationary' },
      hitboxes: [{ start: 50, end: 53, shape: 'circle', x: 0, y: 0, r: 46, use: 'chime' }],
    },
    stasis: {                                              // a field where time drags
      kind: 'zone', shape: { shape: 'circle', x: 0, y: -40, r: 60 }, life: 180, maxAlive: 1,
      motion: { type: 'stationary', snapToGround: true },
      hitboxes: [{ shape: 'circle', x: 0, y: -40, r: 60, use: 'tick', rehit: 30 }],
    },
  },

  moves: {
    jab: { name: 'Second Hand', duration: 16, anim: 'poke',
      hitboxes: [{ start: 3, end: 5, shape: 'capsule', x1: 20, y1: -56, x2: 46, y2: -56, r: 9, damage: 3, angle: 60, knockback: 10, growth: 18 }] },
    side: { name: 'Minute Sweep', duration: 28, anim: 'sweep',
      hitboxes: [{ start: 8, end: 11, shape: 'capsule', x1: 24, y1: -56, x2: 82, y2: -48, r: 12, damage: 9, angle: 38, knockback: 22, growth: 74, effect: 'time' }] },
    up: { name: 'High Noon', duration: 26, anim: 'noon',
      hitboxes: [{ start: 6, end: 10, shape: 'capsule', x1: 0, y1: -110, x2: 0, y2: -140, r: 18, damage: 8, angle: 88, knockback: 24, growth: 72 }] },
    down: { name: 'Sand Trip', duration: 22, anim: 'spill',
      hitboxes: [{ start: 6, end: 9, shape: 'rect', x: 34, y: -6, w: 66, h: 12, damage: 5, angle: 80, knockback: 22, growth: 44 }] },

    sideSmash: { name: 'Grandfather Clock', duration: 48, anim: 'pendulum', effect: 'time',
      hitboxes: [{ start: 15, end: 18, x: 62, y: -50, r: 28, damage: 15, angle: 38, knockback: 26, growth: 84 }] },
    upSmash: { name: 'Midnight', duration: 44, anim: 'noon',
      hitboxes: [{ start: 12, end: 17, shape: 'capsule', x1: 0, y1: -110, x2: 0, y2: -170, r: 24, damage: 14, angle: 90, knockback: 30, growth: 88, effect: 'time' }] },
    downSmash: { name: 'Stop Watch', duration: 44, anim: 'stop',
      hitboxes: [{ start: 12, end: 15, shape: 'rect', x: 0, y: -12, w: 150, h: 24, damage: 12, angle: 30, knockback: 28, growth: 82, effect: 'time' }],
      timeline: [{ at: 14, spawn: 'stasis', x: 0, y: 0 }] },

    nair: { name: 'Clockwork', duration: 28, landingLag: 8, anim: 'spin',
      hitboxes: [{ start: 5, end: 15, x: 0, y: -60, r: 40, damage: 7, angle: 50, knockback: 18, growth: 58 }] },
    fair: { name: 'Quarter Past', duration: 28, landingLag: 10, anim: 'sweep',
      hitboxes: [{ start: 8, end: 11, x: 48, y: -56, r: 22, damage: 10, angle: 40, knockback: 24, growth: 80 }] },
    bair: { name: 'Quarter To', duration: 26, landingLag: 9, anim: 'back',
      hitboxes: [{ start: 6, end: 9, x: -46, y: -56, r: 22, damage: 11, angle: 145, knockback: 26, growth: 84 }] },
    uair: { name: 'Twelve O\'Clock', duration: 26, landingLag: 7, anim: 'noon',
      hitboxes: [{ start: 5, end: 10, x: 0, y: -126, r: 22, damage: 8, angle: 86, knockback: 22, growth: 76 }] },
    dair: { name: 'Sand Slam', duration: 32, landingLag: 14, anim: 'drop',
      hitboxes: [{ start: 9, end: 12, x: 0, y: 2, r: 20, damage: 10, angle: 280, knockback: 16, growth: 60 }] },

    neutralSpecial: { name: 'Clock Bomb', duration: 34, anim: 'cast', cost: { sand: 15 },
      timeline: [{ at: 12, spawn: 'clockBomb', x: 70, y: -50 }, { at: 12, emit: 'tick' }] },
    sideSpecial: { name: 'Time Skip', duration: 34, anim: 'skip', oncePerAirtime: true,
      timeline: [{ at: 8, emit: 'skipOut' }, { at: 9, teleport: { dx: 130, dy: 0 } }, { at: 10, emit: 'skipIn' }],
      hitboxes: [{ start: 11, end: 14, x: 20, y: -56, r: 28, damage: 6, angle: 45, knockback: 20, growth: 44, effect: 'time' }] },
    upSpecial: { name: 'Rising Hour', duration: 42, anim: 'rise', helpless: true,
      velocity: [{ start: 6, end: 22, vy: -11 }],
      hitboxes: [{ start: 6, end: 18, x: 0, y: -60, r: 30, damage: 2, angle: 80, knockback: 8, growth: 6, rehit: 6, effect: 'time' }] },

    // Rewind: back to where she was 2 s ago, undoing some of the damage since.
    downSpecial: { name: 'Rewind', duration: 40, anim: 'rewind', cost: { sand: 60 }, else: 'tock',
      update(view, api) {
        if (view.me.move.frame !== 14 || view.vars.filled < SLOTS) return;
        const i = view.vars.head;                          // oldest slot = next to be written
        const x = view.vars[key(i, 'x')], y = view.vars[key(i, 'y')], p = view.vars[key(i, 'p')];
        api.teleport((x - view.me.x) * view.me.facing, y - view.me.y);
        if (view.me.percent > p) { api.heal(1); api.status('self', 'mended'); }
        api.emit('rewind', { x: Math.round(x), y: Math.round(y) });
      } },
    tock: { name: 'Tock', category: 'utility', duration: 22, anim: 'cast',
      hitboxes: [{ start: 6, end: 9, x: 24, y: -60, r: 22, damage: 3, angle: 60, knockback: 14, growth: 10, effect: 'time' }] },

    grab: { name: 'Hold the Hour', duration: 30, anim: 'grab',
      hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 40, y: -56, w: 40, h: 50 }] },
    pummel: { name: 'Tick Tock', duration: 16, anim: 'poke',
      timeline: [{ at: 5, release: { damage: 1.5, angle: 0, knockback: 0, growth: 0, setKnockback: 0, effect: 'time' } }] },
    fthrow: { name: 'Fast Forward', duration: 30, anim: 'sweep',
      timeline: [{ at: 12, release: { damage: 8, angle: 38, knockback: 50, growth: 60, effect: 'time' } }] },
    bthrow: { name: 'Back in Time', duration: 34, anim: 'back',
      timeline: [{ at: 16, release: { damage: 9, angle: 140, knockback: 52, growth: 62, effect: 'time' } }] },
    uthrow: { name: 'Alarm', duration: 32, anim: 'noon',
      timeline: [{ at: 14, release: { damage: 7, angle: 90, knockback: 50, growth: 64, effect: 'time' } }] },
    dthrow: { name: 'Sands of Time', duration: 32, anim: 'spill',
      timeline: [{ at: 15, release: { damage: 6, angle: 75, knockback: 56, growth: 30, status: 'slow' } }] },

    taunt: { name: 'Check Watch', category: 'taunt', duration: 60, anim: 'watch', timeline: [{ at: 20, emit: 'tick' }] },
  },

  behavior: {
    // Record the 2-second history ring and publish the rewind point for the art.
    tick(view, api) {
      if (view.frame % EVERY !== 0 || view.me.state === 'dead' || view.me.state === 'respawn') return;
      const i = view.vars.head;
      api.vars.set(key(i, 'x'), Math.round(view.me.x));
      api.vars.set(key(i, 'y'), Math.round(view.me.y));
      api.vars.set(key(i, 'p'), Math.round(view.me.percent));
      const next = (i + 1) % SLOTS;
      api.vars.set('head', next);
      api.vars.set('filled', Math.min(SLOTS, view.vars.filled + 1));
      api.vars.set('tx', view.vars[key(next, 'x')]);
      api.vars.set('ty', view.vars[key(next, 'y')]);
    },
  },

  ai: { preferredRange: 200, zoning: true, recovery: ['upSpecial', 'sideSpecial'], prefer: ['neutralSpecial', 'downSmash'] },
  art,
});
