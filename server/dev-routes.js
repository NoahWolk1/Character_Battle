// Dev-only routes (spec §6.6). Mounted by server/index.js only when
// NODE_ENV !== 'production' (or DEV_ROUTES=1).
//
//   POST /dev/contact-sheet/:id   image/png body → .cache/contact-sheets/<id>.png
//   GET  /dev/contact-sheet/:id   the saved PNG
//   POST /dev/art-check/:id       JSON {warnings, measures} → .cache/art-checks/<id>.json
//   GET  /dev/fixtures/*          test/fixtures (Lab: /lab.html?src=/dev/fixtures/<id>/)
//   GET  /dev/lab-fixtures/*      test/lab/fixtures (purpose-built bad art for the checks)
//   GET  /dev/archetypes/*        test/archetypes (Lab: /lab.html?src=/dev/archetypes/<id>/)
//   GET  /dev/hold/:token         1×1 GIF held until POST /dev/release/:token (≤ 90 s): the Lab's
//                                 still mode uses it to delay window load until it has rendered
import express from 'express';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const SHEET_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/i; // same rule as client/lab/core.js
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG = 40 * 1024 * 1024;
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const HOLD_TOKEN = /^[a-z0-9]{4,32}$/;
export const HOLD_MS = 90000;

export const sheetPath = (root, id) => join(root, '.cache', 'contact-sheets', `${id}.png`);
export const checkPath = (root, id) => join(root, '.cache', 'art-checks', `${id}.json`);

/** Only local requests may write files (the dev server may listen on a LAN). */
function isLocal(req) {
  const a = req.socket?.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/**
 * @param {import('express').Express} app
 * @param {{root: string}} o  repo root
 */
export function mountDevRoutes(app, { root }) {
  const noCache = { etag: true, maxAge: 0 };
  app.use('/dev/fixtures', express.static(join(root, 'test', 'fixtures'), noCache));
  app.use('/dev/lab-fixtures', express.static(join(root, 'test', 'lab', 'fixtures'), noCache));
  app.use('/dev/archetypes', express.static(join(root, 'test', 'archetypes'), noCache));

  // Load-event hold for still-mode screenshots: token → pending response (or 'released').
  const holds = new Map();
  const sendGif = (res) => { if (!res.headersSent) res.set('cache-control', 'no-store').type('gif').send(GIF); };
  app.get('/dev/hold/:token', (req, res) => {
    const { token } = req.params;
    if (!HOLD_TOKEN.test(token)) return res.status(400).end();
    if (holds.get(token) === 'released') { holds.delete(token); return sendGif(res); }
    const timer = setTimeout(() => { holds.delete(token); sendGif(res); }, HOLD_MS);
    timer.unref?.();
    holds.set(token, { res, timer });
    req.on('close', () => { if (holds.get(token)?.res === res) { clearTimeout(timer); holds.delete(token); } });
  });
  app.post('/dev/release/:token', (req, res) => {
    const { token } = req.params;
    if (!HOLD_TOKEN.test(token)) return res.status(400).end();
    const h = holds.get(token);
    if (h && h !== 'released') { clearTimeout(h.timer); holds.delete(token); sendGif(h.res); }
    else if (holds.size < 1000) { // release raced ahead of the hold
      holds.set(token, 'released');
      setTimeout(() => { if (holds.get(token) === 'released') holds.delete(token); }, HOLD_MS).unref?.();
    }
    res.json({ ok: true });
  });

  app.post('/dev/contact-sheet/:id', express.raw({ type: 'image/png', limit: MAX_PNG }), async (req, res) => {
    const { id } = req.params;
    if (!isLocal(req)) return res.status(403).json({ error: 'local requests only' });
    if (!SHEET_ID.test(id)) return res.status(400).json({ error: 'bad id' });
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 64 || !body.subarray(0, 8).equals(PNG_MAGIC)) return res.status(400).json({ error: 'body must be a PNG (content-type image/png)' });
    try {
      const file = sheetPath(root, id);
      await mkdir(join(root, '.cache', 'contact-sheets'), { recursive: true });
      await writeFile(file, body);
      console.log(`[dev] contact sheet → ${file} (${body.length} bytes)`);
      res.json({ ok: true, path: `.cache/contact-sheets/${id}.png`, bytes: body.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/dev/contact-sheet/:id', (req, res) => {
    const { id } = req.params;
    if (!SHEET_ID.test(id)) return res.status(400).end();
    const file = sheetPath(root, id);
    if (!existsSync(file)) return res.status(404).end();
    res.set('cache-control', 'no-store').sendFile(file);
  });

  app.post('/dev/art-check/:id', express.json({ limit: '2mb' }), async (req, res) => {
    const { id } = req.params;
    if (!isLocal(req)) return res.status(403).json({ error: 'local requests only' });
    if (!SHEET_ID.test(id)) return res.status(400).json({ error: 'bad id' });
    const b = req.body;
    if (!b || !Array.isArray(b.warnings)) return res.status(400).json({ error: 'expected {warnings: [...]}' });
    try {
      await mkdir(join(root, '.cache', 'art-checks'), { recursive: true });
      const out = { id, at: new Date().toISOString(), warnings: b.warnings.slice(0, 200), info: Array.isArray(b.info) ? b.info.slice(0, 50) : [], measures: b.measures ?? null };
      await writeFile(checkPath(root, id), JSON.stringify(out, null, 2));
      res.json({ ok: true, path: `.cache/art-checks/${id}.json`, warnings: out.warnings.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

export default mountDevRoutes;
