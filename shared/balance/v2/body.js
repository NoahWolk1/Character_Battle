// ─────────────────────────────────────────────────────────────────────────────
// v2 body limits (spec §2.2.3, §4.1.1): collider range, ≤ 6 shapes per set and
// ≤ 8 sets, the shape envelope, scaleRange, passive armor, and the priced
// hurtbox area A[default]·scaleMin² ∈ [1600, 16000] (shapes scaled uniformly
// with a note when outside). Mutates the draft body in place.
// ─────────────────────────────────────────────────────────────────────────────
import { BODY_LIMITS } from '../rules.js';
import { unionArea, scaledShape, r2 } from './area.js';
import { shapesAABB } from '../../char/normalize-v2.js';
import { contains } from '../../sim/shapes.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Clamp a shape inside the envelope (in place). Returns true if it had to move or shrink. */
function clampToEnvelope(s, env) {
  const EPS = 1e-6;
  let changed = false;
  const put = (k, v) => { if (Math.abs(s[k] - v) > EPS) { s[k] = r2(v); changed = true; } };
  const fit = (c, ext, lo, hi) => (hi - lo < 2 * ext ? [(lo + hi) / 2, (hi - lo) / 2] : [clamp(c, lo + ext, hi - ext), ext]);
  if (s.shape === 'rect') {
    const [x, hw] = fit(s.x, s.w / 2, env.x1, env.x2);
    const [y, hh] = fit(s.y, s.h / 2, env.y1, env.y2);
    put('w', hw * 2); put('h', hh * 2); put('x', x); put('y', y);
  } else {
    put('r', Math.min(s.r, (env.x2 - env.x1) / 2, (env.y2 - env.y1) / 2));
    const pts = s.shape === 'capsule' ? [['x1', 'y1'], ['x2', 'y2']] : [['x', 'y']];
    for (const [kx, ky] of pts) {
      put(kx, clamp(s[kx], env.x1 + s.r, env.x2 - s.r));
      put(ky, clamp(s[ky], env.y1 + s.r, env.y2 - s.r));
    }
  }
  return changed;
}

/** Envelope for a collider (§2.2.3). */
export function envelopeOf(collider) {
  const M = Math.max(collider.w, collider.h);
  const E = BODY_LIMITS.envelope;
  return { x1: -E.x * M, x2: E.x * M, y1: -E.up * collider.h, y2: E.down * collider.h };
}

/**
 * How well a hurtbox set sits on the collider (the body opponents see and walk into):
 * {center: covers the collider center, cover: share of the collider covered, inside: share
 * of the set's own area that lies on the collider}. 2D grid samples, deterministic.
 */
export function colliderCoverage(shapes, collider) {
  const { w, h } = collider;
  const hit = (x, y) => shapes.some((s) => contains(s, x, y));
  const N = 24;
  let c = 0, n = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { n++; if (hit(-w / 2 + (i + 0.5) * w / N, -h + (j + 0.5) * h / N)) c++; }
  const box = shapesAABB(shapes);
  let a = 0, ain = 0;
  if (box) {
    const bw = box.x2 - box.x1, bh = box.y2 - box.y1;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = box.x1 + (i + 0.5) * bw / N, y = box.y1 + (j + 0.5) * bh / N;
      if (!hit(x, y)) continue;
      a++;
      if (x >= -w / 2 && x <= w / 2 && y >= -h && y <= 0) ain++;
    }
  }
  return { center: hit(0, -h / 2), cover: c / n, inside: a ? ain / a : 0 };
}

const onBody = (cv) => cv.center || cv.cover >= BODY_LIMITS.minCover || cv.inside >= BODY_LIMITS.minInside;

function shiftShape(s, dx, dy) {
  if (s.shape === 'capsule') { s.x1 = r2(s.x1 + dx); s.x2 = r2(s.x2 + dx); s.y1 = r2(s.y1 + dy); s.y2 = r2(s.y2 + dy); } else { s.x = r2(s.x + dx); s.y = r2(s.y + dy); }
}

/**
 * Hurtboxes must sit on the collider (no hittable point floating away from the body):
 * a set that misses it is moved onto the collider center (W136), else replaced by the collider.
 */
function keepOnBody(shapes, collider, path, notes) {
  if (!shapes.length || onBody(colliderCoverage(shapes, collider))) return;
  const box = shapesAABB(shapes);
  const dx = -(box.x1 + box.x2) / 2, dy = -collider.h / 2 - (box.y1 + box.y2) / 2;
  for (const s of shapes) shiftShape(s, dx, dy);
  const env = envelopeOf(collider);
  for (const s of shapes) clampToEnvelope(s, env);
  let how = `moved ${Math.round(Math.hypot(dx, dy))} px onto the body`;
  if (!onBody(colliderCoverage(shapes, collider))) {
    shapes.length = 0;
    shapes.push({ shape: 'rect', x: 0, y: -collider.h / 2, w: collider.w, h: collider.h });
    how = 'replaced by the collider rect';
  }
  notes.add('W136', path, `hurtboxes don't cover the body (collider); ${how}.`, { rule: 'BODY_LIMITS.minCover' });
}

/** Clamp a list of inline shapes (action hurtbox windows) to the body envelope. */
export function clampShapes(shapes, collider, path, notes) {
  const env = envelopeOf(collider);
  if (shapes.length > BODY_LIMITS.maxShapes) {
    notes.add('W131', path, `${shapes.length} shapes; only the first ${BODY_LIMITS.maxShapes} are used.`, { from: shapes.length, to: BODY_LIMITS.maxShapes, rule: 'BODY_LIMITS.maxShapes' });
    shapes.length = BODY_LIMITS.maxShapes;
  }
  shapes.forEach((s, i) => {
    if (clampToEnvelope(s, env)) notes.add('W132', `${path}[${i}]`, 'reached outside the body envelope; clamped inside it.', { rule: 'BODY_LIMITS.envelope' });
  });
  keepOnBody(shapes, collider, path, notes);
}

/**
 * Clamp one form's body and passive armor. Returns {area, pricedArea, scaleMin}.
 * @param {{body, armor}} form  draft form (mutated)
 */
export function clampBody(form, path, notes) {
  const b = form.body;
  const L = BODY_LIMITS;
  const P = path ? `${path}.body` : 'body';
  const AP = path ? `${path}.armor` : 'body.armor';
  for (const k of ['w', 'h']) {
    const [lo, hi] = L.collider[k];
    if (!(b.collider[k] >= lo && b.collider[k] <= hi)) {
      const c = clamp(Number.isFinite(b.collider[k]) ? b.collider[k] : lo, lo, hi);
      notes.add('W130', `${P}.collider.${k}`, `collider ${k} ${b.collider[k]} is outside ${lo}–${hi}; set to ${c}.`, { from: b.collider[k], to: c, rule: `BODY_LIMITS.collider.${k}` });
      b.collider[k] = c;
    }
  }
  // Set count: keep default/crouch/air, then the rest in sorted order.
  const names = Object.keys(b.hurtboxes);
  if (names.length > L.maxSets) {
    const keep = ['default', 'crouch', 'air', ...names.filter((n) => !['default', 'crouch', 'air'].includes(n)).sort()].filter((n) => names.includes(n)).slice(0, L.maxSets);
    for (const n of names) if (!keep.includes(n)) delete b.hurtboxes[n];
    notes.add('W131', `${P}.hurtboxes`, `${names.length} hurtbox sets; only ${L.maxSets} are kept (${keep.join(', ')}).`, { from: names.length, to: L.maxSets, rule: 'BODY_LIMITS.maxSets' });
  }
  for (const n of Object.keys(b.hurtboxes).sort()) clampShapes(b.hurtboxes[n], b.collider, `${P}.hurtboxes.${n}`, notes);

  // scaleRange ⊂ [0.6, 1.6]
  const [s0, s1] = b.scaleRange;
  const sr = [clamp(s0, ...L.scaleRange), clamp(s1, ...L.scaleRange)];
  if (sr[0] !== s0 || sr[1] !== s1) {
    notes.add('W134', `${P}.scaleRange`, `scaleRange [${s0}, ${s1}] clamped to [${sr}] (allowed ${L.scaleRange[0]}–${L.scaleRange[1]}).`, { from: [s0, s1], to: sr, rule: 'BODY_LIMITS.scaleRange' });
    b.scaleRange = sr;
  }

  // Passive armor
  if (form.armor) {
    const t = form.armor.threshold;
    if (!(t >= 0 && t <= L.armorMax)) {
      const c = clamp(Number.isFinite(t) ? t : 0, 0, L.armorMax);
      notes.add('W135', `${AP}.threshold`, `passive armor ${t} clamped to ${c} (max ${L.armorMax}).`, { from: t, to: c, rule: 'BODY_LIMITS.armorMax' });
      form.armor.threshold = c;
    }
    if (form.armor.threshold === 0) form.armor = null;
  }

  // Priced area: A[default] × scaleMin² ∈ [minArea, maxArea]; scale the hurtbox shapes otherwise.
  const scaleMin = b.scaleRange[0];
  let area = unionArea(b.hurtboxes.default);
  const priced = area * scaleMin * scaleMin;
  if (priced < L.minArea || priced > L.maxArea) {
    const target = priced < L.minArea ? L.minArea : L.maxArea;
    const orig = b.hurtboxes;
    const s2 = scaleMin * scaleMin;
    let k = 1;
    let after = priced;
    // Scale about the default set's center (shapes stay where they were), then keep them in the envelope.
    const box = shapesAABB(orig.default) || { x1: 0, x2: 0, y1: -b.collider.h, y2: 0 };
    const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
    const env = envelopeOf(b.collider);
    for (let i = 0; i < 16 && (after < L.minArea || after > L.maxArea); i++) {   // the raster isn't exactly quadratic: iterate
      k *= Math.min(8, Math.sqrt(target / Math.max(1, after))) * (after < L.minArea ? 1.002 : 0.998);
      b.hurtboxes = Object.fromEntries(Object.entries(orig).map(([n, list]) => [n, list.map((s) => scaledShape(s, k, cx, cy))]));
      for (const list of Object.values(b.hurtboxes)) for (const s of list) clampToEnvelope(s, env);
      after = unionArea(b.hurtboxes.default) * s2;
    }
    if (after < L.minArea || after > L.maxArea) {
      // Degenerate shapes (e.g. zero-size): fall back to a rect with the collider's aspect and the target area.
      let side = Math.sqrt(target / s2 / (b.collider.w * b.collider.h));
      for (let i = 0; i < 12; i++) {
        const w = r2(b.collider.w * side), h = r2(b.collider.h * side);
        b.hurtboxes = { ...orig, default: [{ shape: 'rect', x: 0, y: -h / 2, w, h }] };
        after = unionArea(b.hurtboxes.default) * s2;
        if (after >= L.minArea && after <= L.maxArea) break;
        side *= after < L.minArea ? 1.02 : 0.98;
      }
      k = side;
    }
    after /= s2;
    notes.add('W133', `${P}.hurtboxes`, `priced hurtbox area ${Math.round(priced)} px² is outside ${L.minArea}–${L.maxArea}; every hurtbox shape was scaled ×${k.toFixed(2)} (→ ${Math.round(after * scaleMin * scaleMin)} px²).`,
      { from: Math.round(priced), to: Math.round(after * scaleMin * scaleMin), rule: priced < L.minArea ? 'BODY_LIMITS.minArea' : 'BODY_LIMITS.maxArea' });
    area = after;
  }
  return { area, pricedArea: area * scaleMin * scaleMin, scaleMin };
}

/** Union area of every hurtbox set of a body (report.area, §3.7). */
export function setAreas(body) {
  const out = {};
  for (const n of Object.keys(body.hurtboxes).sort()) out[n] = unionArea(body.hurtboxes[n]);
  return out;
}
