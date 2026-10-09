// Character lint (spec §5.4): the roster is clean, every rule fires on a purpose-built
// snippet, and legitimate patterns (art helpers, pure top-level helpers) stay clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintAll, lintFolder, markdown } from '../../scripts/lint-characters.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures', 'lint');
const rules = (notes) => new Set(notes.map((n) => n.rule.replace('lint/', '')));

test('every character folder (roster, examples, _template) passes lint', () => {
  const res = lintAll();
  assert.ok(Object.keys(res).length >= 5, 'found character folders');
  for (const [f, notes] of Object.entries(res)) assert.deepEqual(notes.map((n) => `${n.path} ${n.rule}`), [], `${f} lint`);
});

test('bad fixture trips every rule family; good fixture is clean', () => {
  const bad = lintFolder(join(FIX, 'bad'));
  const want = ['import', 'module-let', 'top-level', 'mutate-import', 'sim-random', 'constructor', 'infinite-loop', 'browser-scope',
    'banned-global', 'dynamic-import', 'sim-module-state', 'sim-browser', 'browser-top', 'proto'];
  const got = rules(bad);
  for (const r of want) assert.ok(got.has(r), `rule ${r} fired (got ${[...got].join(', ')})`);
  for (const n of bad) {
    assert.equal(n.code, 'E020');
    assert.match(n.path, /:\d+:\d+$/, 'file:line:col');
    assert.ok(n.why && n.fix, 'why + fix');
  }
  assert.deepEqual(lintFolder(join(FIX, 'good')), []);
  assert.match(markdown({ bad, good: [] }), /\| bad \| ✘ \d+ error/);
});

/** Lints one snippet as characters/x/character.js (+ optional extra files) in a temp repo. */
function lintSnippet(src, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cb-lint-'));
  try {
    const dir = join(root, 'characters', 'x');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'character.js'), src);
    for (const [f, s] of Object.entries(extra)) writeFileSync(join(dir, f), s);
    return rules(lintFolder(dir));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const sim = (body) => `export default { id: 'x', behavior: { tick(view, api) { ${body} } } };\n`;
const top = (body) => `${body}\nexport default { id: 'x' };\n`;

const CASES = [
  // banned everywhere
  ['process', top('function f() { return process.env; }'), 'banned-global'],
  ['require', top('function f() { return require("fs"); }'), 'banned-global'],
  ['globalThis', sim('globalThis.x = 1;'), 'banned-global'],
  ['global', top('function f() { return global; }'), 'banned-global'],
  ['eval', top('function f() { eval("1"); }'), 'banned-global'],
  ['Function', top('function f() { return Function("return 1"); }'), 'banned-global'],
  ['fetch', top('function f() { fetch("http://x"); }'), 'banned-global'],
  ['XMLHttpRequest', top('function f() { return new XMLHttpRequest(); }'), 'banned-global'],
  ['WebSocket', top('function f() { return new WebSocket("ws://x"); }'), 'banned-global'],
  ['setTimeout', top('function f() { setTimeout(f, 1); }'), 'banned-global'],
  ['setInterval', top('function f() { setInterval(f, 1); }'), 'banned-global'],
  ['Atomics', top('function f() { return Atomics; }'), 'banned-global'],
  ['SharedArrayBuffer', top('function f() { return new SharedArrayBuffer(8); }'), 'banned-global'],
  ['localStorage', top('function f() { return localStorage.x; }'), 'banned-global'],
  ['document.cookie', `export default { id: 'x', art: { draw() { return document.cookie; } } };\n`, 'banned-global'],
  ['import()', top('function f() { return import("./y.js"); }'), 'dynamic-import'],
  ['__proto__', top('const o = { __proto__: null };'), 'proto'],
  ['.prototype =', top('function f() { Array.prototype.x = 1; }'), 'proto'],
  ['.constructor()', top('function f() { return f.constructor("return 1"); }'), 'constructor'],
  // imports
  ['node: import', `import fs from 'node:fs';\n${top('')}`, 'import'],
  ['engine import', `import { CATEGORIES } from '../../shared/balance/rules.js';\n${top('')}`, 'import'],
  ['assign to imported', `import * as kit from '../../shared/art/kit.js';\n${top('function f() { kit.PALETTE = 1; }')}`, 'mutate-import'],
  ['Object.defineProperty on imported', `import * as kit from '../../shared/art/kit.js';\n${top('function f() { Object.defineProperty(kit, "a", {}); }')}`, 'mutate-import'],
  ['Object.setPrototypeOf on imported', `import { defineCharacter } from '../../shared/char/api.js';\n${top('function f() { Object.setPrototypeOf(defineCharacter, null); }')}`, 'mutate-import'],
  ['Reflect.* on imported', `import { defineCharacter } from '../../shared/char/api.js';\n${top('function f() { Reflect.set(defineCharacter, "a", 1); }')}`, 'mutate-import'],
  // top level
  ['module let', top('let n = 0;'), 'module-let'],
  ['module var', top('var n = 0;'), 'module-let'],
  ['top-level call', top('console.log(1);'), 'top-level'],
  ['top-level if', top('if (1) {}'), 'top-level'],
  ['import-time call to an unknown global', top('const x = alert(1);'), 'top-call'],
  ['import-time Object.setPrototypeOf', top('const o = Object.setPrototypeOf({}, null);'), 'top-call'],
  ['Object.assign on imported at top level', `import * as kit from '../../shared/art/kit.js';\n${top('Object.assign(kit, { a: 1 });')}`, 'top-level'],
  ['syntax error', 'export default { id: ', 'parse'],
  ['destructured Math.random in tick', sim('const { random } = Math; return random();'), 'sim-random'],
  ['import-time Math.random', top('const r = Math.random();'), 'sim-random'],
  ['import-time Date', top('const t = Date.now();'), 'sim-random'],
  // sim-reachable
  ['Math.random in tick', sim('api.heal(Math.random());'), 'sim-random'],
  ['Date in tick', sim('return new Date();'), 'sim-random'],
  ['performance in tick', sim('return performance.now();'), 'sim-random'],
  ['window in tick', sim('return window;'), 'sim-browser'],
  ['document in tick', sim('return document;'), 'sim-browser'],
  ['Math.random via helper', `function roll() { return Math.random(); }\nexport default { id: 'x', moves: { jab: { update(v, api) { roll(); } } } };\n`, 'sim-random'],
  ['Math.random in ai.hint', `export default { id: 'x', ai: { hint: () => Math.random() } };\n`, 'sim-random'],
  ['Math.random in slot fn', `export default { id: 'x', slots: { jab: () => (Math.random() > 0.5 ? 'jab' : null) } };\n`, 'sim-random'],
  ['Math.random in entity think', `export default { id: 'x', entities: { orb: { think(view, api) { return Math.random(); } } } };\n`, 'sim-random'],
  ['Math.random in imported helper', `import { roll } from './util.js';\n${sim('roll();')}`, 'sim-random', { 'util.js': 'export function roll() { return Math.random(); }\n' }],
  ['module object written from sim', `const CACHE = {};\n${sim('CACHE.n = view.frame;')}`, 'sim-module-state'],
  ['while(true) without break', sim('while (true) { api.heal(1); }'), 'infinite-loop'],
  ['for(;;) without break', sim('for (;;) {}'), 'infinite-loop'],
  // browser objects
  ['Image at top level of art.js', top("import art from './art.js';"), 'browser-top', { 'art.js': 'const img = new Image();\nexport default { draw() {} };\n' }],
  ['document outside art', top('function f() { return document.body; }'), 'browser-scope'],
  // folder-local targets lint never scans (would run unvetted)
  ['import of a dotfile', top("import './.payload.js';"), 'import', { '.payload.js': "import cp from 'node:child_process';\nexport const x = 1;\n" }],
  ['import of a .cjs file', top("import './payload.cjs';"), 'import', { 'payload.cjs': "require('child_process');\n" }],
  ['import of a missing file', top("import './nope.js';"), 'import'],
];

for (const [name, src, rule, extra] of CASES) {
  test(`lint rule ${rule}: ${name}`, () => {
    const got = lintSnippet(src, extra);
    assert.ok(got.has(rule), `expected ${rule}, got [${[...got].join(', ')}]`);
  });
}

const CLEAN = [
  ['art may use document/Image/Math.random inside functions', `import art from './art.js';\nexport default { id: 'x', art };\n`, { 'art.js': "import * as kit from '../../shared/art/kit.js';\nconst cache = {};\nexport default { draw(ctx, view, info) { if (!cache.img) { cache.img = new Image(); } ctx.globalAlpha = Math.random(); return document && kit; } };\n" }],
  ['pure top-level helpers + Object.freeze', "import { defineCharacter } from '../../shared/char/api.js';\nconst hit = (d) => ({ damage: d, angle: 45 });\nconst T = Object.freeze({ a: hit(3) });\nexport default defineCharacter({ id: 'x', hitboxes: T });\n"],
  ['while(true) with a break', sim('let i = 0; while (true) { if (++i > 3) break; }')],
  ['view.rng in sim code', sim('if (view.rng() > 0.5) api.heal(1);')],
  ['locals that shadow module names', `const CACHE = {};\n${sim('const CACHE = {}; CACHE.n = 1;')}`],
  ['Math.random only in art inline functions', `export default { id: 'x', art: { draw(ctx) { ctx.x = Math.random(); } } };\n`],
];
for (const [name, src, extra] of CLEAN) {
  test(`lint clean: ${name}`, () => assert.deepEqual([...lintSnippet(src, extra)], []));
}
