// §10.1 gates: sim ≤ 2 ms per tick at 4 fighters × 8 entities each, and every hard-CPU
// match (all roster pairs + 4-player FFAs, 3 stocks) ends within 8 minutes of game time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCharacter } from '../../shared/balance/validate.js';
import { Game } from '../../shared/sim/game.js';
import stage from '../../shared/stages/sky-sanctum.js';
import * as entities from '../../shared/sim/entities.js';
import { loadCharacter, listCharacterFolders } from '../../server/characters.js';

const MAX_MS_PER_TICK = 2;
const MATCH_LIMIT = 8 * 60 * 60; // 8 minutes at 60 fps

/** A v2 swarm kit that keeps the entity budget full: 2 homing minions with a think hook + 6 piercing motes. */
const SWARM = {
  version: 2, id: 'perf-swarm', name: 'Perf Swarm', archetype: 'summoner',
  body: { collider: { w: 50, h: 80 } },
  entities: {
    bee: { kind: 'minion', shape: { shape: 'circle', x: 0, y: 0, r: 10 }, life: 1200, maxAlive: 2,
      motion: { type: 'homing', speed: 3, turn: 0.08, target: 'nearestEnemy' }, collide: 'pass', vars: { t: 0 },
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 10, damage: 2, angle: 45, knockback: 10, growth: 10, rehit: 30 }],
      think(view, e, api) { if (view.frame % 30 === 0) api.evars.set('t', view.frame); } },
    mote: { kind: 'projectile', shape: { shape: 'circle', x: 0, y: 0, r: 8 }, life: 240, maxAlive: 8, maxHits: 8, pierce: 8,
      motion: { type: 'linear', speed: 1 }, collide: 'pass',
      hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 8, damage: 3, angle: 40, knockback: 10, growth: 20 }] },
  },
  moves: {
    neutralSpecial: { duration: 30, timeline: [{ at: 8, spawn: 'mote', x: 30, y: -50, count: 2, spread: 30 }] },
    downSpecial: { duration: 34, timeline: [{ at: 10, spawn: 'bee', x: 0, y: -60 }] },
  },
};

function swarmGame(character, seed) {
  return new Game({
    stage, rules: { stocks: 99, seed, countdown: false, governor: true, scriptTiming: false },
    players: [0, 1, 2, 3].map((k) => ({ id: `p${k + 1}`, name: `S${k}`, character, cpu: 'hard' })),
  });
}

test(`perf: 4 fighters × 8 entities ≤ ${MAX_MS_PER_TICK} ms per tick`, () => {
  const res = validateCharacter(SWARM, { expectedId: SWARM.id });
  assert.ok(res.ok, JSON.stringify(res.errors));
  const runs = [];
  for (let attempt = 0; attempt < 3; attempt++) { // best of 3: a loaded box shouldn't fail the gate
    const game = swarmGame(res.character, 7 + attempt);
    const topUp = () => {
      for (const f of game.fighters) {
        const mine = game.entities.filter((e) => e.owner === f.id && !e.dead);
        if (mine.length >= 8) continue;
        const bees = mine.filter((e) => e.name === 'bee').length;
        entities.spawn(f, bees < 2 ? 'bee' : 'mote', { x: 40 - mine.length * 10, y: -60 - mine.length * 6 });
      }
    };
    for (let i = 0; i < 180; i++) { topUp(); game.step(); game.drainEvents(); } // warm-up + JIT
    let alive = 0, ms = 0;
    const frames = 900;
    for (let i = 0; i < frames; i++) {
      topUp();
      const t0 = performance.now();
      game.step();
      ms += performance.now() - t0;
      game.drainEvents();
      alive += game.entities.filter((e) => !e.dead).length;
    }
    runs.push({ ms: ms / frames, alive: alive / frames });
    if (runs.at(-1).ms <= MAX_MS_PER_TICK) break;
  }
  const best = runs.reduce((a, b) => (b.ms < a.ms ? b : a));
  console.log(`  perf: ${best.ms.toFixed(3)} ms/tick with ${best.alive.toFixed(1)} live entities (4 fighters)`);
  assert.ok(best.alive >= 4 * 7, `the gate must actually run near 4 × 8 entities (avg ${best.alive.toFixed(1)})`);
  assert.ok(best.ms <= MAX_MS_PER_TICK, `${best.ms.toFixed(3)} ms/tick > ${MAX_MS_PER_TICK} (runs: ${JSON.stringify(runs)})`);
});

test('every hard-CPU match ends within 8 minutes (all pairs + 4-player FFAs, 3 stocks)', async () => {
  const roster = [];
  for (const f of listCharacterFolders()) { const r = await loadCharacter(f); if (r.ok) roster.push(r.character); }
  assert.ok(roster.length >= 4, 'roster loaded');
  const matches = [];
  for (let i = 0; i < roster.length; i++) for (let j = i + 1; j < roster.length; j++) matches.push([roster[i], roster[j]]);
  for (let s = 0; s < 3; s++) matches.push([0, 1, 2, 3].map((k) => roster[(s * 3 + k * 2) % roster.length]));
  const slow = [];
  let longest = 0;
  matches.forEach((chars, m) => {
    const game = new Game({ stage, rules: { stocks: 3, seed: 1000 + m, countdown: false, scriptTiming: false },
      players: chars.map((c, k) => ({ id: `p${k + 1}`, name: c.id, character: c, cpu: 'hard' })) });
    while (game.phase !== 'ended' && game.frame < MATCH_LIMIT) { game.step(); game.drainEvents(); }
    longest = Math.max(longest, game.frame);
    if (game.phase !== 'ended') slow.push(`${chars.map((c) => c.id).join(' v ')} (seed ${1000 + m}): ${game.fighters.map((f) => `${f.charId} ${f.stocks} stocks ${Math.round(f.percent)}%`).join(', ')}`);
  });
  console.log(`  ${matches.length} matches; longest ${(longest / 3600).toFixed(2)} min`);
  assert.deepEqual(slow, [], 'matches that did not end within 8 minutes');
});
