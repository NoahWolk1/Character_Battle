// Integration and stage collision (spec §3.1 physics.js): knockback decay,
// position update, the collider vs ground/platforms, ledge snap, landing.
import { PHYSICS, DODGE } from '../constants.js';
import { setState } from './states.js';
import { collider } from './hurtbox.js';
import { airReset } from './movement.js';
import * as actions from './actions.js';
import * as script from './script-api.js';

export function approach(v, target, step) { return v < target ? Math.min(target, v + step) : Math.max(target, v - step); }
export function clampAbs(v, m) { return Math.max(-m, Math.min(m, v)); }

/** Step §3.2 "physics.integrate": kx/ky decay, pos += v + k, collide. */
export function integrate(f) {
  // knockback velocity decays linearly
  const mag = Math.hypot(f.kx, f.ky);
  if (mag > 0) {
    if (mag <= PHYSICS.launchDecay) { f.kx = 0; f.ky = 0; } else {
      const k = (mag - PHYSICS.launchDecay) / mag;
      f.kx *= k; f.ky *= k;
    }
  }
  const ox = f.x, oy = f.y;
  f.x += f.vx + f.kx;
  f.y += f.vy + f.ky;
  collide(f, ox, oy);
}

export function collide(f, ox, oy) {
  const game = f.game;
  const stage = game.stage;
  const g = stage.ground;
  const col = collider(f);
  const hw = col.w / 2;
  const h = col.h;
  const totalVy = f.vy + f.ky;

  if (f.grounded) {
    // walking off an edge?
    const surf = f.platform >= 0 ? stage.platforms[f.platform] : g;
    if (f.x < surf.x1 || f.x > surf.x2) {
      leaveGround(f);
      if (f.state === 'idle' || f.state === 'run' || f.state === 'crouch' || f.state === 'land') setState(f, 'air');
      f.jumpsLeft = f.stats.airJumps;
    } else {
      f.y = surf.y;
      f.vy = 0;
      if (f.ky > 0) f.ky = 0;
      return;
    }
  }

  // main stage (solid)
  const overlapsX = f.x + hw > g.x1 && f.x - hw < g.x2;
  if (f.x >= g.x1 && f.x <= g.x2 && f.y >= g.y && oy <= g.y + 0.01 && totalVy >= 0) {
    return touchGround(f, -1, g.y);
  }
  if (overlapsX && f.y > g.y && f.y - h < g.bottom) {
    if (oy - h >= g.bottom - 0.01) { // bonk from below
      f.y = g.bottom + h; f.vy = Math.max(0, f.vy); f.ky = Math.abs(f.ky) * 0.4;
    } else if (ox <= g.x1 - hw + 0.5 || f.x < (g.x1 + g.x2) / 2) {
      f.x = g.x1 - hw; if (f.kx > 0) { f.kx = -f.kx * 0.5; } f.vx = Math.min(0, f.vx);
    } else {
      f.x = g.x2 + hw; if (f.kx < 0) { f.kx = -f.kx * 0.5; } f.vx = Math.max(0, f.vx);
    }
  }

  // auto ledge climb: close to the edge, slightly below the top, not in hitstun
  const canSnap = f.state === 'air' || f.state === 'helpless' || f.state === 'airdodge';
  if (canSnap && totalVy > -4 && !(f.fastFall && f.input.down)) {
    const towardRight = f.input.right || f.vx > 0.5;
    const towardLeft = f.input.left || f.vx < -0.5;
    const nearLeft = towardRight && f.x < g.x1 && f.x > g.x1 - hw - PHYSICS.edgeSnapX;
    const nearRight = towardLeft && f.x > g.x2 && f.x < g.x2 + hw + PHYSICS.edgeSnapX;
    if ((nearLeft || nearRight) && f.y > g.y && f.y < g.y + PHYSICS.edgeSnapY) {
      f.x = nearLeft ? g.x1 + 6 : g.x2 - 6;
      f.y = g.y;
      f.facing = nearLeft ? 1 : -1;
      game.emit({ type: 'ledge', id: f.id, x: f.x, y: f.y });
      return touchGround(f, -1, g.y, 8);
    }
  }

  // soft platforms (only from above)
  if (totalVy >= 0 && f.dropThrough <= 0) {
    for (let i = 0; i < stage.platforms.length; i++) {
      const p = stage.platforms[i];
      if (f.x >= p.x1 && f.x <= p.x2 && oy <= p.y && f.y >= p.y) {
        if (f.fastFall && f.input.down && f.state === 'air') continue; // hold down to fall through
        return touchGround(f, i, p.y);
      }
    }
  }
}

export function touchGround(f, platform, y, forcedLag) {
  const game = f.game;
  f.y = y;
  const impact = f.vy + f.ky;
  if (f.state === 'hitstun' && f.tumble && Math.hypot(f.kx, f.ky) > 5) {
    // bounce off the floor
    f.ky = -Math.abs(f.ky) * 0.55;
    f.vy = -Math.abs(f.vy) * 0.3;
    game.emit({ type: 'bounce', id: f.id, x: f.x, y });
    return;
  }
  f.grounded = true;
  f.platform = platform;
  f.vy = 0; f.ky = 0; f.kx *= 0.5;
  f.jumpsLeft = f.stats.airJumps;
  f.fastFall = false;
  f.usedAirDodge = false;
  f.usedSideSpecial = false;
  f.air.used.clear();
  airReset(f);
  if (game.gov && game.gov.airReset) game.gov.airReset(f);
  script.run(f, 'onLand');
  if (f.action) actions.onLand(f); // timeline onLand entries (WP-F)
  const a = f.action;
  let lag = forcedLag ?? PHYSICS.landingLag;
  if (f.state === 'attack' && a.aerial) {
    lag = a.def.category === 'aerial' ? a.def.landingLag : 10;
  } else if (f.state === 'attack') {
    return; // grounded special continuing on the ground
  } else if (f.state === 'helpless') lag = 14;
  else if (f.state === 'airdodge') lag = DODGE.air.landingLag;
  else if (f.state === 'hitstun') { lag = 10; f.tumble = false; }
  else if (f.state === 'shieldbreak') return;
  else if (f.state === 'grabbing' || f.state === 'grabbed') return; // grabs hold through landing (WP-F)
  land(f, lag);
  if (impact > 3) game.emit({ type: 'land', id: f.id, x: f.x, y, heavy: impact > 9 });
}

export function land(f, lag) {
  f.grounded = true;
  setState(f, 'land');
  f.lag = lag;
}

export function leaveGround(f) {
  f.grounded = false;
  f.platform = -1;
}
