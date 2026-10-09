// Deliberately bad art (see character.js). Never copy this.
const GREY = '#9a9a9a';

export default {
  rig: 'none',
  bounds: { left: -50, right: 50, top: -120, bottom: 10 },
  palette: { main: GREY, outline: GREY, effect: GREY },
  draw(ctx) {
    ctx.fillStyle = GREY;
    ctx.fillRect(-4, -100, 8, 100);   // thin pole: the 60×100 hurtbox is mostly empty
    ctx.fillRect(-200, -112, 400, 12); // plank: far outside the hurtbox and past the bounds
    // perf: a few ms of pointless math every draw
    let s = 0;
    for (let i = 0; i < 400000; i++) s += Math.sin(i) * Math.cos(i * 0.5);
    if (s === 1e9) ctx.fillRect(0, 0, 1, 1);
  },
};
