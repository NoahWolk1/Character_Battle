// characters/gertie/sheet-svg.js — paints Gertie's sprite frames as SVG from the pose table.
// This is the painter behind the committed sheets gertie.png (body) and teeth.png (dentures);
// the game only loads the PNGs. Each frame is a standalone SVG (pure string building, no I/O).
// To regenerate after editing poses.js or this file: run the dev server (npm run dev), open
// any page of it, and in the browser console run
//
//   (await import('/characters/gertie/sheet-svg.js')).downloadSheets(document)
//
// then move the two downloaded PNGs into characters/gertie/.
//
// Style: 3 value tiers per material (shade crescent away from the key light, base, soft top-left
// light), a 2.8 px plum outline (never black). The key light is baked top-left; art.js adds the
// live rim light from the stage (info.light) on top, mirrored with facing.
import { FRAME, POSES, TEETH, joints, BONES } from './poses.js';

const OUT = '#3a2340';
const INK = '#5b2c45';            // interior lines (wrinkles, seams)
const LW = 2.8;                   // outline width, body px (≈ 2.9 u)
const MAT = Object.freeze({
  skin: ['#f6cdb0', '#d89a84', '#fff0e2'],
  hair: ['#f4f0fa', '#bfb2d6', '#ffffff'],
  cardi: ['#b88ddc', '#7d58a8', '#e2c8f8'],
  cardiFar: ['#9a72c2', '#664690', '#c4a6e2'],
  dress: ['#f08fa6', '#bf5b7a', '#ffc8d4'],
  blouse: ['#fff7ec', '#e0cbbd', '#ffffff'],
  stock: ['#ecc8ac', '#c39a84', '#fbe2cc'],
  stockFar: ['#d6ae94', '#a8806c', '#e8c8b0'],
  shoe: ['#7c2f4a', '#4e1a30', '#b0587a'],
  hat: ['#d4436f', '#952a50', '#ff8fb0'],
  skinFar: ['#e6b597', '#c0846f', '#f6d6c0'],
  tea: ['#fdf8f2', '#c9bfd6', '#ffffff'],
  can: ['#5fc7e8', '#2f88b0', '#c8f2ff'],
  knit: ['#7fd6b8', '#3f9a82', '#c6f6e4'],
});

const f1 = (n) => (Math.round(n * 10) / 10).toString();
const pt = (p) => `${f1(p[0])} ${f1(p[1])}`;
const D = Math.PI / 180;
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Closed Catmull-Rom path through pts. */
function smooth(pts, closed = true, k = 1 / 6) {
  const n = pts.length;
  const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${pt(pts[0])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return closed ? `${d}Z` : d;
}
const poly = (pts) => `M${pts.map(pt).join('L')}Z`;
const circ = (c, r) => `M${f1(c[0] - r)} ${f1(c[1])}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`;
const ell = (c, rx, ry) => `M${f1(c[0] - rx)} ${f1(c[1])}a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(2 * rx)} 0a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(-2 * rx)} 0Z`;

/** Tapered capsule a→b (radii r1, r2) as a smooth closed path. */
function capsule(a, b, r1, r2 = r1) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const pts = [];
  for (let i = 0; i <= 4; i++) { const t = ang + Math.PI / 2 + (i / 4) * Math.PI; pts.push([a[0] + Math.cos(t) * r1, a[1] + Math.sin(t) * r1]); }
  for (let i = 0; i <= 4; i++) { const t = ang - Math.PI / 2 + (i / 4) * Math.PI; pts.push([b[0] + Math.cos(t) * r2, b[1] + Math.sin(t) * r2]); }
  return smooth(pts, true, 1 / 8);
}

/**
 * Shared style registry: repeated stroke/fill settings become short CSS classes so the
 * sheet stays well under the 1.5 MB asset limit. Reset per sheet.
 */
const styles = { map: new Map(), n: 0, uid: 0 };
function cls(css) {
  let k = styles.map.get(css);
  if (!k) { k = `s${(styles.n++).toString(36)}`; styles.map.set(css, k); }
  return k;
}
const strokeCls = (color, lw, extra = '') => cls(`fill:none;stroke:${color};stroke-width:${f1(lw)};stroke-linejoin:round;stroke-linecap:round${extra}`);
const styleSheet = () => `<style>${[...styles.map].map(([css, k]) => `.${k}{${css}}`).join('')}</style>`;

/**
 * One frame's painter. Collects defs and body markup; `part()` paints a shaded,
 * outlined material shape: shade tier, base tier shifted toward the key light (clipped
 * to the shape), a soft light gradient, then the outline.
 */
function canvas() {
  const defs = [], body = [];
  return {
    defs, body,
    part(d, mat, o = {}) {
      const id = `p${(styles.uid++).toString(36)}`;
      const [b, s] = MAT[mat] || mat;
      const sh = o.shift ? ` transform="translate(${f1(o.shift[0])} ${f1(o.shift[1])})"` : ' transform="translate(-1.5 -2.1)"';
      const grad = typeof mat === 'string' ? mat : 'x';
      // the shape lives in defs without a fill, so each <use> can set its own tier
      defs.push(`<path id="${id}" d="${d}"/><clipPath id="c${id}"><use href="#${id}"/></clipPath>`);
      body.push(`<use href="#${id}" fill="${s}"/><g clip-path="url(#c${id})"><use href="#${id}" fill="${b}"${sh}/>`
        + `${o.inner ? o.inner(id) : ''}</g><use href="#${id}" fill="url(#L${grad})" class="${cls(`stroke:${OUT};stroke-width:${f1(o.lw ?? LW)};stroke-linejoin:round`)}"/>`);
      return id;
    },
    flat(d, fill, o = {}) {
      const c = o.stroke ? ` class="${cls(`stroke:${o.stroke};stroke-width:${f1(o.lw ?? LW)};stroke-linejoin:round;stroke-linecap:round`)}"` : '';
      body.push(`<path d="${d}" fill="${fill}"${c}${o.alpha != null ? ` opacity="${o.alpha}"` : ''}/>`);
    },
    line(d, stroke, lw = 1.2, o = {}) {
      body.push(`<path d="${d}" class="${strokeCls(stroke, lw, o.alpha != null ? `;opacity:${o.alpha}` : '')}"/>`);
    },
    raw(str) { body.push(str); },
  };
}

// ── hands ────────────────────────────────────────────────────────────────────
function hand(c, at, ang, kind, far) {
  const skin = far ? 'skinFar' : 'skin';
  const L = (x, y) => add(at, rot(x, y, ang));
  if (kind === 'open') {
    const fingers = [[-2.2, 1.2, 0.5], [-0.6, 0.4, 0.15], [0.9, -0.2, -0.15], [2.2, -0.6, -0.45]];
    for (const [ox, , fa] of fingers) c.part(capsule(L(2, ox * 0.9), L(6.6, ox * 1.5 + fa * 3), 1.3, 1.1), skin, { lw: 1.6 });
    c.part(smooth([L(-2.6, -3.2), L(2.8, -3.2), L(3.6, 0), L(2.6, 3.2), L(-2.4, 3.4), L(-3.4, 0)]), skin, { lw: 1.8 });
    c.part(capsule(L(0.5, -2.8), L(3.6, -5.6), 1.3, 1.1), skin, { lw: 1.6 });
    return;
  }
  c.part(circ(at, 3.7), skin, { lw: 1.9 });
  if (kind === 'point') c.part(capsule(L(2.6, -1.2), L(8.6, -1.6), 1.3, 1.1), skin, { lw: 1.6 });
  if (kind === 'pinch') { c.part(capsule(L(2, -1.6), L(5.6, -2.4), 1.2, 1), skin, { lw: 1.5 }); c.part(capsule(L(1.4, 1.4), L(5.2, -1.4), 1.2, 1), skin, { lw: 1.5 }); }
  if (kind === 'grip') c.line(`M${pt(L(0.8, -2.6))}Q${pt(L(3, -0.4))} ${pt(L(1, 2.4))}`, INK, 0.9);
  else c.line(`M${pt(L(-1.2, -2.2))}Q${pt(L(1.4, -0.8))} ${pt(L(1.4, 1.6))}`, INK, 0.8);
}

function arm(c, sh, el, h, ang, kind, far) {
  const cm = far ? 'cardiFar' : 'cardi';
  c.part(capsule(sh, el, 5.2, 4.4), cm);
  const cuff = lerp2(el, h, 0.72);
  c.part(capsule(el, cuff, 4.4, 3.9), cm);
  c.part(capsule(lerp2(el, h, 0.66), lerp2(el, h, 0.84), 4.3, 4.3), far ? 'cardiFar' : 'cardi', { lw: 1.8 }); // ribbed cuff
  c.line(`M${pt(lerp2(el, h, 0.7))}L${pt(lerp2(el, h, 0.8))}`, MAT[cm][1], 1, { alpha: 0.7 });
  hand(c, h, ang, kind, far);
}

function leg(c, J, p, far) {
  const o = far ? [-4, 1] : [0, 0];
  const knee = add(p.knee, o), ank = add(p.ankle, o);
  c.part(capsule(knee, ank, 4.2, 3.2), far ? 'stockFar' : 'stock');
  // sensible orthopedic shoe: chunky toe forward, low heel
  const s = ank;
  c.part(smooth([[s[0] - 3.6, s[1] - 1.6], [s[0] + 2, s[1] - 2.6], [s[0] + 8.6, s[1] + 0.4], [s[0] + 9.4, s[1] + 3.4], [s[0] + 6, s[1] + 4.6], [s[0] - 3.8, s[1] + 4.4]]), 'shoe', { lw: 2 });
  c.line(`M${pt([s[0] - 3.4, s[1] + 3.2])}L${pt([s[0] + 8.8, s[1] + 3.2])}`, '#2e1222', 1.2, { alpha: 0.5 });
  if (!far) c.flat(circ([s[0] + 3, s[1] - 0.6], 0.9), '#ffd166');            // little buckle
}

// ── torso / dress ────────────────────────────────────────────────────────────
function skirt(c, p) {
  const k = p.knee;
  // drapes from the hip over the thigh, hem just past the knee, falls over the seat edge
  const pts = [[-12, -7], [-3, -9], [k[0] * 0.55, k[1] - 5.5], [k[0] + 3.2, k[1] - 4.6], [k[0] + 5.6, k[1] + 1], [k[0] + 4.4, k[1] + 7.6],
    [k[0] - 3, k[1] + 8.6], [-2, 8.4], [-12, 6]];
  c.part(smooth(pts), 'dress', {
    inner: () => [[k[0] * 0.3, -4], [k[0] * 0.75, k[1] - 1], [2, 4], [k[0] - 2, k[1] + 5], [-7, 1]].map((q) => `<circle cx="${f1(q[0])}" cy="${f1(q[1])}" r="1.1" fill="#fff4f6" opacity="0.85"/>`).join(''),
  });
  c.line(`M${pt([k[0] - 3, k[1] + 7.6])}Q${pt([k[0] + 1, k[1] + 4])} ${pt([k[0] + 4.6, k[1] + 6.4])}`, MAT.dress[1], 1.1);
}

function torso(c, J, p) {
  const L = p.lean * D;
  const T = (x, y) => rot(x, y, L);
  const back = [[-11, 3], [-14.5, -8], [-13, -20], [-8.5, -28.5], [-1, -31.5], [6.5, -30], [11, -24.5], [14, -14], [15, -4], [11, 4]].map((q) => T(q[0], q[1]));
  c.part(smooth(back), 'cardi', {
    inner: () => `<path d="${smooth([T(-12.8, 0.5), T(10.8, 0.5), T(11.4, 4.6), T(-11.6, 4.6)], true, 0.1)}" fill="${MAT.cardi[1]}" opacity="0.55"/>`,
  });
  // blouse panel between the cardigan fronts, ruffled collar
  const bl = [[-0.8, -30.6], [7.2, -29.4], [11.4, -20], [12.2, -11], [8.6, -9.4], [4, -17]].map((q) => T(q[0], q[1]));
  c.part(smooth(bl, true, 0.12), 'blouse', { lw: 1.7 });
  // cardigan front edge + buttons
  c.line(`M${pt(T(8.6, -9.4))}Q${pt(T(5, -18))} ${pt(T(-0.4, -30))}`, OUT, 1.6);
  for (const y of [-25, -19, -13]) c.flat(circ(T(4.4 + (y + 25) * 0.18, y), 1.15), '#ffd166', { stroke: OUT, lw: 0.8 });
  // pocket with a hanky
  c.flat(smooth([T(-2, -9), T(6, -8.4), T(6.4, -3), T(-1.6, -3.4)], true, 0.08), MAT.cardi[1], { stroke: OUT, lw: 1.2 });
  c.flat(smooth([T(0, -9), T(1.6, -12), T(3.4, -10.6), T(4.4, -12.4), T(5, -8.8)], true, 0.15), '#ffffff', { stroke: OUT, lw: 0.9 });
  // knit texture: soft vertical rib lines on the back
  for (const x of [-9, -5]) c.line(`M${pt(T(x, -22))}Q${pt(T(x - 1.6, -10))} ${pt(T(x, 0))}`, MAT.cardi[1], 0.9, { alpha: 0.6 });
}

// ── head ─────────────────────────────────────────────────────────────────────
function head(c, J, p, pi) {
  const H = J.head, R = J.headRot;
  const A = (x, y) => add(H, rot(x, y, R));
  const sway = p.hair;
  // neck
  c.part(capsule(add(J.top, rot(1, 0, p.lean * D)), A(1, 8), 4, 3.6), 'skin', { lw: 1.8 });
  // back hair curls (behind face) + bun
  const curls = [[-9, -3, 5.6], [-10.5, 3.5, 4.6], [-7, 8, 3.6], [-6.5, -9, 5.8], [-0.5, -11.5, 5.8], [5.5, -10.5, 5], [10, -7, 3.8]];
  const curlPts = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    let best = 0;
    for (const [cx, cy, r] of curls) {
      const ox = cx + (cy < -5 ? sway * 0.6 : sway * 0.25), oy = cy;
      // furthest hit of a ray from (−2,−3) against each curl circle
      const dx = Math.cos(a), dy = Math.sin(a), px = -2 - ox, py = -3 - oy;
      const bq = px * dx + py * dy, cq = px * px + py * py - r * r, disc = bq * bq - cq;
      if (disc > 0) best = Math.max(best, -bq + Math.sqrt(disc));
    }
    if (best > 0) curlPts.push(A(-2 + Math.cos(a) * best, -3 + Math.sin(a) * best));
  }
  c.part(smooth(curlPts, true, 0.12), 'hair', {
    inner: () => curls.map(([cx, cy, r]) => {
      const q = A(cx + (cy < -5 ? sway * 0.6 : sway * 0.25), cy);
      return `<path d="${circ(q, r * 0.62)}" fill="none" stroke="${MAT.hair[1]}" stroke-width="1" opacity="0.8"/>`;
    }).join(''),
  });
  c.part(circ(A(-9.5 + sway * 0.8, -12), 4.8), 'hair', { inner: (id) => `<path d="${circ(A(-9.8 + sway * 0.8, -12.4), 2.4)}" fill="none" stroke="${MAT.hair[1]}" stroke-width="1"/>` });
  // ear
  c.part(ell(A(-2.5, 1.5), 2.4, 3.2), 'skin', { lw: 1.6 });
  // face: round, soft jowl, chin; nose breaks the silhouette for a readable profile
  const gum = p.mouth === 'gum' || p.mouth === 'gumgrin';
  const face = [[-3, -8], [3, -10.5], [8.6, -8], [11.4, -3], [11.6, 2], [10.4, 7], [8, gum ? 9.6 : 10.6], [3.6, 11.4], [-1, 9.2], [-3.6, 4]].map((q) => A(q[0], q[1]));
  c.part(smooth(face), 'skin', {
    inner: () => `<path d="${ell(A(5.4, 4.4), 2.8 * (0.6 + p.blush * 0.4), 1.9)}" fill="#ff7f9a" opacity="${f1(0.25 + p.blush * 0.45)}"/>`,
  });
  // front curls over the forehead
  c.part(smooth([A(-3.4, -7), A(0, -12.6), A(6.4, -12.2), A(10.6 + sway * 0.3, -8), A(7.4, -6.6), A(3.6, -8), A(0, -5.4)], true, 0.14), 'hair', { lw: 1.9 });
  // wrinkles: crow's feet + smile line
  c.line(`M${pt(A(0.6, 3.6))}Q${pt(A(2.2, 6.6))} ${pt(A(5.6, 8.6))}`, INK, 0.8, { alpha: 0.55 });
  c.line(`M${pt(A(-0.6, -1))}L${pt(A(-2, -2))}M${pt(A(-0.6, 0.6))}L${pt(A(-2.2, 1))}`, INK, 0.6, { alpha: 0.5 });
  // nose (big, bulbous)
  c.part(smooth([A(9.6, -1.6), A(12.4, 0), A(14.2, 2.6), A(13.2, 4.6), A(10.4, 4.4)], true, 0.15), 'skin', { lw: 1.8 });
  // eyes behind huge glasses (magnified)
  eyes(c, A, p);
  mouth(c, A, p);
  // hat: pillbox with a daisy and (unless she is holding it) the hat pin
  const hat = [[-6, -13.4], [-5, -18.6], [6.8, -19.6], [8.6, -14.6]].map((q) => A(q[0], q[1]));
  c.part(smooth(hat, true, 0.1), 'hat', { lw: 2.1 });
  c.part(smooth([A(-8, -12.6), A(10.6, -14.4), A(10.4, -12), A(-7.6, -10.6)], true, 0.08), 'hat', { lw: 1.8 });
  c.line(`M${pt(A(-5.6, -15.2))}L${pt(A(7.6, -16.2))}`, MAT.hat[1], 1.2);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    c.flat(ell(A(-4.6 + Math.cos(a) * 2.2, -17.8 + Math.sin(a) * 2.2), 1.6, 1.6), '#fffdf4', { stroke: OUT, lw: 0.7 });
  }
  c.flat(circ(A(-4.6, -17.8), 1.3), '#ffc531', { stroke: OUT, lw: 0.7 });
  if (p.hatpin) {
    c.line(`M${pt(A(-11, -16))}L${pt(A(11.5, -20.4))}`, '#cfd6e2', 1, {});
    c.flat(circ(A(-11.4, -15.8), 1.7), '#fffaf0', { stroke: OUT, lw: 0.8 });
  }
}

function eyes(c, A, p) {
  const lens = [[A(6.8, -1), 4.7], [A(0.6, -1.6), 3.9]];
  // lens glass behind eyes, then eyes, then frames + glare
  for (const [q, r] of lens) c.flat(circ(q, r), '#f2f8ff');
  for (const [i, [q, r]] of lens.entries()) {
    const k = r / 4.7, far = i === 1;
    const e = p.eyes;
    if (e === 'closed') c.line(`M${pt(add(q, [-2.4 * k, 0]))}Q${pt(add(q, [0, 2 * k]))} ${pt(add(q, [2.4 * k, 0]))}`, OUT, 1.2);
    else if (e === 'squint') c.line(`M${pt(add(q, [-2.4 * k, 0.6]))}Q${pt(add(q, [0, -1.4 * k]))} ${pt(add(q, [2.4 * k, 0.6]))}`, OUT, 1.3);
    else if (e === 'x') c.line(`M${pt(add(q, [-1.8 * k, -1.8 * k]))}L${pt(add(q, [1.8 * k, 1.8 * k]))}M${pt(add(q, [1.8 * k, -1.8 * k]))}L${pt(add(q, [-1.8 * k, 1.8 * k]))}`, OUT, 1.2);
    else if (e === 'spiral') c.line(`M${pt(q)}a0.8 0.8 0 1 1 1.4 0.6a1.8 1.8 0 1 1 -3 -1a2.6 2.6 0 1 1 4.6 1.4`, OUT, 0.9);
    else {
      const big = e === 'wide' ? 3.2 : 2.7;
      c.flat(ell(q, big * k, big * k * 1.1), '#ffffff');
      const pr = (e === 'wide' ? 1.3 : 1.9) * k;
      c.flat(circ(add(q, [0.7 * k, 0.3]), pr), far ? '#4a2a5a' : '#3a2340');
      c.flat(circ(add(q, [0.1, -0.6]), 0.7 * k), '#ffffff');
      if (e === 'angry') c.flat(`M${pt(add(q, [-3.4 * k, -3.6 * k]))}L${pt(add(q, [3.4 * k, -0.9 * k]))}L${pt(add(q, [3.4 * k, -3.6 * k]))}Z`, MAT.skin[0]);
    }
  }
  // brows (white, bushy) above the frames
  const by = p.brows === 'up' ? -8.6 : -7.2;
  const ang = p.brows === 'angry' ? 2.2 : p.brows === 'up' ? -1 : 0;
  c.line(`M${pt(A(3.2, by - ang * 0.2))}L${pt(A(10, by + ang))}`, '#d9d0e6', 2.2);
  c.line(`M${pt(A(3.2, by - ang * 0.2))}L${pt(A(10, by + ang))}`, OUT, 0.7, { alpha: 0.6 });
  c.line(`M${pt(A(-1.8, by - 0.4 + ang))}L${pt(A(2.2, by - 0.8))}`, '#d9d0e6', 2);
  // frames
  for (const [q, r] of lens) c.flat(circ(q, r), 'none', { stroke: '#c8343f', lw: 1.6 });
  for (const [q, r] of lens) c.flat(circ(q, r + 0.9), 'none', { stroke: OUT, lw: 0.6 });
  c.line(`M${pt(A(2.6, -1.8))}Q${pt(A(3.4, -2.8))} ${pt(A(4.2, -1.6))}`, '#c8343f', 1.2);
  c.line(`M${pt(A(-3.2, -1.4))}L${pt(A(-5.6, 0.6))}`, '#c8343f', 1.1);
  // glare
  c.line(`M${pt(add(lens[0][0], [-2.6, -1.4]))}Q${pt(add(lens[0][0], [-1.6, -3]))} ${pt(add(lens[0][0], [0.4, -3.4]))}`, '#ffffff', 1, { alpha: 0.9 });
}

function mouth(c, A, p) {
  const m = p.mouth, q = A(8.4, 6.6);
  const red = '#a8364f', dark = '#4a1830';
  const teeth = (w, y0) => c.flat(`M${pt(A(8.4 - w, y0))}L${pt(A(8.4 + w, y0))}L${pt(A(8.4 + w * 0.8, y0 + 1.3))}L${pt(A(8.4 - w * 0.8, y0 + 1.3))}Z`, '#fffdf0');
  switch (m) {
    case 'smile': c.line(`M${pt(A(5.4, 6))}Q${pt(A(8.4, 8.4))} ${pt(A(11, 5.6))}`, red, 1.2); break;
    case 'smug': c.line(`M${pt(A(5.6, 7))}Q${pt(A(8.6, 7.6))} ${pt(A(11, 5))}`, red, 1.2); break;
    case 'frown': c.line(`M${pt(A(5.6, 7.6))}Q${pt(A(8.4, 5.6))} ${pt(A(11, 7.4))}`, red, 1.2); break;
    case 'o': c.flat(ell(q, 1.5, 1.8), dark, { stroke: red, lw: 0.8 }); break;
    case 'sip': c.flat(ell(A(9.6, 6.4), 1.3, 1.1), red); break;
    case 'gum': c.line(`M${pt(A(6, 6.2))}Q${pt(A(8, 7.4))} ${pt(A(10.4, 6))}M${pt(A(7.4, 7.6))}L${pt(A(7.8, 8.4))}M${pt(A(9.2, 7.4))}L${pt(A(9.6, 8.2))}`, red, 1.1); break;
    case 'gumgrin': c.flat(smooth([A(5.2, 5.4), A(11.2, 4.8), A(9.6, 8.6), A(6.6, 8.4)], true, 0.12), '#e8768e', { stroke: red, lw: 0.9 }); break;
    case 'grit': {
      c.flat(smooth([A(5, 5), A(11.6, 4.6), A(11, 8.2), A(5.4, 8.2)], true, 0.08), '#fffdf0', { stroke: red, lw: 1 });
      c.line(`M${pt(A(5.2, 6.6))}L${pt(A(11.2, 6.4))}M${pt(A(7.4, 5))}L${pt(A(7.4, 8.2))}M${pt(A(9.4, 4.8))}L${pt(A(9.4, 8.2))}`, '#b89aa0', 0.6);
      break;
    }
    default: {
      // grin / open / talk / shout: open mouth sizes
      const s = m === 'shout' ? 1.5 : m === 'open' ? 1.15 : m === 'talk' ? 0.9 : 1;
      const pts = m === 'grin'
        ? [A(4.8, 5), A(11.8, 4.2), A(10.4, 8.6), A(6.4, 8.8)]
        : [A(5.6, 5.2), A(11, 5), A(10.4, 6 + 3.4 * s), A(6.4, 6 + 3.2 * s)];
      c.flat(smooth(pts, true, 0.14), dark, { stroke: red, lw: 0.9 });
      if (m !== 'talk') teeth(m === 'grin' ? 3.2 : 2.4, m === 'grin' ? 4.9 : 5.3);
      if (m === 'shout' || m === 'open') c.flat(ell(A(8.4, 6.4 + 2.6 * s), 1.8, 1), '#e2667f');
    }
  }
}

// ── small held items (big props are procedural in art.js) ────────────────────
function items(c, J, p) {
  const h = J.hF, a = J.aF;
  if (p.item === 'knit') {
    const hb = J.hB;
    c.line(`M${pt(add(hb, [-4, 4]))}L${pt(add(h, [5, -7]))}`, '#e4d6a8', 1.4);
    c.line(`M${pt(add(h, [-6, 4]))}L${pt(add(hb, [6, -7]))}`, '#e4d6a8', 1.4);
    const mid = lerp2(h, hb, 0.5);
    c.part(smooth([add(mid, [-5, -1]), add(mid, [5, -2]), add(mid, [6, 7]), add(mid, [0, 9]), add(mid, [-6, 7])], true, 0.12), 'knit', {
      lw: 1.6, inner: () => [0, 3, 6].map((dy) => `<path d="M${pt(add(mid, [-5, dy]))}L${pt(add(mid, [5, dy - 1]))}" stroke="${MAT.knit[1]}" stroke-width="0.8" stroke-dasharray="1.4 1"/>`).join(''),
    });
  } else if (p.item === 'spray') {
    const L = (x, y) => add(h, rot(x, y, a - Math.PI / 2));
    c.part(smooth([L(-3, -2), L(3, -2), L(3, 12), L(-3, 12)], true, 0.04), 'can', { lw: 1.8 });
    c.part(poly([L(-1.6, 12), L(1.6, 12), L(1.2, 15.4), L(-1.2, 15.4)]), [ '#ffffff', '#c8ccd8' ], { lw: 1.2 });
    c.line(`M${pt(L(-3, 4))}L${pt(L(3, 4))}`, '#ffffff', 1.1, { alpha: 0.8 });
  } else if (p.item === 'teeth') {
    c.part(smooth([add(h, [1, -3]), add(h, [8, -3.4]), add(h, [8.4, 1]), add(h, [1.4, 1.4])], true, 0.2), ['#ff9fb4', '#d06a86'], { lw: 1.4 });
    c.flat(poly([add(h, [2, -1]), add(h, [7.6, -1.2]), add(h, [7.4, 1]), add(h, [2.2, 1.2])]), '#fffdf0', { stroke: OUT, lw: 0.6 });
  } else if (p.item === 'tea') {
    const sb = add(J.hB, [1, -2.6]);
    c.part(ell(sb, 6.6, 1.6), 'tea', { lw: 1.4 });
    const cup = add(h, [2.6, -3]);
    c.part(smooth([add(cup, [-4, -3]), add(cup, [4, -3]), add(cup, [3, 3]), add(cup, [-3, 3])], true, 0.15), 'tea', {
      lw: 1.5, inner: () => `<path d="M${pt(add(cup, [-3.6, -0.4]))}L${pt(add(cup, [3.6, -0.4]))}" stroke="#7fb8e8" stroke-width="1.2"/>`,
    });
    c.flat(ell(add(cup, [4.8, -0.2]), 1.6, 1.8), 'none', { stroke: OUT, lw: 1 });
  }
}

/** Paints one frame (seat-relative body px) into the canvas. */
function paintFrame(c, p, pi) {
  const J = joints(p);
  arm(c, J.shB, J.elB, J.hB, J.aB, p.Bh, true);
  leg(c, J, p, true);
  leg(c, J, p, false);
  skirt(c, p);
  torso(c, J, p);
  head(c, J, p, pi);
  // pearl necklace sits over the collar
  const L = p.lean * D;
  const neckAt = (t) => add(J.top, rot(-2 + t * 9, 1.5 + Math.sin(t * Math.PI) * 4.4, L));
  for (let i = 0; i <= 6; i++) c.flat(circ(neckAt(i / 6), 1.05), '#fffaf0', { stroke: '#9a7e90', lw: 0.5 });
  arm(c, J.shF, J.elF, J.hF, J.aF, p.Fh, false);
  items(c, J, p);
}

function gradients() {
  return Object.entries(MAT).map(([k, [, , l]]) => `<linearGradient id="L${k}" x1="0" y1="0" x2="0.75" y2="0.9"><stop offset="0" stop-color="${l}" stop-opacity="0.75"/><stop offset="0.38" stop-color="${l}" stop-opacity="0"/></linearGradient>`).join('')
    + '<linearGradient id="Lx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="0.4" stop-color="#fff" stop-opacity="0"/></linearGradient>';
}

/** Standalone SVG for one painted frame (w × h source px, `origin` = where body (0, 0) lands). */
function frameSvg(w, h, origin, paintFn) {
  styles.map.clear(); styles.n = 0; styles.uid = 0;
  const c = canvas();
  paintFn(c);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs>${styleSheet()}${gradients()}${c.defs.join('')}</defs>`
    + `<g transform="translate(${origin[0]} ${origin[1]}) scale(2)">${c.body.join('')}</g></svg>`;
}

/** Body frames: one SVG per POSES entry (FRAME.w × FRAME.h, hip at FRAME.anchor, painted at 2×). */
export function bodyFrames() {
  return POSES.map((p, i) => frameSvg(FRAME.w, FRAME.h, FRAME.anchor, (c) => paintFrame(c, p, i)));
}

/** Dentures: 4 frames (closed → open → wide → open), TEETH.w × TEETH.h at 2×, centered. */
export function teethFrames() {
  const gum = ['#ff9fb4', '#cf5f80', '#ffd0dc'];
  return Array.from({ length: TEETH.frames }, (_, i) => frameSvg(TEETH.w, TEETH.h, [TEETH.w / 2, TEETH.h / 2], (c) => {
    const o = [0, 3, 6, 3][i] / 2;
    c.part(smooth([[-9, -1 - o], [-7, -7 - o], [7, -7 - o], [9.5, -1 - o], [6, -o], [-6, -o]], true, 0.14), gum, { lw: 1.8 });
    for (let t = 0; t < 6; t++) c.flat(smooth([[-7 + t * 2.4, -1.2 - o], [-5 + t * 2.4, -1.2 - o], [-5.3 + t * 2.4, 2 - o], [-6.7 + t * 2.4, 2 - o]], true, 0.2), '#fffdf0', { stroke: OUT, lw: 0.7 });
    c.part(smooth([[-8.4, 2 + o], [8.6, 2 + o], [6.8, 7.6 + o], [-6.6, 7.6 + o]], true, 0.14), gum, { lw: 1.8 });
    for (let t = 0; t < 5; t++) c.flat(smooth([[-6 + t * 2.5, 2.6 + o], [-4 + t * 2.5, 2.6 + o], [-4.2 + t * 2.5, -0.4 + o], [-5.8 + t * 2.5, -0.4 + o]], true, 0.2), '#fffdf0', { stroke: OUT, lw: 0.7 });
    c.flat(circ([-5.6, -5 - o], 0.9), '#ffffff', { alpha: 0.9 });
  }));
}

/**
 * Browser only: rasterizes every frame into the two sheet canvases (gertie.png layout:
 * FRAME.cols per row; teeth.png: one row). Frames are decoded one by one — a single
 * giant SVG decodes far too slowly as an <img>.
 */
export async function rasterizeSheets(doc) {
  const draw = async (svgs, w, h, cols) => {
    const cv = doc.createElement('canvas');
    cv.width = cols * w; cv.height = Math.ceil(svgs.length / cols) * h;
    const g = cv.getContext('2d');
    for (const [i, svg] of svgs.entries()) {
      const img = doc.createElement('img');
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await img.decode();
      g.drawImage(img, (i % cols) * w, Math.floor(i / cols) * h, w, h);
    }
    return cv;
  };
  return { body: await draw(bodyFrames(), FRAME.w, FRAME.h, FRAME.cols), teeth: await draw(teethFrames(), TEETH.w, TEETH.h, TEETH.frames) };
}

/** Browser only: rasterize and download gertie.png + teeth.png (see the header). */
export async function downloadSheets(doc) {
  const { body, teeth } = await rasterizeSheets(doc);
  for (const [name, cv] of [['gertie.png', body], ['teeth.png', teeth]]) {
    const a = doc.createElement('a');
    a.download = name; a.href = cv.toDataURL('image/png');
    a.click();
  }
}
