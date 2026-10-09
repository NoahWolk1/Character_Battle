// Match hosting (spec §5.2, §7). One match = one MatchHost: it builds the Game, runs
// the 60 Hz loop and reports snapshots/events. Two ways to run it:
//
//   WorkerMatch     (default) the host runs in its own worker_threads Worker. Its module
//                   graph is only shared/ + characters/. Before any character import the
//                   realm is hardened (guard.install, then freeze Math/JSON/Object.prototype…).
//                   Watchdog: the worker bumps a heartbeat in a SharedArrayBuffer every loop
//                   pass and records the index of the fighter whose code is running. If the
//                   heartbeat stalls for WATCHDOG_MS (500 ms; LOAD_TIMEOUT_MS while loading)
//                   the main thread terminates the worker and reports
//                   {reason:'hung', character}. Other rooms are unaffected.
//   InProcessMatch  ROOM_WORKERS=0: same host in the main process (debugging only — no
//                   watchdog, and character code is imported into the server process).
//
// Both expose: ready (Promise<{roster, rules, seed, stageId}>), input(id, mask),
// drop(id), stop(), and call handlers {onSnap(s, e), onEnd({results, winner}),
// onAbort({reason, character, message})}. onAbort/onEnd fire at most once in total.
//
// IPC (§7): main → worker {type:'input', id, mask} | {type:'drop', id} | {type:'stop'}
//           worker → main {type:'ready', …} | {type:'snap', s, e} | {type:'end', results,
//           winner, s, e} | {type:'fatal', reason, character, message}
//
// job = {code, players: [{id, name, charId, cpu}], chars: {charId: {folder, dir, hash}},
//        rules: {stocks, seed}, stageId}
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { CATALOG_TIMEOUT_MS } from './catalog-worker.js';

export const WATCHDOG_MS = 500;
export const WATCHDOG_POLL_MS = 100;
export const LOAD_TIMEOUT_MS = CATALOG_TIMEOUT_MS;

// Heartbeat slots (Int32Array over a SharedArrayBuffer).
const HB_BEAT = 0;    // increments every loop pass / load step
const HB_WHO = 1;     // 1 + index of the fighter whose code is running, 0 = engine
const HB_PHASE = 2;   // 0 loading, 1 running
const HB_LOADING = 3; // 1 + index into job.players of the character being imported

/** Stage geometry by id (shared/stages/index.js registry; unknown ids → default). */
async function stageById(id) {
  return (await import('../shared/stages/index.js')).getStage(id);
}
export { STAGE_IDS } from '../shared/stages/index.js';

// ── Match host (worker or in-process) ───────────────────────────────────────
export class MatchHost {
  /**
   * @param {object} o {Game, constants, stage, job, characters: Map charId → validated, post(msg), beat?()}
   */
  constructor({ Game, constants, stage, job, characters, post, beat }) {
    this.C = constants;
    this.post = post;
    this.beat = beat || (() => {});
    this.timer = null;
    this.stopped = false;
    this.game = new Game({
      stage,
      rules: { ...job.rules },
      players: job.players.map((p) => ({ id: p.id, name: p.name, character: characters.get(p.charId), cpu: p.cpu || null })),
    });
  }

  info() {
    const g = this.game;
    return { roster: g.roster(), rules: { ...g.rules }, seed: g.rules.seed, stageId: g.stage.id };
  }

  input(id, mask) {
    if (!Number.isInteger(mask)) return;
    const { BUTTONS } = this.C;
    const o = {};
    BUTTONS.forEach((b, i) => { o[b] = !!(mask & (1 << i)); });
    this.game.setInput(id, o);
  }

  /** A human left mid-match: hand the fighter to a CPU so the match can continue. */
  drop(id) {
    const f = this.game.fighter(id);
    if (f && !f.eliminated && !f.cpu) { f.cpu = 'normal'; f.brain = { level: 'normal', timer: 0, held: {} }; f.name += ' (CPU)'; }
  }

  start(now) {
    const { TICK_RATE, SNAPSHOT_EVERY, MATCH } = this.C;
    const stepMs = 1000 / TICK_RATE;
    let next = now();
    let endedAt = null;
    const tick = () => {
      if (this.stopped) return;
      this.beat();
      const g = this.game;
      const t = now();
      let steps = 0;
      while (t >= next && steps < 5) {
        g.step();
        this.beat();
        next += stepMs;
        steps++;
        if (g.frame % SNAPSHOT_EVERY === 0) this.post({ type: 'snap', s: g.snapshot(), e: g.drainEvents() });
      }
      if (t - next > 250) next = t; // fell way behind (hiccup): don't spiral
      if (g.phase === 'ended') {
        endedAt ??= g.frame;
        if (g.frame - endedAt > MATCH.endDelay) return this.finish();
      }
      this.timer = setTimeout(tick, Math.max(0, next - now()));
    };
    tick();
  }

  finish() {
    const g = this.game;
    const results = g.fighters
      .map((f) => ({ id: f.id, name: f.name, charId: f.charId, placement: f.placement || 1, kos: f.kos, falls: f.falls, damageDealt: Math.round(f.damageDealt) }))
      .sort((a, b) => a.placement - b.placement);
    this.stop();
    this.post({ type: 'end', results, winner: g.winner, s: g.snapshot(), e: g.drainEvents() });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

// ── Worker side ─────────────────────────────────────────────────────────────
async function runWorker({ job, sab, debug }) {
  const hb = new Int32Array(sab);
  const beat = () => Atomics.add(hb, HB_BEAT, 1);
  // 1. Engine first (its rule tables freeze themselves on load), then harden the realm.
  const { Game } = await import('../shared/sim/game.js');
  const constants = await import('../shared/constants.js');
  await import('../shared/balance/validate.js');
  const guard = (await import('../shared/sim/guard.js')).default;
  const { hardenRealm, loadCharacter, hashFolder } = await import('./characters.js');
  const { join } = await import('node:path');
  const stage = await stageById(job.stageId);
  // Record which fighter's code is running (the watchdog names it on a hang).
  const enter = guard.enter, exit = guard.exit;
  guard.enter = (idx) => { enter(idx); Atomics.store(hb, HB_WHO, guard.current() + 1); };
  guard.exit = () => { exit(); Atomics.store(hb, HB_WHO, guard.current() + 1); };
  hardenRealm(guard);
  beat();

  // 2. Characters (each import + validation is bounded by LOAD_TIMEOUT_MS).
  const characters = new Map();
  for (let i = 0; i < job.players.length; i++) {
    const charId = job.players[i].charId;
    if (characters.has(charId)) continue;
    const src = job.chars[charId];
    Atomics.store(hb, HB_LOADING, i + 1);
    beat();
    const r = src ? await loadCharacter(src.folder, { dir: src.dir, hash: src.hash }) : { ok: false, errors: [`unknown character ${charId}`] };
    if (!r.ok) return parentPort.postMessage({ type: 'fatal', reason: 'invalid', character: charId, message: String(r.errors?.[0] ?? 'invalid character') });
    // Files edited between the catalog scan and this import → clients would desync.
    let now = null;
    try { now = hashFolder(join(src.dir, src.folder)); } catch { /* vanished */ }
    if (now !== src.hash) return parentPort.postMessage({ type: 'fatal', reason: 'stale', character: charId, message: `${charId} changed on the server — refresh to update characters` });
    characters.set(charId, r.character);
  }
  Atomics.store(hb, HB_LOADING, 0);

  // 3. Match.
  const host = new MatchHost({ Game, constants, stage, job, characters, beat, post: (m) => parentPort.postMessage(m) });
  parentPort.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'input') host.input(m.id, m.mask);
    else if (m.type === 'drop') host.drop(m.id);
    else if (m.type === 'stop') { host.stop(); parentPort.close(); }
    // Tests only (WorkerMatch {debug: true}): simulate fighter `idx`'s hook never returning.
    else if (debug && m.type === 'debug' && m.op === 'hang') { guard.enter(m.fighter); for (;;) { /* hang */ } }
  });
  parentPort.postMessage({ type: 'ready', ...host.info() });
  Atomics.store(hb, HB_PHASE, 1);
  beat();
  host.start(guard.clock);
}

if (!isMainThread && workerData?.kind === 'room') {
  runWorker(workerData).catch((e) => parentPort.postMessage({ type: 'fatal', reason: 'error', character: null, message: String((e && e.message) || e) }));
}

// ── Main side ───────────────────────────────────────────────────────────────
class BaseMatch {
  constructor(job, handlers) {
    this.job = job;
    this.h = handlers || {};
    this.closed = false;
    this.ready = new Promise((res, rej) => { this._res = res; this._rej = rej; });
    this.ready.catch(() => {}); // callers may only listen to onAbort
    this.started = false;
  }

  _onMessage(m) {
    if (this.closed || !m) return;
    if (m.type === 'ready') { this.started = true; this._res({ roster: m.roster, rules: m.rules, seed: m.seed, stageId: m.stageId }); }
    else if (m.type === 'snap') this.h.onSnap?.(m.s, m.e);
    else if (m.type === 'end') {
      this.h.onSnap?.(m.s, m.e);
      this._close();
      this.h.onEnd?.({ results: m.results, winner: m.winner });
    } else if (m.type === 'fatal') this._abort({ reason: m.reason, character: m.character ?? null, message: m.message });
  }

  _abort(info) {
    if (this.closed) return;
    this._close();
    const data = { reason: info.reason, character: info.character ?? null, message: info.message || describe(info) };
    if (!this.started) this._rej(Object.assign(new Error(data.message), data));
    this.h.onAbort?.(data);
  }

  _close() { this.closed = true; }
  stop() { this._close(); }
}

function describe({ reason, character }) {
  if (reason === 'hung') return character ? `${character}'s code froze the match` : 'The match froze';
  if (reason === 'crashed') return 'The match crashed';
  return 'The match was aborted';
}

export class WorkerMatch extends BaseMatch {
  constructor(job, handlers, { watchdogMs = WATCHDOG_MS, loadTimeoutMs = LOAD_TIMEOUT_MS, debug = false } = {}) {
    super(job, handlers);
    this.sab = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
    this.hb = new Int32Array(this.sab);
    this.worker = new Worker(new URL(import.meta.url), { workerData: { kind: 'room', job, sab: this.sab, debug: !!debug } });
    this.worker.on('message', (m) => this._onMessage(m));
    this.worker.on('error', (e) => this._abort({ reason: 'error', character: this._culprit(), message: `match error: ${e && e.message}` }));
    this.worker.on('exit', () => this._abort({ reason: 'crashed', character: null }));
    // Watchdog
    let last = Atomics.load(this.hb, HB_BEAT), since = performance.now();
    this.watchdog = setInterval(() => {
      const beat = Atomics.load(this.hb, HB_BEAT), t = performance.now();
      if (beat !== last) { last = beat; since = t; return; }
      const limit = Atomics.load(this.hb, HB_PHASE) === 1 ? watchdogMs : loadTimeoutMs;
      if (t - since >= limit) this._abort({ reason: 'hung', character: this._culprit() });
    }, Math.min(WATCHDOG_POLL_MS, watchdogMs / 2));
    this.watchdog.unref?.();
  }

  /** charId whose code was running (or loading) when the worker stalled, else null. */
  _culprit() {
    const players = this.job.players;
    if (Atomics.load(this.hb, HB_PHASE) === 0) {
      const l = Atomics.load(this.hb, HB_LOADING);
      return l > 0 ? players[l - 1]?.charId ?? null : null;
    }
    const w = Atomics.load(this.hb, HB_WHO);
    return w > 0 ? players[w - 1]?.charId ?? null : null;
  }

  input(id, mask) { if (!this.closed) this.worker.postMessage({ type: 'input', id, mask }); }
  debug(msg) { if (!this.closed) this.worker.postMessage({ type: 'debug', ...msg }); }
  drop(id) { if (!this.closed) this.worker.postMessage({ type: 'drop', id }); }

  _close() {
    if (this.closed) return;
    super._close();
    clearInterval(this.watchdog);
    this.worker.removeAllListeners('message');
    this.worker.removeAllListeners('exit');
    this.worker.on('error', () => {});
    this.worker.terminate().catch(() => {});
  }
}

export class InProcessMatch extends BaseMatch {
  constructor(job, handlers) {
    super(job, handlers);
    this.host = null;
    this._load().catch((e) => this._abort({ reason: 'error', character: null, message: String((e && e.message) || e) }));
  }

  async _load() {
    const { Game } = await import('../shared/sim/game.js');
    const constants = await import('../shared/constants.js');
    const { loadCharacter } = await import('./characters.js');
    const stage = await stageById(this.job.stageId);
    const characters = new Map();
    for (const p of this.job.players) {
      if (characters.has(p.charId)) continue;
      const src = this.job.chars[p.charId];
      const r = src ? await loadCharacter(src.folder, { dir: src.dir, hash: src.hash }) : { ok: false, errors: [`unknown character ${p.charId}`] };
      if (!r.ok) return this._abort({ reason: 'invalid', character: p.charId, message: String(r.errors?.[0] ?? 'invalid character') });
      characters.set(p.charId, r.character);
    }
    if (this.closed) return;
    // Deliver asynchronously, like a worker would (callers attach after construction).
    this.host = new MatchHost({ Game, constants, stage, job: this.job, characters, post: (m) => queueMicrotask(() => this._onMessage(m)) });
    this._onMessage({ type: 'ready', ...this.host.info() });
    this.host.start(() => performance.now());
  }

  input(id, mask) { if (!this.closed) this.host?.input(id, mask); }
  drop(id) { if (!this.closed) this.host?.drop(id); }

  _close() {
    if (this.closed) return;
    super._close();
    this.host?.stop();
  }
}

/** ROOM_WORKERS=0 → in-process; anything else (default) → worker threads. */
export function useWorkers(env = process.env) { return env.ROOM_WORKERS !== '0'; }

export function createMatch(job, handlers, { workers = useWorkers(), ...opts } = {}) {
  return workers ? new WorkerMatch(job, handlers, opts) : new InProcessMatch(job, handlers);
}
