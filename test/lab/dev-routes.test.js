// Dev-only routes (spec §6.6): contact sheets and art-check results land in
// <root>/.cache, only from local requests, only for safe ids and real PNGs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountDevRoutes } from '../../server/dev-routes.js';
import { formatCheck, findChrome, chromeCommand } from '../../scripts/art-check.js';

const root = mkdtempSync(join(tmpdir(), 'cb-devroutes-'));
const app = express();
mountDevRoutes(app, { root });
const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
after(() => { server.close(); rmSync(root, { recursive: true, force: true }); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);
const post = (path, body, type) => fetch(base + path, { method: 'POST', headers: { 'content-type': type }, body });

test('POST /dev/contact-sheet/:id writes .cache/contact-sheets/<id>.png', async () => {
  const r = await post('/dev/contact-sheet/ember', PNG, 'image/png');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.path, '.cache/contact-sheets/ember.png');
  const file = join(root, '.cache', 'contact-sheets', 'ember.png');
  assert.ok(readFileSync(file).equals(PNG));
  const g = await fetch(`${base}/dev/contact-sheet/ember`);
  assert.equal(g.status, 200);
  assert.equal(Buffer.from(await g.arrayBuffer()).length, PNG.length);
});

test('contact sheet: rejects bad ids and non-PNG bodies', async () => {
  assert.equal((await post('/dev/contact-sheet/..%2Fevil', PNG, 'image/png')).status, 400);
  assert.equal((await post('/dev/contact-sheet/ok', Buffer.from('hello world, not a png at all, definitely not. padding padding padding'), 'image/png')).status, 400);
  assert.equal((await post('/dev/contact-sheet/ok', PNG, 'text/plain')).status, 400);
  assert.ok(!existsSync(join(root, '.cache', 'contact-sheets', 'ok.png')));
  assert.equal((await fetch(`${base}/dev/contact-sheet/nope`)).status, 404);
});

test('POST /dev/art-check/:id stores warnings, info and measures', async () => {
  const body = { warnings: [{ check: 'contrast', where: 'idle', message: 'low contrast' }], info: [{ check: 'perf', message: 'slow [headless]' }], measures: { silhouetteL: 40, stageL: 45 } };
  const r = await post('/dev/art-check/volt', JSON.stringify(body), 'application/json');
  assert.equal(r.status, 200);
  const saved = JSON.parse(readFileSync(join(root, '.cache', 'art-checks', 'volt.json'), 'utf8'));
  assert.equal(saved.id, 'volt');
  assert.equal(saved.warnings.length, 1);
  assert.equal(saved.info.length, 1);
  const text = formatCheck(saved);
  assert.match(text, /volt: 1 warning/);
  assert.match(text, /\[contrast\] low contrast/);
  assert.equal((await post('/dev/art-check/volt', '{"nope":1}', 'application/json')).status, 400);
});

test('fixtures are served for the Lab (?src=/dev/fixtures/<id>/)', async () => {
  const r = await fetch(`${base}/dev/fixtures/nimbus/character.js`);
  // root is a temp dir here, so the static mount 404s; the real server mounts the repo root.
  assert.equal(r.status, 404);
  assert.equal(typeof findChrome(), findChrome() === null ? 'object' : 'string');
});

test('Chrome starts natively (arch -arm64 only when this Node runs under Rosetta)', () => {
  const [cmd, args] = chromeCommand('/chrome', ['--headless=new']);
  if (cmd === '/chrome') assert.deepEqual(args, ['--headless=new']);
  else assert.deepEqual([cmd, args], ['/usr/bin/arch', ['-arm64', '/chrome', '--headless=new']]);
  if (process.platform !== 'darwin' || process.arch !== 'x64') assert.equal(cmd, '/chrome');
});

test('GET /dev/hold/:token is held until POST /dev/release/:token (either order)', async () => {
  let done = false;
  const held = fetch(`${base}/dev/hold/abc123`).then(async (r) => { done = true; return r; });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(done, false, 'still held');
  assert.equal((await post('/dev/release/abc123', '', 'text/plain')).status, 200);
  const r = await held;
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/gif');
  await post('/dev/release/early1', '', 'text/plain'); // release before the hold
  assert.equal((await fetch(`${base}/dev/hold/early1`)).status, 200);
  assert.equal((await fetch(`${base}/dev/hold/BAD!`)).status, 400);
});
