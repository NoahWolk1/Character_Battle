// Stage registry (shared/stages/index.js): ids, lookup, default fallback.
//   node --test test/sim/stages.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stages, STAGE_IDS, DEFAULT_STAGE_ID, getStage } from '../../shared/stages/index.js';
import sky from '../../shared/stages/sky-sanctum.js';
import { STAGE_IDS as WORKER_IDS } from '../../server/room-worker.js';

test('registry: every stage is listed by its own id and has the gameplay geometry', () => {
  assert.ok(STAGE_IDS.includes(DEFAULT_STAGE_ID));
  assert.ok(Object.isFrozen(stages) && Object.isFrozen(STAGE_IDS));
  for (const id of STAGE_IDS) {
    const s = getStage(id);
    assert.equal(s.id, id);
    for (const k of ['ground', 'platforms', 'blast', 'spawns', 'respawnY', 'camera']) assert.ok(s[k] !== undefined, `${id}.${k}`);
    assert.ok(s.spawns.length >= 4, `${id}: 4 spawns`);
  }
});

test('getStage: known ids resolve, unknown / inherited names fall back to the default', () => {
  assert.equal(getStage('sky-sanctum'), sky);
  for (const id of [undefined, null, 'nope', 'constructor', '__proto__']) assert.equal(getStage(id).id, DEFAULT_STAGE_ID);
});

test('the room worker exposes the registry ids', () => {
  assert.deepEqual([...WORKER_IDS], [...STAGE_IDS]);
});
