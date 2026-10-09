// ─────────────────────────────────────────────────────────────────────────────
// v2 action limits (spec §4.1.2), per pool entry by category:
//   startup shift (every frame-indexed field moves together), per-hit cap,
//   knockback limits, KO floor (fixed estimator, full charge, spike cap),
//   equal-area radius cap, reach from the hurtbox union (+ absolute cap from the
//   collider center), rehit ≥ 3, maxTotal (rehits, timeline hits, releases and
//   0.5 × spawned entity damage), maxDps / minDuration / 150-frame cap,
//   self-velocity and travel/rise budget, intangibility ≤ 12, armor ≤ 12,
//   landing lag, hold/charge/counter ranges. Also hit templates (strictest user).
// Mutates the normalized draft in place; every change is a coded W-note.
// ─────────────────────────────────────────────────────────────────────────────
import {
  CATEGORIES, KNOCKBACK_LIMITS, MOVEMENT_LIMITS, REACH_BEYOND, REACH_ABS_MUL, ACTION_LIMITS, ENTITY_LIMITS, ENTITY_RULES,
} from '../rules.js';
import { capKo, rowOf, tally, execs, entityDamage } from './score.js';
import { clampHitStatus } from './statuses.js';
import { clampShapes } from './body.js';
import { equalRadius, setEqualRadius, reachBeyond, reachFrom, pulled, assignGeometry, r2 } from './area.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HIT_SYNC = ['damage', 'angle', 'knockback', 'growth', 'setKnockback', 'shieldMul', 'hitlagMul', 'push'];

/** Limits for a hit `tier` override (move category or entity tier), or null. */
function tierLimits(tier) {
  if (!tier) return null;
  if (CATEGORIES[tier]) return { maxHit: CATEGORIES[tier].maxHit, koFloor: CATEGORIES[tier].koFloor };
  if (ENTITY_LIMITS[tier]) return { maxHit: ENTITY_LIMITS[tier].maxHit, koFloor: ENTITY_LIMITS[tier].koFloor };
  return null;
}

/**
 * Clamp one hit's numbers in place (merged hitbox, template, release hit, entity hitbox).
 * ctx: {maxHit, koFloor, canCharge, rule, setKnockback?, entity?, code?, maxTotal?}
 */
export function clampHit(h, ctx, path, env) {
  const { notes } = env;
  let maxHit = ctx.maxHit;
  let floor = ctx.koFloor;
  const t = tierLimits(h.tier);
  if (t) { maxHit = Math.min(maxHit, t.maxHit); floor = Math.max(floor, t.koFloor); }
  const dmgCode = ctx.code || (ctx.entity ? 'W401' : 'W210');
  const kbCode = ctx.code || (ctx.entity ? 'W401' : 'W212');
  const koCode = ctx.code || (ctx.entity ? 'W412' : 'W213');
  if (!(h.damage >= 0 && h.damage <= maxHit)) {
    const c = clamp(Number.isFinite(h.damage) ? h.damage : 0, 0, maxHit);
    notes.add(dmgCode, `${path}.damage`, `one hit may not deal more than ${maxHit}% here (${h.damage} → ${c}).`, {
      from: h.damage, to: c, rule: `${ctx.rule}.maxHit`,
      fix: ctx.maxTotal ? `keep it feeling huge with growth, or split it into a multi-hit group (maxTotal ${ctx.maxTotal}).` : 'lower the damage or spread it over more hits.',
    });
    h.damage = c;
  }
  const lim = (k, lo, hi, rule) => {
    const v = h[k];
    if (v === null || v === undefined) return;
    if (!(v >= lo && v <= hi)) {
      const c = clamp(Number.isFinite(v) ? v : lo, lo, hi);
      notes.add(kbCode === 'W212' && ['shieldMul', 'hitlagMul', 'push'].includes(k) ? 'W217' : kbCode, `${path}.${k}`, `${k} ${v} is outside ${lo}–${hi}; set to ${c}.`, { from: v, to: c, rule });
      h[k] = c;
    }
  };
  lim('knockback', 0, KNOCKBACK_LIMITS.maxBase, 'KNOCKBACK_LIMITS.maxBase');
  lim('growth', KNOCKBACK_LIMITS.minGrowth, KNOCKBACK_LIMITS.maxGrowth, 'KNOCKBACK_LIMITS.maxGrowth');
  lim('setKnockback', ...ACTION_LIMITS.setKnockback, 'ACTION_LIMITS.setKnockback');
  if (ctx.setKnockback !== undefined && h.setKnockback !== ctx.setKnockback) {
    notes.add(kbCode, `${path}.setKnockback`, `${ctx.rule} hits use a fixed knockback of ${ctx.setKnockback}.`, { from: h.setKnockback, to: ctx.setKnockback, rule: `${ctx.rule}.setKnockback` });
    h.setKnockback = ctx.setKnockback;
  }
  lim('shieldMul', ...ACTION_LIMITS.hitMul, 'ACTION_LIMITS.hitMul');
  lim('hitlagMul', ...ACTION_LIMITS.hitMul, 'ACTION_LIMITS.hitMul');
  lim('push', ...ACTION_LIMITS.push, 'ACTION_LIMITS.push');
  if (h.status) clampHitStatus(h.status, `${path}.status`, notes, env.draft, env.builtins);
  if (h.kind === 'strike' || h.kind === 'wind') {
    const r = capKo(h, floor, { canCharge: ctx.canCharge, cache: env.cache });
    if (r) {
      const msg = Number.isFinite(floor)
        ? `would KO at ~${r.before}%${ctx.canCharge ? ' at full charge' : ''}; knockback ×${r.k.toFixed(2)} so it KOs at ~${Number.isFinite(r.after) ? r.after : '—'}% (floor ${floor}%).`
        : `may never KO (${ctx.rule}); knockback ×${r.k.toFixed(2)}.`;
      notes.add(koCode, path, msg, { from: r.before, to: r.after, rule: `${ctx.rule}.koFloor`, fix: 'use a lower knockback with more growth, or a less direct angle; spikes are capped near the floor at runtime.' });
    }
  }
}

// ── frame shifting ──────────────────────────────────────────────────────────
function shiftAction(a, s) {
  for (const h of a.hitboxes) { h.start += s; h.end += s; }
  for (const e of a.timeline) {
    if (e.when === 'at') e.at += s;
    else if (e.when === 'range') { e.from += s; e.to += s; }
  }
  for (const v of a.velocity) { v.start += s; v.end += s; }
  a.intangible = a.intangible.map(([x, y]) => [x + s, y + s]);
  for (const list of [a.armor, a.hurtboxes, a.gravity, a.cancels]) for (const w of list) { w.from += s; w.to += s; }
  if (a.hold) { a.hold.from += s; a.hold.to += s; if (typeof a.hold.release === 'number') a.hold.release += s; }
  if (a.charge && !a.charge.auto && typeof a.charge.at === 'number') a.charge.at += s;
  if (a.counter) { a.counter.from += s; a.counter.to += s; }
  a.duration += s;
}

/** First active frame from hitboxes and spawn/hit/release entries, or null. */
function firstActive(a) {
  let s = Infinity;
  for (const h of a.hitboxes) s = Math.min(s, h.start);
  for (const e of a.timeline) {
    if (e.action !== 'spawn' && e.action !== 'hit' && e.action !== 'release') continue;
    if (e.when === 'at') s = Math.min(s, e.at);
    else if (e.when === 'range') s = Math.min(s, e.from);
  }
  return Number.isFinite(s) ? s : null;
}

/** Last frame anything happens (hitboxes, timeline, velocity). */
function lastActive(a) {
  let m = 0;
  for (const h of a.hitboxes) m = Math.max(m, h.end);
  for (const e of a.timeline) m = Math.max(m, e.when === 'at' ? e.at : e.when === 'range' ? e.to : 0);
  for (const v of a.velocity) m = Math.max(m, v.end);
  return m;
}

// ── reach ───────────────────────────────────────────────────────────────────
/** Pull a shape toward the collider center until it fits the reach limits of every routing form. Returns measured reach. */
function clampReach(shape, cat, forms, path, env) {
  const lim = REACH_BEYOND[cat] ?? REACH_BEYOND.special;
  const absLim = REACH_ABS_MUL * rowOf(cat).maxReach;
  const measure = (s) => Math.max(...forms.map((f) => reachBeyond(s, env.bodies[f].hurt)));
  const ok = (s) => forms.every((f) => reachBeyond(s, env.bodies[f].hurt) <= lim + 1e-9 && reachFrom(s, 0, env.bodies[f].cy) <= absLim + 1e-9);
  if (ok(shape)) return measure(shape);
  const before = measure(shape);
  // Pull toward the collider center; if even the center is too far (odd bodies whose center is
  // outside the hurtboxes), pull toward the nearest default hurtbox shape instead.
  const search = (ox, oy) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (ok(pulled(shape, mid, ox, oy))) lo = mid; else hi = mid; }
    return pulled(shape, lo, ox, oy);
  };
  let best = search(0, env.bodies[forms[0]].cy);
  if (!ok(best)) {
    const [hx, hy] = centerOf(shape);
    const near = env.bodies[forms[0]].hurt.map((s) => centerOf(s)).sort((p, q) => Math.hypot(p[0] - hx, p[1] - hy) - Math.hypot(q[0] - hx, q[1] - hy))[0];
    if (near) best = search(near[0], near[1]);
  }
  assignGeometry(shape, best);
  const after = measure(shape);
  env.notes.add('W215', path, `reached ${Math.round(before)} px beyond the body; pulled in to the ${cat} limit of ${lim} px (now ${Math.round(after)}).`,
    { from: Math.round(before), to: Math.round(after), rule: `REACH_BEYOND.${cat}`, fix: 'move the hitbox closer, or give the body a bigger hurtbox there (a long arm is also a target).' });
  return after;
}

const centerOf = (s) => (s.shape === 'capsule' ? [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2] : [s.x, s.y]);

function clampRadius(h, row, path, env) {
  const r = equalRadius(h);
  if (r > row.maxRadius || r < ACTION_LIMITS.minRadius) {
    const c = clamp(r, ACTION_LIMITS.minRadius, row.maxRadius);
    env.notes.add('W214', `${path}${h.shape === 'rect' ? '' : '.r'}`, `${h.shape === 'rect' ? 'equal-area radius' : 'radius'} ${r2(r)} → ${r2(c)} (allowed ${ACTION_LIMITS.minRadius}–${row.maxRadius}).`, { from: r2(r), to: r2(c), rule: 'CATEGORIES.maxRadius' });
    setEqualRadius(h, c);
  }
}

// ── self movement ───────────────────────────────────────────────────────────
function clampVel(o, path, env, kx = 'vx', ky = 'vy') {
  for (const [k, max] of [[kx, MOVEMENT_LIMITS.maxVx], [ky, MOVEMENT_LIMITS.maxVy]]) {
    if (typeof o[k] === 'number' && Math.abs(o[k]) > max) {
      const c = Math.sign(o[k]) * max;
      env.notes.add('W301', `${path}.${k}`, `${k} ${o[k]} → ${c} (self speed limit ${max} px/frame).`, { from: o[k], to: c, rule: `MOVEMENT_LIMITS.max${k === kx ? 'Vx' : 'Vy'}` });
      o[k] = c;
    }
  }
}

/** Rise/travel estimate at scale s (v2: coast uses the form gravity). */
function travelOf(a, s, g) {
  let rise = 0, side = 0, coast = 0;
  const up = (vy, frames) => { if (vy < 0) { rise += -vy * s * frames; coast = (vy * s) ** 2 / (2 * g); } };
  for (const v of a.velocity) {
    const frames = Math.max(0, v.end - v.start + 1);
    if (v.vy !== null) up(v.vy, frames);
    if (v.vx !== null) side += Math.abs(v.vx * s) * frames;
  }
  for (const e of a.timeline) {
    const n = e.when === 'range' ? Math.max(0, e.to - e.from + 1) : 1;
    const x = e.when === 'range' ? execs(e) : 1;
    if (e.action === 'velocity') {
      if (e.args.vy !== null && e.args.vy < 0) { if (e.when === 'range') rise += -e.args.vy * s * n; coast = Math.max(coast, (e.args.vy * s) ** 2 / (2 * g)); }
      if (e.args.vx !== null) side += Math.abs(e.args.vx * s) * n;
    } else if (e.action === 'impulse') {
      if (e.args.vy < 0) rise += ((e.args.vy * s) ** 2 / (2 * g)) * x;
      side += Math.abs(e.args.vx * s) * x * 10; // one-off push: ~10 frames of drift
    } else if (e.action === 'steer') {
      rise += e.args.speed * s * n;
      side += e.args.speed * s * n;
    } else if (e.action === 'teleport') {
      rise += Math.max(0, -e.args.dy * s) * x;
      side += Math.abs(e.args.dx * s) * x;
    }
  }
  return { rise: rise + coast, side };
}

function scaleTravel(a, k) {
  for (const v of a.velocity) { if (v.vx !== null) v.vx = r2(v.vx * k); if (v.vy !== null && v.vy < 0) v.vy = r2(v.vy * k); }
  for (const e of a.timeline) {
    if (e.action === 'velocity' || e.action === 'impulse') { if (e.args.vx !== null) e.args.vx = r2(e.args.vx * k); if (e.args.vy !== null && e.args.vy < 0) e.args.vy = r2(e.args.vy * k); }
    else if (e.action === 'steer') e.args.speed = r2(e.args.speed * k);
    else if (e.action === 'teleport') { e.args.dx = r2(e.args.dx * k); e.args.dy = r2(e.args.dy * k); }
  }
}

/**
 * Clamp one TimelineAction (timeline entry or hook list item). ctx: {key, cat, forms, cy, top}.
 * Returns the reach (px) of `hit` shapes, else 0.
 */
function clampEntry(e, P, env, ctx) {
  const { notes, draft } = env;
  const g = e.args;
  switch (e.action) {
    case 'spawn': {
      if (g.count < 1 || g.count > ENTITY_RULES.maxCount) {
        const c = clamp(g.count, 1, ENTITY_RULES.maxCount);
        notes.add('W409', `${P}.count`, `spawn count ${g.count} → ${c}.`, { from: g.count, to: c, rule: 'ENTITY_RULES.maxCount' });
        g.count = c;
      }
      if (ctx.cy !== null) {
        const d = Math.hypot(g.x, g.y - ctx.cy);
        if (d > ENTITY_RULES.maxSpawnOffset) {
          const k = ENTITY_RULES.maxSpawnOffset / d;
          notes.add('W409', P, `spawn point ${Math.round(d)} px from the body center; pulled in to ${ENTITY_RULES.maxSpawnOffset} px.`, { from: Math.round(d), to: ENTITY_RULES.maxSpawnOffset, rule: 'ENTITY_RULES.maxSpawnOffset' });
          g.x = r2(g.x * k); g.y = r2(ctx.cy + (g.y - ctx.cy) * k);
        }
      }
      const ent = draft.entities[g.entity];
      const max = ent ? ENTITY_LIMITS[ent.kind === 'zone' ? 'zone' : ent.kind]?.maxSpeed : null;
      const sp = Math.hypot(g.vx || 0, g.vy || 0);
      if (max && sp > max) {
        const k = max / sp;
        notes.add('W403', P, `spawn speed ${r2(sp)} → ${max} (${ent.kind} max speed).`, { from: r2(sp), to: max, rule: `ENTITY_LIMITS.${ent.kind}.maxSpeed` });
        if (g.vx !== null) g.vx = r2(g.vx * k);
        if (g.vy !== null) g.vy = r2(g.vy * k);
      }
      return 0;
    }
    case 'velocity': case 'impulse': clampVel(g, P, env); return 0;
    case 'steer': {
      const [s0, s1] = ACTION_LIMITS.steer.speed, [t0, t1] = ACTION_LIMITS.steer.turn;
      if (g.speed < s0 || g.speed > s1) { notes.add('W304', `${P}.speed`, `steer speed ${g.speed} → ${clamp(g.speed, s0, s1)}.`, { from: g.speed, to: clamp(g.speed, s0, s1), rule: 'ACTION_LIMITS.steer' }); g.speed = clamp(g.speed, s0, s1); }
      if (g.turn < t0 || g.turn > t1) { notes.add('W304', `${P}.turn`, `steer turn ${g.turn} → ${clamp(g.turn, t0, t1)}.`, { from: g.turn, to: clamp(g.turn, t0, t1), rule: 'ACTION_LIMITS.steer' }); g.turn = clamp(g.turn, t0, t1); }
      return 0;
    }
    case 'teleport': {
      const d = Math.hypot(g.dx, g.dy);
      if (d > ACTION_LIMITS.teleport) {
        const k = ACTION_LIMITS.teleport / d;
        notes.add('W303', P, `teleport of ${Math.round(d)} px → ${ACTION_LIMITS.teleport} px.`, { from: Math.round(d), to: ACTION_LIMITS.teleport, rule: 'ACTION_LIMITS.teleport' });
        g.dx = r2(g.dx * k); g.dy = r2(g.dy * k);
      }
      return 0;
    }
    case 'hit': {
      if (g.frames < 1 || g.frames > ACTION_LIMITS.maxActive) {
        const c = clamp(g.frames, 1, ACTION_LIMITS.maxActive);
        notes.add('W203', `${P}.frames`, `hit frames ${g.frames} → ${c}.`, { from: g.frames, to: c, rule: 'ACTION_LIMITS.maxActive' });
        g.frames = c;
      }
      if (!ctx.top) return 0;
      clampRadius(g.shape, rowOf(ctx.cat), `${P}.shape`, env);
      return clampReach(g.shape, ctx.cat, ctx.forms, `${P}.shape`, env);
    }
    case 'release': {
      const row = rowOf(ctx.cat);
      clampHit(g.hit, { maxHit: row.maxHit, koFloor: row.koFloor, canCharge: false, rule: `CATEGORIES.${ctx.cat}`, setKnockback: row.setKnockback, maxTotal: row.maxTotal }, `${P}.release`, env);
      return 0;
    }
    case 'armor': {
      if (g.threshold > ACTION_LIMITS.armorMax || g.threshold < 0) { const c = clamp(g.threshold, 0, ACTION_LIMITS.armorMax); notes.add('W221', `${P}.threshold`, `armor threshold ${g.threshold} → ${c}.`, { from: g.threshold, to: c, rule: 'ACTION_LIMITS.armorMax' }); g.threshold = c; }
      if (g.frames > 60 || g.frames < 0) { const c = clamp(g.frames, 0, 60); notes.add('W221', `${P}.frames`, `armor frames ${g.frames} → ${c} (uptime ≤ 60 per 300 frames).`, { from: g.frames, to: c, rule: 'GOVERNOR.armor.uptime' }); g.frames = c; }
      return 0;
    }
    case 'intangible': {
      if (g.frames > ACTION_LIMITS.intangibleGrant || g.frames < 0) { const c = clamp(g.frames, 0, ACTION_LIMITS.intangibleGrant); notes.add('W220', `${P}.frames`, `intangible grant ${g.frames} → ${c} frames.`, { from: g.frames, to: c, rule: 'ACTION_LIMITS.intangibleGrant' }); g.frames = c; }
      return 0;
    }
    case 'camera': {
      const [lo, hi] = ACTION_LIMITS.cameraShake;
      if (g.shake < lo || g.shake > hi) { notes.add('W223', `${P}.shake`, `camera shake ${g.shake} → ${clamp(g.shake, lo, hi)}.`, { from: g.shake, to: clamp(g.shake, lo, hi), rule: 'ACTION_LIMITS.cameraShake' }); g.shake = clamp(g.shake, lo, hi); }
      return 0;
    }
    default: return 0;
  }
}

/** Clamp TimelineAction lists (hitbox onHit, onAbsorb, entity hooks): no timing, no reach. */
export function clampHookList(list, P, env, cat) {
  list.forEach((e, i) => clampEntry(e, `${P}[${i}]`, env, { cat, forms: ['base'], cy: null, top: false }));
}

/** Forms whose slots route to move `key` (statically), base if none. */
function routingForms(draft, key) {
  const out = draft.formOrder.filter((f) => Object.values(draft.forms[f].slots).includes(key));
  return out.length ? out : ['base'];
}

/**
 * Clamp one action in place. env: {draft, notes, builtins, cache, bodies: {form: {hurt, cy, collider}}, reach: {}}.
 */
export function clampAction(a, key, env) {
  const { draft, notes } = env;
  const cat = a.category;
  const row = rowOf(cat);
  const P = `moves.${key}`;
  const forms = routingForms(draft, key);
  const body = env.bodies[forms[0]];
  const upSpecial = draft.formOrder.some((f) => draft.forms[f].slots.upSpecial === key);

  if (a.name.length > 24) { notes.add('W101', `${P}.name`, 'move names are at most 24 characters; shortened.', { from: a.name, to: a.name.slice(0, 24), rule: 'Action.name' }); a.name = a.name.slice(0, 24); }

  // 1. Startup: everything frame-indexed moves together.
  const s0 = firstActive(a);
  if (s0 !== null && s0 < row.minStartup) {
    const shift = row.minStartup - s0;
    shiftAction(a, shift);
    notes.add('W202', P, `came out on frame ${s0}; ${cat} moves start on frame ${row.minStartup}+, so the whole move was delayed ${shift} frame(s).`,
      { from: s0, to: row.minStartup, rule: `CATEGORIES.${cat}.minStartup`, fix: 'add anticipation frames on purpose (animation reads better too).' });
  }

  // 2. Hitboxes.
  let reach = 0;
  a.hitboxes.forEach((h, i) => {
    const HP = `${P}.hitboxes[${i}]`;
    if (h.end < h.start) h.end = h.start;
    if (h.end - h.start > ACTION_LIMITS.maxActive) {
      notes.add('W203', HP, `active window capped at ${ACTION_LIMITS.maxActive} frames.`, { from: h.end - h.start, to: ACTION_LIMITS.maxActive, rule: 'ACTION_LIMITS.maxActive' });
      h.end = h.start + ACTION_LIMITS.maxActive;
    }
    if (h.rehit !== null && h.rehit < ACTION_LIMITS.minRehit) {
      notes.add('W216', `${HP}.rehit`, `rehit ${h.rehit} → ${ACTION_LIMITS.minRehit} frames.`, { from: h.rehit, to: ACTION_LIMITS.minRehit, rule: 'ACTION_LIMITS.minRehit' });
      h.rehit = ACTION_LIMITS.minRehit;
    }
    clampRadius(h, row, HP, env);
    reach = Math.max(reach, clampReach(h, cat, forms, HP, env));
    clampHit(h, { maxHit: row.maxHit, koFloor: row.koFloor, canCharge: !!a.charge, rule: `CATEGORIES.${cat}`, setKnockback: row.setKnockback, maxTotal: row.maxTotal }, HP, env);
    clampHookList(h.onHit, `${HP}.onHit`, env, cat);
  });

  // 3. Timeline.
  a.timeline.forEach((e, i) => { reach = Math.max(reach, clampEntry(e, `${P}.timeline[${i}]`, env, { cat, forms, cy: body.cy, top: true })); });
  clampHookList(a.onAbsorb, `${P}.onAbsorb`, env, cat);

  // 4. Self movement: per-window speed, then the travel / rise budget.
  a.velocity.forEach((v, i) => clampVel(v, `${P}.velocity[${i}]`, env));
  const g = Math.min(...forms.map((f) => draft.forms[f].stats.gravity));
  const maxRise = upSpecial ? MOVEMENT_LIMITS.maxRise : ACTION_LIMITS.maxRiseOther;
  const mv = travelOf(a, 1, g);
  if (mv.rise > maxRise || mv.side > MOVEMENT_LIMITS.maxTravel) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 25; i++) { const m = (lo + hi) / 2; const t = travelOf(a, m, g); if (t.rise > maxRise || t.side > MOVEMENT_LIMITS.maxTravel) hi = m; else lo = m; }
    scaleTravel(a, lo);
    notes.add('W302', P, `moved you ~${Math.round(mv.rise)} px up / ${Math.round(mv.side)} px sideways; scaled to fit (max ${maxRise} up, ${MOVEMENT_LIMITS.maxTravel} sideways).`,
      { from: [Math.round(mv.rise), Math.round(mv.side)], to: [maxRise, MOVEMENT_LIMITS.maxTravel], rule: upSpecial ? 'MOVEMENT_LIMITS.maxRise' : 'ACTION_LIMITS.maxRiseOther' });
  }

  // 5. Intangibility ≤ 12 frames per action (windows + timeline grants), trimmed from the end.
  const timelineIntang = a.timeline.filter((e) => e.action === 'intangible').reduce((s, e) => s + e.args.frames * execs(e), 0);
  let windowFrames = a.intangible.reduce((s, [x, y]) => s + Math.max(0, y - x + 1), 0);
  if (windowFrames + timelineIntang > ACTION_LIMITS.intangibleMax) {
    const before = windowFrames + timelineIntang;
    let budget = Math.max(0, ACTION_LIMITS.intangibleMax - timelineIntang);
    a.intangible = a.intangible.map(([x, y]) => { const n = Math.min(Math.max(0, y - x + 1), budget); budget -= n; return [Math.max(0, x), Math.max(0, x) + n - 1]; }).filter(([x, y]) => y >= x);
    windowFrames = a.intangible.reduce((s, [x, y]) => s + (y - x + 1), 0);
    let left = Math.max(0, ACTION_LIMITS.intangibleMax - windowFrames);
    for (const e of a.timeline) if (e.action === 'intangible') { const n = Math.min(e.args.frames, Math.floor(left / execs(e))); left -= n * execs(e); e.args.frames = n; }
    notes.add('W220', `${P}.intangible`, `${before} intangible frames; capped at ${ACTION_LIMITS.intangibleMax} per action.`, { from: before, to: ACTION_LIMITS.intangibleMax, rule: 'ACTION_LIMITS.intangibleMax' });
  }

  // 6. Windows and params.
  a.armor.forEach((w, i) => {
    if (!(w.threshold >= 0 && w.threshold <= ACTION_LIMITS.armorMax)) { const c = clamp(w.threshold || 0, 0, ACTION_LIMITS.armorMax); notes.add('W221', `${P}.armor[${i}].threshold`, `armor threshold ${w.threshold} → ${c} (flinch-only, max ${ACTION_LIMITS.armorMax}).`, { from: w.threshold, to: c, rule: 'ACTION_LIMITS.armorMax' }); w.threshold = c; }
    if (w.to < w.from) w.to = w.from;
  });
  a.gravity.forEach((w, i) => {
    const [lo, hi] = ACTION_LIMITS.gravityScale;
    if (!(w.scale >= lo && w.scale <= hi)) { const c = clamp(w.scale, lo, hi); notes.add('W224', `${P}.gravity[${i}].scale`, `gravity scale ${w.scale} → ${c}.`, { from: w.scale, to: c, rule: 'ACTION_LIMITS.gravityScale' }); w.scale = c; }
  });
  a.hurtboxes.forEach((w, i) => { if (w.shapes) clampShapes(w.shapes, body.collider, `${P}.hurtboxes[${i}].shapes`, notes); });
  if (a.landingLag !== null) {
    const lo = cat === 'aerial' ? row.minLandingLag : ACTION_LIMITS.landingLag[0];
    const c = clamp(a.landingLag, lo, ACTION_LIMITS.landingLag[1]);
    if (c !== a.landingLag) { notes.add('W222', `${P}.landingLag`, `landing lag ${a.landingLag} → ${c}.`, { from: a.landingLag, to: c, rule: 'ACTION_LIMITS.landingLag' }); a.landingLag = c; }
  }
  if (a.hold) {
    const [lo, hi] = ACTION_LIMITS.holdMax;
    if (!(a.hold.max >= lo && a.hold.max <= hi)) { const c = clamp(a.hold.max, lo, hi); notes.add('W223', `${P}.hold.max`, `hold max ${a.hold.max} → ${c}.`, { from: a.hold.max, to: c, rule: 'ACTION_LIMITS.holdMax' }); a.hold.max = c; }
    if (a.hold.to < a.hold.from) a.hold.to = a.hold.from;
  }
  if (a.charge) {
    const [lo, hi] = ACTION_LIMITS.chargeMax;
    if (!(a.charge.max >= lo && a.charge.max <= hi)) { const c = clamp(a.charge.max, lo, hi); notes.add('W223', `${P}.charge.max`, `charge max ${a.charge.max} → ${c} frames.`, { from: a.charge.max, to: c, rule: 'ACTION_LIMITS.chargeMax' }); a.charge.max = c; }
    if (!a.charge.auto && a.charge.at < 1) a.charge.at = 1;
  }
  if (a.counter) {
    const [lo, hi] = ACTION_LIMITS.counterMul;
    if (!(a.counter.mul >= lo && a.counter.mul <= hi)) { const c = clamp(a.counter.mul, lo, hi); notes.add('W223', `${P}.counter.mul`, `counter multiplier ${a.counter.mul} → ${c}.`, { from: a.counter.mul, to: c, rule: 'ACTION_LIMITS.counterMul' }); a.counter.mul = c; }
    if (a.counter.to < a.counter.from) a.counter.to = a.counter.from;
  }

  // 7. maxTotal (own hits, timeline hits, releases, 0.5 × spawned entities).
  let t = tally(a, env);
  if (t.total > row.maxTotal + 1e-9) {
    const k = row.maxTotal / t.total;
    const fl = (v) => Math.floor(v * k * 100) / 100; // round down: never back over the cap
    for (const h of a.hitboxes) h.damage = fl(h.damage);
    for (const e of a.timeline) {
      if (e.action === 'release') e.args.hit.damage = fl(e.args.hit.damage);
      else if (e.action === 'hit' && draft.hitboxes[e.args.template]) draft.hitboxes[e.args.template].damage = fl(draft.hitboxes[e.args.template].damage);
      else if (e.action === 'spawn' && draft.entities[e.args.entity] && entityDamage(draft.entities[e.args.entity]) > 0) {
        for (const h of draft.entities[e.args.entity].hitboxes) h.damage = fl(h.damage);
      }
    }
    notes.add('W211', P, `deals ${t.total} total damage (own ${t.own} + entities ${t.ext}); every hit scaled ×${k.toFixed(2)} to fit the ${cat} max of ${row.maxTotal}.`,
      { from: t.total, to: row.maxTotal, rule: `CATEGORIES.${cat}.maxTotal`, fix: 'fewer hits, a longer rehit, or move part of the damage into a separate move.' });
    t = tally(a, env);
  }

  // 8. Duration: minDuration, room after the last active frame, maxDps, 150 cap.
  const last = lastActive(a);
  const need = Math.max(row.minDuration, last + 3, row.maxDps ? Math.ceil(t.total / row.maxDps) : 0);
  if (a.duration < need) {
    const why = a.duration >= Math.max(row.minDuration, last + 3) ? `too fast for its damage (${t.total} in ${a.duration} frames)` : `shorter than the ${cat} minimum / its last active frame`;
    notes.add('W201', `${P}.duration`, `${why}; duration ${a.duration} → ${Math.min(need, ACTION_LIMITS.maxDuration)} frames.`, { from: a.duration, to: Math.min(need, ACTION_LIMITS.maxDuration), rule: `CATEGORIES.${cat}.minDuration/maxDps` });
    a.duration = need;
  }
  if (a.duration > ACTION_LIMITS.maxDuration) {
    if (need <= ACTION_LIMITS.maxDuration) notes.add('W201', `${P}.duration`, `duration ${a.duration} → ${ACTION_LIMITS.maxDuration} frames (max).`, { from: a.duration, to: ACTION_LIMITS.maxDuration, rule: 'ACTION_LIMITS.maxDuration' });
    a.duration = ACTION_LIMITS.maxDuration;
  }
  env.reach[key] = reach;
  env.rise[key] = Math.round(travelOf(a, 1, g).rise);
}

/**
 * Clamp hit templates against the strictest category/entity kind that uses them (§4.1.2),
 * then re-sync template-derived fields of merged hitboxes. Must run before entities/actions.
 */
export function clampTemplates(env) {
  const { draft } = env;
  const users = {};
  const add = (n, lim) => { if (n && draft.hitboxes[n]) (users[n] ||= []).push(lim); };
  for (const k of Object.keys(draft.moves).sort()) {
    const a = draft.moves[k];
    const row = rowOf(a.category);
    const lim = { maxHit: row.maxHit, koFloor: row.koFloor, canCharge: !!a.charge, name: `CATEGORIES.${a.category}` };
    for (const h of a.hitboxes) add(h.use, lim);
    for (const e of a.timeline) if (e.action === 'hit' || e.action === 'release') add(e.args.template, lim);
  }
  for (const k of Object.keys(draft.entities).sort()) {
    const e = draft.entities[k];
    const kind = e.kind !== 'zone' ? e.kind : e.life <= 30 && !e.hitboxes.some((h) => h.rehit) ? 'zone' : 'zoneLingering';
    const L = ENTITY_LIMITS[kind] || ENTITY_LIMITS.projectile;
    for (const h of e.hitboxes) add(h.use, { maxHit: L.maxHit, koFloor: L.koFloor, canCharge: false, name: `ENTITY_LIMITS.${kind}` });
  }
  for (const n of Object.keys(draft.hitboxes).sort()) {
    const tpl = draft.hitboxes[n];
    const list = users[n] || [{ maxHit: CATEGORIES.special.maxHit, koFloor: CATEGORIES.special.koFloor, canCharge: false, name: 'CATEGORIES.special' }];
    const strict = list.reduce((m, l) => (l.maxHit < m.maxHit ? l : m), list[0]);
    const ctx = {
      maxHit: Math.min(...list.map((l) => l.maxHit)), koFloor: Math.max(...list.map((l) => l.koFloor)),
      canCharge: list.some((l) => l.canCharge), rule: strict.name, code: 'W230',
    };
    const orig = Object.fromEntries(HIT_SYNC.map((k) => [k, tpl[k]]));
    (env.templateCtx ||= {})[n] = ctx;
    clampHit(tpl, ctx, `hitboxes.${n}`, env);
    const changed = HIT_SYNC.filter((k) => tpl[k] !== orig[k]);
    if (!changed.length) continue;
    const sync = (h) => { for (const k of changed) if (h[k] === orig[k]) h[k] = tpl[k]; };
    for (const a of Object.values(draft.moves)) {
      for (const h of a.hitboxes) if (h.use === n) sync(h);
      for (const e of a.timeline) if (e.action === 'release' && e.args.template === n) sync(e.args.hit);
    }
    for (const e of Object.values(draft.entities)) for (const h of e.hitboxes) if (h.use === n) sync(h);
  }
}

/** Clamp every action (sorted order: shared entity/template scaling is deterministic). */
export function clampActions(env) {
  for (const k of Object.keys(env.draft.moves).sort()) clampAction(env.draft.moves[k], k, env);
}


/**
 * Final KO-floor pass after every damage change (maxTotal, power budget). KO% is not
 * monotonic in damage near the spike cap, so floors are re-checked on the final numbers.
 */
export function recheckKo(env) {
  const { draft, notes } = env;
  const check = (h, floor, canCharge, path, rule) => {
    let f = floor;
    const t = tierLimits(h.tier);
    if (t) f = Math.max(f, t.koFloor);
    const r = capKo(h, f, { canCharge, cache: env.cache });
    if (r) notes.add('W213', path, `would KO at ~${r.before}% after damage scaling; knockback ×${r.k.toFixed(2)} (floor ${f}%).`, { from: r.before, to: r.after, rule: `${rule}.koFloor` });
  };
  for (const k of Object.keys(draft.moves).sort()) {
    const a = draft.moves[k];
    const row = rowOf(a.category);
    a.hitboxes.forEach((h, i) => { if (h.kind === 'strike' || h.kind === 'wind') check(h, row.koFloor, !!a.charge, `moves.${k}.hitboxes[${i}]`, `CATEGORIES.${a.category}`); });
    a.timeline.forEach((e, i) => { if (e.action === 'release') check(e.args.hit, row.koFloor, false, `moves.${k}.timeline[${i}].release`, `CATEGORIES.${a.category}`); });
  }
  for (const k of Object.keys(draft.entities).sort()) {
    const e = draft.entities[k];
    const kind = e.kind !== 'zone' ? e.kind : e.life <= 30 && !e.hitboxes.some((h) => h.rehit) ? 'zone' : 'zoneLingering';
    const L = ENTITY_LIMITS[kind] || ENTITY_LIMITS.projectile;
    e.hitboxes.forEach((h, i) => { if (h.kind === 'strike' || h.kind === 'wind') check(h, L.koFloor, false, `entities.${k}.hitboxes[${i}]`, `ENTITY_LIMITS.${kind}`); });
  }
  for (const n of Object.keys(draft.hitboxes).sort()) {
    const c = env.templateCtx?.[n];
    const h = draft.hitboxes[n];
    if (c && (h.kind === 'strike' || h.kind === 'wind')) check(h, c.koFloor, c.canCharge, `hitboxes.${n}`, c.rule);
  }
}
