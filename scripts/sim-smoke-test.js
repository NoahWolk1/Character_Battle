#!/usr/bin/env node
// Headless sanity test: every character fights CPU matches with no crashes or
// NaNs, and an absurdly overpowered character gets scaled back to fair numbers.
import { loadAllCharacters } from '../server/characters.js';
import { validateCharacter } from '../shared/balance/validate.js';
import { Game } from '../shared/sim/game.js';
import { MOVE_BUDGET, STAT_BUDGET, CATEGORIES } from '../shared/balance/rules.js';
import { getStage, DEFAULT_STAGE_ID } from '../shared/stages/index.js';
import { mulberry32 } from '../shared/sim/rng.js';

const stage = getStage(DEFAULT_STAGE_ID);
const fail = (m) => { console.error(`✘ ${m}`); process.exit(1); };
const chars = [...(await loadAllCharacters({ log: false })).values()];
if (!chars.length) fail('no characters loaded');

// 1. Cheater check — infinite everything must be scaled down.
const cheat = {
  id: 'cheater', name: 'Cheater',
  stats: { weight: 9999, runSpeed: 99, airSpeed: 99, jumpHeight: 99, doubleJumpHeight: 99, airJumps: 99, width: 2, height: 2 },
  moves: Object.fromEntries(['jab', 'side', 'up', 'down', 'sideSmash', 'upSmash', 'downSmash', 'nair', 'fair', 'bair', 'uair', 'dair', 'neutralSpecial', 'sideSpecial', 'upSpecial', 'downSpecial']
    .map((s) => [s, {
      duration: 1,
      hitboxes: [{ start: 0, end: 999, x: 0, y: -40, r: 9999, damage: 9999, angle: 45, knockback: 9999, growth: 9999 }],
      projectiles: Array.from({ length: 10 }, () => ({ start: 0, x: 0, y: -40, vx: 999, vy: 0, life: 9999, r: 999, damage: 999, angle: 45, knockback: 999, growth: 999 })),
      velocity: [{ start: 0, end: 100, vx: 999, vy: -999 }],
      intangible: [0, 999],
    }])),
};
const v = validateCharacter(cheat);
if (!v.ok) fail(`cheater should load (auto-balanced), got errors: ${v.errors}`);
if (v.report.statPoints.total > STAT_BUDGET + 0.01) fail('cheater stats over budget');
if (v.report.movePower > MOVE_BUDGET + 0.01) fail(`cheater move power ${v.report.movePower} over budget`);
// The validated character is the v2 IR: per-move totals live in report.moves[key].
let checked = 0;
for (const [key, m] of Object.entries(v.character.moves)) {
  if (m.generic) continue; // engine generics (grab/throws/taunt) are fixed engine data
  const cat = CATEGORIES[m.category];
  if (!cat) fail(`cheater ${key} has unknown category ${m.category}`);
  const total = v.report.moves[key]?.totalDamage;
  if (typeof total !== 'number') fail(`cheater ${key} has no report.moves totalDamage`);
  if (total > cat.maxTotal + 0.01) fail(`cheater ${key} deals ${total} (max ${cat.maxTotal})`);
  for (const h of m.hitboxes) if (h.damage > cat.maxHit + 1e-9) fail(`cheater ${key} hitbox ${h.damage} > ${cat.maxHit}`);
  checked++;
}
if (checked < 16) fail(`cheater only has ${checked} moves checked`);
console.log(`✔ cheater auto-balanced (${v.notes.length} adjustments, move power ${v.report.movePower})`);

// 2. Matches between pairs of characters (and the cheater). Every pair while the
// roster is small; past MAX_PAIRS a seeded sample that still covers every character.
const MAX_PAIRS = Number(process.env.SMOKE_MAX_PAIRS) || 28;
const pool = [...chars, v.character];
let pairs = [];
for (let i = 0; i < pool.length; i++) for (let j = i; j < pool.length; j++) pairs.push([i, j]);
if (pairs.length > MAX_PAIRS) {
  const rnd = mulberry32(12345);
  const mirror = pool.map((_, i) => [i, (i + 1) % pool.length]); // each character at least once
  const rest = pairs.filter(([i, j]) => !mirror.some(([a, b]) => a === i && b === j));
  for (let k = rest.length - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [rest[k], rest[r]] = [rest[r], rest[k]]; }
  pairs = [...mirror, ...rest].slice(0, Math.max(MAX_PAIRS, mirror.length));
}
let matches = 0;
for (const [i, j] of pairs) {
  {
    const game = new Game({
      stage,
      rules: { stocks: 2 },
      players: [
        { id: 'a', name: 'A', character: pool[i], cpu: 'hard' },
        { id: 'b', name: 'B', character: pool[j], cpu: 'hard' },
      ],
    });
    let kos = 0;
    for (let f = 0; f < 60 * 120 && game.phase !== 'ended'; f++) {
      game.step();
      for (const e of game.drainEvents()) if (e.type === 'ko') kos++;
      for (const fi of game.fighters) {
        for (const k of ['x', 'y', 'vx', 'vy', 'kx', 'ky', 'percent']) if (!Number.isFinite(fi[k])) fail(`${fi.charId} ${k} became ${fi[k]} at frame ${f}`);
        if (fi.percent < 0 || fi.percent > 999) fail(`${fi.charId} percent ${fi.percent} out of [0, 999]`);
      }
    }
    matches++;
    console.log(`✔ ${pool[i].id} vs ${pool[j].id}: ${game.phase === 'ended' ? 'finished' : 'time-out'} after ${(game.frame / 60).toFixed(0)}s, ${kos} KO(s), damage ${game.fighters.map((f) => Math.round(f.percent)).join('/')}`);
  }
}
console.log(`\nAll good — ${matches} simulated match(es).`);
