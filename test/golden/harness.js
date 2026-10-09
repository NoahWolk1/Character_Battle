// Shared harness for golden replays (scripts/record-golden.js, scripts/golden-test.js).
//
// A golden replay is a seeded CPU-vs-CPU match on the v1 roster. Every 60
// frames we hash a canonical "v1 view" of the snapshot, plus the events emitted
// in that window. The v1 view keeps exactly the v1 snapshot keys (in v1 order),
// so future snapshots may ADD keys without breaking the comparison; at record
// time the view is asserted to equal JSON.stringify(game.snapshot()) exactly.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GOLDEN_DIR = join(ROOT, 'test', 'golden');

export const ROSTER = ['ember', 'bastion', 'volt', 'mirelle', 'template'];
export const FRAMES = 3600;          // 60 s including the 180-frame countdown
export const CHECK_EVERY = 60;
export const STOCKS = 3;
// Two seeds per pairing; the second also exercises the 'normal' CPU branch tables.
export const SEEDS = [
  { seed: 1, cpu: ['hard', 'hard'] },
  { seed: 2, cpu: ['normal', 'hard'] },
];
// Rules golden-test passes by default once v2 exists (v1 ignores unknown keys).
export const DEFAULT_TEST_RULES = { governor: false, legacyKo: true, grabs: false, aiVersion: 1 };
// Goldens were recorded with the v1 CPU (shared/sim/ai-v1.js); runMatch pins aiVersion 1
// even when --rules overrides these, so a CPU rewrite never invalidates the replays.

// v1 snapshot keys, in v1 order. A projection onto these is the hashed view.
export const SNAP_KEYS = ['frame', 'phase', 'phaseFrame', 'winner'];
export const FIGHTER_KEYS = [
  'id', 'x', 'y', 'vx', 'vy', 'kx', 'ky', 'facing', 'state', 'stateFrame', 'grounded',
  'slot', 'moveFrame', 'charging', 'charge', 'percent', 'stocks', 'shield', 'intangible',
  'hitlag', 'tumble', 'dj', 'eliminated', 'kos', 'falls', 'damageDealt', 'placement', 'respawnFrame',
];
export const PROJECTILE_KEYS = ['id', 'owner', 'charId', 'x', 'y', 'vx', 'vy', 'r', 'life', 'maxLife', 'style', 'color', 'color2', 'spin', 'effect'];

export const sha1 = (s) => createHash('sha1').update(s).digest('hex');

const pick = (o, keys) => { const r = {}; for (const k of keys) r[k] = o[k]; return r; };

/**
 * Canonical v1 view of a snapshot. If a v2 snapshot drops `projectiles` in
 * favor of `entities`, the Game must expose `projectilesV1()` returning the v1
 * projectile records so golden parity stays checkable (fails loudly otherwise).
 */
export function v1View(snap, game) {
  const out = pick(snap, SNAP_KEYS);
  out.fighters = (snap.fighters || []).map((f) => pick(f, FIGHTER_KEYS));
  let projs = snap.projectiles;
  if (!projs && game && typeof game.projectilesV1 === 'function') projs = game.projectilesV1();
  if (!projs) throw new Error('golden: snapshot has no `projectiles`; provide snapshot.projectiles or game.projectilesV1()');
  out.projectiles = projs.map((p) => pick(p, PROJECTILE_KEYS));
  return out;
}

/** Projects an event onto the keys it had in v1 (types unknown to v1 are dropped). */
export function v1Event(e, eventKeys) {
  const keys = eventKeys[e.type];
  return keys ? pick(e, keys) : null;
}

/** Imports a character module and runs it through the current validator. */
export async function loadRoster(validateCharacter) {
  const out = {};
  for (const id of ROSTER) {
    const folder = id === 'template' ? '_template' : id;
    // The v1 template is frozen as a fixture (characters/_template is now the v2 template).
    const file = id === 'template' ? join(ROOT, 'test', 'fixtures', '_v1-template', 'character.js') : join(ROOT, 'characters', folder, 'character.js');
    const mod = await import(`${pathToFileURL(file).href}?v=${statSync(file).mtimeMs}`);
    // The template is loaded directly (no expectedId) and normalized with id 'template'.
    const res = id === 'template'
      ? validateCharacter({ ...mod.default, id: 'template' })
      : validateCharacter(mod.default, { expectedId: id });
    if (!res.ok) throw new Error(`golden: ${folder} failed to validate: ${res.errors.join('; ')}`);
    out[id] = { character: res.character, source: sha1(readFileSync(file, 'utf8')), normalized: sha1(stableJson(res.character)) };
  }
  return out;
}

/** JSON with sorted object keys (functions/Sets dropped), for content hashes. */
export function stableJson(v) {
  return JSON.stringify(v, (k, x) => {
    if (typeof x === 'function') return undefined;
    if (x instanceof Set) return [...x];
    if (x && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]]));
    return x;
  });
}

export function pairings() {
  const out = [];
  for (let i = 0; i < ROSTER.length; i++) for (let j = i; j < ROSTER.length; j++) out.push([ROSTER[i], ROSTER[j]]);
  return out;
}

export const pairFile = (a, b) => join(GOLDEN_DIR, `${a}-vs-${b}.json`);

/**
 * Runs one golden match and returns its trace.
 *  opts.eventKeys: {type: keys[]} v1 event shapes (from the manifest).
 *  opts.learn: object to collect event key lists into (recording pass 1).
 *  opts.strict: assert the v1 views are lossless (recording on v1 code).
 */
export function runMatch({ Game, stage, roster, a, b, seed, cpu, rules = {}, eventKeys = null, learn = null, strict = false }) {
  const game = new Game({
    stage,
    rules: { aiVersion: 1, ...rules, stocks: STOCKS, seed },
    players: [
      { id: 'p1', name: 'P1', character: roster[a].character, cpu: cpu[0] },
      { id: 'p2', name: 'P2', character: roster[b].character, cpu: cpu[1] },
    ],
  });
  const checkpoints = [];
  const views = [];
  const allEvents = createHash('sha1');
  let windowEvents = [];
  let eventCount = 0;
  const checkpoint = () => {
    const snap = game.snapshot();
    const view = JSON.stringify(v1View(snap, game));
    if (strict && view !== JSON.stringify(snap)) throw new Error('golden: v1View is not lossless for the current snapshot; update SNAP/FIGHTER/PROJECTILE_KEYS');
    const ev = JSON.stringify(windowEvents);
    checkpoints.push({
      f: game.frame,
      s: sha1(view),
      e: sha1(ev),
      n: windowEvents.length,
      // Human-readable fingerprint for diffs: [x, y, state, percent, stocks] per fighter.
      p: snap.fighters.map((fi) => [fi.x, fi.y, fi.state, fi.percent, fi.stocks]),
    });
    views.push({ f: game.frame, view, events: windowEvents });
    windowEvents = [];
  };
  let ended = false;
  for (let i = 0; i < FRAMES && !ended; i++) {
    game.step();
    for (const e of game.drainEvents()) {
      if (learn) {
        const keys = learn[e.type] || (learn[e.type] = []);
        for (const k of Object.keys(e)) if (!keys.includes(k)) keys.push(k);
        continue;
      }
      const pe = v1Event(e, eventKeys);
      if (!pe) continue;
      const s = JSON.stringify(pe);
      if (strict && s !== JSON.stringify(e)) throw new Error(`golden: event projection not lossless for ${JSON.stringify(e)}`);
      windowEvents.push(pe);
      allEvents.update(s).update('\n');
      eventCount++;
    }
    ended = game.phase === 'ended';
    if (!learn && (game.frame % CHECK_EVERY === 0 || ended)) checkpoint();
  }
  const last = game.snapshot();
  return {
    trace: {
      seed, cpu, frames: game.frame, ended,
      events: eventCount, eventsHash: allEvents.digest('hex'),
      result: { winner: last.winner, stocks: last.fighters.map((f) => f.stocks), percent: last.fighters.map((f) => f.percent) },
      checkpoints,
    },
    views,
  };
}
