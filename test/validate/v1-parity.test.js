// v1 parity (spec §8, §9 WP-C): every v1 input — the shipped roster, the cheater,
// edge cases and 48 seeded fuzz defs — must produce exactly the pre-v2 numbers.
//  1. validateV1Legacy(def) is deep-equal to fixtures/v1-pre-change.json (captured
//     from the unmodified validator before any v2 edit; see capture-v1.js).
//  2. validateCharacter(def) — the dispatcher the sim uses — carries the same
//     ok/errors/notes (as text) and its IR projects back onto the same v1 character.
//  3. Its report keeps every v1 report field with v1 values.
// Run: node test/validate/v1-parity.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCharacter, validateV1Legacy } from '../../shared/balance/validate.js';
import { loadV1Cases, encode, decode, projectResult } from './v1-cases.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = decode(readFileSync(join(here, 'fixtures', 'v1-pre-change.json'), 'utf8'));
let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`✘ ${name}\n  ${e.stack}`); process.exitCode = 1; } };
const same = (a, b, msg) => assert.equal(encode(a), encode(b), msg);          // byte-identical (key order too)
const deep = (a, b, msg) => assert.deepStrictEqual(decode(encode(a)), decode(encode(b)), msg); // same values

/** IR (frozen, v1 source) → the v1 validator's character shape. */
export function irToV1(ir) {
  const moves = {};
  for (const [slot, rep] of Object.entries(ir.report.moves)) {
    const a = ir.moves[slot];
    if (!a || !a.projectiles) continue; // only the 16 v1 slots carry v1 projectiles
    moves[slot] = {
      name: a.name, slot, category: a.category, duration: a.duration, anim: a.anim, pose: a.pose,
      effect: a.effect, color: a.color, startup: a.startup,
      landingLag: a.category === 'aerial' ? a.landingLag : 0,
      intangible: a.intangible.length ? [...a.intangible[0]] : null,
      totalDamage: rep.totalDamage,
      hitboxes: a.hitboxes.map((h) => ({ start: h.start, end: h.end, x: h.x, y: h.y, r: h.r, damage: h.damage, angle: h.angle, knockback: h.knockback, growth: h.growth, group: h.group })),
      projectiles: a.projectiles.map((p) => ({ ...p })),
      velocity: a.velocity.map((v) => ({ start: v.start, end: v.end, vx: v.vx, vy: v.vy })),
    };
  }
  return { id: ir.id, name: ir.meta.name, author: ir.meta.author, description: ir.meta.description, stats: { ...ir.forms.base.stats }, moves };
}

const V1_REPORT_MOVE_KEYS = ['category', 'startup', 'duration', 'totalDamage', 'koPercent', 'reach', 'power'];
const cases = await loadV1Cases();

t('fixture covers every case', () => {
  assert.equal(Object.keys(fixture).length, cases.length);
  for (const c of cases) assert.ok(c.label in fixture, c.label);
});

for (const c of cases) {
  const want = fixture[c.label];
  t(`${c.label}: v1 rules path is byte-identical to the pre-change validator`, () => {
    same(projectResult(validateV1Legacy(c.def, c.opts)), want);
  });
  t(`${c.label}: dispatcher result matches (ok, errors, notes, IR numbers, report)`, () => {
    const r = validateCharacter(c.def, c.opts);
    assert.equal(r.ok, want.ok);
    assert.deepEqual(r.errors.map(String), want.errors);
    assert.deepEqual(r.notes.map(String), want.notes);
    for (const n of [...r.errors, ...r.notes]) { assert.match(n.code, /^[EWI]\d{3}$/, `${n.code} ${n.text}`); assert.notEqual(n.code, 'W200', n.text); }
    if (!want.ok) { assert.equal(r.character, null); return; }
    assert.ok(Object.isFrozen(r.character) && Object.isFrozen(r.character.moves.jab.hitboxes));
    assert.equal(r.character.version, 1);
    deep(irToV1(r.character), want.character);
    for (const k of ['statPoints', 'statBudget', 'movePower', 'moveBudget']) deep(r.report[k], want.report[k], k);
    for (const [slot, m] of Object.entries(want.report.moves)) {
      for (const k of V1_REPORT_MOVE_KEYS) deep(r.report.moves[slot][k], m[k], `${slot}.${k}`);
    }
    // v1 projectiles are carried inline only (no duplicate timeline spawns).
    for (const a of Object.values(r.character.moves)) assert.ok(!a.timeline.some((e) => e.action === 'spawn' && r.character.entities[e.args.entity]?.legacy?.v1));
  });
}

console.log(`${process.exitCode ? '✘' : '✔'} v1-parity: ${pass} passed (${cases.length} v1 inputs)`);
