// ─────────────────────────────────────────────────────────────────────────────
// PUPPET RENDERER — draws a fully animated character from a small `art` object.
//
// Every character gets a skeletal rig that the engine animates automatically
// (idle, run, jump, attacks, hitstun...). The `art` object in a character file
// decides how each body part LOOKS. You can:
//   • just set a palette + hair/headgear/weapon options (quick & pretty), or
//   • override any part with your own drawing hook (head, torso, arm, leg,
//     hand, foot, back, front), or
//   • take over completely with art.draw(ctx, info) for non-humanoid designs.
// See docs/ART_GUIDE.md for the full reference.
//
// v2 (Character System v2, §6.7): the puppet is an optional kit. `humanoid(spec)`
// turns a v1-style art object into a v2 ArtDef, `v1ArtShim(art)` wraps v1 files.
// Additions (all opt-in, v1 output unchanged): chain anchors on any joint or a
// function, per-chain draw hooks, pre-settled chains, info.chains in hook space,
// art.hand/art.foot also run after art.arm/art.leg, weapon {draw, length},
// art.weaponLength, a `lower` layer (skirts) after the front leg, and grounded
// hops (pose.hop / move pose windup|strike .hop, in rig units, up = positive).
// ─────────────────────────────────────────────────────────────────────────────
import * as kit from './kit.js';
import { computePose, ANIMATIONS } from './anims.js';

export const DEFAULT_PALETTE = {
  skin: '#f1c3a0',
  primary: '#4a7bd6',
  secondary: '#2a2f45',
  accent: '#f2c14e',
  hair: '#2b1d16',
  eyes: '#2a6bd1',
  boots: '#1d1a24',
  gloves: null,
  outline: '#16121e',
  effect: '#7fd3ff',
  effect2: '#ffffff',
};

const DEFAULT_BUILD = { head: 1, torso: 1, arms: 1, legs: 1, thickness: 1, shoulders: 1, hips: 1 };

const dirv = (a) => ({ x: Math.sin(a), y: Math.cos(a) });
const add = (p, v, s) => ({ x: p.x + v.x * s, y: p.y + v.y * s });

/** Computes joint positions for a pose. All values in px, feet at (0,0), facing +x. */
export function buildRig(pose, H, buildIn, grounded) {
  const b = { ...DEFAULT_BUILD, ...buildIn };
  const u = H / 100;
  const legU = 20 * u * b.legs, legL = 20 * u * b.legs;
  const armU = 15 * u * b.arms, armL = 14 * u * b.arms;
  const torsoLen = 25 * u * b.torso;
  const headR = 14 * u * b.head;
  const footR = 4.4 * u * b.thickness;

  const hip = { x: pose.bx * u, y: -(legU + legL + footR) + pose.by * u };
  const up = { x: Math.sin(pose.lean), y: -Math.cos(pose.lean) };
  const fwd = { x: Math.cos(pose.lean), y: Math.sin(pose.lean) };
  const chest = add(hip, up, torsoLen);
  const neck = add(chest, up, 3 * u);
  const headAng = pose.lean + pose.head;
  const headC = add(neck, { x: Math.sin(headAng), y: -Math.cos(headAng) }, headR * 0.95);
  const shoulderBase = add(chest, up, -3.5 * u);
  const shoulderF = add(shoulderBase, fwd, 4.5 * u * b.shoulders);
  const shoulderB = add(shoulderBase, fwd, -4.5 * u * b.shoulders);
  const hipF = add(hip, fwd, 2.4 * u * b.hips);
  const hipB = add(hip, fwd, -2.4 * u * b.hips);

  const arm = (s, U, L) => {
    const aU = U + pose.lean;
    const elbow = add(s, dirv(aU), armU);
    const hand = add(elbow, dirv(aU + L), armL);
    return { shoulder: s, elbow, hand, angle: aU + L };
  };
  const leg = (h, U, L) => {
    const knee = add(h, dirv(U), legU);
    const foot = add(knee, dirv(U + L), legL);
    return { hip: h, knee, foot, angle: U + L };
  };
  const rig = {
    u, H, headR, footR, torsoLen, build: b,
    hip, chest, neck, headC, headAngle: headAng, lean: pose.lean, up, fwd,
    armF: arm(shoulderF, pose.fU, pose.fL),
    armB: arm(shoulderB, pose.bU, pose.bL),
    legF: leg(hipF, pose.flU, pose.flL),
    legB: leg(hipB, pose.blU, pose.blL),
  };
  if (grounded) {
    const lowest = Math.max(rig.legF.foot.y, rig.legB.foot.y) + footR;
    shiftRig(rig, -lowest);
  }
  return rig;
}

function shiftRig(rig, dy) {
  const mv = (p) => { p.y += dy; };
  [rig.hip, rig.chest, rig.neck, rig.headC].forEach(mv);
  for (const l of [rig.armF, rig.armB]) [l.shoulder, l.elbow, l.hand].forEach(mv);
  for (const l of [rig.legF, rig.legB]) [l.hip, l.knee, l.foot].forEach(mv);
}

/** Expression for default faces. */
function expressionFor(view, time) {
  if (view.state === 'hitstun') return 'hurt';
  if (view.state === 'shieldbreak') return 'dizzy';
  if (view.state === 'attack' || view.charging) return 'fierce';
  if (view.state === 'helpless') return 'worried';
  const t = (time + (view.index || 0) * 97) % 220;
  return t < 7 ? 'blink' : 'normal';
}

/**
 * Draws a fighter. The context must already be translated to the fighter's
 * feet and scaled by (facing, 1).
 * @param view    { state, stateFrame, grounded, vx, vy, move, moveFrame, charging, facing, x, y, tumble, index, time }
 * @param cache   a per-fighter object the renderer keeps between frames (for capes etc.)
 * @param extra   optional v2 info (art host): its keys are added to `info` where they don't
 *                collide with v1 keys and the whole object is `info.v2`; `extra.palette`
 *                (alt palette, already resolved) replaces the art palette.
 */
export function drawFighter(ctx, character, art, view, time, cache = {}, extra = null) {
  const stats = character.stats;
  const H = stats.height;
  const palette = extra?.palette ? { ...DEFAULT_PALETTE, ...extra.palette } : { ...DEFAULT_PALETTE, ...(art.palette || {}) };
  const poseView = { ...view, time };
  const pose = { ...computePose(poseView, stats) }; // copy: some states return frozen shared poses
  if (art.pose) Object.assign(pose, art.pose(pose, poseView) || {});
  const grounded = view.grounded && !['roll', 'airdodge', 'hitstun'].includes(view.state);
  const rig = buildRig(pose, H, art.build, grounded);
  if (grounded) {
    const hop = (pose.hop || 0) + moveHop(view);
    if (hop) shiftRig(rig, -hop * rig.u);
  }
  const center = { x: rig.hip.x, y: rig.hip.y - rig.torsoLen * 0.3 };
  const info = {
    kit, palette, rig, pose, H, W: stats.width, u: rig.u, time, view, state: view.state,
    expression: expressionFor(view, time), cache, character, back: false,
    color(key, back) { const c = palette[key] || key; return back ? kit.shade(c, -0.22) : c; },
  };
  const anim = view.move ? (view.move.pose || ANIMATIONS[view.move.anim]) : null;
  info.limb = anim?.limb || (view.move ? 'frontHand' : null); // leading limb of the current move
  if (extra) {
    for (const k in extra) if (!(k in info)) info[k] = extra[k];
    info.v2 = extra;
  }

  // Chains (capes, scarves, tails, ponytails) are simulated in world space.
  const bodyXform = (p) => {
    const sx = pose.sx, sy = pose.sy;
    let x = p.x * sx, y = p.y * sy;
    if (pose.spin) {
      const cx = center.x * sx, cy = center.y * sy;
      const c = Math.cos(pose.spin), s = Math.sin(pose.spin);
      const dx = x - cx, dy = y - cy;
      x = cx + dx * c - dy * s; y = cy + dx * s + dy * c;
    }
    return { x, y };
  };
  // Inverse: chain/local space → the space body hooks draw in (inside squash/spin).
  const toBody = (p) => {
    let x = p.x, y = p.y;
    if (pose.spin) {
      const cx = center.x * pose.sx, cy = center.y * pose.sy;
      const c = Math.cos(-pose.spin), s = Math.sin(-pose.spin);
      const dx = x - cx, dy = y - cy;
      x = cx + dx * c - dy * s; y = cy + dx * s + dy * c;
    }
    return { x: x / (pose.sx || 1), y: y / (pose.sy || 1) };
  };
  info.toBody = toBody;
  info.fromBody = bodyXform;
  if (art.chains) {
    // Integrate every chain first (both layers), so hooks see this frame's points.
    stepChains(art.chains, info, view, bodyXform);
    info.chains = chainViews(art.chains, info, view, toBody);
    drawChains(ctx, art.chains, info, view, 'back');
  }

  ctx.save();
  ctx.scale(pose.sx, pose.sy);
  if (pose.spin) {
    ctx.translate(center.x, center.y);
    ctx.rotate(pose.spin);
    ctx.translate(-center.x, -center.y);
  }

  if (art.draw) {
    art.draw(ctx, info);
  } else {
    art.back?.(ctx, info);
    drawArm(ctx, rig.armB, info, art, true);
    drawLeg(ctx, rig.legB, info, art, true);
    if (art.torso) art.torso(ctx, info); else defaultTorso(ctx, info, art);
    drawLeg(ctx, rig.legF, info, art, false);
    art.lower?.(ctx, info); // skirts, coats, tails over the legs
    drawHead(ctx, info, art);
    if (art.weapon) drawWeapon(ctx, rig.armF, info, art.weapon);
    drawArm(ctx, rig.armF, info, art, false);
    art.front?.(ctx, info);
  }
  ctx.restore();
  if (art.chains) drawChains(ctx, art.chains, info, view, 'front');
  return { rig, pose, palette };
}

// Grounded hop from a move's custom pose (windup.hop / strike.hop, rig units, up = +).
// Mirrors the phase timing of anims.js attackPose so hops line up with the swing.
function moveHop(view) {
  const m = view.move;
  const a = m?.pose;
  if (view.state !== 'attack' || !a || !(a.windup?.hop || a.strike?.hop)) return 0;
  const w = a.windup?.hop || 0, st = a.strike?.hop || 0;
  const fr = view.moveFrame || 0;
  const startup = Math.max(1, m.startup || 1);
  let activeEnd = startup;
  for (const h of m.hitboxes || []) activeEnd = Math.max(activeEnd, h.end);
  for (const p of m.projectiles || []) activeEnd = Math.max(activeEnd, p.start + 2);
  const eo = (t) => 1 - (1 - t) ** 3;
  if (fr < startup) return w * eo(Math.min(1, fr / Math.max(1, startup - 1)));
  if (fr <= activeEnd) return w + (st - w) * eo(Math.min(1, (fr - startup + 1) / 3));
  const k = Math.min(1, (fr - activeEnd) / Math.max(1, (m.duration || activeEnd + 1) - activeEnd));
  return st * (1 - k * k * (3 - 2 * k));
}

/** Rig-unit length of the weapon (tip distance from the hand) — for trails. */
export function weaponLength(art) {
  const w = art?.weapon;
  if (!w) return 0;
  if (typeof art.weaponLength === 'number') return art.weaponLength;
  // A function's own .length is its arity (0-3); bastion-style overrides set a real length.
  if (typeof w === 'function') return w.length > 3 ? w.length : 60;
  return typeof w.length === 'number' ? w.length : 60;
}

// ── Default parts ───────────────────────────────────────────────────────────
function drawArm(ctx, a, info, art, back) {
  const { u, rig } = info;
  const t = rig.build.thickness;
  const outline = info.palette.outline;
  const i2 = { ...info, back };
  if (art.arm) {
    art.arm(ctx, a, i2);
    if (art.hand) drawAt(ctx, a.hand, -a.angle, () => art.hand(ctx, i2));
    return;
  }
  kit.limb(ctx, a.shoulder, a.elbow, 5.8 * u * t, 4.9 * u * t, info.color(info.palette.sleeves || 'primary', back), { outline });
  kit.limb(ctx, a.elbow, a.hand, 4.9 * u * t, 4.2 * u * t, info.color(info.palette.forearms || 'skin', back), { outline });
  ctx.save();
  ctx.translate(a.hand.x, a.hand.y);
  ctx.rotate(-a.angle);
  if (art.hand) art.hand(ctx, i2);
  else kit.circle(ctx, 0, 0, 6 * u * t, info.color(info.palette.gloves || 'skin', back), { outline, gloss: 0.25 });
  ctx.restore();
}

function drawLeg(ctx, l, info, art, back) {
  const { u, rig } = info;
  const t = rig.build.thickness;
  const outline = info.palette.outline;
  const i2 = { ...info, back };
  if (art.leg) {
    art.leg(ctx, l, i2);
    if (art.foot) drawAt(ctx, l.foot, -l.angle, () => art.foot(ctx, i2));
    return;
  }
  kit.limb(ctx, l.hip, l.knee, 7.4 * u * t, 6 * u * t, info.color(info.palette.pants || 'secondary', back), { outline });
  kit.limb(ctx, l.knee, l.foot, 6 * u * t, 5 * u * t, info.color(info.palette.pants || 'secondary', back), { outline });
  ctx.save();
  ctx.translate(l.foot.x, l.foot.y);
  ctx.rotate(-l.angle);
  if (art.foot) art.foot(ctx, i2);
  else defaultBoot(ctx, i2);
  ctx.restore();
}

// Runs fn with the context at point p rotated by angle (hand/foot space).
function drawAt(ctx, p, angle, fn) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  try { fn(); } finally { ctx.restore(); }
}

function defaultBoot(ctx, info) {
  const { u, palette } = info;
  const t = info.rig.build.thickness;
  // In foot space the shin points along +y; the toe points along +x.
  ctx.beginPath();
  ctx.moveTo(-5.6 * u * t, -6 * u);
  ctx.lineTo(5 * u * t, -6 * u);
  ctx.quadraticCurveTo(13 * u * t, -1.5 * u, 13 * u * t, 3.2 * u);
  ctx.lineTo(-6 * u * t, 4.4 * u);
  ctx.closePath();
  kit.fillShaded(ctx, info.color('boots', info.back), { outline: palette.outline, r: 8 * u });
}

function defaultTorso(ctx, info, art) {
  const { rig, u, palette } = info;
  const b = rig.build;
  ctx.save();
  ctx.translate(rig.hip.x, rig.hip.y);
  ctx.rotate(rig.lean);
  const L = rig.torsoLen;
  const sw = 13 * u * b.shoulders, ww = 10 * u * b.hips, hw = 11 * u * b.hips;
  kit.blobPath(ctx, [[-hw, 2 * u], [-ww, -L * 0.45], [-sw, -L + 2 * u], [0, -L - 3 * u], [sw, -L + 2 * u], [ww * 1.05, -L * 0.45], [hw, 2 * u], [0, 5 * u]], 0.45);
  kit.fillShaded(ctx, palette.primary, { outline: palette.outline, y: -L / 2, r: L * 0.7, gloss: 0.12 });
  // Belt
  ctx.save();
  kit.blobPath(ctx, [[-hw, 2 * u], [-ww, -L * 0.45], [-sw, -L + 2 * u], [0, -L - 3 * u], [sw, -L + 2 * u], [ww * 1.05, -L * 0.45], [hw, 2 * u], [0, 5 * u]], 0.45);
  ctx.clip();
  ctx.fillStyle = palette.secondary;
  ctx.fillRect(-hw * 1.4, -4 * u, hw * 2.8, 6 * u);
  ctx.fillStyle = palette.accent;
  kit.roundRectPath(ctx, 1 * u, -4.5 * u, 5 * u, 6.5 * u, 1.2 * u);
  ctx.fill();
  // Collar / chest emblem
  ctx.fillStyle = kit.shade(palette.primary, -0.25);
  ctx.beginPath();
  ctx.moveTo(-3 * u, -L - 2 * u); ctx.lineTo(4 * u, -L * 0.72); ctx.lineTo(7 * u, -L - 1 * u);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawHead(ctx, info, art) {
  const { rig } = info;
  ctx.save();
  ctx.translate(rig.headC.x, rig.headC.y);
  ctx.rotate(rig.headAngle);
  if (art.head) art.head(ctx, info);
  else defaultHead(ctx, info, art);
  ctx.restore();
}

export function defaultHead(ctx, info, art = {}) {
  const { palette, rig } = info;
  const r = rig.headR;
  const hair = art.hair || { style: 'short' };
  const hairColor = hair.color || palette.hair;
  // hair behind head
  if (hair.style === 'long') {
    const sway = Math.sin(info.time * 0.08) * r * 0.08;
    kit.blobPath(ctx, [[-r * 0.2, -r * 0.9], [-r * 1.15, -r * 0.2], [-r * 1.25 + sway, r * 1.3], [-r * 0.5 + sway, r * 1.55], [r * 0.1, r * 0.4]], 0.5);
    kit.fillShaded(ctx, kit.shade(hairColor, -0.15), { outline: palette.outline, r: r * 1.4 });
  }
  if (hair.style === 'bun') kit.circle(ctx, -r * 0.85, -r * 0.55, r * 0.45, hairColor, { outline: palette.outline, gloss: 0.3 });
  // ear + skull
  kit.circle(ctx, 0, 0, r, palette.skin, { outline: palette.outline, gloss: 0.18 });
  kit.circle(ctx, -r * 0.12, r * 0.12, r * 0.2, kit.shade(palette.skin, -0.08), { outline: palette.outline, lineWidth: 2 });
  drawFace(ctx, info, r, art.face || {});
  drawHair(ctx, hair.style, hairColor, r, info);
  if (art.headgear) drawHeadgear(ctx, art.headgear, r, info);
}

/** Default anime-style face (also usable from custom heads via info.kit). */
export function drawFace(ctx, info, r, face = {}) {
  const { palette } = info;
  const ex = info.expression;
  const outline = palette.outline;
  const eyeColor = face.eyeColor || palette.eyes;
  const eye = (x, y, s) => {
    if (ex === 'blink') {
      ctx.strokeStyle = outline; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - r * 0.12 * s, y + r * 0.04); ctx.quadraticCurveTo(x, y + r * 0.1, x + r * 0.12 * s, y + r * 0.04); ctx.stroke();
      return;
    }
    if (ex === 'hurt') {
      ctx.strokeStyle = outline; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - r * 0.12 * s, y - r * 0.1); ctx.lineTo(x + r * 0.08 * s, y); ctx.lineTo(x - r * 0.12 * s, y + r * 0.1); ctx.stroke();
      return;
    }
    if (ex === 'dizzy') {
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < 18; i++) { const a = i * 0.7 + info.time * 0.2; const rr = (i / 18) * r * 0.14 * s; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.stroke();
      return;
    }
    const w = r * 0.15 * s, h = r * (face.eyeHeight || 0.24) * s;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.8; ctx.strokeStyle = outline; ctx.stroke();
    const ig = ctx.createLinearGradient(x, y - h, x, y + h);
    ig.addColorStop(0, kit.shade(eyeColor, -0.35)); ig.addColorStop(1, kit.shade(eyeColor, 0.25));
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.ellipse(x + w * 0.25, y + h * 0.08, w * 0.72, h * 0.72, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0910';
    ctx.beginPath(); ctx.ellipse(x + w * 0.3, y + h * 0.1, w * 0.36, h * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x + w * 0.05, y - h * 0.3, w * 0.28, 0, Math.PI * 2); ctx.fill();
    // brow
    ctx.strokeStyle = face.browColor || kit.shade(palette.hair, -0.2); ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath();
    const tilt = ex === 'fierce' ? 0.16 : ex === 'worried' ? -0.12 : 0.02;
    ctx.moveTo(x - w * 1.1, y - h * 1.35 - tilt * r * -0.4);
    ctx.lineTo(x + w * 1.1, y - h * 1.35 + tilt * r);
    ctx.stroke();
  };
  eye(r * 0.52, -r * 0.08, 1);
  eye(r * 0.08, -r * 0.1, 0.8);
  // mouth
  ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath();
  if (ex === 'fierce') { ctx.moveTo(r * 0.3, r * 0.45); ctx.lineTo(r * 0.62, r * 0.42); }
  else if (ex === 'hurt' || ex === 'dizzy') { ctx.ellipse(r * 0.46, r * 0.48, r * 0.09, r * 0.12, 0, 0, Math.PI * 2); }
  else if (ex === 'worried') { ctx.moveTo(r * 0.34, r * 0.5); ctx.quadraticCurveTo(r * 0.46, r * 0.42, r * 0.58, r * 0.5); }
  else { ctx.moveTo(r * 0.34, r * 0.42); ctx.quadraticCurveTo(r * 0.47, r * 0.52, r * 0.6, r * 0.42); }
  ctx.stroke();
  if (face.blush !== false) { kit.glow(ctx, r * 0.62, r * 0.25, r * 0.2, '#ff6b7a', 0.35); }
}

function drawHair(ctx, style, color, r, info) {
  const o = info.palette.outline;
  const opts = { outline: o, r: r * 1.2, gloss: 0.22 };
  switch (style) {
    case 'spiky': {
      const pts = [[r * 0.75, -r * 0.35], [r * 1.1, -r * 0.75], [r * 0.5, -r * 0.8], [r * 0.55, -r * 1.45], [r * 0.05, -r * 1.0],
        [-r * 0.35, -r * 1.6], [-r * 0.5, -r * 0.95], [-r * 1.25, -r * 1.1], [-r * 0.95, -r * 0.45], [-r * 1.5, -r * 0.2],
        [-r * 0.95, r * 0.15], [-r * 1.2, r * 0.55], [-r * 0.55, r * 0.35], [-r * 0.2, -r * 0.2], [r * 0.3, -r * 0.4]];
      kit.polygonPath(ctx, pts);
      kit.fillShaded(ctx, color, opts);
      kit.rimLight(ctx, [[-r * 0.3, -r * 1.45], [-r * 0.45, -r * 1.0]], '#fff', 2, 0.5);
      break;
    }
    case 'short': case 'long': case 'bun': {
      kit.blobPath(ctx, [[r * 0.95, -r * 0.2], [r * 0.85, -r * 0.8], [r * 0.1, -r * 1.12], [-r * 0.8, -r * 0.85], [-r * 1.08, -r * 0.1], [-r * 0.85, r * 0.55], [-r * 0.45, r * 0.25], [-r * 0.15, -r * 0.35], [r * 0.4, -r * 0.45]], 0.55);
      kit.fillShaded(ctx, color, opts);
      kit.rimLight(ctx, [[-r * 0.6, -r * 0.8], [r * 0.1, -r * 1.0], [r * 0.6, -r * 0.75]], '#fff', 2, 0.35);
      break;
    }
    case 'mohawk': {
      kit.blobPath(ctx, [[r * 0.5, -r * 0.8], [r * 0.2, -r * 1.6], [-r * 0.5, -r * 1.55], [-r * 1.0, -r * 0.9], [-r * 0.6, -r * 0.7]], 0.5);
      kit.fillShaded(ctx, color, opts);
      break;
    }
    default: break;
  }
}

function drawHeadgear(ctx, g, r, info) {
  const o = info.palette.outline;
  const color = g.color || info.palette.accent;
  switch (g.type) {
    case 'band':
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, r * 1.02, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = color; ctx.fillRect(-r * 1.2, -r * 0.62, r * 2.4, r * 0.3);
      ctx.restore();
      break;
    case 'horns':
      for (const s of [1, -0.55]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.35 * s, -r * 0.75); ctx.quadraticCurveTo(r * 0.9 * s, -r * 1.3, r * 0.55 * s + r * 0.3, -r * 1.75);
        ctx.quadraticCurveTo(r * 0.45 * s, -r * 1.15, r * 0.05 * s, -r * 0.9); ctx.closePath();
        kit.fillShaded(ctx, color, { outline: o, r });
      }
      break;
    case 'crown':
      kit.polygonPath(ctx, [[-r * 0.6, -r * 0.75], [-r * 0.7, -r * 1.35], [-r * 0.3, -r * 1.0], [0, -r * 1.5], [r * 0.3, -r * 1.0], [r * 0.7, -r * 1.35], [r * 0.6, -r * 0.75]]);
      kit.fillShaded(ctx, color, { outline: o, r, gloss: 0.5 });
      break;
    case 'helmet':
      kit.blobPath(ctx, [[r * 1.08, -r * 0.05], [r * 0.9, -r * 0.85], [0, -r * 1.18], [-r * 0.95, -r * 0.8], [-r * 1.12, r * 0.1], [-r * 0.9, r * 0.75], [-r * 0.3, r * 0.2], [r * 0.25, -r * 0.2]], 0.5);
      kit.fillShaded(ctx, color, { outline: o, r: r * 1.2, gloss: 0.45 });
      break;
    default: break;
  }
}

export function drawWeapon(ctx, arm, info, w) {
  // Function weapon, or {draw, length}: draw in hand space, +x along the forearm.
  const fn = typeof w === 'function' ? w : typeof w.draw === 'function' ? (c, i) => w.draw(c, i) : null;
  if (fn) {
    ctx.save(); ctx.translate(arm.hand.x, arm.hand.y); ctx.rotate(-arm.angle + Math.PI / 2 + (fn === w ? 0 : w.angle || 0));
    fn(ctx, info); ctx.restore(); return;
  }
  const { u, palette } = info;
  const len = (w.length || 60) * u;
  const color = w.color || '#d8e2f0';
  const o = palette.outline;
  ctx.save();
  ctx.translate(arm.hand.x, arm.hand.y);
  // Along the forearm direction; +x points away from the hand.
  ctx.rotate(-arm.angle + Math.PI / 2 + (w.angle || 0));
  const attacking = info.state === 'attack';
  if (w.glow && attacking) kit.glow(ctx, len * 0.6, 0, len * 0.55, w.glow, 0.45);
  switch (w.type) {
    case 'sword': {
      ctx.fillStyle = w.grip || '#4a2e22';
      kit.roundRectPath(ctx, -9 * u, -2 * u, 12 * u, 4 * u, 1.5 * u); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = o; ctx.stroke();
      kit.polygonPath(ctx, [[3 * u, -2.2 * u], [len - 8 * u, -2.6 * u], [len, 0], [len - 8 * u, 2.6 * u], [3 * u, 2.2 * u]]);
      kit.fillShaded(ctx, color, { outline: o, r: len / 2, x: len / 2, gloss: 0.4 });
      kit.rimLight(ctx, [[5 * u, -1.2 * u], [len - 9 * u, -1.4 * u]], '#fff', 1.6, 0.8);
      kit.roundRectPath(ctx, 1 * u, -7 * u, 3.5 * u, 14 * u, 1.5 * u);
      kit.fillShaded(ctx, w.guard || palette.accent, { outline: o, r: 8 * u });
      break;
    }
    case 'staff': {
      kit.capsulePath(ctx, -len * 0.35, 0, len, 0, 1.8 * u, 1.8 * u);
      kit.fillShaded(ctx, w.shaft || '#6b4630', { outline: o, r: len / 2, x: len / 2 });
      const orb = w.gem || palette.effect;
      kit.glow(ctx, len + 3 * u, 0, 16 * u, orb, 0.55 + Math.sin(info.time * 0.12) * 0.15);
      kit.circle(ctx, len + 3 * u, 0, 5 * u, orb, { outline: o, gloss: 0.7 });
      break;
    }
    case 'hammer': {
      kit.capsulePath(ctx, -6 * u, 0, len, 0, 2 * u, 2 * u);
      kit.fillShaded(ctx, w.shaft || '#5d3b26', { outline: o, r: len / 2, x: len / 2 });
      kit.roundRectPath(ctx, len - 8 * u, -12 * u, 16 * u, 24 * u, 3 * u);
      kit.fillShaded(ctx, color, { outline: o, x: len, r: 14 * u, gloss: 0.35 });
      break;
    }
    case 'spear': {
      kit.capsulePath(ctx, -len * 0.3, 0, len, 0, 1.6 * u, 1.6 * u);
      kit.fillShaded(ctx, w.shaft || '#6b4630', { outline: o, r: len / 2, x: len / 2 });
      kit.polygonPath(ctx, [[len - 2 * u, -4 * u], [len + 14 * u, 0], [len - 2 * u, 4 * u]]);
      kit.fillShaded(ctx, color, { outline: o, x: len, r: 10 * u, gloss: 0.5 });
      break;
    }
    default: break;
  }
  ctx.restore();
}

// ── Chains: capes, scarves, tails, ponytails ────────────────────────────────
// art.chains = [{ anchor, length: 60, segments: 7, width: 18, endWidth: 6, color, color2,
//                 layer: 'back'|'front', stiffness: 0.35, gravity: 1, presettle: true,
//                 draw?(ctx, pts, info, chain) }]
// anchor: 'neck' | 'head' | 'hip' | 'back' | 'chest' | 'headTop' | 'shoulderF|B' | 'elbowF|B' | 'handF|B'
//         | 'hipF|B' | 'kneeF|B' | 'footF|B' | {joint, x, y} (offset in rig units) | (rig, info) => {x, y}
// Points live in world space (info.cache.chains[i].pts, v1 shape). info.chains[i] gives
// {pts (chain space, where ribbons draw), body (hook space, inside squash/spin), anchor}.
const JOINTS = {
  chest: (r) => r.chest, headTop: (r) => ({ x: r.headC.x, y: r.headC.y - r.headR }), headC: (r) => r.headC,
  shoulderF: (r) => r.armF.shoulder, shoulderB: (r) => r.armB.shoulder, elbowF: (r) => r.armF.elbow, elbowB: (r) => r.armB.elbow,
  handF: (r) => r.armF.hand, handB: (r) => r.armB.hand, hipF: (r) => r.legF.hip, hipB: (r) => r.legB.hip,
  kneeF: (r) => r.legF.knee, kneeB: (r) => r.legB.knee, footF: (r) => r.legF.foot, footB: (r) => r.legB.foot,
  hipC: (r) => r.hip, neckC: (r) => r.neck,
};
function anchorPoint(rig, a, info) {
  if (typeof a === 'function') {
    const p = a(rig, info);
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : anchorPoint(rig, 'neck');
  }
  if (a && typeof a === 'object') {
    const base = a.joint ? anchorPoint(rig, a.joint, info) : { x: 0, y: 0 };
    return { x: base.x + (a.x || 0) * rig.u, y: base.y + (a.y || 0) * rig.u };
  }
  switch (a) {
    case 'head': return { x: rig.headC.x - rig.headR * 0.8, y: rig.headC.y - rig.headR * 0.2 };
    case 'hip': return { x: rig.hip.x - 6 * rig.u, y: rig.hip.y - 2 * rig.u };
    case 'back': return { x: rig.chest.x - 5 * rig.u, y: rig.chest.y + 6 * rig.u };
    case 'neck': return { x: rig.neck.x - 3 * rig.u, y: rig.neck.y + 2 * rig.u };
    default: {
      const j = JOINTS[a];
      if (j) { const p = j(rig); return { x: p.x, y: p.y }; }
      return { x: rig.neck.x - 3 * rig.u, y: rig.neck.y + 2 * rig.u };
    }
  }
}

// One verlet step (v1 math, unchanged) followed by 4 constraint passes.
function integrateChain(st, c, ci, n, seg, facing, time, ax, ay, wind = true) {
  const stiff = c.stiffness ?? 0.35;
  const w = wind ? Math.sin(time * 0.05 + ci) * 0.15 : 0;
  for (let i = 1; i <= n; i++) {
    const p = st.pts[i];
    const vx = (p.x - p.px) * 0.9, vy = (p.y - p.py) * 0.9;
    p.px = p.x; p.py = p.y;
    p.x += vx + w - facing * stiff * 0.6;
    p.y += vy + 0.55 * (c.gravity ?? 1);
  }
  st.pts[0].x = ax; st.pts[0].y = ay; st.pts[0].px = ax; st.pts[0].py = ay;
  for (let k = 0; k < 4; k++) {
    for (let i = 1; i <= n; i++) {
      const a = st.pts[i - 1], b = st.pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const diff = (d - seg) / d;
      if (i === 1) { b.x -= dx * diff; b.y -= dy * diff; } else {
        a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
        b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
      }
    }
  }
}

function stepChains(chains, info, view, xform) {
  const facing = view.facing || 1;
  const cache = info.cache;
  cache.chains ||= [];
  chains.forEach((c, ci) => {
    const n = c.segments || 7;
    const seg = ((c.length || 60) * info.u) / n;
    const local = xform(anchorPoint(info.rig, c.anchor, info));
    const ax = view.x + local.x * facing, ay = view.y + local.y;
    let st = cache.chains[ci];
    if (!st || Math.hypot(st.pts[0].x - ax, st.pts[0].y - ay) > 260 || st.n !== n) {
      st = cache.chains[ci] = { n, pts: Array.from({ length: n + 1 }, (_, i) => ({ x: ax - facing * i * seg, y: ay + i * 2, px: ax - facing * i * seg, py: ay + i * 2 })) };
      // Pre-settle so first frames (and portraits) don't show a cape sticking out sideways.
      if (c.presettle !== false) {
        for (let k = 0; k < 48; k++) integrateChain(st, c, ci, n, seg, facing, 0, ax, ay, false);
        for (const p of st.pts) { p.px = p.x; p.py = p.y; }
      }
    }
    // Only integrate once per rendered frame.
    if (st.t !== info.time) {
      st.t = info.time;
      integrateChain(st, c, ci, n, seg, facing, info.time, ax, ay);
    }
  });
}

function chainViews(chains, info, view, toBody) {
  const facing = view.facing || 1;
  return chains.map((c, ci) => {
    const st = info.cache.chains[ci];
    const pts = st.pts.map((p) => ({ x: (p.x - view.x) * facing, y: p.y - view.y }));
    return { pts, body: pts.map(toBody), anchor: pts[0], layer: c.layer || 'back' };
  });
}

function drawChains(ctx, chains, info, view, layer) {
  chains.forEach((c, ci) => {
    if ((c.layer || 'back') !== layer) return;
    const n = info.cache.chains[ci].n;
    // Ribbon in local (flipped) space
    const pts = info.chains[ci].pts;
    if (typeof c.draw === 'function') {
      ctx.save();
      try { c.draw(ctx, pts, info, c); } finally { ctx.restore(); }
      return;
    }
    const w0 = (c.width || 16) * info.u * 0.5, w1 = (c.endWidth ?? 4) * info.u * 0.5;
    const left = [], right = [];
    for (let i = 0; i <= n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const w = w0 + (w1 - w0) * (i / n);
      left.push([pts[i].x - (dy / d) * w, pts[i].y + (dx / d) * w]);
      right.push([pts[i].x + (dy / d) * w, pts[i].y - (dx / d) * w]);
    }
    ctx.beginPath();
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    right.reverse().forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    const g = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[n].x, pts[n].y);
    const c1 = info.palette[c.color] || c.color || info.palette.primary; // palette key or colour
    g.addColorStop(0, c1);
    g.addColorStop(1, info.palette[c.color2] || c.color2 || kit.shade(c1, -0.35));
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = info.palette.outline;
    ctx.stroke();
    ctx.fillStyle = g;
    ctx.fill();
  });
}

/** Draws a head-and-shoulders portrait centered in a box of `size` px. */
export function drawPortrait(ctx, character, art, size, time = 0, extra = null) {
  const H = character.stats.height;
  const view = { state: 'idle', stateFrame: 0, grounded: true, vx: 0, vy: 0, facing: 1, x: 0, y: 0 };
  // Locate the head for this character's proportions, then frame it.
  const rig = buildRig(computePose(view, character.stats), H, art.build, true);
  const zoom = (size * 0.26) / rig.headR;
  ctx.save();
  ctx.translate(size / 2 - rig.headC.x * zoom, size * 0.44 - rig.headC.y * zoom);
  ctx.scale(zoom, zoom);
  drawFighter(ctx, character, art, view, time, {}, extra);
  ctx.restore();
}

// ── v2 ArtDef wrappers (§6.7, §8) ───────────────────────────────────────────
// Both draw through drawFighter with the v1 `info` shape. The art host supplies
// `info.legacy = {character, view, time}`: a v1-shaped character (stats.width/height,
// moves with hitboxes/projectiles/startup), the v1 view (move = that v1 move,
// moveFrame, doubleJumpFlip…) and the v1 frame clock. Everything else on the v2 info
// (phase, hitboxes, light, fx, rng…) is merged in where it doesn't collide.
const ART_PASSTHROUGH = ['palettes', 'assets', 'sheets', 'clips', 'init', 'drawBack', 'drawWorld', 'entities', 'projectile', 'fx', 'sounds', 'hud', 'forms'];

/**
 * Humanoid puppet as an ArtDef. `spec` is a v1-style art object (palette, build, hair,
 * headgear, weapon, chains, pose, hooks head/torso/arm/leg/hand/foot/back/front/lower,
 * or a v1 `draw(ctx, info)`).
 */
export function humanoid(spec = {}) {
  const def = {
    rig: 'humanoid',
    kind: 'humanoid',
    spec,
    palette: { ...DEFAULT_PALETTE, ...(spec.palette || {}) },
    bounds: spec.bounds || null,
    // No explicit bounds: keep v1's offscreen canvas (3.4·H square, feet at 68%).
    legacyCanvas: !spec.bounds,
    draw(ctx, view, info) {
      const L = info.legacy;
      const drawn = drawFighter(ctx, L.character, spec, L.view, L.time, info.cache, info);
      info.cache.__drawn = drawn;
      return drawn;
    },
    trail(view, info) { return humanoidTrail(info, spec); },
    portrait(ctx, size, info) {
      const L = info.legacy;
      drawPortrait(ctx, L.character, spec, size, 0, { palette: info.palette });
    },
  };
  for (const k of ART_PASSTHROUGH) if (spec[k] !== undefined) def[k] = spec[k];
  if (spec.portrait !== undefined && typeof spec.portrait !== 'function') def.portrait = spec.portrait;
  if (typeof spec.trail === 'function' || spec.trail === false) def.trail = spec.trail;
  return def;
}

/** v1 `art` with a full `draw(ctx, info)`: same pipeline, flagged for the art host. */
export function v1ArtShim(art = {}) {
  return { ...humanoid(art), kind: 'v1shim' };
}

/**
 * v1 swing-trail point (body space, after squash/spin), or false when no trail this
 * frame. Uses the last drawn rig (info.cache.__drawn) — call after draw.
 */
export function humanoidTrail(info, spec = {}) {
  const L = info.legacy;
  const v = L.view, move = v.move, drawn = info.cache.__drawn;
  const active = move && v.state === 'attack' && (move.hitboxes || []).some((h) => v.moveFrame >= h.start - 1 && v.moveFrame <= h.end + 1);
  if (!active || !drawn) return false;
  const st = L.character.stats;
  const a = move.pose || ANIMATIONS[move.anim];
  const limb = a?.limb || 'frontHand';
  const { rig, pose } = drawn;
  let p = limb === 'frontFoot' ? rig.legF.foot : limb === 'backFoot' ? rig.legB.foot : limb === 'head' ? rig.headC : limb === 'body' ? null : rig.armF.hand;
  if (spec.weapon && limb === 'frontHand') {
    const len = weaponLength(spec) * rig.u;
    p = { x: p.x + Math.sin(rig.armF.angle) * len, y: p.y + Math.cos(rig.armF.angle) * len };
  }
  if (!p) {
    // spinning moves: trace an arc around the body
    const ang = pose.spin * 1.0 + L.time * 0.6;
    return { x: Math.cos(ang) * st.width, y: -st.height / 2 + Math.sin(ang) * st.height * 0.45 };
  }
  // apply squash & spin to match the drawn sprite
  let x = p.x * pose.sx, y = p.y * pose.sy;
  if (pose.spin) {
    const cx = rig.hip.x * pose.sx, cy = (rig.hip.y - rig.torsoLen * 0.3) * pose.sy;
    const c = Math.cos(pose.spin), s = Math.sin(pose.spin);
    const dx = x - cx, dy = y - cy;
    x = cx + dx * c - dy * s; y = cy + dx * s + dy * c;
  }
  return { x, y };
}
