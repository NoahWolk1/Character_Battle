// KO tables (ko-table.js) and the fixed v2 estimator (combat.js estimateKoPercent with opts).
import { check, done, STAGE } from './helpers.js';
import { buildKoTable, worstKoSpeed, koTableCacheSize } from '../../shared/sim/ko-table.js';
import { estimateKoPercent, simulateLaunch, knockback, launchSpeed } from '../../shared/sim/combat.js';

// Table: built once per (stage, gravity, fallSpeed, height), cached, symmetric, sane.
{
  const n0 = koTableCacheSize();
  let t0 = performance.now();
  const T = buildKoTable(STAGE, 0.61, 10.5, 90);
  const ms = performance.now() - t0;
  t0 = performance.now();
  const T2 = buildKoTable(STAGE, 0.61, 10.5, 90);
  const ms2 = performance.now() - t0;
  check(T === T2 && koTableCacheSize() === n0 + 1, 'ko table is cached');
  check(ms < 250 && ms2 < 1, `ko table build ${ms.toFixed(1)} ms, cached ${ms2.toFixed(3)} ms`);
  check(T.length === 360 && [...T].every((v) => v > 0), 'table has 360 positive entries');
  let sym = true;
  for (let a = 0; a < 360; a++) if (T[a] !== T[(540 - a) % 360]) sym = false;
  check(sym, 'table is left/right symmetric');
  // Each entry is the minimum KO speed: slightly below never reaches, at the value it does.
  let exact = true;
  for (const a of [0, 45, 90, 135, 270]) {
    const v = T[a];
    const reach = (s) => simulateLaunch(s, a, { stage: STAGE, gravity: 0.61, fallSpeed: 10.5, height: 90 }) || simulateLaunch(s, 180 - a, { stage: STAGE, gravity: 0.61, fallSpeed: 10.5, height: 90 });
    if (!reach(v) || reach(v * 0.98)) exact = false;
  }
  check(exact, 'table entries are minimal KO speeds');
  // Floatier targets die off the top sooner.
  const floaty = buildKoTable(STAGE, 0.5, 8, 90);
  const heavy = buildKoTable(STAGE, 0.85, 14, 90);
  check(floaty[90] < heavy[90], `floaty Vko(90) ${floaty[90].toFixed(2)} < heavy ${heavy[90].toFixed(2)}`);
  check(worstKoSpeed(T, 90) <= T[90], 'DI worst case ≤ the exact angle');
  console.log(`  Vko(g .61, fs 10.5): 0°=${T[0].toFixed(1)} 45°=${T[45].toFixed(1)} 90°=${T[90].toFixed(1)} 270°=${T[270].toFixed(1)} (${ms.toFixed(0)} ms)`);
}

// v2 estimator: real blast zones, spikes, charge, weight; legacy path unchanged (see legacy.test.js).
{
  const spike = { damage: 14, angle: 275, knockback: 90, growth: 130 };
  check(estimateKoPercent(spike, {}) === 0, 'an ungoverned offstage spike KOs at 0% (the estimator sees spikes now)');
  const governed = estimateKoPercent(spike, { floor: 110 });
  check(governed >= 60, `with the runtime spike cap modelled, the spike KOs at ${governed}% (grounded flip)`);
  const smash = { damage: 18, angle: 45, knockback: 40, growth: 100 };
  const plain = estimateKoPercent(smash, {});
  const charged = estimateKoPercent(smash, { canCharge: true });
  check(charged < plain, `charge lowers KO % (${plain} → ${charged})`);
  const w100 = estimateKoPercent(smash, { weights: [100] });
  check(plain <= w100, `weight 70 KOs no later than 100 (${plain} vs ${w100})`);
  const legacy = estimateKoPercent(smash);
  check(Number.isFinite(legacy) && legacy !== plain, `legacy (${legacy}) and v2 (${plain}) estimators differ`);
  const fixed = estimateKoPercent({ damage: 3, angle: 90, knockback: 0, growth: 0, setKnockback: 0 }, {});
  check(fixed === Infinity, 'setKnockback 0 never KOs');
  // Consistency with the engine: the estimated % really is the first KO % (grounded, center, no DI).
  const p = estimateKoPercent(smash, { weights: [100], di: [0], situations: ['grounded'] });
  const kos = (pp) => simulateLaunch(launchSpeed(knockback(pp + 18, 18, 100, 40, 100)), 45, { stage: STAGE, height: 0 });
  check(kos(p) && !kos(p - 1), `estimator edge at ${p}%`);
  console.log(`  smash 18/45°/40/100: legacy ${legacy}%, v2 ${plain}%, charged ${charged}%; spike 275°: ungoverned ${estimateKoPercent(spike, {})}%, governed ${governed}%`);
}

done('ko-math');
