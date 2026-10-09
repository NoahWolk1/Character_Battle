#!/usr/bin/env node
// Runtime audit (spec §4.1.8, §11 "scripted moves get no static feedback"):
// seeded hard-CPU matches with the Governor on, reporting how much the Governor
// had to step in for one character. `npm run validate -- <id> --audit` calls
// audit(); this file also runs standalone:
//   npm run audit -- nimbus [--seeds 3] [--seconds 120] [--json]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Game } from '../shared/sim/game.js';
import { getStage } from '../shared/stages/index.js';
import * as script from '../shared/sim/script-api.js';

const stage = getStage();
const MAX_FOES = 8;

/**
 * @param {object} character  validated IR (validateCharacter(...).character)
 * @param {{roster?: object[], seeds?: number, seconds?: number, rules?: object}} [opts]
 * trimmedPct and breaks are match-wide (Governor telemetry); clamps, gov events and script
 * cost are this character's own (including its clones/minors).
 * @returns {{matches, frames, trimmedPct, koClamps, spikeCaps, breaks, riseExhausted, govEvents,
 *   events: Object<string, number>, scriptMs: number, scriptsDisabled: number, scriptErrors: number,
 *   damageDealt: number, kos: number, ended: number}}
 */
export function audit(character, { roster = [], seeds = 3, seconds = 120, rules = {} } = {}) {
  const seen = new Set();
  const foes = roster.filter((c) => c && c.id !== character.id && !seen.has(c.id) && seen.add(c.id)).slice(0, MAX_FOES);
  if (!foes.length) foes.push(character); // mirror match
  const out = {
    matches: 0, frames: 0, trimmedPct: 0, koClamps: 0, spikeCaps: 0, breaks: 0, riseExhausted: 0, govEvents: 0,
    events: {}, scriptMs: 0, scriptsDisabled: 0, scriptErrors: 0, damageDealt: 0, kos: 0, ended: 0,
  };
  let intended = 0, trimmed = 0, scriptTotal = 0, ticks = 0;
  for (const foe of foes) {
    for (let seed = 1; seed <= seeds; seed++) {
      const game = new Game({
        stage,
        // scriptTiming off: wall-clock faults would make the audit nondeterministic (time is still measured).
        rules: { stocks: 3, seed, governor: true, scriptTiming: false, ...rules },
        players: [
          { id: 'a', name: 'A', character, cpu: 'hard' },
          { id: 'b', name: 'B', character: foe, cpu: 'hard' },
        ],
      });
      const me = game.fighters[0];
      const mine = (id) => id === me.id || (typeof id === 'string' && id.startsWith(`${me.id}#`)); // me, my clones/minors
      for (let f = 0; f < 60 * seconds && game.phase !== 'ended'; f++) {
        game.step();
        for (const e of game.drainEvents()) {
          if (e.type === 'ko') out.kos++;
          else if (e.type === 'scriptError' && mine(e.id)) out.scriptErrors++;
          else if (e.type === 'hit' && mine(e.attacker) && e.gov?.includes('koFloor')) {
            if (e.gov.includes('spike')) out.spikeCaps++; else out.koClamps++;
          }
          if (e.type !== 'gov') continue;
          if (e.who !== null && e.who !== undefined && !mine(e.who)) continue; // only this character's governed actions
          out.govEvents++;
          out.events[e.rule] = (out.events[e.rule] || 0) + 1;
          if (e.rule === 'rise' || e.rule === 'stall') out.riseExhausted++;
          if (e.rule === 'scriptsDisabled') out.scriptsDisabled++;
        }
      }
      const s = game.gov?.stats;
      if (s) {
        intended += s.intended || 0;
        trimmed += (s.trimPerHit || 0) + (s.trimRate || 0);
        out.breaks += s.breaks || 0;
        out.damageDealt += s.dealt || 0;
      }
      scriptTotal += script.info(me).timeMs;
      ticks += game.frame;
      out.frames += game.frame;
      out.ended += game.phase === 'ended' ? 1 : 0;
      out.matches++;
    }
  }
  out.trimmedPct = intended ? Math.round((trimmed / intended) * 1000) / 10 : 0;
  out.scriptMs = ticks ? Math.round((scriptTotal / ticks) * 1e4) / 1e4 : 0; // average ms per tick
  out.damageDealt = Math.round(out.damageDealt);
  return out;
}

async function main() {
  const { loadCharacter, listCharacterFolders } = await import('../server/characters.js');
  const args = process.argv.slice(2);
  const num = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
  const skip = new Set(['--seeds', '--seconds'].map((k) => args.indexOf(k) + 1).filter((i) => i > 0));
  const ids = args.filter((a, i) => !a.startsWith('--') && !skip.has(i));
  const roster = [];
  for (const f of listCharacterFolders()) { const r = await loadCharacter(f); if (r.ok) roster.push(r.character); }
  const targets = ids.length ? ids : roster.map((c) => c.id);
  const results = {};
  for (const id of targets) {
    const ch = roster.find((c) => c.id === id) || (await loadCharacter(id)).character;
    if (!ch) { console.error(`✘ ${id} does not load (run npm run validate -- ${id})`); process.exitCode = 1; continue; }
    results[id] = audit(ch, { roster, seeds: num('--seeds', 3), seconds: num('--seconds', 120) });
    if (!args.includes('--json')) {
      const a = results[id];
      console.log(`${id}: ${a.matches} matches · trimmed ${a.trimmedPct}% · KO clamps ${a.koClamps} · spike caps ${a.spikeCaps} · BREAKs ${a.breaks} · rise exhausted ${a.riseExhausted} · gov events ${a.govEvents} · script ${a.scriptMs} ms/tick${a.scriptsDisabled ? ` · SCRIPTS DISABLED ×${a.scriptsDisabled}` : ''}`);
    }
  }
  if (args.includes('--json')) console.log(JSON.stringify(results, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
