// Fuzz harness mechanics (spec §5.7): seeded and reproducible, and a hung job is killed
// by the timeout while the remaining jobs still run. The fuzz run itself is `npm run fuzz:quick`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genKit, planJobs, runJobs } from '../../scripts/fuzz.js';

const src = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' ? String(x) : typeof x === 'number' && !Number.isFinite(x) ? String(x) : x === undefined ? '<u>' : x));

test('genKit is deterministic per seed and covers v1 and v2 shapes', () => {
  for (const seed of [1, 42, 0xdeadbeef]) {
    assert.equal(src(genKit(seed, 2).def), src(genKit(seed, 2).def));
    assert.equal(src(genKit(seed, 1).def), src(genKit(seed, 1).def));
  }
  assert.notEqual(src(genKit(1, 2).def), src(genKit(2, 2).def));
  assert.equal(genKit(7, 2).def.version, 2);
  assert.equal(genKit(7, 1).def.version, undefined);
  const feats = new Set();
  for (let s = 0; s < 200; s++) for (const k of Object.keys(genKit(s, 2).def)) feats.add(k);
  for (const k of ['body', 'entities', 'statuses', 'resources', 'forms', 'behavior', 'slots', 'hitboxes', 'movement', 'ai']) assert.ok(feats.has(k), `kits exercise ${k}`);
});

test('planJobs: quick and long modes, seeded', () => {
  const q = planJobs({ quick: true });
  assert.equal(q.filter((j) => j.kind === 'kit').length, 60);
  assert.equal(q.filter((j) => j.kind === 'roster').length, 8);
  assert.ok(q.some((j) => j.version === 1) && q.some((j) => j.version === 2));
  assert.deepEqual(planJobs({ quick: true, seed: 5 }), planJobs({ quick: true, seed: 5 }));
  assert.notDeepEqual(planJobs({ quick: true, seed: 5 }), planJobs({ quick: true, seed: 6 }));
  assert.equal(planJobs({}).length, 340);
  assert.equal(planJobs({ only: 'kit', kits: 3 }).length, 3);
});

test('a hung job is terminated by the kill timeout and the rest still run', { timeout: 120000 }, async () => {
  const jobs = [{ kind: 'kit', version: 2, seed: 11 }, { kind: 'debug-hang', seed: 0 }, { kind: 'kit', version: 1, seed: 12 }, { kind: 'roster', index: 0, seed: 3 }];
  const seen = [];
  const { results, hangs } = await runJobs(jobs, { seconds: 1, timeoutMs: 5000, onResult: (r) => seen.push(r) });
  assert.equal(hangs.length, 1);
  assert.equal(hangs[0].kind, 'debug-hang');
  const byKind = (k, s) => results.find((r) => r.job && r.job.kind === k && r.job.seed === s);
  assert.equal(byKind('kit', 11)?.ok, true, 'job before the hang');
  assert.equal(byKind('kit', 12)?.ok, true, 'job after the hang ran in a fresh worker');
  assert.equal(byKind('roster', 3)?.ok, true, `roster FFA: ${byKind('roster', 3)?.error}`);
  assert.equal(seen.filter((r) => !r.ok).length, 1);
});
