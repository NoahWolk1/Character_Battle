#!/usr/bin/env node
// Character lint (spec §5.4). Static checks that catch accidents and over-eager
// "help" before a character ever runs. Every finding is an E020 note (lint
// failure, CI only) with a rule id, the exact file:line:col and a fix.
//   npm run lint                         → every folder in characters/ (including _template)
//   npm run lint -- ember gloop          → just those folders
//   npm run lint -- --dir test/fixtures  → folders in another directory
//   --json                               → {folder: notes[]}
//   --markdown                           → a GitHub step-summary table
// Exit code 1 if any folder has an error.
import * as acorn from 'acorn';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep, basename, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finishNote } from '../shared/balance/v2/report.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CHAR_DIR = join(ROOT, 'characters');

// ── rule tables ──────────────────────────────────────────────────────────────
/** Banned in every file, every position (spec §5.4 plus the same-family storage/timer APIs). */
const BANNED_GLOBALS = new Set([
  'process', 'require', 'globalThis', 'global', 'eval', 'Function', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'Atomics', 'SharedArrayBuffer',
  'localStorage', 'sessionStorage', 'indexedDB', 'importScripts', 'module', 'exports', '__dirname', '__filename',
]);
/** Banned inside sim-reachable code and in code that runs at import time. */
const NONDETERMINISTIC = new Set(['Date', 'performance', 'crypto']);
/** Browser objects: only inside functions in art files or reachable from `art`. */
const BROWSER = new Set(['window', 'document', 'Image', 'Audio', 'navigator', 'location']);
/** Keys of the character def whose function values are client-only (never sim-reachable). */
const CLIENT_KEYS = new Set(['art', 'pose', 'anim', 'portrait', 'draw', 'drawProjectile']);
/** Globals a top-level initializer may call. */
const TOP_CALL_GLOBALS = new Set(['Number', 'String', 'Boolean', 'Array', 'parseInt', 'parseFloat', 'isFinite', 'isNaN', 'Symbol']);
const TOP_CALL_STATIC = {
  Object: new Set(['freeze', 'keys', 'values', 'entries', 'fromEntries', 'assign', 'isFrozen', 'create', 'defineProperty', 'defineProperties']),
  Array: new Set(['from', 'isArray', 'of']),
  JSON: new Set(['parse', 'stringify']),
  Number: null, String: null, Math: null, // any member except Math.random (checked separately)
};
const MUTATING_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear']);
const MUTATING_STATICS = new Set(['defineProperty', 'defineProperties', 'setPrototypeOf', 'assign', '__defineGetter__', '__defineSetter__']);

const RULES = {
  parse: { why: 'the file does not parse as an ES module.', fix: 'fix the syntax error (run `node --check <file>`).' },
  import: { why: 'character files may import only from their own folder, ../../shared/art/** and ../../shared/char/api.js.', fix: 'copy the helper into your folder, or ask the owner to add it to shared/art.' },
  'dynamic-import': { why: '`import()` loads code at runtime, which the catalog and room workers cannot vet.', fix: 'use a static `import` at the top of the file.' },
  'banned-global': { why: 'this API reaches outside the character (process, network, timers, eval or storage).', fix: 'remove it; the engine gives you everything through `view`, `api`, `info` and `fx`.' },
  proto: { why: '`__proto__` and `.prototype =` rewrite shared objects.', fix: 'use a plain object or class instead.' },
  'mutate-import': { why: 'imports are shared by every character and every room; changing them changes the game for everyone.', fix: 'copy the value into a local const (e.g. `{ ...imported, x: 1 }`) and change the copy.' },
  'top-level': { why: 'the top level may contain only imports, const/function/class declarations and exports.', fix: 'move the statement into a function, or turn it into a const.' },
  'module-let': { why: 'module-level `let`/`var` is state shared by every match on the server (rooms reuse the module).', fix: 'use `vars` / `resources` (per fighter) for state, or `const` for constants.' },
  'top-call': { why: 'only defineCharacter(...), pure helpers and Object.freeze may run at import time.', fix: 'compute the value inside a function, or write it out as data.' },
  'sim-random': { why: 'sim code must be deterministic: Math.random, Date, performance and crypto differ between the server and every client.', fix: 'use `view.rng()` / `api.rng()` (seeded) or `view.frame` for time.' },
  'sim-browser': { why: 'sim code runs on the server, which has no window/document/Image/Audio.', fix: 'move browser work into art.js (art functions only).' },
  'sim-module-state': { why: 'sim code wrote to a module-level object; that state leaks between matches and desyncs replays.', fix: 'store it with api.setVar(...) or a resource.' },
  'browser-top': { why: 'the server imports art.js too, so window/document/Image/Audio must not run at import time.', fix: 'create them lazily inside an art function (e.g. `const cache = {}` at top level, `cache.img ??= new Image()` on the first draw).' },
  'browser-scope': { why: 'window/document/Image/Audio are allowed only inside art functions.', fix: 'move this function into art.js or under `art`.' },
  'infinite-loop': { why: 'a `while(true)` / `for(;;)` without a break can hang a room.', fix: 'add an exit (`break`) or loop over a bounded range.' },
  constructor: { why: '`.constructor` reaches the Function constructor (eval).', fix: 'call the function you meant directly; use instanceof/typeof for type checks.' },
};

/** E020 note. */
function note(rule, file, node, detail) {
  const r = RULES[rule];
  const loc = node?.loc ? `:${node.loc.start.line}:${node.loc.start.column + 1}` : '';
  const why = detail ? `${detail} — ${r.why}` : r.why;
  return finishNote({ code: 'E020', severity: 'error', path: `${file}${loc}`, rule: `lint/${rule}`, why, fix: r.fix, text: `E020 ${file}${loc} ${detail || rule}: ${r.why}` });
}

// ── AST helpers ──────────────────────────────────────────────────────────────
const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range', 'raw']);
const isFn = (n) => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
const truthyConst = (n) => !n || (n.type === 'Literal' && !!n.value) || (n.type === 'UnaryExpression' && n.operator === '!' && n.argument.type === 'Literal' && !n.argument.value);
const memberName = (m) => (m.computed ? (m.property.type === 'Literal' ? String(m.property.value) : null) : m.property.name);

/** Root identifier of a member chain (`a.b[c].d` → a), or null. */
function rootOf(n) {
  while (n && (n.type === 'MemberExpression' || n.type === 'ChainExpression')) n = n.type === 'ChainExpression' ? n.expression : n.object;
  return n && n.type === 'Identifier' ? n.name : null;
}
/** Does a member chain mention `.prototype` / `__proto__`? */
function chainHas(n, names) {
  while (n && n.type === 'MemberExpression') { if (names.has(memberName(n))) return true; n = n.object; }
  return false;
}

/** Calls fn(node, parent, key) for every node, depth first (parents before children). */
function traverse(node, fn, parent = null, key = null) {
  if (fn(node, parent, key) === false) return;
  for (const k in node) {
    if (SKIP_KEYS.has(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') traverse(c, fn, node, k); }
    else if (v && typeof v.type === 'string') traverse(v, fn, node, k);
  }
}

/** True when an Identifier node is a variable reference (not a property key, label, etc.). */
function isReference(node, parent, key) {
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression': return key !== 'property' || parent.computed;
    case 'Property': return key !== 'key' || parent.computed;
    case 'MethodDefinition': case 'PropertyDefinition': return key !== 'key' || parent.computed;
    case 'LabeledStatement': case 'BreakStatement': case 'ContinueStatement': return false;
    case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': return false;
    case 'ExportSpecifier': return key === 'local';
    case 'MetaProperty': return false;
    default: return true;
  }
}

/** Does a loop body contain an exit (break targeting it, return or throw) outside nested functions? */
function loopHasExit(loop) {
  let found = false;
  const walkBody = (n, depth) => {
    if (found || !n || typeof n.type !== 'string') return;
    if (isFn(n) || n.type === 'ClassBody') return;
    if (n.type === 'ReturnStatement' || n.type === 'ThrowStatement') { found = true; return; }
    if (n.type === 'BreakStatement') {
      // Unlabeled: exits us unless inside an inner loop/switch. Labeled: exits us unless it targets an inner label.
      if (n.label ? !depth.labels.has(n.label.name) : depth.loops === 0 && !depth.switch) { found = true; return; }
    }
    const loopish = /^(While|DoWhile|For|ForIn|ForOf)Statement$/.test(n.type);
    const next = { loops: depth.loops + (loopish ? 1 : 0), switch: depth.switch || n.type === 'SwitchStatement', labels: depth.labels };
    if (n.type === 'LabeledStatement') next.labels = new Set([...depth.labels, n.label.name]);
    for (const k in n) {
      if (SKIP_KEYS.has(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => walkBody(c, next)); else if (v && typeof v.type === 'string') walkBody(v, next);
    }
  };
  walkBody(loop.body, { loops: 0, switch: false, labels: new Set() });
  return found;
}

// ── module graph ─────────────────────────────────────────────────────────────
function listJs(dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.') || d.name === 'node_modules') continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) listJs(p, out);
    else if (/\.(m?js)$/.test(d.name)) out.push(p);
  }
  return out;
}

const isArtFile = (folderDir, file) => {
  const rel = relative(folderDir, file).split(sep);
  return /^art([.\-_].*)?\.m?js$/.test(basename(file)) || rel.slice(0, -1).includes('art');
};

/** Parses one file and indexes its top-level bindings. */
function indexModule(file, folderDir, root) {
  const src = readFileSync(file, 'utf8');
  const m = { file, rel: relative(root, file).split(sep).join('/'), src, ast: null, imports: new Map(), fns: new Map(), objs: new Map(), lets: new Set(), exports: new Map(), deps: [], defaultNode: null };
  try {
    m.ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  } catch (e) {
    m.parseError = { message: e.message, loc: e.loc ? { start: { line: e.loc.line, column: e.loc.column } } : null };
    return m;
  }
  const addDecl = (d) => {
    if (d.type === 'FunctionDeclaration' && d.id) m.fns.set(d.id.name, d);
    else if (d.type === 'ClassDeclaration' && d.id) m.fns.set(d.id.name, d);
    else if (d.type === 'VariableDeclaration') {
      for (const v of d.declarations) {
        if (v.id.type !== 'Identifier') continue;
        if (d.kind !== 'const') m.lets.add(v.id.name);
        if (isFn(v.init)) m.fns.set(v.id.name, v.init);
        else if (v.init) m.objs.set(v.id.name, v.init);
      }
    }
  };
  for (const st of m.ast.body) {
    if (st.type === 'ImportDeclaration') {
      const target = resolveSpec(file, st.source.value);
      m.deps.push({ node: st, spec: st.source.value, target });
      for (const s of st.specifiers) {
        const imported = s.type === 'ImportNamespaceSpecifier' ? '*' : s.type === 'ImportDefaultSpecifier' ? 'default' : (s.imported.name ?? s.imported.value);
        m.imports.set(s.local.name, { target, imported });
      }
    } else if (st.type === 'ExportNamedDeclaration') {
      if (st.source) m.deps.push({ node: st, spec: st.source.value, target: resolveSpec(file, st.source.value) });
      if (st.declaration) {
        addDecl(st.declaration);
        const names = st.declaration.type === 'VariableDeclaration' ? st.declaration.declarations.filter((v) => v.id.type === 'Identifier').map((v) => v.id.name) : [st.declaration.id?.name];
        for (const n of names) if (n) m.exports.set(n, n);
      }
      for (const s of st.specifiers || []) if (!st.source) m.exports.set(s.exported.name ?? s.exported.value, s.local.name);
    } else if (st.type === 'ExportAllDeclaration') {
      m.deps.push({ node: st, spec: st.source.value, target: resolveSpec(file, st.source.value) });
    } else if (st.type === 'ExportDefaultDeclaration') {
      m.defaultNode = st.declaration;
      if ((st.declaration.type === 'FunctionDeclaration' || st.declaration.type === 'ClassDeclaration') && st.declaration.id) addDecl(st.declaration);
    } else addDecl(st);
  }
  return m;
}

function resolveSpec(fromFile, spec) {
  if (typeof spec !== 'string' || !(spec.startsWith('./') || spec.startsWith('../'))) return null;
  return resolve(dirname(fromFile), spec.split('?')[0]);
}

const inside = (dir, target) => { const r = relative(dir, target); return !r.startsWith('..') && !isAbsolute(r); };

function importAllowed(target, folderDir, root) {
  if (!target) return false;
  const near = resolve(folderDir, '..', '..');
  if (near !== root && importAllowed(target, folderDir, near)) return true;
  const inFolder = !relative(folderDir, target).startsWith('..') && !relative(folderDir, target).startsWith(sep);
  if (inFolder) return true;
  const art = join(root, 'shared', 'art') + sep;
  if (target.startsWith(art)) return true;
  return target === join(root, 'shared', 'char', 'api.js');
}

// ── reachability ─────────────────────────────────────────────────────────────
/**
 * Collects function nodes reachable from the character def (sim) and from `art`
 * (client), following identifiers to top-level bindings and local imports.
 */
class Reach {
  constructor(mods) { this.mods = mods; this.sim = new Set(); this.art = new Set(); this.seen = new WeakMap(); }

  /** A value node in a def/art tree: collect functions under `set`. */
  value(mod, n, set) {
    if (!n) return;
    if (!this.seen.has(set)) this.seen.set(set, new Set());
    const seen = this.seen.get(set);
    if (seen.has(n)) return;
    seen.add(n);
    if (isFn(n)) return this.fn(mod, n, set);
    switch (n.type) {
      case 'ObjectExpression':
        for (const p of n.properties) {
          if (p.type === 'SpreadElement') { this.value(mod, p.argument, set); continue; }
          const k = p.computed ? null : (p.key.name ?? p.key.value);
          const target = set === this.sim && CLIENT_KEYS.has(k) ? this.art : set;
          this.value(mod, p.value, target);
        }
        return;
      case 'ArrayExpression': for (const e of n.elements) this.value(mod, e, set); return;
      case 'SpreadElement': return this.value(mod, n.argument, set);
      case 'CallExpression': case 'NewExpression': for (const a of n.arguments) this.value(mod, a, set); return this.value(mod, n.callee, set);
      case 'ConditionalExpression': this.value(mod, n.consequent, set); return this.value(mod, n.alternate, set);
      case 'LogicalExpression': this.value(mod, n.left, set); return this.value(mod, n.right, set);
      case 'Identifier': return this.ident(mod, n.name, set);
      case 'MemberExpression': {
        const r = rootOf(n);
        if (r) this.ident(mod, r, set, n.object.type === 'Identifier' && !n.computed ? n.property.name : undefined);
        return;
      }
      default:
    }
  }

  /** A name referenced from a reachable place. `prop` narrows a namespace import. */
  ident(mod, name, set, prop) {
    if (mod.fns.has(name)) return this.fn(mod, mod.fns.get(name), set);
    if (mod.objs.has(name)) return this.value(mod, mod.objs.get(name), set);
    const imp = mod.imports.get(name);
    if (!imp || !imp.target) return;
    const other = this.mods.get(imp.target);
    if (!other || !other.ast) return;
    if (imp.imported === '*') {
      if (prop) this.exported(other, prop, set);
      else for (const e of other.exports.keys()) this.exported(other, e, set);
    } else this.exported(other, imp.imported, set);
  }

  exported(mod, name, set) {
    if (name === 'default') return mod.defaultNode && this.value(mod, mod.defaultNode, set);
    const local = mod.exports.get(name);
    if (local) this.ident(mod, local, set);
  }

  fn(mod, node, set) {
    if (set.has(node)) return;
    set.add(node);
    node.__mod = mod;
    // Everything the body references may run when this function runs.
    traverse(node, (c, parent, key) => {
      if (c !== node && isFn(c)) set.add(c); // nested closures run in the same context
      if (c.type === 'Identifier' && isReference(c, parent, key)) {
        const prop = parent?.type === 'MemberExpression' && key === 'object' && !parent.computed ? parent.property.name : undefined;
        this.ident(mod, c.name, set, prop);
      }
    });
  }
}

// ── per-folder lint ──────────────────────────────────────────────────────────
/**
 * Lints one character folder. Returns E020 notes (empty = clean).
 * @param {string} folderDir absolute path of characters/<id>
 * @param {{root?: string}} [opts] repo root (default: the folder's grandparent)
 */
export function lintFolder(folderDir, { root } = {}) {
  // Paths are shown relative to the repo when the folder is inside it; imports may target this
  // repo's shared/ or the shared/ next to the folder's parent (`../../shared/...` from a copy).
  const inRepo = !relative(ROOT, folderDir).startsWith('..');
  root = root || (inRepo ? ROOT : resolve(folderDir, '..', '..'));
  const notes = [];
  const files = listJs(folderDir);
  const mods = new Map(files.map((f) => [f, indexModule(f, folderDir, root)]));
  for (const m of mods.values()) if (m.parseError) notes.push(note('parse', m.rel, { loc: m.parseError.loc }, m.parseError.message));

  // Which files does the server import? BFS from character.js, stopping at art files.
  const entry = join(folderDir, 'character.js');
  const mainFiles = new Set();
  const queue = mods.has(entry) ? [entry] : [];
  while (queue.length) {
    const f = queue.shift();
    if (mainFiles.has(f)) continue;
    mainFiles.add(f);
    for (const d of mods.get(f)?.deps || []) if (d.target && mods.has(d.target) && !isArtFile(folderDir, d.target)) queue.push(d.target);
  }
  const artFile = (f) => isArtFile(folderDir, f) || (!mainFiles.has(f) && files.length > 1 && f !== entry && [...mods.values()].some((m) => m.deps.some((d) => d.target === f)));

  // Reachability from the def (sim) and from `art` (client), plus import-time helpers.
  const reach = new Reach(mods);
  const main = mods.get(entry);
  if (main?.ast && main.defaultNode) {
    let def = main.defaultNode;
    if (def.type === 'CallExpression' && def.callee.type === 'Identifier' && def.callee.name === 'defineCharacter') def = def.arguments[0];
    reach.value(main, def, reach.sim);
  }
  for (const m of mods.values()) {
    if (!m.ast) continue;
    if (artFile(m.file) && m.defaultNode) reach.value(m, m.defaultNode, reach.art);
  }

  for (const m of mods.values()) if (m.ast) lintModule(m, { folderDir, root, notes, reach, isArt: artFile(m.file), mods });
  return notes;
}

function lintModule(m, { folderDir, root, notes, reach, isArt, mods }) {
  const add = (rule, node, detail) => notes.push(note(rule, m.rel, node, detail));
  const imported = (name) => name && m.imports.has(name);

  // Imports.
  for (const d of m.deps) {
    if (!importAllowed(d.target, folderDir, root)) add('import', d.node, `import from '${d.spec}'`);
    // A folder-local target lint never parsed (dotfile, node_modules, .cjs, missing…) would run unvetted.
    else if (inside(folderDir, d.target) && !mods.has(d.target)) add('import', d.node, `import from '${d.spec}' (not a lintable .js/.mjs file in this folder)`);
  }

  // Top-level statement shapes.
  for (const st of m.ast.body) {
    const decl = st.type === 'ExportNamedDeclaration' ? st.declaration : st;
    if (!decl) continue; // export { a, b }
    switch (decl.type) {
      case 'ImportDeclaration': case 'FunctionDeclaration': case 'ClassDeclaration': case 'ExportAllDeclaration': case 'EmptyStatement': break;
      case 'ExportDefaultDeclaration': break;
      case 'VariableDeclaration':
        if (decl.kind !== 'const') add('module-let', decl, `module-level \`${decl.kind}\``);
        break;
      case 'ExpressionStatement':
        if (decl.directive || localSetup(decl.expression, m)) break;
        add('top-level', decl, `top-level ${decl.expression.type === 'CallExpression' ? 'call' : 'expression'}`);
        break;
      default: add('top-level', decl, `top-level ${decl.type}`);
    }
  }

  // Functions invoked at import time are "pure helpers": the same determinism rules as sim code.
  const topRun = new Set();
  const topFnsCalled = (n) => traverse(n, (c, parent, key) => {
    if (isFn(c)) return parent?.type === 'CallExpression' && key === 'callee' ? undefined : false; // IIFE bodies run now
    if (c.type === 'CallExpression' || c.type === 'NewExpression') {
      const callee = c.callee;
      if (callee.type === 'Identifier' && m.fns.has(callee.name)) reach.fn(m, m.fns.get(callee.name), topRun);
      if (isFn(callee)) reach.fn(m, callee, topRun);
    }
  });
  for (const st of m.ast.body) if (st.type !== 'FunctionDeclaration' && st.type !== 'ClassDeclaration' && st.type !== 'ImportDeclaration') topFnsCalled(st);

  // Main pass: function context stack.
  const stack = [];
  const ctx = () => {
    let sim = false, art = false, run = false;
    for (const f of stack) { if (reach.sim.has(f)) sim = true; if (reach.art.has(f)) art = true; if (topRun.has(f)) run = true; }
    return { inFn: stack.length > 0, sim, art, run };
  };

  const visit = (node, parent, key) => {
    const fnNode = isFn(node);
    if (fnNode) stack.push(node);
    const c = ctx();
    const deterministic = c.sim || c.run || !c.inFn; // code where randomness/time is banned

    switch (node.type) {
      case 'Identifier': {
        if (!isReference(node, parent, key)) break;
        const n = node.name;
        if (n === '__proto__') add('proto', node, '`__proto__`');
        else if (BANNED_GLOBALS.has(n) && !m.imports.has(n)) add('banned-global', node, `\`${n}\``);
        else if (NONDETERMINISTIC.has(n) && deterministic && !m.imports.has(n)) add('sim-random', node, `\`${n}\` in ${c.sim ? 'sim code' : 'import-time code'}`);
        else if (BROWSER.has(n) && !m.imports.has(n)) {
          if (!c.inFn || c.run) add('browser-top', node, `\`${n}\` at import time`);
          else if (c.sim) add('sim-browser', node, `\`${n}\` in sim code`);
          else if (!isArt && !c.art) add('browser-scope', node, `\`${n}\` outside art`);
        }
        break;
      }
      case 'Property': case 'MethodDefinition': case 'PropertyDefinition':
        if (!node.computed && (node.key.name ?? node.key.value) === '__proto__') add('proto', node.key, '`__proto__`');
        break;
      case 'MemberExpression': {
        const name = memberName(node);
        if (name === '__proto__') add('proto', node.property, '`__proto__`');
        if (name === 'constructor') add('constructor', node, '`.constructor`');
        if (node.object.type === 'Identifier' && node.object.name === 'document' && name === 'cookie') add('banned-global', node, '`document.cookie`');
        if (node.object.type === 'Identifier' && node.object.name === 'Math' && name === 'random' && deterministic) add('sim-random', node, `\`Math.random\` in ${c.sim ? 'sim code' : 'import-time code'}`);
        break;
      }
      case 'VariableDeclarator':
        // const { random } = Math
        if (node.init?.type === 'Identifier' && node.init.name === 'Math' && node.id.type === 'ObjectPattern' && deterministic
          && node.id.properties.some((p) => p.type === 'Property' && (p.key.name ?? p.key.value) === 'random')) add('sim-random', node, '`Math.random` (destructured)');
        break;
      case 'ImportExpression': add('dynamic-import', node, '`import()`'); break;
      case 'AssignmentExpression': case 'UpdateExpression': case 'UnaryExpression': {
        const target = node.type === 'AssignmentExpression' ? node.left : node.type === 'UpdateExpression' ? node.argument : node.operator === 'delete' ? node.argument : null;
        if (!target || target.type !== 'MemberExpression') {
          // Reassigning a module-level let from sim code.
          if (target?.type === 'Identifier' && m.lets.has(target.name) && c.inFn && c.sim) add('sim-module-state', node, `\`${target.name}\` (module let)`);
          break;
        }
        if (chainHas(target, new Set(['prototype', '__proto__']))) add('proto', node, '`.prototype =`');
        const root = rootOf(target);
        if (imported(root)) add('mutate-import', node, `\`${root}\` is imported`);
        else if (root && c.inFn && c.sim && (m.objs.has(root) || m.lets.has(root) || m.fns.has(root)) && !shadowed(stack, root)) add('sim-module-state', node, `\`${root}\` is module-level`);
        break;
      }
      case 'CallExpression': case 'NewExpression': {
        const callee = node.callee.type === 'ChainExpression' ? node.callee.expression : node.callee;
        if (callee.type === 'MemberExpression') {
          const obj = callee.object.type === 'Identifier' ? callee.object.name : null;
          const prop = memberName(callee);
          const firstRoot = node.arguments[0] ? rootOf(node.arguments[0]) : null;
          const recvRoot = rootOf(callee.object);
          const ns = callee.object.type === 'Identifier' && m.imports.get(obj)?.imported === '*';
          if (MUTATING_METHODS.has(prop) && imported(recvRoot) && !ns) add('mutate-import', node, `\`.${prop}()\` on imported \`${recvRoot}\``);
          if ((obj === 'Object' && MUTATING_STATICS.has(prop)) || obj === 'Reflect') {
            if (imported(firstRoot)) add('mutate-import', node, `\`${obj}.${prop}\` on imported \`${firstRoot}\``);
          }
        }
        if (!c.inFn && parent && node.type === 'CallExpression') checkTopCall(node, callee, add, m);
        break;
      }
      case 'WhileStatement': case 'DoWhileStatement': case 'ForStatement':
        if (truthyConst(node.test) && !loopHasExit(node)) add('infinite-loop', node, node.type === 'ForStatement' ? '`for(;;)` without a break' : '`while(true)` without a break');
        break;
      default:
    }

    for (const k in node) {
      if (SKIP_KEYS.has(k)) continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const ch of v) if (ch && typeof ch.type === 'string') visit(ch, node, k); }
      else if (v && typeof v.type === 'string') visit(v, node, k);
    }
    if (fnNode) stack.pop();
  };
  visit(m.ast, null, null);
}

/** Is `name` declared as a param or local inside any function on the stack? (cheap, conservative) */
function shadowed(stack, name) {
  for (const f of stack) {
    let hit = false;
    for (const p of f.params) traverse(p, (c) => { if (c.type === 'Identifier' && c.name === name) hit = true; });
    if (hit) return true;
    traverse(f.body, (c) => {
      if (c !== f && isFn(c)) return false;
      if (c.type === 'VariableDeclarator') traverse(c.id, (i) => { if (i.type === 'Identifier' && i.name === name) hit = true; });
    });
    if (hit) return true;
  }
  return false;
}

/**
 * `Object.freeze|defineProperty|defineProperties|assign(local, ...)` as a statement:
 * setting up a module-local const/function (never an import) is allowed at top level.
 */
const LOCAL_SETUP = new Set(['freeze', 'defineProperty', 'defineProperties', 'assign']);
function localSetup(e, m) {
  if (e.type !== 'CallExpression' || e.callee.type !== 'MemberExpression' || e.callee.object.name !== 'Object' || !LOCAL_SETUP.has(memberName(e.callee))) return false;
  const a = e.arguments[0];
  return a?.type === 'Identifier' && (m.fns.has(a.name) || m.objs.has(a.name)) && !m.lets.has(a.name);
}

/** Top-level (import-time) call: defineCharacter, Object.freeze, pure helpers. */
function checkTopCall(node, callee, add, m) {
  if (isFn(callee)) return; // IIFE: its body is linted as import-time code
  if (callee.type === 'Identifier') {
    const n = callee.name;
    if (m.fns.has(n) || m.imports.has(n) || TOP_CALL_GLOBALS.has(n)) return;
    if (BANNED_GLOBALS.has(n) || NONDETERMINISTIC.has(n) || BROWSER.has(n)) return; // reported by the identifier rule
    add('top-call', node, `\`${n}(...)\` at import time`);
    return;
  }
  if (callee.type !== 'MemberExpression') return;
  const obj = callee.object.type === 'Identifier' ? callee.object.name : null;
  const prop = memberName(callee);
  if (obj && obj in TOP_CALL_STATIC) {
    const ok = TOP_CALL_STATIC[obj];
    if (obj === 'Math' && prop === 'random') return; // reported as sim-random
    if (ok && !ok.has(prop)) add('top-call', node, `\`${obj}.${prop}(...)\` at import time`);
    if (obj === 'Object' && prop === 'assign' && node.arguments[0] && rootOf(node.arguments[0]) && m.imports.has(rootOf(node.arguments[0]))) return; // mutate-import already reported
  }
  // Method calls on local data or imported helpers (kit.shade(...), [..].map(...)) are pure helpers.
}

// ── CLI ──────────────────────────────────────────────────────────────────────
/** Folders to lint in a directory: every subfolder with a character.js (including _template). */
export function lintableFolders(dir = CHAR_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(dir, d.name, 'character.js')))
    .map((d) => d.name).sort();
}

/** Lints folders → {folder: notes}. */
export function lintAll({ dir = CHAR_DIR, only = [], root } = {}) {
  const out = {};
  for (const f of only.length ? only : lintableFolders(dir)) {
    const p = join(dir, f);
    out[f] = existsSync(p) && statSync(p).isDirectory() ? lintFolder(p, { root }) : [finishNote({ code: 'E020', severity: 'error', path: f, rule: 'lint/missing', why: `no folder ${f}`, fix: 'check the id.', text: `E020 ${f}: folder not found` })];
  }
  return out;
}

/** Markdown for $GITHUB_STEP_SUMMARY. */
export function markdown(results, title = 'Character lint') {
  const lines = [`### ${title}`, '', '| folder | result |', '|---|---|'];
  for (const [f, notes] of Object.entries(results)) lines.push(`| ${f} | ${notes.length ? `✘ ${notes.length} error(s)` : '✔ clean'} |`);
  const bad = Object.entries(results).filter(([, n]) => n.length);
  for (const [f, notes] of bad) {
    lines.push('', `#### ${f}`, '');
    for (const n of notes) lines.push(`- \`${n.path}\` **${n.rule}**: ${n.why} _Fix: ${n.fix}_`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const dir = dirIdx >= 0 ? resolve(args[dirIdx + 1]) : CHAR_DIR;
  const only = args.filter((a, i) => !a.startsWith('--') && !(dirIdx >= 0 && i === dirIdx + 1));
  const results = lintAll({ dir, only });
  const total = Object.values(results).reduce((s, n) => s + n.length, 0);
  if (args.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else if (args.includes('--markdown')) process.stdout.write(markdown(results));
  else {
    const tty = process.stdout.isTTY;
    const C = tty ? { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', reset: '\x1b[0m' } : { red: '', green: '', dim: '', reset: '' };
    for (const [f, notes] of Object.entries(results)) {
      if (!notes.length) { console.log(`${C.green}✔${C.reset} lint ${f}`); continue; }
      console.log(`${C.red}✘ lint ${f}: ${notes.length} error(s)${C.reset}`);
      for (const n of notes) console.log(`  ${n.code} ${n.path}  ${C.dim}${n.rule}${C.reset}\n      ${n.why}\n      fix: ${n.fix}`);
    }
    if (process.env.GITHUB_ACTIONS) {
      for (const notes of Object.values(results)) for (const n of notes) {
        const [file, line, col] = n.path.split(':');
        console.log(`::error file=${file},line=${line || 1},col=${col || 1},title=${n.code} ${n.rule}::${n.why.replace(/\n/g, ' ')} Fix: ${n.fix}`);
      }
    }
    if (!Object.keys(results).length) console.log('No character folders found.');
    else if (!total) console.log(`${C.green}All ${Object.keys(results).length} character folder(s) pass lint.${C.reset}`);
  }
  if (total) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
