// Docs ↔ engine contract: behaviours the guides promise (think spawns, hook events,
// view.budget, training URL, abort reasons, CI scope, guide examples) checked against
// the real code, so the prose can't silently drift again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCharacter } from '../../shared/balance/validate.js';
import { defineCharacter } from '../../shared/char/api.js';
import { STATS } from '../../shared/balance/rules.js';
import { Game } from '../../shared/sim/game.js';
import { effectiveStats } from '../../shared/sim/fighter.js';
import stage from '../../shared/stages/sky-sanctum.js';
import { trainingPlayers } from '../../client/train-url.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const GUIDE = read('docs/CHARACTER_GUIDE.md');

function build(def) {
  const r = validateCharacter(defineCharacter({ id: 'docs', name: 'Docs', ...def }), { expectedId: 'docs' });
  assert.ok(r.ok, r.errors.map(String).join('; '));
  return r;
}
function game(c, setup) {
  const g = new Game({ stage, rules: { countdown: false, stocks: 3, scriptTiming: false }, players: [{ id: 'p1', name: 'A', character: c }, { id: 'p2', name: 'B', character: c }] });
  setup?.(g);
  return g;
}

// ── §14: api.spawn in think starts at the entity ────────────────────────────
test('think api.spawn: x/y relative to the entity, owner-facing mirror, facing/angle/target opts', () => {
  const at = { 5: ['mark', { x: 0, y: 0 }], 70: ['mark', { x: 20, y: -10 }], 135: ['dart', { vx: 5, vy: 0 }],
    200: ['dart', { vx: 5, vy: 0, facing: 1 }], 265: ['dart', { vx: 5, vy: 0, target: 'nearestEnemy' }], 330: ['dart', { vx: 5, vy: 0, angle: 90, facing: 1 }] };
  const { character } = build({
    behavior: { init(view, api) { api.spawn('turret', { x: -60, y: -20 }); } },
    entities: {
      turret: { kind: 'minion', life: 600, shape: { r: 10 }, motion: { type: 'stationary' },
        think(view, e, api) { const s = at[e.age]; if (s) api.spawn(s[0], { ...s[1], count: 3, spread: 30 }); } },
      mark: { kind: 'zone', life: 40, shape: { r: 6 }, motion: { type: 'stationary' }, hitboxes: [] },
      dart: { kind: 'projectile', life: 30, shape: { r: 4 }, collide: 'pass', motion: { type: 'linear', speed: 5 }, hitboxes: [] },
    },
  });
  const g = game(character);
  const owner = g.fighters[0];
  g.fighters[1].x = owner.x + 400;
  g.step();
  const mine = (e) => e.owner === owner.id;
  const turret = g.entities.find((e) => e.name === 'turret' && mine(e));
  assert.ok(turret, 'turret spawned from init');
  owner.facing = -1;
  const seen = [];
  const known = new Set(g.entities.map((e) => e.id));
  for (let i = 0; i < 360; i++) {
    g.step(); g.drainEvents();
    for (const e of g.entities) if (mine(e) && !known.has(e.id)) { known.add(e.id); seen.push({ name: e.name, x: e.x, y: e.y, vx: e.vx, vy: e.vy, tx: turret.x, ty: turret.y }); }
  }
  assert.equal(seen.length, 6, `one spawn per call (count/spread ignored): ${JSON.stringify(seen)}`);
  const [a, b, c, d, t, ang] = seen;
  assert.ok(Math.abs(a.x - a.tx) < 0.01 && Math.abs(a.y - a.ty) < 0.01, 'x/y 0 = at the entity');
  assert.ok(Math.abs(b.x - (b.tx - 20)) < 0.01 && Math.abs(b.y - (b.ty - 10)) < 0.01, 'offset mirrored by owner facing (-1)');
  assert.ok(c.vx < 0, 'vx mirrored by owner facing');
  assert.ok(d.vx > 0, 'facing: 1 overrides');
  assert.ok(t.vx > 0, 'target nearestEnemy aims at the enemy (to the right)');
  assert.ok(ang.vy > 4 && Math.abs(ang.vx) < 0.5, 'angle 90 = straight down');
});

// ── §16: hook ev and view.budget() keys match the guide ─────────────────────
test('onHit ev keys and view.budget() keys are exactly what §16 documents', () => {
  const evLine = GUIDE.match(/^`ev = \{([^}]*)\}`/m);
  assert.ok(evLine, 'guide has the ev line');
  const documented = evLine[1].replace(/\([^)]*\)/g, '').split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  const budgetLine = GUIDE.match(/\| `view\.budget\(\)` \|[^`]*`\{([^}]*)\}`/);
  assert.ok(budgetLine, 'guide has the view.budget row');
  const budgetDoc = budgetLine[1].split(',').map((s) => s.trim());
  const got = { ev: null, budget: null };
  const { character } = build({
    moves: { jab: { duration: 20, hitboxes: [{ start: 3, end: 5, x: 30, y: -40, r: 20, damage: 3, angle: 45, knockback: 10, growth: 10 }] } },
    behavior: { onHit(view, api, ev) { got.ev ??= Object.keys(ev); got.budget ??= Object.keys(view.budget()); } },
  });
  const g = game(character);
  g.fighters[1].x = g.fighters[0].x + 40 * g.fighters[0].facing;
  g.step();
  g.setInput('p1', { attack: true }); g.step(); g.setInput('p1', {});
  for (let i = 0; i < 20 && !got.ev; i++) g.step();
  assert.ok(got.ev, 'onHit ran');
  assert.deepEqual([...got.ev].sort(), documented.filter((k) => k !== 'attackerId').sort());
  assert.ok(!GUIDE.includes('killed'), 'no undocumented-but-dead killed flag');
  assert.deepEqual([...got.budget].sort(), [...budgetDoc].sort());
});

// ── W110 workaround: slower than the stat minimum via api.modify ───────────
test('W110 route: api.modify speed 0.6 in init makes a min-runSpeed fighter slower, with no W-notes', () => {
  const r = build({
    stats: { runSpeed: STATS.runSpeed.min },
    behavior: { init(view, api) { api.modify('heavy', { speed: 0.6 }); } },
  });
  assert.deepEqual(r.notes.filter((n) => n.severity === 'warn').map(String), []);
  const g = game(r.character);
  g.step(); g.step();
  const s = effectiveStats(g.fighters[0]);
  assert.ok(Math.abs(s.runSpeed - STATS.runSpeed.min * 0.6) < 1e-6, `runSpeed ${s.runSpeed}`);
});

// ── §9 example moves validate with 0 W-notes ────────────────────────────────
test('guide §9 example moves load with 0 W-notes', () => {
  const sec = GUIDE.slice(GUIDE.indexOf('## 9. Moves'));
  const src = sec.match(/```js\n(moves: \{[\s\S]*?\n\})\n```/)[1];
  const def = new Function(`return { ${src},
    resources: { charge: { max: 100 } },
    entities: { bolt: { kind: 'projectile', life: 40, shape: { r: 6 }, motion: { type: 'linear', speed: 6 }, hitboxes: [{ r: 8, damage: 4, angle: 40, knockback: 10, growth: 20 }] } } };`)();
  const r = build(def);
  assert.deepEqual(r.notes.filter((n) => n.severity === 'warn').map(String), []);
});

// ── Training deep link (/?train=<id>&cpu=…&vs=…) ────────────────────────────
test('training URL: dummy by default, &cpu=hard for a hard CPU, &vs picks the opponent', () => {
  const has = (id) => ['a', 'b'].includes(id);
  assert.equal(trainingPlayers('?train=zz', has), null);
  assert.equal(trainingPlayers('', has), null);
  assert.deepEqual(trainingPlayers('?train=a', has)[1], { id: 'p1', name: 'Dummy', charId: 'a', cpu: 'dummy' });
  const hard = trainingPlayers('?train=a&cpu=hard&vs=b', has);
  assert.deepEqual(hard[0], { id: 'p0', name: 'You', charId: 'a', source: 'any' });
  assert.equal(hard[1].cpu, 'hard'); assert.equal(hard[1].charId, 'b');
  assert.equal(trainingPlayers('?train=a&cpu=godlike&vs=nope', has)[1].cpu, 'dummy');
  for (const doc of ['CLAUDE.md', 'docs/CHARACTER_GUIDE.md', 'README.md']) assert.ok(read(doc).includes('cpu=hard'), `${doc} documents &cpu=hard`);
  assert.ok(!/\?train=<id>`\) against a hard CPU/.test(GUIDE));
});

// ── README: every match:aborted reason the server can send ──────────────────
test('README lists every match:aborted reason', () => {
  const src = read('server/room-worker.js');
  const reasons = new Set([...src.matchAll(/reason: '(\w+)'/g)].map((m) => m[1]));
  assert.ok(reasons.has('crashed'));
  const readme = read('README.md');
  for (const r of reasons) assert.ok(readme.includes(`\`${r}\``), `README lists reason ${r}`);
});

// ── CI scope: characters/_template counts as outside a character folder ─────
test('CI scope job: _template edits are outside, one character folder passes', () => {
  const yml = read('.github/workflows/validate.yml');
  const outside = yml.match(/^\s*(outside=\$\(.*\))$/m)[1];
  const folders = yml.match(/^\s*(folders=\$\(.*\))$/m)[1];
  const run = (changed) => JSON.parse(execFileSync('bash', ['-c', `changed="$1"\n${outside}\n${folders}\nprintf '{"outside":"%s","folders":"%s"}' "$(echo $outside)" "$(echo $folders)"`, 'x', changed]).toString());
  assert.deepEqual(run('characters/_template/character.js'), { outside: 'characters/_template/character.js', folders: '' });
  assert.deepEqual(run('characters/frost/character.js\ncharacters/frost/art.js'), { outside: '', folders: 'frost' });
  assert.equal(run('characters/frost/a.js\nshared/x.js').outside, 'shared/x.js');
});

// ── Art: the host does not scale draw by bodyScale (COOKBOOK §8, ART_GUIDE A2) ─
test('art docs say draw is not pre-scaled by bodyScale', () => {
  const host = read('client/render/art-host.js');
  const paint = host.slice(host.indexOf('  paint('), host.indexOf('\n  }\n', host.indexOf('  paint(')));
  assert.ok(paint.includes('setTransform(zoom * facing, 0, 0, zoom'), 'paint only applies zoom and facing');
  assert.ok(!/bodyScale[^\n]*scale\(|scale\([^)]*bodyScale/.test(paint), 'paint does not scale by bodyScale');
  assert.ok(!read('docs/COOKBOOK.md').includes('host already applies the transform'));
  assert.ok(read('docs/ART_GUIDE.md').includes('does **not** apply `bodyScale` to `draw`'));
  assert.ok(!GUIDE.includes('relative to the owner fighter'));
});
