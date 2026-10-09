// HTTP + WebSocket server. Serves the client and hosts authoritative online matches.
//
// Trust boundary (spec §5): this process never imports character code. The catalog
// worker validates characters and returns JSON (ids, hashes, notes); each match runs
// in its own room worker with a 500 ms watchdog (server/room-worker.js).
//   ROOM_WORKERS=0   run matches in-process instead (debugging only: no watchdog, and
//                    character code then loads into this process)
//   NODE_ENV=production   /api/characters serves the boot-time catalog; otherwise it
//                    re-scans on every request (only changed folders are re-validated)
//   DEV_ROUTES=1     mount server/dev-routes.js (always on outside production)
// Engine modules load first so their rule tables are frozen before anything else runs.
import '../shared/constants.js';
import '../shared/balance/rules.js';
import express from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Server } from 'socket.io';
import { ROOT } from './characters.js';
import { CharacterCatalog } from './catalog-worker.js';
import { RoomManager } from './rooms.js';
import { useWorkers } from './room-worker.js';

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';

console.log('Loading characters…');
const catalog = new CharacterCatalog();
await catalog.refresh({ log: true });
console.log(`${catalog.size} character(s) ready. Matches run ${useWorkers() ? 'in worker threads' : 'in-process (ROOM_WORKERS=0)'}.`);

const app = express();
const noCache = { etag: true, maxAge: 0 };
app.use('/shared', express.static(join(ROOT, 'shared'), noCache));
app.use('/characters', express.static(join(ROOT, 'characters'), noCache));
app.use(express.static(join(ROOT, 'client'), noCache));
app.get('/api/characters', async (_req, res) => {
  // In development, re-scan so new/edited characters show up on page refresh.
  if (!PROD) await catalog.refresh({ log: true });
  res.json(catalog.list()); // [{id, hash}]; clients import /characters/<id>/character.js?v=<hash>
});
app.get('/healthz', (_req, res) => res.send('ok'));

if (!PROD || process.env.DEV_ROUTES === '1') {
  try {
    const m = await import('./dev-routes.js');
    const mount = m.mountDevRoutes || m.default;
    if (typeof mount === 'function') await mount(app, { root: ROOT, catalog });
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !String(e.message).includes('dev-routes')) console.warn(`dev-routes not mounted: ${e?.message}`);
  }
}

const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' }, pingInterval: 5000, pingTimeout: 8000 });
const rooms = new RoomManager(io, catalog);
io.on('connection', (socket) => rooms.handle(socket));

http.listen(PORT, () => console.log(`Character Battle running → http://localhost:${PORT}`));
