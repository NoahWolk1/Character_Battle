// #5 Infinite heal: `tick` calls api.heal(99) every frame (plus a self "regen" status
// with a 99-per-frame heal). Invariant: healed ≤ 45 per stock and ≤ 1 per 30 frames,
// ≤ 20 per rolling 300 frames, no heal during hitstun, percent ≥ 0.
import { load, scenario, maxWindow } from '../harness.js';

export const def = {
  version: 2, id: 'healer', name: 'Healer',
  statuses: { regen: { frames: 300, heal: { every: 1, amount: 99 } } },
  behavior: {
    init(view, api) { api.heal(999); },
    tick(view, api) { api.heal(99); api.heal(99); api.status('self', 'regen'); },
    onHurt(view, api) { api.heal(99); },
  },
};

export default {
  n: 5, name: 'infinite-heal', character: 'healer', invariant: 'heal ≤ 45/stock, ≤ 1/30 f, ≤ 20/300 f; none in hitstun; percent ≥ 0',
  async run({ ck, opp }) {
    const v = load(def);
    const heals = [];
    let stockHeal = 0, maxStock = 0, prev = null;
    const S = await scenario({
      cheater: v, opp, frames: 3600, ck, dummyRole: 'attack',
      setup(S) { S.me.percent = 150; },
      each(S) {
        const me = S.me;
        const cur = { p: me.percent, state: me.state, stocks: me.stocks };
        if (prev && cur.stocks !== prev.stocks) { stockHeal = 0; prev = cur; return; }
        if (prev && cur.p < prev.p - 1e-9 && cur.state !== 'respawn' && cur.state !== 'dead' && prev.state !== 'dead') {
          const d = prev.p - cur.p;
          heals.push({ frame: S.frame, d });
          stockHeal += d;
          maxStock = Math.max(maxStock, stockHeal);
          ck.check(!(prev.state === 'hitstun' && cur.state === 'hitstun'), `healed ${d.toFixed(2)} during hitstun (frame ${S.frame})`, 'hitstun');
        }
        ck.check(me.percent >= 0, `percent ${me.percent} < 0`, 'neg');
        prev = cur;
      },
    });
    const w30 = maxWindow(heals, 30, (x) => x.d);
    const w300 = maxWindow(heals, 300, (x) => x.d);
    ck.check(maxStock <= 45 + 1e-6, `healed ${maxStock.toFixed(2)} in one stock (> 45)`);
    ck.check(w30 <= 1 + 1e-6, `healed ${w30.toFixed(2)} within 30 frames (> 1)`);
    ck.check(w300 <= 20 + 1e-6, `healed ${w300.toFixed(2)} within 300 frames (> 20)`);
    if (opp === 'dummy') ck.check(heals.length > 0 && (S.gov.heal || 0) > 0, 'the heal never ran or was never clamped (kit not exercised)');
    return { healEvents: heals.length, maxPerStock: +maxStock.toFixed(2), max30: +w30.toFixed(2), max300: +w300.toFixed(2), govHeal: S.gov.heal || 0, statusHeal: S.gov.statusHeal || 0 };
  },
};
