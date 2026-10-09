// ─────────────────────────────────────────────────────────────────────────────
// v2 entity limits per kind (spec §4.1.3, ENTITY_LIMITS / ENTITY_RULES in
// rules.js). Static clamps only; the Governor caps live counts, threat, spawn
// rate and damage rate at runtime (§4.2.8).
// ─────────────────────────────────────────────────────────────────────────────
import { ENTITY_LIMITS, ENTITY_RULES, ACTION_LIMITS } from '../rules.js';
import { clampHit, clampHookList } from './actions.js';
import { equalRadius, setEqualRadius, reachFrom, pulled, assignGeometry, r2 } from './area.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** ENTITY_LIMITS key for an entity (zones split into burst / lingering). */
export function kindKey(e) {
  if (e.kind !== 'zone') return e.kind;
  return e.life <= 30 && !e.hitboxes.some((h) => h.rehit) ? 'zone' : 'zoneLingering';
}

/** Limits row for an entity. */
export const limitsOf = (e) => ENTITY_LIMITS[kindKey(e)] || ENTITY_LIMITS.projectile;

function setNum(obj, key, c, path, notes, code, why, rule) {
  if (obj[key] === c) return;
  notes.add(code, `${path}.${key}`, why, { from: obj[key], to: c, rule });
  obj[key] = c;
}

/** Clamp one entity definition in place. env: {draft, builtins, cache, notes}. */
export function clampEntity(e, name, env) {
  const { notes } = env;
  const P = `entities.${name}`;
  const kind = kindKey(e);
  const L = limitsOf(e);
  const rule = `ENTITY_LIMITS.${kind}`;

  // relay / part lifetime
  if (e.kind === 'part') {
    const r = clamp(Number.isFinite(e.relay) ? e.relay : 1, ...L.relay);
    setNum(e, 'relay', r, P, notes, 'W411', `relay ${e.relay} → ${r} (parts pass ${L.relay[0]}–${L.relay[1]} of their damage to the owner).`, `${rule}.relay`);
  } else if (e.relay !== 1) setNum(e, 'relay', 1, P, notes, 'W411', 'relay only applies to parts; set to 1.', `${rule}.relay`);
  const maxLife = e.kind === 'part' ? (e.relay >= 1 ? Infinity : L.partLife) : L.maxLife;
  const life = Math.max(1, Math.min(maxLife, e.life));
  setNum(e, 'life', life, P, notes, 'W402', `${e.kind} life ${e.life} → ${life} frames (max ${maxLife}).`, `${rule}.maxLife`);

  // hp
  const hp = clamp(Number.isFinite(e.hp) ? e.hp : 0, 0, L.maxHp || 0);
  setNum(e, 'hp', hp, P, notes, 'W404', `${kind} hp ${e.hp} → ${hp} (max ${L.maxHp || 0}).`, `${rule}.maxHp`);

  // counts
  if (e.maxAlive !== null) {
    const m = clamp(e.maxAlive, 1, ENTITY_RULES.maxAlive);
    setNum(e, 'maxAlive', m, P, notes, 'W410', `maxAlive ${e.maxAlive} → ${m}.`, 'ENTITY_RULES.maxAlive');
  }
  if (e.maxHits < 1) setNum(e, 'maxHits', 1, P, notes, 'W401', 'maxHits must be ≥ 1.', 'EntityDef.maxHits');
  if (e.pierce < 0) setNum(e, 'pierce', 0, P, notes, 'W401', 'pierce must be ≥ 0.', 'EntityDef.pierce');

  // motion
  const m = e.motion;
  if (L.maxSpeed !== null) {
    for (const k of ['speed', 'maxSpeed']) if (typeof m[k] === 'number' && Math.abs(m[k]) > L.maxSpeed) setNum(m, k, Math.sign(m[k]) * L.maxSpeed, `${P}.motion`, notes, 'W403', `${k} ${m[k]} → ${L.maxSpeed} (${kind} max speed).`, `${rule}.maxSpeed`);
  }
  if (typeof m.turn === 'number' && m.turn > ENTITY_RULES.maxTurn) setNum(m, 'turn', ENTITY_RULES.maxTurn, `${P}.motion`, notes, 'W407', `homing turn ${m.turn} → ${ENTITY_RULES.maxTurn} rad/frame.`, 'ENTITY_RULES.maxTurn');
  if (typeof m.gravity === 'number' && Math.abs(m.gravity) > 1.5) setNum(m, 'gravity', Math.sign(m.gravity) * 1.5, `${P}.motion`, notes, 'W403', `gravity ${m.gravity} → ±1.5.`, 'EntityDef.motion.gravity');
  if (typeof m.delay === 'number' && m.delay < 0) setNum(m, 'delay', 0, `${P}.motion`, notes, 'W403', 'delay must be ≥ 0.', 'EntityDef.motion.delay');

  // size: projectile radius, beam length/width
  if (L.maxRadius) {
    if (equalRadius(e.shape) > L.maxRadius) { notes.add('W413', `${P}.shape`, `shape is bigger than a ${kind} may be (radius ${L.maxRadius}); shrunk.`, { rule: `${rule}.maxRadius` }); setEqualRadius(e.shape, L.maxRadius); }
    e.hitboxes.forEach((h, i) => {
      if (equalRadius(h) > L.maxRadius) { notes.add('W413', `${P}.hitboxes[${i}]`, `hitbox radius ${r2(equalRadius(h))} → ${L.maxRadius}.`, { from: r2(equalRadius(h)), to: L.maxRadius, rule: `${rule}.maxRadius` }); setEqualRadius(h, L.maxRadius); }
    });
  }
  if (kind === 'beam') {
    if (e.length !== null && e.length > L.maxLength) setNum(e, 'length', L.maxLength, P, notes, 'W406', `beam length ${e.length} → ${L.maxLength}.`, `${rule}.maxLength`);
    if (e.width !== null && e.width > L.maxWidth) setNum(e, 'width', L.maxWidth, P, notes, 'W406', `beam width ${e.width} → ${L.maxWidth}.`, `${rule}.maxWidth`);
    e.hitboxes.forEach((h, i) => {
      const HP = `${P}.hitboxes[${i}]`;
      if (h.shape !== 'rect' && h.r > L.maxWidth) setNum(h, 'r', L.maxWidth, HP, notes, 'W406', `beam thickness ${h.r} → ${L.maxWidth}.`, `${rule}.maxWidth`);
      const reach = reachFrom(h, 0, 0);
      const lim = L.maxLength + L.maxWidth;
      if (reach > lim) {
        let lo = 0, hi = 1;
        for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (reachFrom(pulled(h, mid, 0, 0), 0, 0) <= lim) lo = mid; else hi = mid; }
        assignGeometry(h, pulled(h, lo, 0, 0));
        notes.add('W406', HP, `beam hitbox reached ${Math.round(reach)} px from its anchor; shortened to ${L.maxLength} px.`, { from: Math.round(reach), to: lim, rule: `${rule}.maxLength` });
      }
    });
  }
  if (e.kind === 'clone') {
    const s = clamp(e.scale, ...ENTITY_RULES.cloneScale);
    setNum(e, 'scale', s, P, notes, 'W411', `clone scale ${e.scale} → ${s}.`, 'ENTITY_RULES.cloneScale');
  }

  // every
  if (e.every && e.every.frames < ENTITY_RULES.minEvery) setNum(e.every, 'frames', ENTITY_RULES.minEvery, `${P}.every`, notes, 'W408', `every.frames ${e.every.frames} → ${ENTITY_RULES.minEvery} (spawn at most every half second).`, 'ENTITY_RULES.minEvery');
  if (e.every) clampOffset(e.every, `${P}.every`, notes, 0, 0);

  // hitboxes
  const floor = L.koFloor;
  e.hitboxes.forEach((h, i) => {
    const HP = `${P}.hitboxes[${i}]`;
    if (h.start < 0) setNum(h, 'start', 0, HP, notes, 'W401', 'start must be ≥ 0.', 'EntityDef.hitboxes');
    if (h.end < h.start) setNum(h, 'end', h.start, HP, notes, 'W401', 'end must be ≥ start.', 'EntityDef.hitboxes');
    if (h.rehit !== null) {
      const min = Math.max(ACTION_LIMITS.minRehit, L.minRehit || 0);
      if (h.rehit < min) setNum(h, 'rehit', min, HP, notes, 'W405', `rehit ${h.rehit} → ${min} frames (${kind} minimum).`, `${rule}.minRehit`);
    }
    clampHit(h, { maxHit: L.maxHit, koFloor: floor, canCharge: false, rule, kind, entity: true }, HP, env);
    if (h.kind === 'grab') notes.add('W416', HP, 'grab boxes only work on moves; on an entity this box never connects.', { rule: 'EntityDef.hitboxes.kind', fix: 'use a strike (angle toward the owner pulls the target in), or a grab move that spawns the visual.' });
    dropListActions(h.onHit, `${HP}.onHit`, notes);
    clampHookList(h.onHit, `${HP}.onHit`, env, 'special');
  });
  for (const k of ['onSpawn', 'onHit', 'onExpire', 'onDeath']) {
    dropListActions(e[k], `${P}.${k}`, notes);
    clampHookList(e[k], `${P}.${k}`, env, 'special');
  }
}

/** Entity lists run only ENTITY_RULES.listActions; anything else is removed with W415. */
function dropListActions(list, path, notes) {
  if (!Array.isArray(list)) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i] && list[i].action;
    if (ENTITY_RULES.listActions.includes(a)) continue;
    notes.add('W415', `${path}[${i}]`, `'${a}' does nothing in an entity list (only ${ENTITY_RULES.listActions.join(', ')}); removed.`, { rule: 'ENTITY_RULES.listActions' });
    list.splice(i, 1);
  }
}

/** Spawn/every offsets ≤ ENTITY_RULES.maxSpawnOffset from (ox, oy). */
export function clampOffset(o, path, notes, ox, oy) {
  const d = Math.hypot(o.x - ox, o.y - oy);
  if (d <= ENTITY_RULES.maxSpawnOffset) return;
  const k = ENTITY_RULES.maxSpawnOffset / d;
  const x = r2(ox + (o.x - ox) * k), y = r2(oy + (o.y - oy) * k);
  notes.add('W409', path, `spawn point ${Math.round(d)} px from the body; pulled in to ${ENTITY_RULES.maxSpawnOffset} px.`, { from: Math.round(d), to: ENTITY_RULES.maxSpawnOffset, rule: 'ENTITY_RULES.maxSpawnOffset' });
  o.x = x; o.y = y;
}

/** Clamp every entity (sorted order). */
export function clampEntities(env) {
  const { draft, notes } = env;
  const names = Object.keys(draft.entities).sort();
  if (names.length > ENTITY_RULES.maxDefs) {
    notes.add('W414', 'entities', `${names.length} entity definitions (max ${ENTITY_RULES.maxDefs}); all are kept, but the Governor caps what can be alive.`, { from: names.length, to: ENTITY_RULES.maxDefs, rule: 'ENTITY_RULES.maxDefs' });
  }
  for (const n of names) clampEntity(draft.entities[n], n, env);
}
