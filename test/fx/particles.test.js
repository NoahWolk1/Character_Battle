// WP-L: pooled particle system + fx API (spec §6.4). Run: node --test test/fx/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Particles, BUDGET, FX_SHAPES } from '../../client/render/particles.js';
import { mockCtx } from './mock-canvas.js';

test('2000-burst stress test: per-owner and global caps hold, oldest dropped', () => {
  const P = new Particles({ canvas: null });
  const owners = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) {
    const o = owners[i % owners.length];
    P.api(o).burst({ x: i, y: 0, count: 1e6, shape: FX_SHAPES[i % FX_SHAPES.length] });
    assert.ok(P.count(o) <= BUDGET.perOwner, `owner ${o} ${P.count(o)}`);
    assert.ok(P.count() <= BUDGET.global, `global ${P.count()}`);
    if (i % 100 === 0) P.update();
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 4000, `stress took ${ms.toFixed(0)} ms`);
  for (const o of owners) assert.ok(P.count(o) <= 400);
  assert.ok(P.count() <= 2000);
  assert.ok(P.dropped > 0);
  // the survivors are the newest bursts
  const xs = P.list.filter((p) => !p.dead).map((p) => p.x);
  assert.ok(Math.min(...xs) > 1000, `oldest survivor x=${Math.min(...xs)}`);
  const ctx = mockCtx();
  P.draw(ctx, 'back'); P.draw(ctx, 'front');
  assert.equal(ctx.depth, 0, 'save/restore balanced');
  for (let i = 0; i < 700; i++) P.update();
  assert.equal(P.count(), 0);
});

test('single owner spam: one character cannot exceed 400 or starve others', () => {
  const P = new Particles({ canvas: null });
  P.api('other').burst({ x: 0, y: 0, count: 50 });
  for (let i = 0; i < 2000; i++) P.api('spam').burst({ x: 0, y: 0, count: 128 });
  assert.equal(P.count('spam'), 400);
  assert.equal(P.count('other'), 50);
  assert.ok(P.list.length < 8000, `list bounded (${P.list.length})`);
});

test('fx API sanitizes hostile input', () => {
  const P = new Particles({ canvas: null });
  let shook = 0, flashed = null, sounds = [];
  const fx = P.api('x', { shake: (a) => { shook = a; }, flash: (...a) => { flashed = a; }, sound: (n, o) => { sounds.push([n, o]); return true; } });
  assert.deepEqual(fx.burst({ x: NaN, y: 0 }), []);
  assert.equal(fx.ring({ x: 0 }), null);
  assert.equal(fx.burst({ x: 0, y: 0, count: 5, shape: 'nope' })[0].shape, 'dot');
  const big = fx.burst({ x: 0, y: 0, count: 5, life: 1e9, size: 1e9, gravity: 99, drag: -5 })[0];
  assert.ok(big.life <= 600 && big.size <= 200 && big.gravity <= 3 && big.drag >= 0.5);
  const t = fx.text({ x: 0, y: 0, text: 'x'.repeat(500) });
  assert.equal(t.text.length, BUDGET.textLen);
  const d = fx.decal({ x: 0, y: 0, life: 99999 });
  assert.ok(d.life <= 180, 'decals fade within 3 s');
  fx.shake(100); assert.equal(shook, 8);
  fx.flash('#fff', 1, 99); assert.deepEqual(flashed, ['#fff', 0.35, 6]);
  fx.sound('boing', { volume: 9, pitch: 99 });
  assert.deepEqual(sounds[0], ['boing', { volume: 1, pitch: 4 }]);
  assert.equal(fx.sound(42), false);
  for (let i = 0; i < 30; i++) fx.trail(`t${i}`, { x: i, y: 0 });
  assert.equal(P.ribbons.size, BUDGET.ribbonsPerOwner);
  for (let i = 0; i < 100; i++) fx.decal({ x: i, y: 0 });
  assert.ok(P.list.filter((p) => !p.dead && p.shape === 'decal').length <= BUDGET.decals);
});

test('fx.local emits at the anchor in body space, mirrored by facing, at `rate`', () => {
  const P = new Particles({ canvas: null });
  const fx = P.api('g', { anchor: () => ({ x: 100, y: 50, facing: -1, scale: 2 }) });
  let n = 0;
  for (let i = 0; i < 10; i++) n += fx.local.smoke({ x: -40, y: -14, rate: 0.6, speed: [0, 0] });
  assert.equal(n, 6);
  const p = P.list.find((q) => !q.dead);
  assert.equal(p.x, 100 + 80);   // -40 * scale 2 * facing -1
  assert.equal(p.y, 50 - 28);
  assert.equal(P.api('nobody').local.dot({ rate: 5 }), 0, 'no anchor → no-op');
});

test('every shape draws; a throwing custom draw only kills its particle', () => {
  const P = new Particles({ canvas: null });
  const fx = P.api('d');
  for (const shape of FX_SHAPES) fx.burst({ x: 0, y: 0, count: 2, shape });
  fx.burst({ x: 0, y: 0, count: 2, shape: () => { throw new Error('boom'); } });
  fx.burst({ x: 0, y: 0, count: 2, shape: (ctx, q) => { ctx.fillRect(0, 0, q.size, q.size); } });
  fx.ring({ x: 0, y: 0, r0: 5, r1: 50, flat: true });
  fx.line({ x: 0, y: 0, x2: 100, y2: 50, jag: 12 });
  fx.text({ x: 0, y: 0, text: 'hi' });
  fx.trail('w', { x: 0, y: 0 }); fx.trail('w', { x: 10, y: 5 });
  for (const s of ['splat', 'scorch', 'circle', 'crack']) fx.decal({ x: 0, y: 0, shape: s });
  for (const s of ['flash', 'ellipse', 'lines', 'beam']) P.spawn(null, { shape: s, x: 0, y: 0, life: 10, size: 20 });
  const ctx = mockCtx();
  const before = P.count();
  P.draw(ctx, 'back'); P.draw(ctx, 'front');
  assert.equal(P.count(), before - 2);
  assert.equal(ctx.depth, 0);
  P.quality = 'low';
  P.draw(mockCtx(), 'front');
});

test('deterministic with a seed (Lab renders)', () => {
  const run = () => { const P = new Particles({ seed: 7, canvas: null }); P.api('a').burst({ x: 0, y: 0, count: 20 }); P.update(); return P.list.map((p) => [p.x, p.y, p.size]); };
  assert.deepEqual(run(), run());
});

test('clearOwner removes one character only', () => {
  const P = new Particles({ canvas: null });
  P.api('a').burst({ x: 0, y: 0, count: 10 });
  P.api('b').burst({ x: 0, y: 0, count: 10 });
  P.clearOwner('a');
  assert.equal(P.count('a'), 0);
  assert.equal(P.count('b'), 10);
});
