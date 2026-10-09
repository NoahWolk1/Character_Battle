// #8 Permanent armor at threshold 99: api.armor(999, 99) every tick, armor windows of
// 99 on every move and passive armor 99. Invariant: threshold ≤ 12 (passive ≤ 3);
// active uptime ≤ 60 frames per 300; armor never reduces damage.
import { load, scenario, FrameWindow, GOVERNOR } from '../harness.js';

export const def = {
  version: 2, id: 'ironclad', name: 'Ironclad',
  body: { collider: { w: 56, h: 96 }, armor: { threshold: 99 } },
  moves: { jab: { duration: 40, armor: [{ from: 0, to: 40, threshold: 99 }], hitboxes: [{ start: 3, end: 5, x: 30, y: -45, r: 20, damage: 3, angle: 40, knockback: 10, growth: 10 }] } },
  behavior: { tick(view, api) { api.armor(999, 99); } },
};

export default {
  n: 8, name: 'permanent-armor', character: 'ironclad', invariant: 'armor ≤ 12 (passive ≤ 3), uptime ≤ 60/300, full damage taken',
  async run({ ck, opp }) {
    const v = load(def);
    const ir = v.character;
    const passive = ir.forms?.base?.armor?.threshold ?? ir.body?.armor?.threshold ?? 0;
    ck.check(passive <= GOVERNOR.armor.maxPassive, `passive armor normalized to ${passive} (> 3)`);
    for (const w of ir.moves.jab.armor || []) ck.check(w.threshold <= GOVERNOR.armor.maxThreshold, `jab armor window threshold ${w.threshold} (> 12)`);
    const win = new FrameWindow(300);
    let tick = 0;
    const S = await scenario({
      cheater: v, opp, frames: 3600, ck, dummyRole: 'attack',
      input: () => ((tick++ % 45) === 0 ? { attack: true } : {}),
      each(S) {
        const g = S.game.gov;
        const me = S.me;
        ck.check(me.armorPassive <= GOVERNOR.armor.maxPassive || g.armorAt(me) <= GOVERNOR.armor.maxThreshold, `armor threshold ${g.armorAt(me)} > 12`, 'thr');
        const A = me.gov?.armor;
        win.push(!!A && g.activeArmorRaw(me) > 0 && A.uptime.vals[S.frame % A.uptime.w] > 0);
      },
    });
    const onMe = S.hits.filter((h) => h.target === S.me.id);
    for (const h of onMe) {
      if (!h.r.armored) continue;
      ck.check(h.r.damage <= GOVERNOR.armor.maxThreshold + 1e-6, `armor held against a ${h.r.damage.toFixed(1)}-damage hit (> 12, frame ${h.frame})`, 'held');
      ck.check(Math.abs(h.r.damage - (h.r.partDamage - h.r.prevented)) < 1e-6, `armored hit damage reduced: ${h.r.damage} of ${h.r.partDamage} (frame ${h.frame})`, 'full');
    }
    ck.check(win.max <= GOVERNOR.armor.uptime, `active armor uptime ${win.max} frames per 300 (> 60)`);
    const armored = onMe.filter((h) => h.r.armored).length;
    if (opp === 'dummy') ck.check(armored > 0 && onMe.length - armored > 0, `kit not exercised: ${armored} armored / ${onMe.length} hits`);
    return { hitsTaken: onMe.length, armored, uptime300: win.max, passive };
  },
};
