// Loads every character module in the browser and runs it through the same
// auto-balancer the server uses. The balanced copy drives the simulation; the
// ArtDef (resolved from `art`, spec §6.1/§8) drives the visuals through an
// ArtHost. Assets are decoded before the roster resolves (5 s per character,
// behind a loading bar); failed assets are null and the art must cope.
//
// entry = { id, hash, character (validator output), def (module default), art (raw art),
//           artDef (resolved ArtDef), ir (IR for art when the validator returned v1 shape),
//           host (ArtHost), assets, assetsFailed, assetsVersion, notes, report }
import { validateCharacter } from '/shared/balance/validate.js';
import { ArtHost, resolveArtDef } from './render/art-host.js';
import { loadAssets, ASSET_TIMEOUT_MS } from './assets.js';

export const PLAYER_COLORS = ['#ff4d5e', '#3d9bff', '#ffc531', '#3fdc7a'];

// v2 files normalized here only if the validator didn't return an IR (art needs
// forms/bodies/entities); the sim always uses the validator's output.
async function irForArt(def, id) {
  if (!def || def.version !== 2) return null;
  try {
    const [{ normalize }, { buildIR }] = await Promise.all([import('/shared/char/normalize-v2.js'), import('/shared/char/ir.js')]);
    const n = normalize(def, { expectedId: id });
    return n.draft ? buildIR(n.draft) : null;
  } catch (e) {
    console.warn(`[${id}] could not build IR for art:`, e);
    return null;
  }
}

function loadingBar() {
  if (typeof document === 'undefined' || !document.body) return null;
  const el = document.createElement('div');
  el.setAttribute('role', 'progressbar');
  el.style.cssText = 'position:fixed;left:50%;bottom:12%;width:min(360px,60vw);height:8px;transform:translateX(-50%);'
    + 'background:rgba(255,255,255,0.12);border-radius:4px;overflow:hidden;z-index:9999;transition:opacity .3s';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:0;background:linear-gradient(90deg,#ffc48a,#ff7a9a);transition:width .15s';
  el.append(fill);
  document.body.append(el);
  return {
    set(k) { fill.style.width = `${Math.round(Math.max(0, Math.min(1, k)) * 100)}%`; },
    done() { el.style.opacity = '0'; setTimeout(() => el.remove(), 350); },
  };
}

/**
 * @param {object} [o] { onProgress(done, total, id), lab: bool, timeout }
 * @returns {Promise<Map<string, object>>} id → entry, sorted by name
 */
export async function loadCharacters(o = {}) {
  const list = await fetch('/api/characters').then((r) => r.json());
  const items = list.map((x) => (typeof x === 'string' ? { id: x, hash: null } : x)).filter((x) => x && typeof x.id === 'string');
  const roster = new Map();
  const bar = o.onProgress ? null : loadingBar();
  let done = 0;
  const tick = (id) => { done++; bar?.set(done / Math.max(1, items.length)); o.onProgress?.(done, items.length, id); };
  await Promise.all(items.map(async ({ id, hash }) => {
    try {
      const folder = new URL(`/characters/${id}/`, location.href).href;
      const mod = await import(`/characters/${id}/character.js${hash ? `?v=${encodeURIComponent(hash)}` : ''}`);
      const def = mod.default;
      const v = validateCharacter(def, { expectedId: id });
      if (!v.ok) { console.warn(`[${id}]`, v.errors); return; }
      if (v.notes.length) console.info(`[${id}] auto-balance:`, v.notes);
      const ir = v.character?.tables ? null : await irForArt(def, id);
      const artDef = resolveArtDef(def);
      const { assets, failed, version } = await loadAssets(artDef, folder, { timeout: o.timeout ?? ASSET_TIMEOUT_MS });
      if (failed.length) console.warn(`[${id}] assets unavailable (art gets null): ${failed.join(', ')}`);
      const entry = {
        id, hash: hash || null, character: v.character, def, art: def.art || {}, artDef, ir,
        assets, assetsFailed: failed, assetsVersion: version, notes: v.notes, report: v.report,
      };
      entry.host = new ArtHost(entry, { lab: !!o.lab });
      roster.set(id, entry);
    } catch (e) {
      console.error(`Failed to load character ${id}`, e);
    } finally {
      tick(id);
    }
  }));
  bar?.done();
  // keep a stable order
  return new Map([...roster.entries()].sort((a, b) => String(a[1].character.name).localeCompare(String(b[1].character.name))));
}

/**
 * Portrait canvas for a roster entry (cached by id:size:paletteIdx:assetsVersion;
 * animated portraits redraw at 10 fps). opts: { paletteIdx, form }.
 */
export function portrait(entry, size = 96, opts = {}) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  if (!entry.host) entry.host = new ArtHost(entry, {});
  return entry.host.portrait(size, opts.paletteIdx || 0, { dpr, form: opts.form });
}
