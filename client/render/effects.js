// Event-driven world effects (spec §6.4, §4.2.12) on top of the pooled particle system.
//
//   const fx = new Effects();                       // one per match (renderer)
//   fx.attach({ audio, fighter: (id) => ({ color, art, palette, character, info?, anchor?, assets? }) });
//   fx.observe(view);                               // each rendered snapshot (positions for gov pops)
//   fx.handleEvents(events);                        // sim events → defaults / art.fx hooks / sounds
//   fx.update(); fx.draw(ctx, 'back'); … fx.draw(ctx, 'front');
//   fx.fxFor(id)                                    // the per-fighter `fx` API for info.fx
//
// Every engine event has a default. When the character's art defines the matching
// art.fx hook (onHit, onHurt, onLand, onJump, onKO, onRespawn, onFormChange, onMove[name],
// onEvent[name]) the hook replaces the default *flavor* layer (colored sparks, dust…);
// the engine *core* layer (impact flash, shake, hit-stop pops, governor feedback) always
// plays so every hit stays readable. A hook that returns true keeps the defaults too.
// Hooks that throw are logged once; three throws disable that character's hooks.
//
// The v1 methods (hit, shieldHit, dust, ko, …, shake/flash/zoomPunch fields) keep their
// signatures so the existing renderer works unchanged.
import * as kit from '../../shared/art/kit.js';
import { Particles } from './particles.js';

export const EFFECT_COLORS = {
  punch: ['#ffffff', '#ffe08a', '#ff9a3a'],
  kick: ['#ffffff', '#ffd27a', '#ff7a3a'],
  slash: ['#ffffff', '#bfe8ff', '#5aa8ff'],
  fire: ['#fff3b0', '#ff8a2a', '#d6281c'],
  ice: ['#ffffff', '#a8f2ff', '#4aa0ff'],
  electric: ['#ffffff', '#fff36b', '#5ad8ff'],
  magic: ['#ffe8ff', '#d48aff', '#7b5cff'],
  water: ['#effcff', '#6ad0ff', '#2a7bd6'],
  wind: ['#ffffff', '#d0fff2', '#7ae0c8'],
  dark: ['#e6ccff', '#8a3ad8', '#2a0a4a'],
  light: ['#ffffff', '#fff6c8', '#ffd36b'],
  poison: ['#f0ffc0', '#9ae05a', '#7a3ab8'],
  earth: ['#fff0d0', '#c89a60', '#6a4a30'],
  none: ['#ffffff', '#e0e0e0', '#a0a0a0'],
};
/** The 14 v1 preset names (open vocabulary: anything else falls back by color). */
export const EFFECT_NAMES = Object.freeze(Object.keys(EFFECT_COLORS));

const isColor = (c) => typeof c === 'string' && c.length > 2 && c.length < 64;
const tri = (c) => ['#ffffff', c, kit.shade(c, -0.35)];
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const TAU = Math.PI * 2;

/** v1 helper (kept for renderer callers): preset colors, or a 3-tone ramp of `override`. */
export function effectColors(effect, override) {
  const base = EFFECT_COLORS[effect] || EFFECT_COLORS.punch;
  if (!isColor(override)) return base;
  return tri(override);
}

/**
 * Open effect vocabulary. Colors: move/hitbox color → preset → palette.effect → punch.
 * Flavor (the particle recipe) follows the name when it is a preset, else 'punch'.
 * @returns {{name: string, flavor: string, preset: boolean, colors: string[], source: string}}
 */
export function resolveEffect(name, { color, palette } = {}) {
  const preset = typeof name === 'string' && Object.prototype.hasOwnProperty.call(EFFECT_COLORS, name);
  const flavor = preset ? name : 'punch';
  const out = (colors, source) => ({ name: typeof name === 'string' ? name : 'punch', flavor, preset, colors, source });
  if (isColor(color)) return out(tri(color), 'move');
  if (preset) return out(EFFECT_COLORS[name], 'preset');
  if (isColor(palette?.effect)) return out(tri(palette.effect), 'palette');
  return out(EFFECT_COLORS.punch, 'default');
}

/** Effect name of a hit event: the hitbox effect when set, else the move's. */
export function hitEffectName(e) {
  return typeof e.fx === 'string' && e.fx && e.fx !== 'normal' ? e.fx : (e.effect || 'punch');
}

// Governor rules → feedback kind (§4.2.12). 'speed' (absolute launch cap) has no visual.
export const GOV_FEEDBACK = Object.freeze({
  perHit: 'trim', rate: 'trim', mitigation: 'trim', koFloor: 'trim', shieldRate: 'trim', dotTotal: 'trim',
  stall: 'tired', longAir: 'tired', rise: 'tired',
  intangible: 'crack', armor: 'crack',
  controlCap: 'resist', controlDR: 'resist', controlTotal: 'resist', grabImmune: 'resist',
});
const TRIM_TAGS = new Set(['perHit', 'rate', 'mitigation', 'koFloor']);
const ENGINE = '__engine';

export class Effects {
  /**
   * @param {object} [o]
   * @param {number} [o.seed]           visual rng seed
   * @param {Particles} [o.particles]   share a particle system (Lab)
   * @param {object} [o.host]           same as attach(host)
   */
  constructor(o = {}) {
    this.particles = o.particles || new Particles({ seed: o.seed });
    this.rand = this.particles.rand;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.flashHold = 0;
    this.zoomPunch = 0;
    this.host = null;
    this.audio = null;
    this.pos = new Map();       // id → {x, y, facing, h, scale} from observe()/events
    this.apis = new Map();      // id → fx API
    this.hud = new Map();       // id → HUD feedback {armor, breakT, tired, crack, resist, trims[], flashColor}
    this.hookErrors = new Map();
    this.govLog = [];           // recent gov events (training ticker / Lab)
    this.throttle = new Map();
    this.frame = 0;
    if (o.host) this.attach(o.host);
  }

  get parts() { return this.particles.list; }   // v1 compat (length checks)

  /** Engine-owned fx API (rings/lines for defaults). */
  get efx() { return this._efx || (this._efx = this.particles.api(ENGINE)); }

  attach(host = {}) {
    this.host = host;
    this.audio = host.audio || this.audio;
    this.apis.clear();
    return this;
  }

  lookup(id) {
    if (id == null || !this.host?.fighter) return null;
    try { return this.host.fighter(id) || null; } catch { return null; }
  }

  /** Records fighter positions from a snapshot view (for anchors and gov pops). */
  observe(view) {
    for (const f of view?.fighters || []) {
      const F = this.lookup(f.id);
      this.pos.set(f.id, { x: f.x, y: f.y, facing: f.facing || 1, h: heightOf(F) * num(f.bs, 1), scale: num(f.bs, 1), dead: f.state === 'dead' || !!f.eliminated });
    }
  }

  where(id) {
    const F = this.lookup(id);
    const a = F?.anchor?.();
    if (a && Number.isFinite(a.x)) return { x: a.x, y: a.y, facing: a.facing || 1, h: heightOf(F) * num(a.scale, 1), scale: num(a.scale, 1) };
    return this.pos.get(id) || null;
  }

  hudState(id) {
    let s = this.hud.get(id);
    if (!s) { s = { armor: 0, breakT: 0, tired: 0, crack: 0, resist: 0, trims: [] }; this.hud.set(id, s); }
    return s;
  }

  // ── The per-fighter fx API ────────────────────────────────────────────────
  fxFor(id) {
    let api = this.apis.get(id);
    if (api) return api;
    const self = this;
    api = this.particles.api(id, {
      anchor: () => self.where(id),
      sound: (name, o) => self.charSound(id, name, o),
      shake: (a) => { self.shake = Math.max(self.shake, a); },
      flash: (color, alpha, frames) => { self.flash = Math.max(self.flash, alpha / 0.6); self.flashColor = color; self.flashHold = Math.max(self.flashHold, frames); },
      sheet: (name) => sheetOf(self.lookup(id), name),
      get color() { const F = self.lookup(id); return F?.palette?.effect || F?.art?.palette?.effect || F?.color || '#ffffff'; },
    });
    this.apis.set(id, api);
    return api;
  }

  charSound(id, key, o = {}) {
    const a = this.audio;
    if (!a?.charSound) return false;
    const F = this.lookup(id);
    return a.charSound(id, key, { art: F?.art, assets: F?.assets || F?.info?.assets, volume: o.volume, pitch: o.pitch }) === 'played';
  }

  /** Engine default sound unless art.sounds maps `key` (null mutes; a mapping replaces it). */
  sound(id, key, fallback) {
    const F = this.lookup(id);
    const map = F?.art?.sounds;
    if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, key)) { this.charSound(id, key); return; }
    if (this.audio && fallback) fallback(this.audio);
  }

  /** Runs art.fx[name] (or art.fx[name][sub]). Returns 'none' | 'replaced' | 'both'. */
  hook(id, name, ev, sub) {
    const F = this.lookup(id);
    const h = F?.art?.fx;
    if (!h || typeof h !== 'object') return 'none';
    const fn = sub !== undefined ? h[name]?.[sub] : h[name];
    if (typeof fn !== 'function') return 'none';
    const errs = this.hookErrors.get(id) || 0;
    if (errs >= 3) return 'none';
    try {
      const r = fn.call(h, this.fxFor(id), ev, F.info || this.minimalInfo(F));
      return r === true ? 'both' : 'replaced';
    } catch (err) {
      this.hookErrors.set(id, errs + 1);
      if (!errs) console.error(`fx hook ${name}${sub ? `.${sub}` : ''} failed for ${F?.character?.id || id}:`, err);
      return 'none';
    }
  }

  minimalInfo(F) {
    return { kit, palette: F?.palette || F?.art?.palette || {}, time: this.frame / 60, simFrame: this.frame, fx: null, quality: this.particles.quality, rng: this.rand };
  }

  // ── Event routing ─────────────────────────────────────────────────────────
  /** Routes sim events to effects and sounds. `audio` overrides the attached one. */
  handleEvents(events, audio) {
    if (audio !== undefined) this.audio = audio;
    for (const e of events || []) {
      try { this.handle(e); } catch (err) { if (!this.warned) { this.warned = true; console.error('fx event failed', e?.type, err); } }
    }
  }

  handle(e) {
    const A = this.audio;
    switch (e.type) {
      case 'hit': return this.onHit(e);
      case 'shieldhit': {
        const F = this.lookup(e.id);
        this.shieldHit(e, F?.color || '#ffffff');
        this.sound(e.id, 'shield', (a) => a.shield());
        return;
      }
      case 'shieldbreak': this.shieldBreak(e, this.lookup(e.id)?.color || '#ffffff'); this.sound(e.id, 'shieldbreak', (a) => a.shieldBreak()); return;
      case 'clank': this.clank(e); A?.clank(); return;
      case 'fizzle': this.fizzle(e, resolveEffect(e.effect, { color: e.color }).colors); return;
      case 'jump': case 'doublejump': {
        const dbl = e.type === 'doublejump';
        const h = this.hook(e.id, 'onJump', { ...e, double: dbl });
        if (h !== 'replaced') { if (dbl) this.doubleJump(e.x, e.y, '#ffffff'); else { this.dust(e.x, e.y, 5, 0.8); this.jumpRing(e.x, e.y, '#ffffff'); } }
        // doublejump uses its own mapping, else the `jump` mapping, else the engine blip
        const map = this.lookup(e.id)?.art?.sounds;
        const key = dbl && !(map && Object.prototype.hasOwnProperty.call(map, 'doublejump')) ? 'jump' : e.type;
        this.sound(e.id, key, (a) => a.jump(dbl ? 1.25 : 1));
        return;
      }
      case 'land': {
        const h = this.hook(e.id, 'onLand', e);
        if (h !== 'replaced') this.dust(e.x, e.y, e.heavy ? 9 : 5, e.heavy ? 1.2 : 0.8);
        if (e.heavy) this.sound(e.id, 'land', (a) => a.land());
        return;
      }
      case 'bounce': this.dust(e.x, e.y, 10, 1.4); this.shake = Math.max(this.shake, 6); this.sound(e.id, 'bounce', (a) => a.land()); return;
      case 'step': if (this.rand() < 0.5) this.dust(e.x, e.y, 1, 0.5); return;
      case 'ledge': this.dust(e.x, e.y, 3, 0.6); return;
      case 'dodge': this.sound(e.id, 'dodge', (a) => a.whoosh(0.6)); return;
      case 'move': return this.onMove(e);
      case 'projectile': this.sound(e.id, 'projectile', (a) => a.shoot(e.effect)); return;
      case 'ko': {
        const F = this.lookup(e.id);
        const col = F?.color || '#ffffff';
        this.koCore(e, col);
        if (this.hook(e.id, 'onKO', e) !== 'replaced') this.koFlavor(e, col);
        this.sound(e.id, 'ko', (a) => a.ko());
        return;
      }
      case 'respawn': {
        if (this.hook(e.id, 'onRespawn', e) !== 'replaced') this.respawn(e.x, e.y, this.lookup(e.id)?.color || '#ffffff');
        this.sound(e.id, 'respawn', null);
        return;
      }
      case 'form': {
        const p = this.where(e.id);
        const ev = { ...e, x: e.x ?? p?.x ?? 0, y: e.y ?? p?.y ?? 0 };
        if (this.hook(e.id, 'onFormChange', ev) !== 'replaced') this.formChange(ev, this.fighterColor(e.id));
        this.sound(e.id, 'form', (a) => a.preset('whoosh', { volume: 0.8, pitch: 0.8 }));
        return;
      }
      case 'fx': {
        const p = this.where(e.id);
        const ev = { ...e, x: e.x ?? p?.x ?? 0, y: e.y ?? p?.y ?? 0, data: e.data ?? {} };
        this.hook(e.id, 'onEvent', ev, e.name);
        // A custom event also plays art.sounds[name] when mapped.
        const F = this.lookup(e.id);
        if (F?.art?.sounds && Object.prototype.hasOwnProperty.call(F.art.sounds, e.name)) this.charSound(e.id, e.name);
        return;
      }
      case 'sfx': this.charSound(e.id, e.name); return;
      case 'camera': this.shake = Math.max(this.shake, Math.min(8, num(e.shake, 0))); return;
      case 'armor': return this.armorFlash(e);
      case 'break': return this.breakPop(e);
      case 'gov': return this.onGov(e);
      case 'counter': return this.counterPop(e);
      case 'reflect': return this.reflectGlint(e);
      case 'absorb': return this.absorbSwirl(e);
      case 'grab': this.sound(e.id ?? e.attacker, 'grab', (a) => a.preset('zip', { volume: 0.5, pitch: 0.7, bus: 'char' })); return;
      case 'throw': this.sound(e.id ?? e.attacker, 'throw', (a) => a.whoosh(1.1)); return;
      case 'status': return this.onStatus(e);
      default: return undefined;
    }
  }

  fighterColor(id) {
    const F = this.lookup(id);
    return F?.palette?.effect || F?.art?.palette?.effect || F?.color || '#ffffff';
  }

  onHit(e) {
    const att = this.lookup(e.attacker);
    const name = hitEffectName(e);
    const fx = resolveEffect(name, { color: e.color, palette: att?.palette || att?.art?.palette });
    const trimmed = Array.isArray(e.gov) && e.gov.some((g) => TRIM_TAGS.has(g));
    this.hitCore(e, fx.colors, trimmed);
    const h = this.hook(e.attacker, 'onHit', e);
    if (h !== 'replaced') this.hitFlavor(e, fx, trimmed);
    this.hook(e.target, 'onHurt', e);
    const hs = this.hudState(e.target);
    hs.shake = 12 + num(e.damage, 0);
    if (trimmed) this.resisted(e);
    // sounds: attacker's `hit` mapping replaces the impact; target may add a `hurt` sound
    const map = att?.art?.sounds;
    if (map && Object.prototype.hasOwnProperty.call(map, 'hit')) { this.charSound(e.attacker, 'hit'); this.audio?.duck?.(); }
    else this.audio?.hit(num(e.damage, 0), num(e.kb, 0), fx.flavor);
    const tmap = this.lookup(e.target)?.art?.sounds;
    if (tmap && Object.prototype.hasOwnProperty.call(tmap, 'hurt')) this.charSound(e.target, 'hurt');
    if (trimmed) this.audio?.resisted?.();
  }

  onMove(e) {
    const F = this.lookup(e.id);
    const name = e.name || e.slot;
    const p = this.where(e.id);
    const ev = p ? { ...e, x: e.x ?? p.x, y: e.y ?? p.y } : e;
    this.hook(e.id, 'onMove', ev, name);
    const map = F?.art?.sounds;
    if (map && Object.prototype.hasOwnProperty.call(map, name)) { this.charSound(e.id, name); return; }
    const def = F?.character?.moves?.[name];
    if (def?.sound != null && def.sound !== false) { this.charSound(e.id, def.sound); return; }
    if (map && Object.prototype.hasOwnProperty.call(map, 'move')) { this.charSound(e.id, 'move'); return; }
    this.audio?.whoosh(String(e.slot || '').includes('Smash') ? 1.2 : 0.8);
  }

  onStatus(e) {
    if (!e.on) return;
    const p = this.where(e.target);
    if (!p) return;
    const F = this.lookup(e.target);
    const def = F?.character?.statuses?.[e.name] ?? (e.by != null ? this.lookup(e.by)?.character?.statuses?.[e.name] : null); // custom status from its source
    const col = isColor(def?.tint) ? def.tint : STATUS_TINTS[e.name] || '#d8c8ff';
    const P = this.particles, y = p.y - p.h * 0.55;
    P.burst(ENGINE, { x: p.x, y, count: 10, shape: 'dot', color: col, speed: [1, 3], life: [16, 26], size: [2, 4], blend: 'lighter', jitter: 20 });
    this.efx.ring({ x: p.x, y, r0: p.h * 0.2, r1: p.h * 0.6, color: col, life: 14, width: 3 });
  }

  onGov(e) {
    this.govLog.push({ frame: this.frame, rule: e.rule, who: e.who, target: e.target, amount: e.amount });
    if (this.govLog.length > 60) this.govLog.shift();
    const kind = GOV_FEEDBACK[e.rule];
    if (!kind) return;
    if (kind === 'trim') {
      // Hit trims arrive with the hit event (hit.gov); others (dot, shield) pop here.
      if (e.rule === 'dotTotal' || e.rule === 'shieldRate') {
        const id = e.target ?? e.who, p = this.where(id);
        if (p && this.gate(`trim:${id}`, 20)) this.resisted({ x: p.x, y: p.y - p.h * 0.6, target: id, damage: null });
      }
      return;
    }
    const id = kind === 'resist' ? (e.target ?? e.who) : e.who;
    const p = this.where(id);
    if (!p || p.dead) return;
    if (kind === 'tired' && this.gate(`tired:${id}`, 90)) this.tiredPuff(id, p);
    else if (kind === 'crack' && this.gate(`crack:${id}`, 24)) this.crackFlicker(id, p);
    else if (kind === 'resist' && this.gate(`resist:${id}`, 45)) {
      this.hudState(id).resist = 40;
      this.pop(p.x, p.y - p.h - 18, 'RESISTED', { size: 15, color: '#c9c3d6', outline: '#2a2238', life: 40, rise: 0.8 });
    }
  }

  gate(key, frames) {
    const last = this.throttle.get(key);
    if (last !== undefined && this.frame - last < frames) return false;
    this.throttle.set(key, this.frame);
    return true;
  }

  // ── Hits ─────────────────────────────────────────────────────────────────
  /** Engine core of a hit: impact flash, launch ring, streaks, shake (always plays). */
  hitCore(e, colors, trimmed = false) {
    const power = Math.min(1, num(e.kb, 0) / 140);
    const big = num(e.kb, 0) > 110 && !e.armored;
    const rad = (num(e.angle, 45) * Math.PI) / 180;
    const dir = e.dir || 1;
    const dx = Math.cos(rad) * dir, dy = -Math.sin(rad);
    const c0 = trimmed ? '#e8e4f0' : colors[0], c1 = trimmed ? '#a9a3b8' : colors[1];
    this.add({ type: 'flash', x: e.x, y: e.y, life: 6, size: 30 + power * 60, color: c0, additive: true });
    this.add({ type: 'ring', x: e.x, y: e.y, life: 14, size: 20 + power * 80, color: c1, width: 6 + power * 6 });
    if (!e.armored) {
      for (let i = 0; i < 4 + power * 6; i++) {
        this.add({ type: 'streak', x: e.x, y: e.y, vx: dx * (12 + this.rand() * 14), vy: dy * (12 + this.rand() * 14), drag: 0.85, life: 10, size: 2 + power * 3, color: c0, additive: true });
      }
    }
    if (big) {
      this.add({ type: 'ring', x: e.x, y: e.y, life: 22, size: 220, color: trimmed ? '#8a849a' : colors[2], width: 12 });
      this.add({ type: 'lines', x: e.x, y: e.y, life: 14, size: 260, color: '#ffffff' });
      this.flash = 0.35; this.flashColor = c1;
      this.zoomPunch = 0.06;
    }
    this.shake = Math.max(this.shake, 3 + num(e.damage, 0) * 0.7 + (big ? 14 : 0));
  }

  /** Flavor layer of a hit: the star, sparks and the effect's signature particles. */
  hitFlavor(e, fx, trimmed = false) {
    const colors = trimmed ? ['#f4f2f8', '#b8b2c6', '#6e6880'] : fx.colors;
    const power = Math.min(1, num(e.kb, 0) / 140);
    const big = num(e.kb, 0) > 110;
    const dmg = num(e.damage, 0);
    const rad = (num(e.angle, 45) * Math.PI) / 180;
    const dir = e.dir || 1;
    const dx = Math.cos(rad) * dir, dy = -Math.sin(rad);
    this.add({ type: 'star', x: e.x, y: e.y, life: 9 + power * 6, size: 26 + dmg * 2.4 + power * 40, color: colors[1], color2: colors[0], rot: this.rand() * 6, points: 8 + Math.floor(power * 4) });
    const n = 10 + Math.floor(dmg * 1.4);
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dy, dx) + (this.rand() - 0.5) * (big ? 1.2 : 2.4);
      const sp = 4 + this.rand() * 10 * (0.5 + power);
      this.add({ type: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.88, life: 12 + this.rand() * 12, size: 2 + this.rand() * 3, color: colors[this.rand() < 0.5 ? 1 : 0], additive: true });
    }
    if (!trimmed) FLAVORS[fx.flavor]?.(this, e, colors, { power, big, dmg, dx, dy });
  }

  /** v1 entry point: renderer passes preset/palette colors; a move color on the event wins. */
  hit(e, colors) {
    const fx = resolveEffect(hitEffectName(e), { color: e.color });
    const cols = isColor(e.color) || !colors ? fx.colors : colors;
    const trimmed = Array.isArray(e.gov) && e.gov.some((g) => TRIM_TAGS.has(g));
    this.hitCore(e, cols, trimmed);
    this.hitFlavor(e, { ...fx, colors: cols }, trimmed);
    if (trimmed) this.resisted(e);
  }

  // ── Governor feedback (§4.2.12) ───────────────────────────────────────────
  /** Grey damage number + a dull "resisted" spark. */
  resisted(e) {
    const P = this.particles;
    const x = e.x, y = e.y;
    P.burst(ENGINE, { x, y, count: 7, shape: 'shard', colors: ['#bdb7c9', '#8f889e'], speed: [2, 5], life: [16, 24], size: [3, 5], gravity: 0.3, color2: '#ece8f4' });
    this.efx.ring({ x, y, r0: 6, r1: 34, color: '#c9c3d6', life: 12, width: 3 });
    if (e.damage != null) this.pop(x + (this.rand() - 0.5) * 16, y - 26, `${fmt(e.damage)}%`, { size: 20, color: '#aaa4b6', outline: '#2a2238', life: 46, rise: 1.1, sub: 'resisted' });
    if (e.target != null) {
      const hs = this.hudState(e.target);
      hs.trims.push({ amount: e.damage, t: 50 });
      if (hs.trims.length > 3) hs.trims.shift();
    }
  }

  /** Armor: metallic sheen over the body + silver glints + clink. */
  armorFlash(e) {
    const id = e.id ?? e.target;
    const p = this.where(id);
    this.hudState(id).armor = 18;
    this.audio?.armor?.();
    if (!p) return;
    const P = this.particles;
    const w = Math.max(30, p.h * 0.55), h = p.h;
    const cx = p.x, cy = p.y - h / 2;
    P.spawn(ENGINE, {
      shape: 'custom', x: cx, y: cy, life: 14, layer: 'front', blend: 'lighter', fade: 'none', alpha: 1,
      draw: (ctx, q) => drawSheen(ctx, w, h, q.t),
    });
    for (let i = 0; i < 3; i++) {
      P.spawn(ENGINE, {
        shape: 'star', x: cx + (this.rand() - 0.5) * w, y: cy + (this.rand() - 0.5) * h * 0.8, life: 12 + i * 3, size: 9 + this.rand() * 6,
        color: '#f4f8ff', color2: '#ffffff', points: 4, rot: 0, layer: 'front', blend: 'lighter',
      });
    }
    P.burst(ENGINE, { x: cx, y: cy, count: 8, shape: 'spark', colors: ['#dfe7f2', '#9fb0c4'], speed: [3, 7], life: [8, 14], size: [1.5, 3], blend: 'lighter' });
  }

  /** BREAK!: shattered combo ring + big pop at the target. */
  breakPop(e) {
    const id = e.target ?? e.id;
    const p = this.where(id);
    const hs = this.hudState(id);
    hs.breakT = 70;
    this.audio?.breakSting?.();
    if (!p) return;
    const P = this.particles, cy = p.y - p.h * 0.55;
    const pal = ['#ffffff', '#7af0ff', '#ff5ad1'];
    this.efx.ring({ x: p.x, y: cy, r0: p.h * 0.3, r1: p.h * 1.5, color: '#7af0ff', life: 18, width: 7, blend: 'lighter' });
    P.burst(ENGINE, { x: p.x, y: cy, count: 18, shape: 'shard', colors: pal, speed: [4, 10], life: [24, 36], size: [5, 10], gravity: 0.25, color2: '#ffffff' });
    P.burst(ENGINE, { x: p.x, y: cy, count: 14, shape: 'spark', colors: pal, speed: [6, 12], life: [10, 16], size: [2, 3.5], blend: 'lighter' });
    this.pop(p.x, cy - p.h * 0.7, 'BREAK!', { size: 34, color: '#ffffff', fill2: '#7af0ff', outline: '#1a0a26', life: 60, rise: 0.5, tilt: -0.08, big: true });
    this.shake = Math.max(this.shake, 6);
    this.flash = Math.max(this.flash, 0.2); this.flashColor = '#bff8ff';
  }

  /** Exhausted stall/rise budget: grey puffs + sweat drops + "too tired". */
  tiredPuff(id, p) {
    this.hudState(id).tired = 60;
    this.audio?.tired?.();
    const P = this.particles, top = p.y - p.h - 6;
    P.burst(ENGINE, { x: p.x, y: top, count: 6, shape: 'smoke', colors: ['#b9b4c4', '#9c97a8'], speed: [0.4, 1.4], angle: 90, spread: 140, life: [28, 40], size: [7, 12], gravity: -0.04 });
    P.burst(ENGINE, { x: p.x, y: top + 8, count: 3, shape: 'drip', colors: ['#bfe6ff'], speed: [1.5, 3], angle: 90, spread: 120, life: [24, 32], size: [2.5, 3.5], gravity: 0.25 });
    this.pop(p.x, top - 16, 'too tired', { size: 15, color: '#e6e0f0', outline: '#2a2238', life: 50, rise: 0.6, italic: true });
  }

  /** Denied intangibility/armor grant: a cracked-glass flicker over the body. */
  crackFlicker(id, p) {
    this.hudState(id).crack = 16;
    const P = this.particles, cy = p.y - p.h * 0.5, seed = (this.rand() * 1e9) | 0;
    P.spawn(ENGINE, {
      shape: 'custom', x: p.x, y: cy, life: 16, layer: 'front', blend: 'lighter', fade: 'none', alpha: 1, seed,
      draw: (ctx, q) => drawCrack(ctx, p.h * 0.45, q, seed),
    });
  }

  counterPop(e) {
    const id = e.id ?? e.target ?? e.who;
    const p = this.where(id);
    if (!p) return;
    const P = this.particles, cy = p.y - p.h * 0.55;
    this.efx.ring({ x: p.x, y: cy, r0: p.h * 0.8, r1: p.h * 0.2, color: '#ffffff', life: 10, width: 5, blend: 'lighter' });
    P.spawn(ENGINE, { shape: 'flash', x: p.x, y: cy, life: 8, size: p.h, color: '#fff6c8', blend: 'lighter' });
    this.pop(p.x, cy - p.h * 0.7, 'COUNTER!', { size: 24, color: '#fff6c8', outline: '#1a0a26', life: 44, rise: 0.6 });
    this.audio?.preset?.('clank', { volume: 0.9, pitch: 1.3, bus: 'hit' });
    this.shake = Math.max(this.shake, 4);
  }

  reflectGlint(e) {
    const x = num(e.x, this.where(e.id)?.x ?? 0), y = num(e.y, (this.where(e.id)?.y ?? 0) - 50);
    const P = this.particles;
    P.spawn(ENGINE, { shape: 'star', x, y, life: 12, size: 26, color: '#bff4ff', color2: '#ffffff', points: 6, rot: 0, blend: 'lighter' });
    this.efx.ring({ x, y, r0: 8, r1: 46, color: '#bff4ff', life: 12, width: 4, blend: 'lighter' });
    this.audio?.preset?.('chime', { volume: 0.5, pitch: 1.5, bus: 'hit' });
  }

  absorbSwirl(e) {
    const x = num(e.x, this.where(e.id)?.x ?? 0), y = num(e.y, (this.where(e.id)?.y ?? 0) - 50);
    const P = this.particles;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU, r = 46;
      P.spawn(ENGINE, { shape: 'dot', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: -Math.cos(a) * 3.6, vy: -Math.sin(a) * 3.6, drag: 0.94, life: 13, size: 3, color: '#9affc8', blend: 'lighter' });
    }
    this.audio?.preset?.('gulp', { volume: 0.6, bus: 'hit' });
  }

  formChange(e, color) {
    const p = this.where(e.id);
    const h = p?.h || 90, cy = e.y - h * 0.5;
    const P = this.particles;
    P.spawn(ENGINE, { shape: 'flash', x: e.x, y: cy, life: 10, size: h * 1.3, color, blend: 'lighter' });
    this.efx.ring({ x: e.x, y: cy, r0: h * 0.2, r1: h * 1.1, color, life: 16, width: 5 });
    P.burst(ENGINE, { x: e.x, y: cy, count: 22, shape: 'spark', colors: [color, '#ffffff'], speed: [3, 8], life: [12, 22], size: [2, 3.5], blend: 'lighter' });
    P.burst(ENGINE, { x: e.x, y: e.y - 6, count: 6, shape: 'smoke', color: '#f2e2cf', speed: [0.6, 2], angle: 90, spread: 160, life: [24, 34], size: [8, 14] });
  }

  /** Stylized world-space text pop (grey numbers, BREAK!, too tired…). */
  pop(x, y, text, o = {}) {
    const P = this.particles;
    const size = num(o.size, 18), rise = num(o.rise, 0.8);
    const str = String(text).slice(0, 24);
    return P.spawn(ENGINE, {
      shape: 'custom', x, y, vx: 0, vy: -rise, drag: 0.95, life: num(o.life, 45), layer: 'front', fade: 'none', alpha: 1, rot: num(o.tilt, 0),
      draw: (ctx, q) => drawPopText(ctx, str, size, q, o),
    });
  }

  // ── v1 spawners (kept; world-space) ───────────────────────────────────────
  /** Adds a v1-style particle record {type, x, y, vx, vy, life, size, color, additive, …}. */
  add(p) {
    const shape = p.type === 'spark' ? 'dot' : p.type;   // v1 sparks are round dots
    const behind = p.type === 'smoke' || p.type === 'beam';
    return this.particles.spawn(ENGINE, {
      shape, x: p.x, y: p.y, vx: p.vx || 0, vy: p.vy || 0, gravity: p.gravity || 0, drag: p.drag ?? 1,
      rot: p.rot || 0, vr: p.vr || 0, life: p.life, size: p.size ?? 4, width: p.width ?? 4,
      color: p.color || '#ffffff', color2: p.color2 || '#ffffff', points: p.points ?? 8, flat: !!p.flat,
      blend: p.additive ? 'lighter' : 'source-over', layer: behind ? 'back' : 'front', alpha: 1, fade: 'out',
      r0: 0, r1: 0, size2: null,
    });
  }

  shieldHit(e, color) {
    this.add({ type: 'ring', x: e.x, y: e.y, life: 10, size: 40, color, width: 5 });
    for (let i = 0; i < 8; i++) {
      const a = this.rand() * TAU;
      this.add({ type: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, drag: 0.85, life: 10, size: 2.5, color, additive: true });
    }
    this.shake = Math.max(this.shake, 2);
  }

  shieldBreak(e, color) {
    for (let i = 0; i < 26; i++) {
      const a = this.rand() * TAU, sp = 3 + this.rand() * 9;
      this.add({ type: 'shard', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, gravity: 0.35, life: 40, size: 6 + this.rand() * 8, color, vr: (this.rand() - 0.5) * 0.5, rot: a });
    }
    this.add({ type: 'ring', x: e.x, y: e.y, life: 24, size: 160, color: '#ffffff', width: 10 });
    this.shake = 12;
    this.flash = 0.3; this.flashColor = '#ffffff';
  }

  clank(e) {
    this.add({ type: 'star', x: e.x, y: e.y, life: 8, size: 30, color: '#ffffff', color2: '#ffe08a', rot: 0, points: 4 });
    for (let i = 0; i < 6; i++) {
      const a = this.rand() * TAU;
      this.add({ type: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7, drag: 0.85, life: 10, size: 2, color: '#ffe08a', additive: true });
    }
  }

  fizzle(e, colors) {
    this.add({ type: 'ring', x: e.x, y: e.y, life: 10, size: 30, color: colors[1], width: 4 });
    this.dust(e.x, e.y, 4, 0.6);
  }

  dust(x, y, n = 6, scale = 1, dir = 0) {
    for (let i = 0; i < n; i++) {
      const s = (this.rand() - 0.5) * 2;
      this.add({ type: 'smoke', x: x + s * 14 * scale, y: y - 3, vx: s * 2.2 * scale + dir * 1.5, vy: -0.6 - this.rand() * 1.4, drag: 0.92, life: 24 + this.rand() * 14, size: (8 + this.rand() * 10) * scale, color: '#f2e2cf' });
    }
  }

  jumpRing(x, y, color) {
    this.add({ type: 'ellipse', x, y: y - 4, life: 14, size: 34, color, width: 4 });
  }

  doubleJump(x, y, color) {
    this.add({ type: 'ring', x, y: y - 6, life: 16, size: 46, color, width: 5, flat: true });
    for (let i = 0; i < 6; i++) this.add({ type: 'spark', x: x + (this.rand() - 0.5) * 30, y, vx: (this.rand() - 0.5) * 3, vy: 2 + this.rand() * 2, drag: 0.9, life: 14, size: 2.2, color, additive: true });
  }

  trailPuff(x, y, color) {
    this.add({ type: 'smoke', x, y, vx: (this.rand() - 0.5), vy: (this.rand() - 0.5), drag: 0.95, life: 30, size: 12 + this.rand() * 10, color });
  }

  /** KO core: the blast beam, rings, shake and flash (always plays). */
  koCore(e, color) {
    const ang = Math.atan2(-120 - e.y, 0 - e.x);
    this.add({ type: 'beam', x: e.x, y: e.y, rot: ang, life: 70, size: 1200, color, color2: '#ffffff' });
    this.add({ type: 'ring', x: e.x, y: e.y, life: 30, size: 260, color: '#ffffff', width: 14 });
    this.shake = 26;
    this.flash = 0.55;
    this.flashColor = '#ffffff';
  }

  koFlavor(e, color) {
    const ang = Math.atan2(-120 - e.y, 0 - e.x);
    this.add({ type: 'ring', x: e.x, y: e.y, life: 40, size: 400, color, width: 24 });
    for (let i = 0; i < 40; i++) {
      const a = ang + (this.rand() - 0.5) * 1.4, sp = 6 + this.rand() * 22;
      this.add({ type: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.93, life: 40 + this.rand() * 20, size: 3 + this.rand() * 5, color: this.rand() < 0.5 ? color : '#ffffff', additive: true });
    }
  }

  ko(e, color) { this.koCore(e, color); this.koFlavor(e, color); }

  respawn(x, y, color) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      this.add({ type: 'spark', x: x + Math.cos(a) * 60, y: y - 40 + Math.sin(a) * 60, vx: -Math.cos(a) * 3, vy: -Math.sin(a) * 3, drag: 0.95, life: 26, size: 3, color, additive: true });
    }
  }

  // ── Update & draw ─────────────────────────────────────────────────────────
  update() {
    this.frame++;
    this.particles.update();
    this.shake *= 0.86;
    if (this.shake < 0.3) this.shake = 0;
    if (this.flashHold > 0) this.flashHold--;
    else this.flash *= 0.85;
    this.zoomPunch *= 0.85;
    for (const s of this.hud.values()) {
      if (s.armor > 0) s.armor--;
      if (s.breakT > 0) s.breakT--;
      if (s.tired > 0) s.tired--;
      if (s.crack > 0) s.crack--;
      if (s.resist > 0) s.resist--;
      for (const t of s.trims) t.t--;
      if (s.trims.length && s.trims[0].t <= 0) s.trims = s.trims.filter((t) => t.t > 0);
    }
  }

  draw(ctx, layer = 'front') { this.particles.draw(ctx, layer); }

  clear() { this.particles.clear(); this.hud.clear(); this.shake = 0; this.flash = 0; this.zoomPunch = 0; }
}

// ── Effect flavors: signature particles per preset ───────────────────────────
const FLAVORS = {
  fire(E, e, c, { power }) {
    E.particles.burst(ENGINE, { x: e.x, y: e.y, count: 8 + power * 8, shape: 'dot', colors: [c[0], c[1]], speed: [1, 4], angle: 90, spread: 160, gravity: -0.12, drag: 0.94, life: [20, 34], size: [2, 4], blend: 'lighter' });
    E.particles.burst(ENGINE, { x: e.x, y: e.y, count: 4, shape: 'smoke', color: '#4a2a26', speed: [0.5, 1.5], angle: 90, spread: 120, life: [26, 38], size: [8, 14], gravity: -0.05, layer: 'back' });
  },
  ice(E, e, c) {
    E.particles.burst(ENGINE, { x: e.x, y: e.y, count: 7, shape: 'shard', colors: [c[1], c[0]], speed: [3, 8], life: [20, 32], size: [4, 8], gravity: 0.3, color2: '#ffffff' });
    E.particles.spawn(ENGINE, { shape: 'glow', x: e.x, y: e.y, life: 14, size: 40, color: c[1], blend: 'lighter', fade: 'out' });
  },
  electric(E, e, c, { power }) {
    const api = E.efx;
    const n = 2 + Math.round(power * 2);
    for (let i = 0; i < n; i++) {
      const a = E.rand() * TAU, len = 40 + E.rand() * 50 + power * 40;
      api.line({ x: e.x, y: e.y, x2: e.x + Math.cos(a) * len, y2: e.y + Math.sin(a) * len, color: c[2], core: '#ffffff', width: 2.5, jag: 10, life: 7 + i });
    }
  },
  magic(E, e, c) {
    for (let i = 0; i < 5; i++) {
      E.particles.spawn(ENGINE, { shape: 'star', x: e.x + (E.rand() - 0.5) * 60, y: e.y + (E.rand() - 0.5) * 60, vy: -0.6, life: 14 + i * 3, size: 7 + E.rand() * 6, color: c[1], color2: '#ffffff', points: 4, rot: E.rand(), vr: 0.08, blend: 'lighter' });
    }
    E.particles.spawn(ENGINE, { shape: 'glow', x: e.x, y: e.y, life: 16, size: 50, color: c[2], blend: 'lighter', fade: 'out' });
  },
  water(E, e, c) {
    E.particles.burst(ENGINE, { x: e.x, y: e.y, count: 10, shape: 'drip', colors: [c[1], c[0]], speed: [2, 6], angle: 90, spread: 200, gravity: 0.35, life: [22, 32], size: [2.5, 4.5] });
    E.efx.ring({ x: e.x, y: e.y, r0: 6, r1: 50, color: c[0], life: 12, width: 3, flat: true });
  },
  wind(E, e, c, { dx, dy }) {
    const api = E.efx;
    for (let i = 0; i < 3; i++) api.ring({ x: e.x + dx * i * 14, y: e.y + dy * i * 14, r0: 8 + i * 6, r1: 40 + i * 14, color: c[i === 0 ? 0 : 1], life: 10 + i * 3, width: 2.5 });
    E.particles.burst(ENGINE, { x: e.x, y: e.y, count: 6, shape: 'streak', color: c[1], angle: Math.atan2(-dy, dx) * 180 / Math.PI, spread: 50, speed: [10, 16], life: [8, 12], size: [1.5, 2.5], blend: 'lighter' });
  },
  dark(E, e, c) {
    E.particles.burst(ENGINE, { x: e.x, y: e.y, count: 7, shape: 'smoke', colors: [c[2], c[1]], speed: [0.8, 2.5], life: [24, 36], size: [9, 16], gravity: -0.02 });
    E.efx.ring({ x: e.x, y: e.y, r0: 60, r1: 8, color: c[1], life: 12, width: 4 });
  },
  light(E, e, c, { power }) {
    E.particles.spawn(ENGINE, { shape: 'glow', x: e.x, y: e.y, life: 18, size: 70 + power * 40, color: c[2], blend: 'lighter', fade: 'out' });
    E.add({ type: 'lines', x: e.x, y: e.y, life: 10, size: 90 + power * 60, color: c[1] });
  },
  poison(E, e, c) {
    for (let i = 0; i < 6; i++) {
      E.particles.spawn(ENGINE, { shape: 'ring', x: e.x + (E.rand() - 0.5) * 40, y: e.y + (E.rand() - 0.5) * 20, vy: -0.8 - E.rand(), drag: 0.97, life: 24 + i * 3, size: 4 + E.rand() * 4, width: 2, color: c[i % 2 ? 1 : 2] });
    }
    E.particles.burst(ENGINE, { x: e.x, y: e.y, count: 5, shape: 'drip', color: c[1], speed: [1.5, 4], gravity: 0.3, life: [20, 30], size: [2.5, 3.5] });
  },
  earth(E, e, c) {
    E.particles.burst(ENGINE, { x: e.x, y: e.y, count: 8, shape: 'debris', colors: [c[1], c[2]], speed: [3, 8], gravity: 0.45, life: [28, 42], size: [3, 6] });
    E.dust(e.x, e.y + 10, 3, 0.8);
  },
  slash(E, e, c, { dx, dy, power }) {
    const len = 60 + power * 50;
    const a = Math.atan2(dy, dx) + Math.PI / 2;
    E.particles.spawn(ENGINE, {
      shape: 'custom', x: e.x, y: e.y, life: 9, rot: a, layer: 'front', blend: 'lighter', fade: 'none', alpha: 1,
      draw: (ctx, q) => drawSlash(ctx, len, q, c),
    });
  },
};

const STATUS_TINTS = {
  burn: '#ff8a2a', poison: '#9ae05a', freeze: '#a8f2ff', stun: '#fff36b', slow: '#7ab8ff', root: '#c89a60',
  silence: '#c9c3d6', confuse: '#d48aff', weaken: '#ff7a8a', vulnerable: '#ff5a3a', float: '#d0fff2', mark: '#ff4d5e',
};

// ── Custom draw helpers (ctx is translated to the particle and rotated) ──────
function drawSheen(ctx, w, h, t) {
  // A bright diagonal band sweeping across the body box: reads as polished metal.
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0, 0, w * 0.75, h * 0.6, 0, 0, TAU); ctx.clip();
  const sweep = -w + t * w * 2.4;
  const g = ctx.createLinearGradient(sweep - 26, -h, sweep + 26, h);
  g.addColorStop(0, 'rgba(220,232,255,0)'); g.addColorStop(0.45, 'rgba(235,242,255,0.75)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.95)'); g.addColorStop(0.55, 'rgba(200,214,236,0.6)'); g.addColorStop(1, 'rgba(200,214,236,0)');
  ctx.globalAlpha = 1 - t * 0.6;
  ctx.fillStyle = g;
  ctx.fillRect(-w, -h, w * 2, h * 2);
  ctx.restore();
  ctx.globalAlpha = (1 - t) * 0.8;
  ctx.strokeStyle = '#e6eefa'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(0, 0, w * 0.75, h * 0.6, 0, 0, TAU); ctx.stroke();
}

function drawCrack(ctx, r, q, seed) {
  if (q.age % 4 >= 2 && q.k < 0.7) return;   // flicker
  ctx.globalAlpha = Math.min(1, q.k * 1.6);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [w, col] of [[4, 'rgba(120,200,255,0.5)'], [1.6, '#ffffff']]) {
    const rr = kit.seeded(seed);
    ctx.strokeStyle = col; ctx.lineWidth = w;
    for (let i = 0; i < 6; i++) {
      let a = (i / 6) * TAU + rr() * 0.6, x = 0, y = 0;
      ctx.beginPath(); ctx.moveTo(0, 0);
      for (let j = 0; j < 3; j++) { a += (rr() - 0.5) * 0.8; const l = r * (0.25 + rr() * 0.2); x += Math.cos(a) * l; y += Math.sin(a) * l; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
}

function drawSlash(ctx, len, q, c) {
  // Crescent blade glint across the impact.
  const grow = Math.min(1, q.t * 3.5);
  const L = len * (0.5 + grow * 0.5), W = 10 * q.k + 2;
  ctx.globalAlpha = Math.min(1, q.k * 2);
  for (const [mul, col] of [[1.8, c[2]], [1, c[1]], [0.4, '#ffffff']]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-L, 0);
    ctx.quadraticCurveTo(0, -W * mul * 2, L, 0);
    ctx.quadraticCurveTo(0, -W * mul * 0.6, -L, 0);
    ctx.fill();
  }
}

function drawPopText(ctx, text, size, q, o) {
  const pop = q.age < 7 ? 1 + (7 - q.age) * (o.big ? 0.12 : 0.07) : 1;
  ctx.globalAlpha = Math.min(1, q.k * 3);
  ctx.scale(pop, pop);
  ctx.font = `${o.italic ? 'italic ' : ''}800 ${size}px "Bungee", "Rajdhani", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * (o.big ? 0.36 : 0.28));
  ctx.strokeStyle = o.outline || '#14091e';
  ctx.strokeText(text, 0, 0);
  if (o.fill2) {
    const g = ctx.createLinearGradient(0, -size * 0.6, 0, size * 0.6);
    g.addColorStop(0, o.color || '#ffffff'); g.addColorStop(1, o.fill2);
    ctx.fillStyle = g;
  } else ctx.fillStyle = o.color || '#ffffff';
  ctx.fillText(text, 0, 0);
  if (o.sub) {
    ctx.font = `700 ${Math.round(size * 0.5)}px "Rajdhani", sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeText(o.sub, 0, size * 0.78);
    ctx.fillStyle = '#c9c3d6';
    ctx.fillText(o.sub, 0, size * 0.78);
  }
}

function fmt(v) { const n = Math.round(num(v, 0) * 10) / 10; return Number.isInteger(n) ? String(n) : n.toFixed(1); }

function heightOf(F) {
  const c = F?.character;
  return num(c?.forms?.base?.body?.collider?.h, num(c?.body?.collider?.h, num(c?.stats?.height, 90)));
}

function sheetOf(F, name) {
  const sh = F?.art?.sheets?.[name];
  if (!sh) return null;
  const assets = F.assets || F.info?.assets || {};
  const image = typeof sh.image === 'string' ? assets[sh.image] : sh.image;
  return image ? { ...sh, image } : null;
}
