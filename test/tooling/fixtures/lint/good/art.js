export default {
  draw(ctx, v, info) {
    const c = document.createElement('canvas');
    if (typeof window !== 'undefined') ctx.drawImage(c, Math.random() * 2, 0);
    const a = new Audio();
  },
};
