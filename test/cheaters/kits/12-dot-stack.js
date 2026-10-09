// #12 DoT stack: 10 burn statuses per hit (onHit hook + hitbox status), each with a
// 1-frame, 9-damage tick, 'add' stacking and 999 frames.
// Invariant: ≤ 2 DoTs and ≤ 4 statuses per target (≤ 3 from one owner); a DoT deals
// ≤ 10 per application (≤ 0.5 per 15 frames).
import { load, scenario, brawler } from '../harness.js';
import { STATUS_CAPS } from '../../../shared/balance/governor-rules.js';

const statuses = {};
for (let i = 0; i < 8; i++) statuses[`burn${i}`] = { frames: 999, stack: 'add', maxStacks: 99, dot: { every: 1, damage: 9 } };

export const def = {
  version: 2, id: 'pyro', name: 'Pyro', statuses,
  moves: { jab: { duration: 16, hitboxes: [{ start: 2, end: 4, x: 34, y: -46, r: 28, damage: 2, angle: 40, knockback: 5, growth: 5, status: { name: 'burn0', frames: 999, power: 99 } }] } },
  behavior: {
    onHit(view, api, ev) {
      for (let i = 0; i < 10; i++) api.status(ev.targetId, `burn${i % 8}`);
      api.status(ev.targetId, 'burn'); api.status(ev.targetId, 'poison');
    },
  },
};

export default {
  n: 12, name: 'dot-stack', character: 'pyro', invariant: '≤ 2 DoTs, ≤ 4 statuses (≤ 3/owner) per target; DoT ≤ 10/application',
  async run({ ck, opp }) {
    const v = load(def);
    const apps = new Map(); // name → applications (status on events) on the foe
    const dmg = new Map();  // name → DoT damage on the foe
    const S = await scenario({
      cheater: v, opp, frames: 2400, ck, input: brawler(['attack'], { gap: 10 }),
      each(S) {
        const t = S.foe;
        const dots = t.statuses.filter((s) => s.dot && s.dot.damage > 0);
        ck.check(dots.length <= STATUS_CAPS.dot.perTarget, `${dots.length} DoTs on the target (> 2, frame ${S.frame})`, 'dots');
        ck.check(t.statuses.length <= STATUS_CAPS.perTarget, `${t.statuses.length} statuses on the target (> 4)`, 'statuses');
        const mine = t.statuses.filter((s) => s.source === S.me.id).length;
        ck.check(mine <= STATUS_CAPS.perOwner, `${mine} statuses from one owner (> 3)`, 'owner');
        for (const s of t.statuses) ck.check(s.frames <= STATUS_CAPS.maxFrames, `status ${s.name} has ${s.frames} frames (> 300)`, 'frames');
        for (const e of S.frameEvents) {
          if (e.type === 'status' && e.target === t.id && e.on) apps.set(e.name, (apps.get(e.name) || 0) + 1);
          if (e.type === 'dot' && e.id === t.id) dmg.set(e.name, (dmg.get(e.name) || 0) + e.damage);
        }
      },
    });
    const ticks = S.dots.filter((d) => d.target === S.foe.id);
    for (const d of ticks) ck.check(d.damage <= STATUS_CAPS.dot.maxPerTick * 1.15 + 1e-6, `DoT tick of ${d.damage} (> 0.5 × damageIn)`, 'tick');
    for (const [name, total] of dmg) {
      const n = apps.get(name) || 1;
      ck.check(total <= STATUS_CAPS.dot.perApplication * n + 0.5, `${name}: ${total.toFixed(1)} DoT damage over ${n} application(s) (> 10 each)`, `app:${name}`);
    }
    if (opp === 'dummy') ck.check(ticks.length > 10, `kit not exercised: ${ticks.length} DoT ticks`);
    return { dotTicks: ticks.length, dotDamage: +ticks.reduce((s, d) => s + d.damage, 0).toFixed(1), applications: Object.fromEntries(apps), gov: { dotCap: S.gov.dotCap || 0, statusCap: S.gov.statusCap || 0, statusOwner: S.gov.statusOwner || 0, dotTotal: S.gov.dotTotal || 0 } };
  },
};
