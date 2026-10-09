#!/usr/bin/env node
// Checks every character (or just some) and prints what the auto-balancer did (spec §4.1.8).
//   npm run validate                          → all characters
//   npm run validate -- ember                 → just characters/ember
//   npm run validate -- ember --explain       → every note with its rule and fix, plus the move table
//   npm run validate -- ember --json          → {ok, errors, notes, report, audit} (one id) or {id: {...}}
//   npm run validate -- ember --audit         → also run seeded CPU matches and report the Governor's work
//   npm run validate -- --dir test/fixtures nimbus   → validate folders from another directory
//   npm run balance-report                    → same as --explain
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { listCharacterFolders, loadCharacter, CHAR_DIR, ROOT } from '../server/characters.js';
import { formatReport, finishNote } from '../shared/balance/v2/report.js';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const explain = flag('--explain') || flag('--report');
const asJson = flag('--json');
const audit = flag('--audit');
const dirIdx = args.indexOf('--dir');
const dir = dirIdx >= 0 ? resolve(args[dirIdx + 1]) : CHAR_DIR;
const only = args.filter((a, i) => !a.startsWith('--') && !(dirIdx >= 0 && i === dirIdx + 1));
const folders = only.length ? only : listCharacterFolders(dir);

const tty = process.stdout.isTTY && !asJson;
const C = tty ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' } : { red: '', green: '', yellow: '', dim: '', bold: '', reset: '' };

/** Errors from the loader (import failures) are plain strings: code them as E004. */
const coded = (e) => (typeof e === 'string' ? finishNote({ code: 'E004', severity: 'error', path: '', why: e }) : e);

/**
 * --audit hook. scripts/audit.js (WP-N) may export
 *   audit(character, {roster, seeds, seconds}) → {matches, trimmedPct, koClamps, breaks, riseExhausted, govEvents, scriptMs?}
 * Otherwise a small built-in seeded run is used (hard CPUs, Governor on).
 */
async function runAudit(character, roster) {
  const ext = join(ROOT, 'scripts', 'audit.js');
  if (existsSync(ext)) {
    const mod = await import(pathToFileURL(ext).href);
    if (typeof mod.audit === 'function') return mod.audit(character, { roster, seeds: 3, seconds: 120 });
  }
  const { Game } = await import('../shared/sim/game.js');
  const stage = (await import('../shared/stages/index.js')).getStage();
  const foes = roster.filter((c) => c.id !== character.id).slice(0, 8);
  if (!foes.length) foes.push(character);
  const out = { matches: 0, trimmedPct: 0, koClamps: 0, breaks: 0, riseExhausted: 0, govEvents: 0 };
  let intended = 0, trimmed = 0;
  for (const foe of foes) {
    for (const seed of [1, 2, 3]) {
      const g = new Game({ stage, players: [{ id: 'a', name: 'A', character, cpu: 'hard' }, { id: 'b', name: 'B', character: foe, cpu: 'hard' }], rules: { seed, stocks: 3 } });
      for (let f = 0; f < 60 * 120; f++) {
        g.step();
        for (const e of g.drainEvents()) {
          if (e.type !== 'gov') continue;
          out.govEvents++;
          if (e.rule === 'rise' || e.rule === 'stall') out.riseExhausted++;
        }
        if (g.phase === 'ended') break;
      }
      const s = g.gov?.stats;
      if (s) { intended += s.intended || 0; trimmed += (s.trimPerHit || 0) + (s.trimRate || 0); out.koClamps += s.koClamps || 0; out.breaks += s.breaks || 0; }
      out.matches++;
    }
  }
  out.trimmedPct = intended ? Math.round((trimmed / intended) * 1000) / 10 : 0;
  return out;
}

const results = [];
for (const folder of folders) results.push(await loadCharacter(folder, { dir }));
const roster = results.filter((r) => r.ok).map((r) => r.character);
if (audit && (dir !== CHAR_DIR || only.length)) for (const f of listCharacterFolders()) { const r = await loadCharacter(f); if (r.ok) roster.push(r.character); } // opponents

let failed = 0;
const json = {};
for (const r of results) {
  const res = { ...r, errors: (r.errors || []).map(coded) };
  if (!res.ok) failed++;
  const a = audit && res.ok ? await runAudit(res.character, roster) : null;
  if (asJson) {
    json[r.folder] = { ok: res.ok, errors: res.errors, notes: res.notes, report: res.report, audit: a };
    continue;
  }
  const lines = formatReport(res, { explain, audit: a, color: C });
  console.log(`${C.dim}[${r.folder}]${C.reset} ${lines.join('\n')}\n`);
}

if (asJson) {
  const replacer = (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? (v > 0 ? 'Infinity' : '-Infinity') : v);
  console.log(JSON.stringify(folders.length === 1 ? json[folders[0]] : json, replacer, 2));
} else {
  if (!folders.length) console.log('No characters found.');
  else if (failed) console.log(`${C.red}${failed} character(s) could not be loaded.${C.reset}`);
  else console.log(`${C.green}All ${folders.length} character(s) load.${C.reset} Anything listed with a W-code was scaled to keep things fair; run with --explain for the rule and the fix.`);
}
if (failed) process.exitCode = 1;
