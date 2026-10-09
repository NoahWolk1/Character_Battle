// Character import guard: code smuggled past lint (dotfiles, .cjs, node: builtins, packages,
// data: URLs) must not run in the catalog worker or a CLI loader, and hidden files change
// the folder hash. Payloads only write a marker file next to themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashFolder, loadCharacter } from '../../server/characters.js';
import { scanCharacters } from '../../server/catalog-worker.js';

const MARK = "import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./PWNED', import.meta.url), 'x');\nexport const x = 1;\n";
const CASES = {
  dotfile: { 'character.js': "import './.payload.js';\nexport default { id: 'dotfile' };\n", '.payload.js': MARK },
  cjs: { 'character.js': "import './payload.cjs';\nexport default { id: 'cjs' };\n", 'payload.cjs': "require('fs').writeFileSync(require('path').join(__dirname, 'PWNED'), 'x');\n" },
  builtin: { 'character.js': "import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./PWNED', import.meta.url), 'x');\nexport default { id: 'builtin' };\n" },
  nodemods: { 'character.js': "import './node_modules/p/index.js';\nexport default { id: 'nodemods' };\n", 'node_modules/p/index.js': "import { writeFileSync } from 'fs';\nwriteFileSync(new URL('../../PWNED', import.meta.url), 'x');\n" },
  dataurl: { 'character.js': "import 'data:text/javascript,globalThis.__pwned=1';\nexport default { id: 'dataurl' };\n" },
  dynamic: { 'character.js': "export default { id: 'dynamic', meta: { name: 'D' } };\nexport const later = () => import('node:child_process');\n" },
};

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cb-guard-'));
  for (const [id, files] of Object.entries(CASES)) {
    for (const [f, src] of Object.entries(files)) {
      mkdirSync(join(dir, id, f.split('/').slice(0, -1).join('/')), { recursive: true });
      writeFileSync(join(dir, id, f), src);
    }
  }
  // A legitimate folder-local helper still loads.
  mkdirSync(join(dir, 'ok'));
  writeFileSync(join(dir, 'ok', 'helper.js'), 'export const v = 7;\n');
  writeFileSync(join(dir, 'ok', 'character.js'), "import { v } from './helper.js';\nexport default { id: 'ok', v };\n");
  return dir;
}

test('catalog worker refuses imports that escape the character folder', async () => {
  const dir = makeDir();
  try {
    const ids = Object.keys(CASES).filter((id) => id !== 'dynamic');
    const res = await scanCharacters(ids.map((folder) => ({ folder, dir })));
    for (const [i, r] of res.entries()) {
      assert.equal(r.ok, false, ids[i]);
      assert.match(r.errors.join(' '), /E020 character (import blocked|file .* is not an ES module)/, `${ids[i]}: ${r.errors.join(' ')}`);
      assert.ok(!existsSync(join(dir, ids[i], 'PWNED')), `${ids[i]} payload ran`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI loader (loadCharacter) is guarded too, incl. dynamic import(); local helpers still load', async () => {
  const dir = makeDir();
  try {
    for (const id of ['dotfile', 'cjs', 'builtin', 'nodemods', 'dataurl']) {
      const r = await loadCharacter(id, { dir });
      assert.equal(r.ok, false);
      assert.match(r.errors.join(' '), /E020 character/, id);
      assert.ok(!existsSync(join(dir, id, 'PWNED')), `${id} payload ran`);
    }
    assert.equal(globalThis.__pwned, undefined);
    const mod = await import(join(dir, 'dynamic', 'character.js'));
    await assert.rejects(mod.later(), /E020 character import blocked/);
    const ok = await import(join(dir, 'ok', 'character.js'));
    assert.equal(ok.default.v, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('folder hash covers dotfiles', () => {
  const dir = makeDir();
  try {
    const h1 = hashFolder(join(dir, 'dotfile'));
    writeFileSync(join(dir, 'dotfile', '.payload.js'), MARK + '// changed\n');
    assert.notEqual(hashFolder(join(dir, 'dotfile')), h1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
