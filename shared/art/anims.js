// ─────────────────────────────────────────────────────────────────────────────
// Animation library for the puppet rig.
//
// A Pose is a set of joint angles (radians) for a character facing RIGHT.
// Limb angles: 0 = pointing straight down, +π/2 = pointing forward, π = up.
//   arms:  *U = upper arm (relative to torso), *L = forearm (relative to upper arm, + bends elbow forward)
//   legs:  *U = thigh (relative to vertical),   *L = shin (relative to thigh, − bends knee back)
//   lean:  torso tilt (+ = forward), head: head tilt, spin: whole-body rotation,
//   bx/by: body offset in "rig units" (1 unit = 1% of height), sx/sy: squash & stretch.
//
// Moves pick an attack animation by name (`anim: 'uppercut'`). Each attack anim
// has a windup pose (held during startup) and a strike pose (during active frames),
// then eases back to neutral during endlag. Characters never need to touch this,
// but you're welcome to suggest new anims to the repo owner.
// ─────────────────────────────────────────────────────────────────────────────

export const NEUTRAL = Object.freeze({
  lean: 0.06, head: 0, spin: 0, bx: 0, by: 0, sx: 1, sy: 1,
  fU: 0.25, fL: 0.55, bU: -0.2, bL: 0.5,
  flU: 0.14, flL: -0.12, blU: -0.12, blL: -0.08,
});

export function pose(over) { return { ...NEUTRAL, ...over }; }

export function lerpPose(a, b, t) {
  const o = {};
  for (const k in NEUTRAL) o[k] = a[k] + (b[k] - a[k]) * t;
  return o;
}

const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const TAU = Math.PI * 2;

// ── Attack animations ───────────────────────────────────────────────────────
// limb: which body part "leads" the attack (used for trail effects).
export const ANIMATIONS = {
  jab: {
    limb: 'frontHand',
    windup: pose({ lean: 0.0, fU: -0.3, fL: 1.9, bU: 0.5, bL: 1.4 }),
    strike: pose({ lean: 0.18, fU: 1.55, fL: 0.05, bU: -0.4, bL: 1.2, flU: 0.35, blU: -0.35 }),
  },
  punch: {
    limb: 'frontHand',
    windup: pose({ lean: -0.15, fU: -0.7, fL: 1.8, bU: 0.6, bL: 1.0, flU: 0.3, blU: -0.3 }),
    strike: pose({ lean: 0.32, fU: 1.6, fL: 0.0, bU: -0.7, bL: 0.6, flU: 0.55, flL: -0.3, blU: -0.5, bx: 6 }),
  },
  heavyPunch: {
    limb: 'frontHand',
    windup: pose({ lean: -0.35, fU: -1.3, fL: 1.6, bU: 0.9, bL: 0.6, flU: 0.5, flL: -0.6, blU: -0.4, bx: -8, by: 3 }),
    strike: pose({ lean: 0.5, fU: 1.62, fL: -0.05, bU: -1.1, bL: 0.4, flU: 0.9, flL: -0.9, blU: -0.7, bx: 14, sx: 1.06, sy: 0.95 }),
  },
  uppercut: {
    limb: 'frontHand',
    windup: pose({ lean: 0.25, fU: -0.2, fL: 2.2, flU: 0.5, flL: -0.9, blU: -0.4, by: 6 }),
    strike: pose({ lean: -0.15, fU: 2.9, fL: 0.25, bU: -0.6, flU: 0.2, blU: -0.25, by: -4, sy: 1.08 }),
  },
  upSmash: {
    limb: 'frontHand',
    windup: pose({ lean: 0.3, fU: 0.3, fL: 1.8, bU: 0.3, bL: 1.8, flU: 0.6, flL: -1.1, blU: -0.5, blL: -0.4, by: 12, sy: 0.88, sx: 1.08 }),
    strike: pose({ lean: -0.05, fU: 3.0, fL: 0.1, bU: 2.9, bL: 0.1, flU: 0.2, blU: -0.2, by: -6, sy: 1.12, sx: 0.94 }),
  },
  sweep: {
    limb: 'frontFoot',
    windup: pose({ lean: 0.3, flU: 0.9, flL: -1.6, blU: -0.6, blL: -0.9, by: 18, fU: 0.6, bU: -0.6 }),
    strike: pose({ lean: 0.35, flU: 1.45, flL: 0.0, blU: -0.4, blL: -1.6, by: 22, fU: -0.4, bU: 0.6 }),
  },
  splits: {
    limb: 'frontFoot',
    windup: pose({ lean: 0.1, flU: 0.4, flL: -1.2, blU: -0.4, blL: -1.2, by: 14, fU: 1.2, bU: -1.2, sy: 0.9 }),
    strike: pose({ lean: 0.0, flU: 1.5, flL: 0.0, blU: -1.5, blL: 0.0, by: 26, fU: 1.9, fL: 0.1, bU: -1.9, bL: 0.1 }),
  },
  kick: {
    limb: 'frontFoot',
    windup: pose({ lean: -0.25, flU: 0.9, flL: -1.8, fU: -0.4, bU: 0.6 }),
    strike: pose({ lean: -0.4, flU: 1.6, flL: 0.0, blU: -0.15, fU: -0.6, fL: 0.9, bU: 0.8, bx: 4 }),
  },
  slash: {
    limb: 'frontHand',
    windup: pose({ lean: -0.2, fU: 2.6, fL: 0.6, bU: -0.3, flU: 0.3, blU: -0.3 }),
    strike: pose({ lean: 0.3, fU: 0.5, fL: 0.0, bU: -0.9, flU: 0.5, flL: -0.4, blU: -0.4, bx: 8 }),
  },
  overhead: {
    limb: 'frontHand',
    windup: pose({ lean: -0.3, fU: 3.3, fL: 0.6, bU: 3.0, bL: 0.6, by: -2, sy: 1.06 }),
    strike: pose({ lean: 0.55, fU: 1.0, fL: 0.0, bU: 0.9, bL: 0.1, flU: 0.6, flL: -0.7, blU: -0.5, by: 8, bx: 10, sy: 0.94 }),
  },
  thrust: {
    limb: 'frontHand',
    windup: pose({ lean: -0.2, fU: 0.2, fL: 2.0, bU: 0.5, bL: 1.5, bx: -6, flU: 0.4, blU: -0.4 }),
    strike: pose({ lean: 0.35, fU: 1.57, fL: 0.0, bU: 1.3, bL: 0.4, bx: 16, flU: 0.8, flL: -0.6, blU: -0.6 }),
  },
  headbutt: {
    limb: 'head',
    windup: pose({ lean: -0.5, head: -0.4, fU: -0.5, bU: -0.6 }),
    strike: pose({ lean: 0.75, head: 0.4, fU: -0.9, fL: 0.3, bU: -0.9, bL: 0.3, bx: 12, flU: 0.5, blU: -0.4 }),
  },
  // Aerials
  spin: {
    limb: 'body', spinTurns: 1,
    windup: pose({ fU: 1.2, bU: -1.2, flU: 0.6, flL: -1.0, blU: -0.6, blL: -1.0, sy: 0.92 }),
    strike: pose({ fU: 1.6, fL: 0.1, bU: -1.6, bL: 0.1, flU: 1.2, flL: -0.2, blU: -1.2, blL: -0.2 }),
  },
  airKick: {
    limb: 'frontFoot',
    windup: pose({ lean: -0.2, flU: 1.0, flL: -2.0, blU: 0.2, blL: -1.4, fU: -0.5, bU: 0.6 }),
    strike: pose({ lean: -0.45, flU: 1.75, flL: 0.0, blU: 0.1, blL: -1.6, fU: -0.9, fL: 0.6, bU: 1.0 }),
  },
  backKick: {
    limb: 'backFoot',
    windup: pose({ lean: 0.3, blU: -0.4, blL: -2.0, flU: 0.6, flL: -1.2, head: -0.2 }),
    strike: pose({ lean: 0.55, blU: -1.75, blL: 0.0, flU: 0.4, flL: -1.3, head: -0.4, fU: 0.9, bU: -0.3 }),
  },
  flipKick: {
    limb: 'frontFoot', spinTurns: -1,
    windup: pose({ flU: 0.9, flL: -1.8, blU: 0.5, blL: -1.5, fU: -0.5, bU: -0.5, sy: 0.9 }),
    strike: pose({ flU: 2.6, flL: 0.0, blU: 0.3, blL: -1.2, fU: -1.0, bU: -1.0, lean: -0.3 }),
  },
  stomp: {
    limb: 'frontFoot',
    windup: pose({ flU: 1.2, flL: -2.0, blU: 0.9, blL: -1.8, fU: 2.2, bU: 2.2, by: -10, lean: 0.1 }),
    strike: pose({ flU: 0.1, flL: 0.0, blU: -0.1, blL: 0.0, fU: 0.4, fL: 0.2, bU: -0.4, bL: 0.2, by: 6, sy: 1.1, lean: 0.05 }),
  },
  // Specials
  cast: {
    limb: 'frontHand',
    windup: pose({ lean: -0.2, fU: 0.4, fL: 2.2, bU: 0.6, bL: 2.0, bx: -4 }),
    strike: pose({ lean: 0.25, fU: 1.5, fL: 0.05, bU: 1.35, bL: 0.2, flU: 0.4, flL: -0.3, blU: -0.4, bx: 6 }),
  },
  dash: {
    limb: 'frontHand',
    windup: pose({ lean: 0.6, fU: -0.6, fL: 0.4, bU: -0.9, bL: 0.4, flU: 0.8, flL: -1.4, blU: -0.6, blL: -0.8, by: 10 }),
    strike: pose({ lean: 0.9, fU: 1.4, fL: 0.1, bU: -1.3, bL: 0.2, flU: 0.6, flL: -0.9, blU: -1.0, blL: -0.4, bx: 8, sx: 1.12, sy: 0.9 }),
  },
  rise: {
    limb: 'frontHand',
    windup: pose({ lean: 0.2, fU: 0.2, fL: 1.2, bU: 0.2, bL: 1.2, flU: 0.9, flL: -1.8, blU: 0.6, blL: -1.6, by: 14, sy: 0.85, sx: 1.1 }),
    strike: pose({ lean: -0.05, fU: 3.05, fL: 0.05, bU: 2.8, bL: 0.2, flU: 0.1, flL: -0.1, blU: -0.15, blL: -0.2, sy: 1.15, sx: 0.9 }),
  },
  slam: {
    limb: 'frontHand',
    windup: pose({ lean: -0.1, fU: 3.0, fL: 0.4, bU: 3.0, bL: 0.4, flU: 0.8, flL: -1.6, blU: 0.4, blL: -1.4, by: -8 }),
    strike: pose({ lean: 0.4, fU: 0.6, fL: 0.1, bU: 0.4, bL: 0.1, flU: 0.7, flL: -1.2, blU: -0.7, blL: -0.9, by: 16, sx: 1.12, sy: 0.88 }),
  },
  guard: {
    limb: 'body',
    windup: pose({ lean: -0.1, fU: 1.0, fL: 1.8, bU: 1.0, bL: 1.8, by: 6, sy: 0.95 }),
    strike: pose({ lean: 0.0, fU: 1.4, fL: 1.2, bU: -1.4, bL: 1.2, flU: 0.5, flL: -0.4, blU: -0.5, blL: -0.4, by: 4, sx: 1.08, sy: 0.96 }),
  },
  drill: {
    limb: 'frontFoot', spinTurns: 2,
    windup: pose({ fU: 3.0, bU: 3.0, fL: 0.1, bL: 0.1, flU: 0.1, blU: -0.1, sy: 1.05 }),
    strike: pose({ fU: 3.1, bU: 3.1, fL: 0.0, bL: 0.0, flU: 0.05, blU: -0.05, flL: 0, blL: 0, sy: 1.1, sx: 0.9 }),
  },
};

// ── Movement poses ─────────────────────────────────────────────────────────
function idle(t) {
  const b = Math.sin(t * 0.07);
  return pose({ by: b * 1.2, lean: 0.06 + b * 0.015, fU: 0.3 + b * 0.04, bU: -0.18 - b * 0.04, head: b * 0.03, sy: 1 + b * 0.012 });
}

function run(t, speed01) {
  const p = t * (0.2 + speed01 * 0.12);
  const s = Math.sin(p);
  const c = Math.cos(p);
  const amp = 0.4 + speed01 * 0.6;
  return pose({
    lean: 0.22 + speed01 * 0.18,
    by: -Math.abs(c) * 4 * amp,
    fU: -s * 1.0 * amp, fL: 1.3, bU: s * 1.0 * amp, bL: 1.3,
    flU: s * 0.95 * amp, flL: -0.3 - Math.max(0, -c) * 1.4 * amp,
    blU: -s * 0.95 * amp, blL: -0.3 - Math.max(0, c) * 1.4 * amp,
    head: -0.1,
  });
}

const JUMP = pose({ lean: -0.05, fU: 1.6, fL: 0.6, bU: -1.2, bL: 0.8, flU: 0.9, flL: -1.6, blU: -0.2, blL: -0.6, sy: 1.08, sx: 0.95 });
const FALL = pose({ lean: 0.08, fU: 2.0, fL: 0.5, bU: -1.9, bL: 0.4, flU: 0.4, flL: -0.6, blU: -0.3, blL: -0.9 });
const CROUCH = pose({ lean: 0.4, by: 22, flU: 1.0, flL: -2.0, blU: -0.2, blL: -2.0, fU: 0.6, fL: 1.2, bU: 0.3, bL: 1.2, head: 0.2, sx: 1.04 });
const SQUAT = pose({ lean: 0.25, by: 16, flU: 0.8, flL: -1.6, blU: -0.4, blL: -1.4, fU: -0.3, bU: -0.6, sy: 0.88, sx: 1.1 });
const SHIELD = pose({ lean: -0.05, by: 6, fU: 1.0, fL: 2.0, bU: 0.8, bL: 2.1, flU: 0.4, flL: -0.6, blU: -0.4, blL: -0.6, head: 0.15 });
const HURT = pose({ lean: -0.5, head: -0.5, fU: 2.4, fL: 0.4, bU: -2.3, bL: 0.4, flU: 0.9, flL: -0.4, blU: -0.7, blL: -0.3 });
const HELPLESS = pose({ lean: 0.15, head: 0.3, fU: 2.6, fL: 0.8, bU: -2.6, bL: 0.8, flU: 0.6, flL: -1.1, blU: -0.4, blL: -1.2, sy: 1.02 });
const DIZZY = pose({ lean: 0.5, head: 0.6, fU: 0.1, fL: 0.2, bU: -0.1, bL: 0.2, by: 8 });

/**
 * Computes the pose for a fighter view.
 * @param {object} f  fighter view: { state, stateFrame, grounded, vx, vy, move (normalized move|null), moveFrame, charging, time }
 * @param {object} stats character stats (for runSpeed)
 */
export function computePose(f, stats) {
  const t = f.time || 0;
  switch (f.state) {
    case 'idle': return idle(t);
    case 'run': return run(t, Math.min(1, Math.abs(f.vx) / (stats?.runSpeed || 6)));
    case 'jumpsquat': return SQUAT;
    case 'land': return lerpPose(SQUAT, NEUTRAL, ease(Math.min(1, f.stateFrame / 6)));
    case 'crouch': return lerpPose(NEUTRAL, CROUCH, easeOut(Math.min(1, f.stateFrame / 4)));
    case 'air': {
      const k = Math.max(0, Math.min(1, (f.vy + 6) / 12));
      const p = lerpPose(JUMP, FALL, ease(k));
      if (f.doubleJumpFlip > 0) p.spin = -TAU * easeOut(1 - f.doubleJumpFlip / 20);
      return p;
    }
    case 'shield': return SHIELD;
    case 'roll': {
      const k = f.stateFrame / 26;
      return { ...pose({ flU: 1.2, flL: -2.2, blU: 0.9, blL: -2.2, fU: 1.6, fL: 2, bU: 1.6, bL: 2, by: 30, sx: 0.9, sy: 0.85 }), spin: TAU * easeOut(Math.min(1, k * 1.2)) };
    }
    case 'spotdodge': return pose({ lean: -0.3, by: 10, fU: 1.2, fL: 1.8, bU: 1.0, bL: 1.8, sy: 0.92 });
    case 'airdodge': return { ...FALL, spin: TAU * easeOut(Math.min(1, f.stateFrame / 20)), sy: 0.9 };
    case 'hitstun': {
      if (f.tumble) return { ...HURT, spin: t * 0.35 * (f.facing || 1) };
      return HURT;
    }
    case 'helpless': return HELPLESS;
    case 'shieldbreak': return { ...DIZZY, head: 0.6 + Math.sin(t * 0.2) * 0.3 };
    case 'respawn': return idle(t);
    case 'attack': return attackPose(f);
    default: return NEUTRAL;
  }
}

function attackPose(f) {
  const move = f.move;
  if (!move) return NEUTRAL;
  const a = move.pose || ANIMATIONS[move.anim] || ANIMATIONS.punch;
  const fr = f.moveFrame;
  const startup = Math.max(1, move.startup);
  let activeEnd = startup;
  for (const h of move.hitboxes) activeEnd = Math.max(activeEnd, h.end);
  for (const p of move.projectiles) activeEnd = Math.max(activeEnd, p.start + 2);
  const base = f.grounded ? NEUTRAL : FALL;
  if (fr < startup) {
    const p = lerpPose(base, a.windup, easeOut(Math.min(1, fr / Math.max(1, startup - 1))));
    if (f.charging) { p.bx += Math.sin(t2(f) * 1.7) * 1.2; }
    return p;
  }
  if (fr <= activeEnd) {
    const k = Math.min(1, (fr - startup + 1) / 3);
    const p = lerpPose(a.windup, a.strike, easeOut(k));
    if (a.spinTurns) p.spin = TAU * a.spinTurns * Math.min(1, (fr - startup) / Math.max(1, activeEnd - startup));
    return p;
  }
  const k = (fr - activeEnd) / Math.max(1, move.duration - activeEnd);
  const p = lerpPose(a.strike, base, ease(Math.min(1, k)));
  if (a.spinTurns) p.spin = 0;
  return p;
}

function t2(f) { return f.time || 0; }
