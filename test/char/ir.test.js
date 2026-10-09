// Unit tests: schema tables, generics and buildIR (run: node test/char/ir.test.js)
import assert from 'node:assert/strict';
import { STATS, MOVE_SLOTS, CATEGORIES } from '../../shared/balance/rules.js';
import * as schema from '../../shared/char/schema.js';
import { genericMove, GENERIC_TRIGGERS } from '../../shared/char/generics.js';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR, actionTiming } from '../../shared/char/ir.js';
import { defineCharacter } from '../../shared/char/api.js';

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`✘ ${name}\n  ${e.stack}`); process.exitCode = 1; } };

t('schema: triggers, categories, stats mirror rules.js', () => {
  assert.equal(schema.TRIGGERS.length, 23);
  assert.deepEqual(schema.V1_SLOTS, Object.keys(MOVE_SLOTS));
  for (const [s, c] of Object.entries(MOVE_SLOTS)) assert.equal(schema.TRIGGER_CATEGORY[s], c);
  for (const c of Object.keys(CATEGORIES)) assert.ok(schema.CATEGORY_NAMES.includes(c), c);
  for (const [k, s] of Object.entries(schema.STAT_FIELDS)) assert.deepEqual([s.default, s.range[0], s.range[1]], [STATS[k].default, STATS[k].min, STATS[k].max]);
  assert.equal(schema.STAT_FIELDS.width, undefined);
  for (const [k, spec] of Object.entries(schema.TIMELINE_ACTIONS)) assert.ok(spec.params && 'governedBy' in spec, k);
  assert.equal(schema.TIMELINE_ACTION_KEYS.length, 19);
  for (const c of Object.keys(schema.NOTE_CODES)) assert.match(c, /^[EI]\d{3}$/);
});
t('schema: tables are deep-frozen', () => {
  assert.throws(() => { schema.TRIGGERS.push('x'); });
  assert.throws(() => { schema.MOVEMENT_MODES.hover.params.frames.default = 999; });
  assert.throws(() => { schema.BUILTIN_STATUSES.burn.frames = 1; });
});
t('generics: every trigger has one; they normalize cleanly and respect category minimums', () => {
  assert.deepEqual([...GENERIC_TRIGGERS].sort(), [...schema.TRIGGERS].sort());
  const moves = Object.fromEntries(schema.TRIGGERS.map((tr) => [tr, genericMove(tr)]));
  const r = normalize(defineCharacter({ id: 'gen', name: 'Gen', moves }), { expectedId: 'gen' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.notes, []);
  const ir = buildIR(r.draft);
  for (const tr of schema.TRIGGERS) {
    const a = ir.moves[tr];
    assert.equal(a.category, schema.TRIGGER_CATEGORY[tr], tr);
    const min = (CATEGORIES[a.category] || schema.CATEGORY_TIMING_FALLBACK[a.category]).minDuration;
    assert.ok(a.duration >= min, `${tr} duration ${a.duration} ≥ ${min}`);
  }
  assert.notEqual(genericMove('jab'), genericMove('jab')); // fresh object per call
  assert.equal(genericMove('nope'), null);
});
t('buildIR: tables sorted, index consistent, resources in declared order', () => {
  const ir = buildIR(normalize(defineCharacter({
    id: 'tab', name: 'Tab', resources: { zeta: { max: 5 }, alpha: { max: 5 } }, vars: { b: 1, a: 'x' }, sync: ['b'],
    entities: { z: { kind: 'zone', life: 20 }, a: { kind: 'projectile', life: 20 } },
    moves: { jab: { duration: 16 }, zz: { duration: 20 }, aa: { duration: 20 } }, slots: { side: 'zz', up: 'aa' },
  }), { expectedId: 'tab' }).draft);
  const isSorted = (l) => l.every((x, i) => i === 0 || l[i - 1] < x);
  for (const k of ['moves', 'entities', 'statuses', 'vars', 'hitboxes']) assert.ok(isSorted(ir.tables[k]), k);
  assert.deepEqual(ir.tables.resources, ['zeta', 'alpha']);
  assert.deepEqual(ir.tables.sync, ['b']);
  assert.deepEqual(Object.keys(ir.moves), ir.tables.moves);
  for (const [k, list] of Object.entries(ir.tables)) if (k !== 'index' && ir.tables.index[k]) list.forEach((n, i) => assert.equal(ir.tables.index[k][n], i));
  assert.deepEqual(ir.forms.base.hurtSets, ['default', 'crouch']);
  assert.equal(ir.meta.startForm, 'base');
});
t('buildIR: timing derives from final (scaled) numbers', () => {
  const r = normalize(defineCharacter({ id: 'tim', name: 'Tim', moves: { sideSmash: { duration: 40, hitboxes: [{ start: 8, end: 10, r: 20, damage: 10, angle: 40, knockback: 20, growth: 60 }] } } }), { expectedId: 'tim' });
  r.draft.moves.sideSmash.hitboxes[0].start = 12;                // a scaler delays startup
  r.draft.moves.sideSmash.hitboxes[0].end = 14;
  const ir = buildIR(r.draft);
  assert.equal(ir.moves.sideSmash.startup, 12);
  assert.equal(ir.moves.sideSmash.activeEnd, 14);
  assert.equal(ir.moves.sideSmash.charge.at, 9);
  assert.deepEqual(actionTiming({ hitboxes: [], timeline: [], duration: 33 }), { startup: 33, activeEnd: null });
});
t('buildIR: validator report merges over the base report', () => {
  const r = normalize(defineCharacter({ id: 'rep', name: 'Rep', moves: { jab: { duration: 16 } } }), { expectedId: 'rep' });
  const ir = buildIR(r.draft, { report: { statPoints: 40, moves: { jab: { power: 3.2 } } } });
  assert.equal(ir.report.statPoints, 40);
  assert.equal(ir.report.moves.jab.power, 3.2);
  assert.equal(ir.report.moves.jab.category, 'jab');
  assert.ok(ir.report.moves.side.generic);
  assert.equal(buildIR(null), null);
});
t('buildIR: slot functions and form fallbacks', () => {
  const fn = () => 'b';
  const ir = buildIR(normalize(defineCharacter({
    id: 'sf', name: 'Sf', moves: { jab: { duration: 16 }, b: { duration: 20 } }, slots: { jab: fn },
    forms: { f: { slots: { jab: 'b' } } },
  }), { expectedId: 'sf' }).draft);
  assert.equal(ir.forms.base.slotFns.jab, fn);
  assert.equal(ir.forms.base.slots.jab, 'jab');                  // static fallback
  assert.equal(ir.forms.f.slotFns.jab, undefined);               // a form string overrides the base function
  assert.equal(ir.forms.f.slots.jab, 'b');
  assert.equal(ir.moves.b.category, 'jab');
});

console.log(`${process.exitCode ? '✘' : '✔'} ir: ${pass} passed`);
