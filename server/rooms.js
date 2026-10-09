// Online lobbies (4-letter codes) + match lifecycle. Matches run through
// room-worker.js (a worker thread per match by default; ROOM_WORKERS=0 = in-process).
// This module never imports character code: it only sees the catalog (ids + hashes).
//
// Protocol v2 (spec §7):
//   client → server  client:hello {protocol, hashes: {charId: hash}}   (any time; latest wins)
//                    room:create {name, hashes?} · room:join {code, name, hashes?}
//                    room:select · room:ready · room:addBot · room:removeBot · room:settings
//                    room:start (ack {ok, error?, stale?}) · input <mask> · room:leave
//   server → client  room:state · match:start {protocol: 2, roster: [{id, name, charId,
//                    index, cpu, hash, tables}], seed, stageId, rules} · snap {s, e}
//                    match:end {results, winner} · match:aborted {reason, character, message}
//                    (reason: hung · invalid · stale · error · crashed)
//                    room:stale {ids, message}   (your character files are out of date)
// Hash check: at room:start every human that reported hashes must match the server's
// hash for every character in the match, otherwise the start is rejected and the
// stale clients get room:stale ("refresh to update characters"). Clients that never
// reported hashes (older clients) are allowed.
import { randomInt } from 'node:crypto';
import { MATCH, BUTTONS } from '../shared/constants.js';
import { createMatch, useWorkers, STAGE_IDS } from './room-worker.js';

export const PROTOCOL = 2;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_LEVELS = ['easy', 'normal', 'hard'];
const INPUT_MASK = (1 << BUTTONS.length) - 1;
const STALE_MSG = 'Characters changed on the server — refresh the page to update characters.';

function makeCode(existing) {
  let code;
  do code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
  while (existing.has(code));
  return code;
}

const cleanName = (n) => String(n || 'Player').replace(/[^\w \-.!?']/g, '').trim().slice(0, 14) || 'Player';

export function decodeInput(mask) {
  const o = {};
  BUTTONS.forEach((b, i) => { o[b] = !!(mask & (1 << i)); });
  return o;
}

/** Sanitizes a client-reported {charId: hash} map (null when absent/invalid). */
export function cleanHashes(h) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(h)) {
    if (n >= 256) break;
    if (typeof k === 'string' && k.length <= 32 && typeof v === 'string' && /^[0-9a-f]{40}$/.test(v)) { out[k] = v; n++; }
  }
  return out;
}

export class RoomManager {
  /**
   * @param {import('socket.io').Server} io
   * @param {{has(id), get(id), ids(), refresh?()}} catalog CharacterCatalog (catalog-worker.js)
   * @param {{workers?: boolean, refreshOnStart?: boolean, matchOpts?: object}} [opts]
   */
  constructor(io, catalog, { workers = useWorkers(), refreshOnStart = process.env.NODE_ENV !== 'production', matchOpts = {} } = {}) {
    this.io = io;
    this.catalog = catalog;
    this.workers = workers;
    this.refreshOnStart = refreshOnStart;
    this.matchOpts = matchOpts;
    this.rooms = new Map();
  }

  handle(socket) {
    const ack = (cb, data) => typeof cb === 'function' && cb(data);
    const firstChar = () => this.catalog.ids()[0];
    const hello = (h) => { const c = cleanHashes(h); if (c) socket.data.hashes = c; };

    socket.on('client:hello', ({ hashes } = {}) => hello(hashes));

    socket.on('room:create', ({ name, hashes } = {}, cb) => {
      hello(hashes);
      this.leave(socket);
      const code = makeCode(this.rooms);
      const room = new Room(this, code);
      this.rooms.set(code, room);
      room.addPlayer(socket, cleanName(name), firstChar());
      ack(cb, { ok: true, code, protocol: PROTOCOL });
    });

    socket.on('room:join', ({ code, name, hashes } = {}, cb) => {
      hello(hashes);
      const room = this.rooms.get(String(code || '').toUpperCase().trim());
      if (!room) return ack(cb, { ok: false, error: 'Room not found.' });
      if (room.size >= MATCH.maxPlayers) return ack(cb, { ok: false, error: 'Room is full.' });
      if (room.busy) return ack(cb, { ok: false, error: 'Match in progress — try again in a moment.' });
      this.leave(socket);
      room.addPlayer(socket, cleanName(name), firstChar());
      ack(cb, { ok: true, code: room.code, protocol: PROTOCOL });
    });

    socket.on('room:leave', () => this.leave(socket));
    socket.on('room:select', ({ charId } = {}) => this.roomOf(socket)?.select(socket.id, charId));
    socket.on('room:ready', ({ ready } = {}) => this.roomOf(socket)?.setReady(socket.id, !!ready));
    socket.on('room:addBot', ({ charId, level } = {}) => this.roomOf(socket)?.addBot(socket.id, charId, level));
    socket.on('room:removeBot', ({ id } = {}) => this.roomOf(socket)?.removeBot(socket.id, id));
    socket.on('room:settings', (s = {}) => this.roomOf(socket)?.settings(socket.id, s || {}));
    socket.on('room:start', async (_, cb) => {
      const r = this.roomOf(socket);
      if (!r) return ack(cb, { ok: false, error: 'Not in a room.' });
      try { ack(cb, await r.start(socket.id)); } catch (e) { ack(cb, { ok: false, error: `Could not start: ${e && e.message}` }); }
    });
    socket.on('input', (mask) => this.roomOf(socket)?.input(socket.id, mask));
    socket.on('disconnect', () => this.leave(socket));
  }

  roomOf(socket) { return socket.data.room ? this.rooms.get(socket.data.room) : null; }

  leave(socket) {
    const room = this.roomOf(socket);
    if (!room) return;
    room.removePlayer(socket);
    if (room.humanCount === 0) { room.stop(); this.rooms.delete(room.code); }
  }

  /** Stops every room (server shutdown / tests). */
  close() { for (const r of this.rooms.values()) r.stop(); this.rooms.clear(); }
}

class Room {
  constructor(manager, code) {
    this.manager = manager;
    this.io = manager.io;
    this.code = code;
    this.players = []; // { id, name, charId, ready, bot?: level }
    this.hostId = null;
    this.stocks = MATCH.stocks;
    this.stageId = STAGE_IDS[0];
    this.match = null;     // WorkerMatch | InProcessMatch while starting/playing
    this.starting = false;
    this.botSeq = 1;
  }

  get catalog() { return this.manager.catalog; }
  get size() { return this.players.length; }
  get humanCount() { return this.players.filter((p) => !p.bot).length; }
  get busy() { return this.starting || !!this.match; }

  addPlayer(socket, name, charId) {
    socket.join(this.code);
    socket.data.room = this.code;
    this.players.push({ id: socket.id, name, charId, ready: false });
    if (!this.hostId) this.hostId = socket.id;
    this.broadcast();
  }

  removePlayer(socket) {
    socket.leave(this.code);
    socket.data.room = null;
    this.players = this.players.filter((p) => p.id !== socket.id);
    this.match?.drop(socket.id); // the fighter becomes a CPU; the match continues
    if (this.hostId === socket.id) this.hostId = this.players.find((p) => !p.bot)?.id || null;
    this.broadcast();
  }

  select(id, charId) {
    const p = this.players.find((x) => x.id === id);
    if (!p || this.busy || !this.catalog.has(charId)) return;
    p.charId = charId;
    this.broadcast();
  }

  setReady(id, ready) {
    const p = this.players.find((x) => x.id === id);
    if (p) { p.ready = ready; this.broadcast(); }
  }

  addBot(id, charId, level) {
    if (id !== this.hostId || this.busy || this.size >= MATCH.maxPlayers) return;
    const chars = this.catalog.ids();
    if (!chars.length) return;
    const c = this.catalog.has(charId) ? charId : chars[randomInt(chars.length)];
    const lvl = BOT_LEVELS.includes(level) ? level : 'normal';
    this.players.push({ id: `bot-${this.botSeq++}`, name: `CPU ${lvl}`, charId: c, ready: true, bot: lvl });
    this.broadcast();
  }

  removeBot(id, botId) {
    if (id !== this.hostId || this.busy) return;
    this.players = this.players.filter((p) => !(p.bot && p.id === botId));
    this.broadcast();
  }

  settings(id, { stocks, stageId }) {
    if (id !== this.hostId || this.busy) return;
    if (Number.isInteger(stocks)) this.stocks = Math.max(1, Math.min(5, stocks));
    if (STAGE_IDS.includes(stageId)) this.stageId = stageId;
    this.broadcast();
  }

  state() {
    return { code: this.code, hostId: this.hostId, stocks: this.stocks, stageId: this.stageId, inMatch: this.busy, players: this.players };
  }

  broadcast() { this.io.to(this.code).emit('room:state', this.state()); }

  socketOf(id) { return this.io.sockets?.sockets?.get(id) || null; }

  /** Humans whose reported hashes disagree with the server for any character in the match. */
  staleClients(charIds) {
    const stale = [];
    for (const p of this.players) {
      if (p.bot) continue;
      const reported = this.socketOf(p.id)?.data?.hashes;
      if (!reported) continue; // older client: no hashes reported
      const bad = charIds.filter((c) => reported[c] !== this.catalog.get(c)?.hash);
      if (bad.length) stale.push({ player: p, ids: bad });
    }
    return stale;
  }

  async start(id) {
    if (id !== this.hostId) return { ok: false, error: 'Only the host can start.' };
    if (this.busy) return { ok: false, error: 'Already playing.' };
    if (this.size < 2) return { ok: false, error: 'Need at least 2 fighters — add a CPU!' };
    this.starting = true;
    try {
      if (this.manager.refreshOnStart && this.catalog.refresh) await this.catalog.refresh();
      if (!this.starting) return { ok: false, error: 'Room closed.' };
      const fallback = this.catalog.ids()[0];
      if (!fallback) return { ok: false, error: 'No characters are available on the server.' };
      for (const p of this.players) if (!this.catalog.has(p.charId)) p.charId = fallback;
      const charIds = [...new Set(this.players.map((p) => p.charId))];
      const stale = this.staleClients(charIds);
      if (stale.length) {
        for (const s of stale) this.socketOf(s.player.id)?.emit('room:stale', { ids: s.ids, message: STALE_MSG });
        return { ok: false, stale: stale.map((s) => s.player.id), error: `${stale.map((s) => s.player.name).join(', ')} must refresh — their character files are out of date.` };
      }
      const chars = {};
      for (const c of charIds) { const e = this.catalog.get(c); chars[c] = { folder: e.folder, dir: e.dir, hash: e.hash }; }
      const job = {
        code: this.code,
        players: this.players.map((p) => ({ id: p.id, name: p.name, charId: p.charId, cpu: p.bot || null })),
        chars,
        rules: { stocks: this.stocks, seed: randomInt(2 ** 31) },
        stageId: this.stageId,
      };
      const match = createMatch(job, {
        onSnap: (s, e) => this.io.to(this.code).volatile.emit('snap', { s, e }),
        onEnd: (data) => this.finish(match, data),
        onAbort: (info) => this.aborted(match, info),
      }, { workers: this.manager.workers, ...this.manager.matchOpts });
      this.match = match;
      this.starting = false;
      let info;
      try { info = await match.ready; } catch (e) { return { ok: false, error: e.message || 'Match failed to start.' }; }
      if (this.match !== match) return { ok: false, error: 'Room closed.' };
      const roster = info.roster.map((r) => ({ ...r, hash: chars[r.charId]?.hash ?? null }));
      this.io.to(this.code).emit('match:start', { protocol: PROTOCOL, roster, seed: info.seed, stageId: info.stageId, rules: info.rules });
      this.broadcast();
      return { ok: true };
    } finally {
      this.starting = false;
    }
  }

  input(id, mask) {
    if (this.match && Number.isInteger(mask)) this.match.input(id, mask & INPUT_MASK);
  }

  finish(match, { results, winner }) {
    if (this.match !== match) return;
    this.io.to(this.code).emit('match:end', { results, winner });
    match.stop();
    this.match = null;
    for (const p of this.players) if (!p.bot) p.ready = false;
    this.broadcast();
  }

  aborted(match, info) {
    if (this.match !== match) return;
    match.stop();
    this.match = null;
    console.warn(`room ${this.code}: match aborted (${info.reason}${info.character ? `, ${info.character}` : ''}): ${info.message}`);
    this.io.to(this.code).emit('match:aborted', info);
    for (const p of this.players) if (!p.bot) p.ready = false;
    this.broadcast();
  }

  stop() {
    this.starting = false;
    this.match?.stop();
    this.match = null;
  }
}
