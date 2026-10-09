// Art Lab core (spec §6.5, §6.6): pure helpers shared by the Lab page, the
// character-select showcase, the contact sheet and `npm run art-check`.
// No DOM, no canvas: everything here runs in Node tests too.

// ── URL params ──────────────────────────────────────────────────────────────
/**
 * ?char=<id> | ?src=/test/fixtures/<id>/  &still=1 &frame=<n|strike> &boxes=1 &form=<f>
 * &palette=<n> &sil=1 &half=1 &checks=1 &sheet=1 &speed=<x> &sandbox=1 &sbmove=<move> (repeat in the sandbox)
 */
export function parseParams(search = '') {
  const q = new URLSearchParams(search);
  const flag = (k) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
  const fr = q.get('frame');
  let frame = null;
  if (fr === 'strike') frame = 'strike';
  else if (fr != null && fr !== '' && Number.isFinite(+fr)) frame = Math.max(0, Math.floor(+fr));
  const src = q.get('src');
  return {
    char: q.get('char') || null,
    src: src && /^\/[\w\-/.]+\/$/.test(src) && !src.includes('..') ? src : null,
    still: flag('still'), frame, boxes: flag('boxes'), form: q.get('form') || null,
    palette: Math.max(0, Math.floor(+q.get('palette') || 0)), silhouette: flag('sil'), half: flag('half'),
    checks: flag('checks'), sheet: flag('sheet'), sandbox: flag('sandbox'), sbmove: q.get('sbmove') || null, speed: q.has('speed') ? Math.max(0, +q.get('speed') || 0) : 1,
  };
}

// ── Moves ───────────────────────────────────────────────────────────────────
/** Fighter state a move plays in (§3.4: taunt has its own state, throws/pummels play while grabbing). */
export function moveState(def) {
  const c = def?.category;
  if (c === 'taunt') return 'taunt';
  if (c === 'throw' || c === 'pummel') return 'grabbing';
  return 'attack';
}

/** Does the move play in the air? */
export function isAirMove(def) {
  return def?.category === 'aerial' || !!def?.requires?.airborne;
}

/** Active-phase window {from, to} (null when the move has no active frames). */
export function activeWindow(def) {
  if (!def) return null;
  const s = Number.isFinite(def.startup) ? def.startup : null;
  const e = Number.isFinite(def.activeEnd) ? def.activeEnd : null;
  if (s == null || e == null || e < s) return null;
  return { from: s, to: e };
}

/** The "strike" frame: active midpoint, or mid-duration for moves with no active frames. */
export function strikeFrame(def) {
  const w = activeWindow(def);
  if (!w) return Math.max(0, Math.floor((def?.duration || 1) / 2));
  const mid = Math.floor((w.from + w.to) / 2);
  // Multi-hit moves with gaps: the hitbox frame nearest the midpoint (so something is out).
  const on = (f) => (def.hitboxes || []).some((h) => f >= h.start && f <= h.end)
    || (def.timeline || []).some((e) => e.action === 'hit' && (e.when === 'range' ? f >= e.from && f <= e.to : f === e.at));
  if (!(def.hitboxes?.length || def.timeline?.some((e) => e.action === 'hit')) || on(mid)) return mid;
  for (let d = 1; d <= w.to - w.from; d++) { if (on(mid - d) && mid - d >= w.from) return mid - d; if (on(mid + d) && mid + d <= w.to) return mid + d; }
  return mid;
}

/** Frame for a move under a ?frame= param (null → loop). */
export function frameFor(def, param) {
  if (param === 'strike') return strikeFrame(def);
  if (Number.isFinite(param)) return Math.min(param, Math.max(0, (def?.duration || 1) - 1));
  return null;
}

/**
 * Scrubber markers: the three phases plus authored windows (hitboxes, intangible,
 * armor, cancels, hold, charge) as {kind, from, to, label}.
 */
export function phaseMarkers(def) {
  const dur = Math.max(1, def?.duration || 1);
  const out = [];
  const w = activeWindow(def);
  const startup = w ? w.from : dur;
  out.push({ kind: 'startup', from: 0, to: Math.max(0, startup - 1), label: 'startup' });
  if (w) out.push({ kind: 'active', from: w.from, to: w.to, label: 'active' });
  if ((w ? w.to + 1 : dur) < dur) out.push({ kind: 'recovery', from: w ? w.to + 1 : dur, to: dur - 1, label: 'recovery' });
  for (const h of def?.hitboxes || []) out.push({ kind: 'hitbox', from: h.start, to: h.end, label: `hit ${h.damage ?? ''}`.trim() });
  for (const [a, b] of def?.intangible || []) out.push({ kind: 'intangible', from: a, to: b, label: 'intangible' });
  for (const a of def?.armor || []) out.push({ kind: 'armor', from: a.from, to: a.to, label: 'armor' });
  for (const c of def?.cancels || []) out.push({ kind: 'cancel', from: c.from, to: c.to, label: `cancel → ${(c.into || []).join('/')}` });
  if (def?.hold) out.push({ kind: 'hold', from: def.hold.from, to: def.hold.to, label: 'hold' });
  if (def?.charge && Number.isFinite(def.charge.at)) out.push({ kind: 'charge', from: def.charge.at, to: def.charge.at, label: 'charge' });
  for (const e of def?.timeline || []) {
    if (e.when === 'at' && Number.isFinite(e.at)) out.push({ kind: 'event', from: e.at, to: e.at, label: e.action });
    else if (e.when === 'range' && Number.isFinite(e.from)) out.push({ kind: 'event', from: e.from, to: e.to, label: e.action });
  }
  return out;
}

/**
 * Every pool move with its routes: triggers first (TRIGGERS order across forms),
 * then cancel-only / next-only moves (sorted). [{name, def, routes, category, generic}]
 */
export function moveList(ir) {
  if (!ir?.moves) return [];
  const triggers = ir.tables?.triggers || [];
  const forms = ir.tables?.forms || ['base'];
  const routes = new Map();
  for (const t of triggers) {
    for (const f of forms) {
      const n = ir.forms?.[f]?.slots?.[t];
      if (!n || !ir.moves[n]) continue;
      if (!routes.has(n)) routes.set(n, []);
      routes.get(n).push(forms.length > 1 ? `${f}:${t}` : t);
    }
  }
  const names = ir.tables?.moves || Object.keys(ir.moves).sort();
  const routed = [...routes.keys()];
  const rest = names.filter((n) => !routes.has(n));
  return [...routed, ...rest].map((n) => ({
    name: n, def: ir.moves[n], routes: routes.get(n) || [], category: ir.moves[n].category, generic: !!ir.moves[n].generic,
  }));
}

/**
 * Form a move should be previewed in: `current` if a route uses it (or the move has
 * no form-prefixed route), else the form of its first route ("spike:jab" → spike).
 */
export function formForMove(m, current) {
  const forms = (m?.routes || []).map((r) => (r.includes(':') ? r.split(':')[0] : null)).filter(Boolean);
  if (!forms.length || forms.includes(current)) return current;
  return forms[0];
}

/**
 * Showcase playlist for a form: the resolved move of every trigger (TRIGGERS order,
 * deduped). Grab-partner moves (throws/pummel) are skipped: they need a victim.
 */
export function triggerPlaylist(ir, form = 'base') {
  const slots = ir?.forms?.[form]?.slots || ir?.forms?.base?.slots || {};
  const out = [];
  for (const t of ir?.tables?.triggers || Object.keys(slots)) {
    const n = slots[t];
    const def = n ? ir.moves?.[n] : null;
    if (!def || out.some((x) => x.name === n)) continue;
    if (def.category === 'throw' || def.category === 'pummel') continue;
    out.push({ trigger: t, name: n, def });
  }
  return out;
}

// ── States ──────────────────────────────────────────────────────────────────
const MODE_STATE = { glide: 'glide', fly: 'fly', wallCling: 'wallcling', crawl: 'crawl' };
/**
 * The state gallery for a form: [{label, view}] (partial views for host.preview).
 * Movement-mode states appear only when the form enables the mode.
 */
export function stateList(ir, form = 'base') {
  const mv = ir?.forms?.[form]?.movement || {};
  const air = { state: 'air', grounded: false };
  const list = [
    ['idle', {}], ['run', { state: 'run', vx: 7 }], ['crouch', { state: 'crouch' }], ['jumpsquat', { state: 'jumpsquat' }],
    ['jump', { ...air, vy: -10 }], ['fall', { ...air, vy: 8 }], ['land', { state: 'land' }],
    ['shield', { state: 'shield', shield: 50 }], ['roll', { state: 'roll', vx: 6 }], ['spotdodge', { state: 'spotdodge' }],
    ['airdodge', { state: 'airdodge', grounded: false }], ['hurt', { state: 'hitstun', grounded: false, kx: -4, ky: -3 }],
    ['tumble', { state: 'hitstun', tumble: true, grounded: false, kx: -10, ky: -8 }], ['helpless', { state: 'helpless', grounded: false, vy: 4 }],
    ['shieldbreak', { state: 'shieldbreak' }], ['stunned', { state: 'stunned', control: 'stun' }],
    ['grabbing', { state: 'grabbing' }], ['grabbed', { state: 'grabbed', grounded: false }], ['respawn', { state: 'respawn' }],
  ];
  if (mv.hover) list.push(['hover', { ...air, vy: 1, hover: true }]);
  for (const [k, s] of Object.entries(MODE_STATE)) if (mv[k]) list.push([s, { state: s, grounded: s === 'crawl', vx: s === 'glide' || s === 'fly' ? 6 : 0 }]);
  return list.map(([label, v]) => ({ label, view: { state: 'idle', grounded: true, vx: 0, vy: 0, ...v } }));
}

/** Partial Lab view for a move at a frame (host.preview input). */
export function moveView(name, def, frame, extra = {}) {
  const air = isAirMove(def);
  return { state: moveState(def), moveName: name, moveFrame: frame, grounded: !air, vy: air ? 2 : 0, ...extra };
}

// ── Framing ─────────────────────────────────────────────────────────────────
/**
 * Body-space box to fit in a cell: the art bounds, or (legacy v1 layout, whose
 * bounds are a huge square) a humanoid-sized box from the collider height.
 */
export function frameBox(bounds, H) {
  if (!bounds || bounds.legacy) return { left: -0.95 * H, right: 0.95 * H, top: -1.4 * H, bottom: 0.12 * H };
  return bounds;
}

/** Scale + feet origin that fit `box` into a w×h cell with padding. */
export function fitTransform(box, w, h, { pad = 0.08, maxScale = 4 } = {}) {
  const bw = Math.max(1, box.right - box.left), bh = Math.max(1, box.bottom - box.top);
  const s = Math.min(maxScale, (w * (1 - 2 * pad)) / bw, (h * (1 - 2 * pad)) / bh);
  const ox = w / 2 - ((box.left + box.right) / 2) * s;
  const oy = h / 2 - ((box.top + box.bottom) / 2) * s;
  return { scale: s, ox, oy };
}

// ── Entities ────────────────────────────────────────────────────────────────
export const ENTITY_KINDS = Object.freeze(['projectile', 'minion', 'trap', 'zone', 'beam', 'clone', 'part']);

/** Snapshot-like entity record for the gallery (host.entityView input), at `age` frames. */
export function entityRecord(ir, name, age, id = 1) {
  const def = ir?.entities?.[name];
  if (!def) return null;
  const life = Number.isFinite(def.life) ? def.life : -1;
  const loopAge = life > 0 ? age % Math.max(1, Math.min(life, 240)) : age;
  const speed = def.motion?.speed ?? 0;
  const rec = {
    i: id, name, k: Math.max(0, ENTITY_KINDS.indexOf(def.kind)), x: 0, y: 0, f: 1, g: loopAge,
    l: life > 0 ? Math.max(1, life - loopAge) : -1, vx: speed, vy: 0, a: 0, h: def.hp > 0 ? def.hp : -1,
    n: def.length || 0, v: {},
  };
  if (def.kind === 'clone') rec.c = ['idle', loopAge, -1, 0, 1, 1];
  return rec;
}

/** Body-space box an entity tile should show. */
export function entityBox(def) {
  const s = def?.shape || { shape: 'circle', x: 0, y: 0, r: 10 };
  const b = shapeBox(s);
  const pad = Math.max(24, (b.x2 - b.x1) * 0.6, (b.y2 - b.y1) * 0.6);
  let box = { left: b.x1 - pad, right: b.x2 + pad, top: b.y1 - pad, bottom: b.y2 + pad };
  if (def?.kind === 'beam' && def.length) box = { left: -pad, right: def.length + pad, top: -Math.max(pad, def.width || 20), bottom: Math.max(pad, def.width || 20) };
  return box;
}

// ── Shapes and pixel checks (§6.6 table) ────────────────────────────────────
function shapeBox(s) {
  if (s.shape === 'circle' || (s.r !== undefined && s.x1 === undefined && s.w === undefined)) return { x1: s.x - s.r, y1: s.y - s.r, x2: s.x + s.r, y2: s.y + s.r };
  if (s.shape === 'capsule' || s.x1 !== undefined) return { x1: Math.min(s.x1, s.x2) - s.r, y1: Math.min(s.y1, s.y2) - s.r, x2: Math.max(s.x1, s.x2) + s.r, y2: Math.max(s.y1, s.y2) + s.r };
  return { x1: s.x - s.w / 2, y1: s.y - s.h / 2, x2: s.x + s.w / 2, y2: s.y + s.h / 2 };
}
export { shapeBox };

/** Is body point (x, y) inside shape s? */
export function inShape(s, x, y) {
  if (s.shape === 'capsule' || s.x1 !== undefined) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const L = dx * dx + dy * dy;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / L)) : 0;
    const px = s.x1 + dx * t - x, py = s.y1 + dy * t - y;
    return px * px + py * py <= s.r * s.r;
  }
  if (s.shape === 'rect' || s.w !== undefined) return Math.abs(x - s.x) <= s.w / 2 && Math.abs(y - s.y) <= s.h / 2;
  const ex = x - s.x, ey = y - s.y;
  return ex * ex + ey * ey <= s.r * s.r;
}

/**
 * Pixel mask of a shape list on a w×h grid. tf maps body → pixel:
 * px = ox + x·k·facing, py = oy + y·k (pixel centers sampled).
 */
export function shapeMask(shapes, w, h, tf) {
  const m = new Uint8Array(w * h);
  const { ox, oy, k } = tf;
  const fa = tf.facing < 0 ? -1 : 1;
  for (const s of shapes) {
    const b = shapeBox(s);
    const xs = [ox + b.x1 * k * fa, ox + b.x2 * k * fa];
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(oy + b.y1 * k)), y1 = Math.min(h - 1, Math.ceil(oy + b.y2 * k));
    for (let py = y0; py <= y1; py++) {
      const by = (py + 0.5 - oy) / k;
      for (let px = x0; px <= x1; px++) {
        if (m[py * w + px]) continue;
        if (inShape(s, ((px + 0.5 - ox) / k) * fa, by)) m[py * w + px] = 1;
      }
    }
  }
  return m;
}

/** Opaque mask from RGBA data (alpha > thr). */
export function alphaMask(data, w, h, thr = 24) {
  const m = new Uint8Array(w * h);
  for (let i = 0, n = w * h; i < n; i++) if (data[i * 4 + 3] > thr) m[i] = 1;
  return m;
}

const count = (m) => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; };
const both = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) n += a[i] & b[i]; return n; };

/** CIE L* (0..100) of an sRGB color (0..255 channels). */
export function lightness(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}

/** Mean L* over masked pixels of RGBA data (alpha-weighted). null when empty. */
export function meanLightness(data, mask) {
  let sum = 0, wsum = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const a = data[i * 4 + 3] / 255;
    sum += lightness(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) * a;
    wsum += a;
  }
  return wsum > 0 ? sum / wsum : null;
}

/** Warning thresholds (§6.6). */
export const CHECK_LIMITS = Object.freeze({
  hitboxCoverage: 0.15, hurtOutside: 0.45, hurtEmpty: 0.30, contrastDL: 12, perfWarnMs: 2, perfLowMs: 4,
});

/**
 * Hitbox coverage for one rendered active frame.
 * @param {Uint8Array} opaque  alpha mask
 * @param {{shape: object, label: string}[]} hits  active hit shapes (body space)
 * @returns {{label, coverage}[]} coverage = opaque px inside / px inside
 */
export function hitboxCoverage(opaque, hits, w, h, tf, { offCanvas = true } = {}) {
  return hits.map(({ shape, label }) => {
    const m = shapeMask([shape], w, h, tf);
    // offCanvas: parts past art.bounds can never be covered by draw(), so divide by the full
    // shape area. Off for art with drawWorld (it may paint far hitboxes in world space).
    const area = offCanvas ? Math.max(count(m), Math.round(shapeArea(shape) * tf.k * tf.k)) : count(m);
    return { label, coverage: area ? both(m, opaque) / area : 1, area };
  });
}

/** Geometric area of a body-space shape (px²). */
export function shapeArea(s) {
  if (s.shape === 'capsule' || s.x1 !== undefined) return Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 2 * s.r + Math.PI * s.r * s.r;
  if (s.shape === 'rect' || s.w !== undefined) return s.w * s.h;
  return Math.PI * s.r * s.r;
}

/** Hurtbox fit: share of the silhouette outside the hurtboxes, share of hurtbox area left transparent. */
export function hurtboxFit(opaque, hurtShapes, w, h, tf) {
  const hm = shapeMask(hurtShapes, w, h, tf);
  const op = count(opaque), hu = count(hm), inter = both(opaque, hm);
  return { outside: op ? (op - inter) / op : 0, empty: hu ? (hu - inter) / hu : 0, opaque: op, hurt: hu };
}

/** Opaque pixels on the canvas edge (count per side). */
export function edgeTouches(opaque, w, h) {
  const out = { left: 0, right: 0, top: 0, bottom: 0 };
  for (let x = 0; x < w; x++) { out.top += opaque[x]; out.bottom += opaque[(h - 1) * w + x]; }
  for (let y = 0; y < h; y++) { out.left += opaque[y * w]; out.right += opaque[y * w + w - 1]; }
  return out;
}

/**
 * One bounds-overflow entry per state/move: frames merged ("upSmash f12–17"), sides OR-ed.
 * Input wheres are "<name>" or "<name> f<frame>".
 */
export function mergeEdges(edges) {
  const by = new Map();
  for (const e of edges) {
    if (!(e.left + e.right + e.top + e.bottom)) continue;
    const [name, f] = String(e.where).split(' f');
    let g = by.get(name);
    if (!g) by.set(name, (g = { name, frames: [], left: 0, right: 0, top: 0, bottom: 0 }));
    if (f != null && Number.isFinite(+f)) g.frames.push(+f);
    for (const k of ['left', 'right', 'top', 'bottom']) g[k] += e[k];
  }
  return [...by.values()].map((g) => {
    const fr = g.frames.sort((a, b) => a - b);
    const where = fr.length ? `${g.name} f${fr[0]}${fr.length > 1 ? `–${fr[fr.length - 1]}` : ''}` : g.name;
    return { where, left: g.left, right: g.right, top: g.top, bottom: g.bottom };
  });
}

/**
 * Turns raw measurements into warnings: [{check, where, message, value}].
 * @param {object} m { coverage: [{where, label, coverage}], fit: {outside, empty} | null,
 *   edges: [{where, left, right, top, bottom}], silhouetteL, stageL, perfMs }
 */
export function evaluate(m) {
  const L = CHECK_LIMITS;
  const out = [];
  const pct = (v) => `${Math.round(v * 100)}%`;
  for (const c of m.coverage || []) {
    if (c.coverage < L.hitboxCoverage) out.push({ check: 'hitbox-coverage', where: c.where, value: c.coverage, message: `${c.where}: hitbox ${c.label} is ${pct(c.coverage)} covered by art (< ${pct(L.hitboxCoverage)}: hitbox floating in empty space)` });
  }
  if (m.fit) {
    if (m.fit.outside > L.hurtOutside) out.push({ check: 'hurtbox-fit', where: m.fit.where || 'idle', value: m.fit.outside, message: `${m.fit.where || 'idle'}: ${pct(m.fit.outside)} of the silhouette is outside the hurtboxes (> ${pct(L.hurtOutside)})` });
    if (m.fit.empty > L.hurtEmpty) out.push({ check: 'hurtbox-fit', where: m.fit.where || 'idle', value: m.fit.empty, message: `${m.fit.where || 'idle'}: ${pct(m.fit.empty)} of the hurtbox area is transparent (> ${pct(L.hurtEmpty)})` });
  }
  for (const e of m.edges || []) {
    const sides = ['left', 'right', 'top', 'bottom'].filter((s) => e[s] > 0);
    if (sides.length) out.push({ check: 'bounds-overflow', where: e.where, value: sides.length, message: `${e.where}: opaque pixels touch the bounds edge (${sides.join(', ')}) — widen art.bounds or pull the drawing in` });
  }
  if (Number.isFinite(m.silhouetteL) && Number.isFinite(m.stageL)) {
    const d = Math.abs(m.silhouetteL - m.stageL);
    if (d < L.contrastDL) out.push({ check: 'contrast', where: 'idle', value: d, message: `silhouette lightness L*${m.silhouetteL.toFixed(0)} vs stage L*${m.stageL.toFixed(0)}: ΔL ${d.toFixed(1)} < ${L.contrastDL}` });
  }
  if (Number.isFinite(m.perfMs) && m.perfMs > L.perfWarnMs) {
    out.push({ check: 'perf', where: 'draw', value: m.perfMs, message: `draw averages ${m.perfMs.toFixed(2)} ms (> ${L.perfWarnMs} ms${m.perfMs > L.perfLowMs ? `; > ${L.perfLowMs} ms the renderer drops to quality 'low' at 30 Hz` : ''})` });
  }
  return out;
}

// ── Contact sheet layout ────────────────────────────────────────────────────
/** Grid layout for n tiles: {cols, rows, width, height, at(i) → {x, y}}. */
export function sheetLayout(n, { tile = 240, label = 22, cols = 6, header = 56, gap = 6 } = {}) {
  const c = Math.max(1, Math.min(cols, n));
  const rows = Math.max(1, Math.ceil(n / c));
  const th = tile + label;
  return {
    cols: c, rows, tile, label, header,
    width: c * tile + (c + 1) * gap,
    height: header + rows * th + (rows + 1) * gap,
    at: (i) => ({ x: gap + (i % c) * (tile + gap), y: header + gap + Math.floor(i / c) * (th + gap) }),
  };
}

/** Valid character id for the dev endpoints (same rule both sides). */
export const SHEET_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/i;
