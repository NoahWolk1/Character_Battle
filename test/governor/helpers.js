// Shared helpers for Governor unit tests: a minimal fake game/fighter and a
// launch simulator that mirrors the v1 engine's hitstun physics.
import { PHYSICS } from '../../shared/constants.js';
import STAGE from '../../shared/stages/sky-sanctum.js';
import { Governor } from '../../shared/sim/governor.js';

export { STAGE };

let failures = 0;
let passes = 0;
export function check(cond, msg) {
  if (cond) { passes++; return; }
  failures++;
  console.error(`  ✘ ${msg}`);
}
export function done(name) {
  if (failures) { console.error(`✘ ${name}: ${failures} failed, ${passes} passed`); process.exit(1); }
  console.log(`✔ ${name}: ${passes} checks`);
}

export function fakeFighter(i, over = {}) {
  return {
    id: `p${i}`, index: i, x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, facing: 1,
    percent: 0, stocks: 3, grounded: true, state: 'idle', hitlag: 0, hitstun: 0,
    input: {}, stats: { weight: 100, gravity: 0.65, fallSpeed: 11, height: 92 },
    statuses: [], mods: null, action: null, armorPassive: 0,
    ...over,
  };
}

export function fakeGame(fighters, rules = {}) {
  const game = { frame: 0, stage: STAGE, rules: { governor: true, ...rules }, fighters, events: [], entities: [] };
  game.emit = (e) => game.events.push(e);
  game.gov = new Governor(game);
  return game;
}

/** Advances the fake clock one frame and runs Governor.endFrame. */
export function tick(game, n = 1) {
  for (let i = 0; i < n; i++) { game.gov.endFrame(game); game.frame++; }
}

/**
 * Simulates the target after a hit with the engine's physics (gravity during hitstun,
 * linear knockback decay, ground land/bounce, blast check with collider height).
 * The target holds no input. Returns true if it crosses a blast zone before knockback ends.
 */
export function flies(t, res, stage = STAGE) {
  const b = stage.blast, g = stage.ground;
  let x = t.x, y = t.y, kx = res.kx, ky = res.ky, vx = 0, vy = 0;
  const h = t.stats.height, grav = t.stats.gravity, fs = t.stats.fallSpeed;
  let grounded = t.grounded && !(ky < -0.5 || res.tumble);
  for (let f = 0; f < 900; f++) {
    if (!grounded) vy = Math.min(fs, vy + grav);
    const mag = Math.hypot(kx, ky);
    if (mag > 0) {
      if (mag <= PHYSICS.launchDecay) { kx = 0; ky = 0; } else { const k = (mag - PHYSICS.launchDecay) / mag; kx *= k; ky *= k; }
    }
    const oy = y;
    x += vx + kx; y += vy + ky;
    if (grounded) {
      if (x < g.x1 || x > g.x2) grounded = false; else { y = g.y; vy = 0; if (ky > 0) ky = 0; }
    } else if (x >= g.x1 && x <= g.x2 && y >= g.y && oy <= g.y + 0.01 && vy + ky >= 0) {
      y = g.y;
      if (res.tumble && Math.hypot(kx, ky) > 5) { ky = -Math.abs(ky) * 0.55; vy = -Math.abs(vy) * 0.3; } else return false;
    } else if (x + 26 > g.x1 && x - 26 < g.x2 && y > g.y && y - h < g.bottom) {
      if (oy - h >= g.bottom - 0.01) { y = g.bottom + h; vy = Math.max(0, vy); ky = Math.abs(ky) * 0.4; } else if (x < 0) { x = g.x1 - 26; if (kx > 0) kx = -kx * 0.5; } else { x = g.x2 + 26; if (kx < 0) kx = -kx * 0.5; }
    }
    if (x < b.left || x > b.right || y > b.bottom || y - h < b.top) return true;
    if (kx === 0 && ky === 0) return false;
  }
  return false;
}

/** The 9 DI inputs (including none). */
export const DI_INPUTS = [];
for (const lr of [-1, 0, 1]) for (const ud of [-1, 0, 1]) DI_INPUTS.push({ left: lr < 0, right: lr > 0, up: ud < 0, down: ud > 0 });
