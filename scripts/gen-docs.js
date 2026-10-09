#!/usr/bin/env node
// Generates the reference tables in docs/*.md from the engine's own tables, so the
// docs can never drift from the code:
//   shared/char/schema.js        field tables, vocabularies, built-in statuses, E/I codes
//   shared/balance/rules.js      static limits (stats, categories, reach, entities, body…)
//   shared/balance/governor-rules.js  runtime Governor caps
//   shared/balance/v2/report.js  W-codes          shared/sim/script-api.js  script limits
//   client/audio.js, client/render/particles.js, shared/art/{kit,sprite}.js  art vocabularies
//   scripts/check-assets.js      asset formats and size limits
//
//   node scripts/gen-docs.js           rewrite every <!-- gen:NAME --> … <!-- /gen:NAME --> block
//   node scripts/gen-docs.js --check   exit 1 if a block is stale, a block name is unknown, a
//                                      COOKBOOK recipe doesn't load with 0 errors and 0 W-notes,
//                                      or a script api/view call or kit export is undocumented
//   node scripts/gen-docs.js --list    print the block names
//   node scripts/gen-docs.js <file.md>  only process the given markdown file(s)
//
// Cookbook recipes are fenced as ```js recipe=<name>. Each is the body of a CharacterDef
// object literal ("body: {...}, moves: {...}") and is validated as
// defineCharacter({ id: 'recipe', name: 'Recipe', <recipe> }).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../shared/char/schema.js';
import * as R from '../shared/balance/rules.js';
import * as G from '../shared/balance/governor-rules.js';
import { W_CODES } from '../shared/balance/v2/report.js';
import { validateCharacter } from '../shared/balance/validate.js';
import { defineCharacter } from '../shared/char/api.js';
import { LIMITS as SCRIPT_LIMITS, makeApi } from '../shared/sim/script-api.js';
import { SOUND_PRESETS, AUDIO_LIMITS } from '../client/audio.js';
import { FX_SHAPES } from '../client/render/particles.js';
import { STATE_CLIPS } from '../shared/art/sprite.js';
import * as KIT from '../shared/art/kit.js';
import { ASSET_LIMITS } from './check-assets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['docs/CHARACTER_GUIDE.md', 'docs/ART_GUIDE.md', 'docs/COOKBOOK.md', 'CLAUDE.md', 'README.md'];

// ── formatting ──────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const n = (v) => (v === Infinity ? '∞' : v === -Infinity ? '−∞' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));
const code = (s) => `\`${s}\``;
const range = (r) => {
  if (!r) return '';
  if (Array.isArray(r)) return `${n(r[0])}–${n(r[1])}`;
  return Object.entries(r).map(([k, v]) => `${k} ${range(v)}`).join(', ');
};
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const list = (xs) => xs.map(code).join(' ');

function typeOf(spec) {
  if (spec.type === 'enum' && spec.values) return spec.values.length <= 9 ? spec.values.map((v) => `'${v}'`).join(' | ') : 'enum';
  if (spec.type === 'ref') return `${spec.ref} name`;
  if (spec.of && ['map', 'list', 'object', 'any'].includes(spec.type)) return `${spec.type} of ${spec.of}`;
  if (spec.type === 'list' && spec.ref) return `${spec.ref} name[]`;
  return spec.type;
}
// Schema `required` is the error code for a missing OR unknown value; a field with a default
// (or defaultDoc) is optional, and the code only fires when it names something unknown.
function defOf(spec) {
  if (spec.defaultDoc) return spec.defaultDoc;
  if (spec.default === undefined) return spec.required ? `**required** (${spec.required})` : '';
  const d = spec.default === null ? '—' : typeof spec.default === 'string' ? `'${spec.default}'` : JSON.stringify(spec.default);
  return spec.required ? `${d} (${spec.required} if unknown)` : d;
}
function rangeOf(spec) {
  if (spec.range) return range(spec.range);
  if (spec.maxKeys) return `≤ ${spec.maxKeys}${spec.maxShapes ? `, ≤ ${spec.maxShapes} shapes each` : ''}`;
  if (spec.type === 'enum' && spec.values && spec.values.length > 9) return spec.values.join(', ');
  return '';
}
const fieldTable = (fields) => table(['field', 'type', 'default', 'range', 'notes'],
  Object.entries(fields).map(([k, s]) => [code(k), typeOf(s), defOf(s), rangeOf(s), s.doc || '']));

// ── blocks ──────────────────────────────────────────────────────────────────
const HOOK_DOC = {
  init: ['(view, api)', 'match start and each respawn', 'immediately'],
  tick: ['(view, api)', 'every frame after the fighter update', 'immediately after the hook'],
  onHit: ['(view, api, ev)', 'once per hit dealt (after hit resolution)', 'after all hooks that frame'],
  onHurt: ['(view, api, ev)', 'once per hit taken (after hit resolution)', 'after all hooks that frame'],
  onLand: ['(view, api)', 'on landing', 'immediately after the hook'],
  onKO: ['(view, api)', 'when the fighter is KO\'d', 'immediately after the hook'],
  onRespawn: ['(view, api)', 'on respawn', 'immediately after the hook'],
  onFormChange: ['(view, api, {from, to})', 'when the form changes', 'immediately after the hook'],
};
const TRIGGER_DOC = {
  jab: 'attack, neutral', side: 'attack + left/right', up: 'attack + up', down: 'attack + down',
  sideSmash: 'smash + left/right (or neutral)', upSmash: 'smash + up', downSmash: 'smash + down',
  nair: 'attack in the air, neutral', fair: 'air attack toward facing', bair: 'air attack away from facing', uair: 'air attack + up', dair: 'air attack + down',
  neutralSpecial: 'special, neutral', sideSpecial: 'special + left/right (once per airtime by default)', upSpecial: 'special + up (helpless after, by default)', downSpecial: 'special + down',
  grab: 'shield + attack on the ground', pummel: 'attack while grabbing (≤ 1 per 14 frames)', fthrow: 'forward while grabbing', bthrow: 'back while grabbing',
  uthrow: 'up while grabbing', dthrow: 'down while grabbing', taunt: 'taunt button (T), grounded',
};

const BLOCKS = {
  triggers: () => {
    for (const t of S.TRIGGERS) if (!TRIGGER_DOC[t]) throw new Error(`gen-docs: no TRIGGER_DOC for trigger ${t}`);
    return table(['trigger', 'input', 'default category'], S.TRIGGERS.map((t) => [code(t), TRIGGER_DOC[t], S.TRIGGER_CATEGORY[t]]));
  },
  'character-fields': () => fieldTable(S.CHARACTER_FIELDS),
  'body-fields': () => fieldTable(S.BODY_FIELDS),
  stats: () => table(['stat', 'min', 'max', 'default', 'points at max', 'what it does'],
    Object.entries(S.STAT_FIELDS).map(([k, s]) => [code(k), n(s.range[0]), n(s.range[1]), n(s.default), n(s.points), s.doc])),
  budgets: () => table(['budget', 'value', 'what it covers'], [
    [code('STAT_BUDGET'), n(R.STAT_BUDGET), 'stat points per form (stats + movement modes + passive armor + hurtbox area)'],
    [code('MOVE_BUDGET'), n(R.MOVE_BUDGET), 'move power per form, over the 16 core triggers as resolved'],
  ]),
  'area-curve': () => {
    const B = R.BODY_LIMITS, H = R.HURTBOX_AREA;
    return table(['priced area A (px²)', 'stat points'], [
      [`${n(B.minArea)} ≤ A < ${n(H.min)}`, `${n(H.points)} + ${n(B.smallPoints)}·(${n(H.min)} − A)/${n(H.min - B.minArea)}  (max ${n(H.points + B.smallPoints)})`],
      [`${n(H.min)} ≤ A ≤ ${n(H.free)}`, `${n(H.points)}·(${n(H.free)} − A)/${n(H.free - H.min)}`],
      [`A > ${n(H.free)}`, `refund −min(${n(B.refundMax)}, ${n(B.refundMax)}·(A − ${n(H.free)})/${n(B.refundSpan)})`],
      [`A > ${n(B.maxArea)}`, 'shapes are scaled down uniformly (W133)'],
    ]) + `\n\nA = union area of \`hurtboxes.default\` × scaleRange[0]². Passive armor costs ${n(R.BODY_LIMITS.armorPoints)} points per point of threshold.`;
  },
  'body-limits': () => {
    const B = R.BODY_LIMITS;
    return table(['limit', 'value'], [
      ['collider w / h', `${range(B.collider.w)} / ${range(B.collider.h)}`],
      ['shapes per hurtbox set / sets', `${B.maxShapes} / ${B.maxSets}`],
      ['envelope (M = max(w, h))', `x ∈ [−${B.envelope.x}·M, ${B.envelope.x}·M], y ∈ [−${B.envelope.up}·h, ${B.envelope.down}·h]`],
      ['scaleRange', range(B.scaleRange)],
      ['passive armor', `${range([0, B.armorMax])} damage`],
      ['priced area', `${n(B.minArea)}–${n(B.maxArea)} px²`],
    ]);
  },
  'movement-modes': () => table(['mode', 'stat cost', 'params (default, range)'],
    Object.entries(S.MOVEMENT_MODES).map(([k, m]) => [code(k), n(m.cost),
      Object.entries(m.params).map(([p, s]) => `${p} = ${defOf(s).replace(/^'|'$/g, '')}${s.range ? ` [${range(s.range)}]` : ''}`).join('; ')])),
  'resource-fields': () => fieldTable(S.RESOURCE_FIELDS),
  'resource-hud-fields': () => fieldTable(S.RES_HUD_FIELDS),
  'hit-fields': () => fieldTable(S.HIT_FIELDS),
  'hitbox-fields': () => fieldTable(S.HITBOX_FIELDS),
  'action-fields': () => fieldTable(S.ACTION_FIELDS),
  'velocity-fields': () => fieldTable(S.VELOCITY_FIELDS),
  'hold-fields': () => fieldTable(S.HOLD_FIELDS),
  'charge-fields': () => fieldTable(S.CHARGE_FIELDS),
  'cancel-fields': () => fieldTable(S.CANCEL_FIELDS),
  'counter-fields': () => fieldTable(S.COUNTER_FIELDS),
  'requires-fields': () => fieldTable(S.REQUIRES_FIELDS),
  'timeline-actions': () => table(['key', 'value / params', 'governed by'],
    Object.entries(S.TIMELINE_ACTIONS).map(([k, a]) => {
      const ps = Object.entries(a.params).filter(([p]) => p !== a.primary)
        .map(([p, s]) => `${p}${s.type === 'enum' && s.values ? `=${s.values.map((v) => JSON.stringify(v)).join('|')}` : s.default !== undefined && s.default !== null ? `=${JSON.stringify(s.default)}` : ''}${s.range ? ` [${range(s.range)}]` : ''}`);
      if (a.map) return [code(k), '{ resourceName: amount, … }', a.governedBy];
      if (!a.primary) return [code(k), `{ ${ps.join(', ')} }`, a.governedBy];
      return [code(k), `${a.primary}${a.inlineHit ? ' name, or an inline HitTemplate object' : ''}${ps.length ? `; sibling keys: ${ps.join(', ')}` : ''}`, a.governedBy];
    })),
  'timeline-timing': () => table(['timing key', 'meaning'], [
    [code('at: n'), 'runs once on frame n'],
    [code('from: a, to: b, every?: k'), 'runs on frames a..b, every k frames (default 1)'],
    [code('onLand: true'), 'runs when the fighter lands during the move'],
    [code('onHit: true'), 'runs when the move first connects'],
  ]),
  'status-fields': () => fieldTable(S.STATUS_FIELDS),
  'builtin-statuses': () => table(['name', 'frames', 'effect'], Object.entries(S.BUILTIN_STATUSES).map(([k, s]) => [code(k), n(s.frames),
    [s.dot ? `DoT ${s.dot.damage} every ${s.dot.every} f` : '', s.control ? `control: ${s.control}` : '', s.mods ? Object.entries(s.mods).map(([m, v]) => `${m} ×${v}`).join(', ') : ''].filter(Boolean).join('; ') || 'no effect (a tag for scripts)'])),
  'mod-ranges': () => table(['modifier', 'combined range'], Object.entries(G.MOD_RANGES).map(([k, r]) => [code(k), range(r)])),
  'status-caps': () => {
    const C = G.STATUS_CAPS;
    return table(['cap', 'value'], [
      ['status frames', `≤ ${C.maxFrames}`],
      ['statuses per target / from one owner', `≤ ${C.perTarget} / ≤ ${C.perOwner}`],
      ['DoT', `≤ ${C.dot.maxPerTick} per tick, every ≥ ${C.dot.minEvery} f, ≤ ${C.dot.perApplication} per application, ≤ ${C.dot.perTarget} DoTs per target`],
      ...Object.entries(C.control).map(([k, c]) => [`${k}`, `≤ ${c.max} f${c.immunity ? `, then ${c.immunity} f immunity (${c.group} group)` : ''}`]),
      ['total control', `≤ ${C.controlTotal.max} f per ${C.controlTotal.window} f per target (${C.controlTotal.kinds.join(', ')})`],
      ['re-applying control', `within ${C.reapplyWindow} f → duration ×${C.reapplyMul}`],
    ]);
  },
  'entity-fields': () => fieldTable(S.ENTITY_FIELDS),
  'motion-fields': () => fieldTable(S.MOTION_FIELDS),
  'every-fields': () => fieldTable(S.EVERY_FIELDS),
  'entity-limits': () => table(['kind', 'max hit', 'min rehit', 'max life', 'max speed', 'max hp', 'threat', 'tier', 'KO floor %', 'extra'],
    Object.entries(R.ENTITY_LIMITS).map(([k, l]) => [code(k), n(l.maxHit), l.minRehit == null ? '—' : n(l.minRehit), n(l.maxLife), l.maxSpeed == null ? '—' : n(l.maxSpeed),
      n(l.maxHp), n(l.threat), l.tier || '—', n(l.koFloor),
      [l.maxRadius ? `radius ≤ ${l.maxRadius}` : '', l.maxLength ? `length ≤ ${l.maxLength}, width ≤ ${l.maxWidth}` : '', l.damageMul ? `×${l.damageMul} owner damage` : '',
        l.partLife ? `relay ${range(l.relay)}; relay < 1 → hp ≤ ${l.maxHp}, life ≤ ${l.partLife}` : ''].filter(Boolean).join('; ')])),
  'entity-rules': () => {
    const E = R.ENTITY_RULES;
    return table(['rule', 'value'], [
      ['entity definitions', `≤ ${E.maxDefs}`], ['homing turn', `≤ ${E.maxTurn} rad/frame`], ['every.frames', `≥ ${E.minEvery}`],
      ['spawn offset from the body', `≤ ${E.maxSpawnOffset} px`], ['spawn count per entry', `≤ ${E.maxCount} (the Governor grants ≤ ${G.GOVERNOR.entities.spawnsPerWindow} spawns per ${G.GOVERNOR.entities.spawnWindow} f per owner, so more at once is trimmed)`], ['maxAlive', `≤ ${E.maxAlive}`],
      ['clone scale', range(E.cloneScale)], ['share of entity damage counted in the spawning move\'s maxTotal', `×${E.damageShare}`],
      ['default maxHits', 'projectile and trap: 1 (+ pierce); minion, zone, beam, part, clone: unlimited unless maxHits > 1 (they end by life/hp; rehit still applies)'],
    ]);
  },
  'gov-entities': () => {
    const E = G.GOVERNOR.entities;
    return table(['runtime cap (per owner)', 'value'], [
      ['alive / threat points', `≤ ${E.maxAlive} / ≤ ${E.maxThreat}`], ['beams / traps+zones / entities with hp / clones', `≤ ${E.maxBeams} / ≤ ${E.maxTrapsZones} / ≤ ${E.maxHp} / ≤ ${E.maxClones}`],
      ['spawn rate', `≤ ${E.spawnsPerWindow} per ${E.spawnWindow} frames`], ['hp-entity template cooldown after it dies', `${E.hpCooldown} frames`],
      ['threat per kind', Object.entries(G.ENTITY_THREAT).map(([k, v]) => `${k} ${v}`).join(', ')],
    ]);
  },
  // Form slots inherit the base slots; E011 only flags an entry naming an unknown move.
  'form-fields': () => fieldTable({ ...S.FORM_FIELDS, slots: { ...S.FORM_FIELDS.slots, defaultDoc: `base slots (${S.FORM_FIELDS.slots.required} if one names an unknown move)` } }),
  hooks: () => {
    for (const h of S.HOOKS) if (!HOOK_DOC[h]) throw new Error(`gen-docs: no HOOK_DOC for hook ${h}`);
    return table(['hook', 'signature', 'when', 'queued commands apply'], S.HOOKS.map((h) => [code(h), ...HOOK_DOC[h]]));
  },
  'ai-fields': () => fieldTable(S.AI_FIELDS),
  categories: () => table(['category', 'max hit', 'max total', 'min startup', 'min duration', 'KO floor %', 'max reach (abs)', 'reach beyond body (v2)', 'max radius', 'max dps'],
    Object.entries(R.CATEGORIES).map(([k, c]) => [code(k), n(c.maxHit), n(c.maxTotal), n(c.minStartup), n(c.minDuration), n(c.koFloor),
      `${n(c.maxReach)} ×${R.REACH_ABS_MUL}`, n(R.REACH_BEYOND[k]), n(c.maxRadius), c.maxDps == null ? '—' : n(c.maxDps)])),
  'action-limits': () => {
    const A = R.ACTION_LIMITS, M = R.MOVEMENT_LIMITS, K = R.KNOCKBACK_LIMITS;
    return table(['limit', 'value'], [
      ['duration', `category minDuration–${A.maxDuration}`], ['one hitbox window', `≤ ${A.maxActive} frames`], ['hitbox radius', `≥ ${A.minRadius}`], ['rehit', `≥ ${A.minRehit}`],
      ['knockback / growth / setKnockback', `≤ ${K.maxBase} / ${K.minGrowth}–${K.maxGrowth} / ${range(A.setKnockback)}`],
      ['intangible frames per action / per timeline grant', `≤ ${A.intangibleMax} / ≤ ${A.intangibleGrant}`], ['action armor threshold', `≤ ${A.armorMax} damage`],
      ['landingLag', range(A.landingLag)], ['gravity window scale', range(A.gravityScale)], ['hold.max / charge.max / counter.mul', `${range(A.holdMax)} / ${range(A.chargeMax)} / ${range(A.counterMul)}`],
      ['shieldMul, hitlagMul / wind push', `${range(A.hitMul)} / ${range(A.push)} px/f`], ['steer speed / turn', `${range(A.steer.speed)} / ${range(A.steer.turn)}`],
      ['teleport', `≤ ${A.teleport} px`], ['camera shake', range(A.cameraShake)],
      ['self speed in a move', `|vx| ≤ ${M.maxVx}, |vy| ≤ ${M.maxVy}`],
      ['rise per move', `upSpecial-routed ≤ ${M.maxRise} px, others ≤ ${A.maxRiseOther} px`], ['horizontal travel per move', `≤ ${M.maxTravel} px`],
    ]);
  },
  'status-limits': () => {
    const L = R.STATUS_LIMITS;
    return table(['limit', 'value'], [
      ['custom statuses', `≤ ${L.maxCustom}`], ['status frames / maxStacks', `${range(L.frames)} / ${range(L.maxStacks)}`],
      ['dot', `every ≥ ${L.dotMinEvery}, damage ≤ ${L.dotMaxDamage}`], ['heal', `every ≥ ${L.healMinEvery}, amount ≤ ${L.healMaxAmount}`],
      ['resources / max', `≤ ${L.maxResources} / ${range(L.resourceMax)}`], ['soak fraction / costPerDamage', `${range(L.soakFraction)} / ≥ ${L.soakMinCost}`],
      ['vars / synced vars', `≤ ${L.maxVars} / ≤ ${L.maxSync}`], ['var strings / numbers', `≤ ${L.maxVarString} chars / ±${n(L.maxVarNumber)}`],
    ]);
  },
  'gov-hit': () => {
    const g = G.GOVERNOR;
    return table(['step', 'rule'], [
      ['multiplier', `stale (≥ ${g.staleMin}) × charge (≤ ${g.chargeMax}) × damageOut × damageIn × reflected ${g.reflectedMul} × clone ${g.cloneMul}, clamped ${g.multMin}–${g.multMax}`],
      ['per-hit cap', `min(${g.perHitTierMul} × tier max hit, ${g.absMaxHit})`],
      ['launch speed', `≤ ${g.maxSpeed} px/f`],
      ['KO floor', `below max(${g.hardKoFloor}, tier KO floor)% the launch is capped to ${g.koSafety} × the weakest KO speed within ±${g.koDiWindow}° (DI) × ramp (${g.koRampMin} at 0% → 1 at the floor)`],
      ['spikes on airborne targets below the floor', `angles ${range(g.spikeArc)}: vertical speed ≤ ${g.spikeVyMax}, hitstun ≤ ${g.spikeHitstunMax} (intended; counted apart from KO-floor clamps)`],
      ['armor', `flinch-only; fails against kb ≥ ${g.armorFailKb}`],
      ['hitlagMul', `${g.hitlagMulMin}–${g.hitlagMulMax}`],
    ]);
  },
  'gov-combo': () => {
    const g = G.GOVERNOR;
    return table(['rule', 'value'], [
      ['chain ends after', `${g.chainIdleReset} actionable frames`], ['rehit hits count as', `${n(g.rehitWeight)} hit`],
      ['damage proration', `max(${g.prorateMin}, 1 − ${g.prorateStep}·(n − 1))`], ['hitstun proration', `max(${g.prorateStunMin}, 1 − ${g.prorateStunStep}·(n − 1))`],
      ['BREAK', `n ≥ ${g.breakHits}, or chain damage ≥ ${g.breakDamage}, or ${g.breakLock} non-actionable frames → ${g.breakIntangible} f intangible + ${g.breakImmunity} f stun/freeze/grab immunity`],
    ]);
  },
  'gov-rate': () => {
    const r = G.GOVERNOR.rate, s = G.GOVERNOR.shieldRate;
    return table(['window (attacker → target, all sources)', 'rule'], [
      [`${r.window} frames`, `above ${r.soft} damage the excess is ×${r.softMul}; hard cap ${r.hard}`], [`${r.longWindow} frames`, `hard cap ${r.longHard}`],
      ['trimmed hits', `still deal ≥ ${r.minConnect} so they connect`], [`shield, ${s.window} frames`, `soft ${s.soft} (×${s.softMul}), hard ${s.hard}`],
    ]);
  },
  'gov-air': () => {
    const a = G.GOVERNOR.air;
    return table(['budget (per airtime)', 'value'], [
      ['self velocity', `|vx| ≤ ${a.maxVx}, vy ≥ −${a.maxRiseVy}`], ['rise from non-jump sources', `≤ ${a.rise} px`],
      ['stall (frames with ' + `${a.stallVyMin} ≤ vy ≤ ${a.stallVyMax} not from knockback)`, `≤ ${a.stall}`], ['teleports', `≤ ${a.teleports} per airtime, ≤ ${a.teleportDist} px; grounded sideways ≤ 1 per ${a.groundTeleportEvery} frames; none in hitstun, stun or grabbed`],
      ['long-air backstop', `${a.longAir} frames airborne without landing or being hit → helpless`], ['refund on a tumble hit', `${a.hitRefund * 100}% of spent rise and stall`],
    ]);
  },
  'gov-defense': () => {
    const g = G.GOVERNOR;
    return table(['budget', 'value'], [
      ['mitigation (soak + relay + damageIn savings + heal)', `≤ ${g.mitigation.perStock} per stock, ≤ ${g.mitigation.perHitFrac * 100}% of one hit, ≤ ${g.mitigation.perWindow} per ${g.mitigation.window} frames`],
      ['heal rate', `≤ ${g.heal.perWindow} per ${g.heal.window} frames, never in hitstun`],
      ['armor', `threshold ≤ ${g.armor.maxThreshold} (passive ≤ ${g.armor.maxPassive}); active uptime ≤ ${g.armor.uptime} per ${g.armor.window} frames`],
      ['intangibility from character sources', `≤ ${g.intangible.perGrant} per grant; ≤ ${g.intangible.budget} per ${g.intangible.window} frames (a successful counter costs ${g.intangible.counterCharge})`],
      ['tiny hurtboxes', `frames below ${g.minHurtArea} px² (or 0.6 × default area) are charged as intangibility`],
    ]);
  },
  tiers: () => table(['tier', 'tier max hit (runtime cap = min(1.4 ×, 25))', 'KO floor %'], Object.entries(G.TIER).map(([k, t]) => [code(k), n(t.maxHit), n(t.koFloor)])),
  'script-limits': () => {
    const L = SCRIPT_LIMITS;
    return table(['limit', 'value'], [
      ['faults that disable a fighter\'s scripts', `${L.maxThrows} throws, or ${L.maxSlowCalls} calls > ${L.maxCallMs} ms, or > ${L.avgTickMs} ms/tick averaged over ${L.avgWindow} ticks (timing ignored for the first ${L.timingGrace} ticks)`],
      ['queued commands per fighter per frame', `≤ ${L.cmdsPerFrame}`], ['fx events per frame / emit data', `≤ ${L.fxPerFrame} / ≤ ${L.fxDataBytes} B JSON`],
      ['startMove buffer when not actionable', `${L.startMoveBuffer} frames`], ['form cooldown / transition hitlag', `${L.formCooldown} / ${L.formHitlag} frames`],
      ['setBodyScale rate', `≤ ${L.scaleRate} per frame, within body.scaleRange (${L.scaleMin}–${L.scaleMax})`],
      ['api.hit frames', `1–${L.hitFramesMax}`], ['status by id', `target within ${L.statusRange} px and hit by you within ${L.statusRecent} frames (or the onHit target / entity contact)`],
      ['modify sets', `≤ ${L.maxModSets}`], ['ai.hint', `evaluated at most every ${L.hintEvery} frames`],
    ]);
  },
  'codes-e': () => table(['code', 'meaning', 'fix'], [
    ...Object.entries(S.NOTE_CODES).filter(([c]) => c[0] === 'E').map(([c, d]) => [code(c), d.why, d.fix]),
    [code('E020'), 'lint failure (scripts/lint-characters.js; CI and npm test)', 'see the rule id and fix printed with the note'],
  ]),
  'codes-i': () => table(['code', 'meaning', 'fix'], Object.entries(S.NOTE_CODES).filter(([c]) => c[0] === 'I').map(([c, d]) => [code(c), d.why, d.fix])),
  'codes-w': () => table(['code', 'what was adjusted', 'how to get your intent back'], Object.entries(W_CODES).sort(([a], [b]) => a.localeCompare(b)).map(([c, d]) => [code(c), d.title, d.fix])),
  effects: () => list(S.EFFECT_PRESETS),
  'hit-kinds': () => list(S.HIT_KINDS),
  'sound-presets': () => list(SOUND_PRESETS) + `\n\nLimits: ≤ ${AUDIO_LIMITS.perSecond} sounds per second per character, SynthSpec dur ≤ ${AUDIO_LIMITS.maxDur} s, freq ${AUDIO_LIMITS.minFreq}–${AUDIO_LIMITS.maxFreq} Hz.`,
  'fx-shapes': () => list(FX_SHAPES),
  'state-clips': () => list(STATE_CLIPS),
  'asset-limits': () => {
    const A = ASSET_LIMITS, mb = (b) => `${n(b / 1048576)} MB`, kb = (b) => `${n(b / 1024)} KB`;
    return table(['asset', 'formats', 'limits'], [
      ['images', A.image.formats.join(', '), `≤ ${mb(A.image.maxBytes)} each, ≤ ${A.image.maxSide} px per side; SVG without scripts or external references`],
      ['audio', A.audio.formats.join(', '), `≤ ${kb(A.audio.maxBytes)} each`],
      ['code', 'js, mjs', `≤ ${kb(A.js.maxBytes)} total`],
      ['notes', A.other.join(', '), ''],
      ['whole folder', '', `≤ ${mb(A.folder.maxBytes)}, ≤ ${A.folder.maxFiles} files; anything else (jpg, gif, wav, …) is an error`],
    ]);
  },
  'kit-exports': () => list(Object.keys(KIT).filter((k) => typeof KIT[k] === 'function').sort()),
};

// ── documentation coverage (check mode) ────────────────────────────────────
function coverage(docs) {
  const errs = [];
  const guide = docs['docs/CHARACTER_GUIDE.md'] || '';
  const fake = { id: 'x', game: { frame: 0, fighters: [], entities: [] } };
  const api = makeApi(fake, { kind: 'docs', dead: false, memo: {}, entity: {} });
  for (const k of Object.keys(api)) if (!guide.includes(`api.${k}`)) errs.push(`CHARACTER_GUIDE.md does not document api.${k}`);
  for (const k of ['frame', 'me', 'res', 'vars', 'input', 'enemies', 'nearestEnemy', 'entities', 'stage', 'rng', 'budget']) if (!guide.includes(`view.${k}`)) errs.push(`CHARACTER_GUIDE.md does not document view.${k}`);
  for (const t of S.TIMELINE_ACTION_KEYS) if (!guide.includes(`\`${t}\``)) errs.push(`CHARACTER_GUIDE.md does not mention timeline action ${t}`);
  return errs;
}

// ── cookbook recipes (check mode) ───────────────────────────────────────────
function recipes(md) {
  const out = [];
  const re = /```js recipe=([\w-]+)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md))) {
    const [, name, src] = m;
    let def;
    try { def = new Function('defineCharacter', `return defineCharacter({ id: 'recipe', name: 'Recipe', ${src} });`)(defineCharacter); } catch (e) {
      out.push({ name, errors: [`does not parse: ${e.message}`], warns: [] });
      continue;
    }
    const r = validateCharacter(def, { expectedId: 'recipe' });
    out.push({ name, errors: (r.errors || []).map(String), warns: (r.notes || []).filter((x) => x.severity === 'warn').map(String) });
  }
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--list')) { console.log(Object.keys(BLOCKS).join('\n')); process.exit(0); }
const check = args.includes('--check');
const MARK = /<!-- gen:([\w-]+) -->\n[\s\S]*?<!-- \/gen:\1 -->/g;
const problems = [];
const docs = {};
const only = args.filter((a) => !a.startsWith('--'));
for (const rel of only.length ? only : DOCS) {
  const file = resolve(ROOT, rel);
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  const out = src.replace(MARK, (_all, name) => {
    if (!BLOCKS[name]) { problems.push(`${rel}: unknown block gen:${name} (see --list)`); return _all; }
    return `<!-- gen:${name} -->\n${BLOCKS[name]()}\n<!-- /gen:${name} -->`;
  });
  docs[rel] = out;
  if (out === src) continue;
  if (check) problems.push(`${rel}: generated tables are stale — run node scripts/gen-docs.js`);
  else { writeFileSync(file, out); console.log(`updated ${rel}`); }
}
if (check) {
  problems.push(...coverage(docs));
  for (const r of recipes(docs['docs/COOKBOOK.md'] || '')) {
    for (const e of r.errors) problems.push(`COOKBOOK recipe ${r.name}: ${e}`);
    for (const w of r.warns) problems.push(`COOKBOOK recipe ${r.name}: W-note: ${w}`);
  }
  if (problems.length) { console.error(`✘ docs check failed:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log('✔ docs: generated tables are current, every api/view call is documented, every cookbook recipe loads clean.');
} else if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
