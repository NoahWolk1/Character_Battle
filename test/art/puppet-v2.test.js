// Humanoid kit additions (v1 feedback): hand/foot after arm/leg overrides, weapon
// {draw, length}, weaponLength, `lower` layer, grounded hops, chain anchors / draw
// hooks / pre-settle / info.chains, kit parse-cache LRU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockCanvas, installPath2D } from './lib/mock-canvas.js';
import { drawFighter, weaponLength, humanoid, buildRig } from '../../shared/art/puppet.js';
import * as kit from '../../shared/art/kit.js';
import { NEUTRAL } from '../../shared/art/anims.js';

installPath2D();
const CH = { id: 't', stats: { width: 52, height: 100, runSpeed: 6 }, moves: {} };
const idle = { state: 'idle', stateFrame: 0, grounded: true, vx: 0, vy: 0, facing: 1, x: 0, y: 0, index: 0 };
const ctx = () => new MockCanvas(300, 300).getContext('2d');

test('art.hand / art.foot also run when art.arm / art.leg override the limb', () => {
  const calls = [];
  const art = { arm: () => calls.push('arm'), hand: () => calls.push('hand'), leg: () => calls.push('leg'), foot: () => calls.push('foot') };
  drawFighter(ctx(), CH, art, idle, 0, {});
  assert.deepEqual(calls, ['arm', 'hand', 'leg', 'foot', 'leg', 'foot', 'arm', 'hand']);
  // without hand/foot hooks nothing extra is drawn (v1 behavior)
  const c1 = ctx(); drawFighter(c1, CH, { arm() {}, leg() {} }, idle, 0, {});
  const c2 = ctx(); drawFighter(c2, CH, { arm() {}, leg() {} }, idle, 0, {});
  assert.equal(c1.hash(), c2.hash());
});

test('`lower` layer runs between the front leg and the head', () => {
  const calls = [];
  drawFighter(ctx(), CH, { leg: () => calls.push('leg'), lower: () => calls.push('lower'), head: () => calls.push('head') }, idle, 0, {});
  assert.deepEqual(calls, ['leg', 'leg', 'lower', 'head']);
});

test('weapon {draw, length} and weaponLength()', () => {
  let drew = 0;
  drawFighter(ctx(), CH, { weapon: { draw: () => drew++, length: 80 } }, idle, 0, {});
  assert.equal(drew, 1);
  assert.equal(weaponLength({ weapon: { draw() {}, length: 80 } }), 80);
  assert.equal(weaponLength({ weapon: (c, i) => {} }), 60, 'function arity is not a length'); // eslint-disable-line no-unused-vars
  assert.equal(weaponLength({ weapon: () => {}, weaponLength: 44 }), 44);
  const fn = () => {}; Object.defineProperty(fn, 'length', { value: 72 });
  assert.equal(weaponLength({ weapon: fn }), 72, 'bastion-style override still works');
  assert.equal(weaponLength({ weapon: { type: 'sword' } }), 60);
});

test('grounded hops: pose.hop and move pose windup/strike .hop lift the rig', () => {
  const ground = drawFighter(ctx(), CH, {}, idle, 0, {});
  const hop = drawFighter(ctx(), CH, { pose: () => ({ hop: 10 }) }, idle, 0, {});
  assert.ok(Math.abs(hop.rig.hip.y - (ground.rig.hip.y - 10)) < 1e-9);
  const move = { name: 'Hop', anim: 'kick', startup: 6, duration: 20, hitboxes: [{ start: 6, end: 8, x: 30, y: -40, r: 10 }], projectiles: [],
    pose: { windup: { ...NEUTRAL, hop: 4 }, strike: { ...NEUTRAL, hop: 16 }, limb: 'frontFoot' } };
  const strike = drawFighter(ctx(), CH, {}, { ...idle, state: 'attack', move, moveFrame: 8 }, 0, {});
  const noHop = drawFighter(ctx(), CH, {}, { ...idle, state: 'attack', move: { ...move, pose: { windup: { ...NEUTRAL }, strike: { ...NEUTRAL }, limb: 'frontFoot' } }, moveFrame: 8 }, 0, {});
  assert.ok(strike.rig.hip.y < noHop.rig.hip.y - 10, 'strike hop applied');
});

test('chains: joint / offset / function anchors, per-chain draw hook, info.chains in hook space', () => {
  let hookPts = null, chainsSeen = null;
  const art = {
    chains: [
      { anchor: 'handF', length: 30, segments: 4, draw: (c, pts) => { hookPts = pts; } },
      { anchor: { joint: 'chest', x: -4, y: 2 }, length: 30, segments: 4 },
      { anchor: (rig) => ({ x: rig.hip.x, y: rig.hip.y }), length: 30, segments: 4, layer: 'front' },
    ],
    back: (c, info) => { chainsSeen = info.chains; },
  };
  const out = drawFighter(ctx(), CH, art, { ...idle, x: 100, y: 0 }, 1, {});
  assert.equal(hookPts.length, 5);
  const hand = out.rig.armF.hand, { sx, sy } = out.pose; // chain space = body space × squash (no spin at idle)
  assert.ok(Math.hypot(hookPts[0].x - hand.x * sx, hookPts[0].y - hand.y * sy) < 1e-6, 'anchored on the front hand');
  assert.equal(chainsSeen.length, 3, 'all chains (incl. front) integrated before hooks run');
  assert.ok(chainsSeen[2].body.length === 5);
});

test('chains pre-settle: a fresh cape hangs down instead of sticking out sideways', () => {
  const art = { chains: [{ anchor: 'neck', length: 60, segments: 6 }] };
  const cache = {};
  drawFighter(ctx(), CH, art, idle, 0, cache);
  const p = cache.chains[0].pts;
  const tip = p[p.length - 1], root = p[0];
  assert.ok(tip.y - root.y > Math.abs(tip.x - root.x), 'mostly downward');
  const raw = {};
  drawFighter(ctx(), CH, { chains: [{ anchor: 'neck', length: 60, segments: 6, presettle: false }] }, idle, 0, raw);
  const q = raw.chains[0].pts;
  assert.ok(Math.abs(q[q.length - 1].x - q[0].x) > q[q.length - 1].y - q[0].y, 'v1 behavior without pre-settle');
});

test('humanoid(spec) is an ArtDef with draw/trail/portrait and a legacy canvas', () => {
  const d = humanoid({ palette: { primary: '#123456' }, fx: { onHit() {} }, sounds: { jump: 'boing' } });
  assert.equal(d.rig, 'humanoid');
  assert.equal(typeof d.draw, 'function');
  assert.equal(typeof d.trail, 'function');
  assert.equal(typeof d.portrait, 'function');
  assert.ok(d.legacyCanvas);
  assert.equal(d.palette.primary, '#123456');
  assert.equal(d.sounds.jump, 'boing');
  assert.ok(humanoid({ bounds: { left: -1, right: 1, top: -1, bottom: 1 } }).legacyCanvas === false);
  assert.ok(buildRig);
});

test('kit.parse cache is LRU-bounded (animated colors cannot leak)', () => {
  for (let i = 0; i < 3000; i++) kit.parse(`rgba(10,20,30,${i / 3000})`);
  assert.ok(kit.parseCacheSize() <= 513, `cache ${kit.parseCacheSize()}`);
  assert.deepEqual({ ...kit.parse('#ff0000') }, { r: 255, g: 0, b: 0, a: 1 });
});

test('kit v2 additions exist (§6.7)', () => {
  for (const n of ['rimArc', 'rimLightPath', 'shapeGlow', 'shapePoint', 'lightning', 'beam', 'rain', 'goo', 'droplet', 'seeded', 'radial', 'speedLines', 'capsulePath', 'outline', 'groupAlpha', 'fillPath', 'ellipse', 'cloudPuffs', 'blinkIcon', 'yarnBall', 'smear']) {
    assert.equal(typeof kit[n], 'function', n);
  }
  const c = ctx();
  kit.lightning(c, 3, 0, 0, 0, -100, '#fff', 3, 1, { branches: 2 });
  const d = ctx();
  kit.lightning(d, 3, 0, 0, 0, -100, '#fff', 3, 1, { branches: 2 });
  assert.equal(c.hash(), d.hash(), 'seeded lightning is deterministic');
  assert.equal(c.depth, 0);
});
