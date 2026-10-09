#!/usr/bin/env node
// Re-runs the golden replays (test/golden/*.json) and compares them byte for byte.
//   node scripts/golden-test.js
//   node scripts/golden-test.js --rules '{"governor":false,"legacyKo":true,"grabs":false}'
//   node scripts/golden-test.js --only ember-vs-volt --verbose
// Default rules are DEFAULT_TEST_RULES (v1 ignores unknown keys). Exits 1 on any mismatch.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateCharacter } from '../shared/balance/validate.js';
import { Game } from '../shared/sim/game.js';
import { getStage } from '../shared/stages/index.js';
import { GOLDEN_DIR, DEFAULT_TEST_RULES, loadRoster, pairings, pairFile, runMatch } from '../test/golden/harness.js';

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const verbose = argv.includes('--verbose');
const only = arg('--only');
let rules = DEFAULT_TEST_RULES;
if (arg('--rules')) {
  try { rules = JSON.parse(arg('--rules')); } catch (e) { console.error(`--rules must be JSON: ${e.message}`); process.exit(2); }
}

const manifestFile = join(GOLDEN_DIR, 'manifest.json');
if (!existsSync(manifestFile)) { console.error('No golden fixtures. Record them on reference v1 code: node scripts/record-golden.js'); process.exit(2); }
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const stage = getStage(manifest.stage); // recorded stage id (registry)

const t0 = performance.now();
const roster = await loadRoster(validateCharacter);
// Parity is proven through the v2 path: validateCharacter returns the frozen IR the sim consumes.
for (const [id, r] of Object.entries(roster)) {
  if (r.character.version !== 1 || !r.character.forms?.base || !Object.isFrozen(r.character)) {
    console.error(`✘ golden: ${id} is not a frozen v1-sourced IR — the replay would not exercise the v2 pipeline`); process.exit(2);
  }
}

// Character drift is reported but not failed: the v2 validator may change the
// normalized shape legitimately; the sim traces below are the real gate.
for (const id of manifest.roster) {
  const rec = manifest.characters[id];
  if (rec.source !== roster[id].source) console.warn(`⚠ characters/${id === 'template' ? '_template' : id}/character.js changed since recording — goldens are no longer a valid reference for it.`);
  else if (verbose && rec.normalized !== roster[id].normalized) console.warn(`ℹ ${id}: normalized character differs from recording (validator output changed).`);
}

const fmtP = (p) => p.map((fi, i) => `P${i + 1}[x=${fi[0]} y=${fi[1]} ${fi[2]} ${fi[3]}% ${fi[4]}stk]`).join(' ');
let failures = 0, matches = 0;
for (const [a, b] of pairings()) {
  const name = `${a}-vs-${b}`;
  if (only && name !== only) continue;
  const file = pairFile(a, b);
  if (!existsSync(file)) { console.error(`✘ ${name}: missing fixture`); failures++; continue; }
  const golden = JSON.parse(readFileSync(file, 'utf8'));
  for (const want of golden.matches) {
    matches++;
    const label = `${name} seed ${want.seed} (${want.cpu.join('/')})`;
    let got, views;
    try {
      ({ trace: got, views } = runMatch({ Game, stage, roster, a, b, seed: want.seed, cpu: want.cpu, rules, eventKeys: manifest.eventKeys }));
    } catch (e) {
      console.error(`✘ ${label}: threw ${e.stack || e}`); failures++; continue;
    }
    if (JSON.stringify(got) === JSON.stringify(want)) { if (verbose) console.log(`✔ ${label}`); continue; }
    failures++;
    const n = Math.max(got.checkpoints.length, want.checkpoints.length);
    let i = 0;
    while (i < n && JSON.stringify(got.checkpoints[i]) === JSON.stringify(want.checkpoints[i])) i++;
    const g = got.checkpoints[i], w = want.checkpoints[i];
    const prevF = i > 0 ? want.checkpoints[i - 1].f : 0;
    console.error(`✘ ${label}: first divergence in frames ${prevF + 1}..${w ? w.f : got.frames}`);
    if (!g || !w) {
      console.error(`    match length differs: got ${got.frames} frames (ended=${got.ended}), want ${want.frames} (ended=${want.ended})`);
    } else {
      if (g.s !== w.s) console.error(`    snapshot @${w.f} differs\n      want ${fmtP(w.p)}\n      got  ${fmtP(g.p)}`);
      if (g.e !== w.e) console.error(`    events in window differ (want ${w.n}, got ${g.n})`);
      if (verbose && views[i]) console.error(`    got snapshot: ${views[i].view}\n    got events: ${JSON.stringify(views[i].events)}`);
    }
    if (got.eventsHash !== want.eventsHash) console.error(`    full event list differs (want ${want.events}, got ${got.events})`);
    console.error(`    result want ${JSON.stringify(want.result)} got ${JSON.stringify(got.result)}`);
  }
}

const secs = ((performance.now() - t0) / 1000).toFixed(1);
if (!matches) { console.error(`No golden matches ran${only ? ` for --only ${only}` : ''}.`); process.exit(2); }
if (failures) { console.error(`\n✘ golden: ${failures}/${matches} replay(s) diverged (rules ${JSON.stringify(rules)}, ${secs}s)`); process.exit(1); }
console.log(`✔ golden: ${matches} replays byte-identical (rules ${JSON.stringify(rules)}, ${secs}s)`);
