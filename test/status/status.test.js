// WP-H statuses (§3.10, caps §4.2.9).
//   node --test test/status/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ir, fixture, game, run, place } from '../movement/helpers.js';
import * as status from '../../shared/sim/status.js';
import { ko } from '../../shared/sim/fighter.js';
import { dirX, detectTrigger } from '../../shared/sim/input-map.js';
import { STATUS_CAPS } from '../../shared/balance/governor-rules.js';

const plain = ir({ id: 'plain' });
const gertie = await fixture('gertie');
const custom = ir({
  id: 'custom',
  statuses: {
    crush: { frames: 120, mods: { speed: 0.1, gravity: 3 } },
    regen: { frames: 120, heal: { every: 30, amount: 1 } },
    bleed: { frames: 300, stack: 'add', maxStacks: 3, dot: { every: 15, damage: 0.5 } },
    tag: { frames: 60, stack: 'ignore' },
  },
});

function duo(a = plain, b = plain, rules) {
  const g = game([a, b], rules);
  return { g, a: g.fighter('p1'), b: g.fighter('p2') };
}

test('burn: DoT through Governor.applyDot, 0.5 per 15 f, expires with an event', () => {
  const { g, a, b } = duo();
  assert.ok(status.apply(b, 'burn', { source: a }));
  assert.equal(b.statuses[0].source, a.id);
  const ev = run(g, 125);
  assert.ok(Math.abs(b.percent - 4) < 1e-9, `percent ${b.percent}`);
  assert.equal(b.statuses.length, 0);
  assert.ok(ev.some((e) => e.type === 'status' && e.name === 'burn' && e.on === false));
  assert.equal(ev.filter((e) => e.type === 'dot').length, 8);
  assert.ok(Math.abs(a.damageDealt - 4) < 1e-9);
});

test('DoT is rate limited per attacker and never knocks back', () => {
  const { g, a, b } = duo(custom, plain);
  for (let i = 0; i < 3; i++) status.apply(b, 'bleed', { source: a });
  assert.equal(b.statuses[0].stacks, 3);
  run(g, 60);
  assert.ok(b.percent <= 4 * STATUS_CAPS.dot.maxPerTick + 1e-9, 'per-tick cap holds with stacks');
  assert.equal(b.kx, 0); assert.equal(b.ky, 0);
  assert.equal(b.state === 'hitstun', false);
});

test('stun: forces stunned, frames capped, then 180 f of stun/freeze immunity', () => {
  const { g, a, b } = duo();
  assert.ok(status.apply(b, 'stun', { source: a, frames: 999 }));
  assert.ok(b.statuses[0].frames <= STATUS_CAPS.control.stun.max);
  run(g, 1);
  assert.equal(b.state, 'stunned');
  assert.equal(b.control, 'stun');
  assert.equal(status.controlCode(b), 1);
  run(g, 45);
  assert.notEqual(b.state, 'stunned');
  assert.equal(b.control, null);
  assert.equal(status.apply(b, 'stun', { source: a }), false, 'immune');
  assert.equal(status.apply(b, 'freeze', { source: a }), false, 'freeze shares the immunity');
  run(g, 180);
  assert.ok(status.apply(b, 'freeze', { source: a }), 'immunity window over');
  assert.ok(b.statuses[0].frames <= 15, 'reapplied within 300 f → halved');
});

test('stun waits behind hitstun and takes over when it ends', () => {
  const { g, a, b } = duo();
  place(g, 'p2', 300, 0, 'hitstun');
  b.grounded = true; b.hitstun = 5;
  status.apply(b, 'stun', { source: a });
  run(g, 1);
  assert.equal(b.state, 'hitstun');
  run(g, 6);
  assert.equal(b.state, 'stunned');
});

test('confuse: 300 f immunity; root zeroes horizontal input; silence blocks specials', () => {
  const { g, a, b } = duo();
  b.input = { right: true }; b.control = null;
  assert.equal(dirX(b), 1);
  status.apply(b, 'confuse', { source: a });
  status.tick(b);
  assert.equal(dirX(b), -1);
  b.statuses.length = 0; status.refresh(b);
  assert.equal(status.apply(b, 'confuse', { source: a }), false, 'confuse immunity');
  status.apply(b, 'root', { source: a });
  status.refresh(b);
  assert.equal(dirX(b), 0);
  b.statuses.length = 0;
  status.apply(b, 'silence', { source: a });
  b.buffer.special = g.frame; b.input = { special: true };
  assert.equal(detectTrigger(b), null);
});

test('mods: statMods multiplies statuses and modify sets, clamps per §4.2.9, recomputes f.stats', () => {
  const { g, a, b } = duo(custom, plain);
  const base = b.stats;
  status.apply(b, 'slow', { source: a });
  assert.equal(b.mods.speed, 0.7);
  assert.ok(Math.abs(b.stats.runSpeed - base.runSpeed * 0.7) < 1e-9);
  status.apply(b, 'crush', { source: a });
  assert.equal(b.mods.speed, 0.6, 'clamped to 0.6');
  assert.equal(b.mods.gravity, 1.4, 'clamped to 1.4');
  b.modSets.boost = { speed: 1.25 };
  b.statuses.length = 0;
  status.refresh(b);
  assert.equal(b.mods.speed, 1.25);
  delete b.modSets.boost;
  status.refresh(b);
  assert.equal(b.stats, base, 'neutral mods → the form stats object');
  assert.equal(b.mods, status.NEUTRAL_MODS);
  run(g, 1);
});

test('gravity mods install a quantized KO table (no new table per mod value) and clear it after', () => {
  const { g, a, b } = duo();
  status.apply(b, 'float', { source: a });
  assert.ok(b.koTable instanceof Float64Array);
  const t1 = b.koTable;
  status.apply(b, 'float', { source: a });
  assert.equal(b.koTable, t1);
  run(g, 100);
  assert.equal(b.statuses.length, 0);
  assert.equal(b.koTable, null);
});

test('self heal status: through Governor.heal (≤ 1 per 30 f, not below 0)', () => {
  const { g, a } = duo(custom, plain);
  a.percent = 10;
  assert.ok(status.apply(a, 'regen', { source: a }));
  run(g, 120);
  assert.ok(a.percent >= 10 - 4 - 1e-9 && a.percent < 10, `percent ${a.percent}`);
  const { b } = duo(custom, plain);
  assert.equal(status.apply(b, 'regen', { source: a }), false, 'heal statuses are self-only');
});

test('stacking: refresh / add / ignore; per-target cap 4', () => {
  const { g, a, b } = duo(custom, plain);
  status.apply(b, 'tag', { source: a });
  run(g, 10);
  const left = b.statuses[0].frames;
  assert.equal(status.apply(b, 'tag', { source: a }), false);
  assert.equal(b.statuses[0].frames, left);
  status.apply(b, 'slow', { source: b });
  status.apply(b, 'weaken', { source: b });
  status.apply(b, 'mark', { source: b });
  assert.equal(status.apply(b, 'vulnerable', { source: b }), false, 'per-target cap');
  assert.equal(b.statuses.length, STATUS_CAPS.perTarget);
});

test('custom statuses resolve from the source character; unknown names are rejected', () => {
  const { a, b } = duo(gertie, plain);
  assert.ok(status.apply(b, 'tangled', { source: a }));
  assert.equal(b.control, 'root');
  assert.equal(b.mods.jump, 0.8);
  assert.equal(status.apply(b, 'nonesuch', { source: a }), false);
});

test('everything clears on KO', () => {
  const { a, b } = duo(custom, plain);
  status.apply(b, 'slow', { source: a });
  status.apply(b, 'root', { source: a });
  b.modSets.x = { speed: 1.2 };
  ko(b, 'left');
  assert.equal(b.statuses.length, 0);
  assert.equal(b.control, null);
  assert.equal(b.mods, status.NEUTRAL_MODS);
  assert.deepEqual(Object.keys(b.modSets), []);
});

test('ungoverned (rules.governor = false): statuses still apply with hard frame caps', () => {
  const { g, a, b } = duo(plain, plain, { governor: false });
  assert.ok(status.apply(b, 'stun', { source: a, frames: 500 }));
  assert.equal(b.statuses[0].frames, STATUS_CAPS.control.stun.max);
  status.apply(b, 'burn', { source: a });
  run(g, 60);
  assert.ok(b.percent > 0);
});
