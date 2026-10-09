// #18 Math.random, Date.now, performance.now and a module `let` in hooks and a SlotFn.
// Invariant: lint errors; at runtime the guard throws, and scripts are disabled after
// 3 throws; the match keeps running deterministically.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario, brawler, stateHash } from '../harness.js';
import { loadCharacter } from '../../../server/characters.js';
import { lintFolder } from '../../../scripts/lint-characters.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'folders');

export default {
  n: 18, name: 'nondeterminism', character: 'chaosmonkey', invariant: 'lint errors; guard throws; scripts disabled after 3 throws',
  async run({ ck, opp }) {
    const lint = lintFolder(join(DIR, 'chaosmonkey'));
    for (const rule of ['lint/module-let', 'lint/sim-module-state', 'lint/sim-random']) ck.check(lint.some((n) => n.rule === rule), `lint did not report ${rule}`);
    ck.check(lint.some((n) => /Date/.test(n.text)) && lint.some((n) => /performance/.test(n.text)), 'lint missed Date / performance');
    const r = await loadCharacter('chaosmonkey', { dir: DIR });
    ck.check(r.ok, `chaosmonkey failed to validate: ${(r.errors || []).join('; ')}`);
    if (!r.ok) return {};
    const run = () => scenario({ cheater: r, opp, frames: 900, ck, input: brawler(['attack', 'attack+fwd'], { gap: 10 }) });
    const S = await run();
    const errs = S.events.filter((e) => e.type === 'scriptError' && e.id === S.me.id);
    const off = S.events.find((e) => e.type === 'gov' && e.rule === 'scriptsDisabled' && e.who === S.me.id);
    ck.check(errs.length >= 1 && errs.every((e) => /not allowed in character sim code/.test(e.message)), `guard errors missing or wrong: ${errs.map((e) => e.message).join(' | ').slice(0, 200)}`);
    ck.check(!!off && off.reason === 'throws', `scripts were not disabled for throws (${JSON.stringify(off)})`);
    ck.check(errs.length === 3, `${errs.length} script errors before disabling (expected exactly 3)`);
    ck.check(!!S.me.scriptsDisabled, 'cheater scripts still enabled at match end');
    ck.check(!S.foe.scriptsDisabled, 'the opponent was disabled too');
    // Determinism: the same seed replays bit-identically despite the attempts.
    const h1 = stateHash(S.game);
    const S2 = await run();
    ck.check(stateHash(S2.game) === h1, 'two runs with the same seed diverged');
    return { lint: lint.map((n) => n.rule), errors: errs.length, disabledAt: off?.frame ?? null };
  },
};
