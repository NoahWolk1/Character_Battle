// #17 Rule mutation: `CATEGORIES.smash.maxHit = 999` (and GOVERNOR.absMaxHit) at import.
// Invariant: throws at load (E004); the character fails to load; other characters are
// unaffected. Lint flags the import and the mutation.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario, cpuChar, brawler } from '../harness.js';
import { loadCharacter } from '../../../server/characters.js';
import { CATEGORIES } from '../../../shared/balance/rules.js';
import { GOVERNOR } from '../../../shared/balance/governor-rules.js';
import { lintFolder } from '../../../scripts/lint-characters.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'folders');

export default {
  n: 17, name: 'rule-mutation', character: 'rulebender', invariant: 'E004 at load; rules unchanged; others unaffected; lint errors',
  async run({ ck, opp }) {
    const r = await loadCharacter('rulebender', { dir: DIR });
    ck.check(r.ok === false, 'the rule-mutating character loaded');
    const errs = (r.errors || []).map((e) => (typeof e === 'string' ? e : `${e.code} ${e.text || e.why}`));
    ck.check(errs.some((e) => /read[- ]only|frozen|not extensible|Cannot assign/i.test(e)), `load error does not show the frozen-rules TypeError: ${errs.join('; ')}`);
    ck.issue((r.errors || []).some((e) => (typeof e === 'object' && e.code === 'E004') || /\bE004\b/.test(String(e))), `import-time throw ("${errs[0]?.slice(0, 90)}…") is surfaced as an uncoded "Failed to load …" string, not the E004 note §10.2 #17 / §4.1.6 specify. Root: server/characters.js loadCharacter catches the import() throw and returns a plain string before validateCharacter runs, so the E004 path in shared/char/normalize-v2.js never fires for module-body throws. Fix: wrap the import error in finishNote({code:'E004'}) in loadCharacter (and catalog-worker.js). [root: server/characters.js loadCharacter catch]`, 'e004');
    ck.check(CATEGORIES.smash.maxHit === 18 && GOVERNOR.absMaxHit === 25, `rules changed: smash.maxHit ${CATEGORIES.smash.maxHit}, absMaxHit ${GOVERNOR.absMaxHit}`);
    const lint = lintFolder(join(DIR, 'rulebender'));
    for (const rule of ['lint/import', 'lint/mutate-import']) ck.check(lint.some((n) => n.rule === rule), `lint did not report ${rule}`);
    // Other characters still load and play with the real limits.
    const ember = await loadCharacter('ember');
    ck.check(ember.ok, 'ember failed to load after the cheater');
    const S = await scenario({ cheater: ember.ok ? ember : { character: await cpuChar() }, opp, frames: 1200, ck, input: brawler(['strong+fwd', 'attack', 'attack+fwd'], { gap: 12 }) });
    for (const h of S.hits) ck.check(h.r.damage <= Math.min(25, 1.4 * (CATEGORIES[h.tier]?.maxHit ?? 25)) + 1e-6, `post-cheater hit dealt ${h.r.damage} (${h.tier})`, 'post');
    return { loadError: errs[0]?.slice(0, 160), lint: lint.map((n) => n.rule), hitsAfter: S.hits.length };
  },
};
