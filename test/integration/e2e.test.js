// Phase-2 integration: v1 roster + the three §2 examples go through the real
// pipeline (character module → validateCharacter → frozen IR → Game) and play
// seeded 4-player matches. Checks the §4.2.11 / §10.1 invariants end to end.
//   node --test test/integration/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadChar, runMatch, V1, V2 } from './helpers.js';
import { SNAPSHOT_BUDGET } from '../../shared/sim/snapshot.js';

const sha = (s) => createHash('sha1').update(s).digest('hex');

test('every roster character and example validates to a frozen IR', async () => {
  for (const id of [...V1, ...V2]) {
    const r = await loadChar(id);
    const c = r.character;
    assert.equal(r.ok, true, id);
    assert.equal(c.version, V1.includes(id) ? 1 : 2, `${id} version`);
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.moves), `${id} frozen`);
    assert.ok(c.forms && c.forms.base && c.forms.base.stats, `${id} forms.base`);
    for (const k of ['width', 'height', 'weight', 'gravity']) assert.ok(Number.isFinite(c.stats[k]), `${id} stats.${k}`);
    for (const [slot, name] of Object.entries(c.forms.base.slots)) assert.ok(c.moves[name], `${id} slot ${slot} → ${name}`);
    for (const n of r.notes) assert.equal(typeof n.code, 'string', `${id} coded note`);
  }
  // v2 hooks survive validation (the sim runs them).
  const nimbus = (await loadChar('nimbus')).character;
  assert.equal(typeof nimbus.behavior.onHurt, 'function');
  assert.equal(typeof nimbus.moves.sideSmash.update, 'function');
});

test('hard-CPU 4-player FFAs (examples + v1): invariants hold and everyone fights', async () => {
  const lineups = [
    ['nimbus', 'gertie', 'gloop', 'ember'],
    ['gertie', 'bastion', 'volt', 'gloop'],
    ['nimbus', 'mirelle', 'gloop', 'gertie'],
  ];
  for (const ids of lineups) {
    for (const governor of [true, false]) {
      const s = await runMatch({ ids, seed: 11, frames: 60 * 90, rules: { governor } });
      for (const id of ids) assert.ok(s.hits[id] > 0, `${id} never landed a hit (${ids}, gov ${governor})`);
      assert.ok(s.kos > 0, 'no KOs at all');
      assert.equal(s.errors.length, 0, `script errors: ${JSON.stringify(s.errors.slice(0, 2))}`);
      assert.ok(s.snapBytes <= SNAPSHOT_BUDGET.total, `snapshot ${s.snapBytes} B`);
      for (const f of s.game.fighters) assert.equal(!!f.scriptsDisabled, false, `${f.charId} scripts disabled`);
    }
  }
});

test('random-input 4-player matches exercise v2 features without breaking invariants', async () => {
  const seen = { forms: new Set(), states: new Set(), events: new Set() };
  for (const seed of [1, 2, 3]) {
    for (const governor of [true, false]) {
      const s = await runMatch({
        ids: ['nimbus', 'gertie', 'gloop', 'mirelle'], seed, frames: 60 * 80, cpu: 'random', rules: { governor },
        onFrame(g) { for (const f of g.fighters) { seen.forms.add(`${f.charId}:${f.form}`); seen.states.add(f.state); } },
      });
      for (const k of Object.keys(s.events)) seen.events.add(k);
      assert.equal(s.errors.length, 0);
      assert.ok(s.snapBytes <= SNAPSHOT_BUDGET.total);
    }
  }
  for (const f of ['gloop:puddle', 'gloop:spike']) assert.ok(seen.forms.has(f), `form ${f} never reached`);
  for (const e of ['spawn', 'despawn', 'form', 'status', 'hit', 'ko', 'grab']) assert.ok(seen.events.has(e), `no ${e} event`);
  for (const st of ['attack', 'taunt', 'glide']) assert.ok(seen.states.has(st), `state ${st} never reached`);
});

test('same seed, same match: state hash every 60 frames is identical', async () => {
  const run = async () => {
    const hashes = [];
    await runMatch({
      ids: ['gloop', 'nimbus', 'gertie', 'volt'], seed: 5, frames: 60 * 40,
      onFrame(g) { if (g.frame % 60 === 0) hashes.push(sha(JSON.stringify(g.snapshot()))); },
    });
    return hashes;
  };
  const a = await run();
  const b = await run();
  assert.ok(a.length > 30);
  assert.deepEqual(a, b);
});

test('perf: 4 fighters average well under 2 ms per tick', async () => {
  const t0 = performance.now();
  const s = await runMatch({ ids: ['nimbus', 'gertie', 'gloop', 'ember'], seed: 9, frames: 60 * 30 });
  const ms = (performance.now() - t0) / s.frames;
  assert.ok(ms < 2, `${ms.toFixed(3)} ms/tick`);
});

test('names that shadow Object.prototype are rejected with E018, never thrown', async () => {
  const { validateCharacter } = await import('../../shared/balance/validate.js');
  const hb = [{ start: 3, end: 5, x: 20, y: -30, r: 10, damage: 3 }];
  for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    for (const field of ['moves', 'hitboxes', 'vars', 'entities']) {
      const map = {};
      Object.defineProperty(map, k, { value: field === 'vars' ? 0 : field === 'moves' ? { duration: 20, hitboxes: hb } : { damage: 3, kind: 'projectile' }, enumerable: true });
      const def = { version: 2, id: 'tst', name: 'Tst', moves: { jab: { duration: 20, hitboxes: hb } } };
      def[field] = field === 'moves' ? Object.assign(map, def.moves) : map;
      const r = validateCharacter(def, { expectedId: 'tst' });
      assert.equal(r.ok, false, `${field}.${k}`);
      assert.ok(r.errors.some((e) => e.code === 'E018'), `${field}.${k}: ${r.errors.map(String)}`);
    }
  }
});
