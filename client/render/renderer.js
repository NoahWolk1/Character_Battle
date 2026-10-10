// Draws a game view: background, stage, fighters, entities, effects, HUD.
// Character art runs through the art host (art-host.js, spec §6): bounds-sized
// offscreen canvases, drawBack/drawWorld layers, entity art, trails, guards.
// The global polish layer stays engine-owned for everyone: hit flash, charge and
// dizzy tints, intangibility flicker, player-color rim, shadow, shield bubble, tag.
import * as kit from '/shared/art/kit.js';
import { SHIELD } from '/shared/constants.js';
import { hash32 } from '/shared/sim/rng.js';
import { Effects, resolveEffect } from './effects.js';
import { SkySanctumArt } from './stages/sky-sanctum.js';

const STAGE_ART = { 'sky-sanctum': SkySanctumArt }; // stage id → art class (shared/stages/index.js ids)
import { drawHud, drawOffscreenBubbles, drawBanner } from './hud.js';
import { ArtHost, DEFAULT_LIGHT, shapesAABB } from './art-host.js';
import { PLAYER_COLORS } from '../characters.js';

const TRAIL_LIFE = 7;
// Adaptive resolution (watchFrameRate): average frame interval over `window` frames; above
// slowMs the backing resolution steps down by `step` (never below `floor` × CSS px); after
// recoverWindows smooth windows below smoothMs it steps back up.
const RES = Object.freeze({ window: 90, slowMs: 21, smoothMs: 17.5, step: 0.8, floor: 0.75, recoverWindows: 8, capSdMs: 1.5 });

export class Renderer {
  constructor(canvas, stage, characters) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stage = stage;
    this.characters = characters;
    this.stageArt = new (STAGE_ART[stage.id] || SkySanctumArt)(stage);
    this.light = this.stageArt.light || DEFAULT_LIGHT;
    this.cam = { x: 0, y: -200, zoom: 0.6, w: 1, h: 1 };
    this.time = 0;          // render frames (v1 art clock)
    this.clock = 0;         // smooth seconds (v2 info.time)
    this.lastNow = null;
    this.showHitboxes = false;
    this.hudState = new Map();
    this.banner = null;
    this.roster = [];
    this.byIndex = new Map();
    this.frameRecs = new Map();
    this.pendingEvents = new Map(); // fighter id → one-shot events for view.events
    this.audio = null;
    this.effects = this.makeEffects();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  makeEffects() {
    const fx = new Effects();
    fx.attach({ audio: this.audio, fighter: (id) => this.fxFighter(id) });
    return fx;
  }

  /** The art host for a roster entry (created by client/characters.js; built here for older entries). */
  hostOf(entry) {
    if (!entry) return null;
    if (!entry.host) entry.host = new ArtHost(entry, { light: this.light });
    entry.host.light = this.light;
    return entry.host;
  }

  setRoster(roster) {
    const seen = new Map();
    this.roster = roster.map((r) => {
      const entry = this.characters.get(r.charId);
      const ordinal = seen.get(r.charId) || 0; // duplicate picks get alt palettes
      seen.set(r.charId, ordinal + 1);
      const rec = { ...r, color: PLAYER_COLORS[r.index % PLAYER_COLORS.length], entry, paletteIdx: ordinal, host: this.hostOf(entry) };
      rec.host?.dropFighter(r.id);
      return rec;
    });
    this.byIndex = new Map(this.roster.map((r) => [r.index, r]));
    this.hudState.clear();
    this.pendingEvents.clear();
    this.frameRecs.clear();
    this.effects = this.makeEffects();
    this.banner = null;
  }

  resize() {
    const dpr = Math.max(RES.floor, Math.min(2, window.devicePixelRatio || 1) * (this.resScale ?? 1));
    const oldW = this.cam.w;
    this.dpr = dpr;
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.cam.w = this.canvas.width;
    this.cam.h = this.canvas.height;
    if (oldW > 1 && this.cam.zoom) this.cam.zoom *= this.cam.w / oldW; // same framing at the new resolution (cam.w starts at 1)
  }

  /**
   * Adaptive resolution: the canvas fill/raster cost grows with pixel count, so a slow machine
   * (sustained < ~48 fps) renders at a lower backing resolution; it steps back up after a long
   * run of smooth frames. `ms` = this frame's interval.
   */
  watchFrameRate(ms) {
    const p = this.fps ||= { sum: 0, sq: 0, n: 0, good: 0 };
    if (!(ms > 0) || ms > 100) return; // tab switch / pause: not a measurement
    p.sum += ms; p.sq += ms * ms; p.n++;
    if (p.n < RES.window) return;
    const avg = p.sum / p.n, sd = Math.sqrt(Math.max(0, p.sq / p.n - avg * avg));
    p.sum = 0; p.sq = 0; p.n = 0;
    const scale = this.resScale ?? 1;
    // A rock-steady slow rate is a display/battery cap (e.g. 30 Hz low-power mode), not load.
    if (avg > RES.slowMs && sd > RES.capSdMs && this.dpr > RES.floor) { this.resScale = scale * RES.step; p.good = 0; this.resize(); }
    else if (avg < RES.smoothMs && scale < 1 && ++p.good >= RES.recoverWindows) { this.resScale = Math.min(1, scale / RES.step); p.good = 0; this.resize(); }
  }

  info(id) { return this.roster.find((r) => r.id === id); }

  /** What effects.js needs about a fighter (art fx hooks, sounds, anchor, info). */
  fxFighter(id) {
    const r = this.info(id);
    if (!r?.entry) return null;
    const fr = this.frameRecs.get(id);
    const form = fr?.view?.form || 'base';
    const host = r.host;
    return {
      color: r.color, character: r.entry.character, assets: host?.assets || r.entry.assets,
      art: host ? host.artFor(form) : r.entry.art, palette: host ? host.palette(form, r.paletteIdx) : r.entry.art?.palette,
      info: fr?.info || null,
      anchor: fr ? () => ({ x: fr.view.x, y: fr.view.y, facing: fr.view.facing, scale: fr.view.bodyScale }) : null,
    };
  }

  // ── Events from the simulation → effects & sounds ───────────────────────
  handleEvents(events, audio) {
    if (audio !== undefined && audio !== this.audio) { this.audio = audio; this.effects.attach({ audio, fighter: (id) => this.fxFighter(id) }); }
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const hs = this.hudState.get(e.target) || {};
          hs.shake = 12 + e.damage; this.hudState.set(e.target, hs);
          break;
        }
        case 'countdown': this.banner = { text: e.n > 0 ? String(e.n) : 'GO!', t: 0, color: '#ffffff' }; audio?.countdown(e.n); break;
        case 'go': this.banner = { text: 'GO!', t: 0, color: '#ffe36b' }; audio?.countdown(0); break;
        case 'gameover': this.banner = { text: 'GAME!', t: 0, color: '#ffffff', hold: true }; audio?.gameSet(); break;
        default: break;
      }
      // One-shot events for view.events (attacker and target both see a hit).
      for (const id of new Set([e.id, e.attacker, e.target].filter((x) => x != null))) {
        const q = this.pendingEvents.get(id) || [];
        if (q.length < 32) q.push(e);
        this.pendingEvents.set(id, q);
      }
    }
    this.effects.handleEvents(events, audio);
  }

  // ── Camera ──────────────────────────────────────────────────────────────
  heightOf(f, r) {
    const host = r?.host;
    if (!host) return 90;
    const form = r.tables?.forms?.[f.fm] ?? 'base';
    return host.model.collider(form).h * (f.bs ?? 1);
  }

  updateCamera(view) {
    const cb = this.stage.camera;
    let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    for (const f of view.fighters) {
      if (f.state === 'dead' || f.eliminated) continue;
      const h = this.heightOf(f, this.info(f.id));
      x1 = Math.min(x1, f.x); x2 = Math.max(x2, f.x);
      y1 = Math.min(y1, f.y - h); y2 = Math.max(y2, f.y);
    }
    if (!Number.isFinite(x1)) { x1 = -400; x2 = 400; y1 = -300; y2 = 0; }
    x1 = Math.max(cb.left, x1 - 260); x2 = Math.min(cb.right, x2 + 260);
    y1 = Math.max(cb.top, y1 - 200); y2 = Math.min(cb.bottom, y2 + 160);
    const aspect = this.cam.w / this.cam.h;
    let width = Math.max(cb.minWidth, x2 - x1, (y2 - y1) * aspect);
    width = Math.min(cb.maxWidth, width);
    const tx = (x1 + x2) / 2, ty = (y1 + y2) / 2 - 20;
    const tz = this.cam.w / width;
    const c = this.cam;
    c.x += (tx - c.x) * 0.08;
    c.y += (ty - c.y) * 0.08;
    c.zoom += (tz * (1 + this.effects.zoomPunch) - c.zoom) * 0.06;
    // keep the view within camera bounds
    const halfW = c.w / c.zoom / 2, halfH = c.h / c.zoom / 2;
    c.x = Math.max(cb.left + halfW, Math.min(cb.right - halfW, c.x));
    c.y = Math.max(cb.top + halfH, Math.min(cb.bottom - halfH, c.y));
  }

  worldTransform(ctx) {
    const c = this.cam;
    let sx = 0, sy = 0;
    if (this.effects.shake > 0) { sx = (Math.random() - 0.5) * this.effects.shake; sy = (Math.random() - 0.5) * this.effects.shake; }
    ctx.setTransform(c.zoom, 0, 0, c.zoom, c.w / 2 - c.x * c.zoom + sx * this.dpr, c.h / 2 - c.y * c.zoom + sy * this.dpr);
  }

  // ── Frame ───────────────────────────────────────────────────────────────
  /**
   * @param view   { frame, phase, phaseFrame, fighters[], projectiles[], entities?[] } (snapshot shape)
   * @param opts   { localIds: Set, hud: true, paused }
   */
  render(view, opts = {}) {
    const ctx = this.ctx;
    this.time++;
    const now = performance.now();
    const dt = this.lastNow == null ? 1 / 60 : Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    if (this.lastNow != null) this.watchFrameRate(now - this.lastNow);
    this.lastNow = now;
    this.clock += dt;
    if (!opts.paused) this.effects.update();
    this.effects.observe(view);
    this.updateCamera(view);
    this.buildFrame(view, dt);
    const cam = this.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.stageArt.drawBackground(ctx, cam, this.time);

    this.worldTransform(ctx);
    this.stageArt.drawStage(ctx, this.time);
    this.effects.draw(ctx, 'back');
    for (const f of view.fighters) this.drawShadow(ctx, f);
    for (const f of view.fighters) this.drawLayer(ctx, f, 'drawBack');
    // Attacking fighters draw on top.
    const order = [...view.fighters].sort((a, b) => (a.state === 'attack') - (b.state === 'attack'));
    for (const f of order) this.drawFighterView(ctx, f, opts);
    this.drawEntities(ctx, view, 'main');
    for (const f of view.fighters) this.drawLayer(ctx, f, 'drawWorld');
    this.drawEntities(ctx, view, 'world');
    this.effects.draw(ctx, 'front');
    if (this.showHitboxes) this.drawDebug(ctx, view);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.stageArt.drawForeground(ctx, cam, this.time);
    if (this.effects.flash > 0.01) {
      ctx.fillStyle = kit.rgba(this.effects.flashColor, this.effects.flash * 0.6);
      ctx.fillRect(0, 0, cam.w, cam.h);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (opts.hud !== false) {
      drawOffscreenBubbles(ctx, this, view);
      drawHud(ctx, this, view, opts);
    }
    if (this.banner) {
      this.banner.t++;
      if (!drawBanner(ctx, this, this.banner)) this.banner = null;
    }
  }

  /** Art view + info for every fighter this frame (shared by body, layers, entities, fx). */
  buildFrame(view, dt) {
    this.frameRecs.clear();
    const ownEntities = new Map();
    for (const e of view.entities || []) {
      const list = ownEntities.get(e.o) || [];
      list.push(e);
      ownEntities.set(e.o, list);
    }
    for (const f of view.fighters) {
      const r = this.info(f.id);
      if (!r?.entry || !r.host) continue;
      const host = r.host;
      const st = host.fighter(f.id, r.paletteIdx);
      const legacyView = host.model.kind === 'v1'
        ? { ...f, index: r.index, move: f.slot ? r.entry.character.moves[f.slot] : null, doubleJumpFlip: f.dj } // exact v1 view
        : null;
      const events = this.pendingEvents.get(f.id) || [];
      this.pendingEvents.delete(f.id);
      const v = host.view(legacyView ? { ...f, legacyView } : f, r, { events, entities: ownEntities.get(r.index) || [] });
      const info = host.info(v, st, {
        time: this.clock, dt, frame: this.time, simFrame: view.frame ?? this.time,
        fx: this.effects.fxFor(f.id), light: this.light,
      });
      this.frameRecs.set(f.id, { r, host, st, view: v, info });
    }
  }

  /** Gentle pulsing body tint for active statuses that declare `tint` (custom ones resolve via their source's IR). */
  statusTints(view) {
    const list = view.statuses;
    if (!Array.isArray(list) || !list.length) return null;
    const out = [];
    for (const s of list) {
      let def = null;
      for (const r of this.roster) { def = r.entry?.character?.statuses?.[s.name]; if (def?.tint) break; }
      if (typeof def?.tint === 'string' && out.length < 2) out.push([def.tint, 0.12 + 0.06 * Math.sin(this.time * 0.15)]);
    }
    return out.length ? out : null;
  }

  drawLayer(ctx, f, which) {
    if (f.state === 'dead' || f.eliminated) return;
    const fr = this.frameRecs.get(f.id);
    if (fr) fr.host.drawLayer(ctx, which, fr.view, fr.info, fr.st);
  }

  // ── Fighters ────────────────────────────────────────────────────────────
  drawShadow(ctx, f) {
    if (f.state === 'dead' || f.eliminated) return;
    const fr = this.frameRecs.get(f.id);
    if (!fr) return;
    const g = this.stage.ground;
    let gy = null;
    if (f.x >= g.x1 && f.x <= g.x2 && f.y <= g.y + 1) gy = g.y;
    for (const p of this.stage.platforms) if (f.x >= p.x1 && f.x <= p.x2 && f.y <= p.y + 1 && (gy === null || p.y < gy)) gy = p.y;
    if (gy === null) return;
    const d = gy - f.y;
    const w = fr.info.W * fr.view.bodyScale * (1 - Math.min(0.7, d / 500));
    ctx.fillStyle = `rgba(20,8,30,${0.35 * (1 - Math.min(1, d / 600))})`;
    ctx.beginPath(); ctx.ellipse(f.x, gy + 1, w * 0.7, 6, 0, 0, Math.PI * 2); ctx.fill();
  }

  drawFighterView(ctx, f, opts) {
    if (f.state === 'dead' || f.eliminated) return;
    const fr = this.frameRecs.get(f.id);
    if (!fr) return;
    const { r, host, st, view, info } = fr;
    const zoom = this.cam.zoom;
    const H = info.H * view.bodyScale;
    const hurt = shapesAABB(info.hurtboxes) || { x1: -info.W / 2, y1: -H, x2: info.W / 2, y2: 0 };

    // Respawn halo
    if (f.state === 'respawn') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      kit.glow(ctx, f.x, f.y + 4, 70, r.color, 0.7);
      ctx.restore();
      ctx.fillStyle = kit.rgba('#ffffff', 0.85);
      ctx.beginPath(); ctx.ellipse(f.x, f.y + 4, 46, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = r.color; ctx.lineWidth = 3; ctx.stroke();
    }

    // Tumble smoke trail
    const launchSpeed = Math.hypot(f.kx || 0, f.ky || 0);
    if (f.state === 'hitstun' && launchSpeed > 9 && this.time % 2 === 0) {
      this.effects.trailPuff(f.x, f.y - H / 2, launchSpeed > 18 ? '#ffd8a0' : '#e8e0f0');
    }

    // Body → offscreen canvas at screen resolution (flash overlays, rim glow).
    let overlay = null;
    if (f.hitlag > 0 && f.state === 'hitstun') overlay = 'rgba(255,255,255,0.75)';
    else if (f.charging) overlay = `rgba(255,240,140,${0.25 + 0.25 * Math.sin(this.time * 0.6)})`;
    else if (f.state === 'shieldbreak' || f.state === 'stunned') overlay = `rgba(255,220,120,${0.2 + 0.15 * Math.sin(this.time * 0.3)})`;
    const p = host.paint(view, info, st, zoom, { overlay, tints: this.statusTints(view) });
    if (p) {
      let jx = 0;
      if (f.hitlag > 0) jx = (Math.random() - 0.5) * 6;
      ctx.save();
      if (f.intangible && f.state !== 'respawn') ctx.globalAlpha = 0.55 + 0.25 * Math.sin(this.time * 0.8);
      // Player-color rim glow so you can always tell fighters apart.
      ctx.shadowColor = f.charging ? '#ffe36b' : kit.rgba(r.color, 0.9);
      ctx.shadowBlur = (f.charging ? 26 : 10) * zoom * 1.4;
      ctx.drawImage(p.canvas, f.x + jx - p.ox / zoom, f.y - p.oy / zoom, p.w / zoom, p.h / zoom);
      ctx.restore();
    }

    // Attack swoosh trail(s).
    this.updateTrail(ctx, f, fr);

    // Shield bubble, sized from the hurtbox AABB.
    if (f.state === 'shield') {
      const k = Math.max(0.15, f.shield / SHIELD.max);
      const size = Math.max(hurt.y2 - hurt.y1, hurt.x2 - hurt.x1);
      const rad = size * 0.62 * (0.45 + 0.55 * k);
      const cx = f.x + ((hurt.x1 + hurt.x2) / 2) * view.facing, cy = f.y + (hurt.y1 + hurt.y2) / 2;
      const g = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, rad * 0.1, cx, cy, rad);
      g.addColorStop(0, kit.rgba('#ffffff', 0.55)); g.addColorStop(0.5, kit.rgba(r.color, 0.35)); g.addColorStop(1, kit.rgba(r.color, 0.7));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = kit.rgba('#ffffff', 0.8); ctx.lineWidth = 2; ctx.stroke();
    }

    // Player tag above the hurtboxes (none in the HUD-less attract demo).
    if (opts.hud !== false && (f.state !== 'respawn' || this.time % 20 < 14)) {
      const ty = f.y + hurt.y1 - 26;
      ctx.save();
      ctx.font = 'bold 15px "Rajdhani", sans-serif';
      ctx.textAlign = 'center';
      const label = r.cpu ? `CPU ${r.index + 1}` : `P${r.index + 1}`;
      ctx.fillStyle = r.color;
      kit.polygonPath(ctx, [[f.x - 7, ty + 6], [f.x + 7, ty + 6], [f.x, ty + 14]]);
      ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#120a1c'; ctx.strokeText(label, f.x, ty);
      ctx.fillText(label, f.x, ty);
      ctx.restore();
    }
  }

  updateTrail(ctx, f, fr) {
    const { host, st, view, info, r } = fr;
    const pts = host.trail(view, info);
    st.trails ||= [];
    pts.forEach((p, k) => {
      (st.trails[k] ||= []).push({ x: f.x + p.x * view.facing, y: f.y + p.y, t: this.time });
    });
    const move = view.move;
    const pal = host.palette(view.form, r.paletteIdx);
    let colors = null;
    for (let k = 0; k < st.trails.length; k++) {
      const list = st.trails[k] = st.trails[k].filter((pt) => this.time - pt.t < TRAIL_LIFE);
      if (list.length < 2) continue;
      colors ||= resolveEffect(move?.effect || 'punch', { color: move?.color, palette: pal }).colors; // move color → preset → palette.effect
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [w, col, al] of [[22, colors[2], 0.35], [12, colors[1], 0.7], [4, colors[0], 1]]) {
        for (let i = 1; i < list.length; i++) {
          const kk = i / list.length;
          ctx.globalAlpha = al * kk;
          ctx.strokeStyle = col;
          ctx.lineWidth = w * kk;
          ctx.beginPath(); ctx.moveTo(list[i - 1].x, list[i - 1].y); ctx.lineTo(list[i].x, list[i].y); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ── Entities and projectiles ────────────────────────────────────────────
  /** 'main': entity art (or fallback) + v1 projectiles; 'world': entities' drawWorld. */
  drawEntities(ctx, view, layer) {
    const v1Ids = new Set((view.projectiles || []).map((p) => p.id));
    const drawn = new Set();
    for (const e of view.entities || []) {
      const r = this.byIndex.get(e.o);
      const owner = r && this.frameRecs.get(r.id);
      if (!owner) continue;
      const { host, st, view: ov, info } = owner;
      const ev = host.entityView(e, r, ov);
      if (layer === 'world') { host.drawEntity(ctx, ev, info, 'world', { st }); continue; }
      if (host.hasEntityArt(ev.name, ov.form)) { host.drawEntity(ctx, ev, info, 'main', { st }); drawn.add(ev.id); }
      else if (!v1Ids.has(ev.id)) { host.drawEntity(ctx, ev, info, 'main', { st }); drawn.add(ev.id); }
    }
    if (layer === 'main') for (const p of view.projectiles || []) if (!drawn.has(p.id)) this.drawProjectile(ctx, p);
  }

  // v1 projectile styles (and art.projectile) for projectiles without entity art.
  drawProjectile(ctx, p) {
    const r = this.info(p.owner);
    const fr = r && this.frameRecs.get(r.id);
    const host = r?.host;
    const form = fr?.view?.form || 'base';
    const art = host ? host.artFor(form) : r?.entry?.art || {};
    const pal = host ? host.palette(form, r.paletteIdx) : art.palette || {};
    const colors = resolveEffect(p.effect, { color: p.color, palette: pal }).colors;
    const c1 = p.color || colors[1], c2 = p.color2 || colors[0];
    const t = this.time;
    ctx.save();
    ctx.translate(p.x, p.y);
    const dir = Math.sign(p.vx) || 1;
    if (typeof art.projectile === 'function') {
      // Inner save so a throwing hook can't leave its mirror/transform/state on the fallback.
      const base = ctx.getTransform();
      ctx.save();
      try {
        ctx.scale(dir, 1);
        art.projectile(ctx, { ...p, t, kit, palette: pal, colors, seed: hash32(`p${p.id}`) }, fr?.info);
        ctx.restore();
        ctx.restore();
        return;
      } catch (e) {
        ctx.restore();
        ctx.setTransform(base); // in case the hook threw between its own save() and restore()
        if (r && !r.projWarned) { console.error(`Art error in ${r.entry?.character?.id} projectile:`, e); r.projWarned = true; }
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    // trail
    for (let i = 1; i <= 5; i++) {
      kit.glow(ctx, -p.vx * i * 1.6, -p.vy * i * 1.6, p.r * (1.6 - i * 0.2), c1, 0.25 - i * 0.04);
    }
    const spin = t * (p.spin || 0.15);
    switch (p.style) {
      case 'bolt': {
        ctx.scale(dir, 1);
        ctx.strokeStyle = c2; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-p.r * 2, 0);
        for (let i = 0; i < 5; i++) ctx.lineTo(-p.r * 2 + i * p.r, (Math.random() - 0.5) * p.r);
        ctx.lineTo(p.r * 1.4, 0); ctx.stroke();
        kit.glow(ctx, 0, 0, p.r * 2.4, c1, 0.7);
        break;
      }
      case 'shard': case 'star': {
        kit.glow(ctx, 0, 0, p.r * 2.2, c1, 0.6);
        ctx.globalCompositeOperation = 'source-over';
        kit.starPath(ctx, 0, 0, p.style === 'star' ? 5 : 4, p.r * 1.3, p.r * 0.5, spin);
        ctx.fillStyle = c1; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = c2; ctx.stroke();
        break;
      }
      case 'wave': {
        ctx.scale(dir, 1);
        ctx.strokeStyle = c1; ctx.lineWidth = p.r * 0.5;
        ctx.beginPath(); ctx.arc(-p.r * 0.6, 0, p.r * 1.2, -1.1, 1.1); ctx.stroke();
        ctx.strokeStyle = c2; ctx.lineWidth = p.r * 0.2;
        ctx.beginPath(); ctx.arc(-p.r * 0.6, 0, p.r * 1.2, -1.0, 1.0); ctx.stroke();
        break;
      }
      case 'fireball': {
        kit.glow(ctx, 0, 0, p.r * 2.6, colors[2], 0.6);
        for (let i = 0; i < 6; i++) {
          const a = spin * 2 + i;
          kit.glow(ctx, -dir * (4 + i * 3) + Math.cos(a) * 3, Math.sin(a) * p.r * 0.5, p.r * (1 - i * 0.12), c1, 0.55);
        }
        kit.glow(ctx, 0, 0, p.r * 0.9, c2, 1);
        break;
      }
      case 'ring': {
        ctx.strokeStyle = c1; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.ellipse(0, 0, p.r * 0.5, p.r * 1.2, 0, 0, Math.PI * 2); ctx.stroke();
        kit.glow(ctx, 0, 0, p.r * 1.8, c1, 0.5);
        break;
      }
      case 'orb': default: {
        kit.glow(ctx, 0, 0, p.r * 2.6, c1, 0.6);
        const g = ctx.createRadialGradient(-p.r * 0.3, -p.r * 0.3, 1, 0, 0, p.r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, c2); g.addColorStop(1, c1);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = kit.rgba('#ffffff', 0.7); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, p.r * 1.35, spin, spin + 2); ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  // Training overlay: shape-accurate hurtboxes, the current move's hitboxes, entities.
  drawDebug(ctx, view) {
    ctx.save();
    ctx.lineWidth = 2 / this.cam.zoom * this.dpr;
    const toWorld = (s, f) => {
      const x = f.x, y = f.y, d = f.facing || 1;
      if (s.shape === 'circle') return { shape: 'circle', x: x + s.x * d, y: y + s.y, r: s.r };
      if (s.shape === 'capsule') return { shape: 'capsule', x1: x + s.x1 * d, y1: y + s.y1, x2: x + s.x2 * d, y2: y + s.y2, r: s.r };
      return { shape: 'rect', x: x + s.x * d, y: y + s.y, w: s.w, h: s.h };
    };
    for (const f of view.fighters) {
      const fr = this.frameRecs.get(f.id);
      if (!fr || f.state === 'dead') continue;
      ctx.strokeStyle = f.intangible ? '#5aa8ff' : '#ffe36b';
      for (const s of fr.info.hurtboxes) { kit.shapePath(ctx, toWorld(s, f)); ctx.stroke(); }
      const m = fr.view.move;
      if (m?.def && f.state === 'attack') {
        const k = fr.view.bodyScale;
        for (const hb of m.def.hitboxes || []) {
          const on = m.frame >= hb.start && m.frame <= hb.end && m.phase !== 'charge';
          const s = hb.shape === 'capsule' ? { shape: 'capsule', x1: hb.x1 * k, y1: hb.y1 * k, x2: hb.x2 * k, y2: hb.y2 * k, r: hb.r * k }
            : hb.shape === 'rect' ? { shape: 'rect', x: hb.x * k, y: hb.y * k, w: hb.w * k, h: hb.h * k } : { shape: 'circle', x: hb.x * k, y: hb.y * k, r: hb.r * k };
          ctx.fillStyle = on ? 'rgba(255,40,60,0.45)' : 'rgba(255,255,255,0.08)';
          kit.shapePath(ctx, toWorld(s, f)); ctx.fill();
        }
      }
    }
    ctx.strokeStyle = '#ff2840';
    for (const e of view.entities || []) {
      const r = this.byIndex.get(e.o);
      const fr = r && this.frameRecs.get(r.id);
      const ev = fr ? fr.host.entityView(e, r, fr.view) : null;
      const s = ev?.shape;
      if (s) { kit.shapePath(ctx, toWorld(s, { x: e.x, y: e.y, facing: ev.facing })); ctx.stroke(); }
    }
    if (!view.entities) for (const p of view.projectiles || []) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
}
