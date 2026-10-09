// ─────────────────────────────────────────────────────────────────────────────
// normalizeV1 — converts a v1 character file (no `version`, or version 1) into
// v2 SOURCE syntax (a CharacterDef with version 2), spec §8. normalize() then
// runs the result through normalizeV2 like any v2 file.
//
// Fidelity rules (golden parity):
//  - Every number the author wrote is kept as-is. Missing numbers get the exact
//    v1 defaults validate.js used (hitbox x 30, y = body center, r 20, …), and
//    frame numbers are rounded like v1. Nothing is clamped here: the v1 rules
//    path in the validator still does all scaling.
//  - v1 hitboxes default to group 0 (v2's default is the list index).
//  - Fields v1 ignored (unknown top-level keys, unknown move/hitbox fields,
//    non-slot moves) are NOT activated in v2: they're stashed in `legacy` and
//    reported as I-notes, so a stray `forms`/`cancels` key can't change a v1
//    character's behavior.
// The output is also what `npm run migrate` prints (§8).
// ─────────────────────────────────────────────────────────────────────────────
import { STATS, MOVE_SLOTS, CATEGORIES } from '../balance/rules.js';
import { ANIMATIONS } from '../art/anims.js';
import { NOTE_CODES, EFFECT_PRESETS, CROUCH_HEIGHT, V1_SLOTS } from './schema.js';
import { didYouMean } from './suggest.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, d) => (isNum(v) ? v : d);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Top-level keys v1 understood. */
export const V1_TOP_FIELDS = ['version', 'id', 'name', 'author', 'description', 'stats', 'moves', 'art'];
/** Move keys v1 understood (validate.js KNOWN_MOVE_FIELDS). */
export const V1_MOVE_FIELDS = ['name', 'duration', 'anim', 'pose', 'effect', 'color', 'hitboxes', 'projectiles', 'velocity', 'landingLag', 'intangible', 'description', 'sound'];
export const V1_HITBOX_FIELDS = ['start', 'end', 'x', 'y', 'r', 'damage', 'angle', 'knockback', 'growth', 'group'];
export const V1_PROJECTILE_FIELDS = ['start', 'x', 'y', 'vx', 'vy', 'gravity', 'life', 'r', 'damage', 'angle', 'knockback', 'growth', 'style', 'color', 'color2', 'spin'];
export const V1_VELOCITY_FIELDS = ['start', 'end', 'vx', 'vy'];
/** v1 default anim per slot (validate.js defaultAnim). */
export const V1_DEFAULT_ANIMS = {
  jab: 'jab', side: 'punch', up: 'uppercut', down: 'sweep', sideSmash: 'heavyPunch', upSmash: 'upSmash', downSmash: 'splits',
  nair: 'spin', fair: 'airKick', bair: 'backKick', uair: 'flipKick', dair: 'stomp',
  neutralSpecial: 'cast', sideSpecial: 'dash', upSpecial: 'rise', downSpecial: 'slam',
};
const V2_ONLY_HINT = ['body', 'forms', 'entities', 'hitboxes', 'statuses', 'resources', 'behavior', 'slots', 'movement', 'vars'];

const mkNote = (code, path, why, extra = {}) => ({ code, severity: NOTE_CODES[code].severity, path, why, fix: NOTE_CODES[code].fix, ...extra });

/** True when a def is a v1 file (no version, or version 1). */
export const isV1 = (def) => isObj(def) && (def.version === undefined || def.version === 1);

/**
 * v1 width/height → v2 body: collider, a `default` rect hurtbox and a `crouch`
 * rect at 0.68 height. The validator's v1 path calls this again after v1 stat
 * balancing (which may grow/clamp width and height).
 */
export function v1Body(w, h) {
  const ch = h * CROUCH_HEIGHT;
  return {
    collider: { w, h },
    hurtboxes: {
      default: [{ shape: 'rect', x: 0, y: -h / 2, w, h }],
      crouch: [{ shape: 'rect', x: 0, y: -ch / 2, w, h: ch }],
    },
  };
}

/**
 * v1 projectiles of one move → auto entities `${moveKey}#p${i}` plus `spawn`
 * timeline entries at p.start (§8). Shared with normalizeV2 (v2 moves may still
 * use `projectiles`). Missing numbers get v1 defaults.
 * @returns {{entities: Object<string, object>, spawns: object[], notes: object[]}}
 */
export function convertProjectiles(moveKey, list, { effect = null, centerY = -46, path = `moves.${moveKey}` } = {}) {
  const entities = {};
  const spawns = [];
  const notes = [];
  (Array.isArray(list) ? list : []).forEach((p, i) => {
    if (!isObj(p)) return;
    const PP = `${path}.projectiles[${i}]`;
    for (const k of Object.keys(p)) {
      if (!V1_PROJECTILE_FIELDS.includes(k)) notes.push(mkNote('I001', `${PP}.${k}`, `"${k}" isn't a projectile field (ignored).`, { suggest: didYouMean(k, V1_PROJECTILE_FIELDS) }));
    }
    const start = Math.round(num(p.start, 8));
    const life = Math.round(num(p.life, 60));
    const r = num(p.r, 12);
    const name = `${moveKey}#p${i}`;
    entities[name] = {
      kind: 'projectile',
      shape: { shape: 'circle', x: 0, y: 0, r },
      life,
      maxHits: 1,
      pierce: 0,
      motion: { type: 'ballistic', gravity: num(p.gravity, 0) },
      collide: 'die',
      clank: true,
      hitboxes: [{
        shape: 'circle', x: 0, y: 0, r, start: 0, end: life, group: 0,
        damage: num(p.damage, 5), angle: num(p.angle, 40), knockback: num(p.knockback, 15), growth: num(p.growth, 40),
        ...(effect ? { effect } : {}),
      }],
      render: {
        style: typeof p.style === 'string' ? p.style.slice(0, 24) : 'orb',
        color: typeof p.color === 'string' ? p.color : null,
        color2: typeof p.color2 === 'string' ? p.color2 : null,
        spin: num(p.spin, 0),
      },
      legacy: { v1: true, move: moveKey, index: i },
    };
    spawns.push({ at: start, spawn: name, x: num(p.x, 30), y: num(p.y, centerY), vx: num(p.vx, 8), vy: num(p.vy, 0) });
  });
  return { entities, spawns, notes };
}

/**
 * v1 def → v2 source def (spec §8).
 * @param {object} def  raw v1 module default (or the clean output of the v1 validator)
 * @returns {{draft: import('./api.js').CharacterDef & {legacy: object} | null, notes: object[], errors: object[]}}
 */
export function normalizeV1(def, { expectedId } = {}) {
  const notes = [];
  const errors = [];
  if (!isObj(def)) {
    errors.push(mkNote('E003', '', 'the character module must `export default` an object.'));
    return { draft: null, notes, errors };
  }
  const legacy = { version: 1, stats: null, art: null, extra: {}, unusedMoves: {}, extraMoveFields: {} };

  // Unknown top-level keys: v1 ignored them, so stash rather than activate.
  for (const k of Object.keys(def)) {
    if (V1_TOP_FIELDS.includes(k)) continue;
    legacy.extra[k] = def[k];
    const v2 = V2_ONLY_HINT.includes(k);
    notes.push(mkNote('I001', k, v2
      ? `"${k}" is a v2 field, but this file has no version so it is read as v1 and "${k}" is ignored.`
      : `"${k}" isn't a character field (ignored).`,
    { suggest: didYouMean(k, V1_TOP_FIELDS), fix: v2 ? 'wrap the definition in defineCharacter({...}) (or add version: 2) to use v2 features.' : NOTE_CODES.I001.fix }));
  }

  // Stats: everything but width/height carries over verbatim; width/height → body.
  const rawStats = isObj(def.stats) ? def.stats : {};
  legacy.stats = { ...rawStats };
  const stats = {};
  for (const [k, v] of Object.entries(rawStats)) if (k !== 'width' && k !== 'height') stats[k] = v;
  const w = num(rawStats.width, STATS.width.default);
  const h = num(rawStats.height, STATS.height.default);
  // Default y for hitboxes/projectiles uses the body center (v1 uses the balanced height).
  const centerY = -Math.max(STATS.height.min, Math.min(STATS.height.max, h)) / 2;

  const draft = {
    version: 2,
    id: def.id ?? expectedId,
    // v1 never required a name: it fell back to the id.
    name: typeof def.name === 'string' && def.name.trim() ? def.name.trim() : String(def.id ?? expectedId),
    author: typeof def.author === 'string' ? def.author : 'unknown',
    description: typeof def.description === 'string' ? def.description : '',
    body: v1Body(w, h),
    stats,
    entities: {},
    moves: {},
  };

  // Moves: each v1 slot becomes a pool entry routed by the identity slot map.
  const srcMoves = isObj(def.moves) ? def.moves : {};
  for (const key of Object.keys(srcMoves)) {
    if (MOVE_SLOTS[key]) continue;
    legacy.unusedMoves[key] = srcMoves[key];
    notes.push(mkNote('I010', `moves.${key}`, `moves.${key} isn't a move slot, so it's never used.`, { suggest: didYouMean(key, V1_SLOTS) }));
  }
  for (const slot of V1_SLOTS) {
    const src = srcMoves[slot];
    if (!isObj(src)) continue; // missing → generic move (normalizeV2 adds it with I002)
    const { move, entities, notes: mn } = convertMove(slot, src, centerY, legacy);
    draft.moves[slot] = move;
    Object.assign(draft.entities, entities);
    notes.push(...mn);
  }

  if (def.art !== undefined) {
    draft.art = def.art;
    legacy.art = isObj(def.art) && typeof def.art.draw === 'function' ? 'shim' : 'humanoid';
  } else legacy.art = 'humanoid';

  draft.legacy = legacy;
  notes.push(mkNote('I007', '', 'v1 character file: converted to v2 automatically (no changes needed).'));
  return { draft, notes, errors };
}

function convertMove(slot, src, centerY, legacy) {
  const notes = [];
  const category = MOVE_SLOTS[slot];
  const cat = CATEGORIES[category];
  const P = `moves.${slot}`;
  const extra = {};
  for (const k of Object.keys(src)) {
    if (V1_MOVE_FIELDS.includes(k)) continue;
    extra[k] = src[k];
    notes.push(mkNote('I001', `${P}.${k}`, `${P}.${k} isn't a move field (ignored).`, { suggest: didYouMean(k, V1_MOVE_FIELDS) }));
  }
  if (Object.keys(extra).length) legacy.extraMoveFields[slot] = extra;

  let anim = V1_DEFAULT_ANIMS[slot];
  if (typeof src.anim === 'string' && ANIMATIONS[src.anim]) anim = src.anim;
  else if (src.anim !== undefined && src.anim !== null) notes.push(mkNote('I004', `${P}.anim`, `${P}.anim "${src.anim}" unknown — using "${anim}".`, { from: src.anim, to: anim, suggest: didYouMean(String(src.anim), Object.keys(ANIMATIONS)) }));
  let effect = 'punch';
  if (EFFECT_PRESETS.includes(src.effect)) effect = src.effect;
  else if (src.effect !== undefined && src.effect !== null) notes.push(mkNote('I004', `${P}.effect`, `${P}.effect "${src.effect}" unknown — using "punch".`, { from: src.effect, to: 'punch', suggest: didYouMean(String(src.effect), EFFECT_PRESETS) }));

  const hitboxes = (Array.isArray(src.hitboxes) ? src.hitboxes : []).filter(isObj).map((hb, i) => {
    for (const k of Object.keys(hb)) {
      if (!V1_HITBOX_FIELDS.includes(k)) notes.push(mkNote('I001', `${P}.hitboxes[${i}].${k}`, `"${k}" isn't a v1 hitbox field (ignored).`, { suggest: didYouMean(k, V1_HITBOX_FIELDS) }));
    }
    const start = Math.round(num(hb.start, cat.minStartup));
    return {
      shape: 'circle',
      start, end: Math.round(num(hb.end, num(hb.start, cat.minStartup) + 3)),
      x: num(hb.x, 30), y: num(hb.y, centerY), r: num(hb.r, 20),
      damage: num(hb.damage, 4), angle: num(hb.angle, 45), knockback: num(hb.knockback, 20), growth: num(hb.growth, 60),
      group: Number.isInteger(hb.group) ? hb.group : 0,
    };
  });
  const velocity = (Array.isArray(src.velocity) ? src.velocity : []).filter(isObj).map((v) => ({
    start: Math.round(num(v.start, 1)), end: Math.round(num(v.end, num(v.start, 1))),
    vx: isNum(v.vx) ? v.vx : null, vy: isNum(v.vy) ? v.vy : null,
  }));
  const proj = convertProjectiles(slot, src.projectiles, { effect, centerY, path: P });
  notes.push(...proj.notes);

  const move = {
    name: typeof src.name === 'string' && src.name.trim() ? src.name : slot,
    category,
    duration: Math.round(num(src.duration, cat.minDuration + 8)),
    anim, effect,
    hitboxes, velocity,
  };
  if (proj.spawns.length) move.timeline = proj.spawns;
  if (src.pose !== undefined && src.pose !== null) move.pose = src.pose;
  if (typeof src.color === 'string') move.color = src.color;
  if (typeof src.description === 'string') move.description = src.description;
  if (src.sound !== undefined && src.sound !== null) move.sound = src.sound;
  // [s, e]; also the validator's own output shape [[s, e]] (re-normalizing a validated v1 character).
  const iw = Array.isArray(src.intangible) && Array.isArray(src.intangible[0]) && src.intangible.length === 1 ? src.intangible[0] : src.intangible;
  if (Array.isArray(iw) && isNum(iw[0]) && isNum(iw[1])) {
    move.intangible = [Math.round(iw[0]), Math.round(iw[1])];
  }
  if (category === 'aerial') move.landingLag = Math.round(num(src.landingLag, 10));
  if (slot === 'upSpecial') move.helpless = true;
  if (slot === 'sideSpecial') move.oncePerAirtime = true;
  // Smash charge (v1: frame max(1, startup − 3), up to 60 f). `at` is left out on purpose so
  // buildIR derives it from the FINAL (post-scaling) startup, exactly like v1's game.js.
  if (category === 'smash') move.charge = { button: 'strong', max: 60 };
  return { move, entities: proj.entities, notes };
}
