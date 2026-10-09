// Shared helpers for WP-H tests (movement, status, resources, forms).
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { Game } from '../../shared/sim/game.js';
import { BUTTONS } from '../../shared/constants.js';
import stage from '../../shared/stages/sky-sanctum.js';

export { stage };

/** v2 def → IR (throws on structural errors). */
export function ir(def) {
  const r = normalize({ version: 2, name: def.id, moves: { jab: { duration: 20 } }, ...def }, { expectedId: def.id });
  if (r.errors.length) throw new Error(JSON.stringify(r.errors));
  return buildIR(r.draft);
}

export async function fixture(id) {
  const def = (await import(`../fixtures/${id}/character.js`)).default;
  return buildIR(normalize(def, { expectedId: id }).draft);
}

/** Human-controlled match (no countdown). chars: IR list. */
export function game(chars, rules = {}) {
  return new Game({
    stage, rules: { countdown: false, stocks: 3, seed: 1, scriptTiming: false, ...rules }, // wall-clock faults off: determinism
    players: chars.map((c, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, character: c })),
  });
}

/** Steps n frames holding `buttons` for fighter p1 (others idle). Returns drained events. */
export function run(g, n, buttons = [], who = 'p1') {
  const input = Object.fromEntries(BUTTONS.map((b) => [b, buttons.includes(b)]));
  const ev = [];
  for (let i = 0; i < n; i++) { g.setInput(who, input); g.step(); ev.push(...g.drainEvents()); }
  return ev;
}

/** Steps until pred(f) or n frames; returns frames taken (or -1). */
export function until(g, pred, n = 300, buttons = [], who = 'p1') {
  const f = g.fighter(who);
  for (let i = 0; i < n; i++) { if (pred(f)) return i; run(g, 1, buttons, who); }
  return pred(f) ? n : -1;
}

/** Puts a fighter airborne at (x, y) with zero velocity in state 'air'. */
export function place(g, who, x, y, state = 'air') {
  const f = g.fighter(who);
  f.x = x; f.y = y; f.vx = 0; f.vy = 0; f.kx = 0; f.ky = 0;
  f.grounded = y === stage.ground.y && x >= stage.ground.x1 && x <= stage.ground.x2;
  f.platform = -1;
  g.setState(f, state);
  return f;
}
