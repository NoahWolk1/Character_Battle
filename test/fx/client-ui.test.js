// Client UI regressions: pause Resume, controller source overlap, gamepad Start / menu
// navigation, CPU labels, showcase size normalization, HUD ring layout, web-root hygiene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveSources, anyLayout, PadEdges } from '../../client/input.js';
import { LocalMatch, OnlineMatch, PROTOCOL } from '../../client/match.js';
import { playerLabel, drawHud } from '../../client/render/hud.js';
import { showcaseScale } from '../../client/ui/showcase.js';
import { nearest, padDirection } from '../../client/ui/padnav.js';
import { frameBox } from '../../client/lab/core.js';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { getStage, DEFAULT_STAGE_ID } from '../../shared/stages/index.js';
import { tablesOf } from '../../shared/sim/snapshot.js';
import { mockCtx, texts } from './mock-canvas.js';

const CLIENT = fileURLToPath(new URL('../../client/', import.meta.url));
const ir = {};
const art = {};
for (const id of ['nimbus', 'gertie']) {
  const mod = (await import(`../fixtures/${id}/character.js`)).default;
  ir[id] = buildIR(normalize(mod, { expectedId: id }).draft);
  art[id] = mod.art || {};
}

test('Resume: one handler, and resume() is idempotent (a double fire cannot re-pause)', () => {
  const src = readFileSync(CLIENT + 'main.js', 'utf8');
  assert.equal(src.match(/#resume/g).length, 1, 'exactly one #resume wiring');
  assert.ok(!/\.onclick\s*=/.test(src), 'no onclick reassignment stacking a 2nd handler');
  const pauses = [];
  const characters = new Map([['nimbus', { character: ir.nimbus }]]);
  const m = new LocalMatch({
    renderer: { setRoster() {} }, stage: getStage(DEFAULT_STAGE_ID), characters,
    players: [{ id: 'a', name: 'P1', charId: 'nimbus', source: 'any' }, { id: 'b', name: 'CPU 2', charId: 'nimbus', cpu: 'easy' }],
    onPause: (p) => pauses.push(p),
  });
  m.togglePause();
  m.resume(); m.resume();
  assert.equal(m.paused, false);
  assert.deepEqual(pauses, [true, false]);
  const menus = [];
  const o = new OnlineMatch({ renderer: { setRoster() {} }, net: {}, start: { protocol: PROTOCOL, roster: [] }, onPause: (p) => menus.push(p) });
  o.toggleMenu();
  o.resume(); o.resume();
  assert.equal(o.menuOpen, false);
  assert.deepEqual(menus, [true, false]);
});

test("'Keyboard + Pad 1' gives up keys and pads other human slots claimed", () => {
  assert.deepEqual(resolveSources(['any', 'cpu-easy']), ['any', 'cpu-easy']);
  assert.deepEqual(resolveSources(['any', 'pad0']), ['any!pad0', 'pad0']);
  assert.deepEqual(resolveSources(['any', 'p2', 'pad1']), ['any!p2', 'p2', 'pad1']);
  assert.deepEqual(anyLayout('any').pads, [0]);
  assert.deepEqual(anyLayout('any!pad0').pads, []);
  const k = Object.values(anyLayout('any!p2').keys).flat();
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyL', 'ShiftRight']) assert.ok(!k.includes(code), code);
  for (const code of ['KeyA', 'KeyD', 'Space', 'KeyJ', 'KeyK']) assert.ok(k.includes(code), code);
  const k1 = Object.values(anyLayout('any!p1').keys).flat();
  assert.ok(k1.includes('ArrowLeft') && !k1.includes('KeyA') && !k1.includes('Space'));
});

test('gamepad: Start rising edge, menu direction and spatial focus', () => {
  const held = new Set();
  const e = new PadEdges((i, n) => held.has(`${i}:${n}`));
  assert.equal(e.pressed(9), false);
  held.add('2:9');
  assert.equal(e.pressed(9), true, 'pad 3 Start pressed');
  assert.equal(e.pressed(9), false, 'held is not a new press');
  held.delete('2:9');
  e.pressed(9);
  held.add('2:9');
  assert.equal(e.pressed(9), true);
  assert.deepEqual(padDirection((i, n) => i === 1 && n === 15), [1, 0]);
  assert.deepEqual(padDirection(() => false, (i) => (i === 0 ? [0, -0.9] : [])), [0, -1]);
  assert.equal(padDirection(() => false), null);
  // 2x2 grid + a wide button below
  const R = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }, { x: 0, y: 20, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 }, { x: 0, y: 40, w: 30, h: 10 }];
  assert.equal(nearest(R, 0, [1, 0]), 1);
  assert.equal(nearest(R, 0, [0, 1]), 2);
  assert.equal(nearest(R, 3, [0, 1]), 4);
  assert.equal(nearest(R, 1, [1, 0]), -1);
  const src = readFileSync(CLIENT + 'match.js', 'utf8');
  assert.equal((src.match(/pad\.pressed\(9\)/g) || []).length, 2, 'Local and Online match loops poll Start');
});

test('player labels: CPUs numbered by slot, generic names not repeated', () => {
  assert.equal(playerLabel({ index: 1, cpu: 'hard', name: 'CPU 2' }), 'CPU 2');
  assert.equal(playerLabel({ index: 2, cpu: 'normal', name: 'CPU normal' }), 'CPU 3');
  assert.equal(playerLabel({ index: 0, name: 'P1' }), 'P1');
  assert.equal(playerLabel({ index: 0, name: 'Ann' }), 'P1 · Ann');
  const a = playerLabel({ index: 1, cpu: 'easy', name: 'CPU' }), b = playerLabel({ index: 3, cpu: 'easy', name: 'CPU' });
  assert.notEqual(a, b);
});

test('showcase: small and tall fighters render at comparable body heights', () => {
  const w = 250, h = 170;
  // nimbus (v2 bounds incl. attack reach, H 64) vs a legacy tall humanoid (H 112)
  const small = showcaseScale({ left: -132, right: 182, top: -210, bottom: 34 }, 64, w, h) * 64;
  const tall = showcaseScale(frameBox({ legacy: true }, 112), 112, w, h) * 112;
  assert.ok(small / tall > 0.85 && small / tall < 1.15, `${small.toFixed(0)} vs ${tall.toFixed(0)}`);
  assert.ok(tall < h * 0.6);
});

test('HUD: ring resources stay inside the card and are labelled', () => {
  const r = { id: 'p0', name: 'P1', index: 0, cpu: false, color: '#ff4d5e', entry: { id: 'gertie', character: ir.gertie, art: art.gertie }, tables: tablesOf(ir.gertie) };
  const R = { cam: { w: 1600, h: 900, x: 0, y: 0, zoom: 1 }, dpr: 1, time: 30, hudState: new Map(), info: () => r, roster: [r] };
  const t = tablesOf(ir.gertie);
  const rv = t.resources.map(() => 0);
  rv[t.resources.indexOf('battery')] = ir.gertie.resources.battery.max;
  const ctx = mockCtx();
  drawHud(ctx, R, { fighters: [{ id: 'p0', x: 0, y: 0, percent: 0, stocks: 3, state: 'idle', r: rv, st: [], fm: 0 }] }, {});
  const cardH = typeof art.gertie.hud === 'function' ? 112 : 92;
  const top = 900 - cardH - 18;
  const rings = ctx.calls.filter((c) => c[0] === 'arc' && c[3] > 30);
  assert.ok(rings.length > 0);
  for (const [, , cy, rad] of rings) assert.ok(cy - rad - 2.5 >= top + 2, `ring top ${cy - rad - 2.5} vs card ${top}`);
  assert.ok(texts(ctx).some((s) => /^BATTERY \d+%$/.test(s)), texts(ctx).join('|'));
});

test('web root has no stray underscore scratch files', () => {
  const stray = readdirSync(CLIENT).filter((f) => f.startsWith('_'));
  assert.deepEqual(stray, []);
});
