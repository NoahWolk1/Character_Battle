// Test fixture: spec §2 example, verbatim except import paths (test/fixtures is one level deeper than characters/).
// Placeholder art: the spec's gloop art needs shared/art/helpers/blob.js (WP-K), which may not exist yet.
import * as kit from '../../../shared/art/kit.js';

const GEL = { base: '#57e389', deep: '#1f8a4c', outline: '#0f4a29', eye: '#0b1f14' };

export default {
  rig: 'none',
  bounds: { base: { left: -100, right: 150, top: -170, bottom: 16 },
            puddle: { left: -110, right: 150, top: -130, bottom: 12 },
            spike: { left: -110, right: 150, top: -150, bottom: 16 } },
  palette: { main: GEL.base, effect: '#7dff9a', outline: GEL.outline },
  draw(ctx, v, info) {
    for (const s of info.hurtboxes || []) if (s.r) kit.circle(ctx, s.x ?? 0, s.y ?? 0, s.r, GEL.base, { outline: GEL.outline });
  },
  sounds: { gulp: 'splash', jump: 'boing' },
};
