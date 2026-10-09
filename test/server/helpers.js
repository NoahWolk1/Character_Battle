// Shared helpers for test/server/*.test.js.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFolder, loadCharacter, CHAR_DIR } from '../../server/characters.js';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export { CHAR_DIR };

/** job.chars entry for a character folder. */
export function charSrc(folder, dir = CHAR_DIR) { return { folder, dir, hash: hashFolder(join(dir, folder)) }; }

/** Validated character (imports character code: tests only). */
export async function validated(folder, dir = CHAR_DIR) {
  const r = await loadCharacter(folder, { dir });
  if (!r.ok) throw new Error(`${folder}: ${r.errors.join('; ')}`);
  return r.character;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves when pred() is true (polls every 10 ms) or rejects after ms. */
export async function until(pred, ms = 5000, what = 'condition') {
  const t0 = performance.now();
  while (!pred()) {
    if (performance.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await wait(10);
  }
}
