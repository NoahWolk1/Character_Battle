// Shape math vs brute force (spec §9 WP-E acceptance).
//   node test/sim/shapes.test.js      (or: node --test test/sim/*.test.js)
// overlap() is checked on 10k random decided pairs against a grid search of
// max(sdA, sdB) built from independent signed-distance functions: a pair is
// certainly overlapping when some grid point is inside both shapes, certainly
// separated when every grid point is more than step/√2 outside one of them
// (signed distance is 1-Lipschitz). Pairs in between are re-drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mirror, overlap, aabb, contains, kindOf } from '../../shared/sim/shapes.js';
import { mulberry32 } from '../../shared/sim/rng.js';

const rng = mulberry32(12345);
const U = (a, b) => a + (b - a) * rng();

// ── independent signed distances ─────────────────────────────────────────
function sd(s, px, py) {
  const k = kindOf(s);
  if (k === 'circle') return Math.hypot(px - s.x, py - s.y) - s.r;
  if (k === 'capsule') {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / l2)) : 0;
    return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy)) - s.r;
  }
  const cx = s.x1 !== undefined ? (s.x1 + s.x2) / 2 : s.x, cy = s.y1 !== undefined ? (s.y1 + s.y2) / 2 : s.y;
  const hw = s.x1 !== undefined ? (s.x2 - s.x1) / 2 : s.w / 2, hh = s.y1 !== undefined ? (s.y2 - s.y1) / 2 : s.h / 2;
  const qx = Math.abs(px - cx) - hw, qy = Math.abs(py - cy) - hh;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

function randomShape() {
  const k = rng();
  if (k < 0.34) return { x: U(-50, 50), y: U(-50, 50), r: U(1, 40) };
  if (k < 0.67) {
    const x1 = U(-50, 50), y1 = U(-50, 50);
    const degenerate = rng() < 0.05;
    return { shape: 'capsule', x1, y1, x2: degenerate ? x1 : U(-50, 50), y2: degenerate ? y1 : U(-50, 50), r: U(1, 20) };
  }
  return { shape: 'rect', x: U(-50, 50), y: U(-50, 50), w: U(1, 60), h: U(1, 60) };
}

/** true / false when certain, null when too close to call at this resolution. */
function bruteOverlap(a, b) {
  const A = aabbBrute(a), B = aabbBrute(b);
  const x1 = Math.max(A.x1, B.x1), x2 = Math.min(A.x2, B.x2);
  const y1 = Math.max(A.y1, B.y1), y2 = Math.min(A.y2, B.y2);
  if (x1 > x2 || y1 > y2) return false;
  const step = Math.max(0.2, Math.max(x2 - x1, y2 - y1) / 60);
  const nx = Math.ceil((x2 - x1) / step), ny = Math.ceil((y2 - y1) / step);
  let best = Infinity;
  for (let i = 0; i <= nx; i++) {
    const px = nx ? x1 + ((x2 - x1) * i) / nx : x1;
    for (let j = 0; j <= ny; j++) {
      const py = ny ? y1 + ((y2 - y1) * j) / ny : y1;
      const v = Math.max(sd(a, px, py), sd(b, px, py));
      if (v < best) best = v;
      if (best <= 0) return true;
    }
  }
  return best > step * Math.SQRT1_2 + 1e-9 ? false : null;
}

// Bounding boxes computed independently of shapes.aabb (for the overlap search).
function aabbBrute(s) {
  const k = kindOf(s);
  if (k === 'circle') return { x1: s.x - s.r, x2: s.x + s.r, y1: s.y - s.r, y2: s.y + s.r };
  if (k === 'capsule') return { x1: Math.min(s.x1, s.x2) - s.r, x2: Math.max(s.x1, s.x2) + s.r, y1: Math.min(s.y1, s.y2) - s.r, y2: Math.max(s.y1, s.y2) + s.r };
  if (s.x1 !== undefined) return { x1: s.x1, x2: s.x2, y1: s.y1, y2: s.y2 };
  return { x1: s.x - s.w / 2, x2: s.x + s.w / 2, y1: s.y - s.h / 2, y2: s.y + s.h / 2 };
}

test('overlap() matches brute force on 10k decided random pairs (all kind combinations)', () => {
  let decided = 0, skipped = 0;
  const combos = {};
  while (decided < 10000) {
    const a = randomShape(), b = randomShape();
    const want = bruteOverlap(a, b);
    if (want === null) { skipped++; continue; }
    const got = overlap(a, b);
    assert.equal(got, want, `overlap mismatch: ${JSON.stringify(a)} vs ${JSON.stringify(b)} (want ${want})`);
    assert.equal(overlap(b, a), got, 'overlap must be symmetric');
    const key = [kindOf(a), kindOf(b)].sort().join('-');
    combos[key] = (combos[key] || 0) + 1;
    decided++;
  }
  assert.equal(Object.keys(combos).length, 6, `every kind pair covered: ${JSON.stringify(combos)}`);
  assert.ok(skipped < 2000, `too many undecidable pairs (${skipped})`);
});

test('overlap() on world shapes from mirror() agrees with brute force', () => {
  let decided = 0;
  while (decided < 2000) {
    const facing = rng() < 0.5 ? -1 : 1, scale = U(0.6, 1.6);
    const a = mirror(randomShape(), facing, scale, U(-30, 30), U(-30, 30));
    const b = mirror(randomShape(), -facing, U(0.6, 1.6), U(-30, 30), U(-30, 30));
    const want = bruteOverlap(a, b);
    if (want === null) continue;
    assert.equal(overlap(a, b), want);
    decided++;
  }
});

test('mirror() maps points exactly like mirror-then-scale-then-translate', () => {
  for (let n = 0; n < 2000; n++) {
    const s = randomShape();
    const facing = rng() < 0.5 ? -1 : 1, scale = U(0.6, 1.6), X = U(-500, 500), Y = U(-300, 300);
    const w = mirror(s, facing, scale, X, Y);
    for (let i = 0; i < 40; i++) {
      const lx = U(-110, 110), ly = U(-110, 110);
      const d = sd(s, lx, ly);
      if (Math.abs(d) < 1e-6) continue;
      const px = X + lx * facing * scale, py = Y + ly * scale;
      assert.equal(contains(w, px, py), d <= 0, `mirror mismatch for ${JSON.stringify(s)} f=${facing} s=${scale}`);
    }
  }
});

test('aabb() contains the shape and is tight', () => {
  for (let n = 0; n < 2000; n++) {
    const s = rng() < 0.5 ? randomShape() : mirror(randomShape(), rng() < 0.5 ? -1 : 1, U(0.6, 1.6), U(-50, 50), U(-50, 50));
    const b = aabb(s);
    const B = aabbBrute(s);
    for (const k of ['x1', 'y1', 'x2', 'y2']) assert.ok(Math.abs(b[k] - B[k]) < 1e-9, `aabb ${k} ${b[k]} vs ${B[k]}`);
    // every sampled interior point lies inside, and the extremes are reached
    let mx1 = Infinity, mx2 = -Infinity;
    for (let i = 0; i < 400; i++) {
      const px = U(b.x1 - 5, b.x2 + 5), py = U(b.y1 - 5, b.y2 + 5);
      if (contains(s, px, py)) {
        assert.ok(px >= b.x1 && px <= b.x2 && py >= b.y1 && py <= b.y2, 'point outside aabb');
        mx1 = Math.min(mx1, px); mx2 = Math.max(mx2, px);
      }
    }
    if (mx1 !== Infinity) assert.ok(mx1 >= b.x1 && mx2 <= b.x2);
  }
});

test('v1 hurtbox parity: mirror(rect) bounds are bit-identical to v1 arithmetic', () => {
  for (let n = 0; n < 5000; n++) {
    const fx = U(-1200, 1200), fy = U(-1000, 700), w = U(38, 72), h = U(70, 118), facing = rng() < 0.5 ? -1 : 1;
    for (const hh of [h, h * 0.68]) {
      const r = mirror({ shape: 'rect', x: 0, y: -hh / 2, w, h: hh }, facing, 1, fx, fy);
      assert.equal(r.x1, fx - w / 2); assert.equal(r.x2, fx + w / 2);
      assert.equal(r.y1, fy - hh); assert.equal(r.y2, fy);
    }
    const hb = { x: U(-80, 80), y: U(-120, 20), r: U(4, 40) };
    const c = mirror(hb, facing, 1, fx, fy);
    assert.equal(c.x, fx + hb.x * facing); assert.equal(c.y, fy + hb.y); assert.equal(c.r, hb.r);
  }
});
