// #27 (new) Status ping-pong between two teammates: each teammate's onHit/onHurt re-applies
// a control + DoT status to the shared enemy, trying to beat the per-owner cap by splitting
// the work across two owners and to keep the enemy permanently disabled. Invariant: still
// ≤ 4 statuses and ≤ 2 DoTs per target total (regardless of how many owners), ≤ 90 control
// frames per 600, and the stun/freeze immunity holds across both attackers.
import { load, scenario, brawler, FrameWindow } from '../harness.js';
import { STATUS_CAPS } from '../../../shared/balance/governor-rules.js';

export const def = {
  version: 2, id: 'hexer', name: 'Hexer',
  statuses: { hex: { frames: 300, control: 'stun' }, rot: { frames: 300, stack: 'add', maxStacks: 3, dot: { every: 1, damage: 9 } }, chill: { frames: 300, control: 'freeze' } },
  moves: { jab: { duration: 14, hitboxes: [{ start: 2, end: 4, x: 34, y: -46, r: 30, damage: 3, angle: 30, knockback: 6, growth: 4, status: 'hex' }] } },
  behavior: {
    tick(view, api) { const e = view.nearestEnemy(); if (e && Math.abs(e.x - view.me.x) < 100) api.startMove('jab'); },
    onHit(view, api, ev) { for (const n of ['hex', 'rot', 'chill', 'stun', 'burn', 'poison', 'root']) api.status(ev.targetId, n); },
  },
};

export default {
  n: 27, name: 'status-pingpong', character: 'hexer', invariant: '≤ 4 statuses, ≤ 2 DoTs, ≤ 90 control/600 across two owners',
  async run({ ck, opp }) {
    const v = load(def);
    const teammate = load({ ...def, id: 'hexer2', name: 'Hexer2' }).character;
    const ctrl = new FrameWindow(STATUS_CAPS.controlTotal.window);
    const S = await scenario({
      cheater: v, opp, frames: 2400, ck,
      extra: [{ character: teammate, input: brawler(['attack'], { gap: 8, target: (s) => s.foe }) }],
      input: brawler(['attack'], { gap: 8 }),
      setup(S) { S.me.x = -80; S.foe.x = 0; S.game.fighters[2].x = 80; S.game.fighters[2].facing = -1; },
      each(S) {
        const t = S.foe;
        const dots = t.statuses.filter((s) => s.dot && s.dot.damage > 0);
        ck.check(t.statuses.length <= STATUS_CAPS.perTarget, `${t.statuses.length} statuses on the shared target (> 4, frame ${S.frame})`, 'statuses');
        ck.check(dots.length <= STATUS_CAPS.dot.perTarget, `${dots.length} DoTs on the shared target (> 2, frame ${S.frame})`, 'dots');
        const controlled = t.state === 'stunned' || t.state === 'grabbed' || ((t.control === 'root' || t.control === 'silence') && t.state !== 'hitstun');
        ctrl.push(controlled);
        ck.check(ctrl.sum <= STATUS_CAPS.controlTotal.max, `shared target controlled ${ctrl.sum} frames per 600 (> 90, frame ${S.frame})`, 'ctrl');
      },
    });
    const ticks = S.dots.filter((d) => d.target === S.foe.id);
    if (opp === 'dummy') ck.check(S.events.some((e) => e.type === 'status' && e.target === S.foe.id && e.on), 'no status landed on the shared target (kit not exercised)');
    return { maxControl600: ctrl.max, dotTicks: ticks.length, gov: { statusCap: S.gov.statusCap || 0, statusOwner: S.gov.statusOwner || 0, dotCap: S.gov.dotCap || 0, controlImmune: S.gov.controlImmune || 0 } };
  },
};
