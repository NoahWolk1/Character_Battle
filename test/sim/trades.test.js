// Sim P2 (§3.13): simultaneous trades on the governed path, sequential v1 order on
// the legacy path, and shield hits stamping lastHitFrame (strike beats grab).
//   node --test test/sim/trades.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as hits from '../../shared/sim/hits.js';
import { newGame, forceAction } from '../entities/helpers.js';

const box = (o) => ({ shape: 'circle', x: 30, y: -40, r: 30, damage: 6, angle: 45, knockback: 30, growth: 60, ...o });

/** p1 at x=0 facing right and p2 at x=60 facing left, both swinging into each other. */
function trade(rules) {
  const game = newGame(rules);
  const [a, b] = game.fighters;
  a.x = 0; a.facing = 1;
  b.x = 60; b.facing = -1;
  forceAction(a, [box({ onHit: [{ action: 'emit', args: { name: 'aHit' } }] })]);
  forceAction(b, [box({ damage: 9, onHit: [{ action: 'emit', args: { name: 'bHit' } }] })]);
  hits.resolve(game);
  const ev = game.drainEvents();
  return { game, a, b, ev, fx: ev.filter((e) => e.type === 'fx').map((e) => e.name) };
}

test('governed: a mutual strike trades, both onHit lists run, hitlag is the max of the frame', () => {
  const { game, a, b, ev, fx } = trade();
  assert.ok(game.gov, 'governed');
  assert.ok(a.percent > 0 && b.percent > 0, `both took damage (${a.percent}, ${b.percent})`);
  assert.equal(ev.filter((e) => e.type === 'hit').length, 2);
  assert.deepEqual([...fx].sort(), ['aHit', 'bHit'], 'both attackers ran their per-hitbox onHit list');
  assert.equal(a.state, 'hitstun');
  assert.equal(b.state, 'hitstun');
  assert.equal(a.hitlag, b.hitlag, 'both sides freeze for the same (max) hitlag');
});

test('legacy (governor off): strikes stay sequential in v1 order (goldens)', () => {
  const { game, a, b, fx } = trade({ governor: false });
  assert.equal(game.gov, null);
  assert.ok(a.percent > 0 && b.percent > 0, 'both collected hits still land');
  assert.deepEqual(fx, ['aHit'], 'p2 was launched before its own onHit could run');
});

test('a governed trade is deterministic', () => {
  const s = () => { const { a, b } = trade(); return JSON.stringify([a.percent, b.percent, a.kx, a.ky, b.kx, b.ky, a.hitlag, b.hitlag]); };
  assert.equal(s(), s());
});

test('shield hits set lastHitFrame on the governed path only', () => {
  for (const governor of [true, false]) {
    const game = newGame({ governor });
    const [a, b] = game.fighters;
    a.x = 0; a.facing = 1;
    b.x = 60; b.facing = -1;
    b.state = 'shield'; b.stateFrame = 5;
    const before = b.lastHitFrame;
    forceAction(a, [box()]);
    hits.resolve(game);
    const ev = game.drainEvents();
    assert.ok(ev.some((e) => e.type === 'shieldhit'), 'shield hit');
    assert.equal(b.percent, 0);
    if (governor) {
      assert.equal(b.lastHitFrame, game.frame, 'strike-beats-grab sees the shielded target');
      assert.equal(b.lastHitBy, a.id);
    } else assert.equal(b.lastHitFrame, before, 'legacy unchanged');
  }
});
