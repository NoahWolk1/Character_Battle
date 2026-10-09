// BUZZWARM — a hive-mind bee swarm (spec §10.3 #4). Archetype stress test for:
// resource-as-size (bees → bodyScale), 60 homing minions requested (the Governor
// clamps live drones), swarm-helper art, and an onHurt resource drain.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

const MAX_BEES = 60;

export default defineCharacter({
  id: 'buzzwarm',
  name: 'Buzzwarm',
  author: 'archetype suite',
  description: 'A hive mind of sixty bees. Fewer bees = a smaller swarm. Sends out homing drones, stings for damage over time, and loses bees when it gets swatted.',
  archetype: 'summoner',

  body: {
    collider: { w: 72, h: 86 },
    hurtboxes: {
      default: [
        { shape: 'circle', x: 0, y: -44, r: 36 },
        { shape: 'circle', x: -18, y: -66, r: 24 },
        { shape: 'circle', x: 20, y: -62, r: 22 },
        { shape: 'circle', x: 0, y: -18, r: 20 },
      ],
      crouch: [{ shape: 'capsule', x1: -30, y1: -22, x2: 30, y2: -22, r: 22 }],
    },
    scaleRange: [0.7, 1.1], // resource-as-size: priced at 0.7
  },
  stats: { weight: 76, runSpeed: 5.4, airSpeed: 4.8, jumpHeight: 13, doubleJumpHeight: 12.5, airJumps: 2, gravity: 0.5, fallSpeed: 8.5 },
  movement: { hover: { frames: 90, fallSpeed: 1.2, drift: 1 } },

  resources: {
    bees: {
      max: MAX_BEES, start: MAX_BEES, regen: 0.05, regenDelay: 90,
      onHurt: { perDamage: -0.5 },               // declarative drain: every point of damage costs half a bee
      hud: { style: 'bar', label: 'Bees', color: '#ffd23a' },
    },
  },

  statuses: {
    stung: { frames: 120, stack: 'refresh', dot: { every: 30, damage: 0.5 }, visual: 'sting', tint: '#ffd23a', icon: 'sting' },
  },

  hitboxes: {
    sting: { damage: 2, angle: 55, knockback: 8, growth: 18, effect: 'sting', status: 'stung' },
    buzz: { damage: 1, angle: 80, knockback: 4, growth: 6, effect: 'sting', hitlagMul: 0.6 },
  },

  entities: {
    drone: {
      kind: 'minion', shape: { shape: 'circle', x: 0, y: 0, r: 7 }, life: 240, maxAlive: 60, // clamped to the 8-alive rule
      motion: { type: 'homing', speed: 4.5, turn: 0.1, wobble: 0.25, delay: 8 }, collide: 'pass',
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 10, damage: 1.5, angle: 70, knockback: 6, growth: 10, rehit: 30, effect: 'sting' }],
      onHit: [{ emit: 'buzz' }],
      render: { color: '#ffd23a', color2: '#2a1a08' },
    },
  },

  moves: {
    jab: { name: 'Sting', duration: 16, anim: 'poke',
      hitboxes: [{ start: 3, end: 5, x: 42, y: -46, r: 16, damage: 3, angle: 60, knockback: 10, growth: 20, effect: 'sting' }] },
    side: { name: 'Swarm Lash', duration: 26, anim: 'lash',
      hitboxes: [{ start: 7, end: 10, shape: 'capsule', x1: 24, y1: -46, x2: 98, y2: -42, r: 15, damage: 8, angle: 38, knockback: 20, growth: 70, effect: 'sting' }] },
    up: { name: 'Bee Fountain', duration: 26, anim: 'fountain',
      hitboxes: [{ start: 6, end: 11, shape: 'capsule', x1: 0, y1: -70, x2: 0, y2: -130, r: 22, damage: 7, angle: 88, knockback: 22, growth: 72 }] },
    down: { name: 'Carpet Buzz', duration: 26, anim: 'carpet',
      hitboxes: [
        { start: 6, end: 14, shape: 'rect', x: 34, y: -10, w: 80, h: 18, use: 'buzz', rehit: 4 },
        { start: 15, end: 17, group: 9, shape: 'rect', x: 40, y: -12, w: 84, h: 20, damage: 4, angle: 75, knockback: 22, growth: 40 },
      ] },

    sideSmash: { name: 'Hive Fist', duration: 48, anim: 'fist',
      hitboxes: [
        { start: 16, end: 19, group: 0, x: 96, y: -48, r: 34, damage: 16, angle: 38, knockback: 25, growth: 80, effect: 'sting' },
        { start: 16, end: 19, group: 0, shape: 'capsule', x1: 24, y1: -46, x2: 70, y2: -48, r: 18, damage: 11, angle: 45, knockback: 24, growth: 80 },
      ] },
    upSmash: { name: 'Hive Spire', duration: 46, anim: 'spire',
      hitboxes: [{ start: 13, end: 18, shape: 'capsule', x1: 0, y1: -60, x2: 0, y2: -150, r: 30, damage: 15, angle: 90, knockback: 30, growth: 90 }] },
    downSmash: { name: 'Scatter Ring', duration: 44, anim: 'scatter',
      hitboxes: [{ start: 12, end: 15, shape: 'capsule', x1: -84, y1: -16, x2: 84, y2: -16, r: 22, damage: 13, angle: 30, knockback: 28, growth: 86 }] },

    nair: { name: 'Cloud Spin', duration: 30, landingLag: 8, anim: 'spin',
      hitboxes: [
        { start: 5, end: 15, x: 0, y: -44, r: 40, use: 'buzz', rehit: 5 },
        { start: 16, end: 18, group: 9, x: 0, y: -44, r: 40, damage: 4, angle: 50, knockback: 20, growth: 55 },
      ] },
    fair: { name: 'Lance Formation', duration: 30, landingLag: 10, anim: 'lance',
      hitboxes: [{ start: 9, end: 12, shape: 'capsule', x1: 20, y1: -44, x2: 96, y2: -40, r: 16, damage: 10, angle: 40, knockback: 24, growth: 82, effect: 'sting' }] },
    bair: { name: 'Stinger Volley', duration: 28, landingLag: 10, anim: 'volley',
      hitboxes: [{ start: 7, end: 10, x: -62, y: -42, r: 26, damage: 11, angle: 145, knockback: 26, growth: 86, effect: 'sting' }] },
    uair: { name: 'Crown of Bees', duration: 28, landingLag: 8, anim: 'crown',
      hitboxes: [{ start: 6, end: 11, shape: 'capsule', x1: -40, y1: -100, x2: 40, y2: -100, r: 22, damage: 8, angle: 86, knockback: 22, growth: 76 }] },
    dair: { name: 'Honey Drop', duration: 34, landingLag: 14, anim: 'drop',
      hitboxes: [{ start: 10, end: 14, x: 0, y: 2, r: 26, damage: 11, angle: 280, knockback: 14, growth: 62, effect: 'sting' }] },

    // 60 drones requested every cast; spawn count/rate and the 8-alive / threat budget clamp it.
    neutralSpecial: { name: 'Release the Swarm', duration: 42, anim: 'release', cost: { bees: 10 }, else: 'fizzle',
      timeline: [{ at: 12, spawn: 'drone', x: 30, y: -50, vx: 4, vy: -2, count: 5, spread: 18, aimAt: 'nearestEnemy' }, { at: 12, emit: 'release' }],
      update(view, api) {
        if (view.me.move.frame !== 14) return;
        for (let i = 0; i < 55; i++) api.spawn('drone', { x: 20 + (i % 5) * 6, y: -60 + (i % 7) * 5, vx: 3, vy: -1 });
      } },
    fizzle: { name: 'Tired Buzz', category: 'special', duration: 30, anim: 'fizzle', timeline: [{ at: 6, emit: 'fizzle' }] },
    sideSpecial: { name: 'Beeline', duration: 40, anim: 'beeline', oncePerAirtime: true,
      velocity: [{ start: 6, end: 20, vx: 11, vy: -1 }],
      hitboxes: [
        { start: 6, end: 18, x: 30, y: -44, r: 30, use: 'buzz', rehit: 5 },
        { start: 19, end: 21, group: 9, x: 34, y: -44, r: 32, damage: 5, angle: 40, knockback: 26, growth: 60 },
      ] },
    upSpecial: { name: 'Updraft', duration: 44, anim: 'updraft', helpless: true,
      velocity: [{ start: 6, end: 21, vy: -11, vx: 1 }],
      hitboxes: [{ start: 6, end: 14, x: 0, y: -60, r: 36, damage: 6, angle: 85, knockback: 24, growth: 46, effect: 'sting' }] },
    downSpecial: { name: 'Regroup', duration: 36, anim: 'regroup',
      hold: { button: 'special', from: 8, to: 16, max: 180 },
      update(view, api) { if (view.me.move.phase === 'hold') api.res.add('bees', 0.35); } },
    taunt: { name: 'Waggle Dance', category: 'taunt', duration: 60, anim: 'waggle', timeline: [{ at: 10, emit: 'waggle' }] },
  },

  behavior: {
    // Resource-as-size: a full hive is big (1.1), a thinned swarm is small (0.7).
    tick(view, api) { api.setBodyScale(0.7 + 0.4 * (view.res.bees / MAX_BEES)); },
    // onHurt drain on top of the declarative perDamage: a big swat scatters a clump of bees.
    onHurt(view, api, ev) {
      if (ev.granted < 8) return;
      api.res.add('bees', -4);
      api.emit('scatter', { n: 4 });
    },
    onRespawn(view, api) { api.res.set('bees', MAX_BEES); },
  },

  ai: { preferredRange: 160, zoning: true, recovery: ['upSpecial', 'sideSpecial'], prefer: ['neutralSpecial', 'nair'] },
  art,
});
