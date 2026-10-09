// Grabs, throws, pummels and counters (WP-F, spec §3.6.2-3.6.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kit, duel, hold, steps } from './helpers.js';

const strike = (o = {}) => ({ x: 30, y: -45, r: 24, damage: 5, angle: 45, knockback: 10, growth: 30, ...o });
const GRAB_KIT = () => kit({}); // IR always carries the generic grab / pummel / throws

/** p1 grabs p2 (generic grab, startup 7). Returns the frame of the 'grab' event. */
function grab(game) {
  hold(game, 'p1', 'shield', 'attack'); game.step(); hold(game, 'p1');
  for (let i = 0; i < 20; i++) {
    game.step();
    const e = game.drainEvents().find((x) => x.type === 'grab');
    if (e) return game.frame;
  }
  return null;
}

test('grab connects; hold time = clamp(30 + 0.35·p, 30, 120)', () => {
  for (const governor of [false, true]) {
    const g = duel(GRAB_KIT(), GRAB_KIT(), { rules: { governor }, x1: -40, x2: 40 });
    const [a, t] = g.fighters;
    t.percent = 100;
    assert.ok(grab(g), 'grab event');
    assert.equal(a.state, 'grabbing');
    assert.equal(t.state, 'grabbed');
    assert.equal(a.grab.max, 65);
    assert.equal(a.action, null);
  }
});

test('mashing escapes at the expected frame; release pushes both apart with immunity', () => {
  for (const governor of [false, true]) {
    // No mashing: the 30-frame hold (0%) times out after exactly 30 ticks.
    let g = duel(GRAB_KIT(), GRAB_KIT(), { rules: { governor }, x1: -40, x2: 40 });
    let G = grab(g);
    const [a, t] = g.fighters;
    let k = 0;
    while (t.grab && t.grab.role === 'grabbed' && k < 200) { g.step(); k++; }
    assert.equal(k, 30, `timed release after 30 frames (governor ${governor})`);
    assert.equal(a.state, 'grabbing'); // pushback phase
    assert.equal(a.grab.role, 'release');
    assert.equal(a.vx, -a.facing * 6);
    assert.equal(t.vx, a.facing * 6);
    steps(g, 12);
    assert.equal(a.grab, null);
    assert.equal(t.grab, null);
    assert.ok(a.state === 'idle' && t.state === 'idle', `${a.state}/${t.state}`);

    // Mash every other frame: k ticks + 3 per press ≥ 30 → k + 3·ceil(k/2) ≥ 30 → k = 12.
    g = duel(GRAB_KIT(), GRAB_KIT(), { rules: { governor }, x1: -40, x2: 40 });
    G = grab(g);
    const [, t2] = g.fighters;
    k = 0;
    while (t2.grab && t2.grab.role === 'grabbed' && k < 200) {
      k++;
      hold(g, 'p2', ...(k % 2 === 1 ? ['attack'] : []));
      g.step();
    }
    assert.ok(G);
    assert.equal(k, 12, `mash-out frame (governor ${governor})`);
    // 10 frames of grab immunity after the release (pushback lasts 12, so test directly).
    assert.ok(t2.grabImmuneUntil > g.frame);
  }
});

test('throws: direction → throw; release is a throw-tier hit that launches the victim', () => {
  for (const governor of [false, true]) {
    const g = duel(GRAB_KIT(), GRAB_KIT(), { rules: { governor }, x1: -40, x2: 40 });
    const [a, t] = g.fighters;
    grab(g);
    hold(g, 'p1', 'right'); g.step(); hold(g, 'p1');
    assert.equal(a.action && a.action.name, 'fthrow');
    assert.equal(a.state, 'grabbing');
    let hit = null, thr = null;
    for (let i = 0; i < 20 && !hit; i++) {
      g.step();
      const ev = g.drainEvents();
      hit = hit || ev.find((e) => e.type === 'hit');
      thr = thr || ev.find((e) => e.type === 'throw');
    }
    assert.ok(thr && hit, 'throw + hit events');
    assert.equal(hit.damage, 8, 'generic fthrow damage');
    assert.equal(t.state, 'hitstun');
    assert.equal(a.state, 'attack', 'thrower finishes the throw animation');
    assert.equal(a.grab, null);
    assert.equal(t.grab, null);
    assert.ok(t.kx > 0, 'launched forward');
  }
});

test('pummel damages without releasing, at most once per 14 frames', () => {
  const g = duel(GRAB_KIT(), GRAB_KIT(), { rules: { governor: false }, x1: -40, x2: 40 });
  const [a, t] = g.fighters;
  t.percent = 200; // long hold (100 frames)
  grab(g);
  let hits = 0;
  for (let i = 0; i < 40; i++) {
    hold(g, 'p1', ...(i % 2 === 0 ? ['attack'] : []));
    g.step();
    hits += g.drainEvents().filter((e) => e.type === 'hit').length;
  }
  assert.equal(t.state, 'grabbed');
  assert.equal(a.state, 'grabbing');
  assert.ok(hits >= 2 && hits <= 3, `pummels in 40 frames: ${hits}`);
  assert.equal(t.percent, 200 + 1.5 * hits);
});

test('grab-vs-grab techs; a strike beats a grab in the same frame; third-party hit releases', () => {
  // Both grab on the same frame.
  let g = duel(GRAB_KIT(), GRAB_KIT(), { x1: -40, x2: 40 });
  hold(g, 'p1', 'shield', 'attack'); hold(g, 'p2', 'shield', 'attack'); g.step(); hold(g, 'p1'); hold(g, 'p2');
  let tech = null;
  for (let i = 0; i < 12; i++) { g.step(); tech = tech || g.drainEvents().find((e) => e.type === 'grabtech'); }
  assert.ok(tech, 'grabtech event');
  assert.ok(g.fighters.every((f) => f.state !== 'grabbed' && f.state !== 'grabbing'));

  // p2's jab (startup 6) lands on the frame p1's grab (startup 7) connects → strike wins.
  const jabKit = kit({ jab: { name: 'J', category: 'jab', duration: 16, hitboxes: [strike({ start: 7, end: 8, x: 40 })] } });
  g = duel(GRAB_KIT(), jabKit, { x1: -40, x2: 40 });
  hold(g, 'p1', 'shield', 'attack'); hold(g, 'p2', 'attack'); g.step(); hold(g, 'p1'); hold(g, 'p2');
  let grabbed = false;
  for (let i = 0; i < 12; i++) { g.step(); if (g.drainEvents().some((e) => e.type === 'grab')) grabbed = true; }
  assert.equal(grabbed, false);
  assert.equal(g.fighters[0].state === 'hitstun' || g.fighters[0].lastHitBy === 'p2', true);
});

test('counter: cancels a strike, attacker hitlag 20, counter-then damage ≤ 15', () => {
  const defender = kit({
    downSpecial: { name: 'Bristle', category: 'counter', duration: 40, counter: { from: 4, to: 20, then: 'bristleHit', mul: 1.3 } },
    bristleHit: { name: 'Bristle!', category: 'counter', duration: 30, hitboxes: [strike({ start: 2, end: 5, x: 0, y: -40, r: 70, damage: 8, counterScale: true })] },
  });
  const attacker = kit({ jab: { name: 'Big', category: 'jab', duration: 30, hitboxes: [strike({ start: 8, end: 10, x: 40, damage: 20 })] } });
  for (const governor of [false, true]) {
    const g = duel(defender, attacker, { rules: { governor }, x1: -40, x2: 40 });
    const [d, a] = g.fighters;
    hold(g, 'p1', 'special', 'down'); hold(g, 'p2', 'attack'); g.step(); hold(g, 'p1'); hold(g, 'p2');
    let counter = null, back = null;
    for (let i = 0; i < 40; i++) {
      g.step();
      for (const e of g.drainEvents()) {
        if (e.type === 'counter') { counter = e; assert.equal(a.hitlag, 20, 'attacker frozen 20 frames'); }
        if (e.type === 'hit' && e.attacker === 'p1') back = back || e;
      }
    }
    assert.ok(counter, `counter fired (governor ${governor})`);
    assert.equal(d.percent > 0 && d.percent < 20, false, 'defender took nothing');
    assert.equal(d.percent, 0);
    assert.ok(back, 'counter-then hit landed');
    assert.ok(back.damage <= 15, `counter-then damage ${back.damage} ≤ 15`);
    if (!governor) assert.equal(back.damage, 15, 'max(8, 20 × 1.3) clamped to 15');
  }
});

test('counter fails (hit lands) when the intangibility budget is empty', () => {
  const defender = kit({
    downSpecial: { name: 'Bristle', category: 'counter', duration: 40, counter: { from: 4, to: 20, then: null, mul: 1.2 } },
  });
  const attacker = kit({ jab: { name: 'J', category: 'jab', duration: 30, hitboxes: [strike({ start: 8, end: 10, x: 40, damage: 5 })] } });
  const g = duel(defender, attacker, { rules: { governor: true }, x1: -40, x2: 40 });
  const d = g.fighters[0];
  while (g.gov.intangibleLeft(d) > 0) g.gov.intangibleRequest(d, 20); // reserve the whole budget
  // Let the reservation run past (reserved frames still count in the 300-frame window).
  steps(g, 60);
  hold(g, 'p1', 'special', 'down'); hold(g, 'p2', 'attack'); g.step(); hold(g, 'p1'); hold(g, 'p2');
  let counter = false, hit = false;
  for (let i = 0; i < 30; i++) { g.step(); for (const e of g.drainEvents()) { if (e.type === 'counter') counter = true; if (e.type === 'hit' && e.target === 'p1') hit = true; } }
  assert.equal(counter, false);
  assert.equal(hit, true);
});

test('timeline armor / intangible go through the Governor', () => {
  const k = kit({
    neutralSpecial: { name: 'Brace', category: 'special', duration: 30, timeline: [{ at: 2, armor: { frames: 20, threshold: 99 } }, { at: 2, intangible: 30 }] },
  });
  const g = duel(k, k, { x1: -300, x2: 300 });
  const f = g.fighters[0];
  hold(g, 'p1', 'special'); g.step(); hold(g, 'p1'); steps(g, 3);
  assert.equal(g.gov.armorAt(f), 12, 'armor threshold capped at 12');
  assert.equal(g.gov.intangibleGranted(f), true);
  assert.ok(g.gov.intangibleLeft(f) <= 45 - 20, 'grant ≤ 20 frames, charged to the budget');
});
