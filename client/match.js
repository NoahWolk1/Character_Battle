// Match runners: LocalMatch (training / local VS, simulated in the browser) and
// OnlineMatch (server-authoritative, rendered with snapshot interpolation).
import { Game } from '../shared/sim/game.js';
import { MATCH, TICK_RATE } from '../shared/constants.js';
import { pollSource, encodeInput, blankInput, PadEdges } from './input.js';

const STEP_MS = 1000 / TICK_RATE;
export const PROTOCOL = 2; // must equal server/rooms.js PROTOCOL

/**
 * {charId: hash} for the characters this page loaded (entries carry `hash` from
 * /api/characters). Sent as client:hello so the server can reject stale clients.
 */
export function characterHashes(characters) {
  const out = {};
  for (const [id, e] of characters || []) if (e && typeof e.hash === 'string') out[id] = e.hash;
  return out;
}

/** Tells the server which character versions this client runs (call on every connect). */
export function sendHello(socket, characters) {
  socket.emit('client:hello', { protocol: PROTOCOL, hashes: characterHashes(characters) });
}

function resultsFrom(fighters) {
  return fighters
    .map((f) => ({ id: f.id, name: f.name, charId: f.charId, placement: f.placement || 1, kos: f.kos, falls: f.falls, damageDealt: Math.round(f.damageDealt) }))
    .sort((a, b) => a.placement - b.placement);
}

export class LocalMatch {
  /**
   * players: [{ id, name, charId, cpu?, source? }]
   */
  constructor({ renderer, audio, stage, characters, players, rules = {}, training = false, hud = true, onEnd, onPause }) {
    this.hud = hud;
    this.renderer = renderer;
    this.audio = audio;
    this.training = training;
    this.onEnd = onEnd;
    this.onPause = onPause;
    this.sources = new Map(players.filter((p) => p.source).map((p) => [p.id, p.source]));
    this.game = new Game({
      stage,
      rules: training ? { infinite: true, countdown: false, ...rules } : rules,
      players: players.map((p) => ({ id: p.id, name: p.name, character: characters.get(p.charId).character, cpu: p.cpu || null })),
    });
    renderer.setRoster(this.game.roster());
    renderer.showHitboxes = false;
    this.paused = false;
    this.running = false;
    this.pad = new PadEdges();
    this.acc = 0;
    this.endTimer = 0;
    this.keyHandler = (e) => {
      if (!this.hud) return; // attract mode ignores keys
      if (e.code === 'Escape' || e.code === 'KeyP') { this.togglePause(); }
      if (this.training && e.code === 'KeyH') renderer.showHitboxes = !renderer.showHitboxes;
      if (this.training && e.code === 'KeyR') this.resetTraining();
      if (this.training && e.code === 'KeyY') this.slowmo = !this.slowmo; // T is taunt
    };
  }

  start() {
    this.running = true;
    window.addEventListener('keydown', this.keyHandler);
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      let dt = Math.min(100, now - this.last);
      this.last = now;
      if (this.hud && this.pad.pressed(9)) this.togglePause(); // gamepad Start
      if (!this.paused) {
        this.acc += this.slowmo ? dt / 4 : dt;
        while (this.acc >= STEP_MS) { this.acc -= STEP_MS; this.tick(); }
      }
      if (!this.running) return;
      this.renderer.render(this.game.snapshot(), { infinite: this.game.rules.infinite, paused: this.paused, hud: this.hud });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  tick() {
    for (const [id, src] of this.sources) this.game.setInput(id, pollSource(src));
    this.game.step();
    this.renderer.handleEvents(this.game.drainEvents(), this.audio);
    if (this.game.phase === 'ended' && ++this.endTimer > MATCH.endDelay) {
      this.stop();
      this.onEnd?.({ results: resultsFrom(this.game.fighters), winner: this.game.winner });
    }
  }

  resetTraining() {
    for (const f of this.game.fighters) {
      const spawn = this.game.stage.spawns[f.index];
      Object.assign(f, { x: spawn.x, y: spawn.y, vx: 0, vy: 0, kx: 0, ky: 0, percent: 0, grounded: true, platform: -1, facing: spawn.facing });
      this.game.setState(f, 'idle');
    }
  }

  togglePause() {
    if (this.game.phase === 'ended') return;
    this.paused = !this.paused;
    this.onPause?.(this.paused);
  }

  /** Idempotent unpause (the pause menu's Resume button). */
  resume() { if (this.paused) this.togglePause(); }

  stop() {
    this.running = false;
    window.removeEventListener('keydown', this.keyHandler);
  }
}

export class OnlineMatch {
  /**
   * start: the match:start payload {protocol, roster, seed, stageId, rules} (or pass roster).
   * onAbort({reason, character, message}): match:aborted (defaults to onEnd with no results).
   */
  constructor({ renderer, audio, net, roster, start, source, onEnd, onAbort, onPause }) {
    this.renderer = renderer;
    this.audio = audio;
    this.net = net;
    this.source = source;
    this.onEnd = onEnd;
    this.onPause = onPause;
    this.info = start || { protocol: 1, roster };
    if (this.info.protocol !== PROTOCOL) console.warn(`server protocol ${this.info.protocol}, client ${PROTOCOL} — refresh the page`);
    roster = this.info.roster || roster;
    this.snaps = [];
    this.offset = null; // local time - server frame time
    this.lastMask = -1;
    this.sentAt = 0;
    renderer.setRoster(roster);
    renderer.showHitboxes = false;
    this.onSnap = ({ s, e }) => {
      const now = performance.now();
      const o = now - s.frame * STEP_MS;
      // Track the smallest observed offset (= least-delayed packet), drift slowly upward.
      this.offset = this.offset === null ? o : Math.min(o, this.offset + 0.5);
      this.snaps.push(s);
      if (this.snaps.length > 40) this.snaps.shift();
      this.renderer.handleEvents(e, this.audio);
    };
    this.onMatchEnd = (data) => { this.stop(); this.onEnd?.(data); };
    this.onAborted = (data) => {
      this.stop();
      console.warn('match aborted', data);
      if (onAbort) onAbort(data);
      else this.onEnd?.({ results: [], winner: null, aborted: data });
    };
    this.keyHandler = (e) => { if (e.code === 'Escape') this.toggleMenu(); };
    this.pad = new PadEdges();
  }

  toggleMenu() { this.menuOpen = !this.menuOpen; this.onPause?.(this.menuOpen); }
  /** Idempotent close of the pause menu (the match keeps running online). */
  resume() { if (this.menuOpen) this.toggleMenu(); }

  start() {
    this.running = true;
    this.net.socket.on('snap', this.onSnap);
    this.net.socket.on('match:end', this.onMatchEnd);
    this.net.socket.on('match:aborted', this.onAborted);
    window.addEventListener('keydown', this.keyHandler);
    const loop = () => {
      if (!this.running) return;
      if (this.pad.pressed(9)) this.toggleMenu(); // gamepad Start
      this.sendInput();
      const view = this.interpolated();
      if (view) this.renderer.render(view, {});
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  sendInput() {
    const input = this.menuOpen ? blankInput() : pollSource(this.source);
    const mask = encodeInput(input);
    const now = performance.now();
    if (mask !== this.lastMask || now - this.sentAt > 100) {
      this.net.socket.volatile.emit('input', mask);
      this.lastMask = mask;
      this.sentAt = now;
    }
  }

  interpolated() {
    const snaps = this.snaps;
    if (!snaps.length) return null;
    const renderFrame = (performance.now() - this.offset) / STEP_MS - 5; // ~83 ms buffer
    let a = null, b = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].frame <= renderFrame) { a = snaps[i]; b = snaps[i + 1] || null; break; }
    }
    if (!a) return snaps[0];
    if (!b) return a;
    const t = (renderFrame - a.frame) / (b.frame - a.frame);
    const lerp = (x, y) => x + (y - x) * t;
    const prevF = new Map(a.fighters.map((f) => [f.id, f]));
    const prevP = new Map((a.projectiles || []).map((p) => [p.id, p]));
    const prevE = new Map((a.entities || []).map((e) => [e.i, e]));
    return {
      ...b,
      fighters: b.fighters.map((f) => {
        const p = prevF.get(f.id);
        if (!p || Math.hypot(f.x - p.x, f.y - p.y) > 200) return f;
        const useA = t < 0.5;
        return { ...(useA ? p : f), x: lerp(p.x, f.x), y: lerp(p.y, f.y), percent: f.percent, stocks: f.stocks };
      }),
      projectiles: (b.projectiles || []).map((q) => {
        const p = prevP.get(q.id);
        return p ? { ...q, x: lerp(p.x, q.x), y: lerp(p.y, q.y) } : q;
      }),
      entities: (b.entities || []).map((q) => {
        const p = prevE.get(q.i);
        if (!p || Math.abs(q.x - p.x) + Math.abs(q.y - p.y) > 300) return q;
        return { ...q, x: lerp(p.x, q.x), y: lerp(p.y, q.y) };
      }),
    };
  }

  stop() {
    this.running = false;
    this.net.socket.off('snap', this.onSnap);
    this.net.socket.off('match:end', this.onMatchEnd);
    this.net.socket.off('match:aborted', this.onAborted);
    window.removeEventListener('keydown', this.keyHandler);
  }
}
