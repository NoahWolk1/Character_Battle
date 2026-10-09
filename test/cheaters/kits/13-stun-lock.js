// #13 Stun-lock: a 1-frame-startup jab that applies a 300-frame stun, restarted on
// every frame it can be. Invariant: control ≤ 90 frames per 600; stun immunity holds
// (180 f after a stun ends); BREAK fires once the lock reaches 180 frames.
import { load, scenario, FrameWindow, GOVERNOR } from '../harness.js';
import { STATUS_CAPS } from '../../../shared/balance/governor-rules.js';

export const def = {
  version: 2, id: 'tazer', name: 'Tazer',
  statuses: { zap: { frames: 300, control: 'stun' }, ice: { frames: 300, control: 'freeze' } },
  moves: {
    jab: { duration: 14, cancels: [{ from: 1, to: 14, into: ['jab', 'any'], onHit: true }], hitboxes: [{ start: 1, end: 3, x: 34, y: -46, r: 34, damage: 2, angle: 20, knockback: 2, growth: 0, status: 'zap' }] },
  },
  behavior: {
    tick(view, api) { const e = view.nearestEnemy(); if (e && Math.abs(e.x - view.me.x) < 90) api.startMove('jab'); if (view.me.move && view.me.move.hitSomething) api.cancelInto('jab'); },
    onHit(view, api, ev) { api.status(ev.targetId, 'zap'); api.status(ev.targetId, 'ice'); api.status(ev.targetId, 'stun'); },
  },
};

const LOCKED = new Set(['hitstun', 'stunned', 'grabbed']);

export default {
  n: 13, name: 'stun-lock', character: 'tazer', invariant: 'control ≤ 90/600 f, stun immunity, BREAK at lock ≥ 180',
  async run({ ck, opp }) {
    const v = load(def);
    const ctrl = new FrameWindow(STATUS_CAPS.controlTotal.window);
    let streak = 0, maxStreak = 0, idle = 0, prevImmune = -1e9;
    const S = await scenario({
      cheater: v, opp, frames: 3600, ck,
      // keep the cheater glued to the target
      input: (S, me) => (Math.abs(S.foe.x - me.x) > 50 ? { [S.foe.x > me.x ? 'right' : 'left']: true } : {}),
      each(S) {
        const t = S.foe;
        // frames the target is actually disabled by control (stunned / grabbed / rooted / silenced outside hitstun)
        const controlled = t.state === 'stunned' || t.state === 'grabbed' || ((t.control === 'root' || t.control === 'silence') && t.state !== 'hitstun');
        ctrl.push(controlled);
        ck.check(ctrl.sum <= STATUS_CAPS.controlTotal.max, `target controlled ${ctrl.sum} frames within 600 (> 90, frame ${S.frame})`, 'ctrl');
        // The governor's immunity ledger is the authority: a new stun/freeze may only be applied once
        // the previous immunity window (set at application: frame + duration + immunity) has expired.
        for (const e of S.frameEvents) {
          if (e.type !== 'status' || e.target !== t.id || !['zap', 'ice', 'stun', 'freeze'].includes(e.name) || !e.on) continue;
          ck.check(prevImmune <= S.frame, `stun/freeze '${e.name}' applied while immune (immune-until ${prevImmune} > ${S.frame}): the governor's stun immunity was bypassed`, 'immune');
        }
        // BREAK makes the target actionable at once (§4.2.3). The engine clears control statuses on
        // the target's OWN next tick (status.tick → onBreak), so there is a 1-frame lag after the
        // BREAK where f.control is still set while the chain is already broken.
        if (S.breaks.some((b) => b.frame === S.frame - 1 && b.target === t.id)) ck.issue(!t.control || t.control === 'confuse', `target still under '${t.control}' (state ${t.state}) the frame after a BREAK: control statuses are cleared one frame late (status.tick onBreak runs the tick after Governor.endFrame sets breakNow). Fix: clear control / set actionable in the same step the BREAK is declared, or have hits.js/endFrame drop control statuses immediately. [root: shared/sim/governor.js endFrame doBreak + shared/sim/status.js onBreak timing]`, 'breakClears');
        // lock streak, mirroring the chain rule (12 actionable frames end a chain)
        if (t.hitlag > 0 || LOCKED.has(t.state)) { streak++; idle = 0; } else if (++idle >= GOVERNOR.chainIdleReset) streak = 0;
        if (S.breaks.some((b) => b.frame === S.frame && b.target === t.id)) streak = 0;
        maxStreak = Math.max(maxStreak, streak);
        prevImmune = (t.gov && t.gov.immune && t.gov.immune.stun) || -1e9;
      },
    });
    const maxStun = Math.max(0, ...S.hits.filter((h) => h.target === S.foe.id).map((h) => h.r.hitstun + 20));
    const landed = S.hits.filter((h) => h.attacker === S.me.id && h.target === S.foe.id).length;
    if (opp === 'dummy') ck.check(landed >= 20 && ctrl.max > 0, `kit not exercised: ${landed} hits, ${ctrl.max} control frames`);
    ck.check(maxStreak <= GOVERNOR.breakLock + maxStun, `lock streak ${maxStreak} frames without a BREAK (> 180 + ${maxStun})`);
    return { landed, maxControl600: ctrl.max, maxLockStreak: maxStreak, breaks: S.breaks.length, gov: { controlImmune: S.gov.controlImmune || 0, controlTotal: S.gov.controlTotal || 0, controlCap: S.gov.controlCap || 0, controlDR: S.gov.controlDR || 0 } };
  },
};
