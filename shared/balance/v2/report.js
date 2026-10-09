// ─────────────────────────────────────────────────────────────────────────────
// Coded notes (spec §4.1.7) and the validator report / CLI text (§4.1.8).
//
// Note = {code, severity: 'error'|'warn'|'info', path, why, fix, from?, to?,
//         rule?, suggest?, text}. `text` is a one-line human message and is
// also what String(note) returns, so `notes.join('\n')` keeps working.
// Families: E0xx structural errors, W1xx stats/body, W2xx action damage/frames/
// reach, W3xx movement/travel, W4xx entities, W5xx statuses/resources,
// W6xx power budget, I0xx info (fallbacks, did-you-mean; see schema.js).
// ─────────────────────────────────────────────────────────────────────────────
import { NOTE_CODES } from '../../char/schema.js';
import { STAT_BUDGET, MOVE_BUDGET } from '../rules.js';

/** W-codes: short title (for --explain / docs) and the default fix. */
export const W_CODES = {
  W200: { title: 'v1 adjustment', fix: 'see the message; v1 files use the v1 rules.' },
  W101: { title: 'text too long', fix: 'shorten it (names ≤ 18, move names ≤ 24, descriptions ≤ 220).' },
  W110: { title: 'stat out of range', fix: 'pick a value inside the range; the stat is clamped either way. Slower than the minimum on purpose? Keep the minimum and call api.modify(\'heavy\', { speed: 0.6 }) in behavior.init (§13 ranges).' },
  W120: { title: 'stats over budget', fix: 'lower a stat you care less about, or buy points back with a bigger hurtbox.' },
  W130: { title: 'collider out of range', fix: 'collider w 20–160, h 20–200.' },
  W131: { title: 'too many hurtbox shapes or sets', fix: '≤ 6 shapes per set, ≤ 8 sets.' },
  W132: { title: 'hurtbox outside the body envelope', fix: 'keep shapes within x ±2·max(w,h), y −2.5h…0.5h of the feet.' },
  W136: { title: 'hurtbox off the body', fix: 'every hurtbox set must overlap the collider (cover its center, ≥ 20% of it, or sit ≥ 50% on it).' },
  W133: { title: 'hurtbox area out of range', fix: 'priced area (default set × scaleMin²) must be 1600–16000 px².' },
  W134: { title: 'scaleRange clamped', fix: 'scaleRange must stay within 0.6–1.6.' },
  W135: { title: 'passive armor clamped', fix: 'passive armor is 0–3 damage (2.5 stat points per point).' },
  W140: { title: 'too many forms', fix: 'use at most 6 forms.' },
  W201: { title: 'duration adjusted', fix: 'give the move more recovery, or less damage per frame.' },
  W202: { title: 'startup delayed', fix: 'add anticipation frames on purpose (animation reads better too).' },
  W203: { title: 'active window capped', fix: 'split long windows into separate boxes, or use rehit.' },
  W210: { title: 'per-hit damage capped', fix: 'keep it feeling huge with growth, or split it into a multi-hit group.' },
  W211: { title: 'total damage scaled', fix: 'fewer hits, a longer rehit, or move some damage into another move.' },
  W212: { title: 'knockback clamped', fix: 'knockback ≤ 90, growth ≤ 130, setKnockback ≤ 120.' },
  W213: { title: 'KO floor', fix: 'use less knockback with more growth, or a less direct angle.' },
  W214: { title: 'hitbox radius clamped', fix: 'make the box smaller, or use a capsule along the limb.' },
  W215: { title: 'reach pulled in', fix: 'move the hitbox closer, or give the body a bigger hurtbox there.' },
  W216: { title: 'rehit raised', fix: 'rehit must be ≥ 3 frames.' },
  W217: { title: 'hit modifier clamped', fix: 'shieldMul/hitlagMul 0.5–1.5, push 0–6.' },
  W220: { title: 'intangibility capped', fix: '≤ 12 intangible frames per action, ≤ 20 per grant.' },
  W221: { title: 'armor clamped', fix: 'action armor threshold ≤ 12, ≤ 60 frames per grant.' },
  W222: { title: 'landing lag clamped', fix: 'aerials 6–40 frames.' },
  W223: { title: 'hold/charge/counter clamped', fix: 'hold.max 1–600, charge.max 1–60, counter.mul 1–1.3.' },
  W224: { title: 'gravity window clamped', fix: 'gravity scale 0.3–1.5.' },
  W230: { title: 'hit template clamped', fix: 'templates are clamped against the strictest move/entity that uses them.' },
  W301: { title: 'self speed clamped', fix: '|vx| ≤ 14, |vy| ≤ 17 px/frame.' },
  W302: { title: 'travel / rise scaled', fix: 'upSpecial may rise 300 px, other moves 120; any move travels ≤ 340 px.' },
  W303: { title: 'teleport clamped', fix: 'teleports are ≤ 200 px.' },
  W304: { title: 'steer clamped', fix: 'steer speed 0–12, turn 0–0.3.' },
  W310: { title: 'movement mode clamped', fix: 'see MOVEMENT_MODES ranges.' },
  W401: { title: 'entity hit clamped', fix: 'see ENTITY_LIMITS for the kind.' },
  W402: { title: 'entity life clamped', fix: 'see ENTITY_LIMITS[kind].maxLife.' },
  W403: { title: 'entity speed clamped', fix: 'see ENTITY_LIMITS[kind].maxSpeed.' },
  W404: { title: 'entity hp clamped', fix: 'see ENTITY_LIMITS[kind].maxHp.' },
  W405: { title: 'entity rehit raised', fix: 'see ENTITY_LIMITS[kind].minRehit.' },
  W406: { title: 'beam size clamped', fix: 'beams are ≤ 520 px long and ≤ 24 px thick.' },
  W407: { title: 'homing turn clamped', fix: 'homing turn ≤ 0.12 rad/frame.' },
  W408: { title: 'every.frames raised', fix: 'periodic spawns are at most every 30 frames.' },
  W409: { title: 'spawn clamped', fix: 'count ≤ 5, spawn point ≤ 160 px from the body.' },
  W410: { title: 'maxAlive clamped', fix: 'maxAlive ≤ 8.' },
  W411: { title: 'relay/scale clamped', fix: 'parts relay 0.5–1; clone scale 0.5–1.' },
  W412: { title: 'entity KO floor', fix: 'entities KO late by design; use less knockback.' },
  W413: { title: 'entity size clamped', fix: 'projectiles are ≤ 28 px radius.' },
  W414: { title: 'too many entities', fix: '≤ 16 entity definitions.' },
  W415: { title: 'entity list action removed', fix: 'entity lists run spawn, emit, sfx, camera, resource, status, hit (on the entity), form and velocity/impulse (on the owner).' },
  W416: { title: 'entity grab box', fix: 'grab boxes only work on moves; use a strike that pulls, or a grab move.' },
  W501: { title: 'status clamped', fix: 'frames 1–300, maxStacks 1–3.' },
  W502: { title: 'status modifier clamped', fix: 'see MOD_RANGES.' },
  W503: { title: 'DoT clamped', fix: 'dot every ≥ 15 frames, damage ≤ 0.5.' },
  W504: { title: 'control duration clamped', fix: 'stun/freeze ≤ 40, root ≤ 60, silence ≤ 120, confuse ≤ 90 frames.' },
  W505: { title: 'heal clamped', fix: 'heal ≤ 1 per 30 frames.' },
  W510: { title: 'resource clamped', fix: 'max 1–1000, start within min–max, soak fraction ≤ 0.5.' },
  W511: { title: 'too many resources/vars/statuses', fix: '≤ 6 resources, 32 vars, 16 synced vars, 8 custom statuses.' },
  W512: { title: 'var clamped', fix: 'strings ≤ 24 characters, numbers within ±1e6.' },
  W601: { title: 'power budget', fix: 'make a few moves slower, shorter-ranged or weaker on purpose, or add a resource cost.' },
  W602: { title: 'fixed bonuses trimmed', fix: 'spend less on intangibility, armor and spawns.' },
};

export const severityOf = (code) => (code[0] === 'E' ? 'error' : code[0] === 'W' ? 'warn' : 'info');

/** Fill severity / fix / text on a note and give it toString(). Mutates and returns it. */
export function finishNote(n) {
  if (!n.severity) n.severity = severityOf(n.code);
  if (!n.fix) n.fix = W_CODES[n.code]?.fix || NOTE_CODES[n.code]?.fix || '';
  if (!n.text) n.text = n.path && !n.why.startsWith(n.path) ? `${n.path}: ${n.why}` : n.why;
  Object.defineProperty(n, 'toString', { value() { return this.text; }, enumerable: false, configurable: true });
  return n;
}

/** A note collector: add(code, path, why, {from, to, rule, fix, suggest, text}). */
export function makeNotes() {
  const list = [];
  return {
    list,
    add(code, path, why, extra = {}) {
      const n = { code, severity: severityOf(code), path, why };
      for (const k of ['from', 'to', 'rule', 'fix', 'suggest', 'text']) if (extra[k] !== undefined) n[k] = extra[k];
      list.push(finishNote(n));
    },
  };
}

// ── CLI text (§4.1.8) ───────────────────────────────────────────────────────
const fmt = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '∞') : String(v));

/**
 * Human report lines for one validator result.
 * @param {{ok, errors, notes, character, report}} res
 * @param {{explain?: boolean, audit?: object|null, color?: object}} [opts]
 */
export function formatReport(res, { explain = false, audit = null, color = null } = {}) {
  const C = color || { red: '', green: '', yellow: '', dim: '', bold: '', reset: '' };
  const c = res.character;
  const rep = res.report || {};
  const name = c ? (c.meta?.name ?? c.name) : '?';
  const ver = c ? `v${c.version}` : '';
  const warn = res.notes.filter((n) => n.severity !== 'info');
  const lines = [];
  if (!res.ok) {
    lines.push(`${C.red}${name} — does not load ✘   ${res.errors.length} error(s)${C.reset}`);
    for (const e of res.errors) lines.push(`  ${C.red}${(e.code || 'E000').padEnd(7)}${C.reset} ${e.text ?? e}${explain && e.fix ? `\n          ${C.dim}fix: ${e.fix}${C.reset}` : ''}`);
    return lines;
  }
  lines.push(`${C.bold}${name}${C.reset} (${ver}) — loads ${C.green}✔${C.reset}   ${warn.length} adjustment(s) · ${res.notes.length - warn.length} info · 0 errors`);
  const forms = rep.forms || { base: { statPoints: rep.statPoints, movePower: rep.movePower } };
  for (const [f, fr] of Object.entries(forms)) {
    if (!fr?.statPoints) continue;
    const b = fr.statPoints.breakdown || {};
    const extras = [b.movement ? `movement ${b.movement}` : '', b.armor ? `passive armor ${b.armor}` : '', b.hurtboxArea ? `area ${b.hurtboxArea}` : ''].filter(Boolean).join(', ');
    lines.push(`  STATS   form ${f}: ${fmt(fr.statPoints.total)}/${STAT_BUDGET}${extras ? `  [${extras}]` : ''}`);
  }
  for (const n of res.notes) {
    if (!explain && n.severity === 'info') continue;
    const col = n.severity === 'info' ? C.dim : C.yellow;
    lines.push(`  ${col}${n.code.padEnd(7)}${C.reset} ${n.text}`);
    if (explain) {
      if (n.rule) lines.push(`          ${C.dim}rule: ${n.rule}${n.from !== undefined ? `  (${fmt(n.from)} → ${fmt(n.to)})` : ''}${C.reset}`);
      if (n.fix) lines.push(`          ${C.dim}fix: ${n.fix}${C.reset}`);
    }
  }
  for (const [f, fr] of Object.entries(forms)) if (fr?.movePower !== undefined) lines.push(`  POWER   form ${f} ${fmt(fr.movePower)}/${MOVE_BUDGET}`);
  if (rep.budgets) {
    const B = rep.budgets;
    lines.push(`  BUDGETS self-rise/airtime ≈ ${fmt(B.selfRise)}/380 px · intangible ${fmt(B.intangible)} f · armor uptime (static) ${fmt(B.armorUptime)} f/300`);
  }
  const rg = rep.runtimeGoverned || [];
  lines.push(`  RUNTIME-GOVERNED  ${rg.length ? rg.join(', ') : '—'}`);
  if (explain && rep.moves) {
    lines.push(`  ${C.bold}${'move'.padEnd(16)} ${'cat'.padEnd(9)} ${'start'.padStart(5)} ${'dur'.padStart(4)} ${'dmg'.padStart(5)} ${'KO%'.padStart(5)} ${'reach'.padStart(5)} ${'power'.padStart(6)}${C.reset}`);
    for (const [n, m] of Object.entries(rep.moves)) {
      if (m.power === undefined) continue;
      lines.push(`  ${n.slice(0, 16).padEnd(16)} ${String(m.category).padEnd(9)} ${String(m.startup).padStart(5)} ${String(m.duration).padStart(4)} ${fmt(m.totalDamage).padStart(5)} ${fmt(m.koPercent).padStart(5)} ${fmt(m.reach).padStart(5)} ${m.power.toFixed(2).padStart(6)}`);
    }
  }
  if (audit) {
    lines.push(`  AUDIT   (${audit.matches} CPU matches, seeded)  damage trimmed ${fmt(audit.trimmedPct)}% · KO-floor clamps ${audit.koClamps} · BREAKs ${audit.breaks} ·`);
    lines.push(`          rise exhausted ${audit.riseExhausted ?? 0}× · gov events ${audit.govEvents ?? 0}`);
  }
  if (rep.headroom) lines.push(`  HEADROOM ${fmt(rep.headroom.stat)} stat pts · ${fmt(rep.headroom.power)} move power`);
  return lines;
}
