// §4.2.8 entity budgets and §4.2.9 status/control caps, plus control-lock BREAK.
import { check, done, fakeFighter, fakeGame, tick } from './helpers.js';
import { ENTITY_THREAT } from '../../shared/balance/governor-rules.js';

let nextId = 1;
/** Spawns through the Governor into game.entities, despawning anything it expires. */
function spawn(game, owner, def, count, name) {
  const r = game.gov.spawnRequest(owner, def, count, { name });
  for (const e of r.expire) e.dead = true;
  game.entities = game.entities.filter((e) => !e.dead);
  for (let i = 0; i < r.count; i++) game.entities.push({ id: nextId++, ownerIdx: owner.index, owner: owner.id, name, kind: def.kind, def });
  return r;
}
const mine = (game, o) => game.entities.filter((e) => e.ownerIdx === o.index);
const threat = (list) => list.reduce((s, e) => s + (ENTITY_THREAT[e.kind === 'zone' ? 'zone' : e.kind] ?? 1), 0);

// Entity flood: 50 homing minions per frame → ≤ 8 alive, ≤ 10 threat, ≤ 4 spawns per 60 frames.
{
  const o = fakeFighter(0);
  const game = fakeGame([o, fakeFighter(1)]);
  const minion = { kind: 'minion', life: 1200, hp: 0 };
  const spawnedAt = [];
  let maxAlive = 0, maxThreat = 0;
  for (let i = 0; i < 600; i++) {
    const r = spawn(game, o, minion, 50, 'bee');
    for (let k = 0; k < r.count; k++) spawnedAt.push(game.frame);
    const m = mine(game, o);
    maxAlive = Math.max(maxAlive, m.length); maxThreat = Math.max(maxThreat, threat(m));
    tick(game);
  }
  let max60 = 0;
  for (let i = 0, j = 0; i < spawnedAt.length; i++) { while (spawnedAt[i] - spawnedAt[j] >= 60) j++; max60 = Math.max(max60, i - j + 1); }
  check(maxAlive <= 8, `alive ${maxAlive} (> 8)`);
  check(maxThreat <= 10, `threat ${maxThreat} (> 10)`);
  check(max60 <= 4, `${max60} spawns in 60 frames (> 4)`);
  console.log(`  minion flood: max alive ${maxAlive}, threat ${maxThreat}, ${max60} spawns/60 f`);
}

// Beams and clones replace; traps + zones ≤ 3; hp entities ≤ 3 with a 300-frame cooldown after death.
{
  const o = fakeFighter(0);
  const game = fakeGame([o, fakeFighter(1)]);
  spawn(game, o, { kind: 'beam', life: 60 }, 1, 'ray');
  tick(game, 20);
  const r = spawn(game, o, { kind: 'beam', life: 60 }, 1, 'ray2');
  check(r.count === 1 && r.expire.length === 1 && mine(game, o).filter((e) => e.kind === 'beam').length === 1, 'a new beam replaces the old one');
  tick(game, 60);
  spawn(game, o, { kind: 'clone', life: 600, hp: 25 }, 1, 'twin');
  tick(game, 60);
  spawn(game, o, { kind: 'clone', life: 600, hp: 25 }, 1, 'twin');
  check(mine(game, o).filter((e) => e.kind === 'clone').length === 1, 'clone ≤ 1');
  for (let i = 0; i < 6; i++) { spawn(game, o, { kind: 'trap', life: 900 }, 1, 'mine'); tick(game, 16); }
  check(mine(game, o).filter((e) => e.kind === 'trap' || e.kind === 'zone').length <= 3, 'traps + zones ≤ 3');
  const g2 = fakeGame([fakeFighter(0), fakeFighter(1)]);
  const o2 = g2.fighters[0];
  for (let i = 0; i < 5; i++) { spawn(g2, o2, { kind: 'minion', life: 900, hp: 10 }, 1, 'golem' + i); tick(g2, 16); }
  check(mine(g2, o2).length <= 3, 'hp entities ≤ 3');
  g2.gov.entityDied(o2, 'golem4', { hp: 10 });
  tick(g2, 100);
  check(g2.gov.spawnRequest(o2, { kind: 'minion', hp: 10 }, 1, { name: 'golem4' }).count === 0, 'hp template on cooldown after death');
  tick(g2, 201);
  check(g2.gov.spawnRequest(o2, { kind: 'minion', hp: 10 }, 1, { name: 'golem4', live: [] }).count === 1, 'cooldown ends after 300 frames');
}

// DoT stack: 10 burn statuses per hit → ≤ 2 DoTs, ≤ 4 statuses per target; ≤ 10 dmg per application.
{
  const a = fakeFighter(0), b = fakeFighter(1), t = fakeFighter(2);
  const game = fakeGame([a, b, t]);
  for (let i = 0; i < 10; i++) {
    const r = game.gov.statusRequest(a, t, `burn${i}`, { frames: 9999, dot: { every: 1, damage: 99 } });
    if (r.ok) t.statuses.push({ name: `burn${i}`, def: { dot: r.dot }, source: a.id, frames: r.frames });
  }
  check(t.statuses.length === 2, `${t.statuses.length} DoTs on target (> 2)`);
  const d = t.statuses[0];
  check(d.def.dot.every >= 15 && d.def.dot.damage <= 0.5, `DoT rate clamped (${JSON.stringify(d.def.dot)})`);
  check(Math.floor(d.frames / d.def.dot.every) * d.def.dot.damage <= 10, `DoT total per application ≤ 10 (${d.frames} f)`);
  for (let i = 0; i < 5; i++) {
    const r = game.gov.statusRequest(i < 2 ? a : b, t, `mark${i}`, { frames: 60 });
    if (r.ok) t.statuses.push({ name: `mark${i}`, def: {}, source: (i < 2 ? a : b).id, frames: r.frames });
  }
  check(t.statuses.length === 4, `${t.statuses.length} statuses on target (> 4)`);
  check(t.statuses.filter((s) => s.source === a.id).length <= 3, '≤ 3 statuses from one owner');
  check(game.gov.statusRequest(a, t, 'burn0', { frames: 60, dot: { every: 15, damage: 0.5 } }).ok, 'refreshing an existing status is allowed');
  check(!game.gov.statusRequest(b, a, 'regen', { frames: 60, heal: { every: 30, amount: 1 } }).ok, 'heal statuses are self-only');
}

// Stun-lock: a stun on repeat → stun ≤ 40, immunity 180, control ≤ 90 per 600, reapply halves.
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t]);
  const r1 = game.gov.statusRequest(a, t, 'stun', { frames: 300, control: 'stun' });
  check(r1.ok && r1.frames === 40, `stun capped at 40 (got ${r1.frames})`);
  let granted = 0;
  const log = [[game.frame, r1.frames]];
  for (let i = 0; i < 1200; i++) {
    tick(game);
    const r = game.gov.statusRequest(a, t, 'stun', { frames: 40, control: 'stun' });
    if (r.ok) { granted++; log.push([game.frame, r.frames]); }
  }
  let max600 = 0;
  for (const [f0] of log) { let s = 0; for (const [f, n] of log) if (f >= f0 && f < f0 + 600) s += n; max600 = Math.max(max600, s); }
  check(max600 <= 90, `control ${max600} frames per 600 (> 90)`);
  check(log.every(([f], i) => i === 0 || f - log[i - 1][0] >= log[i - 1][1] + 180), 'stun immunity (frames + 180) holds between stuns');
  const t3 = fakeFighter(3);
  const g3 = fakeGame([a, t3]);
  g3.gov.statusRequest(a, t3, 'stun', { frames: 20, control: 'stun' });
  tick(g3, 30);
  check(!g3.gov.statusRequest(a, t3, 'freeze', { frames: 30, control: 'freeze' }).ok, 'freeze shares stun immunity');
  console.log(`  stun spam: ${log.length} stuns in 1200 f, max ${max600} control frames/600`);
  const t2 = fakeFighter(2);
  const g2 = fakeGame([a, t2]);
  g2.gov.statusRequest(a, t2, 'root', { frames: 30, control: 'root' });
  tick(g2, 31);
  const rr = g2.gov.statusRequest(a, t2, 'silence', { frames: 100, control: 'silence' });
  check(rr.frames === 50, `reapplying control within 300 f halves it (got ${rr.frames})`);
  const c = g2.gov.statusRequest(a, fakeFighter(3), 'confuse', { frames: 300, control: 'confuse' });
  check(c.frames === 90, `confuse ≤ 90 (got ${c.frames})`);
}

// A pure control lock (grab hold, no hits) BREAKs at lock ≥ 180.
{
  const a = fakeFighter(0), t = fakeFighter(1);
  const game = fakeGame([a, t]);
  game.gov.applyHit({ attacker: a, target: t, hb: { damage: 1, angle: 45, knockback: 1, growth: 1 }, tier: 'jab', dir: 1 });
  t.state = 'grabbed';
  let at = -1;
  for (let i = 0; i < 300 && at < 0; i++) { tick(game); if (game.events.some((e) => e.type === 'break')) at = i + 1; }
  check(at === 180, `control lock BREAKs at 180 frames (got ${at})`);
  check(game.gov.immuneTo(t, 'grab') && !game.gov.grabRequest(a, t, 60).ok, 'BREAK grants grab immunity');
}

done('entities-status');
