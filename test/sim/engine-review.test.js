// Regression tests for the engine review findings (exploit / correctness / freedom lenses):
// hurtbox-on-body, api.hit gating + pricing, minion swarm pricing/runtime, hitstun uptime,
// wind directions + gate, entity lists, slot functions, height-aware KO floor, stuck
// self-velocity, side-effect-free snapshots, reflect, clones, entity launch direction, respawn.
//   node --test test/sim/engine-review.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCharacter } from '../../shared/balance/validate.js';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { Game } from '../../shared/sim/game.js';
import { applyHit, applyWind } from '../../shared/sim/hits.js';
import { startAction } from '../../shared/sim/actions.js';
import { ko, updateDead } from '../../shared/sim/fighter.js';
import * as E from '../../shared/sim/entities.js';
import { entityDamage, windDisplacement, scriptedPower } from '../../shared/balance/v2/score.js';
import { colliderCoverage } from '../../shared/balance/v2/body.js';
import { GOVERNOR as G, TIER } from '../../shared/balance/governor-rules.js';
import stage from '../../shared/stages/sky-sanctum.js';
import gloop from '../fixtures/gloop/character.js';
import { newGame, steps, forceAction } from '../entities/helpers.js';

const STATS = { weight: 100, runSpeed: 6, airSpeed: 4.5, jumpHeight: 14, doubleJumpHeight: 13, airJumps: 1, gravity: 0.75, fallSpeed: 12 };
const JAB = { duration: 18, hitboxes: [{ start: 3, end: 6, x: 34, y: -50, r: 22, damage: 3, angle: 40, knockback: 12, growth: 20 }] };
const kit = (id, extra = {}) => ({ version: 2, id, name: id, stats: STATS, body: { collider: { w: 52, h: 92 } }, moves: { jab: JAB }, ...extra });
const valid = (def) => { const r = validateCharacter(def, { expectedId: def.id }); assert.ok(r.ok, r.errors.map(String).join('; ')); return r; };
const codes = (r, code) => r.notes.filter((n) => n.code === code);
const irOf = (def) => { const { draft, errors } = normalize(def); assert.deepEqual(errors, []); return buildIR(draft); };
function duel(c1, c2 = c1, rules = {}) {
  const g = new Game({ stage, rules: { countdown: false, stocks: 3, scriptTiming: false, ...rules }, players: [{ id: 'p1', name: 'A', character: c1 }, { id: 'p2', name: 'B', character: c2 }] });
  g.step(); g.drainEvents();
  return g;
}
const hitsOn = (ev, id) => ev.filter((e) => e.type === 'hit' && e.target === id);

// ── Phantom: hurtboxes must sit on the collider ─────────────────────────────
test('a hurtbox floating away from a thin tall collider is moved onto the body (W136)', () => {
  const r = valid(kit('phantom', { body: { collider: { w: 40, h: 200 }, hurtboxes: { default: [{ shape: 'circle', x: -370, y: -470, r: 24 }] } } }));
  assert.equal(codes(r, 'W136').length, 1);
  const cv = colliderCoverage(r.character.body.hurtboxes.default, r.character.body.collider);
  assert.ok(cv.center || cv.cover >= 0.2 || cv.inside >= 0.5, JSON.stringify(cv));
  // Honest bodies (crouch rects, tails) stay untouched.
  const ok = valid(kit('snake', { body: { collider: { w: 80, h: 40 }, hurtboxes: { default: [{ shape: 'capsule', x1: -90, y1: -20, x2: 60, y2: -20, r: 20 }] } } }));
  assert.equal(codes(ok, 'W136').length, 0);
});

// ── api.hit from hooks: gated, rate-floored, priced ─────────────────────────
const porcupine = (reach = 130) => kit('porcupine', {
  hitboxes: { spine: { damage: 15, angle: 45, knockback: 40, growth: 100 } },
  behavior: { tick(view, api) {
    const e = view.nearestEnemy();
    if (e && Math.hypot(e.x - view.me.x, e.y - view.me.y) < reach) {
      api.hit('spine', { shape: 'circle', x: 0, y: -46, r: 42 }, { frames: 1 });
      api.hit('spine', { shape: 'circle', x: 60, y: -46, r: 42 }, { frames: 1 });
    }
  } },
});

test('api.hit from tick: utility tier when idle, one hit per target per 120 frames, priced in the budget', () => {
  const r = valid(porcupine());
  assert.ok(r.report.forms.base.perTrigger.scripts > 0, 'scripted hits are priced');
  const g = duel(r.character, valid(kit('dummy')).character);
  const [a, b] = g.fighters;
  a.x = 0; a.facing = 1; b.x = 50;
  const ev = steps(g, 240, () => { b.percent = Math.min(b.percent, 50); b.x = 50; b.state = b.state === 'hitstun' ? 'idle' : b.state; b.hitstun = 0; });
  const hs = hitsOn(ev, 'p2');
  assert.ok(hs.length >= 2 && hs.length <= 3, `hits in 240 frames: ${hs.length}`);
  for (const h of hs) assert.ok(h.damage <= TIER.utility.maxHit * G.perHitTierMul + 1e-9, `damage ${h.damage}`);
});

test('api.hit from tick is refused while the fighter is in hitstun or shielding', () => {
  const r = valid(porcupine());
  const g = duel(r.character, valid(kit('dummy')).character);
  const [a, b] = g.fighters;
  a.x = 0; b.x = 50; a.state = 'hitstun'; a.hitstun = 999;
  const ev = steps(g, 60, () => { a.state = 'hitstun'; a.hitstun = 999; });
  assert.equal(hitsOn(ev, 'p2').length, 0);
  assert.ok(ev.some((e) => e.type === 'gov' && e.rule === 'scriptHit'));
});

// ── Minions: priced per rehit window, swarm shares one timer ────────────────
test('long-lived minions are priced for their rehits; one owner\'s minions share a per-target rehit timer', () => {
  const bee = { kind: 'minion', life: 1200, maxHits: 1, pierce: 0, hitboxes: [{ start: 0, end: 1200, rehit: 20, damage: 6, group: 0, kind: 'strike' }] };
  assert.ok(entityDamage(bee) >= 6 * 4, `bee damage ${entityDamage(bee)}`);
  const g = newGame();
  const [a, b] = g.fighters;
  a.x = -400; b.x = 200; b.invuln = 0;
  for (let i = 0; i < 3; i++) E.spawn(a, 'thug', { worldX: 200, worldY: 0, source: 'script' });
  const ev = steps(g, 19, () => { b.x = 200; b.hitstun = 0; });
  assert.equal(hitsOn(ev, 'p2').length, 1, 'three overlapping minions land one hit per 20 frames');
});

test('hitstun uptime: past the lock budget, hits launch but deal no hitstun', () => {
  const g = newGame();
  const [a, b] = g.fighters;
  for (let i = 0; i < G.lockUptime.max; i++) b.gov ? b.gov.lockWin.add(g.frame, 1) : g.gov.state(b).lockWin.add(g.frame, 1);
  const r = g.gov.applyHit({ attacker: a, target: b, hb: { damage: 5, angle: 45, knockback: 30, growth: 50 }, tier: 'special', dir: 1 });
  assert.equal(r.hitstun, 0);
  assert.ok(r.gov.includes('lock'));
});

// ── Wind ────────────────────────────────────────────────────────────────────
test('wind: toward pulls in 2D, angle lifts, offstage targets are never pushed out below the floor', () => {
  const g = newGame();
  const [a, b] = g.fighters;
  const at = (x, y, windDir, angle = 0) => {
    b.x = x; b.y = y; b.kx = 0; b.ky = 0; b.grounded = y === 0; b.state = y === 0 ? 'idle' : 'air'; b.percent = 0;
    applyWind(g, { attacker: a, target: b, hb: { kind: 'wind', push: 6, windDir, angle }, x: 0, y: -46, dir: 1, kind: 'wind', tier: 'special', slot: 's' });
    return { kx: b.kx, ky: b.ky };
  };
  assert.ok(at(-120, 0, 'toward').kx > 0, 'pulled right toward the center');
  assert.ok(at(120, 0, 'toward').kx < 0, 'pulled left toward the center');
  assert.ok(at(200, 0, 'angle', 90).ky < 0, 'updraft');
  assert.equal(at(700, -60, 'facing').kx, 0, 'no push off the stage at 0%');
  assert.equal(at(100, -400, 'angle', 90).ky, 0, 'no lift above windLift');
  assert.ok(windDisplacement([{ kind: 'wind', push: 6, start: 0, end: 89, rehit: 8 }]) > 0);
});

// ── Entity lists ────────────────────────────────────────────────────────────
test('entity lists: hit / form / velocity run; unsupported actions are removed with W415; entity grab boxes get W416', () => {
  const def = {
    ...gloop,
    hitboxes: { ...(gloop.hitboxes || {}), splash: { damage: 8, angle: 45, knockback: 30, growth: 50 } },
    entities: { ...gloop.entities,
      bowl: { kind: 'part', shape: { shape: 'circle', r: 18 }, relay: 1, life: 30, motion: { type: 'attached' }, anchor: { x: 20, y: -40 },
        onExpire: [{ hit: 'splash', r: 50, x: 0, y: 0 }, { velocity: { vy: -10 } }, { intangible: 10 }] },
      hook: { kind: 'projectile', shape: { shape: 'circle', r: 8 }, life: 60, motion: { type: 'linear', speed: 6 }, hitboxes: [{ kind: 'grab', r: 12 }] },
    },
  };
  const r = validateCharacter(def, { expectedId: def.id });
  assert.ok(r.ok, r.errors.map(String).join('; '));
  assert.equal(codes(r, 'W415').length, 1);
  assert.equal(codes(r, 'W416').length, 1);
  const g = duel(r.character);
  const [a, b] = g.fighters;
  a.x = 0; a.facing = 1; b.x = 30; b.invuln = 0;
  E.spawn(a, 'bowl', { source: 'script' });
  const ev = steps(g, 34);
  assert.ok(hitsOn(ev, 'p2').length >= 1, 'onExpire splash hits');
  assert.ok(ev.some((e) => e.type === 'hit' && e.target === 'p2' && e.damage > 0));
});

// ── Slot functions ──────────────────────────────────────────────────────────
test('slot function candidates are routed (no I002/I006, trigger category) and priced', () => {
  const chord = (d) => ({ duration: 30, hitboxes: [{ start: 6, end: 9, x: 30, y: -40, r: 20, damage: d, angle: 45, knockback: 30, growth: 80 }] });
  const r = valid(kit('piano', { vars: { key: 0 }, moves: { jab: JAB, majorChord: chord(9), minorChord: chord(13) }, slots: { fair: (view) => (view.vars.key ? 'minorChord' : 'majorChord') } }));
  assert.ok(!r.notes.some((n) => n.code === 'I002' && n.path === 'moves.fair'));
  assert.ok(!r.notes.some((n) => n.code === 'I006' && /Chord/.test(n.path)));
  assert.equal(r.report.moves.minorChord.category, 'aerial');
  assert.equal(r.report.forms.base.perTrigger.fair, r.report.moves.minorChord.power);
});

// ── KO floor from raised positions ──────────────────────────────────────────
test('the KO floor is height-aware: a smash on the top platform below the floor does not KO', () => {
  const c = valid(kit('target')).character;
  const floor = Math.max(G.hardKoFloor, TIER.smash.koFloor);
  const g = duel(c);
  const [a, b] = g.fighters;
  a.x = -30; a.y = -335; b.x = 0; b.y = -335; b.platform = 2; b.grounded = true; b.percent = floor - 1; b.state = 'idle';
  applyHit(g, { attacker: a, target: b, hb: { damage: 25, angle: 90, knockback: 120, growth: 200 }, x: 0, y: -375, dir: 1, slot: 'upSmash', effect: 'normal', charge: 0, tier: 'smash', kind: 'strike', key: 'k' });
  const ev = steps(g, 300);
  assert.ok(!ev.some((e) => e.type === 'ko' && e.id === 'p2'));
});

// ── Self-velocity in hitstun ────────────────────────────────────────────────
test('scripts cannot write self-velocity during hitstun (no knockback cancel)', () => {
  const g = newGame();
  const [a, b] = g.fighters;
  b.state = 'hitstun'; b.vx = 0; b.vy = 0;
  const v = g.gov.selfVelocity(b, -18, -10, 'script');
  assert.equal(v.vx, 0); assert.equal(v.vy, 0);
  assert.ok(v.gov.includes('stuck'));
  b.state = 'air';
  assert.equal(g.gov.selfVelocity(b, -18, 0, 'script').vx, -18);
  void a;
});

// ── Snapshots are side-effect free ──────────────────────────────────────────
test('snapshots do not spend the intangibility budget', () => {
  const def = { key: 'iv', name: 'iv', category: 'special', duration: 60, hitboxes: [], velocity: [], projectiles: [], intangible: [[1, 50]], armor: [], hurtboxes: [], gravity: [], cancels: [], onAbsorb: [], timeline: [] };
  const left = (snap) => {
    const g = newGame();
    const [a, b] = g.fighters;
    a.x = -300; b.x = 300;
    startAction(a, def, { name: 'iv' });
    for (let i = 0; i < 40; i++) { g.step(); if (snap) g.snapshot(); }
    return g.gov.intangibleLeft(a);
  };
  assert.equal(left(true), left(false));
});

// ── Reflect ─────────────────────────────────────────────────────────────────
test('a reflected entity is a pure projectile: the author\'s think no longer runs under the reflector', () => {
  const seen = new Set();
  const def = { ...gloop, entities: { ...gloop.entities,
    bolt: { kind: 'projectile', shape: { shape: 'circle', r: 8 }, life: 200, collide: 'pass', motion: { type: 'linear', speed: 5 },
      hitboxes: [{ shape: 'circle', r: 8, damage: 5, angle: 45, knockback: 20, growth: 40 }], think(view) { seen.add(view.me.id); } } } };
  const ir = irOf(def);
  const g = duel(ir);
  const [a, b] = g.fighters;
  a.x = -100; a.facing = 1; b.x = 100; b.facing = -1;
  E.spawn(a, 'bolt', { x: 0, y: -40, source: 'script' });
  forceAction(b, [{ kind: 'reflect', shape: 'circle', x: 0, y: -40, r: 40, start: 0, end: 999 }], { duration: 999 });
  steps(g, 80, () => { b.action.frame = 1; b.state = 'attack'; });
  const bolt = g.entities.find((e) => e.name === 'bolt');
  assert.ok(!bolt || bolt.reflected || bolt.dead);
  assert.deepEqual([...seen], ['p1']);
  assert.equal(b.scriptsDisabled, false);
});

// ── Clones ──────────────────────────────────────────────────────────────────
test('clone timeline hits connect; clone-spawned bound/attached entities follow the clone', () => {
  const tl = (args) => ({ key: 'tl', name: 'tl', category: 'special', duration: 40, hitboxes: [], velocity: [], projectiles: [], intangible: [], armor: [], hurtboxes: [], gravity: [], cancels: [], onAbsorb: [], timeline: [{ when: 'at', at: 2, ...args }] });
  {
    const g = newGame(); const [p1, p2] = g.fighters;
    const e = E.spawn(p1, 'gloopling', { x: 300 });
    p1.x = -600; const m = e.minor; m.x = 0; m.y = 0; m.grounded = true; m.platform = -1; m.state = 'idle'; m.facing = 1; e.ring = []; e.delay = 60;
    p2.x = 40; p2.facing = -1;
    startAction(m, tl({ action: 'hit', args: { template: 'spine', shape: { shape: 'circle', x: 30, y: -30, r: 40 }, frames: 3 } }), { name: 'tl' });
    const ev = steps(g, 10);
    assert.equal(hitsOn(ev, 'p2').length, 1);
    assert.equal(m.extraHits.length, 0, 'clone boxes expire');
  }
  {
    const g = newGame(); const [p1, p2] = g.fighters; p2.x = 600; p2.invuln = 1e9;
    const e = E.spawn(p1, 'gloopling', { x: -100 }); steps(g, 61); e.delay = 60; e.ring = [];
    p1.x = -300; e.minor.x = -150;
    startAction(e.minor, tl({ action: 'spawn', args: { entity: 'laser', bindToMove: true } }), { name: 'tl' });
    steps(g, 6);
    const laser = g.entities.find((x) => x.name === 'laser' && E.alive(x));
    assert.ok(laser, 'bound laser survives while the clone performs the move');
    assert.ok(Math.abs(laser.x - (e.minor.x + 30 * e.minor.facing)) < 20, `laser on the clone (x ${laser.x}, clone ${e.minor.x})`);
  }
});

test('attached entity hits launch along the entity facing, not the owner drift', () => {
  const g = newGame(); const [a, b] = g.fighters;
  a.x = -100; a.facing = 1; b.x = 60; b.facing = -1;
  E.spawn(a, 'laser', {});
  let hit = null;
  for (let i = 0; i < 30 && !hit; i++) { a.vx = -3; a.facing = 1; g.step(); hit = g.drainEvents().find((e) => e.type === 'hit' && e.target === 'p2') || null; }
  assert.ok(hit); assert.equal(hit.dir, 1);
});

// ── Respawn ─────────────────────────────────────────────────────────────────
test('KO/respawn resets fastFall, the scripted hurtbox set and body scale', () => {
  const g = newGame(); const [a] = g.fighters;
  a.fastFall = true; a.hurtSet = 'crouch'; a.bodyScale = 1.2;
  ko(a, 'bottom');
  a.deadTimer = 1;
  updateDead(a);
  assert.equal(a.fastFall, false); assert.equal(a.hurtSet, null); assert.equal(a.bodyScale, 1);
});

// ── Script statuses are priced ──────────────────────────────────────────────
test('statuses scripts put on others are priced', () => {
  const def = kit('anchor', {
    statuses: { mute: { frames: 120, control: 'silence' } },
    behavior: { onHit(view, api, ev) { api.status(ev.targetId, 'mute'); } },
  });
  const r = valid(def);
  assert.ok(r.report.forms.base.perTrigger.scripts > 0);
  assert.ok(scriptedPower({ hitboxes: {}, moves: {}, entities: {}, behavior: def.behavior, statuses: def.statuses }) > 0);
});
