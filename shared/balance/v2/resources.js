// ─────────────────────────────────────────────────────────────────────────────
// v2 resource / vars / sync limits (spec §2.2.1, §2.2.6). Resources only gate
// actions and feed scripts, so only their ranges are checked; `soak` is
// defensive and budgeted (fraction ≤ 0.5, cost ≥ 0.5 per damage; the Governor
// caps prevented damage per stock).
// ─────────────────────────────────────────────────────────────────────────────
import { STATUS_LIMITS } from '../rules.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function clampResources(draft, notes) {
  const L = STATUS_LIMITS;
  const names = Object.keys(draft.resources);
  if (names.length > L.maxResources) {
    notes.add('W511', 'resources', `${names.length} resources (max ${L.maxResources}); only the first ${L.maxResources} are kept: ${names.slice(0, L.maxResources).join(', ')}.`,
      { from: names.length, to: L.maxResources, rule: 'STATUS_LIMITS.maxResources' });
    for (const n of names.slice(L.maxResources)) delete draft.resources[n];
  }
  for (const n of Object.keys(draft.resources)) {
    const r = draft.resources[n];
    const P = `resources.${n}`;
    const set = (k, c, why) => {
      if (r[k] === c) return;
      notes.add('W510', `${P}.${k}`, why, { from: r[k], to: c, rule: 'ResourceDef ranges' });
      r[k] = c;
    };
    set('max', clamp(r.max, ...L.resourceMax), `max ${r.max} is outside ${L.resourceMax[0]}–${L.resourceMax[1]}; set to ${clamp(r.max, ...L.resourceMax)}.`);
    if (!(r.min <= r.max)) set('min', 0, `min ${r.min} is above max ${r.max}; set to 0.`);
    if (r.min < -L.resourceMax[1]) set('min', -L.resourceMax[1], `min ${r.min} is below −${L.resourceMax[1]}.`);
    const st = clamp(r.start, r.min, r.max);
    if (st !== r.start) set('start', st, `start ${r.start} is outside min–max; set to ${st}.`);
    for (const k of ['regen', 'decay']) {
      const c = clamp(isNum(r[k]) ? Math.abs(r[k]) : 0, 0, r.max - r.min);
      if (c !== r[k]) set(k, c, `${k} ${r[k]} must be 0–${r.max - r.min} per frame; set to ${c}.`);
    }
    if (r.regenDelay < 0) set('regenDelay', 0, 'regenDelay must be ≥ 0.');
    if (r.soak) {
      const s = r.soak;
      const f = clamp(s.fraction, ...L.soakFraction);
      if (f !== s.fraction) { notes.add('W510', `${P}.soak.fraction`, `soak fraction ${s.fraction} → ${f} (max ${L.soakFraction[1]}: at most half of a hit).`, { from: s.fraction, to: f, rule: 'STATUS_LIMITS.soakFraction' }); s.fraction = f; }
      if (!(s.costPerDamage >= L.soakMinCost)) {
        notes.add('W510', `${P}.soak.costPerDamage`, `soak costPerDamage ${s.costPerDamage} → ${L.soakMinCost} (min).`, { from: s.costPerDamage, to: L.soakMinCost, rule: 'STATUS_LIMITS.soakMinCost' });
        s.costPerDamage = L.soakMinCost;
      }
    }
  }

  // vars
  const vnames = Object.keys(draft.vars);
  if (vnames.length > L.maxVars) {
    notes.add('W511', 'vars', `${vnames.length} vars (max ${L.maxVars}); only the first ${L.maxVars} are kept.`, { from: vnames.length, to: L.maxVars, rule: 'STATUS_LIMITS.maxVars' });
    for (const n of vnames.slice(L.maxVars)) delete draft.vars[n];
  }
  for (const n of Object.keys(draft.vars)) {
    const v = draft.vars[n];
    if (typeof v === 'string' && v.length > L.maxVarString) {
      notes.add('W512', `vars.${n}`, `string longer than ${L.maxVarString} characters; truncated.`, { from: v.length, to: L.maxVarString, rule: 'STATUS_LIMITS.maxVarString' });
      draft.vars[n] = v.slice(0, L.maxVarString);
    } else if (typeof v === 'number' && Math.abs(v) > L.maxVarNumber) {
      const c = clamp(v, -L.maxVarNumber, L.maxVarNumber);
      notes.add('W512', `vars.${n}`, `${v} is outside ±${L.maxVarNumber}; set to ${c}.`, { from: v, to: c, rule: 'STATUS_LIMITS.maxVarNumber' });
      draft.vars[n] = c;
    }
  }
  draft.sync = draft.sync.filter((n) => n in draft.vars);
  if (draft.sync.length > L.maxSync) {
    notes.add('W511', 'sync', `${draft.sync.length} synced vars (max ${L.maxSync}); only the first ${L.maxSync} are sent.`, { from: draft.sync.length, to: L.maxSync, rule: 'STATUS_LIMITS.maxSync' });
    draft.sync.length = L.maxSync;
  }
}
