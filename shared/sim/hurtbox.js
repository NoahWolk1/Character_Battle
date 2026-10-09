// Hurtboxes and the stage collider (spec §3.7).
// v1 characters (no `body`) get sets synthesized from stats.width/height:
//   default = rect w×h, crouch = rect w×(0.68·h) — bit-identical to v1's hurtbox.
import { mirror, contains, aabbAll } from './shapes.js';

const CROUCH_SCALE = 0.68;
const bodyCache = new WeakMap(); // char → { [form]: {collider, sets} }

/** Body for the fighter's current form: {collider: {w, h}, sets: {name: Shape[]}}. */
export function bodyOf(f) {
  const c = f.char;
  let byForm = bodyCache.get(c);
  if (!byForm) { byForm = {}; bodyCache.set(c, byForm); }
  const form = f.form || 'base';
  if (byForm[form]) return byForm[form];
  const body = (form !== 'base' && c.forms?.[form]?.body) || c.body || c.forms?.base?.body;
  let out;
  if (body && body.collider) {
    const sets = { ...(body.hurtboxes || {}) };
    if (!sets.default) sets.default = [{ shape: 'rect', x: 0, y: -body.collider.h / 2, w: body.collider.w, h: body.collider.h }];
    out = { collider: { w: body.collider.w, h: body.collider.h }, sets };
  } else {
    const w = f.stats.width, h = f.stats.height, hh = h * CROUCH_SCALE;
    out = {
      collider: { w, h },
      sets: {
        default: [{ shape: 'rect', x: 0, y: -h / 2, w, h }],
        crouch: [{ shape: 'rect', x: 0, y: -hh / 2, w, h: hh }],
      },
    };
  }
  byForm[form] = out;
  return out;
}

/** Stage collider {w, h} × bodyScale (physics, ledge snap, blast-zone top). */
export function collider(f) {
  const c = bodyOf(f).collider;
  const s = f.bodyScale ?? 1;
  return s === 1 ? c : { w: c.w * s, h: c.h * s };
}

/** Name of the active hurtbox set (§2.2.3 order), or a window's inline shapes. */
export function selectSet(f) {
  const sets = bodyOf(f).sets;
  const a = f.action;
  if (a && a.def.hurtboxes) {
    for (const w of a.def.hurtboxes) {
      if (a.frame >= w.from && a.frame <= w.to) {
        if (w.shapes) return { name: null, shapes: w.shapes };
        if (w.set && sets[w.set]) return { name: w.set, shapes: sets[w.set] };
      }
    }
  }
  if (f.hurtSet && sets[f.hurtSet]) return { name: f.hurtSet, shapes: sets[f.hurtSet] };
  if (f.state === 'crouch' && sets.crouch) return { name: 'crouch', shapes: sets.crouch };
  if (!f.grounded && sets.air) return { name: 'air', shapes: sets.air };
  return { name: 'default', shapes: sets.default };
}

/** World-space hurt shapes (mirrored by facing, scaled by bodyScale). */
export function hurtShapes(f) {
  let sel = selectSet(f);
  const gov = f.game && f.game.gov;
  if (gov && sel.name !== 'default' && typeof gov.chargeHurtArea === 'function') {
    // Shrunken sets are charged to the intangibility budget once per frame (§3.7).
    const frame = f.game.frame;
    if (f.areaFrame !== frame) {
      f.areaFrame = frame;
      f.areaOk = gov.chargeHurtArea(f, hurtArea(f, sel), hurtArea(f, { name: 'default', shapes: bodyOf(f).sets.default })) !== false;
    }
    if (!f.areaOk) sel = { name: 'default', shapes: bodyOf(f).sets.default };
  }
  const s = f.bodyScale ?? 1;
  const out = new Array(sel.shapes.length);
  for (let i = 0; i < sel.shapes.length; i++) out[i] = mirror(sel.shapes[i], f.facing, s, f.x, f.y);
  return out;
}

const areaCache = new WeakMap(); // shapes array → px²

/** Runtime hurt area: precomputed A[set] (validator report) or a 2 px raster, × bodyScale². */
export function hurtArea(f, sel = selectSet(f)) {
  const s = f.bodyScale ?? 1;
  const pre = sel.name && f.char.report?.area?.[sel.name];
  return (typeof pre === 'number' ? pre : rasterArea(sel.shapes)) * s * s;
}

/** Union area of local shapes on a deterministic 2 px raster (cached per array). */
export function rasterArea(shapes) {
  let a = areaCache.get(shapes);
  if (a !== undefined) return a;
  const b = aabbAll(shapes);
  a = 0;
  if (b) {
    for (let y = Math.floor(b.y1) + 1; y < b.y2; y += 2) {
      for (let x = Math.floor(b.x1) + 1; x < b.x2; x += 2) {
        for (const sh of shapes) if (contains(sh, x, y)) { a += 4; break; }
      }
    }
  }
  areaCache.set(shapes, a);
  return a;
}
