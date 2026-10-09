// Minimal Web Audio stand-in: records created nodes and scheduled gain values.
export function fakeAudioContext() {
  const log = { nodes: [], started: 0 };
  const param = (v = 0) => ({
    value: v, events: [],
    setValueAtTime(x, t) { this.events.push(['set', x, t]); }, exponentialRampToValueAtTime(x, t) { this.events.push(['exp', x, t]); },
    linearRampToValueAtTime(x, t) { this.events.push(['lin', x, t]); }, cancelScheduledValues() { this.events.push(['cancel']); },
  });
  const node = (kind, extra = {}) => {
    const n = { kind, connect(o) { return o; }, start() { log.started++; }, stop() {}, ...extra };
    log.nodes.push(n);
    return n;
  };
  const ctx = {
    log, currentTime: 0, sampleRate: 8000, destination: node('dest'),
    createGain: () => node('gain', { gain: param(1) }),
    createOscillator: () => node('osc', { frequency: param(440), type: 'sine' }),
    createBiquadFilter: () => node('filter', { frequency: param(1000), Q: param(1), type: 'lowpass' }),
    createDynamicsCompressor: () => node('comp'),
    createBufferSource: () => node('src', { buffer: null, playbackRate: param(1) }),
    createBuffer: (ch, len) => { const d = new Float32Array(len); return { getChannelData: () => d, duration: len / 8000 }; },
    decodeAudioData: async () => ({ duration: 0.5 }),
  };
  return ctx;
}
