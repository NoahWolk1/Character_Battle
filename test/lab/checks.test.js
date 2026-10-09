// §6.6 automatic checks against a purpose-built bad fixture (test/lab/fixtures/lab-bad):
// every check must fire. The pixel checks need a real canvas, so the browser half drives
// headless Chrome through scripts/art-check.js; it is opt-in (LAB_BROWSER=1, ~30 s) to keep
// `npm test` fast:  LAB_BROWSER=1 node --test test/lab/checks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { validateCharacter } from '../../shared/balance/validate.js';
import { findChrome, startServer, runLab, checkFile, sheetFile } from '../../scripts/art-check.js';
import bad from './fixtures/lab-bad/character.js';

const CHECKS = ['hitbox-coverage', 'hurtbox-fit', 'bounds-overflow', 'contrast', 'perf'];

test('lab-bad fixture is a valid character (only its art is bad)', () => {
  const v = validateCharacter(bad, { expectedId: 'lab-bad' });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.ok(v.character.moves.jab, 'jab survives validation');
});

const browser = process.env.LAB_BROWSER === '1' && findChrome();
test('every §6.6 check fires on the bad fixture; the contact sheet is written', { skip: !browser && 'set LAB_BROWSER=1 (needs Chrome)', timeout: 240000 }, async () => {
  const server = await startServer();
  try {
    const r = await runLab({ url: server.url, id: 'lab-bad', src: '/dev/lab-fixtures/lab-bad/', checks: true, sheet: true, timeout: 200000 });
    assert.ok(r.ok, `Lab did not finish: ${r.errors.join(' | ')}`);
  } finally {
    server.stop();
  }
  const res = JSON.parse(readFileSync(checkFile('lab-bad'), 'utf8'));
  // Headless Chrome reports perf as info (its timings are not the player's), so look at both.
  const fired = new Set([...res.warnings, ...(res.info || [])].map((w) => w.check));
  for (const c of CHECKS) assert.ok(fired.has(c), `${c} did not fire: ${[...fired].join(', ')}`);
  assert.ok(res.warnings.some((w) => w.check === 'hitbox-coverage' && /^jab /.test(w.where)), 'jab hitbox floats in empty space');
  assert.ok(existsSync(sheetFile('lab-bad')), 'contact sheet PNG written');
  const png = readFileSync(sheetFile('lab-bad'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
});
