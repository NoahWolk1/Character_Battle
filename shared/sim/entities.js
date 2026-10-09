// ─────────────────────────────────────────────────────────────────────────────
// entities.js — projectiles, minions, traps, zones, beams, clones, parts (spec §3.9).
// Owned by WP-G.
//
// STORE: game.entities — array in ascending id order (= iteration order).
//        game.nextEntityId — game-wide counter (starts at 1).
//
// Two record flavors share the store:
//  • v1 records (no `kind`): v1 inline projectiles, and IR entities with
//    `legacy.v1` (normalize-v1). Bit-identical v1 behavior (golden replays):
//    { id, owner, slot, x, y, vx, vy, gravity, life, maxLife, r, facing, damage, angle,
//      knockback, growth, style, color, color2, spin, effect, charId }
//  • v2 records (§3.9): { id, owner (fighter id), ownerIdx, authorIdx (whose def/art; kept on reflect), name, def, kind, charId, x, y,
//    vx, vy, angle (deg), age, life, maxLife, hp, maxHp, hits, bounces, facing, tier,
//    hitKeys: Set, vars, bindToMove (bool; the ActionInst is the hidden `bind`), stuck,
//    reflected, dead, slot (staleness/event name), effect, len (beams), scale, surface
//    (walk: -1 main ground, i platform, null airborne), minor (clones: minor fighter) }
//    snapshot.js (WP-J) serializes both; projectilesV1() picks the v1 records.
//
// CONTRACT:
//   init(game)
//   spawnProjectile(f, p, effect?)   v1 inline projectile `p` from f's current action.
//   spawn(owner, name, opts) -> entity|null   §3.9 spawn. owner: fighter or minor
//                     (budgets are the root owner's). opts: {x, y, vx, vy, count, spread,
//                     aimAt|target, angle, worldX, worldY, facing, bindToMove,
//                     source: 'action'|'script'|'entity'|'every', from: entity}.
//                     Returns the first spawned entity.
//   despawn(game, e, reason?)        mark dead (removed at the next sweep; no lists run).
//   command(game, e, {target?, moveTo?})   api.command (homing target / walker goal).
//   update(game)       §3.2 step 2 in id order: motion → think (+ owner flush) → every →
//                      stage collide → life/expire; clones run their minor fighter.
//   alive(e) -> bool
//   hitboxesOf(e) -> [{hb, shape (world), key}]   entity boxes vs fighters (hits.js loop).
//   bodyShapeOf(e) -> world shape     hurtShapesOf(e) -> world shapes ([] = can't be hit)
//   onHitConnect(game, e, target) -> bool   true = entity is spent (stop this frame).
//   clank(game, e, by)                melee destroyed it.
//   meleeVsEntities(game, a, boxes, hits)   a fighter's (or clone's) active boxes vs enemy
//                      entities: v1 clank, reflect, absorb, hp damage, part relay, clone hits.
//   collectHits(game, alive, hits)    hits.js hook after the entity loop: clone attacks,
//                      entity boxes vs hurtable enemy entities / clones / parts, clash.
//   sweep(game)       drop dead entities (keeps id order).
//   onOwnerKO(game, f)   despawn the owner's minions, clones, zones, beams, parts.
//   onActionEnd(f, inst) despawn entities bound to that action instance (bindToMove).
//
// Fairness: every spawn goes through Governor.spawnRequest (§4.2.8; expired entities are
// despawned); hp-entity deaths call Governor.entityDied (300-frame template cooldown).
// Runtime clamps mirror §4.1.3 (life, hp, speed, turn, gravity, offsets, count).
// No randomness: homing wobble is a deterministic function of (owner, id, age).
// ─────────────────────────────────────────────────────────────────────────────
import { COMBAT } from '../constants.js';
import * as RULES from '../balance/rules.js';
import { mirror, overlap, overlapAny, aabb, center } from './shapes.js';
import { hurtShapes, collider } from './hurtbox.js';
import { hash32 } from './rng.js';
import { createMinor, effectiveStats } from './fighter.js';
import { readInput, EMPTY_INPUT } from './input-map.js';
import { isIntangible } from './hits.js';
import * as states from './states.js';
import * as movement from './movement.js';
import * as physics from './physics.js';
import * as actions from './actions.js';
import * as status from './status.js';
import * as resources from './resources.js';
import * as script from './script-api.js';

// ── limits (§4.1.3; rules.js ENTITY_LIMITS / ENTITY_RULES win when present) ──
// Keys match the Governor TIER keys: zones split into burst `zone` / `zoneLingering`.
const KIND_DEFAULTS = {
  projectile: { maxSpeed: 14, maxLife: 240, maxHp: 6 },
  minion: { maxSpeed: 8, maxLife: 1200, maxHp: 20 },
  trap: { maxSpeed: 6, maxLife: 900, maxHp: 15 },
  zone: { maxSpeed: 14, maxLife: 30, maxHp: 0 },
  zoneLingering: { maxSpeed: 14, maxLife: 360, maxHp: 0 },
  beam: { maxSpeed: 0, maxLife: 90, maxHp: 0, maxLength: 520 },
  clone: { maxSpeed: Infinity, maxLife: 600, maxHp: 25 },
  part: { maxSpeed: 0, maxLife: Infinity, partLife: 900, maxHp: 25 },
};
export const ENTITY_KINDS = Object.freeze(['projectile', 'minion', 'trap', 'zone', 'beam', 'clone', 'part']);
const ER = RULES.ENTITY_RULES || {};
const rn = (v, d) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);
export const LIMITS = Object.freeze({
  maxOffset: rn(ER.maxSpawnOffset, 160), scriptReach: 600, maxCount: rn(ER.maxCount, 5), maxAlive: rn(ER.maxAlive, 8),
  everyMin: rn(ER.minEvery, 30), maxTurn: rn(ER.maxTurn, 0.12), maxGravity: 0.8, maxOrbitRadius: 160, maxOrbitSpeed: 0.3,
  bounceMul: 0.8, reflectMul: 1.1, maxDelay: 60, listDepth: 3, cloneHpDefault: 10, cloneScale: ER.cloneScale || [0.5, 1],
});
const OWNER_BOUND = new Set(['minion', 'clone', 'zone', 'beam', 'part']);   // despawn on owner KO
const MOVING = new Set(['ballistic', 'linear', 'homing', 'boomerang', 'walker']);

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isV1 = (e) => !e.kind;
const isLingering = (def) => !(num(def.life) <= 30 && !(def.hitboxes || []).some((h) => h && h.rehit));

/** Limits row / runtime tier key of an entity def (Governor TIER keys). */
export function kindTier(def) {
  const k = ENTITY_KINDS.includes(def.kind) ? def.kind : 'projectile';
  return k === 'zone' && isLingering(def) ? 'zoneLingering' : k;
}

const limCache = new WeakMap();
function limitsOf(def) {
  let l = limCache.get(def);
  if (l) return l;
  const key = kindTier(def);
  const d = KIND_DEFAULTS[key];
  const r = (RULES.ENTITY_LIMITS || {})[key] || {};
  l = {};
  for (const k of Object.keys(d)) l[k] = rn(r[k], d[k]);
  limCache.set(def, l);
  return l;
}

// ── store ───────────────────────────────────────────────────────────────────
export function init(game) {
  game.entities = [];
  game.nextEntityId = 1;
}

const rootOf = (f) => (f && f.minorOf) || f;
function ownerOf(game, e) {
  const f = typeof e.ownerIdx === 'number' ? game.fighters[e.ownerIdx] : null;
  return f && f.id === e.owner ? f : game.fighters.find((x) => x.id === e.owner) || null;
}

export function alive(e) { return e.life > 0 && !e.dead; }

export function sweep(game) { game.entities = game.entities.filter((p) => p.life > 0 && !p.dead); }

// ── v1 projectiles (exact v1 arithmetic; golden replays) ────────────────────
export function spawnProjectile(f, p, effect) {
  const game = f.game;
  const a = f.action;
  const root = rootOf(f);
  const mine = game.entities.filter((q) => q.owner === root.id && !q.kind);
  if (mine.length >= COMBAT.maxProjectilesPerFighter) mine[0].life = 0;
  const fx = effect !== undefined ? effect : a.def.effect;
  const e = {
    id: game.nextEntityId++, owner: root.id, slot: a ? a.name : null,
    x: f.x + p.x * f.facing, y: f.y + p.y, vx: p.vx * f.facing, vy: p.vy,
    gravity: p.gravity, life: p.life, maxLife: p.life, r: p.r, facing: f.facing,
    damage: p.damage, angle: p.angle, knockback: p.knockback, growth: p.growth,
    style: p.style, color: p.color, color2: p.color2, spin: p.spin, effect: fx, charId: root.charId,
  };
  game.entities.push(e);
  game.emit({ type: 'projectile', id: root.id, x: f.x, y: f.y, effect: fx });
  return e;
}

/** IR entity converted from a v1 projectile (legacy.v1) → the exact v1 record. */
function spawnLegacy(f, def, opts) {
  const hb = (def.hitboxes && def.hitboxes[0]) || {};
  const rd = def.render || {};
  const p = {
    x: num(opts.x), y: num(opts.y), vx: num(opts.vx), vy: num(opts.vy),
    gravity: num(def.motion && def.motion.gravity), life: def.life, r: def.shape ? def.shape.r : 12,
    damage: hb.damage, angle: hb.angle, knockback: hb.knockback, growth: hb.growth,
    style: rd.style, color: rd.color, color2: rd.color2, spin: rd.spin,
  };
  return spawnProjectile(f, p, hb.effect !== undefined ? hb.effect : (f.action ? f.action.def.effect : null));
}

function updateV1(game, p) {
  const g = game.stage.ground;
  p.vy += p.gravity;
  p.x += p.vx;
  p.y += p.vy;
  p.life--;
  if (p.x > g.x1 && p.x < g.x2 && p.y + p.r > g.y && p.y - p.r < g.bottom) {
    p.life = 0;
    game.emit({ type: 'fizzle', x: p.x, y: p.y, effect: p.effect, color: p.color });
  }
}

// ── geometry helpers ───────────────────────────────────────────────────────
const offCache = new WeakMap(); // def.shape → {top, bottom, half} (local)
function shapeOffsets(def) {
  const s = def.shape || { shape: 'circle', x: 0, y: 0, r: 10 };
  let o = offCache.get(s);
  if (!o) {
    const b = aabb({ shape: s.shape, x: num(s.x), y: num(s.y), r: num(s.r, 10), w: num(s.w, 20), h: num(s.h, 20), ...(s.shape === 'capsule' ? { x1: num(s.x1), y1: num(s.y1), x2: num(s.x2), y2: num(s.y2) } : null) });
    o = { top: b.y1, bottom: b.y2, half: Math.max(Math.abs(b.x1), Math.abs(b.x2)) };
    offCache.set(s, o);
  }
  return o;
}

const worldShape = (e, s) => mirror(s, e.facing, e.scale || 1, e.x, e.y);

// Free-flying motions point their hit/hurt shapes along the heading (+x = forward);
// attached/orbit/walker/stationary shapes stay upright (mirrored by facing only).
const ROTATING = new Set(['ballistic', 'linear', 'homing', 'boomerang']);
const DEG = Math.PI / 180;

/** Rotation (rad) of an entity's mirrored local shapes: heading relative to its facing. */
export function headingRot(e) {
  if (isV1(e) || e.minor || !ROTATING.has(e.def.motion && e.def.motion.type)) return 0;
  if (!e.vx && !e.vy && !e.stuck) return 0; // never moved: no heading yet
  const a = (((e.facing < 0 ? e.angle - 180 : e.angle) % 360) + 540) % 360 - 180; // integer degrees
  return a * DEG;
}

/** World shape rotated about the entity origin. Rects become capsules along their long axis. */
function rotShape(e, s, rot) {
  const w = worldShape(e, s);
  if (!rot) return w;
  const c = Math.cos(rot), n = Math.sin(rot);
  const rx = (x, y) => e.x + (x - e.x) * c - (y - e.y) * n;
  const ry = (x, y) => e.y + (x - e.x) * n + (y - e.y) * c;
  if (w.shape === 'circle') return { shape: 'circle', x: rx(w.x, w.y), y: ry(w.x, w.y), r: w.r };
  let x1, y1, x2, y2, r;
  if (w.shape === 'capsule') ({ x1, y1, x2, y2, r } = w);
  else if (w.w >= w.h) { r = w.h / 2; x1 = w.x1 + r; x2 = w.x2 - r; y1 = y2 = w.y; } else { r = w.w / 2; y1 = w.y1 + r; y2 = w.y2 - r; x1 = x2 = w.x; }
  return { shape: 'capsule', x1: rx(x1, y1), y1: ry(x1, y1), x2: rx(x2, y2), y2: ry(x2, y2), r };
}

export function bodyShapeOf(e) {
  if (isV1(e)) return { shape: 'circle', x: e.x, y: e.y, r: e.r };
  if (e.minor) return hurtShapes(e.minor)[0] || { shape: 'circle', x: e.x, y: e.y, r: 1 };
  return worldShape(e, e.def.shape || { shape: 'circle', x: 0, y: 0, r: 10 });
}

function localHurt(e) {
  const d = e.def;
  if (d.hurtbox && d.hurtbox.length) return d.hurtbox;
  if (e.kind === 'part' || e.maxHp > 0) return [d.shape || { shape: 'circle', x: 0, y: 0, r: 10 }];
  return null;
}

export function hurtShapesOf(e) {
  if (isV1(e) || !alive(e)) return [];
  if (e.minor) return hurtShapes(e.minor);
  const l = localHurt(e);
  if (!l) return [];
  const rot = headingRot(e);
  return l.map((s) => rotShape(e, s, rot));
}

const OFFENSIVE = new Set(['strike', 'wind']);

/** Active strike/wind boxes (vs fighters, hits.js). Reflect/absorb boxes act in collectHits. */
export function hitboxesOf(e) {
  if (isV1(e)) return [{ hb: e, shape: { shape: 'circle', x: e.x, y: e.y, r: e.r }, key: 'p' }];
  return activeBoxes(e, OFFENSIVE);
}

function activeBoxes(e, kinds) {
  if (e.minor || !alive(e)) return [];
  const list = e.def.hitboxes || [];
  const out = [];
  const t = e.age;
  const rot = headingRot(e);
  for (let i = 0; i < list.length; i++) {
    const hb = list[i];
    if (!kinds.has(hb.kind || 'strike')) continue;
    const s = num(hb.start, 0), en = hb.end === null || hb.end === undefined ? Infinity : hb.end;
    if (t < s || t > en) continue;
    const g = hb.group ?? i;
    const key = hb.rehit ? `${g}:${Math.floor((t - s) / hb.rehit)}` : `${g}`;
    out.push({ hb, shape: rotShape(e, hb, rot), key });
  }
  return out;
}

// Launch direction of an entity box: free-flying motions push along their travel, anchored
// ones (attached, orbit, stationary, parts, beams) along their facing.
const FACING_DIR = new Set(['attached', 'orbit', 'stationary']);
export function entityDir(e) {
  if (isV1(e) || !(e.kind === 'part' || e.kind === 'beam' || FACING_DIR.has(e.def.motion && e.def.motion.type || 'stationary'))) return Math.sign(e.vx) || e.facing || 1;
  return e.facing || 1;
}

function enemiesOf(game, root) {
  return game.fighters.filter((f) => f !== root && !f.eliminated && f.state !== 'dead' && f.state !== 'respawn');
}

function centerOf(f) { return { x: f.x, y: f.y - collider(f).h / 2 }; }

function nearestEnemy(game, root, x, y) {
  let best = null, bd = Infinity;
  for (const f of enemiesOf(game, root)) {
    const c = centerOf(f);
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

function targetOf(game, e, root, m) {
  if (e.cmd && e.cmd.target) {
    const t = game.fighters.find((f) => f.id === e.cmd.target);
    if (t && t !== root && !t.eliminated && t.state !== 'dead') return t;
  }
  if (m.target === 'owner') return root;
  return root ? nearestEnemy(game, root, e.x, e.y) : null;
}

// ── spawn (§3.9) ────────────────────────────────────────────────────────────
let listDepth = 0;

export function spawn(owner, name, opts = {}) {
  if (!owner || !owner.game) return null;
  const game = owner.game;
  const root = rootOf(owner);
  const defs = root.char && root.char.entities;
  const def = defs && typeof name === 'string' && Object.prototype.hasOwnProperty.call(defs, name) ? defs[name] : null;
  if (!def || root.eliminated) return null;
  if (def.legacy && def.legacy.v1) return spawnLegacy(owner, def, opts);
  const kind = ENTITY_KINDS.includes(def.kind) ? def.kind : 'projectile';
  if (kind === 'clone' && owner.minorOf) return null; // clones can't spawn clones (§3.9.2)
  const count = clamp(Math.floor(num(opts.count, 1)), 1, LIMITS.maxCount);

  // 1. Budget (§4.2.8): the Governor may expire older entities or refuse.
  let granted = count;
  const gov = game.gov;
  if (gov && typeof gov.spawnRequest === 'function') {
    const r = gov.spawnRequest(root, def, count, { name });
    for (const x of r.expire || []) despawn(game, x, 'budget');
    granted = r.count;
  } else {
    granted = localBudget(game, root, def, kind, name, count);
  }
  if (granted <= 0) return null;

  const src = opts.from || owner;
  const facing = opts.facing === 1 || opts.facing === -1 ? opts.facing : (src.facing || 1);
  const scripted = opts.source === 'script';
  const reach = scripted ? LIMITS.scriptReach : LIMITS.maxOffset;
  const ox = clamp(num(opts.x), -reach, reach), oy = clamp(num(opts.y), -reach, reach);
  let x = src.x + ox * facing, y = src.y + oy;
  const anchor = opts.from ? src : root; // world points are clamped around the spawning entity, else the fighter
  if (typeof opts.worldX === 'number' && Number.isFinite(opts.worldX)) x = clamp(opts.worldX, anchor.x - LIMITS.scriptReach, anchor.x + LIMITS.scriptReach);
  if (typeof opts.worldY === 'number' && Number.isFinite(opts.worldY)) y = clamp(opts.worldY, anchor.y - LIMITS.scriptReach, anchor.y + LIMITS.scriptReach);

  // Base velocity (forward = facing), then aim and spread.
  const m = def.motion || {};
  const hasV = (opts.vx !== null && opts.vx !== undefined) || (opts.vy !== null && opts.vy !== undefined);
  let vx = hasV ? num(opts.vx) * facing : num(m.speed) * facing;
  let vy = hasV ? num(opts.vy) : 0;
  if (typeof opts.angle === 'number' && Number.isFinite(opts.angle)) {
    const sp = Math.hypot(vx, vy) || num(m.speed);
    const r = (opts.angle * Math.PI) / 180;
    vx = Math.cos(r) * sp * facing; vy = Math.sin(r) * sp;
  }
  const aim = opts.aimAt || opts.target;
  if (aim === 'nearestEnemy') {
    const t = nearestEnemy(game, root, x, y);
    const sp = Math.hypot(vx, vy) || num(m.speed);
    if (t && sp > 0) {
      const c = centerOf(t);
      const r = Math.atan2(c.y - y, c.x - x);
      vx = Math.cos(r) * sp; vy = Math.sin(r) * sp;
    }
  }

  // 4. Tier: the spawning action's category, else the kind's tier (hooks, think, every).
  const fromAction = opts.source === undefined || opts.source === 'action';
  // Entity-driven spawns (think/every) never credit whatever move the owner happens to be doing.
  const act = opts.action || (opts.source === 'entity' || opts.source === 'every' ? null : owner.action);
  let tier = def.tier || null;
  if (!tier) {
    if (kind === 'clone' || kind === 'part') tier = kindTier(def);
    else if (owner.minorOf) tier = 'clone';
    else if (fromAction && typeof opts.tier === 'string') tier = opts.tier;
    else if (fromAction && act && act.def && act.def.category) tier = act.def.category;
    else tier = kindTier(def);
  }

  const spread = num(opts.spread);
  let first = null;
  for (let i = 0; i < granted; i++) {
    let evx = vx, evy = vy, ex = x;
    if (spread && granted > 1) {
      const d = (i - (granted - 1) / 2) * spread;
      if (vx || vy) {
        const r = (d * Math.PI) / 180 * facing;
        evx = vx * Math.cos(r) - vy * Math.sin(r); evy = vx * Math.sin(r) + vy * Math.cos(r);
      } else ex = x + d * facing;
    }
    const e = create(game, root, owner, name, def, kind, { x: ex, y, vx: evx, vy: evy, facing, tier, ox, oy, index: i, count: granted, opts, act });
    if (!first) first = e;
  }
  return first;
}

/** Ungoverned matches (rules.governor false): per-template maxAlive, one beam / clone. */
function localBudget(game, root, def, kind, name, count) {
  const mine = () => game.entities.filter((e) => e.owner === root.id && e.kind && alive(e));
  const maxTpl = clamp(Math.floor(num(def.maxAlive, LIMITS.maxAlive)), 1, LIMITS.maxAlive);
  for (let i = 0; i < count; i++) {
    let same = mine().filter((e) => e.name === name);
    while (same.length >= maxTpl) { despawn(game, same[0], 'budget'); same = same.slice(1); }
    if (kind === 'beam' || kind === 'clone') for (const e of mine()) if (e.kind === kind) despawn(game, e, 'budget');
    const all = mine();
    if (all.length + i >= LIMITS.maxAlive) despawn(game, all[0], 'budget');
  }
  return count;
}

function create(game, root, owner, name, def, kind, s) {
  const L = limitsOf(def);
  const m = def.motion || {};
  let life = Math.floor(num(def.life, 60));
  const relay = kind === 'part' ? clamp(num(def.relay, 1), 0.5, 1) : 1;
  let hp = Math.max(0, num(def.hp));
  if (kind === 'part') {
    if (relay < 1) { hp = clamp(hp || L.maxHp, 1, L.maxHp); life = clamp(life > 0 ? life : L.partLife, 1, L.partLife); } else life = life > 0 ? life : Infinity;
  } else {
    life = clamp(life > 0 ? life : 60, 1, L.maxLife);
    hp = kind === 'clone' ? clamp(hp || LIMITS.cloneHpDefault, 1, L.maxHp) : Math.min(hp, L.maxHp);
  }
  const vars = {};
  if (def.vars && typeof def.vars === 'object') {
    for (const k of Object.keys(def.vars).slice(0, 4)) { const v = def.vars[k]; if (['number', 'string', 'boolean'].includes(typeof v)) vars[k] = v; }
  }
  const hb0 = def.hitboxes && def.hitboxes[0];
  const act = s.act;
  const e = {
    id: game.nextEntityId++, owner: root.id, ownerIdx: root.index, authorIdx: root.index, name, def, kind, charId: root.charId,
    x: s.x, y: s.y, vx: s.vx, vy: s.vy, angle: 0, age: 0, life, maxLife: life, hp: hp > 0 ? hp : null, maxHp: hp, hits: 0, bounces: 0,
    facing: s.facing, tier: s.tier, hitKeys: new Set(), vars, bindToMove: false, stuck: false, reflected: false, dead: false,
    slot: typeof s.opts.slot === 'string' ? s.opts.slot : act ? act.name : name, effect: (hb0 && hb0.effect) || (act && act.def.effect) || null,
    len: 0, scale: 1, surface: null, relay, ax: s.ox, ay: s.oy, phase: 0, seed: (hash32(`${root.id}:${name}`) % 6283) / 1000,
    cmd: null, minor: null,
  };
  e.angle = Math.round((Math.atan2(e.vy, e.vx) * 180) / Math.PI);
  if (def.anchor) { e.ax = num(def.anchor.x); e.ay = num(def.anchor.y); } else if (m.offset) { e.ax = num(m.offset.x); e.ay = num(m.offset.y); }
  if (kind === 'beam') e.len = clamp(num(def.length, beamLength(def)), 0, L.maxLength);
  if (m.type === 'orbit') e.phase = (2 * Math.PI * s.index) / Math.max(1, s.count) + Math.atan2(s.oy, s.ox * s.facing || 1);
  if (s.opts.bindToMove && act) { e.bindToMove = true; Object.defineProperty(e, 'bind', { value: act, writable: true, enumerable: false }); }
  // Spawned by a clone: binding and anchoring follow the clone body, not the owner.
  if (owner !== root && owner.minorOf === root) Object.defineProperty(e, 'host', { value: owner, writable: true, enumerable: false });
  if (m.type === 'attached') placeAttached(e, e.host || root);
  if (m.type === 'stationary' && m.snapToGround) snapToGround(game, e);
  if (kind === 'clone') {
    const grounded = owner.grounded && Math.abs(s.y - owner.y) < 1;
    e.minor = createMinor(root, def, { id: `${root.id}#c${e.id}`, x: e.x, y: e.y, facing: e.facing, grounded });
    e.ring = [];
    e.delay = clamp(Math.floor(num(m.delay, 12)), 0, LIMITS.maxDelay);
  }
  game.entities.push(e);
  game.emit({ type: 'spawn', i: e.id, o: root.id, name, kind, x: Math.round(e.x), y: Math.round(e.y) });
  runList(game, e, def.onSpawn);
  return e;
}

function beamLength(def) {
  const s = def.shape;
  if (s && s.shape === 'capsule') return Math.hypot(num(s.x2) - num(s.x1), num(s.y2) - num(s.y1));
  if (s && s.shape === 'rect') return num(s.w);
  return 0;
}

// ── despawn / life ──────────────────────────────────────────────────────────
export function despawn(game, e, reason = 'despawn') {
  if (!e) return;
  if (isV1(e)) { e.life = 0; return; }
  if (e.dead) return;
  e.dead = true;
  e.life = 0;
  game.emit({ type: 'despawn', i: e.id, reason, x: Math.round(e.x), y: Math.round(e.y) });
}

/** hp reached 0: onDeath, despawn, Governor template cooldown (§4.2.8). */
function die(game, e, reason = 'death') {
  if (e.dead) return;
  runList(game, e, e.def.onDeath);
  despawn(game, e, reason);
  const root = ownerOf(game, e);
  if (root && game.gov && typeof game.gov.entityDied === 'function' && e.maxHp > 0) game.gov.entityDied(root, e.name, e.def);
}

export function command(game, e, cmd) {
  if (!e || isV1(e) || !cmd) return;
  e.cmd = { target: typeof cmd.target === 'string' ? cmd.target : null, moveTo: cmd.moveTo ? { x: num(cmd.moveTo.x), y: num(cmd.moveTo.y) } : null };
}

export function onOwnerKO(game, f) {
  for (const e of game.entities) if (e.owner === f.id && OWNER_BOUND.has(e.kind)) despawn(game, e, 'ownerKO');
}

export function onActionEnd(f, inst) {
  const game = f.game;
  if (!game || !game.entities) return;
  for (const e of game.entities) if (e.bind === inst) despawn(game, e, 'unbound');
}

// ── entity TimelineAction lists (onSpawn / onHit / onExpire / onDeath, every) ─
function runList(game, e, list) {
  if (!list || !list.length || listDepth >= LIMITS.listDepth || e.reflected) return;
  const root = ownerOf(game, e);
  if (!root) return;
  listDepth++;
  try {
    for (const t of list) {
      const a = t.args || {};
      switch (t.action) {
        case 'spawn':
          spawn(root, a.entity, { x: a.x, y: a.y, vx: a.vx, vy: a.vy, count: a.count, spread: a.spread, aimAt: a.aimAt, from: e, source: 'entity' });
          break;
        case 'emit': {
          let json = null;
          if (a.data !== null && a.data !== undefined) { try { json = JSON.stringify(a.data); } catch { json = null; } }
          if (json && json.length > 256) json = null;
          if (typeof script.emitFx === 'function') script.emitFx(root, 'fx', a.name, json, { i: e.id, x: Math.round(e.x), y: Math.round(e.y) });
          break;
        }
        case 'sfx': if (typeof script.emitFx === 'function') script.emitFx(root, 'sfx', a.sound ?? a.name); break;
        case 'camera': if (typeof script.emitFx === 'function') script.emitFx(root, 'camera', 'camera', null, { shake: a.shake }); break;
        case 'resource':
          if (a.set !== null && a.set !== undefined) resources.set(root, a.name, a.set);
          else if (a.add) resources.add(root, a.name, a.add);
          break;
        case 'status': if (root.state !== 'dead') status.apply(root, a.status ?? a.name, { source: root }); break;
        case 'hit': listHit(game, e, root, a); break;
        // Owner-side effects go through the owner's normal gates (form cooldown, speed/rise budget).
        case 'form': if (root.state !== 'dead' && root.state !== 'respawn') script.ownerCommand(root, { op: 'form', name: a.form }); break;
        case 'velocity': script.ownerCommand(root, { op: 'velocity', vx: a.vx ?? null, vy: a.vy ?? null, mode: a.mode === 'add' ? 'add' : 'set' }); break;
        case 'impulse': script.ownerCommand(root, { op: 'velocity', vx: num(a.vx), vy: num(a.vy), mode: 'add' }); break;
        default: // other timeline actions have no meaning for an entity (the validator notes them: W415)
      }
    }
  } finally { listDepth--; }
}

const LIST_HIT = { offset: 120, radius: 46 };

/**
 * Entity-list `hit` (and api.hit from think): a template box placed on the entity (its kind's
 * per-hit cap, owner credit). extra: addExtraHit opts (api.hit rehit floor).
 */
export function entityHit(game, e, root, a, extra = {}) { listHit(game, e, root, a, extra); }

function listHit(game, e, root, a, extra = {}) {
  const tpl = root.char.hitboxes && Object.prototype.hasOwnProperty.call(root.char.hitboxes, a.template) ? root.char.hitboxes[a.template] : null;
  if (!tpl || !a.shape || typeof a.shape !== 'object') return;
  const sh = { ...a.shape };
  for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) if (k in sh) sh[k] = clamp(num(sh[k]), -LIST_HIT.offset, LIST_HIT.offset);
  if ('r' in sh) sh.r = clamp(num(sh.r, 10), 1, LIST_HIT.radius);
  for (const k of ['w', 'h']) if (k in sh) sh[k] = clamp(num(sh[k], 10), 1, LIST_HIT.radius * 2);
  const L = RULES.ENTITY_LIMITS || {};
  const lim = e.kind === 'part' ? L.minion || {} : L[kindTier(e.def)] || {}; // parts (0-damage boxes) burst at the minion cap
  const frames = clamp(Math.floor(num(a.frames, 1)), 1, 20);
  const tier = e.kind === 'part' ? 'minion' : e.tier;
  const hb = {
    ...tpl, ...sh, kind: tpl.kind === 'wind' ? 'wind' : 'strike', tier, group: a.group ?? 0, start: 0, end: frames,
    damage: clamp(num(tpl.damage), 0, num(lim.maxHit, 6)),
  };
  script.addExtraHit(root, hb, { frames, group: a.group ?? 0, slot: e.slot, tier, effect: tpl.effect || e.effect, world: worldShape(e, sh), entity: e, ...extra });
}

// ── update (§3.2 step 2) ────────────────────────────────────────────────────
export function update(game) {
  const list = game.entities;
  const n = list.length;
  // Governor per-fighter windows (combo chain idle, armor/intangible/air) for clone minors:
  // Game.step's endFrame only walks game.fighters, so run it here (one frame later).
  if (game.gov && typeof game.gov.endFrame === 'function') {
    const minors = [];
    for (let i = 0; i < n; i++) if (list[i].minor && alive(list[i])) minors.push(list[i].minor);
    if (minors.length) game.gov.endFrame({ fighters: minors });
  }
  for (let i = 0; i < n; i++) {
    const e = list[i];
    if (isV1(e)) updateV1(game, e);
    else if (alive(e)) updateV2(game, e);
  }
  sweep(game);
}

function updateV2(game, e) {
  const def = e.def;
  const m = def.motion || {};
  const root = ownerOf(game, e);
  e.age++;
  const host = e.host ? (hostAlive(game, e.host) ? e.host : null) : root;
  if (e.host && !host) { despawn(game, e, 'ownerKO'); return; }
  if (e.bind && (!host || host.action !== e.bind)) { despawn(game, e, 'unbound'); return; }
  if (!root || (OWNER_BOUND.has(e.kind) && (root.eliminated || root.state === 'dead'))) { despawn(game, e, 'ownerKO'); return; }
  if (e.kind === 'beam' && (host || root).state === 'hitstun') { despawn(game, e, 'ownerHit'); return; }

  // motion
  const px = e.x, py = e.y;
  if (e.minor) { if (!stepClone(game, e, root)) return; } else if (!e.stuck) move(game, e, root, m, host);

  // think (owner's script budget/faults; flushes the owner). Reflected entities are pure projectiles.
  if (typeof def.think === 'function' && !root.scriptsDisabled && !e.reflected) {
    script.runThink(game, e, def.think, { contactId: contactOf(game, e, root) });
    if (!alive(e)) return;
  }

  // every
  const ev = def.every;
  if (ev && ev.spawn && !e.reflected) {
    const every = Math.max(LIMITS.everyMin, Math.floor(num(ev.frames, LIMITS.everyMin)));
    if (e.age % every === 0) spawn(root, ev.spawn, { x: ev.x, y: ev.y, vx: ev.vx, vy: ev.vy, aimAt: ev.aim, from: e, source: 'every' });
  }

  // stage collide
  if (!e.minor && !e.stuck && MOVING.has(m.type)) {
    collideStage(game, e, m, px, py);
    const b = game.stage.blast;
    if (alive(e) && (e.x < b.left || e.x > b.right || e.y > b.bottom || e.y < b.top)) despawn(game, e, 'blast');
  }
  if (!alive(e)) return;

  // life
  if (e.life !== Infinity && --e.life <= 0) {
    runList(game, e, def.onExpire);
    despawn(game, e, 'expire');
  }
}

function contactOf(game, e, root) {
  const body = bodyShapeOf(e);
  for (const f of enemiesOf(game, root)) if (overlapAny([body], hurtShapes(f))) return f.id;
  return null;
}

function capSpeed(e) {
  const max = limitsOf(e.def).maxSpeed;
  const sp = Math.hypot(e.vx, e.vy);
  if (sp > max && sp > 0) { const k = max / sp; e.vx *= k; e.vy *= k; }
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function steer(e, tx, ty, turn, speed) {
  let h = Math.atan2(e.vy, e.vx);
  if (!(e.vx || e.vy)) h = e.facing > 0 ? 0 : Math.PI;
  const d = wrapAngle(Math.atan2(ty - e.y, tx - e.x) - h);
  h += clamp(d, -turn, turn);
  e.vx = Math.cos(h) * speed; e.vy = Math.sin(h) * speed;
}

function accelerate(e, m) {
  const acc = num(m.accel);
  if (!acc) return;
  const sp = Math.hypot(e.vx, e.vy);
  const max = num(m.maxSpeed, Infinity);
  if (sp > 0) {
    const ns = clamp(sp + acc, 0, Math.max(max, 0));
    e.vx *= ns / sp; e.vy *= ns / sp;
  } else if (acc > 0) e.vx = Math.min(acc, max) * e.facing;
}

/** The clone entity of a minor fighter is still alive. */
function hostAlive(game, m) {
  for (const x of game.entities) if (x.minor === m) return alive(x);
  return false;
}

function move(game, e, root, m, host = root) {
  switch (m.type) {
    case 'ballistic':
      e.vy += clamp(num(m.gravity, 0.4), -LIMITS.maxGravity, LIMITS.maxGravity);
      break;
    case 'linear':
      accelerate(e, m);
      break;
    case 'homing': {
      accelerate(e, m);
      const sp = Math.hypot(e.vx, e.vy) || num(m.speed, 6);
      if (e.age <= num(m.delay, 0)) break;
      const t = targetOf(game, e, root, m);
      if (t) { const c = centerOf(t); steer(e, c.x, c.y, clamp(num(m.turn, 0.06), 0, LIMITS.maxTurn), sp); }
      const w = clamp(num(m.wobble), 0, 0.3);
      if (w) {
        const h = Math.atan2(e.vy, e.vx) + w * Math.sin(e.age * 0.35 + e.seed + e.id);
        e.vx = Math.cos(h) * sp; e.vy = Math.sin(h) * sp;
      }
      break;
    }
    case 'boomerang': {
      const out = Math.max(1, Math.floor(num(m.out, 20)));
      if (e.age <= out) { accelerate(e, m); break; }
      const c = centerOf(host);
      const back = num(m.back, Math.max(Math.hypot(e.vx, e.vy), num(m.speed, 8)));
      steer(e, c.x, c.y, 0.25, back);
      if (Math.hypot(c.x - e.x, c.y - e.y) <= Math.max(24, back + 4)) { despawn(game, e, 'caught'); return; }
      break;
    }
    case 'walker': walk(game, e, root, m); break;
    case 'orbit': {
      const r = clamp(num(m.radius, 60), 0, LIMITS.maxOrbitRadius);
      const sp = clamp(num(m.speed, 0.08), -LIMITS.maxOrbitSpeed, LIMITS.maxOrbitSpeed);
      const c = centerOf(host);
      const a = e.phase + e.age * sp;
      const nx = c.x + Math.cos(a) * r, ny = c.y + Math.sin(a) * r;
      e.vx = nx - e.x; e.vy = ny - e.y; e.x = nx; e.y = ny;
      e.facing = host.facing || 1;
      e.angle = Math.round((a * 180) / Math.PI) % 360;
      return;
    }
    case 'attached': placeAttached(e, host); return;
    default: return; // stationary
  }
  if (m.type !== 'walker' && e.surface !== null) rollOnSurface(game, e);
  if (m.type !== 'walker' || e.surface === null) { capSpeed(e); e.x += e.vx; e.y += e.vy; }
  if (e.vx > 0.01) e.facing = 1; else if (e.vx < -0.01) e.facing = -1;
  if (e.vx || e.vy) e.angle = Math.round((Math.atan2(e.vy, e.vx) * 180) / Math.PI);
}

function placeAttached(e, root) {
  const s = num(root.bodyScale, 1);
  e.facing = root.facing || 1;
  e.scale = s;
  const nx = root.x + e.ax * e.facing * s, ny = root.y + e.ay * s;
  e.vx = nx - e.x; e.vy = ny - e.y;
  e.x = nx; e.y = ny;
  e.angle = e.facing > 0 ? 0 : 180;
}

// ── surfaces ────────────────────────────────────────────────────────────────
function surfaceAt(game, idx) { return idx === -1 ? game.stage.ground : game.stage.platforms[idx]; }

function snapToGround(game, e) {
  const g = game.stage.ground;
  const off = shapeOffsets(e.def);
  let best = null, by = Infinity;
  if (e.x >= g.x1 && e.x <= g.x2 && e.y <= g.bottom) { best = -1; by = g.y; }
  const ps = game.stage.platforms || [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (e.x >= p.x1 && e.x <= p.x2 && p.y >= e.y - 1 && p.y < by) { best = i; by = p.y; }
  }
  if (best === null) return false;
  e.y = by - off.bottom;
  e.surface = best;
  return true;
}

/** Walker motion: gravity in the air; on a surface walk at `speed`, turning at ledges. */
function walk(game, e, root, m) {
  const off = shapeOffsets(e.def);
  if (e.surface === null) {
    e.vy = Math.min(num(m.maxSpeed, 14), e.vy + clamp(num(m.gravity, 0.6), 0, LIMITS.maxGravity));
    return;
  }
  const s = surfaceAt(game, e.surface);
  // goal: command moveTo, else motion.target, else keep walking
  let goal = e.cmd && e.cmd.moveTo ? e.cmd.moveTo.x : null;
  if (goal === null && m.target) { const t = targetOf(game, e, root, m); if (t) goal = t.x; }
  const speed = clamp(num(m.speed, 2), 0, limitsOf(e.def).maxSpeed);
  if (goal !== null) {
    if (Math.abs(goal - e.x) <= speed) { e.vx = 0; } else { e.facing = goal > e.x ? 1 : -1; e.vx = speed * e.facing; }
  } else e.vx = speed * e.facing;
  e.vy = 0;
  let nx = e.x + e.vx;
  if (nx < s.x1 || nx > s.x2) { // ledge: turn around
    nx = clamp(nx, s.x1, s.x2);
    e.facing = -e.facing;
    e.vx = -e.vx;
  }
  e.x = nx;
  e.y = s.y - off.bottom;
  e.angle = e.facing > 0 ? 0 : 180;
}

/** collide:'walk' on a non-walker (rolling wave): follow the floor, fall off its edge. */
function rollOnSurface(game, e) {
  const s = surfaceAt(game, e.surface);
  const off = shapeOffsets(e.def);
  e.vy = 0;
  if (!e.vx) e.vx = num(e.def.motion && e.def.motion.speed, 4) * e.facing;
  const nx = e.x + e.vx;
  if (nx < s.x1 || nx > s.x2) { e.surface = null; return; } // rolls off the edge
  e.y = s.y - off.bottom - e.vy;
}

function collideStage(game, e, m, px, py) {
  const mode = m.type === 'walker' ? 'walk' : (e.def.collide || 'die');
  if (mode === 'pass') return;
  if (mode === 'walk' && e.surface !== null) return;
  const g = game.stage.ground;
  const off = shapeOffsets(e.def);
  const b = aabb(bodyShapeOf(e));
  if (b.x2 > g.x1 && b.x1 < g.x2 && b.y2 > g.y && b.y1 < g.bottom) {
    const side = py + off.bottom <= g.y + 0.01 ? 'top' : py + off.top >= g.bottom - 0.01 ? 'bottom' : 'side';
    contact(game, e, mode, side, side === 'top' ? g.y : g.bottom, -1, px);
    return;
  }
  if (!e.def.platforms || e.vy < 0) return;
  const ps = game.stage.platforms || [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (e.x >= p.x1 && e.x <= p.x2 && py + off.bottom <= p.y + 0.01 && e.y + off.bottom >= p.y) {
      contact(game, e, mode, 'top', p.y, i, px);
      return;
    }
  }
}

function contact(game, e, mode, side, sy, idx, px) {
  const off = shapeOffsets(e.def);
  const g = game.stage.ground;
  const pushOut = () => {
    if (side === 'top') e.y = sy - off.bottom;
    else if (side === 'bottom') e.y = sy - off.top;
    else e.x = px < (g.x1 + g.x2) / 2 ? Math.min(e.x, g.x1 - off.half) : Math.max(e.x, g.x2 + off.half);
  };
  switch (mode) {
    case 'bounce':
      if (++e.bounces > num(e.def.maxBounces, 3)) break;
      pushOut();
      if (side === 'side') { e.vx = -e.vx * LIMITS.bounceMul; e.facing = -e.facing; } else e.vy = (side === 'top' ? -1 : 1) * Math.abs(e.vy) * LIMITS.bounceMul;
      game.emit({ type: 'ebounce', i: e.id, x: Math.round(e.x), y: Math.round(e.y) });
      return;
    case 'stick':
      pushOut();
      e.vx = 0; e.vy = 0; e.stuck = true;
      return;
    case 'walk':
      pushOut();
      if (side === 'top') { e.surface = idx; e.vy = 0; if (!e.vx) e.vx = num(e.def.motion && e.def.motion.speed, 2) * e.facing; } else if (side === 'side') { e.vx = -e.vx; e.facing = -e.facing; } else e.vy = Math.abs(e.vy) * 0.5;
      return;
    default: break; // die
  }
  game.emit({ type: 'fizzle', x: e.x, y: e.y, effect: e.effect, color: (e.def.render && e.def.render.color) || null, i: e.id });
  despawn(game, e, 'fizzle');
}

// ── clones (§3.9.2) ─────────────────────────────────────────────────────────
/** Runs the clone's minor fighter on the owner's delayed input. false = it died. */
function stepClone(game, e, root) {
  const m = e.minor;
  e.ring.push(root.state === 'dead' || root.state === 'respawn' ? EMPTY_INPUT : { ...root.input });
  const inp = e.ring.length > e.delay ? e.ring.shift() : EMPTY_INPUT;
  m.pendingInput = inp;
  if (m.form !== root.form) { m.form = root.form; m.stats = effectiveStats(m); }
  readInput(m, true);
  if (m.hitlag > 0) m.hitlag--;
  else {
    status.tick(m);
    resources.tick(m);
    const live = states.update(m);
    script.flush(m);
    if (live) { movement.update(m); physics.integrate(m); }
  }
  e.x = m.x; e.y = m.y; e.vx = m.vx + m.kx; e.vy = m.vy + m.ky; e.facing = m.facing;
  e.hp = Math.max(0, e.maxHp - m.percent);
  const b = game.stage.blast;
  if (m.x < b.left || m.x > b.right || m.y > b.bottom || m.y - collider(m).h < b.top) { die(game, e, 'blast'); return false; }
  if (e.hp <= 0) { die(game, e); return false; }
  return true;
}

// ── hits (called from hits.js) ──────────────────────────────────────────────
export function onHitConnect(game, e, target, hb) { // eslint-disable-line no-unused-vars
  if (isV1(e)) { e.life = 0; return true; }
  e.hits++;
  if (hb && hb.onHit && hb.onHit.length) runList(game, e, hb.onHit); // per-hitbox list first (as actions do)
  runList(game, e, e.def.onHit);
  if (e.hits >= hitLimit(e)) {
    despawn(game, e, 'spent');
    return true;
  }
  return !alive(e);
}

/**
 * Hits before an entity is spent (owner decision d): projectiles and traps end after
 * maxHits + pierce (default 1); minions, zones, beams, parts and clones are unlimited by
 * hits (they end by life/hp; rehit keys still gate repeats) unless maxHits > 1 is set.
 */
export function hitLimit(e) {
  const d = e.def || {};
  const max = Math.max(1, Math.floor(num(d.maxHits, 1)));
  if (e.kind !== 'projectile' && e.kind !== 'trap' && max <= 1) return Infinity;
  return max + Math.max(0, Math.floor(num(d.pierce)));
}

export function clank(game, e, by) { // eslint-disable-line no-unused-vars
  despawn(game, e, 'clank');
}

// v1 melee-vs-projectile clank used a strict hypot test; keep it bit-identical.
function clankOverlap(a, b) {
  if ((a.shape || 'circle') === 'circle' && (b.shape || 'circle') === 'circle') return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
  return overlap(a, b);
}

const MIRROR = new Set(['reflect', 'absorb']);
const canTake = (e, kind) => (!e.kind || e.kind === 'projectile') && (kind === 'reflect' ? e.def?.reflectable !== false : e.def?.absorbable !== false);

function reflect(game, e, a, root) {
  e.owner = root.id;
  e.ownerIdx = root.index;
  e.vx = -e.vx * LIMITS.reflectMul;
  e.vy = -e.vy * LIMITS.reflectMul;
  e.facing = -(e.facing || 1);
  e.reflected = true; // reflected: a pure projectile (the author's think/every/lists no longer run)
  if (e.hitKeys) e.hitKeys.clear();
  if (isV1(e)) { e.tier = 'projectile'; const sp = Math.hypot(e.vx, e.vy); if (sp > 14) { e.vx *= 14 / sp; e.vy *= 14 / sp; } } else { capSpeed(e); e.bindToMove = false; e.bind = null; }
  game.emit({ type: 'reflect', id: root.id, i: e.id, x: e.x, y: e.y });
}

function absorb(game, e, a, root) {
  despawn(game, e, 'absorb');
  game.emit({ type: 'absorb', id: root.id, i: e.id, x: e.x, y: e.y, name: e.name ?? e.slot ?? null });
  if (a && typeof actions.onAbsorb === 'function') actions.onAbsorb(a, e);
}

/** hp entity damage (no knockback). */
function hurtEntity(game, e, by, hb, shape) {
  const d = Math.max(0, num(hb.damage));
  e.hp = Math.max(0, num(e.hp) - d);
  const c = center(shape);
  game.emit({ type: 'ehit', i: e.id, by: by ? by.id : null, damage: Math.round(d * 10) / 10, hp: Math.round(e.hp * 10) / 10, x: c.x, y: c.y, effect: hb.effect || null });
  if (e.hp <= 0) die(game, e);
}

/** Hit record for a fighter/clone box landing on a fighter-like target (fighter or minor). */
function boxHit(a, t, b, cloneOf) {
  const act = a.action;
  const root = rootOf(a);
  const c = center(b.shape);
  const minor = a !== root;
  return {
    attacker: root, target: t, hb: minor && !root.game.gov ? cloneHb(b.hb) : b.hb, x: c.x, y: c.y, dir: a.facing,
    slot: act.name, effect: b.hb.effect || act.def.effect, charge: act.chargeFrames,
    tier: minor ? 'clone' : (b.hb.tier || act.def.category || 'special'), kind: b.hb.kind || 'strike', key: t ? `${t.id}:${b.key}` : b.key,
    ...(minor ? { projectile: true, entity: cloneOf } : {}),
  };
}

/** Ungoverned matches: apply the clone ×0.5 damage / ×0.7 knockback here (the Governor does it otherwise). */
const cloneHbCache = new WeakMap();
function cloneHb(hb) {
  let c = cloneHbCache.get(hb);
  if (!c) { c = { ...hb, damage: num(hb.damage) * 0.5, knockback: num(hb.knockback) * 0.7, growth: num(hb.growth) * 0.7 }; cloneHbCache.set(hb, c); }
  return c;
}

/** Relay a hit on a part to its core (§3.9.1). Returns the hit record or null. */
function relayHit(game, part, base) {
  const core = ownerOf(game, part);
  if (!core || core.eliminated || isIntangible(core)) return null;
  const h = { ...base, target: core, key: `${core.id}:${base.boxKey}` };
  delete h.boxKey;
  if (part.relay < 1) {
    h.relay = part.relay;
    part.hp = Math.max(0, part.hp - Math.max(0, num(base.hb.damage)));
    game.emit({ type: 'ehit', i: part.id, by: base.attacker ? base.attacker.id : null, damage: num(base.hb.damage), hp: part.hp, x: base.x, y: base.y, effect: base.hb.effect || null });
    if (part.hp <= 0) die(game, part);
  }
  return h;
}

/**
 * A fighter's (or clone's) active boxes vs enemy entities, at v1's place in
 * collectHits: v1 clank (exact), reflect / absorb, hp damage, part relay, clone hits.
 */
export function meleeVsEntities(game, a, boxes, hits) {
  const root = rootOf(a);
  const act = a.action;
  for (const e of game.entities) {
    if (e.owner === root.id || !alive(e)) continue;
    if (isV1(e)) {
      const body = bodyShapeOf(e);
      for (const b of boxes) {
        const k = b.hb.kind;
        if (k === 'reflect' || k === 'absorb') {
          if (!clankOverlap(body, b.shape)) continue;
          if (k === 'reflect') reflect(game, e, a, root); else absorb(game, e, a, root);
          break;
        }
        if (clankOverlap(body, b.shape)) {
          e.life = 0;
          game.emit({ type: 'clank', x: e.x, y: e.y });
          break;
        }
      }
      continue;
    }
    const hurt = hurtShapesOf(e);
    for (const b of boxes) {
      if (!alive(e)) break;
      const kind = b.hb.kind || 'strike';
      if (kind === 'reflect' || kind === 'absorb') {
        if (!canTake(e, kind) || !overlap(bodyShapeOf(e), b.shape)) continue;
        if (kind === 'reflect') reflect(game, e, a, root); else absorb(game, e, a, root);
        break;
      }
      if (kind === 'grab' || (kind === 'wind' && !e.minor)) continue;
      if (hurt.length) {
        const tid = e.minor ? e.minor.id : e.kind === 'part' ? e.owner : `e${e.id}`;
        if (e.minor && isIntangible(e.minor)) break;
        const key = `${tid}:${b.key}`;
        if (act.hitKeys.has(key) || !overlapAny([b.shape], hurt)) continue;
        if (e.minor) {
          act.hitKeys.add(key);
          hits.push(boxHit(a, e.minor, b, a !== root ? cloneEntityOf(game, a) : null));
        } else if (e.kind === 'part') {
          act.hitKeys.add(key);
          const base = boxHit(a, null, b, a !== root ? cloneEntityOf(game, a) : null);
          base.boxKey = b.key;
          const h = relayHit(game, e, base);
          if (h) hits.push(h);
        } else {
          act.hitKeys.add(key);
          hurtEntity(game, e, root, b.hb, b.shape);
        }
        continue;
      }
      if (kind === 'strike' && e.def.clank !== false && clankOverlap(bodyShapeOf(e), b.shape)) {
        clank(game, e, a);
        game.emit({ type: 'clank', x: e.x, y: e.y });
        break;
      }
    }
  }
}

function cloneEntityOf(game, m) { return game.entities.find((e) => e.minor === m) || null; }

/**
 * hits.js hook (after the fighter and entity loops, before the sweep):
 *  1. clone attacks (their minor's action boxes) vs enemy fighters, clones, entities;
 *  2. entity boxes vs hurtable enemy entities (hp entities, parts → relay, clones → hit);
 *  3. clash: `clash:true` bodies of different owners destroy each other.
 */
export function collectHits(game, alive_, hits) {
  const list = game.entities;
  if (!list.length) return;
  let any = false;
  for (const e of list) if (!isV1(e)) { any = true; break; }
  if (!any) return;

  // 1. clones attacking
  for (const e of list) {
    if (!e.minor || !alive(e)) continue;
    const m = e.minor;
    const root = ownerOf(game, e);
    if (root && m.extraHits && m.extraHits.length) script.collectExtraHits(game, m, alive_, hits, { root, entity: e }); // timeline hit / api.hit
    if (!root || !m.action) continue;
    const boxes = actions.activeHitboxes(m).filter((b) => (b.hb.kind || 'strike') !== 'grab');
    if (!boxes.length) continue;
    const act = m.action;
    const targets = alive_.filter((t) => t !== root).concat(list.filter((x) => x.minor && x !== e && x.owner !== root.id && alive(x)).map((x) => x.minor));
    for (const t of targets) {
      if (isIntangible(t)) continue;
      const hurt = hurtShapes(t);
      for (const b of boxes) {
        const key = `${t.id}:${b.key}`;
        if (act.hitKeys.has(key) || !overlapAny([b.shape], hurt)) continue;
        act.hitKeys.add(key);
        act.hitSomething = true;
        hits.push(boxHit(m, t, b, e));
      }
    }
    meleeVsEntities(game, m, boxes, hits);
  }

  // 2. entity boxes vs hurtable enemy entities; entity reflect/absorb boxes vs enemy projectiles
  for (const e of list) {
    if (isV1(e) || e.minor || !alive(e)) continue;
    const guards = activeBoxes(e, MIRROR);
    if (!guards.length) continue;
    const owner = ownerOf(game, e);
    if (!owner) continue;
    for (const t of list) {
      if (t === e || t.owner === e.owner || !alive(t)) continue;
      for (const b of guards) {
        const kind = b.hb.kind;
        if (!canTake(t, kind) || !overlap(bodyShapeOf(t), b.shape)) continue;
        if (kind === 'reflect') reflect(game, t, null, owner); else absorb(game, t, null, owner);
        break;
      }
    }
  }
  for (const e of list) {
    if (isV1(e) || e.minor || !alive(e)) continue;
    const boxes = hitboxesOf(e);
    if (!boxes.length) continue;
    const owner = ownerOf(game, e);
    for (const t of list) {
      if (t === e || isV1(t) || !alive(t) || t.owner === e.owner) continue;
      const hurt = hurtShapesOf(t);
      if (!hurt.length || (t.minor && isIntangible(t.minor))) continue;
      const tid = t.minor ? t.minor.id : t.kind === 'part' ? t.owner : `e${t.id}`;
      let hitOne = null;
      for (const b of boxes) {
        const key = `${tid}:${b.key}`;
        if (e.hitKeys.has(key) || !overlapAny([b.shape], hurt)) continue;
        e.hitKeys.add(key);
        if (!owner) break;
        const c = center(b.shape);
        const base = {
          attacker: owner, target: t.minor || null, hb: b.hb, x: c.x, y: c.y, dir: entityDir(e), slot: e.slot,
          effect: b.hb.effect || e.effect, projectile: true, charge: 0, entity: e, kind: b.hb.kind || 'strike', key, tier: b.hb.tier || e.tier,
        };
        if (t.minor) hits.push(base);
        else if (t.kind === 'part') { base.boxKey = b.key; const h = relayHit(game, t, base); if (h) hits.push(h); } else hurtEntity(game, t, owner, b.hb, b.shape);
        hitOne = b.hb;
        break;
      }
      if (hitOne && onHitConnect(game, e, t, hitOne)) break;
    }
  }

  // 3. clash
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (isV1(a) || !a.def.clash || !alive(a)) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (isV1(b) || !b.def.clash || !alive(b) || b.owner === a.owner) continue;
      if (!overlap(bodyShapeOf(a), bodyShapeOf(b))) continue;
      despawn(game, a, 'clash');
      despawn(game, b, 'clash');
      game.emit({ type: 'clank', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      break;
    }
  }
}
