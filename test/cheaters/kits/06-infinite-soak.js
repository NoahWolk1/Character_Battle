// #6 Infinite soak: "plating" resource with soak fraction 1 and max 1000 (refilled by
// script every frame). Invariant: prevented ≤ 50% of each hit and ≤ 45 per stock
// (≤ 20 per rolling 300 frames).
import { load, scenario, maxWindow } from '../harness.js';

export const def = {
  version: 2, id: 'plated', name: 'Plated',
  resources: { plating: { max: 1000, start: 1000, regen: 1000, soak: { fraction: 1, costPerDamage: 0 } } },
  statuses: { shell: { frames: 300, mods: { damageIn: 0.01 } } },
  behavior: { tick(view, api) { api.res.set('plating', 1000); api.status('self', 'shell'); api.modify('hard', { damageIn: 0 }); } },
};

export default {
  n: 6, name: 'infinite-soak', character: 'plated', invariant: 'prevented ≤ 50%/hit, ≤ 45/stock, ≤ 20/300 f',
  async run({ ck, opp }) {
    const v = load(def);
    const soak = v.character.resources?.plating?.soak;
    if (soak) ck.check(soak.fraction <= 0.5 + 1e-9 && soak.costPerDamage >= 0.5 - 1e-9, `soak not normalized: ${JSON.stringify(soak)}`);
    const S = await scenario({ cheater: v, opp, frames: 3600, ck, dummyRole: 'attack' });
    const onMe = S.hits.filter((h) => h.target === S.me.id);
    let stock = 0, stockMax = 0, lastStocks = 3;
    const stocksAt = new Map(S.kos.filter((k) => k.id === S.me.id).map((k) => [k.frame, true]));
    let ki = 0;
    const koFrames = [...stocksAt.keys()].sort((a, b) => a - b);
    for (const h of onMe) {
      while (ki < koFrames.length && koFrames[ki] <= h.frame) { ki++; stock = 0; lastStocks--; }
      ck.check(h.r.prevented <= 0.5 * h.r.partDamage + 1e-6, `prevented ${h.r.prevented.toFixed(2)} of a ${h.r.partDamage.toFixed(2)} hit (> 50%, frame ${h.frame})`, 'perHit');
      stock += h.r.prevented;
      stockMax = Math.max(stockMax, stock);
    }
    const w300 = maxWindow(onMe, 300, (h) => h.r.prevented);
    ck.check(stockMax <= 45 + 1e-6, `prevented ${stockMax.toFixed(2)} in one stock (> 45)`);
    ck.check(w300 <= 20 + 1e-6, `prevented ${w300.toFixed(2)} in 300 frames (> 20)`);
    if (opp === 'dummy') ck.check(onMe.length >= 10 && stockMax > 0, `kit not exercised: ${onMe.length} hits taken, prevented ${stockMax}`);
    return { hitsTaken: onMe.length, preventedPerStockMax: +stockMax.toFixed(2), prevented300: +w300.toFixed(2), damageTaken: +onMe.reduce((s, h) => s + h.r.damage, 0).toFixed(1), mitigationGov: S.gov.mitigation || 0 };
  },
};
