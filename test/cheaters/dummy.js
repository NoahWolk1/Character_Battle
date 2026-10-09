// The reference dummy (spec §10.2): a plain, honest v2 character with mid stats and
// three legal attacks. Driven by the harness (idle, or a fixed attack pattern).
export function dummyDef({ weight = 100 } = {}) {
  return {
    version: 2, id: 'dummy', name: 'Dummy',
    stats: { weight, runSpeed: 6, airSpeed: 4.5, jumpHeight: 14, doubleJumpHeight: 13, airJumps: 1, gravity: 0.75, fallSpeed: 12 },
    body: { collider: { w: 52, h: 92 } },
    moves: {
      jab: { duration: 18, hitboxes: [{ start: 3, end: 6, x: 34, y: -50, r: 22, damage: 3, angle: 40, knockback: 12, growth: 20 }] },
      side: { duration: 26, hitboxes: [{ start: 6, end: 9, x: 40, y: -45, r: 24, damage: 8, angle: 40, knockback: 30, growth: 60 }] },
      down: { duration: 24, hitboxes: [{ start: 5, end: 8, x: 36, y: -14, r: 22, damage: 6, angle: 70, knockback: 25, growth: 40 }] },
      sideSmash: { duration: 44, hitboxes: [{ start: 12, end: 15, x: 46, y: -46, r: 28, damage: 14, angle: 40, knockback: 35, growth: 90 }] },
    },
  };
}
