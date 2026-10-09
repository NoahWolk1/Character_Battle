// WP-L: HUD resource bars/pips/rings, status icons, gov pops, art.hud slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hudModel, drawHud, drawOffscreenBubbles, drawGlyph, STATUS_GLYPHS, setPortraitSource, tablesFor } from '../../client/render/hud.js';
import { Effects } from '../../client/render/effects.js';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { tablesOf } from '../../shared/sim/snapshot.js';
import { mockCtx, texts, count } from './mock-canvas.js';

const ex = {};
for (const id of ['nimbus', 'gertie', 'gloop']) {
  const mod = (await import(`../fixtures/${id}/character.js`)).default;
  const ir = buildIR(normalize(mod, { expectedId: id }).draft);
  ex[id] = { ir, art: mod.art || {} };
}
const EXPECT = { nimbus: ['charge', 'bar', 'Static'], gertie: ['battery', 'ring', 'Battery'], gloop: ['mass', 'pips', 'Mass'] };

function fakeR(entries, extra = {}) {
  const roster = entries.map(([id, e], i) => ({ id: `p${i}`, name: `P${i}`, index: i, cpu: false, color: ['#ff4d5e', '#3d9bff', '#ffc531'][i], entry: { id, character: e.ir, art: e.art }, tables: tablesOf(e.ir) }));
  return { cam: { w: 1600, h: 900, x: 0, y: 0, zoom: 1 }, dpr: 1, time: 30, hudState: new Map(), info: (id) => roster.find((r) => r.id === id), roster, ...extra };
}

test('HUD model shows the resource for all three examples', () => {
  for (const [id, e] of Object.entries(ex)) {
    const R = fakeR([[id, e]]);
    const r = R.roster[0];
    const t = tablesFor(r);
    const [name, style, label] = EXPECT[id];
    const idx = t.resources.indexOf(name);
    assert.ok(idx >= 0, `${id} synced resource`);
    const rv = t.resources.map(() => 0); rv[idx] = e.ir.resources[name].max / 2;
    const m = hudModel(r, { r: rv, st: [], fm: 0 });
    assert.equal(m.resources.length, 1, id);
    assert.deepEqual([m.resources[0].style, m.resources[0].label], [style, label]);
    assert.equal(m.resources[0].frac, 0.5);
    // art-host view shape works too
    const m2 = hudModel({ entry: r.entry, color: '#fff' }, { resources: { [name]: e.ir.resources[name].max }, statuses: [{ name: 'burn', frames: 60, stacks: 2 }] });
    assert.equal(m2.resources[0].frac, 1);
    assert.equal(m2.statuses[0].name, 'burn');
    assert.equal(m2.statuses[0].frac, 0.5);
  }
});

test('statuses decode from snapshot indices with icon/tint and remaining fraction', () => {
  const e = ex.gloop;
  const R = fakeR([['gloop', e]]);
  const t = tablesFor(R.roster[0]);
  const st = t.statuses.map((n, i) => [i, 10, 1]);
  const m = hudModel(R.roster[0], { r: [50], st, fm: 0 });
  assert.equal(m.statuses.length, t.statuses.length);
  for (const s of m.statuses) { assert.ok(s.frac > 0 && s.frac <= 1); assert.ok(s.tint.startsWith('#')); }
});

test('drawHud renders resources, statuses, gov pops and art.hud for every example', () => {
  let hudCalls = 0, rectSeen = null;
  const withHud = { ...ex.nimbus, art: { ...ex.nimbus.art, hud(ctx, rect, info) { hudCalls++; rectSeen = rect; assert.ok(info.resources.charge >= 0 && info.kit); ctx.fillRect(rect.x, rect.y, 4, 4); } } };
  const R = fakeR([['nimbus', withHud], ['gertie', ex.gertie], ['gloop', ex.gloop]]);
  R.effects = new Effects({ seed: 1 });
  const fb = R.effects.hudState('p1');
  fb.armor = 10; fb.breakT = 50; fb.tired = 20; fb.trims.push({ amount: 4.5, t: 30 });
  setPortraitSource(() => null);
  const fighters = R.roster.map((r, i) => {
    const t = tablesFor(r);
    return { id: r.id, x: 0, y: 0, percent: 42 + i, stocks: 3, state: 'idle', r: t.resources.map((n) => r.entry.character.resources[n].max * 0.6), st: [[0, 20, 2]], fm: 0 };
  });
  const ctx = mockCtx();
  drawHud(ctx, R, { fighters }, {});
  const tx = texts(ctx);
  for (const l of ['STATIC', 'MASS']) assert.ok(tx.includes(l), `label ${l} in ${tx.join('|')}`);
  assert.ok(tx.includes('BREAK!'));
  assert.ok(tx.some((s) => s.includes('resisted')));
  assert.ok(tx.includes('tired'));
  assert.equal(hudCalls, 1);
  assert.ok(rectSeen.w > 10 && rectSeen.h > 10);
  assert.ok(count(ctx, 'arc') > 20, 'rings, pips and status icons');
  assert.equal(ctx.depth, 0, 'save/restore balanced');
});

test('a throwing art.hud is contained and disabled after 3 throws', () => {
  let n = 0;
  const bad = { ...ex.gloop, art: { hud() { n++; throw new Error('x'); } } };
  const R = fakeR([['gloop', bad]]);
  const err = console.error; console.error = () => {};
  try {
    for (let i = 0; i < 5; i++) { const ctx = mockCtx(); drawHud(ctx, R, { fighters: [{ id: 'p0', x: 0, y: 0, percent: 0, stocks: 1, state: 'idle', r: [10], st: [], fm: 0 }] }, {}); assert.equal(ctx.depth, 0); }
  } finally { console.error = err; }
  assert.equal(n, 3);
});

test('v1 fighters (no v2 fields) still render the classic card', () => {
  const v1 = { ir: { name: 'Ember', stats: { height: 90 } }, art: {} };
  const R = fakeR([['ember', v1]]);
  R.roster[0].tables = undefined;
  const ctx = mockCtx();
  drawHud(ctx, R, { fighters: [{ id: 'p0', x: 0, y: 0, percent: 12, stocks: 2, state: 'idle' }] }, {});
  assert.ok(texts(ctx).includes('12'));
  drawOffscreenBubbles(ctx, R, { fighters: [{ id: 'p0', x: 99999, y: 0, state: 'idle' }] });
  assert.equal(ctx.depth, 0);
});

test('portrait source is used for cards and bubbles (non-humanoid portraits via art host)', () => {
  const asked = [];
  setPortraitSource((entry, size, o) => { asked.push([entry.id, size, o.form]); return { width: 96, height: 96 }; });
  const R = fakeR([['nimbus', ex.nimbus]]);
  const ctx = mockCtx();
  drawHud(ctx, R, { fighters: [{ id: 'p0', x: 0, y: 0, percent: 0, stocks: 1, state: 'idle', r: [0], st: [], fm: 0 }] }, {});
  assert.deepEqual(asked[0], ['nimbus', 96, 'base']);
  assert.ok(count(ctx, 'drawImage') >= 1);
  setPortraitSource(null);
});

test('every status glyph draws; custom icons fall back to text', () => {
  const ctx = mockCtx();
  for (const g of STATUS_GLYPHS) drawGlyph(ctx, g, 0, 0, 8, '#fff');
  drawGlyph(ctx, '★', 0, 0, 8, '#fff', 'sparkle');
  drawGlyph(ctx, 'something-long', 0, 0, 8, '#fff', 'soaked');
  assert.ok(texts(ctx).includes('★') && texts(ctx).includes('S'));
  assert.equal(ctx.depth, 0);
});
