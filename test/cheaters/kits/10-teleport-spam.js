// #10 Teleport spam: api.teleport(0, −500) every tick (and sideways jumps of 900 px).
// Invariant: ≤ 1 teleport per airtime, each ≤ 200 px.
import { load, scenario } from '../harness.js';

export const def = {
  version: 2, id: 'blinker', name: 'Blinker',
  moves: { upSpecial: { duration: 30, timeline: [{ from: 1, to: 29, every: 1, teleport: { dx: 0, dy: -900 } }] } },
  behavior: { tick(view, api) { api.teleport(0, -500); api.teleport(900, 0); if (view.frame % 3 === 0) api.startMove('upSpecial'); } },
};

export default {
  n: 10, name: 'teleport-spam', character: 'blinker', invariant: '≤ 1 teleport per airtime, ≤ 200 px',
  async run({ ck, opp }) {
    const v = load(def);
    let prev = null, perAir = 0, maxPer = 0, maxJump = 0, total = 0;
    const S = await scenario({
      cheater: v, opp, frames: 3000, ck,
      input: (S, me) => ({ [S.frame % 200 < 100 ? 'left' : 'right']: true }),
      each(S) {
        const me = S.me;
        const reset = me.grounded || me.state === 'dead' || me.state === 'respawn' || S.frameEvents.some((e) => e.type === 'respawn' && e.id === me.id);
        if (prev && !reset && prev.state !== 'dead' && prev.state !== 'respawn' && me.state !== 'grabbed') {
          // anything faster than the self-speed caps (18 / 17 px/f) + knockback is a teleport
          const ex = me.x - prev.x - (prev.kx + me.vx), ey = me.y - prev.y - (prev.ky + me.vy);
          const jump = Math.hypot(me.x - prev.x, me.y - prev.y);
          if (Math.hypot(ex, ey) > 25 && jump > 25) {
            perAir++; total++;
            maxJump = Math.max(maxJump, jump);
            ck.check(jump <= 200 + 30, `teleport of ${jump.toFixed(0)} px (> 200, frame ${S.frame})`, 'dist');
          }
        }
        maxPer = Math.max(maxPer, perAir);
        ck.check(perAir <= 1, `${perAir} teleports in one airtime (frame ${S.frame})`, 'count');
        if (me.grounded) perAir = 0;
        if (me.gov) ck.check(me.gov.air.teleports <= 1, `ledger teleports ${me.gov.air.teleports}`, 'ledger');
        prev = { x: me.x, y: me.y, kx: me.kx, ky: me.ky, state: me.state };
      },
    });
    if (opp === 'dummy') ck.check(total > 0 && (S.gov.teleport || 0) > 0, `kit not exercised: ${total} teleports, ${S.gov.teleport || 0} denials`);
    return { teleports: total, maxPerAirtime: maxPer, maxDistance: Math.round(maxJump), denied: S.gov.teleport || 0, trimmed: S.gov.teleportDist || 0 };
  },
};
