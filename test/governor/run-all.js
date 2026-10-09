#!/usr/bin/env node
// Runs every test/governor/*.test.js (plain node scripts) and fails if any fails.
// calibration.test.js runs quick settings here (1 seed × 60 s); run it directly for the full sweep.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  const extra = f === 'calibration.test.js' ? ['--seeds', '1', '--seconds', '60'] : [];
  const r = spawnSync(process.execPath, [join(dir, f), ...extra], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
if (failed) { console.error(`✘ governor tests: ${failed}/${files.length} files failed`); process.exit(1); }
console.log(`✔ governor tests: ${files.length} files`);
