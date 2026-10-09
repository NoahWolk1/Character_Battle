// Recording 2D-context stand-in for node tests (no DOM). Every method call is logged
// as [name, ...args]; gradients and measureText return usable objects.
export function mockCtx() {
  const calls = [];
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over', font: '10px sans-serif', lineWidth: 1 };
  const stack = [];
  const gradient = () => ({ addColorStop() {} });
  const special = {
    createLinearGradient: gradient, createRadialGradient: gradient, createPattern: () => ({}),
    measureText: (t) => ({ width: String(t).length * (parseFloat(/(\d+)px/.exec(state.font)?.[1]) || 10) * 0.6 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    save: () => { stack.push({ ...state }); },
    restore: () => { if (stack.length) Object.assign(state, stack.pop()); },
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k === 'depth') return stack.length;
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      return (...args) => { calls.push([k, ...args]); return special[k] ? special[k](...args) : undefined; };
    },
    set(t, k, v) { t[k] = v; calls.push(['set:' + String(k), v]); return true; },
    has() { return true; },
  });
  ctx.canvas = { width: 800, height: 600 };
  return ctx;
}

export const texts = (ctx) => ctx.calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1]));
export const count = (ctx, name) => ctx.calls.filter((c) => c[0] === name).length;
