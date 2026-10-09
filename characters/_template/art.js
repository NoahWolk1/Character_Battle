// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE ART — procedural "Lantern": a living flame in a brass cage, no skeleton.
// The art contract is in docs/ART_GUIDE.md. The quality bar, in short:
//   • 2–3 value tiers per material + a rim light from info.light
//   • a dark, hue-tinted outline (never pure black), ~3 px
//   • an idle that never stops moving; anticipation → impact → follow-through
//     driven by info.phase; the art IS the hitbox on active frames
//   • fx for hits, landing, KO and every custom event; readable at 0.5×
// Check it in the Lab (/lab.html?char=<id>), export the contact sheet and READ it.
//
// Three other ways to build art (mix freely):
//   1. Humanoid puppet (a person with arms/legs, auto-animated):
//        import { humanoid } from '../../shared/art/puppet.js';
//        export default humanoid({ palette: { skin, primary, ... }, hair: { style: 'spiky' },
//                                  weapon: { type: 'sword', length: 62 }, head(ctx, info) { ... } });
//   2. Sprite sheets (painted frames; put the PNGs in this folder, ≥ 2× display size):
//        assets: { sheet: './sheet.png' },
//        sheets: { body: { image: 'sheet', frameW: 256, frameH: 256, cols: 8, anchor: [128, 240], scale: 0.5 } },
//        clips:  { body: { idle: { frames: [0, 1, 2, 3], fps: 8, loop: true },
//                          bellows: { sync: 'move', startup: [8, 9], active: [10], recovery: [11, 12] } } },
//        draw(ctx, v, info) { info.sprite.drawClip(ctx, 'body', v); /* + procedural overlays */ },
//   3. Helpers for non-humanoids: shared/art/helpers/{blob,swarm,serpent,wing,tentacle,quadruped,mech}.js
// Forms: art.forms = { puddle: { draw(ctx, v, info) { ... }, bounds: {...} } } overrides per form,
// or branch on v.form inside one draw(). Entities: art.entities[name].draw(ctx, e, info) below.
// ─────────────────────────────────────────────────────────────────────────────
import * as kit from '../../shared/art/kit.js';

const TAU = Math.PI * 2;

// Palette keys are yours to name. palettes[] = alternates for duplicate picks (merged over palette).
const PALETTE = {
  main: '#ff9a3a', effect: '#ffcf5a', outline: '#2a1622',
  flameOuter: '#e8432a', flameMid: '#ff9a3a', flameCore: '#fff2b0', eye: '#3a0d12',
  brassDark: '#4a2812', brass: '#8f5a22', brassLight: '#e0a850', glass: '#ffe7b8',
};

// Traces a flickering teardrop flame into the current path: base at (0, base), tip h px
// above it, half-width w. Fill it in layers for the three value tiers.
function flamePath(ctx, time, base, h, w, seed, lean = 0) {
  const f1 = kit.noise1(time * 7 + seed, seed) - 0.5;
  const f2 = kit.noise1(time * 11 + seed * 3, seed + 1) - 0.5;
  const tipX = lean * h * 0.35 + f1 * w * 0.8;
  const tipY = base - h * (1 + f2 * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, base);
  ctx.bezierCurveTo(w * 1.25, base - h * 0.08, w * (0.9 + f2 * 0.3), base - h * 0.62, tipX, tipY);
  ctx.bezierCurveTo(-w * (0.9 - f1 * 0.3), base - h * 0.62, -w * 1.25, base - h * 0.08, 0, base);
  ctx.closePath();
}
const flame = (ctx, color, ...args) => { flamePath(ctx, ...args); ctx.fillStyle = color; ctx.fill(); };

export default {
  rig: 'none',                                          // no skeleton: draw() owns the whole body
  bounds: { left: -120, right: 160, top: -190, bottom: 48 }, // body px; room for flame lashes (dair reaches y 26)
  palette: PALETTE,
  palettes: [{}, { flameOuter: '#2a6bd1', flameMid: '#5ab4ff', flameCore: '#e8fbff', effect: '#8fd8ff', main: '#5ab4ff' },
             { flameOuter: '#2f9a4a', flameMid: '#7ae07a', flameCore: '#f0ffd0', effect: '#a8ff8a', main: '#7ae07a' },
             { flameOuter: '#7a2fd1', flameMid: '#c07aff', flameCore: '#fbe8ff', effect: '#d8a8ff', main: '#c07aff' }],

  // Persistent per-fighter state (springs, particles). Runs once, before the first draw.
  init(cache) { cache.swing = 0; cache.swingV = 0; cache.lean = 0; cache.tilt = 0; },

  draw(ctx, v, info) {
    const P = info.palette;
    const { time: t, phase, motion, light, cache } = info;
    const atk = v.state === 'attack' || v.state === 'grabbing' || v.state === 'taunt';
    const hurt = v.state === 'hitstun' || v.state === 'stunned';

    // Secondary motion: the handle swings on a damped spring driven by velocity.
    const target = -v.vx * 0.06 + motion.lean * 0.4;
    cache.swingV = (cache.swingV + (target - cache.swing) * 0.15) * 0.86;
    cache.swing += cache.swingV;

    // Anticipation (startup: draw back and shrink), impact (active: flare), follow-through (recovery).
    let flare = 1, lean = 0;
    if (atk && phase.name === 'startup') { flare = 1 - 0.18 * phase.t; lean = -0.35 * phase.t; }
    else if (atk && phase.name === 'active') { flare = 1.3; lean = 0.5; }
    else if (atk && phase.name === 'recovery') { flare = 1.3 - 0.3 * phase.t; lean = 0.5 * (1 - phase.t); }
    else if (phase.name === 'charge') { flare = 0.85 + 0.08 * Math.sin(t * 40); lean = -0.3; }
    cache.lean += (lean - cache.lean) * 0.35;
    const bob = v.grounded ? Math.sin(t * 2.4) * 1.5 : Math.sin(t * 4) * 2.5;
    const sq = motion.squash - motion.stretch * 0.5;     // squash on landing/jumpsquat, stretch with air speed
    // Whole-body tilt: lean into the run, toward the strike, and recoil when hurt.
    const tiltTarget = hurt ? -0.32 : motion.lean * 0.14 + cache.lean * 0.18;
    cache.tilt = (cache.tilt || 0) + (tiltTarget - (cache.tilt || 0)) * 0.25;

    ctx.save();
    ctx.translate(0, bob);
    ctx.scale(v.bodyScale * (1 + sq * 0.12), v.bodyScale * (1 - sq * 0.12));
    ctx.translate(0, -8); ctx.rotate(cache.tilt); ctx.translate(0, 8); // pivot just above the base

    // 1. Glow behind the glass (light spill), additive.
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, 0, -40, 56 * flare, P.flameMid, atk ? 0.3 : 0.16);
    ctx.restore();

    // 2. Brass base: fillShaded = light/mid/dark tiers + outline; gloss = specular.
    const brass = (x, y, w, h, r) => { kit.roundRectPath(ctx, x, y, w, h, r); kit.fillShaded(ctx, P.brass, { outline: P.outline, x: x + w / 2, y, r: w / 2, gloss: 0.35 }); };
    brass(-24, -9, 48, 9, 3);
    brass(-16, -13, 32, 5, 2);

    // 3. Glass globe: tinted, with the flame inside and a specular streak.
    ctx.beginPath(); ctx.ellipse(0, -36, 27, 28, 0, 0, TAU);
    ctx.lineWidth = 3; ctx.strokeStyle = P.outline; ctx.stroke();
    ctx.fillStyle = kit.radial(ctx, 0, -30, 4, 34, [kit.rgba(P.glass, 0.55), kit.rgba(P.flameOuter, 0.25)]); ctx.fill();
    ctx.save(); ctx.clip();
    // flame layers: outer → mid → core (3 value tiers), leaning into the strike
    const L = cache.lean;
    const k = flare * (hurt ? 0.8 : 1);
    ctx.globalCompositeOperation = 'lighter';
    flame(ctx, kit.rgba(P.flameOuter, 0.9), t, -12, 46 * k, 17, 1, L);
    flame(ctx, kit.rgba(P.flameMid, 0.95), t, -14, 36 * k, 12, 2, L);
    flame(ctx, P.flameCore, t, -16, 22 * k, 7, 3, L);
    ctx.restore();
    kit.rimArc(ctx, 0, -36, 27, light.dir, P.glass, 2.5, 0.7);                 // glass rim light
    ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -36, 20, -2.6, -2.0); ctx.stroke(); ctx.restore(); // specular streak

    // 4. Face inside the flame: blinks, frowns when attacking, squints when hurt.
    const blink = (t % 3.7) < 0.12 ? 0.15 : 1;
    const eyeY = -32 + L * 2;
    for (const ex of [-6, 6]) {
      if (hurt) { ctx.strokeStyle = P.eye; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(ex + 1, eyeY - 3); ctx.lineTo(ex + 6, eyeY); ctx.lineTo(ex + 1, eyeY + 3); ctx.stroke(); }
      else kit.ellipse(ctx, ex + 4 + L * 4, eyeY, 2.6, 4 * blink, P.eye);
    }
    if (atk) { ctx.strokeStyle = P.eye; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-4, eyeY - 8); ctx.lineTo(4, eyeY - 6); ctx.lineTo(13, eyeY - 8); ctx.stroke(); }

    // 5. Cage bars over the glass (front three), then the cap, vent and swinging handle.
    ctx.strokeStyle = P.brassDark; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, -36, 15, 28, 0, 0, TAU); ctx.moveTo(0, -64); ctx.lineTo(0, -8); ctx.stroke();
    brass(-19, -70, 38, 9, 4);
    brass(-9, -76, 18, 7, 3);
    ctx.save(); ctx.translate(0, -76); ctx.rotate(cache.swing);
    ctx.lineCap = 'round';
    ctx.strokeStyle = P.outline; ctx.lineWidth = 6.5; ctx.beginPath(); ctx.arc(0, -8, 9, Math.PI * 0.9, Math.PI * 2.1); ctx.stroke();
    ctx.strokeStyle = P.brass; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.restore();

    // 6. The flame tip escaping through the vent (the capsule hurtbox up top).
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    flame(ctx, kit.rgba(P.flameOuter, 0.85), t + 0.3, -74, 18 * flare, 6, 4, L);
    flame(ctx, kit.rgba(P.flameCore, 0.9), t + 0.6, -75, 10 * flare, 3, 5, L);
    ctx.restore();
    ctx.restore();

    // 7. Active frames: flame lashes INTO every hitbox (the visual is the hitbox).
    if (phase.name === 'active') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const hb of info.hitboxes) {
        const c = kit.shapeCenter(hb);
        // a tapered flame tongue from the globe into the box (flamePath points up, so rotate)
        const dx = c.x, dy = c.y + 40, d = Math.hypot(dx, dy);
        if (d > 20) {
          ctx.save(); ctx.translate(0, -40); ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
          flame(ctx, kit.rgba(P.flameOuter, 0.7), t, 0, d * 1.05, 12, 6, 0);
          flame(ctx, kit.rgba(P.flameCore, 0.8), t, 0, d * 0.9, 5, 7, 0);
          ctx.restore();
        }
        kit.shapePath(ctx, hb);
        ctx.fillStyle = kit.radial(ctx, c.x, c.y, 2, 40, [P.flameCore, kit.rgba(P.flameOuter, 0.55)]); ctx.fill();
        kit.shapeGlow(ctx, hb, P.effect, 0.4);
      }
      ctx.restore();
    }
    // Low oil: the vent sputters with smoke (body-space emitter, call every frame).
    if (v.resources.oil < 20) info.fx.local.smoke({ x: 0, y: -80, rate: 0.25, color: '#5a4a50', size: [3, 7], life: [20, 34] });
  },

  // World space at the feet, NOT mirrored, unclipped: a warm pool of light on the floor.
  drawBack(ctx, v, info) {
    if (!v.grounded) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.scale(1, 0.25);
    kit.glow(ctx, 0, 0, 80, info.palette.flameMid, 0.22);
    ctx.restore();
  },

  // Swing trails: null = default (centers of active hitboxes); false = none.
  trail: null,

  entities: {
    ember: { // origin = entity center, +x = its facing; e.vx/e.vy are local velocity
      draw(ctx, e, info) {
        const P = info.palette;
        const a = Math.atan2(e.vy, e.vx);
        ctx.save(); ctx.rotate(a); ctx.globalCompositeOperation = 'lighter';
        kit.glow(ctx, 0, 0, 24, P.flameMid, 0.5);
        ctx.rotate(-Math.PI / 2);                        // flamePath points up (−y): trail it backward
        flame(ctx, kit.rgba(P.flameOuter, 0.9), info.time, 8, 26, 9, e.id, 0);
        flame(ctx, P.flameCore, info.time, 6, 14, 5, e.id + 1, 0);
        ctx.restore();
      },
    },
    cinder: {
      draw(ctx, e, info) {
        const P = info.palette;
        const pulse = 0.6 + 0.4 * Math.sin(info.time * 6 + e.id);
        for (let i = 0; i < 5; i++) {
          const x = -16 + i * 8, h = 6 + 4 * kit.hash01(i, e.id);
          kit.ellipse(ctx, x, -3, 6, h * 0.6, P.brassDark, { outline: P.outline });
          kit.glow(ctx, x, -4, 10, P.flameOuter, 0.35 * pulse * e.lifeT);
        }
        if (info.quality === 'high' && (info.simFrame + e.id) % 6 === 0) {
          info.fx.burst({ x: e.x + (info.rng() - 0.5) * 30, y: e.y - 6, count: 1, shape: 'spark', color: P.flameMid, speed: [0.5, 1.5], angle: 90, spread: 30, life: [16, 26], blend: 'lighter' });
        }
      },
    },
  },

  // Particles and sounds. Hooks replace the default flavor layer (return true to keep both).
  fx: {
    onHit(fx, ev) {
      fx.burst({ x: ev.x, y: ev.y, count: 12, shape: 'spark', colors: ['#fff2b0', '#ff9a3a', '#e8432a'], speed: [3, 8], life: [10, 20], blend: 'lighter' });
      fx.ring({ x: ev.x, y: ev.y, r0: 6, r1: 34, color: '#ffcf5a', life: 10 });
    },
    onLand(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 6, shape: 'spark', color: '#ffcf5a', speed: [1, 3], angle: 90, spread: 70, life: [12, 20] }); return true; },
    onKO(fx, ev) { fx.burst({ x: ev.x, y: ev.y, count: 30, shape: 'smoke', color: '#5a4a50', speed: [1, 4], life: [30, 50] }); return true; },
    onEvent: {
      sputter(fx, ev) { fx.burst({ x: ev.x, y: ev.y - 80, count: 8, shape: 'smoke', color: '#5a4a50', speed: [0.5, 2], angle: 90, spread: 40, life: [24, 40] }); fx.sound('squeak', { pitch: 0.6, volume: 0.5 }); },
      lowOil(fx, ev) { fx.text({ x: ev.x, y: ev.y - 110, text: 'low oil!', color: '#ffcf5a', size: 12, life: 40 }); },
      glowUp(fx, ev) { fx.ring({ x: ev.x, y: ev.y - 40, r0: 20, r1: 110, color: '#ffcf5a', life: 24, blend: 'lighter' }); fx.flash('#ffe7b8', 0.12, 4); fx.sound('chime'); },
    },
  },
  // Engine events, move names, timeline sfx keys or custom events → asset | preset | SynthSpec | null.
  sounds: { jump: 'whoosh', whoosh: 'zip', taunt: 'chime' },
  portrait: { x: 0, y: -46, r: 50 },                       // body-px framing circle for HUD/select
};
