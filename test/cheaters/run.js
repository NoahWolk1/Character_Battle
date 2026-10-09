#!/usr/bin/env node
// Adversarial cheater characters (spec §10.2). Every kit in test/cheaters/kits/ runs
// headless against the reference dummy AND a hard CPU, each run in its own worker
// thread with a 10 s kill timeout, and asserts its listed invariant plus the global
// invariants of §4.2.11 (harness.js). A hung run is killed and reported with the
// character's name (kit #19 expects exactly that).
//   node test/cheaters/run.js                 every kit, both opponents
//   --only 3,11,25   --opp dummy|cpu   --jobs N   --timeout ms   --json   --verbose
import { Worker } from 'node:worker_threads';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { availableParallelism } from 'node:os';

const DIR = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const only = val('--only', null)?.split(',').map((s) => s.trim());
const oppOnly = val('--opp', null);
const timeoutMs = Number(val('--timeout', 10000));
const jobsN = Number(val('--jobs', Math.max(2, Math.min(8, availableParallelism() - 1))));
const json = args.includes('--json');
const verbose = args.includes('--verbose');

const files = readdirSync(join(DIR, 'kits')).filter((f) => f.endsWith('.js')).sort();
const kits = [];
for (const f of files) {
  const file = pathToFileURL(join(DIR, 'kits', f)).href;
  const meta = (await import(file)).default;
  if (only && !only.includes(String(meta.n))) continue;
  kits.push({ file, meta });
}
const jobs = [];
for (const k of kits) for (const opp of k.meta.opponents || ['dummy', 'cpu']) if (!oppOnly || opp === oppOnly) jobs.push({ ...k, opp });

function runJob(job) {
  return new Promise((resolve) => {
    const w = new Worker(join(DIR, 'worker.js'), { workerData: { file: job.file, opp: job.opp, verbose }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    let character = job.meta.character || job.meta.name;
    let settled = false;
    const t0 = performance.now();
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); w.terminate(); resolve({ job, ...r, ms: r.ms ?? performance.now() - t0 }); };
    const timer = setTimeout(() => finish({ hung: true, ok: false, failures: [`hang: worker killed after ${timeoutMs} ms while running character "${character}"`], notes: [] }), timeoutMs);
    w.on('message', (m) => {
      if (m.type === 'start') character = m.character || character;
      else if (m.type === 'done') finish(m);
    });
    w.on('error', (e) => finish({ ok: false, failures: [`worker crashed (${character}): ${e && e.stack}`], notes: [] }));
    w.on('exit', (code) => finish({ ok: false, failures: [`worker exited (${code}) without a result (${character})`], notes: [] }));
  });
}

const t0 = performance.now();
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobsN, jobs.length) }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    let r = await runJob(job);
    if (job.meta.expectHang) {
      // #19: the kill IS the expected outcome; it must name the character.
      const named = r.hung && r.failures.some((m) => m.includes(job.meta.character));
      r = { ...r, ok: named, failures: named ? [] : [`expected the worker to hang and be killed with a message naming "${job.meta.character}"; got: ${r.failures.join('; ') || 'a normal finish'}`], notes: named ? [`killed as expected: ${r.failures[0]}`] : r.notes };
    }
    results.push(r);
    if (!json) {
      const tag = `#${String(job.meta.n).padEnd(3)} ${job.meta.name.padEnd(26)} vs ${job.opp.padEnd(5)}`;
      const nIssues = (r.issues || []).length;
      console.log(`${r.ok ? '✔' : '✘'} ${tag} ${(r.ms / 1000).toFixed(1)}s${r.passes ? ` (${r.passes} checks)` : ''}${nIssues ? ` [${nIssues} open issue${nIssues > 1 ? 's' : ''}]` : ''}`);
      for (const f of r.failures || []) console.log(`    ✘ ${f}`);
      for (const i of r.issues || []) console.log(`    ⚠ OPEN ISSUE: ${i}`);
      if (verbose) { for (const n of r.notes || []) if (!n.startsWith('OPEN ISSUE')) console.log(`    · ${n}`); if (r.stats) console.log(`    · stats ${JSON.stringify(r.stats)}`); }
    }
  }
}));
results.sort((a, b) => a.job.meta.n - b.job.meta.n || a.job.opp.localeCompare(b.job.opp));
const failed = results.filter((r) => !r.ok);
const issues = [...new Set(results.flatMap((r) => (r.issues || []).map((i) => `#${r.job.meta.n} ${r.job.meta.name}: ${i}`)))];
const secs = ((performance.now() - t0) / 1000).toFixed(1);
if (json) {
  console.log(JSON.stringify(results.map((r) => ({ n: r.job.meta.n, name: r.job.meta.name, opp: r.job.opp, ok: r.ok, failures: r.failures, issues: r.issues, notes: r.notes, stats: r.stats })), null, 2));
} else if (failed.length) {
  console.error(`✘ cheaters: ${failed.length}/${results.length} runs failed in ${secs}s (kits: ${[...new Set(failed.map((r) => r.job.meta.n))].join(', ')})`);
} else {
  console.log(`✔ cheaters: ${results.length} runs (${kits.length} kits × dummy/cpu) in ${secs}s; every invariant held${issues.length ? `, ${issues.length} open engine issue(s) recorded` : ''}`);
}
if (issues.length && !json) { console.log('\nOpen engine issues (measured, not weakened; for the review phase):'); for (const i of issues) console.log(`  ⚠ ${i}`); }
if (failed.length) process.exitCode = 1;
