// Character catalog (spec §5.3, §7). A worker thread imports and validates every
// character and returns JSON only ({id, hash, ok, name, notes, errors}); the
// Express/Socket.IO process never imports character code.
//
// Main thread:  const catalog = new CharacterCatalog(); await catalog.refresh();
//               catalog.list() -> [{id, hash}]   catalog.get(id) -> entry | undefined
// A character whose import/validation takes longer than 10 s is reported as failed
// and the worker is restarted for the remaining folders.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import { CHAR_DIR, listCharacterFolders, hashFolder, loadError } from './characters.js';

export const CATALOG_TIMEOUT_MS = 10000;

// ── Worker side ─────────────────────────────────────────────────────────────
async function runWorker({ jobs }) {
  // Engine modules first (frozen before any character code runs), then harden the realm.
  const { validateCharacter } = await import('../shared/balance/validate.js');
  await import('../shared/sim/game.js');
  const guard = (await import('../shared/sim/guard.js')).default;
  const { hardenRealm, importCharacter } = await import('./characters.js');
  hardenRealm(guard);
  for (const job of jobs) {
    parentPort.postMessage({ type: 'begin', folder: job.folder });
    const file = join(job.dir, job.folder, 'character.js');
    let out;
    try {
      const hash = hashFolder(join(job.dir, job.folder));
      const mod = await importCharacter(file, hash);
      const v = validateCharacter(mod.default, { expectedId: job.folder });
      const c = v.character;
      out = {
        folder: job.folder, dir: job.dir, hash, ok: !!v.ok, id: c?.id ?? job.folder,
        name: c?.name ?? c?.meta?.name ?? job.folder, notes: json(v.notes || []), errors: json(v.errors || []),
      };
    } catch (e) {
      out = { folder: job.folder, dir: job.dir, hash: null, ok: false, id: job.folder, name: job.folder, notes: [], errors: [loadError(job.folder, e)] };
    }
    parentPort.postMessage({ type: 'result', entry: out });
  }
  parentPort.postMessage({ type: 'done' });
}

function json(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return []; }
}

if (!isMainThread && workerData?.kind === 'catalog') {
  runWorker(workerData).catch((e) => parentPort.postMessage({ type: 'fatal', message: String(e && e.stack || e) }));
}

// ── Main side ───────────────────────────────────────────────────────────────
/**
 * Validates `jobs` ([{folder, dir}]) in worker threads. Resolves to entries in job
 * order. Never rejects; failures and timeouts become `ok: false` entries.
 */
export function scanCharacters(jobs, { timeoutMs = CATALOG_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const results = new Map();
    let pending = jobs.slice();
    const finish = () => resolve(jobs.map((j) => results.get(`${j.dir}|${j.folder}`)));
    const fail = (job, msg) => results.set(`${job.dir}|${job.folder}`, { folder: job.folder, dir: job.dir, hash: null, ok: false, id: job.folder, name: job.folder, notes: [], errors: [msg] });
    const spawn = () => {
      pending = pending.filter((j) => !results.has(`${j.dir}|${j.folder}`));
      if (!pending.length) return finish();
      const batch = pending.slice();
      const w = new Worker(new URL(import.meta.url), { workerData: { kind: 'catalog', jobs: batch } });
      let current = null, timer = null, settled = false;
      const arm = () => { clearTimeout(timer); timer = setTimeout(onTimeout, timeoutMs); };
      const done = (restart) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        w.removeAllListeners();
        w.terminate().catch(() => {});
        if (restart) spawn(); else finish();
      };
      const onTimeout = () => {
        const job = current || batch.find((j) => !results.has(`${j.dir}|${j.folder}`));
        if (job) fail(job, `${job.folder}/character.js took longer than ${timeoutMs / 1000}s to load (infinite loop?)`);
        done(true);
      };
      w.on('message', (m) => {
        if (m.type === 'begin') { current = batch.find((j) => j.folder === m.folder) || null; arm(); }
        else if (m.type === 'result') { results.set(`${m.entry.dir}|${m.entry.folder}`, m.entry); current = null; arm(); }
        else if (m.type === 'done') done(false);
        else if (m.type === 'fatal') { for (const j of batch) if (!results.has(`${j.dir}|${j.folder}`)) fail(j, `catalog worker failed: ${m.message}`); done(false); }
      });
      w.on('error', (e) => {
        const job = current || batch.find((j) => !results.has(`${j.dir}|${j.folder}`));
        if (job) fail(job, loadError(job.folder, e));
        done(true);
      });
      w.on('exit', () => { if (!settled) { const job = current; if (job && !results.has(`${job.dir}|${job.folder}`)) fail(job, `catalog worker exited while loading ${job.folder}`); done(true); } });
      arm();
    };
    spawn();
  });
}

/** The server's view of the roster: id → {id, folder, dir, file, hash, name, ok, notes, errors}. */
export class CharacterCatalog {
  /** @param {{dirs?: string[], timeoutMs?: number}} [opts] dirs are scanned in order; first id wins. */
  constructor({ dirs = [CHAR_DIR], timeoutMs = CATALOG_TIMEOUT_MS } = {}) {
    this.dirs = dirs;
    this.timeoutMs = timeoutMs;
    this.entries = new Map();   // ok entries by id
    this.failed = new Map();    // folder → failed entry
    this.byFolder = new Map();  // `${dir}|${folder}` → last entry (any status), for change detection
    this.inflight = null;
  }

  /** Re-scans; only folders whose hash changed are re-validated. Concurrent calls share one scan. */
  refresh({ log = false } = {}) {
    if (!this.inflight) this.inflight = this._refresh(log).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async _refresh(log) {
    const found = [];
    for (const dir of this.dirs) for (const folder of listCharacterFolders(dir)) {
      let hash = null;
      try { hash = hashFolder(join(dir, folder)); } catch { /* vanished mid-scan */ }
      found.push({ dir, folder, hash });
    }
    const stale = found.filter((j) => this.byFolder.get(`${j.dir}|${j.folder}`)?.hash !== j.hash || !j.hash);
    const fresh = stale.length ? await scanCharacters(stale.map(({ dir, folder }) => ({ dir, folder })), { timeoutMs: this.timeoutMs }) : [];
    for (const e of fresh) this.byFolder.set(`${e.dir}|${e.folder}`, e);
    const keep = new Set(found.map((j) => `${j.dir}|${j.folder}`));
    for (const k of [...this.byFolder.keys()]) if (!keep.has(k)) this.byFolder.delete(k);
    this.entries.clear();
    this.failed.clear();
    for (const j of found) {
      const e = this.byFolder.get(`${j.dir}|${j.folder}`);
      if (!e) continue;
      if (e.ok && !this.entries.has(e.id)) this.entries.set(e.id, { ...e, file: join(e.dir, e.folder, 'character.js') });
      else if (!e.ok) this.failed.set(e.folder, e);
    }
    if (log) {
      for (const e of fresh) {
        if (e.ok) console.log(`  ✔ ${e.name} (${e.folder})${e.notes.length ? ` — ${e.notes.length} auto-balance adjustment(s)` : ''}`);
        else console.warn(`  ✘ ${e.folder} could not be loaded:\n      ${e.errors.join('\n      ')}`);
      }
    }
    return this;
  }

  /** Public list for /api/characters, sorted by id. */
  list() { return [...this.entries.values()].map((e) => ({ id: e.id, hash: e.hash })).sort((a, b) => (a.id < b.id ? -1 : 1)); }
  ids() { return [...this.entries.keys()].sort(); }
  has(id) { return this.entries.has(id); }
  get(id) { return this.entries.get(id); }
  get size() { return this.entries.size; }
}
