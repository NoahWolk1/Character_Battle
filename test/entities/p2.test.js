// Sim P2: heading-rotated entity shapes, per-hitbox onHit lists for entity hits and
// default maxHits per kind (owner decision d).
//   node --test test/entities/p2.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../shared/sim/entities.js';
import * as hits from '../../shared/sim/hits.js';
import { newGame, ghost } from './helpers.js';

function duel(rules) {
  const game = newGame(rules);
  const [a, b] = game.fighters;
  a.x = 0; a.facing = 1;
  b.x = 300; b.facing = -1;
  return { game, a, b };
}

const near = (x, y, m = 1e-6) => Math.abs(x - y) < m;

test('heading: free-flying shapes rotate with velocity; a capsule fired downward stands vertical', () => {
  const { a } = duel();
  ghost(a);
  const side = E.spawn(a, 'needle', { x: 0, y: -300, vx: 6, vy: 0 });
  const down = E.spawn(a, 'needle', { x: 0, y: -300, vx: 0, vy: 6 });
  assert.equal(E.headingRot(side), 0);
  const [hs] = E.hitboxesOf(side);
  assert.ok(near(hs.shape.y1, hs.shape.y2) && Math.abs(hs.shape.x2 - hs.shape.x1) > 40, 'horizontal along +x');
  assert.ok(near(Math.abs(E.headingRot(down)), Math.PI / 2), `90° (${E.headingRot(down)})`);
  const [hd] = E.hitboxesOf(down);
  assert.ok(near(hd.shape.x1, hd.shape.x2) && Math.abs(hd.shape.y2 - hd.shape.y1) > 40, 'vertical');
  const back = E.spawn(a, 'needle', { x: 0, y: -300, vx: -6, vy: 0 });
  const [hb] = E.hitboxesOf(back);
  assert.ok(near(hb.shape.y1, hb.shape.y2), 'flying backward stays horizontal (mirror, no flip)');
});

test('heading: rects become capsules along their long axis when rotated', () => {
  const { a } = duel();
  const p = E.spawn(a, 'plank', { x: 0, y: -300, vx: 0, vy: 6 });
  const [h] = E.hitboxesOf(p);
  assert.equal(h.shape.shape, 'capsule');
  assert.ok(near(h.shape.x1, h.shape.x2), 'long axis vertical');
  assert.equal(h.shape.r, 4);
});

test('heading: attached / stationary entities never rotate', () => {
  const { a } = duel();
  const t = E.spawn(a, 'spikeTrap', { x: 100, y: 0 });
  const l = E.spawn(a, 'laser', {});
  assert.equal(E.headingRot(t), 0);
  if (l) assert.equal(E.headingRot(l), 0);
});

test('entity hits run the per-hitbox onHit list, then the entity onHit list', () => {
  const { game, a, b } = duel();
  ghost(a);
  E.spawn(a, 'needle', { worldX: 300, y: -40, vx: 0.01, vy: 0 });
  hits.resolve(game);
  const fx = game.drainEvents().filter((e) => e.type === 'fx').map((e) => e.name);
  assert.ok(b.percent > 0, 'hit');
  assert.deepEqual(fx, ['pinged', 'entityHit']);
});

test('maxHits defaults: projectile/trap 1; minion/zone/beam/part/clone unlimited; explicit maxHits honored', () => {
  const lim = (name, o = { x: 100, y: 0 }) => E.hitLimit(E.spawn(duel().a, name, o));
  assert.equal(lim('ball', { x: 0, y: -300 }), 1);
  assert.equal(lim('drill', { x: 0, y: -300 }), 2, 'pierce 1 → 2 hits');
  assert.equal(lim('spikeTrap'), 1);
  assert.equal(lim('multiTrap'), 3);
  assert.equal(lim('cloud'), Infinity);
  assert.equal(lim('thug'), Infinity);

  const { game, a, b } = duel();
  const m = E.spawn(a, 'multiTrap', { x: -200, y: 0 });
  const hb = m.def.hitboxes[0];
  for (let i = 0; i < 2; i++) assert.equal(E.onHitConnect(game, m, b, hb), false, `hit ${i + 1} keeps it`);
  assert.equal(E.onHitConnect(game, m, b, hb), true, 'spent on hit 3');
  const z = E.spawn(duel().a, 'cloud', { x: -200, y: -200 });
  for (let i = 0; i < 20; i++) assert.equal(E.onHitConnect(game, z, b, z.def.hitboxes[0]), false);
  assert.ok(E.alive(z), 'zone ends by life, not hits');
});

test('maxHits in play: a default trap is spent by one hit, a zone keeps rehitting', () => {
  const { game, a, b } = duel();
  ghost(a);
  const t = E.spawn(a, 'spikeTrap', { worldX: 300, y: 0 });
  hits.resolve(game);
  assert.ok(b.percent > 0);
  assert.ok(!E.alive(t), 'trap spent');

  const g2 = duel();
  ghost(g2.a);
  const z = E.spawn(g2.a, 'cloud', { worldX: 300, y: -40 });
  let landed = 0;
  for (let i = 0; i < 45; i++) {
    g2.b.x = 300; g2.b.y = 0; g2.b.kx = 0; g2.b.ky = 0;
    g2.game.step();
    landed += g2.game.drainEvents().filter((e) => e.type === 'hit' && e.target === g2.b.id).length;
  }
  assert.ok(landed >= 3, `zone rehit ${landed} times`);
  assert.ok(E.alive(z), 'zone still alive');
});

test('think spawns originate at the entity; worldX is clamped around the entity, not the owner', async () => {
  const S = await import('../../shared/sim/script-api.js');
  const { game, a } = duel();
  a.x = 0;
  const t = E.spawn(a, 'spikeTrap', { worldX: 500, y: 0 });
  const before = new Set(game.entities.map((e) => e.id));
  S.runThink(game, t, (view, e, api) => {
    api.spawn('needle', { x: 0, y: -30, vx: 0, vy: 0.01 });
    api.spawn('needle', { worldX: 1000, worldY: t.y - 30, vx: 0, vy: 0.01 });
  });
  const made = game.entities.filter((e) => !before.has(e.id) && e.name === 'needle');
  assert.equal(made.length, 2);
  assert.ok(Math.abs(made[0].x - 500) < 1, `relative spawn at the trap (${made[0].x})`);
  assert.ok(Math.abs(made[1].x - 1000) < 1, `world spawn clamped around the trap (${made[1].x})`);
});
