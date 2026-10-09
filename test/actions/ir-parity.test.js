// v1 moves behave identically through the IR path: the same v1 character as v1
// validator output and as IR (normalize(validated) → buildIR) replays identical
// fighter traces from recorded CPU inputs. (The CPU itself reads v1 fields, so
// inputs are recorded once and replayed as human input in both runs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../shared/sim/game.js';
import { validateCharacter } from '../../shared/balance/validate.js';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { stage } from './helpers.js';

const FRAMES = 3000;
const KEYS = ['x', 'y', 'vx', 'vy', 'kx', 'ky', 'facing', 'state', 'stateFrame', 'grounded', 'percent', 'stocks', 'hitlag', 'jumpsLeft'];

async function load(id) {
  const mod = await import(`../../characters/${id}/character.js`);
  const r = validateCharacter(mod.default, { expectedId: id });
  assert.ok(r.ok, `${id} validates`);
  const { draft, errors } = normalize(r.character, { expectedId: id });
  assert.equal(errors.length, 0);
  return { v1: r.character, ir: buildIR(draft) };
}

function record(a, b, seed) {
  const game = new Game({ stage, rules: { countdown: false, governor: false, grabs: false, seed }, players: [
    { id: 'p1', name: 'a', character: a, cpu: 'hard' }, { id: 'p2', name: 'b', character: b, cpu: 'hard' }] });
  const inputs = [];
  for (let i = 0; i < FRAMES; i++) { game.step(); inputs.push(game.fighters.map((f) => ({ ...f.input }))); }
  return inputs;
}

function replay(a, b, inputs, seed) {
  const game = new Game({ stage, rules: { countdown: false, governor: false, grabs: false, seed }, players: [
    { id: 'p1', name: 'a', character: a }, { id: 'p2', name: 'b', character: b }] });
  const trace = [];
  for (const fr of inputs) {
    game.setInput('p1', fr[0]); game.setInput('p2', fr[1]);
    game.step();
    trace.push(JSON.stringify([game.fighters.map((f) => KEYS.map((k) => f[k]).concat([f.action ? f.action.frame : -1, f.lastAction ? f.lastAction.chargeFrames : 0])), game.projectilesV1().map((p) => [p.x, p.y, p.life])]));
  }
  return trace;
}

test('v1 characters: validator output vs IR replay identical traces', async () => {
  const pairs = [['ember', 'bastion'], ['volt', 'mirelle'], ['mirelle', 'ember'], ['bastion', 'volt']];
  const chars = {};
  for (const id of ['ember', 'bastion', 'volt', 'mirelle']) chars[id] = await load(id);
  for (const [a, b] of pairs) {
    const inputs = record(chars[a].v1, chars[b].v1, 5);
    const t1 = replay(chars[a].v1, chars[b].v1, inputs, 5);
    const t2 = replay(chars[a].ir, chars[b].ir, inputs, 5);
    let i = 0;
    while (i < t1.length && t1[i] === t2[i]) i++;
    assert.ok(t1.some((s) => !s.endsWith(',[]]')), `${a} vs ${b}: projectiles were exercised`);
    assert.equal(i, t1.length, `${a} vs ${b} diverges at frame ${i + 1}:\n v1 ${t1[i]}\n ir ${t2[i]}`);
  }
});
