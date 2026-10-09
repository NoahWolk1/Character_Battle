// Deterministic randomness for the simulation. Sim code must never call
// Math.random — use a stream from here (game.rng, view.rng) so every server,
// client and replay produces identical matches from the same seed.

/** 32-bit string hash (FNV-1a with a final avalanche mix). Returns an unsigned int. */
export function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * mulberry32 PRNG. Returns `next()` → float in [0, 1).
 * `next.state()` / `next.setState(s)` expose the 32-bit state for save/restore.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => a >>> 0;
  next.setState = (s) => { a = s >>> 0; };
  return next;
}

/** Default match seed: hash of the player ids (in slot order) and the stage id. */
export function defaultSeed(players, stageId) {
  return hash32(`${(players || []).map((p) => p.id).join('|')}@${stageId || ''}`);
}

/** rules.seed → uint32: numbers are used as-is, strings hashed, otherwise defaultSeed. */
export function resolveSeed(seed, players, stageId) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  if (typeof seed === 'string') return hash32(seed);
  return defaultSeed(players, stageId);
}
