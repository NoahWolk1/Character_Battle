// Lint fixture: legal patterns that must stay clean.
import { defineCharacter } from '../../../../../shared/char/api.js';
import * as kit from '../../../../../shared/art/kit.js';
import art from './art.js';
import { ARC } from './data.js';

const TABLE = Object.freeze([1, 2, 3].map((n) => n * 2));
const tint = kit.shade('#88aaff', 0.2);
function pick(view) { for (;;) { if (view.frame % 2) break; return 'jab'; } return 'jab'; }
function staff() {}
Object.defineProperty(staff, 'length', { value: 40 });

export default defineCharacter({
  id: 'good', name: 'Good',
  behavior: {
    tick(view, api) { const local = {}; local.x = view.rng(); let n = 0; while (true) { if (++n > 3) break; } api.setVar('n', TABLE[0] + ARC); },
  },
  slots: { jab: 'jab', side: pick },
  art: { ...art, tint },
});
