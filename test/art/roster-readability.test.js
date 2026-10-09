// Roster readability (art review): duplicate picks must look different (alt palettes),
// key states / throws / taunt must not fall back to the idle silhouette, and spawned
// entities must be visible from their first frame. Run: node --test test/art/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockCanvas, installPath2D } from './lib/mock-canvas.js';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { ArtHost } from '../../client/render/art-host.js';
import { stateList, moveView, strikeFrame, entityRecord } from '../../client/lab/core.js';

installPath2D();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROSTER = readdirSync(join(ROOT, 'characters'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(ROOT, 'characters', d.name, 'character.js')))
  .map((d) => d.name);

async function load(id) {
  const def = (await import(`../../characters/${id}/character.js`)).default;
  const n = normalize(def, { expectedId: id });
  assert.deepEqual(n.errors, [], `${id} normalizes`);
  const ir = buildIR(n.draft);
  return { ir, host: new ArtHost({ id, character: ir, def, ir, assets: {}, assetsVersion: 1 }, { makeCanvas: (w, h) => new MockCanvas(w, h) }) };
}

// A context that also records where things land (device px), for a coarse silhouette.
function shapeCtx() {
  const ctx = new MockCanvas(400, 400).getContext('2d');
  const pts = [];
  const at = (x, y) => { const m = ctx.m; pts.push([m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]); };
  for (const n of ['moveTo', 'lineTo', 'arc', 'ellipse']) {
    const f = ctx[n].bind(ctx);
    ctx[n] = (x, y, ...r) => { at(x, y); return f(x, y, ...r); };
  }
  for (const n of ['bezierCurveTo', 'quadraticCurveTo']) {
    const f = ctx[n].bind(ctx);
    ctx[n] = (...a) => { at(a[a.length - 2], a[a.length - 1]); return f(...a); };
  }
  const fr = ctx.fillRect.bind(ctx);
  ctx.fillRect = (x, y, w, h) => { at(x, y); at(x + w, y + h); return fr(x, y, w, h); };
  return { ctx, pts };
}

/** Occupied 10-px cells of a body-space drawing (feet at 200,300). */
function silhouette(host, partial, o = {}) {
  const { ctx, pts } = shapeCtx();
  ctx.setTransform(1, 0, 0, 1, 200, 300);
  host.preview(ctx, { facing: 1, stateFrame: 12, ...partial }, { id: `sil${Math.random()}`, frame: 30, time: 0.5, ...o });
  assert.deepEqual(badColors(ctx.log), [], `${partial.state}/${partial.moveName || ''}: invalid colours`);
  return new Set(pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([x, y]) => `${Math.floor(x / 10)},${Math.floor(y / 10)}`));
}
const diff = (a, b) => {
  let d = 0;
  for (const k of a) if (!b.has(k)) d++;
  for (const k of b) if (!a.has(k)) d++;
  return d / Math.max(1, new Set([...a, ...b]).size);
};

// Colours Chrome accepts (it throws on a bad gradient stop; the mock doesn't): hex, rgb/hsl
// functions and a few names. Catches palette keys leaking through as colours.
const NAMED = new Set(['white', 'black', 'transparent', 'red', 'orange', 'yellow', 'gold', 'cyan', 'magenta']);
const okColor = (c) => /^#[0-9a-f]{3,8}$/i.test(c) || /^(rgb|rgba|hsl|hsla)\(/i.test(c) || NAMED.has(c.toLowerCase());
function badColors(log) {
  const bad = new Set();
  for (const line of log) {
    const m = /^(fillStyle|strokeStyle|shadowColor)=(.*)$/.exec(line);
    if (!m) continue;
    const v = m[2];
    if (/^(lin|rad|con)\(/.test(v)) { for (const [, c] of v.matchAll(/\|[-\d.]+:([^|]+)/g)) if (!okColor(c)) bad.add(c); }
    else if (!['pattern', 'obj', 'fn'].includes(v) && !v.startsWith('img') && !okColor(v)) bad.add(v);
  }
  return [...bad];
}

const READ_STATES = ['crouch', 'helpless', 'shieldbreak', 'stunned', 'grabbed'];
const READ_MOVES = ['pummel', 'fthrow', 'bthrow', 'uthrow', 'dthrow', 'taunt'];
const MIN_DIFF = 0.12;

for (const id of ROSTER) {
  test(`duplicate picks look different: ${id}`, async () => {
    const { host } = await load(id);
    const pals = host.artFor('base').palettes;
    assert.ok(Array.isArray(pals) && pals.length >= 2, `${id}: art.palettes needs alternates for mirror matches`);
    const draw = (ordinal) => {
      const ctx = new MockCanvas(400, 400).getContext('2d');
      host.preview(ctx, { state: 'idle' }, { id: `pal${ordinal}`, ordinal, frame: 30, time: 0.5 });
      assert.deepEqual(badColors(ctx.log), [], `${id}: palette ${ordinal} paints invalid colours`);
      return ctx.hash();
    };
    const base = draw(0);
    for (let i = 1; i < pals.length; i++) assert.notEqual(draw(i), base, `${id}: palette ${i} renders identically to the main palette`);
    assert.equal(host.warned.size, 0, `${id}: ${[...host.warned].join(', ')}`);
  });

  test(`states, throws and taunt read differently from idle: ${id}`, async () => {
    const { ir, host } = await load(id);
    // Baselines: idle, and whatever the art draws for a state it doesn't handle (the fallback pose).
    const bases = [silhouette(host, { state: 'idle', grounded: true }), silhouette(host, { state: 'unhandled-state', grounded: true })];
    const same = [];
    const check = (label, sil) => {
      const d = Math.min(...bases.map((b) => diff(sil, b)));
      if (d < MIN_DIFF) same.push(`${label} (${d.toFixed(2)})`);
    };
    for (const s of stateList(ir)) if (READ_STATES.includes(s.label)) check(s.label, silhouette(host, s.view));
    for (const name of READ_MOVES) {
      const def = ir.moves[name];
      if (def) check(name, silhouette(host, moveView(name, def, strikeFrame(def))));
    }
    assert.deepEqual(same, [], `${id}: these look like idle`);
    assert.equal(host.warned.size, 0, `${id}: ${[...host.warned].join(', ')}`);
  });

  test(`entities are visible on their first frames: ${id}`, async () => {
    const { ir, host } = await load(id);
    const ov = host.view({ state: 'idle', grounded: true, facing: 1, x: 0, y: 0 }, {});
    for (const name of ir.tables.entities) {
      if (ir.entities[name].legacy) continue;
      for (const age of [0, 1]) {
        const ctx = new MockCanvas(400, 400).getContext('2d');
        let visible = 0;
        const fill = ctx.fill.bind(ctx), stroke = ctx.stroke.bind(ctx);
        ctx.fill = (...a) => { if (ctx.globalAlpha >= 0.3) visible++; return fill(...a); };
        ctx.stroke = (...a) => { if (ctx.globalAlpha >= 0.3) visible++; return stroke(...a); };
        const st = host.fighter(`ent:${name}:${age}`);
        const info = host.info(ov, st, { time: 0.5, frame: age, simFrame: age, advance: false });
        host.drawEntity(ctx, host.entityView(entityRecord(ir, name, age, 1), {}, ov), info, 'main', { st });
        assert.ok(visible > 0, `${id}: entity ${name} is invisible at age ${age}`);
      }
    }
  });
}
