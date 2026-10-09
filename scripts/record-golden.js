#!/usr/bin/env node
// Records golden replays of the v1 roster into test/golden/*.json.
//   node scripts/record-golden.js            record every pairing
//   node scripts/record-golden.js --force    overwrite existing fixtures
// Run ONLY on code whose behavior is the reference (v1 sim). Re-recording after a
// sim change defeats the purpose; scripts/golden-test.js is what CI runs.
import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateCharacter } from '../shared/balance/validate.js';
import { Game } from '../shared/sim/game.js';
import { getStage, DEFAULT_STAGE_ID } from '../shared/stages/index.js';
import {
  GOLDEN_DIR, ROSTER, FRAMES, CHECK_EVERY, STOCKS, SEEDS,
  loadRoster, pairings, pairFile, runMatch,
} from '../test/golden/harness.js';

const stage = getStage(DEFAULT_STAGE_ID);

const force = process.argv.includes('--force');
const existing = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'));
if (existing.length && !force) {
  console.error(`test/golden already has ${existing.length} fixture(s). Re-run with --force to overwrite (only on reference v1 code!).`);
  process.exit(1);
}

const t0 = performance.now();
const roster = await loadRoster(validateCharacter);
const pairs = pairings();

// Pass 1: learn the v1 event shapes (type → keys in emission order).
const learn = {};
for (const [a, b] of pairs) for (const { seed, cpu } of SEEDS) runMatch({ Game, stage, roster, a, b, seed, cpu, learn });
const eventKeys = Object.fromEntries(Object.keys(learn).sort().map((t) => [t, learn[t]]));

// Pass 2: record with the exact projection golden-test uses, asserting it's lossless.
for (const [a, b] of pairs) {
  const matches = SEEDS.map(({ seed, cpu }) => {
    const m1 = runMatch({ Game, stage, roster, a, b, seed, cpu, eventKeys, strict: true }).trace;
    const m2 = runMatch({ Game, stage, roster, a, b, seed, cpu, eventKeys, strict: true }).trace;
    if (JSON.stringify(m1) !== JSON.stringify(m2)) throw new Error(`golden: ${a} vs ${b} seed ${seed} is not deterministic`);
    return m1;
  });
  writeFileSync(pairFile(a, b), `${JSON.stringify({ pair: [a, b], matches }, null, 1)}\n`);
  const r = matches.map((m) => `s${m.seed}: ${m.ended ? 'ended' : 'time'} @${m.frames} stocks ${m.result.stocks.join('/')} ${m.events}ev`).join(' | ');
  console.log(`✔ ${a} vs ${b}  ${r}`);
}

const manifest = {
  version: 1,
  roster: ROSTER,
  frames: FRAMES, checkEvery: CHECK_EVERY, stocks: STOCKS, seeds: SEEDS, stage: stage.id,
  characters: Object.fromEntries(ROSTER.map((id) => [id, { source: roster[id].source, normalized: roster[id].normalized }])),
  eventKeys,
};
writeFileSync(join(GOLDEN_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`\nRecorded ${pairs.length} pairings × ${SEEDS.length} seeds in ${((performance.now() - t0) / 1000).toFixed(1)}s → test/golden/`);
