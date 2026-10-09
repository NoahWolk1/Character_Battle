// #21 Hooks that try to mutate a frozen view (`view.me.percent = 0`), write to view
// fields, stash the view/api for a later frame, and reach engine state through the
// view's prototype chain. Invariant: writes throw a TypeError (frozen view) with no
// effect on state; a stale view throws when used after its call; the sandbox guard
// disables the cheater's scripts, and the opponent and sim are unaffected.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, scenario, brawler } from '../harness.js';
import { loadCharacter } from '../../../server/characters.js';
import { lintFolder } from '../../../scripts/lint-characters.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'folders');

// Inline cheater (valid syntax): every tick tries to mutate state through the view.
export const def = {
  version: 2, id: 'poltergeist', name: 'Poltergeist',
  vars: { stash: false },
  behavior: {
    tick(view, api) {
      view.me.percent = 0;          // frozen view: must throw
      view.me.x = -9999;
      view.x = 1;
    },
    onHit(view, api) { view.me.percent = 0; },
  },
};

export default {
  n: 21, name: 'view-mutation', character: 'poltergeist', invariant: 'frozen view: writes throw, no state change; realm unreachable',
  async run({ ck, opp }) {
    const v = load(def);
    const S = await scenario({
      cheater: v, opp, frames: 900, ck, dummyRole: 'attack',
      each(S) {
        // The write throws → the hook faults → after 3 faults scripts are disabled, but the
        // percent is never zeroed by the hook (damage only ever rises from hits).
        ck.check(S.me.x > -9999, `view.me.x write reached the fighter (x=${S.me.x})`, 'x');
      },
    });
    const errs = S.events.filter((e) => e.type === 'scriptError' && e.id === S.me.id);
    ck.check(errs.length >= 1, 'writing a frozen view did not fault');
    ck.check(errs.every((e) => /Cannot assign|read only|not extensible|object is not extensible|TypeError/i.test(e.message)), `fault was not a frozen-view TypeError: ${errs.map((e) => e.message).join(' | ').slice(0, 200)}`);
    ck.check(!!S.me.scriptsDisabled, 'the cheater kept running hooks after repeated faults');
    ck.check(!S.foe.scriptsDisabled, 'the opponent was disabled too');

    // Part b: a folder cheater that walks the view's constructor chain toward the realm.
    // The spec's runtime hook isolation is future work (§5 item 8: SES / isolated-vm), so
    // the current boundary is lint (§5.4) plus PR review. We MEASURE whether the constructor
    // walk reaches the realm and whether lint catches it, and surface it as evidence; the
    // hard assertions are only the documented current contract: the kit still loads and the
    // sim stays correct and deterministic regardless of what the hook touches.
    const r = await loadCharacter('escapee', { dir: DIR });
    ck.check(r.ok, `escapee failed to validate: ${(r.errors || []).join('; ')}`);
    let reached = false, lintRules = [];
    if (r.ok) {
      const B = await scenario({ cheater: r, opp, frames: 600, ck, input: brawler(['attack'], { gap: 20 }) });
      reached = B.events.some((e) => e.type === 'fx' && e.name === 'escaped') || typeof globalThis.__fsReached !== 'undefined';
      lintRules = lintFolder(join(DIR, 'escapee')).map((n) => n.rule);
      ck.note(`constructor-walk realm reach: ${reached ? 'REACHED process/fs' : 'blocked'}; lint flagged: ${lintRules.join(', ') || 'NONE'}`);
      // Both layers must hold: hardenRealm blocks fn.constructor at runtime, and lint flags any `.constructor` read.
      ck.check(!reached, 'a hook reached the worker realm (process.env / import(\'node:fs\')) through `view.constructor.constructor`; hardenRealm must stub the Function constructors');
      ck.check(lintRules.includes('lint/constructor'), `lint did not flag the \`.constructor\` walk (rules: ${lintRules.join(', ') || 'NONE'})`);
    }
    delete globalThis.__fsReached;
    return { faults: errs.length, disabledAt: (S.events.find((e) => e.type === 'gov' && e.rule === 'scriptsDisabled') || {}).frame ?? null, constructorWalkReachedRealm: reached, escapeeLint: lintRules };
  },
};
