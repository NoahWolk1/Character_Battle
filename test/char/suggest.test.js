// Unit tests: shared/char/suggest.js (run: node test/char/suggest.test.js)
import assert from 'node:assert/strict';
import { levenshtein, didYouMean, suggestText } from '../../shared/char/suggest.js';

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { console.error(`✘ ${name}\n  ${e.message}`); process.exitCode = 1; } };

t('levenshtein basics', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('same', 'same'), 0);
  assert.equal(levenshtein('abcdef', 'x', 2), 3); // early exit returns max + 1
});
t('did-you-mean on fields, slots, moves', () => {
  assert.equal(didYouMean('knockBack', ['knockback', 'growth']), 'knockback');
  assert.equal(didYouMean('knock_back', ['knockback']), 'knockback');
  assert.equal(didYouMean('sideSpecail', ['sideSpecial', 'upSpecial']), 'sideSpecial');
  assert.equal(didYouMean('hitbox', ['hitboxes', 'hurtboxes']), 'hitboxes');
  assert.equal(didYouMean('durration', ['duration']), 'duration');
});
t('no suggestion when nothing is close', () => {
  assert.equal(didYouMean('banana', ['duration', 'hitboxes']), null);
  assert.equal(didYouMean('x', ['y', 'r']), null); // 1-letter keys never "match" at distance 1
  assert.equal(didYouMean('', ['a']), null);
  assert.equal(didYouMean(5, ['a']), null);
});
t('ties go to the earlier candidate (deterministic)', () => {
  assert.equal(didYouMean('cat', ['bat', 'hat']), 'bat');
});
t('suggestText', () => {
  assert.equal(suggestText('jab2', ['jab']), ' Did you mean "jab"?');
  assert.equal(suggestText('zzz', ['jab']), '');
});

console.log(`${process.exitCode ? '✘' : '✔'} suggest: ${pass} passed`);
