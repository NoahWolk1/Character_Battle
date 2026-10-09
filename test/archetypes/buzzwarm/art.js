// Buzzwarm art: a flock of shaded bees (shared/art/helpers/swarm.js) that holds the
// hurtbox silhouette, pours into the hitboxes on active frames, and thins out as the
// `bees` resource drains. A crowned queen rides the core and carries the face.
import * as kit from '../../../shared/art/kit.js';
import { swarm } from '../../../shared/art/helpers/swarm.js';

const C = { body: '#ffd23a', stripe: '#2a1a08', outline: '#4a2c06', wing: '#e8f6ff', honey: '#ffb21e', crown: '#ffe680', eye: '#1a0f04' };

function queen(ctx, x, y, s, v, info) {
  const t = info.time;
  const flap = Math.sin(t * 50) * 0.5 + 0.5;
  // wings (translucent, behind)
  ctx.save();
  ctx.globalAlpha *= 0.55;
  kit.ellipse(ctx, x - 4 * s, y - 13 * s - flap * 4 * s, 13 * s, 6 * s, C.wing, { rotation: -0.6, outline: kit.rgba('#8fb6d8', 0.8), lineWidth: 1.2 });
  kit.ellipse(ctx, x + 6 * s, y - 14 * s - flap * 3 * s, 11 * s, 5 * s, C.wing, { rotation: -0.2, outline: kit.rgba('#8fb6d8', 0.8), lineWidth: 1.2 });
  ctx.restore();
  // abdomen + thorax + head
  ctx.beginPath(); ctx.ellipse(x - 9 * s, y + 2 * s, 13 * s, 9 * s, 0.25, 0, kit.TAU);
  kit.fillShaded(ctx, C.body, { outline: C.outline, lineWidth: 2.5, x: x - 9 * s, y: y + 2 * s, r: 13 * s, gloss: 0.2 });
  ctx.save(); ctx.clip();
  ctx.fillStyle = C.stripe;
  for (const k of [-0.9, -0.2, 0.5]) ctx.fillRect(x - 9 * s + k * 13 * s - 2.5 * s, y - 10 * s, 5 * s, 22 * s);
  ctx.restore();
  kit.circle(ctx, x + 3 * s, y - 2 * s, 7 * s, '#3a2410', { outline: C.outline, lineWidth: 2 });
  kit.circle(ctx, x + 12 * s, y - 5 * s, 7.5 * s, C.body, { outline: C.outline, lineWidth: 2.5, gloss: 0.25 });
  kit.rimArc(ctx, x + 12 * s, y - 5 * s, 7.5 * s, info.light.dir, info.light.rim, 1.6, 0.7);
  // face: big eyes that squint while attacking and pop in hitstun
  const sq = v.state === 'attack' ? 0.45 : v.state === 'hitstun' ? 1.3 : 1;
  kit.ellipse(ctx, x + 15 * s, y - 6 * s, 2.4 * s, 3 * s * sq, C.eye);
  kit.circle(ctx, x + 15.6 * s, y - 7 * s, 0.8 * s, '#ffffff', { outline: null, lineWidth: 0 });
  // antennae + crown
  ctx.strokeStyle = C.outline; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + 13 * s, y - 12 * s); ctx.quadraticCurveTo(x + 15 * s, y - 20 * s, x + 20 * s, y - 20 * s + Math.sin(t * 6) * 1.5); ctx.stroke();
  kit.starPath(ctx, x + 9 * s, y - 15 * s, 3, 5 * s, 2.6 * s, -Math.PI / 2);
  kit.fillShaded(ctx, C.crown, { outline: C.outline, lineWidth: 1.5, x: x + 9 * s, y: y - 15 * s, r: 5 * s });
}

export default {
  rig: 'none',
  bounds: { left: -150, right: 170, top: -200, bottom: 56 },
  palette: { main: C.body, effect: '#ffd23a', outline: C.outline },
  palettes: [{}, { main: '#9be15d' }, { main: '#ff8fb1' }, { main: '#7fd3ff' }],

  init(cache) {
    cache.hive = swarm.create({ count: 60, seed: 11, size: [3.2, 5], spread: 40 });
    cache.sub = { agents: [], rnd: cache.hive.rnd, t: 0, ready: false };
  },

  draw(ctx, v, info) {
    const P = info.palette;
    const bees = Math.max(10, Math.round(v.resources.bees ?? 60));
    const sub = info.cache.sub;
    sub.agents = info.cache.hive.agents.slice(0, bees);
    const active = info.phase.name === 'active' && info.hitboxes.length > 0;
    const shapes = active ? [...info.hitboxes, ...info.hitboxes, ...info.hurtboxes] : info.hurtboxes;
    const hurt = v.state === 'hitstun';
    swarm.step(sub, {
      shapes, dt: info.dt, speed: active ? 9 : v.state === 'run' ? 5 : 3.2,
      jitter: info.phase.name === 'startup' ? 0.9 : 0.45, retarget: active ? 10 : 36, scatter: hurt ? 0.8 : 0,
    });
    // warm hum glow behind the flock
    const core = info.hurtboxes[0] ? kit.shapeCenter(info.hurtboxes[0]) : { x: 0, y: -44 };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, core.x, core.y, 60 * (v.bodyScale || 1), C.honey, 0.1 + (active ? 0.1 : 0));
    ctx.restore();
    // the dense, dark core of the swarm: a deep amber haze that fills the body shapes
    ctx.save();
    for (const s of info.hurtboxes) {
      const c = kit.shapeCenter(s), r = s.r || Math.max(s.w || 0, s.h || 0) / 2 || 30;
      kit.shapePath(ctx, s, -2);
      ctx.fillStyle = kit.radial(ctx, c.x, c.y, 0, r + 6, [kit.rgba('#3a2208', 0.78), kit.rgba('#5a3a10', 0.55), kit.rgba('#5a3a10', 0.12)]);
      ctx.fill();
    }
    ctx.restore();
    // far bees darker, near bees bright (depth): two passes split by slot parity
    swarm.draw(ctx, { ...sub, agents: sub.agents.filter((a) => a.slot % 3 === 0) }, { color: kit.shade(P.main, -0.25), stripe: C.stripe, outline: C.outline, wings: true, alpha: 0.85 });
    // the queen anchors the face (bobs with idle life, leans with motion)
    const bob = Math.sin(info.time * 3) * 3;
    queen(ctx, core.x + info.motion.lean * 6, core.y - 4 + bob - info.motion.squash * 4, 1.15, v, info);
    swarm.draw(ctx, { ...sub, agents: sub.agents.filter((a) => a.slot % 3 !== 0) }, { color: P.main, stripe: C.stripe, outline: C.outline, wings: true, light: info.light });
    // the strike itself: a stateless burst of bees packed into each active hitbox
    if (active) {
      const rnd = kit.seeded(7 + (v.move?.frame || 0));
      for (const hb of info.hitboxes) {
        const pts = Array.from({ length: 14 }, () => kit.shapePoint(hb, rnd));
        swarm.draw(ctx, { t: info.time, agents: pts.map((p, i) => ({ x: p.x, y: p.y, vx: 4, vy: Math.sin(i) * 2, size: 4.2, phase: i, slot: i })) }, { color: P.main, stripe: C.stripe, outline: C.outline, wings: true });
      }
    }
    if (v.statuses.some((s) => s.name === 'stung')) info.tint('#ff6a3a', 0.12);
  },

  trail(v, info) { return info.phase.name === 'active' && info.hitboxes[0] ? kit.shapeCenter(info.hitboxes[0]) : false; },

  entities: {
    drone: {
      draw(ctx, e, info) {
        const t = info.time + e.seed;
        const ang = Math.atan2(e.vy, Math.abs(e.vx) + 0.001);
        ctx.rotate(ang);
        ctx.save(); ctx.globalAlpha *= 0.35;
        for (let i = 1; i <= 3; i++) kit.ellipse(ctx, -i * 5, 0, 3 - i * 0.6, 2 - i * 0.4, C.honey);
        ctx.restore();
        const f = Math.sin(t * 55) * 0.5 + 0.5;
        ctx.save(); ctx.globalAlpha *= 0.6;
        kit.ellipse(ctx, -1, -5 - f * 3, 6, 3, C.wing, { rotation: -0.5 });
        ctx.restore();
        ctx.beginPath(); ctx.ellipse(0, 0, 7, 5, 0, 0, kit.TAU);
        kit.fillShaded(ctx, info.palette.main, { outline: C.outline, lineWidth: 2, x: 0, y: 0, r: 7, gloss: 0.25 });
        ctx.save(); ctx.clip(); ctx.fillStyle = C.stripe; ctx.fillRect(-3, -6, 2.5, 12); ctx.fillRect(1.5, -6, 2.5, 12); ctx.restore();
        kit.circle(ctx, 5, -1, 1.3, C.eye, { outline: null, lineWidth: 0 });
        ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-11, 0.5); ctx.lineTo(-7, 1.5); ctx.closePath(); ctx.fillStyle = C.outline; ctx.fill();
      },
    },
  },

  fx: {
    onHit(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 7, shape: 'spark', colors: ['#fff6c2', '#ffd23a'], speed: [2, 5], life: [10, 18] }); },
    onHurt(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 6, shape: 'dot', color: '#ffd23a', speed: [3, 7], gravity: 0.15, life: [18, 30], size: [2, 3] }); },
    onEvent: {
      release(fx, ev) { fx.ring({ x: ev.x + 30, y: ev.y - 50, r0: 8, r1: 46, color: '#ffd23a', life: 14 }); fx.sound('buzz-thwack'); },
      scatter(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 44, count: 14, shape: 'dot', color: '#ffd23a', speed: [4, 9], drag: 0.92, life: [20, 34], size: [2, 3.5] }); },
      buzz(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 3, shape: 'spark', color: '#fff2a0', speed: [1, 3], life: 10 }); },
      fizzle(fx, ev) { fx.text({ x: ev.x, y: ev.y - 110, text: 'bzz…', color: '#ffe680', life: 40, size: 14 }); },
      waggle(fx, ev) { fx.text({ x: ev.x, y: ev.y - 120, text: '~waggle~', color: '#ffd23a', life: 50, size: 14 }); },
    },
  },
  sounds: { neutralSpecial: 'buzz-thwack' },
};
