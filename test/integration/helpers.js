// Integration helpers: load the roster (v1 + the v2 examples) or test fixtures through the real
// validator (validateCharacter → frozen IR) and run seeded CPU matches with
// invariant checks (§4.2.11, §10.1).
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCharacter } from '../../shared/balance/validate.js';
import { Game } from '../../shared/sim/game.js';
import stage from '../../shared/stages/sky-sanctum.js';
import { STATES } from '../../shared/sim/states.js';
import { BUTTONS } from '../../shared/constants.js';
import { mulberry32 } from '../../shared/sim/rng.js';

const STATE_SET = new Set(STATES);

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const V1 = ['ember', 'bastion', 'volt', 'mirelle'];
export const V2 = ['nimbus', 'gertie', 'gloop'];

const cache = new Map();
/** Validated IR for a v1 roster id or a test fixture id. Throws on validation errors. */
export async function loadChar(id) {
  if (cache.has(id)) return cache.get(id);
  // Roster first (nimbus, gertie and gloop are real roster characters); `fixture:<id>` loads test/fixtures/<id>.
  const dir = id.startsWith('fixture:') ? join(ROOT, 'test', 'fixtures', id.slice(8)) : join(ROOT, 'characters', id);
  const mod = await import(pathToFileURL(join(dir, 'character.js')).href);
  const res = validateCharacter(mod.default, { expectedId: id.replace(/^fixture:/, '') });
  if (!res.ok) throw new Error(`${id} failed to validate: ${res.errors.map(String).join('; ')}`);
  cache.set(id, res);
  return res;
}

/** Registers an already-validated result under an id (e.g. test/archetypes/*), so runMatch can use it. */
export function registerChar(id, res) { cache.set(id, res); }

const NUM_KEYS = ['x', 'y', 'vx', 'vy', 'kx', 'ky', 'percent', 'shield', 'hitlag', 'hitstun', 'bodyScale'];
const ENT_KEYS = ['x', 'y', 'vx', 'vy', 'age'];

/**
 * Runs one seeded match and checks invariants every frame. Returns stats.
 * opts: {ids, seed, frames, cpu ('hard'|[...]|'random' = seeded button mashing), rules, onFrame(game), onEvent(e, game)}
 */
export async function runMatch({ ids, seed = 1, frames = 7200, cpu = 'hard', rules = {}, onFrame, onEvent } = {}) {
  const players = [];
  for (let i = 0; i < ids.length; i++) {
    const res = await loadChar(ids[i]);
    const level = Array.isArray(cpu) ? cpu[i] : cpu;
    players.push({ id: `p${i + 1}`, name: ids[i], character: res.character, cpu: level === 'random' ? null : level });
  }
  const game = new Game({ stage, players, rules: { stocks: 3, seed, scriptTiming: false, ...rules } }); // wall-clock faults off: determinism
  const stats = { frames: 0, hits: {}, moves: {}, kos: 0, spawns: 0, gov: {}, events: {}, maxEntities: 0, snapBytes: 0, errors: [] };
  for (const f of game.fighters) { stats.hits[f.charId] = 0; stats.moves[f.charId] = 0; }
  const prevStocks = game.fighters.map((f) => f.stocks);
  const prevState = game.fighters.map((f) => f.state);
  const fail = (m) => { throw new Error(`[${ids.join(',')} seed ${seed} frame ${game.frame}] ${m}`); };
  const byId = (id) => game.fighters.find((f) => f.id === id);
  const mash = mulberry32(seed * 7919 + 1); // driver-side randomness, never game.rng
  const held = game.fighters.map(() => ({}));
  for (let i = 0; i < frames && game.phase !== 'ended'; i++) {
    game.fighters.forEach((f, k) => {
      if (f.cpu) return;
      if (mash() < 0.15) held[k] = Object.fromEntries(BUTTONS.map((b) => [b, mash() < (b === 'jump' ? 0.3 : b === 'taunt' ? 0.02 : 0.16)]));
      game.setInput(f.id, held[k]);
    });
    game.step();
    stats.frames++;
    const koIds = new Set();
    for (const e of game.drainEvents()) {
      if (e.type === 'ko') koIds.add(e.id);
      stats.events[e.type] = (stats.events[e.type] || 0) + 1;
      if (onEvent) onEvent(e, game);
      if (e.type === 'hit') { const a = byId(e.attacker); if (a) stats.hits[a.charId]++; }
      else if (e.type === 'move') { const a = byId(e.id); if (a) stats.moves[a.charId]++; }
      else if (e.type === 'ko') stats.kos++;
      else if (e.type === 'spawn') stats.spawns++;
      else if (e.type === 'gov') stats.gov[e.rule] = (stats.gov[e.rule] || 0) + 1;
      else if (e.type === 'scriptError') stats.errors.push(e);
    }
    game.fighters.forEach((f, k) => {
      for (const key of NUM_KEYS) if (f[key] !== undefined && !Number.isFinite(f[key])) fail(`${f.charId}.${key} = ${f[key]}`);
      if (f.percent < 0 || f.percent > 999) fail(`${f.charId} percent ${f.percent}`);
      if (f.stocks > prevStocks[k]) fail(`${f.charId} stocks increased ${prevStocks[k]} → ${f.stocks}`);
      if (f.stocks < prevStocks[k] && !koIds.has(f.id)) fail(`${f.charId} lost a stock without a blast-zone ko`);
      prevStocks[k] = f.stocks;
      // Respawn invulnerability is exactly MATCH.respawnInvuln (120) when the platform is left.
      if (prevState[k] === 'respawn' && f.state !== 'respawn' && f.state !== 'dead' && f.invuln < 118) fail(`${f.charId} left respawn with invuln ${f.invuln}`);
      prevState[k] = f.state;
      if (!STATE_SET.has(f.state)) fail(`${f.charId} unknown state ${f.state}`);
    });
    stats.maxEntities = Math.max(stats.maxEntities, game.entities.length);
    for (const e of game.entities) {
      for (const key of ENT_KEYS) if (e[key] !== undefined && !Number.isFinite(e[key])) fail(`entity ${e.name || e.style}.${key} = ${e[key]}`);
    }
    if (i % 300 === 0) stats.snapBytes = Math.max(stats.snapBytes, JSON.stringify(game.snapshot()).length);
    if (onFrame) onFrame(game);
  }
  stats.ended = game.phase === 'ended';
  stats.percent = game.fighters.map((f) => Math.round(f.percent));
  stats.stocks = game.fighters.map((f) => f.stocks);
  stats.game = game;
  return stats;
}
