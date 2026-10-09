// Calibration (§4.2.12): v1 characters in seeded hard-CPU matches with the Governor ON must
// see < 1% of damage trimmed (per-hit + rate caps) and no KO-floor clamps (spike caps excluded).
// Needs the WP-E sim wiring (game.gov = new Governor(game) behind rules.governor).
// Usage: node test/governor/calibration.test.js [--seeds 3] [--seconds 120] [--strict]
//   --strict also fails on any upward KO-floor clamp (the release target); otherwise clamps are reported.
//   Airborne spike caps below the floor (§4.2.2, owner decision a) are intended and counted apart.
import { validateCharacter } from '../../shared/balance/validate.js';
import { Game } from '../../shared/sim/game.js';
import stage from '../../shared/stages/sky-sanctum.js';
import { loadRoster, ROSTER } from '../golden/harness.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const SEEDS = arg('--seeds', 3);
const SECONDS = arg('--seconds', 120);
const STRICT = process.argv.includes('--strict');

const roster = await loadRoster(validateCharacter);
const tot = { hits: 0, intended: 0, prorated: 0, dealt: 0, trimPerHit: 0, trimRate: 0, mitigated: 0, koClamps: 0, spikeCaps: 0, speedClamps: 0, breaks: 0, armored: 0, events: {} };
const perChar = {};
const AI_VERSION = process.argv.includes('--ai2') ? 2 : 1; // --ai2: measure with the current CPU
let matches = 0, kos = 0, governed = true;
const clampLog = [];

for (let i = 0; i < ROSTER.length; i++) {
  for (let j = i; j < ROSTER.length; j++) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const game = new Game({
        stage,
        // Reference CPU = the frozen v1 CPU, so the numbers track static balance, not AI changes.
        // (The v2 CPU charges smashes; v1 kits under legacyKo aren't scaled for full charge, so the
        // Governor floors bastion's charged side smash — by design, see `npm run migrate`.)
        rules: { stocks: 3, seed, governor: true, aiVersion: AI_VERSION },
        players: [
          { id: 'a', name: 'A', character: roster[ROSTER[i]].character, cpu: 'hard' },
          { id: 'b', name: 'B', character: roster[ROSTER[j]].character, cpu: 'hard' },
        ],
      });
      if (!game.gov) { governed = false; break; }
      for (let f = 0; f < 60 * SECONDS + 180 && game.phase !== 'ended'; f++) {
        game.step();
        for (const e of game.drainEvents()) {
          if (e.type === 'ko') kos++;
          if (e.type === 'hit' && e.gov && e.gov.length) {
            const who = e.attacker === 'a' ? ROSTER[i] : ROSTER[j];
            const pc = perChar[who] || (perChar[who] = {});
            for (const r of e.gov) pc[r] = (pc[r] || 0) + 1;
            if (e.gov.includes('koFloor')) clampLog.push(`${e.gov.includes('spike') ? 'spike cap' : 'KO clamp'}: ${who} hit ${e.target} @${Math.round(e.percent)}% kb ${e.kb} angle ${e.angle}`);
          }
        }
      }
      const s = game.gov.stats;
      for (const k of Object.keys(tot)) if (k !== 'events') tot[k] += s[k] || 0;
      for (const [k, v] of Object.entries(s.events)) tot.events[k] = (tot.events[k] || 0) + v;
      matches++;
    }
    if (!governed) break;
  }
  if (!governed) break;
}

if (!governed) {
  console.log('⚠ calibration skipped: Game has no governor wired (game.gov is null)');
  process.exit(0);
}
const pct = (x) => (tot.intended ? (100 * x / tot.intended).toFixed(2) : '0.00');
const trimmed = tot.trimPerHit + tot.trimRate;
console.log(`calibration: ${matches} matches (${SEEDS} seeds × ${SECONDS}s, hard CPUs), ${tot.hits} hits, ${kos} KOs`);
console.log(`  intended ${tot.intended.toFixed(1)} dmg → dealt ${tot.dealt.toFixed(1)}`);
console.log(`  trimmed ${pct(trimmed)}% (perHit ${pct(tot.trimPerHit)}%, rate ${pct(tot.trimRate)}%) · proration ${pct(tot.prorated)}% · mitigated ${pct(tot.mitigated)}%`);
console.log(`  KO-floor clamps ${tot.koClamps} · spike caps ${tot.spikeCaps} (airborne, below the floor; by design) · speed clamps ${tot.speedClamps} · BREAKs ${tot.breaks} · armored ${tot.armored}`);
console.log(`  gov events ${JSON.stringify(tot.events)}`);
if (Object.keys(perChar).length) console.log(`  per attacker ${JSON.stringify(perChar)}`);
for (const l of clampLog.slice(0, 12)) console.log(`    ${l}`);

let fail = false;
if (100 * trimmed / Math.max(1, tot.intended) >= 1) { console.error(`✘ calibration: ${pct(trimmed)}% of damage trimmed (≥ 1%)`); fail = true; }
if (STRICT && tot.koClamps > 0) { console.error(`✘ calibration: ${tot.koClamps} KO-floor clamps (target 0)`); fail = true; }
if (fail) process.exit(1);
console.log('✔ calibration');
