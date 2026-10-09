// Client side of the seam: validated IRs → live sim → (events → Effects director,
// snapshot + roster tables → HUD model / drawHud, entities → decodeEntity). Uses the
// real v2 examples, including clone/minor ids that are not in game.fighters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Effects } from '../../client/render/effects.js';
import { BUDGET } from '../../client/render/particles.js';
import { drawHud, hudModel } from '../../client/render/hud.js';
import { decodeEntity, ENTITY_KIND_CODES } from '../../shared/sim/snapshot.js';
import { mockCtx } from '../fx/mock-canvas.js';
import { runMatch } from './helpers.js';

test('events, snapshots and tables from a v2 match drive Effects and the HUD', async () => {
  const E = new Effects({ seed: 7 });
  const ctx = mockCtx();
  let roster = null, game = null, resourcesShown = 0, statusesShown = 0, entitiesSeen = 0;
  const pending = [];
  const fxFighter = (id) => {
    const r = roster && roster.find((x) => x.id === id);
    return r ? { color: r.color, art: {}, palette: {}, character: r.entry.character } : null; // minor ids → null
  };
  E.attach({ fighter: fxFighter });
  await runMatch({
    ids: ['nimbus', 'gertie', 'gloop', 'ember'], seed: 2, frames: 60 * 60, cpu: 'random',
    onEvent(e) { pending.push(e); },
    onFrame(g) {
      if (!roster) {
        game = g;
        roster = g.roster().map((r, i) => ({ ...r, color: ['#f45', '#39f', '#fc3', '#6d6'][i], entry: { id: r.charId, character: g.fighters[i].char, art: {} } }));
      }
      const snap = g.snapshot();
      E.observe(snap);
      E.handleEvents(pending.splice(0));
      E.update();
      for (const e of snap.entities) {
        const d = decodeEntity(e);
        assert.ok(d.k >= 0 && d.k < ENTITY_KIND_CODES.length);
        assert.ok(d.o >= -1 && d.o < snap.fighters.length);
        entitiesSeen++;
      }
      if (g.frame % 30 === 0) {
        const R = { cam: { w: 1600, h: 900, x: 0, y: 0, zoom: 1 }, dpr: 1, time: g.frame, hudState: new Map(), effects: E, info: (id) => roster.find((r) => r.id === id), roster };
        for (const f of snap.fighters) {
          const m = hudModel(R.info(f.id), f);
          resourcesShown += m.resources.length;
          statusesShown += m.statuses.length;
        }
        drawHud(ctx, R, snap, {});
        E.draw(ctx, 'back');
        E.draw(ctx, 'front');
        assert.equal(ctx.depth, 0, 'canvas save/restore balanced');
      }
      assert.ok(E.particles.count() <= BUDGET.global);
    },
  });
  assert.ok(game.frame > 1000);
  assert.ok(resourcesShown > 0, 'resource widgets never had data');
  assert.ok(statusesShown > 0, 'status icons never had data');
  assert.ok(entitiesSeen > 0, 'no entities in snapshots');
});
