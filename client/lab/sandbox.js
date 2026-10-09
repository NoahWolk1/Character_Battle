// Art Lab governor sandbox (spec §6.6): a real Game (governor on) with the Lab
// character and a training dummy, rendered by the in-game Renderer. Buttons fire
// any pool move or spawn any entity; 'gov' events land in the governor log next
// to the hits that caused them, so authors see exactly where the engine clamps.
import { Game } from '/shared/sim/game.js';
import { startAction } from '/shared/sim/actions.js';
import { spawn } from '/shared/sim/entities.js';
import { setForm } from '/shared/sim/fighter.js';
import * as status from '/shared/sim/status.js';
import * as resources from '/shared/sim/resources.js';
import { TICK_RATE } from '/shared/constants.js';
import { Renderer } from '../render/renderer.js';
import { shapeBox } from './core.js';

const STEP_MS = 1000 / TICK_RATE;
const GAP = 150; // default px between the Lab fighter and the dummy (moves without hitboxes)

/** Dummy distance that a move's hitboxes actually reach (forward edge, a bit inside). */
function gapFor(def) {
  const hbs = def?.hitboxes || [];
  if (!hbs.length) return GAP;
  const reach = Math.max(...hbs.map((h) => { try { return shapeBox(h).x2; } catch { return 0; } }));
  return Math.max(36, Math.min(220, reach + 8));
}

export class Sandbox {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} o { characters (Map id→entry), entry (lab char), dummy (entry), stage, onLog(line) }
   */
  constructor(canvas, o) {
    this.canvas = canvas;
    this.o = o;
    this.renderer = new Renderer(canvas, o.stage, o.characters);
    this.renderer.resize = () => this.resize();
    this.resize();
    this.running = false;
    this.speed = 1;
    this.acc = 0;
    this.dummyPercent = 60;
    this.reset();
  }

  resize() {
    const r = this.renderer, c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    r.dpr = dpr;
    c.width = Math.max(1, Math.floor((c.clientWidth || 640) * dpr));
    c.height = Math.max(1, Math.floor((c.clientHeight || 360) * dpr));
    r.cam.w = c.width; r.cam.h = c.height;
  }

  reset() {
    const { entry, dummy, stage } = this.o;
    this.game = new Game({
      stage,
      rules: { infinite: true, countdown: false, seed: 7, governor: true },
      players: [
        { id: 'lab', name: entry.character.name, character: entry.character },
        { id: 'dummy', name: 'Dummy', character: dummy.character },
      ],
    });
    this.renderer.setRoster(this.game.roster());
    this.renderer.showHitboxes = !!this.o.boxes;
    this.place();
  }

  get lab() { return this.game.fighter('lab'); }
  get dummy() { return this.game.fighter('dummy'); }

  /** Lab fighter left of center facing right, dummy `gap` px in front at dummyPercent. */
  place(gap = GAP) {
    const a = this.lab, d = this.dummy;
    Object.assign(a, { x: -gap / 2, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, grounded: true, platform: -1, facing: 1 });
    Object.assign(d, { x: gap / 2, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, grounded: true, platform: -1, facing: -1, percent: this.dummyPercent });
    this.game.setState?.(a, 'idle');
    this.game.setState?.(d, 'idle');
  }

  /** Fires a pool move by name (airborne moves start from a short hop). */
  perform(name) {
    const f = this.lab;
    const def = f.char.moves[name];
    if (!def) return;
    this.place(gapFor(def));
    if (def.category === 'aerial' || def.requires?.airborne) { f.y = -90; f.grounded = false; f.vy = -2; }
    startAction(f, def, { name, trigger: null });
    this.log(`▶ ${name}`, 'move');
  }

  spawnEntity(name) {
    const f = this.lab;
    const e = spawn(f, name, { x: 30, y: -Math.round((f.collider?.h || 80) * 0.5) });
    this.log(e ? `✦ spawn ${name}` : `✦ spawn ${name} refused`, 'move');
  }

  setForm(name) { try { setForm(this.lab, name, { force: true }); } catch (e) { this.log(`form: ${e.message}`, 'err'); } }
  setResource(name, v) { try { resources.set(this.lab, name, v); } catch { /* not a resource */ } }
  toggleStatus(name, on) {
    const f = this.lab;
    if (on) status.apply(f, name, { source: f });
    else status.remove(f, name);
  }

  log(text, kind = 'gov') { this.o.onLog?.({ frame: this.game.frame, text, kind }); }

  tick() {
    if (this.repeat && this.game.frame % 100 === 10) this.perform(this.repeat); // &sbmove=<move>
    this.game.step();
    this.dummy.percent = Math.max(this.dummy.percent, 0);
    const ev = this.game.drainEvents();
    for (const e of ev) {
      if (e.type === 'gov') this.log(`GOV ${e.rule}${e.amount ? ` ${e.amount}` : ''}${e.target ? ` → ${e.target}` : ''}`, 'gov');
      else if (e.type === 'hit' && e.attacker === 'lab') this.log(`hit ${e.damage}% kb ${e.kb} ∠${e.angle} → ${e.target} (${Math.round(e.percent)}%)`, 'hit');
      else if (e.type === 'ko') this.log(`KO ${e.id}`, 'gov');
    }
    this.renderer.handleEvents(ev, null);
    // Keep the dummy on stage: reset it when it flies far.
    const d = this.dummy;
    if (Math.abs(d.x) > 700 || d.y < -700 || d.state === 'dead') this.place();
  }

  /** Compact damage readout (the in-game HUD is sized for a full window). */
  drawPercent() {
    const ctx = this.renderer.ctx, k = this.renderer.dpr || 1;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.font = '700 14px Rajdhani, sans-serif';
    ctx.textBaseline = 'top';
    const pct = (f) => `${Math.round(f.percent)}%`;
    ctx.fillStyle = 'rgba(10,5,20,0.6)'; ctx.fillRect(6, 6, 150, 22);
    ctx.fillStyle = '#fff6ec'; ctx.fillText(`you ${pct(this.lab)} · dummy ${pct(this.dummy)}`, 12, 9);
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = () => {
      if (!this.running) return;
      // performance.now, not the rAF timestamp: under load the latter can lag far behind.
      const now = performance.now();
      this.acc += Math.max(0, Math.min(100, now - last)) * this.speed;
      last = now;
      while (this.acc >= STEP_MS) { this.acc -= STEP_MS; this.tick(); }
      this.renderer.render(this.game.snapshot(), { infinite: true, hud: false });
      this.drawPercent();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }
}
