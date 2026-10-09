#!/usr/bin/env node
// Asset check (spec §5.5). Keeps character folders small and safe to serve:
//
//   | asset type | allowed formats | limits                              |
//   | images     | png, webp, svg  | ≤ 1.5 MB each, ≤ 4096 px per side   |
//   | audio      | ogg, mp3        | ≤ 400 KB each                       |
//   | per folder | —               | ≤ 6 MB total, ≤ 40 files            |
//   | JS         | —               | ≤ 300 KB total                      |
//
// Also: file contents must match the extension (a .png must really be a PNG),
// SVGs may not contain scripts or external references, and only code/notes
// (js, mjs, json, md, txt) may sit next to the assets. A string literal in the
// code that names a missing local asset ('./sheet.png') is a warning.
//   npm run assets                      → every folder in characters/ (including _template)
//   npm run assets -- gertie            → one folder
//   npm run assets -- --dir test/x      → folders in another directory
//   --json | --markdown                 → machine / step-summary output
// Exit code 1 if any folder has an error (warnings never fail).
import * as acorn from 'acorn';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CHAR_DIR = join(ROOT, 'characters');

const KB = 1024;
const MB = 1024 * 1024;
export const ASSET_LIMITS = Object.freeze({
  image: Object.freeze({ formats: Object.freeze(['png', 'webp', 'svg']), maxBytes: 1.5 * MB, maxSide: 4096 }),
  audio: Object.freeze({ formats: Object.freeze(['ogg', 'mp3']), maxBytes: 400 * KB }),
  folder: Object.freeze({ maxBytes: 6 * MB, maxFiles: 40 }),
  js: Object.freeze({ maxBytes: 300 * KB }),
  other: Object.freeze(['json', 'md', 'txt']),
});
const CODE = ['js', 'mjs'];
const ASSET_EXTS = [...ASSET_LIMITS.image.formats, ...ASSET_LIMITS.audio.formats];
const KNOWN_BAD = { jpg: 'convert it to .webp (or .png)', jpeg: 'convert it to .webp (or .png)', gif: 'export the frames to a .png sprite sheet', bmp: 'convert it to .png', wav: 'convert it to .ogg', flac: 'convert it to .ogg', m4a: 'convert it to .ogg or .mp3', aac: 'convert it to .ogg or .mp3' };

const fmtBytes = (b) => (b >= MB ? `${(b / MB).toFixed(2)} MB` : `${(b / KB).toFixed(1)} KB`);

function note(severity, rule, path, why, fix) {
  return { code: severity === 'error' ? 'E020' : 'W020', severity, rule: `assets/${rule}`, path, why, fix, text: `${path}: ${why}` };
}

// ── format sniffing ──────────────────────────────────────────────────────────
/** {w, h} of a PNG, or null if the bytes are not a PNG. */
export function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || sig.some((b, i) => buf[i] !== b) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** {w, h} of a WebP (VP8, VP8L, VP8X), or null. */
export function webpSize(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return { w: 1 + (b & 0x3fff), h: 1 + ((b >>> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/** {w, h, problems[]} of an SVG (size from width/height or viewBox), or null if not SVG. */
export function svgInfo(buf) {
  const s = buf.toString('utf8');
  const open = s.match(/<svg\b[^>]*>/i);
  if (!open) return null;
  const tag = open[0];
  const attr = (n) => { const m = tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i')); return m ? m[1] : null; };
  const px = (v) => (v && /^\s*[\d.]+\s*(px)?\s*$/.test(v) ? parseFloat(v) : null);
  let w = px(attr('width'));
  let h = px(attr('height'));
  const vb = attr('viewBox');
  if ((w === null || h === null) && vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every(Number.isFinite)) { w = w ?? p[2]; h = h ?? p[3]; }
  }
  const problems = [];
  if (/<script\b/i.test(s)) problems.push('contains a <script>');
  if (/<foreignObject\b/i.test(s)) problems.push('contains <foreignObject>');
  if (/\son[a-z]+\s*=/i.test(s)) problems.push('has an on* event handler');
  if (/(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(s)) problems.push('references an external URL');
  if (/@import|url\(\s*["']?\s*(?:https?:|\/\/)/i.test(s)) problems.push('loads external CSS');
  return { w, h, problems };
}

const isOgg = (b) => b.length >= 4 && b.toString('latin1', 0, 4) === 'OggS';
const isMp3 = (b) => b.length >= 3 && (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));

// ── folder check ─────────────────────────────────────────────────────────────
function listFiles(dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === '.DS_Store') continue; // other dotfiles are listed (and rejected) below
    const p = join(dir, d.name);
    if (d.isDirectory()) listFiles(p, out);
    else if (d.isFile()) out.push(p);
  }
  return out;
}

/** String literals in a JS file that look like local asset paths. */
function assetRefs(src) {
  const out = [];
  let tokens;
  try { tokens = acorn.tokenizer(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); } catch { return out; }
  try {
    for (const t of tokens) {
      if (t.type !== acorn.tokTypes.string) continue;
      const v = t.value;
      if (typeof v !== 'string' || /^[a-z]+:|^\/\//i.test(v)) continue;
      if (new RegExp(`\\.(${[...ASSET_EXTS, ...Object.keys(KNOWN_BAD)].join('|')})$`, 'i').test(v)) out.push(v);
    }
  } catch { /* the linter reports parse errors */ }
  return out;
}

/**
 * Checks one character folder.
 * @param {string} folderDir absolute path
 * @param {{root?: string}} [opts]
 * @returns {{notes: object[], stats: {files: number, bytes: number, jsBytes: number}}}
 */
export function checkFolder(folderDir, { root = ROOT } = {}) {
  const notes = [];
  const files = listFiles(folderDir);
  let bytes = 0, jsBytes = 0;
  const rel = (p) => relative(root, p).split(sep).join('/');
  const L = ASSET_LIMITS;
  for (const p of files) {
    const size = statSync(p).size;
    bytes += size;
    const ext = extname(p).slice(1).toLowerCase();
    const r = rel(p);
    if (relative(folderDir, p).split(sep).some((seg) => seg.startsWith('.'))) {
      notes.push(note('error', 'hidden', r, 'hidden files/folders (names starting with ".") aren\'t allowed in a character folder.', 'rename it without the leading dot, or delete it.'));
      continue;
    }
    if (CODE.includes(ext)) { jsBytes += size; continue; }
    if (L.other.includes(ext)) continue;
    if (!ASSET_EXTS.includes(ext)) {
      notes.push(note('error', 'type', r, `.${ext || '(none)'} files aren't allowed in a character folder.`,
        KNOWN_BAD[ext] || `images must be ${L.image.formats.join('/')}, audio ${L.audio.formats.join('/')}; code and notes may be js/mjs/${L.other.join('/')}.`));
      continue;
    }
    const buf = readFileSync(p);
    if (L.image.formats.includes(ext)) {
      if (size > L.image.maxBytes) notes.push(note('error', 'image-size', r, `image is ${fmtBytes(size)} (max ${fmtBytes(L.image.maxBytes)}).`, 'export as .webp, or reduce the resolution (2× display size is plenty).'));
      const dim = ext === 'png' ? pngSize(buf) : ext === 'webp' ? webpSize(buf) : svgInfo(buf);
      if (!dim) { notes.push(note('error', 'format', r, `the file isn't a valid ${ext.toUpperCase()} (wrong extension or corrupt).`, `re-export it as a real .${ext}.`)); continue; }
      if (ext === 'svg') for (const pr of dim.problems) notes.push(note('error', 'svg', r, `SVG ${pr}.`, 'export a plain SVG (shapes and paths only) or a .png/.webp.'));
      if (dim.w > L.image.maxSide || dim.h > L.image.maxSide) notes.push(note('error', 'image-dims', r, `image is ${dim.w}×${dim.h} px (max ${L.image.maxSide} per side).`, 'split the sheet into several images, or scale it down.'));
    } else {
      if (size > L.audio.maxBytes) notes.push(note('error', 'audio-size', r, `audio is ${fmtBytes(size)} (max ${fmtBytes(L.audio.maxBytes)}).`, 'shorten the clip, use mono, or lower the bitrate (≈ 96 kbps ogg).'));
      if (!(ext === 'ogg' ? isOgg(buf) : isMp3(buf))) notes.push(note('error', 'format', r, `the file isn't a valid ${ext.toUpperCase()} (wrong extension or corrupt).`, `re-export it as a real .${ext}.`));
    }
  }
  const fr = rel(folderDir);
  if (files.length > L.folder.maxFiles) notes.push(note('error', 'folder-files', fr, `${files.length} files (max ${L.folder.maxFiles}).`, 'pack frames into sprite sheets and drop unused files.'));
  if (bytes > L.folder.maxBytes) notes.push(note('error', 'folder-size', fr, `folder is ${fmtBytes(bytes)} (max ${fmtBytes(L.folder.maxBytes)}).`, 'compress images (.webp) and audio (.ogg), and drop unused files.'));
  if (jsBytes > L.js.maxBytes) notes.push(note('error', 'js-size', fr, `JS totals ${fmtBytes(jsBytes)} (max ${fmtBytes(L.js.maxBytes)}).`, 'move big data into a compact table or draw procedurally; never inline base64 assets.'));

  // Literal references to local assets that don't exist (warning: art falls back, but it's a bug).
  for (const p of files) {
    if (!CODE.includes(extname(p).slice(1).toLowerCase())) continue;
    for (const ref of assetRefs(readFileSync(p, 'utf8'))) {
      const target = resolve(dirname(p), ref);
      if (!target.startsWith(folderDir + sep)) { notes.push(note('error', 'outside', rel(p), `"${ref}" points outside the character folder.`, 'keep every asset inside characters/<id>/.')); continue; }
      if (!existsSync(target)) notes.push(note('warning', 'missing', rel(p), `"${ref}" doesn't exist in the folder.`, 'add the file, or fix the path (the art falls back to placeholders until then).'));
    }
  }
  return { notes, stats: { files: files.length, bytes, jsBytes } };
}

/** Folders to check: every subfolder with a character.js (including _template). */
export function checkableFolders(dir = CHAR_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(dir, d.name, 'character.js')))
    .map((d) => d.name).sort();
}

/** {folder: {notes, stats}} */
export function checkAll({ dir = CHAR_DIR, only = [], root = ROOT } = {}) {
  const out = {};
  for (const f of only.length ? only : checkableFolders(dir)) {
    const p = join(dir, f);
    out[f] = existsSync(p) && statSync(p).isDirectory() ? checkFolder(p, { root }) : { notes: [note('error', 'missing-folder', f, `no folder ${f}.`, 'check the id.')], stats: { files: 0, bytes: 0, jsBytes: 0 } };
  }
  return out;
}

/** Markdown for $GITHUB_STEP_SUMMARY. */
export function markdown(results, title = 'Character assets') {
  const lines = [`### ${title}`, '', '| folder | files | size | JS | result |', '|---|---:|---:|---:|---|'];
  for (const [f, { notes, stats }] of Object.entries(results)) {
    const errs = notes.filter((n) => n.severity === 'error').length;
    const warns = notes.length - errs;
    lines.push(`| ${f} | ${stats.files} | ${fmtBytes(stats.bytes)} | ${fmtBytes(stats.jsBytes)} | ${errs ? `✘ ${errs} error(s)` : '✔'}${warns ? ` ⚠ ${warns} warning(s)` : ''} |`);
  }
  for (const [f, { notes }] of Object.entries(results)) {
    if (!notes.length) continue;
    lines.push('', `#### ${f}`, '');
    for (const n of notes) lines.push(`- ${n.severity === 'error' ? '✘' : '⚠'} \`${n.path}\` **${n.rule}**: ${n.why} _Fix: ${n.fix}_`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const dir = dirIdx >= 0 ? resolve(args[dirIdx + 1]) : CHAR_DIR;
  const only = args.filter((a, i) => !a.startsWith('--') && !(dirIdx >= 0 && i === dirIdx + 1));
  const results = checkAll({ dir, only });
  const errors = Object.values(results).reduce((s, r) => s + r.notes.filter((n) => n.severity === 'error').length, 0);
  if (args.includes('--json')) console.log(JSON.stringify(results, null, 2));
  else if (args.includes('--markdown')) process.stdout.write(markdown(results));
  else {
    const tty = process.stdout.isTTY;
    const C = tty ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' } : { red: '', green: '', yellow: '', dim: '', reset: '' };
    for (const [f, { notes, stats }] of Object.entries(results)) {
      const errs = notes.filter((n) => n.severity === 'error');
      const head = `${f} ${C.dim}(${stats.files} files, ${fmtBytes(stats.bytes)}, JS ${fmtBytes(stats.jsBytes)})${C.reset}`;
      console.log(errs.length ? `${C.red}✘ assets ${head}${C.reset}` : `${C.green}✔${C.reset} assets ${head}`);
      for (const n of notes) console.log(`  ${n.severity === 'error' ? C.red : C.yellow}${n.code}${C.reset} ${n.path}  ${C.dim}${n.rule}${C.reset}\n      ${n.why}\n      fix: ${n.fix}`);
      if (process.env.GITHUB_ACTIONS) for (const n of notes) console.log(`::${n.severity === 'error' ? 'error' : 'warning'} file=${n.path},title=${n.rule}::${n.why} Fix: ${n.fix}`);
    }
    if (!Object.keys(results).length) console.log('No character folders found.');
    else if (!errors) console.log(`${C.green}All ${Object.keys(results).length} character folder(s) pass the asset check.${C.reset}`);
  }
  if (errors) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
