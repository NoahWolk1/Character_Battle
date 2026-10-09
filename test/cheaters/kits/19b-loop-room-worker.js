// #19b Infinite loop in `tick`, in real room workers: only that room aborts (reason
// 'hung', naming the character) while another room keeps ticking.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerMatch } from '../../../server/room-worker.js';
import { hashFolder, CHAR_DIR } from '../../../server/characters.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'folders');
const src = (folder, dir = CHAR_DIR) => ({ folder, dir, hash: hashFolder(join(dir, folder)) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const job = (code, players, chars) => ({ code, stageId: 'sky-sanctum', chars, players: players.map(([id, charId, cpu]) => ({ id, name: id, charId, cpu })), rules: { stocks: 3, seed: 5, countdown: false } });

export default {
  n: 19.5, name: 'loop-room-worker', character: 'spinlock', invariant: 'only the hung room aborts, naming the character', opponents: ['cpu'],
  async run({ ck }) {
    const A = { aborted: null, snaps: 0 }, B = { aborted: null, snaps: 0, frame: 0 };
    const hooks = (t) => ({ onSnap: (s) => { t.snaps++; t.frame = s.frame; }, onEnd: () => {}, onAbort: (a) => { t.aborted = a; } });
    const mA = new WorkerMatch(job('CHTA', [['a1', 'spinlock', null], ['a2', 'ember', 'hard']], { spinlock: src('spinlock', DIR), ember: src('ember') }), hooks(A));
    const mB = new WorkerMatch(job('CHTB', [['b1', 'volt', 'hard'], ['b2', 'ember', 'hard']], { volt: src('volt'), ember: src('ember') }), hooks(B));
    try {
      await mB.ready;
      await mA.ready.catch(() => {});
      const t0 = performance.now();
      while (!A.aborted && performance.now() - t0 < 4000) await wait(20);
      ck.check(!!A.aborted, 'the hung room never aborted');
      if (A.aborted) {
        ck.check(A.aborted.reason === 'hung', `abort reason ${A.aborted.reason}`);
        ck.check(A.aborted.character === 'spinlock', `abort names ${A.aborted.character}, not spinlock`);
      }
      const before = B.snaps, f0 = B.frame;
      await wait(400);
      ck.check(B.snaps - before >= 8 && B.frame > f0 && !B.aborted, `the healthy room stalled (${B.snaps - before} snaps in 400 ms)`);
      return { abort: A.aborted, roomBSnaps: B.snaps };
    } finally { mA.stop(); mB.stop(); }
  },
};
