// Fighter records (spec §3.3), KO / respawn / blast zones (§3.14), forms.
// A fighter holds a non-enumerable back-reference `f.game`, so sim modules take
// just `f` (as in the spec signatures) and JSON never sees a cycle.
import { MATCH, SHIELD, BUTTONS } from '../constants.js';
import { setState } from './states.js';
import { collider, bodyOf } from './hurtbox.js';
import { EMPTY_INPUT, BUFFERED, HELD_SLOTS } from './input-map.js';
import { airReset, movementOf, pushOut, refreshKoTable } from './movement.js';
import * as status from './status.js';
import * as resources from './resources.js';
import * as entities from './entities.js';
import * as script from './script-api.js';

/** Base stats for the fighter's current form (forms inherit unspecified stats). */
// v1 IR keeps stats at the top level; the v2 IR may keep them under forms.base.
export function formStats(f) {
  const c = f.char;
  const base = c.stats ?? c.forms?.base?.stats;
  const fs = f.form && f.form !== 'base' ? c.forms?.[f.form]?.stats : null;
  return fs ? { ...base, ...fs } : base;
}

/**
 * Effective stats = form stats × status/modifier multipliers (§3.3). Returns the
 * form's stats object itself when all relevant mods are neutral (v1 always).
 */
export function effectiveStats(f) {
  const base = formStats(f);
  const m = f.mods;
  if (!m || (m.speed === 1 && m.jump === 1 && m.gravity === 1 && m.fallSpeed === 1)) return base;
  return {
    ...base,
    runSpeed: base.runSpeed * m.speed, airSpeed: base.airSpeed * m.speed,
    jumpHeight: base.jumpHeight * m.jump, doubleJumpHeight: base.doubleJumpHeight * m.jump,
    gravity: base.gravity * m.gravity, fallSpeed: base.fallSpeed * m.fallSpeed,
  };
}

export function createFighter(game, p, index) {
  const spawn = game.stage.spawns[index % game.stage.spawns.length];
  const c = p.character;
  const f = {
    id: p.id, name: p.name, index, charId: c.id, char: c, stats: null,
    cpu: p.cpu || null, brain: p.cpu ? { level: p.cpu, timer: 0, held: { ...EMPTY_INPUT } } : null,
    x: spawn.x, y: spawn.y, vx: 0, vy: 0, kx: 0, ky: 0, facing: spawn.facing,
    state: 'idle', stateFrame: 0, grounded: true, platform: -1,
    jumpsLeft: 0, fastFall: false, usedAirDodge: false, usedSideSpecial: false,
    percent: 0, stocks: game.rules.stocks, shield: SHIELD.max, shieldStun: 0,
    invuln: 0, intangibleFrames: 0, hitlag: 0, hitstun: 0, tumble: false, lag: 0,
    action: null, lastAction: null, extraHits: [],
    stale: [], input: EMPTY_INPUT, prev: EMPTY_INPUT, buffer: {}, heldFrames: new Int16Array(HELD_SLOTS),
    dropThrough: 0, doubleJumpFlip: 0,
    deadTimer: 0, respawnTimer: 0, lastHitBy: null, lastHitFrame: -9999,
    kos: 0, falls: 0, damageDealt: 0, eliminated: false, placement: 0, dodgeDir: 0, dodgeVx: 0, dodgeVy: 0,
    // v2 (§3.3)
    form: startFormOf(c), formCd: 0, bodyScale: 1, hurtSet: null, armorPassive: c.body?.armor?.threshold ?? c.forms?.[startFormOf(c)]?.armor?.threshold ?? 0,
    air: { rise: 0, stall: 0, teleports: 0, flyFuel: 0, hoverFrames: 0, glideFrames: 0, clingUsed: false, crawlFrames: 0, used: new Set() },
    grab: null, gov: null,
  };
  Object.defineProperty(f, 'game', { value: game, enumerable: false, writable: true });
  for (const b of BUFFERED) f.buffer[b] = -999;
  status.init(f);
  f.stats = effectiveStats(f);
  f.jumpsLeft = f.stats.airJumps;
  resources.init(f);
  script.init(f);
  airReset(f);
  return f;
}

/** The character's start form (v1 validator output: c.startForm; IR: meta.startForm). */
export function startFormOf(c) { return c.startForm || c.meta?.startForm || 'base'; }

export const FORM_COOLDOWN = 45;   // frames between switches (§2.2.9 timeline `form`)
export const FORM_HITLAG = 6;      // transition freeze (§3.12.3 api.form)

/**
 * Form switch (§2.2.12, WP-H). Swaps stats/body/slots/movement (all read through f.form),
 * enforces the 45-frame cooldown (unless opts.force), applies 6 frames of transition
 * hitlag, re-clamps per-form state and pushes the collider out of the ground (§3.7).
 * Returns false when unknown, unchanged or cooling down.
 */
export function setForm(f, name, opts = {}) {
  const c = f.char;
  if (typeof name !== 'string' || name === f.form) return false;
  if (name !== 'base' && !(c.forms && Object.prototype.hasOwnProperty.call(c.forms, name))) return false;
  if (!opts.force && f.formCd > 0) return false;
  const from = f.form;
  f.form = name;
  f.formCd = opts.force ? 0 : FORM_COOLDOWN;
  f.stats = effectiveStats(f);
  refreshKoTable(f);
  const form = c.forms?.[name];
  f.armorPassive = form ? (form.armor?.threshold ?? 0) : (c.body?.armor?.threshold ?? c.forms?.base?.armor?.threshold ?? 0);
  if (f.jumpsLeft > f.stats.airJumps) f.jumpsLeft = f.stats.airJumps;
  const body = bodyOf(f);
  if (f.hurtSet && !body.sets[f.hurtSet]) f.hurtSet = null;
  const sr = (form?.body || c.body || c.forms?.base?.body)?.scaleRange;
  if (sr) f.bodyScale = Math.max(sr[0], Math.min(sr[1], f.bodyScale ?? 1));
  const mv = movementOf(f);
  f.air.flyFuel = f.grounded ? (mv.fly?.fuel ?? 0) : Math.min(f.air.flyFuel, mv.fly?.fuel ?? 0);
  const modeOk = { glide: mv.glide, fly: mv.fly, wallcling: mv.wallCling, crawl: mv.crawl };
  if (f.state in modeOk && !modeOk[f.state]) setState(f, f.grounded ? 'idle' : 'air');
  if (f.state !== 'dead' && f.state !== 'respawn') pushOut(f);
  if (!opts.force) f.hitlag = Math.max(f.hitlag | 0, FORM_HITLAG);
  f.game.emit({ type: 'form', id: f.id, from, to: name });
  script.run(f, 'onFormChange', { from, to: name });
  return true;
}

/**
 * Clone / minor fighter (§3.9.2, WP-G): the owner's IR and current form, its own body
 * (base shapes × def.scale), position and timers; hp lives on the entity (percent
 * accumulates damage). No stocks, no hooks (script-api skips `minorOf`), no grabs.
 * opts: {id, x, y, facing, grounded}. Stepped by entities.update, never by Game.step.
 */
export function createMinor(owner, def, opts = {}) {
  const m = createFighter(owner.game, { id: opts.id ?? `${owner.id}#c`, name: owner.name, character: owner.char }, owner.index);
  Object.defineProperty(m, 'minorOf', { value: owner, enumerable: false, writable: true });
  m.x = opts.x ?? owner.x; m.y = opts.y ?? owner.y; m.facing = opts.facing ?? owner.facing;
  m.grounded = !!opts.grounded; m.platform = m.grounded ? owner.platform : -1;
  m.state = m.grounded ? 'idle' : 'air';
  m.form = owner.form; m.stocks = 0; m.noGrab = true;
  m.bodyScale = Math.max(0.5, Math.min(1, def?.scale ?? 1));
  m.stats = effectiveStats(m); m.jumpsLeft = m.stats.airJumps;
  return m;
}

// ── KOs, respawn ────────────────────────────────────────────────────────────
export function checkBlastZones(game) {
  const b = game.stage.blast;
  for (const f of game.fighters) {
    if (f.eliminated || f.state === 'dead' || f.state === 'respawn') continue;
    const top = f.y - collider(f).h;
    if (f.x < b.left || f.x > b.right || f.y > b.bottom || top < b.top) {
      const side = f.x < b.left ? 'left' : f.x > b.right ? 'right' : f.y > b.bottom ? 'bottom' : 'top';
      ko(f, side);
    }
  }
}

/** The only place stocks change (§4.2.11). */
export function ko(f, side) {
  const game = f.game;
  const b = game.stage.blast;
  const credited = f.lastHitBy && game.frame - f.lastHitFrame < 600 ? game.fighter(f.lastHitBy) : null;
  if (credited && credited !== f) credited.kos++;
  f.falls++;
  if (!game.rules.infinite) f.stocks--;
  game.emit({
    type: 'ko', id: f.id, by: credited?.id || null, side,
    x: Math.max(b.left, Math.min(b.right, f.x)), y: Math.max(b.top, Math.min(b.bottom, f.y - collider(f).h / 2)),
    stocks: f.stocks,
  });
  setState(f, 'dead');
  f.vx = f.vy = f.kx = f.ky = 0;
  f.hitlag = 0;
  f.deadTimer = MATCH.respawnDelay;
  if (!game.rules.infinite && f.stocks <= 0) {
    f.eliminated = true;
    f.placement = game.fighters.filter((o) => !o.eliminated).length + 1;
  }
  // v2 additions (no-ops for v1 characters)
  status.clear(f);
  if (game.gov && game.gov.onKO) game.gov.onKO(f);
  setForm(f, startFormOf(f.char), { force: true });
  script.run(f, 'onKO');
  entities.onOwnerKO(game, f);
}

export function updateDead(f) {
  if (--f.deadTimer > 0) return;
  const game = f.game;
  const spawn = game.stage.spawns[f.index % game.stage.spawns.length];
  f.x = spawn.x * 0.5;
  f.y = game.stage.respawnY;
  f.percent = 0;
  f.shield = SHIELD.max;
  f.jumpsLeft = f.stats.airJumps;
  f.facing = f.x <= 0 ? 1 : -1;
  f.grounded = false;
  f.lastHitBy = null;
  f.stale = [];
  setState(f, 'respawn');
  game.emit({ type: 'respawn', id: f.id, x: f.x, y: f.y });
  // v2 additions: per-life body state starts fresh (fastFall kept for v1 golden parity)
  if (!game.rules.legacyKo) f.fastFall = false;
  f.hurtSet = null;
  const sr = bodyOf(f) && (f.char.forms?.[f.form]?.body || f.char.body || f.char.forms?.base?.body)?.scaleRange;
  f.bodyScale = sr ? Math.max(sr[0], Math.min(sr[1], 1)) : 1;
  script.onRespawn(f);
  resources.respawn(f);
  airReset(f);
  if (game.gov && game.gov.airReset) game.gov.airReset(f);
  script.run(f, 'init');
  script.run(f, 'onRespawn');
}

export function updateRespawn(f) {
  const inp = f.input;
  const acted = BUTTONS.some((b) => inp[b] && !f.prev[b]);
  if ((acted && f.stateFrame > 20) || f.stateFrame >= MATCH.respawnPlatformMax) {
    f.invuln = MATCH.respawnInvuln;
    setState(f, 'air');
    f.vy = 0;
  }
}
