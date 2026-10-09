// #31 (new) Ground blink-walk: grounded, non-rising teleports are "free" (they do not
// count toward the 1-per-airtime budget), so api.teleport(±900, 0) every tick slides
// the fighter 200 px per frame along the ground: a 12 000 px/s dash, past the 18 px/f
// self-speed cap. Invariant: grounded self-displacement over any 60 frames ≤ the
// self-speed cap × 60 plus one 200 px teleport.
import { load, scenario, GOVERNOR } from '../harness.js';

export const def = {
  version: 2, id: 'skater', name: 'Skater',
  behavior: { tick(view, api) { const e = view.nearestEnemy(); if (e && view.me.grounded) api.teleport(Math.abs(e.x - view.me.x) > 80 ? 900 : -900, 0); } },
};

export default {
  n: 31, name: 'ground-blink', character: 'skater', invariant: 'grounded self displacement ≤ 18 px/f × 60 + 200 per 60 f',
  async run({ ck, opp }) {
    const v = load(def);
    const moves = [];
    let prev = null;
    const S = await scenario({
      cheater: v, opp, frames: 1800, ck,
      setup(S) { S.me.x = -400; S.foe.x = 400; },
      each(S) {
        const me = S.me;
        if (prev && prev.grounded && me.grounded && me.state !== 'hitstun' && me.state !== 'respawn' && me.state !== 'dead' && Math.hypot(me.kx, me.ky) < 0.5) moves.push({ frame: S.frame, d: Math.abs(me.x - prev.x) });
        prev = { x: me.x, grounded: me.grounded };
      },
    });
    let best = 0, sum = 0, j = 0;
    for (let i = 0; i < moves.length; i++) {
      sum += moves[i].d;
      while (moves[i].frame - moves[j].frame >= 60) sum -= moves[j++].d;
      best = Math.max(best, sum);
    }
    const cap = GOVERNOR.air.maxVx * 60 + GOVERNOR.air.teleportDist;
    ck.issue(best <= cap, `grounded self displacement ${best.toFixed(0)} px in 60 frames (> ${cap}): api.teleport(±dx, 0) on the ground is treated as "free" (counts === !grounded || dy<0), so a character can teleport-dash up to 200 px EVERY frame (~12 000 px/s) with no per-airtime or rate budget, bypassing the §4.2.5 "≤ 1 per airtime, ≤ 200 px" limit on the ground. Fix: rate-limit grounded horizontal teleports too (e.g. a per-N-frames budget or a distance-per-window cap) in Governor.teleportRequest. [root: shared/sim/governor.js teleportRequest counts-flag; shared/sim/script-api.js teleport()]`);
    return { maxGround60: Math.round(best), cap };
  },
};
