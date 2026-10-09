// #25 (new) Form-swap cooldown abuse: a character with 6 forms whose `tick` calls api.form
// on a different form every single frame, trying to dodge the per-form 45-frame cooldown,
// gain its armor/stats, and cause a visual/physics churn. Also uses the 6-frame transition
// hitlag to try to stay un-hittable. Invariant: a form change happens at most once per 45
// frames; the transition hitlag does not grant intangibility beyond the budget; mods stay
// in range across swaps; the collider is pushed out of the ground (no NaN, no fall-through).
import { load, scenario, FrameWindow } from '../harness.js';
import { LIMITS as SCRIPT_LIMITS } from '../../../shared/sim/script-api.js';

const forms = {};
for (const n of ['tank', 'glass', 'swift', 'giant', 'flea']) {
  forms[n] = { stats: { weight: n === 'tank' ? 160 : 70, runSpeed: n === 'swift' ? 9 : 5 }, armor: { threshold: n === 'tank' ? 99 : 0 }, body: { collider: { w: n === 'giant' ? 120 : 40, h: n === 'giant' ? 180 : 70 } } };
}

export const def = {
  version: 2, id: 'morpher', name: 'Morpher', forms,
  moves: { jab: { duration: 16, hitboxes: [{ start: 2, end: 4, x: 30, y: -40, r: 24, damage: 4, angle: 40, knockback: 15, growth: 20 }] } },
  behavior: {
    tick(view, api) {
      const names = ['base', 'tank', 'glass', 'swift', 'giant', 'flea'];
      api.form(names[view.frame % names.length]);
      api.form(names[(view.frame + 3) % names.length]);
    },
  },
};

export default {
  n: 25, name: 'form-swap-abuse', character: 'morpher', invariant: '≤ 1 form change / 45 f; armor/intangible budgeted; no fall-through',
  async run({ ck, opp }) {
    const v = load(def);
    let changes = 0, lastChange = -1e9, minGap = 1e9;
    const intangWin = new FrameWindow(300);
    const S = await scenario({
      cheater: v, opp, frames: 2400, ck, dummyRole: 'attack',
      each(S) {
        const me = S.me;
        for (const e of S.frameEvents) {
          // KO / respawn force a reset to the start form (cooldown-exempt by design); don't
          // count those gaps. Only consecutive live, voluntary script swaps are rate-limited.
          if ((e.type === 'ko' || e.type === 'respawn') && e.id === me.id) { lastChange = -1e9; continue; }
          if (e.type === 'form' && e.id === me.id) {
            if (me.state === 'dead' || me.state === 'respawn') { lastChange = -1e9; continue; }
            changes++;
            if (lastChange > -1e8) {
              minGap = Math.min(minGap, S.frame - lastChange);
              ck.check(S.frame - lastChange >= SCRIPT_LIMITS.formCooldown, `form changed ${S.frame - lastChange} frames after the last live swap (< 45, frame ${S.frame})`, 'cooldown');
            }
            lastChange = S.frame;
          }
        }
        const I = me.gov?.intang;
        intangWin.push(!!I && (I.charged === S.frame || I.until > S.frame));
        // Armor from the tank form must still obey the uptime budget and the 12 cap.
        ck.check(S.game.gov.armorAt(me) <= 12, `armor ${S.game.gov.armorAt(me)} > 12 in form ${me.form}`, 'armor');
        // Never fall through the stage from a collider resize.
        ck.check(Number.isFinite(me.x) && Number.isFinite(me.y), `NaN position in form ${me.form}`, 'nan');
      },
    });
    ck.check(intangWin.max <= 45, `transition churn gave ${intangWin.max} intangible frames per 300 (> 45)`);
    if (opp === 'dummy') ck.check(changes >= 5, `only ${changes} form changes (kit not exercised)`);
    return { formChanges: changes, minGapFrames: minGap === 1e9 ? null : minGap, maxIntangible300: intangWin.max };
  },
};
