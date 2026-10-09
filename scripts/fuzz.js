#!/usr/bin/env node
// Fuzz (spec §5.7, §10.1). Two job types, run inside a worker thread with a kill
// timeout (a hung job is terminated and reported, never left spinning):
//   kit    a seeded garbage character (v1 or v2 shape, built from the schema tables
//          with junk sprinkled in, plus hooks that call the script API with junk).
//          validateCharacter must not throw; if the kit loads, it plays a short
//          random-input match against a roster character.
//   roster every real character in a seeded 4-player free-for-all with random inputs
//          and hard CPUs.
// Fails on: a throw, a hang, NaN/Infinity in a fighter or entity, percent outside
// [0, 999], stocks increasing, an unknown state, more than 8 live entities per
// owner, or (roster characters, and kits whose hooks never throw) scriptsDisabled.
//   npm run fuzz                       → long mode (300 kits, 60 s matches)
//   node scripts/fuzz.js --quick       → the npm test mode (≈ 5–10 s)
//   --seed N --kits N --matches N --seconds N --timeout ms --only kit|roster --json --verbose
// A failure prints the job (kind + seed) so `--seed` reproduces it exactly; the
// failing kit is also written to .cache/fuzz/<job>.json (functions as source).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);

// ── seeded generation (pure; no engine imports, so the main thread stays light) ──
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JUNK = [NaN, Infinity, -Infinity, -1, 0, 1e9, -1e9, 0.5, 1e-9, '12', '', 'x'.repeat(300), null, undefined, true, false,
  {}, [], [1, 2], { x: 1 }, 'ember', '__proto__', 'constructor', 'toString', -0, 2 ** 53, [[[]]], { a: { b: { c: {} } } }];

/** A small generator API around one seeded rng. */
function gen(rng, sloppy = 1) {
  const g = {
    rng, sloppy,
    chance: (p) => rng() < p,
    int: (a, b) => a + Math.floor(rng() * (b - a + 1)),
    num: (a, b) => a + rng() * (b - a),
    pick: (arr) => arr[Math.floor(rng() * arr.length)],
    junk: () => { const v = JUNK[Math.floor(rng() * JUNK.length)]; return v && typeof v === 'object' ? structuredClone(v) : v; },
    /** A number in a range most of the time, way outside it sometimes, junk rarely. */
    n: (a, b, junkP = 0.08) => (rng() < junkP * g.sloppy ? g.junk() : rng() < 0.15 * g.sloppy ? (rng() < 0.5 ? -1 : 1) * 10 ** g.int(2, 6) * rng() : g.num(a, b)),
    i: (a, b, junkP = 0.08) => (rng() < junkP * g.sloppy ? g.junk() : rng() < 0.12 * g.sloppy ? g.int(-50, 5000) : g.int(a, b)),
    /** A name from `list`, or a dangling/garbage reference (more often for sloppy kits). */
    ref: (list, ...bad) => (!list.length || (bad.length && rng() < 0.25 * g.sloppy) ? g.pick(bad.length ? bad : ['missing']) : g.pick(list)),
    maybe: (v, p = 0.5) => (rng() < p ? v : undefined),
  };
  return g;
}

const SLOTS = ['jab', 'side', 'up', 'down', 'sideSmash', 'upSmash', 'downSmash', 'nair', 'fair', 'bair', 'uair', 'dair', 'neutralSpecial', 'sideSpecial', 'upSpecial', 'downSpecial'];
const TRIGGERS = [...SLOTS, 'grab', 'pummel', 'fthrow', 'bthrow', 'uthrow', 'dthrow', 'taunt'];
const STATS = ['weight', 'runSpeed', 'airSpeed', 'jumpHeight', 'doubleJumpHeight', 'airJumps', 'fallSpeed', 'gravity', 'traction'];
const EFFECTS = ['punch', 'kick', 'slash', 'fire', 'ice', 'electric', 'magic', 'water', 'wind', 'dark', 'light', 'poison', 'earth', 'none', 'glitter'];
const SHAPES = ['circle', 'capsule', 'rect'];
const HIT_KINDS = ['strike', 'grab', 'wind', 'reflect', 'absorb'];
const ENTITY_KINDS = ['projectile', 'minion', 'trap', 'zone', 'beam', 'clone', 'part'];
const MOTIONS = ['ballistic', 'linear', 'homing', 'orbit', 'attached', 'stationary', 'walker', 'boomerang', 'mimic'];
const COLLIDE = ['die', 'bounce', 'stick', 'walk', 'pass'];
const BUTTONS = ['jump', 'attack', 'special', 'strong', 'shield', 'taunt', 'up', 'down', 'left', 'right'];
const HOOKS = ['init', 'tick', 'onHit', 'onHurt', 'onLand', 'onKO', 'onRespawn', 'onFormChange'];
const STATUS_MODS = ['speed', 'jump', 'gravity', 'fallSpeed', 'damageIn', 'damageOut', 'knockbackIn'];
const CONTROL = ['stun', 'freeze', 'root', 'silence', 'confuse'];
const BUILTIN_STATUS = ['burn', 'poison', 'freeze', 'stun', 'slow', 'root', 'silence', 'confuse', 'weaken', 'vulnerable', 'float', 'mark'];
const API_CALLS = ['startMove', 'cancelInto', 'endMove', 'velocity', 'impulse', 'teleport', 'spawn', 'despawn', 'command', 'hit', 'status', 'form',
  'setBodyScale', 'setHurtboxes', 'modify', 'armor', 'intangible', 'heal', 'emit', 'sfx', 'camera'];

function shape(g) {
  const s = g.chance(0.05) ? g.junk() : g.pick(SHAPES);
  if (s === 'circle') return { shape: s, x: g.n(-60, 60), y: g.n(-120, 10), r: g.n(2, 60) };
  if (s === 'capsule') return { shape: s, x1: g.n(-60, 60), y1: g.n(-120, 0), x2: g.n(-60, 60), y2: g.n(-120, 0), r: g.n(2, 40) };
  if (s === 'rect') return { shape: s, x: g.n(-60, 60), y: g.n(-120, 0), w: g.n(4, 160), h: g.n(4, 200) };
  return { shape: s, r: g.n(1, 20) };
}

function hitFields(g, refs) {
  const h = { kind: g.chance(0.8) ? 'strike' : g.pick(HIT_KINDS), damage: g.n(0, 40), angle: g.n(-30, 400), knockback: g.n(0, 200), growth: g.n(0, 200) };
  if (g.chance(0.2)) h.setKnockback = g.n(0, 150);
  if (g.chance(0.3)) h.effect = g.pick(EFFECTS);
  if (g.chance(0.15)) h.status = g.chance(0.5) ? g.pick([...refs.statuses, ...BUILTIN_STATUS, 'nope']) : { name: g.pick([...BUILTIN_STATUS, ...refs.statuses]), frames: g.i(1, 400), power: g.n(0, 3) };
  if (g.chance(0.1)) h.push = g.n(0, 10);
  if (g.chance(0.1)) h.shieldMul = g.n(0, 3);
  return h;
}

function hitbox(g, refs, dur) {
  const h = { ...shape(g), ...hitFields(g, refs), start: g.i(0, dur), end: g.i(0, dur + 10) };
  if (g.chance(0.2)) h.group = g.i(0, 4);
  if (g.chance(0.15) && refs.templates.length) h.use = g.ref(refs.templates, 'missing');
  if (g.chance(0.1)) h.rehit = g.i(0, 40);
  return h;
}

function timelineAction(g, refs, dur) {
  const t = g.chance(0.6) ? { at: g.i(0, dur) } : { from: g.i(0, dur), to: g.i(0, dur + 5), every: g.i(1, 10) };
  if (g.chance(0.05)) t.onLand = true;
  let k = g.pick(['spawn', 'velocity', 'impulse', 'steer', 'teleport', 'hit', 'resource', 'cost', 'form', 'status', 'armor', 'intangible', 'facing', 'release', 'endIf', 'goto', 'emit', 'sfx', 'camera', ...(g.chance(g.sloppy * 0.3) ? ['bogus'] : [])]);
  const dangling = (list) => !list.length && !g.chance(g.sloppy * 0.5); // tidy kits only reference what exists
  if ((k === 'spawn' && dangling(refs.entities)) || (k === 'hit' && dangling(refs.templates))) k = 'emit';
  switch (k) {
    case 'spawn': Object.assign(t, { spawn: g.ref(refs.entities, 'ghost'), x: g.n(-200, 200), y: g.n(-200, 50), vx: g.maybe(g.n(-20, 20)), vy: g.maybe(g.n(-20, 20)), count: g.maybe(g.i(1, 9)), spread: g.maybe(g.n(0, 90)), aimAt: g.maybe('nearestEnemy', 0.2), bindToMove: g.maybe(true, 0.2) }); break;
    case 'velocity': t.velocity = { vx: g.maybe(g.n(-30, 30)), vy: g.maybe(g.n(-30, 30)), mode: g.maybe(g.pick(['set', 'add', 'x'])), untilGrounded: g.maybe(true, 0.2), airOnly: g.maybe(true, 0.2) }; break;
    case 'impulse': t.impulse = { vx: g.n(-40, 40), vy: g.n(-40, 40) }; break;
    case 'steer': t.steer = { speed: g.n(0, 30), turn: g.n(0, 1) }; break;
    case 'teleport': t.teleport = { dx: g.n(-600, 600), dy: g.n(-600, 600), relative: g.maybe(g.pick(['facing', 'world', 'moon'])) }; break;
    case 'hit': Object.assign(t, { hit: g.ref(refs.templates, 'missing'), shape: g.maybe(g.pick(SHAPES)), frames: g.maybe(g.i(1, 30)), x: g.n(-80, 80), y: g.n(-120, 0), r: g.n(4, 60) }); break;
    case 'resource': t.resource = { name: g.ref(refs.resources, 'mana'), add: g.maybe(g.n(-200, 200)), set: g.maybe(g.n(-10, 300), 0.2) }; break;
    case 'cost': t.cost = Object.fromEntries(refs.resources.map((r) => [r, g.n(-10, 200)])); break;
    case 'form': t.form = g.ref(refs.forms, 'base', 'nope'); break;
    case 'status': t.status = g.pick([...refs.statuses, ...BUILTIN_STATUS]); break;
    case 'armor': t.armor = { frames: g.i(0, 200), threshold: g.n(0, 40) }; break;
    case 'intangible': t.intangible = g.i(0, 100); break;
    case 'facing': t.facing = g.pick(['turn', 'toward', 'sideways']); break;
    case 'release': t.release = g.chance(0.5) && !dangling(refs.templates) ? g.ref(refs.templates, 'x') : hitFields(g, refs); break;
    case 'endIf': t.endIf = { resource: g.maybe({ name: g.ref(refs.resources, 'x'), below: g.n(0, 100) }), grounded: g.maybe(true), airborne: g.maybe(true) }; break;
    case 'goto': t.goto = g.i(-5, dur + 5); break;
    case 'emit': t.emit = g.chance(0.9) ? 'sparkle' : g.junk(); t.data = g.maybe({ big: 'x'.repeat(g.int(0, 600)) }, 0.2); break;
    case 'sfx': t.sfx = g.pick(['boom', '', 'x'.repeat(100)]); break;
    case 'camera': t.camera = { shake: g.n(0, 50) }; break;
    default: t[k] = g.junk();
  }
  return t;
}

/** A hook body that calls random script API functions with mostly-sane args. */
function makeHook(seed, refs, throws) {
  const g = gen(mulberry32(seed));
  const moves = refs.moves;
  return function fuzzHook(view, a2, a3) {
    const api = [a2, a3].find((x) => x && typeof x === 'object' && typeof x.heal === 'function') || a2;
    if (throws && g.chance(0.05)) throw new Error('fuzz hook throws');
    if (!api || typeof api !== 'object') return g.chance(0.5) ? g.junk() : undefined;
    const n = g.int(0, 3);
    for (let k = 0; k < n; k++) {
      const name = g.pick(API_CALLS);
      const fn = api[name];
      if (typeof fn !== 'function') continue;
      const arg = () => (g.chance(0.15) ? g.junk() : g.pick([g.pick(moves), g.ref(refs.entities, 'none'), g.ref(refs.templates, 'x'), g.ref(refs.statuses, 'burn'), g.ref(refs.forms, 'base'), g.n(-300, 300)]));
      const opt = () => (g.chance(0.5) ? { x: g.n(-100, 100), y: g.n(-100, 0), vx: g.n(-20, 20), vy: g.n(-20, 20), frames: g.i(1, 60), worldX: g.n(-500, 500) } : g.junk());
      fn.call(api, arg(), g.chance(0.6) ? opt() : arg(), g.chance(0.3) ? opt() : undefined);
    }
    if (view && typeof view === 'object' && g.chance(0.2)) {
      try { view.x = 1; } catch { /* frozen views are expected to throw on write */ }
    }
    return g.chance(0.1) ? g.junk() : undefined;
  };
}

/**
 * A seeded garbage character. `version` 1 → v1 shape (stats/moves/projectiles),
 * 2 → v2 shape (everything in §2.2). Returns {def, hooksThrow}.
 */
export function genKit(seed, version = 2) {
  const g = gen(mulberry32(seed));
  g.sloppy = g.chance(0.5) ? g.num(0.3, 1) : 0.05; // half the kits are plausible, half are a mess
  const id = `fuzz-${(seed >>> 0).toString(36)}`.slice(0, 24);
  const hooksThrow = g.chance(0.3);
  if (version === 1) {
    const def = { id, name: g.chance(0.95) ? `Fuzz ${seed}` : g.junk(), stats: {}, moves: {} };
    for (const s of [...STATS, 'width', 'height']) if (g.chance(0.7)) def.stats[s] = g.n(0, 200);
    for (const slot of SLOTS) {
      if (g.chance(0.2)) continue;
      const dur = g.int(1, 90);
      const m = { name: g.chance(0.9) ? slot : g.junk(), duration: g.i(1, 90), anim: g.maybe(g.pick(['jab', 'spin', 'nope'])), effect: g.maybe(g.pick(EFFECTS)), hitboxes: [] };
      for (let k = g.int(0, 4); k > 0; k--) m.hitboxes.push({ start: g.i(0, dur), end: g.i(0, dur + 5), x: g.n(-60, 80), y: g.n(-120, 10), r: g.n(1, 80), damage: g.n(0, 50), angle: g.n(-10, 380), knockback: g.n(0, 300), growth: g.n(0, 300), group: g.maybe(g.i(0, 3)) });
      if (g.chance(0.3)) m.projectiles = Array.from({ length: g.int(0, 12) }, () => ({ start: g.i(0, dur), x: g.n(-40, 40), y: g.n(-100, 0), vx: g.n(-30, 30), vy: g.n(-30, 30), gravity: g.maybe(g.n(-1, 2)), life: g.i(1, 600), r: g.n(1, 100), damage: g.n(0, 40), angle: g.n(0, 360), knockback: g.n(0, 200), growth: g.n(0, 200) }));
      if (g.chance(0.3)) m.velocity = [{ start: g.i(0, dur), end: g.i(0, dur + 20), vx: g.maybe(g.n(-40, 40)), vy: g.maybe(g.n(-40, 40)) }];
      if (g.chance(0.15)) m.intangible = [g.i(0, dur), g.i(0, dur + 30)];
      if (g.chance(0.05)) m[g.pick(['cancels', 'forms', 'bogus'])] = g.junk();
      def.moves[g.chance(0.97) ? slot : `x${slot}`] = g.chance(0.03) ? g.junk() : m;
    }
    if (g.chance(0.1)) def[g.pick(['entities', 'behavior', 'whatever'])] = { x: 1 };
    return { def, hooksThrow: false };
  }

  const refs = { moves: [], entities: [], templates: [], statuses: [], resources: [], forms: [] };
  for (let k = g.int(0, 3); k > 0; k--) refs.resources.push(g.pick(['mana', 'heat', 'oil', 'ammo', 'rage']) + k);
  for (let k = g.int(0, 3); k > 0; k--) refs.statuses.push(`st${k}`);
  for (let k = g.int(0, 3); k > 0; k--) refs.templates.push(`tp${k}`);
  for (let k = g.int(0, 5); k > 0; k--) refs.entities.push(`en${k}`);
  for (let k = g.int(0, 2); k > 0; k--) refs.forms.push(`form${k}`);
  const poolNames = [...SLOTS.filter(() => g.chance(0.7)), ...Array.from({ length: g.int(0, 6) }, (_, k) => `extra${k}`)];
  refs.moves.push(...poolNames);

  const def = { version: 2, id, name: `Fuzz ${seed}`.slice(0, 18), archetype: g.maybe(g.pick(['zoner', 'heavy', 'blob'])), stats: {} };
  for (const s of STATS) if (g.chance(0.6)) def.stats[s] = g.n(0, 20);
  if (g.chance(0.85)) {
    def.body = { collider: { w: g.n(10, 200), h: g.n(10, 240) } };
    if (g.chance(0.8)) def.body.hurtboxes = { default: Array.from({ length: g.int(0, 8) }, () => shape(g)) };
    if (g.chance(0.3)) def.body.hurtboxes = { ...(def.body.hurtboxes || {}), crouch: [shape(g)], [g.pick(['spin', 'tall'])]: [shape(g)] };
    if (g.chance(0.2)) def.body.scaleRange = [g.n(0.2, 1), g.n(1, 3)];
    if (g.chance(0.2)) def.body.armor = { threshold: g.n(0, 10) };
  }
  if (g.chance(0.3)) {
    def.movement = {};
    for (const mode of ['hover', 'glide', 'fly', 'wallCling', 'crawl', 'teleportDash']) {
      if (g.chance(0.4)) def.movement[mode] = g.chance(0.1) ? g.junk() : { button: g.maybe(g.pick(BUTTONS)), frames: g.i(0, 300), fuel: g.i(0, 400), fallSpeed: g.n(0, 6), thrust: g.n(0, 2), maxRise: g.n(0, 10), speed: g.n(0, 3) };
    }
  }
  if (refs.resources.length) {
    def.resources = {};
    for (const r of refs.resources) {
      def.resources[r] = { min: g.maybe(g.n(-10, 10)), max: g.n(-5, 2000), start: g.maybe(g.n(-10, 500)), regen: g.maybe(g.n(-1, 5)), regenDelay: g.maybe(g.i(0, 200)), decay: g.maybe(g.n(0, 2)), regenWhen: g.maybe(g.pick(['always', 'grounded', 'airborne', 'form:base', 'sometimes'])) };
      if (g.chance(0.2)) def.resources[r].soak = { fraction: g.n(0, 1), costPerDamage: g.n(0, 3) };
      if (g.chance(0.3)) def.resources[r].onHit = { perDamage: g.n(-2, 5) };
      if (g.chance(0.3)) def.resources[r].hud = { style: g.pick(['bar', 'pips', 'ring', 'none', 'dial']) };
    }
  }
  if (g.chance(0.4)) { def.vars = {}; for (let k = g.int(0, 5); k > 0; k--) def.vars[`v${k}`] = g.chance(1 - 0.3 * g.sloppy) ? g.n(-1e7, 1e7) : g.junk(); def.sync = Object.keys(def.vars).filter(() => g.chance(0.5)); }
  if (refs.templates.length) { def.hitboxes = {}; for (const t of refs.templates) def.hitboxes[t] = { ...hitFields(g, refs), ...(g.chance(0.4) ? shape(g) : {}) }; }
  if (refs.statuses.length) {
    def.statuses = {};
    for (const s of refs.statuses) {
      const mods = {};
      for (const k of STATUS_MODS) if (g.chance(0.3)) mods[k] = g.n(0, 3);
      def.statuses[s] = { frames: g.i(0, 900), stack: g.maybe(g.pick(['refresh', 'add', 'ignore', 'multiply'])), maxStacks: g.maybe(g.i(0, 10)), mods,
        dot: g.maybe({ every: g.i(0, 60), damage: g.n(0, 10) }, 0.3), control: g.maybe(g.pick(CONTROL), 0.2), heal: g.maybe({ every: g.i(0, 60), amount: g.n(0, 20) }, 0.2), tint: g.maybe('#f0f') };
    }
  }
  if (refs.entities.length) {
    def.entities = {};
    for (const e of refs.entities) {
      const kind = g.chance(0.05) ? g.junk() : g.pick(ENTITY_KINDS);
      const life = g.i(1, 1500);
      const ent = { kind, shape: shape(g), life, hp: g.maybe(g.n(0, 60)), maxAlive: g.maybe(g.i(0, 20)), maxHits: g.maybe(g.i(0, 20)), pierce: g.maybe(g.i(0, 9)),
        motion: g.chance(0.9) ? { type: g.pick(MOTIONS), speed: g.n(0, 30), accel: g.maybe(g.n(-1, 2)), gravity: g.maybe(g.n(-1, 2)), turn: g.maybe(g.n(0, 1)), radius: g.maybe(g.n(0, 300)), target: g.maybe(g.pick(['nearestEnemy', 'owner', 'moon'])), out: g.maybe(g.i(0, 200)), back: g.maybe(g.n(0, 20)), snapToGround: g.maybe(true) } : g.junk(),
        collide: g.maybe(g.pick(COLLIDE)), hitboxes: Array.from({ length: g.int(0, 3) }, () => hitbox(g, refs, life)),
        relay: g.maybe(g.n(0, 2)), length: g.maybe(g.n(0, 2000)), width: g.maybe(g.n(0, 100)), anchor: g.maybe({ x: g.n(-100, 100), y: g.n(-100, 0) }), clank: g.maybe(g.chance(0.5)), clash: g.maybe(true, 0.1),
        reflectable: g.maybe(false, 0.2), scale: g.maybe(g.n(0, 2), 0.2) };
      if (g.chance(0.25)) ent.every = { frames: g.i(0, 120), spawn: g.ref(refs.entities, 'nope'), x: g.n(-50, 50), y: g.n(-50, 50), aim: g.maybe('nearestEnemy') };
      if (g.chance(0.2)) ent.onSpawn = [timelineAction(g, refs, 10)];
      if (g.chance(0.2)) ent.onHit = [timelineAction(g, refs, 10)];
      if (g.chance(0.2)) ent.onDeath = [timelineAction(g, refs, 10)];
      if (g.chance(0.25)) ent.think = makeHook(seed * 31 + e.length, refs, hooksThrow);
      def.entities[e] = ent;
    }
  }
  def.moves = {};
  for (const name of poolNames) {
    if (g.chance(0.06 * g.sloppy)) { def.moves[name] = g.junk(); continue; }
    const dur = g.int(1, 120);
    const m = { duration: g.chance(0.08 * g.sloppy) ? g.junk() : g.int(1, 150), category: g.maybe(g.pick(['jab', 'tilt', 'smash', 'aerial', 'special', 'recovery', 'grab', 'throw', 'counter', 'utility', 'taunt', 'ultimate']), 0.3),
      hitboxes: Array.from({ length: g.int(0, 4) }, () => hitbox(g, refs, dur)), timeline: Array.from({ length: g.int(0, 6) }, () => timelineAction(g, refs, dur)),
      anim: g.maybe(g.pick(['jab', 'spin', 'swirl'])), effect: g.maybe(g.pick(EFFECTS)) };
    if (g.chance(0.3)) m.velocity = [{ start: g.i(0, dur), end: g.i(0, dur + 10), vx: g.maybe(g.n(-30, 30)), vy: g.maybe(g.n(-30, 30)), mode: g.maybe(g.pick(['set', 'add'])), airOnly: g.maybe(true) }];
    if (g.chance(0.15)) m.intangible = g.chance(0.5) ? [g.i(0, dur), g.i(0, dur + 40)] : [[g.i(0, dur), g.i(0, dur)], [g.i(0, dur), g.i(0, dur)]];
    if (g.chance(0.15)) m.armor = [{ from: g.i(0, dur), to: g.i(0, dur + 20), threshold: g.n(0, 30) }];
    if (g.chance(0.1)) m.hurtboxes = [{ from: g.i(0, dur), to: g.i(0, dur), shapes: [shape(g)] }];
    if (g.chance(0.1)) m.gravity = [{ from: g.i(0, dur), to: g.i(0, dur), scale: g.n(0, 3) }];
    if (g.chance(0.15)) m.cancels = [{ from: g.i(0, dur), to: g.i(0, dur), into: [g.ref(refs.moves, 'jump', 'shield', 'any', 'zzz')], onHit: g.maybe(true) }];
    if (g.chance(0.15)) m.hold = { button: g.maybe(g.pick(BUTTONS)), from: g.i(0, dur), to: g.i(0, dur), max: g.i(0, 900), release: g.maybe(g.pick(refs.moves)) };
    if (g.chance(0.15)) m.charge = g.chance(0.2) ? true : { button: g.maybe(g.pick(BUTTONS)), at: g.maybe(g.i(0, dur)), max: g.i(0, 200) };
    if (g.chance(0.1)) m.next = g.ref(refs.moves, 'void');
    if (g.chance(0.1)) m.else = g.ref(refs.moves, 'void');
    if (g.chance(0.1)) m.counter = { from: g.i(0, dur), to: g.i(0, dur), then: g.pick(refs.moves), mul: g.n(0, 3) };
    if (g.chance(0.15) && refs.resources.length) m.cost = { [g.pick(refs.resources)]: g.n(-5, 200) };
    if (g.chance(0.1)) m.requires = { grounded: g.maybe(true), airborne: g.maybe(true), form: g.maybe(g.ref(refs.forms, 'base')) };
    if (g.chance(0.05)) m.throw = { holdAt: { x: g.n(-50, 50), y: g.n(-80, 0) } };
    if (g.chance(0.1)) m.projectiles = [{ start: g.i(0, dur), vx: g.n(-20, 20), life: g.i(1, 300), damage: g.n(0, 30) }];
    if (g.chance(0.1)) m.update = makeHook(seed * 7 + name.length, refs, hooksThrow);
    if (g.chance(0.05)) m.onAbsorb = [timelineAction(g, refs, dur)];
    def.moves[name] = m;
  }
  if (g.chance(0.5)) {
    def.slots = {};
    for (const t of TRIGGERS) {
      if (!g.chance(0.4)) continue;
      if (g.chance(0.15)) { const h = makeHook(seed * 13 + t.length, refs, hooksThrow); def.slots[t] = (view) => { const r = h(view, null); return typeof r === 'string' ? r : g.pick([...refs.moves, null, 'nope']); }; }
      else def.slots[t] = g.ref(refs.moves, 'nope', null);
    }
  }
  if (refs.forms.length) {
    def.forms = {};
    for (const fm of refs.forms) def.forms[fm] = { stats: g.maybe({ weight: g.n(0, 200), runSpeed: g.n(0, 20) }), body: g.maybe({ collider: { w: g.n(10, 200), h: g.n(10, 200) } }), slots: Object.fromEntries(SLOTS.filter(() => g.chance(0.4)).map((s) => [s, g.ref(refs.moves, 'nope')])), armor: g.maybe({ threshold: g.n(0, 5) }, 0.2) };
    if (g.chance(0.3)) def.startForm = g.ref(refs.forms, 'missing');
  }
  if (g.chance(0.5)) {
    def.behavior = {};
    for (const h of HOOKS) if (g.chance(0.4)) def.behavior[h] = makeHook(seed * 17 + h.length, refs, hooksThrow);
  }
  if (g.chance(0.4)) def.ai = { preferredRange: g.maybe(g.n(-100, 900)), zoning: g.maybe(true), recovery: g.maybe([g.pick(refs.moves)]), prefer: g.maybe(refs.moves.slice(0, 2)), hint: g.maybe(() => (g.chance(0.5) ? { press: g.pick(BUTTONS) } : g.junk()), 0.4) };
  if (g.chance(0.05)) def[g.pick(['art', 'bogus', 'legacy', 'moves'])] = g.junk();
  return { def, hooksThrow };
}

// ── match invariants (worker side) ───────────────────────────────────────────
const NUM_KEYS = ['x', 'y', 'vx', 'vy', 'kx', 'ky', 'percent', 'shield', 'hitlag', 'hitstun', 'bodyScale'];
const ENT_KEYS = ['x', 'y', 'vx', 'vy', 'age'];
const MAX_ALIVE = 8;

/** Runs `frames` of a game with seeded random inputs; throws on any invariant violation. */
function playChecked(engine, game, { frames, seed, strictScripts }) {
  const { STATE_SET, BUTTONS: BTN } = engine;
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const held = game.fighters.map(() => ({}));
  const prevStocks = game.fighters.map((f) => f.stocks);
  const where = () => `frame ${game.frame}`;
  const disabled = new Set();
  for (let i = 0; i < frames && game.phase !== 'ended'; i++) {
    game.fighters.forEach((f, k) => {
      if (f.cpu) return;
      for (const b of BTN) if (rng() < 0.15) held[k][b] = rng() < (b === 'taunt' ? 0.05 : b === 'shield' ? 0.25 : 0.4);
      game.setInput(f.id, held[k]);
    });
    game.step();
    for (const e of game.drainEvents()) {
      if (e.type === 'gov' && e.rule === 'scriptsDisabled') disabled.add(`${e.who} (${e.reason || 'faults'})`);
    }
    game.fighters.forEach((f, k) => {
      for (const key of NUM_KEYS) if (f[key] !== undefined && f[key] !== null && !Number.isFinite(f[key])) throw new Error(`${f.charId}.${key} = ${f[key]} at ${where()}`);
      if (!(f.percent >= 0 && f.percent <= 999)) throw new Error(`${f.charId} percent ${f.percent} outside [0, 999] at ${where()}`);
      if (f.stocks > prevStocks[k]) throw new Error(`${f.charId} stocks increased ${prevStocks[k]} → ${f.stocks} at ${where()}`);
      prevStocks[k] = f.stocks;
      if (!STATE_SET.has(f.state)) throw new Error(`${f.charId} unknown state "${f.state}" at ${where()}`);
    });
    const perOwner = {};
    for (const e of game.entities) {
      for (const key of ENT_KEYS) if (e[key] !== undefined && e[key] !== null && !Number.isFinite(e[key])) throw new Error(`entity ${e.name || e.style}.${key} = ${e[key]} at ${where()}`);
      if (e.kind === 'part') continue;
      const o = String(e.owner).split('#')[0];
      perOwner[o] = (perOwner[o] || 0) + 1;
      if (perOwner[o] > MAX_ALIVE) throw new Error(`${o} has ${perOwner[o]} live entities (max ${MAX_ALIVE}) at ${where()}`);
    }
  }
  if (strictScripts && disabled.size) throw new Error(`scriptsDisabled: ${[...disabled].join(', ')}`);
  JSON.stringify(game.snapshot()); // the snapshot must still serialize
  return { frames: game.frame, ended: game.phase === 'ended', disabled: [...disabled] };
}

// ── worker ───────────────────────────────────────────────────────────────────
async function workerMain({ jobs, seconds, verbose }) {
  if (!verbose) console.log = console.warn = console.info = () => {}; // engine "hook threw" chatter
  const { validateCharacter } = await import('../shared/balance/validate.js');
  const { Game } = await import('../shared/sim/game.js');
  const stage = (await import('../shared/stages/index.js')).getStage();
  const { STATES } = await import('../shared/sim/states.js');
  const { BUTTONS: BTN } = await import('../shared/constants.js');
  const guard = (await import('../shared/sim/guard.js')).default;
  const { hardenRealm, loadCharacter, listCharacterFolders } = await import('../server/characters.js');
  hardenRealm(guard); // same realm as a room worker: Math.random etc. throw inside hooks, prototypes frozen
  const engine = { STATE_SET: new Set(STATES), BUTTONS: BTN };
  const roster = [];
  for (const f of listCharacterFolders()) { const r = await loadCharacter(f); if (r.ok) roster.push(r.character); }
  const frames = Math.round(seconds * 60);

  for (const job of jobs) {
    parentPort.postMessage({ type: 'start', job });
    const t0 = performance.now();
    let result;
    try {
      if (job.kind === 'debug-hang') for (;;) { /* test hook: proves the kill timeout */ }
      else if (job.kind === 'kit') {
        const { def, hooksThrow } = genKit(job.seed, job.version);
        let res;
        try { res = validateCharacter(def, { expectedId: def.id }); } catch (e) { throw new Error(`validateCharacter threw: ${e && e.stack}`); }
        if (!res || typeof res.ok !== 'boolean') throw new Error('validateCharacter returned no {ok}');
        if (res.ok) {
          const foe = roster.length ? roster[job.seed % roster.length] : res.character;
          const game = new Game({ stage, rules: { stocks: 3, seed: job.seed, scriptTiming: false, countdown: false },
            players: [{ id: 'p1', name: 'F', character: res.character, cpu: job.seed % 3 === 0 ? 'hard' : null }, { id: 'p2', name: 'R', character: foe, cpu: 'hard' }] });
          const r = playChecked(engine, game, { frames, seed: job.seed, strictScripts: false });
          if (!hooksThrow && r.disabled.some((d) => d.startsWith('p1') && !/slow/.test(d))) throw new Error(`scripts disabled although no hook throws on purpose (the script API threw on junk input?): ${r.disabled.join(', ')}`);
          result = { ok: true, loaded: true, frames: r.frames };
        } else result = { ok: true, loaded: false, errors: res.errors.length };
      } else {
        const pick = mulberry32(job.seed);
        const ids = roster.map((c) => c.id);
        const four = [ids[job.index % ids.length], ...Array.from({ length: 3 }, () => ids[Math.floor(pick() * ids.length)])];
        const players = four.map((id, k) => ({ id: `p${k + 1}`, name: id, character: roster.find((c) => c.id === id), cpu: k % 2 ? 'hard' : null }));
        const game = new Game({ stage, players, rules: { stocks: 3, seed: job.seed, scriptTiming: false, countdown: false } });
        const r = playChecked(engine, game, { frames, seed: job.seed, strictScripts: true });
        result = { ok: true, loaded: true, frames: r.frames, ids: four };
      }
    } catch (e) {
      result = { ok: false, error: String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join('\n') };
    }
    parentPort.postMessage({ type: 'done', job, ms: performance.now() - t0, ...result });
  }
  parentPort.postMessage({ type: 'end' });
}

// ── main thread ──────────────────────────────────────────────────────────────
/**
 * Runs jobs in a worker; a job silent for `timeoutMs` is reported as a hang and the
 * worker is replaced. Resolves to {results[], hangs[]}.
 */
export function runJobs(jobs, { seconds, timeoutMs, verbose = false, onResult = () => {} }) {
  return new Promise((resolveAll) => {
    const results = [];
    const hangs = [];
    let queue = jobs.slice();
    const key = (j) => (j ? `${j.kind}:${j.version ?? ''}:${j.index ?? ''}:${j.seed}` : '');
    /** Drops `job` (and everything before it) from the queue: it either finished or must not rerun. */
    const dropThrough = (job) => { const i = queue.findIndex((j) => key(j) === key(job)); if (i >= 0) queue = queue.slice(i + 1); };
    const spawn = () => {
      if (!queue.length) return resolveAll({ results, hangs });
      const w = new Worker(SELF, { workerData: { jobs: queue, seconds, verbose }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
      let current = null;
      let timer = null;
      let finished = false;
      const arm = (ms = timeoutMs) => { clearTimeout(timer); timer = setTimeout(onHang, ms); };
      const fail = (error, hang) => {
        finished = true;
        clearTimeout(timer);
        if (hang) hangs.push(current);
        const r = { job: current, ok: false, error };
        results.push(r);
        onResult(r);
        if (!current) { queue = []; w.terminate().then(() => resolveAll({ results, hangs })); return; } // the loader itself failed
        dropThrough(current);
        w.terminate().then(spawn);
      };
      const onHang = () => fail(current ? `hang: no progress for ${timeoutMs} ms (worker terminated)` : 'hang while loading the engine/roster (worker terminated)', true);
      arm(Math.max(timeoutMs, 60000)); // loading the engine + roster gets a generous budget (cold, loaded CI boxes)
      w.on('message', (m) => {
        if (finished) return; // late messages from a worker being terminated
        if (m.type === 'start') { current = m.job; arm(); }
        else if (m.type === 'done') { results.push(m); onResult(m); dropThrough(m.job); current = null; arm(); }
        else if (m.type === 'end') { finished = true; clearTimeout(timer); w.terminate(); resolveAll({ results, hangs }); }
      });
      w.on('error', (e) => { if (!finished) fail(`worker crashed: ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e}`, false); });
      w.on('exit', (code) => { if (!finished) fail(`worker exited (code ${code})`, false); });
    };
    spawn();
  });
}

/** The job list for a mode. */
export function planJobs({ quick = false, seed = 1, kits, rosterMatches, only = null } = {}) {
  const nk = kits ?? (quick ? 60 : 300);
  const nr = rosterMatches ?? (quick ? 8 : 40);
  const jobs = [];
  const s0 = Math.imul(seed, 2654435761) >>> 0;
  if (only !== 'roster') for (let i = 0; i < nk; i++) jobs.push({ kind: 'kit', version: i % 3 === 0 ? 1 : 2, seed: (s0 + i * 7919) >>> 0 });
  if (only !== 'kit') for (let i = 0; i < nr; i++) jobs.push({ kind: 'roster', index: i, seed: (s0 + 100003 + i * 104729) >>> 0 });
  return jobs;
}

async function main() {
  const args = process.argv.slice(2);
  const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const quick = args.includes('--quick');
  const json = args.includes('--json');
  const seed = Number(val('--seed', 1));
  const seconds = Number(val('--seconds', quick ? 10 : 60));
  const timeoutMs = Number(val('--timeout', quick ? 15000 : 30000));
  const kits = args.includes('--kits') ? Number(val('--kits')) : undefined;
  const rosterMatches = args.includes('--matches') ? Number(val('--matches')) : undefined;
  const jobs = planJobs({ quick, seed, kits, rosterMatches, only: val('--only', null) });
  const t0 = Date.now();
  const failures = [];
  let loaded = 0, rejected = 0;
  const { results, hangs } = await runJobs(jobs, {
    seconds, timeoutMs, verbose: args.includes('--verbose'),
    onResult: (r) => {
      if (!r.ok) {
        failures.push(r);
        if (!json) console.error(`✘ fuzz ${r.job?.kind} seed ${r.job?.seed}${r.job?.version ? ` v${r.job.version}` : ''}: ${r.error}`);
      } else if (r.loaded) loaded++; else rejected++;
    },
  });
  for (const f of failures) {
    if (f.job?.kind !== 'kit') continue;
    try {
      const dir = join(ROOT, '.cache', 'fuzz');
      mkdirSync(dir, { recursive: true });
      const { def } = genKit(f.job.seed, f.job.version);
      writeFileSync(join(dir, `kit-${f.job.seed}-v${f.job.version}.json`), JSON.stringify(def, (k, v) => (typeof v === 'function' ? `[fn] ${String(v).slice(0, 200)}` : typeof v === 'number' && !Number.isFinite(v) ? String(v) : v), 2));
    } catch { /* best effort */ }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (json) console.log(JSON.stringify({ jobs: jobs.length, results: results.length, failures, hangs, loaded, rejected, seconds: Number(secs) }, null, 2));
  else if (!failures.length) console.log(`✔ fuzz ${quick ? '(quick) ' : ''}${jobs.length} jobs in ${secs}s: ${jobs.filter((j) => j.kind === 'kit').length} garbage kits (${loaded - jobs.filter((j) => j.kind === 'roster').length} played, ${rejected} rejected cleanly), ${jobs.filter((j) => j.kind === 'roster').length} roster FFAs; no throws, hangs, NaN or invariant breaks`);
  else console.error(`✘ fuzz: ${failures.length} failure(s) (${hangs.length} hang(s)) in ${secs}s. Reproduce: node scripts/fuzz.js --seed ${seed}${quick ? ' --quick' : ''}`);
  if (failures.length) process.exitCode = 1;
}

if (!isMainThread && workerData && workerData.jobs) await workerMain(workerData);
else if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
