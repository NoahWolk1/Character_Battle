// #32 (new) Body-scale + crawl/cling ledge abuse: a character that shrinks to its minimum
// and clings to the stage wall (crawl mode) at the ledge, trying to (a) ride a sub-minimum
// hurtbox for free intangibility, (b) cling to the wall forever, and (c) become un-KO-able
// while tiny. Invariant: bodyScale stays ≥ 0.6; the small-hurtbox charge is budgeted as
// intangibility (≤ 45/300); the crawl/cling mode ends by its frame limit; a shrunk fighter
// is still KO-able past a blast zone and is still hittable within every 300-frame window.
import { load, scenario, FrameWindow, put } from '../harness.js';
import { LIMITS as SCRIPT_LIMITS } from '../../../shared/sim/script-api.js';

export const def = {
  version: 2, id: 'skitter', name: 'Skitter',
  stats: { weight: 80, runSpeed: 7, airJumps: 3 },
  body: { collider: { w: 44, h: 80 }, scaleRange: [0.3, 1.0], hurtboxes: { default: [{ shape: 'rect', x: 0, y: -40, w: 44, h: 80 }], crouch: [{ shape: 'circle', x: 0, y: -4, r: 2 }] } },
  movement: { crawl: { frames: 120, speed: 5 }, wallCling: { frames: 60 } },
  moves: { jab: { duration: 14, hitboxes: [{ start: 2, end: 4, x: 26, y: -8, r: 18, damage: 3, angle: 30, knockback: 10, growth: 10 }] } },
  behavior: { tick(view, api) { api.setBodyScale(0.01); api.setHurtboxes('crouch'); } },
};

export default {
  n: 32, name: 'scale-crawl-ledge', character: 'skitter', invariant: 'scale ≥ 0.6; tiny-hurtbox budgeted; cling time-limited; hittable; KO-able',
  async run({ ck, opp }) {
    const v = load(def);
    const body = v.character.body || v.character.forms?.base?.body;
    ck.check(body.scaleRange[0] >= 0.6 - 1e-9, `scaleRange min ${body.scaleRange[0]} < 0.6`);
    const intang = new FrameWindow(300);
    const hitFrames = [], exempt = new Set();
    let clingStreak = 0, maxCling = 0;
    const CLING = new Set(['crawl', 'wallcling']);
    const S = await scenario({
      cheater: v, opp, frames: 2400, ck, dummyRole: 'attack',
      // shrink in place and periodically dash to the wall to try the cling; the dummy attacks
      input: (S, me) => (S.frame % 180 < 60 ? { right: S.frame % 180 < 10, down: true } : { down: S.frame % 4 === 0 }),
      setup(S) { S.me.x = -40; S.foe.x = 40; },
      keepEvents: false,
      each(S) {
        const me = S.me;
        ck.check(me.bodyScale >= SCRIPT_LIMITS.scaleMin - 1e-6, `bodyScale ${me.bodyScale} < 0.6 (frame ${S.frame})`, 'scale');
        const I = me.gov?.intang;
        intang.push(!!I && (I.charged === S.frame || I.until > S.frame));
        if (CLING.has(me.state)) clingStreak++; else clingStreak = 0;
        maxCling = Math.max(maxCling, clingStreak);
        ck.check(clingStreak <= 120 + 2, `clung (${me.state}) for ${clingStreak} frames (> 120, frame ${S.frame})`, 'cling');
        if (me.state === 'dead' || me.state === 'respawn' || me.invuln > 0 || Math.abs(me.x) > 500 || me.y < -150) exempt.add(S.frame);
        for (const e of S.frameEvents) if (e.type === 'hit' && e.target === me.id) hitFrames.push(S.frame);
      },
    });
    ck.check(intang.max <= 45, `tiny-hurtbox gave ${intang.max} intangible frames per 300 (> 45)`);
    // Hittable: a constantly-attacking dummy must connect in every clean 300-frame window.
    if (opp === 'dummy') {
      let gaps = 0;
      for (let f = 600; f + 300 <= S.frame; f += 300) {
        let skip = false;
        for (let x = f - 60; x < f + 300; x++) if (exempt.has(x)) { skip = true; break; }
        if (!skip && !hitFrames.some((x) => x >= f && x < f + 300)) gaps++;
      }
      ck.check(gaps === 0, `the tiny crawler dodged every attack in ${gaps} 300-frame window(s)`);
    }
    // KO-able: launched past the bottom blast zone, the shrunk fighter loses a stock.
    const S2 = await scenario({
      cheater: v, opp: 'dummy', frames: 120, ck,
      input: () => ({ down: true }),
      each(S) { if (S.frame === 5) put(S, S.me, { x: 0, y: 2000, air: true, vy: 40 }); },
    });
    ck.check(S2.kos.some((k) => k.id === S2.me.id), 'the tiny crawler could not be KO\'d past the bottom blast zone');
    return { maxClingStreak: maxCling, maxIntangible300: intang.max, hitsTaken: hitFrames.length, koable: S2.kos.some((k) => k.id === S2.me.id) };
  },
};
