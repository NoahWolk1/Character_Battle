// CPU AI (WP-O): recovery rate, determinism, v2 feature use, grab mashing, v1 pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROSTER, load, scenarios, trial, launches, launchTrial, match, game } from './helpers.js';
import { plan, _tune } from '../../shared/sim/ai-recover.js';
import { cpuThink } from '../../shared/sim/ai.js';
import { cpuThink as cpuThinkV1 } from '../../shared/sim/ai-v1.js';

async function rate(id, form, rules = {}) {
  const c = await load(id);
  let ok = 0;
  const list = scenarios();
  for (const s of list) if (trial(c, s, { form, rules }) === 'ok') ok++;
  return ok / list.length;
}

const formsOf = (c) => Object.keys(c.forms || { base: 1 });

test('hard CPU recovers in ≥ 95% of offstage situations with every roster character (every form)', async () => {
  for (const id of ROSTER) {
    const c = await load(id);
    for (const form of formsOf(c)) {
      const r = await rate(id, form);
      assert.ok(r >= 0.95, `${id}/${form}: recovered ${(r * 100).toFixed(1)}%`);
    }
  }
});

test('hard CPU recovers at least as well as the v1 CPU with every roster character', async () => {
  for (const id of ROSTER) {
    const v2 = await rate(id, 'base');
    const v1 = await rate(id, 'base', { aiVersion: 1 });
    assert.ok(v2 >= v1 - 0.02, `${id}: v2 ${(v2 * 100).toFixed(1)}% < v1 ${(v1 * 100).toFixed(1)}%`);
  }
});

// Launched off the edge in real hitstun. Some launches can't be survived by a given kit, so the
// bar is: every launch that a wide (slow, fine-grained) search of the same planner can survive
// from the first actionable frame, the live CPU survives too (≥ 95%), and never worse than v1.
test('hard CPU survives ≥ 95% of survivable launches with every roster character', async () => {
  const slotOf = (f, t) => { const fo = f.form && f.form !== 'base' ? f.char.forms[f.form] : null; const s = (fo && fo.slots && fo.slots[t]) || f.char.forms.base.slots[t]; return typeof s === 'string' ? s : t; };
  for (const id of ROSTER) {
    const c = await load(id);
    for (const form of formsOf(c)) {
      let ok = 0, ok1 = 0, survivable = 0;
      for (const s of launches()) {
        const won = launchTrial(c, s, { form }) === 'ok';
        if (launchTrial(c, s, { form, rules: { aiVersion: 1 } }) === 'ok') ok1++;
        if (won) { ok++; survivable++; continue; }
        let verdict = null;
        launchTrial(c, s, { form, trace: (f, g) => {
          if (verdict !== null || f.state !== 'air') return;
          const prev = _tune({ budget: 3e5, waits: Array.from({ length: 41 }, (_, i) => i * 2) });
          try { const p = plan(g, f, slotOf, 3); verdict = !!(p && p.ok); } finally { _tune(prev); }
        } });
        if (verdict) survivable++;
      }
      assert.ok(ok >= 0.95 * survivable, `${id}/${form}: survived ${ok}/${survivable} survivable launches`);
      assert.ok(ok >= ok1, `${id}/${form}: v2 survived ${ok} < v1 ${ok1}`);
    }
  }
});

test('levels: easy recovers worse than hard, dummy never acts', async () => {
  for (const id of ['gertie', 'bastion']) {
    const c = await load(id);
    const list = scenarios();
    const lvl = (level) => {
      let ok = 0;
      for (const s of list) {
        const g = game([c, c], { cpu: [level, 'dummy'] });
        const f = g.fighters[0];
        const gr = g.stage.ground;
        f.x = s.side > 0 ? gr.x2 + s.dx : gr.x1 - s.dx; f.y = s.y; f.vx = s.vx; f.vy = s.vy; f.facing = s.facing;
        f.grounded = false; f.platform = -1; f.state = 'air'; f.jumpsLeft = f.stats.airJumps;
        for (let i = 0; i < 420; i++) {
          g.step(); g.drainEvents();
          if (level === 'dummy') assert.ok(!f.input.jump && !f.input.special && !f.input.attack, 'dummy pressed a button');
          if (f.stocks < 3 || f.state === 'dead') break;
          if (f.grounded && f.x >= gr.x1 && f.x <= gr.x2 && i > 2) { ok++; break; }
        }
      }
      return ok / list.length;
    };
    const easy = lvl('easy'), hard = lvl('hard');
    assert.ok(easy < hard, `${id}: easy ${easy} vs hard ${hard}`);
    lvl('dummy');
  }
});

test('CPU matches are deterministic under a seed', async () => {
  const chars = await Promise.all(['nimbus', 'gloop', 'gertie', 'ember'].map((id) => load(id)));
  const a = match(chars, { seed: 5, frames: 2400 });
  const b = match(chars, { seed: 5, frames: 2400 });
  assert.deepEqual(a, b);
});

test('4-player hard-CPU matches use v2 kits (zoning, forms, grabs) and end within 8 minutes', async () => {
  const chars = Object.fromEntries(await Promise.all(ROSTER.map(async (id) => [id, await load(id)])));
  const groups = [['nimbus', 'gertie', 'gloop', 'ember'], ['bastion', 'volt', 'mirelle', 'gloop'], ['nimbus', 'bastion', 'gertie', 'volt']];
  const tally = {};
  for (const [i, ids] of groups.entries()) {
    const r = match(ids.map((id) => chars[id]), { seed: 11 + i, frames: 8 * 3600 });
    assert.ok(r.ended, `${ids.join(',')}: no winner after 8 minutes`);
    for (const f of r.fighters) {
      const t = tally[f.id] ||= { hits: 0, spawns: 0, grabs: 0, moves: {} };
      t.hits += f.hits; t.spawns += f.spawns; t.grabs += f.grabs; t.kos = (t.kos || 0) + f.kos; t.sds = (t.sds || 0) + f.sds;
      for (const [k, v] of Object.entries(f.moves)) t.moves[k] = (t.moves[k] || 0) + v;
    }
  }
  for (const [id, t] of Object.entries(tally)) assert.ok(t.hits > 20, `${id} landed only ${t.hits} hits`);
  const kos = Object.values(tally).reduce((n, t) => n + t.kos, 0), sds = Object.values(tally).reduce((n, t) => n + t.sds, 0);
  assert.ok(kos >= 20, `only ${kos} KOs in 3 matches`);
  assert.ok(sds <= 2, `${sds} self-destructs in 3 matches`);
  assert.ok(tally.nimbus.spawns > 5, `nimbus zoned only ${tally.nimbus.spawns} times`);
  assert.ok((tally.gloop.moves.downSpecial || 0) > 0, 'gloop never changed form');
  assert.ok(Object.values(tally).reduce((n, t) => n + t.grabs, 0) > 3, 'CPUs never grab');
});

test('a grabbed CPU mashes out sooner than a dummy', async () => {
  const c = await load('gertie');
  const held = (level) => {
    const g = game([c, c], { cpu: ['dummy', level] });
    const [a, v] = g.fighters;
    v.x = a.x + 40; v.y = 0;
    a.facing = 1;
    const prev = a.cpu; a.cpu = null; // drive the grabber by hand: one grab press
    g.setInput(a.id, { shield: true, attack: true });
    let grabbed = -1, frames = 0;
    for (let i = 0; i < 400; i++) {
      g.step(); g.drainEvents();
      g.setInput(a.id, {});
      if (v.state === 'grabbed' && grabbed < 0) grabbed = i;
      if (grabbed >= 0 && v.state !== 'grabbed') { frames = i - grabbed; break; }
    }
    a.cpu = prev;
    return { grabbed, frames };
  };
  const dummy = held('dummy'), hard = held('hard');
  assert.ok(dummy.grabbed >= 0 && hard.grabbed >= 0, 'the grab never connected');
  assert.ok(hard.frames < dummy.frames, `hard ${hard.frames} f vs dummy ${dummy.frames} f`);
});

test('rules.aiVersion 1 selects the frozen v1 CPU', async () => {
  const c = await load('ember');
  const g1 = game([c, c], { cpu: ['hard', 'hard'], rules: { aiVersion: 1 } });
  const g2 = game([c, c], { cpu: ['hard', 'hard'], rules: { aiVersion: 1 } });
  for (let i = 0; i < 300; i++) {
    const a = cpuThink(g1, g1.fighters[0]);
    const b = cpuThinkV1(g2, g2.fighters[0]);
    assert.deepEqual(a, b, `frame ${i}`);
    g1.step(); g2.step();
  }
});
