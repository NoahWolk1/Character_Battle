// CPU recovery planner (WP-O). Offstage, the CPU searches short plans of timed
// recovery events (air jump, air dodge, any self-moving special, movement-mode use)
// against a kinematic model of the sim's air physics (states.airLogic, actions
// velocity/timeline windows, movement modes, physics.collide + ledge snap), then
// executes the best plan button by button and re-validates it as it goes.
// Works for ANY kit: it reads the IR (moves, velocity, timeline, movement modes)
// instead of per-character rules. Pure and deterministic (no rng, no wall clock).
import { PHYSICS, DODGE } from '../constants.js';
import { GOVERNOR } from '../balance/governor-rules.js';
import { collider } from './hurtbox.js';
import { movementOf, AIR_ACCEL } from './movement.js';
import * as resources from './resources.js';

const SPECIALS = ['upSpecial', 'sideSpecial', 'downSpecial', 'neutralSpecial'];
let WAITS = [0, 2, 5, 9, 14, 20, 27, 35, 45, 57, 72];
let WAIT_SET = new Set(WAITS);
const HORIZON = 320;          // frames a rollout may run
let STEP_BUDGET = 6000;        // simulated frames per search, refinement included (≈ 1-4 ms worst case, warm)
const REVALIDATE = 8;         // frames between plan checks
const MODE_BUTTONS = new Set(['jump', 'up', 'taunt']); // safe to hold in the air (no edge side effects)
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const approach = (v, t, s) => (v < t ? Math.min(t, v + s) : Math.max(t, v - s));
const blank = () => ({ left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, strong: false, shield: false, taunt: false });

// ── context (per fighter, per frame) ───────────────────────────────────────
function context(game, f) {
  const g = game.stage.ground;
  const col = collider(f);
  const M = movementOf(f);
  const gov = game.gov;
  const ok = (m) => m && MODE_BUTTONS.has(m.button || 'jump');
  const C = {
    g, blast: game.stage.blast, cx: (g.x1 + g.x2) / 2, hw: col.w / 2, h: col.h, st: f.stats,
    hover: ok(M.hover) ? M.hover : null, glide: ok(M.glide) ? M.glide : null, fly: ok(M.fly) ? M.fly : null,
    crawl: M.crawl || null, cling: M.wallCling || null,
    gov: !!(gov && gov.selfVelocity), moves: f.char.moves || {}, frame: game.frame,
  };
  // Mode buttons held under plan.mode (a jump-button mode only once the air jumps are gone).
  const btns = [C.hover, C.glide, C.fly].filter(Boolean).map((m) => m.button || 'jump');
  C.holdAll = btns.length ? btns : null;
  C.canCut = !C.fly && !C.crawl && !C.cling;
  C.holdNoJump = btns.filter((b) => b !== 'jump');
  if (!C.holdNoJump.length) C.holdNoJump = null;
  return C;
}

/** Predictor state from the live fighter. */
function fromFighter(f, C) {
  const a = f.air || {};
  let st = 'other';
  if (f.state === 'air') st = 'air';
  else if (f.state === 'helpless') st = 'helpless';
  else if (f.state === 'attack' && f.action) st = 'act';
  else if (f.state === 'airdodge') st = 'dodge';
  else if (f.state === 'glide') st = 'glide';
  else if (f.state === 'fly') st = 'fly';
  const g = f.gov && f.gov.air;
  return {
    x: f.x, y: f.y, vx: f.vx, vy: f.vy, kx: f.kx || 0, ky: f.ky || 0, facing: f.facing || 1, st, sf: f.stateFrame | 0,
    act: st === 'act' ? { def: f.action.def, fr: f.action.frame, trigger: f.action.trigger, setVx: f.action.setVx, setVy: f.action.setVy, steer: f.action.steer, aim: (f.brain && f.brain.rec && f.brain.rec.aim) || null } : null,
    dodge: st === 'dodge' ? { dir: f.dodgeDir, vx: f.dodgeVx || 0, vy: f.dodgeVy || 0 } : null,
    jumps: f.jumpsLeft | 0, dodgeUsed: !!f.usedAirDodge, used: a.used ? [...a.used] : [],
    hoverF: fin(a.hoverFrames), glideF: fin(a.glideFrames), fuel: fin(a.flyFuel), modeLock: fin(f.modeLock, -1) - C.frame,
    rise: C.gov ? fin(GOVERNOR.air.rise, 380) - fin(g && g.rise) : Infinity, sr: !!(g && g.selfRising), tele: g ? fin(g.teleports) : 0, fastFall: !!f.fastFall, t: 0,
  };
}

const clone = (P) => ({ ...P, used: P.used.slice(), act: P.act ? { ...P.act } : null });

// ── one simulated frame ────────────────────────────────────────────────────
function gravity(P, C, mult = 1) {
  const max = P.fastFall ? C.st.fallSpeed * PHYSICS.fastFallMultiplier : C.st.fallSpeed;
  if (P.fastFall && P.vy > 0) P.vy = max;
  else P.vy = Math.min(max, P.vy + C.st.gravity * mult);
}
function drift(P, C, dir, mult) {
  const max = C.st.airSpeed * mult;
  P.vx = dir ? approach(P.vx, dir * max, AIR_ACCEL) : approach(P.vx, 0, PHYSICS.airFriction);
}
function selfVy(P, C, vy) {
  if (vy < 0 && C.gov) {
    if (P.rise <= 0) return Math.max(0, P.vy);
    if (-vy > P.rise) vy = -P.rise;
  }
  return vy;
}
function setVel(P, C, vx, vy, gov = true) {
  if (gov || C.gov) {
    if (vx != null) vx = Math.max(-18, Math.min(18, vx));
    if (vy != null) vy = Math.max(-17, vy);
  }
  if (vx != null) P.vx = vx;
  if (vy != null) { P.vy = C.gov ? selfVy(P, C, vy) : vy; if (vy < 0) P.sr = true; }
}

/** Which mode buttons the policy holds this frame (also used by the executor). */
export function modeHold(P, C, plan, ev, evNext) {
  if (!plan || !plan.mode || ev || evNext) return null;
  return P.jumps === 0 ? C.holdAll : C.holdNoJump;
}

function startAct(P, C, tool, dir) {
  const def = tool.def;
  if (tool.trigger === 'sideSpecial') P.facing = dir;
  if (def.oncePerAirtime ?? tool.trigger === 'sideSpecial') P.used.push(tool.name);
  P.st = 'act'; P.sf = 0;
  P.act = { def, fr: 0, trigger: tool.trigger, setVx: -1, setVy: -1, steer: null, aim: tool.aim || 'diag' };
}

function aimOf(P, dir) {
  const aim = P.act && P.act.aim;
  if (aim === 'toward') return [dir, 0];
  if (aim === 'up') return [0, -1];
  return [dir, -1];
}

function runTimeline(P, C, a, fr, dir) {
  const tl = a.def.timeline;
  if (!Array.isArray(tl) || !tl.length) return;
  for (const e of tl) {
    if (!e || typeof e.action !== 'string') continue;
    const when = e.when ?? (e.at != null ? 'at' : e.from != null ? 'range' : null);
    if (when === 'at' ? e.at !== fr : when === 'range' ? !(fr >= e.from && fr <= e.to && (fr - e.from) % Math.max(1, e.every || 1) === 0) : true) continue;
    const x = e.args || {};
    if (e.action === 'velocity') {
      const add = x.mode === 'add';
      const vx = x.vx != null ? (add ? P.vx + x.vx * P.facing : x.vx * P.facing) : null;
      const vy = x.vy != null ? (add ? P.vy + x.vy : x.vy) : null;
      setVel(P, C, vx, vy);
      if (x.vx != null) a.setVx = fr;
      if (x.vy != null) a.setVy = fr;
    } else if (e.action === 'impulse') {
      setVel(P, C, x.vx != null ? P.vx + fin(x.vx) * P.facing : null, x.vy != null ? P.vy + fin(x.vy) : null);
      if (x.vx != null) a.setVx = fr;
      if (x.vy != null) a.setVy = fr;
    } else if (e.action === 'steer') {
      const speed = Math.max(0, Math.min(12, fin(x.speed)));
      const turn = Math.max(0, Math.min(0.3, fin(x.turn)));
      if (a.steer === null) a.steer = Math.hypot(P.vx, P.vy) > 0.5 ? Math.atan2(P.vy, P.vx) : (P.facing > 0 ? 0 : Math.PI);
      const [sx, sy] = aimOf(P, dir);
      if (sx || sy) {
        let d = Math.atan2(sy, sx) - a.steer;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        a.steer += Math.max(-turn, Math.min(turn, d));
      }
      setVel(P, C, Math.cos(a.steer) * speed, Math.sin(a.steer) * speed);
      a.setVx = a.setVy = fr;
      if (Math.abs(P.vx) > 0.5) P.facing = P.vx > 0 ? 1 : -1;
    } else if (e.action === 'teleport') {
      if (C.gov && P.tele >= fin(GOVERNOR.air.teleports, 1)) continue;
      let dx = fin(x.dx), dy = fin(x.dy);
      if (x.relative !== 'world') dx *= P.facing;
      const len = Math.hypot(dx, dy);
      const cap = fin(GOVERNOR.air.teleportDist, 200);
      if (len > cap) { dx *= cap / len; dy *= cap / len; }
      P.tele++;
      P.x += dx; P.y += dy;
      const g = C.g;
      if (P.x + C.hw > g.x1 && P.x - C.hw < g.x2 && P.y > g.y && P.y - C.h < g.bottom) {
        const up = P.y - g.y, down = g.bottom - (P.y - C.h), left = P.x + C.hw - g.x1, right = g.x2 - (P.x - C.hw);
        const mn = Math.min(up, down, left, right);
        if (mn === up) P.y = g.y; else if (mn === down) P.y = g.bottom + C.h; else if (mn === left) P.x = g.x1 - C.hw; else P.x = g.x2 + C.hw;
      }
    }
  }
}

function gravityScale(m, fr) {
  const g = m.gravity;
  if (!g || !g.length) return 1;
  let s = 1;
  for (const w of g) if (fr >= w.from && fr <= w.to) s *= fin(w.scale, 1);
  return Math.max(0.3, Math.min(1.5, s));
}

function actFrame(P, C, dir) {
  const a = P.act;
  const m = a.def;
  a.fr++;
  const fr = a.fr;
  runTimeline(P, C, a, fr, dir);
  let setVx = a.setVx === fr, setVy = a.setVy === fr;
  for (const v of m.velocity || []) {
    if (fr >= v.start && fr <= (v.end ?? v.start)) {
      const add = v.mode === 'add';
      const vx = v.vx != null ? (add ? P.vx + v.vx * P.facing : v.vx * P.facing) : null;
      const vy = v.vy != null ? (add ? P.vy + v.vy : v.vy) : null;
      if (C.gov) setVel(P, C, vx, vy);
      else { if (vx != null) P.vx = vx; if (vy != null) P.vy = vy; }
      if (vy != null && vy < 0) P.sr = true;
      if (v.vx != null) setVx = true;
      if (v.vy != null) setVy = true;
    } else if (fr === (v.end ?? v.start) + 1) {
      const lim = C.st.airSpeed * 1.1;
      P.vx = Math.max(-lim, Math.min(lim, P.vx));
    }
  }
  if (!setVx) drift(P, C, a.aim === 'up' ? 0 : dir, m.category === 'aerial' ? 1 : 0.6);
  if (!setVy) gravity(P, C, gravityScale(m, fr));
  if (fr >= m.duration) {
    const nx = m.next && Object.prototype.hasOwnProperty.call(C.moves, m.next) ? C.moves[m.next] : null;
    if (nx) { P.act = { def: nx, fr: 0, trigger: a.trigger, setVx: -1, setVy: -1, steer: null, aim: a.aim }; P.sf = 0; return; }
    const helpless = m.helpless ?? a.trigger === 'upSpecial';
    P.st = helpless ? 'helpless' : 'air'; P.sf = 0; P.act = null;
  }
}

/** Held direction: toward the stage, except outward while tucked under it (to get round the lip). */
function steerDir(x, y, C) {
  const g = C.g;
  if (y > g.y + 2 && x > g.x1 - C.hw + 6 && x < g.x2 + C.hw - 6) return x < C.cx ? -1 : 1;
  return x < C.cx ? 1 : -1;
}

const held = (hold, m) => !!(hold && m && hold.includes(m.button || 'jump'));

/**
 * Advances P one frame. `ev` = tool pressed this frame (only when actionable), `hold` =
 * mode buttons held. Returns 1 on stage/ledge, -1 when KO'd, else 0.
 */
function step(P, C, ev, hold) {
  const g = C.g;
  const dir = steerDir(P.x, P.y, C);
  let queued = 0; // drift multiplier (0 = no queued drift/gravity)
  let modePhys = null;
  P.t++; P.sf++; P.modeLock--;
  switch (P.st) {
    case 'act': actFrame(P, C, dir); break;
    case 'dodge': {
      const k = Math.max(0, 1 - P.sf / 22);
      if (P.dodge.dir) { P.vx = P.dodge.vx * k; P.vy = P.dodge.vy * k; } else gravity(P, C, 0.5);
      if (P.sf >= DODGE.air.duration) { P.st = 'air'; P.sf = 0; }
      break;
    }
    case 'helpless': queued = 0.7; break;
    case 'other': queued = 1; break;
    case 'glide':
      if (!held(hold, C.glide) || P.glideF >= C.glide.frames) { P.st = 'air'; P.sf = 0; P.modeLock = 10; }
      else { if (dir !== P.facing) { P.facing = dir; P.vx *= -0.5; } modePhys = 'glide'; break; }
    // falls through
    case 'fly':
      if (P.st === 'fly') {
        if (!held(hold, C.fly) || P.fuel <= 0) { P.st = 'air'; P.sf = 0; P.modeLock = 10; }
        else { modePhys = 'fly'; break; }
      }
    // falls through
    case 'air':
      if (ev && ev.k === 'J' && P.jumps > 0) {
        P.jumps--; P.vy = -C.st.doubleJumpHeight; P.vx = dir * C.st.airSpeed; P.fastFall = false; P.sr = false; queued = 1;
      } else if (ev && ev.k === 'D' && !P.dodgeUsed) {
        P.dodgeUsed = true;
        const dy = ev.aim === 'toward' ? 0 : -1;
        const len = Math.hypot(dir, dy);
        P.dodge = { dir: 1, vx: (dir / len) * DODGE.air.speed, vy: (dy / len) * DODGE.air.speed };
        P.st = 'dodge'; P.sf = 0;
      } else if (ev && ev.k === 'X') {
        startAct(P, C, ev, dir);
        gravity(P, C);
      } else queued = 1;
      break;
  }
  // movement.update: mode entry / physics, hover, queued drift + gravity
  if (P.st === 'air' && !modePhys && queued && P.modeLock <= 0) {
    if (C.fly && P.fuel > 0 && held(hold, C.fly) && ((C.fly.button || 'jump') !== 'jump' || P.jumps === 0 || P.vy >= 0)) { P.st = 'fly'; P.sf = 0; P.fastFall = false; modePhys = 'fly'; }
    else if (C.glide && P.glideF < C.glide.frames && held(hold, C.glide) && P.vy >= 0 && !P.fastFall) { P.st = 'glide'; P.sf = 0; modePhys = 'glide'; }
  }
  if (modePhys === 'glide') {
    const G = C.glide;
    P.glideF++;
    P.vx = approach(P.vx, P.facing * fin(G.speed, 1.15) * C.st.airSpeed, 0.3);
    let vy = Math.min(P.vy + C.st.gravity * 0.5, G.fallSpeed);
    vy += -fin(G.turn, 0.05) * Math.abs(P.vx) * 0; // the executor holds neither up nor down while gliding
    P.vy = Math.min(selfVy(P, C, vy), G.fallSpeed * 2);
  } else if (modePhys === 'fly') {
    const F = C.fly;
    P.fuel = Math.max(0, P.fuel - 1);
    P.vx = approach(P.vx, dir * C.st.airSpeed, AIR_ACCEL);
    P.facing = dir;
    let vy = Math.max(P.vy - fin(F.thrust, 0.6), -fin(F.maxRise, 6));
    if (vy < 0) { vy = selfVy(P, C, vy); P.sr = true; }
    P.vy = vy;
  } else {
    const H = C.hover;
    const hov = H && (P.st === 'air' || P.st === 'act') && P.vy >= 0 && !P.fastFall && P.hoverF < H.frames && held(hold, H);
    if (queued) { drift(P, C, dir, queued * (hov ? fin(H.drift, 1) : 1)); gravity(P, C); }
    if (hov) { P.hoverF++; if (P.vy > H.fallSpeed) P.vy = H.fallSpeed; }
  }
  if (C.gov && P.sr && P.vy < 0) P.rise += P.vy; // non-jump self rise (Governor air.rise budget)
  // physics.integrate
  const mag = Math.hypot(P.kx, P.ky);
  if (mag > 0) {
    if (mag <= PHYSICS.launchDecay) { P.kx = 0; P.ky = 0; } else { const k = (mag - PHYSICS.launchDecay) / mag; P.kx *= k; P.ky *= k; }
  }
  const ox = P.x, oy = P.y;
  P.x += P.vx + P.kx;
  P.y += P.vy + P.ky;
  const tvy = P.vy + P.ky;
  const hw = C.hw, h = C.h;
  if (P.x >= g.x1 && P.x <= g.x2 && P.y >= g.y && oy <= g.y + 0.01 && tvy >= 0) { P.land = 'top'; return 1; }
  if (P.x + hw > g.x1 && P.x - hw < g.x2 && P.y > g.y && P.y - h < g.bottom) {
    if (oy - h >= g.bottom - 0.01) { P.y = g.bottom + h; P.vy = Math.max(0, P.vy); P.ky = Math.abs(P.ky) * 0.4; }
    else if (ox <= g.x1 - hw + 0.5 || P.x < C.cx) { P.x = g.x1 - hw; if (P.kx > 0) P.kx = -P.kx * 0.5; P.vx = Math.min(0, P.vx); }
    else { P.x = g.x2 + hw; if (P.kx < 0) P.kx = -P.kx * 0.5; P.vx = Math.max(0, P.vx); }
    // Wall: a crawler can climb it (wall-cling is handled by the executor, not modelled).
    if (C.crawl && P.st === 'air' && P.y - g.y < fin(C.crawl.speed, 3) * Math.max(0, fin(C.crawl.frames, 60) - 10)) { P.land = 'crawl'; return 1; }
  }
  const canSnap = P.st === 'air' || P.st === 'helpless' || P.st === 'dodge';
  if (canSnap && tvy > -4) {
    const nearLeft = (dir > 0 || P.vx > 0.5) && P.x < g.x1 && P.x > g.x1 - hw - PHYSICS.edgeSnapX;
    const nearRight = (dir < 0 || P.vx < -0.5) && P.x > g.x2 && P.x < g.x2 + hw + PHYSICS.edgeSnapX;
    if ((nearLeft || nearRight) && P.y > g.y && P.y < g.y + PHYSICS.edgeSnapY) { P.land = 'snap'; return 1; }
  }
  const b = C.blast;
  if (P.y > b.bottom || P.x < b.left || P.x > b.right) return -1;
  return 0;
}

// ── tools (what can be pressed) ────────────────────────────────────────────
/** Self-moving specials of the current form (plus ai.recovery hints), with aim variants. */
function specialTools(f, slotOf) {
  const c = f.char;
  const rm = (c.report && c.report.moves) || {};
  const ai = c.ai || {};
  let hint = ai.recovery;
  if (hint && !Array.isArray(hint)) hint = hint[f.form || 'base'] || hint.base;
  const hinted = new Set(Array.isArray(hint) ? hint : []);
  const out = [];
  for (const t of SPECIALS) {
    const name = slotOf(f, t);
    const def = c.moves && Object.prototype.hasOwnProperty.call(c.moves, name) ? c.moves[name] : null;
    if (!def) continue;
    const tl = Array.isArray(def.timeline) ? def.timeline : [];
    const moves = (def.velocity || []).some((v) => v.vx || v.vy) || tl.some((e) => e && ['velocity', 'impulse', 'steer', 'teleport'].includes(e.action));
    const r = rm[name] || {};
    if (!moves && !r.isRecovery && !hinted.has(t) && !hinted.has(name)) continue;
    if (r.category === 'counter') continue;
    const steer = tl.some((e) => e && e.action === 'steer');
    for (const aim of steer ? ['diag', 'toward', 'up'] : ['diag']) out.push({ k: 'X', trigger: t, name, def, aim, hinted: hinted.has(t) || hinted.has(name) });
  }
  out.sort((a, b) => (b.hinted - a.hinted));
  return out;
}

function usableTool(P, f, tool) {
  if (tool.k === 'J') return P.jumps > 0;
  if (tool.k === 'D') return !P.dodgeUsed;
  const def = tool.def;
  if ((def.oncePerAirtime ?? tool.trigger === 'sideSpecial') && P.used.includes(tool.name)) return false;
  if (P.used.includes('@' + tool.trigger)) return false; // one press per trigger per plan (the sim may allow more; plans stay short)
  return resources.meets(f, def.requires) && resources.canPay(f, def.cost);
}

// ── rollouts and search ────────────────────────────────────────────────────
function score(P, C, r) {
  if (r === 1) {
    const g = C.g;
    const inside = P.land === 'top' ? Math.min(80, Math.min(P.x - g.x1, g.x2 - P.x)) : 0;
    return 1000 + (P.land === 'top' ? 60 + inside : P.land === 'crawl' ? 20 : (g.y + PHYSICS.edgeSnapY - P.y));
  }
  return -P.best + 0.05 * P.t; // best effort: closest approach, then staying alive longer
}

/** Distance from the ledge-reach window (for best-effort plans). */
function gap(P, C) {
  const g = C.g;
  const ex = P.x < C.cx ? g.x1 - C.hw - PHYSICS.edgeSnapX : g.x2 + C.hw + PHYSICS.edgeSnapX;
  const dx = P.x < C.cx ? Math.max(0, ex - P.x) : Math.max(0, P.x - ex);
  const dy = Math.max(0, P.y - (g.y + PHYSICS.edgeSnapY));
  return dx + dy;
}

function rollout(P0, C, plan, events, S) {
  const P = clone(P0);
  P.best = Infinity;
  let i = 0;
  for (let t = 0; t < HORIZON; t++) {
    while (i < events.length && events[i].t < t) i++;
    const ev = i < events.length && events[i].t === t ? events[i] : null;
    const nxt = i < events.length && events[i].t === t + 1 ? events[i] : (ev && i + 1 < events.length && events[i + 1].t === t + 1 ? events[i + 1] : null);
    const r = step(P, C, ev && P.st === 'air' ? ev : null, modeHold(P, C, plan, ev, nxt));
    S.steps++;
    if (r !== 0) return { r, s: score(P, C, r) };
    const gp = gap(P, C);
    if (gp < P.best) P.best = gp;
    // Nothing left to press and already falling past the ledge window: it's over.
    if (i >= events.length && C.canCut && (P.st === 'air' || P.st === 'helpless') && P.vy >= 0 && P.ky >= 0 && P.y > C.g.y + PHYSICS.edgeSnapY) break;
  }
  return { r: 0, s: score(P, C, 0) };
}

/** Hill-climbs a best-effort plan's event times (the wait grid is coarse; ledges are not). */
function refine(P0, C, best, S) {
  const pl = { mode: best.mode };
  for (let pass = 0; pass < 4 && !best.ok; pass++) {
    let improved = false;
    for (let i = 0; i < best.events.length && !best.ok; i++) {
      for (const d of [-8, -5, -3, -2, -1, 1, 2, 3, 5, 8]) {
        const t = best.events[i].t + d;
        if (S.steps > STEP_BUDGET * 1.25) return;
        if (t < 0 || (i > 0 && t <= best.events[i - 1].t) || (i + 1 < best.events.length && t >= best.events[i + 1].t)) continue;
        const evs = best.events.map((e, j) => (j === i ? { ...e, t } : e));
        const r = rollout(P0, C, pl, evs, S);
        if (r.s > best.s + 1e-9) { best.events = evs; best.s = r.s; best.ok = r.r === 1; improved = true; if (best.ok) break; }
      }
    }
    if (!improved) break;
  }
}

/**
 * Searches plans (≤ maxDepth timed events, with and without mode use) from the live state.
 * Returns {events:[{t, k, …}], mode, ok, s} with t relative to now.
 */
/** Test hook: widen the search (oracle runs). Returns the previous settings. */
export function _tune({ budget = STEP_BUDGET, waits = WAITS } = {}) {
  const prev = { budget: STEP_BUDGET, waits: WAITS };
  STEP_BUDGET = budget; WAITS = waits; WAIT_SET = new Set(waits);
  return prev;
}
export function plan(game, f, slotOf, maxDepth = 3, C = context(game, f)) {
  const P0 = fromFighter(f, C);
  const tools = [];
  if (P0.jumps > 0) tools.push({ k: 'J' });
  tools.push({ k: 'D', aim: 'diag' }, { k: 'D', aim: 'toward' });
  tools.push(...specialTools(f, slotOf));
  const modes = (C.hover || C.glide || C.fly) ? [true, false] : [false];
  const S = { steps: 0 };
  let best = null;
  const consider = (events, mode, res) => {
    if (!best || res.s > best.s + 1e-9) best = { events: events.slice(), mode, ok: res.r === 1, s: res.s };
  };
  for (let depth = 0; depth <= maxDepth; depth++) {
    for (const mode of modes) {
      const pl = { mode };
      const dfs = (P, tOff, events, d) => {
        if (S.steps > STEP_BUDGET) return;
        if (d === depth) { consider(events, mode, rollout(P0, C, pl, events, S)); return; }
        // Advance from P (relative time tOff) and branch on each tool at the wait grid.
        // Branch points: the wait grid, plus the first actionable frame after a move/dodge.
        const Q = clone(P);
        const last = WAITS[WAITS.length - 1];
        let wasBusy = false;
        for (let W = 0; W <= last; W++) {
          if (W > 0) {
            const r = step(Q, C, null, modeHold(Q, C, pl, null, null));
            S.steps++;
            if (r !== 0) return;
          }
          const inMode = Q.st === 'glide' || Q.st === 'fly';
          const free = Q.st === 'air' || inMode;
          const first = free && wasBusy;
          wasBusy = !free;
          if (!free || (!first && !WAIT_SET.has(W))) continue;
          for (const tool of tools) {
            if (!usableTool(Q, f, tool)) continue;
            const R = clone(Q);
            let at = tOff + W;
            if (inMode) { if (step(R, C, null, null) !== 0 || R.st !== 'air') continue; at++; } // let go of the mode button first
            const ev = { ...tool, t: at };
            if (tool.k === 'X') R.used.push('@' + tool.trigger);
            step(R, C, ev, null); S.steps++;
            dfs(R, at + 1, [...events, ev], d + 1);
            if (S.steps > STEP_BUDGET) return;
          }
        }
      };
      if (depth === 0) consider([], mode, rollout(P0, C, pl, [], S));
      else dfs(P0, 0, [], 0);
    }
    if (best && best.ok) break;
    if (S.steps > STEP_BUDGET) break;
  }
  if (best && !best.ok && best.events.length) refine(P0, C, best, S);
  return best;
}

// ── executor ───────────────────────────────────────────────────────────────
function pressTool(out, tool, dir) {
  if (tool.k === 'J') { out.jump = true; return; }
  if (tool.k === 'D') { out.shield = true; out.up = tool.aim !== 'toward'; return; }
  out.special = true;
  out.up = out.down = false;
  if (tool.trigger === 'upSpecial') out.up = true;
  else if (tool.trigger === 'downSpecial') out.down = true;
  else if (tool.trigger === 'neutralSpecial') { out.left = out.right = false; return; }
  if (tool.trigger === 'sideSpecial') { out.left = dir < 0; out.right = dir > 0; }
}

/**
 * Offstage input for f. b.rec caches the plan ({start, events (absolute frames), mode, aim}).
 * L.recover < 1 (easy/normal) occasionally replaces the plan's first event with a panic special.
 */
export function recover(game, f, b, L, rand, slotOf) {
  const C = context(game, f);
  const dir = steerDir(f.x, f.y, C);
  const out = blank();
  out.left = dir < 0; out.right = dir > 0;
  if (f.state === 'hitstun' || f.state === 'helpless' || f.state === 'airdodge' || f.hitlag > 0) return out;
  const prev = b.held || blank();
  if (f.state === 'wallcling') { out.jump = !prev.jump; return out; }
  if (f.state === 'crawl') { out.up = true; out.left = out.right = false; return out; }
  if (f.state === 'attack' && f.action) {
    const aim = (b.rec && b.rec.aim) || 'diag';
    if (aim === 'up') { out.left = out.right = false; out.up = true; } else if (aim === 'diag') out.up = true;
    return out;
  }
  if (!['air', 'glide', 'fly'].includes(f.state) || L.idle) return out;

  const now = game.frame;
  let rec = b.rec;
  const stale = !rec || now - rec.made >= (rec.ok ? REVALIDATE : REVALIDATE * 2) || (rec.events[0] && rec.events[0].at < now);
  if (stale) {
    const P = fromFighter(f, C);
    let keep = false;
    if (rec && rec.ok && !(rec.events[0] && rec.events[0].at < now)) {
      const evs = rec.events.map((e) => ({ ...e, t: e.at - now }));
      keep = rollout(P, C, { mode: rec.mode }, evs, { steps: 0 }).r === 1;
    }
    if (keep) rec.made = now;
    else {
      const p = plan(game, f, slotOf, L.depth ?? 3, C);
      rec = b.rec = { made: now, ok: !!(p && p.ok), mode: p ? p.mode : false, events: p ? p.events.map((e) => ({ ...e, at: now + e.t })) : [], aim: rec ? rec.aim : 'diag' };
      // Lower levels sometimes panic: fire the first recovery special right away.
      if (rand() > L.recover) {
        const panic = specialTools(f, slotOf)[0];
        if (panic) rec.events = [{ ...panic, at: now }];
      }
    }
  }
  const ev = rec.events.find((e) => e.at === now) || null;
  const nxt = rec.events.find((e) => e.at === now + 1) || null;
  const hold = modeHold(fromFighter(f, C), C, rec, ev, nxt);
  if (hold) for (const k of hold) out[k] = true;
  if (ev) {
    if (f.state !== 'air') { b.rec = null; return out; } // prediction drifted: replan next frame
    pressTool(out, ev, dir);
    if (ev.k === 'X') rec.aim = ev.aim || 'diag';
    rec.events = rec.events.filter((e) => e !== ev);
  }
  // Never hold a press across frames (the next press must be a fresh edge).
  if (prev.jump && out.jump && ev && ev.k === 'J') { out.jump = false; rec.events.unshift({ ...ev, at: now + 1 }); }
  return out;
}

/**
 * Would starting `tool` ({trigger, name, def}) now leave f stranded? Rolls the move out
 * in the air model (airborne only) and checks where it ends.
 */
export function airMoveSafe(game, f, trigger, name) {
  const def = f.char.moves && Object.prototype.hasOwnProperty.call(f.char.moves, name) ? f.char.moves[name] : null;
  if (!def || f.grounded) return true;
  const C = context(game, f);
  const P = fromFighter(f, C);
  if (P.st !== 'air') return true;
  const evs = [{ k: 'X', trigger, name, def, aim: 'diag', t: 0 }];
  const S = { steps: 0 };
  P.best = Infinity;
  const r0 = step(P, C, evs[0], null);
  if (r0 !== 0) return r0 > 0;
  for (let t = 1; t < 200 && P.st === 'act'; t++) { const r = step(P, C, null, null); if (r !== 0) return r > 0; S.steps++; }
  const g = C.g;
  if (P.x >= g.x1 && P.x <= g.x2) return P.y <= g.y + 4 || P.st !== 'helpless';
  if (P.st === 'helpless') return false;
  return P.y < g.y + 30 && Math.min(Math.abs(P.x - g.x1), Math.abs(P.x - g.x2)) < 140;
}

/** Per-fighter recovery-capable moves (for on-stage scoring: don't burn them). */
export function recoveryTriggers(f, slotOf) {
  return new Set(specialTools(f, slotOf).filter((t) => t.hinted || t.def.helpless || t.trigger === 'upSpecial').map((t) => t.trigger));
}
