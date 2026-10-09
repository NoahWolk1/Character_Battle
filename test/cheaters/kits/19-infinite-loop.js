// #19a Infinite loop in `tick`. Invariant (CI): the worker is killed after the 10 s
// timeout and the failure names the character. (The runner expects the hang.)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from '../harness.js';
import { loadCharacter } from '../../../server/characters.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'folders');

export default {
  n: 19, name: 'infinite-loop', character: 'spinlock', invariant: 'worker killed at 10 s; failure names the character', expectHang: true,
  async run({ ck, opp }) {
    const r = await loadCharacter('spinlock', { dir: DIR });
    ck.check(r.ok, `spinlock failed to validate: ${(r.errors || []).join('; ')}`);
    await scenario({ cheater: r, opp, frames: 600, ck });
    ck.check(false, 'the infinite loop returned');
    return {};
  },
};
