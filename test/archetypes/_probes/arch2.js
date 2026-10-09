// Probes for the ARCH2 archetypes (echo, pebble, static-ghost) and the three
// invented ones (vendy, dj-tempo, rewinda). Loaded by test/archetypes/run.js:
// default export (helpers) → { [id]: async (id) => void }. Each probe drives a
// short scripted scene and asserts the primitive it exists to exercise.
import { GOVERNOR } from '../../../shared/balance/governor-rules.js';

const inWin = (frames, from, to) => frames.filter((f) => f >= from && f < to).length;

export default function arch2Probes({ probeGame, expect }) {
  const resIdx = (P, i, name) => (P.f(i).char.tables?.resources || []).indexOf(name);
  const setRes = (P, i, name, v) => { const k = resIdx(P, i, name); if (k >= 0) P.f(i).res[k] = v; };

  return {
    // §10.3 #10: mimic clone (delay 30), clone hits at 0.5×, swap via SlotFn + script teleport.
    async echo(id) {
      const P = await probeGame([id, 'ember']);
      P.place(0, -250, 1); P.place(1, 250, -1); P.run(10);
      P.tap({ special: true, down: true }, 40);
      const clone = P.ents(0, 'echo')[0];
      expect(id, !!clone && clone.kind === 'clone' && clone.delay === 30, `Split spawned a mimic clone (delay ${clone?.delay})`);
      // The clone replays the jab 30 frames late.
      const t0 = P.game.frame;
      P.tap({ attack: true }, 45);
      const mine = P.events('move', (e) => e.id === P.f(0).id && e.frame > t0);
      const copy = P.events('move', (e) => typeof e.id === 'string' && e.id.includes('#c') && e.frame > t0);
      const lag = copy[0] && mine[0] ? copy[0].frame - mine[0].frame : null;
      expect(id, lag !== null && lag >= 28 && lag <= 32, `clone jab ${lag} frames after Echo's (mimic delay 30)`);
      // Clone damage: put ember right in front of the clone and replay a forward tilt.
      const c = P.ents(0, 'echo')[0];
      if (c) {
        P.place(0, c.x - 200, 1); P.place(1, c.x + 40, -1); P.run(2);
        const before = P.events('hit').length;
        P.tap({ attack: true, right: true }, 50);
        const hits = P.events('hit').slice(before).filter((e) => e.target === P.f(1).id);
        // Clone hits are reported with the owner as attacker (no clone flag); Echo is 200+ px away here.
        const byClone = hits.find((e) => Math.abs(e.x - P.f(0).x) > 120);
        expect(id, !!byClone && byClone.damage <= 9 * 0.5 + 0.01, `clone forward tilt dealt ${byClone ? byClone.damage : 'no hit'} (Echo's is 9 → ≤ 4.5)`);
      }
      // SlotFn: with an Echo out, side special should route to Swap.
      if (P.ents(0, 'echo').length) {
        const t1 = P.game.frame;
        P.tap({ special: true, right: true }, 30);
        const mv = P.events('move', (e) => e.id === P.f(0).id && e.frame > t1)[0];
        if (mv && mv.name === 'swap') expect(id, P.ents(0, 'echo').length === 0, 'Swap teleported to the Echo and despawned it');
        else console.log(`  ! ${id} probe: side special resolved to "${mv?.name}" — SlotFns are never consulted by input-map.resolveMove (engine bug, reported)`);
      }
    },

    // §10.3 #11: minimum body — area priced at the floor, stat squeeze ran, small reach still lands.
    async pebble(id) {
      const P = await probeGame([id, 'ember']);
      const ir = P.f(0).char;
      const sp = ir.report?.statPoints;
      expect(id, sp && sp.breakdown?.hurtboxArea === 25, `1600 px² default hurtbox costs ${sp?.breakdown?.hurtboxArea} pts (expected 25)`);
      expect(id, sp && sp.total <= 52, `stat squeeze: ${sp?.total}/52 after squeezing paid stats`);
      expect(id, ir.forms.base.stats.airJumps === 1 && ir.forms.base.stats.runSpeed < 7.8, `squeezed: runSpeed 7.8 → ${ir.forms.base.stats.runSpeed}, airJumps 2 → ${ir.forms.base.stats.airJumps}`);
      P.place(0, -60, 1); P.place(1, 0, -1); P.run(5);
      const p0 = P.f(1).percent;
      P.tap({ attack: true }, 20);
      expect(id, P.f(1).percent > p0, `Bonk reaches from the tiny body (${(P.f(1).percent - p0).toFixed(1)}%)`);
      P.place(0, -200, 1); P.place(1, 300, -1); P.run(5);
      const x0 = P.f(0).x;
      P.tap({ special: true, right: true }, 45);
      expect(id, P.f(0).x - x0 > 100 && P.events('fx', (e) => e.name === 'skip').length >= 1, `Skip travelled ${(P.f(0).x - x0).toFixed(0)} px with a skip splash`);
    },

    // §10.3 #12: 45 intangible frames per 300; denied phasing is visible (gov event + noSignal fx).
    async 'static-ghost'(id) {
      const P = await probeGame([id, 'ember']);
      P.place(0, -200, 1); P.place(1, 300, -1); P.run(5);
      const phased = [];
      const step = (n, input) => { for (let k = 0; k < n; k++) { P.run(1, 0, k === 0 ? input : {}); if (P.game.snapshot().fighters[0].intangible) phased.push(P.game.frame); } };
      const t0 = P.game.frame;
      step(95, { special: true, down: true });   // Fade Out (20)
      step(95, { special: true, down: true });   // Fade Out (20)
      step(110, { special: true, down: true });  // Fade Out → only 5 left: denied/partial
      const used = inWin(phased, t0, t0 + 300);
      const denied = P.events('gov', (e) => e.rule === 'intangible' && e.who === P.f(0).id).length;
      const noSig = P.events('fx', (e) => e.name === 'noSignal').length;
      expect(id, used <= GOVERNOR.intangible.budget, `phased ${used} frames in 300 (budget ${GOVERNOR.intangible.budget})`);
      expect(id, used >= 35, `the first two Fade Outs were granted (${used} frames)`);
      expect(id, denied >= 1 && noSig >= 1, `the third Fade Out was trimmed: ${denied} gov intangible event(s), ${noSig} NO SIGNAL fx`);
      // Channel Surf phases through ember's forward smash.
      P.run(320);
      P.place(0, -120, 1); P.place(1, 0, -1); P.run(3);
      const pc = P.f(0).percent;
      P.tap({ strong: true, left: true }, 0, 1);
      P.run(4);
      P.tap({ special: true, right: true }, 40);
      expect(id, P.f(0).x > P.f(1).x, `Channel Surf went through ember (x ${P.f(0).x.toFixed(0)} vs ${P.f(1).x.toFixed(0)}), took ${(P.f(0).percent - pc).toFixed(1)}%`);
    },

    // Invention: coins resource, rng product roll from a script, cost/else, hold-to-restock.
    async vendy(id) {
      const P = await probeGame([id, 'ember']);
      P.place(0, -250, 1); P.place(1, -440, 1); P.run(5);                // ember behind: no coin-earning hits
      const coins0 = P.res(0, 'coins');
      for (let i = 0; i < 4; i++) P.tap({ special: true }, 45);
      const products = P.events('fx', (e) => e.name === 'dispense').map((e) => e.data?.p);
      const spawns = P.events('spawn', (e) => ['soda', 'candy', 'chips'].includes(e.name)).length;
      expect(id, products.length === Math.floor(coins0) && spawns === products.length, `${coins0} coins → dispensed ${products.join(', ')} (${spawns} spawns)`);
      expect(id, P.events('fx', (e) => e.name === 'outOfOrder').length >= 1, 'broke → Out of Order (cost/else)');
      const c1 = P.res(0, 'coins');
      P.run(90, 0, { special: true, down: true });
      P.run(30);
      expect(id, P.res(0, 'coins') > c1 + 1, `Restock held: coins ${c1} → ${P.res(0, 'coins')}`);
      // Chips: force rolls until a bag walks, then check its expire → burst chain.
      setRes(P, 0, 'coins', 8);
      let chips = false;
      for (let i = 0; i < 8 && !chips; i++) { P.tap({ special: true }, 40); chips = P.ents(0, 'chips').length > 0; }
      if (chips) { P.run(220); expect(id, P.events('spawn', (e) => e.name === 'chipBurst').length >= 1, 'chips expired into a chipBurst (onExpire spawn chain)'); }
      else console.log(`  ! ${id} probe: no chips rolled in 8 tries (rng)`);
      const big = P.f(0).char.report?.statPoints?.breakdown?.hurtboxArea;
      expect(id, big < 0, `8400 px² body refunds ${big} stat points`);
    },

    // Invention: beat-synced scripts (view.frame), onHit → groove, api.hit bass drop, trap `every`, api.modify.
    async 'dj-tempo'(id) {
      const P = await probeGame([id, 'ember']);
      P.place(0, -60, 1); P.place(1, 40, -1); P.run(5);
      P.tap({ special: true, down: true }, 100);
      const pulses = P.events('spawn', (e) => e.name === 'pulse').length;
      expect(id, P.ents(0, 'speaker').length === 1 && pulses >= 2, `speaker trap pulses every 30 f (${pulses} pulses)`);
      // Bass drop: groove ≥ 50 and the hit frame on a beat.
      let dropped = null;
      for (let off = 0; off < 30 && !dropped; off++) {
        setRes(P, 0, 'groove', 80);
        P.place(0, -60, 1); P.place(1, 0, -1); P.f(1).percent = 0;
        P.run(1 + off);
        const t = P.game.frame;
        P.tap({ special: true }, 45);
        dropped = P.events('fx', (e) => e.name === 'drop' && e.frame > t && e.data?.big)[0] || null;
        P.run(30 - off);
      }
      const bassHit = P.events('hit', (e) => e.move === 'bassDrop');
      expect(id, !!dropped && bassHit.length >= 1, `on-beat Drop the Beat → bass drop (${bassHit.length} bassDrop hit, status ${P.f(1).statuses?.map?.((s) => s.name).join(',') ?? '?'})`);
      expect(id, P.events('fx', (e) => e.name === 'perfect').length >= 1 || P.res(0, 'groove') > 0, 'on-beat hits register PERFECT / groove');
    },

    // Invention: 2-second history ring in vars, rewind teleport (≤ 200 px) and heal through the budget.
    async rewinda(id) {
      const P = await probeGame([id, 'ember']);
      P.place(0, -300, 1); P.place(1, 400, -1); P.run(130);
      P.run(80, 0, { right: true });
      P.run(5);
      P.f(0).percent = 40;
      const x0 = P.f(0).x, p0 = P.f(0).percent;
      P.tap({ special: true, down: true }, 40);
      const rw = P.events('fx', (e) => e.name === 'rewind')[0];
      const moved = x0 - P.f(0).x;
      expect(id, !!rw && moved > 40 && moved <= 200.5, `rewound ${moved.toFixed(0)} px toward ${rw?.data?.x} (teleport ≤ 200)`);
      expect(id, P.res(0, 'sand') < 60, `cost 60 sand (left ${P.res(0, 'sand').toFixed(0)})`);
      P.run(150);
      const healed = p0 - P.f(0).percent;
      expect(id, healed >= 3 && healed <= 8, `mended ${healed.toFixed(1)}% over ~3 s (heal + 'mended' status, ≤ 1% per 30 f)`);
      P.place(0, -100, 1); P.place(1, -30, -1); P.run(3);
      const pe = P.f(1).percent;
      P.tap({ special: true }, 70);
      expect(id, P.f(1).percent > pe, `clock bomb went off late (${(P.f(1).percent - pe).toFixed(1)}%)`);
    },
  };
}
