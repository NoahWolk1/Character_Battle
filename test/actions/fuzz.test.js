// Random-input matches over the v2 example kits (IR) and v1 characters (validator
// output + runtime generic grabs/throws/taunt): the interpreter never throws, every
// number stays finite, states stay in the closed enum, and runs are deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../shared/sim/game.js';
import { STATES } from '../../shared/sim/states.js';
import { mulberry32 } from '../../shared/sim/rng.js';
import { BUTTONS } from '../../shared/constants.js';
import { validateCharacter } from '../../shared/balance/validate.js';
import { fixture, stage } from './helpers.js';

const FRAMES = 1800;
const STATE_SET = new Set(STATES);

async function roster() {
  const out = {};
  for (const id of ['gertie', 'gloop', 'nimbus']) out[id] = await fixture(id);
  for (const id of ['ember', 'bastion']) {
    const mod = await import(`../../characters/${id}/character.js`);
    const r = validateCharacter(mod.default, { expectedId: id });
    if (r.ok) out[id] = r.character;
  }
  return out;
}

function play(chars, a, b, seed, rules) {
  const game = new Game({
    stage, rules: { countdown: false, seed, scriptTiming: false, ...rules },
    players: [{ id: 'p1', name: a, character: chars[a] }, { id: 'p2', name: b, character: chars[b] }],
  });
  const rng = mulberry32(seed);
  const held = [{}, {}];
  const events = {};
  let hash = 0;
  for (let i = 0; i < FRAMES; i++) {
    for (let p = 0; p < 2; p++) {
      // Sticky random buttons: each changes with probability 0.15 per frame.
      const inp = {};
      for (const k of BUTTONS) { if (rng() < 0.15) held[p][k] = rng() < (k === 'shield' ? 0.25 : 0.4); inp[k] = !!held[p][k]; }
      game.setInput(`p${p + 1}`, inp);
    }
    game.step();
    for (const e of game.drainEvents()) events[e.type] = (events[e.type] || 0) + 1;
    for (const f of game.fighters) {
      for (const k of ['x', 'y', 'vx', 'vy', 'kx', 'ky', 'percent']) assert.ok(Number.isFinite(f[k]), `${a} vs ${b}: ${f.charId}.${k} = ${f[k]} (${f.state})`);
      assert.ok(STATE_SET.has(f.state), `state ${f.state}`);
      assert.ok(f.percent >= 0 && f.percent <= 999);
      if (f.grab && f.grab.role !== 'release') assert.ok(f.state === 'grabbing' || f.state === 'grabbed', `${f.charId} grab ${f.grab.role} in ${f.state}`);
      if (f.state === 'grabbed') assert.ok(f.grab, 'grabbed without a grab record');
      hash = (hash * 31 + Math.round(f.x * 100) + Math.round(f.percent * 10)) | 0;
    }
  }
  return { hash, events };
}

test('random-input matches: no faults, finite numbers, closed states, deterministic', async () => {
  const chars = await roster();
  const ids = Object.keys(chars);
  const total = {};
  for (let i = 0; i < ids.length; i++) {
    for (let j = i; j < ids.length; j++) {
      for (const governor of [true, false]) {
        const seed = 1000 + i * 10 + j;
        const r1 = play(chars, ids[i], ids[j], seed, { governor, grabs: true });
        const r2 = play(chars, ids[i], ids[j], seed, { governor, grabs: true });
        assert.equal(r1.hash, r2.hash, `${ids[i]} vs ${ids[j]} deterministic`);
        for (const [k, v] of Object.entries(r1.events)) total[k] = (total[k] || 0) + v;
      }
    }
  }
  // The interpreter's features were actually exercised.
  for (const k of ['move', 'hit', 'grab']) assert.ok(total[k] > 0, `saw ${k} events (${JSON.stringify(total)})`);
});
