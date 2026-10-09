// Per-target KO speed tables for the Governor's hit-time KO floor (spec §4.2.2).
// Vko[θ] = minimum launch speed (px/f) that reaches any blast zone from center
// stage at world angle θ (1° bins, 0 = +x, 90 = up), using the target's gravity,
// fallSpeed and collider height. Built once per unique (stage, gravity,
// fallSpeed, height) and cached; deterministic, so build order never matters.
import { simulateLaunch } from './combat.js';

const MAX_SPEED = 60;     // above the Governor's absolute cap (40)
const ITERS = 16;         // binary-search steps (≈ 1e-3 px/f precision)
const cache = new Map();

const keyOf = (stage, gravity, fallSpeed, height) => {
  const b = stage.blast;
  return `${stage.id || ''}|${b.left},${b.right},${b.top},${b.bottom}|${gravity}|${fallSpeed}|${height}`;
};

/** Rounds physics inputs to cache-friendly values (height rounded UP: a taller target dies sooner). */
export function koTableKey(gravity, fallSpeed, height = 0) {
  return {
    gravity: Math.round(gravity * 100) / 100,
    fallSpeed: Math.round(fallSpeed * 100) / 100,
    height: Math.ceil(Math.max(0, height) / 10) * 10,
  };
}

/**
 * @param {object} stage stage geometry (needs `blast`)
 * @param {number} gravity  target gravity (px/f²)
 * @param {number} fallSpeed target max fall speed
 * @param {number} [height=0] target collider height (top blast check uses feet − height)
 * @returns {Float64Array} length 360, frozen semantics (do not mutate); Infinity = unreachable
 */
export function buildKoTable(stage, gravity, fallSpeed, height = 0) {
  const k = keyOf(stage, gravity, fallSpeed, height);
  const hit = cache.get(k);
  if (hit) return hit;
  const opts = { stage, gravity, fallSpeed, height, origin: { x: 0, y: 0 } };
  const raw = new Float64Array(360);
  for (let a = 0; a < 360; a++) raw[a] = minSpeed(a, opts);
  // Symmetrize: a launch at relative angle θ can face either way (θ and 180 − θ in world space).
  const table = new Float64Array(360);
  for (let a = 0; a < 360; a++) table[a] = Math.min(raw[a], raw[(540 - a) % 360]);
  cache.set(k, table);
  return table;
}

/** Height band (px, ≤ 0) used for position-aware KO tables: launch origins snap UP to it. */
export const KO_BAND = 20;
export const koBandOf = (y) => Math.min(0, Math.floor((Number.isFinite(y) ? y : 0) / KO_BAND) * KO_BAND);

const lazyCache = new Map();

/**
 * Like buildKoTable, but launches start at height `originY` (snapped up to a KO_BAND band;
 * at or below the ground → the center-stage table). Entries are computed on first use, so a
 * hit costs ≤ 2 binary searches per sampled angle. Read it through koSpeedAt / worstKoSpeed.
 */
export function koTableAt(stage, gravity, fallSpeed, height = 0, originY = 0) {
  const band = koBandOf(originY);
  if (band === 0) return buildKoTable(stage, gravity, fallSpeed, height);
  const k = `${keyOf(stage, gravity, fallSpeed, height)}|y${band}`;
  let t = lazyCache.get(k);
  if (!t) {
    t = { lazy: true, raw: new Float64Array(360).fill(NaN), opts: { stage, gravity, fallSpeed, height, origin: { x: 0, y: band } } };
    lazyCache.set(k, t);
  }
  return t;
}

function lazyAt(t, a) {
  const raw = (i) => (Number.isNaN(t.raw[i]) ? (t.raw[i] = minSpeed(i, t.opts)) : t.raw[i]);
  return Math.min(raw(a), raw((540 - a) % 360));
}

function minSpeed(angle, opts) {
  if (!simulateLaunch(MAX_SPEED, angle, opts)) return Infinity;
  let lo = 0, hi = MAX_SPEED;
  for (let i = 0; i < ITERS; i++) {
    const mid = (lo + hi) / 2;
    if (simulateLaunch(mid, angle, opts)) hi = mid; else lo = mid;
  }
  return hi;
}

/** Table lookup with wrap-around (angle in degrees, any range). */
export function koSpeedAt(table, angle) {
  const i = ((Math.round(angle) % 360) + 360) % 360;
  return table.lazy ? lazyAt(table, i) : table[i];
}

/** Minimum Vko over angle ± window, sampled every `step` degrees (DI worst case). */
export function worstKoSpeed(table, angle, window = 12, step = 3) {
  let worst = Infinity;
  for (let d = -window; d <= window; d += step) worst = Math.min(worst, koSpeedAt(table, angle + d));
  return worst;
}

/** Test/tool helper: number of cached tables. */
export function koTableCacheSize() { return cache.size; }
