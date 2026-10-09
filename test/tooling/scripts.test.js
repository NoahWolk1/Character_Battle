// new-character, migrate and audit: run against temp copies (a temp repo whose shared/
// is a symlink to the real one), never against the real character folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, cpSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadCharacter } from '../../server/characters.js';
import { lintFolder } from '../../scripts/lint-characters.js';
import { checkFolder } from '../../scripts/check-assets.js';
import { migrateFolder, migrateSource, printValue } from '../../scripts/migrate.js';
import { audit } from '../../scripts/audit.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'cb-tool-'));
  symlinkSync(join(ROOT, 'shared'), join(root, 'shared'), 'dir');
  mkdirSync(join(root, 'characters'));
  return { root, chars: join(root, 'characters'), done: () => rmSync(root, { recursive: true, force: true }) };
}

test('new-character copies the template, sets id/name, and the result loads + lints clean', async () => {
  const t = tempRepo();
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'new-character.js'), 'frost-knight', 'Frost', 'Knight', '--dir', t.chars], { encoding: 'utf8' });
    assert.match(out, /Created characters\/frost-knight/);
    const dir = join(t.chars, 'frost-knight');
    const src = readFileSync(join(dir, 'character.js'), 'utf8');
    assert.match(src, /id: 'frost-knight'/);
    assert.match(src, /name: 'Frost Knight'/);
    const tpl = readdirSync(join(ROOT, 'characters', '_template')).filter((f) => !f.startsWith('.')).sort();
    assert.deepEqual(readdirSync(dir).sort(), tpl, 'every template file copied');
    const r = await loadCharacter('frost-knight', { dir: t.chars });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(lintFolder(dir).map((n) => n.text), []);
    assert.deepEqual(checkFolder(dir).notes.filter((n) => n.severity === 'error'), []);
    // Refuses bad ids and existing folders.
    for (const args of [['Bad_Id'], ['frost-knight']]) {
      assert.throws(() => execFileSync(process.execPath, [join(ROOT, 'scripts', 'new-character.js'), ...args, '--dir', t.chars], { stdio: 'pipe' }));
    }
  } finally { t.done(); }
});

test('migrate: every v1 roster character becomes a v2 file that loads, lints clean and keeps its kit', async () => {
  const t = tempRepo();
  try {
    const v1 = ['ember', 'bastion', 'volt', 'mirelle'].filter((id) => existsSync(join(ROOT, 'characters', id)));
    for (const id of v1) {
      cpSync(join(ROOT, 'characters', id), join(t.chars, id), { recursive: true });
      const before = await loadCharacter(id, { dir: t.chars });
      const orig = readFileSync(join(t.chars, id, 'character.js'), 'utf8');
      // An unknown flag (e.g. a guessed --dry-run spelling) must never write.
      assert.throws(() => execFileSync(process.execPath, [join(ROOT, 'scripts', 'migrate.js'), id, '--dryrun', '--dir', t.chars], { stdio: 'pipe' }));
      execFileSync(process.execPath, [join(ROOT, 'scripts', 'migrate.js'), id, '--dry-run', '--dir', t.chars], { stdio: 'pipe' });
      assert.equal(readFileSync(join(t.chars, id, 'character.js'), 'utf8'), orig, 'flags left the file alone');
      const r = await migrateFolder(id, { dir: t.chars });
      assert.ok(r.ok, `${id}: ${JSON.stringify(r.errors)}`);
      assert.equal(readFileSync(r.backup, 'utf8'), orig, 'v1 backup written');
      assert.ok(r.backup.startsWith(join(t.root, '.cache', 'migrate')), r.backup);
      const src = readFileSync(join(t.chars, id, 'character.js'), 'utf8');
      assert.match(src, /export default defineCharacter\(/);
      assert.match(src, /from '\.\.\/\.\.\/shared\/char\/api\.js'/);
      assert.doesNotMatch(src, /\n  stats: \{[^}]*\b(width|height):/, 'width/height moved into body');
      assert.match(src, /\n  body: \{\n    collider:/);
      const after = await loadCharacter(id, { dir: t.chars, hash: 'migrated' });
      assert.ok(after.ok, JSON.stringify(after.errors));
      const c0 = before.character, c1 = after.character;
      assert.equal(c1.id, id);
      assert.deepEqual(Object.keys(c1.moves).sort(), Object.keys(c0.moves).sort(), `${id} moves`);
      assert.deepEqual(Object.keys(c1.entities || {}).sort(), Object.keys(c0.entities || {}).sort(), `${id} projectile entities`);
      assert.equal(c1.forms.base.body.collider.w, c0.forms.base.body.collider.w);
      assert.equal(c1.moves.upSpecial.helpless, true);
      assert.deepEqual(lintFolder(join(t.chars, id)).map((n) => n.text), [], `${id} lint`);
      // Second run refuses: already v2.
      await assert.rejects(() => migrateFolder(id, { dir: t.chars, write: false }), /already/);
    }
  } finally { t.done(); }
});

test('migrate: keeps functions and the rest of the file; prints compact literals', () => {
  const src = "// header\nimport { art } from './art.js';\nconst k = 2;\nexport default {\n  id: 'z', name: 'Z', stats: { width: 40, height: 80 },\n  moves: { jab: { duration: 12, pose: (t) => t * k, hitboxes: [{ start: 2, end: 4, damage: 3 }] } },\n  art,\n};\n";
  const def = { id: 'z', name: 'Z', stats: { width: 40, height: 80 }, moves: { jab: { duration: 12, pose: (t) => t, hitboxes: [{ start: 2, end: 4, damage: 3 }] } }, art: {} };
  const { src: out } = migrateSource(src, def, { expectedId: 'z' });
  assert.match(out, /^\/\/ header\nimport \{ defineCharacter \}/);
  assert.match(out, /const k = 2;/);
  assert.match(out, /pose: \(t\) => t \* k/);
  assert.match(out, /\n  art,\n/);
  assert.match(out, /group: 0/, 'v1 group default made explicit');
  assert.equal(printValue({ a: [1, -0, 'x\'y'], b: null }), "{ a: [1, 0, 'x\\'y'], b: null }");
});

test('audit: seeded hard-CPU matches report the Governor\'s work', async () => {
  const ember = (await loadCharacter('ember')).character;
  const volt = (await loadCharacter('volt')).character;
  const a = audit(ember, { roster: [ember, volt], seeds: 1, seconds: 10 });
  for (const k of ['matches', 'frames', 'trimmedPct', 'koClamps', 'spikeCaps', 'breaks', 'riseExhausted', 'govEvents', 'scriptMs', 'scriptsDisabled']) assert.equal(typeof a[k], 'number', k);
  assert.equal(a.matches, 1);
  assert.equal(a.frames, 600);
  assert.deepEqual(audit(ember, { roster: [ember, volt], seeds: 1, seconds: 10 }), { ...a, scriptMs: audit(ember, { roster: [ember, volt], seeds: 1, seconds: 10 }).scriptMs }, 'deterministic');
});

test('validate report is deterministic: two CLI runs give the same JSON hash (§10.1)', async () => {
  const { createHash } = await import('node:crypto');
  const run = () => createHash('sha256').update(execFileSync(process.execPath, [join(ROOT, 'scripts', 'validate.js'), '--json'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })).digest('hex');
  assert.equal(run(), run());
});
