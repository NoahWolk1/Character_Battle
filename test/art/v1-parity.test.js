// v1 art parity (spec §9 WP-K acceptance): ember/bastion/volt/mirelle must render
// exactly as before through the v2 art host. Compares the full Canvas call log of the
// frozen v1 puppet (fixtures/puppet-v1.js) against ArtHost.drawBody for every state
// and every move at several frames, both facings. Run: node --test test/art/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockCanvas, installPath2D } from './lib/mock-canvas.js';
import { validateCharacter } from '../../shared/balance/validate.js';
import { MOVE_SLOTS } from '../../shared/balance/rules.js';
import * as oldPuppet from './fixtures/puppet-v1.js';
import { ArtHost, resolveArtDef } from '../../client/render/art-host.js';

installPath2D();
const IDS = ['ember', 'bastion', 'volt', 'mirelle'];
const makeCanvas = (w, h) => new MockCanvas(w, h);

const STATES = [
  ['idle', {}], ['run', { vx: 7 }], ['air', { grounded: false, vy: -10 }], ['air', { grounded: false, vy: 8 }],
  ['air', { grounded: false, vy: 2, dj: 12 }], ['crouch', {}], ['shield', {}], ['hitstun', { grounded: false }],
  ['hitstun', { tumble: true, grounded: false }], ['helpless', { grounded: false }], ['shieldbreak', {}], ['roll', {}],
  ['airdodge', { grounded: false }], ['jumpsquat', {}], ['land', {}], ['spotdodge', {}], ['respawn', {}],
];

function viewsFor(ch) {
  const out = [];
  for (const [state, extra] of STATES) out.push({ state, stateFrame: 5, grounded: true, vx: 0, vy: 0, ...extra });
  for (const slot of Object.keys(MOVE_SLOTS)) {
    const m = ch.moves[slot];
    const frames = new Set([0, Math.max(0, m.startup - 1), m.startup, m.startup + 2, Math.floor(m.duration / 2), m.duration - 1]);
    for (const fr of frames) {
      out.push({ state: 'attack', slot, move: m, moveFrame: fr, grounded: m.category !== 'aerial', vx: 0, vy: 0, charging: fr === m.startup - 1 && slot.includes('Smash') });
    }
  }
  return out;
}

// Same art, chains without pre-settle so a fresh cache starts identically in both pipelines.
function noPresettle(def) {
  const art = def.art || {};
  // The frozen v1 puppet predates palette-key chain colours: resolve them for it.
  const pal = art.palette || {};
  const col = (k) => (k && pal[k]) || k;
  return { ...def, art: { ...art, ...(art.chains ? { chains: art.chains.map((c) => ({ ...c, color: col(c.color), color2: col(c.color2), presettle: false })) } : {}) } };
}

for (const id of IDS) {
  test(`v1 parity: ${id}`, async () => {
    const mod = await import(`../../characters/${id}/character.js`);
    const def = noPresettle(mod.default);
    const v = validateCharacter(mod.default, { expectedId: id });
    assert.ok(v.ok, `${id} validates`);
    const ir = v.character;
    // Both validator shapes: the IR (v2 validator) and the plain v1 object (pre-v2 validator).
    const v1Shape = { id: ir.id, name: ir.name, author: ir.author, description: ir.description, stats: ir.stats,
      moves: Object.fromEntries(Object.keys(MOVE_SLOTS).map((s) => [s, ir.moves[s]])) };
    const artDef = resolveArtDef(def);
    assert.equal(artDef.kind, typeof def.art.draw === 'function' ? 'v1shim' : 'humanoid');
    let n = 0;
    for (const [ch, facings] of [[ir, [1, -1]], [v1Shape, [-1]]]) for (const [vi, base] of viewsFor(ch).entries()) {
      for (const facing of facings) {
        const host = new ArtHost({ id, character: ch, def, artDef }, { makeCanvas });
        const cacheOld = {};
        const st = host.fighter('p1');
        for (let k = 0; k < 2; k++) {
          const time = 100 + vi * 7 + k;
          const lv = { ...base, facing, x: 40 * k, y: -3 * k, index: 1, doubleJumpFlip: base.dj || 0 };
          const a = new MockCanvas(400, 400).getContext('2d');
          oldPuppet.drawFighter(a, ch, def.art, lv, time, cacheOld);
          const b = new MockCanvas(400, 400).getContext('2d');
          // Exactly what renderer.buildFrame does: the exact v1 view only for v1-shaped characters.
          const snapF = { ...lv, dj: lv.doubleJumpFlip };
          delete snapF.move;
          const view = host.view(host.model.kind === 'v1' ? { ...snapF, legacyView: lv } : snapF, { index: 1, color: '#ff4d5e', tables: ch.tables });
          const info = host.info(view, st, { time: time / 60, frame: time, simFrame: time });
          const err = host.drawBody(b, view, info, st);
          assert.equal(err, null, `${id} ${base.state} ${base.slot || ''} draw error: ${err && err.stack}`);
          // drawBody wraps the hook in one save()/restore() pair.
          const logB = b.log.slice(1, -1);
          if (a.log.join('\n') !== logB.join('\n')) {
            const i = a.log.findIndex((x, j) => x !== logB[j]);
            assert.fail(`${id} ${base.state} ${base.slot || ''}@${base.moveFrame ?? ''} f${facing} k${k}: first diff at call ${i}: old=${a.log[i]} new=${logB[i]}`);
          }
          n++;
        }
      }
    }
    assert.ok(n > 100);
  });
}

test('v1 parity: trail point matches the v1 renderer rule', async () => {
  const mod = await import('../../characters/ember/character.js');
  const def = noPresettle(mod.default);
  const ch = validateCharacter(mod.default, { expectedId: 'ember' }).character;
  const host = new ArtHost({ id: 'ember', character: ch, def }, { makeCanvas });
  const st = host.fighter('p1');
  const m = ch.moves.sideSmash;
  const hb = m.hitboxes[0];
  const lv = { state: 'attack', slot: 'sideSmash', move: m, moveFrame: hb.start, grounded: true, vx: 0, vy: 0, facing: 1, x: 0, y: 0, index: 0 };
  const view = host.view(host.model.kind === 'v1' ? { ...lv, legacyView: lv } : lv, {});
  const info = host.info(view, st, { time: 1, frame: 60 });
  host.drawBody(new MockCanvas(10, 10).getContext('2d'), view, info, st);
  const pts = host.trail(view, info);
  assert.equal(pts.length, 1);
  // v1: leading limb from the anim, squash/spin applied
  const drawn = oldPuppet.drawFighter(new MockCanvas(10, 10).getContext('2d'), ch, def.art, lv, 60, {});
  const a = (m.pose || {}).limb;
  assert.ok(Number.isFinite(pts[0].x) && Number.isFinite(pts[0].y));
  if (!a || a === 'frontHand') {
    const p = drawn.rig.armF.hand;
    assert.ok(Math.abs(pts[0].x - p.x * drawn.pose.sx) < 1e-6 || drawn.pose.spin, 'hand x');
  }
});
