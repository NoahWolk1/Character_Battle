// Integration fixes found by the archetype suites: SlotFns route moves, entity vars
// are declarable, relay-1 parts default to permanent, rect entities collide with
// their real extent, and think/every spawns aren't credited to the owner's move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCharacter } from '../../shared/balance/validate.js';
import { defineCharacter } from '../../shared/char/api.js';
import { Game } from '../../shared/sim/game.js';
import { stage, live, steps } from './helpers.js';

const hit = { damage: 3, angle: 45, knockback: 10, growth: 10 };

function build() {
  const def = defineCharacter({
    id: 'fixes', name: 'Fixes',
    vars: { alt: false },
    moves: {
      jab: { duration: 20, hitboxes: [{ start: 3, end: 5, x: 30, y: -40, r: 12, ...hit }] },
      poke: { duration: 22, hitboxes: [{ start: 3, end: 5, x: 30, y: -40, r: 12, ...hit }] },
      brick: { duration: 20, timeline: [{ at: 2, spawn: 'brick', x: 0, y: -150 }] },
      tower: { duration: 20, timeline: [{ at: 2, spawn: 'turret', x: 0, y: 0 }] },
    },
    slots: { jab: (view) => (view.vars.alt ? 'poke' : 'jab'), neutralSpecial: 'brick', downSpecial: 'tower' },
    entities: {
      brick: { kind: 'projectile', shape: { shape: 'rect', x: 0, y: 0, w: 20, h: 40 }, life: 200, collide: 'stick', motion: { type: 'ballistic', gravity: 0.6 } },
      wing: { kind: 'part', shape: { r: 16 }, hurtbox: [{ r: 16 }], anchor: { x: -30, y: -60 } },
      turret: { kind: 'minion', life: 400, shape: { r: 12 }, vars: { shots: 0 }, motion: { type: 'stationary' },
        every: { frames: 30, spawn: 'pellet', vx: 6 },
        think(view, e, api) { if (e.age % 30 === 1) api.evars.set('shots', e.vars.shots + 1); } },
      pellet: { kind: 'projectile', shape: { r: 5 }, life: 40, collide: 'pass', motion: { type: 'linear', speed: 6 }, hitboxes: [{ r: 6, ...hit }] },
    },
  });
  const r = validateCharacter(def, { expectedId: 'fixes' });
  assert.ok(r.ok, r.errors.map(String).join('; '));
  return r.character;
}

function newGame() {
  const c = build();
  const game = new Game({ stage, rules: { countdown: false, stocks: 3, scriptTiming: false }, players: [{ id: 'p1', name: 'A', character: c }, { id: 'p2', name: 'B', character: c }] });
  game.fighters[1].x = 400;
  game.step(); game.drainEvents();
  return game;
}

function press(game, input) {
  game.setInput('p1', input); game.step();
  game.setInput('p1', {}); return game.drainEvents();
}

test('SlotFns route triggers (forms[f].slotFns)', () => {
  const game = newGame();
  const f = game.fighters[0];
  let ev = press(game, { attack: true });
  assert.equal(ev.find((e) => e.type === 'move').name, 'jab');
  steps(game, 40);
  f.vars.alt = true;
  ev = press(game, { attack: true });
  assert.equal(ev.find((e) => e.type === 'move').name, 'poke');
});

test('entity vars are declarable and api.evars.set updates them', () => {
  const c = build();
  assert.deepEqual({ ...c.entities.turret.vars }, { shots: 0 });
  const game = newGame();
  press(game, { down: true, special: true });
  steps(game, 70);
  const t = live(game, 'turret')[0];
  assert.ok(t, 'turret spawned');
  assert.ok(t.vars.shots >= 2, `shots ${t.vars.shots}`);
});

test('a relay-1 part with no life is permanent', () => {
  const c = build();
  assert.ok(c.entities.wing.life >= 1e9);
});

test('rect entities stick on the ground by their bottom edge, not their center', () => {
  const game = newGame();
  press(game, { special: true });
  let b;
  steps(game, 80, () => { b = live(game, 'brick')[0] || b; });
  assert.ok(b && b.stuck, 'brick landed');
  assert.ok(Math.abs(b.y - (stage.ground.y - 20)) <= 2, `brick center y ${b.y} (expected ≈ ${stage.ground.y - 20})`);
});

test('every/think spawns are not credited to the move the owner is doing', () => {
  const game = newGame();
  press(game, { down: true, special: true });
  steps(game, 25);
  press(game, { attack: true }); // owner is in jab when the turret fires
  steps(game, 40);
  const pellets = game.entities.filter((e) => e.name === 'pellet');
  assert.ok(pellets.length > 0, 'turret fired');
  for (const p of pellets) assert.notEqual(p.slot, 'jab');
});
