// Recording Canvas 2D mock for art tests (Node has no canvas).
// Tracks the transform stack for getTransform(), records every call and style
// assignment (numbers rounded) so two renders can be compared exactly.

const R = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
const fmt = (v) => {
  if (typeof v === 'number') return String(R(v));
  if (v && v.__grad) return v.__grad;
  if (v && typeof v === 'object' && 'width' in v && 'height' in v) return `img${v.width}x${v.height}`;
  if (typeof v === 'function') return 'fn';
  if (v && typeof v === 'object') return 'obj';
  return String(v);
};

const PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'globalCompositeOperation', 'lineCap', 'lineJoin',
  'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'font', 'textAlign', 'textBaseline', 'filter',
  'imageSmoothingEnabled', 'miterLimit', 'lineDashOffset', 'direction'];
const DEFAULTS = {
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
  lineCap: 'butt', lineJoin: 'miter', shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', shadowOffsetX: 0, shadowOffsetY: 0,
  font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', filter: 'none', imageSmoothingEnabled: true,
  miterLimit: 10, lineDashOffset: 0, direction: 'inherit',
};

const mul = (m, n) => ({
  a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
});
const ID = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export class MockContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.log = [];
    this.recording = true;
    this.m = ID();
    this.stack = [];
    this.maxDepth = 0;
    this.st = { ...DEFAULTS };
    this.dash = [];
    this.ops = 0;          // drawing ops (fill/stroke/drawImage/fillRect/text) — "did anything render?"
    for (const p of PROPS) {
      Object.defineProperty(this, p, {
        get() { return this.st[p]; },
        set(v) { this.st[p] = v; this.rec(`${p}=${fmt(v)}`); },
        enumerable: true, configurable: true,
      });
    }
  }

  rec(s) { if (this.recording) this.log.push(s); }
  call(name, args) { this.rec(`${name}(${Array.from(args, fmt).join(',')})`); }
  hash() { return this.log.join('\n'); }
  clearLog() { this.log.length = 0; }

  // state
  save() { this.call('save', []); this.stack.push({ m: { ...this.m }, st: { ...this.st }, dash: this.dash }); this.maxDepth = Math.max(this.maxDepth, this.stack.length); }
  restore() { this.call('restore', []); const s = this.stack.pop(); if (s) { this.m = s.m; this.st = s.st; this.dash = s.dash; } }
  get depth() { return this.stack.length; }

  // transform
  translate(x, y) { this.call('translate', arguments); this.m = mul(this.m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }); }
  scale(x, y) { this.call('scale', arguments); this.m = mul(this.m, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); }
  rotate(r) { this.call('rotate', arguments); const c = Math.cos(r), s = Math.sin(r); this.m = mul(this.m, { a: c, b: s, c: -s, d: c, e: 0, f: 0 }); }
  transform(a, b, c, d, e, f) { this.call('transform', arguments); this.m = mul(this.m, { a, b, c, d, e, f }); }
  setTransform(a, b, c, d, e, f) {
    if (a && typeof a === 'object') ({ a, b, c, d, e, f } = a);
    this.call('setTransform', [a, b, c, d, e, f]);
    this.m = { a, b, c, d, e, f };
  }
  resetTransform() { this.call('resetTransform', []); this.m = ID(); }
  getTransform() { const m = { ...this.m }; m.m11 = m.a; m.m12 = m.b; m.m21 = m.c; m.m22 = m.d; m.m41 = m.e; m.m42 = m.f; return m; }

  // gradients / patterns
  createLinearGradient(...a) { return this.grad('lin', a); }
  createRadialGradient(...a) { return this.grad('rad', a); }
  createConicGradient(...a) { return this.grad('con', a); }
  createPattern() { return { __grad: 'pattern', setTransform() {} }; }
  grad(kind, a) {
    const g = { __grad: `${kind}(${a.map(fmt).join(',')})`, addColorStop: (o, c) => { g.__grad += `|${fmt(o)}:${c}`; } };
    return g;
  }

  // paths and drawing
  setLineDash(d) { this.call('setLineDash', [Array.isArray(d) ? d.join(' ') : '']); this.dash = d || []; }
  getLineDash() { return this.dash; }
  measureText(t) { return { width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; }
  isPointInPath() { return false; }
  isPointInStroke() { return false; }
  getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }; }
  putImageData() { this.call('putImageData', []); }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
}
const PATH = ['beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'bezierCurveTo', 'quadraticCurveTo', 'rect', 'roundRect', 'clip'];
const DRAW = ['fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'drawImage'];
// Like Chrome: a negative arc/ellipse/arcTo radius throws IndexSizeError (NaN is silently ignored).
const RADII = { arc: [2], ellipse: [2, 3], arcTo: [4] };
function checkRadii(n, a) {
  for (const i of RADII[n] || []) if (a[i] < 0) { const e = new RangeError(`IndexSizeError: ${n}: the radius provided (${a[i]}) is negative.`); e.name = 'IndexSizeError'; throw e; }
}
for (const n of PATH) MockContext.prototype[n] = function (...a) { checkRadii(n, a); this.call(n, a); };
for (const n of DRAW) MockContext.prototype[n] = function (...a) { this.ops++; this.call(n, a); };

export class MockCanvas {
  constructor(w = 300, h = 150) { this.width = w; this.height = h; this._ctx = null; }
  getContext() { return (this._ctx ||= new MockContext(this)); }
}

export const makeMockCanvas = (w, h) => new MockCanvas(w, h);

/** Path2D stand-in (records nothing; enough for code that builds paths). */
export class MockPath2D {
  constructor() { this.cmds = []; }
  addPath(p) { this.cmds.push(['addPath', p]); }
}
for (const n of ['moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'bezierCurveTo', 'quadraticCurveTo', 'rect', 'closePath', 'roundRect']) {
  MockPath2D.prototype[n] = function (...a) { checkRadii(n, a); this.cmds.push([n, ...a]); };
}

/** Installs Path2D on globalThis if missing (Node). */
export function installPath2D() { if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = MockPath2D; }
