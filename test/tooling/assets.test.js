// Asset check (spec §5.5): limits, format sniffing, SVG safety and missing references.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAll, checkFolder, pngSize, webpSize, svgInfo, ASSET_LIMITS, markdown } from '../../scripts/check-assets.js';

/** Minimal PNG header (signature + IHDR) with the given size; pad to `bytes`. */
function png(w, h, bytes = 64) {
  const b = Buffer.alloc(Math.max(bytes, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function webpVP8X(w, h) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(32, 4); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}
const ogg = (bytes = 64) => { const b = Buffer.alloc(bytes); b.write('OggS', 0, 'latin1'); return b; };

/** Builds characters/x in a temp dir from {relPath: Buffer|string}, runs fn(dir). */
function withFolder(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'cb-assets-'));
  try {
    const dir = join(root, 'characters', 'x');
    mkdirSync(dir, { recursive: true });
    for (const [f, data] of Object.entries(files)) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), data);
    }
    return fn(dir, root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const rulesOf = (r) => r.notes.filter((n) => n.severity === 'error').map((n) => n.rule.replace('assets/', ''));
const CHAR = "export default { id: 'x' };\n";

test('every character folder passes the asset check (warnings allowed)', () => {
  for (const [f, r] of Object.entries(checkAll())) assert.deepEqual(rulesOf(r), [], `${f}: ${r.notes.map((n) => n.text).join('; ')}`);
});

test('format sniffers', () => {
  assert.deepEqual(pngSize(png(320, 200)), { w: 320, h: 200 });
  assert.equal(pngSize(Buffer.from('not a png at all, just text......')), null);
  assert.deepEqual(webpSize(webpVP8X(1024, 512)), { w: 1024, h: 512 });
  assert.deepEqual(svgInfo(Buffer.from('<svg width="64" height="32"></svg>')).w, 64);
  assert.deepEqual(svgInfo(Buffer.from('<svg viewBox="0 0 10 20"></svg>')).h, 20);
  assert.ok(svgInfo(Buffer.from('<svg><script>alert(1)</script></svg>')).problems.length);
});

test('a clean folder with every allowed type passes', () => withFolder({
  'character.js': CHAR, 'art.js': "export default { sheet: './img/sheet.png', s: './hit.ogg' };\n",
  'img/sheet.png': png(2048, 1024), 'face.webp': webpVP8X(256, 256), 'icon.svg': '<svg width="16" height="16"><path d="M0 0h16v16z"/></svg>',
  'hit.ogg': ogg(), 'notes.md': '# notes', 'data.json': '{}',
}, (dir) => {
  const r = checkFolder(dir);
  assert.deepEqual(r.notes, []);
  assert.equal(r.stats.files, 8);
}));

const BAD = [
  ['wrong file type', { 'x.jpg': 'jpeg' }, 'type'],
  ['html file', { 'preview.html': '<html>' }, 'type'],
  ['image > 1.5 MB', { 'big.png': png(100, 100, ASSET_LIMITS.image.maxBytes + 1) }, 'image-size'],
  ['image > 4096 px', { 'wide.png': png(4097, 16) }, 'image-dims'],
  ['webp > 4096 px', { 'tall.webp': webpVP8X(16, 5000) }, 'image-dims'],
  ['fake png', { 'fake.png': 'definitely not a png, only some text here' }, 'format'],
  ['svg with script', { 'x.svg': '<svg width="4" height="4"><script>x()</script></svg>' }, 'svg'],
  ['svg with external href', { 'x.svg': '<svg width="4" height="4"><image href="https://evil/x.png"/></svg>' }, 'svg'],
  ['svg with handler', { 'x.svg': '<svg width="4" height="4" onload="x()"></svg>' }, 'svg'],
  ['audio > 400 KB', { 'long.ogg': ogg(ASSET_LIMITS.audio.maxBytes + 1) }, 'audio-size'],
  ['fake ogg', { 'x.ogg': 'nope nope' }, 'format'],
  ['> 40 files', Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`n${i}.txt`, 'x'])), 'folder-files'],
  ['folder > 6 MB', Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p${i}.png`, png(64, 64, 1.4 * 1024 * 1024)])), 'folder-size'],
  ['JS > 300 KB', { 'big.js': `export const D = '${'x'.repeat(ASSET_LIMITS.js.maxBytes)}';\n` }, 'js-size'],
  ['asset path outside the folder', { 'art.js': "export default { img: '../other/sheet.png' };\n" }, 'outside'],
  ['hidden code file', { '.payload.js': "import 'node:fs';\n" }, 'hidden'],
  ['file in a hidden folder', { '.git/hooks/x.js': 'x' }, 'hidden'],
];
for (const [name, files, rule] of BAD) {
  test(`asset error ${rule}: ${name}`, () => withFolder({ 'character.js': CHAR, ...files }, (dir) => {
    assert.ok(rulesOf(checkFolder(dir)).includes(rule), `expected ${rule}: ${JSON.stringify(checkFolder(dir).notes.map((n) => n.rule))}`);
  }));
}

test('a missing referenced asset is a warning, not an error', () => withFolder({ 'character.js': CHAR, 'art.js': "export default { img: './missing.png' };\n" }, (dir) => {
  const r = checkFolder(dir);
  assert.deepEqual(rulesOf(r), []);
  assert.ok(r.notes.some((n) => n.severity === 'warning' && n.rule === 'assets/missing'));
}));

test('.DS_Store is ignored; markdown summary renders', () => withFolder({ 'character.js': CHAR, '.DS_Store': 'junk' }, (dir, root) => {
  const res = checkAll({ dir: join(root, 'characters') });
  assert.deepEqual(res.x.notes, []);
  assert.match(markdown(res), /\| x \| 1 \|/);
}));
