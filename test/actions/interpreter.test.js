// Action interpreter unit sims (WP-F, spec §3.6 / §9 row F): hold, charge, cancels,
// timeline, velocity/gravity windows, next/else/cost/requires, once-per-airtime,
// helpless, rehit keys, goto, generic fallback. Run: node --test test/actions/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kit, duel, hold, steps } from './helpers.js';
import { genericAction, phaseOf } from '../../shared/sim/actions.js';
import { resolveMove } from '../../shared/sim/input-map.js';

const strike = (o = {}) => ({ x: 30, y: -45, r: 24, damage: 5, angle: 45, knockback: 10, growth: 30, ...o });
const moveEvents = (game, id) => game.drainEvents().filter((e) => e.type === 'move' && e.id === id);

/** Frames f spends with f.action === the first instance started (from the press). */
function actionLength(game, id, buttons, max = 400) {
  const f = game.fighter(id);
  hold(game, id, ...buttons);
  game.step();
  const inst = f.action;
  assert.ok(inst, 'action started');
  let n = 1;
  while (f.action === inst && n < max) { game.step(); n++; }
  return { n, inst };
}

test('hold loops back while held and never exceeds hold.max', () => {
  const k = kit({ neutralSpecial: { name: 'Beam', category: 'special', duration: 20, hold: { button: 'special', from: 5, to: 10, max: 30 } } });
  for (const governor of [true, false]) {
    const g = duel(k, k, { rules: { governor }, x1: -300, x2: 300 });
    const { n, inst } = actionLength(g, 'p1', ['special']);
    assert.ok(inst.holdFrames <= 30, `holdFrames ${inst.holdFrames} ≤ 30`);
    assert.equal(inst.holdFrames, 30, 'five 6-frame loops');
    assert.equal(n, 20 + 1 + 30, 'start frame + duration + looped frames');
    // Tapped (not held): no loop at all.
    const g2 = duel(k, k, { rules: { governor }, x1: -300, x2: 300 });
    hold(g2, 'p1', 'special'); g2.step(); hold(g2, 'p1');
    const f = g2.fighter('p1');
    let m = 1;
    while (f.action && m < 100) { g2.step(); m++; }
    assert.equal(m, 21);
  }
});

test('hold release jumps to the release move or frame', () => {
  const k = kit({
    neutralSpecial: { name: 'Wind', category: 'special', duration: 30, hold: { button: 'special', from: 4, to: 8, max: 120, release: 'burst' } },
    burst: { name: 'Burst', category: 'special', duration: 12, hitboxes: [] },
    downSpecial: { name: 'Skip', category: 'special', duration: 30, hold: { button: 'special', from: 4, to: 8, max: 120, release: 25 } },
  });
  const g = duel(k, k, { x1: -300, x2: 300 });
  const f = g.fighter('p1');
  hold(g, 'p1', 'special'); steps(g, 20); // looping
  assert.equal(f.action.name, 'neutralSpecial');
  assert.equal(phaseOf(f), 'hold');
  hold(g, 'p1'); steps(g, 2);
  assert.equal(f.action.name, 'burst', 'released into the release move');
  steps(g, 20);
  hold(g, 'p1', 'special', 'down'); g.step(); hold(g, 'p1', 'down'); steps(g, 7);
  assert.equal(f.action.name, 'downSpecial');
  assert.ok(f.action.frame >= 25, `jumped to frame 25 (at ${f.action.frame})`);
});

test('charge freezes at charge.at and gives ×1.4 damage at 60 frames', () => {
  const k = kit({ sideSmash: { name: 'Smash', category: 'smash', duration: 40, hitboxes: [strike({ start: 12, end: 14, damage: 10, x: 40, r: 30 })] } });
  for (const governor of [false, true]) {
    const g = duel(k, k, { rules: { governor }, x1: -30, x2: 30 });
    const f = g.fighter('p1');
    hold(g, 'p1', 'strong');
    let hit = null;
    for (let i = 0; i < 200 && !hit; i++) {
      g.step();
      hit = g.drainEvents().find((e) => e.type === 'hit');
    }
    assert.equal(f.lastAction.chargeFrames, 60, 'charged the full 60 frames');
    assert.ok(hit, 'the smash connected');
    assert.equal(hit.damage, 14, `10 damage ×1.4 = 14 (governor ${governor}, got ${hit.damage})`);
  }
  // Uncharged tap: ×1.
  const g = duel(k, k, { rules: { governor: false }, x1: -30, x2: 30 });
  hold(g, 'p1', 'strong'); g.step(); hold(g, 'p1');
  let hit = null;
  for (let i = 0; i < 60 && !hit; i++) { g.step(); hit = g.drainEvents().find((e) => e.type === 'hit'); }
  assert.equal(hit.damage, 10);
});

test('cancels fire only inside their window (and onHit windows only after a hit)', () => {
  const k = kit({
    side: { name: 'Lead', category: 'tilt', duration: 30, cancels: [{ from: 10, to: 14, into: ['jab'] }] },
    jab: { name: 'Jab', category: 'jab', duration: 14, hitboxes: [] },
  });
  const run = (pressAt) => {
    const g = duel(k, k, { x1: -300, x2: 300 });
    const f = g.fighter('p1');
    hold(g, 'p1', 'attack', 'right'); g.step(); hold(g, 'p1');
    const start = g.frame;
    let cancelAt = null;
    for (let i = 1; i < 40; i++) {
      hold(g, 'p1', ...(f.action && f.action.frame === pressAt - 1 && f.action.name === 'side' ? ['attack'] : []));
      g.step();
      const mv = moveEvents(g, 'p1').find((e) => e.name === 'jab');
      if (mv) { cancelAt = g.frame - start; break; }
    }
    return cancelAt;
  };
  // Press inside the window → jab starts that same frame (frame 12 of 'side').
  assert.equal(run(12), 12);
  assert.equal(run(10), 10);
  assert.equal(run(14), 14);
  // Press long before the window (buffer expires first) → no cancel; the jab never starts.
  assert.equal(run(2), null);
  // Press after the window → no cancel; the buffered press starts jab when 'side' ends (frame 30).
  assert.equal(run(16), null);
  // A buffered press just before the window cancels on the window's first frame.
  assert.equal(run(6), 10);

  const k2 = kit({
    side: { name: 'Lead', category: 'tilt', duration: 30, hitboxes: [strike({ start: 3, end: 5 })], cancels: [{ from: 8, to: 20, into: ['jab'], onHit: true }] },
    jab: { name: 'Jab', category: 'jab', duration: 14, hitboxes: [] },
  });
  for (const near of [false, true]) {
    const g = duel(k2, k2, near ? { x1: -30, x2: 30 } : { x1: -300, x2: 300 });
    const f = g.fighter('p1');
    hold(g, 'p1', 'attack', 'right'); g.step(); hold(g, 'p1');
    while (f.action.frame < 9) g.step(); // (hitlag freezes the frame counter)
    hold(g, 'p1', 'attack'); g.step(); hold(g, 'p1');
    assert.equal(f.action && f.action.name, near ? 'jab' : 'side', `onHit cancel ${near ? 'after a hit' : 'blocked on whiff'}`);
  }
});

test('timeline at / from-to-every / onLand / onHit entries fire at the right frames', () => {
  const k = kit({
    jab: {
      name: 'T', category: 'jab', duration: 20, hitboxes: [strike({ start: 6, end: 6 })],
      timeline: [{ at: 3, emit: 'at3' }, { from: 4, to: 12, every: 4, emit: 'tick' }, { onHit: true, emit: 'hit' }],
    },
    dair: {
      name: 'D', category: 'aerial', duration: 60, landingLag: 10,
      velocity: [{ start: 1, end: 60, vy: 8, untilGrounded: true }], timeline: [{ onLand: true, emit: 'land' }],
    },
  });
  const g = duel(k, k, { x1: -30, x2: 30 });
  const f = g.fighter('p1');
  hold(g, 'p1', 'attack'); g.step(); hold(g, 'p1');
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const fr = f.action ? f.action.frame : null;
    for (const e of g.drainEvents()) if (e.type === 'fx' && e.id === 'p1') seen.push(`${e.name}@${fr}`);
    g.step();
  }
  for (const e of g.drainEvents()) if (e.type === 'fx' && e.id === 'p1') seen.push(`${e.name}@end`);
  assert.deepEqual(seen.filter((s) => s.startsWith('at3')), ['at3@3']);
  assert.deepEqual(seen.filter((s) => s.startsWith('tick')), ['tick@4', 'tick@8', 'tick@12']);
  assert.deepEqual(seen.filter((s) => s.startsWith('hit')), ['hit@6']);

  // onLand: jump, dair, land.
  const g2 = duel(k, k, { x1: -300, x2: 300 });
  const f2 = g2.fighter('p1');
  hold(g2, 'p1', 'jump'); steps(g2, 8); hold(g2, 'p1');
  steps(g2, 4);
  hold(g2, 'p1', 'attack', 'down'); g2.step(); hold(g2, 'p1');
  assert.equal(f2.action && f2.action.name, 'dair');
  let landed = null;
  for (let i = 0; i < 60 && !landed; i++) { g2.step(); landed = g2.drainEvents().find((e) => e.type === 'fx' && e.name === 'land'); }
  assert.ok(landed, 'onLand entry fired');
  assert.equal(f2.state, 'land');
  assert.equal(f2.lag, 10);
});

test('velocity windows: set/add, airOnly (no accidental lift-off), gravity scale', () => {
  const k = kit({
    side: { name: 'Lift', category: 'tilt', duration: 20, velocity: [{ start: 2, end: 6, vy: -6 }] },
    up: { name: 'Hover', category: 'tilt', duration: 20, velocity: [{ start: 2, end: 6, vy: -6 }] },
    neutralSpecial: { name: 'Float', category: 'special', duration: 30, gravity: [{ from: 1, to: 30, scale: 0.5 }] },
    downSpecial: { name: 'Push', category: 'special', duration: 10, velocity: [{ start: 1, end: 3, vx: 2, mode: 'add' }] },
  });
  k.moves.up.velocity[0].airOnly = true; // runtime extension (normalize drops unknown velocity keys today)
  const g = duel(k, k, { x1: -300, x2: 300 });
  const f = g.fighter('p1');
  hold(g, 'p1', 'attack', 'right'); g.step(); hold(g, 'p1'); steps(g, 3);
  assert.equal(f.grounded, false, 'plain upward window lifts off the ground (v1 behavior)');
  steps(g, 60);
  hold(g, 'p1', 'attack', 'up'); g.step(); hold(g, 'p1'); steps(g, 6);
  assert.equal(f.action && f.action.name, 'up');
  assert.equal(f.grounded, true, 'airOnly window ignored on the ground');
  steps(g, 30);
  // gravity scale in the air
  hold(g, 'p1', 'jump'); steps(g, 6); hold(g, 'p1'); steps(g, 4);
  hold(g, 'p1', 'special'); g.step(); hold(g, 'p1');
  assert.equal(f.action && f.action.name, 'neutralSpecial');
  const v0 = f.vy; g.step();
  assert.ok(Math.abs((f.vy - v0) - f.stats.gravity * 0.5) < 1e-9, `vy += gravity × 0.5 (Δ ${f.vy - v0})`);
  steps(g, 120);
  // add mode on the ground: vx grows by 2·facing per frame (no friction while set)
  f.vx = 0;
  hold(g, 'p1', 'special', 'down'); g.step(); hold(g, 'p1');
  const vx1 = f.vx; g.step(); const vx2 = f.vx;
  assert.equal(f.action.name, 'downSpecial');
  assert.ok(Math.abs(vx2 - vx1 - 2 * f.facing) < 1e-9, `add mode adds 2 per frame (${vx1} → ${vx2})`);
});

test('requires/cost → else, next chains, cost is paid', () => {
  const k = kit({
    neutralSpecial: { name: 'Big', category: 'special', duration: 10, cost: { charge: 30 }, else: 'small', next: 'after' },
    small: { name: 'Small', category: 'special', duration: 10 },
    after: { name: 'After', category: 'special', duration: 8 },
  }, { def: { resources: { charge: { max: 100, start: 40 } } } });
  const g = duel(k, k, { x1: -300, x2: 300 });
  const f = g.fighter('p1');
  const names = [];
  const press = () => { hold(g, 'p1', 'special'); g.step(); hold(g, 'p1'); for (let i = 0; i < 40; i++) { for (const e of moveEvents(g, 'p1')) names.push(e.name); g.step(); } for (const e of moveEvents(g, 'p1')) names.push(e.name); };
  press();
  assert.deepEqual(names, ['neutralSpecial', 'after'], 'paid, then next');
  assert.equal(f.res[0], 10, 'cost 30 spent from 40');
  names.length = 0;
  press();
  assert.deepEqual(names, ['small'], 'cannot pay → else');
});

test('oncePerAirtime and helpless', () => {
  const k = kit({
    sideSpecial: { name: 'Dash', category: 'special', duration: 12, oncePerAirtime: true },
    upSpecial: { name: 'Rise', category: 'recovery', duration: 20, velocity: [{ start: 1, end: 10, vy: -8 }] },
  });
  const g = duel(k, k, { x1: -300, x2: 300 });
  const f = g.fighter('p1');
  hold(g, 'p1', 'jump'); steps(g, 6); hold(g, 'p1'); steps(g, 2);
  let starts = 0;
  for (let i = 0; i < 2; i++) {
    hold(g, 'p1', 'special', 'right'); g.step(); hold(g, 'p1');
    starts += moveEvents(g, 'p1').filter((e) => e.name === 'sideSpecial').length;
    for (let j = 0; j < 14; j++) { g.step(); starts += moveEvents(g, 'p1').filter((e) => e.name === 'sideSpecial').length; }
  }
  assert.equal(starts, 1, 'second air side special ignored');
  hold(g, 'p1', 'special', 'up'); g.step(); hold(g, 'p1'); steps(g, 20);
  assert.equal(f.state, 'helpless', 'up special routed move ends helpless in the air');
});

test('rehit keys hit once per rehit period; goto loops at most 8 times', () => {
  const k = kit({
    jab: { name: 'Drill', category: 'jab', duration: 20, hitboxes: [strike({ start: 2, end: 13, damage: 1, rehit: 4, knockback: 0, growth: 0, setKnockback: 0 })] },
    side: { name: 'Loop', category: 'tilt', duration: 10, timeline: [{ at: 6, goto: 2 }] },
  });
  const g = duel(k, k, { rules: { governor: false }, x1: -30, x2: 30 });
  hold(g, 'p1', 'attack'); g.step(); hold(g, 'p1');
  let hits = 0;
  for (let i = 0; i < 30; i++) { g.step(); hits += g.drainEvents().filter((e) => e.type === 'hit' && e.attacker === 'p1').length; }
  assert.equal(hits, 3, 'frames 2-13 with rehit 4 → keys 0,1,2');
  const g2 = duel(k, k, { x1: -300, x2: 300 });
  const { n, inst } = actionLength(g2, 'p1', ['attack', 'right']);
  assert.equal(inst.loops, 8);
  assert.equal(n, 10 + 1 + 8 * 5, 'each goto replays frames 2..6');
});

test('generic fallback: triggers without a move resolve to the generic action', () => {
  const k = kit({});
  delete k.moves.grab; delete k.moves.taunt; delete k.moves.fthrow;
  const g = duel(k, k);
  const f = g.fighter('p1');
  const r = resolveMove(f, 'grab');
  assert.ok(r && r.def.generic && r.def.category === 'grab' && r.def.hitboxes[0].kind === 'grab');
  const t = genericAction('fthrow');
  assert.equal(t.timeline[0].action, 'release');
  assert.equal(t.timeline[0].args.hit.damage, 8);
  assert.equal(genericAction('nope'), null);
  assert.ok(Object.isFrozen(genericAction('taunt')));
  hold(g, 'p1', 'taunt'); g.step();
  assert.equal(f.state, 'taunt');
});
