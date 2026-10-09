// AI test helpers: roster loading and offstage recovery trials (WP-O acceptance).
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { validateCharacter } from '../../shared/balance/validate.js';
import { Game } from '../../shared/sim/game.js';
import { getStage } from '../../shared/stages/index.js';
import { setState } from '../../shared/sim/states.js';
import { airReset } from '../../shared/sim/movement.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROSTER = ['ember', 'bastion', 'volt', 'mirelle', 'nimbus', 'gertie', 'gloop'];
export const stage = getStage();

const cache = new Map();
export async function load(id, dir = join(ROOT, 'characters', id)) {
  if (cache.has(dir)) return cache.get(dir);
  const mod = await import(pathToFileURL(join(dir, 'character.js')).href);
  const res = validateCharacter(mod.default, { expectedId: id });
  if (!res.ok) throw new Error(`${id}: ${res.errors.map(String).join('; ')}`);
  cache.set(dir, res.character);
  return res.character;
}

export function game(chars, { cpu = ['hard', 'dummy'], seed = 1, rules = {} } = {}) {
  const players = chars.map((c, i) => ({ id: `p${i + 1}`, name: c.id, character: c, cpu: cpu[i] ?? 'dummy' }));
  return new Game({ stage, players, rules: { stocks: 3, seed, countdown: false, scriptTiming: false, ...rules } });
}

/** Offstage scenarios: both sides × distance × height × velocity × facing. */
export function scenarios() {
  const out = [];
  for (const side of [-1, 1]) {
    for (const dx of [40, 120, 220, 320]) {
      for (const y of [-220, -80, 30, 110]) {
        for (const [vx, vy] of [[0, 2], [side * 6, -4], [side * 3, 6]]) for (const facing of [-1, 1]) out.push({ side, dx, y, vx, vy, facing });
      }
    }
  }
  return out;
}

/** Runs one trial; returns 'ok' when the CPU stands on the stage again, else the failure reason. */
export function trial(char, s, { frames = 420, seed = 1, form = null, rules = {}, trace = null } = {}) {
  const g = game([char, char], { seed, rules });
  const f = g.fighters[0];
  const dummy = g.fighters[1];
  dummy.x = 0; dummy.y = 0;
  if (form && char.forms && char.forms[form]) f.form = form;
  const gr = stage.ground;
  f.x = s.side > 0 ? gr.x2 + s.dx : gr.x1 - s.dx;
  f.y = s.y; f.vx = s.vx; f.vy = s.vy;
  if (s.facing) f.facing = s.facing;
  f.grounded = false; f.platform = -1;
  setState(f, 'air');
  airReset(f);
  f.jumpsLeft = f.stats.airJumps;
  const stocks = f.stocks;
  for (let i = 0; i < frames; i++) {
    g.step();
    g.drainEvents();
    if (trace) trace(f, g, i);
    if (f.stocks < stocks || f.state === 'dead') return 'ko';
    if (f.grounded && f.x >= gr.x1 && f.x <= gr.x2 && i > 2) return 'ok';
  }
  return 'timeout';
}

/** Seeded CPU match; returns per-character tallies (hits, moves by trigger, spawns, KOs, self-destructs). */
export function match(chars, { cpu = 'hard', seed = 1, frames = 7200, rules = {} } = {}) {
  const g = game(chars, { cpu: chars.map(() => cpu), seed, rules });
  const t = Object.fromEntries(g.fighters.map((f) => [f.id, { id: f.charId, hits: 0, moves: {}, spawns: 0, kos: 0, sds: 0, grabs: 0 }]));
  let i = 0;
  for (; i < frames && g.phase !== 'ended'; i++) {
    g.step();
    for (const e of g.drainEvents()) {
      if (e.type === 'hit' && t[e.attacker]) t[e.attacker].hits++;
      else if (e.type === 'move' && t[e.id]) { const k = e.trigger || e.move || e.name; t[e.id].moves[k] = (t[e.id].moves[k] || 0) + 1; }
      else if (e.type === 'spawn' && t[e.o]) t[e.o].spawns++;
      else if (e.type === 'grab' && t[e.id]) t[e.id].grabs++;
      else if (e.type === 'ko' && t[e.id]) { if (e.by && t[e.by]) t[e.by].kos++; else t[e.id].sds++; }
    }
  }
  return { frames: i, ended: g.phase === 'ended', fighters: Object.values(t) };
}

/** Launch scenarios: knocked off the edge in real hitstun (kb → speed/hitstun as hits.js), jumps full or spent. */
export function launches() {
  const out = [];
  for (const side of [-1, 1]) {
    for (const kb of [50, 70, 90, 110]) {
      for (const angle of [15, 40, 65, 85]) for (const jumps of ['full', 'none']) out.push({ side, kb, angle, jumps });
    }
  }
  return out;
}

export function launchTrial(char, s, { frames = 480, seed = 1, form = null, rules = {}, trace = null } = {}) {
  const g = game([char, char], { seed, rules });
  const f = g.fighters[0];
  g.fighters[1].x = 0; g.fighters[1].y = 0;
  if (form && char.forms && char.forms[form]) f.form = form;
  const gr = stage.ground;
  f.x = s.side > 0 ? gr.x2 - 20 : gr.x1 + 20;
  f.y = gr.y - 2;
  f.vx = f.vy = 0;
  const sp = s.kb * 0.15, a = (s.angle * Math.PI) / 180;
  f.kx = Math.cos(a) * sp * s.side; f.ky = -Math.sin(a) * sp;
  f.hitstun = Math.min(90, Math.floor(s.kb * 0.4));
  f.tumble = s.kb >= 32;
  f.facing = -s.side;
  f.grounded = false; f.platform = -1;
  setState(f, 'hitstun');
  airReset(f);
  f.jumpsLeft = s.jumps === 'none' ? 0 : f.stats.airJumps;
  const stocks = f.stocks;
  let left = false;
  for (let i = 0; i < frames; i++) {
    g.step();
    g.drainEvents();
    if (trace) trace(f, g, i);
    if (f.stocks < stocks || f.state === 'dead') return 'ko';
    if (!f.grounded) left = true;
    if (left && f.grounded && f.x >= gr.x1 && f.x <= gr.x2 && i > 2) return 'ok';
  }
  return 'timeout';
}
