// Shared helpers for the action-interpreter unit sims (WP-F).
// Characters are built straight from IR (normalize → buildIR) so the tests do not
// depend on the validator; small synthetic kits are made with `kit()`.
import { Game } from '../../shared/sim/game.js';
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import stage from '../../shared/stages/sky-sanctum.js';
import { BUTTONS } from '../../shared/constants.js';

export { stage };

/** IR for a v2 source definition (throws on normalize errors). */
export function ir(def) {
  const { draft, errors } = normalize(def);
  if (errors.length) throw new Error(`normalize: ${errors.map((e) => `${e.code} ${e.path} ${e.why}`).join('; ')}`);
  return buildIR(draft);
}

/** IR of a test fixture (test/fixtures/<id>/character.js). */
export async function fixture(id) {
  const mod = await import(`../fixtures/${id}/character.js`);
  const { draft, errors } = normalize(mod.default, { expectedId: id });
  if (errors.length) throw new Error(`${id}: ${errors.map((e) => e.code).join(',')}`);
  return buildIR(draft);
}

const BASE_STATS = { weight: 100, runSpeed: 6, airSpeed: 5, jumpHeight: 15, doubleJumpHeight: 13, airJumps: 1, gravity: 0.7, fallSpeed: 12 };
const FILL = { name: 'Filler', category: 'jab', duration: 16, hitboxes: [] };

/** Minimal v2 kit: `moves` merged over 16 filler moves; slots map each trigger to its own name. */
export function kit(moves = {}, extra = {}) {
  const all = {};
  for (const t of ['jab', 'side', 'up', 'down', 'sideSmash', 'upSmash', 'downSmash', 'nair', 'fair', 'bair', 'uair', 'dair', 'neutralSpecial', 'sideSpecial', 'upSpecial', 'downSpecial']) all[t] = { ...FILL };
  Object.assign(all, moves);
  return ir({
    version: 2, id: extra.id || 'kit', name: 'Kit', stats: { ...BASE_STATS, ...(extra.stats || {}) },
    body: { collider: { w: 50, h: 90 } }, moves: all, ...extra.def,
  });
}

/** A 2-player game (no countdown) with p1 = a, p2 = b; positions optional. */
export function duel(a, b, { rules = {}, x1 = -60, x2 = 60 } = {}) {
  const game = new Game({
    stage, rules: { countdown: false, governor: true, scriptTiming: false, ...rules },
    players: [{ id: 'p1', name: 'P1', character: a }, { id: 'p2', name: 'P2', character: b }],
  });
  const [f1, f2] = game.fighters;
  f1.x = x1; f2.x = x2; f1.facing = 1; f2.facing = -1;
  return game;
}

const none = Object.fromEntries(BUTTONS.map((k) => [k, false]));
/** Sets held buttons for fighter id ('p1'/'p2'): names listed are held, the rest released. */
export function hold(game, id, ...buttons) {
  const inp = { ...none };
  for (const b of buttons) inp[b] = true;
  game.setInput(id, inp);
}

export function steps(game, n, each) { for (let i = 0; i < n; i++) { game.step(); if (each) each(game, i); } }

export let failures = 0;
export function check(cond, msg) {
  if (!cond) { failures++; console.error(`  ✘ ${msg}`); }
  return !!cond;
}
