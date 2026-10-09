// Art Lab core helpers (spec §6.5/§6.6): URL params, strike frames, phase markers,
// the pool move list (throws, taunt, cancel-only), showcase playlists, the check
// thresholds and the contact-sheet layout. Pure functions, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { validateCharacter } from '../../shared/balance/validate.js';
import * as core from '../../client/lab/core.js';

async function fixtureIR(id) {
  const def = (await import(`../fixtures/${id}/character.js`)).default;
  const n = normalize(def, { expectedId: id });
  assert.deepEqual(n.errors, [], `${id} normalizes`);
  return buildIR(n.draft);
}

test('parseParams: still, frame=strike|n, boxes, form, palette, safe src only', () => {
  const p = core.parseParams('?char=ember&still=1&frame=strike&boxes=1&form=spike&palette=2&checks=1&sheet=1');
  assert.equal(p.char, 'ember');
  assert.equal(p.still, true);
  assert.equal(p.frame, 'strike');
  assert.equal(p.boxes, true);
  assert.equal(p.form, 'spike');
  assert.equal(p.palette, 2);
  assert.equal(p.checks, true);
  assert.equal(p.sheet, true);
  assert.equal(core.parseParams('?frame=12').frame, 12);
  assert.equal(core.parseParams('?frame=-3').frame, 0);
  assert.equal(core.parseParams('?frame=abc').frame, null);
  assert.equal(core.parseParams('?still=0').still, false);
  assert.equal(core.parseParams('?src=/dev/fixtures/nimbus/').src, '/dev/fixtures/nimbus/');
  assert.equal(core.parseParams('?src=/dev/../../etc/').src, null);
  assert.equal(core.parseParams('?src=https://evil.example/x/').src, null);
});

test('strikeFrame / frameFor: active midpoint, hitbox-gap aware, clamped numbers', () => {
  const def = { duration: 30, startup: 10, activeEnd: 14, hitboxes: [{ start: 10, end: 14 }] };
  assert.equal(core.strikeFrame(def), 12);
  // Multi-hit with a gap at the midpoint → nearest frame that has a hitbox out.
  const gap = { duration: 40, startup: 10, activeEnd: 20, hitboxes: [{ start: 10, end: 12 }, { start: 18, end: 20 }] };
  const f = core.strikeFrame(gap);
  assert.ok(gap.hitboxes.some((h) => f >= h.start && f <= h.end), `strike ${f} shows a hitbox`);
  assert.equal(core.strikeFrame({ duration: 20 }), 10, 'no active window → mid-duration');
  assert.equal(core.frameFor(def, 'strike'), 12);
  assert.equal(core.frameFor(def, 99), 29);
  assert.equal(core.frameFor(def, null), null);
});

test('phaseMarkers: startup/active/recovery cover the move; windows listed', () => {
  const def = { duration: 30, startup: 10, activeEnd: 14, hitboxes: [{ start: 10, end: 12, damage: 5 }], intangible: [[1, 4]], cancels: [{ from: 15, to: 20, into: ['jab'] }] };
  const m = core.phaseMarkers(def);
  const k = (x) => m.find((y) => y.kind === x);
  assert.deepEqual([k('startup').from, k('startup').to], [0, 9]);
  assert.deepEqual([k('active').from, k('active').to], [10, 14]);
  assert.deepEqual([k('recovery').from, k('recovery').to], [15, 29]);
  assert.ok(k('hitbox') && k('intangible') && k('cancel'));
});

test('moveList: every pool move incl. throws, taunt and per-form routes (Gloop)', async () => {
  const ir = await fixtureIR('gloop');
  const list = core.moveList(ir);
  const names = list.map((m) => m.name);
  assert.equal(new Set(names).size, names.length, 'no duplicates');
  assert.deepEqual([...names].sort(), [...ir.tables.moves].sort(), 'every pool move listed');
  const cats = new Set(list.map((m) => m.category));
  for (const c of ['throw', 'taunt']) assert.ok(cats.has(c), `${c} present`);
  assert.ok(list.some((m) => m.routes.some((r) => r.includes(':'))), 'multi-form routes are form-prefixed');
  const spikeOnly = list.find((m) => m.routes.length && m.routes.every((r) => r.startsWith('spike:')));
  if (spikeOnly) assert.equal(core.formForMove(spikeOnly, 'base'), 'spike');
});

test('triggerPlaylist: resolved move per trigger, per form, no grab-partner moves', async () => {
  const ir = await fixtureIR('gloop');
  for (const form of ir.tables.forms) {
    const pl = core.triggerPlaylist(ir, form);
    assert.ok(pl.length > 5, `${form} has a playlist`);
    for (const x of pl) {
      assert.equal(ir.forms[form].slots[x.trigger], x.name);
      assert.ok(!['throw', 'pummel'].includes(x.def.category));
    }
  }
});

test('stateList: base states plus movement-mode states only when enabled', async () => {
  const nimbus = await fixtureIR('nimbus');
  const labels = core.stateList(nimbus, 'base').map((s) => s.label);
  for (const s of ['idle', 'run', 'jump', 'fall', 'hurt', 'shield']) assert.ok(labels.includes(s), s);
  if (nimbus.forms.base.movement?.hover) assert.ok(labels.includes('hover'));
  const v1 = validateCharacter((await import('../../characters/ember/character.js')).default, { expectedId: 'ember' });
  assert.ok(v1.ok);
  assert.ok(!core.stateList(v1.character, 'base').some((s) => s.label === 'crawl'), 'no crawl without the mode');
});

test('evaluate: §6.6 thresholds', () => {
  const L = core.CHECK_LIMITS;
  assert.deepEqual([L.hitboxCoverage, L.hurtOutside, L.hurtEmpty, L.contrastDL, L.perfWarnMs, L.perfLowMs], [0.15, 0.45, 0.30, 12, 2, 4]);
  const clean = core.evaluate({ coverage: [{ where: 'jab f3', label: '#0', coverage: 0.5 }], fit: { outside: 0.2, empty: 0.2 }, edges: [], silhouetteL: 30, stageL: 60, perfMs: 1 });
  assert.deepEqual(clean, []);
  const bad = core.evaluate({
    coverage: [{ where: 'jab f3', label: '#0', coverage: 0.1 }], fit: { outside: 0.5, empty: 0.4, where: 'idle' },
    edges: [{ where: 'upSmash f12', left: 0, right: 0, top: 3, bottom: 0 }], silhouetteL: 55, stageL: 60, perfMs: 5,
  });
  const kinds = bad.map((w) => w.check);
  for (const k of ['hitbox-coverage', 'hurtbox-fit', 'bounds-overflow', 'contrast', 'perf']) assert.ok(kinds.includes(k), k);
  assert.equal(kinds.filter((k) => k === 'hurtbox-fit').length, 2);
});

test('mask helpers: coverage, fit, edges', () => {
  const w = 20, h = 20;
  const tf = { k: 1, ox: 10, oy: 20, facing: 1 }; // body (0,0) = canvas (10,20): feet at the bottom
  const op = new Uint8Array(w * h);
  for (let y = 5; y < 20; y++) for (let x = 5; x < 15; x++) op[y * w + x] = 1; // 10×15 opaque block
  const inside = { shape: 'rect', x: 0, y: -7, w: 8, h: 8 };
  const outside = { shape: 'circle', x: 30, y: -30, r: 3 };
  const [a, b] = core.hitboxCoverage(op, [{ shape: inside, label: 'a' }, { shape: outside, label: 'b' }], w, h, tf);
  assert.ok(a.coverage > 0.9, `inside covered ${a.coverage}`);
  assert.equal(b.coverage, 0, 'off-canvas shape (past art.bounds) can never be covered');
  const [b2] = core.hitboxCoverage(op, [{ shape: outside, label: 'b' }], w, h, tf, { offCanvas: false });
  assert.equal(b2.coverage, 1, 'drawWorld art: off-canvas shape is not judged');
  const half = { shape: 'rect', x: 8, y: -7, w: 8, h: 8 }; // right half past the canvas edge
  const [c] = core.hitboxCoverage(op, [{ shape: half, label: 'c' }], w, h, tf);
  assert.ok(c.coverage < 0.5, `half off-canvas ${c.coverage}`);
  assert.ok(Math.abs(core.shapeArea({ shape: 'capsule', x1: 0, y1: 0, x2: 10, y2: 0, r: 1 }) - (20 + Math.PI)) < 1e-9);
  const fit = core.hurtboxFit(op, [{ shape: 'rect', x: 0, y: -7.5, w: 10, h: 15 }], w, h, tf);
  assert.ok(fit.outside < 0.1 && fit.empty < 0.1, JSON.stringify(fit));
  const e = core.edgeTouches(op, w, h);
  assert.equal(e.bottom, 10);
  assert.equal(e.top + e.left + e.right, 0);
  const merged = core.mergeEdges([{ where: 'up f3', left: 0, right: 1, top: 0, bottom: 0 }, { where: 'up f5', left: 0, right: 0, top: 2, bottom: 0 }, { where: 'idle', left: 0, right: 0, top: 0, bottom: 0 }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].where, 'up f3–5');
});

test('sheetLayout: grid fits n tiles; SHEET_ID matches the dev route rule', async () => {
  const L = core.sheetLayout(13, { tile: 100, cols: 6 });
  assert.equal(L.cols, 6);
  assert.equal(L.rows, 3);
  const last = L.at(12);
  assert.ok(last.x + 100 <= L.width && last.y + 100 + L.label <= L.height);
  const routes = await import('../../server/dev-routes.js');
  assert.equal(String(routes.SHEET_ID), String(core.SHEET_ID));
  for (const id of ['ember', 'major-nibbles', 'a_b']) assert.ok(core.SHEET_ID.test(id), id);
  for (const id of ['../x', '', 'a/b', '.hidden']) assert.ok(!core.SHEET_ID.test(id), id);
});
