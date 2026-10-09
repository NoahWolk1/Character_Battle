// Test fixture (not loaded by the server): a v2 character whose tick hook never
// returns. The room watchdog must abort only this character's room (spec §5.2).
import { defineCharacter } from '../../../../shared/char/api.js';

export default defineCharacter({
  id: 'looper',
  name: 'Looper',
  author: 'test',
  description: 'Hangs the simulation on purpose.',
  behavior: {
    tick(view) {
      for (;;) { if (view === null) break; } // eslint-disable-line no-constant-condition
    },
  },
});
