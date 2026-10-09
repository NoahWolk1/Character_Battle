// Art Lab v2 (spec §6.6): every state, every pool move (throws, cancel-only, taunt),
// forms, palettes, resources/vars/statuses, entity gallery, frame scrubber with phase
// markers, shape-accurate boxes, silhouette, 0.5× preview, perf meter, the §6.6
// automatic checks, the contact sheet and a governor sandbox. Everything draws
// through the art host (client/render/art-host.js), exactly like the game.
//
//   /lab.html?char=<id>                     a roster character
//   /lab.html?src=/dev/fixtures/<id>/       a dev fixture (served by server/dev-routes.js)
//   &still=1        render once, no rAF loop (headless screenshots finish)
//   &frame=<n|strike>  freeze move tiles at frame n / each move's active midpoint
//   &boxes=1 &form=<f> &palette=<n> &sil=1 &half=1
//   &checks=1       run the checks (with still=1: POST them to /dev/art-check/:id)
//   &sheet=1        build the contact sheet and POST it to /dev/contact-sheet/:id
//   &sandbox=1      open the governor sandbox; &sbmove=<move> repeats a move in it
import { PLAYER_COLORS } from './characters.js';
import { validateCharacter } from '/shared/balance/validate.js';
import { BUILTIN_STATUSES } from '/shared/char/schema.js';
import stage from '/shared/stages/sky-sanctum.js';
import { ArtHost, resolveArtDef } from './render/art-host.js';
import { loadAssets } from './assets.js';
import * as core from './lab/core.js';
import { drawCharacterTile, drawEntityTile, drawBoxes, runChecks, contactSheet, postSheet, stageReference } from './lab/draw.js';

const P = core.parseParams(location.search);
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const HEADLESS = /HeadlessChrome/.test(navigator.userAgent) || navigator.webdriver === true;
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
if (P.still) document.body.classList.add('still');

const L = {
  list: new Map(), roster: new Map(), entry: null, host: null, ir: null, form: 'base', ordinal: P.palette,
  t: 0, acc: 0, speed: P.speed, playing: !P.still, frame: 0,
  focus: { kind: 'state', key: 'idle' }, cells: [], moves: new Map(), res: {}, vars: {}, statuses: new Set(), bodyScale: 1,
  perf: { avg: 0, n: 0 }, sandbox: null, checks: null,
};
const opt = () => ({ boxes: $('#boxes').checked, silhouette: $('#sil').checked, half: $('#half').checked, bg: $('#stagebg').checked ? stageReference(stage).backdrop : null });

// ── Loading ─────────────────────────────────────────────────────────────────
// Characters load on demand (only the one on screen, plus the sandbox dummy):
// validation can take seconds per character in a browser, and still-mode
// screenshots must finish quickly. Same pipeline as client/characters.js.
async function irForArt(def, id) {
  if (!def || def.version !== 2) return null;
  const [{ normalize }, { buildIR }] = await Promise.all([import('/shared/char/normalize-v2.js'), import('/shared/char/ir.js')]);
  const n = normalize(def, { expectedId: id });
  return n.draft ? buildIR(n.draft) : null;
}

/** Roster-like entry for /characters/<id>/ or a fixture folder (src). */
async function loadEntry({ id, hash = null, src = null }) {
  const base = src || `/characters/${id}/`;
  const folder = new URL(base, location.href).href;
  const bust = src ? `?t=${Date.now()}` : hash ? `?v=${encodeURIComponent(hash)}` : '';
  const def = (await import(`${base}character.js${bust}`)).default;
  const want = src ? (def?.id || src.split('/').filter(Boolean).pop()) : id;
  trace(`load ${want}: imported`);
  const v = validateCharacter(def, { expectedId: want });
  trace(`load ${want}: validated`);
  if (!v.ok) throw new Error(`${want}: ${v.errors.map((e) => e.message || e.code || String(e)).join('; ')}`);
  const ir = v.character?.tables ? null : await irForArt(def, want);
  const artDef = resolveArtDef(def);
  const { assets, failed, version } = await loadAssets(artDef, folder);
  const entry = {
    id: v.character.id || want, hash, character: v.character, def, art: def.art || {}, artDef, ir,
    assets, assetsFailed: failed, assetsVersion: version, notes: v.notes, report: v.report, fixture: src,
  };
  entry.host = new ArtHost(entry, { lab: true });
  return entry;
}

/** Loaded entry for a listed id (cached). */
async function ensure(id) {
  if (L.roster.has(id)) return L.roster.get(id);
  const item = L.list.get(id);
  if (!item) throw new Error(`unknown character ${id}`);
  item.loading ||= loadEntry(item).then((e) => {
    L.roster.set(id, e);
    const opt_ = [...$('#char').options].find((o) => o.value === id);
    if (opt_) opt_.textContent = `${e.character.name || id}${e.def?.version === 2 ? ' (v2)' : ''}`;
    return e;
  }, (err) => { item.loading = null; throw err; });
  return item.loading;
}

// ── Lab view of the current controls ────────────────────────────────────────
function statusList() {
  return [...L.statuses].map((name) => ({ name, frames: 120, stacks: 1 }));
}
function statusDef(name) { return L.ir?.statuses?.[name] || BUILTIN_STATUSES[name] || null; }
function extras() {
  const ctl = [...L.statuses].map((n) => statusDef(n)?.control).find(Boolean) || null;
  return { form: L.form, resources: { ...L.res }, vars: { ...L.vars }, statuses: statusList(), bodyScale: L.bodyScale, control: ctl };
}
function tintsFor() {
  const out = [];
  for (const n of L.statuses) { const d = statusDef(n); if (typeof d?.tint === 'string') out.push(d.tint); }
  return out;
}

/** Frame of a move tile at lab time t (loop with a 20-frame rest), or the ?frame= freeze. */
function moveFrameAt(def, t) {
  const fz = core.frameFor(def, P.frame);
  if (fz != null) return fz;
  return Math.min(t % (def.duration + 20), def.duration - 1);
}

/** Partial view for a gallery item at lab time t. */
function partialFor(item, t) {
  const x = extras();
  if (item.kind === 'state') return { ...item.view, ...x, stateFrame: Number.isFinite(P.frame) ? P.frame : t, grounded: item.view.grounded };
  const def = L.ir.moves[item.key];
  const form = core.formForMove(L.moves.get(item.key), L.form); // spike:jab previews in spike form
  return core.moveView(item.key, def, item.frameOverride ?? moveFrameAt(def, t), { ...x, form });
}

// ── Gallery ─────────────────────────────────────────────────────────────────
function buildGallery() {
  L.cells = [];
  for (const id of ['#states', '#moves', '#entities']) $(id).innerHTML = '';
  const add = (parent, item, label, sub) => {
    const cap = el('div', { className: 'cap' }, label, el('span', { textContent: sub, title: sub }));
    const d = el('div', { className: 'cell', title: `${label} — ${sub}` }, el('canvas'), cap);
    d.addEventListener('click', () => setFocus(item));
    parent.append(d);
    L.cells.push({ ...item, el: d, canvas: d.querySelector('canvas') });
  };
  for (const s of core.stateList(L.ir, L.form)) add($('#states'), { kind: 'state', key: s.label, view: s.view }, s.label, 'state');
  L.moves = new Map(core.moveList(L.ir).map((m) => [m.name, m]));
  for (const m of L.moves.values()) {
    const tag = m.routes.length ? m.routes.join(', ') : m.generic ? 'generic' : 'cancel/next only';
    add($('#moves'), { kind: 'move', key: m.name }, m.name, `${m.category} · ${tag}`);
  }
  const ents = L.ir.tables.entities.filter((n) => !L.ir.entities[n].legacy);
  for (const n of ents) add($('#entities'), { kind: 'entity', key: n }, n, L.ir.entities[n].kind);
  if (!ents.length) $('#entities').append(el('small', { textContent: L.ir.tables.entities.length ? 'v1 projectiles only (drawn by art.projectile in game)' : 'no entities' }));
  markFocus();
}

function drawCell(c, t, o) {
  const cv = c.canvas;
  const w = Math.max(1, Math.round((cv.clientWidth || 190) * dpr())), h = Math.max(1, Math.round((cv.clientHeight || 190) * dpr()));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  const pal = L.host.palette(L.form, L.ordinal);
  if (c.kind === 'entity') {
    const r = drawEntityTile(ctx, { host: L.host, name: c.key, age: t, w, h, form: L.form, palette: pal, ordinal: L.ordinal, boxes: o.boxes, silhouette: o.silhouette, time: t / 60, bg: o.bg, id: `lab:e:${c.key}` });
    return r?.ms ?? null;
  }
  const r = drawCharacterTile(ctx, {
    host: L.host, id: `lab:${c.kind}:${c.key}`, partial: partialFor(c, t), w, h, time: t / 60, frame: t, palette: pal, ordinal: L.ordinal,
    boxes: o.boxes, silhouette: o.silhouette, half: o.half, dpr: dpr(), bg: o.bg, tints: tintsFor(),
  });
  c.el.classList.toggle('err', !!r.error);
  return r.perf?.last ?? r.ms;
}

// ── Focus (big preview + scrubber) ──────────────────────────────────────────
function focusDef() { return L.focus.kind === 'move' ? L.ir.moves[L.focus.key] : null; }
function focusLength() {
  const def = focusDef();
  if (def) return def.duration;
  if (L.focus.kind === 'entity') { const d = L.ir.entities[L.focus.key]; return Math.min(240, Number.isFinite(d?.life) && d.life > 0 ? d.life : 120); }
  return 120;
}

function setFocus(item) {
  L.focus = { kind: item.kind, key: item.key, view: item.view };
  const def = focusDef();
  L.frame = def ? (core.frameFor(def, P.frame) ?? core.strikeFrame(def)) : 0;
  const fr = $('#frame');
  fr.max = Math.max(0, focusLength() - 1);
  fr.value = L.frame;
  markFocus();
  renderFocus();
}

function markFocus() {
  for (const c of L.cells) c.el.classList.toggle('sel', c.kind === L.focus.kind && c.key === L.focus.key);
}

function renderFocus() {
  const cv = $('#focus-canvas');
  const w = Math.max(1, Math.round((cv.clientWidth || 800) * dpr())), h = Math.max(1, Math.round((cv.clientHeight || 500) * dpr()));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  const o = opt();
  const f = L.frame;
  const pal = L.host.palette(L.form, L.ordinal);
  $('#frame-out').textContent = `${f}/${Math.max(0, focusLength() - 1)}`;
  $('#frame').value = f;
  let r = null;
  if (L.focus.kind === 'entity') {
    r = drawEntityTile(ctx, { host: L.host, name: L.focus.key, age: f, w, h, form: L.form, palette: pal, ordinal: L.ordinal, boxes: o.boxes, silhouette: o.silhouette, time: f / 60, bg: o.bg, id: 'lab:focus:e' });
  } else {
    const item = L.focus.kind === 'move' ? { kind: 'move', key: L.focus.key, frameOverride: f } : { kind: 'state', key: L.focus.key, view: L.focus.view || { state: 'idle' } };
    const partial = item.kind === 'state' ? { ...partialFor(item, 0), stateFrame: f } : partialFor(item, 0);
    r = drawCharacterTile(ctx, {
      host: L.host, id: 'lab:focus', partial, w, h, time: (L.focus.kind === 'move' ? L.t : f) / 60, frame: f, palette: pal, ordinal: L.ordinal,
      boxes: o.boxes, silhouette: o.silhouette, half: o.half, dpr: dpr(), bg: o.bg, tints: tintsFor(),
    });
  }
  drawPhaseBar();
  focusInfo(r);
}

const MARK_COLORS = { startup: '#6f8cff', active: '#ff4d6a', recovery: '#8a7a9e', hitbox: '#ff8a9c', intangible: '#6ff3ff', armor: '#ffc850', cancel: '#5be39a', hold: '#c49bff', charge: '#ffe36b', event: '#ffffff' };
function drawPhaseBar() {
  const cv = $('#phase-bar');
  const w = Math.max(1, Math.round((cv.clientWidth || 600) * dpr())), h = Math.max(1, Math.round((cv.clientHeight || 44) * dpr()));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const n = Math.max(1, focusLength());
  const X = (fr) => (fr / n) * w;
  const def = focusDef();
  const k = dpr();
  ctx.font = `600 ${10 * k}px Rajdhani, sans-serif`;
  ctx.textBaseline = 'middle';
  if (def) {
    const marks = core.phaseMarkers(def);
    const phases = marks.filter((m) => ['startup', 'active', 'recovery'].includes(m.kind));
    for (const m of phases) {
      ctx.fillStyle = MARK_COLORS[m.kind];
      ctx.globalAlpha = 0.75;
      ctx.fillRect(X(m.from), 0, Math.max(1, X(m.to + 1) - X(m.from)), h * 0.42);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0c0714';
      if (X(m.to + 1) - X(m.from) > 50 * k) ctx.fillText(`${m.label} ${m.from}–${m.to}`, X(m.from) + 4 * k, h * 0.21);
    }
    const rest = marks.filter((m) => !phases.includes(m));
    const lanes = Math.max(1, Math.min(4, rest.length));
    rest.forEach((m, i) => {
      const y = h * 0.48 + (i % lanes) * ((h * 0.5) / lanes);
      ctx.fillStyle = MARK_COLORS[m.kind] || '#fff';
      ctx.fillRect(X(m.from), y, Math.max(2 * k, X(m.to + 1) - X(m.from)), (h * 0.5) / lanes - 2 * k);
    });
    cv.title = marks.map((m) => `${m.label}: ${m.from}–${m.to}`).join('\n');
  } else {
    ctx.fillStyle = '#ffffff22';
    ctx.fillRect(0, 0, w, h * 0.42);
    cv.title = '';
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(X(L.frame) - k, 0, 2 * k, h);
}

function focusInfo(r) {
  const box = $('#focus-info');
  const def = focusDef();
  const rows = [];
  const kv = (k, v) => rows.push(`<div><span class="k">${k}</span> ${v}</div>`);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  rows.push(`<b>${esc(L.focus.key)}</b>`);
  if (def) {
    const m = L.moves.get(L.focus.key);
    kv('category', esc(def.category));
    kv('routes', esc(m?.routes.join(', ') || (def.generic ? 'engine generic' : 'cancel/next only')));
    kv('frames', `${def.duration} (startup ${def.startup}, active ${def.activeEnd >= def.startup ? `${def.startup}–${def.activeEnd}` : '—'})`);
    if (r?.view?.move) kv('phase', `${r.view.move.phase} ${(r.view.move.phaseT * 100).toFixed(0)}%`);
    if (def.anim) kv('anim', esc(def.anim));
    for (const [i, hb] of (def.hitboxes || []).entries()) kv(`hit #${i}`, `f${hb.start}–${hb.end} · ${hb.damage ?? '?'}% · ∠${hb.angle ?? '?'} · kb ${hb.baseKb ?? hb.knockback ?? '?'}${hb.kind && hb.kind !== 'strike' ? ` · ${hb.kind}` : ''}`);
    const spawns = (def.timeline || []).filter((e) => e.action === 'spawn');
    if (spawns.length) kv('spawns', esc(spawns.map((e) => `${e.args?.entity || e.args?.name || '?'}@${e.at ?? e.from}`).join(', ')));
    const notes = (L.entry.notes || []).filter((n) => String(n.message || n).includes(L.focus.key));
    if (notes.length) kv('balancer', esc(notes.map((n) => n.message || n).join(' · ')));
  } else if (L.focus.kind === 'entity') {
    const d = L.ir.entities[L.focus.key];
    kv('kind', esc(d.kind)); kv('life', d.life === Infinity ? 'permanent' : d.life); if (d.hp) kv('hp', d.hp);
    kv('art', L.host.hasEntityArt(L.focus.key, L.form) ? 'art.entities draw' : '<span style="color:var(--warn)">fallback (no art.entities draw)</span>');
  } else kv('state', esc(L.focus.view?.state || L.focus.key));
  if (r?.error) rows.push(`<div style="color:var(--bad)">draw threw: ${esc(r.error.message || r.error)}</div>`);
  if (r?.info) kv('hurtboxes', `${r.info.hurtboxes.length} shape(s)` + (r.info.hitboxes.length ? ` · <span style="color:#ff4d6a">${r.info.hitboxes.length} active hit</span>` : ''));
  box.innerHTML = rows.join('');
}

// ── Controls ────────────────────────────────────────────────────────────────
function slider(parent, label, min, max, step, value, on) {
  const inp = el('input', { type: 'range', min, max, step, value });
  const out = el('output', { textContent: value });
  inp.addEventListener('input', () => { out.textContent = inp.value; on(+inp.value); });
  parent.append(el('div', { className: 'row' }, el('span', { textContent: label }), inp, out));
}

function buildControls() {
  const ir = L.ir;
  // forms
  const fs = $('#form');
  fs.innerHTML = '';
  for (const f of ir.tables.forms) fs.add(new Option(f, f));
  fs.value = L.form;
  fs.disabled = ir.tables.forms.length < 2;
  // palettes
  const ps = $('#palette');
  ps.innerHTML = '';
  const alts = L.host.artFor(L.form).palettes;
  const n = Array.isArray(alts) && alts.length ? alts.length : 1;
  for (let i = 0; i < n; i++) ps.add(new Option(i ? `alt ${i}` : 'main', i));
  L.ordinal = Math.min(L.ordinal, n - 1);
  ps.value = L.ordinal;
  // body
  const body = $('#body-ctl');
  body.innerHTML = '';
  const range = ir.forms[L.form]?.body?.scaleRange || [1, 1];
  L.bodyScale = Math.min(range[1], Math.max(range[0], L.bodyScale));
  if (range[1] > range[0]) slider(body, 'bodyScale', range[0], range[1], 0.01, L.bodyScale, (v) => { L.bodyScale = v; });
  else body.append(el('small', { textContent: 'fixed body scale (scaleRange [1, 1])' }));
  const col = ir.forms[L.form]?.body?.collider;
  if (col) body.append(el('div', { className: 'row' }, el('span', { textContent: 'collider' }), el('span', { textContent: `${col.w} × ${col.h}` }), el('output')));
  // resources + vars
  const rc = $('#res-ctl');
  rc.innerHTML = '';
  L.res = {}; L.vars = {};
  for (const name of ir.tables.resources) {
    const d = ir.resources[name];
    L.res[name] = d.start ?? 0;
    slider(rc, name, d.min ?? 0, d.max ?? 100, (d.max ?? 100) > 20 ? 1 : 0.1, L.res[name], (v) => { L.res[name] = v; });
  }
  for (const [name, v0] of Object.entries(ir.vars || {})) {
    L.vars[name] = v0;
    if (typeof v0 === 'number') {
      const span = Math.max(10, Math.abs(v0) * 4);
      slider(rc, `var ${name}`, Math.min(0, v0 - span), v0 + span, Number.isInteger(v0) ? 1 : 0.1, v0, (v) => { L.vars[name] = v; });
    } else if (typeof v0 === 'boolean') {
      const cb = el('input', { type: 'checkbox', checked: v0 });
      cb.addEventListener('change', () => { L.vars[name] = cb.checked; });
      rc.append(el('div', { className: 'row' }, el('span', { textContent: `var ${name}` }), cb, el('output')));
    } else {
      const ti = el('input', { type: 'text', value: String(v0) });
      ti.addEventListener('input', () => { L.vars[name] = ti.value; });
      rc.append(el('div', { className: 'row' }, el('span', { textContent: `var ${name}` }), ti, el('output')));
    }
  }
  if (!rc.childNodes.length) rc.append(el('small', { textContent: 'no resources or vars' }));
  // statuses
  const sc = $('#status-ctl');
  sc.innerHTML = '';
  L.statuses.clear();
  const names = [...new Set([...(ir.tables.statuses || []), ...Object.keys(BUILTIN_STATUSES)])].sort();
  for (const s of names) {
    const cb = el('input', { type: 'checkbox' });
    cb.addEventListener('change', () => { if (cb.checked) L.statuses.add(s); else L.statuses.delete(s); L.sandbox?.toggleStatus(s, cb.checked); });
    const custom = !BUILTIN_STATUSES[s];
    sc.append(el('label', { title: custom ? 'custom status' : 'built-in status' }, cb, custom ? el('b', { textContent: s }) : s));
  }
}

function buildPortraits() {
  const box = $('#portraits');
  box.innerHTML = '';
  const alts = L.host.artFor(L.form).palettes;
  const n = Array.isArray(alts) && alts.length ? alts.length : 1;
  for (const size of [128, 64]) {
    for (let i = 0; i < n; i++) {
      const src = L.host.portrait(size, i, { dpr: dpr(), form: L.form });
      const c = el('canvas', { width: size * dpr(), height: size * dpr(), title: `${size}px · palette ${i}` });
      c.style.width = c.style.height = `${size}px`;
      if (src) c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      c.style.borderColor = PLAYER_COLORS[i % PLAYER_COLORS.length];
      box.append(c);
    }
  }
}

function buildNotes() {
  const e = L.entry;
  const lines = (e.notes || []).map((n) => `• ${n.code ? `${n.code} ` : ''}${n.message || n}`);
  if (e.assetsFailed?.length) lines.unshift(`⚠ assets unavailable (art receives null): ${e.assetsFailed.join(', ')}`);
  $('#notes').textContent = lines.length ? lines.join('\n') : 'No auto-balance adjustments.';
}

// ── Checks ──────────────────────────────────────────────────────────────────
function showChecks(res) {
  const body = $('#checks-body');
  const badge = $('#badge');
  const w = res.warnings;
  badge.className = w.length ? 'warn' : 'ok';
  badge.textContent = w.length ? `${w.length} warning${w.length > 1 ? 's' : ''}` : 'checks clean';
  const m = res.measures;
  const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  const summary = el('ul', {},
    el('li', { textContent: `hitbox coverage (worst): ${m.coverage.length ? pct(Math.min(...m.coverage.map((c) => c.coverage))) : 'no active hitboxes'} (warn < 15%)` }),
    el('li', { textContent: `hurtbox fit: ${pct(m.fit?.outside)} outside (warn > 45%), ${pct(m.fit?.empty)} empty (warn > 30%)` }),
    el('li', { textContent: `contrast: L* ${m.silhouetteL?.toFixed(0) ?? '—'} vs stage ${m.stageL?.toFixed(0) ?? '—'} (warn ΔL < 12)` }),
    el('li', { textContent: `perf: ${m.perfMs != null ? m.perfMs.toFixed(2) : '—'} ms/draw (warn > 2, low quality > 4)${m.headless ? ' — headless, informational' : ''}` }),
  );
  const list = el('ul');
  for (const x of w) list.append(el('li', { className: x.check, textContent: `[${x.check}] ${x.message}` }));
  body.innerHTML = '';
  body.append(w.length ? list : el('div', { textContent: '✓ no warnings', style: 'color:var(--ok)' }), el('details', {}, el('summary', { textContent: 'measures' }), summary));
  $('#checks-time').textContent = `${Math.round(m.checkMs || 0)} ms`;
}

async function doChecks() {
  $('#checks-body').textContent = 'running…';
  let res;
  try {
    res = runChecks(L.host, { stage, form: L.form, palette: L.host.palette(L.form, L.ordinal) });
  } catch (e) {
    res = { warnings: [{ check: 'error', where: 'lab', message: `checks failed: ${e.message}` }], measures: { coverage: [], edges: [] } };
    console.error(e);
  }
  // Headless Chrome is CPU-throttled: its draw timings are not the player's. Report, don't warn.
  if (HEADLESS) {
    res.info = res.warnings.filter((w) => w.check === 'perf').map((w) => ({ ...w, message: `${w.message} [headless timing, informational]` }));
    res.warnings = res.warnings.filter((w) => w.check !== 'perf');
    res.measures.headless = true;
  }
  L.checks = res;
  showChecks(res);
  window.__lab.checks = res;
  return res;
}

async function doSheet() {
  const out = $('#sheet-out');
  out.textContent = 'building…';
  const canvas = contactSheet(L.host, { form: L.form, palette: L.host.palette(L.form, L.ordinal), ordinal: L.ordinal, boxes: $('#boxes').checked });
  const img = el('img', { src: canvas.toDataURL('image/png'), alt: 'contact sheet' });
  try {
    const r = await postSheet(canvas, L.entry.id);
    out.innerHTML = '';
    out.append(el('div', { textContent: `saved ${r.path} (${Math.round(r.bytes / 1024)} KB)` }), img);
    window.__lab.sheet = r;
    document.title = `SHEET OK ${L.entry.id}`;
  } catch (e) {
    out.innerHTML = '';
    out.append(el('div', { textContent: `not saved (${e.message}) — dev routes run only when NODE_ENV !== 'production'`, style: 'color:var(--warn)' }), img);
    window.__lab.sheet = { error: e.message };
    document.title = `SHEET FAIL ${L.entry.id}`;
  }
}

// ── Sandbox (lazy) ──────────────────────────────────────────────────────────
async function openSandbox() {
  if (L.sandbox) { L.sandbox.start(); return; }
  if (L.sandboxLoading) return;
  L.sandboxLoading = true;
  try { await buildSandbox(); } finally { L.sandboxLoading = false; }
}
async function buildSandbox() {
  trace('sandbox: import');
  const { Sandbox } = await import('./lab/sandbox.js');
  trace('sandbox: imported');
  const dummyId = ['bastion', 'ember'].find((d) => L.list.has(d) && d !== L.entry.id);
  const dummy = dummyId ? await ensure(dummyId).catch(() => L.entry) : L.entry;
  const characters = new Map(L.roster);
  characters.set(L.entry.id, L.entry);
  const log = $('#govlog');
  L.sandbox = new Sandbox($('#sandbox-canvas'), {
    characters, entry: L.entry, dummy, stage, boxes: $('#boxes').checked,
    onLog: ({ frame, text, kind }) => {
      log.append(el('div', { className: kind, textContent: `${String(frame).padStart(5)} ${text}` }));
      while (log.childNodes.length > 300) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    },
  });
  trace('sandbox: built');
  L.sandbox.dummyPercent = +$('#dummy-pct').value;
  const mv = $('#sb-moves'), sp = $('#sb-spawns');
  mv.innerHTML = ''; sp.innerHTML = '';
  for (const m of core.moveList(L.ir)) mv.append(el('button', { textContent: m.name, title: m.routes.join(', '), onclick: () => L.sandbox.perform(m.name) }));
  for (const n of L.ir.tables.entities.filter((x) => !L.ir.entities[x].legacy)) sp.append(el('button', { textContent: n, onclick: () => L.sandbox.spawnEntity(n) }));
  if (!sp.childNodes.length) sp.append(el('small', { textContent: 'no entities' }));
  L.sandbox.setForm(L.form);
  L.sandbox.start();
  if (P.sbmove && L.ir.moves[P.sbmove]) L.sandbox.repeat = P.sbmove;
}
function sandboxError(err) {
  console.error(err);
  $('#govlog').append(el('div', { className: 'err', textContent: `sandbox failed: ${err.message}\n${err.stack || ''}` }));
}
function closeSandbox() { L.sandbox?.stop(); L.sandbox = null; }

// ── Showcase (live mode only: it runs its own rAF loop) ──────────────────────
async function startShowcase() {
  if (P.still) return;
  const { Showcase } = await import('./ui/showcase.js');
  L.showcases ||= [new Showcase($('#showcase'), { color: PLAYER_COLORS[0] }), new Showcase($('#showcase-half'), { color: PLAYER_COLORS[1] })];
  for (const [i, sc] of L.showcases.entries()) sc.set(L.entry, PLAYER_COLORS[i]);
}

// ── Character switch ────────────────────────────────────────────────────────
async function setChar(id, { keepUrl = false } = {}) {
  closeSandbox();
  $('#sandbox-box').open = false;
  $('#checks-body').textContent = `loading ${id}…`;
  const entry = await ensure(id);
  L.entry = entry;
  L.host = entry.host || (entry.host = new ArtHost(entry, { lab: true }));
  L.host.lab = true;
  L.ir = L.host.model.ir;
  const forms = L.ir.tables.forms;
  L.form = forms.includes(P.form) ? P.form : L.host.model.startForm;
  P.form = null;
  if (!keepUrl) {
    const q = new URLSearchParams(location.search);
    q.delete('src'); q.delete('char');
    if (entry.fixture) q.set('src', entry.fixture); else q.set('char', id);
    history.replaceState(null, '', `?${q}`);
  }
  document.title = `Art Lab — ${L.host.model.name}`;
  if (L.showcases) for (const [i, sc] of L.showcases.entries()) sc.set(entry, PLAYER_COLORS[i]);
  rebuild();
}

function rebuild() {
  buildControls();
  buildGallery();
  buildPortraits();
  buildNotes();
  const ml = core.moveList(L.ir);
  const inForm = (m) => m.routes.length && (L.ir.tables.forms.length < 2 || m.routes.some((r) => r.startsWith(`${L.form}:`)));
  const want = P.frame != null ? ml.find(inForm) || ml[0] : null; // first move of the shown form
  setFocus(want ? { kind: 'move', key: want.name } : { kind: 'state', key: 'idle', view: { state: 'idle' } });
}

// ── Loop ────────────────────────────────────────────────────────────────────
function renderAll() {
  const o = opt();
  let sum = 0, n = 0;
  for (const c of L.cells) {
    const ms = drawCell(c, L.t, o);
    if (Number.isFinite(ms)) { sum += ms; n++; }
  }
  if (n) {
    const p = L.perf;
    const m = sum / n;
    p.avg = p.n++ < 10 ? m : p.avg * 0.9 + m * 0.1;
    const el_ = $('#perf');
    el_.textContent = `draw ${p.avg.toFixed(2)} ms · ${L.cells.length} tiles`;
    el_.className = p.avg > 4 ? 'low' : p.avg > 2 ? 'slow' : '';
  }
  renderFocus();
}

function frameLoop() {
  const sp = +$('#speed').value;
  L.acc += sp;
  while (L.acc >= 1) {
    L.acc--;
    L.t++;
    if (L.playing) L.frame = (L.frame + 1) % Math.max(1, focusLength());
  }
  if (L.pendingChecks) { L.pendingChecks = false; doChecks().then(() => { if (P.sheet) doSheet(); }); } // in-frame: timers can starve under rAF load
  if (L.t !== L.drawnT || L.dirty) { L.drawnT = L.t; L.dirty = false; renderAll(); } // paused: redraw only on changes
  requestAnimationFrame(frameLoop);
}

// ── Wiring ──────────────────────────────────────────────────────────────────
function wire() {
  $('#char').addEventListener('change', (e) => setChar(e.target.value).catch(loadError));
  $('#form').addEventListener('change', (e) => { L.form = e.target.value; rebuild(); L.sandbox?.setForm(L.form); });
  $('#palette').addEventListener('change', (e) => { L.ordinal = +e.target.value; buildPortraits(); });
  $('#run-checks').addEventListener('click', doChecks);
  $('#sheet-btn').addEventListener('click', doSheet);
  $('#play').addEventListener('click', () => { L.playing = !L.playing; });
  const step = (d) => { L.playing = false; const n = Math.max(1, focusLength()); L.frame = (L.frame + d + n) % n; renderFocus(); };
  $('#step-back').addEventListener('click', () => step(-1));
  $('#step-fwd').addEventListener('click', () => step(1));
  $('#frame').addEventListener('input', (e) => { L.playing = false; L.frame = +e.target.value; renderFocus(); });
  $('#strike').addEventListener('click', () => { const d = focusDef(); if (d) { L.playing = false; L.frame = core.strikeFrame(d); renderFocus(); } });
  $('#phase-bar').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    L.playing = false;
    L.frame = Math.max(0, Math.min(focusLength() - 1, Math.floor(((e.clientX - r.left) / r.width) * focusLength())));
    renderFocus();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input[type=text], input[type=number], select')) return;
    if (e.key === ' ') { e.preventDefault(); L.playing = !L.playing; }
    else if (e.key === ',') step(-1);
    else if (e.key === '.') step(1);
    else if (e.key === 'b') $('#boxes').click();
  });
  $('#boxes').addEventListener('change', () => { if (L.sandbox) L.sandbox.renderer.showHitboxes = $('#boxes').checked; });
  $('#sandbox-box').addEventListener('toggle', (e) => {
    if (!e.target.open) { L.sandbox?.stop(); return; }
    openSandbox().catch(sandboxError);
  });
  // Any control change → redraw (the loop skips redraws while paused).
  for (const ev of ['input', 'change', 'click']) document.addEventListener(ev, () => { L.dirty = true; });
  $('#dummy-pct').addEventListener('input', (e) => { $('#dummy-pct-out').textContent = e.target.value; if (L.sandbox) L.sandbox.dummyPercent = +e.target.value; });
  $('#sb-reset').addEventListener('click', () => L.sandbox?.reset());
  $('#sb-clear').addEventListener('click', () => { $('#govlog').innerHTML = ''; });
}

function loadError(e) { console.error(e); $('#checks-body').textContent = `load failed: ${e.message}`; }

// ── Boot ────────────────────────────────────────────────────────────────────
window.__lab = { ready: false, params: P, trace: [], get state() { return L; } };
function trace(msg) { window.__lab.trace.push(`${Math.round(performance.now())} ${msg}`); }
async function boot() {
  $('#boxes').checked = P.boxes;
  $('#sil').checked = P.silhouette;
  $('#half').checked = P.half;
  const sp = $('#speed');
  if ([...sp.options].some((o) => +o.value === P.speed)) sp.value = String(P.speed);
  trace('boot');
  const list = await fetch('/api/characters').then((r) => r.json());
  for (const x of list) {
    const it = typeof x === 'string' ? { id: x, hash: null } : x;
    if (it && typeof it.id === 'string') L.list.set(it.id, { id: it.id, hash: it.hash || null });
  }
  let fixtureId = null;
  if (P.src) {
    fixtureId = P.src.split('/').filter(Boolean).pop();
    L.list.set(fixtureId, { id: fixtureId, src: P.src });
  }
  const sel = $('#char');
  const real = el('optgroup', { label: 'roster' });
  const fx = el('optgroup', { label: 'fixtures' });
  for (const [id, it] of [...L.list].sort((x, y) => x[0].localeCompare(y[0]))) (it.src ? fx : real).append(new Option(id, id));
  sel.append(real);
  if (fx.childNodes.length) sel.append(fx);
  const first = fixtureId || (P.char && L.list.has(P.char) ? P.char : [...L.list.keys()].sort()[0]);
  if (!first) { $('#checks-body').textContent = 'no characters listed'; return; }
  sel.value = first;
  wire();
  await setChar(first, { keepUrl: !!fixtureId && !P.char });
  renderAll();
  window.__lab.ready = true;
  trace('ready');
  if (P.still) {
    // One render only: headless screenshots finish. Optional checks / sheet afterwards.
    if (P.checks) {
      const res = await doChecks();
      try {
        await fetch(`/dev/art-check/${encodeURIComponent(L.entry.id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: L.entry.id, warnings: res.warnings, info: res.info || [], measures: res.measures }) });
      } catch { /* dev routes off */ }
    } else { $('#checks-body').textContent = 'skipped in still mode (add &checks=1)'; $('#badge').textContent = 'checks off'; }
    if (P.sheet) await doSheet();
    if (!P.sheet) document.title = `LAB READY ${L.entry.id}`;
    return;
  }
  requestAnimationFrame(frameLoop);
  startShowcase();
  if (P.sandbox || P.sbmove) { $('#sandbox-box').open = true; openSandbox().catch(sandboxError); }
  L.pendingChecks = true;
}

const booting = boot().catch((e) => {
  console.error(e);
  document.title = 'LAB ERROR';
  $('#checks-body').textContent = `Lab failed: ${e.message}`;
}).finally(() => {
  window.__lab.done = true;
  if (window.__labHold) fetch(`/dev/release/${window.__labHold}`, { method: 'POST' }).catch(() => {}); // lets the load event fire
});
// Still mode: top-level await holds the window load event until the render (and any
// checks / sheet) is done, so `chrome --headless --screenshot` captures the finished page.
if (P.still) await booting;
