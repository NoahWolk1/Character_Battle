// Synthesized sound kit + character sound router (spec §6.4). No audio files needed:
// engine sounds and the preset library are built from oscillators and filtered noise.
//
//   audio.play('boing', { volume, pitch, bus, owner })   preset | asset name | SynthSpec
//   audio.charSound(ownerId, key, { art, assets, volume, pitch })   art.sounds routing + rate cap
//   audio.decode(arrayBuffer) → AudioBuffer              (art-host asset loader)
//
// Mixer: master ← compressor; buses `hit`, `char`, `ui`. Hit sounds duck the char bus.
// Budgets: ≤ 8 character sounds per rolling second per owner. Safe to import under node
// (no window/localStorage access unless present).

/** The preset synth library (§6.4). */
export const SOUND_PRESETS = Object.freeze([
  'zip', 'buzz-thwack', 'clank', 'boom', 'squeak', 'zap', 'splash', 'whoosh',
  'crunch', 'chime', 'roar', 'alarm', 'boing', 'honk', 'thunder', 'gulp',
]);

export const AUDIO_LIMITS = Object.freeze({ perSecond: 8, maxDur: 2, maxGain: 1, minFreq: 20, maxFreq: 12000, duck: 0.45, duckSec: 0.22 });
const WAVES = ['sine', 'square', 'sawtooth', 'triangle', 'noise'];
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Validates a SynthSpec {type, freq:[a,b]|number, dur, gain, vibrato}; returns a safe
 * copy or null. vibrato: number (depth as a fraction of freq, ≤ 0.5, 7 Hz) or {rate, depth}.
 */
export function normalizeSynthSpec(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const type = WAVES.includes(s.type) ? s.type : 'sine';
  const fr = Array.isArray(s.freq) ? s.freq : [s.freq, s.freq];
  const f0 = clamp(num(fr[0], 440), AUDIO_LIMITS.minFreq, AUDIO_LIMITS.maxFreq);
  const f1 = clamp(num(fr[1], f0), AUDIO_LIMITS.minFreq, AUDIO_LIMITS.maxFreq);
  let vib = null;
  if (typeof s.vibrato === 'number' && s.vibrato > 0) vib = { rate: 7, depth: clamp(s.vibrato, 0, 0.5) };
  else if (s.vibrato && typeof s.vibrato === 'object') vib = { rate: clamp(num(s.vibrato.rate, 7), 0.1, 40), depth: clamp(num(s.vibrato.depth, 0.05), 0, 0.5) };
  return {
    type, freq: [f0, f1], dur: clamp(num(s.dur, 0.2), 0.01, AUDIO_LIMITS.maxDur),
    gain: clamp(num(s.gain, 0.2), 0, AUDIO_LIMITS.maxGain), vibrato: vib,
  };
}

/**
 * Resolves a sound key against art.sounds / assets / presets.
 * Returns {kind:'mute'} | {kind:'asset', buffer} | {kind:'preset', name} | {kind:'synth', spec} | null (unmapped).
 * Order: art.sounds[key] (null mutes) → asset named key → preset named key.
 */
export function resolveSound(key, { sounds, assets } = {}) {
  let v = key;
  if (typeof key === 'string' && sounds && typeof sounds === 'object' && Object.prototype.hasOwnProperty.call(sounds, key)) {
    v = sounds[key];
    if (v === null || v === false) return { kind: 'mute' };
  }
  if (typeof v === 'string') {
    const buf = assets && Object.prototype.hasOwnProperty.call(assets, v) ? assets[v] : undefined;
    if (buf && typeof buf === 'object' && typeof buf.duration === 'number') return { kind: 'asset', buffer: buf, name: v };
    if (SOUND_PRESETS.includes(v)) return { kind: 'preset', name: v };
    return null;
  }
  const spec = normalizeSynthSpec(v);
  return spec ? { kind: 'synth', spec } : null;
}

/** Rolling-window rate cap: ≤ `max` accepted calls per `win` seconds per key. */
export class RateCap {
  constructor(max = AUDIO_LIMITS.perSecond, win = 1) { this.max = max; this.win = win; this.q = new Map(); }
  take(key, now) {
    let a = this.q.get(key);
    if (!a) { a = []; this.q.set(key, a); }
    while (a.length && now - a[0] >= this.win) a.shift();
    if (a.length >= this.max) return false;
    a.push(now);
    return true;
  }
  clear() { this.q.clear(); }
}

const hasWindow = typeof window !== 'undefined';
const store = {
  get(k) { try { return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } },
  set(k, v) { try { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export class Audio {
  /**
   * @param {object} [o]
   * @param {() => AudioContext} [o.context]  factory (tests inject a fake)
   * @param {boolean} [o.autoUnlock=true]     init on first pointer/key (browser)
   */
  constructor(o = {}) {
    this.ctx = null;
    this.factory = o.context || null;
    this.volume = Number(store.get('cb.volume') ?? 0.5);
    if (!Number.isFinite(this.volume)) this.volume = 0.5;
    this.rate = new RateCap();
    this.muted = new Set();      // owners muted (e.g. a hook that spams)
    this.stats = { played: 0, capped: 0, muted: 0 };
    if (o.autoUnlock !== false && hasWindow && window.addEventListener) {
      const unlock = () => { this.init(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
    }
  }

  init() {
    if (this.ctx) return;
    try {
      const AC = this.factory || (hasWindow ? () => new (window.AudioContext || window.webkitAudioContext)() : null);
      if (!AC) return;
      const c = AC();
      this.ctx = c;
      this.master = c.createGain();
      this.master.gain.value = this.volume;
      const comp = c.createDynamicsCompressor();
      this.master.connect(comp).connect(c.destination);
      // buses: hit (engine impacts), char (character sounds, ducked under hits), ui
      this.buses = {};
      for (const b of ['hit', 'char', 'ui']) { const g = c.createGain(); g.gain.value = 1; g.connect(this.master); this.buses[b] = g; }
      const len = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      let s = 0x2545f491;   // fixed-seed noise: identical texture every session
      for (let i = 0; i < len; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
      this.bus = 'hit';
    } catch { this.ctx = null; }
  }

  setVolume(v) { this.volume = v; store.set('cb.volume', v); if (this.master) this.master.gain.value = v; }

  /** Decodes an encoded sound (ArrayBuffer) into an AudioBuffer, for art.assets. */
  async decode(arrayBuffer) {
    this.init();
    if (this.ctx?.decodeAudioData) return this.ctx.decodeAudioData(arrayBuffer);
    if (typeof OfflineAudioContext !== 'undefined') return new OfflineAudioContext(1, 1, 44100).decodeAudioData(arrayBuffer);
    return null;
  }

  out(bus) { return this.buses?.[bus || this.bus] || this.master; }

  /** Briefly lowers the character bus under a hit (global mixer ducking). */
  duck(amount = AUDIO_LIMITS.duck, sec = AUDIO_LIMITS.duckSec) {
    const g = this.buses?.char?.gain;
    if (!g) return;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues?.(t);
    g.setValueAtTime(amount, t);
    g.linearRampToValueAtTime(1, t + sec);
  }

  // ── Primitives ────────────────────────────────────────────────────────────
  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.15, gain = 0.3, delay = 0, vibrato = null, bus = null, attack = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (vibrato) {
      const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      lfo.frequency.value = vibrato.rate; lg.gain.value = vibrato.depth * (f0 + f1) / 2;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.02);
    }
    if (attack > 0) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack); }
    else g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(bus));
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, gain = 0.3, freq = 1200, q = 1, type = 'bandpass', f1 = freq, delay = 0, bus = null, attack = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(40, freq), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = this.ctx.createGain();
    if (attack > 0) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack); }
    else g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out(bus));
    s.start(t, (this.noiseOff = ((this.noiseOff || 0) + 0.137) % 0.5)); s.stop(t + dur + 0.02);
  }

  /** Plays a decoded AudioBuffer (art asset). */
  sample(buffer, { volume = 1, pitch = 1, bus = 'char' } = {}) {
    if (!this.ctx || !buffer) return;
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = clamp(pitch, 0.25, 4);
    const g = this.ctx.createGain();
    g.gain.value = clamp(volume, 0, 1);
    s.connect(g).connect(this.out(bus));
    s.start();
  }

  /** Plays a SynthSpec (already normalized or raw). */
  synth(spec, { volume = 1, pitch = 1, bus = 'char' } = {}) {
    const s = spec?.freq && spec.dur ? spec : normalizeSynthSpec(spec);
    if (!s) return;
    const gain = s.gain * clamp(volume, 0, 1);
    if (s.type === 'noise') this.noise({ dur: s.dur, gain, freq: s.freq[0] * pitch, f1: s.freq[1] * pitch, q: 1.2, bus });
    else this.tone({ type: s.type, f0: s.freq[0] * pitch, f1: s.freq[1] * pitch, dur: s.dur, gain, vibrato: s.vibrato, bus });
  }

  /** Plays a preset by name. Unknown names are ignored. */
  preset(name, { volume = 1, pitch = 1, bus = 'char' } = {}) {
    const fn = PRESET_FNS[name];
    if (!fn || !this.ctx) return false;
    const v = clamp(volume, 0, 1), p = clamp(pitch, 0.25, 4);
    const prev = this.bus;
    this.bus = bus;
    try { fn(this, v, p); } finally { this.bus = prev; }
    return true;
  }

  /**
   * Generic entry: key = preset name | asset name | SynthSpec, resolved through
   * art.sounds when `sounds` is given. Returns true when something played.
   */
  play(key, { volume = 1, pitch = 1, bus = 'char', sounds, assets } = {}) {
    const r = resolveSound(key, { sounds, assets });
    if (!r || r.kind === 'mute') return false;
    this.init();
    if (!this.ctx) return false;
    if (r.kind === 'asset') this.sample(r.buffer, { volume, pitch, bus });
    else if (r.kind === 'preset') this.preset(r.name, { volume, pitch, bus });
    else this.synth(r.spec, { volume, pitch, bus });
    this.stats.played++;
    return true;
  }

  /**
   * Character sound with the per-owner rate cap (≤ 8/s). `key` is an engine event,
   * move name, custom name, timeline sfx key, preset or SynthSpec.
   * Returns 'played' | 'muted' | 'capped' | 'unmapped' | 'off'.
   */
  charSound(owner, key, { art, assets, volume = 1, pitch = 1, now } = {}) {
    const r = resolveSound(key, { sounds: art?.sounds, assets: assets || art?.assetsLoaded });
    if (!r) return 'unmapped';
    if (r.kind === 'mute' || this.muted.has(owner)) { this.stats.muted++; return 'muted'; }
    const t = now ?? (this.ctx ? this.ctx.currentTime : nowSec());
    if (!this.rate.take(owner ?? '_', t)) { this.stats.capped++; return 'capped'; }
    if (!this.ctx) return 'off';
    if (r.kind === 'asset') this.sample(r.buffer, { volume, pitch, bus: 'char' });
    else if (r.kind === 'preset') this.preset(r.name, { volume, pitch, bus: 'char' });
    else this.synth(r.spec, { volume, pitch, bus: 'char' });
    this.stats.played++;
    return 'played';
  }

  // ── Engine sounds (v1 kit; routed to the hit/ui buses) ─────────────────────
  hit(damage, kb, effect) {
    const p = Math.min(1, kb / 140);
    this.bus = 'hit';
    this.duck();
    this.noise({ dur: 0.08 + p * 0.25, gain: 0.35 + p * 0.3, freq: 2400 - p * 1500, f1: 300, q: 0.8 });
    this.tone({ type: 'square', f0: 220 - p * 120, f1: 50, dur: 0.1 + p * 0.25, gain: 0.18 + p * 0.2 });
    if (effect === 'electric') this.tone({ type: 'sawtooth', f0: 900, f1: 1800, dur: 0.12, gain: 0.08 });
    if (effect === 'fire') this.noise({ dur: 0.3, gain: 0.15, freq: 600, f1: 200, type: 'lowpass' });
    if (effect === 'ice' || effect === 'magic' || effect === 'light') this.tone({ type: 'triangle', f0: 1400, f1: 2200, dur: 0.18, gain: 0.08 });
    if (effect === 'water') this.noise({ dur: 0.22, gain: 0.14, freq: 900, f1: 2600, q: 4 });
    if (effect === 'slash') this.noise({ dur: 0.1, gain: 0.12, freq: 5200, f1: 2600, type: 'highpass' });
    if (effect === 'dark' || effect === 'poison') this.tone({ type: 'sawtooth', f0: 140, f1: 70, dur: 0.22, gain: 0.07 });
    if (effect === 'earth') this.noise({ dur: 0.25, gain: 0.2, freq: 260, f1: 90, type: 'lowpass' });
    if (p > 0.75) this.tone({ type: 'sine', f0: 90, f1: 30, dur: 0.5, gain: 0.45 });
  }

  /** Governor feedback: soft muted thud for trimmed damage, metallic ping for armor, BREAK sting. */
  resisted() { this.bus = 'hit'; this.noise({ dur: 0.1, gain: 0.12, freq: 500, f1: 260, type: 'lowpass' }); this.tone({ type: 'triangle', f0: 320, f1: 240, dur: 0.08, gain: 0.05 }); }
  armor() { this.bus = 'hit'; this.tone({ type: 'square', f0: 1900, f1: 1500, dur: 0.12, gain: 0.07 }); this.tone({ type: 'triangle', f0: 2800, f1: 2600, dur: 0.3, gain: 0.06, delay: 0.01 }); this.noise({ dur: 0.06, gain: 0.12, freq: 4200, f1: 3000, q: 3 }); }
  breakSting() {
    this.bus = 'hit';
    this.noise({ dur: 0.35, gain: 0.3, freq: 5200, f1: 900, q: 0.7 });
    [660, 880, 1320].forEach((f, i) => this.tone({ type: 'square', f0: f, f1: f * 0.98, dur: 0.14, gain: 0.06, delay: i * 0.05 }));
  }
  tired() { this.bus = 'char'; this.tone({ type: 'sine', f0: 420, f1: 180, dur: 0.35, gain: 0.07, vibrato: { rate: 9, depth: 0.04 } }); this.noise({ dur: 0.3, gain: 0.05, freq: 900, f1: 400, type: 'lowpass' }); }

  whoosh(s = 1) { this.bus = 'char'; this.noise({ dur: 0.12 * s, gain: 0.07 * s, freq: 500, f1: 2500, q: 2 }); }
  jump(pitch = 1) { this.bus = 'char'; this.tone({ type: 'sine', f0: 260 * pitch, f1: 520 * pitch, dur: 0.1, gain: 0.08 }); }
  land() { this.bus = 'char'; this.noise({ dur: 0.12, gain: 0.18, freq: 300, f1: 80, type: 'lowpass' }); }
  shield() { this.bus = 'hit'; this.tone({ type: 'triangle', f0: 700, f1: 500, dur: 0.08, gain: 0.12 }); }
  shieldBreak() { this.bus = 'hit'; this.tone({ type: 'square', f0: 900, f1: 100, dur: 0.6, gain: 0.2 }); this.noise({ dur: 0.5, gain: 0.3, freq: 3000, f1: 400 }); }
  clank() { this.bus = 'hit'; this.tone({ type: 'square', f0: 1500, f1: 1200, dur: 0.1, gain: 0.12 }); }
  shoot(effect) { this.bus = 'char'; this.tone({ type: effect === 'electric' ? 'sawtooth' : 'triangle', f0: 500, f1: 1100, dur: 0.12, gain: 0.08 }); }
  ko() {
    this.bus = 'hit';
    this.tone({ type: 'sine', f0: 120, f1: 25, dur: 1.1, gain: 0.6 });
    this.noise({ dur: 1.0, gain: 0.4, freq: 1800, f1: 120, q: 0.6 });
    this.tone({ type: 'sawtooth', f0: 1200, f1: 200, dur: 0.6, gain: 0.1, delay: 0.05 });
  }
  countdown(n) { this.bus = 'ui'; this.tone({ type: 'square', f0: n > 0 ? 440 : 880, dur: n > 0 ? 0.15 : 0.4, gain: 0.12 }); }
  gameSet() { this.bus = 'ui'; [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.35, gain: 0.12, delay: i * 0.1 })); }
  ui() { this.bus = 'ui'; this.tone({ type: 'triangle', f0: 880, f1: 1200, dur: 0.06, gain: 0.06 }); }
  select() { this.bus = 'ui'; this.tone({ type: 'triangle', f0: 660, f1: 990, dur: 0.12, gain: 0.1 }); this.tone({ type: 'sine', f0: 1320, dur: 0.15, gain: 0.05, delay: 0.06 }); }
}

function nowSec() { return (typeof performance !== 'undefined' ? performance.now() : 0) / 1000; }

// ── Preset recipes: (audio, volume, pitch) ────────────────────────────────────
// Each is a few layered oscillators/noise bursts tuned to read clearly under the mix.
const PRESET_FNS = {
  zip: (a, v, p) => { a.tone({ type: 'sawtooth', f0: 300 * p, f1: 2400 * p, dur: 0.11, gain: 0.07 * v }); a.noise({ dur: 0.09, gain: 0.05 * v, freq: 1500 * p, f1: 6000 * p, q: 3 }); },
  'buzz-thwack': (a, v, p) => {
    a.tone({ type: 'sawtooth', f0: 110 * p, f1: 90 * p, dur: 0.14, gain: 0.09 * v, vibrato: { rate: 30, depth: 0.08 } });
    a.noise({ dur: 0.12, gain: 0.3 * v, freq: 1800 * p, f1: 250, q: 0.9, delay: 0.1 });
    a.tone({ type: 'square', f0: 200 * p, f1: 55, dur: 0.14, gain: 0.14 * v, delay: 0.1 });
  },
  clank: (a, v, p) => { a.tone({ type: 'square', f0: 1500 * p, f1: 1250 * p, dur: 0.12, gain: 0.1 * v }); a.tone({ type: 'triangle', f0: 2300 * p, f1: 2200 * p, dur: 0.35, gain: 0.05 * v }); a.noise({ dur: 0.05, gain: 0.14 * v, freq: 4000 * p, f1: 3000, q: 4 }); },
  boom: (a, v, p) => { a.tone({ type: 'sine', f0: 110 * p, f1: 28, dur: 0.9, gain: 0.55 * v }); a.noise({ dur: 0.8, gain: 0.35 * v, freq: 900 * p, f1: 60, type: 'lowpass', q: 0.7 }); },
  squeak: (a, v, p) => { a.tone({ type: 'square', f0: 1300 * p, f1: 2100 * p, dur: 0.08, gain: 0.05 * v }); a.tone({ type: 'sine', f0: 2100 * p, f1: 1500 * p, dur: 0.09, gain: 0.06 * v, delay: 0.07 }); },
  zap: (a, v, p) => {
    a.tone({ type: 'sawtooth', f0: 1800 * p, f1: 300 * p, dur: 0.16, gain: 0.08 * v, vibrato: { rate: 38, depth: 0.2 } });
    a.noise({ dur: 0.12, gain: 0.12 * v, freq: 5000 * p, f1: 2000, type: 'highpass' });
  },
  splash: (a, v, p) => { a.noise({ dur: 0.35, gain: 0.25 * v, freq: 700 * p, f1: 3200 * p, q: 1.6 }); a.noise({ dur: 0.25, gain: 0.12 * v, freq: 2500 * p, f1: 900, q: 6, delay: 0.06 }); a.tone({ type: 'sine', f0: 600 * p, f1: 1300 * p, dur: 0.06, gain: 0.05 * v }); },
  whoosh: (a, v, p) => { a.noise({ dur: 0.22, gain: 0.12 * v, freq: 400 * p, f1: 2600 * p, q: 1.8, attack: 0.05 }); },
  crunch: (a, v, p) => { for (let i = 0; i < 4; i++) a.noise({ dur: 0.05, gain: 0.22 * v, freq: (900 + i * 500) * p, f1: 300, q: 1.2, delay: i * 0.028 }); a.tone({ type: 'square', f0: 140 * p, f1: 60, dur: 0.12, gain: 0.08 * v }); },
  chime: (a, v, p) => { [1046, 1318, 1568].forEach((f, i) => a.tone({ type: 'triangle', f0: f * p, f1: f * p, dur: 0.6, gain: 0.06 * v, delay: i * 0.06 })); a.tone({ type: 'sine', f0: 2093 * p, dur: 0.8, gain: 0.03 * v, delay: 0.12 }); },
  roar: (a, v, p) => {
    a.tone({ type: 'sawtooth', f0: 95 * p, f1: 70 * p, dur: 0.9, gain: 0.16 * v, vibrato: { rate: 14, depth: 0.12 }, attack: 0.08 });
    a.noise({ dur: 0.9, gain: 0.22 * v, freq: 700 * p, f1: 300, q: 0.8, attack: 0.1 });
  },
  alarm: (a, v, p) => { for (let i = 0; i < 4; i++) a.tone({ type: 'square', f0: (i % 2 ? 660 : 880) * p, f1: (i % 2 ? 660 : 880) * p, dur: 0.12, gain: 0.06 * v, delay: i * 0.13 }); },
  boing: (a, v, p) => { a.tone({ type: 'sine', f0: 180 * p, f1: 520 * p, dur: 0.3, gain: 0.12 * v, vibrato: { rate: 16, depth: 0.12 } }); a.tone({ type: 'triangle', f0: 90 * p, f1: 260 * p, dur: 0.22, gain: 0.06 * v }); },
  honk: (a, v, p) => { a.tone({ type: 'sawtooth', f0: 330 * p, f1: 310 * p, dur: 0.28, gain: 0.09 * v, attack: 0.02 }); a.tone({ type: 'square', f0: 415 * p, f1: 392 * p, dur: 0.28, gain: 0.05 * v, attack: 0.02 }); },
  thunder: (a, v, p) => {
    a.noise({ dur: 0.12, gain: 0.45 * v, freq: 4200 * p, f1: 1200, q: 0.5 });
    a.noise({ dur: 1.4, gain: 0.4 * v, freq: 500 * p, f1: 50, type: 'lowpass', q: 0.6, delay: 0.05, attack: 0.04 });
    a.tone({ type: 'sine', f0: 70 * p, f1: 30, dur: 1.2, gain: 0.35 * v, delay: 0.05 });
  },
  gulp: (a, v, p) => { a.tone({ type: 'sine', f0: 320 * p, f1: 120 * p, dur: 0.14, gain: 0.14 * v }); a.tone({ type: 'sine', f0: 220 * p, f1: 90 * p, dur: 0.12, gain: 0.1 * v, delay: 0.12 }); a.noise({ dur: 0.08, gain: 0.05 * v, freq: 600 * p, f1: 300, type: 'lowpass', delay: 0.04 }); },
};
