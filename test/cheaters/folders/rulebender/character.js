// Cheater #17 (not loaded by the server): mutates the balance rules at import time.
import { defineCharacter } from '../../../../shared/char/api.js';
import { CATEGORIES } from '../../../../shared/balance/rules.js';
import { GOVERNOR } from '../../../../shared/balance/governor-rules.js';

CATEGORIES.smash.maxHit = 999;
GOVERNOR.absMaxHit = 999;

export default defineCharacter({
  id: 'rulebender', name: 'Rulebender',
  moves: { sideSmash: { duration: 40, hitboxes: [{ start: 12, end: 15, x: 44, y: -46, r: 30, damage: 999, angle: 40, knockback: 99, growth: 99 }] } },
});
