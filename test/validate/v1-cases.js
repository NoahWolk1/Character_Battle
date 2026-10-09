// Deterministic v1 input corpus for the v1-parity test (WP-C).
// The same inputs were run through the PRE-CHANGE validator to produce
// fixtures/v1-pre-change.json; the v2 dispatcher must reproduce it exactly.
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mulberry32 } from '../../shared/sim/rng.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLOTS = ['jab', 'side', 'up', 'down', 'sideSmash', 'upSmash', 'downSmash', 'nair', 'fair', 'bair', 'uair', 'dair',
  'neutralSpecial', 'sideSpecial', 'upSpecial', 'downSpecial'];

export const CHEATER = {
  id: 'cheater', name: 'Cheater',
  stats: { weight: 9999, runSpeed: 99, airSpeed: 99, jumpHeight: 99, doubleJumpHeight: 99, airJumps: 99, width: 2, height: 2 },
  moves: Object.fromEntries(SLOTS.map((s) => [s, {
    duration: 1,
    hitboxes: [{ start: 0, end: 999, x: 0, y: -40, r: 9999, damage: 9999, angle: 45, knockback: 9999, growth: 9999 }],
    projectiles: Array.from({ length: 10 }, () => ({ start: 0, x: 0, y: -40, vx: 999, vy: 0, life: 9999, r: 999, damage: 999, angle: 45, knockback: 999, growth: 999 })),
    velocity: [{ start: 0, end: 100, vx: 999, vy: -999 }],
    intangible: [0, 999],
  }])),
};

function fuzzDef(rng, i) {
  const r = (a, b) => a + (b - a) * rng();
  const ri = (a, b) => Math.floor(r(a, b + 1));
  const pick = (arr) => arr[ri(0, arr.length - 1)];
  const maybe = (p, v) => (rng() < p ? v() : undefined);
  const wild = () => pick([r(-50, 50), r(0, 200), 9999, -1, 0, 'x', null, r(0, 30)]);
  const stats = {};
  for (const k of ['weight', 'runSpeed', 'airSpeed', 'jumpHeight', 'doubleJumpHeight', 'airJumps', 'gravity', 'fallSpeed', 'width', 'height']) {
    if (rng() < 0.7) stats[k] = rng() < 0.15 ? wild() : r(0, 140);
  }
  if (rng() < 0.1) stats.bogus = 3;
  const moves = {};
  for (const s of SLOTS) {
    if (rng() < 0.15) continue;
    const hb = () => ({
      start: maybe(0.9, () => ri(-2, 30)), end: maybe(0.9, () => ri(0, 70)), x: maybe(0.9, () => r(-150, 200)), y: maybe(0.9, () => r(-220, 40)),
      r: maybe(0.9, () => r(1, 80)), damage: maybe(0.9, () => (rng() < 0.1 ? wild() : r(0, 30))), angle: maybe(0.9, () => r(-30, 370)),
      knockback: maybe(0.9, () => r(0, 150)), growth: maybe(0.9, () => r(0, 180)), group: maybe(0.4, () => ri(0, 3)),
    });
    const proj = () => ({
      start: maybe(0.9, () => ri(0, 30)), x: r(-50, 200), y: r(-150, 20), vx: r(-20, 20), vy: r(-10, 10), gravity: maybe(0.4, () => r(-1, 1)),
      life: maybe(0.8, () => ri(-5, 200)), r: r(1, 40), damage: r(0, 20), angle: r(0, 360), knockback: r(0, 120), growth: r(0, 150),
      style: maybe(0.5, () => pick(['orb', 'bolt', 'shard', 'ring'])), color: maybe(0.5, () => '#f80'), spin: maybe(0.3, () => r(-1, 1)),
    });
    const m = {
      name: maybe(0.6, () => pick(['Punch', 'A very very long move name indeed', '  ', 'Zap'])),
      duration: maybe(0.95, () => (rng() < 0.05 ? 'fast' : ri(1, 200))),
      anim: maybe(0.3, () => pick(['jab', 'cast', 'nope', 'spin', 'rise'])),
      effect: maybe(0.4, () => pick(['fire', 'ice', 'bogus', 'electric', 'none'])),
      color: maybe(0.3, () => '#abc'),
      hitboxes: maybe(0.9, () => Array.from({ length: ri(0, 4) }, hb)),
      projectiles: maybe(0.25, () => Array.from({ length: ri(0, 5) }, proj)),
      velocity: maybe(0.35, () => Array.from({ length: ri(1, 3) }, () => ({ start: ri(0, 20), end: ri(0, 40), vx: maybe(0.7, () => r(-20, 20)), vy: maybe(0.7, () => r(-25, 10)) }))),
      intangible: maybe(0.15, () => [ri(0, 10), ri(0, 30)]),
      landingLag: maybe(0.3, () => ri(-5, 60)),
      pose: maybe(0.1, () => ({ windup: { armF: 1 }, strike: { armF: -1 }, spinTurns: 9 })),
      description: maybe(0.2, () => 'desc'),
      sound: maybe(0.1, () => 'boom'),
      wat: maybe(0.05, () => 1),
    };
    for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
    moves[s] = m;
  }
  if (rng() < 0.1) moves.notASlot = { duration: 10 };
  return {
    id: `fuzz-${i}`, name: rng() < 0.1 ? 'A name that is far too long for the HUD' : `Fuzz ${i}`,
    author: rng() < 0.5 ? 'someone' : undefined, description: rng() < 0.3 ? 'x'.repeat(ri(0, 300)) : undefined,
    stats, moves,
  };
}

/** @returns {Promise<{label, def, opts}[]>} */
export async function loadV1Cases({ fuzz = 48 } = {}) {
  const out = [];
  const dir = join(ROOT, 'characters');
  for (const folder of readdirSync(dir).sort()) {
    const file = folder === '_template' ? join(ROOT, 'test', 'fixtures', '_v1-template', 'character.js') : join(dir, folder, 'character.js'); // frozen v1 template
    if (!existsSync(file)) continue;
    const mod = await import(pathToFileURL(file).href);
    if (mod.default && mod.default.version === 2) continue; // only v1 files belong here
    const exp = folder === '_template' ? 'template' : folder;
    out.push({ label: `characters/${folder}`, def: folder === '_template' ? { ...mod.default, id: 'template' } : mod.default, opts: { expectedId: exp } });
  }
  out.push({ label: 'cheater', def: CHEATER, opts: {} });
  out.push({ label: 'empty', def: { id: 'empty', name: 'Empty' }, opts: {} });
  out.push({ label: 'no-name', def: { id: 'nameless' }, opts: {} });
  out.push({ label: 'bad-id', def: { id: 'Bad ID!', name: 'x' }, opts: {} });
  out.push({ label: 'id-mismatch', def: { id: 'abc', name: 'x' }, opts: { expectedId: 'abd' } });
  out.push({ label: 'expected-id-only', def: { name: 'Folder Named' }, opts: { expectedId: 'folder' } });
  out.push({ label: 'tiny-body', def: { id: 'tiny', name: 'Tiny', stats: { width: 38, height: 70 } }, opts: {} });
  out.push({ label: 'garbage-fields', def: { id: 'garb', name: 'Garb', stats: { weight: 'heavy', speed: 9 }, moves: { jab: { duration: 20, wat: 1, hitboxes: [null, 3, { start: 2 }] }, upSpecial: 'nope' } }, opts: {} });
  const rng = mulberry32(0xC0FFEE);
  for (let i = 0; i < fuzz; i++) out.push({ label: `fuzz-${i}`, def: fuzzDef(rng, i), opts: {} });
  return out;
}

/** JSON that survives Infinity/NaN/-0 and drops nothing else; stable across runs. */
export function encode(v) {
  return JSON.stringify(v, (k, x) => {
    if (typeof x === 'number' && !Number.isFinite(x)) return `__num:${x}`;
    return x;
  });
}
export function decode(s) {
  return JSON.parse(s, (k, x) => (typeof x === 'string' && x.startsWith('__num:') ? Number(x.slice(6)) : x));
}

/** The part of a validator result that the parity test compares. */
export function projectResult(res) {
  return { ok: res.ok, errors: res.errors, notes: res.notes, character: res.character, report: res.report };
}
