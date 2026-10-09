// Cheater #18 (not loaded by the server): nondeterminism in sim hooks and module state.
import { defineCharacter } from '../../../../shared/char/api.js';

let combo = 0;

export default defineCharacter({
  id: 'chaosmonkey', name: 'Chaos Monkey',
  behavior: {
    tick(view, api) {
      combo++;
      if (Math.random() < 0.5) api.impulse(Date.now() % 3, 0);
    },
    onHit(view, api) { combo += performance.now() > 0 ? 1 : 0; },
  },
  slots: { jab: () => (Math.random() < 0.5 ? 'jab' : 'side') },
});
