// Unit tests: structural errors (E0xx), info notes (I0xx), unknown-field keeping, garbage robustness.
// Run: node test/char/normalize-errors.test.js
import assert from 'node:assert/strict';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { defineCharacter } from '../../shared/char/api.js';
import { NOTE_CODES } from '../../shared/char/schema.js';
import { mulberry32 } from '../../shared/sim/rng.js';

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`✘ ${name}\n  ${e.stack}`); process.exitCode = 1; } };
const ok = (extra = {}) => defineCharacter({ id: 'testy', name: 'Testy', moves: { jab: { duration: 16, hitboxes: [{ start: 3, end: 5, x: 30, y: -40, r: 15, damage: 3, angle: 40, knockback: 10, growth: 20 }] } }, ...extra });
const run = (def, opts = { expectedId: 'testy' }) => normalize(def, opts);
const has = (list, code, path) => list.some((n) => n.code === code && (path === undefined || n.path === path));
const expectErr = (r, code, path) => assert.ok(has(r.errors, code, path), `expected ${code} at ${path}; got ${JSON.stringify(r.errors.map((e) => `${e.code}:${e.path}`))}`);

t('defineCharacter stamps version 2 without mutating', () => {
  const src = { id: 'a' };
  const out = defineCharacter(src);
  assert.equal(out.version, 2);
  assert.equal(src.version, undefined);
  assert.equal(defineCharacter(null), null);
});
t('baseline kit is clean', () => {
  const r = run(ok());
  assert.deepEqual(r.errors, []);
  assert.ok(buildIR(r.draft));
});
t('E001 bad/mismatched id', () => {
  expectErr(run(ok({ id: 'Bad Id' })), 'E001', 'id');
  expectErr(run(ok(), { expectedId: 'other' }), 'E001', 'id');
  expectErr(run(defineCharacter({ name: 'x', moves: {} }), {}), 'E001', 'id');
});
t('E002 missing name', () => expectErr(run(ok({ name: '  ' })), 'E002', 'name'));
t('E003 not an object', () => {
  for (const v of [null, 5, 'x', [], undefined]) assert.equal(run(v).errors[0].code, 'E003');
  assert.equal(run(null).draft, null);
});
t('E004 throwing getter', () => {
  const def = { version: 2, get id() { throw new Error('boom'); } };
  const r = run(def);
  expectErr(r, 'E004', '');
  assert.match(r.errors[0].why, /boom/);
});
t('E010 bad slots', () => {
  const r = run(ok({ slots: { jab: 'nope', side: 5, up: () => 'jab' } }));
  expectErr(r, 'E010', 'slots.jab');
  expectErr(r, 'E010', 'slots.side');
  assert.equal(r.errors.length, 2);
  const r2 = run(ok({ slots: { jab: 'jbb' } }));
  assert.equal(r2.errors[0].suggest, 'jab');
});
t('E011 startForm / form slot', () => {
  expectErr(run(ok({ startForm: 'ghost' })), 'E011', 'startForm');
  expectErr(run(ok({ forms: { x: { slots: { jab: 'missing' } } } })), 'E011', 'forms.x.slots.jab');
  assert.deepEqual(run(ok({ forms: { x: {} }, startForm: 'x' })).errors, []);
});
t('E012 entity references', () => {
  const r = run(ok({
    entities: { a: { kind: 'trap', life: 60, every: { frames: 30, spawn: 'nope' }, onExpire: [{ spawn: 'gone' }] } },
    moves: { jab: { duration: 20, timeline: [{ at: 5, spawn: 'orbb' }] } },
  }));
  expectErr(r, 'E012', 'entities.a.every.spawn');
  expectErr(r, 'E012', 'entities.a.onExpire[0].spawn');
  expectErr(r, 'E012', 'moves.jab.timeline[0].spawn');
});
t('E013 template references', () => {
  const r = run(ok({
    hitboxes: { zap: { damage: 3, angle: 40, knockback: 10, growth: 10 } },
    moves: { jab: { duration: 20, hitboxes: [{ start: 3, end: 4, r: 10, use: 'zapp' }], timeline: [{ at: 5, hit: 'zop', r: 10 }, { at: 6, release: 'nah' }] } },
  }));
  expectErr(r, 'E013', 'moves.jab.hitboxes[0].use');
  assert.equal(r.errors.find((e) => e.path === 'moves.jab.hitboxes[0].use').suggest, 'zap');
  expectErr(r, 'E013', 'moves.jab.timeline[0].hit');
  expectErr(r, 'E013', 'moves.jab.timeline[1].release');
});
t('E014 timeline entries need exactly one action', () => {
  const r = run(ok({ moves: { jab: { duration: 20, timeline: [{ at: 1, emit: 'a', sfx: 'b' }, { at: 2 }, 7, { at: 3, spwan: 'x' }] } } }));
  expectErr(r, 'E014', 'moves.jab.timeline[0]');
  expectErr(r, 'E014', 'moves.jab.timeline[1]');
  expectErr(r, 'E014', 'moves.jab.timeline[2]');
  assert.equal(r.errors.find((e) => e.path === 'moves.jab.timeline[3]').suggest, 'spawn');
});
t('E015 functions vs data', () => {
  const r = run(ok({
    vars: { n: 0 },
    behavior: { tick: 5 },
    entities: { e: { kind: 'minion', life: 60, think: {} } },
    ai: { hint: 'x' },
    moves: { jab: { duration: 20, update: 'go', hitboxes: () => [] }, side: { duration: () => 3 } },
  }));
  for (const p of ['behavior.tick', 'entities.e.think', 'ai.hint', 'moves.jab.update', 'moves.jab.hitboxes', 'moves.side.duration']) expectErr(r, 'E015', p);
  expectErr(r, 'E017', 'moves.side.duration');
  expectErr(run(ok({ moves: () => ({}) })), 'E015', 'moves');
});
t('E016 vars initializers', () => {
  const r = run(ok({ vars: { a: {}, b: NaN, c: null, d: 'ok', e: true, f: 1 } }));
  for (const p of ['vars.a', 'vars.b', 'vars.c']) expectErr(r, 'E016', p);
  assert.equal(r.errors.length, 3);
});
t('E017 duration', () => {
  expectErr(run(ok({ moves: { jab: { hitboxes: [] } } })), 'E017', 'moves.jab.duration');
  expectErr(run(ok({ moves: { jab: 'fast' } })), 'E017', 'moves.jab');
});
t('every E0xx code from §4.1.6 except E004-at-import/E020 is produced by normalize', () => {
  const produced = ['E001', 'E002', 'E003', 'E004', 'E010', 'E011', 'E012', 'E013', 'E014', 'E015', 'E016', 'E017'];
  for (const c of produced) assert.ok(NOTE_CODES[c], c);
});

t('I001 unknown fields are kept and reported with did-you-mean', () => {
  const r = run(ok({
    archtype: 'zoner',
    stats: { wieght: 90, width: 60 },
    moves: { jab: { duration: 16, durration: 3, hitboxes: [{ start: 3, end: 5, r: 12, damage: 3, angle: 40, knockBack: 99, growth: 20 }] } },
    slots: { sideB: 'jab' },
    behavior: { onhit() {} },
  }));
  assert.deepEqual(r.errors, []);
  const find = (p) => r.notes.find((n) => n.code === 'I001' && n.path === p);
  assert.equal(find('archtype').suggest, 'archetype');
  assert.equal(find('stats.wieght').suggest, 'weight');
  assert.ok(find('stats.width'));
  assert.equal(find('moves.jab.durration').suggest, 'duration');
  assert.equal(find('moves.jab.hitboxes[0].knockBack').suggest, 'knockback');
  assert.equal(find('slots.sideB').suggest, 'side');
  assert.equal(find('behavior.onhit').suggest, 'onHit');
  assert.match(find('archtype').why, /Did you mean "archetype"\?/);
  const ir = buildIR(r.draft);
  assert.deepEqual(ir.extra, { archtype: 'zoner' });
  assert.deepEqual(ir.moves.jab.extra, { durration: 3 });
  assert.deepEqual(ir.moves.jab.hitboxes[0].extra, { knockBack: 99 });
  assert.equal(ir.moves.jab.hitboxes[0].knockback, 20);           // the typo is NOT applied
  assert.equal(typeof ir.behavior.extra.onhit, 'function');
  for (const n of r.notes) for (const k of ['code', 'severity', 'path', 'why', 'fix']) assert.ok(k in n, `${n.code} has ${k}`);
});
t('I002/I003 generic fallbacks', () => {
  const r = run(ok());
  assert.ok(has(r.notes, 'I002', 'moves.side'));
  assert.ok(has(r.notes, 'I003', 'moves'));
  const ir = buildIR(r.draft);
  assert.equal(ir.moves.side.generic, true);
  assert.equal(ir.moves.grab.category, 'grab');
  assert.equal(ir.moves.taunt.category, 'taunt');
  assert.ok(ir.report.moves.dthrow.isThrow);
});
t('I005 unknown references, I006 unreachable, I008 builtin override, I009 effect typo', () => {
  const r = run(ok({
    statuses: { burn: { frames: 60, dot: { every: 20, damage: 0.3 } } },
    moves: {
      jab: { duration: 16, effect: 'electirc', else: 'nah', cost: { mana: 3 }, requires: { form: 'x' }, hitboxes: [{ start: 3, end: 5, r: 12, damage: 3, angle: 40, knockback: 10, growth: 20, status: 'soakd' }] },
      secret: { duration: 20 },
    },
  }));
  assert.deepEqual(r.errors, []);
  for (const p of ['moves.jab.else', 'moves.jab.cost.mana', 'moves.jab.requires.form', 'moves.jab.hitboxes[0].status']) assert.ok(has(r.notes, 'I005', p), p);
  assert.ok(has(r.notes, 'I006', 'moves.secret'));
  assert.ok(has(r.notes, 'I008', 'statuses.burn'));
  assert.equal(r.notes.find((n) => n.code === 'I009').suggest, 'electric');
  const ir = buildIR(r.draft);
  assert.equal(ir.statuses.burn.builtin, false);
  assert.equal(ir.statuses.burn.frames, 60);
  assert.equal(ir.moves.jab.else, null);
  assert.equal(ir.moves.secret.category, 'special');
});
t('category defaults and routing flags', () => {
  const ir = buildIR(run(ok({ slots: { upSpecial: 'boost', sideSmash: 'boost' }, moves: { jab: { duration: 16 }, boost: { duration: 40 } } })).draft);
  assert.equal(ir.moves.boost.category, 'smash');                 // first trigger in TRIGGERS order
  assert.equal(ir.moves.boost.helpless, true);
  assert.deepEqual(ir.moves.boost.routes, ['sideSmash', 'upSpecial']);
});
t('v2 projectiles shorthand is converted like v1', () => {
  const ir = buildIR(run(ok({ moves: { jab: { duration: 30, effect: 'fire', projectiles: [{ start: 9, vx: 6, r: 10, damage: 4, angle: 30, knockback: 10, growth: 30 }] } } })).draft);
  assert.equal(ir.entities['jab#p0'].hitboxes[0].effect, 'fire');
  assert.equal(ir.moves.jab.timeline[0].args.entity, 'jab#p0');
  assert.equal(ir.moves.jab.startup, 9);
});
t('timeline shorthand forms', () => {
  const r = run(ok({
    resources: { mp: { max: 10 } },
    hitboxes: { zap: { damage: 2, angle: 10, knockback: 5, growth: 5 } },
    moves: { jab: { duration: 40, timeline: [
      { at: 3, hit: 'zap', shape: 'circle', x: 20, y: -30, r: 12, frames: 3 },
      { from: 5, to: 15, every: 5, velocity: { vy: -2 } },
      { at: 4, intangible: 6 }, { at: 4, goto: 2 }, { at: 9, cost: { mp: 2 } }, { at: 10, camera: { shake: 3 } },
      { onHit: true, status: 'burn' }, { at: 11, endIf: { resource: { name: 'mp', below: 1 } } },
    ] } },
  }));
  assert.deepEqual(r.errors, []);
  const tl = buildIR(r.draft).moves.jab.timeline;
  assert.deepEqual(tl[0].args, { template: 'zap', shape: { shape: 'circle', x: 20, y: -30, r: 12 }, frames: 3, group: null });
  assert.deepEqual([tl[1].when, tl[1].from, tl[1].to, tl[1].every, tl[1].args.vy, tl[1].args.vx], ['range', 5, 15, 5, -2, null]);
  assert.deepEqual(tl[2].args, { frames: 6 });
  assert.deepEqual(tl[3].args, { frame: 2 });
  assert.deepEqual(tl[4].args, { costs: { mp: 2 } });
  assert.deepEqual(tl[5].args, { shake: 3 });
  assert.equal(tl[6].when, 'hit');
  assert.deepEqual(tl[7].args.resource, { name: 'mp', below: 1 });
  assert.equal(buildIR(r.draft).moves.jab.activeEnd, 5);
});
t('garbage never throws (seeded fuzz)', () => {
  const rnd = mulberry32(1234);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const leaf = () => pick([0, -1, 9999, NaN, Infinity, '', 'jab', 'circle', null, undefined, true, [], {}, () => 1, [1, 2], { r: 5 }]);
  const tree = (d) => (d > 3 || rnd() < 0.35 ? leaf() : rnd() < 0.5
    ? Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => tree(d + 1))
    : Object.fromEntries(Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => [pick(['shape', 'r', 'damage', 'at', 'spawn', 'hit', 'use', 'kind', 'jab', 'duration', 'hitboxes', 'timeline', 'slots', 'motion', 'base', 'max']), tree(d + 1)])));
  const top = ['body', 'stats', 'movement', 'resources', 'vars', 'sync', 'hitboxes', 'statuses', 'entities', 'moves', 'slots', 'forms', 'startForm', 'behavior', 'ai'];
  for (let i = 0; i < 400; i++) {
    const def = { version: 2, id: 'fuzz', name: 'Fuzz' };
    for (const k of top) if (rnd() < 0.6) def[k] = tree(0);
    const r = normalize(def, { expectedId: 'fuzz' });
    assert.ok(Array.isArray(r.errors) && Array.isArray(r.notes));
    if (!r.errors.length) buildIR(r.draft);
    for (const n of [...r.errors, ...r.notes]) assert.ok(NOTE_CODES[n.code], n.code);
  }
});

console.log(`${process.exitCode ? '✘' : '✔'} normalize-errors: ${pass} passed`);
