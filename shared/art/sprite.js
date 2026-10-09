// ─────────────────────────────────────────────────────────────────────────────
// SPRITES — sprite sheets and clips for character art (spec §6.3). Pure Canvas 2D,
// no DOM access: works in the browser, the Lab and Node tests.
//
//   art.sheets = { body: { image: 'sheet', frameW, frameH, cols?, anchor: [x, y], scale = 1,
//                          pixelated = false, padding = 0 } }
//   art.clips  = { body: { idle: { frames: [0, 1, 2, 3], fps: 6, loop: true },
//                          jab:  { sync: 'move', startup: [26], active: [27], recovery: [28] } } }
//
// info.sprite.drawClip(ctx, 'body', view) picks the clip (move.anim → state clip →
// idle), the frame (fps clock from the state start, or the move phase for
// sync:'move') and draws it with the sheet anchor at the body origin (feet).
// ─────────────────────────────────────────────────────────────────────────────

/** State clip names, in the order of §6.3. */
export const STATE_CLIPS = Object.freeze(['idle', 'run', 'jump', 'fall', 'land', 'crouch', 'shield', 'roll', 'spotdodge', 'airdodge',
  'hurt', 'tumble', 'helpless', 'grabbing', 'grabbed', 'stunned', 'glide', 'fly', 'wallcling', 'crawl', 'taunt', 'dead', 'respawn']);

/** Candidate state clips for a view, most specific first ('idle' is always the last resort). */
export function stateClipNames(view) {
  const s = view?.state || 'idle';
  switch (s) {
    case 'air': return view.vy < 0 ? ['jump', 'fall'] : ['fall', 'jump'];
    case 'jumpsquat': return ['jumpsquat', 'crouch', 'land'];
    case 'hitstun': return view.tumble ? ['tumble', 'hurt'] : ['hurt'];
    case 'shieldbreak': return ['shieldbreak', 'stunned', 'hurt'];
    case 'stunned': return ['stunned', 'hurt'];
    case 'attack': return view.grounded === false ? (view.vy < 0 ? ['jump', 'fall'] : ['fall', 'jump']) : [];
    case 'grabbing': return ['grabbing'];
    default: return [s];
  }
}

/**
 * Picks the clip for a view: move.anim, then the state clip, then idle.
 * @returns {{name: string, clip: object}|null}
 */
export function resolveClip(clips, view) {
  if (!clips) return null;
  const m = view?.move;
  if (m) {
    for (const n of [m.anim, m.key, m.name]) if (n && clips[n]) return { name: n, clip: clips[n] };
  }
  for (const n of stateClipNames(view)) if (clips[n]) return { name: n, clip: clips[n] };
  return clips.idle ? { name: 'idle', clip: clips.idle } : null;
}

const PHASE_FALLBACK = {
  startup: ['startup', 'active', 'recovery'],
  active: ['active', 'startup', 'recovery'],
  recovery: ['recovery', 'active', 'startup'],
  charge: ['charge', 'startup'],
  hold: ['hold', 'active', 'startup'],
};

/**
 * Sheet frame index for a clip at a view.
 * - sync:'move' maps view.move.phaseT across the phase's frame list (charge/hold
 *   loop at 8 fps when they have more than one frame).
 * - frames/fps: clock = the state (or move) frame; loop wraps, else holds the last.
 *   speedFrom: 'vx'|'vy' scales fps by |v| / stat (runSpeed / fallSpeed).
 * @param {object} [o] { stats, frame } frame overrides the clock (sim frames)
 */
export function clipFrame(clip, view, o = {}) {
  if (!clip) return 0;
  if (clip.sync === 'move') {
    const m = view?.move;
    const phase = m?.phase || 'startup';
    let list = null;
    for (const k of PHASE_FALLBACK[phase] || ['startup']) if (Array.isArray(clip[k]) && clip[k].length) { list = clip[k]; break; }
    if (!list) return 0;
    if (phase === 'charge' && !clip.charge?.length) return list[list.length - 1]; // hold the windup
    if (phase === 'charge' || phase === 'hold') {
      const clock = o.frame ?? (phase === 'hold' ? m?.holdFrames : m?.chargeFrames) ?? m?.frame ?? 0;
      return list[Math.floor(clock / 7.5) % list.length]; // loop at 8 fps
    }
    const t = Math.min(0.9999, Math.max(0, m?.phaseT ?? 0));
    return list[Math.floor(t * list.length)];
  }
  const frames = Array.isArray(clip.frames) && clip.frames.length ? clip.frames : [0];
  let fps = clip.fps ?? 10;
  if (clip.speedFrom && o.stats) {
    const v = Math.abs(clip.speedFrom === 'vy' ? view?.vy || 0 : view?.vx || 0);
    const ref = clip.speedFrom === 'vy' ? o.stats.fallSpeed || 10 : o.stats.runSpeed || o.stats.airSpeed || 6;
    fps *= Math.max(0.25, Math.min(3, v / ref));
  }
  const clock = o.frame ?? (view?.move ? view.move.frame : view?.stateFrame) ?? 0;
  const i = Math.floor((clock * fps) / 60);
  return frames[clip.loop ? ((i % frames.length) + frames.length) % frames.length : Math.min(frames.length - 1, Math.max(0, i))];
}

/** Source rect [sx, sy, sw, sh] of a frame on a sheet. */
export function frameRect(sheet, image, index) {
  const pad = sheet.padding || 0;
  const iw = image?.width || sheet.frameW;
  const cols = sheet.cols || Math.max(1, Math.floor((iw + pad) / (sheet.frameW + pad)));
  const i = Math.max(0, index | 0);
  return [(i % cols) * (sheet.frameW + pad), Math.floor(i / cols) * (sheet.frameH + pad), sheet.frameW, sheet.frameH];
}

/**
 * Draws one sheet frame with its anchor at (opts.x, opts.y) (default: origin).
 * opts: { x, y, scale, rotate, alpha, flipX, outline: color, outlinePx }.
 * When the image is missing (failed asset), draws a soft placeholder of the
 * frame's footprint so the character stays visible; returns false.
 */
export function drawSheetFrame(ctx, sheet, image, index, opts = {}) {
  if (!sheet) return false;
  const s = (sheet.scale ?? 1) * (opts.scale ?? 1);
  const [ax, ay] = sheet.anchor || [sheet.frameW / 2, sheet.frameH];
  ctx.save();
  ctx.translate(opts.x || 0, opts.y || 0);
  if (opts.rotate) ctx.rotate(opts.rotate);
  ctx.scale(opts.flipX ? -s : s, s);
  if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
  let ok = true;
  if (!image) {
    ok = false;
    ctx.globalAlpha *= 0.35;
    ctx.fillStyle = opts.placeholder || '#c8b8e0';
    const w = sheet.frameW * 0.5, h = sheet.frameH * 0.8;
    ctx.beginPath();
    ctx.ellipse(-ax + sheet.frameW / 2, -ay + sheet.frameH - h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const [sx, sy, sw, sh] = frameRect(sheet, image, index);
    if (sheet.pixelated) ctx.imageSmoothingEnabled = false;
    if (opts.outline && opts.kit?.outline) opts.kit.outline(ctx, image, -ax, -ay, sw, sh, opts.outline, (opts.outlinePx || 2) / s, [sx, sy, sw, sh]);
    else ctx.drawImage(image, sx, sy, sw, sh, -ax, -ay, sw, sh);
  }
  ctx.restore();
  return ok;
}

/**
 * The `info.sprite` API for one character.
 * @param {object} art     ArtDef ({sheets, clips})
 * @param {object} assets  decoded assets {name: ImageBitmap|null}
 * @param {object} [o]     { stats(view) → stats for speedFrom, kit, placeholder color }
 */
export function makeSprite(art, assets, o = {}) {
  const sheets = art?.sheets || {};
  const clips = art?.clips || {};
  const sheetFor = (key, clip) => sheets[clip?.sheet] || sheets[key] || sheets[Object.keys(sheets)[0]] || null;
  const imageOf = (sheet) => (sheet && assets ? assets[sheet.image] || null : null);
  return {
    sheets, clips,
    /** Resolved clip and frame for a view (Lab, tests). */
    resolve(key, view) {
      const set = clips[key] || clips[view?.form] || clips.base || clips[Object.keys(clips)[0]];
      const r = resolveClip(set, view);
      if (!r) return null;
      return { ...r, sheet: sheetFor(key, r.clip), frame: clipFrame(r.clip, view, { stats: o.stats?.(view) }) };
    },
    /** Draws the clip for `view` from clip set `sheetOrForm`. Returns false if nothing drew. */
    drawClip(ctx, sheetOrForm, view, opts = {}) {
      const r = this.resolve(sheetOrForm, view);
      if (!r || !r.sheet) return false;
      return drawSheetFrame(ctx, r.sheet, imageOf(r.sheet), opts.frame ?? r.frame, { kit: o.kit, placeholder: o.placeholder, ...opts });
    },
    /** Draws frame `index` of sheet `name` (entity art, effects). */
    drawFrame(ctx, name, index, opts = {}) {
      const sheet = sheets[name];
      if (!sheet) return false;
      return drawSheetFrame(ctx, sheet, imageOf(sheet), index, { kit: o.kit, placeholder: o.placeholder, ...opts });
    },
  };
}
