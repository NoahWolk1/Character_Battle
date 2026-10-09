// ─────────────────────────────────────────────────────────────────────────────
// Runtime Governor (spec §4.2). Every damage source (fighter boxes, entities,
// scripted hits, DoT, counters, throws), every self-movement source and every
// defensive source passes through here, so no character data or script can
// produce an early KO, an infinite combo, infinite health, a permanent stall or
// an entity flood. Pure, deterministic, browser-safe. All numbers: GOVERNOR.*.
//
// Wiring (WP-E/F/G/H/I): one `new Governor(game)` per match, behind
// rules.governor (default true). With rules.governor === false every gate is a
// pass-through and applyHit reproduces v1 numbers bit-for-bit (golden parity).
//
// Fighter fields read: id, index, percent, stats {weight, gravity, fallSpeed,
// height}, collider?.h, bodyScale, grounded, state, hitlag, hitstun, input,
// kx, ky, vx, vy, mods?, action? {def: {armor, intangible}, frame}, armorPassive,
// statuses? [{name, def, source, frames}], res?, soakers?, form, air?.
// Fighter fields written: percent (only here and in ko/respawn), gov (state),
// air.rise / air.stall / air.teleports (mirrors, when `air` exists).
// ─────────────────────────────────────────────────────────────────────────────
import { MATCH, PHYSICS, COMBAT } from '../constants.js';
import { GOVERNOR as G, STATUS_CAPS, MOD_RANGES, TIER, ENTITY_THREAT } from '../balance/governor-rules.js';
import { knockback, launchSpeed, hitstunFrames, hitlagFrames, angleToVector, normalizeAngle } from './combat.js';
import { buildKoTable, koTableAt, koTableKey, worstKoSpeed } from './ko-table.js';
const STUCK = new Set(['hitstun', 'stunned', 'grabbed', 'shieldbreak']);

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const floor2 = (v) => Math.floor(v * 100 + 1e-6) / 100;
const CHAIN_STATES = new Set(['hitstun', 'stunned', 'grabbed']);
const STALL_EXEMPT = new Set(['dead', 'respawn', 'grabbed', 'hitstun', 'shieldbreak']);
const AIR_EXEMPT = new Set(['dead', 'respawn', 'grabbed']);

/** Rolling sum over the last `w` frames (frames must be non-decreasing). */
export class Rolling {
  constructor(w) { this.w = w; this.vals = new Float64Array(w); this.last = -1; this.total = 0; }
  advance(frame) {
    if (frame <= this.last) return;
    if (frame - this.last >= this.w) { this.vals.fill(0); this.total = 0; } else {
      for (let t = this.last + 1; t <= frame; t++) { const i = t % this.w; this.total -= this.vals[i]; this.vals[i] = 0; }
      if (this.total < 1e-9) this.total = 0;
    }
    this.last = frame;
  }
  add(frame, v) { this.advance(frame); this.vals[frame % this.w] += v; this.total += v; }
  sum(frame) { this.advance(frame); return this.total; }
}

/** Clamps a combined modifier set to the §4.2.9 ranges (missing keys → 1). */
export function clampMods(m = {}) {
  const out = {};
  for (const k of Object.keys(MOD_RANGES)) out[k] = clampMod(k, m[k]);
  return out;
}
export function clampMod(key, v) {
  const r = MOD_RANGES[key];
  return clamp(fin(v, 1), r[0], r[1]);
}

export const prorate = (n) => Math.max(G.prorateMin, 1 - G.prorateStep * (Math.max(1, n) - 1));
export const prorateStun = (n) => Math.max(G.prorateStunMin, 1 - G.prorateStunStep * (Math.max(1, n) - 1));

/**
 * Pure KO-floor launch cap (§4.2.2).
 * @returns {{speed:number, clamped:boolean, downwardCapped:boolean, cap:number}}
 */
export function capLaunch(speed, angle, percent, floor, koTable, grounded, posTable = null) {
  if (percent >= floor) return { speed, clamped: false, downwardCapped: false, cap: Infinity };
  let worst = worstKoSpeed(koTable, angle, G.koDiWindow, G.koDiStep);
  // Raised targets (platforms, high air) are closer to the top blast zone: also judge from there.
  if (posTable && posTable !== koTable) worst = Math.min(worst, worstKoSpeed(posTable, angle, G.koDiWindow, G.koDiStep));
  const ramp = G.koRampMin + (1 - G.koRampMin) * (percent / floor);
  let cap = G.koSafety * worst * ramp;
  let downwardCapped = false;
  const a = normalizeAngle(angle);
  if (a > G.spikeArc[0] && a < G.spikeArc[1] && !grounded) {
    // Offstage/air spikes below the floor stay survivable: vertical component ≤ spikeVyMax.
    cap = Math.min(cap, G.spikeVyMax / Math.max(0.2, Math.abs(Math.sin(a * DEG))));
    downwardCapped = true;
  }
  return speed > cap ? { speed: cap, clamped: true, downwardCapped, cap } : { speed, clamped: false, downwardCapped, cap };
}

function newState() {
  return {
    chain: { active: false, n: 0, dmg: 0, lock: 0, idle: 0 },
    lockWin: new Rolling(G.lockUptime.window), // hitstun uptime (§4.2.3 addendum)
    breakInvuln: 0,
    immune: { stun: -1, confuse: -1, grab: -1 },  // frame until which immune (exclusive)
    ctrl: new Rolling(STATUS_CAPS.controlTotal.window), lastControl: -1e9,
    rate: new Map(),                               // attackerId → {r: Rolling120, l: Rolling600, s: RollingShield}
    mit: { stock: 0, win: new Rolling(G.mitigation.window), heal: new Rolling(G.heal.window) },
    intang: { win: new Rolling(G.intangible.window), until: -1, charged: -1, deniedAt: -1e9, deniedKey: null },
    armor: { uptime: new Rolling(G.armor.window), until: -1, thr: 0, deniedAt: -1e9 },
    air: { rise: 0, stall: 0, teleports: 0, frames: 0, selfRising: false, selfAt: -1, lastVy: 0, stallOut: false, riseOut: false, helpless: false, tick: -1 },
    ent: { spawns: new Rolling(G.entities.spawnWindow), cooldown: new Map() },
  };
}

export class Governor {
  /** @param {object} game  {frame, stage, rules, fighters, emit?(e) | events[], entities?} */
  constructor(game) {
    this.game = game;
    this.enabled = game?.rules?.governor !== false;
    // Telemetry for calibration / --audit (never affects results).
    this.stats = {
      hits: 0, intended: 0, prorated: 0, dealt: 0, trimPerHit: 0, trimRate: 0, mitigated: 0,
      koClamps: 0, spikeCaps: 0, speedClamps: 0, breaks: 0, armored: 0, events: {}, // koClamps: KO-floor clamps only; spikeCaps: airborne spike caps
    };
    if (this.enabled && game?.stage && Array.isArray(game.fighters)) for (const f of game.fighters) if (f?.stats) this.koTableFor(f);
  }

  get frame() { return (this.game && this.game.frame) | 0; }

  /** Governor state of a fighter (created lazily on f.gov). */
  state(f) { return f.gov || (f.gov = newState()); }

  emit(e) {
    this.stats.events[e.rule || e.type] = (this.stats.events[e.rule || e.type] || 0) + 1;
    const g = this.game;
    if (!g) return;
    if (typeof g.emit === 'function') g.emit(e); else if (Array.isArray(g.events)) g.events.push(e);
  }

  gov(rule, who, target, amount) {
    this.emit({ type: 'gov', rule, who: who ?? null, target: target ?? null, amount: r1(fin(amount)) });
  }

  koTableFor(t) {
    if (t.koTable) return t.koTable;
    const s = t.stats || {};
    const h = t.collider?.h ? t.collider.h * fin(t.bodyScale, 1) : fin(s.height, 0);
    const k = koTableKey(fin(s.gravity, 0.65), fin(s.fallSpeed, 11), h);
    return buildKoTable(this.game.stage, k.gravity, k.fallSpeed, k.height);
  }

  /** KO table for launches from t's current height (lazy; center table at ground level). */
  koTableHere(t) {
    const s = t.stats || {};
    const h = t.collider?.h ? t.collider.h * fin(t.bodyScale, 1) : fin(s.height, 0);
    const k = koTableKey(fin(s.gravity, 0.65), fin(s.fallSpeed, 11), h);
    const gy = fin(this.game.stage?.ground?.y, 0);
    return koTableAt(this.game.stage, k.gravity, k.fallSpeed, k.height, fin(t.y) - gy);
  }

  // ── §4.2.1 hits ────────────────────────────────────────────────────────
  /**
   * Resolves one strike/throw on a non-shielding target and writes target.percent.
   * The caller applies kx/ky, hitstun, hitlag, state and emits the 'hit' event.
   * @param {object} ctx
   *   target, attacker (owning fighter or null), hb {damage, angle, knockback, growth, setKnockback?,
   *   hitlagMul?}, tier ('smash'|'projectile'|...), dir (±1), stale (0.5..1), chargeFrames,
   *   reflected, clone, rehit (rehit-generated hit), kind ('strike'|'throw'|'wind'), grab (bool),
   *   relay (part relay < 1), soak ([{fraction, costPerDamage, idx|get/set, forms?}]), di (false = none)
   * @returns {{damage, kb, speed, angle, kx, ky, hitstun, hitlag, tumble, gov: string[], armored, broke,
   *   relayed, prevented, partDamage, downwardCapped, percent}}
   */
  applyHit(ctx) {
    if (!this.enabled) return this.legacyHit(ctx);
    const t = ctx.target;
    const a = ctx.attacker || null;
    const hb = ctx.hb || {};
    const tierName = TIER[ctx.tier] ? ctx.tier : 'special';
    const tier = TIER[tierName];
    const dir = ctx.dir === -1 ? -1 : ctx.dir === 1 ? 1 : (a && a.facing === -1 ? -1 : 1);
    const kind = ctx.kind || 'strike';
    const g = this.state(t);
    const gov = [];
    const amounts = {};
    const st = this.stats;

    // Damage multiplier.
    const stale = clamp(fin(ctx.stale, 1), G.staleMin, 1);
    const chargeMul = Math.min(G.chargeMax, 1 + (0.4 * Math.max(0, fin(ctx.chargeFrames))) / G.chargeFramesFull);
    const dOut = clampMod('damageOut', a?.mods?.damageOut);
    const dIn = clampMod('damageIn', t.mods?.damageIn);
    const mult = clamp(stale * chargeMul * dOut * Math.max(1, dIn) * (ctx.reflected ? G.reflectedMul : 1) * (ctx.clone ? G.cloneMul : 1), G.multMin, G.multMax);
    let d = Math.max(0, fin(hb.damage)) * mult;
    const intended = d;

    // Combo proration (§4.2.3).
    const w = kind === 'wind' ? 0 : ctx.rehit ? G.rehitWeight : 1;
    const n = (g.chain.active ? g.chain.n : 0) + w;
    d *= prorate(n);
    const prorated = d;

    // Per-hit cap.
    const cap = Math.min(G.perHitTierMul * tier.maxHit, G.absMaxHit);
    if (d > cap) { amounts.perHit = d - cap; d = cap; gov.push('perHit'); }
    const capped = d;

    // Damage rate (§4.2.4).
    d = this.rateLimit(a, t, d, gov, amounts);
    const rated = d;

    // Mitigation: damageIn savings, part relay, soak (§4.2.6).
    const mit = this.mitigate(t, d, dIn, ctx, gov, amounts);
    d = mit.d;

    st.hits++; st.intended += intended; st.prorated += intended - prorated;
    st.trimPerHit += prorated - capped; st.trimRate += Math.max(0, capped - rated); st.mitigated += mit.prevented; st.dealt += d;

    const pBefore = fin(t.percent);
    t.percent = clamp(pBefore + d, 0, MATCH.maxPercent);
    const pAfter = t.percent;

    const base = { damage: d, intended, gov, prevented: mit.prevented, partDamage: rated, percent: pAfter, broke: false, armored: false, relayed: false, downwardCapped: false };
    const hitlag = Math.floor(hitlagFrames(d) * clamp(fin(hb.hitlagMul, 1), G.hitlagMulMin, G.hitlagMulMax));
    g.air.selfRising = false;
    g.air.frames = 0;

    // Part relay < 1: damage only, no knockback or hitstun (§3.9.1).
    if (mit.relayed) {
      this.flushGov(gov, amounts, a, t);
      return { ...base, relayed: true, kb: 0, speed: 0, angle: normalizeAngle(fin(hb.angle)), kx: 0, ky: 0, hitstun: 0, hitlag, tumble: false };
    }

    // Knockback.
    const kIn = clampMod('knockbackIn', t.mods?.knockbackIn);
    const cl = ctx.clone ? 0.7 : 1;
    let kb = typeof hb.setKnockback === 'number'
      ? fin(hb.setKnockback)
      : knockback(pAfter, d, fin(t.stats?.weight, 100), fin(hb.knockback) * cl, fin(hb.growth) * cl);
    kb = Math.max(0, fin(kb * kIn));

    // Flinch-only armor (§4.2.7).
    if (!ctx.grab && kind !== 'throw' && kb < G.armorFailKb) {
      const thr = this.armorAt(t);
      if (thr > 0 && thr >= d) {
        st.armored++;
        this.emit({ type: 'armor', id: t.id, by: a?.id ?? null, damage: r1(d) });
        this.flushGov(gov, amounts, a, t);
        return { ...base, armored: true, kb, speed: 0, angle: normalizeAngle(fin(hb.angle)), kx: 0, ky: 0, hitstun: 0, hitlag, tumble: false };
      }
    }

    // Angle: grounded spike flip, then v1 DI.
    let angle = normalizeAngle(fin(hb.angle));
    if (t.grounded && angle > 180 && angle < 360) angle = 360 - angle;
    if (ctx.di !== false) angle += diDelta(t, angle, dir);

    // KO floor (judged on the pre-hit percent) and absolute speed cap.
    let speed = launchSpeed(kb);
    const floor = Math.max(G.hardKoFloor, tier.koFloor);
    const c = capLaunch(speed, angle, pBefore, floor, this.koTableFor(t), !!t.grounded, pBefore < floor ? this.koTableHere(t) : null);
    if (c.clamped) {
      amounts.koFloor = speed - c.speed; gov.push('koFloor');
      // Airborne spike caps are by design (owner decision a): counted apart from upward KO-floor clamps.
      if (c.downwardCapped) { gov.push('spike'); st.spikeCaps++; } else st.koClamps++;
    }
    speed = c.speed;
    if (speed > G.maxSpeed) { amounts.speed = speed - G.maxSpeed; speed = G.maxSpeed; gov.push('speed'); st.speedClamps++; }
    const kbEff = Math.min(kb, speed / COMBAT.knockbackScale);

    let hitstun = Math.floor(hitstunFrames(kbEff) * prorateStun(n));
    if (c.downwardCapped) hitstun = Math.min(hitstun, G.spikeHitstunMax);
    if (hitstun > 0 && g.lockWin.sum(this.frame) >= G.lockUptime.max) {
      hitstun = 0; gov.push('lock'); amounts.lock = g.lockWin.sum(this.frame);
    }
    const tumble = kbEff >= PHYSICS.tumbleThreshold;
    if (tumble) this.refundAir(t);

    // Chain bookkeeping and BREAK.
    const ch = g.chain;
    if (!ch.active) { ch.active = true; ch.n = 0; ch.dmg = 0; ch.lock = 0; }
    ch.n += w; ch.dmg += d; ch.idle = 0;
    let broke = false;
    if (kind !== 'wind' && (ch.n >= G.breakHits || ch.dmg >= G.breakDamage || ch.lock >= G.breakLock)) {
      broke = true;
      hitstun = 0;
      this.doBreak(t, a);
    }

    const v = angleToVector(angle, dir, speed);
    this.flushGov(gov, amounts, a, t);
    return { ...base, broke, kb: kbEff, speed, angle, kx: v.x, ky: v.y, hitstun, hitlag, tumble, downwardCapped: c.downwardCapped };
  }

  /**
   * Wind gate (wind is 0 damage and 0 combo weight, so it can't KO by itself): below the tier's
   * KO floor, an offstage target is never pushed farther out or down, and nobody is lifted more
   * than G.windLift px above the main ground. Returns the allowed push {px, py}.
   */
  windPush(t, px, py, tier) {
    px = fin(px); py = fin(py);
    if (!this.enabled) return { px, py };
    const floor = Math.max(G.hardKoFloor, (TIER[tier] || TIER.special).koFloor);
    if (fin(t.percent) >= floor) return { px, py };
    const g = this.game.stage?.ground;
    if (!g) return { px, py };
    const cx = (g.x1 + g.x2) / 2;
    const off = t.x < g.x1 || t.x > g.x2;
    let trimmed = false;
    if (off && px * (t.x - cx) > 0) { px = 0; trimmed = true; }
    if (py > 0 && (off || t.y > g.y)) { py = 0; trimmed = true; }
    if (py < 0 && g.y - t.y >= G.windLift) { py = 0; trimmed = true; }
    if (trimmed) {
      const st = this.state(t);
      if (this.frame - (st.windAt ?? -1e9) >= 60) { st.windAt = this.frame; this.gov('wind', t.id, null, 0); }
    }
    return { px, py };
  }

  /** v1 hit math, bit-identical to the v1 Game.applyHit (rules.governor === false). Writes percent. */
  legacyHit(ctx) {
    const t = ctx.target;
    const hb = ctx.hb;
    const dir = ctx.dir;
    const charge = ctx.chargeFrames || 0;
    const chargeMul = 1 + (charge / COMBAT.smashChargeMax) * COMBAT.smashChargeBonus;
    const damage = Math.round(hb.damage * (ctx.stale ?? 1) * chargeMul * 10) / 10;
    t.percent = Math.min(MATCH.maxPercent, t.percent + damage);
    const kb = knockback(t.percent, damage, t.stats.weight, hb.knockback, hb.growth);
    let angle = normalizeAngle(hb.angle);
    if (t.grounded && angle > 180 && angle < 360) angle = 360 - angle;
    if (ctx.di !== false) angle += diDelta(t, angle, dir);
    const speed = launchSpeed(kb);
    const v = angleToVector(angle, dir, speed);
    return {
      damage, kb, speed, angle, kx: v.x, ky: v.y, hitstun: hitstunFrames(kb), hitlag: hitlagFrames(damage),
      tumble: kb >= PHYSICS.tumbleThreshold, gov: [], armored: false, broke: false, relayed: false,
      prevented: 0, partDamage: damage, downwardCapped: false, percent: t.percent,
    };
  }

  /**
   * Damage dealt to a shield (before SHIELD.damageMultiplier). Same multiplier and per-hit cap
   * as applyHit, × hb.shieldMul (0.5..1.5), then the shield rate limit. Legacy: v1 rounding.
   */
  shieldDamage(ctx) {
    const hb = ctx.hb || {};
    if (!this.enabled) {
      const chargeMul = 1 + ((ctx.chargeFrames || 0) / COMBAT.smashChargeMax) * COMBAT.smashChargeBonus;
      return { damage: Math.round(hb.damage * (ctx.stale ?? 1) * chargeMul * 10) / 10, gov: [] };
    }
    const a = ctx.attacker || null;
    const t = ctx.target;
    const tier = TIER[ctx.tier] || TIER.special;
    const gov = [];
    const amounts = {};
    const stale = clamp(fin(ctx.stale, 1), G.staleMin, 1);
    const chargeMul = Math.min(G.chargeMax, 1 + (0.4 * Math.max(0, fin(ctx.chargeFrames))) / G.chargeFramesFull);
    const mult = clamp(stale * chargeMul * clampMod('damageOut', a?.mods?.damageOut) * (ctx.reflected ? G.reflectedMul : 1) * (ctx.clone ? G.cloneMul : 1), G.multMin, G.multMax);
    let d = Math.min(Math.max(0, fin(hb.damage)) * mult, Math.min(G.perHitTierMul * tier.maxHit, G.absMaxHit));
    d *= clamp(fin(hb.shieldMul, 1), 0.5, 1.5);
    if (a) {
      const S = G.shieldRate;
      const rec = this.rateRec(a, t);
      const now = this.frame;
      const sum = rec.s.sum(now);
      let out = d;
      const free = Math.max(0, S.soft - sum);
      if (d > free + 1e-9) out = free + (d - free) * S.softMul;
      const head = floor2(Math.max(0, S.hard - sum));
      if (out > head) out = head;
      if (out < d - 1e-9) { amounts.shieldRate = d - out; gov.push('shieldRate'); }
      out = Math.min(r2(out), head);
      d = out;
      rec.s.add(now, d);
    }
    this.flushGov(gov, amounts, a, t);
    return { damage: r2(d), gov };
  }

  /** One DoT tick (status tier): no knockback, counts toward the rate limit, not toward combo n. */
  applyDot(source, target, damage) {
    if (!this.enabled) {
      const d = Math.max(0, fin(damage));
      target.percent = clamp(fin(target.percent) + d, 0, MATCH.maxPercent);
      return { damage: d, gov: [] };
    }
    const gov = [];
    const amounts = {};
    const a = source && typeof source === 'object' ? source : null;
    const dIn = clampMod('damageIn', target.mods?.damageIn);
    let d = Math.min(STATUS_CAPS.dot.maxPerTick, Math.max(0, fin(damage))) * Math.max(1, dIn);
    d = Math.min(d, STATUS_CAPS.dot.maxPerTick * MOD_RANGES.damageIn[1]);
    d = this.rateLimit(a, target, d, gov, amounts);
    const mit = this.mitigate(target, d, dIn, {}, gov, amounts);
    d = mit.d;
    target.percent = clamp(fin(target.percent) + d, 0, MATCH.maxPercent);
    this.stats.dealt += d;
    this.flushGov(gov, amounts, a, target);
    return { damage: d, gov };
  }

  rateRec(a, t) {
    const g = this.state(t);
    const key = a.id ?? a.index;
    let rec = g.rate.get(key);
    if (!rec) g.rate.set(key, rec = { r: new Rolling(G.rate.window), l: new Rolling(G.rate.longWindow), s: new Rolling(G.shieldRate.window) });
    return rec;
  }

  /** §4.2.4: soft ×0.25 above 40/120 f, hard 50/120 f and 140/600 f per attacker → target. */
  rateLimit(a, t, d, gov, amounts) {
    if (!a || a === t) return r2(d);
    const R = G.rate;
    const rec = this.rateRec(a, t);
    const now = this.frame;
    const s = rec.r.sum(now);
    const l = rec.l.sum(now);
    let out = d;
    const free = Math.max(0, R.soft - s);
    if (d > free + 1e-9) out = free + (d - free) * R.softMul;
    // Hard caps are strict: a hit past them still connects (knockback, hitstun) at 0 damage, so the
    // spec's 0.3 "minimum connect" only applies while headroom remains (then out = head ≥ 0.3 anyway).
    const head = floor2(Math.max(0, Math.min(R.hard - s, R.longHard - l)));
    if (out > head) out = head;
    if (out < d - 1e-9) { amounts.rate = (amounts.rate || 0) + d - out; gov.push('rate'); }
    out = Math.min(r2(out), head);
    rec.r.add(now, out);
    rec.l.add(now, out);
    return out;
  }

  // ── §4.2.6 mitigation ──────────────────────────────────────────────────
  /** Remaining preventable damage right now (per stock, per rolling window). */
  mitigationLeft(f) {
    const g = this.state(f);
    const M = G.mitigation;
    return Math.max(0, Math.min(M.perStock - g.mit.stock, M.perWindow - g.mit.win.sum(this.frame)));
  }

  mitigate(t, d, dIn, ctx, gov, amounts) {
    const g = this.state(t);
    const M = G.mitigation;
    let allowance = Math.min(this.mitigationLeft(t), d * M.perHitFrac);
    let prevented = 0;
    let wanted = 0;
    let relayed = false;
    if (dIn < 1) {
      const want = d * (1 - dIn);
      wanted += want;
      const take = Math.min(want, allowance - prevented);
      prevented += Math.max(0, take);
    }
    if (typeof ctx.relay === 'number' && ctx.relay < 1) {
      const relay = clamp(ctx.relay, 0.5, 1);
      const want = d * (1 - relay);
      wanted += want;
      const take = Math.min(want, allowance - prevented);
      if (take > 0) { prevented += take; relayed = true; }
    }
    const soakers = ctx.soak || this.soakersOf(t);
    for (const s of soakers) {
      if (s.forms && t.form !== undefined && !s.forms.includes(t.form)) continue;
      const cost = Math.max(0.5, fin(s.costPerDamage, 1));
      const have = Math.max(0, fin(readRes(t, s)));
      const want = Math.min(d * clamp(fin(s.fraction), 0, 0.5), have / cost);
      wanted += want;
      const take = Math.min(want, allowance - prevented);
      if (take > 0) { writeRes(t, s, have - take * cost); prevented += take; }
    }
    if (prevented > 0) {
      prevented = Math.min(prevented, d);
      g.mit.stock += prevented;
      g.mit.win.add(this.frame, prevented);
    }
    if (wanted > prevented + 1e-9) { amounts.mitigation = wanted - prevented; gov.push('mitigation'); }
    return { d: Math.max(0, d - prevented), prevented, relayed };
  }

  soakersOf(t) { return Array.isArray(t.soakers) ? t.soakers : []; }

  /** Applies one soak source to d outside applyHit (e.g. entity hp hits). Returns {d, soaked}. */
  soak(target, d, soaker) {
    if (!this.enabled) return { d, soaked: 0 };
    const m = this.mitigate(target, d, 1, { soak: [soaker] }, [], {});
    return { d: m.d, soaked: m.prevented };
  }

  /** Heals `amount` percent within the heal and mitigation budgets. Returns the amount granted. */
  heal(f, amount) {
    const want = Math.max(0, fin(amount));
    if (!this.enabled) { const h = Math.min(want, fin(f.percent)); f.percent = fin(f.percent) - h; return h; }
    const g = this.state(f);
    const now = this.frame;
    if (f.state === 'hitstun' || f.state === 'dead' || f.state === 'respawn') { if (want > 0) this.gov('heal', f.id, null, want); return 0; }
    const left = Math.min(this.mitigationLeft(f), G.heal.perWindow - g.mit.heal.sum(now), fin(f.percent));
    const h = Math.max(0, Math.min(want, left));
    if (h > 0) {
      f.percent = Math.max(0, fin(f.percent) - h);
      g.mit.stock += h;
      g.mit.win.add(now, h);
      g.mit.heal.add(now, h);
    }
    if (h < want - 1e-9) this.gov('heal', f.id, null, want - h);
    return h;
  }

  // ── §4.2.3 BREAK ───────────────────────────────────────────────────────
  doBreak(t, a) {
    const g = this.state(t);
    const now = this.frame;
    g.breakInvuln = G.breakIntangible;
    g.immune.stun = Math.max(g.immune.stun, now + G.breakImmunity);
    g.immune.grab = Math.max(g.immune.grab, now + G.breakImmunity);
    g.chain.active = false; g.chain.n = 0; g.chain.dmg = 0; g.chain.lock = 0; g.chain.idle = 0;
    g.breakNow = now; // sim: actionable at once (status.syncBreak after endFrame; grabs release)
    this.stats.breaks++;
    this.emit({ type: 'break', target: t.id, by: a?.id ?? null });
  }

  /** True during the 30 engine-granted (uncharged) intangible frames after a BREAK. */
  breakIntangible(f) { return this.enabled && !!f.gov && f.gov.breakInvuln > 0; }

  /** Whether `f` is immune to a control kind ('stun'|'freeze'|'grab'|'confuse'). */
  immuneTo(f, kind) {
    if (!this.enabled) return false;
    const g = this.state(f);
    const group = kind === 'grab' ? 'grab' : STATUS_CAPS.control[kind]?.group;
    return group !== undefined && g.immune[group] !== undefined && g.immune[group] > this.frame;
  }

  // ── §4.2.5 air and movement ────────────────────────────────────────────
  /**
   * Gate for every self-velocity write. src 'jump' (engine jumps) is not charged to rise.
   * @returns {{vx:number, vy:number, gov:string[]}}
   */
  selfVelocity(f, vx, vy, src = 'script') {
    vx = fin(vx); vy = fin(vy);
    if (!this.enabled) return { vx, vy, gov: [] };
    const A = G.air;
    const g = this.state(f);
    const gov = [];
    if (src !== 'jump' && STUCK.has(f.state)) {
      // No self-velocity out of hitstun, stun, a grab or shield break (would cancel knockback).
      if (this.frame - (g.air.stuckAt ?? -1e9) >= 60) { g.air.stuckAt = this.frame; this.gov('selfVelocity', f.id, null, Math.hypot(vx - fin(f.vx), vy - fin(f.vy))); }
      return { vx: fin(f.vx), vy: fin(f.vy), gov: ['stuck'] };
    }
    if (Math.abs(vx) > A.maxVx) { vx = Math.sign(vx) * A.maxVx; gov.push('selfSpeed'); }
    if (vy < -A.maxRiseVy) { vy = -A.maxRiseVy; gov.push('selfSpeed'); }
    if (src === 'jump') g.air.selfRising = false;
    else if (!f.grounded && (g.air.stallOut || g.air.helpless) && vy < fin(f.vy)) {
      vy = fin(f.vy); gov.push('stall'); // stall spent: self-velocity can no longer slow the fall
    } else if (vy < 0) {
      const left = A.rise - g.air.rise;
      if (left <= 0) {
        vy = Math.max(0, fin(f.vy)); gov.push('rise'); // rise spent: keep falling (gravity), don't pin vy at 0
        if (!g.air.riseOut) { g.air.riseOut = true; this.gov('rise', f.id, null, A.rise); }
      } else {
        if (-vy > left) vy = -left;
        g.air.selfRising = true;
        g.air.selfAt = this.frame;
      }
    }
    return { vx, vy, gov };
  }

  /**
   * Per-frame air accounting (call from movement.update; endFrame calls it for fighters that
   * were not ticked). Charges self rise and stall, clamps exhausted rise, runs the long-air backstop.
   * @returns {{stallExhausted:boolean, helpless:boolean, riseLeft:number, stallLeft:number}}
   */
  airTick(f) {
    const g = this.state(f);
    const air = g.air;
    const A = G.air;
    const now = this.frame;
    if (!this.enabled || air.tick === now) return this.airInfo(f);
    air.tick = now;
    if (f.grounded || AIR_EXEMPT.has(f.state)) { air.frames = 0; return this.airInfo(f); }
    const vy = fin(f.vy);
    // A fresh upward kick this frame that did not come through selfVelocity is an engine jump: free.
    if (air.selfRising && air.selfAt !== now && vy < air.lastVy - 0.01) air.selfRising = false;
    if (air.selfRising) {
      if (vy >= 0) air.selfRising = false;
      else {
        const left = A.rise - air.rise;
        if (-vy > left) {
          f.vy = -Math.max(0, left);
          if (!air.riseOut) { air.riseOut = true; this.gov('rise', f.id, null, A.rise); }
        }
        air.rise += -fin(f.vy);
      }
    }
    const inKb = Math.hypot(fin(f.kx), fin(f.ky)) > 0.5;
    if (!air.stallOut && !STALL_EXEMPT.has(f.state) && !inKb && vy >= A.stallVyMin && vy <= A.stallVyMax) {
      air.stall++;
      if (air.stall >= A.stall && !air.stallOut) { air.stallOut = true; this.gov('stall', f.id, null, A.stall); }
    }
    air.lastVy = fin(f.vy);
    air.frames++;
    if (air.frames >= A.longAir && !air.helpless) { air.helpless = true; this.gov('longAir', f.id, null, air.frames); }
    this.mirrorAir(f);
    return this.airInfo(f);
  }

  airInfo(f) {
    const air = this.state(f).air;
    return {
      stallExhausted: this.enabled && air.stallOut, helpless: this.enabled && air.helpless,
      riseLeft: Math.max(0, G.air.rise - air.rise), stallLeft: Math.max(0, G.air.stall - air.stall),
    };
  }

  /** Stall budget spent: movement modes off, normal gravity/fallSpeed until landing. */
  stallExhausted(f) { return this.enabled && !!f.gov && f.gov.air.stallOut; }

  /**
   * Teleport gate: ≤ 200 px, ≤ 1 per airtime (grounded non-rising teleports are free), rise charged.
   * @returns {{ok:boolean, dx:number, dy:number}}
   */
  teleportRequest(f, dx, dy) {
    dx = fin(dx); dy = fin(dy);
    if (!this.enabled) return { ok: true, dx, dy };
    const A = G.air;
    const air = this.state(f).air;
    const counts = !f.grounded || dy < 0;
    const deny = () => { this.gov('teleport', f.id, null, Math.hypot(dx, dy)); return { ok: false, dx: 0, dy: 0 }; };
    if (STUCK.has(f.state)) return deny(); // no teleporting out of hitstun, stun or a grab
    if (counts && air.teleports >= A.teleports) return deny();
    const st = this.state(f);
    if (!counts) { // grounded blink: rate-limited instead of per airtime
      const fr = this.game.frame;
      if (st.groundTpAt != null && fr - st.groundTpAt < A.groundTeleportEvery) return deny();
      st.groundTpAt = fr;
    }
    const len = Math.hypot(dx, dy);
    if (len > A.teleportDist) { const k = A.teleportDist / len; dx *= k; dy *= k; this.gov('teleportDist', f.id, null, len - A.teleportDist); }
    if (dy < 0) {
      const left = Math.max(0, A.rise - air.rise);
      if (-dy > left) { dy = -left; this.gov('rise', f.id, null, A.rise); }
      air.rise += -dy;
    }
    if (counts) air.teleports++;
    this.mirrorAir(f);
    return { ok: true, dx, dy };
  }

  /** Landing (ground, platform, ledge-snap) and respawn: resets the per-airtime budgets. */
  airReset(f) {
    const air = this.state(f).air;
    air.rise = 0; air.stall = 0; air.teleports = 0; air.frames = 0;
    air.selfRising = false; air.stallOut = false; air.riseOut = false; air.helpless = false;
    this.mirrorAir(f);
  }

  refundAir(f) {
    const air = this.state(f).air;
    const k = G.air.hitRefund;
    air.rise *= 1 - k; air.stall = Math.floor(air.stall * (1 - k));
    if (air.rise < G.air.rise) air.riseOut = false;
    if (air.stall < G.air.stall) air.stallOut = false;
    air.helpless = false;
    this.mirrorAir(f);
  }

  mirrorAir(f) {
    if (!f.air || typeof f.air !== 'object') return;
    const air = this.state(f).air;
    f.air.rise = air.rise; f.air.stall = air.stall; f.air.teleports = air.teleports;
  }

  // ── §4.2.10 intangibility ──────────────────────────────────────────────
  intangibleLeft(f) {
    const I = this.state(f).intang;
    const now = this.frame;
    const pending = Math.max(0, I.until - (I.charged >= now ? now + 1 : now));
    return Math.max(0, G.intangible.budget - I.win.sum(now) - pending);
  }

  chargeIntang(f) {
    const I = this.state(f).intang;
    const now = this.frame;
    if (I.charged === now) return;
    I.win.add(now, 1);
    I.charged = now;
  }

  /**
   * Requests `frames` of character-sourced intangibility starting now (≤ 20 per grant,
   * ≤ 45 per rolling 300 frames). Counters pass {partial:false} with 12 frames.
   * @returns {number} frames granted (0 = denied, a 'gov intangible' event is emitted)
   */
  intangibleRequest(f, frames, { partial = true } = {}) {
    const want = Math.min(G.intangible.perGrant, Math.max(0, Math.floor(fin(frames))));
    if (!this.enabled) return want;
    if (want <= 0) return 0;
    const I = this.state(f).intang;
    const now = this.frame;
    const left = this.intangibleLeft(f);
    if (left <= 0 || (!partial && left < want)) { this.gov('intangible', f.id, null, want); return 0; }
    const grant = Math.min(want, left);
    const start = Math.max(now, I.until);
    I.until = start + grant;
    if (grant < want) this.gov('intangible', f.id, null, want - grant);
    return grant;
  }

  /**
   * True while `f` has character-sourced intangibility this frame: a granted reservation, or an
   * active action `intangible` window (charged 1 frame per frame while the budget lasts).
   */
  intangibleGranted(f) {
    const g = this.state(f);
    const I = g.intang;
    const now = this.frame;
    if (I.until > now) { if (this.enabled) this.chargeIntang(f); return true; }
    if (!actionWindow(f)) return false;
    if (!this.enabled) return true;
    if (I.charged === now) return true;
    if (this.intangibleLeft(f) > 0) { this.chargeIntang(f); return true; }
    const key = f.action;
    if (I.deniedKey !== key) { I.deniedKey = key; this.gov('intangible', f.id, null, 1); }
    return false;
  }

  /**
   * Side-effect-free twin of intangibleGranted for observers (snapshots, views, tools):
   * same answer for this frame, but never charges the budget or emits.
   */
  intangibleActive(f) {
    const I = this.state(f).intang;
    const now = this.frame;
    if (I.until > now) return true;
    if (!actionWindow(f)) return false;
    if (!this.enabled || I.charged === now) return true;
    return this.intangibleLeft(f) > 0;
  }

  /**
   * Hurtbox-shrink charge (§3.7). With `area`/`defaultArea` (both px² at the current bodyScale)
   * the Governor decides whether the set is "small" (area < 1600, or < 0.6 × A[default] ×
   * scaleMin²); without them the caller already decided. Small sets cost 1 intangible frame per
   * frame. Call once per frame per fighter.
   * @returns {boolean} true = keep the selected shapes; false = fall back to `default` shapes
   */
  chargeHurtArea(f, area, defaultArea) {
    if (!this.enabled) return true;
    if (typeof area === 'number' && Number.isFinite(area)) {
      const s = fin(f.bodyScale, 1) || 1;
      const sMin = clamp(fin(f.scaleMin ?? f.char?.body?.scaleRange?.[0], 1), 0.6, 1);
      const ref = typeof defaultArea === 'number' && Number.isFinite(defaultArea) ? 0.6 * (defaultArea / (s * s)) * sMin * sMin : 0;
      if (area >= G.minHurtArea && area >= ref) return true;
    }
    const I = this.state(f).intang;
    const now = this.frame;
    if (I.charged === now) return true;
    if (this.intangibleLeft(f) > 0) { this.chargeIntang(f); return true; }
    if (now - I.deniedAt >= 60) { I.deniedAt = now; this.gov('intangible', f.id, null, 1); }
    return false;
  }

  // ── §4.2.7 armor ───────────────────────────────────────────────────────
  /** Timeline / api armor: threshold ≤ 12 for `frames` frames (uptime-budgeted). */
  armorRequest(f, frames, threshold) {
    const A = this.state(f).armor;
    const thr = clamp(fin(threshold), 0, G.armor.maxThreshold);
    const fr = Math.max(0, Math.floor(fin(frames)));
    const now = this.frame;
    if (A.until > now) { A.until = Math.max(A.until, now + fr); A.thr = Math.max(A.thr, thr); } else { A.until = now + fr; A.thr = thr; }
    return { frames: fr, threshold: thr };
  }

  activeArmorRaw(f) {
    const A = this.state(f).armor;
    let thr = A.until > this.frame ? A.thr : 0;
    const act = f.action;
    const wins = act?.def?.armor;
    if (Array.isArray(wins)) {
      const t = act.frame | 0;
      for (const w of wins) if (w && t >= w.from && t <= w.to) thr = Math.max(thr, clamp(fin(w.threshold), 0, G.armor.maxThreshold));
    }
    return thr;
  }

  /** Current flinch-armor threshold (damage): passive (≤ 3) or active within the uptime budget. */
  armorAt(f) {
    const passive = clamp(fin(f.armorPassive), 0, G.armor.maxPassive);
    const raw = this.activeArmorRaw(f);
    if (!this.enabled) return Math.max(passive, raw);
    if (raw <= 0) return passive;
    const A = this.state(f).armor;
    if (A.uptime.sum(this.frame) >= G.armor.uptime) {
      if (this.frame - A.deniedAt >= 60) { A.deniedAt = this.frame; this.gov('armor', f.id, null, raw); }
      return passive;
    }
    return Math.max(passive, raw);
  }

  // ── §4.2.8 entities ────────────────────────────────────────────────────
  /**
   * Entity spawn gate. May expire older entities (returned in `expire`; the caller despawns them).
   * @param {object} owner fighter
   * @param {object} def   EntityDef ({kind, hp?, life?, hitboxes?, maxAlive?})
   * @param {number} [count=1]
   * @param {object} [opts] {name: template name, live: owner's live entity records (oldest first)}
   * @returns {{count:number, expire:object[], gov:string[]}}
   */
  spawnRequest(owner, def, count = 1, opts = {}) {
    count = Math.max(0, Math.floor(fin(count, 1)));
    if (!this.enabled) return { count, expire: [], gov: [] };
    const E = G.entities;
    const g = this.state(owner);
    const now = this.frame;
    const gov = [];
    const name = opts.name ?? def?.name ?? null;
    const kind = kindKey(def);
    const hpEnt = fin(def?.hp) > 0;
    if (hpEnt && name !== null && (g.ent.cooldown.get(name) ?? -1) > now) {
      this.gov('entityCooldown', owner.id, null, count);
      return { count: 0, expire: [], gov: ['entityCooldown'] };
    }
    const recent = g.ent.spawns.sum(now);
    let allowed = Math.min(count, Math.max(0, E.spawnsPerWindow - recent));
    if (allowed < count) gov.push('spawnRate');
    const live = (opts.live || this.liveEntities(owner)).filter((e) => e && !e.dead && e.alive !== false).map((e) => ({ e, kind: kindKey(e.def || e), hp: fin(e.def?.hp ?? e.hp) > 0, name: e.name ?? e.def?.name ?? null, threat: threatOf(e.def || e) }));
    const expire = [];
    const maxTpl = Math.min(E.maxPerTemplate, Math.max(1, Math.floor(fin(def?.maxAlive, E.maxPerTemplate))));
    const me = { kind, hp: hpEnt, name, threat: threatOf(def), pending: true };
    let granted = 0;
    for (let i = 0; i < allowed; i++) {
      const ok = this.fitOne(live, me, maxTpl, expire);
      if (!ok) break;
      live.push({ ...me });
      granted++;
    }
    if (granted < allowed) gov.push('entityCap');
    if (expire.length) gov.push('entityExpire');
    if (granted > 0) g.ent.spawns.add(now, granted);
    for (const r of gov) this.gov(r, owner.id, null, r === 'entityExpire' ? expire.length : count - granted);
    return { count: granted, expire, gov };
  }

  fitOne(live, me, maxTpl, expire) {
    const E = G.entities;
    const evict = (pred) => {
      const i = live.findIndex((x) => !x.pending && pred(x));
      if (i < 0) return false;
      expire.push(live[i].e);
      live.splice(i, 1);
      return true;
    };
    const count = (pred) => live.reduce((s, x) => s + (pred(x) ? 1 : 0), 0);
    const rules = [];
    if (me.name !== null) rules.push([(x) => x.name === me.name, maxTpl]);
    if (me.kind === 'beam') rules.push([(x) => x.kind === 'beam', E.maxBeams]);
    if (me.kind === 'clone') rules.push([(x) => x.kind === 'clone', E.maxClones]);
    if (isTrapZone(me.kind)) rules.push([(x) => isTrapZone(x.kind), E.maxTrapsZones]);
    if (me.hp) rules.push([(x) => x.hp, E.maxHp]);
    for (const [pred, max] of rules) {
      while (count(pred) + 1 > max) if (!evict(pred)) return false;
    }
    while (live.length + 1 > E.maxAlive) if (!evict((x) => x.kind === me.kind) && !evict(() => true)) return false;
    const threat = () => live.reduce((s, x) => s + x.threat, 0);
    if (me.threat > E.maxThreat) return false;
    while (threat() + me.threat > E.maxThreat) if (!evict((x) => x.kind === me.kind) && !evict(() => true)) return false;
    return true;
  }

  liveEntities(owner) {
    const src = this.game?.entities;
    const list = Array.isArray(src) ? src : Array.isArray(src?.list) ? src.list : src instanceof Map ? [...src.values()] : [];
    return list.filter((e) => e && (e.ownerIdx === owner.index || (e.owner !== undefined && e.owner === owner.id)))
      .sort((x, y) => (x.id ?? 0) - (y.id ?? 0));
  }

  /** An hp-entity template died: 300-frame respawn cooldown for that template. */
  entityDied(owner, name, def) {
    if (!this.enabled || name === null || name === undefined) return;
    if (def && !(fin(def.hp) > 0)) return;
    this.state(owner).ent.cooldown.set(name, this.frame + G.entities.hpCooldown);
  }

  // ── §4.2.9 statuses ────────────────────────────────────────────────────
  /**
   * Status gate. `def` = StatusDef ({frames, dot, control, heal, mods}).
   * @returns {{ok:boolean, frames:number, dot?:{every,damage}, control?:string, gov:string[]}}
   */
  statusRequest(source, target, name, def = {}, opts = {}) {
    let frames = Math.max(0, Math.floor(fin(opts.frames ?? def.frames, 0)));
    if (!this.enabled) return { ok: true, frames, dot: def.dot, control: def.control, gov: [] };
    const C = STATUS_CAPS;
    const g = this.state(target);
    const now = this.frame;
    const sid = source?.id ?? source ?? null;
    const deny = (rule) => { this.gov(rule, sid, target.id, frames); return { ok: false, frames: 0, gov: [rule] }; };
    const gov = [];
    frames = Math.min(frames, C.maxFrames);
    const list = Array.isArray(target.statuses) ? target.statuses : [];
    const existing = list.find((s) => s && s.name === name);
    if (!existing) {
      if (list.length >= C.perTarget) return deny('statusCap');
      if (sid !== null && list.filter((s) => s && (s.source === sid || s.source?.id === sid)).length >= C.perOwner) return deny('statusOwner');
    }
    if (def.heal && sid !== null && sid !== target.id) return deny('statusHeal');
    let dot;
    if (def.dot) {
      if (!existing && list.filter((s) => s && s.def?.dot).length >= C.dot.perTarget) return deny('dotCap');
      const every = Math.max(C.dot.minEvery, Math.floor(fin(def.dot.every, C.dot.minEvery)));
      const damage = clamp(fin(def.dot.damage), 0, C.dot.maxPerTick);
      if (damage > 0 && Math.floor(frames / every) * damage > C.dot.perApplication) {
        frames = Math.floor(C.dot.perApplication / damage) * every;
        gov.push('dotTotal');
      }
      dot = { every, damage };
    }
    const control = def.control;
    if (control) {
      const cap = C.control[control];
      if (!cap) return deny('statusControl');
      if (g.immune[cap.group] > now) return deny('controlImmune');
      if (frames > cap.max) { frames = cap.max; gov.push('controlCap'); }
      if (now - g.lastControl < C.reapplyWindow) { frames = Math.floor(frames * C.reapplyMul); gov.push('controlDR'); }
      if (C.controlTotal.kinds.includes(control)) {
        const left = C.controlTotal.max - g.ctrl.sum(now);
        if (frames > left) { frames = Math.max(0, left); gov.push('controlTotal'); }
        if (frames <= 0) return deny('controlTotal');
        g.ctrl.add(now, frames);
      }
      g.lastControl = now;
      if (cap.immunity > 0) g.immune[cap.group] = now + frames + cap.immunity;
    }
    for (const r of gov) this.gov(r, sid, target.id, frames);
    return { ok: frames > 0, frames, dot, control, gov };
  }

  /**
   * Grab gate: BREAK/post-release immunity and the shared control budget.
   * @returns {{ok:boolean, frames:number}} frames = allowed hold time
   */
  grabRequest(attacker, target, frames) {
    frames = Math.max(0, Math.floor(fin(frames)));
    if (!this.enabled) return { ok: true, frames };
    const g = this.state(target);
    const now = this.frame;
    if (g.immune.grab > now) { this.gov('grabImmune', attacker?.id, target.id, frames); return { ok: false, frames: 0 }; }
    const left = STATUS_CAPS.controlTotal.max - g.ctrl.sum(now);
    if (left <= 0) { this.gov('controlTotal', attacker?.id, target.id, frames); return { ok: false, frames: 0 }; }
    const hold = Math.min(frames, left);
    if (hold < frames) this.gov('controlTotal', attacker?.id, target.id, frames - hold);
    g.ctrl.add(now, hold);
    return { ok: true, frames: hold };
  }

  /** Grab ended (release/throw): `frames` of grab immunity (10 by default, §3.6.2). */
  grabReleased(target, frames = 10) {
    if (!this.enabled) return;
    const g = this.state(target);
    g.immune.grab = Math.max(g.immune.grab, this.frame + frames);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────
  /** Per-frame bookkeeping (step 6 of §3.2): chains, BREAK by lock, armor uptime, air. */
  endFrame(game = this.game) {
    if (!this.enabled) return;
    const now = this.frame;
    for (const f of game?.fighters || []) {
      if (!f) continue;
      const g = this.state(f);
      if (g.breakInvuln > 0) g.breakInvuln--;
      if (f.state === 'hitstun' || f.state === 'stunned') g.lockWin.add(now, 1);
      const ch = g.chain;
      if (ch.active) {
        const locked = (f.hitlag | 0) > 0 || CHAIN_STATES.has(f.state);
        if (locked) { ch.lock++; ch.idle = 0; } else if (++ch.idle >= G.chainIdleReset) { ch.active = false; ch.n = 0; ch.dmg = 0; ch.lock = 0; ch.idle = 0; }
        if (ch.active && ch.lock >= G.breakLock && (f.state === 'stunned' || f.state === 'grabbed')) {
          // A pure control lock (no further hits) breaks on its own.
          this.doBreak(f, null);
          g.breakNow = now;   // sim: make the fighter actionable (release grab / clear control)
        }
      }
      if (g.intang.until > now) this.chargeIntang(f);   // reserved frames are spent even if never queried
      if (this.activeArmorRaw(f) > 0 && g.armor.uptime.sum(now) < G.armor.uptime) g.armor.uptime.add(now, 1);
      if (g.air.tick !== now) this.airTick(f);
    }
  }

  /** KO: clears per-stock budgets (mitigation), the chain and air budgets. */
  onKO(f) {
    const g = this.state(f);
    g.mit.stock = 0;
    g.chain.active = false; g.chain.n = 0; g.chain.dmg = 0; g.chain.lock = 0; g.chain.idle = 0;
    g.lockWin = new Rolling(G.lockUptime.window);
    g.armor.until = -1;
    g.intang.until = Math.min(g.intang.until, this.frame);
    this.airReset(f);
  }

  /** Respawn: fresh airtime. */
  onRespawn(f) { this.airReset(f); }

  /** Snapshot of remaining budgets (backs view.budget()). */
  budget(f) {
    const g = this.state(f);
    const E = G.entities;
    const live = this.liveEntities(f).filter((e) => !e.dead && e.alive !== false);
    const threat = live.reduce((s, e) => s + threatOf(e.def || e), 0);
    const statuses = Array.isArray(f.statuses) ? f.statuses.length : 0;
    const armorLeft = Math.max(0, G.armor.uptime - g.armor.uptime.sum(this.frame));
    return {
      entities: Math.max(0, E.maxAlive - live.length),
      threat: Math.max(0, E.maxThreat - threat),
      riseLeft: Math.max(0, G.air.rise - g.air.rise),
      stallLeft: Math.max(0, G.air.stall - g.air.stall),
      teleportsLeft: Math.max(0, G.air.teleports - g.air.teleports),
      intangibleLeft: this.intangibleLeft(f),
      armorLeft,
      mitigationLeft: this.mitigationLeft(f),
      statusSlotsLeft: Math.max(0, STATUS_CAPS.perTarget - statuses),
    };
  }

  flushGov(gov, amounts, a, t) {
    for (const r of new Set(gov)) this.gov(r, a?.id ?? null, t?.id ?? null, amounts[r] ?? 0);
  }
}

// v1 directional influence (identical float ops to v1 Game.applyHit).
function diDelta(t, angle, dir) {
  const inp = t.input || {};
  const ix = ((inp.right ? 1 : 0) - (inp.left ? 1 : 0));
  const iy = ((inp.up ? 1 : 0) - (inp.down ? 1 : 0));
  if (!ix && !iy) return 0;
  const rad = (angle * Math.PI) / 180;
  const lx = Math.cos(rad) * dir, ly = Math.sin(rad);
  const cross = lx * iy - ly * ix;
  const len = Math.hypot(ix, iy);
  return PHYSICS.diMaxDegrees * (cross / len) * (dir > 0 ? 1 : -1);
}

function actionWindow(f) {
  const act = f.action;
  const w = act?.def?.intangible;
  if (!w) return false;
  const t = act.frame | 0;
  const wins = Array.isArray(w[0]) ? w : [w];
  for (const x of wins) if (Array.isArray(x) && t >= x[0] && t <= x[1]) return true;
  return false;
}

function kindKey(def) {
  const k = def?.kind || 'projectile';
  if (k === 'zone') {
    const life = fin(def.life, 0);
    const rehit = Array.isArray(def.hitboxes) && def.hitboxes.some((h) => h && h.rehit);
    return life <= 30 && !rehit ? 'zone' : 'zoneLingering';
  }
  return k;
}

function threatOf(def) { return ENTITY_THREAT[kindKey(def)] ?? 1; }
const isTrapZone = (k) => k === 'trap' || k === 'zone' || k === 'zoneLingering';

function readRes(t, s) {
  if (typeof s.get === 'function') return s.get();
  if (t.res && s.idx !== undefined) return t.res[s.idx];
  return 0;
}
function writeRes(t, s, v) {
  if (typeof s.set === 'function') s.set(v);
  else if (t.res && s.idx !== undefined) t.res[s.idx] = v;
}
