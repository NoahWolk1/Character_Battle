// Cheater #19 (not loaded by the server): an infinite loop in `tick`.
import { defineCharacter } from '../../../../shared/char/api.js';

export default defineCharacter({
  id: 'spinlock', name: 'Spinlock',
  behavior: {
    tick(view) {
      let n = 0;
      while (view.frame > 0) { n++; }
      return n;
    },
  },
});
