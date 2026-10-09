// Test fixture: spec §2 example, verbatim except import paths (test/fixtures is one level deeper than characters/).
// characters/gertie/art.js — painted sprite sheet (2× source res) plus procedural overlays.
import * as kit from '../../../shared/art/kit.js';

export default {
  rig: 'none',
  assets: { sheet: './gertie.png', teeth: './teeth.png', chatter: './chatter.ogg', honk: './honk.ogg' },
  sheets: {
    body:  { image: 'sheet', frameW: 256, frameH: 256, cols: 8, anchor: [112, 236], scale: 0.5 },
    teeth: { image: 'teeth', frameW: 48, frameH: 48, cols: 4, anchor: [24, 24], scale: 0.5 },
  },
  clips: {
    body: {
      idle:   { frames: [0, 1, 2, 3], fps: 6, loop: true },
      run:    { frames: [8, 9, 10, 11], fps: 14, loop: true, speedFrom: 'vx' },
      jump:   { frames: [16] }, fall: { frames: [17] }, glide: { frames: [18, 19], fps: 6, loop: true },
      hurt:   { frames: [20] }, tumble: { frames: [21, 22], fps: 10, loop: true },
      shield: { frames: [23] }, crouch: { frames: [24] }, land: { frames: [24] },
      grabbing: { frames: [56] }, grabbed: { frames: [20] }, helpless: { frames: [17] }, taunt: { frames: [60, 61], fps: 4, loop: true },
      jab:      { sync: 'move', startup: [26], active: [27], recovery: [28] },
      cane:     { sync: 'move', startup: [32, 33], active: [34], recovery: [35, 36] },
      handbag:  { sync: 'move', startup: [40, 41, 42], active: [43], recovery: [44, 45], charge: [42] },
      ram:      { sync: 'move', startup: [48], active: [49, 50], recovery: [51] },
      tea:      { sync: 'move', startup: [52, 53], hold: [54, 55], recovery: [53] },
      grab:     { sync: 'move', startup: [56], active: [57], recovery: [58] },
      // unlisted anims fall back: state clip → idle
    },
  },
  bounds: { left: -90, right: 140, top: -170, bottom: 16 },
  palette: { main: '#c9a0dc', effect: '#ffd166', outline: '#3a2340' },

  draw(ctx, v, info) {
    info.sprite.drawClip(ctx, 'body', v);                               // engine picks clip from move.anim/state/phase
    if (v.state === 'run' || v.move?.anim === 'ram') info.fx.local.smoke({ x: -40, y: -14, rate: 0.6, color: '#9a9a9a', size: [4, 9] });
    if (v.resources.battery < 35) kit.blinkIcon(ctx, -20, -112, 'battery-low', info.time);
    if (v.move?.anim === 'ram' && v.move.phase === 'active') kit.speedLines(ctx, -60, -60, 120, 70, '#ffffff', info.time);
  },
  trail(v, info) { return v.move?.anim === 'cane' ? { x: 104, y: -40 } : null; },   // null = hitbox-center default

  entities: {
    dentures: { draw(ctx, e, info) { info.sprite.drawFrame(ctx, 'teeth', (e.age >> 2) % 4, { rotate: e.age * 0.3 }); } },
    yarnBall: { draw(ctx, e, info) { kit.yarnBall(ctx, 0, 0, 12, '#e86fa0', e.age * 0.2, { trail: true }); } },
  },
  fx: {
    onEvent: {
      lecture(fx, ev) { fx.text({ x: ev.x, y: ev.y - 120, text: 'Back in MY day…', color: '#fff', life: 70, size: 16 }); },
      sputter(fx, ev) { fx.burst({ x: ev.x - 30, y: ev.y - 14, count: 8, shape: 'smoke', color: '#555', speed: [1, 2], life: 30 }); fx.sound('honk', { pitch: 0.6 }); },
      slamDust(fx, ev) { fx.ring({ x: ev.x, y: ev.y, r0: 10, r1: 90, color: '#d8c8a8', life: 14, flat: true }); fx.shake(4); },
    },
  },
  sounds: { taunt: 'honk' },
  portrait(ctx, size, info) { info.drawIdle(ctx, { focus: { x: 6, y: -80 }, zoom: size / 90 }); },
};
