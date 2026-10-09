// shared/art/helpers/* and shared/art/sprite.js: behavior + determinism, and
// client/assets.js path safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockCanvas, installPath2D } from './lib/mock-canvas.js';
import { blob, rayExit } from '../../shared/art/helpers/blob.js';
import { swarm } from '../../shared/art/helpers/swarm.js';
import { serpent } from '../../shared/art/helpers/serpent.js';
import { wing } from '../../shared/art/helpers/wing.js';
import { tentacle, fabrik } from '../../shared/art/helpers/tentacle.js';
import { quadruped } from '../../shared/art/helpers/quadruped.js';
import { mech } from '../../shared/art/helpers/mech.js';
import { resolveClip, clipFrame, frameRect, makeSprite, stateClipNames } from '../../shared/art/sprite.js';
import { resolveAssetUrl, assetKind } from '../../client/assets.js';

installPath2D();
const ctx = () => new MockCanvas(400, 400).getContext('2d');
const SHAPES = [{ shape: 'rect', x: 0, y: -30, w: 60, h: 60 }, { shape: 'circle', x: 0, y: -70, r: 20 }];

test('blob: outline converges onto the union of target shapes and follows a shape change', () => {
  const st = blob.create({ points: 24, seed: 2 });
  for (let i = 0; i < 90; i++) blob.step(st, { shapes: SHAPES, dt: 1 / 60, wobble: 0 });
  const top = blob.top(st);
  assert.ok(Math.abs(top.y - -90 * 1.04) < 6, `top ${top.y}`);
  for (const p of st.pts) assert.ok(p.y < 6 && p.y > -100 && Math.abs(p.x) < 40, `point ${p.x},${p.y}`);
  // squash on landing widens it
  const w0 = Math.max(...st.pts.map((p) => p.x));
  for (let i = 0; i < 30; i++) blob.step(st, { shapes: SHAPES, dt: 1 / 60, impulse: { squash: 1, stretch: 0, lean: 0 }, wobble: 0 });
  assert.ok(Math.max(...st.pts.map((p) => p.x)) > w0 + 3);
  const path = blob.path(st);
  assert.equal(path.pts.length, 24);
  const c = ctx(); blob.spikes(c, st, { count: 6 }); assert.ok(c.ops >= 12); assert.equal(c.depth, 0);
  assert.ok(Math.abs(rayExit(SHAPES, 0, -30, -Math.PI / 2, 200) - 60) < 0.5); // circle top at y = -90
});

test('blob is deterministic', () => {
  const run = () => { const st = blob.create({ seed: 5 }); for (let i = 0; i < 20; i++) blob.step(st, { shapes: SHAPES, dt: 1 / 60, wobble: 1 }); return JSON.stringify(st.pts); };
  assert.equal(run(), run());
});

test('swarm: agents flock into the target shapes; deterministic per seed', () => {
  const run = () => {
    const st = swarm.create({ count: 30, seed: 4 });
    for (let i = 0; i < 120; i++) swarm.step(st, { shapes: SHAPES, dt: 1 / 60 });
    return st;
  };
  const a = run(), b = run();
  assert.equal(JSON.stringify(a.agents), JSON.stringify(b.agents));
  const box = swarm.bounds(a);
  assert.ok(box.x1 > -60 && box.x2 < 60 && box.y1 > -120 && box.y2 < 25, JSON.stringify(box));
  const c = ctx(); swarm.draw(c, a, { stripe: '#000', light: true }); assert.ok(c.ops > 30); assert.equal(c.depth, 0);
});

test('serpent: segment lengths are preserved while the head moves', () => {
  const st = serpent.create({ segments: 10, length: 100 });
  for (let i = 0; i < 60; i++) serpent.step(st, { head: { x: Math.sin(i / 10) * 40, y: -40 + Math.cos(i / 7) * 10 }, slither: 6, gravity: 0.3, time: i / 60 });
  for (let i = 1; i < st.pts.length; i++) {
    const d = Math.hypot(st.pts[i].x - st.pts[i - 1].x, st.pts[i].y - st.pts[i - 1].y);
    assert.ok(Math.abs(d - 10) < 1e-6, `seg ${i} = ${d}`);
  }
  const c = ctx(); serpent.draw(c, st, { belly: '#ffe', light: { dir: { x: -0.5, y: -0.8 } } }); assert.ok(c.ops > 3); assert.equal(c.depth, 0);
});

test('mech.ik2 reaches reachable targets exactly and clamps the rest', () => {
  const r = mech.ik2({ x: 0, y: 0 }, { x: 30, y: 40 }, 30, 30, 1);
  assert.ok(r.reached);
  assert.ok(Math.hypot(r.end.x - 30, r.end.y - 40) < 1e-6);
  assert.ok(Math.abs(Math.hypot(r.joint.x, r.joint.y) - 30) < 1e-6);
  const far = mech.ik2({ x: 0, y: 0 }, { x: 500, y: 0 }, 30, 30, 1);
  assert.ok(!far.reached && Math.abs(far.end.x - 60) < 1e-3);
  const flip = mech.ik2({ x: 0, y: 0 }, { x: 30, y: 40 }, 30, 30, -1);
  assert.notEqual(Math.sign(flip.joint.x - r.joint.x), 0);
  const c = ctx();
  mech.limb(c, r, { foot: {} }); mech.plate(c, { rivets: true, light: { dir: { x: -0.5, y: -0.8 } } }); mech.piston(c, { x: 0, y: 0 }, { x: 20, y: 30 }); mech.thruster(c, 0, 0, 1.57, 1, 0.3);
  assert.equal(c.depth, 0);
});

test('tentacle reaches a target with its tip (FABRIK), segment lengths fixed', () => {
  const st = tentacle.create({ segments: 10, length: 80, seed: 1 });
  for (let i = 0; i < 12; i++) tentacle.step(st, { root: { x: 0, y: -30 }, angle: 0, time: i / 60, target: { x: 50, y: -60 } });
  const tip = tentacle.tip(st);
  assert.ok(Math.hypot(tip.x - 50, tip.y + 60) < 2, `tip ${tip.x},${tip.y}`);
  const pts = fabrik([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], { x: 5, y: 12 }, 10);
  assert.ok(Math.hypot(pts[2].x - 5, pts[2].y - 12) < 1e-3);
  assert.ok(Math.abs(Math.hypot(pts[1].x, pts[1].y) - 10) < 1e-9);
  const c = ctx(); tentacle.draw(c, st, { suckers: '#fcc', light: { dir: { x: -0.5, y: -0.8 } } }); assert.ok(c.ops > 5); assert.equal(c.depth, 0);
});

test('wing: flap cycle in range, folded wings are shorter, both styles draw balanced', () => {
  for (let t = 0; t < 2; t += 0.05) { const a = wing.flap(t, { amp: 0.8 }); assert.ok(a >= -0.8001 && a <= 0.8001); }
  const open = wing.joints({ span: 80 }), shut = wing.joints({ span: 80, fold: 1 });
  const reach = (j) => Math.max(...j.tips.map((p) => Math.hypot(p.x, p.y)));
  assert.ok(reach(shut) < reach(open));
  for (const style of ['membrane', 'feather']) { const c = ctx(); wing.draw(c, { style, span: 70, light: { dir: { x: -0.5, y: -0.8 } } }); assert.ok(c.ops > 4); assert.equal(c.depth, 0); }
});

test('quadruped: stance feet on the ground, legs IK-consistent, gait from the view', () => {
  const v = { state: 'run', stateFrame: 17, vx: 6, grounded: true };
  const q = quadruped.pose(v, {}, { length: 90, height: 56, stats: { runSpeed: 6 } });
  assert.equal(q.legs.length, 4);
  assert.ok(q.legs.some((l) => Math.abs(l.foot.y) < 1e-6), 'a foot planted');
  for (const l of q.legs) assert.ok(l.foot.y <= 1e-6);
  assert.equal(q.gait, 'trot');
  const c = ctx(); quadruped.draw(c, q, { light: { dir: { x: -0.5, y: -0.8 } } }); assert.ok(c.ops > 10); assert.equal(c.depth, 0);
});

test('sprite: clip resolution order and frame mapping', () => {
  const clips = { idle: { frames: [0, 1], fps: 6, loop: true }, run: { frames: [8, 9, 10], fps: 12, loop: true, speedFrom: 'vx' }, fall: { frames: [17] },
    cane: { sync: 'move', startup: [32, 33], active: [34], recovery: [35, 36], charge: [40, 41] } };
  assert.equal(resolveClip(clips, { state: 'attack', move: { anim: 'cane' } }).name, 'cane');
  assert.equal(resolveClip(clips, { state: 'attack', move: { anim: 'nope' }, grounded: false, vy: 3 }).name, 'fall');
  assert.equal(resolveClip(clips, { state: 'shield' }).name, 'idle');
  assert.deepEqual(stateClipNames({ state: 'hitstun', tumble: true }), ['tumble', 'hurt']);
  const m = (phase, phaseT) => ({ state: 'attack', move: { anim: 'cane', phase, phaseT, frame: 3, chargeFrames: 9 } });
  assert.equal(clipFrame(clips.cane, m('startup', 0)), 32);
  assert.equal(clipFrame(clips.cane, m('startup', 0.6)), 33);
  assert.equal(clipFrame(clips.cane, m('active', 0.5)), 34);
  assert.equal(clipFrame(clips.cane, m('recovery', 0.99)), 36);
  assert.equal(clipFrame(clips.cane, m('charge', 0)), 41);
  assert.equal(clipFrame({ sync: 'move', startup: [1, 2] }, m('charge', 0)), 2, 'no charge clip: hold the windup');
  assert.equal(clipFrame(clips.idle, { state: 'idle', stateFrame: 10 }), 1);
  assert.equal(clipFrame(clips.idle, { state: 'idle', stateFrame: 20 }), 0);
  assert.equal(clipFrame(clips.fall, { state: 'air', stateFrame: 999 }), 17);
  const slow = clipFrame(clips.run, { state: 'run', stateFrame: 10, vx: 1.5 }, { stats: { runSpeed: 6 } });
  const fast = clipFrame(clips.run, { state: 'run', stateFrame: 10, vx: 12 }, { stats: { runSpeed: 6 } });
  assert.ok(fast !== slow);
  assert.deepEqual(frameRect({ frameW: 64, frameH: 32, cols: 4 }, null, 5), [64, 32, 64, 32]);
  assert.deepEqual(frameRect({ frameW: 64, frameH: 32, padding: 2 }, { width: 264 }, 4), [0, 34, 64, 32]);
  const img = new MockCanvas(256, 256);
  const sp = makeSprite({ sheets: { s: { image: 'a', frameW: 64, frameH: 64, anchor: [32, 60], scale: 0.5, pixelated: true } }, clips: { s: clips } }, { a: img });
  const c = ctx();
  assert.equal(sp.drawFrame(c, 's', 3), true);
  assert.ok(c.log.includes('imageSmoothingEnabled=false'));
  assert.ok(c.log.some((l) => l.startsWith('drawImage(img256x256,192,0,64,64,-32,-60')));
  assert.equal(c.depth, 0);
  const miss = makeSprite({ sheets: { s: { image: 'gone', frameW: 64, frameH: 64 } } }, { gone: null });
  const d = ctx();
  assert.equal(miss.drawFrame(d, 's', 0), false);
  assert.ok(d.ops > 0, 'placeholder drawn for a missing image');
});

test('assets: only files inside the character folder, supported formats', () => {
  const base = 'http://x.test/characters/gertie/';
  assert.equal(resolveAssetUrl('./gertie.png', base), 'http://x.test/characters/gertie/gertie.png');
  assert.equal(resolveAssetUrl('sfx/honk.ogg', base), 'http://x.test/characters/gertie/sfx/honk.ogg');
  assert.equal(resolveAssetUrl('../volt/art.js', base), null);
  assert.equal(resolveAssetUrl('/shared/art/kit.js', base), null);
  assert.equal(resolveAssetUrl('https://evil.test/a.png', base), null);
  assert.equal(assetKind('./a.PNG'), 'image');
  assert.equal(assetKind('./a.ogg'), 'audio');
  assert.equal(assetKind('./a.js'), null);
});
