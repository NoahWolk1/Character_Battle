// ─────────────────────────────────────────────────────────────────────────────
// MIRELLE — art module (imported by character.js).
//
// A showcase of the puppet hook system:
//   • back()   → long hair mass, robe train, waterspout behind her (up-special)
//   • head()   → face (reuses the engine's drawFace) + bangs + wide witch hat
//   • torso()  → bodice, corset lacing, shell capelet, pearls
//   • arm()    → fitted sleeve + flowing bell cuff + hand (replaces hand hook)
//   • leg()    → tights + heeled boots; the FRONT leg call also paints the
//                layered skirt so it sits over both legs but under the front arm
//   • weapon() → coral-and-pearl staff (held upright when not attacking)
//   • front()  → move VFX: geyser, crashing wave, bubble ward, riptide ring...
//   • projectile() → tide orb, pearls and rolling waves
//   • chains   → physics hair locks + a sash ribbon
// Everything is in rig space: +x = facing, +y = down, units scale with info.u.
// ─────────────────────────────────────────────────────────────────────────────
import * as kit from '../../shared/art/kit.js';
import { drawFace } from '../../shared/art/puppet.js';

// Base colours. Every hook draws from C, which is rebound to the resolved palette
// (alt palettes for duplicate picks) at the start of each hook call.
const BASE = Object.freeze({
  skin: '#f6d7c6',
  teal: '#138c95',
  tealDark: '#0b5a6c',
  midnight: '#1c2660',
  midnightDark: '#121a45',
  deep: '#11407e',
  foam: '#9ff0df',
  foamLight: '#e6fff8',
  pearl: '#f7f1e6',
  gold: '#efc458',
  goldDark: '#a9772b',
  coral: '#ff7d6b',
  coralDark: '#c4484e',
  hairTop: '#3fd2c4',
  hair: '#179daa',
  hairDeep: '#1b5aa6',
  hairEnd: '#1d2f7a',
  wood: '#e2cfae',
  orb: '#7af5ec',
  eyes: '#25c7bb',
  outline: '#0a0f26',
});
export const C = { ...BASE };

/** Rebinds C to a resolved palette (keys missing from it keep the base colour). */
function usePalette(p) { for (const k in BASE) C[k] = (p && p[k]) || BASE[k]; }
/** Wraps a hook so C matches the palette of whoever is being drawn (info / projectile p). */
function withPalette(fn) {
  const w = function (ctx, ...args) {
    usePalette(args[args.length - 1]?.palette); // info (or the projectile record) is always last
    return fn(ctx, ...args);
  };
  Object.defineProperty(w, 'length', { value: fn.length });
  return w;
}

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const add = (p, v, s) => ({ x: p.x + v.x * s, y: p.y + v.y * s });

/** Velocity in local space (+x = the way she faces). */
function vel(info) {
  const v = info.view || {};
  return { vx: (v.vx || 0) * (v.facing || 1), vy: v.vy || 0 };
}

/** Current attack (slot, frame, and the balanced move) or null. */
function attack(info) {
  const v = info.view || {};
  if (v.state !== 'attack' || !v.move) return null;
  return { slot: v.move.slot, f: v.moveFrame || 0, m: v.move };
}

/** Active window of a move (first hitbox/projectile start → last end). */
function windowOf(m) {
  let s = Infinity, e = 0;
  for (const h of m.hitboxes) { s = Math.min(s, h.start); e = Math.max(e, h.end); }
  for (const p of m.projectiles) { s = Math.min(s, p.start); e = Math.max(e, p.start); }
  return { s: Number.isFinite(s) ? s : 0, e };
}

function strokeFill(ctx, fill, outline = C.outline, lw = 2.6) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (outline) { ctx.lineWidth = lw; ctx.strokeStyle = outline; ctx.stroke(); }
  ctx.fillStyle = fill;
  ctx.fill();
}

function dk(color, back) { return back ? kit.mix(color, '#1a1440', 0.3) : color; }

// ── Hair ──────────────────────────────────────────────────────────────────
function hairGradient(ctx, x0, y0, x1, y1, back) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, dk(C.hairTop, back));
  g.addColorStop(0.35, dk(C.hair, back));
  g.addColorStop(0.75, dk(C.hairDeep, back));
  g.addColorStop(1, dk(C.hairEnd, back));
  return g;
}

function backHair(ctx, info) {
  const { rig, time } = info;
  const r = rig.headR;
  const { vx, vy } = vel(info);
  const sway = Math.sin(time * 0.055) * r * 0.12;
  const trail = clamp(vx * 1.1, -r * 0.4, r * 1.4);
  const lift = clamp(vy * 0.9, -r * 0.5, r * 1.3);
  ctx.save();
  ctx.translate(rig.headC.x, rig.headC.y);
  ctx.rotate(rig.headAngle * 0.6);
  const ex = -r * 0.75 - trail + sway, ey = r * 2.75 - lift;
  const pts = [
    [r * 0.5, -r * 0.9], [-r * 0.35, -r * 1.12], [-r * 1.12, -r * 0.55], [-r * 1.32 - trail * 0.25, r * 0.55],
    [-r * 1.4 - trail * 0.65 + sway * 0.5, r * 1.75 - lift * 0.5], [ex - r * 0.55, ey - r * 0.1], [ex - r * 0.05, ey - r * 0.25],
    [ex + r * 0.3, ey + r * 0.2], [ex + r * 0.55, ey - r * 0.35], [-r * 0.2 - trail * 0.4, r * 1.55 - lift * 0.4],
    [r * 0.15, r * 0.8], [r * 0.45, 0],
  ];
  kit.blobPath(ctx, pts, 0.55);
  strokeFill(ctx, hairGradient(ctx, 0, -r, ex, ey), C.outline, 3);
  // strands
  ctx.save();
  kit.blobPath(ctx, pts, 0.55);
  ctx.clip();
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const k = i / 3;
    ctx.strokeStyle = i % 2 ? kit.rgba(C.foamLight, 0.28) : kit.rgba(C.hairEnd, 0.45);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-r * (0.2 + k * 0.8), -r * 0.8);
    ctx.quadraticCurveTo(-r * (1.2 + k * 0.1) - trail * 0.4, r * 0.8, ex - r * 0.3 + k * r * 0.6, ey - r * 0.2);
    ctx.stroke();
  }
  ctx.restore();
  kit.rimLight(ctx, [[-r * 0.4, -r * 1.0], [-r * 1.05, -r * 0.45], [-r * 1.22 - trail * 0.25, r * 0.5]], C.foamLight, 2, 0.45);
  ctx.restore();
}

function bangs(ctx, r, info) {
  // side lock in front of the ear, swaying
  const sway = Math.sin(info.time * 0.06 + 1) * r * 0.08;
  const { vx } = vel(info);
  const tr = clamp(vx * 0.4, -r * 0.2, r * 0.5);
  ctx.beginPath();
  ctx.moveTo(-r * 0.45, -r * 0.4);
  ctx.quadraticCurveTo(-r * 0.05, r * 0.4, -r * 0.05 + sway - tr, r * 1.45);
  ctx.quadraticCurveTo(-r * 0.3 + sway - tr, r * 1.05, -r * 0.55, r * 0.55);
  ctx.quadraticCurveTo(-r * 0.75, r * 0.0, -r * 0.45, -r * 0.4);
  strokeFill(ctx, hairGradient(ctx, 0, -r * 0.4, 0, r * 1.45), C.outline, 2.4);

  // crown + swept bangs with sharp tips
  ctx.beginPath();
  ctx.moveTo(-r * 0.62, r * 0.42);
  ctx.quadraticCurveTo(-r * 1.15, -r * 0.1, -r * 0.85, -r * 0.7);
  ctx.quadraticCurveTo(-r * 0.4, -r * 1.2, r * 0.25, -r * 1.08);
  ctx.quadraticCurveTo(r * 0.9, -r * 0.92, r * 1.06, -r * 0.3);
  ctx.quadraticCurveTo(r * 0.92, -r * 0.42, r * 0.84, -r * 0.18); // tip 1 (over front eye)
  ctx.quadraticCurveTo(r * 0.78, -r * 0.45, r * 0.6, -r * 0.5);
  ctx.quadraticCurveTo(r * 0.55, -r * 0.3, r * 0.4, -r * 0.12); // tip 2
  ctx.quadraticCurveTo(r * 0.36, -r * 0.42, r * 0.18, -r * 0.55);
  ctx.quadraticCurveTo(r * 0.05, -r * 0.35, -r * 0.08, -r * 0.2); // tip 3
  ctx.quadraticCurveTo(-r * 0.12, -r * 0.45, -r * 0.3, -r * 0.5);
  ctx.quadraticCurveTo(-r * 0.4, -r * 0.1, -r * 0.62, r * 0.42);
  ctx.closePath();
  strokeFill(ctx, hairGradient(ctx, r * 0.2, -r * 1.1, -r * 0.2, r * 0.5), C.outline, 2.6);
  // sheen
  kit.rimLight(ctx, [[-r * 0.7, -r * 0.62], [-r * 0.2, -r * 0.95], [r * 0.35, -r * 0.92]], '#ffffff', 2, 0.5);
  ctx.strokeStyle = kit.rgba(C.hairEnd, 0.5); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(r * 0.1, -r * 0.95); ctx.quadraticCurveTo(r * 0.55, -r * 0.7, r * 0.62, -r * 0.48); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.9); ctx.quadraticCurveTo(r * 0.05, -r * 0.6, r * 0.12, -r * 0.45); ctx.stroke();
}

// ── Hat ───────────────────────────────────────────────────────────────────
function shell(ctx, x, y, s, rot) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.55);
  ctx.lineTo(-s * 0.95, -s * 0.25);
  ctx.quadraticCurveTo(-s * 0.85, -s * 1.0, 0, -s * 1.05);
  ctx.quadraticCurveTo(s * 0.85, -s * 1.0, s * 0.95, -s * 0.25);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -s, 0, s * 0.5);
  g.addColorStop(0, '#fff3ec'); g.addColorStop(0.6, '#ffc2b4'); g.addColorStop(1, C.coral);
  strokeFill(ctx, g, C.outline, 1.8);
  ctx.strokeStyle = kit.rgba(C.coralDark, 0.75); ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(0, s * 0.45); ctx.lineTo(i * s * 0.36, -s * 0.9 + Math.abs(i) * s * 0.18); ctx.stroke(); }
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, s * 0.4); ctx.lineTo(0, s * 0.75); ctx.lineTo(s * 0.35, s * 0.4); ctx.closePath();
  strokeFill(ctx, '#ffd9cc', C.outline, 1.4);
  ctx.restore();
}

function starfish(ctx, x, y, s, rot, color = C.gold) {
  kit.starPath(ctx, x, y, 5, s, s * 0.45, rot);
  strokeFill(ctx, color, C.outline, 1.6);
  ctx.fillStyle = kit.rgba('#ffffff', 0.55);
  ctx.beginPath(); ctx.arc(x - s * 0.15, y - s * 0.15, s * 0.18, 0, TAU); ctx.fill();
}

function pearl(ctx, x, y, s) {
  ctx.beginPath(); ctx.arc(x, y, s, 0, TAU);
  const g = ctx.createRadialGradient(x - s * 0.35, y - s * 0.4, 0, x, y, s);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, C.pearl); g.addColorStop(1, '#c9c1d8');
  strokeFill(ctx, g, C.outline, 1.2);
}

function hat(ctx, r, info) {
  const { vy } = vel(info);
  const bob = clamp(-vy * 0.012, -0.08, 0.1); // brim lifts a little while falling
  ctx.save();
  ctx.translate(0, -r * 0.62);
  ctx.rotate(-0.12 + bob);
  // Brim (underside then top)
  ctx.beginPath(); ctx.ellipse(r * 0.05, r * 0.02, r * 1.8, r * 0.38, 0, 0, TAU);
  strokeFill(ctx, C.midnightDark, C.outline, 3);
  ctx.beginPath(); ctx.ellipse(r * 0.05, -r * 0.03, r * 1.72, r * 0.3, 0, Math.PI, TAU);
  ctx.ellipse(r * 0.05, -r * 0.03, r * 1.72, r * 0.16, 0, 0, Math.PI);
  const bg = ctx.createLinearGradient(-r * 1.7, 0, r * 1.7, 0);
  bg.addColorStop(0, kit.shade(C.midnight, -0.1)); bg.addColorStop(0.6, kit.shade(C.midnight, 0.18)); bg.addColorStop(1, C.midnight);
  ctx.fillStyle = bg; ctx.fill();

  // Cone, bent backward with a drooping tip
  const sw = Math.sin(info.time * 0.045) * r * 0.08 - clamp(vel(info).vx * 0.05, -0.3, 0.3) * r;
  const cone = () => {
    ctx.beginPath();
    ctx.moveTo(-r * 0.82, -r * 0.02);
    ctx.quadraticCurveTo(-r * 0.6, -r * 0.95, -r * 0.5, -r * 1.35);
    ctx.quadraticCurveTo(-r * 0.75 + sw * 0.5, -r * 1.7, -r * 1.42 + sw, -r * 1.58);
    ctx.quadraticCurveTo(-r * 0.75 + sw * 0.4, -r * 2.05, -r * 0.05, -r * 1.5);
    ctx.quadraticCurveTo(r * 0.55, -r * 0.9, r * 0.9, -r * 0.02);
    ctx.quadraticCurveTo(0, r * 0.12, -r * 0.82, -r * 0.02);
    ctx.closePath();
  };
  cone();
  const cg = ctx.createLinearGradient(-r * 0.9, -r * 1.6, r * 0.9, 0);
  cg.addColorStop(0, kit.shade(C.midnight, 0.25)); cg.addColorStop(0.5, C.midnight); cg.addColorStop(1, C.midnightDark);
  strokeFill(ctx, cg, C.outline, 3);
  ctx.save();
  cone(); ctx.clip();
  // band: teal with gold piping
  ctx.fillStyle = C.teal; ctx.fillRect(-r * 1.2, -r * 0.42, r * 2.4, r * 0.36);
  ctx.fillStyle = C.gold; ctx.fillRect(-r * 1.2, -r * 0.45, r * 2.4, r * 0.07); ctx.fillRect(-r * 1.2, -r * 0.09, r * 2.4, r * 0.06);
  // sparkle dots like stars on the night-blue fabric
  ctx.fillStyle = kit.rgba(C.foamLight, 0.75);
  for (const [x, y, s] of [[-0.25, -0.75, 0.05], [0.2, -1.0, 0.04], [-0.55, -1.15, 0.035], [0.35, -0.6, 0.03]]) {
    ctx.beginPath(); ctx.arc(x * r, y * r, s * r, 0, TAU); ctx.fill();
  }
  ctx.restore();
  kit.rimLight(ctx, [[-r * 0.7, -r * 0.3], [-r * 0.55, -r * 1.0], [-r * 0.6, -r * 1.42]], C.foam, 1.8, 0.45);
  // tip charm
  ctx.strokeStyle = C.goldDark; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-r * 1.4 + sw, -r * 1.58); ctx.lineTo(-r * 1.45 + sw * 1.3, -r * 1.2); ctx.stroke();
  starfish(ctx, -r * 1.45 + sw * 1.3, -r * 1.12, r * 0.2, info.time * 0.03);
  // ornaments on the band
  shell(ctx, r * 0.42, -r * 0.27, r * 0.3, 0.15);
  starfish(ctx, -r * 0.2, -r * 0.3, r * 0.17, 0.4, C.coral);
  pearl(ctx, r * 0.02, -r * 0.2, r * 0.08);
  // front lip of the brim with gold trim
  ctx.beginPath(); ctx.ellipse(r * 0.05, r * 0.02, r * 1.8, r * 0.38, 0, 0.05, Math.PI - 0.05);
  ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}

// ── Body parts ────────────────────────────────────────────────────────────
function head(ctx, info) {
  const r = info.rig.headR;
  // neck (drawn here so it overlaps the collar correctly)
  kit.capsulePath(ctx, -r * 0.12, r * 0.55, -r * 0.05, r * 1.25, r * 0.24, r * 0.26);
  strokeFill(ctx, kit.shade(C.skin, -0.12), C.outline, 2.2);
  // face
  kit.circle(ctx, 0, 0, r, C.skin, { outline: C.outline, gloss: 0.15, lineWidth: 2.8 });
  // soft jaw shadow + cheek
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
  ctx.fillStyle = kit.rgba('#c58a8a', 0.18);
  ctx.beginPath(); ctx.ellipse(-r * 0.45, r * 0.55, r * 0.8, r * 0.5, 0, 0, TAU); ctx.fill();
  ctx.restore();
  drawFace(ctx, info, r, { eyeColor: C.eyes, browColor: '#14506e', eyeHeight: 0.27 });
  // lashes on the near eye
  const ex = info.expression;
  if (ex !== 'blink' && ex !== 'hurt' && ex !== 'dizzy') {
    const x = r * 0.52, y = -r * 0.08, w = r * 0.15, h = r * 0.27;
    ctx.strokeStyle = C.outline; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - w * 1.1, y - h * 0.55);
    ctx.quadraticCurveTo(x, y - h * 1.2, x + w * 1.25, y - h * 0.75);
    ctx.lineTo(x + w * 1.8, y - h * 1.05);
    ctx.stroke();
    // tiny lip color
    ctx.fillStyle = kit.rgba('#e0607a', 0.55);
    ctx.beginPath(); ctx.ellipse(r * 0.48, r * 0.47, r * 0.08, r * 0.04, 0, 0, TAU); ctx.fill();
  }
  // pearl earring peeking under the side lock
  ctx.strokeStyle = C.goldDark; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-r * 0.12, r * 0.3); ctx.lineTo(-r * 0.1, r * 0.5); ctx.stroke();
  pearl(ctx, -r * 0.1, r * 0.56, r * 0.1);
  bangs(ctx, r, info);
  hat(ctx, r, info);
}

function torso(ctx, info) {
  const { rig, u } = info;
  const L = rig.torsoLen;
  ctx.save();
  ctx.translate(rig.hip.x, rig.hip.y);
  ctx.rotate(rig.lean);
  const body = () => kit.blobPath(ctx, [[-7.5 * u, 3 * u], [-8 * u, -L * 0.45], [-10.5 * u, -L + 3 * u], [-4 * u, -L - 1.5 * u], [5 * u, -L - 1.5 * u],
    [10.5 * u, -L + 3 * u], [8.6 * u, -L * 0.42], [8 * u, 3 * u], [0, 4.5 * u]], 0.5);
  body();
  kit.fillShaded(ctx, C.teal, { outline: C.outline, y: -L / 2, r: L * 0.7, gloss: 0.12, lineWidth: 2.8 });
  ctx.save();
  body(); ctx.clip();
  // corset (midnight) with gold lacing
  const cg = ctx.createLinearGradient(0, -L * 0.6, 0, 4 * u);
  cg.addColorStop(0, C.midnight); cg.addColorStop(1, C.midnightDark);
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(-12 * u, 6 * u); ctx.lineTo(-12 * u, -L * 0.5); ctx.quadraticCurveTo(0, -L * 0.62, 12 * u, -L * 0.55); ctx.lineTo(12 * u, 6 * u); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.gold; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-12 * u, -L * 0.5); ctx.quadraticCurveTo(0, -L * 0.62, 12 * u, -L * 0.55); ctx.stroke();
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) {
    const y = -L * 0.48 + i * L * 0.12;
    ctx.beginPath(); ctx.moveTo(3.5 * u, y); ctx.lineTo(7 * u, y + L * 0.1); ctx.moveTo(7 * u, y); ctx.lineTo(3.5 * u, y + L * 0.1); ctx.stroke();
  }
  // bodice seam highlight
  ctx.strokeStyle = kit.rgba(C.foamLight, 0.35); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-3 * u, -L * 0.6); ctx.quadraticCurveTo(-5 * u, -L * 0.85, -2 * u, -L); ctx.stroke();
  ctx.restore();

  // shell capelet (scalloped mantle) over the shoulders
  const cy = -L + 8 * u;
  ctx.beginPath();
  ctx.moveTo(-12.5 * u, cy);
  ctx.quadraticCurveTo(-12 * u, -L - 3 * u, -2 * u, -L - 3.5 * u);
  ctx.quadraticCurveTo(10 * u, -L - 3.5 * u, 12.5 * u, cy - 1 * u);
  const n = 5;
  for (let i = n; i > 0; i--) {
    const x0 = lerp(-12.5 * u, 12.5 * u, i / n), x1 = lerp(-12.5 * u, 12.5 * u, (i - 1) / n);
    ctx.quadraticCurveTo((x0 + x1) / 2, cy + 5 * u, x1, cy - (i - 1 === 0 ? 0 : 0.5 * u));
  }
  ctx.closePath();
  const mg = ctx.createLinearGradient(0, -L - 4 * u, 0, cy + 4 * u);
  mg.addColorStop(0, C.foamLight); mg.addColorStop(0.55, C.foam); mg.addColorStop(1, kit.shade(C.foam, -0.25));
  strokeFill(ctx, mg, C.outline, 2.6);
  ctx.strokeStyle = kit.rgba(C.teal, 0.55); ctx.lineWidth = 1;
  for (let i = 1; i < n; i++) { const x = lerp(-12.5 * u, 12.5 * u, i / n); ctx.beginPath(); ctx.moveTo(x * 0.6, -L - 2 * u); ctx.lineTo(x, cy + 1.5 * u); ctx.stroke(); }
  // pearl necklace + brooch
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    pearl(ctx, lerp(-1 * u, 8.5 * u, t), -L - 1.2 * u + Math.sin(t * Math.PI) * 4 * u, 1.25 * u);
  }
  ctx.beginPath(); ctx.arc(5.5 * u, -L + 4.4 * u, 2.4 * u, 0, TAU);
  strokeFill(ctx, C.gold, C.outline, 1.6);
  kit.glow(ctx, 5.5 * u, -L + 4.4 * u, 5 * u, C.orb, 0.5);
  ctx.beginPath(); ctx.arc(5.5 * u, -L + 4.4 * u, 1.4 * u, 0, TAU); ctx.fillStyle = C.orb; ctx.fill();
  ctx.restore();
}

function arm(ctx, a, info) {
  const { u, back } = info;
  const sleeve = dk(C.teal, back);
  kit.limb(ctx, a.shoulder, a.elbow, 4.4 * u, 3.6 * u, sleeve, { outline: C.outline, lineWidth: 2.6 });
  // forearm direction
  const dx = a.hand.x - a.elbow.x, dy = a.hand.y - a.elbow.y;
  const len = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dx, dy); // rotate(-ang) → +y along forearm
  // hand
  ctx.save();
  ctx.translate(a.hand.x, a.hand.y);
  ctx.rotate(-ang);
  ctx.beginPath(); ctx.ellipse(0, 0.8 * u, 3.2 * u, 3.8 * u, 0, 0, TAU);
  kit.fillShaded(ctx, dk(C.skin, back), { outline: C.outline, lineWidth: 2.2, r: 4 * u, gloss: 0.2 });
  ctx.restore();
  // bell sleeve
  ctx.save();
  ctx.translate(a.elbow.x, a.elbow.y);
  ctx.rotate(-ang);
  // gravity droop: world-down expressed in this frame
  const down = { x: -Math.sin(ang), y: Math.cos(ang) }; // world-down in this frame
  const droop = 2.5 * u;
  const e = len * 0.78;
  const ox = down.x * droop, oy = down.y * droop * 0.5;
  ctx.beginPath();
  ctx.moveTo(-3.6 * u, -1.5 * u);
  ctx.quadraticCurveTo(-5 * u, e * 0.5, -6 * u + ox, e + oy);
  ctx.quadraticCurveTo(0 + ox, e + 3.2 * u + oy, 6 * u + ox, e + oy);
  ctx.quadraticCurveTo(5 * u, e * 0.5, 3.6 * u, -1.5 * u);
  ctx.closePath();
  const sg = ctx.createLinearGradient(-6 * u, 0, 6 * u, e);
  sg.addColorStop(0, kit.shade(sleeve, 0.2)); sg.addColorStop(0.6, sleeve); sg.addColorStop(1, dk(C.tealDark, back));
  strokeFill(ctx, sg, C.outline, 2.4);
  // lining + gold trim at the cuff
  ctx.beginPath(); ctx.ellipse(ox, e + oy + 0.6 * u, 5.6 * u, 1.7 * u, 0, 0, TAU);
  strokeFill(ctx, dk(C.foam, back), C.outline, 1.8);
  ctx.beginPath(); ctx.ellipse(ox, e + oy + 0.6 * u, 5.6 * u, 1.7 * u, 0, 0.1, Math.PI - 0.1);
  ctx.strokeStyle = C.gold; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.restore();
}

function leg(ctx, l, info) {
  const { u, back } = info;
  const tights = dk(C.midnight, back);
  kit.limb(ctx, l.hip, l.knee, 5.2 * u, 4.2 * u, tights, { outline: C.outline, lineWidth: 2.6 });
  kit.limb(ctx, l.knee, l.foot, 4.2 * u, 3.4 * u, tights, { outline: C.outline, lineWidth: 2.6 });
  ctx.save();
  ctx.translate(l.foot.x, l.foot.y);
  ctx.rotate(-l.angle);
  boot(ctx, info);
  ctx.restore();
  if (!back) skirt(ctx, info);
}

function boot(ctx, info) {
  const { u, back } = info;
  // shin points along +y, toe along +x
  ctx.beginPath();
  ctx.moveTo(-4.2 * u, -9 * u);
  ctx.lineTo(4 * u, -9 * u);
  ctx.quadraticCurveTo(5 * u, -3 * u, 8 * u, -1 * u);
  ctx.quadraticCurveTo(13.5 * u, 0.5 * u, 12.5 * u, 3.4 * u);
  ctx.lineTo(-1 * u, 3.4 * u);
  ctx.lineTo(-3.4 * u, 5.8 * u); // heel
  ctx.lineTo(-5.4 * u, 5.8 * u);
  ctx.lineTo(-5 * u, 1 * u);
  ctx.closePath();
  kit.fillShaded(ctx, dk(C.deep, back), { outline: C.outline, lineWidth: 2.4, r: 9 * u, gloss: 0.25 });
  // gold cuff + toe cap
  kit.roundRectPath(ctx, -5 * u, -10.2 * u, 9.6 * u, 2.6 * u, 1.2 * u);
  strokeFill(ctx, dk(C.gold, back), C.outline, 1.6);
  ctx.fillStyle = kit.rgba(C.foamLight, 0.5);
  ctx.beginPath(); ctx.ellipse(8.5 * u, 0, 2.4 * u, 1 * u, -0.2, 0, TAU); ctx.fill();
}

/** Layered skirt over both legs. Hem follows the knees and flares with speed. */
function skirtGeometry(info) {
  const { rig, u, time } = info;
  const { vx, vy } = vel(info);
  const waist = add(rig.hip, rig.up, 3 * u);
  const wl = add(waist, rig.fwd, -8.4 * u), wr = add(waist, rig.fwd, 8.6 * u);
  const kF = rig.legF.knee, kB = rig.legB.knee;
  const flare = clamp(Math.abs(vx) / 8 + Math.max(0, vy) / 10, 0, 1.2);
  const trail = clamp(vx, -9, 9) * 0.9;
  const lowY = Math.max(kF.y, kB.y, waist.y + 20 * u) + 5 * u - flare * 5 * u;
  const yF = clamp(kF.y + 5 * u, waist.y + 13 * u, lowY);
  const yB = clamp(kB.y + 5 * u, waist.y + 13 * u, lowY);
  const minX = Math.min(kB.x, kF.x, rig.hip.x - 9 * u), maxX = Math.max(kB.x, kF.x, rig.hip.x + 9 * u);
  const breeze = Math.sin(time * 0.07) * 1.2 * u;
  const hx1 = clamp(minX - 6 * u - flare * 7 * u - trail, rig.hip.x - 34 * u, rig.hip.x - 10 * u) + breeze;
  const hx2 = clamp(maxX + 6 * u + flare * 3 * u - trail * 0.6, rig.hip.x + 10 * u, rig.hip.x + 30 * u) + breeze;
  return { waist, wl, wr, B: { x: hx1, y: yB - flare * 3 * u }, F: { x: hx2, y: yF }, flare, trail };
}

function hemPath(ctx, B, F, n, depth, phase) {
  for (let i = 1; i <= n; i++) {
    const a = { x: lerp(F.x, B.x, (i - 1) / n), y: lerp(F.y, B.y, (i - 1) / n) };
    const b = { x: lerp(F.x, B.x, i / n), y: lerp(F.y, B.y, i / n) };
    ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + depth * (1 + 0.25 * Math.sin(phase + i * 1.7)), b.x, b.y);
  }
}

function skirt(ctx, info) {
  const { u, time } = info;
  const g = skirtGeometry(info);
  const { wl, wr, B, F } = g;
  const shape = (B2, F2, n, depth, bulge = 4) => {
    ctx.beginPath();
    ctx.moveTo(wl.x, wl.y);
    ctx.lineTo(wr.x, wr.y);
    ctx.quadraticCurveTo(F2.x + 1 * u, lerp(wr.y, F2.y, 0.5), F2.x, F2.y);
    hemPath(ctx, B2, F2, n, depth, time * 0.08);
    ctx.quadraticCurveTo(B2.x - bulge * u * (0.5 + g.flare), lerp(wl.y, B2.y, 0.45), wl.x, wl.y);
    ctx.closePath();
  };
  // petticoat (sea-foam frill), a bit longer
  const pB = { x: B.x - 1.5 * u, y: B.y + 3.5 * u }, pF = { x: F.x + 1 * u, y: F.y + 3.5 * u };
  ctx.beginPath();
  ctx.moveTo(wl.x, wl.y); ctx.lineTo(wr.x, wr.y);
  ctx.lineTo(pF.x, pF.y);
  // frilly: many small scallops
  for (let i = 1; i <= 9; i++) {
    const a = { x: lerp(pF.x, pB.x, (i - 1) / 9), y: lerp(pF.y, pB.y, (i - 1) / 9) };
    const b = { x: lerp(pF.x, pB.x, i / 9), y: lerp(pF.y, pB.y, i / 9) };
    ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 2.4 * u, b.x, b.y);
  }
  ctx.closePath();
  strokeFill(ctx, C.foamLight, C.outline, 2.4);

  // main teal skirt with wave hem
  shape(B, F, 5, 3.4 * u);
  const sg = ctx.createLinearGradient(0, wl.y, 0, Math.max(B.y, F.y));
  sg.addColorStop(0, C.tealDark); sg.addColorStop(0.45, C.teal); sg.addColorStop(1, kit.shade(C.teal, 0.12));
  strokeFill(ctx, sg, C.outline, 2.8);
  ctx.save();
  shape(B, F, 5, 3.4 * u); ctx.clip();
  // open-front midnight over-robe covering the back ~55%
  const mid = { x: lerp(B.x, F.x, 0.5), y: lerp(B.y, F.y, 0.5) + 3 * u };
  ctx.beginPath();
  ctx.moveTo(wl.x - 4 * u, wl.y - 2 * u);
  ctx.lineTo(lerp(wl.x, wr.x, 0.62), wl.y - 2 * u);
  ctx.quadraticCurveTo(lerp(wl.x, wr.x, 0.45), lerp(wl.y, mid.y, 0.6), mid.x, mid.y + 6 * u);
  ctx.lineTo(B.x - 10 * u, B.y + 10 * u);
  ctx.closePath();
  const rg = ctx.createLinearGradient(B.x, wl.y, mid.x, mid.y);
  rg.addColorStop(0, C.midnightDark); rg.addColorStop(1, C.midnight);
  ctx.fillStyle = rg; ctx.fill();
  ctx.strokeStyle = C.gold; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(lerp(wl.x, wr.x, 0.62), wl.y - 2 * u);
  ctx.quadraticCurveTo(lerp(wl.x, wr.x, 0.45), lerp(wl.y, mid.y, 0.6), mid.x, mid.y + 6 * u); ctx.stroke();
  // wave motif on the teal front
  ctx.strokeStyle = kit.rgba(C.foamLight, 0.55); ctx.lineWidth = 1.4;
  const wy = lerp(wr.y, F.y, 0.7);
  ctx.beginPath();
  for (let i = 0; i <= 3; i++) {
    const x = lerp(mid.x, F.x, i / 3);
    if (i === 0) ctx.moveTo(x, wy); else ctx.quadraticCurveTo(x - 2 * u, wy - 3 * u, x, wy);
  }
  ctx.stroke();
  ctx.restore();
  // hem trim (gold)
  ctx.beginPath(); ctx.moveTo(F.x, F.y); hemPath(ctx, B, F, 5, 3.4 * u, time * 0.08);
  ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke();
  // waist sash with gold buckle
  ctx.save();
  ctx.translate(g.waist.x, g.waist.y);
  ctx.rotate(info.rig.lean);
  kit.roundRectPath(ctx, -9 * u, -2.6 * u, 18 * u, 4.4 * u, 2 * u);
  strokeFill(ctx, C.midnight, C.outline, 2.2);
  ctx.fillStyle = C.gold; ctx.fillRect(-9 * u, -0.6 * u, 18 * u, 0.9 * u);
  starfish(ctx, 6 * u, -0.4 * u, 2.6 * u, 0.3);
  ctx.restore();
}

/** Long robe train behind the legs (drawn first, in art.back). */
function robeTrain(ctx, info) {
  const { u, time } = info;
  const g = skirtGeometry(info);
  const { wl, B } = g;
  const sway = Math.sin(time * 0.06) * 2 * u;
  const tip = { x: B.x - 9 * u - g.flare * 8 * u + sway, y: B.y + 12 * u - g.flare * 6 * u };
  ctx.beginPath();
  ctx.moveTo(wl.x + 2 * u, wl.y - 1 * u);
  ctx.quadraticCurveTo(B.x - 4 * u, lerp(wl.y, B.y, 0.5), tip.x, tip.y);
  ctx.quadraticCurveTo(lerp(tip.x, B.x, 0.5) + 2 * u, tip.y - 1 * u, B.x + 8 * u, B.y + 2 * u);
  ctx.lineTo(g.wr.x - 4 * u, g.wr.y);
  ctx.closePath();
  const rg = ctx.createLinearGradient(wl.x, wl.y, tip.x, tip.y);
  rg.addColorStop(0, C.midnight); rg.addColorStop(1, C.midnightDark);
  strokeFill(ctx, rg, C.outline, 2.8);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.quadraticCurveTo(lerp(tip.x, B.x, 0.5) + 2 * u, tip.y - 1 * u, B.x + 8 * u, B.y + 2 * u);
  ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke();
}

// ── Staff ─────────────────────────────────────────────────────────────────
export const STAFF_LENGTH = 56; // tip distance from the hand (rig units); also used by the trail

function staffAngle(info, arm) {
  // In attacks the staff follows the forearm (so hitboxes line up). Otherwise she
  // holds it upright like a proper witch.
  const st = info.state;
  if (st === 'attack' || st === 'hitstun' || st === 'roll' || st === 'airdodge' || st === 'helpless' || st === 'shieldbreak') return 0;
  let theta = -Math.PI / 2 + 0.12; // world direction in rig space (up, slightly forward)
  if (st === 'run') theta = -Math.PI / 2 + 0.75;
  if (st === 'air') theta = -Math.PI / 2 + 0.35 + clamp((info.view.vy || 0) * 0.03, -0.2, 0.3);
  if (st === 'crouch') theta = -Math.PI / 2 + 0.6;
  // local rotation relative to the forearm frame (+x along forearm)
  return theta + arm.angle - Math.PI / 2;
}

function staff(ctx, info) {
  const { u, time } = info;
  const arm = info.rig.armF;
  ctx.rotate(staffAngle(info, arm));
  const len = STAFF_LENGTH * u;
  const atk = attack(info);
  const hot = atk ? 1 : 0;
  // aura
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, len, 0, (14 + hot * 10) * u, C.orb, 0.45 + Math.sin(time * 0.12) * 0.12 + hot * 0.2);
  ctx.restore();
  // shaft (driftwood)
  kit.capsulePath(ctx, -27 * u, 0, len - 12 * u, 0, 1.6 * u, 2.1 * u);
  const sg = ctx.createLinearGradient(0, -2 * u, 0, 2 * u);
  sg.addColorStop(0, '#fff3dc'); sg.addColorStop(0.5, C.wood); sg.addColorStop(1, '#9c7f5c');
  strokeFill(ctx, sg, C.outline, 2.4);
  // spiral ribbon wrap near the grip and top
  ctx.strokeStyle = C.teal; ctx.lineWidth = 1.5 * u;
  for (let i = 0; i < 4; i++) { const x = -6 * u + i * 3.6 * u; ctx.beginPath(); ctx.moveTo(x, -2 * u); ctx.lineTo(x + 2.4 * u, 2 * u); ctx.stroke(); }
  for (let i = 0; i < 3; i++) { const x = len - 24 * u + i * 3.4 * u; ctx.beginPath(); ctx.moveTo(x, -2.1 * u); ctx.lineTo(x + 2.2 * u, 2.1 * u); ctx.stroke(); }
  // butt cap
  kit.capsulePath(ctx, -29 * u, 0, -25 * u, 0, 2.2 * u, 2.2 * u);
  strokeFill(ctx, C.gold, C.outline, 1.8);
  pearl(ctx, -30 * u, 0, 1.6 * u);
  // gold collar
  kit.roundRectPath(ctx, len - 14 * u, -2.9 * u, 3.4 * u, 5.8 * u, 1 * u);
  strokeFill(ctx, C.gold, C.outline, 1.6);
  // coral crown cradling the orb
  const branch = (pts, w) => {
    const path = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i += 2) ctx.quadraticCurveTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); };
    path(); ctx.lineCap = 'round'; ctx.lineWidth = w + 2.6; ctx.strokeStyle = C.outline; ctx.stroke();
    path(); ctx.lineWidth = w; ctx.strokeStyle = C.coral; ctx.stroke();
    path(); ctx.lineWidth = w * 0.35; ctx.strokeStyle = kit.rgba('#ffd2c4', 0.8); ctx.stroke();
  };
  const L0 = len - 11 * u;
  branch([[L0, 0], [L0 + 5 * u, -7 * u], [len + 2 * u, -8.5 * u], [len + 6 * u, -9 * u], [len + 8 * u, -6 * u]], 2.4 * u);
  branch([[L0, 0], [L0 + 5 * u, 7 * u], [len + 2 * u, 8.5 * u], [len + 6 * u, 9 * u], [len + 8 * u, 6 * u]], 2.4 * u);
  branch([[L0 + 5 * u, -5 * u], [L0 + 6 * u, -10 * u], [L0 + 4 * u, -12 * u]], 1.6 * u);
  branch([[L0 + 5 * u, 5 * u], [L0 + 6 * u, 10 * u], [L0 + 4 * u, 12 * u]], 1.6 * u);
  // orb
  const R = 5.6 * u;
  ctx.beginPath(); ctx.arc(len, 0, R, 0, TAU);
  const og = ctx.createRadialGradient(len - R * 0.35, -R * 0.4, 0, len, 0, R);
  og.addColorStop(0, '#ffffff'); og.addColorStop(0.35, C.orb); og.addColorStop(1, '#1c8fb0');
  strokeFill(ctx, og, C.outline, 2);
  // swirling current inside the orb
  ctx.save();
  ctx.beginPath(); ctx.arc(len, 0, R, 0, TAU); ctx.clip();
  ctx.strokeStyle = kit.rgba('#ffffff', 0.7); ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(len, 0, R * 0.6, time * 0.1, time * 0.1 + 2.2); ctx.stroke();
  ctx.restore();
  // pearls on the coral tips
  pearl(ctx, len + 8 * u, -6 * u, 1.5 * u);
  pearl(ctx, len + 8 * u, 6 * u, 1.5 * u);
  pearl(ctx, L0 + 4 * u, -12 * u, 1.2 * u);
  // orbiting droplets
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const a = time * 0.06 + (i * TAU) / 3;
    kit.glow(ctx, len + Math.cos(a) * 10 * u, Math.sin(a) * 4 * u, 2.4 * u, C.foam, 0.8);
  }
  ctx.restore();
}
// The renderer's swoosh trail reads weapon.length; a function's .length is its
// arity, so we redefine it to the staff tip distance.
Object.defineProperty(staff, 'length', { value: STAFF_LENGTH });

// ── VFX for moves (drawn in front/back hooks, rig space, feet at 0,0) ─────
function waterColumn(ctx, x, yTop, yBot, w, t, alpha = 1) {
  if (yBot - yTop < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const wob = (y, s) => Math.sin(y * 0.09 + t * 0.5 * s) * w * 0.12;
  ctx.beginPath();
  const steps = 10;
  for (let i = 0; i <= steps; i++) { const y = lerp(yBot, yTop, i / steps); const ww = w * (0.75 + 0.25 * (i / steps)); ctx.lineTo(x - ww + wob(y, 1), y); }
  for (let i = steps; i >= 0; i--) { const y = lerp(yBot, yTop, i / steps); const ww = w * (0.75 + 0.25 * (i / steps)); ctx.lineTo(x + ww + wob(y, -1), y); }
  ctx.closePath();
  const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
  g.addColorStop(0, kit.rgba('#1b6fc0', 0.85)); g.addColorStop(0.35, kit.rgba('#4fd9e6', 0.9)); g.addColorStop(0.6, kit.rgba('#c9fff6', 0.95)); g.addColorStop(1, kit.rgba('#2a8fd0', 0.85));
  ctx.lineWidth = 2.4; ctx.strokeStyle = kit.rgba(C.outline, 0.7); ctx.stroke();
  ctx.fillStyle = g; ctx.fill();
  // flowing streaks
  ctx.save(); ctx.clip();
  ctx.strokeStyle = kit.rgba('#ffffff', 0.65); ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const sx = x - w * 0.6 + i * w * 0.4;
    const off = ((t * 9 + i * 37) % 60);
    ctx.beginPath();
    for (let y = yBot + off; y > yTop - 60; y -= 60) { ctx.moveTo(sx + wob(y, 1), y); ctx.lineTo(sx + wob(y - 22, 1), y - 22); }
    ctx.stroke();
  }
  ctx.restore();
  // foam cap
  for (let i = 0; i < 6; i++) {
    const a = t * 0.3 + i;
    ctx.beginPath(); ctx.arc(x + Math.cos(a * 1.3) * w * 0.7, yTop + Math.sin(a) * w * 0.25, w * (0.32 + 0.1 * Math.sin(a * 2)), 0, TAU);
    ctx.fillStyle = i % 2 ? '#ffffff' : C.foamLight; ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, x, yTop, w * 2, C.orb, 0.4 * alpha);
  ctx.restore();
}

function droplets(ctx, x, y, n, spread, k, seed) {
  const rnd = kit.seeded(seed);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * spread;
    const d = k * (20 + rnd() * 50);
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d + k * k * 40;
    const s = (1.5 + rnd() * 2.5) * (1 - k * 0.5);
    ctx.beginPath(); ctx.arc(px, py, s, 0, TAU);
    ctx.fillStyle = rnd() < 0.5 ? '#ffffff' : C.foam; ctx.fill();
  }
}

function splashRing(ctx, x, y, rad, k) {
  ctx.save();
  ctx.globalAlpha = 1 - k;
  ctx.lineWidth = 6 * (1 - k) + 1.5;
  ctx.strokeStyle = C.foamLight;
  ctx.beginPath(); ctx.ellipse(x, y, rad, rad * 0.22, 0, 0, TAU); ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = C.orb;
  ctx.beginPath(); ctx.ellipse(x, y, rad * 0.8, rad * 0.17, 0, 0, TAU); ctx.stroke();
  ctx.restore();
}

function crest(ctx, x, y, s, k) {
  // a curling wave crest, facing +x
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.globalAlpha = Math.min(1, (1 - k) * 1.6);
  ctx.beginPath();
  ctx.moveTo(-30, 18);
  ctx.quadraticCurveTo(-24, -10, 2, -22);
  ctx.quadraticCurveTo(26, -30, 30, -8);
  ctx.quadraticCurveTo(22, -18, 12, -10);
  ctx.quadraticCurveTo(22, -2, 14, 6);
  ctx.quadraticCurveTo(4, -6, -6, 4);
  ctx.quadraticCurveTo(0, 14, 24, 18);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -30, 0, 18);
  g.addColorStop(0, '#d9fff7'); g.addColorStop(0.4, '#55d8e6'); g.addColorStop(1, '#1a5fb5');
  ctx.lineWidth = 2.4 / s; ctx.strokeStyle = C.outline; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.2 / s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-20, 4); ctx.quadraticCurveTo(-12, -14, 6, -20); ctx.stroke();
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.arc(26 + i * 4 - k * 10, -14 - i * 3 + k * 6, 2.6 - i * 0.35, 0, TAU);
    ctx.fillStyle = '#ffffff'; ctx.fill();
  }
  ctx.restore();
}

function bubble(ctx, x, y, R, t, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.35, R * 0.1, x, y, R);
  g.addColorStop(0, kit.rgba('#ffffff', 0.25)); g.addColorStop(0.7, kit.rgba(C.orb, 0.12)); g.addColorStop(1, kit.rgba(C.foam, 0.5));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
  // iridescent rim
  const segs = [[C.orb, 0], ['#b48cff', 2.1], ['#ffd27a', 4.2]];
  ctx.lineWidth = 2.6;
  for (const [c, o] of segs) { ctx.strokeStyle = kit.rgba(c, 0.8); ctx.beginPath(); ctx.arc(x, y, R, o + t * 0.05, o + t * 0.05 + 1.9); ctx.stroke(); }
  ctx.strokeStyle = kit.rgba('#ffffff', 0.9); ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, R * 0.78, -2.6, -1.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(x - R * 0.42, y - R * 0.52, R * 0.06, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();
}

function swirl(ctx, cx, cy, R, t, k) {
  ctx.save();
  ctx.globalAlpha = 1 - k * 0.6;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = t * 0.35 + (i * TAU) / 3;
    ctx.strokeStyle = i === 0 ? '#ffffff' : i === 1 ? C.foam : C.orb;
    ctx.lineWidth = 5 - i;
    ctx.beginPath(); ctx.ellipse(cx, cy, R * (1 - i * 0.12), R * (0.9 - i * 0.1), 0, a, a + 2.2); ctx.stroke();
  }
  ctx.restore();
}

function back(ctx, info) {
  robeTrain(ctx, info);
  backHair(ctx, info);
  const atk = attack(info);
  if (atk && atk.slot === 'upSpecial') {
    // waterspout carrying her upward from below
    const w = windowOf(atk.m);
    const k = clamp((atk.f - w.s + 3) / 6, 0, 1);
    const fade = clamp((atk.m.duration - atk.f) / 10, 0, 1);
    if (k > 0) waterColumn(ctx, 0, -10 * info.u, 110 * info.u, 17 * info.u * (0.6 + 0.4 * k), info.time, fade);
  }
}

function front(ctx, info) {
  const atk = attack(info);
  if (!atk) return;
  const { u, time } = info;
  const { slot, f, m } = atk;
  const w = windowOf(m);
  const rel = f - w.s; // frames since first active frame
  ctx.save();
  if (slot === 'upSmash') {
    const gx = 72; // geyser erupts where the staff strikes the ground
    if (f >= w.s - 6 && f < w.s) { // bubbling ground
      const k = (f - (w.s - 6)) / 6;
      splashRing(ctx, gx, 0, 16 + k * 14, 0.3);
      droplets(ctx, gx, -2, 6, 1.2, k * 0.5, 7);
    }
    if (rel >= 0) {
      const up = clamp(rel / 6, 0, 1);
      const fade = clamp((m.duration - f) / 14, 0, 1);
      const h = (60 + 110 * up) * u;
      waterColumn(ctx, gx, -h, 2, 19 * u, time, fade);
      splashRing(ctx, gx, 0, 24 + rel * 1.5, clamp(rel / 30, 0, 1));
      droplets(ctx, gx, -h, 14, 2.4, clamp(rel / 20, 0, 1), 11);
    }
  } else if (slot === 'sideSmash' && rel >= -1) {
    const k = clamp(rel / 22, 0, 1);
    crest(ctx, 78 + k * 30, -34, 1.25 + k * 0.4, k);
    droplets(ctx, 80, -40, 10, 2.6, k, 5);
  } else if (slot === 'downSmash' && rel >= 0) {
    const k = clamp(rel / 20, 0, 1);
    splashRing(ctx, 0, 0, 30 + k * 60, k);
    for (const s of [1, -1]) {
      ctx.save(); ctx.scale(s, 1);
      crest(ctx, 46 + k * 26, -12, 0.75 + k * 0.2, k);
      ctx.restore();
    }
    droplets(ctx, 0, -6, 16, 3, k, 3);
  } else if (slot === 'downSpecial') {
    const hb = m.hitboxes[0];
    if (hb && f >= hb.start - 4 && f <= hb.end + 8) {
      const k = clamp((f - hb.start + 4) / 6, 0, 1);
      const pop = f > hb.end ? (f - hb.end) / 8 : 0;
      bubble(ctx, hb.x, hb.y, hb.r * (0.5 + 0.5 * k) * (1 + pop * 0.4), time, 1 - pop);
    }
  } else if (slot === 'nair' && rel >= 0 && f <= w.e + 4) {
    swirl(ctx, 0, -46, 40, time, clamp((f - w.e) / 4, 0, 1));
  } else if (slot === 'neutralSpecial' && f < w.s + 3) {
    // gathering water at the staff tip
    const k = clamp(f / Math.max(1, w.s), 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const a = time * 0.2 + i;
      const d = (1 - k) * 30;
      kit.glow(ctx, 40 + Math.cos(a) * d, -60 + Math.sin(a) * d, 5, C.foam, 0.8);
    }
  } else if (slot === 'dair' && rel >= 0 && rel < 10) {
    const k = rel / 10;
    ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, 6, 18, 26 * (1 - k * 0.5), C.orb, 0.6 * (1 - k));
  }
  ctx.restore();
}

// ── Projectiles ───────────────────────────────────────────────────────────
function projectile(ctx, p) {
  const t = p.t;
  const r = p.r;
  const age = (p.maxLife || 60) - (p.life || 0);
  const fadeIn = clamp(age / 4, 0, 1);
  ctx.scale(fadeIn * 0.6 + 0.4, fadeIn * 0.6 + 0.4);
  if (p.style === 'pearl') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i <= 4; i++) kit.glow(ctx, -Math.abs(p.vx) * i * 1.2, -p.vy * i * 1.2, r * (1.4 - i * 0.2), C.orb, 0.3 - i * 0.05);
    kit.glow(ctx, 0, 0, r * 2.2, C.foam, 0.5);
    ctx.restore();
    bubble(ctx, 0, 0, r * 1.15, t, 0.9);
    pearl(ctx, 0, 0, r * 0.62);
    // glint
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    kit.starPath(ctx, -r * 0.2, -r * 0.3, 4, r * (0.5 + 0.2 * Math.sin(t * 0.4)), r * 0.08, t * 0.05);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
    return;
  }
  if (p.style === 'tidewave') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, -r * 0.5, 0, r * 2.4, C.orb, 0.35);
    ctx.restore();
    crest(ctx, 0, r * 0.1, r / 22, 0.15 + 0.1 * Math.sin(t * 0.3));
    // spray trail
    for (let i = 0; i < 6; i++) {
      const a = t * 0.4 + i * 1.7;
      ctx.beginPath(); ctx.arc(-r * (1 + i * 0.35), r * 0.7 - Math.abs(Math.sin(a)) * r * 0.5, r * (0.18 - i * 0.02), 0, TAU);
      ctx.fillStyle = i % 2 ? C.foamLight : C.orb; ctx.fill();
    }
    return;
  }
  // 'tideorb' (default)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 1; i <= 6; i++) kit.glow(ctx, -Math.abs(p.vx) * i * 1.5 + Math.sin(t * 0.3 + i) * 2, -p.vy * i * 1.5, r * (1.3 - i * 0.14), i % 2 ? C.orb : '#3a8cff', 0.3 - i * 0.035);
  kit.glow(ctx, 0, 0, r * 2.6, C.orb, 0.55);
  ctx.restore();
  // body of water, slightly wobbling
  const wob = Math.sin(t * 0.35) * 0.08;
  ctx.save();
  ctx.scale(1 + wob, 1 - wob);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, '#8ff6ef'); g.addColorStop(0.75, '#2aa5d6'); g.addColorStop(1, '#1b4fa8');
  ctx.lineWidth = 2.4; ctx.strokeStyle = C.outline; ctx.stroke();
  ctx.fillStyle = g; ctx.fill();
  // inner current
  ctx.save(); ctx.clip();
  ctx.strokeStyle = kit.rgba('#ffffff', 0.75); ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(r * 0.1, r * 0.1, r * 0.55, t * 0.2, t * 0.2 + 2.4); ctx.stroke();
  ctx.strokeStyle = kit.rgba(C.foam, 0.6);
  ctx.beginPath(); ctx.arc(-r * 0.1, 0, r * 0.3, -t * 0.25, -t * 0.25 + 2); ctx.stroke();
  ctx.restore();
  ctx.restore();
  // foam ring
  ctx.strokeStyle = kit.rgba('#ffffff', 0.8); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 1.45, r * 0.55, t * 0.08, 0, TAU * 0.7); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const a = t * 0.15 + (i * TAU) / 3;
    pearl(ctx, Math.cos(a) * r * 1.45, Math.sin(a) * r * 0.55, 1.8);
  }
}

// ── Grab, throws, stun and taunt poses (the engine's default puppet has none:
// without these they'd all read as the neutral stance) ──────────────────────
function statePose(v, taunt) {
  const t = v.time || 0, s = Math.sin(t * 0.5);
  switch (v.state) {
    case 'stunned': {
      const a = Math.sin(t * 0.12), c = Math.cos(t * 0.12);
      return { lean: 0.32 + a * 0.08, head: 0.45 + c * 0.25, by: 8, bx: a * 2, fU: 0.08 + a * 0.06, fL: 0.12, bU: -0.06 - a * 0.06, bL: 0.1, flU: 0.32, flL: -0.6, blU: -0.4, blL: -0.55, sy: 0.95 };
    }
    case 'grabbed':
      return { lean: -0.3, head: 0.35, by: -2, fU: 2.5 + s * 0.35, fL: 0.6, bU: 2.2 - s * 0.35, bL: 0.8, flU: 0.35 + s * 0.3, flL: -0.7, blU: -0.1 - s * 0.3, blL: -0.6 };
    case 'taunt': return taunt(t);
    case 'grabbing': break;
    default: return null;
  }
  const f = v.moveFrame || 0;
  const k = Math.min(1, f / (Math.max(4, v.move?.duration || 24) * 0.45)); // windup → release
  const mix = (a, b) => { const o = {}; for (const key in b) o[key] = (a[key] ?? 0) + (b[key] - (a[key] ?? 0)) * k; return o; };
  const HOLD = { lean: 0.14, fU: 1.5, fL: 0.12, bU: 1.3, bL: 0.42, flU: 0.4, flL: -0.35, blU: -0.4, blL: -0.25 };
  switch (v.move?.slot) {
    case 'pummel': { const z = Math.abs(Math.sin(f * 0.8)); return { ...HOLD, lean: 0.3, head: -0.12, bU: 0.6 + z * 0.9, bL: 1.6 - z * 1.4, flU: 0.6 + z * 0.8, flL: -1.2 - z * 0.4 }; } // knee + jabs
    case 'fthrow':
      return mix({ ...HOLD, lean: -0.25, fU: 0.6, fL: 1.6, bU: 0.4, bL: 1.6, bx: -4 },
        { lean: 0.42, fU: 1.6, fL: -0.05, bU: 1.45, bL: 0.05, bx: 4, flU: 0.75, flL: -0.9, blU: -0.55, blL: -0.3 });
    case 'bthrow':
      return { ...mix({ ...HOLD, lean: 0.2 }, { lean: -0.35, fU: -1.7, fL: 0.1, bU: -1.5, bL: 0.2, flU: -0.2, flL: -0.3, blU: 0.45, blL: -0.6 }), spin: -Math.PI * k };
    case 'uthrow':
      return mix({ ...HOLD, by: 12, sy: 0.88, sx: 1.08, fU: 0.9, bU: 0.8 },
        { lean: -0.1, head: -0.3, by: -4, sy: 1.1, sx: 0.94, fU: 3.05, fL: -0.1, bU: 2.95, bL: 0.1, flU: 0.1, flL: -0.1, blU: -0.1, blL: -0.1 });
    case 'dthrow':
      return mix({ ...HOLD, fU: 2.7, fL: 0.3, bU: 2.5, bL: 0.4, by: -2 },
        { lean: 0.6, head: 0.3, by: 16, sy: 0.9, fU: 0.35, fL: 0.05, bU: 0.25, bL: 0.1, flU: 1.0, flL: -1.6, blU: -0.45, blL: -1.2 });
    default: return HOLD;
  }
}
// Taunt: a theatrical curtsy, staff swept out to the side.
const mirelleTaunt = (t) => ({ lean: 0.3, head: 0.25, by: 6, fU: 1.25 + Math.sin(t * 0.2) * 0.1, fL: 0.2, bU: -0.9, bL: 0.4, flU: -0.25, flL: -0.5, blU: 0.35, blL: -0.7 });
const mirellePose = (p, v) => statePose(v, mirelleTaunt);

// ── Exported art object ───────────────────────────────────────────────────
export const art = {
  palette: {
    ...BASE,
    skin: C.skin, primary: C.teal, secondary: C.midnight, accent: C.gold, hair: C.hair, eyes: C.eyes,
    boots: C.deep, outline: C.outline, effect: '#5fe6e0', effect2: C.foamLight,
  },
  build: { head: 1.04, torso: 1, arms: 1, legs: 1.02, thickness: 0.85, shoulders: 0.88, hips: 0.95 },
  pose: mirellePose,
  // Chain colours are palette keys, so alt palettes recolour the hair and sash too.
  chains: [
    { anchor: 'head', length: 50, segments: 7, width: 13, endWidth: 3, color: 'hair', color2: 'hairEnd', stiffness: 0.15, gravity: 1 },
    { anchor: 'head', length: 38, segments: 6, width: 10, endWidth: 2, color: 'hairTop', color2: 'hairDeep', stiffness: 0.2 },
    { anchor: 'hip', length: 44, segments: 6, width: 7, endWidth: 4, color: 'foam', color2: 'teal', stiffness: 0.18 },
  ],
  // Alt palettes for duplicate picks (mirror matches / training dummy).
  palettes: [
    {},
    // Coral Reef: rose robes, plum bodice, pink hair, pearl-white staff glow
    { primary: '#e0607a', teal: '#e0607a', tealDark: '#9c3552', midnight: '#4a1f5c', midnightDark: '#33143f', deep: '#6a2a7e',
      hairTop: '#ffb3c9', hair: '#f06a9a', hairDeep: '#b23a78', hairEnd: '#6a1f5c', eyes: '#ff7aa8', secondary: '#4a1f5c', boots: '#6a2a7e' },
    // Abyss: violet robes, ink-black bodice, silver hair, silver trim
    { primary: '#6b4fd8', teal: '#6b4fd8', tealDark: '#3f2c94', midnight: '#16152b', midnightDark: '#0c0b1c', deep: '#2b2160',
      hairTop: '#f1f0ff', hair: '#c4c6e0', hairDeep: '#8c8fb8', hairEnd: '#4d4f78', gold: '#d9dde8', goldDark: '#8a91a6', accent: '#d9dde8',
      orb: '#c7a8ff', foam: '#d7c8ff', eyes: '#b48cff', secondary: '#16152b', boots: '#2b2160' },
    // Kelp Forest: sea-green robes, forest bodice, copper hair
    { primary: '#2f9e5a', teal: '#2f9e5a', tealDark: '#1d6a3b', midnight: '#183d2c', midnightDark: '#0f2a1e', deep: '#21523a',
      hairTop: '#ffb070', hair: '#e0783a', hairDeep: '#a84a24', hairEnd: '#6a2a18', orb: '#b8ff7a', foam: '#c8f5b0', eyes: '#7fe08a',
      secondary: '#183d2c', boots: '#21523a' },
  ],
  back: withPalette(back),
  head: withPalette(head),
  torso: withPalette(torso),
  arm: withPalette(arm),
  leg: withPalette(leg),
  weapon: withPalette(staff),
  front: withPalette(front),
  projectile: withPalette(projectile),
};
