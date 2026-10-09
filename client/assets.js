// Character asset loading (spec §6.3). Each `art.assets` entry is a path relative
// to the character folder ('./sheet.png'); images decode to ImageBitmap, sounds to
// AudioBuffer. A character gets 5 s in total: whatever hasn't loaded by then (or
// fails, or points outside the folder) becomes `null`, and the art must cope.
// The server never touches assets — they are just strings in the module.

export const ASSET_TIMEOUT_MS = 5000;
const IMAGE_EXT = new Set(['png', 'webp', 'svg', 'jpg', 'jpeg', 'gif']);
const AUDIO_EXT = new Set(['ogg', 'mp3', 'wav', 'm4a']);

const extOf = (p) => (String(p).split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

/** Asset kind from the path: 'image' | 'audio' | null (unsupported). */
export function assetKind(path) {
  const e = extOf(path);
  return IMAGE_EXT.has(e) ? 'image' : AUDIO_EXT.has(e) ? 'audio' : null;
}

/**
 * Resolves `path` against the character folder URL. Returns null for anything
 * that leaves the folder (other origins, `..` escapes, absolute paths elsewhere).
 */
export function resolveAssetUrl(path, folderUrl) {
  if (typeof path !== 'string' || !path || path.length > 200) return null;
  let url, base;
  try { base = new URL(folderUrl); url = new URL(path, base); } catch { return null; }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
  return url.href;
}

let decoderCtx = null;
function audioDecoder() {
  if (decoderCtx) return decoderCtx;
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) return null;
  try { decoderCtx = new OAC(1, 1, 44100); } catch { decoderCtx = null; } // decodes without a user gesture
  return decoderCtx;
}

async function decodeImage(res, url) {
  const blob = await res.blob();
  if (extOf(url) === 'svg' || typeof createImageBitmap !== 'function') {
    // SVG can't go through createImageBitmap from a blob everywhere; use an <img>.
    const img = new Image();
    img.decoding = 'async';
    const src = URL.createObjectURL(blob);
    try {
      img.src = src;
      await img.decode();
      return typeof createImageBitmap === 'function' ? await createImageBitmap(img) : img;
    } finally { URL.revokeObjectURL(src); }
  }
  return createImageBitmap(blob);
}

async function decodeAudio(res) {
  const buf = await res.arrayBuffer();
  const dec = audioDecoder();
  if (!dec) return null;
  return new Promise((ok, fail) => {
    const p = dec.decodeAudioData(buf, ok, fail);
    if (p && typeof p.then === 'function') p.then(ok, fail);
  });
}

/**
 * Loads every asset of an ArtDef.
 * @param {object} art         ArtDef (art.assets = {name: './path'})
 * @param {string} folderUrl   absolute URL of the character folder, ending in '/'
 * @param {object} [o]         { timeout = 5000, fetch = globalThis.fetch, onAsset(name, ok) }
 * @returns {Promise<{assets: Object<string, any>, failed: string[], version: number}>}
 */
export async function loadAssets(art, folderUrl, o = {}) {
  const entries = Object.entries(art?.assets || {}).slice(0, 40);
  const assets = {};
  const failed = [];
  if (!entries.length) return { assets, failed, version: 1 };
  const timeout = o.timeout ?? ASSET_TIMEOUT_MS;
  const doFetch = o.fetch || globalThis.fetch;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl?.abort(); }, timeout);
  const one = async ([name, path]) => {
    assets[name] = null;
    const url = resolveAssetUrl(path, folderUrl);
    const kind = assetKind(path);
    if (!url || !kind) { failed.push(name); console.warn(`[assets] ${name}: "${path}" is not a supported asset inside the character folder`); return; }
    try {
      const res = await doFetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const v = kind === 'image' ? await decodeImage(res, url) : await decodeAudio(res);
      if (timedOut) throw new Error('timeout');
      assets[name] = v ?? null;
      if (v == null) failed.push(name);
      o.onAsset?.(name, v != null);
    } catch (e) {
      failed.push(name);
      o.onAsset?.(name, false);
      console.warn(`[assets] ${name} (${path}) failed: ${timedOut ? 'timed out' : e.message}`);
    }
  };
  // Race the whole batch against the deadline so one hung request can't stall the roster.
  await Promise.race([
    Promise.all(entries.map(one)),
    new Promise((r) => setTimeout(r, timeout + 50)),
  ]);
  clearTimeout(timer);
  for (const [name] of entries) if (!(name in assets) || (assets[name] == null && !failed.includes(name))) { assets[name] = null; failed.push(name); }
  return { assets, failed, version: 1 + entries.length - failed.length };
}
