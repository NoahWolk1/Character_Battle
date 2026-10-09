// The §2 examples (scripts, entities, forms) run inside a real room worker: hardened
// realm (frozen intrinsics, guard installed), validate → IR → Game, snapshots out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { WorkerMatch } from '../../server/room-worker.js';
import { charSrc, until, wait } from '../server/helpers.js';
import { ROOT } from './helpers.js';
import { decodeEntity } from '../../shared/sim/snapshot.js';

const FIX = join(ROOT, 'test', 'fixtures');

test('v2 examples play a hard-CPU match in a room worker', async () => {
  const chars = { nimbus: charSrc('nimbus', FIX), gertie: charSrc('gertie', FIX), gloop: charSrc('gloop', FIX), ember: charSrc('ember') };
  const t = { snaps: 0, maxBytes: 0, events: {}, aborted: null, entities: 0, last: null };
  const m = new WorkerMatch({
    code: 'V2V2', stageId: 'sky-sanctum', chars,
    players: ['nimbus', 'gertie', 'gloop', 'ember'].map((c, i) => ({ id: `p${i}`, name: c, charId: c, cpu: 'hard' })),
    rules: { stocks: 3, seed: 4, countdown: false },
  }, {
    onSnap: (s, e) => {
      t.snaps++; t.last = s;
      t.maxBytes = Math.max(t.maxBytes, JSON.stringify(s).length);
      t.entities = Math.max(t.entities, (s.entities || []).length);
      for (const ent of s.entities || []) { const d = decodeEntity(ent); assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y)); }
      for (const ev of e || []) t.events[ev.type] = (t.events[ev.type] || 0) + 1;
    },
    onEnd: () => {},
    onAbort: (a) => { t.aborted = a; },
  });
  try {
    const info = await m.ready;
    assert.equal(info.roster.length, 4);
    for (const r of info.roster) assert.ok(r.tables && r.tables.moves.length, `${r.charId} tables`);
    await until(() => t.snaps >= 150 || t.aborted, 15000, 'snapshots');
    await wait(50);
    assert.equal(t.aborted, null, JSON.stringify(t.aborted));
    assert.ok(t.events.hit > 0, `no hits: ${JSON.stringify(t.events)}`);
    assert.ok(t.maxBytes <= 6144, `snapshot ${t.maxBytes} B`);
    for (const f of t.last.fighters) for (const k of ['x', 'y', 'percent']) assert.ok(Number.isFinite(f[k]), `${f.id}.${k}`);
  } finally {
    m.stop();
  }
});
