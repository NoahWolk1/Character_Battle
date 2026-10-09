// ─────────────────────────────────────────────────────────────────────────────
// Per-form body / movement / stats (spec §2.2.12, §4.1.1). Every form is priced
// on its own against STAT_BUDGET. Values a form inherited unchanged from base
// take base's clamped value silently (one note per author mistake, not per form).
// ─────────────────────────────────────────────────────────────────────────────
import { STAT_BUDGET } from '../rules.js';
import { clampBody, setAreas } from './body.js';
import { clampStats, clampMovement, squeezeForm, priceForm, STAT_KEYS } from './stats.js';

const MAX_FORMS = 6;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = (v) => JSON.parse(JSON.stringify(v));

/**
 * Clamp and price every form. Returns {forms: {name: {statPoints, area, pricedArea, scaleMin, areas}}, bodies}.
 * `bodies[form]` = {hurt: default shapes, cy: collider center y, collider} for reach checks.
 */
export function clampForms(env) {
  const { draft, notes } = env;
  const extra = draft.formOrder.length - 1;
  if (extra > MAX_FORMS) notes.add('W140', 'forms', `${extra} forms (max ${MAX_FORMS}); all are kept, but each must fit the stat budget on its own.`, { from: extra, to: MAX_FORMS, rule: 'CharacterDef.forms' });

  const base = draft.forms.base;
  const orig = { body: copy(base.body), stats: { ...base.stats }, movement: copy(base.movement) };
  const out = {};
  const bodies = {};
  for (const f of draft.formOrder) {
    const form = draft.forms[f];
    const path = f === 'base' ? '' : `forms.${f}`;
    if (f !== 'base') {
      if (same(form.body, orig.body)) form.body = copy(base.body);
      for (const k of STAT_KEYS) if (form.stats[k] === orig.stats[k]) form.stats[k] = base.stats[k];
      for (const m of Object.keys(form.movement)) if (same(form.movement[m], orig.movement[m]) && base.movement[m]) form.movement[m] = { ...base.movement[m] };
    }
    const geo = clampBody(form, path, notes);
    clampStats(form.stats, path ? `${path}.stats` : 'stats', notes);
    clampMovement(form.movement, form.stats, path ? `${path}.movement` : 'movement', notes);
    out[f] = { ...geo, areas: null, statPoints: null };
    bodies[f] = { hurt: form.body.hurtboxes.default, cy: -form.body.collider.h / 2, collider: form.body.collider };
  }
  for (const f of draft.formOrder) {
    const form = draft.forms[f];
    const path = f === 'base' ? 'stats' : `forms.${f}.stats`;
    squeezeForm(form, out[f].pricedArea, path, notes);
    clampMovement(form.movement, form.stats, f === 'base' ? 'movement' : `forms.${f}.movement`, notes); // crawl speed follows runSpeed
    out[f].statPoints = priceForm({ stats: form.stats, movement: form.movement, armor: form.armor, pricedArea: out[f].pricedArea });
    out[f].statBudget = STAT_BUDGET;
    out[f].areas = setAreas(form.body);
  }
  return { forms: out, bodies };
}
