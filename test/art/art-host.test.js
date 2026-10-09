// Art host (spec §6.1-6.3, 6.5): the three §2 examples render through the full
// pipeline (views, info, paint, entities, layers, trails, portraits) without errors,
// plus guards, bounds, palettes, clone drawSelf and portrait cache invalidation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockCanvas, installPath2D } from './lib/mock-canvas.js';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import {
  ArtHost, resolveArtDef, guarded, clampBounds, movePhase, hurtShapesFor, hitShapesFor, charModel, PHASE_NAMES,
} from '../../client/render/art-host.js';
import gloopSpecArt from './fixtures/gloop-spec-art.js';

installPath2D();
const makeCanvas = (w, h) => new MockCanvas(w, h);
const STATES = ['idle', 'run', 'air', 'crouch', 'shield', 'hitstun', 'helpless', 'shieldbreak', 'roll', 'land', 'jumpsquat',
  'grabbing', 'grabbed', 'stunned', 'glide', 'fly', 'wallcling', 'crawl', 'respawn'];

async function load(id, artOverride = null, dir = '../fixtures') {
  const def0 = (await import(`${dir}/${id}/character.js`)).default;
  const def = artOverride ? { ...def0, art: artOverride } : def0;
  const n = normalize(def, { expectedId: id });
  assert.deepEqual(n.errors, [], `${id} normalizes`);
  const ir = buildIR(n.draft);
  const entry = { id, character: ir, def, ir: null, assets: {}, assetsVersion: 1 };
  return { def, ir, host: new ArtHost(entry, { makeCanvas }) };
}

// Snapshot-like fighter record for a state / move instance.
function snap(ir, o = {}) {
  const T = ir.tables;
  const f = { id: 'p1', x: 10, y: -2, vx: o.vx ?? 0, vy: o.vy ?? 0, facing: o.facing ?? 1, state: o.state || 'idle', stateFrame: o.stateFrame ?? 12,
    grounded: o.grounded ?? true, hitlag: 0, charging: false, fm: T.forms.indexOf(o.form || 'base'), r: T.resources.map((n) => ir.resources[n].start ?? 50),
    sv: {}, st: o.st || [], bs: o.bs ?? 1, mv: 0, ctl: 0, dj: 0 };
  if (o.move) {
    const def = ir.moves[o.move];
    const ph = movePhase(def, o.frame ?? 0);
    f.state = 'attack';
    f.mv = [T.moves.indexOf(o.move), o.frame ?? 0, PHASE_NAMES.indexOf(o.phase || ph.name), 0, o.charge ?? 0];
  }
  return f;
}

function renderAll(host, ir, label) {
  const rec = { index: 0, color: '#ff4d5e', tables: { ...ir.tables, resources: ir.tables.resources } };
  const st = host.fighter('p1');
  let paints = 0;
  const check = (f, what) => {
    const view = host.view(f, rec);
    const info = host.info(view, st, { time: paints / 60, frame: paints, simFrame: paints });
    const p = host.paint(view, info, st, 0.8);
    assert.ok(p && p.canvas, `${label} ${what}: painted`);
    assert.equal(p.error, false, `${label} ${what}: no draw error`);
    assert.ok(p.canvas.getContext('2d').ops > 0, `${label} ${what}: drew something`);
    const ctx = new MockCanvas(800, 600).getContext('2d');
    host.drawLayer(ctx, 'drawBack', view, info, st);
    host.drawLayer(ctx, 'drawWorld', view, info, st);
    assert.equal(ctx.depth, 0, `${label} ${what}: layers balanced`);
    host.trail(view, info);
    paints++;
  };
  for (const form of ir.tables.forms) {
    for (const state of STATES) check(snap(ir, { state, form, grounded: !['air', 'helpless', 'glide', 'fly'].includes(state), vy: state === 'air' ? -6 : 0 }), `${form}/${state}`);
    for (const name of ir.tables.moves) {
      const def = ir.moves[name];
      for (const frame of new Set([0, Math.max(0, def.startup - 1), def.startup, def.activeEnd ?? def.startup, def.duration - 1])) {
        check(snap(ir, { form, move: name, frame }), `${form}/${name}@${frame}`);
      }
      if (def.charge) check(snap(ir, { form, move: name, frame: def.charge.at, phase: 'charge', charge: 20 }), `${form}/${name} charge`);
      if (def.hold) check(snap(ir, { form, move: name, frame: def.hold.from, phase: 'hold' }), `${form}/${name} hold`);
    }
  }
  // statuses, body scale, both facings
  check(snap(ir, { st: [[0, 30, 1]], bs: 1.3, facing: -1 }), 'status+scale');
  return paints;
}

function renderEntities(host, ir, label) {
  const rec = { index: 0, color: '#3d9bff', tables: ir.tables };
  const st = host.fighter('p1');
  const ov = host.view(snap(ir), rec);
  const info = host.info(ov, st, { time: 1, frame: 60, simFrame: 60 });
  ir.tables.entities.forEach((name, t) => {
    const def = ir.entities[name];
    const kinds = ['projectile', 'minion', 'trap', 'zone', 'beam', 'clone', 'part'];
    const e = { i: 100 + t, o: 0, t, k: kinds.indexOf(def.kind), x: 50, y: -40, vx: 6, vy: -1, a: 0, g: 8, l: 30, h: -1, n: def.length || 0, f: -1, v: {} };
    if (def.kind === 'clone') e.c = ['attack', 4, ir.tables.moves.indexOf('jab'), 4, 1, 1];
    const ev = host.entityView(e, rec, ov);
    assert.equal(ev.name, name);
    for (const layer of ['main', 'world']) {
      const ctx = new MockCanvas(800, 600).getContext('2d');
      host.drawEntity(ctx, ev, info, layer, { st });
      assert.equal(ctx.depth, 0, `${label} entity ${name} ${layer} balanced`);
      if (layer === 'main') assert.ok(ctx.ops > 0, `${label} entity ${name} drew`);
    }
  });
  assert.equal(host.warned.size, 0, `${label}: no art errors (${[...host.warned].join(', ')})`);
}

for (const id of ['nimbus', 'gertie', 'gloop']) {
  test(`example renders without errors: ${id}`, async () => {
    const { ir, host } = await load(id);
    const n = renderAll(host, ir, id);
    assert.ok(n > 40);
    renderEntities(host, ir, id);
    const pc = host.portrait(96);
    assert.ok(pc.getContext('2d').ops > 0, `${id} portrait non-blank`);
    assert.equal(host.warned.size, 0, `${id}: warnings ${[...host.warned].join(', ')}`);
  });
}

// The real roster v2 characters (characters/<id>), not just the fixtures.
for (const id of ['nimbus', 'gertie', 'gloop']) {
  test(`roster character renders without errors: ${id}`, async () => {
    const { ir, host } = await load(id, null, '../../characters');
    assert.ok(renderAll(host, ir, `roster ${id}`) > 40);
    renderEntities(host, ir, `roster ${id}`);
    assert.ok(host.portrait(96).getContext('2d').ops > 0, `${id} portrait non-blank`);
    assert.equal(host.warned.size, 0, `${id}: warnings ${[...host.warned].join(', ')}`);
  });
}

test('gloop with the spec soft-body art (helpers/blob.js) renders all forms, clone drawSelf, entities', async () => {
  const { ir, host } = await load('gloop', gloopSpecArt);
  renderAll(host, ir, 'gloop-spec');
  renderEntities(host, ir, 'gloop-spec');
  const st = host.fighter('p1');
  assert.ok(st.artCache.gel && st.artCache.gel.ready, 'init() ran and the gel stepped');
  assert.ok(host.portrait(64).getContext('2d').ops > 0);
});

test('gertie: sprite clips resolve by move.anim, state, idle; missing assets draw placeholders', async () => {
  const { ir, host } = await load('gertie');
  const sprite = host.artFor('base').spriteApi;
  const rec = { index: 0, tables: ir.tables };
  const jab = ir.tables.moves.find((n) => ir.moves[n].anim === 'jab');
  const v = host.view(snap(ir, { move: jab, frame: ir.moves[jab].startup }), rec);
  assert.equal(sprite.resolve('body', v).name, 'jab');
  assert.equal(sprite.resolve('body', v).frame, 27);
  assert.equal(sprite.resolve('body', host.view(snap(ir, { state: 'run', vx: 6 }), rec)).name, 'run');
  assert.equal(sprite.resolve('body', host.view(snap(ir, { state: 'roll' }), rec)).name, 'idle');
  assert.equal(sprite.resolve('body', host.view(snap(ir, { state: 'air', grounded: false, vy: -5 }), rec)).name, 'jump');
});

test('portraits are rebuilt after assets load (cache key includes assetsVersion)', async () => {
  const { host } = await load('gertie');
  const a = host.portrait(96);
  assert.equal(host.portrait(96), a, 'cached');
  host.setAssets({ sheet: new MockCanvas(2048, 2048), teeth: new MockCanvas(192, 48) }, 7);
  const b = host.portrait(96);
  assert.notEqual(b, a);
  assert.ok(b.getContext('2d').log.some((l) => l.startsWith('drawImage(img2048x2048')), 'sheet drawn once loaded');
});

test('guarded(): unbalanced save() is popped, extra restore() cannot pop engine state, errors are returned', () => {
  const ctx = new MockCanvas(10, 10).getContext('2d');
  ctx.save(); // engine state
  const d0 = ctx.depth;
  assert.equal(guarded(ctx, () => { ctx.save(); ctx.save(); ctx.globalAlpha = 0.2; }), null);
  assert.equal(ctx.depth, d0);
  assert.equal(guarded(ctx, () => { ctx.restore(); ctx.restore(); ctx.restore(); }), null);
  assert.equal(ctx.depth, d0, 'engine save survived');
  const err = guarded(ctx, () => { ctx.save(); throw new Error('boom'); });
  assert.equal(err.message, 'boom');
  assert.equal(ctx.depth, d0);
  assert.ok(!Object.prototype.hasOwnProperty.call(ctx, 'save'), 'wrappers removed');
  // nested (drawSelf inside draw)
  guarded(ctx, () => { ctx.save(); guarded(ctx, () => { ctx.save(); }); });
  assert.equal(ctx.depth, d0);
});

test('bounds: author boxes are clamped (≤ 4× collider per axis, ≤ 900 total), defaults from hurtboxes, legacy v1 layout', async () => {
  const col = { w: 50, h: 90 };
  const b = clampBounds({ left: -5000, right: 5000, top: -5000, bottom: 5000 }, col);
  assert.equal(b.left, -200); assert.equal(b.right, 200); assert.equal(b.top, -360); assert.equal(b.bottom, 360);
  const big = clampBounds({ left: -600, right: 600, top: -100, bottom: 10 }, { w: 200, h: 200 });
  assert.ok(big.right - big.left <= 900.0001);
  const { host } = await load('nimbus');
  assert.deepEqual(host.bounds('base'), { left: -110, right: 130, top: -170, bottom: 30 });
  const s = host.bounds('base', 2);
  assert.equal(s.top, -340);
  const g = await load('gloop');
  assert.equal(g.host.bounds('puddle').top, Math.max(-130, -4 * g.ir.forms.puddle.body.collider.h)); // form collider clamps
  // v1 humanoid keeps the v1 offscreen layout (3.4·H square, feet at 68%)
  const v1 = new ArtHost({ id: 'x', character: { id: 'x', stats: { width: 52, height: 100 }, moves: {} }, def: { art: {} } }, { makeCanvas });
  assert.ok(v1.bounds('base').legacy);
});

test('alt palettes for duplicate picks', async () => {
  const { host } = await load('gloop', gloopSpecArt);
  assert.equal(host.palette('base', 0).base, undefined);
  assert.equal(host.palette('base', 1).base, '#e35798');
  assert.equal(host.palette('base', 5).base, '#e35798'); // wraps
});

test('phases come from the validated action; hurt/hit shapes are body-space and scaled', async () => {
  const { ir, host } = await load('gertie');
  const name = ir.tables.moves.find((n) => ir.moves[n].hitboxes.length);
  const def = ir.moves[name];
  assert.equal(movePhase(def, 0).name, def.startup > 0 ? 'startup' : 'active');
  assert.equal(movePhase(def, def.startup).name, 'active');
  assert.equal(movePhase(def, def.duration - 1).name, def.activeEnd < def.duration - 1 ? 'recovery' : 'active');
  const rec = { tables: ir.tables };
  const v = host.view(snap(ir, { move: name, frame: def.hitboxes[0].start, bs: 2 }), rec);
  const hb = hitShapesFor(v);
  assert.ok(hb.length >= 1);
  const src = def.hitboxes[0];
  if (src.shape === 'circle') assert.equal(hb[0].r, src.r * 2);
  const hurt = hurtShapesFor(charModel(ir), host.view(snap(ir, { state: 'crouch' }), rec));
  assert.ok(hurt.length >= 1);
});

test('resolveArtDef: v1 → humanoid / v1shim, v2 draw passthrough, sprites and shapes auto-art', () => {
  assert.equal(resolveArtDef({ art: { palette: {} } }).kind, 'humanoid');
  assert.equal(resolveArtDef({ art: { draw() {} } }).kind, 'v1shim');
  const d = () => {};
  assert.equal(resolveArtDef({ version: 2, art: { rig: 'none', draw: d } }).draw, d);
  assert.equal(resolveArtDef({ version: 2, art: { sheets: { a: {} }, clips: { a: {} } } }).auto, 'sprite');
  assert.equal(resolveArtDef({ version: 2, art: { rig: 'none' } }).auto, 'shapes');
  assert.equal(resolveArtDef({ version: 2, art: {} }).kind, 'humanoid');
});

test('a throwing draw is caught once and drawn as magenta hurtboxes', async () => {
  const { ir, host } = await load('nimbus', { rig: 'none', draw() { throw new Error('nope'); } });
  const st = host.fighter('p1');
  const orig = console.error; let n = 0; console.error = () => { n++; };
  try {
    for (let i = 0; i < 3; i++) {
      const v = host.view(snap(ir), { tables: ir.tables });
      const p = host.paint(v, host.info(v, st, { time: i / 60 }), st, 1);
      assert.equal(p.error, true);
      assert.ok(p.canvas.getContext('2d').log.includes('fillStyle=#f0f'));
    }
  } finally { console.error = orig; }
  assert.equal(n, 1, 'warned once');
});

test('slow draws switch to quality low and redraw every other frame', async () => {
  let calls = 0;
  const slow = { rig: 'none', draw() { calls++; const t = performance.now(); while (performance.now() - t < 5); } };
  const { ir, host } = await load('nimbus', slow);
  const st = host.fighter('p1');
  for (let i = 0; i < 40; i++) {
    const v = host.view(snap(ir), { tables: ir.tables });
    host.paint(v, host.info(v, st, { time: i / 60 }), st, 1);
  }
  assert.equal(st.quality, 'low');
  const before = calls;
  for (let i = 0; i < 10; i++) {
    const v = host.view(snap(ir), { tables: ir.tables });
    host.paint(v, host.info(v, st, { time: i / 60 }), st, 1);
  }
  assert.ok(calls - before <= 6, `30 Hz redraw (${calls - before})`);
});

test('clone and entity caches are swept when no longer drawn', async () => {
  const { ir, host } = await load('gloop', gloopSpecArt);
  const rec = { index: 0, tables: ir.tables };
  const st = host.fighter('p1');
  const ov = host.view(snap(ir), rec);
  let info = host.info(ov, st, { time: 0 });
  const t = ir.tables.entities.indexOf('gloopling');
  const e = { i: 77, o: 0, t, k: 5, x: 0, y: 0, vx: 0, vy: 0, a: 0, g: 1, l: 60, h: -1, n: 0, f: 1, v: {}, c: ['idle', 1, -1, 0, 1, 1] };
  host.drawEntity(new MockCanvas(50, 50).getContext('2d'), host.entityView(e, rec, ov), info, 'main', { st });
  assert.ok([...host.fighters.keys()].some((k) => k.includes('#self')), 'clone state created');
  assert.ok(st.entityCache.has(77));
  for (let i = 0; i < 800; i++) info = host.info(ov, st, { time: i / 60 });
  assert.ok(![...host.fighters.keys()].some((k) => k.includes('#self')), 'clone state swept');
  assert.ok(!st.entityCache.has(77), 'entity cache swept');
});

test('preview(): Lab/showcase entry point draws v1 and v2 characters from a partial view', async () => {
  const { ir, host } = await load('nimbus');
  const c = new MockCanvas(300, 300).getContext('2d');
  const r = host.preview(c, { state: 'attack', moveName: ir.tables.moves[0], moveFrame: ir.moves[ir.tables.moves[0]].startup }, { frame: 30 });
  assert.equal(r.error, null);
  assert.ok(c.ops > 0 && c.depth === 0);
  assert.equal(r.view.move.key, ir.tables.moves[0]);
  const { validateCharacter } = await import('../../shared/balance/validate.js');
  const def = (await import('../../characters/volt/character.js')).default;
  const v1 = new ArtHost({ id: 'volt', character: validateCharacter(def, { expectedId: 'volt' }).character, def }, { makeCanvas });
  const d = new MockCanvas(300, 300).getContext('2d');
  assert.equal(v1.preview(d, { state: 'attack', slot: 'jab', moveFrame: 3, facing: -1 }, { frame: 10 }).error, null);
  assert.ok(d.ops > 50);
});
