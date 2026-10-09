// WP-H resources and vars (§3.11) and soak (§4.2.6).
//   node --test test/status/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ir, fixture, game, run, place } from '../movement/helpers.js';
import * as res from '../../shared/sim/resources.js';
import { ko } from '../../shared/sim/fighter.js';

const plain = ir({ id: 'plain' });
const gertie = await fixture('gertie');
const nimbus = await fixture('nimbus');
const plated = ir({
  id: 'plated',
  resources: {
    plate: { max: 40, soak: { fraction: 0.5, costPerDamage: 1 } },
    rage: { max: 100, start: 0, onHurt: { perDamage: 2 }, onHit: { perDamage: 1 }, resetOnRespawn: false },
    heat: { min: -10, max: 10, start: 0, regen: -0.5 },
  },
  vars: { n: 0, s: 'abc', on: false },
});

test('regen waits regenDelay after a spend and honors regenWhen (gertie battery: grounded)', () => {
  const g = game([gertie, plain]);
  const f = g.fighter('p1');
  res.pay(f, { battery: 50 });
  assert.equal(res.get(f, 'battery'), 50);
  run(g, 59);
  assert.equal(res.get(f, 'battery'), 50, 'no regen during the delay');
  run(g, 4);
  assert.ok(res.get(f, 'battery') > 50);
  const v = res.get(f, 'battery');
  place(g, 'p1', -470, -400);
  run(g, 5);
  assert.equal(res.get(f, 'battery'), v, 'no regen while airborne');
});

test('decay moves toward min; values clamp to [min, max]', () => {
  const g = game([nimbus, plain]);
  const f = g.fighter('p1');
  res.set(f, 'charge', 50);
  run(g, 100);
  assert.ok(Math.abs(res.get(f, 'charge') - 47) < 1e-6);
  res.add(f, 'charge', 1e9);
  assert.equal(res.get(f, 'charge'), 100);
  res.add(f, 'charge', -1e9);
  assert.equal(res.get(f, 'charge'), 0);
  res.add(f, 'charge', NaN);
  assert.equal(res.get(f, 'charge'), 0);
  const p = game([plated, plain]).fighter('p1');
  for (let i = 0; i < 40; i++) res.tick(p);
  assert.equal(res.get(p, 'heat'), -10, 'negative regen clamps at min');
});

test('onHit / onHurt perDamage with governed damage', () => {
  const g = game([plated, plated]);
  const a = g.fighter('p1'), b = g.fighter('p2');
  res.onDamage(a, 'hit', 10);
  res.onDamage(b, 'hurt', 10);
  assert.equal(res.get(a, 'rage'), 10);
  assert.equal(res.get(b, 'rage'), 20);
  res.onDamage(null, 'hit', 5);   // entity without owner: no-op
});

test('cost / requires', () => {
  const g = game([plated, plain]);
  const f = g.fighter('p1');
  assert.ok(res.canPay(f, { plate: 40 }));
  assert.equal(res.canPay(f, { plate: 41 }), false);
  assert.equal(res.canPay(f, { nope: 1 }), false);
  assert.ok(res.meets(f, { resource: { plate: 10 }, var: { on: false }, grounded: true }));
  assert.equal(res.meets(f, { airborne: true }), false);
});

test('vars.set: declared keys, matching types, truncation, finiteness, ±1e6, 2 KB cap', () => {
  const g = game([plated, plain]);
  const f = g.fighter('p1');
  assert.equal(res.setVar(f, 'zzz', 1), false, 'undeclared');
  assert.equal(res.setVar(f, 'n', '1'), false, 'type mismatch');
  assert.equal(res.setVar(f, 'n', Infinity), false, 'non-finite');
  assert.equal(res.setVar(f, 'n', NaN), false);
  assert.ok(res.setVar(f, 'n', 5e9));
  assert.equal(f.vars.n, 1e6);
  assert.ok(res.setVar(f, 's', 'x'.repeat(100)));
  assert.equal(f.vars.s.length, 24);
  assert.ok(res.setVar(f, 'on', true));
  assert.equal(res.setVar(f, '__proto__', 1), false);
  // 2 KB: many long-keyed string vars
  const vars = {};
  for (let i = 0; i < 32; i++) vars[`k${String(i).padStart(2, '0')}_${'x'.repeat(40)}`] = '';
  const big = game([ir({ id: 'big', vars }), plain]).fighter('p1');
  let rejected = 0;
  for (const k of Object.keys(vars)) if (!res.setVar(big, k, 'y'.repeat(24))) rejected++;
  assert.ok(rejected > 0, 'the serialized-size cap rejects');
  assert.ok(res.varBytes(big.vars) <= res.VAR_LIMITS.bytes);
});

test('respawn: resetOnRespawn resources → start, vars → initializers', () => {
  const g = game([plated, plain]);
  const f = g.fighter('p1');
  res.set(f, 'plate', 1);
  res.set(f, 'rage', 50);
  res.setVar(f, 'n', 7);
  ko(f, 'left');
  run(g, 200);
  assert.equal(res.get(f, 'plate'), 40);
  assert.equal(res.get(f, 'rage'), 50, 'resetOnRespawn: false keeps it');
  assert.equal(f.vars.n, 0);
});

test('soak resources are exposed to the Governor and drain as they absorb', () => {
  const g = game([plated, plain]);
  const f = g.fighter('p1');
  assert.deepEqual(f.soakers, [{ idx: 0, fraction: 0.5, costPerDamage: 1, forms: null }]);
  const r = g.gov.soak(f, 10, f.soakers[0]);
  assert.ok(r.soaked > 0 && r.soaked <= 5);
  assert.ok(Math.abs(res.get(f, 'plate') - (40 - r.soaked)) < 1e-9);
  // the mitigation budget caps total soak per stock (45)
  let total = r.soaked;
  for (let i = 0; i < 100; i++) { g.frame += 301; total += g.gov.soak(f, 20, f.soakers[0]).soaked; }
  assert.ok(total <= 40 + 1e-9, 'never more than the plate holds');
});

test('v1 fighters: no resources, every call is a no-op', () => {
  const f = { char: { stats: {} }, game: null };
  res.init(f);
  assert.equal(f.res.length, 0);
  res.tick(f);
  assert.ok(res.canPay(f, undefined));
  assert.equal(res.setVar(f, 'a', 1), false);
  res.respawn(f);
  assert.deepEqual(f.vars, {});
});
