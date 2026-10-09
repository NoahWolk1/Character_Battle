// MAJOR NIBBLES — a hamster in a war mech (spec §10.3 #5). Archetype stress test for:
// forms mech (base) / pilot, soak plating → eject, a wreck part (relay 0.5), a turret
// minion with `think`, and sprite (pilot sheet) plus procedural (mech) art.
import { defineCharacter } from '../../../shared/char/api.js';
import art from './art.js';

const PILOT_SLOTS = {
  jab: 'nibble', side: 'cheekPunch', up: 'earFlick', down: 'tailSweep',
  sideSmash: 'chomp', upSmash: 'sunflowerPop', downSmash: 'burrowSpin',
  nair: 'ballRoll', fair: 'ballRoll', bair: 'hamKick', uair: 'earFlick', dair: 'hamKick',
  neutralSpecial: 'seedShot', sideSpecial: 'scurry', upSpecial: 'wheelHop', downSpecial: 'redock',
};

export default defineCharacter({
  id: 'major-nibbles',
  name: 'Major Nibbles',
  author: 'archetype suite',
  description: 'A decorated hamster piloting a walking war mech. The mech soaks hits on its plating; when the plating is gone Nibbles ejects and fights on foot until he can call the mech back.',
  archetype: 'heavy',

  // base = the mech
  body: {
    collider: { w: 84, h: 120 },
    hurtboxes: {
      default: [
        { shape: 'rect', x: 0, y: -74, w: 76, h: 52 },
        { shape: 'circle', x: 6, y: -108, r: 18 },
        { shape: 'rect', x: 0, y: -26, w: 60, h: 48 },
      ],
      crouch: [{ shape: 'rect', x: 0, y: -40, w: 84, h: 80 }],
    },
  },
  stats: { weight: 122, runSpeed: 5, airSpeed: 3.6, jumpHeight: 12.5, doubleJumpHeight: 11.5, airJumps: 1, gravity: 0.8, fallSpeed: 13 },

  forms: {
    pilot: {
      stats: { weight: 72, runSpeed: 7.1, airSpeed: 4.9, jumpHeight: 14, doubleJumpHeight: 13, airJumps: 1, gravity: 0.6, fallSpeed: 10 },
      body: {
        collider: { w: 44, h: 50 },
        hurtboxes: { default: [{ shape: 'circle', x: 0, y: -22, r: 22 }, { shape: 'circle', x: 6, y: -44, r: 15 }] },
      },
      slots: PILOT_SLOTS,
    },
  },

  resources: {
    plating: {
      max: 40, start: 40, regen: 0.12, regenWhen: 'form:pilot', regenDelay: 60,
      soak: { fraction: 0.5, costPerDamage: 1, forms: ['base'] },   // half of each hit lands on the plating
      resetOnRespawn: true,
      hud: { style: 'ring', label: 'Plating', color: '#9fb4c8' },
    },
  },

  vars: { ejectedAt: -999 },

  hitboxes: {
    piston: { damage: 10, angle: 40, knockback: 24, growth: 80, effect: 'heavy' },
    pellet: { damage: 2.5, angle: 30, knockback: 8, growth: 12, effect: 'electric' },
    bite: { damage: 3, angle: 60, knockback: 8, growth: 18, effect: 'slash' },
  },

  entities: {
    turret: {
      kind: 'minion', shape: { shape: 'rect', x: 0, y: -16, w: 30, h: 32 }, life: 600, hp: 8, maxAlive: 1,
      motion: { type: 'stationary', snapToGround: true },
      // Aims and fires a pellet at the nearest enemy in range every 50 frames.
      think(view, e, api) {
        if (e.age % 50 !== 25) return;
        const t = view.nearestEnemy({ x: e.x, y: e.y });
        if (!t) return;
        const dx = t.x - e.x, dy = (t.y - 40) - (e.y - 26);
        const d = Math.hypot(dx, dy);
        if (d > 440 || d < 1) return;
        // Script spawns are clamped to owner ± 600 px (worldX/Y), so a turret far from Nibbles holds fire.
        if (Math.abs(e.x - view.me.x) > 580 || Math.abs(e.y - view.me.y) > 560) return;
        api.spawn('pellet', { worldX: e.x + (dx / d) * 18, worldY: e.y - 26 + (dy / d) * 18, vx: (dx / d) * 9 * view.me.facing, vy: (dy / d) * 9 });
        api.emit('turretShot', { x: Math.round(e.x), y: Math.round(e.y - 26) });
      },
    },
    pellet: {
      kind: 'projectile', shape: { shape: 'circle', r: 5 }, life: 60, maxAlive: 4,
      motion: { type: 'linear' }, hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 7, use: 'pellet' }],
      render: { color: '#ffe14a', color2: '#ffffff' },
    },
    missile: {
      kind: 'projectile', shape: { shape: 'capsule', x1: -8, y1: 0, x2: 8, y2: 0, r: 5 }, life: 110, maxAlive: 2,
      motion: { type: 'homing', speed: 6, turn: 0.06, delay: 10 },
      hitboxes: [{ shape: 'circle', x: 6, y: 0, r: 10, damage: 6, angle: 45, knockback: 20, growth: 50, effect: 'fire' }],
      onExpire: [{ emit: 'boom' }], onHit: [{ emit: 'boom' }],
      render: { color: '#ff8a3a' },
    },
    seed: {
      kind: 'projectile', shape: { shape: 'circle', r: 6 }, life: 50, maxAlive: 3,
      motion: { type: 'ballistic', gravity: 0.25 }, hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 8, damage: 3, angle: 40, knockback: 8, growth: 20 }],
    },
    // The abandoned mech: still wired to Nibbles (relay 0.5), destroyed after 15 damage.
    wreck: {
      kind: 'part', shape: { shape: 'rect', x: 0, y: -24, w: 74, h: 48 }, hp: 15, life: 600, relay: 0.5, maxAlive: 1,
      motion: { type: 'stationary', snapToGround: true },
      onDeath: [{ emit: 'wreckBoom' }],
    },
  },

  moves: {
    // ── MECH (base) ──
    jab: { name: 'Rivet Jab', duration: 20, anim: 'm_jab',
      hitboxes: [{ start: 4, end: 6, x: 58, y: -80, r: 18, damage: 4, angle: 55, knockback: 12, growth: 22, effect: 'heavy' }] },
    side: { name: 'Piston Punch', duration: 30, anim: 'm_punch',
      hitboxes: [{ start: 9, end: 12, shape: 'capsule', x1: 40, y1: -80, x2: 110, y2: -80, r: 16, use: 'piston' }] },
    up: { name: 'Antenna Zap', duration: 28, anim: 'm_zap',
      hitboxes: [{ start: 7, end: 12, x: 6, y: -150, r: 26, damage: 8, angle: 88, knockback: 24, growth: 74, effect: 'electric' }] },
    down: { name: 'Leg Sweep', duration: 28, anim: 'm_sweep',
      hitboxes: [{ start: 8, end: 11, shape: 'rect', x: 50, y: -12, w: 80, h: 22, damage: 8, angle: 75, knockback: 26, growth: 50 }] },
    sideSmash: { name: 'Hydraulic Haymaker', duration: 52, anim: 'm_haymaker', armor: [{ from: 5, to: 16, threshold: 10 }],
      hitboxes: [{ start: 17, end: 20, x: 104, y: -80, r: 30, damage: 17, angle: 38, knockback: 22, growth: 76, effect: 'heavy' }] },
    upSmash: { name: 'Rocket Uppercut', duration: 48, anim: 'm_uppercut',
      hitboxes: [{ start: 13, end: 18, shape: 'capsule', x1: 30, y1: -90, x2: 20, y2: -160, r: 26, damage: 15, angle: 85, knockback: 30, growth: 90 }] },
    downSmash: { name: 'Ground Pound', duration: 46, anim: 'm_pound',
      hitboxes: [{ start: 15, end: 18, shape: 'rect', x: 0, y: -10, w: 210, h: 22, damage: 14, angle: 32, knockback: 28, growth: 86, effect: 'heavy' }],
      timeline: [{ at: 15, camera: { shake: 4 } }] },
    nair: { name: 'Rotor Spin', duration: 32, landingLag: 12, anim: 'm_rotor',
      hitboxes: [{ start: 7, end: 18, x: 0, y: -70, r: 40, damage: 8, angle: 45, knockback: 22, growth: 60 }] },
    fair: { name: 'Drill Arm', duration: 34, landingLag: 14, anim: 'm_drill',
      hitboxes: [{ start: 10, end: 14, shape: 'capsule', x1: 40, y1: -76, x2: 100, y2: -76, r: 16, damage: 12, angle: 40, knockback: 26, growth: 86 }] },
    bair: { name: 'Exhaust Kick', duration: 30, landingLag: 12, anim: 'm_exhaust',
      hitboxes: [{ start: 8, end: 11, x: -66, y: -60, r: 28, damage: 12, angle: 145, knockback: 28, growth: 86, effect: 'fire' }] },
    uair: { name: 'Radar Swipe', duration: 30, landingLag: 10, anim: 'm_radar',
      hitboxes: [{ start: 7, end: 12, shape: 'capsule', x1: -40, y1: -140, x2: 40, y2: -140, r: 22, damage: 9, angle: 86, knockback: 22, growth: 76 }] },
    dair: { name: 'Anvil Drop', duration: 44, landingLag: 22, anim: 'm_anvil',
      velocity: [{ start: 10, end: 34, vy: 14, untilGrounded: true }],
      hitboxes: [{ start: 10, end: 34, shape: 'rect', x: 0, y: 4, w: 76, h: 26, damage: 12, angle: 285, knockback: 20, growth: 54, effect: 'heavy' }],
      timeline: [{ onLand: true, emit: 'stomp' }] },
    neutralSpecial: { name: 'Micro-Missile', duration: 40, anim: 'm_missile',
      timeline: [{ at: 14, spawn: 'missile', x: -20, y: -118, vx: 2, vy: -6 }, { at: 14, emit: 'launch' }] },
    sideSpecial: { name: 'Deploy Turret', duration: 44, anim: 'm_deploy', requires: { grounded: true }, else: 'airBoost',
      timeline: [{ at: 18, spawn: 'turret', x: 60, y: 0 }, { at: 18, emit: 'deploy' }] },
    airBoost: { name: 'Side Thruster', category: 'special', duration: 34, anim: 'm_boost', oncePerAirtime: true,
      velocity: [{ start: 6, end: 18, vx: 9, vy: -3 }],
      hitboxes: [{ start: 6, end: 16, x: 30, y: -70, r: 34, damage: 7, angle: 45, knockback: 24, growth: 50 }] },
    upSpecial: { name: 'Jet Boost', duration: 46, anim: 'm_jet', helpless: true,
      velocity: [{ start: 8, end: 24, vy: -11.5, vx: 1.5 }],
      hitboxes: [{ start: 8, end: 16, x: 0, y: 4, r: 34, damage: 7, angle: 270, knockback: 14, growth: 30, effect: 'fire' }] },
    downSpecial: { name: 'Eject!', category: 'special', duration: 30, anim: 'm_eject',
      update(view, api) { if (view.me.move.frame === 8) api.res.set('plating', 0); } },   // tick() does the eject
    taunt: { name: 'Salute', category: 'taunt', duration: 60, anim: 'm_salute', timeline: [{ at: 12, emit: 'salute' }] },

    // ── PILOT (hamster on foot) ──
    nibble: { name: 'Nibble', category: 'jab', duration: 14, anim: 'p_atk',
      hitboxes: [{ start: 2, end: 4, x: 30, y: -34, r: 14, use: 'bite' }] },
    cheekPunch: { name: 'Cheek Pouch Punch', category: 'tilt', duration: 24, anim: 'p_atk',
      hitboxes: [{ start: 6, end: 9, x: 40, y: -30, r: 16, damage: 7, angle: 40, knockback: 20, growth: 64 }] },
    earFlick: { name: 'Ear Flick', category: 'tilt', duration: 24, anim: 'p_atk',
      hitboxes: [{ start: 5, end: 9, x: 6, y: -70, r: 18, damage: 6, angle: 88, knockback: 20, growth: 64 }] },
    tailSweep: { name: 'Tail Sweep', category: 'tilt', duration: 24, anim: 'p_atk',
      hitboxes: [{ start: 6, end: 9, shape: 'rect', x: 26, y: -8, w: 54, h: 14, damage: 6, angle: 75, knockback: 22, growth: 44 }] },
    chomp: { name: 'Big Chomp', category: 'smash', duration: 40, anim: 'p_atk',
      hitboxes: [{ start: 12, end: 15, x: 44, y: -30, r: 22, damage: 13, angle: 40, knockback: 26, growth: 84, effect: 'slash' }] },
    sunflowerPop: { name: 'Sunflower Pop', category: 'smash', duration: 40, anim: 'p_atk',
      hitboxes: [{ start: 11, end: 15, x: 0, y: -76, r: 26, damage: 12, angle: 90, knockback: 28, growth: 84 }] },
    burrowSpin: { name: 'Burrow Spin', category: 'smash', duration: 40, anim: 'p_atk',
      hitboxes: [{ start: 12, end: 15, shape: 'rect', x: 0, y: -10, w: 120, h: 18, damage: 11, angle: 30, knockback: 26, growth: 82 }] },
    ballRoll: { name: 'Hamster Ball', category: 'aerial', duration: 26, landingLag: 7, anim: 'p_ball',
      hitboxes: [{ start: 5, end: 14, x: 0, y: -26, r: 28, damage: 6, angle: 50, knockback: 18, growth: 56 }] },
    hamKick: { name: 'Hind Kick', category: 'aerial', duration: 26, landingLag: 8, anim: 'p_atk',
      hitboxes: [{ start: 6, end: 9, x: -34, y: -20, r: 18, damage: 8, angle: 140, knockback: 22, growth: 70 }] },
    seedShot: { name: 'Seed Spit', category: 'special', duration: 30, anim: 'p_atk',
      timeline: [{ at: 9, spawn: 'seed', x: 22, y: -40, vx: 8, vy: -3 }] },
    scurry: { name: 'Scurry', category: 'special', duration: 30, anim: 'p_ball', oncePerAirtime: true,
      velocity: [{ start: 6, end: 18, vx: 10 }],
      hitboxes: [{ start: 6, end: 15, x: 20, y: -24, r: 22, damage: 5, angle: 40, knockback: 22, growth: 40 }] },
    wheelHop: { name: 'Wheel Hop', category: 'recovery', duration: 40, anim: 'p_ball', helpless: true,
      velocity: [{ start: 5, end: 19, vy: -11.5 }],
      hitboxes: [{ start: 5, end: 12, x: 0, y: -26, r: 26, damage: 5, angle: 85, knockback: 22, growth: 40 }] },
    redock: { name: 'Call the Mech', category: 'special', duration: 40, anim: 'p_cheer', requires: { resource: { plating: 25 } }, else: 'squeak',
      timeline: [{ at: 10, emit: 'redock' }],
      update(view, api) {
        if (view.me.move.frame !== 20) return;
        for (const w of view.entities('wreck')) api.despawn(w.id);
        api.form('base');
      } },
    squeak: { name: 'Squeak!', category: 'special', duration: 26, anim: 'p_cheer', timeline: [{ at: 4, emit: 'squeak' }] },
  },

  behavior: {
    // Plating gone in the mech → eject: hop out as the pilot and leave the wreck behind.
    tick(view, api) {
      if (view.me.form !== 'base' || view.res.plating > 0.5 || view.frame - view.vars.ejectedAt < 60) return;
      api.vars.set('ejectedAt', view.frame);
      api.spawn('wreck', { x: 0, y: 0 });
      api.form('pilot');
      api.velocity(null, -9);
      api.emit('eject');
    },
    onKO(view, api) { api.form('base'); },
  },

  ai: { preferredRange: 90, recovery: { base: ['upSpecial', 'sideSpecial'], pilot: ['upSpecial', 'sideSpecial'] }, prefer: ['sideSpecial', 'neutralSpecial'] },
  art,
});
