// Test fixture: spec §2 example, verbatim except import paths (test/fixtures is one level deeper than characters/).
// characters/nimbus/character.js
// NIMBUS — a grumpy thundercloud. Rain soaks foes; lightning on soaked foes hits harder.
// Static charge builds as Nimbus lands hits and fuels the Ion Beam.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'nimbus',
  name: 'Nimbus',
  author: 'Alex',
  description: 'A grumpy thundercloud. Soaks foes with rain, then cashes the puddles in for lightning. Floats a long time, but not forever.',
  archetype: 'zoner',

  body: {
    collider: { w: 72, h: 64 },
    hurtboxes: {
      default: [
        { shape: 'circle', x: 0,   y: -40, r: 30 },
        { shape: 'circle', x: -30, y: -32, r: 20 },
        { shape: 'circle', x: 30,  y: -34, r: 22 },
      ],
      crouch: [{ shape: 'capsule', x1: -32, y1: -22, x2: 32, y2: -22, r: 20 }],
    },
  },

  stats: { weight: 82, runSpeed: 5.4, airSpeed: 5.6, jumpHeight: 13, doubleJumpHeight: 12,
           airJumps: 2, gravity: 0.5, fallSpeed: 8 },
  movement: { hover: { button: 'jump', frames: 110, fallSpeed: 1.2, drift: 1.15 } },

  resources: {
    charge: { max: 100, start: 0, decay: 0.03, onHit: { perDamage: 2.5 },
              hud: { style: 'bar', label: 'Static', color: '#9fe8ff' } },
  },
  vars: { dischargeCd: 0 },
  sync: [],

  statuses: {
    soaked: { frames: 240, stack: 'refresh', mods: { speed: 0.9, jump: 0.92 }, visual: 'drip', tint: '#4aa3ff' },
  },

  hitboxes: {
    drizzle:   { damage: 1,  angle: 80, knockback: 4,  growth: 0,  effect: 'water', status: 'soaked' },
    bolt:      { damage: 8,  angle: 75, knockback: 30, growth: 74, effect: 'electric' },
    megabolt:  { damage: 13, angle: 80, knockback: 34, growth: 88, effect: 'electric', status: 'stun' },
    ion:       { damage: 2,  angle: 30, knockback: 6,  growth: 0,  effect: 'electric' },
    discharge: { damage: 4,  angle: 60, knockback: 26, growth: 30, effect: 'electric' },
    gust:      { kind: 'wind', push: 5 },
  },

  entities: {
    raincloud: {                                   // lingering zone: rain falls in a column below it
      kind: 'zone', shape: { shape: 'rect', x: 0, y: 0, w: 120, h: 40 }, life: 300, maxAlive: 1,
      motion: { type: 'stationary' }, collide: 'pass',
      hitboxes: [{ shape: 'rect', x: 0, y: 110, w: 110, h: 200, use: 'drizzle', rehit: 30 }],
    },
    strike: {                                      // burst zone: a lightning column at a spot
      kind: 'zone', shape: { shape: 'rect', x: 0, y: -160, w: 30, h: 320 }, life: 18,
      motion: { type: 'stationary', snapToGround: true },
      hitboxes: [{ start: 8, end: 11, shape: 'rect', x: 0, y: -160, w: 40, h: 320, use: 'bolt' }],
    },
    bigStrike: {
      kind: 'zone', shape: { shape: 'rect', x: 0, y: -170, w: 44, h: 340 }, life: 20,
      motion: { type: 'stationary', snapToGround: true },
      hitboxes: [{ start: 8, end: 11, shape: 'rect', x: 0, y: -170, w: 56, h: 340, use: 'megabolt' }],
    },
    ionBeam: {
      kind: 'beam', shape: { shape: 'capsule', x1: 0, y1: 0, x2: 300, y2: 0, r: 12 }, life: 90,
      motion: { type: 'attached' }, anchor: { x: 30, y: -40 }, length: 300, width: 12,
      hitboxes: [{ shape: 'capsule', x1: 0, y1: 0, x2: 300, y2: 0, r: 12, use: 'ion', rehit: 8 }],
    },
  },

  moves: {
    jab:  { name: 'Spit Spark', duration: 16, anim: 'puff', effect: 'electric',
            hitboxes: [{ start: 3, end: 5, x: 34, y: -40, r: 18, damage: 3, angle: 60, knockback: 10, growth: 20 }] },
    side: { name: 'Squall Arm', duration: 26, anim: 'reach',
            hitboxes: [{ start: 7, end: 10, shape: 'capsule', x1: 20, y1: -40, x2: 90, y2: -36, r: 14,
                         damage: 9, angle: 38, knockback: 22, growth: 76, effect: 'water' }] },
    up:   { name: 'Anvil Top', duration: 25, anim: 'tower',
            hitboxes: [{ start: 6, end: 11, x: 0, y: -96, r: 28, damage: 8, angle: 88, knockback: 26, growth: 74 }] },
    down: { name: 'Downpour', duration: 24, anim: 'flatten',
            hitboxes: [{ start: 5, end: 14, shape: 'rect', x: 30, y: -8, w: 90, h: 16, use: 'drizzle', rehit: 4 },
                       { start: 15, end: 16, shape: 'rect', x: 30, y: -8, w: 90, h: 16, group: 9,
                         damage: 4, angle: 70, knockback: 24, growth: 40 }] },

    sideSmash: {                                   // beam if charged, plain thunderhead otherwise
      name: 'Ion Beam', category: 'smash', duration: 40, anim: 'beam',
      requires: { resource: { charge: 20 } }, else: 'thunderhead',
      hold: { button: 'strong', from: 12, to: 22, max: 100 },
      timeline: [{ at: 12, spawn: 'ionBeam', x: 30, y: -40, bindToMove: true }, { at: 12, sfx: 'zap-loop' }],
      update(view, api) {
        if (view.me.move.frame >= 12 && view.input.held('strong')) api.res.add('charge', -0.7);
        if (view.res.charge <= 0) api.endMove();
      },
    },
    thunderhead: { name: 'Thunderhead', category: 'smash', duration: 44, anim: 'swell',
      hitboxes: [{ start: 13, end: 16, x: 40, y: -44, r: 40, damage: 15, angle: 40, knockback: 32, growth: 94, effect: 'electric' }] },
    upSmash: { name: 'Cumulonimbus', duration: 44, anim: 'tower',
      hitboxes: [{ start: 12, end: 18, shape: 'capsule', x1: 0, y1: -40, x2: 0, y2: -150, r: 26,
                   damage: 15, angle: 90, knockback: 32, growth: 92, effect: 'electric' }] },
    downSmash: { name: 'Hailstorm', duration: 42, anim: 'burst',
      hitboxes: [{ start: 11, end: 14, x: 0, y: -24, r: 60, damage: 13, angle: 30, knockback: 30, growth: 88, effect: 'ice' }] },

    nair: { name: 'Pressure Ring', duration: 28, landingLag: 8, anim: 'spin',
      hitboxes: [{ start: 5, end: 17, x: 0, y: -40, r: 44, damage: 1.5, angle: 60, knockback: 6, growth: 0, rehit: 5 },
                 { start: 18, end: 19, group: 9, x: 0, y: -40, r: 46, damage: 4, angle: 45, knockback: 22, growth: 60 }] },
    fair: { name: 'Front Bolt', duration: 28, landingLag: 10, anim: 'reach',
      hitboxes: [{ start: 8, end: 11, x: 50, y: -40, r: 24, damage: 10, angle: 40, knockback: 24, growth: 82, effect: 'electric' }] },
    bair: { name: 'Back Draft', duration: 26, landingLag: 9, anim: 'puffBack', velocity: [{ start: 6, end: 9, vx: 2, mode: 'add' }],
      hitboxes: [{ start: 6, end: 9, x: -52, y: -40, r: 26, damage: 11, angle: 145, knockback: 26, growth: 86 }] },
    uair: { name: 'Sky Sizzle', duration: 26, landingLag: 7, anim: 'tower',
      hitboxes: [{ start: 5, end: 10, x: 0, y: -96, r: 28, damage: 8, angle: 88, knockback: 22, growth: 78, effect: 'electric' }] },
    dair: { name: 'Hail Drop', duration: 32, landingLag: 14, anim: 'drop',
      hitboxes: [{ start: 9, end: 12, x: 0, y: 6, r: 26, damage: 11, angle: 280, knockback: 26, growth: 76, effect: 'ice' }] },

    neutralSpecial: {
      name: 'Call Lightning', duration: 38, anim: 'summon',
      update(view, api) {
        if (view.me.move.frame !== 14) return;
        const foe = view.nearestEnemy();
        const inRange = foe && Math.abs(foe.x - view.me.x) < 420;
        if (inRange && foe.statuses.some((s) => s.name === 'soaked') && view.res.charge >= 30) {
          api.res.add('charge', -30);
          api.spawn('bigStrike', { worldX: foe.x });
          api.emit('thunder', { big: true });
        } else {
          api.spawn('strike', { x: inRange ? (foe.x - view.me.x) * view.me.facing : 160 });
          api.emit('thunder', { big: false });
        }
      },
    },
    sideSpecial: { name: 'Gust Front', duration: 32, anim: 'blow', oncePerAirtime: true,
      velocity: [{ start: 4, end: 10, vx: -3 }],
      hitboxes: [{ start: 6, end: 18, shape: 'rect', x: 90, y: -40, w: 140, h: 60, use: 'gust' }] },
    upSpecial: { name: 'Updraft', duration: 40, anim: 'rise', helpless: true,
      velocity: [{ start: 6, end: 26, vy: -11 }],
      hitboxes: [{ start: 6, end: 26, x: 0, y: -30, r: 34, use: 'drizzle', rehit: 6 }] },
    downSpecial: { name: 'Seed the Clouds', duration: 36, anim: 'summon',
      timeline: [{ at: 14, spawn: 'raincloud', x: 120, y: -170 }, { at: 14, sfx: 'rain-start' }] },

    taunt: { name: 'Rumble', category: 'taunt', duration: 60, anim: 'grumble', timeline: [{ at: 10, emit: 'rumble' }] },
  },

  behavior: {
    tick(view, api) { if (view.vars.dischargeCd > 0) api.vars.set('dischargeCd', view.vars.dischargeCd - 1); },
    onHurt(view, api, ev) {
      // Getting hit while highly charged zaps everything around Nimbus (once per 2 s).
      if (view.res.charge >= 50 && view.vars.dischargeCd === 0 && ev.damage >= 4) {
        api.res.add('charge', -25);
        api.vars.set('dischargeCd', 120);
        api.hit('discharge', { shape: 'circle', x: 0, y: -40, r: 56 }, { frames: 3 });
        api.emit('discharge');
      }
    },
  },

  ai: { preferredRange: 260, zoning: true, recovery: ['upSpecial', 'sideSpecial'], prefer: ['neutralSpecial', 'downSpecial'] },
  art,
});
