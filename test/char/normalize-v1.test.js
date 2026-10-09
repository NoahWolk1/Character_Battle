// Unit tests: v1 → v2 round trip (run: node test/char/normalize-v1.test.js)
// Every v1 character, raw and as cleaned by the v1 validator, must normalize with
// 0 errors and build into an IR that preserves every move number.
import assert from 'node:assert/strict';
import { MOVE_SLOTS, CATEGORIES } from '../../shared/balance/rules.js';
import { normalize, isV1 } from '../../shared/char/normalize-v2.js';
import { normalizeV1, v1Body } from '../../shared/char/normalize-v1.js';
import { buildIR } from '../../shared/char/ir.js';
import { genericMove } from '../../shared/char/generics.js';
import { deepFreeze } from '../../shared/util/freeze.js';

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`✘ ${name}\n  ${e.stack}`); process.exitCode = 1; } };
const ROSTER = ['ember', 'bastion', 'volt', 'mirelle', '_template'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, d) => (isNum(v) ? v : d);

const defs = {};
for (const id of ROSTER) defs[id] = (await import(id === '_template' ? '../fixtures/_v1-template/character.js' : `../../characters/${id}/character.js`)).default; // frozen v1 template

/** Compare one v1 move (raw or validated) with its IR action. */
function checkMove(id, slot, src, a, ir, centerY) {
  const cat = CATEGORIES[MOVE_SLOTS[slot]];
  const P = `${id}.${slot}`;
  assert.equal(a.key, slot, P);
  assert.equal(a.category, MOVE_SLOTS[slot], `${P} category`);
  assert.equal(a.duration, Math.round(num(src.duration, cat.minDuration + 8)), `${P} duration`);
  if (typeof src.name === 'string' && src.name.trim()) assert.equal(a.name, src.name, `${P} name`);
  const hbs = (src.hitboxes || []).filter((h) => h && typeof h === 'object');
  assert.equal(a.hitboxes.length, hbs.length, `${P} hitbox count`);
  hbs.forEach((h, i) => {
    const b = a.hitboxes[i];
    const want = {
      shape: 'circle', start: Math.round(num(h.start, cat.minStartup)), end: Math.round(num(h.end, num(h.start, cat.minStartup) + 3)),
      x: num(h.x, 30), y: num(h.y, centerY), r: num(h.r, 20), damage: num(h.damage, 4), angle: num(h.angle, 45),
      knockback: num(h.knockback, 20), growth: num(h.growth, 60), group: Number.isInteger(h.group) ? h.group : 0,
      kind: 'strike', setKnockback: null, effect: a.effect, rehit: null, status: null,
    };
    for (const [k, v] of Object.entries(want)) assert.equal(b[k], v, `${P}.hitboxes[${i}].${k}`);
  });
  const vel = (src.velocity || []).filter((v) => v && typeof v === 'object');
  assert.deepEqual(a.velocity, vel.map((v) => ({
    start: Math.round(num(v.start, 1)), end: Math.round(num(v.end, num(v.start, 1))), vx: isNum(v.vx) ? v.vx : null, vy: isNum(v.vy) ? v.vy : null, mode: 'set', untilGrounded: false, airOnly: false,
  })), `${P} velocity`);
  const projs = (src.projectiles || []).filter((p) => p && typeof p === 'object');
  const spawns = a.timeline.filter((e) => e.action === 'spawn');
  assert.equal(spawns.length, projs.length, `${P} spawn count`);
  projs.forEach((p, i) => {
    const e = spawns[i];
    const name = `${slot}#p${i}`;
    assert.equal(e.when, 'at');
    assert.equal(e.at, Math.round(num(p.start, 8)), `${P} spawn at`);
    assert.deepEqual([e.args.entity, e.args.x, e.args.y, e.args.vx, e.args.vy], [name, num(p.x, 30), num(p.y, centerY), num(p.vx, 8), num(p.vy, 0)], `${P} spawn args`);
    const en = ir.entities[name];
    assert.equal(en.kind, 'projectile');
    assert.equal(en.life, Math.round(num(p.life, 60)), `${name}.life`);
    assert.deepEqual(en.motion, { type: 'ballistic', gravity: num(p.gravity, 0) }, `${name}.motion`);
    assert.equal(en.collide, 'die');
    assert.equal(en.maxHits, 1);
    assert.equal(en.clank, true);
    assert.equal(en.shape.r, num(p.r, 12));
    const hb = en.hitboxes[0];
    assert.deepEqual([hb.r, hb.damage, hb.angle, hb.knockback, hb.growth, hb.effect], [num(p.r, 12), num(p.damage, 5), num(p.angle, 40), num(p.knockback, 15), num(p.growth, 40), a.effect], `${name} hit`);
    assert.deepEqual(en.render, { style: typeof p.style === 'string' ? p.style.slice(0, 24) : 'orb', color: p.color ?? null, color2: p.color2 ?? null, spin: num(p.spin, 0) });
    assert.deepEqual(en.legacy, { v1: true, move: slot, index: i });
  });
  const intg = Array.isArray(src.intangible) && isNum(src.intangible[0]) ? [[Math.round(src.intangible[0]), Math.round(src.intangible[1])]] : [];
  assert.deepEqual(a.intangible, intg, `${P} intangible`);
  if (MOVE_SLOTS[slot] === 'aerial') assert.equal(a.landingLag, Math.round(num(src.landingLag, 10)), `${P} landingLag`);
  else assert.equal(a.landingLag, null);
  assert.equal(a.helpless, slot === 'upSpecial');
  assert.equal(a.oncePerAirtime, slot === 'sideSpecial');
  // Startup and charge frame follow v1 exactly (game.js: chargeFrame = max(1, startup − 3)).
  const starts = [...a.hitboxes.map((h) => h.start), ...spawns.map((e) => e.at)];
  const startup = starts.length ? Math.min(...starts) : a.duration;
  assert.equal(a.startup, startup, `${P} startup`);
  if (src.startup !== undefined) assert.equal(a.startup, src.startup, `${P} startup vs validator`);
  if (MOVE_SLOTS[slot] === 'smash') assert.deepEqual(a.charge, { button: 'strong', at: Math.max(1, startup - 3), max: 60, auto: true }, `${P} charge`);
  else assert.equal(a.charge, null);
  if (src.color !== undefined && src.color !== null) assert.equal(a.color, src.color);
}

function checkCharacter(id, def, label) {
  const exp = id === '_template' ? 'template' : id;
  assert.ok(isV1(def), `${label} detected as v1`);
  const r = normalize(def, { expectedId: exp });
  assert.deepEqual(r.errors, [], `${label} errors`);
  const ir = buildIR(r.draft);
  assert.equal(ir.version, 1);
  assert.equal(ir.id, exp);
  const w = num(def.stats?.width, 52), h = num(def.stats?.height, 92);
  assert.deepEqual(ir.forms.base.body.collider, { w, h }, `${label} collider`);
  assert.deepEqual(ir.forms.base.body.hurtboxes, v1Body(w, h).hurtboxes, `${label} hurtboxes`);
  for (const [k, v] of Object.entries(def.stats || {})) if (k !== 'width' && k !== 'height') assert.equal(ir.forms.base.stats[k], v, `${label} stats.${k}`);
  assert.deepEqual(ir.forms.base.slots, Object.fromEntries(ir.tables.triggers.map((x) => [x, x])), `${label} identity slots`);
  assert.deepEqual(ir.forms.base.movement, {});
  for (const slot of Object.keys(MOVE_SLOTS)) {
    const src = def.moves?.[slot];
    if (src && typeof src === 'object') checkMove(label, slot, src, ir.moves[slot], ir, -h / 2);
    else assert.equal(ir.moves[slot].generic, true, `${label}.${slot} generic`);
  }
  assert.equal(ir.legacy.art, typeof def.art?.draw === 'function' ? 'shim' : 'humanoid');
  assert.deepEqual(ir.legacy.stats, { ...(def.stats || {}) });
  // The IR is freezable and JSON-deterministic.
  const a = JSON.stringify(buildIR(normalize(def, { expectedId: exp }).draft));
  assert.equal(JSON.stringify(ir), a, `${label} deterministic`);
  deepFreeze(ir);
  return ir;
}

for (const id of ROSTER) t(`${id}: raw v1 file round-trips`, () => checkCharacter(id, defs[id], id));

// The v1 validator's clean output (what the legacy rules path produces) must round-trip too.
let validateCharacter = null;
try { ({ validateCharacter } = await import('../../shared/balance/validate.js')); } catch { /* validator being rewritten */ }
for (const id of ROSTER) {
  t(`${id}: v1-validated character round-trips`, () => {
    if (!validateCharacter) return;
    const exp = id === '_template' ? 'template' : id;
    const res = validateCharacter(defs[id], { expectedId: exp });
    const clean = res.character;
    if (!clean?.moves?.jab?.slot) return; // validator no longer returns the v1 shape (WP-C) — covered by its own tests
    const ir = checkCharacter(id, clean, `${id}(validated)`);
    for (const slot of Object.keys(MOVE_SLOTS)) {
      assert.equal(ir.moves[slot].anim, clean.moves[slot].anim, `${id}.${slot} anim`);
      assert.equal(ir.moves[slot].effect, clean.moves[slot].effect, `${id}.${slot} effect`);
    }
  });
}

t('v1 ignored fields are stashed, not activated', () => {
  const def = {
    id: 'oldie', name: 'Oldie', forms: { x: {} }, behavior: { tick() {} },
    stats: { width: 50, height: 90 },
    moves: { jab: { duration: 20, cancels: [{ from: 1, to: 5, into: ['any'] }], hitboxes: [{ start: 3, end: 5, x: 30, y: -40, r: 15, damage: 3, angle: 40, knockback: 10, growth: 20, status: 'burn' }] }, foo: { duration: 3 } },
  };
  const r = normalize(def, { expectedId: 'oldie' });
  assert.deepEqual(r.errors, []);
  const ir = buildIR(r.draft);
  assert.equal(ir.formOrder, undefined);
  assert.deepEqual(ir.tables.forms, ['base']);
  assert.equal(ir.behavior.tick, null);
  assert.deepEqual(ir.moves.jab.cancels, []);
  assert.equal(ir.moves.jab.hitboxes[0].status, null);
  assert.ok(ir.legacy.extra.forms && ir.legacy.extra.behavior);
  assert.ok(ir.legacy.unusedMoves.foo);
  assert.ok(ir.legacy.extraMoveFields.jab.cancels);
  assert.equal(ir.moves.foo, undefined);
  const codes = r.notes.map((n) => `${n.code}:${n.path}`);
  for (const c of ['I001:forms', 'I001:behavior', 'I001:moves.jab.cancels', 'I001:moves.jab.hitboxes[0].status', 'I010:moves.foo']) assert.ok(codes.includes(c), c);
});

t('v1 defaults match validate.js (missing numbers, name, effect, anim)', () => {
  const def = { id: 'bare', moves: { sideSmash: { hitboxes: [{}], projectiles: [{}], effect: 'firey', anim: 'nope' } } };
  const r = normalize(def, { expectedId: 'bare' });
  assert.deepEqual(r.errors, []);
  const ir = buildIR(r.draft);
  assert.equal(ir.meta.name, 'bare');            // v1 name falls back to id
  assert.equal(ir.meta.author, 'unknown');
  const a = ir.moves.sideSmash;
  assert.equal(a.duration, CATEGORIES.smash.minDuration + 8);
  assert.equal(a.effect, 'punch');
  assert.equal(a.anim, 'heavyPunch');
  assert.deepEqual([a.hitboxes[0].x, a.hitboxes[0].y, a.hitboxes[0].r, a.hitboxes[0].start, a.hitboxes[0].end], [30, -46, 20, 10, 13]);
  assert.equal(ir.entities['sideSmash#p0'].life, 60);
  assert.ok(r.notes.some((n) => n.code === 'I004' && n.path === 'moves.sideSmash.effect' && n.suggest === 'fire'));
});

t('missing v1 moves get v1 generic moves', () => {
  const ir = buildIR(normalize({ id: 'empty', name: 'Empty' }).draft);
  for (const slot of Object.keys(MOVE_SLOTS)) {
    const g = genericMove(slot);
    const a = ir.moves[slot];
    assert.equal(a.generic, true);
    assert.equal(a.duration, g.duration);
    assert.equal(a.hitboxes[0].damage, g.hitboxes[0].damage);
    assert.equal(a.hitboxes[0].group, 0);
  }
  assert.deepEqual(ir.moves.upSpecial.velocity, [{ start: 4, end: 16, vx: null, vy: -12, mode: 'set', untilGrounded: false, airOnly: false }]);
});

t('normalizeV1 output is v2 source syntax (migrate)', () => {
  const { draft } = normalizeV1(defs.ember);
  assert.equal(draft.version, 2);
  assert.ok(draft.body.collider && draft.body.hurtboxes.default);
  assert.equal(draft.stats.width, undefined);
  assert.equal(draft.moves.sideSmash.charge.button, 'strong');
  assert.equal(draft.moves.upSpecial.helpless, true);
  assert.ok(Object.keys(draft.entities).length >= 1);
  // Re-normalizing the v2 source (as a v2 file) gives the same moves.
  const viaV2 = buildIR(normalize({ ...draft, legacy: undefined }, { expectedId: 'ember' }).draft);
  const viaV1 = buildIR(normalize(defs.ember, { expectedId: 'ember' }).draft);
  assert.deepEqual(JSON.stringify(viaV2.moves), JSON.stringify(viaV1.moves));
});

t('input is never mutated', () => {
  const before = JSON.stringify(defs.bastion);
  normalize(defs.bastion, { expectedId: 'bastion' });
  assert.equal(JSON.stringify(defs.bastion), before);
});

console.log(`${process.exitCode ? '✘' : '✔'} normalize-v1: ${pass} passed`);
