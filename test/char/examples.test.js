// Unit tests: the three §2 examples normalize with 0 errors and the expected IR (run: node test/char/examples.test.js)
import assert from 'node:assert/strict';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { BUILTIN_STATUSES, TRIGGERS } from '../../shared/char/schema.js';
import { deepFreeze } from '../../shared/util/freeze.js';

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`✘ ${name}\n  ${e.stack}`); process.exitCode = 1; } };
const load = async (id) => (await import(`../fixtures/${id}/character.js`)).default;
const ex = {};
for (const id of ['nimbus', 'gertie', 'gloop']) {
  const def = await load(id);
  const r = normalize(def, { expectedId: id });
  ex[id] = { def, r, ir: r.draft && buildIR(r.draft) };
}
const sub = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

for (const id of Object.keys(ex)) {
  t(`${id}: 0 errors, only expected info notes`, () => {
    assert.deepEqual(ex[id].r.errors, []);
    for (const n of ex[id].r.notes) assert.ok(['I003'].includes(n.code), `${id} unexpected note ${n.code} ${n.path}: ${n.why}`);
    assert.equal(ex[id].def.version, 2);
    assert.equal(ex[id].ir.version, 2);
  });
  t(`${id}: every trigger of every form resolves to a pool move`, () => {
    const { ir } = ex[id];
    for (const f of ir.tables.forms) for (const tr of TRIGGERS) assert.ok(ir.moves[ir.forms[f].slots[tr]], `${f}:${tr}`);
  });
  t(`${id}: IR is deterministic and freezable`, () => {
    const again = buildIR(normalize(ex[id].def, { expectedId: id }).draft);
    assert.equal(JSON.stringify(again), JSON.stringify(ex[id].ir));
    deepFreeze(again);
    assert.throws(() => { again.moves.jab.duration = 1; });
  });
}

t('nimbus: body, hover, resource, statuses', () => {
  const { ir } = ex.nimbus;
  const base = ir.forms.base;
  assert.deepEqual(base.body.collider, { w: 72, h: 64 });
  assert.equal(base.body.hurtboxes.default.length, 3);
  assert.deepEqual(base.body.hurtboxes.crouch[0], { shape: 'capsule', x1: -32, y1: -22, x2: 32, y2: -22, r: 20 });
  assert.deepEqual(base.movement, { hover: { button: 'jump', frames: 110, fallSpeed: 1.2, drift: 1.15 } });
  assert.equal(base.stats.airJumps, 2);
  assert.deepEqual(sub(ir.resources.charge, ['min', 'max', 'start', 'decay', 'onHit', 'regen']), { min: 0, max: 100, start: 0, decay: 0.03, onHit: { perDamage: 2.5 }, regen: 0 });
  assert.deepEqual(ir.resources.charge.hud, { style: 'bar', label: 'Static', color: '#9fe8ff', forms: null });
  assert.deepEqual(ir.statuses.soaked.mods, { speed: 0.9, jump: 0.92 });
  assert.equal(ir.statuses.soaked.builtin, false);
  for (const n of Object.keys(BUILTIN_STATUSES)) assert.equal(ir.statuses[n].builtin, true, n);
  assert.deepEqual(ir.vars, { dischargeCd: 0 });
});

t('nimbus: templates merge into hitboxes; inline overrides; groups', () => {
  const { ir } = ex.nimbus;
  const [drizzle, burst] = ir.moves.down.hitboxes;
  assert.deepEqual(sub(drizzle, ['shape', 'use', 'damage', 'angle', 'knockback', 'growth', 'effect', 'rehit', 'group', 'kind']),
    { shape: 'rect', use: 'drizzle', damage: 1, angle: 80, knockback: 4, growth: 0, effect: 'water', rehit: 4, group: 0, kind: 'strike' });
  assert.deepEqual(drizzle.status, { name: 'soaked', frames: null, power: null });
  assert.equal(burst.group, 9);
  assert.equal(burst.use, null);
  assert.equal(ir.moves.jab.hitboxes[0].effect, 'electric');     // move effect → hitbox default
  assert.equal(ir.moves.side.hitboxes[0].effect, 'water');       // inline wins
  assert.equal(ir.moves.up.hitboxes[0].effect, 'normal');
  assert.deepEqual(sub(ir.hitboxes.gust, ['kind', 'push', 'damage']), { kind: 'wind', push: 5, damage: 0 });
  assert.equal(ir.moves.sideSpecial.hitboxes[0].kind, 'wind');
  assert.deepEqual(ir.moves.bair.velocity[0], { start: 6, end: 9, vx: 2, vy: null, mode: 'add', untilGrounded: false, airOnly: false });
});

t('nimbus: ion beam hold, requires/else, charge defaults, scripts', () => {
  const { ir } = ex.nimbus;
  const s = ir.moves.sideSmash;
  assert.equal(s.category, 'smash');
  assert.deepEqual(s.requires, { resource: { charge: 20 } });
  assert.equal(s.else, 'thunderhead');
  assert.deepEqual(s.hold, { button: 'strong', from: 12, to: 22, max: 100, release: null });
  assert.equal(s.charge, null);                                   // hold owns the freeze window
  assert.equal(typeof s.update, 'function');
  assert.deepEqual(s.timeline[0], { when: 'at', at: 12, from: null, to: null, every: null, action: 'spawn',
    args: { entity: 'ionBeam', x: 30, y: -40, vx: null, vy: null, count: 1, spread: 0, aimAt: null, bindToMove: true } });
  assert.deepEqual(s.timeline[1].args, { sound: 'zap-loop' });
  assert.equal(s.startup, 12);
  assert.equal(ir.moves.thunderhead.category, 'smash');
  assert.deepEqual(ir.moves.thunderhead.charge, { button: 'strong', at: 10, max: 60, auto: true });
  assert.deepEqual(ir.moves.upSmash.charge.at, 9);
  assert.equal(ir.moves.taunt.category, 'taunt');
  assert.equal(ir.moves.upSpecial.helpless, true);
  assert.equal(ir.moves.sideSpecial.oncePerAirtime, true);
  assert.equal(ir.moves.neutralSpecial.startup, ir.moves.neutralSpecial.duration); // script-only: no static active frames
  const rg = ir.report.runtimeGoverned;
  for (const k of ['moves.sideSmash.update', 'moves.neutralSpecial.update', 'behavior.tick', 'behavior.onHurt']) assert.ok(rg.includes(k), k);
  assert.equal(typeof ir.behavior.onHurt, 'function');
  assert.equal(ir.behavior.init, null);
  assert.deepEqual(ir.ai.recovery, ['upSpecial', 'sideSpecial']);
  assert.equal(ir.ai.preferredRange, 260);
});

t('nimbus: entities', () => {
  const { ir } = ex.nimbus;
  const b = ir.entities.ionBeam;
  assert.deepEqual(sub(b, ['kind', 'life', 'length', 'width', 'anchor', 'collide']), { kind: 'beam', life: 90, length: 300, width: 12, anchor: { x: 30, y: -40 }, collide: 'die' });
  assert.deepEqual(b.motion, { type: 'attached' });
  assert.deepEqual(sub(b.hitboxes[0], ['shape', 'use', 'damage', 'rehit', 'start', 'end', 'effect']), { shape: 'capsule', use: 'ion', damage: 2, rehit: 8, start: 0, end: 90, effect: 'electric' });
  assert.deepEqual(ir.entities.strike.motion, { type: 'stationary', snapToGround: true });
  assert.deepEqual(sub(ir.entities.strike.hitboxes[0], ['start', 'end', 'use', 'damage']), { start: 8, end: 11, use: 'bolt', damage: 8 });
  assert.equal(ir.entities.raincloud.maxAlive, 1);
  assert.equal(ir.entities.raincloud.collide, 'pass');
  assert.deepEqual(ir.entities.raincloud.hurtbox, []);
  assert.deepEqual(ir.report.moves.downSpecial.spawns, ['raincloud']);
});

t('gertie: armor, glide, battery, grab/pummel/throws', () => {
  const { ir, r } = ex.gertie;
  assert.deepEqual(r.notes, []);
  assert.deepEqual(ir.generics, []);
  assert.deepEqual(ir.forms.base.armor, { threshold: 2 });
  assert.deepEqual(ir.forms.base.movement.glide, { button: 'jump', frames: 110, fallSpeed: 1.8, speed: 1.15, turn: 0.05 });
  assert.equal(ir.resources.battery.regenWhen, 'grounded');
  assert.equal(ir.resources.battery.regenDelay, 60);
  assert.equal(ir.resources.battery.hud.style, 'ring');
  assert.equal(ir.statuses.tangled.control, 'root');
  const g = ir.moves.grab;
  assert.equal(g.category, 'grab');
  assert.deepEqual(sub(g.hitboxes[0], ['kind', 'shape', 'w', 'h', 'start', 'end', 'damage']), { kind: 'grab', shape: 'rect', w: 50, h: 60, start: 7, end: 9, damage: 0 });
  assert.ok(ir.report.moves.grab.isGrab);
  const pm = ir.moves.pummel;
  assert.equal(pm.category, 'pummel');
  assert.equal(pm.timeline[0].action, 'release');
  assert.equal(pm.timeline[0].args.template, 'pinch');
  assert.deepEqual(sub(pm.timeline[0].args.hit, ['damage', 'setKnockback', 'kind']), { damage: 2.5, setKnockback: 0, kind: 'strike' });
  for (const th of ['fthrow', 'bthrow', 'uthrow', 'dthrow']) assert.equal(ir.moves[th].category, 'throw', th);
  assert.deepEqual(sub(ir.moves.fthrow.timeline[0].args.hit, ['damage', 'angle', 'knockback', 'growth']), { damage: 9, angle: 40, knockback: 50, growth: 68 });
  assert.equal(ir.moves.fthrow.timeline[0].args.template, null);
  assert.equal(ir.moves.fthrow.startup, 12);
  assert.ok(ir.report.moves.fthrow.isThrow);
});

t('gertie: cost/else, armor windows, cancels, hold, onLand, entities', () => {
  const { ir } = ex.gertie;
  const ss = ir.moves.sideSpecial;
  assert.deepEqual(ss.cost, { battery: 35 });
  assert.equal(ss.else, 'sputter');
  assert.deepEqual(ss.armor, [{ from: 4, to: 22, threshold: 8 }]);
  assert.deepEqual(ss.cancels, [{ from: 18, to: 24, into: ['jump'], onHit: true, button: null }]);
  assert.equal(ir.moves.sputter.category, 'special');
  assert.deepEqual(ir.moves.sideSmash.armor, [{ from: 6, to: 15, threshold: 10 }]);
  const tea = ir.moves.downSpecial;
  assert.deepEqual(tea.requires, { grounded: true });
  assert.deepEqual(tea.hold, { button: 'special', from: 10, to: 20, max: 300, release: null });
  assert.equal(ir.moves.dair.velocity[0].untilGrounded, true);
  assert.deepEqual(sub(ir.moves.dair.timeline[0], ['when', 'action']), { when: 'land', action: 'emit' });
  assert.deepEqual(ir.moves.dair.timeline[0].args, { name: 'slamDust', data: null });
  const d = ir.entities.dentures;
  assert.deepEqual(sub(d, ['kind', 'collide', 'maxBounces', 'maxAlive', 'maxHits', 'hp']), { kind: 'projectile', collide: 'bounce', maxBounces: 3, maxAlive: 2, maxHits: 1, hp: 0 });
  assert.deepEqual(d.shape, { shape: 'circle', x: 0, y: 0, r: 9 });
  assert.deepEqual(d.motion, { type: 'ballistic', gravity: 0.45 });
  assert.deepEqual(d.render, { style: 'dentures' });
  const y = ir.entities.yarnBall;
  assert.deepEqual(y.hurtbox, [y.shape]);
  assert.deepEqual(y.hitboxes[0].status, { name: 'tangled', frames: null, power: null });
  assert.deepEqual(ir.moves.neutralSpecial.timeline[0].args, { entity: 'dentures', x: 30, y: -80, vx: 7, vy: -6, count: 1, spread: 0, aimAt: null, bindToMove: false });
});

t('gloop: forms inherit and override', () => {
  const { ir } = ex.gloop;
  assert.deepEqual(ir.tables.forms, ['base', 'puddle', 'spike']);
  const { base, puddle, spike } = ir.forms;
  assert.deepEqual(base.body.scaleRange, [0.8, 1.2]);
  assert.deepEqual(puddle.body.scaleRange, [0.8, 1.2]);
  assert.equal(puddle.stats.weight, 80);
  assert.equal(puddle.stats.doubleJumpHeight, 14);              // inherited
  assert.equal(puddle.stats.fallSpeed, 10.5);
  assert.deepEqual(puddle.body.collider, { w: 84, h: 28 });
  assert.equal(puddle.body.hurtboxes.default[0].shape, 'capsule');
  assert.equal(puddle.body.hurtboxes.crouch[0].shape, 'rect');
  assert.deepEqual(puddle.movement, { crawl: { frames: 100, speed: 5.5 }, wallCling: { frames: 40, wallJump: true, jumpVx: 6, jumpVy: 11 } });
  assert.deepEqual(base.movement, {});
  assert.deepEqual(spike.armor, { threshold: 3 });
  assert.equal(puddle.armor, null);
  assert.equal(spike.body.hurtboxes.default.length, 2);
  assert.equal(base.slots.jab, 'jab');
  assert.equal(puddle.slots.jab, 'splash');
  assert.equal(puddle.slots.sideSmash, 'sideSmash');
  assert.equal(spike.slots.sideSmash, 'urchin');
  assert.equal(spike.slots.neutralSpecial, 'bristle');
  assert.equal(typeof base.slotFns.upSpecial, 'function');
  assert.equal(typeof spike.slotFns.upSpecial, 'function');      // base slot function inherited
  assert.equal(base.art, 'base');
  assert.equal(puddle.art, 'puddle');
});

t('gloop: categories from routing, absorb, counter, clone, glob chain', () => {
  const { ir, r } = ex.gloop;
  assert.deepEqual(ir.generics, ['grab', 'pummel', 'fthrow', 'bthrow', 'uthrow', 'dthrow']);
  assert.ok(!r.notes.some((n) => n.code === 'I006'));
  assert.equal(ir.moves.splash.category, 'jab');
  assert.equal(ir.moves.globShot.category, 'special');
  assert.equal(ir.moves.taunt.category, 'utility');
  assert.deepEqual(ir.moves.taunt.cost, { mass: 30 });
  assert.equal(ir.moves.taunt.else, 'jiggle');
  assert.equal(ir.moves.jiggle.category, 'taunt');
  const ns = ir.moves.neutralSpecial;
  assert.equal(ns.hitboxes[0].kind, 'absorb');
  assert.deepEqual(ns.onAbsorb.map((e) => [e.when, e.action, e.args]), [[null, 'resource', { name: 'mass', add: 15, set: null }], [null, 'emit', { name: 'gulp', data: null }]]);
  assert.deepEqual(ir.moves.bristle.counter, { from: 4, to: 20, then: 'bristleHit', mul: 1.2 });
  assert.equal(ir.moves.bristleHit.hitboxes[0].counterScale, true);
  assert.deepEqual(ir.moves.urchin.charge, { button: 'strong', at: 14, max: 60, auto: true });
  const up = ir.moves.upSpecial;
  assert.deepEqual(up.hold, { button: 'special', from: 4, to: 8, max: 30, release: null });
  assert.deepEqual(sub(up.timeline[0], ['when', 'from', 'to', 'every', 'action', 'args']), { when: 'range', from: 10, to: 24, every: 1, action: 'steer', args: { speed: 11, turn: 0.18 } });
  const c = ir.entities.gloopling;
  assert.deepEqual(sub(c, ['kind', 'hp', 'scale', 'maxAlive']), { kind: 'clone', hp: 12, scale: 0.6, maxAlive: 1 });
  assert.deepEqual(c.motion, { type: 'mimic', delay: 18 });
  assert.deepEqual(ir.entities.glob.onExpire[0].args.entity, 'puddleTrap');
  assert.equal(ir.entities.glob.collide, 'stick');
  assert.deepEqual(sub(ir.entities.puddleTrap.hitboxes[0], ['setKnockback', 'rehit', 'damage']), { setKnockback: 0, rehit: 60, damage: 1 });
  assert.deepEqual(ir.ai.recovery, { base: ['upSpecial', 'sideSpecial'], puddle: ['upSpecial'], spike: ['upSpecial'] });
  assert.ok(ir.report.moves.upSpecial.isRecovery);
  assert.deepEqual(ir.report.moves.splash.routes, ['puddle:jab']);
});

t('art is never part of the IR, but stays on the draft', () => {
  assert.equal(ex.nimbus.ir.art, undefined);
  assert.equal(ex.nimbus.r.draft.art, ex.nimbus.def.art);
});

console.log(`${process.exitCode ? '✘' : '✔'} examples: ${pass} passed`);
