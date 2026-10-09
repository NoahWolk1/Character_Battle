// WP-H forms (§2.2.12, §3.7 collider push-out, cooldown, KO reset).
//   node --test test/movement/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ir, fixture, game, run, place, stage } from './helpers.js';
import { setForm, ko, FORM_COOLDOWN, FORM_HITLAG } from '../../shared/sim/fighter.js';
import { collider } from '../../shared/sim/hurtbox.js';
import { resolveMove } from '../../shared/sim/input-map.js';

const G = stage.ground;
const gloop = await fixture('gloop');
const plain = ir({ id: 'plain' });
const overlaps = (f) => {
  const c = collider(f);
  return f.x + c.w / 2 > G.x1 && f.x - c.w / 2 < G.x2 && f.y > G.y && f.y - c.h < G.bottom;
};

test('form switch swaps stats, body, slots and movement; emits form event', () => {
  const g = game([gloop, plain]);
  const f = g.fighter('p1');
  const base = f.stats;
  assert.equal(collider(f).h, gloop.forms.base.body.collider.h);
  assert.ok(setForm(f, 'spike'));
  assert.equal(f.form, 'spike');
  assert.equal(f.stats.weight, gloop.forms.spike.stats.weight);
  assert.notEqual(f.stats, base);
  assert.equal(collider(f).h, gloop.forms.spike.body.collider.h);
  assert.equal(f.armorPassive, 3);
  assert.equal(resolveMove(f, 'jab').name, gloop.forms.spike.slots.jab);
  assert.equal(f.hitlag, FORM_HITLAG);
  const ev = g.drainEvents();
  assert.ok(ev.some((e) => e.type === 'form' && e.from === 'base' && e.to === 'spike'));
});

test('cooldown: a second switch within 45 frames fails; unknown forms fail', () => {
  const g = game([gloop, plain]);
  const f = g.fighter('p1');
  assert.ok(setForm(f, 'spike'));
  assert.equal(f.formCd, FORM_COOLDOWN);
  assert.equal(setForm(f, 'puddle'), false);
  assert.equal(setForm(f, 'nope', { force: true }), false);
  run(g, FORM_COOLDOWN + FORM_HITLAG - 1);
  assert.equal(setForm(f, 'puddle'), false, 'cooldown does not tick during hitlag');
  run(g, 2);
  assert.ok(setForm(f, 'puddle'));
});

test('a form switch pushes the collider out of the ground (under the stage → down)', () => {
  const g = game([gloop, plain]);
  const f = g.fighter('p1');
  setForm(f, 'puddle', { force: true });
  place(g, 'p1', 0, G.bottom + collider(f).h + 2);       // tucked just under the stage
  assert.ok(!overlaps(f));
  assert.ok(setForm(f, 'spike', { force: true }));
  assert.ok(!overlaps(f), 'no overlap after the switch');
  assert.ok(Math.abs(f.y - (G.bottom + collider(f).h)) < 1e-9);
});

test('a form switch pushes the collider out of the ground (beside the wall → out sideways, near the top → up)', () => {
  const g = game([gloop, plain]);
  const f = g.fighter('p1');
  setForm(f, 'spike', { force: true });
  place(g, 'p1', G.x1 - collider(f).w / 2, 100);
  assert.ok(!overlaps(f));
  setForm(f, 'puddle', { force: true });                 // 84 wide: overlaps the left face
  assert.ok(!overlaps(f));
  assert.ok(f.x <= G.x1 - collider(f).w / 2 + 1e-9);
  // feet 6 px into the top surface → pushed up onto it
  setForm(f, 'spike', { force: true });
  place(g, 'p1', -100, G.y + 6);
  setForm(f, 'base', { force: true });
  assert.ok(!overlaps(f));
  assert.equal(f.y, G.y);
  run(g, 2);
  assert.ok(f.grounded, 'lands on the top');
});

test('KO resets to the start form (forced, no cooldown) and modes invalid in the new form end', () => {
  const g = game([gloop, plain]);
  const f = g.fighter('p1');
  setForm(f, 'puddle', { force: true });
  place(g, 'p1', -700, 300, 'crawl');
  setForm(f, 'spike', { force: true });
  assert.equal(f.state, 'air', 'crawl is not a spike-form mode');
  ko(f, 'bottom');
  assert.equal(f.form, 'base');
  assert.equal(f.formCd, 0);
});

test('startForm is honored from the IR meta', () => {
  const c = ir({ id: 'starter', forms: { big: { stats: { weight: 120 } } }, startForm: 'big' });
  const g = game([c, plain]);
  assert.equal(g.fighter('p1').form, 'big');
  assert.equal(g.fighter('p1').stats.weight, 120);
});
