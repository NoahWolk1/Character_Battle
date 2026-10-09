#!/usr/bin/env node
// Re-captures fixtures/v1-pre-change.json from a validator module (default: the
// frozen pre-v2 copy). Only run deliberately: the fixture is the v1-parity oracle.
//   node test/validate/capture-v1.js [path/to/validate.js]
import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadV1Cases, encode, projectResult } from './v1-cases.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] || join(here, '..', '..', 'shared', 'balance', 'validate.js'));
const { validateCharacter } = await import(pathToFileURL(src).href);
const cases = await loadV1Cases();
const out = {};
for (const c of cases) out[c.label] = JSON.parse(encode(projectResult(validateCharacter(c.def, c.opts))));
writeFileSync(join(here, 'fixtures', 'v1-pre-change.json'), JSON.stringify(out) + '\n');
console.log(`captured ${cases.length} v1 cases from ${src}`);
