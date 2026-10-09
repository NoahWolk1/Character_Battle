// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER TEMPLATE (v2) — "Lantern", a little flame spirit in a brass cage.
// Copy it with:  npm run new-character -- <your-id> "Your Name"
//
// Your character can be ANYTHING: a storm cloud, a bee swarm, a grandma on a
// scooter, a chess army. Replace everything here. Use any numbers you like:
// the auto-balancer scales anything too strong back into fair limits, and the
// runtime Governor guarantees nobody gets one-shot or becomes unkillable.
// `npm run validate -- <id> --explain` tells you exactly what was changed and how
// to get your intent back. Aim for zero W-notes.
//
//   docs/CHARACTER_GUIDE.md  every field, limit and script call (generated tables)
//   docs/COOKBOOK.md         recipes: clouds, swarms, mechs, dragons, slimes, ...
//   docs/ART_GUIDE.md        the art contract and the quality bar
//
// Units: px and frames (60 per second). Body-local coordinates: origin at the
// feet, +x = forward (the engine mirrors when facing left), y < 0 = up.
// Angles: 0 = forward, 90 = up, 180 = back, 270 = straight down (a spike).
// ─────────────────────────────────────────────────────────────────────────────
import { defineCharacter } from '../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'template', // must equal the folder name (new-character fills this in)
  name: 'Template',
  author: 'Your Name',
  description: 'A flame spirit in a brass lantern. Floats, flicks embers, and burns oil for its big tricks.',
  archetype: 'allrounder', // rushdown | zoner | heavy | trickster | summoner | grappler | allrounder

  // ── Body: any shape. Hurtboxes are circles, capsules and rects (x, y = center). ──
  // Smaller bodies cost stat points, bigger ones refund them (CHARACTER_GUIDE §5).
  body: {
    collider: { w: 56, h: 84 },                                   // stage physics + blast-zone checks
    hurtboxes: {
      default: [
        { shape: 'circle', x: 0, y: -34, r: 30 },                 // the lantern globe
        { shape: 'capsule', x1: 0, y1: -62, x2: 0, y2: -80, r: 13 }, // the flame tip and handle
      ],
      crouch: [{ shape: 'rect', x: 0, y: -26, w: 62, h: 52 }],
    },
  },

  // ── Stats: 52-point budget shared by every character (ranges in the guide). ──
  stats: {
    weight: 92, runSpeed: 6.2, airSpeed: 4.8, jumpHeight: 14, doubleJumpHeight: 13,
    airJumps: 1, gravity: 0.58, fallSpeed: 10,
  },
  // Engine movement modes: hover | glide | fly | wallCling | crawl (cost 1–6 points).
  movement: { hover: { button: 'jump', frames: 70, fallSpeed: 1.6, drift: 1 } },

  // ── Resources gate moves and feed scripts; the HUD draws them automatically. ──
  resources: {
    oil: { max: 100, start: 100, regen: 0.25, regenDelay: 45, onHit: { perDamage: 1 },
           hud: { style: 'bar', label: 'Oil', color: '#ffb347' } },
  },

  // ── Named hit templates: reuse with `use`, and the ONLY way scripts deal damage. ──
  hitboxes: {
    singe: { damage: 4, angle: 50, knockback: 14, growth: 30, effect: 'fire', status: 'burn' },
  },

  // ── Entities: projectiles, minions, traps, zones, beams, clones, parts. ──
  entities: {
    ember: {
      kind: 'projectile', shape: { shape: 'circle', r: 9 }, life: 70, maxAlive: 2,
      motion: { type: 'linear', speed: 8 }, collide: 'die',
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 11, damage: 5, angle: 40, knockback: 16, growth: 40, effect: 'fire' }],
    },
    cinder: {
      kind: 'trap', shape: { shape: 'rect', x: 0, y: -6, w: 44, h: 12 }, life: 300, hp: 3, maxAlive: 1,
      motion: { type: 'stationary', snapToGround: true },
      hitboxes: [{ shape: 'rect', x: 0, y: -8, w: 44, h: 16, use: 'singe', rehit: 60 }],
    },
  },

  // ── Moves: a pool. The 16 classic slots plus grab, pummel, 4 throws and a taunt. ──
  // A hitbox is a Shape + {start, end} frames + damage/angle/knockback/growth.
  // Same `group` = hits a target once per move; different groups = multi-hit.
  moves: {
    // Ground attacks (jab, tilts)
    jab: { name: 'Flicker', duration: 16, anim: 'flick', effect: 'fire',
      hitboxes: [{ start: 3, end: 5, x: 40, y: -40, r: 16, damage: 3, angle: 45, knockback: 12, growth: 25 }] },
    side: { name: 'Lantern Swing', duration: 26, anim: 'swing', effect: 'fire',
      hitboxes: [{ start: 7, end: 10, shape: 'capsule', x1: 24, y1: -44, x2: 78, y2: -40, r: 14,
                   damage: 9, angle: 38, knockback: 22, growth: 75 }] },
    up: { name: 'Flare Up', duration: 26, anim: 'flare', effect: 'fire',
      hitboxes: [{ start: 6, end: 11, x: 0, y: -104, r: 24, damage: 8, angle: 88, knockback: 24, growth: 78 }] },
    down: { name: 'Wick Sweep', duration: 22, anim: 'sweep', effect: 'fire',
      hitboxes: [{ start: 6, end: 8, shape: 'rect', x: 40, y: -8, w: 56, h: 16, damage: 7, angle: 75, knockback: 30, growth: 45 }] },

    // Smash attacks: hold the smash button to charge (automatic for smashes)
    sideSmash: { name: 'Bellows Blast', duration: 46, anim: 'bellows', effect: 'fire',
      hitboxes: [{ start: 14, end: 17, shape: 'capsule', x1: 30, y1: -40, x2: 100, y2: -40, r: 22,
                   damage: 15, angle: 38, knockback: 25, growth: 85 }] },
    upSmash: { name: 'Pillar of Flame', duration: 44, anim: 'pillar', effect: 'fire',
      hitboxes: [{ start: 12, end: 17, shape: 'capsule', x1: 0, y1: -60, x2: 0, y2: -150, r: 24,
                   damage: 14, angle: 90, knockback: 32, growth: 92 }] },
    downSmash: { name: 'Ring of Fire', duration: 44, anim: 'ring', effect: 'fire',
      hitboxes: [{ start: 11, end: 14, shape: 'rect', x: 0, y: -12, w: 170, h: 24,
                   damage: 13, angle: 30, knockback: 30, growth: 88 }] },

    // Aerials (landingLag = frames stuck after landing mid-move)
    nair: { name: 'Halo', duration: 28, landingLag: 8, anim: 'spin', effect: 'fire',
      hitboxes: [{ start: 5, end: 14, x: 0, y: -40, r: 40, damage: 7, angle: 45, knockback: 18, growth: 60 }] },
    fair: { name: 'Spark Lash', duration: 30, landingLag: 10, anim: 'lash', effect: 'fire',
      hitboxes: [{ start: 8, end: 11, x: 50, y: -40, r: 22, damage: 10, angle: 40, knockback: 24, growth: 84 }] },
    bair: { name: 'Backdraft', duration: 28, landingLag: 9, anim: 'backdraft', effect: 'fire',
      hitboxes: [{ start: 7, end: 10, x: -50, y: -38, r: 22, damage: 11, angle: 145, knockback: 26, growth: 86 }] },
    uair: { name: 'Wisp Crown', duration: 26, landingLag: 7, anim: 'crown', effect: 'fire',
      hitboxes: [{ start: 5, end: 10, x: 0, y: -100, r: 26, damage: 8, angle: 86, knockback: 22, growth: 78 }] },
    dair: { name: 'Drip Drop', duration: 32, landingLag: 14, anim: 'drop', effect: 'fire',
      hitboxes: [{ start: 9, end: 12, x: 0, y: 4, r: 22, damage: 10, angle: 280, knockback: 18, growth: 62 }] },

    // Specials. Costs spend a resource; `else` runs when you can't pay.
    neutralSpecial: { name: 'Ember Shot', duration: 34, anim: 'cast', cost: { oil: 15 }, else: 'sputter',
      timeline: [{ at: 12, spawn: 'ember', x: 36, y: -40 }, { at: 12, sfx: 'whoosh' }] },
    sputter: { name: 'Sputter', category: 'special', duration: 28, anim: 'sputter',
      timeline: [{ at: 6, emit: 'sputter' }] },
    sideSpecial: { name: 'Comet Dash', duration: 36, anim: 'dash', effect: 'fire', // once per airtime by default
      velocity: [{ start: 6, end: 18, vx: 10, vy: -1 }],
      hitboxes: [{ start: 7, end: 18, x: 24, y: -40, r: 30, damage: 8, angle: 40, knockback: 24, growth: 60 }] },
    upSpecial: { name: 'Updraft', duration: 40, anim: 'rise', effect: 'fire', // helpless afterwards by default
      velocity: [{ start: 6, end: 24, vy: -10 }],
      hitboxes: [{ start: 6, end: 12, x: 0, y: -60, r: 32, damage: 6, angle: 85, knockback: 24, growth: 50 }] },
    downSpecial: { name: 'Drop Cinder', duration: 32, anim: 'drop', cost: { oil: 25 }, else: 'sputter',
      requires: { grounded: true },
      timeline: [{ at: 12, spawn: 'cinder', x: 50, y: 0 }] },

    // Grab (shield + attack on the ground), pummel, throws: `release` deals the throw hit.
    grab: { name: 'Hook Handle', duration: 30, anim: 'grab',
      hitboxes: [{ start: 7, end: 9, kind: 'grab', shape: 'rect', x: 46, y: -44, w: 44, h: 50 }] },
    pummel: { name: 'Toast', duration: 16, anim: 'pummel', timeline: [{ at: 5, release: { damage: 2, angle: 0, knockback: 0, growth: 0, setKnockback: 0 } }] },
    fthrow: { name: 'Fling', duration: 28, anim: 'fling', timeline: [{ at: 10, release: { damage: 8, angle: 40, knockback: 50, growth: 66 } }] },
    bthrow: { name: 'Spin Out', duration: 32, anim: 'spinout', timeline: [{ at: 16, release: { damage: 9, angle: 140, knockback: 52, growth: 68 } }] },
    uthrow: { name: 'Hot Air', duration: 30, anim: 'hotair', timeline: [{ at: 12, release: { damage: 7, angle: 90, knockback: 50, growth: 70, effect: 'fire' } }] },
    dthrow: { name: 'Snuff', duration: 32, anim: 'snuff', timeline: [{ at: 14, release: { damage: 6, angle: 75, knockback: 56, growth: 30 } }] },

    // Taunt (T key). Pure flavor: custom events (emit) drive your art.fx.
    taunt: { name: 'Glow Up', duration: 60, anim: 'glow', timeline: [{ at: 10, emit: 'glowUp' }] },
  },

  // Optional: slots (§8), vars (§12), statuses (§13), forms (§15), behavior hooks and
  // scripts (§16) in CHARACTER_GUIDE, plus the COOKBOOK. A tiny hook example:
  behavior: {
    onLand(view, api) { if (view.res.oil < 20) api.emit('lowOil'); }, // art shows a sputtering flame
  },

  ai: { preferredRange: 140, recovery: ['upSpecial', 'sideSpecial'], prefer: ['neutralSpecial'] },
  art,
});
