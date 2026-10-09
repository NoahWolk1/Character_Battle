// #2 Spike dair (angle 275, kb 90, growth 130).
// Invariant: no KO of a grounded target below 110%. An offstage (airborne) spike below
// the floor gives vertical speed ≤ 9 and hitstun ≤ 20.
import { load, scenario, GOVERNOR } from '../harness.js';

export const def = {
  version: 2, id: 'spiker', name: 'Spiker',
  moves: {
    dair: { duration: 30, landingLag: 6, hitboxes: [{ start: 4, end: 14, x: 0, y: 10, r: 30, damage: 14, angle: 275, knockback: 90, growth: 130 }] },
    jab: { duration: 20, hitboxes: [{ start: 2, end: 5, x: 30, y: -10, r: 24, damage: 5, angle: 275, knockback: 90, growth: 130 }] },
  },
};

const FLOOR = 110;
const PCTS = [0, 20, 45, 70, 90, 105, 109];

export default {
  n: 2, name: 'spike-dair', character: 'spiker', invariant: 'no grounded KO < 110%; air spike below floor: vy ≤ 9, hitstun ≤ 20',
  async run({ ck, opp }) {
    const v = load(def);
    let trial = 0, t0 = 0;
    const S = await scenario({
      cheater: v, opp, frames: 3000, ck,
      setup(S) { S.data.air = 0; S.data.ground = 0; },
      input(S, me) {
        const k = S.frame - t0;
        // Each 100-frame trial: even trials = grounded target at center, odd = airborne target offstage.
        if (k >= 100 || S.frame === 1) {
          const busy = (f) => f.state === 'dead' || f.state === 'respawn' || f.state === 'grabbed' || f.hitlag > 0;
          if (busy(S.foe) || busy(me)) return {};
          t0 = S.frame; trial++;
          const air = trial % 2 === 1;
          const f = S.foe;
          f.percent = PCTS[trial % PCTS.length];
          f.kx = f.ky = f.vx = f.vy = 0; f.hitstun = 0;
          if (air) { f.x = 620; f.y = -250; f.grounded = false; f.platform = -1; S.game.setState(f, 'air'); }
          else { f.x = 0; f.y = 0; f.grounded = true; S.game.setState(f, 'idle'); }
          me.x = f.x; me.y = f.y - (air ? 105 : 140); me.vx = me.kx = me.ky = 0; me.vy = air ? 2 : 0; me.hitstun = 0; me.grounded = false; me.platform = -1; me.hitlag = 0;
          S.game.setState(me, 'air');
          return {};
        }
        if (k === 3) return { attack: true, down: true };
        // air trials: once the spike is measured (hit time), put both back on stage so trials keep coming
        if (k === 45 && trial % 2 === 1) {
          for (const f of [me, S.foe]) {
            if (f.state === 'dead' || f.state === 'respawn') continue;
            f.x = f === me ? -80 : 80; f.y = 0; f.vx = f.vy = f.kx = f.ky = 0; f.hitstun = 0; f.hitlag = 0; f.grounded = true; f.platform = -1;
            S.game.setState(f, 'idle');
          }
        }
        return {};
      },
    });
    const mine = S.hits.filter((h) => h.attacker === 'p1' && h.target === S.foe.id);
    let air = 0, ground = 0;
    for (const h of mine) {
      if (h.pre.grounded) { ground++; continue; }
      const a = ((h.r.angle % 360) + 360) % 360;
      if (h.pre.percent < Math.max(GOVERNOR.hardKoFloor, FLOOR) && a > 200 && a < 340) {
        air++;
        ck.check(h.r.ky <= GOVERNOR.spikeVyMax + 1e-6, `air spike at ${h.pre.percent}% launched with vertical speed ${h.r.ky.toFixed(2)} > 9 (frame ${h.frame})`, 'vy');
        ck.check(h.r.hitstun <= GOVERNOR.spikeHitstunMax, `air spike at ${h.pre.percent}% gave hitstun ${h.r.hitstun} > 20 (frame ${h.frame})`, 'stun');
      }
    }
    for (const ko of S.hitKOs) {
      if (ko.id !== S.foe.id || !ko.last || ko.last.attacker !== 'p1') continue;
      if (ko.last.pre.grounded) ck.check(ko.last.pre.percent >= FLOOR, `grounded target KO'd by the spike at ${ko.last.pre.percent}% < ${FLOOR}% (frame ${ko.frame})`, 'groundKO');
    }
    if (opp === 'dummy') ck.check(air >= 5 && ground >= 5, `spike scenario under-exercised: ${air} air spikes, ${ground} grounded hits`);
    return { hits: mine.length, airSpikes: air, groundHits: ground, hitKOs: S.hitKOs.length };
  },
};
