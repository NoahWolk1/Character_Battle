// Room workers (spec §5.2, §9 WP-J): a character that hangs aborts only its own
// room within 1 s while another room keeps ticking; load-time hangs time out;
// ROOM_WORKERS=0 runs the same host in-process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerMatch, InProcessMatch, createMatch, useWorkers, MatchHost } from '../../server/room-worker.js';
import { validateCharacter } from '../../shared/balance/validate.js';
import { charSrc, FIXTURES, until, wait } from './helpers.js';

const job = (code, players, chars, rules = {}) => ({
  code, stageId: 'sky-sanctum', chars,
  players: players.map(([id, charId, cpu = 'hard']) => ({ id, name: id, charId, cpu })),
  rules: { stocks: 3, seed: 11, countdown: false, ...rules },
});

function track(name) {
  const t = { snaps: 0, lastFrame: 0, aborted: null, ended: null, abortAt: 0 };
  t.handlers = {
    onSnap: (s) => { t.snaps++; t.lastFrame = s.frame; },
    onEnd: (d) => { t.ended = d; },
    onAbort: (a) => { t.aborted = a; t.abortAt = performance.now(); },
  };
  t.name = name;
  return t;
}

test('hung character aborts only its own room within 1 s', async () => {
  const looper = (await import('./fixtures/looper/character.js')).default;
  const hooksRun = typeof validateCharacter(looper, { expectedId: 'looper' }).character?.behavior?.tick === 'function';
  const a = track('A'), b = track('B');
  const mA = new WorkerMatch(job('AAAA', [['a1', 'looper'], ['a2', 'ember']], { looper: charSrc('looper', FIXTURES), ember: charSrc('ember') }), a.handlers, { debug: true });
  const mB = new WorkerMatch(job('BBBB', [['b1', 'volt'], ['b2', 'ember']], { volt: charSrc('volt'), ember: charSrc('ember') }), b.handlers);
  try {
    await mB.ready;
    let hangAt;
    if (hooksRun) {
      // The real thing: looper's tick hook spins forever from the first frame.
      await mA.ready.catch(() => {});
      hangAt = performance.now();
    } else {
      // Validator does not keep behavior hooks yet (WP-C): simulate fighter 0's hook hanging.
      await mA.ready;
      await until(() => a.snaps > 3, 3000, 'room A snapshots');
      hangAt = performance.now();
      mA.debug({ op: 'hang', fighter: 0 });
    }
    console.log(`  hang source: ${hooksRun ? 'looper behavior.tick' : 'debug hang in fighter 0 (validator drops hooks)'}`);
    await until(() => a.aborted, 3000, 'room A abort');
    const ms = a.abortAt - hangAt;
    console.log(`  room A aborted after ${ms.toFixed(0)} ms: ${JSON.stringify(a.aborted)}`);
    assert.ok(ms <= 1000, `abort took ${ms} ms`);
    assert.equal(a.aborted.reason, 'hung');
    assert.equal(a.aborted.character, 'looper');
    assert.match(a.aborted.message, /looper/);
    // Room B is unaffected and keeps ticking.
    const before = b.snaps, frame = b.lastFrame;
    await wait(500);
    assert.ok(b.snaps - before >= 10, `room B sent ${b.snaps - before} snaps in 500 ms`);
    assert.ok(b.lastFrame > frame);
    assert.equal(b.aborted, null);
  } finally {
    mA.stop(); mB.stop();
  }
});

test('hang while importing a character times out (load watchdog)', async () => {
  const t = track('L');
  const m = new WorkerMatch(job('LOAD', [['x', 'sleeper'], ['y', 'ember']], { sleeper: charSrc('sleeper', FIXTURES), ember: charSrc('ember') }), t.handlers, { loadTimeoutMs: 800 });
  const t0 = performance.now();
  await assert.rejects(m.ready, (e) => e.reason === 'hung' && e.character === 'sleeper');
  assert.ok(performance.now() - t0 < 3000);
  assert.equal(t.aborted.character, 'sleeper');
  m.stop();
});

test('hash changed between scan and room start → stale abort', async () => {
  const t = track('S');
  const src = { ...charSrc('ember'), hash: '0'.repeat(40) };
  const m = new WorkerMatch(job('STAL', [['x', 'ember'], ['y', 'ember']], { ember: src }), t.handlers);
  await assert.rejects(m.ready, (e) => e.reason === 'stale' && /refresh/.test(e.message));
  m.stop();
});

test('ROOM_WORKERS=0 selects the in-process host and it runs a match', async () => {
  assert.equal(useWorkers({ ROOM_WORKERS: '0' }), false);
  assert.equal(useWorkers({}), true);
  const t = track('I');
  const m = createMatch(job('INPR', [['h', 'ember', null], ['c', 'volt']], { ember: charSrc('ember'), volt: charSrc('volt') }), t.handlers, { workers: false });
  assert.ok(m instanceof InProcessMatch);
  try {
    const info = await m.ready;
    assert.equal(info.stageId, 'sky-sanctum');
    assert.equal(info.seed, 11);
    assert.equal(info.roster.length, 2);
    assert.ok(info.roster[0].tables.moves.length >= 16);
    m.input('h', 1 << 1); // hold right
    await until(() => t.snaps >= 15, 3000, 'in-process snapshots');
    m.drop('h');
    assert.equal(m.host.game.fighter('h').cpu, 'normal');
  } finally { m.stop(); }
  const n = t.snaps;
  await wait(100);
  assert.equal(t.snaps, n, 'stopped host sends nothing');
});

test('MatchHost runs a match to the end and reports results', async () => {
  const { Game } = await import('../../shared/sim/game.js');
  const constants = await import('../../shared/constants.js');
  const stage = (await import('../../shared/stages/sky-sanctum.js')).default;
  const { loadCharacter } = await import('../../server/characters.js');
  const characters = new Map([['ember', (await loadCharacter('ember')).character], ['volt', (await loadCharacter('volt')).character]]);
  const msgs = [];
  let clock = 0;
  const done = new Promise((resolve) => {
    const host = new MatchHost({
      Game, constants, stage, characters,
      job: job('ENDS', [['p1', 'ember'], ['p2', 'volt']], {}, { stocks: 1 }),
      post: (m) => { msgs.push(m); if (m.type === 'end') resolve(m); },
    });
    host.start(() => (clock += 1000 / 12)); // fast clock: 5 frames per loop pass
  });
  let timer;
  const t0 = performance.now();
  const end = await Promise.race([done, new Promise((r) => { timer = setTimeout(() => r(null), 60000); })]);
  clearTimeout(timer);
  console.log(`  1-stock CPU match ended in ${((performance.now() - t0) / 1000).toFixed(1)} s wall (fast clock)`);
  assert.ok(end, 'match ended');
  assert.equal(end.results.length, 2);
  assert.equal(end.results[0].placement, 1);
  assert.ok(end.winner === 'p1' || end.winner === 'p2');
  assert.ok(msgs.some((m) => m.type === 'snap'));
  assert.equal(msgs.filter((m) => m.type === 'end').length, 1);
});
