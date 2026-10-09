// WP-G: budgets, hp entities, pierce, clank, reflect/absorb, clash, beams, parts
// (relay), owner KO, clones, v1 legacy parity and the snapshot.
//   node --test test/entities/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../shared/sim/entities.js';
import * as hits from '../../shared/sim/hits.js';
import { ko } from '../../shared/sim/fighter.js';
import { endAction } from '../../shared/sim/actions.js';
import { validateCharacter } from '../../shared/balance/validate.js';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { Game } from '../../shared/sim/game.js';
import { loadRoster } from '../golden/harness.js';
import { newGame, ghost, steps, forceAction, live, stage } from './helpers.js';

const G = stage.ground;
const box = (o) => ({ shape: 'circle', x: 0, y: -40, r: 30, damage: 4, angle: 45, knockback: 20, growth: 40, ...o });

/** p1 at x=0 facing right, p2 at x=200 facing left, both grounded. */
function duel(rules, n) {
  const game = newGame(rules, n);
  const [a, b] = game.fighters;
  a.x = 0; a.facing = 1;
  b.x = 200; b.facing = -1;
  return { game, a, b, c: game.fighters[2] };
}

test('budget (Governor): ≤ 4 spawns per 60 f, maxAlive per template, beams and clones replace', () => {
  const { game, a, b } = duel();
  ghost(a); ghost(b);
  const got = [];
  for (let i = 0; i < 10; i++) got.push(E.spawn(a, 'dart', { x: 0, y: -300 - i * 20 }));
  assert.equal(got.filter(Boolean).length, 4, 'spawn rate');
  steps(game, 61);
  for (let i = 0; i < 4; i++) { E.spawn(a, 'glob', { x: 0, y: -200, vx: 0, vy: -1 }); }
  assert.equal(live(game, 'glob').length, 3, 'glob maxAlive 3 (oldest expired)');
  steps(game, 61);
  const l1 = E.spawn(a, 'laser', {});
  const l2 = E.spawn(a, 'laser', {});
  assert.ok(l1.dead && !l2.dead, 'second beam replaces the first');
  assert.equal(game.entities.filter((e) => e.owner === a.id && E.alive(e) && e.kind === 'beam').length, 1);
  steps(game, 61);
  const c1 = E.spawn(a, 'gloopling', { x: -40 });
  const c2 = E.spawn(a, 'gloopling', { x: -60 });
  assert.ok(c1.dead && !c2.dead, 'one clone');
  for (const e of game.entities.filter((x) => x.owner === a.id && E.alive(x))) assert.ok(e.kind);
  assert.ok(game.entities.filter((x) => x.owner === a.id && E.alive(x)).length <= 8);
});

test('budget (ungoverned): per-template maxAlive and one beam still hold', () => {
  const { game, a, b } = duel({ governor: false });
  ghost(a); ghost(b);
  for (let i = 0; i < 6; i++) E.spawn(a, 'glob', { x: 0, y: -200, vx: 0, vy: -1 });
  assert.equal(live(game, 'glob').length, 3);
  E.spawn(a, 'laser', {}); E.spawn(a, 'laser', {});
  assert.equal(live(game, 'laser').length, 1);
});

test('hp entity: strikes take hp (once per box group), death → onDeath + 300-frame template cooldown', () => {
  const { game, a, b } = duel();
  const golem = E.spawn(a, 'golem', { x: 140, y: 0 });
  golem.def = { ...golem.def, motion: { type: 'stationary' } }; // hold still
  forceAction(b, [box({ x: 60, y: -14, r: 20, damage: 4 })]);
  hits.resolve(game);
  assert.equal(golem.hp, 6);
  hits.resolve(game);
  assert.equal(golem.hp, 6, 'same action, same group: no rehit');
  forceAction(b, [box({ x: 60, y: -14, r: 20, damage: 7 })]);
  hits.resolve(game);
  assert.ok(golem.dead);
  const ev = game.drainEvents();
  assert.ok(ev.some((v) => v.type === 'ehit' && v.i === golem.id));
  assert.ok(ev.some((v) => v.type === 'despawn' && v.i === golem.id && v.reason === 'death'));
  assert.equal(a.percent, 0, 'no damage leaked to the owner');
  steps(game, 61);
  assert.equal(E.spawn(a, 'golem', { x: -100 }), null, 'template on cooldown');
  steps(game, 300);
  assert.ok(E.spawn(a, 'golem', { x: -100 }), 'cooldown over');
});

test('pierce: a pierce-1 projectile hits two targets, a plain one only one', () => {
  const { game, a, b, c } = duel({}, 3);
  b.x = 100; c.x = 104; c.facing = -1;
  const d = E.spawn(a, 'drill', { x: 102, y: -40 });
  hits.resolve(game);
  assert.ok(b.percent > 0 && c.percent > 0, `both hit (${b.percent}, ${c.percent})`);
  assert.ok(d.dead, 'spent after maxHits + pierce');
  const { game: g2, a: a2, b: b2, c: c2 } = duel({}, 3);
  b2.x = 100; c2.x = 104;
  const one = E.spawn(a2, 'ball', { x: 102, y: -40, vx: 0, vy: 0 });
  hits.resolve(g2);
  assert.equal([b2.percent > 0, c2.percent > 0].filter(Boolean).length, 1);
  assert.ok(one.dead);
});

test('clank: an enemy strike destroys a no-hp entity unless clank:false', () => {
  const { game, a, b } = duel();
  ghost(a);
  const dart = E.spawn(a, 'dart', { x: 140, y: -40 });
  const tough = E.spawn(a, 'tough', { x: 140, y: -40 });
  forceAction(b, [box({ x: 60, y: -40, r: 20 })]);
  hits.resolve(game);
  assert.ok(dart.dead);
  assert.ok(!tough.dead);
  assert.ok(game.drainEvents().some((v) => v.type === 'clank'));
});

test('reflect: flips owner and velocity (×1.1, capped), damage ×1.25 on the old owner', () => {
  const { game, a, b } = duel();
  const dart = E.spawn(a, 'dart', { x: 140, y: -40 });
  const vx0 = dart.vx;
  forceAction(b, [box({ x: 60, y: -40, r: 20, kind: 'reflect', damage: 0 })]);
  hits.resolve(game);
  assert.equal(dart.owner, b.id);
  assert.ok(dart.reflected);
  assert.ok(Math.abs(dart.vx - -vx0 * 1.1) < 1e-9);
  assert.ok(game.drainEvents().some((v) => v.type === 'reflect' && v.i === dart.id));
  b.state = 'idle'; b.action = null;
  let hitEv = null;
  for (let i = 0; i < 60 && !hitEv; i++) { game.step(); hitEv = game.drainEvents().find((v) => v.type === 'hit'); }
  assert.ok(hitEv && hitEv.attacker === b.id && hitEv.target === a.id, 'hits its old owner');
  assert.ok(Math.abs(hitEv.damage - 5 * 1.25) < 0.051, `damage ${hitEv.damage}`);
});

test('reflect works on v1 projectiles too (and never on reflectable:false / non-projectiles)', () => {
  const { game, a, b } = duel();
  a.action = { def: { effect: 'fire' }, name: 'neutralSpecial' };
  const p = E.spawnProjectile(a, { x: 140, y: -40, vx: 6, vy: 0, gravity: 0, life: 60, r: 10, damage: 5, angle: 40, knockback: 10, growth: 40 });
  a.action = null;
  const golem = E.spawn(a, 'golem', { x: 140, y: 0 });
  forceAction(b, [box({ x: 60, y: -30, r: 40, kind: 'reflect', damage: 0 })]);
  hits.resolve(game);
  assert.equal(p.owner, b.id);
  assert.equal(p.vx, -6.6000000000000005);
  assert.equal(golem.owner, a.id, 'minions are not reflected');
});

test('absorb: destroys an absorbable projectile and emits absorb', () => {
  const { game, a, b } = duel();
  const dart = E.spawn(a, 'dart', { x: 140, y: -40 });
  forceAction(b, [box({ x: 60, y: -40, r: 20, kind: 'absorb', damage: 0 })]);
  hits.resolve(game);
  assert.ok(dart.dead);
  assert.equal(b.percent, 0);
  assert.ok(game.drainEvents().some((v) => v.type === 'absorb' && v.i === dart.id && v.id === b.id));
});

test('clash: clash:true entities of different owners destroy each other; same owner never', () => {
  const { game, a, b } = duel();
  ghost(a); ghost(b);
  const x = E.spawn(a, 'clasher', { x: 60, y: -200 });
  const y = E.spawn(b, 'clasher', { x: 60, y: -200 });
  const z = E.spawn(a, 'clasher', { x: 40, y: -200 });
  steps(game, 10);
  assert.ok(x.dead && y.dead);
  assert.ok(!z.dead);
});

test('entity vs hp entity: an enemy projectile damages a minion and is spent', () => {
  const { game, a, b } = duel();
  ghost(a); ghost(b);
  const golem = E.spawn(a, 'golem', { x: 100, y: 0 });
  golem.def = { ...golem.def, motion: { type: 'stationary' } };
  const ball = E.spawn(b, 'ball', { x: 100, y: -14, vx: 0, vy: 0 });
  hits.resolve(game);
  assert.equal(golem.hp, 5);
  assert.ok(ball.dead);
});

test('beam: despawns when its owner is hit (unless armored) and when its bound move ends', () => {
  const { game, a, b } = duel();
  const beam = E.spawn(a, 'laser', {});
  forceAction(b, [box({ x: 200, y: -40, r: 30, damage: 6 })]);
  hits.resolve(game);
  assert.equal(a.state, 'hitstun');
  steps(game, 1);
  assert.ok(beam.dead);
  // bindToMove
  const { game: g2, a: a2, b: b2 } = duel();
  ghost(b2);
  const inst = forceAction(a2, [], { name: 'ion' });
  const bound = E.spawn(a2, 'laser', { bindToMove: true });
  assert.ok(bound.bindToMove);
  endAction(a2);
  assert.ok(bound.dead, 'despawned with the action');
  assert.ok(g2.drainEvents().some((v) => v.type === 'despawn' && v.i === bound.id && v.reason === 'unbound'));
  // interrupted (no endAction): dropped on the next update
  forceAction(a2, [], { name: 'ion2' });
  const b3 = E.spawn(a2, 'laser', { bindToMove: true });
  a2.action = null; a2.state = 'idle';
  steps(g2, 1);
  assert.ok(b3.dead && inst);
});

test('parts: relay 1 = full hit on the core; relay 0.5 = half damage, no knockback, part hp', () => {
  const { game, a, b } = duel();
  const arm = E.spawn(a, 'arm', {});
  const at = arm.x;
  b.x = at + 90;
  forceAction(b, [box({ x: 70, y: -40, r: 22, damage: 8 })]); // reaches the arm only
  hits.resolve(game);
  assert.ok(a.percent > 7.9 && a.state === 'hitstun', `relay 1: ${a.percent} ${a.state}`);

  const { game: g2, a: a2, b: b2 } = duel();
  const shell = E.spawn(a2, 'shell', {});
  b2.x = shell.x + 90;
  forceAction(b2, [box({ x: 70, y: -40, r: 22, damage: 8 })]);
  hits.resolve(g2);
  assert.ok(Math.abs(a2.percent - 4) < 1e-6, `relay 0.5: ${a2.percent}`);
  assert.notEqual(a2.state, 'hitstun', 'no knockback/hitstun');
  assert.equal(shell.hp, 12, 'the part pays the full damage in hp');
});

test('parts: relay 0.5 with the mitigation budget exhausted relays 1.0 (acceptance)', () => {
  const { game, a, b } = duel();
  const shell = E.spawn(a, 'shell', {});
  game.gov.state(a).mit.stock = 45; // per-stock mitigation spent
  b.x = shell.x + 90;
  forceAction(b, [box({ x: 70, y: -40, r: 22, damage: 8 })]);
  hits.resolve(game);
  assert.ok(Math.abs(a.percent - 8) < 1e-6, `full damage: ${a.percent}`);
  assert.equal(a.state, 'hitstun', 'full knockback');
});

test('parts: hp 0 → despawn and template cooldown; an enemy projectile also relays', () => {
  const { game, a, b } = duel();
  const shell = E.spawn(a, 'shell', {});
  const ball = E.spawn(b, 'ball', { worldX: shell.x, worldY: shell.y, vx: 0, vy: 0 });
  assert.ok(ball && Math.abs(ball.x - shell.x) < 1e-9);
  hits.resolve(game);
  assert.ok(a.percent > 0, 'relayed to the core');
  assert.equal(shell.hp, 15);
  shell.hp = 1;
  b.x = shell.x; b.facing = 1;
  forceAction(b, [box({ x: 0, y: shell.y - b.y, r: 10, damage: 3 })]);
  hits.resolve(game);
  assert.ok(shell.dead);
  steps(game, 61);
  assert.equal(E.spawn(a, 'shell', {}), null, 'cooldown');
});

test('owner KO: minions, clones, zones, beams and parts despawn; projectiles and traps persist', () => {
  const { game, a, b } = duel({ governor: false });
  ghost(b);
  const keep = [E.spawn(a, 'ball', { x: 0, y: -300, vx: 0, vy: -2 }), E.spawn(a, 'stake', { x: 60 })];
  const gone = [E.spawn(a, 'golem', { x: -60 }), E.spawn(a, 'laser', {}), E.spawn(a, 'bulb', { x: 0, y: -100 }), E.spawn(a, 'shell', {}), E.spawn(a, 'gloopling', { x: -40 })];
  ko(a, 'left');
  for (const e of gone) assert.ok(e.dead, `${e.name} despawned`);
  for (const e of keep) assert.ok(!e.dead, `${e.name} persists`);
});

test('clones: hits deal ×0.5 damage (clone tier), take knockback into hp, die at 0; no clone spawning', () => {
  for (const governor of [true, false]) {
    const { game, a, b } = duel({ governor });
    const cl = E.spawn(a, 'gloopling', { x: 100 });
    const m = cl.minor;
    assert.equal(m.bodyScale, 0.6);
    assert.equal(E.spawn(m, 'gloopling', {}), null, 'clones cannot spawn clones');
    const dart = E.spawn(m, 'dart', { x: 0, y: -300 });
    assert.equal(dart.owner, a.id, "a clone's spawns belong to (and count against) the owner");
    forceAction(m, [box({ x: 160, y: -30, r: 30, damage: 10 })]); // × bodyScale 0.6
    hits.resolve(game);
    assert.ok(Math.abs(b.percent - 5) < 1e-6, `gov ${governor}: clone hit ${b.percent}`);
    const hit = game.drainEvents().find((v) => v.type === 'hit');
    assert.equal(hit.attacker, a.id, 'credited to the owner');
  }
  const { game, a, b } = duel();
  const cl = E.spawn(a, 'gloopling', { x: 150 });
  forceAction(b, [box({ x: 50, y: -20, r: 30, damage: 8 })]);
  hits.resolve(game);
  assert.equal(cl.minor.state, 'hitstun', 'clones take knockback');
  steps(game, 1);
  assert.ok(Math.abs(cl.hp - 4) < 1e-6, `hp ${cl.hp}`);
  b.x = cl.x + 50; b.facing = -1;
  forceAction(b, [box({ x: 50, y: -20, r: 40, damage: 6 })]);
  cl.minor.invuln = 0; cl.minor.hitlag = 0;
  hits.resolve(game);
  steps(game, 1);
  assert.ok(cl.dead, 'dies at hp 0');
});

test('legacy: an IR legacy.v1 entity spawns the exact v1 record', async () => {
  const roster = await loadRoster(validateCharacter);
  const ember = roster.ember.character;
  const slot = Object.keys(ember.moves).find((k) => ember.moves[k].projectiles && ember.moves[k].projectiles.length);
  const p = ember.moves[slot].projectiles[0];
  const ir = buildIR(normalize(ember).draft);
  const name = `${slot}#p0`;
  const entry = ir.moves[slot].timeline.find((t) => t.action === 'spawn' && t.args.entity === name);
  const run = (useIR) => {
    const char = useIR ? { ...ember, entities: ir.entities } : ember;
    const game = new Game({ stage, rules: { countdown: false }, players: [{ id: 'a', name: 'A', character: char }, { id: 'b', name: 'B', character: char }] });
    const f = game.fighters[0];
    f.action = { def: ember.moves[slot], name: slot };
    const e = useIR ? E.spawn(f, name, entry.args) : E.spawnProjectile(f, p);
    const out = [JSON.stringify(e), JSON.stringify(game.drainEvents())];
    for (let i = 0; i < 40; i++) { E.update(game); out.push(JSON.stringify(game.entities)); }
    out.push(JSON.stringify(game.projectilesV1()));
    return out;
  };
  assert.deepEqual(run(true), run(false));
});

test('snapshot: v2 entities in `entities`, only v1 records in `projectiles`', () => {
  const { game, a } = duel();
  a.action = { def: { effect: 'fire' }, name: 'x' };
  E.spawnProjectile(a, { x: 0, y: -300, vx: 0, vy: -1, gravity: 0, life: 60, r: 8, damage: 1, angle: 0, knockback: 0, growth: 0 });
  a.action = null;
  E.spawn(a, 'laser', {});
  E.spawn(a, 'gloopling', { x: -40 });
  const s = game.snapshot();
  assert.equal(s.projectiles.length, 1);
  assert.equal(s.entities.length, 3);
  const beam = s.entities.find((e) => e.k === 4);
  assert.equal(beam.n, 200);
  const clone = s.entities.find((e) => e.k === 5);
  assert.ok(Array.isArray(clone.c) && clone.h === 12);
});

test('determinism: a busy scripted scenario replays identically', () => {
  const run = () => {
    const { game, a, b } = duel();
    const out = [];
    const plan = { 5: ['seeker', a], 9: ['golem', b], 20: ['gloopling', a], 31: ['bouncer', b], 44: ['laser', b], 70: ['wave', a], 90: ['rang', b], 130: ['shell', a] };
    for (let i = 0; i < 300; i++) {
      if (plan[i]) E.spawn(plan[i][1], plan[i][0], { x: 30, y: -40, vx: 5, vy: -3 });
      a.pendingInput = { right: i % 50 < 20, attack: i % 37 === 0, jump: i % 90 === 0 };
      b.pendingInput = { left: i % 60 < 25, special: i % 41 === 0 };
      game.step();
      out.push(JSON.stringify(game.snapshot().entities), JSON.stringify(game.drainEvents()));
    }
    return out;
  };
  assert.deepEqual(run(), run());
});

test('v2 example kits: Gertie, Gloop and Nimbus entities run without errors', async () => {
  for (const id of ['gertie', 'gloop', 'nimbus']) {
    const def = (await import(`../fixtures/${id}/character.js`)).default;
    const ir = buildIR(normalize(def).draft);
    const game = new Game({ stage, rules: { countdown: false }, players: [{ id: 'a', name: 'A', character: ir }, { id: 'b', name: 'B', character: ir }] });
    const [a, b] = game.fighters;
    a.x = -100; b.x = 100;
    for (const name of Object.keys(ir.entities)) { E.spawn(a, name, { x: 60, y: -40, vx: 4, vy: -2 }); E.spawn(b, name, { x: 60, y: -40, vx: 4, vy: -2 }); steps(game, 20); }
    steps(game, 200);
    for (const f of game.fighters) assert.ok(Number.isFinite(f.x) && Number.isFinite(f.percent));
    assert.ok(G);
  }
});
