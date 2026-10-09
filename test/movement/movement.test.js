// WP-H movement modes (§3.8) and air budgets (§4.2.5).
//   node --test test/movement/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ir, fixture, game, run, until, place, stage } from './helpers.js';
import { GOVERNOR } from '../../shared/balance/governor-rules.js';
import { collider } from '../../shared/sim/hurtbox.js';
import * as movement from '../../shared/sim/movement.js';

const G = stage.ground;
const nimbus = await fixture('nimbus');
const gertie = await fixture('gertie');
const gloop = await fixture('gloop');
const plain = ir({ id: 'plain' });
const flyer = ir({ id: 'flyer', movement: { fly: { fuel: 120, thrust: 0.9, maxRise: 5 } } });
const bigFlyer = ir({ id: 'bigflyer', movement: { fly: { fuel: 180, thrust: 0.9, maxRise: 5 } } });

test('hover: vy capped at fallSpeed while held, frame cap respected, drift multiplied', () => {
  const H = nimbus.forms.base.movement.hover;
  const g = game([nimbus, plain]);
  const f = place(g, 'p1', -470, -300);
  f.jumpsLeft = 0;
  let frames = 0;
  for (let i = 0; i < 130; i++) {
    run(g, 1, ['jump']);
    if (f.hovering) { frames++; assert.ok(f.vy <= H.fallSpeed + 1e-9, `vy ${f.vy}`); }
  }
  assert.equal(frames, H.frames, 'hover lasts exactly `frames` per airtime');
  assert.equal(f.air.hoverFrames, H.frames);
  assert.ok(!f.grounded && f.vy > H.fallSpeed, 'falls normally after the cap');
  // drift ×1.15 while hovering
  const g2 = game([nimbus, plain]);
  const h = place(g2, 'p1', -470, -300);
  h.jumpsLeft = 0;
  run(g2, 60, ['jump', 'right']);
  assert.ok(h.hovering && Math.abs(h.vx - h.stats.airSpeed * H.drift) < 1e-9, `vx ${h.vx}`);
  // landing refills
  until(g, (x) => x.grounded, 600);
  assert.equal(f.air.hoverFrames, 0);
});

test('hover: not active without the button or while fast-falling', () => {
  const g = game([nimbus, plain]);
  const f = place(g, 'p1', -470, -300);
  run(g, 40);
  assert.equal(f.air.hoverFrames, 0);
  assert.ok(f.vy > 2);
});

test('glide: enters on held button after apex, speed/fall caps, exits on release and on the frame cap', () => {
  const Gd = gertie.forms.base.movement.glide;
  const g = game([gertie, plain]);
  const f = place(g, 'p1', -470, -400);
  f.jumpsLeft = 0; f.facing = 1;
  run(g, 2, ['jump']);
  assert.equal(f.state, 'glide');
  run(g, 60, ['jump']);
  assert.ok(f.vy <= Gd.fallSpeed + 1e-9);
  assert.ok(Math.abs(f.vx - Gd.speed * f.stats.airSpeed) < 0.5, `vx ${f.vx}`);
  run(g, 1);
  assert.equal(f.state, 'air', 'release exits');
  run(g, 5);
  // re-enter and run out of frames
  assert.ok(until(g, (x) => x.state === 'glide', 10, ['jump']) >= 0, 're-enters (same airtime)');
  const n = until(g, (x) => x.state !== 'glide', 400, ['jump']);
  assert.ok(n > 0 && n < Gd.frames, 'only the remaining frames of this airtime');
  assert.equal(f.air.glideFrames, Gd.frames);
  assert.equal(f.state, 'air');
});

test('glide: attack exits to an aerial; specials are ignored', () => {
  const g = game([gertie, plain]);
  const f = place(g, 'p1', -470, -400);
  f.jumpsLeft = 0;
  run(g, 3, ['jump']);
  assert.equal(f.state, 'glide');
  run(g, 1, ['jump', 'special']);
  assert.equal(f.state, 'glide');
  run(g, 1, ['jump', 'attack']);
  assert.equal(f.state, 'attack');
  assert.equal(f.action.def.category, 'aerial');
});

test('fly: thrust rises, fuel 1/frame, refills only on landing, maxRise respected', () => {
  const F = flyer.forms.base.movement.fly;
  const g = game([flyer, plain]);
  const f = place(g, 'p1', -470, -100);
  f.jumpsLeft = 0;
  const y0 = f.y;
  run(g, 30, ['jump']);
  assert.equal(f.state, 'fly');
  assert.ok(f.y < y0 - 40, 'rises');
  assert.ok(f.vy >= -F.maxRise - 1e-9);
  assert.equal(f.air.flyFuel, F.fuel - 30);
  run(g, 10);
  assert.equal(f.state, 'air');
  assert.equal(f.air.flyFuel, F.fuel - 30, 'no refill in the air');
  until(g, (x) => x.grounded, 600);
  assert.equal(f.air.flyFuel, F.fuel);
});

test('fly: total self rise ≤ the 380 px rise budget, then upward thrust is clamped', () => {
  const g = game([bigFlyer, plain]);
  const f = place(g, 'p1', -760, 300);
  f.jumpsLeft = 0;
  let top = f.y;
  for (let i = 0; i < 180; i++) { run(g, 1, ['jump']); top = Math.min(top, f.y); }
  assert.ok(300 - top > 300, 'flew');
  assert.ok(300 - top <= GOVERNOR.air.rise + 1, `rose ${300 - top}`);
  assert.ok(f.air.rise <= GOVERNOR.air.rise + 1e-6);
});

test('stall exhaustion forces a fall and disables modes until landing', () => {
  const Gd = gertie.forms.base.movement.glide;
  const g = game([gertie, plain]);
  const f = place(g, 'p1', -470, -500);
  f.jumpsLeft = 0;
  run(g, 3, ['jump']);
  assert.equal(f.state, 'glide');
  g.gov.state(f).air.stall = GOVERNOR.air.stall - 5;
  const ev = run(g, 10, ['jump']);
  assert.ok(ev.some((e) => e.type === 'gov' && e.rule === 'stall'));
  assert.equal(f.state, 'air');
  run(g, 20, ['jump']);
  assert.equal(f.state, 'air', 'no re-entry while exhausted');
  assert.ok(f.vy > Gd.fallSpeed, 'normal gravity');
  until(g, (x) => x.grounded, 600, ['jump']);
  assert.equal(g.gov.stallExhausted(f), false);
});

test('stall exhaustion also ends hover (natural budget: hover + cling > 240 frames)', () => {
  const c = ir({ id: 'staller', movement: { hover: { frames: 120, fallSpeed: 1 } } });
  const g = game([c, plain]);
  const f = place(g, 'p1', -470, -700);
  f.jumpsLeft = 0;
  g.gov.state(f).air.stall = 200;   // spent earlier this airtime
  let hovered = 0;
  for (let i = 0; i < 120; i++) { run(g, 1, ['jump']); if (f.hovering) hovered++; }
  assert.ok(hovered <= 41, `hovered ${hovered} frames past the stall budget`);
});

test('long-air backstop: 600 frames airborne without landing → helpless', () => {
  const g = game([plain, plain]);
  const f = place(g, 'p1', -470, -500);
  g.gov.state(f).air.frames = GOVERNOR.air.longAir - 2;
  const ev = run(g, 3);
  assert.equal(f.state, 'helpless');
  assert.ok(ev.some((e) => e.type === 'gov' && e.rule === 'longAir'));
});

test('wallCling: slide, frame cap, wall jump away (no air jump spent), once per airtime', async () => {
  const g = game([gloop, plain]);
  const f = g.fighter('p1');
  g.fighters[0].formCd = 0;
  assert.ok((await import('../../shared/sim/fighter.js')).setForm(f, 'puddle'));
  const W = gloop.forms.puddle.movement.wallCling;
  const hw = collider(f).w / 2;
  place(g, 'p1', G.x1 - hw, 90);
  f.hitlag = 0;
  run(g, 2, ['right']);
  assert.equal(f.state, 'wallcling');
  assert.ok(Math.abs(f.vy - 0.4) < 1e-9);
  const jumps = f.jumpsLeft;
  run(g, 1, ['right', 'jump']);
  assert.equal(f.state, 'air');
  assert.ok(f.vx < 0, 'jumps away from the wall');
  assert.equal(f.jumpsLeft, jumps);
  // back to the wall: no second cling this airtime
  place(g, 'p1', G.x1 - hw, 90);
  run(g, 15, ['right']);
  assert.notEqual(f.state, 'wallcling');
  // frame cap after a landing refill
  f.air.clingUsed = false;
  place(g, 'p1', G.x1 - hw, 60);
  run(g, 2, ['right']);
  assert.equal(f.state, 'wallcling');
  const n = until(g, (x) => x.state !== 'wallcling', 200, ['right']);
  assert.ok(n >= W.frames - 2 && n <= W.frames + 2, `clung ${n}`);
});

test('crawl: climbs the side face onto the stage; underside crawl respects the frame cap', async () => {
  const { setForm } = await import('../../shared/sim/fighter.js');
  const g = game([gloop, plain]);
  const f = g.fighter('p1');
  setForm(f, 'puddle', { force: true });
  const C = gloop.forms.puddle.movement.crawl;
  const col = collider(f);
  place(g, 'p1', G.x1 - col.w / 2, 60);
  run(g, 1, ['right', 'up']);
  assert.equal(f.state, 'crawl');
  const n = until(g, (x) => x.grounded, 60, ['right', 'up']);
  assert.ok(n > 0, 'reached the top');
  assert.ok(f.x >= G.x1 && f.y === G.y);
  // underside
  setForm(f, 'puddle', { force: true });
  place(g, 'p1', -200, G.bottom + col.h);
  f.air.crawlFrames = 0;
  run(g, 1, ['up']);
  assert.equal(f.state, 'crawl');
  assert.equal(f.crawlSurface, 'under');
  const x0 = f.x;
  run(g, 10, ['up', 'right']);
  assert.ok(f.x > x0 + 40, 'moves along the underside');
  assert.ok(Math.abs(f.y - (G.bottom + collider(f).h)) < 1e-9, 'stuck to the underside');
  const m = until(g, (x) => x.state !== 'crawl', 300, ['up', 'right']);
  assert.ok(f.air.crawlFrames <= C.frames);
  assert.ok(m > 0);
});

test('a hit exits every mode', () => {
  const g = game([gertie, plain]);
  const f = place(g, 'p1', -470, -400);
  f.jumpsLeft = 0;
  run(g, 3, ['jump']);
  assert.equal(f.state, 'glide');
  g.setState(f, 'hitstun'); f.hitstun = 10;
  run(g, 1, ['jump']);
  assert.equal(f.state, 'hitstun');
});

test('queued free-fall physics equal the v1 inline drift-then-gravity', () => {
  const g = game([plain, plain]);
  const f = place(g, 'p1', -470, -300);
  f.vx = 1; f.vy = 2;
  const expect = { ...f };
  movement.drift(expect, 1, 1);
  movement.gravity(expect);
  run(g, 1, ['right']);
  assert.equal(f.vx, expect.vx);
  assert.ok(Math.abs(f.y - (-300 + expect.vy)) < 1e-9);
});
