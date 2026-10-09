// WP-G: every motion type and collide mode, as deterministic trajectory tests.
//   node --test test/entities/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../shared/sim/entities.js';
import { collider } from '../../shared/sim/hurtbox.js';
import { newGame, ghost, steps, live, stage } from './helpers.js';

const G = stage.ground;

/** Spawns `name` from p1 (both fighters untouchable) and records [x, y] for n frames. */
function trajectory(name, opts = {}, n = 60, setup) {
  const game = newGame();
  const [a, b] = game.fighters;
  ghost(a); ghost(b);
  if (setup) setup(game, a, b);
  const e = E.spawn(a, name, opts);
  assert.ok(e, `${name} spawned`);
  const path = [];
  const events = [];
  for (let i = 0; i < n; i++) {
    game.step();
    events.push(...game.drainEvents());
    path.push(e.dead ? null : [Math.round(e.x * 1000) / 1000, Math.round(e.y * 1000) / 1000]);
  }
  return { game, e, a, b, path, events };
}

function deterministic(name, opts, n, setup) {
  const r1 = trajectory(name, opts, n, setup);
  const r2 = trajectory(name, opts, n, setup);
  assert.deepEqual(r1.path, r2.path, `${name} trajectory is deterministic`);
  return r1;
}

test('ballistic: v += gravity each frame, dies on the main ground (fizzle)', () => {
  const { path, e, a, events } = deterministic('ball', { x: 0, y: -60, vx: 3, vy: -6 }, 80);
  const [x1, y1] = path[0], [x2, y2] = path[1], [x3, y3] = path[2];
  assert.ok(Math.abs((x2 - x1) - 3 * a.facing) < 1e-9, 'constant vx');
  assert.ok(Math.abs((y3 - y2) - (y2 - y1) - 0.5) < 1e-6, 'vy grows by gravity 0.5');
  assert.ok(e.dead, 'hit the ground');
  assert.ok(events.some((v) => v.type === 'fizzle' && v.i === e.id));
});

test('linear: accelerates along its heading up to maxSpeed', () => {
  const { path } = deterministic('dart', { x: 0, y: -60 }, 40);
  const v = (i) => Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  assert.ok(Math.abs(v(0) - 5) < 1e-9, `first step ${v(0)}`);
  assert.ok(v(1) > v(0));
  assert.ok(Math.abs(v(30) - 10) < 1e-9, `capped at maxSpeed: ${v(30)}`);
  assert.ok(path.every((p) => Math.abs(p[1] - path[0][1]) < 1e-9), 'straight line');
});

test('homing: turns toward the nearest enemy by at most turn (≤ 0.12 rad/f) after delay', () => {
  const setup = (game, a, b) => { b.x = 0; b.y = -300; };
  const { path, b } = deterministic('seeker', { x: 0, y: -40, vx: 6, vy: 0 }, 50, setup);
  const head = (i) => Math.atan2(path[i + 1][1] - path[i][1], path[i + 1][0] - path[i][0]);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(head(i)) < 1e-9, 'flies straight during delay');
  for (let i = 4; i < 30; i++) {
    const d = Math.abs(Math.atan2(Math.sin(head(i + 1) - head(i)), Math.cos(head(i + 1) - head(i))));
    assert.ok(d <= 0.12 + 0.04 + 1e-9, `turn ${d.toFixed(3)} at ${i}`); // turn cap + wobble amplitude
  }
  const d0 = Math.hypot(path[0][0] - b.x, path[0][1] - (b.y - 46));
  const dMin = Math.min(...path.filter(Boolean).map((p) => Math.hypot(p[0] - b.x, p[1] - (b.y - collider(b).h / 2))));
  assert.ok(dMin < d0 / 3, `closes in on the target (${d0.toFixed(0)} → ${dMin.toFixed(0)})`);
});

test('orbit: stays at radius around the owner center', () => {
  const { path, a } = deterministic('moon', { x: 0, y: 0 }, 60);
  const c = { x: a.x, y: a.y - collider(a).h / 2 };
  for (const p of path) assert.ok(Math.abs(Math.hypot(p[0] - c.x, p[1] - c.y) - 70) < 0.5, 'radius (owner scale may breathe)');
  const ang = path.map((p) => Math.atan2(p[1] - c.y, p[0] - c.x));
  assert.ok(Math.abs(Math.atan2(Math.sin(ang[11] - ang[1]), Math.cos(ang[11] - ang[1])) - 1) < 0.02, 'angular speed 0.1 rad/f');
});

test('attached: follows the owner feet + mirrored anchor; beams take the owner facing', () => {
  const game = newGame();
  const [a, b] = game.fighters;
  ghost(a); ghost(b);
  const e = E.spawn(a, 'laser', {});
  assert.equal(e.len, 200);
  for (let i = 0; i < 10; i++) {
    a.x += 3;
    if (i === 5) a.facing = -a.facing;
    game.step();
    assert.ok(Math.abs(e.x - (a.x + 30 * a.facing * a.bodyScale)) < 1e-9);
    assert.ok(Math.abs(e.y - (a.y - 40 * a.bodyScale)) < 1e-9);
    assert.equal(e.facing, a.facing);
  }
});

test('stationary + snapToGround: lands on the surface below (ground or platform)', () => {
  const game = newGame();
  const [a] = game.fighters;
  const onGround = E.spawn(a, 'stake', { x: 40, y: -120 });
  assert.equal(onGround.y, G.y, 'rect bottom on the main ground');
  const p = stage.platforms[0];
  a.x = (p.x1 + p.x2) / 2; a.y = p.y - 60;
  const onPlat = E.spawn(a, 'stake', { x: 0, y: 0 });
  assert.equal(onPlat.y, p.y, 'snaps to the platform under it');
  steps(game, 30);
  assert.equal(onPlat.y, p.y, 'does not move');
});

test('walker: walks at speed, turns around at ledges, ignores platforms unless platforms:true', () => {
  const game = newGame();
  const [a, b] = game.fighters;
  ghost(a); ghost(b);
  a.x = G.x2 - 60; a.facing = 1;
  const e = E.spawn(a, 'golem', { x: 0, y: 0 });
  let turned = false;
  let maxX = -Infinity;
  for (let i = 0; i < 60; i++) {
    game.step();
    maxX = Math.max(maxX, e.x);
    if (e.facing === -1) turned = true;
    assert.ok(e.x <= G.x2 && e.x >= G.x1, 'never walks off');
    assert.ok(Math.abs(e.y - G.y) < 1e-9, 'stays on the floor');
  }
  assert.ok(turned && maxX === G.x2, 'turned at the ledge');
  // falls through a platform (platforms: false) but lands on it with platforms: true
  const p = stage.platforms[0];
  a.x = (p.x1 + p.x2) / 2; a.y = p.y - 80;
  const fall = E.spawn(a, 'golem', { x: 0, y: 0 });
  const stay = E.spawn(a, 'platGolem', { x: 0, y: 0 });
  steps(game, 60);
  assert.equal(fall.y, G.y, 'fell to the main ground');
  assert.equal(stay.y, p.y, 'walks on the platform');
  assert.ok(stay.x >= p.x1 && stay.x <= p.x2);
});

test('boomerang: flies out, homes back and despawns on the owner', () => {
  const { path, e, a, events } = deterministic('rang', { x: 30, y: -40 }, 120);
  const xs = path.filter(Boolean).map((p) => p[0]);
  const far = Math.max(...xs.map((x) => (x - a.x) * a.facing));
  assert.ok(far > 100, `went out ${far}`);
  assert.ok(e.dead, 'caught');
  assert.ok(events.some((v) => v.type === 'despawn' && v.i === e.id && v.reason === 'caught'));
});

test('collide walk (rolling wave): follows floors incl. platforms and falls off ledges', () => {
  const game = newGame();
  const [a, b] = game.fighters;
  ghost(a); ghost(b);
  const p = stage.platforms[1]; // x 170..400 at y -175
  a.x = 300; a.y = p.y - 60; a.facing = 1;
  const e = E.spawn(a, 'wave', { x: 0, y: 0, vx: 4, vy: 0 });
  let onPlat = false, fell = false, onGround = false;
  for (let i = 0; i < 120 && !e.dead; i++) {
    game.step();
    if (e.surface === 1) { onPlat = true; assert.ok(Math.abs(e.y + 10 - p.y) < 1e-9, 'rolls on the platform'); }
    if (onPlat && e.surface === null) fell = true;
    if (e.surface === -1) { onGround = true; assert.ok(Math.abs(e.y + 10 - G.y) < 1e-9); }
  }
  assert.ok(onPlat && fell && onGround, `platform ${onPlat}, fell ${fell}, ground ${onGround}`);
  // and off the main stage edge
  for (let i = 0; i < 200 && !e.dead; i++) game.step();
  assert.ok(e.dead || e.x > G.x2, 'rolled off the stage');
});

test('collide bounce: reflects velocity ×0.8 up to maxBounces, then dies', () => {
  const { e, events } = trajectory('bouncer', { x: 0, y: -40, vx: 2, vy: 0 }, 200);
  const bounces = events.filter((v) => v.type === 'ebounce' && v.i === e.id).length;
  assert.equal(bounces, 2);
  assert.ok(e.dead);
});

test('collide stick: stops on contact and stays until life ends', () => {
  const { path, e, events } = trajectory('sticky', { x: 0, y: -40, vx: 3, vy: 0 }, 100);
  const firstStill = path.findIndex((p, i) => i > 0 && p && path[i - 1] && p[0] === path[i - 1][0] && p[1] === path[i - 1][1]);
  assert.ok(firstStill > 0);
  assert.equal(path[firstStill][1], G.y - 8, 'stuck on the ground surface');
  assert.ok(e.dead && events.some((v) => v.type === 'despawn' && v.i === e.id && v.reason === 'expire'), 'expires at life end');
});

test('collide die vs platforms: v1 behavior ignores platforms; platforms:true fizzles on them', () => {
  const p = stage.platforms[0];
  const setup = (game, a) => { a.x = (p.x1 + p.x2) / 2; a.y = p.y - 80; };
  const thru = trajectory('ball', { x: 0, y: 0, vx: 0, vy: 0 }, 40, setup);
  const stop = trajectory('platDie', { x: 0, y: 0, vx: 0, vy: 0 }, 40, setup);
  assert.ok(thru.path[39] === null || thru.path[39][1] > p.y, 'passes the platform');
  assert.ok(stop.e.dead && stop.events.some((v) => v.type === 'fizzle' && v.i === stop.e.id));
  const at = stop.path.findIndex((x) => x === null);
  assert.ok(stop.path[at - 1][1] <= p.y + 8, 'died at the platform');
});

test('collide pass: no stage collision', () => {
  const { path } = trajectory('dart', { x: 0, y: 20, vx: 3, vy: 0 }, 20);
  assert.ok(path.every(Boolean), 'flies through the stage body');
});

test('mimic (clone): replays the owner input `delay` frames later', () => {
  const game = newGame();
  const [a, b] = game.fighters;
  ghost(a); ghost(b);
  const e = E.spawn(a, 'gloopling', { x: -40, y: 0 });
  assert.ok(e.minor && e.minor.minorOf === a);
  const delay = e.delay;
  assert.equal(delay, 18);
  const ax = [], cx = [];
  for (let i = 0; i < 80; i++) {
    a.pendingInput = { right: i >= 5 && i < 40 };
    game.step();
    ax.push(a.x); cx.push(e.x);
  }
  const startA = ax.findIndex((x, i) => i > 0 && x !== ax[i - 1]);
  const startC = cx.findIndex((x, i) => i > 0 && x !== cx[i - 1]);
  assert.equal(startC - startA, delay, `clone starts ${startC - startA} frames later`);
  assert.ok(Math.abs((cx[79] - cx[0]) - (ax[79] - ax[0])) < 1e-6, 'same displacement');
});

test('life: onExpire runs and spawns at the entity position (Gloop glob → puddle trap)', () => {
  const game = newGame();
  const [a, b] = game.fighters;
  ghost(a); ghost(b);
  const g = E.spawn(a, 'glob', { x: 24, y: -16, vx: 8, vy: -4 });
  steps(game, 85);
  assert.ok(g.dead);
  const puddles = live(game, 'puddleTrap');
  assert.equal(puddles.length, 1);
  assert.ok(Math.abs(puddles[0].x - g.x) < 1e-9);
  assert.equal(puddles[0].y, G.y, 'snapped to the ground');
});

test('every: spawns its child every N (≥ 30) frames', () => {
  const game = newGame();
  const [a, b] = game.fighters;
  ghost(a); ghost(b);
  E.spawn(a, 'bulb', { x: 0, y: -100 });
  const ev = steps(game, 95);
  assert.deepEqual(ev.filter((v) => v.type === 'spawn' && v.name === 'dart').length, 3);
});

test('think(): runs per frame with the entity view; api.command steers a walker', () => {
  const game = newGame();
  const [a, b] = game.fighters;
  ghost(a); ghost(b);
  a.x = 0;
  const e = E.spawn(a, 'imp', { x: 0, y: 0 });
  steps(game, 200);
  assert.ok(e.cmd && e.cmd.moveTo, 'command applied');
  assert.ok(Math.abs(e.x - (-300)) <= 2, `walked to the goal (${e.x})`);
});
