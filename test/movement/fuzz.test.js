// WP-H: random-input fuzz over the three examples (modes, forms, statuses, resources):
// finite numbers, closed states, deterministic snapshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, game } from './helpers.js';
import { STATES } from '../../shared/sim/states.js';
import { BUTTONS } from '../../shared/constants.js';
import { mulberry32 } from '../../shared/sim/rng.js';
import * as status from '../../shared/sim/status.js';
import { setForm } from '../../shared/sim/fighter.js';

const chars = { nimbus: await fixture('nimbus'), gertie: await fixture('gertie'), gloop: await fixture('gloop') };
const VALID = new Set(STATES);

function play(a, b, seed, frames = 3000) {
  const g = game([chars[a], chars[b]], { seed });
  const rng = mulberry32(seed);
  const held = [{}, {}];
  const hashes = [];
  for (let i = 0; i < frames && g.phase !== 'ended'; i++) {
    for (let p = 0; p < 2; p++) {
      if (rng() < 0.15) held[p] = Object.fromEntries(BUTTONS.map((k) => [k, rng() < (k === 'jump' ? 0.35 : 0.18)]));
      g.setInput(`p${p + 1}`, held[p]);
    }
    if (i % 97 === 0) status.apply(g.fighters[1], ['burn', 'stun', 'slow', 'float', 'root', 'confuse'][i % 6], { source: g.fighters[0] });
    if (i % 131 === 0) for (const f of g.fighters) setForm(f, f.char.tables.forms[(i / 131) % f.char.tables.forms.length | 0]);
    g.step();
    g.drainEvents();
    for (const f of g.fighters) {
      assert.ok(VALID.has(f.state), f.state);
      for (const k of ['x', 'y', 'vx', 'vy', 'kx', 'ky', 'percent']) assert.ok(Number.isFinite(f[k]), `${k}=${f[k]}`);
      for (const v of f.res) assert.ok(Number.isFinite(v));
      assert.ok(f.statuses.length <= 4);
    }
    if (i % 100 === 0) hashes.push(JSON.stringify(g.snapshot()) + JSON.stringify(g.fighters.map((f) => [f.x, f.y, f.state, f.form, [...f.res]])));
  }
  return hashes;
}

test('fuzz: all example pairings stay finite, in known states, deterministic', () => {
  const ids = Object.keys(chars);
  for (const a of ids) for (const b of ids) {
    const h1 = play(a, b, 11);
    const h2 = play(a, b, 11);
    assert.deepEqual(h1, h2, `${a} vs ${b} deterministic`);
  }
});
