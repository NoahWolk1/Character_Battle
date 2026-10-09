// ─────────────────────────────────────────────────────────────────────────────
// Sky Sanctum — a ruined temple island floating above a sunset sea of clouds.
// Everything is procedurally painted (no image assets) and the expensive static
// layers are pre-rendered once into offscreen canvases.
// ─────────────────────────────────────────────────────────────────────────────
import * as kit from '../../../shared/art/kit.js';

const SKY = ['#120f33', '#2b1d58', '#5a2c74', '#a8436f', '#ec7a55', '#ffc27a', '#ffe3a8'];
const SUN = { x: -260, y: 120 };

function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w); c.height = Math.ceil(h);
  return c;
}

export class SkySanctumArt {
  constructor(stage) {
    this.stage = stage;
    this.rand = kit.seeded(1337);
    this.stars = Array.from({ length: 140 }, () => ({ x: this.rand(), y: this.rand() * 0.55, s: 0.4 + this.rand() * 1.4, t: this.rand() * 10 }));
    this.birds = Array.from({ length: 7 }, (_, i) => ({ x: -1600 - i * 60 - this.rand() * 80, y: -420 - this.rand() * 120, ph: this.rand() * 6 }));
    this.motes = Array.from({ length: 70 }, () => ({ x: (this.rand() - 0.5) * 2600, y: -900 + this.rand() * 1300, s: 1 + this.rand() * 2.5, v: 0.15 + this.rand() * 0.4, ph: this.rand() * 6, hue: this.rand() }));
    this.petals = Array.from({ length: 26 }, () => ({ x: (this.rand() - 0.5) * 2400, y: -900 + this.rand() * 1300, r: this.rand() * 6, s: 3 + this.rand() * 3, v: 0.5 + this.rand() * 0.6 }));
    this.build();
  }

  // ── Pre-rendering ───────────────────────────────────────────────────────
  build() {
    this.mountains = [this.buildRange(2, '#5e3a78', '#8a4e7e', 0.55, 260), this.buildRange(3, '#3e2a62', '#6d3f75', 0.75, 330)];
    this.cloudLayers = [this.buildClouds(11, 0.9, 1), this.buildClouds(23, 1.0, 0.85), this.buildClouds(37, 1.15, 0.7)];
    this.island = this.buildIsland();
    this.farIslands = [this.buildFarIsland(5, 170), this.buildFarIsland(9, 130), this.buildFarIsland(17, 100)];
    this.temple = this.buildTemple();
  }

  buildRange(seed, c1, c2, rough, height) {
    const W = 3600, H = 700;
    const c = offscreen(W, H);
    const ctx = c.getContext('2d');
    const r = kit.seeded(seed);
    const pts = [];
    let y = H - height;
    for (let x = 0; x <= W; x += 40) {
      y += (r() - 0.5) * 80 * rough;
      y = Math.max(H - height - 220, Math.min(H - 60, y + (H - height - y) * 0.06));
      pts.push([x, y + Math.sin(x * 0.004 + seed) * 60]);
    }
    const g = ctx.createLinearGradient(0, H - height - 200, 0, H);
    g.addColorStop(0, c2); g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, H);
    pts.forEach(([x, yy]) => ctx.lineTo(x, yy));
    ctx.lineTo(W, H);
    ctx.fill();
    // rim light on peaks from the sun side
    ctx.strokeStyle = 'rgba(255,190,140,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach(([x, yy], i) => (i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy)));
    ctx.stroke();
    // haze
    const hz = ctx.createLinearGradient(0, H - 200, 0, H);
    hz.addColorStop(0, 'rgba(255,170,150,0)'); hz.addColorStop(1, 'rgba(255,170,150,0.35)');
    ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H);
    return c;
  }

  buildClouds(seed, scale, light) {
    const W = 4200, H = 520;
    const c = offscreen(W, H);
    const ctx = c.getContext('2d');
    const r = kit.seeded(seed);
    // A rolling bank of puffs: shadowed bottoms, sunlit pink/gold tops.
    for (let pass = 0; pass < 3; pass++) {
      for (let x = -100; x < W + 100; x += 70 + r() * 60) {
        const base = 120 + pass * 70 + r() * 60;
        const rad = (60 + r() * 90) * scale;
        const g = ctx.createRadialGradient(x - rad * 0.3, base - rad * 0.55, rad * 0.1, x, base, rad);
        const top = pass === 0 ? kit.mix('#ffd9b0', '#ff9fb0', r()) : pass === 1 ? '#f2a0a8' : '#c27aa0';
        g.addColorStop(0, kit.shade(top, 0.25 * light));
        g.addColorStop(0.55, kit.mix(top, '#8a5aa0', 0.35));
        g.addColorStop(1, 'rgba(90,60,130,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, base, rad, 0, Math.PI * 2); ctx.fill();
      }
    }
    const fill = ctx.createLinearGradient(0, 200, 0, H);
    fill.addColorStop(0, 'rgba(120,80,150,0)'); fill.addColorStop(0.4, 'rgba(120,80,150,0.85)'); fill.addColorStop(1, 'rgba(70,45,110,1)');
    ctx.fillStyle = fill; ctx.fillRect(0, 200, W, H - 200);
    return c;
  }

  buildFarIsland(seed, size) {
    const c = offscreen(size * 2.6, size * 2.6);
    const ctx = c.getContext('2d');
    const r = kit.seeded(seed);
    const cx = size * 1.3, top = size * 0.8;
    // Rocky underside: a jagged, tapering blob
    const pts = [[cx - size, top], [cx + size, top]];
    for (let i = 1; i <= 7; i++) {
      const t = i / 8;
      const x = cx + size * (1 - 2 * t) * (0.95 - 0.5 * Math.sin(t * Math.PI) * 0) ;
      const depth = Math.sin(t * Math.PI) * size * (1.1 + r() * 0.5) + size * 0.15;
      pts.push([cx + size * 0.95 - t * size * 1.9 + (r() - 0.5) * size * 0.15, top + depth * (0.55 + 0.45 * Math.sin(t * Math.PI))]);
    }
    kit.blobPath(ctx, pts, 0.4);
    const g = ctx.createLinearGradient(0, top, 0, top + size * 1.6);
    g.addColorStop(0, '#a77890'); g.addColorStop(0.5, '#6e4a7a'); g.addColorStop(1, '#3a2a5c');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    const lit = ctx.createLinearGradient(cx - size, 0, cx, 0);
    lit.addColorStop(0, 'rgba(255,170,130,0.5)'); lit.addColorStop(1, 'rgba(255,170,130,0)');
    ctx.fillStyle = lit; ctx.fillRect(cx - size * 1.2, top, size, size * 2);
    ctx.strokeStyle = 'rgba(40,24,60,0.3)'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const y = top + 14 + i * size * 0.22; ctx.beginPath(); ctx.moveTo(cx - size, y); ctx.lineTo(cx + size, y + (r() - 0.5) * 10); ctx.stroke(); }
    ctx.restore();
    // grassy cap
    kit.roundRectPath(ctx, cx - size * 1.02, top - 7, size * 2.04, 12, 6);
    ctx.fillStyle = '#b4a08a'; ctx.fill();
    ctx.fillStyle = '#8fae86'; ctx.fillRect(cx - size, top - 9, size * 2, 4);
    // trees
    for (let i = 0; i < 4; i++) {
      const x = cx + (r() < 0.5 ? -1 : 1) * size * (0.45 + r() * 0.45);
      const h = size * (0.2 + r() * 0.15);
      ctx.fillStyle = '#6a4a5a'; ctx.fillRect(x - 2, top - h, 4, h);
      ctx.fillStyle = r() < 0.5 ? '#c78aa8' : '#9a7aa8';
      ctx.beginPath(); ctx.arc(x, top - h, h * 0.55, 0, Math.PI * 2); ctx.arc(x - h * 0.35, top - h * 0.8, h * 0.4, 0, Math.PI * 2); ctx.arc(x + h * 0.35, top - h * 0.8, h * 0.4, 0, Math.PI * 2); ctx.fill();
    }
    // small shrine: steps, columns, domed roof
    const sw = size * 0.5, sh = size * 0.32;
    ctx.fillStyle = '#d8b8c0';
    ctx.fillRect(cx - sw * 0.6, top - 6, sw * 1.2, 6);
    for (let i = 0; i < 4; i++) { const x = cx - sw * 0.45 + i * (sw * 0.3); ctx.fillRect(x - 3, top - sh, 6, sh - 6); }
    ctx.fillRect(cx - sw * 0.55, top - sh - 6, sw * 1.1, 7);
    ctx.beginPath(); ctx.arc(cx, top - sh - 6, sw * 0.42, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,220,180,0.6)'; ctx.fillRect(cx - sw * 0.55, top - sh - 6, sw * 1.1, 2);
    // tiny waterfall
    const wx = cx + size * 0.6;
    const wf = ctx.createLinearGradient(0, top, 0, top + size * 1.3);
    wf.addColorStop(0, 'rgba(220,240,255,0.7)'); wf.addColorStop(1, 'rgba(220,240,255,0)');
    ctx.fillStyle = wf; ctx.fillRect(wx, top, 5, size * 1.3);
    return c;
  }

  buildIsland() {
    // Covers world x ∈ [-640, 640], y ∈ [-30, 520]. Rendered at 2x for crisp zoom.
    const S = 2, X0 = -640, Y0 = -40, W = 1280, H = 560;
    const c = offscreen(W * S, H * S);
    const ctx = c.getContext('2d');
    ctx.scale(S, S);
    ctx.translate(-X0, -Y0);
    const r = kit.seeded(77);
    const g = this.stage.ground;

    // Rock underside
    const body = [[g.x1 - 30, 40]];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = g.x1 - 30 + t * (g.x2 - g.x1 + 60);
      const depth = 60 + Math.sin(t * Math.PI) * 360 + (r() - 0.5) * 40 + (t > 0.4 && t < 0.6 ? 60 : 0);
      if (i > 0) body.push([x - 20 + r() * 40, depth * (0.6 + 0.4 * Math.sin(t * Math.PI))]);
    }
    body.push([g.x2 + 30, 40]);
    const under = body.slice(1, -1).sort((a, b) => b[0] - a[0]);
    const shape = [[g.x1 - 30, 18], [g.x2 + 30, 18], [g.x2 + 30, 40], ...under, [g.x1 - 30, 40]];
    kit.blobPath(ctx, shape, 0.35);
    const rock = ctx.createLinearGradient(0, 20, 0, 460);
    rock.addColorStop(0, '#9b6f69'); rock.addColorStop(0.35, '#6b4763'); rock.addColorStop(1, '#2a1c3e');
    ctx.fillStyle = rock; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = '#1b1226'; ctx.stroke();
    // Strata, cracks, sunlit rims
    ctx.save();
    kit.blobPath(ctx, shape, 0.35); ctx.clip();
    for (let i = 0; i < 9; i++) {
      const y = 60 + i * 38 + r() * 10;
      ctx.strokeStyle = `rgba(30,18,48,${0.25 + r() * 0.2})`; ctx.lineWidth = 3 + r() * 3;
      ctx.beginPath(); ctx.moveTo(g.x1 - 40, y);
      for (let x = g.x1 - 40; x < g.x2 + 40; x += 60) ctx.lineTo(x, y + (r() - 0.5) * 22);
      ctx.stroke();
    }
    const sunSide = ctx.createLinearGradient(g.x1 - 40, 0, g.x1 + 300, 0);
    sunSide.addColorStop(0, 'rgba(255,150,100,0.45)'); sunSide.addColorStop(1, 'rgba(255,150,100,0)');
    ctx.fillStyle = sunSide; ctx.fillRect(g.x1 - 60, 0, 400, 520);
    const ao = ctx.createLinearGradient(0, 30, 0, 110);
    ao.addColorStop(0, 'rgba(10,5,20,0.55)'); ao.addColorStop(1, 'rgba(10,5,20,0)');
    ctx.fillStyle = ao; ctx.fillRect(g.x1 - 60, 30, g.x2 - g.x1 + 120, 80);
    // embedded crystals
    for (let i = 0; i < 9; i++) {
      const x = g.x1 + 60 + r() * (g.x2 - g.x1 - 120);
      const y = 120 + r() * 170;
      this.crystal(ctx, x, y, 12 + r() * 14, Math.PI + (r() - 0.5) * 0.7, r);
    }
    ctx.restore();
    // Stalactites
    for (let i = 0; i < 7; i++) {
      const x = -260 + i * 85 + r() * 30;
      const y0 = 300 + Math.sin(((x + 640) / 1280) * Math.PI) * 60 - 80;
      kit.polygonPath(ctx, [[x - 18, y0], [x + 2, y0 + 70 + r() * 70], [x + 18, y0]]);
      ctx.fillStyle = '#2d1f42'; ctx.fill();
    }
    // Hanging vines
    for (let i = 0; i < 14; i++) {
      const x = g.x1 + r() * (g.x2 - g.x1);
      const len = 40 + r() * 110;
      ctx.strokeStyle = '#2e5a3e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, 50);
      ctx.bezierCurveTo(x + 12, 50 + len * 0.3, x - 12, 50 + len * 0.6, x + 4, 50 + len); ctx.stroke();
      ctx.fillStyle = '#4f8f52';
      for (let k = 0; k < len; k += 14) { ctx.beginPath(); ctx.ellipse(x + Math.sin(k) * 6, 56 + k, 5, 3, k, 0, Math.PI * 2); ctx.fill(); }
    }

    // Carved stone top (the floor you fight on)
    const lip = [[g.x1 - 34, -2], [g.x2 + 34, -2], [g.x2 + 22, 44], [g.x1 - 22, 44]];
    kit.polygonPath(ctx, lip);
    const stone = ctx.createLinearGradient(0, -2, 0, 44);
    stone.addColorStop(0, '#f3dfbf'); stone.addColorStop(0.25, '#d9bd98'); stone.addColorStop(1, '#8c6a66');
    ctx.fillStyle = stone; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#1b1226'; ctx.stroke();
    // walking surface highlight + tiles
    ctx.fillStyle = '#fff1d8'; ctx.fillRect(g.x1 - 32, -1, g.x2 - g.x1 + 64, 5);
    ctx.strokeStyle = 'rgba(90,60,60,0.45)'; ctx.lineWidth = 2;
    for (let x = g.x1 - 10; x < g.x2 + 20; x += 72) { ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x - 4, 22); ctx.stroke(); }
    // frieze band with gold trim
    ctx.fillStyle = '#6e4c5c'; ctx.fillRect(g.x1 - 26, 22, g.x2 - g.x1 + 52, 18);
    ctx.fillStyle = '#e8b04a'; ctx.fillRect(g.x1 - 26, 21, g.x2 - g.x1 + 52, 3); ctx.fillRect(g.x1 - 24, 39, g.x2 - g.x1 + 48, 3);
    ctx.strokeStyle = '#a8803e'; ctx.lineWidth = 2;
    for (let x = g.x1; x < g.x2; x += 36) { ctx.beginPath(); ctx.moveTo(x, 36); ctx.lineTo(x + 9, 26); ctx.lineTo(x + 18, 36); ctx.lineTo(x + 27, 26); ctx.stroke(); }
    // grass tufts & flowers along the top edge
    for (let x = g.x1 - 30; x < g.x2 + 30; x += 7 + r() * 9) {
      const h = 5 + r() * 9;
      ctx.strokeStyle = r() < 0.5 ? '#6fae5a' : '#4f8f4a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, 2); ctx.quadraticCurveTo(x + 2, -h * 0.5, x + (r() - 0.5) * 6, -h + 2); ctx.stroke();
      if (r() < 0.08) { ctx.fillStyle = r() < 0.5 ? '#ffd4e8' : '#fff4b0'; ctx.beginPath(); ctx.arc(x, -h + 2, 2.6, 0, Math.PI * 2); ctx.fill(); }
    }
    // Edge statues (corner caps)
    for (const sx of [g.x1 - 30, g.x2 + 30]) {
      kit.roundRectPath(ctx, sx - 16, -10, 32, 54, 5);
      kit.fillShaded(ctx, '#c9a98a', { outline: '#1b1226', lineWidth: 4, x: sx, y: 15, r: 30 });
      ctx.fillStyle = '#e8b04a'; ctx.fillRect(sx - 16, -10, 32, 4);
    }
    return { canvas: c, x: X0, y: Y0, w: W, h: H };
  }

  crystal(ctx, x, y, s, rot, r) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    kit.glow(ctx, 0, -s * 0.4, s * 2.2, '#6ff3ff', 0.3);
    const shards = [[-0.55, 0.75, -0.35], [0.5, 0.8, 0.3], [0, 1.25, 0]];
    for (const [ox, hk, a] of shards) {
      const h = s * 1.5 * hk, w = s * 0.42 * (0.7 + hk * 0.3);
      ctx.save(); ctx.translate(ox * s * 0.6, 0); ctx.rotate(a);
      // faceted prism: left face, right face, tip
      kit.polygonPath(ctx, [[-w, 0], [-w, -h * 0.7], [0, -h], [w, -h * 0.7], [w, 0], [0, w * 0.4]]);
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#0f3448'; ctx.stroke();
      const g = ctx.createLinearGradient(-w, 0, w, 0);
      g.addColorStop(0, '#9ff8ff'); g.addColorStop(0.5, '#4fd2ee'); g.addColorStop(1, '#1d86b8');
      ctx.fillStyle = g; ctx.fill();
      kit.polygonPath(ctx, [[-w, -h * 0.7], [0, -h], [0, w * 0.4], [-w, 0]]);
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-w * 0.55, -h * 0.15); ctx.lineTo(-w * 0.55, -h * 0.65); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  buildTemple() {
    // Ruined colonnade + great ring gate behind the main stage (drawn hazy).
    const X0 = -700, Y0 = -820, W = 1400, H = 860;
    const c = offscreen(W, H);
    const ctx = c.getContext('2d');
    ctx.translate(-X0, -Y0);
    const r = kit.seeded(4242);
    const col = '#c8a2b2', dark = '#8a6a8e';
    const column = (x, h, broken) => {
      ctx.fillStyle = dark; ctx.fillRect(x - 30, -18, 60, 18);
      const g = ctx.createLinearGradient(x - 24, 0, x + 24, 0);
      g.addColorStop(0, '#e6c6c8'); g.addColorStop(0.5, col); g.addColorStop(1, dark);
      ctx.fillStyle = g;
      if (broken) {
        kit.polygonPath(ctx, [[x - 22, -18], [x - 22, -h], [x - 8, -h - 18], [x + 4, -h + 6], [x + 22, -h - 10], [x + 22, -18]]);
        ctx.fill();
      } else {
        ctx.fillRect(x - 22, -h, 44, h - 18);
        ctx.fillStyle = dark; ctx.fillRect(x - 30, -h - 16, 60, 16);
      }
      ctx.strokeStyle = 'rgba(80,50,90,0.35)'; ctx.lineWidth = 2;
      for (let k = -14; k <= 14; k += 9) { ctx.beginPath(); ctx.moveTo(x + k, -20); ctx.lineTo(x + k, -h + 10); ctx.stroke(); }
    };
    column(-470, 300, true);
    column(-330, 380, false);
    column(330, 380, false);
    column(470, 240, true);
    // lintel between inner columns
    ctx.fillStyle = col; ctx.fillRect(-370, -420, 740, 26);
    ctx.fillStyle = dark; ctx.fillRect(-370, -398, 740, 6);
    // Great ring gate
    ctx.save();
    ctx.translate(0, -600);
    ctx.lineWidth = 34; ctx.strokeStyle = dark;
    ctx.beginPath(); ctx.arc(0, 0, 175, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 22; ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(0, 0, 175, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = '#f0d0a0';
    ctx.beginPath(); ctx.arc(0, 0, 186, Math.PI * 1.05, Math.PI * 1.6); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      ctx.save(); ctx.rotate((i / 12) * Math.PI * 2);
      ctx.fillStyle = dark; ctx.fillRect(-9, -200, 18, 22);
      ctx.restore();
    }
    ctx.restore();
    // supports from lintel to ring
    ctx.fillStyle = col;
    kit.polygonPath(ctx, [[-120, -420], [-70, -440], [-90, -440], [-140, -420]]); ctx.fill();
    // crumbled blocks
    for (let i = 0; i < 12; i++) {
      const x = -560 + r() * 1120; if (Math.abs(x) < 300) continue;
      ctx.fillStyle = r() < 0.5 ? col : dark;
      ctx.save(); ctx.translate(x, -8 - r() * 6); ctx.rotate((r() - 0.5) * 0.6); ctx.fillRect(-14, -12, 28, 20); ctx.restore();
    }
    return { canvas: c, x: X0, y: Y0, w: W, h: H };
  }

  // ── Per-frame drawing ───────────────────────────────────────────────────
  /** Applies a parallax transform: p=0 → fixed to screen, p=1 → moves with the world. */
  layer(ctx, cam, p, fn) {
    ctx.save();
    const z = cam.zoom * (0.55 + 0.45 * p);
    ctx.translate(cam.w / 2, cam.h / 2);
    ctx.scale(z, z);
    ctx.translate(-cam.x * p, -cam.y * p - 120 * (1 - p));
    fn(ctx, z);
    ctx.restore();
  }

  drawBackground(ctx, cam, t) {
    const { w, h } = cam;
    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    SKY.forEach((c, i) => sky.addColorStop(i / (SKY.length - 1), c));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // Stars
    for (const s of this.stars) {
      const a = (0.4 + 0.6 * Math.sin(t * 0.03 + s.t * 5)) * (1 - s.y / 0.55);
      ctx.fillStyle = `rgba(255,240,255,${a * 0.85})`;
      ctx.fillRect(s.x * w, s.y * h, s.s, s.s);
    }
    // Sun + god rays
    this.layer(ctx, cam, 0.05, (c) => {
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (i - 4) * 0.23 + Math.sin(t * 0.004 + i) * 0.04;
        const len = 1400;
        const alpha = 0.05 + 0.03 * Math.sin(t * 0.01 + i * 2);
        const g = c.createLinearGradient(SUN.x, SUN.y, SUN.x + Math.cos(a) * len, SUN.y + Math.sin(a) * len);
        g.addColorStop(0, `rgba(255,220,160,${alpha * 2})`); g.addColorStop(1, 'rgba(255,220,160,0)');
        c.fillStyle = g;
        c.beginPath(); c.moveTo(SUN.x, SUN.y);
        c.lineTo(SUN.x + Math.cos(a - 0.06) * len, SUN.y + Math.sin(a - 0.06) * len);
        c.lineTo(SUN.x + Math.cos(a + 0.06) * len, SUN.y + Math.sin(a + 0.06) * len);
        c.fill();
      }
      kit.glow(c, SUN.x, SUN.y, 620, '#ff9a6a', 0.55);
      kit.glow(c, SUN.x, SUN.y, 260, '#ffd9a0', 0.8);
      c.restore();
      const sg = c.createRadialGradient(SUN.x, SUN.y - 20, 10, SUN.x, SUN.y, 120);
      sg.addColorStop(0, '#fffbe8'); sg.addColorStop(0.7, '#ffe3a0'); sg.addColorStop(1, '#ffb070');
      c.fillStyle = sg; c.beginPath(); c.arc(SUN.x, SUN.y, 118, 0, Math.PI * 2); c.fill();
    });
    // Distant mountains
    this.layer(ctx, cam, 0.1, (c) => c.drawImage(this.mountains[0], -1800, -260));
    this.layer(ctx, cam, 0.18, (c) => c.drawImage(this.mountains[1], -1800, -150));
    // Far floating islands (bobbing)
    this.layer(ctx, cam, 0.28, (c) => {
      const isl = this.farIslands;
      c.globalAlpha = 0.85;
      c.drawImage(isl[0], -1350, -640 + Math.sin(t * 0.012) * 8);
      c.drawImage(isl[1], 820, -720 + Math.sin(t * 0.015 + 2) * 7);
      c.drawImage(isl[2], 1300, -380 + Math.sin(t * 0.018 + 4) * 6);
      c.globalAlpha = 1;
      // birds
      c.strokeStyle = 'rgba(60,30,70,0.7)'; c.lineWidth = 2.2;
      for (const b of this.birds) {
        const x = ((b.x + t * 0.9 + 3200) % 3200) - 1600;
        const flap = Math.sin(t * 0.25 + b.ph) * 5;
        c.beginPath(); c.moveTo(x - 8, b.y + flap); c.quadraticCurveTo(x - 3, b.y - 3, x, b.y); c.quadraticCurveTo(x + 3, b.y - 3, x + 8, b.y + flap); c.stroke();
      }
    });
    // Cloud sea, drifting
    const drift = (layer, p, y, speed) => this.layer(ctx, cam, p, (c) => {
      const W = layer.width;
      const off = ((t * speed) % W);
      c.drawImage(layer, -2100 - off, y);
      c.drawImage(layer, -2100 - off + W, y);
    });
    drift(this.cloudLayers[0], 0.35, 140, 0.15);
    drift(this.cloudLayers[1], 0.55, 260, 0.3);
    // Temple ruins behind the stage
    this.layer(ctx, cam, 0.88, (c) => {
      c.globalAlpha = 0.9;
      const T = this.temple;
      c.drawImage(T.canvas, T.x, T.y);
      c.globalAlpha = 1;
      // portal energy inside the gate
      c.save(); c.translate(0, -600);
      c.globalCompositeOperation = 'lighter';
      const pg = c.createRadialGradient(0, 0, 20, 0, 0, 165);
      pg.addColorStop(0, 'rgba(120,240,255,0.35)'); pg.addColorStop(0.7, 'rgba(160,120,255,0.12)'); pg.addColorStop(1, 'rgba(160,120,255,0)');
      c.fillStyle = pg; c.beginPath(); c.arc(0, 0, 165, 0, Math.PI * 2); c.fill();
      c.rotate(t * 0.004);
      c.strokeStyle = 'rgba(150,250,255,0.5)'; c.lineWidth = 2;
      for (let i = 0; i < 16; i++) {
        c.rotate(Math.PI / 8);
        c.beginPath(); c.moveTo(150, -6); c.lineTo(160, 0); c.lineTo(150, 6); c.stroke();
      }
      c.restore();
    });
  }

  drawStage(ctx, t) {
    const I = this.island;
    const g = this.stage.ground;
    // waterfall (behind island lip)
    ctx.save();
    const wx = g.x2 - 120;
    const wf = ctx.createLinearGradient(wx, 0, wx + 40, 0);
    wf.addColorStop(0, 'rgba(170,230,255,0.25)'); wf.addColorStop(0.5, 'rgba(230,250,255,0.75)'); wf.addColorStop(1, 'rgba(170,230,255,0.25)');
    ctx.fillStyle = wf;
    ctx.fillRect(wx, 40, 40, 900);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const y = ((t * 9 + i * 120) % 900) + 40;
      ctx.beginPath(); ctx.moveTo(wx + 6 + (i * 7) % 28, y); ctx.lineTo(wx + 6 + (i * 7) % 28, y + 50); ctx.stroke();
    }
    ctx.restore();
    ctx.drawImage(I.canvas, I.x, I.y, I.w, I.h);
    // pulsing runes on the frieze
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const x = g.x1 + 80 + i * ((g.x2 - g.x1 - 160) / 6);
      const a = 0.35 + 0.35 * Math.sin(t * 0.05 + i * 0.9);
      kit.glow(ctx, x, 31, 22, '#6ff3ff', a);
      ctx.strokeStyle = `rgba(200,255,255,${a + 0.2})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, 31, 5, 0, Math.PI * 2); ctx.moveTo(x, 24); ctx.lineTo(x, 38); ctx.stroke();
    }
    ctx.restore();
    // soft platforms
    for (const p of this.stage.platforms) this.drawPlatform(ctx, p, t);
  }

  drawPlatform(ctx, p, t) {
    const w = p.x2 - p.x1;
    const cx = (p.x1 + p.x2) / 2;
    // glow beneath
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    kit.glow(ctx, cx, p.y + 26, w * 0.45, '#6ff3ff', 0.18 + Math.sin(t * 0.04 + p.x1) * 0.05);
    ctx.restore();
    // slab underside
    kit.polygonPath(ctx, [[p.x1 - 8, p.y + 2], [p.x2 + 8, p.y + 2], [p.x2 - 14, p.y + 22], [cx + 20, p.y + 34], [cx - 20, p.y + 34], [p.x1 + 14, p.y + 22]]);
    const g = ctx.createLinearGradient(0, p.y, 0, p.y + 34);
    g.addColorStop(0, '#a77f80'); g.addColorStop(1, '#4b3157');
    ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#1b1226'; ctx.stroke();
    // top surface
    kit.roundRectPath(ctx, p.x1 - 10, p.y - 3, w + 20, 12, 4);
    const tg = ctx.createLinearGradient(0, p.y - 3, 0, p.y + 9);
    tg.addColorStop(0, '#fff0d4'); tg.addColorStop(1, '#c9a78a');
    ctx.fillStyle = tg; ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#e8b04a'; ctx.fillRect(p.x1 - 6, p.y + 8, w + 12, 3);
    // hanging crystal
    ctx.save(); ctx.translate(cx, p.y + 40 + Math.sin(t * 0.05 + p.x1) * 3);
    kit.glow(ctx, 0, 0, 26, '#6ff3ff', 0.5);
    kit.polygonPath(ctx, [[-7, -6], [0, -14], [7, -6], [0, 16]]);
    ctx.fillStyle = '#9ff8ff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#123a52'; ctx.stroke();
    ctx.restore();
  }

  drawForeground(ctx, cam, t) {
    // Close cloud bank for depth
    this.layer(ctx, cam, 1.25, (c) => {
      const L = this.cloudLayers[2];
      const off = (t * 0.6) % L.width;
      c.globalAlpha = 0.9;
      c.drawImage(L, -2100 - off, 470);
      c.drawImage(L, -2100 - off + L.width, 470);
      c.globalAlpha = 1;
    });
    // Light motes + petals
    this.layer(ctx, cam, 1.05, (c) => {
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const m of this.motes) {
        const y = ((m.y - t * m.v + 1300) % 1300) - 900;
        const x = m.x + Math.sin(t * 0.02 + m.ph) * 20;
        const a = 0.35 + 0.35 * Math.sin(t * 0.05 + m.ph);
        kit.glow(c, x, y, m.s * 5, m.hue < 0.5 ? '#ffd890' : '#8ff7ff', a);
      }
      c.restore();
      for (const p of this.petals) {
        const y = ((p.y + t * p.v + 1300) % 1300) - 900;
        const x = p.x + Math.sin(t * 0.015 + p.r) * 60 + t * 0.3 % 2400;
        c.save(); c.translate(((x + 1200) % 2400) - 1200, y); c.rotate(t * 0.03 + p.r);
        c.fillStyle = 'rgba(255,190,215,0.85)';
        c.beginPath(); c.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2); c.fill();
        c.restore();
      }
    });
    // Vignette + warm grade
    const { w, h } = cam;
    const v = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(20,6,30,0.5)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  }
}
