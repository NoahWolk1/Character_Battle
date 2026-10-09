// WP-L: preset synth library, SynthSpec, asset buffers, ducking, per-character rate cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio, SOUND_PRESETS, normalizeSynthSpec, resolveSound, RateCap } from '../../client/audio.js';
import { fakeAudioContext } from './fake-audio.js';

const make = () => { const c = fakeAudioContext(); const a = new Audio({ context: () => c, autoUnlock: false }); a.init(); return { a, c }; };

test('all 16 spec presets exist and synthesize', () => {
  const spec = 'zip buzz-thwack clank boom squeak zap splash whoosh crunch chime roar alarm boing honk thunder gulp'.split(' ');
  assert.deepEqual([...SOUND_PRESETS].sort(), [...spec].sort());
  const { a, c } = make();
  for (const name of spec) {
    const before = c.log.started;
    assert.equal(a.play(name), true, name);
    assert.ok(c.log.started > before, `${name} started sources`);
  }
});

test('SynthSpec is clamped', () => {
  const s = normalizeSynthSpec({ type: 'laser', freq: [1, 1e9], dur: 60, gain: 50, vibrato: 3 });
  assert.deepEqual(s, { type: 'sine', freq: [20, 12000], dur: 2, gain: 1, vibrato: { rate: 7, depth: 0.5 } });
  assert.equal(normalizeSynthSpec('zap'), null);
  assert.equal(normalizeSynthSpec(null), null);
  const { a } = make();
  assert.equal(a.play({ type: 'square', freq: [200, 800], dur: 0.2, gain: 0.3, vibrato: { rate: 5, depth: 0.1 } }), true);
  assert.equal(a.play({ type: 'noise', freq: 900, dur: 0.1 }), true);
});

test('resolveSound: art.sounds mapping → asset → preset; null mutes', () => {
  const buf = { duration: 1 };
  const sounds = { jump: 'whoosh', hit: null, roarAsset: 'growl', beep: { type: 'square', freq: [600, 900], dur: 0.1 } };
  assert.deepEqual(resolveSound('jump', { sounds }), { kind: 'preset', name: 'whoosh' });
  assert.deepEqual(resolveSound('hit', { sounds }), { kind: 'mute' });
  assert.equal(resolveSound('roarAsset', { sounds, assets: { growl: buf } }).buffer, buf);
  assert.equal(resolveSound('roarAsset', { sounds, assets: { growl: null } }), null, 'failed asset load → unmapped');
  assert.equal(resolveSound('beep', { sounds }).kind, 'synth');
  assert.equal(resolveSound('thunder', {}).kind, 'preset');
  assert.equal(resolveSound('nope', {}), null);
  assert.equal(resolveSound('toString', { sounds: {} }), null, 'no prototype keys');
});

test('≤ 8 character sounds per second per owner', () => {
  const { a, c } = make();
  const res = [];
  for (let i = 0; i < 12; i++) res.push(a.charSound('p1', 'zap', { now: 10 + i * 0.01 }));
  assert.equal(res.filter((r) => r === 'played').length, 8);
  assert.equal(res.filter((r) => r === 'capped').length, 4);
  assert.equal(a.charSound('p2', 'zap', { now: 10.2 }), 'played', 'owners are independent');
  assert.equal(a.charSound('p1', 'zap', { now: 11.5 }), 'played', 'window rolls');
  assert.equal(a.charSound('p1', 'hit', { art: { sounds: { hit: null } }, now: 20 }), 'muted');
  assert.equal(a.charSound('p1', 'nothing', { now: 30 }), 'unmapped');
  const rc = new RateCap(2, 1);
  assert.deepEqual([rc.take('k', 0), rc.take('k', 0.1), rc.take('k', 0.2), rc.take('k', 1.05)], [true, true, false, true]);
  void c;
});

test('asset AudioBuffers play through the char bus; decode works', async () => {
  const { a, c } = make();
  const buf = { duration: 0.3 };
  assert.equal(a.charSound('p1', 'chatter', { art: { sounds: { chatter: 'teeth' } }, assets: { teeth: buf }, now: 0 }), 'played');
  assert.ok(c.log.nodes.some((n) => n.kind === 'src' && n.buffer === buf));
  assert.deepEqual(await a.decode(new ArrayBuffer(8)), { duration: 0.5 });
});

test('hit sounds duck the character bus', () => {
  const { a } = make();
  a.hit(12, 120, 'fire');
  const ev = a.buses.char.gain.events;
  assert.ok(ev.some(([k, v]) => k === 'set' && v < 1), 'ducked');
  assert.ok(ev.some(([k, v]) => k === 'lin' && v === 1), 'recovers');
  for (const m of ['resisted', 'armor', 'breakSting', 'tired', 'whoosh', 'jump', 'land', 'shield', 'shieldBreak', 'clank', 'ko', 'ui', 'select', 'gameSet']) a[m]();
  a.countdown(3); a.shoot('electric');
});

test('works without a browser (no window): silent no-ops', () => {
  const a = new Audio();
  a.init();
  assert.equal(a.ctx, null);
  assert.equal(a.play('zap'), false);
  a.hit(10, 50, 'punch');
  assert.equal(a.charSound('x', 'zap'), 'off');
});
