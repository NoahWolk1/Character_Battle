// Snapshot v2 (spec §7, §10.1): v1 keys kept, v2 keys present, ≤ 6 KB with
// 4 fighters × 8 entities, name tables in the roster, budget truncation order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../shared/sim/game.js';
import stage from '../../shared/stages/sky-sanctum.js';
import { snapshot, roster, enforceBudget, SNAPSHOT_BUDGET, tablesOf } from '../../shared/sim/snapshot.js';
import { validated } from './helpers.js';

const V1_FIGHTER_KEYS = ['id', 'x', 'y', 'vx', 'vy', 'kx', 'ky', 'facing', 'state', 'stateFrame', 'grounded', 'slot', 'moveFrame', 'charging', 'charge',
  'percent', 'stocks', 'shield', 'intangible', 'hitlag', 'tumble', 'dj', 'eliminated', 'kos', 'falls', 'damageDealt', 'placement', 'respawnFrame'];
const V2_FIGHTER_KEYS = ['fm', 'r', 'sv', 'st', 'bs', 'mv', 'ctl', 'gb', 'ar', 'cb'];

const sid = (i) => `Xk2_socketid_${i}`.padEnd(20, 'q'); // socket.io ids are 20 chars

async function fourPlayerGame() {
  const ids = ['ember', 'bastion', 'volt', 'mirelle'];
  const chars = await Promise.all(ids.map((id) => validated(id)));
  return new Game({ stage, rules: { countdown: false, seed: 7 }, players: chars.map((c, i) => ({ id: sid(i), name: `P${i + 1}`, character: c, cpu: 'hard' })) });
}

/** Worst realistic v2 load: custom tables, 3 statuses, 3 resources, 4 synced vars, 8 entities each. */
function loadUp(game) {
  let id = 1000;
  game.entities.length = 0; // exactly 32: drop anything the CPUs already spawned
  for (const f of game.fighters) {
    const t = { moves: Array.from({ length: 24 }, (_, i) => `move${i}`), entities: ['orb', 'minion', 'trap', 'clone'], statuses: ['burn', 'sticky', 'frozen'],
      resources: ['mana', 'heat', 'ammo'], forms: ['base', 'storm', 'calm'], sync: ['charge', 'mode', 'combo', 'targetId'] };
    f.char = { ...f.char, tables: t, resources: { mana: {}, heat: {}, ammo: {} }, sync: t.sync };
    f.res = [55.55, 12.34, 3];
    f.vars = { charge: 42.5, mode: 'storm', combo: 7, targetId: sid(3) };
    f.statuses = [{ name: 'burn', frames: 120, stacks: 3 }, { name: 'sticky', frames: 90 }, { name: 'frozen', frames: 30 }];
    f.form = 'storm';
    f.bodyScale = 1.137;
    for (let k = 0; k < 8; k++) {
      const kind = ['projectile', 'minion', 'trap', 'clone'][k % 4];
      const e = { id: id++, ownerIdx: f.index, owner: f.id, name: ['orb', 'minion', 'trap', 'clone'][k % 4], kind,
        x: 123.456 + k, y: -456.789, vx: 5.55, vy: -3.33, angle: 123.4, age: 55, life: 600, maxLife: 655, hp: kind === 'minion' || kind === 'clone' ? 25 : undefined, len: k === 0 ? 300 : 0, facing: -1,
        vars: kind === 'minion' ? { a: 1.5, b: 'xyz', c: 3, d: 4 } : {}, def: { sync: ['a', 'b', 'c', 'd'] } };
      if (kind === 'clone') e.minor = { state: 'attack', stateFrame: 12, action: { name: 'move3', frame: 9 }, facing: 1, grounded: true };
      game.entities.push(e);
    }
  }
}

test('v1 keys preserved and v2 keys present', async () => {
  const game = await fourPlayerGame();
  for (let i = 0; i < 120; i++) game.step();
  const s = snapshot(game);
  for (const k of ['frame', 'phase', 'phaseFrame', 'winner', 'fighters', 'projectiles', 'entities']) assert.ok(k in s, k);
  for (const f of s.fighters) {
    for (const k of V1_FIGHTER_KEYS) assert.ok(k in f, `v1 key ${k}`);
    for (const k of V2_FIGHTER_KEYS) assert.ok(k in f, `v2 key ${k}`);
  }
});

test('≤ 6 KB with 4 fighters × 8 entities (no truncation needed)', async () => {
  const game = await fourPlayerGame();
  for (let i = 0; i < 60; i++) game.step();
  loadUp(game);
  const warn = console.warn; const warned = []; console.warn = (m) => warned.push(m);
  let s;
  try { s = snapshot(game); } finally { console.warn = warn; }
  const bytes = JSON.stringify(s).length;
  console.log(`  worst-case snapshot: ${bytes} B (budget ${SNAPSHOT_BUDGET.total})`);
  assert.ok(bytes <= SNAPSHOT_BUDGET.total, `snapshot ${bytes} B > ${SNAPSHOT_BUDGET.total}`);
  assert.equal(s.entities.length, 32, 'all 32 entities fit without truncation');
  assert.deepEqual(warned, []);
  for (const f of s.fighters) assert.ok(JSON.stringify(f).length <= SNAPSHOT_BUDGET.fighter, 'per-fighter ≤ 1.5 KB');
  const f0 = s.fighters[0];
  assert.equal(f0.fm, 1);
  assert.deepEqual(f0.r, [55.6, 12.3, 3]);
  assert.deepEqual(f0.st, [[0, 120, 3], [1, 90, 1], [2, 30, 1]]);
  assert.equal(f0.bs, 1.14);
  const clone = s.entities.find((e) => e.c);
  assert.deepEqual(clone.c, ['attack', 12, 3, 9, 1, 1]);
  assert.equal(s.entities[0].t, 0);
  assert.equal(s.entities[0].o, 0);
});

test('maxed custom data on every entity: truncated (vars first) to ≤ 6 KB', async () => {
  const game = await fourPlayerGame();
  loadUp(game);
  for (const e of game.entities) e.vars = { a: 1.5, b: 'xyz', c: 3, d: 4 };
  const warn = console.warn; const warned = []; console.warn = (m) => warned.push(m);
  let s;
  try { s = snapshot(game); } finally { console.warn = warn; }
  assert.ok(JSON.stringify(s).length <= SNAPSHOT_BUDGET.total);
  assert.equal(s.entities.length, 32, 'entities kept; only custom data dropped');
  assert.ok(warned.length >= 1 && warned.every((m) => /dropped|truncated|omitted/.test(m)), 'truncation is logged');
});

test('budget truncates custom data first, then entities', async () => {
  const game = await fourPlayerGame();
  loadUp(game);
  for (const f of game.fighters) for (let k = 0; k < 40; k++) f.vars[`junk${k}`] = 'x'.repeat(50);
  for (const f of game.fighters) f.char.sync.push(...Object.keys(f.vars).filter((k) => k.startsWith('junk')));
  for (const f of game.fighters) tablesOf(f.char); // (cache is per char object)
  for (let k = 0; k < 60; k++) game.entities.push({ id: 5000 + k, ownerIdx: 0, owner: sid(0), kind: 'projectile', x: 1, y: 2, vx: 0, vy: 0, life: 9, vars: {} });
  const warn = console.warn; console.warn = () => {};
  let s;
  try { s = snapshot(game); } finally { console.warn = warn; }
  assert.ok(JSON.stringify(s).length <= SNAPSHOT_BUDGET.total);
  for (const f of s.fighters) assert.deepEqual(f.sv, {}, 'synced vars dropped');
  assert.ok(s.entities.length < 92, 'oldest entities dropped');
  assert.equal(s.entities[s.entities.length - 1].i, 5059, 'newest kept');
  // idempotent on an already-small snapshot
  const small = { fighters: [], entities: [], projectiles: [] };
  assert.equal(enforceBudget(small), small);
});

test('roster carries name tables', async () => {
  const game = await fourPlayerGame();
  const r = roster(game);
  assert.equal(r.length, 4);
  for (const e of r) {
    assert.deepEqual(Object.keys(e.tables).sort(), ['entities', 'forms', 'moves', 'resources', 'statuses', 'vars']);
    assert.ok(e.tables.moves.length >= 16);
    assert.equal(e.tables.forms[0], 'base');
  }
  assert.doesNotThrow(() => JSON.stringify(r));
});
