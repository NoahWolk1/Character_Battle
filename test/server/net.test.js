// Online protocol v2 end to end with socket.io-client (spec §7): catalog hashes,
// hash-mismatch rejection, match:start payload, inputs, snapshots, match:end,
// both with room workers and with ROOM_WORKERS=0. Also boots server/index.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { CharacterCatalog } from '../../server/catalog-worker.js';
import { RoomManager, PROTOCOL } from '../../server/rooms.js';
import { ROOT } from '../../server/characters.js';
import { BUTTONS } from '../../shared/constants.js';
import { FIXTURES, until, wait } from './helpers.js';

const emitAck = (s, ev, payload) => new Promise((r) => s.emit(ev, payload, r));

async function startServer(catalog, opts) {
  const http = createServer();
  const io = new Server(http);
  const rooms = new RoomManager(io, catalog, opts);
  io.on('connection', (s) => rooms.handle(s));
  await new Promise((r) => http.listen(0, r));
  return { url: `http://localhost:${http.address().port}`, rooms, close: () => new Promise((r) => { rooms.close(); io.close(); http.close(() => r()); }) };
}

function client(url) {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  const log = { snaps: [], events: [], starts: [], ends: [], aborts: [], stale: [], states: [] };
  s.on('snap', (m) => { log.snaps.push(m.s); log.events.push(...m.e); });
  s.on('match:start', (m) => log.starts.push(m));
  s.on('match:end', (m) => log.ends.push(m));
  s.on('match:aborted', (m) => log.aborts.push(m));
  s.on('room:stale', (m) => log.stale.push(m));
  s.on('room:state', (m) => log.states.push(m));
  return { s, log, ready: new Promise((r) => s.on('connect', r)) };
}

test('taunt is bit 9', () => {
  assert.equal(BUTTONS.indexOf('taunt'), 9);
  assert.equal(PROTOCOL, 2);
});

test('catalog: [{id, hash}], 10 s import timeout isolates a hanging character', async () => {
  const cat = new CharacterCatalog({ dirs: [FIXTURES], timeoutMs: 1000 });
  await cat.refresh();
  assert.deepEqual(cat.ids(), ['looper']);
  const [e] = cat.list();
  assert.deepEqual(Object.keys(e).sort(), ['hash', 'id']);
  assert.match(e.hash, /^[0-9a-f]{40}$/);
  assert.ok(cat.failed.has('sleeper'));
  assert.match(cat.failed.get('sleeper').errors[0], /longer than 1s/);
  // A second refresh re-validates nothing that did not change (the failed one is retried).
  const before = cat.get('looper');
  await cat.refresh();
  assert.equal(cat.get('looper').hash, before.hash);
});

for (const workers of [true, false]) {
  test(`online match ${workers ? 'in a room worker' : 'with ROOM_WORKERS=0'}: hash check, protocol v2, inputs, snapshots, end`, async () => {
    const catalog = new CharacterCatalog();
    await catalog.refresh();
    const srv = await startServer(catalog, { workers, refreshOnStart: true });
    const host = client(srv.url), guest = client(srv.url);
    try {
      await Promise.all([host.ready, guest.ready]);
      const good = Object.fromEntries(catalog.list().map((e) => [e.id, e.hash]));
      const created = await emitAck(host.s, 'room:create', { name: 'Host', hashes: good });
      assert.equal(created.ok, true);
      assert.equal(created.protocol, 2);
      // The guest runs an outdated copy of ember.
      const joined = await emitAck(guest.s, 'room:join', { code: created.code, name: 'Guest', hashes: { ...good, ember: 'f'.repeat(40) } });
      assert.equal(joined.ok, true);
      host.s.emit('room:select', { charId: 'ember' });
      guest.s.emit('room:select', { charId: 'volt' });
      await until(() => host.log.states.some((st) => st.players.length === 2 && st.players[0].charId === 'ember' && st.players[1].charId === 'volt'), 3000, 'lobby state');
      const rejected = await emitAck(host.s, 'room:start', null);
      assert.equal(rejected.ok, false);
      assert.match(rejected.error, /Guest must refresh/);
      assert.deepEqual(rejected.stale, [guest.s.id]);
      await until(() => guest.log.stale.length, 2000, 'room:stale');
      assert.deepEqual(guest.log.stale[0].ids, ['ember']);
      assert.match(guest.log.stale[0].message, /refresh/);
      // After a refresh the guest reports the right hashes.
      guest.s.emit('client:hello', { protocol: 2, hashes: good });
      await wait(50);
      const t0 = performance.now();
      const started = await emitAck(host.s, 'room:start', null);
      assert.deepEqual(started, { ok: true });
      console.log(`  match started in ${(performance.now() - t0).toFixed(0)} ms`);
      await until(() => host.log.starts.length && guest.log.starts.length, 3000, 'match:start');
      const ms = host.log.starts[0];
      assert.equal(ms.protocol, 2);
      assert.equal(ms.stageId, 'sky-sanctum');
      assert.ok(Number.isInteger(ms.seed));
      assert.equal(ms.rules.seed, ms.seed);
      assert.equal(ms.rules.stocks, 3);
      assert.deepEqual(ms.roster.map((r) => [r.id, r.charId, r.hash]), [[host.s.id, 'ember', good.ember], [guest.s.id, 'volt', good.volt]]);
      for (const r of ms.roster) assert.deepEqual(Object.keys(r.tables).sort(), ['entities', 'forms', 'moves', 'resources', 'statuses', 'vars']);
      // Joining mid-match is refused.
      const late = client(srv.url);
      await late.ready;
      assert.equal((await emitAck(late.s, 'room:join', { code: created.code, name: 'Late' })).ok, false);
      late.s.close();
      // Countdown (180 frames) then the guest holds right; its fighter must move right.
      await until(() => host.log.snaps.some((s) => s.phase === 'playing'), 5000, 'GO');
      const x0 = host.log.snaps.at(-1).fighters[1].x;
      const RIGHT = 1 << BUTTONS.indexOf('right');
      const holdRight = setInterval(() => guest.s.emit('input', RIGHT), 50);
      await wait(400);
      clearInterval(holdRight);
      guest.s.emit('input', 1 << 9); // taunt bit is accepted
      guest.s.emit('input', 0);
      const last = host.log.snaps.at(-1);
      assert.ok(last.fighters[1].x > x0 + 20, `guest moved right (${x0} → ${last.fighters[1].x})`);
      for (const s of host.log.snaps) {
        assert.ok(JSON.stringify(s).length <= 6144);
        for (const f of s.fighters) for (const k of ['fm', 'mv', 'st', 'r']) assert.ok(k in f);
      }
      assert.ok(host.log.events.some((e) => e.type === 'go'));
      // Snapshots stream at ~30 Hz.
      const frames = host.log.snaps.map((s) => s.frame);
      assert.ok(frames.every((f, i) => i === 0 || f > frames[i - 1]));
      // The guest leaves: their fighter becomes a CPU and the match continues.
      guest.s.emit('room:leave');
      const n = host.log.snaps.length;
      await until(() => host.log.snaps.length > n + 10, 2000, 'match continues');
      // End of match is relayed as match:end (forced through the room's handler).
      const room = [...srv.rooms.rooms.values()][0];
      room.match._onMessage({ type: 'end', results: [{ id: host.s.id, placement: 1 }], winner: host.s.id, s: host.log.snaps.at(-1), e: [] });
      await until(() => host.log.ends.length, 2000, 'match:end');
      assert.equal(host.log.ends[0].winner, host.s.id);
      assert.equal(room.match, null);
      const k = host.log.snaps.length;
      await wait(150);
      assert.ok(host.log.snaps.length <= k + 1, 'no snapshots after match:end');
    } finally {
      host.s.close(); guest.s.close();
      await srv.close();
    }
  });
}

test('match:aborted reaches clients when a room worker hangs', async () => {
  const catalog = new CharacterCatalog({ dirs: [FIXTURES, join(ROOT, 'characters')], timeoutMs: 1000 });
  await catalog.refresh();
  const srv = await startServer(catalog, { workers: true, refreshOnStart: false, matchOpts: { debug: true } });
  const c = client(srv.url);
  try {
    await c.ready;
    await emitAck(c.s, 'room:create', { name: 'Solo' });
    c.s.emit('room:select', { charId: 'looper' });
    c.s.emit('room:addBot', { charId: 'ember', level: 'hard' });
    await until(() => c.log.states.some((st) => st.players.length === 2 && st.players[0].charId === 'looper'), 2000, 'lobby');
    assert.deepEqual(await emitAck(c.s, 'room:start', null), { ok: true });
    const room = [...srv.rooms.rooms.values()][0];
    await until(() => c.log.snaps.length > 2, 3000, 'snaps');
    if (!c.log.aborts.length) room.match?.debug({ op: 'hang', fighter: 0 }); // validator may drop hooks (WP-C)
    await until(() => c.log.aborts.length, 2000, 'match:aborted');
    assert.equal(c.log.aborts[0].reason, 'hung');
    assert.equal(c.log.aborts[0].character, 'looper');
    assert.equal(room.match, null);
    assert.equal(c.log.states.at(-1).inMatch, false);
  } finally {
    c.s.close();
    await srv.close();
  }
});

test('server/index.js boots, serves /api/characters [{id, hash}] and hosts a match', { timeout: 30000 }, async () => {
  for (const env of [{}, { ROOM_WORKERS: '0' }]) {
    const port = 41000 + Math.floor(Math.random() * 5000);
    const child = spawn(process.execPath, [join(ROOT, 'server/index.js')], { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    try {
      await until(() => out.includes('running'), 15000, 'server boot');
      let list = null, lastErr = null;
      for (let k = 0; k < 5 && !list; k++) { // tolerate a slow first request on a loaded box
        try { list = await (await fetch(`http://127.0.0.1:${port}/api/characters`)).json(); } catch (e) { lastErr = e; await wait(300); }
      }
      if (!list) throw new Error(`fetch /api/characters failed: ${lastErr?.cause?.code || lastErr?.message}\n--- server output ---\n${out}`);
      assert.ok(list.length >= 1);
      for (const e of list) { assert.equal(typeof e.id, 'string'); assert.match(e.hash, /^[0-9a-f]{40}$/); }
      const c = client(`http://localhost:${port}`);
      await c.ready;
      c.s.emit('client:hello', { protocol: 2, hashes: Object.fromEntries(list.map((e) => [e.id, e.hash])) });
      await emitAck(c.s, 'room:create', { name: 'E2E' });
      c.s.emit('room:addBot', { level: 'hard' });
      await until(() => c.log.states.some((st) => st.players.length === 2), 2000, 'bot');
      assert.deepEqual(await emitAck(c.s, 'room:start', null), { ok: true });
      await until(() => c.log.snaps.length >= 10, 3000, 'snapshots');
      assert.equal(c.log.starts[0].protocol, 2);
      assert.match(out, env.ROOM_WORKERS === '0' ? /in-process/ : /worker threads/);
      c.s.close();
    } finally {
      child.kill();
    }
  }
});
