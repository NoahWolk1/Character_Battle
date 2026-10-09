// Character discovery, folder hashing and (worker-side) loading.
// Folders starting with "_" or "." (like _template) are ignored.
//
// The Express/Socket.IO process only uses the fs helpers here (list + hash); it
// never imports character code. Importing happens in the catalog worker
// (catalog-worker.js), the room workers (room-worker.js), and in CLI scripts
// (scripts/validate.js, scripts/sim-smoke-test.js) via loadCharacter().
import { readdirSync, readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';
import { validateCharacter } from '../shared/balance/validate.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CHAR_DIR = join(ROOT, 'characters');

export function listCharacterFolders(dir = CHAR_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name)
    .filter((name) => existsSync(join(dir, name, 'character.js')))
    .sort();
}

function walk(dir, out) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === '.DS_Store') continue; // dotfiles count: hidden code must not ride along unhashed
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (d.isFile()) out.push(p);
  }
  return out;
}

/**
 * sha1 of a character folder's contents (spec §7): every file but .DS_Store, sorted by
 * relative path, hashed as `path \0 bytes \0`. Same bytes → same hash on any OS.
 */
export function hashFolder(folderDir) {
  const h = createHash('sha1');
  const files = walk(folderDir, []).map((p) => [relative(folderDir, p).split(sep).join('/'), p]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [rel, p] of files) { h.update(rel); h.update('\0'); h.update(readFileSync(p)); h.update('\0'); }
  return h.digest('hex');
}

const guarded = new Set();
/**
 * Installs the import guard (import-guard-hooks.js) for one characters dir, once per
 * thread: code in <dir>/<folder>/ can import only its folder + shared/, never node:
 * builtins, packages or CommonJS. A runtime backstop for the static lint.
 */
export function guardCharacterImports(dir) {
  // The loader resolves symlinks (/var -> /private/var), so compare real paths.
  const charDir = pathToFileURL(join(realpathSync(dir), '/')).href;
  if (guarded.has(charDir)) return;
  register(new URL('./import-guard-hooks.js', import.meta.url), { data: { charDir, sharedDir: pathToFileURL(join(realpathSync(ROOT), 'shared', '/')).href } });
  guarded.add(charDir);
}

/** Imports a character module (cache-busted by hash or mtime). Worker/CLI only. */
export async function importCharacter(file, version) {
  guardCharacterImports(dirname(dirname(file)));
  const v = version || statSync(file).mtimeMs;
  return import(`${pathToFileURL(file).href}?v=${v}`);
}

/** E004 (§4.1.6): the module threw while importing (top-level side effects, rule mutation…). */
export function loadError(folder, e) {
  return `E004 Failed to load ${folder}/character.js: ${e && e.message ? e.message : String(e)} — fix: remove top-level side effects; character files must only declare data and functions.`;
}

/** Loads + balances one folder. Never throws. Worker/CLI only (imports character code). */
export async function loadCharacter(folder, { dir = CHAR_DIR, hash } = {}) {
  const file = join(dir, folder, 'character.js');
  try {
    const mod = await importCharacter(file, hash);
    const result = validateCharacter(mod.default, { expectedId: folder });
    return { folder, ...result };
  } catch (e) {
    return { folder, ok: false, errors: [loadError(folder, e)], notes: [], character: null, report: {} };
  }
}

/** CLI helper (scripts/sim-smoke-test.js): every valid character, by id. */
export async function loadAllCharacters({ log = true, dir = CHAR_DIR } = {}) {
  const results = await Promise.all(listCharacterFolders(dir).map((f) => loadCharacter(f, { dir })));
  const characters = new Map();
  for (const r of results) {
    if (r.ok) {
      characters.set(r.character.id, r.character);
      if (log) console.log(`  ✔ ${r.character.name ?? r.character.meta?.name} (${r.folder})${r.notes.length ? ` — ${r.notes.length} auto-balance adjustment(s)` : ''}`);
    } else if (log) {
      console.warn(`  ✘ ${r.folder} could not be loaded:\n      ${r.errors.join('\n      ')}`);
    }
  }
  return characters;
}

/**
 * Hardens a worker realm before character code is imported (spec §5.2): the sim
 * guard first (it must replace Math.random etc.), then freeze the intrinsics.
 */
export function hardenRealm(guard) {
  guard.install();
  // Cut `fn.constructor` (Function / AsyncFunction / generator ctors = eval) before freezing.
  const blocked = function () { throw new TypeError('Function constructor is blocked in character realms'); };
  const fnProtos = [function () {}, async function () {}, function* () {}, async function* () {}].map(Object.getPrototypeOf);
  for (const p of fnProtos) Object.defineProperty(p, 'constructor', { value: blocked, writable: false, configurable: false });
  for (const o of [Math, JSON, Reflect, Object.prototype, Array.prototype, ...fnProtos]) Object.freeze(o);
}

/** True when a validated character carries sim-side code (hooks, update, think, SlotFns, ai.hint). */
export function hasSimCode(c) {
  const seen = new Set();
  const scan = (o, depth) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 6) return false;
    seen.add(o);
    for (const k of Object.keys(o)) {
      if (k === 'art') continue;
      const v = o[k];
      if (typeof v === 'function') return true;
      if (scan(v, depth + 1)) return true;
    }
    return false;
  };
  return scan(c, 0);
}
