// Pooled world-space particle system + the `fx` API handed to character art (spec §6.4).
// Pure canvas code: no DOM access at import time, so it also runs under node for tests.
//
//   const P = new Particles();             // one per renderer
//   const fx = P.api(ownerId, { anchor, sound, sheet });   // per fighter
//   fx.burst({...}); fx.ring({...}); fx.local.smoke({...});
//   P.update(); P.draw(ctx, 'back'); ... P.draw(ctx, 'front');
//
// Budgets: ≤ 400 live particles per character and 2000 globally (engine defaults: global
// only); the oldest are dropped first.
import * as kit from '../../shared/art/kit.js';
import { mulberry32, hash32 } from '../../shared/sim/rng.js';

export const BUDGET = Object.freeze({
  perOwner: 400, global: 2000, perCall: 128, decals: 48, afterimages: 24,
  ribbonsPerOwner: 12, ribbonPoints: 48, textLen: 40, sounds: 8,
  shake: 8, flash: 0.35, flashFrames: 6, decalLife: 180,
});

/** Shapes a character may ask for by name (plus a draw function or {sheet, frame}). */
export const FX_SHAPES = Object.freeze(['spark', 'dot', 'smoke', 'debris', 'ring', 'drip', 'streak', 'glow', 'star', 'shard']);
// Shapes that live behind fighters unless `layer` says otherwise.
const BACK = new Set(['smoke', 'beam', 'decal']);
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const ENGINE = '__engine';

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isColor = (c) => typeof c === 'string' && c.length > 0 && c.length < 64;

function blank() {
  return {
    shape: 'dot', owner: ENGINE, dead: false, layer: 'front', blend: 'source-over',
    x: 0, y: 0, vx: 0, vy: 0, gravity: 0, drag: 1, rot: 0, vr: 0, life: 1, max: 1,
    size: 4, size2: null, width: 4, color: '#ffffff', color2: '#ffffff', alpha: 1, fade: 'out',
    r0: 0, r1: 0, flat: false, points: 8, x2: 0, y2: 0, jag: 0, seed: 0, text: '', font: null,
    img: null, w: 0, h: 0, draw: null, sprite: null, data: null, age: 0,
  };
}

export class Particles {
  /**
   * @param {object} [o]
   * @param {number} [o.perOwner]  live cap per owner (default 400)
   * @param {number} [o.global]    live cap overall (default 2000)
   * @param {number} [o.seed]      visual rng seed (reproducible Lab renders)
   * @param {() => any} [o.canvas] canvas factory for afterimage copies / sprite caches
   */
  constructor(o = {}) {
    this.perOwner = o.perOwner ?? BUDGET.perOwner;
    this.global = o.global ?? BUDGET.global;
    this.rand = mulberry32(o.seed ?? 0x5eed);
    this.makeCanvas = o.canvas !== undefined ? o.canvas : defaultCanvasFactory();
    this.list = [];          // spawn order (may contain dead entries until compaction)
    this.head = 0;           // first possibly-alive index for global oldest-drop
    this.alive = 0;
    this.byOwner = new Map(); // owner → {q: particle[], h: head index, n: live count}
    this.pool = [];
    this.ribbons = new Map(); // `${owner}|${id}` → ribbon
    this.accum = new Map();   // local emitter fractional accumulators
    this.dropped = 0;         // telemetry: particles evicted by budgets
    this.frame = 0;
    this.quality = 'high';
  }

  // ── Spawning and budgets ─────────────────────────────────────────────────
  rnd(r, d) {
    if (Array.isArray(r)) { const a = num(r[0], d), b = num(r[1], a); return a + (b - a) * this.rand(); }
    return num(r, d);
  }

  /** Low-level spawn; `props` fields are copied onto a pooled particle. Returns it. */
  spawn(owner, props) {
    owner = owner ?? ENGINE;
    let o = this.byOwner.get(owner);
    if (!o) { o = { q: [], h: 0, n: 0 }; this.byOwner.set(owner, o); }
    // Engine defaults (shared by every fighter) are bounded only by the global cap.
    if (o.n >= (owner === ENGINE ? this.global : this.perOwner)) this.evictOwner(o);
    if (this.alive >= this.global) this.evictGlobal();
    // Evicted particles linger in the lists until compaction; keep that bounded under spam.
    if (this.list.length - this.alive > 4096) this.compact();
    const p = this.pool.pop() || blank();
    if (p.dead) Object.assign(p, blank());
    Object.assign(p, props);
    p.owner = owner;
    p.dead = false;
    p.age = 0;
    p.life = Math.max(1, Math.round(num(p.life, 20)));
    p.max = p.life;
    if (!props.layer) p.layer = BACK.has(p.shape) ? 'back' : 'front';
    this.list.push(p);
    o.q.push(p); o.n++;
    this.alive++;
    return p;
  }

  kill(p) {
    if (p.dead) return;
    p.dead = true;
    this.alive--;
    const o = this.byOwner.get(p.owner);
    if (o) o.n--;
  }

  evictOwner(o) {
    while (o.h < o.q.length && o.q[o.h].dead) o.h++;
    if (o.h < o.q.length) { this.kill(o.q[o.h++]); this.dropped++; }
  }

  evictGlobal() {
    while (this.head < this.list.length && this.list[this.head].dead) this.head++;
    if (this.head < this.list.length) { this.kill(this.list[this.head++]); this.dropped++; }
  }

  count(owner) { return owner === undefined ? this.alive : (this.byOwner.get(owner ?? ENGINE)?.n || 0); }

  /** Kills one owner's particles and ribbons (fighter left / art reload). */
  clearOwner(owner) {
    for (const p of this.list) if (!p.dead && p.owner === owner) this.kill(p);
    for (const k of [...this.ribbons.keys()]) if (k.startsWith(`${owner}|`)) this.ribbons.delete(k);
    this.compact();
  }

  stats() { return { alive: this.alive, owners: this.byOwner.size, ribbons: this.ribbons.size, dropped: this.dropped, pooled: this.pool.length }; }

  /** Kills everything (new match). */
  clear() {
    for (const p of this.list) if (!p.dead) this.kill(p);
    this.compact();
    this.ribbons.clear();
    this.accum.clear();
  }

  // ── Simulation ───────────────────────────────────────────────────────────
  update() {
    this.frame++;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      if (p.dead) continue;
      p.vx *= p.drag; p.vy *= p.drag; p.vy += p.gravity;
      p.x += p.vx; p.y += p.vy;
      p.rot += p.vr;
      p.age++;
      if (--p.life <= 0) this.kill(p);
    }
    this.compact();
    for (const [k, r] of this.ribbons) {
      r.pts = r.pts.filter((pt) => this.frame - pt.t < r.life);
      if (!r.pts.length && this.frame - r.touched > 60) this.ribbons.delete(k);
    }
  }

  compact() {
    const keep = [];
    for (const p of this.list) {
      if (!p.dead) keep.push(p);
      else if (this.pool.length < 2500) { p.img = null; p.draw = null; p.data = null; p.sprite = null; this.pool.push(p); }
    }
    this.list = keep;
    this.head = 0;
    for (const [owner, o] of this.byOwner) {
      const q = [];
      for (let i = o.h; i < o.q.length; i++) if (!o.q[i].dead) q.push(o.q[i]);
      o.q = q; o.h = 0; o.n = q.length;
      if (!q.length && owner !== ENGINE) this.byOwner.delete(owner);
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  draw(ctx, layer = 'front') {
    const low = this.quality === 'low';
    if (layer === 'front') this.drawRibbons(ctx);
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      if (p.dead || p.layer !== layer) continue;
      if (low && (i & 1) && (p.shape === 'smoke' || p.shape === 'dot')) continue;
      const k = p.life / p.max;   // 1 → 0
      ctx.save();
      if (p.blend === 'lighter') ctx.globalCompositeOperation = 'lighter';
      try { drawParticle(ctx, p, k, this); } catch { p.dead || this.kill(p); }
      ctx.restore();
    }
  }

  drawRibbons(ctx) {
    for (const r of this.ribbons.values()) {
      const pts = r.pts;
      if (pts.length < 2) continue;
      ctx.save();
      ctx.globalCompositeOperation = r.blend;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const layers = r.glow ? [[r.width * 1.8, r.colors[2], 0.35], [r.width, r.colors[1], 0.7], [r.width * 0.33, r.colors[0], 1]] : [[r.width, r.colors[1], 1]];
      for (const [w, col, al] of layers) {
        ctx.strokeStyle = col;
        for (let i = 1; i < pts.length; i++) {
          const k = i / pts.length;
          ctx.globalAlpha = al * k * r.alpha;
          ctx.lineWidth = Math.max(0.5, w * k);
          ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ── The fx API ───────────────────────────────────────────────────────────
  /**
   * Builds the character-facing fx API for one owner.
   * @param {string|null} owner
   * @param {object} [host]
   * @param {() => {x, y, facing, scale}} [host.anchor]  fighter feet in world space (for fx.local)
   * @param {(name, opts) => any} [host.sound]           sound router (rate-capped by audio)
   * @param {(amount) => void} [host.shake]
   * @param {(color, alpha, frames) => void} [host.flash]
   * @param {(name) => {image, frameW, frameH, cols?, anchor?, scale?, pixelated?}|null} [host.sheet]
   * @param {string} [host.color]  default color (move color / palette effect)
   */
  api(owner, host = {}) {
    const P = this;
    const defColor = () => host.color || '#ffffff';
    const fx = {
      burst(o = {}) { return P.burst(owner, o, defColor(), host); },
      ring(o = {}) {
        if (!finiteXY(o)) return null;
        const r1 = clamp(num(o.r1, num(o.r, 60)), 1, 900);
        return P.spawn(owner, {
          shape: 'ring', x: o.x, y: o.y, r0: clamp(num(o.r0, r1 * 0.2), 0, 900), r1, life: clamp(num(o.life, 16), 1, 180),
          width: clamp(num(o.width, 5), 0.5, 40), color: pickColor(o, defColor()), flat: !!o.flat, alpha: clamp(num(o.alpha, 1), 0, 1),
          blend: o.blend === 'lighter' ? 'lighter' : 'source-over', layer: layerOf(o),
        });
      },
      line(o = {}) {
        if (!finiteXY(o) || !Number.isFinite(o.x2 ?? o.x) || !Number.isFinite(o.y2 ?? o.y)) return null;
        return P.spawn(owner, {
          shape: 'line', x: o.x, y: o.y, x2: o.x2 ?? o.x, y2: o.y2 ?? o.y, life: clamp(num(o.life, 10), 1, 120),
          width: clamp(num(o.width, 4), 0.5, 40), color: pickColor(o, defColor()), color2: isColor(o.core) ? o.core : '#ffffff',
          jag: clamp(num(o.jag, 0), 0, 60), seed: (P.rand() * 1e9) | 0, alpha: clamp(num(o.alpha, 1), 0, 1),
          blend: o.blend === 'source-over' ? 'source-over' : 'lighter', layer: layerOf(o),
        });
      },
      text(o = {}) {
        if (!finiteXY(o) || o.text == null) return null;
        return P.spawn(owner, {
          shape: 'text', x: o.x, y: o.y, vx: num(o.vx, 0), vy: num(o.vy, -0.6), drag: 0.97,
          text: String(o.text).slice(0, BUDGET.textLen), size: clamp(num(o.size, 16), 6, 64), life: clamp(num(o.life, 60), 1, 240),
          color: pickColor(o, '#ffffff'), color2: isColor(o.outline) ? o.outline : '#14091e', font: typeof o.font === 'string' ? o.font.slice(0, 60) : null,
          alpha: clamp(num(o.alpha, 1), 0, 1), layer: layerOf(o),
        });
      },
      trail(id, o = {}) {
        if (!finiteXY(o)) return null;
        return P.trail(owner, String(id), o, defColor());
      },
      afterimage(o = {}) {
        if (!finiteXY(o) || !o.image) return null;
        return P.afterimage(owner, o);
      },
      decal(o = {}) {
        if (!finiteXY(o)) return null;
        return P.decal(owner, o, defColor());
      },
      shake(amount = 3) { host.shake?.(clamp(num(amount, 0), 0, BUDGET.shake)); },
      flash(color = '#ffffff', alpha = 0.2, frames = 4) {
        host.flash?.(isColor(color) ? color : '#ffffff', clamp(num(alpha, 0.2), 0, BUDGET.flash), clamp(Math.round(num(frames, 4)), 1, BUDGET.flashFrames));
      },
      sound(name, o = {}) {
        if (typeof name !== 'string' && (typeof name !== 'object' || !name)) return false;
        return host.sound ? !!host.sound(name, { volume: clamp(num(o.volume, 1), 0, 1), pitch: clamp(num(o.pitch, 1), 0.25, 4) }) : false;
      },
      local: null,
    };
    // fx.local.<shape>({x, y, rate, ...}): call every frame; emits `rate` particles/frame at a body point.
    const local = {};
    const emit = (shape, o = {}) => {
      const a = host.anchor?.();
      if (!a) return 0;
      const facing = a.facing < 0 ? -1 : 1, s = num(a.scale, 1);
      const key = `${owner}|${typeof shape === 'string' ? shape : 'fn'}|${num(o.x, 0)}|${num(o.y, 0)}`;
      const acc = (P.accum.get(key) || 0) + clamp(num(o.rate, 0.5), 0, 8);
      const n = Math.floor(acc + 1e-9);   // 0.6 × 10 must emit 6
      P.accum.set(key, acc - n);
      if (!n) return 0;
      const spd = o.speed ?? [0.3, 1.2];
      return P.burst(owner, {
        ...o, shape, count: n, x: a.x + num(o.x, 0) * s * facing, y: a.y + num(o.y, 0) * s,
        speed: spd, angle: o.angle !== undefined ? (facing > 0 ? o.angle : 180 - o.angle) : undefined,
        spread: o.spread ?? (o.angle !== undefined ? 30 : 360),
      }, defColor(), host).length;
    };
    for (const sh of FX_SHAPES) local[sh] = (o) => emit(sh, o);
    local.emit = emit;
    fx.local = local;
    return fx;
  }

  /** fx.burst implementation (also used by engine defaults). Returns the spawned particles. */
  burst(owner, o, defColor = '#ffffff', host = {}) {
    const out = [];
    if (!finiteXY(o)) return out;
    const count = clamp(Math.round(num(o.count, 10)), 0, BUDGET.perCall);
    let shape = o.shape ?? 'spark', draw = null, sprite = null;
    if (typeof shape === 'function') { draw = shape; shape = 'custom'; }
    else if (shape && typeof shape === 'object') { sprite = host.sheet?.(shape.sheet) ? { sheet: host.sheet(shape.sheet), frame: shape.frame | 0 } : null; shape = sprite ? 'sprite' : 'dot'; }
    else if (!FX_SHAPES.includes(shape)) shape = 'dot';
    const colors = Array.isArray(o.colors) && o.colors.length ? o.colors.filter(isColor) : [pickColor(o, defColor)];
    if (!colors.length) colors.push(defColor);
    const preset = SHAPE_DEFAULTS[shape] || SHAPE_DEFAULTS.dot;
    const angle = num(o.angle, 90) * DEG, spread = clamp(num(o.spread, 360), 0, 360) * DEG;
    const blend = o.blend === 'lighter' || o.blend === 'source-over' ? o.blend : preset.blend;
    const fade = o.fade === 'in-out' || o.fade === 'none' ? o.fade : 'out';
    for (let i = 0; i < count; i++) {
      const a = angle + (this.rand() - 0.5) * spread;
      const sp = Math.abs(this.rnd(o.speed ?? preset.speed, 3));
      const size = clamp(this.rnd(o.size ?? preset.size, 4), 0.2, 200);
      out.push(this.spawn(owner, {
        shape, draw, sprite, x: o.x + this.rnd(o.jitter ?? 0, 0) * (this.rand() - 0.5) * 2, y: o.y,
        vx: Math.cos(a) * sp, vy: -Math.sin(a) * sp,
        gravity: clamp(num(o.gravity, preset.gravity), -2, 3), drag: clamp(num(o.drag, preset.drag), 0.5, 1),
        life: clamp(this.rnd(o.life ?? preset.life, 20), 1, 600), size, size2: o.sizeEnd ?? null,
        color: colors[(this.rand() * colors.length) | 0], color2: isColor(o.color2) ? o.color2 : '#ffffff',
        rot: this.rand() * TAU, vr: this.rnd(o.spin ?? preset.spin, 0) * (this.rand() < 0.5 ? -1 : 1),
        alpha: clamp(num(o.alpha, 1), 0, 1), blend, fade, layer: layerOf(o), seed: (this.rand() * 1e9) | 0,
        width: size,
      }));
    }
    return out;
  }

  trail(owner, id, o, defColor) {
    const key = `${owner}|${id}`;
    let r = this.ribbons.get(key);
    if (!r) {
      let mine = 0;
      for (const k of this.ribbons.keys()) if (k.startsWith(`${owner}|`)) mine++;
      if (mine >= BUDGET.ribbonsPerOwner) return null;
      r = { pts: [], life: 7, width: 12, colors: [], blend: 'lighter', glow: true, alpha: 1, touched: 0 };
      this.ribbons.set(key, r);
    }
    const c = pickColor(o, defColor);
    r.colors = Array.isArray(o.colors) && o.colors.length >= 3 ? o.colors.slice(0, 3) : ['#ffffff', c, kit.shade(c, -0.35)];
    r.life = clamp(Math.round(num(o.life, 7)), 2, 60);
    r.width = clamp(num(o.width, 12), 1, 60);
    r.blend = o.blend === 'source-over' ? 'source-over' : 'lighter';
    r.glow = o.glow !== false;
    r.alpha = clamp(num(o.alpha, 1), 0, 1);
    r.touched = this.frame;
    r.pts.push({ x: o.x, y: o.y, t: this.frame });
    if (r.pts.length > BUDGET.ribbonPoints) r.pts.shift();
    return r;
  }

  afterimage(owner, o) {
    let n = 0;
    for (const p of this.list) if (!p.dead && p.shape === 'afterimage') n++;
    if (n >= BUDGET.afterimages) this.killOldest((p) => p.shape === 'afterimage');
    const w = clamp(num(o.w, o.image.width || 64), 1, 2048), h = clamp(num(o.h, o.image.height || 64), 1, 2048);
    let img = o.image;
    // Copy so later redraws of the source canvas don't change the ghost.
    if (this.makeCanvas && o.copy !== false && img.width && img.height) {
      try {
        const c = this.makeCanvas(img.width, img.height);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        if (isColor(o.tint)) { g.globalCompositeOperation = 'source-atop'; g.globalAlpha = clamp(num(o.tintAmount, 0.65), 0, 1); g.fillStyle = o.tint; g.fillRect(0, 0, c.width, c.height); }
        img = c;
      } catch { /* keep the reference */ }
    }
    return this.spawn(owner, {
      shape: 'afterimage', img, x: o.x, y: o.y, w, h, life: clamp(num(o.life, 12), 1, 60),
      alpha: clamp(num(o.alpha, 0.5), 0, 1), blend: o.blend === 'lighter' ? 'lighter' : 'source-over', layer: o.layer === 'front' ? 'front' : 'back',
    });
  }

  decal(owner, o, defColor) {
    let n = 0;
    for (const p of this.list) if (!p.dead && p.shape === 'decal') n++;
    if (n >= BUDGET.decals) this.killOldest((p) => p.shape === 'decal');
    let kind = 'splat', draw = null;
    if (typeof o.shape === 'function') { kind = 'custom'; draw = o.shape; } else if (['splat', 'scorch', 'circle', 'crack'].includes(o.shape)) kind = o.shape;
    return this.spawn(owner, {
      shape: 'decal', data: kind, draw, x: o.x, y: o.y, size: clamp(num(o.r, num(o.size, 24)), 2, 300),
      color: pickColor(o, defColor), alpha: clamp(num(o.alpha, 0.85), 0, 1), life: clamp(num(o.life, BUDGET.decalLife), 1, BUDGET.decalLife),
      seed: (this.rand() * 1e9) | 0, rot: num(o.rot, this.rand() * TAU), flat: o.flat !== false, layer: 'back',
    });
  }

  killOldest(pred) {
    for (const p of this.list) if (!p.dead && pred(p)) { this.kill(p); this.dropped++; return; }
  }
}

// Per-shape defaults for fx.burst when the caller leaves a field out.
const SHAPE_DEFAULTS = {
  spark: { speed: [3, 9], size: [2, 4], life: [10, 20], gravity: 0, drag: 0.88, spin: 0, blend: 'lighter' },
  dot: { speed: [1, 5], size: [2, 4], life: [12, 24], gravity: 0, drag: 0.9, spin: 0, blend: 'lighter' },
  glow: { speed: [0.5, 2], size: [10, 24], life: [10, 20], gravity: 0, drag: 0.9, spin: 0, blend: 'lighter' },
  smoke: { speed: [0.5, 2], size: [8, 16], life: [24, 40], gravity: -0.03, drag: 0.93, spin: 0, blend: 'source-over' },
  debris: { speed: [3, 8], size: [3, 7], life: [30, 50], gravity: 0.4, drag: 0.98, spin: [0.1, 0.35], blend: 'source-over' },
  ring: { speed: [0, 0], size: [30, 60], life: [12, 18], gravity: 0, drag: 1, spin: 0, blend: 'source-over' },
  drip: { speed: [1, 4], size: [2.5, 5], life: [30, 50], gravity: 0.35, drag: 0.99, spin: 0, blend: 'source-over' },
  streak: { speed: [8, 16], size: [2, 4], life: [8, 12], gravity: 0, drag: 0.85, spin: 0, blend: 'lighter' },
  star: { speed: [1, 4], size: [6, 12], life: [14, 24], gravity: 0, drag: 0.92, spin: [0.05, 0.2], blend: 'source-over' },
  shard: { speed: [3, 9], size: [5, 11], life: [30, 44], gravity: 0.35, drag: 0.98, spin: [0.1, 0.4], blend: 'source-over' },
  custom: { speed: [1, 4], size: [4, 10], life: [14, 30], gravity: 0, drag: 0.92, spin: 0, blend: 'source-over' },
  sprite: { speed: [1, 4], size: [1, 1], life: [14, 30], gravity: 0, drag: 0.92, spin: 0, blend: 'source-over' },
};

function finiteXY(o) { return o && Number.isFinite(o.x) && Number.isFinite(o.y); }
function pickColor(o, d) { return isColor(o.color) ? o.color : d; }
function layerOf(o) { return o.layer === 'back' || o.layer === 'front' ? o.layer : undefined; }

function defaultCanvasFactory() {
  if (typeof OffscreenCanvas !== 'undefined') return (w, h) => new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') return (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  return null;
}

function fadeAlpha(p, k) {
  if (p.fade === 'none') return p.alpha;
  if (p.fade === 'in-out') return p.alpha * Math.min(1, (1 - k) * 5, k * 2.5);
  return p.alpha * Math.min(1, k * 1.5);
}

// Draws one particle; ctx state is saved/restored by the caller.
function drawParticle(ctx, p, k, P) {
  const t = 1 - k;
  const size = p.size2 == null ? p.size : p.size + (p.size2 - p.size) * t;
  switch (p.shape) {
    // ── v1 engine shapes (kept pixel-compatible with the v1 Effects look) ──
    case 'flash':
      kit.glow(ctx, p.x, p.y, p.size * (1.4 - k * 0.4), p.color, k * p.alpha);
      break;
    case 'glow':
      kit.glow(ctx, p.x, p.y, size * (0.6 + k * 0.6), p.color, fadeAlpha(p, k) * 0.8);
      break;
    case 'star': {
      const s = size * (0.6 + t * 0.6);
      ctx.globalAlpha = Math.min(1, k * 1.6) * p.alpha;
      kit.starPath(ctx, p.x, p.y, p.points, s, s * 0.32, p.rot);
      ctx.fillStyle = p.color; ctx.fill();
      kit.starPath(ctx, p.x, p.y, p.points, s * 0.6, s * 0.2, p.rot + 0.3);
      ctx.fillStyle = p.color2; ctx.fill();
      break;
    }
    case 'ring': {
      ctx.globalAlpha = k * p.alpha;
      ctx.strokeStyle = p.color; ctx.lineWidth = p.width * k + 1;
      ctx.beginPath();
      if (p.r1) {
        const e = 1 - (1 - t) * (1 - t) * (1 - t);   // ease-out cubic
        const r = p.r0 + (p.r1 - p.r0) * e;
        if (p.flat) ctx.ellipse(p.x, p.y, r, r * 0.3, 0, 0, TAU); else ctx.arc(p.x, p.y, r, 0, TAU);
      } else if (p.flat) ctx.ellipse(p.x, p.y, p.size * (1 - k * 0.7), p.size * 0.3 * (1 - k * 0.7), 0, 0, TAU);
      else ctx.arc(p.x, p.y, p.size * (1 - k * 0.8), 0, TAU);
      ctx.stroke();
      break;
    }
    case 'ellipse':
      ctx.globalAlpha = k * p.alpha;
      ctx.strokeStyle = p.color; ctx.lineWidth = p.width * k + 1;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size * (1.6 - k), p.size * 0.18 * (1.6 - k), 0, 0, TAU); ctx.stroke();
      break;
    case 'dot':
      ctx.globalAlpha = fadeAlpha(p, k);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, size * (0.4 + k * 0.6), 0, TAU); ctx.fill();
      break;
    case 'streak':
      ctx.globalAlpha = k * p.alpha;
      ctx.strokeStyle = p.color; ctx.lineWidth = size; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.5, p.y - p.vy * 2.5); ctx.stroke();
      break;
    case 'smoke': {
      const r = size * (1.3 - k * 0.5);
      ctx.globalAlpha = k * 0.55 * p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      // soft top highlight gives the puff volume
      ctx.globalAlpha = k * 0.22 * p.alpha;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(p.x - r * 0.25, p.y - r * 0.3, r * 0.55, 0, TAU); ctx.fill();
      break;
    }
    case 'shard':
      ctx.globalAlpha = Math.min(1, k * 2) * p.alpha;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      kit.polygonPath(ctx, [[0, -size], [size * 0.4, 0], [0, size * 0.6], [-size * 0.4, 0]]);
      ctx.fillStyle = p.color; ctx.fill(); ctx.strokeStyle = p.color2 || '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      break;
    case 'lines': {
      ctx.globalAlpha = k * 0.9 * p.alpha;
      ctx.strokeStyle = p.color; ctx.lineWidth = 3;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + i;
        const r0 = p.size * (0.35 + t * 0.4), r1 = r0 + p.size * 0.3;
        ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0); ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1); ctx.stroke();
      }
      break;
    }
    case 'beam': {
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      const grow = Math.min(1, t * 6);
      const w = 160 * k + 20;
      ctx.globalCompositeOperation = 'lighter';
      for (const [mul, col, al] of [[1, p.color, 0.55], [0.55, p.color, 0.8], [0.22, p.color2, 1]]) {
        ctx.globalAlpha = al * Math.min(1, k * 2);
        const g = ctx.createLinearGradient(0, 0, p.size * grow, 0);
        g.addColorStop(0, col); g.addColorStop(1, kit.rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(p.size * grow, -w * mul); ctx.lineTo(p.size * grow, w * mul); ctx.closePath(); ctx.fill();
      }
      break;
    }
    // ── v2 shapes ──
    case 'spark': {
      // velocity-aligned capsule with a white-hot core
      const sp = Math.hypot(p.vx, p.vy);
      const len = Math.max(size * 1.5, sp * 2.2);
      const ux = sp > 0.01 ? p.vx / sp : Math.cos(p.rot), uy = sp > 0.01 ? p.vy / sp : Math.sin(p.rot);
      ctx.globalAlpha = fadeAlpha(p, k);
      ctx.lineCap = 'round';
      ctx.strokeStyle = p.color; ctx.lineWidth = size * (0.5 + k * 0.5);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - ux * len, p.y - uy * len); ctx.stroke();
      ctx.strokeStyle = p.color2; ctx.lineWidth = Math.max(0.6, size * 0.35 * k);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - ux * len * 0.5, p.y - uy * len * 0.5); ctx.stroke();
      break;
    }
    case 'debris': {
      ctx.globalAlpha = Math.min(1, k * 3) * p.alpha;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      const r = kit.seeded(p.seed);
      const pts = [];
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; const rr = size * (0.6 + r() * 0.5); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      kit.polygonPath(ctx, pts);
      ctx.fillStyle = p.color; ctx.fill();
      ctx.strokeStyle = kit.shade(p.color, -0.45); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = kit.shade(p.color, 0.3);
      ctx.beginPath(); ctx.arc(-size * 0.2, -size * 0.25, size * 0.25, 0, TAU); ctx.fill();
      break;
    }
    case 'drip': {
      ctx.globalAlpha = Math.min(1, k * 2.5) * p.alpha;
      const sp = Math.hypot(p.vx, p.vy);
      const ang = Math.atan2(p.vy, p.vx) - Math.PI / 2;
      const stretch = 1 + Math.min(1.6, sp * 0.18);
      ctx.translate(p.x, p.y); ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, -size * stretch * 1.4);
      ctx.quadraticCurveTo(size, 0, 0, size);
      ctx.quadraticCurveTo(-size, 0, 0, -size * stretch * 1.4);
      ctx.fillStyle = p.color; ctx.fill();
      ctx.globalAlpha *= 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(-size * 0.3, 0, size * 0.28, 0, TAU); ctx.fill();
      break;
    }
    case 'line': {
      ctx.globalAlpha = fadeAlpha(p, k);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const pts = linePoints(p, P.frame);
      for (const [w, col, al] of [[p.width * 3, p.color, 0.3], [p.width, p.color, 0.9], [Math.max(1, p.width * 0.35), p.color2, 1]]) {
        ctx.globalAlpha = fadeAlpha(p, k) * al;
        ctx.strokeStyle = col; ctx.lineWidth = w;
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      }
      break;
    }
    case 'text': {
      const pop = p.age < 6 ? 1 + (6 - p.age) * 0.08 : 1;
      ctx.globalAlpha = p.alpha * Math.min(1, k * 2.5);
      ctx.translate(p.x, p.y); ctx.scale(pop, pop);
      ctx.font = p.font || `800 ${p.size}px "Bungee", "Rajdhani", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, p.size * 0.28); ctx.strokeStyle = p.color2; ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color; ctx.fillText(p.text, 0, 0);
      break;
    }
    case 'decal': drawDecal(ctx, p, k); break;
    case 'afterimage':
      if (!p.img) break;
      ctx.globalAlpha = p.alpha * k;
      ctx.drawImage(p.img, p.x, p.y, p.w, p.h);
      break;
    case 'sprite': {
      const sh = p.sprite?.sheet;
      if (!sh?.image) break;
      const cols = sh.cols || Math.max(1, Math.floor((sh.image.width || sh.frameW) / sh.frameW));
      const f = p.sprite.frame, sx = (f % cols) * sh.frameW, sy = Math.floor(f / cols) * sh.frameH;
      const sc = (sh.scale || 1) * size;
      const ax = sh.anchor?.[0] ?? sh.frameW / 2, ay = sh.anchor?.[1] ?? sh.frameH / 2;
      ctx.globalAlpha = fadeAlpha(p, k);
      if (sh.pixelated) ctx.imageSmoothingEnabled = false;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(sc, sc);
      ctx.drawImage(sh.image, sx, sy, sh.frameW, sh.frameH, -ax, -ay, sh.frameW, sh.frameH);
      break;
    }
    case 'custom':
      if (typeof p.draw !== 'function') break;
      ctx.globalAlpha = fadeAlpha(p, k);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      p.draw(ctx, { k, t, age: p.age, life: p.life, size, color: p.color, seed: p.seed, vx: p.vx, vy: p.vy, kit });
      break;
    default: break;
  }
}

// Jagged polyline for fx.line (lightning when jag > 0); re-rolls every 2 frames.
function linePoints(p, frame) {
  if (!p.jag) return [[p.x, p.y], [p.x2, p.y2]];
  const r = mulberry32(hash32(`${p.seed}:${frame >> 1}`));
  const dx = p.x2 - p.x, dy = p.y2 - p.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const segs = clamp(Math.round(len / 18), 2, 24);
  const pts = [[p.x, p.y]];
  for (let i = 1; i < segs; i++) {
    const f = i / segs, off = (r() - 0.5) * 2 * p.jag * Math.sin(f * Math.PI);
    pts.push([p.x + dx * f + nx * off, p.y + dy * f + ny * off]);
  }
  pts.push([p.x2, p.y2]);
  return pts;
}

function drawDecal(ctx, p, k) {
  // Holds, then fades over the last third of its life (≤ 3 s total).
  ctx.globalAlpha = p.alpha * Math.min(1, k * 3);
  ctx.translate(p.x, p.y);
  if (p.flat) ctx.scale(1, 0.32);
  ctx.rotate(p.rot);
  const s = p.size;
  const r = kit.seeded(p.seed);
  switch (p.data) {
    case 'custom': p.draw?.(ctx, { k, size: s, color: p.color, seed: p.seed, kit }); break;
    case 'scorch': {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
      g.addColorStop(0, kit.rgba('#1a1010', 0.85)); g.addColorStop(0.6, kit.rgba(p.color, 0.35)); g.addColorStop(1, kit.rgba(p.color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
      break;
    }
    case 'circle':
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.fill();
      break;
    case 'crack': {
      ctx.strokeStyle = p.color; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        let a = (i / 6) * TAU + r(), x = 0, y = 0;
        ctx.beginPath(); ctx.moveTo(0, 0);
        for (let j = 0; j < 3; j++) { a += (r() - 0.5) * 0.9; const l = s * (0.25 + r() * 0.2); x += Math.cos(a) * l; y += Math.sin(a) * l; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      break;
    }
    default: { // splat: blob + satellite droplets + glossy highlight
      ctx.fillStyle = p.color;
      const pts = [];
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; const rr = s * (0.65 + r() * 0.45); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      kit.blobPath(ctx, pts); ctx.fill();
      for (let i = 0; i < 5; i++) { const a = r() * TAU, d = s * (1.1 + r() * 0.6); ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, s * (0.08 + r() * 0.12), 0, TAU); ctx.fill(); }
      ctx.globalAlpha *= 0.35; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(-s * 0.25, -s * 0.25, s * 0.3, s * 0.16, -0.5, 0, TAU); ctx.fill();
      break;
    }
  }
}
