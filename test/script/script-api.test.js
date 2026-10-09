// Script runtime (WP-I, spec §3.12): guard, faults, views, api, command queue, flush order, rng.
//   node --test test/script/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCharacter } from '../../shared/balance/validate.js';
import { Game } from '../../shared/sim/game.js';
import guard from '../../shared/sim/guard.js';
import { mulberry32 } from '../../shared/sim/rng.js';
import { CATEGORIES } from '../../shared/balance/rules.js';
import stage from '../../shared/stages/sky-sanctum.js';
import { loadRoster } from '../golden/harness.js';
import * as script from '../../shared/sim/script-api.js';
import { bodyOf } from '../../shared/sim/hurtbox.js';

const roster = await loadRoster(validateCharacter);
const base = roster.volt.character;

/** A v1 character plus v2 script-facing fields. */
function char(extra = {}) {
  return {
    ...base,
    hitboxes: { zap: { damage: 99, angle: 45, knockback: 30, growth: 60 } },
    resources: { charge: { max: 100, start: 50 } },
    tables: { resources: ['charge'] },
    vars: { n: 0, mode: 'calm' },
    ...extra,
  };
}

function game(c1, c2 = base, rules = {}) {
  return new Game({
    stage, rules: { stocks: 3, countdown: false, seed: 42, scriptTiming: false, ...rules },
    players: [
      { id: 'p1', name: 'P1', character: c1 },
      { id: 'p2', name: 'P2', character: c2 },
    ],
  });
}

const govEvents = (g, rule) => g.events.filter((e) => e.type === 'gov' && e.rule === rule);

test('Math.random / Date.now / new Date() / performance.now throw inside hooks; 3 throws disable scripts', () => {
  const seen = [];
  const tries = [() => Math.random(), () => Date.now(), () => new Date(), () => performance.now()];
  let i = 0;
  const g = game(char({ behavior: { tick() { const k = i++; try { tries[k % 4](); seen.push('ok'); } catch (e) { seen.push(e.code); throw e; } } } }));
  for (let k = 0; k < 6; k++) g.step();
  assert.deepEqual(seen, ['SIM_GUARD', 'SIM_GUARD', 'SIM_GUARD']);
  const f = g.fighters[0];
  assert.equal(f.scriptsDisabled, true);
  assert.equal(f.scriptFaults, 3);
  const ev = govEvents(g, 'scriptsDisabled');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].who, 'p1');
  assert.equal(g.events.filter((e) => e.type === 'scriptError').length, 3);
  // Outside character code the globals pass through.
  assert.equal(typeof Math.random(), 'number');
  assert.equal(typeof Date.now(), 'number');
  assert.equal(guard.isActive(), false);
});

test('views are frozen, have no game/fighter references, and go stale after the call', () => {
  let stash = null;
  const errors = [];
  const g = game(char({
    behavior: {
      tick(view) {
        stash = view;
        for (const mutate of [() => { view.me.percent = 0; }, () => { view.frame = 1; }, () => { view.game = {}; }, () => { view.me.air.riseLeft = 1e9; }, () => { view.enemies()[0].percent = 0; }, () => { view.stage.ground.y = 0; }]) {
          try { mutate(); errors.push('no-throw'); } catch (e) { errors.push(e instanceof TypeError ? 'TypeError' : e.message); }
        }
        assert.equal(view.game, undefined);
        assert.equal(view.me.game, undefined);
        assert.equal(Object.isFrozen(view.input), true);
      },
    },
  }));
  g.step();
  assert.deepEqual(errors, Array(6).fill('TypeError'));
  assert.equal(g.fighters[0].percent, 0);
  assert.throws(() => stash.me, /stale view/);
  assert.equal(g.fighters[0].scriptsDisabled, false);
});

test('makeView without a call context is live (not cached)', () => {
  const g = game(char());
  const f = g.fighters[0];
  const v = script.makeView(f);
  const x0 = v.me.x;
  f.x += 10;
  assert.equal(v.me.x, x0 + 10);
});

test('immediate calls apply at once and are visible in the same call; queued calls wait for flush', () => {
  const log = [];
  const g = game(char({
    behavior: {
      tick(view, api) {
        if (view.frame !== 1) return;
        log.push(view.res.charge);
        api.res.add('charge', 20);
        log.push(view.res.charge);
        api.vars.set('n', 7);
        api.vars.set('n', 'not a number'); // type mismatch: ignored
        api.vars.set('undeclared', 1);     // undeclared: ignored
        log.push(view.vars.n);
        api.res.set('charge', 1e9);        // clamped to max
        log.push(view.res.charge);
      },
    },
  }));
  g.step();
  assert.deepEqual(log, [50, 70, 7, 100]);
  assert.equal(g.fighters[0].vars.undeclared, undefined);
});

test('queued commands apply in call order at flush; api objects die with their call', () => {
  let stashed = null;
  const g = game(char({
    behavior: {
      tick(view, api) {
        if (view.frame !== 1) return;
        api.velocity(5, null);
        api.velocity(-3, null, { mode: 'add' });
        api.velocity(null, -4);
        stashed = api;
      },
    },
  }));
  const f = g.fighters[0];
  f.grounded = false; f.state = 'air';
  g.frame = 1;
  script.run(f, 'tick');
  assert.deepEqual(f.cmdQueue.map((c) => c.op), ['velocity', 'velocity', 'velocity']);
  const before = { vx: f.vx, vy: f.vy };
  assert.deepEqual(before, { vx: 0, vy: 0 }); // nothing applied yet
  script.flush(f);
  assert.equal(f.vx, 2 * f.facing);
  assert.equal(f.vy, -4);
  assert.equal(f.cmdQueue.length, 0);
  stashed.velocity(9, 9);
  stashed.res.add('charge', -50);
  assert.equal(f.cmdQueue.length, 0);
  assert.equal(f.res[0], 50);
});

test('at most 24 queued commands per fighter per frame (extras dropped + gov event)', () => {
  const g = game(char({ behavior: { tick(view, api) { for (let i = 0; i < 40; i++) api.sfx(`s${i}`); } } }));
  const f = g.fighters[0];
  g.frame = 5;
  script.run(f, 'tick');
  script.run(f, 'tick'); // same frame: still capped
  assert.equal(f.cmdQueue.length, 24);
  assert.equal(govEvents(g, 'scriptCommands').length, 1);
  script.flush(f);
  // fx cap: 8 per frame
  assert.equal(g.events.filter((e) => e.type === 'sfx').length, 8);
  assert.equal(govEvents(g, 'scriptFx').length, 1);
  g.frame = 6;
  script.run(f, 'tick');
  assert.equal(f.cmdQueue.length, 24);
});

test('emit data is JSON-only and capped at 256 bytes', () => {
  const g = game(char({ behavior: { tick(view, api) { if (view.frame === 1) { api.emit('a', { k: 1 }); api.emit('b', { s: 'x'.repeat(400) }); api.emit('c', { f() {} }); } } } }));
  g.step();
  const fx = g.events.filter((e) => e.type === 'fx');
  assert.deepEqual(fx.map((e) => [e.name, e.data]), [['a', { k: 1 }], ['b', null], ['c', {}]]);
  assert.equal(fx[1].truncated, true);
});

test('per-fighter view.rng is separate from game.rng and deterministic', () => {
  const draws = (rng) => {
    const out = { p1: [], p2: [] };
    const c = char({ behavior: { tick(view) { out[view.me.id].push(view.rng()); } } });
    const g = game(c, c, { seed: 99 });
    for (let i = 0; i < 5; i++) g.step();
    out.game = g.rng();
    return out;
  };
  const a = draws(), b = draws();
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.p1, a.p2);
  // game.rng is untouched by script draws: same as a fresh stream after the same CPU-free run.
  const plain = game(base, base, { seed: 99 });
  for (let i = 0; i < 5; i++) plain.step();
  assert.equal(a.game, plain.rng());
  for (const x of a.p1) assert.ok(x >= 0 && x < 1);
  assert.equal(typeof mulberry32, 'function');
});

/** Runs fn with guard.clock replaced by a virtual clock (deterministic timing faults under load). */
function withVirtualClock(fn) {
  const real = guard.clock;
  const v = { t: 0 };
  guard.clock = () => v.t;
  try { return fn(v); } finally { guard.clock = real; }
}

test('two calls longer than 8 ms disable scripts; one is tolerated (timing on, after the 120-tick grace)', () => withVirtualClock((v) => {
  let n = 0, slow = 0;
  const g = game(char({ behavior: { tick() { if (++n > 125 && slow < 2) { slow++; v.t += 12; } } } }), base, { scriptTiming: true });
  for (let i = 0; i < 126; i++) g.step();
  const f = g.fighters[0];
  assert.equal(slow, 1);
  assert.equal(f.scriptsDisabled, false, 'one slow call (GC pause) is forgiven');
  g.step();
  assert.equal(slow, 2);
  assert.equal(f.scriptsDisabled, true);
  assert.equal(govEvents(g, 'scriptsDisabled')[0].reason, 'slow');
}));

test('timing faults are ignored during the first 120 ticks (load / JIT warm-up)', () => withVirtualClock((v) => {
  const g = game(char({ behavior: { tick() { if (g.frame < 110) v.t += 9; } } }), base, { scriptTiming: true });
  for (let i = 0; i < 115; i++) g.step();
  assert.equal(g.fighters[0].scriptsDisabled, false);
  assert.equal(script.LIMITS.timingGrace, 120);
  assert.equal(script.LIMITS.maxSlowCalls, 2);
}));

test('average above 1 ms/tick over 60 ticks disables scripts (timing on)', () => withVirtualClock((v) => {
  let calls = 0;
  const g = game(char({ behavior: { tick() { if (++calls > 120) v.t += 2.2; } } }), base, { scriptTiming: true });
  let n = 0;
  while (!g.fighters[0].scriptsDisabled && n < 240) { g.step(); n++; }
  assert.equal(g.fighters[0].scriptsDisabled, true);
  assert.equal(govEvents(g, 'scriptsDisabled')[0].reason, 'budget');
  assert.ok(n >= 140 && n <= 160, `disabled after ${n} ticks`);
}));

test('real wall clock: one genuine slow call after the grace is tolerated', () => {
  const clock = guard.clock;
  let n = 0;
  const g = game(char({ behavior: { tick() { if (++n === 126) { const t = clock(); while (clock() - t < 12); } } } }), base, { scriptTiming: true });
  for (let i = 0; i < 127; i++) g.step();
  const ev = govEvents(g, 'scriptsDisabled')[0];
  assert.ok(!ev || ev.reason !== 'throws', 'only timing could fault here');
  if (!ev) assert.equal(g.fighters[0].scriptsDisabled, false);
});

test('disabled scripts stop running; declarative play continues', () => {
  let calls = 0;
  const g = game(char({ behavior: { tick() { calls++; throw new Error('boom'); } } }));
  for (let i = 0; i < 30; i++) g.step();
  assert.equal(calls, 3);
  assert.equal(g.phase, 'playing');
});

test('behavior.init runs at match start and commands from init/onLand flush immediately', () => {
  const log = [];
  const g = game(char({ behavior: { init(view, api) { log.push(['init', view.frame]); api.vars.set('mode', 'storm'); } } }));
  assert.deepEqual(log, [['init', 0]]);
  assert.equal(g.fighters[0].vars.mode, 'storm');
});

test('api.hit is template-only: unknown templates are ignored, damage and reach are clamped', () => {
  const g = game(char({ behavior: { tick(view, api) { if (view.frame === 1) { api.hit('nope', { shape: 'circle', x: 0, y: -40, r: 30 }); api.hit('zap', { shape: 'circle', x: 5000, y: -40, r: 500 }, { frames: 99 }); } } } }));
  const f = g.fighters[0];
  g.fighters[1].x = 5000; // out of reach so nothing connects this frame
  g.step();
  assert.equal(govEvents(g, 'scriptHit').length, 1);
  assert.equal(f.extraHits.length, 1);
  const x = f.extraHits[0];
  const cat = CATEGORIES.special;
  assert.ok(x.hb.damage <= cat.maxHit);
  assert.ok(x.hb.r <= cat.maxRadius);
  assert.ok(Math.hypot(x.hb.x, x.hb.y + bodyOf(f).collider.h / 2) + x.hb.r <= cat.maxReach + 1e-6);
  assert.equal(x.hb.kind, 'strike');
});

test('api.hit connects through hits.js, then onHit/onHurt run at step 4 with ev data', () => {
  const log = [];
  const hurtLog = [];
  const hitter = char({
    behavior: {
      tick(view, api) { if (view.frame === 2) api.hit('zap', { shape: 'circle', x: 30, y: -40, r: 30 }); },
      onHit(view, api, ev) { log.push(ev); api.vars.set('n', 1); },
    },
  });
  const victim = char({ behavior: { onHurt(view, api, ev) { hurtLog.push(ev); } } });
  const g = game(hitter, victim, { governor: true });
  const [a, t] = g.fighters;
  t.x = a.x + 40 * a.facing;
  t.y = a.y;
  for (let i = 0; i < 3; i++) g.step();
  assert.equal(log.length, 1);
  assert.equal(log[0].targetId, 'p2');
  assert.ok(log[0].damage > 0 && log[0].damage <= CATEGORIES.special.maxHit);
  assert.equal(Object.isFrozen(log[0]), true);
  assert.equal(hurtLog.length, 1);
  assert.equal(hurtLog[0].attackerId, 'p1');
  assert.equal(a.vars.n, 1); // onHit commands flushed at step 4
  assert.ok(t.percent > 0);
  // group: hits each target once per call instance
  for (let i = 0; i < 5; i++) g.step();
  assert.equal(log.length, 1);
  assert.equal(a.extraHits.length, 0);
});

test('governed gates: teleport spam ≤ 1 per airtime and ≤ 200 px; velocity rise capped', () => {
  const g = game(char({ behavior: { tick(view, api) { api.teleport(0, -500); api.velocity(0, -50); } } }), base, { governor: true });
  const f = g.fighters[0];
  const y0 = f.y;
  g.step();
  assert.ok(y0 - f.y <= 200 + 17 + 1, `rose ${y0 - f.y}`);
  for (let i = 0; i < 300; i++) g.step();
  assert.ok(govEvents(g, 'teleport').length >= 1);
  assert.ok(f.vy >= -17);
});

test('setBodyScale is clamped to scaleRange ≥ 0.6 and rate-limited to 0.02/frame', () => {
  const g = game(char({ body: { scaleRange: [0.01, 9] }, behavior: { tick(view, api) { api.setBodyScale(0.01); } } }));
  const f = g.fighters[0];
  g.step();
  assert.ok(Math.abs(f.bodyScale - 0.98) < 1e-9);
  for (let i = 0; i < 60; i++) g.step();
  assert.equal(f.bodyScale, 0.6);
});

test('slotFn and ai.hint run under the guard and sanitize their output', () => {
  const g = game(char({ ai: { hint(view) { return { press: view.me.grounded ? 'jab' : 42 }; } } }));
  const f = g.fighters[0];
  assert.equal(script.slotFn(f, (view) => (view.me.grounded ? 'jab' : null), 'jab'), 'jab');
  assert.equal(script.slotFn(f, () => ({ evil: true }), 'jab'), null);
  assert.equal(script.slotFn(f, () => Math.random(), 'jab'), null);
  assert.equal(f.scriptFaults, 1);
  const h = script.aiHint(f);
  assert.deepEqual(h, { press: 'jab', hold: null });
  assert.equal(Object.isFrozen(h), true);
});

test('runThink gives (view, e, api) and evars.set only touches declared entity vars', () => {
  const g = game(char());
  const e = { id: 7, owner: 'p1', name: 'orb', x: 1, y: 2, vx: 0, vy: 0, life: 60, age: 0, hp: 3, vars: { heat: 0 } };
  let seen = null;
  script.runThink(g, e, (view, ent, api) => {
    seen = ent;
    api.evars.set('heat', 5);
    api.evars.set('other', 1);
    api.evars.set('heat', 'x');
    assert.throws(() => { ent.x = 9; }, TypeError);
  });
  assert.equal(seen.name, 'orb');
  assert.deepEqual(e.vars, { heat: 5 });
  assert.equal(e.x, 1);
});

test('startMove starts pool moves when actionable, buffers 7 frames otherwise; endMove ends at flush', () => {
  const plan = { 1: ['startMove', 'jab'], 2: ['startMove', 'side'], 30: ['startMove', 'nope'], 40: ['startMove', 'jab'], 41: ['endMove'] };
  const g = game(char({ behavior: { tick(view, api) { const p = plan[view.frame]; if (p) api[p[0]](p[1]); } } }));
  const f = g.fighters[0];
  g.step();
  assert.equal(f.action && f.action.name, 'jab');
  for (let i = 0; i < 12; i++) g.step(); // 'side' was buffered at frame 2 and expired by frame 9 (jab lasts 20)
  assert.equal(f.action && f.action.name, 'jab');
  while (g.frame < 30) g.step();
  assert.equal(govEvents(g, 'scriptMove').length, 1); // unknown move name: warned once, ignored
  while (g.frame < 40) g.step();
  assert.equal(f.action && f.action.name, 'jab');
  g.step();
  assert.equal(f.action, null);
});

test('api.status on an enemy needs a recent hit / contact / onHit target', () => {
  const g = game(char({ behavior: { tick(view, api) { if (view.frame === 1) api.status('p2', 'burn'); } } }));
  g.fighters[1].x += 600;
  g.step();
  assert.equal(govEvents(g, 'scriptStatus').length, 1);
});

test('api.form: unknown names warn; cooldown and transition hitlag apply', () => {
  const forms = { base: {}, big: { stats: base.stats } };
  const want = { 1: 'ghost', 2: 'big', 3: 'base' };
  const changes = [];
  const g = game(char({ forms, behavior: { tick(view, api) { if (want[view.frame]) api.form(want[view.frame]); }, onFormChange(view, api, ev) { changes.push(ev); } } }));
  const f = g.fighters[0];
  for (let i = 0; i < 4; i++) g.step();
  assert.equal(govEvents(g, 'scriptForm').length, 1);
  assert.equal(f.form, 'big'); // 'base' at frame 3 is inside the 45-frame cooldown
  assert.deepEqual(changes.map((c) => [c.from, c.to]), [['base', 'big']]);
  assert.ok(f.hitlag >= 0);
});
