// #34 (new) Slow script: a `tick` that never throws and never loops forever, it just burns
// CPU every frame, hoping to lag the room for everyone. Two variants: ~20 ms per call
// ("slow"; well past 8 ms even if calibration is off by 2×) and ~4 ms
// per call ("budget": under the 8 ms per-call limit, over the 1 ms average).
// Invariant (owner decision b): no timing fault during the first 120 ticks; then scripts are disabled after 2 calls > 8 ms, or once the 60-tick average exceeds 1 ms;
// disabled scripts stop running; the opponent is unaffected and the match keeps going.
import { load, scenario } from '../harness.js';
import { LIMITS } from '../../../shared/sim/script-api.js';

// iterations per call (calibrated outside the guard); `sparse`: during the grace window only
// a few calls are slow (proves the grace) so the run stays well inside the 10 s kill timeout
const SPIN = { n: 0, sparse: false };

const make = (id) => ({
  version: 2, id, name: id, vars: { x: 0, calls: 0 },
  behavior: {
    tick(view, api) {
      const x = view.vars.x | 0;
      const f = view.frame;
      const n = SPIN.sparse && f < 115 && f % 20 !== 5 ? 0 : SPIN.n;
      api.vars.set('x', spin(n, x) & 1023);
      api.vars.set('calls', view.vars.calls + 1);
    },
  },
});

// One spin routine for calibration and the hook, so both run the same JIT-optimized code.
function spin(n, x) {
  for (let i = 0; i < n; i++) x = (x * 31 + i) | 0;
  return x;
}

// Iterations for `ms` at the FASTEST observed speed (warm JIT, least contention), so a
// call never comes in far under its target when the machine gets quieter later.
function calibrate(ms) {
  let x = 0, n = 1 << 16;
  for (;;) {
    const t0 = performance.now();
    x = spin(n, x);
    if (performance.now() - t0 > 10) break;
    n *= 2;
  }
  let best = Infinity;
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    x = spin(n, x);
    best = Math.min(best, performance.now() - t0);
  }
  return Math.ceil((n / best) * ms) + (x & 1);
}

export default {
  n: 34, name: 'slow-script', character: 'slowpoke', invariant: '120-tick grace; disable after 2 calls > 8 ms or avg > 1 ms/60',
  async run({ ck, opp }) {
    const out = {};
    for (const [variant, ms, want] of [['slow', 20, 'slow'], ['budget', 4, 'budget']]) {
      SPIN.n = calibrate(ms);
      SPIN.sparse = variant === 'slow';
      const v = load(make(`slowpoke${variant === 'slow' ? '' : '2'}`));
      let callsAtOff = null;
      const S = await scenario({
        cheater: v, opp, frames: 360, ck, rules: { scriptTiming: true },
        each(S) { if (S.me.scriptsDisabled && callsAtOff === null) callsAtOff = S.me.vars.calls; },
      });
      const off = S.events.find((e) => e.type === 'gov' && e.rule === 'scriptsDisabled' && e.who === S.me.id);
      ck.check(!!off, `${variant}: a ${ms} ms/tick script was never disabled`);
      if (off) {
        ck.check(off.frame >= LIMITS.timingGrace, `${variant}: disabled at frame ${off.frame}, inside the ${LIMITS.timingGrace}-tick warm-up grace (ticks 0..${LIMITS.timingGrace - 1})`);
        ck.check(off.frame <= LIMITS.timingGrace + LIMITS.avgWindow + 2, `${variant}: disabled only at frame ${off.frame} (> grace + ${LIMITS.avgWindow})`);
        if (want === 'slow') {
          // One call > 60 ms (heavy CI contention) blows the whole 60-tick average at once: the
          // budget rule then legitimately fires first, on the very first accounted tick.
          const budgetFirst = off.reason === 'budget' && off.frame <= LIMITS.timingGrace + 1;
          ck.check(off.reason === 'slow' || budgetFirst, `slow: disabled for '${off.reason}' at frame ${off.frame}, expected 'slow' (2 calls > ${LIMITS.maxCallMs} ms)`);
          if (budgetFirst) ck.note('slow variant: a single call exceeded the 60-tick budget under contention (budget rule fired first)');
          ck.check(off.frame <= LIMITS.timingGrace + 3, `slow: took until frame ${off.frame} to catch 2 calls > 8 ms`);
        } else {
          // Under heavy CI contention a 2.5 ms call can exceed 8 ms; either timing rule is a correct catch.
          ck.check(off.reason === 'budget' || off.reason === 'slow', `budget: disabled for '${off.reason}'`);
          if (off.reason !== 'budget') ck.note(`budget variant was caught by the per-call rule (${off.reason}) under contention`);
        }
      }
      ck.check(S.me.vars.calls === callsAtOff, `${variant}: tick kept running after the disable (${callsAtOff} → ${S.me.vars.calls})`);
      ck.check(!S.foe.scriptsDisabled, `${variant}: the opponent was disabled too`);
      ck.check(S.frame >= 360 && S.game.phase !== 'ended', `${variant}: the match stopped at frame ${S.frame}`);
      out[variant] = { spin: SPIN.n, disabledAt: off?.frame ?? null, reason: off?.reason ?? null, calls: S.me.vars.calls };
    }
    return out;
  },
};
