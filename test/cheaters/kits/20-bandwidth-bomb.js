// #20 Bandwidth bomb: emit 10 KB of fx data many times per frame; 32 synced vars set to
// long strings (ASCII and 4-byte emoji) every frame; long names; entity vars.
// Invariant: fx data ≤ 256 B and ≤ 8 fx per frame; vars ≤ 2 KB; snapshot ≤ 6 KB
// (measured as UTF-8 bytes on the wire, not just string length).
import { load, scenario, brawler } from '../harness.js';

const vars = {};
for (let i = 0; i < 32; i++) vars[`v${String(i).padStart(2, '0')}`] = '';
const EMOJI = '\u{1F4A5}'; // 4 UTF-8 bytes, 2 UTF-16 units

export const def = {
  version: 2, id: 'spammy', name: 'Spammy', vars, sync: Object.keys(vars),
  entities: { blip: { kind: 'minion', life: 600, shape: { shape: 'circle', x: 0, y: 0, r: 8 }, motion: { type: 'orbit', radius: 60, around: 'owner' }, vars: { a: '', b: '', c: '', d: '' },
    think(view, e, api) { for (const k of ['a', 'b', 'c', 'd']) api.evars.set(k, EMOJI.repeat(500)); } } },
  behavior: {
    tick(view, api) {
      api.emit('fit', { s: EMOJI.repeat(60) });  // 248 UTF-8 bytes (128 chars): must arrive intact
      api.emit('over', { s: EMOJI.repeat(64) }); // 264 UTF-8 bytes (136 chars): data must be dropped
      api.emit('ok', { s: EMOJI.repeat(120) }); // 240 JSON chars, ~480 UTF-8 bytes
      for (let i = 0; i < 20; i++) api.emit(i % 2 ? `boom${i}` : `boom${'!'.repeat(60)}`, { s: 'x'.repeat(10240), i });
      for (let i = 0; i < 12; i++) api.emit(`pop${i}`, { i });
      for (const k of Object.keys(vars)) api.vars.set(k, (view.frame % 2 ? EMOJI : 'y').repeat(5000));
      if (view.entities('blip').length < 8) api.spawn('blip');
      api.sfx('s'.repeat(500));
    },
  },
};

const utf8 = (s) => Buffer.byteLength(s, 'utf8');

export default {
  n: 20, name: 'bandwidth-bomb', character: 'spammy', invariant: 'fx ≤ 256 B and ≤ 8/frame; vars ≤ 2 KB; snapshot ≤ 6 KB (UTF-8)',
  async run({ ck, opp }) {
    const v = load(def);
    let fit = 0, maxFx = 0, maxData = 0, maxVars = 0, maxSnap = 0, maxSnapChars = 0;
    const S = await scenario({
      cheater: v, opp, frames: 600, ck, keepEvents: false, input: brawler(['attack'], { gap: 20 }),
      each(S) {
        const fx = S.frameEvents.filter((e) => (e.type === 'fx' || e.type === 'sfx' || e.type === 'camera') && e.id === S.me.id);
        maxFx = Math.max(maxFx, fx.length);
        ck.check(fx.length <= 8, `${fx.length} fx events in one frame (> 8, frame ${S.frame})`, 'fxCount');
        for (const e of fx) {
          const b = e.data == null ? 0 : utf8(JSON.stringify(e.data));
          maxData = Math.max(maxData, b);
          ck.issue(b <= 256, `fx data is ${b} UTF-8 bytes on the wire (> 256): the §2.2.9 / §10.2 #20 limit is 256 BYTES but cleanJson() checks j.length (UTF-16 code units), so 4-byte emoji pass at up to ~2× (and ~1.5× for 3-byte chars). Fix: gate on Buffer.byteLength(j,'utf8') / a UTF-8 byte count, not String#length. [root: shared/sim/script-api.js cleanJson(), L.fxDataBytes]`, 'fxBytes');
          if (e.name === 'fit' && e.data && e.data.s === EMOJI.repeat(60)) fit++;
          ck.check(!(e.name === 'over' && e.data), 'a 264-byte fx payload (136 chars) was delivered (> 256 B)', 'over');
          ck.check(!e.name || e.name.length <= 32, `fx name of ${e.name.length} chars`, 'fxName');
        }
        const vb = utf8(JSON.stringify(S.me.vars || {}));
        maxVars = Math.max(maxVars, vb);
        ck.check(vb <= 2048, `vars ${vb} B (> 2 KB, frame ${S.frame})`, 'vars');
        if (S.frame % 10 === 0) {
          const js = JSON.stringify(S.game.snapshot());
          maxSnapChars = Math.max(maxSnapChars, js.length);
          maxSnap = Math.max(maxSnap, utf8(js));
          ck.check(utf8(js) <= 6144, `snapshot ${utf8(js)} B UTF-8 (${js.length} chars) > 6 KB (frame ${S.frame})`, 'snap');
        }
      },
    });
    ck.check(fit > 0, 'a 248-byte fx payload never arrived intact (the byte limit is too strict or fx were never delivered)');
    return { fitDelivered: fit, maxFxPerFrame: maxFx, maxFxDataBytes: maxData, maxVarsBytes: maxVars, maxSnapshotBytes: maxSnap, maxSnapshotChars: maxSnapChars, gov: { scriptFx: S.gov.scriptFx || 0, scriptCommands: S.gov.scriptCommands || 0 } };
  },
};
