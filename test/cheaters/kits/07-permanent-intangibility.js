// #7 Permanent intangibility: api.intangible(999) every tick, an all-move intangible
// window, plus a 1 px hurtbox set selected by script. Invariant: character-sourced
// intangibility ≤ 45 frames per rolling 300 frames, including the shrink charge.
import { load, scenario, FrameWindow } from '../harness.js';

export const def = {
  version: 2, id: 'ghostly', name: 'Ghostly',
  body: { collider: { w: 50, h: 90 }, hurtboxes: { default: [{ shape: 'rect', x: 0, y: -45, w: 50, h: 90 }], speck: [{ shape: 'circle', x: 0, y: -45, r: 0.5 }] } },
  moves: { jab: { duration: 30, intangible: [0, 30], hitboxes: [{ start: 3, end: 5, x: 30, y: -45, r: 20, damage: 3, angle: 40, knockback: 10, growth: 10 }] } },
  behavior: { tick(view, api) { api.intangible(999); api.intangible(20); api.setHurtboxes('speck'); } },
};

export default {
  n: 7, name: 'permanent-intangibility', character: 'ghostly', invariant: 'intangible (incl. shrink) ≤ 45 f per 300 f',
  async run({ ck, opp }) {
    const v = load(def);
    let tick = 0;
    const win = new FrameWindow(300);
    const hitFrames = [];
    const exempt = new Set(); // frames the cheater could not be attacked anyway (KO, respawn, invuln)
    const S = await scenario({
      cheater: v, opp, frames: 3600, ck, dummyRole: 'attack',
      input: (S) => ((tick++ % 40) === 0 ? { attack: true } : {}),
      each(S) {
        const me = S.me;
        const I = me.gov?.intang;
        if (me.state === 'dead' || me.state === 'respawn' || me.invuln > 0 || Math.abs(me.x) > 560 || me.y < -200) exempt.add(S.frame);
        win.push(!!I && (I.charged === S.frame || I.until > S.frame));
        ck.check(!(me.intangibleFrames > 0), `engine intangibleFrames set to ${me.intangibleFrames} by a character source (frame ${S.frame})`, 'engine');
        for (const e of S.frameEvents) if (e.type === 'hit' && e.target === me.id) hitFrames.push(S.frame);
      },
    });
    ck.check(win.max <= 45, `character intangibility ${win.max} frames in a 300-frame window (> 45)`);
    // Black box: the dummy attacks every ~20 frames, so the cheater must be hittable in every 300-frame window.
    if (opp === 'dummy') {
      let gaps = 0;
      for (let f = 600; f + 300 <= S.frame; f += 300) {
        let skip = false;
        for (let x = f - 60; x < f + 300; x++) if (exempt.has(x)) { skip = true; break; }
        if (!skip && !hitFrames.some((x) => x >= f && x < f + 300)) gaps++;
      }
      ck.check(gaps === 0, `the cheater was never hit in ${gaps} 300-frame window(s) despite constant attacks`);
      ck.check((S.gov.intangible || 0) > 0, 'no gov:intangible denial was emitted');
    }
    return { maxIntangible300: win.max, hitsTaken: hitFrames.length, denials: S.gov.intangible || 0 };
  },
};
