// Animated character previews for menus (spec §6.5): idles, then plays the character's
// resolved move for every trigger in turn (shuffled), cycling through its forms.
// Everything draws through the art host, so v2 art (draw, sprites, forms) shows here too.
import * as kit from '../../shared/art/kit.js';
import { triggerPlaylist, moveView, frameBox, fitTransform, isAirMove } from '../lab/core.js';

const all = new Set();
let running = false;
let seq = 0;
const MOVES_PER_FORM = 3;

/**
 * Preview scale: every fighter's body (collider height) fills about BODY of the cell, so
 * small non-humanoids don't read as thumbnails next to tall ones. Declared art bounds
 * (which include attack reach) only cap it loosely; big moves may spill past the edges.
 */
export const BODY = 0.5;
export function showcaseScale(box, H, w, h, zoom = 1) {
  const fit = fitTransform(box, w, h * 0.86 / 0.93, { pad: 0.06 });
  return Math.min(fit.scale * 2.4, (h * BODY) / Math.max(1, H), (w * 0.4) / Math.max(1, H)) * zoom;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export class Showcase {
  constructor(canvas, { color = '#ffffff', zoom = 1, showMoves = true, background = true } = {}) {
    this.canvas = canvas;
    this.color = color;
    this.zoom = zoom;
    this.showMoves = showMoves;
    this.background = background;
    this.entry = null;
    this.id = `showcase${++seq}`;
    this.t = Math.floor(Math.random() * 100);
    this.reset();
    all.add(this);
    if (!running) { running = true; requestAnimationFrame(tickAll); }
  }

  reset() {
    this.form = this.entry?.host?.model.startForm || 'base';
    this.queue = [];
    this.played = 0;
    this.state = { mode: 'idle', until: this.t + 40 };
    this.entry?.host?.dropFighter(this.id);
  }

  set(entry, color) {
    if (this.entry !== entry) { this.entry = entry; this.reset(); }
    if (color) this.color = color;
  }

  destroy() { all.delete(this); this.entry?.host?.dropFighter(this.id); }

  /** Next move to show: refills a shuffled playlist; switches form every few moves. */
  nextMove() {
    const host = this.entry.host;
    const forms = host.model.tables.forms || ['base'];
    if (forms.length > 1 && this.played >= MOVES_PER_FORM) {
      this.form = forms[(forms.indexOf(this.form) + 1) % forms.length];
      this.played = 0;
      this.queue = [];
      return null; // show the new form's idle first
    }
    if (!this.queue.length) this.queue = shuffle(triggerPlaylist(host.model.ir, this.form));
    this.played++;
    return this.queue.shift() || null;
  }

  advance() {
    const s = this.state;
    if (s.mode === 'move') {
      s.frame++;
      if (s.frame >= s.def.duration) this.state = { mode: 'idle', until: this.t + 50 + Math.random() * 90 };
    } else if (this.showMoves && this.t > s.until) {
      const m = this.nextMove();
      this.state = m ? { mode: 'move', frame: 0, name: m.name, def: m.def } : { mode: 'idle', until: this.t + 45 };
    }
  }

  draw() {
    const c = this.canvas;
    if (!c.isConnected) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth || c.width, h = c.clientHeight || c.height;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.background) {
      const g = ctx.createRadialGradient(w / 2, h * 0.62, 10, w / 2, h * 0.6, Math.max(w, h) * 0.7);
      g.addColorStop(0, kit.rgba(this.color, 0.55)); g.addColorStop(1, 'rgba(10,5,20,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(w / 2, h * 0.86, w * 0.22, 8, 0, 0, Math.PI * 2); ctx.fill();
    }
    const host = this.entry?.host;
    if (!host) return;
    this.t++;
    this.advance();
    const s = this.state;
    const H = host.model.collider(this.form).h;
    // Feet at 86%; body normalized to the cell (see showcaseScale).
    const scale = showcaseScale(frameBox(host.bounds(this.form, 1), H), H, w, h, this.zoom);
    const air = s.mode === 'move' && isAirMove(s.def);
    const partial = s.mode === 'move'
      ? moveView(s.name, s.def, s.frame, { form: this.form })
      : { state: 'idle', stateFrame: this.t, form: this.form };
    ctx.save();
    ctx.translate(w / 2, h * 0.86 - (air ? 10 : 0));
    ctx.scale(scale, scale);
    try {
      host.preview(ctx, partial, { id: this.id, time: this.t / 60, frame: this.t, simFrame: this.t });
    } catch (e) { if (!this.warned) { console.error(e); this.warned = true; } }
    ctx.restore();
  }
}

function tickAll() {
  for (const s of all) {
    if (!s.canvas.isConnected) { all.delete(s); continue; }
    s.draw();
  }
  if (all.size) requestAnimationFrame(tickAll); else running = false;
}
