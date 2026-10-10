// ─────────────────────────────────────────────────────────────────────────────
// Global game rules. These apply to EVERY character equally.
// Characters cannot change anything in this file — only the engine owner should.
// Units: pixels and frames (the simulation runs at a fixed 60 frames/second).
// ─────────────────────────────────────────────────────────────────────────────

export const TICK_RATE = 60;
export const SNAPSHOT_EVERY = 1; // server sends a snapshot every N ticks (60 Hz: less buffering online)

export const MATCH = {
  stocks: 3,
  maxPlayers: 4,
  maxPercent: 999,
  respawnDelay: 70,        // frames spent "dead" before reappearing
  respawnInvuln: 120,      // frames of invincibility after respawn
  respawnPlatformMax: 240, // frames before the respawn halo drops you
  countdownFrames: 180,    // 3..2..1..GO
  endDelay: 150,           // frames of slow-mo/celebration before results
};

export const PHYSICS = {
  jumpSquat: 4,            // frames crouching before leaving the ground
  shortHopFactor: 0.62,    // short hop velocity multiplier (release jump during jumpsquat)
  groundFriction: 0.55,    // px/frame² deceleration when no input on ground
  airFriction: 0.08,       // px/frame² horizontal deceleration in air with no input
  fastFallMultiplier: 1.55,
  landingLag: 4,           // normal landing lag
  launchDecay: 0.42,       // px/frame² — how quickly knockback velocity bleeds off
  hitstunPerKnockback: 0.4,
  maxHitstun: 90,
  tumbleThreshold: 32,     // knockback above this puts you in tumble
  diMaxDegrees: 12,        // directional influence: you can bend launches by this much
  edgeSnapX: 34,           // how close (px) to the stage edge you must be to auto-climb
  edgeSnapY: 56,           // how far below the stage top you can still auto-climb
  dropThroughFrames: 6,
};

export const COMBAT = {
  knockbackScale: 0.15,    // Smash-style knockback units → px/frame
  hitlagBase: 4,
  hitlagPerDamage: 0.34,
  hitlagMax: 16,
  // Stale-move negation: re-using the same move over and over makes it weaker.
  staleQueueSize: 9,
  stalePenalty: [0.09, 0.085, 0.08, 0.075, 0.07, 0.065, 0.06, 0.055, 0.05],
  smashChargeMax: 60,      // frames a smash attack can be charged
  smashChargeBonus: 0.4,   // fully-charged smash does +40% damage
  maxProjectilesPerFighter: 3,
};

export const SHIELD = {
  max: 50,
  regen: 0.12,             // per frame when not shielding
  decay: 0.14,             // per frame while held
  damageMultiplier: 1.15,
  stunBase: 3,
  stunPerDamage: 0.55,
  breakStun: 150,
  pushback: 0.45,          // px/frame pushback per point of damage
};

export const DODGE = {
  roll:   { duration: 26, invuln: [4, 18], distance: 150 },
  spot:   { duration: 22, invuln: [3, 16] },
  air:    { duration: 30, invuln: [3, 22], speed: 9, landingLag: 10 },
  cooldownAfterRepeat: 0,
};

// The "reference fighter" used by the balance validator to estimate how
// strong a move is. Do not change unless you rebalance every character.
export const REFERENCE = {
  weight: 100,
  blastDistanceX: 960,     // distance from center stage to side blast zone (actual stage: 1060)
  blastDistanceY: 860,     // distance from stage top to top blast zone (actual stage: 940)
};

// Buttons the engine understands. Inputs are booleans per frame.
export const BUTTONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'special', 'strong', 'shield', 'taunt']; // bit i = BUTTONS[i]; taunt = bit 9
export const INPUT_BUFFER = 7; // frames a button press is remembered

// Deep-freeze every export (engine rules are read-only at runtime). Must stay the LAST statement.
import * as self from './constants.js'; import { deepFreeze } from './util/freeze.js'; Object.values(self).forEach((v) => deepFreeze(v));
