// CPU opponent (WP-O). Produces the same button inputs a human would, so CPUs obey
// exactly the same rules as players. Reads the validated IR, not v1 fields:
//   report.moves[n]  {startup, reachBox, category, spawns, isRecovery, isGrab, koPercent, rise, …}
//   ai               {preferredRange, zoning, recovery {form: [names]}, prefer, avoid, grapple, hint}
//   forms[f]         slots (trigger → move) and movement modes (hover/glide/fly/wallCling/crawl)
// Randomness comes only from game.rng (seeded), so CPU matches are reproducible.
// rules.aiVersion === 1 selects the frozen v1 CPU (golden replays).
import { mulberry32, defaultSeed } from './rng.js';
import { cpuThink as cpuThinkV1 } from './ai-v1.js';
import { collider } from './hurtbox.js';
import { recover as recoverPlan, airMoveSafe } from './ai-recover.js';
import * as resources from './resources.js';
import * as script from './script-api.js';

const LEVELS = {
  easy:   { react: 22, aggression: 0.35, shield: 0.04, smash: 0.15, accuracy: 0.6, mash: 6, dodge: 0.05, recover: 0.6, depth: 1, hesitate: 24 },
  normal: { react: 12, aggression: 0.6,  shield: 0.12, smash: 0.3,  accuracy: 0.8, mash: 3, dodge: 0.2, recover: 0.9, depth: 2, hesitate: 8 },
  hard:   { react: 5,  aggression: 0.85, shield: 0.25, smash: 0.45, accuracy: 0.95, mash: 1, dodge: 0.45, recover: 1, depth: 3, hesitate: 0 },
};

const GROUND_TRIGGERS = ['jab', 'side', 'up', 'down', 'sideSmash', 'upSmash', 'downSmash', 'neutralSpecial', 'sideSpecial', 'downSpecial', 'upSpecial', 'grab'];
const AIR_TRIGGERS = ['nair', 'fair', 'bair', 'uair', 'dair', 'neutralSpecial', 'sideSpecial', 'downSpecial'];
const NEVER = new Set(['taunt', 'utility', 'throw', 'pummel']);

function rand(game) {
  if (!game.rng) game.rng = mulberry32(defaultSeed(game.fighters, game.stage && game.stage.id));
  return game.rng();
}

const blank = () => ({ left: false, right: false, up: false, down: false, jump: false, attack: false, special: false, strong: false, shield: false, taunt: false });

export function cpuThink(game, f) {
  if (game.rules && game.rules.aiVersion === 1) return cpuThinkV1(game, f);
  return { ...think(game, f) }; // always a fresh object so edge detection works
}

// ── helpers ────────────────────────────────────────────────────────────────
const own = (o, k) => (o && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);
const report = (f, name) => own(f.char.report && f.char.report.moves, name);
const moveOf = (f, name) => own(f.char.moves, name);
const heightOf = (f) => collider(f).h;
const widthOf = (f) => collider(f).w;

/** Move name a trigger resolves to (static slot maps; SlotFns are resolved by the sim on press). */
function slotOf(f, trigger) {
  const c = f.char;
  const form = f.form && f.form !== 'base' ? c.forms && c.forms[f.form] : null;
  const s = (form && form.slots && form.slots[trigger]) || (c.slots && c.slots[trigger]) || (c.forms && c.forms.base && c.forms.base.slots && c.forms.base.slots[trigger]);
  return typeof s === 'string' ? s : trigger;
}

/** Usable now? (exists, payable, not spent this airtime). */
function usable(f, name, trigger) {
  const def = moveOf(f, name);
  if (!def) return false;
  if (!resources.meets(f, def.requires) || !resources.canPay(f, def.cost)) return !!moveOf(f, def.else);
  if (!f.grounded && (def.oncePerAirtime ?? trigger === 'sideSpecial') && f.air.used.has(name)) return false;
  return true;
}

/** Buttons that fire `trigger` (dir: +1/-1 toward which the move should face). */
function press(out, trigger, f, dir) {
  const d = (x) => { out.left = x < 0; out.right = x > 0; };
  out.up = out.down = false;
  switch (trigger) {
    case 'jab': d(0); out.attack = true; break;
    case 'side': d(dir); out.attack = true; break;
    case 'up': d(0); out.up = true; out.attack = true; break;
    case 'down': d(0); out.down = true; out.attack = true; break;
    case 'sideSmash': d(dir); out.strong = true; break;
    case 'upSmash': d(0); out.up = true; out.strong = true; break;
    case 'downSmash': d(0); out.down = true; out.strong = true; break;
    case 'nair': d(0); out.attack = true; break;
    case 'fair': d(f.facing); out.attack = true; break;
    case 'bair': d(-f.facing); out.attack = true; break;
    case 'uair': d(0); out.up = true; out.attack = true; break;
    case 'dair': d(0); out.down = true; out.attack = true; break;
    case 'neutralSpecial': d(0); out.special = true; break;
    case 'sideSpecial': d(dir || f.facing); out.special = true; break;
    case 'upSpecial': d(0); out.up = true; out.special = true; break;
    case 'downSpecial': d(0); out.down = true; out.special = true; break;
    case 'grab': d(0); out.shield = true; out.attack = true; break;
    default: return false;
  }
  return true;
}

/** Facing the move will have when it starts. */
function facingFor(trigger, f, dir) {
  if (trigger === 'side' || trigger === 'sideSmash' || (trigger === 'sideSpecial' && dir)) return dir || f.facing;
  return f.facing;
}

function foes(game, f) {
  const out = [];
  for (const o of game.fighters) {
    if (o === f || o.minorOf || o.eliminated || o.state === 'dead' || o.state === 'respawn') continue;
    out.push(o);
  }
  return out;
}

function nearestFoe(game, f) {
  let best = null, bd = Infinity;
  for (const o of foes(game, f)) {
    const d = Math.hypot(o.x - f.x, o.y - f.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function isOffstage(game, f) {
  const g = game.stage.ground;
  return !f.grounded && (f.x < g.x1 || f.x > g.x2 || f.y > g.y + 10);
}

/** Does reachBox (local, facing +1) at fighter f facing `face` overlap foe o predicted `t` frames ahead? */
function reaches(f, o, rb, face, t, slack) {
  if (!rb) return false;
  const s = f.bodyScale || 1;
  const ox = o.x + (o.vx || 0) * Math.min(t, 12), oy = o.y + (o.grounded ? 0 : (o.vy || 0) * Math.min(t, 12));
  const sx = f.x + (f.grounded ? 0 : (f.vx || 0) * Math.min(t, 8)), sy = f.y + (f.grounded ? 0 : (f.vy || 0) * Math.min(t, 8));
  const x1 = face > 0 ? sx + rb.x1 * s : sx - rb.x2 * s;
  const x2 = face > 0 ? sx + rb.x2 * s : sx - rb.x1 * s;
  const y1 = sy + rb.y1 * s, y2 = sy + rb.y2 * s;
  const hw = widthOf(o) / 2, h = heightOf(o);
  return x1 - slack < ox + hw && x2 + slack > ox - hw && y1 - slack < oy && y2 + slack > oy - h;
}

/** Hostile entity (projectile, beam, zone, minion…) about to touch f, with its closest distance. */
function threat(game, f) {
  const list = game.entities || [];
  const h = heightOf(f);
  const cx = f.x, cy = f.y - h / 2;
  const reach = 50 + Math.max(h, widthOf(f)) / 2;
  for (const e of list) {
    if (!e || e.dead || e.life <= 0 || e.owner === f.id || (f.minorOf && e.owner === f.minorOf)) continue;
    const hostile = e.def ? !!(e.def.hitboxes && e.def.hitboxes.length) : (e.damage > 0);
    if (!hostile) continue;
    if (e.kind === 'beam' && e.len > 0) { // distance to the segment
      const a = ((e.angle || 0) * Math.PI) / 180;
      const ux = Math.cos(a), uy = Math.sin(a);
      const t = Math.max(0, Math.min(e.len, (cx - e.x) * ux + (cy - e.y) * uy));
      const d = Math.hypot(e.x + ux * t - cx, e.y + uy * t - cy);
      if (d < reach + 10) return { e, d };
      continue;
    }
    const r = (e.def && e.def.shape && e.def.shape.r) || e.r || 12;
    const d0 = Math.hypot(e.x - cx, e.y - cy) - r;
    if (d0 > 240) continue;
    const d1 = Math.hypot(e.x + (e.vx || 0) * 8 - cx, e.y + (e.vy || 0) * 8 - cy) - r;
    if (d1 < reach && d1 <= d0 + 1) return { e, d: Math.min(d0, d1) };
  }
  return null;
}

// ── main ───────────────────────────────────────────────────────────────────
function think(game, f) {
  const b = f.brain;
  const L = LEVELS[b.level] || LEVELS.normal;
  if (f.state === 'dead') { b.plan = null; b.rec = null; b.offAt = null; return blank(); }
  if (f.state === 'respawn') return f.stateFrame > 40 ? { ...blank(), down: true } : blank();
  if (b.level === 'dummy') return blank();

  // Grabbed: mash (alternating buttons so every frame is a fresh press).
  if (f.state === 'grabbed') {
    b.plan = null;
    const out = blank();
    if (game.frame % L.mash === 0) { const k = (game.frame / L.mash) % 2; out.attack = !k; out.jump = !!k; out.left = !k; out.right = !!k; }
    b.held = out;
    return out;
  }
  // Holding someone: pummel a little, then throw (toward the nearest blast line when they're high).
  if (f.state === 'grabbing' && !f.action) return grabbing(game, f, b);

  // Stunned states: just drift toward the stage (DI) and drop any plan.
  if (f.state === 'hitstun' || f.state === 'stunned' || f.state === 'shieldbreak') {
    b.plan = null;
    b.rec = null;
    const out = blank();
    if (isOffstage(game, f)) { const g = game.stage.ground; const t = f.x < (g.x1 + g.x2) / 2 ? 1 : -1; out.left = t < 0; out.right = t > 0; }
    b.held = out;
    return out;
  }

  if (isOffstage(game, f)) {
    b.plan = null;
    // Lower levels notice they're offstage a little late (just drifting home meanwhile).
    if (b.offAt === undefined || b.offAt === null) b.offAt = game.frame + Math.floor(rand(game) * (L.hesitate || 0));
    b.held = game.frame < b.offAt ? recover(game, f, b, { ...L, idle: true }) : recover(game, f, b, L);
    return b.held;
  }
  b.rec = null;
  b.offAt = null;

  // Scripted plans (short hops, turn-then-special, smash charge) run frame by frame.
  if (b.plan && b.plan.length) {
    const step = b.plan[0];
    const out = { ...blank(), ...step.in };
    if (--step.n <= 0) b.plan.shift();
    b.held = out;
    return out;
  }

  // Release one-frame buttons so they can be pressed again.
  const held = { ...(b.held || blank()) };
  held.jump = held.attack = held.special = held.strong = held.taunt = false;

  if (--b.timer > 0) return { ...held, shield: held.shield && f.state === 'shield' };
  b.timer = L.react + Math.floor(rand(game) * L.react);

  const next = blank();
  const foe = nearestFoe(game, f);
  if (!foe) { b.held = next; return next; }

  // Dodge incoming hostile entities.
  const th = threat(game, f);
  if (th && rand(game) < L.dodge) {
    const e = th.e, away = e.x > f.x ? -1 : 1;
    const ctr = f.grounded && rand(game) < 0.35 ? pickCategory(f, 'counter') : null;
    if (ctr) { press(next, ctr, f, -away); b.timer = 10; } // reflect / counter it
    else if (f.grounded) { next.shield = true; b.timer = 10; }
    else if (!f.usedAirDodge && th.d < 40 && !isOffstage(game, f)) { next.shield = true; next.left = away < 0; next.right = away > 0; b.timer = 8; }
    else { next.left = away < 0; next.right = away > 0; }
    b.held = next;
    return next;
  }

  const h = heightOf(f);
  const dx = foe.x - f.x;
  const dy = (foe.y - heightOf(foe) / 2) - (f.y - h / 2);
  const adx = Math.abs(dx);
  const dir = Math.sign(dx) || 1;
  const ai = f.char.ai || {};

  // Defend.
  const foeAttacking = foe.state === 'attack' && adx < 160;
  if (foeAttacking && f.grounded && rand(game) < L.shield) {
    // A counter (category 'counter') beats shielding when the character has one.
    const ctr = pickCategory(f, 'counter');
    if (ctr && rand(game) < 0.5) { press(next, ctr, f, dir); b.timer = 10; b.held = next; return next; }
    next.shield = true;
    b.timer = 10;
    b.held = next;
    return next;
  }

  // Character hint (ai.hint(view) → {press, hold}).
  const hint = script.aiHint(f);
  if (hint && rand(game) < 0.6) {
    const t = hint.press || hint.hold;
    if (press(next, t, f, dir)) {
      if (hint.hold) b.plan = [{ in: { ...next }, n: 20 }];
      b.held = next;
      return next;
    }
  }

  // Attack when something reaches.
  if (rand(game) < L.aggression) {
    const choice = pickAttack(game, f, foe, dir, L, ai);
    if (choice) {
      if (choice.turn) { // aerials/neutral moves keep facing: turn first, then fire
        const turn = blank(); turn.left = dir < 0; turn.right = dir > 0;
        const fire = blank(); press(fire, choice.trigger, { ...f, facing: dir }, dir);
        b.plan = [{ in: fire, n: 1 }];
        b.held = turn;
        return turn;
      }
      press(next, choice.trigger, f, dir);
      if (choice.trigger.endsWith('Smash') && rand(game) < L.smash) b.plan = [{ in: { strong: true, up: next.up, down: next.down }, n: 6 + Math.floor(rand(game) * 30) }];
      b.timer = Math.max(b.timer, 6);
      b.held = next;
      return next;
    }
    // Short-hop aerial when the foe is just above or a hop away.
    if (f.grounded && adx < 140 && dy < 0 && dy > -150 && rand(game) < 0.4) {
      const air = bestAerial(f, foe, dir);
      if (air) {
        const go = blank(); go.left = dir < 0; go.right = dir > 0;
        const fire = blank(); press(fire, air, f, dir);
        b.plan = [{ in: { ...go, jump: true }, n: 1 }, { in: go, n: 6 }, { in: fire, n: 1 }];
        b.held = blank();
        return b.held;
      }
    }
  }

  // Ranged / zoning: moves that spawn entities or hit from range.
  const range = ai.preferredRange || 0;
  const ranged = adx > 160 && Math.abs(dy) < 160 && rand(game) < (ai.zoning ? 0.55 : 0.3) ? pickRanged(game, f, ai, dir) : null;
  if (ranged) {
    if (f.facing !== dir && ranged !== 'sideSpecial') {
      const turn = blank(); turn.left = dir < 0; turn.right = dir > 0;
      const fire = blank(); press(fire, ranged, { ...f, facing: dir }, dir);
      b.plan = [{ in: fire, n: 1 }];
      b.held = turn;
      return turn;
    }
    press(next, ranged, f, dir);
    b.held = next;
    return next;
  }

  // Now and then, when it's safe, use a special that does something else (form change, buff, setup).
  if (f.grounded && adx > 240 && rand(game) < 0.08) {
    const u = pickUtility(game, f);
    if (u) { press(next, u, f, dir); b.held = next; return next; }
  }

  // Grapple-style characters walk in and grab.
  if (ai.grapple && f.grounded && adx < 90 && Math.abs(dy) < 60 && game.rules.grabs !== false && rand(game) < 0.4) {
    press(next, 'grab', f, dir);
    b.held = next;
    return next;
  }

  if (dy < -110 && f.grounded && rand(game) < 0.5) {
    next.jump = true;
    if (dir > 0) next.right = true; else next.left = true;
  } else {
    // Approach (zoners hold their preferred range).
    let move = dir;
    if (range && adx < range * 0.7) move = -dir;
    else if (range && adx < range) move = 0;
    if (rand(game) < L.accuracy && move) { if (move > 0) next.right = true; else next.left = true; }
    if (rand(game) < 0.08 && f.grounded) next.jump = true;
    // Don't run off the stage.
    const g = game.stage.ground;
    if ((next.right && f.x > g.x2 - 40) || (next.left && f.x < g.x1 + 40)) { next.left = next.right = false; }
  }
  b.held = next;
  return next;
}

/** Best trigger that reaches the foe after its startup, or null. */
function pickAttack(game, f, foe, dir, L, ai) {
  const triggers = f.grounded ? GROUND_TRIGGERS : AIR_TRIGGERS;
  const prefer = new Set(ai.prefer || []), avoid = new Set(ai.avoid || []);
  const cands = [];
  for (const t of triggers) {
    if (t === 'grab' && game.rules.grabs === false) continue;
    const name = slotOf(f, t);
    const m = report(f, name);
    if (!m || NEVER.has(m.category) || !m.reachBox || !usable(f, name, t)) continue;
    if (m.category === 'counter' || (m.isRecovery && t === 'upSpecial' && !f.grounded)) continue;
    let face = facingFor(t, f, dir);
    let turn = false;
    if (t === 'fair' || t === 'bair') face = f.facing;
    let ok = reaches(f, foe, m.reachBox, face, m.startup, 6);
    if (!ok && f.grounded && face !== dir && !['side', 'sideSmash', 'sideSpecial'].includes(t) && m.startup <= 12) {
      ok = reaches(f, foe, m.reachBox, dir, m.startup + 2, 0);
      turn = ok;
    }
    if (!ok || !moveSafe(game, f, t, name, turn ? dir : face)) continue;
    const dmg = m.totalDamage || 1;
    let score = dmg / (m.startup + 4);
    if (m.isGrab) score = foe.state === 'shield' ? 2 : 0.15;
    if (m.koPercent && foe.percent + dmg >= m.koPercent - 10) score += 1.5;
    else if (m.category === 'smash') score *= foe.percent > 80 ? 1 : 0.45;
    if (m.isRecovery) score *= 0.4; // don't burn recoveries on stage
    if (prefer.has(name) || prefer.has(t)) score *= 1.5;
    if (avoid.has(name) || avoid.has(t)) score *= 0.2;
    if (moveOf(f, name) && moveOf(f, name).cost) score *= 0.8;
    score *= staleFactor(f, name);
    cands.push({ trigger: t, score, turn });
  }
  if (!cands.length) return null;
  if (rand(game) >= L.accuracy) return cands[Math.floor(rand(game) * cands.length)];
  // Weighted toward the best options (sharper for better CPUs), so play stays varied.
  const pow = L.accuracy > 0.9 ? 3 : 2;
  let sum = 0;
  for (const c of cands) sum += (c.w = Math.pow(Math.max(0.01, c.score), pow));
  let r = rand(game) * sum;
  for (const c of cands) if ((r -= c.w) <= 0) return c;
  return cands[cands.length - 1];
}

/** Recently used moves deal less (stale queue): CPUs mix things up the same way. */
function staleFactor(f, name) {
  let n = 0;
  for (const s of f.stale || []) if (s === name) n++;
  return Math.max(0.25, 1 - 0.18 * n);
}

function bestAerial(f, foe, dir) {
  const opts = dir === f.facing ? ['fair', 'nair', 'uair'] : ['bair', 'nair', 'uair'];
  for (const t of opts) {
    const name = slotOf(f, t);
    const m = report(f, name);
    if (m && m.reachBox && !NEVER.has(m.category) && usable(f, name, t)) return t;
  }
  return null;
}

function pickRanged(game, f, ai, dir) {
  const prefer = new Set(ai.prefer || []);
  const b = f.brain;
  const last = b.rangedAt || (b.rangedAt = {});
  const cands = [];
  let sum = 0;
  for (const t of ['neutralSpecial', 'sideSpecial', 'downSpecial']) {
    const name = slotOf(f, t);
    const m = report(f, name);
    if (!m || NEVER.has(m.category) || m.isRecovery || !usable(f, name, t)) continue;
    if (game.frame - (last[t] ?? -9999) < 60) continue; // give each zoning tool a breather
    const def = moveOf(f, name);
    const preferred = prefer.has(name) || prefer.has(t);
    const v1proj = def && def.projectiles && def.projectiles.length;
    const spawns = Array.isArray(m.spawns) ? m.spawns.length : m.spawns;
    if (!(spawns > 0 || m.entityDamage > 0 || v1proj || (preferred && m.scripted))) continue;
    let live = 0;
    for (const e of game.entities || []) if (e.owner === f.id && e.slot === name && !e.dead && e.life > 0) live++;
    if (live >= 2) continue; // already zoning with this one
    if (!moveSafe(game, f, t, name, t === 'sideSpecial' ? dir : f.facing)) continue;
    const w = Math.max(1, m.entityDamage || m.totalDamage || 1) * (preferred ? 2 : 1) * staleFactor(f, name);
    cands.push({ t, w });
    sum += w;
  }
  if (!cands.length) return null;
  let r = rand(game) * sum;
  for (const c of cands) if ((r -= c.w) <= 0) { last[c.t] = game.frame; return c.t; }
  last[cands[0].t] = game.frame;
  return cands[0].t;
}

function pickUtility(game, f) {
  const b = f.brain;
  const last = b.utilAt || (b.utilAt = {});
  const avoid = new Set((f.char.ai && f.char.ai.avoid) || []);
  for (const t of ['downSpecial', 'neutralSpecial', 'sideSpecial']) {
    const name = slotOf(f, t);
    const m = report(f, name);
    if (!m || m.reachBox || m.isRecovery || NEVER.has(m.category) || m.category === 'counter' || avoid.has(name) || avoid.has(t)) continue;
    if (game.frame - (last[t] ?? -9999) < 360 || !usable(f, name, t)) continue;
    last[t] = game.frame;
    return t;
  }
  return null;
}

function pickCategory(f, cat) {
  for (const t of ['downSpecial', 'neutralSpecial', 'sideSpecial']) {
    const name = slotOf(f, t);
    const m = report(f, name);
    if (m && m.category === cat && usable(f, name, t)) return t;
  }
  return null;
}

function grabbing(game, f, b) {
  const out = blank();
  const g = f.grab;
  b.plan = null;
  const frames = g ? g.frames : 0;
  const victim = g ? game.fighters.find((o) => o.id === g.other) : null;
  if (frames < 8) { b.held = out; return out; }
  // A pummel or two first (edge-triggered: release in between).
  if (frames < 30 && (b.pummels || 0) < 2 && !(b.held && b.held.attack) && slotMove(f, 'pummel')) {
    out.attack = true; b.pummels = (b.pummels || 0) + 1; b.held = out; return out;
  }
  b.pummels = 0;
  // Throw: one that KOs at the victim's percent, else the most damage, preferring the nearer edge.
  const st = game.stage.ground;
  const edge = victim && victim.x < (st.x1 + st.x2) / 2 ? -1 : 1;
  const pct = victim ? victim.percent : 0;
  let best = null, bs = -Infinity;
  for (const t of ['fthrow', 'bthrow', 'uthrow', 'dthrow']) {
    if (!slotMove(f, t)) continue;
    const m = report(f, slotOf(f, t)) || {};
    const dmg = m.totalDamage || 1;
    const dir = t === 'fthrow' ? f.facing : t === 'bthrow' ? -f.facing : 0;
    let sc = dmg + rand(game) * 3;
    if (m.koPercent && pct + dmg >= m.koPercent - 5) sc += 100 - m.koPercent / 10;
    if (dir === edge) sc += 4;
    if (sc > bs) { bs = sc; best = { t, dir }; }
  }
  if (!best) best = { t: 'fthrow', dir: edge };
  if (best.t === 'uthrow') out.up = true;
  else if (best.t === 'dthrow') out.down = true;
  else { out.left = best.dir < 0; out.right = best.dir > 0; }
  b.held = out;
  return out;
}

/** Does trigger resolve to a real move (own or generic) for f? */
function slotMove(f, trigger) {
  const name = slotOf(f, trigger);
  return !!(moveOf(f, name) || name === trigger);
}

/** Won't this move carry f off the stage (ground dashes past the edge, air moves that strand it)? */
function moveSafe(game, f, trigger, name, face) {
  const g = game.stage.ground;
  if (f.x > g.x1 + 320 && f.x < g.x2 - 320 && f.y < g.y - 1) return true; // well inside: nothing to check
  if (!f.grounded) return airMoveSafe(game, f, trigger, name);
  const def = moveOf(f, name);
  let d = 0;
  for (const v of (def && def.velocity) || []) if (v.vx) d += v.vx * ((v.end ?? v.start) - v.start + 1);
  if (Math.abs(d) < 30) return true;
  const x = f.x + face * d * 0.85;
  return x > g.x1 + 10 && x < g.x2 - 10;
}

// ── recovery ───────────────────────────────────────────────────────────────
// Planned against a kinematic model of the sim (ai-recover.js): jumps, air dodge,
// self-moving specials (velocity / impulse / steer / teleport) and hover/glide/fly.
function recover(game, f, b, L) {
  return recoverPlan(game, f, b, L, () => rand(game), slotOf);
}
