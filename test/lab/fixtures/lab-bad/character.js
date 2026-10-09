// LAB-BAD — purpose-built bad art for the Art Lab checks (spec §6.6, WP-M acceptance).
// Gameplay is a plain, valid kit; art.js breaks every check on purpose:
//   hitbox-coverage  jab hitbox far in front of anything drawn
//   hurtbox-fit      a thin pole inside a wide hurtbox + a plank sticking far outside it
//   bounds-overflow  the plank runs past art.bounds on both sides
//   contrast         flat grey close to the stage backdrop lightness
//   perf             a few ms of pointless math per draw
// Served at /dev/lab-fixtures/lab-bad/ (server/dev-routes.js); see test/lab/checks.test.js.
import { defineCharacter } from '../../../../shared/char/api.js';
import art from './art.js';

export default defineCharacter({
  id: 'lab-bad',
  name: 'Lab Bad',
  author: 'test fixture',
  description: 'Deliberately bad art that trips every Art Lab check.',
  body: {
    collider: { w: 60, h: 100 },
    hurtboxes: { default: [{ shape: 'rect', x: 0, y: -50, w: 60, h: 100 }] },
  },
  stats: { weight: 100, runSpeed: 6, airSpeed: 4.5, jumpHeight: 15, doubleJumpHeight: 14, airJumps: 1, gravity: 0.7, fallSpeed: 11 },
  moves: {
    jab: { name: 'Far Poke', duration: 18, anim: 'poke',
      hitboxes: [{ start: 4, end: 7, x: 70, y: -50, r: 14, damage: 3, angle: 60, knockback: 10, growth: 20 }] },
    taunt: { name: 'Shrug', category: 'taunt', duration: 30, anim: 'shrug' },
  },
  art,
});
