// ─────────────────────────────────────────────────────────────────────────────
// VOLT — fully custom art.
//
// art.draw(ctx, info) replaces the default puppet completely. We still read the
// engine's rig (info.rig) every frame, so all of Volt's parts follow the same
// skeleton the animations drive: hands sit exactly where the rig puts them, feet
// where the legs end, etc. That keeps hitboxes and visuals lined up for free.
//
// Space: +x = facing direction, +y = down, feet at y = 0, units are px.
// info.u = height / 100 — size everything in `u` so it scales with the hurtbox.
// ─────────────────────────────────────────────────────────────────────────────

const WARM = '#ffc48a'; // sunset rim light, matches the Sky Sanctum stage
const TAU = Math.PI * 2;

// Which body part "leads" each move (where the sparks crackle).
const LEAD = {
  jab: 'frontHand', side: 'frontHand', up: 'frontHand', down: 'frontFoot',
  sideSmash: 'hands', upSmash: 'frontHand', downSmash: 'hands',
  nair: 'body', fair: 'frontFoot', bair: 'feet', uair: 'frontFoot', dair: 'feet',
  neutralSpecial: 'frontHand', sideSpecial: 'body', upSpecial: 'body', downSpecial: 'body',
  pummel: 'hands', fthrow: 'hands', bthrow: 'hands', uthrow: 'hands', dthrow: 'hands',
};

// ── Pose tweaks ─────────────────────────────────────────────────────────────
// A hover-bot doesn't run on its legs: it glides with the feet tucked together
// and the arms streamlined back. Returned keys override the engine's pose.
export function voltPose(p, v) {
  const t = v.time || 0;
  switch (v.state) {
    case 'idle': {
      const b = Math.sin(t * 0.09);
      return { fU: 0.42 + b * 0.06, fL: 0.75, bU: -0.32 - b * 0.06, bL: 0.7, flU: 0.1, flL: -0.22, blU: -0.16, blL: -0.18, head: b * 0.04 };
    }
    case 'run': {
      const s = Math.sin(t * 0.25);
      return {
        lean: 0.38, head: -0.18, by: 0,
        fU: -0.75 + s * 0.12, fL: 0.55, bU: -1.0 - s * 0.12, bL: 0.45,
        flU: -0.05 + s * 0.06, flL: -0.55, blU: -0.38 - s * 0.06, blL: -0.4,
      };
    }
    case 'air': {
      const k = Math.max(0, Math.min(1, (v.vy + 6) / 12));
      // Legs stay tucked together like thrusters instead of a jumping stride.
      return { flU: 0.25 - k * 0.25, flL: -0.55 + k * 0.2, blU: 0.05 - k * 0.3, blL: -0.5 + k * 0.15 };
    }
    case 'grabbing': return grabPose(v, t);
    case 'grabbed': {
      // Dangling and kicking: arms clawing up, legs pedalling.
      const s = Math.sin(t * 0.5);
      return { lean: -0.3, head: 0.35, by: -2, fU: 2.5 + s * 0.35, fL: 0.6, bU: 2.2 - s * 0.35, bL: 0.8, flU: 0.35 + s * 0.3, flL: -0.7, blU: -0.1 - s * 0.3, blL: -0.6 };
    }
    case 'stunned': {
      // Short-circuited: slumped, head lolling in a circle, arms hanging limp.
      const s = Math.sin(t * 0.12), c = Math.cos(t * 0.12);
      return { lean: 0.32 + s * 0.08, head: 0.45 + c * 0.25, by: 7, bx: s * 2, fU: 0.08 + s * 0.06, fL: 0.12, bU: -0.06 - s * 0.06, bL: 0.1, flU: 0.3, flL: -0.55, blU: -0.38, blL: -0.5, sy: 0.95 };
    }
    case 'taunt': {
      // Flex + wave: front arm pumps overhead, back fist on the hip.
      const s = Math.sin(t * 0.3);
      return { lean: -0.12, head: -0.22, fU: 2.75 + s * 0.25, fL: 0.55 + s * 0.45, bU: -0.55, bL: 2.3, flU: 0.2, flL: -0.2, blU: -0.25, blL: -0.15 };
    }
    case 'respawn': {
      // Booting up: arms spread wide, head tipped back.
      const b = Math.sin(t * 0.09);
      return { lean: -0.08, head: -0.25, fU: 1.95 + b * 0.08, fL: -0.25, bU: -1.95 - b * 0.08, bL: 0.25, flU: 0.06, flL: -0.12, blU: -0.06, blL: -0.12 };
    }
    default: return null;
  }
}

// Grab hold, pummel zaps and the four throws (play in the 'grabbing' state).
function grabPose(v, t) {
  const slot = v.move?.slot;
  const f = v.moveFrame || 0;
  const dur = Math.max(4, v.move?.duration || 24);
  const k = Math.min(1, f / (dur * 0.45)); // windup → release
  const mix = (a, b) => { const o = {}; for (const key in b) o[key] = (a[key] ?? 0) + (b[key] - (a[key] ?? 0)) * k; return o; };
  const HOLD = { lean: 0.14, fU: 1.5, fL: 0.12, bU: 1.3, bL: 0.42, flU: 0.4, flL: -0.35, blU: -0.4, blL: -0.25 };
  switch (slot) {
    case 'pummel': {
      const z = Math.abs(Math.sin(f * 0.8));
      return { ...HOLD, lean: 0.2, head: -0.12, bU: 0.6 + z * 0.9, bL: 1.6 - z * 1.4 };
    }
    case 'fthrow':
      return mix({ ...HOLD, lean: -0.25, fU: 0.6, fL: 1.6, bU: 0.4, bL: 1.6, bx: -4 },
        { lean: 0.42, fU: 1.6, fL: -0.05, bU: 1.45, bL: 0.05, bx: 4, flU: 0.75, flL: -0.9, blU: -0.55, blL: -0.3 });
    case 'bthrow':
      return { ...mix({ ...HOLD, lean: 0.2 }, { lean: -0.35, fU: -1.7, fL: 0.1, bU: -1.5, bL: 0.2, flU: -0.2, flL: -0.3, blU: 0.45, blL: -0.6 }), spin: -Math.PI * 2 * k * 0.5 };
    case 'uthrow':
      return mix({ ...HOLD, by: 12, sy: 0.88, sx: 1.08, fU: 0.9, bU: 0.8 },
        { lean: -0.1, head: -0.3, by: -4, sy: 1.1, sx: 0.94, fU: 3.05, fL: -0.1, bU: 2.95, bL: 0.1, flU: 0.1, flL: -0.1, blU: -0.1, blL: -0.1 });
    case 'dthrow':
      return mix({ ...HOLD, fU: 2.7, fL: 0.3, bU: 2.5, bL: 0.4, by: -2 },
        { lean: 0.6, head: 0.3, by: 16, sy: 0.9, fU: 0.35, fL: 0.05, bU: 0.25, bL: 0.1, flU: 1.0, flL: -1.6, blU: -0.45, blL: -1.2 });
    default: return HOLD;
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────
function rngFor(kit, time, salt) { return kit.seeded(Math.floor(time / 2) * 977 + salt * 131 + 7); }

/** Jagged lightning between two points: wide glow, colored body, white core. */
function bolt(ctx, x1, y1, x2, y2, rnd, o = {}) {
  const { jag = 0.28, segs = 6, width = 1.6, color = '#ffe14a', glow = '#6ff7ff', alpha = 1, fork = 0 } = o;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const pts = [[x1, y1]];
  for (let i = 1; i < segs; i++) {
    const k = i / segs;
    const off = (rnd() - 0.5) * 2 * jag * len * Math.sin(Math.PI * k);
    pts.push([x1 + dx * k + nx * off, y1 + dy * k + ny * off]);
  }
  pts.push([x2, y2]);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [w, c, a] of [[width * 4.5, glow, 0.22], [width * 2.2, color, 0.65], [width, '#ffffff', 0.95]]) {
    ctx.globalAlpha = a * alpha;
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  ctx.restore();
  if (fork > 0 && pts.length > 3) {
    const [fx, fy] = pts[2 + Math.floor(rnd() * (pts.length - 3))];
    const a = Math.atan2(dy, dx) + (rnd() - 0.5) * 2.2;
    bolt(ctx, fx, fy, fx + Math.cos(a) * len * 0.4, fy + Math.sin(a) * len * 0.4, rnd, { ...o, fork: fork - 1, width: width * 0.7, segs: 3 });
  }
}

/** Additive radial glow. */
function glowA(ctx, kit, x, y, r, color, a) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, x, y, r, color, a);
  ctx.restore();
}

/** Glowing ball joint. */
function joint(ctx, kit, x, y, r, P, hot) {
  glowA(ctx, kit, x, y, r * (hot ? 3.4 : 2.4), P.accent, hot ? 0.55 : 0.35);
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = P.joint; ctx.fill();
  ctx.lineWidth = 1.6; ctx.strokeStyle = P.outline; ctx.stroke();
  const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r * 0.72);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, P.accent); g.addColorStop(1, kit.rgba(P.accent, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, TAU); ctx.fill();
}

/** Where are we inside the current move? */
function moveInfo(view) {
  const m = view.move;
  if (!m || (view.state !== 'attack' && view.state !== 'grabbing')) return null;
  const fr = view.moveFrame || 0;
  let activeEnd = m.startup;
  for (const h of m.hitboxes) activeEnd = Math.max(activeEnd, h.end);
  for (const p of m.projectiles) activeEnd = Math.max(activeEnd, p.start + 2);
  const active = m.hitboxes.some((h) => fr >= h.start && fr <= h.end) || m.projectiles.some((p) => fr >= p.start - 1 && fr <= p.start + 2);
  return { m, fr, slot: m.slot, startup: m.startup, activeEnd, active, windup: fr < m.startup, ending: fr > activeEnd };
}

/** How hard are the jets pushing? 0..1.4 */
function jetPower(view) {
  const s = view.state;
  if (s === 'helpless') return -1; // sputtering
  if (s === 'hitstun' || s === 'shieldbreak') return 0.15;
  if (s === 'run') return 0.75;
  if (s === 'jumpsquat') return 1.2;
  if (!view.grounded || s === 'air' || s === 'airdodge') return view.vy < 0 ? 1.15 : 0.5;
  if (s === 'attack' && (view.move?.slot === 'sideSpecial' || view.move?.slot === 'upSpecial')) return 1.4;
  return 0.45;
}

// ── Body parts ──────────────────────────────────────────────────────────────
function jetFlame(ctx, info, l, power, salt) {
  const { kit, u, time, palette: P } = info;
  if (power === 0) return;
  let p = power;
  if (power < 0) { // sputter
    const r = rngFor(kit, time, salt)();
    if (r < 0.55) return;
    p = 0.25 + r * 0.3;
  }
  const flick = 0.82 + Math.sin(time * 1.7 + salt) * 0.12 + Math.sin(time * 2.9 + salt * 3) * 0.08;
  const y0 = 3.2 * u;
  const len = (4 + 10 * p) * u * flick;
  const w = 3.6 * u;
  ctx.save();
  ctx.translate(l.foot.x, l.foot.y);
  ctx.rotate(-l.angle);
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, 0, y0 + len * 0.35, len * 0.9, P.effect2, 0.32 * Math.min(1, p + 0.3));
  const layers = [[1, P.effect2, 0.55], [0.7, P.accent, 0.85], [0.36, '#ffffff', 0.95]];
  for (const [k, c, a] of layers) {
    ctx.globalAlpha = a;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-w * k, y0);
    ctx.quadraticCurveTo(-w * k * 0.9, y0 + len * k * 0.55, 0, y0 + len * (0.45 + k * 0.55));
    ctx.quadraticCurveTo(w * k * 0.9, y0 + len * k * 0.55, w * k, y0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function leg(ctx, info, l, back) {
  const { kit, u, palette: P } = info;
  const sh = (c) => (back ? kit.shade(c, -0.25) : c);
  const o = { outline: P.outline, lineWidth: 2.2 };
  // thigh: thin dark strut
  kit.limb(ctx, l.hip, l.knee, 2.8 * u, 2.5 * u, sh(P.joint), o);
  // shin armor: tapers out into the thruster
  kit.limb(ctx, l.knee, l.foot, 3.9 * u, 5.4 * u, sh(P.primary), { ...o, gloss: 0.35 });
  joint(ctx, kit, l.knee.x, l.knee.y, 2.4 * u, P, false);
  // thruster boot (foot space: +y along the shin, +x toward the toe)
  ctx.save();
  ctx.translate(l.foot.x, l.foot.y);
  ctx.rotate(-l.angle);
  kit.polygonPath(ctx, [[-4.4 * u, -2.6 * u], [4.0 * u, -2.6 * u], [7.6 * u, -0.6 * u], [5.6 * u, 3.4 * u], [-5.4 * u, 3.4 * u]]);
  kit.fillShaded(ctx, sh(P.secondary), { ...o, r: 7 * u, gloss: 0.3 });
  // nozzle mouth
  ctx.beginPath(); ctx.ellipse(0, 3.4 * u, 4.6 * u, 1.3 * u, 0, 0, TAU);
  ctx.fillStyle = P.joint; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = P.outline; ctx.stroke();
  ctx.fillStyle = kit.rgba(P.accent, 0.9);
  ctx.beginPath(); ctx.ellipse(0, 3.5 * u, 3.0 * u, 0.7 * u, 0, 0, TAU); ctx.fill();
  // stripe
  ctx.fillStyle = sh(P.primary);
  ctx.fillRect(-3.8 * u, -1.2 * u, 7.6 * u, 1.1 * u);
  ctx.restore();
}

function arm(ctx, info, a, back, hot, ext = 0) {
  const { kit, u, time, palette: P } = info;
  const sh = (c) => (back ? kit.shade(c, -0.25) : c);
  const o = { outline: P.outline, lineWidth: 2.2 };
  // upper arm strut
  kit.limb(ctx, a.shoulder, a.elbow, 1.9 * u, 1.8 * u, sh(P.joint), o);
  // forearm stops short: the hand floats free on an energy tether
  const fe = { x: a.elbow.x + (a.hand.x - a.elbow.x) * 0.5, y: a.elbow.y + (a.hand.y - a.elbow.y) * 0.5 };
  kit.limb(ctx, a.elbow, fe, 3.0 * u, 3.7 * u, sh(P.primary), { ...o, gloss: 0.35 });
  joint(ctx, kit, a.elbow.x, a.elbow.y, 2.1 * u, P, hot);
  // emitter ring at the end of the forearm
  ctx.save();
  ctx.translate(fe.x, fe.y);
  ctx.rotate(-a.angle);
  kit.roundRectPath(ctx, -4.0 * u, -0.6 * u, 8.0 * u, 2.4 * u, 1 * u);
  kit.fillShaded(ctx, sh(P.secondary), { ...o, lineWidth: 1.8, r: 4 * u });
  ctx.restore();
  // tether
  const rnd = rngFor(kit, time, back ? 11 : 12);
  // `ext` launches the fist further along the arm (Rocket Palm).
  const hx = a.hand.x + Math.sin(a.angle) * ext, hy = a.hand.y + Math.cos(a.angle) * ext;
  bolt(ctx, fe.x, fe.y, hx, hy, rnd, { jag: 0.35, segs: 4, width: 0.9 * u, color: P.accent, glow: P.effect2, alpha: hot ? 1 : 0.7 });
  for (let i = 1; i <= 2; i++) {
    const k = i / 3;
    glowA(ctx, kit, fe.x + (hx - fe.x) * k, fe.y + (hy - fe.y) * k, 1.6 * u, P.accent, 0.8);
  }
  // floating fist (hand space: +y = pointing away from the forearm)
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(-a.angle);
  if (hot) glowA(ctx, kit, 0, 1 * u, 11 * u, P.accent, 0.55);
  kit.roundRectPath(ctx, -4.6 * u, -3.4 * u, 9.2 * u, 9.4 * u, 3.6 * u);
  kit.fillShaded(ctx, sh(P.primary), { ...o, r: 6 * u, gloss: 0.5 });
  // knuckle band
  kit.roundRectPath(ctx, -4.6 * u, 2.6 * u, 9.2 * u, 3.0 * u, 1.4 * u);
  kit.fillShaded(ctx, sh(P.secondary), { ...o, lineWidth: 1.6, r: 3 * u });
  // thumb
  ctx.beginPath(); ctx.ellipse(4.3 * u, -0.3 * u, 1.9 * u, 2.6 * u, 0.3, 0, TAU);
  kit.fillShaded(ctx, sh(P.primary), { ...o, lineWidth: 1.6, r: 3 * u });
  // palm light
  ctx.fillStyle = kit.rgba(P.accent, hot ? 1 : 0.75);
  ctx.beginPath(); ctx.arc(-0.6 * u, 0.2 * u, 1.2 * u, 0, TAU); ctx.fill();
  ctx.restore();
  // shoulder pod (drawn last so it caps the strut)
  kit.circle(ctx, a.shoulder.x, a.shoulder.y, 3.6 * u, sh(P.secondary), { ...o, gloss: 0.45 });
}

function chestPath(ctx, kit, u, L) {
  kit.blobPath(ctx, [
    [-9.6 * u, -0.36 * L], [-11.8 * u, -0.8 * L], [-7.5 * u, -1.1 * L], [3 * u, -1.14 * L],
    [11.2 * u, -0.86 * L], [10 * u, -0.42 * L], [1 * u, -0.24 * L],
  ], 0.55);
}

function torso(ctx, info, power) {
  const { kit, u, rig, time, palette: P } = info;
  const L = rig.torsoLen;
  const o = { outline: P.outline, lineWidth: 2.4 };
  ctx.save();
  ctx.translate(rig.hip.x, rig.hip.y);
  ctx.rotate(rig.lean);
  // pelvis pod + spine segments
  kit.circle(ctx, 0, 0.5 * u, 5.4 * u, P.joint, { ...o, gloss: 0.3 });
  ctx.strokeStyle = P.secondary; ctx.lineWidth = 1.4 * u;
  ctx.beginPath(); ctx.arc(0, 0.5 * u, 3.6 * u, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  for (const [y, w] of [[-0.2, 4.4], [-0.33, 5.2]]) {
    kit.roundRectPath(ctx, -w * u, y * L - 1.3 * u, w * 2 * u, 2.6 * u, 1.3 * u);
    kit.fillShaded(ctx, P.joint, { ...o, lineWidth: 1.8, r: 3 * u });
  }
  // chest shell
  chestPath(ctx, kit, u, L);
  kit.fillShaded(ctx, P.primary, { ...o, y: -0.7 * L, r: L * 0.6, gloss: 0.4, light: 0.2, dark: -0.28 });
  ctx.save();
  chestPath(ctx, kit, u, L);
  ctx.clip();
  // teal back panel + belly band
  ctx.fillStyle = P.secondary;
  ctx.beginPath();
  ctx.moveTo(-11 * u, -1.2 * L); ctx.lineTo(-4.5 * u, -1.2 * L); ctx.quadraticCurveTo(-7.5 * u, -0.7 * L, -4 * u, -0.2 * L); ctx.lineTo(-11 * u, -0.2 * L);
  ctx.fill();
  ctx.fillStyle = kit.shade(P.secondary, -0.25);
  ctx.fillRect(-11 * u, -0.44 * L, 22 * u, 1.6 * u);
  // cool shadow at the bottom, warm sunset rim on the back edge
  const sg = ctx.createLinearGradient(0, -0.3 * L, 0, -0.6 * L);
  sg.addColorStop(0, 'rgba(40,30,90,0.28)'); sg.addColorStop(1, 'rgba(40,30,90,0)');
  ctx.fillStyle = sg; ctx.fillRect(-12 * u, -0.6 * L, 24 * u, 0.4 * L);
  ctx.restore();
  // panel seam
  ctx.strokeStyle = kit.rgba(P.outline, 0.35); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(7.6 * u, -0.95 * L); ctx.quadraticCurveTo(5 * u, -0.7 * L, 7.2 * u, -0.48 * L); ctx.stroke();
  kit.rimLight(ctx, [[-9 * u, -0.5 * L], [-9.6 * u, -0.8 * L], [-6.2 * u, -1.03 * L], [0, -1.08 * L]], WARM, 1.8, 0.75);
  // power core with bolt glyph
  const cx = -1.6 * u, cy = -0.58 * L;
  const pulse = 0.75 + 0.25 * Math.sin(time * 0.18) + power * 0.15;
  glowA(ctx, kit, cx, cy, 9 * u * pulse, P.accent, 0.5);
  kit.circle(ctx, cx, cy, 3.9 * u, P.joint, { ...o, lineWidth: 2 });
  const cg = ctx.createRadialGradient(cx - u, cy - u, 0, cx, cy, 3.1 * u);
  cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.5, P.accent); cg.addColorStop(1, kit.shade(P.accent, -0.35));
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(cx, cy, 3.0 * u, 0, TAU); ctx.fill();
  kit.polygonPath(ctx, [[cx + 0.6 * u, cy - 2.4 * u], [cx - 1.5 * u, cy + 0.3 * u], [cx - 0.1 * u, cy + 0.3 * u], [cx - 0.7 * u, cy + 2.4 * u], [cx + 1.6 * u, cy - 0.5 * u], [cx + 0.2 * u, cy - 0.5 * u]]);
  ctx.fillStyle = P.joint; ctx.fill();
  ctx.restore();
  // neck
  kit.limb(ctx, rig.chest, rig.neck, 2.2 * u, 2.2 * u, P.joint, o);
}

// Pixel-face bitmaps ("X" = lit pixel). Left/right eye, then the mouth.
const FACES = {
  normal: { l: ['XX', 'XX', 'XX'], r: ['XX', 'XX', 'XX'], m: ['X..X', '.XX.'] },
  blink: { l: ['...', 'XXX'], r: ['...', 'XXX'], m: ['X..X', '.XX.'] },
  fierce: { l: ['X..', 'XX.', 'XXX'], r: ['..X', '.XX', 'XXX'], m: ['XXXX'] },
  worried: { l: ['..X', '.XX', 'XXX'], r: ['X..', 'XX.', 'XXX'], m: ['.XX.', 'X..X'] },
  hurt: { l: ['X.X', '.X.', 'X.X'], r: ['X.X', '.X.', 'X.X'], m: ['X.X.', '.X.X'] },
  dizzy: { l: ['XXX', 'X.X', 'XXX'], r: ['XXX', 'X.X', 'XXX'], m: ['X.X.', '.X.X'] },
  happy: { l: ['.X.', 'X.X'], r: ['.X.', 'X.X'], m: ['X..X', '.XX.'] },
};

function pixels(ctx, rows, cx, cy, px, color, hi) {
  const h = rows.length, w = rows[0].length;
  const x0 = cx - (w * px) / 2, y0 = cy - (h * px) / 2;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (rows[j][i] !== 'X') continue;
      ctx.fillStyle = hi && j === 0 && i === 0 ? '#ffffff' : color;
      ctx.fillRect(x0 + i * px + px * 0.08, y0 + j * px + px * 0.08, px * 0.84, px * 0.84);
    }
  }
}

function headPath(ctx, kit, r) {
  kit.blobPath(ctx, [
    [1.08 * r, -0.12 * r], [0.86 * r, -0.82 * r], [0, -1.0 * r], [-0.86 * r, -0.8 * r],
    [-1.04 * r, 0.02 * r], [-0.82 * r, 0.7 * r], [0.05 * r, 0.86 * r], [0.9 * r, 0.66 * r],
  ], 0.5);
}

function head(ctx, info, mv) {
  const { kit, rig, u, time, palette: P, view } = info;
  const r = rig.headR;
  const o = { outline: P.outline, lineWidth: 2.6 };
  ctx.save();
  ctx.translate(rig.headC.x, rig.headC.y);
  ctx.rotate(rig.headAngle);
  // antenna (springs back against movement)
  const sway = Math.sin(time * 0.11) * 0.08 * r - (view.vx || 0) * 0.25 * u * (view.facing || 1) + Math.max(-4, Math.min(6, view.vy || 0)) * 0.12 * u;
  const tipX = -0.62 * r + sway, tipY = -1.62 * r;
  ctx.strokeStyle = P.outline; ctx.lineWidth = 1.8 * u + 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-0.42 * r, -0.8 * r); ctx.quadraticCurveTo(-0.5 * r, -1.25 * r, tipX, tipY); ctx.stroke();
  ctx.strokeStyle = P.joint; ctx.lineWidth = 1.8 * u;
  ctx.beginPath(); ctx.moveTo(-0.42 * r, -0.8 * r); ctx.quadraticCurveTo(-0.5 * r, -1.25 * r, tipX, tipY); ctx.stroke();
  const hot = info.expression === 'fierce';
  const blink = 0.6 + 0.4 * Math.sin(time * (hot ? 0.5 : 0.12));
  glowA(ctx, kit, tipX, tipY, r * (hot ? 0.75 : 0.55), P.accent, 0.6 * blink);
  kit.circle(ctx, tipX, tipY, 0.17 * r, P.accent, { outline: P.outline, lineWidth: 2, gloss: 0.8, light: 0.5 });
  // helmet shell
  headPath(ctx, kit, r);
  kit.fillShaded(ctx, P.primary, { ...o, r: r * 1.1, gloss: 0.55, light: 0.22, dark: -0.3 });
  ctx.save();
  headPath(ctx, kit, r);
  ctx.clip();
  // crown fin stripe
  ctx.fillStyle = P.secondary;
  ctx.beginPath(); ctx.ellipse(-0.05 * r, -1.02 * r, 0.95 * r, 0.3 * r, 0.08, 0, TAU); ctx.fill();
  // underside shade
  const sg = ctx.createLinearGradient(0, 0.3 * r, 0, 0.9 * r);
  sg.addColorStop(0, 'rgba(40,30,90,0)'); sg.addColorStop(1, 'rgba(40,30,90,0.3)');
  ctx.fillStyle = sg; ctx.fillRect(-1.2 * r, 0.3 * r, 2.4 * r, 0.7 * r);
  ctx.restore();
  kit.rimLight(ctx, [[-0.98 * r, 0.1 * r], [-0.86 * r, -0.62 * r], [-0.4 * r, -0.9 * r]], WARM, 2, 0.8);
  // ear pod
  kit.circle(ctx, -0.58 * r, 0.1 * r, 0.3 * r, P.secondary, { outline: P.outline, lineWidth: 2.2, gloss: 0.5 });
  ctx.beginPath(); ctx.arc(-0.58 * r, 0.1 * r, 0.16 * r, 0, TAU);
  ctx.fillStyle = P.joint; ctx.fill();
  glowA(ctx, kit, -0.58 * r, 0.1 * r, 0.28 * r, P.accent, 0.6);
  ctx.fillStyle = P.accent; ctx.beginPath(); ctx.arc(-0.58 * r, 0.1 * r, 0.065 * r, 0, TAU); ctx.fill();

  // face screen
  const vx = -0.1 * r, vy = -0.58 * r, vw = 1.14 * r, vh = 1.08 * r;
  kit.roundRectPath(ctx, vx, vy, vw, vh, 0.42 * r);
  const vg = ctx.createLinearGradient(0, vy, 0, vy + vh);
  vg.addColorStop(0, kit.shade(P.visor, 0.12)); vg.addColorStop(1, P.visor);
  ctx.fillStyle = vg; ctx.fill();
  ctx.lineWidth = 2.4; ctx.strokeStyle = P.outline; ctx.stroke();
  ctx.save();
  kit.roundRectPath(ctx, vx, vy, vw, vh, 0.42 * r);
  ctx.clip();
  const ex = info.expression;
  const face = FACES[ex] || FACES.normal;
  const col = ex === 'fierce' ? P.accent : ex === 'hurt' ? '#ff6a7d' : P.eyes;
  const look = mv && !mv.ending ? 0.06 * r : 0;
  const px = r * 0.125;
  const jit = ex === 'hurt' || ex === 'dizzy' ? (rngFor(kit, time, 3)() - 0.5) * 0.06 * r : 0;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  kit.glow(ctx, 0.24 * r + look, -0.1 * r, 0.36 * r, col, 0.5);
  kit.glow(ctx, 0.72 * r + look, -0.1 * r, 0.36 * r, col, 0.5);
  ctx.restore();
  if (ex === 'dizzy') {
    // rotating ring eyes
    for (const ecx of [0.24 * r, 0.72 * r]) {
      ctx.strokeStyle = col; ctx.lineWidth = px * 0.75;
      ctx.beginPath(); ctx.arc(ecx, -0.1 * r, px * 1.1, time * 0.25, time * 0.25 + 4.6); ctx.stroke();
    }
  } else {
    pixels(ctx, face.l, 0.24 * r + look + jit, -0.1 * r, px, col, ex === 'normal');
    pixels(ctx, face.r, 0.72 * r + look + jit, -0.1 * r, px, col, ex === 'normal');
  }
  pixels(ctx, face.m, 0.48 * r + look, 0.28 * r, px * 0.62, kit.rgba(col, 0.9), false);
  // scanlines + glass glint
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = vy + ((time * 0.4) % 3); y < vy + vh; y += 3) ctx.fillRect(vx, y, vw, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.moveTo(vx + 0.62 * r, vy); ctx.lineTo(vx + 0.86 * r, vy); ctx.lineTo(vx + 0.46 * r, vy + vh); ctx.lineTo(vx + 0.22 * r, vy + vh);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

// ── Effects layered on top of the body ─────────────────────────────────────
function leadPoints(info, lead) {
  const { rig } = info;
  const c = { x: rig.hip.x, y: rig.hip.y - rig.torsoLen * 0.4 };
  switch (lead) {
    case 'frontHand': return [rig.armF.hand];
    case 'hands': return [rig.armF.hand, rig.armB.hand];
    case 'frontFoot': return [rig.legF.foot];
    case 'feet': return [rig.legF.foot, rig.legB.foot];
    default: return [c];
  }
}

function attackFx(ctx, info, mv) {
  const { kit, u, time, palette: P, rig } = info;
  const rnd = rngFor(kit, time, 41);
  const bodyC = { x: rig.hip.x, y: rig.hip.y - rig.torsoLen * 0.4 };
  let pts = leadPoints(info, LEAD[mv.slot] || 'frontHand');
  if (mv.slot === 'side') { const a = rig.armF; pts = [{ x: a.hand.x + Math.sin(a.angle) * 11, y: a.hand.y + Math.cos(a.angle) * 11 }]; }
  const boltO = { color: P.accent, glow: P.effect2 };

  // Windup: sparks gather around the leading part.
  if (mv.windup || info.view.charging) {
    for (const p of pts) {
      glowA(ctx, kit, p.x, p.y, 10 * u, P.accent, 0.4);
      for (let i = 0; i < 2; i++) {
        const a = rnd() * TAU, d = (6 + rnd() * 8) * u;
        bolt(ctx, p.x, p.y, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, rnd, { ...boltO, width: 0.9 * u, segs: 3 });
      }
    }
    if (mv.slot === 'sideSmash' || mv.slot === 'downSpecial' || info.view.charging) {
      bolt(ctx, rig.armF.hand.x, rig.armF.hand.y, rig.armB.hand.x, rig.armB.hand.y, rnd, { ...boltO, width: 1.1 * u, jag: 0.4 });
    }
    return;
  }
  if (!mv.active) return;

  // Generic crackle at the leading part.
  for (const p of pts) {
    glowA(ctx, kit, p.x, p.y, 16 * u, P.accent, 0.55);
    for (let i = 0; i < 3; i++) {
      const a = rnd() * TAU, d = (10 + rnd() * 12) * u;
      bolt(ctx, p.x, p.y, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, rnd, { ...boltO, width: 1.1 * u, fork: 1 });
    }
  }
  // Core → hand surge on hand moves.
  if (pts[0] === rig.armF.hand) {
    const cx = rig.hip.x + Math.sin(rig.lean) * rig.torsoLen * 0.7, cy = rig.hip.y - Math.cos(rig.lean) * rig.torsoLen * 0.7;
    bolt(ctx, cx, cy, rig.armF.hand.x, rig.armF.hand.y, rnd, { ...boltO, width: 0.9 * u, alpha: 0.6 });
  }

  // Signature effects per move (sizes are in px to match the hitboxes).
  const hbs = mv.m.hitboxes.filter((h) => mv.fr >= h.start && mv.fr <= h.end);
  switch (mv.slot) {
    case 'upSmash': {
      const h = rig.armF.hand;
      const top = -128;
      for (let i = 0; i < 3; i++) bolt(ctx, h.x + (rnd() - 0.5) * 6, h.y, (rnd() - 0.5) * 30, top + rnd() * 20, rnd, { ...boltO, width: (2.2 - i * 0.5) * u, segs: 8, jag: 0.12, fork: 2 });
      glowA(ctx, kit, 4, -100, 34, P.accent, 0.45);
      break;
    }
    case 'sideSmash': {
      const hx = (rig.armF.hand.x + rig.armB.hand.x) / 2, hy = (rig.armF.hand.y + rig.armB.hand.y) / 2;
      const big = hbs.some((h) => h.group === 2);
      glowA(ctx, kit, hx + 8, hy, big ? 40 : 22, '#ffffff', big ? 0.8 : 0.5);
      for (let i = 0; i < (big ? 7 : 4); i++) {
        const a = (rnd() - 0.5) * 1.6;
        const d = (big ? 46 : 28) + rnd() * 16;
        bolt(ctx, hx, hy, hx + Math.cos(a) * d, hy + Math.sin(a) * d, rnd, { ...boltO, width: 1.4 * u, fork: 1 });
      }
      break;
    }
    case 'downSmash': {
      for (const h of hbs) {
        const s = Math.sign(h.x);
        for (let i = 0; i < 3; i++) bolt(ctx, s * 8, -2, h.x + s * (rnd() * 18 - 4), -2 - rnd() * 22, rnd, { ...boltO, width: 1.3 * u, segs: 7, jag: 0.2 });
        glowA(ctx, kit, h.x, -6, h.r * 1.3, P.accent, 0.4);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = kit.rgba(P.effect2, 0.7); ctx.lineWidth = 2.5 * u;
      ctx.beginPath(); ctx.ellipse(0, -3, 52 + rnd() * 6, 8, 0, 0, TAU); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'nair': case 'downSpecial': {
      const h = hbs[0];
      if (!h) break;
      const R = h.r;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(bodyC.x, bodyC.y, R * 0.3, bodyC.x, bodyC.y, R);
      g.addColorStop(0, kit.rgba(P.effect2, 0)); g.addColorStop(0.8, kit.rgba(P.effect2, 0.18)); g.addColorStop(1, kit.rgba(P.accent, 0.45));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bodyC.x, bodyC.y, R, 0, TAU); ctx.fill();
      ctx.restore();
      const n = mv.slot === 'nair' ? 5 : 8;
      for (let i = 0; i < n; i++) {
        const a0 = rnd() * TAU, a1 = a0 + 0.6 + rnd() * 0.8;
        bolt(ctx, bodyC.x + Math.cos(a0) * R, bodyC.y + Math.sin(a0) * R, bodyC.x + Math.cos(a1) * R, bodyC.y + Math.sin(a1) * R, rnd, { ...boltO, width: 1.2 * u, segs: 5, jag: 0.25 });
      }
      for (let i = 0; i < 3; i++) {
        const a = rnd() * TAU;
        bolt(ctx, bodyC.x, bodyC.y, bodyC.x + Math.cos(a) * R, bodyC.y + Math.sin(a) * R, rnd, { ...boltO, width: 1 * u, alpha: 0.7 });
      }
      break;
    }
    case 'dair': {
      const fx = (rig.legF.foot.x + rig.legB.foot.x) / 2, fy = Math.max(rig.legF.foot.y, rig.legB.foot.y) + 4 * u;
      const spin = time * 0.6;
      for (let i = 0; i < 4; i++) {
        const a = spin + (i * TAU) / 4;
        const w = Math.cos(a) * 14;
        bolt(ctx, fx + w, fy, fx + w * 0.2, fy + 26, rnd, { ...boltO, width: 1.1 * u, segs: 4, jag: 0.2 });
      }
      glowA(ctx, kit, fx, fy + 8, 26, P.accent, 0.5);
      break;
    }
    case 'up': case 'uair': {
      for (const h of hbs) glowA(ctx, kit, h.x, h.y, h.r * 1.1, P.accent, 0.3);
      break;
    }
    case 'bair': {
      for (const h of hbs) {
        glowA(ctx, kit, h.x, h.y, h.r * 1.4, '#ffffff', 0.45);
        for (let i = 0; i < 3; i++) bolt(ctx, h.x + 10, h.y, h.x - 18 - rnd() * 14, h.y + (rnd() - 0.5) * 26, rnd, { ...boltO, width: 1.3 * u });
      }
      break;
    }
    default: break;
  }
}

/** Speed streaks + afterimage aura for the dash and the blink recovery. */
function travelFx(ctx, info, mv) {
  const { kit, u, time, palette: P, rig } = info;
  const rnd = rngFor(kit, time, 77);
  const bodyC = { x: rig.hip.x, y: rig.hip.y - rig.torsoLen * 0.4 };
  const moving = mv.m.velocity.some((v) => mv.fr >= v.start && mv.fr <= v.end && ((v.vx || 0) > 4 || (v.vy || 0) < -4));
  if (!moving) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (mv.slot === 'sideSpecial') {
    for (let i = 0; i < 6; i++) {
      const y = bodyC.y + (rnd() - 0.5) * 60;
      const len = 30 + rnd() * 50;
      const g = ctx.createLinearGradient(bodyC.x - 10, 0, bodyC.x - 10 - len, 0);
      g.addColorStop(0, kit.rgba(i % 2 ? P.accent : P.effect2, 0.8)); g.addColorStop(1, kit.rgba(P.effect2, 0));
      ctx.strokeStyle = g; ctx.lineWidth = (1 + rnd() * 2) * u * 1.5;
      ctx.beginPath(); ctx.moveTo(bodyC.x - 8, y); ctx.lineTo(bodyC.x - 8 - len, y); ctx.stroke();
    }
    ctx.restore();
    bolt(ctx, bodyC.x, bodyC.y, bodyC.x - 70, bodyC.y + (rnd() - 0.5) * 20, rnd, { color: P.accent, glow: P.effect2, width: 1.6 * u, segs: 7, jag: 0.15 });
  } else {
    // blink-bolt: a lightning trail below where Volt re-forms
    const g = ctx.createLinearGradient(0, bodyC.y, 0, bodyC.y + 110);
    g.addColorStop(0, kit.rgba(P.effect2, 0.5)); g.addColorStop(1, kit.rgba(P.effect2, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(bodyC.x - 14, bodyC.y); ctx.lineTo(bodyC.x + 14, bodyC.y); ctx.lineTo(bodyC.x + 3, bodyC.y + 110); ctx.lineTo(bodyC.x - 3, bodyC.y + 110); ctx.fill();
    ctx.restore();
    for (let i = 0; i < 2; i++) bolt(ctx, bodyC.x, bodyC.y + 10, bodyC.x + (rnd() - 0.5) * 24, bodyC.y + 120, rnd, { color: P.accent, glow: P.effect2, width: (2 - i * 0.8) * u, segs: 8, jag: 0.14, fork: 1 });
  }
}

function hurtSparks(ctx, info) {
  const { kit, u, time, rig, palette: P } = info;
  const rnd = rngFor(kit, time, 5);
  if (rnd() < 0.45) return;
  const h = rig.headC;
  const a = rnd() * TAU, d = rig.headR * (0.9 + rnd() * 0.4);
  const x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d;
  bolt(ctx, x, y, x + Math.cos(a) * 9 * u, y + Math.sin(a) * 9 * u, rnd, { color: P.accent, glow: P.effect2, width: 0.9 * u, segs: 3, fork: 1 });
}

// ── Main draw ───────────────────────────────────────────────────────────────
// State faces the puppet doesn't pick on its own (readability: stun must read at a glance).
const STATE_FACE = { stunned: 'dizzy', grabbed: 'hurt', taunt: 'happy', respawn: 'happy', grabbing: 'fierce' };

/** Stunned: a ring of crackling sparks orbiting the head (the "seeing stars" cue). */
function stunHalo(ctx, info) {
  const { kit, u, time, rig, palette: P } = info;
  const h = rig.headC, R = rig.headR * 1.35;
  const rnd = rngFor(kit, time, 9);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = kit.rgba(P.effect2, 0.35); ctx.lineWidth = 1.4 * u;
  ctx.beginPath(); ctx.ellipse(h.x, h.y - rig.headR * 1.05, R, R * 0.32, 0, 0, TAU); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const a = time * 0.16 + (i * TAU) / 3;
    const x = h.x + Math.cos(a) * R, y = h.y - rig.headR * 1.05 + Math.sin(a) * R * 0.32;
    kit.glow(ctx, x, y, 7 * u, P.accent, 0.7);
    bolt(ctx, x - 3 * u, y - 3 * u, x + 3 * u, y + 3 * u, rnd, { color: P.accent, glow: P.effect2, width: 0.9 * u, segs: 3 });
  }
  ctx.restore();
}

export function drawVolt(ctx, info) {
  const { rig, u, time, view } = info;
  if (STATE_FACE[view.state]) info.expression = STATE_FACE[view.state];
  const mv = moveInfo(view);
  const power = jetPower(view);
  const tumble = view.state === 'hitstun' || view.state === 'helpless';
  // Volt never quite touches the floor.
  const hover = tumble ? 0 : (2.4 + Math.sin(time * 0.09) * 1.4) * u;
  const blink = mv && mv.slot === 'upSpecial' && mv.fr >= 4 && mv.fr <= 12;

  ctx.save();
  ctx.translate(0, -hover);
  if (mv && (mv.slot === 'sideSpecial' || mv.slot === 'upSpecial')) travelFx(ctx, info, mv);

  ctx.save();
  // Flash Step: Volt dissolves into static for a moment.
  if (blink) ctx.globalAlpha = 0.35 + 0.25 * Math.sin(time * 1.3);
  const hot = mv && (mv.active || mv.windup);
  const hotF = hot && ['frontHand', 'hands'].includes(LEAD[mv.slot]);
  const hotB = hot && LEAD[mv.slot] === 'hands';

  jetFlame(ctx, info, rig.legB, power, 1);
  leg(ctx, info, rig.legB, true);
  arm(ctx, info, rig.armB, true, hotB);
  torso(ctx, info, hot ? 1 : 0);
  jetFlame(ctx, info, rig.legF, power, 2);
  leg(ctx, info, rig.legF, false);
  head(ctx, info, mv);
  const rocket = mv && mv.slot === 'side' && mv.fr >= mv.startup - 1 && mv.fr <= mv.activeEnd + 4 ? 11 : 0;
  arm(ctx, info, rig.armF, false, hotF, rocket);
  ctx.restore();

  if (mv) attackFx(ctx, info, mv);
  if (info.expression === 'hurt' || info.expression === 'dizzy') hurtSparks(ctx, info);
  if (view.state === 'stunned' || view.state === 'shieldbreak') stunHalo(ctx, info);
  ctx.restore();
}

// ── Projectile: Ball Lightning ──────────────────────────────────────────────
// ctx is centered on the projectile and pre-flipped so +x = direction of travel.
export function drawVoltProjectile(ctx, p) {
  const { kit, t, r, palette: P } = p;
  const fade = Math.min(1, (p.life ?? 30) / 12);
  const rnd = kit.seeded(Math.floor(t / 2) * 31 + (p.id || 0) * 17);
  ctx.globalAlpha = fade;
  ctx.globalCompositeOperation = 'lighter';
  // comet tail
  for (let i = 1; i <= 6; i++) {
    const k = i / 6;
    kit.glow(ctx, -i * r * 0.62, Math.sin(t * 0.5 + i) * r * 0.18, r * (1.5 - k * 0.9), i % 2 ? P.effect2 : P.accent, 0.32 - k * 0.22);
  }
  kit.glow(ctx, 0, 0, r * 2.8, P.accent, 0.55);
  kit.glow(ctx, 0, 0, r * 1.8, P.effect2, 0.4);
  // crackling tendrils
  for (let i = 0; i < 5; i++) {
    const a = rnd() * TAU;
    const d = r * (1.4 + rnd() * 1.1);
    bolt(ctx, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, Math.cos(a) * d, Math.sin(a) * d, rnd, { color: P.accent, glow: P.effect2, width: 1.1, segs: 4, jag: 0.3, fork: i % 2 });
  }
  // spinning containment rings
  ctx.lineWidth = 2;
  for (let i = 0; i < 2; i++) {
    ctx.strokeStyle = kit.rgba(i ? P.effect2 : '#ffffff', 0.75);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r * 0.42, t * 0.15 + i * 1.6, 0, TAU);
    ctx.stroke();
  }
  // core
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createRadialGradient(-r * 0.25, -r * 0.25, 0, 0, 0, r * 0.85);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#fff7c2'); g.addColorStop(0.8, P.accent); g.addColorStop(1, kit.rgba(P.accent, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, TAU); ctx.fill();
  // crisp inner core with a bolt glyph so it reads at small sizes
  ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU);
  ctx.fillStyle = '#fffbe0'; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = P.accent; ctx.stroke();
  kit.polygonPath(ctx, [[r * 0.12, -r * 0.4], [-r * 0.22, r * 0.05], [-r * 0.02, r * 0.05], [-r * 0.12, r * 0.4], [r * 0.24, -r * 0.08], [r * 0.03, -r * 0.08]]);
  ctx.fillStyle = kit.shade(P.accent, -0.3); ctx.fill();
  ctx.globalAlpha = 1;
}
