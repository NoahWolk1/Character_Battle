// simGuard: while character sim code runs, nondeterministic globals throw.
//
//   guard.install();            // once, before importing character modules
//   guard.enter(fighterIdx);    // around every character hook call
//   try { fn(view, api) } finally { guard.exit(); }
//
// Wraps Math.random, Date.now, performance.now and `Date()` / `new Date()`.
// Outside enter/exit the wrappers pass straight through to the originals, so
// engine, server and client code keep working. Works in Node and browsers.

const G = globalThis;
const MSG = 'is not allowed in character sim code (nondeterministic) — use view.rng() / view.frame';

const orig = {
  random: Math.random,
  dateNow: Date.now,
  perfNow: G.performance && typeof G.performance.now === 'function' ? G.performance.now.bind(G.performance) : null,
  Date: G.Date,
};

let installed = false;
let depth = 0;
let who = -1;
let saved = null; // the exact values replaced by install(), restored by uninstall()

function trip(name) {
  const err = new Error(`${name} ${MSG}`);
  err.code = 'SIM_GUARD';
  err.fighter = who;
  throw err;
}

/** Original high-resolution clock (unaffected by the guard), in ms. */
export function clock() { return orig.perfNow ? orig.perfNow() : orig.dateNow(); }

/** Original Math.random, for engine code that legitimately needs it (never sim). */
export const unguardedRandom = orig.random;

export function install() {
  if (installed) return;
  installed = true;
  saved = { random: Math.random, dateNow: orig.Date.now, perfNow: G.performance ? G.performance.now : undefined, Date: G.Date };

  Math.random = function random() { if (depth > 0) trip('Math.random()'); return orig.random(); };
  orig.Date.now = function now() { if (depth > 0) trip('Date.now()'); return orig.dateNow(); };
  if (G.performance && orig.perfNow) {
    const perfNow = function now() { if (depth > 0) trip('performance.now()'); return orig.perfNow(); };
    try { G.performance.now = perfNow; } catch { /* read-only in some hosts */ }
    if (G.performance.now !== perfNow) {
      try { Object.defineProperty(G.performance, 'now', { value: perfNow, configurable: true, writable: true }); } catch { /* leave unguarded */ }
    }
  }
  // Date() and new Date() (no args = current time). Date with explicit args is deterministic and allowed.
  G.Date = new Proxy(orig.Date, {
    apply(target, self, args) { if (depth > 0) trip('Date()'); return Reflect.apply(target, self, args); },
    construct(target, args, newTarget) {
      if (depth > 0 && args.length === 0) trip('new Date()');
      return Reflect.construct(target, args, newTarget === G.Date ? target : newTarget);
    },
  });
}

/** Restores the original globals (tests only). */
export function uninstall() {
  if (!installed) return;
  Math.random = saved.random;
  orig.Date.now = saved.dateNow;
  if (G.performance && saved.perfNow) {
    try { G.performance.now = saved.perfNow; } catch { /* ignore */ }
    if (G.performance.now !== saved.perfNow) {
      try { Object.defineProperty(G.performance, 'now', { value: saved.perfNow, configurable: true, writable: true }); } catch { /* ignore */ }
    }
  }
  G.Date = saved.Date;
  installed = false; depth = 0; who = -1; saved = null;
}

/** Marks the start of character code for fighter `idx`. Calls may nest. */
export function enter(idx = -1) { if (depth++ === 0) who = idx; }

/** Marks the end of character code. Always call from a `finally`. */
export function exit() { if (depth > 0 && --depth === 0) who = -1; }

/** Runs fn inside the guard and returns its result. */
export function run(idx, fn, ...args) {
  enter(idx);
  try { return fn(...args); } finally { exit(); }
}

export const isInstalled = () => installed;
export const isActive = () => depth > 0;
/** Index of the fighter whose code is running, or -1. */
export const current = () => who;

export const guard = { install, uninstall, enter, exit, run, clock, isInstalled, isActive, current };
export default guard;
