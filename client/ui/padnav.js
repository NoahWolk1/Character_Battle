// Gamepad menu navigation: D-pad / left stick moves focus between the visible controls of
// the active screen (or the pause overlay), A clicks, B goes back / resumes, Start presses
// the screen's primary button. Idle while a match is running (no screen, no pause menu);
// in-match Start is handled by the match loops (client/match.js).
import { PadEdges, padButton } from '../input.js';

const FOCUSABLE = 'button, select, .char-card, .slot';
const PADS = [0, 1, 2, 3];
const REPEAT_DELAY = 360, REPEAT_EVERY = 130; // ms, held-direction auto-repeat

/** Nearest rect from rects[from] in direction [dx, dy] (screen space); -1 if none. Pure. */
export function nearest(rects, from, [dx, dy]) {
  const a = rects[from];
  if (!a) return rects.length ? 0 : -1;
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  let best = -1, bestD = Infinity;
  rects.forEach((r, i) => {
    if (i === from) return;
    const vx = r.x + r.w / 2 - ax, vy = r.y + r.h / 2 - ay;
    const along = vx * dx + vy * dy;
    if (along <= 1) return;
    const d = along + Math.abs(vx * dy - vy * dx) * 2; // prefer straight-ahead targets
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Direction any pad is holding (D-pad or left stick), or null. */
export function padDirection(get = padButton, axes = () => []) {
  for (const i of PADS) {
    const [ax = 0, ay = 0] = axes(i);
    if (get(i, 12) || ay < -0.5) return [0, -1];
    if (get(i, 13) || ay > 0.5) return [0, 1];
    if (get(i, 14) || ax < -0.5) return [-1, 0];
    if (get(i, 15) || ax > 0.5) return [1, 0];
  }
  return null;
}

const visible = (el) => el.offsetParent !== null && !el.disabled && !el.closest('.hidden');

function activeRoot() {
  const pause = document.querySelector('#pause');
  if (pause && !pause.classList.contains('hidden')) return pause;
  return document.querySelector('.screen.active');
}

export function startPadNav() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
  const edges = new PadEdges();
  const axes = (i) => navigator.getGamepads()[i]?.axes || [];
  let focused = null, focusIdx = 0, root = null, held = null, heldAt = 0, lastMove = 0;

  const setFocus = (el) => {
    focused?.classList.remove('pad-focus');
    focused = el;
    if (!el) return;
    focusIdx = Math.max(0, items().indexOf(el));
    el.classList.add('pad-focus');
    el.focus?.({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  };
  const items = () => [...root.querySelectorAll(FOCUSABLE)].filter(visible);
  const move = (dir) => {
    const list = items();
    if (!list.length) return;
    const at = list.indexOf(focused);
    if (at < 0) return setFocus(list[0]);
    if (focused.tagName === 'SELECT' && dir[0]) { // left/right cycles a <select>
      const n = focused.options.length;
      focused.selectedIndex = (focused.selectedIndex + dir[0] + n) % n;
      focused.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const j = nearest(list.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }), at, dir);
    if (j >= 0) setFocus(list[j]);
  };
  const click = (sel) => { const el = [...root.querySelectorAll(sel)].find(visible); el?.click(); return !!el; };
  addEventListener('mousemove', () => focused?.classList.remove('pad-focus'));

  const loop = (now) => {
    requestAnimationFrame(loop);
    // Always sample edges so a button held during play doesn't fire when a menu opens.
    const a = edges.pressed(0, PADS), b = edges.pressed(1, PADS), start = edges.pressed(9, PADS);
    const dir = padDirection(padButton, axes);
    const r = activeRoot();
    if (r !== root) { root = r; setFocus(null); }
    if (!root) { held = null; return; }
    if (focused && (!focused.isConnected || !root.contains(focused) || !visible(focused))) {
      // re-rendered (slots, lobby): refocus the element now at the same position
      const list = items();
      setFocus(list[Math.min(focusIdx, list.length - 1)] || null);
    }
    const key = dir && dir.join();
    if (key && key !== held) { held = key; heldAt = lastMove = now; move(dir); }
    else if (key && now - heldAt > REPEAT_DELAY && now - lastMove > REPEAT_EVERY) { lastMove = now; move(dir); }
    else if (!key) held = null;
    if (a) { if (focused) focused.click(); else move([0, 1]); }
    if (b) { if (root.id === 'pause') click('#resume'); else click('.back'); }
    if (start && root.id !== 'pause') click('.primary');
  };
  requestAnimationFrame(loop);
}
