// DJ TEMPO — a rhythm-game DJ whose head is a spinning record (ARCH2 invention #2).
// The whole match runs at 120 BPM: a beat lands every 30 frames of match time
// (view.frame), which every client agrees on. Hits that land within 4 frames of a
// beat build Groove; Drop the Beat on-beat with 50 Groove becomes a script-dealt
// bass drop (template-only api.hit), off-beat it's a little "wub". The Speaker
// trap pulses on its own 30-frame clock. In the Zone (Groove ≥ 80) is an
// api.modify speed set that the Governor clamps.
// Exercises: frame-synced script timing, onHit hook → resource/vars, api.hit from a
// move script, api.modify, a custom status, a trap with `every`, ai.hint.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

const BEAT = 30;                         // frames per beat (120 BPM)
const WINDOW = 4;                        // ± frames that count as on-beat
const offBeat = (frame) => { const p = frame % BEAT; return Math.min(p, BEAT - p); };

export default defineCharacter({
  id: 'dj-tempo',
  name: 'DJ Tempo',
  author: 'ARCH2 (test archetype)',
  description: 'A DJ with a vinyl record for a head. Everything hits harder on the beat: chain on-beat hits to build Groove, then drop the bass.',
  archetype: 'allrounder',

  body: {
    collider: { w: 44, h: 98 },
    hurtboxes: {
      default: [
        { shape: 'circle', x: 0, y: -80, r: 18 },                       // record head
        { shape: 'capsule', x1: 0, y1: -56, x2: 0, y2: -22, r: 17 },    // hoodie + legs
      ],
      crouch: [{ shape: 'capsule', x1: -10, y1: -30, x2: 10, y2: -22, r: 22 }],
    },
  },

  stats: { weight: 92, runSpeed: 6.6, airSpeed: 4.8, jumpHeight: 15, doubleJumpHeight: 14, airJumps: 1, gravity: 0.64, fallSpeed: 11 },

  resources: {
    groove: { max: 100, start: 0, decay: 0.06, hud: { style: 'ring', label: 'Groove', color: '#ff5fd2' } },
  },
  vars: { streak: 0, lastBeatHit: -1 },
  sync: ['streak'],

  statuses: {
    offbeat: { frames: 120, stack: 'refresh', mods: { speed: 0.85, jump: 0.9 }, visual: 'notes', tint: '#ff5fd2' },
  },

  hitboxes: {
    wub: { damage: 4, angle: 50, knockback: 16, growth: 30, effect: 'bass' },
    bassDrop: { damage: 12, angle: 45, knockback: 30, growth: 80, effect: 'bass', status: 'offbeat' },
    pulse: { damage: 3, angle: 70, knockback: 14, growth: 10, effect: 'bass' },
  },

  entities: {
    speaker: {                                               // a floor speaker that pulses on its own clock
      kind: 'trap', shape: { shape: 'rect', x: 0, y: -20, w: 30, h: 40 }, life: 600, hp: 8, maxAlive: 1,
      motion: { type: 'stationary', snapToGround: true },
      every: { frames: 30, spawn: 'pulse', x: 0, y: -20 },
    },
    pulse: {
      kind: 'zone', shape: { shape: 'circle', x: 0, y: 0, r: 48 }, life: 12,
      motion: { type: 'stationary' },
      hitboxes: [{ start: 2, end: 4, shape: 'circle', x: 0, y: 0, r: 48, use: 'pulse' }],
    },
  },

  moves: {
    jab: { name: 'Tap Tempo', duration: 16, anim: 'tap',
      hitboxes: [{ start: 3, end: 5, x: 32, y: -56, r: 15, damage: 3, angle: 60, knockback: 10, growth: 18 }] },
    side: { name: 'Crossfader', duration: 26, anim: 'slide',
      hitboxes: [{ start: 7, end: 10, shape: 'capsule', x1: 24, y1: -54, x2: 76, y2: -52, r: 13, damage: 9, angle: 38, knockback: 22, growth: 74 }] },
    up: { name: 'Hands Up', duration: 25, anim: 'handsUp',
      hitboxes: [{ start: 6, end: 10, x: 0, y: -116, r: 22, damage: 8, angle: 88, knockback: 24, growth: 72 }] },
    down: { name: 'Floor Filler', duration: 22, anim: 'kick',
      hitboxes: [{ start: 6, end: 9, x: 36, y: -10, r: 15, damage: 6, angle: 75, knockback: 20, growth: 50 }] },

    sideSmash: { name: 'Air Horn', duration: 46, anim: 'horn', effect: 'bass',
      hitboxes: [{ start: 14, end: 17, shape: 'capsule', x1: 40, y1: -60, x2: 86, y2: -60, r: 22, damage: 15, angle: 38, knockback: 26, growth: 84 }] },
    upSmash: { name: 'Disco Ball', duration: 44, anim: 'disco',
      hitboxes: [{ start: 12, end: 17, x: 0, y: -132, r: 28, damage: 14, angle: 90, knockback: 30, growth: 88 }] },
    downSmash: { name: 'Bass Stomp', duration: 42, anim: 'stomp', effect: 'bass',
      hitboxes: [{ start: 11, end: 14, shape: 'rect', x: 0, y: -10, w: 160, h: 20, damage: 13, angle: 30, knockback: 28, growth: 84 }] },

    nair: { name: 'Spin Back', duration: 28, landingLag: 8, anim: 'spin',
      hitboxes: [{ start: 5, end: 15, x: 0, y: -52, r: 40, damage: 7, angle: 50, knockback: 18, growth: 58 }] },
    fair: { name: 'Record Toss', duration: 28, landingLag: 10, anim: 'toss',
      hitboxes: [{ start: 8, end: 11, x: 48, y: -58, r: 22, damage: 10, angle: 40, knockback: 24, growth: 80 }] },
    bair: { name: 'B-Side', duration: 26, landingLag: 9, anim: 'bside',
      hitboxes: [{ start: 6, end: 9, x: -44, y: -54, r: 22, damage: 11, angle: 145, knockback: 26, growth: 84 }] },
    uair: { name: 'Raise the Roof', duration: 26, landingLag: 7, anim: 'handsUp',
      hitboxes: [{ start: 5, end: 10, x: 0, y: -114, r: 24, damage: 8, angle: 86, knockback: 22, growth: 76 }] },
    dair: { name: 'Needle Drop', duration: 32, landingLag: 14, anim: 'needle',
      hitboxes: [{ start: 9, end: 12, x: 0, y: 4, r: 20, damage: 10, angle: 280, knockback: 16, growth: 60 }] },

    // Drop the Beat: on beat with 50 Groove → bass drop (scripted, template-only), else a wub.
    neutralSpecial: { name: 'Drop the Beat', duration: 40, anim: 'drop',
      update(view, api) {
        if (view.me.move.frame !== 12) return;
        const onBeat = offBeat(view.frame) <= WINDOW;
        if (onBeat && view.res.groove >= 50) {
          api.res.add('groove', -50);
          api.hit('bassDrop', { shape: 'circle', x: 30, y: -50, r: 56 }, { frames: 3 });
          api.emit('drop', { big: true });
          api.camera({ shake: 6 });
        } else {
          api.hit('wub', { shape: 'circle', x: 40, y: -54, r: 30 }, { frames: 2 });
          api.emit('drop', { big: false });
        }
      } },

    sideSpecial: { name: 'Scratch', duration: 36, anim: 'scratch', oncePerAirtime: true,
      velocity: [{ start: 5, end: 10, vx: 8 }, { start: 11, end: 15, vx: -3 }, { start: 16, end: 22, vx: 8 }],
      hitboxes: [{ start: 6, end: 22, x: 28, y: -54, r: 24, damage: 2, angle: 60, knockback: 8, growth: 6, rehit: 5 },
                 { start: 23, end: 25, group: 9, x: 30, y: -54, r: 26, damage: 5, angle: 40, knockback: 24, growth: 50 }] },
    upSpecial: { name: 'Sub Lift', duration: 40, anim: 'lift', helpless: true,
      velocity: [{ start: 6, end: 22, vy: -11 }],
      hitboxes: [{ start: 6, end: 18, x: 0, y: -10, r: 28, use: 'pulse', rehit: 6 }] },
    downSpecial: { name: 'Set Up Speaker', duration: 34, anim: 'setup',
      timeline: [{ at: 14, spawn: 'speaker', x: 46, y: 0 }, { at: 14, sfx: 'clank' }] },

    grab: { name: 'Headphone Snag', duration: 30, anim: 'grab',
      hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 40, y: -54, w: 40, h: 50 }] },
    pummel: { name: 'Beatbox', duration: 16, anim: 'tap',
      timeline: [{ at: 5, release: { damage: 1.5, angle: 0, knockback: 0, growth: 0, setKnockback: 0, effect: 'bass' } }] },
    fthrow: { name: 'Next Track', duration: 30, anim: 'toss',
      timeline: [{ at: 12, release: { damage: 8, angle: 38, knockback: 50, growth: 60 } }] },
    bthrow: { name: 'Rewind Selecta', duration: 34, anim: 'bside',
      timeline: [{ at: 16, release: { damage: 9, angle: 140, knockback: 52, growth: 62 } }] },
    uthrow: { name: 'Hype Toss', duration: 32, anim: 'handsUp',
      timeline: [{ at: 14, release: { damage: 7, angle: 90, knockback: 50, growth: 64 } }] },
    dthrow: { name: 'Breakdown', duration: 32, anim: 'stomp',
      timeline: [{ at: 15, release: { damage: 6, angle: 75, knockback: 56, growth: 30, status: 'offbeat' } }] },

    taunt: { name: 'Hype', category: 'taunt', duration: 60, anim: 'hype', timeline: [{ at: 1, emit: 'hype' }] },
  },

  behavior: {
    onHit(view, api, ev) {
      if (!ev.granted || ev.tier === 'status') return;
      if (offBeat(view.frame) <= WINDOW) {
        api.res.add('groove', 10 + Math.min(10, view.vars.streak * 2));
        api.vars.set('streak', Math.min(9, view.vars.streak + 1));
        if (view.vars.lastBeatHit !== view.frame) api.emit('perfect', { s: view.vars.streak + 1 });
        api.vars.set('lastBeatHit', view.frame);
      } else if (view.vars.streak > 0) api.vars.set('streak', 0);
    },
    tick(view, api) {
      if (view.frame % 10 !== 0) return;
      api.modify('zone', view.res.groove >= 80 ? { speed: 1.1, jump: 1.05 } : null);
    },
    onKO(view, api) { api.modify('zone', null); },
  },

  ai: {
    recovery: ['upSpecial', 'sideSpecial'], prefer: ['neutralSpecial', 'sideSpecial'],
    hint(view) {
      // Line Drop the Beat up so frame 12 (the hit) lands on a beat.
      const foe = view.nearestEnemy();
      if (!foe || Math.abs(foe.x - view.me.x) > 110 || view.res.groove < 50) return null;
      return offBeat(view.frame + 12) <= 2 ? { press: 'neutralSpecial' } : null;
    },
  },
  art,
});
