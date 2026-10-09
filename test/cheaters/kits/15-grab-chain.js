// #15 Grab chain: re-grab immediately after every throw (a weak down throw that leaves
// the target next to the cheater, then grab again), forever.
// Invariant: 10 frames of grab immunity after any release; a BREAK grants 120 frames of
// grab immunity; throw-tier KO floor 130.
import { load, scenario, GOVERNOR } from '../harness.js';

export const def = {
  version: 2, id: 'clinch', name: 'Clinch',
  moves: {
    grab: { category: 'grab', duration: 28, hitboxes: [{ start: 6, end: 9, kind: 'grab', shape: 'rect', x: 44, y: -50, w: 56, h: 70 }] },
    dthrow: { category: 'throw', duration: 24, timeline: [{ at: 2, release: { damage: 3, angle: 80, knockback: 0, growth: 0, setKnockback: 10 } }] },
    fthrow: { category: 'throw', duration: 24, timeline: [{ at: 2, release: { damage: 12, angle: 40, knockback: 999, growth: 999 } }] },
  },
  behavior: {
    tick(view, api) {
      const e = view.nearestEnemy();
      if (e && Math.abs(e.x - view.me.x) < 72 && Math.abs(e.y - view.me.y) < 40) api.startMove('grab');
    },
  },
};

export default {
  n: 15, name: 'grab-chain', character: 'clinch', invariant: 'regrab ≥ 10 f after release, ≥ 120 f after BREAK; throw KO floor 130',
  async run({ ck, opp }) {
    const v = load(def);
    let lastRelease = -1e9, lastBreak = -1e9, grabs = 0;
    const S = await scenario({
      cheater: v, opp, frames: 3600, ck,
      input(S, me) {
        // fthrow (max knockback, KO-floor probe) on every 3rd grab, dthrow otherwise; walk in otherwise
        if (me.state === 'grabbing' && !me.action) return S.frame % 2 ? {} : (grabs % 3 === 2 ? { [S.foe.x > me.x ? 'right' : 'left']: true } : { down: true });
        if (Math.abs(S.foe.x - me.x) > 60) return { [S.foe.x > me.x ? 'right' : 'left']: true };
        return {};
      },
      each(S) {
        const t = S.foe;
        // force a BREAK now and then (as a long lock would) and keep trying to grab through it
        if (S.frame % 900 === 450 && t.state !== 'dead' && t.state !== 'respawn') S.game.gov.doBreak(t, S.me);
        for (const e of S.frameEvents) {
          if (e.type === 'break' && e.target === t.id) lastBreak = S.frame;
          if ((e.type === 'grabrelease' && e.target === t.id) || (e.type === 'throw' && e.target === t.id)) lastRelease = S.frame;
          if (e.type === 'grab' && e.target === t.id) {
            grabs++;
            ck.check(S.frame - lastRelease >= 10, `re-grabbed ${S.frame - lastRelease} frames after a release (< 10, frame ${S.frame})`, 'regrab');
            ck.check(S.frame - lastBreak >= GOVERNOR.breakImmunity, `grabbed ${S.frame - lastBreak} frames after a BREAK (< 120, frame ${S.frame})`, 'breakGrab');
          }
        }
      },
    });
    for (const ko of S.hitKOs) {
      if (ko.id !== S.foe.id || !ko.last || ko.last.attacker !== S.me.id || ko.last.tier !== 'throw') continue;
      // the floor is a center-stage guarantee; at the ledge, require the ramp (no KO below 60%)
      ck.check(ko.last.pre.percent >= 60, `throw KO at ${ko.last.pre.percent}% (frame ${ko.frame})`, 'throwKO');
    }
    const throws = S.hits.filter((h) => h.attacker === S.me.id && h.tier === 'throw');
    for (const h of throws) {
      if (Math.abs(h.pre.x) <= 120 && h.pre.percent < 130) ck.check(!S.hitKOs.some((k) => k.last === h), `center throw KO below 130% (${h.pre.percent}%)`, 'center');
    }
    if (opp === 'dummy') ck.check(grabs >= 6 && throws.length >= 4, `kit not exercised: ${grabs} grabs, ${throws.length} throws`);
    return { grabs, throws: throws.length, breaks: S.breaks.length, hitKOs: S.hitKOs.map((k) => k.last && `${k.last.tier}@${k.last.pre.percent}`), gov: { grabImmune: S.gov.grabImmune || 0, controlTotal: S.gov.controlTotal || 0 } };
  },
};
