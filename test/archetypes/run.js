#!/usr/bin/env node
// Weird-archetype suite runner (spec §10.3). Every folder in test/archetypes/ with a
// character.js is picked up automatically (directory scan, no list to edit):
//   1. load: validate (0 errors), lint (scripts/lint-characters.js) and asset check;
//   2. determinism: the same seeded match twice → identical state hashes;
//   3. 4-player free-for-alls (archetypes + the v1 roster, hard CPUs and seeded
//      button mashing, Governor on) with invariant checks every frame: the
//      test/integration/helpers.js set (finite numbers, percent range, stocks, states)
//      plus entity count/threat budget, bodyScale ⊂ scaleRange, no fighter embedded
//      in the stage, snapshot ≤ 6 KB, no script faults, script time per tick;
//   4. probes: short scripted scenarios that prove each archetype's primitives work.
//
//   node test/archetypes/run.js                    all archetypes
//   node test/archetypes/run.js buzzwarm drakon    some archetypes (they still fight the rest)
//   --seconds N (FFA length, default 120 as in §10.1)  --quick (20 s FFAs, one input mode)  --no-ffa  --no-probes
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCharacter } from '../../shared/balance/validate.js';
import { ENTITY_LIMITS } from '../../shared/balance/rules.js';
import { GOVERNOR } from '../../shared/balance/governor-rules.js';
import { Game } from '../../shared/sim/game.js';
import { kindTier, alive, hurtShapesOf } from '../../shared/sim/entities.js';
import { collider } from '../../shared/sim/hurtbox.js';
import { hash32 } from '../../shared/sim/rng.js';
import stage from '../../shared/stages/sky-sanctum.js';
import { runMatch, registerChar, loadChar, V1, ROOT } from '../integration/helpers.js';
import { lintFolder } from '../../scripts/lint-characters.js';
import { checkFolder } from '../../scripts/check-assets.js';
import { ArtHost, movePhase, PHASE_NAMES } from '../../client/render/art-host.js';
import { MockCanvas, installPath2D } from '../art/lib/mock-canvas.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const optNum = (f, d) => { const i = args.indexOf(f); return i >= 0 && Number.isFinite(+args[i + 1]) ? +args[i + 1] : d; };
const QUICK = flag('--quick');
const SECONDS = optNum('--seconds', QUICK ? 20 : 120);
const only = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--seconds'));

/** Archetype folders: every subfolder with a character.js (skips _ and . folders). */
export function archetypeIds() {
  return readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.') && existsSync(join(DIR, d.name, 'character.js')))
    .map((d) => d.name).sort();
}

const failures = [];
const fail = (where, msg) => { failures.push(`${where}: ${msg}`); console.log(`  ✗ ${where}: ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ── 1. load ────────────────────────────────────────────────────────────────
async function loadAll(ids) {
  const loaded = new Map();
  for (const id of ids) {
    const dir = join(DIR, id);
    let res;
    try {
      const mod = await import(pathToFileURL(join(dir, 'character.js')).href);
      res = validateCharacter(mod.default, { expectedId: id });
    } catch (e) { fail(id, `import threw: ${e.message}`); continue; }
    if (!res.ok) { fail(id, `validation errors: ${res.errors.map((e) => e.text || String(e)).join(' | ')}`); continue; }
    const lint = lintFolder(dir, { root: ROOT }).filter((n) => n.severity !== 'warn' && n.severity !== 'info');
    if (lint.length) fail(id, `lint: ${lint.map((n) => n.text || n.why).join(' | ')}`);
    const assets = checkFolder(dir, { root: ROOT }).notes;
    for (const n of assets) (n.severity === 'error' ? fail : (w, m) => console.log(`  ! ${w}: ${m}`))(id, `assets: ${n.text || n.why || n.message}`);
    const warn = res.notes.filter((n) => n.code && n.code[0] === 'W');
    ok(`${id}: loads (${res.notes.length} notes, ${warn.length} W: ${warn.map((n) => n.code).join(' ') || '—'}; stat ${res.report?.statPoints?.total}/52, move power ${res.report?.movePower})`);
    registerChar(id, res);
    loaded.set(id, res);
    const art = artSheet(id, res, (await import(pathToFileURL(join(dir, 'character.js')).href)).default);
    if (art.errors.length) fail(id, `art: ${art.errors.join(' | ')}`);
    else { const b = art.bounds; ok(`${id}: art contact sheet (${art.paints} paints, entities, portrait) with 0 errors; bounds [${[b.left, b.right, b.top, b.bottom].map(Math.round).join(', ')}]`); }
  }
  return loaded;
}

// ── 1b. art: a headless contact sheet through the real art host (mock canvas) ──
const ART_STATES = ['idle', 'run', 'air', 'crouch', 'shield', 'hitstun', 'helpless', 'shieldbreak', 'roll', 'land', 'jumpsquat',
  'grabbing', 'grabbed', 'stunned', 'glide', 'fly', 'wallcling', 'crawl', 'respawn', 'taunt'];
const ENTITY_KIND_LIST = ['projectile', 'minion', 'trap', 'zone', 'beam', 'clone', 'part'];

function snapOf(ir, o = {}) {
  const T = ir.tables;
  const f = { id: 'p1', x: 10, y: -2, vx: o.vx ?? 0, vy: o.vy ?? 0, facing: o.facing ?? 1, state: o.state || 'idle', stateFrame: o.stateFrame ?? 12,
    grounded: o.grounded ?? true, hitlag: 0, charging: false, fm: T.forms.indexOf(o.form || 'base'),
    r: T.resources.map((n) => (o.res && n in o.res ? o.res[n] : ir.resources[n].start ?? 50)), sv: o.sv || {}, st: o.st || [], bs: o.bs ?? 1, mv: 0, ctl: 0, dj: 0 };
  if (o.move) {
    const def = ir.moves[o.move];
    const ph = movePhase(def, o.frame ?? 0);
    f.state = def.category === 'taunt' ? 'taunt' : def.category === 'throw' || def.category === 'pummel' ? 'grabbing' : 'attack';
    f.mv = [T.moves.indexOf(o.move), o.frame ?? 0, PHASE_NAMES.indexOf(o.phase || ph.name), 0, o.charge ?? 0];
  }
  return f;
}

/** Renders every form × state, every move at 5 frames, every entity and the portrait. Returns {paints, errors}. */
export function artSheet(id, res, def) {
  installPath2D();
  const ir = res.character;
  const host = new ArtHost({ id, character: ir, def, ir: null, assets: {}, assetsVersion: 1 }, { makeCanvas: (w, h) => new MockCanvas(w, h) });
  const errors = [];
  host.warn = (key, msg, e) => { if (errors.length < 12) errors.push(`${msg}: ${e && e.message ? e.message : e}`); };
  const rec = { index: 0, color: '#ff4d5e', tables: ir.tables };
  const st = host.fighter('p1');
  let paints = 0;
  const check = (f, what) => {
    const view = host.view(f, rec);
    const info = host.info(view, st, { time: paints / 60, frame: paints, simFrame: paints });
    const p = host.paint(view, info, st, 0.8);
    if (!p || p.error) errors.push(`${what}: draw failed`);
    else if (!(p.canvas.getContext('2d').ops > 0)) errors.push(`${what}: drew nothing`);
    const ctx = new MockCanvas(800, 600).getContext('2d');
    host.drawLayer(ctx, 'drawBack', view, info, st);
    host.drawLayer(ctx, 'drawWorld', view, info, st);
    if (ctx.depth !== 0) errors.push(`${what}: drawBack/drawWorld left save() depth ${ctx.depth}`);
    host.trail(view, info);
    paints++;
  };
  for (const form of ir.tables.forms) {
    for (const state of ART_STATES) check(snapOf(ir, { state, form, grounded: !['air', 'helpless', 'glide', 'fly'].includes(state), vy: state === 'air' ? -6 : 0 }), `${form}/${state}`);
    for (const name of ir.tables.moves) {
      const d = ir.moves[name];
      for (const frame of new Set([0, Math.max(0, d.startup - 1), d.startup, d.activeEnd ?? d.startup, d.duration - 1])) check(snapOf(ir, { form, move: name, frame }), `${form}/${name}@${frame}`);
      if (d.charge) check(snapOf(ir, { form, move: name, frame: d.charge.at, phase: 'charge', charge: 20 }), `${form}/${name} charge`);
      if (d.hold) check(snapOf(ir, { form, move: name, frame: d.hold.from, phase: 'hold' }), `${form}/${name} hold`);
    }
    // empty resources, max body scale, mirrored
    check(snapOf(ir, { form, res: Object.fromEntries(ir.tables.resources.map((n) => [n, 0])), bs: 1.3, facing: -1 }), `${form}/empty+scaled+mirrored`);
  }
  const ov = host.view(snapOf(ir), rec);
  const info = host.info(ov, st, { time: 1, frame: 60, simFrame: 60 });
  ir.tables.entities.forEach((name, t) => {
    const ed = ir.entities[name];
    const e = { i: 100 + t, o: 0, t, k: ENTITY_KIND_LIST.indexOf(ed.kind), x: 50, y: -40, vx: 6, vy: -1, a: 0, g: 8, l: ed.kind === 'part' ? -1 : 30, h: ed.hp > 0 ? ed.hp / 2 : -1, n: ed.length || 0, f: -1, v: {} };
    if (ed.kind === 'clone') e.c = ['attack', 4, ir.tables.moves.indexOf('jab'), 4, 1, 1];
    const ev = host.entityView(e, rec, ov);
    for (const layer of ['main', 'world']) {
      const ctx = new MockCanvas(800, 600).getContext('2d');
      host.drawEntity(ctx, ev, info, layer, { st });
      if (ctx.depth !== 0) errors.push(`entity ${name} ${layer}: save() depth ${ctx.depth}`);
    }
  });
  const pc = host.portrait(96);
  if (!pc || !(pc.getContext('2d').ops > 0)) errors.push('portrait is blank');
  return { paints, errors, bounds: host.bounds('base', 1) };
}

// ── invariants (on top of helpers.runMatch) ─────────────────────────────────
const threatOf = (def) => (ENTITY_LIMITS[kindTier(def)] || ENTITY_LIMITS.projectile).threat;
const GOV_E = GOVERNOR.entities;

function scaleRangeOf(f) {
  const forms = f.char.forms;
  const body = (forms && forms[f.form || 'base'] && forms[f.form || 'base'].body) || f.char.body;
  return body && Array.isArray(body.scaleRange) ? body.scaleRange : [1, 1];
}

/** Extra per-frame checks. Throws with a precise message. */
export function checkFrame(game, where) {
  const g = game.stage.ground;
  for (const f of game.fighters) {
    if (f.eliminated) continue;
    const own = game.entities.filter((e) => e.kind && e.owner === f.id && alive(e));
    if (own.length > GOV_E.maxAlive) throw new Error(`${where} f${game.frame}: ${f.charId} has ${own.length} live entities (max ${GOV_E.maxAlive})`);
    const threat = own.reduce((s, e) => s + threatOf(e.def), 0);
    if (threat > GOV_E.maxThreat) throw new Error(`${where} f${game.frame}: ${f.charId} entity threat ${threat} (max ${GOV_E.maxThreat})`);
    const [lo, hi] = scaleRangeOf(f);
    const s = f.bodyScale ?? 1;
    if (s < Math.max(0.6, lo) - 1e-6 || s > Math.min(1.6, hi) + 1e-6) throw new Error(`${where} f${game.frame}: ${f.charId} bodyScale ${s} outside [${lo}, ${hi}] (form ${f.form})`);
    if (f.state !== 'dead' && f.state !== 'respawn') {
      const col = collider(f);
      const inX = f.x + col.w / 2 > g.x1 + 1 && f.x - col.w / 2 < g.x2 - 1;
      if (inX && f.y > g.y + 2 && f.y - col.h < g.bottom - 2) throw new Error(`${where} f${game.frame}: ${f.charId} is embedded in the stage (x ${f.x.toFixed(1)}, y ${f.y.toFixed(1)}, collider ${col.w}×${col.h})`);
    }
  }
}

function stateHash(game) {
  const s = game.snapshot();
  return hash32(JSON.stringify(s));
}

// ── 2. determinism ─────────────────────────────────────────────────────────
async function determinism(id) {
  const foe = V1[hash32(id) % V1.length];
  const run = async () => {
    const hashes = [];
    await runMatch({ ids: [id, foe, id], seed: 11, frames: 1500, cpu: ['hard', 'hard', 'random'], onFrame: (g) => { if (g.frame % 60 === 0) hashes.push(stateHash(g)); } });
    return hashes;
  };
  const a = await run(), b = await run();
  const i = a.findIndex((h, k) => h !== b[k]);
  if (i >= 0 || a.length !== b.length) fail(id, `not deterministic: state hash differs at ${i * 60} frames`);
  else ok(`${id}: deterministic over ${a.length} hashes`);
}

// ── 3. free-for-alls ───────────────────────────────────────────────────────
async function ffa(ids, all, seconds, seed, cpu) {
  const where = `${ids.join('+')} [${Array.isArray(cpu) ? cpu.join(',') : cpu} seed ${seed}]`;
  let st;
  try {
    st = await runMatch({ ids, seed, frames: seconds * 60, cpu, onFrame: (g) => checkFrame(g, where) });
  } catch (e) { fail(where, e.message); return null; }
  const frames = st.frames;
  if (st.errors.length) fail(where, `script errors: ${st.errors.map((e) => `${e.id} ${e.hook}: ${e.message}`).join(' | ')}`);
  if (st.gov.scriptsDisabled) fail(where, `scripts disabled ${st.gov.scriptsDisabled}×`);
  if (st.snapBytes > 6144) fail(where, `snapshot ${st.snapBytes} B > 6 KB`);
  for (const f of st.game.fighters) {
    const ms = (f.scriptTime || 0) / Math.max(1, frames);
    if (ms > 1) fail(where, `${f.charId} script time ${ms.toFixed(3)} ms/tick (> 1)`);
    else if (ms > 0.5) console.log(`  ! ${where}: ${f.charId} script time ${ms.toFixed(3)} ms/tick (> 0.5 target)`);
  }
  const hitStr = Object.entries(st.hits).map(([k, v]) => `${k} ${v}`).join(', ');
  ok(`${where}: ${frames} f, hits {${hitStr}}, kos ${st.kos}, spawns ${st.spawns}, max ents ${st.maxEntities}, snap ${st.snapBytes} B`);
  return st;
}

// ── 4. probes (scripted primitive checks) ──────────────────────────────────
/** A small infinite-stock game for probes: players [{id, cpu?}], no countdown. */
export async function probeGame(ids, { seed = 7, cpu = [], governor = true } = {}) {
  const players = [];
  for (let i = 0; i < ids.length; i++) {
    const res = await loadChar(ids[i]);
    players.push({ id: `p${i + 1}`, name: ids[i], character: res.character, cpu: cpu[i] || null });
  }
  const game = new Game({ stage, players, rules: { stocks: 3, infinite: true, countdown: false, seed, scriptTiming: false, governor } });
  const log = [];
  const P = {
    game, log, f: (i) => game.fighters[i],
    /** Steps n frames with input (object, or fn(frame) → object) for fighter i; others idle. */
    run(n, i = 0, input = {}) {
      for (let k = 0; k < n; k++) {
        game.fighters.forEach((f, j) => { if (!f.cpu) game.setInput(f.id, j === i ? (typeof input === 'function' ? input(k) : input) : {}); });
        game.step();
        for (const e of game.drainEvents()) log.push({ ...e, frame: game.frame });
        checkFrame(game, `probe ${ids.join('+')}`);
      }
    },
    /** One tap (1 frame) then n idle frames. */
    tap(input, n = 0, i = 0) { P.run(1, i, input); P.run(n, i, {}); },
    events: (type, pred = () => true) => log.filter((e) => e.type === type && pred(e)),
    ents: (i, name) => game.entities.filter((e) => e.kind && alive(e) && e.owner === game.fighters[i].id && (name === undefined || e.name === name)),
    res: (i, name) => { const f = game.fighters[i]; const k = (f.char.tables?.resources || []).indexOf(name); return k >= 0 ? f.res[k] : NaN; },
    /** Places fighter i at x (on the ground), facing. */
    place(i, x, facing = 1) { const f = game.fighters[i]; f.x = x; f.y = 0; f.vx = 0; f.vy = 0; f.facing = facing; },
  };
  return P;
}

const expect = (id, cond, msg) => { if (cond) ok(`${id} probe: ${msg}`); else fail(`${id} probe`, msg); };

const PROBES = {
  async buzzwarm(id) {
    const P = await probeGame([id, 'ember']);
    P.place(0, -200, 1); P.place(1, 200, -1);
    P.run(30);
    const bees0 = P.res(0, 'bees');
    P.tap({ special: true }, 50);
    const drones = P.ents(0, 'drone');
    const spawned = P.events('spawn', (e) => e.name === 'drone').length;
    const gov = new Set(P.events('gov').map((e) => e.rule));
    expect(id, spawned >= 1 && drones.length >= 1 && drones.length <= GOV_E.maxAlive, `60 drones requested → ${spawned} spawned, ${drones.length} alive (≤ ${GOV_E.maxAlive}); gov: ${[...gov].join(', ')}`);
    expect(id, gov.has('spawnRate') || gov.has('entityCap') || gov.has('scriptCommands'), 'the spawn budget refused the flood (spawnRate / entityCap / scriptCommands)');
    expect(id, bees0 - P.res(0, 'bees') >= 9, `cast cost bees ${bees0.toFixed(1)} → ${P.res(0, 'bees').toFixed(1)}`);
    P.run(90);
    expect(id, P.f(0).bodyScale < 1.09 && P.f(0).bodyScale > 0.7, `bodyScale follows bees (scale ${P.f(0).bodyScale.toFixed(3)})`);
    // onHurt drain: an ember side smash at point blank
    P.place(0, 0, -1); P.place(1, -60, 1); P.run(5);
    const b1 = P.res(0, 'bees'), p1 = P.f(0).percent;
    P.tap({ strong: true, right: true }, 50, 1);
    const dmg = P.f(0).percent - p1, drop = b1 - P.res(0, 'bees');
    expect(id, dmg >= 8 && drop >= 4 + 0.5 * dmg - 1, `swatted for ${dmg.toFixed(1)}% → lost ${drop.toFixed(1)} bees (perDamage 0.5 + onHurt scatter 4)`);
  },

  async 'major-nibbles'(id) {
    const P = await probeGame([id, 'ember']);
    P.place(0, -100, 1); P.place(1, -40, -1);
    P.run(20);
    // soak plating: ember side smash into the mech
    const pl0 = P.res(0, 'plating'), pc0 = P.f(0).percent;
    P.tap({ strong: true, left: true }, 60, 1);
    const took = P.f(0).percent - pc0, soaked = pl0 - P.res(0, 'plating');
    expect(id, took > 0 && soaked > 0, `plating soaked ${soaked.toFixed(1)} of a hit; ${took.toFixed(1)}% got through`);
    // turret minion with think: fires pellets at ember
    P.place(0, -200, 1); P.place(1, 120, -1); P.run(10);
    P.tap({ special: true, right: true }, 160);
    const turret = P.ents(0, 'turret')[0];
    const pellets = P.events('spawn', (e) => e.name === 'pellet').length;
    expect(id, !!turret && pellets >= 2, `turret deployed (${turret ? 'alive' : 'missing'}), think fired ${pellets} pellets`);
    // eject: downSpecial empties the plating → pilot form + wreck part (relay 0.5)
    P.place(0, -200, 1); P.place(1, 300, -1); P.run(10);
    P.tap({ special: true, down: true }, 40);
    const wreck = P.ents(0, 'wreck')[0];
    expect(id, P.f(0).form === 'pilot' && !!wreck && wreck.relay === 0.5, `ejected: form ${P.f(0).form}, wreck ${wreck ? `relay ${wreck.relay} hp ${wreck.hp}` : 'missing'}`);
    // the wreck relays half of a hit to Nibbles and loses hp
    if (wreck) {
      P.place(0, -420, 1); P.place(1, wreck.x - 50, 1); P.run(30);
      const pc1 = P.f(0).percent, hp1 = wreck.hp;
      P.tap({ attack: true, right: true }, 30, 1);
      const relayed = P.f(0).percent - pc1;
      expect(id, relayed > 0 && wreck.hp < hp1, `hit on the wreck: wreck hp ${hp1} → ${wreck.hp}, relayed ${relayed.toFixed(2)}% to Nibbles`);
    }
    // re-dock after the plating regenerates (form:pilot regen)
    P.place(1, 400, -1);
    P.run(300);
    const ready = P.res(0, 'plating');
    P.tap({ special: true, down: true }, 40);
    expect(id, P.f(0).form === 'base' && P.ents(0, 'wreck').length === 0, `plating regen to ${ready.toFixed(1)} → called the mech back (form ${P.f(0).form}, wrecks ${P.ents(0, 'wreck').length})`);
  },

  async drakon(id) {
    const P = await probeGame([id, 'volt']);
    P.place(0, -250, 1); P.place(1, 200, -1);
    P.run(10);
    const wings = () => [...P.ents(0, 'wingNear'), ...P.ents(0, 'wingFar')];
    const w0 = wings();
    expect(id, w0.length === 2 && w0.every((w) => w.kind === 'part' && w.relay === 1 && hurtShapesOf(w).length === 1), `two relay-1 wing parts with hurt shapes (${w0.map((w) => `${w.name} life ${w.life}`).join(', ')})`);
    P.place(0, 100, -1); P.run(2);
    const wn = P.ents(0, 'wingNear')[0];
    expect(id, wn && Math.abs(wn.x - (100 + 6)) < 1 && Math.abs(wn.y + 104) < 1, `wings stay attached to the body (wingNear at ${wn ? `${wn.x.toFixed(1)}, ${wn.y.toFixed(1)}` : '—'})`);
    // area refund + collider
    const rep = (await loadChar(id)).report;
    expect(id, rep.statPoints.breakdown.hurtboxArea <= -9.9 && collider(P.f(0)).w === 150 && collider(P.f(0)).h === 120, `150×120 collider, area ${rep.area.default} px² → refund ${rep.statPoints.breakdown.hurtboxArea} points`);
    // 520 px fire beam reaches volt across the stage
    P.place(0, -250, 1); P.place(1, 200, -1); P.run(5);
    const pv = P.f(1).percent;
    let len = 0;
    P.tap({ special: true }, 0);
    for (let k = 0; k < 70; k++) { P.run(1); for (const e of P.ents(0, 'fireBreath')) len = Math.max(len, e.len); }
    const beam = P.events('spawn', (e) => e.name === 'fireBreath').length;
    expect(id, beam === 1 && P.f(1).percent > pv, `fire beam spawned (len ${len}) and burned volt ${pv.toFixed(1)}% → ${P.f(1).percent.toFixed(1)}% from 450 px away`);
    // glide: jump, then hold jump while falling
    P.place(0, -250, 1); P.place(1, 300, -1); P.run(30);
    const seen = new Set();
    P.run(90, 0, (k) => { seen.add(P.f(0).state); return k < 3 || k > 30 ? { jump: true } : {}; });
    expect(id, seen.has('glide'), `glide state reached (states: ${[...seen].join(', ')})`);
    // KO → respawn: init runs again and the wings come back
    P.f(0).x = 5000; P.run(5);
    P.run(150);
    const kos = P.events('ko', (e) => e.id === P.f(0).id).length;
    expect(id, kos === 1 && wings().length === 2, `KO'd (${kos}) → wings despawned and came back with init on respawn (${wings().length})`);
  },

  async 'still-life'(id) {
    const P = await probeGame([id, 'ember']);
    // paint resource → splatter → the glob sticks and leaves a painted trap
    P.place(0, -300, 1); P.place(1, 300, -1); P.run(10);
    const paint0 = P.res(0, 'paint');
    P.tap({ special: true }, 14);
    const paint1 = P.res(0, 'paint');
    P.run(90);
    expect(id, paint0 - paint1 >= 14.5 && P.events('spawn', (e) => e.name === 'splat').length === 1 && P.events('spawn', (e) => e.name === 'paintTrap').length === 1,
      `Splatter cost paint ${paint0.toFixed(1)} → ${paint1.toFixed(1)}; splat stuck and left a paintTrap (onExpire)`);
    // Brushstroke trap wets an enemy standing in it
    P.place(0, -100, 1); P.place(1, 200, -1); P.run(5);
    P.tap({ special: true, down: true }, 20);
    const trap = P.ents(0, 'paintTrap').sort((a, b) => b.id - a.id)[0];
    if (trap) { P.place(1, trap.x, -1); P.run(10); }
    expect(id, !!trap && P.f(1).statuses.some((s) => s.name === 'wet'), `ember stepped in the brushstroke trap and is ${P.f(1).statuses.map((s) => s.name).join(',') || 'not wet'}`);
    // reflect frame: ember's fireball comes back
    P.run(130);
    P.place(0, 60, -1); P.place(1, -200, 1); P.run(10);
    const pe = P.f(1).percent;
    P.tap({ special: true }, 13, 1);
    P.tap({ special: true, left: true }, 50, 0);
    const refl = P.events('reflect', (e) => e.id === P.f(0).id).length;
    expect(id, refl >= 1, `Reframe reflected ember's fireball (${refl} reflect event; ember ${pe.toFixed(1)}% → ${P.f(1).percent.toFixed(1)}%)`);
    // the painting asset is declared and resolves inside the folder
    const def = (await import(pathToFileURL(join(DIR, id, 'character.js')).href)).default;
    expect(id, def.art.assets.painting === './painting.svg' && existsSync(join(DIR, id, 'painting.svg')), 'image asset painting.svg declared and present');
  },

  async 'titan-tim'(id) {
    const P = await probeGame([id, 'ember']);
    const tim = () => P.f(0);
    P.place(0, -100, 1); P.place(1, 200, -1);
    P.run(60);
    expect(id, Math.abs(tim().bodyScale - 0.6) < 1e-6, `starts small: bodyScale ${tim().bodyScale}`);
    // area priced at the 0.6 minimum
    const rep = (await loadChar(id)).report;
    const priced = rep.area.default * 0.36;
    expect(id, rep.statPoints.breakdown.hurtboxArea >= 15, `area ${rep.area.default} px² priced at 0.6² = ${Math.round(priced)} px² → ${rep.statPoints.breakdown.hurtboxArea} points`);
    // percent makes him grow
    tim().percent = 140; P.run(30);
    const s1 = tim().bodyScale;
    expect(id, s1 > 0.9 && s1 < 1, `140% → bodyScale ${s1.toFixed(3)} (0.6 + min(0.35, %/400))`);
    // KO credit: hit ember, ember dies within 4 s → kills 1 → +0.25
    P.place(0, 0, 1); P.place(1, 50, -1); P.run(5);
    P.tap({ attack: true }, 20);
    const hitOn = tim().vars.lastHitId;
    P.f(1).x = 5000; P.run(40);
    expect(id, hitOn === P.f(1).id && tim().vars.kills === 1 && tim().bodyScale > s1 + 0.2, `hit ${hitOn || 'nobody'} → KO credited (kills ${tim().vars.kills}), bodyScale ${s1.toFixed(2)} → ${tim().bodyScale.toFixed(2)}`);
    // collider push-out: grow while standing beside the stage's side face (checkFrame asserts no embedding every frame)
    const g = P.game.stage.ground;
    tim().percent = 0; tim().vars.kills = 0; P.run(60);
    const half0 = collider(tim()).w / 2;
    tim().x = g.x1 - half0 - 1; tim().y = 60; tim().vx = 0; tim().vy = 0;
    tim().vars.kills = 4;
    const x0 = tim().x;
    P.run(25);
    expect(id, tim().x < x0 - 5 && tim().bodyScale > 1.05, `grew beside the ledge (scale ${tim().bodyScale.toFixed(2)}, collider w ${collider(tim()).w.toFixed(1)}): pushed out x ${x0.toFixed(1)} → ${tim().x.toFixed(1)}, never embedded`);
    // (informational) reach grows with scale: the static reach limit is checked at scale 1
    const side = (await loadChar(id)).character.moves.side.hitboxes[0];
    console.log(`  · ${id}: Backhand hitbox at scale 1 reaches x ${side.x + side.r}; at 1.6 it reaches ${((side.x + side.r) * 1.6).toFixed(0)} px (tilt REACH_BEYOND is 95 px beyond the hurtbox)`);
  },

  async checkmate(id) {
    const P = await probeGame([id, 'bastion']);
    const pawns = () => P.ents(0, 'pawn');
    P.place(0, -350, 1); P.place(1, 380, -1); P.run(10);
    for (let i = 0; i < 4; i++) P.tap({ special: true }, 45);
    const ps = pawns();
    expect(id, ps.length === 3 && P.events('spawn', (e) => e.name === 'pawn').length === 4, `4 pawns deployed → ${ps.length} alive (maxAlive 3)`);
    const g = P.game.stage.ground;
    expect(id, ps.every((p) => p.surface === -1 && Math.abs(p.y - g.y) < 0.01), `walkers are on the ground (y ${ps.map((p) => p.y.toFixed(1)).join(', ')})`);
    // command(): Advance! targets bastion
    P.tap({ special: true, right: true }, 12);
    expect(id, pawns().every((p) => p.cmd && p.cmd.target === P.f(1).id), `Advance! commanded ${pawns().length} pawns to target ${P.f(1).id}`);
    // pawns march on bastion and land hits → promotion through vars
    const promo = () => P.f(0).vars.promo;
    for (let k = 0; k < 600 && promo() < 3; k++) { P.f(1).percent = 0; P.run(1); }
    expect(id, promo() === 3, `pawn hits earned a promotion (vars.promo ${promo()})`);
    // Hold the line: moveTo commands
    P.place(1, 480, -1);
    P.run(40);
    P.tap({ special: true, down: true }, 12);
    expect(id, pawns().every((p) => p.cmd && p.cmd.moveTo), `Hold the line: ${pawns().length} pawns given moveTo`);
    // Promotion: the SlotFn routes neutralSpecial to 'promote' → queen replaces a pawn
    const before = pawns().length;
    P.run(30);
    const mark = P.log.length;
    P.tap({ special: true }, 40);
    if (process.env.ARCH_DEBUG) console.log(P.log.slice(mark).filter((e) => e.type !== 'hit').map((e) => JSON.stringify(e)).join('\n'));
    const queen = P.ents(0, 'queen')[0];
    expect(id, !!queen && pawns().length === before - 1 && promo() === 0, `promotion: queen ${queen ? 'crowned' : 'missing'}, pawns ${before} → ${pawns().length}, promo reset to ${promo()}`);
    // threat budget with pawns + queen + a rook (checkFrame asserts ≤ ${GOV_E.maxThreat} every frame)
    P.run(1, 0, { jump: true }); P.run(12);
    P.tap({ special: true, down: true }, 30);
    const own = P.game.entities.filter((e) => e.kind && e.owner === P.f(0).id && alive(e));
    const threat = own.reduce((s, e) => s + threatOf(e.def), 0);
    expect(id, threat <= GOV_E.maxThreat && own.some((e) => e.name === 'rook'), `army ${own.map((e) => e.name).join(', ')} → threat ${threat}/${GOV_E.maxThreat}`);
  },
};

// Extra probe sets: test/archetypes/_probes/*.js, default export (helpers) → { [id]: probe }.
for (const f of existsSync(join(DIR, '_probes')) ? readdirSync(join(DIR, '_probes')).filter((n) => n.endsWith('.js')).sort() : []) {
  Object.assign(PROBES, (await import(pathToFileURL(join(DIR, '_probes', f)).href)).default({ probeGame, expect }));
}

// ── main ───────────────────────────────────────────────────────────────────
const t0 = Date.now();
const all = archetypeIds();
const ids = only.length ? all.filter((id) => only.includes(id)) : all;
if (!ids.length) { console.log(`no archetypes match ${only.join(', ')} (have: ${all.join(', ')})`); process.exit(1); }
console.log(`Archetypes: ${all.join(', ')}`);
console.log('\n1. Load (validate, lint, assets)');
const loaded = await loadAll(all);
const live = ids.filter((id) => loaded.has(id));
const pool = all.filter((id) => loaded.has(id));

console.log('\n2. Determinism');
for (const id of live) await determinism(id);

if (!flag('--no-ffa')) {
  console.log(`\n3. Four-player free-for-alls (${SECONDS} s each, Governor on)`);
  const landed = new Map(live.map((id) => [id, 0]));
  for (let i = 0; i < live.length; i++) {
    const id = live[i];
    const k = pool.indexOf(id);
    const others = pool.filter((x) => x !== id);
    const a = others.length ? others[k % others.length] : V1[0];
    const b = others.length > 1 ? others[(k + 1) % others.length] : V1[1];
    const groups = [
      { ids: [id, a, b, V1[k % V1.length]], cpu: 'hard' },
      { ids: [id, V1[(k + 1) % V1.length], a, V1[(k + 2) % V1.length]], cpu: ['random', 'hard', 'random', 'hard'] },
    ];
    for (const [gi, grp] of (QUICK ? groups.slice(0, 1) : groups).entries()) {
      const st = await ffa(grp.ids, pool, SECONDS, 100 + k * 10 + gi, grp.cpu);
      if (st) landed.set(id, landed.get(id) + (st.hits[id] || 0));
    }
  }
  for (const [id, n] of landed) if (n === 0) fail(id, 'landed 0 hits in every free-for-all');
}

if (!flag('--no-probes')) {
  console.log('\n4. Probes');
  for (const id of live) {
    const p = PROBES[id];
    if (!p) { console.log(`  · ${id}: no probe`); continue; }
    try { await p(id); } catch (e) { fail(`${id} probe`, e.stack || e.message); }
  }
}

console.log(`\n${failures.length ? `FAILED (${failures.length})` : 'OK'} — ${live.length} archetypes in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length ? 1 : 0);
