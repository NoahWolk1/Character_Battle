// #9 Flight stall: fly with fuel 9999 and thrust 99, hover, plus api.velocity(0, −50)
// every tick. Invariant: self rise ≤ 380 px per airtime (beyond engine jumps), stall
// ≤ 240 frames, helpless after 600 frames airborne.
import { load, scenario, GOVERNOR } from '../harness.js';

export const def = {
  version: 2, id: 'zeppelin', name: 'Zeppelin',
  stats: { airJumps: 1 },
  movement: { fly: { button: 'jump', fuel: 9999, thrust: 99, maxRise: 99 } },
  behavior: { tick(view, api) { api.velocity(0, -50); api.impulse(0, -50); } },
};

export default {
  n: 9, name: 'flight-stall', character: 'zeppelin', invariant: 'rise ≤ 380/airtime, stall ≤ 240, helpless after 600 f airborne',
  async run({ ck, opp }) {
    const v = load(def);
    const A = GOVERNOR.air;
    let seg = null, maxRise = 0, maxStall = 0, maxAir = 0, prev = null;
    const reset = () => { seg = { rise: 0, stall: 0, air: 0, jumps: 0 }; };
    reset();
    const S = await scenario({
      cheater: v, opp, frames: 3600, ck,
      // Hold the fly button; drift toward the foe so the CPU gets to hit (refunds) too.
      input: (S, me) => ({ jump: true, up: true, [S.foe.x > me.x ? 'right' : 'left']: S.frame % 120 < 30 }),
      each(S) {
        const me = S.me;
        const tookTumble = S.frameEvents.some((e) => e.type === 'hit' && e.target === me.id && e.kb >= 80);
        if (me.grounded || me.state === 'dead' || me.state === 'respawn' || tookTumble) { reset(); prev = { y: me.y }; return; }
        for (const e of S.frameEvents) if (e.type === 'jump' && e.id === me.id) seg.jumps++;
        const inKb = Math.hypot(me.kx, me.ky) > 0.5;
        if (prev && !inKb && me.state !== 'hitstun' && me.state !== 'grabbed') seg.rise += Math.max(0, prev.y - me.y);
        if (!inKb && !['hitstun', 'grabbed', 'shieldbreak'].includes(me.state) && me.vy >= A.stallVyMin && me.vy <= A.stallVyMax) seg.stall++;
        seg.air++;
        const st = me.stats;
        const jumpH = (vj) => (vj * vj) / (2 * st.gravity) + vj;
        const allowance = jumpH(st.jumpHeight) + (st.airJumps || 0) * jumpH(st.doubleJumpHeight);
        maxRise = Math.max(maxRise, seg.rise - allowance);
        maxStall = Math.max(maxStall, seg.stall);
        maxAir = Math.max(maxAir, seg.air);
        ck.check(seg.rise <= A.rise + allowance + 2, `self rise ${seg.rise.toFixed(0)} px in one airtime (> 380 + ${allowance.toFixed(0)} jump allowance, frame ${S.frame})`, 'rise');
        // The governor's own stall ledger is the authority (hard invariant); it holds at ≤ 240.
        if (me.gov) ck.check(me.gov.air.stall <= A.stall, `governor stall ledger ${me.gov.air.stall} > 240 (frame ${S.frame})`, 'stallLedger');
        if (seg.air > A.longAir + 2) ck.check(['helpless', 'hitstun', 'airdodge', 'grabbed'].includes(me.state), `airborne ${seg.air} frames without landing and state is ${me.state}, not helpless (frame ${S.frame})`, 'longAir');
        // helpless must actually fall: no self-velocity may hold a helpless fighter in the air
        if (me.state === 'helpless') { seg.helpless = (seg.helpless || 0) + 1; if (seg.helpless === 1) seg.helplessY = me.y; }
        if (seg.helpless > 60) ck.issue(me.y > seg.helplessY + 50, `helpless for ${seg.helpless} frames but still floating at y=${me.y.toFixed(1)}, vy=${me.vy.toFixed(2)}: a script calling api.velocity(0, <0) every tick keeps vy pinned to 0 after the rise budget is spent, so gravity never acts and stall-exhaustion/helpless do not make the fighter fall. Root cause: script-api.js velocity() writes f.vy = gov.selfVelocity(...).vy (=0 when rise exhausted), overwriting the gravity-integrated vy each frame; the stall/helpless gate only disables movement MODES (movement.js), not the raw api.velocity path. Fix: when selfVelocity zeroes an upward request (rise spent) or the fighter is stallExhausted/helpless, do not force f.vy downward-less-than-gravity — leave the gravity-driven vy. [root: shared/sim/script-api.js velocity(); shared/sim/governor.js selfVelocity()]`, 'helplessFloat');
        if (me.gov) ck.check(me.gov.air.rise <= A.rise + 1e-6, `ledger rise ${me.gov.air.rise} > 380`, 'ledger');
        prev = { y: me.y };
      },
    });
    if (opp === 'dummy') ck.check((S.gov.rise || 0) + (S.gov.stall || 0) > 0, 'neither the rise nor the stall budget ever ran out (kit not exercised)');
    return { maxRiseBeyondJumps: Math.round(maxRise), maxStall, maxAirFrames: maxAir, gov: { rise: S.gov.rise || 0, stall: S.gov.stall || 0, longAir: S.gov.longAir || 0, selfSpeed: S.gov.selfSpeed || 0 } };
  },
};
