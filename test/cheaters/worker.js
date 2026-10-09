// One cheater run (kit × opponent) inside a worker thread. The realm is hardened like
// a room worker (§5.2): engine imported first, then the sim guard + frozen intrinsics,
// then the kit (character code). Posts {ok, failures, notes, stats} or never returns
// (the runner's 10 s kill timeout handles hangs).
import { parentPort, workerData } from 'node:worker_threads';

const { file, opp, verbose } = workerData;
if (!verbose) console.log = console.warn = console.info = () => {}; // engine "hook threw" chatter
const t0 = performance.now();
try {
  await import('../../shared/sim/game.js');
  await import('./harness.js');
  const guard = (await import('../../shared/sim/guard.js')).default;
  const { hardenRealm } = await import('../../server/characters.js');
  hardenRealm(guard);
  const kit = (await import(file)).default;
  const { Checker } = await import('./harness.js');
  const ck = new Checker(`${kit.n} ${kit.name} vs ${opp}`);
  parentPort.postMessage({ type: 'start', character: kit.character || kit.name });
  const stats = (await kit.run({ ck, opp })) || {};
  parentPort.postMessage({ type: 'done', ok: ck.failures.length === 0, failures: ck.failures, notes: ck.notes, issues: ck.issues, passes: ck.passes, stats, ms: performance.now() - t0 });
} catch (e) {
  parentPort.postMessage({ type: 'done', ok: false, failures: [`kit threw: ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join('\n')}`], notes: [], passes: 0, stats: {}, ms: performance.now() - t0 });
}
