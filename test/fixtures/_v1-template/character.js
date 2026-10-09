// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER TEMPLATE
// Copy with:  npm run new-character -- <your-id>
// Then make it yours! Read docs/CHARACTER_GUIDE.md and docs/ART_GUIDE.md.
//
// Freedom first: use any numbers you like. The auto-balancer scales anything
// too strong back into fair limits and `npm run validate` tells you exactly
// what it changed — so go wild, then tune.
//
// Coordinates: x = pixels in FRONT of you (negative = behind), y = pixels
// relative to your FEET (negative = up). Time is in frames (60 per second).
// ─────────────────────────────────────────────────────────────────────────────

export default {
  id: 'template', // must match the folder name
  name: 'Template',
  author: 'Your Name',
  description: 'A well-rounded brawler. Replace me with your own legend.',

  // ── Stats ── (see shared/balance/rules.js for ranges; better stats cost points)
  stats: {
    weight: 100,          // 70–130   heavier = harder to KO
    runSpeed: 6.4,        // 4.5–8.5
    airSpeed: 4.5,        // 3.2–6.0
    jumpHeight: 15,       // 12–18
    doubleJumpHeight: 14, // 11–17
    airJumps: 1,          // 1–3
    gravity: 0.65,        // 0.5–0.85 (free)
    fallSpeed: 11,        // 8–14     (free)
    width: 52,            // hurtbox size; smaller costs points
    height: 92,
  },

  // ── Moves ──
  // Each move: duration (frames) + hitboxes. A hitbox is a circle that is
  // active from `start` to `end`. angle: 0 = straight forward, 90 = straight up,
  // 270 = straight down (a spike). knockback = base launch, growth = how much
  // launch scales with the target's damage %.
  // Optional: anim (pose name), pose (custom keyframes), effect (visual style),
  // color, projectiles, velocity (move yourself), intangible: [start, end],
  // landingLag (aerials).
  moves: {
    jab: {
      name: 'Quick Jab', duration: 16, anim: 'jab', effect: 'punch',
      hitboxes: [{ start: 3, end: 5, x: 36, y: -52, r: 18, damage: 3, angle: 45, knockback: 12, growth: 30 }],
    },
    side: {
      name: 'Straight', duration: 26, anim: 'punch', effect: 'punch',
      hitboxes: [{ start: 7, end: 10, x: 46, y: -48, r: 22, damage: 9, angle: 38, knockback: 22, growth: 85 }],
    },
    up: {
      name: 'Rising Hook', duration: 26, anim: 'uppercut', effect: 'punch',
      hitboxes: [{ start: 6, end: 11, x: 14, y: -100, r: 24, damage: 7, angle: 88, knockback: 26, growth: 90 }],
    },
    down: {
      name: 'Low Sweep', duration: 22, anim: 'sweep', effect: 'kick',
      hitboxes: [{ start: 6, end: 8, x: 44, y: -10, r: 20, damage: 7, angle: 75, knockback: 30, growth: 50 }],
    },
    sideSmash: {
      name: 'Haymaker', duration: 46, anim: 'heavyPunch', effect: 'punch',
      hitboxes: [{ start: 14, end: 17, x: 54, y: -48, r: 28, damage: 16, angle: 38, knockback: 32, growth: 100 }],
    },
    upSmash: {
      name: 'Sky Breaker', duration: 44, anim: 'upSmash', effect: 'punch',
      hitboxes: [{ start: 11, end: 16, x: 8, y: -108, r: 30, damage: 15, angle: 88, knockback: 34, growth: 98 }],
    },
    downSmash: {
      name: 'Split Kick', duration: 44, anim: 'splits', effect: 'kick',
      hitboxes: [
        { start: 10, end: 13, x: 46, y: -10, r: 24, damage: 14, angle: 25, knockback: 30, growth: 95 },
        { start: 10, end: 13, x: -46, y: -10, r: 24, damage: 14, angle: 155, knockback: 30, growth: 95 },
      ],
    },
    nair: {
      name: 'Tornado', duration: 30, anim: 'spin', effect: 'wind', landingLag: 7,
      hitboxes: [{ start: 5, end: 14, x: 0, y: -46, r: 38, damage: 8, angle: 40, knockback: 20, growth: 80 }],
    },
    fair: {
      name: 'Flying Kick', duration: 32, anim: 'airKick', effect: 'kick', landingLag: 10,
      hitboxes: [{ start: 7, end: 10, x: 44, y: -42, r: 24, damage: 11, angle: 40, knockback: 26, growth: 90 }],
    },
    bair: {
      name: 'Mule Kick', duration: 30, anim: 'backKick', effect: 'kick', landingLag: 10,
      hitboxes: [{ start: 6, end: 9, x: -46, y: -44, r: 24, damage: 12, angle: 140, knockback: 28, growth: 92 }],
    },
    uair: {
      name: 'Bicycle Flip', duration: 28, anim: 'flipKick', effect: 'kick', landingLag: 7,
      hitboxes: [{ start: 5, end: 9, x: 4, y: -104, r: 26, damage: 8, angle: 85, knockback: 24, growth: 85 }],
    },
    dair: {
      name: 'Meteor Stomp', duration: 38, anim: 'stomp', effect: 'earth', landingLag: 16,
      hitboxes: [{ start: 12, end: 15, x: 4, y: 8, r: 24, damage: 13, angle: 275, knockback: 22, growth: 80 }],
    },
    neutralSpecial: {
      name: 'Energy Orb', duration: 38, anim: 'cast', effect: 'magic',
      projectiles: [{ start: 14, x: 40, y: -54, vx: 9, vy: 0, life: 70, r: 13, damage: 6, angle: 35, knockback: 18, growth: 45, style: 'orb' }],
    },
    sideSpecial: {
      name: 'Rush', duration: 42, anim: 'dash', effect: 'wind',
      velocity: [{ start: 8, end: 18, vx: 11, vy: 0 }],
      hitboxes: [{ start: 9, end: 18, x: 34, y: -48, r: 26, damage: 10, angle: 40, knockback: 30, growth: 70 }],
    },
    upSpecial: {
      name: 'Rising Comet', duration: 34, anim: 'rise', effect: 'light',
      velocity: [{ start: 5, end: 16, vx: 2.5, vy: -12 }],
      hitboxes: [{ start: 5, end: 16, x: 16, y: -70, r: 26, damage: 9, angle: 80, knockback: 30, growth: 60 }],
    },
    downSpecial: {
      name: 'Ground Pound', duration: 44, anim: 'slam', effect: 'earth',
      velocity: [{ start: 10, end: 15, vy: 13 }],
      hitboxes: [
        { start: 16, end: 19, x: 40, y: -8, r: 30, damage: 12, angle: 70, knockback: 35, growth: 75 },
        { start: 16, end: 19, x: -40, y: -8, r: 30, damage: 12, angle: 110, knockback: 35, growth: 75 },
      ],
    },
  },

  // ── Art ── (all optional — see docs/ART_GUIDE.md)
  art: {
    palette: {
      skin: '#f1c3a0', primary: '#4a7bd6', secondary: '#2a2f45', accent: '#f2c14e',
      hair: '#2b1d16', eyes: '#2a6bd1', boots: '#1d1a24', outline: '#16121e',
      effect: '#7fd3ff', effect2: '#ffffff',
    },
    hair: { style: 'short' },          // spiky | short | long | bun | mohawk | none
    headgear: { type: 'band' },        // band | horns | crown | helmet  (or omit)
    // weapon: { type: 'sword', length: 62 },    // sword | staff | hammer | spear
    chains: [{ anchor: 'head', length: 30, segments: 5, width: 7, endWidth: 3, color: '#f2c14e' }], // headband tails
  },
};
