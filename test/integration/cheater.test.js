// Runtime cheater through the real pipeline (§10.2 #5, #7, #9, #10, #11, #20, #23 in one
// kit): a v2 character whose hooks spam every governed api call each frame. It must
// validate, play a 4-player match, and stay inside the Governor's budgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCharacter } from '../../shared/balance/validate.js';
import { Game } from '../../shared/sim/game.js';
import stage from '../../shared/stages/sky-sanctum.js';
import { loadChar } from './helpers.js';

const cheater = {
  version: 2, id: 'spammer', name: 'Spammer',
  stats: { weight: 9999, runSpeed: 99, airSpeed: 99, jumpHeight: 99, airJumps: 99, gravity: 0.01, fallSpeed: 1 },
  movement: { fly: { button: 'jump', fuel: 9999, thrust: 99 } },
  hitboxes: { zap: { damage: 999, angle: 45, knockback: 999, growth: 999, tier: 'special' } },
  entities: {
    bee: { kind: 'minion', life: 99999, hp: 999, motion: { type: 'homing', speed: 99, turn: 9 }, shape: { shape: 'circle', x: 0, y: 0, r: 200 },
           hitboxes: [{ shape: 'circle', x: 0, y: 0, r: 200, damage: 999, knockback: 999, growth: 999, rehit: 1 }] },
  },
  vars: { blob: '' },
  moves: {
    jab: { duration: 1, hitboxes: [{ start: 0, end: 99, shape: 'circle', x: 0, y: -40, r: 999, damage: 999, knockback: 999, growth: 999 }] },
  },
  behavior: {
    tick(view, api) {
      api.heal(99);
      api.intangible(999);
      api.armor(999, 99);
      api.velocity(0, -50);
      api.teleport(0, -500);
      for (let i = 0; i < 6; i++) api.modify(`buff${i}`, { damageOut: 2, damageIn: 0.1, speed: 9 });
      api.hit('zap', { shape: 'circle', x: 0, y: -40, r: 900 }, { frames: 99 });
      for (let i = 0; i < 50; i++) api.spawn('bee'); // overflows the 24-command cap
      api.emit('spam', { s: 'x'.repeat(10000) });
      api.vars.set('blob', 'y'.repeat(5000));
    },
  },
};

test('script-spamming cheater stays inside every runtime budget', async () => {
  const v = validateCharacter(cheater, { expectedId: 'spammer' });
  assert.equal(v.ok, true, v.errors.map(String).join('; '));
  const others = await Promise.all(['ember', 'nimbus', 'gertie'].map(async (id) => (await loadChar(id)).character));
  const game = new Game({
    stage, rules: { stocks: 3, seed: 3, scriptTiming: false },
    players: [v.character, ...others].map((c, i) => ({ id: `p${i}`, name: c.id, character: c, cpu: 'hard' })),
  });
  const cheat = game.fighters[0];
  let maxAlive = 0, healed = 0, maxDamage = 0, snapMax = 0;
  const gov = {};
  for (let i = 0; i < 60 * 60 && game.phase !== 'ended'; i++) {
    const before = cheat.percent;
    game.step();
    if (cheat.percent < before && cheat.state !== 'respawn' && cheat.state !== 'dead') healed += before - cheat.percent;
    for (const e of game.drainEvents()) {
      if (e.type === 'gov') gov[e.rule] = (gov[e.rule] || 0) + 1;
      if (e.type === 'hit' && e.attacker === cheat.id) maxDamage = Math.max(maxDamage, e.damage);
    }
    maxAlive = Math.max(maxAlive, game.entities.filter((e) => e.ownerIdx === 0 && !e.dead).length);
    for (const f of game.fighters) {
      for (const k of ['x', 'y', 'vx', 'vy', 'percent']) assert.ok(Number.isFinite(f[k]), `${f.charId}.${k}`);
      assert.ok(f.percent >= 0 && f.percent <= 999);
    }
    if (i % 120 === 0) snapMax = Math.max(snapMax, JSON.stringify(game.snapshot()).length);
  }
  if (process.env.VERBOSE) console.log({ maxAlive, maxDamage, healed, snapMax, gov, mods: cheat.mods });
  assert.ok(maxAlive <= 8, `alive entities ${maxAlive}`);
  assert.ok(maxDamage <= 25, `max hit ${maxDamage}`);
  assert.ok(healed <= 45 * 4, `healed ${healed}`);
  assert.ok(snapMax <= 6144, `snapshot ${snapMax} B`);
  assert.ok(cheat.mods.damageOut <= 1.15 + 1e-9 && cheat.mods.damageIn >= 0.85 - 1e-9, `mods ${JSON.stringify(cheat.mods)}`);
  assert.ok(gov.spawnRate > 0 && gov.teleport > 0 && gov.intangible > 0, JSON.stringify(gov));
  assert.ok(gov.scriptCommands > 0, 'command cap never fired');
  assert.equal(!!cheat.scriptsDisabled, false, 'governed spam is not a fault');
});
