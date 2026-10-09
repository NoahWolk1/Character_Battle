// Test fixture: spec §2 example, verbatim except import paths (test/fixtures is one level deeper than characters/).
// characters/nimbus/art.js — procedural: layered puffs with sunset rim light, angry face, rain and arcs.
import * as kit from '../../../shared/art/kit.js';

const PAL = { dark: '#3b4560', mid: '#5d6a8c', light: '#9aa7c8', rim: '#ffd2a1', eye: '#fff7d6', bolt: '#bff4ff' };
const PUFFS = [[0, -48, 30], [-30, -36, 21], [30, -38, 23], [-14, -62, 19], [16, -64, 20], [0, -26, 26]];

export default {
  rig: 'none',
  bounds: { left: -110, right: 130, top: -170, bottom: 30 },
  palette: { main: PAL.mid, effect: PAL.bolt, outline: '#232842' },
  palettes: [{}, { mid: '#7b6a8c' }, { mid: '#5d8c7a' }, { mid: '#8c6a5d' }],

  draw(ctx, v, info) {
    const { time: t, phase, motion, light } = info;
    const anger = v.state === 'attack' || v.state === 'hitstun' ? 1 : 0;
    const squash = motion.squash;                                      // landing/jump squash from engine
    const swell = phase.name === 'startup' ? phase.t * 0.12 : phase.name === 'active' ? 0.15 : 0;
    const s = v.bodyScale * (1 + swell);
    ctx.save(); ctx.scale(s * (1 + squash * 0.15), s * (1 - squash * 0.15));
    for (const [i, [x, y, r]] of PUFFS.entries()) {                    // back-to-front: dark under, light top
      const bob = Math.sin(t * 2 + i) * 2;
      kit.circle(ctx, x, y + bob + 4, r, PAL.dark);
      const g = ctx.createRadialGradient(x - r * 0.3, y + bob - r * 0.4, r * 0.2, x, y + bob, r);
      g.addColorStop(0, PAL.light); g.addColorStop(1, anger ? '#4a4f6e' : PAL.mid);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y + bob, r, 0, kit.TAU); ctx.fill();
      kit.rimArc(ctx, x, y + bob, r, light.dir, PAL.rim, 2.2, 0.8);
    }
    // face
    const blink = (t % 3.4) < 0.1 ? 0.15 : 1;
    for (const ex of [-9, 9]) kit.ellipse(ctx, 10 + ex, -48, 4.5, 5.5 * blink, PAL.eye);
    ctx.strokeStyle = '#232842'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(1, -58 + anger * 2); ctx.lineTo(14, -55 - anger * 3); ctx.lineTo(27, -58 + anger * 2); ctx.stroke();
    // charge: arcs crawling over the cloud
    const c = v.resources.charge / 100;
    for (let i = 0; i < Math.round(c * 5); i++) kit.lightning(ctx, info.rng, -30 + i * 14, -70, -24 + i * 14, -20, PAL.bolt, 1.5, 0.7);
    ctx.restore();
    // swarm the hitbox: active hitboxes glow so the visual IS the hitbox
    if (phase.name === 'active') for (const hb of info.hitboxes) kit.shapeGlow(ctx, hb, PAL.bolt, 0.35);
  },

  drawWorld(ctx, v, info) {                                            // unclipped: rain streaks below cloud
    if (v.state === 'attack' && v.move?.name === 'Updraft') kit.rain(ctx, info, { x: 0, y: -10, w: 70, h: 120, color: '#8fc3ff' });
  },

  entities: {
    raincloud: { draw(ctx, e, info) { kit.cloudPuffs(ctx, 0, 0, 60, PAL.dark, info.time); kit.rain(ctx, info, { x: 0, y: 10, w: 110, h: 200, color: '#8fc3ff', fade: e.lifeT }); } },
    strike:    { draw(ctx, e, info) { if (e.age >= 6) kit.lightning(ctx, info.rng, 0, -320, 0, 0, PAL.bolt, 6, 1, { branches: 3, glow: 18 }); } },
    bigStrike: { draw(ctx, e, info) { if (e.age >= 6) kit.lightning(ctx, info.rng, 0, -340, 0, 0, '#ffffff', 10, 1, { branches: 5, glow: 30 }); } },
    ionBeam:   { draw(ctx, e, info) { kit.beam(ctx, 0, 0, e.len, 12, PAL.bolt, info.time, { core: '#ffffff', jitter: 3 }); } },
  },

  fx: {
    onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 10, shape: 'spark', color: PAL.bolt, speed: [3, 8], life: [10, 18], blend: 'lighter' }); },
    onEvent: {
      thunder(fx, ev) { fx.flash('#e8fbff', ev.data.big ? 0.3 : 0.15, 4); fx.shake(ev.data.big ? 7 : 3); fx.sound('thunder', { volume: ev.data.big ? 1 : 0.6 }); },
      discharge(fx, ev) { fx.ring({ x: ev.x, y: ev.y - 40, r0: 20, r1: 70, color: PAL.bolt, life: 12 }); },
      rumble(fx, ev) { fx.sound('thunder', { volume: 0.4, pitch: 0.7 }); },
    },
  },
  assets: { thunder: './thunder.ogg' },
  sounds: { jump: 'whoosh', hit: null, 'zap-loop': 'zap', 'rain-start': 'splash' },
  portrait: { x: 4, y: -46, r: 52 },
};
