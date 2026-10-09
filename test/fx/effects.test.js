// WP-L: event-driven effects, art.fx hooks, open effect vocabulary, governor feedback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Effects, resolveEffect, hitEffectName, effectColors, EFFECT_COLORS, EFFECT_NAMES } from '../../client/render/effects.js';
import { BUDGET } from '../../client/render/particles.js';
import { mockCtx } from './mock-canvas.js';
import { validateCharacter } from '../../shared/balance/validate.js';
import { Game } from '../../shared/sim/game.js';
import stage from '../../shared/stages/sky-sanctum.js';
import { loadRoster } from '../golden/harness.js';

test('open effect vocabulary: move color → preset → palette.effect → punch', () => {
  assert.equal(EFFECT_NAMES.length, 14);
  const pal = { effect: '#ff00aa' };
  assert.equal(resolveEffect('plasma', { color: '#00ff00', palette: pal }).colors[1], '#00ff00');
  assert.equal(resolveEffect('plasma', { palette: pal }).colors[1], '#ff00aa');
  assert.equal(resolveEffect('plasma', {}).colors, EFFECT_COLORS.punch);
  assert.equal(resolveEffect('plasma', {}).flavor, 'punch');
  // presets keep their colors; palette.effect no longer overrides them; a move color does
  assert.equal(resolveEffect('fire', { palette: pal }).colors, EFFECT_COLORS.fire);
  const fm = resolveEffect('fire', { color: '#3355ff', palette: pal });
  assert.equal(fm.colors[1], '#3355ff');
  assert.equal(fm.flavor, 'fire');
  assert.equal(resolveEffect(undefined, { color: 'nope'.repeat(40) }).colors, EFFECT_COLORS.punch);
  assert.equal(hitEffectName({ fx: 'ice', effect: 'fire' }), 'ice');
  assert.equal(hitEffectName({ fx: 'normal', effect: 'fire' }), 'fire');
  assert.equal(effectColors('fire', '#123456')[1], '#123456', 'v1 helper unchanged');
});

function rig(arts = {}, chars = {}) {
  const sounds = [];
  const audio = {
    charSound: (owner, key) => { sounds.push([owner, key]); return 'played'; },
    hit: () => sounds.push(['engine', 'hit']), duck() {}, resisted: () => sounds.push(['engine', 'resisted']),
    armor: () => sounds.push(['engine', 'armor']), breakSting: () => sounds.push(['engine', 'break']), tired: () => sounds.push(['engine', 'tired']),
    jump: () => sounds.push(['engine', 'jump']), land() {}, whoosh: () => sounds.push(['engine', 'whoosh']), shield() {}, shieldBreak() {}, clank() {}, shoot() {}, ko() {}, preset() {},
  };
  const pos = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
  const E = new Effects({ seed: 1 });
  E.attach({
    audio,
    fighter: (id) => ({ color: id === 'p1' ? '#ff4d5e' : '#3d9bff', art: arts[id] || {}, palette: arts[id]?.palette || {}, character: chars[id] || { stats: { height: 90 } }, anchor: () => ({ ...pos[id], facing: 1, scale: 1 }) }),
  });
  return { E, sounds };
}
const hit = (o = {}) => ({ type: 'hit', attacker: 'p1', target: 'p2', x: 50, y: -40, damage: 8, kb: 60, effect: 'punch', angle: 45, dir: 1, percent: 30, strong: false, gov: [], ...o });

test('defaults spawn for engine events; hooks replace only the flavor layer', () => {
  const plain = rig();
  plain.E.handleEvents([hit()]);
  const nDefault = plain.E.particles.count();
  assert.ok(nDefault > 15);
  let got = null;
  const hooked = rig({ p1: { fx: { onHit(fx, ev, info) { got = { ev, info }; fx.burst({ x: ev.x, y: ev.y, count: 3, shape: 'drip' }); } } } });
  hooked.E.handleEvents([hit()]);
  assert.equal(got.ev.x, 50);
  assert.ok(got.info.kit, 'info has kit');
  const n = hooked.E.particles.count();
  assert.ok(n < nDefault && n >= 3 + 2, `core + hook particles (${n} vs ${nDefault})`);
  assert.ok(hooked.E.particles.count('p1') === 3, 'hook particles are owned by the character');
  assert.ok(hooked.E.shake > 0, 'core shake kept');
  const both = rig({ p1: { fx: { onHit: () => true } } });
  both.E.handleEvents([hit()]);
  assert.equal(both.E.particles.count(), nDefault, 'returning true keeps the defaults');
});

test('a throwing hook falls back to defaults and is disabled after 3 throws', () => {
  let calls = 0;
  const { E } = rig({ p1: { fx: { onHit() { calls++; throw new Error('bad art'); } } } });
  const err = console.error; console.error = () => {};
  try { for (let i = 0; i < 5; i++) E.handleEvents([hit()]); } finally { console.error = err; }
  assert.equal(calls, 3);
  assert.ok(E.particles.count() > 15);
});

test('hit sparks use the move color / hitbox effect, not palette.effect', () => {
  const { E } = rig({ p1: { palette: { effect: '#ff00ff' } } });
  E.handleEvents([hit({ effect: 'punch', color: '#00ff88' })]);
  const cols = new Set(E.particles.list.filter((p) => !p.dead).map((p) => p.color));
  assert.ok(cols.has('#00ff88'));
  assert.ok(!cols.has('#ff00ff'));
  const r2 = rig({ p1: { palette: { effect: '#ff00ff' } } });
  r2.E.handleEvents([hit({ effect: 'fire', fx: 'ice' })]);
  const c2 = new Set(r2.E.particles.list.filter((p) => !p.dead).map((p) => p.color));
  assert.ok(c2.has(EFFECT_COLORS.ice[1]) && !c2.has('#ff00ff'));
  // unknown effect name → palette.effect
  const r3 = rig({ p1: { palette: { effect: '#ff00ff' } } });
  r3.E.handleEvents([hit({ effect: 'plasma' })]);
  assert.ok(r3.E.particles.list.some((p) => !p.dead && p.color === '#ff00ff'));
  // legacy renderer entry point honors the move color too
  const L = new Effects({ seed: 2 });
  L.hit(hit({ color: '#00ff88' }), EFFECT_COLORS.punch);
  assert.ok(L.particles.list.some((p) => p.color === '#00ff88'));
});

test('every preset flavor renders', () => {
  const { E } = rig();
  for (const name of EFFECT_NAMES) E.handleEvents([hit({ effect: name, kb: 130 })]);
  const ctx = mockCtx();
  E.update(); E.draw(ctx, 'back'); E.draw(ctx, 'front');
  assert.equal(ctx.depth, 0);
});

test('sounds: art.sounds overrides engine defaults; null mutes; move/sfx/custom routing', () => {
  const arts = { p1: { sounds: { jump: 'boing', hit: null, ionBeam: 'zap', thunder: 'thunder' }, fx: { onEvent: { thunder(fx, ev) { fx.flash('#fff', 0.3, 4); fx.sound('thunder'); } } } } };
  const chars = { p1: { stats: { height: 90 }, moves: { tackle: { sound: { type: 'square', freq: [200, 90], dur: 0.2 } } } } };
  const { E, sounds } = rig(arts, chars);
  E.handleEvents([
    { type: 'jump', id: 'p1', x: 0, y: 0 },
    { type: 'jump', id: 'p2', x: 0, y: 0 },
    hit(),
    { type: 'move', id: 'p1', name: 'ionBeam', slot: 'ionBeam' },
    { type: 'move', id: 'p1', name: 'tackle', slot: 'tackle' },
    { type: 'move', id: 'p2', name: 'jab', slot: 'jab' },
    { type: 'sfx', id: 'p1', name: 'rain-start' },
    { type: 'fx', id: 'p1', name: 'thunder', data: { big: true } },
  ]);
  const s = sounds.map((x) => x.join(':'));
  assert.ok(s.includes('p1:jump'), 'mapped jump');
  assert.ok(s.includes('engine:jump'), 'p2 default jump');
  assert.ok(s.includes('p1:hit') && !s.includes('engine:hit'), 'hit mapping (null) replaces the engine hit sound');
  assert.ok(s.includes('p1:ionBeam'));
  assert.ok(sounds.some(([o, k]) => o === 'p1' && typeof k === 'object'), 'move.sound SynthSpec');
  assert.ok(s.includes('engine:whoosh'), 'unmapped move → whoosh');
  assert.ok(s.includes('p1:rain-start'));
  assert.ok(s.filter((x) => x === 'p1:thunder').length >= 1);
  assert.ok(E.flash > 0.4 && E.flashHold === 4);
});

test('governor feedback: grey trimmed damage, armor flash, too tired, BREAK, no spark for speed', () => {
  const { E, sounds } = rig();
  E.handleEvents([hit({ gov: ['perHit'], damage: 7.5 })]);
  const hs = E.hud.get('p2');
  assert.equal(hs.trims.length, 1);
  assert.ok(E.particles.list.some((p) => !p.dead && p.shape === 'shard' && p.color.startsWith('#')), 'resisted spark');
  assert.ok(sounds.some((x) => x[1] === 'resisted'));
  const n0 = E.particles.count();
  E.handleEvents([{ type: 'gov', rule: 'speed', who: 'p1', target: 'p2', amount: 3 }]);
  assert.equal(E.particles.count(), n0, "no 'resisted' spark for the speed cap");
  E.handleEvents([{ type: 'armor', id: 'p2', by: 'p1', damage: 5 }]);
  assert.ok(E.hud.get('p2').armor > 0);
  E.handleEvents([{ type: 'gov', rule: 'stall', who: 'p1', target: null, amount: 120 }]);
  E.handleEvents([{ type: 'gov', rule: 'rise', who: 'p1', target: null, amount: 380 }]);
  assert.ok(E.hud.get('p1').tired > 0);
  assert.equal(sounds.filter((x) => x[1] === 'tired').length, 1, 'throttled');
  E.handleEvents([{ type: 'break', target: 'p2', by: 'p1' }]);
  assert.ok(E.hud.get('p2').breakT > 0);
  E.handleEvents([{ type: 'gov', rule: 'intangible', who: 'p1', target: null, amount: 1 }, { type: 'gov', rule: 'grabImmune', who: 'p1', target: 'p2', amount: 10 }]);
  assert.ok(E.hud.get('p2').resist > 0);
  assert.equal(E.govLog.length, 5);
  const ctx = mockCtx();
  for (let i = 0; i < 3; i++) { E.update(); E.draw(ctx, 'back'); E.draw(ctx, 'front'); }
  assert.equal(ctx.depth, 0);
});

test('custom fx events get positions; form/status/counter/reflect/absorb have defaults', () => {
  let ev = null;
  const { E } = rig({ p1: { fx: { onEvent: { discharge(fx, e) { ev = e; } }, onFormChange: null } } });
  E.handleEvents([
    { type: 'fx', id: 'p1', name: 'discharge', data: null },
    { type: 'fx', id: 'p1', name: 'unknown-name' },
    { type: 'form', id: 'p1', from: 'base', to: 'big' },
    { type: 'status', target: 'p2', name: 'burn', on: true },
    { type: 'counter', id: 'p1' }, { type: 'reflect', id: 'p1' }, { type: 'absorb', id: 'p1' },
    { type: 'grab', id: 'p1' }, { type: 'throw', id: 'p1' }, { type: 'camera', id: 'p1', shake: 50 },
  ]);
  assert.deepEqual([ev.x, ev.y, ev.data], [0, 0, {}]);
  assert.ok(E.particles.count() > 20);
  assert.ok(E.shake <= 26);
});

test('real sim event stream (governor on, 4 v1 characters): no throws, caps hold', async () => {
  const roster = await loadRoster(validateCharacter);
  const ids = Object.keys(roster).slice(0, 4);
  const game = new Game({
    stage, rules: { stocks: 3, seed: 5 },
    players: ids.map((id, i) => ({ id: `p${i}`, name: id, character: roster[id].character, cpu: 'hard' })),
  });
  const E = new Effects({ seed: 3 });
  const seen = new Set();
  E.attach({ fighter: (id) => { const i = +id.slice(1); const e = roster[ids[i]]; return e ? { color: '#fff', art: e.art || {}, palette: e.art?.palette || {}, character: e.character } : null; } });
  const ctx = mockCtx();
  for (let f = 0; f < 3600 && game.phase !== 'ended'; f++) {
    game.step();
    const evs = game.drainEvents();
    for (const e of evs) seen.add(e.type);
    E.observe(game.snapshot());
    E.handleEvents(evs);
    E.update();
    if (f % 30 === 0) { E.draw(ctx, 'back'); E.draw(ctx, 'front'); }
    assert.ok(E.particles.count() <= BUDGET.global);
  }
  assert.ok(seen.has('hit'), [...seen].join(','));
  assert.equal(ctx.depth, 0);
});
