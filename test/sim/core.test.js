// Sim core (WP-E): closed state enum, determinism, module seams, governed runs.
//   node test/sim/core.test.js      (or: node --test test/sim/*.test.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCharacter } from '../../shared/balance/validate.js';
import { Game } from '../../shared/sim/game.js';
import { STATES, setState } from '../../shared/sim/states.js';
import stage from '../../shared/stages/sky-sanctum.js';
import { loadRoster, ROSTER } from '../golden/harness.js';
import * as actions from '../../shared/sim/actions.js';
import * as entities from '../../shared/sim/entities.js';
import * as status from '../../shared/sim/status.js';
import * as resources from '../../shared/sim/resources.js';
import * as movement from '../../shared/sim/movement.js';
import * as script from '../../shared/sim/script-api.js';
import * as snapshot from '../../shared/sim/snapshot.js';

const roster = await loadRoster(validateCharacter);
const VALID = new Set(STATES);

function match(a, b, rules, frames = 3600) {
  const game = new Game({
    stage, rules: { stocks: 3, ...rules },
    players: [
      { id: 'p1', name: 'P1', character: roster[a].character, cpu: 'hard' },
      { id: 'p2', name: 'P2', character: roster[b].character, cpu: 'hard' },
    ],
  });
  const hashes = [];
  for (let i = 0; i < frames && game.phase !== 'ended'; i++) {
    game.step();
    game.drainEvents();
    for (const f of game.fighters) {
      assert.ok(VALID.has(f.state), `unknown state ${f.state}`);
      for (const k of ['x', 'y', 'vx', 'vy', 'kx', 'ky', 'percent']) assert.ok(Number.isFinite(f[k]), `${f.charId}.${k} = ${f[k]}`);
      assert.ok(f.percent >= 0 && f.percent <= 999);
    }
    if (game.frame % 60 === 0) hashes.push(JSON.stringify(game.snapshot()));
  }
  return { game, hashes };
}

test('state enum is closed: setState throws on an unknown state (dev)', () => {
  assert.equal(STATES.length, 24);
  const f = { state: 'idle', stateFrame: 3, action: null, charId: 'x', grounded: true };
  assert.throws(() => setState(f, 'flying-kick'), /unknown fighter state/);
  setState(f, 'glide');
  assert.equal(f.state, 'glide');
  assert.equal(f.stateFrame, 0);
});

test('every pairing stays in known states with finite numbers (governor on and off)', () => {
  for (const governor of [false, true]) {
    for (let i = 0; i < ROSTER.length; i++) {
      for (let j = i; j < ROSTER.length; j++) match(ROSTER[i], ROSTER[j], { governor, seed: 7 }, 2400);
    }
  }
});

test('deterministic under a seed (governed)', () => {
  const a = match('ember', 'volt', { seed: 42 }).hashes;
  const b = match('ember', 'volt', { seed: 42 }).hashes;
  assert.deepEqual(a, b);
});

test('rules defaults and governor wiring', () => {
  const g = new Game({ stage, players: [{ id: 'a', name: 'A', character: roster.ember.character }, { id: 'b', name: 'B', character: roster.volt.character }] });
  assert.equal(g.rules.governor, true);
  assert.equal(g.rules.grabs, true);
  assert.equal(g.rules.legacyKo, false);
  assert.ok(g.gov, 'governor constructed when rules.governor is on');
  const off = new Game({ stage, rules: { governor: false }, players: [{ id: 'a', name: 'A', character: roster.ember.character }] });
  assert.equal(off.gov, null);
  // fighters carry a hidden back-reference that never serializes
  assert.equal(g.fighters[0].game, g);
  assert.ok(!Object.keys(g.fighters[0]).includes('game'));
  assert.ok(JSON.stringify(g.snapshot()));
});

test('stub seams export the documented contract', () => {
  const need = {
    actions: [actions, ['startAction', 'updateAction', 'endAction', 'activeHitboxes', 'intangibleAt', 'chargeOf', 'onLand', 'onHitConnect', 'tryCounter', 'grabConnect']],
    entities: [entities, ['init', 'spawnProjectile', 'spawn', 'despawn', 'update', 'alive', 'hitboxesOf', 'bodyShapeOf', 'hurtShapesOf', 'onHitConnect', 'clank', 'sweep', 'onOwnerKO', 'onActionEnd']],
    status: [status, ['init', 'apply', 'tick', 'statMods', 'clear']],
    resources: [resources, ['init', 'tick', 'index', 'get', 'add', 'set', 'canPay', 'pay', 'meets', 'setVar', 'onDamage', 'respawn']],
    movement: [movement, ['update', 'drift', 'gravity', 'friction', 'airReset']],
    script: [script, ['init', 'run', 'flush', 'queueHitEvent', 'runQueued', 'flushAll', 'slotFn', 'runUpdate', 'makeView', 'makeApi']],
    snapshot: [snapshot, ['snapshot', 'roster', 'projectilesV1']],
  };
  for (const [name, [mod, fns]] of Object.entries(need)) {
    for (const fn of fns) assert.equal(typeof mod[fn], 'function', `${name}.${fn}`);
  }
});
