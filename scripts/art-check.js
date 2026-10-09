#!/usr/bin/env node
// Art Lab automatic checks (spec §6.6) from the command line.
//
//   npm run art-check -- <id> [<id>...]   check characters (default: every roster character)
//   npm run art-check -- --src /dev/fixtures/nimbus/   check a dev fixture folder
//   npm run art-check -- _template        check an underscore folder (saved as .cache/art-checks/template.json)
//   options: --sheet (also save the contact sheet) --ci (exit 1 on warnings)
//            --url http://localhost:3000 (use a running dev server; default: start one)
//            --timeout <ms> per character (default 120000) --chrome <path>
//
// The checks run inside the Lab page (they need a real canvas). This script drives
// headless Chrome against /lab.html?still=1&checks=1, which POSTs the results to the
// dev-only route /dev/art-check/:id → .cache/art-checks/<id>.json (and, with --sheet,
// /dev/contact-sheet/:id → .cache/contact-sheets/<id>.png). Without Chrome it prints
// the results the Lab saved last time you ran checks in a browser.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ID = /^_?[a-z0-9][a-z0-9_-]{0,47}$/i; // _template etc. load via --src /characters/<id>/
// The Lab saves results under the character's own id; `_template` declares id 'template'.
const fileId = (id) => id.replace(/^_/, '');

export const sheetFile = (id) => join(ROOT, '.cache', 'contact-sheets', `${id}.png`);
export const checkFile = (id) => join(ROOT, '.cache', 'art-checks', `${id}.json`);

/** First Chrome/Chromium binary found (CHROME env wins). */
export function findChrome(explicit) {
  const c = [
    explicit, process.env.CHROME, process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return c.find((p) => p && existsSync(p)) || null;
}

/**
 * [command, args] that start Chrome natively. An x64 Node on Apple silicon runs under
 * Rosetta, and a universal Chrome it spawns inherits the x64 slice: every JIT tier then
 * goes through Rosetta and page JS runs ~100x slower (the roster takes minutes to load).
 * `arch -arm64` picks the native slice; elsewhere this is a plain spawn.
 */
export function chromeCommand(chrome, args) {
  if (process.platform === 'darwin' && process.arch === 'x64' && existsSync('/usr/bin/arch')) {
    let translated = false;
    try { translated = execFileSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' }).trim() === '1'; } catch { /* not Apple silicon */ }
    if (translated) return ['/usr/bin/arch', ['-arm64', chrome, ...args]];
  }
  return [chrome, args];
}

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

/** Starts server/index.js (dev mode) on a free port. Resolves {url, stop}. */
export async function startServer({ quiet = true } = {}) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), NODE_ENV: 'development' };
  const p = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`dev server did not start in 60 s:\n${log}`)), 60000);
    const on = (d) => { log += d; if (!quiet) process.stderr.write(d); if (/running/.test(log)) { clearTimeout(t); ok(); } };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
    p.once('exit', (code) => { clearTimeout(t); fail(new Error(`dev server exited (${code}):\n${log}`)); });
  });
  p.removeAllListeners('exit');
  return { url: `http://127.0.0.1:${port}`, stop: () => p.kill() };
}

const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);

/**
 * Opens the Lab in headless Chrome (CDP navigate; --timeout screenshot fallback without a
 * WebSocket client) and waits until the page has
 * written every expected .cache file. Resolves {ok, files, ms}.
 * o: { url, id, src, checks, sheet, timeout, chrome, extra (query string) }
 */
export async function runLab(o) {
  const chrome = findChrome(o.chrome);
  if (!chrome) throw new Error('Chrome/Chromium not found (set CHROME=/path/to/chrome)');
  const q = new URLSearchParams({ still: '1' });
  if (o.src) q.set('src', o.src); else q.set('char', o.id);
  if (o.checks) q.set('checks', '1');
  if (o.sheet) q.set('sheet', '1');
  for (const [k, v] of new URLSearchParams(o.extra || '')) q.set(k, v);
  const page = `${o.url}/lab.html?${q}`;
  const want = [o.checks && checkFile(fileId(o.id)), o.sheet && sheetFile(fileId(o.id))].filter(Boolean);
  const before = new Map(want.map((f) => [f, mtime(f)]));
  const timeout = o.timeout || 120000;
  const prof = mkdtempSync(join(tmpdir(), 'cb-lab-'));
  const args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-component-update',
    '--disable-background-networking', '--hide-scrollbars', '--mute-audio', `--user-data-dir=${prof}`, '--window-size=1600,1200'];
  const t0 = Date.now();
  const done = () => want.every((f) => mtime(f) > before.get(f));
  const WS = globalThis.WebSocket || (await import('ws').then((m) => m.default || m.WebSocket, () => null));
  const p = spawn(...chromeCommand(chrome, WS ? [...args, '--remote-debugging-port=0', 'about:blank'] : [...args, `--timeout=${timeout}`, `--screenshot=${join(prof, 'lab.png')}`, page]), { stdio: ['ignore', 'ignore', 'pipe'] });
  let exited = false, errLog = '';
  p.once('exit', () => { exited = true; });
  const errors = [];
  let cdp = null;
  try {
    if (WS) {
      // CDP: navigate, then wait for the page's own files (the Lab never ends on its own in
      // still mode, and --timeout screenshots fire at the load event, before the checks finish).
      const wsUrl = await new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error('Chrome did not open a debugging port')), 30000);
        p.stderr.on('data', (d) => { errLog += d; const m = errLog.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); ok(m[1]); } });
        p.once('exit', () => fail(new Error(`Chrome exited:\n${errLog.slice(-800)}`)));
      });
      const port = new URL(wsUrl).port;
      let target = null;
      for (let i = 0; i < 40 && !target; i++) {
        target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
        if (!target) await new Promise((r) => setTimeout(r, 250));
      }
      cdp = new WS(target.webSocketDebuggerUrl);
      await new Promise((ok, fail) => { cdp.onopen = ok; cdp.onerror = fail; });
      let n = 0;
      cdp.onmessage = (m) => {
        const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
        if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
        else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((x) => x.value ?? x.description).join(' '));
      };
      const send = (method, params = {}) => cdp.send(JSON.stringify({ id: ++n, method, params }));
      send('Runtime.enable');
      send('Page.navigate', { url: page });
    }
    while (!done() && !exited && Date.now() - t0 < timeout) await new Promise((r) => setTimeout(r, 250));
    await new Promise((r) => setTimeout(r, 150)); // let the last write land
  } finally {
    try { cdp?.close(); } catch { /* closed */ }
    if (!exited) p.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { rmSync(prof, { recursive: true, force: true }); } catch { /* chrome may still hold it */ }
  }
  return { ok: done(), files: want, ms: Date.now() - t0, page, errors: errors.slice(0, 5) };
}

/** Human-readable report for one saved check result. */
export function formatCheck(r) {
  const lines = [`${r.id}: ${r.warnings.length ? `${r.warnings.length} warning(s)` : 'clean'}  (${r.at})`];
  for (const w of r.warnings) lines.push(`  ⚠ [${w.check}] ${w.message}`);
  for (const w of r.info || []) lines.push(`  · [${w.check}] ${w.message}`);
  const m = r.measures || {};
  if (m.fit) lines.push(`  · hurtbox fit: ${Math.round(m.fit.outside * 100)}% outside, ${Math.round(m.fit.empty * 100)}% empty`);
  if (Number.isFinite(m.silhouetteL) && Number.isFinite(m.stageL)) lines.push(`  · contrast: L*${m.silhouetteL.toFixed(0)} vs stage L*${m.stageL.toFixed(0)}`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const o = { ids: [], sheet: false, ci: false, url: null, timeout: 120000, chrome: null, src: null, checks: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sheet') o.sheet = true;
    else if (a === '--no-checks') o.checks = false;
    else if (a === '--ci') o.ci = true;
    else if (a === '--url') o.url = argv[++i].replace(/\/$/, '');
    else if (a === '--timeout') o.timeout = +argv[++i];
    else if (a === '--chrome') o.chrome = argv[++i];
    else if (a === '--src') o.src = argv[++i];
    else if (a === '-h' || a === '--help') o.help = true;
    else o.ids.push(a);
  }
  return o;
}

function rosterIds() {
  return readdirSync(join(ROOT, 'characters'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !/^[_.]/.test(d.name) && existsSync(join(ROOT, 'characters', d.name, 'character.js')))
    .map((d) => d.name).sort();
}

/** CLI shared by art-check and contact-sheet. */
export async function main(argv, { label = 'art-check', defaults = {} } = {}) {
  const o = { ...parseArgs(argv), ...defaults };
  if (o.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  if (o.src) {
    if (!/^\/[\w\-/.]+\/$/.test(o.src) || o.src.includes('..')) { console.error('--src must look like /dev/fixtures/<id>/'); return 2; }
    o.ids = [o.src.split('/').filter(Boolean).pop()];
  }
  const ids = o.ids.length ? o.ids : rosterIds();
  const bad = ids.filter((id) => !ID.test(id));
  if (bad.length) { console.error(`bad id(s): ${bad.join(', ')}`); return 2; }
  const chrome = findChrome(o.chrome);
  if (!chrome) {
    console.error(`${label}: Chrome not found (set CHROME=/path/to/chrome). Showing the results the Lab saved last:`);
    let warn = 0;
    for (const id of ids) {
      const f = checkFile(id);
      if (!existsSync(f)) { console.log(`${id}: no saved results — open /lab.html?char=${id} (checks run automatically)`); continue; }
      const r = JSON.parse(readFileSync(f, 'utf8'));
      warn += r.warnings.length;
      console.log(formatCheck(r));
    }
    return o.ci && warn ? 1 : 0;
  }
  let server = null;
  if (!o.url) { process.stdout.write(`${label}: starting a dev server… `); server = await startServer(); o.url = server.url; console.log(o.url); }
  let failed = 0, warnings = 0;
  try {
    for (const id of ids) {
      const r = await runLab({ url: o.url, id, src: o.src || (id.startsWith('_') ? `/characters/${id}/` : null), checks: o.checks, sheet: o.sheet, timeout: o.timeout, chrome });
      if (!r.ok) {
        failed++;
        console.log(`${id}: ✖ the Lab did not finish in ${Math.round(o.timeout / 1000)} s (open ${r.page.replace('still=1&', '')} to see why)`);
        for (const e of r.errors || []) console.log(`  page error: ${String(e).split('\n')[0]}`);
        continue;
      }
      if (o.checks) {
        const res = JSON.parse(readFileSync(checkFile(fileId(id)), 'utf8'));
        warnings += res.warnings.length;
        console.log(formatCheck(res));
      }
      if (o.sheet) console.log(`  contact sheet → ${sheetFile(fileId(id)).slice(ROOT.length + 1)}`);
      console.log(`  (${(r.ms / 1000).toFixed(1)} s)`);
    }
  } finally {
    server?.stop();
  }
  if (failed) return 1;
  return o.ci && warnings ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e.message || e); process.exit(1); });
}
