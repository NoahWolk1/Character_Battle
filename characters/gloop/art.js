// Gloop art: a soft-body lab gel (rig: none). The body is a spring blob
// (shared/art/helpers/blob.js) that flows between the current hurtbox sets, so
// Blob → Puddle → Spike morphs and mass growth animate for free. Every attack grows
// pseudopods straight out of the move's REAL hitboxes (a bud in startup, full reach
// on active frames, a gooey retract in recovery), and the body + pods are painted
// as one material by gel.js: 3 value tiers, subsurface glow, rim light from the
// stage, a floating face, bubbles, a mass nucleus and a swallowed lab bolt.
import * as kit from '../../shared/art/kit.js';
import { blob } from '../../shared/art/helpers/blob.js';
import {
  PAL, ALT_PALETTES, TAU, clamp, lerp, easeOut, easeIn, hash, formPalette, boxOf,
  smoothPath, taperPath, spinePath, ballPts, slabPts, paintUnion, gelDrop,
  bubbles, nucleus, bolt, morsel, eyes, mouth, spikes,
} from './gel.js';

const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wob = (t, f, ph = 0) => Math.sin(t * f + ph);

/** Light direction in body space (the engine mirrors draw() by facing). */
function bodyLight(info, facing) {
  const d = info.light?.dir || { x: -0.45, y: -0.89 };
  const x = d.x * (facing < 0 ? -1 : 1), y = d.y, n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n, rim: info.light?.rim || '#ffc48a' };
}

/** Critically-damped-ish spring held in the cache (frame-rate independent). */
function spring(s, target, dt, k = 170, d = 15) {
  if (!s.init) { s.x = target; s.v = 0; s.init = true; return s.x; }
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) { s.v += (k * (target - s.x) - d * s.v) * h; s.x += s.v * h; }
  return s.x;
}
const sp = () => ({ x: 0, v: 0, init: false });

function ensure(c) {
  if (c.gel) return;
  c.gel = blob.create({ points: 30, stiffness: 0.2, damping: 0.8, seed: 3 });
  c.fx = sp(); c.fy = sp(); c.lean = sp();
  c.lastT = null; c.lastMass = null; c.morsel = 0; c.crawl = 'side'; c.prevForm = null; c.morph = 0;
}

// ── Shapes ───────────────────────────────────────────────────────────────────
function scaleShape(s, k) {
  const t = kit.shapeKind(s);
  if (t === 'circle') return { shape: t, x: s.x * k, y: s.y * k, r: s.r * k };
  if (t === 'capsule') return { shape: t, x1: s.x1 * k, y1: s.y1 * k, x2: s.x2 * k, y2: s.y2 * k, r: s.r * k };
  return { shape: t, x: s.x * k, y: s.y * k, w: s.w * k, h: s.h * k };
}
function shapesBox(list) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const s of list) {
    const t = kit.shapeKind(s);
    let b;
    if (t === 'circle') b = [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r];
    else if (t === 'capsule') b = [Math.min(s.x1, s.x2) - s.r, Math.min(s.y1, s.y2) - s.r, Math.max(s.x1, s.x2) + s.r, Math.max(s.y1, s.y2) + s.r];
    else b = [s.x - s.w / 2, s.y - s.h / 2, s.x + s.w / 2, s.y + s.h / 2];
    x1 = Math.min(x1, b[0]); y1 = Math.min(y1, b[1]); x2 = Math.max(x2, b[2]); y2 = Math.max(y2, b[3]);
  }
  if (!Number.isFinite(x1)) return { x1: -30, y1: -66, x2: 30, y2: 0, cx: 0, cy: -33, w: 60, h: 66 };
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 };
}

// ── Pose ─────────────────────────────────────────────────────────────────────
function newPose() {
  return {
    sx: 1, sy: 1, dx: 0, dy: 0, lean: 0, dirA: 0, dirS: 1, dirP: 1,   // body-only transform
    rot: 0, flipY: false, gx: 0, gy: 0, pivot: null, alpha: 1,          // whole-figure transform
    ball: 0, wobble: 0.7, stiff: 0.2, impulse: 1,
    expr: 'normal', mouth: 'smile', open: 0.6, look: null, faceScale: 1, faceDx: 0, faceDy: 0,
    pods: [], podsE: 0, spikeLen: 1, glint: 0, stars: 0, sweat: 0, shimmer: 0, glow: 0, bubbleRate: 1,
    back: [], front: [], hold: null,
  };
}

/** Pseudopods grown from the move's real hit shapes (anticipation → reach → retract). */
function podsFor(v, info, o, body, spiky) {
  const m = v.move;
  if (!m?.def || v.state === 'hitstun') return;
  const k = v.bodyScale || 1;
  const hb = (m.def.hitboxes || []).filter((h) => h.kind !== 'wind');
  if (!hb.length) return;
  let shapes = null, e = 0;
  if (m.phase === 'active') {
    shapes = info.hitboxes.length ? info.hitboxes : null;
    if (!shapes) {
      let last = -1;
      for (const h of hb) if (h.end < m.frame) last = Math.max(last, h.end);
      shapes = hb.filter((h) => h.end === last).map((h) => scaleShape(h, k));
    }
    e = 1;
  } else if (m.phase === 'recovery') {
    const last = Math.max(...hb.map((h) => h.end));
    shapes = hb.filter((h) => h.end === last).map((h) => scaleShape(h, k));
    e = 1 - easeOut(clamp(m.phaseT * 1.45, 0, 1));
  } else {
    const first = Math.min(...hb.map((h) => h.start));
    shapes = hb.filter((h) => h.start === first).map((h) => scaleShape(h, k));
    e = (m.phase === 'startup' ? easeIn(m.phaseT) : 1) * 0.3;
  }
  o.podsE = e;
  if (e < 0.03) return;
  shapes.forEach((s, i) => { const p = makePod(s, e, body, spiky, info.time, i); if (p) o.pods.push(p); });
}

function makePod(s, e, body, spiky, t, i) {
  const t0 = kit.shapeKind(s), C = { x: body.cx, y: body.cy }, R = Math.max(10, Math.min(body.w, body.h) / 2);
  const jig = 1 + 0.05 * wob(t, 17, i * 2);
  if (t0 === 'rect' && s.w >= s.h * 2) {                         // a sweeping slab of goo
    const bottom = s.y + s.h / 2, h = s.h * lerp(0.55, 1, e) * jig;
    if (Math.abs(s.x - C.x) < s.w * 0.25) {
      const hw = (s.w / 2) * lerp(0.3, 1, e);
      return { type: 'slab', x1: s.x - hw, x2: s.x + hw, bottom, h, e };
    }
    const dir = s.x >= C.x ? 1 : -1, near = s.x - dir * s.w / 2;
    const far = near + dir * s.w * e;
    return { type: 'slab', x1: Math.min(near, far), x2: Math.max(near, far), bottom, h, e };
  }
  let cs = s;
  if (t0 === 'rect') cs = { shape: 'circle', x: s.x, y: s.y, r: Math.min(s.w, s.h) * 0.45 };
  if (kit.shapeKind(cs) === 'circle') {
    const d = Math.hypot(cs.x - C.x, cs.y - C.y);
    if (d < R * 0.75) return { type: 'ball', x: lerp(C.x, cs.x, e), y: lerp(C.y, cs.y, e), r: lerp(R * 0.85, cs.r, e) * jig, e, spiky };
    const ux = (cs.x - C.x) / d, uy = (cs.y - C.y) / d;
    const x1 = C.x + ux * R * 0.35, y1 = C.y + uy * R * 0.35;
    return {
      type: spiky ? 'spine' : 'reach', x1, y1, r1: Math.min(R * 0.62, cs.r * 1.05),
      x2: lerp(x1, cs.x, e), y2: lerp(y1, cs.y, e), r2: cs.r * lerp(0.5, 1, e) * jig, e, ux, uy, ext: cs.r * 0.9, spiky,
    };
  }
  // capsule
  const mx = (cs.x1 + cs.x2) / 2, my = (cs.y1 + cs.y2) / 2;
  if (Math.hypot(mx - C.x, my - C.y) < R * 0.6) {
    const f = lerp(0.45, 1, e);
    return { type: 'cap', x1: lerp(C.x, cs.x1, f), y1: lerp(C.y, cs.y1, f), x2: lerp(C.x, cs.x2, f), y2: lerp(C.y, cs.y2, f), r: cs.r * lerp(0.7, 1, e) * jig, e };
  }
  const d1 = Math.hypot(cs.x1 - C.x, cs.y1 - C.y), d2 = Math.hypot(cs.x2 - C.x, cs.y2 - C.y);
  const [nx, ny, fx, fy] = d1 <= d2 ? [cs.x1, cs.y1, cs.x2, cs.y2] : [cs.x2, cs.y2, cs.x1, cs.y1];
  const L = Math.hypot(fx - nx, fy - ny) || 1, ux = (fx - nx) / L, uy = (fy - ny) / L;
  const dn = Math.min(d1, d2);
  const x1 = dn > R * 0.5 ? C.x + ux * R * 0.5 : nx, y1 = dn > R * 0.5 ? C.y + uy * R * 0.5 : ny;
  return {
    type: spiky ? 'spine' : 'reach', x1, y1, r1: spiky ? cs.r * 1.5 : Math.min(R * 0.7, cs.r * 1.15),
    x2: lerp(x1, fx, e), y2: lerp(y1, fy, e), r2: cs.r * lerp(0.6, 1, e) * jig, e, ux, uy, ext: cs.r * 1.4, spiky,
  };
}

/** Direction of the move's first strike from the body center (unit vector). */
function hitDir(v, body) {
  const h = v.move?.def?.hitboxes?.[0];
  if (!h) return { x: 1, y: 0 };
  const c = kit.shapeCenter(h), k = v.bodyScale || 1;
  const dx = c.x * k - body.cx, dy = c.y * k - body.cy, d = Math.hypot(dx, dy);
  return d < 6 ? { x: 1, y: 0 } : { x: dx / d, y: dy / d };
}

/** Builds the frame's pose from state, move anim and phase. */
function buildPose(v, info, c, body, spiky) {
  const o = newPose();
  if (!v.clone) podsFor(v, info, o, body, spiky);
  const t = info.time, st = v.state, sf = v.stateFrame || 0, form = v.form || 'base';
  const bs = v.bodyScale || 1;
  const br = wob(t, 2.6);
  o.sy = 1 + 0.035 * br; o.sx = 1 - 0.028 * br;                    // breathing, always
  o.look = { x: 0.55 + Math.sin(t * 0.55) * 0.35 + (kit.noise1(t * 0.35, 9) > 0.8 ? -1.3 : 0), y: Math.sin(t * 0.4) * 0.3 };
  const bvx = (v.vx || 0) * (v.facing < 0 ? -1 : 1), bvy = v.vy || 0;
  const drip = (opts) => { if (!v.clone) info.fx.local.drip(opts); };

  switch (st) {
    case 'idle':
      if (kit.noise1(t * 0.25, 4) > 0.86) { o.expr = 'happy'; o.mouth = 'grin'; }
      o.lean = 0.04 * wob(t, 1.3);
      break;
    case 'run': {
      const hop = Math.abs(Math.sin(t * 9.5));
      o.sy = 0.9 + 0.16 * hop; o.sx = 1.08 - 0.1 * hop; o.lean = 0.2; o.dy = -3 * hop * bs;
      o.look = { x: 1, y: 0.1 }; o.mouth = 'grin'; o.bubbleRate = 1.8;
      drip({ x: -22, y: -8, rate: 0.09, color: info.palette.main, speed: [0.3, 1], angle: 160, life: [18, 28], size: [2.5, 4] });
      break;
    }
    case 'jumpsquat': o.sx = 1.2; o.sy = 0.78; o.expr = 'focus'; o.look = { x: 0.6, y: -0.6 }; break;
    case 'air': case 'helpless': {
      const up = clamp(-bvy * 0.02, 0, 0.22), down = clamp(bvy * 0.012, 0, 0.12);
      o.sy *= 1 + up + down; o.sx *= 1 - (up + down) * 0.65;
      o.lean = clamp(bvx * 0.025, -0.15, 0.15);
      o.look = { x: 0.5, y: bvy < 0 ? -0.7 : 0.6 };
      if (bvy > 6) { o.mouth = 'o'; o.open = 0.4; }
      if (st === 'helpless') { o.expr = 'dizzy'; o.mouth = 'wavy'; o.sweat = 1; o.alpha = 0.92; o.rot = 0.12 * wob(t, 3); }
      break;
    }
    case 'land': { const q = clamp(1 - sf / 7, 0, 1); o.sx *= 1 + 0.26 * q; o.sy *= 1 - 0.26 * q; o.expr = q > 0.5 ? 'squint' : 'normal'; break; }
    case 'crouch': o.look = { x: 0.7, y: 0.5 }; o.expr = 'squint'; o.mouth = 'flat'; o.sy *= 0.96; break;
    case 'shield': o.sx *= 1.06; o.sy *= 0.9; o.expr = 'squint'; o.mouth = 'flat'; o.shimmer = 0.6; o.wobble = 0.3; break;
    case 'roll': {
      const k = clamp(sf / 20, 0, 1);
      o.ball = 1; o.rot = easeOut(k) * TAU; o.expr = 'closed'; o.mouth = 'flat'; o.stiff = 0.35;
      break;
    }
    case 'spotdodge': { const k = Math.sin(Math.PI * clamp(sf / 20, 0, 1)); o.sy *= 1 - 0.62 * k; o.sx *= 1 + 0.5 * k; o.expr = 'closed'; o.mouth = 'flat'; o.alpha = 1 - 0.25 * k; break; }
    case 'airdodge': o.ball = 0.8; o.alpha = 0.5 + 0.15 * wob(t, 30); o.shimmer = 1; o.expr = 'closed'; o.mouth = 'flat'; o.rot = 0.4 * wob(t, 8); break;
    case 'hitstun': {
      o.expr = sf < 10 ? 'hurt' : 'shock'; o.mouth = 'o'; o.open = 0.8; o.wobble = 2.6; o.stiff = 0.14;
      const spd = Math.hypot(bvx, bvy);
      if (spd > 5) {
        o.dirA = Math.atan2(bvy, bvx); o.dirS = 1 + Math.min(0.32, spd * 0.018); o.dirP = 1 / Math.sqrt(o.dirS);
        if (spd > 11) o.expr = 'dizzy';
        drip({ x: 0, y: -36, rate: 0.25, colors: [info.palette.main, info.palette.light], speed: [0.5, 2], life: [16, 26], size: [2.5, 4.5] });
      }
      break;
    }
    case 'shieldbreak': case 'stunned':
      o.expr = 'dizzy'; o.mouth = 'wavy'; o.stars = 1; o.sy *= 0.9 + 0.05 * wob(t, 3); o.rot = 0.08 * wob(t, 2.2); o.wobble = 1.4;
      break;
    case 'grabbed': o.sx *= 0.82 + 0.05 * wob(t, 31); o.sy *= 1.12; o.expr = 'shock'; o.mouth = 'o'; o.open = 0.6; o.wobble = 1.8; break;
    case 'grabbing':
      if (!v.move || ['grab', 'pummel'].includes(v.move.anim)) {
        o.hold = { x: 30 * bs, y: -32 * bs, r: 15 * bs }; o.expr = 'focus'; o.mouth = 'grin'; o.look = { x: 1, y: 0 };
      }
      break;
    case 'wallcling': case 'crawl': {
      if (st === 'crawl') {
        if (Math.abs(v.vx || 0) > 0.2) c.crawl = 'under';
        else if (Math.abs(v.vy || 0) > 0.2) c.crawl = 'side';
      } else c.crawl = 'side';
      const H = body.h, W = body.w;
      if (st === 'crawl' && c.crawl === 'under') { o.flipY = true; o.pivot = { x: 0, y: -H / 2 }; }
      else { o.rot = -Math.PI / 2; o.pivot = { x: 0, y: -Math.max(H / 2, W / 2 - 14 * bs) }; o.gx = W / 2 - H / 2; }
      o.look = { x: 0.2, y: -0.8 }; o.mouth = 'grin'; o.wobble = 1;
      if (st === 'crawl') { const q = Math.abs(Math.sin(t * 10)); o.sx *= 1.06 - 0.12 * q; o.sy *= 0.94 + 0.12 * q; }
      break;
    }
    case 'respawn': o.expr = 'happy'; o.mouth = 'grin'; o.glow = 0.6 + 0.3 * wob(t, 6); break;
    default: break;
  }
  if (v.move) moveAnim(v, info, c, body, o);
  if (v.control === 'freeze') { o.wobble = 0; o.expr = 'shock'; o.mouth = 'flat'; }
  return o;
}

/** Per-anim acting on top of the generic pods. */
function moveAnim(v, info, c, body, o) {
  const m = v.move, ph = m.phase, pt = m.phaseT || 0, t = info.time, bs = v.bodyScale || 1;
  const windup = ph === 'startup' ? smooth(pt) : ph === 'charge' || ph === 'hold' ? 1 : 0;
  const strike = ph === 'active' ? 1 : 0;
  const follow = ph === 'recovery' ? 1 - easeOut(pt) : 0;
  const d = hitDir(v, body);
  // generic: pull back away from the strike, snap toward it, overshoot back
  o.dirA = Math.atan2(d.y, d.x);
  o.dirS = 1 - 0.14 * windup + 0.12 * strike + 0.07 * follow * wob(pt, 18);
  o.dirP = 1 + 0.1 * windup - 0.06 * strike;
  o.dx += (-d.x * 6 * windup + d.x * 4 * strike) * bs; o.dy += (-d.y * 4 * windup + d.y * 2 * strike) * bs;
  o.expr = ph === 'startup' || ph === 'charge' ? 'focus' : ph === 'active' ? 'angry' : 'normal';
  o.mouth = ph === 'startup' || ph === 'charge' ? 'flat' : ph === 'active' ? 'grin' : 'smile';
  o.look = { x: d.x * 1.2, y: d.y };
  o.stiff = ph === 'active' ? 0.34 : 0.22;
  o.wobble = ph === 'recovery' ? 1.4 : 0.8;
  if (ph === 'charge') { o.dx += wob(t, 60) * 1.2; o.shimmer = 0.5; }
  const a = m.anim;
  switch (a) {
    case 'tall': case 'geyser': case 'p_geyser':
      o.sy *= 1 - 0.18 * windup + 0.1 * strike; o.sx *= 1 + 0.14 * windup; o.dirS = 1; o.dirP = 1; o.look = { x: 0.2, y: -1 };
      if (a === 'geyser' && strike) o.front.push((ctx, P) => crown(ctx, o.pods[0], P, t));
      if (a === 'tall' && ph !== 'startup') o.front.push((ctx, P) => { if (o.pods[0]?.e > 0.45) popBubble(ctx, o.pods[0], P, ph === 'active' ? 0.2 : 0.35 + pt * 1.5); });
      break;
    case 'splat':                                       // jump tall, then slam flat
      o.sy *= 1 + 0.22 * windup - 0.42 * strike - 0.2 * follow; o.sx *= 1 - 0.1 * windup + 0.32 * strike + 0.12 * follow;
      o.dirS = 1; o.dirP = 1; o.dx = 0; o.dy = -10 * windup * bs; o.look = { x: 0, y: 1 };
      break;
    case 'flat': case 'p_splash': case 'p_slither':
      o.sy *= 1 - 0.16 * (windup + strike); o.sx *= 1 + 0.12 * strike; o.dirS = 1; o.dirP = 1; o.look = { x: 1, y: 0.6 };
      if (a === 'p_slither' && ph !== 'recovery') o.lean = 0.25;
      break;
    case 'pod':                                         // haymaker pseudopod (side smash, fair)
      o.lean = -0.18 * windup + 0.16 * strike;
      if (strike && o.pods[0]) o.back.push((ctx, P) => smearLines(ctx, o.pods[0], P));
      break;
    case 'stretch': case 'poke': case 'blorp': case 'drop':
      if (a === 'blorp') o.look = { x: -1, y: 0 };
      if (a === 'drop') { o.dirS = 1 + 0.12 * strike; o.look = { x: 0, y: 1 }; }
      if (strike && o.pods[0] && a !== 'poke') o.back.push((ctx, P) => smearLines(ctx, o.pods[0], P));
      break;
    case 'wobble':                                      // nair: spin-jiggle
      o.rot = (strike ? 0.35 * wob(t, 24) : 0) + 0.2 * windup; o.wobble = 2.4; o.expr = strike ? 'happy' : o.expr;
      break;
    case 'gulp': {                                      // Engulf: a huge gaping maw
      o.expr = ph === 'recovery' ? 'happy' : 'shock'; o.mouth = 'none'; o.lean = 0.12 * windup;
      const pod = o.pods[0];
      if (pod) o.front.push((ctx, P) => maw(ctx, pod, P, ph === 'recovery' ? 1 - pt : 1));
      break;
    }
    case 'bounce':
      o.ball = 1; o.rot = (ph === 'active' ? pt : ph === 'recovery' ? 1 : 0) * TAU * 0.75; o.expr = strike ? 'angry' : o.expr; o.mouth = 'grin';
      o.dirS = 1; o.dirP = 1;
      break;
    case 'sling': {                                     // slingshot: pull down, then fly
      if (ph === 'startup' || ph === 'hold') {
        const k = ph === 'hold' ? 1 : windup;
        o.sy *= 1 - 0.32 * k; o.sx *= 1 + 0.18 * k; o.dirS = 1; o.dirP = 1; o.dx = 0; o.dy = 0;
        o.back.push((ctx, P) => slingBands(ctx, P, k, bs, t));
        o.look = { x: 0, y: -1 };
      } else {
        o.ball = 0.5; o.dirA = Math.atan2(v.vy || -1, (v.vx || 0) * (v.facing < 0 ? -1 : 1)); o.dirS = ph === 'active' ? 1.3 : 1 + 0.2 * follow; o.dirP = 0.85;
        o.expr = 'angry'; o.mouth = 'grin';
        if (ph === 'active' && !v.clone) info.fx.local.drip({ x: 0, y: -10, rate: 0.5, colors: [info.palette.main, info.palette.light], speed: [0.5, 1.5], life: [14, 24], size: [2.5, 4] });
      }
      break;
    }
    case 'morph': {                                     // squeeze into a ball, swirl, re-form
      const k = Math.sin(Math.PI * clamp(m.t, 0, 1));
      o.ball = k; o.rot = 0.6 * k * wob(t, 14); o.expr = k > 0.6 ? 'dizzy' : 'closed'; o.mouth = 'o'; o.open = 0.3;
      o.shimmer = k; o.glow = 0.6 * k; o.dirS = 1; o.dirP = 1; o.dx = 0; o.dy = 0;
      break;
    }
    case 'split': {                                     // a bud swells on the back and pinches off
      const k = clamp(m.t / 0.44, 0, 1);
      o.dirS = 1; o.dirP = 1; o.dx = 3 * k * bs; o.dy = 0; o.look = { x: -1, y: 0.2 };
      o.expr = k < 1 ? 'focus' : 'happy'; o.mouth = k < 1 ? 'flat' : 'grin';
      if (k < 1) {
        const r = lerp(4, 17, easeOut(k)) * bs, x = lerp(-18, -38, easeOut(k)) * bs, y = -18 * bs;
        o.pods.push({ type: 'reach', x1: -12 * bs, y1: -24 * bs, r1: lerp(14, 6, k) * bs, x2: x, y2: y, r2: r, e: 1 });
        o.pods.push({ type: 'ball', x, y, r, e: 1, bud: true });
      }
      break;
    }
    case 'jiggle':
      o.sx *= 1 + 0.12 * wob(t, 16); o.sy *= 1 - 0.12 * wob(t, 16); o.rot = 0.14 * wob(t, 8); o.dirS = 1; o.dirP = 1; o.dx = 0; o.dy = 0;
      o.expr = 'happy'; o.mouth = 'grin'; o.bubbleRate = 3; o.wobble = 2;
      break;
    case 'grab':
      o.expr = 'focus'; o.mouth = ph === 'active' ? 'grin' : 'flat';
      break;
    case 'pummel': {
      const p = Math.sin(Math.PI * clamp(m.t * 1.6, 0, 1));
      o.hold = { x: 30 * bs, y: -32 * bs, r: (15 + 5 * p) * bs }; o.sx *= 1 - 0.06 * p; o.expr = 'angry'; o.mouth = 'grin';
      break;
    }
    case 'fthrow': case 'bthrow': case 'uthrow': case 'dthrow': {
      const rel = releaseT(m.def), k = clamp(m.t / rel, 0, 1), after = m.t > rel ? 1 - easeOut((m.t - rel) / (1 - rel)) : 0;
      o.dirS = 1; o.dirP = 1; o.dx = 0; o.dy = 0;
      if (a === 'fthrow') { o.sy *= 1 + 0.1 * k - 0.08 * after; o.lean = -0.15 * k + 0.25 * after; o.mouth = after ? 'open' : 'flat'; o.open = after; }
      if (a === 'bthrow') { o.rot = -0.5 * smooth(k) + 0.8 * after; o.look = { x: -1, y: 0 }; o.mouth = 'grin'; }
      if (a === 'uthrow') { o.sy *= 1 - 0.2 * k + 0.35 * after; o.sx *= 1 + 0.12 * k - 0.15 * after; o.look = { x: 0, y: -1 }; }
      if (a === 'dthrow') { o.dy = -18 * Math.sin(Math.PI * k) * bs; o.sy *= 1 - 0.4 * after; o.sx *= 1 + 0.3 * after; o.look = { x: 0.3, y: 1 }; }
      if (k < 1) o.hold = { x: 30 * bs, y: -32 * bs, r: 15 * bs };
      o.expr = after ? 'angry' : 'focus';
      break;
    }
    case 'p_ring': o.sx *= 1 + 0.1 * strike; o.rot = strike ? 0.1 * wob(t, 20) : 0; break;
    case 'p_spit': {                                    // a glob swells on the lip, then flies
      o.mouth = ph === 'startup' ? 'open' : 'o'; o.open = windup; o.look = { x: 1, y: -0.3 };
      if (ph === 'startup') o.front.push((ctx, P) => kit.droplet(ctx, 28 * bs, -18 * bs, (2 + 6 * windup) * bs, P.main, -0.4, P.outline));
      break;
    }
    case 'p_spout':
      o.dirS = 1; o.dirP = 1; o.dx = 0; o.dy = 0; o.look = { x: 0.2, y: -1 }; o.mouth = 'grin';
      if (ph !== 'startup') o.back.push((ctx, P) => jet(ctx, P, ph === 'active' ? 1 : 1 - pt, bs, t));
      break;
    case 's_needle': case 's_lance':
      o.lean = -0.12 * windup + 0.1 * strike; o.glint = strike;
      break;
    case 's_urchin':                                    // armored: spikes tuck, then burst out
      o.spikeLen = 1 - 0.45 * windup + 1.5 * strike + 0.6 * follow; o.glint = windup > 0.6 ? 1 : strike;
      o.sx *= 1 - 0.08 * windup + 0.1 * strike; o.sy *= 1 - 0.1 * windup + 0.08 * strike; o.dirS = 1; o.dirP = 1; o.dx = wob(t, 50) * windup;
      o.shimmer = windup * 0.6;
      break;
    case 's_bristle': {                                 // counter stance: every spine bristles
      const on = m.frame >= 4 && m.frame <= 20 ? 1 : 0;
      o.spikeLen = 1 + 0.6 * on; o.glint = on * (0.6 + 0.4 * wob(t, 20)); o.expr = 'focus'; o.mouth = 'flat';
      o.sx *= 1 - 0.06 * on; o.dirS = 1; o.dirP = 1; o.dx = 0; o.dy = 0;
      break;
    }
    case 's_burst': o.spikeLen = 1 + 1.4 * strike + 0.6 * follow; o.glint = strike; o.expr = 'angry'; o.dirS = 1; o.dirP = 1; break;
    default: break;
  }
}

function releaseT(def) {
  const r = (def.timeline || []).find((e) => e.action === 'release' || e.release);
  const at = r?.at ?? r?.from ?? def.duration * 0.4;
  return clamp(at / Math.max(1, def.duration), 0.1, 0.9);
}

// ── Decorations ──────────────────────────────────────────────────────────────
function tipOf(pod) {
  if (!pod) return null;
  if (pod.type === 'ball') return { x: pod.x, y: pod.y, r: pod.r };
  if (pod.type === 'cap') return { x: pod.x2, y: pod.y2, r: pod.r };
  if (pod.type === 'slab') return { x: pod.x2, y: pod.bottom - pod.h, r: pod.h };
  return { x: pod.x2, y: pod.y2, r: pod.r2 };
}

/** Speed streaks trailing the pod tip on active frames (smear). */
function smearLines(ctx, pod, P) {
  if (!pod || pod.type === 'slab' || pod.type === 'ball' || pod.type === 'cap') return;
  const ux = pod.ux ?? 1, uy = pod.uy ?? 0, px = -uy, py = ux;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    const off = i * pod.r2 * 0.7, len = 26 + (i === 0 ? 12 : 0);
    const x = pod.x2 - ux * pod.r2 * 0.6 + px * off, y = pod.y2 - uy * pod.r2 * 0.6 + py * off;
    ctx.strokeStyle = kit.rgba(i ? P.light : P.glow, 0.7); ctx.lineWidth = i ? 2.4 : 3.4;
    ctx.beginPath(); ctx.moveTo(x - ux * 4, y - uy * 4); ctx.lineTo(x - ux * len, y - uy * len); ctx.stroke();
  }
  ctx.restore();
}

/** Geyser crown: a splash ring and loose droplets flung off the column tip. */
function crown(ctx, pod, P, t) {
  const tp = tipOf(pod);
  if (!tp) return;
  ctx.save();
  ctx.strokeStyle = kit.rgba(P.light, 0.85); ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.ellipse(tp.x, tp.y + tp.r * 0.2, tp.r * 1.25, tp.r * 0.35, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  ctx.restore();
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, a = -Math.PI / 2 + side * (0.5 + 0.55 * hash(i, 5));
    const d = tp.r * (1.3 + 0.7 * hash(i, 8)) + 4 * wob(t, 9, i);
    kit.droplet(ctx, tp.x + Math.cos(a) * d, tp.y + Math.sin(a) * d * 0.8, 2.4 + hash(i, 6) * 2.2, P.main, a, P.outline);
  }
}

/** Bubble Pop: a soap-thin bubble at the tip that bursts into a ring. */
function popBubble(ctx, pod, P, k) {
  const tp = tipOf(pod);
  if (!tp) return;
  ctx.save();
  ctx.lineWidth = 2.2;
  if (k < 0.35) {
    ctx.strokeStyle = kit.rgba('#ffffff', 0.8);
    ctx.beginPath(); ctx.arc(tp.x, tp.y, tp.r * 1.05, 0, TAU); ctx.stroke();
    ctx.fillStyle = kit.rgba('#ffffff', 0.85);
    ctx.beginPath(); ctx.ellipse(tp.x - tp.r * 0.4, tp.y - tp.r * 0.45, tp.r * 0.25, tp.r * 0.12, -0.6, 0, TAU); ctx.fill();
  } else {
    const q = clamp((k - 0.35) / 0.65, 0, 1);
    ctx.strokeStyle = kit.rgba(P.glow, 1 - q);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, r0 = tp.r * (1 + q * 0.6), r1 = r0 + 7;
      ctx.beginPath(); ctx.moveTo(tp.x + Math.cos(a) * r0, tp.y + Math.sin(a) * r0); ctx.lineTo(tp.x + Math.cos(a) * r1, tp.y + Math.sin(a) * r1); ctx.stroke();
    }
  }
  ctx.restore();
}

/** Engulf maw: a dark gullet with a wet lip on the reaching lobe. */
function maw(ctx, pod, P, k) {
  const tp = tipOf(pod);
  if (!tp || k <= 0) return;
  const r = tp.r * 0.62 * k;
  ctx.save();
  ctx.beginPath(); ctx.ellipse(tp.x + r * 0.15, tp.y, r * 0.8, r, 0, 0, TAU);
  ctx.fillStyle = kit.radial(ctx, tp.x + r * 0.3, tp.y, 0, r, [kit.shade(P.core, -0.45), P.core, kit.rgba(P.deep, 0.9)]);
  ctx.fill();
  ctx.lineWidth = 2.6; ctx.strokeStyle = P.outline; ctx.stroke();
  ctx.strokeStyle = kit.rgba(P.spec, 0.75); ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.ellipse(tp.x + r * 0.15, tp.y, r * 0.8 - 2, r - 2, 0, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
  // goo strands across the gape
  ctx.strokeStyle = kit.rgba(P.light, 0.7); ctx.lineWidth = 1.4;
  for (const s of [-0.3, 0.35]) {
    ctx.beginPath(); ctx.moveTo(tp.x - r * 0.5, tp.y + r * s - r * 0.5); ctx.quadraticCurveTo(tp.x, tp.y + r * s + r * 0.2, tp.x + r * 0.6, tp.y + r * s - r * 0.4); ctx.stroke();
  }
  ctx.restore();
}

/** Slingshot: two gel bands anchored to the floor, stretched by the pull. */
function slingBands(ctx, P, k, bs, t) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const ax = s * 34 * bs, bx = s * 16 * bs, by = -26 * bs;
    ctx.strokeStyle = P.outline; ctx.lineWidth = (5 + 3 * (1 - k)) * bs + 3;
    ctx.beginPath(); ctx.moveTo(ax, 2); ctx.quadraticCurveTo(ax * 0.9, by * 0.3 + wob(t, 30) * k, bx, by); ctx.stroke();
    ctx.strokeStyle = P.main; ctx.lineWidth = (5 + 3 * (1 - k)) * bs;
    ctx.stroke();
    kit.ellipse(ctx, ax, 2, 9 * bs, 3.5 * bs, P.deep, { outline: P.outline, lineWidth: 2 });
  }
  ctx.restore();
}

/** Water Spout jet under the puddle. */
function jet(ctx, P, k, bs, t) {
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha *= clamp(k * 1.5, 0, 1);
  const w = 12 * bs * k;
  const pts = [[-w, -6], [w, -6]];
  for (let i = 1; i <= 4; i++) pts.push([w * (1 - i * 0.18) + wob(t, 20, i) * 2, -6 + i * 5.5]);
  pts.push([0, 24]);
  for (let i = 4; i >= 1; i--) pts.push([-w * (1 - i * 0.18) + wob(t, 20, i + 3) * 2, -6 + i * 5.5]);
  const path = smoothPath(pts);
  ctx.lineWidth = 5; ctx.strokeStyle = P.outline; ctx.stroke(path);
  ctx.fillStyle = kit.linear(ctx, 0, -6, 0, 24, [P.light, P.main, kit.rgba(P.main, 0.2)]); ctx.fill(path);
  ctx.strokeStyle = kit.rgba('#ffffff', 0.6); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-w * 0.4, -4); ctx.lineTo(-w * 0.2, 20); ctx.stroke();
  ctx.restore();
}

function dizzyStars(ctx, x, y, P, t) {
  for (let i = 0; i < 3; i++) {
    const a = t * 4 + (i / 3) * TAU;
    ctx.save();
    ctx.translate(x + Math.cos(a) * 20, y + Math.sin(a) * 6);
    kit.starPath(ctx, 0, 0, 5, 6, 2.6, t * 3);
    ctx.fillStyle = '#fff3a8'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = P.outline; ctx.stroke();
    ctx.restore();
  }
}

function sweatDrop(ctx, x, y, P, t) {
  const q = (t * 1.3) % 1;
  kit.droplet(ctx, x + 2 * q, y + 10 * q, 3.2, '#bfe9ff', Math.PI / 2, P.outline);
}

// ── Painting ────────────────────────────────────────────────────────────────
/** Applies the body-only transform to a point (pivot at the feet / center). */
function xf(o, x, y, cx, cy) {
  x *= o.sx; y *= o.sy;                                         // squash about the feet
  if (o.dirS !== 1 || o.dirP !== 1) {                           // stretch along a direction about the center
    const ccx = cx * o.sx, ccy = cy * o.sy, c = Math.cos(o.dirA), s = Math.sin(o.dirA);
    let a = (x - ccx) * c + (y - ccy) * s, b = -(x - ccx) * s + (y - ccy) * c;
    a *= o.dirS; b *= o.dirP;
    x = ccx + a * c - b * s; y = ccy + a * s + b * c;
  }
  x -= o.lean * y;                                              // y < 0 is up: lean > 0 tips the top forward
  return [x + o.dx, y + o.dy];
}

function podPaths(p, t) {
  if (p.type === 'reach' && p.e > 0.35) {
    // root → neck → bulb; the two halves overlap so no seam bands show at the neck
    const nr = Math.min(p.r1, p.r2) * 0.68;
    const ax = lerp(p.x1, p.x2, 0.62), ay = lerp(p.y1, p.y2, 0.62), bx = lerp(p.x1, p.x2, 0.45), by = lerp(p.y1, p.y2, 0.45);
    return [taperPath(p.x1, p.y1, p.r1, ax, ay, nr * 0.95), taperPath(bx, by, nr, p.x2, p.y2, p.r2 * 1.06)];
  }
  return [podPath(p, t)];
}

function podPath(p, t) {
  switch (p.type) {
    case 'ball': return smoothPath(ballPts(p.x, p.y, p.r, t, { seed: p.bud ? 7 : 3 }));
    case 'cap': return taperPath(p.x1, p.y1, p.r, p.x2, p.y2, p.r);
    case 'slab': return smoothPath(slabPts(p.x1, p.x2, p.bottom, p.h, t));
    case 'spine': return spinePath(p.x1, p.y1, p.r1, p.x2, p.y2, p.ext * p.e);
    default: return taperPath(p.x1, p.y1, p.r1, p.x2, p.y2, p.r2);
  }
}

/** Grows a gooey foot / eye bumps / follow-through drips as extra union pieces. */
function extraPieces(v, o, pts, body, form, t, bs) {
  const out = [];
  let x1 = Infinity, x2 = -Infinity, yb = -Infinity;
  for (const [x, y] of pts) { if (y > yb) yb = y; }
  for (const [x, y] of pts) if (y > yb - 10 * bs) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); }
  const grounded = v.grounded !== false && !['roll', 'airdodge', 'hitstun', 'wallcling', 'crawl'].includes(v.state);
  if (grounded && form !== 'puddle' && o.ball < 0.5 && Number.isFinite(x1)) {
    const hw = Math.max(18 * bs, (x2 - x1) / 2 + 8 * bs) * (1 + 0.08 * wob(t, 3.1));
    const cx = (x1 + x2) / 2;
    out.push(smoothPath(slabPts(cx - hw, cx + hw, Math.min(0, yb + 0.5), 9 * bs, t * 0.4, 9)));
  }
  // follow-through: a drip hangs off a retracting pod tip
  for (const p of o.pods) {
    if (p.type !== 'reach' || p.e > 0.85 || p.e < 0.15 || v.move?.phase !== 'recovery') continue;
    const r = Math.max(2.5, p.r2 * 0.32), dy = p.r2 * 0.8 + 6 * (1 - p.e);
    out.push(taperPath(p.x2, p.y2 + p.r2 * 0.4, r * 0.8, p.x2, p.y2 + dy, r));
  }
  return out;
}

function paint(ctx, v, info, c, Pin) {
  const form = v.form || 'base', bs = v.bodyScale || 1, t = info.time;
  let P = formPalette(Pin, form);
  if (v.clone) P = { ...P, main: kit.mix(P.main, P.light, 0.3), deep: kit.mix(P.deep, P.main, 0.3) }; // the copy is paler
  const f = v.facing < 0 ? -1 : 1;
  const L = bodyLight(info, f);
  const dt = clamp(info.dt || 1 / 60, 0, 0.1);
  // a still render (Lab, portrait, time jump): snap the springs
  const still = c.lastT == null || info.time <= c.lastT || info.time - c.lastT > 0.25;
  c.lastT = info.time;
  if (still) { c.gel.ready = false; c.fx.init = c.fy.init = c.lean.init = false; }

  const hb = shapesBox(info.hurtboxes);
  const spiky = form === 'spike';
  const o = buildPose(v, info, c, hb, spiky);
  // the gel follows the hurtboxes (or a ball of equal area when rolling/bouncing)
  // Spike form: the square hurt rect reads as a box, so the gel rounds it into an urchin
  let targets = spiky ? info.hurtboxes.map((s) => (kit.shapeKind(s) === 'rect' ? { shape: 'circle', x: s.x, y: s.y, r: (s.w + s.h) * 0.29 } : s)) : info.hurtboxes;
  if (o.ball > 0.01) {
    const r = Math.sqrt((hb.w * hb.h) / Math.PI) * 0.92;
    const ball = { shape: 'circle', x: hb.cx, y: lerp(hb.cy, -r, o.ball), r: lerp(Math.max(hb.w, hb.h) / 2, r, o.ball) };
    targets = o.ball >= 0.5 ? [ball] : [...targets, ball];
  }
  c.gel.stiffness = o.stiff;
  const mo = info.motion || {};
  blob.step(c.gel, { shapes: targets, dt, impulse: { squash: (mo.squash || 0) * o.impulse, stretch: (mo.stretch || 0) * o.impulse, lean: mo.lean || 0 }, wobble: o.wobble });
  const pts = c.gel.pts.map((p) => xf(o, p.x, p.y, c.gel.cx, c.gel.cy));
  const box = boxOf(pts);
  const pieces = [smoothPath(pts)];
  for (const p of o.pods) for (const pp of podPaths(p, t)) if (pp) pieces.push(pp);
  if (o.hold) pieces.push(taperPath(box.cx + 8 * bs, box.cy, 13 * bs, o.hold.x, o.hold.y, o.hold.r));
  pieces.push(...extraPieces(v, o, pts, box, form, t, bs));
  // face anchor rides the transformed gel, lagging a little (it floats inside)
  let top = pts[0];
  for (const p of pts) if (p[1] < top[1]) top = p;
  const FACE = form === 'puddle' ? { x: 16, y: 12, s: 0.8 } : form === 'spike' ? { x: 8, y: 30, s: 1 } : { x: 9, y: 25, s: 1.08 };
  const fxT = lerp(box.cx, top[0], 0.35) + FACE.x * bs + o.faceDx, fyT = top[1] + FACE.y * bs * o.sy + o.faceDy;
  const fx = spring(c.fx, fxT, dt), fy = spring(c.fy, fyT, dt);
  const fs = FACE.s * bs * o.faceScale * (v.clone ? 1.15 : 1);
  if (form === 'puddle') { // eyes bob in little bumps above the surface
    for (const s of [-1, 1]) pieces.push(smoothPath(ballPts(fx + s * 8 * fs, fy + 1, 11 * fs, t, { n: 10, amp: 0.04, seed: 4 + s })));
  }
  const mass = clamp((v.resources?.mass ?? 60) / (v.resMax?.mass || 100), 0, 1);
  if (c.lastMass != null && mass - c.lastMass > 0.07) c.morsel = 1;
  c.lastMass = mass;
  c.morsel = Math.max(0, c.morsel - dt * 1.1);

  ctx.save();
  ctx.globalAlpha *= o.alpha;
  // whole-figure transform (rolls, wall cling, ceiling crawl, tumble)
  const pv = o.pivot || { x: box.cx, y: box.cy };
  if (o.rot || o.flipY || o.gx || o.gy) {
    ctx.translate(pv.x + o.gx, pv.y + o.gy);
    if (o.rot) ctx.rotate(o.rot);
    if (o.flipY) ctx.scale(1, -1);
    ctx.translate(-pv.x, -pv.y);
  }
  if (o.glow > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; kit.glow(ctx, box.cx, box.cy, Math.max(box.w, box.h) * 0.8, P.effect, 0.35 * o.glow); ctx.restore(); }
  for (const fn of o.back) fn(ctx, P);
  if (spiky) {
    const gelView = { n: pts.length, pts: pts.map(([x, y]) => ({ x, y })), cx: box.cx, cy: box.cy };
    spikes(ctx, gelView, P, L, { count: 13, len: 13 * bs * o.spikeLen, width: 10 * bs, time: t, glint: o.glint, lw: 2.4 });
    for (const p of o.pods) if (p.type === 'ball' && p.e > 0.3) spikes(ctx, { n: 12, pts: ballPts(p.x, p.y, p.r, 0, { n: 12, amp: 0 }).map(([x, y]) => ({ x, y })), cx: p.x, cy: p.y }, P, L, { count: 9, len: 12 * bs * o.spikeLen, width: 9 * bs, time: t, glint: o.glint, seed: 9 });
  }
  const low = info.quality === 'low';
  const look = o.look || { x: 0.6, y: 0 };
  const blink = o.expr === 'normal' && ((t + 1.7) % 3.7) < 0.12 ? 1 : 0;
  const inner = (g, bx) => {
    // the swallowed lab bolt drifts and turns
    if (!low) bolt(g, bx.cx - 14 * bs + wob(t, 0.7) * 4, bx.cy - 6 * bs + wob(t, 0.9, 1) * 3, 0.9 * bs, 0.6 + t * 0.35, P, 0.55);
    nucleus(g, bx.cx - 8 * bs, bx.cy + Math.min(10, bx.h * 0.15), (5 + 7 * mass) * bs * (form === 'puddle' ? 0.7 : 1), P, t, mass >= 0.95 ? 1 : 0);
    if (c.morsel > 0) morsel(g, lerp(bx.cx - 8 * bs, fx + 14 * bs, c.morsel), lerp(bx.cy + 6, fy + 14 * bs, c.morsel), 6 * bs, P, c.morsel, t);
    bubbles(g, bx, P, t, { count: low ? 3 : 7, speed: o.bubbleRate, seed: 3, size: bs });
    if (o.shimmer > 0) {
      g.save(); g.globalCompositeOperation = 'lighter';
      g.fillStyle = kit.linear(g, bx.x1, bx.y1, bx.x2, bx.y2, [[0, kit.rgba(P.glow, 0)], [clamp(((t * 1.6) % 1.4) - 0.2, 0, 1), kit.rgba(P.glow, 0.45 * o.shimmer)], [1, kit.rgba(P.glow, 0)]]);
      g.fillRect(bx.x1 - 20, bx.y1 - 20, bx.w + 40, bx.h + 40);
      g.restore();
    }
  };
  const face = (g) => {
    eyes(g, fx, fy, P, { expr: o.expr, look, blink, size: fs, spread: 17, L, time: t });
    if (o.mouth !== 'none') mouth(g, fx + 3 * fs, fy + 13 * fs, P, o.mouth, fs, o.open);
  };
  const ub = boxOf(pts);
  paintUnion(ctx, pieces, ub, P, L, { rim: L.rim, lw: 3 * Math.max(0.8, bs), inner, face, low });
  for (const fn of o.front) fn(ctx, P);
  if (o.stars) dizzyStars(ctx, box.cx, top[1] - 10, P, t);
  if (o.sweat) sweatDrop(ctx, fx + 18 * fs, fy - 12 * fs, P, t);
  ctx.restore();
  return { box, fx, fy };
}

// ── Entities ─────────────────────────────────────────────────────────────────
function globArt(ctx, e, info) {
  const P = formPalette(info.palette, 'base'), t = info.time;
  const vx = e.vx || 0, vy = e.vy || 0, sp = Math.hypot(vx, vy);
  const L = bodyLight(info, e.facing);
  if (sp < 0.6) {                                    // stuck: a splat with a little crater
    const k = clamp(1 - e.lifeT * 0.2, 0.8, 1);
    const path = smoothPath(ballPts(0, 0, 11 * k, t * 0.5, { n: 16, amp: 0.06, sy: 0.62, seed: e.id | 0 }));
    paintUnion(ctx, [path], { x1: -11, y1: -8, x2: 11, y2: 8, cx: 0, cy: 0, w: 22, h: 16 }, P, L, { rim: L.rim, lw: 2.2 });
    return;
  }
  const a = Math.atan2(vy, vx), st = clamp(sp * 0.07, 0, 0.6);
  ctx.save();
  ctx.rotate(a);
  // trailing goo tail
  ctx.strokeStyle = kit.rgba(P.main, 0.45); ctx.lineCap = 'round';
  for (let i = 1; i <= 3; i++) { ctx.lineWidth = 7 - i * 1.8; ctx.beginPath(); ctx.moveTo(-6 - i * 6, wob(t, 22, i) * 1.5); ctx.lineTo(-10 - i * 7, wob(t, 22, i + 1) * 1.5); ctx.stroke(); }
  const pts = [];
  for (let i = 0; i < 14; i++) {
    const q = (i / 14) * TAU, back = Math.cos(q) < 0 ? 1 + st * 1.4 * -Math.cos(q) : 1;
    const r = 9 * (1 + 0.06 * wob(t, 18, i));
    pts.push([Math.cos(q) * r * back, Math.sin(q) * r * (1 - st * 0.25)]);
  }
  const la = Math.atan2(L.y, L.x) - a;
  paintUnion(ctx, [smoothPath(pts)], { x1: -9 - 9 * st, y1: -9, x2: 9, y2: 9, cx: -2, cy: 0, w: 18 + 9 * st, h: 18 }, P, { x: Math.cos(la), y: Math.sin(la) }, { rim: L.rim, lw: 2.2 });
  ctx.fillStyle = kit.rgba(P.glow, 0.8);
  ctx.beginPath(); ctx.arc(-3, 2, 2, 0, TAU); ctx.fill();
  ctx.restore();
}

function trapArt(ctx, e, info) {
  const P = formPalette(info.palette, 'base'), t = info.time, L = bodyLight(info, e.facing);
  const grow = clamp(e.age / 10, 0, 1), fade = clamp(e.life / 40, 0, 1), k = easeOut(grow) * (0.7 + 0.3 * fade);
  const w = (e.shape?.w || 60) * (0.55 + 0.45 * k);
  ctx.save();
  ctx.globalAlpha *= 0.4 + 0.6 * fade;
  const path = smoothPath(slabPts(-w / 2 - 4, w / 2 + 4, 1, 10 * k + 2, t * 0.6, (e.id | 0) % 7));
  paintUnion(ctx, [path], { x1: -w / 2, y1: -12, x2: w / 2, y2: 1, cx: 0, cy: -5, w, h: 13 }, P, L, { rim: L.rim, lw: 2.4 });
  // sticky strands and popping bubbles
  ctx.strokeStyle = kit.rgba(P.light, 0.7); ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    const x = (hash(i, e.id | 0) - 0.5) * w * 0.7, ph = (t * 0.9 + hash(i, 3)) % 1;
    ctx.globalAlpha = (1 - ph) * fade;
    ctx.beginPath(); ctx.arc(x, -8 * k - ph * 6, 1.5 + ph * 3.5, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

function clonelingArt(ctx, e, info) {
  // fades in from 40% (never invisible on spawn frames), out over its last 30 frames
  const fade = clamp(e.life / 30, 0, 1) * (0.4 + 0.6 * clamp(e.age / 6, 0, 1));
  if (e.view) {
    info.drawSelf(ctx, { ...e.view, clone: true }, { scale: 0.6, alpha: 0.88 * fade });
  } else {
    const P = formPalette(info.palette, 'base'), L = bodyLight(info, e.facing);
    const path = smoothPath(ballPts(0, -18, 19, info.time, { n: 14, amp: 0.05, seed: e.id | 0 }));
    ctx.save(); ctx.globalAlpha *= fade;
    paintUnion(ctx, [path], { x1: -19, y1: -37, x2: 19, y2: 1, cx: 0, cy: -18, w: 38, h: 38 }, P, L, { rim: L.rim, lw: 2.4 });
    eyes(ctx, 4, -24, P, { size: 0.7, look: { x: 0.8, y: 0 }, L });
    ctx.restore();
  }
  const P = formPalette(info.palette, 'base');
  if (e.hp != null && e.hp < 6) kit.blinkIcon(ctx, 0, -60, 'alert', info.time, { size: 9, color: P.effect });
}

// ── fx helpers ───────────────────────────────────────────────────────────────
const palOf = (info) => formPalette(info?.palette || PAL, info?.form || 'base');
function splat(fx, x, y, P, n, pow = 1, angle = 90, spread = 360) {
  fx.burst({ x, y, count: n, shape: gelDrop, colors: [P.main, P.light, P.deep], speed: [2, 5 + 4 * pow], angle, spread, gravity: 0.32, drag: 0.98, life: [22, 36], size: [5, 10] });
}

// ── ArtDef ───────────────────────────────────────────────────────────────────
export default {
  rig: 'none',
  bounds: {
    base: { left: -128, right: 170, top: -182, bottom: 36 },
    puddle: { left: -110, right: 150, top: -128, bottom: 34 },
    spike: { left: -122, right: 160, top: -150, bottom: 36 },
  },
  palette: PAL,
  palettes: ALT_PALETTES,

  init(cache) { ensure(cache); },

  draw(ctx, v, info) {
    ensure(info.cache);
    paint(ctx, v, info, info.cache, info.palette);
    for (const s of v.statuses || []) if (s.name === 'sticky') info.tint(PAL.effect, 0.12);
  },

  // A full Gloop (Engulf turns into Glob Shot) hums with a pale glow behind it.
  drawBack(ctx, v, info) {
    const mass = (v.resources?.mass ?? 0) / (v.resMax?.mass || 100);
    if (mass < 0.95 || v.state === 'dead') return;
    const bs = v.bodyScale || 1;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, 0, -34 * bs, (58 + 6 * Math.sin(info.time * 5)) * bs, info.palette.effect || PAL.effect, 0.22);
    ctx.restore();
  },

  entities: {
    glob: { draw: globArt },
    puddleTrap: { draw: trapArt },
    gloopling: { draw: clonelingArt },
  },

  trail(v) {
    const a = v.move?.anim;
    return a === 'pod' || a === 'stretch' || a === 's_lance' || a === 'bounce' ? null : false;
  },

  fx: {
    onHit(fx, ev, info) {
      const P = palOf(info), dmg = ev.damage || 0, pow = clamp((ev.kb || 0) / 120, 0, 1);
      const launch = (ev.dir || 1) < 0 ? 180 - (ev.angle ?? 45) : (ev.angle ?? 45);
      if (ev.effect === 'slash') {
        fx.burst({ x: ev.x, y: ev.y, count: 6 + dmg, shape: 'shard', colors: [P.tip || P.light, '#ffffff', P.main], speed: [3, 9], angle: launch, spread: 120, gravity: 0.25, spin: 0.3, life: [14, 26], size: [3, 7] });
        fx.line({ x: ev.x - 30, y: ev.y + 18, x2: ev.x + 30, y2: ev.y - 18, color: P.light, core: '#ffffff', width: 4, life: 6 });
      } else {
        splat(fx, ev.x, ev.y, P, 5 + Math.round(dmg * 0.8), pow, launch, 160);
        fx.burst({ x: ev.x, y: ev.y, count: 3, shape: 'glow', color: P.glow, speed: [0.5, 1.5], life: [8, 12], size: [12, 20], blend: 'lighter' });
      }
      if (ev.effect === 'poison') fx.burst({ x: ev.x, y: ev.y, count: 5, shape: 'ring', color: P.effect, speed: [0.5, 1.5], angle: 90, spread: 80, life: [18, 28], size: [3, 6] });
      if (dmg >= 6) fx.ring({ x: ev.x, y: ev.y, r0: 6, r1: 26 + dmg * 2 + pow * 30, color: P.light, life: 12, width: 4 });
      if (pow > 0.6) { fx.shake(3 + pow * 3); fx.flash(P.glow, 0.12, 2); }
    },
    onHurt(fx, ev, info) {                          // gel knocked loose (mass loss)
      const P = palOf(info);
      splat(fx, ev.x, ev.y, P, 3 + Math.round((ev.damage || 0) / 3), 0.6);
      fx.sound({ type: 'sine', freq: [360, 140], dur: 0.12, gain: 0.18 }, { volume: 0.5 });
    },
    onLand(fx, ev, info) {
      const P = palOf(info);
      fx.ring({ x: ev.x, y: ev.y - 2, r0: 10, r1: ev.heavy ? 56 : 38, color: P.light, life: 12, width: 3, flat: true, alpha: 0.8 });
      for (const ang of [20, 160]) fx.burst({ x: ev.x, y: ev.y - 4, count: ev.heavy ? 4 : 2, shape: gelDrop, colors: [P.main, P.light], speed: [1.5, 3.5], angle: ang, spread: 30, gravity: 0.35, life: [16, 26], size: [4, 7] });
      if (ev.heavy) fx.decal({ x: ev.x, y: ev.y, shape: 'splat', r: 30, color: kit.rgba(P.main, 0.6) });
    },
    onJump(fx, ev, info) {
      const P = palOf(info);
      fx.ring({ x: ev.x, y: ev.y - 2, r0: 8, r1: ev.double ? 44 : 32, color: P.light, life: 12, width: 3, flat: true, alpha: 0.8 });
      fx.burst({ x: ev.x, y: ev.y - 4, count: ev.double ? 6 : 3, shape: gelDrop, colors: [P.main, P.light], speed: [1, 2.5], angle: 270, spread: 70, gravity: 0.35, life: [14, 22], size: [4, 7] });
    },
    onKO(fx, ev, info) {                            // SPLORCH: the whole slime bursts
      const P = palOf(info);
      fx.burst({ x: ev.x, y: ev.y, count: 34, shape: gelDrop, colors: [P.main, P.light, P.deep], speed: [4, 14], gravity: 0.3, drag: 0.98, life: [30, 50], size: [6, 14] });
      fx.burst({ x: ev.x, y: ev.y, count: 14, shape: 'ring', color: P.glow, speed: [1, 5], life: [24, 40], size: [3, 8] });
      fx.ring({ x: ev.x, y: ev.y, r0: 20, r1: 120, color: P.effect, life: 18, width: 7 });
      fx.flash(P.glow, 0.22, 4);
      fx.sound('splash', { volume: 1, pitch: 0.7 });
    },
    onRespawn(fx, ev, info) {                       // re-condenses from droplets
      const P = palOf(info);
      fx.ring({ x: ev.x, y: ev.y - 36, r0: 80, r1: 20, color: P.light, life: 20, width: 5, alpha: 0.85 });
      fx.burst({ x: ev.x, y: ev.y - 36, count: 12, shape: gelDrop, colors: [P.main, P.light], speed: [1, 3], life: [16, 26], size: [4, 7] });
      fx.sound('boing', { volume: 0.6, pitch: 1.3 });
    },
    onFormChange(fx, ev, info) {
      const P = palOf(info), to = ev.to || ev.form;
      const col = to === 'spike' ? (P.tip || '#ffffff') : to === 'puddle' ? P.light : P.main;
      splat(fx, ev.x, ev.y - 30, P, 14, 0.7);
      fx.ring({ x: ev.x, y: ev.y - 30, r0: 12, r1: 70, color: col, life: 16, width: 5 });
      if (to === 'spike') fx.burst({ x: ev.x, y: ev.y - 34, count: 10, shape: 'shard', colors: [P.light, '#ffffff'], speed: [3, 8], life: [14, 24], size: [3, 6] });
    },
    onMove: {
      sideSmash(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 6, count: 4, shape: gelDrop, color: palOf(info).main, speed: [1, 3], angle: 90, spread: 120, gravity: 0.35, life: [14, 24], size: [4, 7] }); },
      downSmash(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 4, count: 10, shape: gelDrop, colors: [palOf(info).main, palOf(info).light], speed: [3, 7], angle: 90, spread: 150, gravity: 0.35, life: [18, 30], size: [4, 8] }); fx.shake(3); },
      upSmash(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 110, count: 10, shape: gelDrop, colors: [palOf(info).main, palOf(info).light], speed: [3, 7], angle: 90, spread: 100, gravity: 0.35, life: [20, 32], size: [4, 8] }); },
      geyser(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 100, count: 8, shape: gelDrop, colors: [palOf(info).main, palOf(info).light], speed: [2, 6], angle: 90, spread: 100, gravity: 0.35, life: [18, 30], size: [4, 7] }); },
      spout(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y, count: 12, shape: gelDrop, colors: [palOf(info).main, palOf(info).light], speed: [2, 6], angle: 270, spread: 60, gravity: 0.3, life: [18, 30], size: [4, 8] }); },
      urchin(fx, ev, info) { fx.burst({ x: ev.x, y: ev.y - 42, count: 6, shape: 'star', color: '#ffffff', speed: [0.5, 2], life: [10, 16], size: [6, 10] }); },
    },
    onEvent: {
      gulp(fx, ev, info) {
        const P = palOf(info);
        fx.ring({ x: ev.x + 32, y: ev.y - 36, r0: 46, r1: 8, color: P.effect, life: 12, width: 4 });
        fx.burst({ x: ev.x + 30, y: ev.y - 36, count: 8, shape: 'glow', color: P.glow, speed: [1, 3], life: [10, 16], size: [6, 10], blend: 'lighter' });
        fx.text({ x: ev.x, y: ev.y - 96, text: '+MASS', color: P.light, outline: P.outline, size: 16, life: 40 });
      },
      morph(fx, ev, info) {
        const P = palOf(info);
        fx.burst({ x: ev.x, y: ev.y - 34, count: 10, shape: 'star', colors: [P.light, '#ffffff'], speed: [1, 4], life: [12, 20], size: [5, 9] });
        fx.ring({ x: ev.x, y: ev.y - 34, r0: 50, r1: 14, color: P.glow, life: 10, width: 4 });
      },
      sling(fx, ev, info) {
        const P = palOf(info);
        fx.ring({ x: ev.x, y: ev.y - 2, r0: 10, r1: 50, color: P.light, life: 12, width: 4, flat: true });
        splat(fx, ev.x, ev.y - 6, P, 8, 0.5, 270, 90);
      },
      split(fx, ev, info) {
        const P = palOf(info), x = ev.x - 40 * ((ev.facing ?? 1) < 0 ? -1 : 1);
        fx.burst({ x, y: ev.y - 20, count: 10, shape: gelDrop, colors: [P.main, P.light], speed: [1, 4], gravity: 0.3, life: [16, 26], size: [4, 7] });
        fx.ring({ x, y: ev.y - 20, r0: 6, r1: 34, color: P.glow, life: 12, width: 3 });
      },
    },
  },

  sounds: {
    jump: 'boing',
    land: 'splash',
    gulp: 'gulp',
    sling: 'zip',
    split: { type: 'sine', freq: [220, 880], dur: 0.22, gain: 0.25, vibrato: 0.08 },
    morph: { type: 'triangle', freq: [180, 520], dur: 0.3, gain: 0.22, vibrato: { rate: 18, depth: 0.12 } },
  },

  // Select / HUD portrait: a close-up of the grinning blob with its swallowed bolt.
  portrait(ctx, size, info) {
    const P = formPalette(info.palette || PAL, 'base'), k = size / 100;
    const L = bodyLight(info, 1);
    ctx.save();
    ctx.translate(size / 2, size / 2 + 50 * k);
    ctx.scale(k * 1.15, k * 1.15);
    const pts = ballPts(0, -36, 38, 0.5, { n: 18, amp: 0.025, sy: 0.92 });
    for (const p of pts) if (p[1] > -6) p[1] = -6 + (p[1] + 6) * 0.3;     // a flat, wet base
    const box = boxOf(pts);
    paintUnion(ctx, [smoothPath(pts)], box, P, L, {
      rim: L.rim, lw: 3,
      inner: (g, bx) => { bolt(g, -16, -22, 1.1, 0.8, P, 0.6); nucleus(g, -6, -18, 8, P, 0.5, 0); bubbles(g, bx, P, 2.2, { count: 6, seed: 3 }); },
      face: (g) => { eyes(g, 8, -48, P, { size: 1.25, look: { x: 0.4, y: 0.1 }, spread: 17, L }); mouth(g, 12, -32, P, 'grin', 1.2); },
    });
    ctx.restore();
  },
};
