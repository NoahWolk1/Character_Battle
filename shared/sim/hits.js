// Hit resolution (spec §3.13): collect candidate (source, box, target) pairs in
// a fixed order, filter, resolve kinds, then apply. With rules.governor off (or no
// Governor loaded) strikes use the exact v1 math; with it on, strikes go through
// Governor.applyHit (§4.2.1).
import { MATCH, PHYSICS, COMBAT, SHIELD, DODGE } from '../constants.js';
import { knockback, launchSpeed, hitstunFrames, hitlagFrames, angleToVector, normalizeAngle } from './combat.js';
import { overlapAny, center } from './shapes.js';
import { hurtShapes, collider } from './hurtbox.js';
import { setState, breakShield } from './states.js';
import { leaveGround } from './physics.js';
import * as actions from './actions.js';
import * as entities from './entities.js';
import * as status from './status.js';
import * as resources from './resources.js';
import * as script from './script-api.js';

/**
 * True while nothing can hit f: v1 sources (invuln, dodge windows, respawn), the
 * action's intangible window (only while Governor.intangibleGranted when governed),
 * engine grants (f.intangibleFrames, Governor BREAK frames).
 */
export function isIntangible(f, pure = false) {
  if (f.invuln > 0 || f.state === 'dead' || f.state === 'respawn') return true;
  if (f.intangibleFrames > 0) return true;
  const gov = f.game && f.game.gov;
  // BREAK, api/timeline grants, windows. Observers pass pure = true: no budget charge.
  if (gov && (gov.breakIntangible(f) || (pure ? gov.intangibleActive(f) : gov.intangibleGranted(f)))) return true;
  const fr = f.stateFrame;
  const inWin = (w) => fr >= w[0] && fr <= w[1];
  if (f.state === 'roll') return inWin(DODGE.roll.invuln);
  if (f.state === 'spotdodge') return inWin(DODGE.spot.invuln);
  if (f.state === 'airdodge') return inWin(DODGE.air.invuln);
  if (!gov && f.action && (f.state === 'attack' || f.state === 'grabbing' || f.state === 'taunt')) return actions.intangibleAt(f);
  return false;
}

/** Observer query (snapshots, tools): same answer as isIntangible, never spends budget. */
export const isIntangiblePure = (f) => isIntangible(f, true);

export function staleMultiplier(a, name) {
  let mult = 1;
  a.stale.forEach((s, i) => { if (s === name) mult -= COMBAT.stalePenalty[i]; });
  return Math.max(0.5, mult);
}

const tierOf = (hb, fallback) => hb.tier || fallback || 'special';

/**
 * Step 1-2 of §3.13: every candidate hit this frame, in fixed order (fighters by
 * index → their action boxes in list order → entities by id). Marks hit keys and
 * handles melee clanks as v1 did. Returns hit records:
 *   { attacker, target, hb, x, y, dir, slot, effect, projectile, charge, tier, kind,
 *     entity, key }
 */
// Governed matches: all of one owner's minions together strike a target at most once per
// minion minRehit (a swarm of 5 hits like one minion, not five).
const SWARM_REHIT = 20;
const SWARMS = new WeakMap();
function swarmOf(game) { let m = SWARMS.get(game); if (!m) { m = new Map(); SWARMS.set(game, m); } return m; }

export function collectHits(game) {
  const hits = [];
  const alive = game.fighters.filter((f) => !f.eliminated && f.state !== 'dead');
  for (const a of alive) {
    if (a.extraHits && a.extraHits.length) script.collectExtraHits(game, a, alive, hits); // api.hit / timeline hit boxes
    const boxes = actions.activeHitboxes(a);
    if (!boxes.length) continue;
    const act = a.action;
    for (const t of alive) {
      if (t === a || isIntangible(t)) continue;
      const hurt = hurtShapes(t);
      for (const b of boxes) {
        const key = `${t.id}:${b.key}`;
        if (act.hitKeys.has(key)) continue;
        if (overlapAny([b.shape], hurt)) {
          act.hitKeys.add(key);
          const c = center(b.shape);
          hits.push({
            attacker: a, target: t, hb: b.hb, x: c.x, y: c.y, dir: a.facing, slot: act.name, effect: act.def.effect,
            charge: act.chargeFrames, tier: tierOf(b.hb, act.def.category), kind: b.hb.kind || 'strike', key,
          });
        }
      }
    }
    // melee vs enemy entities: v1 clank, reflect/absorb, hp, part relay, clones (WP-G)
    entities.meleeVsEntities(game, a, boxes, hits);
  }
  for (const e of game.entities) {
    if (!entities.alive(e)) continue;
    const owner = game.fighter(e.owner);
    const boxes = entities.hitboxesOf(e);
    const swarm = e.kind === 'minion' && game.gov ? swarmOf(game) : null;
    let stop = false;
    for (const t of alive) {
      if (t.id === e.owner || isIntangible(t)) continue;
      const sk = swarm ? `${e.owner}>${t.id}` : null;
      if (sk && game.frame - (swarm.get(sk) ?? -1e9) < SWARM_REHIT) continue; // one owner's minions share a rehit timer
      const hurt = hurtShapes(t);
      for (const b of boxes) {
        const key = `${t.id}:${b.key}`;
        if (e.hitKeys && e.hitKeys.has(key)) continue;
        if (!overlapAny([b.shape], hurt)) continue;
        if (e.hitKeys) e.hitKeys.add(key);
        if (sk && (b.hb.kind || 'strike') === 'strike') swarm.set(sk, game.frame);
        stop = entities.onHitConnect(game, e, t, b.hb);
        const c = center(b.shape);
        hits.push({
          attacker: owner, target: t, hb: b.hb, x: c.x, y: c.y, dir: entities.entityDir(e), slot: e.slot,
          effect: e.effect, projectile: true, charge: 0, entity: e, kind: b.hb.kind || 'strike', key,
          tier: tierOf(b.hb, e.tier || owner?.char.moves?.[e.slot]?.category),
        });
        break;
      }
      if (stop) break;
    }
  }
  entities.collectHits(game, alive, hits); // clones, entity-vs-entity, parts, clash (WP-G)
  entities.sweep(game);
  return hits;
}

/**
 * Step 3 of §3.2: collect → kind resolution → apply. Counter windows
 * (actions.tryCounter), grab connects (actions.grabConnect) and wind are dispatched
 * here. Legacy (ungoverned) strikes apply one after another in v1 order (golden
 * replays); governed strikes trade simultaneously (§3.13): every result is computed
 * from the pre-hit state, then all are applied.
 */
export function resolveHits(game) {
  const hits = collectHits(game);
  const batch = game.gov ? [] : null;
  for (const h of hits) {
    if (!h.attacker) continue; // owner left the match
    if (h.kind === 'strike' && actions.tryCounter(h.target, h)) continue;
    if (h.kind === 'grab') { actions.grabConnect(game, h); continue; }
    if (h.kind === 'wind') { applyWind(game, h); continue; }
    if (h.kind !== 'strike') continue; // reflect/absorb act on entities (entities.js)
    if (batch) { const rec = computeGoverned(game, h); if (rec) batch.push(rec); } else applyHit(game, h);
  }
  if (batch && batch.length) applyBatch(game, batch);
  actions.resolveGrabs(game); // grab-vs-grab techs, strike beats grab (§3.6.2)
}

export { resolveHits as resolve };

const WIND_MAX = 6; // px/f per axis
const capAdd = (k, p) => Math.max(Math.min(k, -WIND_MAX), Math.min(Math.max(k, WIND_MAX), k + p)); // never cuts a launch

/**
 * Wind (0 damage): adds a push to the target's knockback velocity. windDir: 'facing' (h.dir),
 * 'away' / 'toward' the box center (2D), or 'angle' (hb.angle, 90 = up). Governed by windPush.
 */
export function applyWind(game, h) {
  const t = h.target;
  if (t.state === 'shield') return;
  const hb = h.hb;
  const push = Math.max(0, Math.min(WIND_MAX, hb.push || 0));
  if (!push) return;
  let px = h.dir * push, py = 0;
  if (hb.windDir === 'away' || hb.windDir === 'toward') {
    const dx = t.x - h.x, dy = t.y - collider(t).h / 2 - h.y;
    const d = Math.hypot(dx, dy);
    const m = hb.windDir === 'toward' ? -Math.min(push, d) : push; // a pull never overshoots the center
    px = d > 0.5 ? (dx / d) * m : 0; py = d > 0.5 ? (dy / d) * m : 0;
  } else if (hb.windDir === 'angle') {
    const r = (normalizeAngle(hb.angle || 0) * Math.PI) / 180;
    px = Math.cos(r) * push * h.dir; py = -Math.sin(r) * push;
  }
  if (game.gov) ({ px, py } = game.gov.windPush(t, px, py, h.tier));
  t.kx = capAdd(t.kx, px);
  if (py) {
    t.ky = capAdd(t.ky, py);
    if (t.grounded && t.ky < -0.5) {
      leaveGround(t);
      if (t.state === 'idle' || t.state === 'run' || t.state === 'crouch' || t.state === 'land') setState(t, 'air');
    }
  }
}

/** Records staleness exactly like v1 (shared by both paths). */
function markStale(a, slot, projectile) {
  const la = a.lastAction;
  if (!(la && la.hitSomething) || projectile) {
    a.stale.unshift(slot);
    if (a.stale.length > COMBAT.staleQueueSize) a.stale.pop();
    if (la) la.hitSomething = true;
  }
}

function shieldHit(game, h, damage, setLag = assignLag) {
  const { attacker: a, target: t, x, y, dir, projectile } = h;
  t.shield -= damage * SHIELD.damageMultiplier;
  t.shieldStun = Math.round(SHIELD.stunBase + damage * SHIELD.stunPerDamage);
  t.vx = dir * damage * SHIELD.pushback;
  if (!projectile) setLag(a, Math.min(8, hitlagFrames(damage) - 2));
  setLag(t, Math.min(8, hitlagFrames(damage) - 2));
  if (game.gov) { t.lastHitFrame = game.frame; t.lastHitBy = a.id; } // strike beats grab covers shields too
  game.emit({ type: 'shieldhit', id: t.id, x, y, damage });
  if (t.shield <= 0) breakShield(t);
}

const assignLag = (f, v) => { f.hitlag = v; };

/** Post-launch bookkeeping shared by both paths (v1 order). */
function launch(game, h, kx, ky, hitstun, tumble) {
  const { attacker: a, target: t, dir } = h;
  t.kx = kx;
  t.ky = ky;
  t.vx = 0;
  t.vy = 0;
  t.hitstun = hitstun;
  t.tumble = tumble;
  if (t.ky < -0.5 || t.tumble) leaveGround(t);
  t.fastFall = false;
  t.usedAirDodge = false;
  t.usedSideSpecial = false;
  t.air.used.clear();
  t.facing = -dir;
  setState(t, 'hitstun');
  t.lastHitBy = a.id;
  t.lastHitFrame = game.frame;
}

export function applyHit(game, h) {
  if (game.gov) return applyGoverned(game, h);
  const { attacker: a, target: t, hb, x, y, dir, slot, effect, projectile, charge } = h;
  const chargeMul = 1 + (charge / COMBAT.smashChargeMax) * COMBAT.smashChargeBonus;
  const damage = Math.round(hb.damage * staleMultiplier(a, slot) * chargeMul * 10) / 10;
  markStale(a, slot, projectile);

  if (t.state === 'shield') return shieldHit(game, h, damage);

  t.percent = Math.min(MATCH.maxPercent, t.percent + damage);
  const kb = knockback(t.percent, damage, t.stats.weight, hb.knockback, hb.growth);
  let angle = normalizeAngle(hb.angle);
  // Spikes on grounded targets pop them up instead.
  if (t.grounded && angle > 180 && angle < 360) angle = 360 - angle;
  // Directional influence: holding perpendicular to the launch bends it slightly.
  const ix = ((t.input.right ? 1 : 0) - (t.input.left ? 1 : 0));
  const iy = ((t.input.up ? 1 : 0) - (t.input.down ? 1 : 0));
  if (ix || iy) {
    const rad = (angle * Math.PI) / 180;
    const lx = Math.cos(rad) * dir, ly = Math.sin(rad);
    const cross = lx * iy - ly * ix; // + means input is counter-clockwise of launch
    const len = Math.hypot(ix, iy);
    const delta = PHYSICS.diMaxDegrees * (cross / len) * (dir > 0 ? 1 : -1);
    angle += delta;
  }
  const speed = launchSpeed(kb);
  const v = angleToVector(angle, dir, speed);
  launch(game, h, v.x, v.y, hitstunFrames(kb), kb >= PHYSICS.tumbleThreshold);
  const lag = hitlagFrames(damage);
  t.hitlag = lag;
  if (!projectile) a.hitlag = lag;
  a.damageDealt += damage;
  game.emit({ type: 'hit', attacker: a.id, target: t.id, x, y, damage, kb: Math.round(kb), effect, angle: Math.round(angle), dir, percent: t.percent, strong: kb > 110, ...hitStyle(h) });
  afterHit(game, h, damage);
}

/**
 * Governor path (§4.2.1). Governor.applyHit(ctx) writes target.percent and returns
 * {damage, kb, speed, angle, kx, ky, hitstun, hitlag, tumble, gov[], armored, broke,
 * relayed}; applyGovernedResult applies velocity/state/hitlag and emits the hit event.
 * Armor and gov events are emitted by the Governor itself.
 */
function applyGoverned(game, h) {
  const rec = computeGoverned(game, h);
  if (rec) applyGovernedResult(game, rec, assignLag);
}

/** Compute half of a governed strike: staleness, shield damage or Governor.applyHit. */
function computeGoverned(game, h) {
  const gov = game.gov;
  const { attacker: a, target: t, hb, dir, slot, projectile, charge } = h;
  const stale = staleMultiplier(a, slot);
  markStale(a, slot, projectile);
  const ctx = {
    attacker: a, target: t, hb, kind: h.kind, tier: h.tier, stale, chargeFrames: charge, dir,
    reflected: !!(h.entity && h.entity.reflected), clone: !!(h.entity && h.entity.kind === 'clone'),
    // Minions are independent attackers: their rehits are full combo hits (prorate + BREAK), not 1/3.
    rehit: !!(h.rehit || (h.hb && h.hb.rehit)) && !(h.entity && h.entity.kind === 'minion'), grab: h.kind === 'throw' || h.kind === 'grab',
    relay: h.relay, // part relay < 1 (entities.js, §3.9.1)
  };
  if (t.state === 'shield') return { h, shield: gov.shieldDamage(ctx).damage };
  const r = gov.applyHit(ctx);
  return r ? { h, r } : null;
}

/**
 * Simultaneous trades (§3.13): all results were computed against the pre-hit state.
 * Fighters struck this frame get their own landed strikes' onHit lists before any
 * launch ends their action; hitlag is the max of everything a fighter got this frame.
 */
function applyBatch(game, batch) {
  const struck = new Set();
  for (const rec of batch) if (rec.r) struck.add(rec.h.target);
  for (const rec of batch) {
    const h = rec.h;
    if (rec.r && !h.projectile && struck.has(h.attacker)) { actions.onHitConnect(h.attacker, h); rec.pre = true; }
  }
  const lags = new Map();
  const setLag = (f, v) => { const m = lags.has(f) ? Math.max(lags.get(f), v) : v; lags.set(f, m); f.hitlag = m; };
  for (const rec of batch) applyGovernedResult(game, rec, setLag);
}

function applyGovernedResult(game, rec, setLag) {
  const { h, r } = rec;
  if (!r) return shieldHit(game, h, rec.shield, setLag);
  const { attacker: a, target: t, x, y, dir, effect, projectile } = h;
  const damage = r.damage;
  if (!(r.armored || r.relayed)) {
    launch(game, h, r.kx, r.ky, r.hitstun, r.tumble);
    if (r.broke) setState(t, t.grounded ? 'idle' : 'air');   // BREAK: actionable now (§4.2.3)
  }
  setLag(t, r.hitlag);
  if (!projectile) setLag(a, r.hitlag);
  a.damageDealt += damage;
  game.emit({
    type: 'hit', attacker: a.id, target: t.id, x, y, damage: Math.round(damage * 10) / 10, kb: Math.round(r.kb), effect,
    angle: Math.round(r.angle), dir, percent: t.percent, strong: r.kb > 110, gov: r.gov || [], armored: !!r.armored, broke: !!r.broke, ...hitStyle(h),
  });
  afterHit(game, h, damage, r.intended, rec.pre);
}

// Client fx styling for hit events (WP-L): move name, hitbox effect, move/entity color.
function hitStyle(h) {
  const c = h.entity ? h.entity.color ?? h.entity.render?.color : h.attacker.char?.moves?.[h.slot]?.color;
  return { move: h.slot ?? null, fx: h.hb?.effect ?? null, color: typeof c === 'string' ? c : null };
}

/** Hooks after a landed strike: on-hit statuses, resource gains, script events. */
function afterHit(game, h, damage, intended = damage, ranOnHit = false) {
  const { attacker: a, target: t, hb } = h;
  if (!h.projectile && !ranOnHit) actions.onHitConnect(a, h);
  if (hb.status) {
    const s = typeof hb.status === 'string' ? { name: hb.status } : hb.status;
    status.apply(t, s.name, { frames: s.frames, power: s.power, source: a });
  }
  resources.onDamage(a, 'hit', damage);
  resources.onDamage(t, 'hurt', damage);
  script.queueHitEvent(game, { attacker: a, target: t, damage, granted: damage, intended, move: h.slot, entity: h.entity || null, tier: h.tier, kind: h.kind, x: h.x, y: h.y });
}
