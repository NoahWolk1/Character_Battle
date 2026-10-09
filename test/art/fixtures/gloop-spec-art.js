// Spec §2.5 Gloop art verbatim (shared/art/helpers/blob.js), import paths adjusted for test/art/fixtures.
// characters/gloop/art.js — soft-body gel (shared/art/helpers/blob.js) that springs toward the current hurtbox shapes.
import * as kit from '../../../shared/art/kit.js';
import { blob } from '../../../shared/art/helpers/blob.js';

const GEL = { base: '#57e389', deep: '#1f8a4c', spec: '#eafff1', outline: '#0f4a29', eye: '#0b1f14' };

export default {
  rig: 'none',
  bounds: { base: { left: -100, right: 150, top: -170, bottom: 16 },
            puddle: { left: -110, right: 150, top: -130, bottom: 12 },
            spike: { left: -110, right: 150, top: -150, bottom: 16 } },
  palette: { main: GEL.base, effect: '#7dff9a', outline: GEL.outline },
  palettes: [{}, { base: '#e35798', deep: '#8a1f56' }, { base: '#57a6e3', deep: '#1f4f8a' }, { base: '#e3c457', deep: '#8a6f1f' }],

  init(cache) { cache.gel = blob.create({ points: 28, stiffness: 0.18, damping: 0.82, seed: 3 }); },

  draw(ctx, v, info) {
    const target = info.phase.name === 'active' && info.hitboxes.length ? [...info.hurtboxes, ...info.hitboxes] : info.hurtboxes;
    blob.step(info.cache.gel, { shapes: target, dt: info.dt, impulse: info.motion, wobble: v.state === 'hitstun' ? 2 : 0.6 });
    const path = blob.path(info.cache.gel);
    // body: deep core → base → specular, translucent inner bubbles
    kit.fillPath(ctx, path, kit.radial(ctx, 0, -40, 10, 70, [GEL.base, GEL.deep]), { outline: GEL.outline, lineWidth: 3 });
    ctx.save(); ctx.clip(path);
    for (let i = 0; i < 6; i++) kit.circle(ctx, Math.sin(info.time * 0.7 + i * 2) * 20, -20 - ((info.time * 12 + i * 17) % 50), 2 + (i % 3), 'rgba(255,255,255,0.25)');
    kit.rimLightPath(ctx, path, info.light.dir, GEL.spec, 3, 0.6);
    ctx.restore();
    if (v.form === 'spike') blob.spikes(ctx, info.cache.gel, { count: 12, length: 12, color: GEL.deep, outline: GEL.outline });
    // face rides the topmost blob point; squints when attacking
    const top = blob.top(info.cache.gel);
    const sq = v.state === 'attack' ? 0.4 : 1;
    kit.ellipse(ctx, top.x + 6, top.y + 14, 4, 6 * sq, GEL.eye); kit.ellipse(ctx, top.x + 18, top.y + 14, 4, 6 * sq, GEL.eye);
    for (const s of v.statuses) if (s.name === 'sticky') info.tint('#7dff9a', 0.15);
  },

  entities: {
    glob:       { draw(ctx, e, info) { kit.droplet(ctx, 0, 0, 8, GEL.base, Math.atan2(e.vy, e.vx), GEL.outline); } },
    puddleTrap: { draw(ctx, e, info) { kit.goo(ctx, 60, 8, GEL.base, info.time, e.lifeT); } },
    gloopling:  { draw(ctx, e, info) { info.drawSelf(ctx, e.view, { scale: 0.6, alpha: 0.85 }); } },   // re-uses draw() with the clone's view
  },
  fx: {
    onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 8, shape: 'drip', color: GEL.base, speed: [2, 6], gravity: 0.3, life: [20, 30] }); },
    onEvent: { gulp(fx, ev) { fx.sound('gulp'); fx.ring({ x: ev.x + 30, y: ev.y - 34, r0: 40, r1: 10, color: '#7dff9a', life: 10 }); } },
    onFormChange(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 30, count: 20, shape: 'drip', color: GEL.base, speed: [3, 7], gravity: 0.35, life: 30 }); },
  },
  sounds: { gulp: 'splash', jump: 'boing' },
};
