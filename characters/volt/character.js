// ─────────────────────────────────────────────────────────────────────────────
// VOLT — a pocket-sized hover-bot that runs on pure static.
//
// This character shows off the NON-STANDARD route: instead of the default
// humanoid puppet, `art.draw` (in ./art.js) paints the whole robot by hand —
// helmet + pixel-screen face, floating hands tethered by energy, glowing joints,
// hover-jet boots and electric arcs — while still riding the engine's rig so
// every animation, attack pose and hitbox lines up for free.
//
// Gameplay identity: tiny + light + floaty with 2 air jumps. Lots of multi-hit
// moves (hitboxes in different `group`s can each hit once), a crackling
// projectile, a zip dash and a teleport-style recovery.
//
// Coordinates: x = pixels in FRONT of you (negative = behind), y = pixels
// relative to your FEET (negative = up). Time is in frames (60 per second).
// ─────────────────────────────────────────────────────────────────────────────
import { drawVolt, drawVoltProjectile, voltPose } from './art.js';

export default {
  id: 'volt',
  name: 'Volt',
  author: 'Claude',
  description: 'A pocket-sized hover-bot running on pure static. Tiny, floaty and fast, Volt zips in, shreds with multi-hit sparks, and blinks away before you can blink back.',

  // ── Stats ── tiny hurtbox + 2 air jumps + speed are paid for with low weight
  // and modest jumps. Gravity / fall speed are free: Volt is very floaty.
  stats: {
    weight: 74,           // featherweight — dies early, that's the trade
    runSpeed: 7.4,
    airSpeed: 5.2,
    jumpHeight: 14,
    doubleJumpHeight: 13,
    airJumps: 2,
    gravity: 0.55,        // floaty
    fallSpeed: 9.5,
    width: 46,            // small hurtbox (costs points)
    height: 82,
  },

  moves: {
    // ── Ground ──────────────────────────────────────────────────────────────
    jab: {
      name: 'Zap Jab', duration: 20, anim: 'jab', effect: 'electric',
      description: 'Two quick shocks from the floating fist.',
      hitboxes: [
        { start: 3, end: 4, x: 30, y: -48, r: 15, damage: 3, angle: 80, knockback: 8, growth: 10, group: 0 },
        { start: 9, end: 11, x: 34, y: -48, r: 17, damage: 4, angle: 40, knockback: 18, growth: 40, group: 1 },
      ],
    },
    side: {
      name: 'Rocket Palm', duration: 26, anim: 'thrust', effect: 'electric',
      description: 'Launches the detached hand forward on its energy tether.',
      hitboxes: [
        { start: 7, end: 10, x: 54, y: -48, r: 18, damage: 8, angle: 36, knockback: 22, growth: 78 },
        { start: 7, end: 10, x: 30, y: -48, r: 14, damage: 6, angle: 45, knockback: 18, growth: 60 },
      ],
    },
    up: {
      name: 'Static Fountain', duration: 26, anim: 'uppercut', effect: 'electric',
      description: 'Two-hit spark geyser above the head.',
      hitboxes: [
        { start: 5, end: 7, x: 14, y: -78, r: 20, damage: 3, angle: 95, knockback: 20, growth: 10, group: 0 },
        { start: 9, end: 12, x: 6, y: -92, r: 22, damage: 6, angle: 88, knockback: 28, growth: 92, group: 1 },
      ],
    },
    down: {
      name: 'Spark Skid', duration: 22, anim: 'sweep', effect: 'electric',
      description: 'A low thruster kick that pops foes up for combos.',
      hitboxes: [{ start: 5, end: 7, x: 38, y: -8, r: 17, damage: 6, angle: 80, knockback: 30, growth: 42 }],
    },

    // ── Smashes ─────────────────────────────────────────────────────────────
    sideSmash: {
      name: 'Thunderclap', duration: 46, effect: 'electric',
      description: 'Both hands slam together — two crackles then a booming discharge.',
      pose: {
        limb: 'frontHand',
        windup: { lean: -0.25, bx: -6, fU: -1.0, fL: 1.5, bU: -0.7, bL: 1.6, flU: 0.35, flL: -0.4, blU: -0.4, blL: -0.3 },
        strike: { lean: 0.35, bx: 10, fU: 1.55, fL: 0.05, bU: 1.42, bL: 0.12, flU: 0.6, flL: -0.5, blU: -0.55, blL: -0.2, sx: 1.06, sy: 0.95 },
      },
      hitboxes: [
        { start: 13, end: 14, x: 44, y: -46, r: 20, damage: 3, angle: 20, knockback: 12, growth: 6, group: 0 },
        { start: 16, end: 17, x: 48, y: -46, r: 22, damage: 3, angle: 20, knockback: 12, growth: 6, group: 1 },
        { start: 19, end: 22, x: 54, y: -46, r: 28, damage: 12, angle: 36, knockback: 40, growth: 116, group: 2 },
      ],
    },
    upSmash: {
      name: 'Tesla Tower', duration: 48, anim: 'upSmash', effect: 'electric',
      description: 'A lightning pillar erupts upward, juggling then blasting.',
      hitboxes: [
        { start: 12, end: 14, x: 4, y: -90, r: 26, damage: 3, angle: 92, knockback: 22, growth: 8, group: 0 },
        { start: 16, end: 18, x: 4, y: -96, r: 26, damage: 3, angle: 92, knockback: 22, growth: 8, group: 1 },
        { start: 20, end: 23, x: 4, y: -104, r: 30, damage: 11, angle: 89, knockback: 44, growth: 122, group: 2 },
      ],
    },
    downSmash: {
      name: 'Static Ring', duration: 44, effect: 'electric',
      description: 'Plants both hands and sends a shock ring along the floor both ways.',
      pose: {
        limb: 'body',
        windup: { lean: 0.2, by: 14, sy: 0.9, sx: 1.06, fU: 0.4, fL: 1.8, bU: 0.3, bL: 1.8, flU: 0.6, flL: -1.3, blU: -0.5, blL: -1.2 },
        strike: { lean: 0.05, by: 18, fU: 1.05, fL: 0.15, bU: -1.05, bL: -0.15, flU: 0.9, flL: -1.2, blU: -0.9, blL: -1.0, sx: 1.08, sy: 0.92 },
      },
      hitboxes: [
        { start: 11, end: 13, x: 40, y: -12, r: 22, damage: 4, angle: 70, knockback: 18, growth: 10, group: 0 },
        { start: 11, end: 13, x: -40, y: -12, r: 22, damage: 4, angle: 110, knockback: 18, growth: 10, group: 0 },
        { start: 16, end: 19, x: 50, y: -12, r: 26, damage: 10, angle: 28, knockback: 36, growth: 108, group: 1 },
        { start: 16, end: 19, x: -50, y: -12, r: 26, damage: 10, angle: 152, knockback: 36, growth: 108, group: 1 },
      ],
    },

    // ── Aerials ─────────────────────────────────────────────────────────────
    nair: {
      name: 'Volt Spin', duration: 34, effect: 'electric', landingLag: 8,
      description: 'Spins twice inside a crackling ring — four zaps and a pop.',
      pose: {
        limb: 'body', spinTurns: 2,
        windup: { fU: 1.0, fL: 1.2, bU: -1.0, bL: 1.2, flU: 0.5, flL: -1.4, blU: -0.3, blL: -1.4, sy: 0.94 },
        strike: { fU: 1.65, fL: 0.1, bU: -1.65, bL: 0.1, flU: 0.8, flL: -0.7, blU: -0.8, blL: -0.7 },
      },
      hitboxes: [
        { start: 5, end: 7, x: 0, y: -42, r: 32, damage: 2.5, angle: 60, knockback: 10, growth: 4, group: 0 },
        { start: 9, end: 11, x: 0, y: -42, r: 32, damage: 2.5, angle: 60, knockback: 10, growth: 4, group: 1 },
        { start: 13, end: 15, x: 0, y: -42, r: 32, damage: 2.5, angle: 60, knockback: 10, growth: 4, group: 2 },
        { start: 17, end: 19, x: 0, y: -42, r: 32, damage: 2.5, angle: 60, knockback: 10, growth: 4, group: 3 },
        { start: 21, end: 23, x: 0, y: -42, r: 34, damage: 5, angle: 45, knockback: 24, growth: 70, group: 4 },
      ],
    },
    fair: {
      name: 'Jolt Kick', duration: 28, anim: 'airKick', effect: 'electric', landingLag: 9,
      description: 'A snappy thruster-boot kick.',
      hitboxes: [{ start: 6, end: 9, x: 36, y: -34, r: 20, damage: 9, angle: 40, knockback: 28, growth: 92 }],
    },
    bair: {
      name: 'Afterburner', duration: 30, anim: 'backKick', effect: 'electric', landingLag: 10,
      description: 'Both jets fire backward in one heavy blast. Volt\'s best kill move.',
      hitboxes: [
        { start: 7, end: 9, x: -40, y: -34, r: 22, damage: 12, angle: 145, knockback: 36, growth: 106 },
        { start: 10, end: 13, x: -36, y: -34, r: 18, damage: 7, angle: 145, knockback: 20, growth: 70 },
      ],
    },
    uair: {
      name: 'Halo Zap', duration: 30, anim: 'flipKick', effect: 'electric', landingLag: 8,
      description: 'Flips overhead trailing a three-hit arc.',
      hitboxes: [
        { start: 5, end: 6, x: 10, y: -80, r: 22, damage: 3, angle: 90, knockback: 18, growth: 6, group: 0 },
        { start: 8, end: 9, x: 0, y: -82, r: 22, damage: 3, angle: 90, knockback: 18, growth: 6, group: 1 },
        { start: 11, end: 13, x: -6, y: -80, r: 24, damage: 5, angle: 85, knockback: 24, growth: 80, group: 2 },
      ],
    },
    dair: {
      name: 'Static Drill', duration: 36, effect: 'electric', landingLag: 14,
      description: 'Points both jets down and corkscrews a drill of sparks below.',
      pose: {
        limb: 'frontFoot',
        windup: { lean: 0.0, fU: 2.6, fL: 0.5, bU: 2.4, bL: 0.6, flU: 0.6, flL: -1.4, blU: 0.4, blL: -1.4, by: -6, sy: 0.92 },
        strike: { lean: 0.0, fU: 2.9, fL: 0.15, bU: 2.8, bL: 0.2, flU: 0.06, flL: 0.0, blU: -0.06, blL: 0.0, sy: 1.1, sx: 0.92 },
      },
      hitboxes: [
        { start: 8, end: 10, x: 2, y: 2, r: 20, damage: 2.5, angle: 285, knockback: 10, growth: 4, group: 0 },
        { start: 12, end: 14, x: 2, y: 2, r: 20, damage: 2.5, angle: 285, knockback: 10, growth: 4, group: 1 },
        { start: 16, end: 18, x: 2, y: 2, r: 20, damage: 2.5, angle: 285, knockback: 10, growth: 4, group: 2 },
        { start: 20, end: 23, x: 2, y: 0, r: 24, damage: 5, angle: 55, knockback: 26, growth: 62, group: 3 },
      ],
    },

    // ── Specials ────────────────────────────────────────────────────────────
    neutralSpecial: {
      name: 'Ball Lightning', duration: 38, anim: 'cast', effect: 'electric',
      description: 'Fires a crackling orb of static straight ahead.',
      projectiles: [{ start: 14, x: 40, y: -44, vx: 8.5, vy: 0, life: 70, r: 13, damage: 7, angle: 38, knockback: 18, growth: 46, style: 'volt' }],
    },
    sideSpecial: {
      name: 'Zip Dash', duration: 38, anim: 'dash', effect: 'electric',
      description: 'Rockets forward as a streak of light; the first contact drags, the end launches.',
      velocity: [{ start: 7, end: 17, vx: 13, vy: 0 }],
      hitboxes: [
        { start: 7, end: 11, x: 30, y: -40, r: 24, damage: 4, angle: 30, knockback: 14, growth: 10, group: 0 },
        { start: 12, end: 17, x: 30, y: -40, r: 26, damage: 6, angle: 38, knockback: 32, growth: 80, group: 1 },
      ],
    },
    upSpecial: {
      name: 'Flash Step', duration: 36, effect: 'electric',
      description: 'Discharges, blinks out of existence, and re-forms as a bolt shooting upward.',
      pose: {
        limb: 'body',
        windup: { lean: 0.25, by: 12, sy: 0.84, sx: 1.12, fU: 0.4, fL: 1.9, bU: 0.3, bL: 1.9, flU: 0.9, flL: -1.8, blU: 0.6, blL: -1.6 },
        strike: { lean: 0.08, fU: 2.95, fL: 0.05, bU: 2.75, bL: 0.15, flU: 0.06, flL: -0.05, blU: -0.1, blL: -0.1, sy: 1.22, sx: 0.84 },
      },
      intangible: [4, 12],
      velocity: [
        { start: 1, end: 7, vx: 0, vy: 0 },
        { start: 8, end: 20, vx: 3.5, vy: -16 },
        { start: 21, end: 22, vy: -4 },
      ],
      hitboxes: [
        { start: 5, end: 7, x: 0, y: -40, r: 34, damage: 5, angle: 80, knockback: 30, growth: 30, group: 0 },
        { start: 8, end: 20, x: 6, y: -56, r: 24, damage: 6, angle: 82, knockback: 30, growth: 60, group: 1 },
      ],
    },
    downSpecial: {
      name: 'Overload', duration: 42, effect: 'electric',
      description: 'Overclocks the core into a three-pulse shock dome.',
      pose: {
        limb: 'body',
        windup: { lean: -0.05, by: 6, sy: 0.9, sx: 1.04, fU: 1.0, fL: 2.1, bU: 0.9, bL: 2.2, flU: 0.35, flL: -0.6, blU: -0.35, blL: -0.6 },
        strike: { lean: -0.12, head: -0.15, fU: 2.3, fL: 0.1, bU: -2.3, bL: 0.1, flU: 0.55, flL: -0.2, blU: -0.55, blL: -0.2, sx: 1.08, sy: 1.04 },
      },
      hitboxes: [
        { start: 10, end: 12, x: 0, y: -40, r: 40, damage: 3, angle: 75, knockback: 18, growth: 6, group: 0 },
        { start: 15, end: 17, x: 0, y: -40, r: 40, damage: 3, angle: 75, knockback: 18, growth: 6, group: 1 },
        { start: 20, end: 23, x: 0, y: -40, r: 42, damage: 7, angle: 60, knockback: 34, growth: 86, group: 2 },
      ],
    },
  },

  // ── Art ── fully custom: see ./art.js
  art: {
    palette: {
      primary: '#f2f6fb',   // glossy white shell
      secondary: '#19c2bf', // teal panels
      accent: '#ffe14a',    // electric yellow energy
      joint: '#2a3448',     // dark joints / undersuit
      visor: '#0a1622',     // face screen
      eyes: '#6ff7ff',      // pixel eyes
      outline: '#131726',
      effect: '#ffe14a',
      effect2: '#6ff7ff',
    },
    // Alt palettes for duplicate picks (mirror matches / training dummy): shell, panels and energy all shift.
    palettes: [
      {},
      // Stealth: graphite shell, magenta panels, violet charge
      { primary: '#4a4f63', secondary: '#e0429a', accent: '#ff7af0', joint: '#1a1c28', eyes: '#ff9ef5', effect: '#ff7af0', effect2: '#b48cff' },
      // Blaze: crimson shell, gold panels, orange charge
      { primary: '#e04848', secondary: '#f2b631', accent: '#ffb347', joint: '#3a1e22', eyes: '#ffe08a', effect: '#ffb347', effect2: '#ffe9a8' },
      // Circuit: jade shell, navy panels, lime charge
      { primary: '#bff2d8', secondary: '#2a4fb8', accent: '#9dff5a', joint: '#173040', eyes: '#c8ff7a', effect: '#9dff5a', effect2: '#5af0ff' },
    ],
    build: { head: 1.38, legs: 0.74, arms: 0.92, torso: 1.0, shoulders: 1.15 },
    pose: voltPose,
    draw: drawVolt,
    projectile: drawVoltProjectile,
  },
};
