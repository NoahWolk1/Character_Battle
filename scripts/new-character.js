#!/usr/bin/env node
// Creates a new character folder from characters/_template (v1 or v2 template:
// every file in the folder is copied; character.js gets the new id and name).
//   npm run new-character -- <id> ["Display Name"]
//   npm run new-character -- frost-knight "Frost Knight"
//   --dir <path>   create the folder somewhere else (tests)
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_LIMITS } from '../shared/balance/rules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = join(ROOT, 'characters', '_template');

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m' }
  : { red: '', green: '', cyan: '', bold: '', dim: '', reset: '' };
const fail = (msg) => { console.error(`${C.red}✘ ${msg}${C.reset}`); process.exit(1); };

const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const CHAR_DIR = dirIdx >= 0 ? resolve(args[dirIdx + 1]) : join(ROOT, 'characters');
const [id, ...nameParts] = args.filter((a, i) => !a.startsWith('--') && !(dirIdx >= 0 && i === dirIdx + 1));

if (!id) fail('Usage: npm run new-character -- <id> ["Display Name"]\n  e.g. npm run new-character -- frost-knight "Frost Knight"');
if (!META_LIMITS.idPattern.test(id)) fail(`"${id}" is not a valid id. Use 2–24 lowercase letters, digits or dashes, starting with a letter (e.g. "frost-knight").`);

// Default display name: "frost-knight" → "Frost Knight"
const titleCase = (s) => s.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const name = nameParts.join(' ').trim() || titleCase(id);
if (name.length > META_LIMITS.nameMax) fail(`Display name "${name}" is ${name.length} characters; the max is ${META_LIMITS.nameMax}.`);

const dir = join(CHAR_DIR, id);
if (existsSync(dir)) fail(`characters/${id}/ already exists. Pick another id, or edit that character directly.`);
if (!existsSync(join(TEMPLATE_DIR, 'character.js'))) fail('characters/_template/character.js is missing.');

// character.js: replace the template id and name (v1 `export default {` or v2 `defineCharacter({`).
const quoted = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
let src = readFileSync(join(TEMPLATE_DIR, 'character.js'), 'utf8');
const idRe = /(\bid:\s*)(['"])template\2/;
const nameRe = /(\bname:\s*)(['"])Template\2/;
if (!idRe.test(src)) fail("Couldn't find `id: 'template'` in characters/_template/character.js — has it been edited?");
src = src.replace(idRe, `$1${quoted(id)}`);
if (nameRe.test(src)) src = src.replace(nameRe, `$1${quoted(name)}`);

mkdirSync(dir, { recursive: true });
const copied = ['character.js'];
const copyTree = (from, to, rel = '') => {
  for (const d of readdirSync(from, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (r === 'character.js') continue;
    if (d.isDirectory()) { mkdirSync(join(to, d.name), { recursive: true }); copyTree(join(from, d.name), join(to, d.name), r); }
    else if (d.isFile()) { copyFileSync(join(from, d.name), join(to, d.name)); copied.push(r); }
  }
};
copyTree(TEMPLATE_DIR, dir);
writeFileSync(join(dir, 'character.js'), src);

const v2 = /defineCharacter\s*\(/.test(src);
console.log(`
${C.green}✔ Created characters/${id}/${C.reset}  ${C.dim}(${name}; ${copied.join(', ')}; ${v2 ? 'v2' : 'v1'} template)${C.reset}

${C.bold}Next steps${C.reset}  ${C.dim}(the full Description→Kit procedure is in CLAUDE.md)${C.reset}
  1. Read ${C.cyan}docs/CHARACTER_GUIDE.md${C.reset}, ${C.cyan}docs/COOKBOOK.md${C.reset} and ${C.cyan}docs/ART_GUIDE.md${C.reset}.
  2. Check what the balancer did: ${C.cyan}npm run validate -- ${id} --explain${C.reset}
  3. Start the game:              ${C.cyan}npm run dev${C.reset}
  4. Try your fighter:            ${C.cyan}http://localhost:3000/?train=${id}${C.reset}   ${C.dim}(H = hitboxes, Y = slow-mo, T = taunt, R = reset)${C.reset}
  5. Inspect every animation:     ${C.cyan}http://localhost:3000/lab.html?char=${id}${C.reset}
  6. Before you open a PR:        ${C.cyan}npm test${C.reset}   ${C.dim}(lint, assets, validate, fuzz, matches)${C.reset}

Only edit files inside ${C.bold}characters/${id}/${C.reset}. Have fun!
`);
