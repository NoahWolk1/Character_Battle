#!/usr/bin/env node
// Migrate a v1 character file to v2 syntax (spec §8). Optional: v1 files keep
// working forever; migrate when you want v2 features (forms, entities, hooks...).
//   npm run migrate -- <id>            → rewrite characters/<id>/character.js (only if the result loads)
//   npm run migrate -- <id> --stdout   → print the migrated file, change nothing
//   npm run migrate -- <id> --check    → report what would change, change nothing (alias --dry-run)
//   Before rewriting, the original is copied to .cache/migrate/<id>.v1.<time>.js (next to characters/).
//   --dir <path>                       → character folders live somewhere else (tests)
//
// What it does (the data comes from normalizeV1, so behavior matches the v1 load):
//  - wraps the export in defineCharacter(...) and adds the api.js import;
//  - stats.width/height → body (collider + default/crouch rect hurtboxes);
//  - move projectiles → entities `${slot}#p${i}` + `spawn` timeline entries;
//  - v1 implicit rules become explicit: hitbox group 0, upSpecial helpless,
//    sideSpecial oncePerAirtime, smash charge, default anims/effects/positions.
// Functions (art, pose, ...) keep their original source text; everything outside
// the exported object (imports, helpers, comments) is untouched. Fields v1 ignored
// are dropped. NOTE: a v2 file is balanced by the v2 rules (reach measured from the
// body, v2 KO estimate), so some numbers may scale differently; the report lists
// the notes before and after so you can retune.
import * as acorn from 'acorn';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeV1, isV1 } from '../shared/char/normalize-v1.js';
import { validateCharacter } from '../shared/balance/validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAR_DIR = join(ROOT, 'characters');
const API_IMPORT = "import { defineCharacter } from '../../shared/char/api.js';";

// ── literal printer (2-space, single quotes, short values on one line) ─────────
const IDENT = /^[A-Za-z_$][\w$]*$/;
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
const keyText = (k) => (IDENT.test(k) ? k : quote(k));

/**
 * @param {*} v value
 * @param {string} ind current indentation
 * @param {(path: string[], v: *) => string|undefined} raw  original source for a path (functions etc.)
 * @param {string[]} path
 */
export function printValue(v, ind = '', raw = () => undefined, path = []) {
  const r = raw(path, v);
  if (r !== undefined) return r;
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? '0' : String(v)) : 'null';
  if (typeof v === 'string') return quote(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'function') return String(v); // no source text available: best effort
  const inner = ind + '  ';
  if (Array.isArray(v)) {
    const parts = v.map((x, i) => printValue(x, inner, raw, [...path, String(i)]));
    const one = `[${parts.join(', ')}]`;
    return one.length <= 120 && !one.includes('\n') ? one : `[\n${parts.map((p) => inner + p).join(',\n')},\n${ind}]`;
  }
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  if (!entries.length) return '{}';
  const parts = entries.map(([k, x]) => { const t = printValue(x, inner, raw, [...path, k]); return t === k ? k : `${keyText(k)}: ${t}`; });
  const one = `{ ${parts.join(', ')} }`;
  return one.length <= 120 && !one.includes('\n') ? one : `{\n${parts.map((p) => inner + p).join(',\n')},\n${ind}}`;
}

// ── source analysis ──────────────────────────────────────────────────────────
const propKey = (p) => (p.type === 'Property' && !p.computed ? (p.key.name ?? String(p.key.value)) : null);
const propMap = (obj) => new Map(obj.properties.map((p) => [propKey(p), p]).filter(([k]) => k !== null));

/** Pure data: literals, arrays/objects of literals, negative numbers, plain templates. */
function isData(n) {
  if (!n) return true;
  switch (n.type) {
    case 'Literal': return !n.regex;
    case 'UnaryExpression': return (n.operator === '-' || n.operator === '+') && isData(n.argument);
    case 'TemplateLiteral': return n.expressions.length === 0;
    case 'ArrayExpression': return n.elements.every((e) => e && e.type !== 'SpreadElement' && isData(e));
    case 'ObjectExpression': return n.properties.every((p) => p.type === 'Property' && !p.computed && !p.method && isData(p.value));
    default: return false;
  }
}

/** Init node of a top-level `const name = ...`, or null. */
function constInit(ast, name) {
  for (const st of ast.body) {
    const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
    if (d?.type !== 'VariableDeclaration') continue;
    const v = d.declarations.find((x) => x.id.type === 'Identifier' && x.id.name === name);
    if (v?.init) return v.init;
  }
  return null;
}

/** Finds the exported object literal. → {ast, obj, exportNode, wrapped} */
function findDefault(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const exp = ast.body.find((s) => s.type === 'ExportDefaultDeclaration');
  if (!exp) throw new Error('no `export default` in character.js');
  let decl = exp.declaration;
  if (decl.type === 'CallExpression') return { ast, obj: null, exp, wrapped: true };
  if (decl.type === 'Identifier') {
    const name = decl.name;
    for (const st of ast.body) {
      const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
      if (d?.type !== 'VariableDeclaration') continue;
      const v = d.declarations.find((x) => x.id.type === 'Identifier' && x.id.name === name);
      if (v?.init) { decl = v.init; break; }
    }
  }
  if (decl.type !== 'ObjectExpression') throw new Error('`export default` is not an object literal; migrate by hand (see docs/CHARACTER_GUIDE.md)');
  return { ast, obj: decl, exp, wrapped: false };
}

/**
 * Migrated source text for a v1 module. `def` is the evaluated default export.
 * @returns {{src: string, notes: string[]}}
 */
export function migrateSource(src, def, { expectedId } = {}) {
  if (!isV1(def)) throw new Error('already a v2 character (it uses defineCharacter or version: 2)');
  const { ast, obj, exp, wrapped } = findDefault(src);
  if (wrapped || !obj) throw new Error('already wrapped in a call; nothing to migrate');
  const { draft, errors } = normalizeV1(def, { expectedId });
  if (!draft) throw new Error(errors.map((e) => e.why).join('; '));
  const notes = [];
  const text = (n) => src.slice(n.start, n.end);

  // Source text for non-data values (functions, imported art, helper calls) is kept verbatim.
  const top = propMap(obj);
  // `moves: moves` pointing at a module const: rewrite the const in place and keep the reference.
  const movesVal = top.get('moves')?.value;
  const movesConst = movesVal?.type === 'Identifier' ? constInit(ast, movesVal.name) : null;
  const movesObj = movesVal?.type === 'ObjectExpression' ? movesVal : movesConst?.type === 'ObjectExpression' ? movesConst : null;
  const movesNode = movesObj ? propMap(movesObj) : new Map();
  const raw = (path, v) => {
    if (path.length === 1 && path[0] === 'art') { const p = top.get('art'); return p ? text(p.value) : undefined; }
    if (path.length === 1 && path[0] === 'moves' && movesObj && movesObj !== movesVal) return movesVal.name;
    if (path.length === 3 && path[0] === 'moves' && (path[2] === 'pose' || path[2] === 'sound')) {
      const m = movesNode.get(path[1]);
      if (!m || m.value.type !== 'ObjectExpression') return undefined;
      const p = propMap(m.value).get(path[2]);
      return p && !isData(p.value) ? text(p.value) : undefined;
    }
    return undefined;
  };

  // Strip v1 bookkeeping, nulls and engine-only fields from the draft.
  const out = { ...draft };
  delete out.legacy;
  delete out.version; // defineCharacter adds it
  for (const e of Object.values(out.entities)) {
    delete e.legacy;
    if (e.render) for (const k of Object.keys(e.render)) if (e.render[k] === null) delete e.render[k];
  }
  if (!Object.keys(out.entities).length) delete out.entities;
  for (const m of Object.values(out.moves)) {
    if (!m.velocity?.length) delete m.velocity;
    else for (const v of m.velocity) { if (v.vx === null) delete v.vx; if (v.vy === null) delete v.vy; }
  }
  // Keep the author's top-level order where possible: id, name, author, description, body, stats, entities, moves, art.
  const order = ['id', 'name', 'author', 'description', 'body', 'stats', 'entities', 'moves', 'art'];
  const ordered = {};
  for (const k of order) if (out[k] !== undefined) ordered[k] = out[k];
  for (const k of Object.keys(out)) if (!(k in ordered)) ordered[k] = out[k];

  for (const k of Object.keys(def)) if (!['id', 'name', 'author', 'description', 'stats', 'moves', 'art', 'version'].includes(k)) notes.push(`dropped top-level "${k}" (v1 ignored it)`);
  for (const k of Object.keys(def.moves || {})) if (!draft.moves[k]) notes.push(`dropped moves.${k} (not a v1 slot, never used)`);
  for (const [slot, m] of Object.entries(draft.moves)) {
    if (m.timeline?.length) notes.push(`moves.${slot}: ${m.timeline.length} projectile(s) → entities + spawn timeline`);
  }
  for (const [k, p] of top) {
    if (k === 'art' || k === 'moves' || isData(p.value)) continue;
    notes.push(`"${k}" was computed by code; written out as its evaluated data`);
  }

  const lineStart = src.lastIndexOf('\n', obj.start) + 1;
  const baseInd = (src.slice(lineStart, obj.start).match(/^\s*/) || [''])[0];
  const objText = printValue(ordered, baseInd, raw, []);

  // Edits, applied back to front.
  const edits = [];
  if (movesObj && movesObj !== movesVal) {
    const ls = src.lastIndexOf('\n', movesObj.start) + 1;
    const ind = (src.slice(ls, movesObj.start).match(/^\s*/) || [''])[0];
    edits.push({ start: movesObj.start, end: movesObj.end, text: printValue(out.moves, ind, (pa, v) => (pa.length === 1 ? undefined : raw(pa, v)), ['moves']) });
  }
  if (exp.declaration === obj) edits.push({ start: obj.start, end: obj.end, text: `defineCharacter(${objText})` });
  else {
    edits.push({ start: obj.start, end: obj.end, text: objText });
    edits.push({ start: exp.declaration.start, end: exp.declaration.end, text: `defineCharacter(${text(exp.declaration)})` });
  }
  const hasApi = ast.body.some((s) => s.type === 'ImportDeclaration' && s.specifiers.some((x) => x.local.name === 'defineCharacter'));
  if (!hasApi) {
    const imports = ast.body.filter((s) => s.type === 'ImportDeclaration');
    if (imports.length) edits.push({ start: imports[0].start, end: imports[0].start, text: `${API_IMPORT}\n` });
    else {
      const first = ast.body[0];
      edits.push({ start: first.start, end: first.start, text: `${API_IMPORT}\n\n` });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let res = src;
  for (const e of edits) res = res.slice(0, e.start) + e.text + res.slice(e.end);
  return { src: res, notes };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const noteKey = (n) => `${n.code} ${n.path}`;

/** Migrates one folder. Never writes unless the migrated file validates. */
export async function migrateFolder(id, { dir = CHAR_DIR, write = true } = {}) {
  const file = join(dir, id, 'character.js');
  if (!existsSync(file)) throw new Error(`no ${file}`);
  const src = readFileSync(file, 'utf8');
  const mod = await import(`${pathToFileURL(file).href}?migrate=${Date.now()}`);
  const before = validateCharacter(mod.default, { expectedId: id });
  const { src: next, notes } = migrateSource(src, mod.default, { expectedId: id });
  // Load the migrated text next to the original so relative imports resolve.
  const tmp = join(dir, id, `.migrate-check-${process.pid}.js`);
  let after;
  try {
    writeFileSync(tmp, next);
    const m2 = await import(`${pathToFileURL(tmp).href}?v=${Date.now()}`);
    after = validateCharacter(m2.default, { expectedId: id });
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
  const prev = new Set(before.notes.filter((n) => n.severity !== 'info').map(noteKey));
  const added = after.notes.filter((n) => n.severity !== 'info' && !prev.has(noteKey(n)));
  const ok = after.ok;
  let backup = null;
  if (ok && write) {
    const bdir = join(dir, '..', '.cache', 'migrate');
    mkdirSync(bdir, { recursive: true });
    backup = join(bdir, `${id}.v1.${Date.now()}.js`);
    writeFileSync(backup, src);
    writeFileSync(file, next);
  }
  return { ok, file, backup, src: next, notes, errors: after.errors, added, sourceVersion: after.character?.sourceVersion ?? after.character?.meta?.sourceVersion };
}

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const dir = dirIdx >= 0 ? resolve(args[dirIdx + 1]) : CHAR_DIR;
  const ids = args.filter((a, i) => !a.startsWith('--') && !(dirIdx >= 0 && i === dirIdx + 1));
  const stdout = args.includes('--stdout');
  const check = args.includes('--check') || args.includes('--dry-run');
  const unknown = args.filter((a) => a.startsWith('--') && !['--dir', '--stdout', '--check', '--dry-run'].includes(a));
  if (unknown.length) { console.error(`✘ unknown option ${unknown.join(', ')} (nothing written). Options: --stdout, --check (--dry-run), --dir <path>`); process.exitCode = 1; return; }
  if (!ids.length) { console.error('Usage: npm run migrate -- <id> [--stdout | --check]'); process.exitCode = 1; return; }
  for (const id of ids) {
    let r;
    try { r = await migrateFolder(id, { dir, write: !stdout && !check }); } catch (e) { console.error(`✘ ${id}: ${e.message}`); process.exitCode = 1; continue; }
    if (stdout) { process.stdout.write(r.src); continue; }
    if (!r.ok) {
      console.error(`✘ ${id}: the migrated file doesn't validate, nothing written:`);
      for (const e of r.errors) console.error(`  ${e.code || ''} ${e.path || ''} ${e.why || e}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`${check ? '…' : '✔'} ${id}: ${check ? 'would migrate' : 'migrated'} ${r.file.replace(ROOT + '/', '')} to v2 syntax`);
    for (const n of r.notes) console.log(`  · ${n}`);
    if (r.added.length) {
      console.log(`  New balance notes under the v2 rules (retune, or keep the v1 file):`);
      for (const n of r.added) console.log(`    ${n.code} ${n.path}: ${n.why}`);
    } else console.log('  No new balance notes.');
    if (!check) console.log(`  Backup of the v1 file: ${r.backup.replace(ROOT + '/', '')}\n  Next: npm run validate -- ${id} --explain, then npm test.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
