// Validator v2 (spec §4.1, §9 WP-C): examples, the v2 "9999" cheater, every E0xx
// code, determinism, the IR contract the sim reads, and unit checks per scaler.
// Run: node test/validate/v2.test.js
import assert from 'node:assert/strict';
import { validateCharacter } from '../../shared/balance/validate.js';
import { defineCharacter } from '../../shared/char/api.js';
import { TRIGGERS, V1_SLOTS, MOVEMENT_MODES as SCHEMA_MODES, STATUS_MOD_RANGES } from '../../shared/char/schema.js';
import {
  CATEGORIES, STAT_BUDGET, MOVE_BUDGET, REACH_BEYOND, ENTITY_LIMITS, ENTITY_RULES, BODY_LIMITS, MOVEMENT_MODES, STATUS_LIMITS,
  ACTION_LIMITS, MOVEMENT_LIMITS,
} from '../../shared/balance/rules.js';
import { MOD_RANGES, STATUS_CAPS, TIER } from '../../shared/balance/governor-rules.js';
import { estimateKoPercent } from '../../shared/sim/combat.js';
import { areaCost } from '../../shared/balance/v2/stats.js';
import { reachBeyond, unionArea } from '../../shared/balance/v2/area.js';
import { kindKey } from '../../shared/balance/v2/entities.js';
import { formatReport } from '../../shared/balance/v2/report.js';
import { mulberry32 } from '../../shared/sim/rng.js';
import nimbus from '../fixtures/nimbus/character.js';
import gertie from '../fixtures/gertie/character.js';
import gloop from '../fixtures/gloop/character.js';

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`✘ ${name}\n  ${e.stack}`); process.exitCode = 1; } };
const EX = { nimbus, gertie, gloop };
const json = (r) => JSON.stringify(r, (k, v) => (typeof v === 'function' ? `fn:${v.length}` : v === Infinity ? 'Inf' : v));
const base = (extra = {}) => defineCharacter({ id: 'testy', name: 'Testy', moves: { jab: { duration: 16, hitboxes: [{ start: 3, end: 5, x: 30, y: -40, r: 15, damage: 3, angle: 40, knockback: 10, growth: 20 }] } }, ...extra });
const run = (def, opts = { expectedId: 'testy' }) => validateCharacter(def, opts);
const codes = (r) => r.notes.map((n) => n.code);

// ── Invariants every validated v2 character satisfies ──────────────────────
function checkInvariants(r, label) {
  const c = r.character;
  assert.ok(r.ok, `${label} loads`);
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.forms.base.body.hurtboxes.default), `${label} frozen`);
  for (const n of r.notes) assert.match(n.code, /^[WI]\d{3}$/, `${label}: ${n.code}`);
  for (const f of c.tables.forms) {
    const F = c.forms[f];
    const fr = c.report.forms?.[f];
    if (fr) {
      assert.ok(fr.statPoints.total <= STAT_BUDGET + 0.01, `${label} form ${f} stats ${fr.statPoints.total}`);
      assert.ok(fr.movePower <= MOVE_BUDGET + 0.01, `${label} form ${f} power ${fr.movePower}`);
      assert.ok(fr.pricedArea >= BODY_LIMITS.minArea - 1 && fr.pricedArea <= BODY_LIMITS.maxArea + 1, `${label} area ${fr.pricedArea}`);
    }
    assert.ok(F.body.collider.w >= 20 && F.body.collider.w <= 160 && F.body.collider.h >= 20 && F.body.collider.h <= 200);
    assert.ok(F.body.scaleRange[0] >= 0.6 && F.body.scaleRange[1] <= 1.6);
    assert.ok(Object.keys(F.body.hurtboxes).length <= BODY_LIMITS.maxSets);
    for (const list of Object.values(F.body.hurtboxes)) assert.ok(list.length <= BODY_LIMITS.maxShapes);
    assert.ok(!F.armor || F.armor.threshold <= BODY_LIMITS.armorMax);
    // Every trigger resolves to an existing move (sim contract).
    for (const tr of c.tables.triggers) assert.ok(c.moves[F.slots[tr]], `${label} ${f}.${tr}`);
    for (const [m, p] of Object.entries(F.movement)) for (const [k, [lo, hi]] of Object.entries(MOVEMENT_MODES[m].ranges)) {
      const h = typeof hi === 'string' ? parseFloat(hi) * F.stats.runSpeed + 0.01 : hi;
      if (typeof p[k] === 'number') assert.ok(p[k] >= Math.min(lo, h) - 1e-9 && p[k] <= h + 1e-9, `${label} ${m}.${k} ${p[k]}`);
    }
  }
  for (const [n, a] of Object.entries(c.moves)) {
    const row = CATEGORIES[a.category];
    const rep = c.report.moves[n];
    assert.ok(a.duration >= row.minDuration && a.duration <= ACTION_LIMITS.maxDuration, `${label} ${n} duration ${a.duration}`);
    if (rep.totalDamage !== undefined) assert.ok(rep.totalDamage <= row.maxTotal + 0.01, `${label} ${n} total ${rep.totalDamage}`);
    const first = Math.min(...a.hitboxes.map((h) => h.start), ...a.timeline.filter((e) => ['spawn', 'hit', 'release'].includes(e.action) && e.when === 'at').map((e) => e.at));
    if (Number.isFinite(first)) assert.ok(first >= row.minStartup, `${label} ${n} startup ${first}`);
    for (const h of a.hitboxes) {
      assert.ok(h.damage <= row.maxHit + 1e-9 && h.damage <= 25, `${label} ${n} hit ${h.damage}`);
      assert.ok(h.knockback <= 90 && h.growth <= 130);
      assert.ok(h.end - h.start <= ACTION_LIMITS.maxActive);
      assert.ok(h.rehit === null || h.rehit >= 3);
      if (h.kind === 'strike') {
        const ko = estimateKoPercent(h, { floor: row.koFloor, canCharge: !!a.charge });
        assert.ok(ko >= row.koFloor || (ko === Infinity), `${label} ${n} KO ${ko} < ${row.koFloor}`);
      }
    }
    for (const e of a.timeline) if (e.action === 'release') assert.ok(e.args.hit.damage <= row.maxHit + 1e-9);
    const intang = a.intangible.reduce((s, [x, y]) => s + y - x + 1, 0);
    assert.ok(intang <= ACTION_LIMITS.intangibleMax, `${label} ${n} intangible ${intang}`);
    for (const w of a.armor) assert.ok(w.threshold <= ACTION_LIMITS.armorMax);
    for (const v of a.velocity) assert.ok((v.vx === null || Math.abs(v.vx) <= MOVEMENT_LIMITS.maxVx) && (v.vy === null || Math.abs(v.vy) <= MOVEMENT_LIMITS.maxVy));
    if (rep.reach !== undefined) assert.ok(rep.reach <= (REACH_BEYOND[a.category] ?? 105) + 1, `${label} ${n} reach ${rep.reach}`);
  }
  for (const [n, h] of Object.entries(c.hitboxes)) assert.ok(h.damage <= 25 && h.knockback <= 90 && h.growth <= 130, `${label} template ${n}`);
  for (const [n, e] of Object.entries(c.entities)) {
    const L = ENTITY_LIMITS[kindKey(e)];
    const maxLife = e.kind === 'part' ? (e.relay >= 1 ? Infinity : L.partLife) : L.maxLife;
    assert.ok(e.life <= maxLife && e.hp <= (L.maxHp || 0), `${label} entity ${n}`);
    assert.ok(e.maxAlive === null || e.maxAlive <= ENTITY_RULES.maxAlive);
    if (e.kind === 'part') assert.ok(e.relay >= 0.5 && e.relay <= 1);
    if (e.kind === 'beam') assert.ok(e.length === null || e.length <= 520);
    for (const h of e.hitboxes) {
      assert.ok(h.damage <= L.maxHit + 1e-9, `${label} entity ${n} hit ${h.damage}`);
      if (h.rehit !== null && L.minRehit) assert.ok(h.rehit >= L.minRehit);
    }
    if (e.every) assert.ok(e.every.frames >= ENTITY_RULES.minEvery);
  }
  for (const s of Object.values(c.statuses)) {
    assert.ok(s.frames >= 1 && s.frames <= STATUS_LIMITS.frames[1]);
    if (s.control) assert.ok(s.frames <= STATUS_CAPS.control[s.control].max);
    for (const [k, v] of Object.entries(s.mods)) assert.ok(v >= MOD_RANGES[k][0] && v <= MOD_RANGES[k][1], `${label} mod ${k} ${v}`);
    if (s.dot) assert.ok(s.dot.every >= 15 && s.dot.damage <= 0.5);
    if (s.heal) assert.ok(s.heal.every >= 30 && s.heal.amount <= 1);
  }
  assert.ok(Object.keys(c.resources).length <= STATUS_LIMITS.maxResources);
  for (const r of Object.values(c.resources)) {
    assert.ok(r.max >= 1 && r.max <= 1000 && r.start >= r.min && r.start <= r.max);
    if (r.soak) assert.ok(r.soak.fraction <= 0.5 && r.soak.costPerDamage >= 0.5);
  }
  assert.ok(Object.keys(c.vars).length <= STATUS_LIMITS.maxVars && c.sync.length <= STATUS_LIMITS.maxSync);
}

// ── Examples ────────────────────────────────────────────────────────────────
for (const [id, def] of Object.entries(EX)) {
  t(`${id}: loads with 0 errors, all invariants, IR contract`, () => {
    const r = run(def, { expectedId: id });
    assert.deepEqual(r.errors, []);
    checkInvariants(r, id);
    const c = r.character;
    assert.equal(c.version, 2);
    assert.equal(c.name, c.meta.name);
    assert.equal(c.stats, c.forms.base.stats);
    assert.equal(c.body, c.forms.base.body);
    for (const f of c.tables.forms) assert.deepEqual([c.forms[f].stats.width, c.forms[f].stats.height], [c.forms[f].body.collider.w, c.forms[f].body.collider.h]);
    for (const n of c.tables.moves) {
      const ph = c.report.moves[n].phases;
      assert.ok(Array.isArray(ph) && ph[0].name === 'startup' && ph[ph.length - 1].to === c.moves[n].duration, `${id} ${n} phases`);
    }
    for (const [s, A] of Object.entries(c.report.area)) assert.equal(A, unionArea(c.forms.base.body.hurtboxes[s]));
    assert.ok(formatReport(r, { explain: true }).length > 3);
  });
}

t('notes are coded objects that stringify to one line', () => {
  const r = run(EX.nimbus, { expectedId: 'nimbus' });
  assert.ok(r.notes.length > 0);
  for (const n of r.notes) {
    assert.equal(typeof n.text, 'string');
    assert.equal(String(n), n.text);
    assert.ok(['warn', 'info'].includes(n.severity) && typeof n.why === 'string' && typeof n.fix === 'string');
    assert.ok(!n.text.includes('\n'));
  }
  const w = r.notes.find((n) => n.code === 'W230');
  assert.ok(w && w.path === 'hitboxes.megabolt.damage' && w.from === 13 && w.to === 12 && /maxHit/.test(w.rule));
});

// ── The v2 "9999" cheater ───────────────────────────────────────────────────
function cheaterData() {
  const huge = { damage: 9999, angle: 45, knockback: 9999, growth: 9999, setKnockback: 9999, shieldMul: 99, hitlagMul: 99 };
  const move = (extra = {}) => ({
    duration: 1, intangible: [[0, 999], [5, 500]], armor: [{ from: 0, to: 999, threshold: 999 }], gravity: [{ from: 0, to: 99, scale: 0.01 }],
    landingLag: -5, hold: { button: 'attack', from: 0, to: 999, max: 99999 }, charge: { button: 'strong', at: 0, max: 9999 },
    velocity: [{ start: 0, end: 200, vx: 999, vy: -999 }],
    hitboxes: [{ start: 0, end: 999, x: 900, y: -40, r: 9999, rehit: 1, ...huge, status: { name: 'stun', frames: 9999 } },
      { start: 0, end: 999, shape: 'capsule', x1: 0, y1: -40, x2: 2000, y2: -40, r: 300, ...huge, group: 7 }],
    timeline: [
      { from: 0, to: 999, every: 1, spawn: 'bullet', x: 900, y: -900, vx: 999, count: 99 },
      { from: 0, to: 999, every: 1, hit: 'nuke', shape: 'circle', x: 999, y: 0, r: 999, frames: 999 },
      { at: 0, teleport: { dx: 9999, dy: -9999 } }, { at: 0, intangible: 999 }, { at: 0, armor: { frames: 999, threshold: 999 } },
      { from: 0, to: 999, steer: { speed: 99, turn: 9 } }, { at: 0, impulse: { vx: 99, vy: -99 } }, { at: 0, camera: { shake: 99 } },
    ],
    ...extra,
  });
  return {
    id: 'cheaty', name: 'A Cheater Who Has An Extremely Long Name', description: 'x'.repeat(999), author: 'y'.repeat(99),
    body: {
      collider: { w: 9999, h: 1 },
      hurtboxes: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i ? `s${i}` : 'default', Array.from({ length: 9 }, () => ({ shape: 'circle', x: 9999, y: 9999, r: 0.1 }))])),
      scaleRange: [0.01, 99], armor: { threshold: 99 },
    },
    stats: { weight: 9999, runSpeed: 9999, airSpeed: 9999, jumpHeight: 9999, doubleJumpHeight: 9999, airJumps: 99, gravity: 9999, fallSpeed: 9999 },
    movement: { hover: { frames: 9999, fallSpeed: 0, drift: 99 }, glide: { frames: 9999, speed: 99 }, fly: { fuel: 9999, thrust: 99, maxRise: 99 }, wallCling: { frames: 9999, jumpVy: 99 }, crawl: { frames: 9999, speed: 99 } },
    resources: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`r${i}`, { max: 99999, start: -5, regen: 9999, soak: { fraction: 1, costPerDamage: 0 } }])),
    vars: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`v${i}`, i % 2 ? 'z'.repeat(99) : 1e12])),
    sync: Array.from({ length: 40 }, (_, i) => `v${i}`),
    statuses: {
      doom: { frames: 9999, maxStacks: 99, mods: { speed: 99, jump: 99, gravity: 0, fallSpeed: 99, damageIn: 0, damageOut: 99, knockbackIn: 99 }, dot: { every: 1, damage: 99 }, heal: { every: 1, amount: 99 } },
      lock: { frames: 9999, control: 'stun' },
    },
    hitboxes: { nuke: { ...huge, status: 'doom' } },
    entities: {
      bullet: { kind: 'projectile', shape: { r: 999 }, life: 99999, hp: 9999, maxAlive: 999, motion: { type: 'homing', speed: 999, turn: 9 }, maxHits: 99, pierce: 99,
        hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 999, use: 'nuke', rehit: 1 }], every: { frames: 1, spawn: 'bullet', x: 9999, y: 9999 } },
      pool: { kind: 'zone', shape: { r: 50 }, life: 99999, hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 200, ...huge, rehit: 1 }] },
      ray: { kind: 'beam', shape: { shape: 'capsule', x1: 0, y1: 0, x2: 9999, y2: 0, r: 999 }, life: 99999, length: 9999, width: 999,
        hitboxes: [{ shape: 'capsule', x1: 0, y1: 0, x2: 9999, y2: 0, r: 999, ...huge, rehit: 1 }] },
      wall: { kind: 'part', shape: { r: 40 }, life: 99999, hp: 9999, relay: 0, hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 20, ...huge }] },
      twin: { kind: 'clone', shape: { r: 20 }, life: 99999, hp: 9999, scale: 0.01 },
    },
    moves: Object.fromEntries(TRIGGERS.map((tr) => [tr, move()])),
  };
}
const cheater = () => defineCharacter(cheaterData());

t('v2 cheater "9999": loads and every budget/limit holds', () => {
  const r = run(cheater(), {});
  assert.deepEqual(r.errors, []);
  checkInvariants(r, 'cheater');
  const c = r.character;
  assert.ok(c.meta.name.length <= 18 && c.meta.description.length <= 220);
  for (const n of V1_SLOTS) for (const e of c.moves[n].timeline) {
    if (e.action === 'spawn') assert.ok(e.args.count <= ENTITY_RULES.maxCount && Math.hypot(e.args.x, e.args.y + c.forms.base.body.collider.h / 2) <= ENTITY_RULES.maxSpawnOffset + 0.5);
    if (e.action === 'teleport') assert.ok(Math.hypot(e.args.dx, e.args.dy) <= ACTION_LIMITS.teleport + 0.5);
    if (e.action === 'steer') assert.ok(e.args.speed <= 12 && e.args.turn <= 0.3);
    if (e.action === 'intangible') assert.ok(e.args.frames <= ACTION_LIMITS.intangibleMax);
  }
  for (const f of c.tables.forms) assert.ok(c.report.forms[f].statPoints.total <= STAT_BUDGET);
  assert.ok(c.report.movePower <= MOVE_BUDGET, `power ${c.report.movePower}`);
  assert.ok(new Set(codes(r)).size >= 30, `many distinct note codes: ${[...new Set(codes(r))].join(' ')}`);
});

// ── Determinism ─────────────────────────────────────────────────────────────
t('deterministic: two runs → identical JSON (examples, cheater, fuzz)', () => {
  for (const [id, def] of Object.entries(EX)) assert.equal(json(run(def, { expectedId: id })), json(run(def, { expectedId: id })), id);
  assert.equal(json(run(cheater())), json(run(cheater())));
  const rng = mulberry32(77);
  for (let i = 0; i < 8; i++) { const d = fuzz(rng, i); assert.equal(json(run(d, {})), json(run(d, {})), `fuzz ${i}`); }
});
t('validation never mutates or freezes the input', () => {
  const src = JSON.parse(JSON.stringify({ ...cheaterData() }));
  const def = defineCharacter(src);
  const before = JSON.stringify(def);
  run(def);
  assert.equal(JSON.stringify(def), before);
  assert.ok(!Object.isFrozen(def.moves) && !Object.isFrozen(def.moves.jab.hitboxes[0]));
});

// ── E0xx structural errors (all codes the validator can raise) ─────────────
const expectE = (r, code) => {
  assert.equal(r.ok, false);
  assert.equal(r.character, null);
  assert.ok(r.errors.some((e) => e.code === code), `expected ${code}, got ${r.errors.map((e) => e.code)}`);
  for (const e of r.errors) assert.ok(e.severity === 'error' && e.fix && String(e) === e.text);
};
t('E001 bad / mismatched id (v2 and v1)', () => {
  expectE(run(base({ id: 'Bad Id' })), 'E001');
  expectE(run(base({ id: 'other' }), { expectedId: 'testy' }), 'E001');
  expectE(validateCharacter({ id: 'Bad ID!', name: 'x' }), 'E001');
});
t('E002 missing name', () => expectE(run(base({ name: undefined })), 'E002'));
t('E003 default export not an object', () => { expectE(validateCharacter(null), 'E003'); expectE(validateCharacter(42), 'E003'); expectE(validateCharacter('x'), 'E003'); });
t('E004 a getter throws while reading', () => {
  const d = base();
  Object.defineProperty(d, 'moves', { get() { throw new Error('boom'); }, enumerable: true });
  expectE(run(d), 'E004');
});
t('E010 slot names a missing move', () => expectE(run(base({ slots: { jab: 'nope' } })), 'E010'));
t('E011 unknown startForm / form slot', () => {
  expectE(run(base({ startForm: 'ghost' })), 'E011');
  expectE(run(base({ forms: { alt: { slots: { jab: 'nope' } } } })), 'E011');
});
t('E012 unknown entity reference', () => expectE(run(base({ moves: { jab: { duration: 20, timeline: [{ at: 5, spawn: 'ghost' }] } } })), 'E012'));
t('E013 unknown template', () => expectE(run(base({ moves: { jab: { duration: 20, hitboxes: [{ start: 3, end: 4, use: 'ghost' }] } } })), 'E013'));
t('E014 timeline entry with 0 or 2 actions', () => {
  expectE(run(base({ moves: { jab: { duration: 20, timeline: [{ at: 5 }] } } })), 'E014');
  expectE(run(base({ moves: { jab: { duration: 20, timeline: [{ at: 5, emit: 'a', sfx: 'b' }] } } })), 'E014');
});
t('E015 function where data is required', () => expectE(run(base({ stats: { weight: () => 9 } })), 'E015'));
t('E016 bad vars initializer', () => expectE(run(base({ vars: { v: { a: 1 } } })), 'E016'));
t('E017 move duration missing', () => expectE(run(base({ moves: { jab: { hitboxes: [] } } })), 'E017'));

// ── Scaler unit checks ──────────────────────────────────────────────────────
t('rules: MOVEMENT_MODES costs/ranges agree with schema.js; governor reads ENTITY_LIMITS', () => {
  for (const [m, spec] of Object.entries(MOVEMENT_MODES)) {
    assert.equal(SCHEMA_MODES[m].cost, spec.cost, m);
    for (const [k, r] of Object.entries(spec.ranges)) {
      const sr = SCHEMA_MODES[m].params[k].range;
      assert.equal(sr[0], r[0], `${m}.${k}`);
      if (typeof r[1] === 'number') assert.equal(sr[1], r[1], `${m}.${k}`);
    }
  }
  for (const [k, r] of Object.entries(STATUS_MOD_RANGES)) assert.deepEqual([...MOD_RANGES[k]], [...r]);
  for (const k of ['projectile', 'minion', 'trap', 'zone', 'zoneLingering', 'beam', 'clone']) assert.deepEqual([TIER[k].maxHit, TIER[k].koFloor], [ENTITY_LIMITS[k].maxHit, ENTITY_LIMITS[k].koFloor]);
  assert.throws(() => { REACH_BEYOND.jab = 999; });
  assert.throws(() => { ENTITY_LIMITS.projectile.maxHit = 99; });
});
t('area cost: v1 segment identical, small bodies pay up to 25, big bodies refund up to 10', () => {
  assert.equal(areaCost(5600), 0);
  assert.equal(areaCost(2900), 15);
  assert.ok(Math.abs(areaCost(4250) - 7.5) < 1e-9);
  assert.equal(areaCost(1600), 25);
  assert.equal(areaCost(100), 25);
  assert.ok(Math.abs(areaCost(14000) + 10) < 1e-9);
  assert.equal(areaCost(99999), -10);
});
t('startup shift moves hitboxes, timeline, velocity, windows and duration together', () => {
  const r = run(base({ moves: { sideSmash: { duration: 40, velocity: [{ start: 2, end: 6, vx: 4 }], intangible: [3, 5],
    hitboxes: [{ start: 4, end: 7, x: 40, y: -40, r: 20, damage: 10, angle: 40, knockback: 20, growth: 40 }],
    timeline: [{ at: 4, emit: 'boom' }, { from: 5, to: 8, sfx: 'x' }], cancels: [{ from: 20, to: 25, into: ['jump'] }] } } }));
  const a = r.character.moves.sideSmash;
  assert.ok(codes(r).includes('W202'));
  assert.deepEqual([a.hitboxes[0].start, a.hitboxes[0].end], [10, 13]);
  assert.deepEqual([a.timeline[0].at, a.timeline[1].from, a.timeline[1].to], [10, 11, 14]);
  assert.deepEqual([a.velocity[0].start, a.velocity[0].end], [8, 12]);
  assert.deepEqual(a.intangible, [[9, 11]]);
  assert.deepEqual([a.cancels[0].from, a.cancels[0].to], [26, 31]);
  assert.equal(a.duration, 46);
  assert.equal(a.charge.at, Math.max(1, a.startup - 3));
});
t('reach is measured from the hurtbox union and pulled in along the center ray', () => {
  const body = { collider: { w: 60, h: 80 }, hurtboxes: { default: [{ shape: 'rect', x: 0, y: -40, w: 60, h: 80 }] } };
  const r = run(base({ body, moves: { jab: { duration: 20, hitboxes: [{ start: 3, end: 5, x: 200, y: -40, r: 10, damage: 3, angle: 40, knockback: 10, growth: 20 }] } } }));
  const h = r.character.moves.jab.hitboxes[0];
  assert.ok(codes(r).includes('W215'));
  assert.ok(Math.abs(reachBeyond(h, body.hurtboxes.default) - REACH_BEYOND.jab) < 0.6, `${reachBeyond(h, body.hurtboxes.default)}`);
  assert.ok(Math.abs(h.y + 40) < 0.01, 'stays on the center ray');
  // A big body reaches further in absolute terms without a note.
  const big = { collider: { w: 120, h: 120 }, hurtboxes: { default: [{ shape: 'rect', x: 0, y: -60, w: 120, h: 120 }] } };
  const r2 = run(base({ body: big, moves: { jab: { duration: 20, hitboxes: [{ start: 3, end: 5, x: 124, y: -60, r: 5, damage: 3, angle: 40, knockback: 10, growth: 20 }] } } }));
  assert.ok(!codes(r2).includes('W215'));
});
t('maxTotal counts rehits, timeline hits and 0.5 × spawned entity damage', () => {
  const r = run(base({
    hitboxes: { zap: { damage: 4, angle: 40, knockback: 10, growth: 10 } },
    entities: { orb: { kind: 'projectile', life: 60, hitboxes: [{ r: 8, damage: 8, angle: 40, knockback: 10, growth: 20 }] } },
    moves: { jab: { duration: 40, hitboxes: [{ start: 3, end: 11, x: 30, y: -40, r: 15, damage: 2, angle: 40, knockback: 5, growth: 5, rehit: 3 }],
      timeline: [{ at: 12, hit: 'zap', x: 30, y: -40, r: 10 }, { at: 14, spawn: 'orb', x: 30, y: -40, vx: 6 }] } },
  }));
  const rep = r.character.report.moves.jab;
  // own: 2 × ceil(9/3)=6 + zap 4 = 10; entities: 8 × 1 × 0.5 = 4 → 14 > jab maxTotal 9 → scaled
  assert.ok(codes(r).includes('W211'));
  assert.ok(rep.totalDamage <= CATEGORIES.jab.maxTotal + 0.01, `${rep.totalDamage}`);
});
t('upSpecial rise ≤ 300 px, other moves ≤ 120 px (form gravity in the coast term)', () => {
  const r = run(base({ stats: { gravity: 0.5 }, moves: { upSpecial: { duration: 50, velocity: [{ start: 5, end: 40, vy: -15 }] }, side: { duration: 30, velocity: [{ start: 5, end: 20, vy: -12 }] } } }));
  assert.ok(r.character.report.moves.upSpecial.rise <= 300 + 1 && r.character.report.moves.side.rise <= 120 + 1);
  assert.equal(codes(r).filter((c) => c === 'W302').length, 2);
});
t('templates are clamped once against the strictest user; inline overrides stay', () => {
  const r = run(base({
    hitboxes: { slam: { damage: 14, angle: 40, knockback: 30, growth: 60 } },
    entities: { pool: { kind: 'zone', life: 200, hitboxes: [{ r: 30, use: 'slam', rehit: 30 }] } },
    moves: { jab: { duration: 20, hitboxes: [{ start: 3, end: 5, x: 30, y: -40, r: 15, use: 'slam', damage: 2 }] }, downSpecial: { duration: 30, timeline: [{ at: 8, spawn: 'pool', x: 40, y: 0 }] } },
  }));
  const c = r.character;
  assert.equal(c.hitboxes.slam.damage, ENTITY_LIMITS.zoneLingering.maxHit);
  assert.equal(c.entities.pool.hitboxes[0].damage, ENTITY_LIMITS.zoneLingering.maxHit);
  assert.equal(c.moves.jab.hitboxes[0].damage, 2, 'inline override kept');
});
t('pummel gets setKnockback 0; grab boxes deal 0; throws KO no earlier than 130%', () => {
  const r = run(base({ moves: {
    pummel: { duration: 16, timeline: [{ at: 5, release: { damage: 9, angle: 40, knockback: 50, growth: 50 } }] },
    grab: { duration: 30, hitboxes: [{ start: 7, end: 9, kind: 'grab', x: 40, y: -40, r: 20, damage: 50 }] },
    fthrow: { duration: 30, timeline: [{ at: 12, release: { damage: 30, angle: 40, knockback: 90, growth: 130 } }] },
  } }));
  const c = r.character;
  const pr = c.moves.pummel.timeline[0].args.hit;
  assert.equal(pr.setKnockback, 0);
  assert.ok(pr.damage <= 3);
  assert.equal(c.moves.grab.hitboxes[0].damage, 0);
  const th = c.moves.fthrow.timeline[0].args.hit;
  assert.ok(th.damage <= 12 && estimateKoPercent(th, { floor: 130 }) >= 130);
});
t('statuses / resources / vars clamp into range', () => {
  const r = run(base({
    statuses: { s: { frames: 999, mods: { speed: 5, damageIn: 0.1 }, dot: { every: 2, damage: 3 } }, st: { frames: 200, control: 'stun' } },
    resources: { m: { max: 5000, start: 9000, soak: { fraction: 0.9, costPerDamage: 0.1 } } },
    vars: { name: 'x'.repeat(40), big: 1e9 }, sync: ['name'],
  }));
  const c = r.character;
  assert.deepEqual([c.statuses.s.frames, c.statuses.s.mods.speed, c.statuses.s.mods.damageIn, c.statuses.s.dot.every, c.statuses.s.dot.damage], [300, 1.25, 0.85, 15, 0.5]);
  assert.equal(c.statuses.st.frames, 40);
  assert.deepEqual([c.resources.m.max, c.resources.m.start, c.resources.m.soak.fraction, c.resources.m.soak.costPerDamage], [1000, 1000, 0.5, 0.5]);
  assert.deepEqual([c.vars.name.length, c.vars.big], [24, 1e6]);
});
t('body: tiny bodies grow to 1600 px² (25 pts), giants shrink to 16000, scaleRange/armor clamp', () => {
  const tiny = run(base({ body: { collider: { w: 20, h: 20 }, hurtboxes: { default: [{ shape: 'circle', x: 0, y: -10, r: 10 }] }, scaleRange: [0.2, 3], armor: { threshold: 9 } } }));
  const fr = tiny.character.report.forms.base;
  assert.ok(fr.pricedArea >= 1600 && fr.statPoints.breakdown.hurtboxArea >= 24.5, JSON.stringify(fr));
  assert.deepEqual([...tiny.character.forms.base.body.scaleRange], [0.6, 1.6]);
  assert.equal(tiny.character.forms.base.armor.threshold, 3);
  const giant = run(base({ body: { collider: { w: 160, h: 200 }, hurtboxes: { default: [{ shape: 'rect', x: 0, y: -100, w: 160, h: 200 }] } } }));
  assert.ok(giant.character.report.forms.base.pricedArea <= 16000 && codes(giant).includes('W133'));
  assert.equal(giant.character.report.forms.base.statPoints.breakdown.hurtboxArea, -10);
});
t('forms are priced separately; inherited mistakes are noted once', () => {
  const r = run(base({ stats: { weight: 999 }, forms: { a: { slots: {} }, b: { slots: {}, stats: { runSpeed: 99 } } } }));
  assert.equal(codes(r).filter((c) => c === 'W110').length, 2, codes(r).join(' '));
  for (const f of ['base', 'a', 'b']) assert.ok(r.character.report.forms[f].statPoints.total <= STAT_BUDGET);
});
t('report.area only lists sets that are identical across forms; areaByForm has all', () => {
  const r = run(EX.gloop, { expectedId: 'gloop' });
  const c = r.character;
  assert.ok(!('default' in c.report.area), 'default differs between gloop forms');
  for (const f of c.tables.forms) assert.ok(typeof c.report.areaByForm[f].default === 'number');
});

// ── IR contract the sim reads (actions.js header, hurtbox.js, fighter.js, input-map.js) ──
t('IR satisfies the sim contract for every example and generic move', () => {
  const isN = (v) => typeof v === 'number' && Number.isFinite(v);
  for (const [id, def] of Object.entries({ ...EX, testy: base() })) {
    const c = run(def, { expectedId: id }).character;
    for (const f of c.tables.forms) {
      const F = c.forms[f];
      for (const k of ['weight', 'runSpeed', 'airSpeed', 'jumpHeight', 'doubleJumpHeight', 'airJumps', 'gravity', 'fallSpeed', 'width', 'height']) assert.ok(isN(F.stats[k]), `${id} ${f} stats.${k}`);
      assert.ok(isN(F.body.collider.w) && isN(F.body.collider.h) && F.body.hurtboxes.default.length && F.body.hurtboxes.crouch);
    }
    for (const [n, a] of Object.entries(c.moves)) {
      const P = `${id} ${n}`;
      assert.ok(typeof a.category === 'string' && Number.isInteger(a.duration) && isN(a.startup), P);
      assert.ok(a.charge === null || (typeof a.charge.button === 'string' && Number.isInteger(a.charge.at) && a.charge.at >= 1 && isN(a.charge.max)), `${P} charge`);
      assert.equal(typeof a.helpless, 'boolean');
      assert.equal(typeof a.oncePerAirtime, 'boolean');
      assert.ok(Array.isArray(a.intangible) && a.intangible.every((w) => Array.isArray(w) && w.length === 2));
      assert.ok(a.landingLag === null || Number.isInteger(a.landingLag));
      for (const h of a.hitboxes) {
        assert.ok(['circle', 'capsule', 'rect'].includes(h.shape), `${P} shape`);
        for (const k of ['start', 'end', 'group', 'damage', 'angle', 'knockback', 'growth']) assert.ok(isN(h[k]), `${P} hitbox.${k}`);
        assert.ok(h.rehit === null || h.rehit >= 3);
      }
      for (const v of a.velocity) assert.ok(Number.isInteger(v.start) && Number.isInteger(v.end) && (v.vx === null || isN(v.vx)) && (v.vy === null || isN(v.vy)) && ['set', 'add'].includes(v.mode));
      for (const e of a.timeline) {
        if (e.action === 'spawn') assert.ok(c.entities[e.args.entity], `${P} spawn ref`);
        if (e.action === 'hit') assert.ok(c.hitboxes[e.args.template], `${P} hit ref`);
      }
      assert.equal(a.projectiles, undefined, 'v2 actions use timeline spawns, not inline projectiles');
    }
  }
});
t('engine generic moves pass the v2 clamps untouched', () => {
  const r = run(base());
  const generic = r.notes.filter((n) => /^moves\.(grab|pummel|[fbud]throw|taunt|up|down|side|[a-z]+Smash|[a-z]air|[a-z]+Special)\b/.test(n.path) && n.code[0] === 'W');
  assert.deepEqual(generic.map(String), []);
});

// ── v2 fuzz: garbage never throws, valid output always within limits ───────
function fuzz(rng, i) {
  const r = (a, b) => a + (b - a) * rng();
  const pick = (l) => l[Math.floor(rng() * l.length)];
  const wild = () => pick([r(-50, 50), r(0, 300), 9999, -1, 0, r(0, 30)]);
  const shape = () => pick([{ r: wild() }, { shape: 'capsule', x1: wild(), y1: -wild(), x2: wild(), y2: -wild(), r: r(1, 60) }, { shape: 'rect', x: wild(), y: -wild(), w: r(1, 300), h: r(1, 300) }]);
  const hit = () => ({ ...shape(), start: Math.round(r(-3, 40)), end: Math.round(r(0, 80)), damage: wild(), angle: r(0, 360), knockback: wild(), growth: wild(), rehit: rng() < 0.3 ? Math.round(r(0, 20)) : undefined });
  const moves = {};
  for (const tr of TRIGGERS) if (rng() < 0.7) moves[tr] = { duration: Math.round(r(1, 200)), hitboxes: Array.from({ length: Math.floor(r(0, 4)) }, hit), velocity: rng() < 0.3 ? [{ start: 1, end: Math.round(r(1, 60)), vx: wild(), vy: -wild() }] : [], timeline: rng() < 0.3 ? [{ at: Math.round(r(0, 30)), spawn: 'e' }] : [] };
  return defineCharacter({
    id: `fz${i}`, name: `Fuzz ${i}`,
    body: rng() < 0.5 ? { collider: { w: r(1, 300), h: r(1, 300) }, hurtboxes: { default: Array.from({ length: Math.floor(r(1, 9)) }, shape) }, scaleRange: [r(0, 2), r(0, 2)] } : undefined,
    stats: { weight: wild(), runSpeed: wild(), airJumps: wild(), gravity: r(0, 2) },
    entities: { e: { kind: pick(['projectile', 'minion', 'trap', 'zone', 'beam', 'part']), life: Math.round(r(1, 3000)), hp: wild(), shape: shape(), hitboxes: [hit()], motion: { type: 'linear', speed: wild() } } },
    moves,
  });
}
t('v2 fuzz: 60 seeded garbage kits load within every limit', () => {
  const rng = mulberry32(0xBEEF);
  for (let i = 0; i < (+process.env.FUZZ || 60); i++) {
    const d = fuzz(rng, i);
    const res = validateCharacter(d, {});
    if (res.ok) checkInvariants(res, `fuzz ${i}`);
    else for (const e of res.errors) assert.match(e.code, /^E0\d\d$/);
  }
});

console.log(`${process.exitCode ? '✘' : '✔'} validate-v2: ${pass} passed`);
