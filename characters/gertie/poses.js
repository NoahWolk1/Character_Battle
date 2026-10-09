// characters/gertie/poses.js — Gertie's pose table: one entry per sprite-sheet frame.
// Single source of truth for BOTH the painted sheet (sheet-svg.js renders it into
// gertie.svg) and the live art (art.js reads hand sockets to attach the procedural
// props: cane, handbag, umbrella, hat pin, rolling pin, grabber).
//
// Units are body px (≈ u), seat-relative: (0, 0) is her hip on the scooter seat,
// +x forward, +y down. Angles in degrees; `lean` > 0 tips her torso forward.
// Arms are solved with 2-bone IK from hand targets F (near arm) / B (far arm).

/** Sprite frame layout (source px, painted at 2× body px). */
export const FRAME = Object.freeze({ w: 220, h: 224, cols: 10, anchor: Object.freeze([76, 148]), scale: 0.5 });
/** Dentures sheet: 4 frames (closed → open → wide → open), centered, painted at 2×. */
export const TEETH = Object.freeze({ w: 48, h: 48, frames: 4 });
/** Hip on the seat, in scooter space (level scooter, feet origin). */
export const SEAT = Object.freeze({ x: -16, y: -48 });
/** Handlebar grip, seat-relative. */
export const BAR = Object.freeze([36, -16]);
export const BONES = Object.freeze({ torso: 30, neck: 5, head: 12, upper: 15, fore: 15 });

const BASE = Object.freeze({
  lean: 6, tilt: 0, hx: 0, hy: 0,
  F: BAR, Fh: 'grip', B: [BAR[0] - 2, BAR[1] + 1], Bh: 'grip', Fbend: 0, Bbend: 0,
  knee: [17, -1], ankle: [23, 25],
  eyes: 'open', mouth: 'smile', brows: 'calm', blush: 0.55, hair: 0, item: null, hatpin: true,
});
const P = (o) => Object.freeze({ ...BASE, ...o });
const LAP = [10, -4];

// prettier-ignore
export const POSES = Object.freeze([
  /* 0  idle      */ P({}),
  /* 1  idle      */ P({ lean: 7, tilt: -3, B: [LAP[0] + 2, LAP[1] - 2], Bh: 'open', hair: 0.4 }),
  /* 2  idle      */ P({ lean: 5, tilt: 3, B: LAP, Bh: 'open', mouth: 'smug', hair: -0.3 }),
  /* 3  idle blink*/ P({ lean: 6, tilt: 1, eyes: 'closed' }),
  /* 4  run       */ P({ lean: 16, tilt: -4, hair: -2, eyes: 'squint', mouth: 'grin' }),
  /* 5  run       */ P({ lean: 18, tilt: -6, hair: -2.6, hy: 1, eyes: 'squint', mouth: 'grin' }),
  /* 6  run       */ P({ lean: 16, tilt: -3, hair: -2.2, eyes: 'open', mouth: 'open' }),
  /* 7  run       */ P({ lean: 17, tilt: -5, hair: -2.8, hy: 1, eyes: 'squint', mouth: 'grin' }),
  /* 8  jump      */ P({ lean: -6, tilt: -8, hair: 2, eyes: 'wide', mouth: 'o', knee: [16, -4], ankle: [22, 20] }),
  /* 9  fall      */ P({ lean: 4, tilt: -4, hair: -3, eyes: 'open', mouth: 'open', B: 'hat', Bh: 'open', brows: 'up' }),
  /* 10 glide     */ P({ lean: 0, tilt: -6, F: [8, -58], B: [4, -54], eyes: 'closed', mouth: 'smile', hair: -1, knee: [16, 0], ankle: [20, 24] }),
  /* 11 glide     */ P({ lean: 2, tilt: -3, F: [10, -57], B: [6, -53], eyes: 'closed', mouth: 'smug', hair: -1.4, knee: [16, 0], ankle: [21, 25] }),
  /* 12 hurt      */ P({ lean: -14, tilt: -14, F: [22, -44], Fh: 'open', B: [-18, -38], Bh: 'open', eyes: 'squint', mouth: 'shout', brows: 'up', hair: 3, blush: 0.2, knee: [17, -5], ankle: [26, 16] }),
  /* 13 tumble    */ P({ lean: -20, tilt: -18, F: [-6, -56], Fh: 'open', B: [26, -36], Bh: 'open', eyes: 'x', mouth: 'open', brows: 'up', hair: 3, knee: [16, -8], ankle: [27, 8] }),
  /* 14 tumble    */ P({ lean: -8, tilt: 10, F: [30, -38], Fh: 'open', B: [-12, -50], Bh: 'open', eyes: 'x', mouth: 'shout', brows: 'up', hair: -3, knee: [18, -2], ankle: [22, 22] }),
  /* 15 shield    */ P({ lean: -4, tilt: 4, F: [24, -34], B: [20, -30], eyes: 'angry', mouth: 'frown', brows: 'angry' }),
  /* 16 crouch    */ P({ lean: 18, tilt: 10, hy: 2, F: [32, -12], B: [30, -11], eyes: 'squint', mouth: 'frown', brows: 'angry' }),
  /* 17 grabbing  */ P({ lean: 14, tilt: 2, F: [36, -28], Fh: 'grip', eyes: 'squint', mouth: 'grin', brows: 'angry', blush: 0.9 }),
  /* 18 lecture   */ P({ lean: 4, tilt: -4, F: [22, -44], Fh: 'point', B: LAP, Bh: 'open', eyes: 'squint', mouth: 'talk', brows: 'angry' }),
  /* 19 lecture   */ P({ lean: 6, tilt: 2, F: [26, -40], Fh: 'point', B: LAP, Bh: 'open', eyes: 'squint', mouth: 'open', brows: 'angry' }),
  /* 20 jab s     */ P({ lean: 2, F: [6, -18], Fh: 'grip', eyes: 'angry', mouth: 'frown', brows: 'angry' }),
  /* 21 jab a     */ P({ lean: 14, tilt: 4, F: [40, -26], Fh: 'grip', eyes: 'angry', mouth: 'shout', brows: 'angry' }),
  /* 22 jab r     */ P({ lean: 10, F: [30, -20], Fh: 'grip', eyes: 'open', mouth: 'grin', brows: 'angry' }),
  /* 23 cane s1   */ P({ lean: -4, tilt: -2, F: [-10, -36], Fh: 'grip', eyes: 'angry', mouth: 'grit', brows: 'angry' }),
  /* 24 cane s2   */ P({ lean: -10, tilt: -6, F: [-16, -44], Fh: 'grip', eyes: 'angry', mouth: 'grit', brows: 'angry', hair: 1 }),
  /* 25 cane a    */ P({ lean: 20, tilt: 6, F: [40, -22], Fh: 'grip', eyes: 'angry', mouth: 'shout', brows: 'angry', hair: -2 }),
  /* 26 cane r1   */ P({ lean: 16, tilt: 4, F: [36, -12], Fh: 'grip', eyes: 'open', mouth: 'open', brows: 'angry', hair: -1 }),
  /* 27 cane r2   */ P({ lean: 10, F: [28, -16], Fh: 'grip', eyes: 'squint', mouth: 'smug' }),
  /* 28 hatpin s  */ P({ lean: 0, tilt: -4, F: 'hat', Fh: 'pinch', eyes: 'angry', mouth: 'smug', brows: 'angry', hatpin: false }),
  /* 29 hatpin a  */ P({ lean: -4, tilt: -16, F: [6, -66], Fh: 'grip', eyes: 'angry', mouth: 'shout', brows: 'angry', hatpin: false, hair: 1 }),
  /* 30 hatpin r  */ P({ lean: 0, tilt: -8, F: [10, -58], Fh: 'grip', eyes: 'squint', mouth: 'smug', hatpin: false }),
  /* 31 knit s    */ P({ lean: 10, tilt: 12, F: [22, -16], Fh: 'pinch', B: [16, -12], Bh: 'pinch', eyes: 'squint', mouth: 'smile', item: 'knit' }),
  /* 32 knit a    */ P({ lean: 12, tilt: 14, F: [28, -20], Fh: 'pinch', B: [12, -10], Bh: 'pinch', eyes: 'closed', mouth: 'grin', item: 'knit' }),
  /* 33 knit r    */ P({ lean: 8, tilt: 8, F: [22, -14], Fh: 'pinch', B: [16, -12], Bh: 'pinch', eyes: 'closed', mouth: 'smug', item: 'knit' }),
  /* 34 bag s1    */ P({ lean: -6, tilt: -2, F: [-8, -38], Fh: 'grip', eyes: 'angry', mouth: 'grit', brows: 'angry' }),
  /* 35 bag s2    */ P({ lean: -14, tilt: -6, F: [-18, -48], Fh: 'grip', eyes: 'angry', mouth: 'grit', brows: 'angry', hair: 1.4, blush: 1 }),
  /* 36 bag a     */ P({ lean: 24, tilt: 8, F: [42, -30], Fh: 'grip', eyes: 'angry', mouth: 'shout', brows: 'angry', hair: -2.4 }),
  /* 37 bag r1    */ P({ lean: 20, tilt: 6, F: [34, -6], Fh: 'grip', eyes: 'open', mouth: 'open', brows: 'angry', hair: -1.4 }),
  /* 38 bag r2    */ P({ lean: 10, F: [24, -12], Fh: 'grip', eyes: 'squint', mouth: 'smug' }),
  /* 39 umb s     */ P({ lean: 4, tilt: 2, F: [16, -28], Fh: 'grip', B: [14, -22], Bh: 'grip', eyes: 'angry', mouth: 'grit', brows: 'angry' }),
  /* 40 umb a     */ P({ lean: -2, tilt: -14, F: [10, -60], Fh: 'grip', B: [8, -50], Bh: 'grip', eyes: 'squint', mouth: 'shout', brows: 'angry', hair: 1.5 }),
  /* 41 umb r     */ P({ lean: 0, tilt: -8, F: [12, -54], Fh: 'grip', B: [10, -46], Bh: 'grip', eyes: 'squint', mouth: 'grin' }),
  /* 42 stomp s   */ P({ lean: -10, tilt: -4, eyes: 'angry', mouth: 'grit', brows: 'angry', knee: [15, -14], ankle: [24, 6], hair: 1 }),
  /* 43 stomp a   */ P({ lean: 14, tilt: 8, eyes: 'squint', mouth: 'shout', brows: 'angry', hair: 3, hy: 2 }),
  /* 44 stomp r   */ P({ lean: 8, tilt: 2, eyes: 'open', mouth: 'smug', brows: 'angry' }),
  /* 45 wheelie   */ P({ lean: -14, tilt: -8, eyes: 'squint', mouth: 'grin', hair: 2, blush: 1, knee: [16, -4], ankle: [23, 22] }),
  /* 46 pin s     */ P({ lean: -10, tilt: -8, F: [-2, -58], Fh: 'grip', eyes: 'angry', mouth: 'grit', brows: 'angry', hair: 1 }),
  /* 47 pin a     */ P({ lean: 22, tilt: 8, F: [38, -28], Fh: 'grip', eyes: 'angry', mouth: 'shout', brows: 'angry', hair: -2 }),
  /* 48 pin r     */ P({ lean: 14, tilt: 4, F: [32, -14], Fh: 'grip', eyes: 'squint', mouth: 'smug' }),
  /* 49 exhaust   */ P({ lean: -4, tilt: -6, B: [-12, -40], Bh: 'point', eyes: 'squint', mouth: 'smug', brows: 'up', blush: 0.9 }),
  /* 50 spray s   */ P({ lean: 2, tilt: -6, F: [18, -42], Fh: 'grip', item: 'spray', eyes: 'squint', mouth: 'smug' }),
  /* 51 spray a   */ P({ lean: -4, tilt: -16, F: [10, -64], Fh: 'grip', item: 'spray', eyes: 'squint', mouth: 'o', hair: 1 }),
  /* 52 slam      */ P({ lean: 18, tilt: 6, hair: 4, eyes: 'wide', mouth: 'shout', brows: 'up', knee: [17, -3], ankle: [24, 23] }),
  /* 53 toss s    */ P({ lean: 4, tilt: 6, F: 'mouth', Fh: 'pinch', item: 'teeth', eyes: 'squint', mouth: 'gum', brows: 'angry' }),
  /* 54 toss a    */ P({ lean: 16, tilt: 2, F: [40, -40], Fh: 'open', eyes: 'squint', mouth: 'gum', brows: 'angry', hair: -1.5 }),
  /* 55 toss r    */ P({ lean: 8, tilt: -2, F: [28, -28], Fh: 'open', eyes: 'squint', mouth: 'gumgrin', blush: 1 }),
  /* 56 ram s     */ P({ lean: 22, tilt: 8, hy: 1, eyes: 'angry', mouth: 'grit', brows: 'angry', hair: -2 }),
  /* 57 ram a     */ P({ lean: 26, tilt: 6, hy: 1, eyes: 'angry', mouth: 'shout', brows: 'angry', hair: -4 }),
  /* 58 ram r     */ P({ lean: 12, tilt: 0, eyes: 'squint', mouth: 'grin', hair: -1.5, blush: 1 }),
  /* 59 sputter   */ P({ lean: 12, tilt: 10, F: [34, -30], Fh: 'open', eyes: 'angry', mouth: 'frown', brows: 'angry', blush: 1 }),
  /* 60 lift s    */ P({ lean: 2, tilt: -8, F: [12, -48], B: [10, -40], eyes: 'angry', mouth: 'grit', brows: 'angry' }),
  /* 61 tea s     */ P({ lean: 2, tilt: 4, F: [20, -26], Fh: 'grip', B: [18, -18], Bh: 'open', item: 'tea', eyes: 'squint', mouth: 'smile' }),
  /* 62 tea hold  */ P({ lean: -2, tilt: -6, F: 'sip', Fh: 'grip', B: [18, -20], Bh: 'open', item: 'tea', eyes: 'closed', mouth: 'sip', blush: 0.9 }),
  /* 63 tea hold  */ P({ lean: -3, tilt: -8, F: 'sip', Fh: 'grip', B: [18, -21], Bh: 'open', item: 'tea', eyes: 'closed', mouth: 'sip', blush: 1, hy: -0.5 }),
  /* 64 grab s    */ P({ lean: 6, tilt: 2, F: [26, -24], Fh: 'grip', eyes: 'squint', mouth: 'smug', brows: 'angry' }),
  /* 65 grab a    */ P({ lean: 18, tilt: 4, F: [42, -30], Fh: 'grip', eyes: 'wide', mouth: 'grin', blush: 1 }),
  /* 66 grab r    */ P({ lean: 10, F: [30, -22], Fh: 'grip', eyes: 'open', mouth: 'frown', brows: 'up' }),
  /* 67 pinch     */ P({ lean: 16, tilt: 6, F: [40, -32], Fh: 'grip', B: [34, -40], Bh: 'pinch', eyes: 'squint', mouth: 'grin', blush: 1 }),
  /* 68 shoo s    */ P({ lean: 4, F: [20, -26], Fh: 'open', B: [16, -22], Bh: 'open', eyes: 'angry', mouth: 'frown', brows: 'angry' }),
  /* 69 shoo a    */ P({ lean: 20, tilt: 6, F: [42, -32], Fh: 'open', B: [38, -26], Bh: 'open', eyes: 'squint', mouth: 'shout', brows: 'angry', hair: -2 }),
  /* 70 shoulder s*/ P({ lean: 8, F: [30, -30], Fh: 'grip', B: [26, -26], Bh: 'grip', eyes: 'angry', mouth: 'grit', brows: 'angry' }),
  /* 71 shoulder a*/ P({ lean: -18, tilt: -10, F: [-26, -40], Fh: 'open', B: [-22, -44], Bh: 'open', eyes: 'squint', mouth: 'shout', brows: 'angry', hair: 2 }),
  /* 72 upyougo s */ P({ lean: 10, F: [28, -18], Fh: 'grip', B: [24, -14], Bh: 'grip', eyes: 'angry', mouth: 'grit', brows: 'angry' }),
  /* 73 upyougo a */ P({ lean: -6, tilt: -16, F: [14, -64], Fh: 'open', B: [8, -60], Bh: 'open', eyes: 'squint', mouth: 'shout', hair: 1.5 }),
  /* 74 sitdown s */ P({ lean: 2, tilt: -2, F: [26, -44], Fh: 'point', eyes: 'angry', mouth: 'frown', brows: 'angry' }),
  /* 75 sitdown a */ P({ lean: 20, tilt: 10, F: [38, -8], Fh: 'point', eyes: 'angry', mouth: 'shout', brows: 'angry', hair: -1 }),
  /* 76 dizzy     */ P({ lean: -6, tilt: 12, F: [22, -12], Fh: 'open', B: [14, -6], Bh: 'open', eyes: 'spiral', mouth: 'gumgrin', brows: 'up', hair: 1 }),
  /* 77 portrait  */ P({ lean: 6, tilt: -2, F: [24, -44], Fh: 'point', eyes: 'squint', mouth: 'grin', brows: 'calm', blush: 0.9 }),
]);

const D = Math.PI / 180;
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const add = (p, q) => [p[0] + q[0], p[1] + q[1]];

/** 2-bone IK: elbow for shoulder s → hand target t. bend +1 = elbow on the clockwise side. */
export function ik(s, t, a, b, bend) {
  let dx = t[0] - s[0], dy = t[1] - s[1];
  let d = Math.hypot(dx, dy) || 1e-6;
  const max = a + b - 0.01;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  const base = Math.atan2(dy, dx);
  const off = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
  const sg = bend || (dx < -2 ? -1 : 1);
  const e = [s[0] + Math.cos(base + sg * off) * a, s[1] + Math.sin(base + sg * off) * a];
  return { elbow: e, hand: [s[0] + dx, s[1] + dy] };
}

/**
 * Joint positions (seat-relative body px) for a pose. Used by the sheet painter and
 * by art.js to attach props: hF/hB = hands, aF/aB = forearm angles (rad).
 */
export function joints(p) {
  const L = p.lean * D;
  const top = rot(0, -BONES.torso, L);
  const shF = add(top, rot(2.5, 3, L));
  const shB = add(top, rot(-3.5, 2, L));
  const headRot = L * 0.45 + p.tilt * D;
  const head = add(add(top, rot(3, -(BONES.neck + BONES.head), L)), [p.hx, p.hy]);
  const at = (q) => add(head, rot(q[0], q[1], headRot));
  const mouth = at([8, 6.5]);
  const named = { hat: at([2, -18]), mouth: at([8.5, 6]), sip: at([10, 4]) };
  const tgt = (v) => (typeof v === 'string' ? named[v] : v);
  const f = ik(shF, tgt(p.F), BONES.upper, BONES.fore, p.Fbend);
  const b = ik(shB, tgt(p.B), BONES.upper, BONES.fore, p.Bbend);
  const ang = (e, h) => Math.atan2(h[1] - e[1], h[0] - e[0]);
  return {
    hip: [0, 0], top, shF, shB, head, headRot, mouth,
    elF: f.elbow, hF: f.hand, aF: ang(f.elbow, f.hand),
    elB: b.elbow, hB: b.hand, aB: ang(b.elbow, b.hand),
    knee: p.knee, ankle: p.ankle,
  };
}
