// Shared setup for entity tests (WP-G): a v2 test character built through the
// real pipeline (normalize → buildIR) from the Gloop fixture plus one entity per
// motion type / collide mode / special rule, and small Game helpers.
import { normalize } from '../../shared/char/normalize-v2.js';
import { buildIR } from '../../shared/char/ir.js';
import { Game } from '../../shared/sim/game.js';
import stage from '../../shared/stages/sky-sanctum.js';
import gloop from '../fixtures/gloop/character.js';

export { stage };

const hit = (o = {}) => ({ shape: 'circle', x: 0, y: 0, r: 10, damage: 5, angle: 45, knockback: 20, growth: 40, ...o });

export const EXTRA_ENTITIES = {
  ball: { kind: 'projectile', shape: { shape: 'circle', r: 8 }, life: 120, motion: { type: 'ballistic', gravity: 0.5 }, hitboxes: [hit()] },
  dart: { kind: 'projectile', shape: { shape: 'circle', r: 6 }, life: 100, motion: { type: 'linear', speed: 4, accel: 0.5, maxSpeed: 10 }, collide: 'pass', hitboxes: [hit({ r: 8 })] },
  seeker: { kind: 'projectile', shape: { shape: 'circle', r: 6 }, life: 200, collide: 'pass', motion: { type: 'homing', speed: 6, turn: 0.12, delay: 5, wobble: 0.04 }, hitboxes: [hit()] },
  moon: { kind: 'projectile', shape: { shape: 'circle', r: 6 }, life: 200, collide: 'pass', motion: { type: 'orbit', radius: 70, speed: 0.1 }, hitboxes: [hit()] },
  rang: { kind: 'projectile', shape: { shape: 'circle', r: 8 }, life: 200, collide: 'pass', motion: { type: 'boomerang', speed: 8, out: 15, back: 9 }, hitboxes: [hit()] },
  stake: { kind: 'trap', shape: { shape: 'rect', x: 0, y: -10, w: 30, h: 20 }, life: 300, motion: { type: 'stationary', snapToGround: true }, hitboxes: [hit({ shape: 'rect', x: 0, y: -10, w: 30, h: 20, rehit: 60 })] },
  golem: { kind: 'minion', shape: { shape: 'circle', x: 0, y: -14, r: 14 }, life: 900, hp: 10, motion: { type: 'walker', speed: 3 }, hitboxes: [hit({ y: -14, r: 16, rehit: 30 })] },
  platGolem: { kind: 'minion', shape: { shape: 'circle', x: 0, y: -14, r: 14 }, life: 900, hp: 10, platforms: true, motion: { type: 'walker', speed: 3 }, hitboxes: [] },
  wave: { kind: 'projectile', shape: { shape: 'circle', r: 10 }, life: 240, platforms: true, motion: { type: 'ballistic', gravity: 0.5 }, collide: 'walk', hitboxes: [hit()] },
  bouncer: { kind: 'projectile', shape: { shape: 'circle', r: 8 }, life: 240, motion: { type: 'ballistic', gravity: 0.6 }, collide: 'bounce', maxBounces: 2, hitboxes: [hit()] },
  sticky: { kind: 'projectile', shape: { shape: 'circle', r: 8 }, life: 90, motion: { type: 'ballistic', gravity: 0.6 }, collide: 'stick', hitboxes: [hit()] },
  platDie: { kind: 'projectile', shape: { shape: 'circle', r: 8 }, life: 200, platforms: true, motion: { type: 'ballistic', gravity: 0.5 }, hitboxes: [hit()] },
  laser: { kind: 'beam', shape: { shape: 'capsule', x1: 0, y1: 0, x2: 200, y2: 0, r: 10 }, life: 90, length: 200, width: 10, anchor: { x: 30, y: -40 },
    motion: { type: 'attached' }, hitboxes: [hit({ shape: 'capsule', x1: 0, y1: 0, x2: 200, y2: 0, r: 10, damage: 2, knockback: 6, growth: 0, rehit: 8 })] },
  clasher: { kind: 'projectile', shape: { shape: 'circle', r: 10 }, life: 120, collide: 'pass', clash: true, motion: { type: 'linear', speed: 5 }, hitboxes: [] },
  drill: { kind: 'projectile', shape: { shape: 'circle', r: 10 }, life: 120, collide: 'pass', pierce: 1, motion: { type: 'linear', speed: 0 }, hitboxes: [hit({ r: 14 })] },
  tough: { kind: 'projectile', shape: { shape: 'circle', r: 10 }, life: 120, collide: 'pass', clank: false, motion: { type: 'linear', speed: 0 }, hitboxes: [] },
  bulb: { kind: 'zone', shape: { shape: 'circle', r: 10 }, life: 100, motion: { type: 'stationary' }, every: { frames: 30, spawn: 'dart' }, hitboxes: [] },
  shell: { kind: 'part', shape: { shape: 'circle', x: 0, y: 0, r: 18 }, relay: 0.5, hp: 20, life: 600, motion: { type: 'attached' }, anchor: { x: 50, y: -40 } },
  arm: { kind: 'part', shape: { shape: 'circle', x: 0, y: 0, r: 18 }, relay: 1, life: 600, motion: { type: 'attached' }, anchor: { x: 50, y: -40 } },
  // Sim P2: heading-rotated shapes, per-hitbox onHit lists, maxHits defaults per kind.
  needle: { kind: 'projectile', shape: { shape: 'circle', r: 4 }, life: 120, collide: 'pass', motion: { type: 'linear', speed: 6 },
    hitboxes: [hit({ shape: 'capsule', x1: -24, y1: 0, x2: 24, y2: 0, r: 4, onHit: [{ emit: 'pinged' }] })], onHit: [{ emit: 'entityHit' }] },
  plank: { kind: 'projectile', shape: { shape: 'circle', r: 4 }, life: 120, collide: 'pass', motion: { type: 'linear', speed: 6 }, hitboxes: [hit({ shape: 'rect', x: 0, y: 0, w: 60, h: 8 })] },
  spikeTrap: { kind: 'trap', shape: { shape: 'rect', x: 0, y: -10, w: 30, h: 20 }, life: 600, motion: { type: 'stationary' }, hitboxes: [hit({ shape: 'rect', x: 0, y: -10, w: 30, h: 20, rehit: 10 })] },
  multiTrap: { kind: 'trap', shape: { shape: 'rect', x: 0, y: -10, w: 30, h: 20 }, life: 600, maxHits: 3, motion: { type: 'stationary' }, hitboxes: [hit({ shape: 'rect', x: 0, y: -10, w: 30, h: 20, rehit: 10 })] },
  cloud: { kind: 'zone', shape: { shape: 'circle', r: 30 }, life: 300, motion: { type: 'stationary' }, hitboxes: [hit({ r: 30, rehit: 10, damage: 1, knockback: 0, growth: 0 })] },
  thug: { kind: 'minion', shape: { shape: 'circle', x: 0, y: -14, r: 14 }, life: 600, hp: 10, motion: { type: 'stationary' }, hitboxes: [hit({ y: -14, r: 20, rehit: 10, damage: 1, knockback: 0, growth: 0 })] },
  imp: { kind: 'minion', shape: { shape: 'circle', x: 0, y: -12, r: 12 }, life: 600, hp: 6, motion: { type: 'walker', speed: 2 }, hitboxes: [],
    think(view, e, api) { if (e.age === 3) api.command(e.id, { moveTo: { x: view.me.x - 300, y: 0 } }); } },
};

let IR = null;
/** The test character IR (built once). */
export function testChar() {
  if (IR) return IR;
  const def = { ...gloop, entities: { ...gloop.entities, ...EXTRA_ENTITIES } };
  const { draft, errors } = normalize(def);
  if (errors.length) throw new Error(`test character: ${errors.map((e) => `${e.code} ${e.path} ${e.why}`).join('; ')}`);
  IR = buildIR(draft);
  return IR;
}

/** Two (or more) idle test fighters, no countdown. */
export function newGame(rules = {}, n = 2) {
  const c = testChar();
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, character: c }));
  const game = new Game({ stage, rules: { countdown: false, stocks: 3, scriptTiming: false, ...rules }, players });
  game.step();
  game.drainEvents();
  return game;
}

/** Makes a fighter untouchable (motion tests). */
export const ghost = (f) => { f.invuln = 1e9; };

export function steps(game, n, each) {
  for (let i = 0; i < n; i++) { game.step(); if (each) each(i); }
  return game.drainEvents();
}

/** Puts f into a hand-made action with the given hitboxes (frame 1, 'attack'). */
export function forceAction(f, hitboxes, extra = {}) {
  const def = { category: 'special', duration: 60, effect: 'normal', velocity: [], hitboxes: hitboxes.map((h) => ({ start: 0, end: 60, group: 0, ...h })), ...extra };
  f.state = 'attack';
  f.stateFrame = 0;
  f.action = { def, name: extra.name || 'test', trigger: null, frame: 1, aerial: false, hitKeys: new Set(), hitSomething: false, chargeFrames: 0, charging: false, holdFrames: 0, loops: 0, counterArmed: false, counterIn: 0 };
  f.lastAction = f.action;
  return f.action;
}

export const live = (game, name) => game.entities.filter((e) => e.name === name && !e.dead && e.life > 0);
