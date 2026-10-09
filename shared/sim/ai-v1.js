// v1 CPU (frozen). Byte-for-byte the pre-v2 cpuThink; golden replays select it
// through rules.aiVersion = 1 (test/golden/harness.js). Do not edit.
import { mulberry32, defaultSeed } from './rng.js';

const LEVELS = {
  easy:   { react: 22, aggression: 0.35, shield: 0.04, smash: 0.15, accuracy: 0.6 },
  normal: { react: 12, aggression: 0.6,  shield: 0.12, smash: 0.3,  accuracy: 0.8 },
  hard:   { react: 5,  aggression: 0.85, shield: 0.25, smash: 0.45, accuracy: 0.95 },
};

// Seeded per-game stream (no global randomness) so CPU matches are reproducible.
// Falls back to a lazily created stream if a Game didn't provide one.
function rand(game) {
  if (!game.rng) game.rng = mulberry32(defaultSeed(game.fighters, game.stage && game.stage.id));
  return game.rng();
}

const blank = () => ({ left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, strong: false, shield: false });

export function cpuThink(game, f) {
  return { ...think(game, f) }; // always a fresh object so edge detection works
}

function think(game, f) {
  const b = f.brain;
  const L = LEVELS[b.level] || LEVELS.normal;
  if (f.state === 'dead') return blank();
  if (f.state === 'respawn') return f.stateFrame > 40 ? { ...blank(), down: true } : blank();
  if (b.level === 'dummy') return blank();

  // Release one-frame buttons so they can be pressed again.
  const held = b.held;
  held.jump = held.attack = held.special = held.strong = false;

  if (--b.timer > 0) {
    // Keep recovering every frame even between decisions.
    if (isOffstage(game, f)) return recover(game, f, held);
    return { ...held, shield: held.shield && f.state === 'shield' ? true : held.shield };
  }
  b.timer = L.react + Math.floor(rand(game) * L.react);

  const next = blank();
  if (isOffstage(game, f)) { b.held = recover(game, f, next); return b.held; }

  const foe = nearestFoe(game, f);
  if (!foe) { b.held = next; return next; }
  const dx = foe.x - f.x;
  const dy = (foe.y - foe.stats.height / 2) - (f.y - f.stats.height / 2);
  const adx = Math.abs(dx);
  const dir = Math.sign(dx) || 1;
  const reach = 70 + f.stats.width / 2;

  // Defend
  const foeAttacking = foe.state === 'attack' && adx < 160;
  if (foeAttacking && f.grounded && rand(game) < L.shield) {
    next.shield = true;
    b.timer = 10;
    b.held = next;
    return next;
  }

  if (adx < reach && Math.abs(dy) < 70 && rand(game) < L.aggression) {
    // In range: attack.
    if (dir > 0) next.right = true; else next.left = true;
    if (f.grounded) {
      const r = rand(game);
      if (foe.percent > 90 && r < L.smash) { next.strong = true; }
      else if (dy < -40) { next.up = true; next.left = next.right = false; next.attack = true; }
      else if (r < 0.25) { next.left = next.right = false; next.attack = true; }
      else if (r < 0.4) { next.down = true; next.left = next.right = false; next.attack = true; }
      else next.attack = true;
    } else {
      if (dy < -30) { next.up = true; next.left = next.right = false; }
      else if (dy > 40) { next.down = true; next.left = next.right = false; }
      next.attack = true;
    }
    b.timer = Math.max(b.timer, 8);
  } else if (dy < -110 && f.grounded && rand(game) < 0.5) {
    next.jump = true;
    if (dir > 0) next.right = true; else next.left = true;
  } else if (adx > 260 && rand(game) < 0.18 && f.char.moves.neutralSpecial?.projectiles?.length) {
    f.facing = dir;
    next.special = true;
  } else {
    if (rand(game) < L.accuracy) { if (dir > 0) next.right = true; else next.left = true; }
    if (rand(game) < 0.08 && f.grounded) next.jump = true;
    // Don't run off the stage.
    const g = game.stage.ground;
    if ((next.right && f.x > g.x2 - 40) || (next.left && f.x < g.x1 + 40)) { next.left = next.right = false; }
  }
  b.held = next;
  return next;
}

function nearestFoe(game, f) {
  let best = null, bd = Infinity;
  for (const o of game.fighters) {
    if (o === f || o.eliminated || o.state === 'dead' || o.state === 'respawn') continue;
    const d = Math.hypot(o.x - f.x, o.y - f.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function isOffstage(game, f) {
  const g = game.stage.ground;
  return !f.grounded && (f.x < g.x1 - 10 || f.x > g.x2 + 10 || f.y > g.y + 10);
}

function recover(game, f, out) {
  const g = game.stage.ground;
  const toward = f.x < 0 ? 1 : -1;
  out.left = toward < 0;
  out.right = toward > 0;
  out.down = false;
  out.up = false;
  out.attack = out.strong = out.shield = false;
  out.jump = false;
  out.special = false;
  if (f.state === 'helpless' || f.state === 'attack' || f.state === 'hitstun') return out;
  const below = f.y > g.y - 20;
  const farX = f.x < g.x1 - 220 || f.x > g.x2 + 220;
  if (f.vy > 0 && f.jumpsLeft > 0 && (below || f.y > -60)) { out.jump = true; return out; }
  if (farX && !f.usedSideSpecial && f.y < g.y + 120 && f.vy > 0) { out.special = true; return out; }
  if (f.vy > 0 && f.jumpsLeft === 0 && f.y > g.y - 40) { out.up = true; out.special = true; }
  return out;
}
