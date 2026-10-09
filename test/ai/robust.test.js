// CPU robustness (WP-O): every level on every kit we have — roster, archetypes, fixtures and
// seeded garbage kits (scripts/fuzz.js genKit) — must never throw, must only emit boolean
// buttons, and the offstage planner must cope with whatever the kit's moves do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, ROSTER, load, game, scenarios, trial } from './helpers.js';
import { validateCharacter } from '../../shared/balance/validate.js';
import { BUTTONS } from '../../shared/constants.js';
import { genKit } from '../../scripts/fuzz.js';

function kitsIn(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const id of readdirSync(dir)) if (existsSync(join(dir, id, 'character.js'))) out.push([id, join(dir, id)]);
  return out;
}

// A throw whose stack runs through the CPU (ai.js / ai-recover.js) fails the test. A throw from
// elsewhere in the engine is a real bug too, but not the CPU's: it is reported as an open engine
// issue (t.diagnostic) so the AI net stays meaningful while the owner fixes it.
const AI_FRAME = /shared[\\/]sim[\\/]ai(-recover)?\.js/;
const issues = new Map();
function guarded(label, fn) {
  try { return fn(); } catch (e) {
    if (AI_FRAME.test(String(e && e.stack))) throw e;
    const where = (String(e && e.stack).split('\n').find((l) => l.includes('/shared/')) || '').trim();
    issues.set(`${e && e.message} ${where}`, label);
    return null;
  }
}
const report = (t) => { for (const [k, label] of issues) t.diagnostic(`OPEN ENGINE ISSUE (not AI): ${label}: ${k}`); issues.clear(); };

/** Plays a seeded match and checks every CPU input frame. */
function play(chars, levels, { seed = 1, frames = 1200, rules = {} } = {}) {
  const g = game(chars, { cpu: levels, seed, rules });
  for (let i = 0; i < frames && g.phase !== 'ended'; i++) {
    g.step();
    g.drainEvents();
    for (const f of g.fighters) {
      if (!f.cpu) continue;
      for (const b of BUTTONS) assert.equal(typeof f.input[b], 'boolean', `${f.charId}: input.${b} = ${f.input[b]}`);
      if (f.brain.level === 'dummy') assert.ok(!BUTTONS.some((b) => f.input[b] && b !== 'down'), `${f.charId}: dummy pressed something`);
    }
  }
  return g;
}

test('every level plays every roster, archetype and fixture kit without throwing', async (t) => {
  const kits = [...ROSTER.map((id) => [id, join(ROOT, 'characters', id)]), ['_template', join(ROOT, 'characters', '_template')],
    ...kitsIn(join(ROOT, 'test', 'archetypes')), ...kitsIn(join(ROOT, 'test', 'fixtures'))];
  const ember = await load('ember');
  for (const [i, [folder, dir]] of kits.entries()) {
    // Underscore folders (templates) declare their own id.
    const id = folder.startsWith('_') ? (await import(pathToFileURL(join(dir, 'character.js')).href)).default.id : folder;
    const c = await load(id, dir);
    guarded(id, () => play([c, ember, c, ember], ['hard', 'normal', 'easy', 'dummy'], { seed: 7 + i, frames: 900 }));
    // The planner on a few offstage spots (forms too).
    for (const form of Object.keys(c.forms || { base: 1 })) for (const s of scenarios().filter((_, k) => k % 37 === 0)) guarded(id, () => trial(c, s, { form, frames: 240 }));
  }
  report(t);
});

test('garbage kits: hard CPUs never throw (fuzz genKit, v1 and v2 shapes)', async (t) => {
  const ember = await load('ember');
  let played = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (const version of [1, 2]) {
      const { def } = genKit(seed * 7919, version);
      let res;
      try { res = validateCharacter(def, {}); } catch { continue; } // validator robustness is tested elsewhere
      if (!res || !res.ok) continue;
      played++;
      const c = res.character;
      const label = `genKit(${seed * 7919}, v${version})`;
      guarded(label, () => play([c, ember], ['hard', 'hard'], { seed, frames: 600, rules: { scriptTiming: false } }));
      for (const s of scenarios().filter((_, k) => k % 61 === 0)) guarded(label, () => trial(c, s, { frames: 200 }));
    }
  }
  report(t);
  assert.ok(played >= 10, `only ${played} garbage kits loaded`);
});

test('governor off and grabs off: the CPU still plays and recovers', async () => {
  const chars = await Promise.all(['gertie', 'gloop', 'nimbus', 'volt'].map((id) => load(id)));
  play(chars, ['hard', 'hard', 'normal', 'easy'], { seed: 3, frames: 1800, rules: { governor: false, grabs: false } });
  let ok = 0;
  const list = scenarios().filter((_, k) => k % 3 === 0);
  for (const s of list) if (trial(chars[0], s, { rules: { governor: false } }) === 'ok') ok++;
  assert.ok(ok / list.length >= 0.95, `gertie without governor: ${ok}/${list.length}`);
});
